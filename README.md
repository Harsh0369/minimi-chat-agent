# minimi chat agent

Harsh Agarwal's local implementation of the minimi Software Engineering Intern challenge.

**Current stage: Module 2 — persistent conversations and browser sessions.** The app serves a React preview and an Express API backed by SQLite. The browser establishes an opaque session and can resume it after a restart. Conversation and turn storage is available through the API. The chat composer remains disabled until the agent and conversation UI are connected; no fake answers are shown.

- [Build plan](docs/BUILD_PLAN.md): module boundaries, dependencies and acceptance gates.
- [UI design](docs/UI_DESIGN.md): Tailwind tokens, component responsibilities, accessibility, and responsive layout.
- [Minimi alignment](docs/MINIMI_ALIGNMENT.md): final company/challenge check, sources and limitations.
- [DESIGN.md](DESIGN.md): concise target architecture; later modules remain proposals.
- [Architecture review](docs/ARCHITECTURE.md): detailed decisions and evaluation gates.
- [Access design](docs/ACCESS_DESIGN.md): local session behavior, ownership rules, and public-hosting requirements.
- [Analysis review](docs/ANALYSIS_REVIEW.md): comparison with the two supplied architecture and free-tier proposals.

## Run locally

Use Node **24.14.1** (also recorded in `.nvmrc` and `.node-version`). From the repository root:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. SQLite is initialized at `./data/minimi.sqlite` on startup; no separate database service, API key, or Docker installation is needed. The chat composer is intentionally disabled until the agent modules are connected.

Copy `.env.example` to `.env` for optional configuration. `PORT` changes the port; `HOST` accepts only `127.0.0.1` or `::1`. For IPv6, use `http://[::1]:3000`. Invalid settings fail startup with field names rather than secret values. The `.env` file is ignored by Git.

The current status contract still lists `OPENAI_API_KEY`, `TAVILY_API_KEY` and `CHAT_MODEL` as future settings. No provider requests are made in Modules 1–2. Provider choice remains open to evaluation, including eligible free-tier models and their privacy terms; supplying keys does not enable chat today.

## Verify

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser installation is only needed for developer tests, not app startup. `npm run check` runs types, lint, formatting, and unit/integration tests. Playwright exercises the running development service using a separate port and blank provider credentials. `npm start` serves the built application locally after `npm run build`.

To run the same browser tests against the production build in PowerShell, set `$env:PLAYWRIGHT_SERVER_MODE='production'` and run `npm run test:e2e`. Clear that variable before returning to development browser tests.

`GET /api/health` checks that the HTTP process and database worker are available, not model or search providers. `GET /api/status` reports implemented capabilities separately from provider configuration. Unknown API paths return a structured JSON error. Operational logs contain request IDs, status, method and duration, not bodies, query strings, credentials or private error messages.

The browser calls `POST /api/session` on load. The server issues a random HttpOnly, SameSite cookie and stores only its hash. An invalid or expired cookie requires an explicit **Start new workspace** action; old history is not silently attached to a new owner. The API supports session resume/revocation, owned conversation creation/listing/detail/deletion, paged messages, turn inspection/cancellation, and deleting the current owner's history. `POST /api/conversations/:id/messages` returns `AGENT_NOT_READY` until live agent execution exists. See [the Module 2 API contract](docs/MODULE_2.md).

## Development boundaries

- `src/shared` contains browser-safe schemas; it must never import server configuration.
- `src/server` owns Express routes, configuration, HTTP lifecycle and security. SQLite runs in one worker behind a typed command port; HTTP routes cannot execute SQL directly. Express starts with `app.listen`; Vite attaches to its development server for browser refresh. Later modules add retrieval, providers and orchestration behind explicit interfaces.
- `src/client/App.tsx` composes the page. `src/client/components` owns display sections, and `src/client/hooks` owns status fetching and retry. The hook validates API responses against the shared contract.
- Local developer MCPs and Graft are not application dependencies or runtime tools.
- Supported use is one local process. Browser sessions identify a workspace, not a verified person. Public hosting requires a separate sign-in and spending-control design.
- Stop after each module for review. The Module 1 code was pushed to a private GitHub repository; local Module 2 work stays available for review before a later push.

Application form supplied by the user: https://binary.so/YIrD8L5
