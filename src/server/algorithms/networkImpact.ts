import Database from 'better-sqlite3';
import {
  NetworkImpactResultDTO,
  RoadClosureStatus,
} from '../../shared/types.js';
import { buildEffectiveGraph } from './graph.js';
import { computeRouteAlternatives } from './pathfinding.js';

export function analyzeNetworkImpact(
  db: Database.Database,
  incidentId: string,
  targetSegmentId: string,
  simulatedStatus?: RoadClosureStatus
): NetworkImpactResultDTO {
  const baselineGraph = buildEffectiveGraph(db);
  const seg = baselineGraph.segments.find((s) => s.id === targetSegmentId);
  if (!seg) {
    throw new Error(`Road segment ${targetSegmentId} not found`);
  }

  // BFS k-hop downstream segment impact up to 2 hops from startNode and endNode
  const visitedNodes = new Set<string>([seg.startNodeId, seg.endNodeId]);
  const queue: Array<{ nodeId: string; hop: number }> = [
    { nodeId: seg.startNodeId, hop: 1 },
    { nodeId: seg.endNodeId, hop: 1 },
  ];

  const downstreamMap = new Map<
    string,
    { segmentId: string; segmentName: string; hopDistance: number; estimatedLoadIncreasePct: number; projectedCongestion: number }
  >();

  while (queue.length > 0) {
    const { nodeId, hop } = queue.shift()!;
    if (hop > 2) continue;

    for (const edge of baselineGraph.adjacency.get(nodeId) || []) {
      if (edge.segmentId === targetSegmentId) continue;
      const loadIncrease = hop === 1 ? 26 : 12;
      const projected = Math.min(
        0.98,
        Number((edge.effectiveCongestion + loadIncrease / 100).toFixed(2))
      );

      const existing = downstreamMap.get(edge.segmentId);
      if (!existing || hop < existing.hopDistance) {
        downstreamMap.set(edge.segmentId, {
          segmentId: edge.segmentId,
          segmentName: edge.segmentName,
          hopDistance: hop,
          estimatedLoadIncreasePct: loadIncrease,
          projectedCongestion: projected,
        });
      }

      if (!visitedNodes.has(edge.toNodeId) && hop < 2) {
        visitedNodes.add(edge.toNodeId);
        queue.push({ nodeId: edge.toNodeId, hop: hop + 1 });
      }
    }
  }

  // Evaluate detour availability when targetSegmentId is closed
  const closureToTest: RoadClosureStatus = simulatedStatus || 'CLOSED';
  const impactedGraph = buildEffectiveGraph(db, {
    overrideClosures: [{ segmentId: targetSegmentId, status: closureToTest }],
  });
  const openBaselineGraph = buildEffectiveGraph(db, {
    overrideClosures: [{ segmentId: targetSegmentId, status: 'OPEN' }],
  });

  const normalRoutes = computeRouteAlternatives(
    openBaselineGraph,
    seg.startNodeId,
    seg.endNodeId
  );
  const detourRoutes = computeRouteAlternatives(
    impactedGraph,
    seg.startNodeId,
    seg.endNodeId
  );

  const normalFastest = normalRoutes.find((r) => r.category === 'FASTEST') || normalRoutes[0];
  const detourFastest = detourRoutes.find((r) => r.category === 'FASTEST') || detourRoutes[0];

  const alternativeDetours: NetworkImpactResultDTO['alternativeDetours'] = [];
  let addedTime = 0;

  if (detourFastest && normalFastest) {
    addedTime = Number(
      Math.max(0.5, detourFastest.estimatedTimeMin - normalFastest.estimatedTimeMin).toFixed(1)
    );
    const startName = baselineGraph.nodes.get(seg.startNodeId)?.name || seg.startNodeId;
    const endName = baselineGraph.nodes.get(seg.endNodeId)?.name || seg.endNodeId;
    alternativeDetours.push({
      fromNodeName: startName,
      toNodeName: endName,
      detourDistanceKm: detourFastest.totalDistanceKm,
      addedTimeMin: addedTime,
      segmentNames: detourFastest.pathSegmentIds.map(
        (id) => baselineGraph.segments.find((s) => s.id === id)?.name || id
      ),
    });
  }

  const downstreamSegments = Array.from(downstreamMap.values()).sort(
    (a, b) => a.hopDistance - b.hopDistance || b.projectedCongestion - a.projectedCongestion
  );

  const networkConnectivityIntact = detourRoutes.length > 0;
  const summary = networkConnectivityIntact
    ? `${seg.name} impact spills over to ${downstreamSegments.length} connected corridor(s); verified detour adds ~${addedTime} min.`
    : `${seg.name} acts as a critical cut-edge; full closure disconnects endpoints without a direct local bypass.`;

  return {
    incidentId,
    directlyAffectedSegment: seg,
    downstreamSegments: downstreamSegments.slice(0, 8),
    alternativeDetours,
    estimatedAddedTravelTimeMin: addedTime,
    networkConnectivityIntact,
    summary,
    isSimulated: true,
  };
}
