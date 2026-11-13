import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  RoadClosureStatus,
  SimulationScenarioDTO,
} from '../../shared/types.js';
import { buildEffectiveGraph } from '../algorithms/graph.js';
import { analyzeNetworkImpact } from '../algorithms/networkImpact.js';
import { computeRouteAlternatives } from '../algorithms/pathfinding.js';
import { broadcastEvent } from '../realtime/socket.js';
import { notFound } from '../utils/errors.js';
import { recordAuditLog } from './auditService.js';

function mapSimulation(row: any): SimulationScenarioDTO {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    targetSegmentId: row.target_segment_id,
    targetSegmentName: row.target_segment_name || undefined,
    parameters: JSON.parse(row.parameters_json || '{}'),
    results: JSON.parse(row.results_json || '{}'),
    createdBy: row.created_by,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

export function createClosureSimulation(
  db: Database.Database,
  actor: { userId: string; email: string },
  input: {
    name: string;
    type: 'FULL_CLOSURE' | 'LANE_BLOCKAGE' | 'CAPACITY_REDUCTION' | 'TRAFFIC_SURGE';
    targetSegmentId: string;
    originNodeId?: string;
    destinationNodeId?: string;
    densityMultiplier?: number;
    weatherCondition?: string;
  }
): SimulationScenarioDTO {
  const seg = db
    .prepare('SELECT * FROM road_segments WHERE id = ?')
    .get(input.targetSegmentId) as any;
  if (!seg) throw notFound(`Road segment '${input.targetSegmentId}' not found`);

  const simMode: RoadClosureStatus =
    input.type === 'FULL_CLOSURE'
      ? 'CLOSED'
      : input.type === 'LANE_BLOCKAGE' || input.type === 'CAPACITY_REDUCTION'
      ? 'LANE_RESTRICTED'
      : 'OPEN';

  const impact = analyzeNetworkImpact(
    db,
    'simulation-preview',
    input.targetSegmentId,
    simMode === 'OPEN' ? 'LANE_RESTRICTED' : simMode
  );

  // Also test route delta between chosen origin/destination or segment endpoints
  const testOrigin = input.originNodeId || seg.start_node_id;
  const testDest = input.destinationNodeId || seg.end_node_id;

  const baseGraph = buildEffectiveGraph(db);
  const simGraph = buildEffectiveGraph(db, {
    overrideClosures: [{ segmentId: input.targetSegmentId, status: simMode }],
  });

  const baseRoutes = computeRouteAlternatives(baseGraph, testOrigin, testDest);
  const simRoutes = computeRouteAlternatives(simGraph, testOrigin, testDest);

  const baseFast = baseRoutes.find((r) => r.category === 'FASTEST') || baseRoutes[0];
  const simFast = simRoutes.find((r) => r.category === 'FASTEST') || simRoutes[0];

  const addedDelayMin =
    baseFast && simFast
      ? Number(Math.max(0, simFast.estimatedTimeMin - baseFast.estimatedTimeMin).toFixed(1))
      : impact.estimatedAddedTravelTimeMin;

  const detourPathNames = simFast
    ? simFast.pathSegmentIds.map(
        (id) => simGraph.segments.find((s) => s.id === id)?.name || id
      )
    : [];

  const results = {
    affectedSegmentCount: impact.downstreamSegments.length + 1,
    addedDelayMin,
    detourAvailable: simRoutes.length > 0,
    detourPathNames,
    baselineEtaMin: baseFast ? baseFast.estimatedTimeMin : null,
    simulatedEtaMin: simFast ? simFast.estimatedTimeMin : null,
    downstreamSegments: impact.downstreamSegments.slice(0, 5).map((d) => ({
      segmentId: d.segmentId,
      segmentName: d.segmentName,
      projectedCongestion: d.projectedCongestion,
    })),
  };

  const parameters = {
    closureMode: simMode,
    densityMultiplier: input.densityMultiplier ?? 1.0,
    weatherCondition: input.weatherCondition ?? 'CLEAR',
    originNodeId: testOrigin,
    destinationNodeId: testDest,
  };

  const id = `sim-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO simulation_scenarios (id, name, type, target_segment_id, parameters_json, results_json, created_by, status, created_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL)`
    ).run(
      id,
      input.name,
      input.type,
      input.targetSegmentId,
      JSON.stringify(parameters),
      JSON.stringify(results),
      actor.userId,
      now
    );

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SIMULATION_STARTED',
      targetType: 'SIMULATION',
      targetId: id,
      beforeSummary: `segment=${seg.name}, realClosure=${seg.closure_status}`,
      afterSummary: `type=${input.type}, simClosure=${simMode} (real record preserved)`,
    });
  });

  tx();

  const created = db
    .prepare(
      `SELECT ss.*, s.name as target_segment_name
       FROM simulation_scenarios ss
       JOIN road_segments s ON s.id = ss.target_segment_id
       WHERE ss.id = ?`
    )
    .get(id);

  const dto = mapSimulation(created);
  broadcastEvent('public:traffic', 'road:status-changed', {
    simulationId: dto.id,
    simulationName: dto.name,
    simulationType: dto.type,
    segmentId: dto.targetSegmentId,
    segmentName: dto.targetSegmentName,
    addedDelayMin: dto.results.addedDelayMin,
    status: 'SIMULATION_ACTIVE',
    isSimulated: true,
  });
  return dto;
}

export function listSimulations(db: Database.Database): SimulationScenarioDTO[] {
  const rows = db
    .prepare(
      `SELECT ss.*, s.name as target_segment_name
       FROM simulation_scenarios ss
       JOIN road_segments s ON s.id = ss.target_segment_id
       ORDER BY ss.created_at DESC`
    )
    .all() as Array<any>;
  return rows.map(mapSimulation);
}

export function getSimulationById(db: Database.Database, id: string): SimulationScenarioDTO {
  const row = db
    .prepare(
      `SELECT ss.*, s.name as target_segment_name
       FROM simulation_scenarios ss
       JOIN road_segments s ON s.id = ss.target_segment_id
       WHERE ss.id = ?`
    )
    .get(id);
  if (!row) throw notFound(`Simulation scenario '${id}' not found`);
  return mapSimulation(row);
}

export function endSimulationScenario(
  db: Database.Database,
  id: string,
  actor: { userId: string; email: string }
): SimulationScenarioDTO {
  const existing = db
    .prepare('SELECT * FROM simulation_scenarios WHERE id = ?')
    .get(id) as any;
  if (!existing) throw notFound(`Simulation scenario '${id}' not found`);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE simulation_scenarios SET status = 'ENDED', ended_at = ? WHERE id = ?`
    ).run(now, id);

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SIMULATION_ENDED',
      targetType: 'SIMULATION',
      targetId: id,
      beforeSummary: 'status=ACTIVE',
      afterSummary: 'status=ENDED (network restored)',
    });
  });
  tx();

  const endedDto = getSimulationById(db, id);
  broadcastEvent('public:traffic', 'road:status-changed', {
    simulationId: id,
    simulationName: endedDto.name,
    simulationType: endedDto.type,
    segmentId: existing.target_segment_id,
    segmentName: endedDto.targetSegmentName,
    status: 'SIMULATION_ENDED',
    isSimulated: true,
  });

  return endedDto;
}

export function applyTrafficControlInputs(
  db: Database.Database,
  actor: { userId: string; email: string },
  input: { densityMultiplier: number; weatherCondition: 'CLEAR' | 'RAIN' | 'HEAVY_RAIN' }
) {
  const weatherFactor =
    input.weatherCondition === 'HEAVY_RAIN'
      ? 0.72
      : input.weatherCondition === 'RAIN'
      ? 0.86
      : 1.0;

  const tx = db.transaction(() => {
    const segs = db
      .prepare('SELECT id, current_congestion FROM road_segments')
      .all() as Array<{ id: string; current_congestion: number }>;

    const updateStmt = db.prepare(
      'UPDATE road_segments SET current_congestion = ?, weather_factor = ? WHERE id = ?'
    );
    for (const s of segs) {
      const baseline = Math.min(0.95, Math.max(0.1, s.current_congestion * input.densityMultiplier));
      updateStmt.run(Number(baseline.toFixed(2)), weatherFactor, s.id);
    }

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SIMULATION_TRAFFIC_CONTROLS_UPDATED',
      targetType: 'NETWORK',
      targetId: 'all-segments',
      beforeSummary: 'Prior simulated load/weather',
      afterSummary: `densityMultiplier=${input.densityMultiplier}, weather=${input.weatherCondition}`,
    });
  });

  tx();

  broadcastEvent('public:traffic', 'road:status-changed', {
    weatherCondition: input.weatherCondition,
    densityMultiplier: input.densityMultiplier,
  });

  return {
    applied: true,
    densityMultiplier: input.densityMultiplier,
    weatherCondition: input.weatherCondition,
    weatherFactor,
    isSimulated: true,
  };
}
