-- RPE (Rate of Perceived Exertion) metric: a per-set integer (0 and up).
-- `track_rpe` toggles the metric on an exercise; `rpe` stores the logged value
-- on each set / template set.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS track_rpe boolean NOT NULL DEFAULT false;
ALTER TABLE sets ADD COLUMN IF NOT EXISTS rpe integer;
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS rpe integer;
