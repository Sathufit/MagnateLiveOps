import {
  DELAY_CAUSES,
  DELAY_CAUSE_LABEL,
  DEFAULT_DOCUMENTS,
  DELIVERY_MODES,
  DOC_STATES,
  FEED_KINDS,
  MILESTONE_KEYS,
  MILESTONE_STATES,
  PARTY_KEYS,
  PORT_NAMES,
  READINESS_LEVELS,
  READINESS_LEVEL_LABEL,
  READINESS_PARTIES,
  ROLES,
  fmtDateTime,
  fmtDuration,
  latestEta,
  milestoneLabel,
  readinessPartyLabel,
  rolesWith,
} from '../shared/domain.ts';
import type { FeedEntry, FeedKind, Grade, MilestoneKey, Operation, Parties, Role } from '../shared/domain.ts';
import { newId, newToken } from './ids.ts';

export class ActionError extends Error {}

type Input = Record<string, unknown>;

const fail = (message: string): never => {
  throw new ActionError(message);
};

function text(v: unknown, max: number, field: string, required = false): string {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  if (required && !s) fail(`${field} is required.`);
  return s;
}

function when(v: unknown, field: string): string {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) fail(`${field} is not a valid time.`);
  return new Date(t).toISOString();
}

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (!list.includes(v as T)) fail(`${field} is not valid.`);
  return v as T;
}

function qty(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) fail(`${field} must be a quantity in MT.`);
  return Math.round(n * 1000) / 1000;
}

function find<T extends { id: string }>(list: T[], id: unknown, what: string): T {
  return list.find((x) => x.id === id) ?? fail(`${what} not found.`);
}

function post(
  op: Operation,
  kind: FeedKind,
  body: string,
  actor: string,
  now: string,
  options: { audience?: FeedEntry['audience']; auto?: boolean } = {},
): void {
  op.feed.push({
    id: newId(),
    at: now,
    kind,
    text: body,
    audience: options.audience ?? 'all',
    author: actor,
    auto: options.auto ?? true,
  });
}

const withNote = (sentence: string, note: string) => (note ? `${sentence} ${note}` : sentence);

function parseGrades(v: unknown, existing: Grade[] = []): Grade[] {
  if (!Array.isArray(v) || v.length === 0) fail('At least one bunker grade is required.');
  const rows = (v as Input[]).slice(0, 6).map((row) => {
    const prior = existing.find((g) => g.id === row.id);
    return {
      id: prior?.id ?? newId(),
      grade: text(row.grade, 24, 'Grade', true).toUpperCase(),
      nominated: qty(row.nominated, 'Nominated quantity'),
      delivered: prior?.delivered ?? 0,
    };
  });
  return rows;
}

function parseParties(v: unknown): Parties {
  const src = (v ?? {}) as Input;
  const out = {} as Parties;
  for (const k of PARTY_KEYS) out[k] = text(src[k], 80, k);
  return out;
}

function applyDetails(op: Operation, a: Input): void {
  const vessel = (a.vessel ?? {}) as Input;
  op.vessel = {
    name: text(vessel.name, 60, 'Vessel name', true).toUpperCase(),
    imo: text(vessel.imo, 12, 'IMO number'),
    type: text(vessel.type, 40, 'Vessel type'),
  };
  op.port = oneOf(a.port, PORT_NAMES, 'Port');
  op.location = text(a.location, 60, 'Location');
  op.deliveryMode = oneOf(a.deliveryMode, DELIVERY_MODES, 'Delivery mode');
  op.craftName = text(a.craftName, 60, 'Supply craft');
  op.parties = parseParties(a.parties);
  op.grades = parseGrades(a.grades, op.grades);
}

function reviseEta(op: Operation, a: Input, actor: string, now: string): void {
  const eta = when(a.eta, 'ETA');
  const source = text(a.source, 40, 'Source') || 'Master';
  const note = text(a.note, 280, 'Note');
  const previous = latestEta(op);
  op.etas.push({ id: newId(), eta, receivedAt: now, source, note });

  let sentence: string;
  if (!previous) {
    sentence = `Initial ETA received from ${source}: ${fmtDateTime(eta)} LT.`;
    op.milestones.initial_eta = { state: 'done', at: now };
    if (op.milestones.eta_monitoring.state === 'pending') op.milestones.eta_monitoring = { state: 'active', at: now };
  } else {
    const diff = Date.parse(eta) - Date.parse(previous.eta);
    const change = diff === 0 ? 'unchanged' : `${fmtDuration(diff)} ${diff > 0 ? 'later' : 'earlier'} than previously advised`;
    sentence = `${source} revised ETA to ${fmtDateTime(eta)} LT, ${change}.`;
  }
  post(op, 'eta', withNote(sentence, note), actor, now);
}

function setMilestone(op: Operation, a: Input, actor: string, now: string): void {
  const key = oneOf(a.key, MILESTONE_KEYS, 'Milestone') as MilestoneKey;
  const state = oneOf(a.state, MILESTONE_STATES, 'State');
  const previous = op.milestones[key];
  const at = state === 'pending' ? undefined : a.at ? when(a.at, 'Time') : previous.state === state && previous.at ? previous.at : now;
  op.milestones[key] = at ? { state, at } : { state };
  if (previous.state === state) return; // time correction only

  const label = milestoneLabel(key, op.deliveryMode);
  if (state === 'done') post(op, 'progress', `${label} at ${fmtDateTime(at!)} LT.`, actor, now);
  if (state === 'active') post(op, 'progress', `${label} in progress.`, actor, now);

  if (key === 'vessel_arrived' && state === 'done' && op.milestones.eta_monitoring.state !== 'done') {
    op.milestones.eta_monitoring = { state: 'done', at: at! };
  }
}

/** Applies one console action to an operation. Mutates `op`; throws ActionError on bad input. */
export function applyAction(op: Operation, a: Input, actor: string, now: string): void {
  switch (a.type) {
    case 'feed.post': {
      const body = text(a.text, 600, 'Update', true);
      const kind = oneOf(a.kind ?? 'notice', FEED_KINDS, 'Category');
      let audience: FeedEntry['audience'] = 'all';
      if (Array.isArray(a.audience)) {
        const roles = ROLES.filter((r) => (a.audience as unknown[]).includes(r));
        if (roles.length === 0) fail('Choose at least one party to notify.');
        if (roles.length < ROLES.length) audience = roles;
      }
      post(op, kind, body, actor, now, { audience, auto: false });
      break;
    }
    case 'feed.remove': {
      const entry = find(op.feed, a.id, 'Update');
      op.feed = op.feed.filter((f) => f !== entry);
      break;
    }
    case 'eta.revise':
      reviseEta(op, a, actor, now);
      break;
    case 'milestone.set':
      setMilestone(op, a, actor, now);
      break;
    case 'delay.open': {
      const cause = oneOf(a.cause, DELAY_CAUSES, 'Cause');
      const startedAt = a.startedAt ? when(a.startedAt, 'Start time') : now;
      const note = text(a.note, 280, 'Note');
      op.delays.push({ id: newId(), cause, startedAt, note });
      post(op, 'delay', withNote(`Delay reported from ${fmtDateTime(startedAt)} LT. Attributed to: ${DELAY_CAUSE_LABEL[cause].toLowerCase()}.`, note), actor, now);
      break;
    }
    case 'delay.close': {
      const delay = find(op.delays, a.id, 'Delay');
      const endedAt = a.endedAt ? when(a.endedAt, 'End time') : now;
      if (Date.parse(endedAt) < Date.parse(delay.startedAt)) fail('A delay cannot end before it started.');
      delay.endedAt = endedAt;
      const lasted = fmtDuration(Date.parse(endedAt) - Date.parse(delay.startedAt));
      post(op, 'delay', `Delay cleared at ${fmtDateTime(endedAt)} LT after ${lasted} (${DELAY_CAUSE_LABEL[delay.cause].toLowerCase()}).`, actor, now);
      break;
    }
    case 'delay.remove': {
      const delay = find(op.delays, a.id, 'Delay');
      op.delays = op.delays.filter((d) => d !== delay);
      break;
    }
    case 'readiness.set': {
      const party = oneOf(a.party, READINESS_PARTIES, 'Party');
      const level = oneOf(a.level, READINESS_LEVELS, 'Readiness');
      const note = text(a.note, 160, 'Note');
      const previous = op.readiness[party];
      if (previous.level === level && previous.note === note) break;
      op.readiness[party] = { level, note, updatedAt: now };
      const label = readinessPartyLabel(party, op.deliveryMode);
      post(op, 'readiness', withNote(`${label}: ${READINESS_LEVEL_LABEL[level].toLowerCase()}.`, note), actor, now, {
        audience: rolesWith('readiness'),
      });
      break;
    }
    case 'delivery.set': {
      const grade = find(op.grades, a.gradeId, 'Grade');
      grade.delivered = qty(a.delivered, 'Delivered quantity');
      break;
    }
    case 'doc.set': {
      const doc = find(op.documents, a.id, 'Document');
      const state = oneOf(a.state, DOC_STATES, 'Status');
      const ref = text(a.ref, 60, 'Reference');
      const changed = doc.state !== state;
      doc.state = state;
      doc.ref = ref;
      if (changed) {
        doc.at = state === 'pending' ? undefined : now;
        if (state === 'issued' || state === 'received') {
          post(op, 'document', `${doc.name}: ${state}${ref ? ` (ref ${ref})` : ''}.`, actor, now, {
            audience: rolesWith('documents'),
          });
        }
      }
      break;
    }
    case 'doc.add':
      if (op.documents.length >= 30) fail('The checklist is full.');
      op.documents.push({ id: newId(), name: text(a.name, 80, 'Document name', true), state: 'pending', ref: '' });
      break;
    case 'doc.remove': {
      const doc = find(op.documents, a.id, 'Document');
      op.documents = op.documents.filter((d) => d !== doc);
      break;
    }
    case 'details.set':
      applyDetails(op, a);
      op.headline = text(a.headline, 80, 'Status line');
      op.etc = a.etc ? when(a.etc, 'Estimated completion') : undefined;
      break;
    case 'remarks.set':
      op.remarks = text(a.remarks, 4000, 'Remarks');
      break;
    case 'op.status': {
      const status = oneOf(a.status, ['active', 'completed', 'cancelled'] as const, 'Status');
      if (status === op.status) break;
      op.status = status;
      op.closedAt = status === 'active' ? undefined : now;
      const line =
        status === 'completed'
          ? 'Operation completed. Thank you to all parties.'
          : status === 'cancelled'
            ? 'Operation cancelled.'
            : 'Operation reopened.';
      post(op, 'notice', line, actor, now);
      break;
    }
    case 'link.rotate': {
      const role = oneOf(a.role, ROLES, 'Party') as Role;
      op.links[role] = { token: newToken(), enabled: true };
      break;
    }
    case 'link.toggle': {
      const role = oneOf(a.role, ROLES, 'Party') as Role;
      op.links[role].enabled = a.enabled === true;
      break;
    }
    default:
      fail('Unknown action.');
  }
}

export function createOperation(a: Input, ref: string, actor: string, now: string, demo = false): Operation {
  const op = {
    id: newId(),
    ref,
    demo,
    version: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    headline: '',
    etas: [],
    milestones: Object.fromEntries(MILESTONE_KEYS.map((k) => [k, { state: 'pending' }])),
    readiness: Object.fromEntries(READINESS_PARTIES.map((p) => [p, { level: 'pending', note: '' }])),
    delays: [],
    documents: DEFAULT_DOCUMENTS.map((name) => ({ id: newId(), name, state: 'pending', ref: '' })),
    feed: [],
    remarks: '',
    links: Object.fromEntries(ROLES.map((r) => [r, { token: newToken(), enabled: true }])),
    grades: [],
  } as unknown as Operation;

  applyDetails(op, a);
  op.milestones.vessel_nominated = { state: 'done', at: now };
  post(op, 'progress', `Vessel nominated for bunker delivery at ${op.port}. Magnate Shipping appointed as agent.`, actor, now);
  if (a.eta) reviseEta(op, { eta: a.eta, source: a.etaSource }, actor, now);
  return op;
}
