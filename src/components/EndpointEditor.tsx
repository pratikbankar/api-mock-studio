import { LoaderCircle, Trash2, WandSparkles } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, type Endpoint, message } from '../lib/api';
import { formatJson, jsonProblem, METHODS, type Method, PLACEHOLDERS } from '../lib/helpers';

interface Props {
  workspaceId: string;
  /** The endpoint being edited, or null for a new one. */
  endpoint: Endpoint | null;
  onSaved: (endpoint: Endpoint) => void;
  onDeleted: (id: string) => void;
  onCancel: () => void;
}

const DEFAULT_BODY = '{\n  "message": "Hello from your mock"\n}';

export function EndpointEditor({ workspaceId, endpoint, onSaved, onDeleted, onCancel }: Props) {
  const [method, setMethod] = useState<Method>(endpoint?.method ?? 'GET');
  const [path, setPath] = useState(endpoint?.path ?? '/');
  const [status, setStatus] = useState(String(endpoint?.status ?? 200));
  const [body, setBody] = useState(endpoint?.body ?? DEFAULT_BODY);
  const [delayMs, setDelayMs] = useState(String(endpoint?.delayMs ?? 0));
  const [errorRate, setErrorRate] = useState(endpoint?.errorRate ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const bodyProblem = jsonProblem(body);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (bodyProblem) {
      setError('Fix the response body before saving.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { method, path, status: Number(status), body, delayMs: Number(delayMs) || 0, errorRate };
      const saved = endpoint
        ? await api<Endpoint>(`/workspaces/${workspaceId}/endpoints/${endpoint._id}`, { method: 'PUT', body: payload })
        : await api<Endpoint>(`/workspaces/${workspaceId}/endpoints`, { method: 'POST', body: payload });
      onSaved(saved);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!endpoint) return;
    setBusy(true);
    try {
      await api(`/workspaces/${workspaceId}/endpoints/${endpoint._id}`, { method: 'DELETE' });
      onDeleted(endpoint._id);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="card p-5">
      <h2 className="text-lg font-bold">{endpoint ? 'Edit endpoint' : 'New endpoint'}</h2>

      <div className="mt-4 grid grid-cols-[7rem_1fr] gap-3 sm:grid-cols-[7rem_1fr_6rem]">
        <div>
          <label htmlFor="ep-method" className="label">Method</label>
          <select id="ep-method" className="input code" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ep-path" className="label">Path</label>
          <input id="ep-path" className="input code" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/users/:id" spellCheck={false} autoCapitalize="off" aria-describedby="ep-path-help" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="ep-status" className="label">Status</label>
          <input id="ep-status" className="input code" type="number" min={200} max={599} value={status} onChange={(e) => setStatus(e.target.value)} />
        </div>
      </div>
      <p id="ep-path-help" className="mt-1.5 text-xs text-muted">Use <code className="code">:name</code> for a part that changes, such as <code className="code">/users/:id</code>.</p>

      <div className="mt-4 flex items-end justify-between gap-2">
        <label htmlFor="ep-body" className="label !mb-0">Response body (JSON)</label>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline" onClick={() => setBody(formatJson(body))}>
          <WandSparkles className="size-3.5" aria-hidden /> Format
        </button>
      </div>
      <textarea
        id="ep-body" className="input code mt-1.5 min-h-52 resize-y leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)}
        spellCheck={false} aria-invalid={bodyProblem ? true : undefined} aria-describedby="ep-body-note"
      />
      <p id="ep-body-note" className={`mt-1 text-xs ${bodyProblem ? 'text-bad' : 'text-muted'}`} role={bodyProblem ? 'alert' : undefined}>
        {bodyProblem ?? 'Placeholders are filled in on every request. Tap one to add it:'}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {PLACEHOLDERS.map((p) => (
          <li key={p.token}>
            <button type="button" title={p.hint} aria-label={`Insert ${p.token}: ${p.hint}`} className="code rounded-md border border-line bg-raised px-2 py-1 text-xs hover:border-accent" onClick={() => setBody((b) => `${b}${p.token}`)}>
              {p.token}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ep-delay" className="label">Delay <span className="font-normal text-muted">(ms, up to 5000)</span></label>
          <input id="ep-delay" className="input code" type="number" min={0} max={5000} step={50} value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ep-fail" className="label">Failure rate <span className="code font-normal text-muted">{errorRate}%</span></label>
          <input id="ep-fail" type="range" min={0} max={100} step={5} value={errorRate} onChange={(e) => setErrorRate(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
          <p className="text-xs text-muted">That share of calls answers 500 instead.</p>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />} {endpoint ? 'Save changes' : 'Create endpoint'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        {endpoint && (confirming ? (
          <span className="ml-auto flex items-center gap-2 text-sm">
            Delete this endpoint?
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>Delete</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="btn btn-danger ml-auto" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden /> Delete
          </button>
        ))}
      </div>
    </form>
  );
}
