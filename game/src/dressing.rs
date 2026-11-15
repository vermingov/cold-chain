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
        let layer = self.hurt.dressings.iter().filter(|d| d.covers.covers(mark.rest)).count();
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
        let make = |kind, covers, per: f32, area: f32| Some(Dressing { mark: mark.clone(), kind, covers, per, capacity: area * 1e4 * per, held: 0.0, since: 0.0 });
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
        Some(Dressing { mark: mark.clone(), kind: "wrap", covers: Covers::Band { mid, m, o }, per: GAUZE_WRAP, capacity: round * BAND * 1e4 * GAUZE_WRAP, held: 0.0, since: 0.0 })
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

    // A new wound under a dressing (shot through it): its blood goes into the gauze too, but nothing presses on it.
    // port: phase 3 dismember (a dressing on a limb cut off since goes with the piece or comes away).
    pub fn dressings_update(&mut self, dt: f32) {
        for k in 0..self.hurt.dressings.len() {
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
