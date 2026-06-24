-- Move exercise variations from the shared `user_field_options` library to a
-- per-exercise list stored on the exercise itself.
--
-- Before: `exercises.variations` was a text[] of variation KEYS, each pointing
--         at a `user_field_options` row (kind='variation') that held the label.
-- After:  `exercises.variations` is a jsonb array of {key,label} objects owned
--         by the exercise. `key` is preserved verbatim from the old keys, so
--         existing `sets.variation` / `template_sets.variation` values keep
--         resolving and in-session selection is unchanged.
--
-- Run this against Postgres, then redeploy powersync/sync_rules.yaml (the rules
-- use SELECT *, so the retyped column syncs automatically once it exists).

-- 1. New jsonb column to build into.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS variations_jsonb jsonb;

-- 2. Backfill: turn each attached key into {key,label}, pulling the label from
--    the user's existing global variation option. Keys without a matching
--    option fall back to the key as the label. Order by the position the user
--    currently sees in the library, then by the stored array order.
UPDATE exercises e
SET variations_jsonb = sub.arr
FROM (
  SELECT e2.id,
         jsonb_agg(
           jsonb_build_object('key', u.k, 'label', COALESCE(ufo.label, u.k))
           ORDER BY ufo.position NULLS LAST, u.ord
         ) AS arr
  FROM exercises e2
  CROSS JOIN LATERAL unnest(e2.variations) WITH ORDINALITY AS u(k, ord)
  LEFT JOIN user_field_options ufo
    ON ufo.user_id = e2.user_id
   AND ufo.kind = 'variation'
   AND ufo.key = u.k
  WHERE e2.variations IS NOT NULL AND array_length(e2.variations, 1) > 0
  GROUP BY e2.id
) sub
WHERE e.id = sub.id;

-- 3. Swap the old text[] column out for the new jsonb one.
ALTER TABLE exercises DROP COLUMN variations;
ALTER TABLE exercises RENAME COLUMN variations_jsonb TO variations;

-- 4. Remove the now-unused global variation options. The app no longer reads
--    or writes kind='variation'; labels live on the exercises after step 2.
DELETE FROM user_field_options WHERE kind = 'variation';
