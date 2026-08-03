-- Per-set calories. Calories are tracked at BOTH levels: `workouts.calories`
-- is the session total (entered from the log card, see add-workout-calories.sql)
-- and `sets.calories` is the per-set value, gated on the exercise's
-- `track_calories` toggle and entered in the set tray.
--
-- The client schema and the write paths have always had `sets.calories`
-- (src/lib/db/schema.ts, saveWorkout / duplicateWorkout / template
-- materialisation), but the column was never added to Postgres. It went
-- unnoticed because PowerSync omits NULL columns from its upload payload, so
-- sets without a calories value upload cleanly. The first set that DOES carry
-- one sends a column PostgREST doesn't know about, gets rejected with PGRST204,
-- and — because the CRUD queue is strict FIFO — every write queued behind it is
-- blocked indefinitely. Symptom: local sessions silently stop reaching the
-- server.
--
-- `template_sets.calories` already exists (add-templates.sql created it), which
-- is why the gap was easy to miss when reading the migrations.
--
-- Apply this BEFORE redeploying powersync/sync_rules.yaml — the followee_sets
-- projection references the column.

ALTER TABLE sets ADD COLUMN IF NOT EXISTS calories integer;

-- Verify the column is there and, if uploads were previously blocked, that the
-- queue has drained (the blocked op retries and succeeds once the column
-- exists; a client reload restarts the queue if it doesn't self-heal):
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'sets' AND column_name = 'calories';
