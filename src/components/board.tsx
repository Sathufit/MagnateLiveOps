import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DELAY_CAUSE_LABEL,
  DOC_STATE_LABEL,
  FEED_KIND_LABEL,
  MILESTONES,
  PHASES,
  READINESS_LEVEL_LABEL,
  READINESS_PARTIES,
  ROLE_LABEL,
  craftWord,
  currentPhase,
  dayKey,
  fmtDateTime,
  fmtDay,
  fmtDuration,
  fmtLongDay,
  fmtQty,
  fmtTime,
  initialEta,
  latestEta,
  milestoneAt,
  milestoneLabel,
  progressCount,
  readinessPartyLabel,
  statusLine,
  totalDelivered,
  totalNominated,
} from '../../shared/domain.ts';
import type { BoardOp, BoardView, Delay, DelayStatus, DocItem, FeedEntry, Grade, Readiness, ReadinessParty } from '../../shared/domain.ts';
import { useWidth } from '../lib/hooks.ts';
import { Icon } from './ui.tsx';

/** A time in port local time, with the viewer's own local time on hover. */
export function LT({ iso, day = true }: { iso: string; day?: boolean }) {
  const own = new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <time className="lt" dateTime={iso} title={`${own} your time`}>
      {day ? fmtDateTime(iso) : fmtTime(iso)}
    </time>
  );
}

/* ───────────── Status strip ───────────── */

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

function Cell({ label, tone, value, sub }: { label: string; tone: Tone; value: ReactNode; sub: ReactNode }) {
  return (
    <div className={`strip-cell tone-${tone}`}>
      <span className="strip-label">{label}</span>
      <div className="strip-value">{value}</div>
      <div className="strip-sub">{sub}</div>
    </div>
  );
}

function driftText(op: BoardOp): string | null {
  const first = initialEta(op);
  const last = latestEta(op);
  if (!first || !last || first === last) return null;
  const diff = Date.parse(last.eta) - Date.parse(first.eta);
  if (diff === 0) return 'Unchanged from first advised ETA';
  return `${fmtDuration(diff)} ${diff > 0 ? 'later' : 'earlier'} than first advised`;
}

export function delayHeadline(delay: DelayStatus, now: number): { tone: Tone; value: string; sub: string } {
  if (delay.open.length > 0) {
    const first = delay.open[0];
    return {
      tone: 'bad',
      value: delay.open.length > 1 ? `${delay.open.length} delays in progress` : `${DELAY_CAUSE_LABEL[first.cause]} delay`,
      sub: `Running ${fmtDuration(now - Date.parse(first.startedAt))}, since ${fmtDateTime(first.startedAt)} LT`,
    };
  }
  if (delay.closedCount > 0) {
    return {
      tone: 'warn',
      value: 'No active delay',
      sub: `${delay.closedCount} earlier ${delay.closedCount === 1 ? 'delay' : 'delays'}, ${fmtDuration(delay.closedMs)} in total`,
    };
  }
  return { tone: 'ok', value: 'No confirmed delay', sub: 'Nothing reported by any party' };
}

export function StatusStrip({ view, now }: { view: BoardView; now: number }) {
  const { op, delay } = view;
  const { done, total } = progressCount(op);
  const phase = PHASES.find((p) => p.key === currentPhase(op))!.label;
  const eta = latestEta(op);
  const arrived = milestoneAt(op, 'vessel_arrived');
  const closed = op.status !== 'active';
  const drift = driftText(op);

  let etaCell: ReactNode;
  if (arrived) {
    etaCell = <Cell label="Vessel arrived" tone="ok" value={<span className="big-time">{fmtDateTime(arrived)}<small>LT</small></span>} sub={drift ?? `${op.port}, ${op.location}`} />;
  } else if (eta) {
    const ms = Date.parse(eta.eta) - now;
    const overdue = ms < 0;
    etaCell = (
      <Cell
        label="Latest ETA"
        tone={overdue && !closed ? 'warn' : 'info'}
        value={<span className="big-time">{fmtDateTime(eta.eta)}<small>LT</small></span>}
        sub={
          <>
            {!closed && <b>{overdue ? `ETA passed ${fmtDuration(ms)} ago` : `In ${fmtDuration(ms)}`}</b>}
            {drift && <span>{drift}</span>}
          </>
        }
      />
    );
  } else {
    etaCell = <Cell label="Latest ETA" tone="neutral" value="Awaiting ETA" sub="Not yet advised by the Master" />;
  }

  const d = delayHeadline(delay, now);
  const completedAt = milestoneAt(op, 'bunkering_completed') ?? op.closedAt;
  const nominated = totalNominated(op.grades);
  const delivered = totalDelivered(op.grades);
  const qtySub = delivered > 0 ? `${fmtQty(delivered)} of ${fmtQty(nominated)} MT delivered` : `${fmtQty(nominated)} MT nominated`;

  return (
    <div className="strip">
      <Cell
        label="Current status"
        tone={op.status === 'completed' ? 'ok' : op.status === 'cancelled' ? 'neutral' : 'info'}
        value={statusLine(op)}
        sub={`${phase} · ${done} of ${total} milestones`}
      />
      {etaCell}
      <Cell label="Delay status" tone={d.tone} value={d.value} sub={d.sub} />
      {op.status === 'completed' && completedAt ? (
        <Cell label="Completed" tone="ok" value={<span className="big-time">{fmtDateTime(completedAt)}<small>LT</small></span>} sub={qtySub} />
      ) : (
        <Cell
          label="Est. completion"
          tone="neutral"
          value={op.etc && op.status === 'active' ? <span className="big-time">{fmtDateTime(op.etc)}<small>LT</small></span> : 'To be confirmed'}
          sub={qtySub}
        />
      )}
    </div>
  );
}

/* ───────────── Progress track ───────────── */

export function PhaseTrack({ op }: { op: BoardOp }) {
  return (
    <div className="track">
      {PHASES.map((phase) => {
        const items = MILESTONES.filter((m) => m.phase === phase.key);
        const done = items.filter((m) => op.milestones[m.key].state === 'done').length;
        return (
          <div className="phase" key={phase.key}>
            <div className="phase-bar" aria-hidden="true">
              {items.map((m) => (
                <i key={m.key} className={op.milestones[m.key].state} />
              ))}
            </div>
            <h3>
              {phase.label}
              <span>
                {done}/{items.length}
              </span>
            </h3>
            <ol>
              {items.map((m) => {
                const mark = op.milestones[m.key];
                return (
                  <li key={m.key} className={mark.state}>
                    <span className="node" aria-hidden="true">
                      {mark.state === 'done' && <Icon name="check" size={11} />}
                    </span>
                    <span className="ms-label">{milestoneLabel(m.key, op.deliveryMode)}</span>
                    <span className="ms-time">
                      {mark.state === 'done' && mark.at ? <LT iso={mark.at} /> : mark.state === 'active' ? 'In progress' : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

/** Compact 14-segment bar for tables. */
export function MiniTrack({ op }: { op: BoardOp }) {
  const { done, total } = progressCount(op);
  return (
    <span className="mini-track" title={`${done} of ${total} milestones`}>
      {MILESTONES.map((m) => (
        <i key={m.key} className={op.milestones[m.key].state} />
      ))}
    </span>
  );
}

/* ───────────── Feed ───────────── */

export function FeedList({ entries, admin = false, onRemove }: { entries: FeedEntry[]; admin?: boolean; onRemove?: (id: string) => void }) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(entries.map((e) => e.id));
      return;
    }
    const added = entries.filter((e) => !seen.current!.has(e.id)).map((e) => e.id);
    if (added.length) {
      added.forEach((id) => seen.current!.add(id));
      setFresh(new Set(added));
    }
  }, [entries]);

  if (entries.length === 0) return <p className="empty">No updates have been posted yet.</p>;

  const days: { key: string; items: FeedEntry[] }[] = [];
  for (const entry of [...entries].reverse()) {
    const key = dayKey(entry.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(entry);
    else days.push({ key, items: [entry] });
  }

  return (
    <div className="feed" aria-live="polite">
      {days.map((day) => (
        <div className="feed-day" key={day.key}>
          <h3>{fmtLongDay(day.items[0].at)}</h3>
          <ul>
            {day.items.map((e) => (
              <li key={e.id} className={`feed-item kind-${e.kind} ${fresh.has(e.id) ? 'fresh' : ''}`}>
                <span className="feed-time">
                  <LT iso={e.at} day={false} />
                </span>
                <span className="feed-rail" aria-hidden="true" />
                <div className="feed-body">
                  <span className="feed-kind">{FEED_KIND_LABEL[e.kind]}</span>
                  <p>{e.text}</p>
                  {admin && (
                    <span className="feed-meta">
                      {e.auto ? 'Logged automatically' : `Posted by ${e.author}`}
                      {e.audience !== 'all' && <> · visible to {e.audience.map((r) => ROLE_LABEL[r]).join(', ')} only</>}
                    </span>
                  )}
                </div>
                {onRemove && (
                  <button type="button" className="icon-btn subtle" title="Remove this update" aria-label="Remove this update" onClick={() => onRemove(e.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ───────────── ETA history ───────────── */

function EtaChart({ op, now }: { op: BoardOp; now: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 128;
  const pad = { l: 46, r: 10, t: 12, b: 24 };
  const arrived = milestoneAt(op, 'vessel_arrived');
  const points = op.etas.map((e) => ({ x: Date.parse(e.receivedAt), y: Date.parse(e.eta) }));
  const x0 = points[0].x;
  const x1 = Math.max(points[points.length - 1].x + 3600_000, arrived ? Date.parse(arrived) : now);
  const ys = points.map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = yMax - yMin || 1;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  // Later ETAs plot higher, so a line that climbs means the vessel is slipping.
  const sy = (y: number) => (yMax === yMin ? H / 2 : H - pad.b - ((y - yMin) / ySpan) * (H - pad.t - pad.b));

  let path = '';
  points.forEach((p, i) => {
    path += i === 0 ? `M${sx(p.x)},${sy(p.y)}` : `H${sx(p.x)}V${sy(p.y)}`;
  });
  path += `H${sx(x1)}`;
  const last = points[points.length - 1];

  return (
    <div className="eta-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`ETA revised ${points.length - 1} times; latest ${fmtDateTime(new Date(last.y).toISOString())} local time`}>
          {(yMax === yMin ? [yMax] : [yMax, yMin]).map((y) => (
            <g key={y}>
              <line x1={pad.l} x2={width - pad.r} y1={sy(y)} y2={sy(y)} className="grid" />
              <text x={pad.l - 8} y={sy(y) + 3.5} textAnchor="end" className="axis">
                {fmtTime(new Date(y).toISOString())}
              </text>
            </g>
          ))}
          <path d={path} className="line" />
          {points.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === points.length - 1 ? 4 : 3} className={i === points.length - 1 ? 'dot latest' : 'dot'} />
          ))}
          <line x1={pad.l} x2={width - pad.r} y1={H - pad.b + 6} y2={H - pad.b + 6} className="base" />
          <text x={pad.l} y={H - 4} className="axis">
            {fmtDay(new Date(x0).toISOString())} {fmtTime(new Date(x0).toISOString())}
          </text>
          <text x={width - pad.r} y={H - 4} textAnchor="end" className="axis">
            {arrived ? 'Arrived' : 'Now'}
          </text>
        </svg>
      )}
    </div>
  );
}

export function EtaPanel({ op, now, history }: { op: BoardOp; now: number; history: boolean }) {
  if (op.etas.length === 0) return <p className="empty">No ETA has been advised yet.</p>;
  const rows = op.etas.map((e, i) => ({ e, prev: i > 0 ? op.etas[i - 1] : undefined })).reverse();
  return (
    <>
      {history && op.etas.length > 1 && (
        <>
          <p className="chart-caption">Advised ETA over time. A rising line means the vessel is running later.</p>
          <EtaChart op={op} now={now} />
        </>
      )}
      <table className="data eta-table">
        <thead>
          <tr>
            <th>ETA (LT)</th>
            <th>Change</th>
            <th>Advised</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, prev }, i) => {
            const diff = prev ? Date.parse(e.eta) - Date.parse(prev.eta) : 0;
            return (
              <tr key={e.id} className={i === 0 ? 'current' : ''}>
                <td>
                  <LT iso={e.eta} />
                  {e.note && <span className="cell-note">{e.note}</span>}
                </td>
                <td className={prev && diff !== 0 ? (diff > 0 ? 'later' : 'earlier') : ''}>
                  {!prev ? 'First ETA' : diff === 0 ? 'No change' : `${diff > 0 ? '+' : '−'}${fmtDuration(diff)}`}
                </td>
                <td>
                  <LT iso={e.receivedAt} />
                  <span className="cell-note">{e.source}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/* ───────────── Side panels ───────────── */

export function ReadinessList({ op, readiness }: { op: BoardOp; readiness: Record<ReadinessParty, Readiness> }) {
  const names: Record<ReadinessParty, string> = {
    vessel: op.vessel.name,
    supplier: op.parties.supplier,
    craft: op.craftName,
    surveyor: op.parties.surveyor,
  };
  return (
    <ul className="rows">
      {READINESS_PARTIES.map((p) => {
        const r = readiness[p];
        return (
          <li key={p}>
            <div className="row-main">
              <span className="row-title">{readinessPartyLabel(p, op.deliveryMode)}</span>
              <span className="row-sub">{names[p] || 'To be advised'}</span>
              {r.note && <span className="row-note">{r.note}</span>}
            </div>
            <span className={`pill level-${r.level}`}>{READINESS_LEVEL_LABEL[r.level]}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DeliveryList({ grades }: { grades: Grade[] }) {
  return (
    <ul className="rows delivery">
      {grades.map((g) => {
        const pct = g.nominated > 0 ? Math.min(100, (g.delivered / g.nominated) * 100) : 0;
        return (
          <li key={g.id}>
            <div className="row-main">
              <div className="delivery-line">
                <span className="row-title">{g.grade}</span>
                <span className="qty">
                  {g.delivered > 0 && <b>{fmtQty(g.delivered)} / </b>}
                  {fmtQty(g.nominated)} MT
                </span>
              </div>
              <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${g.grade} delivered`}>
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function DocumentList({ documents }: { documents: DocItem[] }) {
  return (
    <ul className="rows docs">
      {documents.map((d) => (
        <li key={d.id} className={`doc-${d.state}`}>
          <span className="doc-mark" aria-hidden="true">
            {(d.state === 'received' || d.state === 'issued') && <Icon name="check" size={11} />}
          </span>
          <div className="row-main">
            <span className="row-title">{d.name}</span>
            {(d.ref || d.at) && (
              <span className="row-sub">
                {d.ref && <>Ref {d.ref}</>}
                {d.ref && d.at && ' · '}
                {d.at && <LT iso={d.at} />}
              </span>
            )}
          </div>
          <span className="doc-state">{DOC_STATE_LABEL[d.state]}</span>
        </li>
      ))}
    </ul>
  );
}

export function PartiesList({ op }: { op: BoardOp }) {
  const rows: [string, string][] = [
    ['Vessel owner', op.parties.owner],
    ['Charterer', op.parties.charterer],
    ['Bunker trader', op.parties.trader],
    ['Physical supplier', op.parties.supplier],
    ['Surveyor', op.parties.surveyor],
    [craftWord(op.deliveryMode), op.craftName],
    ['Agent', 'Magnate Shipping Agency'],
  ];
  return (
    <dl className="parties">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

export function DelayTable({ delays, now, actions }: { delays: Delay[]; now: number; actions?: (d: Delay) => ReactNode }) {
  if (delays.length === 0) return <p className="empty">No delays have been recorded for this operation.</p>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>Attributed to</th>
            <th>From (LT)</th>
            <th>To (LT)</th>
            <th>Duration</th>
            <th>Remarks</th>
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {delays.map((d) => (
            <tr key={d.id}>
              <td>
                <span className={`pill ${d.endedAt ? 'level-pending' : 'level-issue'}`}>{DELAY_CAUSE_LABEL[d.cause]}</span>
              </td>
              <td>
                <LT iso={d.startedAt} />
              </td>
              <td>{d.endedAt ? <LT iso={d.endedAt} /> : <span className="running">Running</span>}</td>
              <td className="num">{fmtDuration((d.endedAt ? Date.parse(d.endedAt) : now) - Date.parse(d.startedAt))}</td>
              <td className="wrap">{d.note || '—'}</td>
              {actions && <td className="row-actions">{actions(d)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function opSubtitle(op: BoardOp): string {
  const grades = op.grades.map((g) => `${g.grade} ${fmtQty(g.nominated)} MT`).join(' + ');
  return `${grades} by ${op.deliveryMode}${op.craftName ? ` (${op.craftName})` : ''}`;
}
