import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROLES } from '../shared/domain.ts';
import type { LinkStats, Operation, Role } from '../shared/domain.ts';
import { refFor, yymm } from './store.ts';
import type { Store } from './store.ts';

export async function openSqlite(): Promise<Store> {
  const file = resolve(process.env.DATA_FILE ?? 'data/liveops.db');
  mkdirSync(dirname(file), { recursive: true });
  // Loaded on demand so serverless deployments, which use Postgres, never touch it.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY, op_id TEXT NOT NULL, role TEXT NOT NULL,
      opens INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const parse = (row: unknown) => JSON.parse((row as { data: string }).data) as Operation;

  function syncLinks(op: Operation) {
    const tokens = ROLES.map((r) => op.links[r].token);
    db.prepare(`DELETE FROM share_links WHERE op_id = ? AND token NOT IN (${tokens.map(() => '?').join(',')})`).run(op.id, ...tokens);
    const insert = db.prepare('INSERT OR IGNORE INTO share_links (token, op_id, role) VALUES (?, ?, ?)');
    for (const role of ROLES) insert.run(op.links[role].token, op.id, role);
  }

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    async listOps() {
      return db.prepare('SELECT data FROM operations ORDER BY updated_at DESC').all().map(parse);
    },
    async getOp(id) {
      const row = db.prepare('SELECT data FROM operations WHERE id = ?').get(id);
      return row ? parse(row) : null;
    },
    async insertOp(op) {
      transaction(() => {
        db.prepare('INSERT INTO operations (id, version, data, updated_at) VALUES (?, ?, ?, ?)').run(op.id, op.version, JSON.stringify(op), op.updatedAt);
        syncLinks(op);
      });
    },
    async updateOp(op, expectedVersion) {
      return transaction(() => {
        const result = db
          .prepare('UPDATE operations SET version = ?, data = ?, updated_at = ? WHERE id = ? AND version = ?')
          .run(op.version, JSON.stringify(op), op.updatedAt, op.id, expectedVersion);
        if (Number(result.changes) === 0) return false;
        syncLinks(op);
        return true;
      });
    },
    async deleteOp(id) {
      transaction(() => {
        db.prepare('DELETE FROM share_links WHERE op_id = ?').run(id);
        db.prepare('DELETE FROM operations WHERE id = ?').run(id);
      });
    },
    async findByToken(token) {
      const row = db
        .prepare('SELECT l.role AS role, o.data AS data FROM share_links l JOIN operations o ON o.id = l.op_id WHERE l.token = ?')
        .get(token) as { role: Role; data: string } | undefined;
      if (!row) return null;
      const op = parse(row);
      return op.links[row.role].enabled ? { op, role: row.role } : null;
    },
    async touchLink(token, opened) {
      const now = new Date().toISOString();
      if (opened) db.prepare('UPDATE share_links SET opens = opens + 1, last_opened_at = ?, last_seen_at = ? WHERE token = ?').run(now, now, token);
      else db.prepare('UPDATE share_links SET last_seen_at = ? WHERE token = ?').run(now, token);
    },
    async linkStats(opId) {
      const out = Object.fromEntries(ROLES.map((r) => [r, { opens: 0 }])) as Record<Role, LinkStats>;
      const rows = db.prepare('SELECT role, opens, last_opened_at, last_seen_at FROM share_links WHERE op_id = ?').all(opId) as unknown as {
        role: Role;
        opens: number;
        last_opened_at: string | null;
        last_seen_at: string | null;
      }[];
      for (const r of rows) out[r.role] = { opens: r.opens, lastOpenedAt: r.last_opened_at ?? undefined, lastSeenAt: r.last_seen_at ?? undefined };
      return out;
    },
    async nextRef(now) {
      const key = `seq:${yymm(now)}`;
      return transaction(() => {
        const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        const seq = (row ? Number(row.value) : 0) + 1;
        db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(seq));
        return refFor(now, seq);
      });
    },
    async claimSeed() {
      const result = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', '1')").run();
      return Number(result.changes) === 1;
    },
  };
}
