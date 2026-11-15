// What a wound looks like from outside (src/sandbox/marks.ts): painted into sheets laid over the person's skin in its
// texture space, so it moves with every bend of the body and costs nothing to draw. Sizes are real: each mark is painted
// at the size of the thing that made it, using how many texture units a metre of skin takes up where it landed (a
// crossing's `scale`).
//
// The wound sheet (skin.rs) holds how deep the flesh is open at each place (red, to 4 cm) and how much blood lies in it
// (green), which skin.wesl draws as the wound (the TS's Gore), and the ring a slow bullet scraped (blue, the TS's skin
// sheet). Here each mark is turned into stamps (paint.wesl) in the shapes the TS drew on its canvas, with its colours as
// those numbers and its blur as a feather a pixel wide.

use bevy::prelude::*;

use crate::npc::{Crossing, Happened, Kind, Npc};
use crate::rng::Rng;
use crate::skin::{Skin, Stamp, CAPSULE, ENTRY, LENS, RADIAL, SIZE, SOFT};

const PX: f32 = 1.0 / SIZE as f32;
// How far round a mark its blur reaches (the canvas's blur(1px)).
const FEATHER: f32 = PX;

// So many metres on the skin at `hit`, in the sheet's units: never less than a pixel.
fn px(m: f32, scale: f32) -> f32 {
    (m * scale).max(PX)
}

impl Skin {
    fn capsule(&mut self, a: Vec2, b: Vec2, half: f32, v: Vec4) {
        self.marks.push(Stamp::new(CAPSULE, a, b, half, FEATHER, half + 2.0 * FEATHER, v, Vec4::ZERO));
    }

    // A bullet's way into skin: a round hole as wide as the skin let it be (a little under the bullet), its walls steep,
    // its track going down out of sight and filling with blood. Skin is elastic: a 9 mm bullet leaves a hole of 3 to 6
    // mm (dev/research/wounds.md).
    pub fn entry(&mut self, hit: &Crossing, size: f32) {
        let r = px((size * 0.26).max(0.0017), hit.scale) * 1.15;
        self.marks.push(Stamp::new(ENTRY, hit.uv, hit.uv, r, FEATHER, r + FEATHER, Vec4::ZERO, Vec4::ZERO));
    }

    // A bullet's way out: torn, not punched, ragged and wider: a slit, a star of three or four splits, or a crescent, the
    // splits tapering to nothing at their ends (dev/research/wounds.md), with a ragged opening where they meet.
    pub fn exit(&mut self, hit: &Crossing, size: f32, rng: &mut Rng) {
        let r = px(size * 0.5, hit.scale);
        let arms = 2 + (rng.next() * 3.0).floor() as usize;
        let turn = rng.next() * std::f32::consts::PI;
        for k in 0..arms {
            let a = turn + (k as f32 / arms as f32) * std::f32::consts::TAU + (rng.next() - 0.5) * 0.7;
            let reach = r * (0.8 + rng.next() * 0.7);
            let bend = (rng.next() - 0.5) * 0.6;
            // Each split drawn as strokes narrowing from the middle out, deepest along its line.
            let p = |t: f32| hit.uv + Vec2::new((a + bend * t).cos(), (a + bend * t).sin()) * reach * t;
            for s in 0..6 {
                let (t0, t1) = (s as f32 / 6.0, (s + 1) as f32 / 6.0);
                let w = (r * 0.32 * (1.0 - t0)).max(PX);
                self.capsule(p(t0), p(t1), w / 2.0, Vec4::new(200.0 * (1.0 - t0 * 0.6) / 255.0, 230.0 / 255.0, 0.0, 0.0));
            }
        }
        let c = r * 0.45;
        self.marks.push(Stamp::new(RADIAL, hit.uv, hit.uv, c, FEATHER, c + FEATHER, Vec4::new(230.0 / 255.0, 240.0 / 255.0, 0.0, 0.0), Vec4::ZERO));
    }

    // Round a bullet's way into skin, a ring about a millimetre wide that it scraped going in: red-brown, drying darker.
    // A way out has none, and nor, often, has a rifle's way in (dev/research/wounds.md).
    pub fn ring(&mut self, hit: &Crossing, size: f32) {
        let hole = px((size * 0.25).max(0.0018), hit.scale);
        let band = px(0.0011, hit.scale);
        for (r, v) in [(hole + band * 1.6, 0.6), (hole + band * 0.6, 1.0)] {
            self.marks.push(Stamp::new(SOFT, hit.uv, hit.uv, r, FEATHER, r + FEATHER, Vec4::new(0.0, 0.0, v, 0.0), Vec4::ZERO));
        }
    }

    // A blade's way in (dev/research/stab-wounds.md sec. 3): a slit from skin crossing `back` to `edge` (where the blade's
    // back and edge went in), opened `gape` metres either side at its middle. Clean-edged, no scraped ring. The edge's
    // end is sharp; the back's squared off, as wide as the blade's back is thick (about 3 mm), unless the blade is sharp
    // both sides (`double`). Deepest along its middle; its cut lips shallow, so the skin's edge shows round it.
    pub fn stab(&mut self, back: &Crossing, edge: &Crossing, gape: f32, double: bool) {
        if back.uv.distance(edge.uv) > 0.04 {
            return;
        }
        let open = px(gape, back.scale);
        let end = px(0.0015, back.scale);
        let grow = [px(0.0012, back.scale), px(0.0005, back.scale)];
        let reach = open.max(end) + grow[0] + 2.0 * PX;
        self.marks.push(Stamp::new(
            LENS,
            back.uv,
            edge.uv,
            0.0,
            PX * 0.5,
            reach,
            Vec4::new(grow[0], grow[1], 0.0, 0.0),
            Vec4::new(open, end, PX * 0.5, if double { 1.0 } else { 0.0 }),
        ));
    }

    // A blade drawn through the skin from `a` to `b`, `deep` metres into the flesh: a slot that gapes as the skin either
    // side pulls back, shallow at its lips and deepest along its middle, so the fat shows down its sides. `gapes` is how
    // much of its full gape this stretch opens (a cut gapes most in its middle).
    pub fn cut(&mut self, a: &Crossing, b: &Crossing, deep: f32, gapes: f32) {
        if a.uv.distance(b.uv) > 0.04 {
            return;
        }
        let most = (deep / 0.04).min(1.0);
        let gape = (0.0012 + deep * 0.12 * gapes).min(0.009);
        for (w, share) in [(1.0, 0.25), (0.6, 0.6), (0.25, 1.0)] {
            self.capsule(a.uv, b.uv, px(gape * w, a.scale) / 2.0, Vec4::new(most * share, 0.92 * (share * 1.6f32).min(1.0), 0.0, 0.0));
        }
    }

    // The lip of skin cut right through along a loop (`uv` points), `scale` texture units to a metre there: the layers it
    // was cut through show along it for `wide` metres in from the edge, `deep` (0 to 1 of the sheet's 4 cm) at the edge
    // itself, and blood lies in them. A torn edge (`ragged`) wanders in and out. (dismember.rs's, port/cut.)
    pub fn rim(&mut self, uv: &[Vec2], scale: f32, wide: f32, deep: f32, ragged: bool, rng: &mut Rng) {
        for k in 0..uv.len() {
            let (a, b) = (uv[k], uv[(k + 1) % uv.len()]);
            if a.distance(b) > 0.03 {
                continue;
            }
            let w = wide * if ragged { 0.5 + rng.next() } else { 1.0 };
            for (width, share) in [(1.0, 0.15), (0.55, 0.5), (0.2, 1.0)] {
                self.capsule(a, b, px(w * width * 2.0, scale) / 2.0, Vec4::new(deep * share, 200.0 / 255.0 * (share * 1.5f32).min(1.0), 0.0, 0.0));
            }
        }
    }

    // The lips of an opening right through the body's wall or torn open by a bullet's way out: its edge through skin
    // crossings `edge` (in order, all round it), and out from it, in a band about `lip` metres wide, the layers as its
    // torn face shows them: the skin's cut edge, the fat under it, the white sheath, then the muscle, deeper the nearer
    // the hole. A torn wall draws back unevenly, so the band is wider here and narrower there. Each layer takes the share
    // of the band its thickness is of the face seen: skin about 2 mm, the fat `fat` metres where it is (Derraik 2014: 18
    // mm on a man's belly; a few on a forearm), and some 20 mm of torn muscle in view (an estimate). Blood lies over all
    // of it, most in the muscle and the hole, so the fat shows as glimpses through it (dev/research/stab-wounds.md,
    // gunshot-blood.md).
    pub fn lip(&mut self, edge: &[Crossing], lip: f32, fat: f32, rng: &mut Rng) {
        let n = edge.len();
        let scale = edge[0].scale;
        let phase = rng.next() * 6.0;
        let wide: Vec<f32> = (0..n)
            .map(|k| {
                let k = k as f32;
                lip * (0.55 + 0.5 * (0.5 + 0.5 * (k * 0.6 + phase).sin() * (k * 0.21 + phase * 1.7).sin()) + 0.2 * rng.next())
            })
            .collect();
        // Where across the band (0 its outer edge, 1 the hole) each layer ends, and the depth in millimetres the wound is
        // drawn at there: the skin's edge to 1.6, the fat to 9.5, the sheath to 12, the muscle on to 16 (skin.wesl).
        let total = 0.002 + fat + 0.02;
        let skin_end = 0.002 / total;
        let fat_end = skin_end + fat / total;
        let depth_at = |u: f32| {
            if u < skin_end {
                0.8 + 0.8 * (u / skin_end)
            } else if u < fat_end {
                1.6 + 7.9 * ((u - skin_end) / (fat_end - skin_end))
            } else if u < fat_end + 0.04 {
                9.5 + 2.5 * ((u - fat_end) / 0.04)
            } else {
                12.0 + 4.0 * ((u - fat_end - 0.04) / (1.0 - fat_end - 0.04)).min(1.0)
            }
        };
        const STEPS: usize = 20;
        for s in 0..STEPS {
            let u = s as f32 / STEPS as f32;
            let out = 1.0 - u;
            let v = Vec4::new(depth_at(u) / 40.0, 0.45 + 0.45 * u, 0.0, 0.0);
            for k in 0..n {
                let (a, b) = (edge[k].uv, edge[(k + 1) % n].uv);
                if a.distance(b) > 0.04 {
                    continue;
                }
                self.capsule(a, b, px(out * (wide[k] + wide[(k + 1) % n]), scale) / 2.0, v);
            }
        }
    }
}

impl Npc<'_> {
    // A blade drawn across the skin through `hits` (in order, from npc.surface), `deep` metres into it (npc.ts slash, for
    // weapons.rs). The cut follows the skin from one place it crossed to the next, through places laid back on the skin
    // in between, so it runs round a face and does not cut across it. Each stretch of it is a `Happened::Slit` for
    // marks.rs to draw.
    // port: phase 3 dismember and viscera (npc.ts's swung and slashed come first: port/cut's to call here).
    pub fn slash(&mut self, hits: &[Crossing], deep: f32, sweep: Option<Vec3>) {
        let skin: Vec<Crossing> = hits.iter().filter(|h| h.kind == Kind::Skin).cloned().collect();
        if skin.is_empty() {
            return;
        }
        // A blade that crossed the skin only once still opened it for a few centimetres, along the way it was going.
        if skin.len() == 1
            && let Some(sweep) = sweep
        {
            let along = self.rest_to_world(skin[0].owner).inverse().transform_vector3(sweep).normalize();
            let n = skin[0].rest_normal;
            let flat = (along - n * along.dot(n)).normalize();
            let at = |k: f32| self.nearest_rest(skin[0].rest + flat * k, 0.03);
            let ends: Vec<Crossing> = [at(-0.018), Some(skin[0].clone()), at(0.018)].into_iter().flatten().filter(|h| h.kind == Kind::Skin).collect();
            if ends.len() > 1 {
                return self.slash(&ends, deep, None);
            }
        }
        // An incised wound is deepest where the blade went in and tails off to a scratch where it came out, and gapes into
        // an ellipse, widest in its middle (dev/research/wounds.md).
        let mut path: Vec<Option<Crossing>> = vec![Some(skin[0].clone())];
        for k in 0..skin.len().saturating_sub(1) {
            let (a, b) = (&skin[k], &skin[k + 1]);
            let gap = a.rest.distance(b.rest);
            if gap > 0.15 {
                path.push(None);
                path.push(Some(b.clone()));
                continue;
            }
            let steps = (gap / 0.012).floor() as usize;
            for j in 1..=steps {
                if let Some(on) = self.nearest_rest(a.rest.lerp(b.rest, j as f32 / (steps + 1) as f32), 0.04).filter(|c| c.kind == Kind::Skin) {
                    path.push(Some(on));
                }
            }
            path.push(Some(b.clone()));
        }
        let last = (path.len() - 1).max(1) as f32;
        for k in 0..path.len() - 1 {
            let (Some(a), Some(b)) = (&path[k], &path[k + 1]) else { continue };
            let t = (k as f32 + 0.5) / last;
            let gapes = 0.35 + 0.65 * (std::f32::consts::PI * (t * 1.15).min(1.0)).sin();
            self.hurt.happened.push(Happened::Slit { a: a.clone(), b: b.clone(), deep: deep * (1.0 - 0.85 * t), gapes });
        }
    }
}
