import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTheme } from '../lib/hooks.ts';
import type { StreamState } from '../lib/hooks.ts';

const ICONS = {
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  open: 'M14 5h5v5M19 5l-8 8M11 6H5v13h13v-6',
  rotate: 'M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  send: 'M4 12l16-8-6 16-3-7z',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark" aria-label="Magnate LiveOps">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 23V9l10 8 10-8v14" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="16" cy="25" r="2.1" className="wordmark-dot" />
      </svg>
      {!compact && (
        <span className="wordmark-text">
          <b>Magnate</b>
          <span>LiveOps</span>
        </span>
      )}
    </span>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="icon-btn on-dark" onClick={toggle} title={label} aria-label={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

export function LiveBadge({ state }: { state: StreamState }) {
  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className={`live-badge ${state}`} role="status">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

export function Panel({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {aside && <div className="panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function Field({ label, hint, children, span }: { label: string; hint?: string; children: ReactNode; span?: 2 | 3 }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function FullMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="full-message">
      <Wordmark />
      <h1>{title}</h1>
      {children}
      <p className="full-message-foot">Magnate Shipping Agency (Pvt) Ltd · Colombo · Galle · Hambantota · Trincomalee</p>
    </div>
  );
}
