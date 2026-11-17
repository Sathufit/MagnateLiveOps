import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROLES } from '../shared/domain.ts';
import type { Operation, Role } from '../shared/domain.ts';

const file = resolve(process.env.DATA_FILE ?? 'data/liveops.db');
mkdirSync(dirname(file), { recursive: true });

const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, op_id TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const newId = () => randomBytes(6).toString('base64url');
export const newToken = () => randomBytes(16).toString('base64url');

const parse = (row: unknown) => JSON.parse((row as { data: string }).data) as Operation;

export function listOps(): Operation[] {
  return db.prepare('SELECT data FROM operations ORDER BY updated_at DESC').all().map(parse);
}

export function getOp(id: string): Operation | null {
  const row = db.prepare('SELECT data FROM operations WHERE id = ?').get(id);
  return row ? parse(row) : null;
}

export function saveOp(op: Operation): void {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO operations (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(op.id, JSON.stringify(op), op.updatedAt);
    db.prepare('DELETE FROM links WHERE op_id = ?').run(op.id);
    const insert = db.prepare('INSERT INTO links (token, op_id, role) VALUES (?, ?, ?)');
    for (const role of ROLES) insert.run(op.links[role].token, op.id, role);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteOp(id: string): void {
  db.prepare('DELETE FROM links WHERE op_id = ?').run(id);
  db.prepare('DELETE FROM operations WHERE id = ?').run(id);
}

export function findByToken(token: string): { op: Operation; role: Role } | null {
  const row = db.prepare('SELECT op_id, role FROM links WHERE token = ?').get(token) as
    | { op_id: string; role: Role }
    | undefined;
  if (!row) return null;
  const op = getOp(row.op_id);
  if (!op || !op.links[row.role].enabled) return null;
  return { op, role: row.role };
}

/** Sequential operation reference, e.g. MLO-2611-004. */
export function nextRef(now: Date): string {
  const yymm = now.toISOString().slice(2, 7).replace('-', '');
  const key = `seq:${yymm}`;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  const seq = (row ? Number(row.value) : 0) + 1;
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(seq),
  );
  return `MLO-${yymm}-${String(seq).padStart(3, '0')}`;
}

/* Sessions for the operations console */

const SESSION_MS = 14 * 24 * 3600 * 1000;

export function createSession(name: string): string {
  const token = randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, name, expires_at) VALUES (?, ?, ?)').run(token, name, Date.now() + SESSION_MS);
  return token;
}

export function getSession(token: string): { name: string } | null {
  const row = db.prepare('SELECT name, expires_at FROM sessions WHERE token = ?').get(token) as
    | { name: string; expires_at: number }
    | undefined;
  return row && row.expires_at > Date.now() ? { name: row.name } : null;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
