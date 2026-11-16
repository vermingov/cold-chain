// The player's arm (src/table/arm.ts, with fist.ts's dressing of it: ownArm, armOnly, sleeve).
//
// It is a person's arm, on a person's bones (the sexton's, the same body as in the hall), so that fingers close round a
// handle the way fingers do and a wrist turns no further than a wrist can. Only the hand and the forearm are drawn, in
// that person's own skin, and over them the sleeve of a canvas work jacket, made round the arm in code.
//
// The arm is put where what it holds is, and not the other way about. Whatever is held says where it has to be held (a
// grip: a place, the way its handle lies and which way its back faces). The hand is laid on that, the wrist is wherever
// that leaves it, and the elbow is found between the wrist and a shoulder that hangs beside and below the eye.
//
// The whole arm is posed in the eye's own frame, the shoulder turning with the look up and down as well as round, as a
// shooter's arms are drawn: with the shoulder left level, a look at the floor brought the shoulders and upper arms up
// across the view.
//
// Here in Bevy's space: the person's own frame is their mesh's (x to their right, y up, ahead -Z), turned as the eye is.
// The TS's numbers in the eye's frame (z ahead) are brought over by turning z round (`e`).

use std::collections::HashMap;
use std::sync::Arc;

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::NoFrustumCulling;
use bevy::mesh::skinning::{SkinnedMesh, SkinnedMeshInverseBindposes};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;

use crate::person::{absolute, Body, Person, Posed};
use crate::poses::Pose;
use crate::rng::Rng;
use crate::weapons::e;

// Where the shoulder is from the eye, in metres: out to its own side, down, and forward (the TS's eye frame).
const SHOULDER: [f32; 3] = [0.17, 0.24, -0.02];
// The elbow hangs down and out from the line between shoulder and wrist: out, down, forward.
const ELBOW_HANGS: [f32; 3] = [0.5, 1.0, -0.3];
// Where the elbow goes round the line from shoulder to wrist is wherever leaves the wrist straightest: the forearm comes
// in behind the hand the way the hand is turned, so a hand that holds a blade across the body has its arm come round to
// hold it so, and not a wrist bent back on itself. It is looked for `swings` radians at a time, no more than `most`
// either way from where it hangs (an elbow does not go up over the arm), and the elbow comes round to it `eases` of the
// way a frame, never at a jump. (The TS also kept the arm `clear` of a table and the body; the player's arms had none.)
const SWINGS: f32 = 0.15;
const MOST: f32 = 1.8;
const EASES: f32 = 0.2;
const REACH: f32 = 0.985; // of the arm's whole length: it is never drawn quite straight
const LEANS: f32 = 0.6; // a shoulder that leans in goes this far down for each metre forward
const WEB: f32 = 0.014; // metres out on the back of the hand from the bones that a handle rests on the web of the thumb

// How the fingers lie for each thing a hand does, in degrees a joint from the hand at rest (a finger's three joints run
// from the knuckle out; `cup` bends the ring and little metacarpals, the palm closing round what is held; the thumb as
// person.rs's thumbBase, thumbIn and thumb). Each finger's last joint takes about two thirds of its middle one, as the
// tendons couple them.
pub struct Hold {
    index: [f32; 3],
    middle: [f32; 3],
    ring: [f32; 3],
    little: [f32; 3],
    cup: f32,
    thumb_in: f32,
    thumb_base: f32,
    thumb: f32,
}

pub fn hold(name: &str) -> Hold {
    let h = |index, middle, ring, little, cup, thumb_in, thumb_base, thumb| Hold { index, middle, ring, little, cup, thumb_in, thumb_base, thumb };
    match name {
        // A scalpel held as a pen is: on the middle finger, under the index, the thumb's pad against it.
        "pen" => h([46.0, 38.0, 18.0], [56.0, 52.0, 26.0], [70.0, 82.0, 44.0], [76.0, 88.0, 48.0], 5.0, -10.0, 30.0, 15.0),
        // A hand about to take hold: fingers a little curled, the thumb out from them.
        "open" => h([14.0, 16.0, 8.0], [16.0, 18.0, 9.0], [20.0, 22.0, 10.0], [24.0, 24.0, 12.0], 0.0, 5.0, 15.0, 6.0),
        // Flesh taken between the thumb and the first two fingers, the other two tucked away.
        "pinch" => h([40.0, 34.0, 14.0], [48.0, 42.0, 18.0], [72.0, 86.0, 50.0], [78.0, 90.0, 54.0], 6.0, 10.0, 15.0, 15.0),
        // A fist: the fingers rolled tight into the palm, their tips on it, the ring and little metacarpals cupped, the
        // thumb out from the palm and across the middle bones of the first two fingers (bent down into the palm instead,
        // it went in under them).
        "fist" => h([86.0, 100.0, 66.0], [90.0, 104.0, 70.0], [92.0, 106.0, 72.0], [92.0, 106.0, 72.0], 15.0, -30.0, 30.0, 60.0),
        // The rest close round a handle (hands.rs finds the handle's line from where the fingers lie). A gun's grip, about
        // 3 by 5 cm: the last three fingers round it, the index along the frame to the trigger, the thumb down the far side.
        "grip" => h([22.0, 38.0, 16.0], [62.0, 78.0, 50.0], [66.0, 80.0, 52.0], [70.0, 82.0, 54.0], 8.0, 30.0, 10.0, 22.0),
        // The other hand on a gun's grip, round the fingers of the one holding it: all four wrapped, opened wider.
        "support" => h([48.0, 58.0, 34.0], [52.0, 62.0, 38.0], [56.0, 64.0, 40.0], [60.0, 66.0, 42.0], 6.0, 10.0, 15.0, 8.0),
        // A forend or handguard, 4 to 5 cm across, cradled from below: fingers round its far side, the thumb along this one.
        "wrap" => h([36.0, 50.0, 30.0], [40.0, 54.0, 32.0], [44.0, 56.0, 34.0], [48.0, 58.0, 36.0], 5.0, 10.0, 20.0, 8.0),
        // A handle about 3 cm across (knife, sword, bat): a full grip, the index too, the thumb over the fingers.
        "handle" => h([64.0, 84.0, 54.0], [68.0, 88.0, 58.0], [72.0, 90.0, 60.0], [74.0, 92.0, 62.0], 10.0, 25.0, 20.0, 35.0),
        // A ball 6 to 7 cm across (the grenade, the gauze roll): fingers spread round it, the thumb against them.
        "ball" => h([30.0, 40.0, 24.0], [32.0, 42.0, 26.0], [36.0, 44.0, 28.0], [40.0, 46.0, 30.0], 8.0, 30.0, 25.0, 15.0),
        _ => panic!("no hold {name}"),
    }
}

// A hold as a pose a person can be given (the controls' names are person.rs's: index1R, cupR, thumbInR...).
fn finger_pose(h: &Hold, side: char) -> Pose {
    let name = |s: String| -> &'static str { Box::leak(s.into_boxed_str()) };
    let mut pose = Vec::new();
    for (finger, bends) in [("index", h.index), ("middle", h.middle), ("ring", h.ring), ("little", h.little)] {
        for (k, b) in bends.iter().enumerate() {
            pose.push((name(format!("{finger}{}{side}", k + 1)), *b));
        }
    }
    for (n, v) in [("cup", h.cup), ("thumbIn", h.thumb_in), ("thumbBase", h.thumb_base), ("thumb", h.thumb)] {
        pose.push((name(format!("{n}{side}")), v));
    }
    pose
}

// Where a handle (or a fist's knuckles) lies in the closed hand, in the person's own frame, the arm as it was made: a
// point, the way the handle runs, and the hand's turn about it.
#[derive(Clone, Copy)]
pub struct Grasp {
    pub at: Vec3,
    pub along: Vec3,
    pub rotation: Quat,
}

// A hand put on a grip, in the world: where, the way the handle runs from the grip toward the heel of the hand, the way
// the back of the thing faces; and, if given, which side of the line from shoulder to wrist the elbow goes.
pub struct Reach {
    pub at: Vec3,
    pub along: Vec3,
    pub back: Vec3,
    pub elbow: Option<Vec3>,
}

pub struct Arm {
    pub side: char,
    // The person whose arm it is (not in the hall: a Person kept here for its body, its hand's controls and its pose).
    pub person: Person,
    pub root: Entity,
    pub joints: Vec<Entity>,
    pub upper: usize,
    pub fore: usize,
    pub twist: usize,
    pub wrist: usize,
    pub lengths: [f32; 2],
    pub holding: &'static str,
    // Every bone's turn this frame (the fingers' from the hold, the arm's from reach).
    pub local: Vec<Quat>,
    pub grasp: Grasp,
    bent: f32,
    // The shoulder brought this far from where it hangs (the TS's eye frame: out, up, forward).
    pub shift: Vec3,
    pub shown: bool,
    // Where the root is and how it is turned: the person turned as the eye is, their shoulder where a shoulder would be.
    pub at: Transform,
}

impl Arm {
    // A joint of the person in their own frame, as posed now (`tail` its far end).
    pub fn here(&self, name: &str, tail: bool) -> Vec3 {
        let body = &self.person.body;
        let i = body.by_name[&format!("{name}.{}", self.side)];
        let abs = absolute(&body.bones, &self.local);
        let b = &body.bones[i];
        abs[i].1 + abs[i].0 * (if tail { b.tail } else { b.head } - b.head)
    }

    // Close the fingers the way one of the holds says.
    pub fn hold(&mut self, name: &'static str) {
        if self.holding == name {
            return;
        }
        self.holding = name;
        self.local = self.person.apply(&finger_pose(&hold(name), self.side), None).local;
        self.grasp = self.grasp();
    }

    // Where the shoulder hangs in the world: `shift` from where it hangs square to the eye, as a body turned to bring one
    // shoulder forward has it.
    pub fn shoulder(&self, eye: &Transform) -> Vec3 {
        let sign = if self.side == 'R' { 1.0 } else { -1.0 };
        let s = self.shift;
        eye.transform_point(e(Vec3::new(sign * (SHOULDER[0] + s.x), s.y - SHOULDER[1], SHOULDER[2] + s.z)))
    }

    // A grip of the world in the person's own frame: where, and turned how.
    fn inside(&self, at: Vec3, along: Vec3, back: Vec3) -> (Vec3, Quat) {
        let home = self.at.rotation.inverse();
        let (x, y) = (home * along, home * back);
        (home * (at - self.at.translation), Quat::from_mat3(&Mat3::from_cols(x, y, x.cross(y))))
    }

    // The person turned as the eye is, their shoulder where a shoulder would be.
    fn stand(&mut self, eye: &Transform) {
        let upper = self.person.body.bones[self.upper].head;
        self.at.rotation = eye.rotation;
        self.at.translation = self.shoulder(eye) - eye.rotation * upper;
    }

    // Put the hand on a grip; with None, take the arm away. Given `elbow`, the elbow goes round to that side of the line
    // from shoulder to wrist at once, rather than easing round to where it leaves the wrist straightest (a fist that has
    // worked out its own arm: fist.rs).
    pub fn reach(&mut self, grip: Option<Reach>, eye: &Transform) {
        self.shown = grip.is_some();
        let Some(grip) = grip else { return };
        self.stand(eye);
        let bones = &self.person.body.bones;
        let (upper, fore, wrist) = (bones[self.upper].head, bones[self.fore].head, bones[self.wrist].head);
        let [a, b] = self.lengths;

        // From here on, in the person's own frame. The hand is turned so its grasp lies on the grip, which says where the
        // wrist is.
        let (gat, grot) = self.inside(grip.at, grip.along, grip.back);
        let hand = grot * self.grasp.rotation.inverse();
        let mut at = gat - hand * (self.grasp.at - wrist);
        // Too far to reach, and they lean in: the shoulder goes with it, and it goes down as it goes forward (it does not
        // come up into the eye's way).
        let far = at.distance(upper);
        let most = (a + b) * REACH;
        if far > most {
            let toward = at - upper;
            let level = Vec3::new(toward.x, 0.0, toward.z);
            let bend = (level + Vec3::new(0.0, -level.length() * LEANS, 0.0)).normalize();
            let along = toward.dot(bend);
            let off = (toward - bend * along).length();
            let lean = bend * (along - (most * most - off * off).max(0.0).sqrt()).max(0.0);
            self.at.translation += self.at.rotation * lean;
            at -= lean;
        }

        // The elbow: the one place that is `a` from the shoulder and `b` from the wrist, on the side it hangs.
        let line = at - upper;
        let reach = line.length();
        let toward = line / reach;
        let sign = if self.side == 'R' { 1.0 } else { -1.0 };
        let hangs = e(Vec3::new(ELBOW_HANGS[0] * sign, -ELBOW_HANGS[1], ELBOW_HANGS[2]));
        let aside = (hangs - toward * hangs.dot(toward)).normalize();
        let near = (a * a + reach * reach - b * b) / (2.0 * reach);
        let round = (a * a - near * near).max(0.0).sqrt();
        let elbow_at = |turn: f32| upper + toward * near + aside * (turn.cos() * round) + toward.cross(aside) * (turn.sin() * round);
        let turn = match grip.elbow {
            Some(el) => {
                let p = self.inside(el, Vec3::X, Vec3::Y).0 - (upper + toward * near);
                self.bent = p.dot(toward.cross(aside)).atan2(p.dot(aside));
                self.bent
            }
            None => {
                // (Where the forearm would run if the wrist were straight: the way the hand is turned, carried on up the arm.)
                let forearm = hand * (wrist - fore).normalize();
                let straight = |turn: f32| (at - elbow_at(turn)).normalize().dot(forearm);
                let (mut chosen, mut truest) = (0.0, f32::NEG_INFINITY);
                let mut t = -MOST;
                while t <= MOST {
                    let s = straight(t);
                    if s > truest {
                        truest = s;
                        chosen = t;
                    }
                    t += SWINGS;
                }
                self.bent += (chosen - self.bent) * EASES;
                self.bent
            }
        };
        let elbow = elbow_at(turn);

        // The upper arm swings to point at it, the forearm bends on from there to the wrist.
        let swing = Quat::from_rotation_arc((fore - upper).normalize(), (elbow - upper).normalize());
        let lies = (wrist - fore).normalize();
        let bend = Quat::from_rotation_arc((swing * lies).normalize(), (at - elbow).normalize());
        let forearm = bend * swing;
        // What is left over is the wrist's, except the part that is a turn about the forearm itself: that is the two bones
        // of the forearm rolling over each other, from nothing at the elbow to all of it at the wrist. Half is put on each
        // of the forearm's two bones (all of it on the second wrung the skin between them thin, like a sweet's wrapper).
        let left = forearm.inverse() * hand;
        let about = Vec3::new(left.x, left.y, left.z).dot(lies);
        let roll = if about.hypot(left.w) < 1e-4 { Quat::IDENTITY } else { Quat::from_xyzw(lies.x * about, lies.y * about, lies.z * about, left.w).normalize() };
        let half = Quat::IDENTITY.slerp(roll, 0.5);
        self.local[self.upper] = swing;
        self.local[self.fore] = swing.inverse() * forearm * half;
        self.local[self.twist] = half;
        self.local[self.wrist] = roll.inverse() * left;
    }

    // Where a handle lies in the closed hand, with the arm as it was made: held at the tips of the thumb and the first two
    // fingers, and running back from there over the web of the thumb, the index finger on top of it. The bones run down
    // the middle of the fingers, and a handle lies on the skin: so it rests on the web, not in it, WEB metres out on the
    // back of the hand from the bones there.
    fn grasp(&self) -> Grasp {
        let here = |n: &str, tail: bool| self.here(n, tail);
        let (thumb, index, middle) = (here("finger1-3", true), here("finger2-3", true), here("finger3-3", true));
        let tips = (thumb + index + middle) / 3.0;
        // The back of the hand: away from where the last two fingers curl to.
        let knuckles = (here("finger4-1", false) + here("finger5-1", false)) / 2.0;
        let curled = (here("finger4-3", true) + here("finger5-3", true)) / 2.0;
        let forward = (knuckles - here("wrist", false)).normalize();
        let palm = curled - knuckles;
        let dorsal = -(palm - forward * palm.dot(forward)).normalize();
        let web = here("finger2-1", false).lerp(here("finger1-2", false), 0.35) + dorsal * WEB;
        let along = (web - tips).normalize();
        let over = index - tips;
        let back = (over - along * over.dot(along)).normalize();
        Grasp { at: tips, along, rotation: Quat::from_mat3(&Mat3::from_cols(along, back, along.cross(back))) }
    }
}

// What the player wears on the arms: a canvas work jacket. Its sleeve hangs `loose` m off the skin (upper arm, forearm)
// and ends `cuff` m short of the wrist in a hem `band` m long and `hem` m proud of the sleeve, its edge turned in `turn` m
// thick; above the hem the cloth gathers in shallow folds `fold` m deep. It is made `around` corners round, a ring every
// `step` m.
struct Sleeve {
    colour: [f32; 3],
    rough: f32,
    loose: [f32; 2],
    cuff: f32,
    band: f32,
    hem: f32,
    turn: f32,
    fold: f32,
    around: usize,
    step: f32,
}
const SLEEVE: Sleeve = Sleeve { colour: [0.24, 0.23, 0.2], rough: 0.85, loose: [0.011, 0.008], cuff: 0.03, band: 0.035, hem: 0.003, turn: 0.004, fold: 0.0012, around: 32, step: 0.008 };

// A bone's name with the middle bones (ragdoll.rs `with_mid_bones`) counted as the bones they halve.
fn plain(name: &str) -> &str {
    name.strip_prefix("mid-").unwrap_or(name)
}

// Each corner's bone: the one it hangs on most.
fn owners(body: &Body) -> Vec<usize> {
    body.weights.iter().zip(&body.joints).map(|(w, j)| {
        let k = (0..4).max_by_key(|&k| w[k]).unwrap();
        j[k] as usize
    }).collect()
}

// The person's own skin cut down to one arm's: only the hand and the wrist, and the forearm as far into the sleeve as can
// be seen up it (the rest is under the sleeve, and came out through it where the forearm turned). A mesh a skin part.
fn arm_only(body: &Body, side: char) -> Vec<(usize, Mesh)> {
    let wrist = body.bone(&format!("wrist.{side}")).head;
    let own = owners(body);
    let mine: Vec<bool> = own
        .iter()
        .enumerate()
        .map(|(i, &o)| {
            let name = plain(&body.bones[o].name);
            let arm = ["lowerarm", "wrist", "metacarpal", "finger"].iter().any(|p| name.starts_with(p)) && name.ends_with(&format!(".{side}"));
            arm && (!name.starts_with("lowerarm") || body.position[i].distance(wrist) < SLEEVE.cuff + 0.05)
        })
        .collect();
    let mut out = Vec::new();
    for (k, p) in body.parts.iter().enumerate() {
        if p.under || p.kind != "skin" {
            continue;
        }
        let tris: Vec<u32> = body.index[p.index_start..p.index_start + p.index_count]
            .chunks_exact(3)
            .filter(|t| t.iter().all(|&i| mine[i as usize]))
            .flatten()
            .copied()
            .collect();
        if tris.is_empty() {
            continue;
        }
        // Its own corners, renumbered.
        let mut map = HashMap::new();
        let mut corners = Vec::new();
        let index: Vec<u32> = tris.iter().map(|&i| *map.entry(i).or_insert_with(|| {
            corners.push(i as usize);
            corners.len() as u32 - 1
        })).collect();
        let mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, corners.iter().map(|&i| body.position[i]).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, corners.iter().map(|&i| body.normal[i]).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, corners.iter().map(|&i| body.uv[i]).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, bevy::mesh::VertexAttributeValues::Uint16x4(corners.iter().map(|&i| body.joints[i]).collect()))
            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, corners.iter().map(|&i| body.weights[i].map(|x| x as f32 / 255.0)).collect::<Vec<[f32; 4]>>())
            .with_inserted_indices(Indices::U32(index));
        out.push((k, mesh));
    }
    out
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

// The player's sleeve, made round the arm as it was made: a tube along the bones from high on the upper arm (behind the
// eye) to the cuff, each ring of it laid round the arm's own skin there (out to the furthest of that skin each way round,
// as cloth lies across the hollows of an arm, not into them) and the rings eased into each other, so it is smooth however
// coarse the skin under it. The cuff's edge is turned in, so it has a thickness and is not seen into. Each corner hangs
// on the bones the skin nearest it hangs on, and so bends at the elbow and turns with the forearm as the skin does; but
// only on the arm's own bones: the arm is posed alone, the shoulder and chest left as made, and a sleeve made of the
// skin itself, partly on the collarbone over the shoulder, was stretched out into grey flaps across the view when the
// arm came up.
fn sleeve(body: &Body, side: char) -> Mesh {
    let n = SLEEVE.around;
    let own = owners(body);
    let arm_bone = |name: &str| {
        let p = plain(name);
        (p.starts_with("upperarm") || p.starts_with("lowerarm")) && p.ends_with(&format!(".{side}")) && p[..p.len() - 2].trim_start_matches(|c: char| c.is_ascii_alphabetic()).chars().all(|c| c.is_ascii_digit())
    };
    let keeps = |name: &str| arm_bone(name) || plain(name) == format!("wrist.{side}");
    let skin: Vec<usize> = (0..body.position.len()).filter(|&i| arm_bone(&body.bones[own[i]].name)).collect();
    let bone = |name: &str| body.bone(&format!("{name}.{side}"));
    let upper_index = body.by_name[&format!("upperarm01.{side}")] as u16;

    // The line it runs along: a fifth of the way down the upper arm, the elbow, and the cuff short of the wrist.
    let (elbow, wrist) = (bone("lowerarm01").head, bone("wrist").head);
    let top = bone("upperarm01").head.lerp(elbow, 0.2);
    let end = wrist + (elbow - wrist).normalize() * SLEEVE.cuff;
    let upper = top.distance(elbow);
    let length = upper + elbow.distance(end);
    let count = (length / SLEEVE.step).ceil() as usize;
    let (d1, d2) = ((elbow - top).normalize(), (end - elbow).normalize());
    // Each ring: its centre (the skin's middle there), the way the arm runs, two ways across it, and how far out the skin
    // reaches each way round from the centre.
    struct Ring {
        c: Vec3,
        d: Vec3,
        u: Vec3,
        v: Vec3,
        s: f32,
        reach: Vec<f32>,
    }
    let mut rings: Vec<Ring> = Vec::new();
    let mut u = d1.cross(Vec3::NEG_Z).normalize();
    for k in 0..=count {
        let s = k as f32 / count as f32 * length;
        let bend = ((s - upper + 0.03) / 0.06).clamp(0.0, 1.0);
        let c = if s < upper { top + d1 * s } else { elbow + d2 * (s - upper) };
        let d = d1.lerp(d2, bend * bend * (3.0 - 2.0 * bend)).normalize();
        u = (u - d * u.dot(d)).normalize();
        let v = d.cross(u);
        let near: Vec<Vec3> = skin.iter().map(|&i| body.position[i]).filter(|p| (*p - c).dot(d).abs() < 0.012).map(|p| {
            let r = p - c;
            r - d * r.dot(d)
        }).collect();
        let mid = near.iter().fold(Vec3::ZERO, |m, r| m + *r) / near.len().max(1) as f32;
        let reach = (0..n).map(|i| {
            let a = std::f32::consts::TAU * i as f32 / n as f32;
            let w = u * a.cos() + v * a.sin();
            near.iter().fold(0.0f32, |most, r| most.max((*r - mid).dot(w)))
        }).collect();
        rings.push(Ring { c: c + mid, d, u, v, s, reach });
    }
    // Eased: each ring and each way round toward its neighbours, a few times over.
    for _ in 0..4 {
        let was: Vec<(Vec3, Vec<f32>)> = rings.iter().map(|r| (r.c, r.reach.clone())).collect();
        let last = rings.len() - 1;
        for (k, r) in rings.iter_mut().enumerate() {
            let (a, me, b) = (&was[k.saturating_sub(1)], &was[k], &was[(k + 1).min(last)]);
            r.c = (a.0 + me.0 * 2.0 + b.0) * 0.25;
            r.reach = (0..n).map(|i| (a.1[i] + b.1[i] + me.1[(i + n - 1) % n] + me.1[(i + 1) % n] + 4.0 * me.1[i]) / 8.0).collect();
        }
    }

    // The cloth: loose off the skin, the hem standing proud over its last few centimetres, folds gathered above it.
    let hem_at = length - SLEEVE.band;
    let out = |r: &Ring, i: usize| {
        let a = std::f32::consts::TAU * i as f32 / n as f32;
        let s = r.s;
        let folds = SLEEVE.fold * smoothstep(upper, upper + 0.06, s) * (1.0 - smoothstep(hem_at - 0.02, hem_at, s))
            * (std::f32::consts::TAU * s / 0.06 + 1.3 * (2.0 * a + s * 25.0).sin()).sin();
        r.reach[i] + SLEEVE.loose[0] + (SLEEVE.loose[1] - SLEEVE.loose[0]) * smoothstep(upper - 0.05, upper + 0.05, s) + SLEEVE.hem * smoothstep(hem_at - 0.004, hem_at, s) + folds
    };
    let round = |r: &Ring, i: usize, radius: f32, ahead: f32| {
        let a = std::f32::consts::TAU * i as f32 / n as f32;
        r.c + r.d * ahead + r.u * (a.cos() * radius) + r.v * (a.sin() * radius)
    };
    let mut loops: Vec<Vec<Vec3>> = rings.iter().map(|r| (0..n).map(|i| round(r, i, out(r, i), 0.0)).collect()).collect();
    // Over the edge in a half round and back inside the hem, `turn` in from its outside.
    let last = rings.last().unwrap();
    let lip = SLEEVE.turn / 2.0;
    for t in 1..=4 {
        let q = t as f32 / 4.0 * std::f32::consts::PI;
        loops.push((0..n).map(|i| round(last, i, out(last, i) - lip * (1.0 - q.cos()), lip * q.sin())).collect());
    }
    for back in [0.008, 0.025] {
        let r = &rings[((length - back) / (length / count as f32)).round().max(0.0) as usize];
        loops.push((0..n).map(|i| round(r, i, out(last, i) - SLEEVE.turn, 0.0)).collect());
    }

    let mut positions = Vec::new();
    let mut joints = Vec::new();
    let mut weights = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for (k, lp) in loops.iter().enumerate() {
        for p in lp {
            positions.push(*p);
            // On the bones of the nearest skin, whatever of it hangs on the shoulder or the chest given to the upper arm.
            let best = *skin.iter().min_by(|&&i, &&j| body.position[i].distance_squared(*p).total_cmp(&body.position[j].distance_squared(*p))).unwrap();
            let j = body.joints[best];
            joints.push(j.map(|b| if keeps(&body.bones[b as usize].name) { b } else { upper_index }));
            weights.push(body.weights[best].map(|w| w as f32 / 255.0));
        }
        if k == 0 {
            continue;
        }
        let (a, b) = ((k - 1) * n, k * n);
        for i in 0..n {
            let j = (i + 1) % n;
            indices.extend([a + i, b + i, b + j, a + i, b + j, a + j].map(|x| x as u32));
        }
    }
    // (Wound so that its outside is the side drawn: Bevy's front faces are counter-clockwise, seen from outside.)
    let probe = loops[1][0] - rings[1].c;
    let face = |t: &[u32]| (positions[t[1] as usize] - positions[t[0] as usize]).cross(positions[t[2] as usize] - positions[t[0] as usize]);
    if face(&indices[n * 6..n * 6 + 3]).dot(probe) < 0.0 {
        for t in indices.chunks_exact_mut(3) {
            t.swap(1, 2);
        }
    }
    // How the sleeve faces, for the log: the share of the tube's corners whose normal points away from the arm's line.
    let radial: Vec<Vec3> = (0..rings.len()).flat_map(|k| (0..n).map(move |i| (k, i))).map(|(k, i)| loops[k][i] - rings[k].c).collect();
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, bevy::mesh::VertexAttributeValues::Uint16x4(joints))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, weights)
        .with_inserted_indices(Indices::U32(indices));
    // (Weighted by area: the smooth normals normalise each face's own first, and a face of no area, which the turned-in
    // hem can make, gave NaN to every corner round it.)
    mesh.compute_area_weighted_normals();
    if let Some(bevy::mesh::VertexAttributeValues::Float32x3(normals)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        let out = radial.iter().enumerate().filter(|(i, r)| Vec3::from(normals[*i]).dot(**r) > 0.0).count();
        info!("sleeve {side}: {} corners, {:.0}% of the tube's facing out", normals.len(), 100.0 * out as f32 / radial.len() as f32);
    }
    mesh
}

// One of the player's arms (`side` 'R' or 'L'): the sexton's arm in his own skin and the jacket's sleeve, closed as `hold`.
#[allow(clippy::too_many_arguments)]
pub fn own_arm(
    commands: &mut Commands,
    body: &Arc<Body>,
    side: char,
    hold_name: &'static str,
    assets: &AssetServer,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    bindposes: &mut Assets<SkinnedMeshInverseBindposes>,
    rng: &mut Rng,
) -> Arm {
    let hinges = crate::person::calibrate(body, rng);
    // Every finger joint's half-turn bone and the phalanx it halves (person.rs `is_half`).
    let halves = body
        .bones
        .iter()
        .enumerate()
        .filter(|(_, b)| b.name.starts_with("finger") && b.name.len() > 10 && &b.name[9..11] == "h.")
        .map(|(i, b)| (i, body.by_name[&b.name.replacen("h.", ".", 1)]))
        .collect();
    let root = commands.spawn((Transform::default(), Visibility::Hidden, Name::new(format!("arm {side}")))).id();
    let mut joints: Vec<Entity> = Vec::with_capacity(body.bones.len());
    for b in &body.bones {
        let (parent, from) = match b.parent {
            Some(p) => (joints[p], body.bones[p].head),
            None => (root, Vec3::ZERO),
        };
        joints.push(commands.spawn((Transform::from_translation(b.head - from), Visibility::default(), ChildOf(parent))).id());
    }
    let skin = SkinnedMesh {
        inverse_bindposes: bindposes.add(SkinnedMeshInverseBindposes::from(body.bones.iter().map(|b| Mat4::from_translation(-b.head)).collect::<Vec<_>>())),
        joints: joints.clone(),
    };
    for (k, mesh) in arm_only(body, side) {
        let p = &body.parts[k];
        let material = materials.add(StandardMaterial {
            base_color_texture: p.texture.as_ref().map(|t| assets.load(format!("people/{}", t.file))),
            metallic: 0.0,
            perceptual_roughness: 0.52,
            reflectance: 0.5 * 0.55f32.sqrt(),
            ..default()
        });
        commands.spawn((Mesh3d(meshes.add(mesh)), MeshMaterial3d(material), skin.clone(), NoFrustumCulling, ChildOf(root), Name::new("arm skin")));
    }
    let [r, g, b] = SLEEVE.colour;
    let cloth = materials.add(StandardMaterial { base_color: Color::linear_rgb(r, g, b), metallic: 0.0, perceptual_roughness: SLEEVE.rough, ..default() });
    commands.spawn((Mesh3d(meshes.add(sleeve(body, side))), MeshMaterial3d(cloth), skin, NoFrustumCulling, ChildOf(root), Name::new("sleeve")));

    let pelvis = body.bone("root").head;
    let person = Person {
        body: body.clone(),
        label: format!("arm {side}"),
        height: body.height,
        mass: 0.0,
        hinges,
        halves,
        pose: Vec::new(),
        posed: Posed { local: vec![Quat::IDENTITY; body.bones.len()], frame: Transform::from_translation(pelvis) },
        frame: root,
        joints: joints.clone(),
        parts: Vec::new(),
        insides: Entity::PLACEHOLDER,
        segments: Vec::new(),
    };
    let idx = |n: &str| body.by_name[&format!("{n}.{side}")];
    let (upper, fore, twist, wrist) = (idx("upperarm01"), idx("lowerarm01"), idx("lowerarm02"), idx("wrist"));
    let lengths = [body.bones[upper].head.distance(body.bones[fore].head), body.bones[fore].head.distance(body.bones[wrist].head)];
    let mut arm = Arm {
        side, person, root, joints, upper, fore, twist, wrist, lengths, holding: "", local: vec![Quat::IDENTITY; body.bones.len()],
        grasp: Grasp { at: Vec3::ZERO, along: Vec3::X, rotation: Quat::IDENTITY }, bent: 0.0, shift: Vec3::ZERO, shown: false, at: Transform::default(),
    };
    arm.hold(hold_name);
    arm
}

// Each arm's bones and root to where its pose puts them, every frame.
pub fn draw(arm: &Arm, transforms: &mut Query<&mut Transform, Without<crate::player::Player>>, vis: &mut Query<&mut Visibility>) {
    if let Ok(mut v) = vis.get_mut(arm.root) {
        let want = if arm.shown { Visibility::Inherited } else { Visibility::Hidden };
        if *v != want {
            *v = want;
        }
    }
    if !arm.shown {
        return;
    }
    if let Ok(mut t) = transforms.get_mut(arm.root) {
        *t = arm.at;
    }
    for (i, &j) in arm.joints.iter().enumerate() {
        if let Ok(mut t) = transforms.get_mut(j) {
            if t.rotation != arm.local[i] {
                t.rotation = arm.local[i];
            }
        }
    }
}
