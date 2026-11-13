import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT, requireRoles } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  applyTrafficControlInputs,
  createClosureSimulation,
  endSimulationScenario,
  getSimulationById,
  listSimulations,
} from '../services/simulationService.js';
import { sendSuccess } from '../utils/response.js';
import {
  closureSimulationSchema,
  idParamSchema,
  trafficControlSimSchema,
} from '../validators/schemas.js';

const router = Router();

router.get('/', authenticateJWT, (_req, res, next) => {
  try {
    const scenarios = listSimulations(getDb());
    return sendSuccess(res, { scenarios }, 'Simulation scenarios retrieved');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/closures',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR'),
  validateBody(closureSimulationSchema),
  (req, res, next) => {
    try {
      const scenario = createClosureSimulation(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, { scenario }, 'Simulation scenario started', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/traffic-controls',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR'),
  validateBody(trafficControlSimSchema),
  (req, res, next) => {
    try {
      const result = applyTrafficControlInputs(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, result, 'Simulated traffic conditions updated');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id', authenticateJWT, validateParams(idParamSchema), (req, res, next) => {
  try {
    const scenario = getSimulationById(getDb(), req.params.id);
    return sendSuccess(res, { scenario }, 'Simulation scenario retrieved');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/end',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR'),
  validateParams(idParamSchema),
  (req, res, next) => {
    try {
      const scenario = endSimulationScenario(getDb(), req.params.id, {
        userId: req.user!.userId,
        email: req.user!.email,
      });
      return sendSuccess(res, { scenario }, 'Simulation scenario ended; network restored');
    } catch (err) {
      next(err);
    }
  }
);

export default router;
