import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLES, projectView } from '../shared/domain.ts';
import type { Operation, Role } from '../shared/domain.ts';
import { ActionError, applyAction, createOperation } from './actions.ts';
import { seedIfEmpty } from './seed.ts';
import { createSession, deleteOp, deleteSession, findByToken, getOp, getSession, listOps, nextRef, saveOp } from './store.ts';

const prod = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 4100);
const PASSCODE = process.env.ADMIN_PASSCODE ?? (prod ? '' : 'magnate');
if (!PASSCODE) {
  console.error('ADMIN_PASSCODE must be set when running in production.');
  process.exit(1);
}

seedIfEmpty();

const app = express();
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
  next();
});

/* ───────────── Live updates ───────────── */

interface Change {
  id: string;
  /** Quiet changes (link opened, viewer joined) only concern the console. */
  quiet: boolean;
}
const bus = new EventEmitter();
bus.setMaxListeners(0);
const changed = (id: string, quiet = false) => bus.emit('change', { id, quiet } satisfies Change);

/** Stakeholders currently connected, per operation and role. */
const watching = new Map<string, Map<Role, number>>();
function watch(opId: string, role: Role, delta: 1 | -1): void {
  const roles = watching.get(opId) ?? new Map<Role, number>();
  roles.set(role, Math.max(0, (roles.get(role) ?? 0) + delta));
  watching.set(opId, roles);
  changed(opId, true);
}
const watchingFor = (opId: string) =>
  Object.fromEntries(ROLES.map((r) => [r, watching.get(opId)?.get(r) ?? 0])) as Record<Role, number>;

function openStream(req: Request, res: Response, onChange: (c: Change, send: (data: unknown) => void) => void, onClose?: () => void) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const listener = (c: Change) => onChange(c, send);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  bus.on('change', listener);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('change', listener);
    onClose?.();
  });
}

/* ───────────── Console sign-in ───────────── */

const COOKIE = 'mlo_session';

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
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
  const token = createSession(name);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 14 * 24 * 3600 * 1000, path: '/' });
  res.json({ name });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) deleteSession(token);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = readCookie(req, COOKIE);
  const session = token ? getSession(token) : null;
  res.json({ name: session?.name ?? null });
});

function requireStaff(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE);
  const session = token ? getSession(token) : null;
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

const detail = (op: Operation) => ({ op, watching: watchingFor(op.id) });

ops.get('/', (_req, res) => {
  res.json({ ops: listOps() });
});

ops.get('/stream', (req, res) => {
  openStream(req, res, (c, send) => send({ id: c.id }));
});

ops.post('/', (req, res) => {
  const now = new Date();
  const op = createOperation(req.body ?? {}, nextRef(now), res.locals.actor, now.toISOString());
  saveOp(op);
  changed(op.id);
  res.status(201).json(detail(op));
});

ops.get('/:id', (req, res) => {
  const op = getOp(req.params.id);
  if (!op) {
    res.status(404).json({ error: 'Operation not found.' });
    return;
  }
  res.json(detail(op));
});

ops.post('/:id/actions', (req, res) => {
  const op = getOp(req.params.id);
  if (!op) {
    res.status(404).json({ error: 'Operation not found.' });
    return;
  }
  const now = new Date().toISOString();
  applyAction(op, req.body ?? {}, res.locals.actor, now);
  op.version += 1;
  op.updatedAt = now;
  saveOp(op);
  changed(op.id);
  res.json(detail(op));
});

ops.delete('/:id', (req, res) => {
  deleteOp(req.params.id);
  changed(req.params.id);
  res.json({ ok: true });
});

app.use('/api/ops', ops);

/* ───────────── Stakeholder API (share links) ───────────── */

app.get('/api/live/:token', (req, res) => {
  const found = findByToken(req.params.token);
  if (!found) {
    res.status(404).json({ error: 'This link is no longer active.' });
    return;
  }
  const { op, role } = found;
  if (req.query.open === '1') {
    op.links[role].opens += 1;
    op.links[role].lastOpenedAt = new Date().toISOString();
    saveOp(op);
    changed(op.id, true);
  }
  res.json(projectView(op, role));
});

app.get('/api/live/:token/stream', (req, res) => {
  const found = findByToken(req.params.token);
  if (!found) {
    res.status(404).end();
    return;
  }
  const { op, role } = found;
  watch(op.id, role, 1);
  openStream(
    req,
    res,
    (c, send) => {
      if (c.id === op.id && !c.quiet) send({ changed: true });
    },
    () => watch(op.id, role, -1),
  );
});

/** The demonstration link from the brochure: opens the sample operation as the vessel owner sees it. */
app.get('/demo', (_req, res) => {
  const demo = listOps()
    .filter((o) => o.demo)
    .sort((a, b) => a.ref.localeCompare(b.ref))[0];
  res.redirect(demo ? `/live/${demo.links.owner.token}` : '/');
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

/* ───────────── Front end ───────────── */

if (prod) {
  const dist = resolve('dist');
  if (!existsSync(dist)) {
    console.error('No build found. Run "npm run build" first.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(resolve(dist, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ActionError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`Magnate LiveOps running at http://localhost:${PORT}`);
  if (!prod && !process.env.ADMIN_PASSCODE) console.log('Console passcode (development default): magnate');
});
