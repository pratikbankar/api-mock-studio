import { Braces, Moon, Sun } from 'lucide-react';
import { Link, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { WorkspacePage } from './pages/WorkspacePage';

function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    // Private browsing: the choice just will not be remembered.
  }
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-bg"><Braces className="size-[18px]" aria-hidden /></span>
            API Mock Studio
          </Link>
          <div className="flex items-center gap-2">
            <a href="https://github.com/pratikbankar/api-mock-studio" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Source</a>
            <button type="button" onClick={toggleTheme} aria-label="Switch between light and dark theme" className="btn btn-ghost !px-2.5">
              <Sun className="hidden size-4 dark:block" aria-hidden />
              <Moon className="size-4 dark:hidden" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/w/:id" element={<WorkspacePage />} />
          <Route
            path="*"
            element={
              <div className="py-20 text-center">
                <p className="eyebrow">404</p>
                <h1 className="mt-2 text-3xl font-bold">Page not found</h1>
                <Link to="/" className="btn btn-primary mt-6">Back to the start</Link>
              </div>
            }
          />
        </Routes>
      </main>

      <footer className="border-t border-line py-5 text-center text-sm text-muted">
        Built by <a href="https://pratik-bankar-portfolio.vercel.app" rel="noreferrer" className="underline hover:text-accent">Pratik Bankar</a>. Mock responses are for testing only.
      </footer>
    </div>
  );
}
