import Database from 'better-sqlite3';
import {
  CongestionClass,
  RoadClosureStatus,
  RoadNodeDTO,
  RoadSegmentDTO,
} from '../../shared/types.js';

export interface DirectedEdge {
  segmentId: string;
  segmentName: string;
  fromNodeId: string;
  toNodeId: string;
  geometry: Array<[number, number]>;
  lengthMeters: number;
  capacityVph: number;
  speedLimitKmh: number;
  effectiveCongestion: number;
  effectiveClosureStatus: RoadClosureStatus;
  weatherFactor: number;
  activeIncidentPenalty: number;
  activeIncidentCount: number;
  reliability: number;
}

export interface NetworkGraph {
  nodes: Map<string, RoadNodeDTO>;
  segments: RoadSegmentDTO[];
  adjacency: Map<string, DirectedEdge[]>;
  activeIncidentsBySegment: Map<
    string,
    Array<{ id: string; type: any; severity: any; status: any; description: string }>
  >;
  activeSimulationsCount: number;
  activeClosuresCount: number;
}

export function classifyCongestion(score: number): CongestionClass {
  if (score >= 0.78) return 'SEVERE';
  if (score >= 0.58) return 'HIGH';
  if (score >= 0.35) return 'MODERATE';
  return 'CLEAR';
}

export function buildEffectiveGraph(
  db: Database.Database,
  options?: { overrideClosures?: Array<{ segmentId: string; status: RoadClosureStatus; capacityFactor?: number }> }
): NetworkGraph {
  const nodeRows = db.prepare('SELECT * FROM road_nodes').all() as Array<any>;
  const segRows = db.prepare('SELECT * FROM road_segments').all() as Array<any>;
  const verifiedIncidents = db
    .prepare(
      `SELECT id, type, severity, status, description, road_segment_id FROM incidents WHERE status = 'VERIFIED' AND road_segment_id IS NOT NULL`
    )
    .all() as Array<any>;
  const activeSimulations = db
    .prepare(`SELECT * FROM simulation_scenarios WHERE status = 'ACTIVE'`)
    .all() as Array<any>;

  const nodes = new Map<string, RoadNodeDTO>();
  for (const r of nodeRows) {
    nodes.set(r.id, {
      id: r.id,
      externalRef: r.external_ref,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      isJunction: Boolean(r.is_junction),
      zone: r.zone,
    });
  }

  const activeIncidentsBySegment = new Map<
    string,
    Array<{ id: string; type: any; severity: any; status: any; description: string }>
  >();
  for (const inc of verifiedIncidents) {
    const list = activeIncidentsBySegment.get(inc.road_segment_id) || [];
    list.push({
      id: inc.id,
      type: inc.type,
      severity: inc.severity,
      status: inc.status,
      description: inc.description,
    });
    activeIncidentsBySegment.set(inc.road_segment_id, list);
  }

  const simBySegment = new Map<string, { closure?: RoadClosureStatus; congestionBoost: number }>();
  for (const sim of activeSimulations) {
    const params = JSON.parse(sim.parameters_json || '{}');
    const prev = simBySegment.get(sim.target_segment_id) || { congestionBoost: 0 };
    if (sim.type === 'FULL_CLOSURE') {
      prev.closure = 'CLOSED';
    } else if (sim.type === 'LANE_BLOCKAGE' || sim.type === 'CAPACITY_REDUCTION') {
      if (prev.closure !== 'CLOSED') prev.closure = 'LANE_RESTRICTED';
      prev.congestionBoost = Math.max(prev.congestionBoost, 0.35);
    } else if (sim.type === 'TRAFFIC_SURGE') {
      prev.congestionBoost = Math.max(prev.congestionBoost, 0.3);
    }
    if (params.closureMode === 'CLOSED') prev.closure = 'CLOSED';
    simBySegment.set(sim.target_segment_id, prev);
  }

  const overrideMap = new Map<string, { status: RoadClosureStatus; capacityFactor?: number }>();
  for (const ov of options?.overrideClosures || []) {
    overrideMap.set(ov.segmentId, { status: ov.status, capacityFactor: ov.capacityFactor });
  }

  const adjacency = new Map<string, DirectedEdge[]>();
  for (const id of nodes.keys()) {
    adjacency.set(id, []);
  }

  const segments: RoadSegmentDTO[] = [];
  let activeClosuresCount = 0;

  for (const r of segRows) {
    const segIncidents = activeIncidentsBySegment.get(r.id) || [];
    let incidentPenalty = 0;
    let incidentClosure: RoadClosureStatus | null = null;
    for (const inc of segIncidents) {
      if (inc.type === 'ROADBLOCK' || inc.type === 'FLOODING' || inc.severity === 'CRITICAL') {
        incidentClosure = 'CLOSED';
        incidentPenalty += 1.0;
      } else if (inc.type === 'ACCIDENT' || inc.type === 'LANE_CLOSURE' || inc.severity === 'HIGH') {
        incidentPenalty += 0.55;
        if (!incidentClosure) incidentClosure = 'LANE_RESTRICTED';
      } else {
        incidentPenalty += 0.25;
      }
    }

    const simEffect = simBySegment.get(r.id);
    const override = overrideMap.get(r.id);

    let effectiveClosure: RoadClosureStatus = r.closure_status;
    if (incidentClosure === 'CLOSED') effectiveClosure = 'CLOSED';
    else if (incidentClosure === 'LANE_RESTRICTED' && effectiveClosure === 'OPEN') {
      effectiveClosure = 'LANE_RESTRICTED';
    }
    if (simEffect?.closure === 'CLOSED') effectiveClosure = 'CLOSED';
    else if (simEffect?.closure === 'LANE_RESTRICTED' && effectiveClosure === 'OPEN') {
      effectiveClosure = 'LANE_RESTRICTED';
    }
    if (override) {
      effectiveClosure = override.status;
    }

    if (effectiveClosure === 'CLOSED') {
      activeClosuresCount++;
    }

    const effectiveCongestion = Math.min(
      0.98,
      Math.max(
        0.05,
        r.current_congestion +
          (simEffect?.congestionBoost || 0) +
          (effectiveClosure === 'LANE_RESTRICTED' ? 0.22 : 0) +
          Math.min(0.35, incidentPenalty * 0.2)
      )
    );

    const geometry = JSON.parse(r.geometry_json) as Array<[number, number]>;
    const segDto: RoadSegmentDTO = {
      id: r.id,
      name: r.name,
      startNodeId: r.start_node_id,
      endNodeId: r.end_node_id,
      geometry,
      lengthMeters: r.length_meters,
      capacityVph: r.capacity_vph,
      speedLimitKmh: r.speed_limit_kmh,
      currentCongestion: Number(effectiveCongestion.toFixed(2)),
      closureStatus: r.closure_status,
      effectiveClosureStatus: effectiveClosure,
      weatherFactor: r.weather_factor,
      activeIncidentCount: segIncidents.length,
      simulatedBlocked: Boolean(simEffect),
      congestionClass: classifyCongestion(effectiveCongestion),
      isSimulated: Boolean(r.is_simulated),
    };
    segments.push(segDto);

    const reliability = Math.max(
      0.1,
      1.0 - effectiveCongestion * 0.45 - Math.min(0.45, segIncidents.length * 0.22)
    );

    const forwardEdge: DirectedEdge = {
      segmentId: r.id,
      segmentName: r.name,
      fromNodeId: r.start_node_id,
      toNodeId: r.end_node_id,
      geometry,
      lengthMeters: r.length_meters,
      capacityVph: r.capacity_vph,
      speedLimitKmh: r.speed_limit_kmh,
      effectiveCongestion,
      effectiveClosureStatus: effectiveClosure,
      weatherFactor: r.weather_factor,
      activeIncidentPenalty: incidentPenalty,
      activeIncidentCount: segIncidents.length,
      reliability,
    };
    adjacency.get(r.start_node_id)?.push(forwardEdge);

    if (!r.one_way) {
      adjacency.get(r.end_node_id)?.push({
        ...forwardEdge,
        fromNodeId: r.end_node_id,
        toNodeId: r.start_node_id,
        geometry: [...geometry].reverse(),
      });
    }
  }

  return {
    nodes,
    segments,
    adjacency,
    activeIncidentsBySegment,
    activeSimulationsCount: activeSimulations.length,
    activeClosuresCount,
  };
}
