// What a person does with their body (src/sandbox/behaviour.ts): stands and keeps their balance, steps to catch it,
// falls and puts their hands out, gets up, drags themselves along with a broken leg, curls up round a wound, or nothing
// at all.
//
// It never moves the body itself. It picks a pose for the muscles to pull toward (motor.rs) and how hard, and the few
// pushes a body gives itself through what it is on: the physics does the rest, so a blow still throws a person about as
// hard as it would have anyway, and a person too weak to stand does not.
//
// How strong someone is comes from their vitals each frame: how awake they are (which blood loss and a blow to the head
// take away) and which limbs still answer. Pain and the size of a blow do not take strength away; they change what the
// body does with it: a punch makes a man flinch, stagger, double over or guard, not go limp. Out cold or dead, the
// muscles let go and only the joints' stiffness is left.
//
// Everything here is in Bevy's space (main.rs `babylon`): a person faces -Z at rest where the TS's faced +Z, so their
// heading `h` faces (sin h, 0, -cos h) and their right is +X as it was. A turn about a fixed axis goes the other way
// (`yaw`, `pitch`); one about an axis worked out from the geometry (a cross product) carries over by itself.

use std::f32::consts::PI;

use bevy::prelude::*;
use bevy_rapier3d::prelude::{GenericJoint, GenericJointBuilder, ImpulseJoint, JointAxesMask, JointAxis, MotorModel, RigidBody};

use crate::map::Map;
use crate::motor::{self, Muscles, Part, Strength};
use crate::person::{self, Contacts, Person, Posed, RAD};
use crate::player::Player;
use crate::poses::{self, add, get, over, set, side, Pose};
use crate::ragdoll::{self, Ragdoll, Steps};
use crate::rng::Rng;
use crate::thuds::Heard;
use crate::npc::{self, Happened, Hurt};
use crate::vitals::{Side, Vitals};

const G: f32 = 9.81;
const TOUCH: f32 = 0.035; // m: a segment this close to the floor is on it
const REACH: f32 = 0.72; // m: the longest step that still catches a fall
const STEPS: u32 = 7; // stumbling steps before the legs give up
const TILT: f32 = 0.4; // rad: a body leaning this far out past its feet has gone

fn clamp(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

fn smooth(x: f32) -> f32 {
    let k = clamp(x);
    k * k * (3.0 - 2.0 * k)
}

fn other(s: char) -> char {
    if s == 'L' { 'R' } else { 'L' }
}

// Which way heading `h` faces, and the person's right then.
fn facing(h: f32) -> Vec3 {
    Vec3::new(h.sin(), 0.0, -h.cos())
}

fn right_of(f: Vec3) -> Vec3 {
    Vec3::new(-f.z, 0.0, f.x)
}

// A body turned to face heading `h` (its rest ahead, -Z, onto `facing(h)`), and tipped forward by `p` radians (the TS's
// turn about +X, which is about -X here).
fn yaw(h: f32) -> Quat {
    Quat::from_rotation_y(-h)
}

fn pitch(p: f32) -> Quat {
    Quat::from_rotation_x(-p)
}

// The heading a turn faces.
fn heading_of(q: Quat) -> f32 {
    let f = q * Vec3::NEG_Z;
    f.x.atan2(-f.z)
}

// --- poses for the floor -------------------------------------------------------------------------------------------
//
// Written from RELAXED (arms hanging) like poses.rs's, for an upright trunk (_rise adds the trunk's lean to the hips).
// ALL4's `_pitch` and KNEEL are only for measure(), which poses the skeleton to find how high a body is in them.

fn all4() -> Pose {
    let mut p = over(poses::relaxed(), &[("hipFlexL", 92.0), ("hipFlexR", 92.0), ("kneeL", 95.0), ("kneeR", 95.0), ("ankleL", -30.0), ("ankleR", -30.0),
        ("shoulderFlexL", 86.0), ("shoulderFlexR", 86.0), ("elbowL", -10.0), ("elbowR", -10.0), ("curlL", -30.0), ("curlR", -30.0), ("neckFlex", -35.0), ("headFlex", -10.0)]);
    set(&mut p, "_pitch", 90.0);
    p
}

fn kneel() -> Pose {
    over(poses::relaxed(), &[("hipFlexL", 4.0), ("hipFlexR", 4.0), ("kneeL", 92.0), ("kneeR", 92.0), ("ankleL", -40.0), ("ankleR", -40.0), ("spineFlex", 6.0), ("neckFlex", 6.0)])
}

fn lunge() -> Pose {
    over(poses::relaxed(), &[("hipFlexR", 82.0), ("kneeR", 84.0), ("ankleR", 2.0), ("hipFlexL", 2.0), ("kneeL", 92.0), ("ankleL", -40.0), ("spineFlex", 18.0),
        ("shoulderFlexR", 22.0), ("elbowR", 30.0)])
}

// (The hands as a hand lies with nothing working it: loosely curled, more toward the little finger.)
fn rest() -> Pose {
    over(poses::relaxed(), &[("hipFlexL", 10.0), ("kneeL", 16.0), ("hipFlexR", 5.0), ("kneeR", 9.0), ("elbowL", 18.0), ("elbowR", 22.0), ("curlL", 8.0), ("curlR", 5.0),
        ("thumbL", 4.0), ("thumbR", 2.0), ("neckFlex", 8.0)])
}

// Curled up round it: knees drawn in, arms in, rocking and turning with how much it hurts.
fn curled(t: f32, pain: f32) -> Pose {
    let a = 0.4 + pain * 0.6;
    let s = (t * 1.3).sin();
    let c = (t * 0.7 + 1.0).sin();
    over(poses::relaxed(), &[
        ("hipFlexL", 68.0 + 18.0 * s * a), ("hipFlexR", 74.0 - 16.0 * s * a), ("kneeL", 96.0 + 12.0 * c * a), ("kneeR", 102.0 - 10.0 * c * a),
        ("spineFlex", 28.0 + 8.0 * c * a), ("spineTwist", 12.0 * (t * 0.9).sin() * a), ("spineSide", 8.0 * (t * 0.6).sin() * a),
        ("neckFlex", 28.0 + 10.0 * s * a), ("headTilt", 10.0 * c * a),
        // (The arms in over the front of the trunk, not into it: drawn across it at -14 degrees, the upper arms pressed
        // into the belly with all the shoulder had.)
        ("shoulderFlexL", 70.0), ("shoulderFlexR", 70.0), ("shoulderAbductL", 6.0), ("shoulderAbductR", 6.0), ("elbowL", 95.0), ("elbowR", 90.0),
        ("curlL", 55.0), ("curlR", 60.0),
    ])
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Way {
    Ahead,
    Behind,
    Side,
}

// Hands out toward the floor the way the body is going: ahead, behind or to one side (`s` +1 their right).
fn braced(way: Way, s: f32, give: f32) -> Pose {
    // The knees go first: forward onto them, back into a sit, sideways onto the near hip.
    let legs = [("hipFlexL", 45.0 * give), ("hipFlexR", 40.0 * give), ("kneeL", 80.0 * give), ("kneeR", 72.0 * give), ("ankleL", -15.0), ("ankleR", -15.0)];
    let hands = |k: char| [(side("curl", k), -45.0), (side("thumb", k), -30.0), (side("thumbBase", k), 30.0), (side("thumbIn", k), -25.0)];
    let mut p = over(poses::relaxed(), &legs);
    match way {
        Way::Ahead => {
            p = over(p, &[("shoulderFlexL", 95.0), ("shoulderFlexR", 95.0), ("shoulderAbductL", 22.0), ("shoulderAbductR", 22.0), ("elbowL", 22.0), ("elbowR", 22.0),
                ("neckFlex", -25.0), ("spineFlex", -4.0)]);
            p = over(p, &hands('L'));
            over(p, &hands('R'))
        }
        Way::Behind => {
            // (The TS's object spread the legs and then wrote the hips and knees again: the later ones stand.)
            for (k, v) in [("hipFlexL", 80.0 * give), ("hipFlexR", 74.0 * give), ("kneeL", 100.0 * give), ("kneeR", 92.0 * give)] {
                let base = get(&poses::relaxed(), k);
                set(&mut p, k, base + v);
            }
            p = over(p, &[("shoulderFlexL", -40.0), ("shoulderFlexR", -40.0), ("shoulderAbductL", 38.0), ("shoulderAbductR", 38.0), ("elbowL", 14.0), ("elbowR", 14.0),
                ("neckFlex", 40.0), ("spineFlex", 28.0)]);
            p = over(p, &hands('L'));
            over(p, &hands('R'))
        }
        Way::Side => {
            let near = if s > 0.0 { 'R' } else { 'L' };
            let far = other(near);
            p = over(p, &[(side("shoulderAbduct", near), 78.0), (side("shoulderFlex", near), 22.0), (side("elbow", near), 12.0)]);
            p = over(p, &hands(near));
            over(p, &[(side("shoulderFlex", far), 55.0), (side("shoulderAbduct", far), -20.0), (side("elbow", far), 60.0), ("spineSide", -12.0 * s), ("neckFlex", 15.0)])
        }
    }
}

// The army crawl, lying on the front: the elbows out to the sides on the floor, one forearm put out ahead while the other
// elbow, planted beside the chest, drags the body up to it; the head up. (With the arms in at the sides, as a body
// standing holds them, lying prone they went in under the chest and the hands were trapped under it.)
fn crawling(phase: f32) -> Pose {
    let reach_l = (1.0 + phase.sin()) / 2.0;
    let reach_r = 1.0 - reach_l;
    // (Out to the side first and forward last, as person.rs turns a shoulder: an arm out at 70 degrees is only spun about
    // its own length by the forward turn, so the elbow is brought forward by the forward turn with the arm half out.)
    let arm = |k: char, r: f32| [(side("shoulderFlex", k), 110.0 + 55.0 * r), (side("shoulderAbduct", k), 42.0 - 12.0 * r), (side("elbow", k), 100.0 - 75.0 * r),
        (side("curl", k), 20.0 + 25.0 * (1.0 - r))];
    let p = over(poses::relaxed(), &arm('L', reach_l));
    let p = over(p, &arm('R', reach_r));
    // The legs trail, a knee drawn up a little on the side that reaches.
    over(p, &[("spineFlex", -12.0), ("neckFlex", -42.0), ("headFlex", -12.0), ("spineSide", 6.0 * phase.sin()),
        ("hipFlexL", 4.0 + 10.0 * reach_l), ("hipAbductL", 6.0 * reach_l), ("kneeL", 8.0 + 14.0 * reach_l),
        ("hipFlexR", 4.0 + 10.0 * reach_r), ("hipAbductR", 6.0 * reach_r), ("kneeR", 8.0 + 14.0 * reach_r), ("ankleL", -30.0), ("ankleR", -30.0)])
}

// How an arm reaching for the body is drawn to hold itself, where more than one way reaches (arm_to): each control's
// preferred value and how much it counts (metres of miss a degree away is worth). The elbow forward of the trunk, so the
// forearm comes to the body from in front and not through its side; the upper arm as little twisted as will do.
const PREFER: [[f32; 2]; 4] = [[0.0, 0.0], [10.0, 0.0006], [0.0, 0.0006], [0.0, 0.0]];
const ARM: [&str; 4] = ["shoulderAbduct", "shoulderFlex", "shoulderTwist", "elbow"];
const LEG: [&str; 4] = ["hipFlex", "hipAbduct", "knee", "ankle"];

// --- what they feel ------------------------------------------------------------------------------------------------
//
// What the behaviour reads of the vitals (vitals.rs), taken each frame; the pain it adds (guard) goes back.
#[derive(Clone, Debug)]
pub struct Felt {
    pub conscious: f32,
    pub pain: f32,
    pub daze: f32,
    pub out: f32,
    pub lost: f32,
    pub dead: bool,
    pub beating: bool,
    pub paralysed_arms: bool,
    pub paralysed_legs: bool,
}

impl Default for Felt {
    fn default() -> Self {
        Felt { conscious: 1.0, pain: 0.0, daze: 0.0, out: 0.0, lost: 0.0, dead: false, beating: true, paralysed_arms: false, paralysed_legs: false }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Stand,
    Fall,
    Down,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    None,
    Still,
    Rest,
    Writhe,
    Roll,
    Push,
    Lunge,
    Rise,
    Crawl,
    Creep,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Winded,
    Guard,
    Leg,
}

struct React {
    kind: Kind,
    t: f32,
    length: f32,
    hard: f32,
    side: char,
}

// The wound they tend: on which segment, where and which way out in its frame.
pub struct Wound {
    pub seg: usize,
    pub local: Vec3,
    pub out: Vec3,
    pub t: f32,
    pub size: f32,
    hands: Option<Vec<char>>,
    front: Option<bool>,
}

// Where a hand is going and where it was held up, as the chest carries them (hold).
struct Grip {
    to: Vec3,
    best: f32,
    since: f32,
    hold: Option<Vec3>,
}

// The player as an opponent sees them: the eye, the feet, and whether a fist of theirs is flying.
#[derive(Clone, Copy)]
pub struct Foe {
    pub eye: Vec3,
    pub feet: Vec3,
    pub coming: bool,
}

// A punch: which hand, how far into it, at what, and whether it has landed.
struct Punch {
    side: char,
    t: f32,
    to: Vec3,
    head: bool,
    landed: bool,
    // The hand's fastest toward the player so far (m/s): met, it is stopped at once, and what it carried is this.
    fast: f32,
}

struct Stepping {
    side: char,
    swing: usize,
    from: Vec3,
    to: Vec3,
    t: f32,
    length: f32,
    closing: bool,
    // Taken on purpose (fighting's footwork): its swing paid through the planted leg.
    meant: bool,
}

#[derive(Clone, Copy, Default)]
struct Heights {
    pelvis: f32,
    chest: f32,
    hip: f32,
}

#[derive(Clone, Copy, Default)]
struct Leg {
    a: f32,
    b: f32,
    out: f32,
    flex: f32,
    abduct: f32,
    knee: f32,
    shin: f32,
}

// An arm's reach worked out (arm_to): the controls, how far the hand stays from where it was sent, and where it gets to.
#[derive(Clone, Copy, Default)]
struct Reach {
    x: [f32; 4],
    miss: f32,
    hand: Vec3,
}

struct Arm {
    x: [f32; 4],
    seed: [f32; 4],
    frame: u32,
    goal: Option<Vec3>,
    s: Vec3,
    upper: Vec3,
    fore: Vec3,
    axes: [Vec3; 4],
    // The trunk's boxes as they stand to the chest now: segment, where, the turn into its frame.
    boxes: [(usize, Vec3, Quat); 3],
    reach: f32,
}

type Push = Box<dyn Fn(&mut Ragdoll, f32) + Send + Sync>;

#[derive(Component)]
pub struct Behaviour {
    pub muscles: Muscles,
    pub state: State,
    pub mode: Mode,
    next: Mode,
    t: f32,
    clock: f32,
    heading: f32,
    pub will: f32,
    react: Option<React>,
    fence: f32,
    // 0 to 1: how far a retch is folding them over now (throat.rs)
    pub retch: f32,
    fence_arms: Vec<char>,
    was_out: bool,
    settle: f32,
    flinch: Vec<(&'static str, f32)>,
    pub wound: Option<Wound>,
    // An arm shot, cut or struck hard, not used to hold anything with.
    pub hurt: [bool; 2],
    holding: [bool; 2],
    grips: [Option<Grip>; 2],
    favour: Option<(char, f32)>,
    hunch: f32,
    arms: [Option<Arm>; 2],
    com: Vec3,
    vel: Vec3,
    step: Option<Stepping>,
    steps: u32,
    // Every step taken, for the scenarios.
    pub stepped: u32,
    stand: Heights,
    all4: Heights,
    kneel: Heights,
    leg: [Leg; 2],
    foot: (f32, f32, f32), // ankle, middle, ahead
    look_sign: f32,
    lying: f32,
    wait: f32,
    tries: u32,
    phase: f32,
    landed: bool,
    air: f32,
    last_step: char,
    touching: Vec<usize>,
    pub strength: Strength,
    pushes: Vec<Push>,
    // Why they last went over, for the scenarios' log.
    pub why: &'static str,
    // The height of what is under them (the hall's floor, a ledge): what feet, knees and hands push on.
    pub floor: f32,
    guarded: Vec<Part>,
    eased: Vec<(&'static str, char, f32, [f32; 4])>,
    dt: f32,
    cradle: char,
    pub felt: Felt,
    // Taken hold of (Grabbed), and by which segment, and a leg cut off (dismember.rs): neither stands.
    pub grabbed: bool,
    pub held: Option<usize>,
    // In the ring against the player (bout.rs `Opponent`): where they are, set each frame; the punch being thrown, when
    // the next may be and the next step to range; and the blows that landed, (mass kg, speed m/s, head), for bout.rs to
    // give the player (`Harm::struck`).
    pub foe: Option<Foe>,
    leaned: f32,
    punch: Option<Punch>,
    next_punch: f32,
    pub blows: Vec<(f32, f32, bool)>,
    pub leg_gone: bool,
    // The bones broken in each limb, (side, bone key): bones.rs's, when it comes.
    pub breaks: Vec<(char, String)>,
}

fn i(side: char) -> usize {
    if side == 'L' { 0 } else { 1 }
}

// A joint's world position in a posed skeleton, the root at `root`.
fn joint_at(person: &Person, root: &Transform, posed: &Posed, name: &str) -> Vec3 {
    let abs = person.absolute(&posed.local);
    let b = person.body.by_name[name];
    root.transform_point(person.to_root(posed, &abs, b, person.body.bones[b].head))
}

impl Behaviour {
    pub fn new(person: &Person, root: &Transform, rd: &Ragdoll, map: &Map, clock: f32) -> Behaviour {
        let com = rd.com();
        let mut b = Behaviour {
            muscles: Muscles::new(person, rd),
            state: State::Stand,
            mode: Mode::None,
            next: Mode::None,
            t: 0.0,
            clock,
            heading: heading_of(root.rotation),
            will: 1.0,
            react: None,
            fence: 0.0,
            retch: 0.0,
            fence_arms: Vec::new(),
            was_out: false,
            settle: 0.0,
            flinch: Vec::new(),
            wound: None,
            hurt: [false; 2],
            holding: [false; 2],
            grips: [None, None],
            favour: None,
            hunch: 0.0,
            arms: [None, None],
            com,
            vel: Vec3::ZERO,
            step: None,
            steps: 0,
            stepped: 0,
            stand: Heights::default(),
            all4: Heights::default(),
            kneel: Heights::default(),
            leg: [Leg::default(); 2],
            foot: (0.0, 0.0, 0.0),
            look_sign: 1.0,
            lying: 0.0,
            wait: 0.0,
            tries: 0,
            phase: 0.0,
            landed: true,
            air: 0.0,
            last_step: 'L',
            touching: Vec::new(),
            strength: Strength { trunk: 1.0, neck: 1.0, arm_l: 1.0, arm_r: 1.0, leg_l: 1.0, leg_r: 1.0 },
            pushes: Vec::new(),
            why: "",
            floor: map.ground(com.x, com.z, com.y),
            guarded: Vec::new(),
            eased: Vec::new(),
            dt: 1.0 / 60.0,
            cradle: ' ',
            felt: Felt::default(),
            grabbed: false,
            held: None,
            foe: None,
            leaned: 0.0,
            punch: None,
            next_punch: 1.0,
            blows: Vec::new(),
            leg_gone: false,
            breaks: Vec::new(),
        };
        b.measure(person, root, rd);
        b
    }

    // How high the pelvis and chest are standing, kneeling and on all fours, read off this person's own skeleton; and
    // the legs' lengths and rest angles, for stepping.
    fn measure(&mut self, person: &Person, root: &Transform, rd: &Ragdoll) {
        let f = self.floor;
        let at = |pose: &Pose, ground: Contacts| {
            let posed = person.apply(pose, Some(ground));
            Heights { pelvis: joint_at(person, root, &posed, "root").y - f, chest: joint_at(person, root, &posed, "spine01").y - f, hip: 0.0 }
        };
        self.all4 = at(&all4(), person::ALL4);
        self.kneel = at(&kneel(), person::KNEES);
        self.stand = Heights {
            pelvis: rd.centre().y - f,
            chest: rd.segs[rd.by_name("chest")].now.translation.y - f,
            hip: rd.segs[rd.by_name("thighL")].now.translation.y - f,
        };
        let body = &person.body;
        for s in ['L', 'R'] {
            let b = |n: &str| body.bone(&format!("{n}.{s}")).head;
            let (hip, knee, ankle) = (b("upperleg01"), b("lowerleg01"), b("foot"));
            let mut leg = Leg { a: hip.distance(knee), b: knee.distance(ankle), out: if s == 'L' { -1.0 } else { 1.0 }, ..default() };
            [leg.flex, leg.abduct, leg.knee, leg.shin] = leg_angles(ankle - hip, &leg);
            self.leg[i(s)] = leg;
        }
        let foot = rd.by_name("footL");
        let middle = rd.middle(foot);
        let low = rd.lowest(foot);
        let pos = rd.segs[foot].now.translation;
        self.foot = (pos.y - low, middle.y - low, (middle - pos).dot(facing(self.heading)));
        // Which way a positive neckTwist turns the face: toward their right (+1) or left.
        let twisted = Quat::from_axis_angle(person.hinges["neckTwist"].axis, 0.3) * Vec3::NEG_Z;
        self.look_sign = if twisted.x < 0.0 { -1.0 } else { 1.0 };
    }

    // --- from outside ------------------------------------------------------------------------------------------------

    // A blow or a shot: the push itself, the flinch the muscles make of it, and for a few seconds what a body does about
    // a blow there: winded by one to the belly or chest (doubled over), guarding the face after one to the head, a leg
    // that gives for a moment after one to it. Where it landed is the wound they tend for as long as it hurts (tend).
    // Whether they stay up is the balance's business; nothing here takes their strength. `root` is the person's root.
    pub fn hit(&mut self, rd: &mut Ragdoll, root: &Transform, rng: &mut Rng, seg: usize, impulse: Vec3, point: Vec3, jolt: f32) {
        rd.push(seg, impulse, point);
        // A piece cut off is not felt: the push is all there is to it.
        if rd.cut_off(seg) {
            return;
        }
        let into = rd.segs[seg].now.compute_affine().inverse();
        let n = impulse.length();
        // (Pellets or fragments landing together on one part are one wound, as big as all of them.)
        let size = n + self.wound.as_ref().filter(|w| w.seg == seg && w.t < 0.3).map_or(0.0, |w| w.size);
        // The way out of the wound: against the push, or with none (a blade's slit that spent nothing) out from the
        // segment's middle through it. (Left zero, tend's normalize made it NaN, and the hand sent to it pushed NaN into
        // the hand and the chest: Rapier rolled both back and disabled them, the knife in arsenal-use.)
        let out = (-impulse).try_normalize().unwrap_or_else(|| (point - rd.middle(seg)).normalize_or(Vec3::Y));
        self.wound = Some(Wound {
            seg,
            local: into.transform_point3(point),
            out: into.transform_vector3(out),
            t: 0.0,
            size,
            hands: None,
            front: None,
        });
        let k = (n / 16.0).min(1.0) * (0.4 + jolt);
        let hard = (n / 12.0).min(1.0);
        let name = &rd.segs[seg].def.name;
        let base = name.trim_end_matches(['L', 'R']).trim_end_matches('2');
        let s = name.chars().last().unwrap();
        if hard > 0.15 && matches!(base, "upperarm" | "forearm" | "hand") {
            self.hurt[i(s)] = true;
        }
        if self.state != State::Stand {
            return;
        }
        if hard > 0.15 {
            let kind = match base {
                "belly" | "chest" => Some((Kind::Winded, 1.5 + 2.5 * hard)),
                "head" => Some((Kind::Guard, 0.8 + 1.5 * hard)),
                "thigh" | "shin" | "foot" => Some((Kind::Leg, 0.5 + 0.6 * hard)),
                _ => None,
            };
            if let Some((kind, length)) = kind {
                self.react = Some(React { kind, t: 0.0, length, hard, side: s });
            }
        }
        // (Pushed from behind is toward their ahead: -Z in their own frame.)
        let local = root.rotation.inverse() * impulse;
        let sign = |x: f32| if x < 0.0 { -1.0 } else { 1.0 };
        let more = |list: &mut Vec<(&'static str, f32)>, k: &'static str, v: f32| match list.iter_mut().find(|(n, _)| *n == k) {
            Some((_, x)) => *x += v,
            None => list.push((k, v)),
        };
        more(&mut self.flinch, "spineFlex", sign(-local.z) * 22.0 * k);
        more(&mut self.flinch, "spineSide", -sign(local.x) * 14.0 * k);
        more(&mut self.flinch, "spineTwist", (rng.next() - 0.5) * 20.0 * k);
        if rd.segs[seg].def.name == "head" {
            more(&mut self.flinch, "headFlex", -25.0 * k);
        }
    }

    // Off their feet whatever their balance says.
    pub fn knock_down(&mut self, rng: &mut Rng) {
        if self.state == State::Stand {
            self.go(State::Fall, Mode::None, rng);
        }
    }

    fn go(&mut self, state: State, mode: Mode, rng: &mut Rng) {
        if state == State::Fall && self.state != State::Fall {
            self.landed = false;
        }
        if state == State::Down && self.state != State::Down {
            self.lying = 0.0;
            self.wait = 1.5 + rng.next() * 1.5;
        }
        self.state = state;
        self.mode = mode;
        self.t = 0.0;
        self.step = None;
        self.steps = 0;
        self.react = None;
    }

    // --- every frame, and every step ---------------------------------------------------------------------------------

    // The pushes a body gives itself are decided once a frame and given every physics step (at 1/120 s), each worked out
    // again from where the body is by then: given once a frame, a slow frame left the balance unminded for a tenth of a
    // second.
    fn act(&mut self, push: impl Fn(&mut Ragdoll, f32) + Send + Sync + 'static) {
        self.pushes.push(Box::new(push));
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update(&mut self, dt: f32, person: &Person, rd: &mut Ragdoll, map: &Map, eye: Option<Vec3>, rng: &mut Rng, heard: &mut Vec<Heard>) {
        self.pushes.clear();
        self.dt = dt;
        self.clock += dt;
        self.t += dt;
        for (_, a) in &mut self.flinch {
            *a *= (-5.0 * dt).exp();
        }
        self.strengthen(dt);
        let v = &self.felt;
        rd.set_flaccid(v.paralysed_arms, v.paralysed_legs);
        rd.set_tone(if v.dead || !v.beating { ragdoll::DEAD } else if self.will < 0.05 { ragdoll::OUT } else { ragdoll::ALIVE });

        self.com = rd.com();
        self.vel = rd.com_velocity();
        // What is under them: the highest thing under their weight no higher than their feet.
        let low = rd.lowest(rd.by_name("footL")).min(rd.lowest(rd.by_name("footR")));
        self.floor = map.ground(self.com.x, self.com.z, low + 0.1);
        self.touching = if self.state == State::Stand { Vec::new() } else { rd.attached.iter().copied().filter(|&s| rd.lowest(s) < self.floor + TOUCH).collect() };

        // Knocked out: two people in three hold one arm or both stiffly up for a moment as they go down (the fencing
        // response, dev/research/blunt-trauma.md), a reflex and not the will, so it is held whatever else has let go.
        let out = self.felt.out > 0.0;
        if out && !self.was_out && rng.next() < 0.67 {
            self.fence = 1.2 + rng.next() * 1.3;
            self.fence_arms = [vec!['L'], vec!['R'], vec!['L', 'R']][((rng.next() * 3.0) as usize).min(2)].clone();
        }
        self.was_out = out;

        let mut pose = match self.state {
            State::Stand => self.stand(dt, person, rd, eye, rng),
            State::Fall => self.fall(dt, rd, heard, rng),
            State::Down => self.down(dt, person, rd, eye, rng),
        };
        // A retch (throat.rs) folds the trunk over the belly's squeeze and drops the head, on whatever else they are doing.
        if self.retch > 0.02 {
            pose = over(pose, &[("spineFlex", 24.0 * self.retch), ("neckFlex", 18.0 * self.retch), ("headFlex", 8.0 * self.retch)]);
        }
        if self.fence > 0.0 {
            self.fence -= dt;
            for k in self.fence_arms.clone() {
                set(&mut pose, side("shoulderFlex", k), 95.0);
                set(&mut pose, side("shoulderAbduct", k), -10.0);
                set(&mut pose, side("elbow", k), if k == 'L' { 15.0 } else { 70.0 });
                set(&mut pose, side("curl", k), 40.0);
                if !self.felt.paralysed_arms {
                    *self.strength.at(Part::arm(k)) = 0.6;
                }
            }
        }
        self.guard(rd, dt);
        // A limb taken hold of and pulled on goes with the pull: its muscles let it be drawn out straight rather than
        // hold it to the pose against the one dragging them (writhing, they held the arm curled in against a pull of up
        // to 900 N, and the elbow, wrist and shoulder were wrenched round past their ranges, 60 to 80 degrees).
        if let Some(part) = self.held.and_then(|k| motor::Part::limb(&rd.segs[k].def.name)) {
            *self.strength.at(part) = 0.0;
        }
        let guarded = self.guarded.clone();
        self.muscles.follow(rd, person, &pose, &self.strength, &guarded, dt);
        rd.limp = self.state != State::Stand;
    }

    // Every physics step: the pushes decided this frame, and the shoulders' capsules.
    pub fn before_step(&self, rd: &mut Ragdoll, dt: f32) {
        for push in &self.pushes {
            push(rd, dt);
        }
    }

    // How strong each part of the body is now: as awake as they are (none below 0.2, all of it from 0.6, so a man dazed
    // by a blow still stands on his own legs), all at once when knocked out and slowly as someone fades; and nothing in a
    // limb the cord no longer reaches.
    fn strengthen(&mut self, dt: f32) {
        let v = &self.felt;
        let want = if v.dead || !v.beating { 0.0 } else { clamp((v.conscious - 0.2) / 0.4) };
        let rate = if want < self.will { if v.conscious < 0.3 { 8.0 } else { 1.2 } } else { 1.5 };
        self.will += (want - self.will) * (rate * dt).min(1.0);
        let w = self.will;
        let s = &mut self.strength;
        s.trunk = w;
        s.neck = w;
        s.arm_l = if v.paralysed_arms { 0.0 } else { w };
        s.arm_r = s.arm_l;
        s.leg_l = if v.paralysed_legs { 0.0 } else { w };
        s.leg_r = s.leg_l;
    }

    // The limbs with a broken bone in them, which are kept still (motor.rs `follow`): a broken arm is not put up to guard,
    // braced with or swung, a broken leg not drawn up or kicked; only an arm the hurt arm's cradle is holding in (tend) is
    // moved, gently. Every movement at a break grates the ends on each other, and hurts.
    fn guard(&mut self, rd: &Ragdoll, dt: f32) {
        self.guarded.clear();
        for s in ['L', 'R'] {
            if self.broken(rd, true, s) && self.cradle != s {
                self.guarded.push(Part::arm(s));
            }
            if self.broken(rd, false, s) {
                self.guarded.push(Part::leg(s));
            }
        }
        for &k in &rd.attached {
            let seg = &rd.segs[k];
            if !seg.broken || !seg.def.joint.as_ref().is_some_and(|j| j.lock) {
                continue;
            }
            let p = seg.def.parent.unwrap();
            let grating = (seg.spin - rd.segs[p].spin).length();
            self.felt.pain = (self.felt.pain + 0.04 * grating * dt * self.will).min(1.0);
        }
    }

    // Whether the arm (`arm`) or leg on `s` has a bone broken in it: a shaft or joint let go at a mid joint or a joint
    // (ragdoll `loose` at its far end), or a bone of the foot, hand or wrist.
    fn broken(&self, rd: &Ragdoll, arm: bool, s: char) -> bool {
        if rd.loose(rd.by_name(&format!("{}{s}", if arm { "hand" } else { "foot" }))) {
            return true;
        }
        let keys: &[&str] = if arm { &["humerus", "radius", "ulna", "scaphoid", "carpal", "metacarpal"] } else {
            &["femur", "tibia", "fibula", "calcaneus", "tarsal", "metatarsal", "kneecap"]
        };
        self.breaks.iter().any(|(side, key)| *side == s && keys.contains(&key.as_str()))
    }

    fn can_stand(&self, rd: &Ragdoll) -> bool {
        !self.leg_gone && !self.felt.paralysed_legs && !rd.loose(rd.by_name("footL")) && !rd.loose(rd.by_name("footR"))
    }

    // --- on their feet -----------------------------------------------------------------------------------------------

    fn stand(&mut self, dt: f32, person: &Person, rd: &mut Ragdoll, eye: Option<Vec3>, rng: &mut Rng) -> Pose {
        let pelvis = rd.by_name("pelvis");
        let chest = rd.by_name("chest");
        let feet = [rd.by_name("footL"), rd.by_name("footR")];
        // A foot stepping is not stood on, even before it leaves the floor: the weight goes over the other one first.
        let swing = self.step.as_ref().map(|s| s.swing);
        let down: Vec<usize> = feet.iter().copied().filter(|&f| rd.lowest(f) < self.floor + TOUCH && Some(f) != swing).collect();
        let (hull, centre) = footprint(rd, if down.is_empty() { &feet } else { &down });
        // Gone over: the body's weight leaning out past the edge of the feet further than saving (measured over both
        // feet wherever they are: a step lands one at a time; a hard blow swings the pelvis or the chest further than
        // this on its own, and they come back), sunk, or off the floor.
        let lean = outside(&footprint(rd, &feet).0, self.com.x, self.com.z).max(0.0).atan2(self.com.y - self.floor);
        self.air = if feet.iter().any(|&f| rd.lowest(f) < self.floor + TOUCH) { 0.0 } else { self.air + dt };
        let why = if self.grabbed { "grabbed" } else if !self.can_stand(rd) { "legs" } else if self.will < 0.3 { "will" } else if lean > TILT { "lean" }
            else if self.com.y - self.floor < self.stand.pelvis * 0.6 { "sunk" } else if self.air > 0.25 { "air" } else { "" };
        if !why.is_empty() {
            self.why = why;
            self.go(State::Fall, Mode::None, rng);
            return self.fall_pose(rd);
        }
        // A twist the body has been given is let stand, slowly: they do not swing back to face where they faced.
        let turned = heading_of(rd.segs[pelvis].now.rotation) - self.heading;
        let turned = turned.sin().atan2(turned.cos());
        self.heading += turned * (dt * 0.6).min(1.0);

        let v = self.felt.clone();
        let mut pose = poses::stand(self.clock, 1.0 + v.lost * 3.0, 0.0);
        for &(k, a) in &self.flinch {
            add(&mut pose, k, a);
        }
        // Somebody hurt holds themselves bent over it; somebody dazed sways, head down.
        let daze = v.daze;
        add(&mut pose, "spineFlex", v.pain * 14.0);
        add(&mut pose, "spineSide", daze * 6.0 * (self.clock * 0.8).sin());
        add(&mut pose, "neckFlex", daze * 14.0);
        add(&mut pose, "headTilt", daze * 8.0 * (self.clock * 0.6 + 1.0).sin());
        self.look(&mut pose, rd, eye, v.conscious * 0.8);
        // Arms just clear of the belly and the hands of the thighs: hanging straight they are pulled into them and
        // rattle. (At 7 degrees the upper arms, which meet the belly now, lay on it and shook the hands.)
        add(&mut pose, "shoulderAbductL", 10.0);
        add(&mut pose, "shoulderAbductR", 10.0);

        // Fighting, they turn to face the player, at most a turn and a half a second.
        if let Some(foe) = self.foe {
            let c = rd.segs[chest].now.translation;
            let want = (foe.eye.x - c.x).atan2(-(foe.eye.z - c.z));
            let d = want - self.heading;
            self.heading += d.sin().atan2(d.cos()).clamp(-9.0 * dt, 9.0 * dt);
        }

        // Balance. Where the body's weight would come to rest if it stopped on its own (the capture point) against the
        // ground under the feet: inside, the feet keep the body upright; outside, a step.
        let f = facing(self.heading);
        let r = right_of(f);
        let omega = (G / self.com.y.max(0.5)).sqrt();
        let mut xi = self.com + self.vel / omega;
        xi.y = self.floor;

        // The planted legs hold the hips at standing height over wherever the feet are: after a step one leg reaches
        // forward and the other back, and pulled back straight under the body they dragged the new foot back with them.
        // As high as standing, or as high as every planted leg can reach from where its foot is: feet apart, the hips
        // are lower. (Every leg held to full height in a stride pushed against the other through the floor, shoved the
        // body on and buckled a knee.)
        let mut hip_y = self.floor + self.stand.hip;
        for &foot in &down {
            let s = rd.segs[foot].def.name.chars().last().unwrap();
            let leg = self.leg[i(s)];
            let hip = rd.segs[rd.by_name(&format!("thigh{s}"))].now.translation;
            let ankle = rd.segs[foot].now.translation;
            let reach = 0.97 * (leg.a + leg.b);
            let across = (ankle.x - hip.x).hypot(ankle.z - hip.z);
            hip_y = hip_y.min(ankle.y + (reach * reach - across * across).max(0.0).sqrt());
        }
        // Not into a crouch, though: a long stride is stood in with the legs reaching, the hips a little lower.
        hip_y = hip_y.max(self.floor + self.stand.hip - 0.1);
        // On one foot mid-step, the leg holds the hips up under the pelvis as it is, and leaves its lean alone: levelling
        // it through the one planted leg pushed the body on over that foot, toward the way it was already falling.
        self.tend(&mut pose, dt, person, rd, false);
        // A broken bone in a foot that still lets them stand (a toe's long bone, the fibula alone): the weight kept off it.
        for s in ['L', 'R'] {
            if self.broken(rd, false, s) {
                self.favour = Some((other(s), 1.0));
                *self.strength.at(Part::leg(s)) *= 0.5;
            }
        }
        // Dazed, the weight wanders and is caught late; just up off the floor, they stand braced a moment first. Hurt in
        // a leg, it is carried over the other foot.
        self.settle = (self.settle - dt).max(0.0);
        let wander = if self.settle > 0.0 { 0.0 } else { daze * 0.04 };
        let mut aim = centre + Vec3::new((self.clock * 0.9 + 1.3).sin(), 0.0, (self.clock * 0.7).sin()) * wander;
        if let Some((good, how)) = self.favour {
            let good = down.iter().copied().find(|&foot| rd.segs[foot].def.name.ends_with(good));
            if let (Some(good), 2) = (good, down.len()) {
                let over = (rd.middle(good) - centre) * (0.5 * how);
                aim.x += over.x;
                aim.z += over.z;
            }
        }
        // The hips go where the weight needs them: back under a body doubled over, forward under one leaning back, so
        // that the weight stays over the feet as the back bends (the ankles alone hold only what the soles can press).
        let mut shift = aim - self.com;
        shift.y = 0.0;
        if shift.length() > 0.1 {
            shift *= 0.1 / shift.length();
        }
        // (Eased over 60 ms: worked out each frame from where the hips and feet had just been jolted to, a planted leg's
        // aim jumped from frame to frame, and the foot it could not turn passed every jump up the shin, 1 to 6 rad/s of
        // buzz in a foot and shin standing still.)
        for &foot in &down {
            let s = rd.segs[foot].def.name.chars().last().unwrap();
            let ankle = rd.segs[foot].now.translation;
            self.leg_to(rd, s, ankle, &mut pose, f, Some(hip_y), self.step.is_none(), Some(shift));
            self.ease("leg", &LEG, s, &mut pose, 0.06);
        }
        self.react(&mut pose, dt);
        // Fighting, the weight leans toward the range they want, as far as past the edge of the feet, and a step is taken
        // as soon as it gets to the edge (leaning alone, the balance's push dies away there and they only stood on their
        // toes): they come in or back off a step at a time, each caught as a stumble is. (A step forced on the feet
        // instead put them on the floor within a second of the first step in.)
        let lean = self.fight(rd, &mut pose, dt, feet, rng);
        let leaning = lean != Vec3::ZERO;
        if leaning {
            aim += lean;
            self.steps = 0;
        }

        // The ankle strategy: the body swayed back over the middle of the feet as a whole, as hard as the feet can push
        // for it. Feet only press the floor, so carrying the weight one way needs the floor pressed on the other side of
        // it, which is worth the body's weight times how far that edge of the feet lies: nothing once the weight is over
        // a toe or a heel, and then a step has to do it. The sway is spread over the whole body the way the floor's push
        // through the feet moves it, each part by its weight and its height (as one turn of the pelvis, the joints had to
        // pass it on and rang with it).
        let legs = self.strength.leg_l.min(self.strength.leg_r);
        let face = yaw(self.heading);
        let bent = face * pitch(get(&pose, "spineFlex") * RAD);
        let kp = 30.0 * (1.0 - 0.3 * daze);
        let kd = 9.0 * (1.0 - 0.3 * daze) * if self.settle > 0.0 { 2.0 } else { 1.0 };
        // The hip strategy: the trunk bent toward where the weight is going, which sends the hips back the other way
        // through the legs (held straight up instead, its turn back swung the legs and hips on toward the fall). Measured
        // from where the weight is wanted: from the middle of the feet, it fought a lean in on purpose and they backed
        // away from the player instead.
        let mut off = xi - aim;
        off.y = 0.0;
        let tilt = if off.length() > 1e-4 { Quat::from_axis_angle(Vec3::Y.cross(off).normalize(), (4.0 * off.length()).min(0.5)) } else { Quat::IDENTITY };
        let (face, bent) = (tilt * face, tilt * bent);
        if !down.is_empty() {
            let floor = self.floor;
            let down = down.clone();
            let hull = hull.clone();
            self.act(move |rd, dt| {
                let com = rd.com();
                let vel = rd.com_velocity();
                let height = (com.y - floor).max(0.5);
                let mut sway = (aim - com) * kp - vel * kd;
                sway.y = 0.0;
                let lever = if sway.length() > 1e-6 { inside(&hull, com.x, com.z, -sway.x, -sway.z) } else { 0.0 };
                let most = G * lever * legs / height;
                if sway.length() > most {
                    sway *= most / sway.length();
                }
                // And the catch a stumble makes: steps never land exactly where they should, and a body that has to step
                // again for every one that fell short never stops. Whatever foot is down slows the body's going, up to a
                // quarter of its weight, as long as it is going no faster than legs can catch (a hard shove still puts
                // them down). (Only while stepping, a light shove that should have been stood was stepped after, step
                // after step.)
                let speed = vel.x.hypot(vel.z);
                if speed > 0.01 && speed < 1.4 {
                    sway += Vec3::new(vel.x, 0.0, vel.z) * (-(2.6 * legs).min(5.0 * speed) / speed);
                }
                motor::lean(rd, sway, height, &down, dt);
                // The trunk's spin as a whole (pelvis, belly and chest by their weight), which the turns below are damped
                // against (motor.rs `toward`).
                let spin = spin_of_trunk(rd);
                // And turned to face where they mean to, as hard as the soles' grip allows. (For a standing body's 1.5 kg
                // m2 about its length: at 40 kg m2 its damping alone was more than a step can give and turned it back and
                // forth.)
                // (The soles' grip turns the feet back: the floor holds them.)
                let twist = motor::toward(rd, pelvis, face, 40.0, 1.5, f32::INFINITY, Some(spin)).y.clamp(-40.0 * legs, 40.0 * legs);
                motor::turn(rd, pelvis, Vec3::new(0.0, twist, 0.0), &down, dt);
                // The trunk kept upright over the legs, the hip strategy, as far as the muscles round the hips (about 300
                // N m both together) and the back hold it, pushing on the floor through the legs: without it a stride
                // pitched the pelvis forty degrees over the front leg and took the body down, and at a third of that a
                // shove still tipped the trunk back a little more with every step until it lay back at fifty degrees. The
                // chest is held as far over as the pose bends the back, so a body doubled over is not straightened.
                // Both are muscles', so each turns the other side of its joint back: the hips' the thighs standing on the
                // floor, the back's the belly. (Given to the trunk from nowhere, they held a standing body upright against
                // anything that pushed it, up to 450 N m: shoved at 120 N s they took a step and stood, a post.)
                let t = motor::toward(rd, pelvis, face, 25.0, 12.0, 300.0 * legs, Some(spin));
                let thighs: Vec<usize> = down.iter().map(|&f| rd.by_name(&format!("thigh{}", rd.segs[f].def.name.chars().last().unwrap()))).collect();
                motor::turn(rd, pelvis, Vec3::new(t.x, 0.0, t.z), &thighs, dt);
                let t = motor::toward(rd, chest, bent, 25.0, 12.0, 150.0 * legs, Some(spin));
                let belly = rd.by_name("belly");
                motor::turn(rd, chest, Vec3::new(t.x, 0.0, t.z), &[belly], dt);
            });
        }

        // A step only once the weight is clearly going past the feet: a sway that tips just over the edge is swayed back.
        // A foot that has come off the floor without being stepped (the trailing one, left behind as the weight goes over
        // the other) is stepped at once: left hanging, it was nothing to stand on.
        let lifted = if down.len() == 1 { feet.iter().copied().find(|f| !down.contains(f)) } else { None };
        let past = outside(&hull, xi.x, xi.z);
        // (Leaning toward range, each step lands as far again toward it: put down just past where the weight would stop,
        // the steps were a centimetre or two and they shuffled 15 cm in twelve seconds.)
        let goal = if leaning { xi + lean } else { xi };
        if self.step.is_none() && (lifted.is_some() || (down.len() == 2 && past > if leaning { -0.06 } else if self.settle > 0.0 { 0.1 } else { 0.08 })) {
            if self.steps >= STEPS || xi.distance(centre) > REACH * 1.4 {
                self.why = if self.steps >= STEPS { "steps" } else { "far" };
                self.go(State::Fall, Mode::None, rng);
                return self.fall_pose(rd);
            }
            let only = lifted.map(|f| rd.segs[f].def.name.chars().last().unwrap());
            self.start_step(rd, goal, f, r, feet, only);
            if let Some(st) = self.step.as_mut() {
                st.meant = leaning;
            }
            // Caught already over the planted foot, the lifted one only closes up beside it, and they stand.
            if let (Some(l), true) = (lifted, past < 0.04) {
                let at = rd.segs[down[0]].now.translation;
                let out = if rd.segs[l].def.name.ends_with('R') { 1.0 } else { -1.0 };
                let st = self.step.as_mut().unwrap();
                st.to = Vec3::new(at.x, self.floor, at.z) + r * (0.2 * out);
                st.closing = true;
                self.steps -= 1;
            }
        }
        // (Leaning toward range a while and still not over the edge: the step taken anyway, caught as a stumble's is.)
        if self.step.is_none() && leaning && self.leaned > 0.8 && down.len() == 2 {
            self.start_step(rd, goal, f, r, feet, None);
            if let Some(st) = self.step.as_mut() {
                st.meant = true;
            }
            self.steps = 0;
            self.leaned = 0.0;
        }
        if self.step.is_some() {
            self.stepping(dt, rd, &mut pose, f, goal, r);
        } else if past < -0.02 {
            self.steps = 0;
        }
        pose
    }

    // Squared up to the player in the ring (bout.rs): the guard up (hands by the jaw, elbows in, chin down; the knees
    // not bent for it: crouched, against the hips' upright muscles, they crept back 20 cm in five seconds and fell),
    // tighter while a fist of theirs is flying; a step in or out to keep about an arm's length off; and now and then a
    // jab with the left or a straight with the right at the head or the body. A punch is the arm's: its pose thrown
    // straight and the hand driven at the target by its arm, paid for at the chest, over 130 ms, and back. What it carries
    // when it meets the player's body (the hand's speed toward them, and the hand, forearm and, for a straight, the upper
    // arm behind it) goes to bout.rs for `Harm::struck`. Dazed, the guard sags and the punches come slower and softer.
    #[allow(clippy::too_many_arguments)]
    fn fight(&mut self, rd: &mut Ragdoll, pose: &mut Pose, dt: f32, feet: [usize; 2], rng: &mut Rng) -> Vec3 {
        let Some(foe) = self.foe else {
            self.punch = None;
            return Vec3::ZERO;
        };
        let (will, daze) = (self.will, self.felt.daze);
        let chest = rd.by_name("chest");
        let c = rd.segs[chest].now.translation;
        let mut to = foe.eye - c;
        to.y = 0.0;
        let d = to.length();
        let ahead = to / d.max(1e-3);
        let up = clamp(1.0 - daze * 0.7);
        let cover = if foe.coming && d < 1.5 { 1.0 } else { 0.0 };
        add(pose, "neckFlex", 12.0 + 8.0 * cover);
        add(pose, "spineFlex", 6.0 + 6.0 * cover);
        for k in ['L', 'R'] {
            if self.punch.as_ref().is_some_and(|p| p.side == k) || self.holding[i(k)] {
                continue;
            }
            add(pose, side("shoulderFlex", k), 65.0 * up + 15.0 * cover);
            add(pose, side("shoulderAbduct", k), 6.0 - 8.0 * cover);
            add(pose, side("elbow", k), 120.0 * up + 10.0 * cover);
            add(pose, side("curl", k), 60.0);
            add(pose, side("thumbBase", k), 52.0);
            add(pose, side("thumbIn", k), -55.0);
        }

        // Footwork: leaning in when out of reach, back when crowded (off: see below).
        let range = 0.8;
        // shortcut: no footwork yet, they hold their ground (leaning toward range, every step in drew the feet back and
        // they backed away and fell: PORT.md, "The opponent's fighting"); upgrade when stepping on purpose is solved.
        let lean = if std::env::var("PROBE_WALK").is_ok() && self.punch.is_none() && (d - range).abs() > 0.15 { ahead * (d - range).clamp(-0.2, 0.2) } else { Vec3::ZERO };
        self.leaned = if lean == Vec3::ZERO || self.step.is_some() { 0.0 } else { self.leaned + dt };

        // A punch, now and then, when in reach and steady.
        self.next_punch -= dt;
        if self.punch.is_none() && self.next_punch <= 0.0 && d < range + 0.3 && d > 0.35 && self.step.is_none() && will > 0.5 {
            let side = if rng.next() < 0.65 { 'L' } else { 'R' };
            let head = rng.next() < 0.7;
            let to = foe.eye - Vec3::Y * if head { 0.06 } else { 0.5 };
            self.punch = Some(Punch { side, t: 0.0, to, head, landed: false, fast: 0.0 });
            self.next_punch = 0.7 + rng.next() * 1.3 + daze * 2.5;
        }
        let Some(p) = self.punch.as_mut() else { return lean };
        p.t += dt;
        let (k, pt, at, head, landed) = (p.side, p.t, p.to, p.head, p.landed);
        let hand_now = rd.by_name(&format!("hand{k}"));
        p.fast = p.fast.max(rd.segs[hand_now].vel.dot(ahead));
        let fast = p.fast;
        const OUT: f32 = 0.13;
        const BACK: f32 = 0.22;
        if pt > OUT + BACK {
            self.punch = None;
            return lean;
        }
        let e = if pt < OUT { smooth(pt / OUT) } else { 1.0 - smooth((pt - OUT) / BACK) };
        let straight = k == 'R';
        // Thrown straight from the shoulder; a straight turns the trunk behind it.
        set(pose, side("shoulderFlex", k), 70.0 + 18.0 * e);
        set(pose, side("shoulderAbduct", k), 6.0 * (1.0 - e));
        set(pose, side("elbow", k), 120.0 * (1.0 - e) + 4.0 * e);
        add(pose, side("curl", k), 60.0);
        if straight {
            add(pose, "spineTwist", -18.0 * e);
        }
        let hand = rd.by_name(&format!("hand{k}"));
        if pt < OUT {
            // Driven from the floor: paid through the feet on it (paid by the chest, each punch shoved the puncher back
            // some 40 N s and his own punches put him down), and at a point 10 cm past the target, through it.
            let most = (if straight { 450.0 } else { 300.0 }) * will * up;
            let through = at + ahead * 0.1;
            let feet: Vec<usize> = feet.iter().copied().filter(|&f| rd.lowest(f) < self.floor + TOUCH).collect();
            let against = if feet.is_empty() { vec![chest] } else { feet };
            self.act(move |rd, dt| {
                let force = motor::reach(rd, hand, through, 900.0, 2.0, most, None);
                motor::push(rd, hand, force, &against, dt);
            });
        }
        // Landed: the hand at the player's body (its capsule, from the knees to the crown, 0.25 m round).
        let h = rd.middle(hand);
        let (lo, hi) = (foe.feet + Vec3::Y * 0.65, foe.eye - Vec3::Y * 0.12);
        let t = clamp((h - lo).dot(hi - lo) / (hi - lo).length_squared());
        // (Within 12 cm of the capsule's skin: the hand's middle, met by the body, stops 8 cm off it.)
        if !landed && h.distance(lo + (hi - lo) * t) < 0.25 + 0.12 {
            self.punch.as_mut().unwrap().landed = true;
            let speed = fast.max(0.0);
            // The mass the fist carries: the hand and half the forearm behind a jab, and the forearm and half the upper
            // arm too behind a straight (about fist.rs's 1 and 3.2 kg; the whole of the arm's segments counted, one jab
            // was 0.4 of a knockout).
            let m = |n: String| rd.segs[rd.by_name(&n)].def.mass;
            let fore = m(format!("forearm{k}")) + m(format!("forearm2{k}"));
            let upper = m(format!("upperarm{k}")) + m(format!("upperarm2{k}"));
            let mass = m(format!("hand{k}")) + if straight { fore + upper * 0.5 } else { fore * 0.5 };
            self.blows.push((mass, speed, head && h.y > foe.eye.y - 0.3));
        }
        lean
    }

    // A step to where the weight is going: the trailing foot forward or back, or the foot on the side it is falling to.
    fn start_step(&mut self, rd: &Ragdoll, xi: Vec3, f: Vec3, r: Vec3, feet: [usize; 2], only: Option<char>) {
        let a = rd.segs[feet[0]].now.translation;
        let b = rd.segs[feet[1]].now.translation;
        let mid = (a + b) * 0.5;
        let mut to = xi - mid;
        to.y = 0.0;
        let along = to.dot(f);
        let across = to.dot(r);
        // The first step is the trailing foot's, or the foot on the side the weight is going to; then the feet take turns
        // (stepping sideways, the inside foot follows the outside one).
        let s = match only {
            Some(s) => s,
            None if self.steps > 0 => other(self.last_step),
            None if across.abs() > along.abs() * 0.7 => if across > 0.0 { 'R' } else { 'L' },
            None => if a.dot(to) < b.dot(to) { 'L' } else { 'R' },
        };
        self.last_step = s;
        let swing = rd.by_name(&format!("foot{s}"));
        let here = rd.middle(swing);
        let landing = self.landing(rd, xi, s, r);
        // A quick step, a little longer the further it goes: a reactive step is a quarter to a third of a second.
        self.step = Some(Stepping {
            side: s,
            swing,
            from: Vec3::new(here.x, self.floor, here.z),
            to: landing,
            t: 0.0,
            length: (0.18 + 0.15 * here.distance(landing)).clamp(0.2, 0.3),
            closing: false,
            meant: false,
        });
        self.steps += 1;
        self.stepped += 1;
    }

    // Where a step should land to catch the weight going to `xi`: past it, on its own side of the planted foot (a step to
    // the right is the right foot's, and lands right of the left), and no further than a leg reaches. Past it by more the
    // faster the body is going: a foot put down just at the capture point leaves the floor nothing to brake with (the
    // weight arrives over the edge of the sole), and the next step is needed at once.
    fn landing(&self, rd: &Ragdoll, xi: Vec3, s: char, r: Vec3) -> Vec3 {
        let stance = rd.segs[rd.by_name(&format!("foot{}", other(s)))].now.translation;
        let planted = Vec3::new(stance.x, self.floor, stance.z);
        let mut to = xi - planted;
        to.y = 0.0;
        let mut target = xi + to.normalize_or_zero() * (0.1 + 0.08 * self.vel.x.hypot(self.vel.z));
        target.y = self.floor;
        let out = if s == 'R' { 1.0 } else { -1.0 };
        let sideways = (target - planted).dot(r) * out;
        if sideways < 0.14 {
            target += r * ((0.14 - sideways) * out);
        }
        let reach = target - planted;
        if reach.length() > REACH {
            target = planted + reach * (REACH / reach.length());
        }
        target
    }

    // The swing foot on its way. It is aimed at the capture point as it is now, not where it was at push-off: with only
    // one foot down it runs away from it the whole time the step takes (by e to the power of the step's length times the
    // body's natural rate, nearly three times as far), and a step aimed at where it was falls short.
    fn stepping(&mut self, dt: f32, rd: &mut Ragdoll, pose: &mut Pose, f: Vec3, xi: Vec3, r: Vec3) {
        let (s, length, closing) = {
            let st = self.step.as_mut().unwrap();
            st.t += dt;
            (clamp(st.t / st.length), st.length, st.closing)
        };
        let lift = 0.06 * (PI * s).sin();
        let st_side = self.step.as_ref().unwrap().side;
        if s < 0.95 && !closing {
            let to = self.landing(rd, xi, st_side, r);
            self.step.as_mut().unwrap().to = to;
        }
        let st = self.step.as_ref().unwrap();
        let at = st.from.lerp(st.to, smooth(s));
        let (foot_ankle, foot_middle, foot_ahead) = self.foot;
        let middle = Vec3::new(at.x, self.floor + foot_middle + lift, at.z);
        let mut ankle = middle - f * foot_ahead;
        ankle.y = self.floor + foot_ankle + lift;
        let swing = st.swing;
        let t = st.t;
        self.leg_to(rd, st_side, ankle, pose, f, None, true, None);
        add(pose, side("ankle", st_side), 8.0 * (PI * s).sin());
        // The foot carried to its place by the leg's own muscles, the hip taking the pull.
        let most = 220.0 * self.strength.get(Part::leg(st_side));
        // (A step on purpose pays through the planted leg into the floor, as pushing off it does: paid by the hip alone,
        // each step in sent the body back some 60 N s and they backed away from the player and fell.)
        let pelvis = if st.meant { rd.by_name(&format!("foot{}", other(st_side))) } else { rd.by_name("pelvis") };
        self.act(move |rd, dt| {
            let force = motor::reach(rd, swing, middle, 300.0, 6.0, most, None);
            motor::push(rd, swing, force, &[pelvis], dt);
        });
        // Down when it touches: a foot kept hovering for its mark let the weight run on past the other one.
        if (s >= 1.0 && rd.lowest(swing) < self.floor + TOUCH) || t > length + 0.15 {
            self.step = None;
        }
    }

    // What a standing body is doing about the last blow (hit()), laid over its pose: quick in, easing off.
    fn react(&mut self, pose: &mut Pose, dt: f32) {
        let Some(r) = &mut self.react else { return };
        r.t += dt;
        if r.t > r.length {
            self.react = None;
            return;
        }
        // Keeping their feet comes first: mid-step the body does not double over or let a leg go. Guarding is quick;
        // doubling over takes a moment (snapped over at once, the trunk threw the weight out past the toes and the person
        // stepped after it again and again).
        let onset = if r.kind == Kind::Winded { 0.4 } else { 0.15 };
        let e = smooth(r.t / onset) * (1.0 - smooth((r.t - r.length * 0.4) / (r.length * 0.6))) * (0.5 + 0.5 * r.hard)
            * if self.step.is_some() { 0.2 } else { 1.0 };
        let more = |pose: &mut Pose, changes: &[(&'static str, f32)]| {
            for &(k, a) in changes {
                add(pose, k, a * e);
            }
        };
        match r.kind {
            // Winded: folded over the blow, knees giving a little, both arms in over it. (The fold is the back's: bent at
            // the hips as well, over legs holding the weight over the feet, the whole body tipped forward.) (As far over
            // as tending a wound there has not bent them already.)
            Kind::Winded => more(pose, &[("spineFlex", (34.0 - self.hunch).max(0.0)), ("neckFlex", 12.0), ("kneeL", 12.0), ("kneeR", 12.0)]),
            // Hands up in front of the face, closed, the thumbs in over the fingers, chin down. (Not a hand already gone
            // to the wound, tend: laid over its reach, the guard drove it on into the face and it shook there.)
            Kind::Guard => {
                more(pose, &[("neckFlex", 14.0), ("spineFlex", 8.0)]);
                for k in ['L', 'R'] {
                    if !self.holding[i(k)] {
                        more(pose, &[(side("shoulderFlex", k), 75.0), (side("shoulderAbduct", k), 8.0), (side("elbow", k), 115.0),
                            (side("curl", k), if k == 'L' { 56.0 } else { 60.0 }), (side("thumb", k), if k == 'L' { 24.0 } else { 25.0 }),
                            (side("thumbBase", k), 52.0), (side("thumbIn", k), -55.0)]);
                    }
                }
            }
            // A dead leg: it gives at the knee for a moment, and the balance has to cope.
            Kind::Leg => {
                let s = r.side;
                *self.strength.at(Part::leg(s)) *= 1.0 - 0.7 * e;
                more(pose, &[(side("knee", s), 22.0), (side("hipFlex", s), 8.0)]);
            }
        }
    }

    // Where it hurts, tended for as long as it hurts (the last wound, hit()): shot or cut in an arm, the other hand holds
    // it and the arm is kept in against the body; in a leg, the weight goes onto the other one and the knee eases, a hand
    // on a thigh; in the trunk, the neck or the head, the hand that gets there best, both for a big wound, and they bend
    // over it. Never with a hand whose arm is hurt, broken or cut off. All of it is muscle: the hands are pulled to the
    // place by the arms (hold) and the rest is the pose's, so a blow still moves them as it would. Nobody too far gone to
    // mind does any of it. `lying`: on the floor, the hands only.
    fn tend(&mut self, pose: &mut Pose, dt: f32, person: &Person, rd: &mut Ragdoll, lying: bool) {
        self.favour = None;
        self.hunch = 0.0;
        self.holding = [false; 2];
        self.cradle = ' ';
        let Some(w) = &mut self.wound else { return };
        // A wound on a piece since cut off is tended where the piece was cut from: the stump, held at its end (the hand
        // went after the arm lying on the floor).
        while rd.cut_off(w.seg) {
            let mut root = w.seg;
            while !rd.segs[root].severed {
                root = rd.segs[root].def.parent.unwrap();
            }
            let p = rd.segs[root].def.parent.unwrap();
            w.seg = p;
            w.local = rd.segs[root].def.head - rd.segs[p].def.head;
            w.out = w.local.normalize();
            w.hands = None;
            w.front = None;
        }
        w.t += dt;
        // Quick to it (a third of a second), as much as it hurts, and not at all once the mind is going. (A blow to the
        // head that dazes hurts little, but the hands still go to the face.)
        let name = rd.segs[w.seg].def.name.clone();
        let hurt = self.felt.pain.max(if name == "head" { self.felt.daze } else { 0.0 });
        let e = smooth(w.t / 0.35) * clamp((hurt - 0.05) / 0.2) * clamp((self.will - 0.3) / 0.3);
        if e < 0.02 {
            return;
        }
        let seg = w.seg;
        let m = rd.segs[seg].now;
        let at = m.transform_point(w.local);
        let mut out = (m.rotation * w.out).normalize();
        // Laid on it: just off the skin over it, where the shape inside the flesh stops the hand.
        let mut on = at + out * 0.02;
        let limb = name.ends_with('L') || name.ends_with('R');
        // The side a limb is on is its name's (L the person's own left, at -x in their frame, as the hands' and the
        // pose's L); a wound in the trunk is on the side its place is: +x is the body's right.
        let s = if limb { name.chars().last().unwrap() } else if w.local.x > 0.0 { 'R' } else { 'L' };
        let o = other(s);
        let (size, local_x) = (w.size, w.local.x);
        let _ = local_x;
        let more = |pose: &mut Pose, changes: &[(&'static str, f32)]| {
            if !lying {
                for &(k, a) in changes {
                    add(pose, k, a * e);
                }
            }
        };
        if name.starts_with("upperarm") || name.starts_with("forearm") || name.starts_with("hand") {
            // The hurt arm hugged to the body, the forearm across the front of the belly toward the other side, and held
            // there gently: its reach worked out round the body (arm_to), so that it lies on the belly and is not pulled
            // into it (posed by hand, the forearm went into the belly and the arm shook against it). There the other hand
            // holds it.
            let hand = rd.by_name(&format!("hand{s}"));
            if !lying && !rd.cut_off(hand) {
                let belly = rd.by_name("belly");
                let crate::ragdoll::Shape::Cuboid { centre: c, half: h, .. } = rd.segs[belly].def.shape else { unreachable!() };
                // (Low on the belly and not far across: the other arm reaches over it to the wound. In front is -Z here.)
                let cradle = rd.world_point(belly, Vec3::new(c.x + if s == 'L' { 0.04 } else { -0.04 }, c.y - h.y * 0.2, c.z - h.z - 0.05));
                let reach = self.arm_to(person, rd, s, cradle);
                let all = smooth(e * 2.5);
                self.reach_pose(s, &reach, all, pose);
                set(pose, side("curl", s), 35.0);
                *self.strength.at(Part::arm(s)) *= 1.0 - 0.5 * e;
                self.cradle = s;
            }
            if self.free(rd, o) {
                // The back of the shoulder or arm the other hand cannot get round to is clutched from in front, over the
                // same place on the arm. (Sent after the back, out of its reach, the hand stopped wedged between the chest
                // and the hurt arm held across it, and the two arms shook against each other, 18 to 24 rad/s.)
                let ahead = rd.segs[rd.by_name("chest")].now.rotation * Vec3::NEG_Z;
                // (Decided once for the wound: decided every frame, a reach missing by about the limit went back and forth.)
                let front = match self.wound.as_ref().unwrap().front {
                    Some(f) => f,
                    None => {
                        let f = out.dot(ahead) < -0.3 && self.arm_to(person, rd, o, on).miss > 0.05;
                        self.wound.as_mut().unwrap().front = Some(f);
                        f
                    }
                };
                if front {
                    let [a, b] = rd.segment_ends(seg);
                    let line = b - a;
                    let t = clamp((on - a).dot(line) / line.length_squared());
                    on = a + line * t + ahead * (rd.segs[seg].def.radius + 0.02);
                    out = ahead;
                }
                self.hold(person, rd, o, on, out, e, pose);
            }
            more(pose, &[("spineFlex", 8.0), ("neckFlex", 14.0)]);
        } else if name.starts_with("thigh") || name.starts_with("shin") || name.starts_with("foot") {
            // A hand to a thigh, which it reaches standing (the one on its side, or the other if that one cannot); lower
            // down only lying, curled up to it.
            let by = if self.free(rd, s) { Some(s) } else if self.free(rd, o) { Some(o) } else { None };
            if let Some(by) = by {
                if lying || name.starts_with("thigh") {
                    self.hold(person, rd, by, on, out, e, pose);
                }
            }
            *self.strength.at(Part::leg(s)) *= 1.0 - 0.45 * e;
            self.favour = Some((o, e));
            more(pose, &[(side("knee", s), 16.0), (side("hipFlex", s), 8.0), (side("ankle", s), 6.0), ("spineFlex", 8.0)]);
        } else {
            // The trunk, the neck, the face or the scalp: the free hand that gets nearest it (the arm's own reach worked
            // out round the body, arm_to), and for a big wound (a shotgun's, a rifle's way out) the other over it.
            let stale = match &self.wound.as_ref().unwrap().hands {
                None => true,
                Some(h) => h.iter().any(|&k| !self.free(rd, k)),
            };
            if stale {
                // (Not the hand whose own upper arm lies over the place, an armpit or the flank under it: reaching for it,
                // that arm went up and round itself, flailing.)
                let mut free: Vec<(char, f32)> = Vec::new();
                for k in ['L', 'R'] {
                    if self.free(rd, k) && !self.under(rd, k, on) {
                        let miss = self.arm_to(person, rd, k, on).miss + if k == s { 0.0 } else { 0.02 };
                        free.push((k, miss));
                    }
                }
                free.sort_by(|a, b| a.1.total_cmp(&b.1));
                let n = if size > 6.0 { 2 } else { 1 };
                self.wound.as_mut().unwrap().hands = Some(free.iter().take(n).map(|f| f.0).collect());
            }
            let hands = self.wound.as_ref().unwrap().hands.clone().unwrap_or_default();
            if let Some(&first) = hands.first() {
                self.hold(person, rd, first, on, out, e, pose);
            }
            if let Some(&second) = hands.get(1) {
                let by = if name == "head" { out * 0.025 } else { self.up(rd) * 0.05 };
                self.hold(person, rd, second, on + by, out, e * 0.8, pose);
            }
            if name == "head" {
                // The head down into the hands.
                self.hunch = 10.0 * e;
                more(pose, &[("spineFlex", 10.0), ("neckFlex", 22.0)]);
            } else {
                let belly = name != "chest";
                self.hunch = if belly { 26.0 } else { 12.0 } * e;
                let knee = if belly { 8.0 } else { 0.0 };
                more(pose, &[("spineFlex", if belly { 26.0 } else { 12.0 }), ("neckFlex", 10.0), ("kneeL", knee), ("kneeR", knee)]);
            }
        }
    }

    // An arm's reach (arm_to) laid over the pose by `all` (0 to 1), eased toward over a tenth of a second: the reach is
    // solved again every frame from where the body has just moved to, and now and then from a new start (its seeds), and
    // taken as it came the arm's aim jumped by degrees from one frame to the next and the arm shook after it.
    fn reach_pose(&mut self, s: char, reach: &Reach, all: f32, pose: &mut Pose) {
        for (n, c) in ARM.iter().enumerate() {
            let k = side(c, s);
            let now = get(pose, k);
            set(pose, k, now + (reach.x[n] - now) * all);
        }
        self.ease("arm", &ARM, s, pose, 0.1);
    }

    // The pose's `controls` (on side `s`) eased toward over `tau` seconds, for as long as they are asked for every frame.
    fn ease(&mut self, key: &'static str, controls: &[&str; 4], s: char, pose: &mut Pose, tau: f32) {
        let k = (self.dt / tau).min(1.0);
        let clock = self.clock;
        let at = match self.eased.iter().position(|e| e.0 == key && e.1 == s) {
            Some(n) => n,
            None => {
                self.eased.push((key, s, -1.0, [0.0; 4]));
                self.eased.len() - 1
            }
        };
        let was = &mut self.eased[at];
        let fresh = clock - was.2 > 0.1;
        for (n, c) in controls.iter().enumerate() {
            let want = get(pose, side(c, s));
            was.3[n] = if fresh { want } else { was.3[n] + (want - was.3[n]) * k };
            set(pose, side(c, s), was.3[n]);
        }
        was.2 = clock;
    }

    // Whether a place (world) lies under the upper arm on `s`, within a hand's breadth of it.
    fn under(&self, rd: &Ragdoll, s: char, at: Vec3) -> bool {
        let a = rd.by_name(&format!("upperarm{s}"));
        let elbow = rd.segment_ends(rd.by_name(&format!("upperarm2{s}")))[1];
        let from = rd.segs[a].now.translation;
        let line = elbow - from;
        let t = clamp((at - from).dot(line) / line.length_squared());
        at.distance(from + line * t) < rd.segs[a].def.radius + 0.07
    }

    // Which way is up the trunk.
    fn up(&self, rd: &Ragdoll) -> Vec3 {
        rd.segs[rd.by_name("chest")].now.rotation * Vec3::Y
    }

    // Whether hand `s` can hold anything: an arm with strength in it, not hurt (hit()), broken above the hand or cut off.
    fn free(&self, rd: &Ragdoll, s: char) -> bool {
        self.strength.get(Part::arm(s)) >= 0.05 && !self.hurt[i(s)] && !self.broken(rd, true, s) && !rd.cut_off(rd.by_name(&format!("hand{s}")))
    }

    // Hand `s` put on `at` (world, just off the skin, which faces `out`): the arm's joints posed to reach it (arm_to),
    // blended in by `how` (0 to 1), and the last of the way, and the press on it, by a pull of the hand itself, which its
    // arm pays for at the chest. Where the arm cannot get to it without going through the body, the hand goes as near as
    // it can. On it, it only presses; held up on the way (the other arm, the body), it stays where it got to and stops
    // pulling, and tries again a little later: a hand pulled on through the body fought its shape and shook.
    #[allow(clippy::too_many_arguments)]
    fn hold(&mut self, person: &Person, rd: &mut Ragdoll, s: char, at: Vec3, out: Vec3, how: f32, pose: &mut Pose) {
        let hand = rd.by_name(&format!("hand{s}"));
        if !self.free(rd, s) || how <= 0.05 {
            return;
        }
        self.holding[i(s)] = true;
        // A reach starts from the arm out in front, bent: from where it hangs, the nearest way to a place across the body
        // is through it.
        if how < 0.06 {
            if let Some(arm) = &mut self.arms[i(s)] {
                arm.x = [-40.0, 10.0, 0.0, 80.0];
            }
        }
        // Not inside anything else of the body (a wound on an arm held in against the side): out over it until clear.
        // (Only what it is truly inside: the wound's own limb, and anything merely near, left the hand pushed out 6 to 8
        // cm.)
        let wound = self.wound.as_ref().map(|w| w.seg);
        let wname = wound.map(|w| rd.segs[w].def.name.clone()).unwrap_or_default();
        let limb = if wname.ends_with('L') || wname.ends_with('R') { wname.trim_end_matches(['L', 'R']).trim_end_matches('2').to_string() } else { String::new() };
        let skip = |k: usize| {
            let n = &rd.segs[k].def.name;
            Some(k) == wound
                || ((n.starts_with("upperarm") || n.starts_with("forearm") || n.starts_with("hand")) && n.ends_with(s))
                || (!limb.is_empty() && n.trim_end_matches(['L', 'R']).trim_end_matches('2') == limb && n.ends_with(wname.chars().last().unwrap()))
        };
        let mut at = at;
        for _ in 0..3 {
            if !rd.attached.iter().any(|&k| !skip(k) && rd.outside(k, at) < -0.005) {
                break;
            }
            at += out * 0.02;
        }
        let now = rd.middle(hand);
        // Where it is going and where it was held up are kept as the chest carries them, and it is sent again only when
        // the place has moved on the body. (Kept in the room, a body swaying 5 cm sent the hand off again, and one held up
        // was pulled back to where the room had been; with a try again every second and a half besides, a hand that could
        // not get to a shoulder or an armpit went back and forth at it for as long as it hurt, the arm waving.)
        let chest = rd.by_name("chest");
        let (cq, cp) = (rd.segs[chest].now.rotation, rd.segs[chest].now.translation);
        let local = cq.inverse() * (at - cp);
        let clock = self.clock;
        let renew = self.grips[i(s)].as_ref().is_none_or(|g| g.to.distance(local) > 0.05);
        if renew {
            self.grips[i(s)] = Some(Grip { to: local, best: f32::INFINITY, since: clock, hold: None });
        }
        let held = self.grips[i(s)].as_ref().unwrap().hold.map(|h| cq * h + cp);
        let reach = self.arm_to(person, rd, s, held.unwrap_or(at));
        let to = held.unwrap_or(if reach.miss > 0.03 { reach.hand } else { at });
        let d = now.distance(to);
        // (On it: the hand's middle within its own half thickness and a little of where it is going, which lies just off
        // the skin.)
        let touching = d < 0.06;
        let g = self.grips[i(s)].as_mut().unwrap();
        if g.hold.is_none() && d < g.best - 0.01 {
            g.best = d;
            g.since = clock;
        }
        if g.hold.is_none() && !touching && clock - g.since > 0.3 {
            g.hold = Some(cq.inverse() * (now - cp));
        }
        let holding = g.hold.is_some();
        // A hand goes all the way or not at all: how much it hurts is in how hard it presses (and how bent over they are).
        let all = smooth(how * 2.5);
        self.reach_pose(s, &reach, all, pose);
        set(pose, side("curl", s), 25.0);
        // On it, or held up on the way, the arm lets the hand lie where it is, its muscles easing off rather than driving
        // it on into what stopped it. (On it, a third: the arm's aim is just off the skin of something that moves, and at
        // three quarters the arm's springs drove the hand on into it, 30 N at the hand for 2 cm, and it rattled there.)
        if holding || touching {
            *self.strength.at(Part::arm(s)) *= if holding { 0.6 } else { 0.35 };
        }
        if holding {
            return;
        }
        let carrier = wound;
        if touching {
            // Pressed into the skin a little, as firmly as it hurts.
            let into = at - out * 0.03;
            let most = 12.0 * self.will * how;
            self.act(move |rd, dt| {
                let f = motor::reach(rd, hand, into, 25.0, 1.5, most, carrier);
                motor::push(rd, hand, f, &[chest], dt);
            });
        } else {
            let most = 30.0 * self.will * how;
            self.act(move |rd, dt| {
                let f = motor::reach(rd, hand, to, 60.0, 1.5, most, carrier);
                motor::push(rd, hand, f, &[chest], dt);
            });
        }
    }

    // The shoulder and elbow (pose controls, degrees) that put the middle of hand `s` at `at` (world), as near as the arm
    // reaches without going through the trunk, from where they were asked to be last time: damped least squares on the
    // arm as the skeleton turns it (person.rs: twist, then out to the side, then forward, at the shoulder; the elbow on
    // its own hinge), in the chest's own frame, where the shoulder does not move. The twist is what takes a bent arm's
    // hand across the front of the body (to the belly, the other arm); it is kept as little as will do. Also `miss`, how
    // far from `at` the hand stays, and `hand`, where it gets to (world).
    fn arm_to(&mut self, person: &Person, rd: &Ragdoll, s: char, at: Vec3) -> Reach {
        let chest = rd.by_name("chest");
        if self.arms[i(s)].is_none() {
            let b = |n: &str| person.body.bone(&format!("{n}.{s}")).head;
            let hand = rd.by_name(&format!("hand{s}"));
            let relaxed = poses::relaxed();
            self.arms[i(s)] = Some(Arm {
                x: [get(&relaxed, side("shoulderAbduct", s)), get(&relaxed, side("shoulderFlex", s)), 0.0, 30.0],
                seed: [0.0; 4],
                frame: 0,
                goal: None,
                s: b("upperarm01"),
                upper: b("lowerarm01") - b("upperarm01"),
                fore: b("wrist") + rd.segs[hand].def.centre - b("lowerarm01"),
                axes: ARM.map(|k| person.hinges[side(k, s)].axis),
                boxes: [(rd.by_name("chest"), Vec3::ZERO, Quat::IDENTITY), (rd.by_name("belly"), Vec3::ZERO, Quat::IDENTITY), (rd.by_name("pelvis"), Vec3::ZERO, Quat::IDENTITY)],
                reach: 0.0,
            });
        }
        let arm = self.arms[i(s)].as_mut().unwrap();
        // The place as it would be with the chest standing at rest, and the trunk's boxes as they stand to the chest now.
        let c = &rd.segs[chest];
        let into = c.now.rotation.inverse();
        let goal = into * (at - c.now.translation) + c.def.head;
        for b in &mut arm.boxes {
            let seg = &rd.segs[b.0];
            b.1 = into * (seg.now.translation - c.now.translation) + c.def.head;
            b.2 = (into * seg.now.rotation).inverse();
        }
        let boxes: Vec<(Vec3, Vec3, Vec3, Quat)> = arm.boxes.iter().map(|b| {
            let crate::ragdoll::Shape::Cuboid { centre, half, .. } = rd.segs[b.0].def.shape else { unreachable!() };
            (centre, half, b.1, b.2)
        }).collect();
        let relaxed_flex = get(&poses::relaxed(), side("shoulderFlex", s));
        // From where the arm was; and, when the place has moved or the hand is not getting there, from each of a few ways
        // of holding the arm (up in front of the chest, across it, down by the side), which the arm hanging does not find
        // its way to: the best, unless it is barely better, so the arm does not flick from one to the other.
        let mut x = arm.x;
        let mut miss = descend(arm, &boxes, goal, &mut x, 3, relaxed_flex);
        let moved = arm.goal.is_none_or(|g| g.distance_squared(goal) > 0.02 * 0.02);
        let again = miss > 0.03 && {
            let f = arm.frame;
            arm.frame += 1;
            f % 8 == 0
        };
        if moved || again {
            arm.goal = Some(goal);
            for seed in SEEDS {
                let mut y = seed;
                let m = descend(arm, &boxes, goal, &mut y, 12, relaxed_flex);
                if m < miss - 0.03 {
                    x = y;
                    miss = m;
                }
            }
            descend(arm, &boxes, goal, &mut x, 1, relaxed_flex);
        }
        arm.x = x;
        let (hand, _, _) = hand_at(arm, &x);
        Reach { x, miss: arm.reach, hand: c.now.rotation * (hand - c.def.head) + c.now.translation }
    }

    // The leg's joints (pose controls) that put its ankle at `ankle` (world) with the foot level with the floor, from the
    // hip where it is or, given `hip_y`, from the hip at that height under the pelvis set upright where it faces now:
    // what the leg should be for the body to stand over that foot, so that the hip holds the pelvis upright to it. (Set
    // to the way they mean to face instead, a pelvis twisted by a blow fought the planted leg and dragged the foot.)
    #[allow(clippy::too_many_arguments)]
    fn leg_to(&self, rd: &Ragdoll, s: char, ankle: Vec3, pose: &mut Pose, f: Vec3, hip_y: Option<f32>, upright: bool, shift: Option<Vec3>) {
        let leg = self.leg[i(s)];
        let q = rd.segs[rd.by_name("pelvis")].now.rotation;
        let turn = if hip_y.is_none() || !upright { q } else { yaw(heading_of(q)) };
        let mut v = ankle - rd.segs[rd.by_name(&format!("thigh{s}"))].now.translation;
        if let Some(shift) = shift {
            v -= shift;
        }
        if let Some(h) = hip_y {
            v.y = ankle.y - h;
        }
        let v = turn.inverse() * v;
        let [flex, abduct, knee, shin] = leg_angles(v, &leg);
        let tip = (turn * Vec3::Y).dot(f).clamp(-1.0, 1.0).asin();
        set(pose, side("hipFlex", s), (flex - leg.flex) / RAD);
        set(pose, side("hipAbduct", s), (abduct - leg.abduct) / RAD);
        set(pose, side("knee", s), (knee - leg.knee) / RAD);
        // A shin leaning forward over a level foot is a foot bent up toward it; a forward-tipped pelvis leans it back.
        set(pose, side("ankle", s), (leg.shin - shin + tip) / RAD);
    }

    // The head turned to whoever is looking at them, as far as a neck turns.
    fn look(&self, pose: &mut Pose, rd: &Ragdoll, eye: Option<Vec3>, weight: f32) {
        let Some(eye) = eye else { return };
        if weight <= 0.0 {
            return;
        }
        let head = rd.segs[rd.by_name("head")].now.translation;
        let chest = rd.segs[rd.by_name("chest")].now.rotation;
        let v = chest.inverse() * (eye - head);
        // (Ahead in the chest's own frame is -Z here.)
        let turn = v.x.atan2(-v.z).clamp(-1.1, 1.1);
        let up = v.y.atan2(v.x.hypot(v.z)).clamp(-0.6, 0.5);
        add(pose, "neckTwist", turn * self.look_sign * weight / RAD);
        add(pose, "neckFlex", -up * weight / RAD);
    }

    // --- going down --------------------------------------------------------------------------------------------------

    // Falling: the legs give, and anyone awake enough puts their hands out the way they are going.
    fn fall(&mut self, _dt: f32, rd: &mut Ragdoll, heard: &mut Vec<Heard>, rng: &mut Rng) -> Pose {
        let pose = self.fall_pose(rd);
        // The body meeting the floor, heard once.
        let trunk = ["pelvis", "belly", "chest"].map(|n| rd.by_name(n));
        if !self.landed && trunk.iter().any(|&s| rd.lowest(s) < self.floor + TOUCH) {
            self.landed = true;
            heard.push(Heard { name: "body-fall", at: rd.centre(), gain: clamp(0.4 + self.vel.y.abs() / 4.0) });
        }
        if (self.com.y - self.floor < self.stand.pelvis * 0.5 && self.vel.length() < 0.5 && self.t > 0.4) || self.t > 4.0 {
            self.go(State::Down, Mode::None, rng);
        }
        pose
    }

    fn fall_pose(&mut self, rd: &mut Ragdoll) -> Pose {
        let will = self.will;
        let chest = rd.by_name("chest");
        let cq = rd.segs[chest].now.rotation;
        let mut flat = Vec3::new(self.vel.x, 0.0, self.vel.z);
        if flat.length() < 0.3 {
            let up = cq * Vec3::Y;
            flat = Vec3::new(up.x, 0.0, up.z);
        }
        let going = if flat.length() > 1e-3 { flat.normalize() } else { facing(self.heading) };
        let front = cq * Vec3::NEG_Z;
        let right = cq * Vec3::X;
        let ahead = going.dot(front);
        let aside = going.dot(right);
        let way = if ahead > 0.45 { Way::Ahead } else if ahead < -0.45 { Way::Behind } else { Way::Side };
        let pose = braced(way, if aside < 0.0 { -1.0 } else { 1.0 }, smooth(self.t * 2.5));
        let s = &mut self.strength;
        s.leg_l *= 0.3;
        s.leg_r *= 0.3;
        s.trunk *= 0.5;
        // The hands themselves sent toward the floor where it will be hit.
        if will > 0.3 {
            for k in ['L', 'R'] {
                let hand = rd.by_name(&format!("hand{k}"));
                let arm = self.strength.get(Part::arm(k));
                if arm == 0.0 || self.broken(rd, true, k) {
                    continue;
                }
                let mut spot = self.com + going * 0.5 + right * if k == 'R' { 0.22 } else { -0.22 };
                spot.y = self.floor + 0.08;
                self.act(move |rd, dt| {
                    let f = motor::reach(rd, hand, spot, 120.0, 3.0, 70.0 * arm * will, None);
                    motor::push(rd, hand, f, &[chest], dt);
                });
            }
        }
        pose
    }

    // --- on the floor ------------------------------------------------------------------------------------------------

    fn down(&mut self, dt: f32, person: &Person, rd: &mut Ragdoll, eye: Option<Vec3>, rng: &mut Rng) -> Pose {
        self.lying += dt;
        if self.mode == Mode::None || self.mode_done() {
            self.choose(rd);
        }
        match self.mode {
            Mode::Roll => self.roll(rd, rng),
            Mode::Push | Mode::Lunge | Mode::Rise => self.rise(dt, person, rd, eye, rng),
            Mode::Crawl => self.crawl(rd, eye),
            Mode::Creep => self.creep(dt, rd, eye),
            Mode::Writhe => self.writhe(dt, person, rd),
            Mode::Rest => {
                self.strength.scale(0.15);
                let mut pose = rest();
                self.look(&mut pose, rd, eye, self.felt.conscious * 0.6);
                self.strength.neck = self.will * 0.6;
                pose
            }
            _ => {
                self.strength.scale(0.0);
                rest()
            }
        }
    }

    // Whether what they are doing on the floor should be thought about again.
    fn mode_done(&self) -> bool {
        let w = self.will;
        match self.mode {
            Mode::Still => w > 0.15,
            _ if w < 0.12 => true,
            Mode::Rest | Mode::Writhe => self.t > 1.0,
            Mode::Crawl | Mode::Creep => w < 0.35 || self.t > 12.0,
            _ => false,
        }
    }

    // What someone on the floor does next, by how they are.
    fn choose(&mut self, rd: &Ragdoll) {
        let v = self.felt.clone();
        let w = self.will;
        let mode = |b: &mut Behaviour, m: Mode, next: Mode| {
            if m != b.mode {
                b.t = 0.0;
            }
            b.mode = m;
            b.next = next;
        };
        if w < 0.12 {
            return mode(self, Mode::Still, Mode::None);
        }
        // Coming round, they lie a while first, longer the more muddled.
        if self.mode == Mode::Still {
            self.wait = self.wait.max(self.lying + 3.0 + 5.0 * v.daze);
        }
        if self.grabbed {
            return mode(self, Mode::Writhe, Mode::None);
        }
        let prone = self.front(rd).y < -0.5;
        // (An arm broken is no use to drag the body with: both broken, they lie where they are.)
        let arms = ['L', 'R'].iter().any(|&k| self.strength.get(Part::arm(k)) > 0.3 && !self.broken(rd, true, k));
        if self.can_stand(rd) && w > 0.55 && v.pain < 0.75 && self.lying > self.wait {
            return if prone { mode(self, Mode::Push, Mode::None) } else { mode(self, Mode::Roll, Mode::Push) };
        }
        if !self.can_stand(rd) && w > 0.4 && arms && self.lying > 2.5 + v.pain * 4.0 {
            // On hands and knees with one leg hurt and the rest sound (the bad one held off the floor and dragged); on the
            // elbows, the legs trailing, when neither leg will take a knee or an arm is gone.
            let kind = if self.on_all_fours(rd) { Mode::Creep } else { Mode::Crawl };
            return if prone { mode(self, kind, Mode::None) } else { mode(self, Mode::Roll, kind) };
        }
        if v.pain > 0.35 || v.lost > 0.2 {
            return mode(self, Mode::Writhe, Mode::None);
        }
        mode(self, Mode::Rest, Mode::None)
    }

    // Which way the chest faces: down when lying on the front.
    fn front(&self, rd: &Ragdoll) -> Vec3 {
        rd.segs[rd.by_name("chest")].now.rotation * Vec3::NEG_Z
    }

    // Only the limbs on the floor can push the body off it.
    fn limbs_down(&self, rd: &Ragdoll) -> Vec<usize> {
        self.touching.iter().copied().filter(|&s| rd.segs[s].def.limb || rd.segs[s].def.name.starts_with("upperarm") || rd.segs[s].def.name.starts_with("hand")).collect()
    }

    // Over onto the front: a knee drawn up and pushed off, an arm thrown across.
    fn roll(&mut self, rd: &mut Ragdoll, rng: &mut Rng) -> Pose {
        let front = self.front(rd);
        let (chest, pelvis) = (rd.by_name("chest"), rd.by_name("pelvis"));
        let along = (rd.segs[chest].now.translation - rd.segs[pelvis].now.translation).normalize();
        if front.y < -0.6 {
            self.mode = if self.next == Mode::None { Mode::Rest } else { self.next };
            self.t = 0.0;
            return rest();
        }
        if self.t > 5.0 {
            return self.fail(rng);
        }
        // Turning the front down about the body's own length: which way round is shorter.
        let way = { let w = front.cross(Vec3::NEG_Y).dot(along); if w < 0.0 { -1.0 } else { 1.0 } };
        let right = rd.segs[chest].now.rotation * Vec3::X;
        let toward = if along.cross(right).dot(Vec3::NEG_Y) * way > 0.0 { 'R' } else { 'L' };
        let away = other(toward);
        let pose = over(rest(), &[(side("hipFlex", away), 55.0), (side("knee", away), 85.0), (side("shoulderFlex", away), 95.0),
            (side("shoulderAbduct", away), -40.0), (side("elbow", away), 20.0), (side("shoulderAbduct", toward), 30.0), ("neckFlex", 15.0)]);
        // The arm on the side they roll onto up past the head, out of the way: left at the side it was rolled on and
        // trapped under the chest, and the crawl after it wrenched that elbow 30 to 90 degrees sideways for seconds.
        let pose = over(pose, &[(side("shoulderFlex", toward), 150.0), (side("elbow", toward), 30.0)]);
        // The push off the floor with that leg and arm, as the turn it gives the trunk about its own length, easing off
        // as it gets going: given back to the limbs on the floor instead, it only wrung the trunk against them.
        let most = 200.0 * self.will;
        if !self.limbs_down(rd).is_empty() {
            self.act(move |rd, dt| {
                let k = clamp(1.0 - rd.segs[chest].spin.dot(along) * way / 2.5) * most * way * dt;
                rd.turn(chest, along * (k * 0.6));
                rd.turn(pelvis, along * (k * 0.4));
            });
        }
        pose
    }

    // Up from the front: onto hands and knees, up onto the knees, one foot forward, and up. Each stage leans on the floor
    // through the limbs on it, as hard as the person still can, and gives up if it does not get there in time.
    fn rise(&mut self, dt: f32, person: &Person, rd: &mut Ragdoll, eye: Option<Vec3>, rng: &mut Rng) -> Pose {
        let will = self.will;
        if will < 0.4 || !self.can_stand(rd) {
            return self.fail(rng);
        }
        let (pelvis, chest) = (rd.by_name("pelvis"), rd.by_name("chest"));
        let head = rd.segs[rd.by_name("head")].now.translation;
        let pp = rd.segs[pelvis].now.translation;
        if self.t < dt * 1.5 && self.mode == Mode::Push {
            let to = head - pp;
            self.heading = to.x.atan2(-to.z);
        }
        let limbs = self.limbs_down(rd);
        let face = yaw(self.heading);
        let (stand, all4, kneel) = (self.stand, self.all4, self.kneel);
        let mut lift = (all4.pelvis, all4.chest);
        let (mut most, mut time, mut over_at) = (0.75, 4.0, None);
        let (mut pose, tip, done);
        match self.mode {
            Mode::Push => {
                pose = self::all4();
                tip = 90.0;
                done = pp.y - self.floor > all4.pelvis * 0.85 && rd.segs[chest].now.translation.y - self.floor > all4.chest * 0.85 && self.t > 0.9;
            }
            Mode::Lunge => {
                // One foot brought forward under the body, the trunk coming up off the hands.
                let k = smooth(self.t / 0.8);
                pose = poses::mix(&self::all4(), &lunge(), k);
                tip = 90.0 - 45.0 * k;
                lift = (kneel.pelvis, kneel.pelvis + (kneel.chest - kneel.pelvis) * 0.7);
                let foot = rd.by_name("footR");
                let mut spot = pp + facing(self.heading) * 0.4;
                spot.y = self.floor + self.foot.1;
                self.act(move |rd, dt| {
                    let f = motor::reach(rd, foot, spot, 120.0, 5.0, 220.0 * will, None);
                    motor::push(rd, foot, f, &[pelvis], dt);
                });
                done = self.t > 0.9 && (rd.middle(foot).distance(spot) < 0.15 || self.t > 1.5);
                time = 2.5;
            }
            _ => {
                // And up off the front foot.
                let k = smooth(self.t / 1.3);
                pose = poses::mix(&lunge(), &poses::stand(self.clock, 1.0, 0.0), k);
                tip = 45.0 * (1.0 - k);
                let kn = (kneel.pelvis, kneel.pelvis + (kneel.chest - kneel.pelvis) * 0.7);
                lift = (kn.0 + (stand.pelvis - kn.0) * k, kn.1 + (stand.chest - kn.1) * k);
                most = 0.85;
                // Standing once the hips are up and the weight is over the feet.
                let feet = [rd.by_name("footL"), rd.by_name("footR")];
                // Up mostly over the front foot, the back leg straightening behind: they come up into a stride and stand
                // in it, both feet down and the weight between them. (Brought up beside the front one at once, the back
                // foot left them on one leg with the weight still behind it, and they sat back down.)
                let front = rd.segs[feet[1]].now.translation;
                let back = rd.segs[feet[0]].now.translation;
                let mut o = back.lerp(front, 0.7) + facing(self.heading) * self.foot.2;
                o.y = 0.0;
                over_at = Some(o);
                // (And only once the trunk is upright, within 14 degrees, at the end of the rise: stood up still bent over,
                // the hips' muscles straightening it swung the legs on and they stepped and went down again.)
                let upright = rd.segs[pelvis].now.rotation.mul_vec3(Vec3::Y).y > 0.97;
                done = self.t > 1.3 && upright && pp.y - self.floor > stand.pelvis * 0.93 && feet.iter().all(|&f| rd.lowest(f) < self.floor + TOUCH)
                    && outside(&footprint(rd, &feet).0, self.com.x, self.com.z) < -0.03 && self.vel.x.hypot(self.vel.z) < 0.15;
                time = 3.5;
            }
        }
        // The legs' poses are written for an upright trunk; with it tipped forward the hips bend that much more to keep
        // the thighs where they were meant to be (on all fours, straight down).
        if self.mode != Mode::Push {
            add(&mut pose, "hipFlexL", tip);
            add(&mut pose, "hipFlexR", tip);
        }
        if done {
            let next = match self.mode {
                Mode::Push => Some(Mode::Lunge),
                Mode::Lunge => Some(Mode::Rise),
                _ => None,
            };
            let Some(next) = next else {
                self.tries = 0;
                self.go(State::Stand, Mode::None, rng);
                self.settle = 2.5;
                return self.stand(dt, person, rd, eye, rng);
            };
            self.mode = next;
            self.t = 0.0;
            return pose;
        }
        if self.t > time {
            // Nearly up off the front foot, both feet down, they stand and let the balance have it (it steps or it goes
            // over): failed there, the muscles let go all at once and a body all but standing dropped to the floor in a
            // second, and got up and dropped again, up and down.
            let feet = [rd.by_name("footL"), rd.by_name("footR")];
            if self.mode == Mode::Rise && pp.y - self.floor > (kneel.pelvis + stand.pelvis) / 2.0 && feet.iter().all(|&f| rd.lowest(f) < self.floor + TOUCH) {
                self.tries = 0;
                self.go(State::Stand, Mode::None, rng);
                self.settle = 2.5;
                return self.stand(dt, person, rd, eye, rng);
            }
            return self.fail(rng);
        }
        // The trunk lifted toward the stage's height and turned toward its lean, pushing down through the limbs.
        let want = face * pitch(tip * RAD);
        let weight = rd.mass * G;
        let floor = self.floor;
        for (seg, height, share) in [(pelvis, lift.0, 0.45), (chest, lift.1, 0.55)] {
            let limbs = limbs.clone();
            self.act(move |rd, dt| {
                let v = rd.segs[seg].vel;
                let m = rd.mass * share;
                let up = (m * (G * 0.55 + 30.0 * (floor + height - rd.segs[seg].now.translation.y) - 9.0 * v.y)).clamp(0.0, weight * share * most * will);
                // Braced against going anywhere but up (the limbs on the floor hold the body's drift), or, rising off the
                // front foot, carried forward over it.
                let mut force = Vec3::new(-v.x * 4.0 * m, up, -v.z * 4.0 * m);
                if let Some(o) = over_at {
                    let com = rd.com();
                    let cap = 0.25 * weight * share;
                    force.x += (m * 12.0 * (o.x - com.x)).clamp(-cap, cap);
                    force.z += (m * 12.0 * (o.z - com.z)).clamp(-cap, cap);
                }
                motor::push(rd, seg, force, &limbs, dt);
                // The lean steered like the roll: as a turn of the trunk itself, while there is floor to push on.
                if !limbs.is_empty() {
                    let spin = spin_of_trunk(rd);
                    let t = motor::toward(rd, seg, want, 30.0, 12.0, 160.0 * will, Some(spin));
                    rd.turn(seg, t * dt);
                }
            });
        }
        pose
    }

    // A stage of getting up that did not work: back down for a while, and another go if they still can.
    fn fail(&mut self, rng: &mut Rng) -> Pose {
        self.tries += 1;
        // Longer between tries the more of them have failed.
        self.wait = self.lying + 2.0 + rng.next() * 3.0 + self.tries.min(4) as f32 * 3.0;
        self.mode = Mode::Rest;
        self.t = 0.0;
        rest()
    }

    // Whether they can go on hands and knees: both arms sound, the cord whole, and one leg sound to kneel on.
    fn on_all_fours(&self, rd: &Ragdoll) -> bool {
        let legs = ['L', 'R'].iter().filter(|&&k| !self.broken(rd, false, k) && !rd.cut_off(rd.by_name(&format!("foot{k}")))).count();
        !self.felt.paralysed_legs && !self.felt.paralysed_arms && legs > 0
            && ['L', 'R'].iter().all(|&k| !self.broken(rd, true, k) && !rd.cut_off(rd.by_name(&format!("hand{k}"))))
    }

    // Away from whoever did it: the heading from the eye to the chest, taken once as the mode begins.
    fn away(&mut self, rd: &Ragdoll, eye: Option<Vec3>, dt: f32) {
        if self.t < dt * 1.5 {
            let eye = eye.unwrap_or(Vec3::ZERO);
            let c = rd.segs[rd.by_name("chest")].now.translation;
            self.heading = (c.x - eye.x).atan2(-(c.z - eye.z));
        }
    }

    // On hands and knees, away from whoever did it: a hand and the knee on the other side forward together, then the
    // other two, the trunk held up level over them by the limbs on the floor (as getting up holds it, rise) and carried on
    // by them. A broken leg is not posed (guard): it trails behind on the floor.
    fn creep(&mut self, dt: f32, rd: &mut Ragdoll, eye: Option<Vec3>) -> Pose {
        let will = self.will;
        if self.front(rd).y > -0.3 {
            self.mode = Mode::Roll;
            self.next = Mode::Creep;
            self.t = 0.0;
            return rest();
        }
        let (pelvis, chest) = (rd.by_name("pelvis"), rd.by_name("chest"));
        self.away(rd, eye, dt);
        // Up onto all fours first, then on at about a stride a second and a half.
        let up = smooth(self.t / 1.2);
        self.phase += dt * (2.0 * PI / 1.5) * (0.5 + 0.5 * will) * up;
        let mut pose = self::all4();
        let phase = self.phase;
        let swing = |k: f32| (phase + k).sin().max(0.0) * up;
        for (hand, knee, k) in [('L', 'R', 0.0), ('R', 'L', PI)] {
            // The hand lifted and carried forward (the elbow bending to clear the floor), the knee drawn up under the hips.
            add(&mut pose, side("shoulderFlex", hand), 26.0 * swing(k) - 8.0 * swing(k + PI));
            add(&mut pose, side("elbow", hand), 25.0 * swing(k));
            // (No further than a few degrees past square to the trunk: drawn up further, the thigh went into the belly.)
            add(&mut pose, side("hipFlex", knee), 12.0 * swing(k) - 12.0 * swing(k + PI));
            add(&mut pose, side("knee", knee), 15.0 * swing(k));
        }
        set(&mut pose, "spineSide", 5.0 * phase.sin());
        let f = facing(self.heading);
        let limbs = self.limbs_down(rd);
        let want = yaw(self.heading) * pitch(PI / 2.0);
        let weight = rd.mass * G;
        let pace = 0.3 * will * up;
        // The hips a thigh and a knee's thickness up off the floor, the trunk level with them. (measure()'s all-fours
        // heights, 0.79 m at the hips, are of legs left nearly straight: held up toward them, the lift ran out and the
        // body sagged.)
        let hips = self.leg[0].a + 0.06;
        let floor = self.floor;
        for (seg, share) in [(pelvis, 0.45), (chest, 0.55)] {
            let limbs = limbs.clone();
            self.act(move |rd, dt| {
                if limbs.is_empty() {
                    return;
                }
                let v = rd.segs[seg].vel;
                let m = rd.mass * share;
                let lift = (m * (G * 0.55 + 30.0 * (floor + hips - rd.segs[seg].now.translation.y) - 9.0 * v.y)).clamp(0.0, weight * share * 0.8 * will);
                // Carried on at the pace along the way they face, held from drifting across it.
                let along = v.dot(f);
                let push = (m * 6.0 * (pace - along)).clamp(-0.15 * weight * share, 0.15 * weight * share);
                let force = Vec3::new(f.x * push - (v.x - f.x * along) * 4.0 * m, lift, f.z * push - (v.z - f.z * along) * 4.0 * m);
                motor::push(rd, seg, force, &limbs, dt);
                let spin = spin_of_trunk(rd);
                let t = motor::toward(rd, seg, want, 30.0, 12.0, 160.0 * will, Some(spin));
                rd.turn(seg, t * dt);
            });
        }
        pose
    }

    // Dragging themselves away from whoever did it, on their elbows, the legs trailing.
    fn crawl(&mut self, rd: &mut Ragdoll, eye: Option<Vec3>) -> Pose {
        let will = self.will;
        let dt = self.dt;
        // (Flat on the front first: crawling from three-quarters over, the arm underneath was dragged under the hips.)
        if self.front(rd).y > -0.5 {
            self.mode = Mode::Roll;
            self.next = Mode::Crawl;
            self.t = 0.0;
            return rest();
        }
        let chest = rd.by_name("chest");
        self.away(rd, eye, dt);
        self.phase += dt * (2.0 * PI / 1.9) * (0.5 + 0.5 * will);
        // (Into it from lying as they lay, over half a second: taken from beside the body to out past the head at once,
        // the arms were flung up through the floor and spun at 100 rad/s.)
        let pose = poses::mix(&rest(), &crawling(self.phase), smooth(self.t / 0.5));
        self.strength.leg_l *= 0.12;
        self.strength.leg_r *= 0.12;
        let f = facing(self.heading);
        let limbs = self.limbs_down(rd);
        for k in ['L', 'R'] {
            let hand = rd.by_name(&format!("hand{k}"));
            let arm = self.strength.get(Part::arm(k));
            if arm == 0.0 || self.broken(rd, true, k) {
                continue;
            }
            let reaching = self.phase.cos() * if k == 'L' { 1.0 } else { -1.0 };
            if reaching > 0.0 {
                // (Out past the side of the head: at 20 cm either side the forearm went across the face.)
                let mut spot = rd.segs[chest].now.translation + f * 0.5 + right_of(f) * if k == 'R' { 0.36 } else { -0.36 };
                spot.y = self.floor + 0.04;
                self.act(move |rd, dt| {
                    let force = motor::reach(rd, hand, spot, 80.0, 2.0, 45.0 * arm * will, None);
                    motor::push(rd, hand, force, &[chest], dt);
                });
            } else {
                // The forearm on the floor (or the hand, whichever is down) holds, and the body is pulled up to it.
                let fore = rd.by_name(&format!("forearm2{k}"));
                let on = if rd.lowest(fore) < rd.lowest(hand) { fore } else { hand };
                if rd.lowest(on) > self.floor + TOUCH * 2.0 {
                    continue;
                }
                let pull = -reaching * 230.0 * arm * will;
                self.act(move |rd, dt| {
                    motor::push(rd, chest, f * pull, &[on], dt);
                    motor::push(rd, on, Vec3::new(0.0, -pull * 0.7, 0.0), &[chest], dt);
                });
            }
        }
        let along = yaw(self.heading) * pitch(PI / 2.0);
        self.act(move |rd, dt| {
            let spin = spin_of_trunk(rd);
            let t = motor::toward(rd, chest, along, 8.0, 10.0, 80.0 * will, Some(spin));
            motor::turn(rd, chest, t, &limbs, dt);
        });
        pose
    }

    // Curled round it, rocking, a hand pressed to where it hurts.
    fn writhe(&mut self, dt: f32, person: &Person, rd: &mut Ragdoll) -> Pose {
        let will = self.will;
        let pain = self.felt.pain;
        let mut pose = curled(self.clock, pain);
        // (The arms keep enough to hold the wound.)
        let s = &mut self.strength;
        s.arm_l *= 0.8;
        s.arm_r *= 0.8;
        s.trunk *= 0.45;
        s.neck *= 0.45;
        s.leg_l *= 0.45;
        s.leg_r *= 0.45;
        self.tend(&mut pose, dt, person, rd, true);
        // Rolling from side to side with it.
        let rock = (self.clock * 0.8).sin() * 30.0 * pain * will;
        let (chest, pelvis) = (rd.by_name("chest"), rd.by_name("pelvis"));
        let along = (rd.segs[chest].now.translation - rd.segs[pelvis].now.translation).normalize();
        let limbs = self.limbs_down(rd);
        self.act(move |rd, dt| motor::turn(rd, chest, along * rock, &limbs, dt));
        pose
    }
}

// The trunk's spin as a whole (pelvis, belly and chest by their weight): what turns given to the trunk are damped
// against (motor.rs `toward`).
fn spin_of_trunk(rd: &Ragdoll) -> Vec3 {
    let mut spin = Vec3::ZERO;
    let mut mass = 0.0;
    for n in ["pelvis", "belly", "chest"] {
        let s = &rd.segs[rd.by_name(n)];
        spin += s.spin * s.def.mass;
        mass += s.def.mass;
    }
    spin / mass
}

// --- geometry --------------------------------------------------------------------------------------------------------

// The ground the feet cover: the corners of each foot's sole, their hull on the floor (as (x, z)), and its middle.
fn footprint(rd: &Ragdoll, feet: &[usize]) -> (Vec<[f32; 2]>, Vec3) {
    let mut points = Vec::new();
    for &foot in feet {
        let crate::ragdoll::Shape::Cuboid { centre: c, half: h, .. } = rd.segs[foot].def.shape else { unreachable!() };
        for [x, z] in [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]] {
            let corner = rd.world_point(foot, Vec3::new(c.x + x * h.x, c.y - h.y, c.z + z * h.z));
            points.push([corner.x, corner.z]);
        }
    }
    let hull = convex_hull(points);
    let mut centre = Vec3::ZERO;
    for [x, z] in &hull {
        centre.x += x / hull.len() as f32;
        centre.z += z / hull.len() as f32;
    }
    (hull, centre)
}

// Andrew's monotone chain: the hull of 2D points, counter-clockwise.
pub fn convex_hull(mut p: Vec<[f32; 2]>) -> Vec<[f32; 2]> {
    p.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    let cross = |o: [f32; 2], a: [f32; 2], b: [f32; 2]| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<[f32; 2]> = Vec::new();
    for &q in &p {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], q) <= 0.0 {
            lower.pop();
        }
        lower.push(q);
    }
    let mut upper: Vec<[f32; 2]> = Vec::new();
    for &q in p.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], q) <= 0.0 {
            upper.pop();
        }
        upper.push(q);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

// How far a point lies outside a counter-clockwise convex polygon (less than zero inside): its distance past the edge
// it is furthest past.
pub fn outside(hull: &[[f32; 2]], x: f32, z: f32) -> f32 {
    let mut most = f32::NEG_INFINITY;
    for k in 0..hull.len() {
        let [ax, az] = hull[k];
        let [bx, bz] = hull[(k + 1) % hull.len()];
        let (ex, ez) = (bx - ax, bz - az);
        let n = ex.hypot(ez).max(1e-9);
        most = most.max(((x - ax) * ez - (z - az) * ex) / n);
    }
    most
}

// How far a point inside a counter-clockwise convex polygon is from its edge going along (dx, dz); 0 from outside.
pub fn inside(hull: &[[f32; 2]], x: f32, z: f32, dx: f32, dz: f32) -> f32 {
    let n = dx.hypot(dz).max(1e-9);
    let (dx, dz) = (dx / n, dz / n);
    let mut most = f32::INFINITY;
    for k in 0..hull.len() {
        let [ax, az] = hull[k];
        let [bx, bz] = hull[(k + 1) % hull.len()];
        let (ex, ez) = (bx - ax, bz - az);
        let len = ex.hypot(ez).max(1e-9);
        let past = ((x - ax) * ez - (z - az) * ex) / len;
        let toward = (dx * ez - dz * ex) / len;
        if past > 0.0 {
            return 0.0;
        }
        if toward > 1e-9 {
            most = most.min(-past / toward);
        }
    }
    if most == f32::INFINITY { 0.0 } else { most }
}

// Where the middle of an arm's hand is for its controls `x` (arm_to: out to the side, forward, twist, elbow; degrees), in
// rest space as the chest stands; and the elbow and the forearm from it to the hand.
fn hand_at(arm: &Arm, x: &[f32; 4]) -> (Vec3, Vec3, Vec3) {
    let [ab, fl, tw, el] = arm.axes;
    let q = Quat::from_axis_angle(fl, x[1] * RAD) * Quat::from_axis_angle(ab, x[0] * RAD) * Quat::from_axis_angle(tw, x[2] * RAD);
    let elbow = q * arm.upper + arm.s;
    let fore = (q * Quat::from_axis_angle(el, x[3] * RAD)) * arm.fore;
    (fore + elbow, elbow, fore)
}

// The ways of holding an arm a reach is tried from (arm_to): up in front of the chest, across it high and low, in front
// of the belly, down by the side, down in front of the thigh.
const SEEDS: [[f32; 4]; 6] = [[-60.0, 40.0, 0.0, 95.0], [-80.0, 65.0, 25.0, 105.0], [-45.0, 80.0, -30.0, 125.0], [-30.0, 20.0, 60.0, 85.0], [10.0, 25.0, 10.0, 60.0],
    [-45.0, 25.0, -20.0, 25.0]];
// The forearm and hand kept out of the trunk's boxes (arm_to): at the elbow, half way down it, near the wrist, the hand's
// middle and the fingertips, by about their flesh (m). (The hand only as far as its palm: it is meant to come to the
// body; let through, it went across the front of the chest through the chest's box and stopped on it.)
const ALONG: [f32; 5] = [0.0, 0.5, 0.75, 1.0, 1.2];
const FLESH: [f32; 5] = [0.04, 0.036, 0.03, 0.018, 0.008];
// And the upper arm's lower half, which meets the belly and the hips (the half at the shoulder is jointed to the chest):
// left out, a reach across the body was solved with the upper arm inside the belly's flank, and the shoulder's spring
// pressed it there, 100 to 450 N, the arm shaking against it.
const UPPER: [f32; 2] = [0.6, 0.85];
const UPPER_FLESH: f32 = 0.04;
const MISSES: usize = 3 + ALONG.len() + UPPER.len();

// What a reach misses by, as a list (its length returned): the hand from `goal`, then how deep each point of the forearm
// is in the trunk, then each point of the upper arm in the belly or the hips. `boxes`: each trunk box's centre and half
// size in its own frame, where it is in the chest's rest space, and the turn into it.
fn misses(arm: &Arm, boxes: &[(Vec3, Vec3, Vec3, Quat)], goal: Vec3, x: &[f32; 4], r: &mut [f32; MISSES]) -> f32 {
    let (now, elbow, fore) = hand_at(arm, x);
    let d = now - goal;
    r[0] = d.x;
    r[1] = d.y;
    r[2] = d.z;
    let depth = |pt: Vec3, b: &(Vec3, Vec3, Vec3, Quat), flesh: f32| {
        let loc = b.3 * (pt - b.2);
        ((loc.x - b.0.x).abs() - b.1.x).max((loc.y - b.0.y).abs() - b.1.y).max((loc.z - b.0.z).abs() - b.1.z) - flesh
    };
    for k in 0..ALONG.len() {
        let pt = fore * ALONG[k] + elbow;
        let mut deep: f32 = 0.0;
        for b in boxes {
            let into = depth(pt, b, FLESH[k]);
            if into < 0.0 {
                deep = deep.max(-into);
            }
        }
        r[3 + k] = 2.0 * deep;
    }
    for k in 0..UPPER.len() {
        let pt = (elbow - arm.s) * UPPER[k] + arm.s;
        let mut deep: f32 = 0.0;
        for b in &boxes[1..] {
            let into = depth(pt, b, UPPER_FLESH);
            if into < 0.0 {
                deep = deep.max(-into);
            }
        }
        r[3 + ALONG.len() + k] = 2.0 * deep;
    }
    r.iter().map(|v| v * v).sum::<f32>().sqrt()
}

// `steps` of damped least squares taking `x` toward putting the hand at `goal` with the forearm outside the trunk; what
// it misses by then (misses()), and how far the hand is from the goal (arm.reach). (Never back behind the body, nor in
// across it: a hand for a wound goes in front of the trunk, not through it; held forward, the arm crosses the front of
// the chest as far as the shoulder lets it.)
const ARM_LO: [f32; 4] = [-42.0, -36.0, -80.0, 0.0];
const ARM_HI: [f32; 4] = [129.0, 149.0, 80.0, 145.0];

fn descend(arm: &mut Arm, boxes: &[(Vec3, Vec3, Vec3, Quat)], goal: Vec3, x: &mut [f32; 4], steps: usize, relaxed_flex: f32) -> f32 {
    let mut r = [0.0; MISSES];
    let mut r2 = [0.0; MISSES];
    let mut jac = [[0.0; MISSES]; 4];
    for _ in 0..steps {
        if misses(arm, boxes, goal, x, &mut r) < 0.004 {
            break;
        }
        for k in 0..4 {
            x[k] += 1.0;
            misses(arm, boxes, goal, x, &mut r2);
            x[k] -= 1.0;
            for n in 0..MISSES {
                jac[k][n] = r2[n] - r[n];
            }
        }
        // (J^T J + damping) dx = -J^T r, the arm also drawn toward the way it is most often held.
        let mut a = [[0.0f32; 4]; 4];
        let mut g = [0.0f32; 4];
        for i in 0..4 {
            for j in 0..4 {
                a[i][j] = (0..MISSES).map(|n| jac[i][n] * jac[j][n]).sum::<f32>() + if i == j { 2e-6 + PREFER[i][1] * PREFER[i][1] } else { 0.0 };
            }
            g[i] = -(0..MISSES).map(|n| jac[i][n] * r[n]).sum::<f32>() - PREFER[i][1] * PREFER[i][1] * (x[i] - PREFER[i][0]);
        }
        let dx = solve(a, g);
        for k in 0..4 {
            x[k] = (x[k] + dx[k].clamp(-25.0, 25.0)).clamp(ARM_LO[k], ARM_HI[k]);
        }
        x[0] = x[0].max((-86.0f32).max(ARM_LO[0] - 0.7 * (x[1] - relaxed_flex).max(0.0)));
    }
    let m = misses(arm, boxes, goal, x, &mut r);
    arm.reach = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).sqrt();
    m
}

// x for A x = b, A square: Gaussian elimination with partial pivoting.
fn solve(mut a: [[f32; 4]; 4], mut b: [f32; 4]) -> [f32; 4] {
    let n = 4;
    for c in 0..n {
        let mut p = c;
        for r in c + 1..n {
            if a[r][c].abs() > a[p][c].abs() {
                p = r;
            }
        }
        a.swap(c, p);
        b.swap(c, p);
        for r in c + 1..n {
            let k = a[r][c] / if a[c][c] == 0.0 { 1e-12 } else { a[c][c] };
            for j in c..n {
                a[r][j] -= k * a[c][j];
            }
            b[r] -= k * b[c];
        }
    }
    let mut x = [0.0; 4];
    for r in (0..n).rev() {
        let mut sum = b[r];
        for j in r + 1..n {
            sum -= a[r][j] * x[j];
        }
        x[r] = sum / if a[r][r] == 0.0 { 1e-12 } else { a[r][r] };
    }
    x
}

// A leg reaching from its hip to a point `to` (in the pelvis's frame: +Y up, ahead -Z here, +Z in the TS): how far
// forward the thigh swings, how far out, how far the knee bends, and how far forward the shin then leans, radians.
fn leg_angles(to: Vec3, leg: &Leg) -> [f32; 4] {
    let ahead_z = -to.z;
    let d = to.length().clamp(0.3, (leg.a + leg.b) * 0.995);
    let knee = PI - ((leg.a * leg.a + leg.b * leg.b - d * d) / (2.0 * leg.a * leg.b)).clamp(-1.0, 1.0).acos();
    let ahead = ((leg.a * leg.a + d * d - leg.b * leg.b) / (2.0 * leg.a * d)).clamp(-1.0, 1.0).acos();
    let flex = ahead_z.atan2(-to.y) + ahead;
    [flex, (leg.out * to.x).atan2(-to.y), knee, flex - knee]
}

// --- being held ------------------------------------------------------------------------------------------------------
//
// A person taken hold of (weapons.ts `_take`, hands' job): which segment, the point held in its own frame, how far from
// the eye it was taken, and where the hold is drawn to now (`aim`, set every frame). Being held, they go down and writhe
// (Behaviour: `grabbed`); let go is the component taken off.
#[derive(Component)]
pub struct Grabbed {
    pub seg: usize,
    pub local: Vec3,
    pub distance: f32,
    pub target: Option<Vec3>,
}

impl Grabbed {
    // Taken hold of at `point` (world) on the person's segment nearest it, from `eye`.
    pub fn at(rd: &Ragdoll, point: Vec3, eye: Vec3) -> Grabbed {
        let (seg, _) = rd.nearest(point);
        Grabbed { seg, local: rd.segs[seg].now.compute_affine().inverse().transform_point3(point), distance: eye.distance(point), target: None }
    }

    // Where what is held is drawn to: in front of the eye, as far off as it was taken hold of (weapons.ts _hold).
    pub fn aim(&mut self, eye: Vec3, ahead: Vec3) {
        self.target = Some(eye + ahead * self.distance.min(2.2));
    }
}

// A stiff spring on the point that was taken hold of, damped, as strong as two arms (weapons.ts step): 320 N/m and 28 N s/m
// a kilogram of the part held, at most 900 N. It is a joint from a fixed body to the point, its three linear motors the
// spring, its anchor on the fixed body moved each physics step to where the hold is drawn to: Rapier solves it with the
// arm's joints and the floor, instead of it being a push given a half-kilogram hand on its own. A part lighter than
// HOLD_LEAST is pulled as if it weighed that: what pulls on a hand pulls on the body behind it. (At a hand's own half
// kilogram the pull was 150 N a metre off, and a body lying on the floor never moved in Rapier, its friction what a 0.78
// coefficient asks, while Havok let the TS's slide: tools/port-drag.mjs, the groundskeeper's chest 0.1 to 0.5 m a second
// with the hand 0.7 to 1.3 m from where it was drawn to. As stiff as 12 kg, the port's was swept about at up to 2 m a
// second; at 2 kg it goes 0.1 to 0.4.)
const HOLD: [f32; 2] = [320.0, 28.0];
const HOLD_MOST: f32 = 900.0;
const HOLD_LEAST: f32 = 2.0;

// The anchor of a hold and its joint (on an entity of its own, under the segment held).
#[derive(Component)]
struct Hold {
    person: Entity,
    seg: usize,
    joint: Entity,
}

fn hold(mut commands: Commands, people: Query<(Entity, &Grabbed, &Ragdoll)>, anchors: Query<(Entity, &Hold)>,
        mut joints: Query<&mut ImpulseJoint>) {
    for (e, h) in &anchors {
        if people.get(h.person).is_ok_and(|(_, g, _)| g.seg == h.seg) {
            continue;
        }
        // (The joint is under the segment held, and goes with it when the person does.)
        if let Ok(mut j) = commands.get_entity(h.joint) {
            j.despawn();
        }
        commands.entity(e).despawn();
    }
    for (who, g, rd) in &people {
        let Some(target) = g.target else { continue };
        if let Some((_, h)) = anchors.iter().find(|(_, h)| h.person == who && h.seg == g.seg) {
            if joints.get(h.joint).is_ok_and(|j| AsRef::<GenericJoint>::as_ref(&j.data).local_anchor1().distance(target) > 1e-4) {
                if let Ok(mut j) = joints.get_mut(h.joint) {
                    let g: &mut GenericJoint = j.data.as_mut();
                    g.set_local_anchor1(target);
                }
            }
            continue;
        }
        let mass = rd.segs[g.seg].def.mass.clamp(HOLD_LEAST, 12.0);
        let mut joint = GenericJointBuilder::new(JointAxesMask::empty()).local_anchor1(target).local_anchor2(g.local).contacts_enabled(false);
        for axis in [JointAxis::LinX, JointAxis::LinY, JointAxis::LinZ] {
            joint = joint.motor_model(axis, MotorModel::ForceBased).motor_position(axis, 0.0, HOLD[0] * mass, HOLD[1] * mass)
                .motor_max_force(axis, HOLD_MOST / 3f32.sqrt());
        }
        let anchor = commands.spawn((RigidBody::Fixed, Transform::IDENTITY)).id();
        let joint = commands.spawn((ImpulseJoint::new(anchor, joint.build()), ChildOf(rd.segs[g.seg].entity))).id();
        commands.entity(anchor).insert(Hold { person: who, seg: g.seg, joint });
    }
}

// --- systems ---------------------------------------------------------------------------------------------------------

// Every person made (person::spawn) is given a ragdoll and a mind to work it, before the next physics step.
fn make(mut commands: Commands, made: Query<(Entity, &Person, &Transform), Without<Ragdoll>>, map: Res<Map>, mut rng: ResMut<Rng>) {
    for (e, person, root) in &made {
        let rd = Ragdoll::build(&mut commands, person);
        let b = Behaviour::new(person, root, &rd, &map, rng.next() * 10.0);
        commands.entity(e).insert((rd, b));
    }
}

#[allow(clippy::type_complexity)]
fn think(
    time: Res<Time>,
    map: Res<Map>,
    players: Query<&Player>,
    mut rng: ResMut<Rng>,
    mut people: Query<(&mut Person, &Transform, &mut Ragdoll, &mut Behaviour, Option<&mut Vitals>, Option<&mut Hurt>, Option<&Grabbed>, Has<crate::bout::Opponent>)>,
    mut sounds: MessageWriter<Heard>,
    fists: Option<Res<crate::fist::Fists>>,
) {
    let dt = time.delta_secs();
    if dt <= 0.0 {
        return;
    }
    let eye = players.iter().next().map(|p| p.eye().translation);
    let foe = players.iter().next().map(|p| Foe { eye: p.eye().translation, feet: Vec3::new(p.pos.x, p.height, p.pos.y),
        coming: fists.as_ref().is_some_and(|f| f.flying()) });
    let mut heard = Vec::new();
    for (mut person, root, mut rd, mut b, mut vitals, mut hurt, grabbed, opponent) in &mut people {
        b.foe = if opponent { foe } else { None };
        if let Some(v) = &vitals {
            b.felt = Felt { conscious: v.conscious(), pain: v.pain, daze: v.daze, out: v.out, lost: v.lost(), dead: v.dead, beating: v.beating(),
                paralysed_arms: v.paralysed_arms, paralysed_legs: v.paralysed_legs };
        }
        if let Some(h) = &hurt {
            b.leg_gone = h.leg_gone;
            b.retch = h.throat.retch;
            b.breaks = h.bones.breaks.iter().filter_map(|br| Some((if br.side? == Side::L { 'L' } else { 'R' }, br.key.clone()))).collect();
        }
        b.grabbed = grabbed.is_some();
        b.held = grabbed.map(|g| g.seg);
        b.update(dt, &person, &mut rd, &map, eye, &mut rng, &mut heard);
        if let Some(v) = &mut vitals {
            v.pain = b.felt.pain;
        }
        if let Some(h) = &mut hurt {
            h.down = rd.limp;
        }
        // The muscles do what the body can, the physics moves it, and the skeleton follows the bodies.
        let posed = rd.drive(&person, root, &b.muscles.hands);
        person.posed = posed;
    }
    sounds.write_batch(heard);
}

fn step(time: Res<Time>, mut people: Query<(&mut Ragdoll, &Behaviour)>) {
    let dt = time.delta_secs();
    for (mut rd, b) in &mut people {
        b.before_step(&mut rd, dt);
    }
}

// --- medicine (npc.rs, bones.rs) ------------------------------------------------------------------------------------

// After every step: where each segment is, for medicine to trace and hit (Hurt::segments), and each segment the floor
// has just stopped (bones.ts _falls: breaks from landing).
fn landings(world: &mut World) {
    let mut q = world.query::<(Entity, &Ragdoll, &Hurt)>();
    let map = world.resource::<Map>();
    // Per person: each segment's turn and place, its downward speed before and after the step, its lowest point, the
    // ground under it, and whether its muscle holds it; and the pelvis's and chest's.
    #[allow(clippy::type_complexity)]
    let people: Vec<(Entity, Vec<Transform>, Vec<npc::Bend>, Vec<(f32, f32, f32, f32, bool)>, [f32; 3])> = q
        .iter(world)
        .map(|(e, rd, _)| {
            let segs = (0..rd.segs.len())
                .map(|k| {
                    let (low, at) = (rd.lowest(k), rd.segs[k].now.translation);
                    (rd.segs[k].was.y, rd.segs[k].vel.y, low, map.ground(at.x, at.z, low + 0.1), rd.held(k))
                })
                .collect();
            // (The hinge as the TS took it: the joint's first axis turned with the parent as it is now.)
            let bends = (0..rd.segs.len())
                .map(|k| match rd.segs[k].def.parent {
                    Some(p) => npc::Bend { hinge: rd.segs[p].now.rotation * (rd.segs[k].frame * Vec3::X), angles: rd.angles(k), lo: rd.segs[k].lo, hi: rd.segs[k].hi },
                    None => npc::Bend::default(),
                })
                .collect();
            let (pelvis, chest) = (rd.by_name("pelvis"), rd.by_name("chest"));
            (e, rd.segs.iter().map(|s| s.now).collect(), bends, segs, [rd.segs[pelvis].vel.y, rd.segs[chest].vel.y, rd.segs[pelvis].now.translation.y])
        })
        .collect();
    for (e, now, bends, segs, [pelvis_vy, chest_vy, pelvis_y]) in people {
        if let Some(mut h) = world.get_mut::<Hurt>(e) {
            h.segments = Some(now);
            h.bends = Some(bends);
        }
        npc::with(world, e, |npc| {
            for (k, &(was, vy, low, under, held)) in segs.iter().enumerate() {
                npc.bones().fell(k, was, vy, low, under, held, pelvis_vy, chest_vy, pelvis_y);
            }
        });
    }
}

// Once a frame, what medicine asked of the body: the pushes of shots and blows (behaviour.hit), joints loosened, locked
// or let go (bones.rs), a shaft let go at its mid joint (breakAt); and the open fractures, by how far each break is bent.
fn hurts(world: &mut World) {
    let mut q = world.query::<(Entity, &Hurt)>();
    let asked: Vec<(Entity, Vec<Happened>)> = q
        .iter(world)
        .map(|(e, h)| (e, h.happened.iter().filter(|x| matches!(x, Happened::Hit { .. } | Happened::Joint { .. } | Happened::Broke { .. })).cloned().collect()))
        .collect();
    let mut state: bevy::ecs::system::SystemState<(Query<(&Transform, &mut Ragdoll, &mut Behaviour)>, Query<&mut bevy_rapier3d::prelude::ImpulseJoint>, ResMut<Rng>)> =
        bevy::ecs::system::SystemState::new(world);
    let mut bends: Vec<(Entity, std::collections::HashMap<String, f32>)> = Vec::new();
    {
        let Ok((mut people, mut joints, mut rng)) = state.get_mut(world) else { return };
        for (e, list) in &asked {
            let Ok((root, mut rd, mut b)) = people.get_mut(*e) else { continue };
            for x in list {
                match x {
                    Happened::Hit { point, impulse, jolt } => {
                        let (seg, _) = rd.nearest(*point);
                        b.hit(&mut rd, root, &mut rng, seg, *impulse, *point, *jolt);
                    }
                    Happened::Joint { segment, change } => {
                        let k = rd.by_name(segment);
                        rd.change(k, change, &mut joints);
                    }
                    Happened::Broke { segment } => {
                        rd.break_at(segment, &mut joints);
                    }
                    _ => {}
                }
            }
            let bend = (0..rd.segs.len())
                .filter(|&k| rd.segs[k].def.parent.is_some())
                .map(|k| {
                    let a = rd.angles(k);
                    (rd.segs[k].def.name.clone(), a[0].hypot(a[2]) / RAD)
                })
                .collect();
            bends.push((*e, bend));
        }
    }
    state.apply(world);
    for (e, bend) in bends {
        npc::with(world, e, |npc| npc.bones().opens(|segment| bend.get(segment).copied().unwrap_or(0.0)));
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(PreUpdate, make)
        .add_systems(FixedUpdate, (step.in_set(Steps::Push), hold.in_set(Steps::Push), landings.after(Steps::Read)))
        .add_systems(Update, (think, ragdoll::send).chain().after(npc::update))
        .add_systems(PostUpdate, hurts);
}

#[test]
fn hull_and_edges() {
    let hull = convex_hull(vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.5, 0.5]]);
    assert_eq!(hull.len(), 4);
    assert!((outside(&hull, 0.5, 0.5) + 0.5).abs() < 1e-6);
    assert!((outside(&hull, 2.0, 0.5) - 1.0).abs() < 1e-6);
    assert!((inside(&hull, 0.5, 0.5, 1.0, 0.0) - 0.5).abs() < 1e-6);
}
