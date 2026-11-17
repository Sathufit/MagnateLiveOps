import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

/** Current time, re-rendering on an interval so countdowns stay honest. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type StreamState = 'connecting' | 'live' | 'reconnecting';

// How often an open page re-checks the server. With Supabase Realtime connected,
// changes are pushed and the timer is only a safety net.
const LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const CHECK_MS = LOCAL ? 3_000 : 8_000;
const CHECK_WITH_PUSH_MS = 20_000;

type Realtime = import('@supabase/supabase-js').SupabaseClient;
let realtime: Promise<Realtime | null> | undefined;

/** The Supabase client, loaded only when the server says Realtime is configured. */
function getRealtime(): Promise<Realtime | null> {
  realtime ??= api
    .config()
    .then(async ({ realtime: cfg }) => {
      if (!cfg) return null;
      const { createClient } = await import('@supabase/supabase-js');
      return createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
    })
    .catch(() => null);
  return realtime;
}

/**
 * Keeps a page current. `check(initial)` fetches the latest state and resolves
 * to whether the server was reachable. It runs once at start, then on a timer
 * while the tab is visible, when the tab is shown again, and immediately when
 * a change is announced on `channel`.
 */
export function useLiveSync(check: (initial: boolean) => Promise<boolean>, channel: string | null | undefined, enabled = true): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const fn = useRef(check);
  fn.current = check;
  const pushed = useRef(false);
  const run = useRef<(initial?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;
    let timer: number | undefined;

    let again = false;
    run.current = async (initial = false) => {
      if (stopped) return;
      if (busy) {
        // A change was announced while a check was in flight; that check may
        // have read the older copy, so look once more when it returns.
        again = true;
        return;
      }
      busy = true;
      const ok = await fn.current(initial).catch(() => false);
      busy = false;
      if (stopped) return;
      setState(ok ? 'live' : 'reconnecting');
      if (again) {
        again = false;
        void run.current();
      }
    };
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await run.current();
        if (!stopped) schedule();
      }, pushed.current ? CHECK_WITH_PUSH_MS : CHECK_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run.current();
    };

    void run.current(true);
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !channel) return;
    let cancelled = false;
    let leave = () => undefined as void;
    void getRealtime().then((client) => {
      if (!client || cancelled) return;
      const subscription = client
        .channel(channel)
        .on('broadcast', { event: 'changed' }, () => void run.current())
        .subscribe((status) => {
          pushed.current = status === 'SUBSCRIBED';
        });
      leave = () => {
        pushed.current = false;
        void client.removeChannel(subscription);
      };
    });
    return () => {
      cancelled = true;
      leave();
    };
  }, [channel, enabled]);

  return state;
}

export type Theme = 'light' | 'dark';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const set = document.documentElement.dataset.theme;
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('mlo-theme', next);
      } catch {
        /* private mode: the choice simply lasts for this visit */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

/** Measures an element's width so SVG charts can lay out in real pixels. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Copies text and reports which key was copied for a moment, for "Copied" feedback. */
export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const copy = useCallback((key: string, value: string) => {
    const done = () => {
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done, () => undefined);
    } else {
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    }
  }, []);
  return [copied, copy];
}

export function fmtAgo(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}
