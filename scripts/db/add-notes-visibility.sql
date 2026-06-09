-- Session-level and exercise-level notes, each with a public/private toggle.
--
--  * `workouts.notes` (TEXT) already exists — this adds the visibility flag.
--  * `workouts.notes_public` gates whether followers see the session note.
--  * `sets.notes` stores the per-exercise note for a session, denormalised
--    across every set of that exercise group (mirroring `sets.variation` /
--    `circuit_name`). It's entered directly by the app, NOT derived from
--    `workouts`, so no trigger maintenance is needed.
--  * `sets.notes_public` gates whether followers see that exercise note.
--
-- Both flags default to TRUE (public). All new columns are nullable or
-- defaulted, so no backfill of existing rows is required.

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS notes_public boolean NOT NULL DEFAULT true;
ALTER TABLE sets     ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE sets     ADD COLUMN IF NOT EXISTS notes_public boolean NOT NULL DEFAULT true;

-- Templates mirror the same two note levels so a template can carry default
-- notes into the sessions created from it. Templates are private (no followee_*
-- bucket), so `notes_public` here is purely the default visibility inherited by
-- a materialised session — no sync-rule change is needed for templates.
ALTER TABLE templates     ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE templates     ADD COLUMN IF NOT EXISTS notes_public boolean NOT NULL DEFAULT true;
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS notes_public boolean NOT NULL DEFAULT true;

-- Stored generated columns for PowerSync sync-rule privacy.
--
-- PowerSync's sync-rule SQL parser does not support CASE expressions in data
-- queries. To enforce note privacy for followers without CASE in the sync
-- rules, we pre-compute the masked value in Postgres as a STORED generated
-- column. The sync rule then uses a plain `notes_for_followers as notes`
-- column reference — no CASE, no expression — and still queries `FROM workouts`
-- / `FROM sets` so PowerSync maps rows to the correct local tables.
--
-- The column must be added AFTER notes_public and notes exist (order above is
-- correct). `STORED` means Postgres persists the value on every write.
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS notes_for_followers text
  GENERATED ALWAYS AS (CASE WHEN notes_public THEN notes ELSE NULL END) STORED;

ALTER TABLE sets
  ADD COLUMN IF NOT EXISTS notes_for_followers text
  GENERATED ALWAYS AS (CASE WHEN notes_public THEN notes ELSE NULL END) STORED;

-- After applying this migration: redeploy powersync/sync_rules.yaml.
-- The followee_workouts / followee_sets buckets now use
-- `notes_for_followers as notes` instead of a CASE expression.
-- Both buckets remain `FROM workouts` / `FROM sets` (no explicit column list
-- required), so any future column added to those tables syncs automatically to
-- followers (except notes_public and notes themselves, which are excluded).
