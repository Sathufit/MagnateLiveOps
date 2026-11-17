import { useState } from 'react';
import type { FormEvent } from 'react';
import { COMMON_GRADES, PORT_NAMES, fromLTInput, toLTInput } from '../../shared/domain.ts';
import type { DeliveryMode, Operation, Parties, PortName } from '../../shared/domain.ts';
import { Field, Icon } from './ui.tsx';

interface GradeRow {
  id?: string;
  grade: string;
  nominated: string;
}

const LOCATIONS = ['Outer anchorage', 'Inner anchorage', 'OPL', 'Alongside berth'];
const PARTY_FIELDS: [keyof Parties, string][] = [
  ['owner', 'Vessel owner'],
  ['charterer', 'Charterer'],
  ['trader', 'Bunker trader'],
  ['supplier', 'Physical supplier'],
  ['surveyor', 'Surveyor'],
];

/** Create a new operation, or edit the details of an existing one. */
export function OperationForm({ op, onSubmit, onCancel }: { op?: Operation; onSubmit: (details: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(op?.vessel.name ?? '');
  const [imo, setImo] = useState(op?.vessel.imo ?? '');
  const [type, setType] = useState(op?.vessel.type ?? '');
  const [port, setPort] = useState<PortName>(op?.port ?? 'Colombo');
  const [location, setLocation] = useState(op?.location ?? '');
  const [mode, setMode] = useState<DeliveryMode>(op?.deliveryMode ?? 'barge');
  const [craftName, setCraftName] = useState(op?.craftName ?? '');
  const [parties, setParties] = useState<Parties>(op?.parties ?? { owner: '', charterer: '', trader: '', supplier: '', surveyor: '' });
  const [grades, setGrades] = useState<GradeRow[]>(
    op ? op.grades.map((g) => ({ id: g.id, grade: g.grade, nominated: String(g.nominated) })) : [{ grade: 'VLSFO', nominated: '' }],
  );
  const [eta, setEta] = useState('');
  const [etaSource, setEtaSource] = useState('Master');
  const [headline, setHeadline] = useState(op?.headline ?? '');
  const [etc, setEtc] = useState(op?.etc ? toLTInput(op.etc) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setGrade = (i: number, patch: Partial<GradeRow>) => setGrades((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        vessel: { name, imo, type },
        port,
        location,
        deliveryMode: mode,
        craftName,
        parties,
        grades: grades.map((g) => ({ id: g.id, grade: g.grade, nominated: Number(g.nominated) })),
        ...(op ? { headline, etc: etc ? fromLTInput(etc) : '' } : { eta: eta ? fromLTInput(eta) : '', etaSource }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="dialog-body">
        <fieldset>
          <legend>Vessel</legend>
          <div className="form-grid">
            <Field label="Vessel name" span={2}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="MV / MT …" required autoFocus={!op} maxLength={60} />
            </Field>
            <Field label="IMO number" hint="optional">
              <input value={imo} onChange={(e) => setImo(e.target.value)} inputMode="numeric" maxLength={12} />
            </Field>
            <Field label="Vessel type" hint="optional" span={3}>
              <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Bulk carrier, product tanker …" maxLength={40} />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>Delivery</legend>
          <div className="form-grid">
            <Field label="Port">
              <select value={port} onChange={(e) => setPort(e.target.value as PortName)}>
                {PORT_NAMES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Location" span={2}>
              <input value={location} onChange={(e) => setLocation(e.target.value)} list="mlo-locations" placeholder="Outer anchorage, OPL, berth …" maxLength={60} />
              <datalist id="mlo-locations">
                {LOCATIONS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <Field label="Delivered by">
              <select value={mode} onChange={(e) => setMode(e.target.value as DeliveryMode)}>
                <option value="barge">Barge</option>
                <option value="bowser">Bowser</option>
              </select>
            </Field>
            <Field label={mode === 'barge' ? 'Barge name' : 'Bowser details'} hint="optional" span={2}>
              <input value={craftName} onChange={(e) => setCraftName(e.target.value)} maxLength={60} />
            </Field>
          </div>

          <div className="grade-rows">
            <span className="field-label">Grades and nominated quantity</span>
            {grades.map((g, i) => (
              <div className="grade-row" key={i}>
                <input value={g.grade} onChange={(e) => setGrade(i, { grade: e.target.value })} list="mlo-grades" placeholder="Grade" aria-label="Grade" required maxLength={24} />
                <div className="unit-input">
                  <input value={g.nominated} onChange={(e) => setGrade(i, { nominated: e.target.value })} type="number" min="0" step="any" placeholder="0" aria-label="Nominated quantity" required />
                  <span>MT</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setGrades((rows) => rows.filter((_, j) => j !== i))} disabled={grades.length === 1} aria-label="Remove grade">
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <datalist id="mlo-grades">
              {COMMON_GRADES.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            {grades.length < 6 && (
              <button type="button" className="btn ghost small" onClick={() => setGrades((rows) => [...rows, { grade: '', nominated: '' }])}>
                <Icon name="plus" size={14} />
                Add grade
              </button>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Parties</legend>
          <div className="form-grid two">
            {PARTY_FIELDS.map(([key, label]) => (
              <Field label={label} key={key}>
                <input value={parties[key]} onChange={(e) => setParties({ ...parties, [key]: e.target.value })} maxLength={80} />
              </Field>
            ))}
          </div>
        </fieldset>

        {op ? (
          <fieldset>
            <legend>Board</legend>
            <div className="form-grid two">
              <Field label="Estimated completion" hint="local time">
                <input type="datetime-local" value={etc} onChange={(e) => setEtc(e.target.value)} />
              </Field>
              <Field label="Status line" hint="leave empty to follow milestones">
                <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} placeholder="e.g. Awaiting weather window" />
              </Field>
            </div>
          </fieldset>
        ) : (
          <fieldset>
            <legend>First ETA</legend>
            <div className="form-grid two">
              <Field label="ETA" hint="local time, optional">
                <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
              </Field>
              <Field label="Advised by">
                <input value={etaSource} onChange={(e) => setEtaSource(e.target.value)} maxLength={40} />
              </Field>
            </div>
          </fieldset>
        )}
      </div>

      <footer className="dialog-foot">
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {op ? 'Save details' : 'Open operation'}
        </button>
      </footer>
    </form>
  );
}
