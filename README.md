# Squad

A local-first web app — gym tracking with sub-millisecond navigation.

## Architecture

- **Vite + React + React Router** — pure SPA, no server-side rendering
- **PowerSync** — in-browser SQLite (via WebAssembly) synced to Supabase Postgres
- **Supabase** — backend database, auth, and source of truth for sync
- **Vercel** — static asset hosting only (no functions, no SSR)

The user's device is the primary execution environment. All queries run against local SQLite (~1ms); the network is only touched on app startup (initial sync) and in the background as writes propagate to Supabase.

## Get started

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_POWERSYNC_URL
npm run dev
```
