-- Reassign primary/secondary muscles on Oliver's saved exercises (2026-07-17).
--
-- Run alongside the muscle-diagram improvements (side-aware delt shading,
-- grip -> hands region, hip flexors -> front adductors). Conventions applied:
--   * prime movers primary, stabilisers/synergists secondary (secondary counts
--     at 0.3x heat and never resets a muscle's "last trained" freshness)
--   * group tags kept alongside child tags (in-app filtering / sub-menus);
--     a child tag always brings its parent group somewhere on the exercise
--   * presses credit triceps, pulls credit biceps + grip, hinges put the
--     posterior chain in primary, rotation work tags obliques
--
-- One-off data migration, already applied in production. Kept for reference
-- and as the template for re-tagging other users' exercise libraries.
-- Sports (Basketball, Football, Frisbee, Tennis, Table Tennis, Walk), Yoga and
-- Timer Test are deliberately untagged so they don't drown the strength signal.
-- Duplicate exercise rows (same name + equipment) are updated identically.

with changes(name, equipment, new_primary, new_secondary) as (
  values
    -- presses & chest
    ('Bench Press', 'barbell'::text, array['chest']::text[], array['shoulders','front delts','arms','triceps']::text[]),
    ('Decline Bench Press', 'barbell', array['chest','lower chest'], array['shoulders','front delts','arms','triceps']),
    ('Incline Bench Press', 'dumbbell', array['chest','upper chest'], array['shoulders','front delts','arms','triceps']),
    ('Press-Up', 'bodyweight', array['chest'], array['arms','triceps','shoulders','front delts','core']),
    ('Downward Chest Press', 'cable', array['chest','lower chest'], array['shoulders','front delts','arms','triceps']),
    ('Peck Fly', 'machine', array['chest'], array['shoulders','front delts']),
    ('Overhead Press', 'dumbbell', array['shoulders','front delts'], array['arms','triceps','side delts','core']),
    ('Single-Arm Overhead Press', 'dumbbell', array['shoulders','front delts'], array['arms','triceps','core']),
    ('Single-Arm Landmine Press', 't-bar', array['shoulders','front delts','chest','upper chest'], array['arms','triceps','core']),
    ('Floor Press & Bicycle', 'kettlebell', array['chest','core','abs'], array['arms','triceps','shoulders','front delts','obliques']),
    ('Wall Handstand', 'bodyweight', array['shoulders','front delts'], array['arms','triceps','core','back','traps']),
    ('Halo', 'kettlebell', array['shoulders','arms','triceps'], array['core','back','traps']),
    ('Halo & Pullover', 'kettlebell', array['shoulders','arms','triceps','back','lats'], array['core']),
    -- pulls & back
    ('Barbell Row', 'barbell', array['back','lats'], array['arms','biceps','rear delts','core','lower back','grip']),
    ('Dumbbell Row', 'dumbbell', array['back','lats'], array['arms','biceps','rear delts','core','lower back','grip']),
    ('T-Bar Row', 't-bar', array['back','lats'], array['arms','biceps','rear delts','core','lower back','grip']),
    ('Single-Arm Row', 'kettlebell', array['back','lats'], array['core','lower back','arms','biceps','rear delts','grip']),
    ('Gorilla Row', 'kettlebell', array['back','lats'], array['core','lower back','arms','biceps','rear delts','grip']),
    ('Inverted Row', 'bodyweight', array['back','lats'], array['arms','biceps','rear delts','core','grip']),
    ('Assisted Pull-up', 'resistance band', array['back','lats'], array['arms','biceps','rear delts','core','grip']),
    ('Negative Pull-up', null, array['back','lats'], array['arms','biceps','forearms','grip','rear delts','core']),
    ('Scapular Pull-up', 'bodyweight', array['back','lats','traps'], array['arms','forearms','grip']),
    ('Dead Hang', 'bodyweight', array['arms','grip','forearms'], array['shoulders','back','lats','core']),
    ('Pullover', 'kettlebell', array['arms','triceps','back','lats'], array['shoulders']),
    ('SkiErg', null, array['back','lats','core'], array['arms','triceps','legs','shoulders']),
    ('Row', null, array['legs','back'], array['core','arms']),
    -- squats & lunges
    ('Barbell Squat', 'barbell', array['legs','quads','glutes'], array['core','hamstrings','adductors','lower back']),
    ('Hack Squat', 'machine', array['legs','quads','glutes'], array['hamstrings','adductors']),
    ('Leg Press', 'machine', array['legs','quads','glutes'], array['hamstrings','calves','adductors']),
    ('Sumo Squat', 'kettlebell', array['legs','adductors','glutes','quads'], array['core','lower back']),
    ('Assisted Cossack Squat', 'bodyweight', array['legs','quads','glutes','adductors'], array['core']),
    ('Alternating Lunges', null, array['legs','quads','glutes'], array['core','hamstrings','adductors']),
    ('Goblet Alternating Lunge', 'kettlebell', array['legs','quads','glutes'], array['core','hamstrings']),
    ('Jumping Alternating Lunges', 'kettlebell', array['legs','quads','glutes'], array['core','calves','hamstrings']),
    ('Box Jump', 'box', array['legs','quads','glutes'], array['calves','hamstrings','core']),
    ('Sled Push', 'sled', array['legs','quads','glutes','calves'], array['core','back']),
    ('Deep Squat', null, array['legs','ankles','hip flexors','adductors','glutes'], null),
    ('Assisted Deep Squat', null, array['legs','ankles','hip flexors','adductors','glutes'], null),
    ('Single-Arm Rack Squat', 'kettlebell', array['legs','quads','glutes'], array['core','lower back']),
    ('Wall Throw & Squat', 'medicine ball', array['legs','quads','glutes','shoulders','front delts'], array['arms','triceps','core']),
    -- hinges & swings
    ('Deadlift', 'barbell', array['legs','glutes','hamstrings','lower back'], array['core','back','traps','quads','arms','grip','forearms']),
    ('Romanian Deadlift', 'barbell', array['legs','hamstrings','glutes','lower back'], array['core','back','arms','grip','forearms']),
    ('Kettlebell Swing', 'kettlebell', array['legs','glutes','hamstrings'], array['core','lower back','shoulders','arms','grip','forearms']),
    ('Cross-Body Swing', 'kettlebell', array['legs','glutes','core','obliques'], array['hamstrings','shoulders','arms','grip']),
    ('Swing Squat', 'kettlebell', array['legs','glutes','quads','hamstrings'], array['core','lower back','shoulders','arms','grip']),
    ('Rotational Deadlift', 'kettlebell', array['legs','glutes','hamstrings','core','obliques'], array['lower back','arms','grip']),
    -- kettlebell complexes
    ('Alternating Overhead Press', 'kettlebell', array['shoulders','front delts'], array['arms','triceps','core','back','traps']),
    ('Double Clean & Squat', 'kettlebell', array['legs','quads','glutes','core'], array['arms','grip','forearms','back','traps','shoulders']),
    ('Double Half Snatch', 'kettlebell', array['shoulders','legs','glutes'], array['core','arms','grip','back','traps','hamstrings']),
    ('Double Rack Squat', 'kettlebell', array['legs','quads','glutes'], array['core','lower back']),
    ('Double Rack Squat & Overhead Press', 'kettlebell', array['shoulders','front delts','legs','quads','glutes'], array['core','arms','triceps']),
    ('Double Swing, Clean & Press', 'kettlebell', array['shoulders','legs','glutes','core'], array['arms','triceps','grip','back','traps','hamstrings']),
    ('Goblet Clean & Squat', 'kettlebell', array['legs','quads','glutes'], array['core','lower back','arms','grip']),
    ('Goblet Clean, Squat & Curl', 'kettlebell', array['legs','quads','glutes','arms','biceps'], array['core','lower back','grip']),
    ('Goblet Clean, Squat, Curl & Press', 'kettlebell', array['legs','quads','glutes','arms','biceps','shoulders','front delts'], array['core','lower back','triceps','grip']),
    ('High Clean', 'kettlebell', array['shoulders','back','traps'], array['arms','biceps','forearms','grip','core']),
    ('Hang, Clean & Press', 'barbell', array['shoulders','front delts','legs','glutes'], array['arms','triceps','back','traps','core','grip']),
    ('Single-Arm Bottom-Up Clean', 'kettlebell', array['arms','grip','forearms'], array['shoulders','core','obliques']),
    ('Single-Arm Clean & Squat', 'kettlebell', array['legs','quads','glutes'], array['core','obliques','lower back','arms','grip','shoulders']),
    ('Single-Arm Clean, Squat & Press', 'kettlebell', array['legs','quads','glutes','shoulders','front delts'], array['core','lower back','arms','triceps','grip']),
    ('Single-Arm Dead Clean & Squat', 'kettlebell', array['legs','quads','glutes'], array['core','arms','grip','back','traps']),
    ('Single-Arm Dead Snatch', 'kettlebell', array['shoulders','legs','glutes'], array['core','arms','grip','back','traps','hamstrings']),
    ('Single-Arm Dead Snatch & Press', 'kettlebell', array['shoulders','front delts','legs','glutes'], array['core','arms','triceps','grip','back','traps']),
    ('Single-Arm Snatch', 'kettlebell', array['shoulders','legs','glutes'], array['core','arms','grip','back','traps','hamstrings']),
    ('Single-Arm Snatch & Overhead Squat', 'kettlebell', array['legs','quads','glutes','shoulders'], array['core','arms','back','traps','grip']),
    ('Single-Arm Snatch & Windmill', 'kettlebell', array['core','obliques','shoulders'], array['legs','hamstrings','glutes','arms']),
    ('Single-Arm Swing, Bottom-Up Clean & Pullover', 'kettlebell', array['legs','glutes','arms','grip','forearms'], array['core','hamstrings','back','lats','shoulders','triceps']),
    ('Single-Arm Swing, High Pull & Snatch', 'kettlebell', array['legs','glutes','hamstrings','shoulders'], array['core','arms','grip','back','traps']),
    ('Halo & Pivot Lunge', 'kettlebell', array['shoulders','legs','quads','glutes','core'], array['arms','triceps']),
    -- core & rotation
    ('Side Bend', 'kettlebell', array['core','obliques'], array['lower back','arms','forearms','grip']),
    ('Woodchop', 'kettlebell', array['core','obliques'], array['shoulders','arms','legs']),
    ('Landmine Rotation', 't-bar', array['core','obliques'], array['shoulders','back','arms']),
    ('Landmine Rotational Clean & Press', 't-bar', array['core','obliques','shoulders','front delts'], array['legs','glutes','back','arms','triceps']),
    ('Rotational Wall Throw', 'medicine ball', array['core','obliques'], array['legs','glutes','shoulders']),
    ('Seated Rotation & Horn Press', 'kettlebell', array['core','obliques','shoulders'], array['arms','triceps']),
    ('Plank Thread the Needle', 'dumbbell', array['core','obliques','abs'], array['shoulders','back']),
    ('Double Leg Raise', 'bodyweight', array['core','abs','legs','hip flexors'], null),
    ('Decline Sit-up', 'bodyweight', array['core','abs'], array['legs','hip flexors','obliques']),
    ('Floor Slam', 'medicine ball', array['core','abs','back','lats'], array['legs','arms','shoulders']),
    ('Bird Dog', null, array['core','lower back'], array['legs','glutes','shoulders']),
    -- mobility & other
    ('Kneeling Hip Flexor Stretch', null, array['legs','hip flexors'], array['quads','glutes']),
    ('Reclined Pigeon', null, array['legs','glutes'], array['hip flexors']),
    ('90/90 Hip Switch', null, array['legs','adductors','hip flexors'], array['glutes']),
    ('Standing Fold & Reach', null, array['legs','hamstrings','calves','shoulders'], array['core','lower back']),
    ('Bicep Curl', 'dumbbell', array['arms','biceps'], array['forearms']),
    ('Bicep Curl', 'ez bar', array['arms','biceps'], array['forearms']),
    ('Burpee With Press-Up', 'bodyweight', array['legs','chest'], array['arms','triceps','shoulders','front delts','core','quads']),
    -- cardio machines
    ('BikeErg', null, array['legs','quads'], array['hamstrings','calves']),
    ('Assault Bike', null, array['legs','quads'], array['arms','core','calves']),
    ('Run', null, array['legs'], null),
    ('Incline Treadmill', null, array['legs'], null),
    ('StairMaster', null, array['legs','glutes','quads'], array['calves'])
)
update exercises e
set muscles = c.new_primary,
    secondary_muscles = c.new_secondary
from changes c
where e.user_id = '63ca9709-d6fe-4848-b33a-40f208518daa'
  and e.name = c.name
  and e.equipment is not distinct from c.equipment;

-- Fix typo (run after the update above — the changes CTE keys on the old name)
update exercises
set name = 'Pec Fly'
where user_id = '63ca9709-d6fe-4848-b33a-40f208518daa'
  and name = 'Peck Fly'
  and equipment = 'machine';

-- Verify
select name, equipment,
       array_to_string(muscles, ', ') as primary_muscles,
       array_to_string(secondary_muscles, ', ') as secondary_muscles
from exercises
where user_id = '63ca9709-d6fe-4848-b33a-40f208518daa'
order by name;
