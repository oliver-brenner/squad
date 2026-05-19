import { column, Schema, Table } from "@powersync/web";

// Mirrors the Postgres schema from gymtracker. PowerSync only supports three
// column types (TEXT, INTEGER, REAL); UUIDs and timestamps live as TEXT,
// booleans as INTEGER (0/1), and Postgres text[] columns are stored as
// JSON-encoded strings (encode/decode happens in the data-access layer).
//
// The `id` column is implicit on every table and is always TEXT/UUID.

const profiles = new Table(
  {
    username: column.text,
    display_name: column.text,
    avatar_url: column.text,
    created_at: column.text,
  },
  { viewName: "profiles" }
);

const exercises = new Table(
  {
    user_id: column.text,
    name: column.text,
    // JSON-encoded text[]; decode/encode in the data layer
    categories: column.text,
    equipment: column.text,
    is_bodyweight: column.integer,
    track_reps: column.integer,
    default_weight_kg: column.real,
    double_reps: column.integer,
    distance_unit: column.text,
    track_time: column.integer,
    time_unit: column.text,
    track_resistance: column.integer,
    track_speed: column.integer,
    speed_unit: column.text,
    track_incline: column.integer,
    incline_unit: column.text,
    track_rest: column.integer,
    track_calories: column.integer,
    muscles: column.text,
    secondary_muscles: column.text,
    created_at: column.text,
  },
  {
    viewName: "exercises",
    indexes: {
      user: ["user_id"],
    },
  }
);

const workouts = new Table(
  {
    user_id: column.text,
    name: column.text,
    // YYYY-MM-DD
    performed_on: column.text,
    session_type: column.text,
    notes: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    viewName: "workouts",
    indexes: {
      user_date: ["user_id", "performed_on"],
    },
  }
);

const sets = new Table(
  {
    // Denormalised from workouts.user_id — kept in sync by a Postgres trigger.
    // Needed so the followee_sets sync bucket can filter without a JOIN.
    user_id: column.text,
    // Denormalised from workouts.performed_on — also trigger-maintained. Lets
    // the followee_sets sync bucket apply the rolling `feed_since` window
    // without joining workouts.
    performed_on: column.text,
    workout_id: column.text,
    exercise_id: column.text,
    position: column.integer,
    reps: column.integer,
    weight_kg: column.real,
    distance_km: column.real,
    duration_sec: column.integer,
    resistance: column.integer,
    speed_ms: column.real,
    incline_pct: column.real,
    rest_sec: column.integer,
    calories: column.integer,
    circuit_id: column.text,
    circuit_rounds: column.integer,
    circuit_name: column.text,
  },
  {
    viewName: "sets",
    indexes: {
      workout: ["workout_id"],
      exercise: ["exercise_id"],
    },
  }
);

const user_field_options = new Table(
  {
    user_id: column.text,
    kind: column.text,
    parent_id: column.text,
    key: column.text,
    label: column.text,
    position: column.integer,
    created_at: column.text,
  },
  {
    viewName: "user_field_options",
    indexes: {
      user_kind: ["user_id", "kind"],
    },
  }
);

const follows = new Table(
  {
    follower_id: column.text,
    followee_id: column.text,
    created_at: column.text,
  },
  {
    viewName: "follows",
    indexes: {
      followee: ["followee_id"],
    },
  }
);

export const AppSchema = new Schema({
  profiles,
  exercises,
  workouts,
  sets,
  user_field_options,
  follows,
});

// Raw row shapes as PowerSync stores them in local SQLite: snake_case,
// booleans as 0/1, arrays as JSON strings, timestamps as ISO strings.
// UI code should consume the decoded camelCase types in `./types.ts` instead;
// these raw shapes are only used by the decoders and ad-hoc useQuery callers.
export type Database = (typeof AppSchema)["types"];
export type ProfileRow = Database["profiles"];
export type ExerciseRow = Database["exercises"];
export type WorkoutRow = Database["workouts"];
export type WorkoutSetRow = Database["sets"];
export type UserFieldOptionRow = Database["user_field_options"];
export type FollowRow = Database["follows"];
export type SessionType = "workout" | "stretch" | "sport" | "lifestyle";
export type UserFieldKind = "category" | "equipment" | "muscle_group" | "muscle_child";
