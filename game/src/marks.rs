// What a wound looks like from outside (src/sandbox/marks.ts): painted into sheets laid over the person's skin in its
// texture space, so it moves with every bend of the body and costs nothing to draw. Sizes are real: each mark is painted
// at the size of the thing that made it, using how many texture units a metre of skin takes up where it landed (a
// crossing's `scale`).
//
// The wound sheet (skin.rs) holds how deep the flesh is open at each place (red, to 4 cm) and how much blood lies in it
// (green), which skin.wesl draws as the wound (the TS's Gore), and the ring a slow bullet scraped (blue, the TS's skin
// sheet). Here each mark is turned into stamps (paint.wesl) in the shapes the TS drew on its canvas, with its colours as
// those numbers and its blur as a feather a pixel wide.
//
// Bullets' ways in and out are not painted: at two texels to a millimetre of skin (one on a thigh) a 5 mm hole and its 1
// mm scraped ring would be a smudge, and a picture of one is flat. Each is a record in the table (`SHOTS`): where it is,
// its shape and size, which way the bullet came and from how close, when; skin.wesl draws it from that, at any distance,
// as the hole it is, looking into it (dev/research/wounds.md sec. 4-5). The sheet only says which record is where: its
// alpha holds the newest record's number over the patch of skin it reaches.

use bevy::prelude::*;

use crate::npc::{Crossing, Happened, Kind, Npc};
use crate::rng::Rng;
use crate::hider::tangent;
use crate::skin::{Skin, Stamp, CAPSULE, LENS, SIZE, WIDE};

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

    // The lips of an opening right through the body's wall (viscera.rs, port/cut): its edge through skin
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
    // npc.slash from where a blade went into the skin (world points, as weapons.rs keeps them): each laid back on the
    // skin at rest, on the bone of the segment it is in, and the cut drawn through them.
    pub fn slash_through(&mut self, points: &[Vec3], deep: f32, sweep: Vec3) {
        let worlds = self.bone_worlds();
        let hits: Vec<Crossing> = points
            .iter()
            .filter_map(|&p| {
                let bone = self.person.segments[self.nearest(p).0?].bone;
                self.nearest_rest(worlds[bone].inverse().transform_point3(p), 0.02)
            })
            .collect();
        self.slash(&hits, deep, Some(sweep));
    }

    // A blade drawn across the skin through `hits` (in order, from npc.surface), `deep` metres into it (npc.ts slash, for
    // weapons.rs). The cut follows the skin from one place it crossed to the next, through places laid back on the skin
    // in between, so it runs round a face and does not cut across it. Each stretch of it is a `Happened::Slit` for
    // marks.rs to draw.
    // (npc.ts's swung and slashed came first: weapons.rs calls dismember::swung and viscera::slashed before this.)
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

// The table's row of gunshot wounds: its first texel the clock (and how many), then six texels a wound. 170 of them a
// person, as the sheet's alpha numbers them in eight bits.
pub const SHOTS: usize = 5;
const PER_SHOT: usize = 6;
pub const MOST_SHOTS: usize = (WIDE - 1) / PER_SHOT;
// What kind of wound a record is (skin.wesl): a bullet's way in, its way out, a way in again after a way out (out of an
// arm and into the chest beside it), a shotgun's charge still in one mass.
const ENTRY: f32 = 0.0;
const EXIT: f32 = 1.0;
const AGAIN: f32 = 2.0;
const CHARGE: f32 = 3.0;

impl Skin {
    // Record `k` (from 1; None: a new one) at `hit`: its first axis along `ex`, reaching `reach` metres from its middle,
    // what its kind needs in `p` (the fifth texel's last number is the clock it was made at). Its number painted over the
    // patch it reaches.
    fn shot(&mut self, k: Option<usize>, hit: &Crossing, ex: Vec3, kind: f32, reach: f32, p: [[f32; 4]; 3], rng: &mut Rng) {
        let k = match k {
            Some(k) => k,
            None if self.shots.len() < MOST_SHOTS => {
                self.shots.push((hit.rest, reach));
                self.shots.len()
            }
            // shortcut: past 170 wounds on one person a bullet's hole is not drawn; a table row of their own if it matters.
            None => return,
        };
        let n = hit.rest_normal;
        let ex = (ex - n * ex.dot(n)).normalize_or(tangent(n));
        // The newest record this one's patch overlaps: skin.wesl goes on from this one to it, and on from that.
        let prev = self.shots[..k - 1].iter().rposition(|&(at, r)| at.distance(hit.rest) < r + reach).map_or(0, |i| i + 1);
        self.shots[k - 1].1 = reach;
        let i = 1 + (k - 1) * PER_SHOT;
        let born = if p[2][3] > 0.0 { p[2][3] } else { self.clock.max(1e-3) };
        self.put(SHOTS, i, [hit.rest.x, hit.rest.y, hit.rest.z, reach]);
        self.put(SHOTS, i + 1, [ex.x, ex.y, ex.z, kind + rng.next() * 0.999]);
        self.put(SHOTS, i + 2, [n.x, n.y, n.z, prev as f32]);
        self.put(SHOTS, i + 3, p[0]);
        self.put(SHOTS, i + 4, p[1]);
        self.put(SHOTS, i + 5, [p[2][0], p[2][1], p[2][2], born]);
        self.put(SHOTS, 0, [self.clock, self.shots.len() as f32, 0.0, 0.0]);
        self.shot_clock = self.clock;
        // (Half again as far as it reaches: a metre of skin is only roughly `scale` units of the sheet every way.)
        let r = px(reach * 1.5, hit.scale) + 2.0 * PX;
        self.marks.push(Stamp::new(CAPSULE, hit.uv, hit.uv, r, 1e-7, r + PX, Vec4::new(0.0, 0.0, 0.0, k as f32 / 255.0), Vec4::ZERO));
    }

    // The record of the wound at `rest` made last, if it is of a kind in `kinds`.
    fn shot_at(&self, rest: Vec3, kinds: &[f32]) -> Option<usize> {
        let k = self.shots.iter().rposition(|&(at, _)| at.distance(rest) < 1e-5)? + 1;
        let kind = self.table[SHOTS * WIDE + 2 + (k - 1) * PER_SHOT][3].floor();
        kinds.contains(&kind).then_some(k)
    }

    // A bullet's way into skin (dev/research/wounds.md 4.1, DiMaio 1999 ch. 3-5): a round hole smaller than the bullet,
    // as the skin stretched round it and drew back (9 mm: 5.6 mm on a belly, 3.3 on a back, Geisenberger 2022), its edge
    // turned in, and round it the ring the bullet's flank rubbed raw (about a millimetre; `ring`: none from a rifle's fast
    // jacketed bullet, which splits the skin's edge in tiny tears instead). `again`: a way in after a way out (out of an
    // arm and into the chest), larger and ragged with a wide uneven ring. A shotgun's charge still in one mass (2 cm and
    // more) punches one round hole with a scalloped edge and a scraped margin. Which way the bullet came and how close the
    // muzzle was come after (`aimed`).
    pub fn entry(&mut self, hit: &Crossing, size: f32, ring: bool, again: bool, rng: &mut Rng) {
        let (kind, r, collar) = if size >= 0.018 {
            (CHARGE, size * (0.42 + 0.08 * rng.next()), 0.0022 + 0.001 * rng.next())
        } else if again {
            (AGAIN, size * (0.4 + 0.15 * rng.next()), 0.0022 + 0.0012 * rng.next())
        } else {
            (ENTRY, (size * (0.26 + 0.07 * rng.next())).max(0.001), if ring { 0.0009 + 0.0005 * rng.next() } else { 0.0 })
        };
        // (The scraped ring, three times as wide on the side the bullet came from, and a bruise round that.)
        let reach = r + collar * 3.4 + 0.004;
        let rifle = if ring || kind != ENTRY { 0.0 } else { 1.0 };
        self.shot(None, hit, tangent(hit.rest_normal), kind, reach, [[r, collar, 0.0, 0.0], [f32::INFINITY, rifle, 0.0, 0.0], [0.0; 4]], rng);
    }

    // Which way the bullet went into the way in at `hit` (`dir`, at rest) and how far the muzzle was from the skin
    // (`range`). Angled, the hole is an oval and the scraped ring is wider on the side it came from; close, the gas's
    // soot lies round it and the powder's burning grains are driven into the skin round that (wounds.md 4.2).
    pub fn aimed(&mut self, hit: &Crossing, dir: Vec3, range: f32) {
        let Some(k) = self.shot_at(hit.rest, &[ENTRY, AGAIN, CHARGE]) else { return };
        let i = SHOTS * WIDE + 1 + (k - 1) * PER_SHOT;
        let (ex, n) = (Vec3::from_slice(&self.table[i + 1]), Vec3::from_slice(&self.table[i + 2]));
        let back = -dir.normalize();
        let mut size = self.table[i + 3];
        size[2] = back.dot(ex);
        size[3] = back.dot(n.cross(ex));
        let mut far = self.table[i + 4];
        far[0] = range;
        let (r, mut reach) = (size[0], self.shots[k - 1].1);
        // Powder reaches out to about 60 cm from a handgun, twice that from a rifle; its pattern is wider the further.
        if range < 1.2 {
            reach = reach.max(r + (0.006 + range * 0.15).min(0.06));
        }
        let (kind, born) = (self.table[i + 1][3], self.table[i + 5]);
        // (its seed as it was)
        let mut same = Rng::new(0);
        self.shot(Some(k), hit, ex, kind.floor(), reach, [size, far, born], &mut same);
        self.table[i + 1][3] = kind;
    }

    // A bullet's way out (dev/research/wounds.md 4.3, gunshot-blood.md sec. 3; DiMaio 1999 ch. 4): torn, not punched,
    // larger and more irregular than the way in: a slit, a crescent, a star of splits over bone, or a ragged tear, its
    // edges turned out, fat showing between them, no scraped ring. `arms` the splits medicine tore (wounds.rs `tear`:
    // each its line at rest, its half length and half width), `fat` how much fat is under the skin there. A wound's own
    // dice make what the splits do not say: each side of a split its own length, the split bent, the ragged hole where
    // the bullet burst through between them. Without `arms` (a blade's point out of the skin, or before the tear's shape
    // is known) one slit `size` long.
    pub fn exit(&mut self, hit: &Crossing, size: f32, arms: Option<&[(Vec3, [f32; 2])]>, fat: f32, rng: &mut Rng) {
        let n = hit.rest_normal;
        let k = self.shot_at(hit.rest, &[EXIT]);
        let turn = rng.next() * std::f32::consts::PI;
        let slit = [(tangent(n) * turn.cos() + n.cross(tangent(n)) * turn.sin(), [size / 2.0, size * 0.15])];
        let arms = arms.filter(|a| !a.is_empty()).unwrap_or(&slit);
        let ex = arms[0].0;
        let ey = n.cross((ex - n * ex.dot(n)).normalize_or(tangent(n)));
        let angle = |a: Vec3| a.dot(ey).atan2(a.dot(ex));
        // The splits after the first are the tears off it, shorter and narrower than it: a slit with a split or two
        // across it, not a cross of equals (DiMaio's exits are slits, crescents, irregular tears, stars only over bone).
        let mut arm = |j: usize| arms.get(j).map_or([0.0, 0.0, 0.0], |(a, h)| [angle(*a), h[0] * (0.35 + 0.4 * rng.next()), h[1] * 0.6]);
        let (a2, a3) = (arm(1), arm(2));
        let longest = arms.iter().map(|(_, h)| h[0]).fold(0.0, f32::max);
        let wide = arms[0].1[0] * 2.0;
        // A single slit now and then a crescent, most only a little bent; a star's splits straight (bent the same way they
        // would turn it into a pinwheel).
        let bend = if arms.len() > 1 { (rng.next() - 0.5) * 0.2 } else if rng.next() < 0.35 { (0.6 + 0.4 * rng.next()) * if rng.next() < 0.5 { -1.0 } else { 1.0 } } else { (rng.next() - 0.5) * 0.5 };
        let burst = wide * (0.07 + 0.06 * rng.next());
        // (Its lips turned out in a band a millimetre and a half wide and more for a bigger tear: wounds.rs's `lip`.)
        let reach = longest + 0.0015 + wide * 0.04 + 0.003;
        let born = k.map_or(0.0, |k| self.table[SHOTS * WIDE + 1 + (k - 1) * PER_SHOT + 5][3]);
        self.shot(k, hit, ex, EXIT, reach, [[fat, burst, arms[0].1[0], arms[0].1[1]], [a2[0], a2[1], a2[2], a3[0]], [a3[1], a3[2], bend, born]], rng);
    }
}
