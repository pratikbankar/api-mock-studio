import { Check, Copy, LoaderCircle, Play } from 'lucide-react';
import { useState } from 'react';
import type { Endpoint } from '../lib/api';
import { curlSnippet, examplePath, fetchSnippet, jsonProblem } from '../lib/helpers';

interface Result {
  status: number;
  ms: number;
  text: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked: the text stays selectable.
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Calls the selected mock from the browser and shows ready-made snippets for it. */
export function TryIt({ baseUrl, endpoint, onCalled }: { baseUrl: string; endpoint: Endpoint; onCalled: () => void }) {
  const takesBody = endpoint.method !== 'GET' && endpoint.method !== 'DELETE';
  const [path, setPath] = useState(examplePath(endpoint.path));
  const [body, setBody] = useState(takesBody ? '{\n  "name": "Asha",\n  "email": "asha@example.com"\n}' : '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'curl' | 'fetch'>('curl');

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const snippetInput = { method: endpoint.method, url, body: takesBody ? body : undefined };
  const snippet = tab === 'curl' ? curlSnippet(snippetInput) : fetchSnippet(snippetInput);
  const bodyProblem = takesBody ? jsonProblem(body) : null;

  async function send() {
    setBusy(true);
    setError('');
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: endpoint.method,
        headers: takesBody && body.trim() ? { 'Content-Type': 'application/json' } : {},
        body: takesBody && body.trim() ? body : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON (should not happen for a mock): show it as received.
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), text: pretty });
      onCalled();
    } catch {
      setError('The request could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="try-title">
      <h2 id="try-title" className="text-lg font-bold">Try it</h2>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="try-path" className="label">Request path</label>
          <div className="flex items-center gap-2">
            <span className={`method method-${endpoint.method} shrink-0`}>{endpoint.method}</span>
            <input id="try-path" className="input code" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} autoCapitalize="off" />
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />} Send
        </button>
      </div>

      {takesBody && (
        <div className="mt-3">
          <label htmlFor="try-body" className="label">Request body <span className="font-normal text-muted">(used by {'{{body.…}}'} placeholders)</span></label>
          <textarea id="try-body" className="input code min-h-24 resize-y" value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} aria-invalid={bodyProblem ? true : undefined} />
          {bodyProblem && <p className="mt-1 text-xs text-warn">{bodyProblem}. It will be sent as written.</p>}
        </div>
      )}

      <div role="status" aria-live="polite" className="mt-4">
        {error && <p className="text-sm text-bad">{error}</p>}
        {result && (
          <>
            <p className="code text-sm">
              <span className={result.status < 400 ? 'text-good' : 'text-bad'}>{result.status}</span>
              <span className="text-muted"> · {result.ms} ms</span>
            </p>
            <pre className="code mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-bg p-3 leading-relaxed">{result.text || '(empty response)'}</pre>
          </>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <div role="group" aria-label="Snippet language" className="flex rounded-lg border border-line p-0.5">
            {(['curl', 'fetch'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className="code rounded-md px-2.5 py-1 text-xs text-muted aria-pressed:bg-raised aria-pressed:text-ink">
                {t}
              </button>
            ))}
          </div>
          <CopyButton text={snippet} />
        </div>
        <pre className="code mt-2 overflow-x-auto rounded-lg border border-line bg-bg p-3 leading-relaxed">{snippet}</pre>
      </div>
    </section>
  );
}
