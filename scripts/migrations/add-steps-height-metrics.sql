-- Adds two new exercise metrics: `steps` (integer) and `height` (stored
-- canonically in metres, with a per-exercise display unit cm/m/in/ft).
--
-- Mirrors the existing patterns:
--   * `track_steps` is a BOOLEAN flag like track_reps/track_rpe.
--   * `height_unit` is TEXT like distance_unit (its presence = "tracked").
--   * `steps` is INTEGER and `height_m` is NUMERIC, matching reps/distance_km.
--
-- Safe to run more than once (IF NOT EXISTS). Apply to the PowerSync-replicated
-- Postgres, then deploy the matching sync_rules.yaml.

-- Exercise-level metric config
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS track_steps boolean NOT NULL DEFAULT false;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS height_unit text;

-- Per-set logged values
ALTER TABLE sets          ADD COLUMN IF NOT EXISTS steps    integer;
ALTER TABLE sets          ADD COLUMN IF NOT EXISTS height_m numeric;

-- Template skeleton-set values (mirror sets)
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS steps    integer;
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS height_m numeric;
