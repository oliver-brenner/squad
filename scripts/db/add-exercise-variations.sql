-- Exercise variations: a free-text, tag-like attribute managed per user.
--
--  * `user_field_options` gains a new `kind = 'variation'` (no schema change to
--    the table itself — `kind` is plain text; only extend a CHECK if one exists,
--    see below).
--  * `exercises.variations` stores the JSON-encoded text[] of variation keys
--    attached to an exercise (same encoding as categories/muscles).
--  * `sets.variation` / `template_sets.variation` store the single variation key
--    chosen for an exercise within a session/template — denormalised across
--    every set of that exercise group, mirroring `circuit_name`.
--
-- Variations never feed stats/PB grouping (those key on exercise_id only), so no
-- backfill is required; all new columns are nullable.

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS variations text[];
ALTER TABLE sets ADD COLUMN IF NOT EXISTS variation text;
ALTER TABLE template_sets ADD COLUMN IF NOT EXISTS variation text;

-- If `user_field_options.kind` is constrained by a CHECK, extend it to allow
-- 'variation'. Adjust the constraint name to match your schema (inspect with
-- `\d user_field_options`). If `kind` is unconstrained text, skip this block.
--
-- ALTER TABLE user_field_options DROP CONSTRAINT IF EXISTS user_field_options_kind_check;
-- ALTER TABLE user_field_options ADD CONSTRAINT user_field_options_kind_check
--   CHECK (kind IN ('category', 'equipment', 'muscle_group', 'muscle_child', 'variation'));

-- After applying: redeploy powersync/sync_rules.yaml (the rules use `SELECT *`,
-- so the new columns sync automatically once they exist in Postgres).
