-- Guests on a session — a purely visual tag on a workout. No shared session id,
-- no cross-user ownership: the guest rows belong to the session owner only.
--
-- A guest is either an on-Squad user (guest_profile_id set; name/avatar resolved
-- live from their profile) or an off-Squad person (guest_profile_id null and a
-- free-text guest_name). user_id is the SESSION OWNER, denormalised here so the
-- PowerSync sync buckets can filter without joining workouts (same pattern as
-- the sets table).

CREATE TABLE IF NOT EXISTS session_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  guest_name text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_guests_workout_idx ON session_guests (workout_id);
CREATE INDEX IF NOT EXISTS session_guests_user_idx ON session_guests (user_id);

ALTER TABLE session_guests ENABLE ROW LEVEL SECURITY;

-- The owner can do anything with their own guest rows.
DROP POLICY IF EXISTS session_guests_owner_all ON session_guests;
CREATE POLICY session_guests_owner_all ON session_guests
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Any authenticated user may read guest rows. The sync rules already scope which
-- rows actually reach a given client (own + followees); this matches the
-- read-anything posture profiles/workouts already use so friends can render the
-- guest cue on sessions they're allowed to see.
DROP POLICY IF EXISTS session_guests_read_authenticated ON session_guests;
CREATE POLICY session_guests_read_authenticated ON session_guests
  FOR SELECT TO authenticated
  USING (true);

-- PowerSync replicates from a Postgres publication. If you pre-created the
-- `powersync` publication with an explicit table list (rather than FOR ALL
-- TABLES), add this table to it:
--   ALTER PUBLICATION powersync ADD TABLE session_guests;
