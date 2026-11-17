import postgres from 'postgres';
import { ROLES } from '../shared/domain.ts';
import type { LinkStats, Operation, Role } from '../shared/domain.ts';
import { refFor, yymm } from './store.ts';
import type { Store } from './store.ts';

/**
 * Postgres storage, written for Supabase behind serverless functions:
 * one connection per instance, no prepared statements (required by Supabase's
 * transaction pooler), and tables in their own schema with row level security on,
 * so Supabase's public REST API cannot read them.
 */
export async function openPostgres(connection: string): Promise<Store> {
  const url = new URL(connection);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  // Drop query parameters: hosting integrations append their own, which Postgres rejects.
  url.search = '';
  const sql = postgres(url.toString(), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    onnotice: () => undefined,
  });

  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS liveops;
    CREATE TABLE IF NOT EXISTS liveops.operations (
      id text PRIMARY KEY, version integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS liveops.share_links (
      token text PRIMARY KEY,
      op_id text NOT NULL REFERENCES liveops.operations(id) ON DELETE CASCADE,
      role text NOT NULL,
      opens integer NOT NULL DEFAULT 0,
      last_opened_at timestamptz,
      last_seen_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS share_links_op ON liveops.share_links(op_id);
    CREATE TABLE IF NOT EXISTS liveops.meta (key text PRIMARY KEY, value text NOT NULL);
    ALTER TABLE liveops.operations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE liveops.share_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE liveops.meta ENABLE ROW LEVEL SECURITY;
  `);

  // jsonb is passed as text and cast, which behaves the same with or without prepared statements.
  const asOp = (data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as Operation;
  const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : undefined);

  type Tx = typeof sql;
  async function syncLinks(tx: Tx, op: Operation) {
    const tokens = ROLES.map((r) => op.links[r].token);
    await tx`DELETE FROM liveops.share_links WHERE op_id = ${op.id} AND token <> ALL(${tokens})`;
    for (const role of ROLES) {
      await tx`INSERT INTO liveops.share_links (token, op_id, role) VALUES (${op.links[role].token}, ${op.id}, ${role}) ON CONFLICT (token) DO NOTHING`;
    }
  }

  return {
    async listOps() {
      const rows = await sql`SELECT data FROM liveops.operations ORDER BY updated_at DESC`;
      return rows.map((r) => asOp(r.data));
    },
    async getOp(id) {
      const rows = await sql`SELECT data FROM liveops.operations WHERE id = ${id}`;
      return rows.length ? asOp(rows[0].data) : null;
    },
    async insertOp(op) {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO liveops.operations (id, version, data, updated_at) VALUES (${op.id}, ${op.version}, ${JSON.stringify(op)}::jsonb, ${op.updatedAt})`;
        await syncLinks(tx as unknown as Tx, op);
      });
    },
    async updateOp(op, expectedVersion) {
      return (await sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE liveops.operations SET version = ${op.version}, data = ${JSON.stringify(op)}::jsonb, updated_at = ${op.updatedAt}
          WHERE id = ${op.id} AND version = ${expectedVersion} RETURNING id`;
        if (rows.length === 0) return false;
        await syncLinks(tx as unknown as Tx, op);
        return true;
      })) as boolean;
    },
    async deleteOp(id) {
      await sql`DELETE FROM liveops.operations WHERE id = ${id}`;
    },
    async findByToken(token) {
      const rows = await sql`
        SELECT l.role, o.data FROM liveops.share_links l JOIN liveops.operations o ON o.id = l.op_id WHERE l.token = ${token}`;
      if (!rows.length) return null;
      const op = asOp(rows[0].data);
      const role = rows[0].role as Role;
      return op.links[role].enabled ? { op, role } : null;
    },
    async touchLink(token, opened) {
      if (opened) await sql`UPDATE liveops.share_links SET opens = opens + 1, last_opened_at = now(), last_seen_at = now() WHERE token = ${token}`;
      else await sql`UPDATE liveops.share_links SET last_seen_at = now() WHERE token = ${token}`;
    },
    async linkStats(opId) {
      const out = Object.fromEntries(ROLES.map((r) => [r, { opens: 0 }])) as Record<Role, LinkStats>;
      const rows = await sql`SELECT role, opens, last_opened_at, last_seen_at FROM liveops.share_links WHERE op_id = ${opId}`;
      for (const r of rows) out[r.role as Role] = { opens: r.opens, lastOpenedAt: iso(r.last_opened_at), lastSeenAt: iso(r.last_seen_at) };
      return out;
    },
    async nextRef(now) {
      const rows = await sql`
        INSERT INTO liveops.meta (key, value) VALUES (${`seq:${yymm(now)}`}, '1')
        ON CONFLICT (key) DO UPDATE SET value = (liveops.meta.value::int + 1)::text
        RETURNING value`;
      return refFor(now, Number(rows[0].value));
    },
    async claimSeed() {
      const rows = await sql`INSERT INTO liveops.meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING RETURNING key`;
      return rows.length === 1;
    },
  };
}
