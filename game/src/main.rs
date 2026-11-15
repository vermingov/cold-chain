use bevy::prelude::*;
use bevy::render::view::screenshot::{save_to_disk, Screenshot};
use bevy_rapier3d::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(RapierPhysicsPlugin::<NoUserData>::default())
        .add_systems(Startup, setup)
        .add_systems(Update, shoot)
        .run();
}

fn setup(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut materials: ResMut<Assets<StandardMaterial>>) {
    commands.spawn((Camera3d::default(), Transform::from_xyz(3.0, 2.5, 5.0).looking_at(Vec3::ZERO, Vec3::Y)));
    commands.spawn((DirectionalLight { shadow_maps_enabled: true, ..default() }, Transform::from_xyz(4.0, 8.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y)));
    commands.spawn((Mesh3d(meshes.add(Plane3d::default().mesh().size(10.0, 10.0))), MeshMaterial3d(materials.add(Color::srgb(0.4, 0.4, 0.4))), Collider::cuboid(5.0, 0.01, 5.0)));
    commands.spawn((Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))), MeshMaterial3d(materials.add(Color::srgb(0.7, 0.2, 0.2))), Transform::from_xyz(0.0, 3.0, 0.0), RigidBody::Dynamic, Collider::cuboid(0.5, 0.5, 0.5)));
}

fn shoot(mut commands: Commands, mut frame: Local<u32>, mut exit: MessageWriter<AppExit>) {
    *frame += 1;
    if *frame == 120 { commands.spawn(Screenshot::primary_window()).observe(save_to_disk("spike.png")); }
    if *frame == 140 { exit.write(AppExit::Success); }
}
