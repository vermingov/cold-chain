// What is worn on the fists (weapons.rs 'dusters' and 'gloves'): knuckle dusters and boxing gloves, built in code, drawn
// on the player's own fists (arm.rs, fist.rs) and hung on the board (arsenal.rs), and what each does to a punch.
//
// A punch lands through what is on the fist (dev/research/fist-weapons.md). Bare, the knuckles land on 30 to 40 cm2 of
// skin through the skin and flesh over them and over the struck bone (fist.rs FIST_GIVES, bones.rs). Knuckle dusters put
// a steel or brass bar a few millimetres wide across the four knuckles: the same arm behind it, but nothing soft between
// the bar and the struck skin, on a third of the patch, so the force comes on harder and is a third as spread: skin split
// over bone, small bones broken, the eye's rim no shield for the eye. The bar is held by a grip in the palm, so the blow
// goes into the whole hand, not the knuckles alone (a bare punch's fifth metacarpal is the boxer's fracture). Boxing
// gloves (10 to 16 oz, 280 to 450 g) put 2 to 4 cm of foam over the knuckles: the force comes on over two or three
// times as long at half the peak, spread over a patch the size of the glove's face, so far fewer cuts and fractures;
// but the momentum is the same and a little more (the glove's own mass), and a punch to the head still turns it as hard
// and still knocks out (wounds.rs takes concussion from the energy).
//
// Each is made in the closed fist's own frame (metres): x across the knuckles from the index finger to the little finger
// (the right hand's), y out of the back of the hand, z the way the knuckles face (from the wrist to them), the origin at
// the middle of the four knuckle joints. On a fist it is laid by that fist's own knuckles, scaled to their spread.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;

use crate::dressing::Piece;
use crate::wounds::Tool;

// The four knuckle joints' spread (index to little, bone to bone) the shapes are made for: a man's hand.
const SPREAD: f32 = 0.054;

// What a fist wears changes: the kg it adds to each fist, and what lands (bones.rs `tool`).
pub fn wear(key: &str) -> (f32, Tool) {
    match key {
        // A pair of brass knuckle dusters weighs some 150 to 250 g each.
        "dusters" => (0.2, Tool::Named("dusters")),
        // 14 oz gloves, 400 g each.
        "gloves" => (0.4, Tool::Named("glove")),
        _ => (0.0, Tool::Stiff(crate::fist::FIST_GIVES)),
    }
}

// A mesh being put together from shapes, each placed by a transform (its normals carried as normals are).
#[derive(Default)]
struct Build {
    pos: Vec<Vec3>,
    nor: Vec<Vec3>,
    index: Vec<u32>,
}

impl Build {
    fn add(&mut self, mesh: Mesh, t: Transform) {
        let m = t.to_matrix();
        let n = m.inverse().transpose();
        let base = self.pos.len() as u32;
        let Some(VertexAttributeValues::Float32x3(p)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) else { return };
        let Some(VertexAttributeValues::Float32x3(q)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL) else { return };
        self.pos.extend(p.iter().map(|&v| m.transform_point3(Vec3::from(v))));
        self.nor.extend(q.iter().map(|&v| n.transform_vector3(Vec3::from(v)).normalize_or_zero()));
        match mesh.indices() {
            Some(i) => self.index.extend(i.iter().map(|k| base + k as u32)),
            None => self.index.extend((0..p.len() as u32).map(|k| base + k)),
        }
    }

    // A capsule of radius `r` from `a` to `b`.
    fn capsule(&mut self, a: Vec3, b: Vec3, r: f32) {
        let d = b - a;
        let t = Transform::from_translation((a + b) / 2.0).with_rotation(Quat::from_rotation_arc(Vec3::Y, d.normalize()));
        self.add(Capsule3d::new(r, d.length()).mesh().rings(4).latitudes(12).longitudes(20).build(), t);
    }

    // As seen in a mirror across x (the other hand's).
    fn mesh(&self, mirror: bool) -> Mesh {
        let s = if mirror { Vec3::new(-1.0, 1.0, 1.0) } else { Vec3::ONE };
        let mut index = self.index.clone();
        if mirror {
            for t in index.chunks_exact_mut(3) {
                t.swap(1, 2);
            }
        }
        Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos.iter().map(|p| (*p * s).to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor.iter().map(|n| (*n * s).to_array()).collect::<Vec<_>>())
            .with_inserted_indices(Indices::U32(index))
    }
}

// A rounded box (a superellipsoid: `round` 2 an ellipsoid, higher squarer) round `c` with half sizes `r`, the front
// (+z) half `front` as long as the back's.
fn pillow(c: Vec3, r: Vec3, round: f32, front: f32) -> Mesh {
    const ACROSS: usize = 40;
    const ROUND: usize = 64;
    let e = 2.0 / round;
    let f = |x: f32| x.signum() * x.abs().powf(e);
    let mut pos = Vec::new();
    for i in 0..=ACROSS {
        let u = -std::f32::consts::FRAC_PI_2 + std::f32::consts::PI * i as f32 / ACROSS as f32;
        for j in 0..=ROUND {
            let v = -std::f32::consts::PI + std::f32::consts::TAU * j as f32 / ROUND as f32;
            let z = f(u.cos()) * f(v.sin());
            pos.push(c + Vec3::new(r.x * f(u.cos()) * f(v.cos()), r.y * f(u.sin()), r.z * z * if z > 0.0 { front } else { 1.0 }));
        }
    }
    let mut index = Vec::new();
    let w = (ROUND + 1) as u32;
    for i in 0..ACROSS as u32 {
        for j in 0..ROUND as u32 {
            let (a, b) = (i * w + j, (i + 1) * w + j);
            index.extend([a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh
}

// An open tube along z from `z0` to `z1` round (0, y, ·), its half sizes across `r` (x, y), the lip at each end rolled
// over `lip` m.
fn tube(y: f32, z0: f32, z1: f32, r: Vec2, lip: f32) -> Mesh {
    const ROUND: usize = 48;
    let mut pos = Vec::new();
    let mut index = Vec::new();
    // Rings: rolled in at the back end, out along the tube, rolled in at the front.
    let rings: [(f32, f32); 6] = [(z0 + lip, -lip), (z0, -lip * 0.3), (z0 + lip, 0.0), (z1 - lip, 0.0), (z1, -lip * 0.3), (z1 - lip, -lip)];
    for &(z, out) in &rings {
        for j in 0..ROUND {
            let a = std::f32::consts::TAU * j as f32 / ROUND as f32;
            pos.push(Vec3::new((r.x + out) * a.cos(), y + (r.y + out) * a.sin(), z));
        }
    }
    for k in 0..rings.len() as u32 - 1 {
        for j in 0..ROUND as u32 {
            let (a, b) = (k * ROUND as u32 + j, k * ROUND as u32 + (j + 1) % ROUND as u32);
            let (c, d) = (a + ROUND as u32, b + ROUND as u32);
            index.extend([a, b, c, b, d, c]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    mesh
}

// What each is made of: each part's shape (the right hand's), and its look.
fn parts(key: &str) -> Vec<(Build, StandardMaterial)> {
    match key {
        "gloves" => {
            // A 14 oz glove: its padded mitt some 13 cm across, 11 deep and 21 long, 3 to 4 cm of foam in front of the
            // knuckles, the thumb sewn to its side, a cuff 11 cm up the forearm closed by a strap. Red leather.
            let mut leather = Build::default();
            leather.add(pillow(Vec3::new(0.0, -0.016, -0.05), Vec3::new(0.064, 0.054, 0.098), 2.6, 1.05), Transform::IDENTITY);
            leather.capsule(Vec3::new(-0.058, -0.03, -0.088), Vec3::new(-0.066, -0.035, -0.012), 0.022);
            leather.add(tube(-0.01, -0.235, -0.12, Vec2::new(0.047, 0.041), 0.004), Transform::IDENTITY);
            let mut strap = Build::default();
            strap.add(tube(-0.01, -0.2, -0.155, Vec2::new(0.0505, 0.0445), 0.002), Transform::IDENTITY);
            vec![
                (leather, StandardMaterial { base_color: Color::srgb_u8(132, 14, 18), perceptual_roughness: 0.42, reflectance: 0.45, clearcoat: 0.35,
                                             clearcoat_perceptual_roughness: 0.3, ..default() }),
                (strap, StandardMaterial { base_color: Color::srgb_u8(22, 22, 24), perceptual_roughness: 0.8, ..default() }),
            ]
        }
        "dusters" => {
            // Brass knuckles: four rings a finger's width apart round the fingers' first bones, just past the knuckles,
            // fused into one plate; a bar across their fronts that lands; a grip lying in the palm under the curled fingers,
            // joined to the plate at either end.
            let mut brass = Build::default();
            for x in [-0.027, -0.009, 0.009, 0.027] {
                brass.add(Torus::new(0.0105, 0.0165).mesh().minor_resolution(16).major_resolution(36).build(), Transform::from_xyz(x, -0.022, 0.0));
            }
            brass.add(Capsule3d::new(0.0058, 0.074).mesh().rings(4).latitudes(12).longitudes(20).build(),
                      Transform::from_xyz(0.0, -0.022, 0.0172).with_rotation(Quat::from_rotation_z(std::f32::consts::FRAC_PI_2)).with_scale(Vec3::new(2.1, 1.0, 1.0)));
            // (The grip lies inside the loop each finger makes curled into the palm: down its first bone, back along the
            // second, up the third.)
            brass.capsule(Vec3::new(-0.03, -0.019, -0.013), Vec3::new(0.032, -0.019, -0.013), 0.0062);
            for s in [-1.0f32, 1.0] {
                brass.capsule(Vec3::new(0.041 * s, -0.024, 0.004), Vec3::new(0.035 * s, -0.019, -0.013), 0.0045);
            }
            vec![(brass, StandardMaterial { base_color: Color::linear_rgb(0.8, 0.56, 0.2), metallic: 0.9, perceptual_roughness: 0.32, ..default() })]
        }
        _ => Vec::new(),
    }
}

// Each worn thing's meshes and materials, the right hand's and the left's, made once.
#[derive(Resource, Default)]
pub struct Made(HashMap<(&'static str, bool), Vec<(Handle<Mesh>, Handle<StandardMaterial>)>>);

impl Made {
    fn get(&mut self, key: &'static str, left: bool, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) -> Vec<(Handle<Mesh>, Handle<StandardMaterial>)> {
        self.0
            .entry((key, left))
            .or_insert_with(|| parts(key).into_iter().map(|(b, m)| (meshes.add(b.mesh(left)), materials.add(m))).collect())
            .clone()
    }
}

// On the board: a pair, gloves hanging by their cuffs and dusters flat, their fronts to the room (the board's frame: x
// out of the wall into the room, y up, the wall along -z).
pub fn board(key: &'static str, made: &mut Made, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) -> Option<Vec<Piece>> {
    let (turn, apart) = match key {
        // The back of the hand to the room, the knuckles down.
        "gloves" => (Mat3::from_cols(Vec3::NEG_Z, Vec3::X, Vec3::NEG_Y), 0.075),
        // Flat to the wall, the rings' holes to the room, the bar up.
        "dusters" => (Mat3::from_cols(Vec3::Z, Vec3::X, Vec3::Y), 0.055),
        _ => return None,
    };
    let rotation = Quat::from_mat3(&turn);
    let mut out = Vec::new();
    for (left, z) in [(false, -apart), (true, apart)] {
        for (mesh, material) in made.get(key, left, meshes, materials) {
            out.push(Piece { mesh, material, at: Transform::from_xyz(0.0, 0.0, z).with_rotation(rotation) });
        }
    }
    Some(out)
}

// Where the fist's own frame lies in the wrist's (the bone the worn thing is hung from), and whether it is the mirror
// image's (the left hand's): from the arm as it is closed now.
fn on_fist(arm: &crate::arm::Arm) -> (Transform, bool) {
    let here = |n: &str, tail: bool| arm.here(n, tail);
    let knuckles: Vec<Vec3> = (2..=5).map(|k| here(&format!("finger{k}-1"), false)).collect();
    let middle = knuckles.iter().sum::<Vec3>() / 4.0;
    let across = knuckles[3] - knuckles[0];
    let x = across.normalize();
    let ahead = middle - here("wrist", false);
    let z = (ahead - x * ahead.dot(x)).normalize();
    let mut y = z.cross(x);
    // (The back of the hand is away from where the fingers curl.)
    let curled = here("finger3-3", true) - here("finger3-1", false);
    let mirror = y.dot(curled) > 0.0;
    if mirror {
        y = -y;
    }
    let x = if mirror { -x } else { x };
    let abs = crate::person::absolute(&arm.person.body.bones, &arm.local);
    let (rot, at) = abs[arm.wrist];
    let rotation = rot.inverse() * Quat::from_mat3(&Mat3::from_cols(x, y, z));
    (Transform { translation: rot.inverse() * (middle - at), rotation, scale: Vec3::splat(across.length() / SPREAD) }, mirror)
}

// What is on the fists now, and its entities.
#[derive(Resource, Default)]
struct On {
    key: &'static str,
    entities: Vec<Entity>,
}

// Put on the fists while what is held is something worn on them and the fists are up; taken off otherwise.
#[allow(clippy::too_many_arguments)]
fn put_on(
    mut commands: Commands,
    weapons: Res<crate::weapons::Weapons>,
    fists: Res<crate::fist::Fists>,
    arms: Option<Res<crate::hands::Arms>>,
    mut on: ResMut<On>,
    mut made: ResMut<Made>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let Some(arms) = arms else { return };
    let a = weapons.arm();
    let want = if a.kind == crate::weapons::Kind::Fists && fists.is_up() && !parts(a.key).is_empty() { a.key } else { "" };
    if want == on.key {
        return;
    }
    // (Not before both hands are closed into fists: fist.rs closes them the frame they are taken up.)
    if !want.is_empty() && (arms.r.holding != "fist" || arms.l.holding != "fist") {
        return;
    }
    for e in std::mem::take(&mut on.entities) {
        commands.entity(e).despawn();
    }
    on.key = want;
    if want.is_empty() {
        return;
    }
    for arm in [&arms.r, &arms.l] {
        let (t, mirror) = on_fist(arm);
        for (mesh, material) in made.get(want, mirror, &mut meshes, &mut materials) {
            on.entities.push(commands.spawn((Mesh3d(mesh), MeshMaterial3d(material), t, ChildOf(arm.joints[arm.wrist]), Name::new(want))).id());
        }
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Made>().init_resource::<On>().add_systems(Update, put_on.after(crate::fist::punch));
}

#[cfg(test)]
mod tests {
    use super::*;

    // The glove's mitt reaches 4 to 5 cm past the knuckle joints in front, and its mirror image is the same shape turned.
    #[test]
    fn glove_in_front() {
        let made = parts("gloves");
        let front = made[0].0.pos.iter().map(|p| p.z).fold(f32::MIN, f32::max);
        assert!((0.04..0.06).contains(&front), "{front}");
        let m = made[0].0.mesh(true);
        let Some(VertexAttributeValues::Float32x3(p)) = m.attribute(Mesh::ATTRIBUTE_POSITION) else { panic!() };
        assert!(p.iter().map(|v| v[0]).fold(f32::MIN, f32::max) > 0.08);
    }
}
