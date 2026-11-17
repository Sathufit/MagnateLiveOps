import type { BoardView, Operation, Role } from '../../shared/domain.ts';

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
  watching: Record<Role, number>;
}

export type Action = { type: string } & Record<string, unknown>;

export const api = {
  me: () => request<{ name: string | null }>('GET', '/api/auth/me'),
  login: (name: string, passcode: string) => request<{ name: string }>('POST', '/api/auth/login', { name, passcode }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  ops: () => request<{ ops: Operation[] }>('GET', '/api/ops'),
  op: (id: string) => request<OpDetail>('GET', `/api/ops/${id}`),
  create: (details: Record<string, unknown>) => request<OpDetail>('POST', '/api/ops', details),
  act: (id: string, action: Action) => request<OpDetail>('POST', `/api/ops/${id}/actions`, action),
  remove: (id: string) => request<{ ok: true }>('DELETE', `/api/ops/${id}`),
  live: (token: string, open: boolean) => request<BoardView>('GET', `/api/live/${token}${open ? '?open=1' : ''}`),
};
