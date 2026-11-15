// What a broken bone looks like (src/sandbox/shards.ts, and bones.ts `_draw`, `_look`, `_drawAll`). In the x-ray: the
// line it broke along, drawn dark where the break crosses the bone's surface, and the pieces it broke into moved off
// where they were. Outside: the end of a broken bone come out through the skin.
//
// A break is a surface through the bone. `cut(p)` says how far a point of the bone (rest space) lies to one side of it,
// so the same few lines draw a transverse break (a plane across the bone), an oblique one (the plane slanted), a spiral
// (the plane wound round the bone's length), or a ring round a bullet's hole. The bone's own triangles are long slivers
// down a shaft, far too coarse to break along, so round a break they are taken out of the x-ray, cut small (region) and
// drawn again here, each small one with the half of the bone it is now part of.
//
// bones.rs hands each break over as `Happened::Drawn` and each end out through the skin as `Happened::Through`. A
// person's breaks are drawn again together, once a frame at most, into three meshes made once and filled in place: the
// bone in the x-ray, any of it out through the skin, and the lines. (The TS made two to four meshes a break and sent
// them to the card as each came: a shotgun's blast breaks a bone a pellet.)

use std::sync::Arc;

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;

use crate::anatomy::{Anatomy, Traced, Xray};
use crate::bones::{across, long_axis, spec, Break};
use crate::npc::{Happened, Hurt};
use crate::person::Person;

const STEP: f32 = 0.004; // m: no side of a triangle round a break longer than this

pub type Cut = Arc<dyn Fn(Vec3) -> f32 + Send + Sync>;
pub type Near = Arc<dyn Fn(Vec3) -> bool + Send + Sync>;

// A small triangle of a broken bone, at rest: its corners, their normals, its middle, the bone that carries it, and
// where it went (`moved`: an index into the person's moves) and whether it is out through the skin.
#[derive(Clone)]
pub struct Tri {
    pub p: [Vec3; 3],
    pub n: [Vec3; 3],
    pub centre: Vec3,
    pub owner: usize,
    pub moved: Option<usize>,
    pub bare: bool,
}

// A piece moved: turned by `turn` about `about`, then moved `shift`.
#[derive(Clone, Copy)]
pub struct Move {
    pub about: Vec3,
    pub turn: Quat,
    pub shift: Vec3,
}

impl Move {
    fn at(&self, p: Vec3) -> Vec3 {
        self.turn * (p - self.about) + self.about + self.shift
    }
}

// A ragged edge for a break, a few millimetres either way, the same at the same place every time it is asked.
pub fn jag(p: Vec3, most: f32) -> f32 {
    most * ((p.x * 731.0 + p.y * 413.0).sin() * (p.y * 617.0 - p.z * 389.0).sin() * 0.7 + 0.3 * (p.z * 977.0 + p.x * 241.0).sin())
}

// One break as drawn: its triangles, the surface it broke along, and its lines (each a surface and where it is drawn).
struct Drawn {
    tris: Vec<Tri>,
    cut: Cut,
    lines: Vec<(Cut, Near)>,
}

// A person's breaks as drawn, and the three meshes they are drawn in.
#[derive(Component, Default)]
pub struct Shards {
    breaks: Vec<Option<Drawn>>,
    moves: Vec<Move>,
    stale: bool,
    meshes: [Option<(Entity, Handle<Mesh>)>; 3],
}

// Bone `name`'s triangles that `take` takes in (any corner or the middle) or that `cut` crosses, taken out of the
// x-ray for whoever asked to draw. Those that `label` puts on more than one side of something (a break, the edge of a
// piece) are cut down small; one left whole that `stays` keeps is left in the x-ray as it was, which is most.
#[allow(clippy::too_many_arguments)]
pub fn region(traced: &Traced, normal: &[Vec3], xray: &mut Xray, name: &str, take: &dyn Fn(Vec3) -> bool, cut: Option<&Cut>,
              label: &dyn Fn(Vec3) -> u64, stays: &dyn Fn(&Tri) -> bool) -> Vec<Tri> {
    let (position, index) = (&traced.position, &traced.index);
    let mut out = Vec::new();
    // (A corner is shared by half a dozen triangles: what it is labelled is worked out once.)
    let mut labels: std::collections::HashMap<u32, u64> = std::collections::HashMap::new();
    for part in traced.parts.iter().filter(|p| p.name == name) {
        let mut taken = Vec::new();
        for c in &part.clusters {
            for &i in &c.tris {
                let i = i as usize;
                if !xray.shows(i) {
                    continue; // taken by an earlier break
                }
                let v = [index[i], index[i + 1], index[i + 2]];
                let q = v.map(|v| position[v as usize]);
                if !take(q[0]) && !take(q[1]) && !take(q[2]) && !take((q[0] + q[1] + q[2]) / 3.0) {
                    let Some(cut) = cut else { continue };
                    let k = q.map(|p| cut(p));
                    if !(k[0].min(k[1]).min(k[2]) <= 0.0 && k[0].max(k[1]).max(k[2]) >= 0.0) {
                        continue;
                    }
                }
                let l = [0, 1, 2].map(|j| *labels.entry(v[j]).or_insert_with(|| label(q[j])));
                let before = out.len();
                split(q, v.map(|v| normal[v as usize]), l, part.owner, label, &mut out);
                if out.len() == before + 1 && stays(&out[before]) {
                    out.pop();
                } else {
                    taken.push(i as u32);
                }
            }
        }
        if !taken.is_empty() {
            xray.hide(index, &taken, part.source);
        }
    }
    out
}

// A triangle halved across its longest side until its corners and middle agree on their `label` or no side is longer
// than STEP.
fn split(p: [Vec3; 3], n: [Vec3; 3], l: [u64; 3], owner: usize, label: &dyn Fn(Vec3) -> u64, out: &mut Vec<Tri>) {
    let sides = [p[0].distance_squared(p[1]), p[1].distance_squared(p[2]), p[2].distance_squared(p[0])];
    let a = if sides[0] >= sides[1] && sides[0] >= sides[2] { 0 } else if sides[1] >= sides[2] { 1 } else { 2 };
    let centre = (p[0] + p[1] + p[2]) / 3.0;
    if sides[a] <= STEP * STEP || (l[0] == l[1] && l[1] == l[2] && label(centre) == l[0]) {
        out.push(Tri { p, n, centre, owner, moved: None, bare: false });
        return;
    }
    let (b, c) = ((a + 1) % 3, (a + 2) % 3);
    let (mp, mn) = (p[a].lerp(p[b], 0.5), n[a].lerp(n[b], 0.5).normalize());
    let ml = label(mp);
    let mut pa = [p[a], mp, p[c]];
    let mut na = [n[a], mn, n[c]];
    let mut la = [l[a], ml, l[c]];
    split(pa, na, la, owner, label, out);
    pa = [mp, p[b], p[c]];
    na = [mn, n[b], n[c]];
    la = [ml, l[b], l[c]];
    split(pa, na, la, owner, label, out);
}

// Whether a surface passes through a triangle.
fn crosses(t: &Tri, cut: &Cut) -> bool {
    let k = t.p.map(|p| cut(p));
    k[0].min(k[1]).min(k[2]) <= 0.0 && k[0].max(k[1]).max(k[2]) >= 0.0
}

// --- how a break looks (bones.ts `_look`) --------------------------------------------------------------------------

type Chunk = Arc<dyn Fn(Vec3) -> i32 + Send + Sync>;
type Mover = Arc<dyn Fn(i32, Vec3) -> (Vec3, Quat) + Send + Sync>;

// How a break looks, in the person's rest space: the bone it takes out of the x-ray (`take`), the surface it broke along
// (`cut`, its line drawn `near` it), any more lines, and the loose pieces (`chunk` says which piece a point of the bone
// is in, -1 none; `mover` where piece `id` went: its shift and turn).
struct Look {
    take: Near,
    cut: Cut,
    near: Near,
    lines: Vec<(Cut, Near)>,
    chunk: Option<Chunk>,
    mover: Option<Mover>,
}

fn tilt(axis: Vec3, angle: f32) -> Quat {
    Quat::from_axis_angle(if axis.length_squared() > 1e-8 { axis.normalize() } else { Vec3::Y }, angle)
}

fn plane(normal: Vec3, rough: f32, origin: Vec3) -> Cut {
    Arc::new(move |p: Vec3| (p - origin).dot(normal) + jag(p, rough))
}

fn ball(c: Vec3, r: f32) -> Near {
    Arc::new(move |p: Vec3| p.distance_squared(c) < r * r)
}

fn look(br: &Break, body: &crate::person::Body, calibre: f32) -> Look {
    let (c, n) = (br.at, br.dir);
    // Lines running out from a blow or a bullet's hole across a flat bone: planes through it, each drawn on one side.
    let radiating = |count: usize, from: f32, to: f32| -> Vec<(Cut, Near)> {
        (0..count)
            .map(|k| {
                let k = k as f32;
                let m = across(n, Vec3::new((k * 2.1 + 0.4).cos(), (k * 1.7).sin(), (k * 2.9).cos()));
                let near: Near = Arc::new(move |p: Vec3| {
                    let d = p.distance(c);
                    d > from && d < to && (p - c).dot(m) > 0.0
                });
                (plane(n.cross(m).normalize(), 0.002, c), near)
            })
            .collect()
    };
    let key = br.key.as_str();
    if spec(key).is_some_and(|b| b.long.is_some()) {
        let (a, u, length, _, _) = long_axis(body, &br.part);
        let d = across(u, n);
        let e2 = u.cross(d);
        let at = move |s: f32| a + u * (s * length);
        let along = move |p: Vec3, s: f32| (p - at(s)).dot(u);
        let outward = move |p: Vec3, s: f32| {
            let r = p - at(s);
            (r - u * r.dot(u)).normalize()
        };
        if br.r#type == "gutter" || br.r#type == "drill hole" {
            // A hole the bullet's width punched through the bone (or a groove scored along it), its rim cracked.
            let r = (calibre * 0.7).max(0.004);
            let off = move |p: Vec3| {
                let q = p - c;
                (q - n * q.dot(n)).length()
            };
            return Look {
                take: ball(c, 0.05),
                cut: Arc::new(move |p| off(p) - r * 1.6 + jag(p, 0.0015)),
                near: ball(c, 0.05),
                lines: Vec::new(),
                chunk: Some(Arc::new(move |p| if off(p) < r { 0 } else { -1 })),
                mover: Some(Arc::new(move |_, _| (n * 0.02, Quat::IDENTITY))),
            };
        }
        let (s, hit, shot) = (br.s, br.hit, br.how == "shot");
        let mid = at(s);
        let rough = match br.r#type.as_str() {
            "comminuted" => 0.005,
            "butterfly" => 0.003,
            _ => 0.0015,
        };
        let cut: Cut = match br.r#type.as_str() {
            "spiral" => Arc::new(move |p| {
                let q = p - mid;
                q.dot(u) - (0.07 * q.dot(e2).atan2(q.dot(d))) / (2.0 * std::f32::consts::PI) + jag(p, 0.0012)
            }),
            "oblique" => Arc::new(move |p| (p - mid).dot(u) + 0.9 * (p - mid).dot(d) + jag(p, 0.0015)),
            _ => Arc::new(move |p| (p - mid).dot(u) + jag(p, rough)),
        };
        let mut look = Look {
            take: Arc::new(move |p| along(p, s).abs() < 0.06 || (shot && along(p, hit).abs() < 0.04)),
            cut,
            near: Arc::new(move |p| along(p, s).abs() < 0.06),
            lines: Vec::new(),
            chunk: None,
            mover: None,
        };
        let at_s = if shot { hit } else { s };
        if br.r#type == "butterfly" {
            // The wedge knocked out of the side the blow (or the bullet) came in on, its point on the far side.
            look.chunk = Some(Arc::new(move |p| {
                let facing = outward(p, at_s).dot(-n);
                if facing > 0.2 && along(p, at_s).abs() < (0.025 * (facing - 0.2)) / 0.8 { 0 } else { -1 }
            }));
            look.mover = Some(Arc::new(move |_, centre| (outward(centre, at_s) * 0.006 + n * if shot { 0.01 } else { 0.0 }, tilt(e2, 0.25))));
        }
        if br.r#type == "comminuted" {
            // Pieces all round the break, thrown out from the bone and, by a bullet, on along its path.
            let zone = if shot { 0.03 } else { 0.018 };
            let sector = std::f32::consts::PI / 3.0;
            look.chunk = Some(Arc::new(move |p| {
                let q = p - at(at_s);
                let x = q.dot(u);
                if x.abs() > zone { -1 } else { ((q.dot(e2).atan2(q.dot(d)) + std::f32::consts::PI) / sector).floor() as i32 + if x > 0.0 { 6 } else { 0 } }
            }));
            look.mover = Some(Arc::new(move |id, centre| {
                let f = id as f32;
                (
                    outward(centre, at_s) * (0.004 + (id % 3) as f32 * 0.003) + n * if shot { 0.008 + (id % 4) as f32 * 0.006 } else { 0.0 },
                    tilt(Vec3::new((f * 1.3).sin(), (f * 2.1).cos(), (f * 0.7).sin()), 0.3),
                )
            }));
        }
        return look;
    }
    if key == "skull" {
        if br.r#type == "depressed" || br.how == "shot" {
            // A disc of bone pushed in on the brain, in a few pieces, with lines running out from it; a bullet's hole is
            // the same, smaller, its bone carried in along the track.
            let shot = br.how == "shot";
            let r = if shot { calibre.max(0.006) } else { 0.022 };
            let m = across(n, Vec3::Y);
            let m2 = n.cross(m);
            return Look {
                take: ball(c, 0.09),
                cut: Arc::new(move |p| p.distance(c) - r * 1.1 + jag(p, 0.0015)),
                near: ball(c, r * 1.6),
                lines: radiating(3, r, 0.08),
                chunk: Some(Arc::new(move |p| {
                    if p.distance(c) < r { (((p - c).dot(m2).atan2((p - c).dot(m)) + std::f32::consts::PI) / (std::f32::consts::PI / 2.0)).floor() as i32 } else { -1 }
                })),
                mover: Some(Arc::new(move |id, centre| (n * if shot { 0.02 } else { 0.007 }, tilt(n.cross(centre - c), 0.25 + id as f32 * 0.03)))),
            };
        }
        if br.r#type == "basilar" {
            return Look { take: ball(c, 0.07), cut: Arc::new(move |p| p.y - c.y + jag(p, 0.003)), near: ball(c, 0.07), lines: Vec::new(), chunk: None, mover: None };
        }
        let mut lines = radiating(if br.ratio > 1.4 { 2 } else { 1 }, 0.0, 0.07);
        let (cut, along) = lines.remove(0);
        return Look { take: ball(c, 0.075), cut, near: along, lines, chunk: None, mover: None };
    }
    if key == "rib" {
        // Broken where the blow landed: a cut down through it across its run; in a flail panel broken in two places, the
        // piece between pushed in.
        let t = across(Vec3::Y.cross(n), Vec3::new(n.z, 0.0, -n.x));
        let other = c + t * 0.07;
        let ribs: Near = Arc::new(move |p| p.distance(c) < 0.15);
        let mut look = Look { take: ribs.clone(), cut: plane(t, 0.003, c), near: ribs.clone(), lines: Vec::new(), chunk: None, mover: None };
        if br.r#type == "flail" {
            look.lines.push((plane(t, 0.003, other), ribs.clone()));
            look.chunk = Some(Arc::new(move |p| if ribs(p) && (p - c).dot(t) > 0.004 && (p - other).dot(t) < -0.004 { 0 } else { -1 }));
            look.mover = Some(Arc::new(move |_, _| (n * 0.01, Quat::IDENTITY)));
        }
        return look;
    }
    if key.contains("vertebra") || key.contains("sacrum") {
        // Across the vertebral body at its level; burst, its pieces pushed out all round, some back into the canal.
        let flat = move |p: Vec3| (p.x - c.x).hypot(p.z - c.z) < 0.06;
        let mut look = Look {
            take: Arc::new(move |p| flat(p) && (p.y - c.y).abs() < 0.03),
            cut: Arc::new(move |p| p.y - c.y + jag(p, 0.0015)),
            near: Arc::new(flat),
            lines: Vec::new(),
            chunk: None,
            mover: None,
        };
        if br.r#type == "burst" || br.r#type == "comminuted" {
            look.chunk = Some(Arc::new(move |p| {
                if flat(p) && (p.y - c.y).abs() < 0.012 { (((p.z - c.z).atan2(p.x - c.x) + std::f32::consts::PI) / (std::f32::consts::PI / 2.0)).floor() as i32 } else { -1 }
            }));
            look.mover = Some(Arc::new(move |_, centre| (Vec3::new(centre.x - c.x, 0.0, centre.z - c.z).normalize_or_zero() * 0.005, Quat::IDENTITY)));
        }
        return look;
    }
    // Any other bone: a line through where it was struck, and pieces there if it shattered.
    let mut look = Look { take: ball(c, 0.05), cut: plane(n.cross(across(n, Vec3::Y)).normalize(), 0.002, c), near: ball(c, 0.05), lines: Vec::new(), chunk: None, mover: None };
    if br.r#type == "comminuted" {
        look.chunk = Some(Arc::new(move |p| if p.distance(c) < 0.014 { (if p.x > c.x { 1 } else { 0 }) + if p.y > c.y { 2 } else { 0 } } else { -1 }));
        look.mover = Some(Arc::new(move |id, _| (n * (0.006 + id as f32 * 0.002), Quat::IDENTITY)));
    }
    look
}

// --- a person's breaks drawn -----------------------------------------------------------------------------------------

// The break drawn: the bone round it taken out of the x-ray and drawn again as it now is, each piece with the half of the
// bone it went with, the loose ones moved, and the line it broke along dark on it.
fn draw(shards: &mut Shards, br: &Break, body: &crate::person::Body, traced: &Traced, normal: &[Vec3], xray: &mut Xray, calibre: f32) -> Drawn {
    let lk = look(br, body, calibre);
    let ax = spec(&br.key).unwrap().long.map(|_| long_axis(body, &br.part));
    // What a point of the bone is on the near or far side of: the break, each line (two bits each), which piece.
    let side = |cut: &Cut, near: &Near, p: Vec3| -> u64 { if near(p) { if cut(p) > 0.0 { 1 } else { 2 } } else { 0 } };
    let label = |p: Vec3| -> u64 {
        let mut l = side(&lk.cut, &lk.near, p);
        for (k, (cut, near)) in lk.lines.iter().enumerate() {
            l |= side(cut, near, p) << (2 * (k + 1));
        }
        l | ((lk.chunk.as_ref().map_or(-1, |c| c(p)) + 1) as u64) << 40
    };
    // A piece of a broken shaft goes with the half on its side of the break, not of the middle.
    let cut = lk.cut.clone();
    let owner = |t: &Tri| match (&br.seg, ax) {
        (Some(_), Some((_, _, _, near, far))) => if cut(t.centre) > 0.0 { far } else { near },
        _ => t.owner,
    };
    let chunk = lk.chunk.clone();
    let stays = |t: &Tri| !chunk.as_ref().is_some_and(|c| c(t.centre) >= 0) && owner(t) == t.owner;
    let mut tris = region(traced, normal, xray, &br.part, &*lk.take, ax.map(|_| &lk.cut), &label, &stays);
    for t in &mut tris {
        t.owner = owner(t);
    }
    if let (Some(chunk), Some(mover)) = (&lk.chunk, &lk.mover) {
        let mut groups: Vec<(i32, Vec<usize>)> = Vec::new();
        for (k, t) in tris.iter().enumerate() {
            let id = chunk(t.centre);
            if id < 0 {
                continue;
            }
            match groups.iter_mut().find(|g| g.0 == id) {
                Some(g) => g.1.push(k),
                None => groups.push((id, vec![k])),
            }
        }
        for (id, group) in groups {
            let centre = group.iter().map(|&k| tris[k].centre).sum::<Vec3>() / group.len() as f32;
            let (shift, turn) = mover(id, centre);
            shards.moves.push(Move { about: centre, turn, shift });
            for k in group {
                tris[k].moved = Some(shards.moves.len() - 1);
            }
        }
    }
    let mut lines = vec![(lk.cut.clone(), lk.near.clone())];
    lines.extend(lk.lines.iter().cloned());
    Drawn { tris, cut: lk.cut, lines }
}

// Triangles as one mesh skinned as the x-ray is (each wholly to its triangle's bone), each put where its move sends it
// and lifted `lift` m along its normal, with a colour a corner if `colour` is given; into `slot`'s mesh, made the first
// time, filled in place after.
#[allow(clippy::too_many_arguments)]
fn sheet(commands: &mut Commands, meshes: &mut Assets<Mesh>, slot: &mut Option<(Entity, Handle<Mesh>)>, tris: &[&Tri], moves: &[Move], lift: f32,
         colour: Option<&dyn Fn(Vec3, usize) -> [f32; 4]>, material: Handle<StandardMaterial>, skin: &SkinnedMesh, parent: Entity) {
    let n = tris.len() * 3;
    let (mut pos, mut nor, mut joints, mut colours) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n), Vec::new());
    for (k, t) in tris.iter().enumerate() {
        let mv = t.moved.map(|k| moves[k]);
        for j in 0..3 {
            let facing = mv.map_or(t.n[j], |m| m.turn * t.n[j]);
            let at = mv.map_or(t.p[j], |m| m.at(t.p[j]));
            pos.push(at + facing * lift);
            nor.push(facing);
            joints.push([t.owner as u16, 0, 0, 0]);
            if let Some(f) = colour {
                colours.push(f(t.p[j], k));
            }
        }
    }
    let empty = pos.is_empty();
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, if empty { vec![Vec3::ZERO; 3] } else { pos })
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, if empty { vec![Vec3::Y; 3] } else { nor })
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(if empty { vec![[0; 4]; 3] } else { joints }))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; n.max(3)])
        .with_inserted_indices(Indices::U32((0..n.max(3) as u32).collect()));
    if colour.is_some() {
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, if empty { vec![[0.0; 4]; 3] } else { colours });
    }
    mesh.generate_skinned_mesh_bounds().ok();
    match slot {
        // (The same asset filled again: the entity, its material and its pipeline stay as they were.)
        Some((_, h)) => {
            if let Some(mut m) = meshes.get_mut(h.id()) {
                *m = mesh;
            }
        }
        None => {
            let h = meshes.add(mesh);
            let e = commands.spawn((Mesh3d(h.clone()), MeshMaterial3d(material), skin.clone(), DynamicSkinnedMeshBounds, ChildOf(parent))).id();
            *slot = Some((e, h));
        }
    }
}

#[derive(Resource)]
pub struct Looks {
    line: Handle<StandardMaterial>,
    bare: Handle<StandardMaterial>,
}

fn looks(mut commands: Commands, mut materials: ResMut<Assets<StandardMaterial>>) {
    commands.insert_resource(Looks {
        // The line a break makes, dark as it is on a film, drawn over the bone it lies on.
        line: materials.add(StandardMaterial {
            base_color: Color::linear_rgb(0.03, 0.01, 0.01),
            emissive: LinearRgba::rgb(0.08, 0.005, 0.005),
            reflectance: 0.0,
            depth_bias: 2.0,
            ..default()
        }),
        // Bone out of the skin: white, its colour the corners' (wet bone going to raw red marrow and clot at the break).
        bare: materials.add(StandardMaterial {
            base_color: Color::WHITE,
            metallic: 0.0,
            perceptual_roughness: 0.38,
            double_sided: true,
            cull_mode: None,
            ..default()
        }),
    });
}

// Every person's new breaks drawn, and their meshes made again once (`_drawAll`).
#[allow(clippy::type_complexity)]
pub fn redraw(
    mut commands: Commands,
    mut people: Query<(Entity, &Person, &Hurt, Option<&mut Shards>)>,
    mut xrays: Query<&mut Xray>,
    mut anatomy: ResMut<Anatomy>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    looks: Res<Looks>,
    parents: Query<&ChildOf>,
) {
    for (e, person, hurt, shards) in &mut people {
        let asked: Vec<&Happened> = hurt.happened.iter().filter(|h| matches!(h, Happened::Drawn { .. } | Happened::Through { .. })).collect();
        if asked.is_empty() && !shards.as_ref().is_some_and(|s| s.stale) {
            continue;
        }
        let Ok(mut xray) = xrays.get_mut(person.insides) else { continue };
        let mut own = Shards::default();
        let fresh = shards.is_none();
        let sh: &mut Shards = match shards {
            Some(s) => s.into_inner(),
            None => &mut own,
        };
        let traced = hurt.traced.clone();
        let normal = &anatomy.bodies[&person.body.name].normal;
        let body = &person.body;
        for h in asked {
            match *h {
                Happened::Drawn { break_index, calibre } => {
                    let d = draw(sh, &hurt.bones.breaks[break_index], body, &traced, normal, &mut xray, calibre);
                    if sh.breaks.len() <= break_index {
                        sh.breaks.resize_with(break_index + 1, || None);
                    }
                    sh.breaks[break_index] = Some(d);
                }
                Happened::Through { break_index, pivot, turn, shift, piece } => {
                    let br = &hurt.bones.breaks[break_index];
                    let Some(Some(d)) = sh.breaks.get_mut(break_index) else { continue };
                    let near = long_axis(body, &br.part).3;
                    let cut = d.cut.clone();
                    let out = move |p: Vec3| {
                        let k = cut(p);
                        k <= 0.0 && k > -piece
                    };
                    // (The end's bone still in the x-ray as it was, taken out to come with it.)
                    let more = region(&traced, normal, &mut xray, &br.part, &out, None, &|_| 0, &|_| false);
                    d.tris.extend(more.into_iter().map(|t| Tri { owner: near, ..t }));
                    sh.moves.push(Move { about: pivot, turn, shift });
                    let k = sh.moves.len() - 1;
                    for t in &mut d.tris {
                        if out(t.centre) {
                            t.moved = Some(k);
                            t.bare = true;
                        }
                    }
                }
                _ => {}
            }
        }
        sh.stale = false;
        // All of this person's breaks, three meshes for all of them.
        let (mut kept, mut bare, mut lines) = (Vec::new(), Vec::new(), Vec::new());
        let mut red: Vec<Cut> = Vec::new();
        for d in sh.breaks.iter().flatten() {
            for t in &d.tris {
                if !t.bare {
                    kept.push(t);
                } else if t.moved.is_some() {
                    bare.push(t);
                    red.push(d.cut.clone());
                }
            }
            for (cut, near) in &d.lines {
                lines.extend(d.tris.iter().filter(|t| t.moved.is_none() && near(t.centre) && crosses(t, cut)));
            }
        }
        let bone = anatomy.look_of("bone", true, &mut materials);
        let space = parents.get(person.insides).map(|c| c.parent()).unwrap_or(e);
        let skin = xray.skin.clone();
        let moves = sh.moves.clone();
        sheet(&mut commands, &mut meshes, &mut sh.meshes[0], &kept, &moves, 0.0, None, bone, &skin, person.insides);
        let colour = |p: Vec3, k: usize| {
            let r = (1.0 + red[k](p) / 0.015).clamp(0.0, 1.0);
            // (Bone under a film of blood, going to raw red marrow and clot at the break: sRGB's numbers, as linear.)
            [0.72 - 0.4 * r, 0.6 - 0.56 * r, 0.5 - 0.47 * r, 1.0]
        };
        if !bare.is_empty() || sh.meshes[1].is_some() {
            sheet(&mut commands, &mut meshes, &mut sh.meshes[1], &bare, &moves, 0.0, Some(&colour), looks.bare.clone(), &skin, space);
        }
        sheet(&mut commands, &mut meshes, &mut sh.meshes[2], &lines, &moves, 0.0007, None, looks.line.clone(), &skin, person.insides);
        if fresh {
            commands.entity(e).insert(own);
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Startup, looks).add_systems(PostUpdate, redraw.before(crate::anatomy::regroup));
}
