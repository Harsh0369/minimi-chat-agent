# Thread — minimi chat agent challenge

A local, time-aware chat agent with one external tool: `web_search`. It can use earlier conversations, look up current information, and cite web results. Built in TypeScript for Node 24, with Express, React, SQLite, LangGraph, Gemini by default, and Tavily.

## Start

Use Node **24.14.1**. From this directory:

```sh
npm install
cp .env.example .env
# Add GEMINI_API_KEY and TAVILY_API_KEY to .env
npm run dev
```

Open http://127.0.0.1:3000. On Windows PowerShell, copy the file with `Copy-Item .env.example .env`. Gemini defaults to `gemini-3.5-flash-lite`. To use OpenAI, set `MODEL_PROVIDER=openai`, `OPENAI_API_KEY`, and `CHAT_MODEL`. To use Groq, set `MODEL_PROVIDER=groq` and `GROQ_API_KEY`; its default model is `openai/gpt-oss-120b`. All providers also need `TAVILY_API_KEY`. Keys stay on the server. Without the selected keys, the app still opens and shows why chat is unavailable. The local SQLite file is created automatically in `./data`.

Optional `EMBEDDING_MODEL=gemini-embedding-001` stores message vectors in the same SQLite database. Completed turns trigger bounded background indexing; recall searches indexed history without waiting for older-message backfill. This uses `GEMINI_API_KEY` even when Groq or OpenAI is the chat provider. Lexical and exact-date recall remain available if embedding fails.

**Cost and privacy:** Gemini and Tavily free tiers are quota-limited and can change. The Gemini unpaid tier permits Google to use prompts and responses to improve products. Check your account's current limits and terms before entering sensitive chats. No billing account is required by this app.

## What works

- Multiple conversations in one browser workspace; the original messages and their timestamps survive app restarts. Greetings keep a placeholder title until a substantive question arrives. Search conversation titles and messages across all chats or within the current chat with Ctrl/Cmd+K. Sessions use an HttpOnly cookie and owner-scoped database queries. This is a local workspace, not cross-device sign-in.
- The active conversation is the default context. A small tool-free router sees only that chat when a question may depend on past interaction or clock facts. A self-contained first question skips the router call. Clock-only and memory-only answers cannot call search. A missing dated record is answered without the main generation call.
- A bounded LangGraph workflow exposes only `web_search` to the model. For multi-item rechecks, an inspectable parser or validated model extraction recovers the historical list. The app searches each item and requested aspect, then builds a structured evidence answer directly from those results. Each failed search remains unverified without discarding successful ones. At most twelve searches run per answer, five in flight. Only returned source IDs can become citations; cited source snapshots are committed with the answer and shown through compact inline markers and an expandable source list.
- The user's timezone resolves dates but is not treated as a city or verified residence. For current date or time questions, the router can identify relevant IANA zones and Node computes the actual local clock values for the answer. City-specific questions without a place ask for one; broad local prices can use a clearly labeled country-level hint, with local search evidence ahead of model generation. Explicit locations take priority.
- Durable turns are idempotent and have retry/cancel endpoints. The 45-second deadline, bounded database queue, input validation, and explicit provider errors limit overload. Gemini/OpenAI allow three concurrent turns; Groq allows one and receives a smaller context and source excerpt budget because of its lower token quota. The responsive UI has a mobile history drawer, local 12-hour message timestamps, a bottom composer, Markdown and source links, incremental provider output, stop/retry controls, and scroll-follow that pauses while reading older messages. Partial output is provisional and is never saved as a completed answer.

## Architecture and limits

See [DESIGN.md](DESIGN.md) for the one-page explanation. Express routes compose middleware and controllers; a separate turn service owns execution, admission and cancellation. Shared HTTP errors, safe logging and streaming transport keep policy out of route wiring. A single worker serializes SQLite operations. `src/server/agent` contains time parsing, memory assembly, provider adapters and the LangGraph workflow; `src/client` contains the React UI. Gemini uses its native transport to preserve tool-call signatures; OpenAI and Groq use LangChain model integrations. The browser never receives provider keys.

This is optimized for a **single local process**. Another browser profile or device has a different workspace. Date lookup supports one explicitly mentioned day. With embeddings disabled, vague paraphrases can be missed; with them enabled, background indexing and provider quotas limit immediate recall of very large histories. Source snippets, vendor-domain checks, cited amounts and dated-change checks reduce unsupported claims but cannot prove that a cited page supports every sentence. Gemini is the default; Groq is optional and can conservatively decline a searched answer when evidence review is inconclusive. The OpenAI adapter has mocked tests but no live account evaluation. Historical price changes require comparable earlier evidence.

## Verify

Set `PERF_LOG=1` to log timings and sanitized failure categories without prompts, queries, or keys.

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

For production browser tests, set `PLAYWRIGHT_SERVER_MODE=production` and run `npm run test:e2e` after building. `npm start` serves the production build. Browser tests do not call paid providers.
