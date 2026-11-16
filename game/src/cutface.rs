// The cut face of a limb cut through, painted (dismember.ts `paint`, `capMaterial`, `capMesh`).
//
// A picture of the cut face, its height at each point and how glossy it is, in the plane's own directions and at its
// real size. The outlines (skin, the fat's inner edge, each bone) are drawn as shapes into a mask of what is where; then
// every point is coloured for what it is: muscle in bellies of their own, each a slightly different red and swelling a
// little out of the sheath round it, with the fine grain of fibre bundles seen end on; fat in lobules; cortex round
// marrow; and blood lying over all of it, thickest in the hollows, where the face is glossiest.
//
// The colours are what the tissues measure (CIE L*a*b*, D65): muscle beef's, L* 34-40, a* 22-32, b* 10-16 (AMSA's Meat
// Color Measurement Guidelines, 2012; body-wall.md 1.6: "dark red to red-brown, beef-coloured"), fat L* 75-80, a* 5,
// b* 20-25 ("pale cream to light yellow, not orange"), blood lying on them a pool's (fluid.wesl). The TS's muscle was
// a* 50, b* 36 (a pure scarlet) and its fat b* 45 (orange), and lit by a lamp a stump glowed.
//
// The TS drew the shapes on a canvas; here they are filled by hand into the same 512 by 512 pictures, once a cut.

use bevy::asset::RenderAssetUsages;
use bevy::image::Image;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::anatomy::loop_area;

const SIZE: usize = 512;
// What is at each point. Layers that touch are numbered next to each other.
const OUT: u8 = 0;
const EPIDERMIS: u8 = 1;
const DERMIS: u8 = 2;
const FAT: u8 = 3;
const FASCIA: u8 = 4;
const MUSCLE: u8 = 5;
const CORTEX: u8 = 6;
const MARROW: u8 = 7;
const SPONGY: u8 = 8;

type Pt = (f32, f32);

pub struct Look {
    pub albedo: Vec<[f32; 3]>,
    pub bump: Vec<[u8; 4]>,
    pub surface: Vec<[u8; 4]>,
    pub e: f32,
    field: Vec<f32>,
    torn: bool,
}

impl Look {
    // A face not yet painted: its size, and flat.
    pub fn flat(skin: &[Pt], torn: bool) -> Look {
        let e = resample(skin, 160).iter().fold(0.0f32, |m, p| m.max(p.0.abs()).max(p.1.abs())) * 1.06;
        Look { albedo: Vec::new(), bump: Vec::new(), surface: Vec::new(), e, field: vec![0.42; SIZE * SIZE], torn }
    }

    // Heights in metres for the cut face's own shape: the muscle swelling a few millimetres out of its sheath, bone
    // standing proud, the fat a little sunk.
    pub fn height(&self, x: f32, y: f32) -> f32 {
        let (fx, fy) = ((x / (2.0 * self.e) + 0.5) * SIZE as f32, (0.5 - y / (2.0 * self.e)) * SIZE as f32);
        let (ix, iy) = (fx.floor() as i32, fy.floor() as i32);
        let (tx, ty) = (fx - ix as f32, fy - iy as f32);
        let at = |x: i32, y: i32| self.field[y.clamp(0, SIZE as i32 - 1) as usize * SIZE + x.clamp(0, SIZE as i32 - 1) as usize];
        let v = (at(ix, iy) * (1.0 - tx) + at(ix + 1, iy) * tx) * (1.0 - ty) + (at(ix, iy + 1) * (1.0 - tx) + at(ix + 1, iy + 1) * tx) * ty;
        (v - 0.42) * if self.torn { 0.08 } else { 0.05 }
    }
}

fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

// Value noise from a fixed table of random values, 0 to 1, smooth between whole numbers.
struct Noise {
    table: Vec<f32>,
}

impl Noise {
    fn new() -> Noise {
        // (A fixed sequence: the TS filled it from Math.random once a page; the same cut looks the same each run here.)
        let mut s: u32 = 0x2545_f491;
        Noise {
            table: (0..65536)
                .map(|_| {
                    s ^= s << 13;
                    s ^= s >> 17;
                    s ^= s << 5;
                    s as f32 / 4_294_967_296.0
                })
                .collect(),
        }
    }

    fn at(&self, x: f32, y: f32) -> f32 {
        let (ix, iy) = (x.floor() as i32, y.floor() as i32);
        let (fx, fy) = (x - ix as f32, y - iy as f32);
        let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
        let (i0, i1) = (((iy & 255) as usize) << 8, (((iy + 1) & 255) as usize) << 8);
        let (x0, x1) = ((ix & 255) as usize, ((ix + 1) & 255) as usize);
        let (a, b, c, d) = (self.table[i0 + x0], self.table[i0 + x1], self.table[i1 + x0], self.table[i1 + x1]);
        let top = a + (b - a) * sx;
        top + ((c + (d - c) * sx) - top) * sy
    }
}

// A whole-number cell's own random number, 0 to 1.
fn hash(i: i32, j: i32, seed: f32) -> f32 {
    let mut h = (i.wrapping_mul(374761393)).wrapping_add(j.wrapping_mul(668265263)).wrapping_add((seed.floor() as i64 as i32).wrapping_mul(-2048144777));
    h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(1274126177);
    ((h ^ ((h as u32) >> 16) as i32) as u32) as f32 / 4_294_967_296.0
}

// Worley's cells over a jittered grid: how far the nearest cell's point is and the next nearest, and the nearest's own
// random number and the next's.
fn worley(x: f32, y: f32, seed: f32) -> (f32, f32, f32, f32) {
    let (ix, iy) = (x.floor() as i32, y.floor() as i32);
    let (mut f1, mut f2, mut id, mut id2) = (9.0f32, 9.0f32, 0.0, 0.0);
    for j in -1..=1 {
        for i in -1..=1 {
            let (cx, cy) = (ix + i, iy + j);
            let h = hash(cx, cy, seed);
            let dx = cx as f32 + 0.1 + 0.8 * h - x;
            let dy = cy as f32 + 0.1 + 0.8 * hash(cy, cx, seed + 1.0) - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < f1 {
                f2 = f1;
                id2 = id;
                f1 = d;
                id = h;
            } else if d < f2 {
                f2 = d;
                id2 = h;
            }
        }
    }
    (f1, f2, id, id2)
}

// A loop resampled to `count` points evenly round it, always anticlockwise in the plane's own directions.
pub fn resample(l: &[Pt], count: usize) -> Vec<Pt> {
    let mut lengths = vec![0.0f32];
    for i in 1..=l.len() {
        let (a, b) = (l[i - 1], l[i % l.len()]);
        lengths.push(lengths[i - 1] + (b.0 - a.0).hypot(b.1 - a.1));
    }
    let total = lengths[l.len()];
    let mut out = Vec::with_capacity(count);
    let mut j = 0;
    for k in 0..count {
        let want = k as f32 / count as f32 * total;
        while j + 1 < l.len() && lengths[j + 1] < want {
            j += 1;
        }
        let (a, b) = (l[j], l[(j + 1) % l.len()]);
        let t = (want - lengths[j]) / (lengths[j + 1] - lengths[j]).max(1e-9);
        out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }
    if loop_area(out.iter().copied()) < 0.0 {
        out.reverse();
    }
    out
}

// The loop moved in by `by(i)` metres at each point (inward for an anticlockwise loop).
fn inset(l: &[Pt], by: &dyn Fn(usize) -> f32) -> Vec<Pt> {
    let n = l.len();
    (0..n)
        .map(|i| {
            let (a, b) = (l[(i + n - 1) % n], l[(i + 1) % n]);
            let (tx, ty) = (b.0 - a.0, b.1 - a.1);
            let len = tx.hypot(ty).max(1e-12);
            let d = by(i);
            (l[i].0 - ty / len * d, l[i].1 + tx / len * d)
        })
        .collect()
}

fn centroid(l: &[Pt]) -> Pt {
    let (x, y) = l.iter().fold((0.0, 0.0), |a, p| (a.0 + p.0, a.1 + p.1));
    (x / l.len() as f32, y / l.len() as f32)
}

// Smooth noise round a loop: `k` of the way round, the same for the same seed.
pub fn wobble(k: f32, seed: f32) -> f32 {
    let t = std::f32::consts::TAU;
    (k * t * 3.0 + seed).sin() * 0.5 + (k * t * 7.0 + seed * 1.7).sin() * 0.3 + (k * t * 13.0 + seed * 2.3).sin() * 0.2
}

// A picture's pixels: what shapes are filled into.
struct Canvas<'a, T> {
    px: &'a mut [T],
}

impl<T: Copy> Canvas<'_, T> {
    // A polygon (pixel coordinates) filled with `f` at each pixel whose middle is inside it (even-odd).
    fn polygon(&mut self, pts: &[Pt], f: &mut dyn FnMut(&mut T, usize, usize)) {
        if pts.len() < 3 {
            return;
        }
        let (lo, hi) = pts.iter().fold((f32::MAX, f32::MIN), |a, p| (a.0.min(p.1), a.1.max(p.1)));
        let mut xs = Vec::new();
        for y in (lo.floor().max(0.0) as usize)..=(hi.ceil().min(SIZE as f32 - 1.0) as usize) {
            let fy = y as f32 + 0.5;
            xs.clear();
            let mut j = pts.len() - 1;
            for i in 0..pts.len() {
                let (a, b) = (pts[i], pts[j]);
                if (a.1 > fy) != (b.1 > fy) {
                    xs.push(a.0 + (fy - a.1) / (b.1 - a.1) * (b.0 - a.0));
                }
                j = i;
            }
            xs.sort_by(f32::total_cmp);
            for pair in xs.chunks_exact(2) {
                let (x0, x1) = ((pair[0] - 0.5).ceil().max(0.0) as i64, ((pair[1] - 0.5).floor()).min(SIZE as f32 - 1.0) as i64);
                for x in x0..=x1 {
                    f(&mut self.px[y * SIZE + x as usize], x as usize, y);
                }
            }
        }
    }

    // Everything within `r` pixels of `at` (and, with `ry` and `turn`, an ellipse) given `f(pixel, how far in 0..1)`.
    fn ellipse(&mut self, at: Pt, rx: f32, ry: f32, turn: f32, f: &mut dyn FnMut(&mut T, f32)) {
        let r = rx.max(ry);
        let (c, s) = (turn.cos(), turn.sin());
        for y in ((at.1 - r).floor().max(0.0) as usize)..=((at.1 + r).ceil().min(SIZE as f32 - 1.0) as usize) {
            for x in ((at.0 - r).floor().max(0.0) as usize)..=((at.0 + r).ceil().min(SIZE as f32 - 1.0) as usize) {
                let (dx, dy) = (x as f32 + 0.5 - at.0, y as f32 + 0.5 - at.1);
                let (u, v) = ((dx * c + dy * s) / rx, (-dx * s + dy * c) / ry);
                let d = (u * u + v * v).sqrt();
                if d < 1.0 {
                    f(&mut self.px[y * SIZE + x], d);
                }
            }
        }
    }

    // A line from `a` to `b`, `w` pixels wide, round at its ends.
    fn line(&mut self, a: Pt, b: Pt, w: f32, f: &mut dyn FnMut(&mut T)) {
        let r = (w / 2.0).max(0.5);
        let (lo_x, hi_x) = (a.0.min(b.0) - r, a.0.max(b.0) + r);
        let (lo_y, hi_y) = (a.1.min(b.1) - r, a.1.max(b.1) + r);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let l2 = (dx * dx + dy * dy).max(1e-9);
        for y in (lo_y.floor().max(0.0) as usize)..=(hi_y.ceil().min(SIZE as f32 - 1.0) as usize) {
            for x in (lo_x.floor().max(0.0) as usize)..=(hi_x.ceil().min(SIZE as f32 - 1.0) as usize) {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let t = (((px - a.0) * dx + (py - a.1) * dy) / l2).clamp(0.0, 1.0);
                if (px - a.0 - dx * t).hypot(py - a.1 - dy * t) <= r {
                    f(&mut self.px[y * SIZE + x]);
                }
            }
        }
    }
}

fn over(px: &mut [f32; 3], c: [f32; 3], alpha: f32) {
    for k in 0..3 {
        px[k] += (c[k] - px[k]) * alpha;
    }
}

// The cut face painted: `skin` the skin's outline, `solids` (kind, name, outline) the bones and the neck's tubes, `vessels`
// (kind, name, x, y, r); `fat` metres of fat under the skin; `torn` a charge or a blast, not a blade; tendons for a
// hand (`hand`), a foot, or a forearm or shin (`lower`). Metres in the plane's own directions.
#[allow(clippy::too_many_arguments, unused_assignments)]
pub fn paint(skin_loop: &[Pt], solids: &[(String, String, Vec<Pt>)], vessels: &[(String, String, f32, f32, f32)], fat: f32, torn: bool, hand: bool, foot: bool,
             lower: bool, seed: f32) -> Look {
    let noise = Noise::new();
    let vn = |x: f32, y: f32| noise.at(x, y);
    let skin = resample(skin_loop, 160);
    let mut e = skin.iter().fold(0.0f32, |m, p| m.max(p.0.abs()).max(p.1.abs()));
    e *= 1.06;
    let sz = SIZE as f32;
    let px = |p: Pt| ((p.0 / (2.0 * e) + 0.5) * sz, (0.5 - p.1 / (2.0 * e)) * sz);
    let m = |metres: f32| metres / (2.0 * e) * sz;
    let to_px = |l: &[Pt]| l.iter().map(|&p| px(p)).collect::<Vec<_>>();
    // A small random stream for what the TS drew with Math.random (tendons, shreds), from the seed.
    let mut s = (seed * 1000.0) as u32 | 1;
    let mut rnd = move || {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        s as f32 / 4_294_967_296.0
    };

    // The mask.
    let mut mask = vec![OUT; SIZE * SIZE];
    {
        let mut mk = Canvas { px: &mut mask };
        let mut shape = |l: &[Pt], what: u8| mk.polygon(&to_px(l), &mut |p, _, _| *p = what);
        let k = skin.len() as f32;
        let rough = if torn { 1.0 } else { 0.0 };
        shape(&skin, EPIDERMIS);
        shape(&inset(&skin, &|i| 0.0004 + rough * wobble(i as f32 / k, seed).abs() * 0.0007), DERMIS);
        shape(&inset(&skin, &|i| 0.0021 + rough * wobble(i as f32 / k, seed + 1.0).abs() * 0.001), FAT);
        let sheath = inset(&skin, &|i| 0.0021 + fat * (0.7 + 0.5 * wobble(i as f32 / k, seed + 3.0)));
        shape(&sheath, FASCIA);
        shape(&inset(&sheath, &|_| 0.0006), MUSCLE);
        for (kind, _, l) in solids {
            if kind != "bone" && kind != "skull" {
                continue;
            }
            let l = resample(l, 96);
            let a = loop_area(l.iter().copied()).abs();
            // A long bone's shaft is a tube of cortex round marrow; a small bone, or a long bone's end, is spongy through.
            let wall = if a > 2.5e-4 { 0.0045 } else if a > 7e-5 { 0.0026 } else { 0.0 };
            let inner = (wall > 0.0).then(|| inset(&l, &|_| wall));
            match inner {
                Some(inner) if loop_area(inner.iter().copied()).abs() > 3e-6 => {
                    shape(&l, CORTEX);
                    shape(&inner, MARROW);
                }
                _ => shape(&l, SPONGY),
            }
        }
    }

    // Every point coloured for what it is.
    let mut albedo = vec![[0.0f32; 3]; SIZE * SIZE];
    let mut surface = vec![[255u8, 140, 0, 255]; SIZE * SIZE];
    let mut field = vec![0.4f32; SIZE * SIZE];
    let cell_muscle = (e / 3.0).clamp(0.008, 0.026);
    let cell_fat = 0.0024;
    let metre = 2.0 * e / sz;
    let wet = if torn { 0.4 } else { 0.56 }; // the lower, the more of the face lies under blood
    for py in 0..SIZE {
        for pxx in 0..SIZE {
            let q = py * SIZE + pxx;
            let what = mask[q];
            if what == OUT {
                continue;
            }
            let x = (pxx as f32 + 0.5) * metre - e;
            let y = e - (py as f32 + 0.5) * metre;
            let grain = vn(x / 0.0006 + seed, y / 0.0006);
            let broad = vn(x / 0.004 - seed, y / 0.004);
            let (mut r, mut g, mut b, mut h, mut rough, mut blood) = (0.0f32, 0.0f32, 0.0f32, 0.45f32, 0.5f32, 0.0f32);
            match what {
                MUSCLE => {
                    // Bellies: cells of a jittered grid, their borders wavy, a pale sheet of fascia along some borders.
                    let wx = x + (vn(x / 0.012, y / 0.012 + seed) - 0.5) * cell_muscle * 0.5;
                    let wy = y + (vn(x / 0.012 + 7.0, y / 0.012 - seed) - 0.5) * cell_muscle * 0.5;
                    let (f1, f2, id, id2) = worley(wx / cell_muscle, wy / cell_muscle, seed);
                    let edge = (f2 - f1) * cell_muscle;
                    let shade = 0.84 + 0.3 * id;
                    let sheet = (1.0 - smooth(0.00015, 0.00045, edge)) * if hash((id * 977.0 + id2 * 977.0).floor() as i32, 3, seed) > 0.45 { 0.75 } else { 0.0 };
                    let f = shade * (0.86 + 0.22 * grain) * (0.72 + 0.28 * smooth(0.0, 0.0016, edge));
                    r = 150.0 * f;
                    g = 64.0 * f;
                    b = 60.0 * f;
                    r += (212.0 - r) * sheet;
                    g += (194.0 - g) * sheet;
                    b += (186.0 - b) * sheet;
                    h = 0.5 + 0.07 * (0.6 + 0.8 * id) * smooth(0.0, cell_muscle * 0.45, edge) + grain * 0.012 * (1.0 + rough);
                    rough = 0.38;
                    blood = 1.0;
                }
                FAT => {
                    let (f1, f2, id, _) = worley(x / cell_fat + seed, y / cell_fat, seed + 5.0);
                    let edge = (f2 - f1) * cell_fat;
                    let f = (0.88 + 0.16 * id) * (0.92 + 0.12 * grain);
                    r = 226.0 * f;
                    g = 192.0 * f;
                    b = 150.0 * f;
                    let septum = 1.0 - smooth(0.00008, 0.00025, edge);
                    r += (236.0 - r) * septum * 0.6;
                    g += (214.0 - g) * septum * 0.6;
                    b += (170.0 - b) * septum * 0.6;
                    h = 0.4 + 0.025 * smooth(0.0, cell_fat * 0.4, edge);
                    rough = 0.5;
                    blood = 0.45;
                }
                FASCIA => (r, g, b, h, rough, blood) = (214.0, 204.0, 198.0, 0.46, 0.3, 0.7),
                DERMIS => (r, g, b, h, rough, blood) = (226.0 + grain * 12.0, 196.0 + grain * 10.0, 182.0 + grain * 8.0, 0.43, 0.55, 0.3),
                EPIDERMIS => (r, g, b, h, rough) = (150.0, 102.0, 82.0, 0.42, 0.6),
                CORTEX => {
                    let f = 0.9 + 0.1 * vn(x / 0.0003, y / 0.0012) + 0.04 * grain;
                    (r, g, b, h, rough, blood) = (232.0 * f, 220.0 * f, 194.0 * f, 0.64, 0.42, 0.35);
                }
                MARROW => {
                    let red = smooth(0.45, 0.6, broad * 0.6 + grain * 0.4);
                    (r, g, b, h, rough, blood) = (206.0 + (142.0 - 206.0) * red, 150.0 + (28.0 - 150.0) * red, 62.0 + (20.0 - 62.0) * red, 0.57, 0.35, 0.6);
                }
                _ => {
                    let hole = smooth(0.55, 0.7, vn(x / 0.0007 + seed, y / 0.0007));
                    (r, g, b, h, rough, blood) = (214.0 + (120.0 - 214.0) * hole, 182.0 + (26.0 - 182.0) * hole, 160.0 + (20.0 - 160.0) * hole, 0.6 - hole * 0.04, 0.4, 0.4);
                }
            }
            // Blood over it: in pools and smears that come and go with a broad noise, never quite the same twice.
            let lying = blood * smooth(wet, wet + 0.14, vn(x / 0.011 + seed * 0.3, y / 0.011) * 0.75 + broad * 0.25);
            if lying > 0.0 {
                let dark = 0.8 + 0.3 * grain;
                r += (80.0 * dark - r) * lying * 0.85;
                g += (28.0 - g) * lying * 0.85;
                b += (27.0 - b) * lying * 0.85;
                h += (0.49 - h) * lying * 0.6;
                rough += (0.1 - rough) * lying;
            }
            albedo[q] = [r, g, b];
            surface[q] = [255, (rough * 255.0).clamp(0.0, 255.0) as u8, 0, 255];
            field[q] = h;
        }
    }

    // Over the picture: what the outlines do not give.
    let mut cv = Canvas { px: &mut albedo };
    let bones: Vec<&(String, String, Vec<Pt>)> = solids.iter().filter(|s| s.0 == "bone" || s.0 == "skull").collect();
    // Between radius and ulna, tibia and fibula, the white interosseous membrane.
    for (one, two) in [("radius", "ulna"), ("tibia", "fibula")] {
        let (Some(a), Some(c)) = (bones.iter().find(|b| b.1.ends_with(one)), bones.iter().find(|b| b.1.ends_with(two))) else { continue };
        let mut best = (a.2[0], c.2[0], f32::MAX);
        for p in &a.2 {
            for q in &c.2 {
                let d = (p.0 - q.0).hypot(p.1 - q.1);
                if d < best.2 {
                    best = (*p, *q, d);
                }
            }
        }
        cv.line(px(best.0), px(best.1), m(0.0006).max(1.0), &mut |p| over(p, [224.0, 214.0, 206.0], 0.9));
    }
    // The neck's tubes: the windpipe held open by its cartilage, a dark hole; the gullet collapsed, pink.
    for (kind, _, l) in solids {
        if kind != "airway" && kind != "oesophagus" && kind != "cartilage" {
            continue;
        }
        let l = resample(l, 64);
        if kind == "cartilage" {
            cv.polygon(&to_px(&l), &mut |p, _, _| *p = [206.0, 212.0, 208.0]);
            continue;
        }
        let airway = kind == "airway";
        cv.polygon(&to_px(&l), &mut |p, _, _| *p = if airway { [222.0, 212.0, 204.0] } else { [170.0, 82.0, 74.0] });
        let lumen = inset(&l, &|_| if airway { 0.0022 } else { 0.0032 });
        if loop_area(lumen.iter().copied()).abs() > 1e-6 {
            cv.polygon(&to_px(&lumen), &mut |p, _, _| *p = if airway { [14.0, 3.0, 3.0] } else { [92.0, 20.0, 22.0] });
        }
    }
    // Toward the wrist and the ankle the muscles have become tendons: pearly cords in the flesh, glossy where cut. (The
    // anatomy has no tendons: they are placed in the muscle round the bones, as many as a wrist or ankle has.)
    let tendons = if hand { 11 } else if foot { 9 } else if lower { 3 } else { 0 };
    let mid = centroid(&skin);
    let (mut placed, mut tries) = (0, 0);
    while placed < tendons && tries < 400 {
        tries += 1;
        let p = skin[(rnd() * skin.len() as f32) as usize % skin.len()];
        let t = 0.45 + rnd() * 0.4;
        let at = px((mid.0 + (p.0 - mid.0) * t, mid.1 + (p.1 - mid.1) * t));
        let (cx, cy) = (at.0.floor() as usize, at.1.floor() as usize);
        if cx >= SIZE || cy >= SIZE || mask[cy * SIZE + cx] != MUSCLE {
            continue;
        }
        let rx = m(0.0012 + rnd() * 0.0016);
        let ry = rx * (0.5 + rnd() * 0.4);
        let turn = rnd() * std::f32::consts::PI;
        let centre = (cx as f32, cy as f32);
        cv.ellipse(centre, rx, ry, turn, &mut |p, _| *p = [226.0, 220.0, 208.0]);
        cv.ellipse((centre.0 - rx * 0.2, centre.1 - ry * 0.2), rx * 0.5, ry * 0.45, turn, &mut |p, _| over(p, [244.0, 240.0, 232.0], 0.7));
        Canvas { px: &mut surface }.ellipse(centre, rx, ry, turn, &mut |p, _| *p = [255, 60, 0, 255]);
        Canvas { px: &mut field }.ellipse(centre, ry, ry, 0.0, &mut |p, _| *p = 0.52);
        placed += 1;
    }
    // Vessels: an artery's thick pale wall holds it open round its small lumen, blood welling from it; a vein lies
    // collapsed and dark (the anatomy has the limbs' arteries; their veins run beside them); the cord shows its grey
    // butterfly in white, in its sheath.
    for (kind, name, vx, vy, vr) in vessels {
        let at = px((*vx, *vy));
        let r = m(*vr).max(2.0);
        if kind == "cord" {
            cv.ellipse(at, r * 1.4, r * 1.4, 0.0, &mut |p, _| *p = [212.0, 198.0, 182.0]);
            cv.ellipse(at, r, r, 0.0, &mut |p, _| *p = [236.0, 226.0, 206.0]);
            cv.ellipse((at.0 - r * 0.33, at.1), r * 0.26, r * 0.62, 0.35, &mut |p, _| *p = [172.0, 146.0, 140.0]);
            cv.ellipse((at.0 + r * 0.33, at.1), r * 0.26, r * 0.62, -0.35, &mut |p, _| *p = [172.0, 146.0, 140.0]);
            continue;
        }
        cv.ellipse(at, r * 5.0, r * 5.0, 0.0, &mut |p, d| over(p, [58.0, 2.0, 2.0], 0.8 * (1.0 - d)));
        if kind == "artery" {
            cv.ellipse(at, r * 1.05, r * 1.05, 0.0, &mut |p, _| *p = [230.0, 212.0, 200.0]);
            cv.ellipse(at, r * 0.5, r * 0.5, 0.0, &mut |p, _| *p = [40.0, 2.0, 2.0]);
            if !name.contains("carotid") && !name.contains("aorta") {
                cv.ellipse((at.0 + m(vr * 2.4), at.1), r * 1.15, r * 0.48, 0.4, &mut |p, _| *p = [60.0, 12.0, 26.0]);
            }
        } else {
            cv.ellipse(at, r * 1.3, r * 0.55, 0.6, &mut |p, _| *p = [60.0, 12.0, 26.0]);
        }
    }
    // Torn flesh: shreds of muscle pulled out of line, and dark clot between them.
    if torn {
        for _ in 0..120 {
            let p = skin[(rnd() * skin.len() as f32) as usize % skin.len()];
            let t = 0.25 + rnd() * 0.75;
            let at = px((mid.0 + (p.0 - mid.0) * t, mid.1 + (p.1 - mid.1) * t));
            let a = rnd() * std::f32::consts::TAU;
            let l = m(0.002 + rnd() * 0.008);
            let (colour, alpha) = if rnd() < 0.55 { ([140.0, 58.0, 54.0], 0.85) } else { ([34.0, 9.0, 9.0], 0.75) };
            let w = m(0.0007 + rnd() * 0.0016).max(1.0);
            cv.line(at, (at.0 + a.cos() * l, at.1 + a.sin() * l), w, &mut |p| over(p, colour, alpha));
        }
    }

    // The bend of the surface (a normal map) from its height: x along the picture, y up it (OpenGL's way, which Bevy
    // reads), as steep as the heights are in metres over the picture's own size.
    let at = |x: i32, y: i32| field[y.clamp(0, SIZE as i32 - 1) as usize * SIZE + x.clamp(0, SIZE as i32 - 1) as usize];
    let steep = 0.004 / metre;
    let mut bump = vec![[128u8, 128, 255, 255]; SIZE * SIZE];
    for y in 0..SIZE as i32 {
        for x in 0..SIZE as i32 {
            let dx = (at(x + 1, y) - at(x - 1, y)) * steep;
            let dy = -(at(x, y + 1) - at(x, y - 1)) * steep;
            let n = Vec3::new(-dx, -dy, 1.0).normalize();
            bump[(y as usize) * SIZE + x as usize] = [((n.x * 0.5 + 0.5) * 255.0) as u8, ((n.y * 0.5 + 0.5) * 255.0) as u8, ((n.z * 0.5 + 0.5) * 255.0) as u8, 255];
        }
    }
    Look { albedo, bump, surface, e, field, torn }
}

// The cut face's material: its picture, its relief, how rough each point is (green; blood lying on it is glossy), and a
// thin film of tissue fluid over all of it (a clear coat).
pub fn material(look: &Look, images: &mut Assets<Image>, materials: &mut Assets<StandardMaterial>) -> Handle<StandardMaterial> {
    let image = |data: Vec<u8>, format: TextureFormat| {
        Image::new(Extent3d { width: SIZE as u32, height: SIZE as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data, format, RenderAssetUsages::RENDER_WORLD)
    };
    // (The colours are sRGB numbers, as the TS's canvas.)
    let albedo: Vec<u8> = look.albedo.iter().flat_map(|c| [c[0].clamp(0.0, 255.0) as u8, c[1].clamp(0.0, 255.0) as u8, c[2].clamp(0.0, 255.0) as u8, 255]).collect();
    let mut normal = image(look.bump.concat(), TextureFormat::Rgba8Unorm);
    normal.sampler = bevy::image::ImageSampler::linear();
    materials.add(StandardMaterial {
        base_color_texture: Some(images.add(image(albedo, TextureFormat::Rgba8UnormSrgb))),
        normal_map_texture: Some(images.add(normal)),
        metallic_roughness_texture: Some(images.add(image(look.surface.concat(), TextureFormat::Rgba8Unorm))),
        metallic: 1.0,
        perceptual_roughness: 1.0,
        clearcoat: 0.5,
        clearcoat_perceptual_roughness: 0.15,
        ..default()
    })
}

// The cut face as a mesh: the skin's outline filled in rings toward the bone, raised or sunk by the painted heights, each
// bone standing proud of it as a short stub with its own end face; skinned wholly to bone `bone`. `facing` 1 for the
// stump (facing down the limb, along n), -1 for the piece. Rest space.
#[allow(clippy::too_many_arguments)]
pub fn cap(c: Vec3, n: Vec3, e1: Vec3, e2: Vec3, skin_loop: &[Pt], bones: &[Vec<Pt>], look: &Look, facing: f32, bone: usize, proud: f32, torn: bool) -> Mesh {
    let (mut pos, mut uv, mut index): (Vec<Vec3>, Vec<[f32; 2]>, Vec<u32>) = (Vec::new(), Vec::new(), Vec::new());
    let e = look.e;
    let mut put = |x: f32, y: f32, up: f32| {
        pos.push(c + e1 * x + e2 * y + n * (up * facing));
        uv.push([x / (2.0 * e) + 0.5, 0.5 - y / (2.0 * e)]);
        pos.len() as u32 - 1
    };
    // (Faces turned to face out of the stump, or out of the piece.)
    let mut tri = |a: u32, b: u32, d: u32| if facing > 0.0 { index.extend([a, b, d]) } else { index.extend([a, d, b]) };
    let skin = resample(skin_loop, 96);
    let all: Vec<Pt> = bones.iter().flatten().copied().collect();
    let middle = if all.is_empty() { centroid(&skin) } else { centroid(&all) };
    const RINGS: usize = 9;
    let mut rings: Vec<Vec<u32>> = Vec::new();
    for j in 0..=RINGS {
        let t = j as f32 / RINGS as f32;
        let mut ring = Vec::new();
        for p in &skin {
            let (x, y) = (middle.0 + (p.0 - middle.0) * t, middle.1 + (p.1 - middle.1) * t);
            // The skin's edge stays on the plane; inside it, the flesh's own height.
            ring.push(put(x, y, if j == RINGS { 0.0 } else { look.height(x, y) * ((1.0 - t) * 6.0).min(1.0) }));
            if j == 0 {
                break;
            }
        }
        rings.push(ring);
    }
    let count = skin.len();
    for i in 0..count {
        tri(rings[0][0], rings[1][i], rings[1][(i + 1) % count]);
    }
    for j in 1..RINGS {
        for i in 0..count {
            let (a, b, d, f) = (rings[j][i], rings[j][(i + 1) % count], rings[j + 1][i], rings[j + 1][(i + 1) % count]);
            tri(a, d, f);
            tri(a, f, b);
        }
    }
    // The bones: a wall from below the flesh's face up to where they end, and their end faces; a torn bone ends in points.
    for b in bones {
        if loop_area(b.iter().copied()).abs() < 1.2e-5 {
            continue;
        }
        let l = resample(b, 40);
        let mid = centroid(&l);
        let k = l.len();
        let tops: Vec<f32> = (0..k)
            .map(|i| proud * if torn { 0.6 + 0.8 * wobble(i as f32 / k as f32, mid.0 * 900.0).abs() + if i % 7 == 0 { 0.9 } else { 0.0 } } else { 0.9 + 0.2 * wobble(i as f32 / k as f32, 3.0).abs() })
            .collect();
        let low: Vec<u32> = l.iter().map(|p| put(p.0, p.1, -0.003)).collect();
        let high: Vec<u32> = l.iter().enumerate().map(|(i, p)| put(p.0 + (mid.0 - p.0) * 0.02, p.1 + (mid.1 - p.1) * 0.02, tops[i])).collect();
        for i in 0..k {
            let j = (i + 1) % k;
            tri(low[i], low[j], high[j]);
            tri(low[i], high[j], high[i]);
        }
        let centre = put(mid.0, mid.1, tops.iter().fold(f32::MAX, |a, &b| a.min(b)) * 0.9);
        for i in 0..k {
            tri(centre, high[i], high[(i + 1) % k]);
        }
    }
    let v = pos.len();
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(vec![[bone as u16, 0, 0, 0]; v]))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; v])
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh.generate_tangents().ok();
    mesh.generate_skinned_mesh_bounds().ok();
    mesh
}

#[cfg(test)]
mod tests {
    use super::*;

    // A round limb 4 cm across with a bone in the middle: the mask has skin at its edge, muscle in the middle, bone
    // inside; the face stands out of the plane only inside the skin.
    #[test]
    fn a_round_limb() {
        let circle = |r: f32, n: usize| (0..n).map(|i| { let a = i as f32 / n as f32 * std::f32::consts::TAU; (r * a.cos(), r * a.sin()) }).collect::<Vec<_>>();
        let look = paint(&circle(0.04, 64), &[("bone".into(), "left femur".into(), circle(0.012, 32))], &[], 0.006, false, false, false, false, 3.0);
        assert!(look.e > 0.04 && look.e < 0.045);
        let at = |x: f32, y: f32| look.albedo[((0.5 - y / (2.0 * look.e)) * SIZE as f32) as usize * SIZE + ((x / (2.0 * look.e) + 0.5) * SIZE as f32) as usize];
        // Bone (cortex) is pale, the muscle between it and the skin red.
        let bone = at(0.011, 0.0);
        let muscle = at(0.025, 0.0);
        assert!(bone[1] > 120.0 && muscle[0] > muscle[1] * 1.5, "{bone:?} {muscle:?}");
        assert!(look.height(0.0, 0.0) != look.height(0.044, 0.044));
        // The stump's end faces down the limb (+n), its tangents whole.
        let (c, n) = (Vec3::new(0.1, 1.0, 0.0), Vec3::new(0.0, -1.0, 0.0));
        let e1 = n.cross(Vec3::X).normalize();
        let e2 = n.cross(e1);
        let mesh = cap(c, n, e1, e2, &circle(0.04, 64), &[circle(0.012, 32)], &look, 1.0, 3, 0.005, false);
        let Some(VertexAttributeValues::Float32x3(nor)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL) else { panic!() };
        let facing = nor.iter().map(|v| Vec3::from(*v).dot(n)).sum::<f32>() / nor.len() as f32;
        assert!(facing > 0.5, "{facing}");
        let Some(VertexAttributeValues::Float32x4(tan)) = mesh.attribute(Mesh::ATTRIBUTE_TANGENT) else { panic!("no tangents") };
        assert!(tan.iter().all(|t| t.iter().all(|x| x.is_finite()) && Vec3::new(t[0], t[1], t[2]).length() > 0.5), "{:?}", tan.iter().find(|t| !t[0].is_finite()));
        // (With CUT_FACE_DUMP set to a directory, the pictures written there to be looked at.)
        if let Ok(dir) = std::env::var("CUT_FACE_DUMP") {
            let png = |data: Vec<u8>, name: &str| {
                let i = Image::new(Extent3d { width: SIZE as u32, height: SIZE as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data, TextureFormat::Rgba8UnormSrgb,
                                   RenderAssetUsages::all());
                i.try_into_dynamic().unwrap().to_rgba8().save(format!("{dir}/{name}.png")).unwrap();
            };
            png(look.albedo.iter().flat_map(|c| [c[0] as u8, c[1] as u8, c[2] as u8, 255]).collect(), "albedo");
            png(look.bump.concat(), "bump");
            png(look.surface.concat(), "surface");
        }
    }
}
