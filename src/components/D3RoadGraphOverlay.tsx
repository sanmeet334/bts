import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  RoadNodeDTO,
  RoadSegmentDTO,
  TrafficPredictionDTO,
} from '../shared/types';

export interface GraphPopupTarget {
  position: { lat: number; lng: number };
  title: string;
  subtitle?: string;
  lines: Array<{ label?: string; text: string; tone?: 'normal' | 'cyan' | 'amber' | 'emerald' | 'rose' }>;
}

interface D3RoadGraphOverlayProps {
  map: google.maps.Map | null;
  nodes: RoadNodeDTO[];
  segments: RoadSegmentDTO[];
  predictions?: TrafficPredictionDTO[];
  predictionMode?: boolean;
  highlightNodeIds?: string[];
  activeRouteSegmentIds?: string[];
  selectedSegmentId?: string;
  visible: boolean;
  interactive: boolean;
  onNodeSelect?: (node: RoadNodeDTO) => void;
  onSegmentSelect?: (
    segment: RoadSegmentDTO,
    latLng?: { lat: number; lng: number }
  ) => void;
  onOpenPopup?: (popup: GraphPopupTarget) => void;
}

interface HoverTooltipState {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string; tone?: string }>;
}

const CONGESTION_COLOR_SCALE = d3
  .scaleThreshold<number, string>()
  .domain([0.35, 0.58, 0.78])
  .range(['#22C55E', '#EAB308', '#F97316', '#EF4444']);

function getEdgeStrokeColor(
  seg: RoadSegmentDTO,
  pred?: TrafficPredictionDTO,
  predictionMode?: boolean
): string {
  if (seg.effectiveClosureStatus === 'CLOSED') return '#6B7280';
  if (seg.effectiveClosureStatus === 'LANE_RESTRICTED') return '#F97316';
  const density = predictionMode && pred ? pred.predictedDensity : seg.currentCongestion;
  return CONGESTION_COLOR_SCALE(density);
}

function getEdgeStatusText(
  seg: RoadSegmentDTO,
  pred?: TrafficPredictionDTO,
  predictionMode?: boolean
): string {
  if (seg.effectiveClosureStatus === 'CLOSED') return 'CLOSED ROAD';
  if (seg.effectiveClosureStatus === 'LANE_RESTRICTED') return 'LANE RESTRICTED (HEAVY)';
  const density = predictionMode && pred ? pred.predictedDensity : seg.currentCongestion;
  if (density >= 0.78) return 'SEVERE TRAFFIC';
  if (density >= 0.58) return 'HEAVY TRAFFIC';
  if (density >= 0.35) return 'MODERATE TRAFFIC';
  return 'LOW TRAFFIC';
}

export const D3RoadGraphOverlay: React.FC<D3RoadGraphOverlayProps> = ({
  map,
  nodes,
  segments,
  predictions = [],
  predictionMode = false,
  highlightNodeIds = [],
  activeRouteSegmentIds = [],
  selectedSegmentId,
  visible,
  interactive,
  onNodeSelect,
  onSegmentSelect,
  onOpenPopup,
}) => {
  const [tooltip, setTooltip] = useState<HoverTooltipState | null>(null);

  const onNodeSelectRef = useRef(onNodeSelect);
  onNodeSelectRef.current = onNodeSelect;
  const onSegmentSelectRef = useRef(onSegmentSelect);
  onSegmentSelectRef.current = onSegmentSelect;
  const onOpenPopupRef = useRef(onOpenPopup);
  onOpenPopupRef.current = onOpenPopup;

  useEffect(() => {
    if (!map) return;

    if (!visible || nodes.length === 0) {
      setTooltip(null);
      return;
    }

    const nodeLookup = new Map(nodes.map((n) => [n.id, n]));
    const predMap = new Map(predictions.map((p) => [p.segmentId, p]));
    const activeSegSet = new Set(activeRouteSegmentIds);
    const highlightNodeSet = new Set(highlightNodeIds);

    // Compute graph vertex degrees from edges
    const degreeMap = new Map<string, number>();
    for (const n of nodes) degreeMap.set(n.id, 0);
    for (const seg of segments) {
      degreeMap.set(seg.startNodeId, (degreeMap.get(seg.startNodeId) || 0) + 1);
      degreeMap.set(seg.endNodeId, (degreeMap.get(seg.endNodeId) || 0) + 1);
    }

    const maxDegree = Math.max(2, ...Array.from(degreeMap.values()));
    const radiusScale = d3.scaleSqrt().domain([1, maxDegree]).range([6.5, 11.5]);

    const capExtent = d3.extent(segments, (s) => s.capacityVph);
    const widthScale = d3
      .scaleLinear()
      .domain([capExtent[0] ?? 1000, capExtent[1] ?? 2800])
      .range([2.5, 5.5])
      .clamp(true);

    const updateTooltipPosition = (event: MouseEvent) => {
      const containerRect = map.getDiv().getBoundingClientRect();
      return {
        x: Math.min(
          Math.max(12, containerRect.width - 235),
          Math.max(12, event.clientX - containerRect.left + 14)
        ),
        y: Math.min(
          Math.max(12, containerRect.height - 140),
          Math.max(12, event.clientY - containerRect.top - 16)
        ),
      };
    };

    class GraphOverlayView extends google.maps.OverlayView {
      private svgEl: SVGSVGElement | null = null;
      private lastZoom: number | undefined;
      private zoomListener: google.maps.MapsEventListener | null = null;
      private boundsListener: google.maps.MapsEventListener | null = null;

      onAdd(): void {
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('class', 'traffix-d3-graph-svg');
        svgEl.style.position = 'absolute';
        svgEl.style.overflow = 'visible';
        svgEl.style.pointerEvents = 'none';
        svgEl.style.zIndex = '1';

        const rootG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rootG.setAttribute('class', 'd3-graph-root');
        svgEl.appendChild(rootG);

        const panes = this.getPanes();
        if (panes?.overlayMouseTarget) {
          // Insert before other overlay children so AdvancedMarkers stay clickable above the graph
          panes.overlayMouseTarget.insertBefore(svgEl, panes.overlayMouseTarget.firstChild);
        } else if (panes?.overlayLayer) {
          panes.overlayLayer.appendChild(svgEl);
        }

        this.svgEl = svgEl;
        this.lastZoom = map?.getZoom();

        if (map) {
          this.zoomListener = map.addListener('zoom_changed', () => {
            setTooltip(null);
            this.draw();
          });
          this.boundsListener = map.addListener('bounds_changed', () => {
            const z = map.getZoom();
            if (z !== this.lastZoom) {
              this.lastZoom = z;
              this.draw();
            }
          });
        }
      }

      draw(): void {
        const svgEl = this.svgEl;
        const projection = this.getProjection();
        if (!svgEl || !projection || !map) return;

        const zoom = map.getZoom() ?? 13;
        this.lastZoom = zoom;

        const svg = d3.select(svgEl);
        const root = svg.select<SVGGElement>('g.d3-graph-root');

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const trackPoint = (x: number, y: number) => {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        };

        const projectedNodes = nodes
          .map((n) => {
            const pt = projection.fromLatLngToDivPixel(
              new google.maps.LatLng(n.latitude, n.longitude)
            );
            if (!pt) return null;
            trackPoint(pt.x, pt.y);
            return {
              ...n,
              px: pt.x,
              py: pt.y,
              degree: degreeMap.get(n.id) || 0,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const projNodeMap = new Map(projectedNodes.map((n) => [n.id, n]));

        const lineGen = d3
          .line<[number, number]>()
          .x((d) => d[0])
          .y((d) => d[1]);

        const projectedEdges = segments.map((seg) => {
          const pts: Array<[number, number]> =
            seg.geometry && seg.geometry.length >= 2
              ? seg.geometry
                  .map(([lat, lng]) => {
                    const dp = projection.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng));
                    if (!dp) return null;
                    trackPoint(dp.x, dp.y);
                    return [dp.x, dp.y] as [number, number];
                  })
                  .filter((p): p is [number, number] => p !== null)
              : (() => {
                  const s = projNodeMap.get(seg.startNodeId);
                  const e = projNodeMap.get(seg.endNodeId);
                  if (!s || !e) return [];
                  return [
                    [s.px, s.py],
                    [e.px, e.py],
                  ];
                })();

          const midIdx = Math.floor(pts.length / 2);
          let midX = 0;
          let midY = 0;
          if (pts.length >= 2) {
            if (pts.length % 2 === 0) {
              midX = (pts[midIdx - 1][0] + pts[midIdx][0]) / 2;
              midY = (pts[midIdx - 1][1] + pts[midIdx][1]) / 2;
            } else {
              midX = pts[midIdx][0];
              midY = pts[midIdx][1];
            }
          }
          return {
            seg,
            pts,
            midX,
            midY,
            pathData: lineGen(pts) || '',
          };
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
          minX = 0;
          minY = 0;
          maxX = 100;
          maxY = 100;
        }

        const pad = 120;
        const originX = Math.floor(minX - pad);
        const originY = Math.floor(minY - pad);
        const svgW = Math.max(100, Math.ceil(maxX - minX + pad * 2));
        const svgH = Math.max(100, Math.ceil(maxY - minY + pad * 2));

        svgEl.style.left = `${originX}px`;
        svgEl.style.top = `${originY}px`;
        svg.attr('width', svgW).attr('height', svgH);
        root.attr('transform', `translate(${-originX}, ${-originY})`);

        let edgesLayer = root.select<SVGGElement>('g.d3-edges-layer');
        if (edgesLayer.empty()) {
          edgesLayer = root.append('g').attr('class', 'd3-edges-layer');
        }
        let badgesLayer = root.select<SVGGElement>('g.d3-edge-badges-layer');
        if (badgesLayer.empty()) {
          badgesLayer = root.append('g').attr('class', 'd3-edge-badges-layer');
        }
        let nodesLayer = root.select<SVGGElement>('g.d3-nodes-layer');
        if (nodesLayer.empty()) {
          nodesLayer = root.append('g').attr('class', 'd3-nodes-layer');
        }

        // 1. D3 Edges Data Join
        const edgeGroups = edgesLayer
          .selectAll<SVGGElement, (typeof projectedEdges)[number]>('g.d3-edge-group')
          .data(projectedEdges, (d) => d.seg.id);

        edgeGroups.exit().remove();

        const edgeEnter = edgeGroups
          .enter()
          .append('g')
          .attr('class', 'd3-edge-group');

        edgeEnter.append('path').attr('class', 'd3-edge-casing');
        edgeEnter.append('path').attr('class', 'd3-edge-core');
        edgeEnter.append('path').attr('class', 'd3-edge-hit');

        const edgeMerged = edgeEnter.merge(edgeGroups);

        const isHighlightedEdge = (segId: string) =>
          activeSegSet.has(segId) || selectedSegmentId === segId;

        edgeMerged
          .select<SVGPathElement>('path.d3-edge-casing')
          .attr('d', (d) => d.pathData)
          .attr('fill', 'none')
          .attr('stroke', (d) =>
            selectedSegmentId === d.seg.id
              ? '#F8FAFC'
              : activeSegSet.has(d.seg.id)
              ? '#38BDF8'
              : '#0F172A'
          )
          .attr('stroke-width', (d) =>
            widthScale(d.seg.capacityVph) + (isHighlightedEdge(d.seg.id) ? 5 : 3)
          )
          .attr('stroke-opacity', (d) => (isHighlightedEdge(d.seg.id) ? 0.9 : 0.45))
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .style('pointer-events', 'none');

        edgeMerged
          .select<SVGPathElement>('path.d3-edge-core')
          .attr('d', (d) => d.pathData)
          .attr('fill', 'none')
          .attr('stroke', (d) =>
            getEdgeStrokeColor(d.seg, predMap.get(d.seg.id), predictionMode)
          )
          .attr('stroke-width', (d) => widthScale(d.seg.capacityVph))
          .attr('stroke-opacity', 0.92)
          .attr('stroke-dasharray', (d) =>
            d.seg.effectiveClosureStatus === 'CLOSED'
              ? '6 6'
              : d.seg.effectiveClosureStatus === 'LANE_RESTRICTED'
              ? '10 5'
              : null
          )
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .style('pointer-events', 'none');

        edgeMerged
          .select<SVGPathElement>('path.d3-edge-hit')
          .attr('d', (d) => d.pathData)
          .attr('fill', 'none')
          .attr('stroke', 'transparent')
          .attr('stroke-width', 14)
          .style('pointer-events', interactive ? 'stroke' : 'none')
          .style('cursor', interactive ? 'pointer' : 'default')
          .on('mouseenter', function (event, d) {
            d3.select(this.parentNode as SVGGElement)
              .select('path.d3-edge-casing')
              .attr('stroke', '#FFFFFF')
              .attr('stroke-opacity', 0.9);
            const pos = updateTooltipPosition(event);
            const pred = predMap.get(d.seg.id);
            const density = predictionMode && pred ? pred.predictedDensity : d.seg.currentCongestion;
            const sName = nodeLookup.get(d.seg.startNodeId)?.externalRef || d.seg.startNodeId;
            const eName = nodeLookup.get(d.seg.endNodeId)?.externalRef || d.seg.endNodeId;
            setTooltip({
              ...pos,
              title: d.seg.name,
              subtitle: `Graph Edge ${d.seg.id} · ${sName} ↔ ${eName}`,
              rows: [
                {
                  label: 'State',
                  value: getEdgeStatusText(d.seg, pred, predictionMode),
                  tone:
                    d.seg.effectiveClosureStatus === 'CLOSED'
                      ? 'text-slate-300'
                      : d.seg.effectiveClosureStatus === 'LANE_RESTRICTED'
                      ? 'text-orange-300'
                      : 'text-emerald-300',
                },
                {
                  label: predictionMode ? 'Forecast Load' : 'Graph Load',
                  value: `${Math.round(density * 100)}% (${d.seg.congestionClass})`,
                },
                {
                  label: 'Capacity / Speed',
                  value: `${d.seg.capacityVph} vph · ${d.seg.speedLimitKmh} km/h`,
                },
                {
                  label: 'Length / Incidents',
                  value: `${d.seg.lengthMeters} m · ${d.seg.activeIncidentCount} active`,
                },
              ],
            });
          })
          .on('mousemove', function (event) {
            const pos = updateTooltipPosition(event);
            setTooltip((prev) => (prev ? { ...prev, ...pos } : null));
          })
          .on('mouseleave', function (_event, d) {
            d3.select(this.parentNode as SVGGElement)
              .select('path.d3-edge-casing')
              .attr(
                'stroke',
                selectedSegmentId === d.seg.id
                  ? '#F8FAFC'
                  : activeSegSet.has(d.seg.id)
                  ? '#38BDF8'
                  : '#0F172A'
              )
              .attr('stroke-opacity', isHighlightedEdge(d.seg.id) ? 0.9 : 0.45);
            setTooltip(null);
          })
          .on('click', (event, d) => {
            event.stopPropagation();
            const rect = map.getDiv().getBoundingClientRect();
            const containerPt = new google.maps.Point(
              event.clientX - rect.left,
              event.clientY - rect.top
            );
            const clickedLatLng = projection.fromContainerPixelToLatLng(containerPt);

            const midGeom =
              d.seg.geometry && d.seg.geometry.length > 0
                ? d.seg.geometry[Math.floor(d.seg.geometry.length / 2)]
                : null;
            const popupPos = midGeom
              ? { lat: midGeom[0], lng: midGeom[1] }
              : clickedLatLng
              ? { lat: clickedLatLng.lat(), lng: clickedLatLng.lng() }
              : { lat: 15.853, lng: 74.502 };

            const pred = predMap.get(d.seg.id);
            const statusText = getEdgeStatusText(d.seg, pred, predictionMode);

            if (onOpenPopupRef.current) {
              const lines: GraphPopupTarget['lines'] = [
                { label: 'Condition', text: statusText },
                {
                  label: 'Load',
                  text: `${Math.round(d.seg.currentCongestion * 100)}% · Limit ${
                    d.seg.speedLimitKmh
                  } km/h · ${d.seg.capacityVph} vph`,
                },
              ];
              if (pred) {
                lines.push({
                  label: `Forecast (+${pred.horizonMinutes}m)`,
                  text: `${Math.round(pred.predictedDensity * 100)}% load · Risk ${pred.riskScore}/100`,
                  tone: 'cyan',
                });
              }
              lines.push({
                text: `SIMULATED TRAFFIC DATA${d.seg.simulatedBlocked ? ' · ACTIVE SIMULATION' : ''}`,
                tone: 'cyan',
              });
              onOpenPopupRef.current({
                position: popupPos,
                title: d.seg.name,
                lines,
              });
            }

            if (onSegmentSelectRef.current) {
              const reportCoords = clickedLatLng
                ? { lat: clickedLatLng.lat(), lng: clickedLatLng.lng() }
                : popupPos;
              onSegmentSelectRef.current(d.seg, reportCoords);
            }
          });

        // 2. D3 Edge Midpoint State Badges
        const badgeData = projectedEdges.filter(
          (e) =>
            e.pts.length >= 2 &&
            (e.seg.effectiveClosureStatus === 'CLOSED' ||
              (zoom >= 13 &&
                (e.seg.effectiveClosureStatus !== 'OPEN' ||
                  e.seg.activeIncidentCount > 0 ||
                  zoom >= 14 ||
                  isHighlightedEdge(e.seg.id))))
        );

        const badgeGroups = badgesLayer
          .selectAll<SVGGElement, (typeof projectedEdges)[number]>('g.d3-edge-badge')
          .data(badgeData, (d) => d.seg.id);

        badgeGroups.exit().remove();

        const badgeEnter = badgeGroups
          .enter()
          .append('g')
          .attr('class', 'd3-edge-badge')
          .style('pointer-events', 'none');

        badgeEnter.append('rect');
        badgeEnter.append('text');

        const badgeMerged = badgeEnter.merge(badgeGroups);
        badgeMerged.attr('transform', (d) => `translate(${d.midX}, ${d.midY})`);

        badgeMerged.each(function (d) {
          const g = d3.select(this);
          const pred = predMap.get(d.seg.id);
          const density = predictionMode && pred ? pred.predictedDensity : d.seg.currentCongestion;
          const isClosed = d.seg.effectiveClosureStatus === 'CLOSED';
          const label = isClosed
            ? zoom >= 13
              ? 'CLOSED'
              : '×'
            : d.seg.activeIncidentCount > 0
            ? `${Math.round(density * 100)}% !`
            : `${Math.round(density * 100)}%`;
          const rectW = isClosed && zoom < 13 ? 16 : label.length * 6 + 10;

          g.select('rect')
            .attr('x', -rectW / 2)
            .attr('y', -9)
            .attr('width', rectW)
            .attr('height', 18)
            .attr('rx', isClosed && zoom < 13 ? 8 : 4)
            .attr('fill', isClosed ? '#374151' : '#090E1A')
            .attr(
              'stroke',
              isClosed
                ? '#9CA3AF'
                : d.seg.activeIncidentCount > 0
                ? '#F59E0B'
                : getEdgeStrokeColor(d.seg, pred, predictionMode)
            )
            .attr('stroke-width', 1.2)
            .attr('fill-opacity', 0.94);

          g.select('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.33em')
            .attr('fill', isClosed ? '#F3F4F6' : '#F8FAFC')
            .style('font-family', 'var(--font-mono)')
            .style('font-size', isClosed && zoom < 13 ? '11px' : '9px')
            .style('font-weight', '700')
            .text(label);
        });

        // 3. D3 Nodes Data Join
        const nodeGroups = nodesLayer
          .selectAll<SVGGElement, (typeof projectedNodes)[number]>('g.d3-node-group')
          .data(projectedNodes, (d) => d.id);

        nodeGroups.exit().remove();

        const nodeEnter = nodeGroups
          .enter()
          .append('g')
          .attr('class', 'd3-node-group');

        nodeEnter.append('circle').attr('class', 'd3-node-halo');
        nodeEnter.append('circle').attr('class', 'd3-node-circle');
        nodeEnter.append('text').attr('class', 'd3-node-ref');
        nodeEnter.append('text').attr('class', 'd3-node-name');

        const nodeMerged = nodeEnter.merge(nodeGroups);
        nodeMerged
          .attr('transform', (d) => `translate(${d.px}, ${d.py})`)
          .style('pointer-events', interactive ? 'all' : 'none')
          .style('cursor', interactive ? 'pointer' : 'default')
          .on('mouseenter', function (event, d) {
            d3.select(this).select('circle.d3-node-halo').attr('stroke-opacity', 1);
            const pos = updateTooltipPosition(event);
            setTooltip({
              ...pos,
              title: `${d.name} (${d.externalRef})`,
              subtitle: `Graph Vertex · ${d.id}`,
              rows: [
                { label: 'Zone', value: d.zone },
                {
                  label: 'Node Role',
                  value: d.isJunction ? 'Signalized Junction' : 'Connector Vertex',
                  tone: d.isJunction ? 'text-cyan-300' : 'text-slate-200',
                },
                { label: 'Degree (Edges)', value: `${d.degree} connected road edges` },
                {
                  label: 'Coordinates',
                  value: `${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`,
                },
              ],
            });
          })
          .on('mousemove', function (event) {
            const pos = updateTooltipPosition(event);
            setTooltip((prev) => (prev ? { ...prev, ...pos } : null));
          })
          .on('mouseleave', function (_event, d) {
            d3.select(this)
              .select('circle.d3-node-halo')
              .attr('stroke-opacity', highlightNodeSet.has(d.id) ? 0.95 : 0);
            setTooltip(null);
          })
          .on('click', (event, d) => {
            event.stopPropagation();
            if (onOpenPopupRef.current) {
              onOpenPopupRef.current({
                position: { lat: d.latitude, lng: d.longitude },
                title: `${d.name} (${d.externalRef})`,
                lines: [
                  {
                    text: `Zone: ${d.zone} · ${
                      d.isJunction ? 'Signalized Junction' : 'Graph Vertex'
                    } · ${d.degree} edges`,
                  },
                  {
                    text: `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`,
                  },
                  { text: 'SIMULATED TRAFFIC DATA', tone: 'cyan' },
                ],
              });
            }
            if (onNodeSelectRef.current) {
              onNodeSelectRef.current(d);
            }
          });

        nodeMerged
          .select<SVGCircleElement>('circle.d3-node-halo')
          .attr('r', (d) => radiusScale(Math.max(1, d.degree)) + 4.5)
          .attr('fill', 'none')
          .attr('stroke', (d) => (highlightNodeSet.has(d.id) ? '#38BDF8' : '#FFFFFF'))
          .attr('stroke-width', 2)
          .attr('stroke-opacity', (d) => (highlightNodeSet.has(d.id) ? 0.95 : 0));

        nodeMerged
          .select<SVGCircleElement>('circle.d3-node-circle')
          .attr('r', (d) => radiusScale(Math.max(1, d.degree)))
          .attr('fill', (d) =>
            highlightNodeSet.has(d.id)
              ? '#0284C7'
              : d.isJunction
              ? '#0F172A'
              : '#1E293B'
          )
          .attr('stroke', (d) =>
            highlightNodeSet.has(d.id)
              ? '#E0F2FE'
              : d.isJunction
              ? '#38BDF8'
              : '#94A3B8'
          )
          .attr('stroke-width', (d) => (d.isJunction ? 2.5 : 1.8));

        nodeMerged
          .select<SVGTextElement>('text.d3-node-ref')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.33em')
          .attr('fill', '#F8FAFC')
          .style('font-family', 'var(--font-mono)')
          .style('font-size', '8px')
          .style('font-weight', '700')
          .style('pointer-events', 'none')
          .text((d) => d.externalRef);

        nodeMerged
          .select<SVGTextElement>('text.d3-node-name')
          .attr('x', (d) => radiusScale(Math.max(1, d.degree)) + 6)
          .attr('dy', '0.33em')
          .attr('fill', '#F8FAFC')
          .style('font-family', 'var(--font-sans)')
          .style('font-size', '11px')
          .style('font-weight', '600')
          .style('paint-order', 'stroke')
          .style('stroke', '#090E1A')
          .style('stroke-width', '3.5px')
          .style('stroke-linejoin', 'round')
          .style('pointer-events', 'none')
          .style('display', zoom >= 14 ? 'block' : 'none')
          .text((d) => d.name);
      }

      onRemove(): void {
        if (this.zoomListener) {
          this.zoomListener.remove();
          this.zoomListener = null;
        }
        if (this.boundsListener) {
          this.boundsListener.remove();
          this.boundsListener = null;
        }
        if (this.svgEl) {
          this.svgEl.remove();
          this.svgEl = null;
        }
      }
    }

    const overlay = new GraphOverlayView();
    overlay.setMap(map);

    return () => {
      setTooltip(null);
      overlay.setMap(null);
    };
  }, [
    map,
    nodes,
    segments,
    predictions,
    predictionMode,
    highlightNodeIds,
    activeRouteSegmentIds,
    selectedSegmentId,
    visible,
    interactive,
  ]);

  if (!visible || !tooltip) return null;

  return (
    <div
      className="absolute z-[520] w-[225px] rounded-lg border border-slate-700 bg-[#090E1A]/95 p-2.5 text-xs shadow-xl pointer-events-none"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="font-semibold text-white truncate">{tooltip.title}</div>
      <div className="font-mono text-[10px] text-cyan-400 truncate mb-1.5">
        {tooltip.subtitle}
      </div>
      <div className="space-y-1 border-t border-slate-800 pt-1.5">
        {tooltip.rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 text-[11px]">
            <span className="text-slate-400 shrink-0">{r.label}</span>
            <span className={`font-mono text-right truncate ${r.tone || 'text-slate-200'}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
