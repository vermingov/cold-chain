// The sandbox (src/sandbox/sandbox.ts): a hall laid out as a test map (map.rs), a few people standing in it, and
// whatever the player picks up to use on them.
//
// Each person is a ragdoll worked by a mind of their own (ragdoll.rs, behaviour.rs, given them as they are made); X
// shows their insides, N makes another where the eye looks, K clears the room.

use bevy::mesh::skinning::SkinnedMeshInverseBindposes;
use bevy::prelude::*;
use bevy_rapier3d::prelude::*;

use crate::anatomy::Anatomy;
use crate::map::Map;
use crate::person::{self, People, Person};
use crate::player::Player;
use crate::poses;
use crate::ragdoll::Ragdoll;
use crate::rng::Rng;
use crate::vitals::Vitals;

pub const BODIES: [&str; 4] = ["oldman", "sexton", "buyer", "hood"];

pub fn called(body: &str) -> &'static str {
    match body {
        "oldman" => "Old man",
        "sexton" => "Groundskeeper",
        "buyer" => "Young man",
        _ => "Man in a hood",
    }
}

// kg
fn mass(body: &str) -> f32 {
    match body {
        "oldman" => 72.0,
        "sexton" => 80.0,
        "buyer" => 86.0,
        _ => 82.0,
    }
}

// How many have been made, for their labels ("Young man (3)").
#[derive(Resource, Default)]
pub struct Made(pub u32);

// What making a person takes (person::spawn), for the line-up and for N.
#[derive(bevy::ecs::system::SystemParam)]
pub struct Spawner<'w, 's> {
    commands: Commands<'w, 's>,
    assets: Res<'w, AssetServer>,
    people: ResMut<'w, People>,
    anatomy: ResMut<'w, Anatomy>,
    meshes: ResMut<'w, Assets<Mesh>>,
    materials: ResMut<'w, Assets<StandardMaterial>>,
    bindposes: ResMut<'w, Assets<SkinnedMeshInverseBindposes>>,
    rng: ResMut<'w, Rng>,
    made: ResMut<'w, Made>,
}

impl Spawner<'_, '_> {
    // A person of body `body` standing at `at` (Bevy's), facing `yaw` as the TS measured it.
    fn spawn(&mut self, body: &str, at: Vec3, yaw: f32) -> Entity {
        self.people.load(&BODIES);
        self.anatomy.load(&BODIES);
        self.made.0 += 1;
        // Each breathes on a clock of their own.
        let clock = self.rng.next() * 10.0;
        let label = format!("{} ({})", called(body), self.made.0);
        let s = self;
        let e = person::spawn(&mut s.commands, &mut s.people, &s.assets, &mut s.meshes, &mut s.materials, &mut s.bindposes, &mut s.anatomy, &mut s.rng, body, label,
                              mass(body), at, yaw, poses::stand(clock, 1.0, 0.0));
        s.commands.entity(e).insert(Vitals::new(mass(body)));
        e
    }

    // Everyone in a row across the middle of the hall, facing the player's end (south).
    fn line_up(&mut self) {
        for (i, body) in BODIES.iter().enumerate() {
            self.spawn(body, crate::babylon((i as f32 - (BODIES.len() as f32 - 1.0) / 2.0) * 1.5, 0.0, 2.2), std::f32::consts::PI);
        }
    }
}

fn line_up(mut spawner: Spawner) {
    spawner.line_up();
}

// N: another person standing where the eye is looking (on the floor, a ledge, the ramp). K: the room cleared and new
// people lined up. (X, their insides, is anatomy.rs's.)
fn keys(
    keys: Res<ButtonInput<KeyCode>>,
    players: Query<&Player>,
    context: ReadRapierContext,
    map: Res<Map>,
    people: Query<(Entity, Option<&Ragdoll>), With<Person>>,
    mut spawner: Spawner,
) {
    if keys.just_pressed(KeyCode::KeyN) {
        let Some(eye) = players.iter().next().map(|p| p.eye()) else { return };
        let (from, ahead) = (eye.translation, eye.forward().as_vec3());
        // (What the hall is built of only: the people and loose things are not stood on.)
        let solid = QueryFilter::new().groups(CollisionGroups::new(Group::ALL, crate::map::WORLD));
        let hit = context.single().ok().and_then(|c| c.cast_ray_and_get_normal(from, ahead, 30.0, true, solid));
        let at = match hit {
            Some((_, h)) if h.normal.y > 0.7 => h.point,
            _ => {
                let mut at = from + ahead * 2.0;
                at.y = map.ground(at.x, at.z, from.y);
                at
            }
        };
        // Facing the eye (the TS's yaw: its z is ours turned round).
        let yaw = (from.x - at.x).atan2(-(from.z - at.z));
        let body = BODIES[spawner.made.0 as usize % BODIES.len()];
        spawner.spawn(body, at, yaw);
    }
    if keys.just_pressed(KeyCode::KeyK) {
        clear(&mut spawner.commands, &people);
        spawner.line_up();
    }
}

// Everyone gone, their bodies and joints with them.
pub fn clear(commands: &mut Commands, people: &Query<(Entity, Option<&Ragdoll>), With<Person>>) {
    for (e, rd) in people {
        for part in rd.into_iter().flat_map(|rd| rd.entities()) {
            commands.entity(part).despawn();
        }
        commands.entity(e).despawn();
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Made>().add_systems(Startup, line_up).add_systems(Update, keys);
}
