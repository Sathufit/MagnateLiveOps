import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * Subscribes to a server-sent event stream. `onMessage` is also called when the
 * connection is re-established or the tab becomes visible again, since updates
 * may have been missed in between.
 */
export function useStream(url: string | null, onMessage: (data: unknown) => void): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!url) return;
    let dropped = false;
    const source = new EventSource(url);
    source.onopen = () => {
      setState('live');
      if (dropped) handler.current(null);
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
      setState('reconnecting');
    };
    source.onmessage = (e) => {
      try {
        handler.current(JSON.parse(e.data));
      } catch {
        handler.current(null);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') handler.current(null);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      source.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);

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
