// Instant "something changed" nudges through Supabase Realtime.
//
// Boards and the console always re-check the server on a timer, so this is an
// accelerator, not a dependency: if Realtime is not configured or a nudge is
// lost, pages still catch up on their next check.
//
// Messages carry no data, only a signal to re-fetch, and channel names are
// hashes, so nothing sensitive passes through Realtime.
import { createHash } from 'node:crypto';
import { ROLES } from '../shared/domain.ts';
import type { Operation } from '../shared/domain.ts';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** What the browser needs to subscribe; the anon key is public by design. */
export const realtimeConfig = () => (SUPABASE_URL && SUPABASE_KEY ? { url: SUPABASE_URL, key: SUPABASE_KEY } : null);

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export const linkChannel = (token: string) => `mlo-board-${hash(token)}`;
export const deskChannel = (secret: string) => `mlo-desk-${hash(`desk:${secret}`)}`;

async function broadcast(topics: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || topics.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event: 'changed', payload: {} })) }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Pages fall back to their timed check.
  }
}

/** Tell the desk, and optionally every board of an operation, to re-fetch. */
export function nudge(deskSecret: string, op?: Operation): Promise<void> {
  const topics = [deskChannel(deskSecret)];
  if (op) for (const role of ROLES) if (op.links[role].enabled) topics.push(linkChannel(op.links[role].token));
  return broadcast(topics);
}
