-- Body-map sex toggle for the dashboard muscle heatmap. Controls which body
-- silhouette (male/female) is rendered. Defaults to male per product decision.
-- Run BEFORE deploying the client that writes this column.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sex text NOT NULL DEFAULT 'male';
