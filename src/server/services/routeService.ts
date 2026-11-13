import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  CongestionClass,
  RoadNodeDTO,
  RoadSegmentDTO,
  RouteAlternativeDTO,
  RouteAlternativesResultDTO,
  RouteCategory,
  ScoreBreakdown,
} from '../../shared/types.js';
import { haversineMeters, pointToSegmentDistanceMeters } from '../algorithms/geo.js';
import { buildEffectiveGraph, classifyCongestion, NetworkGraph } from '../algorithms/graph.js';
import {
  computeRouteAlternatives,
  DEFAULT_MULTIFACTOR_WEIGHTS,
  MultiFactorWeights,
} from '../algorithms/pathfinding.js';
import {
  ExternalParsedRoute,
  fetchGoogleRoutes,
  findNearestRoadNode,
  getRoutingProviderMetadata,
  reverseGeocodeCoords,
  searchLocations,
} from '../providers/routingProvider.js';
import { AppError, badRequest, notFound, unprocessable } from '../utils/errors.js';

export function getNetworkSnapshot(db: Database.Database): {
  nodes: RoadNodeDTO[];
  segments: RoadSegmentDTO[];
  activeClosuresCount: number;
  activeSimulationsCount: number;
  provider: ReturnType<typeof getRoutingProviderMetadata>;
} {
  const graph = buildEffectiveGraph(db);
  return {
    nodes: Array.from(graph.nodes.values()),
    segments: graph.segments,
    activeClosuresCount: graph.activeClosuresCount,
    activeSimulationsCount: graph.activeSimulationsCount,
    provider: getRoutingProviderMetadata(),
  };
}

export async function geocodeQuery(db: Database.Database, q: string) {
  const results = await searchLocations(db, q);
  return {
    results,
    provider: getRoutingProviderMetadata(),
  };
}

export async function reverseGeocodeQuery(db: Database.Database, lat: number, lng: number) {
  return reverseGeocodeCoords(db, lat, lng);
}

function enrichLocalAlternative(
  alt: RouteAlternativeDTO,
  graph: NetworkGraph
): RouteAlternativeDTO {
  const segMap = new Map(graph.segments.map((s) => [s.id, s]));
  const closureWarnings: string[] = [];
  for (const segId of alt.pathSegmentIds) {
    const seg = segMap.get(segId);
    if (seg?.effectiveClosureStatus === 'LANE_RESTRICTED') {
      closureWarnings.push(`${seg.name}: Lane restricted (simulated)`);
    }
  }
  const trafficLevel: CongestionClass = classifyCongestion(alt.avgCongestion);
  const routeName =
    alt.category === 'RECOMMENDED'
      ? 'Recommended Smart Route'
      : alt.category === 'FASTEST'
      ? 'Fastest Route'
      : 'Shortest Distance Route';

  return {
    ...alt,
    routeName,
    trafficLevel,
    incidentCount: alt.relevantIncidents.length,
    closureWarnings,
    intersectsClosedRoad: false,
    isRecommended: alt.category === 'RECOMMENDED',
  };
}

function sampleGeometryPoints(
  geometry: Array<[number, number]>,
  maxPoints = 65
): Array<[number, number]> {
  if (geometry.length <= maxPoints) return geometry;
  const sampled: Array<[number, number]> = [];
  const step = (geometry.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(geometry[Math.round(i * step)]);
  }
  return sampled;
}

function minDistanceToSegment(pts: Array<[number, number]>, seg: RoadSegmentDTO): number {
  let minD = Infinity;
  for (const [pLat, pLng] of pts) {
    for (let i = 0; i < seg.geometry.length - 1; i++) {
      const [aLat, aLng] = seg.geometry[i];
      const [bLat, bLng] = seg.geometry[i + 1];
      const d = pointToSegmentDistanceMeters(pLat, pLng, aLat, aLng, bLat, bLng);
      if (d < minD) minD = d;
    }
  }
  return minD;
}

function evaluateExternalRouteAgainstGraph(
  route: ExternalParsedRoute,
  graph: NetworkGraph,
  db: Database.Database,
  weights: MultiFactorWeights,
  algorithm: 'GOOGLE_ROUTES_DRIVING' | 'GOOGLE_ROUTES_ALTERNATIVE'
): Omit<RouteAlternativeDTO, 'category' | 'routeName' | 'isRecommended'> {
  const sampledPts = sampleGeometryPoints(route.geometry, 70);
  const matchedSegments: RoadSegmentDTO[] = [];
  const closureWarnings: string[] = [];
  let intersectsClosedRoad = false;

  for (const seg of graph.segments) {
    const dist = minDistanceToSegment(sampledPts, seg);
    if (dist <= 85) {
      matchedSegments.push(seg);
      if (seg.effectiveClosureStatus === 'CLOSED') {
        intersectsClosedRoad = true;
        closureWarnings.push(`${seg.name} is CLOSED (simulated closure/incident)`);
      } else if (seg.effectiveClosureStatus === 'LANE_RESTRICTED') {
        closureWarnings.push(`${seg.name} has LANE RESTRICTION`);
      }
    }
  }

  const verifiedIncidents = db
    .prepare(
      `SELECT id, type, severity, status, description, latitude, longitude, road_segment_id FROM incidents WHERE status = 'VERIFIED'`
    )
    .all() as Array<any>;

  const relevantIncidentsMap = new Map<
    string,
    { id: string; type: any; severity: any; status: any; description: string }
  >();

  for (const seg of matchedSegments) {
    for (const inc of graph.activeIncidentsBySegment.get(seg.id) || []) {
      relevantIncidentsMap.set(inc.id, inc);
    }
  }

  for (const inc of verifiedIncidents) {
    if (relevantIncidentsMap.has(inc.id)) continue;
    for (let i = 0; i < sampledPts.length - 1; i++) {
      const [aLat, aLng] = sampledPts[i];
      const [bLat, bLng] = sampledPts[i + 1];
      const d = pointToSegmentDistanceMeters(inc.latitude, inc.longitude, aLat, aLng, bLat, bLng);
      if (d <= 110) {
        relevantIncidentsMap.set(inc.id, {
          id: inc.id,
          type: inc.type,
          severity: inc.severity,
          status: inc.status,
          description: inc.description,
        });
        break;
      }
    }
  }

  const relevantIncidents = Array.from(relevantIncidentsMap.values());

  // Simulated traffic density: average across matched local segments or deterministic baseline
  const avgCongestion =
    matchedSegments.length > 0
      ? Number(
          (
            matchedSegments.reduce((sum, s) => sum + s.currentCongestion, 0) /
            matchedSegments.length
          ).toFixed(2)
        )
      : 0.24;

  const trafficLevel = classifyCongestion(avgCongestion);
  const totalDistanceKm = Number((route.distanceMeters / 1000).toFixed(2));

  const congestionTimeMultiplier = 1 + Math.max(0, avgCongestion - 0.2) * 0.55;
  const incidentDelayMin = relevantIncidents.reduce((sum, inc) => {
    if (inc.severity === 'CRITICAL') return sum + 6;
    if (inc.severity === 'HIGH') return sum + 4;
    if (inc.severity === 'MEDIUM') return sum + 2;
    return sum + 1;
  }, 0);
  const baseMin = route.durationSeconds / 60;
  const estimatedTimeMin = Number(
    Math.max(0.5, baseMin * congestionTimeMultiplier + incidentDelayMin).toFixed(1)
  );

  const congestionFuelFactor = 1 + avgCongestion * 0.55;
  const estimatedFuelLiters = Number((totalDistanceKm * 0.085 * congestionFuelFactor).toFixed(2));
  const reliabilityScore = Number(
    Math.max(
      0.1,
      1.0 -
        avgCongestion * 0.45 -
        Math.min(0.45, relevantIncidents.length * 0.18) -
        (intersectsClosedRoad ? 0.5 : 0)
    ).toFixed(2)
  );

  const incidentPenaltyRaw = relevantIncidents.reduce((sum, inc) => {
    if (inc.severity === 'CRITICAL') return sum + 1.0;
    if (inc.severity === 'HIGH') return sum + 0.55;
    return sum + 0.25;
  }, 0);

  const distanceWeight = Number((weights.distance * (totalDistanceKm / 1.5)).toFixed(3));
  const timeWeight = Number((weights.time * (estimatedTimeMin / 3.0)).toFixed(3));
  const congestionPenalty = Number((weights.congestion * avgCongestion * 4).toFixed(3));
  const incidentPenalty = Number((weights.incident * incidentPenaltyRaw * 2).toFixed(3));
  const closurePenalty = intersectsClosedRoad ? 50 : 0;
  const fuelEstimatePenalty = Number((weights.fuel * (estimatedFuelLiters / 0.15)).toFixed(3));
  const reliabilityBenefit = Number((weights.reliability * reliabilityScore * 2).toFixed(3));
  const totalCompositeScore = Number(
    Math.max(
      0.01,
      distanceWeight +
        timeWeight +
        congestionPenalty +
        incidentPenalty +
        closurePenalty +
        fuelEstimatePenalty -
        reliabilityBenefit
    ).toFixed(3)
  );

  const scoreBreakdown: ScoreBreakdown = {
    distanceWeight,
    timeWeight,
    congestionPenalty,
    incidentPenalty,
    closurePenalty,
    fuelEstimatePenalty,
    reliabilityBenefit,
    totalCompositeScore,
    weightsUsed: weights,
  };

  const importantTurns = route.steps.map((st, idx) => ({
    nodeId: `step-${idx}`,
    nodeName: st.name || `Step ${idx + 1}`,
    instruction:
      st.distanceMeters > 0
        ? `${st.instruction} (${
            st.distanceMeters >= 1000
              ? `${(st.distanceMeters / 1000).toFixed(1)} km`
              : `${st.distanceMeters} m`
          })`
        : st.instruction,
    latitude: st.latitude,
    longitude: st.longitude,
    distanceMeters: st.distanceMeters,
  }));

  const explanationParts = [
    `${totalDistanceKm} km via ${route.summary || 'Google Maps road geometry'}`,
    `${estimatedTimeMin} min ETA (${trafficLevel.toLowerCase()} simulated traffic, ${Math.round(
      avgCongestion * 100
    )}% load)`,
    `${relevantIncidents.length} active incident(s)`,
  ];
  if (intersectsClosedRoad) {
    explanationParts.push('WARNING: Crosses locally closed road segment');
  }

  return {
    algorithm,
    pathNodeIds: [],
    pathSegmentIds: matchedSegments.map((s) => s.id),
    geometry: route.geometry,
    totalDistanceKm,
    estimatedTimeMin,
    avgCongestion,
    trafficLevel,
    incidentCount: relevantIncidents.length,
    closureWarnings,
    intersectsClosedRoad,
    estimatedFuelLiters,
    reliabilityScore,
    importantTurns,
    relevantIncidents,
    explanation: explanationParts.join(' · '),
    scoreBreakdown,
  };
}

function rankEvaluatedAlternatives(
  evaluated: Array<Omit<RouteAlternativeDTO, 'category' | 'routeName' | 'isRecommended'>>
): RouteAlternativeDTO[] {
  const byComposite = [...evaluated].sort(
    (a, b) => a.scoreBreakdown.totalCompositeScore - b.scoreBreakdown.totalCompositeScore
  );
  const byFastest = [...evaluated].sort((a, b) => {
    if (Boolean(a.intersectsClosedRoad) !== Boolean(b.intersectsClosedRoad)) {
      return a.intersectsClosedRoad ? 1 : -1;
    }
    return a.estimatedTimeMin - b.estimatedTimeMin;
  });
  const byShortest = [...evaluated].sort((a, b) => a.totalDistanceKm - b.totalDistanceKm);

  const usedSet = new Set<(typeof evaluated)[number]>();
  const categorized: RouteAlternativeDTO[] = [];

  const recPick = byComposite[0];
  usedSet.add(recPick);
  categorized.push({
    ...recPick,
    category: 'RECOMMENDED',
    routeName: recPick.intersectsClosedRoad
      ? 'Route (Closure Warning)'
      : 'Recommended Smart Route',
    isRecommended: true,
    explanation: `Recommended by multi-factor scoring (score ${recPick.scoreBreakdown.totalCompositeScore}): ${recPick.explanation}`,
  });

  const fastPick = byFastest.find((x) => !usedSet.has(x));
  if (fastPick) {
    usedSet.add(fastPick);
    categorized.push({
      ...fastPick,
      category: 'FASTEST',
      routeName: 'Fastest Alternative',
      isRecommended: false,
    });
  }

  const shortPick = byShortest.find((x) => !usedSet.has(x));
  if (shortPick) {
    usedSet.add(shortPick);
    categorized.push({
      ...shortPick,
      category: 'SHORTEST',
      routeName: 'Shortest Distance Alternative',
      isRecommended: false,
    });
  }

  const order: Record<RouteCategory, number> = {
    RECOMMENDED: 0,
    FASTEST: 1,
    SHORTEST: 2,
  };
  categorized.sort((a, b) => order[a.category] - order[b.category]);
  return categorized;
}

export function evaluateExternalRoutes(
  db: Database.Database,
  params: {
    originLat: number;
    originLng: number;
    originLabel?: string;
    originNodeId?: string;
    destinationLat: number;
    destinationLng: number;
    destinationLabel?: string;
    destinationNodeId?: string;
    distanceWeight?: number;
    timeWeight?: number;
    congestionWeight?: number;
    incidentWeight?: number;
    candidates: Array<{
      distanceMeters: number;
      durationSeconds: number;
      geometry: Array<[number, number]>;
      summary?: string;
      steps?: Array<{
        instruction: string;
        name?: string;
        distanceMeters?: number;
        durationSec?: number;
        latitude: number;
        longitude: number;
      }>;
    }>;
  }
): RouteAlternativesResultDTO {
  const graph = buildEffectiveGraph(db);
  const customWeights: Partial<MultiFactorWeights> = {};
  if (params.distanceWeight !== undefined) customWeights.distance = params.distanceWeight;
  if (params.timeWeight !== undefined) customWeights.time = params.timeWeight;
  if (params.congestionWeight !== undefined) customWeights.congestion = params.congestionWeight;
  if (params.incidentWeight !== undefined) customWeights.incident = params.incidentWeight;
  const weights: MultiFactorWeights = { ...DEFAULT_MULTIFACTOR_WEIGHTS, ...customWeights };

  const nearestOrigin = findNearestRoadNode(db, params.originLat, params.originLng);
  const nearestDest = findNearestRoadNode(db, params.destinationLat, params.destinationLng);

  const originDto: RoadNodeDTO & { label?: string; source?: string } = {
    id: params.originNodeId || nearestOrigin?.node.id || 'custom-origin',
    externalRef: nearestOrigin?.node.externalRef || 'GPS-START',
    name: params.originLabel || `${params.originLat.toFixed(5)}, ${params.originLng.toFixed(5)}`,
    label: params.originLabel || `${params.originLat.toFixed(5)}, ${params.originLng.toFixed(5)}`,
    latitude: params.originLat,
    longitude: params.originLng,
    isJunction: false,
    zone: nearestOrigin && nearestOrigin.distanceMeters < 10000 ? nearestOrigin.node.zone : 'Custom',
    source: 'GOOGLE_ROUTES',
  };

  const destDto: RoadNodeDTO & { label?: string; source?: string } = {
    id: params.destinationNodeId || nearestDest?.node.id || 'custom-dest',
    externalRef: nearestDest?.node.externalRef || 'GPS-DEST',
    name:
      params.destinationLabel ||
      `${params.destinationLat.toFixed(5)}, ${params.destinationLng.toFixed(5)}`,
    label:
      params.destinationLabel ||
      `${params.destinationLat.toFixed(5)}, ${params.destinationLng.toFixed(5)}`,
    latitude: params.destinationLat,
    longitude: params.destinationLng,
    isJunction: false,
    zone: nearestDest && nearestDest.distanceMeters < 10000 ? nearestDest.node.zone : 'Custom',
    source: 'GOOGLE_ROUTES',
  };

  const evaluated = params.candidates.map((c, idx) =>
    evaluateExternalRouteAgainstGraph(
      {
        distanceMeters: c.distanceMeters,
        durationSeconds: c.durationSeconds,
        geometry: c.geometry,
        summary: c.summary || `Google Road Route ${idx + 1}`,
        steps: (c.steps || []).map((st) => ({
          instruction: st.instruction,
          name: st.name || 'Route Step',
          distanceMeters: st.distanceMeters || 0,
          durationSec: st.durationSec || 0,
          latitude: st.latitude,
          longitude: st.longitude,
        })),
      },
      graph,
      db,
      weights,
      idx === 0 ? 'GOOGLE_ROUTES_DRIVING' : 'GOOGLE_ROUTES_ALTERNATIVE'
    )
  );

  return {
    origin: originDto,
    destination: destDto,
    alternatives: rankEvaluatedAlternatives(evaluated),
    recalculatedDueToNetworkEvent:
      graph.activeClosuresCount > 0 || graph.activeSimulationsCount > 0,
    activeClosuresCount: graph.activeClosuresCount,
    activeSimulationsCount: graph.activeSimulationsCount,
    provider: getRoutingProviderMetadata('GOOGLE_ROUTES_WITH_SIMULATED_TRAFFIC'),
  };
}

export async function calculateRoutes(
  db: Database.Database,
  params: {
    originNodeId?: string;
    destinationNodeId?: string;
    originLat?: number;
    originLng?: number;
    originLabel?: string;
    destinationLat?: number;
    destinationLng?: number;
    destinationLabel?: string;
    distanceWeight?: number;
    timeWeight?: number;
    congestionWeight?: number;
    incidentWeight?: number;
  }
): Promise<RouteAlternativesResultDTO> {
  const graph = buildEffectiveGraph(db);

  const customWeights: Partial<MultiFactorWeights> = {};
  if (params.distanceWeight !== undefined) customWeights.distance = params.distanceWeight;
  if (params.timeWeight !== undefined) customWeights.time = params.timeWeight;
  if (params.congestionWeight !== undefined)
    customWeights.congestion = params.congestionWeight;
  if (params.incidentWeight !== undefined) customWeights.incident = params.incidentWeight;
  const weights: MultiFactorWeights = { ...DEFAULT_MULTIFACTOR_WEIGHTS, ...customWeights };

  const hasCoords =
    params.originLat !== undefined &&
    params.originLng !== undefined &&
    params.destinationLat !== undefined &&
    params.destinationLng !== undefined;

  // Path 1: Arbitrary coordinate routing via Google Routes API + TRAFFIX simulated traffic overlay
  if (hasCoords) {
    const oLat = params.originLat!;
    const oLng = params.originLng!;
    const dLat = params.destinationLat!;
    const dLng = params.destinationLng!;

    if (haversineMeters(oLat, oLng, dLat, dLng) < 20) {
      throw badRequest('Starting location and destination must be at least 20 meters apart');
    }

    const nearestOrigin = findNearestRoadNode(db, oLat, oLng);
    const nearestDest = findNearestRoadNode(db, dLat, dLng);

    const originDto: RoadNodeDTO & { label?: string; source?: string } = {
      id: params.originNodeId || nearestOrigin?.node.id || 'custom-origin',
      externalRef: nearestOrigin?.node.externalRef || 'GPS-START',
      name: params.originLabel || `${oLat.toFixed(5)}, ${oLng.toFixed(5)}`,
      label: params.originLabel || `${oLat.toFixed(5)}, ${oLng.toFixed(5)}`,
      latitude: oLat,
      longitude: oLng,
      isJunction: false,
      zone: nearestOrigin && nearestOrigin.distanceMeters < 10000 ? nearestOrigin.node.zone : 'Custom',
      source: 'CUSTOM_COORDS',
    };

    const destDto: RoadNodeDTO & { label?: string; source?: string } = {
      id: params.destinationNodeId || nearestDest?.node.id || 'custom-dest',
      externalRef: nearestDest?.node.externalRef || 'GPS-DEST',
      name: params.destinationLabel || `${dLat.toFixed(5)}, ${dLng.toFixed(5)}`,
      label: params.destinationLabel || `${dLat.toFixed(5)}, ${dLng.toFixed(5)}`,
      latitude: dLat,
      longitude: dLng,
      isJunction: false,
      zone: nearestDest && nearestDest.distanceMeters < 10000 ? nearestDest.node.zone : 'Custom',
      source: 'CUSTOM_COORDS',
    };

    const googleRes = await fetchGoogleRoutes(
      { lat: oLat, lng: oLng },
      { lat: dLat, lng: dLng }
    );

    if (googleRes.ok) {
      const evaluated = googleRes.routes.map((rt, idx) =>
        evaluateExternalRouteAgainstGraph(
          rt,
          graph,
          db,
          weights,
          idx === 0 ? 'GOOGLE_ROUTES_DRIVING' : 'GOOGLE_ROUTES_ALTERNATIVE'
        )
      );

      // If all candidates pass through a locally CLOSED segment and local graph has a bypass, fetch a detour via bypass midpoint
      const hasOpenCandidate = evaluated.some((e) => !e.intersectsClosedRoad);
      if (
        !hasOpenCandidate &&
        nearestOrigin &&
        nearestDest &&
        nearestOrigin.distanceMeters <= 4000 &&
        nearestDest.distanceMeters <= 4000 &&
        nearestOrigin.node.id !== nearestDest.node.id
      ) {
        const localBypass = computeRouteAlternatives(
          graph,
          nearestOrigin.node.id,
          nearestDest.node.id,
          weights
        );
        const bestLocal = localBypass.find((a) => a.category === 'RECOMMENDED') || localBypass[0];
        if (bestLocal && bestLocal.pathNodeIds.length >= 3) {
          const midNodeId = bestLocal.pathNodeIds[Math.floor(bestLocal.pathNodeIds.length / 2)];
          const midNode = graph.nodes.get(midNodeId);
          if (midNode) {
            const detourRes = await fetchGoogleRoutes(
              { lat: oLat, lng: oLng },
              { lat: dLat, lng: dLng },
              [{ lat: midNode.latitude, lng: midNode.longitude }]
            );
            if (detourRes.ok && detourRes.routes.length > 0) {
              const detourEval = evaluateExternalRouteAgainstGraph(
                detourRes.routes[0],
                graph,
                db,
                weights,
                'GOOGLE_ROUTES_ALTERNATIVE'
              );
              if (!detourEval.intersectsClosedRoad) {
                evaluated.unshift(detourEval);
              }
            }
          }
        }
      }

      return {
        origin: originDto,
        destination: destDto,
        alternatives: rankEvaluatedAlternatives(evaluated),
        recalculatedDueToNetworkEvent:
          graph.activeClosuresCount > 0 || graph.activeSimulationsCount > 0,
        activeClosuresCount: graph.activeClosuresCount,
        activeSimulationsCount: graph.activeSimulationsCount,
        provider: getRoutingProviderMetadata('GOOGLE_ROUTES_WITH_SIMULATED_TRAFFIC'),
      };
    }

    // Fallback: when server Routes API isn't configured/reachable AND coordinates are within local simulated graph (<= 15 km)
    if (
      nearestOrigin &&
      nearestDest &&
      nearestOrigin.distanceMeters <= 15000 &&
      nearestDest.distanceMeters <= 15000 &&
      nearestOrigin.node.id !== nearestDest.node.id
    ) {
      const localAlts = computeRouteAlternatives(
        graph,
        nearestOrigin.node.id,
        nearestDest.node.id,
        weights
      );
      if (localAlts.length === 0) {
        throw unprocessable(
          'No passable route exists between these locations due to active road closures or blockages'
        );
      }
      return {
        origin: {
          ...nearestOrigin.node,
          label: `${originDto.label} (snapped to ${nearestOrigin.node.name})`,
        },
        destination: {
          ...nearestDest.node,
          label: `${destDto.label} (snapped to ${nearestDest.node.name})`,
        },
        alternatives: localAlts.map((a) => enrichLocalAlternative(a, graph)),
        recalculatedDueToNetworkEvent:
          graph.activeClosuresCount > 0 || graph.activeSimulationsCount > 0,
        activeClosuresCount: graph.activeClosuresCount,
        activeSimulationsCount: graph.activeSimulationsCount,
        provider: getRoutingProviderMetadata(
          'LIVE_FALLBACK_SIMULATED',
          `Showing deterministic local road graph fallback (${googleRes.error}).`
        ),
      };
    }

    throw new AppError(
      503,
      'ROUTING_PROVIDER_UNAVAILABLE',
      `Google Routes API unavailable (${googleRes.error}), and selected coordinates are outside the local simulated city graph.`
    );
  }

  // Path 2: Deterministic local graph node-to-node routing
  if (!params.originNodeId || !params.destinationNodeId) {
    throw badRequest('Origin and destination are required');
  }
  if (params.originNodeId === params.destinationNodeId) {
    throw badRequest('Origin and destination must be different intersections');
  }

  const origin = graph.nodes.get(params.originNodeId);
  const destination = graph.nodes.get(params.destinationNodeId);

  if (!origin) throw notFound(`Origin node '${params.originNodeId}' not found`);
  if (!destination)
    throw notFound(`Destination node '${params.destinationNodeId}' not found`);

  const alternatives = computeRouteAlternatives(graph, origin.id, destination.id, weights);

  if (alternatives.length === 0) {
    throw unprocessable(
      'No passable route exists between these locations due to active road closures or blockages'
    );
  }

  return {
    origin,
    destination,
    alternatives: alternatives.map((a) => enrichLocalAlternative(a, graph)),
    recalculatedDueToNetworkEvent:
      graph.activeClosuresCount > 0 || graph.activeSimulationsCount > 0,
    activeClosuresCount: graph.activeClosuresCount,
    activeSimulationsCount: graph.activeSimulationsCount,
    provider: getRoutingProviderMetadata(),
  };
}

export function listSavedRoutes(db: Database.Database, userId: string) {
  const rows = db
    .prepare(
      `SELECT sr.*, n1.name as origin_name, n2.name as destination_name
       FROM saved_routes sr
       JOIN road_nodes n1 ON n1.id = sr.origin_node_id
       JOIN road_nodes n2 ON n2.id = sr.destination_node_id
       WHERE sr.user_id = ?
       ORDER BY sr.created_at DESC`
    )
    .all(userId) as Array<any>;

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    originNodeId: r.origin_node_id,
    originName: r.origin_name,
    destinationNodeId: r.destination_node_id,
    destinationName: r.destination_name,
    routeType: r.route_type,
    summary: JSON.parse(r.summary_json || '{}'),
    createdAt: r.created_at,
  }));
}

export function saveUserRoute(
  db: Database.Database,
  userId: string,
  input: {
    label: string;
    originNodeId?: string;
    destinationNodeId?: string;
    originLat?: number;
    originLng?: number;
    destinationLat?: number;
    destinationLng?: number;
    routeType: 'SHORTEST' | 'FASTEST' | 'RECOMMENDED';
    summary: Record<string, unknown>;
  }
) {
  let originNodeId = input.originNodeId;
  let destinationNodeId = input.destinationNodeId;

  const validOrigin = originNodeId
    ? db.prepare('SELECT id FROM road_nodes WHERE id = ?').get(originNodeId)
    : null;
  if (!validOrigin && input.originLat !== undefined && input.originLng !== undefined) {
    originNodeId = findNearestRoadNode(db, input.originLat, input.originLng)?.node.id;
  }

  const validDest = destinationNodeId
    ? db.prepare('SELECT id FROM road_nodes WHERE id = ?').get(destinationNodeId)
    : null;
  if (!validDest && input.destinationLat !== undefined && input.destinationLng !== undefined) {
    destinationNodeId = findNearestRoadNode(db, input.destinationLat, input.destinationLng)?.node.id;
  }

  if (!originNodeId || !destinationNodeId) {
    const fallbackNodes = db.prepare('SELECT id FROM road_nodes LIMIT 2').all() as Array<{ id: string }>;
    originNodeId = originNodeId || fallbackNodes[0]?.id;
    destinationNodeId = destinationNodeId || fallbackNodes[1]?.id || fallbackNodes[0]?.id;
  }

  if (!originNodeId || !destinationNodeId) {
    throw badRequest('Unable to resolve road nodes for saving route');
  }

  const id = `rt-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO saved_routes (id, user_id, label, origin_node_id, destination_node_id, route_type, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    input.label,
    originNodeId,
    destinationNodeId,
    input.routeType,
    JSON.stringify(input.summary),
    now
  );
  return { id, ...input, originNodeId, destinationNodeId, createdAt: now };
}

export function deleteSavedRoute(db: Database.Database, userId: string, routeId: string) {
  const info = db
    .prepare('DELETE FROM saved_routes WHERE id = ? AND user_id = ?')
    .run(routeId, userId);
  if (info.changes === 0) throw notFound('Saved route not found');
  return { deleted: true, id: routeId };
}
