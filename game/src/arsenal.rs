// The arsenal (src/sandbox/arsenal.ts): a steel board on the west wall with one of everything there is to hold hung
// on it, lit from above. Look at a thing on it and E takes it (taking is phase 2's: weapons.rs).
//
// Laid out in the TS's space (map.rs keeps its numbers there too), each thing's size measured turned as it hangs.

use bevy::camera::primitives::MeshAabb;
use bevy::gltf::{Gltf, GltfMesh, GltfNode};
use bevy::prelude::*;
use bevy::world_serialization::WorldAssetRoot;

use crate::dressing::{kit, Piece};
use crate::map::{CANDELA, HALL};
use crate::models::Models;
use crate::rng::Rng;
use crate::weapons::WeaponModels;
use crate::{babylon, Loading};

// What hangs where: three rows, long guns over the rest and the tools at the bottom, laid out along the wall from the
// south end.
const ROWS: [(f32, &[&str]); 3] = [
    (1.95, &["rifle", "shotgun", "ak", "m4", "r22"]),
    (1.38, &["pistol", "deagle", "knife", "sword", "bat", "grenade", "throw", "fists", "bandage", "medkit"]),
    (0.82, &["shovel", "sledge", "hammer"]),
];
struct Wall {
    x: f32,
    z: f32,
    width: f32,
    height: f32,
    y: f32,
}
const WALL: Wall = Wall { x: -HALL.x, z: -1.2, width: 7.2, height: 1.7, y: 1.45 };
const GAP: f32 = 0.28;
const BOX: &str = "cardboard_box_01"; // "Throw things" is shown by one of the things thrown

// What is on the board, and where (Bevy's space), for looking at it.
#[derive(Resource, Default)]
pub struct Arsenal {
    pub hung: Vec<(&'static str, Vec3, Vec3)>,
}

impl Arsenal {
    // The thing on the board the eye is on, within reach: its key, or None.
    pub fn look(&self, eye: Vec3, ahead: Vec3) -> Option<&'static str> {
        let mut best = None;
        let mut near = 2.6;
        for &(key, lo, hi) in &self.hung {
            let (a, b) = ((lo - eye) / ahead, (hi - eye) / ahead);
            let enter = a.min(b).max_element();
            let leave = a.max(b).min_element();
            if enter <= leave && leave > 0.0 && enter < near {
                near = enter.max(0.0);
                best = Some(key);
            }
        }
        best
    }
}

// The box round some pieces, each turned by `turn` after its own place.
fn pieces_bounds(pieces: &[Piece], turn: Quat, meshes: &Assets<Mesh>) -> (Vec3, Vec3) {
    let mut lo = Vec3::splat(f32::INFINITY);
    let mut hi = -lo;
    for p in pieces {
        let Some(aabb) = meshes.get(&p.mesh).and_then(|m| m.get_aabb()) else { continue };
        let (c, h) = (Vec3::from(aabb.center), Vec3::from(aabb.half_extents));
        for k in 0..8 {
            let corner = c + h * Vec3::new([-1.0, 1.0][k & 1], [-1.0, 1.0][(k >> 1) & 1], [-1.0, 1.0][(k >> 2) & 1]);
            let q = turn * p.at.transform_point(corner);
            lo = lo.min(q);
            hi = hi.max(q);
        }
    }
    (lo, hi)
}

// "Fists" on the board: a boxer's pair of hand wraps, two rolls of cotton 5 cm wide, each with its loose end hanging.
fn wraps(meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) -> Vec<Piece> {
    let cotton = materials.add(StandardMaterial { base_color: Color::linear_rgb(0.62, 0.6, 0.55), metallic: 0.0, perceptual_roughness: 0.95, ..default() });
    let roll = meshes.add(Cylinder::new(0.0275, 0.05).mesh().resolution(28));
    let end = meshes.add(Cuboid::new(0.002, 0.09, 0.048));
    [-0.035, 0.035]
        .into_iter()
        .flat_map(|z| {
            [
                Piece { mesh: roll.clone(), material: cotton.clone(), at: Transform::from_translation(babylon(0.03, 0.0, z)).with_rotation(Quat::from_rotation_z(-std::f32::consts::FRAC_PI_2)) },
                Piece { mesh: end.clone(), material: cotton.clone(), at: Transform::from_translation(babylon(0.004, -0.045, z)) },
            ]
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn build(
    mut commands: Commands,
    assets: Res<AssetServer>,
    weapons: Res<WeaponModels>,
    mut models: ResMut<Models>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut rng: ResMut<Rng>,
    (gltfs, nodes, gltf_meshes): (Res<Assets<Gltf>>, Res<Assets<GltfNode>>, Res<Assets<GltfMesh>>),
) {
    commands.spawn((
        Mesh3d(meshes.add(Rectangle::new(WALL.width, WALL.height))),
        MeshMaterial3d(materials.add(StandardMaterial { base_color: Color::linear_rgb(0.16, 0.165, 0.17), metallic: 0.6, perceptual_roughness: 0.55, ..default() })),
        Transform::from_translation(babylon(WALL.x + 0.015, WALL.y, WALL.z)).with_rotation(Quat::from_rotation_y(std::f32::consts::FRAC_PI_2)),
        Name::new("arsenal"),
    ));
    let lamp_colour = Color::linear_rgb(1.0, 0.95, 0.88);
    let spot = |at: Vec3, dir: Vec3, angle: f32, power: f32| {
        (
            SpotLight { color: lamp_colour, intensity: power * CANDELA, range: 40.0, outer_angle: angle / 2.0, inner_angle: 0.0, ..default() },
            Transform::from_translation(at).looking_to(dir.normalize(), Vec3::Y),
        )
    };
    commands.spawn(spot(babylon(WALL.x + 1.6, 3.6, WALL.z), babylon(-0.55, -1.0, 0.0), 2.1, 45.0));

    models.prepare(&[BOX], &assets, &mut meshes, &mut materials);
    let kits = kit(&mut meshes, &mut materials, &mut images, &mut rng);
    let fists = wraps(&mut meshes, &mut materials);
    let mut arsenal = Arsenal::default();
    for (y, keys) in ROWS {
        // Each thing as it will hang (its turn) and its box so turned, in the TS's space.
        let mut placed: Vec<(&'static str, Quat, Vec3, Vec3)> = Vec::new();
        for &key in keys {
            let (turn, (lo, hi)) = if key == "throw" {
                let b = &models.info(BOX).unwrap().bounds;
                (Quat::IDENTITY, (Vec3::from(b.min), Vec3::from(b.max)))
            } else if key == "fists" {
                (Quat::IDENTITY, ts_box(pieces_bounds(&fists, Quat::IDENTITY, &meshes)))
            } else if let Some((_, pieces)) = kits.iter().find(|(k, _)| *k == key) {
                // Turned on the wall from how they are held: the medkit's cross and the bandage roll's side to the
                // room. (The TS's -90 degrees about Y, the other way here.)
                let turn = Quat::from_rotation_y(std::f32::consts::FRAC_PI_2);
                (turn, ts_box(pieces_bounds(pieces, turn, &meshes)))
            } else if weapons.specs.contains_key(key) {
                let turn = weapons.held(key).rotation;
                let Some(b) = weapons.bounds(key, turn, &gltfs, &nodes, &gltf_meshes, &meshes) else { continue };
                (turn, ts_box(b))
            } else {
                continue;
            };
            placed.push((key, turn, lo, hi));
        }
        // Side by side along the wall, centred on the board, each standing just off it.
        let width: f32 = placed.iter().map(|p| p.3.z - p.2.z).sum::<f32>() + GAP * (placed.len() as f32 - 1.0);
        let mut z = WALL.z - width / 2.0;
        for (key, turn, lo, hi) in placed {
            let at = Vec3::new(WALL.x + 0.03 - lo.x, y - (lo.y + hi.y) / 2.0, z - lo.z);
            z += hi.z - lo.z + GAP;
            let where_ = Transform::from_translation(babylon(at.x, at.y, at.z)).with_rotation(turn);
            arsenal.hung.push((key, babylon(at.x + lo.x, at.y + lo.y, at.z + hi.z), babylon(at.x + hi.x, at.y + hi.y, at.z + lo.z)));
            // (No shadow from anything on the board: it is outside the cones of the lamps that cast shadows.)
            let pieces: Option<&Vec<Piece>> = if key == "fists" { Some(&fists) } else { kits.iter().find(|(k, _)| *k == key).map(|(_, p)| p) };
            if key == "throw" {
                models.place(&mut commands, BOX, where_);
            } else if let Some(pieces) = pieces {
                let root = commands.spawn((where_, Visibility::default(), Name::new(key))).id();
                for p in pieces {
                    commands.spawn((Mesh3d(p.mesh.clone()), MeshMaterial3d(p.material.clone()), p.at, ChildOf(root)));
                }
            } else {
                let scene = gltfs.get(&weapons.gltf[key]).and_then(|g| g.default_scene.clone().or_else(|| g.scenes.first().cloned()));
                if let Some(scene) = scene {
                    commands.spawn((WorldAssetRoot(scene), where_, Name::new(key)));
                }
            }
        }
    }
    // (The TS also put a small lamp low on the board's frame, 18 cd, lighting only the tools on the bottom row, which the
    // lamp overhead reaches at a ninth of its light. Bevy's lights cannot pick what they light, and from 30 cm off the
    // steel it threw a hot spot across the middle of the board, so it is left out: the bottom row is dimmer than the
    // TS meant it to be.)
    commands.insert_resource(arsenal);
}

// A box measured in Bevy's space as the TS's: z turned round, so its least and most z swap.
fn ts_box((lo, hi): (Vec3, Vec3)) -> (Vec3, Vec3) {
    (Vec3::new(lo.x, lo.y, -hi.z), Vec3::new(hi.x, hi.y, -lo.z))
}

// The weapons' glTF are in once Bevy has loaded them and all they hold.
fn ready(assets: Res<AssetServer>, weapons: Res<WeaponModels>, mut next: ResMut<NextState<Loading>>) {
    if !weapons.gltf.is_empty() && weapons.loaded(&assets) {
        next.set(Loading::Done);
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Update, ready.run_if(in_state(Loading::Assets))).add_systems(OnEnter(Loading::Done), build);
}
