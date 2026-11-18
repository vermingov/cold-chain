// What is inside a person (src/sandbox/anatomy.ts): the reader, the x-ray, and what a line through them meets.
//
// The parts are tools/anatomy.py's: the skeleton, the organs of the head, chest and belly from BodyParts3D, fitted to
// each body, every one hung from a bone of its skeleton. They are kept in that bone's rest space and never moved: a
// question about the world is turned into each bone's rest space instead.
//
// A long bone is in two halves, like the limb it is in (ragdoll.rs): the half past the middle hangs from the mid bone,
// so a broken femur shows broken.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use serde::Deserialize;

use crate::person::{array, read_file, vec3s, Body, Person, RawArray};
use crate::npc::Npc;

#[derive(Deserialize, Clone)]
pub struct Part {
    pub name: String,
    pub kind: String,
    pub bone: String,
    #[serde(rename = "indexStart")]
    pub index_start: usize,
    #[serde(rename = "indexCount")]
    pub index_count: usize,
    // The middle of the part, as the file has it (Babylon's space: `centre()` is Bevy's).
    #[serde(default)]
    centre: [f32; 3],
}

impl Part {
    pub fn centre(&self) -> Vec3 {
        crate::babylon(self.centre[0], self.centre[1], self.centre[2])
    }
}

#[derive(Deserialize)]
struct RawTube {
    name: String,
    kind: String,
    path: Vec<[f32; 4]>,
    bones: Vec<String>,
}

// A vessel or the cord: a line of points with a radius, each hung from a bone.
pub struct Tube {
    pub name: String,
    pub kind: String,
    pub points: Vec<(Vec3, f32, String)>,
}

// One body's insides as read ("CCAF"), in Bevy's space (main.rs `babylon`).
pub struct Insides {
    pub parts: Vec<Part>,
    pub tubes: Vec<Tube>,
    pub position: Vec<Vec3>,
    pub normal: std::sync::Arc<Vec<Vec3>>,
    pub index: Vec<u32>,
}

#[derive(Deserialize)]
struct Header {
    parts: Vec<Part>,
    tubes: Vec<RawTube>,
    arrays: Vec<RawArray>,
}

pub fn read(path: &str) -> Insides {
    let (buf, header, base) = read_file(path, b"CCAF");
    let h: Header = serde_json::from_value(header).expect(path);
    let get = |name: &str| array(&buf, base, &h.arrays, name);
    let index = get("index").chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    Insides {
        parts: h.parts,
        tubes: h.tubes.into_iter().map(|t| Tube {
            name: t.name,
            kind: t.kind,
            points: t.path.iter().zip(t.bones).map(|(p, b)| (crate::babylon(p[0], p[1], p[2]), p[3], b)).collect(),
        }).collect(),
        position: vec3s(get("position")),
        normal: std::sync::Arc::new(vec3s(get("normal"))),
        index,
    }
}

impl Insides {
    // The bone that carries a point of a part hung from `bone`: a long bone's half past the middle belongs to the mid
    // bone, and the head and neck (hung from the neck's first bone in the file, but a turn of the head is spread over
    // the neck's bones down to the skull, ragdoll.ts) go with the neck bone at their height, the skull with the head's.
    pub fn owner(body: &Body, bone: &str, p: Vec3) -> usize {
        if bone == "neck01" {
            let neck = ["neck01", "neck02", "neck03", "head"].map(|n| body.by_name[n]);
            return neck.into_iter().rev().find(|&b| body.bones[b].head.y <= p.y).unwrap_or(neck[0]);
        }
        if let Some((first, side)) = bone.split_once('.') {
            if first.ends_with("01") {
                if let Some(&mid) = body.by_name.get(&format!("mid-{first}.{side}")) {
                    let from = body.bone(bone).head;
                    let d = body.bones[mid].tail - from;
                    let t = (p - from).dot(d) / d.length_squared();
                    return if t > 0.5 { mid } else { body.by_name[bone] };
                }
            }
        }
        body.by_name[bone]
    }
}

// What each kind of thing looks like when it is seen (the x-ray), and when it is hurt.
const LOOKS: &[(&str, [f32; 3])] = &[
    ("bone", [0.86, 0.82, 0.7]), ("skull", [0.86, 0.82, 0.7]), ("cartilage", [0.78, 0.8, 0.82]), ("brain", [0.78, 0.6, 0.6]),
    ("brainstem", [0.78, 0.6, 0.6]), ("heart", [0.55, 0.08, 0.08]), ("lung", [0.85, 0.5, 0.52]), ("liver", [0.4, 0.09, 0.07]),
    ("spleen", [0.38, 0.1, 0.18]), ("kidney", [0.5, 0.15, 0.12]), ("stomach", [0.8, 0.52, 0.48]), ("bowel", [0.85, 0.6, 0.55]),
    ("colon", [0.75, 0.55, 0.45]), ("bladder", [0.85, 0.75, 0.55]), ("pancreas", [0.85, 0.7, 0.5]), ("gallbladder", [0.3, 0.45, 0.2]),
    ("adrenal", [0.85, 0.6, 0.2]), ("muscle", [0.55, 0.15, 0.12]), ("airway", [0.85, 0.75, 0.7]), ("oesophagus", [0.8, 0.5, 0.45]),
    ("artery", [0.75, 0.05, 0.05]), ("vein", [0.2, 0.15, 0.45]), ("cord", [0.92, 0.88, 0.7]),
    ("prostate", [0.7, 0.42, 0.36]), ("gland", [0.8, 0.62, 0.5]), ("penis", [0.6, 0.18, 0.2]), ("testis", [0.82, 0.7, 0.62]),
];

// Every body's insides, read once, and the x-ray's looks.
#[derive(Resource, Default)]
pub struct Anatomy {
    pub bodies: HashMap<String, Insides>,
    // Each body's parts sorted for tracing lines through (`Traced`), made with its x-ray.
    pub traced: HashMap<String, std::sync::Arc<Traced>>,
    looks: Vec<Handle<StandardMaterial>>,
    meshes: HashMap<String, std::sync::Arc<Vec<LookMesh>>>,
}

// One look's mesh of a body's x-ray, shared by everyone of that body until their own is changed: each corner of the file
// it keeps (`local`, u32::MAX for the rest) and the parts drawn in it. `source` is a copy of the mesh for a person's own
// copies to be made from on another thread (`regroup`).
#[derive(Clone)]
pub struct LookMesh {
    pub look: usize,
    pub mesh: Handle<Mesh>,
    pub local: Vec<u32>,
    pub parts: Vec<usize>,
    pub source: std::sync::Arc<Mesh>,
}

// The x-ray of one person's insides: the entity holding a mesh for each look, hidden until X. What is this person's own
// (the file's are shared by everyone of that body): the parts shown hurt, and the triangles taken out of it round a
// break (shards.rs draws those again, broken). A look's mesh is the shared one until something in it changes; then it is
// this person's copy, its triangles regrouped (the TS's `_regroup`), when next seen.
#[derive(Component)]
pub struct Xray {
    pub looks: std::sync::Arc<Vec<LookMesh>>,
    // Each look's entity, and the entity of its hurt twin once anything in it is hurt.
    pub entities: Vec<Entity>,
    pub hurt_entities: Vec<Option<Entity>>,
    owned: Vec<Option<Handle<Mesh>>>,
    hurt_meshes: Vec<Option<Handle<Mesh>>>,
    // The file's parts shown hurt, and this person's own copy of the triangles (None: the file's, untouched).
    pub hurt: Vec<bool>,
    pub drawn: Option<Vec<u32>>,
    // Looks whose triangles changed since they were last grouped, and those being grouped now: each look's mesh made
    // again, and its hurt twin's (when there is anything hurt in it, or there was).
    stale: Vec<bool>,
    regrouping: Option<bevy::tasks::Task<Regrouped>>,
    pub skin: SkinnedMesh,
}

type Regrouped = (Vec<(usize, Mesh, Option<Mesh>)>, f32);

impl Xray {
    // Triangles (offsets into the index) no longer drawn in the x-ray: a broken bone drawn in pieces of its own instead.
    pub fn hide(&mut self, index: &[u32], tris: &[u32], part: usize) {
        let drawn = self.drawn.get_or_insert_with(|| index.to_vec());
        for &i in tris {
            let i = i as usize;
            drawn[i + 1] = drawn[i];
            drawn[i + 2] = drawn[i];
        }
        if let Some(l) = self.looks.iter().position(|l| l.parts.contains(&part)) {
            self.stale[l] = true;
        }
    }

    // Whether triangle `i` (an offset into the index) is still drawn.
    pub fn shows(&self, i: usize) -> bool {
        self.drawn.as_ref().is_none_or(|d| d[i] != d[i + 1])
    }

    // Shown hurt in the x-ray.
    pub fn hurt(&mut self, part: usize) {
        if self.hurt[part] {
            return;
        }
        self.hurt[part] = true;
        if let Some(l) = self.looks.iter().position(|l| l.parts.contains(&part)) {
            self.stale[l] = true;
        }
    }
}

impl Anatomy {
    pub fn load(&mut self, names: &[&str]) {
        for &n in names {
            self.bodies.entry(n.to_string()).or_insert_with(|| read(&format!("anatomy/{n}.bin")));
        }
    }

    // The x-ray's look for a kind of thing, whole or hurt.
    pub fn look(&mut self, k: usize, materials: &mut Assets<StandardMaterial>) -> Handle<StandardMaterial> {
        if self.looks.is_empty() {
            for hurt in [false, true] {
                for &(kind, c) in LOOKS {
                    let rough = if kind == "bone" || kind == "skull" { 0.55 } else { 0.3 };
                    self.looks.push(materials.add(StandardMaterial {
                        base_color: if hurt { Color::linear_rgb(c[0] * 0.45 + 0.25, c[1] * 0.25, c[2] * 0.25) } else { Color::linear_rgb(c[0], c[1], c[2]) },
                        emissive: if hurt { LinearRgba::rgb(0.25, 0.02, 0.02) } else { LinearRgba::BLACK },
                        metallic: 0.0,
                        perceptual_roughness: rough,
                        ..default()
                    }));
                }
            }
        }
        self.looks[k].clone()
    }

    // The x-ray look of a kind of thing by its name (anatomy.ts `material(kind, hurt)`).
    pub fn look_of(&mut self, kind: &str, hurt: bool, materials: &mut Assets<StandardMaterial>) -> Handle<StandardMaterial> {
        let k = LOOKS.iter().position(|l| l.0 == kind).unwrap_or(0);
        self.look(k + if hurt { LOOKS.len() } else { 0 }, materials)
    }

    // A mesh of all of a person's insides, skinned to their own skeleton (each corner wholly to one bone), one mesh to
    // a look (Bevy draws a material a mesh: the TS's one submesh to a look, _regroup: about 224 draws a person had it
    // been a mesh a part), under `space`, the person's mesh space, hidden until X.
    pub fn build(&mut self, commands: &mut Commands, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, body: &Body,
                 skin: SkinnedMesh, space: Entity) -> Entity {
        if !self.traced.contains_key(&body.name) {
            let traced = Traced::new(&self.bodies[&body.name], body);
            self.traced.insert(body.name.clone(), std::sync::Arc::new(traced));
        }
        let made = match self.meshes.get(&body.name) {
            Some(m) => m.clone(),
            None => {
                let ins = &self.bodies[&body.name];
                let mut joints = vec![[0u16; 4]; ins.position.len()];
                let mut by_look: Vec<(Vec<u32>, Vec<usize>)> = vec![(Vec::new(), Vec::new()); LOOKS.len()];
                for (pi, p) in ins.parts.iter().enumerate() {
                    let look = LOOKS.iter().position(|l| l.0 == p.kind).unwrap_or(0);
                    for t in ins.index[p.index_start..p.index_start + p.index_count].chunks_exact(3) {
                        let mid = (ins.position[t[0] as usize] + ins.position[t[1] as usize] + ins.position[t[2] as usize]) / 3.0;
                        let owner = Insides::owner(body, &p.bone, mid) as u16;
                        for &v in t {
                            joints[v as usize][0] = owner;
                        }
                        by_look[look].0.extend_from_slice(t);
                    }
                    by_look[look].1.push(pi);
                }
                let made: Vec<LookMesh> = by_look
                    .into_iter()
                    .enumerate()
                    .filter(|(_, (tris, _))| !tris.is_empty())
                    .map(|(look, (tris, parts))| {
                        // (Each look's mesh keeps only the corners its triangles use.)
                        let mut local = vec![u32::MAX; ins.position.len()];
                        let mut order = Vec::new();
                        let index: Vec<u32> = tris
                            .iter()
                            .map(|&v| {
                                if local[v as usize] == u32::MAX {
                                    local[v as usize] = order.len() as u32;
                                    order.push(v as usize);
                                }
                                local[v as usize]
                            })
                            .collect();
                        let mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, order.iter().map(|&v| ins.position[v]).collect::<Vec<_>>())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, order.iter().map(|&v| ins.normal[v]).collect::<Vec<_>>())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(order.iter().map(|&v| joints[v]).collect()))
                            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; order.len()])
                            .with_inserted_indices(Indices::U32(index))
                            // (Its bounds kept from its bones, as the skin's are: the ragdoll takes them anywhere.)
                            .with_generated_skinned_mesh_bounds()
                            .expect("the insides skinned to their bones");
                        LookMesh { look, source: std::sync::Arc::new(mesh.clone()), mesh: meshes.add(mesh), local, parts }
                    })
                    .collect();
                let made = std::sync::Arc::new(made);
                self.meshes.insert(body.name.clone(), made.clone());
                made
            }
        };
        let xray = commands.spawn((Transform::default(), Visibility::Hidden, ChildOf(space))).id();
        let mut entities = Vec::new();
        for l in made.iter() {
            let material = self.look(l.look, materials);
            entities.push(commands.spawn((Mesh3d(l.mesh.clone()), MeshMaterial3d(material), skin.clone(), DynamicSkinnedMeshBounds, ChildOf(xray))).id());
        }
        let n = made.len();
        let parts = self.bodies[&body.name].parts.len();
        commands.entity(xray).insert(Xray {
            looks: made,
            entities,
            hurt_entities: vec![None; n],
            owned: vec![None; n],
            hurt_meshes: vec![None; n],
            hurt: vec![false; parts],
            drawn: None,
            stale: vec![false; n],
            regrouping: None,
            skin,
        });
        xray
    }
}

// What medicine names hurt shown hurt in the x-ray (Hurt::hurt, anatomy.ts `hurt`), and each person's changed looks
// regrouped, while they are seen: one draw a look, the hurt in a twin of it. The grouping is done on another thread (a
// look's copy of its mesh and its triangles sorted came to 2 to 8 ms of the frame X was pressed in), and put in when it
// is done, a frame or two later.
#[allow(clippy::type_complexity)]
pub fn regroup(
    mut commands: Commands,
    seeing: Res<Seeing>,
    mut anatomy: ResMut<Anatomy>,
    people: Query<(&Person, &crate::npc::Hurt)>,
    mut xrays: Query<&mut Xray>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut handles: Query<&mut Mesh3d>,
    log: Option<ResMut<crate::scenario::Log>>,
) {
    anatomy.look(0, &mut materials);
    let anatomy = anatomy.into_inner();
    let (bodies, looks_of) = (&anatomy.bodies, &anatomy.looks);
    let mut log = log;
    for (p, h) in &people {
        let Ok(mut x) = xrays.get_mut(p.insides) else { continue };
        if h.hurt.len() > x.hurt.iter().filter(|&&b| b).count() {
            let ins = &bodies[&p.body.name];
            for name in &h.hurt {
                for (i, part) in ins.parts.iter().enumerate() {
                    if &part.name == name {
                        x.hurt(i);
                    }
                }
            }
        }
        // A grouping done: each look's new meshes in (a person's own mesh made the first time, filled in place after).
        if let Some(task) = x.regrouping.as_mut() {
            let Some((done, ms)) = bevy::tasks::futures::check_ready(task) else { continue };
            x.regrouping = None;
            let started = std::time::Instant::now();
            let looks = done.len();
            let x = x.into_inner();
            let own = |slot: &mut Option<Handle<Mesh>>, meshes: &mut Assets<Mesh>, mesh: Mesh| match slot {
                Some(h) => {
                    if let Some(mut m) = meshes.get_mut(h.id()) {
                        *m = mesh;
                    }
                    h.clone()
                }
                None => slot.insert(meshes.add(mesh)).clone(),
            };
            for (l, whole, hurt) in done {
                let mesh = own(&mut x.owned[l], &mut meshes, whole);
                if let Ok(mut m) = handles.get_mut(x.entities[l]) {
                    m.0 = mesh;
                }
                if let Some(hurt) = hurt {
                    let mesh = own(&mut x.hurt_meshes[l], &mut meshes, hurt);
                    if x.hurt_entities[l].is_none() {
                        let material = looks_of[x.looks[l].look + LOOKS.len()].clone();
                        let e = commands.spawn((Mesh3d(mesh), MeshMaterial3d(material), x.skin.clone(), DynamicSkinnedMeshBounds, ChildOf(p.insides))).id();
                        x.hurt_entities[l] = Some(e);
                    }
                }
            }
            // (For checks: what regrouping cost the frame, and the other thread.)
            if let Some(log) = log.as_mut() {
                log.0.push(serde_json::json!({ "what": { "event": "xray regrouped", "looks": looks, "ms": started.elapsed().as_secs_f32() * 1000.0, "task_ms": ms } }));
            }
            continue;
        }
        if !seeing.0 || !x.stale.iter().any(|&s| s) {
            continue;
        }
        let stale: Vec<usize> = (0..x.stale.len()).filter(|&l| std::mem::take(&mut x.stale[l])).collect();
        let had_hurt: Vec<bool> = x.hurt_meshes.iter().map(|m| m.is_some()).collect();
        let (looks, traced, drawn, hurt) = (x.looks.clone(), h.traced.clone(), x.drawn.clone(), x.hurt.clone());
        x.regrouping = Some(bevy::tasks::AsyncComputeTaskPool::get().spawn(async move {
            let t = std::time::Instant::now();
            let tris = drawn.as_deref().unwrap_or(&traced.index);
            let done = stale
                .into_iter()
                .map(|l| {
                    let lm = &looks[l];
                    let (mut whole, mut sore) = (Vec::new(), Vec::new());
                    for &pi in &lm.parts {
                        let part = &traced.source[pi];
                        let into = if hurt[pi] { &mut sore } else { &mut whole };
                        for t in tris[part.index_start..part.index_start + part.index_count].chunks_exact(3) {
                            if t[0] != t[1] {
                                into.extend(t.iter().map(|&v| lm.local[v as usize]));
                            }
                        }
                    }
                    // (A copy of the shared mesh, this person's own, its triangles replaced: the corners stay as they are.)
                    let copy = |index: Vec<u32>| {
                        let mut m = (*lm.source).clone();
                        m.insert_indices(Indices::U32(index));
                        m
                    };
                    let twin = (!sore.is_empty() || had_hurt[l]).then(|| copy(sore));
                    (l, copy(whole), twin)
                })
                .collect();
            (done, t.elapsed().as_secs_f32() * 1000.0)
        }));
    }
}

// A limb cut off person `who` (dismember.rs): their insides carried from now on by the bones on each side of the cut
// (`CutOff::carrier`), in the x-ray and in what medicine traces. The x-ray's corners each hang wholly from one bone and
// were shared by triangles hung from different ones (a long bone's halves meet at the middle; a forearm cut off took the
// lower half's bone and left the upper's, and the triangles where they met, and every triangle past the cut still on
// the upper half's bone, stretched a spike from the stump to the hand on the floor). Each look's corners are given the
// bone that carries them now, and the triangles the cut goes through (a corner on each side) are no longer drawn: the
// stump's end and the piece's are closed by the cut faces (cutface.rs), which show the bone's section.
pub fn cut(world: &mut World, who: Entity, cut: &crate::dismember::CutOff) {
    let Some(insides) = world.get::<Person>(who).map(|p| p.insides) else { return };
    let Some(traced) = world.get::<crate::npc::Hurt>(who).map(|h| h.traced.clone()) else { return };
    // What medicine traces: each part's triangles regrouped by the bone that carries them now (a group whose bone changed
    // keeps its place in the list, so a part's index means what it did; a new group goes on the end).
    let mut parts = traced.parts.clone();
    let mut more = Vec::new();
    for tp in &mut parts {
        let mut groups: Vec<(usize, Vec<u32>)> = Vec::new();
        for &i in tp.clusters.iter().flat_map(|c| c.tris.iter()) {
            let t = &traced.index[i as usize..i as usize + 3];
            let mid = (traced.position[t[0] as usize] + traced.position[t[1] as usize] + traced.position[t[2] as usize]) / 3.0;
            let owner = cut.carrier(mid, tp.owner);
            match groups.iter_mut().find(|g| g.0 == owner) {
                Some(g) => g.1.push(i),
                None => groups.push((owner, vec![i])),
            }
        }
        if groups.len() == 1 && groups[0].0 == tp.owner {
            continue;
        }
        let first = groups.iter().position(|g| g.0 == tp.owner).unwrap_or(0);
        for (k, (owner, tris)) in groups.into_iter().enumerate() {
            let clusters = cluster(&traced.position, &traced.index, tris);
            let lo = clusters.iter().fold(Vec3::INFINITY, |a, c| a.min(c.lo));
            let hi = clusters.iter().fold(Vec3::NEG_INFINITY, |a, c| a.max(c.hi));
            let part = TracedPart { owner, clusters, lo, hi, ..tp.clone() };
            if k == first {
                *tp = part;
            } else {
                more.push(part);
            }
        }
    }
    parts.extend(more);
    let tubes = traced.tubes.iter().map(|t| TracedTube { points: t.points.iter().map(|&(p, r, b)| (p, r, cut.carrier(p, b))).collect(), ..t.clone() }).collect();
    let now = std::sync::Arc::new(Traced { parts, tubes, position: traced.position.clone(), index: traced.index.clone(), source: traced.source.clone() });
    if let Some(mut h) = world.get_mut::<crate::npc::Hurt>(who) {
        h.traced = now;
    }

    // The x-ray: this person's own copy of each look whose corners changed bone.
    let Some(mut x) = world.get_mut::<Xray>(insides) else { return };
    let mut looks: Vec<LookMesh> = x.looks.iter().cloned().collect();
    let mut across: Vec<(u32, usize)> = Vec::new();
    let mut changed = Vec::new();
    for (l, lm) in looks.iter_mut().enumerate() {
        let Some(VertexAttributeValues::Uint16x4(was)) = lm.source.attribute(Mesh::ATTRIBUTE_JOINT_INDEX) else { continue };
        let mut joints = was.clone();
        let mut piece = vec![false; joints.len()];
        let mut any = false;
        for (v, &k) in lm.local.iter().enumerate() {
            if k == u32::MAX {
                continue;
            }
            let (p, b) = (traced.position[v], joints[k as usize][0] as usize);
            piece[k as usize] = cut.on_piece(p, b);
            let now = cut.carrier(p, b) as u16;
            if now != joints[k as usize][0] {
                joints[k as usize][0] = now;
                any = true;
            }
        }
        for &pi in &lm.parts {
            let part = &traced.source[pi];
            for i in (part.index_start..part.index_start + part.index_count).step_by(3) {
                let side = |q: usize| piece[lm.local[traced.index[i + q] as usize] as usize];
                if side(0) != side(1) || side(0) != side(2) {
                    across.push((i as u32, pi));
                }
            }
        }
        if any {
            let mut mesh = (*lm.source).clone();
            mesh.insert_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(joints));
            lm.source = std::sync::Arc::new(mesh);
            changed.push(l);
        }
    }
    x.looks = std::sync::Arc::new(looks);
    for l in changed {
        x.stale[l] = true;
    }
    for (i, pi) in across {
        x.hide(&traced.index, &[i], pi);
    }
}

// X: everyone's insides shown through them, the skin and clothes all but gone (sandbox.ts see).
#[derive(Resource, Default)]
pub struct Seeing(pub bool);

fn toggle(keys: Res<ButtonInput<KeyCode>>, mut seeing: ResMut<Seeing>) {
    if keys.just_pressed(KeyCode::KeyX) {
        seeing.0 = !seeing.0;
    }
}

// The skin at 18% and the clothes at 6% while seen through, as the TS's mesh visibility; hair blended rather than cut
// out (cut out, it ignored the visibility and hid a broken skull). Each person's parts have see-through twins of their
// materials, made the first time.
fn see(
    seeing: Res<Seeing>,
    people: Query<&Person>,
    mut xrays: Query<&mut Visibility, With<Xray>>,
    mut parts: Query<&mut MeshMaterial3d<StandardMaterial>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut twins: Local<HashMap<AssetId<StandardMaterial>, (Handle<StandardMaterial>, Handle<StandardMaterial>)>>,
) {
    if !seeing.is_changed() {
        return;
    }
    for p in &people {
        if let Ok(mut v) = xrays.get_mut(p.insides) {
            *v = if seeing.0 { Visibility::Inherited } else { Visibility::Hidden };
        }
        for &(i, e) in &p.parts {
            let Ok(mut m) = parts.get_mut(e) else { continue };
            let part = &p.body.parts[i];
            let original = twins.iter().find(|(_, (_, t))| t.id() == m.0.id()).map(|(_, (o, _))| o.clone()).unwrap_or(m.0.clone());
            if !seeing.0 {
                m.0 = original;
                continue;
            }
            let (_, twin) = twins.entry(original.id()).or_insert_with(|| {
                let mut t = materials.get(&original).unwrap().clone();
                t.alpha_mode = AlphaMode::Blend;
                t.base_color.set_alpha(if part.worn { 0.06 } else { 0.18 });
                (original.clone(), materials.add(t))
            });
            m.0 = twin.clone();
        }
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Anatomy>().init_resource::<Seeing>().add_systems(Update, (toggle, see).chain())
        .add_systems(PostUpdate, crate::profiler::timed("x-ray regrouped", regroup));
}

// --- what a line through them meets ---------------------------------------------------------------------------------

const CLUSTER: usize = 48; // triangles to a box of the coarse tree each part's triangles are sorted into

// A box of a part's triangles (offsets into the index), in rest space.
#[derive(Clone)]
pub struct Cluster {
    pub lo: Vec3,
    pub hi: Vec3,
    pub tris: Vec<u32>,
}

// A part as it is traced: the triangles of one part carried by one bone (a long bone is two, its halves on the bone and
// its mid bone: `half`), sorted into clusters, and the box round all of them.
#[derive(Clone)]
pub struct TracedPart {
    pub name: String,
    pub kind: String,
    // The part in the file (Insides::parts), and the bone that carries this piece of it.
    pub source: usize,
    pub owner: usize,
    pub half: Option<&'static str>,
    pub clusters: Vec<Cluster>,
    pub lo: Vec3,
    pub hi: Vec3,
}

#[derive(Clone)]
pub struct TracedTube {
    pub name: String,
    pub kind: String,
    // Each point at rest, its radius, and the bone that carries it.
    pub points: Vec<(Vec3, f32, usize)>,
}

// One body's insides sorted for tracing, shared by everyone of that body: the parts are kept in their bone's rest space
// and never moved; a question about the world is turned into each bone's rest space instead.
pub struct Traced {
    pub parts: Vec<TracedPart>,
    pub tubes: Vec<TracedTube>,
    pub position: Vec<Vec3>,
    pub index: Vec<u32>,
    // The file's parts, for their centres.
    pub source: Vec<Part>,
}

impl Traced {
    pub fn new(ins: &Insides, body: &Body) -> Traced {
        let mut parts = Vec::new();
        for (k, p) in ins.parts.iter().enumerate() {
            // The triangles of the part by which bone carries them, in the order the bones are first met (the TS's Map).
            let mut groups: Vec<(usize, Vec<u32>)> = Vec::new();
            for i in (p.index_start..p.index_start + p.index_count).step_by(3) {
                let t = &ins.index[i..i + 3];
                let mid = (ins.position[t[0] as usize] + ins.position[t[1] as usize] + ins.position[t[2] as usize]) / 3.0;
                let owner = Insides::owner(body, &p.bone, mid);
                match groups.iter_mut().find(|g| g.0 == owner) {
                    Some(g) => g.1.push(i as u32),
                    None => groups.push((owner, vec![i as u32])),
                }
            }
            let several = groups.len() > 1;
            for (owner, tris) in groups {
                let clusters = cluster(&ins.position, &ins.index, tris);
                // (And the box round all of them: a line misses most parts, and is then tried against none of their boxes.)
                let lo = clusters.iter().fold(Vec3::INFINITY, |a, c| a.min(c.lo));
                let hi = clusters.iter().fold(Vec3::NEG_INFINITY, |a, c| a.max(c.hi));
                let half = several.then(|| if owner == body.by_name[&p.bone] { "upper" } else { "lower" });
                parts.push(TracedPart { name: p.name.clone(), kind: p.kind.clone(), source: k, owner, half, clusters, lo, hi });
            }
        }
        let tubes = ins.tubes.iter().map(|t| TracedTube {
            name: t.name.clone(),
            kind: t.kind.clone(),
            points: t.points.iter().map(|(p, r, b)| (*p, *r, Insides::owner(body, b, *p))).collect(),
        }).collect();
        Traced { parts, tubes, position: ins.position.clone(), index: ins.index.clone(), source: ins.parts.clone() }
    }
}

// A stretch of a line inside a part: how far along the line it goes in and comes out.
#[derive(Clone, Debug)]
pub struct Span {
    pub part: usize,
    pub enter: f32,
    pub leave: f32,
}

// A vessel a line comes near: which tube, the piece of it (index of the point it starts at), how far along the line,
// by how much it is within reach (less than nothing: inside it), and the middle of that piece in the world.
#[derive(Clone, Debug)]
pub struct VesselHit {
    pub tube: usize,
    pub at: usize,
    pub t: f32,
    pub miss: f32,
    pub r#where: Vec3,
}

impl Npc<'_> {
    // Everything the line from `origin` along unit `dir` passes through, nearer than `far`: spans in order, and the
    // vessels it comes within `reach` of. `only` the parts it says, if given.
    pub fn trace(&self, origin: Vec3, dir: Vec3, far: f32, reach: f32, only: Option<&dyn Fn(&TracedPart) -> bool>) -> (Vec<Span>, Vec<VesselHit>) {
        let held = self.held();
        let mats = match &held {
            Some(_) => Vec::new(),
            None => self.bone_worlds(),
        };
        trace(&self.traced, &mats, held.as_deref(), origin, dir, far, reach, only)
    }

    // Where a point of a tube is now, in the world.
    pub fn tube_point(&self, tube: usize, i: usize) -> Vec3 {
        let p = &self.traced.tubes[tube].points[i];
        self.rest_to_world(p.2).transform_point3(p.0)
    }
}

// Npc::trace through `tr`, each bone's matrix to the world `mats`, or held (crate::npc::Held: the matrices, their
// inverses and the vessels' points worked out once) and then `mats` is not read. Asked by many lines at once on the
// compute threads for a grenade's fragments.
#[allow(clippy::too_many_arguments)]
pub fn trace(tr: &Traced, mats: &[bevy::math::Affine3A], held: Option<&crate::npc::Held>, origin: Vec3, dir: Vec3, far: f32, reach: f32,
             only: Option<&dyn Fn(&TracedPart) -> bool>) -> (Vec<Span>, Vec<VesselHit>) {
    let mut spans: Vec<Span> = Vec::new();
    let mut ts: Vec<f32> = Vec::new();
    for (k, part) in tr.parts.iter().enumerate() {
        if only.is_some_and(|f| !f(part)) {
            continue;
        }
        let inv = held.map_or_else(|| mats[part.owner].inverse(), |h| h.inverse[part.owner]);
        let o = inv.transform_point3(origin);
        let d = inv.transform_vector3(dir);
        if !slab(o, d, part.lo, part.hi, far) {
            continue;
        }
        ts.clear();
        for c in &part.clusters {
            if !slab(o, d, c.lo, c.hi, far) {
                continue;
            }
            for &i in &c.tris {
                let t = triangle(o, d, &tr.position, &tr.index, i as usize);
                if t > 0.0 && t < far {
                    ts.push(t);
                }
            }
        }
        if ts.is_empty() {
            continue;
        }
        ts.sort_by(f32::total_cmp);
        // In and out of a closed surface in turns; one left over is a way in that never came out before `far`.
        for j in (0..ts.len()).step_by(2) {
            spans.push(Span { part: k, enter: ts[j], leave: if j + 1 < ts.len() { ts[j + 1] } else { far.min(ts[j] + 0.01) } });
        }
    }
    // (Stable, as the TS's: spans that start together keep the parts' order.)
    spans.sort_by(|a, b| a.enter.total_cmp(&b.enter));
    // A hollow organ (the heart's chambers, the bowel) is crossed many times: one span from its first wall to its last.
    let mut k = spans.len();
    while k > 1 {
        k -= 1;
        let name = &tr.parts[spans[k].part].name;
        if let Some(prev) = (0..k).rev().find(|&j| &tr.parts[spans[j].part].name == name) {
            if spans[k].enter - spans[prev].leave < 0.08 {
                spans[prev].leave = spans[prev].leave.max(spans[k].leave);
                spans.remove(k);
            }
        }
    }

    // The vessels it passes, for a trace through everything (a wound's track): one through only some parts (a bone, the
    // body's wall) is asked only where those are, and every segment of every tube held against the line is wasted on it.
    let mut vessels = Vec::new();
    for (ti, tube) in tr.tubes.iter().enumerate().filter(|_| only.is_none()) {
        let mut best: Option<VesselHit> = None;
        let world = |i: usize| match held {
            Some(h) => h.tubes[ti][i],
            None => mats[tube.points[i].2].transform_point3(tube.points[i].0),
        };
        for i in 0..tube.points.len().saturating_sub(1) {
            let (a, b) = (world(i), world(i + 1));
            let (t, distance) = ray_to_segment(origin, dir, a, b);
            let miss = distance - tube.points[i].1 - reach;
            if t > 0.0 && t < far && miss < 0.0 && best.as_ref().is_none_or(|x| miss < x.miss) {
                best = Some(VesselHit { tube: ti, at: i, t, miss, r#where: a.lerp(b, 0.5) });
            }
        }
        vessels.extend(best);
    }
    vessels.sort_by(|a, b| a.t.total_cmp(&b.t));
    (spans, vessels)
}

// The triangles `tris` (offsets into `index`) sorted into boxes of about CLUSTER each, by halving the longest side.
fn cluster(position: &[Vec3], index: &[u32], tris: Vec<u32>) -> Vec<Cluster> {
    let centre = |i: u32, axis: usize| {
        let i = i as usize;
        (position[index[i] as usize][axis] + position[index[i + 1] as usize][axis] + position[index[i + 2] as usize][axis]) / 3.0
    };
    let mut out = Vec::new();
    fn split(list: Vec<u32>, position: &[Vec3], index: &[u32], centre: &dyn Fn(u32, usize) -> f32, out: &mut Vec<Cluster>) {
        let (mut lo, mut hi) = (Vec3::INFINITY, Vec3::NEG_INFINITY);
        for &i in &list {
            for k in 0..3 {
                let p = position[index[i as usize + k] as usize];
                lo = lo.min(p);
                hi = hi.max(p);
            }
        }
        if list.len() <= CLUSTER {
            out.push(Cluster { lo, hi, tris: list });
            return;
        }
        let size = hi - lo;
        let axis = if size.x > size.y && size.x > size.z { 0 } else if size.y > size.z { 1 } else { 2 };
        let mut list = list;
        list.sort_by(|&a, &b| centre(a, axis).total_cmp(&centre(b, axis)));
        let second = list.split_off(list.len() >> 1);
        split(list, position, index, centre, out);
        split(second, position, index, centre, out);
    }
    split(tris, position, index, &centre, &mut out);
    out
}

// Whether the line meets the box before `far`. (Each axis written out: it is asked of every box of every part for each
// line, thousands of times a shot.) A direction with a zero part divides to infinities, as the TS's did.
pub fn slab(o: Vec3, d: Vec3, lo: Vec3, hi: Vec3, far: f32) -> bool {
    let (mut t0, mut t1) = (0.0f32, far);
    for k in 0..3 {
        let a = (lo[k] - o[k]) / d[k];
        let b = (hi[k] - o[k]) / d[k];
        // (A ray along a face of the box is 0 / 0 here: in the TS's Math.max and Math.min the NaN poisons every test after
        // it, and the box counts as crossed.)
        if a.is_nan() || b.is_nan() {
            return true;
        }
        let (near, far_) = (a.min(b), a.max(b));
        t0 = t0.max(near);
        t1 = t1.min(far_);
        if t0 > t1 {
            return false;
        }
    }
    true
}

// Möller and Trumbore: how far along the line the triangle at `i` is met, or -1.
pub fn triangle(o: Vec3, d: Vec3, p: &[Vec3], index: &[u32], i: usize) -> f32 {
    let a = p[index[i] as usize];
    let e1 = p[index[i + 1] as usize] - a;
    let e2 = p[index[i + 2] as usize] - a;
    let pv = d.cross(e2);
    let det = e1.dot(pv);
    if det.abs() < 1e-12 {
        return -1.0;
    }
    let f = 1.0 / det;
    let s = o - a;
    let u = f * s.dot(pv);
    if !(0.0..=1.0).contains(&u) {
        return -1.0;
    }
    let q = s.cross(e1);
    let v = f * d.dot(q);
    if v < 0.0 || u + v > 1.0 {
        return -1.0;
    }
    f * e2.dot(q)
}

// The nearest the line (o, unit d) comes to the segment a-b: how far along the line, and how near.
pub fn ray_to_segment(o: Vec3, d: Vec3, a: Vec3, b: Vec3) -> (f32, f32) {
    let u = b - a;
    let w = o - a;
    let (uu, ud, uw, dw) = (u.dot(u), u.dot(d), u.dot(w), d.dot(w));
    let den = uu - ud * ud;
    let s = if den > 1e-9 { (uw - ud * dw) / den } else { 0.0 }.clamp(0.0, 1.0);
    let p = a + u * s;
    let t = (p - o).dot(d);
    (t, (o + d * t - p).length())
}


// --- cross-sections --------------------------------------------------------------------------------------------------
//
// Where a plane cuts a closed surface: the outline it leaves on the plane. A limb cut through shows the skin's outline,
// and inside it each bone's, each read off the same triangles that are drawn (dismember.rs).

// A point of an outline: metres from the plane's middle along its own directions, and the edge it lies on (corners `a`
// and `b`, `t` of the way from a to b), to read anything else there off the corners.
#[derive(Clone, Copy, Debug)]
pub struct SectionPoint {
    pub x: f32,
    pub y: f32,
    pub a: u32,
    pub b: u32,
    pub t: f32,
}

// Where the plane through `c` square to unit `n` cuts triangles `tris` (offsets into `index`, corners in `position`):
// loops of points in the plane's own directions `e1`, `e2`. A surface whose corners are doubled along a seam (the skin's
// picture) leaves pieces of outline that are joined again where their ends meet.
pub fn section(position: &[Vec3], index: &[u32], tris: impl IntoIterator<Item = u32>, c: Vec3, n: Vec3, e1: Vec3, e2: Vec3) -> Vec<Vec<SectionPoint>> {
    let side = |v: u32| (position[v as usize] - c).dot(n);
    let mut points: HashMap<u64, SectionPoint> = HashMap::new();
    let mut links: HashMap<u64, Vec<u64>> = HashMap::new();
    // (The links in the order they were made, so that the walk is the TS's whatever the map's order.)
    let mut order: Vec<u64> = Vec::new();
    for i in tris {
        let i = i as usize;
        let v = [index[i], index[i + 1], index[i + 2]];
        let s = v.map(side);
        let mut crossed = [0u64; 3];
        let mut k = 0;
        for j in 0..3 {
            let (a, b, sa, sb) = (v[j], v[(j + 1) % 3], s[j], s[(j + 1) % 3]);
            if (sa > 0.0) == (sb > 0.0) {
                continue;
            }
            let key = if a < b { (a as u64) << 32 | b as u64 } else { (b as u64) << 32 | a as u64 };
            points.entry(key).or_insert_with(|| {
                let t = sa / (sa - sb);
                let p = position[a as usize].lerp(position[b as usize], t) - c;
                SectionPoint { x: p.dot(e1), y: p.dot(e2), a, b, t }
            });
            crossed[k] = key;
            k += 1;
        }
        if k == 2 {
            for (x, y) in [(crossed[0], crossed[1]), (crossed[1], crossed[0])] {
                let l = links.entry(x).or_insert_with(|| {
                    order.push(x);
                    Vec::new()
                });
                l.push(y);
            }
        }
    }
    // Walk the links, from loose ends first so that a broken outline is walked whole.
    let mut used: std::collections::HashSet<u64> = std::collections::HashSet::new();
    let mut chains: Vec<Vec<SectionPoint>> = Vec::new();
    let mut walk = |start: u64, used: &mut std::collections::HashSet<u64>| {
        let mut chain = Vec::new();
        let (mut prev, mut at) = (u64::MAX, Some(start));
        while let Some(k) = at {
            if !used.insert(k) {
                break;
            }
            chain.push(points[&k]);
            let next = links[&k].iter().copied().find(|&x| x != prev && !used.contains(&x));
            prev = k;
            at = next;
        }
        if chain.len() > 1 {
            chains.push(chain);
        }
    };
    for &k in &order {
        if links[&k].len() == 1 && !used.contains(&k) {
            walk(k, &mut used);
        }
    }
    for &k in &order {
        if !used.contains(&k) {
            walk(k, &mut used);
        }
    }
    // Pieces whose ends meet (within half a millimetre) are one outline.
    let near = |p: &SectionPoint, q: &SectionPoint| (p.x - q.x).hypot(p.y - q.y) < 0.0005;
    let mut joined = true;
    while joined {
        joined = false;
        'outer: for i in 0..chains.len() {
            if near(&chains[i][0], chains[i].last().unwrap()) {
                continue;
            }
            for j in 0..chains.len() {
                if i == j {
                    continue;
                }
                let (a0, a1) = (chains[i][0], *chains[i].last().unwrap());
                let (b0, b1) = (chains[j][0], *chains[j].last().unwrap());
                let mut b = chains[j].clone();
                if near(&a1, &b0) {
                    chains[i].extend(b);
                } else if near(&a1, &b1) {
                    b.reverse();
                    chains[i].extend(b);
                } else if near(&a0, &b1) {
                    b.extend(chains[i].drain(..));
                    chains[i] = b;
                } else if near(&a0, &b0) {
                    b.reverse();
                    b.extend(chains[i].drain(..));
                    chains[i] = b;
                } else {
                    continue;
                }
                chains.remove(j);
                joined = true;
                break 'outer;
            }
        }
    }
    chains.retain(|l| l.len() >= 3);
    chains
}

// The area of a loop of points (positive one way round, negative the other).
pub fn loop_area(points: impl Iterator<Item = (f32, f32)> + Clone) -> f32 {
    let v: Vec<(f32, f32)> = points.collect();
    let mut s = 0.0;
    let mut j = v.len().wrapping_sub(1);
    for i in 0..v.len() {
        s += (v[j].0 - v[i].0) * (v[j].1 + v[i].1);
        j = i;
    }
    s / 2.0
}

// Whether point (x, y) is inside a loop.
pub fn in_loop(points: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut inside = false;
    let mut j = points.len().wrapping_sub(1);
    for i in 0..points.len() {
        let (a, b) = (points[i], points[j]);
        if (a.1 > y) != (b.1 > y) && x < (b.0 - a.0) * (y - a.1) / (b.1 - a.1) + a.0 {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_and_triangle() {
        // A line along x past a segment along z one unit up: nearest at t = 2, one away.
        let (t, d) = ray_to_segment(Vec3::ZERO, Vec3::X, Vec3::new(2.0, 1.0, -1.0), Vec3::new(2.0, 1.0, 1.0));
        assert!((t - 2.0).abs() < 1e-6 && (d - 1.0).abs() < 1e-6);
        // Beyond its end the end is nearest.
        let (t, d) = ray_to_segment(Vec3::ZERO, Vec3::X, Vec3::new(2.0, 0.0, 1.0), Vec3::new(2.0, 0.0, 3.0));
        assert!((t - 2.0).abs() < 1e-6 && (d - 1.0).abs() < 1e-6);
        let p = [Vec3::new(1.0, -1.0, -1.0), Vec3::new(1.0, 1.0, -1.0), Vec3::new(1.0, 0.0, 1.0)];
        assert!((triangle(Vec3::ZERO, Vec3::X, &p, &[0, 1, 2], 0) - 1.0).abs() < 1e-6);
        assert!(triangle(Vec3::new(0.0, 5.0, 0.0), Vec3::X, &p, &[0, 1, 2], 0) < 0.0);
        assert!(slab(Vec3::ZERO, Vec3::X, Vec3::new(1.0, -1.0, -1.0), Vec3::new(2.0, 1.0, 1.0), 3.0));
        assert!(!slab(Vec3::ZERO, Vec3::X, Vec3::new(1.0, -1.0, -1.0), Vec3::new(2.0, 1.0, 1.0), 0.5));
    }

    // A unit cube cut through its middle across y: one square outline of side 1, area 1, the middle inside it.
    #[test]
    fn cube_section() {
        let p: Vec<Vec3> = (0..8).map(|k| Vec3::new((k & 1) as f32, ((k >> 1) & 1) as f32, ((k >> 2) & 1) as f32) - 0.5).collect();
        let index: Vec<u32> = vec![0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
        let loops = section(&p, &index, (0..12).map(|t| t * 3), Vec3::ZERO, Vec3::Y, Vec3::X, Vec3::Z);
        assert_eq!(loops.len(), 1);
        let pts: Vec<(f32, f32)> = loops[0].iter().map(|q| (q.x, q.y)).collect();
        assert!((loop_area(pts.iter().copied()).abs() - 1.0).abs() < 1e-5, "{pts:?}");
        assert!(in_loop(&pts, 0.0, 0.0) && !in_loop(&pts, 0.7, 0.0));
    }

    // A trace through a body held (Npc::hold: its matrices, their inverses and its vessels' points worked out once) finds
    // what the same trace finds working them out itself: a unit cube on a turned and moved bone, a vessel through it.
    #[test]
    fn held_trace_is_the_same() {
        let position: Vec<Vec3> = (0..8).map(|k| Vec3::new((k & 1) as f32, ((k >> 1) & 1) as f32, ((k >> 2) & 1) as f32) - 0.5).collect();
        let index: Vec<u32> = vec![0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
        let clusters = cluster(&position, &index, (0..12).map(|t| t * 3).collect());
        let part = TracedPart { name: "liver".into(), kind: "liver".into(), source: 0, owner: 1, half: None, clusters, lo: Vec3::splat(-0.5), hi: Vec3::splat(0.5) };
        let tube = TracedTube { name: "vena".into(), kind: "vein".into(), points: vec![(Vec3::new(0.0, -1.0, 0.0), 0.01, 1), (Vec3::new(0.0, 1.0, 0.0), 0.01, 1)] };
        let tr = Traced { parts: vec![part], tubes: vec![tube], position, index, source: Vec::new() };
        let mats = vec![bevy::math::Affine3A::IDENTITY, bevy::math::Affine3A::from_rotation_translation(Quat::from_rotation_y(0.7), Vec3::new(3.0, 0.2, 0.0))];
        let held = crate::npc::Held {
            inverse: mats.iter().map(|m| m.inverse()).collect(),
            tubes: tr.tubes.iter().map(|t| t.points.iter().map(|&(p, _, b)| mats[b].transform_point3(p)).collect()).collect(),
            worlds: mats.clone(),
        };
        let (a, va) = trace(&tr, &mats, None, Vec3::ZERO, Vec3::X, 10.0, 0.02, None);
        let (b, vb) = trace(&tr, &[], Some(&held), Vec3::ZERO, Vec3::X, 10.0, 0.02, None);
        assert_eq!(a.len(), 1);
        assert_eq!(va.len(), 1);
        assert_eq!(format!("{a:?}{va:?}"), format!("{b:?}{vb:?}"));
    }
}
