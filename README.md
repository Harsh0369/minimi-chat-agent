# minimi chat agent

Harsh Agarwal's local implementation of the minimi Software Engineering Intern challenge.

**Current stage: Module 1 — application foundation.** The application serves a React preview and a validated Express API. Chat, memory, SQLite persistence, web search, model calls, and live evaluations are not implemented yet. No fake conversations or mock answers are presented as real functionality.

- [Build plan](docs/BUILD_PLAN.md): module boundaries, dependencies and acceptance gates.
- [Minimi alignment](docs/MINIMI_ALIGNMENT.md): final company/challenge check, sources and limitations.
- [DESIGN.md](DESIGN.md): concise target architecture; later modules remain proposals.
- [Architecture review](docs/ARCHITECTURE.md): detailed decisions and evaluation gates.

## Run locally

Use Node **24.14.1** (also recorded in `.nvmrc` and `.node-version`). From the repository root:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. No global tools, API keys, database server or Docker installation are needed for the foundation preview. The chat composer is intentionally disabled until the agent modules are connected.

Copy `.env.example` to `.env` for optional configuration. `PORT` changes the port; `HOST` accepts only `127.0.0.1` or `::1`. For IPv6, use `http://[::1]:3000`. Invalid settings fail startup with field names rather than secret values. The `.env` file is ignored by Git.

Future live chat requires `OPENAI_API_KEY`, `TAVILY_API_KEY` and `CHAT_MODEL`. Keys remain server-side. No provider requests are made in Module 1. Model choice and measured quality remain pending; merely supplying keys does not enable chat.

## Verify

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser installation is only needed for developer tests, not app startup. `npm run check` runs types, lint, formatting, and unit/integration tests. Playwright exercises the running development service using a separate port and blank provider credentials. `npm start` serves the built application locally after `npm run build`.

To run the same browser tests against the production build in PowerShell, set `$env:PLAYWRIGHT_SERVER_MODE='production'` and run `npm run test:e2e`. Clear that variable before returning to development browser tests.

`GET /api/health` checks the HTTP process, not providers or databases. `GET /api/status` reports implemented capabilities separately from configuration availability. Unknown API paths return a structured JSON error. Operational logs contain request IDs, status, method and duration, not bodies, query strings, credentials or private error messages.

## Development boundaries

- `src/shared` contains browser-safe schemas; it must never import server configuration.
- `src/server` owns Express routes, configuration, HTTP lifecycle and security. Express starts with `app.listen`; Vite attaches to its development server for browser refresh. Future modules own persistence, retrieval, providers and orchestration behind explicit interfaces.
- `src/client/App.tsx` composes the page. `src/client/components` owns display sections, and `src/client/hooks` owns status fetching and retry. The hook validates API responses against the shared contract.
- Local developer MCPs and Graft are not application dependencies or runtime tools.
- Supported use is one local process. Public hosting/authentication is outside this foundation.
- Stop after each module for review. No remote repository or publication has been configured.

Application form supplied by the user: https://binary.so/YIrD8L5
