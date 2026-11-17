import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  DELAY_CAUSE_LABEL,
  DOC_STATE_LABEL,
  FEED_KIND_LABEL,
  MILESTONES,
  PORTS,
  ROLE_LABEL,
  craftWord,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtQty,
  initialEta,
  latestEta,
  milestoneAt,
  milestoneLabel,
  projectView,
  statusLine,
  totalDelivered,
} from '../../shared/domain.ts';
import type { BoardView, MilestoneKey } from '../../shared/domain.ts';
import { FullMessage, Icon } from '../components/ui.tsx';
import { ApiError, api } from '../lib/api.ts';
import { LinkGone, useLiveView } from './Board.tsx';

const dt = (iso?: string) => (iso ? fmtDateTime(iso) : '—');

function ReportDocument({ view, backTo }: { view: BoardView; backTo: string }) {
  const { op, delay } = view;
  const now = Date.now();
  const final = op.status === 'completed';
  const at = (k: MilestoneKey) => milestoneAt(op, k);
  const between = (a?: string, b?: string) => (a && b ? fmtDuration(Date.parse(b) - Date.parse(a)) : '—');
  const pumpingMs = at('bunkering_commenced') && at('bunkering_completed') ? Date.parse(at('bunkering_completed')!) - Date.parse(at('bunkering_commenced')!) : 0;
  const delivered = totalDelivered(op.grades);
  const rate = pumpingMs > 0 && delivered > 0 ? `${fmtQty(Math.round(delivered / (pumpingMs / 3600_000)))} MT per hour` : '—';
  const openMs = delay.open.reduce((s, d) => s + (now - Date.parse(d.startedAt)), 0);
  const port = PORTS.find((p) => p.name === op.port)!;
  const first = initialEta(op);
  const last = latestEta(op);

  useEffect(() => {
    document.title = `${op.ref} ${op.vessel.name} · ${final ? 'Final report' : 'Operation report'}`;
  }, [op, final]);

  return (
    <div className="report-page">
      <div className="report-bar no-print">
        <Link className="btn ghost" to={backTo}>
          <Icon name="back" />
          Back to board
        </Link>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          <Icon name="print" />
          Print or save as PDF
        </button>
      </div>

      <article className="report">
        <header className="report-head">
          <div>
            <p className="report-brand">Magnate Shipping Agency (Pvt) Ltd</p>
            <p className="report-brand-sub">Sri Lanka · Colombo · Galle · Hambantota · Trincomalee</p>
          </div>
          <div className="report-id">
            <span>{final ? 'Final operation report' : 'Interim operation report'}</span>
            <b>{op.ref}</b>
          </div>
        </header>

        <h1>{op.vessel.name}</h1>
        <p className="report-lede">
          Bunker delivery at {op.port}
          {op.location && `, ${op.location}`} ({port.pos}). {final ? `Completed ${dt(op.closedAt)} LT.` : `Status at ${fmtDateTime(new Date(now).toISOString())} LT: ${statusLine(op)}.`}
        </p>
        {!final && <p className="report-flag">Interim report. The operation is still open and the figures below may change.</p>}

        <section className="report-cols">
          <div>
            <h2>Operation</h2>
            <dl className="kv">
              <div><dt>Vessel</dt><dd>{op.vessel.name}{op.vessel.type && `, ${op.vessel.type}`}</dd></div>
              {op.vessel.imo && <div><dt>IMO number</dt><dd>{op.vessel.imo}</dd></div>}
              <div><dt>Port and location</dt><dd>{op.port}{op.location && `, ${op.location}`}</dd></div>
              <div><dt>Delivery by</dt><dd>{craftWord(op.deliveryMode)}{op.craftName && `, ${op.craftName}`}</dd></div>
              <div><dt>Opened</dt><dd>{fmtDate(op.createdAt)}</dd></div>
            </dl>
          </div>
          <div>
            <h2>Parties</h2>
            <dl className="kv">
              <div><dt>Vessel owner</dt><dd>{op.parties.owner || '—'}</dd></div>
              <div><dt>Charterer</dt><dd>{op.parties.charterer || '—'}</dd></div>
              <div><dt>Bunker trader</dt><dd>{op.parties.trader || '—'}</dd></div>
              <div><dt>Physical supplier</dt><dd>{op.parties.supplier || '—'}</dd></div>
              <div><dt>Surveyor</dt><dd>{op.parties.surveyor || '—'}</dd></div>
            </dl>
          </div>
        </section>

        <section>
          <h2>Quantities</h2>
          <table className="data">
            <thead>
              <tr><th>Grade</th><th className="num">Nominated (MT)</th><th className="num">Delivered (MT)</th><th className="num">Difference (MT)</th></tr>
            </thead>
            <tbody>
              {op.grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.grade}</td>
                  <td className="num">{fmtQty(g.nominated)}</td>
                  <td className="num">{g.delivered > 0 ? fmtQty(g.delivered) : '—'}</td>
                  <td className="num">{g.delivered > 0 ? fmtQty(Math.round((g.delivered - g.nominated) * 1000) / 1000) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="report-cols">
          <div>
            <h2>Key times (local, UTC+05:30)</h2>
            <dl className="kv">
              <div><dt>First advised ETA</dt><dd>{dt(first?.eta)}</dd></div>
              <div><dt>Last advised ETA</dt><dd>{dt(last?.eta)}{op.etas.length > 1 && view.modules.includes('etaHistory') ? ` (${op.etas.length - 1} ${op.etas.length === 2 ? 'revision' : 'revisions'})` : ''}</dd></div>
              <div><dt>Vessel arrived</dt><dd>{dt(at('vessel_arrived'))}</dd></div>
              <div><dt>{milestoneLabel('barge_alongside', op.deliveryMode)}</dt><dd>{dt(at('barge_alongside'))}</dd></div>
              <div><dt>Bunkering commenced</dt><dd>{dt(at('bunkering_commenced'))}</dd></div>
              <div><dt>Bunkering completed</dt><dd>{dt(at('bunkering_completed'))}</dd></div>
              <div><dt>{milestoneLabel('barge_cast_off', op.deliveryMode)}</dt><dd>{dt(at('barge_cast_off'))}</dd></div>
            </dl>
          </div>
          <div>
            <h2>Performance</h2>
            <dl className="kv">
              <div><dt>Arrival against first ETA</dt><dd>{first && at('vessel_arrived') ? `${fmtDuration(Date.parse(at('vessel_arrived')!) - Date.parse(first.eta))} ${Date.parse(at('vessel_arrived')!) >= Date.parse(first.eta) ? 'later' : 'earlier'}` : '—'}</dd></div>
              <div><dt>Arrival to alongside</dt><dd>{between(at('vessel_arrived'), at('barge_alongside'))}</dd></div>
              <div><dt>Alongside to commencement</dt><dd>{between(at('barge_alongside'), at('bunkering_commenced'))}</dd></div>
              <div><dt>Pumping time</dt><dd>{pumpingMs ? fmtDuration(pumpingMs) : '—'}</dd></div>
              <div><dt>Average delivery rate</dt><dd>{rate}</dd></div>
              <div><dt>Arrival to cast off</dt><dd>{between(at('vessel_arrived'), at('barge_cast_off'))}</dd></div>
              <div><dt>Recorded delay</dt><dd>{delay.closedCount + delay.open.length === 0 ? 'None' : fmtDuration(delay.closedMs + openMs)}</dd></div>
            </dl>
          </div>
        </section>

        <section>
          <h2>Milestone timeline</h2>
          <table className="data">
            <thead>
              <tr><th>Milestone</th><th>Status</th><th>Time (LT)</th></tr>
            </thead>
            <tbody>
              {MILESTONES.map((m) => {
                const mark = op.milestones[m.key];
                return (
                  <tr key={m.key} className={mark.state === 'pending' ? 'dim' : ''}>
                    <td>{milestoneLabel(m.key, op.deliveryMode)}</td>
                    <td>{mark.state === 'done' ? 'Completed' : mark.state === 'active' ? 'In progress' : 'Not reached'}</td>
                    <td>{mark.state === 'done' ? dt(mark.at) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {view.modules.includes('etaHistory') && op.etas.length > 0 && (
          <section>
            <h2>ETA record</h2>
            <table className="data">
              <thead>
                <tr><th>Advised at (LT)</th><th>By</th><th>ETA (LT)</th><th>Change</th><th>Remarks</th></tr>
              </thead>
              <tbody>
                {op.etas.map((e, i) => {
                  const diff = i > 0 ? Date.parse(e.eta) - Date.parse(op.etas[i - 1].eta) : 0;
                  return (
                    <tr key={e.id}>
                      <td>{dt(e.receivedAt)}</td>
                      <td>{e.source}</td>
                      <td>{dt(e.eta)}</td>
                      <td>{i === 0 ? 'First ETA' : diff === 0 ? 'No change' : `${diff > 0 ? '+' : '−'}${fmtDuration(diff)}`}</td>
                      <td className="wrap">{e.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {op.delays && (
          <section>
            <h2>Delays</h2>
            {op.delays.length === 0 ? (
              <p>No delays were recorded for this operation.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr><th>Attributed to</th><th>From (LT)</th><th>To (LT)</th><th>Duration</th><th>Remarks</th></tr>
                </thead>
                <tbody>
                  {op.delays.map((d) => (
                    <tr key={d.id}>
                      <td>{DELAY_CAUSE_LABEL[d.cause]}</td>
                      <td>{dt(d.startedAt)}</td>
                      <td>{d.endedAt ? dt(d.endedAt) : 'Still running'}</td>
                      <td>{fmtDuration((d.endedAt ? Date.parse(d.endedAt) : now) - Date.parse(d.startedAt))}</td>
                      <td className="wrap">{d.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {op.documents && (
          <section>
            <h2>Documents</h2>
            <table className="data">
              <thead>
                <tr><th>Document</th><th>Status</th><th>Reference</th><th>Recorded (LT)</th></tr>
              </thead>
              <tbody>
                {op.documents.map((d) => (
                  <tr key={d.id} className={d.state === 'pending' ? 'dim' : ''}>
                    <td>{d.name}</td>
                    <td>{DOC_STATE_LABEL[d.state]}</td>
                    <td>{d.ref || '—'}</td>
                    <td>{dt(d.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {op.remarks && (
          <section>
            <h2>Agent's remarks</h2>
            <p className="report-remarks">{op.remarks}</p>
          </section>
        )}

        <section>
          <h2>Update log</h2>
          <table className="data log">
            <thead>
              <tr><th>Time (LT)</th><th>Type</th><th>Update</th></tr>
            </thead>
            <tbody>
              {op.feed.map((f) => (
                <tr key={f.id}>
                  <td>{dt(f.at)}</td>
                  <td>{FEED_KIND_LABEL[f.kind]}</td>
                  <td className="wrap">{f.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="report-foot">
          <p>
            Prepared by Magnate Shipping Agency (Pvt) Ltd as agent, from times and information reported to the agent during the operation
            {view.viewer !== 'magnate' && `, for the ${ROLE_LABEL[view.viewer].toLowerCase()}`}. Generated {fmtDateTime(new Date(now).toISOString())} LT.
          </p>
        </footer>
      </article>
    </div>
  );
}

/** Report opened from a stakeholder's share link. */
export function SharedReport() {
  const { token } = useParams();
  const { view, gone } = useLiveView(token);
  if (gone) return <LinkGone />;
  if (!view) return <div className="loading" role="status">Loading report</div>;
  if (!view.modules.includes('report')) {
    return (
      <FullMessage title="The report is not part of this link">
        <p>
          <Link to={`/live/${token}`}>Return to the live board</Link>
        </p>
      </FullMessage>
    );
  }
  return <ReportDocument view={view} backTo={`/live/${token}`} />;
}

/** Full report opened from the operations console. */
export function ConsoleReport() {
  const { id } = useParams();
  const [view, setView] = useState<BoardView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    api.op(id).then(
      (d) => setView(projectView(d.op, 'magnate')),
      (err: unknown) => setError(err instanceof ApiError ? err.message : 'The report could not be loaded.'),
    );
  }, [id]);
  if (error) return <FullMessage title={error} />;
  if (!view) return <div className="loading" role="status">Loading report</div>;
  return <ReportDocument view={view} backTo={`/console/ops/${id}`} />;
}
