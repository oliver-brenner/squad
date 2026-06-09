-- Per-exercise note (private, owner-only).
--
-- Notes used to live on `sets.notes` (per session, denormalised across the
-- exercise group's sets). This moved them up to the exercise itself so a note
-- written once on an exercise is visible on every future card that logs that
-- exercise. The session-level note on `workouts.notes` is unrelated and stays.
--
-- Privacy: exercise notes are owner-only and never sync to followers, so no
-- `notes_public` flag and no `notes_for_followers` GENERATED column. The
-- `followee_exercises` sync rule excludes this column from its projection.
--
-- Backfill: copy the most recent non-null `sets.notes` per (user, exercise) up
-- to `exercises.notes`. Older or duplicate set-level notes stay in `sets.notes`
-- (harmless once the UI ignores them) — we can drop those columns later in a
-- separate cleanup once we're sure no client still reads them.

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS notes text;

WITH latest_per_exercise AS (
  SELECT DISTINCT ON (s.user_id, s.exercise_id)
    s.user_id, s.exercise_id, s.notes
  FROM sets s
  WHERE s.notes IS NOT NULL AND length(trim(s.notes)) > 0
  ORDER BY s.user_id, s.exercise_id, s.performed_on DESC, s.position DESC
)
UPDATE exercises e
SET notes = l.notes
FROM latest_per_exercise l
WHERE e.user_id = l.user_id
  AND e.id = l.exercise_id
  AND (e.notes IS NULL OR length(trim(e.notes)) = 0);
