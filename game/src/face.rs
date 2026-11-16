// A face that shows what is happening to the person behind it (src/sandbox/face.ts).
//
// The rig is MakeHuman's own face (tools/people.py): every bone of it, and its face pose units, sixty unit poses of those
// bones each made by one muscle's pull, carried in the person's file as each bone's turn (person.rs `Body::face`). A face
// here is a weighted mix of units blended as MakeHuman blends them (each unit's turn scaled by its weight, the turns
// multiplied together), and the mix is written in the units of the Facial Action Coding System (Ekman & Friesen 1978,
// FACS; Ekman, Friesen & Hager 2002): AU1 inner brow raiser, AU4 brow lowerer, AU6 cheek raiser, and so on (AUS below
// says which pose units make each one). Brows, lashes and the hairline hang from the skin's own vertices and move with
// it; the swelling and the wounds are drawn in the skin's rest space and go wherever the skin goes.
//
// What the face shows, and from what:
// - Pain: the four movements that carry nearly all the information about pain in the face (Prkachin 1992; Prkachin &
//   Solomon 2008, whose PSPI score is AU4 + max(AU6, AU7) + max(AU9, AU10) + AU43): brows lowered and drawn together,
//   cheeks raised and lids tightened, nose wrinkled and upper lip raised, eyes shut, as much as it hurts; strongest as a
//   fresh hurt comes and easing into a lasting ache (the pain face is brief: Prkachin 1992; Craig & Patrick 1985).
// - Fear: brows raised and drawn together, upper lids raised, lips stretched back, the jaw dropped (AU1+2+4+5+20+26:
//   Ekman & Friesen 1975, 1978), from a weapon pointed at them, a shot or a blast nearby (a startle first: a blink and a
//   flinch of the face, Landis & Hunt 1939), being hurt, and the anxiety of losing blood (ATLS class II-III
//   haemorrhage: anxious, then confused).
// - The voice: the mouth opened by the recording itself as it plays (sound.rs `Voices`), the face that goes with each
//   kind of cry: a scream's wide jaw with the pain face, a yell, a groan with the eyes screwed up, weeping
//   (AU1+4+6+15+17, the mouth open with the sobs), a gasp, a cough, a last breath, a retch.
// - Air hunger: mouth breathing, the jaw opening with each breath in.
// - Shock: the face goes slack as the brain runs short of blood: expressions blunted, lids heavy, the jaw open, the eyes
//   unfocused and slow, blinks slow and long (drowsy blinks: Caffier, Erdmann & Ullsperger 2003), the skin pale.
// - Out cold: lids nearly shut or a little open, the eyes roving slowly under them and turned up (Bell's phenomenon),
//   the jaw falling open as gravity takes it, no blinking.
// - Dead: no blinking, lids part open, the eyes fixed and drifted out to their resting divergence, the jaw dropping
//   (primary flaccidity), the pupils going to mid-dilated and fixed (4-6 mm: Wijdicks 2001 on brain death), the skin
//   pale (pallor mortis).
// - Eyes, awake: both turned on the same point (they converge on it) and kept there as the head moves, moving between
//   points in saccades whose duration follows the main sequence (about 21 ms + 2.2 ms a degree: Carpenter 1988; Baloh
//   et al. 1975), with microsaccades between (Martinez-Conde, Macknik & Hubel 2004), the upper lid following the eye up
//   and down (MakeHuman's eye units carry the lids with them). Looking at the player (the one near them, and the
//   threat), at a fresh wound, away now and then.
// - Blinks: about 17 a minute at rest (Bentivoglio et al. 1997), more when frightened or hurting (Harrigan & O'Connell
//   1996), closing in ~80 ms and opening over ~170 ms (VanderWerf et al. 2003). Swollen lids close as far as the
//   swelling has come (bruise.rs).
// - Pupils: ~3.5 mm in a lit room, wider with fear and pain (sympathetic; the pupil dilates to pain: Larson et al.
//   1993), with hypoxia, and once dead (eyes.rs's look draws them).
// Sources and numbers: dev/research/faces.md.
//
// The head turning to the player is behaviour.rs's (`look`, a pose); the face is put on the skeleton after the body has
// put the head where it is (after ragdoll::send), and before person.rs puts the bones where `posed` says.

use std::collections::HashMap;
use std::sync::Arc;

use bevy::math::Affine3A;
use bevy::prelude::*;

use crate::behaviour::Behaviour;
use crate::npc::Hurt;
use crate::person::{Body, Person, RAD};
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::rng::Rng;
use crate::sound::{Sound, Voices};
use crate::vitals::{Side, Vitals};
use crate::weapons::{Kind, Weapons};

const WINDOW: f64 = 0.03; // seconds of the voice the mouth is opened by, at each moment
const JAW_UNIT: f32 = 20.2; // degrees the jaw turns in MakeHuman's JawDrop unit (the face's opening is given in degrees)
pub const MM_IRIS: f32 = 11.7; // mm across a grown iris; the pupil is given in mm and drawn as its share of the iris

// The action units the face is made of (their places in `Face::au`). AU5 (upper lid raiser), AU7 (lid tightener), AU43
// (eyes closed) and the jaw (AU25-27) are worked out with the lids and the jaw, where they meet the blink, the gaze and
// the voice; AU26 (jaw drop) only ever opens the jaw (FEAR's), as the TS's did.
const AU1: usize = 0;
const AU2: usize = 1;
const AU4: usize = 2;
const AU6: usize = 3;
const AU9: usize = 4;
const AU10: usize = 5;
const AU12: usize = 6;
const AU15: usize = 7;
const AU16: usize = 8;
const AU17: usize = 9;
const AU20: usize = 10;
const AU24: usize = 11;
const AU27: usize = 12;
const AU5: usize = 13;
const AU7: usize = 14;
const AU43: usize = 15;
const N: usize = 16;

// Each action unit as MakeHuman pose units: '*' is Left and Right in turn (the person's own sides), each at the weight
// given. The weights were set by eye against FACS's descriptions of each unit at full (E) intensity, from close renders.
const AUS: &[(usize, &[(&str, f32)])] = &[
    (AU1, &[("*InnerBrowUp", 0.9)]),
    (AU2, &[("*OuterBrowUp", 0.9)]),
    (AU4, &[("*BrowDown", 1.0), ("NoseWrinkler", 0.25)]),
    (AU6, &[("*CheekUp", 0.7)]),
    (AU9, &[("NoseWrinkler", 0.8), ("UpperLipUp", 0.3), ("NasolabialDeepener", 0.4)]),
    (AU10, &[("UpperLipUp", 0.8), ("NasolabialDeepener", 0.6)]),
    (AU12, &[("Mouth*PullUp", 0.5)]),
    (AU15, &[("Mouth*PullDown", 0.6)]),
    (AU16, &[("lowerLipDown", 0.5)]),
    (AU17, &[("lowerLipUp", 0.5), ("ChinForward", 0.4)]),
    (AU20, &[("Mouth*PullSide", 0.6), ("Mouth*Platysma", 0.25)]),
    (AU24, &[("lowerLipUp", 0.4), ("UpperLipBackward", 0.25)]),
    (AU27, &[("JawDropStretched", 0.6)]),
];

// The cries (npc.rs say's kinds, and the throat's retch and vomit): the face each makes, held while it sounds, and how
// far the jaw opens (degrees) at the recording's loudest. A scream is the pain face at its height with the mouth
// stretched open; weeping the sad face.
struct Cry {
    kind: &'static str,
    face: &'static [(usize, f32)],
    jaw: f32,
}

const CRIES: &[Cry] = &[
    Cry { kind: "scream", face: &[(AU4, 0.9), (AU6, 0.9), (AU7, 0.8), (AU9, 0.7), (AU10, 0.9), (AU16, 0.6), (AU20, 0.7), (AU27, 0.8), (AU43, 0.4)], jaw: 30.0 },
    Cry { kind: "yell", face: &[(AU4, 0.8), (AU7, 0.5), (AU10, 0.6), (AU16, 0.4), (AU20, 0.4), (AU27, 0.3)], jaw: 24.0 },
    Cry { kind: "groan", face: &[(AU4, 0.7), (AU6, 0.6), (AU7, 0.7), (AU15, 0.3), (AU20, 0.4), (AU43, 0.5)], jaw: 9.0 },
    Cry { kind: "cry", face: &[(AU1, 1.0), (AU4, 0.4), (AU6, 0.6), (AU7, 0.4), (AU15, 1.0), (AU17, 0.6), (AU20, 0.3), (AU43, 0.2)], jaw: 16.0 },
    Cry { kind: "gasp", face: &[(AU1, 0.6), (AU2, 0.5), (AU5, 0.3), (AU16, 0.3), (AU20, 0.2)], jaw: 24.0 },
    Cry { kind: "cough", face: &[(AU4, 0.6), (AU6, 0.6), (AU7, 0.7), (AU43, 0.7)], jaw: 20.0 },
    Cry { kind: "dying", face: &[], jaw: 18.0 },
    // Retching: the gag's face, nose wrinkled and upper lip drawn up, eyes screwed shut, the mouth pulled wide; vomiting,
    // the jaw thrown open (throat.rs holds it open with the heave as well).
    Cry { kind: "retch", face: &[(AU4, 0.7), (AU6, 0.6), (AU7, 0.8), (AU9, 0.8), (AU10, 0.8), (AU20, 0.6), (AU43, 0.7)], jaw: 22.0 },
    Cry { kind: "vomit", face: &[(AU4, 0.6), (AU7, 0.6), (AU9, 0.6), (AU10, 0.9), (AU16, 0.6), (AU20, 0.5), (AU27, 0.8), (AU43, 0.6)], jaw: 32.0 },
];

fn cry(kind: &str) -> Option<&'static Cry> {
    CRIES.iter().find(|c| c.kind == kind)
}

// How a pain face is made, by how much it hurts (0 to 1, PSPI's units scaled): brow lowering and orbital tightening
// first, the levator (nose wrinkle, upper lip) as it gets worse, the eyes shut at its worst, and only while the hurt is
// fresh (`flare`): nobody keeps their eyes screwed shut through a lasting pain.
fn pain_face(p: f32, flare: f32) -> [(usize, f32); 8] {
    [(AU4, p), (AU6, p * 0.9), (AU7, p), (AU9, ramp(p, 0.25, 0.8)), (AU10, ramp(p, 0.25, 0.8) * 0.9), (AU20, ramp(p, 0.35, 0.9) * 0.6),
     (AU43, ramp(p.min(flare), 0.5, 1.0) * 0.8), (AU24, ramp(p, 0.1, 0.5) * 0.3 * (1.0 - ramp(p, 0.6, 0.9)))]
}

// Fear's face; its jaw drop (AU26) is f * 0.35, which only opens the jaw.
fn fear_face(f: f32) -> [(usize, f32); 5] {
    [(AU1, f), (AU2, f * 0.8), (AU4, f * 0.45), (AU5, f), (AU20, f * 0.8)]
}

fn ramp(x: f32, a: f32, b: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

// A number that drifts back and forth for its own reasons (slow noise: sums of sines at unrelated rates).
fn wander(t: f32, seed: f32) -> f32 {
    ((t * 0.71 + seed).sin() + (t * 0.37 + seed * 2.3).sin() * 0.7 + (t * 1.13 + seed * 0.7).sin() * 0.4) / 2.1
}

// --- the rig, once a body --------------------------------------------------------------------------------------------

// The units out of a body's file, each as the bones (slots) it turns, about which axis, how far; and the units the face
// asks for by name, found once.
pub struct Rig {
    // Each slot's bone.
    slots: Vec<usize>,
    units: Vec<Vec<(usize, Vec3, f32)>>,
    // (au, unit, weight): AUS with each '*' as its two sides.
    mix: Vec<(usize, usize, f32)>,
    // Left then right (the person's own): the mouth's corners pulled down, the upper lid closed and opened, the lower lid
    // up, and the eye turned left, right, up, down.
    pull_down: [Option<usize>; 2],
    lid_closed: [Option<usize>; 2],
    lid_open: [Option<usize>; 2],
    lid_up: [Option<usize>; 2],
    eye: [[Option<usize>; 4]; 2],
    lower_lip_down: Option<usize>,
    jaw_drop: Option<usize>,
    tongue_down: Option<usize>,
    // How far (degrees) each eye unit turns its eye: a gaze in degrees is that share of the unit.
    eye_degrees: [[f32; 4]; 2],
    // Where each eye and the head bone are at rest.
    eye_rest: [Vec3; 2],
    head: usize,
    eye_bones: [usize; 2],
}

const WAYS: [&str; 4] = ["EyeturnLeft", "EyeturnRight", "EyeUp", "EyeDown"];

impl Rig {
    pub fn new(body: &Body) -> Rig {
        let mut names: Vec<&String> = body.face.keys().collect();
        names.sort();
        let mut slots: Vec<usize> = Vec::new();
        let mut units = Vec::new();
        let mut ids = HashMap::new();
        for name in names {
            let mut parts = Vec::new();
            let mut bones: Vec<(&String, &Quat)> = body.face[name].iter().collect();
            bones.sort_by(|a, b| a.0.cmp(b.0));
            for (bone, q) in bones {
                let Some(&b) = body.by_name.get(bone) else { continue };
                let slot = slots.iter().position(|&s| s == b).unwrap_or_else(|| {
                    slots.push(b);
                    slots.len() - 1
                });
                let s = q.xyz().length();
                if s < 1e-9 {
                    continue;
                }
                parts.push((slot, q.xyz() / s, 2.0 * s.atan2(q.w)));
            }
            ids.insert(name.clone(), units.len());
            units.push(parts);
        }
        let id = |n: &str| ids.get(n).copied();
        let sides = |unit: &str| -> Vec<String> {
            if unit.contains('*') { vec![unit.replace('*', "Left"), unit.replace('*', "Right")] } else { vec![unit.to_string()] }
        };
        let mix = AUS.iter()
            .flat_map(|&(au, parts)| parts.iter().flat_map(move |&(unit, x)| sides(unit).into_iter().map(move |u| (au, u, x))))
            .filter_map(|(au, u, x)| id(&u).map(|i| (au, i, x)))
            .collect();
        let both = |f: &dyn Fn(&str) -> String| [id(&f("Left")), id(&f("Right"))];
        let mut eye = [[None; 4]; 2];
        let mut eye_degrees = [[20.0; 4]; 2];
        for (k, side) in ["Left", "Right"].into_iter().enumerate() {
            let bone = body.by_name.get(if k == 0 { "eye.L" } else { "eye.R" }).copied();
            for (w, way) in WAYS.into_iter().enumerate() {
                eye[k][w] = id(&format!("{side}{way}"));
                if let (Some(u), Some(b)) = (eye[k][w], bone) {
                    if let Some(p) = units[u].iter().find(|p| slots[p.0] == b) {
                        eye_degrees[k][w] = p.2 / RAD;
                    }
                }
            }
        }
        Rig {
            pull_down: both(&|s| format!("Mouth{s}PullDown")),
            lid_closed: both(&|s| format!("{s}UpperLidClosed")),
            lid_open: both(&|s| format!("{s}UpperLidOpen")),
            lid_up: both(&|s| format!("{s}LowerLidUp")),
            lower_lip_down: id("lowerLipDown"),
            jaw_drop: id("JawDrop"),
            tongue_down: id("TongueDown"),
            eye,
            eye_degrees,
            eye_rest: [body.bone("eye.L").head, body.bone("eye.R").head],
            head: body.by_name["head"],
            eye_bones: [body.by_name["eye.L"], body.by_name["eye.R"]],
            slots,
            units,
            mix,
        }
    }
}

// --- one face --------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Target {
    Player,
    Wound,
    Away,
    Down,
    Body,
}

struct Gaze {
    // Each eye's yaw (positive to the person's left) and pitch (positive up), degrees, left eye first.
    now: [[f32; 2]; 2],
    from: [[f32; 2]; 2],
    t: f32,
    length: f32,
    target: Target,
    next: f32,
    micro: [f32; 2],
    micro_at: f32,
    spot: Option<Vec3>,
}

#[derive(Component)]
pub struct Face {
    rig: Arc<Rig>,
    rng: Rng,
    weights: Vec<f32>,
    order: Vec<usize>,
    au: [f32; N],
    quats: Vec<Quat>,
    // Degrees the jaw is open; how far the lids are shut in a blink.
    pub jaw: f32,
    pub blink: f32,
    clock: f32,
    seed: f32,
    gaze: Gaze,
    pain: f32,
    flare: f32,
    pub fear: f32,
    startle: f32,
    flash: f32,
    breath: f32,
    slack: f32,
    dead_for: f32,
    // The pupils' size (mm) and how pale the skin has gone (0 to 1), for the eyes' and the skin's looks.
    pub pupil: f32,
    pub pale: f32,
    last_pain: f32,
    next_blink: f32,
    blink_t: f32,
    blink_long: f32,
    dead_lids: f32,
}

// What a face sees and hears this frame, gathered by `faces`.
struct Seen {
    camera: Option<Transform>,
    held: Kind,
    flash: f32,
    // The head's segment now (its bone's head and turn), and its bone's place from the body at rest to the world.
    head: Option<Transform>,
    head_bone: Affine3A,
    // A fresh wound's place now and how long ago it was made.
    wound: Option<(Vec3, f32)>,
    // How loud the voice is now (0 to 1) and its kind.
    voice: Option<(f32, &'static str)>,
}

impl Face {
    fn new(rig: Arc<Rig>, seed: u32, flash: f32) -> Face {
        let mut rng = Rng::new(seed);
        let slots = rig.slots.len();
        let units = rig.units.len();
        let next_blink = 1.0 + rng.next() * 3.0;
        let dead_lids = 0.45 + rng.next() * 0.35;
        let seed = rng.next() * 100.0;
        Face {
            rig,
            weights: vec![0.0; units],
            order: Vec::with_capacity(units),
            au: [0.0; N],
            quats: vec![Quat::IDENTITY; slots],
            jaw: 0.0,
            blink: 0.0,
            clock: 0.0,
            seed,
            gaze: Gaze { now: [[0.0; 2]; 2], from: [[0.0; 2]; 2], t: 1.0, length: 0.0, target: Target::Player, next: 0.5, micro: [0.0; 2], micro_at: 0.0, spot: None },
            pain: 0.0,
            flare: 0.0,
            fear: 0.0,
            startle: 0.0,
            flash,
            breath: 0.0,
            slack: 0.0,
            dead_for: 0.0,
            pupil: 3.5,
            pale: 0.0,
            last_pain: 0.0,
            next_blink,
            blink_t: -1.0,
            blink_long: 1.0,
            dead_lids,
            rng,
        }
    }

    fn add(&mut self, unit: Option<usize>, x: f32) {
        let Some(u) = unit else { return };
        if x.abs() > 1e-3 {
            if self.weights[u] == 0.0 {
                self.order.push(u);
            }
            self.weights[u] += x;
        }
    }

    // `hangs` is how far (degrees) a broken or dislocated jaw, or a retch, holds the mouth open whatever the face would do.
    fn update(&mut self, dt: f32, v: &Vitals, hurt: &Hurt, seen: &Seen, behaviour: Option<&Behaviour>) {
        if dt <= 0.0 {
            return;
        }
        self.clock += dt;
        let dead = v.dead;
        let conscious = if dead { 0.0 } else { v.conscious() };
        // How much of a face is left to make expressions with: all of it awake, none out cold.
        let alert = ramp(conscious, 0.35, 0.85);
        let (loud, kind) = seen.voice.map_or((0.0, ""), |(l, k)| (l, k));
        let crying = hurt.crying;
        let hangs = hurt.bones.jaw_hangs.max(hurt.throat.gape);

        // --- pain: a lasting ache and the flare of a fresh hurt
        let fresh = (v.pain - self.last_pain).max(0.0);
        self.last_pain = v.pain;
        self.flare = (self.flare * (-dt / 2.5).exp() + fresh * 2.5).min(1.0);
        self.pain = (v.pain.powf(0.8) * 0.65 + self.flare).clamp(0.0, 1.0) * alert;
        // (a fresh hurt draws the eyes to it at once)
        if fresh > 0.08 {
            self.gaze.next = 0.0;
        }

        // --- fear: a weapon pointed at them, a shot or a blast, a fresh hurt, blood running out
        if seen.flash != self.flash {
            if alert > 0.2 {
                self.startle = 1.0;
            }
            self.flash = seen.flash;
        }
        self.startle = (self.startle - dt / 0.6).max(0.0);
        let threat = self.threat(seen);
        let anxious = ramp(v.lost(), 0.12, 0.35) * 0.5;
        let fear = threat.max(self.flare * 0.6).max(anxious).max(self.startle * 0.8) * alert;
        self.fear += (fear - self.fear) * (dt / if fear > self.fear { 0.25 } else { 4.0 }).min(1.0);

        // --- slack: the brain short of blood or oxygen, or nobody there
        self.slack = if dead { 1.0 } else { 1.0 - alert };
        self.dead_for = if dead { self.dead_for + dt } else { 0.0 };

        // --- the action units
        let mut target = [0.0f32; N];
        let take = |target: &mut [f32; N], face: &[(usize, f32)], k: f32| {
            for &(u, x) in face {
                target[u] = target[u].max(x * k);
            }
        };
        take(&mut target, &pain_face(self.pain, self.flare), 1.0);
        take(&mut target, &fear_face(self.fear), 1.0);
        if self.startle > 0.0 {
            take(&mut target, &[(AU1, 0.6), (AU2, 0.6), (AU4, 0.3), (AU5, 0.8), (AU20, 0.8), (AU43, if self.startle > 0.85 { 1.0 } else { 0.0 })], self.startle);
        }
        if crying && alert > 0.2 {
            take(&mut target, cry("cry").unwrap().face, 0.85 * alert);
        }
        if let Some(c) = cry(kind) {
            take(&mut target, c.face, (0.55 + loud).min(1.0) * alert.max(if kind == "dying" { 1.0 } else { 0.0 }));
        }
        // (onset quick, release slower: a face falls back to rest over half a second or so)
        for u in 0..N {
            self.au[u] += (target[u] - self.au[u]) * (dt * if target[u] > self.au[u] { 9.0 } else { 2.5 }).min(1.0);
        }
        let au = self.au;

        // --- the jaw: the voice, breathing through the mouth, slack, a broken jaw hanging
        self.breath += dt * v.rr.max(0.0) / 60.0;
        let hunger = if v.breathing && !dead {
            ramp(v.rr, 22.0, 34.0).max(ramp(98.0 - v.spo2, 6.0, 20.0)).max(ramp(1.0 - v.airway, 0.2, 0.6))
        } else {
            0.0
        };
        let inhale = (self.breath * std::f32::consts::TAU).sin().max(0.0);
        let sag = sag(seen.head);
        let mut jaw = (loud * cry(kind).map_or(26.0, |c| c.jaw) * alert.max(0.6))
            .max(hunger * (4.0 + 10.0 * inhale) * (0.4 + 0.6 * conscious))
            .max(self.fear * 0.35 * 12.0)
            .max(au[AU27] * 18.0)
            .max(self.pain * 2.5)
            .max(hangs);
        // Slack, the jaw falls as far as gravity takes it; dead, further, and further as the minutes go (primary flaccidity).
        if self.slack > 0.0 {
            jaw = jaw.max(self.slack * sag * if dead { 14.0 + 8.0 * ramp(self.dead_for, 0.0, 120.0) } else { 10.0 });
        }
        self.jaw += (jaw - self.jaw) * (dt * if jaw > self.jaw { 30.0 } else if dead { 1.5 } else { 12.0 }).min(1.0);

        // --- blinks
        self.blinks(dt, alert, dead);

        // --- the mix
        for &u in &self.order {
            self.weights[u] = 0.0;
        }
        self.order.clear();
        let rig = self.rig.clone();
        for &(k, unit, x) in &rig.mix {
            self.add(Some(unit), au[k] * x);
        }
        // Weeping and a slack face turn the corners of the mouth down; a slack lower lip falls a little from the teeth.
        for s in 0..2 {
            self.add(rig.pull_down[s], 0.25 * self.slack);
        }
        self.add(rig.lower_lip_down, 0.15 * self.slack);
        self.add(rig.jaw_drop, self.jaw / JAW_UNIT);
        // (the tongue lies flat on the floor of an open mouth, behind the lower teeth)
        self.add(rig.tongue_down, ramp(self.jaw, 5.0, 30.0) * 0.5);
        self.lids(hurt, dead, alert);
        self.look(dt, v, hurt, seen, behaviour, alert, dead);
        self.compose();

        // --- pupils and the colour of the skin
        let pupil = if dead {
            5.5
        } else {
            3.4 + 1.6 * self.fear.max(self.pain * 0.8) + 2.0 * ramp(92.0 - v.spo2, 0.0, 30.0) + 1.2 * ramp(v.lost(), 0.2, 0.4)
        };
        self.pupil += (pupil - self.pupil) * (dt / if pupil > self.pupil { if dead { 25.0 } else { 0.8 } } else { 1.5 }).min(1.0);
        // Pale with blood lost and the pressure falling (the skin's vessels shut down first), paler still once dead.
        let pale = if dead { 1.0 } else { ramp(v.lost(), 0.12, 0.4).max(ramp(70.0 - v.map, 0.0, 40.0)) * 0.85 };
        self.pale += (pale - self.pale) * (dt / if dead { 60.0 } else { 8.0 }).min(1.0);
    }

    // How threatening the player is to this person, 0 to 1: holding a weapon, near, and pointing it at them.
    fn threat(&self, seen: &Seen) -> f32 {
        let (Some(cam), Some(head)) = (seen.camera, seen.head) else { return 0.0 };
        if !matches!(seen.held, Kind::Gun | Kind::Blade | Kind::Blunt | Kind::Grenade) {
            return 0.0;
        }
        let to = head.translation - cam.translation;
        let d = to.length();
        let aimed = (to / d.max(1e-3)).dot(cam.forward().as_vec3());
        let gun = seen.held == Kind::Gun;
        let reach = if gun { 12.0 } else { 3.0 };
        ramp(aimed, if gun { 0.94 } else { 0.7 }, 0.995) * ramp(reach - d, 0.0, reach * 0.6) + ramp(2.0 - d, 0.0, 1.5) * 0.4
    }

    // Blinking: a blink every few seconds (more often frightened or hurting, slower and longer as the brain goes), each
    // closing fast and opening slower. None out cold or dead. A startle blinks at once.
    fn blinks(&mut self, dt: f32, alert: f32, dead: bool) {
        if dead || alert <= 0.05 {
            self.blink_t = -1.0;
            self.blink = 0.0;
            return;
        }
        if self.startle > 0.95 && self.blink_t < 0.0 {
            self.blink_t = 0.0;
        }
        if self.blink_t < 0.0 {
            self.next_blink -= dt * (1.0 + 1.3 * self.fear + 0.8 * self.pain) * (0.6 + 0.4 * alert);
            if self.next_blink <= 0.0 {
                self.blink_t = 0.0;
                self.blink_long = 1.0 + 2.0 * (1.0 - alert);
                // (intervals from 1 to 10 s about a mean of 3.5 s; one in eight comes straight after the last: a double
                // blink)
                self.next_blink = if self.rng.next() < 0.12 { 0.25 } else { (-(1.0 - self.rng.next()).ln() * 2.6 + 0.9).clamp(1.0, 10.0) };
            }
        }
        if self.blink_t >= 0.0 {
            self.blink_t += dt / self.blink_long;
            let t = self.blink_t;
            self.blink = if t < 0.08 { t / 0.08 } else if t < 0.11 { 1.0 } else { (1.0 - (t - 0.11) / 0.17).max(0.0) };
            if t > 0.28 {
                self.blink_t = -1.0;
                self.blink = 0.0;
            }
        }
    }

    // The lids: what the face asks of them (raised in fear, tightened in pain, shut at pain's worst), a blink over that,
    // heavy as the brain goes, nearly shut out cold, part open dead, and shut as far as the swelling has closed them, and
    // clamped shut over an eye that is hurt (eyes.rs).
    fn lids(&mut self, hurt: &Hurt, dead: bool, alert: f32) {
        let au = self.au;
        let heavy = if dead {
            self.dead_lids
        } else if alert <= 0.05 {
            0.85 + 0.1 * wander(self.clock * 0.2, self.seed)
        } else {
            (1.0 - alert) * 0.5
        };
        let rig = self.rig.clone();
        for (k, side) in [Side::L, Side::R].into_iter().enumerate() {
            let swollen = if k == 0 { hurt.bruise.swollen.0 } else { hurt.bruise.swollen.1 };
            let clamped = if dead { 0.0 } else { shut(hurt, side, alert) };
            let shut = (self.blink * 1.05).max(au[AU43]).max(au[AU7] * 0.25).max(heavy).max(swollen).max(clamped).min(1.05);
            self.add(rig.lid_closed[k], shut);
            self.add(rig.lid_open[k], (au[AU5] * 0.9 - shut).max(0.0));
            self.add(rig.lid_up[k], (au[AU7] * 0.6 + au[AU6] * 0.4 + self.blink * 0.25 + au[AU43] * 0.3 + swollen * 0.45).min(1.0));
        }
    }

    // Where the eyes point. Awake, at something (`choose`), both eyes turned on the same point and held on it however the
    // head moves, a saccade to each new one; dazed, unfocused and drifting; out cold, roving slowly and turned up; dead,
    // still, drifted out to rest.
    #[allow(clippy::too_many_arguments)]
    fn look(&mut self, dt: f32, v: &Vitals, hurt: &Hurt, seen: &Seen, behaviour: Option<&Behaviour>, alert: f32, dead: bool) {
        let blind = [hurt.eyes.l.blind, hurt.eyes.r.blind];
        let mut want;
        if dead {
            want = [[4.0, -3.0], [-4.0, -3.0]];
        } else if alert <= 0.05 || (blind[0] && blind[1]) {
            // Out cold, or nothing left to see with: no fixing on anything, the eyes roving together (awake, level).
            let rove = 12.0 * wander(self.clock * 0.6, self.seed);
            let up = if alert <= 0.05 { 14.0 } else { 4.0 * wander(self.clock * 0.4, self.seed + 3.0) };
            want = [[rove + 2.0, up], [rove - 2.0, up]];
        } else {
            self.gaze.t += dt;
            self.gaze.next -= dt;
            if self.gaze.next <= 0.0 {
                self.choose(v, seen, behaviour, alert);
            }
            want = self.spot(seen).map_or([[0.0; 2]; 2], |at| aim(&self.rig, seen.head_bone, at));
            // Unfocused as the brain goes: the eyes drift toward straight ahead and apart, slowly.
            let lost = 1.0 - alert;
            for (k, sgn) in [(0, 1.0), (1, -1.0)] {
                want[k][0] = want[k][0] * (1.0 - lost) + lost * (2.0 * sgn + 8.0 * wander(self.clock * 0.3, self.seed));
                want[k][1] = want[k][1] * (1.0 - lost) + lost * (-4.0 + 4.0 * wander(self.clock * 0.23, self.seed + 1.0));
            }
            // Microsaccades: tiny jumps of a fraction of a degree, one or two a second, while fixing on something.
            self.gaze.micro_at -= dt;
            if self.gaze.micro_at <= 0.0 {
                self.gaze.micro_at = 0.4 + self.rng.next() * 0.9;
                self.gaze.micro = [(self.rng.next() - 0.5) * 0.8, (self.rng.next() - 0.5) * 0.6];
            }
            // A blind eye fixes on nothing: it is carried with the seeing one (both get the same command, Hering's law).
            if blind[0] {
                want[0] = want[1];
            } else if blind[1] {
                want[1] = want[0];
            }
        }
        let rig = self.rig.clone();
        for k in 0..2 {
            let g = &mut self.gaze;
            let to = want[k];
            if !dead && alert > 0.05 && g.t < g.length {
                // A saccade: from where it began to where the target is now, fast in the middle (the main sequence).
                let x = ramp(g.t / g.length, 0.0, 1.0);
                for a in 0..2 {
                    g.now[k][a] = g.from[k][a] + (to[a] - g.from[k][a]) * x;
                }
            } else {
                // Held on the point (the reflexes keep a fixed point fixed as the head moves); slow drifts are followed.
                let k2 = (dt * if dead { 0.5 } else if alert <= 0.05 { 3.0 } else { 25.0 }).min(1.0);
                for a in 0..2 {
                    g.now[k][a] += (to[a] + if dead { 0.0 } else { g.micro[a] } - g.now[k][a]) * k2;
                }
            }
            // Yaw positive to the person's left; pitch positive up. Eyes go about 40 degrees across and 30 up, 40 down.
            let yaw = g.now[k][0].clamp(-38.0, 38.0);
            let pitch = g.now[k][1].clamp(-35.0, 28.0);
            let across = if yaw > 0.0 { 0 } else { 1 };
            let upward = if pitch > 0.0 { 2 } else { 3 };
            let (u1, d1) = (rig.eye[k][across], rig.eye_degrees[k][across]);
            let (u2, d2) = (rig.eye[k][upward], rig.eye_degrees[k][upward]);
            self.add(u1, yaw.abs() / d1);
            self.add(u2, pitch.abs() / d2);
        }
    }

    // What to look at next, and for how long: mostly the player's face (the one in front of them, and the danger), a fresh
    // wound for a moment after a hurt, now and then somewhere else. Frightened, short looks that keep coming back to the
    // threat (vigilant scanning); hurting, back to the wound.
    fn choose(&mut self, v: &Vitals, seen: &Seen, _behaviour: Option<&Behaviour>, alert: f32) {
        let r = self.rng.next();
        let fresh = seen.wound.filter(|w| w.1 < 6.0 && v.pain > 0.1);
        let target = if fresh.is_some_and(|w| w.1 < 1.2 || r < 0.3 + 0.3 * self.pain) {
            Target::Wound
        } else if self.fear > 0.4 {
            if r < 0.75 { Target::Player } else { Target::Away }
        } else if r < 0.6 {
            Target::Player
        } else if r < 0.75 {
            Target::Body
        } else if r < 0.9 {
            Target::Away
        } else {
            Target::Down
        };
        let was = self.spot(seen);
        self.gaze.target = target;
        self.gaze.spot = None;
        if matches!(target, Target::Away | Target::Down | Target::Body) {
            self.gaze.spot = self.place(target, seen);
        }
        let now = self.spot(seen);
        let k = self.rng.next();
        self.gaze.next = (if self.fear > 0.4 {
            0.3 + k * 0.8
        } else if target == Target::Player {
            1.2 + k * 2.8
        } else {
            0.5 + k * 1.2
        }) / (0.5 + 0.5 * alert);
        // A saccade to it: its size, and its length by the main sequence.
        if let (Some(was), Some(now)) = (was, now) {
            let a = aim(&self.rig, seen.head_bone, was);
            let b = aim(&self.rig, seen.head_bone, now);
            let size = (a[0][0] - b[0][0]).hypot(a[0][1] - b[0][1]);
            self.gaze.from = self.gaze.now;
            self.gaze.t = 0.0;
            self.gaze.length = (21.0 + 2.2 * size) / 1000.0;
        }
    }

    // A place to glance at: the player's body, aside, at the floor ahead (in the world, chosen once per look).
    fn place(&mut self, target: Target, seen: &Seen) -> Option<Vec3> {
        let (head, cam) = (seen.head?, seen.camera?);
        let r = [self.rng.next(), self.rng.next(), self.rng.next()];
        if target == Target::Body {
            return Some(cam.translation + Vec3::new((r[0] - 0.5) * 0.3, -0.35 - r[1] * 0.5, 0.0));
        }
        let fwd = head.rotation * Vec3::NEG_Z;
        let side = head.rotation * Vec3::X;
        if target == Target::Down {
            return Some(head.translation + fwd * 1.2 + Vec3::new(0.0, -1.4, 0.0) + side * ((r[0] - 0.5) * 0.8));
        }
        Some(head.translation + fwd * 2.5 + side * (if r[0] < 0.5 { -1.0 } else { 1.0 } * (0.6 + r[1] * 0.9)) + Vec3::new(0.0, (r[2] - 0.5) * 0.6, 0.0))
    }

    // Where the eyes' current target is in the world, or None.
    fn spot(&self, seen: &Seen) -> Option<Vec3> {
        match self.gaze.target {
            Target::Player => seen.camera.map(|c| c.translation),
            Target::Wound => seen.wound.map(|w| w.0),
            _ => self.gaze.spot,
        }
    }

    // The units' weights into the bones: each bone turned by every unit that turns it, each unit's turn scaled by its
    // weight (MakeHuman's blend, PoseUnit.getBlendedPose: later units on the left).
    fn compose(&mut self) {
        self.quats.fill(Quat::IDENTITY);
        for &u in &self.order {
            let w = self.weights[u];
            for &(slot, axis, angle) in &self.rig.units[u] {
                let (s, c) = (angle * w / 2.0).sin_cos();
                self.quats[slot] = Quat::from_xyzw(axis.x * s, axis.y * s, axis.z * s, c) * self.quats[slot];
            }
        }
    }
}

// How far the lids on side `s` are clamped shut over a hurt eye, by an awake person: hard at first, easing over a minute
// to a squint the light still hurts through; the other eye screws up with it for the first seconds (eyes.ts `shut`).
fn shut(hurt: &Hurt, s: Side, alert: f32) -> f32 {
    let (e, o) = if s == Side::L { (&hurt.eyes.l, &hurt.eyes.r) } else { (&hurt.eyes.r, &hurt.eyes.l) };
    let own = e.clamp * (0.65 + 0.35 * (-e.t / 40.0).exp());
    let other = o.clamp * 0.6 * (-o.t / 4.0).exp();
    own.max(other) * alert
}

// How far gravity takes a slack jaw open: the most with the face up or the head upright, none face down.
fn sag(head: Option<Transform>) -> f32 {
    let Some(head) = head else { return 1.0 };
    let up = head.rotation * Vec3::Y;
    let fwd = head.rotation * Vec3::NEG_Z;
    (0.25 + up.y.max(0.0) * 0.6 + fwd.y.max(0.0) * 0.9 - (-fwd.y).max(0.0) * 0.8).clamp(0.0, 1.0)
}

// Each eye's yaw (positive to the person's left) and pitch (positive up), degrees, to look at world point `at`: the point
// taken into the head bone's frame (the rest frame turned with it), seen from each eye's place at rest.
fn aim(rig: &Rig, head_bone: Affine3A, at: Vec3) -> [[f32; 2]; 2] {
    let p = head_bone.inverse().transform_point3(at);
    [0, 1].map(|k| {
        let d = p - rig.eye_rest[k];
        // (Ahead is -Z, the person's left -X.)
        [(-d.x).atan2(-d.z) / RAD, d.y.atan2(d.x.hypot(d.z)) / RAD]
    })
}

// Bone `i`'s place from the body at rest to the world, from its own chain up to the root (the whole skeleton's would be
// ten times the work), as npc.rs `bone_worlds` works every bone out.
pub fn bone_world(person: &Person, root: &Transform, i: usize) -> Affine3A {
    let bones = &person.body.bones;
    let mut chain = Vec::with_capacity(12);
    let mut b = Some(i);
    while let Some(k) = b {
        chain.push(k);
        b = bones[k].parent;
    }
    let (mut r, mut at) = (Quat::IDENTITY, Vec3::ZERO);
    for (n, &k) in chain.iter().rev().enumerate() {
        if n == 0 {
            r = person.posed.local[k];
            at = bones[k].head;
        } else {
            let p = bones[k].parent.unwrap();
            at += r * (bones[k].head - bones[p].head);
            r *= person.posed.local[k];
        }
    }
    let pelvis = person.body.bone("root").head;
    root.compute_affine()
        * Affine3A::from_rotation_translation(person.posed.frame.rotation, person.posed.frame.translation)
        * Affine3A::from_translation(-pelvis)
        * Affine3A::from_rotation_translation(r, at)
        * Affine3A::from_translation(-bones[i].head)
}

// How loud a voice is at this moment, 0 to 1, from the recording itself: its last 30 ms.
fn loudness(voice: &crate::sound::Voice, now: f64) -> Option<f32> {
    let t = now - voice.start;
    if t < 0.0 || t > voice.length / voice.rate as f64 {
        return None;
    }
    let data = &voice.data;
    let sr = data.sample_rate as f64;
    let at = ((voice.from + t * voice.rate as f64) * sr) as usize;
    let n = (WINDOW * sr) as usize;
    let frames = &data.frames;
    let sum: f32 = frames[at.saturating_sub(n).min(frames.len())..at.min(frames.len())].iter().map(|f| f.left * f.left).sum();
    Some(((sum / n.max(1) as f32).sqrt() * 4.5).min(1.0))
}

// --- systems ---------------------------------------------------------------------------------------------------------

// Each person with medicine and no face yet given one (the rig made once a body).
fn fit(mut commands: Commands, people: Query<(Entity, &Person), (With<Hurt>, Without<Face>)>, muzzle: Option<Res<crate::muzzle::Muzzle>>,
       mut rigs: Local<HashMap<String, Arc<Rig>>>) {
    for (e, person) in &people {
        let body = &person.body;
        if body.face.is_empty() {
            continue;
        }
        let rig = rigs.entry(body.name.clone()).or_insert_with(|| Arc::new(Rig::new(body))).clone();
        // (Its own randomness, seeded by who they are: the face's blinks and glances are not the scenario's dice.)
        commands.entity(e).insert(Face::new(rig, e.to_bits() as u32 ^ 0x5bd1_e995, muzzle.as_ref().map_or(0.0, |m| m.at)));
    }
}

// Every face, a frame: what it sees and hears gathered, the face worked out and put on the skeleton, and the eyes'
// bones as their hurt leaves them (a collapsed globe smaller front to back and drawn back, a blown-out floor letting it
// sink: eyes.ts `pose`).
#[allow(clippy::type_complexity)]
fn faces(
    time: Res<Time>,
    sound: Res<Sound>,
    voices: Res<Voices>,
    weapons: Res<Weapons>,
    muzzle: Option<Res<crate::muzzle::Muzzle>>,
    players: Query<&Transform, (With<Player>, Without<Person>)>,
    mut people: Query<(Entity, &mut Person, &Transform, &Vitals, &Hurt, &mut Face, Option<&Ragdoll>, Option<&Behaviour>)>,
    mut joints: Query<&mut Transform, (Without<Person>, Without<Player>)>,
) {
    let dt = time.delta_secs();
    let camera = players.iter().next().copied();
    for (e, mut person, root, v, hurt, mut face, rd, behaviour) in &mut people {
        let head = rd.and_then(|rd| rd.segs.iter().find(|s| s.def.name == "head")).map(|s| s.now);
        let wound = rd.zip(behaviour.and_then(|b| b.wound.as_ref())).map(|(rd, w)| (rd.segs[w.seg].now.transform_point(w.local), w.t));
        let voice = voices.0.get(&e).and_then(|(playing, kind)| {
            // (Retching or vomiting out cold makes no face: the throat holds the jaw open by itself.)
            if matches!(*kind, "retch" | "vomit") && v.conscious() <= 0.35 {
                return None;
            }
            loudness(&playing.voice(), sound.now()).map(|l| (l, *kind))
        });
        let seen = Seen {
            camera,
            held: weapons.arm().kind,
            flash: muzzle.as_ref().map_or(0.0, |m| m.at),
            head,
            head_bone: bone_world(&person, root, face.rig.head),
            wound,
            voice,
        };
        face.update(dt, v, hurt, &seen, behaviour);
        let rig = face.rig.clone();
        for (k, &b) in rig.slots.iter().enumerate() {
            person.posed.local[b] = face.quats[k];
        }
        // The eyes as their hurt leaves them (rest translation, scaled front to back, sunk).
        for (k, eye) in [&hurt.eyes.l, &hurt.eyes.r].into_iter().enumerate() {
            let c = eye.collapse;
            if c < 1e-3 && eye.sunk == 0.0 {
                continue;
            }
            let b = rig.eye_bones[k];
            let bone = &person.body.bones[b];
            let rest = bone.head - bone.parent.map_or(Vec3::ZERO, |p| person.body.bones[p].head);
            if let Ok(mut t) = joints.get_mut(person.joints[b]) {
                t.scale = Vec3::new(1.0 - 0.12 * c, 1.0 - 0.22 * c, 1.0 - 0.5 * c);
                // (Back into the socket is +Z here, the TS's -Z.)
                t.translation = rest + Vec3::new(0.0, -0.4 * eye.sunk, 0.004 * c + eye.sunk);
            }
        }
    }
}

// The skin's colour as the blood leaves it: the red goes first, toward a grey-yellow white (pallor), written to the
// person's own skin materials (port/skin's `Flesh`; or, without them, SKIN_PLAIN=1, their StandardMaterial made their
// own the first time it shows), only when it has changed enough to see.
#[derive(Component, Default)]
pub struct Pallor {
    plain: Vec<Handle<StandardMaterial>>,
    shown: f32,
}

pub fn pallor_colour(pale: f32) -> Color {
    Color::linear_rgb(1.0 - 0.16 * pale, 1.0 - 0.07 * pale, 1.0 - 0.05 * pale)
}

fn pallor(
    mut commands: Commands,
    mut people: Query<(Entity, &Person, &Face, Option<&crate::skin::Skin>, Option<&mut Pallor>)>,
    parts: Query<&MeshMaterial3d<StandardMaterial>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut flesh: ResMut<Assets<crate::skin::Flesh>>,
) {
    for (e, person, face, skin, own) in &mut people {
        let shown = own.as_ref().map_or(0.0, |p| p.shown);
        if (shown - face.pale).abs() <= 0.0125 {
            continue;
        }
        let colour = pallor_colour(face.pale);
        let mut plain = own.as_ref().map_or_else(Vec::new, |p| p.plain.clone());
        match skin {
            Some(skin) => {
                for (_, _, h, mode) in &skin.materials {
                    if *mode == crate::skin::SKIN || *mode == crate::skin::UNDER {
                        // (keeping its alpha: the x-ray sees through the skin by it)
                        if let Some(mut m) = flesh.get_mut(h) {
                            let a = m.base.base_color.alpha();
                            m.base.base_color = colour.with_alpha(a);
                        }
                    }
                }
            }
            None => {
                if plain.is_empty() {
                    for &(i, part) in &person.parts {
                        let Some(m) = parts.get(part).ok().filter(|_| person.body.parts[i].kind == "skin").and_then(|m| materials.get(&m.0)).cloned() else { continue };
                        let h = materials.add(m);
                        commands.entity(part).insert(MeshMaterial3d(h.clone()));
                        plain.push(h);
                    }
                }
                for h in &plain {
                    if let Some(mut m) = materials.get_mut(h) {
                        m.base_color = colour;
                    }
                }
            }
        }
        match own {
            Some(mut p) => {
                p.shown = face.pale;
                p.plain = plain;
            }
            None => {
                commands.entity(e).insert(Pallor { plain, shown: face.pale });
            }
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Update, (fit, crate::profiler::timed("face", faces), pallor).chain().after(crate::ragdoll::send));
}

#[cfg(test)]
mod tests {
    use super::*;

    // A unit put on at weight one turns its bones as the file says, and the blend of a unit with itself at a half each is
    // the unit at one.
    #[test]
    fn blend() {
        let q = Quat::from_axis_angle(Vec3::X, 0.3);
        let rig = Rig {
            slots: vec![0],
            units: vec![vec![(0, Vec3::X, 0.3)]],
            mix: Vec::new(),
            pull_down: [None; 2],
            lid_closed: [None; 2],
            lid_open: [None; 2],
            lid_up: [None; 2],
            eye: [[None; 4]; 2],
            lower_lip_down: None,
            jaw_drop: Some(0),
            tongue_down: None,
            eye_degrees: [[20.0; 4]; 2],
            eye_rest: [Vec3::ZERO; 2],
            head: 0,
            eye_bones: [0, 0],
        };
        let mut f = Face::new(Arc::new(rig), 1, 0.0);
        f.add(Some(0), 0.5);
        f.add(Some(0), 0.5);
        f.compose();
        assert!(f.quats[0].angle_between(q) < 1e-5);
    }
}

// --- the check -------------------------------------------------------------------------------------------------------
//
// `cargo run -- --scenario face --out <dir>`: the groundskeeper's face close up at rest, in the middle of each cry
// (forced: npc.say), in pain, mid-blink, looking at the player from the side; then the young man's eye shot through with
// a pellet, the old man killed (the dying breath, and his face half a minute on), the man in the hood's jaw broken by a
// bat with his front teeth knocked out. Each picture's face (its action units, jaw, pupils) goes into the log.
// tools/port-face.mjs takes the same pictures in the TS game.

use crate::scenario::{log, Step};
use serde_json::json;

fn who(w: &mut World, body: &str) -> Entity {
    let mut q = w.query::<(Entity, &Person)>();
    q.iter(w).find(|(_, p)| p.body.name == body).map(|(e, _)| e).expect("the line-up")
}

// The middle of the eyes and which way the face looks, now.
fn face_at(w: &mut World, e: Entity) -> (Vec3, Vec3) {
    let mut q = w.query::<(&Person, &Transform, Option<&Ragdoll>)>();
    let (p, root, rd) = q.get(w, e).unwrap();
    let eyes = [p.body.by_name["eye.L"], p.body.by_name["eye.R"]].map(|b| bone_world(p, root, b).transform_point3(p.body.bones[b].head));
    let head = rd.and_then(|rd| rd.segs.iter().find(|s| s.def.name == "head")).map_or(root.rotation, |s| s.now.rotation);
    ((eyes[0] + eyes[1]) / 2.0, head * Vec3::NEG_Z)
}

// The player's eye `far` from `body`'s face, `turn` degrees round from straight in front of it, looking at it; a few
// frames; a picture, and the face as it was into the log.
fn close(name: &'static str, body: &'static str, turn: f32, far: f32) -> Vec<Step> {
    vec![
        Step::Do(Box::new(move |w: &mut World| {
            // (Nothing of the HUD over the pictures, and nothing in the hands.)
            for mut v in w.query_filtered::<&mut Visibility, With<Text>>().iter_mut(w) {
                *v = Visibility::Hidden;
            }
            let mut wp = w.resource_mut::<Weapons>();
            if wp.slots[wp.slot] != Some("hands") {
                wp.slots[0] = Some("hands");
                wp.queue.push(crate::weapons::Act::Select(0));
            }
            let e = who(w, body);
            let (at, fwd) = face_at(w, e);
            let cam = at + Quat::from_rotation_y(turn * RAD) * fwd * far;
            w.resource_scope(|w, map: Mut<crate::map::Map>| {
                let ground = map.ground(cam.x, cam.z, f32::INFINITY);
                for mut p in w.query::<&mut Player>().iter_mut(w) {
                    p.spawn(&map, cam.x, cam.z, Some(at), (cam.y - ground).max(0.15));
                }
            });
        })),
        Step::Wait(3),
        Step::Shot(name.into()),
        Step::Do(Box::new(move |w: &mut World| {
            let e = who(w, body);
            let f = w.get::<Face>(e).unwrap();
            let names = ["AU1", "AU2", "AU4", "AU6", "AU9", "AU10", "AU12", "AU15", "AU16", "AU17", "AU20", "AU24", "AU27", "AU5", "AU7", "AU43"];
            let au: serde_json::Map<String, serde_json::Value> =
                names.iter().zip(f.au).filter(|(_, x)| *x > 0.01).map(|(n, x)| (n.to_string(), json!((x * 100.0).round() / 100.0))).collect();
            let v = w.get::<Vitals>(e).unwrap();
            let state = json!({ "picture": name, "au": au, "jaw": f.jaw, "blink": f.blink, "pupil": f.pupil, "pale": f.pale, "fear": f.fear,
                                 "gaze": f.gaze.now, "pain": v.pain, "conscious": v.conscious(), "dead": v.dead });
            log(w, state);
        })),
    ]
}

// So many frames gone by with nothing drawn (on a software renderer a long wait is otherwise most of a run).
fn dark(frames: u32) -> [Step; 3] {
    let cameras = |on: bool| Step::Do(Box::new(move |w: &mut World| {
        for mut c in w.query::<&mut Camera>().iter_mut(w) {
            c.is_active = on;
        }
    }));
    [cameras(false), Step::Wait(frames), cameras(true)]
}

fn npc(body: &'static str, f: impl Fn(&mut crate::npc::Npc) + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let e = who(w, body);
        crate::npc::with(w, e, |npc| f(npc));
    }))
}

// A cry said now (npc.say), and played and mouthed as sound.rs does with what medicine says in Update: said from a step,
// at the end of the frame, it would be forgotten before sound.rs looks.
fn say(w: &mut World, body: &str, kind: &'static str) {
    let e = who(w, body);
    crate::npc::with(w, e, |npc| npc.say(kind, 1.0, true));
    let head = w.get::<Person>(e).map(|p| p.joints[p.body.by_name["head"]]);
    let playing = w.resource_mut::<Sound>().play(&format!("{kind}-{body}"), crate::sound::Play { gain: 1.0, follow: head, ..default() });
    if let Some(playing) = playing {
        w.resource_mut::<Voices>().0.insert(e, (playing, kind));
    }
}

pub fn scenario() -> Vec<Step> {
    let mut s = vec![Step::Wait(90)];
    let g = "sexton";
    s.extend(close("face_rest", g, 0.0, 0.4));
    // Each cry, caught where its recording is loud (the frames counted from the takes' loudness: scenario log).
    for (kind, wait) in [("scream", 24), ("yell", 14), ("groan", 30), ("cry", 40), ("gasp", 14), ("cough", 10)] {
        s.push(Step::Do(Box::new(move |w: &mut World| say(w, g, kind))));
        s.push(Step::Wait(wait));
        s.extend(close(match kind {
            "scream" => "face_scream",
            "yell" => "face_yell",
            "groan" => "face_groan",
            "cry" => "face_cry",
            "gasp" => "face_gasp",
            _ => "face_cough",
        }, g, 0.0, 0.4));
        s.extend(dark(200));
    }
    // Pain, as it comes.
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let e = who(w, g);
        w.get_mut::<Vitals>(e).unwrap().pain = 0.8;
    })));
    s.push(Step::Wait(20));
    s.extend(close("face_pain", g, 0.0, 0.4));
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let e = who(w, g);
        w.get_mut::<Vitals>(e).unwrap().pain = 0.0;
    })));
    s.extend(dark(300));
    // A blink, shut.
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let e = who(w, g);
        let mut f = w.get_mut::<Face>(e).unwrap();
        f.blink_t = 0.0;
        f.blink_long = 1.0;
    })));
    s.push(Step::Wait(2));
    s.extend(close("face_blink", g, 0.0, 0.4));
    // Looking at the player, who stands to one side.
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let e = who(w, g);
        let mut f = w.get_mut::<Face>(e).unwrap();
        f.gaze.target = Target::Player;
        f.gaze.next = 5.0;
    })));
    s.extend(close("face_look_side", g, 35.0, 0.7));
    s.push(Step::Wait(30));
    s.extend(close("face_look_side", g, 35.0, 0.7));
    // A pellet in the young man's right eye; seen a second and a half on, and a minute on.
    s.push(npc("buyer", |npc| {
        let b = npc.bone_index("eye.R");
        let at = npc.world_of(npc.body().bones[b].head, b, None).0;
        let ahead = npc.segment("head").map_or(Vec3::NEG_Z, |k| npc.segment_world(k).rotation * Vec3::NEG_Z);
        let m = crate::wounds::Missile { name: Some("pellet".into()), ..crate::weapons::arm("shotgun").gun.as_ref().unwrap().m.wounds() };
        crate::wounds::pierce(npc, at + ahead * 0.5 + Vec3::new(0.0, 0.004, 0.0), -ahead, &m, 1.0);
    }));
    s.push(Step::Wait(90));
    s.extend(close("face_eye_pellet", "buyer", 0.0, 0.4));
    s.extend(dark(60 * 20));
    s.extend(close("face_eye_pellet_later", "buyer", 0.0, 0.4));
    // The old man dead: his last breath, and his face half a minute on.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let e = who(w, "oldman");
        let mut v = w.get_mut::<Vitals>(e).unwrap();
        v.dead = true;
        v.brain_damage = 1.0;
    })));
    s.push(Step::Wait(30));
    s.extend(close("face_dying", "oldman", 0.0, 0.5));
    s.extend(dark(60 * 30));
    s.extend(close("face_dead", "oldman", 0.0, 0.5));
    // The man in the hood: a bat into his chin, and his front teeth knocked out.
    s.push(npc("hood", |npc| {
        let ahead = npc.segment("head").map_or(Vec3::NEG_Z, |k| npc.segment_world(k).rotation * Vec3::NEG_Z);
        let jaw = npc.bone_index("jaw");
        let chin = npc.world_of(npc.body().bones[jaw].tail, jaw, None).0;
        if let Some(skin) = npc.surface(chin + ahead * 0.3, -ahead, 0.6, false).into_iter().find(|h| h.kind == crate::npc::Kind::Skin) {
            crate::wounds::blow(npc, skin.point, -ahead, 0.79, 25.0, Some(crate::wounds::Tool::Named("bat")));
        }
        let front: Vec<Vec3> = npc.hurt.teeth.teeth.iter().filter(|t| t.front && t.name.contains("incisor")).map(|t| t.v0).collect::<Vec<_>>()
            .into_iter().map(|v| npc.skinned().at[v as usize]).collect();
        if !front.is_empty() {
            let c = front.iter().sum::<Vec3>() / front.len() as f32;
            npc.teeth().blow(c + ahead * 0.01, -ahead, 2400.0, 0.02, true);
        }
        let hangs = npc.hurt.bones.jaw_hangs;
        let gone: Vec<String> = npc.hurt.teeth.teeth.iter().filter(|t| t.state != crate::teeth::State::Whole).map(|t| format!("{} {:?}", t.name, t.state)).collect();
        info!("hood: jaw hangs {hangs}, teeth {gone:?}");
    }));
    s.push(Step::Wait(60));
    s.extend(close("face_jaw_teeth", "hood", 0.0, 0.45));
    s.extend(close("face_jaw_teeth_side", "hood", 30.0, 0.45));
    s
}
