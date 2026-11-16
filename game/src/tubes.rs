// The outside of what can come out of an opened belly, painted round and along it (viscera.ts `_tubeLook`): u along it,
// v round it, v = 0 and 1 the side its mesentery holds, which viscera.rs turns toward where it is held; and how high each
// place of it stands (a normal map). What they look like (Moore, Dalley & Agur, Clinically Oriented Anatomy, 7th ed.,
// ch. 2, the small and large intestine compared; Gray's Anatomy, 41st ed., chs. 65 and 66):
// - small bowel: pinkish grey to tan, its serosa thin and glistening; straight vessels (vasa recta) from the arcades in
//   its mesentery run round it every few millimetres; the mesentery meets it along one side as yellow fat with the
//   arcades in it.
// - colon: greyer tan, gathered into sacculations (haustra) by three flat bands of muscle about a centimetre wide
//   (taeniae coli), small tags of fat (omental appendices) hanging from them.
// - stomach: pinkish tan, the gastroepiploic arcade in the omentum's fat along its curvature, its branches running across
//   the wall.
// The TS drew these on a canvas; here every shape is filled by hand, wrapping round the picture's edges so it tiles.

use crate::rng::Rng;

pub const W: usize = 512;
pub const H: usize = 256;

struct Sheet {
    c: Vec<[f32; 3]>,
    h: Vec<f32>,
}

impl Sheet {
    fn at(x: i32, y: i32) -> usize {
        (y.rem_euclid(H as i32) as usize) * W + x.rem_euclid(W as i32) as usize
    }

    // An ellipse at (x, y), radii rx, ry, turned: `colour` laid over with `alpha`, and the height raised (or lowered)
    // by `lift`.
    fn blob(&mut self, x: f32, y: f32, rx: f32, ry: f32, turn: f32, colour: [f32; 3], alpha: f32, lift: f32) {
        let r = rx.max(ry).ceil() as i32 + 1;
        let (c, s) = (turn.cos(), turn.sin());
        for dy in -r..=r {
            for dx in -r..=r {
                let (px, py) = (x.floor() as i32 + dx, y.floor() as i32 + dy);
                let (ox, oy) = (px as f32 + 0.5 - x, py as f32 + 0.5 - y);
                let (u, v) = ((ox * c + oy * s) / rx, (-ox * s + oy * c) / ry);
                // (A soft half-pixel edge, as the canvas's antialiasing gave.)
                let d = (u * u + v * v).sqrt();
                let edge = ((1.0 - d) * rx.min(ry) + 0.5).clamp(0.0, 1.0);
                if edge <= 0.0 {
                    continue;
                }
                let i = Self::at(px, py);
                let a = alpha * edge;
                for k in 0..3 {
                    self.c[i][k] += (colour[k] - self.c[i][k]) * a;
                }
                if lift != 0.0 {
                    let to = if lift > 0.0 { 1.0 } else { 0.0 };
                    self.h[i] += (to - self.h[i]) * lift.abs() * edge;
                }
            }
        }
    }

    // A soft line from a to b, `width` pixels, blurred a little (the vessel seen through the serosa).
    fn line(&mut self, a: (f32, f32), b: (f32, f32), width: f32, colour: [f32; 3], alpha: f32, lift: f32) {
        let r = width / 2.0 + 1.5;
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let l2 = (dx * dx + dy * dy).max(1e-6);
        let (x0, x1) = ((a.0.min(b.0) - r).floor() as i32, (a.0.max(b.0) + r).ceil() as i32);
        let (y0, y1) = ((a.1.min(b.1) - r).floor() as i32, (a.1.max(b.1) + r).ceil() as i32);
        for py in y0..=y1 {
            for px in x0..=x1 {
                let (fx, fy) = (px as f32 + 0.5, py as f32 + 0.5);
                let t = (((fx - a.0) * dx + (fy - a.1) * dy) / l2).clamp(0.0, 1.0);
                let d = (fx - a.0 - dx * t).hypot(fy - a.1 - dy * t);
                let cover = (1.0 - (d - width / 2.0) / 1.2).clamp(0.0, 1.0) * if d > width / 2.0 { 0.6 } else { 1.0 };
                if cover <= 0.0 {
                    continue;
                }
                let i = Self::at(px, py);
                let al = alpha * cover;
                for k in 0..3 {
                    self.c[i][k] += (colour[k] - self.c[i][k]) * al;
                }
                self.h[i] += (1.0 - self.h[i]) * lift * (cover.min(1.0) * if d <= width / 2.0 { 1.0 } else { 0.0 });
            }
        }
    }
}

// A vessel: a wavering line from (x, y), `dir` down (1) or up (-1) the picture (or `across` it), tapering, a branch now
// and then.
#[allow(clippy::too_many_arguments)]
fn vessel(s: &mut Sheet, rnd: &mut Rng, x: f32, y: f32, dir: f32, len: f32, width: f32, colour: ([f32; 3], f32), lift: f32, across: bool) {
    let (mut px, mut py) = (x, y);
    let mut bend = (rnd.next() - 0.5) * 0.5;
    let mut step = 0.0;
    while step < len {
        let (nx, ny) = if across {
            (px + 3.0 * dir, py + bend.sin() * 3.0 + (rnd.next() - 0.5) * 1.2)
        } else {
            (px + bend.sin() * 3.0 * dir + (rnd.next() - 0.5) * 1.2, py + bend.cos() * 3.0 * dir)
        };
        let w = (width * (1.0 - (step / len) * 0.7)).max(0.5);
        s.line((px, py), (nx, ny), w, colour.0, colour.1, lift);
        px = nx;
        py = ny;
        bend += (rnd.next() - 0.5) * 0.3;
        if rnd.next() < 0.05 && width > 0.9 {
            vessel(s, rnd, px, py, dir, (len - step) * 0.5, width * 0.6, colour, lift, across);
        }
        step += 3.0;
    }
}

// The picture (sRGB, four bytes a pixel) and its relief (a normal map, OpenGL's way) of `kind`.
pub fn paint(kind: &str, rng: &mut Rng) -> (Vec<u8>, Vec<u8>) {
    let base = match kind {
        "bowel" => [192.0, 154.0, 142.0],
        "colon" => [176.0, 160.0, 140.0],
        _ => [196.0, 152.0, 138.0],
    };
    let mut s = Sheet { c: vec![base; W * H], h: vec![0.5; W * H] };
    let (wf, hf) = (W as f32, H as f32);
    let mut r = || rng.next();
    // Mottled: greyer, pinker and tanner patches.
    for _ in 0..1800 {
        let k = r();
        let c = if k < 0.4 { [170.0, 152.0, 146.0] } else if k < 0.75 { [206.0, 150.0, 140.0] } else { [200.0, 172.0, 134.0] };
        let (x, y, rx, ry, a, lift, turn) = (r() * wf, r() * hf, 3.0 + r() * 12.0, 2.0 + r() * 7.0, 0.1 + r() * 0.12, (r() - 0.5) * 0.08, r() * 3.0);
        s.blob(x, y, rx, ry, turn, c, a, lift);
    }
    // The serosa is not smooth: fine lumps, a millimetre or two, that break the light into small highlights.
    for _ in 0..3000 {
        let (x, y, rr, lift) = (r() * wf, r() * hf, 1.5 + r() * 3.0, (r() - 0.4) * 0.35);
        s.blob(x, y, rr, rr, 0.0, [0.0; 3], 0.0, lift);
    }
    drop(r);
    // Arteries a dull red, veins beside them blue-purple, both faint through the serosa.
    let red = |rng: &mut Rng| ([128.0 + rng.next() * 25.0, 46.0 + rng.next() * 14.0, 58.0 + rng.next() * 14.0], 0.1 + rng.next() * 0.1);
    let vein = |rng: &mut Rng| ([92.0 + rng.next() * 16.0, 70.0 + rng.next() * 14.0, 112.0 + rng.next() * 18.0], 0.12 + rng.next() * 0.1);
    let pick = |rng: &mut Rng| if rng.next() < 0.6 { red(rng) } else { vein(rng) };
    // Where the mesentery (the omentum, the mesocolon) holds it: yellow lobulated fat, the arcade running along it.
    let held = |s: &mut Sheet, rng: &mut Rng, fat: f32, lobules: usize| {
        for _ in 0..lobules {
            let y = if rng.next() < 0.5 { rng.next() } else { -rng.next() } * fat * hf;
            let c = [222.0 + rng.next() * 16.0, 186.0 + rng.next() * 20.0, 96.0 + rng.next() * 30.0];
            let (x, rx, ry, a, turn) = (rng.next() * wf, 4.0 + rng.next() * 8.0, 3.0 + rng.next() * 6.0, 0.55 + rng.next() * 0.35, rng.next() * 3.0);
            s.blob(x, if y < 0.0 { hf + y } else { y }, rx, ry, turn, c, a, 0.35);
        }
        for y0 in [fat * hf * 0.45, hf - fat * hf * 0.45] {
            vessel(s, rng, 0.0, y0, 1.0, wf + 20.0, 2.0, ([116.0, 44.0, 58.0], 0.32), 0.25, true);
        }
    };
    match kind {
        "bowel" => {
            held(&mut s, rng, 0.07, 420);
            let mut x = 0.0;
            while x < wf {
                let c = pick(rng);
                let (l, w) = (hf * (0.15 + rng.next() * 0.25), 0.7 + rng.next() * 0.6);
                vessel(&mut s, rng, x, hf * 0.05, 1.0, l, w, c, 0.15, false);
                let c = pick(rng);
                let (ox, l, w) = (rng.next() * 5.0, hf * (0.15 + rng.next() * 0.25), 0.7 + rng.next() * 0.6);
                vessel(&mut s, rng, x + ox, hf * 0.95, -1.0, l, w, c, 0.15, false);
                x += 9.0 + rng.next() * 12.0;
            }
        }
        "colon" => {
            // Haustra: six to a picture's length, a crease between each and the next, bulging between.
            let n = 6;
            for k in 0..n {
                let x = (k as f32 / n as f32) * wf + (rng.next() - 0.5) * 8.0;
                let mut y = 0.0;
                while y < hf {
                    let rx = 3.0 + rng.next() * 2.0;
                    s.blob(x + (y * 0.05 + k as f32).sin() * 4.0, y, rx, 4.0, 0.0, [120.0, 98.0, 88.0], 0.3, -0.45);
                    y += 4.0;
                }
                let mut y = 0.0;
                while y < hf {
                    s.blob(x + wf / n as f32 / 2.0, y, wf / n as f32 / 3.0, 5.0, 0.0, [190.0, 170.0, 150.0], 0.05, 0.12);
                    y += 6.0;
                }
            }
            held(&mut s, rng, 0.06, 160);
            // The taeniae: flat bands, paler, their fibres running along, at a third of the way round from each other.
            for yc in [hf / 3.0, 2.0 * hf / 3.0] {
                let mut x = 0.0;
                while x < wf {
                    let c = [200.0 + rng.next() * 16.0, 186.0 + rng.next() * 14.0, 160.0 + rng.next() * 14.0];
                    let (y, rx) = (yc + (rng.next() - 0.5) * 10.0, 3.0 + rng.next() * 4.0);
                    s.blob(x, y, rx, 1.5, 0.0, c, 0.5, 0.05);
                    x += 2.0;
                }
                // Omental appendices: little tags of yellow fat along them.
                let mut x = rng.next() * 40.0;
                while x < wf {
                    let c = [226.0 + rng.next() * 14.0, 192.0 + rng.next() * 16.0, 98.0 + rng.next() * 24.0];
                    let (y, rx, ry) = (yc + (rng.next() - 0.5) * 24.0, 6.0 + rng.next() * 6.0, 4.0 + rng.next() * 5.0);
                    s.blob(x, y, rx, ry, rng.next() * 3.0, c, 0.85, 0.6);
                    x += 35.0 + rng.next() * 40.0;
                }
            }
            let mut x = 0.0;
            while x < wf {
                let c = pick(rng);
                let (l, w) = (hf * (0.1 + rng.next() * 0.2), 0.7 + rng.next() * 0.5);
                vessel(&mut s, rng, x, hf * 0.04, 1.0, l, w, c, 0.15, false);
                let c = pick(rng);
                let (l, w) = (hf * (0.1 + rng.next() * 0.2), 0.7 + rng.next() * 0.5);
                vessel(&mut s, rng, x, hf * 0.96, -1.0, l, w, c, 0.15, false);
                x += 9.0 + rng.next() * 10.0;
            }
        }
        _ => {
            held(&mut s, rng, 0.12, 600);
            let mut x = 0.0;
            while x < wf {
                let c = pick(rng);
                let (l, w) = (hf * (0.2 + rng.next() * 0.25), 1.0 + rng.next() * 0.6);
                vessel(&mut s, rng, x, hf * 0.08, 1.0, l, w, c, 0.15, false);
                let c = pick(rng);
                let (l, w) = (hf * (0.2 + rng.next() * 0.25), 1.0 + rng.next() * 0.6);
                vessel(&mut s, rng, x, hf * 0.92, -1.0, l, w, c, 0.15, false);
                x += 12.0 + rng.next() * 16.0;
            }
        }
    }
    // The relief: from the height, blurred a pixel, which way each place faces (a tangent-space normal map: x along the
    // picture, y up it, as Bevy reads one).
    let mut blur = vec![0.0f32; W * H];
    for y in 0..H as i32 {
        for x in 0..W as i32 {
            let mut sum = 0.0;
            for (dx, dy) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)] {
                sum += s.h[Sheet::at(x + dx, y + dy)];
            }
            blur[Sheet::at(x, y)] = sum / 5.0;
        }
    }
    let mut relief = Vec::with_capacity(W * H * 4);
    for y in 0..H as i32 {
        for x in 0..W as i32 {
            let dx = (blur[Sheet::at(x + 1, y)] - blur[Sheet::at(x - 1, y)]) * 2.5;
            let dy = -(blur[Sheet::at(x, y + 1)] - blur[Sheet::at(x, y - 1)]) * 2.5;
            let l = (dx * dx + dy * dy + 1.0).sqrt();
            relief.extend([((0.5 - dx / l / 2.0) * 255.0) as u8, ((0.5 - dy / l / 2.0) * 255.0) as u8, ((0.5 + 0.5 / l) * 255.0) as u8, 255]);
        }
    }
    let albedo = s.c.iter().flat_map(|c| [c[0].clamp(0.0, 255.0) as u8, c[1].clamp(0.0, 255.0) as u8, c[2].clamp(0.0, 255.0) as u8, 255]).collect();
    (albedo, relief)
}

#[test]
fn tubes_tile() {
    let mut rng = Rng::new(7);
    let (a, r) = paint("colon", &mut rng);
    assert_eq!(a.len(), W * H * 4);
    assert_eq!(r.len(), W * H * 4);
    // Not one flat colour, and its relief not flat either.
    assert!(a.chunks(4).any(|p| p[0] != a[0]) && r.chunks(4).any(|p| p[0] != 128 && p[0] != 127));
}
