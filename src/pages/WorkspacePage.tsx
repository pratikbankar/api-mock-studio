import { Check, Copy, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EndpointEditor } from '../components/EndpointEditor';
import { RequestLogPanel } from '../components/RequestLogPanel';
import { TryIt } from '../components/TryIt';
import { api, ApiError, type Endpoint, message, type WorkspaceData } from '../lib/api';
import { forgetWorkspace, rememberWorkspace } from '../lib/helpers';

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; id: string };

export function WorkspacePage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [logKey, setLogKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const baseUrl = `${window.location.origin}/m/${id}`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const loaded = await api<WorkspaceData>(`/workspaces/${id}`);
      setData(loaded);
      rememberWorkspace({ id: loaded.workspace._id, name: loaded.workspace.name });
      setSelection((s) => (s.kind === 'none' && loaded.endpoints[0] ? { kind: 'edit', id: loaded.endpoints[0]._id } : s));
    } catch (err) {
      const missing = err instanceof ApiError && err.status === 404;
      if (missing) forgetWorkspace(id);
      setLoadError({ text: missing ? 'This workspace does not exist. It may have expired after 30 days without use.' : message(err), missing });
    }
  }, [id]);

  useEffect(() => {
    // Deferred a tick so loading starts after this render, not in the middle of it.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (loadError) {
    return (
      <div className="card p-8 text-center" role="alert">
        <p className={loadError.missing ? '' : 'text-bad'}>{loadError.text}</p>
        <div className="mt-4 flex justify-center gap-3">
          {!loadError.missing && <button type="button" className="btn btn-ghost" onClick={load}>Try again</button>}
          <Link to="/" className="btn btn-primary">Start a new workspace</Link>
        </div>
      </div>
    );
  }
  if (!data) return <p className="py-16 text-center text-muted" role="status">Loading workspace</p>;

  const { workspace, endpoints } = data;
  const selected = selection.kind === 'edit' ? endpoints.find((e) => e._id === selection.id) ?? null : null;

  const onSaved = (saved: Endpoint) => {
    setData((d) => d && { ...d, endpoints: d.endpoints.some((e) => e._id === saved._id) ? d.endpoints.map((e) => (e._id === saved._id ? saved : e)) : [...d.endpoints, saved] });
    setSelection({ kind: 'edit', id: saved._id });
    setNotice('Saved. The mock answers with the new settings straight away.');
  };
  const onDeleted = (removedId: string) => {
    setData((d) => d && { ...d, endpoints: d.endpoints.filter((e) => e._id !== removedId) });
    setSelection({ kind: 'none' });
    setNotice('Endpoint deleted.');
  };

  async function addSample() {
    try {
      setData(await api<WorkspaceData>(`/workspaces/${id}/templates/users`, { method: 'POST' }));
      setNotice('Sample Users API added.');
    } catch (err) {
      setNotice(message(err));
    }
  }

  async function copyBase() {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the address stays selectable.
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{workspace.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Base URL</span>
          <code className="code min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 sm:flex-none">{baseUrl}</code>
          <button type="button" className="btn btn-ghost" onClick={copyBase}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          Anyone with this page's link can edit this workspace, and anyone with the base URL can call it. Do not put real data in mock responses.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
        <nav aria-label="Endpoints" className="card p-3">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="font-bold">Endpoints <span className="font-normal text-muted">{endpoints.length}/20</span></h2>
            <button type="button" className="btn btn-primary !px-2.5 !py-1.5 text-xs" onClick={() => { setSelection({ kind: 'new' }); setNotice(''); }}>
              <Plus className="size-3.5" aria-hidden /> New
            </button>
          </div>
          {endpoints.length === 0 ? (
            <div className="px-2 py-4 text-sm text-muted">
              <p>No endpoints yet. Create one, or start from a sample.</p>
              <button type="button" className="btn btn-ghost mt-3 w-full" onClick={addSample}><Sparkles className="size-4" aria-hidden /> Add sample Users API</button>
            </div>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {endpoints.map((e) => (
                <li key={e._id}>
                  <button
                    type="button" aria-current={selected?._id === e._id ? 'true' : undefined}
                    onClick={() => { setSelection({ kind: 'edit', id: e._id }); setNotice(''); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-raised aria-[current=true]:bg-raised"
                  >
                    <span className={`method method-${e.method} w-12 shrink-0`}>{e.method}</span>
                    <span className="code min-w-0 flex-1 truncate">{e.path}</span>
                    <span className="code shrink-0 text-xs text-muted">{e.status}</span>
                  </button>
                  {(e.delayMs > 0 || e.errorRate > 0) && (
                    <p className="px-2 pb-1 pl-16 text-xs text-muted">
                      {[e.delayMs > 0 && `${e.delayMs} ms delay`, e.errorRate > 0 && `fails ${e.errorRate}%`].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="min-w-0 space-y-6">
          <p role="status" aria-live="polite" className={`text-sm text-good ${notice ? '' : 'sr-only'}`}>{notice}</p>
          {selection.kind === 'none' ? (
            <div className="card p-8 text-center text-muted">Select an endpoint to edit and try it, or create a new one.</div>
          ) : (
            // Keyed so switching endpoints resets the form to that endpoint's values.
            <EndpointEditor
              key={selected?._id ?? 'new'} workspaceId={id} endpoint={selected}
              onSaved={onSaved} onDeleted={onDeleted} onCancel={() => setSelection(endpoints[0] ? { kind: 'edit', id: endpoints[0]._id } : { kind: 'none' })}
            />
          )}
          {selected && <TryIt key={`${selected._id}:${selected.method}:${selected.path}`} baseUrl={baseUrl} endpoint={selected} onCalled={() => setLogKey((k) => k + 1)} />}
          <RequestLogPanel workspaceId={id} refreshKey={logKey} />
        </div>
      </div>
    </div>
  );
}
