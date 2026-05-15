# PowerSync setup

One-time steps to provision PowerSync Cloud and connect it to the existing
Supabase project shared with gymtracker.

## 1. Apply the `follows` migration to Supabase

Before PowerSync can sync the `follows` table, it needs a single `id` column
as the primary key (it doesn't support composite keys). The migration lives
in `gymtracker/drizzle/0008_follows_id.sql`. Run it in Supabase SQL Editor.

## 2. Enable logical replication in Supabase

PowerSync reads from a Postgres logical-replication publication.

- Supabase Dashboard → Database → Replication → confirm a publication named
  `supabase_realtime` exists. PowerSync will create its own publication
  (`powersync`) when it connects, OR you can pre-create one with all six
  synced tables in it (the dashboard walks you through this).

## 3. Create the PowerSync Cloud project

- Go to https://powersync.com and create an account.
- Create a new project.
- Pick "Supabase" as the data source.
- Provide your Supabase database connection string from
  Supabase Dashboard → Project Settings → Database → Connection string
  (use the **non-pooled** direct connection — PowerSync needs logical
  replication which doesn't work through PgBouncer).

## 4. Configure JWT validation

PowerSync needs to validate the Supabase JWTs your app sends.

- In PowerSync Dashboard → Project Settings → JWT, select **Supabase**.
- Paste your Supabase JWT secret from
  Supabase Dashboard → Project Settings → API → JWT Settings → JWT Secret.

## 5. Apply sync rules

- PowerSync Dashboard → Sync Rules.
- Paste the contents of `powersync/sync_rules.yaml` from this repo.
- Click **Deploy**.

## 6. Wire the URL into squad

- Copy the project URL from PowerSync Dashboard (top of the project page).
- Set `VITE_POWERSYNC_URL=...` in `squad/.env`.
- Restart `npm run dev`.

## 7. Verify

- Sign in to squad.
- Open the browser devtools → Application → IndexedDB / OPFS — you should
  see `squad.db` materialise.
- PowerSync Dashboard → Diagnostics → see the streaming connection from
  your browser.
