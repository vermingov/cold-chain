// What is inside a person (src/sandbox/anatomy.ts): the reader, and the x-ray. Tracing a line through the parts (what
// a shot passes through) is phase 2's (dev/PORT.md).
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
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use serde::Deserialize;

use crate::person::{array, read_file, vec3s, Body, Person, RawArray};

#[derive(Deserialize, Clone)]
pub struct Part {
    pub name: String,
    pub kind: String,
    pub bone: String,
    #[serde(rename = "indexStart")]
    pub index_start: usize,
    #[serde(rename = "indexCount")]
    pub index_count: usize,
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
    pub normal: Vec<Vec3>,
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
        normal: vec3s(get("normal")),
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
];

// Every body's insides, read once, and the x-ray's looks.
#[derive(Resource, Default)]
pub struct Anatomy {
    pub bodies: HashMap<String, Insides>,
    looks: Vec<Handle<StandardMaterial>>,
    meshes: HashMap<String, Vec<(usize, Handle<Mesh>)>>,
}

// The x-ray of one person's insides: the entity holding a mesh for each look, hidden until X.
#[derive(Component)]
pub struct Xray;

impl Anatomy {
    pub fn load(&mut self, names: &[&str]) {
        for &n in names {
            self.bodies.entry(n.to_string()).or_insert_with(|| read(&format!("anatomy/{n}.bin")));
        }
    }

    // The x-ray's look for a kind of thing, whole or hurt.
    fn look(&mut self, k: usize, materials: &mut Assets<StandardMaterial>) -> Handle<StandardMaterial> {
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

    // A mesh of all of a person's insides, skinned to their own skeleton (each corner wholly to one bone), one mesh to
    // a look (Bevy draws a material a mesh: the TS's one submesh to a look, _regroup), under `space`, the person's mesh
    // space, hidden until X.
    pub fn build(&mut self, commands: &mut Commands, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, body: &Body,
                 skin: SkinnedMesh, space: Entity) -> Entity {
        let made = match self.meshes.get(&body.name) {
            Some(m) => m.clone(),
            None => {
                let ins = &self.bodies[&body.name];
                let mut joints = vec![[0u16; 4]; ins.position.len()];
                let mut by_look: Vec<Vec<u32>> = vec![Vec::new(); LOOKS.len()];
                for p in &ins.parts {
                    let look = LOOKS.iter().position(|l| l.0 == p.kind).unwrap_or(0);
                    for t in ins.index[p.index_start..p.index_start + p.index_count].chunks_exact(3) {
                        let mid = (ins.position[t[0] as usize] + ins.position[t[1] as usize] + ins.position[t[2] as usize]) / 3.0;
                        let owner = Insides::owner(body, &p.bone, mid) as u16;
                        for &v in t {
                            joints[v as usize][0] = owner;
                        }
                        by_look[look].extend_from_slice(t);
                    }
                }
                let made: Vec<(usize, Handle<Mesh>)> = by_look
                    .into_iter()
                    .enumerate()
                    .filter(|(_, tris)| !tris.is_empty())
                    .map(|(look, tris)| {
                        // (Each look's mesh keeps only the corners its triangles use.)
                        let mut used: HashMap<u32, u32> = HashMap::new();
                        let mut order = Vec::new();
                        let index: Vec<u32> = tris.iter().map(|&v| *used.entry(v).or_insert_with(|| {
                            order.push(v as usize);
                            order.len() as u32 - 1
                        })).collect();
                        let mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, order.iter().map(|&v| ins.position[v]).collect::<Vec<_>>())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, order.iter().map(|&v| ins.normal[v]).collect::<Vec<_>>())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(order.iter().map(|&v| joints[v]).collect()))
                            .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; order.len()])
                            .with_inserted_indices(Indices::U32(index));
                        (look, meshes.add(mesh))
                    })
                    .collect();
                self.meshes.insert(body.name.clone(), made.clone());
                made
            }
        };
        let xray = commands.spawn((Transform::default(), Visibility::Hidden, Xray, ChildOf(space))).id();
        for (look, mesh) in made {
            let material = self.look(look, materials);
            commands.spawn((Mesh3d(mesh), MeshMaterial3d(material), skin.clone(), ChildOf(xray)));
        }
        xray
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
    app.init_resource::<Anatomy>().init_resource::<Seeing>().add_systems(Update, (toggle, see).chain());
}
