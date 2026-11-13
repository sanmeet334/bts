import Database from 'better-sqlite3';
import { TrafficPredictionDTO } from '../../shared/types.js';
import { buildEffectiveGraph } from '../algorithms/graph.js';
import { computeRouteAlternatives } from '../algorithms/pathfinding.js';
import { classifyRiskLevel, runPredictionPipeline } from '../algorithms/predictionModel.js';
import { broadcastEvent } from '../realtime/socket.js';
import { recordAuditLog } from './auditService.js';

export function executePredictionRun(
  db: Database.Database,
  actor: { userId: string; email: string } | null,
  options?: { weatherCondition?: string; densityMultiplier?: number }
) {
  const result = runPredictionPipeline(db, options);

  if (actor) {
    recordAuditLog(db, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'PREDICTION_PIPELINE_RUN',
      targetType: 'PREDICTION_BATCH',
      targetId: result.modelVersion,
      beforeSummary: 'Previous forecast batch',
      afterSummary: `Generated ${result.predictions.length} segment forecasts (15m/30m), MAE=${result.mae}, RMSE=${result.rmse}`,
    });
  }

  broadcastEvent('public:traffic', 'traffic:prediction-updated', {
    modelVersion: result.modelVersion,
    count: result.predictions.length,
    mae: result.mae,
    rmse: result.rmse,
  });

  return result;
}

export function getLatestPredictions(
  db: Database.Database,
  filters?: { horizon?: number; segmentId?: string }
): {
  predictions: TrafficPredictionDTO[];
  modelInfo: {
    modelVersion: string;
    maeEstimate: number;
    rmseEstimate: number;
    dataSource: string;
    isSimulated: boolean;
    lastPredictedAt: string | null;
  };
} {
  // Ensure an initial batch exists if none generated yet
  const countRow = db
    .prepare('SELECT COUNT(*) as cnt FROM traffic_predictions')
    .get() as { cnt: number };
  if (countRow.cnt === 0) {
    runPredictionPipeline(db);
  }

  const latestRow = db
    .prepare('SELECT MAX(predicted_at) as latest FROM traffic_predictions')
    .get() as { latest: string | null };

  let sql = `
    SELECT p.*, s.name as segment_name
    FROM traffic_predictions p
    JOIN road_segments s ON s.id = p.segment_id
    WHERE p.predicted_at = ?
  `;
  const params: any[] = [latestRow.latest];

  if (filters?.horizon) {
    sql += ' AND p.horizon_minutes = ?';
    params.push(filters.horizon);
  }
  if (filters?.segmentId) {
    sql += ' AND p.segment_id = ?';
    params.push(filters.segmentId);
  }

  sql += ' ORDER BY p.risk_score DESC, p.horizon_minutes ASC';

  const rows = db.prepare(sql).all(...params) as Array<any>;
  const graph = buildEffectiveGraph(db);
  const segById = new Map(graph.segments.map((s) => [s.id, s]));
  const bypassCache = new Map<string, TrafficPredictionDTO['recommendedAlternative']>();

  const getPreCongestionBypass = (
    segmentId: string,
    predictedDensity: number,
    predictedSpeedKmh: number
  ): TrafficPredictionDTO['recommendedAlternative'] => {
    const cacheKey = `${segmentId}:${predictedDensity}`;
    if (bypassCache.has(cacheKey)) {
      return bypassCache.get(cacheKey)!;
    }

    const seg = segById.get(segmentId);
    if (!seg) {
      bypassCache.set(cacheKey, null);
      return null;
    }

    const bypassGraph = buildEffectiveGraph(db, {
      overrideClosures: [{ segmentId, status: 'CLOSED' }],
    });
    const alts = computeRouteAlternatives(bypassGraph, seg.startNodeId, seg.endNodeId);
    const bestBypass =
      alts.find((a) => a.category === 'RECOMMENDED') ||
      alts.find((a) => a.category === 'FASTEST') ||
      alts[0];

    if (!bestBypass) {
      bypassCache.set(cacheKey, null);
      return null;
    }

    const originName = graph.nodes.get(seg.startNodeId)?.name || seg.startNodeId;
    const destinationName = graph.nodes.get(seg.endNodeId)?.name || seg.endNodeId;
    const effectiveDirectSpeed = Math.max(8, predictedSpeedKmh || seg.speedLimitKmh * (1 - predictedDensity * 0.72));
    const directSegmentTimeMin = Number(
      (((seg.lengthMeters / 1000) / effectiveDirectSpeed) * 60).toFixed(1)
    );
    const detourSegmentNames = bestBypass.pathSegmentIds.map(
      (id) => segById.get(id)?.name || id
    );

    const rec: TrafficPredictionDTO['recommendedAlternative'] = {
      originNodeId: seg.startNodeId,
      destinationNodeId: seg.endNodeId,
      originName,
      destinationName,
      detourSegmentNames,
      detourDistanceKm: bestBypass.totalDistanceKm,
      detourEtaMin: bestBypass.estimatedTimeMin,
      directSegmentTimeMin,
      explanation: `Pre-congestion bypass between ${originName} and ${destinationName} via ${detourSegmentNames.join(' -> ')} (${bestBypass.totalDistanceKm} km, ~${bestBypass.estimatedTimeMin} min) avoiding ${seg.name} (${Math.round(predictedDensity * 100)}% predicted load).`,
    };
    bypassCache.set(cacheKey, rec);
    return rec;
  };

  const predictions: TrafficPredictionDTO[] = rows.map((r) => {
    const riskLevel = classifyRiskLevel(r.risk_score, r.predicted_density);
    const recommendedAlternative =
      riskLevel !== 'LOW'
        ? getPreCongestionBypass(r.segment_id, r.predicted_density, r.predicted_speed_kmh)
        : null;

    return {
      id: r.id,
      segmentId: r.segment_id,
      segmentName: r.segment_name,
      predictedAt: r.predicted_at,
      horizonMinutes: r.horizon_minutes,
      currentDensity: r.current_density,
      currentSpeedKmh: r.current_speed_kmh,
      predictedDensity: r.predicted_density,
      predictedSpeedKmh: r.predicted_speed_kmh,
      congestionClass: r.congestion_class,
      riskScore: r.risk_score,
      riskLevel,
      recommendedAlternative,
      modelVersion: r.model_version,
      maeEstimate: r.mae_estimate,
      rmseEstimate: r.rmse_estimate,
      dataSource: r.data_source,
      isSimulated: Boolean(r.is_simulated),
      inputSummary: JSON.parse(r.input_summary_json || '{}'),
    };
  });

  const first = predictions[0];
  return {
    predictions,
    modelInfo: {
      modelVersion: first?.modelVersion || 'TRAFFIX-LinReg-v1.2-SimulatedBaseline',
      maeEstimate: first?.maeEstimate ?? 0.048,
      rmseEstimate: first?.rmseEstimate ?? 0.062,
      dataSource: first?.dataSource || 'SIMULATED_HISTORICAL_OBSERVATIONS',
      isSimulated: true,
      lastPredictedAt: latestRow.latest,
    },
  };
}
