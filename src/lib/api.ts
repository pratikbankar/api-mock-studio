import type { Method } from './helpers';

export interface Workspace {
  _id: string;
  name: string;
  createdAt: string;
}

export interface Endpoint {
  _id: string;
  workspaceId: string;
  method: Method;
  path: string;
  status: number;
  body: string;
  delayMs: number;
  errorRate: number;
}

export interface WorkspaceData {
  workspace: Workspace;
  endpoints: Endpoint[];
}

export interface LogEntry {
  _id: string;
  at: string;
  method: string;
  path: string;
  endpointId: string | null;
  status: number;
  durationMs: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const error = data?.error as { code?: string; message?: string } | undefined;
  throw new ApiError(res.status, error?.code ?? 'error', error?.message ?? `Something went wrong (${res.status}). Please try again.`);
}

export const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
