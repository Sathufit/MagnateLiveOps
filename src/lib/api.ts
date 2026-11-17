import type { BoardView, LinkStats, Operation, Role } from '../../shared/domain.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'No connection to the server. Check your network and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'The request could not be completed.');
  return data as T;
}

export interface OpDetail {
  op: Operation;
  links: Record<Role, LinkStats>;
}

/** A board view plus the realtime channel that announces changes to it. */
export type LiveView = BoardView & { channel: string };
export interface Staff {
  name: string | null;
  channel: string | null;
}

export type Action = { type: string } & Record<string, unknown>;

export const api = {
  me: () => request<Staff>('GET', '/api/auth/me'),
  login: (name: string, passcode: string) => request<Staff>('POST', '/api/auth/login', { name, passcode }),
  config: () => request<{ realtime: { url: string; key: string } | null }>('GET', '/api/config'),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  ops: () => request<{ ops: Operation[] }>('GET', '/api/ops'),
  op: (id: string) => request<OpDetail>('GET', `/api/ops/${id}`),
  create: (details: Record<string, unknown>) => request<OpDetail>('POST', '/api/ops', details),
  act: (id: string, action: Action) => request<OpDetail>('POST', `/api/ops/${id}/actions`, action),
  remove: (id: string) => request<{ ok: true }>('DELETE', `/api/ops/${id}`),
  /** `version` is the copy already held; the server answers `unchanged` when it is still current. */
  live: (token: string, open: boolean, version?: number) => {
    const query = new URLSearchParams();
    if (open) query.set('open', '1');
    if (version !== undefined) query.set('v', String(version));
    return request<LiveView | { unchanged: true }>('GET', `/api/live/${token}?${query}`);
  },
};
