// A person's bones: how strong each one is, what breaks it and how it breaks, and what the break then does to the
// body, inside and out (src/sandbox/bones.ts; the drawing of a break, `_draw` and shards.ts, is phase 3's: each break is
// handed over as `Happened::Drawn`).
//
// A bone is broken by force, not by a store of energy: a blow, a fall onto the floor, a joint wrenched past its range.
// The force a blow makes is the one a spring of flesh over the bone makes when something of mass m hits it at v,
// F = v sqrt(k m) (Robinovitch, Hayes and McMahon 1991, for a fall on the hip): a bat on a shin, with a few millimetres
// of skin over the bone, makes three times the force it makes on a thigh. That force against the bone's own strength
// (BONES, a young man's, laboratory figures) scaled by this person's age and build says whether it breaks; how far over
// says how badly, and the way it was loaded says how it breaks: bent, it breaks across (transverse), then with a wedge
// knocked out of it (butterfly), then in pieces (comminuted); twisted, it breaks in a spiral; crushed along its length,
// a vertebra is squashed (compression) or bursts. A blow that does not break a bone still cracks it a little, and the
// next one breaks it sooner.
//
// A bullet is different: what decides is its energy per square millimetre of its face when it reaches the bone, and the
// break follows the wounding literature (Bartlett et al. 2000): a drill hole through the soft ends of a long bone, a
// shattered shaft, and from a rifle a shaft blown to pieces that go on through the flesh as missiles of their own
// (wounds.rs's shards).
//
// What a break does: a broken shaft lets the limb bend and turn at the break (the ragdoll's mid joint, here given the
// range the kind of break allows); a break at a bone's end loosens the joint there; a femur or tibia will not carry
// weight; ribs make breathing hurt and a flail segment stops a lung filling; a broken neck or back can cut the cord; a
// skull fracture bruises the brain, and one over the temple tears the artery under it and bleeds into the skull until the
// brain is crushed. A closed fracture bleeds into the limb what ATLS says it does. A shaft bent far enough at the break
// drives the bone's end out through the skin (an open fracture).
//
// What the ragdoll does about a break (ranges, the mid joint let go, a joint gone limp) is asked of it through
// `Happened::Joint` and `Happened::Broke`: ragdoll.rs and behaviour.rs (phase 2) take them. Where the TS read the
// ragdoll's state (a segment's speed, a joint's angles) the function the body calls is said below ("port: needs body").

use std::collections::{HashMap, HashSet};

use bevy::prelude::*;

use crate::npc::{Crossing, Happened, Joint, Kind, Npc, Way};
use crate::person::RAD;
use crate::vitals::{Bleed, Into, Rhythm, Side};
use crate::wounds::{cap, Tool};

// Each bone by its name (side left off): its strength in a young adult man, and what lies over it. The figures and
// their sources are in dev/research/blunt-trauma.md; laboratory specimens are mostly elderly, so these are the middles of
// what is reported, and every body varies round them (`grain`).
//   moment  N m of bending a long bone's shaft takes (three-point bending at speed: Kerrigan 2004, Nyquist 1985,
//           Kirkish 1996, Pintar 1998; the ulna goes before the radius)
//   bend    N across a flat bone, measured with a 6.5 cm2 impactor (skull: Yoganandan 1995, Nahum 1968; face: Nahum
//           1975; clavicle 1.48 kN axial)
//   twist   N m about its length before it breaks in a spiral
//   ends    N on its spongy ends (the femur's neck in a fall on the hip: Courtney 1995, 7.2 kN young, 3.4 kN old)
//   axial   N along it (vertebrae: Brinckmann 1989; the neck 2.2 kN in men; the tibia 16.6 kN at speed, Crandall)
//   pad     N/m: how stiff the flesh over it is (the spring in F = v sqrt(k m))
//   wide    m: how thick it is where a bullet crosses it (a shaft across, a flat bone through)
//   blood   litres a closed fracture of it bleeds into the tissues (ATLS: femur 1-1.5, tibia 0.75, humerus 0.5-0.75,
//           pelvis 1.5-3, a rib 0.1-0.15)
//   open    degrees the shaft must bend at the break before its end comes through the skin: the shin's front has nothing
//           over it but skin, the thigh has the whole quadriceps (none for the fibula, deep in the calf's muscle)
//   long    [its first bone, the bone at its far end, the ragdoll segment it is in]
#[derive(Clone, Copy)]
pub struct BoneSpec {
    pub bend: f32,
    pub moment: Option<f32>,
    pub twist: Option<f32>,
    pub ends: Option<f32>,
    pub axial: Option<f32>,
    pub pad: f32,
    pub wide: Option<f32>,
    pub blood: f32,
    pub open: Option<f32>,
    pub long: Option<[&'static str; 3]>,
    pub pain: f32,
}

const fn flat(bend: f32, axial: Option<f32>, wide: f32, pad: f32, blood: f32, pain: f32) -> BoneSpec {
    BoneSpec { bend, moment: None, twist: None, ends: None, axial, pad, wide: Some(wide), blood, open: None, long: None, pain }
}

#[allow(clippy::too_many_arguments)]
const fn long(bend: f32, moment: f32, twist: f32, ends: f32, axial: Option<f32>, pad: f32, wide: f32, blood: f32, open: Option<f32>,
              long: [&'static str; 3], pain: f32) -> BoneSpec {
    BoneSpec { bend, moment: Some(moment), twist: Some(twist), ends: Some(ends), axial, pad, wide: Some(wide), blood, open, long: Some(long), pain }
}

pub fn spec(key: &str) -> Option<BoneSpec> {
    Some(match key {
        "femur" => long(4300.0, 447.0, 180.0, 7000.0, None, 40e3, 0.028, 1.25, Some(55.0), ["upperleg01", "lowerleg01", "thigh"], 0.6),
        "tibia" => long(3500.0, 312.0, 95.0, 5000.0, Some(16600.0), 300e3, 0.024, 0.75, Some(25.0), ["lowerleg01", "foot", "shin"], 0.55),
        "fibula" => long(700.0, 60.0, 25.0, 2000.0, None, 100e3, 0.012, 0.1, None, ["lowerleg01", "foot", "shin"], 0.3),
        "humerus" => long(1330.0, 230.0, 70.0, 3000.0, None, 80e3, 0.022, 0.6, Some(45.0), ["upperarm01", "lowerarm01", "upperarm"], 0.5),
        "radius" => long(520.0, 100.0, 20.0, 3800.0, None, 150e3, 0.015, 0.25, Some(30.0), ["lowerarm01", "wrist", "forearm"], 0.45),
        "ulna" => long(630.0, 94.0, 20.0, 2500.0, None, 300e3, 0.014, 0.25, Some(30.0), ["lowerarm01", "wrist", "forearm"], 0.45),
        "clavicle" => flat(1480.0, Some(1480.0), 0.012, 300e3, 0.1, 0.45),
        "scapula" => flat(3500.0, None, 0.006, 40e3, 0.3, 0.4),
        "rib" => flat(2500.0, None, 0.01, 100e3, 0.12, 0.15),
        "sternum" => flat(4000.0, None, 0.012, 300e3, 0.15, 0.45),
        "skull" => flat(6100.0, None, 0.008, 500e3, 0.0, 0.4),
        "maxilla" => flat(1300.0, None, 0.006, 300e3, 0.1, 0.5),
        "zygoma" => flat(1600.0, None, 0.008, 300e3, 0.05, 0.45),
        "nasal" => flat(450.0, None, 0.004, 300e3, 0.0, 0.4),
        "jaw" => flat(1800.0, None, 0.012, 400e3, 0.05, 0.5),
        // The hyoid and the voice box are estimates: they break from blows and grips to the front of the neck that leave
        // the neck's bones whole, and more easily in the old, whose cartilage has turned to brittle bone.
        "hyoid" => flat(400.0, None, 0.004, 100e3, 0.02, 0.45),
        "larynx" => flat(700.0, None, 0.004, 100e3, 0.03, 0.5),
        "cervical vertebra" => flat(3000.0, Some(2240.0), 0.02, 100e3, 0.05, 0.5),
        "thoracic vertebra" => flat(4000.0, Some(4500.0), 0.03, 150e3, 0.1, 0.5),
        "lumbar vertebra" => flat(5000.0, Some(6000.0), 0.035, 150e3, 0.15, 0.55),
        "sacrum" => flat(5000.0, Some(5000.0), 0.03, 70e3, 0.5, 0.55),
        "hip bone" => flat(8000.0, None, 0.015, 70e3, 1.5, 0.65),
        "kneecap" => flat(6000.0, None, 0.02, 150e3, 0.05, 0.45),
        // The small bones of the hand and foot (estimates against the forces of a fall on the hand, a punch's knuckles and
        // a stamped foot): the scaphoid is what a young man breaks falling on his hand, a metacarpal what a punch breaks.
        "scaphoid" => flat(2400.0, None, 0.012, 150e3, 0.02, 0.35),
        "carpal" => flat(3000.0, None, 0.012, 150e3, 0.02, 0.35),
        "metacarpal" => flat(900.0, None, 0.009, 200e3, 0.02, 0.35),
        "finger" => flat(350.0, None, 0.007, 200e3, 0.01, 0.3),
        "calcaneus" => flat(4000.0, Some(7000.0), 0.03, 200e3, 0.15, 0.45),
        "tarsal" => flat(3000.0, Some(7000.0), 0.02, 200e3, 0.05, 0.4),
        "metatarsal" => flat(1000.0, None, 0.01, 200e3, 0.03, 0.35),
        "toe" => flat(350.0, None, 0.008, 200e3, 0.01, 0.3),
        _ => return None,
    })
}

// The skull by where it is struck, N with a 6.5 cm2 impactor: the temple is thinnest (Nahum: 3.9 kN in men), the
// forehead 2.7-9.9 kN, the side 4.2-9.6 (Stalnaker); the face far less: the nose lowest of all (never measured, it always
// broke first), the maxilla 0.63-1.98 kN, the zygoma 0.61-3.47, the mandible 0.82-3.4 from the side and 1.9-4.1 at the
// chin (Nahum 1975). The eye socket's floor is paper-thin and goes when something broad drives the eye back (estimate:
// below the cheek); the jaw takes more at the chin than from the side.
fn place_strength(place: &str) -> f32 {
    match place {
        "temple" => 3900.0,
        "forehead" => 6300.0,
        "side" => 6100.0,
        "back" => 8000.0,
        "base" => 6100.0,
        "eye" => 1200.0,
        "chin" => 2800.0,
        _ => 0.0,
    }
}

// Which bone of the skull is which place on it.
fn vault(name: &str) -> &'static str {
    if name.starts_with("frontal") {
        "forehead"
    } else if name.contains("temporal") {
        "temple"
    } else if name.contains("parietal") {
        "side"
    } else if name.starts_with("occipital") {
        "back"
    } else if name.contains("sphenoid") || name.contains("ethmoid") {
        "base"
    } else {
        ""
    }
}

// What hits: how stiff it is (N/m) and the patch it lands on (cm2). A fist and the arm behind it give (an untrained punch
// is 0.5-0.85 kN, a boxer's 3.4 kN at 9 m/s: Walilko 2005); a bat is a 6.5 cm cylinder; halving the patch about doubles
// the chance of a fracture (Yoganandan), so thresholds measured with 6.5 cm2 scale with the patch. A claw hammer's face is
// about an inch across (5 cm2: Goots18's hammer impactor). A wall met by a body part (thuds.rs) is flat and wider than any
// part: it meets it along its whole length.
#[derive(Clone, Copy, Debug)]
pub struct What {
    pub k: f32,
    pub area: f32,
}

pub fn tool(name: &str) -> Option<What> {
    Some(match name {
        "fist" => What { k: 9e3, area: 40.0 },
        "bat" => What { k: 2e6, area: 8.0 },
        "flat" => What { k: 5e6, area: 25.0 },
        "edge" => What { k: 5e6, area: 2.0 },
        "hammer" => What { k: 5e6, area: 5.0 },
        "wall" => What { k: 5e6, area: 2500.0 },
        _ => return None,
    })
}

// Ribs break by how far the chest is pushed in, not how fast: past a fifth of its depth they break, past two fifths a
// panel of them breaks in two places (Kroell); the chest is about 23 cm deep and about 40 N/mm stiff to a broad load.
const CHEST_DEPTH: f32 = 0.23;
const CHEST_STIFF: f32 = 40e3;
// Unprotected head on a hard floor: the speed that fractured cadaver skulls in Gurdjian's drops, m/s.
fn drop_speed(place: &str) -> f32 {
    match place {
        "forehead" => 4.6,
        "side" => 5.7,
        "temple" => 5.0,
        _ => 4.9,
    }
}
// A long bone's ends: what a break there is called, and the joint it loosens (the ragdoll segment below the joint).
fn ends(key: &str) -> [(&'static str, Option<&'static str>); 2] {
    match key {
        "femur" => [("neck (the hip)", Some("thigh")), ("lower end, above the knee", Some("shin"))],
        "tibia" => [("top, into the knee", Some("shin")), ("lower end, into the ankle", Some("foot"))],
        "fibula" => [("head, below the knee", None), ("lower end, at the ankle", Some("foot"))],
        "humerus" => [("neck, at the shoulder", Some("upperarm")), ("lower end, above the elbow", Some("forearm"))],
        "radius" => [("head, at the elbow", Some("forearm")), ("lower end, at the wrist", Some("hand"))],
        _ => [("top, at the elbow", Some("forearm")), ("lower end, at the wrist", Some("hand"))],
    }
}
// What each break of the face is called on the monitor ($side where it is one-sided).
fn face_words(t: &str) -> Option<&'static str> {
    Some(match t {
        "hyoid" => "Hyoid bone broken: swallowing and breathing hurt",
        "larynx" => "Voice box broken: hoarse, breathing noisily",
        "nasal" => "Nose broken",
        "blowout" => "$Side eye socket's floor blown out: the eye sinks and sees double",
        "zygoma" => "$Side cheekbone broken and pushed in",
        "lefort1" => "Le Fort I fracture: the upper teeth and palate broken loose",
        "lefort2" => "Le Fort II fracture: the middle of the face broken loose through the nose",
        "lefort3" => "Le Fort III fracture: the face broken off the skull",
        "chin" => "Jaw broken at the chin",
        "body" => "Jaw broken along the $side teeth",
        "angle" => "Jaw broken at the $side angle",
        "condyle" => "Jaw broken at the $side joint",
        "condyles" => "Jaw broken at both joints from the blow to the chin",
        _ => return None,
    })
}
fn words(t: &str) -> Option<&'static str> {
    Some(match t {
        "transverse" => "transverse fracture",
        "oblique" => "oblique fracture",
        "spiral" => "spiral fracture",
        "butterfly" => "fracture with a butterfly fragment",
        "comminuted" => "comminuted fracture",
        "drill hole" => "bullet hole through the bone",
        "gutter" => "gouged by the bullet",
        "linear" => "linear fracture",
        "depressed" => "depressed fracture, pushed in on the brain",
        "basilar" => "basilar fracture",
        "compression" => "compression fracture",
        "burst" => "burst fracture",
        "simple" => "fracture",
        _ => return None,
    })
}
// How far a broken shaft can now bend at the break (hinge, twist, side; radians), by how it broke: a transverse break
// keeps a hinge of periosteum and its ends catch on each other; a shattered one is held only by the muscle and skin
// round it.
fn give(t: &str) -> Option<[f32; 3]> {
    Some(match t {
        "transverse" => [0.6, 0.2, 0.6],
        "oblique" => [0.7, 0.3, 0.7],
        "spiral" => [0.5, 0.8, 0.5],
        "butterfly" => [0.8, 0.4, 0.8],
        "comminuted" => [1.0, 0.6, 1.0],
        _ => return None,
    })
}
fn unstable(t: &str) -> bool {
    give(t).is_some()
}
// The bone that shares a limb segment with each, and breaks with it when it is displaced.
fn partner(key: &str) -> Option<&'static str> {
    match key {
        "tibia" => Some("fibula"),
        "radius" => Some("ulna"),
        "ulna" => Some("radius"),
        _ => None,
    }
}
// Metres the two halves can slide past each other: the thigh's muscles pull an oblique or shattered femur short.
fn shorten(t: &str) -> f32 {
    match t {
        "oblique" | "butterfly" => 0.02,
        "spiral" => 0.015,
        "comminuted" => 0.03,
        _ => 0.004,
    }
}

// What gives when a joint is bent the way it does not bend, by a blow landing at it: at what torque (N m, a young
// adult's) and how. Knee: Kajzer et al. 1999 (about 140 N m sideways); the rest are estimates from injury series, as
// there are no clean figures for a living joint with its muscles round it. The neck's facet joints: the upper cervical
// spine holds about 17 N m twisted (AI-Neck), more bent.
fn joint_of(base: &str) -> Option<(&'static str, f32, &'static str)> {
    Some(match base {
        "upperarm" => ("shoulder", 70.0, "dislocated"),
        "forearm" => ("elbow", 45.0, "dislocated"),
        "hand" => ("wrist", 50.0, "wrist"),
        "shin" => ("knee", 140.0, "torn"),
        "foot" => ("ankle", 60.0, "torn"),
        "thigh" => ("hip", 250.0, "dislocated"),
        "head" => ("neck", 60.0, "facets"),
        _ => return None,
    })
}
// Where a dislocated joint is held (hinge, twist, side; degrees, as the pose controls count them); none for a knee, which
// once out holds nowhere.
fn out_pose(base: &str) -> Option<[f32; 3]> {
    match base {
        "upperarm" => Some([25.0, 35.0, 30.0]),
        "forearm" => Some([45.0, 0.0, 0.0]),
        "thigh" => Some([45.0, -30.0, -20.0]),
        _ => None,
    }
}
// The share of a person's weight behind each part that breaks a fall when it hits the floor: the hip carries about half
// the body into it in a fall on the side (Robinovitch et al. 1991), an outstretched hand a few per cent, the elbow giving
// (Chiu and Robinovitch 1998), a shoulder or the side of the chest a tenth with the arm taking some.
fn landing(base: &str) -> Option<f32> {
    match base {
        "head" => Some(0.06),
        "chest" => Some(0.1),
        "pelvis" => Some(0.4),
        "hand" => Some(0.05),
        "foot" => Some(0.5),
        _ => None,
    }
}
const LEVER: f32 = 0.05; // m: a blow's force on the joint it lands at acts over about an eighth of the limb
fn struck(base: &str) -> f32 {
    match base {
        "head" => 0.08,
        "chest" => 0.3,
        "belly" => 0.2,
        "pelvis" => 0.4,
        "upperarm" => 0.04,
        "upperarm2" => 0.035,
        "forearm" | "forearm2" => 0.022,
        "hand" => 0.008,
        "thigh" => 0.15,
        "thigh2" => 0.12,
        "shin" => 0.06,
        "shin2" => 0.05,
        "foot" => 0.02,
        _ => 0.05,
    }
}
// The bone a blow to each segment lands on when the line it came along misses every bone.
fn under(base: &str) -> Option<&'static str> {
    match base {
        "head" => Some("frontal bone"),
        "pelvis" => Some("hip bone"),
        "upperarm" => Some("humerus"),
        "forearm" => Some("ulna"),
        "hand" => Some("third metacarpal bone"),
        "thigh" => Some("femur"),
        "shin" => Some("tibia"),
        "foot" => Some("second metatarsal bone"),
        _ => None,
    }
}

const PERFORATE: f32 = 0.2; // J/mm2 of a bullet's face to break through bone: twice skin's 0.1 (Sellier and Kneubuehl)
const CLOT: f32 = 0.002; // how fast a fracture's bleeding slows: what it loses in all is its rate over this

#[derive(Clone, Debug)]
pub struct Break {
    pub part: String,
    pub key: String,
    pub side: Option<Side>,
    pub r#type: String,
    pub how: String,
    pub ratio: f32,
    pub r#where: String,
    pub end: i32,
    pub s: f32,
    pub hit: f32,
    // Where and which way, in the person's rest space, and the bone that carries it.
    pub at: Vec3,
    pub dir: Vec3,
    pub owner: usize,
    pub open: bool,
    // The ragdoll segment that bends at it (a shaft let go at its mid joint).
    pub seg: Option<String>,
    pub count: u32,
    pub level: String,
    pub text: String,
    pub place: String,
    pub through: bool,
    pub wound: Option<Crossing>,
    pub out: Option<Vec3>,
}

// Where on a bone a load lands (the TS's `_rest`): in rest space, along a long bone and at which end, the skull's base.
#[derive(Clone, Debug)]
pub struct Rest {
    pub p: Vec3,
    pub d: Vec3,
    pub owner: usize,
    pub s: f32,
    pub end: i32,
    pub base: bool,
    pub place: String,
}

// A load on a bone (the TS's `load` options).
#[derive(Clone, Copy, Debug, Default)]
pub struct Load {
    pub force: f32,
    pub moment: f32,
    pub area: Option<f32>,
    pub twist: f32,
    pub axial: f32,
    pub at: Option<Vec3>,
    pub dir: Option<Vec3>,
    pub end: Option<i32>,
}

pub struct Bones {
    pub age: f32,
    pub cortical: f32,
    pub spongy: f32,
    pub build: f32,
    pub grain: HashMap<String, f32>,
    pub damage: HashMap<String, f32>,
    pub breaks: Vec<Break>,
    pub joints: HashMap<String, String>,
    pub epidural: Option<usize>,
    // How far the jaw hangs open, degrees, broken or out of its joints: the face (face.rs) lets it hang that far.
    pub jaw_hangs: f32,
    // The long bones' mid joints already let go (the ragdoll's breakAt).
    mids: HashSet<String>,
}

// A bone's kind, from its name (tools/anatomy.py keeps the source's names): what BONES has it under.
pub fn key_of(name: &str) -> String {
    let ends_any = |l: &[&str]| l.iter().any(|e| name.ends_with(e));
    let phalanx = name.contains("phalanx of ");
    let k = if name.ends_with(" rib") {
        "rib"
    } else if name.ends_with("cervical vertebra") || name == "atlas" || name == "axis" {
        "cervical vertebra"
    } else if name.ends_with("thoracic vertebra") {
        "thoracic vertebra"
    } else if name.ends_with("lumbar vertebra") {
        "lumbar vertebra"
    } else if name == "frontal bone" || ends_any(&["parietal bone", "temporal bone"]) || name == "occipital bone" || name == "sphenoid bone" || name == "ethmoid" {
        "skull"
    } else if ends_any(&["maxilla", "palatine bone"]) {
        "maxilla"
    } else if name.ends_with("zygomatic bone") {
        "zygoma"
    } else if ends_any(&["nasal bone", "lacrimal bone"]) || name == "vomer" {
        "nasal"
    } else if name == "mandible" {
        "jaw"
    } else if name == "hyoid bone" {
        "hyoid"
    } else if name.ends_with("cartilage") {
        "larynx"
    } else if name.ends_with("scaphoid") {
        "scaphoid"
    } else if ends_any(&["lunate", "triquetral", "pisiform", "trapezium", "capitate", "hamate"]) {
        "carpal"
    } else if name.ends_with("metacarpal bone") {
        "metacarpal"
    } else if phalanx && ends_any(&["finger", "thumb"]) {
        "finger"
    } else if name.ends_with("calcaneus") {
        "calcaneus"
    } else if ends_any(&["talus", "cuboid bone", "cuneiform bone"]) || (name.starts_with("navicular bone of ") && name.ends_with(" foot")) {
        "tarsal"
    } else if name.ends_with("metatarsal bone") {
        "metatarsal"
    } else if phalanx && name.ends_with("toe") {
        "toe"
    } else if name.ends_with("patella") {
        "kneecap"
    } else {
        return name.strip_prefix("left ").or_else(|| name.strip_prefix("right ")).unwrap_or(name).to_string();
    };
    k.to_string()
}

const FACE_BONES: [&str; 3] = ["maxilla", "zygoma", "nasal"];

pub fn side_of(name: &str) -> Option<Side> {
    if name.starts_with("left ") || name.contains(" left ") {
        Some(Side::L)
    } else if name.starts_with("right ") || name.contains(" right ") {
        Some(Side::R)
    } else {
        None
    }
}

const NUMBER: [&str; 12] = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

// A vertebra's level ('C5', 'T12', 'L1') or a rib's number, from its name.
pub fn level_of(name: &str) -> String {
    if name == "atlas" {
        return "C1".into();
    }
    if name == "axis" {
        return "C2".into();
    }
    let n = NUMBER.iter().position(|w| name.contains(&format!("{w} "))).map_or(0, |i| i + 1);
    if name.ends_with(" rib") {
        return n.to_string();
    }
    format!("{}{n}", if name.contains("cervical") { 'C' } else if name.contains("thoracic") { 'T' } else { 'L' })
}

fn rib_name(side: &str, n: usize) -> String {
    format!("{side} {} rib", NUMBER[n - 1])
}

fn word_of(side: Option<Side>) -> &'static str {
    if side == Some(Side::L) { "left" } else { "right" }
}

fn letter(side: Option<Side>) -> &'static str {
    match side {
        Some(Side::L) => "L",
        Some(Side::R) => "R",
        None => "",
    }
}

// Age from MakeHuman's slider (person.rs's people are MakeHuman's): 0.5 is 25 years, 1 is 90.
pub fn years_of(slider: f32) -> f32 {
    if slider < 0.5 { 1.0 + slider * 48.0 } else { 25.0 + (slider - 0.5) * 130.0 }
}

// A long bone's line in rest space (BonesOf::axis, for shards.rs too).
pub fn long_axis(body: &crate::person::Body, name: &str) -> (Vec3, Vec3, f32, usize, usize) {
    let b = spec(&key_of(name)).unwrap();
    let side = letter(side_of(name));
    let [first, next, _] = b.long.unwrap();
    let near = body.by_name[&format!("{first}.{side}")];
    let a = body.bones[near].head;
    let z = body.bone(&format!("{next}.{side}")).head;
    let d = z - a;
    (a, d.normalize(), d.length(), near, body.by_name[&crate::ragdoll::mid_of(first, side)])
}

// Some direction square to unit `u`, toward `hint` if it can be.
pub fn across(u: Vec3, hint: Vec3) -> Vec3 {
    let mut d = hint - u * hint.dot(u);
    if d.length_squared() < 1e-6 {
        d = u.cross(if u.y.abs() < 0.9 { Vec3::Y } else { Vec3::X });
    }
    d.normalize()
}

// How much bone a bullet crossing bone `name` goes through, m.
pub fn thickness(name: &str) -> f32 {
    spec(&key_of(name)).and_then(|b| b.wide).unwrap_or(0.015)
}

impl Bones {
    pub fn new(slider: f32, mass: f32) -> Bones {
        let age = years_of(slider);
        Bones {
            age,
            // Cortical bone (the shafts) loses about 6% of its strength a decade after thirty, the spongy bone of the hip,
            // the wrist and the vertebrae about twice that (McCalden et al. 1993; Courtney et al. 1995).
            cortical: (1.0 - 0.006 * (age - 30.0)).clamp(0.6, 1.0),
            spongy: (1.0 - 0.012 * (age - 30.0)).clamp(0.4, 1.0),
            build: (mass / 75.0).powf(2.0 / 3.0),
            grain: HashMap::new(),
            damage: HashMap::new(),
            breaks: Vec::new(),
            joints: HashMap::new(),
            epidural: None,
            jaw_hangs: 0.0,
            mids: HashSet::new(),
        }
    }

    // Whether bone `name` is broken (in its `where`, if given).
    pub fn broken(&self, name: &str, r#where: &str) -> bool {
        self.breaks.iter().any(|b| b.part == name && (r#where.is_empty() || b.r#where == r#where))
    }
}

// A person's bones at work: `npc.bones().impact(...)`.
pub struct BonesOf<'n, 'a>(pub &'n mut Npc<'a>);

impl<'a> Npc<'a> {
    pub fn bones<'n>(&'n mut self) -> BonesOf<'n, 'a> {
        BonesOf(self)
    }
}

impl BonesOf<'_, '_> {
    fn b(&mut self) -> &mut Bones {
        &mut self.0.hurt.bones
    }

    // --- strength --------------------------------------------------------------------------------------------------

    // Two men of one age and size still differ, bone by bone, by a tenth or so either way.
    fn grain(&mut self, name: &str) -> f32 {
        if let Some(&g) = self.0.hurt.bones.grain.get(name) {
            return g;
        }
        let g = 0.9 + self.0.dice.next() * 0.2;
        self.b().grain.insert(name.to_string(), g);
        g
    }

    // What bone `name` takes now in one way of loading it: "moment" (N m, a shaft bent), "bend" (N across a flat bone),
    // "twist", "ends" or "axial"; `base` instead of the table's figure where the place on the bone decides it (the skull).
    pub fn strength(&mut self, name: &str, way: &str, base: f32) -> f32 {
        let b = spec(&key_of(name)).unwrap();
        let table = match way {
            "moment" => b.moment,
            "twist" => b.twist,
            "ends" => b.ends,
            "axial" => b.axial,
            _ => None,
        };
        let figure = if base != 0.0 { base } else { table.unwrap_or(b.bend) };
        let spongy = way == "ends" || way == "axial" || name.contains("vertebra") || name == "atlas" || name == "axis" || name.contains("sacrum")
            || name.contains("patella") || name.contains("calcaneus");
        let cracked = 1.0 - 0.5 * self.0.hurt.bones.damage.get(name).copied().unwrap_or(0.0);
        let (sp, co, build) = (self.0.hurt.bones.spongy, self.0.hurt.bones.cortical, self.0.hurt.bones.build);
        figure * if spongy { sp } else { co } * build * self.grain(name) * cracked
    }

    // A load on bone `name`, `how` it came ("blow", "fall", "wrench"): `force` N across it over `area` cm2 (or, for a long
    // bone's shaft, `moment` N m bending it), `twist` N m about it, `axial` N along it, at `at` (world) going `dir`; `end`
    // 0 or 1 for a load on a long bone's end (a fall on the hip or the hand). Breaks it if it is more than the bone takes,
    // and cracks it a little if it comes near. The break's index, or None.
    pub fn load(&mut self, name: &str, how: &str, o: Load) -> Option<usize> {
        let key = key_of(name);
        let b = spec(&key)?;
        if !self.0.traced.parts.iter().any(|p| p.name == name) {
            return None;
        }
        let end = o.end.unwrap_or(-1);
        let area = o.area.unwrap_or(6.5);
        let rest = self.rest(name, o.at, o.dir, end);
        let mut moment = o.moment;
        // A shaft struck across is bent between the limb's two ends; the limb is not held at them, so the lever is an
        // eighth of its length rather than the quarter of a bone on two supports. That is for a narrow blow; one spread over
        // `c` of the limb's length bends it F (L - c) / 8 (the load over c against the limb's own inertia over L), so a wall
        // or the floor met flat along the whole of it bends it not at all and only crushes the flesh over it.
        if b.long.is_some() && rest.end < 0 && moment == 0.0 {
            let length = self.axis(name).2;
            moment = (o.force * (length - area.sqrt() / 100.0).max(0.0)) / 8.0;
        }
        let spread = (area / 6.5).powf(0.3).clamp(0.6, 1.8);
        let across = if b.long.is_some() && rest.end < 0 {
            moment / self.strength(name, "moment", 0.0)
        } else {
            o.force / (self.strength(name, if end >= 0 { "ends" } else { "bend" }, place_strength(&rest.place)) * spread)
        };
        let ways = [("bend", across), ("twist", o.twist / self.strength(name, "twist", 0.0)), ("axial", o.axial / self.strength(name, "axial", 0.0))];
        let (way, ratio) = ways.iter().skip(1).fold(ways[0], |a, w| if w.1 > a.1 { *w } else { a });
        if ratio < 1.0 {
            // Miner's rule, roughly: a load at half the strength does a little harm, one near it a lot.
            if ratio > 0.5 {
                let d = self.b().damage.entry(name.to_string()).or_insert(0.0);
                *d = (*d + 0.25 * ratio.powi(4)).min(0.9);
            }
            return None;
        }
        let r#type: String = if b.long.is_some() && rest.end >= 0 {
            // (A long bone's spongy end crumples rather than snapping: a fracture there, or one in pieces.)
            if ratio < 2.0 { "simple" } else { "comminuted" }.into()
        } else if b.long.is_some() {
            match way {
                "twist" => "spiral",
                "axial" => "oblique",
                _ if ratio < 1.6 => if how == "fall" { "oblique" } else { "transverse" },
                _ if ratio < 3.0 => "butterfly",
                _ => "comminuted",
            }.into()
        } else if key == "skull" {
            if rest.base { "basilar" } else if ratio > 1.8 && area < 15.0 { "depressed" } else { "linear" }.into()
        } else if FACE_BONES.contains(&key.as_str()) {
            self.face(&key, &rest.place.clone(), ratio, area, &rest)
        } else if key == "jaw" {
            self.jaw(&rest)
        } else if key == "hyoid" || key == "larynx" {
            key.clone()
        } else if (key.contains("vertebra") || key.contains("sacrum")) && way == "axial" {
            if ratio < 1.5 { "compression" } else { "burst" }.into()
        } else if ratio > 2.2 {
            "comminuted".into()
        } else {
            "simple".into()
        };
        Some(self.r#break(name, &r#type, how, ratio, rest, 0.0, 1, false))
    }

    // Something of `mass` kg at `speed` m/s along `dir` into segment `seg` at `point` (world): `tool` says what it is or
    // how stiff it is; unsaid, a light fast thing is a bat and anything else a flat heavy thing. The first bone in its way
    // takes the force the flesh over it lets through; the chest is pushed in as a whole. A blow breaks at most the one
    // thing it lands on. Returns the force.
    pub fn impact(&mut self, seg: usize, point: Vec3, dir: Vec3, mass: f32, speed: f32, t: Option<Tool>) -> f32 {
        let name = self.0.person.segments[seg].name.clone();
        let base = name.strip_suffix('L').or_else(|| name.strip_suffix('R')).unwrap_or(&name).to_string();
        let what = match t {
            Some(Tool::Named(n)) => tool(n).unwrap_or(tool("flat").unwrap()),
            Some(Tool::Stiff(k)) => What { k, area: if k < 2e4 { 40.0 } else if k < 1e5 { 30.0 } else { 25.0 } },
            None => if mass < 1.2 && speed > 10.0 { tool("bat").unwrap() } else { tool("flat").unwrap() },
        };
        let behind = self.0.person.mass * struck(&base);
        let m = (mass * behind) / (mass + behind);
        if base == "chest" || base == "belly" {
            return self.chest(point, dir, what, mass, speed, "blow");
        }
        // A blow to the mouth meets the teeth first, through the lips (about 100 kN/m), over its own width.
        if name == "head" {
            let lips = speed * ((1.0 / (1.0 / 100e3 + 1.0 / what.k)) * m).sqrt();
            let open = self.mouth_open() > 8.0;
            self.0.teeth().blow(point, dir, lips, (what.area / std::f32::consts::PI).sqrt() / 100.0, open);
        }
        let Some((bone, at)) = self.struck(seg, point, dir) else { return 0.0 };
        let k = 1.0 / (1.0 / spec(&key_of(&bone)).unwrap().pad + 1.0 / what.k);
        let force = speed * (k * m).sqrt();
        if self.load(&bone, "blow", Load { force, area: Some(what.area), at: Some(at), dir: Some(dir), ..default() }).is_some() {
            return force;
        }
        // Struck with the mouth open, a jaw that holds is knocked out of its joints instead.
        let key = key_of(&bone);
        let half = force > 0.5 * self.strength(&bone, "bend", 0.0) * (what.area / 6.5).powf(0.3).clamp(0.6, 1.8);
        if key == "jaw" && self.mouth_open() > 12.0 && half {
            self.jaw_out();
        } else if (key == "finger" || key == "toe") && half && !self.0.hurt.bones.joints.contains_key(&bone) {
            // A finger or toe struck end on or across is put out of joint before its bone breaks.
            self.b().joints.insert(bone.clone(), "dislocated".into());
            let v = &mut *self.0.vitals;
            v.pain = (v.pain + 0.2).min(1.0);
            let short = bone.split_once(" phalanx of ").map_or(bone.as_str(), |(_, rest)| rest);
            v.injure(format!("{} dislocated, bent out of line", cap(short)), 2.0);
        } else {
            self.at_joint(point, dir, force);
        }
        force
    }

    // The chest pushed in by something of `mass` kg at `speed` along `dir`, landing on `tool`'s patch at `point`: how far
    // in, against how far this person's ribs go (a fifth of the chest's depth young, less with age: Kroell; Zhou's age
    // factors), says how many ribs break, whether a panel of them breaks loose, and whether the sternum goes.
    pub fn chest(&mut self, point: Vec3, dir: Vec3, what: What, mass: f32, speed: f32, how: &str) -> f32 {
        let behind = self.0.person.mass * 0.3;
        let m = (mass * behind) / (mass + behind);
        let k = 1.0 / (1.0 / CHEST_STIFF + 1.0 / what.k);
        let force = speed * (k * m).sqrt();
        let inward = force / CHEST_STIFF / CHEST_DEPTH;
        let onset = 0.2 * (1.0 - 0.011 * (self.0.hurt.bones.age - 30.0)).clamp(0.45, 1.0) * self.grain("ribs");
        let chest = self.0.segment_world(self.0.segment("chest").unwrap());
        // (The chest's ahead: its -Z, the TS's +Z.)
        let front = dir.dot(chest.rotation * Vec3::NEG_Z) < -0.5;
        self.commotio(point, dir, what, speed, &chest);
        // Not quite enough to break them, from the front: the ribs' cartilage is torn off the breastbone instead.
        if inward < onset {
            if front && inward > 0.75 * onset && !self.0.hurt.bones.joints.contains_key("sternum") {
                self.b().joints.insert("sternum".into(), "torn".into());
                let v = &mut *self.0.vitals;
                v.pain = (v.pain + 0.25).min(1.0);
                v.injure("Ribs torn from the breastbone: every breath hurts", 4.0);
            }
            return force;
        }
        let side = if self.0.left_of(point) { "left" } else { "right" };
        // As many ribs as it pushed in far enough, round the one it landed on, and no more than its width covers (a bat's
        // 6.5 cm, two or three). Past twice what breaks one, a run of three or more breaks in two places: a flail panel,
        // sucked in as the rest of the chest goes out (Kroell), with the lung bruised under it and torn by the ends.
        let ratio = inward / onset;
        let most = ((what.area.sqrt() / 1.5).round()).clamp(1.0, 10.0);
        let count = (1.0 + ((ratio - 1.0) * 4.0).floor()).clamp(1.0, most) as usize;
        let at = self.rib_at(side, point, dir);
        let from = (at as i64 - ((count as i64 - 1) / 2)).clamp(1, 13 - count as i64) as usize;
        let flail = ratio >= 2.0 && count >= 3;
        for n in from..from + count {
            let rest = self.rest(&rib_name(side, n), Some(point), Some(dir), -1);
            self.r#break(&rib_name(side, n), if flail { "flail" } else { "simple" }, how, ratio, rest, 0.0, 1, true);
        }
        let s = if side == "left" { Side::L } else { Side::R };
        let v = &mut *self.0.vitals;
        v.injure(
            if count > 1 {
                format!("{} ribs {from} to {} broken{}", cap(side), from + count - 1, if flail { ", each in two places: flail chest" } else { "" })
            } else {
                format!("{} {} rib broken", cap(side), NUMBER[from - 1])
            },
            if flail { 7.0 } else { 5.0 },
        );
        if flail {
            v.lungs.set(s, (v.lungs.get(s) - 0.3).max(0.05));
        }
        if ratio > 1.8 {
            v.lungs.leak(s);
            v.injure(format!("Broken ribs tore the {side} lung"), 7.0);
            self.0.hurt_part(&format!("{side} lung"));
        }
        if front && ratio > 1.5 {
            let rest = self.rest("sternum", Some(point), Some(dir), -1);
            self.r#break("sternum", "simple", how, ratio, rest, 0.0, 1, false);
        }
        force
    }

    // The number of the rib a blow at `point` along `dir` lands on, on `side`: the first in its way, or the nearest.
    fn rib_at(&mut self, side: &str, point: Vec3, dir: Vec3) -> usize {
        let own = |p: &crate::anatomy::TracedPart| p.name.starts_with(side) && p.name.ends_with(" rib");
        let (spans, _) = self.0.trace(point - dir * 0.15, dir, 0.35, 0.0, Some(&own));
        let tr = self.0.traced.clone();
        if let Some(first) = spans.first() {
            return level_of(&tr.parts[first.part].name).parse().unwrap();
        }
        let (mut best, mut near) = (6, f32::INFINITY);
        for p in tr.parts.iter().filter(|p| own(p)) {
            let d = self.0.rest_to_world(p.owner).transform_point3(tr.source[p.source].centre()).distance(point);
            if d < near {
                near = d;
                best = level_of(&p.name).parse().unwrap();
            }
        }
        best
    }

    // A hard, fast blow over the heart landing in the fifteen to thirty milliseconds before the T wave's peak sends a
    // normal heart into fibrillation (commotio cordis; Link 1998: 9 of 10 such hits): a thousandth or two of the cycle.
    fn commotio(&mut self, point: Vec3, dir: Vec3, what: What, speed: f32, chest: &Transform) {
        let left = self.0.left_of(point);
        let v = &mut *self.0.vitals;
        if speed < 8.0 || what.k < 1e5 || !v.beating() || !left || dir.dot(chest.rotation * Vec3::NEG_Z) > -0.5 {
            return;
        }
        let window = 0.015 * (v.hr / 60.0);
        if v.beat > 0.33 - window && v.beat < 0.33 {
            v.arrest(Rhythm::Fibrillating);
            v.injure("Struck over the heart between beats: the heart is fibrillating", 10.0);
        }
    }

    // A bullet into bone part `p` (of the traced insides) at `at` (world) along `dir`, with `energy` J left, `calibre` m
    // across, its path running `through` m inside the bone. How many pieces of bone it drives on.
    pub fn shot(&mut self, p: usize, at: Vec3, dir: Vec3, energy: f32, calibre: f32, through: f32) -> u32 {
        let name = self.0.traced.parts[p].name.clone();
        let key = key_of(&name);
        let Some(b) = spec(&key) else { return 0 };
        let density = energy / (std::f32::consts::PI * (calibre * 500.0).powi(2));
        if density < PERFORATE * self.0.hurt.bones.cortical {
            let d = self.b().damage.entry(name.clone()).or_insert(0.0);
            *d = (*d + 0.3).min(0.9);
            self.0.vitals.injure(format!("Bullet chipped the {name}"), 3.0);
            return 0;
        }
        let rest = self.rest(&name, Some(at), Some(dir), -1);
        let r#type = if b.long.is_some() && through < b.wide.unwrap_or(0.02) * 0.35 {
            "gutter"
        } else if b.long.is_some() && rest.end >= 0 {
            if energy < 1000.0 { "drill hole" } else { "comminuted" }
        } else if b.long.is_some() {
            if energy < 400.0 { "butterfly" } else { "comminuted" }
        } else if energy < 400.0 && key != "skull" {
            "simple"
        } else {
            "comminuted"
        };
        self.r#break(&name, r#type, "shot", density / PERFORATE, rest, calibre, 1, false);
        match r#type {
            "comminuted" => if energy > 1500.0 { 6 } else { 3 },
            "butterfly" => 1,
            _ => 0,
        }
    }

    // --- where on a bone ---------------------------------------------------------------------------------------------

    // A long bone's line in rest space: from its first joint `a`, along unit `u`, `length` long; and the bones that carry
    // its near and far halves.
    fn axis(&self, name: &str) -> (Vec3, Vec3, f32, usize, usize) {
        long_axis(self.0.body(), name)
    }

    // Where on bone `name` a world point `at` (and a direction `dir`) is, in the person's rest space; for a long bone also
    // how far along it (0 to 1), and which end it is near (-1 for the shaft); for the skull whether it is its base. With no
    // point, the middle of the bone (or of its end `end`).
    pub fn rest(&self, name: &str, at: Option<Vec3>, dir: Option<Vec3>, end: i32) -> Rest {
        let npc = &*self.0;
        let b = spec(&key_of(name)).unwrap();
        let tr = npc.traced.clone();
        let entries: Vec<&crate::anatomy::TracedPart> = tr.parts.iter().filter(|p| p.name == name).collect();
        let to_rest = |owner: usize| npc.rest_to_world(owner).inverse();
        // (A part carried by more than one bone, the skull with its base on the neck, is read in the frame of the bone that
        // carries most of it.)
        let size = |e: &crate::anatomy::TracedPart| e.clusters.iter().map(|c| c.tris.len()).sum::<usize>();
        let mut owner = entries.iter().skip(1).fold(entries[0], |a, e| if size(e) > size(a) { e } else { a }).owner;
        if b.long.is_some() {
            let (a, u, length, near, far) = self.axis(name);
            let mut s: f32 = match end {
                0 => 0.08,
                1 => 0.92,
                _ => 0.5,
            };
            let mut p = None;
            if let (Some(at), true) = (at, end < 0) {
                // Read in the near half's frame, and if that puts it past the middle, in the far half's: once the bone has
                // broken the two frames no longer agree.
                let along = |half: usize, p: &mut Option<Vec3>| {
                    let q = to_rest(half).transform_point3(at);
                    *p = Some(q);
                    (q - a).dot(u) / length
                };
                s = along(near, &mut p);
                if s > 0.5 {
                    s = along(far, &mut p).max(0.5);
                }
                s = s.clamp(0.02, 0.98);
            }
            let p = p.unwrap_or(a + u * (s * length));
            owner = if s <= 0.5 { near } else { far };
            // (Ahead at rest is -Z here, the TS's +Z.)
            let d = dir.map_or_else(|| across(u, Vec3::NEG_Z), |d| to_rest(owner).transform_vector3(d).normalize());
            let e = if end >= 0 { end } else if s < 0.2 { 0 } else if s > 0.8 { 1 } else { -1 };
            return Rest { p, d, owner, s, end: e, base: false, place: String::new() };
        }
        let centre = tr.source[entries[0].source].centre();
        let p = at.map_or(centre, |at| to_rest(owner).transform_point3(at));
        let d = dir.map_or(Vec3::NEG_Y, |d| to_rest(owner).transform_vector3(d).normalize());
        let place = if key_of(name) == "jaw" { self.jaw_place(p) } else { self.place(name, p) };
        // The skull's base: its floor (sphenoid), or the back of it below the eyes, where a fall on the back of the head
        // lands.
        let base = place == "base" || (place == "back" && p.y < npc.body().bone("eye.L").head.y - 0.03);
        Rest { p, d, owner, s: 0.5, end: -1, base, place: place.to_string() }
    }

    // Which place on the head a point of bone `name` (rest space) is: round an eye (the person's own eye bones) it is the
    // eye socket, whatever bone it is; otherwise the vault's bones are its forehead, temples, sides, back and floor.
    fn place(&self, name: &str, p: Vec3) -> &'static str {
        if !["maxilla", "zygomatic", "frontal", "nasal", "lacrimal", "ethmoid"].iter().any(|w| name.contains(w)) {
            return vault(name);
        }
        let body = self.0.body();
        // (In front of the eye's middle: the TS's +z, our -z.)
        let eyes = ["eye.L", "eye.R"].map(|e| body.bone(e).head);
        if eyes.iter().any(|e| (p.x - e.x).abs() < 0.02 && (p.y - e.y).abs() < 0.022 && p.z < e.z + 0.035) {
            return "eye";
        }
        vault(name)
    }

    // Which part of the jaw: its chin, its body along the teeth, its angle below the ear, or its condyle in the joint.
    fn jaw_place(&self, p: Vec3) -> &'static str {
        let joint = self.0.body().bone("jaw").head;
        if p.distance(joint) < 0.03 || p.y > joint.y - 0.015 {
            return "condyle";
        }
        if p.x.abs() < 0.018 {
            return "chin";
        }
        // (Behind the joint's 3 cm ahead: the TS's p.z < joint.z + 0.03, mirrored.)
        if -p.z < -joint.z + 0.03 { "angle" } else { "body" }
    }

    // A break of a bone of the face (`key`) from a blow at `place` on it: the nose; an eye socket's floor blown out by
    // something broad pressing the eye in; the cheekbone; or the upper jaw broken off at one of Le Fort's three levels, by
    // how high and how hard.
    fn face(&self, key: &str, place: &str, ratio: f32, area: f32, rest: &Rest) -> String {
        if place == "eye" && area >= 20.0 {
            return "blowout".into();
        }
        if key == "nasal" {
            return "nasal".into();
        }
        if key == "zygoma" {
            return "zygoma".into();
        }
        // Struck low, at the mouth, it goes above the teeth (I); across the nose, through it (II); and only a very heavy
        // blow high on the face takes the whole of it off the skull (III).
        let low = rest.p.y < self.0.body().bone("eye.L").head.y - 0.045;
        if low { if ratio > 3.0 { "lefort2" } else { "lefort1" } } else if ratio > 3.0 { "lefort3" } else { "lefort2" }.into()
    }

    // How the jaw breaks where it was struck: at the chin the force goes up both sides to the condyles, which break.
    fn jaw(&mut self, rest: &Rest) -> String {
        if rest.place == "chin" && self.0.dice.next() < 0.5 { "condyles".into() } else { rest.place.clone() }
    }

    // The first bone in a blow's way into segment `seg` at `point` along `dir`, or the bone under that segment.
    fn struck(&mut self, seg: usize, point: Vec3, dir: Vec3) -> Option<(String, Vec3)> {
        let name = self.0.person.segments[seg].name.clone();
        // A blow to the head reaches the skull and jaw and no further (not the neck behind them); a blow anywhere reaches
        // the bones under that skin, never the spine at the back of the trunk.
        let head = name == "head";
        let reach = |p: &crate::anatomy::TracedPart| {
            let bony = p.kind == "bone" || p.kind == "skull" || p.kind == "cartilage";
            let of_head = p.kind == "skull"
                || ["maxilla", "zygomatic", "nasal", "lacrimal", "palatine", "vomer", "mandible", "hyoid", "cartilage"].iter().any(|w| p.name.contains(w));
            let spine = p.name.contains("vertebra") || p.name == "atlas" || p.name == "axis" || p.name.contains("sacrum");
            bony && !spine && (if head { of_head } else { !of_head })
        };
        let from = point - dir * 0.15;
        let (spans, _) = self.0.trace(from, dir, if head { 0.3 } else { 0.4 }, 0.0, Some(&reach));
        if let Some(first) = spans.first() {
            return Some((self.0.traced.parts[first.part].name.clone(), from + dir * first.enter));
        }
        let under = under(crate::wounds::base_of(&name))?;
        let side = if name.ends_with('L') {
            "left "
        } else if name.ends_with('R') {
            "right "
        } else if under.contains("hip") {
            if self.0.left_of(point) { "left " } else { "right " }
        } else {
            ""
        };
        Some((format!("{side}{under}"), point))
    }

    // --- a break -----------------------------------------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub fn r#break(&mut self, name: &str, r#type: &str, how: &str, ratio: f32, rest: Rest, calibre: f32, count: u32, quiet: bool) -> usize {
        let key = key_of(name);
        let b = spec(&key).unwrap();
        let side = side_of(name);
        let mut br = Break {
            part: name.into(), key: key.clone(), side, r#type: r#type.into(), how: how.into(), ratio, r#where: String::new(), end: rest.end, s: rest.s,
            hit: rest.s, at: rest.p, dir: rest.d, owner: rest.owner, open: how == "shot", seg: None, count, level: String::new(), text: String::new(),
            place: String::new(), through: false, wound: None, out: None,
        };
        if b.long.is_some() {
            br.r#where = if rest.end < 0 { "shaft".into() } else { ends(&key)[rest.end as usize].0.into() };
        }
        // A shaft that lets go parts at the ragdoll's mid joint, the only place the limb and its skin can bend: drawn far
        // from it, the bone would part in one place and the leg bend in another, and the bone's end would stand out of the
        // leg. So it parts within a few centimetres of the middle; a bullet's pieces stay where the bullet went.
        if br.r#where == "shaft" && unstable(r#type) {
            br.s = br.s.clamp(0.45, 0.55);
        }
        // A second break of a bone already broken there makes the first worse, not a new one.
        let same = self.0.hurt.bones.breaks.iter().position(|o| {
            o.part == name && o.r#where == br.r#where && if b.long.is_some() { (o.s - br.s).abs() < 0.15 } else { o.r#type == r#type && o.at.distance(br.at) < 0.04 }
        });
        if let Some(k) = same {
            if b.long.is_some() {
                let o = &self.0.hurt.bones.breaks[k];
                if unstable(r#type) && give(r#type).unwrap()[0] > give(&o.r#type).map_or(0.0, |g| g[0]) && o.seg.is_some() {
                    self.b().breaks[k].r#type = r#type.into();
                    self.loosen(k);
                }
            }
            return k;
        }
        if key.contains("rib") || key.contains("vertebra") {
            br.level = level_of(name);
        }
        br.place = rest.place.clone();
        self.b().breaks.push(br);
        let k = self.0.hurt.bones.breaks.len() - 1;
        self.0.hurt_part(name);
        self.body(k);
        // (`_draw`: the break drawn in the x-ray, its pieces moved, its line dark on it: shards.rs.)
        self.0.hurt.happened.push(Happened::Drawn { break_index: k, calibre });
        self.partner(k);
        let text = self.words(k);
        self.b().breaks[k].text = text.clone();
        if !quiet {
            let grave = ["femur", "hip", "vertebra", "skull", "sacrum", "larynx"].iter().any(|w| key.contains(w));
            self.0.vitals.injure(&text, if grave { 7.0 } else { 5.0 });
        }
        let (at, owner) = (self.0.hurt.bones.breaks[k].at, self.0.hurt.bones.breaks[k].owner);
        let world = self.0.rest_to_world(owner).transform_point3(at);
        self.0.crack(world, (0.5 + b.bend / 8000.0).clamp(0.5, 1.0));
        k
    }

    // A shaft driven far out of line takes the bone beside it with it: a displaced tibia breaks the fibula at about the
    // same level, a forearm hit hard enough breaks both its bones.
    fn partner(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        let Some(partner) = partner(&br.key) else { return };
        if br.r#where != "shaft" || !unstable(&br.r#type) || br.how == "shot" {
            return;
        }
        if if br.key == "tibia" { br.ratio < 1.3 && br.r#type == "transverse" } else { br.ratio < 2.0 } {
            return;
        }
        let name = format!("{} {partner}", word_of(br.side));
        if self.0.hurt.bones.broken(&name, "shaft") {
            return;
        }
        let mut rest = self.rest(&name, None, None, -1);
        rest.s = br.s;
        let (a, u, length, _, _) = self.axis(&name);
        rest.p = a + u * (br.s * length);
        self.r#break(&name, if br.r#type == "comminuted" { "comminuted" } else { "transverse" }, &br.how, br.ratio, rest, 0.0, 1, false);
    }

    fn words(&self, k: usize) -> String {
        let br = &self.0.hurt.bones.breaks[k];
        let named = cap(&br.part);
        let side = if br.at.x < 0.0 { "left" } else { "right" };
        if let Some(w) = face_words(&br.r#type) {
            return w.replacen("$side", side, 1).replacen("$Side", &cap(side), 1);
        }
        if br.key == "rib" {
            return format!("{named} broken{}", if br.r#type == "flail" { " in two places" } else { "" });
        }
        if !br.level.is_empty() {
            return format!("{named} ({}): {}", br.level, words(&br.r#type).unwrap_or("fracture"));
        }
        let r#where = if br.r#where.is_empty() { String::new() } else { format!(" of the {}", br.r#where) };
        format!("{named}: {}{}{}", words(&br.r#type).unwrap_or("fracture"), r#where, if br.open { ", open" } else { "" })
    }

    // --- what a break does to the body ---------------------------------------------------------------------------------

    fn body(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        let b = spec(&br.key).unwrap();
        let side = br.side;
        let l = letter(side);
        {
            let v = &mut *self.0.vitals;
            v.pain = (v.pain + b.pain).min(1.0);
            let litres = b.blood * br.count as f32 * if br.r#type == "comminuted" { 1.4 } else { 1.0 } * if br.key == "hip bone" && br.ratio > 1.6 { 1.6 } else { 1.0 };
            if litres > 0.02 {
                v.bleed(Bleed::new(format!("{} fracture", br.part), litres * CLOT).internal(true).clots(CLOT));
            }
        }
        if let Some(long) = b.long {
            let stable = br.r#type == "gutter" || br.r#type == "drill hole";
            if (br.key == "femur" || br.key == "tibia") && br.r#type != "gutter" {
                self.0.hurt.leg_gone = true;
            }
            if br.r#where == "shaft" && unstable(&br.r#type) {
                // The fibula carries a sixth of the weight and goes where the tibia lets the shin go: alone it lets nothing
                // bend.
                if br.key == "fibula" {
                    if self.0.hurt.bones.broken(&format!("{} tibia", word_of(side)), "shaft") {
                        self.b().breaks[k].seg = Some(format!("shin2{l}"));
                    }
                    return;
                }
                let name = format!("{}2{l}", long[2]);
                // (The ragdoll's breakAt: the two halves' lock let go, once.)
                if self.b().mids.insert(name.clone()) {
                    self.0.broke(&format!("{}{l}", long[2]));
                }
                self.b().breaks[k].seg = Some(name);
                self.loosen(k);
            } else if br.end >= 0 && !stable {
                if let Some(joint) = ends(&br.key)[br.end as usize].1 {
                    let joint = format!("{joint}{l}");
                    self.0.joint(&joint, Joint::Widen { axes: vec![0, 1, 2], by: 0.35 });
                    // A broken hip: the leg lies short and turned out, and nothing will lift it.
                    if br.key == "femur" && br.end == 0 {
                        self.0.joint(&joint, Joint::Widen { axes: vec![1], by: 0.9 });
                        self.0.joint(&joint, Joint::Limp);
                    }
                    if br.key == "humerus" && br.end == 0 {
                        self.0.joint(&joint, Joint::Limp);
                    }
                }
            }
            return;
        }
        let v = &mut *self.0.vitals;
        match br.key.as_str() {
            "rib" => {
                // Every breath hurts and is held short. (A run of them, a flail panel and a torn lung are `chest`'s.)
                let s = side.unwrap_or(Side::R);
                v.lungs.set(s, (v.lungs.get(s) - 0.03).max(0.05));
                if br.how == "shot" {
                    v.lungs.leak(s);
                    self.0.hurt_part(&format!("{} lung", word_of(Some(s))));
                }
            }
            "sternum" => {
                if br.ratio > 2.0 {
                    v.pump = (v.pump - 0.12).max(0.0);
                    v.injure("Heart bruised against the spine", 6.0);
                }
            }
            "clavicle" => {
                // The strut that holds the shoulder out is gone: the shoulder drops forward and down, and the arm hangs.
                v.injure(format!("The {} shoulder drops forward and down", word_of(side)), 3.0);
                self.0.joint(&format!("upperarm{l}"), Joint::Limp);
            }
            "scapula" => {}
            "skull" | "maxilla" | "zygoma" | "nasal" => self.skull(k),
            "hyoid" | "larynx" => {
                // The voice box crushed swells shut over the next minutes; the hyoid less so.
                v.airway = (v.airway - if br.key == "larynx" { 0.45 } else { 0.2 }).max(0.1);
                v.bleed(Bleed::new(&br.part, 0.0003).internal(true).clots(0.01).into(Into::Airway));
            }
            "jaw" => self.jaw_broken(k),
            "hip bone" | "sacrum" => {
                if br.key == "hip bone" || br.ratio > 1.3 {
                    self.0.hurt.leg_gone = true;
                }
            }
            "kneecap" => {
                // Nothing straightens the knee once its cap is in two.
                self.0.joint(&format!("shin{l}"), Joint::Limp);
                self.0.hurt.leg_gone = true;
            }
            // A broken heel or talus takes no weight, whatever broke it (a shot through it as much as a fall on it).
            "calcaneus" | "tarsal" => self.0.hurt.leg_gone = true,
            k2 if k2.contains("vertebra") => self.spine(k),
            _ => {}
        }
    }

    // A broken shaft's two halves, held as the kind of break holds them.
    fn loosen(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        let Some(seg) = br.seg else { return };
        // One forearm bone broken alone is splinted by the other.
        let partner = match br.key.as_str() {
            "radius" => Some("ulna"),
            "ulna" => Some("radius"),
            _ => None,
        };
        let share = if partner.is_some_and(|p| !self.0.hurt.bones.broken(&format!("{} {p}", word_of(br.side)), "shaft")) { 0.3 } else { 1.0 };
        let g = give(&br.r#type).unwrap_or(give("transverse").unwrap());
        self.0.joint(&seg, Joint::Range { lo: g.map(|x| -x * share), hi: g.map(|x| x * share) });
        self.0.joint(&seg, Joint::Shorten(shorten(&br.r#type) * share));
    }

    fn skull(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        if br.how == "shot" {
            return; // the bullet's path through the brain is wounds.rs's
        }
        if face_words(&br.r#type).is_some() {
            return self.face_broken(k);
        }
        let c = (self.0.vitals.concussion() + 0.3 + 0.2 * br.ratio).min(1.0);
        self.0.vitals.concuss(c, self.0.dice);
        let v = &mut *self.0.vitals;
        // Over the temple the bone is thinnest and the middle meningeal artery runs in a groove on its inside: a break there
        // tears it, and the blood collects between bone and brain, a lucid interval, then the brain is pressed.
        if br.place == "temple" && self.0.hurt.bones.epidural.is_none() {
            let e = v.bleed(Bleed::new("middle meningeal artery", 0.0004).arterial(true).internal(true).clots(0.0015));
            self.0.hurt.bones.epidural = Some(e);
            v.injure("Artery torn under the temple: bleeding inside the skull", 8.0);
        }
        if br.r#type == "depressed" {
            v.brain_damage += 0.02 + 0.015 * br.ratio;
            v.bleed(Bleed::new("brain", 0.0006).internal(true).clots(0.004));
            self.0.hurt_part("brain");
        }
        if br.r#type == "basilar" {
            let v = &mut *self.0.vitals;
            v.injure("Blood and clear fluid from the ears and nose", 6.0);
            if br.ratio > 2.5 {
                v.brain_damage += 0.3;
                self.0.hurt_part("brainstem");
            }
        }
    }

    // A face broken: a nose bleeds from the nostrils, the upper jaw's breaks bleed into the mouth and nose, and the higher
    // Le Fort breaks let the middle of the face fall back onto the airway and leak brain fluid from the nose.
    fn face_broken(&mut self, k: usize) {
        let t = self.0.hurt.bones.breaks[k].r#type.clone();
        let c = (self.0.vitals.concussion() + 0.1 + if t == "lefort3" { 0.4 } else { 0.0 }).min(1.0);
        self.0.vitals.concuss(c, self.0.dice);
        if t == "nasal" || t == "lefort2" || t == "lefort3" {
            let mark = self.skin_over(k);
            self.0.vitals.bleed(Bleed::new("nose", if t == "nasal" { 0.0004 } else { 0.0012 }).clots(0.006).mark(mark).into(Into::Nose));
        }
        if t.starts_with("lefort") {
            self.0.teeth().loosen(true);
        }
        let v = &mut *self.0.vitals;
        if t == "lefort1" || t == "lefort2" {
            v.bleed(Bleed::new("mouth", 0.0006).clots(0.006).internal(true).into(Into::Mouth));
        }
        if t == "lefort2" {
            v.airway = (v.airway - 0.15).max(0.2);
        }
        if t == "lefort3" {
            v.airway = (v.airway - 0.35).max(0.2);
            v.injure("Clear fluid running from the nose", 6.0);
        }
    }

    // A jaw broken: it hangs a little and will not close true; broken on both sides (or at both joints) it hangs further
    // and the tongue, with nothing in front to hold it, falls back onto the airway. A break along the teeth is open into
    // the mouth and bleeds there.
    fn jaw_broken(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        let both = br.r#type == "condyles" || br.ratio > 2.2;
        self.b().jaw_hangs = self.0.hurt.bones.jaw_hangs.max(if both { 18.0 } else { 10.0 });
        if both {
            let v = &mut *self.0.vitals;
            v.airway = (v.airway - 0.2).max(0.2);
            v.injure("The broken jaw lets the tongue fall back", 6.0);
        }
        if br.r#type == "body" || br.r#type == "chin" {
            self.0.teeth().loosen(false);
            self.0.vitals.bleed(Bleed::new("mouth", 0.0004).clots(0.008).internal(true).into(Into::Mouth));
        }
    }

    // A jaw knocked out of its joints with the mouth open: it locks open and cannot be closed.
    fn jaw_out(&mut self) {
        if self.0.hurt.bones.joints.contains_key("jaw") {
            return;
        }
        self.b().joints.insert("jaw".into(), "dislocated".into());
        self.b().jaw_hangs = self.0.hurt.bones.jaw_hangs.max(28.0);
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + 0.3).min(1.0);
        v.injure("Jaw dislocated: locked open", 5.0);
    }

    // How far the mouth is open now, degrees: the jaw bone's turn from where it rests (at rest, none: the bones' rest
    // frames are the body's).
    pub fn mouth_open(&self) -> f32 {
        let jaw = self.0.bone_index("jaw");
        let q = self.0.person.posed.local[jaw];
        2.0 * q.w.abs().min(1.0).acos() / RAD
    }

    // The skin over break `k` (a crossing, as surface() gives): where blood from it comes out.
    fn skin_over(&mut self, k: usize) -> Option<Crossing> {
        let br = &self.0.hurt.bones.breaks[k];
        let m = self.0.rest_to_world(br.owner);
        let at = m.transform_point3(br.at);
        let out = -m.transform_vector3(br.dir).normalize();
        self.0.surface(at + out * 0.08, -out, 0.12, false).into_iter().find(|h| h.kind == Kind::Skin)
    }

    fn spine(&mut self, k: usize) {
        let br = self.0.hurt.bones.breaks[k].clone();
        let joint = match br.key.as_str() {
            "cervical vertebra" => "head",
            "lumbar vertebra" => "belly",
            _ => "chest",
        };
        if br.r#type == "burst" || br.r#type == "comminuted" || br.ratio > 1.8 {
            self.0.joint(joint, Joint::Widen { axes: vec![0, 2], by: 0.3 });
        }
        // A burst vertebra drives bone back into the canal: past half again what crushes it, into the cord.
        if (br.r#type == "burst" && br.ratio > 1.3) || br.r#type == "comminuted" {
            self.cord(&br.level, "crushed");
        }
    }

    // The level ('C6') of the vertebra nearest `point`: where a bullet cut the cord, say.
    pub fn level_at(&self, point: Vec3) -> String {
        let tr = self.0.traced.clone();
        let (mut best, mut near) = ("T1".to_string(), f32::INFINITY);
        for p in &tr.parts {
            if !(p.name.ends_with("vertebra") || p.name == "atlas" || p.name == "axis") {
                continue;
            }
            let d = self.0.rest_to_world(p.owner).transform_point3(tr.source[p.source].centre()).distance(point);
            if d < near {
                near = d;
                best = level_of(&p.name);
            }
        }
        best
    }

    // The spinal cord crushed (or `how` else) at `level` ('C4', 'T9'...): nothing below it moves, and from the fourth neck
    // vertebra up the diaphragm stops (its nerve leaves at C3 to C5).
    pub fn cord(&mut self, level: &str, how: &str) {
        let v = &mut *self.0.vitals;
        let n: u32 = level[1..].parse().unwrap_or(0);
        let neck = level.starts_with('C');
        v.paralysed_legs = true;
        if neck {
            v.paralysed_arms = true;
            if n <= 4 {
                v.breathing = false;
            }
        }
        v.injure(
            if neck && n <= 4 { format!("Spinal cord {how} at {level}: cannot breathe") } else { format!("Spinal cord {how} at {level}: paralysed below it") },
            10.0,
        );
    }

    // --- every physics step ------------------------------------------------------------------------------------------

    // What bones.ts did after each physics step that does not need the ragdoll's speeds: the blood collecting over the
    // brain from a torn meningeal artery presses on it.
    pub fn update(&mut self) {
        if self.0.hurt.age < 1.5 {
            return; // the first second and a half is the body settling into its stance
        }
        if let Some(e) = self.0.hurt.bones.epidural {
            let lost = self.0.vitals.bleeds[e].lost;
            if lost > 0.03 {
                let v = &mut *self.0.vitals;
                v.brain_damage = v.brain_damage.max((lost - 0.03) * 2.0);
            }
        }
    }

    // A segment that was coming down and has just been stopped by the floor: what it landed on takes the force. What the
    // body lowers under its own control is not a fall (a foot set down in a step, a knee bent to sit): while a part's
    // muscles are working on it they take the first 3 m/s of its landing, and only what is left over counts. The hip, a
    // hand put out and the feet are counted whole, with their own tests.
    // port: needs body. The ragdoll calls this after each step for each segment (the TS's `_falls`): `was` and `now` its
    // downward speed before and after the step (m/s, negative down), `low` how high its lowest point is and `under` the
    // floor's height under it, `held` whether its muscles are working on it; `pelvis_vy`, `chest_vy` those segments' speed
    // now, `pelvis_y` how high the pelvis is.
    #[allow(clippy::too_many_arguments)]
    pub fn fell(&mut self, seg: usize, was: f32, now: f32, low: f32, under: f32, held: bool, pelvis_vy: f32, chest_vy: f32, pelvis_y: f32) {
        // (Stopped: it lost most of the speed it had downward, in one step, at the floor; on whatever is under it.)
        if self.0.hurt.age < 1.5 || was > -2.5 || now < was * 0.4 || low > under + 0.06 {
            return;
        }
        self.land(seg, now - was, held, low, pelvis_vy, chest_vy, pelvis_y);
    }

    // Segment `seg` stopped by the floor, its speed changed by `dv` m/s.
    #[allow(clippy::too_many_arguments)]
    fn land(&mut self, seg: usize, mut dv: f32, held: bool, low: f32, pelvis_vy: f32, chest_vy: f32, pelvis_y: f32) {
        let name = self.0.person.segments[seg].name.clone();
        let base = name.strip_suffix('L').or_else(|| name.strip_suffix('R')).unwrap_or(&name).to_string();
        let side = if name.ends_with('L') { Some(Side::L) } else { Some(Side::R) };
        let word = word_of(side);
        let Some(share) = landing(&base) else { return };
        if held && base != "pelvis" && base != "hand" && base != "foot" {
            dv -= 3.0;
        }
        if dv < 0.5 {
            return;
        }
        let m = self.0.person.mass * share;
        let node = self.0.segment_world(seg);
        let mut at = node.transform_point(self.0.person.segments[seg].centre);
        at.y = low;
        let down = Vec3::NEG_Y;
        // Which side is down, for a body landing on its side: its right is pointing up or down.
        let on_side = |t: &Transform| {
            let r = t.rotation * Vec3::X;
            (r.y.abs() > 0.55).then(|| if r.y > 0.0 { "left" } else { "right" })
        };
        match base.as_str() {
            "head" => self.head_down(seg, dv, at, pelvis_y, chest_vy),
            "pelvis" => {
                // On the side, the greater trochanter takes it and the femur's neck behind it is what breaks in the old. Sat
                // down hard, the buttocks give (about 30 kN/m) and half of what is left goes up the spine: the old crush a
                // lumbar vertebra.
                if let Some(low) = on_side(&node) {
                    self.load(&format!("{low} femur"), "fall", Load { force: dv * (71e3 * m).sqrt(), at: Some(at), dir: Some(down), end: Some(0), ..default() });
                } else if dv > 3.5 {
                    self.load("first lumbar vertebra", "fall", Load { axial: 0.5 * dv * (30e3 * m).sqrt(), ..default() });
                }
            }
            "chest" => {
                if on_side(&node).is_some() {
                    self.chest(at, down, What { k: 5e6, area: 300.0 }, m, dv, "fall");
                }
            }
            // A fall onto the outstretched hand: the end of the radius (Colles'), in the old. (A young man's radius holds,
            // and the scaphoid behind the thumb breaks instead.) (What it brings down is the body's speed, not the hand's: a
            // hand is light and flung faster than the fall.)
            "hand" => {
                if -pelvis_vy > dv * 0.5 {
                    let force = dv.min(-pelvis_vy) * (100e3 * m).sqrt();
                    let o = Load { force, at: Some(at), dir: Some(down), ..default() };
                    if self.load(&format!("{word} radius"), "fall", Load { end: Some(1), ..o }).is_none() {
                        self.load(&format!("{word} scaphoid"), "fall", o);
                    }
                }
            }
            "foot" => {
                // Feet first from a height, the hips over them: the knees and the heel pad take most of it (30 kN/m all
                // told), the heel bursts past about 7 kN, the shin's lower end past 16 kN, and from higher still what is left
                // goes up the spine and crushes a lumbar vertebra. A step or a jump off a chair is nothing like that.
                let upright = pelvis_y - node.translation.y > 0.6 && -pelvis_vy > dv * 0.5;
                if !upright || dv < 4.0 {
                    return;
                }
                let force = dv * (30e3 * m).sqrt();
                self.load(&format!("{word} calcaneus"), "fall", Load { axial: force, at: Some(at), dir: Some(down), ..default() });
                self.load(&format!("{word} tibia"), "fall", Load { axial: force, at: Some(at), dir: Some(down), end: Some(1), ..default() });
                if dv > 6.0 {
                    self.load("first lumbar vertebra", "fall", Load { axial: force * 0.5, ..default() });
                }
            }
            _ => {}
        }
    }

    // The head stopped by the floor, unprotected: whether the skull breaks is the speed it hit at against the speeds that
    // broke cadaver skulls dropped onto steel (Gurdjian: the forehead 4.6 m/s, the back 4.9, the side 5.6-5.8), scaled by
    // this skull's strength. Head first with the body coming down on top of it, the neck is crushed along its length as
    // well (a diver's burst fracture: the neck holds about 2.2 kN).
    fn head_down(&mut self, seg: usize, dv: f32, at: Vec3, pelvis_y: f32, chest_vy: f32) {
        // The bone it landed on: the first of the skull up from the floor where it touched.
        let up = Vec3::Y;
        let skull = |p: &crate::anatomy::TracedPart| p.kind == "skull";
        let (spans, _) = self.0.trace(at - up * 0.03, up, 0.2, 0.0, Some(&skull));
        let name = spans.first().map_or("occipital bone".to_string(), |s| self.0.traced.parts[s.part].name.clone());
        let rest = self.rest(&name, Some(at), Some(-up), -1);
        let speed = drop_speed(&rest.place);
        let strong = self.strength(&name, "bend", place_strength("side")) / place_strength("side");
        let ratio = (dv / speed).powi(2) / strong;
        if ratio >= 1.0 {
            let base = rest.base;
            self.r#break(&name, if base { "basilar" } else { "linear" }, "fall", ratio, rest, 0.0, 1, false);
        }
        let head_y = self.0.segment_world(seg).translation.y;
        if pelvis_y > head_y + 0.5 && -chest_vy > dv * 0.6 {
            let axial = dv * (100e3 * self.0.person.mass * 0.3).sqrt();
            // Short of bursting the vertebra, the neck buckles forward and its facets ride over each other and lock.
            let c5 = "fifth cervical vertebra";
            if self.load(c5, "fall", Load { axial, ..default() }).is_none() && axial > 0.6 * self.strength(c5, "axial", 0.0) {
                let both = axial > 0.8 * self.strength(c5, "axial", 0.0);
                self.facets(both);
            }
        }
    }

    // The facet joints between the fifth and sixth neck vertebrae dislocated: one side out locks the head turned and
    // stiff; both out lets the vertebra slide forward over the next, which bruises or cuts the cord.
    fn facets(&mut self, both: bool) {
        if self.0.hurt.bones.joints.contains_key("facets") {
            return;
        }
        self.b().joints.insert("facets".into(), if both { "dislocated" } else { "locked" }.into());
        self.0.vitals.pain = (self.0.vitals.pain + 0.4).min(1.0);
        if both {
            self.0.joint("head", Joint::Widen { axes: vec![0, 2], by: 0.3 });
            self.0.vitals.injure("Neck facets dislocated at C5-C6 on both sides: the vertebra slid forward", 8.0);
            self.cord("C5", "crushed");
        } else {
            // (Held where it is now, give or take 0.15 rad: the ragdoll knows where that is.)
            self.0.joint("head", Joint::Hold { by: 0.15 });
            self.0.vitals.injure("Neck facet locked out at C5-C6: the head held turned and stiff", 5.0);
        }
    }

    // A blow of `force` N along `dir` landing within a few centimetres of a joint: bent sideways, or straightened past its
    // range, the joint takes it.
    // port: needs body. The joint's hinge and its angles now are the ragdoll's: here the hinge is the segment table's
    // (across the body, or across the limb and the way the body faces) turned with the parent as posed, and the angles are
    // the pose's, which for a person standing as made is straight at every joint.
    fn at_joint(&mut self, point: Vec3, dir: Vec3, force: f32) {
        let segs = self.0.person.segments.clone();
        for (k, seg) in segs.iter().enumerate() {
            let base = seg.name.strip_suffix('L').or_else(|| seg.name.strip_suffix('R')).unwrap_or(&seg.name);
            if joint_of(base).is_none() || self.0.hurt.bones.joints.contains_key(&seg.name) || self.0.segment_world(k).translation.distance(point) > 0.08 {
                continue;
            }
            let (Some(j), Some(parent)) = (&seg.joint, seg.parent) else { continue };
            let along = seg.end.normalize_or(Vec3::NEG_Y);
            let rest_hinge = match j.hinge {
                crate::ragdoll::Hinge::X => Vec3::X,
                crate::ragdoll::Hinge::Elbow => along.cross(Vec3::NEG_Z).normalize_or(Vec3::X),
            };
            let hinge = self.0.segment_world(parent).rotation * rest_hinge;
            let angle = 0.0; // port: needs body (ragdoll.angles)
            let (lo, hi) = (j.bend.1 * RAD, j.bend.2 * RAD);
            // Pushed along the hinge's axis it bends sideways; across it, it only bends the wrong way if it is already
            // straight.
            if dir.dot(hinge).abs() > 0.6 {
                self.overload(k, 2, force * LEVER);
            } else if angle < lo + 0.17 || angle > hi - 0.17 {
                self.overload(k, 0, force * LEVER);
            }
            return;
        }
    }

    fn overload(&mut self, seg: usize, axis: usize, torque: f32) {
        let name = self.0.person.segments[seg].name.clone();
        let base = name.strip_suffix('L').or_else(|| name.strip_suffix('R')).unwrap_or(&name).to_string();
        let side = if name.ends_with('L') { Some(Side::L) } else if name.ends_with('R') { Some(Side::R) } else { None };
        let Some((jname, holds, gives)) = joint_of(&base) else { return };
        let word = if side.is_some() { word_of(side) } else { "" };
        let holds = holds * self.0.hurt.bones.cortical * self.0.hurt.bones.build;
        if torque < holds {
            return;
        }
        let joint = format!("{}{jname}", if side.is_some() { cap(word) + " " } else { String::new() });
        match gives {
            // (Struck, a shoulder or elbow is driven out only well past what holds it: they go out by leverage.)
            "dislocated" => {
                if torque > holds * 3.0 {
                    self.dislocate(seg, &format!("{joint} dislocated"));
                }
            }
            "facets" => {
                if torque > holds * 2.0 {
                    self.facets(torque > holds * 3.0);
                }
            }
            "wrist" => {
                // Bent back past its range, the wrist breaks the radius's end (the lever is the 3 cm to the carpus), or sprains.
                if self.load(&format!("{word} radius"), "wrench", Load { force: torque / 0.03, end: Some(1), ..default() }).is_none() {
                    self.tear(seg, axis, &joint, 0.3);
                }
            }
            _ => {
                // A knee forced well past its range comes apart altogether, and takes the artery behind it.
                if base == "shin" && torque > holds * 2.5 {
                    self.dislocate(seg, &format!("{joint} dislocated"));
                    let tube_name = format!("{word} popliteal artery");
                    let tube = self.0.traced.tubes.iter().position(|t| t.name == tube_name);
                    let mut b = Bleed::new(&tube_name, 0.006).arterial(true).internal(true).clots(0.004);
                    if let Some(t) = tube {
                        b = b.tube(t, 0);
                    }
                    self.0.vitals.bleed(b);
                    self.0.vitals.injure(format!("{} popliteal artery torn behind the knee", cap(word)), 8.0);
                    self.0.hurt.leg_gone = true;
                    return;
                }
                if base == "foot" && torque > holds * 1.8 {
                    self.load(&format!("{word} tibia"), "wrench", Load { force: 1e5, end: Some(1), ..default() });
                    self.load(&format!("{word} fibula"), "wrench", Load { force: 1e5, end: Some(1), ..default() });
                    return;
                }
                self.tear(seg, axis, &joint, 0.45);
                if base == "shin" {
                    self.0.hurt.leg_gone = true;
                }
            }
        }
    }

    // A joint's ligaments torn across axis `axis`: it opens up that way `by` radians further than it should.
    fn tear(&mut self, seg: usize, axis: usize, joint: &str, by: f32) {
        let name = self.0.person.segments[seg].name.clone();
        self.b().joints.insert(name.clone(), "torn".into());
        self.0.joint(&name, Joint::Widen { axes: vec![axis], by });
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + 0.35).min(1.0);
        v.injure(format!("{joint}: ligaments torn"), 5.0);
        let at = self.0.segment_world(seg).translation;
        self.0.crack(at, 0.5);
    }

    // A joint out of its socket: locked where it went, a little either way (the springy fixation a doctor feels), and
    // nothing the muscles can move. A shoulder out the front holds the arm a little out and turned out; an elbow out the
    // back holds the forearm bent at forty-five degrees.
    fn dislocate(&mut self, seg: usize, text: &str) {
        let name = self.0.person.segments[seg].name.clone();
        let base = name.strip_suffix('L').or_else(|| name.strip_suffix('R')).unwrap_or(&name).to_string();
        match out_pose(&base) {
            // (Degrees as the pose controls count them: the ragdoll turns them into its joint's own signs.)
            Some(pose) => self.0.joint(&name, Joint::Out { at: pose.map(|d| d * RAD), by: 0.12 }),
            None => self.0.joint(&name, Joint::Widen { axes: vec![0, 1, 2], by: 0.5 }),
        }
        self.0.joint(&name, Joint::Limp);
        self.b().joints.insert(name.clone(), "dislocated".into());
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + 0.5).min(1.0);
        if name.contains("thigh") || name.contains("shin") {
            self.0.hurt.leg_gone = true;
        }
        self.0.vitals.injure(text, 6.0);
        let at = self.0.segment_world(seg).translation;
        self.0.crack(at, 0.6);
    }

    // --- open fractures ----------------------------------------------------------------------------------------------

    // A broken shaft bent far enough at the break: the end of the near half comes out through the skin at the outside of
    // the bend, where the two halves make their point.
    // port: needs body. The ragdoll calls this after each step with `bend(segment)`: how far (degrees) the mid joint of
    // that segment is bent now, hinge and side together (the TS's hypot of its angles).
    pub fn opens(&mut self, bend: impl Fn(&str) -> f32) {
        if self.0.hurt.age < 1.5 {
            return;
        }
        for k in 0..self.0.hurt.bones.breaks.len() {
            let br = &self.0.hurt.bones.breaks[k];
            let Some(seg) = &br.seg else { continue };
            let Some(open) = spec(&br.key).unwrap().open else { continue };
            if br.through {
                continue;
            }
            // (A clean transverse break has to be pushed further out of line before an end gets through.)
            if bend(seg) > open * if br.r#type == "transverse" { 1.5 } else { 1.0 } {
                self.through(k);
            }
        }
    }

    fn through(&mut self, k: usize) {
        self.b().breaks[k].through = true;
        let br = self.0.hurt.bones.breaks[k].clone();
        let Some(seg) = self.0.segment(br.seg.as_deref().unwrap()) else { return };
        let Some(near) = self.0.person.segments[seg].parent else { return };
        let (a, u, length, near_bone, _) = self.axis(&br.part);
        let to_world = self.0.rest_to_world(near_bone);
        let end = a + u * (br.s * length);
        let bone = to_world.transform_point3(end);
        // The point of the bend: away from where the far half now points, square to the near half.
        let (nw, sw) = (self.0.segment_world(near), self.0.segment_world(seg));
        let near_along = nw.rotation * self.0.person.segments[near].end.normalize();
        let far_along = sw.rotation * self.0.person.segments[seg].end.normalize();
        // A tibia comes out through the inner front of the shin, where there is nothing over it but skin, whichever way the
        // leg bent. (The near half's ahead is its -Z, its right +X.)
        let inward = nw.rotation * Vec3::X * if br.side == Some(Side::R) { -0.5 } else { 0.5 };
        let point = if br.key == "tibia" { across(near_along, nw.rotation * Vec3::NEG_Z + inward) } else { across(near_along, -(far_along - near_along)) };
        let Some(first) = self.0.surface(bone, point, 0.25, false).into_iter().find(|h| h.kind == Kind::Skin) else { return };
        // The near half's last few centimetres, splinters and all, swung out about a point that far back up the bone, so
        // the end that broke stands four and a half centimetres out of the skin.
        let tip = to_world.inverse().transform_point3(first.point + point * 0.045);
        let piece = 0.055;
        let pivot = end - u * piece;
        let turn = Quat::from_rotation_arc(u, (tip - pivot).normalize());
        let shift = tip - (pivot + turn * (end - pivot));
        // The skin and clothes torn open where the end comes through them.
        let (from, to) = (to_world.transform_point3(pivot + shift), to_world.transform_point3(tip));
        let hits = self.0.surface(from, (to - from).normalize(), from.distance(to) + 0.03, false);
        let mut skin = hits.iter().find(|h| h.kind == Kind::Skin).cloned().unwrap_or(first);
        self.0.wound(&skin, Way::Out, 0.03);
        self.0.hurt.happened.push(Happened::Hole { hit: skin.clone(), size: 0.018, open: true, ring: false });
        if let Some(cloth) = hits.iter().find(|h| h.kind == Kind::Cloth && h.t > skin.t).cloned() {
            self.0.wound(&cloth, Way::Out, 0.04);
            skin.cloth = Some(Box::new(cloth));
        }
        // (The end's bone taken out of the x-ray and drawn moved by `turn` about `pivot`, then `shift`: shards.rs.)
        self.0.hurt.happened.push(Happened::Through { break_index: k, pivot, turn, shift, piece });
        let b = self.b();
        b.breaks[k].wound = Some(skin.clone());
        b.breaks[k].out = Some(point);
        b.breaks[k].open = true;
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + 0.3).min(1.0);
        v.bleed(Bleed::new(format!("{} open fracture", br.part), 0.0025).clots(0.004).mark(Some(skin)));
        v.injure(format!("{}: bone out through the skin", cap(&br.part)), 7.0);
        self.0.crack(bone, 0.7);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_levels() {
        assert_eq!(key_of("right femur"), "femur");
        assert_eq!(key_of("left seventh rib"), "rib");
        assert_eq!(key_of("atlas"), "cervical vertebra");
        assert_eq!(key_of("left temporal bone"), "skull");
        assert_eq!(key_of("vomer"), "nasal");
        assert_eq!(key_of("cricoid cartilage"), "larynx");
        assert_eq!(key_of("navicular bone of left foot"), "tarsal");
        assert_eq!(key_of("proximal phalanx of right big toe"), "toe");
        assert_eq!(key_of("middle phalanx of left index finger"), "finger");
        assert_eq!(key_of("right patella"), "kneecap");
        assert_eq!(key_of("left hip bone"), "hip bone");
        assert_eq!(level_of("fourth cervical vertebra"), "C4");
        assert_eq!(level_of("twelfth thoracic vertebra"), "T12");
        assert_eq!(level_of("axis"), "C2");
        assert_eq!(level_of("right eleventh rib"), "11");
        assert_eq!(side_of("proximal phalanx of left thumb"), Some(Side::L));
        assert_eq!(side_of("sternum"), None);
        // MakeHuman's age slider: the buyer's 0.62 is 40.6 years, the old man's 0.93 is 80.9.
        assert!((years_of(0.62) - 40.6).abs() < 1e-3 && (years_of(0.93) - 80.9).abs() < 1e-3);
    }

    // The cord: C4 and above stops the breathing, below it the person still breathes on the diaphragm.
    #[test]
    fn cord_levels() {
        for (level, breathes) in [("C2", false), ("C4", false), ("C5", true), ("T6", true)] {
            let n: u32 = level[1..].parse().unwrap();
            assert_eq!(!(level.starts_with('C') && n <= 4), breathes, "{level}");
        }
    }

    // A bat (0.79 kg at 15.5 m/s) on a shin over its bone: F = v sqrt(k m), k the bat and the shin's skin in series, m the
    // bat and the shin's share of a 75 kg man in series: about 6.5 kN, nearly twice the young tibia's 3.5 kN across.
    #[test]
    fn bat_on_a_shin() {
        let what = tool("bat").unwrap();
        let k = 1.0 / (1.0 / spec("tibia").unwrap().pad + 1.0 / what.k);
        let behind = 75.0 * struck("shin");
        let m = (0.79 * behind) / (0.79 + behind);
        let f = 15.5 * (k * m).sqrt();
        assert!((f - 6490.0).abs() < 10.0, "{f}");
    }
}
