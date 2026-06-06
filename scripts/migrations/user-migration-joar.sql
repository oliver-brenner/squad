-- ============================================================================
-- Hevy → Squad migration (Joar)
-- ============================================================================
-- One-shot import of Joar's Hevy workout history (2025-03-29 → 2026-05-31)
-- into a Squad user account.
--
-- USAGE
--   1. Replace the literal UUID on the `target_user_id` line below.
--   2. Paste the entire file into the Supabase SQL editor and Run.
--   3. Everything is wrapped in a transaction (BEGIN / COMMIT). If anything
--      fails the whole thing aborts cleanly.
--
-- BEHAVIOUR
--   - Hevy stores equipment in the exercise title as a parenthetical, e.g.
--     "Squat (Barbell)" or "Shoulder Press (Machine Plates)". The migration
--     STRIPS that parenthetical and stores the equipment as a tag instead:
--       * exercise.name      = "Squat"
--       * exercise.equipment = "barbell"  (key into user_field_options)
--     The matching `user_field_options` row (kind='equipment') is created
--     idempotently so the equipment label renders in the UI.
--   - Exercises are deduped by (LOWER(name), equipment). That's intentional:
--     "Bicep Curl" + Barbell and "Bicep Curl" + Dumbbell become TWO distinct
--     exercises, as do the three Squat variants (Barbell / Machine /
--     Smith Machine). Matching against the user's existing library uses the
--     same composite key.
--   - All new exercises get track_reps=true, all other tracking flags off,
--     is_bodyweight=false. Each exercise is tagged with a single category
--     ('resistance') and 1-2 parent muscle group keys, drawn from the
--     defaults seeded at signup (see src/lib/exercise-options.ts —
--     CATEGORIES and MUSCLE_GROUPS). No new category/muscle option rows
--     are created. No child muscles are assigned — Joar can drill down
--     manually post-import.
--   - Warmup sets ARE imported as regular sets (Squad has no set_type
--     column; preserving them keeps the full history). One Hevy-generated
--     "Warm Up" placeholder row on 2025-07-27 (duration=300s, no
--     weight/reps) is skipped.
--   - Workouts: one row per distinct date, name taken from the Hevy session
--     title (Legs / Upper / Workout A / Workout B), session_type='workout'.
--     No dedup against existing workouts — re-running on dates that already
--     have data will produce duplicate workout sessions.
--   - Sets: position is 0-indexed across the entire workout (matches
--     saveWorkout / copyFriendSession). user_id and performed_on are
--     populated explicitly even though a Postgres trigger would maintain
--     them — defensive in case the trigger isn't installed.
--
-- EQUIPMENT KEYS USED (slug = lower(label) — matches the default key format
-- in src/lib/exercise-options.ts so existing default options are reused
-- where they overlap)
--   barbell          → "Barbell"        (default)
--   dumbbell         → "Dumbbell"       (default)
--   machine          → "Machine"        (default)
--   smith machine    → "Smith Machine"  (default)
--   machine plates   → "Machine Plates" (new — created by this migration)
-- ============================================================================

BEGIN;

DO $migration$
DECLARE
  -- ▼▼▼ REPLACE THIS WITH JOAR'S USER UUID ▼▼▼
  target_user_id uuid := '00000000-0000-0000-0000-000000000000';
  -- ▲▲▲ REPLACE THIS WITH JOAR'S USER UUID ▲▲▲

  imported_equipment_count int;
  imported_exercise_count int;
  imported_workout_count int;
  imported_set_count int;
BEGIN
  IF target_user_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'target_user_id is still the placeholder — replace it before running.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'No auth.users row for %', target_user_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- Staging: every logged set, in import order.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _import (
    rownum bigserial PRIMARY KEY,
    performed_on date NOT NULL,
    workout_name text NOT NULL,
    exercise_name text NOT NULL,
    equipment_label text,           -- "Barbell", "Machine Plates", etc.
    reps int,
    weight_kg numeric
  ) ON COMMIT DROP;

  INSERT INTO _import (performed_on, workout_name, exercise_name, equipment_label, reps, weight_kg) VALUES
    -- ===== 2026-05-31 (Legs) =====
    ('2026-05-31', 'Legs', 'Squat', 'Barbell', 5, 50),
    ('2026-05-31', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-05-31', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-05-31', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 15, 20),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 8, 40),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 5, 55),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 5, 55),
    ('2026-05-31', 'Legs', 'Bench Press', 'Barbell', 5, 55),
    -- ===== 2026-05-24 (Upper) =====
    ('2026-05-24', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-05-24', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-05-24', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2026-05-24', 'Upper', 'Seated Row', 'Machine', 5, 66),
    -- ===== 2026-05-13 (Upper) =====
    ('2026-05-13', 'Upper', 'Bench Press', 'Barbell', 15, 20),
    ('2026-05-13', 'Upper', 'Bench Press', 'Barbell', 8, 40),
    ('2026-05-13', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-05-13', 'Upper', 'Bench Press', 'Barbell', 3, 60),
    ('2026-05-13', 'Upper', 'Bench Press', 'Barbell', 3, 60),
    ('2026-05-13', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-05-13', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-05-13', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2026-05-13', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-05-13', 'Upper', 'Seated Row', 'Machine', 5, 66),
    -- ===== 2026-05-10 (Legs) =====
    ('2026-05-10', 'Legs', 'Squat', 'Barbell', 5, 40),
    ('2026-05-10', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-05-10', 'Legs', 'Squat', 'Barbell', 4, 70),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 20, 20),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 5, 40),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 3, 60),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 3, 60),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 2, 60),
    ('2026-05-10', 'Legs', 'Bench Press', 'Barbell', 4, 50),
    -- ===== 2026-05-03 (Upper) =====
    ('2026-05-03', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 10, 30),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 5, 55),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 3, 60),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 3, 55),
    ('2026-05-03', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-05-03', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-05-03', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-05-03', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2026-05-03', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-05-03', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-05-03', 'Upper', 'Squat', 'Barbell', 5, 40),
    ('2026-05-03', 'Upper', 'Squat', 'Barbell', 5, 50),
    ('2026-05-03', 'Upper', 'Squat', 'Barbell', 5, 60),
    ('2026-05-03', 'Upper', 'Squat', 'Barbell', 5, 70),
    ('2026-05-03', 'Upper', 'Squat', 'Barbell', 4, 70),
    -- ===== 2026-04-26 (Legs) =====
    ('2026-04-26', 'Legs', 'Squat', 'Barbell', 5, 50),
    ('2026-04-26', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-04-26', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-04-26', 'Legs', 'Squat', 'Barbell', 3, 70),
    ('2026-04-26', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2026-04-26', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2026-04-26', 'Legs', 'Bench Press', 'Barbell', 5, 55),
    ('2026-04-26', 'Legs', 'Bench Press', 'Barbell', 4, 55),
    ('2026-04-26', 'Legs', 'Bench Press', 'Barbell', 3, 50),
    -- ===== 2026-04-21 (Upper) =====
    ('2026-04-21', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-04-21', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 27),
    ('2026-04-21', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-04-21', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-04-21', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-04-21', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2026-04-21', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-04-21', 'Upper', 'Bench Press', 'Barbell', 3, 55),
    ('2026-04-21', 'Upper', 'Bench Press', 'Barbell', 2, 50),
    ('2026-04-21', 'Upper', 'Bench Press', 'Barbell', 3, 50),
    ('2026-04-21', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-04-21', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-04-21', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2026-04-21', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-04-21', 'Upper', 'Squat', 'Machine', 5, 50),
    ('2026-04-21', 'Upper', 'Squat', 'Machine', 5, 30),
    ('2026-04-21', 'Upper', 'Squat', 'Machine', 5, 30),
    ('2026-04-21', 'Upper', 'Squat', 'Machine', 5, 40),
    ('2026-04-21', 'Upper', 'Squat', 'Machine', 5, 40),
    -- ===== 2026-03-24 (Legs) =====
    ('2026-03-24', 'Legs', 'Squat', 'Barbell', 5, 50),
    ('2026-03-24', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-03-24', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-03-24', 'Legs', 'Squat', 'Barbell', 5, 60),
    -- ===== 2026-02-24 (Workout A) =====
    ('2026-02-24', 'Workout A', 'Squat', 'Barbell', 10, 20),
    ('2026-02-24', 'Workout A', 'Squat', 'Barbell', 5, 50),
    ('2026-02-24', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2026-02-24', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2026-02-24', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 10, 40),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 5, 50),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 5, 60),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 5, 60),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 2, 60),
    ('2026-02-24', 'Workout A', 'Bench Press', 'Barbell', 5, 50),
    -- ===== 2026-02-22 (Workout B) =====
    ('2026-02-22', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2026-02-22', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2026-02-22', 'Workout B', 'Squat', 'Barbell', 3, 60),
    ('2026-02-22', 'Workout B', 'Squat', 'Barbell', 3, 70),
    ('2026-02-22', 'Workout B', 'Squat', 'Barbell', 3, 70),
    ('2026-02-22', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2026-02-22', 'Workout B', 'Deadlift', 'Barbell', 3, 100),
    ('2026-02-22', 'Workout B', 'Deadlift', 'Barbell', 3, 120),
    ('2026-02-22', 'Workout B', 'Deadlift', 'Barbell', 2, 120),
    ('2026-02-22', 'Workout B', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-02-22', 'Workout B', 'Shoulder Press', 'Machine Plates', 10, 23),
    ('2026-02-22', 'Workout B', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-02-22', 'Workout B', 'Shoulder Press', 'Machine Plates', 5, 41),
    ('2026-02-22', 'Workout B', 'Shoulder Press', 'Machine Plates', 5, 41),
    -- ===== 2026-02-18 (Workout A) =====
    ('2026-02-18', 'Workout A', 'Squat', 'Barbell', 10, 20),
    ('2026-02-18', 'Workout A', 'Squat', 'Barbell', 5, 40),
    ('2026-02-18', 'Workout A', 'Squat', 'Barbell', 5, 40),
    ('2026-02-18', 'Workout A', 'Bench Press', 'Barbell', 10, 40),
    ('2026-02-18', 'Workout A', 'Bench Press', 'Barbell', 5, 50),
    ('2026-02-18', 'Workout A', 'Bench Press', 'Barbell', 5, 60),
    ('2026-02-18', 'Workout A', 'Bench Press', 'Barbell', 3, 60),
    ('2026-02-18', 'Workout A', 'Bench Press', 'Barbell', 5, 50),
    ('2026-02-18', 'Workout A', 'Seated Row', 'Machine', 10, 39),
    ('2026-02-18', 'Workout A', 'Seated Row', 'Machine', 5, 52),
    ('2026-02-18', 'Workout A', 'Seated Row', 'Machine', 5, 66),
    ('2026-02-18', 'Workout A', 'Seated Row', 'Machine', 5, 66),
    ('2026-02-18', 'Workout A', 'Seated Row', 'Machine', 5, 66),
    -- ===== 2026-02-15 (Legs) =====
    ('2026-02-15', 'Legs', 'Squat', 'Barbell', 5, 50),
    ('2026-02-15', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-02-15', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-02-15', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-02-15', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-02-15', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-02-15', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-02-15', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-02-15', 'Legs', 'Deadlift', 'Barbell', 5, 70),
    ('2026-02-15', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2026-02-15', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2026-02-15', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2026-02-15', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    -- ===== 2026-02-11 (Upper) =====
    ('2026-02-11', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-02-11', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 27),
    ('2026-02-11', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-02-11', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 41),
    ('2026-02-11', 'Upper', 'Bench Press', 'Barbell', 10, 30),
    ('2026-02-11', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-02-11', 'Upper', 'Bench Press', 'Barbell', 5, 55),
    ('2026-02-11', 'Upper', 'Bench Press', 'Barbell', 5, 60),
    ('2026-02-11', 'Upper', 'Bench Press', 'Barbell', 7, 50),
    ('2026-02-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2026-02-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-02-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-02-11', 'Upper', 'Bicep Curl', 'Barbell', 5, 30),
    ('2026-02-11', 'Upper', 'Bicep Curl', 'Barbell', 5, 30),
    -- ===== 2026-02-04 (Upper) =====
    ('2026-02-04', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-02-04', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 27),
    ('2026-02-04', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-02-04', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 41),
    ('2026-02-04', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 41),
    ('2026-02-04', 'Upper', 'Bench Press', 'Barbell', 10, 30),
    ('2026-02-04', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2026-02-04', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-02-04', 'Upper', 'Bench Press', 'Barbell', 5, 55),
    ('2026-02-04', 'Upper', 'Bench Press', 'Barbell', 3, 60),
    ('2026-02-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2026-02-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-02-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 30),
    ('2026-02-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 30),
    ('2026-02-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    -- ===== 2026-01-28 (Upper) =====
    ('2026-01-28', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-01-28', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-28', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-28', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-01-28', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 41),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 2, 60),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 3, 50),
    ('2026-01-28', 'Upper', 'Bench Press', 'Barbell', 5, 55),
    ('2026-01-28', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-01-28', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-28', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-28', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-28', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-28', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2026-01-28', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-28', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-28', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    -- ===== 2026-01-23 (Upper) =====
    ('2026-01-23', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-01-23', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-23', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-23', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-01-23', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-01-23', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2026-01-23', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-23', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-23', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-23', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-23', 'Upper', 'Chest Press', 'Machine', 10, 11),
    ('2026-01-23', 'Upper', 'Chest Press', 'Machine', 10, 25),
    ('2026-01-23', 'Upper', 'Chest Press', 'Machine', 5, 39),
    ('2026-01-23', 'Upper', 'Chest Press', 'Machine', 5, 39),
    ('2026-01-23', 'Upper', 'Chest Press', 'Machine', 5, 39),
    -- ===== 2026-01-16 (Upper) =====
    ('2026-01-16', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-01-16', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 27),
    ('2026-01-16', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-16', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 36),
    ('2026-01-16', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2026-01-16', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2026-01-16', 'Upper', 'Bench Press', 'Barbell', 4, 50),
    ('2026-01-16', 'Upper', 'Bench Press', 'Barbell', 4, 50),
    ('2026-01-16', 'Upper', 'Bench Press', 'Barbell', 6, 50),
    ('2026-01-16', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-01-16', 'Upper', 'Seated Row', 'Machine', 10, 39),
    ('2026-01-16', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-16', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-16', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-16', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2026-01-16', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2026-01-16', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-16', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-16', 'Upper', 'Bicep Curl', 'Barbell', 10, 27.5),
    ('2026-01-16', 'Upper', 'Bicep Curl', 'Barbell', 8, 20),
    -- ===== 2026-01-13 (Legs) =====
    ('2026-01-13', 'Legs', 'Squat', 'Barbell', 5, 50),
    ('2026-01-13', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2026-01-13', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-01-13', 'Legs', 'Squat', 'Barbell', 3, 70),
    ('2026-01-13', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2026-01-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-01-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-01-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2026-01-13', 'Legs', 'Deadlift', 'Barbell', 5, 70),
    ('2026-01-13', 'Legs', 'Deadlift', 'Barbell', 5, 100),
    ('2026-01-13', 'Legs', 'Deadlift', 'Barbell', 5, 100),
    ('2026-01-13', 'Legs', 'Deadlift', 'Barbell', 5, 100),
    -- ===== 2026-01-11 (Upper) =====
    ('2026-01-11', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2026-01-11', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 27),
    ('2026-01-11', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 27),
    ('2026-01-11', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2026-01-11', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2026-01-11', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2026-01-11', 'Upper', 'Seated Row', 'Machine', 7, 39),
    ('2026-01-11', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-11', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-11', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-11', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2026-01-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2026-01-11', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    -- ===== 2025-12-21 (Legs) =====
    ('2025-12-21', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-21', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-12-21', 'Legs', 'Squat', 'Barbell', 5, 80),
    ('2025-12-21', 'Legs', 'Squat', 'Barbell', 3, 80),
    ('2025-12-21', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2025-12-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-12-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-12-21', 'Legs', 'Romanian Deadlift', 'Barbell', 4, 100),
    ('2025-12-21', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2025-12-21', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2025-12-21', 'Legs', 'Deadlift', 'Barbell', 3, 120),
    ('2025-12-21', 'Legs', 'Bicep Curl', 'Barbell', 8, 20),
    ('2025-12-21', 'Legs', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-21', 'Legs', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-21', 'Legs', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-21', 'Legs', 'Bicep Curl', 'Barbell', 10, 25),
    -- ===== 2025-12-18 (Upper) =====
    ('2025-12-18', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2025-12-18', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-12-18', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 27),
    ('2025-12-18', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2025-12-18', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2025-12-18', 'Upper', 'Bench Press', 'Barbell', 8, 40),
    ('2025-12-18', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2025-12-18', 'Upper', 'Bench Press', 'Barbell', 5, 55),
    ('2025-12-18', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2025-12-18', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2025-12-18', 'Upper', 'Seated Row', 'Machine', 7, 39),
    ('2025-12-18', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2025-12-18', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2025-12-18', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2025-12-18', 'Upper', 'Seated Row', 'Machine', 5, 59),
    -- ===== 2025-12-13 (Legs) =====
    ('2025-12-13', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-13', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-12-13', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-12-13', 'Legs', 'Squat', 'Barbell', 2, 80),
    ('2025-12-13', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2025-12-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-12-13', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 100),
    ('2025-12-13', 'Legs', 'Deadlift', 'Barbell', 3, 80),
    ('2025-12-13', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2025-12-13', 'Legs', 'Deadlift', 'Barbell', 3, 120),
    ('2025-12-13', 'Legs', 'Bench Press', 'Barbell', 5, 40),
    ('2025-12-13', 'Legs', 'Bench Press', 'Barbell', 2, 60),
    ('2025-12-13', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2025-12-13', 'Legs', 'Bench Press', 'Barbell', 1, 60),
    ('2025-12-13', 'Legs', 'Bench Press', 'Barbell', 7, 50),
    -- ===== 2025-12-10 (Upper) =====
    ('2025-12-10', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2025-12-10', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 14),
    ('2025-12-10', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-12-10', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 23),
    ('2025-12-10', 'Upper', 'Shoulder Press', 'Machine Plates', 5, 32),
    ('2025-12-10', 'Upper', 'Seated Row', 'Machine', 7, 39),
    ('2025-12-10', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2025-12-10', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2025-12-10', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2025-12-10', 'Upper', 'Seated Row', 'Machine', 5, 66),
    ('2025-12-10', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-10', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-10', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    ('2025-12-10', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-10', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    -- ===== 2025-12-06 (Legs) =====
    ('2025-12-06', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-06', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-12-06', 'Legs', 'Squat', 'Barbell', 5, 80),
    ('2025-12-06', 'Legs', 'Squat', 'Barbell', 4, 80),
    ('2025-12-06', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-12-06', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2025-12-06', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-12-06', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 100),
    ('2025-12-06', 'Legs', 'Deadlift', 'Barbell', 3, 80),
    ('2025-12-06', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2025-12-06', 'Legs', 'Deadlift', 'Barbell', 3, 120),
    ('2025-12-06', 'Legs', 'Deadlift', 'Barbell', 3, 100),
    ('2025-12-06', 'Legs', 'Bench Press', 'Barbell', 5, 40),
    ('2025-12-06', 'Legs', 'Bench Press', 'Barbell', 3, 60),
    ('2025-12-06', 'Legs', 'Bench Press', 'Barbell', 5, 50),
    ('2025-12-06', 'Legs', 'Bench Press', 'Barbell', 4, 55),
    ('2025-12-06', 'Legs', 'Bench Press', 'Barbell', 6, 50),
    -- ===== 2025-12-04 (Upper) =====
    ('2025-12-04', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 9),
    ('2025-12-04', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 14),
    ('2025-12-04', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-12-04', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-12-04', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-12-04', 'Upper', 'Seated Row', 'Machine', 8, 25),
    ('2025-12-04', 'Upper', 'Seated Row', 'Machine', 8, 39),
    ('2025-12-04', 'Upper', 'Seated Row', 'Machine', 8, 52),
    ('2025-12-04', 'Upper', 'Seated Row', 'Machine', 5, 52),
    ('2025-12-04', 'Upper', 'Seated Row', 'Machine', 5, 59),
    ('2025-12-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-04', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-12-04', 'Upper', 'Chest Press', 'Machine', 10, 11),
    ('2025-12-04', 'Upper', 'Chest Press', 'Machine', 10, 25),
    ('2025-12-04', 'Upper', 'Chest Press', 'Machine', 8, 39),
    ('2025-12-04', 'Upper', 'Chest Press', 'Machine', 4, 45),
    ('2025-12-04', 'Upper', 'Chest Press', 'Machine', 4, 39),
    -- ===== 2025-11-29 (Legs) =====
    ('2025-11-29', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-11-29', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-11-29', 'Legs', 'Squat', 'Barbell', 5, 75),
    ('2025-11-29', 'Legs', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-11-29', 'Legs', 'Romanian Deadlift', 'Barbell', 6, 90),
    ('2025-11-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 100),
    ('2025-11-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 100),
    ('2025-11-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 60),
    ('2025-11-29', 'Legs', 'Squat', 'Smith Machine', 5, 50),
    ('2025-11-29', 'Legs', 'Squat', 'Smith Machine', 5, 50),
    -- ===== 2025-11-27 (Upper) =====
    ('2025-11-27', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 12),
    ('2025-11-27', 'Upper', 'Shoulder Press', 'Machine Plates', 10, 16),
    ('2025-11-27', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 24),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 8, 35),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 5, 40),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 5, 45),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2025-11-27', 'Upper', 'Bench Press', 'Barbell', 5, 50),
    ('2025-11-27', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-11-27', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-11-27', 'Upper', 'Bicep Curl', 'Barbell', 10, 25),
    -- ===== 2025-11-21 (Legs) =====
    ('2025-11-21', 'Legs', 'Squat', 'Barbell', 8, 50),
    ('2025-11-21', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-11-21', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-11-21', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-11-21', 'Legs', 'Romanian Deadlift', 'Barbell', 8, 50),
    ('2025-11-21', 'Legs', 'Romanian Deadlift', 'Barbell', 8, 70),
    ('2025-11-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 90),
    ('2025-11-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 90),
    ('2025-11-21', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 90),
    -- ===== 2025-10-30 (Upper) =====
    ('2025-10-30', 'Upper', 'Shoulder Press', 'Machine Plates', 20, 4.5),
    ('2025-10-30', 'Upper', 'Shoulder Press', 'Machine Plates', 16, 9),
    ('2025-10-30', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 14),
    ('2025-10-30', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 18),
    ('2025-10-30', 'Upper', 'Shoulder Press', 'Machine Plates', 8, 23),
    ('2025-10-30', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2025-10-30', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2025-10-30', 'Upper', 'Bench Press', 'Barbell', 8, 30),
    ('2025-10-30', 'Upper', 'Bench Press', 'Barbell', 12, 30),
    ('2025-10-30', 'Upper', 'Bench Press', 'Barbell', 12, 30),
    ('2025-10-30', 'Upper', 'Seated Row', 'Machine', 8, 25),
    ('2025-10-30', 'Upper', 'Seated Row', 'Machine', 8, 39),
    ('2025-10-30', 'Upper', 'Seated Row', 'Machine', 8, 45),
    ('2025-10-30', 'Upper', 'Seated Row', 'Machine', 8, 52),
    ('2025-10-30', 'Upper', 'Seated Row', 'Machine', 8, 52),
    ('2025-10-30', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-10-30', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-10-30', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-10-30', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    ('2025-10-30', 'Upper', 'Bicep Curl', 'Barbell', 10, 20),
    -- ===== 2025-10-29 (Legs) =====
    ('2025-10-29', 'Legs', 'Squat', 'Barbell', 8, 50),
    ('2025-10-29', 'Legs', 'Squat', 'Barbell', 5, 60),
    ('2025-10-29', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-10-29', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-10-29', 'Legs', 'Squat', 'Barbell', 5, 70),
    ('2025-10-29', 'Legs', 'Romanian Deadlift', 'Barbell', 8, 40),
    ('2025-10-29', 'Legs', 'Romanian Deadlift', 'Barbell', 8, 70),
    ('2025-10-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-10-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-10-29', 'Legs', 'Romanian Deadlift', 'Barbell', 5, 80),
    -- ===== 2025-10-24 (Workout A) =====
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2025-10-24', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2025-10-24', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 50),
    ('2025-10-24', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-10-24', 'Workout A', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-10-24', 'Workout A', 'Romanian Deadlift', 'Barbell', 5, 80),
    ('2025-10-24', 'Workout A', 'Romanian Deadlift', 'Barbell', 5, 80),
    -- ===== 2025-10-06 (Workout A) =====
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-06', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-10-06', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-10-06', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-10-06', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-10-06', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    ('2025-10-06', 'Workout A', 'Romanian Deadlift', 'Barbell', 8, 60),
    -- ===== 2025-09-16 (Workout B) =====
    ('2025-09-16', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-09-16', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-09-16', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-09-16', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-09-16', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-09-16', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2025-09-16', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2025-09-16', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2025-09-16', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2025-09-16', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    -- ===== 2025-09-12 (Workout B) =====
    ('2025-09-12', 'Workout B', 'Deadlift', 'Barbell', 8, 40),
    ('2025-09-12', 'Workout B', 'Deadlift', 'Barbell', 8, 60),
    ('2025-09-12', 'Workout B', 'Deadlift', 'Barbell', 8, 80),
    ('2025-09-12', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-09-12', 'Workout B', 'Deadlift', 'Barbell', 5, 60),
    ('2025-09-12', 'Workout B', 'Bench Press', 'Barbell', 8, 20),
    ('2025-09-12', 'Workout B', 'Bench Press', 'Barbell', 8, 40),
    ('2025-09-12', 'Workout B', 'Bench Press', 'Barbell', 8, 40),
    ('2025-09-12', 'Workout B', 'Bench Press', 'Barbell', 8, 40),
    ('2025-09-12', 'Workout B', 'Bench Press', 'Barbell', 8, 40),
    -- ===== 2025-09-09 (Workout A) =====
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 8, 60),
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 5, 70),
    ('2025-09-09', 'Workout A', 'Squat', 'Barbell', 5, 60),
    -- ===== 2025-08-20 (Workout A) =====
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-20', 'Workout A', 'Squat', 'Barbell', 5, 50),
    -- ===== 2025-08-16 (Workout A) =====
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-08-16', 'Workout A', 'Squat', 'Barbell', 8, 60),
    ('2025-08-16', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-08-16', 'Workout A', 'Bent Over Row', 'Barbell', 8, 45),
    ('2025-08-16', 'Workout A', 'Bent Over Row', 'Barbell', 8, 52),
    ('2025-08-16', 'Workout A', 'Bent Over Row', 'Barbell', 8, 52),
    ('2025-08-16', 'Workout A', 'Bent Over Row', 'Barbell', 7, 57),
    ('2025-08-16', 'Workout A', 'Seated Leg Curl', 'Machine', 8, 39),
    ('2025-08-16', 'Workout A', 'Seated Leg Curl', 'Machine', 8, 39),
    ('2025-08-16', 'Workout A', 'Seated Leg Curl', 'Machine', 8, 39),
    ('2025-08-16', 'Workout A', 'Seated Leg Curl', 'Machine', 8, 45),
    ('2025-08-16', 'Workout A', 'Seated Leg Curl', 'Machine', 8, 45),
    -- ===== 2025-08-02 (Workout A) =====
    ('2025-08-02', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-02', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-02', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 8, 32),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 8, 32),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 8, 40),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 8, 40),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 5, 44),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 5, 44),
    ('2025-08-02', 'Workout A', 'Bench Press', 'Barbell', 3, 44),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 10),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-08-02', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-08-02', 'Workout A', 'Seated Incline Curl', 'Dumbbell', 8, 20),
    ('2025-08-02', 'Workout A', 'Seated Incline Curl', 'Dumbbell', 8, 16),
    ('2025-08-02', 'Workout A', 'Seated Incline Curl', 'Dumbbell', 8, 16),
    ('2025-08-02', 'Workout A', 'Seated Incline Curl', 'Dumbbell', 8, 16),
    -- ===== 2025-07-30 (Workout B) =====
    ('2025-07-30', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-07-30', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-07-30', 'Workout B', 'Squat', 'Barbell', 5, 60),
    ('2025-07-30', 'Workout B', 'Squat', 'Barbell', 8, 60),
    ('2025-07-30', 'Workout B', 'Squat', 'Barbell', 8, 60),
    ('2025-07-30', 'Workout B', 'Deadlift', 'Barbell', 8, 50),
    ('2025-07-30', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-07-30', 'Workout B', 'Deadlift', 'Barbell', 8, 80),
    ('2025-07-30', 'Workout B', 'Deadlift', 'Barbell', 8, 80),
    -- ===== 2025-07-27 (Workout A) =====
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 8, 35),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 5, 50),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-27', 'Workout A', 'Squat', 'Barbell', 8, 60),
    ('2025-07-27', 'Workout A', 'Bench Press', 'Barbell', 8, 24),
    ('2025-07-27', 'Workout A', 'Bench Press', 'Barbell', 8, 36),
    ('2025-07-27', 'Workout A', 'Bench Press', 'Barbell', 5, 40),
    ('2025-07-27', 'Workout A', 'Bench Press', 'Barbell', 5, 44),
    ('2025-07-27', 'Workout A', 'Bench Press', 'Barbell', 5, 44),
    ('2025-07-27', 'Workout A', 'Bent Over Row', 'Barbell', 8, 45),
    ('2025-07-27', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-07-27', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-07-27', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-07-27', 'Workout A', 'Bent Over Row', 'Barbell', 5, 57),
    ('2025-07-27', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-07-27', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-07-27', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-07-27', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    ('2025-07-27', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 16),
    -- ===== 2025-07-23 (Workout A) =====
    ('2025-07-23', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-07-23', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-07-23', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-07-23', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-07-23', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-07-23', 'Workout A', 'Bench Press', 'Barbell', 8, 24),
    ('2025-07-23', 'Workout A', 'Bench Press', 'Barbell', 8, 32),
    ('2025-07-23', 'Workout A', 'Bench Press', 'Barbell', 8, 32),
    ('2025-07-23', 'Workout A', 'Bench Press', 'Barbell', 5, 36),
    ('2025-07-23', 'Workout A', 'Bench Press', 'Barbell', 5, 36),
    ('2025-07-23', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 10),
    ('2025-07-23', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-07-23', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-07-23', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-07-23', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-07-23', 'Workout A', 'Overhead Press', 'Barbell', 8, 15),
    ('2025-07-23', 'Workout A', 'Overhead Press', 'Barbell', 8, 20),
    ('2025-07-23', 'Workout A', 'Overhead Press', 'Barbell', 8, 20),
    ('2025-07-23', 'Workout A', 'Overhead Press', 'Barbell', 8, 20),
    ('2025-07-23', 'Workout A', 'Overhead Press', 'Barbell', 8, 20),
    -- ===== 2025-07-19 (Workout A) =====
    ('2025-07-19', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-07-19', 'Workout A', 'Squat', 'Barbell', 5, 50),
    ('2025-07-19', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-19', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-07-19', 'Workout A', 'Bench Press', 'Barbell', 8, 40),
    ('2025-07-19', 'Workout A', 'Bench Press', 'Barbell', 1, 50),
    ('2025-07-19', 'Workout A', 'Bench Press', 'Barbell', 5, 35),
    ('2025-07-19', 'Workout A', 'Bench Press', 'Barbell', 5, 35),
    ('2025-07-19', 'Workout A', 'Deadlift', 'Barbell', 8, 30),
    ('2025-07-19', 'Workout A', 'Deadlift', 'Barbell', 8, 50),
    ('2025-07-19', 'Workout A', 'Deadlift', 'Barbell', 5, 70),
    ('2025-07-19', 'Workout A', 'Deadlift', 'Barbell', 5, 90),
    -- ===== 2025-06-28 (Workout A) =====
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 8, 55),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 8, 55),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 5, 55),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 5, 55),
    ('2025-06-28', 'Workout A', 'Squat', 'Barbell', 5, 55),
    ('2025-06-28', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-06-28', 'Workout A', 'Bench Press', 'Barbell', 8, 40),
    ('2025-06-28', 'Workout A', 'Bench Press', 'Barbell', 6, 40),
    ('2025-06-28', 'Workout A', 'Bench Press', 'Barbell', 3, 40),
    ('2025-06-28', 'Workout A', 'Bench Press', 'Barbell', 5, 32),
    ('2025-06-28', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-06-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-06-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-06-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-06-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 45),
    ('2025-06-28', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-06-28', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-06-28', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-06-28', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-06-28', 'Workout A', 'Bicep Curl', 'Dumbbell', 5, 14),
    -- ===== 2025-06-15 (Workout B) =====
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-06-15', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 8, 50),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-06-15', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-06-15', 'Workout B', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-06-15', 'Workout B', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-06-15', 'Workout B', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-06-15', 'Workout B', 'Bent Over Row', 'Barbell', 5, 52),
    -- ===== 2025-05-31 (Workout B) =====
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 8, 50),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-31', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-31', 'Workout B', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-05-31', 'Workout B', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-05-31', 'Workout B', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-05-31', 'Workout B', 'Bicep Curl', 'Dumbbell', 5, 14),
    ('2025-05-31', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-31', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-31', 'Workout B', 'Bench Press', 'Barbell', 5, 44),
    ('2025-05-31', 'Workout B', 'Bench Press', 'Barbell', 4, 44),
    ('2025-05-31', 'Workout B', 'Bench Press', 'Barbell', 5, 36),
    -- ===== 2025-05-28 (Workout A) =====
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-05-28', 'Workout A', 'Squat', 'Barbell', 5, 40),
    ('2025-05-28', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-05-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 59),
    ('2025-05-28', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    -- ===== 2025-05-24 (Workout B) =====
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 50),
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-24', 'Workout B', 'Deadlift', 'Barbell', 5, 80),
    ('2025-05-24', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-05-24', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-05-24', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-05-24', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-05-24', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 8, 32),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 8, 32),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-24', 'Workout B', 'Bench Press', 'Barbell', 4, 40),
    -- ===== 2025-05-18 (Workout B) =====
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 5, 50),
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 5, 40),
    ('2025-05-18', 'Workout B', 'Squat', 'Barbell', 5, 40),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 8, 23),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 5, 27),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 5, 32),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 5, 32),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 5, 32),
    ('2025-05-18', 'Workout B', 'Overhead Press', 'Barbell', 5, 32),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 8, 32),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 5, 36),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 5, 40),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 5, 36),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 5, 36),
    ('2025-05-18', 'Workout B', 'Bench Press', 'Barbell', 5, 36),
    -- ===== 2025-05-11 (Workout A) =====
    ('2025-05-11', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-11', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-11', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-11', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-11', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 8, 36),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 8, 36),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 5, 36),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-05-11', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-05-11', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-05-11', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-11', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-11', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-11', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-05-11', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-05-11', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-05-11', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-05-11', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-05-11', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    -- ===== 2025-04-22 (Workout A) =====
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 8, 50),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 7, 60),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 5, 60),
    ('2025-04-22', 'Workout A', 'Squat', 'Barbell', 5, 50),
    ('2025-04-22', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-04-22', 'Workout A', 'Bent Over Row', 'Barbell', 8, 45),
    ('2025-04-22', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-04-22', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-04-22', 'Workout A', 'Bent Over Row', 'Barbell', 5, 52),
    ('2025-04-22', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-04-22', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-04-22', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 14),
    ('2025-04-22', 'Workout A', 'Bicep Curl', 'Dumbbell', 6, 14),
    ('2025-04-22', 'Workout A', 'Bicep Curl', 'Dumbbell', 8, 12),
    -- ===== 2025-04-13 (Workout B) =====
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 35),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 35),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 45),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 45),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 45),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 45),
    ('2025-04-13', 'Workout B', 'Squat', 'Barbell', 8, 45),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 50),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    ('2025-04-13', 'Workout B', 'Deadlift', 'Barbell', 5, 70),
    -- ===== 2025-04-07 (Workout A) =====
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-04-07', 'Workout A', 'Squat', 'Barbell', 5, 40),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 6, 40),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 5, 40),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 4, 40),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 6, 36),
    ('2025-04-07', 'Workout A', 'Bench Press', 'Barbell', 5, 32),
    -- ===== 2025-04-02 (Workout B) =====
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 8, 30),
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 10, 30),
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 8, 50),
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 4, 50),
    ('2025-04-02', 'Workout B', 'Squat', 'Barbell', 8, 40),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 8, 23),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 8, 23),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 5, 27),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 5, 27),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 5, 27),
    ('2025-04-02', 'Workout B', 'Overhead Press', 'Barbell', 5, 27),
    ('2025-04-02', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-04-02', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-04-02', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    ('2025-04-02', 'Workout B', 'Bicep Curl', 'Dumbbell', 8, 12),
    -- ===== 2025-03-29 (Workout A) =====
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 30),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, 40),
    ('2025-03-29', 'Workout A', 'Squat', 'Barbell', 8, NULL),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 8, 28),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 5, 36),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 5, 40),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 5, 40),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 4, 40),
    ('2025-03-29', 'Workout A', 'Bench Press', 'Barbell', 6, 32),
    ('2025-03-29', 'Workout A', 'Bent Over Row', 'Barbell', 8, 39),
    ('2025-03-29', 'Workout A', 'Bent Over Row', 'Barbell', 7, 45),
    ('2025-03-29', 'Workout A', 'Bent Over Row', 'Barbell', 7, 45),
    ('2025-03-29', 'Workout A', 'Bent Over Row', 'Barbell', 7, 45),
    ('2025-03-29', 'Workout A', 'Bent Over Row', 'Barbell', 7, 39)
  ;

  -- --------------------------------------------------------------------------
  -- 1. Ensure equipment options exist in user_field_options.
  --
  -- The `exercises.equipment` column stores a KEY (e.g. 'barbell'). The
  -- matching label lives in `user_field_options` (kind='equipment'). We need
  -- both — without the option row the UI has nothing to render as the tag
  -- label, so the equipment chip would just show the raw key.
  --
  -- Insert idempotently: skip any (kind='equipment', key) that already
  -- exists for this user under parent_id IS NULL. Position is appended
  -- after the user's existing equipment options.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _equipment (
    key text PRIMARY KEY,
    label text NOT NULL
  ) ON COMMIT DROP;

  -- Equipment key = lower(label) with spaces preserved — matches the slug
  -- format used by the default options seeded at signup (e.g. 'smith machine',
  -- not 'smith-machine'), so existing defaults are reused when keys match.
  INSERT INTO _equipment (key, label)
  SELECT DISTINCT LOWER(equipment_label), equipment_label
  FROM _import
  WHERE equipment_label IS NOT NULL;

  WITH existing_max AS (
    SELECT COALESCE(MAX(position), -1) AS max_pos
    FROM user_field_options
    WHERE user_id = target_user_id
      AND kind = 'equipment'
      AND parent_id IS NULL
  ),
  missing AS (
    SELECT
      e.key,
      e.label,
      row_number() OVER (ORDER BY e.key) AS rn
    FROM _equipment e
    WHERE NOT EXISTS (
      SELECT 1 FROM user_field_options ufo
      WHERE ufo.user_id = target_user_id
        AND ufo.kind = 'equipment'
        AND ufo.parent_id IS NULL
        AND ufo.key = e.key
    )
  )
  INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
  SELECT
    gen_random_uuid(),
    target_user_id,
    'equipment',
    NULL,
    m.key,
    m.label,
    (SELECT max_pos FROM existing_max) + m.rn,
    NOW()
  FROM missing m;

  GET DIAGNOSTICS imported_equipment_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 2. Insert missing exercises.
  --
  -- Match against user's existing library by (LOWER(name), equipment key).
  -- New exercises get track_reps=true, all other tracking flags off,
  -- is_bodyweight=false. equipment column stores the slug key.
  --
  -- Categories + muscles are looked up per (name, equipment) from the
  -- `exercise_meta` literal table below. Keys here ('resistance', 'legs',
  -- 'chest', 'upper back', 'shoulders', 'arms') match the defaults seeded
  -- at signup (src/lib/exercise-options.ts).
  --
  -- DISTINCT ON ((LOWER(name), equipment)) collapses any duplicate
  -- (name, equipment) pairs in staging to a single canonical row.
  -- --------------------------------------------------------------------------
  WITH distinct_imports AS (
    SELECT DISTINCT ON (LOWER(i.exercise_name), LOWER(COALESCE(i.equipment_label, '')))
      i.exercise_name AS new_name,
      CASE
        WHEN i.equipment_label IS NULL THEN NULL
        ELSE LOWER(i.equipment_label)
      END AS equip_key
    FROM _import i
    ORDER BY
      LOWER(i.exercise_name),
      LOWER(COALESCE(i.equipment_label, '')),
      i.rownum
  ),
  -- double_reps=true means the user logs reps-per-side (dumbbell exercises),
  -- so the displayed total is doubled.
  exercise_meta(name_lower, equip_key, categories, muscles, double_reps) AS (
    VALUES
      ('squat',               'barbell',        ARRAY['resistance'], ARRAY['legs'],            false),
      ('squat',               'machine',        ARRAY['resistance'], ARRAY['legs'],            false),
      ('squat',               'smith machine',  ARRAY['resistance'], ARRAY['legs'],            false),
      ('bench press',         'barbell',        ARRAY['resistance'], ARRAY['chest'],           false),
      ('seated row',          'machine',        ARRAY['resistance'], ARRAY['upper back'],     false),
      ('shoulder press',      'machine plates', ARRAY['resistance'], ARRAY['shoulders'],      false),
      ('deadlift',            'barbell',        ARRAY['resistance'], ARRAY['legs', 'upper back'], false),
      ('romanian deadlift',   'barbell',        ARRAY['resistance'], ARRAY['legs'],            false),
      ('bicep curl',          'barbell',        ARRAY['resistance'], ARRAY['arms'],            false),
      ('bicep curl',          'dumbbell',       ARRAY['resistance'], ARRAY['arms'],            true),
      ('chest press',         'machine',        ARRAY['resistance'], ARRAY['chest'],           false),
      ('bent over row',       'barbell',        ARRAY['resistance'], ARRAY['upper back'],     false),
      ('seated leg curl',     'machine',        ARRAY['resistance'], ARRAY['legs'],            false),
      ('seated incline curl', 'dumbbell',       ARRAY['resistance'], ARRAY['arms'],            true),
      ('overhead press',      'barbell',        ARRAY['resistance'], ARRAY['shoulders'],      false)
  ),
  missing AS (
    SELECT
      di.new_name,
      di.equip_key,
      em.categories,
      em.muscles,
      COALESCE(em.double_reps, false) AS double_reps
    FROM distinct_imports di
    LEFT JOIN exercise_meta em
      ON em.name_lower = LOWER(di.new_name)
     AND em.equip_key IS NOT DISTINCT FROM di.equip_key
    WHERE NOT EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.user_id = target_user_id
        AND LOWER(e.name) = LOWER(di.new_name)
        AND e.equipment IS NOT DISTINCT FROM di.equip_key
    )
  )
  -- All tracking flags are BOOLEAN in the Postgres schema EXCEPT
  -- track_calories, which is INTEGER (added later with a different type).
  INSERT INTO exercises (
    id, user_id, name, categories, equipment,
    is_bodyweight, track_reps, default_weight_kg, double_reps,
    distance_unit, track_time, time_unit,
    track_resistance, track_speed, speed_unit,
    track_incline, incline_unit, track_rest, track_calories,
    muscles, secondary_muscles, created_at
  )
  SELECT
    gen_random_uuid(),
    target_user_id,
    new_name,
    categories,                    -- categories (text[])
    equip_key,                     -- equipment (slug key)
    false,                         -- is_bodyweight
    true,                          -- track_reps
    0,                             -- default_weight_kg
    double_reps,                   -- double_reps (true for dumbbell exercises)
    NULL,                          -- distance_unit
    false,                         -- track_time
    NULL,                          -- time_unit
    false,                         -- track_resistance
    false,                         -- track_speed
    NULL,                          -- speed_unit
    false,                         -- track_incline
    NULL,                          -- incline_unit
    false,                         -- track_rest
    0,                             -- track_calories (INTEGER, not bool)
    muscles,                       -- muscles (text[], parent groups only)
    NULL,                          -- secondary_muscles
    NOW()
  FROM missing;

  GET DIAGNOSTICS imported_exercise_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 3. Insert workouts (one per distinct date, name from staging title).
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _workout_map (
    performed_on date PRIMARY KEY,
    workout_id uuid NOT NULL
  ) ON COMMIT DROP;

  WITH per_date AS (
    -- One title per date. If the same date somehow had multiple titles
    -- in staging (shouldn't, per CSV inspection) the earliest rownum wins.
    SELECT DISTINCT ON (performed_on) performed_on, workout_name
    FROM _import
    ORDER BY performed_on, rownum
  ),
  ins AS (
    INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      target_user_id,
      d.workout_name,
      d.performed_on,
      'workout',
      NULL,
      NOW(),
      NOW()
    FROM per_date d
    RETURNING id, performed_on
  )
  INSERT INTO _workout_map (performed_on, workout_id)
  SELECT performed_on, id FROM ins;

  GET DIAGNOSTICS imported_workout_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 4. Build (name, equipment) → exercise_id lookup. Picks the oldest row
  --    (by created_at) when the user's library has duplicates under the
  --    same composite key, for determinism.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _exercise_map (
    name_lower text NOT NULL,
    equip_key text,                -- nullable; matches with IS NOT DISTINCT FROM
    exercise_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _exercise_map (name_lower, equip_key, exercise_id)
  SELECT DISTINCT ON (LOWER(e.name), e.equipment)
    LOWER(e.name),
    e.equipment,
    e.id
  FROM exercises e
  WHERE e.user_id = target_user_id
  ORDER BY LOWER(e.name), e.equipment, e.created_at ASC, e.id ASC;

  -- --------------------------------------------------------------------------
  -- 5. Insert sets. Position is 0-indexed across the workout, derived from
  --    import row order so exercise grouping is preserved.
  -- --------------------------------------------------------------------------
  WITH numbered AS (
    SELECT
      i.rownum,
      i.performed_on,
      i.exercise_name,
      CASE
        WHEN i.equipment_label IS NULL THEN NULL
        ELSE LOWER(i.equipment_label)
      END AS equip_key,
      i.reps,
      i.weight_kg,
      (row_number() OVER (PARTITION BY i.performed_on ORDER BY i.rownum) - 1)::int AS position
    FROM _import i
  )
  INSERT INTO sets (
    id, user_id, performed_on, workout_id, exercise_id, position,
    reps, weight_kg, distance_km, duration_sec,
    resistance, speed_ms, incline_pct, rest_sec,
    circuit_id, circuit_rounds, circuit_name
  )
  SELECT
    gen_random_uuid(),
    target_user_id,
    n.performed_on,
    wm.workout_id,
    em.exercise_id,
    n.position,
    n.reps,
    n.weight_kg,
    NULL, NULL,             -- distance_km, duration_sec
    NULL, NULL, NULL, NULL, -- resistance, speed_ms, incline_pct, rest_sec
    NULL, NULL, NULL        -- circuit_id, circuit_rounds, circuit_name
  FROM numbered n
  JOIN _workout_map wm ON wm.performed_on = n.performed_on
  JOIN _exercise_map em
    ON em.name_lower = LOWER(n.exercise_name)
   AND em.equip_key IS NOT DISTINCT FROM n.equip_key
  ORDER BY n.performed_on, n.rownum;

  GET DIAGNOSTICS imported_set_count = ROW_COUNT;

  RAISE NOTICE 'Imported % equipment option(s), % new exercise(s), % workout(s), % set(s).',
    imported_equipment_count, imported_exercise_count, imported_workout_count, imported_set_count;

END
$migration$;

COMMIT;
