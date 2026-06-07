-- Session templates — reusable skeletons a user can materialise into a real
-- workout. A template carries only exercise/set content (name, session_type,
-- and a list of template_sets). Everything else a session has — date, guests,
-- calories, notes — is added to the workout AFTER it's created from the
-- template, and is never linked back to the template.
--
-- `template_sets` mirrors the `sets` table minus `workout_id`/`performed_on`
-- (templates have no date). user_id is denormalised onto template_sets — same
-- pattern as sets/session_guests — so the PowerSync bucket can filter without
-- joining templates. Templates are private: no followee sync, no cross-user
-- read policy.

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  session_type text NOT NULL DEFAULT 'workout',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS templates_user_idx ON templates (user_id);

CREATE TABLE IF NOT EXISTS template_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  reps integer,
  weight_kg real,
  distance_km real,
  duration_sec integer,
  resistance integer,
  speed_ms real,
  incline_pct real,
  rest_sec integer,
  calories integer,
  circuit_id uuid,
  circuit_rounds integer,
  circuit_name text
);

CREATE INDEX IF NOT EXISTS template_sets_template_idx ON template_sets (template_id);
CREATE INDEX IF NOT EXISTS template_sets_user_idx ON template_sets (user_id);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_sets ENABLE ROW LEVEL SECURITY;

-- Templates are private to their owner — full CRUD for the owner, no read
-- access for anyone else (unlike workouts/session_guests, which friends can
-- read for the feed).
DROP POLICY IF EXISTS templates_owner_all ON templates;
CREATE POLICY templates_owner_all ON templates
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS template_sets_owner_all ON template_sets;
CREATE POLICY template_sets_owner_all ON template_sets
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- PowerSync replicates from a Postgres publication. If you pre-created the
-- `powersync` publication with an explicit table list (rather than FOR ALL
-- TABLES), add these tables to it:
--   ALTER PUBLICATION powersync ADD TABLE templates;
--   ALTER PUBLICATION powersync ADD TABLE template_sets;
