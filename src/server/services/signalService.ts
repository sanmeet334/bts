import Database from 'better-sqlite3';
import crypto from 'crypto';
import { JunctionDTO, SignalPlanDTO } from '../../shared/types.js';
import {
  calculateAdaptiveSignalPlan,
  SignalPhaseTiming,
} from '../algorithms/signalOptimizer.js';
import { broadcastEvent } from '../realtime/socket.js';
import { conflict, notFound } from '../utils/errors.js';
import { recordAuditLog } from './auditService.js';

function mapJunction(db: Database.Database, row: any): JunctionDTO {
  const segStats = db
    .prepare(
      `SELECT AVG(current_congestion) as avg_cong, COUNT(*) as cnt
       FROM road_segments
       WHERE start_node_id = ? OR end_node_id = ?`
    )
    .get(row.node_id, row.node_id) as { avg_cong: number | null; cnt: number };

  const density = Number((segStats?.avg_cong ?? 0.42).toFixed(2));
  const queue = Math.round(density * 26);

  return {
    id: row.id,
    nodeId: row.node_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    approaches: JSON.parse(row.approaches_json || '[]'),
    lanesCount: row.lanes_count,
    minGreenSec: row.min_green_sec,
    maxGreenSec: row.max_green_sec,
    cycleLengthSec: row.cycle_length_sec,
    currentPhases: JSON.parse(row.current_phases_json || '[]'),
    latestDensity: density,
    latestQueueLength: queue,
    active: Boolean(row.active),
    isSimulated: true,
  };
}

function mapSignalPlan(row: any): SignalPlanDTO {
  return {
    id: row.id,
    junctionId: row.junction_id,
    junctionName: row.junction_name,
    initiatedBy: row.initiated_by,
    initiatedByName: row.initiated_by_name,
    observedDensity: row.observed_density,
    observedQueue: row.observed_queue,
    currentTimings: JSON.parse(row.current_timings_json),
    proposedTimings: JSON.parse(row.proposed_timings_json),
    reason: row.reason,
    beforeMetrics: JSON.parse(row.before_metrics_json),
    afterMetrics: JSON.parse(row.after_metrics_json),
    status: row.status,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    simulationNotice: 'SIMULATED TRAFFIC SIGNAL CONTROL — NOT CONNECTED TO ROADSIDE HARDWARE',
  };
}

export function listJunctions(db: Database.Database): JunctionDTO[] {
  const rows = db.prepare('SELECT * FROM junctions WHERE active = 1').all() as Array<any>;
  return rows.map((r) => mapJunction(db, r));
}

export function optimizeAndSimulateSignal(
  db: Database.Database,
  actor: { userId: string; email: string },
  input: {
    junctionId: string;
    observedDensity: number;
    observedQueue: number;
  }
): SignalPlanDTO {
  const jRow = db
    .prepare('SELECT * FROM junctions WHERE id = ?')
    .get(input.junctionId) as any;
  if (!jRow) throw notFound(`Junction '${input.junctionId}' not found`);

  const currentPhases = JSON.parse(jRow.current_phases_json) as SignalPhaseTiming[];
  const opt = calculateAdaptiveSignalPlan({
    phases: currentPhases,
    lanesCount: jRow.lanes_count,
    minGreenSec: jRow.min_green_sec,
    maxGreenSec: jRow.max_green_sec,
    cycleLengthSec: jRow.cycle_length_sec,
    observedDensity: input.observedDensity,
    observedQueue: input.observedQueue,
  });

  const planId = `sig-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO signal_plans (
        id, junction_id, initiated_by, observed_density, observed_queue,
        current_timings_json, proposed_timings_json, reason,
        before_metrics_json, after_metrics_json, status, approved_by, created_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIMULATED', NULL, ?, NULL)`
    ).run(
      planId,
      jRow.id,
      actor.userId,
      input.observedDensity,
      input.observedQueue,
      JSON.stringify(currentPhases),
      JSON.stringify(opt.proposedTimings),
      opt.reason,
      JSON.stringify(opt.beforeMetrics),
      JSON.stringify(opt.afterMetrics),
      now
    );

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SIGNAL_PLAN_SIMULATED',
      targetType: 'JUNCTION',
      targetId: jRow.id,
      beforeSummary: `wait=${opt.beforeMetrics.avgWaitTimeSec}s, queue=${opt.beforeMetrics.maxQueueVehicles}`,
      afterSummary: `wait=${opt.afterMetrics.avgWaitTimeSec}s, queue=${opt.afterMetrics.maxQueueVehicles} (SIMULATED)`,
    });
  });

  tx();

  const row = db
    .prepare(
      `SELECT sp.*, j.name as junction_name, u.name as initiated_by_name
       FROM signal_plans sp
       JOIN junctions j ON j.id = sp.junction_id
       JOIN users u ON u.id = sp.initiated_by
       WHERE sp.id = ?`
    )
    .get(planId);

  const dto = mapSignalPlan(row);
  broadcastEvent('signal:ops', 'signal:plan-updated', dto);
  return dto;
}

export function approveSignalPlanSimulation(
  db: Database.Database,
  planId: string,
  actor: { userId: string; email: string }
): SignalPlanDTO {
  const plan = db
    .prepare('SELECT * FROM signal_plans WHERE id = ?')
    .get(planId) as any;
  if (!plan) throw notFound(`Signal plan '${planId}' not found`);
  if (plan.status === 'APPROVED_SIMULATION') {
    throw conflict('Signal plan simulation is already approved');
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE signal_plans SET status = 'APPROVED_SIMULATION', approved_by = ?, approved_at = ? WHERE id = ?`
    ).run(actor.userId, now, planId);

    db.prepare(
      `UPDATE junctions SET current_phases_json = ? WHERE id = ?`
    ).run(plan.proposed_timings_json, plan.junction_id);

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SIGNAL_PLAN_APPROVED_SIMULATION',
      targetType: 'SIGNAL_PLAN',
      targetId: planId,
      beforeSummary: `status=${plan.status}`,
      afterSummary: `status=APPROVED_SIMULATION on junction ${plan.junction_id}`,
    });
  });
  tx();

  const updated = db
    .prepare(
      `SELECT sp.*, j.name as junction_name, u.name as initiated_by_name
       FROM signal_plans sp
       JOIN junctions j ON j.id = sp.junction_id
       JOIN users u ON u.id = sp.initiated_by
       WHERE sp.id = ?`
    )
    .get(planId);

  const dto = mapSignalPlan(updated);
  broadcastEvent('signal:ops', 'signal:plan-updated', dto);
  broadcastEvent('admin:ops', 'signal:plan-updated', dto);
  return dto;
}

export function listSignalPlansHistory(db: Database.Database): SignalPlanDTO[] {
  const rows = db
    .prepare(
      `SELECT sp.*, j.name as junction_name, u.name as initiated_by_name
       FROM signal_plans sp
       JOIN junctions j ON j.id = sp.junction_id
       JOIN users u ON u.id = sp.initiated_by
       ORDER BY sp.created_at DESC
       LIMIT 30`
    )
    .all() as Array<any>;
  return rows.map(mapSignalPlan);
}
