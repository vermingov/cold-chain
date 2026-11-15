// What people do with their bodies (src/poses.ts).
//
// Every function here returns a pose: joint angles in degrees, keyed by the control names in person.rs, plus a few
// keys starting with an underscore that move the whole body: `_y` lifts it, `_pitch` tips it forward, `_roll` rolls it
// onto its side. They take time or a phase and nothing else.
//
// The rest pose MakeHuman ships is an A-pose: arms forty degrees out and thirty forward. RELAXED is what a person
// standing still actually looks like, arms straight down, and every pose is written as changes from it.
//
// A pose is a list, not a map: the order its controls were named in is the order turns of the same rank are put on a
// bone (person.rs apply), as the TS's object kept its keys in the order they were added.

pub type Pose = Vec<(&'static str, f32)>;

pub fn relaxed() -> Pose {
    vec![
        ("shoulderAbductL", -36.0), ("shoulderAbductR", -36.0),
        ("shoulderFlexL", -26.0), ("shoulderFlexR", -26.0),
        ("elbowL", 12.0), ("elbowR", 12.0),
        // (the hands loosely curled, the thumb in alongside the index: a hand hanging with nothing working it)
        ("curlL", 30.0), ("curlR", 28.0), ("thumbL", 26.0), ("thumbR", 25.0), ("thumbBaseL", -22.0), ("thumbBaseR", -22.0),
        ("thumbInL", 25.0), ("thumbInR", 25.0),
        ("hipAbductL", -2.0), ("hipAbductR", -2.0),
    ]
}

// `changes` added to `base`, each to the control of its name (new controls go on the end).
pub fn over(mut base: Pose, changes: &[(&'static str, f32)]) -> Pose {
    for &(k, v) in changes {
        match base.iter_mut().find(|(n, _)| *n == k) {
            Some((_, x)) => *x += v,
            None => base.push((k, v)),
        }
    }
    base
}

pub fn get(pose: &Pose, key: &str) -> f32 {
    pose.iter().find(|(n, _)| *n == key).map_or(0.0, |&(_, v)| v)
}

// Standing still is not a statue: the chest rises, the weight drifts from one foot to the other, and the head settles.
// Kept small enough that a person facing a wall reads as waiting rather than as fidgeting.
pub fn stand(t: f32, breathe: f32, still: f32) -> Pose {
    let b = (t * 1.55).sin() * breathe * (1.0 - still);
    let drift = (t * 0.37).sin() * (1.0 - still);
    over(relaxed(), &[
        ("spineFlex", -1.0 + b * 1.4),
        ("shrugL", b * 1.2), ("shrugR", b * 1.2),
        ("spineSide", drift * 1.5), ("hipAbductL", drift * 1.2), ("hipAbductR", -drift * 1.2),
        ("neckFlex", 4.0 + (t * 0.23).sin() * 2.0 * (1.0 - still)),
    ])
}
