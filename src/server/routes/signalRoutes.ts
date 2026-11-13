import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT, requireRoles } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  approveSignalPlanSimulation,
  listJunctions,
  listSignalPlansHistory,
  optimizeAndSimulateSignal,
} from '../services/signalService.js';
import { sendSuccess } from '../utils/response.js';
import { idParamSchema, signalOptimizeSchema } from '../validators/schemas.js';

const router = Router();

router.get('/junctions', authenticateJWT, (_req, res, next) => {
  try {
    const junctions = listJunctions(getDb());
    return sendSuccess(res, { junctions }, 'Monitored junctions retrieved');
  } catch (err) {
    next(err);
  }
});

router.get('/history', authenticateJWT, (_req, res, next) => {
  try {
    const plans = listSignalPlansHistory(getDb());
    return sendSuccess(res, { plans }, 'Signal simulation history retrieved');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/optimize',
  authenticateJWT,
  requireRoles('SIGNAL_OPERATOR', 'ADMIN'),
  validateBody(signalOptimizeSchema),
  (req, res, next) => {
    try {
      const plan = optimizeAndSimulateSignal(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, { plan }, 'Adaptive signal timing calculated and simulated', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/simulate',
  authenticateJWT,
  requireRoles('SIGNAL_OPERATOR', 'ADMIN'),
  validateBody(signalOptimizeSchema),
  (req, res, next) => {
    try {
      const plan = optimizeAndSimulateSignal(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, { plan }, 'Before/after signal simulation completed', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/plans/:id/approve',
  authenticateJWT,
  requireRoles('SIGNAL_OPERATOR', 'ADMIN'),
  validateParams(idParamSchema),
  (req, res, next) => {
    try {
      const plan = approveSignalPlanSimulation(getDb(), req.params.id, {
        userId: req.user!.userId,
        email: req.user!.email,
      });
      return sendSuccess(res, { plan }, 'Simulated signal plan approved and recorded');
    } catch (err) {
      next(err);
    }
  }
);

export default router;
