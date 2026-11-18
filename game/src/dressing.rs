// Dressings (src/sandbox/dressing.ts): the kit as it is held or hung on the board (buildKit), a roll of gauze and a
// medkit pouch, built in code; and what a dressing does to the bleeding under it (below, "a dressing on a wound"). Its
// look (the gauze laid on the skin and skinned to it, the blood showing through it) is phase 3's.

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::rng::Rng;

const ROLL: f32 = 0.1; // the gauze roll is 10 cm wide

// One mesh of a thing built in code, with its material and where it sits in the thing.
#[derive(Clone)]
pub struct Piece {
    pub mesh: Handle<Mesh>,
    pub material: Handle<StandardMaterial>,
    pub at: Transform,
}

// A canvas of `w` by `h` (sRGB bytes), painted on with alpha as a 2D canvas paints.
struct Canvas {
    w: usize,
    h: usize,
    px: Vec<[f32; 3]>,
}

impl Canvas {
    fn new(w: usize, h: usize, c: [u8; 3]) -> Self {
        Canvas { w, h, px: vec![c.map(|x| x as f32); w * h] }
    }

    fn put(&mut self, x: i32, y: i32, c: [u8; 3], a: f32) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        for i in 0..3 {
            p[i] += (c[i] as f32 - p[i]) * a;
        }
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: [u8; 3], a: f32) {
        for yy in y.round() as i32..(y + h).round() as i32 {
            for xx in x.round() as i32..(x + w).round() as i32 {
                self.put(xx, yy, c, a);
            }
        }
    }

    // A circle's outline a pixel wide (an arc stroked), or filled.
    fn circle(&mut self, cx: f32, cy: f32, r: f32, c: [u8; 3], a: f32, fill: bool) {
        for y in (cy - r - 1.0) as i32..=(cy + r + 1.0) as i32 {
            for x in (cx - r - 1.0) as i32..=(cx + r + 1.0) as i32 {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let cover = if fill { (r - d + 0.5).clamp(0.0, 1.0) } else { (1.0 - (d - r).abs()).clamp(0.0, 1.0) };
                if cover > 0.0 {
                    self.put(x, y, c, a * cover);
                }
            }
        }
    }

    fn image(&self) -> Image {
        let data = self.px.iter().flat_map(|p| [p[0].round() as u8, p[1].round() as u8, p[2].round() as u8, 255]).collect();
        Image::new(Extent3d { width: self.w as u32, height: self.h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data,
                   TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::default())
    }
}

// Each corner's u put in the left half of the texture where `left` says, the right half elsewhere.
fn halves(mut mesh: Mesh, left: impl Fn(Vec3) -> bool) -> Mesh {
    let normals: Vec<Vec3> = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(n)) => n.iter().map(|&n| Vec3::from(n)).collect(),
        _ => unreachable!(),
    };
    if let Some(VertexAttributeValues::Float32x2(uv)) = mesh.attribute_mut(Mesh::ATTRIBUTE_UV_0) {
        for (t, n) in uv.iter_mut().zip(normals) {
            t[0] = if left(n) { t[0] * 0.5 } else { 0.5 + t[0] * 0.5 };
        }
    }
    mesh
}

// A tube of `radius` along `path`, `sides` round.
fn tube(path: &[Vec3], radius: f32, sides: usize) -> Mesh {
    let (mut p, mut n, mut uv, mut i) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (k, &at) in path.iter().enumerate() {
        let along = (path[(k + 1).min(path.len() - 1)] - path[k.saturating_sub(1)]).normalize();
        let a = along.any_orthonormal_vector();
        let b = along.cross(a);
        for s in 0..=sides {
            let t = s as f32 / sides as f32 * std::f32::consts::TAU;
            let out = a * t.cos() + b * t.sin();
            p.push(at + out * radius);
            n.push(out);
            uv.push(Vec2::new(s as f32 / sides as f32, k as f32 / (path.len() - 1) as f32));
        }
    }
    let ring = sides as u32 + 1;
    for k in 0..path.len() as u32 - 1 {
        for s in 0..sides as u32 {
            let (a, b) = (k * ring + s, (k + 1) * ring + s);
            i.extend([a, a + 1, b, b, a + 1, b + 1]);
        }
    }
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, p)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, n)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(i))
}

// The bandage roll and the medkit, as the TS built them (in its space, brought over by main.rs `babylon`: a turn about
// X or Z the other way).
pub fn kit(meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, images: &mut Assets<Image>, rng: &mut Rng) -> [(&'static str, Vec<Piece>); 2] {
    // Left half: the outside of the roll, its crinkled weave. Right half: an end, the turns showing as rings.
    let mut gauze = Canvas::new(256, 256, [238, 237, 231]);
    for x in (0..128).step_by(2) {
        let (c, a) = if x % 4 != 0 { ([150, 145, 135], 0.2) } else { ([255, 255, 255], 0.4) };
        gauze.rect(x as f32, 0.0, 1.0, 256.0, c, a);
    }
    let mut r = 10.0;
    while r < 62.0 {
        gauze.circle(192.0, 128.0, r, [150, 145, 135], 0.15 + rng.next() * 0.2, false);
        r += 2.2;
    }
    gauze.circle(192.0, 128.0, 9.0, [205, 200, 188], 1.0, true);
    let white = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(gauze.image())),
        metallic: 0.0,
        perceptual_roughness: 0.95,
        double_sided: true,
        cull_mode: None,
        ..default()
    });
    let body = halves(Cylinder::new(0.025, ROLL).mesh().resolution(28).into(), |n| n.y.abs() < 0.5);
    let bandage = vec![
        Piece { mesh: meshes.add(body), material: white.clone(), at: Transform::from_rotation(Quat::from_rotation_z(-std::f32::consts::FRAC_PI_2)) },
        Piece {
            mesh: meshes.add(Rectangle::new(ROLL, 0.07)),
            material: white,
            at: Transform::from_translation(crate::babylon(0.0, -0.035, -0.025)).with_rotation(Quat::from_rotation_x(-0.15)),
        },
    ];

    // Left: the front, nylon with the cross on it. Right: the rest of the pouch, plain.
    let mut face = Canvas::new(512, 256, [18, 104, 58]);
    for x0 in [0.0, 256.0] {
        face.rect(x0, 0.0, 256.0, 256.0, [18, 104, 58], 1.0);
        for _ in 0..2500 {
            let (c, a) = if rng.next() < 0.5 { ([0, 0, 0], 0.12) } else { ([255, 255, 255], 0.05) };
            let (x, y) = (x0 + rng.next() * 256.0, rng.next() * 256.0);
            face.rect(x, y, 2.0, 1.0, c, a);
        }
        // The stitching round the edge, dashed.
        let mut t = 0.0;
        while t < 960.0 {
            for d in 0..6 {
                let s = t + d as f32;
                let (x, y) = if s < 240.0 { (8.0 + s, 8.0) } else if s < 480.0 { (248.0, 8.0 + s - 240.0) } else if s < 720.0 { (248.0 - (s - 480.0), 248.0) } else { (8.0, 248.0 - (s - 720.0)) };
                face.rect(x0 + x - 1.5, y - 1.5, 3.0, 3.0, [0, 0, 0], 0.45);
            }
            t += 10.0;
        }
    }
    face.rect(128.0 - 22.0, 128.0 - 70.0, 44.0, 140.0, [240, 240, 236], 1.0);
    face.rect(128.0 - 70.0, 128.0 - 22.0, 140.0, 44.0, [240, 240, 236], 1.0);
    let nylon = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(face.image())),
        metallic: 0.0,
        perceptual_roughness: 0.75,
        ..default()
    });
    // (The cross on the faces ahead and behind, the rest plain.)
    let pouch = halves(Cuboid::new(0.22, 0.15, 0.08).into(), |n| n.z.abs() > 0.5);
    let strap: Vec<Vec3> = (0..9).map(|k| {
        let t = k as f32 / 8.0;
        crate::babylon(-0.06 + 0.12 * t, 0.075 + (std::f32::consts::PI * t).sin() * 0.035, 0.0)
    }).collect();
    let black = materials.add(StandardMaterial { base_color: Color::linear_rgb(0.03, 0.03, 0.03), metallic: 0.0, perceptual_roughness: 0.8, ..default() });
    let medkit = vec![
        Piece { mesh: meshes.add(pouch), material: nylon, at: Transform::IDENTITY },
        Piece { mesh: meshes.add(tube(&strap, 0.006, 8)), material: black, at: Transform::IDENTITY },
    ];
    [("bandage", bandage), ("medkit", medkit)]
}

// --- a dressing on a wound ------------------------------------------------------------------------------------------
//
// A dressing is gauze held down hard on a wound. What it does to the bleeding is what pressure does: a vein or the small
// vessels of skin and muscle close under it and stop within a minute or two; an artery's pressure is far above what a
// bandage can press with, so it only slows (a limb artery needs a tourniquet, or packing and a minute or more of hard
// pressure on top: TCCC guidelines; Kragh et al. 2008); and nothing pressed on the skin closes a torn liver or spleen
// under it, it only holds the wall's hole a little shut. The figures are in DRESSED.
//
// What is put on depends on where the wound is: a pad taped over a wound on the trunk, face or neck, a gauze roll wound
// round an arm or a leg, a roller bandage round the head over a pad on the scalp (and round the end of a stump: phase
// 3's, with the cutting). The blood still coming out of the wound goes into the gauze, which takes up about what gauze
// does (GAUZE); once it is full the rest runs out from under it (runs.rs).
//
// The player's side (who is looked at, the button held for SECONDS, the medkit's worst-first order: the TS's Medic) is
// the hands' (weapons.rs): `wounds(npc)` lists what can be dressed, `dress(npc, &wound)` puts one on.

use crate::npc::{Crossing, Happened, Npc};
use crate::vitals::Bleed;

// What a dressing leaves of a vessel's flow, by kind of bleeding.
const DRESSED_SEEPING: f32 = 0.05;
const DRESSED_ARTERIAL: f32 = 0.35;
const DRESSED_INSIDE: f32 = 0.75;
// Millilitres of blood a square centimetre of the dressing holds: a 12-ply gauze pad takes up about 0.15, a few turns of
// open gauze roll about half that (gauze takes up several times its weight; a 10 cm pad weighs a few grams).
const GAUZE_PAD: f32 = 0.15;
const GAUZE_WRAP: f32 = 0.08;
pub const SECONDS: f32 = 4.0; // to put one on: a game's few seconds for what takes a minute with pressure held
pub const REACH: f32 = 1.9; // metres from the eye to a wound that can be reached (one on the floor, kneeling down to it)
const SIDE: f32 = 0.05; // half a 10 cm pad
const FACE: f32 = 0.035; // half the 7 cm pad put on a face or a neck
const BAND: f32 = 0.07; // the roller bandage wound round a head is 7 cm wide

// How a bleed is helped: anything inside the body, an artery open to the air, or the rest.
fn helped(b: &Bleed) -> f32 {
    if b.internal { DRESSED_INSIDE } else if b.arterial { DRESSED_ARTERIAL } else { DRESSED_SEEPING }
}

// An open wound: its place on the skin, where it is now and which way it faces, its bleeds (indices), what is coming out
// of them all.
#[derive(Clone, Debug)]
pub struct OpenWound {
    pub mark: Crossing,
    pub at: Vec3,
    pub normal: Vec3,
    pub bleeds: Vec<usize>,
    pub flow: f32,
}

// Where on the body (rest space) a dressing lies over, so that a bleed coming out there is under it.
#[derive(Clone, Debug)]
pub enum Covers {
    // A pad square on the skin round `c`, its sides along `ex` and `ey`, `side` half its width.
    Pad { c: Vec3, n: Vec3, ex: Vec3, ey: Vec3, side: f32 },
    // A roll round a limb from `a` along `axis`, from `low` to `high` along it, out to `far` from it.
    Wrap { a: Vec3, axis: Vec3, low: f32, high: f32, far: f32 },
    // A bandage round the head, its middle plane through `mid` square to `m`, round the skull's middle `o`.
    Band { mid: Vec3, m: Vec3, o: Vec3 },
    // Over the end of a stump, the cut through `c` square to `n` (away from the body), and wound round the stump from the
    // end back up it by a roll's width: `rim` is the skin's outline round the end, `r` how far out it is on the whole.
    Stump { c: Vec3, n: Vec3, r: f32, rim: Vec<Vec3> },
}

impl Covers {
    pub fn covers(&self, r: Vec3) -> bool {
        match *self {
            Covers::Pad { c, n, ex, ey, side } => {
                let d = r - c;
                d.dot(ex).abs() < side + 0.01 && d.dot(ey).abs() < side + 0.01 && d.dot(n).abs() < 0.03
            }
            Covers::Wrap { a, axis, low, high, far } => {
                let p = (r - a).dot(axis);
                p > low - 0.01 && p < high + 0.01 && (r - a - axis * p).length() < far
            }
            Covers::Band { mid, m, o } => (r - mid).dot(m).abs() < BAND / 2.0 + 0.01 && r.distance(o) < 0.16,
            Covers::Stump { c, n, r: out, .. } => {
                let along = (r - c).dot(n);
                along > -ROLL - 0.01 && along < 0.03 && (r - c - n * along).length() < out * 1.45 + 0.02
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct Dressing {
    pub mark: Crossing,
    pub kind: &'static str,
    pub covers: Covers,
    // ml a square centimetre holds, ml it holds in all, ml in it now, seconds since blood last came into it.
    pub per: f32,
    pub capacity: f32,
    pub held: f32,
    pub since: f32,
    // How many of the person's cuts (dismember.rs) it has been through (None until `severed` first sees it), and whether
    // it has come away with one (kept in the list, so that the look's list, skin.rs's, keeps its places).
    pub seen: Option<usize>,
    pub off: bool,
}

// Two directions square to unit `n` and to each other, the first as near to up as it can be.
fn frame(n: Vec3) -> (Vec3, Vec3) {
    let hint = if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::NEG_Z };
    let ey = (hint - n * hint.dot(n)).normalize();
    (ey.cross(n).normalize(), ey)
}

// Andrew's monotone chain: the hull of 2D points, counter-clockwise (behaviour.ts convexHull).
fn convex_hull(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut p = points.to_vec();
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

// The wounds on the person that are open (any of their bleeds undressed) and come out through the skin (a bleed outside,
// or a bullet's way out, which is where what it tore inside comes out): bleeds within 4 cm of each other, now, are one
// wound. Worst first.
pub fn wounds(npc: &Npc) -> Vec<OpenWound> {
    let mut list: Vec<(OpenWound, bool, bool)> = Vec::new();
    for (k, b) in npc.vitals.bleeds.iter().enumerate() {
        let Some(mark) = &b.source.mark else { continue };
        let (at, normal) = npc.world_of(mark.rest, mark.owner, Some(mark.rest_normal));
        let i = match list.iter().position(|w| w.0.at.distance(at) < 0.04) {
            Some(i) => i,
            None => {
                list.push((OpenWound { mark: mark.clone(), at, normal: normal.unwrap(), bleeds: Vec::new(), flow: 0.0 }, false, false));
                list.len() - 1
            }
        };
        let w = &mut list[i];
        w.0.bleeds.push(k);
        w.0.flow += b.flow;
        if !b.internal || mark.open {
            w.1 = true;
        }
        if b.dressed.is_none() {
            w.2 = true;
        }
    }
    let mut out: Vec<OpenWound> = list.into_iter().filter(|w| w.1 && w.2).map(|w| w.0).collect();
    out.sort_by(|a, b| b.flow.total_cmp(&a.flow));
    out
}

// Put a dressing on wound `w` (from wounds()): every bleed under it, this wound's and any other it covers, is helped as
// DRESSED says and comes out into it. Its index in the person's dressings.
pub fn dress(npc: &mut Npc, w: &OpenWound) -> Option<usize> {
    let d = npc.dressing(&w.mark)?;
    npc.hurt.dressings.push(d);
    let k = npc.hurt.dressings.len() - 1;
    let covers = npc.hurt.dressings[k].covers.clone();
    for (i, b) in npc.vitals.bleeds.iter_mut().enumerate() {
        let under = b.source.mark.as_ref().is_some_and(|m| covers.covers(m.rest));
        if !w.bleeds.contains(&i) && !under {
            continue;
        }
        b.dressed = Some(helped(b));
        b.dressing = Some(k);
    }
    Some(k)
}

impl Npc<'_> {
    // A dressing for the wound at `mark`: where it lies and how much it holds (the TS's Dressing `_shape`, its geometry
    // for the look left to phase 3). None where nothing can be put on (a stump: phase 3's, with the cutting).
    fn dressing(&self, mark: &Crossing) -> Option<Dressing> {
        let body = self.body();
        let layer = self.hurt.dressings.iter().filter(|d| !d.off && d.covers.covers(mark.rest)).count();
        let lift = 0.0028 + layer as f32 * 0.003;
        // Where on the head or neck a wound is: 'face' (below the brows, in front: a pad taped on), 'scalp' (the forehead
        // above the brows, the temples, the crown, the back: a pad held by a roller bandage wound round the head), 'neck'
        // (a pad taped on: nothing is wound round a neck), or none off the head and neck.
        let mut region = None;
        let mut at = Some(mark.owner);
        while let Some(b) = at {
            let name = &body.bones[b].name;
            if name.starts_with("neck0") && name.len() == 6 {
                region = Some("neck");
                break;
            }
            if name == "head" {
                let eye = body.bone("eye.L").head;
                // (Facing forward: -Z here, the TS's +Z.)
                region = Some(if mark.rest.y < eye.y + 0.025 && mark.rest_normal.z < 0.2 { "face" } else { "scalp" });
                break;
            }
            if name.starts_with("spine") {
                break;
            }
            at = body.bones[b].parent;
        }
        let make = |kind, covers, per: f32, area: f32| Some(Dressing { mark: mark.clone(), kind, covers, per, capacity: area * 1e4 * per, held: 0.0, since: 0.0, seen: None, off: false });
        // A stump's end (the bleeding out of its cut face): the gauze over the end and wound back up the stump, as a stump
        // is dressed.
        let spread = |c: Vec3, rim: &[Vec3]| rim.iter().map(|q| q.distance(c)).sum::<f32>() / rim.len().max(1) as f32;
        if let Some((c, n, rim)) = self.hurt.stumps.iter().find(|(c, n, rim)| (mark.rest - *c).dot(*n).abs() < 0.012 && mark.rest.distance(*c) < spread(*c, rim) * 1.5) {
            let r = spread(*c, rim);
            let round = 2.0 * std::f32::consts::PI * (r + lift);
            return make("wrap", Covers::Stump { c: *c, n: *n, r, rim: rim.clone() }, GAUZE_WRAP, round * ROLL + std::f32::consts::PI * r * r);
        }
        match region {
            Some("face") | Some("neck") => {
                let (ex, ey) = frame(mark.rest_normal);
                make("pad", Covers::Pad { c: mark.rest, n: mark.rest_normal, ex, ey, side: FACE }, GAUZE_PAD, 4.0 * FACE * FACE)
            }
            Some(_) => self.band(mark),
            None => {
                let owner = &body.bones[mark.owner];
                let limb = ["upperarm", "lowerarm", "upperleg", "lowerleg"].iter().any(|l| owner.name.contains(l));
                if !limb {
                    // A pad, square on the skin, centred on the wound, its sides along the body and across it.
                    let (ex, ey) = frame(mark.rest_normal);
                    return make("pad", Covers::Pad { c: mark.rest, n: mark.rest_normal, ex, ey, side: SIDE }, GAUZE_PAD, 4.0 * SIDE * SIDE);
                }
                // Round a limb: the line it runs along, and how far out its skin is at the wound.
                let (a, axis) = (owner.head, (owner.tail - owner.head).normalize());
                let p0 = (mark.rest - a).dot(axis);
                let r0 = (mark.rest - a - axis * p0).length();
                let round = 2.0 * std::f32::consts::PI * (r0 + lift);
                make("wrap", Covers::Wrap { a, axis, low: p0 - ROLL / 2.0, high: p0 + ROLL / 2.0, far: r0 * 1.45 + 0.02 }, GAUZE_WRAP, round * ROLL)
            }
        }
    }

    // Round the head, a band: the roller bandage's turns, taut over the skull and the hair as a bandage pulled round it is
    // (the convex outline of the head across its middle line), through the wound and round the back below the occiput,
    // or across the forehead above the brows for one at the back. How much it holds is its length round by its width.
    fn band(&self, mark: &Crossing) -> Option<Dressing> {
        let body = self.body();
        let k = self.segment("head")?;
        let seg = &self.person.segments[k];
        let crate::ragdoll::Shape::Ball { centre, .. } = seg.shape else { return None };
        let o = centre + seg.head;
        let head = body.bone("head");
        let up = (head.tail - head.head).normalize();
        let ahead = Vec3::NEG_Z;
        let fwd = (ahead - up * up.dot(ahead)).normalize();
        let eye = body.bone("eye.L").head;
        let c = mark.rest;
        let way = ((c - o) - up * (c - o).dot(up)).normalize();
        // The turns pass through the wound and, on the far side of the head, above the brows in front, above the ears at the
        // side, under the bump of the occiput at the back (where they hold without sliding up off it).
        let f = -way.dot(fwd);
        let rise = if f > 0.0 { 0.02 + 0.015 * f } else { 0.02 + 0.03 * f };
        let mut anchor = o - way * 0.09;
        anchor += up * (eye.y + rise - anchor.y);
        let across = up.cross(way).normalize();
        let mut m = (c - anchor).cross(across).normalize();
        if m.dot(up) < 0.0 {
            m = -m;
        }
        let mid = o - m * (o - c).dot(m);
        let e0 = (c - mid).normalize();
        let e1 = m.cross(e0).normalize();
        // The outline of the head (and hair) across the middle line of the band, and how far round it is.
        let neck = body.bone("neck02").head.y;
        let mut flat = Vec::new();
        for p in body.parts.iter().filter(|p| ["skin", "hair", "eyes", "brows"].contains(&p.kind.as_str())) {
            for v in p.vertex_start..p.vertex_start + p.vertex_count {
                let q = body.position[v];
                if q.distance(o) >= 0.17 || q.y <= neck {
                    continue;
                }
                let d = q - mid;
                if d.dot(m).abs() < 0.007 {
                    flat.push([d.dot(e0), d.dot(e1)]);
                }
            }
        }
        if flat.len() < 8 {
            return None;
        }
        let hull = convex_hull(&flat);
        const COLS: usize = 72;
        let middle: Vec<f32> = (0..COLS).map(|k| {
            let th = (k as f32 / COLS as f32) * std::f32::consts::TAU;
            let (dx, dy) = (th.cos(), th.sin());
            let mut far = 0.0f32;
            for q in 0..hull.len() {
                let ([ax, ay], [bx, by]) = (hull[q], hull[(q + 1) % hull.len()]);
                let (ex, ey) = (bx - ax, by - ay);
                let den = dx * ey - dy * ex;
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = (ax * ey - ay * ex) / den;
                let u = (ax * dy - ay * dx) / den;
                if t > 0.0 && (0.0..=1.0).contains(&u) {
                    far = far.max(t);
                }
            }
            far
        }).collect();
        let step = std::f32::consts::TAU / COLS as f32;
        let round: f32 = (0..COLS).map(|k| (middle[k] * step.cos() - middle[(k + 1) % COLS]).hypot(middle[k] * step.sin())).sum();
        Some(Dressing { mark: mark.clone(), kind: "wrap", covers: Covers::Band { mid, m, o }, per: GAUZE_WRAP, capacity: round * BAND * 1e4 * GAUZE_WRAP, held: 0.0, since: 0.0, seen: None, off: false })
    }

    // Blood out of the wound under dressing `d` this frame (bleed `b`, `ml`): into the gauze until it is full, then out
    // from under it.
    pub fn dressing_take(&mut self, d: usize, b: usize, ml: f32) {
        let dr = &mut self.hurt.dressings[d];
        dr.held += ml;
        dr.since = 0.0;
        let over = dr.held - dr.capacity;
        if over > 0.0 {
            dr.held = dr.capacity;
            if let Some(mark) = self.vitals.bleeds[b].source.mark.clone() {
                self.hurt.happened.push(Happened::Runs { hit: mark, ml: over, from: Some(b) });
            }
        }
    }

    // A new wound under a dressing (shot through it): its blood goes into the gauze too, but nothing presses on it. (A
    // limb cut off since it was put on is `severed`'s.)
    pub fn dressings_update(&mut self, dt: f32) {
        for k in 0..self.hurt.dressings.len() {
            if self.hurt.dressings[k].off {
                continue;
            }
            self.hurt.dressings[k].since += dt;
            let covers = self.hurt.dressings[k].covers.clone();
            for b in &mut self.vitals.bleeds {
                if b.dressing.is_none() && b.source.mark.as_ref().is_some_and(|m| covers.covers(m.rest)) {
                    b.dressing = Some(k);
                }
            }
        }
    }
}

// A limb cut off since a dressing was put on (dressing.ts `_severed`, dismember.rs's cuts). Cut through, it comes away (it
// is cut through as the limb is): its bleeds are undressed and it is no longer drawn. Wholly on the piece, it goes with
// it; wholly on the body, it stays; either way its corners are carried only by the bones of their side, as the skin's are.
#[allow(clippy::type_complexity)]
pub fn severed(
    mut people: Query<(&crate::person::Person, &mut crate::npc::Hurt, &mut crate::vitals::Vitals, Option<&crate::dismember::Dismember>, Option<&crate::skin::Skin>)>,
    mut drawn: Query<(&Mesh3d, &mut Visibility)>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    for (person, mut hurt, mut vitals, dismember, skin) in &mut people {
        // (Nobody has a `Dismember` until their first cut: a dressing put on before it has seen none.)
        let cuts = dismember.map_or(&[][..], |d| &d.cuts[..]);
        let bones = &person.body.bones;
        for k in 0..hurt.dressings.len() {
            let seen = *hurt.dressings[k].seen.get_or_insert(cuts.len());
            if hurt.dressings[k].off || seen >= cuts.len() {
                continue;
            }
            // (Nothing to carry: the look has not made its mesh yet, a frame or so after it is put on, and it waits for it;
            // or it makes none, as for a bandage round the head, which stays with the head.)
            let entity = skin.and_then(|s| s.dressings.get(k)).map(|d| d.0).filter(|&e| e != Entity::PLACEHOLDER);
            let Some(mut mesh) = entity.and_then(|e| drawn.get(e).ok()).and_then(|(m, _)| meshes.get_mut(&m.0)) else {
                if skin.is_none_or(|s| s.dressings.len() > k) {
                    hurt.dressings[k].seen = Some(cuts.len());
                }
                continue;
            };
            let rest: Vec<Vec3> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
                Some(VertexAttributeValues::Float32x3(p)) => p.iter().map(|&p| Vec3::from(p)).collect(),
                _ => continue,
            };
            let weights: Vec<[f32; 4]> = match mesh.attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT) {
                Some(VertexAttributeValues::Float32x4(w)) => w.clone(),
                _ => continue,
            };
            let Ok(VertexAttributeValues::Uint16x4(joints)) = mesh.try_attribute_mut(Mesh::ATTRIBUTE_JOINT_INDEX) else { continue };
            let mut gone_off = false;
            for cut in &cuts[seen..] {
                let gone = |i: usize| {
                    let mut at = Some(i);
                    while let Some(b) = at {
                        if b == cut.tip {
                            return true;
                        }
                        at = bones[b].parent;
                    }
                    false
                };
                let (mut touched, mut past, mut before) = (false, 0, 0);
                for (v, p) in rest.iter().enumerate() {
                    if (0..4).any(|i| weights[v][i] > 0.0 && gone(joints[v][i] as usize)) {
                        touched = true;
                    }
                    if (*p - cut.c).dot(cut.n) > 0.0 {
                        past += 1;
                    } else {
                        before += 1;
                    }
                }
                if !touched {
                    continue;
                }
                if past > 0 && before > 0 {
                    gone_off = true;
                    break;
                }
                let piece = past > 0;
                let to = if piece { cut.tip } else { cut.prox } as u16;
                for (v, j) in joints.iter_mut().enumerate() {
                    for i in 0..4 {
                        if weights[v][i] > 0.0 && gone(j[i] as usize) != piece {
                            j[i] = to;
                        }
                    }
                }
            }
            hurt.dressings[k].seen = Some(cuts.len());
            if gone_off {
                hurt.dressings[k].off = true;
                for b in &mut vitals.bleeds {
                    if b.dressing == Some(k) {
                        b.dressing = None;
                        b.dressed = None;
                    }
                }
                if let Some(e) = entity {
                    if let Ok((_, mut shown)) = drawn.get_mut(e) {
                        *shown = Visibility::Hidden;
                    }
                }
            }
        }
    }
}

// --- a dressing's look (dressing.ts _shape, _mesh, _picture, _paint, _clothes; phase 3, port/skin) -------------------
//
// The patch of skin it lies on, lifted off it, as a mesh of its own skinned to the same bones, so it bends with the
// body; drawn by skin.wesl (`GAUZE`) as white cotton (a pad's folds and the tape over it, or a roll's turns laid half over
// each other) with the blood in it spread out from the wound, dark where the gauze is full, a paler fringe of serum ahead,
// browning as it dries. The clothes over it are cut away, the skin under them shown there; the swelling under it lifts
// it, at once where it lies on the skin, and it presses the swelling back (bruise.rs riders).

// A dressing built to be drawn: its mesh, where its corners are at rest (what the swelling carries), its picture's
// layout (metres across and up the picture, and where its corner is), and the opening cut in the clothes over it.
pub struct Gauze {
    pub mesh: Mesh,
    pub rest: Vec<Vec3>,
    pub layout: Vec4,
    pub pad: bool,
    pub opening: (Vec3, Vec3, f32, f32),
}

// The skin's triangles wholly on it, each corner its own (a roll's seam, opposite the wound, needs two), lifted off the
// skin by `lift` and more over the wound where the pad is folded thick. (None for a bandage round the head.)
// shortcut: a face or neck pad is laid as a pad anywhere is (dressing.ts _head bridged the eye's hollow and wound the
// scalp's bandage round the head: not drawn here yet).
//
// `flesh` is the person's own skin once a limb has come off (flesh.rs): the gauze is laid on what is left of it, carried
// by the bones that carry it now. (Laid on the file's skin, a dressing on a stump took the skin that went with the piece,
// still carried by the piece's bones, and stretched out to wherever the piece lay.)
pub fn gauze(body: &crate::person::Body, d: &Dressing, layer: usize, flesh: Option<&crate::flesh::Flesh>) -> Option<Gauze> {
    let lift = 0.0028 + layer as f32 * 0.003;
    let mark = &d.mark;
    // Each corner of the skin: on it (where on the dressing, x and y in metres, its lifted place and its normal), or not.
    let place: Box<dyn Fn(usize) -> Option<(f32, f32, Vec3, Vec3)>>;
    let layout: Vec4;
    let opening;
    let pad = matches!(d.covers, Covers::Pad { .. });
    let mut end = None;
    match d.covers.clone() {
        Covers::Pad { c, n, ex, ey, side } => {
            // A pad, square on the skin, centred on the wound, its sides along the body and across it; thickest in the
            // middle where it is folded over itself, the tape over its ends thinner.
            let h = side * 1.6;
            layout = Vec4::new(2.0 * h, 2.0 * h, -h, -h);
            opening = (c, n, side * 1.55, 0.06);
            place = Box::new(move |v| {
                let p = body.position[v];
                let q = p - c;
                let (x, y) = (q.dot(ex), q.dot(ey));
                if x.abs() > h || y.abs() > h || q.dot(n).abs() > 0.04 {
                    return None;
                }
                let mut nv = body.normal[v];
                if nv.dot(n) < 0.0 {
                    nv = -nv;
                }
                if nv.dot(n) < 0.3 {
                    return None;
                }
                let thick = if x.abs() < side && y.abs() < side { 0.002 + 0.004 * (-(x * x + y * y) / 0.0009).exp() } else { 0.0 };
                Some((x, y, p + nv * (lift + thick), nv))
            });
        }
        Covers::Wrap { a, axis, low, high, far } => {
            // Round a limb: the line it runs along, and how far out its skin is at the wound.
            let along = move |q: Vec3| (q - a).dot(axis);
            let out = move |q: Vec3| q - a - axis * along(q);
            let p0 = along(mark.rest);
            let r0 = out(mark.rest).length();
            let e0 = out(mark.rest).normalize();
            let e1 = axis.cross(e0);
            let round = std::f32::consts::TAU * (r0 + lift);
            layout = Vec4::new(round, ROLL + 0.03, -round / 2.0, -ROLL / 2.0 - 0.015);
            let middle = a + axis * p0;
            opening = (middle, axis, far + 0.05, ROLL / 2.0 + 0.01);
            place = Box::new(move |v| {
                let q = body.position[v];
                let p = along(q);
                if p < low - 0.012 || p > high + 0.012 {
                    return None;
                }
                let o = out(q);
                let r = o.length();
                if r > far || r < r0 * 0.3 {
                    return None;
                }
                let radial = o / r;
                let mut nv = body.normal[v];
                if nv.dot(radial) < 0.0 {
                    nv = -nv;
                }
                if nv.dot(radial) < 0.2 {
                    return None;
                }
                let x = o.dot(e1).atan2(o.dot(e0)) * (r0 + lift);
                // The pad under the turns, over the wound.
                let thick = 0.004 * (-(x * x + (p - p0) * (p - p0)) / 0.0009).exp();
                Some((x, p - p0, q + nv * (lift + thick), nv))
            });
        }
        Covers::Stump { c, n, r, rim } => {
            // Round the stump from its end back up it, the end itself covered by the gauze folded over it (`end` below).
            // The picture's y runs up the stump from its end's rim (-r) and, over the end, from the middle of it (0), so
            // the blood spreads from the middle out over the end and on up.
            let e0 = n.cross(if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
            let e1 = n.cross(e0);
            let round = std::f32::consts::TAU * (r + lift);
            // (Over the end the picture reaches r past its middle, and the roll's band is drawn 1.5 cm in from its edges.)
            layout = Vec4::new(round, ROLL + 2.0 * r + 0.06, -round / 2.0, -r - ROLL - 0.015);
            opening = (c - n * (ROLL / 2.0), n, r * 1.45 + 0.07, ROLL / 2.0 + 0.02);
            end = Some((c, n, e0, e1, rim));
            place = Box::new(move |v| {
                let q = body.position[v];
                let along = (q - c).dot(n);
                if !(-ROLL..=0.0).contains(&along) {
                    return None;
                }
                let o = q - c - n * along;
                let rr = o.length();
                if rr > r * 1.45 + 0.02 || rr < r * 0.3 {
                    return None;
                }
                let radial = o / rr;
                let mut nv = body.normal[v];
                if nv.dot(radial) < 0.0 {
                    nv = -nv;
                }
                if nv.dot(radial) < 0.2 {
                    return None;
                }
                Some((o.dot(e1).atan2(o.dot(e0)) * (r + lift), along - r, q + nv * lift, nv))
            });
        }
        Covers::Band { .. } => return None,
    }
    let (mut pos, mut nor, mut uv, mut joints, mut weights, mut rest) = (vec![], vec![], vec![], vec![], vec![], vec![]);
    let mut done: std::collections::HashMap<usize, Option<(f32, f32, Vec3, Vec3)>> = std::collections::HashMap::new();
    let index = flesh.map_or(&body.index, |f| &f.drawn);
    let carried = |v: usize| match flesh {
        Some(f) => (f.joints[v], f.weights[v]),
        None => (body.joints[v], body.weights[v].map(|w| w as f32 / 255.0)),
    };
    for part in body.parts.iter().filter(|p| p.kind == "skin") {
        for t in (part.index_start..part.index_start + part.index_count).step_by(3) {
            let tri = [0, 1, 2].map(|k| index[t + k] as usize);
            // (A triangle that went with a piece cut off has its corners made one.)
            if tri[0] == tri[1] && tri[0] == tri[2] {
                continue;
            }
            // (Nor one the cut runs through, whose corners past it are drawn cut away: the gauze over the end covers there.)
            if flesh.is_some_and(|f| f.planes.iter().any(|pl| tri.iter().any(|&v| (body.position[v] - pl.c).dot(pl.n) > 0.0 && body.position[v].distance(pl.c) < pl.radius))) {
                continue;
            }
            let on: Vec<_> = tri.iter().map(|&v| *done.entry(v).or_insert_with(|| place(v))).collect();
            if on.iter().any(Option::is_none) {
                continue;
            }
            let on: Vec<_> = on.into_iter().map(Option::unwrap).collect();
            let mut xs: Vec<f32> = on.iter().map(|o| o.0).collect();
            let (lo, hi) = xs.iter().fold((f32::INFINITY, f32::NEG_INFINITY), |(a, b), &x| (a.min(x), b.max(x)));
            if !pad && hi - lo > layout.x / 2.0 {
                xs = xs.into_iter().map(|x| if x < 0.0 { x + layout.x } else { x }).collect();
            }
            for k in 0..3 {
                let (_, y, at, n) = on[k];
                pos.push(at);
                nor.push(n);
                uv.push(Vec2::new((xs[k] - layout.z) / layout.x, (y - layout.w) / layout.y));
                let (j, w) = carried(tri[k]);
                joints.push(j);
                weights.push(w);
                rest.push(body.position[tri[k]]);
            }
        }
    }
    // The end of a stump: the gauze folded over it, a low dome from the stump's skin round the end (taken from the skin
    // there, each way round) over the cut face, carried by the bone the limb hung from.
    if let Some((c, n, e0, e1, rim)) = end {
        const ROUND: usize = 36;
        const UP: usize = 6;
        // The skin's outline round the end, ROUND points evenly along it.
        let mut along = vec![0.0f32];
        for k in 0..rim.len() {
            along.push(along[k] + rim[k].distance(rim[(k + 1) % rim.len()]));
        }
        let total = along[rim.len()].max(1e-6);
        let out: Vec<Vec3> = (0..ROUND).map(|k| {
            let at = k as f32 / ROUND as f32 * total;
            let i = along.partition_point(|&a| a <= at).clamp(1, rim.len()) - 1;
            let t = (at - along[i]) / (along[i + 1] - along[i]).max(1e-9);
            rim[i].lerp(rim[(i + 1) % rim.len()], t) - c
        }).collect();
        if out.len() < 3 {
            return None;
        }
        let prox = d.mark.owner;
        let dome = 0.012 + lift;
        // Rings from 2 cm up the stump, over its rim and in to the middle of the end; each corner where it lies, which way it
        // faces, and where it is in the picture.
        let corner = |k: usize, i: i32| -> (Vec3, Vec3, Vec2) {
            let o = out[k % ROUND];
            let a = o.dot(e1).atan2(o.dot(e0));
            let way = o.normalize_or_zero();
            let rr = o.length() + lift;
            let (p, normal, s) = if i < 0 {
                (c + way * rr - n * 0.02, way, rr + 0.02)
            } else {
                let f = i as f32 / UP as f32 * std::f32::consts::FRAC_PI_2;
                (c + way * rr * f.cos() + n * dome * f.sin(), (way * f.cos() * dome + n * f.sin() * rr).normalize(), rr * f.cos())
            };
            let picture = if i < 0 { Vec2::new(a.sin() * rr, -s) } else { Vec2::new(a.sin() * s, -a.cos() * s) };
            (p, normal, Vec2::new((picture.x - layout.z) / layout.x, (picture.y - layout.w) / layout.y))
        };
        for k in 0..ROUND {
            for i in -1..UP as i32 {
                let quad = [corner(k, i), corner(k + 1, i), corner(k + 1, i + 1), corner(k, i + 1)];
                for t in [0, 1, 2, 0, 2, 3] {
                    let (p, normal, at) = quad[t];
                    pos.push(p);
                    nor.push(normal);
                    uv.push(at);
                    joints.push([prox as u16, 0, 0, 0]);
                    weights.push([1.0, 0.0, 0.0, 0.0]);
                    rest.push(p);
                }
            }
        }
    }
    if pos.len() < 9 {
        return None;
    }
    let count = pos.len() as u32;
    let mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, nor)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(joints))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, weights)
        .with_inserted_indices(Indices::U32((0..count).collect()))
        .with_generated_skinned_mesh_bounds()
        .ok()?;
    Some(Gauze { mesh, rest, layout, pad, opening: (opening.0, opening.1, opening.2, opening.3) })
}

// How far the blood in it has spread (m, round the wound) and how dry it is (dressing.ts _paint).
pub fn stain(d: &Dressing) -> (f32, f32) {
    ((d.held / d.per / std::f32::consts::PI).sqrt() / 100.0, 1.0 - (-d.since / 900.0).exp())
}
