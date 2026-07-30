ALTER TABLE profiles ADD COLUMN IF NOT EXISTS duration_tracking_enabled boolean NOT NULL DEFAULT false;
