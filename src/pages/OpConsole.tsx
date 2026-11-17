import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  DELAY_CAUSES,
  DELAY_CAUSE_LABEL,
  DOC_STATES,
  DOC_STATE_LABEL,
  FEED_KINDS,
  FEED_KIND_LABEL,
  MILESTONES,
  PHASES,
  READINESS_LEVELS,
  READINESS_LEVEL_LABEL,
  READINESS_PARTIES,
  ROLES,
  ROLE_LABEL,
  ROLE_SEES,
  fmtDateTime,
  fromLTInput,
  latestEta,
  milestoneLabel,
  projectView,
  readinessPartyLabel,
  toLTInput,
} from '../../shared/domain.ts';
import type { DocItem, FeedKind, MilestoneKey, MilestoneState, Operation, ReadinessParty, Role } from '../../shared/domain.ts';
import { DelayTable, EtaPanel, FeedList, LT, StatusStrip, opSubtitle } from '../components/board.tsx';
import { OperationForm } from '../components/OperationForm.tsx';
import { Dialog, Field, FullMessage, Icon, Panel } from '../components/ui.tsx';
import { ApiError, api } from '../lib/api.ts';
import type { Action, OpDetail } from '../lib/api.ts';
import { fmtAgo, useCopy, useNow, useStream } from '../lib/hooks.ts';

type Act = (action: Action) => Promise<boolean>;

const nowInput = () => toLTInput(new Date().toISOString());

/* ───────────── Composer: update, ETA revision, delay ───────────── */

function Composer({ op, act }: { op: Operation; act: Act }) {
  const [tab, setTab] = useState<'update' | 'eta' | 'delay'>('update');
  return (
    <section className="panel composer">
      <div className="composer-tabs" role="tablist">
        {(
          [
            ['update', 'Post update'],
            ['eta', 'Revise ETA'],
            ['delay', 'Report delay'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'update' && <UpdateForm act={act} />}
      {tab === 'eta' && <EtaForm op={op} act={act} />}
      {tab === 'delay' && <DelayForm act={act} />}
    </section>
  );
}

function UpdateForm({ act }: { act: Act }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<FeedKind>('notice');
  const [audience, setAudience] = useState<Role[]>([...ROLES]);
  const all = audience.length === ROLES.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await act({ type: 'feed.post', text, kind, audience })) setText('');
  }

  return (
    <form className="composer-body" onSubmit={submit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write once. Every party on this operation sees it immediately."
        rows={3}
        maxLength={600}
        required
        aria-label="Update"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="audience">
        <span className="field-label">Visible to</span>
        <div className="chips">
          <button type="button" className={`chip ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => setAudience(all ? [] : [...ROLES])}>
            All parties
          </button>
          {ROLES.map((r) => {
            const on = audience.includes(r);
            return (
              <button key={r} type="button" className={`chip ${on && !all ? 'on' : ''} ${all ? 'implied' : ''}`} aria-pressed={on} onClick={() => setAudience(all ? [r] : on ? audience.filter((x) => x !== r) : [...audience, r])}>
                {ROLE_LABEL[r]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="composer-foot">
        <select value={kind} onChange={(e) => setKind(e.target.value as FeedKind)} aria-label="Category">
          {FEED_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEED_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="muted hint">Ctrl + Enter to post</span>
        <button type="submit" className="btn primary" disabled={!text.trim() || audience.length === 0}>
          <Icon name="send" />
          Post to board
        </button>
      </div>
    </form>
  );
}

function EtaForm({ op, act }: { op: Operation; act: Act }) {
  const current = latestEta(op);
  const [eta, setEta] = useState(current ? toLTInput(current.eta) : '');
  const [source, setSource] = useState('Master');
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await act({ type: 'eta.revise', eta: fromLTInput(eta), source, note })) setNote('');
  }

  return (
    <form className="composer-body" onSubmit={submit}>
      <div className="form-grid">
        <Field label="New ETA" hint="local time">
          <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} required />
        </Field>
        <Field label="Advised by">
          <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} required />
        </Field>
        <Field label="Reason" hint="optional">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="e.g. Reduced speed in heavy swell" />
        </Field>
      </div>
      <div className="composer-foot">
        <span className="muted hint">{current ? <>Currently <LT iso={current.eta} /> LT. The change is posted to all parties.</> : 'This will be recorded as the first ETA.'}</span>
        <button type="submit" className="btn primary" disabled={!eta}>
          {current ? 'Publish revised ETA' : 'Publish ETA'}
        </button>
      </div>
    </form>
  );
}

function DelayForm({ act }: { act: Act }) {
  const [cause, setCause] = useState<(typeof DELAY_CAUSES)[number]>('weather');
  const [startedAt, setStartedAt] = useState(nowInput);
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await act({ type: 'delay.open', cause, startedAt: fromLTInput(startedAt), note })) setNote('');
  }

  return (
    <form className="composer-body" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Attributed to">
          <select value={cause} onChange={(e) => setCause(e.target.value as typeof cause)}>
            {DELAY_CAUSES.map((c) => (
              <option key={c} value={c}>
                {DELAY_CAUSE_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Started" hint="local time">
          <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required />
        </Field>
        <Field label="What is holding the operation" hint="optional">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
        </Field>
      </div>
      <div className="composer-foot">
        <span className="muted hint">The delay shows on every board until you mark it cleared.</span>
        <button type="submit" className="btn danger">
          Report delay
        </button>
      </div>
    </form>
  );
}

/* ───────────── Milestones ───────────── */

function MilestoneRow({ op, k, act }: { op: Operation; k: MilestoneKey; act: Act }) {
  const mark = op.milestones[k];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const set = (state: MilestoneState) => act({ type: 'milestone.set', key: k, state });

  function saveTime() {
    setEditing(false);
    const iso = fromLTInput(value);
    if (iso && iso !== mark.at) void act({ type: 'milestone.set', key: k, state: mark.state, at: iso });
  }

  return (
    <li className={`ms-row ${mark.state}`}>
      <button
        type="button"
        className="ms-check"
        aria-label={mark.state === 'done' ? 'Mark as not reached' : 'Mark as completed now'}
        title={mark.state === 'done' ? 'Mark as not reached' : 'Mark as completed now'}
        onClick={() => set(mark.state === 'done' ? 'pending' : 'done')}
      >
        {mark.state === 'done' && <Icon name="check" size={12} />}
      </button>
      <span className="ms-label">{milestoneLabel(k, op.deliveryMode)}</span>
      {mark.state === 'pending' && (
        <button type="button" className="link-btn" onClick={() => set('active')}>
          Start
        </button>
      )}
      {mark.state === 'active' && (
        <button type="button" className="link-btn active" onClick={() => set('pending')} title="Clear in-progress">
          In progress
        </button>
      )}
      {mark.state === 'done' &&
        mark.at &&
        (editing ? (
          <input
            type="datetime-local"
            className="ms-time-input"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onBlur={saveTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTime();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Milestone time, local"
          />
        ) : (
          <button
            type="button"
            className="link-btn time"
            title="Correct the time"
            onClick={() => {
              setValue(toLTInput(mark.at!));
              setEditing(true);
            }}
          >
            {fmtDateTime(mark.at)}
          </button>
        ))}
    </li>
  );
}

function MilestoneControl({ op, act }: { op: Operation; act: Act }) {
  return (
    <Panel title="Milestones" aside={<span className="muted">Tick to record the time now</span>}>
      <div className="ms-control">
        {PHASES.map((p) => (
          <div key={p.key}>
            <h3>{p.label}</h3>
            <ul>
              {MILESTONES.filter((m) => m.phase === p.key).map((m) => (
                <MilestoneRow key={m.key} op={op} k={m.key} act={act} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ───────────── Share links ───────────── */

function ShareLinks({ detail, act, now }: { detail: OpDetail; act: Act; now: number }) {
  const { op, watching } = detail;
  const [copied, copy] = useCopy();
  const url = (role: Role) => `${window.location.origin}/live/${op.links[role].token}`;
  const invite = (role: Role) => `${op.vessel.name} bunker operation at ${op.port}: follow live status here ${url(role)} (Magnate Shipping, ref ${op.ref})`;

  return (
    <Panel title="Share links" aside={<span className="muted">One link per party</span>}>
      <ul className="rows links">
        {ROLES.map((role) => {
          const link = op.links[role];
          return (
            <li key={role} className={link.enabled ? '' : 'off'}>
              <div className="row-main">
                <span className="row-title">
                  {ROLE_LABEL[role]}
                  {watching[role] > 0 && (
                    <span className="watching">
                      <i aria-hidden="true" />
                      {watching[role]} viewing
                    </span>
                  )}
                </span>
                <span className="row-sub" title={`Sees: ${ROLE_SEES[role]}`}>
                  {!link.enabled ? 'Link switched off' : link.lastOpenedAt ? `Opened ${link.opens}×, last ${fmtAgo(link.lastOpenedAt, now)}` : 'Not opened yet'}
                </span>
              </div>
              <div className="row-actions">
                {link.enabled && (
                  <>
                    <button type="button" className="btn small" onClick={() => copy(role, url(role))}>
                      <Icon name={copied === role ? 'check' : 'copy'} size={14} />
                      {copied === role ? 'Copied' : 'Copy link'}
                    </button>
                    <button type="button" className="icon-btn" title="Copy a ready-to-send message" aria-label={`Copy message for ${ROLE_LABEL[role]}`} onClick={() => copy(`${role}-msg`, invite(role))}>
                      <Icon name={copied === `${role}-msg` ? 'check' : 'send'} size={14} />
                    </button>
                    <a className="icon-btn" href={url(role)} target="_blank" rel="noreferrer" title={`Preview as ${ROLE_LABEL[role]}`} aria-label={`Preview as ${ROLE_LABEL[role]}`}>
                      <Icon name="eye" size={14} />
                    </a>
                  </>
                )}
                <details className="menu">
                  <summary className="icon-btn" aria-label="More link options">⋯</summary>
                  <div className="menu-list">
                    <button type="button" onClick={() => act({ type: 'link.toggle', role, enabled: !link.enabled })}>
                      {link.enabled ? 'Switch link off' : 'Switch link on'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Replace the ${ROLE_LABEL[role]} link? The current link will stop working.`)) void act({ type: 'link.rotate', role });
                      }}
                    >
                      Replace with a new link
                    </button>
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ───────────── Readiness, delivery, documents ───────────── */

function ReadinessRow({ op, party, act }: { op: Operation; party: ReadinessParty; act: Act }) {
  const r = op.readiness[party];
  const [note, setNote] = useState(r.note);
  useEffect(() => setNote(r.note), [r.note]);
  return (
    <li className="control-row">
      <div className="control-top">
        <span className="row-title">{readinessPartyLabel(party, op.deliveryMode)}</span>
        <div className="segmented small">
          {READINESS_LEVELS.map((level) => (
            <button key={level} type="button" className={`${r.level === level ? 'on' : ''} level-${level}`} aria-pressed={r.level === level} onClick={() => act({ type: 'readiness.set', party, level, note })}>
              {READINESS_LEVEL_LABEL[level]}
            </button>
          ))}
        </div>
      </div>
      <input
        className="quiet-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== r.note && act({ type: 'readiness.set', party, level: r.level, note })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Add a note"
        maxLength={160}
        aria-label={`${readinessPartyLabel(party, op.deliveryMode)} note`}
      />
    </li>
  );
}

function DeliveryControl({ op, act }: { op: Operation; act: Act }) {
  return (
    <Panel title="Delivered quantity">
      <ul className="rows">
        {op.grades.map((g) => (
          <li key={g.id} className="control-row inline">
            <span className="row-title">{g.grade}</span>
            <div className="unit-input">
              <input
                type="number"
                min="0"
                step="any"
                defaultValue={g.delivered || ''}
                key={g.delivered}
                placeholder="0"
                aria-label={`${g.grade} delivered`}
                onBlur={(e) => Number(e.target.value || 0) !== g.delivered && act({ type: 'delivery.set', gradeId: g.id, delivered: Number(e.target.value || 0) })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span>of {g.nominated.toLocaleString('en-GB')} MT</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DocRow({ doc, act }: { doc: DocItem; act: Act }) {
  const [ref, setRef] = useState(doc.ref);
  useEffect(() => setRef(doc.ref), [doc.ref]);
  return (
    <li className={`control-row doc-${doc.state}`}>
      <div className="control-top">
        <span className="row-title">{doc.name}</span>
        <select value={doc.state} className={`state-select state-${doc.state}`} onChange={(e) => act({ type: 'doc.set', id: doc.id, state: e.target.value, ref })} aria-label={`${doc.name} status`}>
          {DOC_STATES.map((s) => (
            <option key={s} value={s}>
              {DOC_STATE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="control-bottom">
        <input
          className="quiet-input"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onBlur={() => ref.trim() !== doc.ref && act({ type: 'doc.set', id: doc.id, state: doc.state, ref })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="Reference number"
          maxLength={60}
          aria-label={`${doc.name} reference`}
        />
        <button type="button" className="icon-btn subtle" title="Remove from checklist" aria-label={`Remove ${doc.name}`} onClick={() => act({ type: 'doc.remove', id: doc.id })}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  );
}

function DocumentControl({ op, act }: { op: Operation; act: Act }) {
  const [name, setName] = useState('');
  const settled = op.documents.filter((d) => d.state !== 'pending').length;
  return (
    <Panel title="Document checklist" aside={<span className="muted">{settled} of {op.documents.length}</span>}>
      <ul className="rows">
        {op.documents.map((d) => (
          <DocRow key={d.id} doc={d} act={act} />
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ type: 'doc.add', name })) setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a document, e.g. Letter of protest" maxLength={80} aria-label="New document name" />
        <button type="submit" className="btn small" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </Panel>
  );
}

/* ───────────── Page ───────────── */

export default function OpConsole() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const [detail, setDetail] = useState<OpDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [remarks, setRemarks] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    api.op(id).then(setDetail, (err: unknown) => {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    });
  }, [id]);
  useEffect(load, [load]);
  useStream('/api/ops/stream', (data) => {
    if (data === null || (data as { id?: string }).id === id) load();
  });

  const act = useCallback<Act>(
    async (action) => {
      if (!id) return false;
      try {
        setDetail(await api.act(id, action));
        setNotice('');
        return true;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'That change could not be saved.');
        return false;
      }
    },
    [id],
  );

  const op = detail?.op;
  const view = useMemo(() => (op ? projectView(op, 'magnate') : null), [op]);
  useEffect(() => {
    if (op) {
      document.title = `${op.vessel.name} · Magnate LiveOps`;
      setRemarks(op.remarks);
    }
  }, [op?.vessel.name, op?.remarks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) {
    return (
      <FullMessage title="Operation not found">
        <p>
          <Link to="/console">Back to operations</Link>
        </p>
      </FullMessage>
    );
  }
  if (!detail || !op || !view) return <div className="loading" role="status">Loading operation</div>;

  const closed = op.status !== 'active';

  return (
    <main className="page wide">
      <section className="op-head console-head">
        <div className="op-head-main">
          <p className="op-ref">
            <Link to="/console" className="back-link">
              <Icon name="back" size={14} />
              Operations
            </Link>
            <span>{op.ref}</span>
            {op.demo && <span className="sample-tag">Sample operation</span>}
            {closed && <span className="sample-tag">{op.status === 'completed' ? 'Completed' : 'Cancelled'}</span>}
          </p>
          <h1>{op.vessel.name}</h1>
          <p className="op-meta">
            <b>
              {op.port}
              {op.location && `, ${op.location}`}
            </b>
            <span>{opSubtitle(view.op)}</span>
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <Icon name="edit" />
            Details
          </button>
          <Link className="btn" to="report">
            <Icon name="report" />
            Report
          </Link>
          {closed ? (
            <button type="button" className="btn" onClick={() => act({ type: 'op.status', status: 'active' })}>
              Reopen
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (window.confirm('Mark this operation as completed? All parties will be told and the final report becomes available.')) void act({ type: 'op.status', status: 'completed' });
              }}
            >
              <Icon name="check" />
              Complete operation
            </button>
          )}
        </div>
      </section>

      {notice && (
        <p className="banner bad" role="alert">
          {notice}
          <button type="button" className="icon-btn" onClick={() => setNotice('')} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </p>
      )}

      <StatusStrip view={view} now={now} />

      <div className="console-grid">
        <div className="console-main">
          <Composer op={op} act={act} />

          <Panel title="Delays">
            <DelayTable
              delays={op.delays}
              now={now}
              actions={(d) => (
                <>
                  {!d.endedAt && (
                    <button type="button" className="btn small" onClick={() => act({ type: 'delay.close', id: d.id })}>
                      Mark cleared
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn subtle"
                    title="Delete this delay record"
                    aria-label="Delete this delay record"
                    onClick={() => {
                      if (window.confirm('Delete this delay record? It will be removed from the report.')) void act({ type: 'delay.remove', id: d.id });
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </>
              )}
            />
          </Panel>

          <Panel title="Live update feed" aside={<span className="muted">{op.feed.length} entries</span>}>
            <FeedList entries={op.feed} admin onRemove={(entryId) => act({ type: 'feed.remove', id: entryId })} />
          </Panel>
        </div>

        <div className="console-mid">
          <MilestoneControl op={op} act={act} />
          <Panel title="ETA history">
            <EtaPanel op={view.op} now={now} history />
          </Panel>
        </div>

        <div className="console-side">
          <ShareLinks detail={detail} act={act} now={now} />
          <Panel title="Readiness">
            <ul className="rows">
              {READINESS_PARTIES.map((p) => (
                <ReadinessRow key={p} op={op} party={p} act={act} />
              ))}
            </ul>
          </Panel>
          <DeliveryControl op={op} act={act} />
          <DocumentControl op={op} act={act} />
          <Panel title="Remarks for the final report">
            <div className="remarks">
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4} maxLength={4000} placeholder="Anything the parties should have on record: quantity disputes, protests, observations." aria-label="Remarks" />
              <button type="button" className="btn small" disabled={remarks.trim() === op.remarks} onClick={() => act({ type: 'remarks.set', remarks })}>
                Save remarks
              </button>
            </div>
          </Panel>
          <div className="danger-zone">
            {!closed && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  if (window.confirm('Cancel this operation? All parties will see it as cancelled.')) void act({ type: 'op.status', status: 'cancelled' });
                }}
              >
                Cancel operation
              </button>
            )}
            <button
              type="button"
              className="link-btn bad"
              onClick={() => {
                if (window.confirm(`Permanently delete ${op.ref} and its share links? This cannot be undone.`)) void api.remove(op.id).then(() => navigate('/console'));
              }}
            >
              Delete operation
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <Dialog title="Operation details" onClose={() => setEditing(false)} wide>
          <OperationForm
            op={op}
            onCancel={() => setEditing(false)}
            onSubmit={async (details) => {
              setDetail(await api.act(op.id, { type: 'details.set', ...details }));
              setEditing(false);
            }}
          />
        </Dialog>
      )}
    </main>
  );
}
