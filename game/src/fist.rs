// The player's fists, drawn while they are held up (weapons.rs 'fists'): one for each arm, the left mouse button the
// left's and the right the right's (src/sandbox/fist.ts).
//
// A person's arm (arm.rs: a person's bones, the hand closed into a fist, the elbow found between a shoulder beside and
// below the eye and the wrist), in that person's own skin and sleeve. What is moved is the knuckles. Between punches the
// fist is up in a guard beside the jaw. A press winds it up: it is drawn back and down toward its shoulder, that
// shoulder taken back and the body turned away from the punch, the view leaning with it, further the longer it is held,
// to a second. Let go, it is driven straight out from its own side of the chin, the shoulder and the body turning in
// behind it, and turns over from upright to most of the way flat as it goes; a tap is a jab, thrown from the guard with
// the arm alone. It lands on the first skin its knuckles cross on the way (`punch`: where the fist is, not where the eye
// looks), with the speed it is going and the mass behind it. What it lands on stops it there and it comes back off it to
// the guard; a miss carries it on to the end of the arm and is pulled back slower.
//
// The TS's numbers are in its eye frame (x right, y up, z ahead), brought over where they meet the world (weapons::e).

use bevy::prelude::*;
use serde_json::json;

use crate::arm::{Arm, Grasp, Reach};
use crate::hands::Arms;
use crate::person::Person;
use crate::player::Player;
use crate::sound::{Play, Sound};
use crate::weapons::{e, Kind, Weapons};

// How hard (dev/research/blunt-trauma.md): Olympic boxers' straight punches land at 9.1 +- 2.1 m/s with an effective mass
// of 2.9 kg and 3427 N peak (Walilko05); a jab, thrown from the guard with the arm alone, at about 6 m/s with the fist and
// forearm's 1.5 kg or so, lands at 1 to 2 kN. A full wind-up is taken as the boxer's straight: the hips and shoulder put
// the body's mass behind the fist and speed it up. In between, by how long it was wound up (`WIND` s).
const JAB: (f32, f32) = (6.0, 1.5);
const FULL: (f32, f32) = (10.0, 2.9);
const WIND: f32 = 1.0;

// The knuckles, in the eye's frame (mirrored for the left fist, which is held a little further out in front, the lead
// hand), m.
const GUARD_R: Vec3 = Vec3::new(0.11, -0.08, 0.27);
const GUARD_L: Vec3 = Vec3::new(0.1, -0.07, 0.31);
const DRAWN: Vec3 = Vec3::new(0.17, -0.17, 0.12); // wound all the way up: back and down toward the shoulder
const LINE: Vec3 = Vec3::new(0.05, -0.06, 0.0); // where it is driven out from, straight ahead: its own side of the chin
const MISS: f32 = 0.6; // m ahead of the eye: the arm's end, nothing met
const HANGS: Vec3 = Vec3::new(0.3, -1.0, -0.15); // the way the elbow is off the line from shoulder to fist: down, a little out
// The body's turn (`body`, -1 wound fully away to 1 driven fully in): the punching shoulder that far back or forward (m,
// as Arm::shift: out, up, ahead), and the view's yaw and lean with it (rad).
const AWAY: Vec3 = Vec3::new(0.0, -0.015, -0.06);
const INTO: Vec3 = Vec3::new(-0.03, 0.0, 0.08);
const LEAN: (f32, f32) = (0.025, 0.015);
// What it lands with: how far the fist and arm give (N/m). Taken so that on a face (bones.rs: the bone's pad in series,
// the head's mass behind it) a jab lands with about 1.2 kN and a full wind-up with about 2.6 kN.
pub const FIST_GIVES: f32 = 5e4;

#[derive(Clone, Copy)]
enum Ease {
    Smooth,
    // Fastest at two thirds of the way, still moving when it gets there.
    Drive,
    Off,
    Onto,
}

fn ease(e: Ease, u: f32) -> f32 {
    match e {
        Ease::Smooth => u * u * (3.0 - 2.0 * u),
        Ease::Drive => u * u * (2.0 - u),
        Ease::Off => 1.0 - (1.0 - u) * (1.0 - u),
        Ease::Onto => u * u,
    }
}

#[derive(Clone, Copy)]
struct Key {
    at: Vec3,
    t: f32,
    turn: f32,
    body: f32,
    ease: Ease,
}

#[derive(Clone)]
pub struct Fist {
    side: char,
    keys: Vec<Key>,
    t: f32,
    wind: f32,
    up: bool,
    at: Vec3,
    turn: f32,
    body: f32,
    contact: f32,
    pub speed: f32,
    pub mass: f32,
    pub flying: bool,
    was: Option<Vec3>,
    hand: f32,
}

impl Fist {
    fn new(side: char, hand: f32) -> Self {
        let mut f = Fist { side, keys: Vec::new(), t: -1.0, wind: -1.0, up: false, at: Vec3::ZERO, turn: 0.25, body: 0.0, contact: -1.0, speed: 0.0, mass: 0.0,
                           flying: false, was: None, hand };
        f.at = f.guard();
        f
    }

    // A point of the right fist's frame, as this fist's.
    fn mine(&self, v: Vec3) -> Vec3 {
        if self.side == 'R' { v } else { Vec3::new(-v.x, v.y, v.z) }
    }

    fn guard(&self) -> Vec3 {
        if self.side == 'R' { GUARD_R } else { Vec3::new(-GUARD_L.x, GUARD_L.y, GUARD_L.z) }
    }

    // Where the knuckles are, in the world.
    fn knuckles(&self, eye: &Transform) -> Vec3 {
        eye.transform_point(e(self.at))
    }

    // How far wound up, 0 (a tap: a jab) to 1 (held a second).
    pub fn charge(&self) -> f32 {
        if self.wind < 0.0 { 0.0 } else { ((self.wind - 0.08) / (WIND - 0.08)).clamp(0.0, 1.0) }
    }

    // Let go: thrown, straight out from its own side of the chin to the end of the arm, unless it meets something first
    // (stop_at).
    fn let_go(&mut self) -> Option<f32> {
        if self.wind < 0.0 {
            return None;
        }
        let c = self.charge();
        let line = self.mine(LINE);
        self.wind = -1.0;
        let to = Vec3::new(line.x, line.y, MISS);
        let far = self.at.distance(to);
        self.speed = JAB.0 + (FULL.0 - JAB.0) * c;
        self.mass = JAB.1 + (FULL.1 - JAB.1) * c;
        // At its speed through the end (drive() is fastest two thirds of the way and goes on at its mean speed).
        let go = (far / self.speed).clamp(0.05, 0.2);
        self.keys = vec![
            Key { at: self.at, t: 0.0, turn: self.turn, body: self.body, ease: Ease::Smooth },
            Key { at: to, t: go, turn: 1.0, body: 0.4 + 0.6 * c, ease: Ease::Drive },
        ];
        self.contact = go;
        self.t = 0.0;
        self.flying = true;
        Some(c)
    }

    fn update(&mut self, dt: f32, clock: f32) {
        if !self.up {
            return;
        }
        if self.wind >= 0.0 {
            // Wound up: drawn back, eased toward how far it is wound, the body turned away with it.
            self.wind += dt;
            let c = ease(Ease::Smooth, self.charge());
            let k = (dt * 12.0).min(1.0);
            let toward = self.guard().lerp(self.mine(DRAWN), c);
            self.at = self.at.lerp(toward, k);
            self.turn += (0.1 - self.turn) * k;
            self.body += (-c - self.body) * k;
        } else if self.t >= 0.0 {
            self.t += dt;
            if self.flying && self.t >= self.contact {
                self.landed(None);
            }
            let last = *self.keys.last().unwrap();
            if self.t >= last.t {
                self.t = -1.0;
                self.at = last.at;
                self.turn = last.turn;
                self.body = last.body;
            } else {
                let mut k = 1;
                while self.keys[k].t <= self.t {
                    k += 1;
                }
                let (a, b) = (self.keys[k - 1], self.keys[k]);
                let u = ease(b.ease, (self.t - a.t) / (b.t - a.t));
                self.at = a.at.lerp(b.at, u);
                self.turn = a.turn + (b.turn - a.turn) * u;
                self.body = a.body + (b.body - a.body) * u;
            }
        } else {
            // In the guard, breathing.
            let breath = (clock / 0.7 + if self.side == 'R' { 0.0 } else { 1.3 }).sin();
            let k = (dt * 8.0).min(1.0);
            self.at = self.at.lerp(self.guard() + Vec3::new(0.0, breath * 0.003, 0.0), k);
            self.turn += (0.25 - self.turn) * k;
            self.body *= (1.0 - dt * 8.0).max(0.0);
        }
    }

    // The view's turn with the body (rad, the TS's signs): yaw, roll. The body turns away from a wound-up fist and into it
    // as it goes out.
    fn lean(&self) -> (f32, f32) {
        let sign = if self.side == 'R' { 1.0 } else { -1.0 };
        (-sign * self.body * LEAN.0, sign * self.body * LEAN.1)
    }

    // At the target: stopped at the skin it met (where it was aimed, or a little nearer or further if they moved), held
    // there a moment and back off it; or, nothing there, on to the end of the arm, the shoulder pulled after it, and
    // slowly back. (Stopped at the skin and not on into it: the face is not dented under it, and knuckles going on two
    // centimetres into an undented face read as a fist passing through a head.)
    fn landed(&mut self, at: Option<Vec3>) {
        self.flying = false;
        let t = self.contact;
        let guard = self.guard();
        self.keys.truncate(2);
        let hit = self.keys[1];
        match at {
            Some(at) => {
                self.keys[1].at = at;
                self.keys.push(Key { at, t: t + 0.035, turn: 1.0, body: hit.body, ease: Ease::Off });
                self.keys.push(Key { at: guard, t: t + 0.3, turn: 0.25, body: 0.0, ease: Ease::Smooth });
            }
            None => {
                let on = hit.at + (hit.at - self.keys[0].at).normalize() * 0.03;
                self.keys.push(Key { at: on, t: t + 0.07, turn: 1.1, body: hit.body * 1.1, ease: Ease::Off });
                self.keys.push(Key { at: guard, t: t + 0.45, turn: 0.25, body: 0.0, ease: Ease::Onto });
            }
        }
    }

    // Stopped where it met something (a point of the world, where the knuckles crossed its skin), now.
    fn stop_at(&mut self, point: Vec3, eye: &Transform) {
        if !self.flying {
            return;
        }
        let at = e(eye.compute_affine().inverse().transform_point3(point));
        // (The way here from the start as it was, ending now, at the skin.)
        self.keys[1] = Key { at, t: self.t, turn: self.turn, body: self.body, ..self.keys[1] };
        self.contact = self.t;
        self.landed(Some(at));
        self.at = at;
    }

    // The knuckles to `at`, the fist turned `turn` of the way over from upright (its back outward) to most of the way flat
    // (its back up). The arm is its own shoulder's: the elbow where an arm of that length from there puts it, a little
    // down and out from the line to the fist; and the wrist kept straight, the knuckles in line with the forearm, so that
    // the fist turns over by the forearm rolling (a hand aimed by itself bent the wrist back and left the hand hanging
    // off it).
    fn pose(&self, arm: &mut Arm, eye: &Transform) {
        let a = self.turn * 1.1;
        let sign = if self.side == 'R' { 1.0 } else { -1.0 };
        let at = self.knuckles(eye);
        let shoulder = arm.shoulder(eye);
        let [upper, fore] = arm.lengths;
        let rest = fore + self.hand;
        let line = at - shoulder;
        let toward = line.normalize();
        let far = line.length().min((upper + rest) * 0.985);
        let near = (upper * upper + far * far - rest * rest) / (2.0 * far);
        let round = (upper * upper - near * near).max(0.0).sqrt();
        let hangs = eye.rotation * e(self.mine(HANGS));
        let aside = (hangs - toward * hangs.dot(toward)).normalize();
        let elbow = shoulder + toward * near + aside * round;
        let along = (elbow - at).normalize();
        let back = eye.rotation * e(Vec3::new(sign * a.cos(), a.sin(), 0.0));
        let back = (back - along * back.dot(along)).normalize();
        arm.reach(Some(Reach { at, along, back, elbow: Some(elbow) }), eye);
    }
}

// Where a fist lands, for Arm::reach: on the skin over the first two knuckles, the hand running back from there to the
// wrist, its back away from the curled fingers. In the person's own frame, the arm as it was made.
fn knuckles(arm: &Arm) -> Grasp {
    let here = |n: &str, tail: bool| arm.here(n, tail);
    let mid = here("finger2-1", false).lerp(here("finger3-1", false), 0.5);
    let ahead = (mid - here("wrist", false)).normalize();
    let curled = here("finger2-3", true).lerp(here("finger3-3", true), 0.5) - mid;
    let back = -(curled - ahead * curled.dot(ahead)).normalize();
    let along = -ahead;
    Grasp { at: mid + ahead * 0.015, along, rotation: Quat::from_mat3(&Mat3::from_cols(along, back, along.cross(back))) }
}

// The two fists, and whether they are up.
#[derive(Resource, Default)]
pub struct Fists {
    r: Option<Fist>,
    l: Option<Fist>,
    up: bool,
    // A raise asked for before the arms were made, or since the last frame.
    want: Option<bool>,
    presses: Vec<char>,
}

impl Fists {
    // Made with the arms: the right closed in a fist (the very arm that holds things too), the left closed now.
    pub fn make(&mut self, arms: &mut Arms) {
        for side in ['R', 'L'] {
            let arm = arms.arm(side);
            arm.hold("fist");
            arm.grasp = knuckles(arm);
            // From the wrist to the knuckles, in line with the forearm in a fist that is punching.
            let hand = arm.grasp.at.distance(arm.here("wrist", false));
            let f = Fist::new(side, hand);
            if side == 'R' { self.r = Some(f) } else { self.l = Some(f) }
        }
        arms.l.hold("open");
    }

    fn fist(&mut self, side: char) -> Option<&mut Fist> {
        if side == 'R' { self.r.as_mut() } else { self.l.as_mut() }
    }

    // The fists taken up (in the guard) or put away.
    pub fn raise(&mut self, on: bool) {
        self.want = Some(on);
    }

    // The button pressed: wound up from wherever it is, if it is not already on its way out.
    pub fn wind_up(&mut self, side: char) {
        self.presses.push(side);
    }

    // Let go: the charge it was thrown with, if it was wound up.
    pub fn let_go(&mut self, side: char) -> Option<f32> {
        // (A press and its letting go in the same frame: wound up first.)
        if self.presses.contains(&side) {
            self.presses.retain(|&s| s != side);
            let f = self.fist(side)?;
            if f.up && f.wind < 0.0 && !f.flying {
                f.t = -1.0;
                f.wind = 0.0;
            }
        }
        self.fist(side)?.let_go()
    }
}

// The fists, every frame: the view turned with the body behind a punch, each fist posed, and one on its way out landing on
// the first skin or cloth its knuckles cross between the last frame and this, where they cross it, with the speed and the
// mass behind it (the body's own give and the fist's, bones.rs and FIST_GIVES).
#[allow(clippy::too_many_arguments)]
pub fn punch(
    time: Res<Time>,
    mut fists: ResMut<Fists>,
    arms: Option<ResMut<Arms>>,
    mut weapons: ResMut<Weapons>,
    mut sound: ResMut<Sound>,
    mut eye: Query<&mut Transform, With<Player>>,
    people: Query<(Entity, &Person)>,
) {
    let Some(mut arms) = arms else { return };
    let Ok(mut eye) = eye.single_mut() else { return };
    let dt = time.delta_secs();
    let clock = time.elapsed_secs();
    // Taken up or put away (another thing taken up).
    if let Some(on) = fists.want.take() {
        fists.up = on;
        for side in ['R', 'L'] {
            let Some(f) = fists.fist(side) else { continue };
            f.up = on;
            f.t = -1.0;
            f.wind = -1.0;
            f.flying = false;
            f.body = 0.0;
            f.at = f.guard();
            f.turn = 0.25;
            let arm = arms.arm(side);
            arm.shift = Vec3::ZERO;
            if !on {
                arm.reach(None, &eye);
            } else if arm.holding != "fist" {
                // (The same arm holds what is held, closed some other way round it: hands.rs.)
                arm.hold("fist");
                arm.grasp = knuckles(arm);
            }
        }
    }
    for side in std::mem::take(&mut fists.presses) {
        if let Some(f) = fists.fist(side) {
            if f.up && f.wind < 0.0 && !f.flying {
                f.t = -1.0;
                f.wind = 0.0;
            }
        }
    }
    if !fists.up || weapons.arm().kind != Kind::Fists {
        return;
    }
    // The view turned with the body (the TS's yaw right positive and roll; Bevy's yaw is the other way).
    for side in ['R', 'L'] {
        let (yaw, roll) = fists.fist(side).unwrap().lean();
        eye.rotation = Quat::from_rotation_y(-yaw) * eye.rotation * Quat::from_rotation_z(-roll);
    }
    let eye = *eye;
    for side in ['R', 'L'] {
        let f = fists.fist(side).unwrap();
        f.update(dt, clock);
        let now = f.knuckles(&eye);
        let was = f.was;
        f.was = if f.flying { Some(now) } else { None };
        if let (true, Some(was)) = (f.flying, was) {
            let d = now - was;
            let far = d.length();
            if far > 1e-5 {
                let dir = d / far;
                let met = people.iter().find_map(|(e, p)| crate::weapons::surface(p, was, dir, far).map(|c| (e, p, c)));
                if let Some((_, p, c)) = met {
                    // port: needs medicine (wounds::blow): the blow is logged where it would be dealt.
                    weapons.log.push(json!({ "hit": "blow", "person": p.label, "segment": p.segments[c.segment].name, "point": c.point.to_array(),
                                             "dir": dir.to_array(), "mass": f.mass, "speed": f.speed, "joules": 0.5 * f.mass * f.speed * f.speed,
                                             "tool": format!("Stiff({FIST_GIVES})"), "with": format!("{side} fist") }));
                    sound.play("blunt", Play::at(c.point).gain(0.45 + 0.35 * (f.mass - 1.5) / 1.4));
                    f.stop_at(c.point, &eye);
                    f.was = None;
                }
            }
        }
        let shift = if f.body < 0.0 { AWAY * -f.body } else { INTO * f.body };
        let f = f.clone();
        let arm = arms.arm(side);
        arm.shift = shift;
        f.pose(arm, &eye);
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Fists>().add_systems(Update, crate::profiler::timed("fists", punch).after(crate::weapons::animate));
}
