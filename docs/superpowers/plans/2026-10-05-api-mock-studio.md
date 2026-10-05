# API Mock Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a tool to design fake REST endpoints in the browser and call them from anywhere.

**Architecture:** One package. Vite React client in `src/`, Express server in `server/` exposed through `api/index.ts` on Vercel, serving both the management API (`/api`) and the mocks (`/m/:workspaceId/*`). MongoDB for storage.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, React Router; Express 4, Mongoose, Zod, express-rate-limit; Vitest, Supertest, mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-10-05-api-mock-studio-design.md`

## Global Constraints

- Node 20 or newer, TypeScript strict, ES modules (`.js` import specifiers on the server).
- Error shape `{ error: { code, message, details? } }`.
- Mock responses are always `application/json` with `X-Content-Type-Options: nosniff`.
- Limits: 20 endpoints per workspace, body 20 KB, delay 5000 ms, 50 log entries per workspace.
- No secrets in the repository. No em-dashes in copy or docs. Commits as pratikbankar88@gmail.com.

## Review Focus

1. A stored body that is not valid JSON, or a template whose substitution would break JSON (quotes, newlines in a parameter): rejected at save, and output is always valid JSON.
2. Two endpoints that both match a request (`/users/:id` and `/users/me`): the literal one wins every time, regardless of creation order.
3. Path parameters or query values containing encoded characters (`%2F`, `%20`, malformed `%`): no crash, value decoded or passed through.
4. A mock call to an unknown workspace, an unmatched path, or with a huge or malformed request body: a JSON error, never an HTML page or a 500.
5. Two saves racing to create the same method and path: one endpoint, a readable error for the other, no 500.

---

### Task 1: Core rules
**Files:** `server/lib/{paths,template}.ts`, `tests/server/rules.test.ts`.
**Produces:** `validatePattern(p): string` (throws AppError 400); `matchPath(pattern, path): Record<string,string> | null`; `pickEndpoint<T extends { method; path }>(list, method, path): { endpoint: T; params } | null`; `validateBody(text): string`; `renderTemplate(bodyText, ctx): unknown`.
- [ ] Failing tests for every rule in the spec and Review Focus 1 to 3. Implement. Commit.

### Task 2: API and mock serving
**Files:** `server/{app,models,db,dev,templates}.ts`, `api/index.ts`, `tests/server/api.test.ts`.
**Produces:** endpoints in the spec; `createApp({ random, sleep })`.
- [ ] Failing tests: workspace create and read, endpoint CRUD and limits, duplicate race (Review Focus 5), mock serving (params, query, body, templating, delay, failure injection, CORS and preflight, 404s, JSON only: Review Focus 4), request log cap, rate limits. Implement. Commit.

### Task 3: Client
**Files:** `src/**`, `index.html`, `tests/client/helpers.test.ts`.
- [ ] Failing tests for snippet builders and JSON helpers. Implement helpers, pages and components. Typecheck, lint, build. Check in a browser at phone and desktop widths. Commit.

### Task 4: Docs and deployment
- [ ] README with screenshots, `vercel.json`, `.env.example`. Deploy, verify live, commit.
