// The eyes hurt: what a bullet, a pellet or fragment, a blade and a blow do to the globe, as it works
// (src/sandbox/eyes.ts, dev/research/eye-trauma.md). What it looks like (the hole or the cut in its wall, the blood under
// the conjunctiva spreading over the white, the blood in the front chamber settling level, the globe falling in) is
// eyes.rs's look in phase 3: this keeps what the TS's Eyes kept for it, in the same terms, and does what an eye's hurt
// does to the person (blind in it, the pain, the lids clamped, what runs from it).

use std::sync::Arc;

use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy::shader::ShaderRef;

use crate::npc::{Crossing, Kind, Npc};
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
    // Bloodshot: how far the conjunctiva's vessels are dilated, 0 to 1, and where that is headed.
    pub red: f32,
    pub red_to: f32,
    // A dead eye's surface dried: its tear film gone, its shine dulled, 0 to 1.
    pub dry: f32,
    pub t: f32,
}

#[derive(Clone, Default)]
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
    pub fn pierced(&mut self, hit: &Crossing, m: &Missile, dir: Vec3, deep: f32, through: bool) -> Option<Crossing> {
        let s = self.side_of(hit);
        let word = if s == Side::L { "left" } else { "right" };
        let (u, w) = (hit.uv.x, hit.uv.y);
        // Which way a blade's cut runs across the eye's picture: along its edge, found by a second line beside the first.
        let mut along = None;
        if let (true, Some(across)) = (m.blade, m.across) {
            let o = hit.point - dir * 0.05 + across * 0.002;
            let two = self.0.surface(o, dir, 0.1, true).into_iter().find(|h| h.kind == Kind::Eye && self.side_of(h) == s);
            along = two.map(|h| h.uv - hit.uv).filter(|d| d.length() > 1e-5).map(|d| d.normalize());
        }
        let d = &mut *self.0.dice;
        let e = self.0.hurt.eyes.eye(s);
        e.t = 0.0;
        e.red_to = 1.0;
        let text;
        if m.blade {
            // A blade's point: a straight cut as wide as the blade where it went in, along its edge. Aqueous goes at once and
            // the chamber falls flat; the iris is carried into the cut; deeper, lens and vitreous follow (eye-trauma.md sec.
            // 2, Blade).
            let width = m.calibre * (deep / m.taper.unwrap_or(0.01)).clamp(0.15, 1.0);
            e.marks.push(Mark { u, v: w, iris: false, size: width / 2.0, uv: false, along, kind: "slit" });
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
            // The struck eye goes bloodshot: its conjunctiva's vessels dilate as it swells (traumatic conjunctivitis),
            // within the minute.
            e.red_to = e.red_to.max((0.4 + energy / 40.0).min(1.0) * k);
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

    // A bullet's track passing near an eye, not through it (from `origin` along `dir`, `from` to `to` metres along it):
    // the orbit's thin walls broken and its fat torn by the cavity the bullet makes. Blood seeps forward under the
    // conjunctiva from the side the track is on and spreads over the white over minutes, and the eye goes bloodshot;
    // closer, the shock tears the iris root and blood comes into the front chamber (an indirect, closed-globe injury:
    // eye-trauma.md sec. 6).
    pub fn near(&mut self, origin: Vec3, dir: Vec3, from: f32, to: f32, energy: f32) {
        for s in [Side::L, Side::R] {
            let bone = self.0.bone_index(if s == Side::L { "eye.L" } else { "eye.R" });
            let at = self.0.world_of(self.0.body().bones[bone].head, bone, None).0;
            let along = (at - origin).dot(dir).clamp(from, to);
            let off = at - (origin + dir * along);
            let d = off.length();
            // (Through it: pierced's. Past three centimetres the orbit is not the track's.)
            if d < 0.011 || d > 0.03 || self.0.hurt.eyes.eye(s).lost > 0.0 {
                continue;
            }
            let k = ((0.03 - d) / 0.019).clamp(0.0, 1.0) * (energy / 400.0).min(1.0);
            if k < 0.05 {
                continue;
            }
            // Where on the white the blood comes forward: the eye's own corner nearest the place on the globe that faces
            // the track, brought round toward the front where the white shows.
            let body = self.0.body();
            let toward = self.0.rest_to_world(bone).inverse().transform_vector3(-off).normalize_or_zero();
            let want = body.bones[bone].head + (toward * 0.5 + Vec3::NEG_Z).normalize_or_zero() * 0.012;
            let uv = body.parts.iter().filter(|p| p.kind == "eyes").flat_map(|p| p.vertex_start..p.vertex_start + p.vertex_count)
                .filter(|&v| body.bones[body.joints[v][0] as usize].name.ends_with(if s == Side::L { ".L" } else { ".R" }))
                .min_by(|&a, &b| body.position[a].distance_squared(want).total_cmp(&body.position[b].distance_squared(want)))
                .map(|v| body.uv[v]);
            let Some(uv) = uv else { continue };
            let word = if s == Side::L { "left" } else { "right" };
            let dice = &mut *self.0.dice;
            let v = &mut *self.0.vitals;
            let e = self.0.hurt.eyes.eye(s);
            e.t = 0.0;
            e.red_to = e.red_to.max(0.5 + 0.5 * k);
            e.patches.push(Patch { u: uv.x, v: uv.y, iris: false, r: 0.01, to: 0.08 + 0.12 * k, tau: 40.0, dense: 0.9 });
            if dice.next() < k {
                e.blood_to = (e.blood_to + 0.1 + 0.3 * k).min(1.0);
            }
            v.injure(format!("Blood under the white of the {word} eye: the orbit broken behind it"), 2.0);
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
        // (Crying reddens the eyes too, a little: the tears' irritation and the rubbing.)
        let crying = self.0.hurt.crying && !dead;
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
            if crying {
                e.red_to = e.red_to.max(0.3);
            }
            if e.red_to - e.red > 1e-3 {
                e.red += (e.red_to - e.red) * (dt / 15.0).min(1.0);
            }
            // Dead, nothing blinks: the tear film breaks up within seconds (it does in a living eye held open some ten
            // seconds) and the cornea starts to dry in about ten minutes, losing its shine; clouded in two or three hours
            // (the lids shut keep it longer, and this sandbox's minutes never get there: sec. 6).
            if dead {
                e.dry += (1.0 - e.dry) * (dt / 600.0).min(1.0);
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

// --- the look (eyes.ts EyeLayer, and face.ts's PupilLayer and the eye's own wet material) ------------------------------
//
// Each person's eyes are drawn with a material of their own: the eye's picture, wet (the tear film is smoother than
// anything else on a body: a sharp catchlight of every lamp), with eye.wesl over it. The pupil is drawn at any size:
// inside the iris the picture is sampled from where the painted pupil and iris would put each point, so the pupil grows
// into the iris and the iris's pattern is squeezed toward its rim, as a real iris's is (face.ts PupilLayer). Over that,
// what the eye shows of its hurt: blood under the conjunctiva spreading over the white, the hole or the cut in its wall
// with the dark uvea pushed out through it, blood in the front chamber, a red haze that settles into a layer with a flat
// top, level in the world however the head is turned, and an emptied globe's wall in folds.
//
// The TS painted the hole, the cut and the bleeding under the conjunctiva on a 256-pixel canvas a person and sent it up;
// here each is worked out where it is drawn, from a short list of them in the material's uniform (eye.wesl), at that
// sheet's own sharpness. The uniform is written only when something in it moved.

// As many patches of blood and holes or cuts as an eye's material draws (each of the two eyes keeps its first ones).
pub const MOST: usize = 12;

#[derive(Clone, Copy, Debug, Default, PartialEq, ShaderType, Reflect)]
pub struct EyeUniform {
    // The two irises' centres on the picture (A then B: the first with the larger u, as the TS sorted them), the iris's
    // and the painted pupil's radius and each pupil's as shown, the iris's radius in metres.
    pub centres: Vec4,
    pub sizes: Vec4,
    pub iris: Vec4,
    // Per eye (A, B): the iris's centre in the world now and the settled blood's height; the haze of blood stirred up,
    // how far the globe has collapsed, how far the blood has clotted, how bloodshot it is. (`iris`'s third: how dry the
    // eyes of the dead have gone.)
    pub world: [Vec4; 2],
    pub state: [Vec4; 2],
    // How many patches and marks.
    pub counts: UVec4,
    // Blood under the conjunctiva: u, v, radius (picture units), density.
    pub patches: [Vec4; MOST],
    // Holes and cuts: u, v, radius, kind (0 a hole, 1 a pellet's, 2 a cut); a cut's way across the picture and the seed of
    // a hole's torn edge.
    pub marks: [Vec4; MOST],
    pub along: [Vec4; MOST],
}

#[derive(Asset, AsBindGroup, Reflect, Debug, Clone, Default)]
pub struct EyeLook {
    #[uniform(100)]
    pub eye: EyeUniform,
}

impl MaterialExtension for EyeLook {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/eye.wesl".into()
    }
}

pub type EyeMaterial = ExtendedMaterial<StandardMaterial, EyeLook>;

// The iris in MakeHuman's eye textures (both eyes are painted on one sheet): the two centres on the picture (here v runs
// down the picture, the TS's turned over), the iris's and the painted pupil's radius, measured from the pictures (the
// dark disc's area and the brightness out from it).
const BROWN: ([f32; 4], f32, f32) = ([0.7041, 1.0 - 0.7019, 0.2884, 1.0 - 0.29], 0.105, 0.0374);
const BLUEGREEN: ([f32; 4], f32, f32) = ([0.7059, 1.0 - 0.7047, 0.2929, 1.0 - 0.299], 0.105, 0.0296);

// What is read off a body's eyes once: each eye's (L, R) iris centre on the picture and on the body at rest, the iris's
// and painted pupil's radius, and how many units of the picture a metre of eye is near the iris.
pub struct Irises {
    pub centre: [Vec2; 2],
    pub at: [Vec3; 2],
    pub iris: f32,
    pub pupil: f32,
    pub per_m: f32,
}

impl Irises {
    pub fn new(body: &crate::person::Body) -> Irises {
        let part = body.parts.iter().find(|p| p.kind == "eyes");
        let file = part.and_then(|p| p.texture.as_ref()).map_or("", |t| t.file.as_str());
        let (c, iris, pupil) = if file.contains("bluegreen") { BLUEGREEN } else { BROWN };
        let centres = [Vec2::new(c[0], c[1]), Vec2::new(c[2], c[3])];
        // Which painted eye is which, and how big the painted one is, from the mesh itself.
        let mut near = [(f32::INFINITY, 0usize); 2];
        let mut which = [0usize, 1];
        let side = |v: usize| -> Option<usize> {
            let name = &body.bones[body.joints[v][0] as usize].name;
            if name.ends_with(".L") { Some(0) } else if name.ends_with(".R") { Some(1) } else { None }
        };
        let (mut scale, mut counted) = (0.0, 0);
        if let Some(p) = part {
            let range = p.vertex_start..p.vertex_start + p.vertex_count;
            for v in range.clone() {
                let Some(s) = side(v) else { continue };
                for (k, c) in centres.iter().enumerate() {
                    let d = body.uv[v].distance(*c);
                    if d < near[s].0 && d < 0.1 {
                        near[s] = (d, v);
                        which[s] = k;
                    }
                }
            }
            // Metres of eye to a unit of the sheet near the iris: from the iris's middle out to a third of the way past it.
            for s in 0..2 {
                let c = near[s].1;
                for v in range.clone() {
                    if side(v) != Some(s) {
                        continue;
                    }
                    let d = body.uv[v].distance(body.uv[c]);
                    if !(0.05..=0.14).contains(&d) {
                        continue;
                    }
                    scale += body.position[v].distance(body.position[c]) / d;
                    counted += 1;
                }
            }
        }
        let tail = |s: usize| body.bone(if s == 0 { "eye.L" } else { "eye.R" }).tail;
        Irises {
            centre: [centres[which[0]], centres[which[1]]],
            at: [0, 1].map(|s| if part.is_some() && near[s].0.is_finite() { body.position[near[s].1] } else { tail(s) }),
            iris,
            pupil,
            per_m: if counted > 0 { counted as f32 / scale } else { 50.0 },
        }
    }
}

// A person's eyes' own material, and what it was last given.
#[derive(Component)]
pub struct EyesDrawn {
    pub material: Handle<EyeMaterial>,
    irises: Arc<Irises>,
}

// Each person with a face and no eyes of their own yet: the eyes' material made theirs.
fn own_eyes(
    mut commands: Commands,
    people: Query<(Entity, &crate::person::Person), (With<crate::face::Face>, Without<EyesDrawn>)>,
    parts: Query<&MeshMaterial3d<StandardMaterial>>,
    standard: Res<Assets<StandardMaterial>>,
    mut materials: ResMut<Assets<EyeMaterial>>,
    mut irises: Local<std::collections::HashMap<String, Arc<Irises>>>,
) {
    for (e, person) in &people {
        let body = &person.body;
        let Some(&(_, part)) = person.parts.iter().find(|(i, _)| body.parts[*i].kind == "eyes") else { continue };
        let Some(base) = parts.get(part).ok().and_then(|m| standard.get(&m.0)) else { continue };
        let mut base = base.clone();
        // The tear film: a sharp catchlight of every lamp and the room behind.
        base.perceptual_roughness = 0.04;
        let irises = irises.entry(body.name.clone()).or_insert_with(|| Arc::new(Irises::new(body))).clone();
        let material = materials.add(EyeMaterial { base, extension: EyeLook::default() });
        commands.entity(part).remove::<MeshMaterial3d<StandardMaterial>>().insert(MeshMaterial3d(material.clone()));
        commands.entity(e).insert(EyesDrawn { material, irises });
    }
}

// The eyes' uniform from the face's pupils and the eyes' hurt, written to the material when it changed.
fn draw_eyes(
    people: Query<(&crate::person::Person, &Transform, &crate::npc::Hurt, &crate::face::Face, &EyesDrawn)>,
    mut materials: ResMut<Assets<EyeMaterial>>,
) {
    for (person, root, hurt, face, drawn) in &people {
        let ir = &drawn.irises;
        // A and B: the centre with the larger u first.
        let order = if ir.centre[0].x >= ir.centre[1].x { [0, 1] } else { [1, 0] };
        let eyes = [&hurt.eyes.l, &hurt.eyes.r];
        let mut u = EyeUniform {
            centres: Vec4::new(ir.centre[order[0]].x, ir.centre[order[0]].y, ir.centre[order[1]].x, ir.centre[order[1]].y),
            iris: Vec4::new(ir.iris, ir.iris / ir.per_m, 0.0, 0.0),
            ..default()
        };
        let mut shown = [0.0; 2];
        let (mut patches, mut marks) = (0, 0);
        for (k, &s) in order.iter().enumerate() {
            let e = eyes[s];
            // (an eye whose sphincter a blow tore stays wide whatever the other does: traumatic mydriasis)
            shown[k] = ((if e.pupil > 0.0 { e.pupil } else { face.pupil }) / crate::face::MM_IRIS).clamp(0.12, 0.85) * ir.iris;
            // The iris's centre in the world now (only wanted with blood in the chamber).
            let w = if e.blood > 0.005 {
                crate::face::bone_world(person, root, person.body.by_name[if s == 0 { "eye.L" } else { "eye.R" }]).transform_point3(ir.at[s])
            } else {
                Vec3::new(0.0, -1e3, 0.0)
            };
            let layer = if e.blood > 0.95 { 1.05 } else { e.blood * e.settled };
            u.world[k] = w.extend(layer);
            u.state[k] = Vec4::new(e.blood * (1.0 - e.settled) * 0.85, e.collapse, (e.t / 600.0).min(1.0) * if e.blood > 0.9 { 1.0 } else { 0.3 },
                                   (e.red * 64.0).round() / 64.0);
            // (In 64ths: both change a little every frame for minutes, and a new bind group a frame is not worth it.)
            u.iris.z = u.iris.z.max((e.dry * 64.0).round() / 64.0);
            let c = ir.centre[s];
            for p in &e.patches {
                if patches < MOST {
                    let at = if p.iris { c + Vec2::new(p.u, p.v) } else { Vec2::new(p.u, p.v) };
                    u.patches[patches] = Vec4::new(at.x, at.y, p.r, p.dense);
                    patches += 1;
                }
            }
            for m in &e.marks {
                if marks >= MOST {
                    break;
                }
                let at = if m.iris { c + Vec2::new(m.u, m.v) * ir.iris * 1.25 } else { Vec2::new(m.u, m.v) };
                // Its size on the picture, as the TS drew each kind.
                let r = if m.uv {
                    m.size
                } else {
                    match m.kind {
                        "slit" => (m.size * ir.per_m).min(0.12),
                        "pellet" => (m.size * ir.per_m).max(0.006),
                        _ => (m.size * ir.per_m).max(0.05),
                    }
                };
                let kind = match m.kind {
                    "slit" => 2.0,
                    "pellet" => 1.0,
                    _ => 0.0,
                };
                let along = m.along.unwrap_or(Vec2::X);
                u.marks[marks] = Vec4::new(at.x, at.y, r, kind);
                u.along[marks] = Vec4::new(along.x, along.y, m.u * 7.0 + m.v * 13.0, m.u * 11.0 + m.v * 5.0);
                marks += 1;
            }
        }
        u.sizes = Vec4::new(ir.iris, ir.pupil, shown[0], shown[1]);
        u.counts = UVec4::new(patches as u32, marks as u32, 0, 0);
        let Some(m) = materials.get(&drawn.material) else { continue };
        let was = &m.extension.eye;
        // (A pupil changing by under half a percent, or nothing else changing, is not worth a new bind group.)
        let near = |a: f32, b: f32| (a - b).abs() <= 0.005 * b.abs().max(1e-4);
        if near(was.sizes.z, u.sizes.z) && near(was.sizes.w, u.sizes.w) && (EyeUniform { sizes: was.sizes, ..u }) == *was {
            continue;
        }
        if let Some(mut m) = materials.get_mut(&drawn.material) {
            m.extension.eye = u;
        }
    }
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "eye.wesl");
    app.add_plugins(MaterialPlugin::<EyeMaterial>::default())
        .add_systems(Update, own_eyes)
        .add_systems(PostUpdate, draw_eyes);
}
