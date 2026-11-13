import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts. Please try again shortly.',
    },
  },
});

export const writeRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isTest ? 1000 : 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many write requests. Please slow down and try again.',
    },
  },
});
