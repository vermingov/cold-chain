// What blows do to the skin they land on, and what that skin does about it over the next minutes
// (src/sandbox/bruise.ts). The painting of it (the tint, the swelling pushed out in the skin's own vertex shader, what
// lies on the skin carried out by it) is phase 3's: this is the tissue's own clock, what a blow does to it, the skin it
// splits and the nose it makes bleed, and how swollen each eye's lids are (face.rs closes them).
//
// Each place of the skin (each corner of the mesh, the seams of its picture welded back together) keeps what has
// happened to the tissue under it: how damaged it is, how red, how much blood has leaked out of torn vessels and how much
// of that has come up to where it shows, how swollen. A blow adds to that, more where it lands harder, more over bone
// (the skin is crushed against it), more in lax tissue (the eyelids); and tissue already hurt tears more easily, so the
// fifth punch to a cheek does far more than the first. Then, on its own clock, a few times a second and only where
// something is still changing:
//
// - nothing at the instant of the blow; redness (vessels opened up) comes over a few seconds (the red reaction of
//   Lewis's triple response, 3 to 15 s) and fades over half an hour;
// - torn vessels go on leaking for minutes, until they clot, and the blood out comes up through the tissue to show: over
//   bone in tens of minutes, through thick flesh over hours, losing its oxygen over hours;
// - that blood spreads over hours, and settles downhill (a blow to the brow ends up round the eye over a day),
//   collecting in lax tissue;
// - the tissue swells (oedema) over minutes to hours, and the blood out swells it too as it gathers, and an eye swells
//   shut.
//
// The dead have no circulation: no new redness or swelling, and no new bleeding into a bruise past the first minute or
// two; blood already out still comes up. Hard or repeated blows over bone split the skin (brow, cheekbone, lip on the
// teeth, scalp), and a blow to the nose makes it bleed. A facial bone broken under the skin (bones.rs) swells and bruises
// round it. Everything is kept in the mesh's rest space.

use std::collections::HashMap;

use bevy::prelude::*;

use crate::npc::{Crossing, Kind, Npc};
use crate::vitals::{Bleed, Into, Side};
use crate::wounds::Tool;

const TICK: f32 = 0.2; // seconds between the skin's own steps
const QUIET: f32 = 1.0; // seconds between steps of a place only slowly settling
const DOSE: f32 = 120.0; // J into the soft tissue for one unit of damage at the middle of a fist's patch
const TEARS: f32 = 0.12; // damage a blow must do before vessels tear (a light slap only reddens)
const LEAK: f32 = 0.00875; // per second, of what tore, leaking out of the vessels at first (2.1 of it in all)
const CLOTS: f32 = 240.0; // seconds for the leak to clot down to a third
const REDDENS: f32 = 3.0; // seconds for redness to come up to two thirds
const FADES: f32 = 1800.0; // seconds for redness to fade to a third
const SWELLS: f32 = 900.0; // seconds for swelling to come up to two thirds of what it will be
const SHOWS: f32 = 600.0; // seconds for blood out to come up to show through skin over bone (two thirds)
const DEEP: f32 = 10800.0; // and as many more through thick flesh
const BLUES: f32 = 10800.0; // seconds for blood that shows to lose most of its oxygen (red-purple to blue-purple)
const SWELL: f32 = 0.0035; // m of oedema a unit of damage brings, over bone
const HAEMATOMA: f32 = 0.004; // m of swelling a unit of blood out brings
const SPREADS: f32 = 1.7e-8; // m2/s: how fast blood out spreads through the tissue, fresh (about 2 cm in all)
const SETTLES: f32 = 21600.0; // seconds for that to slow to a third, as it clots
const SINKS: f32 = 1.7e-7; // m/s: how fast blood that shows creeps downhill
const TRACKS: f32 = 5e-7; // m/s: and deep blood, along the planes between the layers (brow to lids in a day)
const SPLITS: f32 = 1.6; // damage over bone past which skin splits under one more blow
const MET: f32 = 0.012; // m: a layer standing further off the skin than this is never met by its swelling
const SQUEEZE: f32 = 0.3; // of the swelling a tight dressing presses back (a compression bandage's job)
const RECORDS: usize = 16; // recent blows whose shape (a bat's tramlines, a hard blow's pale middle) is drawn
// Rows of the person's table (skin.rs) kept for layers carried by the swelling that are meshes of their own (dressings).
pub const RIDER_ROWS: usize = 32;

fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

// The TS's clamp, Math.max(lo, Math.min(hi, x)): never panics when lo > hi.
fn clampf(x: f32, lo: f32, hi: f32) -> f32 {
    x.min(hi).max(lo)
}

fn cell_of(p: Vec3, size: f32) -> (i32, i32, i32) {
    ((p.x / size).floor() as i32, (p.y / size).floor() as i32, (p.z / size).floor() as i32)
}

// What a facial or skull fracture (bones.rs's types) does to the face over it: swelling `swell` units over `wide` m round
// it, `blood` units of bleeding into the tissue, blood tracking round one eye (`near`) or both. (How it moves the face
// over it is the look's.)
fn broke(t: &str) -> Option<(f32, f32, f32, Option<&'static str>)> {
    Some(match t {
        "nasal" => (1.4, 0.014, 0.8, Some("both")),
        "zygoma" => (1.2, 0.02, 0.9, Some("near")),
        "blowout" => (1.8, 0.02, 1.2, Some("near")),
        "lefort1" => (1.2, 0.028, 0.8, None),
        "lefort2" => (1.6, 0.03, 1.0, Some("both")),
        "lefort3" => (2.0, 0.035, 1.2, Some("both")),
        "chin" | "body" => (1.0, 0.02, 0.7, None),
        "angle" => (1.0, 0.022, 0.6, None),
        "condyle" => (0.8, 0.018, 0.4, None),
        "condyles" => (0.8, 0.02, 0.5, None),
        "linear" => (1.2, 0.025, 1.2, None),
        "depressed" => (1.4, 0.02, 1.5, None),
        "basilar" => (0.0, 0.02, 0.0, Some("both")),
        _ => return None,
    })
}

// How a facial fracture moves the face over it: pushed in along the skin's normal, or shoved sideways (m).
fn moves(t: &str) -> (f32, f32) {
    match t {
        "nasal" => (0.0, 0.0045),
        "zygoma" | "lefort1" => (0.003, 0.0),
        "lefort2" | "depressed" => (0.004, 0.0),
        "lefort3" => (0.005, 0.0),
        "chin" | "body" => (0.0, 0.002),
        _ => (0.0, 0.0),
    }
}

// A layer over the skin carried out by its swelling (bruise.ts Rider): for each of its corners, the place of the skin
// under it (or none), how far it stands off that skin past where it lies on it, and where its shift is kept (`out`).
#[derive(Clone)]
struct Rider {
    slots: Vec<u32>,
    place: Vec<i32>,
    gap: Vec<f32>,
    tight: f32,
}

#[derive(Clone)]
pub struct EyeLids {
    pub side: Side,
    pub centre: Vec3,
    pub lid: Vec<usize>,
}

#[derive(Clone, Default)]
pub struct Bruise {
    pub count: usize,
    pub pos: Vec<Vec3>,
    pub nor: Vec<Vec3>,
    pub owner: Vec<usize>,
    // Which places are next to which, across the skin, and how far.
    e_start: Vec<usize>,
    e_to: Vec<usize>,
    e_len: Vec<f32>,
    grid: HashMap<(i32, i32, i32), Vec<usize>>,
    bone: HashMap<(i32, i32, i32), Vec<Vec3>>,
    pub lax: Vec<f32>,
    pub rim: Vec<f32>,
    anvil: Vec<f32>,
    pub damage: Vec<f32>,
    pub ery: Vec<f32>,
    pub ery_t: Vec<f32>,
    pub leak: Vec<f32>,
    pub pool: Vec<f32>,
    pub blood: Vec<f32>,
    pub age: Vec<f32>,
    pub oed: Vec<f32>,
    pub oed_t: Vec<f32>,
    // How far each place stands swollen out of the skin, m (what the look pushes it out by).
    pub h: Vec<f32>,
    active: Vec<bool>,
    list: Vec<usize>,
    last: Vec<f32>,
    next: usize,
    pub clock: f32,
    wait: f32,
    pub eyes: Vec<EyeLids>,
    // How swollen each eye's lids are, 0 to 1 (face.rs closes them that far).
    pub swollen: (f32, f32),
    pub splits: Vec<(Vec3, usize)>,
    seen: usize,
    nose: Option<Option<Vec3>>,
    unknown: usize,
    // --- what is drawn of it (skin.rs, skin.wesl) ---
    // Each place's corners (the skin's, and the brows' on it), and which of them have normals pointing in.
    v_start: Vec<usize>,
    v_list: Vec<u32>,
    flip: Vec<i8>,
    // How far the bone under each place has moved (a facial fracture), and how hard what lies on it presses on it.
    shift: Vec<Vec3>,
    press: Vec<f32>,
    // What was last written of each place: redness, blood, blue, swelling.
    sent: Vec<Vec4>,
    // Each corner's tint, shift and tilt as the person's table holds them (and past the body's corners, the riders'
    // shifts), and those changed since skin.rs last took them.
    pub out: Vec<[Vec4; 3]>,
    dirty: Vec<bool>,
    pub changed: Vec<u32>,
    riders: Vec<Option<Rider>>,
    carry: bool,
    // The first slot of `out` not yet given to a rider.
    slots: usize,
    // A recent blow's shape: where (rest) and how wide, which way a bat lay and what kind (2 a bat's tramlines, 1 a hard
    // blow's ring), which way the skin faced and when.
    pub records: Vec<[Vec4; 3]>,
}

impl Npc<'_> {
    // The skin's places, welded, and what is known of them before any blow: how lax, how far from a free edge, which are
    // the lids.
    pub fn bruise_made(&mut self) {
        let body = self.person.body.clone();
        let n = body.position.len();
        // The skin's corners, those at one place (the seams of its picture) welded into one.
        let q = |x: f32| (x * 1e4).round() as i64 + 20000;
        let mut key: HashMap<(i64, i64, i64), usize> = HashMap::new();
        let mut node_of = vec![usize::MAX; n];
        let mut first = Vec::new();
        for p in body.parts.iter().filter(|p| p.kind == "skin") {
            for v in p.vertex_start..p.vertex_start + p.vertex_count {
                let x = body.position[v];
                let i = *key.entry((q(x.x), q(x.y), q(x.z))).or_insert_with(|| {
                    first.push(v);
                    first.len() - 1
                });
                node_of[v] = i;
            }
        }
        let m = first.len();
        let mut b = Bruise { count: m, ..default() };
        for &v in &first {
            let rest = body.position[v];
            let owner = self.owner_of(v as u32);
            b.owner.push(owner);
            b.pos.push(rest);
            b.nor.push(self.outward(body.normal[v].normalize(), rest, owner));
        }
        for (i, p) in b.pos.iter().enumerate() {
            b.grid.entry(cell_of(*p, 0.02)).or_default().push(i);
        }
        // A place whose own normal had to be turned to face out is the inside of a fold (the back of an eyelid) or skin
        // under clothes. It does not swell.
        let inner: Vec<bool> = first.iter().enumerate().map(|(i, &v)| body.normal[v].dot(b.nor[i]) < 0.0).collect();
        // Which places are next to which, across the skin. Each edge of each triangle as one number, sorted: an edge met
        // once is a free edge of the skin.
        let mut edges: Vec<u64> = Vec::new();
        for p in body.parts.iter().filter(|p| p.kind == "skin") {
            for t in (p.index_start..p.index_start + p.index_count).step_by(3) {
                for k in 0..3 {
                    let (a, c) = (node_of[body.index[t + k] as usize], node_of[body.index[t + (k + 1) % 3] as usize]);
                    if a != c {
                        edges.push((a.min(c) * m + a.max(c)) as u64);
                    }
                }
            }
        }
        edges.sort_unstable();
        let mut held = Vec::new();
        let mut unique = Vec::new();
        let mut degree = vec![0usize; m + 1];
        for k in 0..edges.len() {
            if k > 0 && edges[k] == edges[k - 1] {
                continue;
            }
            let (a, c) = ((edges[k] / m as u64) as usize, (edges[k] % m as u64) as usize);
            if edges.get(k + 1) != Some(&edges[k]) {
                held.push(a);
                held.push(c);
            }
            unique.push((a, c));
            degree[a + 1] += 1;
            degree[c + 1] += 1;
        }
        held.extend((0..m).filter(|&i| inner[i]));
        for i in 0..m {
            degree[i + 1] += degree[i];
        }
        b.e_to = vec![0; degree[m]];
        b.e_len = vec![0.0; degree[m]];
        let mut at = degree[..m].to_vec();
        for &(a, c) in &unique {
            let len = b.pos[a].distance(b.pos[c]).max(5e-4);
            b.e_to[at[a]] = c;
            b.e_len[at[a]] = len;
            at[a] += 1;
            b.e_to[at[c]] = a;
            b.e_len[at[c]] = len;
            at[c] += 1;
        }
        b.e_start = degree;
        // The brows ride on the skin they grow from: each of their corners is one of the nearest place's. (The lashes grow
        // from the lids' margins, which do not swell.)
        for p in body.parts.iter().filter(|p| p.kind == "brows") {
            for v in p.vertex_start..p.vertex_start + p.vertex_count {
                let mut best = 0.02;
                for (i, d) in b.around(body.position[v], 0.02) {
                    if d < best {
                        best = d;
                        node_of[v] = i;
                    }
                }
            }
        }
        let mut per = vec![0usize; m + 1];
        for &i in node_of.iter().filter(|&&i| i != usize::MAX) {
            per[i + 1] += 1;
        }
        for i in 0..m {
            per[i + 1] += per[i];
        }
        b.v_list = vec![0; per[m]];
        b.flip = vec![1; n];
        let mut fill = per[..m].to_vec();
        for (v, &i) in node_of.iter().enumerate() {
            if i == usize::MAX {
                continue;
            }
            b.v_list[fill[i]] = v as u32;
            fill[i] += 1;
            b.flip[v] = if body.normal[v].dot(b.nor[i]) < 0.0 { -1 } else { 1 };
        }
        b.v_start = per;
        b.shift = vec![Vec3::ZERO; m];
        b.press = vec![0.0; m];
        b.sent = vec![Vec4::ZERO; m];
        b.slots = n;
        b.out = vec![[Vec4::ZERO; 3]; n + crate::bruise::RIDER_ROWS * crate::skin::WIDE / crate::skin::PER_CORNER];
        b.dirty = vec![false; b.out.len()];
        for v in [&mut b.lax, &mut b.damage, &mut b.ery, &mut b.ery_t, &mut b.leak, &mut b.pool, &mut b.blood, &mut b.age, &mut b.oed, &mut b.oed_t, &mut b.h, &mut b.last] {
            *v = vec![0.0; m];
        }
        b.anvil = vec![f32::NAN; m];
        b.active = vec![false; m];
        b.seen = self.hurt.bones.breaks.len();
        // Where tissue is lax and swells and fills with blood easily: the eyelids most, the lips, the nose. And each eye's
        // lids, which close as they swell. (In front is -Z here, the TS's +Z.)
        let mut eyes: Vec<EyeLids> = [Side::L, Side::R].map(|side| EyeLids { side, centre: body.bone(if side == Side::L { "eye.L" } else { "eye.R" }).head, lid: Vec::new() }).into();
        let mouth = [body.bone("risorius03.L").head, body.bone("risorius03.R").head];
        for i in 0..m {
            let p = b.pos[i];
            let mut lax = 1.0;
            for e in &mut eyes {
                if p.z > e.centre.z + 0.012 {
                    continue;
                }
                let d = p.distance(e.centre);
                lax += 1.1 * (1.0 - smooth(0.012, 0.042, d));
                if d < 0.022 && (p.y - e.centre.y).abs() < 0.016 {
                    e.lid.push(i);
                }
            }
            // (the lips: round the line from one corner of the mouth to the other, in front)
            let ab = mouth[1] - mouth[0];
            let t = ((p - mouth[0]).dot(ab) / ab.length_squared()).clamp(0.0, 1.0);
            let lips = p.distance(mouth[0] + ab * t);
            if p.z < mouth[0].z + 0.004 {
                lax += 0.7 * (1.0 - smooth(0.007, 0.016, lips));
            }
            b.lax[i] = lax;
        }
        b.eyes = eyes;
        // The skin's free edges (the lids' margins, the lips' inner edge) do not swell out: the tissue there is held to the
        // eye, the teeth. Swelling rises with the distance across the skin from them: slowly round the eyes, where the lids
        // are thin folds that would go through each other (an eye swells shut by its lids coming down), quickly elsewhere
        // (a lip swells nearly to its edge).
        let mut far = vec![1.0f32; m];
        for &i in &held {
            far[i] = 0.0;
        }
        let mut queue = held.clone();
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            for e in b.e_start[i]..b.e_start[i + 1] {
                let (j, d) = (b.e_to[e], far[i] + b.e_len[e]);
                if d < far[j] && d < 0.02 {
                    far[j] = d;
                    queue.push(j);
                }
            }
        }
        b.rim = (0..m).map(|i| {
            let eye = b.eyes.iter().map(|e| b.pos[i].distance(e.centre)).fold(f32::INFINITY, f32::min);
            smooth(0.0015, if eye < 0.035 { 0.016 } else { 0.005 }, far[i])
        }).collect();
        // The bones' and teeth's surfaces as points about 6 mm apart, filed by 3 cm.
        let tr = self.traced.clone();
        let mut seen = std::collections::HashSet::new();
        let mut put = |p: Vec3, bone: &mut HashMap<(i32, i32, i32), Vec<Vec3>>| {
            if seen.insert(cell_of(p, 0.006)) {
                bone.entry(cell_of(p, 0.03)).or_default().push(p);
            }
        };
        let mut corner = vec![false; tr.position.len()];
        for part in tr.parts.iter().filter(|p| p.kind == "bone" || p.kind == "skull" || p.kind == "cartilage") {
            for c in &part.clusters {
                for &t in &c.tris {
                    for k in 0..3 {
                        corner[tr.index[t as usize + k] as usize] = true;
                    }
                }
            }
        }
        for (v, &c) in corner.iter().enumerate() {
            if c {
                put(tr.position[v], &mut b.bone);
            }
        }
        for p in body.parts.iter().filter(|p| p.kind == "teeth") {
            for v in p.vertex_start..p.vertex_start + p.vertex_count {
                put(body.position[v], &mut b.bone);
            }
        }
        // What lies on the skin is carried out by its swelling where the swelling reaches it: the clothes and the hair
        // (corners of this same body), and dressings (dressing.rs). A sleeve standing off is met only once the skin has
        // come out to it, a tight one at once; and a tight layer presses back. (Hair presses on nothing.)
        for hair in [false, true] {
            let layers: Vec<u32> = body.parts.iter()
                .filter(|p| if hair { p.kind == "hair" } else { p.worn })
                .flat_map(|p| (p.vertex_start as u32)..(p.vertex_start + p.vertex_count) as u32)
                .collect();
            let at: Vec<Vec3> = layers.iter().map(|&v| body.position[v as usize]).collect();
            if !at.is_empty() {
                b.ride(&at, 0.0, if hair { 0.0 } else { 0.3 }, Some(layers));
            }
        }
        self.hurt.bruise = b;
    }

}

impl<'a> Npc<'a> {
    pub fn bruise<'n>(&'n mut self) -> BruiseOf<'n, 'a> {
        BruiseOf(self)
    }
}

impl Bruise {
    // Each place within `far` of rest point `at`, with its distance.
    fn around(&self, at: Vec3, far: f32) -> Vec<(usize, f32)> {
        let r = (far / 0.02).ceil() as i32;
        let mut out = Vec::new();
        for a in -r..=r {
            for b in -r..=r {
                for c in -r..=r {
                    let Some(list) = self.grid.get(&cell_of(at + Vec3::new(a as f32, b as f32, c as f32) * 0.02, 0.02)) else { continue };
                    for &i in list {
                        let d = self.pos[i].distance(at);
                        if d < far {
                            out.push((i, d));
                        }
                    }
                }
            }
        }
        out
    }

    // How hard the bone under place `i` is against the skin: 1 where it lies a few millimetres under it (brow, cheekbone,
    // shin, scalp, the lips on the teeth), 0 with three centimetres or more of flesh between.
    fn anvil(&mut self, i: usize) -> f32 {
        if !self.anvil[i].is_nan() {
            return self.anvil[i];
        }
        let p = self.pos[i];
        let mut best = 0.03f32 * 0.03;
        for a in -1..=1 {
            for b in -1..=1 {
                for c in -1..=1 {
                    if let Some(list) = self.bone.get(&cell_of(p + Vec3::new(a as f32, b as f32, c as f32) * 0.03, 0.03)) {
                        for q in list {
                            best = best.min(q.distance_squared(p));
                        }
                    }
                }
            }
        }
        self.anvil[i] = 1.0 - smooth(0.004, 0.03, best.sqrt());
        self.anvil[i]
    }

    fn wake(&mut self, i: usize) {
        if self.active[i] {
            return;
        }
        self.active[i] = true;
        self.last[i] = self.clock;
        self.list.push(i);
    }
}

pub struct BruiseOf<'n, 'a>(pub &'n mut Npc<'a>);

impl BruiseOf<'_, '_> {
    fn b(&mut self) -> &mut Bruise {
        &mut self.0.hurt.bruise
    }

    // How much blood is getting round the body, 1 normal; nothing with the heart stopped.
    fn flow(&self) -> f32 {
        let v = &*self.0.vitals;
        if v.beating() && !v.dead { (v.map / 93.0).clamp(0.0, 1.2) } else { 0.0 }
    }

    // Something of `mass` kg at `speed` m/s going `dir` (world) into the skin at crossing `hit`, `tool` what it is
    // (wounds.rs's blow).
    pub fn blow(&mut self, hit: Option<&Crossing>, dir: Vec3, mass: f32, speed: f32, tool: Option<Tool>) {
        let Some(hit) = hit else { return };
        if self.0.hurt.bruise.count == 0 {
            return;
        }
        let energy = 0.5 * mass * speed * speed;
        let what = match tool {
            Some(Tool::Named(n)) => crate::bones::tool(n).filter(|_| n != "wall").unwrap_or(crate::bones::tool("flat").unwrap()),
            Some(Tool::Stiff(k)) => crate::bones::What { k, area: if k < 2e4 { 40.0 } else if k < 1e5 { 30.0 } else { 25.0 } },
            None => crate::bones::tool(if mass < 1.2 && speed > 10.0 { "bat" } else { "flat" }).unwrap(),
        };
        // A bat lands along a line and leaves two bands with a pale strip between (tramlines); anything else a patch.
        let rod = what.k >= 1e5 && what.area < 15.0;
        let contact = (what.area / std::f32::consts::PI).sqrt() / 100.0;
        // (A bat's tissue is torn at the edges of its line, either side of it: the field is as wide as the bands are apart.)
        let sigma = contact * if rod { 0.9 } else { 0.45 };
        // A small hard face puts the same energy into less tissue.
        let peak = (energy / DOSE) * (40.0 / what.area).sqrt().clamp(1.0, 3.0);
        let to_rest = self.0.rest_to_world(hit.owner).inverse();
        let (n, rest) = (hit.rest_normal, hit.rest);
        let d = to_rest.transform_vector3(dir).normalize();
        // The bat's own line, across the way it swung (it swings flat), laid on the skin.
        let mut axis = to_rest.transform_vector3(Vec3::Y).cross(d);
        axis -= n * axis.dot(n);
        if axis.length_squared() < 1e-6 {
            axis = n.cross(if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::X });
        }
        let axis = axis.normalize();
        let flow = self.flow();
        // A body whose heart has just stopped still has blood in its vessels to bruise with, for a minute or two.
        let bleeds = if flow > 0.0 { 1.0 } else { 0.15 * (-self.0.vitals.stopped / 120.0).exp() };
        let (mut worst, mut worst_hit) = (None, 0.0);
        let near = self.0.hurt.bruise.around(rest, (sigma * if rod { 6.0 } else { 3.6 }).max(0.012));
        for (i, dist) in near {
            let b = self.b();
            // (not through to the far side of a lip, an ear or a finger)
            if b.nor[i].dot(n) < 0.15 {
                continue;
            }
            let o = b.pos[i] - rest;
            let mut r2 = dist * dist;
            if rod {
                let along = o.dot(axis);
                r2 -= along * along * (1.0 - 1.0 / 4.84);
            }
            let swells = (-r2 / (2.0 * (sigma * 1.3).powi(2))).exp();
            let hurt = (-r2 / (2.0 * sigma * sigma)).exp();
            // (too little to see: not woken)
            if peak * swells < 0.05 {
                continue;
            }
            let a = b.anvil(i);
            let q = peak * hurt * (0.35 + 0.65 * a);
            let before = b.damage[i];
            b.damage[i] += q;
            let torn = (q * (1.0 + 1.2 * before) - TEARS).max(0.0) * b.lax[i];
            // (all of it through the leak: none out, so none swelling or showing, at the instant of the blow)
            b.leak[i] += torn * LEAK * bleeds;
            b.ery_t[i] = 1.0 - (1.0 - b.ery_t[i]) * (-4.0 * q).exp();
            b.oed_t[i] += peak * swells * (0.35 + 0.65 * a) * (0.5 + a) * b.lax[i] * SWELL;
            if q * a > worst_hit {
                worst_hit = q * a;
                worst = Some(i);
            }
            b.wake(i);
        }
        let kind = if rod { 2.0 } else if peak > 0.6 { 1.0 } else { 0.0 };
        let clock = self.0.hurt.bruise.clock;
        self.b().record(rest, if rod { contact * 0.55 } else { contact }, axis, n, kind, clock);
        if let Some(i) = worst {
            self.split(i, worst_hit, rod.then_some(axis));
        }
        self.nose_blow(rest, peak);
        self.breaks();
    }

    // Skin crushed against bone splits: under one hard blow (a bat), or under one more of many (fists to a brow). A split
    // near one already there opens it further. Its line runs along the bone's edge (a brow, a cheekbone, a jaw) or down a
    // lip; on the scalp along the bat. Torn, not cut: ragged, zig-zag, bruised round (the bruise is ours). The cut itself
    // is marks.rs's (phase 3): its path here.
    fn split(&mut self, i: usize, hit: f32, along: Option<Vec3>) {
        let body = self.0.person.body.clone();
        let (at, n) = (self.0.hurt.bruise.pos[i], self.0.hurt.bruise.nor[i]);
        // (The scalp and face are thin over bone and split far more readily than a limb.)
        let head = at.y > body.bone("jaw").head.y - 0.06 && at.distance(body.bone("head").head) < 0.17;
        let total = self.0.hurt.bruise.damage[i] * self.b().anvil(i);
        if hit < if head { 0.9 } else { 1.8 } && !(total > SPLITS * if head { 1.0 } else { 1.6 } && hit > 0.12) {
            return;
        }
        if let Some(&(_, bleed)) = self.0.hurt.bruise.splits.iter().find(|s| s.0.distance(at) < 0.015) {
            self.0.vitals.bleeds[bleed].rate += if head { 0.0003 } else { 0.0001 };
            return;
        }
        let lip = self.0.hurt.bruise.lax[i] > 1.3 && !self.0.hurt.bruise.eyes.iter().any(|e| at.distance(e.centre) < 0.04);
        let mut way = along.unwrap_or(if lip { Vec3::Y } else { Vec3::X });
        if along.is_none() && !head {
            let d = &mut *self.0.dice;
            way = n.cross(Vec3::new(d.next() - 0.5, d.next() - 0.5, d.next() - 0.5));
        }
        let way = (way - n * way.dot(n)).normalize();
        let side = n.cross(way);
        let long = 0.009 + 0.011 * (hit - 0.4).clamp(0.0, 1.0);
        let steps = 7;
        let mut path = Vec::new();
        for k in 0..=steps {
            let t = k as f32 / steps as f32 - 0.5;
            let jag = if k == 0 || k == steps { 0.0 } else { (self.0.dice.next() - 0.5) * 0.004 };
            if let Some(c) = self.0.nearest_rest(at + way * (t * long) + side * jag, 0.02).filter(|c| c.kind == Kind::Skin) {
                path.push(c);
            }
        }
        if path.len() < 2 {
            return;
        }
        // Torn along `path`, deepest in its middle (marks.rs draws it).
        let deep = 0.0025 + 0.002 * hit.clamp(0.0, 1.0);
        let last = (path.len() - 1) as f32;
        for k in 0..path.len() - 1 {
            let t = (k as f32 + 0.5) / last;
            let s = (std::f32::consts::PI * t).sin();
            self.0.hurt.happened.push(crate::npc::Happened::Slit { a: path[k].clone(), b: path[k + 1].clone(), deep: deep * (0.5 + 0.5 * s), gapes: 0.4 + 0.5 * s });
        }
        let mid = path[path.len() / 2].clone();
        // The scalp and face bleed far more than skin anywhere else split as far.
        let bleed = self.0.vitals.bleed(Bleed::new("laceration", if head { 0.0007 } else { 0.0001 }).clots(0.012).mark(Some(mid.clone())));
        self.0.welling(Some(&mid), 1.2);
        self.b().splits.push((at, bleed));
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + 0.1).min(1.0);
        let place = self.r#where(i, lip);
        self.0.vitals.injure(format!("Skin split by the blow over the {place}"), 2.0);
    }

    fn r#where(&mut self, i: usize, lip: bool) -> String {
        let b = &self.0.hurt.bruise;
        let at = b.pos[i];
        let eye = b.eyes.iter().skip(1).fold(&b.eyes[0], |a, e| if at.distance(a.centre) < at.distance(e.centre) { a } else { e });
        let side = if eye.centre.x < 0.0 { "left" } else { "right" };
        let (dy, de) = (at.y - eye.centre.y, at.distance(eye.centre));
        if lip {
            return "lip".into();
        }
        if de < 0.05 && dy > 0.006 {
            return format!("{side} brow");
        }
        if de < 0.06 && dy < -0.006 && dy > -0.04 {
            return format!("{side} cheekbone");
        }
        if de < 0.11 && dy > 0.04 {
            return "forehead".into();
        }
        if de < 0.12 {
            return if dy < -0.04 { "jaw" } else { "scalp" }.into();
        }
        let owner = b.owner[i];
        let world = self.0.rest_to_world(owner).transform_point3(at);
        let seg = self.0.nearest_name(world).unwrap_or("");
        match crate::wounds::base_of(seg) {
            "upperarm" => "arm",
            "forearm" => "forearm",
            "hand" => "hand",
            "thigh" => "thigh",
            "shin" => "shin",
            "chest" => "ribs",
            "belly" => "belly",
            _ => "bone",
        }
        .into()
    }

    // A blow to the nose makes it bleed from the nostrils (the vessels just inside, Kiesselbach's area), broken or not.
    fn nose_blow(&mut self, rest: Vec3, peak: f32) {
        let Some(tip) = self.nose_tip() else { return };
        if rest.distance(tip) > 0.028 || peak < 0.2 {
            return;
        }
        if self.0.vitals.bleeds.iter().any(|b| b.name == "nosebleed" && b.rate > 2e-5) {
            return;
        }
        // (Below the tip and back from it: -Z is ahead here.)
        let Some(nostril) = self.0.nearest_rest(tip + Vec3::new(0.0, -0.013, 0.007), 0.02).filter(|c| c.kind == Kind::Skin) else { return };
        // (Out of the nostrils, and down the back of the nose into the throat as the head lies: throat.rs.)
        self.0.vitals.bleed(Bleed::new("nosebleed", 0.00008 + 0.0002 * peak.clamp(0.0, 1.5)).clots(0.008).mark(Some(nostril.clone())).into(Into::Nose));
        self.0.welling(Some(&nostril), 0.5);
    }

    // The tip of the nose: the skin furthest forward on the middle line between the eyes and the mouth.
    fn nose_tip(&mut self) -> Option<Vec3> {
        if let Some(n) = self.0.hurt.bruise.nose {
            return n;
        }
        let b = &self.0.hurt.bruise;
        let (l, r) = (b.eyes[0].centre, b.eyes[1].centre);
        let mouth = self.0.body().bone("risorius03.L").head;
        let mid = (l.x + r.x) / 2.0;
        let mut best: Option<usize> = None;
        for i in 0..b.count {
            let p = b.pos[i];
            if (p.x - mid).abs() > 0.006 || p.y > l.y - 0.01 || p.y < mouth.y + 0.008 {
                continue;
            }
            if best.is_none_or(|k| p.z < b.pos[k].z) {
                best = Some(i);
            }
        }
        let tip = best.map(|i| b.pos[i]);
        self.b().nose = Some(tip);
        tip
    }

    // Bones of the face and skull broken since last looked: swelling and bleeding round each. (How the face over it moves
    // with the bone is the look's.)
    fn breaks(&mut self) {
        while self.0.hurt.bruise.seen < self.0.hurt.bones.breaks.len() {
            let br = self.0.hurt.bones.breaks[self.0.hurt.bruise.seen].clone();
            self.b().seen += 1;
            let Some((swell, wide, blood, eyes)) = broke(&br.r#type) else { continue };
            if br.how == "shot" {
                continue;
            }
            let (push, shove) = moves(&br.r#type);
            let b = self.b();
            for (i, dist) in b.around(br.at, wide * 2.5) {
                let w = (-(dist * dist) / (2.0 * wide * wide)).exp();
                b.oed_t[i] += swell * w * b.lax[i] * SWELL * 1.5;
                b.leak[i] += blood * w * LEAK * b.lax[i];
                b.damage[i] += swell * w * 0.5;
                // The face over it moved as the bone under it was.
                let near = (-(dist * dist) / (2.0 * (wide * 0.7).powi(2))).exp();
                let sideways = if br.dir.x == 0.0 { 1.0 } else { br.dir.x.signum() };
                b.shift[i] += -b.nor[i] * push * near + Vec3::X * sideways * shove * near;
                b.sent[i].w = f32::NAN;
                b.wake(i);
            }
            // Blood tracks round the eyes from a broken nose or midface, and from the skull's floor (raccoon eyes).
            let Some(eyes) = eyes else { continue };
            let centres: Vec<Vec3> = b.eyes.iter().map(|e| e.centre).collect();
            for (k, &c) in centres.iter().enumerate() {
                if eyes == "near" && c.distance(br.at) > centres[1 - k].distance(br.at) {
                    continue;
                }
                for (i, dist) in b.around(c + Vec3::new(0.0, -0.006, -0.012), 0.03) {
                    // (behind the eye's middle: the TS's z less, ours more)
                    if b.pos[i].z > c.z + 0.01 {
                        continue;
                    }
                    let w = (-(dist * dist) / (2.0 * 0.012 * 0.012)).exp();
                    b.pool[i] += (if blood > 0.0 { blood } else { 0.8 }) * w * b.lax[i] * 0.5;
                    b.oed_t[i] += (if swell > 0.0 { swell } else { 0.5 }) * w * b.lax[i] * SWELL * 0.6;
                    b.wake(i);
                }
            }
        }
    }

    // --- the skin's own clock ------------------------------------------------------------------------------------------

    // Each frame a share of the places still changing take their step, so that each steps about every TICK and no one
    // frame pays for all of them.
    pub fn update(&mut self, dt: f32) {
        if self.0.hurt.bruise.count == 0 {
            return;
        }
        self.b().clock += dt;
        if self.0.hurt.bruise.seen < self.0.hurt.bones.breaks.len() {
            self.breaks();
        }
        let n = self.0.hurt.bruise.list.len();
        if n > 0 {
            self.step((n as f32 * (dt / TICK).min(1.0)).ceil() as usize);
        } else {
            // Nothing to do: how near the bone is, found ahead of the blows, a little at a time.
            let b = self.b();
            for _ in 0..32 {
                if b.unknown >= b.count {
                    break;
                }
                let i = b.unknown;
                b.anvil(i);
                b.unknown += 1;
            }
        }
        let b = self.b();
        b.wait -= dt;
        if b.wait <= 0.0 {
            b.wait = TICK;
            if b.carry {
                b.carried();
            }
            // An eye swells shut: how swollen the tissue of the lids is, whatever their margins do.
            let swollen: Vec<f32> = b.eyes.iter().map(|e| {
                let sum: f32 = e.lid.iter().map(|&i| {
                    let cap = 0.003 + 0.006 * b.lax[i];
                    cap * (1.0 - (-(b.oed[i] + HAEMATOMA * (b.pool[i] + b.blood[i])) / cap).exp())
                }).sum();
                smooth(0.002, 0.008, if e.lid.is_empty() { 0.0 } else { sum / e.lid.len() as f32 })
            }).collect();
            b.swollen = (swollen[0], swollen[1]);
        }
    }

    fn step(&mut self, quota: usize) {
        let flow = self.flow();
        // A stopped heart lets a torn vessel ooze a little, briefly.
        let late = if flow > 0.0 { flow } else { 0.15 * (-self.0.vitals.stopped / 120.0).exp() };
        let mut down: HashMap<usize, Vec3> = HashMap::new();
        let mut n = 0.0f32;
        while n < quota as f32 && !self.0.hurt.bruise.list.is_empty() {
            n += 1.0;
            let b = &mut self.0.hurt.bruise;
            if b.next >= b.list.len() {
                b.next = 0;
            }
            let i = b.list[b.next];
            // A place only slowly settling (no blood still coming, its swelling up) steps once a second.
            if b.leak[i] == 0.0 && b.pool[i] < 0.02 && b.clock - b.last[i] < QUIET && (b.oed_t[i] - b.oed[i]).abs() < 2e-4 {
                b.next += 1;
                n -= 0.875;
                continue;
            }
            let dt = (QUIET * 1.5).min(b.clock - b.last[i]);
            b.last[i] = b.clock;
            if b.leak[i] > 0.0 {
                b.pool[i] += b.leak[i] * dt * late;
                b.leak[i] *= (-dt / if flow > 0.0 { CLOTS } else { 60.0 }).exp();
                if b.leak[i] < 1e-5 {
                    b.leak[i] = 0.0;
                }
            }
            // Blood out comes up to show: over bone in tens of minutes, through thick flesh over hours.
            if b.pool[i] > 0.0 {
                let a = b.anvil(i);
                let up = b.pool[i] * (dt / (SHOWS + DEEP * (1.0 - a))).min(1.0);
                b.pool[i] -= up;
                b.age[i] = (b.age[i] * b.blood[i]) / (b.blood[i] + up + 1e-9);
                b.blood[i] += up;
            }
            b.age[i] += dt;
            // Redness needs blood coming: it goes from a dead face within seconds.
            b.ery[i] += (b.ery_t[i] * flow.min(1.0) - b.ery[i]) * (dt / if flow > 0.0 { REDDENS } else { 15.0 }).min(1.0);
            b.ery_t[i] *= (-dt / FADES).exp();
            if flow > 0.0 {
                b.oed[i] += (b.oed_t[i] - b.oed[i]) * ((dt * flow) / SWELLS).min(1.0);
            }
            if b.blood[i] > 1e-4 || b.pool[i] > 1e-4 {
                let owner = b.owner[i];
                let g = *down.entry(owner).or_insert_with(|| self.0.rest_to_world(owner).inverse().transform_vector3(Vec3::NEG_Y).normalize());
                self.spread(i, if flow > 0.0 { dt } else { dt * 0.3 }, g);
            }
            let b = &mut self.0.hurt.bruise;
            b.touch(i);
            // What is still changing stays on the clock; what has settled leaves it.
            let busy = b.leak[i] > 0.0 || b.pool[i] > 2e-3 || b.ery_t[i] > 0.004 || (b.ery[i] - b.ery_t[i] * flow.min(1.0)).abs() > 0.004
                || (flow > 0.0 && b.oed_t[i] - b.oed[i] > 2e-5) || (b.blood[i] > 0.01 && b.age[i] < 3.0 * BLUES);
            if busy {
                b.next += 1;
                continue;
            }
            b.active[i] = false;
            let last = b.list.pop().unwrap();
            if b.next < b.list.len() {
                let k = b.next;
                b.list[k] = last;
            }
        }
    }

    // Blood out from place `i` spreads to where there is less, slower as it clots, into lax tissue most; and creeps
    // downhill (`g`, the world's down in its bone's rest frame), the deep blood faster, along the planes between the
    // layers; slower with no heart pushing it. (An edge between two places both on the clock is taken half by each.)
    fn spread(&mut self, i: usize, dt: f32, g: Vec3) {
        let b = self.b();
        let slow = (-b.age[i] / SETTLES).exp();
        let li = b.lax[i];
        for e in b.e_start[i]..b.e_start[i + 1] {
            let (j, len) = (b.e_to[e], b.e_len[e]);
            let lj = b.lax[j];
            let half = if b.active[j] { 0.5 } else { 1.0 };
            let w = ((SPREADS * slow * dt) / (len * len)).min(0.08) * li.min(lj);
            let hill = (b.pos[j] - b.pos[i]).dot(g) / len;
            let sink = ((SINKS * dt) / len).min(0.1) * hill;
            let track = ((TRACKS * dt) / len).min(0.15) * hill;
            let mut fb = w * (b.blood[i] / li - b.blood[j] / lj);
            let mut fp = w * (b.pool[i] / li - b.pool[j] / lj);
            fb = (fb + if sink > 0.0 { sink * b.blood[i] * slow } else { sink * b.blood[j] * slow }) * half;
            fp = (fp + if track > 0.0 { track * b.pool[i] } else { track * b.pool[j] }) * half;
            fb = clampf(fb, -b.blood[j] * 0.5, b.blood[i] * 0.5);
            fp = clampf(fp, -b.pool[j] * 0.5, b.pool[i] * 0.5);
            if fb > 0.0 {
                b.age[j] = (b.age[j] * b.blood[j] + b.age[i] * fb) / (b.blood[j] + fb);
            }
            b.blood[i] -= fb;
            b.blood[j] += fb;
            b.pool[i] -= fp;
            b.pool[j] += fp;
            if !b.active[j] && (fb.abs() > 1e-4 || fp.abs() > 1e-4) {
                b.wake(j);
            }
        }
    }
}

// --- what is drawn of it ----------------------------------------------------------------------------------------------
//
// skin.wesl's vertex shader moves each corner out by its swelling (and the bone under it) before the skeleton moves it,
// and tips its normal by the swelling's slope; its fragment shader colours the skin by what is in it. Both read each
// corner's numbers from the person's table (skin.rs), written here only where they changed enough to see.

impl Bruise {
    // Place `i` drawn again if it changed enough to see, and the places round it if its swelling did (it bends their
    // normals too).
    fn touch(&mut self, i: usize) {
        let cap = 0.003 + 0.006 * self.lax[i];
        let swollen = self.oed[i] + HAEMATOMA * (self.pool[i] + self.blood[i]);
        let h = cap * (1.0 - (-swollen / cap).exp()) * self.rim[i] * (1.0 - SQUEEZE * self.press[i]);
        self.h[i] = h;
        let w = self.sent[i];
        let blue = 1.0 - (-self.age[i] / BLUES).exp();
        let moved = !((h - w.w).abs() < 6e-5);
        if !moved && (self.ery[i] - w.x).abs() < 0.004 && (self.blood[i] - w.y).abs() < 0.004 && (blue - w.z).abs() < 0.02 {
            return;
        }
        self.sent[i] = Vec4::new(self.ery[i], self.blood[i], blue, h);
        self.write(i);
        if moved {
            for e in self.e_start[i]..self.e_start[i + 1] {
                self.write(self.e_to[e]);
            }
        }
    }

    // What the shader reads at place `i`'s corners: its colour (redness, blood showing, how blue that blood has gone,
    // swelling in cm), how far it moved (swollen out along its normal, and the bone under it moved), and how its normal
    // tips with the swelling's slope (the change to each neighbour along the way to it, over how far).
    fn write(&mut self, i: usize) {
        let (p, h) = (self.pos[i], &self.h);
        let mut g = Vec3::ZERO;
        let mut wsum = 0.0;
        for e in self.e_start[i]..self.e_start[i + 1] {
            let j = self.e_to[e];
            let x = self.pos[j] - p;
            g += x * (h[j] - h[i]);
            wsum += x.length_squared();
        }
        let n = self.nor[i];
        if wsum > 0.0 {
            g *= 2.0 / wsum;
        }
        g -= n * g.dot(n);
        let s = n * h[i] + self.shift[i];
        let tint = Vec4::new(self.ery[i], self.blood[i], self.sent[i].z, h[i] * 100.0);
        self.carry = true;
        for k in self.v_start[i]..self.v_start[i + 1] {
            let v = self.v_list[k] as usize;
            let f = -(self.flip[v] as f32);
            self.out[v] = [tint, s.extend(0.0), (g * f).extend(0.0)];
            self.mark(v);
        }
    }

    fn mark(&mut self, v: usize) {
        if !self.dirty[v] {
            self.dirty[v] = true;
            self.changed.push(v as u32);
        }
    }

    // What skin.rs takes each frame: the corners changed (their `out` read, and they are clean again).
    pub fn taken(&mut self, v: u32) {
        self.dirty[v as usize] = false;
    }

    // A layer over the skin to be carried out by its swelling: corners at rest positions `at`, standing `base` m off the
    // skin where they lie on it, pressing on it by `tight` (0 to 1) where they do; its shifts kept in `out` at `slots`
    // (corners of the body), or given slots of its own (a mesh of its own: a dressing, whose first slot is returned
    // with the rider's number). None if there is no room left for it.
    pub fn ride(&mut self, at: &[Vec3], base: f32, tight: f32, slots: Option<Vec<u32>>) -> Option<(usize, u32)> {
        let slots = match slots {
            Some(s) => s,
            None => {
                if self.slots + at.len() > self.out.len() {
                    return None;
                }
                self.slots += at.len();
                ((self.slots - at.len()) as u32..self.slots as u32).collect()
            }
        };
        let mut place = vec![-1i32; at.len()];
        let mut gap = vec![0.0f32; at.len()];
        for (k, &p) in at.iter().enumerate() {
            let mut best = MET;
            for (i, d) in self.around(p, MET) {
                let off = (p - self.pos[i]).dot(self.nor[i]);
                if off > -0.003 && d < best {
                    best = d;
                    place[k] = i as i32;
                    gap[k] = (off - base).max(0.0);
                }
            }
        }
        let first = slots.first().copied().unwrap_or(0);
        self.riders.push(Some(Rider { slots, place, gap, tight }));
        self.pressed();
        self.carry = true;
        self.carried();
        Some((self.riders.len() - 1, first))
    }

    pub fn unride(&mut self, k: usize) {
        if let Some(r) = self.riders.get_mut(k) {
            *r = None;
            self.pressed();
        }
    }

    // How hard what lies on each place presses on it: a tight layer touching it all of its own `tight`, nothing from one
    // standing 3 mm or more off. Places whose press changed are put back on the clock to swell to it.
    fn pressed(&mut self) {
        let was = std::mem::replace(&mut self.press, vec![0.0; self.count]);
        for r in self.riders.iter().flatten() {
            for (k, &i) in r.place.iter().enumerate() {
                if i >= 0 {
                    let i = i as usize;
                    self.press[i] = self.press[i].max(r.tight * (1.0 - smooth(0.0, 0.003, r.gap[k])));
                }
            }
        }
        for i in 0..self.count {
            if self.press[i] != was[i] && self.oed[i] + self.pool[i] + self.blood[i] > 0.0 {
                self.wake(i);
            }
        }
    }

    // Every layer moved out by as much of the swelling under it as reaches it.
    fn carried(&mut self) {
        self.carry = false;
        for r in 0..self.riders.len() {
            let Some(rider) = self.riders[r].take() else { continue };
            for (k, &i) in rider.place.iter().enumerate() {
                if i < 0 {
                    continue;
                }
                let i = i as usize;
                let out = (self.h[i] - rider.gap[k]).max(0.0);
                let x = self.nor[i] * out + self.shift[i];
                let v = rider.slots[k] as usize;
                if (self.out[v][1].truncate() - x).abs().element_sum() < 2e-5 {
                    continue;
                }
                self.out[v][1] = x.extend(0.0);
                self.mark(v);
            }
            self.riders[r] = Some(rider);
        }
    }

    // A recent blow's shape, for the shader. Kind 0 (nothing to draw but the field itself) is not kept.
    fn record(&mut self, at: Vec3, wide: f32, axis: Vec3, n: Vec3, kind: f32, clock: f32) {
        if kind == 0.0 {
            return;
        }
        if self.records.len() == RECORDS {
            self.records.remove(0);
        }
        self.records.push([at.extend(wide), axis.extend(kind), n.extend(clock)]);
    }
}
