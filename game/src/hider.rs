// What clothes and the skin under them show of wounds (src/sandbox/hider.ts): a hole in a shirt where a bullet went
// through, a blade's slit, the skin torn open where a bullet came out, and the skin under the clothes, drawn only where
// a hole lets it be seen. skin.wesl draws them from the person's table (skin.rs), where they are kept here.
//
// All of it is in the person's rest space, which is what the mesh's own corners are in before the skeleton moves them,
// not in the clothes' picture: a pair of trousers may give both legs the same place in it.

use bevy::prelude::*;

use crate::skin::Skin;

pub const MOST: usize = 64; // wounds (or holes in clothes) one person can have drawn

// The table's rows: the clothes' holes, the skin's openings, the windows through the clothes onto the skin under them.
const CLOTH_ROW: usize = 1;
const SKIN_ROW: usize = 2;
const WINDOW_ROW: usize = 3;

// How far either side of an opening's plane it is cut: a little for skin; clothes stand off (npc.ts _ownMaterials).
const SKIN_DEPTH: f32 = 0.03;
const CLOTH_DEPTH: f32 = 0.05;

// An opening at `at` running along `ex`, on a surface facing `ey`: `half` is (half its length, half its width).
pub struct Opening {
    pub at: Vec3,
    pub ex: Vec3,
    pub ey: Vec3,
    pub half: [f32; 2],
}

// Some direction square to `n`.
pub fn tangent(n: Vec3) -> Vec3 {
    n.cross(if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize()
}

impl Skin {
    fn header(&mut self) {
        let records = self.table[0][1];
        let clock = self.table[0][0];
        self.put(0, 0, [clock, records, self.cloth_holes as f32, self.skin_holes as f32]);
        self.put(0, 1, [self.windows as f32, if self.opened { 1.0 } else { 0.0 }, 0.0, 0.0]);
    }

    fn opening(&mut self, row: usize, k: usize, o: &Opening, depth: f32) {
        self.put(row, k * 3, [o.at.x, o.at.y, o.at.z, o.half[0]]);
        self.put(row, k * 3 + 1, [o.ex.x, o.ex.y, o.ex.z, o.half[1]]);
        self.put(row, k * 3 + 2, [o.ey.x, o.ey.y, o.ey.z, depth]);
    }

    // A hole or slit in the clothes; a width of -1 is a bullet's frayed round hole going in, -2 going out. False once as
    // many as can be drawn are.
    pub fn cloth_hole(&mut self, o: &Opening) -> bool {
        if self.cloth_holes >= MOST {
            return false;
        }
        let k = self.cloth_holes;
        self.cloth_holes += 1;
        self.opening(CLOTH_ROW, k, o, CLOTH_DEPTH);
        self.header();
        true
    }

    // The skin torn open right through (a bullet's way out): through it, the body's wall seen from inside.
    pub fn skin_hole(&mut self, o: &Opening) -> bool {
        if self.skin_holes >= MOST {
            return false;
        }
        let k = self.skin_holes;
        self.skin_holes += 1;
        self.opening(SKIN_ROW, k, o, SKIN_DEPTH);
        self.opened = true;
        self.header();
        true
    }

    // The skin under the clothes shown through a hole in them: a round window `radius` across at `at`, through clothes
    // facing `n`, `depth` either side of it.
    pub fn window(&mut self, at: Vec3, n: Vec3, radius: f32, depth: f32) {
        if self.windows >= MOST {
            return;
        }
        let k = self.windows;
        self.windows += 1;
        self.put(WINDOW_ROW, k * 2, [at.x, at.y, at.z, radius]);
        self.put(WINDOW_ROW, k * 2 + 1, [n.x, n.y, n.z, depth]);
        self.header();
    }
}
