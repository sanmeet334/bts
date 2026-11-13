import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AuthTokensDTO, UserDTO, UserRole } from '../../shared/types.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';
import { recordAuditLog } from './auditService.js';

function mapUser(row: any): UserDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function issueTokens(user: UserDTO): AuthTokensDTO {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };
  const accessToken = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessExpiresIn as any,
  });
  const refreshToken = jwt.sign(
    { ...payload, tokenType: 'refresh' },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn as any }
  );
  return { accessToken, refreshToken, user };
}

export function registerUser(
  db: Database.Database,
  input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    vehicleType?: 'AMBULANCE' | 'FIRE_TRUCK';
    registrationLabel?: string;
  }
): AuthTokensDTO {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(normalizedEmail);
  if (existing) {
    throw conflict('An account with this email address already exists');
  }

  const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(input.password, 10);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
    ).run(userId, input.name, normalizedEmail, passwordHash, input.role, now, now);

    if (input.role === 'EMERGENCY_OPERATOR') {
      const vehId = `veh-${crypto.randomUUID().slice(0, 8)}`;
      const regLabel =
        input.registrationLabel ||
        `KA-22-${input.vehicleType === 'FIRE_TRUCK' ? 'FR' : 'EM'}-${Math.floor(100 + Math.random() * 899)}`;
      db.prepare(
        `INSERT INTO emergency_vehicles (id, operator_id, vehicle_type, registration_label, available, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).run(vehId, userId, input.vehicleType || 'AMBULANCE', regLabel, now);
    }

    recordAuditLog(db, {
      actorId: userId,
      actorEmail: normalizedEmail,
      action: 'USER_REGISTERED',
      targetType: 'USER',
      targetId: userId,
      beforeSummary: 'None',
      afterSummary: `Registered role=${input.role}`,
    });
  });

  tx();

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return issueTokens(mapUser(row));
}

export function loginUser(
  db: Database.Database,
  email: string,
  password: string
): AuthTokensDTO {
  const normalizedEmail = email.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(normalizedEmail) as any;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw unauthorized('Invalid email or password');
  }

  if (row.status !== 'ACTIVE') {
    throw unauthorized('Account is currently inactive');
  }

  return issueTokens(mapUser(row));
}

export function refreshUserTokens(
  db: Database.Database,
  refreshToken: string
): AuthTokensDTO {
  let decoded: any;
  try {
    decoded = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch {
    throw unauthorized('Invalid or expired refresh token');
  }

  if (!decoded || decoded.tokenType !== 'refresh' || !decoded.userId) {
    throw unauthorized('Invalid refresh token payload');
  }

  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(decoded.userId) as any;
  if (!row || row.status !== 'ACTIVE') {
    throw unauthorized('User account no longer active');
  }

  return issueTokens(mapUser(row));
}

export function getUserProfile(db: Database.Database, userId: string): UserDTO {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) throw notFound('User profile not found');
  return mapUser(row);
}

export function updateUserProfile(
  db: Database.Database,
  userId: string,
  name: string
): UserDTO {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!existing) throw notFound('User not found');

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    now,
    userId
  );

  recordAuditLog(db, {
    actorId: userId,
    actorEmail: existing.email,
    action: 'PROFILE_UPDATED',
    targetType: 'USER',
    targetId: userId,
    beforeSummary: `name=${existing.name}`,
    afterSummary: `name=${name}`,
  });

  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}
