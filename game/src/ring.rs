// A boxing ring in the south-east of the hall (BACKLOG item 6): a raised canvas floor on a skirted platform, a post at
// each corner in its pad, and four ropes a side that give and spring back.
//
// The platform is one of map.rs's blocks (so it is stood on, walked onto from its step, landed on by blood and solid to
// Rapier with the rest of the hall); it is drawn here. A ring is 16 to 24 ft inside the ropes; the hall has room for a
// small one between the low wall, the high wall and the ledge: 4.8 m square to the platform's edge, the posts 0.3 m in,
// 4.2 m (14 ft) between them. The ropes are at 46, 76, 107 and 137 cm over the canvas (18, 30, 42 and 54 inches, as the
// rules have them), 4.5 cm thick in their covers.
//
// A rope is a rigid body as long as its side, held where it hangs by springs (`spring`): pushed out it gives about 4 cm
// for each 100 N (a taut ring rope leaned on by a boxer gives some 10 to 20 cm), less up and down, hardly at all along
// itself, and comes back damped, so whatever leans or falls on it is thrown back off. People and the player's body meet
// the ropes (not the hall: their ends sit in the posts). A player ducking (crouched) goes through between them, as one
// bends to step through a ring's ropes.

use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_rapier3d::prelude::*;

use crate::babylon;
use crate::player::{Player, PlayerBody};
use crate::ragdoll::{LIMBS, PIECE, ROOTS, TRUNK};

// Where it stands (the TS's space, as map.rs's blocks): its platform's sides, and how high its floor is.
pub struct Ring {
    pub x0: f32,
    pub x1: f32,
    pub z0: f32,
    pub z1: f32,
    pub floor: f32,
}
pub const RING: Ring = Ring { x0: 1.6, x1: 6.4, z0: -8.2, z1: -3.4, floor: 0.45 };
const POSTS_IN: f32 = 0.3;
const POST_HIGH: f32 = 1.55;
const ROPES: [f32; 4] = [0.46, 0.76, 1.07, 1.37];
const ROPE_R: f32 = 0.0225;
const ROPE_KG: f32 = 3.0;
// N/m and N s/m: out from the ring (and in), up and down, along the rope.
const GIVES: [(f32, f32); 3] = [(2500.0, 60.0), (6000.0, 80.0), (40000.0, 300.0)];
// The ropes' own collision bit: they meet people, what is cut off them and the player's body.
pub const ROPE: Group = Group::GROUP_7;

impl Ring {
    // The middle of the canvas, in Bevy's space.
    pub fn middle(&self) -> Vec3 {
        babylon((self.x0 + self.x1) / 2.0, self.floor, (self.z0 + self.z1) / 2.0)
    }

    // A corner of the canvas, inside the posts (0 north-west, 1 north-east, 2 south-east, 3 south-west), Bevy's space.
    pub fn corner(&self, k: usize) -> Vec3 {
        let i = POSTS_IN + 0.45;
        let (x, z) = [(self.x0 + i, self.z1 - i), (self.x1 - i, self.z1 - i), (self.x1 - i, self.z0 + i), (self.x0 + i, self.z0 + i)][k % 4];
        babylon(x, self.floor, z)
    }

    // Whether a point (Bevy's) is over the canvas, inside the ropes.
    pub fn inside(&self, p: Vec3) -> bool {
        let q = babylon(p.x, p.y, p.z);
        q.x > self.x0 + POSTS_IN && q.x < self.x1 - POSTS_IN && q.z > self.z0 + POSTS_IN && q.z < self.z1 - POSTS_IN && q.y > self.floor - 0.1
    }
}

// A rope: where it hangs (its middle, Bevy's), the way it runs and the way out of the ring.
#[derive(Component)]
pub struct Rope {
    rest: Vec3,
    along: Vec3,
    out: Vec3,
}

fn build(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut materials: ResMut<Assets<StandardMaterial>>) {
    let r = &RING;
    let (w, d) = (r.x1 - r.x0, r.z1 - r.z0);
    let mid = Vec3::new((r.x0 + r.x1) / 2.0, 0.0, (r.z0 + r.z1) / 2.0);
    let look = |c: Color, rough: f32| StandardMaterial { base_color: c, perceptual_roughness: rough, metallic: 0.0, ..default() };
    // The canvas: off-white cotton duck over the padding, a little worn; the skirt round the platform, dark blue vinyl.
    let canvas = materials.add(look(Color::srgb_u8(196, 199, 196), 0.92));
    let skirt = materials.add(StandardMaterial { reflectance: 0.45, ..look(Color::srgb_u8(18, 30, 72), 0.5) });
    let steel = materials.add(StandardMaterial { base_color: Color::srgb_u8(150, 152, 155), metallic: 1.0, perceptual_roughness: 0.35, ..default() });
    commands.spawn((Mesh3d(meshes.add(Cuboid::new(w, 0.02, d))), MeshMaterial3d(canvas.clone()), Transform::from_translation(babylon(mid.x, r.floor - 0.009, mid.z)),
                    Name::new("ring canvas")));
    for (cx, cz, sx, sz) in [(mid.x, r.z0, w, 0.0), (mid.x, r.z1, w, 0.0), (r.x0, mid.z, 0.0, d), (r.x1, mid.z, 0.0, d)] {
        commands.spawn((Mesh3d(meshes.add(Cuboid::new(sx.max(0.012), r.floor - 0.02, sz.max(0.012)))), MeshMaterial3d(skirt.clone()),
                        Transform::from_translation(babylon(cx, (r.floor - 0.02) / 2.0, cz)), Name::new("ring skirt")));
    }
    // The step up at the north-west corner (map.rs's block), in the canvas's cloth over a steel tread.
    commands.spawn((Mesh3d(meshes.add(Cuboid::new(0.55, r.floor / 2.0, 0.8))), MeshMaterial3d(skirt.clone()),
                    Transform::from_translation(babylon(r.x0 - 0.275, r.floor / 4.0, r.z1 - 0.4)), Name::new("ring step")));
    // Posts, and their pads over the turnbuckles: red and blue in the fighters' corners, white in the neutral ones.
    let pads = [Color::srgb_u8(150, 16, 20), Color::srgb_u8(230, 230, 226), Color::srgb_u8(20, 40, 140), Color::srgb_u8(230, 230, 226)];
    let corners = [(r.x0 + POSTS_IN, r.z1 - POSTS_IN), (r.x1 - POSTS_IN, r.z1 - POSTS_IN), (r.x1 - POSTS_IN, r.z0 + POSTS_IN), (r.x0 + POSTS_IN, r.z0 + POSTS_IN)];
    let post = meshes.add(Cylinder::new(0.045, POST_HIGH).mesh().resolution(20));
    let pad = meshes.add(Capsule3d::new(0.11, ROPES[3] - ROPES[0] + 0.1).mesh().longitudes(24).latitudes(8).build());
    let mut solid: Vec<(Vec3, Quat, Collider)> = Vec::new();
    for (k, &(x, z)) in corners.iter().enumerate() {
        commands.spawn((Mesh3d(post.clone()), MeshMaterial3d(steel.clone()), Transform::from_translation(babylon(x, r.floor + POST_HIGH / 2.0, z)), Name::new("ring post")));
        let leather = materials.add(StandardMaterial { reflectance: 0.45, clearcoat: 0.3, ..look(pads[k], 0.45) });
        let y = r.floor + (ROPES[0] + ROPES[3]) / 2.0;
        commands.spawn((Mesh3d(pad.clone()), MeshMaterial3d(leather), Transform::from_translation(babylon(x, y, z)), Name::new("ring pad")));
        // The posts and their pads are solid (to anything, as the hall is).
        solid.push((babylon(x, r.floor + POST_HIGH / 2.0, z), Quat::IDENTITY, Collider::cylinder(POST_HIGH / 2.0, 0.11)));
    }
    commands.spawn((RigidBody::Fixed, Collider::compound(solid), CollisionGroups::new(crate::map::WORLD, Group::ALL), Friction::coefficient(0.5),
                    Transform::default(), Name::new("ring posts")));
    // The ropes: red, white, blue, white from the top (each side's the same), between the pads.
    let colours = [Color::srgb_u8(150, 16, 20), Color::srgb_u8(230, 230, 226), Color::srgb_u8(20, 40, 140), Color::srgb_u8(230, 230, 226)];
    for (k, &h) in ROPES.iter().enumerate() {
        let cover = materials.add(StandardMaterial { reflectance: 0.45, clearcoat: 0.25, ..look(colours[3 - k], 0.5) });
        for s in 0..4 {
            let (a, b) = (corners[s], corners[(s + 1) % 4]);
            let (a, b) = (babylon(a.0, r.floor + h, a.1), babylon(b.0, r.floor + h, b.1));
            let rest = (a + b) / 2.0;
            let along = (b - a).normalize();
            let length = a.distance(b) - 0.24;
            let mut out = rest - babylon(mid.x, r.floor + h, mid.z);
            out.y = 0.0;
            let out = out.normalize();
            let turn = Quat::from_rotation_arc(Vec3::Y, along);
            commands
                .spawn((
                    Rope { rest, along, out },
                    RigidBody::Dynamic,
                    Collider::capsule_y(length / 2.0, ROPE_R),
                    ColliderMassProperties::Mass(ROPE_KG),
                    LockedAxes::ROTATION_LOCKED,
                    GravityScale(0.0),
                    Ccd::enabled(),
                    Friction::coefficient(0.6),
                    Restitution::coefficient(0.2),
                    CollisionGroups::new(ROPE, TRUNK.union(ROOTS).union(LIMBS).union(PIECE).union(crate::player::BODY_GROUP)),
                    Velocity::default(),
                    ExternalForce::default(),
                    Transform::from_translation(rest).with_rotation(turn),
                    Name::new("ring rope"),
                ))
                .with_children(|c| {
                    c.spawn((Mesh3d(meshes.add(Capsule3d::new(ROPE_R, length).mesh().longitudes(16).latitudes(6).build())), MeshMaterial3d(cover.clone()), NotShadowCaster));
                });
        }
    }
}

// Every physics step, each rope held where it hangs by its springs.
fn spring(mut ropes: Query<(&Rope, &Transform, &Velocity, &mut ExternalForce)>) {
    for (rope, t, v, mut f) in &mut ropes {
        let off = t.translation - rope.rest;
        let mut force = Vec3::ZERO;
        for (axis, (k, c)) in [rope.out, Vec3::Y, rope.along].into_iter().zip(GIVES) {
            force -= axis * (k * off.dot(axis) + c * v.linear.dot(axis));
        }
        f.force = force;
    }
}

// The player's body meets the ropes standing, and passes between them ducked.
fn duck(players: Query<&Player>, mut bodies: Query<&mut CollisionGroups, With<PlayerBody>>) {
    let Ok(p) = players.single() else { return };
    let Some(mut g) = p.body.and_then(|b| bodies.get_mut(b).ok()) else { return };
    // (Put somewhere, the body passes through everything until clear: player.rs's, left alone.)
    if g.filters == Group::NONE {
        return;
    }
    let want = if p.crouch > 0.5 { g.filters.difference(ROPE) } else { g.filters.union(ROPE) };
    if g.filters != want {
        g.filters = want;
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Startup, build).add_systems(FixedUpdate, (spring, duck).before(PhysicsSet::SyncBackend));
}

#[cfg(test)]
mod tests {
    use super::*;

    // The canvas is a block of the hall: stood on 45 cm up inside, the floor outside; and the corners are inside the ropes.
    #[test]
    fn stood_on() {
        let map = crate::map::Map::default();
        let m = RING.middle();
        assert!((map.ground(m.x, m.z, f32::INFINITY) - RING.floor).abs() < 1e-5);
        assert_eq!(map.ground(m.x, m.z + 3.0, f32::INFINITY), 0.0);
        assert!((0..4).all(|k| RING.inside(RING.corner(k) + Vec3::Y * 0.5)));
    }
}
