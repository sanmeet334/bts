import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

router.get('/health', (_req, res) => {
  const db = getDb();
  const nodeCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM road_nodes').get() as { cnt: number }
  ).cnt;
  const segCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM road_segments').get() as { cnt: number }
  ).cnt;

  return sendSuccess(
    res,
    {
      status: 'healthy',
      service: 'TRAFFIX API',
      database: 'connected',
      graphLoaded: nodeCount > 0 && segCount > 0,
      nodesCount: nodeCount,
      segmentsCount: segCount,
      mode: 'SIMULATED_BASELINE',
    },
    'TRAFFIX service operational'
  );
});

router.get('/docs', (_req, res) => {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'TRAFFIX — Intelligent Traffic Management & Route Optimization API',
      version: '1.0.0',
      description:
        'REST & Socket.IO backend for multi-factor Dijkstra/A* routing, intelligent incident duplicate detection, 15/30-minute congestion prediction, closure simulation, adaptive signal timing, and emergency priority routing.',
    },
    paths: {
      '/api/health': { get: { summary: 'Service & DB health check', security: [] } },
      '/api/auth/register': { post: { summary: 'Register commuter or emergency operator account' } },
      '/api/auth/login': { post: { summary: 'Authenticate and receive JWT access & refresh tokens' } },
      '/api/auth/me': { get: { summary: 'Retrieve current authenticated user profile' } },
      '/api/routes/network': { get: { summary: 'Fetch effective road nodes and segments' } },
      '/api/routes/geocode': { get: { summary: 'Geocode place name or lat,lng coordinates' } },
      '/api/routes/alternatives': { get: { summary: 'Calculate Shortest, Fastest, and Recommended routes' } },
      '/api/incidents': {
        get: { summary: 'List/filter incidents (role-scoped)' },
        post: { summary: 'Submit incident report with duplicate detection & severity estimation' },
      },
      '/api/incidents/{id}/status': { patch: { summary: 'Admin review: verify, reject, or resolve incident' } },
      '/api/incidents/{id}/impact-analysis': { post: { summary: 'Run k-hop connected road network impact analysis' } },
      '/api/simulations/closures': { post: { summary: 'Start non-destructive road closure/lane-blockage simulation' } },
      '/api/simulations/{id}/end': { post: { summary: 'End simulation scenario and restore baseline' } },
      '/api/predictions': { get: { summary: 'Fetch latest 15-min and 30-min segment forecasts' } },
      '/api/predictions/run': { post: { summary: 'Run chronological train/test regression prediction pipeline' } },
      '/api/signals/junctions': { get: { summary: 'List monitored signalized junctions' } },
      '/api/signals/optimize': { post: { summary: 'Compute bounded adaptive phase plan and before/after simulation' } },
      '/api/signals/plans/{id}/approve': { post: { summary: 'Record operator approval of simulated signal plan' } },
      '/api/emergency/trips': {
        get: { summary: 'List emergency priority trips' },
        post: { summary: 'Create emergency trip and compute priority corridor' },
      },
      '/api/emergency/trips/{id}/status': { patch: { summary: 'Update emergency trip status' } },
      '/api/analytics/public-summary': { get: { summary: 'Fetch public network summary metrics' } },
      '/api/analytics/historical': { get: { summary: 'Fetch aggregated historical traffic metrics across time intervals' } },
      '/api/analytics/overview': { get: { summary: 'Fetch operational metrics and KPIs' } },
      '/api/analytics/audit-logs': { get: { summary: 'Fetch immutable audit trail (Admin only)' } },
      '/api/analytics/export/csv': { get: { summary: 'Download operational summary CSV' } },
    },
  };
  return sendSuccess(res, spec, 'OpenAPI 3.0 specification');
});

export default router;
