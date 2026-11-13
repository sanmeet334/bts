import {
  RouteAlternativeDTO,
  RouteCategory,
  ScoreBreakdown,
} from '../../shared/types.js';
import { haversineMeters } from './geo.js';
import { DirectedEdge, NetworkGraph } from './graph.js';

export interface MultiFactorWeights {
  distance: number;
  time: number;
  congestion: number;
  incident: number;
  fuel: number;
  reliability: number;
}

export const DEFAULT_MULTIFACTOR_WEIGHTS: MultiFactorWeights = {
  distance: 0.18,
  time: 0.32,
  congestion: 0.22,
  incident: 0.16,
  fuel: 0.06,
  reliability: 0.06,
};

export function edgeTravelTimeMin(edge: DirectedEdge): number {
  const congestionSlowdown = 1 - edge.effectiveCongestion * 0.68;
  const lanePenalty = edge.effectiveClosureStatus === 'LANE_RESTRICTED' ? 0.65 : 1.0;
  const effectiveSpeedKmh = Math.max(
    8,
    edge.speedLimitKmh * congestionSlowdown * lanePenalty * edge.weatherFactor
  );
  return (edge.lengthMeters / 1000 / effectiveSpeedKmh) * 60;
}

export function edgeFuelLiters(edge: DirectedEdge): number {
  const km = edge.lengthMeters / 1000;
  const congestionFactor = 1 + edge.effectiveCongestion * 0.55;
  return km * 0.085 * congestionFactor;
}

function edgeMultiFactorCost(edge: DirectedEdge, w: MultiFactorWeights): number {
  // Normalized dimensionless component costs per edge
  const normDistance = edge.lengthMeters / 1500;
  const normTime = edgeTravelTimeMin(edge) / 3.0;
  const normCongestion = edge.effectiveCongestion;
  const normIncident = Math.min(1.5, edge.activeIncidentPenalty);
  const normFuel = edgeFuelLiters(edge) / 0.15;
  const reliabilityBenefit = edge.reliability;

  const cost =
    w.distance * normDistance +
    w.time * normTime +
    w.congestion * normCongestion +
    w.incident * normIncident +
    w.fuel * normFuel -
    w.reliability * (reliabilityBenefit - 0.5) * 0.5;

  return Math.max(0.01, cost);
}

interface SearchResult {
  nodeIds: string[];
  edges: DirectedEdge[];
}

export function runDijkstra(
  graph: NetworkGraph,
  originId: string,
  destinationId: string,
  costFn: (edge: DirectedEdge) => number
): SearchResult | null {
  if (!graph.nodes.has(originId) || !graph.nodes.has(destinationId)) {
    return null;
  }

  const dist = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, DirectedEdge>();
  const visited = new Set<string>();

  for (const id of graph.nodes.keys()) {
    dist.set(id, Infinity);
  }
  dist.set(originId, 0);

  while (true) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }

    if (current === null || best === Infinity) break;
    if (current === destinationId) break;
    visited.add(current);

    for (const edge of graph.adjacency.get(current) || []) {
      // Closed edges MUST be excluded completely
      if (edge.effectiveClosureStatus === 'CLOSED') continue;

      const alt = best + costFn(edge);
      if (alt < (dist.get(edge.toNodeId) ?? Infinity)) {
        dist.set(edge.toNodeId, alt);
        prevNode.set(edge.toNodeId, current);
        prevEdge.set(edge.toNodeId, edge);
      }
    }
  }

  if ((dist.get(destinationId) ?? Infinity) === Infinity) {
    return null;
  }

  const nodeIds: string[] = [];
  const edges: DirectedEdge[] = [];
  let curr: string | undefined = destinationId;
  while (curr) {
    nodeIds.unshift(curr);
    const e = prevEdge.get(curr);
    if (e) edges.unshift(e);
    curr = prevNode.get(curr);
  }

  return { nodeIds, edges };
}

export function runAStar(
  graph: NetworkGraph,
  originId: string,
  destinationId: string,
  weights: MultiFactorWeights
): SearchResult | null {
  const destNode = graph.nodes.get(destinationId);
  if (!graph.nodes.has(originId) || !destNode) return null;

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, DirectedEdge>();
  const openSet = new Set<string>([originId]);
  const closedSet = new Set<string>();

  const heuristic = (nodeId: string) => {
    const n = graph.nodes.get(nodeId);
    if (!n) return 0;
    const straightMeters = haversineMeters(
      n.latitude,
      n.longitude,
      destNode.latitude,
      destNode.longitude
    );
    // Admissible lower-bound cost based on optimistic free-flow travel
    return (straightMeters / 1500) * weights.distance * 0.5;
  };

  for (const id of graph.nodes.keys()) {
    gScore.set(id, Infinity);
    fScore.set(id, Infinity);
  }
  gScore.set(originId, 0);
  fScore.set(originId, heuristic(originId));

  while (openSet.size > 0) {
    let current: string | null = null;
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }

    if (current === null) break;
    if (current === destinationId) {
      const nodeIds: string[] = [];
      const edges: DirectedEdge[] = [];
      let curr: string | undefined = destinationId;
      while (curr) {
        nodeIds.unshift(curr);
        const e = prevEdge.get(curr);
        if (e) edges.unshift(e);
        curr = prevNode.get(curr);
      }
      return { nodeIds, edges };
    }

    openSet.delete(current);
    closedSet.add(current);

    for (const edge of graph.adjacency.get(current) || []) {
      if (edge.effectiveClosureStatus === 'CLOSED') continue;
      if (closedSet.has(edge.toNodeId)) continue;

      const tentativeG =
        (gScore.get(current) ?? Infinity) + edgeMultiFactorCost(edge, weights);
      if (tentativeG < (gScore.get(edge.toNodeId) ?? Infinity)) {
        prevNode.set(edge.toNodeId, current);
        prevEdge.set(edge.toNodeId, edge);
        gScore.set(edge.toNodeId, tentativeG);
        fScore.set(edge.toNodeId, tentativeG + heuristic(edge.toNodeId));
        openSet.add(edge.toNodeId);
      }
    }
  }

  return null;
}

function summarizeRoute(
  graph: NetworkGraph,
  result: SearchResult,
  category: RouteCategory,
  algorithm: RouteAlternativeDTO['algorithm'],
  weights: MultiFactorWeights
): RouteAlternativeDTO {
  let totalMeters = 0;
  let totalMin = 0;
  let totalFuel = 0;
  let weightedCongestion = 0;
  let weightedReliability = 0;
  let incidentPenaltySum = 0;

  const geometry: Array<[number, number]> = [];
  const relevantIncidentsMap = new Map<string, any>();

  for (let i = 0; i < result.edges.length; i++) {
    const e = result.edges[i];
    totalMeters += e.lengthMeters;
    totalMin += edgeTravelTimeMin(e);
    totalFuel += edgeFuelLiters(e);
    weightedCongestion += e.effectiveCongestion * e.lengthMeters;
    weightedReliability += e.reliability * e.lengthMeters;
    incidentPenaltySum += e.activeIncidentPenalty;

    const pts = i === 0 ? e.geometry : e.geometry.slice(1);
    geometry.push(...pts);

    for (const inc of graph.activeIncidentsBySegment.get(e.segmentId) || []) {
      relevantIncidentsMap.set(inc.id, inc);
    }
  }

  const totalDistanceKm = Number((totalMeters / 1000).toFixed(2));
  const estimatedTimeMin = Number(totalMin.toFixed(1));
  const avgCongestion =
    totalMeters > 0 ? Number((weightedCongestion / totalMeters).toFixed(2)) : 0;
  const reliabilityScore =
    totalMeters > 0 ? Number((weightedReliability / totalMeters).toFixed(2)) : 1;
  const estimatedFuelLiters = Number(totalFuel.toFixed(2));

  const distanceWeight = Number((weights.distance * (totalDistanceKm / 1.5)).toFixed(3));
  const timeWeight = Number((weights.time * (estimatedTimeMin / 3.0)).toFixed(3));
  const congestionPenalty = Number((weights.congestion * avgCongestion * 4).toFixed(3));
  const incidentPenalty = Number((weights.incident * incidentPenaltySum * 2).toFixed(3));
  const fuelEstimatePenalty = Number((weights.fuel * (estimatedFuelLiters / 0.15)).toFixed(3));
  const reliabilityBenefit = Number((weights.reliability * reliabilityScore * 2).toFixed(3));
  const totalCompositeScore = Number(
    Math.max(
      0.01,
      distanceWeight +
        timeWeight +
        congestionPenalty +
        incidentPenalty +
        fuelEstimatePenalty -
        reliabilityBenefit
    ).toFixed(3)
  );

  const scoreBreakdown: ScoreBreakdown = {
    distanceWeight,
    timeWeight,
    congestionPenalty,
    incidentPenalty,
    closurePenalty: 0,
    fuelEstimatePenalty,
    reliabilityBenefit,
    totalCompositeScore,
    weightsUsed: weights,
  };

  const importantTurns = result.nodeIds.map((nid, idx) => {
    const n = graph.nodes.get(nid)!;
    let instruction = `Pass through ${n.name}`;
    if (idx === 0) instruction = `Depart ${n.name}`;
    else if (idx === result.nodeIds.length - 1) instruction = `Arrive at ${n.name}`;
    else if (idx > 0 && idx - 1 < result.edges.length) {
      instruction = `Continue onto ${result.edges[idx - 1].segmentName} toward ${n.name}`;
    }
    return {
      nodeId: nid,
      nodeName: n.name,
      instruction,
      latitude: n.latitude,
      longitude: n.longitude,
    };
  });

  let explanation = '';
  if (category === 'SHORTEST') {
    explanation = `Shortest physical path (${totalDistanceKm} km) via Dijkstra minimum-length search. Avg corridor load ${Math.round(avgCongestion * 100)}%.`;
  } else if (category === 'FASTEST') {
    explanation = `Fastest estimated travel time (${estimatedTimeMin} min) via speed-and-congestion weighted Dijkstra search.`;
  } else {
    explanation = `Recommended by A* multi-factor scoring (composite ${totalCompositeScore}): balances ${estimatedTimeMin} min ETA, ${Math.round(avgCongestion * 100)}% congestion, ${relevantIncidentsMap.size} active incident(s), and ${Math.round(reliabilityScore * 100)}% corridor reliability.`;
  }

  return {
    category,
    algorithm,
    pathNodeIds: result.nodeIds,
    pathSegmentIds: result.edges.map((e) => e.segmentId),
    geometry,
    totalDistanceKm,
    estimatedTimeMin,
    avgCongestion,
    estimatedFuelLiters,
    reliabilityScore,
    importantTurns,
    relevantIncidents: Array.from(relevantIncidentsMap.values()),
    explanation,
    scoreBreakdown,
  };
}

export function computeRouteAlternatives(
  graph: NetworkGraph,
  originId: string,
  destinationId: string,
  customWeights?: Partial<MultiFactorWeights>
): RouteAlternativeDTO[] {
  const weights: MultiFactorWeights = {
    ...DEFAULT_MULTIFACTOR_WEIGHTS,
    ...customWeights,
  };

  const shortest = runDijkstra(graph, originId, destinationId, (e) => e.lengthMeters);
  if (!shortest) return [];

  const fastest = runDijkstra(graph, originId, destinationId, (e) => edgeTravelTimeMin(e));
  const recommended = runAStar(graph, originId, destinationId, weights);

  const alternatives: RouteAlternativeDTO[] = [];
  alternatives.push(summarizeRoute(graph, shortest, 'SHORTEST', 'DIJKSTRA_SHORTEST', weights));
  if (fastest) {
    alternatives.push(summarizeRoute(graph, fastest, 'FASTEST', 'DIJKSTRA_FASTEST', weights));
  }
  if (recommended) {
    alternatives.push(
      summarizeRoute(graph, recommended, 'RECOMMENDED', 'ASTAR_MULTIFACTOR', weights)
    );
  }

  return alternatives;
}
