// How much the game asks of the graphics card, fitted to the machine (src/sandbox/graphics.ts). The picture is made
// for a desktop card; on a laptop the card was 146 ms of a 229 ms frame (the TS's F2 profiler), drawing every pixel of
// the screen through the full lighting, shadows, bloom and grain.
//
// The resolution follows the frame rate on its own: most frames slower than about 36 fps for a second, the frame is
// drawn at fewer pixels (down to 40% a side, sharpened back by the FXAA already in the picture); faster than about 55
// fps for three seconds, it climbs back to full. F3 picks a preset as well, kept between runs:
//   High    as made: bloom, grain, 2048 soft shadow maps.
//   Medium  bloom at half its blur, no grain, 1024 shadow maps, cheaper filtering.
//   Low     no bloom, no grain, the lamps' shadows off.
//
// To draw at fewer pixels the 3D camera draws into an image of that size, which is shown stretched over the window
// with the HUD over it (Babylon's hardware scaling level did the same inside the canvas).

use bevy::camera::RenderTarget;
use bevy::light::{DirectionalLightShadowMap, ShadowFilteringMethod};
use bevy::post_process::bloom::Bloom;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureFormat};
use bevy::window::PrimaryWindow;

use crate::map::ShadowLamp;
use crate::picture::{bloom_setting, Picture};

const PRESETS: [&str; 3] = ["High", "Medium", "Low"];
const SLOW: f32 = 1.0 / 36.0;
const FAST: f32 = 1.0 / 55.0; // s a frame
const COARSEST: f32 = 2.5; // 40% of the pixels a side

#[derive(Resource)]
pub struct Graphics {
    pub preset: usize,
    // How many window pixels a side each drawn pixel covers: 1 at full resolution.
    pub level: f32,
    // Off in a scenario: its frames are the software renderer's, and its pictures are compared at full size.
    pub adaptive: bool,
    sum: f32,
    frames: u32,
    slow: u32,
    slower: u32,
    fast: u32,
    quick: u32,
    pub target: Handle<Image>,
}

// Where the preset is kept between runs (the TS kept it in the browser's localStorage).
fn kept() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(Into::into).or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))?;
    Some(base.join("cold-chain").join("quality"))
}

impl Graphics {
    pub fn new(adaptive: bool) -> Self {
        let preset = if adaptive {
            kept().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| PRESETS.iter().position(|&n| n == s.trim())).unwrap_or(0)
        } else {
            0
        };
        Graphics { preset, level: 1.0, adaptive, sum: 0.0, frames: 0, slow: 0, slower: 0, fast: 0, quick: 0, target: Handle::default() }
    }

    pub fn name(&self) -> &'static str {
        PRESETS[self.preset]
    }
}

// The image the 3D camera draws into, shown over the whole window under the HUD.
fn present(mut commands: Commands, mut graphics: ResMut<Graphics>, mut images: ResMut<Assets<Image>>, window: Query<&Window, With<PrimaryWindow>>,
           cameras: Query<Entity, With<Camera3d>>) {
    let size = window.single().map_or(UVec2::new(1280, 720), |w| w.physical_size()).max(UVec2::ONE);
    let image = Image::new_target_texture(size.x, size.y, TextureFormat::Rgba8UnormSrgb, None);
    graphics.target = images.add(image);
    for camera in &cameras {
        commands.entity(camera).insert(RenderTarget::Image(graphics.target.clone().into()));
    }
    commands.spawn((Camera2d, Camera { order: 1, ..default() }, IsDefaultUiCamera));
    commands.spawn((
        Node { position_type: PositionType::Absolute, width: percent(100), height: percent(100), ..default() },
        ImageNode::new(graphics.target.clone()),
        GlobalZIndex(-1),
    ));
}

fn apply(graphics: Res<Graphics>, mut commands: Commands, cameras: Query<Entity, With<Picture>>, mut pictures: Query<&mut Picture>,
         mut lamps: Query<&mut SpotLight, With<ShadowLamp>>, mut shadow_map: ResMut<DirectionalLightShadowMap>) {
    if !graphics.is_changed() || graphics.is_added() && graphics.preset == 0 {
        return;
    }
    let (high, low) = (graphics.preset == 0, graphics.preset == 2);
    for camera in &cameras {
        let mut e = commands.entity(camera);
        if low { e.remove::<Bloom>() } else { e.insert(bloom_setting(if high { 48.0 } else { 24.0 })) };
        e.insert(if high { ShadowFilteringMethod::Gaussian } else { ShadowFilteringMethod::Hardware2x2 });
        if let Ok(mut p) = pictures.get_mut(camera) {
            p.grain = if high { 7.0 } else { 0.0 };
        }
    }
    // (Spot lights' shadow maps are the directional lights' size in Bevy.)
    let size = if high { 2048 } else { 1024 };
    if shadow_map.size != size {
        shadow_map.size = size;
    }
    for mut lamp in &mut lamps {
        lamp.shadow_maps_enabled = !low;
    }
}

fn keys(keys: Res<ButtonInput<KeyCode>>, mut graphics: ResMut<Graphics>, mut note: ResMut<crate::hud::Note>, time: Res<Time<Real>>) {
    if !keys.just_pressed(KeyCode::F3) {
        return;
    }
    graphics.preset = (graphics.preset + 1) % PRESETS.len();
    if let Some(path) = kept() {
        let _ = std::fs::create_dir_all(path.parent().unwrap()).and_then(|_| std::fs::write(&path, graphics.name()));
    }
    note.say(format!("Quality: {} (F3)", graphics.name()), time.elapsed_secs());
}

// Once a frame, with the frame's real length.
fn adapt(time: Res<Time<Real>>, mut graphics: ResMut<Graphics>) {
    if !graphics.adaptive {
        return;
    }
    let dt = time.delta_secs();
    let g = graphics.bypass_change_detection();
    g.sum += dt;
    g.slow += (dt > SLOW) as u32;
    g.slower += (dt > 2.0 * SLOW) as u32;
    g.fast += (dt < FAST) as u32;
    g.frames += 1;
    // (Judged every 30 frames or every second, whichever comes first: at 4 fps 30 frames is too long to wait.)
    if g.frames < 30 && g.sum < 1.0 {
        return;
    }
    // By the middle frame, not the mean: a few long frames from the game's own work are not the card being slow, and
    // fewer pixels do nothing for them (a friend's F2 log: 40% of the screen for a minute on a desktop card running at
    // 80 fps).
    let half = g.frames / 2;
    let was = g.level;
    if g.slow > half {
        g.level = (g.level * if g.slower > half { 1.6 } else { 1.25 }).min(COARSEST);
        g.quick = 0;
    } else if g.fast > half && g.level > 1.0 {
        g.quick += 1;
        if g.quick >= 6 {
            g.level = (g.level / 1.25).max(1.0);
            g.quick = 0;
        }
    }
    (g.sum, g.frames, g.slow, g.slower, g.fast) = (0.0, 0, 0, 0, 0);
    if g.level != was {
        info!("render scale {:.0}%", 100.0 / g.level);
    }
}

// The image kept at the window's size over the level.
fn fit(graphics: Res<Graphics>, window: Query<&Window, With<PrimaryWindow>>, mut images: ResMut<Assets<Image>>) {
    let Ok(w) = window.single() else { return };
    let want = (w.physical_size().as_vec2() / graphics.level).max(Vec2::ONE).as_uvec2();
    let Some(size) = images.get(&graphics.target).map(|i| i.size()) else { return };
    if size != want {
        images.get_mut(&graphics.target).unwrap().resize(Extent3d { width: want.x, height: want.y, depth_or_array_layers: 1 });
    }
}

pub fn plugin(app: &mut App) {
    app.insert_resource(DirectionalLightShadowMap { size: 2048 })
        .add_systems(PostStartup, present)
        .add_systems(Update, (keys, adapt, apply, fit).chain());
}
