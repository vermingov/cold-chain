// What is worn on the fists (weapons.rs 'dusters' and 'gloves'): knuckle dusters and boxing gloves, built in code, drawn
// on the player's own fists (arm.rs, fist.rs) and hung on the board (arsenal.rs), and what each does to a punch.
//
// A punch lands through what is on the fist (dev/research/fist-weapons.md). Bare, the knuckles land on 30 to 40 cm2 of
// skin through the skin and flesh over them and over the struck bone (fist.rs FIST_GIVES, bones.rs). Knuckle dusters put
// a steel or brass bar a few millimetres wide across the four knuckles: the same arm behind it, but nothing soft between
// the bar and the struck skin, on a third of the patch, so the force comes on harder and is a third as spread: skin split
// over bone, small bones broken, the eye's rim no shield for the eye. The bar is held by a grip in the palm, so the blow
// goes into the whole hand, not the knuckles alone (a bare punch's fifth metacarpal is the boxer's fracture). Boxing
// gloves (10 to 16 oz, 280 to 450 g) put 2 to 4 cm of foam over the knuckles: the force comes on over two or three
// times as long at half the peak, spread over a patch the size of the glove's face, so far fewer cuts and fractures;
// but the momentum is the same and a little more (the glove's own mass), and a punch to the head still turns it as hard
// and still knocks out (wounds.rs takes concussion from the energy).
//
// Each is made in the closed fist's own frame (metres): x across the knuckles from the index finger to the little finger
// (the right hand's), y out of the back of the hand, z the way the knuckles face (from the wrist to them), the origin at
// the middle of the four knuckle joints. On a fist it is laid by that fist's own knuckles, scaled to their spread.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::skinning::{SkinnedMesh, SkinnedMeshInverseBindposes};
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;

use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::render::render_resource::AsBindGroup;
use bevy::shader::ShaderRef;

use crate::dressing::Piece;
use crate::wounds::Tool;

// Polished metal that shows the hall in it (polished.wesl).
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone, Default)]
pub struct Polished {
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

impl MaterialExtension for Polished {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/polished.wesl".into()
    }
}

pub type Metal = ExtendedMaterial<StandardMaterial, Polished>;

// The four knuckle joints' spread (index to little, bone to bone) the shapes are made for: a man's hand; and how far
// behind them its wrist joint is.
const SPREAD: f32 = 0.054;
const WRIST: f32 = 0.084;
// Where the forearm's pieces are made, from the fist's frame: the wrist's middle.
const ON_ARM: Vec3 = Vec3::new(0.0, 0.01, WRIST);

// What a fist wears changes: the kg it adds to each fist, and what lands (bones.rs `tool`).
pub fn wear(key: &str) -> (f32, Tool) {
    match key {
        // A pair of brass knuckle dusters weighs some 150 to 250 g each.
        "dusters" => (0.2, Tool::Named("dusters")),
        // 14 oz gloves, 400 g each.
        "gloves" => (0.4, Tool::Named("glove")),
        _ => (0.0, Tool::Stiff(crate::fist::FIST_GIVES)),
    }
}

// A mesh being put together from shapes, each placed by a transform (its normals carried as normals are).
#[derive(Default)]
struct Build {
    pos: Vec<Vec3>,
    nor: Vec<Vec3>,
    uv: Vec<Vec2>,
    index: Vec<u32>,
}

impl Build {
    fn add(&mut self, mesh: Mesh, t: Transform) {
        let m = t.to_matrix();
        let n = m.inverse().transpose();
        let base = self.pos.len() as u32;
        let Some(VertexAttributeValues::Float32x3(p)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) else { return };
        let Some(VertexAttributeValues::Float32x3(q)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL) else { return };
        self.pos.extend(p.iter().map(|&v| m.transform_point3(Vec3::from(v))));
        self.nor.extend(q.iter().map(|&v| n.transform_vector3(Vec3::from(v)).normalize_or_zero()));
        match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(t)) => self.uv.extend(t.iter().map(|&t| Vec2::from(t))),
            _ => self.uv.extend(std::iter::repeat_n(Vec2::ZERO, p.len())),
        }
        match mesh.indices() {
            Some(i) => self.index.extend(i.iter().map(|k| base + k as u32)),
            None => self.index.extend((0..p.len() as u32).map(|k| base + k)),
        }
    }

    // A capsule of radius `r` from `a` to `b`.
    fn capsule(&mut self, a: Vec3, b: Vec3, r: f32) {
        let d = b - a;
        let t = Transform::from_translation((a + b) / 2.0).with_rotation(Quat::from_rotation_arc(Vec3::Y, d.normalize()));
        self.add(Capsule3d::new(r, d.length()).mesh().rings(4).latitudes(12).longitudes(20).build(), t);
    }

    // As seen in a mirror across x (the other hand's), with tangents for a picture's relief.
    fn mesh(&self, mirror: bool) -> Mesh {
        let s = if mirror { Vec3::new(-1.0, 1.0, 1.0) } else { Vec3::ONE };
        let mut index = self.index.clone();
        if mirror {
            for t in index.chunks_exact_mut(3) {
                t.swap(1, 2);
            }
        }
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos.iter().map(|p| (*p * s).to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor.iter().map(|n| (*n * s).to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, self.uv.iter().map(|t| t.to_array()).collect::<Vec<_>>())
            .with_inserted_indices(Indices::U32(index));
        mesh.generate_tangents().ok();
        mesh
    }
}

// A surface lofted through cross-sections, each a rounded box round (x, y) at z: half wide `w`, `top` above and `bottom`
// below, `round` 2 an ellipse and higher squarer; `ring` corners round. Its picture's u runs round it from the middle of
// its top (u 0) and v along it from the first section (v 0, by length). Normals from its own triangles.
#[derive(Clone, Copy)]
struct Section {
    at: Vec3,
    w: f32,
    top: f32,
    bottom: f32,
    round: f32,
}

fn loft(sections: &[Section], ring: usize, length: f32) -> Mesh {
    let mut pos = Vec::new();
    let mut uv = Vec::new();
    let mut along = 0.0;
    for (i, c) in sections.iter().enumerate() {
        if i > 0 {
            along += c.at.distance(sections[i - 1].at);
        }
        let e = 2.0 / c.round;
        let f = |x: f32| x.signum() * x.abs().powf(e);
        for j in 0..=ring {
            let a = std::f32::consts::TAU * j as f32 / ring as f32;
            let (sx, cy) = (a.sin(), a.cos());
            let y = if cy >= 0.0 { c.top } else { c.bottom } * f(cy);
            pos.push(c.at + Vec3::new(c.w * f(sx), y, 0.0));
            uv.push([j as f32 / ring as f32, along / length]);
        }
    }
    let w = (ring + 1) as u32;
    let mut index = Vec::new();
    for i in 0..sections.len() as u32 - 1 {
        for j in 0..ring as u32 {
            let (a, b) = (i * w + j, (i + 1) * w + j);
            index.extend([a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p: &Vec3| p.to_array()).collect::<Vec<_>>())
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh
}

fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

// The mitt of a 14 oz glove round the closed fist (the fist's frame), from the cuff to the front of the striking pad:
// 12.8 cm across at the knuckles, narrowing to 10 at the wrist; the back of the hand a long low dome rising to the
// knuckles; underneath, the palm flat to the wrist and then the curled fingers' pocket hanging lower, a crease where the
// two meet; the front a full round pad 4 to 5 cm thick over the knuckles.
fn mitt() -> Mesh {
    let (z0, z1) = (-0.15, 0.058);
    const ALONG: usize = 56;
    let sections: Vec<Section> = (0..=ALONG)
        .map(|i| {
            let s = i as f32 / ALONG as f32;
            let z = z0 + (z1 - z0) * s;
            // (The front end closes as a quarter of an ellipse over its last 30 percent.)
            let end = if s > 0.68 { (1.0 - ((s - 0.68) / 0.32).powi(2)).max(0.0).sqrt() } else { 1.0 };
            let w = 0.05 + 0.014 * smooth(0.0, 0.62, s);
            // (The back of the hand nearly level, the padding over the knuckles standing up from it.)
            let top = 0.033 + 0.008 * smooth(0.05, 0.45, s) + 0.01 * smooth(0.5, 0.72, s);
            let crease = 0.005 * (-((s - 0.43) / 0.05).powi(2)).exp();
            let bottom = 0.034 + 0.03 * smooth(0.32, 0.62, s) - crease;
            // Back to the cuff's front end, the mitt lies 3 mm over the cuff all round, as the hand's panels are sewn
            // to it, and only past it swells out into the hand; its back edge turned in onto the cuff. (Left as it was
            // made, the hand's own size, its open back hung out round the cuff.)
            let (cw, ch) = cuff_size(z);
            let lip = 0.004 * (smooth(0.0, 0.04, s) - 1.0);
            let hug = smooth(CUFF.1, CUFF.1 + 0.045, z);
            let mix = |own: f32, over: f32| over + (own - over) * hug + lip;
            let (w, top, bottom) = (mix(w, cw + 0.003), mix(top, ch + 0.003 + 0.014), mix(bottom, ch + 0.003 - 0.014));
            Section { at: Vec3::new(0.0, -0.014, z), w: w * end, top: top * end.powf(0.8), bottom: bottom * end.powf(0.8), round: 2.5 - 0.3 * s }
        })
        .collect();
    loft(&sections, MITT_RING, 0.22)
}
const MITT_RING: usize = 72;

// The thumb: a padded tube along the inside of the mitt from by the wrist to near the front, its inner half sunk in the
// mitt's side, where it is sewn on along its length; its tip rounded.
fn thumb() -> Mesh {
    let (p0, p1, p2) = (Vec3::new(-0.048, -0.03, -0.1), Vec3::new(-0.074, -0.042, -0.058), Vec3::new(-0.06, -0.046, -0.01));
    const ALONG: usize = 24;
    let sections: Vec<(Vec3, f32)> = (0..=ALONG)
        .map(|i| {
            let t = i as f32 / ALONG as f32;
            let at = p0 * (1.0 - t).powi(2) + p1 * 2.0 * t * (1.0 - t) + p2 * t * t;
            // (Both ends closed: the tip rounded, the root tapered shut where it leaves the cuff, as its panel is sewn
            // into the mitt's; left open, it hung there as a flap.)
            let end = if t > 0.75 { (1.0 - ((t - 0.75) / 0.25).powi(2)).max(0.0).sqrt() } else { 1.0 }
                * (1.0 - ((0.2 - t).max(0.0) / 0.2).powi(2)).sqrt();
            (at, (0.021 - 0.004 * t) * end)
        })
        .collect();
    // A loft along a bent line: each ring square to the way the line goes there.
    let mut pos = Vec::new();
    let mut uv = Vec::new();
    let mut along = 0.0;
    const RING: usize = 28;
    for (i, &(at, r)) in sections.iter().enumerate() {
        let ahead = if i + 1 < sections.len() { sections[i + 1].0 - at } else { at - sections[i - 1].0 }.normalize();
        if i > 0 {
            along += at.distance(sections[i - 1].0);
        }
        let side = ahead.cross(Vec3::Y).normalize();
        let up = side.cross(ahead);
        for j in 0..=RING {
            let a = std::f32::consts::TAU * j as f32 / RING as f32;
            pos.push(at + (up * a.cos() + side * a.sin()) * r);
            uv.push([j as f32 / RING as f32, along / 0.22]);
        }
    }
    let w = (RING + 1) as u32;
    let mut index = Vec::new();
    for i in 0..ALONG as u32 {
        for j in 0..RING as u32 {
            let (a, b) = (i * w + j, (i + 1) * w + j);
            index.extend([a, a + 1, b, a + 1, b + 1, b]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p: &Vec3| p.to_array()).collect::<Vec<_>>())
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh
}

// A cord along a line of points: piping, a round bead of leather sewn into a seam to stand out of it.
fn cord(path: &[Vec3], r: f32) -> Mesh {
    const RING: usize = 10;
    let mut pos = Vec::new();
    let mut uv = Vec::new();
    for (i, &at) in path.iter().enumerate() {
        let ahead = if i + 1 < path.len() { path[i + 1] - at } else { at - path[i - 1] }.normalize_or(Vec3::Z);
        let side = ahead.cross(if ahead.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
        let up = side.cross(ahead);
        for j in 0..=RING {
            let a = std::f32::consts::TAU * j as f32 / RING as f32;
            pos.push(at + (up * a.cos() + side * a.sin()) * r);
            uv.push([j as f32 / RING as f32, i as f32 / path.len() as f32]);
        }
    }
    let w = (RING + 1) as u32;
    let mut index = Vec::new();
    for i in 0..path.len() as u32 - 1 {
        for j in 0..RING as u32 {
            let (a, b) = (i * w + j, (i + 1) * w + j);
            index.extend([a, a + 1, b, a + 1, b + 1, b]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p: &Vec3| p.to_array()).collect::<Vec<_>>())
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh
}

// The piping round the mitt, where its top panel meets its palm: along its outer side from the cuff, round the front of
// the striking pad and back along its inner side (the mitt's points at its sides, a millimetre out).
fn piping() -> Mesh {
    let m = mitt();
    let Some(VertexAttributeValues::Float32x3(p)) = m.attribute(Mesh::ATTRIBUTE_POSITION) else { unreachable!() };
    let Some(VertexAttributeValues::Float32x3(n)) = m.attribute(Mesh::ATTRIBUTE_NORMAL) else { unreachable!() };
    let ring = MITT_RING + 1;
    let at = |i: usize, j: usize| Vec3::from(p[i * ring + j]) + Vec3::from(n[i * ring + j]) * 0.001;
    let rows = p.len() / ring;
    // (From where the mitt comes out of the cuff: begun under it, its cut end stood out by the thumb.)
    let from = (0..rows).find(|&i| p[i * ring][2] > CUFF.1).unwrap();
    let mut path: Vec<Vec3> = (from..rows - 1).map(|i| at(i, MITT_RING / 4)).collect();
    path.extend((from..rows - 1).rev().map(|i| at(i, 3 * MITT_RING / 4)));
    cord(&path, 0.0028)
}

// The cuff up the forearm, a little wider at its open end, its edge rolled; and the strap round it, with the end of the
// strap laid over itself on the back of the wrist.
fn cuff(z0: f32, z1: f32, w: f32, h: f32, flare: f32, narrow: f32, roll: f32) -> Mesh {
    let mut sections = Vec::new();
    let n = 14;
    for i in 0..=n {
        let s = i as f32 / n as f32;
        let grow = cuff_grow(s, flare, narrow);
        // (The last millimetres at each end turned in, a rolled edge.)
        let lip = roll * (smooth(0.0, 0.06, s).min(smooth(1.0, 0.94, s)) - 1.0);
        sections.push(Section { at: Vec3::new(0.0, -0.01, z0 + (z1 - z0) * s), w: w * grow + lip, top: h * grow + lip, bottom: h * grow + lip, round: 2.2 });
    }
    loft(&sections, 64, 0.22)
}

// (Wider at its open end; narrowed at the other, which goes inside the mitt's back, so that as the wrist bends the mitt's
// back passes over it rather than its edge standing out.)
fn cuff_grow(s: f32, flare: f32, narrow: f32) -> f32 {
    (1.0 + flare * (1.0 - s)) * (1.0 - narrow * smooth(0.6, 1.0, s))
}

// The cuff proper: from and to (z, in the fist's frame), half wide, half high, flare, narrowing.
const CUFF: (f32, f32, f32, f32, f32, f32) = (-0.235, -0.1, 0.047, 0.041, 0.04, 0.16);

// The cuff's half width and half height at z (in the fist's frame, about the line through the wrist).
fn cuff_size(z: f32) -> (f32, f32) {
    let grow = cuff_grow(((z - CUFF.0) / (CUFF.1 - CUFF.0)).clamp(0.0, 1.0), CUFF.4, CUFF.5);
    (CUFF.2 * grow, CUFF.3 * grow)
}

// Smooth noise over the plane (0 to 1), the same at the same place every time.
fn noise(x: f32, y: f32) -> f32 {
    let hash = |i: f32, j: f32| ((i * 127.1 + j * 311.7).sin() * 43758.547).fract().abs();
    let (i, j) = (x.floor(), y.floor());
    let (fx, fy) = (x - i, y - j);
    let (u, v) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let a = hash(i, j) + (hash(i + 1.0, j) - hash(i, j)) * u;
    let b = hash(i, j + 1.0) + (hash(i + 1.0, j + 1.0) - hash(i, j + 1.0)) * u;
    a + (b - a) * v
}

// The glove's leather, painted once (its colour, relief and roughness), laid on by u round each part from the middle of
// its top and v along it (`loft`; 37 cm round, 22 cm along: the mitt's own size). The panels are sewn together along
// either side of the back of the hand (the top panel), across the palm where the curled fingers' pocket begins, and round
// the cuff's hem: each seam a groove pulled in between two rows of stitches 2.4 mm either side of it, 4 mm stitches of
// off-white thread. Over all of it a pebbled grain, a little uneven in colour; and worn where it lands, the striking pad
// and the knuckles, the colour paler and the sheen gone matte.
fn leather(images: &mut Assets<Image>, colour: [u8; 3]) -> (Handle<Image>, Handle<Image>, Handle<Image>) {
    use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
    const N: usize = 1024;
    const ROUND: f32 = 370.0; // mm round
    const LONG: f32 = 220.0; // mm along
    let lin = |c: u8| (c as f32 / 255.0).powf(2.2);
    let base = colour.map(lin);
    let thread = [214u8, 204, 192].map(lin);
    let worn = [base[0] * 1.25 + 0.03, base[1] * 1.6 + 0.02, base[2] * 1.5 + 0.02];
    // Height (mm), colour and roughness at a point (mm round from the top's middle, mm along).
    let at = |x: f32, y: f32| -> (f32, [f32; 3], f32) {
        let grain = 0.07 * noise(x / 0.7, y / 0.7) + 0.04 * noise(x / 1.6 + 7.0, y / 1.6) + 0.02 * noise(x / 0.3, y / 0.3 + 3.0);
        let mut h = grain;
        let tone = 0.92 + 0.12 * noise(x / 9.0, y / 9.0) + 0.05 * (noise(x / 0.7, y / 0.7) - 0.5);
        let mut c = base.map(|k| k * tone);
        let mut rough = 0.5 + 0.08 * noise(x / 4.0 + 2.0, y / 4.0);
        // Worn over the knuckles and the striking pad (the front fifth, and the top toward it).
        let top = 1.0 - smooth(0.0, 90.0, x.min(ROUND - x));
        let wear = smooth(150.0, 190.0, y) * (0.5 + 0.5 * top) * (0.6 + 0.4 * noise(x / 6.0, y / 6.0));
        for k in 0..3 {
            c[k] += (worn[k] - c[k]) * wear * 0.7;
        }
        rough += 0.18 * wear;
        // The seams: each a line of `x` (along the part) or of `y` (round it), with its two rows of stitches.
        let mut seam = |off: f32, run: f32, from: f32, to: f32| {
            if run < from || run > to {
                return;
            }
            h -= 0.55 * (-(off / 0.55).powi(2)).exp();
            rough += 0.15 * (-(off / 0.8).powi(2)).exp();
            for side in [-2.4f32, 2.4] {
                let d = off - side;
                let dash = (run / 4.0).fract();
                if d.abs() < 0.42 && dash > 0.12 && dash < 0.88 {
                    let s = (1.0 - (d / 0.42).powi(2)).sqrt();
                    h += 0.22 * s;
                    c = thread.map(|t| t * (0.8 + 0.2 * s));
                    rough = 0.7;
                } else if d.abs() < 0.6 && (dash <= 0.12 || dash >= 0.88) {
                    // (where the thread goes into the leather: a small dark hole)
                    h -= 0.12;
                    c = c.map(|k| k * 0.5);
                }
            }
        };
        for sx in [0.21 * ROUND, 0.79 * ROUND] {
            seam(x - sx, y, 0.0, LONG * 0.97);
        }
        seam(y - 0.36 * LONG, x, 0.33 * ROUND, 0.67 * ROUND);
        seam(y - 4.0, x, 0.0, ROUND);
        (h, c, rough.min(0.95))
    };
    let mut height = vec![0.0f32; N * N];
    let mut colour_data = Vec::with_capacity(N * N * 4);
    let mut rough_data = Vec::with_capacity(N * N * 4);
    for j in 0..N {
        for i in 0..N {
            let (x, y) = ((i as f32 + 0.5) / N as f32 * ROUND, (j as f32 + 0.5) / N as f32 * LONG);
            let (h, c, r) = at(x, y);
            height[j * N + i] = h;
            colour_data.extend(c.map(|k| (k.max(0.0).powf(1.0 / 2.2) * 255.0).round().min(255.0) as u8));
            colour_data.push(255);
            rough_data.extend([0, (r * 255.0) as u8, 0, 255]);
        }
    }
    let (dx, dy) = (ROUND / N as f32, LONG / N as f32);
    let mut normal_data = Vec::with_capacity(N * N * 4);
    for j in 0..N {
        for i in 0..N {
            let h = |i: usize, j: usize| height[j.min(N - 1) * N + i % N];
            let gx = (h(i + 1, j) - h((i + N - 1) % N, j)) / (2.0 * dx);
            let gy = (h(i, j + 1) - h(i, j.saturating_sub(1))) / (2.0 * dy);
            let n = Vec3::new(-gx, -gy, 1.0).normalize();
            normal_data.extend([((n.x * 0.5 + 0.5) * 255.0) as u8, ((n.y * 0.5 + 0.5) * 255.0) as u8, ((n.z * 0.5 + 0.5) * 255.0) as u8, 255]);
        }
    }
    let make = |data: Vec<u8>, format| Image::new(Extent3d { width: N as u32, height: N as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data, format, RenderAssetUsages::default());
    (images.add(make(colour_data, TextureFormat::Rgba8UnormSrgb)), images.add(make(normal_data, TextureFormat::Rgba8Unorm)),
     images.add(make(rough_data, TextureFormat::Rgba8Unorm)))
}

// What each is made of: each part's shape (the right hand's), which of its looks it wears, and whether it is carried by
// the forearm (in the forearm's frame: its axis z toward the hand, the wrist joint the origin) rather than the fist.
fn shapes(key: &str) -> Vec<(Build, usize, bool)> {
    let one = |mesh: Mesh| {
        let mut b = Build::default();
        b.add(mesh, Transform::IDENTITY);
        b
    };
    // (The cuff's pieces made round the fist's frame's line through the wrist, moved onto the forearm's.)
    let on_arm = |mesh: Mesh| {
        let mut b = Build::default();
        b.add(mesh, Transform::from_translation(ON_ARM));
        b
    };
    match key {
        "gloves" => {
            // A 14 oz glove: the mitt and the thumb sewn to its side, with white piping round the mitt; the cuff 11 cm up
            // the forearm, carried by the forearm (on the hand, it swung out through the sleeve as the wrist bent), a white
            // band round its open end and the strap round it, the strap's end laid over itself on the back of the wrist.
            let mut leather = one(mitt());
            leather.add(thumb(), Transform::IDENTITY);
            let mut strap = on_arm(cuff(-0.205, -0.15, 0.0505, 0.0445, 0.0, 0.0, 0.0015));
            strap.add(cuff(-0.203, -0.152, 0.0535, 0.0475, 0.0, 0.0, 0.0015), Transform::from_xyz(0.0, 0.0115, WRIST).with_scale(Vec3::new(0.62, 1.0, 1.0)));
            vec![
                (leather, 0, false),
                (on_arm(cuff(CUFF.0, CUFF.1, CUFF.2, CUFF.3, CUFF.4, CUFF.5, 0.004)), 0, true),
                (strap, 1, true),
                (one(piping()), 2, false),
                (on_arm(cuff(-0.236, -0.226, 0.0495, 0.0435, 0.0, 0.0, 0.0015)), 2, true),
            ]
        }
        "dusters" => {
            // Brass knuckles: four rings a finger's width apart round the fingers' first bones, just past the knuckles,
            // fused into one plate; a bar across their fronts that lands; a grip lying in the palm under the curled fingers,
            // joined to the plate at either end.
            let mut brass = Build::default();
            for x in [-0.027, -0.009, 0.009, 0.027] {
                brass.add(Torus::new(0.0105, 0.0165).mesh().minor_resolution(16).major_resolution(36).build(), Transform::from_xyz(x, -0.022, 0.0));
            }
            brass.add(Capsule3d::new(0.0058, 0.074).mesh().rings(4).latitudes(12).longitudes(20).build(),
                      Transform::from_xyz(0.0, -0.022, 0.0172).with_rotation(Quat::from_rotation_z(std::f32::consts::FRAC_PI_2)).with_scale(Vec3::new(2.1, 1.0, 1.0)));
            // (The grip lies inside the loop each finger makes curled into the palm: down its first bone, back along the
            // second, up the third.)
            brass.capsule(Vec3::new(-0.03, -0.019, -0.013), Vec3::new(0.032, -0.019, -0.013), 0.0062);
            for s in [-1.0f32, 1.0] {
                brass.capsule(Vec3::new(0.041 * s, -0.024, 0.004), Vec3::new(0.035 * s, -0.019, -0.013), 0.0045);
            }
            vec![(brass, 0, false)]
        }
        _ => Vec::new(),
    }
}

// And each part's look.
fn looks(key: &str, images: &mut Assets<Image>) -> Vec<StandardMaterial> {
    match key {
        "gloves" => {
            // Red leather, a soft sheen (no lacquer): the picture's grain and seams in its relief. The strap black.
            let textured = |images: &mut Assets<Image>, colour| {
                let (albedo, normal, rough) = leather(images, colour);
                StandardMaterial { base_color_texture: Some(albedo), normal_map_texture: Some(normal), metallic_roughness_texture: Some(rough), metallic: 0.0,
                                   perceptual_roughness: 1.0, reflectance: 0.4, ..default() }
            };
            let trim = StandardMaterial { base_color: Color::srgb_u8(226, 224, 218), perceptual_roughness: 0.5, reflectance: 0.4, ..default() };
            vec![textured(images, [178, 22, 28]), textured(images, [26, 25, 26]), trim]
        }
        // Polished brass: a metal's own colour in what it reflects (brass reflects some 90% of red light, 45% of blue).
        "dusters" => vec![StandardMaterial { base_color: Color::linear_rgb(0.91, 0.74, 0.4), metallic: 1.0, perceptual_roughness: 0.24, ..default() }],
        _ => Vec::new(),
    }
}

// Worn, a part is hung from both the hand and the forearm, as leather laced or strapped round the wrist goes with both:
// what is in front of the wrist with the hand, the cuff with the forearm, and between them partly with each, by how far
// back it is; so the mitt's back and the cuff's front stay one as the wrist turns. (Each on a bone of its own, the mitt's
// back swung out round the cuff, the way the wrist bent, or the cuff's front out of the mitt's back the other way.) Its
// points all in the fist's frame, the hand's joint first.
fn skinned(mut mesh: Mesh, arm: bool) -> Mesh {
    let Some(VertexAttributeValues::Float32x3(p)) = mesh.attribute_mut(Mesh::ATTRIBUTE_POSITION) else { unreachable!() };
    let back = if arm { ON_ARM } else { Vec3::ZERO };
    let weights: Vec<[f32; 4]> = p
        .iter_mut()
        .map(|v| {
            *v = (Vec3::from(*v) - back).to_array();
            let hand = smooth(-0.14, -0.075, v[2]);
            [hand, 1.0 - hand, 0.0, 0.0]
        })
        .collect();
    let n = weights.len();
    mesh.with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(vec![[0, 1, 0, 0]; n]))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, weights)
}

// Each worn thing's meshes and materials, the right hand's and the left's, made once; and whether each is the forearm's.
#[derive(Resource, Default)]
pub struct Made(HashMap<(&'static str, bool), Vec<(Handle<Mesh>, Handle<Mesh>, Handle<StandardMaterial>, bool)>>);

impl Made {
    fn get(&mut self, key: &'static str, left: bool, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, images: &mut Assets<Image>)
           -> Vec<(Handle<Mesh>, Handle<Mesh>, Handle<StandardMaterial>, bool)> {
        if !self.0.contains_key(&(key, left)) {
            // (The looks shared by both hands: made with the first.)
            let looks: Vec<Handle<StandardMaterial>> = match self.0.get(&(key, !left)) {
                Some(made) => {
                    let mut l: Vec<_> = Vec::new();
                    for (_, _, m, _) in made {
                        if !l.contains(m) {
                            l.push(m.clone());
                        }
                    }
                    l
                }
                None => looks(key, images).into_iter().map(|m| materials.add(m)).collect(),
            };
            let made = shapes(key)
                .into_iter()
                .map(|(b, k, arm)| {
                    let mesh = b.mesh(left);
                    (meshes.add(skinned(mesh.clone(), arm)), meshes.add(mesh), looks[k].clone(), arm)
                })
                .collect();
            self.0.insert((key, left), made);
        }
        self.0[&(key, left)].clone()
    }
}

// On the board: a pair, gloves hanging by their cuffs and dusters flat, their fronts to the room (the board's frame: x
// out of the wall into the room, y up, the wall along -z).
pub fn board(key: &'static str, made: &mut Made, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, images: &mut Assets<Image>)
             -> Option<Vec<Piece>> {
    let (turn, apart) = match key {
        // The back of the hand to the room, the knuckles down.
        "gloves" => (Mat3::from_cols(Vec3::NEG_Z, Vec3::X, Vec3::NEG_Y), 0.075),
        // Flat to the wall, the rings' holes to the room, the bar up.
        "dusters" => (Mat3::from_cols(Vec3::Z, Vec3::X, Vec3::Y), 0.055),
        _ => return None,
    };
    let rotation = Quat::from_mat3(&turn);
    let mut out = Vec::new();
    for (left, z) in [(false, -apart), (true, apart)] {
        for (_, mesh, material, arm) in made.get(key, left, meshes, materials, images) {
            // (The forearm's pieces where they are on a straight wrist.)
            let along = if arm { rotation * -ON_ARM } else { Vec3::ZERO };
            out.push(Piece { mesh, material, at: Transform::from_translation(Vec3::new(0.0, 0.0, z) + along).with_rotation(rotation) });
        }
    }
    Some(out)
}

// Where the fist's own frame lies in the wrist's (the bone the worn thing is hung from), the forearm's in the forearm's
// second bone's, and whether they are the mirror image's (the left hand's): from the arm as it is closed now.
fn on_fist(arm: &crate::arm::Arm) -> (Transform, Transform, bool) {
    let here = |n: &str, tail: bool| arm.here(n, tail);
    let knuckles: Vec<Vec3> = (2..=5).map(|k| here(&format!("finger{k}-1"), false)).collect();
    let middle = knuckles.iter().sum::<Vec3>() / 4.0;
    let across = knuckles[3] - knuckles[0];
    let x = across.normalize();
    let ahead = middle - here("wrist", false);
    let z = (ahead - x * ahead.dot(x)).normalize();
    let mut y = z.cross(x);
    // (The back of the hand is away from where the fingers curl.)
    let curled = here("finger3-3", true) - here("finger3-1", false);
    let mirror = y.dot(curled) > 0.0;
    if mirror {
        y = -y;
    }
    let x = if mirror { -x } else { x };
    let abs = crate::person::absolute(&arm.person.body.bones, &arm.local);
    let (rot, at) = abs[arm.wrist];
    let scale = Vec3::splat(across.length() / SPREAD);
    let rotation = rot.inverse() * Quat::from_mat3(&Mat3::from_cols(x, y, z));
    let hand = Transform { translation: rot.inverse() * (middle - at), rotation, scale };
    // The forearm's frame: its axis from the elbow to the wrist, turned as the fist's about it.
    let wrist = here("wrist", false);
    let zf = (wrist - here("lowerarm01", false)).normalize();
    let xf = (x - zf * x.dot(zf)).normalize();
    let (rot, at) = abs[arm.twist];
    let forearm = Transform { translation: rot.inverse() * (wrist - at), rotation: rot.inverse() * Quat::from_mat3(&Mat3::from_cols(xf, zf.cross(xf), zf)), scale };
    (hand, forearm, mirror)
}

// What is on the fists now, and its entities.
#[derive(Resource, Default)]
struct On {
    key: &'static str,
    entities: Vec<Entity>,
}

// Put on the fists while what is held is something worn on them and the fists are up; taken off otherwise.
#[allow(clippy::too_many_arguments)]
fn put_on(
    mut commands: Commands,
    weapons: Res<crate::weapons::Weapons>,
    fists: Res<crate::fist::Fists>,
    arms: Option<Res<crate::hands::Arms>>,
    mut on: ResMut<On>,
    mut made: ResMut<Made>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut metals: ResMut<Assets<Metal>>,
    mut bindposes: ResMut<Assets<SkinnedMeshInverseBindposes>>,
    hall: Res<crate::wet::Hall>,
) {
    let Some(arms) = arms else { return };
    let a = weapons.arm();
    let want = if a.kind == crate::weapons::Kind::Fists && fists.is_up() && matches!(a.key, "gloves" | "dusters") { a.key } else { "" };
    if want == on.key {
        return;
    }
    // (Not before both hands are closed into fists: fist.rs closes them the frame they are taken up.)
    if !want.is_empty() && (arms.r.holding != "fist" || arms.l.holding != "fist") {
        return;
    }
    for e in std::mem::take(&mut on.entities) {
        commands.entity(e).despawn();
    }
    on.key = want;
    if want.is_empty() {
        return;
    }
    for arm in [&arms.r, &arms.l] {
        let (hand, forearm, mirror) = on_fist(arm);
        // (Each placed as on the hand too, so that its bounds, which are not moved with the skin, are about where it is.)
        let skin = SkinnedMesh {
            inverse_bindposes: bindposes.add(SkinnedMeshInverseBindposes::from(vec![hand.to_matrix(), forearm.mul_transform(Transform::from_translation(ON_ARM)).to_matrix()])),
            joints: vec![arm.joints[arm.wrist], arm.joints[arm.twist]],
        };
        for (mesh, _, material, _) in made.get(want, mirror, &mut meshes, &mut materials, &mut images) {
            let mut e = commands.spawn((Mesh3d(mesh), skin.clone(), hand, ChildOf(arm.joints[arm.wrist]), Name::new(want)));
            // (A metal shows the hall in it: the same look, extended.)
            match materials.get(&material).filter(|m| m.metallic > 0.5) {
                Some(base) => {
                    let [hall0, hall1, hall2, hall3, hall4, hall5] = hall.faces.clone();
                    let metal = metals.add(Metal { base: base.clone(), extension: Polished { hall0, hall1, hall2, hall3, hall4, hall5 } });
                    e.insert(MeshMaterial3d(metal));
                }
                None => {
                    e.insert(MeshMaterial3d(material));
                }
            }
            on.entities.push(e.id());
        }
    }
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "polished.wesl");
    app.init_resource::<Made>()
        .init_resource::<On>()
        .add_plugins(MaterialPlugin::<Metal>::default())
        .add_systems(Update, put_on.after(crate::fist::punch));
}

#[cfg(test)]
mod tests {
    use super::*;

    // Worn, the glove's front is the hand's, the cuff's open end the forearm's, every point's weights whole; the forearm's
    // pieces brought back into the fist's frame, behind the wrist.
    #[test]
    fn glove_hung_from_both() {
        for (b, _, arm) in shapes("gloves") {
            let m = skinned(b.mesh(false), arm);
            let Some(VertexAttributeValues::Float32x3(p)) = m.attribute(Mesh::ATTRIBUTE_POSITION) else { panic!() };
            let Some(VertexAttributeValues::Float32x4(w)) = m.attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT) else { panic!() };
            for (p, w) in p.iter().zip(w) {
                assert!((w[0] + w[1] - 1.0).abs() < 1e-5);
                assert!(p[2] < -0.07 || w[0] > 0.999, "{p:?} {w:?}");
                assert!(p[2] > -0.15 || w[1] > 0.999, "{p:?} {w:?}");
            }
            assert!(!arm || p.iter().all(|p| p[2] < -0.09), "a forearm piece not behind the wrist");
        }
    }

    // The glove's mitt reaches 4 to 6 cm past the knuckle joints in front; every part of it faces out (its corners' normals
    // away from its middle); and its mirror image is the same shape turned.
    #[test]
    fn glove_in_front() {
        let made = shapes("gloves");
        let front = made[0].0.pos.iter().map(|p| p.z).fold(f32::MIN, f32::max);
        assert!((0.04..0.065).contains(&front), "{front}");
        for (part, mid) in [(mitt(), Vec3::new(0.0, -0.014, -0.035)), (cuff(-0.235, -0.11, 0.047, 0.041, 0.04, 0.16, 0.004), Vec3::new(0.0, -0.01, -0.17))] {
            let Some(VertexAttributeValues::Float32x3(p)) = part.attribute(Mesh::ATTRIBUTE_POSITION) else { panic!() };
            let Some(VertexAttributeValues::Float32x3(n)) = part.attribute(Mesh::ATTRIBUTE_NORMAL) else { panic!() };
            let out = p.iter().zip(n).filter(|(p, n)| (Vec3::from(**p) - mid).normalize_or_zero().dot(Vec3::from(**n)) > 0.0).count();
            assert!(out as f32 > 0.9 * p.len() as f32, "{out} of {}", p.len());
        }
        let m = made[0].0.mesh(true);
        let Some(VertexAttributeValues::Float32x3(p)) = m.attribute(Mesh::ATTRIBUTE_POSITION) else { panic!() };
        assert!(p.iter().map(|v| v[0]).fold(f32::MIN, f32::max) > 0.07);
    }
}
