-- ============================================================================
-- Shaan — training history migration
-- ============================================================================
-- One-shot import of Shaan's workout history (2026-04-13 → 2026-06-09) into a
-- Squad user account. Source: history-shaan.csv (flat per-set export).
--
-- USAGE
--   1. Replace the literal UUID on the `target_user_id` line below.
--   2. Paste the entire file into the Supabase SQL editor and Run.
--   3. Everything is wrapped in a transaction (BEGIN / COMMIT).
--
-- NAMING / GROUPING (Joar-style decomposition)
--   Equipment is STRIPPED from the raw export name and stored as a tag, and
--   exercises are deduped by (LOWER(name), equipment). Where a raw name encoded
--   a movement variant that is still grouped under one exercise, it is stored
--   as a `variation` (user_field_options kind='variation', referenced per-set
--   and listed in exercises.variations). Each exercise gets one category and
--   1-2 parent muscle-group keys from the signup defaults
--   (see src/lib/exercise-options.ts). No child muscles are assigned.
--
--   24 raw names → 22 logical exercises. Mappings:
--     "Flat Barbell Bench Press"            -> Flat Bench Press / barbell
--     "Flat Dumbbell Bench Press"           -> Flat Bench Press / dumbbell
--     "Incline Dumbbell Bench Press"        -> Incline Bench Press / dumbbell
--     "Barbell Squat"                       -> Squat / barbell
--     "Bulgarian Dumbbell Squat"            -> Bulgarian Split Squat / dumbbell
--     "Cable Curl"                          -> Bicep Curl / cable
--     "Faceaway Cable Bicep Curl"           -> Bicep Curl / cable / faceaway
--     "Barbell Curl"                        -> Bicep Curl / barbell
--     "Cable Tricep Extension"              -> Triceps Extension / cable
--     "Cable Overhead Triceps Extension"    -> Triceps Extension / cable / overhead
--     "Seated Cable Row"                    -> Seated Row / cable
--     "Cable Chest Fly"                     -> Chest Fly / cable
--     "Dumbbell Shoulder Press"             -> Shoulder Press / dumbbell
--     "Dumbbell Calf Raise"                 -> Calf Raise / dumbbell
--     "Tricep Dips"                         -> Dip / bodyweight        (is_bodyweight)
--     "Sit-ups"                             -> Sit-up / bodyweight     (is_bodyweight)
--     "Press Up (Split With Bench Press)"   -> Press Up / bodyweight   (is_bodyweight)
--     "Kettle Warmup X 20 @ 12kg"           -> Kettlebell Warmup / kettlebell
--     "Sledge Push"                         -> Sledge Push / (none)
--   Variation pool: overhead, faceaway.
--
--   double_reps (x2 reps) is ON for every dumbbell exercise plus Chest Fly.
--
-- CATEGORIES
--   Rowing Machine = 'cardio'; Sledge Push = 'conditioning';
--   Kettlebell Warmup = 'functional'; everything else = 'resistance'.
--
-- CARDIO
--   "Rowing Machine" tracks distance in metres (distance_unit='m') and time
--   (track_time=true, time_unit='min'), reps off. Source 500 m -> distance_km
--   =0.5; time H:MM:SS -> duration_sec (0:02:00→120, 0:02:10→130, 0:02:20→140);
--   a logged "0:00:00" -> NULL.
--
-- WORKOUTS
--   No session titles in the source, so each date is named after the parent
--   muscle groups trained that day (primary muscle per exercise, in
--   first-appearance order). session_type='workout'.
--
-- All tracking flags BOOLEAN except track_calories (INTEGER).
-- ============================================================================

BEGIN;

DO $migration$
DECLARE
  -- ▼▼▼ REPLACE THIS WITH SHAAN'S USER UUID ▼▼▼
  target_user_id uuid := '00000000-0000-0000-0000-000000000000';
  -- ▲▲▲ REPLACE THIS WITH SHAAN'S USER UUID ▲▲▲

  imported_equipment_count int;
  imported_variation_count int;
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
  -- Staging: every logged set, in import order. weight_kg/reps are NULL where
  -- the source had none (Rowing Machine logs distance/time only). Position is
  -- derived later, 0-indexed per session, from rownum order.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _import (
    rownum bigserial PRIMARY KEY,
    performed_on date NOT NULL,
    exercise_name text NOT NULL,
    equipment_key text,
    variation_key text,
    weight_kg numeric,
    reps int,
    distance_km numeric,
    duration_sec int
  ) ON COMMIT DROP;

  INSERT INTO _import (performed_on, exercise_name, equipment_key, variation_key, weight_kg, reps, distance_km, duration_sec) VALUES
    -- ===== 2026-04-13 =====
    ('2026-04-13', 'Rowing Machine',    NULL,      NULL, NULL, NULL, 0.5, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 20,   8,    NULL, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 30,   8,    NULL, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 40,   5,    NULL, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 40,   5,    NULL, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 45,   5,    NULL, NULL),
    ('2026-04-13', 'Flat Bench Press',  'barbell', NULL, 45,   3,    NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 20,   10,   NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 40,   8,    NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 40,   8,    NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 45,   5,    NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 50,   5,    NULL, NULL),
    ('2026-04-13', 'Squat',             'barbell', NULL, 50,   5,    NULL, NULL),
    ('2026-04-13', 'Romanian Deadlift', 'barbell', NULL, 50,   5,    NULL, NULL),
    ('2026-04-13', 'Romanian Deadlift', 'barbell', NULL, 50,   5,    NULL, NULL),
    ('2026-04-13', 'Romanian Deadlift', 'barbell', NULL, 50,   5,    NULL, NULL),
    ('2026-04-13', 'Bicep Curl',        'cable',   NULL, 45,   8,    NULL, NULL),
    ('2026-04-13', 'Bicep Curl',        'cable',   NULL, 45,   5,    NULL, NULL),
    ('2026-04-13', 'Bicep Curl',        'cable',   NULL, 45,   5,    NULL, NULL),
    -- ===== 2026-04-14 =====
    ('2026-04-14', 'Rowing Machine', NULL, NULL, NULL, NULL, 0.5, NULL),
    -- ===== 2026-04-20 =====
    ('2026-04-20', 'Kettlebell Warmup',  'kettlebell', NULL,       12, 20, NULL, NULL),
    ('2026-04-20', 'Sledge Push',        NULL,         NULL,       80, 5,  NULL, NULL),
    ('2026-04-20', 'Squat',              'barbell',    NULL,       20, 10, NULL, NULL),
    ('2026-04-20', 'Squat',              'barbell',    NULL,       40, 8,  NULL, NULL),
    ('2026-04-20', 'Squat',              'barbell',    NULL,       40, 8,  NULL, NULL),
    ('2026-04-20', 'Squat',              'barbell',    NULL,       45, 5,  NULL, NULL),
    ('2026-04-20', 'Squat',              'barbell',    NULL,       45, 5,  NULL, NULL),
    ('2026-04-20', 'Romanian Deadlift',  'barbell',    NULL,       45, 5,  NULL, NULL),
    ('2026-04-20', 'Romanian Deadlift',  'barbell',    NULL,       45, 5,  NULL, NULL),
    ('2026-04-20', 'Romanian Deadlift',  'barbell',    NULL,       50, 5,  NULL, NULL),
    ('2026-04-20', 'Bicep Curl',         'cable',      NULL,       40, 5,  NULL, NULL),
    ('2026-04-20', 'Bicep Curl',         'cable',      NULL,       45, 3,  NULL, NULL),
    ('2026-04-20', 'Triceps Extension',  'cable',      'overhead', 40, 8,  NULL, NULL),
    ('2026-04-20', 'Triceps Extension',  'cable',      'overhead', 45, 6,  NULL, NULL),
    ('2026-04-20', 'Triceps Extension',  'cable',      'overhead', 50, 5,  NULL, NULL),
    -- ===== 2026-04-27 =====
    ('2026-04-27', 'Squat',            'barbell',    NULL, 30,   10, NULL, NULL),
    ('2026-04-27', 'Squat',            'barbell',    NULL, 40,   8,  NULL, NULL),
    ('2026-04-27', 'Squat',            'barbell',    NULL, 40,   8,  NULL, NULL),
    ('2026-04-27', 'Squat',            'barbell',    NULL, 45,   8,  NULL, NULL),
    ('2026-04-27', 'Squat',            'barbell',    NULL, 50,   8,  NULL, NULL),
    ('2026-04-27', 'Flat Bench Press', 'barbell',    NULL, 20,   10, NULL, NULL),
    ('2026-04-27', 'Flat Bench Press', 'barbell',    NULL, 40,   8,  NULL, NULL),
    ('2026-04-27', 'Flat Bench Press', 'barbell',    NULL, 40,   8,  NULL, NULL),
    ('2026-04-27', 'Flat Bench Press', 'barbell',    NULL, 40,   8,  NULL, NULL),
    ('2026-04-27', 'Flat Bench Press', 'barbell',    NULL, 45,   5,  NULL, NULL),
    ('2026-04-27', 'Bicep Curl',       'barbell',    NULL, 20,   8,  NULL, NULL),
    ('2026-04-27', 'Bicep Curl',       'barbell',    NULL, 20,   8,  NULL, NULL),
    ('2026-04-27', 'Bicep Curl',       'barbell',    NULL, 20,   8,  NULL, NULL),
    ('2026-04-27', 'Bicep Curl',       'barbell',    NULL, 22.5, 8,  NULL, NULL),
    ('2026-04-27', 'Bicep Curl',       'barbell',    NULL, 22.5, 8,  NULL, NULL),
    ('2026-04-27', 'Dip',              'bodyweight', NULL, NULL, 10, NULL, NULL),
    ('2026-04-27', 'Dip',              'bodyweight', NULL, NULL, 10, NULL, NULL),
    ('2026-04-27', 'Dip',              'bodyweight', NULL, NULL, 18, NULL, NULL),
    ('2026-04-27', 'Sit-up',           'bodyweight', NULL, NULL, 30, NULL, NULL),
    -- ===== 2026-05-07 =====
    ('2026-05-07', 'Rowing Machine',   NULL,         NULL, NULL, NULL, 0.5, 120),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 20,   12,   NULL, NULL),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 20,   12,   NULL, NULL),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 40,   8,    NULL, NULL),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 40,   8,    NULL, NULL),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 45,   6,    NULL, NULL),
    ('2026-05-07', 'Flat Bench Press', 'barbell',    NULL, 50,   6,    NULL, NULL),
    ('2026-05-07', 'Press Up',         'bodyweight', NULL, NULL, 8,    NULL, NULL),
    ('2026-05-07', 'Press Up',         'bodyweight', NULL, NULL, 8,    NULL, NULL),
    ('2026-05-07', 'Press Up',         'bodyweight', NULL, NULL, 8,    NULL, NULL),
    ('2026-05-07', 'Chest Fly',        'cable',      NULL, 25,   8,    NULL, NULL),
    ('2026-05-07', 'Chest Fly',        'cable',      NULL, 30,   8,    NULL, NULL),
    ('2026-05-07', 'Chest Fly',        'cable',      NULL, 30,   6,    NULL, NULL),
    ('2026-05-07', 'Lat Pulldown',     'cable',      NULL, 65,   10,   NULL, NULL),
    ('2026-05-07', 'Lat Pulldown',     'cable',      NULL, 75,   10,   NULL, NULL),
    ('2026-05-07', 'Lat Pulldown',     'cable',      NULL, 80,   10,   NULL, NULL),
    ('2026-05-07', 'Seated Row',       'cable',      NULL, 60,   10,   NULL, NULL),
    ('2026-05-07', 'Seated Row',       'cable',      NULL, 70,   10,   NULL, NULL),
    ('2026-05-07', 'Seated Row',       'cable',      NULL, 75,   8,    NULL, NULL),
    -- ===== 2026-05-08 =====
    ('2026-05-08', 'Squat',                'barbell',  NULL, 20,  10, NULL, NULL),
    ('2026-05-08', 'Squat',                'barbell',  NULL, 40,  10, NULL, NULL),
    ('2026-05-08', 'Squat',                'barbell',  NULL, 50,  8,  NULL, NULL),
    ('2026-05-08', 'Squat',                'barbell',  NULL, 60,  6,  NULL, NULL),
    ('2026-05-08', 'Squat',                'barbell',  NULL, 60,  8,  NULL, NULL),
    ('2026-05-08', 'Zercher Deadlift',     'barbell',  NULL, 40,  6,  NULL, NULL),
    ('2026-05-08', 'Romanian Deadlift',    'barbell',  NULL, 40,  8,  NULL, NULL),
    ('2026-05-08', 'Romanian Deadlift',    'barbell',  NULL, 45,  8,  NULL, NULL),
    ('2026-05-08', 'Leg Press',            'machine',  NULL, 176, 6,  NULL, NULL),
    ('2026-05-08', 'Leg Press',            'machine',  NULL, 126, 8,  NULL, NULL),
    ('2026-05-08', 'Leg Press',            'machine',  NULL, 146, 8,  NULL, NULL),
    ('2026-05-08', 'Leg Press',            'machine',  NULL, 176, 6,  NULL, NULL),
    ('2026-05-08', 'Incline Bench Press',  'dumbbell', NULL, 18,  8,  NULL, NULL),
    ('2026-05-08', 'Bicep Curl',           'barbell',  NULL, 25,  6,  NULL, NULL),
    -- ===== 2026-05-11 =====
    ('2026-05-11', 'Rowing Machine',     NULL,         NULL,       NULL, NULL, 0.5, 130),
    ('2026-05-11', 'Flat Bench Press',   'dumbbell',   NULL,       12.5, 10,   NULL, NULL),
    ('2026-05-11', 'Dip',                'bodyweight', NULL,       NULL, 10,   NULL, NULL),
    ('2026-05-11', 'Flat Bench Press',   'dumbbell',   NULL,       12.5, 10,   NULL, NULL),
    ('2026-05-11', 'Dip',                'bodyweight', NULL,       NULL, 10,   NULL, NULL),
    ('2026-05-11', 'Flat Bench Press',   'dumbbell',   NULL,       15,   10,   NULL, NULL),
    ('2026-05-11', 'Dip',                'bodyweight', NULL,       NULL, 10,   NULL, NULL),
    ('2026-05-11', 'Triceps Extension',  'cable',      NULL,       40,   10,   NULL, NULL),
    ('2026-05-11', 'Triceps Extension',  'cable',      NULL,       45,   10,   NULL, NULL),
    ('2026-05-11', 'Triceps Extension',  'cable',      'overhead', 20,   8,    NULL, NULL),
    ('2026-05-11', 'Triceps Extension',  'cable',      'overhead', 25,   8,    NULL, NULL),
    ('2026-05-11', 'Bicep Curl',         'cable',      'faceaway', 30,   10,   NULL, NULL),
    ('2026-05-11', 'Bicep Curl',         'cable',      'faceaway', 30,   8,    NULL, NULL),
    ('2026-05-11', 'Seated Row',         'cable',      NULL,       75,   10,   NULL, NULL),
    ('2026-05-11', 'Seated Row',         'cable',      NULL,       80,   8,    NULL, NULL),
    ('2026-05-11', 'Seated Row',         'cable',      NULL,       85,   8,    NULL, NULL),
    ('2026-05-11', 'Bicep Curl',         'barbell',    NULL,       20,   8,    NULL, NULL),
    ('2026-05-11', 'Bicep Curl',         'barbell',    NULL,       25,   6,    NULL, NULL),
    ('2026-05-11', 'Flat Bench Press',   'barbell',    NULL,       20,   10,   NULL, NULL),
    ('2026-05-11', 'Flat Bench Press',   'barbell',    NULL,       45,   6,    NULL, NULL),
    ('2026-05-11', 'Flat Bench Press',   'barbell',    NULL,       45,   6,    NULL, NULL),
    -- ===== 2026-05-13 =====
    ('2026-05-13', 'Rowing Machine',     NULL,      NULL, NULL, NULL, 0.5, 130),
    ('2026-05-13', 'Chest Fly',          'cable',   NULL, 20,   10,   NULL, NULL),
    ('2026-05-13', 'Chest Fly',          'cable',   NULL, 25,   8,    NULL, NULL),
    ('2026-05-13', 'Flat Bench Press',   'barbell', NULL, 20,   10,   NULL, NULL),
    ('2026-05-13', 'Flat Bench Press',   'barbell', NULL, 40,   6,    NULL, NULL),
    ('2026-05-13', 'Flat Bench Press',   'barbell', NULL, 40,   6,    NULL, NULL),
    ('2026-05-13', 'Lat Pulldown',       'cable',   NULL, 75,   8,    NULL, NULL),
    ('2026-05-13', 'Lat Pulldown',       'cable',   NULL, 80,   8,    NULL, NULL),
    ('2026-05-13', 'Lat Pulldown',       'cable',   NULL, 80,   8,    NULL, NULL),
    ('2026-05-13', 'Lat Pulldown',       'cable',   NULL, 80,   8,    NULL, NULL),
    ('2026-05-13', 'Romanian Deadlift',  'barbell', NULL, 40,   8,    NULL, NULL),
    ('2026-05-13', 'Romanian Deadlift',  'barbell', NULL, 50,   6,    NULL, NULL),
    -- ===== 2026-05-15 =====
    ('2026-05-15', 'Rowing Machine',         NULL,       NULL, NULL, NULL, 0.5, 130),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 20,   10,   NULL, NULL),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 40,   8,    NULL, NULL),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 50,   8,    NULL, NULL),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 60,   6,    NULL, NULL),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 65,   3,    NULL, NULL),
    ('2026-05-15', 'Squat',                  'barbell',  NULL, 65,   3,    NULL, NULL),
    ('2026-05-15', 'Romanian Deadlift',      'barbell',  NULL, 50,   8,    NULL, NULL),
    ('2026-05-15', 'Romanian Deadlift',      'barbell',  NULL, 60,   6,    NULL, NULL),
    ('2026-05-15', 'Romanian Deadlift',      'barbell',  NULL, 60,   6,    NULL, NULL),
    ('2026-05-15', 'Bulgarian Split Squat',  'dumbbell', NULL, 20,   6,    NULL, NULL),
    ('2026-05-15', 'Bulgarian Split Squat',  'dumbbell', NULL, 20,   6,    NULL, NULL),
    -- ===== 2026-06-05 =====
    ('2026-06-05', 'Rowing Machine',     NULL,       NULL, NULL, NULL, 0.5, 140),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 20,   10,   NULL, NULL),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 40,   6,    NULL, NULL),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 40,   6,    NULL, NULL),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 50,   3,    NULL, NULL),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 50,   3,    NULL, NULL),
    ('2026-06-05', 'Flat Bench Press',   'barbell',  NULL, 55,   2,    NULL, NULL),
    ('2026-06-05', 'Lat Pulldown',       'cable',    NULL, 80,   8,    NULL, NULL),
    ('2026-06-05', 'Lat Pulldown',       'cable',    NULL, 90,   6,    NULL, NULL),
    ('2026-06-05', 'Lat Pulldown',       'cable',    NULL, 95,   6,    NULL, NULL),
    ('2026-06-05', 'Shoulder Press',     'dumbbell', NULL, 10,   8,    NULL, NULL),
    ('2026-06-05', 'Shoulder Press',     'dumbbell', NULL, 12.5, 8,    NULL, NULL),
    ('2026-06-05', 'Shoulder Press',     'dumbbell', NULL, 15,   6,    NULL, NULL),
    ('2026-06-05', 'Triceps Extension',  'cable',    NULL, 40,   12,   NULL, NULL),
    ('2026-06-05', 'Bicep Curl',         'cable',    NULL, 35,   10,   NULL, NULL),
    ('2026-06-05', 'Triceps Extension',  'cable',    NULL, 45,   10,   NULL, NULL),
    ('2026-06-05', 'Bicep Curl',         'cable',    NULL, 40,   10,   NULL, NULL),
    ('2026-06-05', 'Triceps Extension',  'cable',    NULL, 50,   5,    NULL, NULL),
    ('2026-06-05', 'Bicep Curl',         'cable',    NULL, 45,   5,    NULL, NULL),
    -- ===== 2026-06-09 =====
    ('2026-06-09', 'Rowing Machine',         NULL,       NULL, NULL, NULL, 0.5, 140),
    ('2026-06-09', 'Squat',                  'barbell',  NULL, 20, 10, NULL, NULL),
    ('2026-06-09', 'Squat',                  'barbell',  NULL, 50, 8,  NULL, NULL),
    ('2026-06-09', 'Squat',                  'barbell',  NULL, 60, 6,  NULL, NULL),
    ('2026-06-09', 'Squat',                  'barbell',  NULL, 70, 3,  NULL, NULL),
    ('2026-06-09', 'Squat',                  'barbell',  NULL, 70, 3,  NULL, NULL),
    ('2026-06-09', 'Romanian Deadlift',      'barbell',  NULL, 50, 8,  NULL, NULL),
    ('2026-06-09', 'Romanian Deadlift',      'barbell',  NULL, 60, 6,  NULL, NULL),
    ('2026-06-09', 'Romanian Deadlift',      'barbell',  NULL, 60, 6,  NULL, NULL),
    ('2026-06-09', 'Bulgarian Split Squat',  'dumbbell', NULL, 20, 6,  NULL, NULL),
    ('2026-06-09', 'Bulgarian Split Squat',  'dumbbell', NULL, 20, 6,  NULL, NULL),
    ('2026-06-09', 'Calf Raise',             'dumbbell', NULL, 20, 8,  NULL, NULL),
    ('2026-06-09', 'Calf Raise',             'dumbbell', NULL, 20, 8,  NULL, NULL)
  ;

  -- --------------------------------------------------------------------------
  -- Workout names per date (parent muscle groups trained, appearance order).
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _workout_names (performed_on date PRIMARY KEY, name text NOT NULL) ON COMMIT DROP;
  INSERT INTO _workout_names (performed_on, name) VALUES
    ('2026-04-13', 'Chest / Legs / Arms'),
    ('2026-04-14', 'Cardio'),
    ('2026-04-20', 'Legs / Arms'),
    ('2026-04-27', 'Legs / Chest / Arms / Core'),
    ('2026-05-07', 'Chest / Upper Back'),
    ('2026-05-08', 'Legs / Chest / Arms'),
    ('2026-05-11', 'Chest / Arms / Upper Back'),
    ('2026-05-13', 'Chest / Upper Back / Legs'),
    ('2026-05-15', 'Legs'),
    ('2026-06-05', 'Chest / Upper Back / Shoulders / Arms'),
    ('2026-06-09', 'Legs');

  -- --------------------------------------------------------------------------
  -- Variation pool (user_field_options, kind='variation'). Idempotent.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _variation (key text PRIMARY KEY, label text NOT NULL, sort int NOT NULL) ON COMMIT DROP;
  INSERT INTO _variation (key, label, sort) VALUES
    ('overhead', 'Overhead', 0),
    ('faceaway', 'Faceaway', 1);

  WITH existing_max AS (
    SELECT COALESCE(MAX(position), -1) AS max_pos
    FROM user_field_options
    WHERE user_id = target_user_id AND kind = 'variation' AND parent_id IS NULL
  ),
  missing AS (
    SELECT v.key, v.label, v.sort, row_number() OVER (ORDER BY v.sort) AS rn
    FROM _variation v
    WHERE NOT EXISTS (
      SELECT 1 FROM user_field_options ufo
      WHERE ufo.user_id = target_user_id AND ufo.kind = 'variation'
        AND ufo.parent_id IS NULL AND ufo.key = v.key
    )
  )
  INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
  SELECT gen_random_uuid(), target_user_id, 'variation', NULL,
         m.key, m.label, (SELECT max_pos FROM existing_max) + m.rn, NOW()
  FROM missing m;

  GET DIAGNOSTICS imported_variation_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Equipment options. Overlap defaults seeded at signup; defensive.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _equipment (key text PRIMARY KEY, label text NOT NULL) ON COMMIT DROP;
  INSERT INTO _equipment (key, label) VALUES
    ('barbell',    'Barbell'),
    ('dumbbell',   'Dumbbell'),
    ('machine',    'Machine'),
    ('cable',      'Cable'),
    ('bodyweight', 'Bodyweight'),
    ('kettlebell', 'Kettlebell');

  WITH existing_max AS (
    SELECT COALESCE(MAX(position), -1) AS max_pos
    FROM user_field_options
    WHERE user_id = target_user_id AND kind = 'equipment' AND parent_id IS NULL
  ),
  missing AS (
    SELECT e.key, e.label, row_number() OVER (ORDER BY e.key) AS rn
    FROM _equipment e
    WHERE NOT EXISTS (
      SELECT 1 FROM user_field_options ufo
      WHERE ufo.user_id = target_user_id AND ufo.kind = 'equipment'
        AND ufo.parent_id IS NULL AND ufo.key = e.key
    )
  )
  INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
  SELECT gen_random_uuid(), target_user_id, 'equipment', NULL,
         m.key, m.label, (SELECT max_pos FROM existing_max) + m.rn, NOW()
  FROM missing m;

  GET DIAGNOSTICS imported_equipment_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Exercise metadata literal table. Keys: (name_lower, equip_key).
  -- equip_key uses '' (empty string) for "no equipment".
  -- --------------------------------------------------------------------------
  WITH distinct_imports AS (
    SELECT DISTINCT ON (LOWER(i.exercise_name), COALESCE(i.equipment_key, ''))
      i.exercise_name AS new_name,
      i.equipment_key AS equip_key
    FROM _import i
    ORDER BY LOWER(i.exercise_name), COALESCE(i.equipment_key, ''), i.rownum
  ),
  exercise_meta(name_lower, equip_key, is_bw, track_reps, double_reps, categories, muscles,
                distance_unit, track_time, time_unit, variations) AS (
    VALUES
      ('rowing machine',        NULL,         false, false, false, ARRAY['cardio'],       CAST(NULL AS text[]),       'm',  true,  'min', CAST(ARRAY[]::text[] AS text[])),
      ('flat bench press',      'barbell',    false, true,  false, ARRAY['resistance'],   ARRAY['chest'],             NULL, false, NULL,  ARRAY[]::text[]),
      ('flat bench press',      'dumbbell',   false, true,  true,  ARRAY['resistance'],   ARRAY['chest'],             NULL, false, NULL,  ARRAY[]::text[]),
      ('incline bench press',   'dumbbell',   false, true,  true,  ARRAY['resistance'],   ARRAY['chest'],             NULL, false, NULL,  ARRAY[]::text[]),
      ('chest fly',             'cable',      false, true,  true,  ARRAY['resistance'],   ARRAY['chest'],             NULL, false, NULL,  ARRAY[]::text[]),
      ('press up',              'bodyweight', true,  true,  false, ARRAY['resistance'],   ARRAY['chest'],             NULL, false, NULL,  ARRAY[]::text[]),
      ('squat',                 'barbell',    false, true,  false, ARRAY['resistance'],   ARRAY['legs'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('bulgarian split squat', 'dumbbell',   false, true,  true,  ARRAY['resistance'],   ARRAY['legs'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('romanian deadlift',     'barbell',    false, true,  false, ARRAY['resistance'],   ARRAY['legs','upper back'], NULL, false, NULL,  ARRAY[]::text[]),
      ('zercher deadlift',      'barbell',    false, true,  false, ARRAY['resistance'],   ARRAY['legs','upper back'], NULL, false, NULL,  ARRAY[]::text[]),
      ('leg press',             'machine',    false, true,  false, ARRAY['resistance'],   ARRAY['legs'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('calf raise',            'dumbbell',   false, true,  true,  ARRAY['resistance'],   ARRAY['legs'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('sledge push',           NULL,         false, true,  false, ARRAY['conditioning'], ARRAY['legs'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('kettlebell warmup',     'kettlebell', false, true,  false, ARRAY['functional'],   CAST(NULL AS text[]),       NULL, false, NULL,  ARRAY[]::text[]),
      ('lat pulldown',          'cable',      false, true,  false, ARRAY['resistance'],   ARRAY['upper back'],        NULL, false, NULL,  ARRAY[]::text[]),
      ('seated row',            'cable',      false, true,  false, ARRAY['resistance'],   ARRAY['upper back'],        NULL, false, NULL,  ARRAY[]::text[]),
      ('shoulder press',        'dumbbell',   false, true,  true,  ARRAY['resistance'],   ARRAY['shoulders'],         NULL, false, NULL,  ARRAY[]::text[]),
      ('bicep curl',            'cable',      false, true,  false, ARRAY['resistance'],   ARRAY['arms'],              NULL, false, NULL,  ARRAY['faceaway']),
      ('bicep curl',            'barbell',    false, true,  false, ARRAY['resistance'],   ARRAY['arms'],              NULL, false, NULL,  ARRAY[]::text[]),
      ('triceps extension',     'cable',      false, true,  false, ARRAY['resistance'],   ARRAY['arms'],              NULL, false, NULL,  ARRAY['overhead']),
      ('dip',                   'bodyweight', true,  true,  false, ARRAY['resistance'],   ARRAY['arms','chest'],      NULL, false, NULL,  ARRAY[]::text[]),
      ('sit-up',                'bodyweight', true,  true,  false, ARRAY['resistance'],   ARRAY['core'],              NULL, false, NULL,  ARRAY[]::text[])
  ),
  missing AS (
    SELECT
      di.new_name, di.equip_key,
      em.is_bw, em.track_reps, em.double_reps, em.categories, em.muscles,
      em.distance_unit, em.track_time, em.time_unit, em.variations
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
  INSERT INTO exercises (
    id, user_id, name, categories, equipment,
    is_bodyweight, track_reps, default_weight_kg, double_reps,
    distance_unit, track_time, time_unit,
    track_resistance, track_speed, speed_unit,
    track_incline, incline_unit, track_rest, track_calories,
    muscles, secondary_muscles, variations, created_at
  )
  SELECT
    gen_random_uuid(),
    target_user_id,
    new_name,
    categories,
    equip_key,
    is_bw,                         -- is_bodyweight
    track_reps,                    -- track_reps (false for cardio rower)
    0,                             -- default_weight_kg
    double_reps,                   -- double_reps (x2) — dumbbell exercises + chest fly
    distance_unit,                 -- distance_unit ('m' for rower else NULL)
    track_time,                    -- track_time
    time_unit,                     -- time_unit
    false,                         -- track_resistance
    false, NULL,                   -- track_speed, speed_unit
    false, NULL,                   -- track_incline, incline_unit
    false,                         -- track_rest
    0,                             -- track_calories (INTEGER)
    muscles,
    NULL,                          -- secondary_muscles
    variations,                    -- variations (text[])
    NOW()
  FROM missing;

  GET DIAGNOSTICS imported_exercise_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Workouts: one per distinct date, name from _workout_names.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _workout_map (
    performed_on date PRIMARY KEY,
    workout_id uuid NOT NULL
  ) ON COMMIT DROP;

  WITH ins AS (
    INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
    SELECT
      gen_random_uuid(), target_user_id, wn.name, d.performed_on, 'workout', NULL, NOW(), NOW()
    FROM (SELECT DISTINCT performed_on FROM _import) d
    JOIN _workout_names wn USING (performed_on)
    RETURNING id, performed_on
  )
  INSERT INTO _workout_map (performed_on, workout_id)
  SELECT performed_on, id FROM ins;

  GET DIAGNOSTICS imported_workout_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Exercise lookup: (LOWER(name), equipment) → exercise_id. Oldest row wins.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _exercise_map (
    name_lower text NOT NULL,
    equip_key text,
    exercise_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _exercise_map (name_lower, equip_key, exercise_id)
  SELECT DISTINCT ON (LOWER(e.name), e.equipment)
    LOWER(e.name), e.equipment, e.id
  FROM exercises e
  WHERE e.user_id = target_user_id
  ORDER BY LOWER(e.name), e.equipment, e.created_at ASC, e.id ASC;

  -- --------------------------------------------------------------------------
  -- Sets. Position 0-indexed across the workout, from import row order.
  -- --------------------------------------------------------------------------
  WITH numbered AS (
    SELECT
      i.*,
      (row_number() OVER (PARTITION BY i.performed_on ORDER BY i.rownum) - 1)::int AS position
    FROM _import i
  )
  INSERT INTO sets (
    id, user_id, performed_on, workout_id, exercise_id, position,
    reps, weight_kg, distance_km, duration_sec,
    resistance, speed_ms, incline_pct, rest_sec,
    circuit_id, circuit_rounds, circuit_name,
    variation, notes, notes_public
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
    n.distance_km,
    n.duration_sec,
    NULL, NULL, NULL, NULL,
    NULL, NULL, NULL,
    n.variation_key,
    NULL,
    false
  FROM numbered n
  JOIN _workout_map wm ON wm.performed_on = n.performed_on
  JOIN _exercise_map em
    ON em.name_lower = LOWER(n.exercise_name)
   AND em.equip_key IS NOT DISTINCT FROM n.equipment_key
  ORDER BY n.performed_on, n.rownum;

  GET DIAGNOSTICS imported_set_count = ROW_COUNT;

  RAISE NOTICE 'Shaan import: % equipment option(s), % variation(s), % exercise(s), % workout(s), % set(s).',
    imported_equipment_count, imported_variation_count,
    imported_exercise_count, imported_workout_count, imported_set_count;

END
$migration$;

COMMIT;
