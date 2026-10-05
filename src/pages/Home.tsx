import { ArrowRight, Clock, FlaskConical, LoaderCircle, Route as RouteIcon, ScrollText, Shuffle, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, message, type WorkspaceData } from '../lib/api';
import { forgetWorkspace, loadRecent, rememberWorkspace } from '../lib/helpers';

const FEATURES = [
  { icon: RouteIcon, title: 'Real paths', text: 'Define endpoints like GET /users/:id and call them from any app, script or browser.' },
  { icon: Shuffle, title: 'Living responses', text: 'Use placeholders for path values, request fields, random ids and timestamps.' },
  { icon: Clock, title: 'Slow and flaky on demand', text: 'Add a delay or a failure rate to see how your app copes with a bad network.' },
  { icon: ScrollText, title: 'Request log', text: 'Watch every call arrive: what was asked, what matched and what was returned.' },
];

export function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(loadRecent);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    setBusy(true);
    setError('');
    try {
      const created = await api<WorkspaceData>('/workspaces', {
        method: 'POST',
        body: { ...(name ? { name } : {}), ...(data.get('sample') ? { template: 'users' } : {}) },
      });
      rememberWorkspace({ id: created.workspace._id, name: created.workspace.name });
      navigate(`/w/${created.workspace._id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start">
      <section>
        <p className="eyebrow">Fake APIs, real requests</p>
        <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Build the frontend before the backend exists.</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Design REST endpoints in your browser and get a live URL that answers with the JSON you choose. No sign-up, nothing to install.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="card p-4">
              <Icon className="size-5 text-accent" aria-hidden />
              <h2 className="mt-2 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-5">
        <form onSubmit={onSubmit} className="card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold"><FlaskConical className="size-5 text-accent" aria-hidden /> Start a workspace</h2>
          <label htmlFor="name" className="label mt-4">Name <span className="font-normal text-muted">(optional)</span></label>
          <input id="name" name="name" maxLength={60} placeholder="Checkout prototype" className="input" />
          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="sample" defaultChecked className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Start with a sample Users API <span className="text-muted">(list, get, create, delete)</span></span>
          </label>
          {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
          <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
            {busy ? 'Creating' : 'Create workspace'}
          </button>
          <p className="mt-3 text-xs text-muted">
            No sign-up: the workspace page's address is the key to editing it, so keep that link to yourself or your team. Workspaces unused for 30 days are deleted.
          </p>
        </form>

        {recent.length > 0 && (
          <div className="card p-5">
            <h2 className="font-bold">Your recent workspaces</h2>
            <p className="text-xs text-muted">Remembered in this browser only.</p>
            <ul className="mt-3 divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <Link to={`/w/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">{r.name}</Link>
                  <button
                    type="button" aria-label={`Remove ${r.name} from this list`} className="grid size-7 place-items-center rounded text-muted hover:text-bad"
                    onClick={() => { forgetWorkspace(r.id); setRecent(loadRecent()); }}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
