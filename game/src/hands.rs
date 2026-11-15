// The player's two arms on whatever is held in them (src/sandbox/hands.ts).
//
// Each is a person's arm (arm.rs), in its own skin and a jacket sleeve; the right is the very arm that punches (fist.rs).
// What is held says where each hand goes on it (weapons.rs HELD: a place on the thing, the way its handle runs through
// the hand and the way the hand lies along it), and the fingers close round it as one of the holds says. Each arm is then
// solved from its shoulder to that hand (Arm::reach), so the arms go wherever the thing goes: a recoil, a swing or a
// reload moves the thing, and the hands come with it.

use std::collections::HashMap;

use bevy::mesh::skinning::SkinnedMeshInverseBindposes;
use bevy::prelude::*;

use crate::arm::{own_arm, Arm, Grasp, Reach};
use crate::person::People;
use crate::player::Player;
use crate::rng::Rng;
use crate::weapons::{e, Grip, Holds, Kind, Weapons};

// Which way from the shoulder each elbow is (in the person's own frame of the TS: x out to its side, y up, z ahead): down
// and a little out, as elbows are under something held up in front; else an arm solved for the straightest wrist put the
// elbow up and out beside the gun.
const ELBOW: [f32; 3] = [0.35, 1.0, -0.1];
// Holds whose fingers close round a handle (the others hold things at the finger tips, as Arm's own grasp has it).
const WRAPS: [&str; 5] = ["grip", "support", "wrap", "handle", "ball"];

#[derive(Resource)]
pub struct Arms {
    pub r: Arm,
    pub l: Arm,
    grasps: HashMap<(char, &'static str), Grasp>,
}

impl Arms {
    pub fn arm(&mut self, side: char) -> &mut Arm {
        if side == 'R' { &mut self.r } else { &mut self.l }
    }

    // Hand `side` on `grip` (in the TS's frame of the thing), the thing's frame in the world `frame`, or taken away.
    pub fn put(&mut self, side: char, grip: Option<Grip>, frame: &Transform, eye: &Transform) {
        let Some(grip) = grip else {
            let arm = self.arm(side);
            arm.reach(None, eye);
            arm.shift = Vec3::ZERO;
            return;
        };
        let cached = self.grasps.get(&(side, grip.hold)).copied();
        let arm = self.arm(side);
        arm.shift = grip.shoulder.map_or(Vec3::ZERO, Vec3::from);
        if arm.holding != grip.hold {
            arm.hold(grip.hold);
            if WRAPS.contains(&grip.hold) {
                let g = cached.unwrap_or_else(|| wrapped(arm));
                arm.grasp = g;
                self.grasps.insert((side, grip.hold), g);
            }
        }
        let arm = self.arm(side);
        let along = (frame.rotation * e(Vec3::from(grip.along))).normalize();
        let back = frame.rotation * e(Vec3::from(grip.back));
        let back = (back - along * back.dot(along)).normalize();
        // (turned by the way the person faced last frame: reach() turns them to this one)
        let sign = if side == 'R' { 1.0 } else { -1.0 };
        let elbow = arm.shoulder(eye) + arm.at.rotation * e(Vec3::new(sign * ELBOW[0], -ELBOW[1], ELBOW[2]));
        arm.reach(Some(Reach { at: frame.transform_point(e(Vec3::from(grip.at))), along, back, elbow: Some(elbow) }), eye);
    }
}

// Where a handle lies in a hand closed round it: on the middle of the rings the middle and ring fingers make round it (a
// finger's knuckle, middle and last joints lie on a circle about what it holds), running across the palm from the index
// finger's knuckle toward the little finger's; its back the way the hand runs from the wrist to the knuckles. In the
// person's own frame, the arm as it was made.
fn wrapped(arm: &Arm) -> Grasp {
    let here = |n: &str| arm.here(n, false);
    let ring = |f: u32| circle(here(&format!("finger{f}-1")), here(&format!("finger{f}-2")), here(&format!("finger{f}-3")));
    let along = (here("finger5-1") - here("finger2-1")).normalize();
    let long = here("finger3-1") - here("wrist");
    let back = (long - along * long.dot(along)).normalize();
    Grasp { at: (ring(3) + ring(4)) * 0.5, along, rotation: Quat::from_mat3(&Mat3::from_cols(along, back, along.cross(back))) }
}

// The centre of the circle through three points.
fn circle(a: Vec3, b: Vec3, c: Vec3) -> Vec3 {
    let (ab, ac) = (b - a, c - a);
    let n = ab.cross(ac);
    a + (n.cross(ab) * ac.length_squared() + ac.cross(n) * ab.length_squared()) / (2.0 * n.length_squared())
}

// The arms, once the people's bodies are read: the sexton's, the right closed in a fist, the left open.
#[allow(clippy::too_many_arguments)]
fn make(
    mut commands: Commands,
    mut people: ResMut<People>,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut bindposes: ResMut<Assets<SkinnedMeshInverseBindposes>>,
    mut rng: ResMut<Rng>,
    mut fists: ResMut<crate::fist::Fists>,
) {
    people.load(&["sexton"]);
    let body = people.bodies["sexton"].clone();
    let r = own_arm(&mut commands, &body, 'R', "fist", &assets, &mut meshes, &mut materials, &mut bindposes, &mut rng);
    let l = own_arm(&mut commands, &body, 'L', "open", &assets, &mut meshes, &mut materials, &mut bindposes, &mut rng);
    let mut arms = Arms { r, l, grasps: HashMap::new() };
    fists.make(&mut arms);
    commands.insert_resource(arms);
}

// Every frame: the hands put on what is held (weapons.rs `animate` says where), or the fists posing their own arms.
fn put(
    weapons: Res<Weapons>,
    holds: Res<Holds>,
    mut arms: ResMut<Arms>,
    eye: Query<&Transform, With<Player>>,
    mut transforms: Query<&mut Transform, Without<Player>>,
    mut vis: Query<&mut Visibility>,
) {
    let Ok(eye) = eye.single() else { return };
    if weapons.arm().kind != Kind::Fists {
        let frame = holds.frame;
        arms.put('R', holds.right, &frame, eye);
        arms.put('L', holds.left, &frame, eye);
    }
    crate::arm::draw(&arms.r, &mut transforms, &mut vis);
    crate::arm::draw(&arms.l, &mut transforms, &mut vis);
}

pub fn plugin(app: &mut App) {
    app.add_systems(OnEnter(crate::Loading::Done), make).add_systems(
        Update,
        put.run_if(resource_exists::<Arms>).after(crate::weapons::animate).after(crate::fist::punch),
    );
}
