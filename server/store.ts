// Storage. Two interchangeable back ends:
//   - Postgres (Supabase) when DATABASE_URL or POSTGRES_URL is set: used in production.
//   - A local SQLite file otherwise: zero-setup development.
import type { LinkStats, Operation, Role } from '../shared/domain.ts';

export interface Store {
  listOps(): Promise<Operation[]>;
  getOp(id: string): Promise<Operation | null>;
  insertOp(op: Operation): Promise<void>;
  /**
   * Saves `op` only if the stored copy is still at `expectedVersion`.
   * Returns false when someone else saved first, so the caller can retry.
   */
  updateOp(op: Operation, expectedVersion: number): Promise<boolean>;
  deleteOp(id: string): Promise<void>;
  /** Resolves an enabled share link. */
  findByToken(token: string): Promise<{ op: Operation; role: Role } | null>;
  /** Records that a board checked in; `opened` also counts a fresh visit. */
  touchLink(token: string, opened: boolean): Promise<void>;
  linkStats(opId: string): Promise<Record<Role, LinkStats>>;
  /** Next sequential reference, e.g. MLO-2611-004. */
  nextRef(now: Date): Promise<string>;
  /** True for exactly one caller, ever: guards the one-off sample data. */
  claimSeed(): Promise<boolean>;
}

export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

let store: Promise<Store> | undefined;

export function getStore(): Promise<Store> {
  store ??= databaseUrl()
    ? import('./store-pg.ts').then((m) => m.openPostgres(databaseUrl()))
    : import('./store-sqlite.ts').then((m) => m.openSqlite());
  return store;
}

export const refFor = (now: Date, seq: number) => `MLO-${yymm(now)}-${String(seq).padStart(3, '0')}`;
export const yymm = (now: Date) => now.toISOString().slice(2, 7).replace('-', '');
