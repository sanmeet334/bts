import Database from 'better-sqlite3';
import crypto from 'crypto';

export function recordAuditLog(
  db: Database.Database,
  params: {
    actorId: string;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId: string;
    beforeSummary: string;
    afterSummary: string;
  }
): string {
  const id = `aud-${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, before_summary, after_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.actorId,
    params.actorEmail,
    params.action,
    params.targetType,
    params.targetId,
    params.beforeSummary,
    params.afterSummary,
    new Date().toISOString()
  );
  return id;
}
