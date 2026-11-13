import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UserRole } from '../../shared/types.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function verifyAccessToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as AuthPayload & { type?: string };
  if (!decoded || !decoded.userId || !decoded.role) {
    throw unauthorized('Invalid access token');
  }
  return {
    userId: decoded.userId,
    email: decoded.email,
    role: decoded.role,
    name: decoded.name,
  };
}

export function authenticateJWT(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7).trim();
  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return next(unauthorized('Access token expired or invalid'));
  }
}

export function optionalJWT(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // Ignore invalid optional token and continue as anonymous
    }
  }
  next();
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(unauthorized('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        forbidden(
          `Role ${req.user.role} is not authorized. Required: ${allowedRoles.join(', ')}`
        )
      );
    }
    return next();
  };
}
