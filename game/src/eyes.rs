// The eyes hurt: what a bullet, a pellet or fragment, a blade and a blow do to the globe, as it works
// (src/sandbox/eyes.ts, dev/research/eye-trauma.md). What it looks like (the hole or the cut in its wall, the blood under
// the conjunctiva spreading over the white, the blood in the front chamber settling level, the globe falling in) is
// eyes.rs's look in phase 3: this keeps what the TS's Eyes kept for it, in the same terms, and does what an eye's hurt
// does to the person (blind in it, the pain, the lids clamped, what runs from it).

use bevy::prelude::*;

use crate::npc::{Crossing, Npc};
use crate::vitals::{Bleed, Side};
use crate::wounds::{cap, Missile};

const SCLERA: f32 = 0.265; // UV radius of each eye's painted disc (the white ends there)

// Blood under the conjunctiva: where on the eye's picture (a hit's own UV, or `iris`: off the iris's centre by u, v), how
// big it is now and will be, how fast it gets there, how dense.
#[derive(Clone, Debug)]
pub struct Patch {
    pub u: f32,
    pub v: f32,
    pub iris: bool,
    pub r: f32,
    pub to: f32,
    pub tau: f32,
    pub dense: f32,
}

// A hole or cut in the wall: where (UV, or off the iris's centre), how big (metres of eye, or the TS's UV radius when
// `uv`), which way a slit runs.
#[derive(Clone, Debug)]
pub struct Mark {
    pub u: f32,
    pub v: f32,
    pub iris: bool,
    pub size: f32,
    pub uv: bool,
    pub along: Option<Vec2>,
    pub kind: &'static str,
}

#[derive(Clone, Debug, Default)]
pub struct Eye {
    // How much of the globe's contents are gone (0 to 1, where it is headed and where it is now): it collapses as they go.
    pub lost: f32,
    pub collapse: f32,
    // Blood in the front chamber (share of it) and how much has settled.
    pub blood: f32,
    pub blood_to: f32,
    pub settled: f32,
    pub patches: Vec<Patch>,
    pub marks: Vec<Mark>,
    pub blind: bool,
    // Lids clamped shut against it (reflex blepharospasm), 0 to 1.
    pub clamp: f32,
    // A pupil that no longer works, mm (torn sphincter: wide), or 0.
    pub pupil: f32,
    // Metres the eye sits back in the socket (a blown-out floor).
    pub sunk: f32,
    pub t: f32,
}

#[derive(Default)]
pub struct Eyes {
    pub l: Eye,
    pub r: Eye,
    broken: usize,
}

impl Eyes {
    pub fn eye(&mut self, s: Side) -> &mut Eye {
        if s == Side::L { &mut self.l } else { &mut self.r }
    }
}

pub struct EyesOf<'n, 'a>(pub &'n mut Npc<'a>);

impl<'a> Npc<'a> {
    pub fn eyes<'n>(&'n mut self) -> EyesOf<'n, 'a> {
        EyesOf(self)
    }
}

impl EyesOf<'_, '_> {
    // Which eye a crossing of it (surface()'s, Kind::Eye) is.
    pub fn side_of(&self, hit: &Crossing) -> Side {
        let body = self.0.body();
        let name = &body.bones[hit.owner].name;
        if name.ends_with(".L") {
            Side::L
        } else if name.ends_with(".R") {
            Side::R
        } else if hit.rest.distance(body.bone("eye.L").head) < hit.rest.distance(body.bone("eye.R").head) {
            Side::L
        } else {
            Side::R
        }
    }

    // The skin of the lower lid's edge on side `s`, where what comes out of the eye runs from (in front of the eye's
    // middle: -Z here, the TS's +Z).
    pub fn lid(&self, s: Side) -> Option<Crossing> {
        let e = self.0.body().bone(if s == Side::L { "eye.L" } else { "eye.R" }).head;
        self.0.nearest_rest(Vec3::new(e.x, e.y - 0.012, e.z - 0.012), 0.02)
    }

    // The eye at crossing `hit` met by missile `m` going along `dir`: a bullet, a pellet or fragment, or a blade's point
    // (wounds.rs pierce). `deep` is how far into the body it went. What runs out of it runs from the lid it returns.
    pub fn pierced(&mut self, hit: &Crossing, m: &Missile, _dir: Vec3, deep: f32, through: bool) -> Option<Crossing> {
        let s = self.side_of(hit);
        let word = if s == Side::L { "left" } else { "right" };
        let (u, w) = (hit.uv.x, hit.uv.y);
        let d = &mut *self.0.dice;
        let e = self.0.hurt.eyes.eye(s);
        e.t = 0.0;
        let text;
        if m.blade {
            // A blade's point: a straight cut as wide as the blade where it went in, along its edge. Aqueous goes at once and
            // the chamber falls flat; the iris is carried into the cut; deeper, lens and vitreous follow (eye-trauma.md sec.
            // 2, Blade). (Which way the cut runs across the picture the TS found with a second line beside the first: the
            // look's to work out from `m.across`.)
            let width = m.calibre * (deep / m.taper.unwrap_or(0.01)).clamp(0.15, 1.0);
            e.marks.push(Mark { u, v: w, iris: false, size: width / 2.0, uv: false, along: None, kind: "slit" });
            e.lost = e.lost.max(if deep > 0.012 { 0.55 } else { 0.25 });
            e.blood_to = e.blood_to.max(0.35 + d.next() * 0.3);
            e.patches.push(Patch { u, v: w, iris: false, r: 0.02, to: 0.09 + d.next() * 0.05, tau: 12.0, dense: 0.9 });
            text = format!("{} eye cut open by the blade: blind in it", cap(word));
        } else if m.name.is_some() || m.calibre < 0.005 {
            // A pellet or a fragment: a small hole, often a second one behind; the globe goes soft, blood fills the chamber.
            e.marks.push(Mark { u, v: w, iris: false, size: m.calibre / 2.0 * 1.2, uv: false, along: None, kind: "pellet" });
            e.lost = (e.lost + if through { 0.4 } else { 0.25 }).min(0.8);
            e.blood_to = (e.blood_to + 0.45 + d.next() * 0.3).min(1.0);
            e.patches.push(Patch { u, v: w, iris: false, r: 0.01, to: 0.07 + d.next() * 0.05, tau: 15.0, dense: 0.85 });
            text = format!("{} in the {word} eye: blind in it", cap(m.name.as_deref().unwrap_or("fragment")));
        } else {
            // A bullet: the globe burst and emptied, its wall split round the hole, flat and wrinkled within a second.
            e.marks.push(Mark { u, v: w, iris: false, size: m.calibre / 2.0 * 2.2, uv: false, along: None, kind: "hole" });
            e.lost = 1.0;
            e.blood_to = 1.0;
            e.patches.push(Patch { u: 0.0, v: 0.0, iris: true, r: 0.05, to: SCLERA, tau: 2.5, dense: 1.0 });
            text = format!("{} eye destroyed by the {}", cap(word), if m.pellets.unwrap_or(1) > 1 { "pellet" } else { "bullet" });
        }
        self.0.vitals.injure(text, if m.blade || m.name.is_some() || m.calibre < 0.005 { 7.0 } else { 9.0 });
        self.blinded(s, 1.0);
        // What runs from it: blood with the eye's own fluid, little in all (the globe holds about 7 ml) but more from a
        // bullet that tore the vessels of the orbit behind it (eye-trauma.md sec. 4).
        let lid = self.lid(s);
        let rate = if m.blade { 0.00012 } else if m.name.is_some() { 0.00006 } else { 0.0006 };
        self.0.vitals.bleed(Bleed::new(format!("{word} eye"), rate).clots(if m.blade || m.name.is_some() { 0.02 } else { 0.006 }).mark(lid.clone()));
        if lid.is_some() {
            self.0.welling(lid.as_ref(), if m.blade || m.name.is_some() { 0.08 } else { 0.4 });
        }
        lid
    }

    // A blow landing at `point` (world) along `dir`: `energy` J, `narrow` when what landed is smaller than the orbit's rim
    // (a bat's end, a hammer, an edge) rather than a fist, which the rim mostly takes (eye-trauma.md sec. 2, Punch).
    pub fn struck(&mut self, point: Vec3, _dir: Vec3, energy: f32, narrow: bool) {
        for s in [Side::L, Side::R] {
            let bone = self.0.bone_index(if s == Side::L { "eye.L" } else { "eye.R" });
            let at = self.0.world_of(self.0.body().bones[bone].head, bone, None).0;
            let d = at.distance(point);
            let reach = if narrow { 0.03 } else { 0.045 };
            if d > reach {
                continue;
            }
            let k = (1.0 - d / reach).max(0.0);
            let word = if s == Side::L { "left" } else { "right" };
            let dice = &mut *self.0.dice;
            let v = &mut *self.0.vitals;
            let e = self.0.hurt.eyes.eye(s);
            e.t = 0.0;
            e.clamp = e.clamp.max(0.8 * k);
            // Blood under the conjunctiva, coming up over minutes where the white was pressed.
            if dice.next() < 0.3 + energy / 60.0 {
                let a = dice.next() * std::f32::consts::TAU;
                let r = 0.13 + dice.next() * 0.08;
                let to = 0.04 + 0.06 * dice.next() * k;
                e.patches.push(Patch { u: a.cos() * r, v: a.sin() * r, iris: true, r: 0.005, to, tau: 60.0, dense: 0.8 });
                v.injure(format!("Blood under the white of the {word} eye"), 1.0);
            }
            // The iris root torn by the eye's sudden squash: blood in the front chamber over the next minutes (a hyphaema),
            // and now and then the pupil's sphincter torn, leaving it wide.
            if dice.next() < (energy / if narrow { 25.0 } else { 120.0 }).min(0.85) * k {
                e.blood_to = (e.blood_to + (0.08 + energy / 250.0).min(0.6)).min(1.0);
                v.injure(format!("Blood in the front of the {word} eye"), 3.0);
                if dice.next() < 0.3 {
                    e.pupil = 6.0 + dice.next();
                }
            }
            // Broken open by something narrow and hard enough: the wall splits where it is thinnest, away from the blow,
            // round the cornea's edge or behind the muscles' insertions (contrecoup), with dense red all round.
            if narrow && energy * k > 35.0 {
                let a = dice.next() * std::f32::consts::TAU;
                // (The TS put it at 1.25 iris radii from the iris's centre, in its own UV units: the look's to place.)
                e.marks.push(Mark { u: a.cos(), v: a.sin(), iris: true, size: 0.06, uv: true, along: Some(Vec2::new(-a.sin(), a.cos())), kind: "slit" });
                e.lost = e.lost.max(0.5);
                e.blood_to = 1.0;
                e.patches.push(Patch { u: 0.0, v: 0.0, iris: true, r: 0.05, to: SCLERA, tau: 6.0, dense: 1.0 });
                self.blinded(s, k);
                self.0.vitals.injure(format!("{} eye burst by the blow: blind in it", cap(word)), 8.0);
                let lid = self.lid(s);
                self.0.vitals.bleed(Bleed::new(format!("{word} eye"), 0.0001).clots(0.02).mark(lid.clone()));
                if lid.is_some() {
                    self.0.welling(lid.as_ref(), 0.1);
                }
            }
        }
    }

    fn blinded(&mut self, s: Side, k: f32) {
        let e = self.0.hurt.eyes.eye(s);
        e.blind = true;
        e.clamp = 1.0;
        let v = &mut *self.0.vitals;
        if s == Side::L { v.blind.0 = true } else { v.blind.1 = true }
        // The most densely innervated surface of the body opened: as much pain as there is.
        v.pain = (v.pain + 0.6 * k).max(0.9 * k).min(1.0);
    }

    // Each eye's own clock: what is lost goes in the first second (the wall's tension spends itself) and the eye falls in
    // after it; blood comes into the chamber over seconds (a burst eye) to minutes (a blow), then settles; a dead man's
    // lids let go.
    pub fn update(&mut self, dt: f32) {
        let dead = self.0.vitals.dead;
        for s in [Side::L, Side::R] {
            let e = self.0.hurt.eyes.eye(s);
            e.t += dt;
            if (e.lost - e.collapse).abs() > 1e-3 {
                e.collapse += (e.lost - e.collapse) * (dt / 0.35).min(1.0);
            }
            if e.blood_to - e.blood > 1e-3 {
                e.blood += (e.blood_to - e.blood) * (dt / if e.lost >= 1.0 { 1.2 } else if e.lost > 0.0 { 8.0 } else { 40.0 }).min(1.0);
            }
            if e.blood > 0.01 && e.settled < 0.999 {
                e.settled += (1.0 - e.settled) * (dt / 90.0).min(1.0);
            }
            for p in &mut e.patches {
                if p.to - p.r > 1e-4 {
                    p.r += (p.to - p.r) * (dt / p.tau).min(1.0);
                }
            }
            if e.clamp > 0.0 && dead {
                e.clamp = 0.0;
            }
        }
        // A blown-out floor lets the eye sink back and down a little at once (more as the swelling goes, days later:
        // eye-trauma.md sec. 2, Punch).
        let n = self.0.hurt.bones.breaks.len();
        if n != self.0.hurt.eyes.broken {
            self.0.hurt.eyes.broken = n;
            let blown: Vec<Side> = self.0.hurt.bones.breaks.iter().filter(|b| b.r#type == "blowout").filter_map(|b| b.side).collect();
            for s in blown {
                self.0.hurt.eyes.eye(s).sunk = 0.0015;
            }
        }
    }
}
