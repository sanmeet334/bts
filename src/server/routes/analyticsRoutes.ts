import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT, requireRoles } from '../middleware/auth.js';
import {
  exportOperationalCsv,
  getAnalyticsOverview,
  getHistoricalTrafficAnalytics,
  listAuditLogs,
} from '../services/analyticsService.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

router.get(
  '/overview',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR', 'EMERGENCY_OPERATOR'),
  (_req, res, next) => {
    try {
      const overview = getAnalyticsOverview(getDb());
      return sendSuccess(res, overview, 'Operational overview retrieved');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/public-summary', (_req, res, next) => {
  try {
    const overview = getAnalyticsOverview(getDb());
    return sendSuccess(
      res,
      {
        networkSummary: overview.networkSummary,
        verifiedIncidentsCount: overview.incidentStats.verified,
        predictionStats: overview.predictionStats,
      },
      'Public network summary retrieved'
    );
  } catch (err) {
    next(err);
  }
});

router.get('/historical', (req, res, next) => {
  try {
    const rawWindow = String(req.query.window || '24H').toUpperCase();
    const window: '6H' | '12H' | '24H' =
      rawWindow === '6H' || rawWindow === '12H' ? rawWindow : '24H';

    const rawBucket = Number(req.query.bucketHours || 2);
    const bucketHours: 2 | 4 | 6 =
      rawBucket === 4 || rawBucket === 6 ? rawBucket : 2;

    const segmentId =
      typeof req.query.segmentId === 'string' && req.query.segmentId.trim()
        ? req.query.segmentId.trim()
        : null;

    const historical = getHistoricalTrafficAnalytics(getDb(), {
      window,
      bucketHours,
      segmentId,
    });
    return sendSuccess(res, historical, 'Historical traffic analytics retrieved');
  } catch (err) {
    next(err);
  }
});

router.get(
  '/audit-logs',
  authenticateJWT,
  requireRoles('ADMIN'),
  (req, res, next) => {
    try {
      const limit = Math.min(200, Math.max(10, Number(req.query.limit || 60)));
      const logs = listAuditLogs(getDb(), limit);
      return sendSuccess(res, { logs }, 'Audit logs retrieved');
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/export/csv',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR'),
  (_req, res, next) => {
    try {
      const csv = exportOperationalCsv(getDb());
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="traffix-operational-summary.csv"'
      );
      return res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
