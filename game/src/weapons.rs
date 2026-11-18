// What is in the player's hands, and what it does (src/sandbox/weapons.ts).
//
// The guns fire real loads, measured: a 9 mm round leaves at 360 m/s with about 480 J, a 7.62 rifle round at 820 m/s
// with 2.7 kJ, a 12 bore shell throws nine 00 buckshot pellets of 3.5 g each. What happens to a body is wounds.rs's
// business; here a shot is a line that is followed through people and on until it is spent or meets a wall. Blades are
// a stab or a cut, swept as the blade is drawn, and a bat is a swing that lands a blow on the first person it meets.
//
// The TS's numbers are kept in its own space here (an eye or a hand frame with x right, y up and z ahead: HELD, SWINGS,
// the grips) and brought over where they are used (`e`, `euler`, `ts_turn`): Bevy's ahead is -Z, so a position has its
// z turned round, and a turn about a fixed axis goes the other way (main.rs `babylon`, `babylon_quat`).

use std::collections::HashMap;

use bevy::gltf::{Gltf, GltfMesh, GltfNode};
use bevy::input::mouse::AccumulatedMouseScroll;
use bevy::prelude::*;
use bevy::world_serialization::WorldAssetRoot;
use bevy_rapier3d::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::arsenal::Arsenal;
use crate::map::WORLD;
use crate::models::Models;
use crate::behaviour::{Behaviour, Grabbed};
use crate::dressing::{self, REACH, SECONDS};
use crate::ragdoll::Ragdoll;
use crate::npc::{self, Hurt, Look, Npc};
use crate::person::Person;
use crate::vitals::{Dice, Vitals};
use crate::wounds;
use bevy::diagnostic::FrameCount;
use crate::player::Player;
use crate::profiler::{timed, Notes};
use crate::rng::Rng;
use crate::sound::{Play, Sound};
use crate::{babylon_quat, Loading};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Blade,
    Blunt,
    Gun,
    Grenade,
    Grab,
    Fists,
    Throw,
    Dress,
}

// What goes into a body (wounds.ts Missile): joules at the skin, kg for the push it gives, metres across (the hole),
// metres either side of its path torn (the permanent cavity), joules lost per centimetre of soft tissue and of bone,
// metres in it can go at most (a blade's length); a blade's edges and how far from its point it reaches its full width;
// drawn across (a slash: no hole, the caller draws the cut) rather than driven in; the speed it leaves a muzzle at.
#[derive(Clone, Copy, Debug)]
pub struct Missile {
    pub name: &'static str,
    pub energy: f32,
    pub mass: f32,
    pub calibre: f32,
    pub channel: f32,
    pub soft: f32,
    pub hard: f32,
    pub reach: f32,
    pub blade: bool,
    pub slash: bool,
    pub edges: u32,
    pub taper: f32,
    pub speed: f32,
    // Which way across it its edge is (unit, world, from the back to the edge).
    pub across: Option<Vec3>,
    // A gun's pellets a shot (0: one bullet).
    pub pellets: u32,
    // How far behind where it is followed from its muzzle is (m): for the powder round a hole (wounds.rs `muzzle`).
    pub muzzle: f32,
}

const M: Missile = Missile {
    name: "bullet", energy: 0.0, mass: 0.0, calibre: 0.0, channel: 0.0, soft: 0.0, hard: 0.0, reach: 0.0, blade: false, slash: false,
    edges: 0, taper: 0.0, speed: 0.0, across: None, pellets: 0, muzzle: 0.0,
};

impl Missile {
    // As wounds.rs takes it (the TS's optional fields left out where weapons.ts left them out).
    pub fn wounds(&self) -> wounds::Missile {
        let some = |x: f32| (x > 0.0).then_some(x);
        wounds::Missile {
            energy: self.energy, mass: self.mass, calibre: self.calibre, channel: self.channel, soft: self.soft, hard: self.hard,
            reach: some(self.reach), blade: self.blade, slash: self.slash, name: (self.name != "bullet").then(|| self.name.to_string()),
            speed: some(self.speed), across: self.across, edges: (self.edges > 0).then_some(self.edges), taper: some(self.taper),
            pellets: (self.pellets > 1).then_some(self.pellets), muzzle: Some(self.muzzle),
        }
    }
}

pub struct Gun {
    pub m: Missile,
    pub rounds: u32,
    pub every: f32,
    pub pellets: u32,
    pub spread: f32,
    pub kick: f32,
    pub sound: &'static str,
    pub reload: f32,
    pub auto: bool,
    // Radians: soft lead meeting concrete at less than this skips off it.
    pub skips: f32,
}

// A blunt tool brought down from overhead: what it strikes with then, how fast, a claw's puncture, a chop's cut.
pub struct Down {
    pub tool: Option<Tool>,
    pub speed: Option<f32>,
    pub cut: Option<f32>,
    pub claw: Option<Missile>,
}

// What a blow lands with (wounds.ts blow's `tool`): a broad stiff face, an edge, a hammer's round face; or how stiff the
// thing is (N/m), none being as hard as the bone it hits.
#[derive(Clone, Copy, Debug)]
pub enum Tool {
    Flat,
    Edge,
    Hammer,
    Stiff(f32),
}

impl Tool {
    fn wounds(self) -> wounds::Tool {
        match self {
            Tool::Flat => wounds::Tool::Named("flat"),
            Tool::Edge => wounds::Tool::Named("edge"),
            Tool::Hammer => wounds::Tool::Named("hammer"),
            Tool::Stiff(n) => wounds::Tool::Stiff(n),
        }
    }
}

pub struct Arm {
    pub key: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    // A gun's magazine.
    pub rounds: Option<u32>,
    // Metres it reaches, seconds a swing takes.
    pub reach: f32,
    pub swing: f32,
    pub stab: Option<Missile>,
    // A cut's depth (m).
    pub cut: f32,
    // A swung thing's mass at the head (kg) and speed there (m/s).
    pub mass: f32,
    pub speed: f32,
    pub tool: Option<Tool>,
    pub down: Option<Down>,
    pub sound: Option<&'static str>,
    pub whoosh: Option<&'static str>,
    pub gun: Option<Gun>,
}

const A: Arm = Arm {
    key: "", name: "", kind: Kind::Grab, rounds: None, reach: 0.0, swing: 0.0, stab: None, cut: 0.0, mass: 0.0, speed: 0.0, tool: None,
    down: None, sound: None, whoosh: None, gun: None,
};

const fn gun(m: Missile, rounds: u32, every: f32, pellets: u32, spread: f32, kick: f32, sound: &'static str, reload: f32, auto: bool, skips: f32) -> Option<Gun> {
    Some(Gun { m, rounds, every, pellets, spread, kick, sound, reload, auto, skips })
}

// Everything there is to hold, in weapons.ts's order, with the numbers each is used with.
pub const ARMS: &[Arm] = &[
    Arm { key: "knife", name: "Knife", kind: Kind::Blade, reach: 1.0, swing: 0.32, cut: 0.022,
        stab: Some(Missile { energy: 70.0, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40.0, reach: 0.17, blade: true, edges: 1, taper: 0.04, ..M }), ..A },
    Arm { key: "sword", name: "Sword", kind: Kind::Blade, reach: 1.65, swing: 0.5, cut: 0.055,
        stab: Some(Missile { energy: 150.0, mass: 1.2, calibre: 0.03, channel: 0.01, soft: 1.2, hard: 40.0, reach: 0.75, blade: true, edges: 2, taper: 0.25, ..M }), ..A },
    // A man's full swing at head height: about 110 J (dev/research/blunt-trauma.md).
    Arm { key: "bat", name: "Baseball bat", kind: Kind::Blunt, reach: 1.25, swing: 0.55, mass: 0.79, speed: 15.5, ..A },
    Arm { key: "pistol", name: "Pistol", kind: Kind::Gun, rounds: Some(15),
        gun: gun(Missile { energy: 480.0, mass: 0.008, speed: 360.0, calibre: 0.009, channel: 0.006, soft: 12.0, hard: 110.0, ..M }, 15, 0.13, 1, 0.004, 0.035, "shot-pistol", 1.6, false, 0.0), ..A },
    Arm { key: "rifle", name: "Rifle", kind: Kind::Gun, rounds: Some(5),
        gun: gun(Missile { energy: 2700.0, mass: 0.0097, speed: 820.0, calibre: 0.0078, channel: 0.012, soft: 28.0, hard: 160.0, ..M }, 5, 1.1, 1, 0.0012, 0.07, "shot-rifle", 2.6, false, 0.0), ..A },
    Arm { key: "shotgun", name: "Shotgun", kind: Kind::Gun, rounds: Some(2),
        gun: gun(Missile { energy: 170.0, mass: 0.0035, speed: 400.0, calibre: 0.0084, channel: 0.005, soft: 9.0, hard: 90.0, ..M }, 2, 0.25, 9, 0.028, 0.12, "shot-shotgun", 2.2, false, 0.0), ..A },
    // 7.62x39: a 7.9 g bullet at 715 m/s, about 2 kJ, 600 a minute. It goes some way into a body before it yaws.
    Arm { key: "ak", name: "AK-47", kind: Kind::Gun, rounds: Some(30),
        gun: gun(Missile { energy: 2020.0, mass: 0.0079, speed: 715.0, calibre: 0.0078, channel: 0.011, soft: 24.0, hard: 150.0, ..M }, 30, 0.1, 1, 0.0035, 0.022, "shot-ak", 2.5, true, 0.0), ..A },
    // 5.56x45 M855 from a 14.5 inch barrel: 4 g at 900 m/s, about 1.6 kJ, 800 a minute. Fast enough to break up inside.
    Arm { key: "m4", name: "M4A1", kind: Kind::Gun, rounds: Some(30),
        gun: gun(Missile { energy: 1620.0, mass: 0.004, speed: 900.0, calibre: 0.0057, channel: 0.013, soft: 22.0, hard: 130.0, ..M }, 30, 0.075, 1, 0.0025, 0.016, "shot-m4", 2.3, true, 0.0), ..A },
    // .50 AE from the Desert Eagle's 6 inch barrel: a 300 grain (19.4 g) hollow point at about 1,450 ft/s (442 m/s), about
    // 1.9 kJ, seven in the magazine. A half-inch bullet that opens to near an inch: the widest handgun wound channel there
    // is, but a handgun's (no temporary cavity worth the name below 600 m/s, dev/research/wounds.md), and it goes some
    // 40 cm into soft tissue. Fired as fast as the recoil lets the sights come back down, about 0.3 s.
    Arm { key: "deagle", name: "Desert Eagle .50", kind: Kind::Gun, rounds: Some(7),
        gun: gun(Missile { energy: 1900.0, mass: 0.0194, speed: 442.0, calibre: 0.0127, channel: 0.012, soft: 42.0, hard: 220.0, ..M }, 7, 0.3, 1, 0.004, 0.09, "shot-deagle", 2.0, false, 0.0), ..A },
    // .22 LR from an 18.5 inch rifle barrel: a 40 grain (2.6 g) round-nose lead bullet at about 1,200 ft/s (366 m/s),
    // about 170 J; ten in the rotary magazine. 5.7 mm across, a small hole (dev/research/wounds.md: ~5 mm entries, taken
    // for ice-pick wounds), a narrow track, 30-40 cm of soft tissue; often stopped in the skull. Soft lead at a glancing
    // angle skips off concrete (`skips`, shot).
    Arm { key: "r22", name: ".22 rifle (10/22)", kind: Kind::Gun, rounds: Some(10),
        gun: gun(Missile { energy: 170.0, mass: 0.0026, speed: 366.0, calibre: 0.0057, channel: 0.003, soft: 5.0, hard: 90.0, ..M }, 10, 0.12, 1, 0.0015, 0.004, "shot-r22", 2.4, false, 0.26), ..A },
    // The tools. A man's full two-handed swing puts about 110 J into a bat (0.79 kg at 15.5 m/s, Guo26 in
    // dev/research/blunt-trauma.md sec. 9); taken as about the same work into anything he can swing as fast as his body
    // allows, a heavier head comes round slower: v = sqrt(2E/m). Brought down from overhead (`down`) it also falls, its
    // head dropping about 1.2 m (m g h more), and is swung harder.
    // Shovel: about 2 kg, some 1.5 kg of it at the blade end: 12 m/s, 110 J, the flat of the blade (a broad stiff face,
    // 'flat') or, from overhead, its edge ('edge': 2 cm2, the bone under it fractured and the skin split as a chop wound).
    Arm { key: "shovel", name: "Shovel", kind: Kind::Blunt, reach: 1.5, swing: 0.62, mass: 1.5, speed: 12.0, tool: Some(Tool::Flat),
        down: Some(Down { tool: Some(Tool::Edge), speed: Some(13.0), cut: Some(0.02), claw: None }), sound: Some("hit-shovel"), ..A },
    // Sledgehammer, a 10 lb (4.5 kg) head on a 90 cm handle: about 5 kg at the head with the handle's share, so 6.6 m/s
    // and 110 J swung level; from overhead 9 m/s, about 200 J (110 + 5 kg x 9.8 x 1.2 m = 170 J, and harder). Slow: a
    // swing takes most of a second. Its flat face crushes what it lands on: skull fracture takes 14-68 J (Yoganandan 1995).
    Arm { key: "sledge", name: "Sledgehammer", kind: Kind::Blunt, reach: 1.45, swing: 0.95, mass: 5.0, speed: 6.6, tool: Some(Tool::Flat),
        down: Some(Down { tool: None, speed: Some(9.0), cut: None, claw: None }), sound: Some("hit-sledge"), whoosh: Some("swing-heavy"), ..A },
    // Claw hammer, a 20 oz (0.57 kg) head: about 0.65 kg at 11 m/s in one hand, 39 J on a 1 inch face ('hammer'): the
    // round depressed skull fracture with a bone plug that hammer faces leave (Goots18, 9 of 12 impacts). Its claw, from
    // overhead, goes in 3-4 cm as two tines a couple of centimetres apart (a puncture, pierce).
    Arm { key: "hammer", name: "Claw hammer", kind: Kind::Blunt, reach: 0.95, swing: 0.4, mass: 0.65, speed: 11.0, tool: Some(Tool::Hammer),
        down: Some(Down { tool: None, speed: None, cut: None,
            claw: Some(Missile { energy: 39.0, mass: 0.65, calibre: 0.016, channel: 0.004, soft: 3.0, hard: 60.0, reach: 0.04, blade: true, edges: 2, taper: 0.03, ..M }) }),
        sound: Some("hit-hammer"), ..A },
    Arm { key: "grenade", name: "M67 grenade", kind: Kind::Grenade, ..A },
    Arm { key: "hands", name: "Hands", kind: Kind::Grab, ..A },
    // Punched with: the left button the left fist, the right the right; held down, wound up harder (fist.rs).
    Arm { key: "fists", name: "Fists", kind: Kind::Fists, ..A },
    Arm { key: "throw", name: "Throw things", kind: Kind::Throw, ..A },
    // Held on a wound (dressing.ts): the bandage dresses the one looked at, the medkit every one the person has.
    Arm { key: "bandage", name: "Bandage", kind: Kind::Dress, ..A },
    Arm { key: "medkit", name: "Medkit", kind: Kind::Dress, ..A },
];

pub fn arm(key: &str) -> &'static Arm {
    ARMS.iter().find(|a| a.key == key).unwrap_or_else(|| panic!("no arm {key}"))
}

// The handguns' slides, and how far each runs back (m): a 9 mm service pistol's about 24 mm, the Desert Eagle's about 32.
fn slide(key: &str) -> f32 {
    match key {
        "pistol" => 0.024,
        "deagle" => 0.032,
        _ => 0.0,
    }
}

// A hand on a thing, in the thing's own frame (TS: z along its bore or blade, y toward its top or back): closed as
// `hold` (arm.rs HOLDS), the handle's line through the hand at `at`, running `along` from the index finger's side toward
// the little finger's, and the hand lying `back` from the wrist to the knuckles. `shoulder`: that arm's shoulder brought
// this far from where it hangs (hands.rs): a long gun's other hand reaches its forend because the body turns that
// shoulder forward.
#[derive(Clone, Copy, Debug)]
pub struct Grip {
    pub hold: &'static str,
    pub at: [f32; 3],
    pub along: [f32; 3],
    pub back: [f32; 3],
    pub shoulder: Option<[f32; 3]>,
}

const fn g(hold: &'static str, at: [f32; 3], along: [f32; 3], back: [f32; 3]) -> Grip {
    Grip { hold, at, along, back, shoulder: None }
}

// How each thing is held, in the eye's own frame (TS: x right, y up, z ahead). `at` is where its grip is at rest: low and
// to the right, a long gun's stock back in the shoulder. A blade or the bat is turned `turn` (x pitch, y yaw, z roll); a
// gun has its bore laid on the line to the point AIMED metres ahead of the eye (the shots go from the muzzle along the
// bore, so the muzzle points where they land). `right` and `left` are where each hand goes on it (a hand not given hangs
// out of sight). `kick`: how far a shot drives a gun back into the hands (m) and turns it up about its grip (rad): a
// pistol, held out at arm's length, flips most; a rifle's stock in the shoulder takes it.
pub struct Held {
    pub at: [f32; 3],
    pub turn: Option<[f32; 3]>,
    pub right: Option<Grip>,
    pub left: Option<Grip>,
    pub kick: [f32; 2],
}

const AIMED: f32 = 15.0;
// A long gun's firing hand at rest: its butt in the pocket in front of the shoulder joint (arm.rs SHOULDER), some 4 cm
// ahead of the eye, the head up off the stock. (With the hand at 28 cm the butt was level with the eye, the guns sat low
// in the corner of the view and the hand on the grip filled it.)
const LONG: [f32; 3] = [0.13, -0.125, 0.32];
// A long gun's firing hand: on a pistol grip raked back some 20 degrees, the index finger along to the trigger.
// Its other hand reaches the forend because the body turns that shoulder forward and in, as a rifleman stands.
const FORWARD: [f32; 3] = [-0.06, 0.0, 0.12];
const PISTOL_GRIP: Grip = g("grip", [0.0, -0.005, -0.005], [0.0, -0.94, -0.34], [0.0, -0.34, 0.94]);
const HANDLE: Grip = g("handle", [0.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, -1.0, 0.0]);
const fn handle_at(z: f32) -> Grip {
    g("handle", [0.0, 0.0, z], [0.0, 0.0, -1.0], [0.0, -1.0, 0.0])
}
const fn forend(at: [f32; 3]) -> Grip {
    Grip { hold: "wrap", at, along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0.0], shoulder: Some(FORWARD) }
}
const RIFLE_GRIP: Grip = g("grip", [0.0, 0.0, 0.0], [0.0, -0.77, -0.64], [0.0, -0.64, 0.77]);

pub fn held(key: &str) -> Option<Held> {
    let h = |at, turn, right, left, kick| Some(Held { at, turn, right, left, kick });
    match key {
        "knife" => h([0.17, -0.17, 0.42], Some([-0.75, -0.2, -0.1]), Some(HANDLE), None, [0.0; 2]),
        "sword" => h([0.16, -0.21, 0.45], Some([-0.95, -0.3, 0.15]), Some(HANDLE), Some(handle_at(-0.1)), [0.0; 2]),
        "bat" => h([0.19, -0.22, 0.42], Some([-1.15, -0.35, 0.3]), Some(handle_at(0.085)), Some(HANDLE), [0.0; 2]),
        // A handgun in two hands: the firing hand high on the grip, the web of its thumb up under the slide; the other hand
        // round the front of it, its palm on the grip's left side and its fingers over the first hand's, the hand running
        // forward along the frame (turned across it, toward the right, the palm faced back at the eye).
        "pistol" => h([0.07, -0.115, 0.5], None, Some(g("grip", [0.0, 0.013, -0.005], [0.0, -0.95, -0.31], [0.0, -0.31, 0.95])),
            Some(g("support", [-0.008, -0.002, 0.012], [0.1, -0.95, -0.3], [0.12, -0.3, 0.95])), [0.035, 0.2]),
        "rifle" => h(LONG, None, Some(RIFLE_GRIP), Some(forend([0.0, 0.01, 0.36])), [0.06, 0.12]),
        "shotgun" => h([LONG[0], LONG[1] - 0.005, LONG[2] + 0.01], None, Some(RIFLE_GRIP), Some(forend([0.0, 0.04, 0.32])), [0.06, 0.15]),
        "ak" => h([LONG[0], LONG[1] - 0.01, LONG[2] + 0.05], None, Some(PISTOL_GRIP), Some(forend([0.0, 0.075, 0.29])), [0.03, 0.06]),
        "m4" => h([LONG[0], LONG[1], LONG[2] + 0.01], None, Some(PISTOL_GRIP), Some(forend([0.0, 0.07, 0.27])), [0.025, 0.05]),
        "grenade" => h([0.15, -0.16, 0.4], Some([-1.3, -0.2, 0.0]), Some(g("ball", [0.0, 0.0, -0.005], [0.0, 0.0, -1.0], [-1.0, 0.0, 0.0])), None, [0.0; 2]),
        "bandage" => h([0.1, -0.13, 0.4], Some([0.3, 0.0, 0.0]), Some(g("ball", [0.0; 3], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0])),
            Some(g("pinch", [-0.03, -0.065, -0.025], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0])), [0.0; 2]),
        // A .50 AE Desert Eagle weighs 2 kg and has about four times a 9 mm service pistol's free recoil (some 25 J against
        // 6): it drives back and flips up far more, held out the same way in two hands. (Its grip is raked back further
        // than the 9 mm's, about 37 degrees: the hands lie along it.)
        "deagle" => h([0.06, -0.11, 0.52], None, Some(g("grip", [0.0; 3], [0.0, -0.8, -0.6], [0.0, -0.6, 0.8])),
            Some(g("support", [-0.01, -0.004, 0.014], [0.1, -0.8, -0.59], [0.12, -0.6, 0.8])), [0.06, 0.45]),
        // A 10/22: a straight wrist (no pistol grip), the other hand under the forend. Its .22 LR recoils by a fraction of
        // a joule in a 2.3 kg rifle: hardly a nudge.
        "r22" => h(LONG, None, Some(RIFLE_GRIP), Some(forend([0.0, 0.015, 0.32])), [0.006, 0.012]),
        // The tools in both hands (the hammer in one), carried up as the bat is; the long ones stood up past upright and
        // leaning out to the right, their heads back over the right shoulder, out of the way of the eye. (The shovel was carried across the
        // body to the left shoulder and the sledge's long handle stood up before the eye: both across the middle of the
        // view, the shovel's blade over the crosshair.)
        "shovel" => h([0.21, -0.26, 0.36], Some([-1.8, -0.9, 0.5]), Some(HANDLE), Some(handle_at(0.2)), [0.0; 2]),
        "sledge" => h([0.21, -0.27, 0.37], Some([-1.8, -0.9, 0.3]), Some(handle_at(0.12)), Some(HANDLE), [0.0; 2]),
        "hammer" => h([0.17, -0.19, 0.42], Some([-1.05, -0.2, -0.1]), Some(HANDLE), None, [0.0; 2]),
        "medkit" => h([0.0, -0.2, 0.5], Some([0.35, 0.1, 0.0]), Some(g("wrap", [0.12, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0])),
            Some(g("wrap", [-0.12, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0])), [0.0; 2]),
        _ => None,
    }
}

// Swings, as poses along the way (fraction of the swing, then `at` and `turn` as in HELD), from and back to rest. A stab
// is driven home by 0.09 s (when a stab lands: a quarter of the way) and held there until it comes out at three
// quarters; a cut or a blow comes in from the right and sweeps across to the left over the middle of its time, as the
// lines that find what it meets do (`sweep`), the edge leading.
type Keys = &'static [[f32; 7]];
const DOWN: Keys = &[[0.3, 0.1, 0.12, 0.2, -2.1, -0.15, 0.1], [0.5, 0.04, -0.12, 0.5, 0.35, -0.05, 0.05], [0.72, 0.04, -0.16, 0.48, 0.45, -0.05, 0.05]];
fn swings(key: &str, how: How) -> Option<Keys> {
    Some(match (key, how) {
        ("knife", How::Stab) => &[[0.08, 0.21, -0.21, 0.33, -0.3, -0.15, -0.1], [0.26, 0.06, -0.1, 0.6, -0.08, -0.1, -0.1], [0.72, 0.06, -0.1, 0.62, -0.08, -0.1, -0.1]],
        ("knife", How::Cut) => &[[0.18, 0.3, -0.1, 0.3, -0.2, 1.0, -0.9], [0.47, 0.06, -0.14, 0.5, -0.05, 0.0, -1.4], [0.75, -0.22, -0.2, 0.34, 0.05, -1.05, -1.5]],
        ("sword", How::Stab) => &[[0.08, 0.17, -0.28, 0.34, -0.5, -0.2, 0.0], [0.26, 0.07, -0.16, 0.52, -0.06, -0.1, 0.0], [0.72, 0.07, -0.16, 0.54, -0.06, -0.1, 0.0]],
        ("sword", How::Cut) => &[[0.2, 0.3, -0.06, 0.26, -0.6, 1.0, -0.8], [0.47, 0.06, -0.16, 0.44, -0.05, 0.0, -1.4], [0.75, -0.24, -0.22, 0.3, 0.1, -1.0, -1.5]],
        ("bat", How::Blow) => &[[0.2, 0.32, -0.12, 0.16, -1.5, 0.5, 0.9], [0.47, 0.06, -0.18, 0.4, -0.15, 0.0, -1.4], [0.75, -0.24, -0.22, 0.3, 0.1, -1.1, -1.5]],
        // The tools also come down from overhead (`down`): raised up and back, brought down onto what is ahead, landing
        // at half way (`sweep`), and held there a moment.
        ("shovel", How::Blow) => &[[0.2, 0.32, -0.1, 0.18, -1.2, 0.6, 0.6], [0.47, 0.06, -0.16, 0.42, -0.1, 0.0, -1.4], [0.75, -0.24, -0.2, 0.3, 0.1, -1.1, -1.5]],
        ("sledge", How::Blow) => &[[0.22, 0.32, -0.08, 0.14, -1.6, 0.5, 0.9], [0.47, 0.06, -0.18, 0.4, -0.15, 0.0, -1.4], [0.75, -0.24, -0.24, 0.3, 0.1, -1.1, -1.5]],
        ("hammer", How::Blow) => &[[0.2, 0.3, -0.1, 0.2, -1.6, 0.5, 0.6], [0.47, 0.05, -0.15, 0.45, -0.15, 0.0, -1.4], [0.75, -0.2, -0.2, 0.32, 0.1, -1.0, -1.5]],
        ("shovel" | "sledge" | "hammer", How::Down) => DOWN,
        _ => return None,
    })
}

// Where along what is held (fractions of the way from the grip to its tip, weapons.json) the points that strike are
// (`sweep`): a blade's edge from near its hilt to the point, a head. Unlisted: a blade's whole edge, or a head at the end.
fn swept(key: &str, kind: Kind) -> &'static [f32] {
    match key {
        "knife" => &[0.4, 0.55, 0.7, 0.85, 1.0],
        "bat" => &[0.55, 0.7, 0.85, 1.0],
        "shovel" => &[0.72, 0.86, 1.0],
        _ if kind == Kind::Blade => &[0.35, 0.5, 0.65, 0.8, 0.92, 1.0],
        _ => &[0.82, 0.92, 1.0],
    }
}

// What is heard of a reload and when, as a fraction of it (the strokes `reloading` and `bolt` show): the magazine out
// and seated, the slide or charging handle; the shotgun broken open, two shells in, closed; the bolt opened, five rounds
// thumbed in (where each press is deepest), the bolt closed.
fn reloads(key: &str) -> Vec<(f32, &'static str)> {
    let magazine = |charge| vec![(0.13, "mag-out"), (0.68, "mag-in"), (0.77, charge)];
    match key {
        "pistol" | "deagle" => magazine("rack"),
        "ak" | "m4" | "r22" => magazine("charge"),
        "shotgun" => vec![(0.13, "break-open"), (0.55, "shell-in"), (0.62, "shell-in"), (0.78, "break-close")],
        "rifle" => {
            let mut v = vec![(0.1, "bolt-open")];
            v.extend((0..5).map(|k| (0.34 + 0.38 * (k as f32 + 0.5) / 5.0, "round-in")));
            v.push((0.78, "bolt-close"));
            v
        }
        _ => Vec::new(),
    }
}

// Things to throw: the props from Poly Haven already in the game, what each weighs, and how stiff each is where it lands,
// N/m (none: hard as the bone it hits); a cardboard box crumples.
const THROWN: [(&str, f32, Option<f32>); 7] = [
    ("metal_toolbox", 6.0, None), ("concrete_cat_statue", 4.0, None), ("dining_chair_02", 5.0, None), ("wooden_bucket_01", 2.0, None),
    ("cardboard_box_01", 0.6, Some(4000.0)), ("vintage_electric_kettle", 1.2, Some(30000.0)), ("metal_trash_can", 7.0, Some(60000.0)),
];

// What a blade sheds (dev/research/stab-wounds.md sec. 2). Nobody has measured it. Pulled out of a pool at 1 m/s a plate
// keeps a film 0.34 mm thick (Landau-Levich), but the skin's edges wipe the blade on its way out: taken as 0.03 mm over
// both faces of what went in, of which 0.01 mm stays on as a smear that nothing shakes off (estimates).
const FILM: f32 = 0.00003;
const SMEAR: f32 = 0.00001;
const DRIES: f32 = 300.0; // seconds for blood on the blade to go from wet red to dull brown (a thin film: an estimate)
const FRAGMENTS: f32 = 1000.0; // an M67's body breaks into roughly this many that can wound
const IN_BARREL: f32 = 0.04; // m: how far inside the muzzle a shot is followed from (`fire`)

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum How {
    Stab,
    Cut,
    Blow,
    Down,
}

// --- what is carried ------------------------------------------------------------------------------------------------

// What the player asks of the hands: from the mouse and keys (`input`), or from a scenario.
#[derive(Clone, Copy, Debug)]
pub enum Act {
    // A button pressed or let go: 0 the left, 2 the right.
    Press(u8),
    Release(u8),
    Select(usize),
    Reload,
    Take,
    PutBack,
}

// A thing that happens a moment later (the TS's setTimeouts): a sound, a casing landing, the grenade leaving the hand.
enum Later {
    Sound(&'static str, f32),
    Casing(Entity),
    Lob(f32),
}

pub struct Action {
    pub how: How,
    pub t: f32,
    pub length: f32,
    pub landed: bool,
    // Where each striking point of the thing was drawn last frame.
    was: Option<Vec<Vec3>>,
    // A cut's crossings of each person's skin, drawn once the swing is through (npc.slash).
    hits: Vec<(Entity, Vec<Vec3>)>,
    // Met the room's wall (`animate`): the last pose clear of it (a fraction of the swing) and how far through its time
    // the swing was then; it comes back the way it went from there. And the last pose clear of it so far.
    stopped: Option<(f32, f32)>,
    clear: f32,
}

// What is carried: six at hand (1 to 6), twelve more in the bag. An empty hand is the hands.
#[derive(Resource)]
pub struct Weapons {
    pub slots: [Option<&'static str>; 6],
    pub bag: [Option<&'static str>; 12],
    pub slot: usize,
    pub ammo: HashMap<&'static str, u32>,
    pub queue: Vec<Act>,
    pub busy: f32,
    pub reloading: f32,
    pub firing: bool,
    pub recoil: f32,
    pub action: Option<Action>,
    pub throw_kind: usize,
    pub since: f32,
    later: Vec<(f32, Later)>,
    grab: Option<Grab>,
    // Bowel come out of an opened belly, held (viscera.rs).
    bowel: Option<crate::viscera::Held>,
    // A person held (their Grabbed), and when each thing in flight last landed a blow.
    holding: Option<Entity>,
    struck: HashMap<Entity, f32>,
    grenades: Vec<(Entity, f32)>,
    thrown: Vec<(Entity, f32, Option<f32>)>,
    casings: HashMap<&'static str, (Vec<Entity>, usize)>,
    holes: (Vec<Entity>, usize),
    // A blade's blood: ml on it, ml that stays on as a smear, how long since it was in, per blade.
    pub blades: HashMap<&'static str, (f32, f32, f32)>,
    // What was hit and played since a scenario last looked (each shot's and swing's line in the log).
    pub log: Vec<Value>,
    // Where on the screen (0 to 1 across and down) the gun's bore meets whatever is first along it (`sight`).
    pub sight: Option<Vec2>,
    pub medic: Medic,
}

// An open wound a dressing can go on (dressing.rs wounds), and whose.
#[derive(Clone)]
pub struct Wound {
    pub person: Entity,
    pub open: dressing::OpenWound,
}

// The player putting dressings on (dressing.ts Medic): the bandage on the wound looked at, the medkit on every open wound
// of the person looked at, worst first, one after another while the button is held.
#[derive(Default)]
pub struct Medic {
    // The wound being dressed (whose, its first bleed) and how long it has been worked on.
    job: Option<(Entity, usize, f32)>,
    pub prompt: String,
    pub clock: f32,
    // The gauze heard going round, at the wound, while a dressing is being put on; whom the medkit was last unzipped for.
    wrap: Option<crate::sound::Stream>,
    opened: Option<Entity>,
}


impl Medic {
    // How far through the one being put on, 0 to 1, or None.
    pub fn working(&self) -> Option<f32> {
        self.job.map(|j| j.2 / SECONDS)
    }
}

struct Grab {
    body: Entity,
    // The point taken hold of, in the body's own frame, and how far off it was.
    local: Vec3,
    distance: f32,
    mass: f32,
    target: Option<Vec3>,
}

impl Default for Weapons {
    fn default() -> Self {
        Weapons {
            slots: [Some("pistol"), Some("knife"), Some("fists"), None, None, None],
            bag: [None; 12],
            slot: 0,
            ammo: ARMS.iter().filter_map(|a| a.rounds.map(|r| (a.key, r))).collect(),
            queue: Vec::new(),
            busy: 0.0,
            reloading: 0.0,
            firing: false,
            recoil: 0.0,
            action: None,
            throw_kind: 0,
            since: f32::INFINITY,
            later: Vec::new(),
            grab: None,
            bowel: None,
            holding: None,
            struck: HashMap::new(),
            grenades: Vec::new(),
            thrown: Vec::new(),
            casings: HashMap::new(),
            holes: (Vec::new(), 0),
            blades: HashMap::new(),
            log: Vec::new(),
            sight: None,
            medic: Medic::default(),
        }
    }
}

impl Weapons {
    pub fn arm(&self) -> &'static Arm {
        arm(self.slots[self.slot].unwrap_or("hands"))
    }

    // What is being thrown, as the HUD names it.
    pub fn throwing(&self) -> String {
        let name = THROWN[self.throw_kind].0;
        let name = name.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end_matches('_');
        name.replace('_', " ")
    }

    // The slot at hand `i` (0 to 5) taken up: whatever is in it, or the bare hands.
    fn select(&mut self, i: usize) {
        if i >= self.slots.len() {
            return;
        }
        self.grab = None;
        self.slot = i;
        self.action = None;
        self.reloading = 0.0;
        self.since = f32::INFINITY;
    }

    // `key` from the arsenal into the hand: into the slot held if it is empty, else the first empty one, else in place of
    // what is held (which goes back on the wall). What is carried already is just taken up.
    fn take(&mut self, key: &'static str, sound: &mut Sound) {
        if let Some(have) = self.slots.iter().position(|s| *s == Some(key)) {
            self.select(have);
            return;
        }
        let into = if self.slots[self.slot].is_none() { Some(self.slot) } else { self.slots.iter().position(|s| s.is_none()) };
        let into = into.unwrap_or(self.slot);
        self.slots[into] = Some(key);
        self.select(into);
        sound.play("rack", Play { gain: 0.35, rate: 1.3, ..default() });
    }

    // What is held, back on the wall.
    fn put_back(&mut self) {
        if self.slots[self.slot].is_none() {
            return;
        }
        self.slots[self.slot] = None;
        self.select(self.slot);
    }

    // Two places swapped (from the inventory screen): `bag` false for the slots at hand.
    pub fn swap(&mut self, from_bag: bool, from: usize, to_bag: bool, to: usize) {
        let a = if from_bag { self.bag[from] } else { self.slots[from] };
        let b = if to_bag { self.bag[to] } else { self.slots[to] };
        if from_bag { self.bag[from] = b } else { self.slots[from] = b }
        if to_bag { self.bag[to] = a } else { self.slots[to] = a }
        self.select(self.slot);
    }
}

// weapons.json: each model's file, and where on it (in its own glTF frame) the hand grips it, its muzzle or point,
// which way is up on it (a blade's back), and a gun's ejection port.
#[derive(Deserialize, Clone)]
pub struct Spec {
    pub file: String,
    pub grip: [f32; 3],
    pub tip: [f32; 3],
    pub up: [f32; 3],
    pub ejection: Option<[f32; 3]>,
    #[serde(rename = "ejectDir")]
    pub eject_dir: Option<[f32; 3]>,
}

#[derive(Resource, Default)]
pub struct WeaponModels {
    pub specs: HashMap<String, Spec>,
    pub gltf: HashMap<String, Handle<Gltf>>,
}

impl WeaponModels {
    // The turn and offset that put a model's grip at the hand's origin, its bore (or blade) pointing ahead (-Z) and its
    // up up, applied to the glTF scene as it comes in. (The TS turned it so in Babylon's space from where Babylon's
    // glTF loader put it, half a turn about Y from the file's own frame; this is that seen in the mirror.)
    pub fn held(&self, key: &str) -> Transform {
        let j = &self.specs[key];
        let file = Quat::from_rotation_y(std::f32::consts::PI);
        let p = |a: [f32; 3]| file * Vec3::from(a);
        let grip = p(j.grip);
        let tip = p(j.tip);
        let up = (p([j.grip[0] + j.up[0], j.grip[1] + j.up[1], j.grip[2] + j.up[2]]) - grip).normalize();
        // (Ahead is along the bore, square to the model's up: a gun's muzzle is above its grip, and the line from one
        // to the other pointed the pistol 23 degrees down.)
        let ahead = ((tip - grip) - up * (tip - grip).dot(up)).normalize();
        let up = (up - ahead * up.dot(ahead)).normalize();
        let turn = Quat::from_mat3(&Mat3::from_cols(up.cross(-ahead), up, -ahead)).inverse();
        Transform { translation: -(turn * grip), rotation: turn * file, scale: Vec3::ONE }
    }

    // The box round a model's meshes in its own glTF frame turned by `turn`: (min, max). None until it has loaded.
    pub fn bounds(&self, key: &str, turn: Quat, gltfs: &Assets<Gltf>, nodes: &Assets<GltfNode>, meshes: &Assets<GltfMesh>,
                  data: &Assets<Mesh>) -> Option<(Vec3, Vec3)> {
        let gltf = gltfs.get(&self.gltf[key])?;
        let children: Vec<AssetId<GltfNode>> = gltf.nodes.iter().filter_map(|n| nodes.get(n)).flat_map(|n| n.children.iter().map(|c| c.id())).collect();
        let mut lo = Vec3::splat(f32::INFINITY);
        let mut hi = -lo;
        let mut stack: Vec<(AssetId<GltfNode>, Mat4)> =
            gltf.nodes.iter().filter(|n| !children.contains(&n.id())).map(|n| (n.id(), Mat4::from_quat(turn))).collect();
        while let Some((id, parent)) = stack.pop() {
            let node = nodes.get(id)?;
            let world = parent * node.transform.to_matrix();
            if let Some(mesh) = node.mesh.as_ref().and_then(|m| meshes.get(m)) {
                for prim in &mesh.primitives {
                    let Some(bevy::mesh::VertexAttributeValues::Float32x3(ps)) = data.get(&prim.mesh)?.attribute(Mesh::ATTRIBUTE_POSITION) else { continue };
                    for p in ps {
                        let q = world.transform_point3(Vec3::from(*p));
                        lo = lo.min(q);
                        hi = hi.max(q);
                    }
                }
            }
            stack.extend(node.children.iter().map(|c| (c.id(), world)));
        }
        Some((lo, hi))
    }

    pub fn loaded(&self, assets: &AssetServer) -> bool {
        // (One that failed is as loaded as it will get: it is left off the board, with Bevy's error in the log.)
        self.gltf.values().all(|h| assets.is_loaded_with_dependencies(h) || assets.load_state(h).is_failed())
    }
}

fn load(assets: Res<AssetServer>, mut models: ResMut<WeaponModels>) {
    let path = crate::asset_file("models/weapons/weapons.json");
    let specs: HashMap<String, Spec> = serde_json::from_slice(&std::fs::read(&path).expect("weapons.json")).expect("weapons.json");
    for (key, spec) in &specs {
        models.gltf.insert(key.clone(), assets.load(format!("models/weapons/{}", spec.file)));
    }
    models.specs = specs;
}

// --- people, as far as a weapon needs them ----------------------------------------------------------------------------

// A segment's two ends as the person was made (`rest`): where a person with no ragdoll yet is (Cx::ends has the live ones).
pub fn segment_ends(s: &crate::ragdoll::Segment) -> (Vec3, Vec3) {
    (s.rest.translation, s.rest.transform_point(s.end))
}

// Where the line from `o` along unit `d` comes nearest the segment from `a` to `b`: how far along the line, and how near
// (anatomy.ts rayToSegment).
pub fn ray_to_segment(o: Vec3, d: Vec3, a: Vec3, b: Vec3) -> (f32, f32) {
    let u = b - a;
    let w = o - a;
    let (uu, ud, uw, dw) = (u.dot(u), u.dot(d), u.dot(w), d.dot(w));
    let den = uu - ud * ud;
    let s = if den > 1e-9 { (uw - ud * dw) / den } else { 0.0 }.clamp(0.0, 1.0);
    let p = a + u * s;
    let t = (p - o).dot(d);
    (t, (o + d * t - p).length())
}

// Where a line from `o` along unit `d` first goes into the capsule round `a`-`b` of radius `r`: how far along, if it does.
fn into_capsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: f32) -> Option<f32> {
    let (t, near) = ray_to_segment(o, d, a, b);
    if near > r {
        return None;
    }
    // Back from the nearest approach along the line to where it is r from the axis (the cylinder's or an end's ball).
    let mut lo = t - 2.0 * r;
    let mut hi = t;
    let dist = |s: f32| {
        let p = o + d * s;
        let u = b - a;
        let k = ((p - a).dot(u) / u.length_squared().max(1e-9)).clamp(0.0, 1.0);
        (p - (a + u * k)).length()
    };
    if dist(lo) <= r {
        return Some(lo.max(0.0));
    }
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if dist(mid) > r { lo = mid } else { hi = mid }
    }
    Some(hi.max(0.0))
}

// A crossing of someone's skin or clothes (npc.surface's): where, how far along the line, the segment it is on.
#[derive(Clone, Debug)]
pub struct Crossing {
    pub point: Vec3,
    pub t: f32,
    pub segment: usize,
}

// The first skin or clothes of `npc` the line from `o` along `d` crosses within `far` (npc.surface).
pub fn surface(npc: &mut Npc, o: Vec3, d: Vec3, far: f32) -> Option<Crossing> {
    let c = npc.surface(o, d, far, false).into_iter().find(|h| matches!(h.kind, npc::Kind::Skin | npc::Kind::Cloth))?;
    let segment = npc.struck(c.point, d).unwrap_or(0);
    Some(Crossing { point: c.point, t: c.t, segment })
}

// What a missile did (wounds.rs Pierced): whether it went in, stopped in there, where it ended or came out, with what
// energy left, and where it went in.
#[derive(Debug)]
pub struct Pierced {
    pub hit: bool,
    pub stopped: bool,
    pub at: Option<Vec3>,
    pub energy: f32,
    pub enter: Option<Vec3>,
}

// The two calls a weapon makes into a body (wounds.rs pierce and blow): everything a shot, a blade or a blow does to a
// person goes through here, and into the log of what was hit.
fn pierce(cx: &mut Cx, who: Entity, origin: Vec3, dir: Vec3, m: &Missile, far: f32) -> Pierced {
    pierce_with(cx, who, origin, dir, m, far, None)
}

// pierce, with what the line meets in them already worked out (wounds.rs `lines`), or not.
fn pierce_with(cx: &mut Cx, who: Entity, origin: Vec3, dir: Vec3, m: &Missile, far: f32, lines: Option<wounds::Lines>) -> Pierced {
    let missile = m.wounds();
    let Some((res, seg)) = cx.npc(who, |n| {
        let res = wounds::pierce_with(n, origin, dir, &missile, far, lines);
        let seg = res.enter.as_ref().and_then(|c| n.nearest(c.point).0).map(|k| n.person.segments[k].name.clone());
        (res, seg)
    }) else {
        return Pierced { hit: false, stopped: false, at: None, energy: m.energy, enter: None };
    };
    if res.hit {
        let label = cx.label(who);
        cx.weapons.log.push(json!({ "hit": "pierce", "person": label, "segment": seg, "point": res.enter.as_ref().map(|c| c.point.to_array()),
                                    "dir": dir.to_array(), "missile": m.name, "energy": m.energy, "calibre": m.calibre, "slash": m.slash,
                                    "blade": m.blade, "stopped": res.stopped, "left": res.energy, "out": res.at.map(|a| a.to_array()) }));
    }
    Pierced { hit: res.hit, stopped: res.stopped, at: res.at, energy: res.energy, enter: res.enter.map(|c| c.point) }
}

#[allow(clippy::too_many_arguments)]
fn blow(cx: &mut Cx, who: Entity, point: Vec3, dir: Vec3, mass: f32, speed: f32, tool: Option<Tool>) {
    let (force, seg) = cx.npc(who, |n| {
        let force = wounds::blow(n, point, dir, mass, speed, tool.map(Tool::wounds));
        (force, n.struck(point, dir).map(|k| n.person.segments[k].name.clone()))
    }).unzip();
    let label = cx.label(who);
    cx.weapons.log.push(json!({ "hit": "blow", "person": label, "segment": seg.flatten(), "point": point.to_array(), "dir": dir.to_array(), "mass": mass,
                                "speed": speed, "joules": 0.5 * mass * speed * speed, "newtons": force, "tool": format!("{tool:?}") }));
}

// --- the thing in the hand --------------------------------------------------------------------------------------------

// Where a model's muzzle (or point) and ejection port are in the hand's frame, and which way across a blade its edge is.
#[derive(Clone, Copy, Default)]
pub struct Anchors {
    pub tip: Vec3,
    pub ejection: Option<Vec3>,
    pub edge: Option<Vec3>,
}

// A part of a model that moves in the hands (PARTS): its nodes as they were made, and its bounds in the hand's frame.
pub struct Part {
    pub nodes: Vec<(Entity, Transform)>,
    // Each node's parent's frame in the hand's.
    pub to_hand: Vec<bevy::math::Affine3A>,
    pub min: Vec3,
    pub max: Vec3,
}

// The hand: an entity under the eye that whatever is held hangs from, each thing's own entity under it (turned so its
// grip is at the hand and it points ahead), and where it is in the eye's frame as last drawn.
#[derive(Resource, Default)]
pub struct Hand {
    pub entity: Option<Entity>,
    pub local: Transform,
    pub models: HashMap<&'static str, Entity>,
    pub anchors: HashMap<&'static str, Anchors>,
    pub parts: HashMap<&'static str, HashMap<&'static str, Part>>,
    pub clock: f32,
    // The look's turn as the hands lag it: last yaw and pitch (the TS's signs), and their rates eased.
    pub lag: [f32; 4],
    // Each thing's hull and box in the hand's frame (`measure`), and how far it is pulled back toward the chest (m) and turned
    // aside (rad) out of what it is held against (`clear_of`), and what that is and where, if it is someone's segment.
    pub shapes: HashMap<&'static str, Collider>,
    pub boxes: HashMap<&'static str, (Vec3, Vec3)>,
    pub back: f32,
    pub tilt: f32,
    pub against: Option<(Entity, Vec3)>,
}

impl Hand {
    // The hand in the world, the eye at `eye`.
    pub fn world(&self, eye: &Transform) -> Transform {
        eye.mul_transform(self.local)
    }
}

// Everything the hands act through.
#[derive(bevy::ecs::system::SystemParam)]
pub struct Cx<'w, 's> {
    pub commands: Commands<'w, 's>,
    pub weapons: ResMut<'w, Weapons>,
    pub hand: ResMut<'w, Hand>,
    pub sound: ResMut<'w, Sound>,
    pub rng: ResMut<'w, Rng>,
    pub notes: ResMut<'w, Notes>,
    pub muzzle: ResMut<'w, crate::muzzle::Muzzle>,
    pub time: Res<'w, Time>,
    pub assets: Res<'w, AssetServer>,
    pub models: ResMut<'w, Models>,
    pub weapon_models: Res<'w, WeaponModels>,
    pub gltfs: Res<'w, Assets<Gltf>>,
    pub meshes: ResMut<'w, Assets<Mesh>>,
    pub materials: ResMut<'w, Assets<StandardMaterial>>,
    pub rapier: ReadRapierContext<'w, 's>,
    pub arsenal: Option<Res<'w, Arsenal>>,
    pub player: Query<'w, 's, (&'static mut Player, &'static Transform)>,
    pub people: Query<'w, 's, (Entity, &'static Person)>,
    pub bodies: Query<'w, 's, (&'static Transform, Option<&'static Velocity>), (With<RigidBody>, Without<Player>)>,
    pub fists: ResMut<'w, crate::fist::Fists>,
    pub hurts: Query<'w, 's, (&'static Transform, &'static mut Vitals, &'static mut Hurt), Without<Player>>,
    pub dice: ResMut<'w, Dice>,
    pub frame: Res<'w, FrameCount>,
    pub ragdolls: Query<'w, 's, &'static mut Ragdoll>,
    pub behaviours: Query<'w, 's, &'static mut Behaviour>,
    pub grabbed: Query<'w, 's, &'static mut Grabbed>,
    pub slams: MessageReader<'w, 's, crate::thuds::Slam>,
    pub viscera: Query<'w, 's, (Entity, &'static mut crate::viscera::Viscera)>,
}

struct Wall {
    distance: f32,
    point: Vec3,
    normal: Vec3,
}

impl Cx<'_, '_> {
    // A person's medicine borrowed for one shot, blow or dressing (npc::with's, inside a system). None until they have
    // their Hurt (the frame after they are made).
    pub fn npc<R>(&mut self, who: Entity, f: impl FnOnce(&mut Npc) -> R) -> Option<R> {
        let (_, person) = self.people.get(who).ok()?;
        let (root, mut vitals, mut hurt) = self.hurts.get_mut(who).ok()?;
        let traced = hurt.traced.clone();
        let mut npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut self.dice, frame: self.frame.0 };
        Some(f(&mut npc))
    }

    // A person's segment `k` in the world now (its two ends): their ragdoll's, or as they were made.
    pub fn ends(&self, who: Entity, p: &Person, k: usize) -> (Vec3, Vec3) {
        match self.ragdolls.get(who) {
            Ok(rd) => {
                let [a, b] = rd.segment_ends(k);
                (a, b)
            }
            Err(_) => segment_ends(&p.segments[k]),
        }
    }

    // Where a person is as a whole: the middle of their pelvis (ragdoll.ts centre).
    pub fn centre(&self, who: Entity, p: &Person) -> Vec3 {
        let k = p.segments.iter().position(|s| s.name == "pelvis").unwrap_or(0);
        match self.ragdolls.get(who) {
            Ok(rd) => rd.segs[k].now.translation,
            Err(_) => p.segments[k].rest.translation,
        }
    }

    fn eye(&self) -> Transform {
        self.player.single().map(|(_, t)| *t).unwrap_or_default()
    }

    fn note(&mut self, what: String) {
        let now = self.time.elapsed_secs_f64();
        self.notes.note(now, what);
    }

    // The room's walls, floor and fixed things: where a line meets them.
    fn wall(&self, origin: Vec3, dir: Vec3) -> Option<Wall> {
        let ctx = self.rapier.single().ok()?;
        // (Only what is built: the TS picked the map's solid meshes. A casing, a thrown thing or the grenade's own ball
        // is not a wall, and the fragments of a grenade started inside its ball.)
        let filter = QueryFilter::only_fixed().groups(CollisionGroups::new(Group::ALL, WORLD));
        let (_, hit) = ctx.cast_ray_and_get_normal(origin, dir, 200.0, true, filter)?;
        Some(Wall { distance: hit.time_of_impact, point: hit.point, normal: if hit.normal.length_squared() > 0.5 { hit.normal } else { -dir } })
    }

    // The nearest person a line could meet: tested against their segments first, which is cheap. Who, and how far along
    // the line to start looking (half a metre short of their segment).
    fn person(&self, origin: Vec3, dir: Vec3, far: f32) -> Option<(Entity, f32)> {
        let mut best: Option<(Entity, f32)> = None;
        for (e, p) in &self.people {
            for (k, s) in p.segments.iter().enumerate() {
                let (a, b) = self.ends(e, p, k);
                let (t, d) = ray_to_segment(origin, dir, a, b);
                if t > 0.0 && t < far && d < s.radius + 0.12 && best.is_none_or(|(_, bt)| t < bt) {
                    best = Some((e, t));
                }
            }
        }
        best.map(|(e, t)| (e, (t - 0.5).max(0.0)))
    }

    // A point of what is in the hand, or the nearest point to it on the line from the eye that is on the eye's side of the
    // room's walls (a gun held out over the wall's edge must not shoot from beyond it).
    fn before_wall(&self, at: Vec3) -> Vec3 {
        let eye = self.eye().translation;
        let out = at - eye;
        let far = out.length();
        if far < 1e-4 {
            return at;
        }
        match self.wall(eye, out / far) {
            Some(w) if w.distance < far => eye + out * ((w.distance - 0.01) / far),
            _ => at,
        }
    }

    // Where a shot from the gun `key` in the hand starts and the way it goes: from its muzzle, along its bore, as the gun is
    // held this moment (swayed, kicked, mid-reload), not from the eye along the middle of the view.
    pub fn bore(&self, key: &str) -> (Vec3, Vec3) {
        let hand = self.hand.world(&self.eye());
        let tip = self.hand.anchors.get(key).map_or(Vec3::new(0.0, 0.0, -0.6), |a| a.tip);
        (self.before_wall(hand.transform_point(tip)), hand.rotation * Vec3::NEG_Z)
    }

    fn label(&self, e: Entity) -> String {
        self.people.get(e).map_or(String::new(), |(_, p)| p.label.clone())
    }
}

pub fn jitter(rng: &mut Rng, dir: Vec3, spread: f32) -> Vec3 {
    let a = rng.next() * std::f32::consts::TAU;
    let r = rng.next().sqrt() * spread;
    let side = dir.cross(Vec3::Y).normalize();
    let up = side.cross(dir).normalize();
    (dir + side * (a.cos() * r) + up * (a.sin() * r)).normalize()
}

// One bullet, pellet or fragment from `from` along `dir`, followed through whoever it goes through.
fn shot(cx: &mut Cx, from: Vec3, dir: Vec3, m: Missile, skips: f32) {
    shot_from(cx, from, dir, m, skips, None);
}

// Where a shot from its start first meets the room and someone, and what it meets in them, worked out beforehand (`legs`).
struct Leg {
    wall: Option<Wall>,
    person: Option<(Entity, f32)>,
    lines: Option<wounds::Lines>,
}

// shot, its first leg already worked out, or not.
fn shot_from(cx: &mut Cx, mut from: Vec3, mut dir: Vec3, m: Missile, skips: f32, mut first: Option<Leg>) {
    let mut origin = from;
    // (How far it has come from the muzzle before `from`: the legs before a skip off the floor; less than nothing for a
    // shot followed from inside the barrel, `fire`'s.)
    let mut gone = m.muzzle;
    let mut energy = m.energy;
    for _ in 0..6 {
        if energy <= 15.0 {
            return;
        }
        let (wall, near, lines) = match first.take() {
            Some(leg) => (leg.wall, leg.person, leg.lines),
            None => {
                let wall = cx.wall(origin, dir);
                let near = cx.person(origin, dir, wall.as_ref().map_or(200.0, |w| w.distance));
                (wall, near, None)
            }
        };
        let far = wall.as_ref().map_or(200.0, |w| w.distance);
        let Some((who, t)) = near else {
            let Some(w) = wall else { return };
            hole(cx, w.point, w.normal, m.calibre);
            cx.weapons.log.push(json!({ "hit": "wall", "point": w.point.to_array(), "missile": m.name }));
            // Soft lead meeting concrete at a glancing angle skips off it, leaving lower than it came and slower (Haag,
            // Shooting Incident Reconstruction: ricochet angles are smaller than incidence angles). Below `skips`
            // (radians) it goes on; the angle and the 40% of its energy it keeps are estimates.
            let into = -dir.dot(w.normal);
            if skips <= 0.0 || into <= 0.0 || into.min(1.0).asin() > skips {
                return;
            }
            dir = (dir + w.normal * (into * 1.5)).normalize();
            gone += w.point.distance(from);
            from = w.point;
            origin = w.point + w.normal * 0.005;
            energy *= 0.4;
            continue;
        };
        let reach = (3.0f32).min(far - t + 2.0) + t;
        let res = pierce_with(cx, who, origin, dir, &Missile { energy, muzzle: origin.distance(from) + gone, ..m }, reach, lines);
        if !res.hit {
            origin += dir * (t + 0.3);
            continue;
        }
        let Some(at) = res.at.filter(|_| !res.stopped) else { return };
        energy = res.energy;
        origin = at + dir * 0.02;
    }
}

// A bullet hole in the room (the TS's thin instances, 600 at most, the oldest put to use again).
fn hole(cx: &mut Cx, at: Vec3, normal: Vec3, calibre: f32) {
    let n = normal.normalize();
    let s = calibre * 2.4;
    let place = Transform::from_translation(at + n * 0.001).looking_to(-n, if n.y.abs() > 0.9 { Vec3::X } else { Vec3::Y }).with_scale(Vec3::splat(s));
    let (list, next) = &mut cx.weapons.holes;
    if list.len() < 600 {
        let (mesh, material) = cx.muzzle.hole.clone();
        list.push(cx.commands.spawn((Mesh3d(mesh), MeshMaterial3d(material), place, bevy::light::NotShadowCaster, Name::new("hole"))).id());
    } else {
        cx.commands.entity(list[*next % 600]).insert(place);
        *next += 1;
    }
}

fn fire(cx: &mut Cx, key: &'static str) {
    let gun = arm(key).gun.as_ref().unwrap();
    if cx.weapons.ammo[key] == 0 {
        reload(cx);
        return;
    }
    cx.note(format!("shot {key}"));
    *cx.weapons.ammo.get_mut(key).unwrap() -= 1;
    cx.weapons.busy = gun.every;
    cx.weapons.recoil = 1.0;
    let (muzzle, ahead) = cx.bore(key);
    // (Followed from a few centimetres inside the barrel: a muzzle pressed into someone sinks a little into the give of
    // their clothes and skin, and the line from it would begin inside them and miss the way in.)
    let from = cx.before_wall(muzzle - ahead * IN_BARREL);
    // A shotgun's charge flies as one mass for the first metre or so before the pellets part: up to about 1.2 m it makes
    // one round hole 2 to 2.5 cm across and goes in as a single heavy missile, wrecking everything along a wide track
    // (dev/research/wounds.md). Further off, the pellets go their own ways.
    let near = if gun.pellets > 1 { cx.person(from, ahead, 1.4) } else { None };
    // (Timed for the log: the TS spent 110 to 360 ms of a frame on one shotgun blast.)
    let started = std::time::Instant::now();
    match near {
        Some((_, t)) if t + 0.5 < 1.3 => {
            let off = t + 0.5;
            let dir = jitter(&mut cx.rng, ahead, gun.spread * 0.05);
            let n = gun.pellets as f32;
            let slug = Missile { name: "charge", energy: gun.m.energy * n * (1.0 - off * 0.1), mass: gun.m.mass * n, calibre: if off < 0.6 { 0.022 } else { 0.026 },
                                 channel: 0.024, soft: 42.0, hard: 120.0, ..gun.m };
            shot(cx, from, dir, Missile { muzzle: -IN_BARREL, ..slug }, 0.0);
        }
        _ => {
            for _ in 0..gun.pellets {
                let dir = jitter(&mut cx.rng, ahead, gun.spread);
                shot(cx, from, dir, Missile { name: if gun.pellets > 1 { "pellet" } else { "bullet" }, muzzle: -IN_BARREL, ..gun.m }, gun.skips);
            }
        }
    }
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    cx.weapons.log.push(json!({ "shot": key, "pellets": gun.pellets, "ms": (ms * 100.0).round() / 100.0 }));
    cx.sound.play(gun.sound, Play::default());
    // The flash at the muzzle, one frame (muzzle.rs), and the light it throws, going by the clock.
    let hand = cx.hand.world(&cx.eye());
    let tip = cx.hand.anchors.get(key).map_or(Vec3::new(0.0, 0.0, -0.6), |a| a.tip);
    let muzzle = hand.transform_point(tip);
    cx.note(format!("  from the muzzle {:.2?} along the bore {:.3?}", muzzle.to_array(), ahead.to_array()));
    let now = cx.time.elapsed_secs();
    let dice = cx.rng.next();
    cx.muzzle.fire(key, tip, muzzle, ahead, now, dice);
    let (k1, k2) = (cx.rng.next(), cx.rng.next());
    if let Ok((mut p, _)) = cx.player.single_mut() {
        p.pitch += gun.kick * (0.6 + k1 * 0.4);
        p.yaw += (k2 - 0.5) * gun.kick * 0.4;
    }
    if key != "shotgun" {
        if let Some(port) = cx.hand.anchors.get(key).and_then(|a| a.ejection) {
            eject(cx, key, hand.transform_point(port));
        }
    }
    // The bolt worked for the next round as `cycle` shows it: up and back, then forward and down.
    if key == "rifle" {
        cx.weapons.later.push((0.25, Later::Sound("bolt-open", 0.8)));
        cx.weapons.later.push((0.5, Later::Sound("bolt-close", 0.8)));
    }
}

// A spent case thrown out of the port, one rigid body each, 40 a cartridge at most (past 40 the oldest is thrown again).
fn eject(cx: &mut Cx, key: &'static str, at: Vec3) {
    // (.50 AE: 32.6 mm long, 13.9 mm across its base; .22 LR: 15.6 mm by 5.7 mm)
    let (long, wide) = match key {
        "rifle" => (0.051, 0.012),
        "ak" => (0.039, 0.0113),
        "m4" => (0.045, 0.0096),
        "deagle" => (0.0326, 0.0139),
        "r22" => (0.0156, 0.0057),
        _ => (0.019, 0.0098),
    };
    let eye = cx.eye();
    let (r1, r2, r3, r4) = (cx.rng.next(), cx.rng.next(), cx.rng.next(), cx.rng.next());
    let v = Velocity { linear: eye.right() * (2.0 + r1) + eye.up() * (1.5 + r2), angular: Vec3::new(r3 * 20.0, r4 * 20.0, 0.0) };
    let place = Transform::from_translation(at).with_rotation(eye.rotation * Quat::from_rotation_z(std::f32::consts::FRAC_PI_2));
    let brass = cx.muzzle.brass.clone();
    let (list, next) = cx.weapons.casings.entry(key).or_default();
    let e = if list.len() < 40 {
        let mesh = cx.meshes.add(Cylinder::new(wide / 2.0, long).mesh().resolution(10));
        let e = cx
            .commands
            .spawn((Mesh3d(mesh), MeshMaterial3d(brass), place, RigidBody::Dynamic, Collider::cylinder(long / 2.0, wide / 2.0),
                    ColliderMassProperties::Mass(0.01), Restitution::coefficient(0.4), Friction::coefficient(0.6), v, Name::new("casing")))
            .id();
        list.push(e);
        e
    } else {
        let e = list[*next % 40];
        *next += 1;
        cx.commands.entity(e).insert((place, v));
        e
    };
    let d = 0.5 + cx.rng.next() * 0.2;
    cx.weapons.later.push((d, Later::Casing(e)));
}

fn reload(cx: &mut Cx) {
    let a = cx.weapons.arm();
    let Some(gun) = &a.gun else { return };
    if cx.weapons.reloading > 0.0 || cx.weapons.ammo[a.key] == gun.rounds {
        return;
    }
    cx.weapons.reloading = gun.reload;
}

fn swing(cx: &mut Cx, how: How) {
    let a = cx.weapons.arm();
    let length = if how == How::Stab { 0.35 } else { a.swing };
    cx.weapons.busy = length;
    cx.weapons.action = Some(Action { how, t: 0.0, length, landed: false, was: None, hits: Vec::new(), stopped: None, clear: 0.0 });
    let rate = match a.key {
        "knife" => 1.25,
        "hammer" => 1.2,
        _ => 1.0,
    };
    cx.sound.play(a.whoosh.unwrap_or("swing"), Play { gain: if how == How::Stab { 0.5 } else { 0.9 }, rate, ..default() });
}

// The first skin or clothes of anyone that a point of what is held crosses going from `a` to `b` (this frame's move):
// who, the crossing, and the way it was going.
fn meets(cx: &mut Cx, a: Vec3, b: Vec3) -> Option<(Entity, Crossing, Vec3)> {
    let d = b - a;
    let far = d.length();
    if far < 1e-5 {
        return None;
    }
    let d = d / far;
    // (Within reach of any of its segments, before the costlier look at the skin.)
    let near: Vec<Entity> = cx
        .people
        .iter()
        .filter(|(e, p)| {
            p.segments.iter().enumerate().any(|(k, s)| {
                let (pa, pb) = cx.ends(*e, p, k);
                let (t, dist) = ray_to_segment(a, d, pa, pb);
                dist < s.radius + 0.1 && t > -0.1 && t < far + 0.1
            })
        })
        .map(|(e, _)| e)
        .collect();
    for e in near {
        if let Some(c) = cx.npc(e, |n| surface(n, a, d, far)).flatten() {
            return Some((e, c, d));
        }
    }
    None
}

// A stab, a cut or a blow under way. What it meets is what the thing in the hand meets as it is drawn: points along its
// edge (a blade's, from near its hilt to the point), or on its head (the bat's barrel, the tools' heads), each followed
// from where it was drawn last frame to where it was drawn this one, and the first skin or cloth any of those moves
// crosses is struck there, along the way that point was going. A swing that passes beside someone's head, as drawn,
// touches nothing. (The hand's pose is `animate`'s of the frame before: the one on the screen.)
fn sweep(cx: &mut Cx, dt: f32) {
    let a = cx.weapons.arm();
    let Some(act) = cx.weapons.action.as_mut() else { return };
    act.t += dt;
    let p = act.t / act.length;
    let how = act.how;
    let Some(tip) = cx.hand.anchors.get(a.key).map(|x| x.tip) else { return };
    // (A stab is the point driven in; the rest of the edge meeting someone first, as a long blade thrust from too close
    // does, draws across them as a cut would.)
    let along = swept(a.key, a.kind);
    let hand = cx.hand.world(&cx.eye());
    let now: Vec<Vec3> = along.iter().map(|f| hand.transform_point(tip * *f)).collect();
    let act = cx.weapons.action.as_mut().unwrap();
    let was = act.was.replace(now.clone());
    let (from, to) = match how {
        How::Stab => (0.05, 0.6),
        How::Down => (0.25, 0.75),
        _ => (0.1, 0.85),
    };
    let Some(was) = was else { return };
    if p < from || p > to || (act.landed && how != How::Cut) || act.stopped.is_some() {
        return;
    }
    // (The point first: a stab is that, where it goes in.)
    let order: Vec<usize> = if how == How::Stab { (0..now.len()).rev().collect() } else { (0..now.len()).collect() };
    for k in order {
        let Some((who, hit, dir)) = meets(cx, was[k], now[k]) else { continue };
        let far = was[k].distance(now[k]);
        // (Which point of the thing met them, and its move this frame: the hit is on that, wherever the eye looks.)
        cx.weapons.log.push(json!({ "swept": [was[k].to_array(), now[k].to_array()], "of_the_way_to_the_tip": along[k], "met": hit.point.to_array() }));
        let label = cx.label(who);
        match if how == How::Stab && along[k] < 1.0 { How::Cut } else { how } {
            How::Stab => {
                let stab = a.stab.unwrap();
                let across = cx.hand.anchors.get(a.key).and_then(|x| x.edge).map(|e| (hand.rotation * e).normalize());
                let res = pierce(cx, who, was[k], dir, &Missile { across, name: a.key, ..stab }, far + stab.reach);
                cx.weapons.action.as_mut().unwrap().landed = true;
                cx.note(format!("  {} stab met {label} at {:.2?}", a.key, hit.point.to_array()));
                // The blade comes out with blood over what went in, both faces, about as wide as it is.
                if let (true, Some(enter)) = (res.hit, res.enter) {
                    let deep = res.at.map_or(stab.reach, |at| enter.distance(at)).min(stab.reach);
                    bloody(&mut cx.weapons, a.key, deep * stab.calibre);
                }
                cx.sound.play("stab", Play::at(hit.point));
                return;
            }
            How::Blow | How::Down => {
                cx.weapons.action.as_mut().unwrap().landed = true;
                cx.note(format!("  {} {} met {label} at {:.2?}", a.key, if how == How::Down { "down" } else { "blow" }, hit.point.to_array()));
                let down = if how == How::Down { a.down.as_ref() } else { None };
                if let Some(claw) = down.and_then(|d| d.claw) {
                    // The claw's tines driven in (a puncture), along the way it comes down.
                    let across = Some(cx.eye().right().as_vec3());
                    let res = pierce(cx, who, hit.point - dir * 0.05, dir, &Missile { across, name: "claw", ..claw }, 0.05 + claw.reach);
                    if res.hit {
                        cx.sound.play("stab", Play::at(hit.point));
                    }
                } else {
                    let speed = down.and_then(|d| d.speed).unwrap_or(a.speed);
                    let tool = down.and_then(|d| d.tool).or(a.tool);
                    blow(cx, who, hit.point, dir, a.mass, speed, tool);
                    cx.sound.play(a.sound.unwrap_or("blunt"), Play::at(hit.point));
                    // The shovel's edge also splits the skin over what it broke: a chop, drawn as a short cut across it.
                    if let Some(cut) = down.and_then(|d| d.cut) {
                        let chop = Missile { name: "chop", energy: 60.0, mass: 0.3, calibre: 0.004, channel: cut * 0.5, soft: 0.8, hard: 60.0, reach: cut, blade: true, slash: true, ..M };
                        let res = pierce(cx, who, hit.point - dir * 0.05, dir, &chop, 0.05 + cut);
                        if let (true, Some(enter)) = (res.hit, res.enter) {
                            cx.weapons.action.as_mut().unwrap().hits.push((who, vec![enter]));
                        }
                    }
                }
                let act = cx.weapons.action.as_mut().unwrap();
                act.t = act.t.max(act.length * 0.75);
                return;
            }
            How::Cut => {
                let m = Missile { name: a.key, energy: if a.key == "sword" { 90.0 } else { 35.0 }, mass: 0.3, calibre: 0.004, channel: a.cut * 0.5, soft: 0.8, hard: 60.0,
                                  reach: a.cut, blade: true, slash: true, ..M };
                let res = pierce(cx, who, was[k], dir, &m, far + a.cut);
                let (true, Some(enter)) = (res.hit, res.enter) else { continue };
                // The cut itself is made once the swing is through, along every place it crossed the skin (npc.slash).
                let act = cx.weapons.action.as_mut().unwrap();
                match act.hits.iter_mut().find(|h| h.0 == who) {
                    Some(h) => h.1.push(enter),
                    None => {
                        act.hits.push((who, vec![enter]));
                        cx.sound.play("skin", Play::at(enter).gain(0.9));
                        cx.note(format!("  {} cut met {label} at {:.2?}", a.key, enter.to_array()));
                    }
                }
                // Nothing is thrown out of the cut as it is made (no pressure behind it); the blade picks blood up as it
                // goes through, a few centimetres of its edge in the flesh at a time (an estimate).
                bloody(&mut cx.weapons, a.key, a.cut * 0.03);
            }
        }
    }
}

// Blood onto blade `key`: a film over `area` square metres of it, both faces (ml).
fn bloody(w: &mut Weapons, key: &'static str, area: f32) {
    let b = w.blades.entry(key).or_insert((0.0, 0.0, 0.0));
    b.0 += 2.0 * area * FILM * 1e6;
    // (The smear is a film over the blade, as thick however often it has been in: it does not pile up.)
    b.1 = b.0.min(b.1.max(2.0 * area * SMEAR * 1e6));
    b.2 = 0.0;
}

// The hands taking hold of what is in front of the eye, within 3 m: a person (by the point of their skin looked at) or a
// thing that moves.
fn take_hold(cx: &mut Cx) {
    let eye = cx.eye();
    let (at, ahead) = (eye.translation, eye.forward().as_vec3());
    // Bowel that has come out is taken before the body (viscera.pick).
    if let Some(h) = crate::viscera::pick(cx.viscera.iter(), at, ahead, 3.0) {
        cx.weapons.bowel = Some(h);
        return;
    }
    // A person: knocked down and held by the segment nearest the skin looked at (behaviour.rs Grabbed), pulled every
    // physics step toward in front of the eye.
    if let Some((who, _)) = cx.person(at, ahead, 3.0) {
        let Some(skin) = cx.npc(who, |n| surface(n, at, ahead, 3.0)).flatten() else { return };
        let Ok(rd) = cx.ragdolls.get(who) else { return };
        let g = Grabbed::at(rd, skin.point, at);
        let seg = rd.segs[g.seg].def.name.clone();
        cx.commands.entity(who).insert(g);
        cx.weapons.holding = Some(who);
        let label = cx.label(who);
        cx.weapons.log.push(json!({ "grab": label, "segment": seg, "point": skin.point.to_array() }));
        return;
    }
    // Or a thing.
    let Ok(ctx) = cx.rapier.single() else { return };
    // (Not the player's own body, which the eye is inside.)
    let mut filter = QueryFilter::only_dynamic();
    filter.exclude_rigid_body = cx.player.single().ok().and_then(|(p, _)| p.body);
    let Some((e, toi)) = ctx.cast_ray(at, ahead, 3.0, true, filter) else { return };
    let body = ctx.colliders.collider_parent(ctx.rigidbody_set, e).unwrap_or(e);
    let Ok((t, _)) = cx.bodies.get(body) else { return };
    let point = at + ahead * toi;
    let mass = ctx.rigidbody_set.entity2body().get(&body).and_then(|h| ctx.rigidbody_set.bodies.get(*h)).map_or(1.0, |b| b.mass());
    cx.weapons.grab = Some(Grab { body, local: t.compute_affine().inverse().transform_point3(point), distance: toi, mass, target: None });
}

// --- throwing things, the grenade -------------------------------------------------------------------------------------

// A thing thrown (its blows are `landings`').
#[derive(Component)]
pub struct Thrown;

// A grenade's ball, carrying the model.
#[derive(Component)]
pub struct Grenade {
    last: f32,
    was: Vec3,
}

fn throw(cx: &mut Cx) {
    let (name, mass, stiffness) = THROWN[cx.weapons.throw_kind];
    cx.weapons.busy = 0.35;
    let (assets, meshes, materials) = (cx.assets.clone(), &mut *cx.meshes, &mut *cx.materials);
    cx.models.prepare(&[name], &assets, meshes, materials);
    let Some(info) = cx.models.info(name) else { return };
    let (lo, hi) = (Vec3::from(info.bounds.min), Vec3::from(info.bounds.max));
    let eye = cx.eye();
    let ahead = eye.forward().as_vec3();
    let (r1, r2) = (cx.rng.next(), cx.rng.next());
    let at = Transform::from_translation(eye.translation + ahead * 0.8 + Vec3::new(0.0, -0.25, 0.0))
        .with_rotation(Quat::from_euler(EulerRot::XYZ, r1, r2 * 6.0, 0.0));
    let Some(e) = cx.models.place(&mut cx.commands, name, at) else { return };
    let spin = Vec3::new(cx.rng.next() * 6.0 - 3.0, cx.rng.next() * 6.0 - 3.0, cx.rng.next() * 6.0 - 3.0);
    let v = ahead * if mass > 4.0 { 9.0 } else { 13.0 };
    // shortcut: a box round the model for its collider, where the TS took the convex hull; hull its mesh if things come
    // to rest visibly off the floor or lean on air.
    cx.commands.entity(e).insert((
        RigidBody::Dynamic,
        Collider::compound(vec![((lo + hi) / 2.0, Quat::IDENTITY, Collider::cuboid((hi.x - lo.x) / 2.0, (hi.y - lo.y) / 2.0, (hi.z - lo.z) / 2.0))]),
        ColliderMassProperties::Mass(mass),
        Friction::coefficient(0.6),
        Restitution::coefficient(0.15),
        Velocity { linear: v, angular: spin },
        Thrown,
    ));
    cx.weapons.thrown.push((e, mass, stiffness));
    if cx.weapons.thrown.len() > 30 {
        let old = cx.weapons.thrown.remove(0).0;
        cx.commands.entity(old).despawn();
    }
}

// An M67: pin out, lever off as it leaves the hand, and a fuse of four to five and a half seconds. Thrown overarm (left)
// or rolled underhand (right) at `speed` m/s.
fn lob(cx: &mut Cx, speed: f32) {
    if !cx.hand.models.contains_key("grenade") {
        return;
    }
    cx.weapons.busy = 0.9;
    cx.sound.play("pin", Play::default().gain(0.7));
    cx.weapons.later.push((0.22, Later::Lob(speed)));
}

fn let_fly(cx: &mut Cx, speed: f32) {
    let eye = cx.eye();
    let (ahead, up) = (eye.forward().as_vec3(), eye.up().as_vec3());
    if !cx.hand.models.contains_key("grenade") {
        return;
    }
    // (From where it was in the hand as it let go, `lobbing`'s; not through a wall the hand was drawn over.)
    let align = cx.weapon_models.held("grenade");
    let at = cx.before_wall(cx.hand.world(&eye).transform_point(align.translation));
    let scene = cx.gltfs.get(&cx.weapon_models.gltf["grenade"]).and_then(|g| g.default_scene.clone().or_else(|| g.scenes.first().cloned()));
    let spin = Vec3::new(cx.rng.next() * 10.0 - 5.0, cx.rng.next() * 10.0 - 5.0, cx.rng.next() * 10.0 - 5.0);
    let v = ahead * speed + up * if speed > 10.0 { 2.5 } else { 0.0 };
    // The physics on a sphere the size of the body (64 mm across, 400 g) that carries the model with it.
    let ball = cx
        .commands
        .spawn((
            Transform::from_translation(at).with_rotation(cx.hand.world(&eye).rotation),
            Visibility::default(),
            RigidBody::Dynamic,
            Collider::ball(0.032),
            ColliderMassProperties::Mass(0.4),
            Friction::coefficient(0.7),
            Restitution::coefficient(0.3),
            Damping { linear_damping: 0.0, angular_damping: 0.6 },
            Velocity { linear: v, angular: spin },
            Grenade { last: -1.0, was: v },
            Name::new("grenade"),
        ))
        .id();
    if let Some(scene) = scene {
        cx.commands.spawn((WorldAssetRoot(scene), Transform::from_rotation(align.rotation), ChildOf(ball)));
    }
    let fuse = 4.0 + cx.rng.next() * 1.5;
    cx.weapons.grenades.push((ball, fuse));
}

// 180 g of Composition B in a steel body that breaks into a few hundred fragments: killing within 5 m, wounding to 15. The
// blast throws and knocks down whoever is close; the fragments go out every way as missiles of their own.
fn explode(cx: &mut Cx, ball: Entity) {
    let Ok((t, _)) = cx.bodies.get(ball) else { return };
    let at = t.translation;
    let started = std::time::Instant::now();
    cx.note("grenade went off".into());
    let near: Vec<(String, f32)> = cx.people.iter().map(|(e, p)| (p.label.clone(), cx.centre(e, p).distance(at))).collect();
    cx.weapons.log.push(json!({ "grenade": at.to_array(), "people": near }));
    cx.commands.entity(ball).despawn();
    cx.sound.play("explosion", Play::at(at));
    let now = cx.time.elapsed_secs();
    let turn = cx.rng.next() * std::f32::consts::PI;
    cx.muzzle.burst(at, now, turn);
    // The blast: an impulse on every part of everyone near, falling off with the square of the distance; limbs near enough
    // torn off and a belly burst (180 g of Composition B is about 0.25 kg of TNT).
    // (dismember.rs's blast: limbs torn off, a belly burst; once this frame's work is done, with the whole world.)
    let people: Vec<(Entity, f32)> = cx.people.iter().map(|(e, p)| (e, at.distance(cx.centre(e, p)).max(0.4))).collect();
    // (Nothing moves anyone's body until this system is done: their bones are worked out once for the blows and the
    // fragments' two hundred lines, and let go at the end.)
    for &(who, _) in &people {
        cx.npc(who, |n| n.hold());
    }
    for &(who, d) in &people {
        cx.commands.queue(move |w: &mut World| {
            crate::dismember::blast(w, who, at, 0.25);
        });
        if d > 8.0 {
            continue;
        }
        let total = (35.0 / (d * d)).min(60.0); // N s on the whole body
        if let Ok(mut rd) = cx.ragdolls.get_mut(who) {
            for k in rd.attached.clone() {
                let p = rd.segs[k].now.translation;
                let dir = ((p - at).normalize() + Vec3::new(0.0, 0.35, 0.0)).normalize();
                let share = rd.segs[k].def.mass / rd.mass;
                rd.push(k, dir * total * share, p);
            }
        }
        if d < 3.5 {
            if let Ok(mut b) = cx.behaviours.get_mut(who) {
                b.knock_down(&mut cx.rng);
            }
            let Ok(rd) = cx.ragdolls.get(who) else { continue };
            let point = rd.segs[rd.nearest(at).0].now.translation;
            blow(cx, who, point, (point - at).normalize(), 2.0, (12.0 / d).min(18.0), Some(Tool::Flat));
        }
    }
    // The fragments, about a thousand, each spending its energy against air first (half its speed in 15 m). Followed one
    // by one only where they meet somebody: each part of each person takes as many as the share of the sphere it covers
    // seen from the burst. A few hundred more go out every way, for the marks they leave on the room.
    let frag = Missile { name: "fragment", energy: 330.0, mass: 0.0003, speed: 1500.0, calibre: 0.004, channel: 0.004, soft: 18.0, hard: 110.0, ..M };
    let mut aims = Vec::new();
    for (e, p) in &cx.people {
        for (k, s) in p.segments.iter().enumerate() {
            let (a, b) = cx.ends(e, p, k);
            let d = at.distance((a + b) / 2.0);
            if d > 25.0 {
                continue;
            }
            let area = 2.0 * s.radius * (a.distance(b) + 2.0 * s.radius);
            aims.push((a, b, s.radius, FRAGMENTS * area / (4.0 * std::f32::consts::PI * d * d), (d - 0.3).max(0.0)));
        }
    }
    // (Every fragment's way drawn first, the dice in the order they always were, a shot throwing none; then where each
    // first goes worked out for all of them at once, and each followed in turn as before.)
    let mut ways = Vec::new();
    for (a, b, r, expected, far) in aims {
        let mut n = (expected + cx.rng.next()).floor() as i32;
        while n > 0 {
            n -= 1;
            let (u, x, y, z) = (cx.rng.next(), cx.rng.next(), cx.rng.next(), cx.rng.next());
            let aim = a.lerp(b, u) + (Vec3::new(x, y, z) - 0.5) * r * 1.6;
            ways.push(((aim - at).normalize(), Missile { energy: frag.energy * (-far / 10.8).exp(), ..frag }));
        }
    }
    let fragments = ways.len();
    let firsts = legs(cx, at, &ways);
    for ((dir, m), first) in ways.into_iter().zip(firsts) {
        shot_from(cx, at, dir, m, 0.0, Some(first));
    }
    for _ in 0..160 {
        let y = cx.rng.next() * 1.6 - 0.6;
        let r = (1.0 - y * y).sqrt();
        let a = cx.rng.next() * std::f32::consts::TAU;
        let dir = Vec3::new(a.cos() * r, y, a.sin() * r);
        if cx.person(at, dir, 25.0).is_none() {
            shot(cx, at, dir, frag, 0.0);
        }
    }
    for &(who, _) in &people {
        cx.npc(who, |n| n.let_go());
    }
    // (Timed for the log: the grenade's frame was some 80 ms, most of it the fragments.)
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    cx.weapons.log.push(json!({ "grenade_ms": (ms * 100.0).round() / 100.0, "fragments": fragments }));
    // The player feels it.
    let eye = cx.eye();
    let d = at.distance(eye.translation);
    if d < 14.0 {
        let (k1, k2) = (cx.rng.next(), cx.rng.next());
        if let Ok((mut p, _)) = cx.player.single_mut() {
            p.pitch += (k1 * 0.08 + 0.04) * (3.0 / d).min(1.0);
            p.yaw += (k2 - 0.5) * 0.08 * (3.0 / d).min(1.0);
        }
    }
}

// The first leg of each of many shots from one point (a grenade's fragments, two hundred of them into the people round
// it): the wall and the person each meets first, as shot_from would find them, and what each line meets in that person,
// worked out on the compute threads. A hundred and more lines through the same few bodies: what each meets is a few
// thousand triangle tests, and none of it changes anything, so it can be asked of all of them at once before any of
// them does what it does to the body (which is in turn, with the dice, as before). Only while everyone is held
// (Npc::hold): the lines are traced through their held bones.
fn legs(cx: &mut Cx, from: Vec3, ways: &[(Vec3, Missile)]) -> Vec<Leg> {
    let mut legs: Vec<Leg> = ways
        .iter()
        .map(|&(dir, m)| {
            if m.energy <= 15.0 {
                return Leg { wall: None, person: None, lines: None };
            }
            let wall = cx.wall(from, dir);
            let person = cx.person(from, dir, wall.as_ref().map_or(200.0, |w| w.distance));
            Leg { wall, person, lines: None }
        })
        .collect();
    // Each person met: skinned now (as their first surface this frame would have), and how a line sees them.
    let mut met: Vec<Entity> = legs.iter().filter_map(|l| l.person.map(|p| p.0)).collect();
    met.sort();
    met.dedup();
    let seen: Vec<_> = met.into_iter().filter_map(|who| cx.npc(who, |n| n.held().map(|h| (who, n.skinned(), h))).flatten()).collect();
    let views: Vec<_> = seen
        .iter()
        .filter_map(|(who, sk, held)| {
            let (_, person) = cx.people.get(*who).ok()?;
            let (_, _, hurt) = cx.hurts.get(*who).ok()?;
            Some((*who, Look { body: &person.body, weights: hurt.weights.as_deref() }, sk.clone(), hurt.traced.clone(), held.clone()))
        })
        .collect();
    let jobs: Vec<(usize, usize, Vec3, f32, wounds::Missile)> = legs
        .iter()
        .enumerate()
        .filter_map(|(k, l)| {
            let (who, t) = l.person?;
            let v = views.iter().position(|v| v.0 == who)?;
            // (How far into them shot_from has pierce look.)
            let far = l.wall.as_ref().map_or(200.0, |w| w.distance);
            Some((k, v, ways[k].0, (3.0f32).min(far - t + 2.0) + t, ways[k].1.wounds()))
        })
        .collect();
    let done = npc::spread(jobs.len(), |j| {
        let (_, v, dir, far, m) = &jobs[j];
        let (_, look, sk, traced, held) = &views[*v];
        wounds::lines(look, sk, traced, held, from, *dir, m, *far)
    });
    for (j, lines) in done {
        legs[jobs[j].0].lines = Some(lines);
    }
    legs
}

// --- every frame ------------------------------------------------------------------------------------------------------

// The mouse and keys, as the TS's pointer and key events: only while the pointer is taken (the game is being played).
fn input(
    mouse: Res<ButtonInput<MouseButton>>,
    keys: Res<ButtonInput<KeyCode>>,
    scroll: Res<AccumulatedMouseScroll>,
    cursor: Query<&bevy::window::CursorOptions, With<bevy::window::PrimaryWindow>>,
    mut weapons: ResMut<Weapons>,
) {
    if cursor.single().map_or(true, |c| c.grab_mode == bevy::window::CursorGrabMode::None) {
        return;
    }
    let q = &mut weapons.queue;
    for (b, k) in [(MouseButton::Left, 0), (MouseButton::Right, 2)] {
        if mouse.just_pressed(b) {
            q.push(Act::Press(k));
        }
        if mouse.just_released(b) {
            q.push(Act::Release(k));
        }
    }
    for (i, k) in [KeyCode::Digit1, KeyCode::Digit2, KeyCode::Digit3, KeyCode::Digit4, KeyCode::Digit5, KeyCode::Digit6].into_iter().enumerate() {
        if keys.just_pressed(k) {
            q.push(Act::Select(i));
        }
    }
    if keys.just_pressed(KeyCode::KeyR) {
        q.push(Act::Reload);
    }
    if keys.just_pressed(KeyCode::KeyE) {
        q.push(Act::Take);
    }
    if keys.just_pressed(KeyCode::KeyG) {
        q.push(Act::PutBack);
    }
    if scroll.delta.y != 0.0 {
        let n = weapons.slots.len();
        let i = (weapons.slot + if scroll.delta.y < 0.0 { 1 } else { n - 1 }) % n;
        weapons.queue.push(Act::Select(i));
    }
}

fn press(cx: &mut Cx, button: u8) {
    let a = cx.weapons.arm();
    if cx.weapons.busy > 0.0 || cx.weapons.reloading > 0.0 {
        return;
    }
    if a.kind != Kind::Gun {
        cx.note(format!("{}, {} button", a.key, if button == 0 { "left" } else { "right" }));
    }
    match (a.kind, button) {
        (Kind::Gun, 0) => fire(cx, a.key),
        (Kind::Blade, _) => swing(cx, if button == 0 { How::Stab } else { How::Cut }),
        (Kind::Blunt, 0) => swing(cx, How::Blow),
        (Kind::Blunt, 2) if a.down.is_some() => swing(cx, How::Down),
        (Kind::Grab, 0) => take_hold(cx),
        (Kind::Fists, 0 | 2) => cx.fists.wind_up(if button == 0 { 'L' } else { 'R' }),
        (Kind::Throw, 0) => throw(cx),
        (Kind::Throw, _) => cx.weapons.throw_kind = (cx.weapons.throw_kind + 1) % THROWN.len(),
        (Kind::Grenade, _) => lob(cx, if button == 0 { 14.0 } else { 6.0 }),
        _ => {}
    }
}

fn select(cx: &mut Cx, i: usize) {
    cx.weapons.select(i);
    let fists = cx.weapons.arm().kind == Kind::Fists;
    cx.fists.raise(fists);
}

pub fn act(mut cx: Cx) {
    let dt = cx.time.delta_secs();
    cx.weapons.busy = (cx.weapons.busy - dt).max(0.0);
    for a in std::mem::take(&mut cx.weapons.queue) {
        match a {
            Act::Press(b) => {
                if b == 0 {
                    cx.weapons.firing = true;
                }
                press(&mut cx, b);
            }
            Act::Release(b) => {
                if b == 0 {
                    cx.weapons.firing = false;
                    cx.weapons.grab = None;
                    if let Some(h) = cx.weapons.bowel.take() {
                        if let Ok((_, mut v)) = cx.viscera.get_mut(h.who) {
                            crate::viscera::pull(&mut v, h, None);
                        }
                    }
                }
                // A punch let go: the fist thrown, harder the longer it was wound up (fist.rs). It lands on whatever its
                // knuckles meet on their way, not on what is in front of the eye.
                if cx.weapons.arm().kind == Kind::Fists && (b == 0 || b == 2) {
                    let side = if b == 0 { 'L' } else { 'R' };
                    if let Some(charge) = cx.fists.let_go(side) {
                        cx.note(format!("punch, {}, wound up {charge:.2}", if side == 'L' { "left" } else { "right" }));
                        cx.sound.play("swing", Play { gain: 0.25 + 0.2 * charge, rate: 1.5 - 0.2 * charge, ..default() });
                    }
                }
            }
            Act::Select(i) => select(&mut cx, i),
            Act::Reload => reload(&mut cx),
            Act::Take => {
                let eye = cx.eye();
                if let Some(key) = cx.arsenal.as_ref().and_then(|a| a.look(eye.translation, eye.forward().as_vec3())) {
                    let Cx { weapons, sound, .. } = &mut cx;
                    weapons.take(key, sound);
                    let fists = cx.weapons.arm().kind == Kind::Fists;
                    cx.fists.raise(fists);
                }
            }
            Act::PutBack => {
                cx.weapons.put_back();
                cx.fists.raise(false);
            }
        }
    }
    let a = cx.weapons.arm();
    if cx.weapons.reloading > 0.0 {
        // Each stroke of the reload heard as the hands do it (`reloads`), then the gun is full.
        let gun = a.gun.as_ref().unwrap();
        let was = 1.0 - cx.weapons.reloading / gun.reload;
        cx.weapons.reloading -= dt;
        let now = 1.0 - cx.weapons.reloading / gun.reload;
        for (u, name) in reloads(a.key) {
            if u > was && u <= now {
                cx.sound.play(name, Play::default().gain(if name == "round-in" { 0.6 } else { 0.85 }));
            }
        }
        if cx.weapons.reloading <= 0.0 {
            cx.weapons.reloading = 0.0;
            cx.weapons.ammo.insert(a.key, gun.rounds);
        }
    }
    if cx.weapons.firing && a.key == "pistol" && cx.weapons.busy <= 0.0 {
        cx.weapons.firing = false;
    }
    // Held down, an automatic keeps firing until it is empty.
    if cx.weapons.firing && a.gun.as_ref().is_some_and(|g| g.auto) && cx.weapons.busy <= 0.0 && cx.weapons.reloading <= 0.0 {
        if cx.weapons.ammo[a.key] > 0 {
            fire(&mut cx, a.key);
        } else {
            cx.weapons.firing = false;
            reload(&mut cx);
        }
    }
    // What was put off till now.
    let mut due = Vec::new();
    cx.weapons.later.retain_mut(|(t, l)| {
        *t -= dt;
        if *t <= 0.0 {
            due.push(std::mem::replace(l, Later::Sound("", 0.0)));
            false
        } else {
            true
        }
    });
    for l in due {
        match l {
            Later::Sound(name, gain) => {
                cx.sound.play(name, Play::default().gain(gain));
            }
            Later::Casing(e) => {
                if let Ok((t, _)) = cx.bodies.get(e) {
                    let at = t.translation;
                    cx.sound.play("casing", Play::at(at).gain(0.5));
                }
            }
            Later::Lob(speed) => let_fly(&mut cx, speed),
        }
    }
    // The grenades' fuses.
    let mut gone = Vec::new();
    for (ball, fuse) in cx.weapons.grenades.iter_mut() {
        *fuse -= dt;
        if *fuse <= 0.0 {
            gone.push(*ball);
        }
    }
    cx.weapons.grenades.retain(|g| g.1 > 0.0);
    for ball in gone {
        explode(&mut cx, ball);
    }
    if cx.weapons.action.is_some() {
        sweep(&mut cx, dt);
        let act = cx.weapons.action.as_ref().unwrap();
        if act.t >= act.length {
            // The cuts drawn along every place each crossed the skin (npc.slash: marks.rs); the wound under each crossing
            // is pierce's, already made.
            let act = cx.weapons.action.take().unwrap();
            let sweep = cx.eye().left().as_vec3();
            let ahead = cx.eye().forward().as_vec3();
            for (who, hits) in act.hits {
                let label = cx.label(who);
                let depth = if a.cut > 0.0 { a.cut } else { a.down.as_ref().and_then(|d| d.cut).unwrap_or(0.02) };
                // A heavy edge may have gone right through a limb (dismember.rs), or through the wall of the belly or chest
                // (viscera.rs): taken once this frame's work is done, with the whole world.
                let points = hits.clone();
                cx.commands.queue(move |w: &mut World| {
                    crate::dismember::swung(w, who);
                    let skin: Vec<crate::npc::Crossing> = points
                        .iter()
                        .filter_map(|&p| crate::npc::with(w, who, |n| n.surface(p - ahead * 0.1, ahead, 0.2, false).into_iter().find(|h| h.kind == crate::npc::Kind::Skin)).flatten())
                        .collect();
                    crate::viscera::slashed(w, who, &skin, depth);
                    // Then the cut along the skin, as npc.ts slash did after swung and slashed.
                    crate::npc::with(w, who, |npc| npc.slash_through(&points, depth, sweep));
                });
                cx.weapons.log.push(json!({ "slash": label, "points": hits.iter().map(|p| p.to_array()).collect::<Vec<_>>(), "depth": depth, "sweep": sweep.to_array() }));
            }
        }
    }
    // Where what is held is drawn to: in front of the eye, as far off as it was taken hold of. The pull is `pull`'s.
    let eye = cx.eye();
    if let Some(g) = cx.weapons.grab.as_mut() {
        g.target = Some(eye.translation + eye.forward().as_vec3() * g.distance.min(2.2));
    }
    // Bowel held: drawn toward the hand as a body is (weapons.ts `viscera.pull`).
    if let Some(h) = cx.weapons.bowel {
        if let Ok((_, mut v)) = cx.viscera.get_mut(h.who) {
            crate::viscera::pull(&mut v, h, Some(eye.translation + eye.forward().as_vec3() * h.distance.min(2.2)));
        }
    }
    // The blood on the blade in hand, drying.
    if let Some(b) = cx.weapons.blades.get_mut(a.key) {
        b.2 += dt;
    }
    // A person held: drawn to in front of the eye; let go with the button, or when something else is taken up.
    if let Some(who) = cx.weapons.holding {
        if !cx.weapons.firing || cx.weapons.arm().kind != Kind::Grab {
            cx.weapons.holding = None;
            cx.commands.entity(who).try_remove::<Grabbed>();
        } else if let Ok(mut g) = cx.grabbed.get_mut(who) {
            g.aim(eye.translation, eye.forward().as_vec3());
        }
    }
    // A segment slammed into something standing takes it as a blow, broad and flat over the whole part (thuds.rs).
    let slams: Vec<crate::thuds::Slam> = cx.slams.read().cloned().collect();
    for sl in slams {
        cx.npc(sl.person, |n| wounds::blow(n, sl.point, sl.normal, sl.mass, sl.toward, Some(wounds::Tool::Named("wall"))));
    }
    landings(&mut cx);
    medic(&mut cx, dt);
}

// A thing thrown, or the grenade, landing on someone: a blow, at the speed it is going, with its mass and how stiff it is
// (weapons.ts's collision observers: a thrown thing over 3 m/s, a quarter of a second apart; the grenade over 5 m/s).
fn landings(cx: &mut Cx) {
    let now = cx.time.elapsed_secs();
    let mut segments: HashMap<Entity, (Entity, usize)> = HashMap::new();
    for (e, _) in &cx.people {
        if let Ok(rd) = cx.ragdolls.get(e) {
            for (k, s) in rd.segs.iter().enumerate() {
                segments.insert(s.entity, (e, k));
            }
        }
    }
    let things: Vec<(Entity, f32, Option<f32>, f32, f32)> = cx
        .weapons
        .thrown
        .iter()
        .map(|&(e, mass, stiff)| (e, mass, stiff, 3.0, 0.25))
        .chain(cx.weapons.grenades.iter().map(|&(e, _)| (e, 0.4, None, 5.0, 0.12)))
        .collect();
    let mut blows = Vec::new();
    {
        let Ok(ctx) = cx.rapier.single() else { return };
        for (e, mass, stiff, fastest, apart) in things {
            let Ok((t, Some(v))) = cx.bodies.get(e) else { continue };
            let speed = v.linear.length();
            if speed < fastest || now - cx.weapons.struck.get(&e).copied().unwrap_or(-1.0) < apart {
                continue;
            }
            for pair in ctx.contact_pairs_with(e) {
                if !pair.has_any_active_contact() {
                    continue;
                }
                let other = if pair.collider1() == Some(e) { pair.collider2() } else { pair.collider1() };
                let Some(&(who, k)) = other.and_then(|o| segments.get(&o)) else { continue };
                blows.push((e, who, k, t.translation, v.linear, mass, stiff));
                break;
            }
        }
    }
    for (e, who, k, at, v, mass, stiff) in blows {
        cx.weapons.struck.insert(e, now);
        let point = cx.ragdolls.get(who).map_or(at, |rd| rd.middle(k));
        let speed = v.length();
        blow(cx, who, point, v / speed, mass, speed, stiff.map(Tool::Stiff));
        cx.sound.play("blunt", Play::at(point).gain((speed / 10.0).min(1.0)));
    }
}

fn medic(cx: &mut Cx, dt: f32) {
    let working = cx.weapons.medic.job.is_some_and(|j| j.2 > 1.0);
    if let Some(w) = &cx.weapons.medic.wrap {
        w.drive(if working { 0.45 } else { 0.0 }, 1.0);
    }
    let a = cx.weapons.arm();
    if a.kind != Kind::Dress {
        cx.weapons.medic.job = None;
        cx.weapons.medic.prompt.clear();
        return;
    }
    let eye = cx.eye();
    let (at, ahead) = (eye.translation, eye.forward().as_vec3());
    let medkit = a.key == "medkit";
    // The worst open wound of whoever is in front of the eye (medkit), or the open wound nearest the middle of the view,
    // within reach and facing the eye (bandage).
    let found: Option<(Wound, usize)> = if medkit {
        cx.person(at, ahead, REACH).and_then(|(who, _)| {
            let list = cx.npc(who, |n| dressing::wounds(n)).unwrap_or_default();
            list.first().cloned().map(|w| (Wound { person: who, open: w }, list.len()))
        })
    } else {
        let mut best: Option<(Wound, f32)> = None;
        let near: Vec<Entity> = cx
            .people
            .iter()
            .filter(|(e, p)| at.distance(cx.centre(*e, p)) <= REACH + 1.2)
            .map(|(e, _)| e)
            .collect();
        for who in near {
            for w in cx.npc(who, |n| dressing::wounds(n)).unwrap_or_default() {
                let to = w.at - at;
                let t = to.dot(ahead);
                if t < 0.1 || t > REACH || w.normal.dot(ahead) > 0.3 {
                    continue;
                }
                let off = (to - ahead * t).length() / t;
                if off < 0.09 && best.as_ref().is_none_or(|b| off < b.1) {
                    best = Some((Wound { person: who, open: w }, off));
                }
            }
        }
        best.map(|(w, _)| (w, 1))
    };
    let Some((wound, n)) = found else {
        cx.weapons.medic.job = None;
        cx.weapons.medic.prompt.clear();
        return;
    };
    cx.weapons.medic.prompt = format!("Hold left click: {}", if medkit && n > 1 { format!("Dress all {n} wounds") } else if medkit { "Dress the wound".into() } else { "Dress the wound".into() });
    if !cx.weapons.firing {
        cx.weapons.medic.job = None;
        return;
    }
    // The same wound as last frame is the one its first bleed is still in.
    if cx.weapons.medic.job.is_none_or(|j| (j.0, j.1) != (wound.person, wound.open.bleeds.first().copied().unwrap_or(0))) {
        cx.weapons.medic.job = Some((wound.person, wound.open.bleeds.first().copied().unwrap_or(0), 0.0));
        if medkit && cx.weapons.medic.opened != Some(wound.person) {
            cx.weapons.medic.opened = Some(wound.person);
            cx.sound.play("zip", Play::default().gain(0.7));
        }
    }
    cx.weapons.medic.clock += dt;
    // The packet torn open in the hands, then the gauze wound on (wrap, above), then taped.
    let t = cx.weapons.medic.job.unwrap().2;
    if t < 0.3 && t + dt >= 0.3 {
        cx.sound.play("gauze-tear", Play::default().gain(0.6));
    }
    let t = t + dt;
    cx.weapons.medic.job.as_mut().unwrap().2 = t;
    if cx.weapons.medic.wrap.is_none() {
        cx.weapons.medic.wrap = cx.sound.stream("gauze-wrap", Some(wound.open.at));
    }
    if let Some(w) = &cx.weapons.medic.wrap {
        w.at(wound.open.at);
    }
    cx.weapons.medic.prompt = format!("Dressing{} {}%", if n > 1 { format!(" ({n} left)") } else { String::new() }, (100.0 * (t / SECONDS).min(1.0)).round());
    if t < SECONDS {
        return;
    }
    let open = wound.open.clone();
    let done = cx.npc(wound.person, |n| dressing::dress(n, &open)).flatten();
    let label = cx.label(wound.person);
    cx.weapons.log.push(json!({ "dress": label, "at": open.at.to_array(), "dressing": done }));
    cx.sound.play("tape", Play::at(open.at).gain(0.7));
    cx.weapons.medic.job = None;
}

// Where on the screen (0 to 1 across and down) the gun in the hand's bore meets whatever is first along it, a wall or
// someone, for the crosshair (hud.rs) to be drawn on: the dot shows where a shot will go, not the middle of the view (the
// two part as the gun sways, kicks and lags a turn; at rest they meet AIMED metres ahead). None for no gun.
fn sight(mut cx: Cx, camera: Query<(&Camera, &GlobalTransform), With<Player>>) {
    let key = cx.weapons.arm().key;
    if cx.weapons.arm().gun.is_none() || !cx.hand.anchors.contains_key(key) {
        cx.weapons.sight = None;
        return;
    }
    let (from, ahead) = cx.bore(key);
    let mut far = cx.wall(from, ahead).map_or(60.0, |w| w.distance);
    for (e, p) in &cx.people {
        for (k, s) in p.segments.iter().enumerate() {
            let (a, b) = cx.ends(e, p, k);
            let (t, d) = ray_to_segment(from, ahead, a, b);
            if t > 0.0 && t < far && d < s.radius {
                far = t;
            }
        }
    }
    let Ok((camera, eye)) = camera.single() else { return };
    // (The eye as it is this frame: its GlobalTransform is last frame's.)
    let eye = cx.player.single().map_or(*eye, |(_, t)| GlobalTransform::from(*t));
    cx.weapons.sight = camera.world_to_ndc(&eye, from + ahead * far).filter(|p| p.z > 0.0 && p.z < 1.0).map(|p| Vec2::new((p.x + 1.0) / 2.0, (1.0 - p.y) / 2.0));
}

// A stiff spring on the point that was taken hold of, damped, as strong as two arms: given every physics step, from where
// the point is by then. (Given once a frame for the whole frame, it all came in the first of the frame's steps and none in
// the next: someone dragged by the hand had the arm yanked out and let spring back every step.)
// (A person taken hold of is not held here: behaviour.rs `Grabbed` gives weapons.ts's same spring to the segment held,
// every step.)
fn pull(weapons: Res<Weapons>, time: Res<Time>, bodies: Query<(&Transform, &Velocity)>, mut commands: Commands) {
    let Some(g) = &weapons.grab else { return };
    let Some(target) = g.target else { return };
    let Ok((t, v)) = bodies.get(g.body) else { return };
    let at = t.transform_point(g.local);
    let m = g.mass.min(12.0);
    let mut force = (target - at) * 320.0 * m - v.linear * 28.0 * m;
    let most = 900.0;
    if force.length() > most {
        force *= most / force.length();
    }
    let dt = time.delta_secs();
    commands.entity(g.body).insert(ExternalImpulse::at_point(force * dt, at, t.translation));
}

// The grenade heard where it bounces. (A bounce is a sudden change in its velocity: the contact events Rapier would give
// need every collider to ask for them.)
fn flying(mut sound: ResMut<Sound>, time: Res<Time>, mut grenades: Query<(&Transform, &Velocity, &mut Grenade)>) {
    let now = time.elapsed_secs();
    for (t, v, mut g) in &mut grenades {
        let speed = g.was.length();
        if (v.linear - g.was).length() > 1.2 && speed > 1.2 && now - g.last > 0.12 {
            g.last = now;
            sound.play("bounce-metal", Play::at(t.translation).gain((speed / 8.0).min(1.0)));
        }
        g.was = v.linear;
    }
}

// --- the hand's pose ----------------------------------------------------------------------------------------------------

// A position or a way of the TS's eye or hand frame (z ahead) in Bevy's (z behind), and back: the same mirror.
pub fn e(v: Vec3) -> Vec3 {
    Vec3::new(v.x, v.y, -v.z)
}

// The TS's Quaternion.FromEulerAngles(x, y, z) (yaw y, then pitch x, then roll z), in the TS's space.
fn euler(v: Vec3) -> Quat {
    Quat::from_euler(EulerRot::YXZ, v.y, v.x, v.z)
}

// A turn of the TS's space, brought over.
pub fn ts_turn(q: Quat) -> Quat {
    babylon_quat(q.to_array())
}

fn lerp(a: f32, b: f32, u: f32) -> f32 {
    a + (b - a) * u
}

fn smooth(u: f32) -> f32 {
    if u <= 0.0 { 0.0 } else if u >= 1.0 { 1.0 } else { u * u * (3.0 - 2.0 * u) }
}

// 0 before `a`, 1 after `b`, smoothly between.
fn span(u: f32, a: f32, b: f32) -> f32 {
    smooth((u - a) / (b - a))
}

// A hand `s` of the way from grip `a` to grip `b` (closed as `a` until half way, then as `b`).
fn blend(a: Option<Grip>, b: Option<Grip>, s: f32) -> Option<Grip> {
    let (Some(x), Some(y)) = (a, b) else { return if s < 0.5 || b.is_none() { a } else { b } };
    if s <= 0.0 {
        return a;
    }
    if s >= 1.0 {
        return b;
    }
    let mix = |p: [f32; 3], q: [f32; 3]| [lerp(p[0], q[0], s), lerp(p[1], q[1], s), lerp(p[2], q[2], s)];
    Some(Grip { hold: if s < 0.5 { x.hold } else { y.hold }, at: mix(x.at, y.at), along: mix(x.along, y.along), back: mix(x.back, y.back), shoulder: x.shoulder })
}

// Where the hands go this frame (hands.rs puts them there), in the hand's frame of the TS: each grip as weapons.ts gives
// it; and the hand in the world.
#[derive(Resource, Default)]
pub struct Holds {
    pub right: Option<Grip>,
    pub left: Option<Grip>,
    pub frame: Transform,
}

// A part of the thing in the hand moved this frame (`move_part`): by so much and turned about a line, both in the TS's
// hand frame; or hidden.
struct Moved {
    part: &'static str,
    by: Option<Vec3>,
    turn: Option<(Vec3, Vec3, f32)>,
    shown: bool,
}

fn mv(part: &'static str, by: Option<Vec3>, turn: Option<(Vec3, Vec3, f32)>, shown: bool) -> Moved {
    Moved { part, by, turn, shown }
}

// A part's bounds in the TS's hand frame.
fn bounds_ts(p: &Part) -> (Vec3, Vec3) {
    (Vec3::new(p.min.x, p.min.y, -p.max.z), Vec3::new(p.max.x, p.max.y, -p.min.z))
}

// The thing in the hands and the hands on it, every frame. At rest as HELD has it, breathing and swaying a little,
// carried along by the walk and lagging behind a turn of the head; kicked back from its grip by a shot; carried through a
// stab or a cut; worked through a reload by the hands that really do it. The arms follow the hands (hands.rs), so
// whatever moves the thing moves them.
pub fn animate(
    time: Res<Time>,
    mut weapons: ResMut<Weapons>,
    mut hand: ResMut<Hand>,
    mut holds: ResMut<Holds>,
    players: Query<(&Player, &Transform)>,
    mut transforms: Query<&mut Transform, Without<Player>>,
    mut shown: Query<&mut Visibility>,
    rapier: ReadRapierContext,
    mut ragdolls: Query<(Entity, &mut Ragdoll)>,
    mut segments: Local<HashMap<Entity, (Entity, usize)>>,
    mut sound: ResMut<Sound>,
) {
    let dt = time.delta_secs();
    let a = weapons.arm();
    let key = a.key;
    for (&k, &e) in &hand.models {
        if let Ok(mut v) = shown.get_mut(e) {
            let want = if k == key { Visibility::Inherited } else { Visibility::Hidden };
            if *v != want {
                *v = want;
            }
        }
    }
    let Ok((player, eye)) = players.single() else { return };
    let Some(h) = held(key) else {
        holds.right = None;
        holds.left = None;
        return;
    };
    hand.clock += dt;
    weapons.since = if weapons.recoil == 1.0 { 0.0 } else { weapons.since + dt };
    weapons.recoil *= (-dt * 14.0).exp();
    // Where it is and how it is turned before anything else moves it: at rest, or along a swing.
    let mut pos = Vec3::from(h.at);
    let mut base = h.turn.map(Vec3::from);
    let mut turn = Vec3::ZERO;
    let mut right = h.right;
    let mut left = h.left;
    let mut swung = 0.0;
    if let (Some(act), Some(keys)) = (&weapons.action, weapons.action.as_ref().and_then(|x| swings(key, x.how))) {
        let p = match act.stopped {
            Some((at, when)) => at * (1.0 - ((act.t / act.length - when) / (1.0 - when).max(1e-3)).clamp(0.0, 1.0)),
            None => (act.t / act.length).min(1.0),
        };
        swung = p;
        let t = h.turn.unwrap_or([0.0; 3]);
        let from = [0.0, h.at[0], h.at[1], h.at[2], t[0], t[1], t[2]];
        let mut to = from;
        to[0] = 1.0;
        let all: Vec<[f32; 7]> = std::iter::once(from).chain(keys.iter().copied()).chain(std::iter::once(to)).collect();
        let mut k = 1;
        while k < all.len() - 1 && all[k][0] <= p {
            k += 1;
        }
        let (x, y) = (all[k - 1], all[k]);
        let u = smooth((p - x[0]) / (y[0] - x[0]));
        pos = Vec3::new(lerp(x[1], y[1], u), lerp(x[2], y[2], u), lerp(x[3], y[3], u));
        base = Some(Vec3::new(lerp(x[4], y[4], u), lerp(x[5], y[5], u), lerp(x[6], y[6], u)));
    }

    // Breath, a little sway, the walk (a figure of eight over each pair of steps), and the look: the hands lag a turn of
    // the head and catch up (its rate eased over a tenth of a second). (The TS's yaw and pitch went the other way.)
    let going = (player.speed() / 1.55).min(1.0) * if player.running { 1.6 } else { 1.0 };
    let step = player.bob_phase;
    let breath = player.breathing.sin();
    let clock = hand.clock;
    pos.x += step.sin() * 0.008 * going + (clock * 0.8).sin() * 0.0012;
    pos.y += ((2.0 * step).cos() - 1.0) * 0.004 * going + breath * 0.0025;
    turn.x += breath * 0.006 + (clock * 0.55).sin() * 0.002;
    turn.y += (clock * 0.7).sin() * 0.003 + step.sin() * 0.012 * going;
    turn.z += step.sin() * 0.02 * going;
    let (yaw, pitch) = (-player.yaw, -player.pitch);
    let lag = &mut hand.lag;
    if dt > 0.0 {
        let ease = (dt * 10.0).min(1.0);
        lag[2] += ((yaw - lag[0]) / dt - lag[2]) * ease;
        lag[3] += ((pitch - lag[1]) / dt - lag[3]) * ease;
    }
    lag[0] = yaw;
    lag[1] = pitch;
    let most = |v: f32, m: f32| v.clamp(-m, m);
    turn.y -= most(lag[2] * 0.03, 0.08);
    turn.x -= most(lag[3] * 0.03, 0.08);
    pos.x -= most(lag[2] * 0.008, 0.02);
    pos.y += most(lag[3] * 0.008, 0.02);

    // A shot: the gun driven back into the hands and turned up about its grip, the pistol's slide run back.
    let [back, rise] = h.kick;
    let recoil = weapons.recoil;
    pos.z -= recoil * back;
    pos.y += recoil * back * 0.3;
    turn.x -= recoil * rise;
    let mut moves = Vec::new();
    let parts = hand.parts.get(key);
    if slide(key) > 0.0 {
        moves.push(mv("slide", Some(Vec3::new(0.0, 0.0, -slide(key) * (recoil * 2.0 - 1.0).max(0.0))), None, true));
    }
    let tip_ts = hand.anchors.get(key).map(|x| e(x.tip));
    let mut model_shown = true;
    if let (Some(gun), true) = (&a.gun, weapons.reloading > 0.0) {
        let u = 1.0 - weapons.reloading / gun.reload;
        reloading(key, u, gun.reload, &h, tip_ts, &mut pos, &mut turn, &mut right, &mut left, parts, &mut moves);
    } else if key == "rifle" && weapons.since < 0.9 {
        bolt(weapons.since / 0.9, &h, tip_ts, &mut pos, &mut turn, &mut right, &mut left, parts, &mut moves, false);
    }
    if key == "grenade" {
        let t = if weapons.busy > 0.0 { 0.9 - weapons.busy } else { -1.0 };
        model_shown = lobbing(t, &h, &mut pos, base.as_mut().unwrap(), &mut left, parts, &mut moves);
    }
    // A dressing being put on: the roll taken to the wound and wound round it, the other hand off it; the kit held low, open.
    if let Some(working) = weapons.medic.working() {
        let s = (working * 8.0).min(1.0);
        let t = weapons.medic.clock * 6.0;
        if key == "bandage" {
            pos += Vec3::new(-0.08 + t.cos() * 0.05, 0.05 + t.sin() * 0.04, 0.2) * s;
            turn.x += t.sin() * 0.3 * s;
            if s > 0.5 {
                left = None;
            }
        } else {
            pos.y -= 0.1 * s;
            pos.z += 0.05 * s;
            turn.x += 0.7 * s;
            turn.z += t.sin() * 0.05 * s;
        }
    }

    let mut q = match base {
        Some(b) => euler(b),
        None => aim(pos, tip_ts),
    } * euler(turn);

    // Solid where it is drawn: held against a wall or someone it stops there, pulled back toward the chest as far as the
    // arms can take it and then turned aside (a gun's muzzle down, a blade or a tool's head up), as the hands do when
    // the body comes up against something. It goes back out as the way clears, a little slower than it came in. A stab, a
    // cut or a blow is not bent out of the way: what it meets in a person is `sweep`'s, and the room's wall stops it.
    // A dressing is put on someone. Pressed against someone it pushes them, with what arms holding a thing out give: a
    // little.
    let (mut back, mut tilt) = (0.0, 0.0);
    hand.against = None;
    let walls = QueryFilter::only_fixed().groups(CollisionGroups::new(Group::ALL, WORLD));
    let sign = if a.gun.is_some() { 1.0 } else { -1.0 };
    if let (Some(shape), Some(&bounds), Ok(ctx)) = (hand.shapes.get(key), hand.boxes.get(key), rapier.single()) {
        // A swing or a stab that meets the room's wall (as drawn, pulled back as far as it still is) stops there, heard,
        // and comes back the way it went, kept out of the wall on its way.
        if let Some(act) = weapons.action.as_mut().filter(|x| x.stopped.is_none()) {
            let (at, turned) = tilted(pos - Vec3::Z * hand.back, q, bounds, sign * hand.tilt);
            let world = eye.mul_transform(Transform { translation: e(at), rotation: ts_turn(turned), scale: Vec3::ONE });
            let mut met = false;
            ctx.intersect_shape(world.translation, world.rotation, shape, walls, |_, _| {
                met = true;
                false
            });
            if !met {
                act.clear = swung;
            } else {
                act.stopped = Some((act.clear, (act.t / act.length).min(1.0)));
                let tip = hand.anchors.get(key).map_or(world.translation, |x| world.transform_point(x.tip));
                // (No take of a tool or blade striking concrete: the grenade's steel on the floor, or the bat's blow.)
                sound.play(if key == "bat" { "blunt" } else { "bounce-metal" }, Play::at(tip).gain(0.7));
            }
        }
        if weapons.action.as_ref().is_none_or(|x| x.stopped.is_some()) {
            segments.clear();
            for (who, rd) in &ragdolls {
                segments.extend(rd.segs.iter().enumerate().map(|(k, s)| (s.entity, (who, k))));
            }
            let people = weapons.action.is_none() && a.kind != Kind::Dress;
            // (As far back as the arms take it: what is held out in the hands to some 12 cm ahead of the eye, against the
            // chest; a long gun's stock no further into the shoulder than a few centimetres.)
            let long = a.gun.is_some() && h.at[2] < 0.4;
            let most = if long { 0.06 } else { (h.at[2] - 0.12).clamp(0.04, 0.4) };
            let met;
            (back, tilt, met) = clear_of(&ctx, people.then_some(&*segments), eye, pos, q, shape, bounds, most, sign);
            if let Some((e, at)) = met.filter(|_| back > 0.002) {
                if let Some(&(who, k)) = segments.get(&e) {
                    hand.against = Some((who, at));
                    // About 400 N/m of give in the arms, and no more than 80 N (a firm press of a thing held out).
                    let push = (back * 400.0).min(80.0);
                    if let Ok((_, mut rd)) = ragdolls.get_mut(who) {
                        rd.push(k, eye.forward().as_vec3() * push * dt, at);
                    }
                }
            }
        }
    }
    let out = 1.0 - (-dt * 10.0).exp();
    hand.back = back.max(hand.back + (back - hand.back) * out);
    hand.tilt = tilt.max(hand.tilt + (tilt - hand.tilt) * out);
    pos.z -= hand.back;
    if let Some(&bounds) = hand.boxes.get(key) {
        (pos, q) = tilted(pos, q, bounds, sign * hand.tilt);
    }
    hand.local = Transform { translation: e(pos), rotation: ts_turn(q), scale: Vec3::ONE };
    if let Some(he) = hand.entity {
        if let Ok(mut t) = transforms.get_mut(he) {
            *t = hand.local;
        }
    }
    if let Some(&m) = hand.models.get(key) {
        if let Ok(mut v) = shown.get_mut(m) {
            let want = if model_shown { Visibility::Inherited } else { Visibility::Hidden };
            if *v != want {
                *v = want;
            }
        }
    }
    holds.right = right;
    holds.left = left;
    holds.frame = eye.mul_transform(hand.local);
    // The moving parts: back where they were made, then as this frame has them.
    if let Some(parts) = hand.parts.get(key) {
        for (name, p) in parts {
            let m = moves.iter().rev().find(|m| m.part == *name);
            move_part(p, m.and_then(|m| m.by), m.and_then(|m| m.turn), m.is_none_or(|m| m.shown), &mut transforms);
        }
    }
}

// How far a thing held at `pos`, turned `q` (the TS's eye frame), with its hull `shape` and box `bounds` in the hand's frame, has to be
// pulled back toward the eye to be clear of the room and (given their segments' colliders) people, at most `most`
// metres; past that, how far it is turned as well (`tilted`; `sign`: down, or up). Its box is swept from the most it
// can be pulled back to where it is wanted, and stopped where it first touches; and what it touched, if anything, and
// where.
#[allow(clippy::too_many_arguments)]
fn clear_of(ctx: &RapierContext, people: Option<&HashMap<Entity, (Entity, usize)>>, eye: &Transform, pos: Vec3, q: Quat, shape: &Collider, bounds: (Vec3, Vec3),
            most: f32, sign: f32) -> (f32, f32, Option<(Entity, Vec3)>) {
    let ahead = eye.forward().as_vec3();
    let walls = QueryFilter::only_fixed().groups(CollisionGroups::new(Group::ALL, WORLD));
    let opts = ShapeCastOptions { stop_at_penetration: true, ..ShapeCastOptions::with_max_time_of_impact(most) };
    let mut tilt = 0.0;
    loop {
        let (at, turned) = tilted(pos - Vec3::Z * most, q, bounds, sign * tilt);
        let hand = eye.mul_transform(Transform { translation: e(at), rotation: ts_turn(turned), scale: Vec3::ONE });
        let (at, turn) = (hand.translation, hand.rotation);
        let theirs = |e: Entity, _: &bevy_rapier3d::rapier::geometry::Collider| people.is_some_and(|p| p.contains_key(&e));
        let hit = [ctx.cast_shape(at, turn, ahead, shape, opts, walls), people.and_then(|_| ctx.cast_shape(at, turn, ahead, shape, opts, QueryFilter::only_dynamic().predicate(&theirs)))]
            .into_iter()
            .flatten()
            .min_by(|a, b| a.1.time_of_impact.total_cmp(&b.1.time_of_impact));
        let Some((e, h)) = hit else { return (0.0, tilt, None) };
        if h.time_of_impact > 0.0 || tilt >= 1.2 {
            let point = h.details.map_or(at + ahead * h.time_of_impact, |d| d.witness1);
            return (most - h.time_of_impact, tilt, Some((e, point)));
        }
        tilt += 0.15;
    }
}

// A thing held at `pos`, turned `q` (the TS's eye frame), turned `by` more about its width at the back of its box (a long
// gun's butt in the shoulder, a blade's pommel), muzzle or point down for more than nothing: where its hand is then, and
// its turn.
fn tilted(pos: Vec3, q: Quat, (lo, hi): (Vec3, Vec3), by: f32) -> (Vec3, Quat) {
    let turned = q * euler(Vec3::new(by, 0.0, 0.0));
    let pivot = e(Vec3::new((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0, hi.z));
    (pos + q * pivot - turned * pivot, turned)
}

// Each held thing's shape in the hand's frame, once its scene is in: the hull round its meshes (what `clear_of` keeps out
// of walls and people) and its box.
fn measure(mut hand: ResMut<Hand>, children: Query<&Children>, globals: Query<&GlobalTransform>, mesh3d: Query<&Mesh3d>, meshes: Res<Assets<Mesh>>) {
    let Some(he) = hand.entity else { return };
    let Ok(hg) = globals.get(he) else { return };
    let home = hg.affine().inverse();
    let mut found = Vec::new();
    'models: for (&key, &root) in &hand.models {
        if hand.shapes.contains_key(key) {
            continue;
        }
        let mut points = Vec::new();
        for d in children.iter_descendants(root) {
            let (Ok(m), Ok(g)) = (mesh3d.get(d), globals.get(d)) else { continue };
            let Some(mesh) = meshes.get(&m.0) else { continue 'models };
            let Some(bevy::mesh::VertexAttributeValues::Float32x3(ps)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) else { continue };
            let to_hand = home * g.affine();
            points.extend(ps.iter().map(|p| to_hand.transform_point3(Vec3::from(*p))));
        }
        let Some(hull) = Collider::convex_hull(&points) else { continue };
        let lo = points.iter().fold(Vec3::INFINITY, |a, p| a.min(*p));
        let hi = points.iter().fold(Vec3::NEG_INFINITY, |a, p| a.max(*p));
        found.push((key, hull, (lo, hi)));
    }
    for (key, hull, bounds) in found {
        hand.shapes.insert(key, hull);
        hand.boxes.insert(key, bounds);
    }
}

// A gun turned so that its bore, from where it is held at `at`, runs to the point AIMED metres ahead of the eye (TS frame).
fn aim(at: Vec3, tip: Option<Vec3>) -> Quat {
    let bore = tip.map_or(Vec3::ZERO, |t| Vec3::new(t.x, t.y, 0.0));
    let mut q = Quat::IDENTITY;
    for _ in 0..2 {
        let z = (Vec3::new(0.0, 0.0, AIMED) - (at + q * bore)).normalize();
        let y = (Vec3::Y - z * z.y).normalize();
        q = Quat::from_mat3(&Mat3::from_cols(y.cross(z), y, z));
    }
    q
}

// A part moved `by` (in the TS's hand frame, m) and turned `angle` about the line `axis` through `pivot`; with nothing
// given, back where it was made. `shown` false hides it (a magazine dropped, a pin pulled).
fn move_part(p: &Part, by: Option<Vec3>, turn: Option<(Vec3, Vec3, f32)>, shown: bool, transforms: &mut Query<&mut Transform, Without<Player>>) {
    for ((node, rest), to_hand) in p.nodes.iter().zip(&p.to_hand) {
        let Ok(mut t) = transforms.get_mut(*node) else { continue };
        let mut out = *rest;
        // (its own scale, not 1: the Desert Eagle's parts are scaled up 100 times in their nodes, as FBX2glTF wrote them)
        if !shown {
            out.scale = Vec3::ZERO;
        }
        if by.is_some() || turn.is_some() {
            let from_hand = to_hand.inverse();
            let mut at = to_hand.transform_point3(rest.translation);
            if let Some((axis, pivot, angle)) = turn {
                // (Brought over: a line of the TS's frame mirrored, a turn about it the other way.)
                let (axis, pivot, angle) = (e(axis), e(pivot), -angle);
                let r = Quat::from_axis_angle(axis, angle);
                at = pivot + r * (at - pivot);
                let local = from_hand.transform_vector3(axis).normalize();
                out.rotation = Quat::from_axis_angle(local, angle * from_hand.matrix3.determinant().signum()) * rest.rotation;
            }
            if let Some(by) = by {
                at += e(by);
            }
            out.translation = from_hand.transform_point3(at);
        }
        if *t != out {
            *t = out;
        }
    }
}

// A reload, `u` of the way through (0 to 1), done by the hands: the gun tipped in toward the other hand, which takes the
// magazine out and down, comes back up with a full one and seats it, and works the slide or the charging handle; the bolt
// rifle's bolt opened, five rounds thumbed in and the bolt closed; the shotgun opened, shells out and in. The gun is then
// back where it was. Its parts move with the hand on them. (In the TS's frame throughout.)
#[allow(clippy::too_many_arguments)]
fn reloading(key: &'static str, u: f32, length: f32, rest: &Held, tip: Option<Vec3>, pos: &mut Vec3, turn: &mut Vec3, right: &mut Option<Grip>,
             left: &mut Option<Grip>, parts: Option<&HashMap<&'static str, Part>>, moves: &mut Vec<Moved>) {
    let tipped = span(u, 0.0, 0.14) - span(u, 0.84, 1.0);
    if key == "rifle" {
        return bolt(u, rest, tip, pos, turn, right, left, parts, moves, true);
    }
    let shotgun = key == "shotgun";
    let sl = slide(key);
    // Tipped in: the magazine well (or the open breech) turned toward the other hand, brought in and up a little.
    // (Turned about the grip: a long gun pitched down there would bring its stock up into the face. The shotgun's
    // barrels drop; the gun itself only comes in and down a little.)
    *pos += Vec3::new(-0.05, if shotgun { -0.03 } else { 0.04 }, -0.05) * tipped;
    turn.z += (if shotgun { 0.2 } else if sl > 0.0 { 0.45 } else { 0.5 }) * tipped;
    turn.x += (if shotgun { 0.1 } else { -0.15 }) * tipped;
    let part = |name: &str| parts.and_then(|p| p.get(name)).map(bounds_ts);
    let mag = part("mag");
    let below = Vec3::new(-0.06, -0.4, -0.12);
    let well = match mag {
        Some((lo, hi)) => Vec3::new((lo.x + hi.x) / 2.0, lo.y + 0.03, (lo.z + hi.z) / 2.0),
        None if shotgun => Vec3::new(0.0, 0.08, 0.03),
        None => Vec3::new(0.0, -0.06, 0.1),
    };
    let on_mag = |by: Vec3| Some(Grip { hold: "handle", at: (well + by).to_array(), along: [0.0, -0.3, -0.95], back: [0.35, -0.9, 0.2], shoulder: None });
    let gone = |g: Option<Grip>| g.map(|g| Grip { at: (Vec3::from(g.at) + below).to_array(), ..g });
    let support = rest.left;
    if shotgun {
        // Broken open (the barrels and forend turn down about the hinge pin at the front of the action, the hand on the
        // forend taking them down), the spent shells drawn out at the breech, two new ones fetched and pushed in, and
        // closed by the hand on the forend, with a flick of the gun.
        let barrels = part("barrels");
        let pivot = Vec3::new(0.0, barrels.map_or(0.04, |b| b.0.y + 0.01), barrels.map_or(0.15, |b| b.0.z));
        let open = 0.55 * (span(u, 0.12, 0.22) - span(u, 0.76, 0.84));
        let r = Quat::from_axis_angle(Vec3::X, open);
        let turned = |g: Option<Grip>| {
            g.map(|g| Grip { at: (pivot + r * (Vec3::from(g.at) - pivot)).to_array(), along: (r * Vec3::from(g.along)).to_array(), back: (r * Vec3::from(g.back)).to_array(), ..g })
        };
        moves.push(mv("barrels", None, Some((Vec3::X, pivot, open)), true));
        let breech = turned(Some(Grip { hold: "pinch", at: [0.0, pivot.y + 0.045, pivot.z + 0.01], along: [0.0, -0.4, -0.9], back: [0.9, 0.0, 0.4], shoulder: None }));
        *left = blend(blend(blend(blend(turned(support), breech, span(u, 0.22, 0.3)), gone(breech), span(u, 0.32, 0.46)), breech, span(u, 0.5, 0.64)),
                      turned(support), span(u, 0.66, 0.74));
        turn.x -= 0.25 * (span(u, 0.8, 0.84) - span(u, 0.84, 0.92));
        return;
    }
    // Out: drawn down and away by the hand (from a pistol it falls free), the hand gone below the picture for a full one,
    // up and into the well, pushed home.
    let drop = sl > 0.0;
    let low = Vec3::new(0.0, -0.42, -0.1);
    let drawn = Vec3::new(0.0, -0.12, 0.02);
    let seat = low.lerp(Vec3::new(0.0, -0.06, 0.0), span(u, 0.42, 0.62)).lerp(Vec3::ZERO, span(u, 0.62, 0.7));
    let fell = (u - 0.1).max(0.0) * length;
    let out: Option<Vec3> = if drop {
        if u < 0.42 { (fell < 0.25).then(|| Vec3::new(0.0, -4.9 * fell * fell, 0.0)) } else { Some(seat) }
    } else if u < 0.26 {
        Some(drawn * span(u, 0.12, 0.26))
    } else if u < 0.42 {
        Some(drawn.lerp(low, span(u, 0.26, 0.4)))
    } else {
        Some(seat)
    };
    *left = if drop {
        if u < 0.42 { blend(support, on_mag(low), span(u, 0.0, 0.14)) } else { on_mag(out.unwrap()) }
    } else {
        blend(support, on_mag(out.unwrap_or(low)), span(u, 0.0, 0.12))
    };
    // Then the slide (pistol: over the top, from behind) or the charging handle (rifles) pulled back and let go.
    let pull = span(u, 0.76, 0.82) - span(u, 0.82, 0.84);
    if drop {
        let s = part("slide");
        let grab = Some(Grip { hold: "wrap", at: [0.0, s.map_or(0.06, |b| b.1.y - 0.012), s.map_or(-0.02, |b| b.0.z + 0.03)], along: [0.0, 0.0, 1.0], back: [1.0, -0.3, 0.0], shoulder: None });
        moves.push(mv("slide", Some(Vec3::new(0.0, 0.0, -sl * pull)), None, true));
        *left = blend(blend(*left, grab, span(u, 0.7, 0.76)), support, span(u, 0.86, 0.98));
        if let Some(l) = left.as_mut() {
            l.at[2] -= sl * pull * span(u, 0.7, 0.76);
        }
    } else {
        let hd = part("handle");
        let at = hd.map_or(Vec3::new(0.03, 0.09, 0.08), |(lo, hi)| Vec3::new((lo.x + hi.x) / 2.0, hi.y, hi.z));
        let travel = if key == "r22" { 0.038 } else { 0.07 }; // a 10/22's bolt comes back about 1.5 in
        let grab = Some(Grip { hold: "pinch", at: (at - Vec3::Z * travel * pull).to_array(), along: [0.0, -0.5, -0.85], back: [0.3, 0.2, 0.93], shoulder: None });
        moves.push(mv("handle", Some(Vec3::new(0.0, 0.0, -travel * pull)), None, true));
        *left = blend(blend(*left, grab, span(u, 0.7, 0.76)), support, span(u, 0.86, 1.0));
    }
    moves.push(mv("mag", out, None, out.is_some()));
}

// The bolt rifle's bolt worked by the right hand (a reload, `u` through it, with five rounds pushed in by the left
// between; or a round chambered after a shot).
#[allow(clippy::too_many_arguments)]
fn bolt(u: f32, rest: &Held, tip: Option<Vec3>, pos: &mut Vec3, turn: &mut Vec3, right: &mut Option<Grip>, left: &mut Option<Grip>,
        parts: Option<&HashMap<&'static str, Part>>, moves: &mut Vec<Moved>, reload: bool) {
    let b = parts.and_then(|p| p.get("bolt")).map(bounds_ts);
    // When each stroke is, as fractions of the whole: hand to the knob, lift, back, (rounds in), forward, down, hand back.
    let at: [f32; 8] = if reload { [0.0, 0.1, 0.16, 0.26, 0.78, 0.86, 0.92, 1.0] } else { [0.13, 0.28, 0.36, 0.5, 0.55, 0.67, 0.74, 0.94] };
    let lift = span(u, at[1], at[2]) - span(u, at[5], at[6]);
    let draw = span(u, at[2], at[3]) - span(u, at[4], at[5]);
    let knob = b.map_or(Vec3::new(0.06, 0.03, 0.05), |(lo, hi)| Vec3::new(hi.x, (lo.y + hi.y) / 2.0, hi.z - 0.01));
    let angle = -1.1 * lift;
    let axis = Vec3::Z;
    let pivot = Vec3::new(tip.map_or(0.0, |t| t.x), tip.map_or(0.05, |t| t.y), 0.0);
    let moved = pivot + Quat::from_axis_angle(axis, angle) * (knob - pivot) + Vec3::new(0.0, 0.0, -0.085 * draw);
    moves.push(mv("bolt", Some(Vec3::new(0.0, 0.0, -0.085 * draw)), Some((axis, pivot, angle)), true));
    let on_knob = Some(Grip { hold: "pinch", at: moved.to_array(), along: [0.2, -0.5, -0.85], back: [0.3, 0.9, 0.3], shoulder: None });
    *right = blend(blend(rest.right, on_knob, span(u, at[0], at[1])), rest.right, span(u, at[6], at[7]));
    let tipped = span(u, at[0], at[1]) - span(u, at[6], at[7]);
    turn.z += (if reload { 0.3 } else { 0.12 }) * tipped;
    *pos += Vec3::new(-0.02, 0.01, -0.02) * tipped;
    if !reload {
        return;
    }
    // Five rounds pressed down into the magazine through the open action, one after another.
    let press = (std::f32::consts::PI * 5.0 * span(u, 0.34, 0.72)).sin().max(0.0);
    let port = Some(Grip { hold: "pinch", at: [0.0, 0.07 - 0.015 * press, 0.02], along: [0.0, -0.3, -0.95], back: [0.95, 0.2, 0.0], shoulder: None });
    *left = blend(blend(rest.left, port, span(u, 0.26, 0.34)), rest.left, span(u, 0.72, 0.82));
}

// The grenade thrown, `t` seconds in (-1: not being thrown): the other hand pulls the pin by its ring, the throwing hand
// draws back beside the head and comes over and forward, letting go at 0.22 s (`lob`), follows through and goes down for
// another, which comes back up with its pin in. Whether the one in the hand is to be drawn.
fn lobbing(t: f32, h: &Held, pos: &mut Vec3, base: &mut Vec3, left: &mut Option<Grip>, parts: Option<&HashMap<&'static str, Part>>, moves: &mut Vec<Moved>) -> bool {
    if t < 0.0 {
        return true;
    }
    let pin = parts.and_then(|p| p.get("pin")).map(bounds_ts);
    let ring = pin.map_or(Vec3::new(0.02, 0.0, 0.04), |(lo, hi)| Vec3::new(hi.x, (lo.y + hi.y) / 2.0, (lo.z + hi.z) / 2.0));
    let pulled = span(t, 0.06, 0.12);
    moves.push(mv("pin", Some(Vec3::new(0.08 * pulled, 0.0, 0.0)), None, t < 0.13 || t > 0.72));
    let on_ring = Grip { hold: "pinch", at: (ring + Vec3::X * 0.08 * pulled).to_array(), along: [0.0, 0.0, -1.0], back: [1.0, 0.0, 0.0], shoulder: None };
    *left = if t < 0.2 {
        blend(Some(Grip { at: [ring.x + 0.05, ring.y - 0.3, ring.z - 0.1], ..on_ring }), Some(on_ring), span(t, 0.0, 0.06) - span(t, 0.13, 0.2))
    } else {
        None
    };
    let (cock, go, after, back) = (span(t, 0.1, 0.17), span(t, 0.17, 0.22), span(t, 0.22, 0.42), span(t, 0.72, 0.9));
    let at = Vec3::from(h.at);
    let (up, out, down) = (Vec3::new(0.24, 0.02, 0.12), Vec3::new(0.06, 0.08, 0.55), Vec3::new(0.15, -0.55, 0.3));
    *pos = at.lerp(up, cock).lerp(out, go).lerp(down, after).lerp(at, back);
    base.x += -0.9 * cock + 1.6 * go;
    t < 0.22 || t > 0.72
}

// --- the models in the hand -----------------------------------------------------------------------------------------------

// Parts of a model that move in the hands, by their glTF node names: a pistol's slide and magazine, the M4's magazine and
// charging handle, the bolt rifle's bolt, the grenade's pin.
// The AK's magazine and the shotgun's barrels are loose pieces of one mesh each, cut out by `split` into meshes of their own
// named so.
fn parts_of(key: &str) -> &'static [(&'static str, fn(&str) -> bool)] {
    match key {
        "pistol" => &[("slide", |n| n.contains("slide")), ("mag", |n| n.contains("magazine"))],
        "m4" => &[("mag", |n| n == "Magazine"), ("handle", |n| n == "Charging_Handle")],
        "rifle" => &[("bolt", |n| n.ends_with("bolt_a") || n.ends_with("bolt_b"))],
        "grenade" => &[("pin", |n| n == "pin")],
        "deagle" => &[("slide", |n| matches!(n, "Slide" | "Bolt" | "Ironsights Back" | "Safety" | "Safety Screw")), ("mag", |n| matches!(n, "Magazine" | "Bullets"))],
        "r22" => &[("mag", |n| n == "mag"), ("handle", |n| n == "handle")],
        "ak" => &[("mag", |n| n == "mag")],
        "shotgun" => &[("barrels", |n| n == "barrels")],
        _ => &[],
    }
}

// The models, once the glTF are in: each under the hand, turned so its grip is at the hand and it points ahead; the kit
// built in code; where each muzzle and port is.
pub fn spawn_models(
    mut commands: Commands,
    models: Res<WeaponModels>,
    gltfs: Res<Assets<Gltf>>,
    mut hand: ResMut<Hand>,
    eye: Query<Entity, With<Player>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut rng: ResMut<Rng>,
) {
    let Ok(eye) = eye.single() else { return };
    let he = commands.spawn((Transform::default(), Visibility::default(), ChildOf(eye), Name::new("hand"))).id();
    hand.entity = Some(he);
    for a in ARMS {
        let Some(spec) = models.specs.get(a.key) else { continue };
        let Some(scene) = gltfs.get(&models.gltf[a.key]).and_then(|g| g.default_scene.clone().or_else(|| g.scenes.first().cloned())) else { continue };
        let align = models.held(a.key);
        let root = commands.spawn((align, Visibility::Hidden, ChildOf(he), Name::new(format!("held {}", a.key)))).id();
        commands.spawn((WorldAssetRoot(scene), Transform::default(), ChildOf(root)));
        hand.models.insert(a.key, root);
        let edge = (a.kind == Kind::Blade).then(|| (align.rotation * -Vec3::from(spec.up)).normalize());
        hand.anchors.insert(a.key, Anchors { tip: align.transform_point(Vec3::from(spec.tip)), ejection: spec.ejection.map(|p| align.transform_point(Vec3::from(p))), edge });
    }
    for (key, pieces) in crate::dressing::kit(&mut meshes, &mut materials, &mut images, &mut rng) {
        let root = commands.spawn((Transform::default(), Visibility::Hidden, ChildOf(he), Name::new(format!("held {key}")))).id();
        for p in pieces {
            commands.spawn((Mesh3d(p.mesh.clone()), MeshMaterial3d(p.material.clone()), p.at, ChildOf(root)));
        }
        hand.models.insert(key, root);
    }
}

// Each model's moving parts found by name once its scene is in (and its bounds worked out, in the hand's frame).
#[allow(clippy::too_many_arguments)]
fn find_parts(
    mut commands: Commands,
    mut hand: ResMut<Hand>,
    children: Query<&Children>,
    names: Query<&Name>,
    globals: Query<&GlobalTransform>,
    transforms: Query<&Transform>,
    aabbs: Query<&bevy::camera::primitives::Aabb>,
    mesh3d: Query<(&Mesh3d, &MeshMaterial3d<StandardMaterial>, &ChildOf)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut tries: Local<u32>,
    mut cut: Local<Vec<&'static str>>,
) {
    if *tries > 600 || hand.entity.is_none() {
        return;
    }
    *tries += 1;
    let Some(he) = hand.entity else { return };
    let Ok(hg) = globals.get(he) else { return };
    let home = hg.affine().inverse();
    let mut found = Vec::new();
    for (&key, &root) in &hand.models {
        if hand.parts.contains_key(key) || parts_of(key).is_empty() {
            continue;
        }
        let all: Vec<Entity> = children.iter_descendants(root).collect();
        // (A scene not in yet, or its bounds not yet worked out.)
        if all.len() < 2 || !all.iter().any(|&d| aabbs.get(d).is_ok()) {
            continue;
        }
        // The pieces two models have only as loose parts of one mesh, cut out first (and found next frame).
        let keep: Option<(&'static str, fn(Vec3, Vec3) -> bool)> = match key {
            "ak" => Some(("mag", |lo, _| lo.y < -0.1)),
            "shotgun" => Some(("barrels", |lo, _| lo.z > 0.06)),
            _ => None,
        };
        if let Some((name, keep)) = keep {
            if !cut.contains(&key) {
                cut.push(key);
                for &d in &all {
                    let Ok((mesh, material, parent)) = mesh3d.get(d) else { continue };
                    let Some(m) = meshes.get(&mesh.0) else { continue };
                    let Some((rest, part)) = split(m, keep) else { continue };
                    let t = transforms.get(d).copied().unwrap_or_default();
                    commands.entity(d).insert(Mesh3d(meshes.add(rest)));
                    commands.spawn((Mesh3d(meshes.add(part)), material.clone(), t, ChildOf(parent.parent()), Name::new(name)));
                }
                continue;
            }
        }
        let mut parts = HashMap::new();
        for &(name, test) in parts_of(key) {
            // The nodes named so, but not those under another so named (a mesh under its node).
            let picked: Vec<Entity> = all
                .iter()
                .copied()
                .filter(|&d| names.get(d).is_ok_and(|n| test(n.as_str())))
                .filter(|&d| !all.iter().any(|&o| o != d && names.get(o).is_ok_and(|n| test(n.as_str())) && children.iter_descendants(o).any(|x| x == d)))
                .collect();
            if picked.is_empty() {
                continue;
            }
            let (mut lo, mut hi) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
            let mut nodes = Vec::new();
            let mut to_hand = Vec::new();
            for &n in &picked {
                for m in std::iter::once(n).chain(children.iter_descendants(n)) {
                    let (Ok(b), Ok(g)) = (aabbs.get(m), globals.get(m)) else { continue };
                    let (c, h) = (Vec3::from(b.center), Vec3::from(b.half_extents));
                    for k in 0..8 {
                        let corner = c + h * Vec3::new([-1.0, 1.0][k & 1], [-1.0, 1.0][(k >> 1) & 1], [-1.0, 1.0][(k >> 2) & 1]);
                        let q = home.transform_point3(g.transform_point(corner));
                        lo = lo.min(q);
                        hi = hi.max(q);
                    }
                }
                let Ok(t) = transforms.get(n) else { continue };
                let parent_global = globals.get(n).map(|g| g.affine() * t.compute_affine().inverse()).unwrap_or_default();
                nodes.push((n, *t));
                to_hand.push(home * parent_global);
            }
            parts.insert(name, Part { nodes, to_hand, min: lo, max: hi });
        }
        found.push((key, parts));
    }
    for (key, parts) in found {
        hand.parts.insert(key, parts);
    }
}

// The connected pieces of `mesh` (its triangles joined where their corners meet) that `keep` picks by their bounds in the
// mesh's own frame, cut out into a mesh of their own: (what is left, the piece). None if it picks nothing.
fn split(mesh: &Mesh, keep: fn(Vec3, Vec3) -> bool) -> Option<(Mesh, Mesh)> {
    let Some(bevy::mesh::VertexAttributeValues::Float32x3(p)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) else { return None };
    let index: Vec<u32> = mesh.indices()?.iter().map(|i| i as u32).collect();
    let mut id: HashMap<[i64; 3], usize> = HashMap::new();
    let weld: Vec<usize> = p.iter().map(|v| {
        let k = v.map(|x| (x * 1e4).round() as i64);
        let n = id.len();
        *id.entry(k).or_insert(n)
    }).collect();
    let mut up: Vec<usize> = (0..id.len()).collect();
    fn top(up: &mut [usize], mut x: usize) -> usize {
        while up[x] != x {
            up[x] = up[up[x]];
            x = up[x];
        }
        x
    }
    for t in index.chunks_exact(3) {
        let a = top(&mut up, weld[t[0] as usize]);
        let b = top(&mut up, weld[t[1] as usize]);
        up[b] = a;
        let c = top(&mut up, weld[t[2] as usize]);
        up[c] = a;
    }
    let mut bounds: HashMap<usize, (Vec3, Vec3)> = HashMap::new();
    for (i, v) in p.iter().enumerate() {
        let r = top(&mut up, weld[i]);
        let v = Vec3::from(*v);
        let b = bounds.entry(r).or_insert((v, v));
        b.0 = b.0.min(v);
        b.1 = b.1.max(v);
    }
    let picked: Vec<usize> = bounds.iter().filter(|(_, b)| keep(b.0, b.1)).map(|(r, _)| *r).collect();
    if picked.is_empty() {
        return None;
    }
    let (mut mine, mut rest) = (Vec::new(), Vec::new());
    for t in index.chunks_exact(3) {
        let r = top(&mut up, weld[t[0] as usize]);
        if picked.contains(&r) { mine.extend_from_slice(t) } else { rest.extend_from_slice(t) }
    }
    let mut a = mesh.clone();
    a.insert_indices(bevy::mesh::Indices::U32(rest));
    let mut b = mesh.clone();
    b.insert_indices(bevy::mesh::Indices::U32(mine));
    Some((a, b))
}

// Whether a mesh is a blade's (the knife's blade is a mesh of its own; the estoc is one mesh with its hilt, which would
// redden too, so its blood is not drawn).
fn is_blade(e: Entity, names: &Query<&Name>, parents: &Query<&ChildOf>) -> bool {
    names.get(e).is_ok_and(|n| n.contains("blade")) || parents.get(e).is_ok_and(|c| names.get(c.parent()).is_ok_and(|n| n.contains("blade")))
}

// A blade's mesh that comes in under the hand is given a material of its own, for the blood on it (`stain`): the model's
// own is the one on the board too. (What is held is drawn in the room as anything else is, where it is: `clear_of` keeps it
// out of walls and people. The TS drew it and the arms over the room, depth cleared, as shooters do.)
fn own_blades(
    mut commands: Commands,
    hand: Res<Hand>,
    added: Query<(Entity, &MeshMaterial3d<StandardMaterial>), Added<MeshMaterial3d<StandardMaterial>>>,
    parents: Query<&ChildOf>,
    names: Query<&Name>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let Some(root) = hand.entity else { return };
    for (e, m) in &added {
        if !is_blade(e, &names, &parents) || !parents.iter_ancestors(e).any(|a| a == root) {
            continue;
        }
        let Some(base) = materials.get(&m.0).cloned() else { continue };
        commands.entity(e).insert(MeshMaterial3d(materials.add(base)));
    }
}

// The blade reddened by the blood on it, wet and glossy, going dull and brown as it dries.
// What leaves the blade (weapons.ts _shed: drops cast off it as it swings, at its tip's speed) is blood.rs `shed`'s.
fn stain(
    weapons: Res<Weapons>,
    hand: Res<Hand>,
    children: Query<&Children>,
    parents: Query<&ChildOf>,
    names: Query<&Name>,
    mesh_materials: Query<&MeshMaterial3d<StandardMaterial>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut own: Local<HashMap<Entity, (Color, f32, f32)>>,
) {
    let key = weapons.arm().key;
    let Some(&(wet, _, age)) = weapons.blades.get(key) else { return };
    let Some(&root) = hand.models.get(key) else { return };
    let cover = (wet / 0.03).min(1.0);
    let dry = (age / DRIES).min(1.0);
    let blood = Color::linear_rgb(0.3, 0.02, 0.018).mix(&Color::linear_rgb(0.17, 0.07, 0.05), dry);
    for m in children.iter_descendants(root) {
        if !is_blade(m, &names, &parents) {
            continue;
        }
        let Ok(mat) = mesh_materials.get(m) else { continue };
        let Some(mut x) = materials.get_mut(&mat.0) else { continue };
        let (c, metal, rough) = *own.entry(m).or_insert((x.base_color, x.metallic, x.perceptual_roughness));
        x.base_color = c.mix(&blood, cover);
        x.metallic = metal * (1.0 - cover);
        x.perceptual_roughness = rough + (0.15 + 0.55 * dry - rough) * cover;
    }
}

// For a check only (the `viewmodel` scenario): the camera taken this far from the eye (in its own frame) once the hands and
// what they hold are posed, to see them from the side; what hangs from the eye is put back where it was in the world.
#[derive(Resource, Default)]
pub struct Aside(pub Option<Transform>);

fn aside(aside: Res<Aside>, hand: Res<Hand>, mut eye: Query<&mut Transform, With<Player>>, mut transforms: Query<&mut Transform, Without<Player>>) {
    let Some(off) = aside.0 else { return };
    let Ok(mut t) = eye.single_mut() else { return };
    *t = t.mul_transform(off);
    if let Some(Ok(mut h)) = hand.entity.map(|e| transforms.get_mut(e)) {
        *h = Transform::from_matrix(off.to_matrix().inverse() * hand.local.to_matrix());
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Aside>()
        .add_systems(PostUpdate, aside.before(bevy::transform::TransformSystems::Propagate))
        .init_resource::<Weapons>()
        .init_resource::<WeaponModels>()
        .init_resource::<Hand>()
        .init_resource::<Holds>()
        .add_systems(Startup, load)
        .add_systems(OnEnter(Loading::Done), spawn_models)
        .add_systems(Update, (input, timed("weapons", act), timed("weapons: the hand's pose", animate), timed("weapons: sight", sight), flying, find_parts, measure, own_blades, stain).chain().after(crate::player::walk).run_if(resource_exists::<crate::muzzle::Muzzle>))
        .add_systems(FixedUpdate, pull.before(PhysicsSet::SyncBackend));
}

#[test]
fn held_points_ahead() {
    let mut m = WeaponModels::default();
    // A model along the file's +X with its up +Y, gripped at its origin: held, its tip is ahead (-Z) of the hand.
    m.specs.insert("x".into(), Spec { file: String::new(), grip: [0.0; 3], tip: [1.0, 0.0, 0.0], up: [0.0, 1.0, 0.0], ejection: None, eject_dir: None });
    let t = m.held("x");
    let tip = t.transform_point(Vec3::X);
    assert!((tip - Vec3::NEG_Z).length() < 1e-5, "{tip}");
    assert!((t.rotation * Vec3::Y - Vec3::Y).length() < 1e-5);
}

#[test]
fn aim_points_the_bore_at_the_aim() {
    // A grip low and right, the muzzle 10 cm ahead of it: the bore from the muzzle runs to the point AIMED ahead.
    let at = Vec3::new(0.1, -0.1, 0.4);
    let tip = Vec3::new(0.0, 0.03, 0.1);
    let q = aim(at, Some(tip));
    let muzzle = at + q * Vec3::new(tip.x, tip.y, 0.0);
    let to = (Vec3::new(0.0, 0.0, AIMED) - muzzle).normalize();
    assert!((q * Vec3::Z).dot(to) > 0.9999);
}

// --- the `arsenal-use` scenario -------------------------------------------------------------------------------------------
//
// Each thing taken off the board (E, looking at it), the first-person view with it at rest, then fired, swung or thrown
// at the wall and at a person: what each did (the hits, as wounds.rs would be given them) and what was heard, into the log.

// The player at (x, z) in the TS's space, the eye `eye` above the floor, looking at `toward` (TS space). (scenario::view
// without its picture.)
fn stand(x: f32, z: f32, toward: [f32; 3], eye: f32) -> crate::scenario::Step {
    crate::scenario::Step::Do(Box::new(move |w: &mut World| {
        w.resource_scope(|w, map: Mut<crate::map::Map>| {
            let mut q = w.query::<&mut Player>();
            for mut p in q.iter_mut(w) {
                let at = crate::babylon(x, 0.0, z);
                p.spawn(&map, at.x, at.z, Some(crate::babylon(toward[0], toward[1], toward[2])), eye);
            }
        });
    }))
}

fn push(acts: Vec<Act>) -> crate::scenario::Step {
    crate::scenario::Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Weapons>().queue.extend(acts.iter().copied())))
}

// What happened since the last look: the hits and the sounds, into the log under `what`.
fn report(what: String) -> crate::scenario::Step {
    crate::scenario::Step::Do(Box::new(move |w: &mut World| {
        let hits = std::mem::take(&mut w.resource_mut::<Weapons>().log);
        let heard = std::mem::take(&mut w.resource_mut::<Sound>().heard);
        let heard: Vec<Value> = heard.iter().map(|h| json!({ "sound": h.name, "gain": h.gain, "merged": h.merged, "at": h.at, "falls": h.falls,
                                                               "hush": h.hush, "pan": h.pan })).collect();
        let w2 = w.resource::<Weapons>();
        let state = json!({ "slots": w2.slots, "slot": w2.slot, "ammo": w2.arm().rounds.map(|_| w2.ammo[w2.arm().key]), "reloading": w2.reloading });
        crate::scenario::log(w, json!({ "event": "use", "what": what, "hits": hits, "heard": heard, "weapons": state }));
    }))
}

pub fn scenario() -> Vec<crate::scenario::Step> {
    use crate::scenario::Step;
    let mut s = Vec::new();
    // F2 open throughout, its log saved at the end (profiler.rs).
    s.push(Step::Do(Box::new(crate::profiler::open)));
    // Everything off the slots first: each is taken from the board.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let mut wp = w.resource_mut::<Weapons>();
        wp.slots = [None; 6];
        wp.select(0);
    })));
    let level = |l: f32| Step::Do(Box::new(move |w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = l));
    // (ARSENAL_USE=grenade,shotgun tries only those.)
    let only: Option<Vec<String>> = std::env::var("ARSENAL_USE").ok().map(|v| v.split(',').map(String::from).collect());
    for a in ARMS.iter().filter(|a| only.as_ref().is_none_or(|o| o.iter().any(|k| k == a.key))) {
        let key = a.key;
        // Taken off the board: stood a metre and a half out from it, looking at it, E. (Into the slot held, which is put
        // back on the board first so each goes into the same slot.)
        s.push(push(vec![Act::PutBack]));
        s.push(Step::Do(Box::new(move |w: &mut World| {
            let Some(&(_, lo, hi)) = w.get_resource::<Arsenal>().and_then(|a| a.hung.iter().find(|h| h.0 == key)) else { return };
            let c = (lo + hi) / 2.0;
            w.resource_scope(|w, map: Mut<crate::map::Map>| {
                let mut q = w.query::<&mut Player>();
                for mut p in q.iter_mut(w) {
                    p.spawn(&map, c.x + 1.4, c.z, Some(c), 1.65);
                }
            });
        })));
        s.push(Step::Wait(2));
        s.push(push(vec![Act::Take]));
        s.push(Step::Wait(2));
        s.push(report(format!("{key}: taken off the board")));
        // The room cleared and new people lined up (K), so each thing meets someone standing and whole.
        s.push(Step::Do(Box::new(|w: &mut World| {
            use bevy::ecs::system::RunSystemOnce;
            let _ = w.run_system_once(crate::sandbox::reset);
        })));
        // At rest, looking at the line-up from where the player starts: the first-person view with it.
        s.push(level(1.0));
        s.push(stand(0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
        s.push(Step::Wait(40));
        s.push(Step::Shot(format!("fp_{key}")));
        s.push(level(4.0));
        let near = match a.kind {
            Kind::Gun => 3.2,
            Kind::Throw => 2.5,
            Kind::Grenade => 5.0,
            _ if matches!(key, "knife" | "hammer" | "fists" | "hands") => 0.5,
            _ => 0.75,
        };
        // At the wall: the east wall, 11 m off, at chest height; then at the young man (the third), at his chest.
        let at_person = |s: &mut Vec<Step>| s.push(stand(0.75, 2.2 - near, [0.75, 1.3, 2.2], 1.65));
        match a.kind {
            Kind::Gun => {
                s.push(stand(0.0, -4.0, [11.0, 1.4, -4.0], 1.65));
                s.push(Step::Wait(8));
                s.push(push(vec![Act::Press(0)]));
                s.push(Step::Wait(if a.gun.as_ref().unwrap().auto { 20 } else { 2 }));
                s.push(push(vec![Act::Release(0)]));
                s.push(Step::Wait(40));
                s.push(report(format!("{key}: fired at the wall")));
                at_person(&mut s);
                s.push(level(1.0));
                // (Long enough for the hands to catch up with the turn, and the rifle's bolt to be worked.)
                s.push(Step::Wait(70));
                s.push(push(vec![Act::Press(0), Act::Release(0)]));
                // (The flash is drawn in the one frame after the shot.)
                s.push(Step::Wait(2));
                s.push(Step::Shot(format!("fp_{key}_flash")));
                s.push(level(4.0));
                s.push(Step::Wait(40));
                s.push(report(format!("{key}: fired at a person")));
                s.push(push(vec![Act::Reload]));
                s.push(Step::Wait(10));
                s.push(level(1.0));
                s.push(stand(0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
                s.push(Step::Wait(30));
                s.push(Step::Shot(format!("fp_{key}_reloading")));
                s.push(level(4.0));
                // (The whole reload heard through for the pistol only: the rest are put down part way through.)
                if key == "pistol" {
                    s.push(Step::Wait(70));
                    s.push(report(format!("{key}: reloaded")));
                } else {
                    s.push(report(format!("{key}: part of a reload")));
                }
            }
            Kind::Blade | Kind::Blunt => {
                s.push(stand(10.0, -4.0, [11.0, 1.4, -4.0], 1.65));
                s.push(Step::Wait(4));
                s.push(push(vec![Act::Press(0), Act::Release(0)]));
                s.push(Step::Wait(40));
                s.push(report(format!("{key}: swung at the wall")));
                at_person(&mut s);
                s.push(Step::Wait(40));
                s.push(push(vec![Act::Press(0), Act::Release(0)]));
                s.push(Step::Wait(15));
                s.push(level(1.0));
                s.push(Step::Wait(1));
                s.push(Step::Shot(format!("fp_{key}_swing")));
                s.push(level(4.0));
                s.push(Step::Wait(60));
                s.push(report(format!("{key}: {} at a person", if a.kind == Kind::Blade { "stab" } else { "blow" })));
                if a.kind == Kind::Blade || a.down.is_some() {
                    s.push(push(vec![Act::Press(2), Act::Release(2)]));
                    s.push(Step::Wait(50));
                    s.push(report(format!("{key}: {} at a person", if a.kind == Kind::Blade { "cut" } else { "down" })));
                }
            }
            Kind::Fists => {
                at_person(&mut s);
                s.push(Step::Wait(30));
                // A jab with the left, then a wound-up right.
                s.push(push(vec![Act::Press(0)]));
                s.push(Step::Wait(2));
                s.push(push(vec![Act::Release(0)]));
                s.push(Step::Wait(40));
                s.push(report("fists: a left jab at a person".into()));
                s.push(push(vec![Act::Press(2)]));
                s.push(Step::Wait(50));
                s.push(level(1.0));
                s.push(Step::Wait(1));
                s.push(Step::Shot("fp_fists_wound".into()));
                s.push(level(4.0));
                s.push(push(vec![Act::Release(2)]));
                s.push(Step::Wait(40));
                s.push(report("fists: a wound-up right at a person".into()));
            }
            Kind::Grab => {
                at_person(&mut s);
                s.push(Step::Wait(4));
                s.push(push(vec![Act::Press(0)]));
                // Held, and drawn back a step: walked back two metres while holding on.
                s.push(Step::Wait(30));
                s.push(stand(0.75, 2.2 - near - 2.0, [0.75, 1.0, 2.2], 1.65));
                s.push(Step::Wait(60));
                s.push(level(1.0));
                s.push(Step::Wait(1));
                s.push(Step::Shot("fp_hands_holding".into()));
                s.push(level(4.0));
                s.push(push(vec![Act::Release(0)]));
                s.push(Step::Wait(20));
                s.push(report("hands: taking hold of a person and pulling".into()));
            }
            Kind::Throw => {
                s.push(stand(0.0, -4.0, [11.0, 1.4, -4.0], 1.65));
                s.push(Step::Wait(4));
                s.push(push(vec![Act::Press(0), Act::Release(0)]));
                s.push(Step::Wait(50));
                s.push(report("throw: at the wall".into()));
                s.push(push(vec![Act::Press(2), Act::Release(2)]));
                at_person(&mut s);
                s.push(Step::Wait(4));
                s.push(push(vec![Act::Press(0), Act::Release(0)]));
                s.push(Step::Wait(50));
                s.push(report("throw: the next thing, at a person".into()));
            }
            Kind::Grenade => {
                // Rolled (the right button) toward the line-up from 5 m, and waited for.
                at_person(&mut s);
                s.push(Step::Wait(4));
                s.push(push(vec![Act::Press(2), Act::Release(2)]));
                s.push(Step::Wait(14));
                s.push(level(1.0));
                s.push(Step::Wait(1));
                s.push(Step::Shot("fp_grenade_lob".into()));
                s.push(level(4.0));
                s.push(Step::Wait(340));
                s.push(report("grenade: rolled at the line-up".into()));
            }
            Kind::Dress => {}
        }
    }
    s.push(Step::Do(Box::new(|w: &mut World| {
        let dir = w.resource::<crate::scenario::Out>().0.clone();
        crate::profiler::save_in(w, dir);
    })));
    s.push(Step::Wait(2));
    s
}

// --- the `viewmodel` scenario ----------------------------------------------------------------------------------------------
//
// Everything on the board in the hand, as the player sees it: at rest looking ahead, at the floor and at the ceiling, then
// in use (a gun fired and reloading, a blade's stab and cut, a tool's swing and its blow from overhead, the fists wound up
// and thrown, the grenade lobbed) at the young man in the line-up, a picture of each. Each gun is also fired at the east
// wall with the crosshair (`sight`) noted first: where the bullet hit, put on the screen, against where the crosshair was.
// `VIEWMODEL=pistol,r22` shows only those.

// The look turned up (positive) or down from level, radians.
fn pitch(p: f32) -> crate::scenario::Step {
    crate::scenario::Step::Do(Box::new(move |w: &mut World| {
        for mut pl in w.query::<&mut Player>().iter_mut(w) {
            pl.pitch = p;
        }
    }))
}

// A picture at full resolution (the frames between are drawn at a quarter, to be quicker on a software renderer).
fn picture(s: &mut Vec<crate::scenario::Step>, name: String) {
    use crate::scenario::Step;
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = 1.0)));
    // (The image is made its new size a frame or two after it is asked for.)
    s.push(Step::Wait(3));
    s.push(Step::Shot(name));
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = 4.0)));
}

pub fn viewmodel() -> Vec<crate::scenario::Step> {
    use crate::scenario::Step;
    let mut s = Vec::new();
    let only: Option<Vec<String>> = std::env::var("VIEWMODEL").ok().map(|v| v.split(',').map(String::from).collect());
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = 4.0)));
    for a in ARMS.iter().filter(|a| only.as_ref().is_none_or(|o| o.iter().any(|k| k == a.key))) {
        let key = a.key;
        if held(key).is_none() && a.kind != Kind::Fists {
            continue;
        }
        s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::take(w, key))));
        s.push(Step::Do(Box::new(|w: &mut World| {
            use bevy::ecs::system::RunSystemOnce;
            let _ = w.run_system_once(crate::sandbox::reset);
        })));
        // At rest: ahead, down at the floor, up at the ceiling (the hands given time to catch up with each turn).
        s.push(stand(0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
        for (name, p) in [("ahead", 0.0), ("down", -1.25), ("up", 1.1)] {
            s.push(pitch(p));
            s.push(Step::Wait(25));
            picture(&mut s, format!("vm_{key}_{name}"));
        }
        s.push(pitch(0.0));
        s.push(Step::Wait(30));
        // From the right and a little ahead, looking back at the hands; then from above.
        for (name, off) in [("side", Transform::from_xyz(0.55, -0.05, -0.3).looking_at(Vec3::new(0.05, -0.15, -0.35), Vec3::Y)),
                            ("above", Transform::from_xyz(0.05, 0.35, -0.3).looking_at(Vec3::new(0.05, -0.15, -0.32), Vec3::NEG_Z))] {
            s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Aside>().0 = Some(off))));
            picture(&mut s, format!("vm_{key}_{name}"));
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Aside>().0 = None)));
        }
        let near = match a.kind {
            Kind::Gun => 3.2,
            Kind::Grenade => 5.0,
            _ if matches!(key, "knife" | "hammer" | "fists") => 0.5,
            _ => 0.75,
        };
        let at_person = move |s: &mut Vec<Step>| s.push(stand(0.75, 2.2 - near, [0.75, 1.3, 2.2], 1.65));
        let frames = |secs: f32| (secs * 60.0).round() as u32;
        match a.kind {
            Kind::Gun => {
                // At the east wall: the crosshair, then the shot, and where it hit on the screen.
                s.push(stand(0.0, -4.0, [11.0, 1.4, -4.0], 1.65));
                s.push(Step::Wait(40));
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    let sight = w.resource::<Weapons>().sight;
                    w.resource_mut::<Weapons>().log.clear();
                    crate::scenario::log(w, json!({ "event": "sight", "what": key, "sight": sight.map(|v| v.to_array()) }));
                    crate::warm::press(w, 0);
                })));
                s.push(Step::Wait(2));
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    crate::warm::release(w, 0);
                    let hits: Vec<Vec3> = w.resource::<Weapons>().log.iter().filter(|h| h["hit"] == "wall")
                        .filter_map(|h| serde_json::from_value::<[f32; 3]>(h["point"].clone()).ok()).map(Vec3::from).collect();
                    let mut q = w.query_filtered::<(&Camera, &GlobalTransform), With<Player>>();
                    let Ok((camera, eye)) = q.single(w) else { return };
                    let on: Vec<[f32; 2]> = hits.iter().filter_map(|p| camera.world_to_ndc(eye, *p)).map(|p| [(p.x + 1.0) / 2.0, (1.0 - p.y) / 2.0]).collect();
                    crate::scenario::log(w, json!({ "event": "hit on the screen", "what": key, "at": on }));
                })));
                s.push(Step::Wait(40));
                at_person(&mut s);
                s.push(Step::Wait(40));
                s.push(Step::Do(Box::new(|w: &mut World| crate::warm::press(w, 0))));
                picture(&mut s, format!("vm_{key}_fire"));
                s.push(Step::Do(Box::new(|w: &mut World| crate::warm::release(w, 0))));
                s.push(Step::Wait(60));
                s.push(push(vec![Act::Reload]));
                s.push(Step::Wait(frames(a.gun.as_ref().unwrap().reload * 0.45)));
                picture(&mut s, format!("vm_{key}_reload"));
            }
            Kind::Blade | Kind::Blunt => {
                at_person(&mut s);
                s.push(Step::Wait(40));
                let first = if a.kind == Kind::Blade { ("stab", 0.35 * 0.3) } else { ("blow", a.swing * 0.42) };
                s.push(Step::Do(Box::new(|w: &mut World| {
                    crate::warm::press(w, 0);
                    crate::warm::release(w, 0);
                })));
                s.push(Step::Wait(frames(first.1)));
                picture(&mut s, format!("vm_{key}_{}", first.0));
                s.push(Step::Wait(40));
                if a.kind == Kind::Blade || a.down.is_some() {
                    let second = if a.kind == Kind::Blade { ("cut", a.swing * 0.4) } else { ("overhead", a.swing * 0.3) };
                    s.push(Step::Do(Box::new(|w: &mut World| {
                        crate::warm::press(w, 2);
                        crate::warm::release(w, 2);
                    })));
                    s.push(Step::Wait(frames(second.1)));
                    picture(&mut s, format!("vm_{key}_{}", second.0));
                    s.push(Step::Wait(40));
                }
            }
            Kind::Fists => {
                at_person(&mut s);
                s.push(Step::Wait(30));
                s.push(Step::Do(Box::new(|w: &mut World| crate::warm::press(w, 2))));
                s.push(Step::Wait(50));
                picture(&mut s, "vm_fists_wound".into());
                s.push(Step::Do(Box::new(|w: &mut World| crate::warm::release(w, 2))));
                s.push(Step::Wait(5));
                picture(&mut s, "vm_fists_punch".into());
                s.push(Step::Wait(40));
            }
            Kind::Grenade => {
                at_person(&mut s);
                s.push(Step::Wait(30));
                s.push(Step::Do(Box::new(|w: &mut World| {
                    crate::warm::press(w, 2);
                    crate::warm::release(w, 2);
                })));
                s.push(Step::Wait(12));
                picture(&mut s, "vm_grenade_lob".into());
                // (Its fuse burnt down before the next is taken up.)
                s.push(Step::Wait(340));
            }
            _ => {}
        }
        s.push(report(format!("{key}: in use")));
    }
    // Last, as it takes the sleeves off: what the arms cost a frame, all of it (the game's code, the render thread, the
    // drawing), by the wall clock: the empty hands (no arms drawn) against the fists up (both arms in the guard, nothing
    // else), looking at the line-up, twice over. (On a machine shared with other work it is lost in the noise.)
    if only.as_ref().is_none_or(|o| o.iter().any(|k| k == "cost")) {
        s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = 1.0)));
        s.push(stand(0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
        // Then the fists with what each part of the arms adds taken away in turn: their shadows, then the sleeves.
        for (k, key) in ["hands", "fists", "hands", "fists", "fists", "fists"].into_iter().enumerate() {
            // (The wall clock: the scenario's own clock goes a sixtieth of a second a frame whatever the frame took.)
            let from = std::sync::Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
            let to = from.clone();
            s.push(Step::Do(Box::new(move |w: &mut World| {
                crate::warm::take(w, key);
                let Some(roots) = w.get_resource::<crate::hands::Arms>().map(|a| [a.r.root, a.l.root]) else { return };
                let mut stack = roots.to_vec();
                let mut parts = Vec::new();
                while let Some(e) = stack.pop() {
                    stack.extend(w.get::<Children>(e).into_iter().flat_map(|c| c.iter()));
                    parts.push((e, w.get::<Name>(e).map_or(String::new(), |n| n.to_string())));
                }
                for (e, name) in parts {
                    if k >= 4 {
                        w.entity_mut(e).insert(bevy::light::NotShadowCaster);
                    }
                    if k >= 5 && name == "sleeve" {
                        w.entity_mut(e).insert(Visibility::Hidden);
                    }
                }
            })));
            s.push(Step::Wait(20));
            s.push(Step::Do(Box::new(move |_: &mut World| *from.lock().unwrap() = std::time::Instant::now())));
            s.push(Step::Wait(120));
            s.push(Step::Do(Box::new(move |w: &mut World| {
                let ms = to.lock().unwrap().elapsed().as_secs_f64() * 1000.0 / 120.0;
                let what = ["the empty hands", "the fists", "the empty hands", "the fists", "the fists, casting no shadow", "the fists, no shadow, no sleeves"][k];
                crate::scenario::log(w, json!({ "event": "cost", "what": what, "ms_a_frame": ms }));
            })));
        }
    }
    s.push(Step::Do(Box::new(|w: &mut World| {
        let dir = w.resource::<crate::scenario::Out>().0.clone();
        crate::profiler::save_in(w, dir);
    })));
    s.push(Step::Wait(2));
    s
}

// --- the `blasts` scenario ----------------------------------------------------------------------------------------------
//
// The shotgun's cost (the TS spent 110 to 360 ms of JS on one blast): fired into a person with the muzzle 0.35 m off (the
// charge still one mass) and 1.75 m off (nine pellets), and along the line-up from its end the same, so that what goes
// through one goes on into the next. Each blast's own time (`fire`'s "ms") and the hits into the log; with --profile, the
// "weapons" row of the profiler holds the blast's whole frame. Then the same with a stab and a blow from just over a head:
// the eye looking past the top of it, what is in the hand going where it goes.
pub fn blasts() -> Vec<crate::scenario::Step> {
    use crate::scenario::Step;
    let reset = || Step::Do(Box::new(|w: &mut World| {
        use bevy::ecs::system::RunSystemOnce;
        let _ = w.run_system_once(crate::sandbox::reset);
    }));
    let mut s = vec![Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "shotgun"))), Step::Wait(30)];
    // (who, the part, how far; or None: from the line-up's end, along it, this far from the first)
    // (Metres from the eye: the shotgun's muzzle is some 1.25 m ahead of it, so at 1.6 m the charge goes in as one, at 3 m
    // the pellets have parted.)
    let blasts: [(&str, Option<(usize, &str)>, f32); 4] = [
        ("a person, the muzzle 0.35 m off", Some((1, "chest")), 1.6),
        ("a person, the muzzle 1.75 m off", Some((2, "belly")), 3.0),
        ("the line-up from its end, the muzzle 1.75 m off", None, 3.0),
        ("the line-up from its end, the muzzle 0.35 m off", None, 1.6),
    ];
    for (i, (what, at, far)) in blasts.into_iter().enumerate() {
        s.push(reset());
        s.push(Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "shotgun"))));
        s.push(Step::Wait(60));
        match at {
            Some((n, part)) => s.push(Step::Do(Box::new(move |w: &mut World| {
                crate::warm::aim(w, n, part, far);
            }))),
            // The barrel on the line through the chests of the last two (the hooded man's, the young man's), the eye
            // `far` back from the last along it: through him and on into the next. (The barrel is held off the eye's
            // line, some 9 cm right and 6 up of it: side on and close, a look at his chest put the shot beside him; and
            // a fixed point down the room left the line beside him or not as he stood.)
            None => s.push(Step::Do(Box::new(move |w: &mut World| {
                let chest = |w: &mut World, n| crate::warm::aim(w, n, "chest", 0.0).map(|(_, at)| at);
                let (Some(end), Some(next)) = (chest(w, 3), chest(w, 2)) else { return };
                let muzzle = {
                    let hand = w.resource::<Hand>();
                    hand.anchors.get("shotgun").map_or(Vec3::new(0.0, 0.0, -1.25), |a| hand.local.transform_point(a.tip))
                };
                let along = (next - end).normalize();
                let look = Transform::default().looking_to(along, Vec3::Y);
                let eye = end - along * far - look.rotation * Vec3::new(muzzle.x, muzzle.y, 0.0);
                w.resource_scope(|w, map: Mut<crate::map::Map>| {
                    let ground = map.ground(eye.x, eye.z, f32::INFINITY);
                    for mut p in w.query::<&mut Player>().iter_mut(w) {
                        p.spawn(&map, eye.x, eye.z, Some(eye + along), eye.y - ground);
                    }
                });
            }))),
        }
        s.push(Step::Wait(30));
        s.push(Step::Do(Box::new(|w: &mut World| {
            w.resource_mut::<Weapons>().log.clear();
            crate::warm::press(w, 0);
        })));
        s.push(Step::Wait(2));
        s.push(Step::Shot(format!("blast_{i}")));
        s.push(Step::Do(Box::new(|w: &mut World| crate::warm::release(w, 0))));
        s.push(Step::Wait(30));
        s.push(report(format!("shotgun into {what}")));
    }
    // Over a head: the eye 6 cm over the top of the young man's, from 0.5 m.
    for key in ["knife", "bat"] {
        s.push(reset());
        s.push(Step::Wait(60));
        s.push(Step::Do(Box::new(move |w: &mut World| {
            crate::warm::take(w, key);
            let Some((who, head)) = crate::warm::aim(w, 2, "head", 0.5) else { return };
            // The top of the head: the scalp, straight down onto it from over the neck. (Its segment's far end is some 20
            // cm under it: looking 6 cm over that was looking them in the eye.)
            let top = crate::npc::with(w, who, |n| {
                let skin = n.surface(head + Vec3::Y * 0.6, Vec3::NEG_Y, 0.6, false).into_iter().find(|h| h.kind == crate::npc::Kind::Skin);
                skin.map(|c| c.point.y)
            }).flatten().unwrap_or(head.y + 0.25);
            w.resource_scope(|w, map: Mut<crate::map::Map>| {
                for mut p in w.query::<&mut Player>().iter_mut(w) {
                    p.spawn(&map, head.x, head.z + 0.5, Some(Vec3::new(head.x, top + 0.06, head.z)), 1.65);
                }
            });
            crate::scenario::log(w, json!({ "event": "over a head", "what": key, "aimed_over_by": 0.06, "top": top, "neck": head.to_array() }));
        })));
        s.push(Step::Wait(40));
        s.push(Step::Do(Box::new(|w: &mut World| {
            w.resource_mut::<Weapons>().log.clear();
            crate::warm::press(w, 0);
            crate::warm::release(w, 0);
        })));
        s.push(Step::Wait(if key == "knife" { 6 } else { 14 }));
        s.push(Step::Shot(format!("over_{key}")));
        s.push(Step::Wait(40));
        s.push(report(format!("{key}: swung with the eye over a head")));
    }
    s.push(Step::Do(Box::new(|w: &mut World| {
        let dir = w.resource::<crate::scenario::Out>().0.clone();
        crate::profiler::save_in(w, dir);
    })));
    s.push(Step::Wait(2));
    s
}
