// The API. Stateless, so it runs unchanged as a long-lived local server
// (server/index.ts) or as a serverless function (api/index.js on Vercel).
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { projectView } from '../shared/domain.ts';
import type { Operation } from '../shared/domain.ts';
import { ActionError, applyAction, createOperation } from './actions.ts';
import { deskChannel, linkChannel, nudge, realtimeConfig } from './realtime.ts';
import { seedSamples } from './seed.ts';
import { databaseUrl, getStore } from './store.ts';
import type { Store } from './store.ts';

const hosted = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
const PASSCODE = process.env.ADMIN_PASSCODE ?? (hosted ? '' : 'magnate');
const SECRET = process.env.SESSION_SECRET || createHash('sha256').update(`mlo-session:${PASSCODE}`).digest('hex');
/** Sample operations: on by default locally, opt-in when hosted. */
const SEED = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : !hosted;

export const usingPostgres = () => !!databaseUrl();
export const passcodeIsDefault = () => !process.env.ADMIN_PASSCODE;

let ready: Promise<Store> | undefined;
function store(): Promise<Store> {
  ready ??= (async () => {
    const s = await getStore();
    if (SEED && (await s.claimSeed())) await seedSamples(s);
    return s;
  })();
  // A failed start (database unreachable) should be retried on the next request.
  ready.catch(() => (ready = undefined));
  return ready;
}

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  // Share links carry their token in the URL, so never leak it through the Referer header.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!PASSCODE) {
    res.status(503).json({ error: 'The server is not configured yet: ADMIN_PASSCODE is missing.' });
    return;
  }
  next();
});

/* ───────────── Desk sign-in (signed cookie, no server-side session) ───────────── */

const COOKIE = 'mlo_session';
const SESSION_MS = 14 * 24 * 3600 * 1000;

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url');

function issueSession(name: string): string {
  const payload = Buffer.from(JSON.stringify({ name, exp: Date.now() + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(req: Request): { name: string } | null {
  let value = '';
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) value = decodeURIComponent(v.join('='));
  }
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { name: string; exp: number };
    return data.exp > Date.now() ? { name: data.name } : null;
  } catch {
    return null;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();
// Best effort: on serverless each instance counts separately.
const attempts = new Map<string, { count: number; resetAt: number }>();

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= 8) {
    res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
  const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
  if (!name) {
    res.status(400).json({ error: 'Enter your name so updates can be attributed.' });
    return;
  }
  if (!timingSafeEqual(digest(passcode), digest(PASSCODE))) {
    attempts.set(ip, { count: entry && entry.resetAt > now ? entry.count + 1 : 1, resetAt: now + 5 * 60_000 });
    res.status(401).json({ error: 'That passcode is not correct.' });
    return;
  }
  attempts.delete(ip);
  res.cookie(COOKIE, issueSession(name), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/' });
  res.json({ name, channel: deskChannel(SECRET) });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req);
  res.json({ name: session?.name ?? null, channel: session ? deskChannel(SECRET) : null });
});

/** Public settings for the browser. */
app.get('/api/config', (_req, res) => {
  res.json({ realtime: realtimeConfig() });
});

function requireStaff(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  res.locals.actor = session.name;
  next();
}

/* ───────────── Console API ───────────── */

const ops = express.Router();
ops.use(requireStaff);

const detail = async (s: Store, op: Operation) => ({ op, links: await s.linkStats(op.id) });

ops.get('/', async (_req, res) => {
  res.json({ ops: await (await store()).listOps() });
});

ops.post('/', async (req, res) => {
  const s = await store();
  const now = new Date();
  const op = createOperation(req.body ?? {}, await s.nextRef(now), res.locals.actor, now.toISOString());
  await s.insertOp(op);
  await nudge(SECRET);
  res.status(201).json(await detail(s, op));
});

ops.get('/:id', async (req, res) => {
  const s = await store();
  const op = await s.getOp(req.params.id);
  if (!op) {
    res.status(404).json({ error: 'Operation not found.' });
    return;
  }
  res.json(await detail(s, op));
});

ops.post('/:id/actions', async (req, res) => {
  const s = await store();
  // Two people may act on the same operation at once; re-apply on top of the newer copy.
  for (let attempt = 0; attempt < 4; attempt++) {
    const op = await s.getOp(req.params.id);
    if (!op) {
      res.status(404).json({ error: 'Operation not found.' });
      return;
    }
    const before = op.version;
    const tokensBefore = JSON.stringify(op.links);
    const now = new Date().toISOString();
    applyAction(op, req.body ?? {}, res.locals.actor, now);
    op.version = before + 1;
    op.updatedAt = now;
    if (await s.updateOp(op, before)) {
      // If links changed, boards on the old links are told too, so they see the link close.
      await nudge(SECRET, tokensBefore === JSON.stringify(op.links) ? op : { ...op, links: JSON.parse(tokensBefore) });
      res.json(await detail(s, op));
      return;
    }
  }
  res.status(409).json({ error: 'This operation is being updated by someone else. Please try again.' });
});

ops.delete('/:id', async (req, res) => {
  const s = await store();
  const op = await s.getOp(req.params.id);
  await s.deleteOp(req.params.id);
  await nudge(SECRET, op ?? undefined);
  res.json({ ok: true });
});

app.use('/api/ops', ops);

/* ───────────── Stakeholder API (share links) ───────────── */

app.get('/api/live/:token', async (req, res) => {
  const s = await store();
  const token = req.params.token;
  const found = await s.findByToken(token);
  if (!found) {
    res.status(404).json({ error: 'This link is no longer active.' });
    return;
  }
  const { op, role } = found;
  await s.touchLink(token, req.query.open === '1');
  // Timed checks send the version they already have; answer briefly when nothing moved.
  if (req.query.v !== undefined && Number(req.query.v) === op.version) {
    res.json({ unchanged: true });
    return;
  }
  res.json({ ...projectView(op, role), channel: linkChannel(token) });
});

/** The demonstration link from the brochure: opens the sample operation as the vessel owner sees it. */
app.get('/demo', async (_req, res) => {
  const demo = (await (await store()).listOps()).filter((o) => o.demo).sort((a, b) => a.ref.localeCompare(b.ref))[0];
  res.redirect(demo ? `/live/${demo.links.owner.token}` : '/');
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ActionError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

export default app;
