-- Fix: followers never reliably receive session/exercise notes.
--
-- add-notes-visibility.sql created `workouts.notes_for_followers` and
-- `sets.notes_for_followers` as STORED GENERATED columns, so the sync rules
-- could project `notes_for_followers as notes` without a CASE expression
-- (which PowerSync's parser doesn't support).
--
-- The problem: Postgres logical replication does not publish generated columns
-- before PG 18 (the `publish_generated_columns` publication parameter is new in
-- 18, and Supabase is not there yet). PowerSync's initial snapshot uses a plain
-- SELECT, which DOES include generated columns — so a follower's notes appear
-- on first sync and then go NULL the moment that row is next updated and
-- arrives over the WAL without the column. A device that connects for the
-- first time after this migration would never have seen them at all.
--
-- The fix keeps the exact same column name and semantics, but maintains the
-- value with a BEFORE trigger instead. Trigger-written columns are ordinary
-- stored columns and replicate normally. The sync rules need no change for
-- this — `notes_for_followers as notes` keeps working.
--
-- Apply this BEFORE redeploying powersync/sync_rules.yaml.

BEGIN;

-- Same name, same type, no longer generated. Dropping and re-adding in one
-- transaction means the sync rules never reference a missing column.
ALTER TABLE workouts DROP COLUMN IF EXISTS notes_for_followers;
ALTER TABLE workouts ADD COLUMN notes_for_followers text;

ALTER TABLE sets DROP COLUMN IF EXISTS notes_for_followers;
ALTER TABLE sets ADD COLUMN notes_for_followers text;

-- Shared by both tables — they have identically named `notes` / `notes_public`
-- columns, so one function covers them. COALESCE guards the flag in case a row
-- predates the NOT NULL DEFAULT (private is the safe default for a NULL).
CREATE OR REPLACE FUNCTION set_notes_for_followers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.notes_for_followers :=
    CASE WHEN COALESCE(NEW.notes_public, false) THEN NEW.notes ELSE NULL END;
  RETURN NEW;
END;
$$;

-- BEFORE, so the computed value is part of the row the WAL publishes. Fires on
-- every insert/update rather than only on `notes`/`notes_public` changes —
-- these tables see low write volume and unconditional is one less way to end
-- up with a stale masked value.
DROP TRIGGER IF EXISTS workouts_notes_for_followers ON workouts;
CREATE TRIGGER workouts_notes_for_followers
  BEFORE INSERT OR UPDATE ON workouts
  FOR EACH ROW EXECUTE FUNCTION set_notes_for_followers();

DROP TRIGGER IF EXISTS sets_notes_for_followers ON sets;
CREATE TRIGGER sets_notes_for_followers
  BEFORE INSERT OR UPDATE ON sets
  FOR EACH ROW EXECUTE FUNCTION set_notes_for_followers();

-- Backfill existing rows. The no-op assignment fires the trigger, which does
-- the actual computation. This rewrites every row in both tables, so PowerSync
-- re-replicates all of workouts and sets — expect a burst of sync traffic and
-- a short period where clients are catching up. That re-replication is the
-- point: it's what carries the now-replicable values down to followers.
UPDATE workouts SET notes_public = notes_public;
UPDATE sets     SET notes_public = notes_public;

COMMIT;

-- Verify: a public note has a matching masked value, a private one is NULL.
--
--   SELECT notes_public, notes IS NOT NULL AS has_note,
--          notes_for_followers IS NOT NULL AS visible_to_followers,
--          COUNT(*)
--   FROM workouts GROUP BY 1, 2, 3;
--
-- Every row should satisfy: visible_to_followers = (notes_public AND has_note).
