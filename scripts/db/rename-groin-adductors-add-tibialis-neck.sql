-- Muscle taxonomy update (run once against Supabase Postgres):
--
--  1. Rename the seeded 'groin' muscle_child to 'adductors' (key + label) for
--     every user, matching the react-native-body-highlighter SVG region names.
--     One user already created a custom 'adductors' child under the same
--     parent — for them the 'groin' row is deleted instead of renamed so the
--     per-parent key uniqueness the app enforces is preserved.
--  2. Replace 'groin' with 'adductors' inside exercises.muscles /
--     secondary_muscles (text[] of keys), deduping in case an exercise had both.
--  3. Seed new children for all existing users: 'tibialis' under 'legs' and
--     'neck' under 'shoulders', plus 'adductors' under 'legs' for any user who
--     had deleted 'groin'. Users who deleted the parent group are skipped.
--
-- New signups get these via the client bootstrap (src/lib/exercise-options.ts).
-- PowerSync streams these server-side writes down to existing clients.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1a. Users who already have an 'adductors' sibling: drop their 'groin' row.
-- ----------------------------------------------------------------------------
DELETE FROM user_field_options g
WHERE g.kind = 'muscle_child'
  AND g.key = 'groin'
  AND EXISTS (
    SELECT 1 FROM user_field_options a
    WHERE a.user_id = g.user_id
      AND a.kind = 'muscle_child'
      AND a.parent_id = g.parent_id
      AND a.key = 'adductors'
  );

-- ----------------------------------------------------------------------------
-- 1b. Everyone else: rename 'groin' -> 'adductors' in place (position kept).
-- ----------------------------------------------------------------------------
UPDATE user_field_options
SET key = 'adductors', label = 'Adductors'
WHERE kind = 'muscle_child' AND key = 'groin';

-- ----------------------------------------------------------------------------
-- 2. Rewrite exercise muscle arrays, deduping while preserving order.
-- ----------------------------------------------------------------------------
UPDATE exercises
SET muscles = (
  SELECT ARRAY(
    SELECT s.x FROM (
      SELECT DISTINCT ON (t.x) t.x, t.ord
      FROM unnest(array_replace(muscles, 'groin', 'adductors'))
        WITH ORDINALITY AS t(x, ord)
      ORDER BY t.x, t.ord
    ) s ORDER BY s.ord
  )
)
WHERE 'groin' = ANY(muscles);

UPDATE exercises
SET secondary_muscles = (
  SELECT ARRAY(
    SELECT s.x FROM (
      SELECT DISTINCT ON (t.x) t.x, t.ord
      FROM unnest(array_replace(secondary_muscles, 'groin', 'adductors'))
        WITH ORDINALITY AS t(x, ord)
      ORDER BY t.x, t.ord
    ) s ORDER BY s.ord
  )
)
WHERE 'groin' = ANY(secondary_muscles);

-- ----------------------------------------------------------------------------
-- 3. Seed missing children per user. Appends after the user's current highest
--    sibling position. Skips users lacking the parent group (they deleted it).
-- ----------------------------------------------------------------------------
WITH additions(group_key, child_key, child_label, pos_offset) AS (
  VALUES
    ('legs',      'adductors', 'Adductors', 0),
    ('legs',      'tibialis',  'Tibialis',  1),
    ('shoulders', 'neck',      'Neck',      0)
)
INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
SELECT
  gen_random_uuid(),
  grp.user_id,
  'muscle_child',
  grp.id,
  a.child_key,
  a.child_label,
  COALESCE(
    (SELECT MAX(c.position) FROM user_field_options c
     WHERE c.user_id = grp.user_id AND c.kind = 'muscle_child' AND c.parent_id = grp.id),
    -1
  ) + 1 + a.pos_offset,
  NOW()
FROM additions a
JOIN user_field_options grp
  ON grp.kind = 'muscle_group' AND grp.key = a.group_key
WHERE NOT EXISTS (
  SELECT 1 FROM user_field_options c
  WHERE c.user_id = grp.user_id
    AND c.kind = 'muscle_child'
    AND c.parent_id = grp.id
    AND c.key = a.child_key
);

COMMIT;

-- Post-checks:
--   SELECT key, COUNT(*) FROM user_field_options
--   WHERE kind = 'muscle_child' AND key IN ('groin','adductors','tibialis','neck')
--   GROUP BY key;  -- expect zero 'groin'
--
--   SELECT COUNT(*) FROM exercises
--   WHERE 'groin' = ANY(muscles) OR 'groin' = ANY(secondary_muscles);  -- expect 0
