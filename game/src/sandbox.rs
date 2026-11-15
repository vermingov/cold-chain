// The sandbox (src/sandbox/sandbox.ts): a hall laid out as a test map (map.rs), a few people standing in it, and
// whatever the player picks up to use on them.
//
// Here, for now, the people stand as they were made, in their rest stance, still (their ragdolls and what they do are
// phase 2's: dev/PORT.md); X shows their insides.

use bevy::mesh::skinning::SkinnedMeshInverseBindposes;
use bevy::prelude::*;

use crate::anatomy::Anatomy;
use crate::person::{self, People};
use crate::poses;
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

// Everyone in a row across the middle of the hall, facing the player's end (south).
#[allow(clippy::too_many_arguments)]
fn line_up(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut people: ResMut<People>,
    mut anatomy: ResMut<Anatomy>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut bindposes: ResMut<Assets<SkinnedMeshInverseBindposes>>,
    mut rng: ResMut<Rng>,
    mut made: ResMut<Made>,
) {
    people.load(&BODIES);
    anatomy.load(&BODIES);
    for (i, body) in BODIES.iter().enumerate() {
        made.0 += 1;
        let at = crate::babylon((i as f32 - (BODIES.len() as f32 - 1.0) / 2.0) * 1.5, 0.0, 2.2);
        // Each breathes on a clock of their own.
        let clock = rng.next() * 10.0;
        let label = format!("{} ({})", called(body), made.0);
        let e = person::spawn(&mut commands, &mut people, &assets, &mut meshes, &mut materials, &mut bindposes, &mut anatomy, &mut rng, body, label,
                              mass(body), at, std::f32::consts::PI, poses::stand(clock, 1.0, 0.0));
        commands.entity(e).insert(Vitals::new(mass(body)));
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Made>().add_systems(Startup, line_up);
}
