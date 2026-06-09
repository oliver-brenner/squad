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

-- After applying: redeploy powersync/sync_rules.yaml. Note that the
-- followee_workouts / followee_sets buckets are NO LONGER `SELECT *` — they
-- project an explicit column list that nulls the note text when notes_public
-- is false, so a follower's device never receives private note text. Any
-- future column added to `workouts`/`sets` must be added to those buckets too.
