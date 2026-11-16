// What wet blood shows of the hall (map.ts's ReflectionProbe, which the TS gave blood.ts's marks and drops and floor.ts's
// pools as their reflection): the hall as seen from the middle of the room 1.4 m up, rendered once into six square
// pictures, a cube's faces, its walls, structures and lamps only (the TS's render list: not the people). Bevy's own
// environment light here is the hemispheric fill, whose specular is black (map.rs `fill_light`): without this, a pool
// would show the lamps and nothing else, and read as paint.
//
// The blood's shaders look up where a ray off their surface goes (fluid.wesl `hall_seen`).

use std::f32::consts::FRAC_PI_2;

use bevy::camera::visibility::RenderLayers;
use bevy::camera::RenderTarget;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::post_process::bloom::Bloom;
use bevy::anti_alias::fxaa::Fxaa;
use bevy::prelude::*;
use bevy::render::render_resource::TextureFormat;

use crate::Loading;

const SIZE: u32 = 256;
const LAYER: usize = 1;
// The six faces: which way each looks and which way is up in it (as fluid.wesl `hall_seen` reads them).
const FACES: [(Vec3, Vec3); 6] = [(Vec3::X, Vec3::Y), (Vec3::NEG_X, Vec3::Y), (Vec3::Y, Vec3::Z), (Vec3::NEG_Y, Vec3::NEG_Z), (Vec3::Z, Vec3::Y), (Vec3::NEG_Z, Vec3::Y)];
// Frames the faces are drawn for, once everything is loaded (a frame or two for the shadows and the bloom-less
// picture to settle), before their cameras are put away.
const FRAMES: u32 = 30;

#[derive(Resource)]
pub struct Hall {
    pub faces: [Handle<Image>; 6],
    cameras: Vec<Entity>,
    left: u32,
}

pub fn make(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    let faces = std::array::from_fn(|_| images.add(Image::new_target_texture(SIZE, SIZE, TextureFormat::Rgba16Float, None)));
    commands.insert_resource(Hall { faces, cameras: Vec::new(), left: FRAMES });
}

// Once the hall is built and every texture is in: the six cameras, seeing only what is on the hall's layer.
fn shoot(mut commands: Commands, mut hall: ResMut<Hall>, names: Query<(Entity, &Name), With<Mesh3d>>,
         glass: Query<(Entity, &MeshMaterial3d<StandardMaterial>), Without<Name>>, materials: Res<Assets<StandardMaterial>>,
         lights: Query<Entity, Or<(With<SpotLight>, With<PointLight>, With<DirectionalLight>)>>) {
    for (e, name) in &names {
        if matches!(name.as_str(), "hall" | "structures" | "hazard" | "signs") {
            commands.entity(e).insert(RenderLayers::from_layers(&[0, LAYER]));
        }
    }
    // The lamps' glass: what shines.
    for (e, m) in &glass {
        if materials.get(&m.0).is_some_and(|m| m.emissive.luminance() > 1.0) {
            commands.entity(e).insert(RenderLayers::from_layers(&[0, LAYER]));
        }
    }
    for e in &lights {
        commands.entity(e).insert(RenderLayers::from_layers(&[0, LAYER]));
    }
    let at = Vec3::new(0.0, 1.4, 0.0);
    for (k, (ahead, up)) in FACES.into_iter().enumerate() {
        let e = commands
            .spawn((
                Camera3d::default(),
                Camera { order: -10 - k as isize, ..default() },
                RenderTarget::Image(hall.faces[k].clone().into()),
                Projection::Perspective(PerspectiveProjection { fov: FRAC_PI_2, aspect_ratio: 1.0, near: 0.05, far: 60.0, ..default() }),
                Transform::from_translation(at).looking_to(ahead, up),
                RenderLayers::layer(LAYER),
                Name::new("hall reflected"),
            ))
            .id();
        // (Graded as the player's camera is, but its picture is light as it is, not as the eye is shown it.)
        commands.entity(e).remove::<(crate::picture::Picture, Bloom, Fxaa)>().insert(Tonemapping::None);
        hall.cameras.push(e);
    }
}

fn done(mut commands: Commands, mut hall: ResMut<Hall>) {
    if hall.cameras.is_empty() || hall.left == 0 {
        return;
    }
    hall.left -= 1;
    if hall.left == 0 {
        for &e in &hall.cameras {
            commands.entity(e).despawn();
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Startup, make).add_systems(OnEnter(Loading::Done), shoot).add_systems(Last, done);
}
