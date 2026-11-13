import Database from 'better-sqlite3';
import { AnalyticsOverviewDTO, AuditLogDTO } from '../../shared/types.js';
import { buildEffectiveGraph } from '../algorithms/graph.js';

export function getAnalyticsOverview(db: Database.Database): AnalyticsOverviewDTO {
  const graph = buildEffectiveGraph(db);

  const totalSegments = graph.segments.length;
  const openSegments = graph.segments.filter(
    (s) => s.effectiveClosureStatus === 'OPEN'
  ).length;
  const restrictedSegments = graph.segments.filter(
    (s) => s.effectiveClosureStatus === 'LANE_RESTRICTED'
  ).length;
  const closedSegments = graph.segments.filter(
    (s) => s.effectiveClosureStatus === 'CLOSED'
  ).length;

  const avgCongestionPct = Math.round(
    (graph.segments.reduce((sum, s) => sum + s.currentCongestion, 0) /
      Math.max(1, totalSegments)) *
      100
  );

  const avgSpeedKmh = Number(
    (
      graph.segments.reduce(
        (sum, s) =>
          sum +
          (s.effectiveClosureStatus === 'CLOSED'
            ? 0
            : s.speedLimitKmh * (1 - s.currentCongestion * 0.68)),
        0
      ) / Math.max(1, totalSegments)
    ).toFixed(1)
  );

  const incRows = db
    .prepare('SELECT status, COUNT(*) as cnt FROM incidents GROUP BY status')
    .all() as Array<{ status: string; cnt: number }>;
  const incByStatus = new Map(incRows.map((r) => [r.status, r.cnt]));
  const dupCount = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM incidents WHERE possible_duplicate = 1')
      .get() as { cnt: number }
  ).cnt;
  const totalIncidents = incRows.reduce((s, r) => s + r.cnt, 0);

  const topAffectedRoads = [...graph.segments]
    .sort(
      (a, b) =>
        b.currentCongestion + b.activeIncidentCount * 0.2 -
        (a.currentCongestion + a.activeIncidentCount * 0.2)
    )
    .slice(0, 6)
    .map((s) => ({
      id: s.id,
      name: s.name,
      currentCongestion: s.currentCongestion,
      closureStatus: s.effectiveClosureStatus,
      activeIncidentCount: s.activeIncidentCount,
    }));

  const latestPredAt = (
    db
      .prepare('SELECT MAX(predicted_at) as latest FROM traffic_predictions')
      .get() as { latest: string | null }
  ).latest;

  let avg15MinRisk = 0;
  let avg30MinRisk = 0;
  let modelVersion = 'TRAFFIX-LinReg-v1.2-SimulatedBaseline';
  let maeEstimate = 0.048;
  let rmseEstimate = 0.062;
  let dataSource = 'SIMULATED_HISTORICAL_OBSERVATIONS';

  if (latestPredAt) {
    const predStats = db
      .prepare(
        `SELECT horizon_minutes, AVG(risk_score) as avg_risk, MAX(model_version) as mv, MAX(mae_estimate) as mae, MAX(rmse_estimate) as rmse, MAX(data_source) as ds
         FROM traffic_predictions WHERE predicted_at = ? GROUP BY horizon_minutes`
      )
      .all(latestPredAt) as Array<any>;
    for (const p of predStats) {
      if (p.horizon_minutes === 15) avg15MinRisk = Math.round(p.avg_risk);
      if (p.horizon_minutes === 30) avg30MinRisk = Math.round(p.avg_risk);
      modelVersion = p.mv;
      maeEstimate = p.mae;
      rmseEstimate = p.rmse;
      dataSource = p.ds;
    }
  }

  const sigRows = db
    .prepare('SELECT status, before_metrics_json, after_metrics_json FROM signal_plans')
    .all() as Array<any>;
  const approvedSimulations = sigRows.filter(
    (s) => s.status === 'APPROVED_SIMULATION'
  ).length;
  let waitReductionSum = 0;
  for (const s of sigRows) {
    const before = JSON.parse(s.before_metrics_json);
    const after = JSON.parse(s.after_metrics_json);
    if (before.avgWaitTimeSec > 0) {
      waitReductionSum +=
        ((before.avgWaitTimeSec - after.avgWaitTimeSec) / before.avgWaitTimeSec) * 100;
    }
  }

  const tripRows = db
    .prepare('SELECT status, time_saved_min FROM emergency_trips')
    .all() as Array<{ status: string; time_saved_min: number }>;
  const activeTrips = tripRows.filter((t) =>
    ['ACTIVE', 'EN_ROUTE', 'REQUESTED'].includes(t.status)
  ).length;
  const completedTrips = tripRows.filter((t) => t.status === 'COMPLETED').length;
  const avgTimeSavedMin =
    tripRows.length > 0
      ? Number(
          (
            tripRows.reduce((s, t) => s + t.time_saved_min, 0) / tripRows.length
          ).toFixed(1)
        )
      : 0;

  return {
    networkSummary: {
      totalSegments,
      openSegments,
      restrictedSegments,
      closedSegments,
      avgCongestionPct,
      avgSpeedKmh,
      activeSimulations: graph.activeSimulationsCount,
      isSimulated: true,
    },
    incidentStats: {
      total: totalIncidents,
      pending: incByStatus.get('PENDING') ?? 0,
      underReview: incByStatus.get('UNDER_REVIEW') ?? 0,
      verified: incByStatus.get('VERIFIED') ?? 0,
      rejected: incByStatus.get('REJECTED') ?? 0,
      resolved: incByStatus.get('RESOLVED') ?? 0,
      possibleDuplicates: dupCount,
    },
    topAffectedRoads,
    predictionStats: {
      latestRunAt: latestPredAt,
      avg15MinRisk,
      avg30MinRisk,
      modelVersion,
      maeEstimate,
      rmseEstimate,
      dataSource,
    },
    signalStats: {
      totalPlans: sigRows.length,
      approvedSimulations,
      avgWaitReductionPct:
        sigRows.length > 0 ? Math.round(waitReductionSum / sigRows.length) : 0,
    },
    emergencyStats: {
      totalTrips: tripRows.length,
      activeTrips,
      completedTrips,
      avgTimeSavedMin,
    },
  };
}

export function listAuditLogs(db: Database.Database, limit = 60): AuditLogDTO[] {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<any>;

  return rows.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    beforeSummary: r.before_summary,
    afterSummary: r.after_summary,
    createdAt: r.created_at,
  }));
}

export function exportOperationalCsv(db: Database.Database): string {
  const graph = buildEffectiveGraph(db);
  const incidents = db
    .prepare(
      `SELECT id, type, severity, status, road_segment_id, possible_duplicate, created_at FROM incidents ORDER BY created_at DESC`
    )
    .all() as Array<any>;

  const lines: string[] = [
    'SECTION,ID,NAME_OR_TYPE,METRIC_1,METRIC_2,STATUS,PROVENANCE',
  ];

  for (const s of graph.segments) {
    lines.push(
      `ROAD_SEGMENT,"${s.id}","${s.name.replace(/"/g, '""')}",congestion=${Math.round(
        s.currentCongestion * 100
      )}%,speedLimit=${s.speedLimitKmh}kmh,${s.effectiveClosureStatus},SIMULATED_GRAPH`
    );
  }

  for (const inc of incidents) {
    lines.push(
      `INCIDENT,"${inc.id}","${inc.type}",severity=${inc.severity},duplicate=${Boolean(
        inc.possible_duplicate
      )},${inc.status},${inc.created_at}`
    );
  }

  return lines.join('\n');
}

export function getHistoricalTrafficAnalytics(
  db: Database.Database,
  options?: {
    window?: '6H' | '12H' | '24H';
    bucketHours?: 2 | 4 | 6;
    segmentId?: string | null;
  }
) {
  const window: '6H' | '12H' | '24H' =
    options?.window === '6H' || options?.window === '12H' ? options.window : '24H';
  const bucketHours: 2 | 4 | 6 =
    options?.bucketHours === 4 || options?.bucketHours === 6 ? options.bucketHours : 2;
  const selectedSegmentId = options?.segmentId ? String(options.segmentId) : null;

  const windowHours = window === '6H' ? 6 : window === '12H' ? 12 : 24;

  const segRows = db
    .prepare(
      'SELECT id, name, length_meters, speed_limit_kmh FROM road_segments ORDER BY name ASC'
    )
    .all() as Array<{
    id: string;
    name: string;
    length_meters: number;
    speed_limit_kmh: number;
  }>;

  const availableSegments = segRows.map((s) => ({ id: s.id, name: s.name }));

  const latestObs = db
    .prepare('SELECT MAX(observed_at) as latest FROM traffic_observations')
    .get() as { latest: string | null };

  const anchorMs = latestObs?.latest ? Date.parse(latestObs.latest) : Date.now();
  const cutoffMs = anchorMs - windowHours * 3600 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const baseQuery = `
    SELECT o.segment_id, o.observed_at, o.vehicle_count, o.average_speed_kmh, o.queue_length,
           o.source, s.name as segment_name, s.length_meters, s.speed_limit_kmh
    FROM traffic_observations o
    JOIN road_segments s ON s.id = o.segment_id
    WHERE o.observed_at >= ?
    ${selectedSegmentId ? 'AND o.segment_id = ?' : ''}
    ORDER BY o.observed_at ASC
  `;

  const obsRows = (
    selectedSegmentId
      ? db.prepare(baseQuery).all(cutoffIso, selectedSegmentId)
      : db.prepare(baseQuery).all(cutoffIso)
  ) as Array<{
    segment_id: string;
    observed_at: string;
    vehicle_count: number;
    average_speed_kmh: number;
    queue_length: number;
    source: string;
    segment_name: string;
    length_meters: number;
    speed_limit_kmh: number;
  }>;

  const bucketMs = bucketHours * 3600 * 1000;
  const numBuckets = Math.max(1, Math.ceil(windowHours / bucketHours));
  // Align buckets ending at anchorMs
  const seriesStartMs = anchorMs - (numBuckets - 1) * bucketMs - bucketMs / 2;

  const buckets = new Map<
    number,
    {
      startMs: number;
      endMs: number;
      congestionSum: number;
      peakCongestionPct: number;
      speedSum: number;
      travelTimeSum: number;
      freeFlowTimeSum: number;
      delaySum: number;
      queueSum: number;
      vehicleSum: number;
      count: number;
    }
  >();

  for (let i = 0; i < numBuckets; i++) {
    const startMs = seriesStartMs + i * bucketMs;
    buckets.set(i, {
      startMs,
      endMs: startMs + bucketMs,
      congestionSum: 0,
      peakCongestionPct: 0,
      speedSum: 0,
      travelTimeSum: 0,
      freeFlowTimeSum: 0,
      delaySum: 0,
      queueSum: 0,
      vehicleSum: 0,
      count: 0,
    });
  }

  const corridorAccum = new Map<
    string,
    {
      segmentId: string;
      segmentName: string;
      congestionSum: number;
      speedSum: number;
      travelTimeSum: number;
      delaySum: number;
      count: number;
    }
  >();

  let totalCongestionSum = 0;
  let totalSpeedSum = 0;
  let totalTravelTimeSum = 0;
  let totalDelaySum = 0;
  let dataSource = 'SIMULATED_HISTORICAL_PROFILE';

  for (const row of obsRows) {
    const obsMs = Date.parse(row.observed_at);
    const speedLimit = Math.max(8, row.speed_limit_kmh || 40);
    const avgSpeed = Math.max(8, row.average_speed_kmh || speedLimit);
    const lengthKm = Math.max(0.05, (row.length_meters || 1000) / 1000);

    const speedDerivedDensity = (1 - avgSpeed / speedLimit) / 0.68;
    const queueDerivedDensity = (row.queue_length || 0) / 28;
    const density = Math.min(
      0.98,
      Math.max(0.05, avgSpeed <= 8.5 ? Math.max(speedDerivedDensity, queueDerivedDensity) : speedDerivedDensity)
    );
    const congestionPct = Math.round(density * 100);

    const freeFlowMin = (lengthKm / speedLimit) * 60;
    const travelTimeMin = (lengthKm / avgSpeed) * 60;
    const delayMin = Math.max(0, travelTimeMin - freeFlowMin);

    if (row.source) dataSource = row.source;

    totalCongestionSum += congestionPct;
    totalSpeedSum += avgSpeed;
    totalTravelTimeSum += travelTimeMin;
    totalDelaySum += delayMin;

    const rawIdx = Math.floor((obsMs - seriesStartMs) / bucketMs);
    const idx = Math.min(numBuckets - 1, Math.max(0, rawIdx));
    const b = buckets.get(idx)!;
    b.congestionSum += congestionPct;
    b.peakCongestionPct = Math.max(b.peakCongestionPct, congestionPct);
    b.speedSum += avgSpeed;
    b.travelTimeSum += travelTimeMin;
    b.freeFlowTimeSum += freeFlowMin;
    b.delaySum += delayMin;
    b.queueSum += row.queue_length || 0;
    b.vehicleSum += row.vehicle_count || 0;
    b.count += 1;

    const c = corridorAccum.get(row.segment_id) || {
      segmentId: row.segment_id,
      segmentName: row.segment_name,
      congestionSum: 0,
      speedSum: 0,
      travelTimeSum: 0,
      delaySum: 0,
      count: 0,
    };
    c.congestionSum += congestionPct;
    c.speedSum += avgSpeed;
    c.travelTimeSum += travelTimeMin;
    c.delaySum += delayMin;
    c.count += 1;
    corridorAccum.set(row.segment_id, c);
  }

  const formatHm = (ms: number) => {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const series = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([idx, b]) => {
      const centerMs = b.startMs + bucketMs / 2;
      const label =
        bucketHours === 2
          ? formatHm(centerMs)
          : `${formatHm(b.startMs)}–${formatHm(b.endMs)}`;
      const denom = Math.max(1, b.count);
      return {
        bucketKey: `bucket-${idx}`,
        label,
        startIso: new Date(b.startMs).toISOString(),
        endIso: new Date(b.endMs).toISOString(),
        observationCount: b.count,
        avgCongestionPct: b.count > 0 ? Math.round(b.congestionSum / denom) : 0,
        avgSpeedKmh: b.count > 0 ? Number((b.speedSum / denom).toFixed(1)) : 0,
        avgTravelTimeMin: b.count > 0 ? Number((b.travelTimeSum / denom).toFixed(2)) : 0,
        freeFlowTravelTimeMin: b.count > 0 ? Number((b.freeFlowTimeSum / denom).toFixed(2)) : 0,
        avgDelayMin: b.count > 0 ? Number((b.delaySum / denom).toFixed(2)) : 0,
        avgQueueLength: b.count > 0 ? Number((b.queueSum / denom).toFixed(1)) : 0,
        totalVehicleCount: b.vehicleSum,
        peakCongestionPct: b.peakCongestionPct,
      };
    });

  const nonEmptySeries = series.filter((s) => s.observationCount > 0);
  const peakBucket = nonEmptySeries.reduce<(typeof series)[number] | null>(
    (best, cur) => (!best || cur.avgCongestionPct > best.avgCongestionPct ? cur : best),
    null
  );
  const congestionDeltaPct =
    nonEmptySeries.length >= 2
      ? nonEmptySeries[nonEmptySeries.length - 1].avgCongestionPct -
        nonEmptySeries[0].avgCongestionPct
      : 0;

  const topCorridors = Array.from(corridorAccum.values())
    .map((c) => {
      const denom = Math.max(1, c.count);
      return {
        segmentId: c.segmentId,
        segmentName: c.segmentName,
        avgCongestionPct: Math.round(c.congestionSum / denom),
        avgSpeedKmh: Number((c.speedSum / denom).toFixed(1)),
        avgTravelTimeMin: Number((c.travelTimeSum / denom).toFixed(2)),
        avgDelayMin: Number((c.delaySum / denom).toFixed(2)),
        observationCount: c.count,
      };
    })
    .sort((a, b) => b.avgCongestionPct - a.avgCongestionPct || b.avgDelayMin - a.avgDelayMin)
    .slice(0, 8);

  const totalObservations = obsRows.length;
  const totalDenom = Math.max(1, totalObservations);

  return {
    window,
    bucketHours,
    selectedSegmentId,
    availableSegments,
    summary: {
      totalObservations,
      avgCongestionPct: totalObservations > 0 ? Math.round(totalCongestionSum / totalDenom) : 0,
      avgSpeedKmh: totalObservations > 0 ? Number((totalSpeedSum / totalDenom).toFixed(1)) : 0,
      avgTravelTimeMin:
        totalObservations > 0 ? Number((totalTravelTimeSum / totalDenom).toFixed(2)) : 0,
      avgDelayMin: totalObservations > 0 ? Number((totalDelaySum / totalDenom).toFixed(2)) : 0,
      peakBucketLabel: peakBucket ? peakBucket.label : null,
      peakCongestionPct: peakBucket ? peakBucket.avgCongestionPct : 0,
      congestionDeltaPct,
      isSimulated: true,
      dataSource,
    },
    series: nonEmptySeries.length > 0 ? nonEmptySeries : series,
    topCorridors,
  };
}

