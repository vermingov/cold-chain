// The player's fists, drawn while they are held up (weapons.rs 'fists'): one for each arm, the left mouse button the
// left's and the right the right's (src/sandbox/fist.ts).
//
// A person's arm (arm.rs: a person's bones, the hand closed into a fist, the elbow found between a shoulder beside and
// below the eye and the wrist), in that person's own skin and sleeve. What is moved is the knuckles. Between punches the
// fist is up in a guard beside the jaw. A press winds it up: it is drawn back and down toward its shoulder, that
// shoulder taken back and the body turned away from the punch, the view leaning with it, further the longer it is held,
// to a second. Let go, it is driven at the skin the eye looks at, if the arm reaches it (else straight out from its own
// side of the chin), the shoulder and the body turning in behind it, and turns over from upright to most of the way
// flat as it goes; a tap is a jab, thrown from the guard with the arm alone. It lands on the first skin its knuckles
// cross on the way (`punch`: where the fist is, not where the eye looks), with the speed it is going and the mass
// behind it. What it lands on stops it there and it comes back off it to the guard; a miss carries it on to the end of
// the arm and is pulled back slower.
//
// The TS's numbers are in its eye frame (x right, y up, z ahead), brought over where they meet the world (weapons::e).

use bevy::prelude::*;
use serde_json::json;

use crate::arm::{Arm, Grasp, Reach};
use crate::hands::Arms;
use crate::npc::{Hurt, Npc};
use crate::person::Person;
use crate::vitals::{Dice, Vitals};
use crate::wounds;
use bevy::diagnostic::FrameCount;
use crate::player::Player;
use crate::sound::{Play, Sound};
use crate::weapons::{e, Kind, Weapons};

// How hard (dev/research/blunt-trauma.md sec. 9). A jab, thrown from the guard with the arm alone, lands at 1 to 1.5 kN
// (lead straights of boxers of two levels, Liu22); a straight with the hips and shoulder behind it at 2.4 kN for a novice
// boxer, 3.7 for an intermediate and 4.8 for the elite (Smith00), 3.4 +- 0.8 kN for Olympic boxers, whose fists landed at
// 9.1 +- 2.1 m/s with an effective mass of 2.9 +- 2.0 kg (Walilko05), and 4.1 kN for a heavyweight's (Atha85). A tap is
// a jab, a full wind-up (`WIND` s) a trained man's hardest straight, and between by how long it was wound up: on a jaw
// about 1.5 kN to 4.2, on the chest, which gives more, 1 to 3 (bones.rs `impact`, with FIST_GIVES).
const JAB: (f32, f32) = (6.0, 1.0);
const FULL: (f32, f32) = (10.5, 3.2);
const WIND: f32 = 1.0;

// What a punch wound up `charge` of the way (0 a tap, 1 a full second) lands with: the mass behind the fist, kg, and its
// speed, m/s.
pub fn landing(charge: f32) -> (f32, f32) {
    (JAB.1 + (FULL.1 - JAB.1) * charge, JAB.0 + (FULL.0 - JAB.0) * charge)
}

// The knuckles, in the eye's frame (mirrored for the left fist, which is held a little further out in front, the lead
// hand), m.
const GUARD_R: Vec3 = Vec3::new(0.11, -0.08, 0.27);
const GUARD_L: Vec3 = Vec3::new(0.1, -0.07, 0.31);
const DRAWN: Vec3 = Vec3::new(0.17, -0.17, 0.12); // wound all the way up: back and down toward the shoulder
const LINE: Vec3 = Vec3::new(0.05, -0.06, 0.0); // where it is driven out from, straight ahead: its own side of the chin
const MISS: f32 = 0.6; // m ahead of the eye looking level: the arm's end, nothing met (`arm_end`)
const HANGS: Vec3 = Vec3::new(0.3, -1.0, -0.15); // the way the elbow is off the line from shoulder to fist: down, a little out
// The body's turn (`body`, -1 wound fully away to 1 driven fully in): the punching shoulder that far back or forward (m,
// as Arm::shift: out, up, ahead), and the view's yaw and lean with it (rad).
const AWAY: Vec3 = Vec3::new(0.0, -0.015, -0.06);
const INTO: Vec3 = Vec3::new(-0.03, 0.0, 0.08);
const LEAN: (f32, f32) = (0.025, 0.015);
// What it lands with: how far the fist and arm give (N/m), the bone's pad in series (bones.rs) and the struck part's mass
// behind it. Taken so that a full punch to a jaw peaks at about the elite's 4 to 5 kN and is over in some 13 ms (a mass on
// a spring is in contact for pi sqrt(m / k); Atha's heavyweight's peaked 14 ms in). (Under 1e5: wounds.rs takes a
// stiffer thing as narrower than the eye's socket.)
pub const FIST_GIVES: f32 = 9.5e4;

#[derive(Clone, Copy)]
enum Ease {
    Smooth,
    Off,
    Onto,
}

fn ease(e: Ease, u: f32) -> f32 {
    match e {
        Ease::Smooth => u * u * (3.0 - 2.0 * u),
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
    pitch: f32,
    aimed: bool,
}

impl Fist {
    fn new(side: char, hand: f32) -> Self {
        let mut f = Fist { side, keys: Vec::new(), t: -1.0, wind: -1.0, up: false, at: Vec3::ZERO, turn: 0.25, body: 0.0, contact: -1.0, speed: 0.0, mass: 0.0,
                           flying: false, was: None, hand, pitch: 0.0, aimed: true };
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
        let to = self.arm_end(line, Vec3::Z);
        (self.mass, self.speed) = landing(c);
        self.keys = vec![
            Key { at: self.at, t: 0.0, turn: self.turn, body: self.body, ease: Ease::Smooth },
            Key { at: to, t: 0.0, turn: 1.0, body: 0.4 + 0.6 * c, ease: Ease::Onto },
        ];
        self.go_to(to);
        self.t = 0.0;
        self.flying = true;
        self.aimed = false;
        Some(c)
    }

    // On its way to `to` (the eye's frame), from where it set off.
    fn go_to(&mut self, to: Vec3) {
        let far = self.keys[0].at.distance(to);
        // Speeding up all the way, as a punch does, to land at its speed: from rest, that takes twice as long as going the
        // whole way at it (Atha's heavyweight's fist went 0.49 m in 0.1 s and landed at 8.9 m/s).
        let go = (2.0 * far / self.speed).clamp(0.06, 0.25);
        self.keys[1].at = to;
        self.keys[1].t = go;
        self.contact = go;
    }

    // Where the arm ends going from `from` the way `dir` goes (the eye's frame): the arm's length from a shoulder that
    // stays square to the body as the eye looks up or down (Arm's own shoulder turns with the eye; looking down at a
    // belly, the real one is some 15 cm further ahead of it), as long as it is looking level at the end of its line out
    // from the chin (MISS).
    fn arm_end(&self, from: Vec3, dir: Vec3) -> Vec3 {
        let level = self.mine(Vec3::new(crate::arm::SHOULDER[0], -crate::arm::SHOULDER[1], crate::arm::SHOULDER[2]));
        let r = level.distance(self.mine(Vec3::new(LINE.x, LINE.y, MISS)));
        let (sp, cp) = self.pitch.sin_cos();
        let shoulder = Vec3::new(level.x, level.y * cp - level.z * sp, level.y * sp + level.z * cp);
        let o = from - shoulder;
        let b = o.dot(dir);
        from + dir * (-b + (b * b - o.length_squared() + r * r).max(0.0).sqrt())
    }

    // Thrown at what the eye looks at (`at`, the eye's frame: the skin its line meets), if the arm reaches it: from where
    // it set off through there, on to the end of the arm. (A punch goes where its thrower looks; straight out from the
    // chin it passed beside a jaw the eye was on.)
    fn aim(&mut self, at: Vec3) {
        let from = self.keys[0].at;
        let dir = (at - from).normalize();
        let to = self.arm_end(from, dir);
        if (to - from).dot(dir) >= (at - from).length() {
            self.go_to(to);
        }
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

    // Stopped where it met something (a point of the world, where the knuckles crossed its skin), now: also in the frame it
    // reached the end of the arm, a miss already (`landed(None)`) until the way there was looked along.
    fn stop_at(&mut self, point: Vec3, eye: &Transform) {
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
    // Whether a punch is on its way (bout.rs's opponent covers up).
    pub fn flying(&self) -> bool {
        self.r.as_ref().is_some_and(|f| f.flying) || self.l.as_ref().is_some_and(|f| f.flying)
    }

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

    // Whether they are up (in the guard, or punching).
    pub fn is_up(&self) -> bool {
        self.up
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
    mut people: Query<(Entity, &Person, &Transform, &mut Vitals, &mut Hurt), Without<Player>>,
    mut dice: ResMut<Dice>,
    frame: Res<FrameCount>,
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
    // What the fists wear (worn.rs): what it adds to each, and what lands.
    let (worn, tool) = crate::worn::wear(weapons.arm().key);
    for side in ['R', 'L'] {
        let f = fists.fist(side).unwrap();
        f.pitch = eye.forward().y.asin();
        // Just let go: thrown at the first skin the eye's line meets, as far as an arm could reach.
        if f.flying && !f.aimed {
            f.aimed = true;
            let (o, d) = (eye.translation, eye.forward().as_vec3());
            let mut seen: Option<(f32, Vec3)> = None;
            for (_, p, root, mut vitals, mut hurt) in &mut people {
                let traced = hurt.traced.clone();
                let mut npc = Npc { person: p, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame: frame.0 };
                if let Some(c) = crate::weapons::surface(&mut npc, o, d, 1.2) {
                    if seen.is_none_or(|s| c.t < s.0) {
                        seen = Some((c.t, c.point));
                    }
                }
            }
            if let Some((_, at)) = seen {
                f.aim(e(eye.compute_affine().inverse().transform_point3(at)));
            }
        }
        // (Flying as the frame began: the frame it reaches the end of the arm, the last of the way there is still to be
        // looked along.)
        let flying = f.flying;
        f.update(dt, clock);
        let now = f.knuckles(&eye);
        let was = f.was;
        f.was = if f.flying { Some(now) } else { None };
        if let (true, Some(was)) = (flying, was) {
            let d = now - was;
            let far = d.length();
            if far > 1e-5 {
                let dir = d / far;
                // The first skin or clothes anyone's knuckles cross on the way (npc.surface), and the blow landed there.
                let mut met = None;
                for (e, p, root, mut vitals, mut hurt) in &mut people {
                    let traced = hurt.traced.clone();
                    let mut npc = Npc { person: p, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame: frame.0 };
                    let Some(c) = crate::weapons::surface(&mut npc, was, dir, far) else { continue };
                    let force = wounds::blow(&mut npc, c.point, dir, f.mass + worn, f.speed, Some(tool));
                    met = Some((e, p.label.clone(), p.segments[c.segment].name.clone(), c, force));
                    break;
                }
                if let Some((_, label, segment, c, force)) = met {
                    weapons.log.push(json!({ "hit": "blow", "person": label, "segment": segment, "point": c.point.to_array(),
                                             "dir": dir.to_array(), "mass": f.mass + worn, "speed": f.speed, "joules": 0.5 * (f.mass + worn) * f.speed * f.speed,
                                             "newtons": force, "charge": (f.speed - JAB.0) / (FULL.0 - JAB.0), "tool": format!("{tool:?}"), "with": format!("{side} fist") }));
                    sound.play("blunt", Play::at(c.point).gain(0.45 + 0.35 * (f.mass - JAB.1) / (FULL.1 - JAB.1)));
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

// --- the `punches` scenario -------------------------------------------------------------------------------------------------
//
// Punches thrown at the line-up as a player throws them: each person in turn stood in front of, looked at in the eyes,
// the chest or the belly from `far` metres from that part's segment (a fist in the guard is already 30 cm out: from
// much closer it starts inside them), the line-up stood up again every four, and a fist pressed and let go after `held`
// frames (2: a tap, a jab; 60: wound up a second). What each landed with (newtons, joules, the charge) and what it did
// are in the log, a picture of each as it lands.
const PUNCHES: &[(usize, &str, f32, u8, u32)] = &[
    (0, "head", 0.55, 0, 2),
    (1, "head", 0.55, 2, 30),
    (2, "head", 0.55, 2, 60),
    (3, "chest", 0.55, 0, 60),
    (0, "chest", 0.55, 2, 2),
    (1, "belly", 0.55, 0, 30),
    (2, "chest", 0.55, 2, 60),
    (3, "head", 0.55, 0, 60),
    (0, "head", 0.45, 0, 2),
    (1, "chest", 0.45, 2, 30),
    (2, "belly", 0.45, 0, 60),
    (3, "belly", 0.55, 2, 2),
];

// What is held seen on the fists (`worn-gloves`, `worn-dusters`): in the guard looking at the line-up and down at the
// floor, then a right wound up a second and thrown at nothing, caught on its way out and at the end of the arm.
pub fn look(key: &'static str) -> Vec<crate::scenario::Step> {
    use crate::scenario::Step;
    let mut s = vec![Step::Do(Box::new(move |w: &mut World| crate::warm::take(w, key))), Step::Wait(30)];
    s.extend(crate::scenario::view(&format!("{key}_guard"), 0.0, -2.0, [0.0, 1.5, 2.2], 1.65));
    let pitch = |a: f32| {
        Step::Do(Box::new(move |w: &mut World| {
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                p.pitch = a;
            }
        }))
    };
    s.push(pitch(-0.35));
    s.push(Step::Wait(4));
    s.push(Step::Shot(format!("{key}_guard_down")));
    // (Turned away from the line-up, down the empty hall, so the punch meets nothing; caught every other frame out.)
    s.extend(crate::scenario::view(&format!("{key}_away"), 0.0, -2.0, [0.0, 1.5, -10.0], 1.65));
    s.push(Step::Do(Box::new(|w: &mut World| crate::warm::press(w, 2))));
    s.push(Step::Wait(60));
    s.push(Step::Shot(format!("{key}_wound")));
    s.push(Step::Do(Box::new(|w: &mut World| crate::warm::release(w, 2))));
    for k in 1..=6 {
        s.push(Step::Wait(2));
        s.push(Step::Shot(format!("{key}_thrown_{}", k * 2)));
    }
    s.push(Step::Wait(40));
    s
}

// (`key`: what is held, the bare fists or fists in knuckle dusters or boxing gloves, worn.rs; each also seen in the guard.)
pub fn scenario(key: &'static str) -> Vec<crate::scenario::Step> {
    use crate::scenario::Step;
    let mut s = look(key);
    for (i, &(n, part, far, button, held)) in PUNCHES.iter().enumerate() {
        if i > 0 && i % 4 == 0 {
            s.push(Step::Do(Box::new(|w: &mut World| {
                use bevy::ecs::system::RunSystemOnce;
                let _ = w.run_system_once(crate::sandbox::reset);
            })));
            s.push(Step::Wait(60));
        }
        s.push(Step::Do(Box::new(move |w: &mut World| {
            // (The head segment starts at the neck: the face is looked at over it, the eyes.)
            w.resource_mut::<Weapons>().log.clear();
            if let Some((who, at)) = crate::warm::aim(w, n, part, far) {
                let lift = if part == "head" { Vec3::Y * 0.13 } else { Vec3::ZERO };
                w.resource_scope(|w, map: Mut<crate::map::Map>| {
                    for mut p in w.query::<&mut Player>().iter_mut(w) {
                        p.spawn(&map, at.x, at.z + far, Some(at + lift), 1.65);
                    }
                });
                // Where the eye's line meets them: where the punch is meant to land.
                let eye = w.query::<&Player>().iter(w).next().map(|p| p.eye()).unwrap_or_default();
                let seen = crate::npc::with(w, who, |npc| {
                    let c = crate::weapons::surface(npc, eye.translation, eye.forward().as_vec3(), 1.5)?;
                    Some((c.point, npc.person.segments[c.segment].name.clone()))
                }).flatten();
                if let Some((point, segment)) = seen {
                    w.resource_mut::<Weapons>().log.push(json!({ "looked_at": point.to_array(), "segment": segment }));
                }
            }
        })));
        s.push(Step::Wait(30));
        s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::press(w, button))));
        s.push(Step::Wait(held));
        s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::release(w, button))));
        s.push(Step::Wait(4));
        s.push(Step::Shot(format!("{key}_{i}_{part}_{}", if button == 0 { "left" } else { "right" })));
        s.push(Step::Wait(40));
        s.push(Step::Do(Box::new(move |w: &mut World| {
            let hits = std::mem::take(&mut w.resource_mut::<Weapons>().log);
            let mut q = w.query::<(&crate::person::Person, &Vitals, &Hurt)>();
            let mut people: Vec<_> = q.iter(w).map(|(p, v, h)| (p.body.name.clone(), p.label.clone(), v.injuries.iter().map(|i| i.text.clone()).collect::<Vec<_>>(),
                                                               h.bones.breaks.iter().map(|b| b.text.clone()).collect::<Vec<_>>(), v.conscious())).collect();
            people.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.0));
            let (_, label, injuries, breaks, conscious) = &people[n];
            crate::scenario::log(w, json!({ "event": "punch", "at": part, "fist": if button == 0 { "left" } else { "right" }, "held_frames": held,
                                            "hits": hits, "person": label, "injuries": injuries, "breaks": breaks, "conscious": conscious }));
        })));
    }
    s
}
