import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { PORTS, PORT_NAMES, delayStatus, fmtDateTime, fmtLongDay, fmtTime, latestEta, milestoneAt, projectView, statusLine } from '../../shared/domain.ts';
import type { Operation } from '../../shared/domain.ts';
import { LT, MiniTrack, delayHeadline, opSubtitle } from '../components/board.tsx';
import { OperationForm } from '../components/OperationForm.tsx';
import { Dialog, Field, Icon, ThemeToggle, Wordmark } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtAgo, useNow, useStream } from '../lib/hooks.ts';

/* ───────────── Sign in ───────────── */

export function SignIn({ onSignedIn }: { onSignedIn: (name: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('mlo-operator') ?? '');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(name, passcode);
      localStorage.setItem('mlo-operator', res.name);
      onSignedIn(res.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <section className="signin-brand">
        <svg className="signin-chart" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`v${i}`} x1={i * 75} x2={i * 75} y1="0" y2="800" />
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <line key={`h${i}`} x1="0" x2="600" y1={i * 80} y2={i * 80} />
          ))}
          <path d="M-20 560 C 80 520, 150 600, 240 580 S 380 500, 470 540 S 590 600, 640 570" className="track-line" />
          <circle cx="240" cy="580" r="5" />
          <circle cx="470" cy="540" r="5" />
        </svg>
        <Wordmark />
        <div className="signin-copy">
          <h1>
            One operation.
            <br />
            One timeline.
            <br />
            Total visibility.
          </h1>
          <p>Real-time visibility of bunker operations for owners, charterers, traders, suppliers, masters and surveyors.</p>
        </div>
        <ul className="signin-ports">
          {PORTS.map((p) => (
            <li key={p.name}>
              <b>{p.name}</b>
              <span>{p.pos}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="signin-form">
        <form onSubmit={submit}>
          <h2>Operations desk</h2>
          <p className="muted">Sign in to open operations and post updates. Stakeholders do not need an account; they follow an operation through the link you share.</p>
          <Field label="Your name">
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={40} autoFocus={!name} />
          </Field>
          <Field label="Desk passcode">
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" required autoFocus={!!name} />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn primary large" disabled={busy}>
            Sign in
          </button>
          <p className="signin-foot">Magnate Shipping Agency (Pvt) Ltd</p>
        </form>
      </section>
    </div>
  );
}

/* ───────────── Console shell ───────────── */

export function ConsoleShell({ staff, onSignOut }: { staff: string; onSignOut: () => void }) {
  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner wide">
          <Link to="/console" className="topbar-home">
            <Wordmark />
          </Link>
          <span className="topbar-section">Operations desk</span>
          <div className="topbar-right">
            <span className="operator">{staff}</span>
            <button type="button" className="icon-btn on-dark" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <Icon name="out" />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

/* ───────────── Operations list ───────────── */

type Filter = 'active' | 'closed' | 'all';

export function OpsList() {
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [port, setPort] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const now = useNow();

  const load = useCallback(() => {
    api.ops().then((r) => setOps(r.ops), () => undefined);
  }, []);
  useEffect(load, [load]);
  useStream('/api/ops/stream', load);
  useEffect(() => {
    document.title = 'Operations · Magnate LiveOps';
  }, []);

  const stats = useMemo(() => {
    const active = (ops ?? []).filter((o) => o.status === 'active');
    return {
      active: active.length,
      delayed: active.filter((o) => o.delays.some((d) => !d.endedAt)).length,
      arriving: active.filter((o) => {
        const eta = latestEta(o);
        return eta && !milestoneAt(o, 'vessel_arrived') && Date.parse(eta.eta) - now < 24 * 3600_000;
      }).length,
      delivering: active.filter((o) => o.milestones.bunkering_commenced.state === 'done' && o.milestones.bunkering_completed.state !== 'done').length,
    };
  }, [ops, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (ops ?? [])
      .filter((o) => filter === 'all' || (filter === 'active' ? o.status === 'active' : o.status !== 'active'))
      .filter((o) => !port || o.port === port)
      .filter((o) => !q || `${o.vessel.name} ${o.ref} ${o.vessel.imo} ${Object.values(o.parties).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => {
        // Operations needing attention first: open delays, then nearest ETA.
        const da = a.delays.some((d) => !d.endedAt) ? 0 : 1;
        const db = b.delays.some((d) => !d.endedAt) ? 0 : 1;
        if (a.status === 'active' && b.status === 'active' && da !== db) return da - db;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [ops, filter, port, query]);

  const today = new Date(now).toISOString();

  return (
    <main className="page wide">
      <div className="list-head">
        <div>
          <h1>Operations</h1>
          <p className="muted">
            {fmtLongDay(today)} · <span className="mono">{fmtTime(today)}</span> local time
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          New operation
        </button>
      </div>

      <dl className="tally">
        <div>
          <dt>Active</dt>
          <dd>{stats.active}</dd>
        </div>
        <div className={stats.delayed ? 'alert' : ''}>
          <dt>Delay in progress</dt>
          <dd>{stats.delayed}</dd>
        </div>
        <div>
          <dt>Arriving within 24 h</dt>
          <dd>{stats.arriving}</dd>
        </div>
        <div>
          <dt>Delivering now</dt>
          <dd>{stats.delivering}</dd>
        </div>
      </dl>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter operations">
          {(['active', 'closed', 'all'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'active' ? 'Active' : f === 'closed' ? 'Closed' : 'All'}
            </button>
          ))}
        </div>
        <select value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port">
          <option value="">All ports</option>
          {PORT_NAMES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="search">
          <Icon name="search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vessel, reference or party" aria-label="Search operations" />
        </div>
      </div>

      {ops === null ? (
        <div className="loading inline" role="status">Loading operations</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h2>{ops.length === 0 ? 'No operations yet' : 'Nothing matches these filters'}</h2>
          <p>{ops.length === 0 ? 'Open the first operation to create its live board and share links.' : 'Try a different port, status or search term.'}</p>
        </div>
      ) : (
        <div className="table-scroll ops-table-wrap">
          <table className="data ops-table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Port</th>
                <th>Status</th>
                <th>ETA / arrival (LT)</th>
                <th>Progress</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const view = projectView(o, 'magnate');
                const delay = delayHeadline(delayStatus(o.delays), now);
                const arrived = milestoneAt(o, 'vessel_arrived');
                const eta = latestEta(o);
                return (
                  <tr key={o.id} onClick={() => navigate(`/console/ops/${o.id}`)} className={o.status !== 'active' ? 'closed' : ''}>
                    <td>
                      <Link to={`/console/ops/${o.id}`} className="vessel-link" onClick={(e) => e.stopPropagation()}>
                        {o.vessel.name}
                      </Link>
                      <span className="cell-note">
                        <span className="mono">{o.ref}</span> · {opSubtitle(view.op)}
                      </span>
                    </td>
                    <td>
                      {o.port}
                      <span className="cell-note">{o.location}</span>
                    </td>
                    <td>
                      {statusLine(o)}
                      {o.status === 'active' && delay.tone !== 'ok' && <span className={`cell-note tone-${delay.tone}`}>{delay.tone === 'bad' ? `${delay.value}, ${delay.sub.split(',')[0].toLowerCase()}` : delay.sub}</span>}
                    </td>
                    <td>
                      {arrived ? (
                        <>
                          <LT iso={arrived} />
                          <span className="cell-note">Arrived</span>
                        </>
                      ) : eta ? (
                        <>
                          <LT iso={eta.eta} />
                          <span className="cell-note">{o.etas.length > 1 ? `${o.etas.length - 1} ${o.etas.length === 2 ? 'revision' : 'revisions'}` : 'First ETA'}</span>
                        </>
                      ) : (
                        <span className="muted">Awaiting ETA</span>
                      )}
                    </td>
                    <td>
                      <MiniTrack op={view.op} />
                    </td>
                    <td className="muted" title={`${fmtDateTime(o.updatedAt)} LT`}>
                      {fmtAgo(o.updatedAt, now)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Dialog title="New operation" onClose={() => setCreating(false)} wide>
          <OperationForm
            onCancel={() => setCreating(false)}
            onSubmit={async (details) => {
              const created = await api.create(details);
              navigate(`/console/ops/${created.op.id}`);
            }}
          />
        </Dialog>
      )}
    </main>
  );
}
