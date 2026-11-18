// A limb, or the head, cut off (src/sandbox/dismember.ts).
//
// What comes away is the ragdoll's own: the segment below the cut and all that hangs from it are already bodies in the
// physics world, joined to the rest at a joint, and the skeleton follows them. Severing lets that joint go and from
// then on puts the piece's first bone where its body is, not where its parent bone would have it. The skin and clothes
// are split between two meshes at the cut: the body keeps what is on its side and the piece takes the rest, each with
// its weights given wholly to the bones on its side so nothing stretches across the gap; the triangles the cut runs
// through are cut along it, each side keeping its own (flesh.rs: the TS kept them whole in both and hid each side's
// other half per pixel).
//
// Both ends are closed with what a limb cut through shows: the skin's cut edge, the yellow fat under it, the white sheath
// round the muscle, the muscles in their compartments, the bone's own outline read off the skeleton (a ring of cortex
// round its marrow), and the vessels the anatomy says cross there, the arteries holding their round shape and the veins
// collapsed. The arteries in the stump pump out with every beat until the heart has nothing left to pump (vitals.rs),
// which, from a thigh, is a few minutes.
//
// What takes a limb off: an edge driven through bone in one blow (a sword's chop, a machete's), or two or three blows
// to the same place; a shotgun's charge at contact range, while its pellets still fly as one mass; a blast close
// enough. The figures are below.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::image::Image;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy_rapier3d::prelude::{CollisionGroups, ExternalImpulse};
use serde_json::json;

use crate::anatomy::{in_loop, loop_area, section, SectionPoint, Traced};
use crate::behaviour::Behaviour;
use crate::flesh::{part_mesh, Cuts, Flesh, Plane};
use crate::npc::{self, Crossing, Happened, Hurt, Kind};
use crate::person::{Body, Person};
use crate::ragdoll::Ragdoll;
use crate::rng::Rng;
use crate::vitals::Bleed;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum How {
    Blade,
    Shot,
    Blast,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Limb {
    Hand,
    Forearm,
    Upperarm,
    Foot,
    Shin,
    Thigh,
    Head,
}

// What comes off: `root` the ragdoll segment that comes away (with everything below it), the cut made across the line
// from bone `from`'s head to bone `to`'s, `at` of the way along it and a blow can move it `play` either way; `reach` how
// far from the middle of the cut the limb's flesh goes; `fat` millimetres of fat under its skin; `rank` how bad the
// injury is (vitals' list).
pub struct Spec {
    pub root: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub at: f32,
    pub play: f32,
    pub reach: f32,
    pub fat: f32,
    pub rank: f32,
}

pub fn spec(l: Limb) -> Spec {
    let s = |root, from, to, at, play, reach, fat, rank| Spec { root, from, to, at, play, reach, fat, rank };
    match l {
        Limb::Hand => s("hand", "lowerarm01", "wrist", 0.9, 0.04, 0.07, 2.5, 8.0),
        Limb::Forearm => s("forearm2", "lowerarm01", "wrist", 0.55, 0.18, 0.08, 4.0, 9.0),
        Limb::Upperarm => s("upperarm2", "upperarm01", "lowerarm01", 0.5, 0.15, 0.1, 7.0, 10.0),
        Limb::Foot => s("foot", "lowerleg01", "foot", 0.92, 0.03, 0.08, 3.0, 8.0),
        Limb::Shin => s("shin2", "lowerleg01", "foot", 0.55, 0.18, 0.1, 4.0, 10.0),
        Limb::Thigh => s("thigh2", "upperleg01", "lowerleg01", 0.5, 0.15, 0.15, 12.0, 11.0),
        Limb::Head => s("head", "neck01", "head", 0.28, 0.1, 0.1, 4.0, 12.0),
    }
}

impl Limb {
    fn word(self) -> &'static str {
        match self {
            Limb::Hand => "hand",
            Limb::Forearm => "forearm",
            Limb::Upperarm => "upper arm",
            Limb::Foot => "foot",
            Limb::Shin => "lower leg",
            Limb::Thigh => "thigh",
            Limb::Head => "head",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Limb::Hand => "hand",
            Limb::Forearm => "forearm",
            Limb::Upperarm => "upperarm",
            Limb::Foot => "foot",
            Limb::Shin => "shin",
            Limb::Thigh => "thigh",
            Limb::Head => "head",
        }
    }

    // Joules an edge must bring in one blow to go through skin, muscle and bone. Set so that a sword's full chop (about
    // 90 J here) takes a hand or a forearm, as machete attacks do in one blow (dev/research/wounds.md, chop wounds), and
    // needs two or more for an upper arm, a neck or a thigh; a blow that does not go through leaves the bone notched,
    // and the next to the same place goes on from there (`CARRIES` of the earlier ones counts).
    pub fn chop(self) -> f32 {
        match self {
            Limb::Hand => 45.0,
            Limb::Forearm => 75.0,
            Limb::Foot => 80.0,
            Limb::Shin => 150.0,
            Limb::Upperarm => 130.0,
            Limb::Head => 120.0,
            Limb::Thigh => 260.0,
        }
    }

    // Joules a single heavy charge must leave in the limb: a shotgun's at contact range, its pellets still one mass
    // (about 1.4 kJ from the shotgun here, of which a forearm takes 350 to 500 J: 7 cm of flesh and a bone), tears off
    // a hand, a forearm or a foot, and a leg only with far more (the literature has contact shotgun wounds of the
    // forearm and hand as near-amputations; of the thigh, as shattered femurs).
    pub fn charge(self) -> f32 {
        match self {
            Limb::Hand => 180.0,
            Limb::Forearm => 300.0,
            Limb::Foot => 320.0,
            Limb::Shin => 650.0,
            Limb::Upperarm => 650.0,
            Limb::Head => 1100.0,
            Limb::Thigh => 1500.0,
        }
    }

    // kPa of a blast's peak overpressure that tears the limb off. Traumatic amputation by blast is a near-field injury:
    // these put a hand grenade's (0.25 kg TNT) reach for a hand or forearm at about 0.8 m and for a thigh at about 0.6 m.
    pub fn blast(self) -> f32 {
        match self {
            Limb::Hand => 700.0,
            Limb::Forearm => 900.0,
            Limb::Foot => 800.0,
            Limb::Shin => 1100.0,
            Limb::Upperarm => 1300.0,
            Limb::Head => 2000.0,
            Limb::Thigh => 1800.0,
        }
    }
}

const CARRIES: f32 = 0.75;

// The ragdoll segment a point is on, as the limb that would come off there.
fn segment_limb(base: &str) -> Option<Limb> {
    Some(match base {
        "hand" => Limb::Hand,
        "forearm" | "forearm2" => Limb::Forearm,
        "upperarm" | "upperarm2" => Limb::Upperarm,
        "foot" => Limb::Foot,
        "shin" | "shin2" => Limb::Shin,
        "thigh" | "thigh2" => Limb::Thigh,
        "head" => Limb::Head,
        _ => return None,
    })
}

// Peak overpressure (kPa) at `r` metres from `tnt` kg of TNT in the open (Mills 1987, a fit to Kingery and Bulmash).
pub fn overpressure(r: f32, tnt: f32) -> f32 {
    let z = (r / tnt.max(1e-4).cbrt()).max(0.3);
    1772.0 / z.powi(3) - 114.0 / z.powi(2) + 108.0 / z
}

// The litres a second a vessel of radius r (metres) bleeds cut right through, at normal pressure (wounds.rs's figure).
fn vessel_rate(r: f32, arterial: bool) -> f32 {
    (if arterial { 1.2 } else { 0.55 }) * (r * 1000.0).powi(2) * 0.001
}

// Whether `energy` joules brought by `how` would take off `limb`. For a blast, `energy` is the peak overpressure in kPa.
pub fn severs(limb: Limb, energy: f32, how: How) -> bool {
    energy >= match how {
        How::Blade => limb.chop(),
        How::Shot => limb.charge(),
        How::Blast => limb.blast(),
    }
}

// --- one person's cuts -----------------------------------------------------------------------------------------------

pub struct CutOff {
    pub limb: Limb,
    pub side: String,
    pub how: How,
    // The piece's first segment, every segment of it, its first bone and the bones a bend was spread over in it.
    pub root: usize,
    pub segs: Vec<usize>,
    pub root_bone: usize,
    pub spread: Vec<usize>,
    // The bone the limb hung from (the stump's end goes with it) and the piece's first bone.
    pub prox: usize,
    pub tip: usize,
    // The cut, in rest space: through `c` square to `n`, which points away from the body.
    pub c: Vec3,
    pub n: Vec3,
    pub drains: f32,
    pub entities: Vec<Entity>,
    // Each bone of the body: whether it went with the piece, and whether it is one of the bones of the segment the cut is
    // in (its flesh past the plane, within `reach` twice over, went too); the limb's reach.
    pub gone: Vec<bool>,
    pub near: Vec<bool>,
    pub reach: f32,
}

impl CutOff {
    // Whether a point of the body at rest `p`, carried by bone `bone` before this cut, is on the piece: past the plane
    // and on the limb (split's test for the skin's corners, for one bone).
    pub fn on_piece(&self, p: Vec3, bone: usize) -> bool {
        (p - self.c).dot(self.n) > 0.0 && (self.gone[bone] || (self.near[bone] && p.distance_squared(self.c) < self.reach * self.reach * 4.0))
    }

    // The bone that carries that point after the cut: on the piece, one of the piece's (its first bone for one of the
    // body's); on the body, one of the body's (the bone the limb hung from for one of the piece's).
    pub fn carrier(&self, p: Vec3, bone: usize) -> usize {
        match (self.on_piece(p, bone), self.gone[bone]) {
            (true, false) => self.root_bone,
            (false, true) => self.prox,
            _ => bone,
        }
    }
}

impl Dismember {
    // The bone that carries a point of the body at rest, hung from `bone` before any cut, after all of them: what every
    // mesh skinned to the skeleton is carried by once limbs have come off, so nothing stretches from a stump to its
    // piece (the x-ray, the dressings; the skin and clothes are cut along the plane besides, flesh.rs).
    pub fn carrier(&self, p: Vec3, bone: usize) -> usize {
        self.cuts.iter().fold(bone, |b, cut| cut.carrier(p, b))
    }
}

#[derive(Component, Default)]
pub struct Dismember {
    pub cuts: Vec<CutOff>,
    pub chops: HashMap<String, f32>,
    // The strongest cut a swing made on each limb, kept until the swing is through (npc.slash).
    swings: HashMap<String, (f32, Vec3, Vec3)>,
    death: f32,
}

impl Dismember {
    // Whether `limb` is off, or hangs from something that is.
    pub fn off(&self, rd: &Ragdoll, limb: Limb, side: &str) -> bool {
        let name = format!("{}{side}", spec(limb).root);
        let Some(k) = rd.segs.iter().position(|s| s.def.name == name) else { return true };
        self.cuts.iter().any(|c| c.segs.contains(&k))
    }
}

// Which limb (and side) a world point on person `who` is on, or None on the trunk. A point on the skull is not on the
// neck: a blade to the head does not take it off.
pub fn limb_at(world: &mut World, who: Entity, point: Vec3) -> Option<(Limb, String)> {
    let name = {
        let rd = world.get::<Ragdoll>(who)?;
        rd.segs[rd.nearest(point).0].def.name.clone()
    };
    let (base, side) = match name.strip_suffix('L').map(|b| (b, "L")).or_else(|| name.strip_suffix('R').map(|b| (b, "R"))) {
        Some(x) => x,
        None => (name.as_str(), ""),
    };
    let limb = segment_limb(base)?;
    if limb == Limb::Head {
        let past = npc::with(world, who, |npc| {
            let body = npc.body();
            let (a, b) = (body.by_name["neck01"], body.by_name["head"]);
            let (ah, bh) = (body.bones[a].head, body.bones[b].head);
            let rest = npc.rest_to_world(a).inverse().transform_point3(point);
            (rest - ah).dot(bh - ah) / ah.distance_squared(bh)
        })?;
        if past > 1.05 {
            return None;
        }
    }
    Some((limb, side.to_string()))
}

// Where the cut across `limb` would be, in the world now (None if it is off already).
pub fn place(world: &mut World, who: Entity, limb: Limb, side: &str) -> Option<Vec3> {
    {
        let rd = world.get::<Ragdoll>(who)?;
        if world.get::<Dismember>(who).is_some_and(|d| d.off(rd, limb, side)) {
            return None;
        }
    }
    let l = spec(limb);
    let sfx = if limb == Limb::Head { String::new() } else { format!(".{side}") };
    npc::with(world, who, |npc| {
        let body = npc.body();
        let (a, b) = (*body.by_name.get(&format!("{}{sfx}", l.from))?, *body.by_name.get(&format!("{}{sfx}", l.to))?);
        let rest = body.bones[a].head.lerp(body.bones[b].head, l.at);
        Some(npc.rest_to_world(a).transform_point3(rest))
    })?
}

// A heavy edge brought down on person `who` at world point `point`, travelling along `dir`, with `energy` joules: off,
// if it is enough (with what earlier blows there did); otherwise a deep chop into the bone. True if something came off.
pub fn chop(world: &mut World, who: Entity, point: Vec3, dir: Vec3, energy: f32) -> bool {
    let Some((limb, side)) = limb_at(world, who, point) else { return false };
    let key = format!("{}{side}", limb.key());
    if world.get::<Dismember>(who).is_none() {
        world.entity_mut(who).insert(Dismember::default());
    }
    let total = {
        let mut d = world.entity_mut(who);
        let Some(mut d) = d.get_mut::<Dismember>() else { return false };
        let total = d.chops.get(&key).copied().unwrap_or(0.0) * CARRIES + energy;
        d.chops.insert(key, total);
        total
    };
    if severs(limb, total, How::Blade) {
        return sever(world, who, limb, &side, Some(point), Some(dir), How::Blade);
    }
    if energy > limb.chop() * 0.35 {
        npc::with(world, who, |npc| {
            let text = if limb == Limb::Head { "Neck chopped into the spine".to_string() } else {
                format!("{} {} chopped into the bone", if side == "L" { "Left" } else { "Right" }, limb.word())
            };
            npc.vitals.injure(text, 5.0);
            npc.crack(point, 0.6);
        });
    }
    false
}

// The swing is through: its strongest cut on each limb it met is one chop there (npc.slash). The cuts are what
// wounds.rs handed over as `Happened::Edge`, this frame's and the swing's earlier ones.
pub fn swung(world: &mut World, who: Entity) -> bool {
    gather(world, who);
    let cuts: Vec<(f32, Vec3, Vec3)> = match world.get_mut::<Dismember>(who) {
        Some(mut d) => std::mem::take(&mut d.swings).into_values().collect(),
        None => return false,
    };
    let mut off = false;
    for (energy, point, dir) in cuts {
        off = chop(world, who, point, dir, energy) || off;
    }
    off
}

// This frame's edges kept, each limb's strongest (the same edge twice is still the strongest once).
fn gather(world: &mut World, who: Entity) {
    let edges: Vec<(f32, Vec3, Vec3)> = match world.get::<Hurt>(who) {
        Some(h) => h.happened.iter().filter_map(|x| if let Happened::Edge { energy, at, dir } = x { Some((*energy, *at, *dir)) } else { None }).collect(),
        None => return,
    };
    for (energy, at, dir) in edges {
        let Some((limb, side)) = limb_at(world, who, at) else { continue };
        let Some(mut d) = world.get_mut::<Dismember>(who) else { return };
        let key = format!("{}{side}", limb.key());
        if d.swings.get(&key).is_none_or(|h| energy > h.0) {
            d.swings.insert(key, (energy, at, dir));
        }
    }
}

// A heavy charge (a missile with a wide channel: a shotgun's at contact range) that left `spent` joules in person `who`,
// having gone in at world point `point` along `dir`.
pub fn charge(world: &mut World, who: Entity, spent: f32, point: Vec3, dir: Vec3) -> bool {
    let Some((limb, side)) = limb_at(world, who, point) else { return false };
    severs(limb, spent, How::Shot) && sever(world, who, limb, &side, Some(point), Some(dir), How::Shot)
}

// A blast of `tnt` kg (TNT equivalent) at world point `at`: every limb close enough to it torn off, and the belly burst
// open if it was close enough to that (viscera.rs). Returns what came off.
pub fn blast(world: &mut World, who: Entity, at: Vec3, tnt: f32) -> Vec<String> {
    let mut gone = Vec::new();
    // (Nearest the body first: a leg torn off below the knee takes its foot with it.)
    for (limb, sides) in [(Limb::Head, ""), (Limb::Thigh, "LR"), (Limb::Upperarm, "LR"), (Limb::Shin, "LR"), (Limb::Forearm, "LR"), (Limb::Foot, "LR"), (Limb::Hand, "LR")] {
        let sides: Vec<String> = if sides.is_empty() { vec![String::new()] } else { sides.chars().map(String::from).collect() };
        for side in sides {
            let Some(p) = place(world, who, limb, &side) else { continue };
            let k = world.resource_mut::<Rng>().next();
            let kpa = overpressure(at.distance(p), tnt) * (0.75 + k * 0.5);
            if severs(limb, kpa, How::Blast) && sever(world, who, limb, &side, Some(p), Some((p - at).normalize()), How::Blast) {
                gone.push(format!("{}{side}", limb.key()));
            }
        }
    }
    let belly = world.get::<Ragdoll>(who).map(|rd| rd.middle(rd.by_name("belly")));
    if let Some(b) = belly {
        if crate::viscera::burst(world, who, at, overpressure(at.distance(b), tnt)) {
            gone.push("belly".into());
        }
    }
    gone
}

// Cut `limb` (on `side`, "L" or "R"; "" for the head) off person `who`, across the place nearest world point `point`,
// the blow travelling along `dir`. False if it is already off. `how` is what did it: a blade cuts clean, a charge or a
// blast tears.
pub fn sever(world: &mut World, who: Entity, limb: Limb, side: &str, point: Option<Vec3>, dir: Option<Vec3>, how: How) -> bool {
    let side = if limb == Limb::Head { "" } else { side };
    let l = spec(limb);
    let started = std::time::Instant::now();
    if world.get::<Dismember>(who).is_none() {
        world.entity_mut(who).insert(Dismember::default());
    }
    // The ragdoll's side of it: which segment comes away, which go with it.
    let (root, segs) = {
        let Some(rd) = world.get::<Ragdoll>(who) else { return false };
        let Some(root) = rd.segs.iter().position(|s| s.def.name == format!("{}{side}", l.root)) else { return false };
        let d = world.get::<Dismember>(who).unwrap();
        if d.off(rd, limb, side) || d.cuts.len() >= 8 {
            return false;
        }
        let segs: Vec<usize> = (0..rd.segs.len()).filter(|&k| {
            let mut at = Some(k);
            while let Some(i) = at {
                if i == root {
                    return true;
                }
                at = rd.segs[i].def.parent;
            }
            false
        }).collect();
        (root, segs)
    };
    let (person_body, root_bone, parent_seg) = {
        let p = world.get::<Person>(who).unwrap();
        (p.body.clone(), p.segments[root].bone, p.segments[root].parent)
    };
    let body = &*person_body;
    let sfx = if limb == Limb::Head { String::new() } else { format!(".{side}") };
    let (Some(&a), Some(&b)) = (body.by_name.get(&format!("{}{sfx}", l.from)), body.by_name.get(&format!("{}{sfx}", l.to))) else { return false };
    let prox = body.bones[root_bone].parent.unwrap();
    let r = [world.resource_mut::<Rng>().next(), world.resource_mut::<Rng>().next(), world.resource_mut::<Rng>().next()];

    // The cut: across the line from a to b, where the blow landed (within the limb's play), turned toward the plane the
    // blade travelled in.
    let to_rest = npc::with(world, who, |npc| npc.rest_to_world(a).inverse()).unwrap();
    let (ah, bh) = (body.bones[a].head, body.bones[b].head);
    let ab = bh - ah;
    let u = ab.normalize();
    let s = match point {
        Some(p) => ((to_rest.transform_point3(p) - ah).dot(ab) / ab.length_squared()).clamp(l.at - l.play, l.at + l.play),
        None => l.at,
    };
    let c = ah + ab * s;
    let mut n = u;
    match (dir, how) {
        (Some(d), How::Blade) => {
            let d = to_rest.transform_vector3(d).normalize();
            let off = u - d * u.dot(d);
            if off.length_squared() > 0.25 {
                n = u.lerp(off.normalize(), 0.6).normalize();
            }
        }
        _ if limb != Limb::Head => n = (u + (Vec3::from(r) - 0.5) * 0.3).normalize(),
        _ => {}
    }
    if n.dot(u) < 0.6 {
        n = u.lerp(n, 0.5).normalize();
    }

    // Which bones go: the root's and all below it.
    let gone: Vec<bool> = (0..body.bones.len()).map(|i| {
        let mut at = Some(i);
        while let Some(x) = at {
            if x == root_bone {
                return true;
            }
            at = body.bones[x].parent;
        }
        false
    }).collect();
    // The bones of the segment the cut is in: their flesh past the plane goes too.
    let person_segments = world.get::<Person>(who).unwrap().segments.clone();
    let near: Vec<bool> = (0..body.bones.len()).map(|i| {
        let mut at = Some(i);
        while let Some(x) = at {
            if let Some(k) = person_segments.iter().position(|sg| sg.bone == x) {
                return Some(k) == parent_seg;
            }
            at = body.bones[x].parent;
        }
        false
    }).collect();

    // The meshes: the body's and the piece's, split at the plane.
    if world.get::<Flesh>(who).is_none() {
        // (Every drawn part: skin.rs's list has the skin under the clothes, which person.rs leaves out.)
        let parts: Vec<(usize, Entity)> = match world.get::<crate::skin::Skin>(who) {
            Some(sk) => sk.materials.iter().map(|m| (m.0, m.1)).collect(),
            None => world.get::<Person>(who).unwrap().parts.clone(),
        };
        let f = Flesh::new(body, &parts);
        world.entity_mut(who).insert(f);
    }
    let t_split = std::time::Instant::now();
    let made = split(world, who, &person_body, limb, side, c, n, &gone, &near, root_bone, prox, l.reach, how);
    let split_ms = t_split.elapsed().as_secs_f32() * 1000.0;
    let Some((mut entities, shape)) = made else { return false };

    // The joint lets go: the piece is its own from now on, with no muscle in it.
    world.resource_scope(|world, _: Mut<Rng>| {
        let mut state: bevy::ecs::system::SystemState<(Commands, Query<&mut Ragdoll>, Query<&mut CollisionGroups>, Query<&mut ExternalImpulse>)> =
            bevy::ecs::system::SystemState::new(world);
        let (mut commands, mut rds, mut groups, mut pushes) = state.get_mut(world).unwrap();
        if let Ok(mut rd) = rds.get_mut(who) {
            rd.sever(root, &mut commands, &mut groups);
            if let Some(d) = dir {
                let at = point.unwrap_or_else(|| rd.middle(root));
                let impulse = d * match how {
                    How::Blade => 3.0,
                    How::Shot => 9.0,
                    How::Blast => 25.0,
                } + Vec3::Y * 1.5;
                if let Ok(mut e) = pushes.get_mut(rd.segs[root].entity) {
                    let centre = rd.middle(root);
                    e.impulse += impulse;
                    e.torque_impulse += (at - centre).cross(impulse);
                }
            }
        }
        state.apply(world);
    });

    // The stump's end, for a dressing put on it: the skin's mean distance from the middle of the cut, on the body's side.
    {
        let (mut sum, mut count) = (0.0, 0);
        for part in body.parts.iter().filter(|p| p.kind == "skin") {
            for &q in &body.position[part.vertex_start..part.vertex_start + part.vertex_count] {
                let along = (q - c).dot(n);
                let out = q - c - n * along;
                if (-0.02..=0.0).contains(&along) && out.length() < l.reach * 1.5 {
                    sum += out.length();
                    count += 1;
                }
            }
        }
        let r = if count > 0 { sum / count as f32 } else { l.reach * 0.5 };
        world.get_mut::<Hurt>(who).unwrap().stumps.push((c, n, r));
    }

    // Both ends closed, the blood, the hurt.
    let t_ends = std::time::Instant::now();
    let ends = ends(world, who, body, limb, side, c, n, prox, root_bone, how);
    let ends_ms = t_ends.elapsed().as_secs_f32() * 1000.0;
    shape.start(world, who, ends.caps);
    entities.extend(ends.entities);
    let tip = root_bone;
    let spread = world.get::<Ragdoll>(who).unwrap().segs[root].spread.iter().copied().filter(|&x| x != root_bone).collect();
    let cut = CutOff { limb, side: side.to_string(), how, root, segs, root_bone, spread, prox, tip, c, n, drains: 0.0, entities, gone, near, reach: l.reach };
    crate::anatomy::cut(world, who, &cut);
    bleed(world, who, &cut, &ends.vessels, ends.e1, ends.e2, how);
    let death = hurt(world, who, &cut);
    {
        let mut d = world.get_mut::<Dismember>(who).unwrap();
        d.cuts.push(cut);
        if death {
            d.death = 6.0;
        }
        let n = d.cuts.len() - 1;
        d.cuts[n].drains = 0.04 * (l.reach / 0.1).powi(2);
    }
    let took = started.elapsed().as_secs_f32() * 1000.0;
    world.resource_mut::<crate::profiler::Notes>().add(format!("{}{side} cut off ({how:?}): {took:.1} ms", limb.key()));
    if world.contains_resource::<crate::scenario::Log>() {
        crate::scenario::log(world, json!({ "event": "severed", "limb": limb.key(), "side": side, "how": format!("{how:?}"), "ms": took, "split_ms": split_ms, "ends_ms": ends_ms, "skin": ends.skin_points }));
    }
    true
}

// --- the meshes ------------------------------------------------------------------------------------------------------

// The body's skin and clothes split at the plane through `c` square to `n`: what is past it (and on the limb) given to
// meshes of the piece's own, carried by the limb's bones; what stays carried only by the body's. Returns the piece's
// entities, and what their meshes and the body's are to be made from (`Shape`: on another thread).
#[allow(clippy::too_many_arguments)]
fn split(world: &mut World, who: Entity, body_arc: &std::sync::Arc<Body>, limb: Limb, side: &str, c: Vec3, n: Vec3, gone: &[bool], near: &[bool], root: usize,
         prox: usize, reach: f32, how: How) -> Option<(Vec<Entity>, Shape)> {
    let _ = (limb, side);
    let body = &**body_arc;
    let mut flesh = world.entity_mut(who).take::<Flesh>().unwrap();
    let vertices = body.position.len();
    // Past the plane, and carried by the limb (or by the segment the cut is in, near the cut).
    let past: Vec<bool> = (0..vertices).map(|v| {
        let d = body.position[v] - c;
        if d.dot(n) <= 0.0 {
            return false;
        }
        let (mut limbs, mut here) = (0.0, 0.0);
        for k in 0..4 {
            let w = flesh.weights[v][k];
            if w == 0.0 {
                continue;
            }
            let j = flesh.joints[v][k] as usize;
            if gone[j] {
                limbs += w;
            } else if near[j] {
                here += w;
            }
        }
        limbs > 0.0 || (here > 0.0 && d.length_squared() < reach * reach * 4.0)
    }).collect();
    // Triangles: wholly past (the piece's), not at all (the body's), or across the plane (both, for skin and clothes,
    // which are cut at the plane; anything else goes with the side most of it is on).
    let mut piece: Vec<Vec<u32>> = vec![Vec::new(); body.parts.len()];
    for (pi, p) in body.parts.iter().enumerate() {
        let both = p.kind == "skin" || p.kind == "cloth";
        for i in (p.index_start..p.index_start + p.index_count).step_by(3) {
            let t = [flesh.drawn[i], flesh.drawn[i + 1], flesh.drawn[i + 2]];
            if t[0] == t[1] && t[0] == t[2] {
                continue;
            }
            let k = t.iter().filter(|&&v| past[v as usize]).count();
            if k == 0 {
                continue;
            }
            piece[pi].extend_from_slice(&t);
            if k == 3 || (!both && k >= 2) {
                flesh.drawn[i + 1] = t[0];
                flesh.drawn[i + 2] = t[0];
            }
        }
    }
    if piece.iter().all(|l| l.is_empty()) {
        world.entity_mut(who).insert(flesh);
        return None;
    }
    // The body's corners: whatever weight they had on the limb's bones goes to the bone the limb hung from. (The piece
    // starts from the body's weights as they are before this cut: the file's would carry the corners round an earlier
    // cut lower down, the hand's at the wrist, by the bones of the piece that cut took, and they were stretched from this
    // piece to that one across the floor.)
    let (before_j, before_w) = (flesh.joints.clone(), flesh.weights.clone());
    let reweigh = |j: &mut [u16; 4], w: &mut [f32; 4], from: &dyn Fn(usize) -> bool, to: usize| {
        let mut changed = false;
        for k in 0..4 {
            if w[k] == 0.0 || !from(j[k] as usize) {
                continue;
            }
            match (0..4).find(|&q| q != k && w[q] > 0.0 && j[q] as usize == to) {
                Some(same) => {
                    w[same] += w[k];
                    w[k] = 0.0;
                }
                None => j[k] = to as u16,
            }
            changed = true;
        }
        changed
    };
    let mut kept = vec![false; vertices];
    for t in flesh.drawn.chunks_exact(3) {
        if t[0] != t[1] || t[0] != t[2] {
            for &v in t {
                kept[v as usize] = true;
            }
        }
    }
    for v in 0..vertices {
        if kept[v] {
            let (mut j, mut w) = (flesh.joints[v], flesh.weights[v]);
            reweigh(&mut j, &mut w, &|b| gone[b], prox);
            flesh.joints[v] = j;
            flesh.weights[v] = w;
        }
    }
    // The cut, and its window in the clothes: the skin under them seen round the cut where the sleeve or trouser leg ends
    // with it (skin.rs's hider).
    flesh.planes.push(Plane { c, n, radius: reach, tore: how != How::Blade });
    if let Some(mut sk) = world.get_mut::<crate::skin::Skin>(who) {
        sk.window(c, n, reach, 0.012);
    }
    let k = flesh.planes.len() - 1;
    // Every part the cut touches made again, and every part that lost triangles.
    for (pi, l) in piece.iter().enumerate() {
        if !l.is_empty() {
            flesh.stale[pi] = true;
        }
    }
    flesh.touch(body, c, reach);

    // The piece: per part, its corners carried wholly by the limb's bones, its triangles cut by this plane to its side and
    // by earlier ones to the body's (hider.ts keeps).
    let mut sides = vec![1.0; k + 1];
    sides[k] = -1.0;
    let (mut piece_j, mut piece_w) = (before_j, before_w);
    for list in &piece {
        for &v in list {
            let v = v as usize;
            let (mut j, mut w) = (piece_j[v], piece_w[v]);
            if reweigh(&mut j, &mut w, &|b| !gone[b], root) {
                piece_j[v] = j;
                piece_w[v] = w;
            }
        }
    }
    // Spawned beside the person's parts, in their own materials (skin.rs's, or person.rs's before it has made them), with
    // no mesh until `Shape` has made theirs and the body's parts again.
    let mut entities = Vec::new();
    let mut pieces = Vec::new();
    #[allow(clippy::type_complexity)]
    let mut state: bevy::ecs::system::SystemState<(Commands, Query<&MeshMaterial3d<crate::skin::Flesh>>, Query<&MeshMaterial3d<StandardMaterial>>, Query<&SkinnedMesh>,
                                                   Query<&ChildOf>)> = bevy::ecs::system::SystemState::new(world);
    let space = {
        let (mut commands, own, plain, skins, parents) = state.get_mut(world).unwrap();
        let first = flesh.own[0].1;
        let skin = skins.get(first).unwrap().clone();
        let space = parents.get(first).unwrap().parent();
        for (pi, list) in piece.into_iter().enumerate() {
            if list.is_empty() {
                continue;
            }
            let Some(&(_, part, _)) = flesh.own.iter().find(|o| o.0 == pi) else { continue };
            let e = commands.spawn((skin.clone(), DynamicSkinnedMeshBounds, ChildOf(space))).id();
            match (own.get(part), plain.get(part)) {
                (Ok(m), _) => commands.entity(e).insert(m.clone()),
                (_, Ok(m)) => commands.entity(e).insert(m.clone()),
                _ => {
                    commands.entity(e).despawn();
                    continue;
                }
            };
            entities.push(e);
            pieces.push((e, pi, list));
        }
        space
    };
    state.apply(world);
    let parts: Vec<usize> = (0..flesh.stale.len()).filter(|&i| std::mem::take(&mut flesh.stale[i])).collect();
    let shape = Shape {
        body: body_arc.clone(),
        space,
        pieces,
        piece_j,
        piece_w,
        sides,
        parts,
        flesh: Flesh { joints: flesh.joints.clone(), weights: flesh.weights.clone(), drawn: flesh.drawn.clone(), planes: flesh.planes.clone(), own: Vec::new(), stale: Vec::new() },
    };
    let weights = flesh.weights_for_medicine();
    world.entity_mut(who).insert(flesh);
    world.get_mut::<Hurt>(who).unwrap().weights = Some(weights);
    Some((entities, shape))
}

// What a cut's meshes are made from, off the frame: the piece's parts (each entity, its part and triangles, with the
// piece's bones and weights), the body's parts the cut changed (from a copy of the person's flesh as it is after the
// cut), and the two ends' flat caps (`Caps`). A blade's cut came to 15 to 25 ms of the frame it was made in, most of
// it these meshes; on another thread the frame keeps only the bookkeeping, and the body, the piece and its ends change
// over together a frame or two later (`shaped`), as the cut face's painting already did.
pub struct Shape {
    body: std::sync::Arc<Body>,
    space: Entity,
    pieces: Vec<(Entity, usize, Vec<u32>)>,
    piece_j: Vec<[u16; 4]>,
    piece_w: Vec<[f32; 4]>,
    sides: Vec<f32>,
    parts: Vec<usize>,
    flesh: Flesh,
}

// The flat caps of a cut's two ends (before their faces are painted): what `cutface::cap` takes, and the ends' entities.
pub struct Caps {
    c: Vec3,
    n: Vec3,
    e1: Vec3,
    e2: Vec3,
    skin: Vec<(f32, f32)>,
    bones: Vec<Vec<(f32, f32)>>,
    caps: [(f32, usize, f32); 2],
    torn: bool,
    ends: [Entity; 2],
}

// What came back: the meshes for each entity, the body's parts by index, and how long they took.
struct Shaped {
    meshes: Vec<(Entity, Mesh)>,
    parts: Vec<(usize, Mesh)>,
    ms: f32,
}

// A cut's meshes being made, the `seq`th cut made: one person's are shown in the order they were cut (a blast takes
// several limbs at once, and each one's body is the one before it cut again).
#[derive(Component)]
struct Shaping {
    who: Entity,
    seq: u64,
    task: bevy::tasks::Task<Shaped>,
    done: Option<Shaped>,
}

impl Shape {
    fn start(self, world: &mut World, who: Entity, caps: Option<Caps>) {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let space = self.space;
        let task = bevy::tasks::AsyncComputeTaskPool::get().spawn(async move {
            let t = std::time::Instant::now();
            let Shape { body, pieces, piece_j, piece_w, sides, parts, flesh, .. } = self;
            let mut meshes: Vec<(Entity, Mesh)> = pieces
                .into_iter()
                .map(|(e, pi, list)| {
                    let p = &body.parts[pi];
                    let cut = p.kind == "skin" || p.kind == "cloth";
                    let cuts = Cuts { planes: if cut { &flesh.planes } else { &[] }, sides: &sides, cloth: p.kind == "cloth" };
                    (e, part_mesh(&body, pi, list.chunks_exact(3).map(|t| [t[0], t[1], t[2]]), &piece_j, &piece_w, &cuts))
                })
                .collect();
            let parts = parts.into_iter().map(|i| (i, flesh.part(&body, i))).collect();
            if let Some(k) = caps {
                let flat = crate::cutface::Look::flat(&k.skin, k.torn);
                for ((facing, bone, proud), end) in k.caps.into_iter().zip(k.ends) {
                    meshes.push((end, crate::cutface::cap(k.c, k.n, k.e1, k.e2, &k.skin, &k.bones, &flat, facing, bone, proud, k.torn)));
                }
            }
            Shaped { meshes, parts, ms: t.elapsed().as_secs_f32() * 1000.0 }
        });
        world.spawn((Shaping { who, seq, task, done: None }, ChildOf(space)));
    }
}

// Each cut's meshes made since put in: the piece's and the ends' given theirs, the body's parts made again (each person's
// cuts in order: one waits for the cut before it).
fn shaped(mut commands: Commands, mut jobs: Query<(Entity, &mut Shaping)>, mut flesh: Query<&mut Flesh>, mut meshes: ResMut<Assets<Mesh>>,
          mut handles: Query<&mut Mesh3d>, log: Option<ResMut<crate::scenario::Log>>) {
    let mut order: Vec<(Entity, u64, Entity)> = Vec::new();
    for (e, mut job) in &mut jobs {
        if job.done.is_none() {
            job.done = bevy::tasks::futures::check_ready(&mut job.task);
        }
        order.push((job.who, job.seq, e));
    }
    if order.is_empty() {
        return;
    }
    order.sort();
    let mut log = log;
    let mut waiting: Option<Entity> = None;
    for (who, _, e) in order {
        if waiting == Some(who) {
            continue;
        }
        let Some(done) = jobs.get_mut(e).ok().and_then(|(_, mut j)| j.done.take()) else {
            waiting = Some(who);
            continue;
        };
        for (end, mesh) in done.meshes {
            if let Ok(mut c) = commands.get_entity(end) {
                c.insert(Mesh3d(meshes.add(mesh)));
            }
        }
        if let Ok(mut flesh) = flesh.get_mut(who) {
            for (i, mesh) in done.parts {
                flesh.show(i, mesh, &mut meshes, &mut handles);
            }
        }
        if let Some(log) = log.as_mut() {
            log.0.push(serde_json::json!({ "what": { "event": "cut shaped", "ms": done.ms } }));
        }
        commands.entity(e).despawn();
    }
}

// --- the two ends ------------------------------------------------------------------------------------------------------

struct Ends {
    entities: Vec<Entity>,
    vessels: Vec<Vessel>,
    e1: Vec3,
    e2: Vec3,
    skin_points: usize,
    caps: Option<Caps>,
}

#[derive(Clone)]
struct Solid {
    kind: String,
    name: String,
    loop_: Vec<(f32, f32)>,
}

#[derive(Clone)]
pub struct Vessel {
    kind: String,
    name: String,
    x: f32,
    y: f32,
    r: f32,
}

// Whether a box (rest space) comes within `reach` of the plane's middle and the plane runs through it.
fn box_near(lo: Vec3, hi: Vec3, c: Vec3, n: Vec3, reach: f32) -> bool {
    if lo.x > c.x + reach || hi.x < c.x - reach || lo.y > c.y + reach || hi.y < c.y - reach || lo.z > c.z + reach || hi.z < c.z - reach {
        return false;
    }
    let (mut below, mut above) = (false, false);
    for k in 0..8 {
        let p = Vec3::new(if k & 1 != 0 { hi.x } else { lo.x }, if k & 2 != 0 { hi.y } else { lo.y }, if k & 4 != 0 { hi.z } else { lo.z });
        if (p - c).dot(n) > 0.0 { above = true } else { below = true }
    }
    above && below
}

fn centroid(l: &[(f32, f32)]) -> (f32, f32) {
    let (x, y) = l.iter().fold((0.0, 0.0), |a, p| (a.0 + p.0, a.1 + p.1));
    (x / l.len() as f32, y / l.len() as f32)
}

fn area(l: &[(f32, f32)]) -> f32 {
    loop_area(l.iter().copied())
}

// The stump and the piece closed with what the cut goes through.
#[allow(clippy::too_many_arguments)]
fn ends(world: &mut World, who: Entity, body: &Body, limb: Limb, side: &str, c: Vec3, n: Vec3, prox: usize, tip: usize, how: How) -> Ends {
    let e1 = n.cross(if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
    let e2 = n.cross(e1);
    let l = spec(limb);
    let reach = l.reach;
    let none = Ends { entities: Vec::new(), vessels: Vec::new(), e1, e2, skin_points: 0, caps: None };
    // The skin's outline here: the loop round the middle of the cut.
    let mut tris = Vec::new();
    for p in body.parts.iter().filter(|p| p.kind == "skin") {
        for i in (p.index_start..p.index_start + p.index_count).step_by(3) {
            let q = body.position[body.index[i] as usize];
            if (q - c).abs().max_element() < reach * 1.5 {
                tris.push(i as u32);
            }
        }
    }
    let loops = section(&body.position, &body.index, tris, c, n, e1, e2);
    let pts = |l: &Vec<SectionPoint>| l.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>();
    let mut inside: Vec<&Vec<SectionPoint>> = loops.iter().filter(|l| in_loop(&pts(l), 0.0, 0.0)).collect();
    inside.sort_by(|p, q| area(&pts(p)).abs().total_cmp(&area(&pts(q)).abs()));
    let skin_loop = match inside.first() {
        Some(l) => (*l).clone(),
        None => match loops.iter().max_by(|p, q| area(&pts(p)).abs().total_cmp(&area(&pts(q)).abs())) {
            Some(l) => l.clone(),
            None => return none,
        },
    };
    let skin = pts(&skin_loop);
    // What is inside it: bones and the neck's tubes as outlines, vessels as points.
    let traced: std::sync::Arc<Traced> = world.get::<Hurt>(who).unwrap().traced.clone();
    let mut solids: Vec<Solid> = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for part in &traced.parts {
        let k = part.kind.as_str();
        if !(k.contains("bone") || k.contains("skull") || k.contains("cartilage") || k.contains("airway") || k.contains("oesophagus")) || seen.contains(&part.name.as_str()) {
            continue;
        }
        // (A part split between two bones is one outline: both halves at once.)
        let near: Vec<u32> = traced.parts.iter().filter(|o| o.name == part.name).flat_map(|o| o.clusters.iter()).filter(|cl| box_near(cl.lo, cl.hi, c, n, reach)).flat_map(|cl| cl.tris.iter().copied()).collect();
        if near.is_empty() {
            continue;
        }
        seen.push(&part.name);
        for lp in section(&traced.position, &traced.index, near, c, n, e1, e2) {
            let lp = pts(&lp);
            let mid = centroid(&lp);
            if area(&lp).abs() > 2e-6 && in_loop(&skin, mid.0, mid.1) {
                solids.push(Solid { kind: part.kind.clone(), name: part.name.clone(), loop_: lp });
            }
        }
    }
    let mut vessels: Vec<Vessel> = Vec::new();
    for tube in &traced.tubes {
        for i in 0..tube.points.len().saturating_sub(1) {
            let (p, q) = (tube.points[i].0, tube.points[i + 1].0);
            let (sp, sq) = ((p - c).dot(n), (q - c).dot(n));
            if (sp > 0.0) == (sq > 0.0) {
                continue;
            }
            let at = p.lerp(q, sp / (sp - sq)) - c;
            let (x, y) = (at.dot(e1), at.dot(e2));
            if in_loop(&skin, x, y) {
                vessels.push(Vessel { kind: tube.kind.clone(), name: tube.name.clone(), x, y, r: tube.points[i].1.max(0.0015) });
            }
        }
        // The carotids and jugulars in the file stop at the root of the neck; in a neck they run on straight up it to
        // the skull, so they are carried on up to the cut.
        if limb == Limb::Head && (tube.name.contains("carotid") || tube.name.contains("jugular")) && !vessels.iter().any(|v| v.name == tube.name) {
            let top = tube.points.iter().max_by(|a, b| (a.0 - c).dot(n).total_cmp(&(b.0 - c).dot(n))).unwrap();
            let up = (c - top.0).dot(n);
            if up > 0.0 && up < 0.1 {
                let at = top.0 + n * up - c;
                let (x, y) = (at.dot(e1), at.dot(e2));
                if in_loop(&skin, x, y) {
                    vessels.push(Vessel { kind: tube.kind.clone(), name: tube.name.clone(), x, y, r: top.1.max(0.0025) });
                }
            }
        }
    }
    let torn = how != How::Blade;
    let seed = world.resource_mut::<Rng>().next() * 1000.0;
    let bones: Vec<Vec<(f32, f32)>> = solids.iter().filter(|s| s.kind == "bone" || s.kind == "skull").map(|s| s.loop_.clone()).collect();
    let caps = [(1.0, prox, if torn { 0.016 } else { 0.005 }), (-1.0, tip, if torn { 0.008 } else { 0.004 })];
    // Painted off the frame (AsyncComputeTaskPool: some 30 ms of work), the two ends put in at once plain and flat, and
    // their painted look and shape when it is done (`painted`).
    let job = {
        let (skin, bones) = (skin.clone(), bones.clone());
        let solids: Vec<(String, String, Vec<(f32, f32)>)> = solids.iter().map(|s| (s.kind.clone(), s.name.clone(), s.loop_.clone())).collect();
        let vessels: Vec<(String, String, f32, f32, f32)> = vessels.iter().map(|v| (v.kind.clone(), v.name.clone(), v.x, v.y, v.r)).collect();
        let fat = l.fat / 1000.0;
        bevy::tasks::AsyncComputeTaskPool::get().spawn(async move {
            let t = std::time::Instant::now();
            let look = crate::cutface::paint(&skin, &solids, &vessels, fat, torn, limb == Limb::Hand, limb == Limb::Foot, matches!(limb, Limb::Forearm | Limb::Shin), seed);
            let meshes = caps.map(|(facing, bone, proud)| crate::cutface::cap(c, n, e1, e2, &skin, &bones, &look, facing, bone, proud, torn));
            (look, meshes, t.elapsed().as_secs_f32() * 1000.0)
        })
    };
    let mut entities = Vec::new();
    let mut state: bevy::ecs::system::SystemState<(Commands, ResMut<Assets<Mesh>>, ResMut<Assets<StandardMaterial>>, Query<&Person>, Query<&SkinnedMesh>, Query<&ChildOf>)> =
        bevy::ecs::system::SystemState::new(world);
    {
        let (mut commands, _, mut materials, people, skins, parents) = state.get_mut(world).unwrap();
        let person = people.get(who).unwrap();
        let first = person.parts[0].1;
        let skin_mesh = skins.get(first).unwrap().clone();
        let space = parents.get(first).unwrap().parent();
        let material = materials.add(StandardMaterial { base_color: Color::srgb_u8(110, 18, 14), perceptual_roughness: 0.25, ..default() });
        // The stump's end faces down the limb, carried by the bone it hung from; the piece's the other way, by its own. (Their
        // flat caps are made with the cut's other meshes: `Shape`.)
        for (facing, _, _) in caps {
            entities.push(commands.spawn((MeshMaterial3d(material.clone()), skin_mesh.clone(), DynamicSkinnedMeshBounds, ChildOf(space),
                                          Name::new(format!("{} {} {}{side}", person.label, if facing > 0.0 { "stump" } else { "end" }, limb.key())))).id());
        }
        commands.spawn((Painting { task: job, ends: [entities[0], entities[1]] }, ChildOf(space)));
    }
    state.apply(world);
    // The skin's cut edge: its lip shows the layers it was cut through, a ragged band of them where it was torn (marks.rs).
    let uvs: Vec<Vec2> = skin_loop.iter().map(|p| body.uv[p.a as usize].lerp(body.uv[p.b as usize], p.t)).collect();
    let (mut du, mut dp) = (0.0, 0.0);
    for q in &skin_loop {
        du += body.uv[q.a as usize].distance(body.uv[q.b as usize]);
        dp += body.position[q.a as usize].distance(body.position[q.b as usize]);
    }
    world.resource_scope(|world, mut rng: Mut<Rng>| {
        if let Some(mut sk) = world.get_mut::<crate::skin::Skin>(who) {
            sk.rim(&uvs, du / dp.max(1e-9), if torn { 0.022 } else { 0.005 }, if torn { 0.55 } else { 0.22 }, torn, &mut rng);
        }
    });
    let ends = [entities[0], entities[1]];
    Ends { entities, vessels, e1, e2, skin_points: skin.len(), caps: Some(Caps { c, n, e1, e2, skin, bones, caps, torn, ends }) }
}

// --- blood ---------------------------------------------------------------------------------------------------------------

// A place on the cut face as a wound's mark: no triangle of the skin under it (a stump's end).
fn mark(cut: &CutOff, e1: Vec3, e2: Vec3, x: f32, y: f32) -> Crossing {
    Crossing {
        t: 0.0, kind: Kind::Skin, point: Vec3::ZERO, normal: Vec3::ZERO, uv: Vec2::ZERO, rest: cut.c + e1 * x + e2 * y + cut.n * 0.004, rest_normal: cut.n,
        owner: cut.prox, scale: 1.0, corners: [0; 3], shares: [0.0; 3], cloth: None, open: false, under: false,
    }
}

// Every artery the cut goes through pumps out of the stump, its vein beside it bleeds, and the muscle oozes. The piece
// drains what was in it.
fn bleed(world: &mut World, who: Entity, cut: &CutOff, vessels: &[Vessel], e1: Vec3, e2: Vec3, how: How) {
    let side = match cut.side.as_str() {
        "L" => "left ",
        "R" => "right ",
        _ => "",
    };
    let reach = spec(cut.limb).reach;
    npc::with(world, who, |npc| {
        let v = &mut *npc.vitals;
        for vs in vessels {
            if vs.kind == "cord" {
                continue;
            }
            let arterial = vs.kind == "artery";
            // A torn artery curls up and clamps down a little; a cut one does not.
            let clamp = if how == How::Blade { 1.0 } else { 0.7 };
            v.bleed(Bleed::new(&vs.name, vessel_rate(vs.r, arterial) * clamp).arterial(arterial).spurts(arterial).clots(if arterial { 0.003 } else { 0.01 })
                .mark(Some(mark(cut, e1, e2, vs.x, vs.y))));
            if arterial && !vs.name.contains("carotid") {
                v.bleed(Bleed::new(vs.name.replace("artery", "vein"), vessel_rate(vs.r * 1.2, false)).clots(0.01).mark(Some(mark(cut, e1, e2, vs.x + vs.r * 2.4, vs.y))));
            }
        }
        // The cut muscle and bone marrow ooze, more from a big cut.
        v.bleed(Bleed::new(format!("{side}{} stump", cut.limb.word()), 0.0015 * (reach / 0.1).powi(2)).clots(0.006).mark(Some(mark(cut, e1, e2, 0.0, 0.0))));
        // The blood thrown out as it comes away.
        let (at, normal) = npc.world_of(cut.c, cut.prox, Some(cut.n));
        let blade = how == How::Blade;
        npc.hurt.happened.push(Happened::Spray { at, dir: normal.unwrap(), speed: if blade { 2.5 } else { 5.0 }, ml: if blade { 25.0 } else { 60.0 }, spread: 0.7, size: 1.4 });
    });
}

// What it does to them. True if it kills them (the head).
fn hurt(world: &mut World, who: Entity, cut: &CutOff) -> bool {
    let side = match cut.side.as_str() {
        "L" => "Left ",
        "R" => "Right ",
        _ => "",
    };
    let head = cut.limb == Limb::Head;
    let leg = matches!(cut.limb, Limb::Foot | Limb::Shin | Limb::Thigh);
    npc::with(world, who, |npc| {
        let at = npc.world_of(cut.c, cut.prox, None).0;
        npc.vitals.pain = 1.0;
        npc.crack(at, 0.8);
        npc.sound("flesh", Some(at), 1.0);
        let v = &mut *npc.vitals;
        if head {
            // The brain cut off from its blood and the cord from the body: out at once, dead within seconds.
            v.injure("Decapitated", 12.0);
            v.paralysed_legs = true;
            v.paralysed_arms = true;
            v.breathing = false;
            v.brain_damage = v.brain_damage.max(0.2);
            return;
        }
        v.injure(format!("{side}{} cut off", cut.limb.word()), spec(cut.limb).rank);
        if leg {
            npc.hurt.leg_gone = true;
        }
    });
    if head || leg {
        world.resource_scope(|world, mut rng: Mut<Rng>| {
            if let Some(mut b) = world.get_mut::<Behaviour>(who) {
                b.knock_down(&mut rng);
            }
        });
    }
    head
}

// --- every frame -------------------------------------------------------------------------------------------------------

// What wounds.rs handed over: each edge kept for the end of the swing, each heavy charge tearing a limb off or blowing
// the belly open (viscera.rs).
pub fn taken_system(world: &mut World) {
    let mut q = world.query::<(Entity, &Hurt)>();
    let asked: Vec<(Entity, bool, Vec<(f32, Vec3, Vec3, Crossing, f32)>)> = q
        .iter(world)
        .filter_map(|(e, h)| {
            let edges = h.happened.iter().any(|x| matches!(x, Happened::Edge { .. }));
            let charges: Vec<_> = h.happened.iter().filter_map(|x| if let Happened::Charge { energy, at, dir, hit, calibre } = x { Some((*energy, *at, *dir, hit.clone(), *calibre)) } else { None }).collect();
            (edges || !charges.is_empty()).then_some((e, edges, charges))
        })
        .collect();
    for (who, edges, charges) in asked {
        if world.get::<Dismember>(who).is_none() {
            world.entity_mut(who).insert(Dismember::default());
        }
        if edges {
            gather(world, who);
        }
        for (spent, at, dir, hit, calibre) in charges {
            if !charge(world, who, spent, at, dir) {
                crate::viscera::blown(world, who, &hit, spent, calibre);
            }
        }
    }
}

// Each piece's first bone where its own body is (its parent bone is on the body now, not on it), and the bones a bend
// was spread over kept straight in it; what was in the piece running out of its end; a head off kills in seconds.
fn place_pieces(time: Res<Time>, mut blood: ResMut<crate::blood::Blood>, mut people: Query<(&mut Person, &Transform, &Ragdoll, &mut Dismember, &mut crate::vitals::Vitals)>) {
    let dt = time.delta_secs();
    for (mut person, root, rd, mut d, mut v) in &mut people {
        if d.cuts.is_empty() {
            continue;
        }
        if d.death > 0.0 {
            d.death -= dt;
            if d.death <= 0.0 {
                v.dead = true;
            }
        }
        let body = person.body.clone();
        let pelvis = body.bone("root").head;
        let frame = person.posed.frame;
        let into = (root.rotation * frame.rotation).inverse();
        let mut placed = Vec::new();
        for cut in &d.cuts {
            let now = rd.segs[cut.root].now;
            let q = into * now.rotation;
            let at = pelvis + frame.rotation.inverse() * (root.compute_affine().inverse().transform_point3(now.translation) - frame.translation);
            placed.push((cut.root_bone, q, at));
            for &b in &cut.spread {
                let head = body.bones[b].head;
                placed.push((b, q, at + q * (head - body.bones[cut.root_bone].head)));
            }
        }
        person.placed = placed;
        // What was in the piece runs out of its cut end, less and less.
        for cut in &mut d.cuts {
            if cut.drains > 1e-5 {
                let now = rd.segs[cut.root].now;
                let rest_to_world = |p: Vec3| now.transform_point(p - body.bones[cut.tip].head);
                let end = rest_to_world(cut.c);
                let normal = now.rotation * -cut.n;
                blood.run(end + normal * 0.01, cut.drains * 0.02, dt);
                cut.drains *= (-dt / 25.0).exp();
            }
        }
    }
}

// A cut face being painted, and the two ends it is for.
#[derive(Component)]
struct Painting {
    task: bevy::tasks::Task<(crate::cutface::Look, [Mesh; 2], f32)>,
    ends: [Entity; 2],
}

// Each cut face painted since put in its ends.
fn painted(mut commands: Commands, mut jobs: Query<(Entity, &mut Painting)>, mut meshes: ResMut<Assets<Mesh>>, mut images: ResMut<Assets<Image>>,
           mut materials: ResMut<Assets<StandardMaterial>>, mut ends: Query<(&mut Mesh3d, &mut MeshMaterial3d<StandardMaterial>)>, log: Option<ResMut<crate::scenario::Log>>) {
    let mut log = log;
    for (e, mut job) in &mut jobs {
        // (Not before the ends have their flat caps: `shaped`.)
        if job.ends.iter().any(|&end| ends.get(end).is_err()) {
            continue;
        }
        let Some((look, made, ms)) = bevy::tasks::futures::check_ready(&mut job.task) else { continue };
        let material = crate::cutface::material(&look, &mut images, &mut materials);
        for (end, mesh) in job.ends.iter().zip(made) {
            if let Ok((mut m, mut mat)) = ends.get_mut(*end) {
                m.0 = meshes.add(mesh);
                mat.0 = material.clone();
            }
        }
        if let Some(log) = log.as_mut() {
            log.0.push(serde_json::json!({ "what": { "event": "cut face painted", "ms": ms } }));
        }
        commands.entity(e).despawn();
    }
}

fn clear(mut rds: Query<&mut Ragdoll, With<Dismember>>, mut groups: Query<&mut CollisionGroups>) {
    for mut rd in &mut rds {
        rd.clear_pieces(&mut groups);
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(PostUpdate, (crate::profiler::timed("limbs cut off", taken_system), place_pieces.before(crate::person::pose_people)).chain().before(crate::shards::redraw))
        .add_systems(Update, (crate::profiler::timed("cut meshes put in", shaped), crate::profiler::timed("cut faces put in", painted)).chain())
        .add_systems(FixedUpdate, clear.after(crate::ragdoll::Steps::Read));
}

// Cut `k`'s end in the world now, and which way it faces: the stump's (carried by the bone the limb hung from) or with
// `piece` the piece's (by its own body).
pub fn end_world(world: &mut World, who: Entity, k: usize, piece: bool) -> Option<(Vec3, Vec3)> {
    let (c, n, prox, root, tip) = {
        let d = world.get::<Dismember>(who)?;
        let cut = d.cuts.get(k)?;
        (cut.c, cut.n, cut.prox, cut.root, cut.tip)
    };
    if piece {
        let rd = world.get::<Ragdoll>(who)?;
        let head = world.get::<Person>(who)?.body.bones[tip].head;
        let now = rd.segs[root].now;
        return Some((now.transform_point(c - head), now.rotation * -n));
    }
    npc::with(world, who, |npc| {
        let (at, n) = npc.world_of(c, prox, Some(n));
        (at, n.unwrap())
    })
}

#[allow(dead_code)]
fn _unused(_: Indices, _: PrimitiveTopology, _: VertexAttributeValues, _: RenderAssetUsages, _: Extent3d, _: TextureDimension, _: TextureFormat) {}
