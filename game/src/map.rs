// The sandbox's hall, laid out as a test map (src/sandbox/map.ts): a measured grid on everything (a line every 10 cm,
// heavier every 25 cm, heaviest every metre, the heights numbered on the walls), and things to try people, falls,
// guns and blood on. Up the east side a ramp, ledges at one, two and three metres with stairs between them, and a
// balcony along the north wall on pillars; across the south end a low and a high wall to shoot over and round, and a
// corridor with a doorway into it; a few crates in the north-west. The middle is kept clear for the people's line-up
// and the arsenal board on the west wall.
//
// Everything is a box (the ramp a box tilted), listed once in BLOCKS: from that list the hall is drawn (one mesh for
// the room, one for everything in it, one for the hazard stripes on drop edges, one for the numbers), made solid to
// Rapier (one fixed body), walked on by the player (ground, push) and landed on by blood (land, covered).
//
// The numbers are the TS's, in its space (+Z north): the list and the questions asked of it are kept there, so they
// read the same as map.ts, and every point is brought over (main.rs `babylon`) where it meets Bevy, in what is built
// and at the edge of each public function, which all take and give Bevy's coordinates.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use bevy::asset::RenderAssetUsages;
use bevy::image::Image;
use bevy::light::{EnvironmentMapLight, NotShadowCaster};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension};
use bevy::shader::ShaderRef;
use bevy_rapier3d::prelude::*;

use crate::babylon;
use crate::surfaces::Surfaces;

pub struct Hall {
    pub x: f32,
    pub z: f32,
    pub height: f32,
}
pub const HALL: Hall = Hall { x: 11.0, z: 11.0, height: 5.5 };
const STEP: f32 = 0.45; // m: the highest thing the player steps up onto as they walk (player.rs: a stair, not a 50 cm crate)
const HEAD: f32 = 1.8; // m: how tall the player is, for walking under things

// What each kind of thing is coloured (linear): neutral greys for the room, a strong colour for each kind of
// structure, as prototype maps do, so that what a thing is for reads from across the hall.
fn colour(kind: &str) -> [f32; 3] {
    match kind {
        "floor" => [0.13, 0.13, 0.13],
        "wall" => [0.3, 0.3, 0.29],
        "roof" => [0.12, 0.12, 0.12],
        "climb" => [0.6, 0.2, 0.04],
        "pillar" => [0.3, 0.3, 0.33],
        "cover" => [0.07, 0.17, 0.42],
        "crate" => [0.15, 0.32, 0.1],
        _ => unreachable!(),
    }
}

#[derive(Clone, Copy)]
struct Block {
    kind: &'static str,
    x0: f32,
    x1: f32,
    y0: f32,
    y1: f32,
    z0: f32,
    z1: f32,
    ramp: bool,
}

fn blocks() -> Vec<Block> {
    let mut out = Vec::new();
    let mut block = |kind, x0, x1, y0, y1, z0, z1, ramp| out.push(Block { kind, x0, x1, y0, y1, z0, z1, ramp });
    // Five stairs of 20 cm rise and 30 cm going, rising north from `from` metres.
    let stairs = |block: &mut dyn FnMut(&'static str, f32, f32, f32, f32, f32, f32, bool), x0: f32, x1: f32, z0: f32, from: f32| {
        for k in 0..5 {
            let k = k as f32;
            block("climb", x0, x1, 0.0, from + 0.2 * (k + 1.0), z0 + 0.3 * k, z0 + 0.3 * (k + 1.0), false);
        }
    };
    // The climb: a ramp (1 in 5) up to a ledge a metre high, stairs up to one at two metres, stairs up to a tower at
    // three, which opens onto the balcony. Every ledge drops straight to the floor along its west edge.
    block("climb", 8.0, 11.0, 0.0, 1.0, -9.0, -4.0, true);
    block("climb", 6.5, 11.0, 0.0, 1.0, -4.0, -0.5, false);
    block("climb", 6.5, 8.5, 0.0, 1.0, -0.5, 1.0, false);
    stairs(&mut block, 8.5, 11.0, -0.5, 1.0);
    block("climb", 6.5, 11.0, 0.0, 2.0, 1.0, 4.5, false);
    block("climb", 6.5, 8.5, 0.0, 2.0, 4.5, 6.0, false);
    stairs(&mut block, 8.5, 11.0, 4.5, 2.0);
    block("climb", 6.5, 11.0, 0.0, 3.0, 6.0, 11.0, false);
    // The balcony: a 30 cm slab three metres up, open underneath, on four pillars along its front.
    block("climb", -8.0, 6.5, 2.7, 3.0, 8.0, 11.0, false);
    for x in [-7.5, -3.5, 0.5, 4.5] {
        block("pillar", x - 0.2, x + 0.2, 0.0, 2.7, 8.05, 8.45, false);
    }
    // Cover: a wall a metre high, one 2.2 m high, and a corridor along the south wall, open at its east end, with a
    // doorway (1 m by 2.2 m) through its wall.
    block("cover", -1.0, 1.5, 0.0, 1.0, -6.65, -6.35, false);
    block("cover", 2.5, 5.0, 0.0, 2.2, -8.65, -8.35, false);
    block("cover", -11.0, -6.5, 0.0, 3.0, -8.65, -8.35, false);
    block("cover", -5.5, -2.0, 0.0, 3.0, -8.65, -8.35, false);
    block("cover", -6.5, -5.5, 2.2, 3.0, -8.65, -8.35, false);
    // Crates: a metre, sixty centimetres on top of it, half a metre.
    block("crate", -7.5, -6.5, 0.0, 1.0, 4.5, 5.5, false);
    block("crate", -7.3, -6.7, 1.0, 1.6, 4.7, 5.3, false);
    block("crate", -6.2, -5.7, 0.0, 0.5, 4.6, 5.1, false);
    out
}

// Edges with a drop of a metre or more under them, striped: [x0, z0, x1, z1, height, which way is out (x, z)].
const EDGES: [[f32; 7]; 8] = [
    [6.5, -4.0, 6.5, 1.0, 1.0, -1.0, 0.0], [6.5, -4.0, 8.0, -4.0, 1.0, 0.0, -1.0],
    [6.5, 1.0, 6.5, 6.0, 2.0, -1.0, 0.0], [6.5, 1.0, 8.5, 1.0, 2.0, 0.0, -1.0],
    [6.5, 6.0, 6.5, 8.0, 3.0, -1.0, 0.0], [6.5, 6.0, 8.5, 6.0, 3.0, 0.0, -1.0],
    [-8.0, 8.0, 6.5, 8.0, 3.0, 0.0, -1.0], [-8.0, 8.0, -8.0, 11.0, 3.0, -1.0, 0.0],
];

// Heights written on things: (text, x, y, z, which way the face looks (x, z), letter height).
type Sign = (String, f32, f32, f32, f32, f32, f32);
fn signs() -> Vec<Sign> {
    [
        ("1 m", 6.5, 0.75, -2.0, -1.0, 0.0, 0.12), ("2 m", 6.5, 1.75, 3.0, -1.0, 0.0, 0.12), ("3 m", 6.5, 2.75, 7.0, -1.0, 0.0, 0.12),
        ("3 m", -2.0, 2.78, 8.0, 0.0, -1.0, 0.1), ("1 m", 0.25, 0.85, -6.65, 0.0, -1.0, 0.12), ("2.2 m", 3.75, 2.05, -8.65, 0.0, -1.0, 0.12),
        ("2.2 m", -6.0, 2.5, -8.65, 0.0, -1.0, 0.12), ("1 m", -7.0, 0.85, 4.5, 0.0, -1.0, 0.1), ("0.5 m", -5.95, 0.4, 4.6, 0.0, -1.0, 0.07),
    ]
    .into_iter()
    .map(|(t, x, y, z, nx, nz, h)| (t.to_string(), x, y, z, nx, nz, h))
    .collect()
}

// The hall's blocks and, for each square metre of the floor, the blocks over it, so that a drop is only tested
// against what is near it.
#[derive(Resource)]
pub struct Map {
    blocks: Vec<Block>,
    cells: Vec<Vec<usize>>,
}

const CELLS: usize = (HALL.x as usize) * 2;

impl Default for Map {
    fn default() -> Self {
        let blocks = blocks();
        let mut cells = vec![Vec::new(); CELLS * CELLS];
        for (k, b) in blocks.iter().enumerate() {
            for i in (b.x0 + HALL.x).floor() as usize..=(b.x1 + HALL.x - 1e-6).floor() as usize {
                for j in (b.z0 + HALL.z).floor() as usize..=(b.z1 + HALL.z - 1e-6).floor() as usize {
                    cells[j * CELLS + i].push(k);
                }
            }
        }
        Map { blocks, cells }
    }
}

// How high a block's top is at (x, z): the ramp's rises from its south end to its north.
fn top(b: &Block, x: f32, z: f32) -> f32 {
    let _ = x;
    if b.ramp { b.y0 + (b.y1 - b.y0) * ((z - b.z0) / (b.z1 - b.z0)).clamp(0.0, 1.0) } else { b.y1 }
}

impl Map {
    fn near(&self, x: f32, z: f32) -> &[usize] {
        let (i, j) = ((x + HALL.x).floor(), (z + HALL.z).floor());
        if i < 0.0 || j < 0.0 || i >= CELLS as f32 || j >= CELLS as f32 {
            return &[];
        }
        &self.cells[j as usize * CELLS + i as usize]
    }

    // The ramp's slope, the way its top faces (TS space).
    fn slope(&self) -> Vec3 {
        let r = self.blocks.iter().find(|b| b.ramp).unwrap();
        Vec3::new(0.0, r.z1 - r.z0, -(r.y1 - r.y0)).normalize()
    }

    // The height of what is underfoot at (x, z) (Bevy's): the highest top there no higher than `below` (the floor, if
    // nothing is).
    pub fn ground(&self, x: f32, z: f32, below: f32) -> f32 {
        let z = -z;
        let mut g: f32 = 0.0;
        for &k in self.near(x, z) {
            let b = &self.blocks[k];
            if x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 {
                continue;
            }
            let t = top(b, x, z);
            if t <= below && t > g {
                g = t;
            }
        }
        g
    }

    // Whether the straight line from `a` to `b` passes through anything built: what a sound has to go round. Each
    // block is taken 5 cm in from its faces, so that a sound on a surface is not hidden by the surface it is on.
    pub fn screened(&self, a: Vec3, b: Vec3) -> bool {
        const IN: f32 = 0.05;
        let (a, b) = (babylon(a.x, a.y, a.z), babylon(b.x, b.y, b.z));
        'blocks: for k in &self.blocks {
            let (mut t0, mut t1) = (0.0f32, 1.0f32);
            for (i, lo, hi) in [(0, k.x0 + IN, k.x1 - IN), (1, k.y0 + IN, k.y1 - IN), (2, k.z0 + IN, k.z1 - IN)] {
                let d = b[i] - a[i];
                if d.abs() < 1e-9 {
                    if a[i] < lo || a[i] > hi {
                        continue 'blocks;
                    }
                    continue;
                }
                let (u, v) = ((lo - a[i]) / d, (hi - a[i]) / d);
                t0 = t0.max(u.min(v));
                t1 = t1.min(u.max(v));
                if t0 > t1 {
                    continue 'blocks;
                }
            }
            // The ramp fills its box only under its slope.
            if k.ramp {
                let t = (t0 + t1) / 2.0;
                let p = a + (b - a) * t;
                if p.y > top(k, p.x, p.z) {
                    continue;
                }
            }
            return true;
        }
        false
    }

    // Whether the floor at (x, z) is under something standing on it (blood does not run in there).
    pub fn covered(&self, x: f32, z: f32) -> bool {
        let z = -z;
        self.near(x, z).iter().any(|&k| {
            let b = &self.blocks[k];
            b.y0 == 0.0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1
        })
    }

    // What the player cannot walk through, for feet at `feet`: what rises more than a step above them and does not
    // pass over their head. Moves `at` ([x, z], Bevy's) out of it; the way it was pushed, or None.
    pub fn push(&self, at: &mut [f32; 2], radius: f32, feet: f32) -> Option<[f32; 2]> {
        let mut ts = [at[0], -at[1]];
        let mut pushed = None;
        for _ in 0..2 {
            for b in &self.blocks {
                if b.y0 >= feet + HEAD {
                    continue;
                }
                let (nx, nz) = (ts[0].clamp(b.x0, b.x1), ts[1].clamp(b.z0, b.z1));
                if (nx - ts[0]).powi(2) + (nz - ts[1]).powi(2) >= radius * radius || top(b, nx, nz) <= feet + STEP {
                    continue;
                }
                let rect = crate::solids::Rect { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 };
                pushed = crate::solids::clear(&mut ts, radius, &rect).or(pushed);
            }
        }
        *at = [ts[0], -ts[1]];
        pushed.map(|[x, z]| [x, -z])
    }

    // Whether a drop now at `at`, going `vel`, is inside a block: if so it is put back on the face it came in through
    // (the one it crossed last), and that face's normal returned; None if it is in the open.
    pub fn land(&self, at: &mut Vec3, vel: Vec3) -> Option<Vec3> {
        let mut p = babylon(at.x, at.y, at.z);
        let v = babylon(vel.x, vel.y, vel.z);
        for &k in self.near(p.x, p.z) {
            let b = &self.blocks[k];
            let t = top(b, p.x, p.z);
            if p.x <= b.x0 || p.x >= b.x1 || p.z <= b.z0 || p.z >= b.z1 || p.y >= t || p.y <= b.y0 {
                continue;
            }
            let (mut soonest, mut face) = (f32::INFINITY, 0);
            let mut crossed = |depth: f32, speed: f32, f: usize| {
                if speed > 1e-6 && depth / speed < soonest {
                    soonest = depth / speed;
                    face = f;
                }
            };
            crossed(t - p.y, -v.y, 0);
            if b.y0 > 0.0 {
                crossed(p.y - b.y0, v.y, 1);
            }
            crossed(p.x - b.x0, v.x, 2);
            crossed(b.x1 - p.x, -v.x, 3);
            crossed(p.z - b.z0, v.z, 4);
            crossed(b.z1 - p.z, -v.z, 5);
            const OFF: f32 = 0.001;
            match face {
                0 => p.y = t + OFF,
                1 => p.y = b.y0 - OFF,
                2 => p.x = b.x0 - OFF,
                3 => p.x = b.x1 + OFF,
                4 => p.z = b.z0 - OFF,
                _ => p.z = b.z1 + OFF,
            }
            *at = babylon(p.x, p.y, p.z);
            let out = [Vec3::Y, Vec3::NEG_Y, Vec3::NEG_X, Vec3::X, Vec3::NEG_Z, Vec3::Z];
            let n = if face == 0 && b.ramp { self.slope() } else { out[face] };
            return Some(babylon(n.x, n.y, n.z));
        }
        None
    }
}

// The grid on the hall's paint (grid.wesl).
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone, Default)]
pub struct Grid {}

impl MaterialExtension for Grid {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/grid.wesl".into()
    }
}

// Geometry put together a face at a time (corners in the TS's space), with the face's colour on its corners and its
// UVs laid in the world (the concrete's relief and roughness, a tile every 2.5 m, as the old hall had them).
#[derive(Default)]
struct Sheet {
    p: Vec<Vec3>,
    n: Vec<Vec3>,
    c: Vec<[f32; 4]>,
    uv: Vec<Vec2>,
    i: Vec<u32>,
}

impl Sheet {
    fn face(&mut self, corners: &[[f32; 3]], normal: [f32; 3], colour: [f32; 3], tile: f32) {
        let base = self.p.len() as u32;
        let [nx, ny, nz] = normal.map(f32::abs);
        let n = babylon(normal[0], normal[1], normal[2]);
        for q in corners {
            self.p.push(babylon(q[0], q[1], q[2]));
            self.n.push(n);
            self.c.push([colour[0], colour[1], colour[2], 1.0]);
            let (u, v) = if ny > 0.5 { (q[0], q[2]) } else if nx > nz { (q[2], q[1]) } else { (q[0], q[1]) };
            // (v the other way: Babylon turned its images over as it loaded them.)
            self.uv.push(Vec2::new(u / tile, -v / tile));
        }
        for k in 1..corners.len() - 1 {
            // Counter-clockwise seen from the side the normal points to: Bevy's front.
            let (a, b, c) = (self.p[base as usize], self.p[base as usize + k], self.p[base as usize + k + 1]);
            let tri = [base, base + k as u32, base + k as u32 + 1];
            self.i.extend(if (b - a).cross(c - a).dot(n) >= 0.0 { tri } else { [tri[0], tri[2], tri[1]] });
        }
    }

    fn mesh(self, tangents: bool) -> Mesh {
        let mut m = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.p)
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.n)
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, self.uv)
            .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, self.c)
            .with_inserted_indices(Indices::U32(self.i));
        if tangents {
            m.generate_tangents().expect("hall tangents");
        }
        m
    }
}

// A block's faces: all but a bottom on the floor.
fn faces(s: &mut Sheet, b: &Block, slope: Vec3) {
    let Block { x0, x1, y0, y1, z0, z1, .. } = *b;
    let colour = colour(b.kind);
    let h0 = if b.ramp { y0 } else { y1 }; // the top's height at its south end
    s.face(&[[x0, h0, z0], [x1, h0, z0], [x1, y1, z1], [x0, y1, z1]], if b.ramp { slope.to_array() } else { [0.0, 1.0, 0.0] }, colour, 2.5);
    if y0 > 0.0 {
        s.face(&[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0.0, -1.0, 0.0], colour, 2.5);
    }
    s.face(&[[x0, y0, z0], [x0, h0, z0], [x0, y1, z1], [x0, y0, z1]], [-1.0, 0.0, 0.0], colour, 2.5);
    s.face(&[[x1, y0, z0], [x1, h0, z0], [x1, y1, z1], [x1, y0, z1]], [1.0, 0.0, 0.0], colour, 2.5);
    if h0 > y0 {
        s.face(&[[x0, y0, z0], [x1, y0, z0], [x1, h0, z0], [x0, h0, z0]], [0.0, 0.0, -1.0], colour, 2.5);
    }
    s.face(&[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0.0, 0.0, 1.0], colour, 2.5);
}

// Yellow and black, at 45 degrees, tiling (128 pixels a side, each pixel sampled four times for the edges).
fn stripes() -> Image {
    let mut data = Vec::with_capacity(128 * 128 * 4);
    for y in 0..128 {
        for x in 0..128 {
            let mut dark = 0.0;
            for (sx, sy) in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                let d = (x as f32 + sx - (y as f32 + sy)).rem_euclid(64.0);
                dark += if d < 32.0 { 0.25 } else { 0.0 };
            }
            let mix = |a: f32, b: f32| (a * (1.0 - dark) + b * dark).round() as u8;
            data.extend([mix(217.0, 20.0), mix(169.0, 20.0), mix(15.0, 20.0), 255]);
        }
    }
    Image::new(Extent3d { width: 128, height: 128, depth_or_array_layers: 1 }, TextureDimension::D2, data, TextureFormat::Rgba8UnormSrgb,
               RenderAssetUsages::default())
}

// The numbers, white on black cards so they read on any colour, each on a row of one texture: the texture, and how
// wide each is (of the texture's width).
fn lettering(texts: &[String]) -> (Image, Vec<f32>) {
    const ROW: usize = 64;
    const W: usize = 256;
    let font = FontRef::try_from_slice(include_bytes!("../../assets/fonts/im-fell-english.ttf")).expect("font");
    let scaled = font.as_scaled(PxScale::from(44.0));
    let mut data = vec![0u8; W * ROW * texts.len() * 4];
    let mut wide = Vec::new();
    for (k, text) in texts.iter().enumerate() {
        let advance: f32 = text.chars().map(|c| scaled.h_advance(font.glyph_id(c))).sum();
        let w = (advance + 24.0).min(W as f32) as usize;
        for y in k * ROW + 2..(k + 1) * ROW - 2 {
            for x in 0..w {
                data[(y * W + x) * 4..(y * W + x) * 4 + 4].copy_from_slice(&[17, 17, 17, 255]);
            }
        }
        // Centred on the row's middle, as a canvas's textBaseline 'middle' puts it.
        let baseline = (k * ROW + ROW / 2 + 1) as f32 + (scaled.ascent() + scaled.descent()) / 2.0;
        let mut pen = 12.0;
        for c in text.chars() {
            let id = font.glyph_id(c);
            let glyph = id.with_scale_and_position(scaled.scale(), ab_glyph::point(pen, baseline));
            pen += scaled.h_advance(id);
            let Some(outline) = font.outline_glyph(glyph) else { continue };
            let bounds = outline.px_bounds();
            outline.draw(|gx, gy, cover| {
                let (x, y) = (bounds.min.x as i32 + gx as i32, bounds.min.y as i32 + gy as i32);
                if x < 0 || y < 0 || x >= W as i32 || y >= ((k + 1) * ROW) as i32 {
                    return;
                }
                let at = (y as usize * W + x as usize) * 4;
                let v = (17.0 + (238.0 - 17.0) * cover.min(1.0)).round() as u8;
                data[at..at + 3].copy_from_slice(&[v, v, v]);
            });
        }
        wide.push(w as f32 / W as f32);
    }
    let image = Image::new(
        Extent3d { width: W as u32, height: (ROW * texts.len()) as u32, depth_or_array_layers: 1 },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );
    (image, wide)
}

// The fill: a little light from everywhere, more from above than below, as Babylon's hemispheric light gave it
// (diffuse only: the materials took nothing from the environment). Bevy has no such light; an environment map whose
// diffuse is the same blend of sky and ground at every normal gives the same, and its specular is left black.
const FILL: f32 = 0.45;
const SKY: [f32; 3] = [0.85, 0.88, 0.95];
const GROUND: [f32; 3] = [0.25, 0.24, 0.23];

pub fn fill_light(images: &mut Assets<Image>) -> EnvironmentMapLight {
    const SIZE: usize = 16;
    let mut cube = |f: &dyn Fn(Vec3) -> [f32; 3]| {
        let mut data = Vec::with_capacity(SIZE * SIZE * 6 * 4);
        for face in 0..6 {
            for y in 0..SIZE {
                for x in 0..SIZE {
                    let (u, v) = ((x as f32 + 0.5) / SIZE as f32 * 2.0 - 1.0, (y as f32 + 0.5) / SIZE as f32 * 2.0 - 1.0);
                    // The cube's faces in wgpu's order: +X, -X, +Y, -Y, +Z, -Z.
                    let d = match face {
                        0 => Vec3::new(1.0, -v, -u),
                        1 => Vec3::new(-1.0, -v, u),
                        2 => Vec3::new(u, 1.0, v),
                        3 => Vec3::new(u, -1.0, -v),
                        4 => Vec3::new(u, -v, 1.0),
                        _ => Vec3::new(-u, -v, -1.0),
                    }
                    .normalize();
                    let c = f(d);
                    data.extend(c.map(|x| (Color::linear_rgb(x, 0.0, 0.0).to_srgba().red * 255.0).round() as u8));
                    data.push(255);
                }
            }
        }
        let mut image = Image::new(
            Extent3d { width: SIZE as u32, height: SIZE as u32, depth_or_array_layers: 6 },
            TextureDimension::D2,
            data,
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::RENDER_WORLD,
        );
        image.texture_view_descriptor = Some(TextureViewDescriptor { dimension: Some(TextureViewDimension::Cube), ..default() });
        images.add(image)
    };
    // Babylon's hemispheric light: the ground's colour facing down, the sky's facing up, between them in a straight
    // line with the normal's height.
    let diffuse = cube(&|d| {
        let t = d.y * 0.5 + 0.5;
        [0, 1, 2].map(|i| GROUND[i] + (SKY[i] - GROUND[i]) * t)
    });
    let specular = cube(&|_| [0.0; 3]);
    EnvironmentMapLight { diffuse_map: diffuse, specular_map: specular, intensity: FILL, ..default() }
}

// The hall's lamps: two big ones over the line-up casting shadows, four more over the rest without (one over the
// balcony reaching only as far down as its deck, so the floor under the slab is not lit through it). Each is
// Babylon's spot of `power` candela with glTF falloff (Bevy's spot is given lumens over the whole sphere: 4 pi of
// them a candela), a cone `angle` across and a reach `range` (Babylon's had none unless given: Bevy's is set past the
// hall).
const LAMPS: [(f32, f32, f32, f32, f32); 6] = [
    (-2.5, 1.0, 70.0, 40.0, 1.75), (2.5, 1.0, 70.0, 40.0, 1.75), (3.0, -6.5, 30.0, 40.0, 1.75), (-6.5, -3.0, 30.0, 40.0, 1.75),
    (8.75, 1.5, 30.0, 40.0, 1.75), (2.5, 9.5, 30.0, 4.6, 2.3),
];
pub const LAMP_COLOUR: Color = Color::linear_rgb(1.0, 0.96, 0.9);
pub const CANDELA: f32 = 4.0 * std::f32::consts::PI;

// The lamps that cast shadows, for the quality presets (graphics.rs).
#[derive(Component)]
pub struct ShadowLamp;

fn build(
    mut commands: Commands,
    map: Res<Map>,
    assets: Res<AssetServer>,
    mut surfaces: ResMut<Surfaces>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut paints: ResMut<Assets<ExtendedMaterial<StandardMaterial, Grid>>>,
) {
    let (w, d, h) = (HALL.x, HALL.z, HALL.height);
    for &(x, z, power, range, angle) in &LAMPS {
        let mut lamp = commands.spawn((
            SpotLight {
                color: LAMP_COLOUR,
                intensity: power * CANDELA,
                range,
                outer_angle: angle / 2.0,
                inner_angle: 0.0,
                shadow_maps_enabled: power >= 70.0,
                shadow_map_near_z: 0.3,
                ..default()
            },
            Transform::from_translation(babylon(x, h - 0.3, z)).looking_to(Vec3::NEG_Y, Vec3::Z),
        ));
        if power >= 70.0 {
            lamp.insert(ShadowLamp);
        }
    }

    // Painted concrete: the colour is the faces', the relief and roughness the old hall's concrete.
    surfaces.load(&assets, &["ceiling", "pavement"]);
    let maps = surfaces.maps("ceiling");
    let paint = paints.add(ExtendedMaterial {
        base: StandardMaterial {
            normal_map_texture: Some(maps.normal.clone()),
            metallic_roughness_texture: Some(maps.rough.clone()),
            metallic: 0.0,
            perceptual_roughness: 0.9,
            reflectance: 0.5 * 0.6f32.sqrt(),
            ..default()
        },
        extension: Grid {},
    });

    let mut room = Sheet::default();
    let c = colour;
    room.face(&[[-w, 0.0, -d], [w, 0.0, -d], [w, 0.0, d], [-w, 0.0, d]], [0.0, 1.0, 0.0], c("floor"), 2.5);
    room.face(&[[-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]], [0.0, -1.0, 0.0], c("roof"), 2.5);
    room.face(&[[-w, 0.0, d], [w, 0.0, d], [w, h, d], [-w, h, d]], [0.0, 0.0, -1.0], c("wall"), 2.5);
    room.face(&[[-w, 0.0, -d], [w, 0.0, -d], [w, h, -d], [-w, h, -d]], [0.0, 0.0, 1.0], c("wall"), 2.5);
    room.face(&[[w, 0.0, -d], [w, 0.0, d], [w, h, d], [w, h, -d]], [-1.0, 0.0, 0.0], c("wall"), 2.5);
    room.face(&[[-w, 0.0, -d], [-w, 0.0, d], [-w, h, d], [-w, h, -d]], [1.0, 0.0, 0.0], c("wall"), 2.5);
    // (The room's own walls cast no shadow: every lamp is inside them.)
    commands.spawn((Mesh3d(meshes.add(room.mesh(true))), MeshMaterial3d(paint.clone()), NotShadowCaster, Name::new("hall")));
    let slope = map.slope();
    let mut things = Sheet::default();
    for b in &map.blocks {
        faces(&mut things, b, slope);
    }
    commands.spawn((Mesh3d(meshes.add(things.mesh(true))), MeshMaterial3d(paint), Name::new("structures")));

    // The stripes: 12 cm along the top of each drop edge and down its face, a few millimetres proud of it.
    let hazard = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(stripes())),
        metallic: 0.0,
        perceptual_roughness: 0.6,
        ..default()
    });
    let mut strip = Sheet::default();
    let (white, e, s) = ([1.0; 3], 0.004, 0.12);
    for [x0, z0, x1, z1, y, ox, oz] in EDGES {
        let (ix, iz, px, pz) = (-ox * s, -oz * s, ox * e, oz * e);
        strip.face(&[[x0 + px, y + e, z0 + pz], [x1 + px, y + e, z1 + pz], [x1 + px + ix, y + e, z1 + pz + iz], [x0 + px + ix, y + e, z0 + pz + iz]],
                   [0.0, 1.0, 0.0], white, 0.25);
        strip.face(&[[x0 + px, y + e, z0 + pz], [x1 + px, y + e, z1 + pz], [x1 + px, y - s, z1 + pz], [x0 + px, y - s, z0 + pz]], [ox, 0.0, oz], white, 0.25);
    }
    commands.spawn((Mesh3d(meshes.add(strip.mesh(false))), MeshMaterial3d(hazard), NotShadowCaster, Name::new("hazard")));

    // The numbers: the heights up every wall every four metres (where nothing stands in front of them or hangs
    // there), and each structure's height on it.
    let mut all = signs();
    for y in 1..h as i32 {
        let y = y as f32;
        for u in (-8..=8).step_by(4) {
            let u = u as f32;
            for [x, z, nx, nz] in [[u, d, 0.0, -1.0], [u, -d, 0.0, 1.0], [w, u, -1.0, 0.0], [-w, u, 1.0, 0.0]] {
                let (ix, iz) = (x + nx * 0.2, z + nz * 0.2);
                if map.blocks.iter().any(|b| ix > b.x0 && ix < b.x1 && iz > b.z0 && iz < b.z1 && y + 0.15 > b.y0 && y - 0.05 < b.y1) {
                    continue;
                }
                if nx == 1.0 && iz > -5.2 && iz < 2.8 && y < 3.0 {
                    continue; // the arsenal board
                }
                all.push((format!("{y} m"), x, y + 0.16, z, nx, nz, 0.24));
            }
        }
    }
    let mut texts: Vec<String> = Vec::new();
    for s in &all {
        if !texts.contains(&s.0) {
            texts.push(s.0.clone());
        }
    }
    let (letters, wide) = lettering(&texts);
    let rows = texts.len() as f32;
    let mut written = Sheet::default();
    for (text, x, y, z, nx, nz, high) in &all {
        let k = texts.iter().position(|t| t == text).unwrap();
        let along = high * wide[k] * 256.0 / 64.0;
        // Along the face, to the right as one looks at it; left-aligned at (x, z), centred on y.
        let (rx, rz, px, pz) = (-nz, *nx, x + nx * 0.003, z + nz * 0.003);
        written.face(&[[px, y - high / 2.0, pz], [px + rx * along, y - high / 2.0, pz + rz * along], [px + rx * along, y + high / 2.0, pz + rz * along],
                       [px, y + high / 2.0, pz]], [*nx, 0.0, *nz], [1.0; 3], 1.0);
        let n = written.uv.len();
        let (v0, v1) = ((k as f32 + 1.0) / rows, k as f32 / rows);
        written.uv[n - 4..].copy_from_slice(&[Vec2::new(0.0, v0), Vec2::new(wide[k], v0), Vec2::new(wide[k], v1), Vec2::new(0.0, v1)]);
    }
    let ink = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(letters)),
        metallic: 0.0,
        perceptual_roughness: 0.7,
        depth_bias: 1.0,
        ..default()
    });
    commands.spawn((Mesh3d(meshes.add(written.mesh(false))), MeshMaterial3d(ink), NotShadowCaster, Name::new("signs")));

    // The lamps' housings: lit panels, which is what anything wet or polished shows most of.
    let glow = materials.add(StandardMaterial {
        base_color: Color::WHITE,
        emissive: LinearRgba::rgb(1.0, 0.96, 0.9) * 6.0,
        ..default()
    });
    let disc = meshes.add(Circle::new(0.35).mesh().resolution(32));
    for &(x, z, ..) in &LAMPS {
        commands.spawn((
            Mesh3d(disc.clone()),
            MeshMaterial3d(glow.clone()),
            NotShadowCaster,
            Transform::from_translation(babylon(x, h - 0.3 + 0.02, z)).with_rotation(Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
        ));
    }

    // Solid to Rapier: the floor, walls and roof as slabs behind their faces, and every block, all one fixed body.
    let mut shapes: Vec<(Vec3, Quat, Collider)> = Vec::new();
    let mut slab = |centre: Vec3, size: Vec3, turn: Quat| shapes.push((babylon(centre.x, centre.y, centre.z), turn, Collider::cuboid(size.x / 2.0, size.y / 2.0, size.z / 2.0)));
    slab(Vec3::new(0.0, -0.5, 0.0), Vec3::new(w * 2.0, 1.0, d * 2.0), Quat::IDENTITY);
    slab(Vec3::new(0.0, h + 0.5, 0.0), Vec3::new(w * 2.0, 1.0, d * 2.0), Quat::IDENTITY);
    slab(Vec3::new(0.0, h / 2.0, d + 0.5), Vec3::new(w * 2.0, h, 1.0), Quat::IDENTITY);
    slab(Vec3::new(0.0, h / 2.0, -d - 0.5), Vec3::new(w * 2.0, h, 1.0), Quat::IDENTITY);
    slab(Vec3::new(w + 0.5, h / 2.0, 0.0), Vec3::new(1.0, h, d * 2.0), Quat::IDENTITY);
    slab(Vec3::new(-w - 0.5, h / 2.0, 0.0), Vec3::new(1.0, h, d * 2.0), Quat::IDENTITY);
    for b in &map.blocks {
        let centre = Vec3::new((b.x0 + b.x1) / 2.0, (b.y0 + b.y1) / 2.0, (b.z0 + b.z1) / 2.0);
        if !b.ramp {
            slab(centre, Vec3::new(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), Quat::IDENTITY);
            continue;
        }
        // The ramp: a half-metre slab tilted to lie under its top, from below the floor at the foot into the ledge
        // at the head. (The TS turned it -atan(rise/run) about X in its space; the same turn here is the other way.)
        let (rise, run) = (b.y1 - b.y0, b.z1 - b.z0);
        const T: f32 = 0.5;
        slab(centre - slope * (T / 2.0), Vec3::new(b.x1 - b.x0, T, rise.hypot(run)), Quat::from_rotation_x(rise.atan2(run)));
    }
    commands.spawn((
        RigidBody::Fixed,
        Collider::compound(shapes),
        CollisionGroups::new(WORLD, Group::ALL),
        Friction::coefficient(0.8),
        Restitution::coefficient(0.05),
        Transform::default(),
        Name::new("hall body"),
    ));
}

// The room and loose things, in the collision bits ragdoll.ts gave each kind of thing.
pub const WORLD: Group = Group::GROUP_1;

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "grid.wesl");
    app.init_resource::<Map>()
        .add_plugins(MaterialPlugin::<ExtendedMaterial<StandardMaterial, Grid>>::default())
        .add_systems(Startup, build);
}

#[test]
fn ground_and_push() {
    let map = Map::default();
    // On the 1 m ledge (TS x 7..11, z -4..-0.5): Bevy's z is the TS's turned round.
    assert_eq!(map.ground(9.0, 2.0, f32::INFINITY), 1.0);
    // Half way up the ramp (TS z -9 to -4 rising north): 0.5 m.
    assert!((map.ground(9.5, 6.5, f32::INFINITY) - 0.5).abs() < 1e-5);
    // Walking into the low wall from the north (TS z -6.35 face, Bevy z 6.35) is pushed back north (Bevy -z).
    let mut at = [0.0, 6.2];
    let pushed = map.push(&mut at, 0.3, 0.0).unwrap();
    assert!(pushed[1] < 0.0 && at[1] < 6.06);
}
