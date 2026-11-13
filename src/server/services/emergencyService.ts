import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  EmergencyPriorityLevel,
  EmergencyTripDTO,
  EmergencyTripStatus,
  EmergencyVehicleDTO,
} from '../../shared/types.js';
import { computeEmergencyPriorityPlan } from '../algorithms/emergencyRouting.js';
import { broadcastEvent } from '../realtime/socket.js';
import { badRequest, notFound, unprocessable } from '../utils/errors.js';
import { recordAuditLog } from './auditService.js';

function mapTrip(row: any): EmergencyTripDTO {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleLabel: row.vehicle_label,
    vehicleType: row.vehicle_type,
    operatorId: row.operator_id,
    originNodeId: row.origin_node_id,
    originName: row.origin_name,
    destinationNodeId: row.destination_node_id,
    destinationName: row.destination_name,
    priorityLevel: row.priority_level,
    status: row.status,
    normalEtaMin: row.normal_eta_min,
    priorityEtaMin: row.priority_eta_min,
    timeSavedMin: row.time_saved_min,
    route: JSON.parse(row.route_json),
    junctionActions: JSON.parse(row.junction_actions_json),
    currentLat: row.current_lat,
    currentLng: row.current_lng,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function listEmergencyVehicles(
  db: Database.Database,
  operatorId?: string
): EmergencyVehicleDTO[] {
  const rows = operatorId
    ? (db
        .prepare('SELECT * FROM emergency_vehicles WHERE operator_id = ?')
        .all(operatorId) as Array<any>)
    : (db.prepare('SELECT * FROM emergency_vehicles').all() as Array<any>);

  return rows.map((r) => ({
    id: r.id,
    operatorId: r.operator_id,
    vehicleType: r.vehicle_type,
    registrationLabel: r.registration_label,
    available: Boolean(r.available),
  }));
}

export function createEmergencyTrip(
  db: Database.Database,
  actor: { userId: string; email: string },
  input: {
    vehicleId: string;
    originNodeId: string;
    destinationNodeId: string;
    priorityLevel: EmergencyPriorityLevel;
  }
): EmergencyTripDTO {
  if (input.originNodeId === input.destinationNodeId) {
    throw badRequest('Origin and destination intersections must differ');
  }

  const vehicle = db
    .prepare('SELECT * FROM emergency_vehicles WHERE id = ?')
    .get(input.vehicleId) as any;
  if (!vehicle) throw notFound(`Emergency vehicle '${input.vehicleId}' not found`);

  const origin = db
    .prepare('SELECT * FROM road_nodes WHERE id = ?')
    .get(input.originNodeId) as any;
  const dest = db
    .prepare('SELECT * FROM road_nodes WHERE id = ?')
    .get(input.destinationNodeId) as any;
  if (!origin || !dest) throw notFound('Origin or destination node not found');

  let plan: ReturnType<typeof computeEmergencyPriorityPlan>;
  try {
    plan = computeEmergencyPriorityPlan(db, {
      originNodeId: input.originNodeId,
      destinationNodeId: input.destinationNodeId,
      priorityLevel: input.priorityLevel,
    });
  } catch (err: any) {
    throw unprocessable(err.message || 'Unable to compute emergency corridor');
  }

  const tripId = `emg-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO emergency_trips (
        id, vehicle_id, operator_id, origin_node_id, destination_node_id,
        priority_level, status, normal_eta_min, priority_eta_min, time_saved_min,
        route_json, junction_actions_json, current_lat, current_lng, failure_reason,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    ).run(
      tripId,
      input.vehicleId,
      actor.userId,
      input.originNodeId,
      input.destinationNodeId,
      input.priorityLevel,
      plan.normalEtaMin,
      plan.priorityEtaMin,
      plan.timeSavedMin,
      JSON.stringify(plan.route),
      JSON.stringify(plan.junctionActions),
      origin.latitude,
      origin.longitude,
      now,
      now
    );

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'EMERGENCY_TRIP_CREATED',
      targetType: 'EMERGENCY_TRIP',
      targetId: tripId,
      beforeSummary: 'None',
      afterSummary: `priority=${input.priorityLevel}, normalETA=${plan.normalEtaMin}m, priorityETA=${plan.priorityEtaMin}m`,
    });
  });

  tx();

  const dto = getEmergencyTripById(db, tripId);
  broadcastEvent('emergency:ops', 'emergency:trip-updated', dto);
  broadcastEvent('admin:ops', 'emergency:trip-updated', dto);
  broadcastEvent('signal:ops', 'emergency:trip-updated', dto);
  return dto;
}

export function getEmergencyTripById(
  db: Database.Database,
  tripId: string
): EmergencyTripDTO {
  const row = db
    .prepare(
      `SELECT t.*, v.registration_label as vehicle_label, v.vehicle_type,
              n1.name as origin_name, n2.name as destination_name
       FROM emergency_trips t
       JOIN emergency_vehicles v ON v.id = t.vehicle_id
       JOIN road_nodes n1 ON n1.id = t.origin_node_id
       JOIN road_nodes n2 ON n2.id = t.destination_node_id
       WHERE t.id = ?`
    )
    .get(tripId);
  if (!row) throw notFound(`Emergency trip '${tripId}' not found`);
  return mapTrip(row);
}

export function listEmergencyTrips(db: Database.Database): EmergencyTripDTO[] {
  const rows = db
    .prepare(
      `SELECT t.*, v.registration_label as vehicle_label, v.vehicle_type,
              n1.name as origin_name, n2.name as destination_name
       FROM emergency_trips t
       JOIN emergency_vehicles v ON v.id = t.vehicle_id
       JOIN road_nodes n1 ON n1.id = t.origin_node_id
       JOIN road_nodes n2 ON n2.id = t.destination_node_id
       ORDER BY t.created_at DESC
       LIMIT 30`
    )
    .all() as Array<any>;
  return rows.map(mapTrip);
}

export function updateEmergencyTripStatus(
  db: Database.Database,
  tripId: string,
  actor: { userId: string; email: string },
  status: Exclude<EmergencyTripStatus, 'REQUESTED'>,
  failureReason?: string
): EmergencyTripDTO {
  const existing = db
    .prepare('SELECT * FROM emergency_trips WHERE id = ?')
    .get(tripId) as any;
  if (!existing) throw notFound(`Emergency trip '${tripId}' not found`);

  const now = new Date().toISOString();
  const completedAt = status === 'COMPLETED' ? now : existing.completed_at;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE emergency_trips SET status = ?, failure_reason = ?, updated_at = ?, completed_at = ? WHERE id = ?`
    ).run(status, failureReason || null, now, completedAt, tripId);

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `EMERGENCY_TRIP_${status}`,
      targetType: 'EMERGENCY_TRIP',
      targetId: tripId,
      beforeSummary: `status=${existing.status}`,
      afterSummary: `status=${status}${failureReason ? `, reason=${failureReason}` : ''}`,
    });
  });

  tx();

  const dto = getEmergencyTripById(db, tripId);
  broadcastEvent('emergency:ops', 'emergency:trip-updated', dto);
  broadcastEvent('admin:ops', 'emergency:trip-updated', dto);
  return dto;
}

export function recalculateEmergencyPriorityRoute(
  db: Database.Database,
  tripId: string,
  actor: { userId: string; email: string }
): EmergencyTripDTO {
  const existing = db
    .prepare('SELECT * FROM emergency_trips WHERE id = ?')
    .get(tripId) as any;
  if (!existing) throw notFound(`Emergency trip '${tripId}' not found`);

  let plan: ReturnType<typeof computeEmergencyPriorityPlan>;
  try {
    plan = computeEmergencyPriorityPlan(db, {
      originNodeId: existing.origin_node_id,
      destinationNodeId: existing.destination_node_id,
      priorityLevel: existing.priority_level,
    });
  } catch (err: any) {
    return updateEmergencyTripStatus(
      db,
      tripId,
      actor,
      'BLOCKED',
      err.message || 'Corridor blocked'
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE emergency_trips
     SET normal_eta_min = ?, priority_eta_min = ?, time_saved_min = ?, route_json = ?, junction_actions_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    plan.normalEtaMin,
    plan.priorityEtaMin,
    plan.timeSavedMin,
    JSON.stringify(plan.route),
    JSON.stringify(plan.junctionActions),
    now,
    tripId
  );

  const dto = getEmergencyTripById(db, tripId);
  broadcastEvent('emergency:ops', 'emergency:trip-updated', dto);
  return dto;
}

export function updateEmergencyLocation(
  db: Database.Database,
  tripId: string,
  lat: number,
  lng: number
): EmergencyTripDTO {
  const existing = db
    .prepare('SELECT id FROM emergency_trips WHERE id = ?')
    .get(tripId);
  if (!existing) throw notFound(`Emergency trip '${tripId}' not found`);

  db.prepare(
    `UPDATE emergency_trips SET current_lat = ?, current_lng = ?, updated_at = ? WHERE id = ?`
  ).run(lat, lng, new Date().toISOString(), tripId);

  const dto = getEmergencyTripById(db, tripId);
  broadcastEvent('emergency:ops', 'emergency:trip-updated', dto);
  return dto;
}
