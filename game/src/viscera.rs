// The belly or chest opened: what is inside seen, and what can come out (src/sandbox/viscera.ts).
//
// An opening is a hole through the body's wall: the skin and the clothes over it are not drawn there (skin.rs's hider),
// its lips show the layers the wall was cut through (marks.rs's lip), and through it the body's own organs are seen, the real ones from the anatomy in their places, each
// in a wet look of its own: the small bowel's pink coils with the fine vessels that run round them, the liver dark and
// glossy, the stomach, the colon, the lungs and the heart behind the ribs, and blood on them where they were hit and
// round the opening. Behind the skin, where no organ is, the body's wall is seen from inside.
//
// Nothing is made to fall out. Behind an opening in the belly lie the organs that are free to move: loops of small
// bowel on their long mesentery, the colon on its shorter one, the stomach held at both ends. Each is a rope of points
// (verlet) of its own width, lying in the belly, held by its attachments, kept in by the wall everywhere but the
// opening. What pushes on them is what pushes on the real ones: the pressure in the belly (the tone of a living wall,
// and the weight of everything above the opening, the belly's contents behaving like a fluid), and, once a part is out,
// its own weight and the body's motion. A part comes through only if the opening is wide enough for it doubled over on
// itself (both ends of a loop stay inside): a gunshot or a short stab cannot let bowel out, a long slash or a wall blown
// open can, and then it slides out, hangs and lies on the body or the floor. What is out can be taken hold of and
// pulled.
//
// What comes out, from the literature on abdominal stab wounds with evisceration: mostly omentum, then small bowel, less
// often colon, and stomach (an 81-patient series: omentum 75 %, small bowel 22 %, colon 2 %, PubMed 10528593; another of
// 61 with organs out: small bowel 59 %, colon 28 %, stomach 13 %). The omentum is not in the anatomy. Intra-abdominal
// pressure in healthy adults (Cobb et al., J Surg Res 2005, bladder pressure): about 2 mmHg lying, 20 standing (most of
// it the weight of the contents), 80 to 100+ coughing or straining.

use std::collections::HashSet;

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::image::{ImageAddressMode, ImageSampler, ImageSamplerDescriptor};
use bevy::light::NotShadowReceiver;
use bevy::math::Affine3A;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, Extent3d, TextureDimension, TextureFormat};
use bevy::shader::ShaderRef;

use crate::anatomy::Anatomy;
use crate::npc::{self, Crossing, Happened, Hurt, Kind};
use crate::person::Person;
use crate::ragdoll::Ragdoll;
use crate::rng::Rng;
use crate::vitals::{Bleed, Side, Vitals};

// A cut must be this deep to go through the abdominal wall (skin, fat, muscle and peritoneum: 2 to 4 cm in a lean man).
pub const WALL: f32 = 0.025;
// Joules a heavy charge must leave in the trunk to blow a hole through its wall, and kPa of a blast to burst it.
pub const BLOWN: f32 = 600.0;
pub const BURST: f32 = 1400.0;
// Joules a missile must leave in the head to burst the skull open (wounds.rs hands it over), and how deep an edge must
// cut to go through scalp and skull (an estimate: 5 to 7 mm of scalp, 6 to 7 of bone, and through the dura).
pub const HEAD_BURSTS: f32 = 300.0;
const SKULL: f32 = 0.04;

const CLOTHES: f32 = 0.04; // m the clothes stand off the body, which what is out lies on
const REACH: f32 = 0.2; // m round an opening within which the organs are drawn, and within which they can come out
const SIDES: usize = 16; // round each rope drawn along it
const SPLIT: usize = 2; // pieces each step of a rope is drawn in, along a smooth curve through its points
const DENSITY: f32 = 1040.0; // kg/m3 of bowel with its contents
const MMHG: f32 = 133.3;
const PACKED: f32 = 10.0; // the packed contents a bit of bowel has to move to come forward, over its own mass

// What can come out: half its width, metres of it free behind the opening, how far its attachments let its middle go
// from where they hold it, and how many.
struct Rope {
    r: f32,
    length: f32,
    tether: f32,
    count: usize,
}

const ROPES: [(&str, Rope); 3] = [
    ("bowel", Rope { r: 0.014, length: 0.6, tether: 0.16, count: 3 }),
    ("colon", Rope { r: 0.024, length: 0.4, tether: 0.07, count: 1 }),
    ("stomach", Rope { r: 0.032, length: 0.26, tether: 0.05, count: 1 }),
];

fn rope(kind: &str) -> &'static Rope {
    &ROPES.iter().find(|r| r.0 == kind).unwrap().1
}

// The look of each kind of thing inside: albedo (sRGB 0-255), how many fine vessels run over it, how mottled it is,
// how much fat lies on it, how rough it is.
fn look(kind: &str) -> ([f32; 3], f32, f32, f32, f32) {
    match kind {
        "bowel" => ([214.0, 132.0, 120.0], 0.7, 0.25, 0.05, 0.32),
        "colon" => ([196.0, 140.0, 118.0], 0.5, 0.35, 0.35, 0.36),
        "stomach" => ([206.0, 140.0, 132.0], 0.8, 0.3, 0.15, 0.34),
        "liver" => ([96.0, 26.0, 20.0], 0.1, 0.5, 0.0, 0.22),
        "gallbladder" => ([84.0, 118.0, 76.0], 0.2, 0.2, 0.0, 0.2),
        "spleen" => ([92.0, 30.0, 46.0], 0.1, 0.4, 0.0, 0.25),
        "pancreas" => ([222.0, 176.0, 132.0], 0.2, 0.8, 0.2, 0.4),
        "kidney" => ([120.0, 40.0, 32.0], 0.1, 0.3, 0.3, 0.25),
        "adrenal" => ([214.0, 160.0, 70.0], 0.0, 0.4, 0.3, 0.35),
        "bladder" => ([222.0, 196.0, 168.0], 0.5, 0.2, 0.1, 0.3),
        "lung" => ([206.0, 140.0, 140.0], 0.2, 0.9, 0.0, 0.3),
        "heart" => ([120.0, 26.0, 24.0], 0.5, 0.3, 0.6, 0.3),
        "airway" => ([220.0, 196.0, 186.0], 0.3, 0.1, 0.0, 0.35),
        "oesophagus" => ([190.0, 110.0, 100.0], 0.3, 0.2, 0.0, 0.35),
        "bone" => ([226.0, 214.0, 188.0], 0.05, 0.2, 0.0, 0.45),
        "cartilage" => ([214.0, 218.0, 212.0], 0.0, 0.1, 0.0, 0.3),
        // Fresh brain: grey matter's pinkish beige under the pia's net of fine red vessels, glistening (the TS showed
        // none: its list left the skull's contents out).
        "brain" => ([196.0, 158.0, 146.0], 0.9, 0.3, 0.0, 0.28),
        _ => ([140.0, 30.0, 26.0], 0.1, 0.3, 0.0, 0.35),
    }
}

// What is drawn through an opening (the brain through an opened skull; not the limbs' bones, nor what lies behind the belly's
// lining at the back: the kidneys and the glands on them).
fn shown(kind: &str, name: &str) -> bool {
    match kind {
        "bone" | "cartilage" => ["rib", "sternum", "vertebra", "sacrum", "hip bone", "costal"].iter().any(|w| name.contains(w)),
        k => ["bowel", "colon", "stomach", "liver", "gallbladder", "spleen", "pancreas", "bladder", "lung", "heart", "muscle", "airway", "oesophagus", "brain"]
            .contains(&k),
    }
}

// --- the looks -----------------------------------------------------------------------------------------------------
//
// Organs have no picture of their own (the anatomy is shapes): their surface is made where it is drawn, from their places
// at rest (organs.wesl), so it stays on them as they move. A corner's place at rest and the blood lying on it there
// (millimetres) are its colour (rgb, a).

#[derive(Asset, AsBindGroup, Reflect, Debug, Clone, Default)]
pub struct Wet {
    // Its colour (linear) and what it is: vessels, mottle, fat, and 1 for an organ (2 the brain, folded; 0: a rope of
    // bowel, its picture its own).
    #[uniform(100)]
    pub base: Vec4,
    #[uniform(100)]
    pub look: Vec4,
}

impl MaterialExtension for Wet {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/organs.wesl".into()
    }
}

pub type WetMaterial = ExtendedMaterial<StandardMaterial, Wet>;

// --- what others call ------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct Opening {
    pub at: Vec3,
    pub normal: Vec3,
    pub ex: Vec3,
    pub owner: usize,
    pub half: [f32; 2],
    // Burst open from inside (a charge's gas, a blast, the skull) rather than cut: its edge torn (`torn`), not a lens.
    pub torn: bool,
}

impl Opening {
    // Where its edge is at `a` radians round it (from `ex` toward the normal crossed with it), in rest space: on the lens
    // a blade's cut gapes into, or on the torn edge of one burst open.
    pub fn edge(&self, a: f32) -> Vec3 {
        let ey = self.normal.cross(self.ex);
        if self.torn {
            let r = oval(self.half, a) * torn(self.at, a);
            return self.at + (self.ex * a.cos() + ey * a.sin()) * r;
        }
        let x = a.cos() * self.half[0];
        self.at + self.ex * x + ey * (a.sin().signum() * gape(self.half, x))
    }
}

impl Opening {
    // Whether a point `x` along it and `y` across it (from its middle, in its plane) is more than `margin` inside its edge.
    pub fn inside(&self, x: f32, y: f32, margin: f32) -> bool {
        if self.torn {
            let a = y.atan2(x);
            return x.hypot(y) < oval(self.half, a) * torn(self.at, a) - margin;
        }
        y.abs() < gape(self.half, x) - margin
    }
}

// The radius of an oval `half` across at `a` radians from its long way.
pub fn oval(half: [f32; 2], a: f32) -> f32 {
    1.0 / ((a.cos() / half[0]).powi(2) + (a.sin() / half[1]).powi(2)).sqrt()
}

// How far out the edge of a wound burst open from inside reaches at `a` radians round it, over its oval, the opening
// at rest point `at`. Skin burst by gas or a blast does not part along a line: it splits where it is stretched most,
// into a ragged, scalloped hole with short tears running out of it, the larger over bone (DiMaio: contact shotgun
// wounds' seared, ragged edges; the stellate splits of contact wounds over the skull). A few lobes, each its own size,
// and three or four tears, from a seed of where it is. skin.wesl `torn` is this, to the digit: the skin's hole and the
// wall's edge (wall.rs) are the same line.
pub fn torn(at: Vec3, a: f32) -> f32 {
    let s = (at.x * 137.1 + at.y * 311.7 + at.z * 74.7).rem_euclid(1.0) * std::f32::consts::TAU;
    let tear = (4.0 * a + 3.3 * s).sin().max(0.0).powi(6) + 0.6 * (3.0 * a + 5.1 * s).sin().max(0.0).powi(8);
    1.0 + 0.14 * (3.0 * a + s).sin() + 0.09 * (5.0 * a + 2.3 * s).sin() + 0.06 * (8.0 * a + 4.1 * s).sin() + 0.04 * (13.0 * a + 1.7 * s).sin() + 0.45 * tear
}

// Half the width of an opening `half` metres ([half its length, half its width at most]) at `x` metres along it from
// its middle. A cut through skin gapes as the skin either side is pulled apart by its tension, most at the middle and
// closing to its ends (dev/research/tissue-mechanics.md, wounds.md: a cut across Langer's lines gapes into an ellipse);
// a hole as wide as it is long is round. flesh.rs's Lens draws the same shape.
pub fn gape(half: [f32; 2], x: f32) -> f32 {
    let along = (x.abs() / half[0]).min(1.0);
    let lens = 0.5 + 0.5 * ((half[0] / half[1] - 1.0) * 0.5).clamp(0.0, 1.0);
    half[1] * (1.0 - along * along).max(0.0).powf(lens)
}

fn tangent(n: Vec3) -> Vec3 {
    let hint = if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::NEG_Z };
    (hint - n * hint.dot(n)).normalize()
}

fn box_distance(lo: Vec3, hi: Vec3, p: Vec3) -> f32 {
    (lo - p).max(Vec3::ZERO).max(p - hi).length()
}

// The region a world point is on that can be opened: the belly (and pelvis), the chest, the vault of the skull, or None.
fn region(world: &World, who: Entity, point: Vec3) -> Option<&'static str> {
    let rd = world.get::<Ragdoll>(who)?;
    match rd.segs[rd.nearest(point).0].def.name.as_str() {
        "belly" | "pelvis" => Some("belly"),
        "chest" => Some("chest"),
        "head" if cranium(world, who, point) => Some("head"),
        _ => None,
    }
}

// Whether a world point on the head is over the brain: the forehead above the brows, the crown, the temples and the
// back of the head above the skull's base (not the face, the jaw or the neck, which the head's segment also carries).
fn cranium(world: &World, who: Entity, point: Vec3) -> bool {
    let (Some(person), Some(root)) = (world.get::<Person>(who), world.get::<Transform>(who)) else { return false };
    let b = &person.body;
    let (Some(&head), Some(&eye)) = (b.by_name.get("head"), b.by_name.get("eye.L")) else { return false };
    let p = crate::face::bone_world(person, root, head).inverse().transform_point3(point);
    let (e, base) = (b.bones[eye].head, b.bones[head].head);
    // (+z is back here.)
    p.y > e.y + 0.012 || (p.y > base.y + 0.01 && p.z > e.z + 0.025)
}

// A crossing's point in the world, worked out if it was found at rest.
fn placed(world: &mut World, who: Entity, hit: &Crossing) -> Crossing {
    if hit.point != Vec3::ZERO {
        return hit.clone();
    }
    let at = npc::with(world, who, |npc| npc.world_of(hit.rest, hit.owner, None).0).unwrap_or(Vec3::ZERO);
    Crossing { point: at, ..hit.clone() }
}

// A blade drawn across person `who` through skin crossings `hits`, `deep` metres into the flesh (npc.slash): a long
// enough cut through the wall of the belly or chest opens it.
pub fn slashed(world: &mut World, who: Entity, hits: &[Crossing], deep: f32) -> bool {
    if deep < WALL {
        return false;
    }
    let placed_hits: Vec<Crossing> = hits.iter().filter(|h| h.kind == Kind::Skin).map(|h| placed(world, who, h)).collect();
    // (Through the scalp and the skull's 6 or 7 mm of bone into the brain takes a heavy edge: a sword's cleaves it, as
    // the cut skulls of old battlefields show; a knife's does not get there.)
    let skin: Vec<Crossing> = placed_hits.into_iter().filter(|h| region(world, who, h.point).is_some_and(|r| r != "head" || deep >= SKULL)).collect();
    if skin.len() < 2 {
        return false;
    }
    let length: f32 = skin.windows(2).map(|w| w[0].rest.distance(w[1].rest).min(0.15)).sum();
    if length < 0.06 {
        return false;
    }
    let mid = skin[skin.len() / 2].clone();
    let along = (skin[skin.len() - 1].point - skin[0].point).normalize();
    // A cut through the wall gapes: the muscles either side pull it open, more the longer it is. A cleft in the skull
    // hardly does (the bone holds; only the scalp over it draws back a little).
    let gapes = if region(world, who, mid.point) == Some("head") { (0.008 + length * 0.04).min(0.016) } else { (0.01 + length * 0.28).min(0.06) };
    open(world, who, &mid, along, length, gapes, false).is_some()
}

// A heavy charge (a shotgun's at contact range) `calibre` metres across that left `spent` joules in person `who`, in at
// skin crossing `hit`. The hole it blows through the wall is about as wide as the charge was, wider the more it spent:
// 2 to 4 cm at contact to 30 cm (DiMaio, dev/research/wounds.md 5.1), the wad and the gas tearing the edge.
pub fn blown(world: &mut World, who: Entity, hit: &Crossing, spent: f32, calibre: f32) -> bool {
    let Some(at) = region(world, who, hit.point) else { return false };
    if at == "head" {
        return burst_skull(world, who, hit, spent);
    }
    if spent < BLOWN * 0.5 {
        return false;
    }
    let r = (calibre / 2.0) * (1.0 + 0.6 * (spent / (BLOWN * 2.0)).min(1.0));
    let d = world.resource_scope(|_, mut rng: Mut<Rng>| Vec3::new(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5));
    open(world, who, hit, d, r * 2.0, r * 2.0, true).is_some()
}

// The skull is a closed box full of brain and blood, which do not compress: what a missile spends inside it, the
// cavity its passage opens, has nowhere to go but out through the bone. A pistol bullet leaves a hole in and a hole out
// with cracks running from them; a rifle bullet's (over 600 m/s) or a contact shotgun's bursts the vault apart from the
// inside, the scalp torn in flaps and the brain thrown out of the gap (DiMaio, Gunshot Wounds, ch. on the head: the
// "explosive" wound of high-velocity rifles; contact shotgun wounds of the head "grossly mutilating"). `spent` J left in
// the head, burst out at skin crossing `hit`: the gap the wider the more it spent (an estimate: 3 cm across for the
// least that bursts it, up to 9).
fn burst_skull(world: &mut World, who: Entity, hit: &Crossing, spent: f32) -> bool {
    if spent < HEAD_BURSTS {
        return false;
    }
    let k = ((spent - HEAD_BURSTS) / 1200.0).clamp(0.0, 1.0);
    let d = world.resource_scope(|_, mut rng: Mut<Rng>| Vec3::new(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5));
    open(world, who, hit, d, 0.03 + 0.06 * k, 0.025 + 0.035 * k, true).is_some()
}

// A blast whose peak overpressure at person `who`'s belly was `kpa`, from world point `from`: close enough, it tears the
// wall open, wider the closer it was.
pub fn burst(world: &mut World, who: Entity, from: Vec3, kpa: f32) -> bool {
    if kpa < BURST * 0.6 {
        return false;
    }
    let Some(at) = world.get::<Ragdoll>(who).map(|rd| rd.middle(rd.by_name("belly"))) else { return false };
    let dir = (at - from).normalize();
    let Some(hit) = npc::with(world, who, |npc| npc.surface(at - dir * 0.4, dir, 0.5, false).into_iter().find(|h| h.kind == Kind::Skin)).flatten() else { return false };
    let k = (kpa / BURST).min(1.6);
    open(world, who, &hit, Vec3::Y, 0.12 * k, 0.07 * k, true).is_some()
}

// An organ `part` (the file's) wounded at world point `at` by a missile `wide` metres across its channel: blood on it
// there, seen when the body is open (wounds.rs hands it over as `Happened::Bled`).
fn bled(v: &mut Viscera, rest: Vec3, wide: f32) {
    if v.spots.len() >= 96 {
        return;
    }
    v.spots.push((rest, 0.02 + wide * 1.5));
    v.stale = true;
}

// How many openings person `who` has, and opening `k`'s middle in the world and which way its skin faces (for checks).
pub fn openings(world: &mut World, who: Entity) -> usize {
    world.get::<Viscera>(who).map_or(0, |v| v.openings.len())
}

pub fn opening_world(world: &mut World, who: Entity, k: usize) -> Option<(Vec3, Vec3)> {
    let o = *world.get::<Viscera>(who)?.openings.get(k)?;
    npc::with(world, who, |npc| {
        let (at, n) = npc.world_of(o.at, o.owner, Some(o.normal));
        (at, n.unwrap())
    })
}

// What of an organ came out that is nearest the line from `origin` along unit `dir`, within `far`, on anyone: something
// to take hold of with `pull`, or None. (Out of the body, or in the opening itself: a hand can reach that.)
pub fn pick<'a>(people: impl Iterator<Item = (Entity, &'a Viscera)>, origin: Vec3, dir: Vec3, far: f32) -> Option<Held> {
    let mut best: Option<(Held, f32)> = None;
    for (e, v) in people {
        for (li, l) in v.loops.iter().enumerate() {
            for i in 2..l.count.saturating_sub(2) {
                if !l.out[i] && !l.passing[i] {
                    continue;
                }
                let p = l.p[i];
                let t = (p - origin).dot(dir);
                if t < 0.0 || t > far {
                    continue;
                }
                if (origin + dir * t).distance(p) < l.r * 2.2 && best.as_ref().is_none_or(|b| t < b.1) {
                    best = Some((Held { who: e, rope: li, index: i, distance: t }, t));
                }
            }
        }
    }
    best.map(|b| b.0)
}

#[derive(Clone, Copy, Debug)]
pub struct Held {
    pub who: Entity,
    pub rope: usize,
    pub index: usize,
    // How far from the eye it was taken hold of.
    pub distance: f32,
}

// Pull what pick() found toward world point `to` (None: let go): as a hand holding it would, and more of it comes out
// after it.
pub fn pull(v: &mut Viscera, held: Held, to: Option<Vec3>) {
    if let Some(l) = v.loops.get_mut(held.rope) {
        l.hold = to.map(|to| (held.index, to));
    }
}

// --- one person's insides ----------------------------------------------------------------------------------------------

#[derive(Component, Default)]
pub struct Viscera {
    pub openings: Vec<Opening>,
    pub loops: Vec<Loop>,
    walls: Vec<Entity>,
    // The organs near any opening: one mesh a kind (entity, mesh), and each lung corner's place at rest, its root and
    // which side (to fall in toward it).
    organs: Vec<(String, Entity, Handle<Mesh>)>,
    lungs: Vec<(String, Vec<(usize, Vec3, Vec3, u8)>)>,
    fallen: [f32; 2],
    // Where a missile or a blade went through an organ (rest), and how far the blood on it reaches.
    spots: Vec<(Vec3, f32)>,
    stale: bool,
    drip: f32,
    told: HashSet<String>,
}

impl Viscera {
    // Millimetres of blood lying on the organs at rest point p: round each opening, where the wall's vessels bleed into
    // the belly and the blood wells up through it, and round each place a missile or a blade went through an organ; in
    // patches, thinning out from the middle.
    fn blood_at(&self, p: Vec3) -> f32 {
        let mut mm: f32 = 0.0;
        for o in &self.openings {
            let (d, r) = (p.distance(o.at), o.half[0] + 0.06);
            if d < r {
                mm = mm.max(0.04 * (1.0 - d / r));
            }
        }
        for &(at, r) in &self.spots {
            let d = p.distance(at);
            if d < r {
                mm = mm.max(0.25 * (1.0 - (d / r).powi(2)));
            }
        }
        if mm == 0.0 {
            return 0.0;
        }
        let patch = 0.5 + 0.5 * (p.x * 160.0 + (p.y * 110.0).sin() * 2.0).sin() * (p.z * 140.0 + p.y * 90.0).sin();
        mm * (0.3 + 0.7 * patch)
    }
}

// An opening through the wall of person `who`'s belly or chest at skin crossing `hit`, running along world direction
// `along`, `length` by `width` metres. None if `hit` is not on the trunk.
pub fn open(world: &mut World, who: Entity, hit: &Crossing, along: Vec3, length: f32, width: f32, torn: bool) -> Option<Opening> {
    if hit.kind != Kind::Skin {
        return None;
    }
    let hit = placed(world, who, hit);
    let place = region(world, who, hit.point)?;
    let chest = place == "chest";
    let started = std::time::Instant::now();
    if world.get::<Viscera>(who).is_none() {
        world.entity_mut(who).insert(Viscera::default());
    }
    // Rest space: the opening's middle, which way it runs, which way the skin faces.
    let to_rest = npc::with(world, who, |npc| npc.rest_to_world(hit.owner).inverse())?;
    let n = hit.rest_normal;
    let mut ex = to_rest.transform_vector3(along);
    ex -= n * ex.dot(n);
    ex = if ex.length_squared() > 1e-8 { ex.normalize() } else { tangent(n) };
    let half = [(length / 2.0).max(width / 2.0), width / 2.0];
    let o = Opening { at: hit.rest, normal: n, ex, owner: hit.owner, half, torn };
    // The wall: no skin there, nor the clothes over it, which are torn a little wider; the skin under the clothes shown
    // round it; seen through, the body's inside (skin.rs's hider).
    if let Some(mut sk) = world.get_mut::<crate::skin::Skin>(who) {
        use crate::hider::Opening as Hole;
        // (A torn one's width given as less than nothing: skin.wesl draws its edge as `torn`; the cloth over it a frayed
        // round hole as wide.)
        if torn {
            sk.skin_hole(&Hole { at: o.at, ex, ey: n, half: [half[0], -half[1]] });
            sk.cloth_hole(&Hole { at: o.at, ex, ey: n, half: [half[0] * 1.25 + 0.006, -1.0] });
        } else {
            sk.skin_hole(&Hole { at: o.at, ex, ey: n, half });
            sk.cloth_hole(&Hole { at: o.at, ex, ey: n, half: [half[0] * 1.1 + 0.005, half[1] * 1.15 + 0.004] });
        }
        sk.window(o.at, n, half[0] + 0.015, 0.05);
    }
    let edge = lips(world, who, &o);
    let v_open = {
        let mut v = world.get_mut::<Viscera>(who).unwrap();
        v.openings.push(o);
        v.stale = true;
        v.openings.len()
    };
    // The wall's own thickness round it, every layer cut (wall.rs).
    let wall = crate::wall::build(world, who, &o, &edge, place);
    if let Some(e) = wall {
        world.get_mut::<Viscera>(who).unwrap().walls.push(e);
    }
    // What it does: the wall's own vessels bleed, and the chest open, the lung falls in.
    let at = npc::with(world, who, |npc| {
        let v = &mut *npc.vitals;
        v.pain = (v.pain + 0.5).min(1.0);
        if place == "head" {
            // The torn scalp bleeds as the scalp does (wounds.rs), and the brain under it, out through the gap.
            v.bleed(Bleed::new("scalp", 0.002 + length * 0.02).clots(0.004).mark(Some(hit.clone())));
            v.bleed(Bleed::new("brain", 0.001 + length * 0.01).clots(0.004).mark(Some(hit.clone())));
            v.brain_damage = (v.brain_damage + 0.4).min(1.0);
            v.injure("Skull opened: the brain showing", 10.0);
        } else {
            v.bleed(Bleed::new(if chest { "chest wall" } else { "abdominal wall" }, 0.0008 + length * 0.006).clots(0.006).mark(Some(hit.clone())));
        }
        if chest {
            // Air drawn in through the hole as the chest rises: the lung on that side falls in (a sucking chest wound).
            // (The person's right is +x at rest.)
            v.lungs.leak(if o.at.x > 0.0 { Side::R } else { Side::L });
            v.injure("Chest wall opened: air sucked in, the lung collapsing", 8.0);
        } else if place == "belly" {
            v.injure("Belly opened: organs showing", 7.0);
        }
        let at = npc.world_of(o.at, o.owner, None).0;
        npc.sound("wet", Some(at), 0.8);
        at
    })?;
    if place == "belly" {
        behind(world, who, &o);
    }
    if world.contains_resource::<crate::scenario::Log>() {
        let ms = started.elapsed().as_secs_f32() * 1000.0;
        crate::scenario::log(world, serde_json::json!({ "event": "opened", "region": place, "half": half, "openings": v_open, "at": at.to_array(), "ms": ms }));
    }
    Some(o)
}

// The lips of the opening: the skin's crossings all round its edge (the lens flesh.rs cuts), for the layers of the wall
// it went through to be drawn on them, in a band wider the wider it gapes (marks.rs). (Each point of the edge found on
// the skin by a line in from outside along the skin's facing: the edge laid flat across a curved belly stands off it,
// nearer the clothes than the skin, and the nearest point then finds cloth.)
fn lips(world: &mut World, who: Entity, o: &Opening) -> Vec<Option<Crossing>> {
    let all: Vec<Option<Crossing>> = npc::with(world, who, |npc| {
        (0..40)
            .map(|k| {
                let rest = o.edge(k as f32 / 40.0 * std::f32::consts::TAU);
                let (w, n) = npc.world_of(rest, o.owner, Some(o.normal));
                let n = n.unwrap();
                npc.surface(w + n * 0.1, -n, 0.2, false).into_iter().find(|h| h.kind == Kind::Skin)
            })
            .collect()
    })
    .unwrap_or_default();
    let edge: Vec<Crossing> = all.iter().flatten().cloned().collect();
    if edge.len() > 2 {
        world.resource_scope(|world, mut rng: Mut<Rng>| {
            if let Some(mut sk) = world.get_mut::<crate::skin::Skin>(who) {
                // (Burst from inside, the skin is torn back to its edge, the wall undermined under it, not cut down
                // through in a slope: no band of the layers round it, only the raw edge.)
                let wide = if o.torn { 0.0025 } else { (0.006 + o.half[1] * 0.25).min(0.015) };
                sk.lip(&edge, wide, 0.014, &mut rng);
            }
        });
    }
    all
}

// --- what can come out ------------------------------------------------------------------------------------------------

// The free organs that lie behind opening `o` (within reach of it in the anatomy): each as a rope in its place, its ends
// where its attachments hold it, a little deeper than the wall, all of it inside to begin with.
fn behind(world: &mut World, who: Entity, o: &Opening) {
    if world.get::<Viscera>(who).is_some_and(|v| v.loops.len() >= 6) {
        return;
    }
    let traced = world.get::<Hurt>(who).unwrap().traced.clone();
    let worlds = npc::with(world, who, |npc| npc.bone_worlds()).unwrap();
    for (kind, spec) in ROPES.iter() {
        // The nearest of that organ to the opening; none near, nothing of it behind.
        let mut best = REACH;
        let mut near = None;
        for part in traced.parts.iter().filter(|p| p.kind == *kind) {
            for c in &part.clusters {
                let d = box_distance(c.lo, c.hi, o.at);
                if d < best {
                    best = d;
                    near = Some((c.lo + c.hi) * 0.5);
                }
            }
        }
        let Some(near) = near else { continue };
        // (Already one of these from an opening close by: the same organ.)
        if world.get::<Viscera>(who).unwrap().loops.iter().any(|l| l.kind == *kind && l.o.at.distance(o.at) < 0.12) {
            continue;
        }
        let ey = o.normal.cross(o.ex);
        let toward = near - o.at;
        let depth = (-(WALL + spec.r * 2.0 + 0.02)).min(toward.dot(o.normal).max(-0.12));
        for k in 0..spec.count {
            // Side by side behind the opening, shifted a little toward where the organ lies.
            let s = (k as f32 - (spec.count as f32 - 1.0) / 2.0) * spec.r * 2.6;
            let (r1, r2) = world.resource_scope(|_, mut rng: Mut<Rng>| (rng.next(), rng.next()));
            let root = o.at + o.normal * depth + o.ex * (toward.dot(o.ex) * 0.3 + (r1 - 0.5) * 0.02) + ey * (toward.dot(ey) * 0.3 + s);
            let gap = spec.r * (1.5 + r2);
            let l = world.resource_scope(|_, mut rng: Mut<Rng>| Loop::new(o, kind, root - o.ex * gap, root + o.ex * gap, worlds[o.owner], &mut rng));
            world.get_mut::<Viscera>(who).unwrap().loops.push(l);
        }
    }
}

pub struct Loop {
    pub o: Opening,
    pub kind: &'static str,
    pub r: f32,
    tether: f32,
    ends: [Vec3; 2],
    pub count: usize,
    rest: f32,
    pub p: Vec<Vec3>,
    q: Vec<Vec3>,
    pub out: Vec<bool>,
    pub passing: Vec<bool>,
    // Where it can be seen: out, in the opening, or behind it within sight through it. The rest of it is drawn as
    // nothing: it lies in the cavity, which is drawn rounder than the belly (its capsules), and stood out through the
    // flank and the shirt where the skin is nearer.
    seen: Vec<bool>,
    // Millimetres of blood on it, at each point: none until it comes through the wound.
    gore: Vec<f32>,
    pub came: bool,
    pub hold: Option<(usize, Vec3)>,
    reach: Vec<f32>,
    bloody: bool,
    drawn: Vec<Vec3>,
    along: f32,
    mesh: Option<(Entity, Handle<Mesh>)>,
}

impl Loop {
    // A rope of organ `kind` behind opening `o`, its ends held at rest points `a` and `b` (inside the belly); `world` the
    // opening's bone's matrix from rest to the world now.
    fn new(o: &Opening, kind: &'static str, a: Vec3, b: Vec3, world: Affine3A, rng: &mut Rng) -> Loop {
        let spec = rope(kind);
        let rest = spec.r.max(0.015);
        let n = (spec.length / rest).round() as usize + 1;
        // (How far each point's attachments let it go, a little more or less here and there.)
        let reach = (0..n).map(|i| {
            let (x, y) = (rng.next(), rng.next());
            0.75 + 0.5 * (0.5 + 0.5 * (i as f32 * 0.9 + x * 6.0).sin()) * y
        }).collect();
        // It starts where it lies: from one end to the other in folds behind the wall, none of it through.
        let ey = o.normal.cross(o.ex);
        let wall = -(WALL + spec.r * 1.5);
        let lift = wall - ((a + b) * 0.5 - o.at).dot(o.normal);
        let p: Vec<Vec3> = (0..n)
            .map(|i| {
                let t = i as f32 / (n - 1) as f32;
                let s = (t * std::f32::consts::PI).sin();
                world.transform_point3(a.lerp(b, t) + o.normal * (lift * s) + ey * ((t * std::f32::consts::PI * 4.0).sin() * 0.035 * s))
            })
            .collect();
        Loop {
            o: *o, kind, r: spec.r, tether: spec.tether, ends: [a, b], count: n, rest, q: p.clone(), p, out: vec![false; n], passing: vec![false; n], seen: vec![false; n],
            gore: vec![0.0; n], came: false, hold: None, reach, bloody: true, drawn: vec![Vec3::NAN; n],
            // (The picture's length runs 0.12 to a step of a small bowel's points: the same size on a wider one.)
            along: 0.12 * (rest / 0.015) * (0.014 / spec.r), mesh: None,
        }
    }

    // The lowest point of it that is out.
    fn lowest(&self) -> Option<Vec3> {
        (1..self.count - 1).filter(|&i| self.out[i]).map(|i| self.p[i]).min_by(|a, b| a.y.total_cmp(&b.y))
    }

    // `tone` pascals of pressure in the belly from its wall; `top` the height (world y) of the top of the cavity; `opening`
    // the opening's bone's matrix now.
    #[allow(clippy::too_many_arguments)]
    fn step(&mut self, dt: f32, bodies: &[(Vec3, Vec3, f32)], cavity: &[(Vec3, Vec3, f32)], tone: f32, top: f32, bone: Affine3A, rng: &mut Rng) {
        let n = self.count;
        let r = self.r;
        let o = self.o;
        // The opening as it is now: its middle, the way the skin faces, the way it runs and across it.
        let f = bone.transform_point3(o.at);
        let nn = bone.transform_vector3(o.normal).normalize();
        let mut e = bone.transform_point3(o.at + o.ex) - f;
        e = (e - nn * e.dot(nn)).normalize();
        let y = nn.cross(e);
        // A loop squeezes a little: through anything wider than seven tenths of itself.
        let squeeze = r * 0.7;
        // The pressure pushing it out where it presses on the opening: the tone and the weight of what lies above, and as
        // acceleration of the bit of it in the opening (its area across over its mass, and the mass of the packed contents
        // it has to move aside to get there, some ten times its own).
        let pressure = tone + DENSITY * 9.81 * (top - f.y).clamp(0.0, 0.3);
        let push = (2.0 * pressure) / (std::f32::consts::PI * r * DENSITY) / PACKED;
        // The belly fuller than the capsules it is drawn round: the cavity reaches the wall at the opening.
        let mut fuller = f32::INFINITY;
        for c in cavity {
            fuller = fuller.min(dist(f, c) - c.2);
        }
        let fuller = fuller.clamp(0.0, 0.05);
        let bodies: Vec<(Vec3, Vec3, f32)> = bodies.iter().copied().filter(|c| dist(f, c) < self.tether + 0.25 + c.2).collect();
        let h = dt.min(1.0 / 30.0);
        let g = -9.81 * h * h;
        // Inside it is packed among the rest, which hold it up and slow it (no weight of its own there: the belly's
        // contents bear it as a fluid would); out, it falls and swings, a little slowed by the air and its own give.
        let (keep_in, keep_out, keep_passing) = ((-60.0 * h).exp(), (-0.9 * h).exp(), (-40.0 * h).exp());
        // (What lies over the opening, inside, has the belly's pressure behind it and none in front: it is pressed into
        // the opening, and through it if it fits.)
        let over = o.half[0] + r * 2.0;
        for i in 1..n - 1 {
            let keep = if self.out[i] { keep_out } else if self.passing[i] { keep_passing } else { keep_in };
            let mut along = 0.0;
            if self.passing[i] {
                along = push * h * h;
            } else if !self.out[i] {
                let d = self.p[i] - f;
                let l = d - nn * d.dot(nn);
                if l.length_squared() < over * over {
                    along = push * h * h;
                }
            }
            let now = self.p[i];
            let vel = (now - self.q[i]) * keep;
            self.q[i] = now;
            self.p[i] = now + vel + if self.out[i] { Vec3::Y * g } else { Vec3::ZERO } + nn * along;
        }
        // A hand pulling on it draws more after it, out of the belly: what holds it gives, as far as there is more of it
        // behind (the small bowel is metres long; its mesentery folds out as it is pulled).
        if let Some((k, to)) = self.hold {
            if self.p[k].distance(to) > 0.03 {
                let spec = rope(self.kind);
                let base = spec.r.max(0.015);
                self.tether = (spec.tether * 3.0).min(self.tether + h * 0.3);
                // (The rope stands for the part free behind the opening: more of it, its points further apart.)
                self.rest = (base * 2.5).min(self.rest + h * base * 0.8);
            }
        }
        self.p[0] = bone.transform_point3(self.ends[0]);
        self.p[n - 1] = bone.transform_point3(self.ends[1]);
        let rest = self.rest;
        for _ in 0..6 {
            for i in 0..n - 1 {
                let d = self.p[i + 1] - self.p[i];
                let l = d.length().max(1e-6);
                let diff = (l - rest) / l * 0.5;
                let (fa, fb) = (if i == 0 { 0.0 } else { 1.0 }, if i + 1 == n - 1 { 0.0 } else { 1.0 });
                let sum = if fa + fb == 0.0 { 1.0 } else { fa + fb };
                self.p[i] += d * diff * 2.0 * fa / sum;
                self.p[i + 1] -= d * diff * 2.0 * fb / sum;
            }
            // It does not fold flat on itself: points two apart are kept most of its width apart (it bends, it is not
            // stiff: nothing else holds it straight).
            for i in 0..n - 2 {
                let d = self.p[i + 2] - self.p[i];
                let l = d.length().max(1e-6);
                if l >= r * 1.6 {
                    continue;
                }
                let s = (r * 1.6 - l) / l * 0.25;
                if i > 0 {
                    self.p[i] -= d * s;
                }
                if i + 2 < n - 1 {
                    self.p[i + 2] += d * s;
                }
            }
            if let Some((k, to)) = self.hold {
                let at = self.p[k];
                self.p[k] = at + (to - at) * 0.5;
            }
            // Held by its attachments: no point gets further from where they hold it than they reach (most at its middle),
            // so a long loop hangs in folds, not as a cord.
            let root = (self.p[0] + self.p[n - 1]) * 0.5;
            for i in 1..n - 1 {
                let most = (0.06 + self.tether * (i as f32 / (n - 1) as f32 * std::f32::consts::PI).sin()) * self.reach[i];
                let d = self.p[i] - root;
                if d.length() > most {
                    self.p[i] = root + d * (most / d.length());
                }
            }
            // The wall: it is in the belly or out of it, and goes from one to the other only through the opening.
            for i in 1..n - 1 {
                let d = self.p[i] - f;
                let (hn, x, yy) = (d.dot(nn), d.dot(e), d.dot(y));
                let through = o.inside(x, yy, squeeze);
                let held = self.hold.is_some_and(|h| h.0 == i);
                self.passing[i] = through && hn > -(WALL + r * 3.0) && hn < r * 2.0;
                if !self.out[i] {
                    if through && hn > r * 0.5 {
                        self.out[i] = true;
                        self.gore[i] = self.gore[i].max(0.004 + rng.next() * 0.025);
                        self.bloody = true;
                        continue;
                    }
                    // Behind the wall where it is whole (the plane of the skin there, far enough round the opening).
                    if !through && !held && hn > -(WALL + r) && x.abs() < o.half[0] + 0.15 && yy.abs() < o.half[0] + 0.15 {
                        self.p[i] -= nn * (hn + WALL + r);
                    }
                    // And in the cavity, not through the back or the sides.
                    if !self.passing[i] {
                        let mut best = None;
                        let mut over = f32::INFINITY;
                        for c in cavity {
                            let ex = dist(self.p[i], c) - (c.2 + fuller - WALL - r);
                            if ex < over {
                                over = ex;
                                best = Some(c);
                            }
                        }
                        if let (Some(c), true) = (best, over > 0.0) {
                            let near = nearest(self.p[i], c);
                            let dd = over + c.2 + fuller - WALL - r;
                            let s = (dd - over) / dd;
                            self.p[i] = near + (self.p[i] - near) * s;
                        }
                    }
                } else {
                    if through && hn < -(WALL + r) {
                        self.out[i] = false;
                        continue;
                    }
                    // Lying on the skin round the opening, or on the clothes further off. (In the hole torn in the clothes
                    // over the opening it lies on the skin; further off, on the clothes, which it lifts and pushes aside
                    // near the hole.)
                    let lie = r + CLOTHES * ((yy.abs() - gape(o.half, x)).max(x.abs() - o.half[0]).max(0.0) / 0.1).min(1.0);
                    if !through && !held && hn < lie && x.abs() < o.half[0] + 0.15 && yy.abs() < o.half[0] + 0.15 {
                        self.p[i] += nn * (lie - hn);
                    }
                }
            }
            // The floor, and the rest of the body, which what is out lies on and slides off.
            for i in 1..n - 1 {
                if !self.out[i] {
                    continue;
                }
                if self.p[i].y < r {
                    self.p[i].y = r;
                    let (px, pz) = (self.p[i].x, self.p[i].z);
                    self.q[i].x = px - (px - self.q[i].x) * 0.6;
                    self.q[i].z = pz - (pz - self.q[i].z) * 0.6;
                }
                if self.passing[i] {
                    continue;
                }
                for c in &bodies {
                    let rr = c.2 + r * 0.8;
                    let near = nearest(self.p[i], c);
                    let d = self.p[i] - near;
                    let d2 = d.length_squared();
                    if d2 >= rr * rr || d2 < 1e-12 {
                        continue;
                    }
                    let l = d2.sqrt();
                    self.p[i] += d * ((rr - l) / l);
                }
            }
        }
        let wide = o.half[0].max(o.half[1]) * 1.3 + 0.01;
        for i in 0..n {
            let d = self.p[i] - f;
            let behind = -d.dot(nn);
            self.seen[i] = self.out[i] || self.passing[i] || (d + nn * behind).length() < wide + behind.max(0.0) * 0.5;
        }
        // Out for good once a part of it is clear of the wall.
        if !self.came {
            self.came = (1..n - 1).any(|i| self.out[i] && (self.p[i] - f).dot(nn) > r * 2.5);
        }
    }

    // Its tube, drawn along a smooth curve through its points (Catmull and Rom), in the world.
    fn draw(&mut self) -> Option<Mesh> {
        let n = self.count;
        if !self.bloody && self.p == self.drawn {
            return None;
        }
        self.drawn.clone_from(&self.p);
        let rings = (n - 1) * SPLIT + 1;
        let mut line = vec![Vec3::ZERO; rings];
        for i in 0..n - 1 {
            let (i0, i2, i3) = (i.saturating_sub(1), i + 1, (i + 2).min(n - 1));
            for k in 0..SPLIT {
                let t = k as f32 / SPLIT as f32;
                let (t2, t3) = (t * t, t * t * t);
                let (a, b, c, d) = (self.p[i0], self.p[i], self.p[i2], self.p[i3]);
                line[i * SPLIT + k] = 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * b - a - 3.0 * c + d) * t3);
            }
        }
        line[rings - 1] = self.p[n - 1];
        // A frame carried along it, its first axis turned toward where its attachments hold it (the middle of its two ends):
        // the side its mesentery meets it (v = 0 of its picture) faces that way, as it does on a real loop. (Carried on from
        // the last ring where that way is along it.)
        let root = (self.p[0] + self.p[n - 1]) * 0.5;
        let step = self.rest / SPLIT as f32;
        let r = self.r;
        let mut u = Vec3::Y;
        let mut pos = Vec::with_capacity(rings * SIDES);
        let mut uv = Vec::with_capacity(rings * SIDES);
        for i in 0..rings {
            let (a, b) = (i.saturating_sub(1), (i + 1).min(rings - 1));
            let x = line[i];
            let t = (line[b] - line[a]).normalize_or(Vec3::X);
            let mut hdir = root - x;
            hdir -= t * hdir.dot(t);
            if hdir.length() > 0.01 {
                u = hdir.normalize();
            }
            u -= t * u.dot(t);
            if u.length() < 1e-3 {
                u = if t.y.abs() < 0.9 { Vec3::Y } else { Vec3::X };
                u -= t * u.dot(t);
            }
            u = u.normalize();
            let w = t.cross(u);
            // Where it bends, its inner side is pressed together into soft creases and its outer side drawn smooth.
            let (a1, b1) = (i.saturating_sub(2), (i + 2).min(rings - 1));
            let span = ((b1 - a1) as f32 / 2.0) * step;
            let span = if span == 0.0 { 1.0 } else { span };
            let cv = line[a1] + line[b1] - 2.0 * x;
            let cl = if cv.length() == 0.0 { 1.0 } else { cv.length() };
            let fold = ((cl / (span * span)) * r * 1.5).min(1.0);
            let cdir = cv / cl;
            // Wider and narrower along its length, as a bowel with its contents in it is.
            let fi = i as f32 / SPLIT as f32;
            let along = fi * self.along;
            let shown = if self.seen[(i + SPLIT / 2) / SPLIT] { 1.0 } else { 0.0 };
            let rr = r * (0.88 + 0.16 * (fi * 1.7 + 0.6).sin() * (fi * 0.53 + 1.3).sin()) * shown;
            // The colon gathered into haustra between creases (six to its picture's length, where it paints them).
            let haustra = if self.kind == "colon" { 0.84 + 0.16 * (std::f32::consts::PI * ((along * 6.0) % 1.0)).sin().max(0.0).powf(0.6) } else { 1.0 };
            for s in 0..SIDES {
                let ang = s as f32 / (SIDES - 1) as f32 * std::f32::consts::TAU;
                let (c, sn) = (ang.cos(), ang.sin());
                let nv = u * c + w * sn;
                let mut k = haustra;
                // The mesentery's fat along the side it holds: a soft ridge (the colon's mesocolon less, the stomach's
                // omentum more), and the colon's taeniae, flat bands drawing it in a third of the way round each.
                let toward = c.max(0.0).powi(8);
                if self.kind == "colon" {
                    let a = sn.atan2(c);
                    k *= (1.0 + 0.2 * toward) * (1.0 - 0.06 * (a - std::f32::consts::TAU / 3.0).cos().max(0.0).powi(30) - 0.06 * (a + std::f32::consts::TAU / 3.0).cos().max(0.0).powi(30));
                } else {
                    k *= 1.0 + if self.kind == "stomach" { 0.3 } else { 0.4 } * toward;
                }
                let inner = nv.dot(cdir);
                k *= 1.0 - 0.14 * fold * inner.max(0.0) + 0.03 * fold * (-inner).max(0.0);
                pos.push(x + nv * rr * k);
                uv.push([along, s as f32 / (SIDES - 1) as f32]);
            }
        }
        let mut index = Vec::with_capacity((rings - 1) * (SIDES - 1) * 6);
        for i in 0..rings - 1 {
            for s in 0..SIDES - 1 {
                let a = (i * SIDES + s) as u32;
                let (b, c) = (a + 1, a + SIDES as u32);
                index.extend([a, c, b, b, c, c + 1]);
            }
        }
        // Blood on it where it came through the wound, in patches, not a coat of paint (its corners' colour's alpha).
        let mut colour = Vec::with_capacity(rings * SIDES);
        for i in 0..rings {
            let t = i as f32 / SPLIT as f32;
            let k = (t.floor() as usize).min(n - 2);
            let g = self.gore[k] + (self.gore[k + 1] - self.gore[k]) * (t - k as f32);
            for s in 0..SIDES {
                let s = s as f32;
                colour.push([1.0, 1.0, 1.0, g * (0.35 + 0.65 * ((t * 2.3 + s * 0.9).sin() * (t * 0.7 + s * 0.4 + 1.0).sin()).max(0.0))]);
            }
        }
        self.bloody = false;
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
            .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colour)
            .with_inserted_indices(Indices::U32(index));
        // Normals from the shape itself (it is not round), the seam where the picture wraps made one.
        crate::flesh::normals(&mut mesh);
        if let Some(VertexAttributeValues::Float32x3(nor)) = mesh.attribute_mut(Mesh::ATTRIBUTE_NORMAL) {
            for i in 0..rings {
                let (a, b) = (i * SIDES, i * SIDES + SIDES - 1);
                let m = Vec3::from(nor[a]) + Vec3::from(nor[b]);
                let m = m.normalize_or_zero().to_array();
                nor[a] = m;
                nor[b] = m;
            }
        }
        mesh.generate_tangents().ok();
        Some(mesh)
    }
}

fn nearest(p: Vec3, c: &(Vec3, Vec3, f32)) -> Vec3 {
    let u = c.1 - c.0;
    let t = ((p - c.0).dot(u) / u.length_squared().max(1e-9)).clamp(0.0, 1.0);
    c.0 + u * t
}

fn dist(p: Vec3, c: &(Vec3, Vec3, f32)) -> f32 {
    p.distance(nearest(p, c))
}

// Loops lie on each other, not through each other: any two points closer than their widths are pushed apart.
fn apart(loops: &mut [Loop]) {
    for a in 0..loops.len() {
        for b in a..loops.len() {
            let w = (loops[a].r + loops[b].r) * 0.95;
            let (n, m) = (loops[a].count, loops[b].count);
            for i in 3..n.saturating_sub(3) {
                for j in (if a == b { i + 3 } else { 3 })..m.saturating_sub(3) {
                    let d = loops[b].p[j] - loops[a].p[i];
                    let d2 = d.length_squared();
                    if d2 >= w * w || d2 < 1e-12 {
                        continue;
                    }
                    let l = d2.sqrt();
                    let push = d * ((w - l) / l * 0.5);
                    loops[a].p[i] -= push;
                    loops[b].p[j] += push;
                }
            }
        }
    }
}

// --- the meshes ---------------------------------------------------------------------------------------------------------

// The organs near any opening, as meshes of their own, each kind in its own look, carried by the bones the anatomy hangs
// them from (as the x-ray is). Whole clusters (about fifty triangles each) near an opening.
#[allow(clippy::too_many_arguments)]
fn organs(v: &mut Viscera, person: &Person, hurt: &Hurt, anatomy: &Anatomy, commands: &mut Commands, meshes: &mut Assets<Mesh>, looks: &mut Looks,
          materials: &mut Assets<WetMaterial>, skin: &SkinnedMesh, space: Entity) {
    let traced = &hurt.traced;
    let normal = &anatomy.bodies[&person.body.name].normal;
    let mut groups: Vec<(String, Vec<(usize, &[u32])>)> = Vec::new();
    for (pi, part) in traced.parts.iter().enumerate() {
        if !shown(&part.kind, &part.name) {
            continue;
        }
        for c in &part.clusters {
            // Only what lies behind an opening, where it can be seen through it: in the cone from its edge inward. (All
            // within reach round it, the organs' flat clusters to the side, each on one bone while the skin bends between
            // two, stood out through the flank and the shirt as red shards.)
            let seen = |o: &Opening| {
                let d = (c.lo + c.hi) * 0.5 - o.at;
                let behind = -d.dot(o.normal);
                let aside = (d + o.normal * behind).length();
                behind > 0.0 && behind < REACH && aside < o.half[0] * 1.6 + behind * 0.8 + 0.01
            };
            if !v.openings.iter().any(|o| box_distance(c.lo, c.hi, o.at) < REACH && seen(o)) {
                continue;
            }
            match groups.iter_mut().find(|g| g.0 == part.kind) {
                Some(g) => g.1.push((pi, &c.tris)),
                None => groups.push((part.kind.clone(), vec![(pi, &c.tris)])),
            }
        }
    }
    v.lungs.clear();
    for (kind, list) in groups {
        let mut remap: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
        let (mut pos, mut nor, mut joints, mut colour, mut index) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let mut lung = Vec::new();
        for (pi, tris) in list {
            let part = &traced.parts[pi];
            // A lung falls in toward its root (hilum), on the inner face of its middle (`collapse`).
            let side = if kind == "lung" { if part.name.contains("left") { 1u8 } else { 2 } } else { 0 };
            let c = traced.source[part.source].centre();
            let toward = Vec3::new(c.x * 0.35, c.y, c.z);
            for &i in tris {
                for j in 0..3 {
                    let vtx = traced.index[i as usize + j];
                    let k = *remap.entry(vtx).or_insert_with(|| {
                        let p = traced.position[vtx as usize];
                        pos.push(p);
                        nor.push(normal[vtx as usize]);
                        joints.push([part.owner as u16, 0, 0, 0]);
                        colour.push([p.x, p.y, p.z, v.blood_at(p)]);
                        if side > 0 {
                            lung.push((pos.len() - 1, p, toward, side));
                        }
                        pos.len() as u32 - 1
                    });
                    index.push(k);
                }
            }
        }
        let vertices = pos.len();
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, nor)
            .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colour)
            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(joints))
            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; vertices])
            .with_inserted_indices(Indices::U32(index));
        mesh.generate_skinned_mesh_bounds().ok();
        if !lung.is_empty() {
            v.lungs.push((kind.clone(), lung));
        }
        match v.organs.iter().find(|o| o.0 == kind) {
            Some((_, _, h)) => {
                if let Some(mut m) = meshes.get_mut(h.id()) {
                    *m = mesh;
                }
            }
            None => {
                let h = meshes.add(mesh);
                let material = looks.organ(&kind, materials);
                // (The skin would shadow everything inside it: light comes in through the opening, which the shadow maps,
                // drawn from the whole skin, do not know of.)
                let e = commands.spawn((Mesh3d(h.clone()), MeshMaterial3d(material), skin.clone(), DynamicSkinnedMeshBounds, NotShadowReceiver, ChildOf(space))).id();
                v.organs.push((kind, e, h));
            }
        }
    }
    v.fallen = [-1.0, -1.0];
}

// How far each lung has fallen in toward its root, from how collapsed vitals.rs says it is (an open chest or a punctured
// lung lets air into the pleural space, and the lung's own elastic recoil pulls it in: body-wall.md 2.4). Fully
// collapsed, it is drawn at half its size about its root. Its surface (from its place at rest) goes with it.
fn collapse(v: &mut Viscera, vitals: &Vitals, meshes: &mut Assets<Mesh>) {
    let fallen = [0.5 * (1.0 - vitals.lungs.l), 0.5 * (1.0 - vitals.lungs.r)];
    if v.lungs.is_empty() || ((fallen[0] - v.fallen[0]).abs() < 0.005 && (fallen[1] - v.fallen[1]).abs() < 0.005) {
        return;
    }
    v.fallen = fallen;
    for (kind, list) in &v.lungs {
        let Some((_, _, h)) = v.organs.iter().find(|o| &o.0 == kind) else { continue };
        let Some(mut m) = meshes.get_mut(h.id()) else { continue };
        if let Some(VertexAttributeValues::Float32x3(pos)) = m.attribute_mut(Mesh::ATTRIBUTE_POSITION) {
            for &(i, p, root, side) in list {
                pos[i] = p.lerp(root, fallen[side as usize - 1]).to_array();
            }
        }
    }
}

// The looks shared by everybody: one for each kind of organ, the ropes' (with their painted pictures), the wall's inside.
#[derive(Resource, Default)]
pub struct Looks {
    organs: Vec<(String, Handle<WetMaterial>)>,
    tubes: Vec<(String, Handle<WetMaterial>)>,
}

fn linear(c: [f32; 3]) -> Vec4 {
    let l = Color::srgb_u8(c[0] as u8, c[1] as u8, c[2] as u8).to_linear();
    Vec4::new(l.red, l.green, l.blue, 1.0)
}

impl Looks {
    fn organ(&mut self, kind: &str, materials: &mut Assets<WetMaterial>) -> Handle<WetMaterial> {
        if let Some((_, h)) = self.organs.iter().find(|o| o.0 == kind) {
            return h.clone();
        }
        let (c, vessels, mottle, fat, rough) = look(kind);
        // Wet, but its sheen from the surface itself, broken by the unevenness organs.wesl bends its normal with. (A clear
        // coat here takes the bare normal of the anatomy's broad flat facets: each a mirror of the room, a glass dome
        // seen down a hole into the belly.)
        let h = materials.add(ExtendedMaterial {
            base: StandardMaterial { base_color: Color::WHITE, metallic: 0.0, perceptual_roughness: rough, ..default() },
            extension: Wet { base: linear(c), look: Vec4::new(vessels, mottle, fat, if kind == "brain" { 2.0 } else { 1.0 }) },
        });
        self.organs.push((kind.to_string(), h.clone()));
        h
    }

    // The outside of each kind that can come out (small bowel, colon, stomach): its painted wall and its relief, a soft
    // wet sheen on it (the serosa glistens; it is not lacquered; a thin coat with its own small sharp highlights broken
    // up by the same relief), and blood on it where it came through the wound.
    fn tube(&mut self, kind: &str, images: &mut Assets<Image>, materials: &mut Assets<WetMaterial>, rng: &mut Rng) -> Handle<WetMaterial> {
        if let Some((_, h)) = self.tubes.iter().find(|o| o.0 == kind) {
            return h.clone();
        }
        let (albedo, relief) = crate::tubes::paint(kind, rng);
        let image = |data: Vec<u8>, format: TextureFormat| {
            let mut i = Image::new(Extent3d { width: crate::tubes::W as u32, height: crate::tubes::H as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data,
                                   format, RenderAssetUsages::RENDER_WORLD);
            i.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor { address_mode_u: ImageAddressMode::Repeat, address_mode_v: ImageAddressMode::Repeat,
                                                                          ..ImageSamplerDescriptor::linear() });
            i
        };
        let h = materials.add(ExtendedMaterial {
            base: StandardMaterial {
                base_color_texture: Some(images.add(image(albedo, TextureFormat::Rgba8UnormSrgb))),
                normal_map_texture: Some(images.add(image(relief, TextureFormat::Rgba8Unorm))),
                metallic: 0.0,
                perceptual_roughness: 0.5,
                clearcoat: 0.45,
                clearcoat_perceptual_roughness: 0.24,
                ..default()
            },
            extension: Wet { base: Vec4::ONE, look: Vec4::ZERO },
        });
        self.tubes.push((kind.to_string(), h.clone()));
        h
    }
}

// --- every frame -----------------------------------------------------------------------------------------------------------

#[allow(clippy::type_complexity)]
pub fn update_system(
    mut commands: Commands,
    time: Res<Time>,
    anatomy: Res<Anatomy>,
    mut looks: ResMut<Looks>,
    mut rng: ResMut<Rng>,
    mut blood: ResMut<crate::blood::Blood>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<WetMaterial>>,
    mut people: Query<(Entity, &Person, &Transform, &mut Viscera, &Hurt, &mut Vitals, Option<&Ragdoll>)>,
    skins: Query<&SkinnedMesh>,
    parents: Query<&ChildOf>,
) {
    let dt = time.delta_secs();
    for (_, person, root, mut v, hurt, mut vitals, rd) in &mut people {
        let first = person.parts[0].1;
        let (Ok(skin), Ok(space)) = (skins.get(first), parents.get(first).map(|c| c.parent())) else { continue };
        // What wounds.rs handed over: blood on an organ hit.
        let bled_now: Vec<(String, Vec3, f32)> = hurt.happened.iter().filter_map(|h| if let Happened::Bled { part, at, channel } = h { Some((part.clone(), *at, *channel)) } else { None }).collect();
        if !bled_now.is_empty() {
            let mats = bone_worlds(person, root);
            for (part, at, wide) in bled_now {
                let Some(p) = hurt.traced.parts.iter().find(|p| p.name == part) else { continue };
                bled(&mut v, mats[p.owner].inverse().transform_point3(at), wide);
            }
        }
        if v.openings.is_empty() {
            continue;
        }
        if std::mem::take(&mut v.stale) {
            organs(&mut v, person, &hurt, &anatomy, &mut commands, &mut meshes, &mut looks, &mut materials, skin, space);
            for l in &mut v.loops {
                l.bloody = true;
            }
            let worlds = bone_worlds(person, root);
            for k in 0..v.loops.len() {
                let inv = worlds[v.loops[k].o.owner].inverse();
                for i in 0..v.loops[k].count {
                    let at = inv.transform_point3(v.loops[k].p[i]);
                    let mm = v.blood_at(at);
                    // (A film where the organ was bled on, in patches: soaked through it reads as red paint.)
                    v.loops[k].gore[i] = v.loops[k].gore[i].max(mm.min(0.035));
                }
            }
        }
        collapse(&mut v, &vitals, &mut meshes);
        let Some(rd) = rd else { continue };
        if v.loops.is_empty() {
            continue;
        }
        // The body as capsules, for what is out to lie on; the belly and pelvis also as the cavity it is in.
        let (mut bodies, mut cavity) = (Vec::new(), Vec::new());
        for k in 0..rd.segs.len() {
            if rd.cut_off(k) {
                continue;
            }
            let [a, b] = rd.segment_ends(k);
            let r = rd.segs[k].def.radius / 0.82;
            bodies.push((a, b, r + CLOTHES));
            if matches!(rd.segs[k].def.name.as_str(), "belly" | "pelvis") {
                cavity.push((a, b, r));
            }
        }
        // The pressure in the belly over the outside's, in pascals: the wall's tone (more in a man awake, in pain,
        // guarding or straining; none once dead), and the weight of the contents above each opening (Cobb et al.: about
        // 2 mmHg lying, 20 standing).
        let tone = if vitals.dead { 0.0 } else { (2.0 + 10.0 * vitals.conscious() * (0.3 + vitals.pain).min(1.0)) * MMHG };
        let top = cavity.iter().fold(f32::NEG_INFINITY, |t, c| t.max(c.0.y + c.2 - WALL).max(c.1.y + c.2 - WALL));
        let worlds = bone_worlds(person, root);
        let v = &mut *v;
        for l in &mut v.loops {
            let bone = worlds[l.o.owner];
            l.step(dt, &bodies, &cavity, tone, top, bone, &mut rng);
        }
        apart(&mut v.loops);
        let mut low: Option<Vec3> = None;
        for l in &mut v.loops {
            if let Some(mesh) = l.draw() {
                match &l.mesh {
                    Some((_, h)) => {
                        if let Some(mut m) = meshes.get_mut(h.id()) {
                            *m = mesh;
                        }
                    }
                    None => {
                        let h = meshes.add(mesh);
                        let material = looks.tube(l.kind, &mut images, &mut materials, &mut rng);
                        // (Drawn in the world, not on the skeleton: its points are the world's.)
                        let e = commands.spawn((Mesh3d(h.clone()), MeshMaterial3d(material), Transform::default(), bevy::camera::visibility::NoFrustumCulling)).id();
                        l.mesh = Some((e, h));
                    }
                }
            }
            if let Some(p) = l.lowest() {
                if low.is_none_or(|q| p.y < q.y) {
                    low = Some(p);
                }
            }
            if l.came && v.told.insert(l.kind.to_string()) {
                vitals.injure(match l.kind {
                    "bowel" => "Small bowel out through the wound",
                    "colon" => "Colon out through the wound",
                    _ => "Stomach out through the wound",
                }, 9.0);
            }
        }
        // Blood off the lowest of what is out, a drop at a time.
        if let Some(low) = low {
            v.drip -= dt;
            if vitals.beating() && v.drip < 0.0 {
                v.drip = 0.4 + rng.next() * 0.8;
                blood.drip(low - Vec3::Y * 0.014, 0.05, crate::fluid::across(0.05));
            }
        }
    }
}

// Each bone's matrix from rest to the world now, as medicine works it out (npc.rs bone_worlds).
fn bone_worlds(person: &Person, root: &Transform) -> Vec<Affine3A> {
    let pelvis = person.body.bone("root").head;
    let base = root.compute_affine() * Affine3A::from_rotation_translation(person.posed.frame.rotation, person.posed.frame.translation) * Affine3A::from_translation(-pelvis);
    person.absolute(&person.posed.local).iter().zip(&person.body.bones).map(|(&(r, at), b)| base * Affine3A::from_rotation_translation(r, at) * Affine3A::from_translation(-b.head)).collect()
}

// The ropes go with their person: K takes them (their meshes are in the world, not under the person).
fn gone(mut commands: Commands, mut removed: RemovedComponents<Viscera>, mut kept: Local<Vec<(Entity, Vec<Entity>)>>, people: Query<(Entity, &Viscera)>) {
    for (e, v) in &people {
        let ropes: Vec<Entity> = v.loops.iter().filter_map(|l| l.mesh.as_ref().map(|m| m.0)).collect();
        match kept.iter_mut().find(|k| k.0 == e) {
            Some(k) => k.1 = ropes,
            None => kept.push((e, ropes)),
        }
    }
    for e in removed.read() {
        if let Some(i) = kept.iter().position(|k| k.0 == e) {
            for r in kept.remove(i).1 {
                commands.entity(r).try_despawn();
            }
        }
    }
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "organs.wesl");
    app.add_plugins(MaterialPlugin::<WetMaterial>::default())
        .init_resource::<Looks>()
        .add_systems(PostUpdate, (update_system.after(crate::dismember::taken_system), gone));
}
