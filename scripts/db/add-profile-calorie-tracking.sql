ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calorie_tracking_enabled boolean NOT NULL DEFAULT false;
