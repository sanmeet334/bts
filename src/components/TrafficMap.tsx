import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, Flame, Network, SlidersHorizontal } from 'lucide-react';
import { useMapsStatus } from '../context/MapsContext';
import {
  IncidentDTO,
  JunctionDTO,
  RoadNodeDTO,
  RoadSegmentDTO,
  TrafficPredictionDTO,
} from '../shared/types';
import {
  countMatchingSegments,
  DEFAULT_HEATMAP_CONFIG,
  HEATMAP_GRADIENT_PRESETS,
  HeatmapConfig,
  loadHeatmapConfig,
  saveHeatmapConfig,
} from '../utils/heatmapUtils';
import { CongestionHeatmapOverlay } from './CongestionHeatmapOverlay';
import { D3RoadGraphOverlay, GraphPopupTarget } from './D3RoadGraphOverlay';
import { HeatmapSettingsPanel } from './HeatmapSettingsPanel';

export interface OverlayRoute {
  id: string;
  label: string;
  geometry: Array<[number, number]>;
  color: string;
  dashed?: boolean;
  weight?: number;
  trafficStatus?: string;
}

export interface MapEndpointMarker {
  lat: number;
  lng: number;
  label: string;
}

interface TrafficMapProps {
  nodes: RoadNodeDTO[];
  segments: RoadSegmentDTO[];
  incidents?: IncidentDTO[];
  junctions?: JunctionDTO[];
  predictions?: TrafficPredictionDTO[];
  predictionMode?: boolean;
  routes?: OverlayRoute[];
  startPoint?: MapEndpointMarker | null;
  endPoint?: MapEndpointMarker | null;
  selectedPin?: { lat: number; lng: number } | null;
  highlightNodeIds?: string[];
  activeRouteSegmentIds?: string[];
  selectedSegmentId?: string;
  pickMode?: 'origin' | 'destination' | null;
  fitBoundsKey?: string | number;
  onMapClick?: (lat: number, lng: number) => void;
  onNodeSelect?: (node: RoadNodeDTO) => void;
  onSegmentSelect?: (
    segment: RoadSegmentDTO,
    latLng?: { lat: number; lng: number }
  ) => void;
  onRouteSelect?: (routeId: string) => void;
  showHeatmapDefault?: boolean;
  heightClass?: string;
}

function getSegmentColor(
  seg: RoadSegmentDTO,
  pred?: TrafficPredictionDTO,
  predictionMode?: boolean
): string {
  if (seg.effectiveClosureStatus === 'CLOSED') return '#6B7280';
  if (seg.effectiveClosureStatus === 'LANE_RESTRICTED') return '#F97316';

  const density = predictionMode && pred ? pred.predictedDensity : seg.currentCongestion;
  if (density >= 0.78) return '#EF4444';
  if (density >= 0.58) return '#F97316';
  if (density >= 0.35) return '#EAB308';
  return '#22C55E';
}

function getTrafficLabel(
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

function MapPolylinesManager({
  mapId,
  segments,
  predictions,
  predictionMode,
  routes,
  showGraphLayer,
  onSegmentSelect,
  onRouteSelect,
  onOpenPopup,
}: {
  mapId: string;
  segments: RoadSegmentDTO[];
  predictions: TrafficPredictionDTO[];
  predictionMode: boolean;
  routes: OverlayRoute[];
  showGraphLayer: boolean;
  onSegmentSelect?: (segment: RoadSegmentDTO, latLng?: { lat: number; lng: number }) => void;
  onRouteSelect?: (routeId: string) => void;
  onOpenPopup: (popup: GraphPopupTarget) => void;
}) {
  const map = useMap(mapId);
  const onSegmentSelectRef = useRef(onSegmentSelect);
  onSegmentSelectRef.current = onSegmentSelect;
  const onRouteSelectRef = useRef(onRouteSelect);
  onRouteSelectRef.current = onRouteSelect;
  const onOpenPopupRef = useRef(onOpenPopup);
  onOpenPopupRef.current = onOpenPopup;

  useEffect(() => {
    if (!map) return;

    const polylines: google.maps.Polyline[] = [];
    const predBySegment = new globalThis.Map(predictions.map((p) => [p.segmentId, p]));

    // 1. Base simulated road segments when D3 graph layer is OFF
    if (!showGraphLayer) {
      for (const seg of segments) {
        if (!seg.geometry || seg.geometry.length < 2) continue;
        const pred = predBySegment.get(seg.id);
        const color = getSegmentColor(seg, pred, predictionMode);
        const isClosed = seg.effectiveClosureStatus === 'CLOSED';
        const isRestricted = seg.effectiveClosureStatus === 'LANE_RESTRICTED';
        const isDashed = isClosed || isRestricted;
        const path = seg.geometry.map(([lat, lng]) => ({ lat, lng }));

        const line = new google.maps.Polyline({
          map,
          path,
          geodesic: true,
          strokeColor: color,
          strokeWeight: routes.length > 0 ? 4 : 6,
          strokeOpacity: isDashed ? 0 : routes.length > 0 ? 0.5 : 0.88,
          zIndex: 10,
          icons: isDashed
            ? [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 0.92,
                    strokeColor: color,
                    scale: routes.length > 0 ? 2.5 : 3.2,
                  },
                  offset: '0',
                  repeat: isClosed ? '12px' : '16px',
                },
              ]
            : undefined,
        });

        const statusText = getTrafficLabel(seg, pred, predictionMode);
        line.addListener('click', (e: google.maps.MapMouseEvent) => {
          const latLng = e.latLng
            ? { lat: e.latLng.lat(), lng: e.latLng.lng() }
            : path[Math.floor(path.length / 2)];
          const lines: GraphPopupTarget['lines'] = [
            { label: 'Condition', text: statusText },
            {
              label: 'Load',
              text: `${Math.round(seg.currentCongestion * 100)}% · Limit ${seg.speedLimitKmh} km/h`,
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
            text: `SIMULATED TRAFFIC DATA${seg.simulatedBlocked ? ' · ACTIVE SIMULATION' : ''}`,
            tone: 'cyan',
          });
          onOpenPopupRef.current({
            position: latLng,
            title: seg.name,
            lines,
          });
          if (onSegmentSelectRef.current) {
            onSegmentSelectRef.current(seg, latLng);
          }
        });

        polylines.push(line);
      }
    }

    // 2. Calculated Route Overlays (non-selected first, selected on top)
    const sortedRoutes = [...routes].sort((a, b) => (a.weight || 4) - (b.weight || 4));
    for (let idx = 0; idx < sortedRoutes.length; idx++) {
      const rt = sortedRoutes[idx];
      if (!rt.geometry || rt.geometry.length < 2) continue;
      const path = rt.geometry.map(([lat, lng]) => ({ lat, lng }));
      const weight = rt.weight || 6;

      // Subtle dark outline halo for legibility on Google Maps road tiles
      if (!rt.dashed) {
        const halo = new google.maps.Polyline({
          map,
          path,
          geodesic: true,
          strokeColor: '#0F172A',
          strokeWeight: weight + 4,
          strokeOpacity: 0.45,
          clickable: false,
          zIndex: 40 + idx,
        });
        polylines.push(halo);
      }

      const routeLine = new google.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: rt.color,
        strokeWeight: weight,
        strokeOpacity: rt.dashed ? 0 : 0.96,
        zIndex: 50 + idx,
        icons: rt.dashed
          ? [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 0.85,
                  strokeColor: rt.color,
                  scale: 2.5,
                },
                offset: '0',
                repeat: '14px',
              },
            ]
          : undefined,
      });

      routeLine.addListener('click', (e: google.maps.MapMouseEvent) => {
        const pos = e.latLng
          ? { lat: e.latLng.lat(), lng: e.latLng.lng() }
          : path[Math.floor(path.length / 2)];
        const lines: GraphPopupTarget['lines'] = [];
        if (rt.trafficStatus) {
          lines.push({ label: 'Traffic Status', text: rt.trafficStatus });
        }
        lines.push({ text: 'SIMULATED TRAFFIC DATA', tone: 'cyan' });
        onOpenPopupRef.current({
          position: pos,
          title: rt.label,
          lines,
        });
        if (onRouteSelectRef.current) {
          onRouteSelectRef.current(rt.id);
        }
      });

      polylines.push(routeLine);
    }

    return () => {
      for (const p of polylines) {
        google.maps.event.clearInstanceListeners(p);
        p.setMap(null);
      }
    };
  }, [map, segments, predictions, predictionMode, routes, showGraphLayer]);

  return null;
}

function FitBoundsController({
  mapId,
  fitBoundsKey,
  routes,
  startPoint,
  endPoint,
}: {
  mapId: string;
  fitBoundsKey?: string | number;
  routes: OverlayRoute[];
  startPoint: MapEndpointMarker | null;
  endPoint: MapEndpointMarker | null;
}) {
  const map = useMap(mapId);

  useEffect(() => {
    if (!map || fitBoundsKey === undefined) return;

    const coords: Array<{ lat: number; lng: number }> = [];
    for (const rt of routes) {
      for (const [lat, lng] of rt.geometry) {
        coords.push({ lat, lng });
      }
    }
    if (startPoint) coords.push({ lat: startPoint.lat, lng: startPoint.lng });
    if (endPoint) coords.push({ lat: endPoint.lat, lng: endPoint.lng });

    if (coords.length >= 2) {
      const bounds = new google.maps.LatLngBounds();
      for (const c of coords) {
        bounds.extend(c);
      }
      map.fitBounds(bounds, 52);
      const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
        const z = map.getZoom();
        if (z !== undefined && z > 16) {
          map.setZoom(16);
        }
      });
      return () => {
        listener.remove();
      };
    } else if (coords.length === 1) {
      map.panTo(coords[0]);
      const z = map.getZoom() ?? 13;
      if (z < 14) map.setZoom(14);
    }
  }, [map, fitBoundsKey]);

  return null;
}

function MapErrorPanel({
  heightClass,
  title,
  message,
}: {
  heightClass: string;
  title: string;
  message: string;
}) {
  return (
    <div
      className={`w-full ${heightClass} flex flex-col items-center justify-center bg-[#090E1A] px-6 text-center`}
    >
      <div className="max-w-md rounded-xl border border-amber-500/40 bg-amber-950/25 p-5 space-y-2.5">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/15 text-amber-300 mx-auto">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-300 leading-relaxed">{message}</p>
        <p className="text-[11px] font-mono text-amber-300/90">
          Required env var: VITE_GOOGLE_MAPS_API_KEY (Maps JavaScript API, Places API (New), Routes API)
        </p>
      </div>
    </div>
  );
}

export const TrafficMap: React.FC<TrafficMapProps> = ({
  nodes,
  segments,
  incidents = [],
  junctions = [],
  predictions = [],
  predictionMode = false,
  routes = [],
  startPoint = null,
  endPoint = null,
  selectedPin = null,
  highlightNodeIds = [],
  activeRouteSegmentIds = [],
  selectedSegmentId,
  pickMode = null,
  fitBoundsKey,
  onMapClick,
  onNodeSelect,
  onSegmentSelect,
  onRouteSelect,
  showHeatmapDefault = true,
  heightClass = 'h-[480px]',
}) => {
  const mapId = useId();
  const map = useMap(mapId);
  const { hasApiKey, authFailureMessage, loadingStatus } = useMapsStatus();

  const [showGraphLayer, setShowGraphLayer] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(showHeatmapDefault);
  const [showHeatmapSettings, setShowHeatmapSettings] = useState(false);
  const [heatmapConfig, setHeatmapConfig] = useState<HeatmapConfig>(() => loadHeatmapConfig());
  const [heatmapAvailable, setHeatmapAvailable] = useState(true);
  const [heatmapUnavailableReason, setHeatmapUnavailableReason] = useState<string | null>(null);
  const [activePopup, setActivePopup] = useState<GraphPopupTarget | null>(null);

  const handleHeatmapConfigChange = (
    updater: HeatmapConfig | ((prev: HeatmapConfig) => HeatmapConfig)
  ) => {
    setHeatmapConfig((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveHeatmapConfig(next);
      return next;
    });
  };

  const handleResetHeatmapConfig = () => {
    const reset = { ...DEFAULT_HEATMAP_CONFIG };
    setHeatmapConfig(reset);
    saveHeatmapConfig(reset);
  };

  const matchingSegmentsCount = useMemo(
    () => countMatchingSegments(segments, predictions, predictionMode, heatmapConfig),
    [segments, predictions, predictionMode, heatmapConfig]
  );

  const activeGradientBarClass = useMemo(() => {
    if (heatmapConfig.gradientPreset === 'CUSTOM') {
      return 'bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500';
    }
    return (
      HEATMAP_GRADIENT_PRESETS.find((p) => p.id === heatmapConfig.gradientPreset)?.barClass ||
      'bg-gradient-to-r from-[#22C55E] via-[#EAB308] to-[#EF4444]'
    );
  }, [heatmapConfig.gradientPreset]);

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  // Update map cursor cleanly in pickMode
  useEffect(() => {
    if (!map) return;
    map.setOptions({
      draggableCursor: pickMode ? 'crosshair' : undefined,
    });
  }, [map, pickMode]);

  const closedCount = segments.filter((s) => s.effectiveClosureStatus === 'CLOSED').length;

  const isAuthError =
    !hasApiKey ||
    Boolean(authFailureMessage) ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE ||
    loadingStatus === APILoadingStatus.FAILED;

  return (
    <div className="relative rounded-xl border border-slate-800/80 overflow-hidden bg-[#0B1220]">
      {/* D3 Road Graph & Congestion Heatmap Layer Toggles */}
      <div className="absolute top-3 right-14 z-[510] flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (!heatmapAvailable) return;
            setShowHeatmap((v) => !v);
          }}
          disabled={!heatmapAvailable}
          title={
            heatmapAvailable
              ? 'Toggle real-time simulated congestion density heatmap'
              : heatmapUnavailableReason || 'WebGL2 unavailable in this browser'
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-sm transition-colors ${
            !heatmapAvailable
              ? 'border-slate-700/80 bg-[#090E1A]/85 text-slate-400 cursor-not-allowed'
              : showHeatmap
              ? 'border-orange-400/60 bg-[#090E1A]/90 text-orange-200 hover:bg-[#0F172A]'
              : 'border-slate-700 bg-[#090E1A]/85 text-slate-300 hover:text-white'
          }`}
        >
          <Flame
            className={`w-3.5 h-3.5 ${
              !heatmapAvailable
                ? 'text-slate-500'
                : showHeatmap
                ? 'text-orange-400'
                : 'text-slate-400'
            }`}
          />
          <span>
            Heatmap: {!heatmapAvailable ? 'N/A' : showHeatmap ? 'ON' : 'OFF'}
          </span>
        </button>

        {heatmapAvailable && (
          <button
            type="button"
            onClick={() => setShowHeatmapSettings((v) => !v)}
            aria-label="Configure heatmap settings"
            aria-expanded={showHeatmapSettings}
            title="Customize heatmap color gradient & congestion thresholds"
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-sm transition-colors ${
              showHeatmapSettings
                ? 'border-orange-400/70 bg-orange-950/80 text-orange-100'
                : 'border-slate-700 bg-[#090E1A]/85 text-slate-300 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-orange-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowGraphLayer((v) => !v)}
          title="Toggle D3 topological road graph layer (nodes & edges)"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-sm transition-colors ${
            showGraphLayer
              ? 'border-cyan-400/60 bg-[#090E1A]/90 text-cyan-200 hover:bg-[#0F172A]'
              : 'border-slate-700 bg-[#090E1A]/85 text-slate-300 hover:text-white'
          }`}
        >
          <Network className="w-3.5 h-3.5 text-cyan-400" />
          <span>D3 Graph: {showGraphLayer ? 'ON' : 'OFF'}</span>
          <span className="font-mono text-[10px] text-slate-400 border-l border-slate-700 pl-1.5">
            {nodes.length}N · {segments.length}E{closedCount > 0 ? ` · ${closedCount}X` : ''}
          </span>
        </button>
      </div>

      {showHeatmapSettings && heatmapAvailable && (
        <HeatmapSettingsPanel
          config={heatmapConfig}
          onChange={handleHeatmapConfigChange}
          onReset={handleResetHeatmapConfig}
          onClose={() => setShowHeatmapSettings(false)}
          matchingSegmentsCount={matchingSegmentsCount}
          totalSegmentsCount={segments.length}
          heatmapEnabled={showHeatmap}
          onEnableHeatmap={() => setShowHeatmap(true)}
        />
      )}

      {pickMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] rounded-lg border border-blue-400/60 bg-[#090E1A]/95 px-3.5 py-1.5 text-xs font-medium text-blue-200 shadow-lg pointer-events-none">
          {pickMode === 'origin'
            ? 'Click anywhere on the map to set STARTING LOCATION'
            : 'Click anywhere on the map to set DESTINATION'}
        </div>
      )}

      <div className={`relative w-full ${heightClass}`}>
        {isAuthError ? (
          <MapErrorPanel
            heightClass="h-full"
            title={
              !hasApiKey
                ? 'Google Maps API Key Missing'
                : loadingStatus === APILoadingStatus.FAILED
                ? 'Google Maps Failed to Load'
                : 'Google Maps API Key Invalid or Unauthorized'
            }
            message={
              !hasApiKey
                ? 'No Google Maps API key is configured. Set VITE_GOOGLE_MAPS_API_KEY in your environment configuration to display the interactive road map.'
                : authFailureMessage ||
                  'Google Maps could not authenticate or load. Verify your API key, HTTP referrer restrictions, billing status, and enabled Maps JavaScript API.'
            }
          />
        ) : (
          <>
            <GoogleMap
              id={mapId}
              mapId="DEMO_MAP_ID"
              defaultCenter={{ lat: 15.853, lng: 74.502 }}
              defaultZoom={13}
              gestureHandling="greedy"
              mapTypeControl={false}
              streetViewControl={false}
              fullscreenControl={true}
              zoomControl={true}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              onClick={(ev) => {
                setActivePopup(null);
                if (ev.detail.latLng && onMapClickRef.current) {
                  onMapClickRef.current(
                    Number(ev.detail.latLng.lat.toFixed(5)),
                    Number(ev.detail.latLng.lng.toFixed(5))
                  );
                }
              }}
              className="w-full h-full"
            >
              <FitBoundsController
                mapId={mapId}
                fitBoundsKey={fitBoundsKey}
                routes={routes}
                startPoint={startPoint}
                endPoint={endPoint}
              />

              <CongestionHeatmapOverlay
                mapId={mapId}
                segments={segments}
                incidents={incidents}
                predictions={predictions}
                predictionMode={predictionMode}
                visible={showHeatmap}
                config={heatmapConfig}
                onAvailabilityChange={(available, reason) => {
                  setHeatmapAvailable(available);
                  setHeatmapUnavailableReason(reason || null);
                }}
              />

              <MapPolylinesManager
                mapId={mapId}
                segments={segments}
                predictions={predictions}
                predictionMode={predictionMode}
                routes={routes}
                showGraphLayer={showGraphLayer}
                onSegmentSelect={onSegmentSelect}
                onRouteSelect={onRouteSelect}
                onOpenPopup={setActivePopup}
              />

              {/* Base Road Nodes when D3 Graph Overlay is OFF */}
              {!showGraphLayer &&
                nodes.map((n) => {
                  const isHighlighted = highlightNodeIds.includes(n.id);
                  const size = isHighlighted ? 14 : n.isJunction ? 11 : 8;
                  const fill = isHighlighted ? '#0284C7' : n.isJunction ? '#2563EB' : '#64748B';
                  const border = isHighlighted ? '#0F172A' : '#1E293B';
                  return (
                    <AdvancedMarker
                      key={`node-${n.id}`}
                      position={{ lat: n.latitude, lng: n.longitude }}
                      title={`${n.name} (${n.externalRef})`}
                      zIndex={20}
                      onClick={() => {
                        setActivePopup({
                          position: { lat: n.latitude, lng: n.longitude },
                          title: n.name,
                          lines: [
                            { text: `Zone: ${n.zone} · Ref: ${n.externalRef}` },
                            { text: 'SIMULATED TRAFFIC DATA', tone: 'cyan' },
                          ],
                        });
                        if (onNodeSelect) onNodeSelect(n);
                      }}
                    >
                      <div
                        style={{
                          width: size,
                          height: size,
                          borderRadius: '9999px',
                          backgroundColor: fill,
                          border: `${isHighlighted ? 2.5 : 1.5}px solid ${border}`,
                          cursor: 'pointer',
                          transform: 'translate(0, 50%)',
                        }}
                      />
                    </AdvancedMarker>
                  );
                })}

              {/* Signalized Junctions */}
              {junctions.map((j) => (
                <AdvancedMarker
                  key={`junc-${j.id}`}
                  position={{ lat: j.latitude, lng: j.longitude }}
                  title={j.name}
                  zIndex={35}
                  onClick={() =>
                    setActivePopup({
                      position: { lat: j.latitude, lng: j.longitude },
                      title: j.name,
                      lines: [
                        {
                          text: `Density: ${Math.round(j.latestDensity * 100)}% · Queue: ${
                            j.latestQueueLength
                          } veh`,
                        },
                        { text: 'SIMULATED TRAFFIC DATA', tone: 'cyan' },
                      ],
                    })
                  }
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '9999px',
                      backgroundColor: '#06B6D4',
                      border: '2px solid #0E7490',
                      opacity: 0.85,
                      cursor: 'pointer',
                      transform: 'translate(0, 50%)',
                    }}
                  />
                </AdvancedMarker>
              ))}

              {/* Incident Markers */}
              {incidents
                .filter((inc) => inc.status !== 'REJECTED')
                .map((inc) => {
                  const incColor =
                    inc.severity === 'CRITICAL' || inc.status === 'VERIFIED'
                      ? '#EF4444'
                      : inc.status === 'RESOLVED'
                      ? '#22C55E'
                      : '#F59E0B';
                  return (
                    <AdvancedMarker
                      key={`inc-${inc.id}`}
                      position={{ lat: inc.latitude, lng: inc.longitude }}
                      title={`${inc.type} · ${inc.severity}`}
                      zIndex={60}
                      onClick={() =>
                        setActivePopup({
                          position: { lat: inc.latitude, lng: inc.longitude },
                          title: `${inc.type} · ${inc.severity}`,
                          lines: [
                            { text: inc.description },
                            {
                              text: `Status: ${inc.status}${
                                inc.possibleDuplicate ? ' · Possible Duplicate' : ''
                              }`,
                            },
                            { text: 'SIMULATED TRAFFIC DATA', tone: 'cyan' },
                          ],
                        })
                      }
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '9999px',
                          backgroundColor: incColor,
                          border: '2px solid #0F172A',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                          cursor: 'pointer',
                          transform: 'translate(0, 50%)',
                        }}
                      />
                    </AdvancedMarker>
                  );
                })}

              {/* Selected Incident Report Pin */}
              {selectedPin && (
                <AdvancedMarker
                  position={{ lat: selectedPin.lat, lng: selectedPin.lng }}
                  title="Selected Report Location"
                  zIndex={80}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '9999px',
                      backgroundColor: '#2563EB',
                      border: '3px solid #FFFFFF',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                      transform: 'translate(0, 50%)',
                    }}
                  />
                </AdvancedMarker>
              )}

              {/* Distinct START Marker */}
              {startPoint && (
                <AdvancedMarker
                  position={{ lat: startPoint.lat, lng: startPoint.lng }}
                  title={`START: ${startPoint.label}`}
                  zIndex={900}
                  onClick={() =>
                    setActivePopup({
                      position: { lat: startPoint.lat, lng: startPoint.lng },
                      title: 'START LOCATION',
                      lines: [
                        { text: startPoint.label, tone: 'emerald' },
                        {
                          text: `${startPoint.lat.toFixed(5)}, ${startPoint.lng.toFixed(5)}`,
                        },
                      ],
                    })
                  }
                >
                  <div className="flex flex-col items-center cursor-pointer">
                    <span
                      style={{
                        background: '#16A34A',
                        color: '#FFFFFF',
                        border: '2px solid #BBF7D0',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      START
                    </span>
                    <span
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: '6px solid #16A34A',
                        marginTop: '-1px',
                      }}
                    />
                  </div>
                </AdvancedMarker>
              )}

              {/* Distinct DESTINATION Marker */}
              {endPoint && (
                <AdvancedMarker
                  position={{ lat: endPoint.lat, lng: endPoint.lng }}
                  title={`DEST: ${endPoint.label}`}
                  zIndex={950}
                  onClick={() =>
                    setActivePopup({
                      position: { lat: endPoint.lat, lng: endPoint.lng },
                      title: 'DESTINATION',
                      lines: [
                        { text: endPoint.label, tone: 'rose' },
                        {
                          text: `${endPoint.lat.toFixed(5)}, ${endPoint.lng.toFixed(5)}`,
                        },
                      ],
                    })
                  }
                >
                  <div className="flex flex-col items-center cursor-pointer">
                    <span
                      style={{
                        background: '#DC2626',
                        color: '#FFFFFF',
                        border: '2px solid #FECACA',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      DEST
                    </span>
                    <span
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: '6px solid #DC2626',
                        marginTop: '-1px',
                      }}
                    />
                  </div>
                </AdvancedMarker>
              )}

              {/* Shared InfoWindow */}
              {activePopup && (
                <InfoWindow
                  position={activePopup.position}
                  onCloseClick={() => setActivePopup(null)}
                >
                  <div className="text-xs space-y-1 min-w-[190px] max-w-[250px] text-slate-100">
                    <div className="font-semibold text-white">{activePopup.title}</div>
                    {activePopup.subtitle && (
                      <div className="text-[11px] font-mono text-slate-400">
                        {activePopup.subtitle}
                      </div>
                    )}
                    {activePopup.lines.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.tone === 'cyan'
                            ? 'text-[11px] text-cyan-300 font-mono'
                            : line.tone === 'emerald'
                            ? 'text-emerald-300 font-medium'
                            : line.tone === 'rose'
                            ? 'text-rose-300 font-medium'
                            : line.tone === 'amber'
                            ? 'text-amber-300'
                            : 'text-slate-200'
                        }
                      >
                        {line.label ? (
                          <>
                            <span className="text-slate-400">{line.label}: </span>
                            <span className="font-mono font-semibold">{line.text}</span>
                          </>
                        ) : (
                          line.text
                        )}
                      </div>
                    ))}
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>

            {/* D3 Road Graph Overlay (renders into Google Maps overlayMouseTarget pane + hover tooltip in container) */}
            <D3RoadGraphOverlay
              map={map}
              nodes={nodes}
              segments={segments}
              predictions={predictions}
              predictionMode={predictionMode}
              highlightNodeIds={highlightNodeIds}
              activeRouteSegmentIds={activeRouteSegmentIds}
              selectedSegmentId={selectedSegmentId}
              visible={showGraphLayer}
              interactive={!pickMode}
              onNodeSelect={onNodeSelect}
              onSegmentSelect={onSegmentSelect}
              onOpenPopup={setActivePopup}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-[#0C1322] px-4 py-2.5 text-[11px] text-slate-300">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#22C55E]" /> Low traffic
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#EAB308]" /> Moderate traffic
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#F97316]" /> Heavy traffic
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#EF4444]" /> Severe traffic
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#6B7280]" /> Closed road
          </span>
          {showGraphLayer && (
            <span className="flex items-center gap-1.5 text-cyan-200">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[#38BDF8] bg-[#0F172A]" />{' '}
              Graph node
            </span>
          )}
          {showHeatmap && heatmapAvailable && (
            <span className="flex items-center gap-1.5 text-orange-200">
              <span className={`inline-block w-8 h-2.5 rounded-sm ${activeGradientBarClass}`} />{' '}
              <span>
                Heatmap:{' '}
                {heatmapConfig.metricMode === 'DELAY'
                  ? `Delay ≥ ${heatmapConfig.delayThresholdMin.toFixed(1)}m`
                  : `Density ≥ ${heatmapConfig.densityThresholdPct}%`}{' '}
                (Simulated)
              </span>
            </span>
          )}
        </div>
        <span className="font-mono text-cyan-400">
          {predictionMode ? 'SIMULATED TRAFFIC DATA · 15/30M FORECAST' : 'SIMULATED TRAFFIC DATA'}
        </span>
      </div>
    </div>
  );
};
