// Blood lying on skin (src/sandbox/film.ts): how thick it is at each place of the skin, and how wet it still is, in the
// person's film sheet (skin.rs): red the thickness (to 0.6 mm: blood thicker than that on skin runs off), green how wet.
// skin.wesl draws it as a layer of blood over the skin, glossy while wet, going brown and dull as it dries. A thin film
// of blood on skin dries in five to ten minutes.
//
// The TS dried each 128-pixel tile of its canvas on its own clock, a few tiles a frame, and sent them up; here the
// whole sheet dries at once on the card, every DRYING seconds, by a pass that scales its wetness (skin.rs), for as long
// as anything on it is still drying.

use bevy::prelude::*;

use crate::npc::Crossing;
use crate::rng::Rng;
use crate::skin::{Skin, Stamp, BLOT, CAPSULE, SIZE};

pub const MOST_MM: f32 = 0.6; // the thickest film the sheet holds
const DRIES: f32 = 420.0; // seconds for a film's wetness to fall to a third
const DRYING: f32 = 8.0; // seconds between the sheet's dryings (as the TS's tiles' own clocks)

const PX: f32 = 1.0 / SIZE as f32;

impl Skin {
    // Blood laid along the skin from crossing `a` to crossing `b`: a streak `wide` metres across, `mm` thick down its
    // middle and thinner to its edges, as a stream's cross-section is rounded. Where blood already lies it is as thick as
    // the thicker of the two (a stream running again down its own track does not pile up), and wet again.
    pub fn stroke(&mut self, a: &Crossing, b: &Crossing, wide: f32, mm: f32) {
        if a.uv.distance(b.uv) > 0.03 {
            return;
        }
        // (the canvas's line width, in pixels)
        let w = (wide * a.scale.min(3.0) * SIZE as f32).clamp(1.0, 40.0);
        for (k, share) in [(1.0, 0.4), (0.66, 0.72), (0.33, 1.0)] {
            let line = ((w * k * 2.0).round() / 2.0).max(1.0);
            let level = ((mm * share / MOST_MM * 64.0).round() * 4.0).clamp(1.0, 255.0) / 255.0;
            let half = line / 2.0 * PX;
            self.strokes.push(Stamp::new(CAPSULE, a.uv, b.uv, half, PX * 0.5, half + PX, Vec4::new(level, 1.0, 0.0, 0.0), Vec4::ZERO));
        }
        self.painted = self.clock;
    }

    // A patch of blood at `hit` about `r` metres across and `mm` thick: a drop's mark, or what a wound wells up. Its edge
    // is uneven, as blood stops where the skin's grain and hairs stop it.
    pub fn blot(&mut self, hit: &Crossing, r: f32, mm: f32, rng: &mut Rng) {
        let size = (r * hit.scale.min(3.0) * SIZE as f32).clamp(0.8, 160.0) * PX;
        let lobes = 7.0 + (rng.next() * 5.0).floor();
        let turn = rng.next() * std::f32::consts::TAU;
        let seed = rng.next() * 1000.0;
        let level = (mm / MOST_MM * 255.0).round().clamp(1.0, 255.0) / 255.0;
        self.strokes.push(Stamp::new(BLOT, hit.uv, hit.uv, size, PX * 0.5, size * 1.2 + PX, Vec4::new(level, 1.0, 0.0, 0.0), Vec4::new(seed, lobes * 2.0, turn, 0.0)));
        self.painted = self.clock;
    }

    // Each frame: the film dries every DRYING seconds while anything on it is drying (twenty minutes after the last blood
    // came, it is dry), by as much as it would have in that time.
    pub fn dry(&mut self, dt: f32) {
        self.clock += dt;
        if self.clock - self.painted > DRIES * 3.0 || self.clock - self.dried < DRYING {
            return;
        }
        self.dry = Some((-(self.clock - self.dried) / DRIES).exp());
        self.dried = self.clock;
    }
}
