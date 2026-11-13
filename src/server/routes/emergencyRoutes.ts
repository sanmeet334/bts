import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT, requireRoles } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  createEmergencyTrip,
  getEmergencyTripById,
  listEmergencyTrips,
  listEmergencyVehicles,
  recalculateEmergencyPriorityRoute,
  updateEmergencyLocation,
  updateEmergencyTripStatus,
} from '../services/emergencyService.js';
import { sendSuccess } from '../utils/response.js';
import {
  createEmergencyTripSchema,
  emergencyLocationSchema,
  idParamSchema,
  updateEmergencyStatusSchema,
} from '../validators/schemas.js';

const router = Router();

router.get(
  '/vehicles',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN', 'SIGNAL_OPERATOR'),
  (req, res, next) => {
    try {
      const operatorFilter =
        req.user!.role === 'EMERGENCY_OPERATOR' ? req.user!.userId : undefined;
      const vehicles = listEmergencyVehicles(getDb(), operatorFilter);
      return sendSuccess(res, { vehicles }, 'Emergency vehicles retrieved');
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/trips',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN', 'SIGNAL_OPERATOR'),
  (_req, res, next) => {
    try {
      const trips = listEmergencyTrips(getDb());
      return sendSuccess(res, { trips }, 'Emergency trips retrieved');
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/trips',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN'),
  validateBody(createEmergencyTripSchema),
  (req, res, next) => {
    try {
      const trip = createEmergencyTrip(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, { trip }, 'Emergency priority corridor computed', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/trips/:id',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN', 'SIGNAL_OPERATOR'),
  validateParams(idParamSchema),
  (req, res, next) => {
    try {
      const trip = getEmergencyTripById(getDb(), req.params.id);
      return sendSuccess(res, { trip }, 'Emergency trip details retrieved');
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/trips/:id/status',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN'),
  validateParams(idParamSchema),
  validateBody(updateEmergencyStatusSchema),
  (req, res, next) => {
    try {
      const trip = updateEmergencyTripStatus(
        getDb(),
        req.params.id,
        { userId: req.user!.userId, email: req.user!.email },
        req.body.status,
        req.body.failureReason
      );
      return sendSuccess(res, { trip }, `Trip marked ${trip.status}`);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/trips/:id/priority-route',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN', 'SIGNAL_OPERATOR'),
  validateParams(idParamSchema),
  (req, res, next) => {
    try {
      const trip = recalculateEmergencyPriorityRoute(getDb(), req.params.id, {
        userId: req.user!.userId,
        email: req.user!.email,
      });
      return sendSuccess(res, { trip }, 'Emergency priority route recalculated');
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/trips/:id/location',
  authenticateJWT,
  requireRoles('EMERGENCY_OPERATOR', 'ADMIN'),
  validateParams(idParamSchema),
  validateBody(emergencyLocationSchema),
  (req, res, next) => {
    try {
      const trip = updateEmergencyLocation(
        getDb(),
        req.params.id,
        req.body.latitude,
        req.body.longitude
      );
      return sendSuccess(res, { trip }, 'Emergency location updated');
    } catch (err) {
      next(err);
    }
  }
);

export default router;
