-- ============================================================================
-- FitNotes → Squad migration
-- ============================================================================
-- One-shot import of a user's FitNotes workout history (2025-11-02 → 2026-05-13)
-- into a Squad user account.
--
-- USAGE
--   1. Replace the literal UUID on the `target_user_id` line below.
--   2. Paste the entire file into the Supabase SQL editor and Run.
--   3. Everything is wrapped in a transaction (BEGIN / COMMIT). If anything
--      fails the whole thing aborts cleanly.
--
-- BEHAVIOUR
--   - Exercises: matched case-insensitively against the user's existing
--     library. Missing exercises are inserted with track_reps=true and
--     all other tracking flags off. Bodyweight exercises (Pull Up,
--     Negative Pull Up, Parallel Bar Triceps Dip, Hanging Knee Raise,
--     Ab-Wheel Rollout, Crunch, Decline Crunch, Ball Crunch) are marked
--     is_bodyweight=true so weight_kg represents body weight + load.
--     equipment / categories / muscles are left NULL — you'll add these
--     manually in the app post-import.
--   - Case-insensitive dedup is defensive on both sides: if the import
--     somehow contained two name variants (e.g. "Pull Up" and "pull up")
--     only one exercise is created; sets for either variant attach to it.
--     If the user's library already contains case-variant duplicates the
--     oldest row (by created_at) is treated as the canonical target.
--   - Workouts: one row per distinct date, name='Gym',
--     session_type='workout'. No dedup against existing workouts —
--     if you re-run on dates that already have data, you'll get
--     duplicate workout sessions.
--   - Sets: position is 0-indexed across the entire workout (matches
--     saveWorkout / copyFriendSession). user_id and performed_on are
--     populated explicitly even though the Postgres trigger would
--     maintain them — defensive in case the trigger isn't installed.
--
-- CLEANUP / NORMALIZATION applied to exercise names from the export:
--   "Smith bench pPress"    → "Smith Bench Press"
--   "Ez-Bar Standing Curl"  → "EZ-Bar Standing Curl"
--   "Ez Bar Curl Narrow Grip" → "EZ-Bar Curl Narrow Grip"
--   All other names preserved verbatim, including:
--     - "Overhead Sat Down …" (the user's phrasing for Seated)
--     - "Seated Machine Fly Kentish Town" (location qualifier — distinct
--       machine from plain "Seated Machine Fly")
--     - "Romanian Deadlift" vs "Romanian Deadlift Box" (different
--       exercises)
-- ============================================================================

BEGIN;

DO $migration$
DECLARE
  -- ▼▼▼ REPLACE THIS WITH THE TARGET USER'S UUID ▼▼▼
  target_user_id uuid := 'e6eec62f-0a83-4635-9686-3ad2328d200a';
  -- ▲▲▲ REPLACE THIS WITH THE TARGET USER'S UUID ▲▲▲

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
    exercise_name text NOT NULL,
    reps int,
    weight_kg numeric
  ) ON COMMIT DROP;

  INSERT INTO _import (performed_on, exercise_name, reps, weight_kg) VALUES
    -- ===== 2025-11-02 =====
    ('2025-11-02', 'Deadlift', 5, 70.0),
    ('2025-11-02', 'Deadlift', 5, 90.0),
    ('2025-11-02', 'Deadlift', 5, 110.0),
    ('2025-11-02', 'Deadlift', 1, 130.0),
    ('2025-11-02', 'Deadlift', 5, 110.0),
    ('2025-11-02', 'Barbell Squat', 5, 50.0),
    ('2025-11-02', 'Barbell Squat', 5, 60.0),
    ('2025-11-02', 'Barbell Squat', 5, 70.0),
    ('2025-11-02', 'Barbell Squat', 5, 70.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 5, 50.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 5, 60.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 5, 70.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 1, 80.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 5, 70.0),
    ('2025-11-02', 'Flat Barbell Bench Press', 5, 60.0),

    -- ===== 2025-11-10 =====
    ('2025-11-10', 'Deadlift', 5, 70.0),
    ('2025-11-10', 'Deadlift', 5, 80.0),
    ('2025-11-10', 'Deadlift', 5, 90.0),
    ('2025-11-10', 'Deadlift', 5, 100.0),
    ('2025-11-10', 'Deadlift', 2, 110.0),
    ('2025-11-10', 'Deadlift', 5, 90.0),
    ('2025-11-10', 'Barbell Squat', 5, 20.0),
    ('2025-11-10', 'Barbell Squat', 5, 40.0),
    ('2025-11-10', 'Barbell Squat', 5, 50.0),
    ('2025-11-10', 'Barbell Squat', 5, 60.0),
    ('2025-11-10', 'Barbell Squat', 5, 80.0),
    ('2025-11-10', 'Smith Bench Press', 5, 20.0),
    ('2025-11-10', 'Smith Bench Press', 5, 50.0),
    ('2025-11-10', 'Smith Bench Press', 5, 60.0),
    ('2025-11-10', 'Smith Bench Press', 5, 70.0),
    ('2025-11-10', 'Smith Bench Press', 5, 80.0),

    -- ===== 2025-11-24 =====
    ('2025-11-24', 'Deadlift', 5, 60.0),
    ('2025-11-24', 'Deadlift', 5, 80.0),
    ('2025-11-24', 'Deadlift', 5, 100.0),
    ('2025-11-24', 'Deadlift', 5, 110.0),
    ('2025-11-24', 'Deadlift', 5, 115.0),
    ('2025-11-24', 'Smith Bench Press', 5, 20.0),
    ('2025-11-24', 'Smith Bench Press', 5, 70.0),
    ('2025-11-24', 'Smith Bench Press', 5, 80.0),
    ('2025-11-24', 'Smith Bench Press', 1, 85.0),

    -- ===== 2025-11-25 =====
    ('2025-11-25', 'Seated Machine Row', 5, 27.0),
    ('2025-11-25', 'Seated Machine Row', 5, 41.0),
    ('2025-11-25', 'Seated Machine Row', 5, 55.0),
    ('2025-11-25', 'Seated Machine Row', 5, 64.0),
    ('2025-11-25', 'Seated Machine Row', 5, 64.0),
    ('2025-11-25', 'Seated Machine Row', 5, 72.6),
    ('2025-11-25', 'Seated Machine Row', 5, 81.65),
    ('2025-11-25', 'Lat Pulldown', 5, 11.0),
    ('2025-11-25', 'Lat Pulldown', 5, 45.36),
    ('2025-11-25', 'Lat Pulldown', 5, 59.0),
    ('2025-11-25', 'Lat Pulldown', 5, 73.0),
    ('2025-11-25', 'Dumbbell Row', 5, 12.5),
    ('2025-11-25', 'Dumbbell Row', 5, 15.0),
    ('2025-11-25', 'Dumbbell Row', 5, 20.0),
    ('2025-11-25', 'Dumbbell Row', 6, 25.0),
    ('2025-11-25', 'Dumbbell Row', 5, 30.0),
    ('2025-11-25', 'Pull Up', 5, 90.6),
    ('2025-11-25', 'Pull Up', 3, 90.6),
    ('2025-11-25', 'Pull Up', 3, 90.6),

    -- ===== 2025-11-26 =====
    ('2025-11-26', 'Smith Bench Press', 5, 20.0),
    ('2025-11-26', 'Smith Bench Press', 5, 70.0),
    ('2025-11-26', 'Smith Bench Press', 5, 75.0),
    ('2025-11-26', 'Smith Bench Press', 5, 80.0),
    ('2025-11-26', 'Smith Incline Bench Press', 5, 30.0),
    ('2025-11-26', 'Smith Incline Bench Press', 5, 40.0),
    ('2025-11-26', 'Smith Incline Bench Press', 5, 60.0),
    ('2025-11-26', 'Smith Incline Bench Press', 5, 70.0),
    ('2025-11-26', 'Smith Incline Bench Press', 5, 75.0),
    ('2025-11-26', 'Flat Dumbbell Fly', 5, 2.5),
    ('2025-11-26', 'Flat Dumbbell Fly', 5, 7.5),
    ('2025-11-26', 'Flat Dumbbell Fly', 5, 10.0),
    ('2025-11-26', 'Flat Dumbbell Fly', 5, 15.0),

    -- ===== 2025-11-27 =====
    ('2025-11-27', 'Overhead Dumbbell Press', 8, 7.5),
    ('2025-11-27', 'Overhead Dumbbell Press', 8, 12.5),
    ('2025-11-27', 'Overhead Dumbbell Press', 8, 15.0),
    ('2025-11-27', 'Overhead Dumbbell Press', 8, 17.5),
    ('2025-11-27', 'Lateral Dumbbell Raise', 8, 5.0),
    ('2025-11-27', 'Lateral Dumbbell Raise', 8, 10.0),
    ('2025-11-27', 'Lateral Dumbbell Raise', 8, 15.0),
    ('2025-11-27', 'Front Dumbbell Raise', 8, 5.0),
    ('2025-11-27', 'Front Dumbbell Raise', 8, 7.5),
    ('2025-11-27', 'Front Dumbbell Raise', 8, 12.5),
    ('2025-11-27', 'Hanging Knee Raise', 12, 90.8),
    ('2025-11-27', 'Hanging Knee Raise', 12, 90.8),
    ('2025-11-27', 'Ab-Wheel Rollout', 10, 90.8),
    ('2025-11-27', 'Ab-Wheel Rollout', 10, 90.8),
    ('2025-11-27', 'Ab-Wheel Rollout', 10, 90.8),
    ('2025-11-27', 'Ball Crunch', 10, 4.0),
    ('2025-11-27', 'Ball Crunch', 10, 6.0),
    ('2025-11-27', 'Ball Crunch', 10, 8.0),
    ('2025-11-27', 'Ball Crunch', 10, 12.0),
    ('2025-11-27', 'Crunch', 10, NULL),
    ('2025-11-27', 'Crunch', 10, 6.0),
    ('2025-11-27', 'Crunch', 10, 8.0),
    ('2025-11-27', 'Crunch', 10, 12.0),

    -- ===== 2025-11-28 =====
    ('2025-11-28', 'Sledge Push', 3, 55.0),
    ('2025-11-28', 'Sledge Push', 2, 55.0),
    ('2025-11-28', 'Wall Ball', 10, 6.0),
    ('2025-11-28', 'Wall Ball', 7, 6.0),
    ('2025-11-28', 'Wall Ball', 7, 6.0),
    ('2025-11-28', 'Wall Ball', 7, 6.0),
    ('2025-11-28', 'Deadlift', 3, 80.0),
    ('2025-11-28', 'Deadlift', 3, 100.0),
    ('2025-11-28', 'Deadlift', 3, 120.0),
    ('2025-11-28', 'Deadlift', 3, 130.0),
    ('2025-11-28', 'Deadlift', 3, 100.0),
    ('2025-11-28', 'Deadlift', 3, 100.0),
    ('2025-11-28', 'Barbell Squat', 5, 20.0),
    ('2025-11-28', 'Barbell Squat', 5, 60.0),
    ('2025-11-28', 'Barbell Squat', 5, 80.0),
    ('2025-11-28', 'Barbell Squat', 5, 85.0),
    ('2025-11-28', 'Flat Barbell Bench Press', 5, 60.0),
    ('2025-11-28', 'Flat Barbell Bench Press', 5, 75.0),
    ('2025-11-28', 'Flat Barbell Bench Press', 4, 80.0),
    ('2025-11-28', 'Flat Barbell Bench Press', 1, 85.0),

    -- ===== 2025-12-01 =====
    ('2025-12-01', 'Overhead Dumbbell Press', 10, 10.0),
    ('2025-12-01', 'Overhead Dumbbell Press', 8, 15.0),
    ('2025-12-01', 'Overhead Dumbbell Press', 8, 17.5),
    ('2025-12-01', 'Overhead Dumbbell Press', 8, 20.0),
    ('2025-12-01', 'Lateral Dumbbell Raise', 8, 7.5),
    ('2025-12-01', 'Lateral Dumbbell Raise', 8, 10.0),
    ('2025-12-01', 'Lateral Dumbbell Raise', 8, 12.5),
    ('2025-12-01', 'Front Dumbbell Raise', 8, 5.0),
    ('2025-12-01', 'Front Dumbbell Raise', 8, 10.0),
    ('2025-12-01', 'Front Dumbbell Raise', 8, 12.5),
    ('2025-12-01', 'Parallel Bar Triceps Dip', 8, 57.0),
    ('2025-12-01', 'Parallel Bar Triceps Dip', 8, 70.0),
    ('2025-12-01', 'Parallel Bar Triceps Dip', 8, 79.0),
    ('2025-12-01', 'Cable Pull Down', 8, 23.0),
    ('2025-12-01', 'Cable Pull Down', 8, 40.0),
    ('2025-12-01', 'Cable Pull Down', 8, 50.0),
    ('2025-12-01', 'Cable Pull Down', 8, 59.0),
    ('2025-12-01', 'Cable Curl', 8, 23.0),
    ('2025-12-01', 'Cable Curl', 8, 32.0),
    ('2025-12-01', 'Cable Curl', 8, 41.0),
    ('2025-12-01', 'Dumbbell Curl', 8, 15.0),
    ('2025-12-01', 'Dumbbell Curl', 8, 17.5),
    ('2025-12-01', 'Dumbbell Curl', 8, 20.0),

    -- ===== 2025-12-03 =====
    ('2025-12-03', 'Seated Leg Curl Machine', 8, 23.0),
    ('2025-12-03', 'Seated Leg Curl Machine', 9, 32.0),
    ('2025-12-03', 'Seated Leg Curl Machine', 8, 41.0),
    ('2025-12-03', 'Leg Extension Machine', 8, 23.0),
    ('2025-12-03', 'Leg Extension Machine', 8, 36.0),
    ('2025-12-03', 'Leg Extension Machine', 8, 45.0),
    ('2025-12-03', 'Leg Press', 8, 45.0),
    ('2025-12-03', 'Leg Press', 8, 66.0),
    ('2025-12-03', 'Leg Press', 8, 86.0),
    ('2025-12-03', 'Barbell Squat', 5, 20.0),
    ('2025-12-03', 'Barbell Squat', 5, 70.0),
    ('2025-12-03', 'Barbell Squat', 5, 75.0),
    ('2025-12-03', 'Barbell Squat', 5, 90.0),
    ('2025-12-03', 'Romanian Deadlift', 5, 20.0),
    ('2025-12-03', 'Romanian Deadlift', 5, 50.0),
    ('2025-12-03', 'Romanian Deadlift', 5, 70.0),
    ('2025-12-03', 'Romanian Deadlift', 5, 90.0),

    -- ===== 2025-12-05 =====
    ('2025-12-05', 'Smith Bench Press', 5, 25.0),
    ('2025-12-05', 'Smith Bench Press', 5, 60.0),
    ('2025-12-05', 'Smith Bench Press', 5, 70.0),
    ('2025-12-05', 'Smith Incline Bench Press', 5, 60.0),
    ('2025-12-05', 'Smith Incline Bench Press', 5, 70.0),
    ('2025-12-05', 'Smith Incline Bench Press', 2, 80.0),
    ('2025-12-05', 'Smith Incline Bench Press', 5, 70.0),
    ('2025-12-05', 'Overhead Sat Down Dumbbell Press', 8, 10.0),
    ('2025-12-05', 'Overhead Sat Down Dumbbell Press', 8, 15.0),
    ('2025-12-05', 'Overhead Sat Down Dumbbell Press', 8, 17.5),
    ('2025-12-05', 'Overhead Sat Down Dumbbell Press', 8, 20.0),
    ('2025-12-05', 'Lateral Dumbbell Raise', 8, 10.0),
    ('2025-12-05', 'Lateral Dumbbell Raise', 8, 12.5),
    ('2025-12-05', 'Lateral Dumbbell Raise', 8, 15.0),
    ('2025-12-05', 'Cable Pull Down', 10, 14.0),
    ('2025-12-05', 'Cable Pull Down', 10, 32.0),
    ('2025-12-05', 'Cable Pull Down', 10, 64.0),
    ('2025-12-05', 'Dumbbell Overhead Triceps Extension', 10, 17.5),
    ('2025-12-05', 'Dumbbell Overhead Triceps Extension', 10, 22.5),
    ('2025-12-05', 'Dumbbell Overhead Triceps Extension', 10, 25.0),

    -- ===== 2025-12-06 =====
    ('2025-12-06', 'Barbell Squat', 5, 20.0),
    ('2025-12-06', 'Barbell Squat', 5, 60.0),
    ('2025-12-06', 'Barbell Squat', 5, 70.0),
    ('2025-12-06', 'Barbell Squat', 5, 80.0),
    ('2025-12-06', 'Barbell Squat', 5, 90.0),
    ('2025-12-06', 'Barbell Squat', 5, 95.0),
    ('2025-12-06', 'Sumo Squat', 5, 60.0),
    ('2025-12-06', 'Sumo Squat', 5, 70.0),
    ('2025-12-06', 'Sumo Squat', 5, 80.0),
    ('2025-12-06', 'Romanian Deadlift', 5, 60.0),
    ('2025-12-06', 'Romanian Deadlift', 5, 80.0),
    ('2025-12-06', 'Romanian Deadlift', 5, 100.0),
    ('2025-12-06', 'Deadlift', 3, 80.0),
    ('2025-12-06', 'Deadlift', 3, 100.0),
    ('2025-12-06', 'Deadlift', 3, 120.0),
    ('2025-12-06', 'Deadlift', 3, 135.0),
    ('2025-12-06', 'Flat Barbell Bench Press', 5, 60.0),
    ('2025-12-06', 'Flat Barbell Bench Press', 5, 75.0),
    ('2025-12-06', 'Flat Barbell Bench Press', 3, 85.0),
    ('2025-12-06', 'Flat Barbell Bench Press', 2, 80.0),
    ('2025-12-06', 'Flat Barbell Bench Press', 4, 75.0),

    -- ===== 2025-12-08 =====
    ('2025-12-08', 'Deadlift', 3, 70.0),
    ('2025-12-08', 'Deadlift', 3, 90.0),
    ('2025-12-08', 'Deadlift', 3, 110.0),
    ('2025-12-08', 'Deadlift', 3, 130.0),
    ('2025-12-08', 'Deadlift', 1, 140.0),
    ('2025-12-08', 'Dumbbell Row', 8, 15.0),
    ('2025-12-08', 'Dumbbell Row', 8, 20.0),
    ('2025-12-08', 'Dumbbell Row', 8, 27.5),
    ('2025-12-08', 'Dumbbell Row', 8, 32.5),
    ('2025-12-08', 'Pull Up', 4, 92.7),
    ('2025-12-08', 'Pull Up', 4, 92.7),
    ('2025-12-08', 'Pull Up', 4, 92.7),
    ('2025-12-08', 'Seated Machine Row', 8, 69.0),
    ('2025-12-08', 'Seated Machine Row', 8, 77.0),
    ('2025-12-08', 'Seated Machine Row', 8, 86.2),
    ('2025-12-08', 'Dumbbell Curl', 8, 17.5),
    ('2025-12-08', 'Dumbbell Curl', 8, 20.0),
    ('2025-12-08', 'Dumbbell Curl', 8, 22.5),
    ('2025-12-08', 'Cable Curl', 8, 16.0),
    ('2025-12-08', 'Cable Curl', 8, 27.0),
    ('2025-12-08', 'Cable Curl', 8, 41.0),

    -- ===== 2025-12-11 =====
    ('2025-12-11', 'Smith Bench Press', 5, 20.0),
    ('2025-12-11', 'Smith Bench Press', 5, 60.0),
    ('2025-12-11', 'Smith Bench Press', 5, 70.0),
    ('2025-12-11', 'Smith Bench Press', 5, 80.0),
    ('2025-12-11', 'Smith Bench Press', 5, 90.0),
    ('2025-12-11', 'Smith Bench Press', 3, 95.0),
    ('2025-12-11', 'Smith Incline Bench Press', 5, 60.0),
    ('2025-12-11', 'Smith Incline Bench Press', 5, 80.0),
    ('2025-12-11', 'Smith Incline Bench Press', 5, 90.0),
    ('2025-12-11', 'Overhead Dumbbell Press', 8, 17.5),
    ('2025-12-11', 'Overhead Dumbbell Press', 10, 20.0),
    ('2025-12-11', 'Overhead Dumbbell Press', 8, 22.5),
    ('2025-12-11', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2025-12-11', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2025-12-11', 'Lateral Dumbbell Raise', 8, 15.0),
    ('2025-12-11', 'Cable Pull Down', 10, 37.0),
    ('2025-12-11', 'Cable Pull Down', 10, 50.0),
    ('2025-12-11', 'Cable Pull Down', 10, 68.0),
    ('2025-12-11', 'Dumbbell Overhead Triceps Extension', 10, 22.5),
    ('2025-12-11', 'Dumbbell Overhead Triceps Extension', 10, 25.0),
    ('2025-12-11', 'Dumbbell Overhead Triceps Extension', 10, 27.5),

    -- ===== 2025-12-15 =====
    ('2025-12-15', 'Barbell Squat', 5, 20.0),
    ('2025-12-15', 'Barbell Squat', 5, 60.0),
    ('2025-12-15', 'Barbell Squat', 5, 80.0),
    ('2025-12-15', 'Barbell Squat', 5, 90.0),
    ('2025-12-15', 'Barbell Squat', 3, 100.0),
    ('2025-12-15', 'Romanian Deadlift', 5, 20.0),
    ('2025-12-15', 'Romanian Deadlift', 5, 60.0),
    ('2025-12-15', 'Romanian Deadlift', 5, 80.0),
    ('2025-12-15', 'Romanian Deadlift', 5, 104.0),
    ('2025-12-15', 'Leg Press', 8, 20.0),
    ('2025-12-15', 'Leg Press', 8, 60.0),
    ('2025-12-15', 'Leg Press', 8, 80.0),
    ('2025-12-15', 'Leg Press', 10, 100.0),
    ('2025-12-15', 'Leg Press', 10, 110.0),
    ('2025-12-15', 'Lying Leg Curl Machine', 8, 30.0),
    ('2025-12-15', 'Lying Leg Curl Machine', 8, 40.0),
    ('2025-12-15', 'Lying Leg Curl Machine', 8, 45.0),
    ('2025-12-15', 'Leg Extension Machine', 8, 35.0),
    ('2025-12-15', 'Leg Extension Machine', 8, 45.0),
    ('2025-12-15', 'Leg Extension Machine', 10, 55.0),

    -- ===== 2025-12-19 =====
    ('2025-12-19', 'Barbell Squat', 5, 20.0),
    ('2025-12-19', 'Barbell Squat', 5, 70.0),
    ('2025-12-19', 'Barbell Squat', 5, 85.0),
    ('2025-12-19', 'Barbell Squat', 5, 100.0),
    ('2025-12-19', 'Barbell Squat', 5, 90.0),
    ('2025-12-19', 'Zercher Squat', 6, 20.0),
    ('2025-12-19', 'Zercher Squat', 5, 40.0),
    ('2025-12-19', 'Zercher Squat', 5, 50.0),
    ('2025-12-19', 'Zercher Squat', 5, 50.0),
    ('2025-12-19', 'Romanian Deadlift', 5, 50.0),
    ('2025-12-19', 'Romanian Deadlift', 5, 70.0),
    ('2025-12-19', 'Romanian Deadlift', 5, 90.0),
    ('2025-12-19', 'Romanian Deadlift', 5, 110.0),
    ('2025-12-19', 'Zercher Romanian Deadlift', 5, 20.0),
    ('2025-12-19', 'Zercher Romanian Deadlift', 5, 30.0),
    ('2025-12-19', 'Zercher Romanian Deadlift', 5, 40.0),
    ('2025-12-19', 'Deadlift', 3, 80.0),
    ('2025-12-19', 'Deadlift', 3, 100.0),
    ('2025-12-19', 'Deadlift', 3, 120.0),
    ('2025-12-19', 'Deadlift', 3, 120.0),
    ('2025-12-19', 'Flat Barbell Bench Press', 5, 65.0),
    ('2025-12-19', 'Flat Barbell Bench Press', 5, 75.0),
    ('2025-12-19', 'Flat Barbell Bench Press', 3, 85.0),
    ('2025-12-19', 'Flat Barbell Bench Press', 2, 80.0),
    ('2025-12-19', 'Flat Barbell Bench Press', 10, 60.0),

    -- ===== 2025-12-22 =====
    ('2025-12-22', 'Flat Barbell Bench Press', 5, 60.0),
    ('2025-12-22', 'Flat Barbell Bench Press', 5, 80.0),
    ('2025-12-22', 'Flat Barbell Bench Press', 3, 85.0),
    ('2025-12-22', 'Flat Barbell Bench Press', 3, 80.0),
    ('2025-12-22', 'Flat Barbell Bench Press', 5, 70.0),
    ('2025-12-22', 'Deadlift', 3, 40.0),
    ('2025-12-22', 'Deadlift', 3, 60.0),
    ('2025-12-22', 'Deadlift', 3, 100.0),
    ('2025-12-22', 'Deadlift', 3, 120.0),
    ('2025-12-22', 'Romanian Deadlift', 3, 60.0),
    ('2025-12-22', 'Romanian Deadlift', 5, 80.0),
    ('2025-12-22', 'Romanian Deadlift', 5, 90.0),
    ('2025-12-22', 'Sumo Deadlift', 5, 40.0),
    ('2025-12-22', 'Sumo Deadlift', 5, 60.0),
    ('2025-12-22', 'Sumo Deadlift', 5, 80.0),
    ('2025-12-22', 'Barbell Squat', 5, 60.0),
    ('2025-12-22', 'Barbell Squat', 5, 80.0),
    ('2025-12-22', 'Barbell Squat', 5, 90.0),

    -- ===== 2025-12-30 =====
    ('2025-12-30', 'Hack Squat', 10, 20.0),
    ('2025-12-30', 'Barbell Squat', 5, 20.0),
    ('2025-12-30', 'Barbell Squat', 5, 40.0),
    ('2025-12-30', 'Barbell Squat', 5, 60.0),
    ('2025-12-30', 'Barbell Squat', 5, 80.0),
    ('2025-12-30', 'Barbell Squat', 5, 80.0),
    ('2025-12-30', 'Romanian Deadlift', 5, 60.0),
    ('2025-12-30', 'Romanian Deadlift', 5, 80.0),
    ('2025-12-30', 'Romanian Deadlift', 5, 80.0),
    ('2025-12-30', 'Deadlift', 3, 80.0),
    ('2025-12-30', 'Deadlift', 3, 100.0),
    ('2025-12-30', 'Deadlift', 3, 120.0),
    ('2025-12-30', 'Deadlift', 3, 120.0),
    ('2025-12-30', 'Clean And Press', 7, 20.0),
    ('2025-12-30', 'Clean And Press', 7, 30.0),
    ('2025-12-30', 'Clean And Press', 7, 50.0),
    ('2025-12-30', 'Flat Barbell Bench Press', 5, 50.0),
    ('2025-12-30', 'Flat Barbell Bench Press', 5, 70.0),
    ('2025-12-30', 'Flat Barbell Bench Press', 5, 80.0),

    -- ===== 2025-12-31 =====
    ('2025-12-31', 'Overhead Sat Down Dumbbell Press', 10, 12.5),
    ('2025-12-31', 'Overhead Sat Down Dumbbell Press', 10, 17.5),
    ('2025-12-31', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2025-12-31', 'Overhead Sat Down Dumbbell Press', 10, 22.5),
    ('2025-12-31', 'Lateral Dumbbell Raise', 10, 7.0),
    ('2025-12-31', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2025-12-31', 'Lateral Dumbbell Raise', 10, 15.0),
    ('2025-12-31', 'Front Dumbbell Raise', 10, 7.5),
    ('2025-12-31', 'Front Dumbbell Raise', 10, 10.0),
    ('2025-12-31', 'Front Dumbbell Raise', 10, 12.5),
    ('2025-12-31', 'Cable Pull Down', 10, 41.0),
    ('2025-12-31', 'Cable Pull Down', 10, 55.0),
    ('2025-12-31', 'Cable Pull Down', 10, 68.0),
    ('2025-12-31', 'Cable Curl', 10, 32.0),
    ('2025-12-31', 'Cable Curl', 10, 41.0),
    ('2025-12-31', 'Cable Curl', 10, 46.0),
    ('2025-12-31', 'Dumbbell Curl', 8, 17.5),
    ('2025-12-31', 'Dumbbell Curl', 10, 15.0),
    ('2025-12-31', 'Dumbbell Curl', 10, 15.0),

    -- ===== 2026-01-07 =====
    ('2026-01-07', 'Flat Barbell Bench Press', 5, 65.0),
    ('2026-01-07', 'Flat Barbell Bench Press', 5, 75.0),
    ('2026-01-07', 'Flat Barbell Bench Press', 4, 85.0),
    ('2026-01-07', 'Flat Barbell Bench Press', 2, 80.0),
    ('2026-01-07', 'Flat Barbell Bench Press', 4, 45.0),
    ('2026-01-07', 'Decline Barbell Bench Press', 7, 40.0),
    ('2026-01-07', 'Decline Barbell Bench Press', 7, 50.0),
    ('2026-01-07', 'Decline Barbell Bench Press', 7, 60.0),
    ('2026-01-07', 'Decline Barbell Bench Press', 7, 70.0),

    -- ===== 2026-01-12 =====
    ('2026-01-12', 'Deadlift', 3, 80.0),
    ('2026-01-12', 'Deadlift', 3, 100.0),
    ('2026-01-12', 'Deadlift', 3, 120.0),
    ('2026-01-12', 'Barbell Row', 8, 20.0),
    ('2026-01-12', 'Barbell Row', 8, 40.0),
    ('2026-01-12', 'Barbell Row', 8, 60.0),
    ('2026-01-12', 'Pull Up', 4, 93.0),
    ('2026-01-12', 'Pull Up', 3, 93.0),
    ('2026-01-12', 'Pull Up', 4, 93.0),
    ('2026-01-12', 'Dumbbell Curl', 8, 17.5),
    ('2026-01-12', 'Dumbbell Curl', 8, 20.0),
    ('2026-01-12', 'Dumbbell Curl', 8, 22.5),
    ('2026-01-12', 'Cable Curl', 10, 41.0),
    ('2026-01-12', 'Cable Curl', 10, 46.0),
    ('2026-01-12', 'Cable Curl', 10, 50.0),

    -- ===== 2026-01-13 =====
    ('2026-01-13', 'Flat Barbell Bench Press', 5, 65.0),
    ('2026-01-13', 'Flat Barbell Bench Press', 5, 75.0),
    ('2026-01-13', 'Flat Barbell Bench Press', 1, 85.0),
    ('2026-01-13', 'Flat Barbell Bench Press', 3, 80.0),
    ('2026-01-13', 'Flat Barbell Bench Press', 3, 80.0),
    ('2026-01-13', 'Flat Barbell Bench Press', 10, 70.0),
    ('2026-01-13', 'Oblique Barbell', 10, 20.0),
    ('2026-01-13', 'Oblique Barbell', 10, 20.0),
    ('2026-01-13', 'Oblique Barbell', 10, 20.0),
    ('2026-01-13', 'Overhead Front Barbell Press', 7, 40.0),
    ('2026-01-13', 'Overhead Front Barbell Press', 6, 40.0),
    ('2026-01-13', 'Overhead Front Barbell Press', 6, 40.0),
    ('2026-01-13', 'Cross Body Cable Shoulder Raise', 10, 4.5),
    ('2026-01-13', 'Cross Body Cable Shoulder Raise', 6, 6.8),
    ('2026-01-13', 'Incline Dumbbell Bench Press', 10, 22.0),
    ('2026-01-13', 'Incline Dumbbell Bench Press', 10, 24.0),
    ('2026-01-13', 'Incline Dumbbell Bench Press', 6, 24.0),

    -- ===== 2026-01-15 =====
    ('2026-01-15', 'Walking Lunges', 10, 15.0),
    ('2026-01-15', 'Walking Lunges', 5, 15.0),
    ('2026-01-15', 'Walking Lunges', 5, 15.0),
    ('2026-01-15', 'Barbell Squat', 5, 20.0),
    ('2026-01-15', 'Barbell Squat', 5, 60.0),
    ('2026-01-15', 'Barbell Squat', 5, 80.0),
    ('2026-01-15', 'Barbell Squat', 5, 90.0),
    ('2026-01-15', 'Barbell Squat', 3, 100.0),
    ('2026-01-15', 'Barbell Squat', 5, 90.0),
    ('2026-01-15', 'Romanian Deadlift', 5, 60.0),
    ('2026-01-15', 'Romanian Deadlift', 5, 80.0),
    ('2026-01-15', 'Romanian Deadlift', 5, 100.0),
    ('2026-01-15', 'Romanian Deadlift', 5, 115.0),
    ('2026-01-15', 'Leg Extension Machine', 10, 50.0),
    ('2026-01-15', 'Leg Extension Machine', 10, 55.0),
    ('2026-01-15', 'Leg Extension Machine', 10, 59.0),

    -- ===== 2026-01-16 =====
    ('2026-01-16', 'Behind The Neck Barbell Press', 10, 10.0),
    ('2026-01-16', 'Behind The Neck Barbell Press', 10, 15.0),
    ('2026-01-16', 'Behind The Neck Barbell Press', 10, 35.0),
    ('2026-01-16', 'Overhead Sat Down Dumbbell Press', 10, 17.5),
    ('2026-01-16', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-01-16', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-01-16', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-01-16', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2026-01-16', 'Lateral Dumbbell Raise', 10, 15.0),
    ('2026-01-16', 'Front Dumbbell Raise', 10, 7.5),
    ('2026-01-16', 'Front Dumbbell Raise', 10, 12.5),
    ('2026-01-16', 'Smith Machine Close Grip Bench Press', 10, 20.0),
    ('2026-01-16', 'Smith Machine Close Grip Bench Press', 10, 40.0),
    ('2026-01-16', 'Smith Machine Close Grip Bench Press', 10, 50.0),
    ('2026-01-16', 'Cable Pull Down', 10, 59.0),
    ('2026-01-16', 'Cable Pull Down', 10, 64.0),
    ('2026-01-16', 'Cable Pull Down', 10, 68.0),
    ('2026-01-16', 'Cable Curl', 10, 46.0),
    ('2026-01-16', 'Cable Curl', 10, 50.0),
    ('2026-01-16', 'Cable Curl', 10, 55.0),
    ('2026-01-16', 'Dumbbell Curl', 8, 12.5),
    ('2026-01-16', 'Dumbbell Curl', 8, 17.5),

    -- ===== 2026-01-20 =====
    ('2026-01-20', 'Deadlift', 3, 90.0),
    ('2026-01-20', 'Deadlift', 3, 110.0),
    ('2026-01-20', 'Deadlift', 3, 110.0),
    ('2026-01-20', 'Barbell Row', 10, 20.0),
    ('2026-01-20', 'Barbell Row', 10, 40.0),
    ('2026-01-20', 'Barbell Row', 10, 60.0),
    ('2026-01-20', 'Pull Up', 5, 93.0),
    ('2026-01-20', 'Pull Up', 5, 93.0),
    ('2026-01-20', 'Pull Up', 5, 93.0),
    ('2026-01-20', 'Seated Machine Row', 10, 77.0),
    ('2026-01-20', 'Seated Machine Row', 10, 81.6),
    ('2026-01-20', 'Seated Machine Row', 10, 86.2),
    ('2026-01-20', 'Dumbbell Curl', 8, 15.0),
    ('2026-01-20', 'Dumbbell Curl', 8, 20.0),
    ('2026-01-20', 'Dumbbell Curl', 8, 22.5),
    ('2026-01-20', 'Cable Curl', 8, 50.0),
    ('2026-01-20', 'Cable Curl', 8, 55.0),
    ('2026-01-20', 'Cable Curl', 8, 59.0),

    -- ===== 2026-01-21 =====
    ('2026-01-21', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-01-21', 'Flat Barbell Bench Press', 5, 40.0),
    ('2026-01-21', 'Flat Barbell Bench Press', 3, 70.0),
    ('2026-01-21', 'Flat Barbell Bench Press', 2, 90.0),
    ('2026-01-21', 'Flat Barbell Bench Press', 2, 85.0),
    ('2026-01-21', 'Flat Barbell Bench Press', 4, 80.0),
    ('2026-01-21', 'Incline Barbell Bench Press', 5, 60.0),
    ('2026-01-21', 'Incline Barbell Bench Press', 4, 70.0),
    ('2026-01-21', 'Incline Barbell Bench Press', 5, 65.0),
    ('2026-01-21', 'EZ-Bar Curl', 10, 19.0),
    ('2026-01-21', 'EZ-Bar Curl', 10, 24.0),
    ('2026-01-21', 'EZ-Bar Curl', 10, 29.0),
    ('2026-01-21', 'EZ-Bar Curl', 5, 29.0),
    ('2026-01-21', 'Cable Pull Down', 3, 45.0),
    ('2026-01-21', 'Cable Pull Down', 10, 11.3),
    ('2026-01-21', 'Cable Pull Down', 10, 28.4),
    ('2026-01-21', 'Cable Pull Down', 10, 31.5),
    ('2026-01-21', 'Cable Pull Down', 10, 33.8),
    ('2026-01-21', 'Cross Body Cable Shoulder Raise', 7, 4.5),
    ('2026-01-21', 'Cross Body Cable Shoulder Raise', 7, 6.8),
    ('2026-01-21', 'Cable Crossover', 7, 31.6),
    ('2026-01-21', 'Cable Crossover', 7, 31.6),
    ('2026-01-21', 'Barbell Shoulder Raise', 10, 30.0),
    ('2026-01-21', 'Barbell Shoulder Raise', 10, 40.0),
    ('2026-01-21', 'Barbell Shoulder Raise', 8, 40.0),

    -- ===== 2026-01-25 =====
    ('2026-01-25', 'Barbell Squat', 5, 20.0),
    ('2026-01-25', 'Barbell Squat', 5, 70.0),
    ('2026-01-25', 'Barbell Squat', 5, 90.0),
    ('2026-01-25', 'Barbell Squat', 2, 100.0),
    ('2026-01-25', 'Barbell Squat', 5, 90.0),
    ('2026-01-25', 'Romanian Deadlift', 5, 60.0),
    ('2026-01-25', 'Romanian Deadlift', 5, 80.0),
    ('2026-01-25', 'Romanian Deadlift', 5, 100.0),
    ('2026-01-25', 'Perfect Squat', 7, 60.0),
    ('2026-01-25', 'Perfect Squat', 7, 70.0),
    ('2026-01-25', 'Perfect Squat', 7, 80.0),
    ('2026-01-25', 'Perfect Squat', 7, 90.0),
    ('2026-01-25', 'Perfect Squat', 7, 100.0),
    ('2026-01-25', 'Hack Squat', 7, 48.0),
    ('2026-01-25', 'Hack Squat', 7, 58.0),
    ('2026-01-25', 'Hack Squat', 7, 63.0),
    ('2026-01-25', 'Hack Squat', 7, 68.0),
    ('2026-01-25', 'Leg Press', 7, 76.0),
    ('2026-01-25', 'Leg Press', 7, 96.0),
    ('2026-01-25', 'Leg Press', 7, 126.0),
    ('2026-01-25', 'Leg Press', 7, 146.0),
    ('2026-01-25', 'Leg Press', 7, 176.0),
    ('2026-01-25', 'Leg Press', 7, 196.0),
    ('2026-01-25', 'Leg Extension Machine', 7, 52.0),
    ('2026-01-25', 'Leg Extension Machine', 7, 59.0),
    ('2026-01-25', 'Leg Extension Machine', 7, 66.0),
    ('2026-01-25', 'Leg Extension Machine', 7, 73.0),
    ('2026-01-25', 'Seated Leg Curl Machine', 7, 39.0),
    ('2026-01-25', 'Seated Leg Curl Machine', 7, 45.0),
    ('2026-01-25', 'Seated Leg Curl Machine', 7, 52.0),
    ('2026-01-25', 'Hip Abductor', 10, 18.0),
    ('2026-01-25', 'Hip Abductor', 10, 29.0),
    ('2026-01-25', 'Hip Abductor', 10, 43.0),
    ('2026-01-25', 'Hip Abductor', 10, 50.0),
    ('2026-01-25', 'Hip Adductor', 10, 18.0),
    ('2026-01-25', 'Hip Adductor', 10, 29.0),
    ('2026-01-25', 'Hip Adductor', 10, 43.0),
    ('2026-01-25', 'Hip Adductor', 10, 50.0),
    ('2026-01-25', 'Calf Press', 10, 66.0),
    ('2026-01-25', 'Calf Press', 10, 73.0),
    ('2026-01-25', 'Calf Press', 10, 79.0),

    -- ===== 2026-01-26 =====
    ('2026-01-26', 'Smith Bench Press', 10, 20.0),
    ('2026-01-26', 'Smith Bench Press', 5, 70.0),
    ('2026-01-26', 'Smith Bench Press', 5, 85.0),
    ('2026-01-26', 'Smith Bench Press', 5, 90.0),
    ('2026-01-26', 'Smith Incline Bench Press', 5, 60.0),
    ('2026-01-26', 'Smith Incline Bench Press', 5, 80.0),
    ('2026-01-26', 'Smith Incline Bench Press', 3, 85.0),
    ('2026-01-26', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-01-26', 'Overhead Sat Down Dumbbell Press', 10, 22.5),
    ('2026-01-26', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-01-26', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2026-01-26', 'Lateral Dumbbell Raise', 10, 15.0),

    -- ===== 2026-02-04 =====
    ('2026-02-04', 'Deadlift', 3, 60.0),
    ('2026-02-04', 'Deadlift', 3, 100.0),
    ('2026-02-04', 'Deadlift', 3, 120.0),
    ('2026-02-04', 'Deadlift', 3, 130.0),
    ('2026-02-04', 'Barbell Row', 10, 40.0),
    ('2026-02-04', 'Barbell Row', 10, 50.0),
    ('2026-02-04', 'Barbell Row', 10, 60.0),
    ('2026-02-04', 'Barbell Row', 10, 65.0),
    ('2026-02-04', 'Pull Up', 3, 92.2),
    ('2026-02-04', 'Pull Up', 4, 92.2),
    ('2026-02-04', 'Pull Up', 5, 92.2),

    -- ===== 2026-02-05 =====
    ('2026-02-05', 'Smith Bench Press', 10, 20.0),
    ('2026-02-05', 'Smith Bench Press', 5, 20.0),
    ('2026-02-05', 'Smith Bench Press', 5, 70.0),
    ('2026-02-05', 'Smith Bench Press', 5, 80.0),
    ('2026-02-05', 'Smith Bench Press', 1, 85.0),
    ('2026-02-05', 'Smith Incline Bench Press', 5, 60.0),
    ('2026-02-05', 'Smith Incline Bench Press', 5, 70.0),
    ('2026-02-05', 'Smith Incline Bench Press', 4, 75.0),
    ('2026-02-05', 'Overhead Sat Down Dumbbell Press', 10, 17.5),
    ('2026-02-05', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-02-05', 'Overhead Sat Down Dumbbell Press', 6, 20.0),
    ('2026-02-05', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2026-02-05', 'Lateral Dumbbell Raise', 10, 15.0),

    -- ===== 2026-02-06 =====
    ('2026-02-06', 'Barbell Squat', 5, 20.0),
    ('2026-02-06', 'Barbell Squat', 5, 90.0),
    ('2026-02-06', 'Barbell Squat', 5, 100.0),
    ('2026-02-06', 'Barbell Squat', 5, 90.0),
    ('2026-02-06', 'Romanian Deadlift', 5, 60.0),
    ('2026-02-06', 'Romanian Deadlift', 5, 80.0),
    ('2026-02-06', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-02-06', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-02-06', 'Perfect Squat', 7, 100.0),
    ('2026-02-06', 'Perfect Squat', 7, 100.0),
    ('2026-02-06', 'Leg Press', 3, 76.0),
    ('2026-02-06', 'Leg Press', 7, 176.0),
    ('2026-02-06', 'Leg Press', 7, 196.0),
    ('2026-02-06', 'Leg Press', 7, 206.0),
    ('2026-02-06', 'Seated Leg Curl Machine', 7, 52.0),
    ('2026-02-06', 'Seated Leg Curl Machine', 7, 59.0),
    ('2026-02-06', 'Seated Leg Curl Machine', 2, 66.0),
    ('2026-02-06', 'Seated Leg Curl Machine', 7, 59.0),
    ('2026-02-06', 'Leg Extension Machine', 7, 66.0),
    ('2026-02-06', 'Leg Extension Machine', 7, 66.0),
    ('2026-02-06', 'Leg Extension Machine', 7, 66.0),

    -- ===== 2026-02-10 =====
    ('2026-02-10', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-02-10', 'Overhead Sat Down Dumbbell Press', 10, 22.5),
    ('2026-02-10', 'Overhead Sat Down Dumbbell Press', 7, 25.0),
    ('2026-02-10', 'Lateral Dumbbell Raise', 10, 12.5),
    ('2026-02-10', 'Lateral Dumbbell Raise', 10, 15.0),
    ('2026-02-10', 'Lateral Dumbbell Raise', 10, 17.5),
    ('2026-02-10', 'Front Dumbbell Raise', 10, 7.5),
    ('2026-02-10', 'Front Dumbbell Raise', 10, 10.0),
    ('2026-02-10', 'Front Dumbbell Raise', 10, 12.5),
    ('2026-02-10', 'Cable Pull Down', 10, 68.0),
    ('2026-02-10', 'Cable Pull Down', 10, 73.0),
    ('2026-02-10', 'Cable Pull Down', 6, 73.0),
    ('2026-02-10', 'Cable Curl', 10, 45.0),
    ('2026-02-10', 'Cable Curl', 10, 50.0),
    ('2026-02-10', 'Cable Curl', 10, 54.0),
    ('2026-02-10', 'Dumbbell Curl', 10, 12.5),

    -- ===== 2026-02-11 =====
    ('2026-02-11', 'Deadlift', 3, 60.0),
    ('2026-02-11', 'Deadlift', 4, 100.0),
    ('2026-02-11', 'Deadlift', 1, 140.0),
    ('2026-02-11', 'Deadlift', 4, 120.0),
    ('2026-02-11', 'Barbell Row', 10, 30.0),
    ('2026-02-11', 'Barbell Row', 10, 50.0),
    ('2026-02-11', 'Barbell Row', 10, 60.0),
    ('2026-02-11', 'Lat Pulldown', 10, 40.0),
    ('2026-02-11', 'Lat Pulldown', 10, 70.0),
    ('2026-02-11', 'Lat Pulldown', 5, 90.0),
    ('2026-02-11', 'Seated Machine Row', 10, 81.6),
    ('2026-02-11', 'Seated Machine Row', 10, 86.2),
    ('2026-02-11', 'Seated Machine Row', 10, 90.7),
    ('2026-02-11', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-02-11', 'Seated Incline Dumbbell Curl', 10, 15.0),
    ('2026-02-11', 'Seated Incline Dumbbell Curl', 10, 15.0),

    -- ===== 2026-02-12 =====
    ('2026-02-12', 'Smith Bench Press', 10, 20.0),
    ('2026-02-12', 'Smith Bench Press', 5, 70.0),
    ('2026-02-12', 'Smith Bench Press', 3, 90.0),
    ('2026-02-12', 'Smith Bench Press', 5, 80.0),
    ('2026-02-12', 'Incline Dumbbell Bench Press', 10, 20.0),
    ('2026-02-12', 'Incline Dumbbell Bench Press', 10, 22.5),
    ('2026-02-12', 'Incline Dumbbell Bench Press', 10, 25.0),
    ('2026-02-12', 'Seated Machine Fly', 10, 32.0),
    ('2026-02-12', 'Seated Machine Fly', 10, 45.0),
    ('2026-02-12', 'Seated Machine Fly', 10, 64.0),
    ('2026-02-12', 'Lateral Dumbbell Raise', 10, 5.0),
    ('2026-02-12', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-02-12', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-02-12', 'Cable Pull Down', 10, 18.0),
    ('2026-02-12', 'Cable Pull Down', 10, 50.0),
    ('2026-02-12', 'Cable Pull Down', 10, 54.0),
    ('2026-02-12', 'Cable Pull Down', 10, 59.0),

    -- ===== 2026-02-13 =====
    ('2026-02-13', 'Neutral Grip Dumbbell Press', 10, 15.0),
    ('2026-02-13', 'Neutral Grip Dumbbell Press', 10, 20.0),
    ('2026-02-13', 'Neutral Grip Dumbbell Press', 10, 20.0),
    ('2026-02-13', 'Rear Delt Machine Fly', 10, 14.0),
    ('2026-02-13', 'Rear Delt Machine Fly', 10, 23.0),
    ('2026-02-13', 'Rear Delt Machine Fly', 10, 32.0),
    ('2026-02-13', 'Lateral Dumbbell Raise', 12, 7.0),
    ('2026-02-13', 'Lateral Dumbbell Raise', 10, 9.0),
    ('2026-02-13', 'Lateral Dumbbell Raise', 10, 9.0),
    ('2026-02-13', 'Cable Pull Down', 10, 27.0),
    ('2026-02-13', 'Cable Pull Down', 10, 46.0),
    ('2026-02-13', 'Cable Pull Down', 10, 55.0),
    ('2026-02-13', 'Cable Pull Down', 5, 66.0),
    ('2026-02-13', 'Dumbbell Overhead Triceps Extension', 10, 22.5),
    ('2026-02-13', 'Dumbbell Overhead Triceps Extension', 10, 25.0),
    ('2026-02-13', 'Dumbbell Overhead Triceps Extension', 10, 27.5),
    ('2026-02-13', 'EZ-Bar Standing Curl', 10, 20.0),
    ('2026-02-13', 'EZ-Bar Standing Curl', 10, 30.0),
    ('2026-02-13', 'EZ-Bar Standing Curl', 10, 40.0),
    ('2026-02-13', 'Decline Crunch', 12, NULL),
    ('2026-02-13', 'Decline Crunch', 12, NULL),

    -- ===== 2026-02-16 =====
    ('2026-02-16', 'Barbell Squat', 5, 20.0),
    ('2026-02-16', 'Barbell Squat', 5, 70.0),
    ('2026-02-16', 'Barbell Squat', 5, 90.0),
    ('2026-02-16', 'Barbell Squat', 5, 95.0),
    ('2026-02-16', 'Romanian Deadlift Box', 5, 20.0),
    ('2026-02-16', 'Romanian Deadlift Box', 5, 40.0),
    ('2026-02-16', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-02-16', 'Romanian Deadlift Box', 5, 70.0),
    ('2026-02-16', 'Leg Press', 7, 112.0),
    ('2026-02-16', 'Leg Press', 7, 162.0),
    ('2026-02-16', 'Leg Press', 5, 192.0),
    ('2026-02-16', 'Hip Adductor', 10, 27.0),
    ('2026-02-16', 'Hip Adductor', 10, 45.0),
    ('2026-02-16', 'Hip Adductor', 8, 55.0),
    ('2026-02-16', 'Standing Calf Raise Box', 10, 25.0),
    ('2026-02-16', 'Standing Calf Raise Box', 10, 35.0),
    ('2026-02-16', 'Standing Calf Raise Box', 10, 40.0),
    ('2026-02-16', 'Decline Crunch', 12, 5.0),
    ('2026-02-16', 'Decline Crunch', 12, 5.0),
    ('2026-02-16', 'Decline Crunch', 12, 5.0),

    -- ===== 2026-02-17 =====
    ('2026-02-17', 'Deadlift', 3, 60.0),
    ('2026-02-17', 'Deadlift', 3, 80.0),
    ('2026-02-17', 'Deadlift', 4, 100.0),
    ('2026-02-17', 'Barbell Row', 10, 60.0),
    ('2026-02-17', 'Barbell Row', 10, 65.0),
    ('2026-02-17', 'Barbell Row', 10, 70.0),
    ('2026-02-17', 'Lat Pulldown', 10, 70.0),
    ('2026-02-17', 'Lat Pulldown', 10, 75.0),
    ('2026-02-17', 'Lat Pulldown', 10, 80.0),
    ('2026-02-17', 'Seated Machine Row', 10, 86.2),
    ('2026-02-17', 'Seated Machine Row', 10, 90.7),
    ('2026-02-17', 'Seated Machine Row', 10, 90.7),
    ('2026-02-17', 'Seated Incline Dumbbell Curl', 10, 10.0),
    ('2026-02-17', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-02-17', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-02-17', 'Dumbbell Hammer Curl', 10, 10.0),
    ('2026-02-17', 'Dumbbell Hammer Curl', 10, 12.5),
    ('2026-02-17', 'Dumbbell Hammer Curl', 10, 15.0),

    -- ===== 2026-02-19 =====
    ('2026-02-19', 'Smith Bench Press', 5, 20.0),
    ('2026-02-19', 'Smith Bench Press', 5, 70.0),
    ('2026-02-19', 'Smith Bench Press', 5, 80.0),
    ('2026-02-19', 'Smith Bench Press', 5, 90.0),
    ('2026-02-19', 'Incline Dumbbell Bench Press', 10, 22.5),
    ('2026-02-19', 'Incline Dumbbell Bench Press', 5, 25.0),
    ('2026-02-19', 'Incline Dumbbell Bench Press', 5, 27.5),
    ('2026-02-19', 'Seated Machine Fly', 10, 59.0),
    ('2026-02-19', 'Seated Machine Fly', 10, 64.0),
    ('2026-02-19', 'Seated Machine Fly', 8, 68.0),
    ('2026-02-19', 'Lateral Dumbbell Raise', 10, 8.0),
    ('2026-02-19', 'Lateral Dumbbell Raise', 10, 9.0),
    ('2026-02-19', 'Lateral Dumbbell Raise', 10, 9.0),
    ('2026-02-19', 'Cable Pull Down', 10, 50.0),
    ('2026-02-19', 'Cable Pull Down', 10, 55.0),
    ('2026-02-19', 'Cable Pull Down', 10, 59.0),

    -- ===== 2026-02-28 =====
    ('2026-02-28', 'Hack Squat', 10, 20.0),
    ('2026-02-28', 'Hack Squat', 10, 50.0),
    ('2026-02-28', 'Hack Squat', 10, 55.0),
    ('2026-02-28', 'Romanian Deadlift Box', 10, 20.0),
    ('2026-02-28', 'Romanian Deadlift Box', 10, 60.0),
    ('2026-02-28', 'Romanian Deadlift Box', 10, 70.0),
    ('2026-02-28', 'Seated Leg Curl Machine', 10, 36.0),
    ('2026-02-28', 'Seated Leg Curl Machine', 10, 45.0),
    ('2026-02-28', 'Seated Leg Curl Machine', 10, 50.0),
    ('2026-02-28', 'Leg Extension Machine', 10, 59.0),
    ('2026-02-28', 'Leg Extension Machine', 10, 64.0),
    ('2026-02-28', 'Leg Extension Machine', 10, 68.0),

    -- ===== 2026-03-02 =====
    ('2026-03-02', 'Flat Barbell Bench Press', 5, 60.0),
    ('2026-03-02', 'Flat Barbell Bench Press', 10, 65.0),
    ('2026-03-02', 'Flat Barbell Bench Press', 8, 70.0),
    ('2026-03-02', 'Incline Dumbbell Bench Press', 10, 20.0),
    ('2026-03-02', 'Incline Dumbbell Bench Press', 10, 22.5),
    ('2026-03-02', 'Incline Dumbbell Bench Press', 10, 25.0),
    ('2026-03-02', 'Seated Machine Fly', 10, 59.0),
    ('2026-03-02', 'Seated Machine Fly', 10, 64.0),
    ('2026-03-02', 'Seated Machine Fly', 10, 68.0),

    -- ===== 2026-03-04 =====
    ('2026-03-04', 'Deadlift', 3, 80.0),
    ('2026-03-04', 'Deadlift', 3, 100.0),
    ('2026-03-04', 'Deadlift', 3, 120.0),
    ('2026-03-04', 'Barbell Row', 10, 65.0),
    ('2026-03-04', 'Barbell Row', 10, 70.0),
    ('2026-03-04', 'Barbell Row', 7, 70.0),
    ('2026-03-04', 'Pull Up', 3, 92.0),
    ('2026-03-04', 'Pull Up', 3, 92.0),
    ('2026-03-04', 'Pull Up', 3, 92.0),
    ('2026-03-04', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-03-04', 'Seated Incline Dumbbell Curl', 10, 15.0),
    ('2026-03-04', 'Seated Incline Dumbbell Curl', 6, 15.0),
    ('2026-03-04', 'Dumbbell Hammer Curl', 10, 12.5),
    ('2026-03-04', 'Dumbbell Hammer Curl', 10, 15.0),
    ('2026-03-04', 'Dumbbell Hammer Curl', 10, 17.5),

    -- ===== 2026-03-05 =====
    ('2026-03-05', 'Cross Body Cable Shoulder Raise', 10, 5.0),
    ('2026-03-05', 'Cross Body Cable Shoulder Raise', 10, 9.0),
    ('2026-03-05', 'Cross Body Cable Shoulder Raise', 10, 14.0),
    ('2026-03-05', 'Cable Pull Down', 10, 14.0),
    ('2026-03-05', 'Cable Pull Down', 10, 50.0),
    ('2026-03-05', 'Cable Pull Down', 10, 55.0),
    ('2026-03-05', 'Cable Pull Down', 10, 59.0),
    ('2026-03-05', 'Overhead Sat Down Tricep Extension', 10, 12.5),
    ('2026-03-05', 'Overhead Sat Down Tricep Extension', 10, 25.0),
    ('2026-03-05', 'Overhead Sat Down Tricep Extension', 10, 30.0),
    ('2026-03-05', 'EZ-Bar Curl', 10, 20.0),
    ('2026-03-05', 'EZ-Bar Curl', 10, 30.0),
    ('2026-03-05', 'EZ-Bar Curl', 7, 35.0),
    ('2026-03-05', 'Decline Crunch', 13, 10.0),
    ('2026-03-05', 'Decline Crunch', 12, 10.0),
    ('2026-03-05', 'Decline Crunch', 12, 10.0),

    -- ===== 2026-03-12 =====
    ('2026-03-12', 'Barbell Squat', 5, 60.0),
    ('2026-03-12', 'Barbell Squat', 5, 80.0),
    ('2026-03-12', 'Barbell Squat', 5, 90.0),
    ('2026-03-12', 'Romanian Deadlift Box', 5, 20.0),
    ('2026-03-12', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-03-12', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-03-12', 'Bulgarian Split Squats', 10, 10.0),
    ('2026-03-12', 'Bulgarian Split Squats', 10, 10.0),
    ('2026-03-12', 'Bulgarian Split Squats', 10, 10.0),
    ('2026-03-12', 'Leg Press', 10, 170.0),
    ('2026-03-12', 'Leg Press', 10, 190.0),
    ('2026-03-12', 'Leg Press', 10, 200.0),

    -- ===== 2026-03-24 =====
    ('2026-03-24', 'Smith Bench Press', 5, 60.0),
    ('2026-03-24', 'Smith Bench Press', 4, 80.0),
    ('2026-03-24', 'Smith Bench Press', 4, 80.0),
    ('2026-03-24', 'Incline Dumbbell Bench Press', 10, 20.0),
    ('2026-03-24', 'Incline Dumbbell Bench Press', 10, 22.5),
    ('2026-03-24', 'Incline Dumbbell Bench Press', 10, 25.0),
    ('2026-03-24', 'Seated Machine Fly', 10, 59.0),
    ('2026-03-24', 'Seated Machine Fly', 10, 64.0),
    ('2026-03-24', 'Seated Machine Fly', 10, 68.0),
    ('2026-03-24', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-03-24', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-03-24', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-03-24', 'Lateral Dumbbell Raise', 10, 5.0),
    ('2026-03-24', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-03-24', 'Lateral Dumbbell Raise', 10, 15.0),
    ('2026-03-24', 'Cable Pull Down', 10, 36.0),
    ('2026-03-24', 'Cable Pull Down', 10, 45.0),
    ('2026-03-24', 'Cable Pull Down', 6, 64.0),

    -- ===== 2026-03-25 =====
    ('2026-03-25', 'Barbell Squat', 5, 60.0),
    ('2026-03-25', 'Barbell Squat', 5, 80.0),
    ('2026-03-25', 'Barbell Squat', 5, 90.0),
    ('2026-03-25', 'Barbell Squat', 2, 105.0),
    ('2026-03-25', 'Barbell Squat', 2, 100.0),
    ('2026-03-25', 'Romanian Deadlift Box', 5, 20.0),
    ('2026-03-25', 'Romanian Deadlift Box', 5, 60.0),
    ('2026-03-25', 'Romanian Deadlift Box', 5, 70.0),
    ('2026-03-25', 'Bulgarian Split Squats', 10, 7.5),
    ('2026-03-25', 'Bulgarian Split Squats', 10, 7.5),
    ('2026-03-25', 'Bulgarian Split Squats', 10, 7.5),
    ('2026-03-25', 'Hip Adductor', 10, 41.0),
    ('2026-03-25', 'Hip Adductor', 10, 45.0),
    ('2026-03-25', 'Hip Adductor', 9, 50.0),
    ('2026-03-25', 'Decline Crunch', 12, 15.0),
    ('2026-03-25', 'Decline Crunch', 12, 15.0),

    -- ===== 2026-03-27 =====
    ('2026-03-27', 'Clean And Press', 5, 40.0),
    ('2026-03-27', 'Clean And Press', 5, 40.0),
    ('2026-03-27', 'Clean And Press', 5, 40.0),
    ('2026-03-27', 'Flat Barbell Bench Press', 5, 60.0),
    ('2026-03-27', 'Flat Barbell Bench Press', 5, 75.0),
    ('2026-03-27', 'Flat Barbell Bench Press', 2, 85.0),
    ('2026-03-27', 'Incline Dumbbell Bench Press', 7, 24.0),
    ('2026-03-27', 'Incline Dumbbell Bench Press', 7, 26.0),
    ('2026-03-27', 'Incline Dumbbell Bench Press', 7, 28.0),
    ('2026-03-27', 'Overhead Sat Down Dumbbell Press', 7, 22.0),
    ('2026-03-27', 'Overhead Sat Down Dumbbell Press', 7, 22.0),
    ('2026-03-27', 'Overhead Sat Down Dumbbell Press', 7, 22.0),
    ('2026-03-27', 'Negative Pull Up', 4, 91.1),
    ('2026-03-27', 'Negative Pull Up', 4, 91.1),
    ('2026-03-27', 'Negative Pull Up', 3, 91.1),
    ('2026-03-27', 'Seated Machine Fly Kentish Town', 8, 73.0),

    -- ===== 2026-03-31 =====
    ('2026-03-31', 'Deadlift', 3, 70.0),
    ('2026-03-31', 'Deadlift', 3, 90.0),
    ('2026-03-31', 'Deadlift', 3, 110.0),
    ('2026-03-31', 'Barbell Row', 5, 70.0),
    ('2026-03-31', 'Barbell Row', 5, 75.0),
    ('2026-03-31', 'Barbell Row', 5, 80.0),
    ('2026-03-31', 'Negative Pull Up', 3, 91.1),
    ('2026-03-31', 'Negative Pull Up', 3, 91.1),
    ('2026-03-31', 'Negative Pull Up', 3, 91.1),
    ('2026-03-31', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-03-31', 'Seated Incline Dumbbell Curl', 10, 12.5),

    -- ===== 2026-04-02 =====
    ('2026-04-02', 'Cross Body Cable Shoulder Raise', 10, 7.0),
    ('2026-04-02', 'Cross Body Cable Shoulder Raise', 10, 11.0),
    ('2026-04-02', 'Cross Body Cable Shoulder Raise', 10, 14.0),
    ('2026-04-02', 'Rear Delt Machine Fly', 10, 27.0),
    ('2026-04-02', 'Rear Delt Machine Fly', 10, 32.0),
    ('2026-04-02', 'Rear Delt Machine Fly', 10, 37.0),
    ('2026-04-02', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-04-02', 'Lateral Dumbbell Raise', 10, 9.0),
    ('2026-04-02', 'Lateral Dumbbell Raise', 8, 12.5),
    ('2026-04-02', 'Cable Pull Down', 10, 36.0),
    ('2026-04-02', 'Cable Pull Down', 10, 46.0),
    ('2026-04-02', 'Cable Pull Down', 10, 55.0),
    ('2026-04-02', 'Dumbbell Overhead Triceps Extension', 10, 20.0),
    ('2026-04-02', 'Dumbbell Overhead Triceps Extension', 10, 25.0),
    ('2026-04-02', 'Dumbbell Overhead Triceps Extension', 10, 27.5),
    ('2026-04-02', 'Decline Crunch', 12, 15.0),
    ('2026-04-02', 'Decline Crunch', 24, 15.0),

    -- ===== 2026-04-04 =====
    ('2026-04-04', 'Sledge Push', 5, 75.0),
    ('2026-04-04', 'Barbell Squat', 5, 20.0),
    ('2026-04-04', 'Barbell Squat', 5, 40.0),
    ('2026-04-04', 'Barbell Squat', 5, 60.0),
    ('2026-04-04', 'Barbell Squat', 5, 80.0),
    ('2026-04-04', 'Romanian Deadlift', 5, 20.0),
    ('2026-04-04', 'Romanian Deadlift', 5, 50.0),
    ('2026-04-04', 'Romanian Deadlift', 5, 60.0),
    ('2026-04-04', 'Flat Barbell Bench Press', 5, 30.0),
    ('2026-04-04', 'Flat Barbell Bench Press', 5, 60.0),
    ('2026-04-04', 'Flat Barbell Bench Press', 2, 85.0),
    ('2026-04-04', 'EZ-Bar Curl Narrow Grip', 7, 19.0),
    ('2026-04-04', 'EZ-Bar Curl Narrow Grip', 7, 24.0),
    ('2026-04-04', 'EZ-Bar Curl Narrow Grip', 7, 29.0),
    ('2026-04-04', 'EZ-Bar Curl Narrow Grip', 7, 34.0),
    ('2026-04-04', 'Seated Leg Curl Machine', 10, 39.0),
    ('2026-04-04', 'Seated Leg Curl Machine', 10, 45.0),
    ('2026-04-04', 'Seated Leg Curl Machine', 10, 52.0),
    ('2026-04-04', 'Leg Extension Machine', 10, 39.0),
    ('2026-04-04', 'Seated Machine Fly Kentish Town', 8, 79.0),
    ('2026-04-04', 'Seated Machine Fly Kentish Town', 10, 83.0),
    ('2026-04-04', 'Seated Machine Fly Kentish Town', 7, 86.0),

    -- ===== 2026-04-23 =====
    ('2026-04-23', 'Smith Bench Press', 10, 20.0),
    ('2026-04-23', 'Smith Bench Press', 5, 60.0),
    ('2026-04-23', 'Smith Bench Press', 5, 70.0),
    ('2026-04-23', 'Smith Bench Press', 3, 90.0),
    ('2026-04-23', 'Incline Dumbbell Bench Press', 7, 20.0),
    ('2026-04-23', 'Incline Dumbbell Bench Press', 7, 25.0),
    ('2026-04-23', 'Incline Dumbbell Bench Press', 7, 30.0),
    ('2026-04-23', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-04-23', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-04-23', 'Overhead Sat Down Dumbbell Press', 10, 20.0),
    ('2026-04-23', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-04-23', 'Lateral Dumbbell Raise', 7, 10.0),
    ('2026-04-23', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-04-23', 'Seated Machine Fly', 10, 59.0),
    ('2026-04-23', 'Seated Machine Fly', 10, 64.0),
    ('2026-04-23', 'Seated Machine Fly', 10, 68.0),
    ('2026-04-23', 'Overhead Sat Down Tricep Extension', 10, 20.0),
    ('2026-04-23', 'Overhead Sat Down Tricep Extension', 10, 25.0),
    ('2026-04-23', 'Overhead Sat Down Tricep Extension', 10, 30.0),

    -- ===== 2026-05-01 =====
    ('2026-05-01', 'Cross Body Cable Shoulder Raise', 10, 5.0),
    ('2026-05-01', 'Cross Body Cable Shoulder Raise', 10, 9.0),
    ('2026-05-01', 'Cross Body Cable Shoulder Raise', 10, 14.0),
    ('2026-05-01', 'Rear Delt Machine Fly', 10, 32.0),
    ('2026-05-01', 'Rear Delt Machine Fly', 10, 36.0),
    ('2026-05-01', 'Rear Delt Machine Fly', 10, 41.0),
    ('2026-05-01', 'Lateral Dumbbell Raise', 10, 5.0),
    ('2026-05-01', 'Lateral Dumbbell Raise', 10, 7.0),
    ('2026-05-01', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-05-01', 'Cable Pull Down', 10, 45.0),
    ('2026-05-01', 'Cable Pull Down', 10, 50.0),
    ('2026-05-01', 'Cable Pull Down', 10, 54.0),
    ('2026-05-01', 'Dumbbell Overhead Triceps Extension', 10, 25.0),
    ('2026-05-01', 'Dumbbell Overhead Triceps Extension', 10, 27.5),
    ('2026-05-01', 'Dumbbell Overhead Triceps Extension', 10, 30.0),
    ('2026-05-01', 'Seated Incline Dumbbell Curl', 10, 12.5),
    ('2026-05-01', 'Seated Incline Dumbbell Curl', 10, 15.0),
    ('2026-05-01', 'Seated Incline Dumbbell Curl', 10, 15.0),
    ('2026-05-01', 'EZ-Bar Curl Narrow Grip', 10, 20.0),
    ('2026-05-01', 'EZ-Bar Curl Narrow Grip', 10, 25.0),
    ('2026-05-01', 'EZ-Bar Curl Narrow Grip', 5, 30.0),

    -- ===== 2026-05-06 =====
    ('2026-05-06', 'Barbell Squat', 5, 20.0),
    ('2026-05-06', 'Barbell Squat', 5, 70.0),
    ('2026-05-06', 'Barbell Squat', 5, 80.0),
    ('2026-05-06', 'Barbell Squat', 5, 85.0),
    ('2026-05-06', 'Romanian Deadlift Box', 10, 60.0),
    ('2026-05-06', 'Romanian Deadlift Box', 10, 60.0),
    ('2026-05-06', 'Bulgarian Split Squats', 10, 7.5),
    ('2026-05-06', 'Bulgarian Split Squats', 10, 7.5),
    ('2026-05-06', 'Leg Press', 5, 145.0),
    ('2026-05-06', 'Leg Press', 5, 190.0),
    ('2026-05-06', 'Leg Press', 5, 200.0),
    ('2026-05-06', 'Standing Calf Raise Box', 10, 5.0),
    ('2026-05-06', 'Standing Calf Raise Box', 10, 10.0),
    ('2026-05-06', 'Standing Calf Raise Box', 10, 15.0),

    -- ===== 2026-05-08 =====
    ('2026-05-08', 'Barbell Squat', 5, 20.0),
    ('2026-05-08', 'Barbell Squat', 5, 60.0),
    ('2026-05-08', 'Barbell Squat', 5, 80.0),
    ('2026-05-08', 'Barbell Squat', 5, 80.0),
    ('2026-05-08', 'Barbell Squat', 7, 60.0),
    ('2026-05-08', 'Romanian Deadlift Box', 5, 40.0),
    ('2026-05-08', 'Romanian Deadlift Box', 5, 40.0),
    ('2026-05-08', 'Romanian Deadlift Box', 5, 50.0),
    ('2026-05-08', 'Leg Press', 8, 176.0),
    ('2026-05-08', 'Leg Press', 5, 226.0),
    ('2026-05-08', 'Leg Press', 5, 246.0),
    ('2026-05-08', 'Leg Press', 3, 266.0),
    ('2026-05-08', 'Incline Dumbbell Bench Press', 11, 28.0),
    ('2026-05-08', 'Incline Dumbbell Bench Press', 7, 28.0),
    ('2026-05-08', 'Incline Dumbbell Bench Press', 7, 28.0),

    -- ===== 2026-05-11 =====
    ('2026-05-11', 'Cross Body Cable Shoulder Raise', 10, 9.0),
    ('2026-05-11', 'Cross Body Cable Shoulder Raise', 10, 9.0),
    ('2026-05-11', 'Cross Body Cable Shoulder Raise', 10, 14.0),
    ('2026-05-11', 'Cable Pull Down', 10, 45.0),
    ('2026-05-11', 'Cable Pull Down', 10, 50.0),
    ('2026-05-11', 'Cable Pull Down', 10, 59.0),
    ('2026-05-11', 'Overhead Sat Down Tricep Extension', 10, 22.5),
    ('2026-05-11', 'Overhead Sat Down Tricep Extension', 10, 30.0),
    ('2026-05-11', 'Overhead Sat Down Tricep Extension', 10, 32.5),
    ('2026-05-11', 'EZ-Bar Curl Narrow Grip', 10, 12.5),
    ('2026-05-11', 'EZ-Bar Curl Narrow Grip', 10, 30.0),
    ('2026-05-11', 'EZ-Bar Curl Narrow Grip', 10, 35.0),
    ('2026-05-11', 'Lateral Dumbbell Raise', 10, 7.5),
    ('2026-05-11', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-05-11', 'Lateral Dumbbell Raise', 10, 10.0),
    ('2026-05-11', 'Decline Crunch', 12, 20.0),
    ('2026-05-11', 'Decline Crunch', 12, 20.0),
    ('2026-05-11', 'Decline Crunch', 12, 20.0),

    -- ===== 2026-05-13 =====
    ('2026-05-13', 'Seated Machine Fly Kentish Town', 8, 73.0),
    ('2026-05-13', 'Seated Machine Fly Kentish Town', 8, 79.0),
    ('2026-05-13', 'Seated Machine Fly Kentish Town', 8, 86.0),
    ('2026-05-13', 'Seated Machine Fly Kentish Town', 8, 86.0),
    ('2026-05-13', 'Parallel Bar Triceps Dip', 5, 91.7),
    ('2026-05-13', 'Parallel Bar Triceps Dip', 3, 91.7),
    ('2026-05-13', 'Parallel Bar Triceps Dip', 5, 91.7),
    ('2026-05-13', 'Parallel Bar Triceps Dip', 5, 91.7),
    ('2026-05-13', 'Flat Barbell Bench Press', 5, 60.0),
    ('2026-05-13', 'Flat Barbell Bench Press', 3, 70.0),
    ('2026-05-13', 'Flat Barbell Bench Press', 4, 70.0),
    ('2026-05-13', 'Flat Barbell Bench Press', 3, 70.0),
    ('2026-05-13', 'Cross Body Cable Shoulder Raise', 8, 6.8),
    ('2026-05-13', 'Cross Body Cable Shoulder Raise', 8, 6.8),
    ('2026-05-13', 'Cross Body Cable Shoulder Raise', 8, 6.8),
    ('2026-05-13', 'Cross Body Cable Shoulder Raise', 8, 6.8),
    ('2026-05-13', 'Front Raise Cable', 10, 4.5),
    ('2026-05-13', 'Front Raise Cable', 7, 6.8),
    ('2026-05-13', 'Front Raise Cable', 10, 4.5),
    ('2026-05-13', 'Front Raise Cable', 6, 6.8),
    ('2026-05-13', 'Hang Clean Press', 6, 40.0),
    ('2026-05-13', 'Hang Clean Press', 5, 40.0),
    ('2026-05-13', 'Hang Clean Press', 3, 40.0),
    ('2026-05-13', 'Hang Clean Press', 6, 40.0)
  ;

  -- --------------------------------------------------------------------------
  -- Bodyweight exercise list (used for is_bodyweight on new exercises).
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _bodyweight (name text PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO _bodyweight (name) VALUES
    ('Pull Up'),
    ('Negative Pull Up'),
    ('Parallel Bar Triceps Dip'),
    ('Hanging Knee Raise'),
    ('Ab-Wheel Rollout'),
    ('Crunch'),
    ('Decline Crunch'),
    ('Ball Crunch');

  -- --------------------------------------------------------------------------
  -- 2. Insert missing exercises.
  --
  -- Match against user's existing library case-insensitively. Anything not
  -- found is inserted with sensible defaults — track_reps=true, all other
  -- tracking flags off, is_bodyweight=true for the names in _bodyweight,
  -- equipment / categories / muscles left NULL (user fills in manually).
  --
  -- DISTINCT ON (LOWER(name)) collapses any case-variant duplicates in the
  -- staging table down to a single canonical row (the first-seen casing).
  -- The NOT EXISTS filter then drops anything the library already has under
  -- any casing — those sets will attach to the pre-existing exercise via
  -- _exercise_map below.
  -- --------------------------------------------------------------------------
  WITH distinct_imports AS (
    SELECT DISTINCT ON (LOWER(i.exercise_name))
      i.exercise_name AS new_name,
      (b.name IS NOT NULL) AS is_bw
    FROM _import i
    LEFT JOIN _bodyweight b ON b.name = i.exercise_name
    ORDER BY LOWER(i.exercise_name), i.rownum
  ),
  missing AS (
    SELECT new_name, is_bw FROM distinct_imports di
    WHERE NOT EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.user_id = target_user_id
        AND LOWER(e.name) = LOWER(di.new_name)
    )
  )
  INSERT INTO exercises (
    id, user_id, name, categories, equipment,
    is_bodyweight, track_reps, default_weight_kg, double_reps,
    distance_unit, track_time, time_unit,
    track_resistance, track_speed, speed_unit,
    track_incline, incline_unit, track_rest, track_calories,
    muscles, secondary_muscles, created_at
  )
  -- All tracking flags are BOOLEAN in the Postgres schema EXCEPT
  -- track_calories, which is INTEGER (added in a later migration with a
  -- different type). The PowerSync→SQLite layer serialises both to int
  -- locally, which is why this is confusing.
  SELECT
    gen_random_uuid(),
    target_user_id,
    new_name,
    NULL,                          -- categories (text[])
    NULL,                          -- equipment
    is_bw,                         -- is_bodyweight (boolean)
    true,                          -- track_reps (boolean)
    0,                             -- default_weight_kg (real)
    false,                         -- double_reps (boolean)
    NULL,                          -- distance_unit
    false,                         -- track_time (boolean)
    NULL,                          -- time_unit
    false,                         -- track_resistance (boolean)
    false,                         -- track_speed (boolean)
    NULL,                          -- speed_unit
    false,                         -- track_incline (boolean)
    NULL,                          -- incline_unit
    false,                         -- track_rest (boolean)
    0,                             -- track_calories (INTEGER, not bool)
    NULL,                          -- muscles (text[])
    NULL,                          -- secondary_muscles (text[])
    NOW()
  FROM missing;

  GET DIAGNOSTICS imported_exercise_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 3. Insert workouts (one per distinct date).
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _workout_map (
    performed_on date PRIMARY KEY,
    workout_id uuid NOT NULL
  ) ON COMMIT DROP;

  WITH ins AS (
    INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      target_user_id,
      'Gym',
      d.performed_on,
      'workout',
      NULL,
      NOW(),
      NOW()
    FROM (SELECT DISTINCT performed_on FROM _import) d
    RETURNING id, performed_on
  )
  INSERT INTO _workout_map (performed_on, workout_id)
  SELECT performed_on, id FROM ins;

  GET DIAGNOSTICS imported_workout_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 4. Build name → id lookup, picking ONE row per LOWER(name).
  --
  -- After step 2 the user's library contains every exercise we need under
  -- some casing, but it may also contain pre-existing case-variant
  -- duplicates we didn't create. Joining sets directly to `exercises` on
  -- LOWER(name) would multiply each set row by however many duplicates
  -- exist. The map flattens that: oldest row by created_at wins (most
  -- likely the canonical one the user has been using), id breaks ties for
  -- determinism.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _exercise_map (
    name_lower text PRIMARY KEY,
    exercise_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _exercise_map (name_lower, exercise_id)
  SELECT DISTINCT ON (LOWER(e.name))
    LOWER(e.name),
    e.id
  FROM exercises e
  WHERE e.user_id = target_user_id
  ORDER BY LOWER(e.name), e.created_at ASC, e.id ASC;

  -- --------------------------------------------------------------------------
  -- 5. Insert sets. Position is 0-indexed across the workout, derived from
  --    import row order so exercise grouping is preserved.
  -- --------------------------------------------------------------------------
  WITH numbered AS (
    SELECT
      i.rownum,
      i.performed_on,
      i.exercise_name,
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
  JOIN _exercise_map em ON em.name_lower = LOWER(n.exercise_name)
  ORDER BY n.performed_on, n.rownum;

  GET DIAGNOSTICS imported_set_count = ROW_COUNT;

  RAISE NOTICE 'Imported % new exercise(s), % workout(s), % set(s).',
    imported_exercise_count, imported_workout_count, imported_set_count;

END
$migration$;

COMMIT;
