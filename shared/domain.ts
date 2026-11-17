// Domain model shared by the server and the browser.
// Kept free of runtime-only TypeScript syntax so Node can run it directly.

/* ───────────── Stakeholders ───────────── */

export const ROLES = ['owner', 'charterer', 'trader', 'supplier', 'master', 'surveyor'] as const;
export type Role = (typeof ROLES)[number];
export type Viewer = Role | 'magnate';

export const ROLE_LABEL: Record<Viewer, string> = {
  owner: 'Vessel Owner',
  charterer: 'Charterer',
  trader: 'Bunker Trader',
  supplier: 'Physical Supplier',
  master: 'Master',
  surveyor: 'Surveyor',
  magnate: 'Magnate Shipping',
};

export const ROLE_SEES: Record<Role, string> = {
  owner: 'ETA, current status, delays, completion and final report',
  charterer: 'Schedule impact, operation progress and completion updates',
  trader: 'ETA changes, supplier status, barge milestones and documents',
  supplier: 'Vessel readiness, ETA history, surveyor status and delivery timeline',
  master: 'Supplier readiness, surveyor attendance and expected barge/bowser status',
  surveyor: 'ETA, boarding plan, commencement/completion and report status',
};

/** Optional sections of the board. Status, latest ETA, progress and the feed are always shown. */
export type Module = 'etaHistory' | 'schedule' | 'delays' | 'readiness' | 'documents' | 'report';
export const ALL_MODULES: Module[] = ['etaHistory', 'schedule', 'delays', 'readiness', 'documents', 'report'];

export const ROLE_MODULES: Record<Role, Module[]> = {
  owner: ['etaHistory', 'schedule', 'delays', 'documents', 'report'],
  charterer: ['schedule', 'delays', 'report'],
  trader: ['etaHistory', 'delays', 'readiness', 'documents', 'report'],
  supplier: ['etaHistory', 'readiness'],
  master: ['readiness'],
  surveyor: ['etaHistory', 'readiness', 'documents'],
};

export const rolesWith = (m: Module): Role[] => ROLES.filter((r) => ROLE_MODULES[r].includes(m));

/* ───────────── Ports ───────────── */

export const PORTS = [
  { name: 'Colombo', pos: '06°57′N 079°51′E' },
  { name: 'Galle', pos: '06°02′N 080°13′E' },
  { name: 'Hambantota', pos: '06°07′N 081°06′E' },
  { name: 'Trincomalee', pos: '08°34′N 081°14′E' },
] as const;
export type PortName = (typeof PORTS)[number]['name'];
export const PORT_NAMES = PORTS.map((p) => p.name) as PortName[];

/* ───────────── Milestones ───────────── */

export const PHASES = [
  { key: 'prearrival', label: 'Pre-arrival' },
  { key: 'mobilisation', label: 'Arrival & mobilisation' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'closeout', label: 'Close-out' },
] as const;
export type PhaseKey = (typeof PHASES)[number]['key'];

export const MILESTONES = [
  { key: 'vessel_nominated', label: 'Vessel nominated', phase: 'prearrival' },
  { key: 'initial_eta', label: 'Initial ETA received', phase: 'prearrival' },
  { key: 'supplier_nominated', label: 'Supplier nominated', phase: 'prearrival' },
  { key: 'surveyor_arranged', label: 'Surveyor arranged', phase: 'prearrival' },
  { key: 'eta_monitoring', label: 'ETA monitoring', phase: 'prearrival' },
  { key: 'vessel_arrived', label: 'Vessel arrived', phase: 'mobilisation' },
  { key: 'barge_loading', label: 'Barge loading', phase: 'mobilisation' },
  { key: 'barge_departed', label: 'Barge departed', phase: 'mobilisation' },
  { key: 'barge_alongside', label: 'Barge alongside', phase: 'mobilisation' },
  { key: 'surveyor_onboard', label: 'Surveyor on board', phase: 'delivery' },
  { key: 'bunkering_commenced', label: 'Bunkering commenced', phase: 'delivery' },
  { key: 'bunkering_completed', label: 'Bunkering completed', phase: 'delivery' },
  { key: 'bdn_issued', label: 'BDN issued', phase: 'closeout' },
  { key: 'barge_cast_off', label: 'Barge cast off', phase: 'closeout' },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]['key'];
export const MILESTONE_KEYS = MILESTONES.map((m) => m.key) as MilestoneKey[];

export type MilestoneState = 'pending' | 'active' | 'done';
export const MILESTONE_STATES: MilestoneState[] = ['pending', 'active', 'done'];
export interface MilestoneMark {
  state: MilestoneState;
  at?: string;
}

export type DeliveryMode = 'barge' | 'bowser';
export const DELIVERY_MODES: DeliveryMode[] = ['barge', 'bowser'];

const BOWSER_LABELS: Partial<Record<MilestoneKey, string>> = {
  barge_loading: 'Bowser loading',
  barge_departed: 'Bowser dispatched',
  barge_alongside: 'Bowser at berth',
  barge_cast_off: 'Bowser released',
};

export function milestoneLabel(key: MilestoneKey, mode: DeliveryMode): string {
  if (mode === 'bowser' && BOWSER_LABELS[key]) return BOWSER_LABELS[key]!;
  return MILESTONES.find((m) => m.key === key)!.label;
}

export const craftWord = (mode: DeliveryMode) => (mode === 'bowser' ? 'Bowser' : 'Barge');

/* ───────────── Records ───────────── */

export interface EtaRevision {
  id: string;
  eta: string;
  receivedAt: string;
  source: string;
  note: string;
}

export const DELAY_CAUSES = ['vessel', 'supplier', 'surveyor', 'weather', 'port', 'other'] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];
export const DELAY_CAUSE_LABEL: Record<DelayCause, string> = {
  vessel: 'Vessel',
  supplier: 'Supplier',
  surveyor: 'Surveyor',
  weather: 'Weather',
  port: 'Port / authorities',
  other: 'Other',
};
export interface Delay {
  id: string;
  cause: DelayCause;
  startedAt: string;
  endedAt?: string;
  note: string;
}

export const READINESS_PARTIES = ['vessel', 'supplier', 'craft', 'surveyor'] as const;
export type ReadinessParty = (typeof READINESS_PARTIES)[number];
export const READINESS_LEVELS = ['pending', 'standby', 'ready', 'issue'] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];
export const READINESS_LEVEL_LABEL: Record<ReadinessLevel, string> = {
  pending: 'Pending',
  standby: 'Standby',
  ready: 'Ready',
  issue: 'Issue',
};
export interface Readiness {
  level: ReadinessLevel;
  note: string;
  updatedAt?: string;
}
export const readinessPartyLabel = (p: ReadinessParty, mode: DeliveryMode) =>
  p === 'vessel' ? 'Vessel' : p === 'supplier' ? 'Supplier' : p === 'craft' ? craftWord(mode) : 'Surveyor';

export const DOC_STATES = ['pending', 'received', 'issued', 'na'] as const;
export type DocState = (typeof DOC_STATES)[number];
export const DOC_STATE_LABEL: Record<DocState, string> = {
  pending: 'Pending',
  received: 'Received',
  issued: 'Issued',
  na: 'Not required',
};
export interface DocItem {
  id: string;
  name: string;
  state: DocState;
  ref: string;
  at?: string;
}
export const DEFAULT_DOCUMENTS = [
  'Bunker nomination / stem confirmation',
  'Pre-delivery safety checklist',
  'Opening gauging report',
  'Closing gauging report',
  'Bunker Delivery Note (BDN)',
  'MARPOL sample seal record',
  'Bunker quantity survey report',
  'Statement of facts / time log',
];

export const FEED_KINDS = ['notice', 'eta', 'progress', 'delay', 'readiness', 'document'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
export const FEED_KIND_LABEL: Record<FeedKind, string> = {
  notice: 'Notice',
  eta: 'ETA',
  progress: 'Progress',
  delay: 'Delay',
  readiness: 'Readiness',
  document: 'Document',
};
export interface FeedEntry {
  id: string;
  at: string;
  kind: FeedKind;
  text: string;
  audience: 'all' | Role[];
  author: string;
  auto: boolean;
}

export interface Grade {
  id: string;
  grade: string;
  nominated: number;
  delivered: number;
}
export const COMMON_GRADES = ['VLSFO', 'LSMGO', 'HSFO', 'ULSFO', 'MGO'];

export interface Vessel {
  name: string;
  imo: string;
  type: string;
}
export type Parties = Record<'owner' | 'charterer' | 'trader' | 'supplier' | 'surveyor', string>;
export const PARTY_KEYS = ['owner', 'charterer', 'trader', 'supplier', 'surveyor'] as const;

export interface ShareLink {
  token: string;
  enabled: boolean;
}

/** How a share link has been used. Kept apart from the operation so viewers never overwrite desk edits. */
export interface LinkStats {
  opens: number;
  lastOpenedAt?: string;
  /** Last time an open board checked in; recent means someone is viewing now. */
  lastSeenAt?: string;
}
export const VIEWING_WINDOW_MS = 75_000;

export type OpStatus = 'active' | 'completed' | 'cancelled';

export interface Operation {
  id: string;
  ref: string;
  demo: boolean;
  version: number;
  status: OpStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  vessel: Vessel;
  port: PortName;
  location: string;
  deliveryMode: DeliveryMode;
  craftName: string;
  parties: Parties;
  grades: Grade[];
  /** Optional manual status line; when empty the status is derived from milestones. */
  headline: string;
  /** Estimated completion of the operation. */
  etc?: string;
  etas: EtaRevision[];
  milestones: Record<MilestoneKey, MilestoneMark>;
  readiness: Record<ReadinessParty, Readiness>;
  delays: Delay[];
  documents: DocItem[];
  feed: FeedEntry[];
  remarks: string;
  links: Record<Role, ShareLink>;
}

/* ───────────── Board view (what a given viewer may see) ───────────── */

export interface DelayStatus {
  open: { cause: DelayCause; startedAt: string }[];
  closedCount: number;
  closedMs: number;
}

export interface BoardOp {
  ref: string;
  version: number;
  demo: boolean;
  status: OpStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  vessel: Vessel;
  port: PortName;
  location: string;
  deliveryMode: DeliveryMode;
  craftName: string;
  parties: Parties;
  grades: Grade[];
  headline: string;
  etc?: string;
  etas: EtaRevision[];
  milestones: Record<MilestoneKey, MilestoneMark>;
  feed: FeedEntry[];
  readiness?: Record<ReadinessParty, Readiness>;
  delays?: Delay[];
  documents?: DocItem[];
  remarks?: string;
}

export interface BoardView {
  viewer: Viewer;
  modules: Module[];
  op: BoardOp;
  delay: DelayStatus;
}

export function delayStatus(delays: Delay[]): DelayStatus {
  const closed = delays.filter((d) => d.endedAt);
  return {
    open: delays.filter((d) => !d.endedAt).map((d) => ({ cause: d.cause, startedAt: d.startedAt })),
    closedCount: closed.length,
    closedMs: closed.reduce((sum, d) => sum + Math.max(0, Date.parse(d.endedAt!) - Date.parse(d.startedAt)), 0),
  };
}

export function projectView(op: Operation, viewer: Viewer): BoardView {
  const modules = viewer === 'magnate' ? ALL_MODULES : ROLE_MODULES[viewer];
  const has = (m: Module) => modules.includes(m);

  let etas = op.etas;
  if (!has('etaHistory')) {
    const ends = op.etas.length > 1 ? [op.etas[0], op.etas[op.etas.length - 1]] : op.etas;
    etas = ends.map((e) => ({ ...e, note: '' }));
  }

  const feed = op.feed
    .filter((f) => viewer === 'magnate' || f.audience === 'all' || f.audience.includes(viewer))
    .map((f) => (viewer === 'magnate' ? f : { ...f, author: 'Magnate Ops', audience: 'all' as const }));

  return {
    viewer,
    modules,
    delay: delayStatus(op.delays),
    op: {
      ref: op.ref,
      version: op.version,
      demo: op.demo,
      status: op.status,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      closedAt: op.closedAt,
      vessel: op.vessel,
      port: op.port,
      location: op.location,
      deliveryMode: op.deliveryMode,
      craftName: op.craftName,
      parties: op.parties,
      grades: op.grades,
      headline: op.headline,
      etc: op.etc,
      etas,
      milestones: op.milestones,
      feed,
      readiness: has('readiness') ? op.readiness : undefined,
      delays: has('delays') ? op.delays : undefined,
      documents: has('documents') ? op.documents : undefined,
      remarks: has('report') ? op.remarks : undefined,
    },
  };
}

/* ───────────── Derived values ───────────── */

type WithEtas = { etas: EtaRevision[] };
export const latestEta = (op: WithEtas): EtaRevision | undefined => op.etas[op.etas.length - 1];
export const initialEta = (op: WithEtas): EtaRevision | undefined => op.etas[0];

type WithMilestones = { milestones: Record<MilestoneKey, MilestoneMark>; deliveryMode: DeliveryMode };

export function milestoneAt(op: WithMilestones, key: MilestoneKey): string | undefined {
  const m = op.milestones[key];
  return m.state === 'done' ? m.at : undefined;
}

export function progressCount(op: WithMilestones): { done: number; total: number } {
  return {
    done: MILESTONE_KEYS.filter((k) => op.milestones[k].state === 'done').length,
    total: MILESTONE_KEYS.length,
  };
}

export function currentPhase(op: WithMilestones): PhaseKey {
  let phase: PhaseKey = 'prearrival';
  for (const m of MILESTONES) if (op.milestones[m.key].state !== 'pending') phase = m.phase;
  return phase;
}

export function statusLine(op: WithMilestones & { status: OpStatus; headline: string }): string {
  if (op.status === 'completed') return 'Operation completed';
  if (op.status === 'cancelled') return 'Operation cancelled';
  if (op.headline) return op.headline;
  const active = MILESTONES.filter((m) => op.milestones[m.key].state === 'active');
  if (active.length) {
    const last = active[active.length - 1].key;
    if (last === 'eta_monitoring') return 'ETA monitoring · awaiting arrival';
    return `${milestoneLabel(last, op.deliveryMode)} · in progress`;
  }
  const done = MILESTONES.filter((m) => op.milestones[m.key].state === 'done');
  if (done.length) return milestoneLabel(done[done.length - 1].key, op.deliveryMode);
  return 'Nomination received';
}

export const totalNominated = (grades: Grade[]) => grades.reduce((s, g) => s + g.nominated, 0);
export const totalDelivered = (grades: Grade[]) => grades.reduce((s, g) => s + g.delivered, 0);

/* ───────────── Time (port local time, Sri Lanka, UTC+05:30, no DST) ───────────── */

export const PORT_TZ = 'Asia/Colombo';
const LT_OFFSET_MIN = 330;

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: PORT_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: PORT_TZ, day: '2-digit', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: PORT_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const yearFmt = new Intl.DateTimeFormat('en-GB', { timeZone: PORT_TZ, day: '2-digit', month: 'short', year: 'numeric' });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => `${fmtDay(iso)} ${fmtTime(iso)}`;
export const fmtLongDay = (iso: string) => longDayFmt.format(new Date(iso));
export const fmtDate = (iso: string) => yearFmt.format(new Date(iso));

/** yyyy-mm-dd in port local time, for grouping. */
export const dayKey = (iso: string) => new Date(Date.parse(iso) + LT_OFFSET_MIN * 60000).toISOString().slice(0, 10);

/** Value for <input type="datetime-local">, expressed in port local time. */
export const toLTInput = (iso: string) => new Date(Date.parse(iso) + LT_OFFSET_MIN * 60000).toISOString().slice(0, 16);
/** Parses a datetime-local value as port local time. Returns '' when invalid. */
export function fromLTInput(value: string): string {
  const t = Date.parse(`${value.length === 16 ? `${value}:00` : value}+05:30`);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (mins < 1) return 'under 1m';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  return `${m}m`;
}

export function fmtQty(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}
