# API Mock Studio: Design

Date: 2026-10-05. Owner: Pratik Bankar. Approved in conversation.

## Goal

A developer tool for a GitHub profile: define fake REST endpoints in the browser and call them
from any app. Built with React and Node.js, hosted free, no sign-up.

## Architecture

One repository, one Vercel project. React + TypeScript client (Vite, Tailwind) in `src/`;
Express + TypeScript server in `server/` exposed as one Vercel function (`api/index.ts`);
MongoDB (database `mocks`).

Two URL spaces on the server:

- `/api/...` manages workspaces and endpoints (used by the client).
- `/m/:mockId/...` serves the mocks to anyone, with CORS open.

## Data

- `Workspace`: `_id` is a random 22 character secret edit id; `mockId` is a separate public id
  used in mock URLs; name, endpointCount, createdAt, lastUsedAt. Deleted automatically 30 days after last use.
- `Endpoint`: workspaceId, method (GET, POST, PUT, PATCH, DELETE), path pattern, status,
  body (JSON text, at most 20 KB), delayMs (0 to 5000), errorRate (0 to 100), order.
  Unique per workspace, method and path. At most 20 per workspace.
- `RequestLog`: workspaceId, at, method, path, endpointId or null, status, durationMs.
  Only the latest 50 per workspace are kept.

## Rules

- Path patterns start with `/`, have at most 10 segments, and each segment is either literal
  (letters, digits, `.`, `_`, `~`, `-`) or a parameter `:name`. A trailing slash is ignored.
- Matching: method must match; segments match literally or bind a parameter. When several
  endpoints match, the one with more literal segments wins.
- Templating: the stored body is JSON. Placeholders are `{{params.x}}`, `{{query.x}}`,
  `{{body.x}}`, `{{uuid}}`, `{{now}}`, `{{timestamp}}`, `{{randomInt min max}}`. A string that is
  exactly one placeholder is replaced by the value with its type (a number stays a number);
  otherwise placeholders are interpolated into the string. Output is always valid JSON.
  Unknown placeholders are left as written.
- Failure injection: with probability errorRate percent the endpoint answers 500 with a JSON
  error instead of its configured response.
- Mock responses are always `application/json` with `nosniff`, so the service cannot host pages.
- A request that matches nothing gets 404 JSON listing the available endpoints.

## API

- `POST /api/workspaces { name?, template? }`, `GET /api/workspaces/:id`
- `POST /api/workspaces/:id/endpoints`, `PUT` and `DELETE /api/workspaces/:id/endpoints/:eid`
- `POST /api/workspaces/:id/templates/:name` (adds a starter set, for example `users`)
- `GET` and `DELETE /api/workspaces/:id/logs`
- Errors: `{ error: { code, message, details? } }`.

Limits: 10 new workspaces per visitor per hour; 120 mock calls per visitor per minute.

## Client

- Home: what it is, a "Create workspace" button with an optional starter template, and the
  visitor's recent workspaces (remembered in the browser).
- Workspace: endpoint list, endpoint editor with JSON validation and formatting, a "Try it"
  panel that calls the mock and shows the response, copy-ready curl and fetch snippets, and a
  request log that refreshes while the tab is visible.
- Clear notice that anyone with the workspace link can edit it.

## Testing

Vitest. Server: path validation and matching, endpoint choice, templating, and the API and
mock serving against an in-memory MongoDB with injected randomness and sleep. Client: snippet
and JSON helpers.

## Out of scope

Accounts, non-JSON responses, custom response headers, stateful mocks, OpenAPI import.
