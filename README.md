# Thread — minimi chat agent challenge

A local, time-aware chat agent with one external tool: `web_search`. It can use earlier conversations, look up current information, and cite web results. Built in TypeScript for Node 24, with Express, React, SQLite, Gemini, and Tavily.

## Start

Use Node **24.14.1**. From this directory:

```sh
npm install
cp .env.example .env
# Add GEMINI_API_KEY and TAVILY_API_KEY to .env
npm run dev
```

Open http://127.0.0.1:3000. On Windows PowerShell, copy the file with `Copy-Item .env.example .env`. An optional `CHAT_MODEL` selects an accessible Gemini model; the default is `gemini-2.5-flash`. Keys stay on the server. Without them, the app still opens and shows why chat is unavailable. The local SQLite file is created automatically in `./data`.

**Cost and privacy:** Gemini and Tavily free tiers are quota-limited and can change. The Gemini unpaid tier permits Google to use prompts and responses to improve products. Check your account's current limits and terms before entering sensitive chats. No billing account is required by this app.

## What works

- Multiple conversations in one browser workspace; the original messages and their timestamps survive app restarts. New conversations get a title from the first message. Sessions use an HttpOnly cookie and owner-scoped database queries. This is a local workspace, not cross-device sign-in.
- Exact user-local calendar-day lookup for explicit dates, today/yesterday, and last/this weekday; SQLite FTS5 retrieves older topical messages. The agent receives relevant original messages rather than synthetic memories. A missing dated question is answered without a model call.
- A bounded single-agent loop with only `web_search` exposed as a model tool. Tavily returns up to five results per query; the loop permits at most four searches per answer and can run independent searches together. Sources have IDs, excerpts, publication dates when supplied, and observation times. Only returned IDs can appear as citations; cited source snapshots are committed with the answer.
- Durable turns are idempotent and have retry/cancel endpoints. A three-turn concurrency limit, 45-second deadline, bounded database queue, input validation, and explicit provider errors limit overload. The UI has conversation history, source links, loading state, and retry controls.

## Architecture and limits

See [DESIGN.md](DESIGN.md) for the one-page explanation. Express owns HTTP, security, sessions, and agent orchestration. A single worker serializes SQLite operations. `src/server/agent` contains time parsing, memory assembly, Gemini, and Tavily adapters; `src/client` contains the React UI. The browser never receives provider keys. No vector database or extra agent framework is needed for this small local corpus.

This is optimized for a **single local process**. Another browser profile or device has a different workspace. Date lookup supports one explicitly mentioned day, and topic recall uses lexical matching, so vague paraphrases can be missed. Model answers and whether a citation truly supports a claim still need live evaluation; syntactic citation validation alone cannot guarantee factual correctness. The repository has no provider keys, so automated tests mock upstream responses. Search result excerpts and observation timestamps are retained for inspection, but historical price changes cannot be proven without comparable earlier evidence.

## Verify

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

For production browser tests, set `PLAYWRIGHT_SERVER_MODE=production` and run `npm run test:e2e` after building. `npm start` serves the production build. Browser tests do not call paid providers.

The challenge requires a **public** repository and a short `DESIGN.md` for submission. This repo remains private until explicitly published. The application form also asks for a one-minute explanation video; that is a separate submission task.
