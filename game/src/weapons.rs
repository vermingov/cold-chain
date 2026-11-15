// What the player holds (src/sandbox/weapons.ts). For now: what there is to hold and what is at hand (the HUD's slots
// and ammunition), and the models, loaded and turned so their grip is at the hand and they point ahead. Using them,
// the first-person arms and the parts that move are phase 2's (dev/PORT.md).

use std::collections::HashMap;

use bevy::gltf::{Gltf, GltfMesh, GltfNode};
use bevy::prelude::*;
use serde::Deserialize;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Blade,
    Blunt,
    Gun,
    Grenade,
    Grab,
    Fists,
    Throw,
    Dress,
}

pub struct Arm {
    pub key: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    // A gun's magazine.
    pub rounds: Option<u32>,
}

// Everything there is to hold, in weapons.ts's order (the TS's ARMS; the numbers each is used with come with it).
pub const ARMS: &[Arm] = &[
    Arm { key: "knife", name: "Knife", kind: Kind::Blade, rounds: None },
    Arm { key: "sword", name: "Sword", kind: Kind::Blade, rounds: None },
    Arm { key: "bat", name: "Baseball bat", kind: Kind::Blunt, rounds: None },
    Arm { key: "pistol", name: "Pistol", kind: Kind::Gun, rounds: Some(15) },
    Arm { key: "rifle", name: "Rifle", kind: Kind::Gun, rounds: Some(5) },
    Arm { key: "shotgun", name: "Shotgun", kind: Kind::Gun, rounds: Some(2) },
    Arm { key: "ak", name: "AK-47", kind: Kind::Gun, rounds: Some(30) },
    Arm { key: "m4", name: "M4A1", kind: Kind::Gun, rounds: Some(30) },
    Arm { key: "deagle", name: "Desert Eagle .50", kind: Kind::Gun, rounds: Some(7) },
    Arm { key: "r22", name: ".22 rifle (10/22)", kind: Kind::Gun, rounds: Some(10) },
    Arm { key: "shovel", name: "Shovel", kind: Kind::Blunt, rounds: None },
    Arm { key: "sledge", name: "Sledgehammer", kind: Kind::Blunt, rounds: None },
    Arm { key: "hammer", name: "Claw hammer", kind: Kind::Blunt, rounds: None },
    Arm { key: "grenade", name: "M67 grenade", kind: Kind::Grenade, rounds: None },
    Arm { key: "hands", name: "Hands", kind: Kind::Grab, rounds: None },
    Arm { key: "fists", name: "Fists", kind: Kind::Fists, rounds: None },
    Arm { key: "throw", name: "Throw things", kind: Kind::Throw, rounds: None },
    Arm { key: "bandage", name: "Bandage", kind: Kind::Dress, rounds: None },
    Arm { key: "medkit", name: "Medkit", kind: Kind::Dress, rounds: None },
];

pub fn arm(key: &str) -> &'static Arm {
    ARMS.iter().find(|a| a.key == key).unwrap_or_else(|| panic!("no arm {key}"))
}

// What is carried: six at hand (1 to 6), twelve more in the bag. An empty hand is the hands.
#[derive(Resource)]
pub struct Weapons {
    pub slots: [Option<&'static str>; 6],
    pub bag: [Option<&'static str>; 12],
    pub slot: usize,
    pub ammo: HashMap<&'static str, u32>,
}

impl Default for Weapons {
    fn default() -> Self {
        Weapons {
            slots: [Some("pistol"), Some("knife"), Some("fists"), None, None, None],
            bag: [None; 12],
            slot: 0,
            ammo: ARMS.iter().filter_map(|a| a.rounds.map(|r| (a.key, r))).collect(),
        }
    }
}

impl Weapons {
    pub fn arm(&self) -> &'static Arm {
        arm(self.slots[self.slot].unwrap_or("hands"))
    }
}

// weapons.json: each model's file, and where on it (in its own glTF frame) the hand grips it, its muzzle or point,
// which way is up on it (a blade's back), and a gun's ejection port.
#[derive(Deserialize, Clone)]
pub struct Spec {
    pub file: String,
    pub grip: [f32; 3],
    pub tip: [f32; 3],
    pub up: [f32; 3],
    pub ejection: Option<[f32; 3]>,
    #[serde(rename = "ejectDir")]
    pub eject_dir: Option<[f32; 3]>,
}

#[derive(Resource, Default)]
pub struct WeaponModels {
    pub specs: HashMap<String, Spec>,
    pub gltf: HashMap<String, Handle<Gltf>>,
}

impl WeaponModels {
    // The turn and offset that put a model's grip at the hand's origin, its bore (or blade) pointing ahead (-Z) and its
    // up up, applied to the glTF scene as it comes in. (The TS turned it so in Babylon's space from where Babylon's
    // glTF loader put it, half a turn about Y from the file's own frame; this is that seen in the mirror.)
    pub fn held(&self, key: &str) -> Transform {
        let j = &self.specs[key];
        let file = Quat::from_rotation_y(std::f32::consts::PI);
        let p = |a: [f32; 3]| file * Vec3::from(a);
        let grip = p(j.grip);
        let tip = p(j.tip);
        let up = (p([j.grip[0] + j.up[0], j.grip[1] + j.up[1], j.grip[2] + j.up[2]]) - grip).normalize();
        // (Ahead is along the bore, square to the model's up: a gun's muzzle is above its grip, and the line from one
        // to the other pointed the pistol 23 degrees down.)
        let ahead = ((tip - grip) - up * (tip - grip).dot(up)).normalize();
        let up = (up - ahead * up.dot(ahead)).normalize();
        let turn = Quat::from_mat3(&Mat3::from_cols(up.cross(-ahead), up, -ahead)).inverse();
        Transform { translation: -(turn * grip), rotation: turn * file, scale: Vec3::ONE }
    }

    // The box round a model's meshes in its own glTF frame turned by `turn`: (min, max). None until it has loaded.
    pub fn bounds(&self, key: &str, turn: Quat, gltfs: &Assets<Gltf>, nodes: &Assets<GltfNode>, meshes: &Assets<GltfMesh>,
                  data: &Assets<Mesh>) -> Option<(Vec3, Vec3)> {
        let gltf = gltfs.get(&self.gltf[key])?;
        let children: Vec<AssetId<GltfNode>> = gltf.nodes.iter().filter_map(|n| nodes.get(n)).flat_map(|n| n.children.iter().map(|c| c.id())).collect();
        let mut lo = Vec3::splat(f32::INFINITY);
        let mut hi = -lo;
        let mut stack: Vec<(AssetId<GltfNode>, Mat4)> =
            gltf.nodes.iter().filter(|n| !children.contains(&n.id())).map(|n| (n.id(), Mat4::from_quat(turn))).collect();
        while let Some((id, parent)) = stack.pop() {
            let node = nodes.get(id)?;
            let world = parent * node.transform.to_matrix();
            if let Some(mesh) = node.mesh.as_ref().and_then(|m| meshes.get(m)) {
                for prim in &mesh.primitives {
                    let Some(bevy::mesh::VertexAttributeValues::Float32x3(ps)) = data.get(&prim.mesh)?.attribute(Mesh::ATTRIBUTE_POSITION) else { continue };
                    for p in ps {
                        let q = world.transform_point3(Vec3::from(*p));
                        lo = lo.min(q);
                        hi = hi.max(q);
                    }
                }
            }
            stack.extend(node.children.iter().map(|c| (c.id(), world)));
        }
        Some((lo, hi))
    }

    pub fn loaded(&self, assets: &AssetServer) -> bool {
        self.gltf.values().all(|h| assets.is_loaded_with_dependencies(h))
    }
}

fn load(assets: Res<AssetServer>, mut models: ResMut<WeaponModels>) {
    let path = crate::asset_file("models/weapons/weapons.json");
    let specs: HashMap<String, Spec> = serde_json::from_slice(&std::fs::read(&path).expect("weapons.json")).expect("weapons.json");
    for (key, spec) in &specs {
        models.gltf.insert(key.clone(), assets.load(format!("models/weapons/{}", spec.file)));
    }
    models.specs = specs;
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Weapons>().init_resource::<WeaponModels>().add_systems(Startup, load);
}

#[test]
fn held_points_ahead() {
    let mut m = WeaponModels::default();
    // A model along the file's +X with its up +Y, gripped at its origin: held, its tip is ahead (-Z) of the hand.
    m.specs.insert("x".into(), Spec { file: String::new(), grip: [0.0; 3], tip: [1.0, 0.0, 0.0], up: [0.0, 1.0, 0.0], ejection: None, eject_dir: None });
    let t = m.held("x");
    let tip = t.transform_point(Vec3::X);
    assert!((tip - Vec3::NEG_Z).length() < 1e-5, "{tip}");
    assert!((t.rotation * Vec3::Y - Vec3::Y).length() < 1e-5);
}
