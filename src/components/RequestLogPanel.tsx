import { useCallback, useEffect, useState } from 'react';
import { api, type LogEntry } from '../lib/api';

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Recent calls to this workspace's mocks. Refreshes while the tab is visible, and when `refreshKey` changes. */
export function RequestLogPanel({ workspaceId, refreshKey }: { workspaceId: string; refreshKey: number }) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setLogs(await api<LogEntry[]>(`/workspaces/${workspaceId}/logs`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void load();
      timer = setInterval(() => void load(), 4000);
    };
    const stop = () => clearInterval(timer);
    // No point polling a tab nobody is looking at.
    const onVisibility = () => (document.hidden ? stop() : (stop(), start()));
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, refreshKey]);

  async function clear() {
    try {
      await api(`/workspaces/${workspaceId}/logs`, { method: 'DELETE' });
      setLogs([]);
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="log-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="log-title" className="text-lg font-bold">Request log</h2>
        {logs && logs.length > 0 && <button type="button" className="btn btn-ghost !py-1.5 text-xs" onClick={clear}>Clear</button>}
      </div>
      <p className="text-xs text-muted">The latest 50 calls to this workspace, from anywhere. Updates every few seconds.</p>
      {failed && <p role="alert" className="mt-3 text-sm text-bad">The log could not be loaded. It will retry shortly.</p>}

      {logs === null && !failed ? (
        <p className="mt-4 text-sm text-muted" role="status">Loading</p>
      ) : logs && logs.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No calls yet. Press Send above, or call the URL from your own app.</p>
      ) : (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {logs?.map((log) => (
                <tr key={log._id} className="border-b border-line/70 last:border-0">
                  <td className="code whitespace-nowrap py-1.5 pr-3 text-xs text-muted">{time(log.at)}</td>
                  <td className={`method method-${log.method} py-1.5 pr-3`}>{log.method}</td>
                  <td className="code max-w-0 w-full truncate py-1.5 pr-3" title={log.path}>{log.path}</td>
                  <td className={`code whitespace-nowrap py-1.5 pr-3 ${log.status < 400 ? 'text-good' : 'text-bad'}`}>
                    {log.status}{log.endpointId ? '' : <span className="ml-1 text-xs text-muted">no match</span>}
                  </td>
                  <td className="code whitespace-nowrap py-1.5 text-right text-xs text-muted">{log.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
