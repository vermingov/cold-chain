// Blood out of a body: drops and streams in the air, and what they leave where they land (src/sandbox/blood.ts).
//
// A drop is a point with a speed and a size, falling under gravity and slowed by the air as much as its size makes it
// (a tenth of a millimetre of mist stops within a hand's breadth; a dripped drop falls nearly freely), drawn as a bead
// stretched along the way it is going. An open artery throws a stream: a rope of blood leaving the wound as fast as the
// pressure behind it pushes it (Bernoulli), surging with each beat, arcing under gravity, and breaking into drops some
// way out as streams do (Plateau-Rayleigh).
//
// Where a drop lands it leaves a stain as wide as its speed and size spread it, round if it came straight down and long
// (width over length the sine of the angle it came in at) if it came slantwise, its rim thrown out into spines and
// droplets if it came hard. Big drops on a wall run down it. On the floor, blood gathers into pools (floor.rs); on a
// person, it soaks into their clothes (soak.rs) or lies on and runs down their skin (film.rs, runs.rs: handed over as
// medicine's `Blot` and `Runs`). Bodies lying in a pool take it up; a body dragged leaves a smear; a foot that stepped
// in it leaves prints, fewer and fainter as it goes.
//
// What medicine says comes out of a person (`Happened`: Spray, Stream, Soak, Spatter) is taken here once a frame. The
// drops are a fixed pool, drawn by a fixed pool of entities that Bevy instances (one draw for all of them); the marks
// on the room are quads in twenty meshes of four hundred, each written again only when one of its marks changes.

use std::collections::HashMap;
use std::time::Instant;

use bevy::asset::RenderAssetUsages;
use bevy::light::NotShadowCaster;
use bevy::math::Affine3A;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, Extent3d, TextureDimension, TextureFormat};
use bevy::camera::visibility::NoFrustumCulling;
use bevy::shader::ShaderRef;

use crate::behaviour::{Behaviour, State};
use crate::floor::Floor;
use crate::fluid::{across, drag, gauss, noise2, splashes, spreads, volume, DRIP};
use crate::map::{Map, HALL};
use crate::npc::{Crossing, Happened, Hurt, Kind, Npc};
use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::rng::Rng;
use crate::soak::{bone_worlds, Soak};
use crate::vitals::{Dice, Vitals};

const MOST: usize = 3000; // drops in the air at once
const ROPES: usize = 600; // pieces of streams drawn at once
const BEADS: usize = 400; // beads on skin drawn at once (runs.rs)
const SPLATS: usize = 8000; // marks on the room before the oldest go
const CHUNK: usize = 400; // marks to a mesh
const TILES: [usize; 2] = [4, 5]; // the splash sheet: columns, rows
const DRIES: f32 = 300.0; // seconds for a stain on concrete to go from wet red to dried brown
const WET: [f32; 3] = [1.0, 1.0, 1.0];
const DRY: [f32; 3] = [0.42, 0.3, 0.26];
const FREE: f32 = 0.12; // seconds a drop flies before it can land back on a body (it left from one)
const BREAKS: f32 = 0.25; // seconds a stream holds together before it breaks into drops
const GATHERS: f32 = 0.12; // ml of drops landing in one place before they count as a pool there
const LOOKS: i32 = 16; // places on a body found for drops a frame at most (the dear part); the rest next frame

// A stream: its points as let go, each flying as a drop does; consecutive points still joined are drawn as one rope.
#[derive(Default)]
struct Stream {
    p: Vec<Vec3>,
    v: Vec<Vec3>,
    ml: Vec<f32>,
    d: Vec<f32>,
    age: Vec<f32>,
    life: Vec<f32>,
    fed: f32,
    // The aim off the skin's normal, a bleed's own (npc.ts `_aims`: a random half-box, kept for the bleed).
    aim: Vec3,
}

// A mark on the room: tile `kind` of the splash sheet, its X and Y axes (scaled), facing out along `n` from `at`.
#[derive(Clone, Copy, Default)]
struct Mark {
    kind: u8,
    at: Vec3,
    x: Vec3,
    y: Vec3,
    n: Vec3,
    born: f32,
    dry: f32,
}

struct WallRun {
    kind: u8,
    slot: usize,
    at: Vec3,
    normal: Vec3,
    wide: f32,
    length: f32,
    reach: f32,
}

#[derive(Clone, Copy)]
struct Foot {
    x: f32,
    z: f32,
    carried: f32,
    walked: f32,
    left: bool,
}

// Each person this frame for the drops: a box round them, so that only drops near somebody are tested against their
// body, and each of their segments as a capsule (its ends, how thick, and the bone it leads).
struct Crowd {
    who: Entity,
    caps: Vec<(Vec3, Vec3, f32, usize)>,
    lo: Vec3,
    hi: Vec3,
}

#[derive(Resource)]
pub struct Blood {
    // The drops in the air.
    p: Vec<Vec3>,
    v: Vec<Vec3>,
    d: Vec<f32>,
    ml: Vec<f32>,
    age: Vec<f32>,
    streams: HashMap<(Entity, u32), Stream>,
    marks: Vec<Mark>,
    next: usize,
    changed: Vec<bool>,
    wall_runs: Vec<WallRun>,
    gathering: HashMap<i64, f32>,
    wet_since: HashMap<i64, f32>,
    tops: HashMap<i64, f32>,
    // Blood for the floor from callers without it (runs.rs, dismember.rs): (where, ml, poured).
    to_floor: Vec<(Vec3, f32, bool)>,
    beads: Vec<Affine3A>,
    crowd: Vec<Crowd>,
    contact: HashMap<(Entity, usize), Vec3>,
    lain: HashMap<(Entity, usize), (Option<Crossing>, Vec3)>,
    foot: Option<Foot>,
    clock: f32,
    dried: f32,
    touched: f32,
    looks: i32,
    rng: Rng,
    // What the frame cost on the CPU (seconds): taking medicine's blood, the drops and the rest, the clothes (soak.rs),
    // drawing.
    pub cost: [f32; 4],
}

impl Blood {
    fn new() -> Blood {
        Blood {
            p: Vec::with_capacity(MOST),
            v: Vec::with_capacity(MOST),
            d: Vec::with_capacity(MOST),
            ml: Vec::with_capacity(MOST),
            age: Vec::with_capacity(MOST),
            streams: HashMap::new(),
            marks: vec![Mark::default(); SPLATS],
            next: 0,
            changed: vec![false; SPLATS / CHUNK],
            wall_runs: Vec::new(),
            gathering: HashMap::new(),
            wet_since: HashMap::new(),
            tops: HashMap::new(),
            to_floor: Vec::new(),
            beads: Vec::with_capacity(BEADS),
            crowd: Vec::new(),
            contact: HashMap::new(),
            lain: HashMap::new(),
            foot: None,
            clock: 0.0,
            dried: 0.0,
            touched: 0.0,
            looks: LOOKS,
            rng: Rng::new(0x5eed_b100),
            cost: [0.0; 4],
        }
    }

    fn rand(&mut self) -> f32 {
        self.rng.next()
    }

    pub fn drops(&self) -> usize {
        self.p.len()
    }

    pub fn streams(&self) -> usize {
        self.streams.len()
    }

    // --- blood into the air ------------------------------------------------------------------------------------------

    // Drops thrown out from `at` along `dir` (unit) at about `speed` m/s, spread by `cone` (radians); `ml` the blood in
    // all; `big` the drops' size against a spatter drop's 1.6 mm (0.3 is a gunshot's mist). Drops come in all sizes about
    // that (log-normally); there are as many as the blood makes, each drawn drop standing for several if there are too
    // many to draw.
    pub fn spray(&mut self, at: Vec3, dir: Vec3, speed: f32, ml: f32, cone: f32, big: f32) {
        let median = 0.0016 * big;
        let count = (ml / volume(median * 1.4)).round().clamp(1.0, 150.0) as usize;
        let each = ml / count as f32;
        let side = if dir.y.abs() < 0.9 { dir.cross(Vec3::Y) } else { dir.cross(Vec3::X) }.normalize();
        let up = side.cross(dir);
        for _ in 0..count {
            if self.p.len() >= MOST {
                break;
            }
            // Smaller drops are thrown faster and wider; within the cone, most go near its middle.
            let g = gauss(self.rand(), self.rand());
            let d = median * (g * 0.45).exp();
            let s = speed * (0.6 + self.rand() * 0.6) * (median / d).powf(0.25);
            let a = cone * self.rand().sqrt() * (median / d).powf(0.3);
            let t = self.rand() * std::f32::consts::TAU;
            let v = (dir * a.cos() + (side * t.cos() + up * t.sin()) * a.sin()) * s;
            self.add(at, v, d, each, 0.0);
        }
    }

    // One drop of `ml`, `d` across, let go at `at`: what falls from a chin, a cuff, a shirt-tail.
    pub fn drip(&mut self, at: Vec3, ml: f32, d: f32) {
        let v = Vec3::new((self.rand() - 0.5) * 0.02, -0.05, (self.rand() - 0.5) * 0.02);
        self.add(at, v, d, ml, FREE);
    }

    fn add(&mut self, at: Vec3, v: Vec3, d: f32, ml: f32, age: f32) {
        if self.p.len() >= MOST {
            return;
        }
        self.p.push(at);
        self.v.push(v);
        self.d.push(d);
        self.ml.push(ml);
        self.age.push(age);
    }

    // An open artery (or a vomit) this frame: `ml` of blood leaving `at` along `dir` at `speed` m/s, as a stream `r`
    // metres across. `key` is the bleed (whose and which), so that one stream is one rope from beat to beat.
    pub fn stream(&mut self, key: (Entity, u32), at: Vec3, dir: Vec3, speed: f32, ml: f32, r: f32, dt: f32) {
        let clock = self.clock;
        if !self.streams.contains_key(&key) {
            let aim = Vec3::new(self.rand() - 0.5, self.rand() - 0.5, self.rand() - 0.5) * 0.5;
            self.streams.insert(key, Stream { aim, ..default() });
        }
        let jitter: [f32; 6] = std::array::from_fn(|_| self.rand());
        let s = self.streams.get_mut(&key).unwrap();
        s.fed = clock;
        // Several points a frame, as if let go through it, so the rope is smooth however slow the frame.
        let pieces = ((speed * dt / 0.012).ceil() as usize).clamp(1, 6);
        for k in (0..pieces).rev() {
            if s.p.len() >= 90 {
                break;
            }
            let t = k as f32 / pieces as f32 * dt;
            let v = dir * speed;
            s.p.push(at + v * t + Vec3::new(0.0, -4.9 * t * t, 0.0));
            s.v.push(v + Vec3::new(0.0, -9.81 * t, 0.0));
            s.ml.push(ml / pieces as f32);
            s.d.push(r * 2.0);
            s.age.push(t);
            // Thicker streams hold together longer.
            s.life.push(BREAKS * (0.6 + jitter[k] * 0.8) * (r / 0.0015).powf(1.5).clamp(0.5, 2.0));
        }
    }

    // The aim a bleed's stream keeps off the skin's normal.
    fn aim(&mut self, key: (Entity, u32)) -> Vec3 {
        if let Some(s) = self.streams.get(&key) {
            return s.aim;
        }
        let aim = Vec3::new(self.rand() - 0.5, self.rand() - 0.5, self.rand() - 0.5) * 0.5;
        self.streams.insert(key, Stream { aim, fed: self.clock, ..default() });
        aim
    }

    // --- blood onto the floor ----------------------------------------------------------------------------------------

    // Blood leaving a wound at `at` at `rate` litres a second for `dt`, with nothing on the body to take it: it falls
    // from there, or goes into the floor if it is at the floor.
    pub fn run(&mut self, at: Vec3, rate: f32, dt: f32) {
        let ml = rate * dt * 1000.0;
        if ml <= 0.0 {
            return;
        }
        if at.y < 0.04 {
            self.to_floor.push((at, ml, false));
            return;
        }
        // What runs off something gathers into drops and falls one at a time.
        let key = -(((at.x * 50.0).round() as i64) * 7919 + (at.z * 50.0).round() as i64) - 1;
        let have = self.gathering.get(&key).copied().unwrap_or(0.0) + ml;
        if have >= DRIP {
            self.drip(at, have, across(have));
            self.gathering.remove(&key);
        } else {
            self.gathering.insert(key, have);
        }
    }

    // A pool on the floor under `at` takes `litres` more.
    pub fn fill(&mut self, at: Vec3, litres: f32) {
        self.to_floor.push((at, litres * 1000.0, false));
    }

    // A bead of blood on skin this frame (runs.rs): at `at`, the skin facing `normal`, `r` across and `h` high, running
    // along `along` (stretched that way a little), hanging (`hang`, a drop about to fall: drawn pulled down).
    pub fn bead(&mut self, at: Vec3, normal: Vec3, along: Vec3, r: f32, h: f32, hang: f32) {
        if self.beads.len() >= BEADS {
            return;
        }
        let across = normal.cross(along).normalize();
        let way = across.cross(normal).normalize();
        let mut centre = at + normal * (h * 0.25);
        if hang > 0.0 {
            centre.y -= hang * 0.5;
        }
        // The bead's own axes: across it, out of the skin, along its way (a sphere squashed onto the skin).
        let out = if hang > 0.0 { normal + Vec3::new(0.0, -hang / h.max(1e-4), 0.0) } else { normal };
        self.beads.push(Affine3A::from_cols((across * r).into(), (out * h).into(), (way * r * 1.3).into(), centre.into()));
    }

    // --- where it lands ----------------------------------------------------------------------------------------------

    // Whether a drop at `at` has met the floor, a wall, the ceiling or something standing in the hall; if it has, what
    // it leaves there.
    fn lands(&mut self, at: &mut Vec3, vel: Vec3, d: f32, ml: f32, map: &Map, floor: &mut Floor) -> bool {
        let (w, depth, h) = (HALL.x, HALL.z, HALL.height);
        let normal = if let Some(n) = map.land(at, vel) {
            n
        } else if at.y <= 0.0 {
            at.y = 0.0;
            Vec3::Y
        } else if at.x.abs() >= w {
            at.x = at.x.signum() * (w - 0.002);
            Vec3::new(-at.x.signum(), 0.0, 0.0)
        } else if at.z.abs() >= depth {
            at.z = at.z.signum() * (depth - 0.002);
            Vec3::new(0.0, 0.0, -at.z.signum())
        } else if at.y >= h {
            at.y = h - 0.002;
            Vec3::NEG_Y
        } else {
            return false;
        };
        self.splash(*at, vel, normal, d, ml, map, floor);
        true
    }

    // The mark a drop `d` across leaves on the room: round if it came straight down, long and tailed the more slantwise
    // it came (width over length the sine of its angle), its rim broken into spines if it came hard enough.
    #[allow(clippy::too_many_arguments)]
    fn splash(&mut self, at: Vec3, vel: Vec3, normal: Vec3, d: f32, ml: f32, map: &Map, floor: &mut Floor) {
        let speed = vel.length();
        let on_floor = normal.y > 0.9 && at.y < 0.01;
        // Into blood still liquid: it merges with it and leaves no mark of its own, the pool only gaining what it brought.
        // Hard enough (We over 400) it throws a crown whose satellite droplets land round about, more the harder and the
        // more drops have fallen there (Boos et al. 2019, drip patterns; dev/research/stab-wounds.md sec. 2). What goes
        // into the satellites, their size and speed are estimates: a twentieth of it, half-millimetre droplets at a third
        // of the speed it came in at, thrown up and out. A dried pool is a floor like any other: the drop leaves a stain.
        // A drop's own stain on the floor stays liquid a while too, so the next drop into it merges with it the same way.
        // (shortcut: a stain is the 3 cm cell its drops gather in, wet for DRIES; finer if drops a centimetre apart
        // should each leave a mark.)
        let key = if on_floor { (at.x / 0.03).floor() as i64 * 7919 + (at.z / 0.03).floor() as i64 } else { 0 };
        let stain = on_floor && self.gathering.contains_key(&key) && self.clock - self.wet_since.get(&key).copied().unwrap_or(f32::NEG_INFINITY) < DRIES;
        if on_floor && (stain || floor.liquid(at.x, at.z, 0.0004)) {
            let thrown = if splashes(d, speed) { 0.05 } else { 0.0 };
            if stain {
                self.gather(key, at, ml * (1.0 - thrown), map, floor);
            } else {
                floor.pour(at.x, at.z, ml * (1.0 - thrown), map);
            }
            if thrown > 0.0 {
                self.spray(at + Vec3::Y * 0.002, Vec3::Y, speed * 0.33, ml * thrown, 1.0, 0.3);
            }
            return;
        }
        if normal.y > 0.9 && !on_floor && self.top(at, normal, ml) {
            return;
        }
        let into = if speed > 1e-4 { (-vel.dot(normal) / speed).max(0.05) } else { 1.0 };
        let kind = if into < 0.72 { 8 + (self.rand() * 4.0) as u8 } else { (if splashes(d, speed) { 4 } else { 0 }) + (self.rand() * 4.0) as u8 };
        // The tiles' blots fill about 40% of the tile: the quad is as much bigger than the stain.
        let wide = d * spreads(d, speed * into.sqrt()) * if kind < 8 { 2.6 } else { 2.2 } * (0.85 + self.rand() * 0.3);
        let long = if kind >= 8 { (1.0 / into).min(5.0) } else { 1.0 };
        let along = vel - normal * vel.dot(normal);
        let way = if along.length_squared() > 1e-8 { along.normalize() } else { normal.cross(if normal.y.abs() > 0.9 { Vec3::X } else { Vec3::Y }).normalize() };
        let side = normal.cross(way).normalize();
        self.mark(kind, way * wide * long, side * wide, normal, at);
        // A drawn drop that stands for several real ones leaves their marks too, close about it.
        let more = ((ml / volume(d)).floor() as i32 - 1).min(3);
        for _ in 0..more {
            let off = way * ((self.rand() - 0.3) * 0.08) + side * ((self.rand() - 0.5) * 0.05);
            let w2 = wide * (0.5 + self.rand() * 0.6);
            self.mark(kind, way * w2 * long, side * w2, normal, at + off);
        }
        if on_floor {
            self.wet_since.insert(key, self.clock);
            self.gather(key, at, ml, map, floor);
        } else if normal.y.abs() < 0.3 && ml > 0.015 {
            // On a wall a big enough drop runs down it, until what it leaves behind has used it up.
            self.wall_run(at, normal, (d * 0.8).max(0.002), (ml / 0.003 / 100.0).min(0.6));
        }
    }

    // Drops landing on the same place of the floor gather; enough of them is a pool.
    fn gather(&mut self, key: i64, at: Vec3, ml: f32, map: &Map, floor: &mut Floor) {
        let have = self.gathering.get(&key).copied().unwrap_or(0.0) + ml;
        if have > GATHERS {
            floor.add(at.x, at.z, have, map);
            self.gathering.remove(&key);
            self.wet_since.remove(&key);
        } else {
            self.gathering.insert(key, have);
        }
    }

    // Blood landing on the top of something above the floor (a ledge, a crate), which has no pools of its own
    // (shortcut: only the floor flows, floor.rs; a second floor per raised top if pools up there are wanted). Drops
    // landing within 3 cm of each other gather there as one stain: the first leaves its own mark, and the stain is drawn
    // again, round and as wide as a pool of what has gathered, each time that has doubled (so a body bleeding on a ledge
    // does not use up the room's marks a drop at a time). True if it was taken.
    fn top(&mut self, at: Vec3, normal: Vec3, ml: f32) -> bool {
        let key = (at.x / 0.03).floor() as i64 * 7919 + (at.z / 0.03).floor() as i64 * 31 + (at.y * 20.0).round() as i64;
        let was = self.tops.get(&key).copied().unwrap_or(0.0);
        let have = was + ml;
        self.tops.insert(key, have);
        if was == 0.0 {
            return false;
        }
        if (have / GATHERS).log2().floor() > (was / GATHERS).log2().floor() && have > GATHERS {
            // Spread 2.5 mm deep, as on the floor (floor.rs STANDS), on a quad as much bigger than its blot as a splash's.
            let wide = 2.0 * (have * 1e-6 / (std::f32::consts::PI * 0.0025)).sqrt() * 2.6;
            let way = normal.cross(Vec3::X).normalize();
            let side = normal.cross(way).normalize();
            let kind = (self.rand() * 4.0) as u8;
            self.mark(kind, way * wide, side * wide, normal, at);
        }
        true
    }

    // One mark: tile `kind`, its X axis `x` and Y axis `y` (scaled), facing out of a surface with `normal`, at `at`.
    fn mark(&mut self, kind: u8, x: Vec3, y: Vec3, normal: Vec3, at: Vec3) -> usize {
        let slot = self.next;
        self.marks[slot] = Mark { kind, at: at + normal * 0.001, x, y, n: normal, born: self.clock, dry: 0.0 };
        self.changed[slot / CHUNK] = true;
        self.next = (slot + 1) % SPLATS;
        slot
    }

    fn wall_run(&mut self, at: Vec3, normal: Vec3, wide: f32, reach: f32) {
        if reach < 0.01 || self.wall_runs.len() > 80 {
            return;
        }
        let kind = 12 + (self.rand() * 4.0) as u8;
        let mut run = WallRun { kind, slot: 0, at, normal, wide, length: 0.002, reach };
        run.slot = self.place(&run, None);
        self.wall_runs.push(run);
    }

    // The streak's tile has its start at the top and its bead at the bottom: the quad is drawn from the drop down.
    fn place(&mut self, run: &WallRun, slot: Option<usize>) -> usize {
        let across = Vec3::Y.cross(run.normal).normalize();
        let centre = run.at + Vec3::new(0.0, -run.length / 2.0 + run.wide, 0.0);
        let (x, y) = (across * run.wide * 3.0, Vec3::Y * (run.length + run.wide * 2.0));
        match slot {
            None => self.mark(run.kind, x, y, run.normal, centre),
            Some(s) => {
                let m = &mut self.marks[s];
                m.x = x;
                m.y = y;
                m.at = centre + run.normal * 0.0012;
                self.changed[s / CHUNK] = true;
                s
            }
        }
    }

    // Runs down walls lengthen at a couple of centimetres a second, slowing as they thin, until they stop.
    fn wall_runs(&mut self, dt: f32) {
        let mut runs = std::mem::take(&mut self.wall_runs);
        runs.retain_mut(|run| {
            let left = run.reach - run.length;
            run.length += left.min(dt * 0.04 * (left / 0.04 + 0.2).min(1.0));
            let slot = run.slot;
            self.place(run, Some(slot));
            run.reach - run.length > 0.001
        });
        self.wall_runs = runs;
    }

    // Blood on the room drying: every ten seconds each mark still drying is coloured by how long it has lain there.
    fn dry(&mut self) {
        if self.clock - self.dried < 10.0 {
            return;
        }
        self.dried = self.clock;
        for (i, m) in self.marks.iter_mut().enumerate() {
            if m.n == Vec3::ZERO || self.clock - m.born > DRIES + 10.0 {
                continue;
            }
            m.dry = ((self.clock - m.born) / DRIES).min(1.0);
            self.changed[i / CHUNK] = true;
        }
    }

    pub fn clear(&mut self) {
        self.p.clear();
        self.v.clear();
        self.d.clear();
        self.ml.clear();
        self.age.clear();
        self.streams.clear();
        self.wall_runs.clear();
        self.gathering.clear();
        self.wet_since.clear();
        self.tops.clear();
        self.to_floor.clear();
        self.marks.fill(Mark::default());
        self.changed.fill(true);
        self.next = 0;
        if let Some(f) = &mut self.foot {
            f.carried = 0.0;
        }
    }
}

// --- medicine's blood taken ------------------------------------------------------------------------------------------

// What came out of each person last frame (medicine's `Happened`), into the air and into their clothes: before it is
// forgotten (First), so that blood from a shot fired anywhere in the frame (a weapon, a scenario's step) is taken.
#[allow(clippy::type_complexity)]
fn take(time: Res<Time>, mut blood: ResMut<Blood>, mut people: Query<(Entity, &Hurt, Option<&mut Soak>, Option<&Ragdoll>)>) {
    let start = Instant::now();
    let dt = time.delta_secs().max(1e-4);
    for (who, hurt, mut soak, ragdoll) in &mut people {
        for h in &hurt.happened {
            match h {
                Happened::Spray { at, dir, speed, ml, spread, size } => blood.spray(*at, *dir, *speed, *ml, *spread, *size),
                Happened::Stream { bleed, at, dir, speed, ml, r } => {
                    let key = (who, bleed.map_or(u32::MAX, |b| b as u32));
                    let dir = if bleed.is_some() { (*dir + blood.aim(key)).normalize() } else { *dir };
                    blood.stream(key, *at, dir, *speed, *ml, *r, dt);
                }
                Happened::Soak { rest, ml } => {
                    if let Some(s) = soak.as_mut() {
                        s.add(*rest, *ml);
                    }
                }
                // Blood thrown out where a shot went in and where it came out (dev/research/gunshot-blood.md sec. 1). Back
                // out of the way in, in earnest only from the head and from close: calves shot in the head with a 9 mm
                // from 10 cm or nearer threw 31 to 324 stains over half a millimetre (and more finer ones) over a
                // half-circle, most within half a metre, none past 1.2 m (Karger 1996); the jets left at 6 to 45 m/s from
                // 5 cm and further, up to 330 m/s at contact (Schyma 2021). Three hundred drops of half a millimetre is
                // about 0.02 ml. From the trunk at a distance next to none (DiMaio 1999, Betz: none on the hand in six
                // contact wounds of the chest), here a tenth of that. Out of the way out, forward with the bullet: more,
                // finer, and bits of tissue among it, all of it in the first instant, more the more energy the bullet
                // left in the body (nobody has measured those volumes: estimates). `range`: metres from the muzzle.
                Happened::Spatter { enter, dir, exit, energy, exited, range } => {
                    let power = (energy / 2000.0).min(1.0);
                    let head = ragdoll.is_some_and(|rd| rd.segs[rd.nearest(enter.point).0].def.name == "head");
                    let close = *range < 0.1;
                    let back = if head { 1.0 } else { 0.1 } * if close { 2.0 } else { 1.0 } * (0.02 + power * 0.03);
                    blood.spray(enter.point + enter.normal * 0.004, enter.normal, if close { 40.0 } else { 15.0 }, back, std::f32::consts::FRAC_PI_2, 0.3);
                    if let (true, Some(at)) = (*exited, exit) {
                        blood.spray(*at, *dir, 9.0 + power * 16.0, 0.5 + power * 2.5, 0.4, 0.4);
                        blood.spray(*at, *dir, 4.0 + power * 7.0, 0.2 + power * 1.5, 0.3, 2.0);
                    }
                }
                _ => {}
            }
        }
    }
    blood.cost[0] = start.elapsed().as_secs_f32();
}

// --- every frame -----------------------------------------------------------------------------------------------------

// Who is where, for the drops: each person's box and segments.
fn crowd(blood: &mut Blood, people: &Query<Person_, ()>) {
    let mut crowd = std::mem::take(&mut blood.crowd);
    let mut k = 0;
    for (who, _, _, _, _, _, ragdoll, _) in people.iter() {
        let Some(rd) = ragdoll else { continue };
        if crowd.len() <= k {
            crowd.push(Crowd { who, caps: Vec::new(), lo: Vec3::ZERO, hi: Vec3::ZERO });
        }
        let c = &mut crowd[k];
        k += 1;
        c.who = who;
        c.caps.clear();
        let (mut lo, mut hi) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for (i, s) in rd.segs.iter().enumerate() {
            let [a, b] = rd.segment_ends(i);
            c.caps.push((a, b, s.def.radius, s.def.bone));
            lo = lo.min(a);
            hi = hi.max(a);
        }
        c.lo = lo - Vec3::splat(0.3);
        c.hi = hi + Vec3::splat(0.3);
    }
    crowd.truncate(k);
    blood.crowd = crowd;
}

type Person_ = (Entity, &'static Person, &'static Transform, &'static mut Vitals, &'static mut Hurt, Option<&'static mut Soak>, Option<&'static Ragdoll>,
                Option<&'static Behaviour>);

// A drop at `at` that has reached somebody: taken by their skin or clothes, or not (false: it flies on). Their clothes
// drink it (soak.rs); on skin it is laid on and runs (handed to film.rs and runs.rs as medicine's Blot and Runs).
#[allow(clippy::too_many_arguments)]
fn onto(blood: &mut Blood, people: &mut Query<Person_, ()>, dice: &mut Dice, frame: u32, at: Vec3, vel: Vec3, d: f32, ml: f32,
        worlds: &mut Vec<Affine3A>) -> bool {
    for ci in 0..blood.crowd.len() {
        let c = &blood.crowd[ci];
        if at.cmplt(c.lo).any() || at.cmpgt(c.hi).any() {
            continue;
        }
        let (mut seg, mut near, mut off) = (None, 0.015, Vec3::ZERO);
        for &(a, b, r, bone) in &c.caps {
            let ab = b - a;
            let t = ((at - a).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
            let q = at - a - ab * t;
            let dist = q.length() - r;
            if dist < near {
                near = dist;
                seg = Some(bone);
                off = q;
            }
        }
        // (Going away from the segment's axis, it is not coming at the skin either: not worth finding the skin.)
        let Some(bone) = seg else { continue };
        if off.dot(vel) > 0.0 {
            continue;
        }
        blood.looks -= 1;
        if blood.looks < 0 {
            continue;
        }
        let who = c.who;
        let Ok((_, person, root, mut vitals, mut hurt, mut soak, _, _)) = people.get_mut(who) else { continue };
        bone_worlds(person, root, worlds);
        let m = worlds[bone];
        let rest = m.inverse().transform_point3(at);
        let traced = hurt.traced.clone();
        let npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice, frame };
        let Some(hit) = npc.nearest_rest(rest, 0.03) else { continue };
        // Only a drop coming at the skin or cloth lands on it. One going past (falling beside a leg, or away from the hem
        // it dripped from) goes on: taken back into the cloth, a drip dripped from it again and again.
        let facing = worlds[hit.owner].transform_vector3(hit.rest_normal).normalize();
        if facing.dot(vel) > -0.25 * vel.length() {
            continue;
        }
        if hit.kind == Kind::Cloth {
            if let Some(s) = soak.as_mut() {
                s.add(hit.rest, ml);
            }
        } else {
            // A spot as wide as it spread when it hit, as thick as what it holds over that.
            let r = d * spreads(d, vel.length()) / 2.0;
            let wet = (ml * 1000.0 / (std::f32::consts::PI * (r * 1000.0).powi(2))).min(0.5);
            if ml > 0.008 {
                hurt.happened.push(Happened::Runs { hit: hit.clone(), ml, from: None });
            }
            hurt.happened.push(Happened::Blot { hit, r, wet });
        }
        return true;
    }
    false
}

// The frame's blood: drops flown, streams flown and broken, runs down walls, what was sent to the floor, people lying
// in it, the player's feet, marks drying.
#[allow(clippy::too_many_arguments)]
fn update(time: Res<Time>, frames: Res<bevy::diagnostic::FrameCount>, mut blood: ResMut<Blood>, mut floor: ResMut<Floor>, map: Res<Map>,
          mut dice: ResMut<Dice>, mut people: Query<Person_, ()>, players: Query<&Player>, mut worlds: Local<Vec<Affine3A>>) {
    let start = Instant::now();
    let dt = time.delta_secs();
    let frame = frames.0;
    let b = &mut *blood;
    b.clock += dt;
    b.dry();
    b.touched += dt;
    let lying = b.touched > 0.15;
    if !b.p.is_empty() || !b.streams.is_empty() || lying {
        crowd(b, &people);
    }
    b.looks = LOOKS;
    for (at, ml, pour) in b.to_floor.drain(..) {
        if pour {
            floor.pour(at.x, at.z, ml, &map);
        } else {
            floor.add(at.x, at.z, ml, &map);
        }
    }
    // The drops.
    let mut live = 0;
    let n = b.p.len();
    for i in 0..n {
        let (d, ml) = (b.d[i], b.ml[i]);
        let mut v = b.v[i];
        let slow = (-drag(d, v.length()) * dt).exp();
        v = Vec3::new(v.x * slow, v.y * slow - 9.81 * dt, v.z * slow);
        let mut at = b.p[i] + v * dt;
        b.age[i] += dt;
        if b.age[i] > FREE && !b.crowd.is_empty() && onto(b, &mut people, &mut dice, frame, at, v, d, ml, &mut worlds) {
            continue;
        }
        if b.lands(&mut at, v, d, ml, &map, &mut floor) {
            continue;
        }
        b.p[live] = at;
        b.v[live] = v;
        b.d[live] = d;
        b.ml[live] = ml;
        b.age[live] = b.age[i];
        live += 1;
    }
    // (Drops added while flying the others, a crown thrown up, move down after those kept.)
    let added = b.p.len() - n;
    for k in 0..added {
        let (from, to) = (n + k, live + k);
        b.p[to] = b.p[from];
        b.v[to] = b.v[from];
        b.d[to] = b.d[from];
        b.ml[to] = b.ml[from];
        b.age[to] = b.age[from];
    }
    let keep = live + added;
    b.p.truncate(keep);
    b.v.truncate(keep);
    b.d.truncate(keep);
    b.ml.truncate(keep);
    b.age.truncate(keep);
    streams(b, dt, &mut people, &mut dice, frame, &map, &mut floor, &mut worlds);
    b.wall_runs(dt);
    if lying {
        let touched = b.touched;
        b.touched = 0.0;
        lie(b, touched, &mut people, &mut dice, frame, &map, &mut floor, &mut worlds);
    }
    if let Some(p) = players.iter().next() {
        feet(b, p, &map, &mut floor);
    }
    b.cost[1] = start.elapsed().as_secs_f32();
}


// The streams: each point flies as a drop does (the air slows a rope less than its drops); points that broke away, or
// met something, leave the stream.
#[allow(clippy::too_many_arguments)]
fn streams(b: &mut Blood, dt: f32, people: &mut Query<Person_, ()>, dice: &mut Dice, frame: u32, map: &Map, floor: &mut Floor,
           worlds: &mut Vec<Affine3A>) {
    let mut all = std::mem::take(&mut b.streams);
    for s in all.values_mut() {
        let mut kept = 0;
        for i in 0..s.p.len() {
            let mut v = s.v[i];
            let slow = (-drag(s.d[i], v.length()) * dt * 0.3).exp();
            v = v * slow + Vec3::new(0.0, -9.81 * dt, 0.0);
            let mut at = s.p[i] + v * dt;
            let (d, ml, age, life) = (s.d[i], s.ml[i], s.age[i] + dt, s.life[i]);
            if age > FREE && !b.crowd.is_empty() && onto(b, people, dice, frame, at, v, d, ml, worlds) {
                continue;
            }
            if b.lands(&mut at, v, d, ml, map, floor) {
                continue;
            }
            if age > life {
                // Broken: the rope pinches into drops a little wider than itself.
                b.add(at, v, (d * 1.6).min(0.006), ml, age);
                continue;
            }
            s.p[kept] = at;
            s.v[kept] = v;
            s.d[kept] = d;
            s.ml[kept] = ml;
            s.age[kept] = age;
            s.life[kept] = life;
            kept += 1;
        }
        s.p.truncate(kept);
        s.v.truncate(kept);
        s.d.truncate(kept);
        s.ml.truncate(kept);
        s.age.truncate(kept);
        s.life.truncate(kept);
    }
    let clock = b.clock;
    all.retain(|_, s| !s.p.is_empty() || clock - s.fed <= 1.0);
    b.streams = all;
}

// The skin or clothes of `who` nearest a world point on bone `bone` (within 3 cm), as a crossing.
#[allow(clippy::too_many_arguments)]
fn surface_at(people: &mut Query<Person_, ()>, dice: &mut Dice, frame: u32, who: Entity, at: Vec3, bone: usize, worlds: &mut Vec<Affine3A>) -> Option<Crossing> {
    let (_, person, root, mut vitals, mut hurt, _, _, _) = people.get_mut(who).ok()?;
    bone_worlds(person, root, worlds);
    let rest = worlds[bone].inverse().transform_point3(at);
    let traced = hurt.traced.clone();
    let npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice, frame };
    npc.nearest_rest(rest, 0.03)
}

// People lying on the floor: where they lie in blood they take it up (their clothes drink it, their skin is smeared with
// it), and where they are dragged over the floor they smear it on, from a pool they are pulled through or from their own
// bloody clothes.
#[allow(clippy::too_many_arguments)]
fn lie(b: &mut Blood, dt: f32, people: &mut Query<Person_, ()>, dice: &mut Dice, frame: u32, map: &Map, floor: &mut Floor, worlds: &mut Vec<Affine3A>) {
    let who_all: Vec<Entity> = b.crowd.iter().map(|c| c.who).collect();
    for who in who_all {
        let Ok((_, _, _, _, _, _, Some(rd), behaviour)) = people.get(who) else { continue };
        // (Standing, only the soles touch the floor, and shoes are not sponges.)
        if !rd.limp && behaviour.is_none_or(|bh| bh.state == State::Stand) {
            continue;
        }
        let segs: Vec<(usize, f32, Vec3, usize, f32, f32, bool)> = rd
            .segs
            .iter()
            .enumerate()
            .map(|(k, s)| (k, rd.lowest(k), s.now.translation, s.def.bone, s.def.radius, s.def.mass, s.def.name.contains("foot")))
            .collect();
        for (k, low, c, bone, radius, mass, foot) in segs {
            if foot {
                continue;
            }
            if low > 0.03 {
                b.contact.remove(&(who, k));
                continue;
            }
            let last = b.contact.insert((who, k), c);
            let deep = floor.depth(c.x, c.z);
            let point = Vec3::new(c.x, (low + 0.004).max(0.005), c.z);
            let moved = last.map_or(0.0, |l| (c.xz() - l.xz()).length());
            // Where on the body it touches the floor: looked for again only once it has moved a few centimetres.
            let mut hit = None;
            if deep > 0.0002 || (moved > 0.01 && moved < 0.5) {
                match b.lain.get(&(who, k)) {
                    Some((h, at)) if at.distance_squared(c) < 0.03 * 0.03 => hit = h.clone(),
                    _ => {
                        hit = surface_at(people, dice, frame, who, point, bone, worlds);
                        b.lain.insert((who, k), (hit.clone(), c));
                    }
                }
            }
            let Ok((_, _, _, _, mut hurt, mut soak, _, _)) = people.get_mut(who) else { continue };
            if deep > 0.0002 {
                let took = floor.take(c.x, c.z, 0.05, 2.5 * dt / 0.15);
                match &hit {
                    Some(h) if h.kind == Kind::Cloth => {
                        if let Some(s) = soak.as_mut() {
                            s.add(h.rest, took);
                        }
                    }
                    Some(h) => hurt.happened.push(Happened::Blot { hit: h.clone(), r: 0.025, wet: (took * 0.2).min(0.3) }),
                    None => {}
                }
            }
            let Some(last) = last else { continue };
            if moved < 0.01 || moved > 0.5 {
                continue;
            }
            // Dragged: what is under it is pushed along, and its own blood is wiped onto the floor.
            let pushed = if deep > 0.0003 { floor.take(last.x, last.z, 0.04, moved * 30.0) } else { 0.0 };
            let own = match (&hit, soak.as_mut()) {
                (Some(h), Some(s)) if h.kind == Kind::Cloth => s.take(h.rest, moved * 8.0),
                _ => 0.0,
            };
            if pushed + own < 0.01 {
                continue;
            }
            // A smear as wide as what was dragged, in streaks along the way it went (the weave, the folds, the skin's own
            // lines drag the blood into lines), thinning off at its sides.
            let steps = (moved / 0.0125).ceil() as usize;
            let wide = (radius * 0.8).min(0.06);
            let (ax, az) = ((c.x - last.x) / moved, (c.z - last.z) / moved);
            let lane = |u: f32| (0.4 + 0.6 * (u * 160.0 + mass).sin().abs()) * (1.0 - (u / wide).powi(2) * 0.7);
            let lanes = ((2.0 * wide / 0.0125).floor() as usize) + 1;
            let total: f32 = (0..lanes).map(|l| lane(-wide + l as f32 * 0.0125)).sum::<f32>() * steps as f32;
            for k in 1..=steps {
                let f = k as f32 / steps as f32;
                let (x, z) = (last.x + ax * moved * f, last.z + az * moved * f);
                for l in 0..lanes {
                    let u = -wide + l as f32 * 0.0125;
                    floor.add(x + az * u, z - ax * u, (pushed + own) * lane(u) / total, map);
                }
            }
        }
    }
}

// The player's feet: stepping in blood wets the soles, and the next steps print them, less each time.
fn feet(b: &mut Blood, player: &Player, map: &Map, floor: &mut Floor) {
    let eye = player.eye().translation;
    // Up on something, the soles print on it, but there is no pool up there to step in.
    let under = map.ground(eye.x, eye.z, eye.y - 0.5);
    let f = b.foot.get_or_insert(Foot { x: eye.x, z: eye.z, carried: 0.0, walked: 0.0, left: false });
    let moved = ((eye.x - f.x).powi(2) + (eye.z - f.z).powi(2)).sqrt();
    let along = Vec3::new(eye.x - f.x, 0.0, eye.z - f.z).normalize_or(Vec3::NEG_Z);
    f.x = eye.x;
    f.z = eye.z;
    if under < 0.01 && floor.depth(eye.x, eye.z) > 0.0004 {
        f.carried = (f.carried + floor.take(eye.x, eye.z, 0.12, 1.5)).min(5.0);
    }
    if moved > 0.5 {
        return;
    }
    if f.carried < 0.05 {
        f.walked = 0.0;
        return;
    }
    f.walked += moved;
    if f.walked < 0.72 {
        return;
    }
    f.walked = 0.0;
    f.left = !f.left;
    let left = f.left;
    let print = f.carried * 0.28;
    f.carried -= print;
    // A print as full as the blood the sole still carries: the first ones whole, then only the tread's ridges, then a
    // few flecks. A left foot is a right one mirrored.
    let kind = 16 + if print > 0.6 { 0 } else if print > 0.3 { 1 } else if print > 0.12 { 2 } else { 3 };
    let across = along.cross(Vec3::Y);
    let side = if left { -0.09 } else { 0.09 };
    b.mark(kind, across * if left { -0.13 } else { 0.13 }, along * 0.33, Vec3::Y, Vec3::new(eye.x + across.x * side, under, eye.z + across.z * side));
}

// --- drawing ---------------------------------------------------------------------------------------------------------

// The marks on the room as a mark's quad in its mesh: the stain's colour as it dries (vertex colour) and how dry it is
// (second UV), for stain.wesl.
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone, Default)]
pub struct Stain {
    // The hall, as wet blood shows it (wet.rs).
    #[texture(100)]
    #[sampler(106)]
    hall0: Handle<Image>,
    #[texture(101)]
    hall1: Handle<Image>,
    #[texture(102)]
    hall2: Handle<Image>,
    #[texture(103)]
    hall3: Handle<Image>,
    #[texture(104)]
    hall4: Handle<Image>,
    #[texture(105)]
    hall5: Handle<Image>,
}

impl MaterialExtension for Stain {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/stain.wesl".into()
    }
}

#[derive(Resource)]
struct Drawn {
    drops: Vec<Entity>,
    ropes: Vec<Entity>,
    beads: Vec<Entity>,
    shown: [usize; 3],
    chunks: Vec<Handle<Mesh>>,
}

fn setup(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut materials: ResMut<Assets<StandardMaterial>>, mut images: ResMut<Assets<Image>>,
         mut stains: ResMut<Assets<ExtendedMaterial<StandardMaterial, Stain>>>, hall: Res<crate::wet::Hall>) {
    let [hall0, hall1, hall2, hall3, hall4, hall5] = hall.faces.clone();
    let mut blood = Blood::new();
    // Blood in the air, and beads of it on skin: a deep red that shines.
    let air = materials.add(StandardMaterial {
        base_color: Color::linear_rgb(0.16, 0.007, 0.006),
        perceptual_roughness: 0.06,
        reflectance: 0.35,
        ..default()
    });
    let mut pool = |mesh: Mesh, count: usize, name: &'static str| -> Vec<Entity> {
        let mesh = meshes.add(mesh);
        (0..count)
            .map(|_| commands.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(air.clone()), Transform::default(), Visibility::Hidden, NotShadowCaster, Name::new(name))).id())
            .collect()
    };
    let drops = pool(Sphere::new(0.5).mesh().uv(8, 5), MOST, "drop");
    let ropes = pool(Cylinder::new(0.5, 1.0).mesh().resolution(7).build(), ROPES, "stream");
    let beads = pool(Sphere::new(0.5).mesh().uv(10, 7), BEADS, "bead");
    let sheet = images.add(splash_sheet(&mut blood.rng));
    let material = stains.add(ExtendedMaterial {
        base: StandardMaterial {
            base_color_texture: Some(sheet),
            perceptual_roughness: 0.1,
            reflectance: 0.35,
            alpha_mode: AlphaMode::Blend,
            double_sided: true,
            cull_mode: None,
            depth_bias: 2.0,
            ..default()
        },
        extension: Stain { hall0, hall1, hall2, hall3, hall4, hall5 },
    });
    let mut chunks = Vec::new();
    for _ in 0..SPLATS / CHUNK {
        let v = CHUNK * 4;
        let mut index = Vec::with_capacity(CHUNK * 6);
        for q in 0..CHUNK as u32 {
            index.extend_from_slice(&[q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]);
        }
        let mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32; 3]; v])
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0f32, 1.0, 0.0]; v])
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, vec![[0.0f32; 2]; v])
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_1, vec![[0.0f32; 2]; v])
            .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, vec![[1.0f32; 4]; v])
            .with_inserted_indices(Indices::U32(index));
        let mesh = meshes.add(mesh);
        // (Drawn whatever the camera sees: its bounds would have to follow its marks.)
        commands.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(material.clone()), Transform::default(), NoFrustumCulling, NotShadowCaster, Name::new("blood marks")));
        chunks.push(mesh);
    }
    commands.insert_resource(Drawn { drops, ropes, beads, shown: [0; 3], chunks });
    commands.insert_resource(blood);
}

// What is in the air drawn: each drop long along its way (as far as it moves in a sixtieth of a second, as the eye sees
// it), each stream as ropes between its points still joined, the beads on skin; and the marks that changed.
fn draw(mut blood: ResMut<Blood>, mut drawn: ResMut<Drawn>, mut things: Query<(&mut Transform, &mut Visibility)>, mut beads: Query<&mut GlobalTransform>,
        mut meshes: ResMut<Assets<Mesh>>) {
    let start = Instant::now();
    let b = &mut *blood;
    let d = &mut *drawn;
    let show = |list: &[Entity], k: usize, t: Transform, things: &mut Query<(&mut Transform, &mut Visibility)>| {
        if let Ok((mut tr, mut v)) = things.get_mut(list[k]) {
            *tr = t;
            if *v != Visibility::Inherited {
                *v = Visibility::Inherited;
            }
        }
    };
    let hide = |list: &[Entity], from: usize, to: usize, things: &mut Query<(&mut Transform, &mut Visibility)>| {
        for &e in &list[from..to] {
            if let Ok((_, mut v)) = things.get_mut(e) {
                *v = Visibility::Hidden;
            }
        }
    };
    let n = b.p.len();
    for i in 0..n {
        let (at, vel) = (b.p[i], b.v[i]);
        let speed = vel.length();
        let r = b.d[i].max(0.0006);
        let rotation = if speed > 1e-4 { Quat::from_rotation_arc(Vec3::Y, vel / speed) } else { Quat::IDENTITY };
        show(&d.drops, i, Transform { translation: at, rotation, scale: Vec3::new(r, r + (speed / 60.0).min(0.08) * 0.5, r) }, &mut things);
    }
    hide(&d.drops, n, d.shown[0].max(n), &mut things);
    d.shown[0] = n;
    let mut ropes = 0;
    'streams: for s in b.streams.values() {
        for i in 0..s.p.len().saturating_sub(1) {
            if ropes >= ROPES {
                break 'streams;
            }
            let (a, c) = (s.p[i], s.p[i + 1]);
            let way = c - a;
            let long = way.length();
            if !(1e-5..=0.05).contains(&long) {
                continue;
            }
            let r = (s.d[i] + s.d[i + 1]) * 0.5;
            let t = Transform { translation: (a + c) * 0.5, rotation: Quat::from_rotation_arc(Vec3::Y, way / long), scale: Vec3::new(r, long + r * 0.5, r) };
            show(&d.ropes, ropes, t, &mut things);
            ropes += 1;
        }
    }
    hide(&d.ropes, ropes, d.shown[1].max(ropes), &mut things);
    d.shown[1] = ropes;
    // (A bead is a sphere squashed onto the skin and, hanging, sheared down: its own axes, written as its world
    // transform; its Transform is never changed, so Bevy leaves that alone.)
    let count = b.beads.len();
    for (k, m) in b.beads.drain(..).enumerate() {
        if let Ok(mut g) = beads.get_mut(d.beads[k]) {
            *g = GlobalTransform::from(m);
        }
        if let Ok((_, mut v)) = things.get_mut(d.beads[k])
            && *v != Visibility::Inherited
        {
            *v = Visibility::Inherited;
        }
    }
    hide(&d.beads, count, d.shown[2].max(count), &mut things);
    d.shown[2] = count;
    // The marks that changed: their whole mesh written again.
    for (c, changed) in b.changed.iter_mut().enumerate() {
        if !*changed {
            continue;
        }
        *changed = false;
        let Some(mut mesh) = meshes.get_mut(&d.chunks[c]) else { continue };
        let marks = &b.marks[c * CHUNK..(c + 1) * CHUNK];
        let write = |mesh: &mut Mesh, id, f: &dyn Fn(&Mark, usize) -> [f32; 4]| match mesh.attribute_mut(id) {
            Some(VertexAttributeValues::Float32x3(v)) => {
                for (q, m) in marks.iter().enumerate() {
                    for k in 0..4 {
                        let x = f(m, k);
                        v[q * 4 + k] = [x[0], x[1], x[2]];
                    }
                }
            }
            Some(VertexAttributeValues::Float32x2(v)) => {
                for (q, m) in marks.iter().enumerate() {
                    for k in 0..4 {
                        let x = f(m, k);
                        v[q * 4 + k] = [x[0], x[1]];
                    }
                }
            }
            Some(VertexAttributeValues::Float32x4(v)) => {
                for (q, m) in marks.iter().enumerate() {
                    for k in 0..4 {
                        v[q * 4 + k] = f(m, k);
                    }
                }
            }
            _ => {}
        };
        const CORNERS: [[f32; 2]; 4] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
        write(&mut mesh, Mesh::ATTRIBUTE_POSITION.id, &|m, k| {
            if m.n == Vec3::ZERO {
                return [0.0; 4];
            }
            let p = m.at + m.x * CORNERS[k][0] + m.y * CORNERS[k][1];
            [p.x, p.y, p.z, 0.0]
        });
        write(&mut mesh, Mesh::ATTRIBUTE_NORMAL.id, &|m, _| [m.n.x, m.n.y, m.n.z, 0.0]);
        write(&mut mesh, Mesh::ATTRIBUTE_UV_0.id, &|m, k| {
            let (col, row) = ((m.kind as usize % TILES[0]) as f32, (m.kind as usize / TILES[0]) as f32);
            let u = (col + CORNERS[k][0] + 0.5) / TILES[0] as f32;
            let v = (row + 0.5 - CORNERS[k][1]) / TILES[1] as f32;
            [u, v, 0.0, 0.0]
        });
        write(&mut mesh, Mesh::ATTRIBUTE_UV_1.id, &|m, _| [m.dry, 0.0, 0.0, 0.0]);
        write(&mut mesh, Mesh::ATTRIBUTE_COLOR.id, &|m, _| {
            let t = m.dry;
            [WET[0] + (DRY[0] - WET[0]) * t, WET[1] + (DRY[1] - WET[1]) * t, WET[2] + (DRY[2] - WET[2]) * t, 1.0]
        });
    }
    b.cost[3] = start.elapsed().as_secs_f32();
}

// --- the splash sheet ------------------------------------------------------------------------------------------------

// What the TS painted on a canvas, coverage only (the colour is worked out from it after): shapes filled as polygons,
// four rows of samples to a pixel row, each laid over what is there as a canvas lays paint ("source-over").
struct Canvas {
    w: usize,
    h: usize,
    a: Vec<f32>,
    row: Vec<f32>,
}

impl Canvas {
    // `pts` filled with paint `alpha` deep, inside the clip rectangle [x0, y0, x1, y1] only.
    fn fill(&mut self, pts: &[Vec2], alpha: f32, clip: [usize; 4]) {
        let (lo, hi) = pts.iter().fold((Vec2::splat(f32::INFINITY), Vec2::splat(f32::NEG_INFINITY)), |(l, h), p| (l.min(*p), h.max(*p)));
        let (y0, y1) = ((lo.y.floor().max(clip[1] as f32)) as usize, (hi.y.ceil().min(clip[3] as f32)) as usize);
        let (x0, x1) = ((lo.x.floor().max(clip[0] as f32)) as usize, (hi.x.ceil().min(clip[2] as f32)) as usize);
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        let mut xs: Vec<f32> = Vec::new();
        for py in y0..y1 {
            self.row[x0..x1].fill(0.0);
            for sub in 0..4 {
                let y = py as f32 + (sub as f32 + 0.5) / 4.0;
                xs.clear();
                for k in 0..pts.len() {
                    let (a, b) = (pts[k], pts[(k + 1) % pts.len()]);
                    if (a.y <= y) != (b.y <= y) {
                        xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
                    }
                }
                xs.sort_by(|a, b| a.total_cmp(b));
                for span in xs.chunks_exact(2) {
                    let (s0, s1) = (span[0].max(x0 as f32), span[1].min(x1 as f32));
                    let mut x = s0.floor() as usize;
                    while (x as f32) < s1 && x < x1 {
                        let over = (s1.min(x as f32 + 1.0) - s0.max(x as f32)).max(0.0);
                        self.row[x] += over / 4.0;
                        x += 1;
                    }
                }
            }
            for x in x0..x1 {
                let src = alpha * self.row[x].min(1.0);
                let i = py * self.w + x;
                self.a[i] = src + self.a[i] * (1.0 - src);
            }
        }
    }
}

fn ellipse(c: Vec2, rx: f32, ry: f32, turn: f32) -> Vec<Vec2> {
    let steps = ((rx.max(ry) * 1.5) as usize).clamp(12, 96);
    let (s, co) = turn.sin_cos();
    (0..steps)
        .map(|k| {
            let t = k as f32 / steps as f32 * std::f32::consts::TAU;
            let (x, y) = (t.cos() * rx, t.sin() * ry);
            c + Vec2::new(x * co - y * s, x * s + y * co)
        })
        .collect()
}

// A line `w` wide from a to b with round ends (a canvas stroke, lineCap round).
fn stroke(a: Vec2, b: Vec2, w: f32) -> Vec<Vec2> {
    let d = (b - a).normalize_or(Vec2::X);
    let n = Vec2::new(-d.y, d.x) * (w / 2.0);
    let mut pts = Vec::new();
    for k in 0..=8 {
        let t = std::f32::consts::PI * k as f32 / 8.0;
        pts.push(b + n * t.cos() + d * (w / 2.0) * t.sin());
    }
    for k in 0..=8 {
        let t = std::f32::consts::PI * k as f32 / 8.0;
        pts.push(a - n * t.cos() - d * (w / 2.0) * t.sin());
    }
    pts
}

fn quadratic(from: Vec2, c: Vec2, to: Vec2, pts: &mut Vec<Vec2>) {
    for k in 1..=12 {
        let t = k as f32 / 12.0;
        pts.push(from * (1.0 - t) * (1.0 - t) + c * 2.0 * t * (1.0 - t) + to * t * t);
    }
}

// Twenty stains painted once, each filling about 40% of its tile: four round and smooth (a drop that fell gently); four
// round with their rims broken into spines and a scatter of droplets beyond (one that came hard); four long, with a tail
// and droplets thrown on ahead (one that came slantwise, travelling along +X); four runs down a wall, a streak from the
// top with the bead that is running at its foot; and four prints of a bloody shoe, fainter and fainter.
fn splash_sheet(rng: &mut Rng) -> Image {
    const S: usize = 256;
    let (cols, rows) = (TILES[0], TILES[1]);
    let (w, h) = (S * cols, S * rows);
    let mut g = Canvas { w, h, a: vec![0.0; w * h], row: vec![0.0; w] };
    let sf = S as f32;
    for k in 0..cols * rows {
        let (ox, oy) = ((k % cols) * S, (k / cols) * S);
        let clip = [ox, oy, ox + S, oy + S];
        let (cx, cy) = (ox as f32 + sf / 2.0, oy as f32 + sf / 2.0);
        let blob = |g: &mut Canvas, x: f32, y: f32, r: f32, alpha: f32| g.fill(&ellipse(Vec2::new(x, y), r.max(0.6), r.max(0.6), 0.0), alpha, clip);
        // A closed outline about (x, y), `r` across on average, its edge wandering by `jag` at `lobes` places round it.
        let outline = |g: &mut Canvas, rng: &mut Rng, x: f32, y: f32, r: f32, lobes: usize, jag: f32, sx: f32, sy: f32, alpha: f32| {
            let offsets: Vec<f32> = (0..lobes).map(|_| (rng.next() - 0.5) * jag).collect();
            let steps = lobes * 6;
            let pts: Vec<Vec2> = (0..=steps)
                .map(|a| {
                    let t = a as f32 / steps as f32 * std::f32::consts::TAU;
                    let f = a as f32 / steps as f32 * lobes as f32;
                    let (i, u) = (f.floor() as usize % lobes, f - f.floor());
                    let j = (i + 1) % lobes;
                    let rr = r * (1.0 + offsets[i] * (1.0 - u) + offsets[j] * u);
                    Vec2::new(x + t.cos() * rr * sx, y + t.sin() * rr * sy)
                })
                .collect();
            g.fill(&pts, alpha, clip);
        };
        // (How thick it lies, thin at the rim and deep in the middle, is worked out from the shape: `texels`.)
        let body = |g: &mut Canvas, rng: &mut Rng, x: f32, y: f32, r: f32, sx: f32, sy: f32| outline(g, rng, x, y, r, 14, 0.12, sx, sy, 1.0);
        match k / 4 {
            0 => body(&mut g, rng, cx, cy, sf * 0.19, 1.0, 1.0),
            1 => {
                body(&mut g, rng, cx, cy, sf * 0.17, 1.0, 1.0);
                // Spines: fingers of blood thrown out of the rim, some ending in a droplet.
                let spines = 14 + (rng.next() * 10.0) as usize;
                for a in 0..spines {
                    let t = a as f32 / spines as f32 * std::f32::consts::TAU + rng.next() * 0.3;
                    let len = sf * (0.03 + rng.next() * 0.07);
                    let width = sf * (0.008 + rng.next() * 0.012);
                    let (c, s) = (t.cos(), t.sin());
                    g.fill(&stroke(Vec2::new(cx + c * sf * 0.15, cy + s * sf * 0.15), Vec2::new(cx + c * (sf * 0.17 + len), cy + s * (sf * 0.17 + len)), width), 0.9, clip);
                    if rng.next() < 0.5 {
                        let r = sf * (0.006 + rng.next() * 0.01);
                        blob(&mut g, cx + c * (sf * 0.2 + len * 1.4), cy + s * (sf * 0.2 + len * 1.4), r, 1.0);
                    }
                }
                for _ in 0..10 {
                    let (t, r) = (rng.next() * std::f32::consts::TAU, sf * (0.28 + rng.next() * 0.18));
                    let size = sf * (0.003 + rng.next() * 0.007);
                    blob(&mut g, cx + t.cos() * r, cy + t.sin() * r, size, 1.0);
                }
            }
            2 => {
                // Long along +X: the stain itself an ellipse a little to the back, its leading edge drawn out into a tail
                // and the droplets it threw going on ahead.
                body(&mut g, rng, cx - sf * 0.1, cy, sf * 0.18, 1.0, 0.42);
                let mut pts = vec![Vec2::new(cx + sf * 0.05, cy - sf * 0.05)];
                quadratic(pts[0], Vec2::new(cx + sf * 0.2, cy - sf * 0.01), Vec2::new(cx + sf * 0.27, cy), &mut pts);
                quadratic(Vec2::new(cx + sf * 0.27, cy), Vec2::new(cx + sf * 0.2, cy + sf * 0.01), Vec2::new(cx + sf * 0.05, cy + sf * 0.05), &mut pts);
                g.fill(&pts, 1.0, clip);
                for _ in 0..9 {
                    let (t, r) = ((rng.next() - 0.5) * 0.35, sf * (0.28 + rng.next() * 0.2));
                    let size = sf * (0.004 + rng.next() * 0.012);
                    blob(&mut g, cx + t.cos() * r, cy + t.sin() * r * 0.5, size, 1.0);
                }
            }
            3 => {
                // A run down a wall: from the top of the tile, narrowing as it goes, the bead at its foot.
                let (wd, top, foot) = (sf * 0.05, oy as f32 + sf * 0.08, oy as f32 + sf * 0.86);
                outline(&mut g, rng, cx, top + wd, wd * 1.6, 9, 0.25, 1.0, 1.0, 0.85);
                let mut pts = vec![Vec2::new(cx - wd, top + wd)];
                let mut x = cx;
                let mut y = top + wd;
                let mut down = Vec::new();
                while y <= foot {
                    x += (rng.next() - 0.5) * sf * 0.008;
                    let half = wd * (0.55 + 0.45 * (1.0 - (y - top) / sf));
                    pts.push(Vec2::new(x - half, y));
                    down.push((y, half));
                    y += sf * 0.04;
                }
                for &(y, half) in down.iter().rev() {
                    pts.push(Vec2::new(x + half, y));
                }
                g.fill(&pts, 0.85, clip);
                outline(&mut g, rng, x, foot, wd * 0.95, 7, 0.15, 1.0, 1.25, 1.0);
            }
            _ => {
                // A right shoe's print, toes up the tile (the quad is a shoe long and wide): the forefoot and the heel,
                // which bear on the floor, joined by a strip of the outside edge (the arch stands off it); the tread's
                // lugs carry blood and its grooves none. The fewer of the lugs the less the sole still carries (k % 4 = 0
                // whole, 3 a few patches), worn away first where the sole presses least.
                let at = |fx: f32, fy: f32| Vec2::new(ox as f32 + fx * sf, oy as f32 + fy * sf);
                g.fill(&ellipse(at(0.5, 0.29), sf * 0.4, sf * 0.23, -0.06), 1.0, clip);
                g.fill(&ellipse(at(0.52, 0.8), sf * 0.29, sf * 0.15, 0.0), 1.0, clip);
                g.fill(&[at(0.7, 0.42), at(0.87, 0.4), at(0.79, 0.76), at(0.68, 0.76)], 1.0, clip);
                // The tread: blocky lugs of a work boot's sole, set a little unevenly, the grooves between them clean.
                let keeps = [0.9, 0.55, 0.32, 0.14][k % 4];
                let jitter = |i: f64, j: f64, e: f64| {
                    let h = (i * 127.1 + j * 311.7 + e * 74.7).sin() * 43758.5453;
                    h - h.floor()
                };
                for y in 0..S {
                    for x in 0..S {
                        let i = (oy + y) * w + ox + x;
                        if g.a[i] == 0.0 {
                            continue;
                        }
                        // Distance to the edge of the nearest lug (the second nearest lug centre less the nearest,
                        // Worley's way), in lugs about 10 mm across (the tile is 130 mm wide and 330 mm long).
                        let (gx, gy) = (x as f64 / S as f64 * 13.0, y as f64 / S as f64 * 33.0);
                        let (cxl, cyl) = (gx.floor(), gy.floor());
                        let (mut d1, mut d2) = (9.0f64, 9.0f64);
                        for j in -1..=1 {
                            for e in -1..=1 {
                                let (ce, cj) = (cxl + e as f64, cyl + j as f64);
                                let px = ce + 0.2 + 0.6 * jitter(ce, cj, 1.0);
                                let py = cj + 0.2 + 0.6 * jitter(ce, cj, 2.0);
                                let d = ((gx - px).powi(2) + (gy - py).powi(2)).sqrt();
                                if d < d1 {
                                    d2 = d1;
                                    d1 = d;
                                } else if d < d2 {
                                    d2 = d;
                                }
                            }
                        }
                        let lug = (((d2 - d1) * 10.0 - 1.4) / 0.8).clamp(0.0, 1.0);
                        // How hard the sole presses here (heel and ball most) and how the blood on it happens to lie.
                        let (u, v) = (x as f64 / S as f64, y as f64 / S as f64);
                        let press = (-(((u - 0.52) / 0.2).powi(2) + ((v - 0.82) / 0.1).powi(2))).exp().max((-(((u - 0.45) / 0.25).powi(2) + ((v - 0.3) / 0.12).powi(2))).exp());
                        let (xf, yf, kf) = (x as f64, y as f64, k as f64);
                        let lie = 0.55 * noise2(xf / 22.0 + kf * 7.0, yf / 22.0) + 0.3 * noise2(xf / 7.0, yf / 7.0 + kf * 3.0) + 0.15 * noise2(xf / 2.5, yf / 2.5);
                        let n = 0.65 * lie + 0.35 * press;
                        let keep = ((n - (1.0 - keeps) * 0.85) / 0.06).clamp(0.0, 1.0);
                        // A full sole fills the grooves too, here and there.
                        let fill = if keeps > 0.8 { lug.max(((lie - 0.55) / 0.1).clamp(0.0, 1.0)) } else { lug };
                        g.a[i] = (g.a[i] as f64 * keep * fill * (0.72 + 0.28 * lie)) as f32;
                    }
                }
            }
        }
    }
    Image::new(Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, texels(&g.a, w, h), TextureFormat::Rgba8UnormSrgb,
               RenderAssetUsages::default())
}

// The sheet as the card takes it. Alpha is how much of each texel the blood covers; colour is the blood's own, by how
// thick it lies there: a stain is thickest well inside its edge and thins to nothing at it, so its rim is bright red and
// its middle near black-red (fluid.wesl's absorption, over concrete). Texels with no blood carry the rim's colour, so
// that where the card averages texels together (its mipmaps, its filtering) it never averages in black.
fn texels(cover: &[f32], w: usize, h: usize) -> Vec<u8> {
    let inside = blurred(&blurred(cover, w, h, 4), w, h, 4);
    let mut out = vec![0u8; w * h * 4];
    let srgb = |x: f32| (x.min(1.0).powf(1.0 / 2.2) * 255.0).round() as u8;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            // (A shoe's print is blood pressed off a sole: thin all over, not a drop's dome.)
            let print = (y / (h / TILES[1])) * TILES[0] + x / (w / TILES[0]) >= 16;
            let c = cover[i];
            let mm = if c == 0.0 {
                0.03
            } else if print {
                0.12 + 0.2 * c
            } else {
                0.03 + 0.57 * ((inside[i] - 0.3) / 0.65).clamp(0.0, 1.0).powf(1.5)
            };
            let (r, g, b) = ((-6.0 * mm).exp(), (-48.0 * mm).exp(), (-56.0 * mm).exp());
            out[i * 4] = srgb(0.2 * r + 0.075 * (1.0 - r));
            out[i * 4 + 1] = srgb(0.19 * g + 0.004 * (1.0 - g));
            out[i * 4 + 2] = srgb(0.17 * b + 0.0035 * (1.0 - b));
            out[i * 4 + 3] = (c.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    out
}

// `a` (w by h) through a box `r` texels either way, along rows then columns.
fn blurred(a: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let (mut tmp, mut out) = (vec![0.0f32; w * h], vec![0.0f32; w * h]);
    let k = 1.0 / (2 * r + 1) as f32;
    let at = |v: i64, n: usize| v.clamp(0, n as i64 - 1) as usize;
    for y in 0..h {
        let mut sum: f32 = (-(r as i64)..=r as i64).map(|x| a[y * w + at(x, w)]).sum();
        for x in 0..w {
            tmp[y * w + x] = sum * k;
            sum += a[y * w + at(x as i64 + r as i64 + 1, w)] - a[y * w + at(x as i64 - r as i64, w)];
        }
    }
    for x in 0..w {
        let mut sum: f32 = (-(r as i64)..=r as i64).map(|y| tmp[at(y, h) * w + x]).sum();
        for y in 0..h {
            out[y * w + x] = sum * k;
            sum += tmp[at(y as i64 + r as i64 + 1, h) * w + x] - tmp[at(y as i64 - r as i64, h) * w + x];
        }
    }
    out
}

// K: the room cleared, its blood with it.
fn clear(mut blood: ResMut<Blood>, mut floor: ResMut<Floor>) {
    blood.clear();
    floor.clear();
}

#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct Bleeding;

pub fn plugin(app: &mut App) {
    // (The check measures what the floor and the clothes cost the GPU.)
    if crate::scenario::Run::from_args().is_some_and(|r| r.name.starts_with("blood")) {
        app.add_plugins(bevy::render::diagnostic::RenderDiagnosticsPlugin);
    }
    bevy::asset::embedded_asset!(app, "stain.wesl");
    app.add_plugins(MaterialPlugin::<ExtendedMaterial<StandardMaterial, Stain>>::default())
        .add_systems(Startup, setup.after(crate::wet::make))
        .add_systems(First, take.before(crate::npc::forget))
        .add_systems(Update, (update.in_set(Bleeding), clear.run_if(bevy::input::common_conditions::input_just_pressed(KeyCode::KeyK))))
        .add_systems(PostUpdate, draw.before(bevy::transform::TransformSystems::Propagate));
}

// --- the check -------------------------------------------------------------------------------------------------------

use crate::scenario::{log, view, Step};
use serde_json::json;

// The person standing `i`th in the line (sandbox.rs's order).
fn person_at(w: &mut World, i: usize) -> Entity {
    let body = crate::sandbox::BODIES[i];
    let mut q = w.query::<(Entity, &Person)>();
    q.iter(w).find(|(_, p)| p.body.name == body).unwrap().0
}

// A wound made with `missile` at bone `bone` of person `i`, `offset` from its head (the TS's space), coming along `dir`
// (Bevy's) from `back` metres before it; what it cut, into the log.
#[allow(clippy::too_many_arguments)]
fn wound(w: &mut World, name: &str, i: usize, bone: &'static str, offset: [f32; 3], dir: Vec3, back: f32, missile: &crate::wounds::Missile, pellets: &[[f32; 3]]) {
    let who = person_at(w, i);
    let res = crate::npc::with(w, who, |npc| {
        let b = npc.bone_index(bone);
        let target = npc.world_of(npc.body().bones[b].head, b, None).0 + crate::babylon(offset[0], offset[1], offset[2]);
        let one = [[0.0; 3]];
        let pellets = if pellets.is_empty() { &one[..] } else { pellets };
        for o in pellets {
            crate::wounds::pierce(npc, target + crate::babylon(o[0], o[1], o[2]) - dir * back, dir, missile, back + missile.reach.unwrap_or(2.0));
        }
        let bleeds: Vec<_> = npc.vitals.bleeds.iter().map(|b| json!({ "name": b.name, "rate": b.rate, "arterial": b.arterial, "spurts": b.spurts, "internal": b.internal })).collect();
        json!({ "target": target.to_array(), "bleeds": bleeds })
    });
    info!("blood check: {name}: {res:?}");
    log(w, json!({ "event": "wound", "name": name, "result": res }));
}

// How the blood stands: what is in the air, on the floor, in each person's clothes, and what the frame cost.
fn tally(w: &mut World, t: f32) {
    let (drops, streams, cost) = {
        let b = w.resource::<Blood>();
        (b.drops(), b.streams(), b.cost)
    };
    let tiles = w.resource::<Floor>().awake();
    let mut q = w.query::<(&Person, &Soak, &Vitals)>();
    let people: Vec<_> = q
        .iter(w)
        .map(|(p, s, v)| {
            let flow: f32 = v.bleeds.iter().map(|b| b.flow).sum();
            json!({ "body": p.body.name, "soaked_ml": s.total(), "lost_l": v.lost(), "flow_ml_s": flow * 1000.0 })
        })
        .collect();
    let floor_ms = w.resource::<Floor>().cost * 1000.0;
    // What the GPU took for the floor and the clothes, last frame (Bevy's render diagnostics: timestamp queries).
    let store = w.resource::<bevy::diagnostic::DiagnosticsStore>();
    let gpu: serde_json::Map<String, serde_json::Value> = store
        .iter()
        .filter(|d| d.path().as_str().contains("blood_"))
        .filter_map(|d| d.smoothed().map(|v| (d.path().as_str().to_string(), json!(v))))
        .collect();
    info!("blood check at {t} s: {drops} drops, {streams} streams, {tiles} tiles; {people:?}");
    log(w, json!({ "event": "blood", "t": t, "drops": drops, "streams": streams, "floor_tiles": tiles,
                   "cpu_ms": { "take": cost[0] * 1000.0, "update": cost[1] * 1000.0, "soak": cost[2] * 1000.0, "draw": cost[3] * 1000.0, "floor": floor_ms },
                   "gpu_ms": gpu, "people": people }));
}

// `frames` gone by, drawn small and plain (on a software renderer the drawing is most of a run), then the picture as
// the player sees it again.
fn wait(s: &mut Vec<Step>, frames: u32) {
    let set = |preset, level| {
        Step::Do(Box::new(move |w: &mut World| {
            let mut g = w.resource_mut::<crate::graphics::Graphics>();
            g.preset = preset;
            g.level = level;
        }))
    };
    s.push(set(2, 6.0));
    s.push(Step::Wait(frames));
    s.push(set(0, 1.0));
}

// The five cases at once: a knife nicking the femoral artery of a man standing; a pistol through the neck of a man lying
// on his back; a shotgun into a chest; a knife into a belly, and that man, awake, with blood put in his airway to cough
// up; then each seen at 0, 2, 10, 30 and 120 seconds.
pub fn scenario() -> Vec<Step> {
    let mut s = Vec::new();
    // (The help off the picture: H in the game.)
    s.push(Step::Do(Box::new(|w: &mut World| {
        let mut q = w.query::<(&Text, &ChildOf)>();
        let help: Vec<Entity> = q.iter(w).filter(|(t, _)| t.0.starts_with("Left click")).map(|(_, c)| c.parent()).collect();
        for e in help {
            w.entity_mut(e).insert(Visibility::Hidden);
        }
    })));
    // The second person out cold and down on his back: a minute to settle.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 1);
        w.get_mut::<Vitals>(who).unwrap().out = 1e9;
        w.resource_scope(|w, mut rng: Mut<Rng>| {
            let mut q = w.query::<(&mut Ragdoll, &mut Behaviour)>();
            let (mut rd, mut b) = q.get_mut(w, who).unwrap();
            let chest = rd.by_name("chest");
            let at = rd.middle(chest);
            rd.push(chest, Vec3::new(0.0, 0.0, -60.0), at);
            b.knock_down(&mut rng);
        });
    })));
    wait(&mut s, 60 * 5);
    s.push(Step::Do(Box::new(|w: &mut World| {
        let knife = crate::wounds::Missile { energy: 70.0, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40.0, reach: Some(0.17), blade: true, edges: Some(1),
                                             taper: Some(0.04), across: Some(Vec3::NEG_Y), ..default() };
        let gun = |energy, mass, speed, calibre, channel, soft, hard, pellets| crate::wounds::Missile {
            energy, mass, speed: Some(speed), calibre, channel, soft, hard, pellets: Some(pellets), ..default()
        };
        let ahead = crate::babylon(0.0, 0.0, 1.0);
        wound(w, "femoral nick", 0, "upperleg01.R", [0.035, -0.07, 0.0], ahead, 0.5, &knife, &[]);
        wound(w, "neck shot, lying", 1, "neck01", [0.0, 0.0, 0.0], Vec3::NEG_Y, 0.6, &gun(480.0, 0.008, 360.0, 0.009, 0.006, 12.0, 110.0, 1), &[]);
        let pellets = [[-0.03, -0.03, 0.0], [0.0, -0.03, 0.0], [0.03, -0.03, 0.0], [-0.03, 0.0, 0.0], [0.0, 0.0, 0.0], [0.03, 0.0, 0.0], [-0.03, 0.03, 0.0],
                       [0.0, 0.03, 0.0], [0.03, 0.03, 0.0]];
        wound(w, "shotgun chest", 2, "spine01", [0.04, 0.05, 0.0], ahead, 1.5, &gun(170.0, 0.0035, 400.0, 0.0084, 0.005, 9.0, 90.0, 9), &pellets);
        wound(w, "knife belly", 3, "spine03", [0.05, 0.02, 0.0], ahead, 0.5, &knife, &[]);
        // The cough: the same man, awake, with 40 ml in his left lung's airways, as a lung bleeding into its bronchi
        // puts there (throat.rs: 15% of a lung wound's bleeding); he coughs it up, frothy, as a spray.
        let who = person_at(w, 3);
        crate::npc::with(w, who, |npc| npc.throat().take(crate::vitals::Into::Airway, Some(crate::vitals::Side::L), 40.0));
        log(w, json!({ "event": "wound", "name": "blood in the airway", "result": "40 ml, left" }));
    })));
    let mut at = 0.0;
    for t in [0.0f32, 2.0, 10.0, 30.0, 120.0] {
        let frames = ((t - at) * 60.0).round() as u32;
        if frames > 0 {
            wait(&mut s, frames);
        }
        // (Each view waits six frames for the eye to settle: the five are half a second apart.)
        at = t + 0.5;
        s.push(Step::Do(Box::new(move |w: &mut World| tally(w, t))));
        let x = |i: usize| (i as f32 - 1.5) * 1.5;
        s.extend(view(&format!("blood_{t:03}_femoral"), x(0) - 1.0, 0.6, [x(0), 0.6, 2.2], 1.5));
        s.extend(view(&format!("blood_{t:03}_neck"), x(1) + 0.9, 1.0, [x(1), 0.05, 2.6], 1.6));
        s.extend(view(&format!("blood_{t:03}_chest"), x(2), 0.7, [x(2), 0.9, 2.2], 1.5));
        s.extend(view(&format!("blood_{t:03}_belly"), x(3) + 0.8, 0.8, [x(3), 0.7, 2.2], 1.4));
        s.extend(view(&format!("blood_{t:03}_floor"), 0.0, -0.5, [0.0, 0.0, 2.4], 2.4));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    // The sheet's blur keeps what it is given (a flat field stays flat, a point is spread evenly over the box), and a
    // filled polygon covers as much as its area.
    #[test]
    fn sheet() {
        let flat = blurred(&vec![0.5; 64], 8, 8, 2);
        assert!(flat.iter().all(|v| (v - 0.5).abs() < 1e-5));
        let mut point = vec![0.0; 81];
        point[40] = 1.0;
        let spread = blurred(&point, 9, 9, 1);
        assert!((spread[40] - 1.0 / 9.0).abs() < 1e-5 && (spread.iter().sum::<f32>() - 1.0).abs() < 1e-4);
        let mut c = Canvas { w: 32, h: 32, a: vec![0.0; 1024], row: vec![0.0; 32] };
        c.fill(&[Vec2::new(4.0, 4.0), Vec2::new(20.0, 4.0), Vec2::new(20.0, 14.0), Vec2::new(4.0, 14.0)], 1.0, [0, 0, 32, 32]);
        assert!((c.a.iter().sum::<f32>() - 160.0).abs() < 1.0);
    }
}
