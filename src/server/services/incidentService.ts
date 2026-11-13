import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  IncidentDTO,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  NetworkImpactResultDTO,
  UserRole,
} from '../../shared/types.js';
import {
  detectPossibleDuplicate,
  estimateIncidentSeverity,
  findNearestRoadSegmentId,
} from '../algorithms/incidentAnalysis.js';
import { analyzeNetworkImpact } from '../algorithms/networkImpact.js';
import { broadcastEvent } from '../realtime/socket.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { recordAuditLog } from './auditService.js';

function mapIncident(row: any, includeReporterName = false): IncidentDTO {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    ...(includeReporterName && row.reporter_name ? { reporterName: row.reporter_name } : {}),
    type: row.type,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    roadSegmentId: row.road_segment_id,
    roadSegmentName: row.road_segment_name || undefined,
    severity: row.severity,
    estimatedSeverity: row.estimated_severity,
    severityConfidence: row.severity_confidence,
    severityReasons: JSON.parse(row.severity_reasons_json || '[]'),
    status: row.status,
    imageUrl: row.image_url,
    possibleDuplicate: Boolean(row.possible_duplicate),
    canonicalIncidentId: row.canonical_incident_id,
    duplicateScore: row.duplicate_score,
    duplicateReason: row.duplicate_reason,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export function createIncidentReport(
  db: Database.Database,
  reporter: { userId: string; email: string },
  input: {
    type: IncidentType;
    description: string;
    latitude: number;
    longitude: number;
    severity: IncidentSeverity;
    roadSegmentId?: string | null;
    imageUrl?: string | null;
  }
): IncidentDTO {
  const matchedSegmentId =
    input.roadSegmentId || findNearestRoadSegmentId(db, input.latitude, input.longitude);

  if (input.roadSegmentId) {
    const segExists = db
      .prepare('SELECT id FROM road_segments WHERE id = ?')
      .get(input.roadSegmentId);
    if (!segExists) {
      throw badRequest(`Road segment '${input.roadSegmentId}' does not exist`);
    }
  }

  const dup = detectPossibleDuplicate(db, {
    type: input.type,
    description: input.description,
    latitude: input.latitude,
    longitude: input.longitude,
    roadSegmentId: matchedSegmentId,
  });

  const sevEst = estimateIncidentSeverity(db, {
    type: input.type,
    description: input.description,
    reportedSeverity: input.severity,
    roadSegmentId: matchedSegmentId,
  });

  const id = `inc-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO incidents (
        id, reporter_id, type, description, latitude, longitude, road_segment_id,
        severity, estimated_severity, severity_confidence, severity_reasons_json,
        status, image_url, possible_duplicate, canonical_incident_id, duplicate_score, duplicate_reason,
        verified_by, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    ).run(
      id,
      reporter.userId,
      input.type,
      input.description,
      input.latitude,
      input.longitude,
      matchedSegmentId,
      input.severity,
      sevEst.estimatedSeverity,
      sevEst.confidence,
      JSON.stringify(sevEst.reasons),
      input.imageUrl || null,
      dup.possibleDuplicate ? 1 : 0,
      dup.canonicalIncidentId,
      dup.duplicateScore,
      dup.duplicateReason,
      now,
      now
    );

    if (dup.possibleDuplicate && dup.canonicalIncidentId) {
      db.prepare(
        `INSERT INTO incident_matches (
          id, submitted_incident_id, canonical_incident_id, similarity_score, distance_meters, reason, review_outcome, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?)`
      ).run(
        `match-${crypto.randomUUID().slice(0, 10)}`,
        id,
        dup.canonicalIncidentId,
        dup.duplicateScore || 0.5,
        dup.distanceMeters || 0,
        dup.duplicateReason || 'Nearby matching report',
        now
      );
    }

    recordAuditLog(db, {
      actorId: reporter.userId,
      actorEmail: reporter.email,
      action: 'INCIDENT_REPORTED',
      targetType: 'INCIDENT',
      targetId: id,
      beforeSummary: 'None',
      afterSummary: `type=${input.type}, status=PENDING, dup=${dup.possibleDuplicate}`,
    });
  });

  tx();

  const createdRow = db
    .prepare(
      `SELECT i.*, s.name as road_segment_name
       FROM incidents i
       LEFT JOIN road_segments s ON s.id = i.road_segment_id
       WHERE i.id = ?`
    )
    .get(id);

  const dto = mapIncident(createdRow, false);

  // Broadcast to authorized admin review workflow (full operational DTO)
  broadcastEvent('admin:ops', 'incident:created', dto);
  broadcastEvent(`user:${reporter.userId}`, 'incident:created', dto);

  // Broadcast sanitized notification to public traffic room (no reporter PII)
  broadcastEvent('public:traffic', 'incident:reported', {
    id: dto.id,
    type: dto.type,
    description: dto.description,
    latitude: dto.latitude,
    longitude: dto.longitude,
    roadSegmentId: dto.roadSegmentId,
    roadSegmentName: dto.roadSegmentName,
    severity: dto.severity,
    estimatedSeverity: dto.estimatedSeverity,
    status: dto.status,
    possibleDuplicate: dto.possibleDuplicate,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    isSimulated: true,
  });

  return dto;
}

export function listIncidents(
  db: Database.Database,
  viewer: { userId?: string; role?: UserRole },
  filters: {
    status?: string;
    type?: string;
    severity?: string;
    search?: string;
    onlyDuplicates?: boolean;
  }
): IncidentDTO[] {
  const isPrivileged =
    viewer.role === 'ADMIN' ||
    viewer.role === 'SIGNAL_OPERATOR' ||
    viewer.role === 'EMERGENCY_OPERATOR';

  let sql = `
    SELECT i.*, s.name as road_segment_name, u.name as reporter_name
    FROM incidents i
    LEFT JOIN road_segments s ON s.id = i.road_segment_id
    LEFT JOIN users u ON u.id = i.reporter_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (!isPrivileged) {
    // Public/commuters see VERIFIED/RESOLVED incidents plus their own submitted reports
    if (viewer.userId) {
      sql += ` AND (i.status IN ('VERIFIED', 'RESOLVED') OR i.reporter_id = ?)`;
      params.push(viewer.userId);
    } else {
      sql += ` AND i.status IN ('VERIFIED', 'RESOLVED')`;
    }
  }

  if (filters.status && filters.status !== 'ALL') {
    sql += ` AND i.status = ?`;
    params.push(filters.status);
  }
  if (filters.type && filters.type !== 'ALL') {
    sql += ` AND i.type = ?`;
    params.push(filters.type);
  }
  if (filters.severity && filters.severity !== 'ALL') {
    sql += ` AND i.severity = ?`;
    params.push(filters.severity);
  }
  if (filters.onlyDuplicates) {
    sql += ` AND i.possible_duplicate = 1`;
  }
  if (filters.search) {
    sql += ` AND (LOWER(i.description) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ?)`;
    const term = `%${filters.search.toLowerCase()}%`;
    params.push(term, term);
  }

  sql += ` ORDER BY i.created_at DESC`;

  const rows = db.prepare(sql).all(...params) as Array<any>;
  return rows.map((r) => mapIncident(r, isPrivileged));
}

export function getIncidentById(
  db: Database.Database,
  incidentId: string,
  viewerRole?: UserRole
): { incident: IncidentDTO; matches: Array<any> } {
  const isPrivileged =
    viewerRole === 'ADMIN' ||
    viewerRole === 'SIGNAL_OPERATOR' ||
    viewerRole === 'EMERGENCY_OPERATOR';

  const row = db
    .prepare(
      `SELECT i.*, s.name as road_segment_name, u.name as reporter_name
       FROM incidents i
       LEFT JOIN road_segments s ON s.id = i.road_segment_id
       LEFT JOIN users u ON u.id = i.reporter_id
       WHERE i.id = ?`
    )
    .get(incidentId) as any;

  if (!row) throw notFound(`Incident '${incidentId}' not found`);

  const matches = db
    .prepare(
      `SELECT m.*, c.description as canonical_description, c.type as canonical_type, c.status as canonical_status
       FROM incident_matches m
       JOIN incidents c ON c.id = m.canonical_incident_id
       WHERE m.submitted_incident_id = ? OR m.canonical_incident_id = ?
       ORDER BY m.created_at DESC`
    )
    .all(incidentId, incidentId);

  return {
    incident: mapIncident(row, isPrivileged),
    matches,
  };
}

export function reviewIncidentStatus(
  db: Database.Database,
  incidentId: string,
  actor: { userId: string; email: string },
  input: {
    status: Exclude<IncidentStatus, 'PENDING'>;
    severity?: IncidentSeverity;
    note?: string;
    applyRoadClosure?: boolean;
  }
): IncidentDTO {
  const existing = db
    .prepare('SELECT * FROM incidents WHERE id = ?')
    .get(incidentId) as any;
  if (!existing) throw notFound(`Incident '${incidentId}' not found`);

  if (existing.status === input.status && !input.severity) {
    throw conflict(`Incident is already in '${input.status}' state`);
  }

  const now = new Date().toISOString();
  const nextSeverity = input.severity || existing.severity;
  const resolvedAt = input.status === 'RESOLVED' ? now : existing.resolved_at;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE incidents
       SET status = ?, severity = ?, verified_by = ?, updated_at = ?, resolved_at = ?
       WHERE id = ?`
    ).run(input.status, nextSeverity, actor.userId, now, resolvedAt, incidentId);

    if (existing.road_segment_id) {
      if (
        input.status === 'VERIFIED' &&
        (input.applyRoadClosure ||
          existing.type === 'ROADBLOCK' ||
          existing.type === 'FLOODING' ||
          nextSeverity === 'CRITICAL')
      ) {
        db.prepare(
          `UPDATE road_segments SET closure_status = 'CLOSED', current_congestion = MIN(0.96, current_congestion + 0.25) WHERE id = ?`
        ).run(existing.road_segment_id);
      } else if (input.status === 'VERIFIED' && existing.type === 'ACCIDENT') {
        db.prepare(
          `UPDATE road_segments SET closure_status = 'LANE_RESTRICTED', current_congestion = MIN(0.95, current_congestion + 0.20) WHERE id = ?`
        ).run(existing.road_segment_id);
      } else if (input.status === 'RESOLVED') {
        db.prepare(
          `UPDATE road_segments SET closure_status = 'OPEN' WHERE id = ?`
        ).run(existing.road_segment_id);
      }
    }

    if (existing.possible_duplicate) {
      db.prepare(
        `UPDATE incident_matches SET review_outcome = ?, reviewed_by = ? WHERE submitted_incident_id = ?`
      ).run(input.status, actor.userId, incidentId);
    }

    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `INCIDENT_${input.status}`,
      targetType: 'INCIDENT',
      targetId: incidentId,
      beforeSummary: `status=${existing.status}, severity=${existing.severity}`,
      afterSummary: `status=${input.status}, severity=${nextSeverity}${input.note ? `, note=${input.note}` : ''}`,
    });
  });

  tx();

  const updatedRow = db
    .prepare(
      `SELECT i.*, s.name as road_segment_name
       FROM incidents i
       LEFT JOIN road_segments s ON s.id = i.road_segment_id
       WHERE i.id = ?`
    )
    .get(incidentId);

  const dto = mapIncident(updatedRow, false);

  if (input.status === 'VERIFIED') {
    broadcastEvent('public:traffic', 'incident:verified', dto);
    if (dto.roadSegmentId) {
      broadcastEvent('public:traffic', 'road:status-changed', {
        segmentId: dto.roadSegmentId,
        incidentId: dto.id,
        status: input.status,
      });
    }
  } else if (input.status === 'RESOLVED') {
    broadcastEvent('public:traffic', 'incident:resolved', dto);
    if (dto.roadSegmentId) {
      broadcastEvent('public:traffic', 'road:status-changed', {
        segmentId: dto.roadSegmentId,
        incidentId: dto.id,
        status: 'RESOLVED',
      });
    }
  }

  broadcastEvent('admin:ops', 'incident:updated', dto);
  broadcastEvent(`user:${dto.reporterId}`, 'incident:updated', dto);

  return dto;
}

export function runIncidentImpactAnalysis(
  db: Database.Database,
  incidentId: string
): NetworkImpactResultDTO {
  const inc = db
    .prepare('SELECT * FROM incidents WHERE id = ?')
    .get(incidentId) as any;
  if (!inc) throw notFound(`Incident '${incidentId}' not found`);

  const targetSegmentId =
    inc.road_segment_id || findNearestRoadSegmentId(db, inc.latitude, inc.longitude);
  if (!targetSegmentId) {
    throw badRequest('Incident is not mapped to any road segment in the city network');
  }

  return analyzeNetworkImpact(db, incidentId, targetSegmentId, 'CLOSED');
}
