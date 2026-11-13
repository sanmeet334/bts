import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticateJWT } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import {
  getUserProfile,
  loginUser,
  refreshUserTokens,
  registerUser,
  updateUserProfile,
} from '../services/authService.js';
import { sendSuccess } from '../utils/response.js';
import {
  loginSchema,
  profileUpdateSchema,
  refreshSchema,
  registerSchema,
} from '../validators/schemas.js';

const router = Router();

router.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  (req, res, next) => {
    try {
      const result = registerUser(getDb(), req.body);
      return sendSuccess(res, result, 'Account created successfully', 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/login', authRateLimiter, validateBody(loginSchema), (req, res, next) => {
  try {
    const result = loginUser(getDb(), req.body.email, req.body.password);
    return sendSuccess(res, result, 'Authenticated successfully', 200);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', validateBody(refreshSchema), (req, res, next) => {
  try {
    const result = refreshUserTokens(getDb(), req.body.refreshToken);
    return sendSuccess(res, result, 'Tokens refreshed', 200);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticateJWT, (req, res, next) => {
  try {
    const user = getUserProfile(getDb(), req.user!.userId);
    return sendSuccess(res, { user }, 'Current profile retrieved', 200);
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/me',
  authenticateJWT,
  validateBody(profileUpdateSchema),
  (req, res, next) => {
    try {
      const user = updateUserProfile(getDb(), req.user!.userId, req.body.name);
      return sendSuccess(res, { user }, 'Profile updated', 200);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
