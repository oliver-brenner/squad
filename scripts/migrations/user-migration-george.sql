-- ============================================================================
-- George — 3-DAY plan migration
-- ============================================================================
-- One-shot import of George's "3-DAY" training programme history into Squad.
-- 13 weeks × 3 lifting days (Mon/Wed/Fri), ending the week of 2026-06-01.
--
-- USAGE
--   1. Replace the literal UUID on the `target_user_id` line below.
--   2. Paste the entire file into the Supabase SQL editor and Run.
--   3. Everything is wrapped in a transaction (BEGIN / COMMIT).
--
-- DATE MAPPING
--   Source data lives in the 3-DAY sheet of his Excel log with weeks laid out
--   left-to-right (Week 13 first = most recent). Each week is mapped to:
--     Lifting Day 1 → Monday
--     Lifting Day 2 → Wednesday
--     Lifting Day 3 → Friday
--   Week 13 anchors at 2026-06-01 (Mon), with each prior week one week earlier.
--   Korea-break weeks (5 & 6) are included with the natural numbering — they
--   contained logged sets per the source.
--
-- NAMING / GROUPING (decided collaboratively pre-write)
--   25 logical exercises emerge from 34 raw names. Equipment is stored as a
--   tag (matching the Joar migration). Variations are stored as a global
--   user_field_options pool (kind='variation') referenced by sets.variation
--   and listed per-exercise in exercises.variations.
--
--   Notable groupings:
--     • Romanian Deadlift = RDL
--     • Hack Squat = HACK SQ; Leg Extension = LEG EXT
--     • Dip (no equipment, is_bodyweight=true): variations 4-sec pause /
--       weighted, covers '4SC PAUSE DIPS' + 'WEIGHTED DIPS'
--     • Pull Up (bodyweight, variation 'neutral grip') = NEUT PULL UP
--     • Lateral Raise (no equipment): variations standing db / incline 1-arm
--       db / machine, covers DB LAT RAISE + INCLINE LAT RAISE 1-ARM +
--       LAT RAISE MACH + SIDE LAT MACH
--     • Shrug (dumbbell) = DB SHRUG + DB TRAPS
--     • Overhead Extension (ez bar) variations seated / standing = SEATED EZ
--       OVERHEAD + EZ OVERHEAD
--     • Curl (dumbbell) variations standing / incline / hammer = DB CURL +
--       INCLINE CURL + HAMMER CURL; Curl (ez bar) separate; Preacher Curl
--       (ez bar) separate
--     • Skull Crusher (ez bar) variation 'lying' = EZ BAR LYING SKULL
--     • Seated Row (machine) variation 'low grip'
--     • 'SS Reverse Curl' kept verbatim, no equipment
--   Skipped: DB LYING SKULL CRUSH (sole row had unparseable result '10kgxXX').
--
-- NOTES
--   • Per-exercise notes (e.g. 'FOCUS', 'ELBOWS TUCKED IN', 'myo rep sets',
--     'next 34kg') from the source 'Notes' column are stored on
--     sets.notes with sets.notes_public=true.
--   • Session-level feedback (e.g. 'back from russia 1stday', 'easing back
--     into') from the source 'Feedback' column is stored on workouts.notes
--     with workouts.notes_public=true. Multiple feedbacks on a single day are
--     joined with newlines.
--
-- RESULT PARSING
--   'WkgxR1xR2xR3'  → three sets at W kg with R1, R2, R3 reps
--   'WkgxR1 WkgxR2' → two sets at potentially different weights
--   'FREEx10x6x5'   → bodyweight, three sets 10/6/5 reps
--   'NUMxNUM…'      → bodyweight, reps only
--   Trailing 'x' with no number = dropped (uncompleted set).
--   '?' on a number = use the number anyway. '9/10' = use 9.
--
-- All tracking flags BOOLEAN except track_calories (INTEGER).
-- ============================================================================

BEGIN;

DO $migration$
DECLARE
  -- ▼▼▼ REPLACE THIS WITH GEORGE'S USER UUID ▼▼▼
  target_user_id uuid := 'd5111a95-96f6-4b6b-9c7b-4a6b9139fca1';
  -- ▲▲▲ REPLACE THIS WITH GEORGE'S USER UUID ▲▲▲

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
  -- Staging: every logged set, in import order. Position is already 0-indexed
  -- per session in the source — preserve it verbatim.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _import (
    rownum bigserial PRIMARY KEY,
    performed_on date NOT NULL,
    workout_name text NOT NULL,
    exercise_name text NOT NULL,
    equipment_key text,
    variation_key text,
    ex_note text,
    weight_kg numeric,
    reps int NOT NULL,
    position int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _import (performed_on, workout_name, exercise_name, equipment_key, variation_key, ex_note, weight_kg, reps, position) VALUES
    -- ===== 2026-06-01 (Lifting Day 1) =====
    ('2026-06-01', 'Lifting Day 1', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 5, 0),
    ('2026-06-01', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 11, 1),
    ('2026-06-01', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 6, 2),
    ('2026-06-01', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 40, 11, 3),
    ('2026-06-01', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 40, 7, 4),
    ('2026-06-01', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 13, 5),
    ('2026-06-01', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 6),
    ('2026-06-01', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 5, 7),
    ('2026-06-01', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 59, 13, 8),
    ('2026-06-01', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 59, 7, 9),
    ('2026-06-01', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 14, 10),
    ('2026-06-01', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 8, 11),
    ('2026-06-01', 'Lifting Day 1', 'Wrist Curl', 'cable', NULL, NULL, 68, 13, 12),
    -- ===== 2026-06-03 (Lifting Day 2) =====
    ('2026-06-03', 'Lifting Day 2', 'Leg Press', 'machine', NULL, NULL, 310, 9, 0),
    ('2026-06-03', 'Lifting Day 2', 'Leg Press', 'machine', NULL, NULL, 310, 7, 1),
    ('2026-06-03', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 32, 9, 2),
    ('2026-06-03', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 28, 7, 3),
    ('2026-06-03', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 4),
    ('2026-06-03', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 5),
    ('2026-06-03', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 6),
    ('2026-06-03', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 12, 7),
    ('2026-06-03', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 8, 8),
    ('2026-06-03', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 8, 9),
    ('2026-06-03', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 6, 10),
    ('2026-06-03', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 18, 6, 11),
    ('2026-06-03', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 14, 8, 12),
    ('2026-06-03', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 68, 10, 13),
    ('2026-06-03', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 68, 64, 14),
    ('2026-06-03', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 68, 7, 15),
    ('2026-06-03', 'Lifting Day 2', 'SS Reverse Curl', NULL, NULL, NULL, 27, 7, 16),
    -- ===== 2026-06-05 (Lifting Day 3) =====
    ('2026-06-05', 'Lifting Day 3', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 8, 0),
    ('2026-06-05', 'Lifting Day 3', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 6, 1),
    ('2026-06-05', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 9, 2),
    ('2026-06-05', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 6, 3),
    ('2026-06-05', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 6, 9, 4),
    ('2026-06-05', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 6, 6, 5),
    ('2026-06-05', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 13, 6),
    ('2026-06-05', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 9, 7),
    ('2026-06-05', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 18, 6, 8),
    ('2026-06-05', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 9),
    ('2026-06-05', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 12, 10),
    ('2026-06-05', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 7, 11),
    ('2026-06-05', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 4, 12),
    ('2026-06-05', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 73, 9, 13),
    ('2026-06-05', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 73, 6, 14),
    ('2026-06-05', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 68, 9, 15),
    ('2026-06-05', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 64, 7, 16),
    -- ===== 2026-05-25 (Lifting Day 1) =====
    ('2026-05-25', 'Lifting Day 1', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 6, 0),
    ('2026-05-25', 'Lifting Day 1', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 5, 1),
    ('2026-05-25', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 10, 2),
    ('2026-05-25', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 7, 3),
    ('2026-05-25', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 40, 9, 4),
    ('2026-05-25', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 40, 7, 5),
    ('2026-05-25', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 10, 6),
    ('2026-05-25', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 7),
    ('2026-05-25', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 54, 11, 8),
    ('2026-05-25', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 50, 10, 9),
    ('2026-05-25', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 35, 6, 10),
    ('2026-05-25', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 8, 11),
    ('2026-05-25', 'Lifting Day 1', 'Wrist Curl', 'cable', NULL, NULL, 68, 13, 12),
    -- ===== 2026-05-27 (Lifting Day 2) =====
    ('2026-05-27', 'Lifting Day 2', 'Leg Press', 'machine', NULL, NULL, 300, 11, 0),
    ('2026-05-27', 'Lifting Day 2', 'Leg Press', 'machine', NULL, NULL, 300, 7, 1),
    ('2026-05-27', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 32, 7, 2),
    ('2026-05-27', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 28, 7, 3),
    ('2026-05-27', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 9, 4),
    ('2026-05-27', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 5),
    ('2026-05-27', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 6),
    ('2026-05-27', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 10, 7),
    ('2026-05-27', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 6, 8),
    ('2026-05-27', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 10, 9),
    ('2026-05-27', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 6, 10),
    ('2026-05-27', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 16, 8, 11),
    ('2026-05-27', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 14, 8, 12),
    ('2026-05-27', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 37.4, 9, 13),
    ('2026-05-27', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 37.4, 6, 14),
    ('2026-05-27', 'Lifting Day 2', 'SS Reverse Curl', NULL, NULL, NULL, 19, 9, 15),
    ('2026-05-27', 'Lifting Day 2', 'SS Reverse Curl', NULL, NULL, NULL, 19, 6, 16),
    -- ===== 2026-05-29 (Lifting Day 3) =====
    ('2026-05-29', 'Lifting Day 3', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 8, 0),
    ('2026-05-29', 'Lifting Day 3', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 6, 1),
    ('2026-05-29', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 9, 2),
    ('2026-05-29', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 6, 3),
    ('2026-05-29', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 6, 9, 4),
    ('2026-05-29', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 6, 6, 5),
    ('2026-05-29', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 13, 6),
    ('2026-05-29', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 9, 7),
    ('2026-05-29', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 18, 6, 8),
    ('2026-05-29', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 9),
    ('2026-05-29', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 12, 10),
    ('2026-05-29', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 7, 11),
    ('2026-05-29', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 4, 12),
    ('2026-05-29', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 73, 9, 13),
    ('2026-05-29', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 73, 6, 14),
    ('2026-05-29', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 68, 9, 15),
    ('2026-05-29', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 64, 7, 16),
    -- ===== 2026-05-18 (Lifting Day 1) =====
    ('2026-05-18', 'Lifting Day 1', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 6, 0),
    ('2026-05-18', 'Lifting Day 1', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 6, 1),
    ('2026-05-18', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 9, 2),
    ('2026-05-18', 'Lifting Day 1', 'Dip', NULL, '4-sec pause', NULL, NULL, 7, 3),
    ('2026-05-18', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 40, 7, 4),
    ('2026-05-18', 'Lifting Day 1', 'Seated Row', 'machine', 'low grip', 'Low Grip', 30, 10, 5),
    ('2026-05-18', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 9, 6),
    ('2026-05-18', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 7),
    ('2026-05-18', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 7, 8),
    ('2026-05-18', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 50, 15, 9),
    ('2026-05-18', 'Lifting Day 1', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 50, 9, 10),
    ('2026-05-18', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 35, 8, 11),
    ('2026-05-18', 'Lifting Day 1', 'Preacher Curl', 'ez bar', NULL, NULL, 32.5, 7, 12),
    ('2026-05-18', 'Lifting Day 1', 'Wrist Curl', 'cable', NULL, NULL, 68, 11, 13),
    ('2026-05-18', 'Lifting Day 1', 'Wrist Curl', 'cable', NULL, NULL, 68, 8, 14),
    -- ===== 2026-05-20 (Lifting Day 2) =====
    ('2026-05-20', 'Lifting Day 2', 'Leg Press', 'machine', NULL, NULL, 300, 10, 0),
    ('2026-05-20', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 32, 7, 1),
    ('2026-05-20', 'Lifting Day 2', 'Incline Bench Press', 'dumbbell', NULL, 'FOCUS', 28, 8, 2),
    ('2026-05-20', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 9, 3),
    ('2026-05-20', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 4),
    ('2026-05-20', 'Lifting Day 2', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 5, 5),
    ('2026-05-20', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 10, 6),
    ('2026-05-20', 'Lifting Day 2', 'Lateral Raise', NULL, 'machine', NULL, 59, 6, 7),
    ('2026-05-20', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 9, 8),
    ('2026-05-20', 'Lifting Day 2', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 7, 9),
    ('2026-05-20', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 16, 8, 10),
    ('2026-05-20', 'Lifting Day 2', 'Curl', 'dumbbell', 'hammer', NULL, 14, 8, 11),
    ('2026-05-20', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 37.4, 9, 12),
    ('2026-05-20', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 37.4, 6, 13),
    ('2026-05-20', 'Lifting Day 2', 'SS Reverse Curl', NULL, NULL, NULL, 19, 9, 14),
    ('2026-05-20', 'Lifting Day 2', 'SS Reverse Curl', NULL, NULL, NULL, 19, 6, 15),
    -- ===== 2026-05-22 (Lifting Day 3) =====
    ('2026-05-22', 'Lifting Day 3', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 8, 0),
    ('2026-05-22', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 9, 1),
    ('2026-05-22', 'Lifting Day 3', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 6, 2),
    ('2026-05-22', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 5, 9, 3),
    ('2026-05-22', 'Lifting Day 3', 'Chin Up', 'bodyweight', NULL, NULL, 5, 6, 4),
    ('2026-05-22', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 12, 5),
    ('2026-05-22', 'Lifting Day 3', 'Overhead Extension', 'ez bar', 'seated', 'keep elbows closer', 30, 9, 6),
    ('2026-05-22', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 16, 8, 7),
    ('2026-05-22', 'Lifting Day 3', 'Curl', 'dumbbell', 'incline', NULL, 16, 6, 8),
    ('2026-05-22', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 12, 9),
    ('2026-05-22', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 7, 10),
    ('2026-05-22', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 4, 11),
    ('2026-05-22', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 73, 8, 12),
    ('2026-05-22', 'Lifting Day 3', 'Wrist Curl', 'cable', NULL, NULL, 68, 8, 13),
    ('2026-05-22', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 68, 10, 14),
    ('2026-05-22', 'Lifting Day 3', 'Crunch', 'cable', NULL, NULL, 68, 7, 15),
    -- ===== 2026-05-11 (Lifting Day 1) =====
    ('2026-05-11', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 290, 9, 0),
    ('2026-05-11', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, 'busy gym not focused', 32, 6, 1),
    ('2026-05-11', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, 'busy gym not focused', 30, 6, 2),
    ('2026-05-11', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 8, 3),
    ('2026-05-11', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 4),
    ('2026-05-11', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 5),
    ('2026-05-11', 'Lifting Day 1', 'Lateral Raise', NULL, 'machine', NULL, 59, 9, 6),
    ('2026-05-11', 'Lifting Day 1', 'Lateral Raise', NULL, 'machine', NULL, 59, 5, 7),
    ('2026-05-11', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 11, 8),
    ('2026-05-11', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', 'keeping elbows tighter', 30, 6, 9),
    ('2026-05-11', 'Lifting Day 1', 'Curl', 'dumbbell', 'hammer', NULL, 16, 7, 10),
    ('2026-05-11', 'Lifting Day 1', 'Curl', 'dumbbell', 'hammer', NULL, 14, 6, 11),
    ('2026-05-11', 'Lifting Day 1', 'Crunch', 'cable', NULL, NULL, 37.4, 8, 12),
    ('2026-05-11', 'Lifting Day 1', 'SS Reverse Curl', NULL, NULL, NULL, 19, 8, 13),
    -- ===== 2026-05-13 (Lifting Day 2) =====
    ('2026-05-13', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 100, 6, 0),
    ('2026-05-13', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down on platform', 90, 6, 1),
    ('2026-05-13', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 9, 2),
    ('2026-05-13', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 6, 3),
    ('2026-05-13', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 6, 8, 4),
    ('2026-05-13', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 6, 5, 5),
    ('2026-05-13', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 32.5, 10, 6),
    ('2026-05-13', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 18, 6, 7),
    ('2026-05-13', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 8),
    ('2026-05-13', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 10, 9),
    ('2026-05-13', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 5, 10),
    ('2026-05-13', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 4, 11),
    ('2026-05-13', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 68, 9, 12),
    ('2026-05-13', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 68, 6, 13),
    ('2026-05-13', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 68, 8, 14),
    ('2026-05-13', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 64, 8, 15),
    -- ===== 2026-05-15 (Lifting Day 3) =====
    ('2026-05-15', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 5, 0),
    ('2026-05-15', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 9, 1),
    ('2026-05-15', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 6, 2),
    ('2026-05-15', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 34, 7, 3),
    ('2026-05-15', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 34, 5, 4),
    ('2026-05-15', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 9, 5),
    ('2026-05-15', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 6),
    ('2026-05-15', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'ELBOWS TUCKED IN', 50, 12, 7),
    ('2026-05-15', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 35, 7, 8),
    -- ===== 2026-05-04 (Lifting Day 1) =====
    ('2026-05-04', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 290, 8, 0),
    ('2026-05-04', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 290, 5, 1),
    ('2026-05-04', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 32, 9, 2),
    ('2026-05-04', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 32, 6, 3),
    ('2026-05-04', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 4),
    ('2026-05-04', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 5),
    ('2026-05-04', 'Lifting Day 1', 'Lateral Raise', NULL, 'machine', NULL, 59, 9, 6),
    ('2026-05-04', 'Lifting Day 1', 'Lateral Raise', NULL, 'machine', NULL, 54, 6, 7),
    ('2026-05-04', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 6, 8),
    ('2026-05-04', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 30, 10, 9),
    ('2026-05-04', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 18, 9, 10),
    ('2026-05-04', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 18, 5, 11),
    ('2026-05-04', 'Lifting Day 1', 'Crunch', 'cable', NULL, NULL, 37.4, 8, 12),
    ('2026-05-04', 'Lifting Day 1', 'SS Reverse Curl', NULL, NULL, NULL, 19, 9, 13),
    -- ===== 2026-05-06 (Lifting Day 2) =====
    ('2026-05-06', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down', 100, 6, 0),
    ('2026-05-06', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow down, feet lower down', 90, 5, 1),
    ('2026-05-06', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 9, 2),
    ('2026-05-06', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 5, 3),
    ('2026-05-06', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 6, 8, 4),
    ('2026-05-06', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 6, 6, 5),
    ('2026-05-06', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 32.5, 9, 6),
    ('2026-05-06', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 18, 5, 7),
    ('2026-05-06', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 8),
    ('2026-05-06', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 36, 8, 9),
    ('2026-05-06', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 64, 12, 10),
    ('2026-05-06', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 64, 8, 11),
    ('2026-05-06', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 64, 11, 12),
    ('2026-05-06', 'Lifting Day 2', 'Crunch', 'cable', NULL, NULL, 64, 7, 13),
    -- ===== 2026-05-08 (Lifting Day 3) =====
    ('2026-05-08', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 5, 0),
    ('2026-05-08', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 6, 1),
    ('2026-05-08', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 11, 2),
    ('2026-05-08', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 7, 3),
    ('2026-05-08', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 34, 8, 4),
    ('2026-05-08', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 34, 5, 5),
    ('2026-05-08', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 10, 6),
    ('2026-05-08', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 7),
    ('2026-05-08', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'seat lowest better', 77, 8, 8),
    ('2026-05-08', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'seat lowest better', 73, 9, 9),
    ('2026-05-08', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'seat lowest better', 73, 6, 10),
    ('2026-05-08', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 32.5, 11, 11),
    ('2026-05-08', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 32.5, 7, 12),
    -- ===== 2026-04-27 (Lifting Day 1) =====
    ('2026-04-27', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 280, 9, 0),
    ('2026-04-27', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 280, 6, 1),
    ('2026-04-27', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 9, 2),
    ('2026-04-27', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 6, 3),
    ('2026-04-27', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 4),
    ('2026-04-27', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 5),
    ('2026-04-27', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 6),
    ('2026-04-27', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 8, 7),
    ('2026-04-27', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 6, 8),
    ('2026-04-27', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 30, 8, 9),
    ('2026-04-27', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 18, 8, 10),
    -- ===== 2026-04-29 (Lifting Day 2) =====
    ('2026-04-29', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow on the way down better', 110, 5, 0),
    ('2026-04-29', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow on the way down better', 100, 5, 1),
    ('2026-04-29', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 50, 8, 2),
    ('2026-04-29', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 45, 8, 3),
    ('2026-04-29', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 5, 7, 4),
    ('2026-04-29', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 5, 5, 5),
    ('2026-04-29', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 7, 6),
    ('2026-04-29', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 9, 7),
    ('2026-04-29', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 9, 8),
    ('2026-04-29', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 9),
    ('2026-04-29', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 34, 10, 10),
    ('2026-04-29', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 59, 8, 11),
    -- ===== 2026-05-01 (Lifting Day 3) =====
    ('2026-05-01', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 5, 0),
    ('2026-05-01', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 7, 1),
    ('2026-05-01', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 10, 2),
    ('2026-05-01', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 7, 3),
    ('2026-05-01', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 34, 7, 4),
    ('2026-05-01', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 34, 5, 5),
    ('2026-05-01', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 10, 6),
    ('2026-05-01', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 7),
    ('2026-05-01', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'seat lowest better', 77, 7, 8),
    ('2026-05-01', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, 'seat lowest better', 73, 6, 9),
    ('2026-05-01', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 15, 8, 10),
    -- ===== 2026-04-20 (Lifting Day 1) =====
    ('2026-04-20', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 280, 7, 0),
    ('2026-04-20', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 280, 5, 1),
    ('2026-04-20', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 9, 2),
    ('2026-04-20', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 6, 3),
    ('2026-04-20', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 8, 4),
    ('2026-04-20', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 5),
    ('2026-04-20', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 6),
    ('2026-04-20', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 10, 6, 7),
    ('2026-04-20', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 9, 8),
    ('2026-04-20', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 7, 9),
    ('2026-04-20', 'Lifting Day 1', 'Skull Crusher', 'ez bar', 'lying', NULL, 30, 8, 10),
    ('2026-04-20', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 18, 6, 11),
    ('2026-04-20', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 8, 12),
    -- ===== 2026-04-22 (Lifting Day 2) =====
    ('2026-04-22', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow on the way down better', 110, 5, 0),
    ('2026-04-22', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 45, 11, 1),
    ('2026-04-22', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 45, 7, 2),
    ('2026-04-22', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 4, 9, 3),
    ('2026-04-22', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, 4, 6, 4),
    ('2026-04-22', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 7, 5),
    ('2026-04-22', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 8, 6),
    ('2026-04-22', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 5, 7),
    ('2026-04-22', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 34, 9, 8),
    ('2026-04-22', 'Lifting Day 2', 'Wrist Curl', 'cable', NULL, NULL, 54, 9, 9),
    -- ===== 2026-04-24 (Lifting Day 3) =====
    ('2026-04-24', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 6, 0),
    ('2026-04-24', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 8, 1),
    ('2026-04-24', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 10, 2),
    ('2026-04-24', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 7, 3),
    ('2026-04-24', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 32, 10, 4),
    ('2026-04-24', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, 'next 34kg', 32, 6, 5),
    ('2026-04-24', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 9, 6),
    ('2026-04-24', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, NULL, 77, 13, 7),
    ('2026-04-24', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, NULL, 77, 9, 8),
    ('2026-04-24', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, NULL, 77, 6, 9),
    ('2026-04-24', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 32.5, 9, 10),
    -- ===== 2026-04-13 (Lifting Day 1) =====
    ('2026-04-13', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 140, 4, 0),
    ('2026-04-13', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 130, 5, 1),
    ('2026-04-13', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 270, 9, 2),
    ('2026-04-13', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 270, 6, 3),
    ('2026-04-13', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 8, 4),
    ('2026-04-13', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 26, 10, 5),
    ('2026-04-13', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 8, 6),
    ('2026-04-13', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 7),
    ('2026-04-13', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 8),
    ('2026-04-13', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 11, 9),
    ('2026-04-13', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 10, 10),
    ('2026-04-13', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 12, 11),
    -- ===== 2026-04-15 (Lifting Day 2) =====
    ('2026-04-15', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow on the way down better', 110, 5, 0),
    ('2026-04-15', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, 'slow on the way down better', 100, 5, 1),
    ('2026-04-15', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 45, 10, 2),
    ('2026-04-15', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 41, 10, 3),
    ('2026-04-15', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 4, 4),
    ('2026-04-15', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 7, 5),
    ('2026-04-15', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 11, 6),
    ('2026-04-15', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 8, 7),
    ('2026-04-15', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 13, 8),
    ('2026-04-15', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 8, 9),
    ('2026-04-15', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 7, 10),
    ('2026-04-15', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 10, 11),
    -- ===== 2026-04-17 (Lifting Day 3) =====
    ('2026-04-17', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'getting back into it after break', 140, 5, 0),
    ('2026-04-17', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'getting back into it after break', 130, 7, 1),
    ('2026-04-17', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 45, 14, 2),
    ('2026-04-17', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 45, 9, 3),
    ('2026-04-17', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 10, 4),
    ('2026-04-17', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 6, 5),
    ('2026-04-17', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 32, 8, 6),
    ('2026-04-17', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 32, 7, 7),
    ('2026-04-17', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 10, 8),
    ('2026-04-17', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 9),
    ('2026-04-17', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 10, 10),
    ('2026-04-17', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 7, 11),
    ('2026-04-17', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, NULL, 68, 16, 12),
    ('2026-04-17', 'Lifting Day 3', 'Triceps Pushdown', 'machine', NULL, NULL, 68, 8, 13),
    -- ===== 2026-04-06 (Lifting Day 1) =====
    ('2026-04-06', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 140, 4, 0),
    ('2026-04-06', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 140, 3, 1),
    ('2026-04-06', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 250, 12, 2),
    ('2026-04-06', 'Lifting Day 1', 'Leg Press', 'machine', NULL, 'pure gym', 250, 9, 3),
    ('2026-04-06', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 8, 4),
    ('2026-04-06', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 7, 5),
    ('2026-04-06', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 7, 6),
    ('2026-04-06', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 6, 7),
    ('2026-04-06', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 4, 8),
    ('2026-04-06', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 13, 9),
    ('2026-04-06', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 9, 10),
    ('2026-04-06', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 14, 11),
    ('2026-04-06', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 9, 12),
    ('2026-04-06', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 12, 13),
    ('2026-04-06', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 7, 14),
    -- ===== 2026-04-08 (Lifting Day 2) =====
    ('2026-04-08', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 110, 5, 0),
    ('2026-04-08', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 100, 5, 1),
    ('2026-04-08', 'Lifting Day 2', 'Lying Leg Curl', 'machine', NULL, NULL, 45, 8, 2),
    ('2026-04-08', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 4, 3),
    ('2026-04-08', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 7, 4),
    ('2026-04-08', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 11, 5),
    ('2026-04-08', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 7, 6),
    ('2026-04-08', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 9, 7),
    ('2026-04-08', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 9, 8),
    ('2026-04-08', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 7, 9),
    ('2026-04-08', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 9, 10),
    ('2026-04-08', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 6, 11),
    ('2026-04-08', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 4, 12),
    ('2026-04-08', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 4, 13),
    ('2026-04-08', 'Lifting Day 2', 'Shrug', 'dumbbell', NULL, 'myo rep sets', 32, 4, 14),
    -- ===== 2026-04-10 (Lifting Day 3) =====
    ('2026-04-10', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'getting back into it after break', 140, 5, 0),
    ('2026-04-10', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'getting back into it after break', 130, 7, 1),
    ('2026-04-10', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, 'quads kinda cooked', 45, 9, 2),
    ('2026-04-10', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, 'quads kinda cooked', 45, 7, 3),
    ('2026-04-10', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 10, 4),
    ('2026-04-10', 'Lifting Day 3', 'Dip', NULL, '4-sec pause', NULL, NULL, 5, 5),
    ('2026-04-10', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 9, 6),
    ('2026-04-10', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 7, 7),
    ('2026-04-10', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 11, 8),
    ('2026-04-10', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 7.5, 8, 9),
    ('2026-04-10', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 9, 10),
    ('2026-04-10', 'Lifting Day 3', 'Preacher Curl', 'ez bar', NULL, NULL, 30, 6, 11),
    -- ===== 2026-03-30 (Lifting Day 1) =====
    ('2026-03-30', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 150, 3, 0),
    ('2026-03-30', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 140, 5, 1),
    ('2026-03-30', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 290, 8, 2),
    ('2026-03-30', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 290, 7, 3),
    ('2026-03-30', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 32, 10, 4),
    ('2026-03-30', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 9, 5),
    ('2026-03-30', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 6),
    ('2026-03-30', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 7, 7),
    ('2026-03-30', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 14, 8),
    ('2026-03-30', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 9, 9),
    ('2026-03-30', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 6, 10),
    ('2026-03-30', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 35, 10, 11),
    ('2026-03-30', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 35, 7, 12),
    ('2026-03-30', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', '18kg next', 16, 14, 13),
    ('2026-03-30', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', '18kg next', 16, 8, 14),
    -- ===== 2026-04-01 (Lifting Day 2) =====
    ('2026-04-01', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 170, 4, 0),
    ('2026-04-01', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 150, 8, 1),
    ('2026-04-01', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 13, 2),
    ('2026-04-01', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 8, 3),
    ('2026-04-01', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 4, 4),
    ('2026-04-01', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 8, 5),
    ('2026-04-01', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 11, 6),
    ('2026-04-01', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 6, 7),
    ('2026-04-01', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 8, 8, 8),
    ('2026-04-01', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 6, 14, 9),
    ('2026-04-01', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 11, 10),
    ('2026-04-01', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 11, 11),
    ('2026-04-01', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 16, 8, 12),
    ('2026-04-01', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 6, 13),
    -- ===== 2026-04-03 (Lifting Day 3) =====
    ('2026-04-03', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 145, 5, 0),
    ('2026-04-03', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 140, 6, 1),
    ('2026-04-03', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 70, 11, 2),
    ('2026-04-03', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 70, 8, 3),
    ('2026-04-03', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 25, 7, 4),
    ('2026-04-03', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 20, 6, 5),
    ('2026-04-03', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 11, 6),
    ('2026-04-03', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 7, 7),
    ('2026-04-03', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 7, 8),
    ('2026-04-03', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 9, 9),
    ('2026-04-03', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 10),
    ('2026-04-03', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 10, 11),
    ('2026-04-03', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 7, 12),
    ('2026-04-03', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 11, 13),
    ('2026-04-03', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 8, 14),
    ('2026-04-03', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 12, 15),
    ('2026-04-03', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 7, 16),
    -- ===== 2026-03-23 (Lifting Day 1) =====
    ('2026-03-23', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 150, 3, 0),
    ('2026-03-23', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'HIP HINGE FEEL THE BOW, PUSH THROUGH FLOOR', 140, 5, 1),
    ('2026-03-23', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 280, 8, 2),
    ('2026-03-23', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 280, 6, 3),
    ('2026-03-23', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 32, 9, 4),
    ('2026-03-23', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 9, 5),
    ('2026-03-23', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 6),
    ('2026-03-23', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 7, 7),
    ('2026-03-23', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 14, 8),
    ('2026-03-23', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 8, 9),
    ('2026-03-23', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 5, 10),
    ('2026-03-23', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 35, 9, 11),
    ('2026-03-23', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 12, 12),
    ('2026-03-23', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 13, 13),
    ('2026-03-23', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 8, 14),
    -- ===== 2026-03-25 (Lifting Day 2) =====
    ('2026-03-25', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 160, 6, 0),
    ('2026-03-25', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 150, 6, 1),
    ('2026-03-25', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 13, 2),
    ('2026-03-25', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 7, 3),
    ('2026-03-25', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 4, 4),
    ('2026-03-25', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 7, 5),
    ('2026-03-25', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 12, 6),
    ('2026-03-25', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 8, 7),
    ('2026-03-25', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 8, 8, 8),
    ('2026-03-25', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 6, 13, 9),
    ('2026-03-25', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 10, 10),
    ('2026-03-25', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 11, 11),
    ('2026-03-25', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 11, 12),
    ('2026-03-25', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 6, 13),
    -- ===== 2026-03-27 (Lifting Day 3) =====
    ('2026-03-27', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 140, 7, 0),
    ('2026-03-27', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 130, 8, 1),
    ('2026-03-27', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 70, 11, 2),
    ('2026-03-27', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 70, 8, 3),
    ('2026-03-27', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 25, 7, 4),
    ('2026-03-27', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 20, 8, 5),
    ('2026-03-27', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 11, 6),
    ('2026-03-27', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 7, 7),
    ('2026-03-27', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 7, 8),
    ('2026-03-27', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 9, 9),
    ('2026-03-27', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 10),
    ('2026-03-27', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 10, 11),
    ('2026-03-27', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 7, 12),
    ('2026-03-27', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 11, 13),
    ('2026-03-27', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 8, 14),
    ('2026-03-27', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 12, 15),
    ('2026-03-27', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 7, 16),
    -- ===== 2026-03-16 (Lifting Day 1) =====
    ('2026-03-16', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'next week 145kg, PUSH THROUGH FLOOR, HIP HINGE SERIOUS', 140, 6, 0),
    ('2026-03-16', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, 'next week 145kg, PUSH THROUGH FLOOR, HIP HINGE SERIOUS', 140, 4, 1),
    ('2026-03-16', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 270, 8, 2),
    ('2026-03-16', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 270, 6, 3),
    ('2026-03-16', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 32, 8, 4),
    ('2026-03-16', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 8, 5),
    ('2026-03-16', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 6),
    ('2026-03-16', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 7, 7),
    ('2026-03-16', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 12, 8),
    ('2026-03-16', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 9, 9),
    ('2026-03-16', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 10),
    ('2026-03-16', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 35, 10, 11),
    ('2026-03-16', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 9, 12),
    ('2026-03-16', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 12, 13),
    ('2026-03-16', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 8, 14),
    -- ===== 2026-03-18 (Lifting Day 2) =====
    ('2026-03-18', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 160, 5, 0),
    ('2026-03-18', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 140, 8, 1),
    ('2026-03-18', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 12, 2),
    ('2026-03-18', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 7, 3),
    ('2026-03-18', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 5, 4),
    ('2026-03-18', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 7, 5),
    ('2026-03-18', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 11, 6),
    ('2026-03-18', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 8, 7),
    ('2026-03-18', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 8, 8, 8),
    ('2026-03-18', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 6, 12, 9),
    ('2026-03-18', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 10, 10),
    ('2026-03-18', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 11, 11),
    ('2026-03-18', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 10, 12),
    ('2026-03-18', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 6, 13),
    -- ===== 2026-03-20 (Lifting Day 3) =====
    ('2026-03-20', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 140, 6, 0),
    ('2026-03-20', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, 'kettlebell warmup, push through the floor', 130, 8, 1),
    ('2026-03-20', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 70, 11, 2),
    ('2026-03-20', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 62, 10, 3),
    ('2026-03-20', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 25, 6, 4),
    ('2026-03-20', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 20, 8, 5),
    ('2026-03-20', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 11, 6),
    ('2026-03-20', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 7, 7),
    ('2026-03-20', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 10, 7, 8),
    ('2026-03-20', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 8, 9),
    ('2026-03-20', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 6, 10),
    ('2026-03-20', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 10, 11),
    ('2026-03-20', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 6, 12),
    ('2026-03-20', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 10, 13),
    ('2026-03-20', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 35, 7, 14),
    ('2026-03-20', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 12, 15),
    ('2026-03-20', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 35, 7, 16),
    -- ===== 2026-03-09 (Lifting Day 1) =====
    ('2026-03-09', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, NULL, 140, 6, 0),
    ('2026-03-09', 'Lifting Day 1', 'Deadlift', 'barbell', NULL, NULL, 140, 4, 1),
    ('2026-03-09', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 260, 10, 2),
    ('2026-03-09', 'Lifting Day 1', 'Leg Press', 'machine', NULL, NULL, 260, 7, 3),
    ('2026-03-09', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 11, 4),
    ('2026-03-09', 'Lifting Day 1', 'Incline Bench Press', 'dumbbell', NULL, NULL, 30, 8, 5),
    ('2026-03-09', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 10, 6),
    ('2026-03-09', 'Lifting Day 1', 'Pull Up', 'bodyweight', 'neutral grip', NULL, NULL, 7, 7),
    ('2026-03-09', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 11, 8),
    ('2026-03-09', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 8, 9),
    ('2026-03-09', 'Lifting Day 1', 'Lateral Raise', NULL, 'standing db', NULL, 8, 7, 10),
    ('2026-03-09', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 35, 8, 11),
    ('2026-03-09', 'Lifting Day 1', 'Overhead Extension', 'ez bar', 'standing', NULL, 30, 9, 12),
    ('2026-03-09', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 9, 13),
    ('2026-03-09', 'Lifting Day 1', 'Curl', 'dumbbell', 'standing', NULL, 16, 7, 14),
    -- ===== 2026-03-11 (Lifting Day 2) =====
    ('2026-03-11', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 150, 6, 0),
    ('2026-03-11', 'Lifting Day 2', 'Hack Squat', 'machine', NULL, NULL, 140, 7, 1),
    ('2026-03-11', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 12, 2),
    ('2026-03-11', 'Lifting Day 2', 'Seated Leg Curl', 'machine', NULL, NULL, 75, 7, 3),
    ('2026-03-11', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 55, 5, 4),
    ('2026-03-11', 'Lifting Day 2', 'Overhead Press', 'barbell', NULL, NULL, 50, 6, 5),
    ('2026-03-11', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 10, 6),
    ('2026-03-11', 'Lifting Day 2', 'Chin Up', 'bodyweight', NULL, NULL, NULL, 8, 7),
    ('2026-03-11', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 8, 7, 8),
    ('2026-03-11', 'Lifting Day 2', 'Lateral Raise', NULL, 'incline 1-arm db', NULL, 6, 11, 9),
    ('2026-03-11', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 35, 8, 10),
    ('2026-03-11', 'Lifting Day 2', 'Overhead Extension', 'ez bar', 'seated', NULL, 30, 9, 11),
    ('2026-03-11', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 9, 12),
    ('2026-03-11', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 14, 6, 13),
    ('2026-03-11', 'Lifting Day 2', 'Curl', 'dumbbell', 'incline', NULL, 10, 8, 14),
    -- ===== 2026-03-13 (Lifting Day 3) =====
    ('2026-03-13', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 140, 5, 0),
    ('2026-03-13', 'Lifting Day 3', 'Romanian Deadlift', 'barbell', NULL, NULL, 130, 7, 1),
    ('2026-03-13', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 62, 14, 2),
    ('2026-03-13', 'Lifting Day 3', 'Leg Extension', 'machine', NULL, NULL, 62, 10, 3),
    ('2026-03-13', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 25, 7, 4),
    ('2026-03-13', 'Lifting Day 3', 'Dip', NULL, 'weighted', NULL, 22.5, 7, 5),
    ('2026-03-13', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 30, 10, 6),
    ('2026-03-13', 'Lifting Day 3', '1-Arm Row', 'dumbbell', NULL, NULL, 25, 11, 7),
    ('2026-03-13', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 11, 8),
    ('2026-03-13', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 8, 9),
    ('2026-03-13', 'Lifting Day 3', 'Lateral Raise', NULL, 'standing db', NULL, 8, 6, 10),
    ('2026-03-13', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 10, 11),
    ('2026-03-13', 'Lifting Day 3', 'Curl', 'ez bar', NULL, NULL, 35, 6, 12),
    ('2026-03-13', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 30, 14, 13),
    ('2026-03-13', 'Lifting Day 3', 'Skull Crusher', 'ez bar', 'lying', NULL, 30, 9, 14),
    ('2026-03-13', 'Lifting Day 3', 'Shrug', 'dumbbell', NULL, 'no straps', 30, 13, 15)
  ;

  -- Session-level feedback notes, one row per date that had any.
  CREATE TEMP TABLE _session_notes (
    performed_on date PRIMARY KEY,
    notes text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _session_notes (performed_on, notes) VALUES
    ('2026-03-18', 'lying 70kgx8 60kgx'),
    ('2026-04-06', 'easing back into'),
    ('2026-04-13', 'easing back into'),
    ('2026-05-22', 'back from russia 1stday')
  ;

  -- --------------------------------------------------------------------------
  -- Variation pool. Each is a distinct key in user_field_options (kind='variation').
  -- Inserted idempotently — if any already exist for this user they're reused.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _variation (
    key text PRIMARY KEY,
    label text NOT NULL,
    sort int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _variation (key, label, sort) VALUES
    ('4-sec pause',       '4-sec Pause',       0),
    ('weighted',          'Weighted',          1),
    ('neutral grip',      'Neutral Grip',      2),
    ('low grip',          'Low Grip',          3),
    ('standing',          'Standing',          4),
    ('seated',            'Seated',            5),
    ('incline',           'Incline',           6),
    ('hammer',            'Hammer',            7),
    ('lying',             'Lying',             8),
    ('standing db',       'Standing DB',       9),
    ('incline 1-arm db',  'Incline 1-Arm DB',  10),
    ('machine',           'Machine',           11);

  WITH existing_max AS (
    SELECT COALESCE(MAX(position), -1) AS max_pos
    FROM user_field_options
    WHERE user_id = target_user_id AND kind = 'variation' AND parent_id IS NULL
  ),
  missing AS (
    SELECT v.key, v.label, v.sort,
           row_number() OVER (ORDER BY v.sort) AS rn
    FROM _variation v
    WHERE NOT EXISTS (
      SELECT 1 FROM user_field_options ufo
      WHERE ufo.user_id = target_user_id
        AND ufo.kind = 'variation'
        AND ufo.parent_id IS NULL
        AND ufo.key = v.key
    )
  )
  INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
  SELECT gen_random_uuid(), target_user_id, 'variation', NULL,
         m.key, m.label,
         (SELECT max_pos FROM existing_max) + m.rn,
         NOW()
  FROM missing m;

  GET DIAGNOSTICS imported_variation_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Equipment options. Most overlap defaults seeded at signup; just defensive.
  -- Slug = lower(label) with spaces preserved (matches default convention).
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _equipment (key text PRIMARY KEY, label text NOT NULL) ON COMMIT DROP;
  INSERT INTO _equipment (key, label) VALUES
    ('barbell',    'Barbell'),
    ('dumbbell',   'Dumbbell'),
    ('machine',    'Machine'),
    ('ez bar',     'EZ bar'),
    ('cable',      'Cable'),
    ('bodyweight', 'Bodyweight');

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
      WHERE ufo.user_id = target_user_id
        AND ufo.kind = 'equipment'
        AND ufo.parent_id IS NULL
        AND ufo.key = e.key
    )
  )
  INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
  SELECT gen_random_uuid(), target_user_id, 'equipment', NULL,
         m.key, m.label,
         (SELECT max_pos FROM existing_max) + m.rn,
         NOW()
  FROM missing m;

  GET DIAGNOSTICS imported_equipment_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Exercise metadata literal table. Keys: (name_lower, equip_key).
  -- equip_key uses '' (empty string) for "no equipment" because IS NOT
  -- DISTINCT FROM with NULL inside a VALUES list is fiddly.
  -- --------------------------------------------------------------------------
  WITH distinct_imports AS (
    SELECT DISTINCT ON (LOWER(i.exercise_name), COALESCE(i.equipment_key, ''))
      i.exercise_name AS new_name,
      i.equipment_key AS equip_key
    FROM _import i
    ORDER BY LOWER(i.exercise_name), COALESCE(i.equipment_key, ''), i.rownum
  ),
  exercise_meta(name_lower, equip_key, is_bw, categories, muscles, variations) AS (
    VALUES
      ('romanian deadlift', 'barbell',     false, ARRAY['resistance'], ARRAY['legs', 'upper back'], CAST(ARRAY[]::text[] AS text[])),
      ('deadlift',          'barbell',     false, ARRAY['resistance'], ARRAY['legs', 'upper back'], ARRAY[]::text[]),
      ('leg press',         'machine',     false, ARRAY['resistance'], ARRAY['legs'],               ARRAY[]::text[]),
      ('hack squat',        'machine',     false, ARRAY['resistance'], ARRAY['legs'],               ARRAY[]::text[]),
      ('leg extension',     'machine',     false, ARRAY['resistance'], ARRAY['legs'],               ARRAY[]::text[]),
      ('lying leg curl',    'machine',     false, ARRAY['resistance'], ARRAY['legs'],               ARRAY[]::text[]),
      ('seated leg curl',   'machine',     false, ARRAY['resistance'], ARRAY['legs'],               ARRAY[]::text[]),
      ('incline bench press','dumbbell',   false, ARRAY['resistance'], ARRAY['chest'],              ARRAY[]::text[]),
      ('dip',               NULL,          true,  ARRAY['resistance'], ARRAY['chest', 'arms'],      ARRAY['4-sec pause', 'weighted']),
      ('pull up',           'bodyweight',  true,  ARRAY['resistance'], ARRAY['upper back', 'arms'], ARRAY['neutral grip']),
      ('chin up',           'bodyweight',  true,  ARRAY['resistance'], ARRAY['upper back', 'arms'], ARRAY[]::text[]),
      ('seated row',        'machine',     false, ARRAY['resistance'], ARRAY['upper back'],         ARRAY['low grip']),
      ('1-arm row',         'dumbbell',    false, ARRAY['resistance'], ARRAY['upper back'],         ARRAY[]::text[]),
      ('lateral raise',     NULL,          false, ARRAY['resistance'], ARRAY['shoulders'],          ARRAY['standing db', 'incline 1-arm db', 'machine']),
      ('overhead press',    'barbell',     false, ARRAY['resistance'], ARRAY['shoulders'],          ARRAY[]::text[]),
      ('shrug',             'dumbbell',    false, ARRAY['resistance'], ARRAY['upper back'],         ARRAY[]::text[]),
      ('skull crusher',     'ez bar',      false, ARRAY['resistance'], ARRAY['arms'],               ARRAY['lying']),
      ('overhead extension','ez bar',      false, ARRAY['resistance'], ARRAY['arms'],               ARRAY['seated', 'standing']),
      ('triceps pushdown',  'machine',     false, ARRAY['resistance'], ARRAY['arms'],               ARRAY[]::text[]),
      ('preacher curl',     'ez bar',      false, ARRAY['resistance'], ARRAY['arms'],               ARRAY[]::text[]),
      ('curl',              'ez bar',      false, ARRAY['resistance'], ARRAY['arms'],               ARRAY[]::text[]),
      ('curl',              'dumbbell',    false, ARRAY['resistance'], ARRAY['arms'],               ARRAY['standing', 'incline', 'hammer']),
      ('ss reverse curl',   NULL,          false, ARRAY['resistance'], ARRAY['arms'],               ARRAY[]::text[]),
      ('wrist curl',        'cable',       false, ARRAY['resistance'], ARRAY['arms'],               ARRAY[]::text[]),
      ('crunch',            'cable',       false, ARRAY['resistance'], ARRAY['core'],               ARRAY[]::text[])
  ),
  missing AS (
    SELECT
      di.new_name,
      di.equip_key,
      em.is_bw,
      em.categories,
      em.muscles,
      em.variations
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
    true,                          -- track_reps
    0,                             -- default_weight_kg
    false,                         -- double_reps
    NULL,                          -- distance_unit
    false, NULL,                   -- track_time, time_unit
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
  -- Workouts: one per (date, day_label). Names are "Lifting Day 1/2/3".
  -- Feedback from the source is attached as notes_public=true.
  -- --------------------------------------------------------------------------
  CREATE TEMP TABLE _workout_map (
    performed_on date NOT NULL,
    workout_name text NOT NULL,
    workout_id uuid NOT NULL,
    PRIMARY KEY (performed_on, workout_name)
  ) ON COMMIT DROP;

  WITH per_session AS (
    SELECT DISTINCT performed_on, workout_name
    FROM _import
  ),
  ins AS (
    INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, notes_public, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      target_user_id,
      ps.workout_name,
      ps.performed_on,
      'workout',
      sn.notes,
      (sn.notes IS NOT NULL),
      NOW(), NOW()
    FROM per_session ps
    LEFT JOIN _session_notes sn USING (performed_on)
    RETURNING id, performed_on, name
  )
  INSERT INTO _workout_map (performed_on, workout_name, workout_id)
  SELECT performed_on, name, id FROM ins;

  GET DIAGNOSTICS imported_workout_count = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Exercise lookup: (LOWER(name), equipment) → exercise_id. Picks oldest row
  -- for determinism if duplicates exist.
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
  -- Sets. Position comes from the source directly (already 0-indexed per
  -- session). Notes are public.
  -- --------------------------------------------------------------------------
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
    i.performed_on,
    wm.workout_id,
    em.exercise_id,
    i.position,
    i.reps,
    i.weight_kg,
    NULL, NULL,
    NULL, NULL, NULL, NULL,
    NULL, NULL, NULL,
    i.variation_key,
    i.ex_note,
    (i.ex_note IS NOT NULL)
  FROM _import i
  JOIN _workout_map wm
    ON wm.performed_on = i.performed_on AND wm.workout_name = i.workout_name
  JOIN _exercise_map em
    ON em.name_lower = LOWER(i.exercise_name)
   AND em.equip_key IS NOT DISTINCT FROM i.equipment_key
  ORDER BY i.performed_on, i.rownum;

  GET DIAGNOSTICS imported_set_count = ROW_COUNT;

  RAISE NOTICE 'George 3-DAY import: % equipment option(s), % variation(s), % exercise(s), % workout(s), % set(s).',
    imported_equipment_count, imported_variation_count,
    imported_exercise_count, imported_workout_count, imported_set_count;

END
$migration$;

COMMIT;
