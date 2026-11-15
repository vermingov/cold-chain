// Muscles: what a person's joints aim for and how hard they pull (src/sandbox/motor.ts).
//
// A pose (poses.rs: joint angles by name, in degrees) is turned into each joint's target the way person.rs would turn
// the skeleton's bones, so the same `kneeL: 90` that bends a posed person's knee bends a ragdoll's, and the joint's
// motors (ragdoll.rs hold) pull toward it with whatever strength the body has left in that limb.
//
// Muscles move a body against itself; to rise, keep upright or drag itself along it has to push on something. The few
// pushes behaviour.rs asks for beyond the joints (lifting the trunk off the floor, staying upright, a hand reaching for
// a wound) are therefore always paid for: what pushes one part pushes another the other way, mostly the limbs that are
// on the floor, so a body with nothing under it cannot lift itself, and one standing on its feet can only keep upright
// as hard as its feet can press.

use bevy::prelude::*;

use crate::person::{Person, RAD};
use crate::poses::{self, Pose};
use crate::ragdoll::Ragdoll;

// s: how slowly a guarded limb's aim follows where it lies
const GUARD: f32 = 0.8;

// Which of the strengths behaviour.rs gives each joint goes by.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Part {
    Trunk,
    Neck,
    ArmL,
    ArmR,
    LegL,
    LegR,
}

impl Part {
    fn of(name: &str) -> Part {
        let right = name.ends_with('R');
        match name {
            "belly" | "chest" => Part::Trunk,
            "head" => Part::Neck,
            _ if name.starts_with("upperarm") || name.starts_with("forearm") || name.starts_with("hand") => if right { Part::ArmR } else { Part::ArmL },
            _ => if right { Part::LegR } else { Part::LegL },
        }
    }

    pub fn arm(side: char) -> Part {
        if side == 'L' { Part::ArmL } else { Part::ArmR }
    }

    pub fn leg(side: char) -> Part {
        if side == 'L' { Part::LegL } else { Part::LegR }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Strength {
    pub trunk: f32,
    pub neck: f32,
    pub arm_l: f32,
    pub arm_r: f32,
    pub leg_l: f32,
    pub leg_r: f32,
}

impl Strength {
    pub fn get(&self, p: Part) -> f32 {
        match p {
            Part::Trunk => self.trunk,
            Part::Neck => self.neck,
            Part::ArmL => self.arm_l,
            Part::ArmR => self.arm_r,
            Part::LegL => self.leg_l,
            Part::LegR => self.leg_r,
        }
    }

    pub fn at(&mut self, p: Part) -> &mut f32 {
        match p {
            Part::Trunk => &mut self.trunk,
            Part::Neck => &mut self.neck,
            Part::ArmL => &mut self.arm_l,
            Part::ArmR => &mut self.arm_r,
            Part::LegL => &mut self.leg_l,
            Part::LegR => &mut self.leg_r,
        }
    }

    pub fn scale(&mut self, k: f32) {
        for p in [Part::Trunk, Part::Neck, Part::ArmL, Part::ArmR, Part::LegL, Part::LegR] {
            *self.at(p) *= k;
        }
    }
}

// One control's turn of one bone: about which axis, and its share of the control's degrees.
#[derive(Clone)]
struct Turn {
    control: String,
    axis: Vec3,
    share: f32,
    order: i32,
}

struct Joint {
    seg: usize,
    part: Part,
    bones: Vec<Vec<Turn>>,
    target: [f32; 3],
    still: Option<[f32; 3]>,
}

pub struct Muscles {
    joints: Vec<Joint>,
    // The finger bones (and the half-turn bones of their joints) and the hand each is on, and every control a finger
    // answers to.
    fingers: Vec<(usize, usize)>,
    controls: Vec<String>,
    curl: String,
    // The fingers' turns, as last posed: they have no bodies, they are posed straight from the pose (ragdoll.rs drive).
    pub hands: Vec<(usize, Quat)>,
}

impl Muscles {
    pub fn new(person: &Person, rd: &Ragdoll) -> Muscles {
        let body = &person.body;
        // Every control that turns each bone, in the order person.apply turns them: twist, out to the side, forward.
        // (Controls of one rank on one bone in the order of their names: the TS's in the order person.ts listed them.)
        let mut turns: Vec<Vec<Turn>> = vec![Vec::new(); body.bones.len()];
        let mut names: Vec<&String> = person.hinges.keys().collect();
        names.sort();
        for control in names {
            let h = &person.hinges[control];
            let share = if h.bones.len() > 1 && !h.fingers { 1.0 / h.bones.len() as f32 } else { 1.0 };
            for (k, &b) in h.bones.iter().enumerate() {
                turns[b].push(Turn { control: control.clone(), axis: h.axes.get(k).copied().unwrap_or(h.axis), share, order: h.order });
            }
        }
        for list in &mut turns {
            list.sort_by_key(|t| t.order);
        }
        let joints = (0..rd.segs.len())
            .filter(|&k| rd.segs[k].def.parent.is_some() && !rd.segs[k].locked)
            .map(|k| Joint {
                seg: k,
                part: Part::of(&rd.segs[k].def.name),
                bones: rd.segs[k].chain.iter().map(|&b| turns[b].clone()).collect(),
                target: [0.0; 3],
                still: None,
            })
            .collect();
        let finger: Vec<usize> = person.hinges.values().filter(|h| h.fingers).flat_map(|h| h.bones.iter().copied()).collect();
        let mut fingers: Vec<(usize, usize)> = Vec::new();
        for &b in finger.iter().chain(person.halves.iter().filter(|(_, p)| finger.contains(p)).map(|(h, _)| h)) {
            if !fingers.iter().any(|f| f.0 == b) {
                let side = if body.bones[b].name.ends_with(".R") { "R" } else { "L" };
                fingers.push((b, rd.by_name(&format!("hand{side}"))));
            }
        }
        let mut controls: Vec<String> = person.hinges.iter().filter(|(_, h)| h.fingers).map(|(c, _)| c.clone()).collect();
        controls.sort();
        Muscles { joints, fingers, controls, curl: String::new(), hands: Vec::new() }
    }

    // The turn a pose gives a run of bones, as person.apply composes it.
    fn turn(bones: &[Vec<Turn>], pose: &Pose) -> Quat {
        let mut out = Quat::IDENTITY;
        for list in bones {
            let mut local = Quat::IDENTITY;
            for t in list {
                let deg = poses::get(pose, &t.control);
                if deg == 0.0 {
                    continue;
                }
                local = Quat::from_axis_angle(t.axis, deg * RAD * t.share) * local;
            }
            out *= local;
        }
        out
    }

    // Every joint pulled toward `pose` with the strength of its part of the body (0 to 1); a joint below a broken bone
    // is left to hang. The parts in `guarded` (a broken limb) are not posed at all: their muscles hold them where they
    // lie, braced against being moved, and let them settle where the floor and their weight put them (an aim that
    // follows the joint over GUARD seconds): moved by the pose, the half above a break swung the half below it about.
    pub fn follow(&mut self, rd: &mut Ragdoll, person: &Person, pose: &Pose, strength: &Strength, guarded: &[Part], dt: f32) {
        for j in &mut self.joints {
            let s = if rd.loose(j.seg) { 0.0 } else { strength.get(j.part) };
            if s > 0.004 && guarded.contains(&j.part) {
                let now = rd.angles(j.seg);
                let still = j.still.get_or_insert(now);
                for i in 0..3 {
                    still[i] += (now[i] - still[i]) * (dt / GUARD).min(1.0);
                }
                let still = *still;
                rd.hold(j.seg, still, s * 0.35);
                continue;
            }
            j.still = None;
            if s > 0.004 {
                j.target = rd.measure(j.seg, Self::turn(&j.bones, pose) * rd.segs[j.seg].unneutral);
                rd.hold(j.seg, j.target, s);
            } else {
                rd.hold(j.seg, j.target, 0.0);
            }
        }
        // (Every control a finger answers to: keyed on the curl and thumb alone, a hand told to cup or to hold its thumb
        // in did not.)
        let mut curl = String::new();
        for c in &self.controls {
            curl += &format!("{},", poses::get(pose, c) as i32);
        }
        if curl != self.curl {
            self.curl = curl;
            let posed = person.apply(pose, None);
            // (A hand cut off keeps the fingers as they were: nothing curls them any more.)
            self.hands.retain(|&(b, _)| self.fingers.iter().any(|&(f, hand)| f == b && rd.cut_off(hand)));
            for &(b, hand) in &self.fingers {
                if !rd.cut_off(hand) {
                    self.hands.push((b, posed.local[b]));
                }
            }
        }
    }
}

// --- pushes the body gives itself ------------------------------------------------------------------------------------

// `force` (N, world) on segment `seg` for `dt`, and the same back on the segments `against`.
pub fn push(rd: &mut Ragdoll, seg: usize, force: Vec3, against: &[usize], dt: f32) {
    if against.is_empty() {
        return;
    }
    let at = rd.middle(seg);
    rd.push(seg, force * dt, at);
    let back = force * (-dt / against.len() as f32);
    for &s in against {
        let at = rd.middle(s);
        rd.push(s, back, at);
    }
}

// `torque` (N m, world) on segment `seg` for `dt`, and the same back on the segments `against`.
pub fn turn(rd: &mut Ragdoll, seg: usize, torque: Vec3, against: &[usize], dt: f32) {
    if against.is_empty() {
        return;
    }
    rd.turn(seg, torque * dt);
    let back = torque * (-dt / against.len() as f32);
    for &s in against {
        rd.turn(s, back);
    }
}

// The whole body swayed as the floor sways it through the feet: every part but `planted` pushed along `accel` (m/s2,
// level) in proportion to its weight and its height over the floor, as if turned about the ankles, so the middle of the
// weight is carried at `accel` and no joint has to pass the push on.
pub fn lean(rd: &mut Ragdoll, accel: Vec3, height: f32, planted: &[usize], dt: f32) {
    for i in 0..rd.attached.len() {
        let seg = rd.attached[i];
        if planted.contains(&seg) {
            continue;
        }
        let at = rd.middle(seg);
        let k = rd.segs[seg].def.mass * dt * at.y.max(0.0) / height;
        rd.push(seg, accel * k, at);
    }
}

// The torque that turns `seg` toward the world turn `want` like a damped spring (`rate`, per second squared, for a body
// of `inertia` kg m2), no more than `most` N m.
// (Damped against `spin` when given: the trunk's as a whole, not one segment's own. A segment's own spin carries the
// quick give between it and its neighbours, and a push worked out from that and given for a whole step overshoots: a
// pelvis damped by its own spin as if it were the whole body was flung one way and the other every step, 0.7 to 1 rad/s
// of buzz standing still, carried down to the feet.)
pub fn toward(rd: &Ragdoll, seg: usize, want: Quat, rate: f32, inertia: f32, most: f32, spin: Option<Vec3>) -> Vec3 {
    let mut q = want * rd.segs[seg].now.rotation.inverse();
    if q.w < 0.0 {
        q = -q;
    }
    let v = Vec3::new(q.x, q.y, q.z);
    let s = v.length();
    let angle = 2.0 * s.atan2(q.w);
    let error = if s > 1e-6 { v * (angle / s) } else { Vec3::ZERO };
    let spin = spin.unwrap_or(rd.segs[seg].spin);
    let out = (error * rate - spin * (2.0 * rate.sqrt())) * inertia;
    let n = out.length();
    if n > most { out * (most / n) } else { out }
}

// The force that carries `seg`'s middle toward `at` like a damped spring (`rate` per second squared) for `mass` kg, no
// more than `most` N. Damped against how `carrier` moves there when given (a hand on a wound of an arm or the trunk,
// which sway: damped against the room, the hand fought every sway of what it held, and the two arms shook each other, 8
// to 16 rad/s).
pub fn reach(rd: &Ragdoll, seg: usize, at: Vec3, rate: f32, mass: f32, most: f32, carrier: Option<usize>) -> Vec3 {
    let here = rd.middle(seg);
    let mut v = rd.segs[seg].vel;
    if let Some(c) = carrier {
        // (The carrier's own velocity at that point: its middle's, and its spin about it.)
        v -= rd.velocity_at(c, here);
    }
    let out = ((at - here) * rate - v * (2.0 * rate.sqrt())) * mass;
    let n = out.length();
    if n > most { out * (most / n) } else { out }
}
