// Cold Chain: a hall, four people standing in it, and what the player picks up to use on them.
//
// The port of the TypeScript game (src/, the reference): one module here for each file there, the same names, so the
// original of anything is easy to find (dev/PORT.md). `cargo run` is the game; `cargo run -- --scenario <name> --out
// <dir>` runs one of scenario.rs's scripted runs, deterministically, and exits.

// shortcut: the foundation reads in everything the TS files hold (the anatomy's vessels, the face's pose units, the
// map's questions for blood and sound) before the phase 2 modules that use it exist; take this out once they do.
#![allow(dead_code)]
// A release build on Windows opens no console window beside the game's (a debug build keeps it for the log).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anatomy;
mod arm;
mod arsenal;
mod behaviour;
mod blood;
mod body_scenario;
mod bones;
mod bruise;
mod cut_scenario;
mod cutface;
mod dismember;
mod dressing;
mod fist;
mod eyes;
mod face;
mod flesh;
mod film;
mod floor;
mod fluid;
mod graphics;
mod hider;
mod hands;
mod head_scenario;
mod hud;
mod map;
mod marks;
mod menu;
mod models;
mod muzzle;
mod motor;
mod npc;
mod person;
mod picture;
mod player;
mod poses;
mod profiler;
mod ragdoll;
mod rng;
mod runs;
mod sandbox;
mod scenario;
mod shards;
mod skin;
mod soak;
mod solids;
mod sound;
mod surfaces;
mod thuds;
mod tubes;
mod teeth;
mod throat;
mod vitals;
mod warm;
mod wall;
mod viscera;
mod weapons;
mod wet;
mod wounds;

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use bevy::asset::io::file::FileAssetReader;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::RenderPlugin;
use bevy::time::TimeUpdateStrategy;
use bevy_rapier3d::prelude::*;

// The TypeScript game is drawn by Babylon, which is left-handed: +X right, +Y up, +Z ahead. Bevy is right-handed with
// -Z ahead. Every position the TS gives (the hall's blocks, the lamps, where people stand, what is in the .bin files) is
// brought over by turning Z round, which keeps north ahead of a player who starts looking north and keeps a person's
// left on their left. A turn about an axis comes over as the turn the other way about the axis brought over (or, the
// same thing, the same angle about the axis brought over and negated): a quaternion (x, y, z, w) becomes (-x, -y, z, w).
pub fn babylon(x: f32, y: f32, z: f32) -> Vec3 {
    Vec3::new(x, y, -z)
}

pub fn babylon_quat(q: [f32; 4]) -> Quat {
    Quat::from_xyzw(-q[0], -q[1], q[2], q[3])
}

// The assets: assets/ beside the executable in a game as shipped (a folder with the binary and assets/ in it, wherever
// it is run from); otherwise the repository's, one up from this crate, which `cargo run` finds through
// CARGO_MANIFEST_DIR (Bevy's own base path).
pub static ASSETS: LazyLock<PathBuf> = LazyLock::new(|| {
    let beside = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("assets")));
    match beside {
        Some(dir) if dir.is_dir() => dir,
        _ => FileAssetReader::get_base_path().join("../assets"),
    }
});

pub fn asset_file(path: &str) -> PathBuf {
    ASSETS.join(path)
}

// Where the game is in starting up: the people, props and surfaces are read before the first frame (startup systems),
// the weapons' glTF and every texture load in the background, and the hall is filled once the glTF are in (the arsenal
// needs their sizes to hang them).
#[derive(States, Default, Debug, Clone, PartialEq, Eq, Hash)]
pub enum Loading {
    #[default]
    Assets,
    Done,
}

fn main() -> AppExit {
    let run = scenario::Run::from_args();
    // The player's settings (menu.rs); a scenario's are the defaults, the same on any machine.
    let settings = if run.is_none() { menu::Settings::load() } else { menu::Settings::default() };
    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "Cold Chain".into(),
                    resolution: (1280, 720).into(),
                    ..default()
                }),
                ..default()
            })
            .set(AssetPlugin { file_path: ASSETS.to_string_lossy().into(), ..default() })
            // Every surface seen at a slant, as Babylon's textures were (anisotropy 8), and repeating: the hall's
            // concrete is laid in world metres and tiles.
            .set(ImagePlugin {
                default_sampler: ImageSamplerDescriptor {
                    address_mode_u: ImageAddressMode::Repeat,
                    address_mode_v: ImageAddressMode::Repeat,
                    address_mode_w: ImageAddressMode::Repeat,
                    mag_filter: ImageFilterMode::Linear,
                    min_filter: ImageFilterMode::Linear,
                    mipmap_filter: ImageFilterMode::Linear,
                    anisotropy_clamp: 8,
                    ..default()
                },
            })
            // A scenario's screenshots are of everything drawn: a pipeline still compiling would leave a mesh out of
            // the frame it was wanted in.
            .set(RenderPlugin { synchronous_pipeline_compilation: run.is_some(), ..default() })
            // Bevy's own audio (rodio) is not used: sound.rs mixes with kira on a device of its own. Left in, it opened a
            // second stream on the same device and played silence into it for the whole game (a card opened without a
            // mixer of its own can take only one: kira's would then not open at all).
            .disable::<bevy::audio::AudioPlugin>(),
    )
    .add_plugins(RapierPhysicsPlugin::<NoUserData>::default().in_fixed_schedule())
    // Every physics step a hundred and twentieth of a second, as the TS's (sandbox.ts): as many a frame as its time
    // holds, what is over carried to the next, and a frame longer than a thirtieth run slower than the clock rather
    // than in more steps (Bevy's fixed clock carries the remainder; its virtual clock is capped at a thirtieth).
    .insert_resource(Time::<Fixed>::from_hz(120.0))
    .insert_resource(TimestepMode::Fixed { dt: 1.0 / 120.0, substeps: 1 })
    .insert_resource(ClearColor(Color::srgb(0.02, 0.02, 0.022)))
    .init_state::<Loading>()
    .insert_resource(graphics::Graphics::new(run.is_none(), &settings.quality))
    .add_plugins(menu::plugin(settings))
    .add_systems(Startup, cap_frame)
    .add_plugins((
        rng::plugin,
        picture::plugin,
        graphics::plugin,
        surfaces::plugin,
        models::plugin,
        sound::plugin,
        person::plugin,
        anatomy::plugin,
        npc::plugin,
        weapons::plugin,
        map::plugin,
        player::plugin,
        sandbox::plugin,
        arsenal::plugin,
        hud::plugin,
    ))
    // The hands and ears (dev/PORT.md phase 2): the thing in the hand's flash, the arms and fists, F2.
    .add_plugins((muzzle::plugin, hands::plugin, fist::plugin, profiler::plugin))
    // The body: its segments as Rapier bodies, what works them, and what is heard of them (phase 2, port/body).
    .add_plugins((ragdoll::plugin, behaviour::plugin, thuds::plugin))
    // The body opened: broken bones drawn, limbs cut off, bellies opened (phase 3, port/cut).
    .add_plugins((shards::plugin, dismember::plugin, viscera::plugin, wall::plugin, flesh::plugin))
    // The look of hurt on the skin: wounds, blood on and running down it, bruising, holes in the clothes (phase 3,
    // port/skin).
    .add_plugins((skin::plugin, runs::plugin))
    // Blood out of the body: drops, streams, the floor's pools, the clothes' stains (phase 3, port/blood).
    .add_plugins((fluid::plugin, wet::plugin, floor::plugin, soak::plugin, blood::plugin))
    // The face, the eyes and the mouth (phase 3, port/face).
    .add_plugins((face::plugin, eyes::plugin, teeth::plugin, throat::plugin));
    // Every pipeline made behind a loading screen before play (warm.rs): in the game, and in the scenario that checks it.
    app.add_plugins(warm::plugin(run.as_ref().is_none_or(|r| r.name == "warm")));
    match run {
        // A scenario's frames are all a sixtieth of a second long, whatever the machine takes to draw them.
        Some(run) => {
            app.insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(1.0 / 60.0)));
            app.add_plugins(scenario::plugin(run));
        }
        None => {}
    }
    app.run()
}

fn cap_frame(mut time: ResMut<Time<Virtual>>) {
    time.set_max_delta(Duration::from_secs_f64(1.0 / 30.0));
}
