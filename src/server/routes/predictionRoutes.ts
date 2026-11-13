import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT, optionalJWT, requireRoles } from '../middleware/auth.js';
import { writeRateLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import {
  executePredictionRun,
  getLatestPredictions,
} from '../services/predictionService.js';
import { sendSuccess } from '../utils/response.js';
import { predictionRunSchema } from '../validators/schemas.js';

const router = Router();

router.get('/', optionalJWT, (req, res, next) => {
  try {
    const horizonParam = req.query.horizon ? Number(req.query.horizon) : undefined;
    const segmentId = req.query.segmentId ? String(req.query.segmentId) : undefined;
    const data = getLatestPredictions(getDb(), {
      horizon: horizonParam === 15 || horizonParam === 30 ? horizonParam : undefined,
      segmentId,
    });
    return sendSuccess(res, data, 'Traffic predictions retrieved');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/run',
  authenticateJWT,
  requireRoles('ADMIN', 'SIGNAL_OPERATOR'),
  writeRateLimiter,
  validateBody(predictionRunSchema),
  (req, res, next) => {
    try {
      const result = executePredictionRun(
        getDb(),
        { userId: req.user!.userId, email: req.user!.email },
        req.body
      );
      return sendSuccess(res, result, '15/30-minute congestion prediction pipeline completed', 201);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
