import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  calculateRoutes,
  deleteSavedRoute,
  evaluateExternalRoutes,
  geocodeQuery,
  getNetworkSnapshot,
  listSavedRoutes,
  reverseGeocodeQuery,
  saveUserRoute,
} from '../services/routeService.js';
import { sendSuccess } from '../utils/response.js';
import {
  evaluateRoutesBodySchema,
  idParamSchema,
  reverseGeocodeQuerySchema,
  routeAlternativesQuerySchema,
  saveRouteSchema,
} from '../validators/schemas.js';

const router = Router();

router.get('/network', (_req, res, next) => {
  try {
    const data = getNetworkSnapshot(getDb());
    return sendSuccess(res, data, 'Road network graph retrieved');
  } catch (err) {
    next(err);
  }
});

router.get('/geocode', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const data = await geocodeQuery(getDb(), q);
    return sendSuccess(res, data, 'Geocoding completed');
  } catch (err) {
    next(err);
  }
});

router.get(
  '/reverse-geocode',
  validateQuery(reverseGeocodeQuerySchema),
  async (_req, res, next) => {
    try {
      const { lat, lng } = res.locals.validatedQuery;
      const data = await reverseGeocodeQuery(getDb(), lat, lng);
      return sendSuccess(res, data, 'Reverse geocoding completed');
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/alternatives',
  validateQuery(routeAlternativesQuerySchema),
  async (_req, res, next) => {
    try {
      const q = res.locals.validatedQuery;
      const result = await calculateRoutes(getDb(), q);
      return sendSuccess(res, result, 'Route alternatives calculated');
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/evaluate',
  validateBody(evaluateRoutesBodySchema),
  (req, res, next) => {
    try {
      const result = evaluateExternalRoutes(getDb(), req.body);
      return sendSuccess(res, result, 'Google Routes candidates evaluated against TRAFFIX graph');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/saved', authenticateJWT, (req, res, next) => {
  try {
    const routes = listSavedRoutes(getDb(), req.user!.userId);
    return sendSuccess(res, { routes }, 'Saved routes retrieved');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/saved',
  authenticateJWT,
  validateBody(saveRouteSchema),
  (req, res, next) => {
    try {
      const saved = saveUserRoute(getDb(), req.user!.userId, req.body);
      return sendSuccess(res, saved, 'Route saved', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/saved/:id',
  authenticateJWT,
  validateParams(idParamSchema),
  (req, res, next) => {
    try {
      const result = deleteSavedRoute(getDb(), req.user!.userId, req.params.id);
      return sendSuccess(res, result, 'Saved route deleted');
    } catch (err) {
      next(err);
    }
  }
);

export default router;
