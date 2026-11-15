// Scripted runs of the game, for checking it (dev/PORT.md "How it is checked").
//
//     cargo run -- --scenario <name> --out <dir> [--seed <n>]
//
// runs the game with every frame a sixtieth of a second long and everything random drawn from one seeded generator,
// so a run does the same thing each time; waits until everything is loaded; then works through the scenario's steps,
// a frame at a time: waiting, doing anything at all to the world (as a player would, or as a test must), and taking
// screenshots of the window (<dir>/<name>.png). At the end it writes <dir>/log.json, what happened (the steps' own
// entries, each screenshot), and exits.
//
// A scenario is a function below returning its steps, named in `steps`. To add one: write the function (`view` puts
// the player somewhere and takes a picture; `Step::Do` does anything else, `log` writes to the log) and add its name.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bevy::prelude::*;
use bevy::render::view::screenshot::{save_to_disk, Screenshot, ScreenshotCaptured};
use serde_json::{json, Value};

use crate::anatomy::Seeing;
use crate::graphics::Graphics;
use crate::map::Map;
use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Shape;
use crate::rng::Rng;
use crate::{babylon, Loading};

pub struct Run {
    pub name: String,
    pub out: PathBuf,
    pub seed: u32,
}

impl Run {
    // `--scenario <name> --out <dir> [--seed <n>]`, or None for the game.
    pub fn from_args() -> Option<Run> {
        let args: Vec<String> = std::env::args().collect();
        let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
        let name = value("--scenario")?;
        let out = PathBuf::from(value("--out").unwrap_or_else(|| format!("scenario-{name}")));
        let seed = value("--seed").map_or(1, |s| s.parse().expect("--seed takes a number"));
        Some(Run { name, out, seed })
    }
}

pub enum Step {
    // So many frames.
    Wait(u32),
    // Anything, with the whole world in hand.
    Do(Box<dyn FnMut(&mut World) + Send + Sync>),
    // A screenshot of the window as this frame is drawn: <out>/<name>.png.
    Shot(String),
}

// What happened, written out at the end: each entry with the frame it was made in.
#[derive(Resource, Default)]
pub struct Log(pub Vec<Value>);

pub fn log(world: &mut World, what: Value) {
    let frame = world.resource::<Runner>().frame;
    world.resource_mut::<Log>().0.push(json!({ "frame": frame, "what": what }));
}

#[derive(Resource)]
struct Runner {
    name: String,
    seed: u32,
    out: PathBuf,
    steps: VecDeque<Step>,
    // Frames since the run began, and since it was all loaded (None until then).
    frame: u64,
    started: Option<u64>,
    waited: u32,
    shots: usize,
    saved: Arc<AtomicUsize>,
}

// The player put at (x, z) in the TS's space, the eye `eye` above the floor, looking at `toward` (TS space); a few
// frames for the view to settle; a picture.
pub fn view(name: &str, x: f32, z: f32, toward: [f32; 3], eye: f32) -> Vec<Step> {
    vec![
        Step::Do(Box::new(move |w: &mut World| {
            w.resource_scope(|w, map: Mut<Map>| {
                let mut q = w.query::<&mut Player>();
                for mut p in q.iter_mut(w) {
                    let at = babylon(x, 0.0, z);
                    p.spawn(&map, at.x, at.z, Some(babylon(toward[0], toward[1], toward[2])), eye);
                }
            });
        })),
        Step::Wait(6),
        Step::Shot(name.into()),
    ]
}

// Only the person of body `body` shown (all of them with None).
fn only(body: Option<&'static str>) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let mut q = w.query::<(&Person, &mut Visibility)>();
        for (p, mut v) in q.iter_mut(w) {
            *v = if body.is_none_or(|b| p.body.name == b) { Visibility::Inherited } else { Visibility::Hidden };
        }
    }))
}

fn steps(name: &str) -> Option<Vec<Step>> {
    let mut s = Vec::new();
    match name {
        // The hall from where the player starts and from three corners of it.
        "hall" => {
            s.extend(view("hall_spawn", 0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
            s.extend(view("hall_sw", -10.0, -10.0, [3.0, 1.5, 4.0], 1.65));
            s.extend(view("hall_east", 2.0, -2.0, [9.0, 1.5, 2.0], 1.65));
            s.extend(view("hall_north", 5.0, 7.0, [-4.0, 1.0, -6.0], 1.65));
            // The F3 presets, and the picture drawn at 40% a side (what the adaptive scale comes down to at worst).
            for (preset, name) in [(1, "hall_medium"), (2, "hall_low")] {
                s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Graphics>().preset = preset)));
                s.extend(view(name, 0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
            }
            s.push(Step::Do(Box::new(|w: &mut World| {
                let mut g = w.resource_mut::<Graphics>();
                g.preset = 0;
                g.level = 2.5;
            })));
            s.extend(view("hall_scaled", 0.0, -4.0, [0.0, 1.4, 2.0], 1.65));
        }
        // The weapon board, from across the hall and up close.
        "arsenal" => {
            s.extend(view("arsenal_wide", -7.2, -1.2, [-11.0, 1.4, -1.2], 1.65));
            s.extend(view("arsenal_close", -9.3, -2.2, [-11.0, 1.4, -2.2], 1.65));
        }
        // Each person alone, whole from the front and the side, and their face; then everyone seen through (X).
        "people" => {
            s.push(Step::Do(Box::new(segments)));
            for (i, body) in crate::sandbox::BODIES.into_iter().enumerate() {
                let (x, z) = ((i as f32 - 1.5) * 1.5, 2.2);
                s.push(only(Some(body)));
                s.extend(view(&format!("people_{body}_front"), x, z - 2.1, [x, 0.95, z], 1.0));
                s.extend(view(&format!("people_{body}_side"), x + 2.1, z, [x, 0.95, z], 1.0));
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    let mut q = w.query::<&Person>();
                    let h = q.iter(w).find(|p| p.body.name == body).unwrap().height;
                    let mut steps = view(&format!("people_{body}_face"), x, z - 0.6, [x, h - 0.1, z], h - 0.08);
                    // (Put in now, in order, the face's height being the person's own.)
                    let mut runner = w.resource_mut::<Runner>();
                    for step in steps.drain(..).rev() {
                        runner.steps.push_front(step);
                    }
                })));
            }
            s.push(only(None));
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = true)));
            s.extend(view("people_xray", 0.0, -1.5, [0.0, 1.0, 2.2], 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = false)));
        }
        "sound" => s = crate::sound::scenario(),
        _ => return None,
    }
    Some(s)
}

// Each person's ragdoll segments as fitted (ragdoll.rs), into the log: what phase 2's ragdoll is built from.
fn segments(w: &mut World) {
    let mut q = w.query::<&Person>();
    let table: Vec<Value> = q
        .iter(w)
        .map(|p| {
            let segs: Vec<Value> = p
                .segments
                .iter()
                .map(|s| {
                    let shape = match &s.shape {
                        Shape::Capsule { a, b, r } => json!({ "capsule": { "a": a.to_array(), "b": b.to_array(), "r": r } }),
                        Shape::Cuboid { centre, half, rotation } => json!({ "box": { "centre": centre.to_array(), "half": half.to_array(), "rotation": rotation.to_array() } }),
                        Shape::Ball { centre, r } => json!({ "ball": { "centre": centre.to_array(), "r": r } }),
                    };
                    json!({
                        "name": s.name, "bone": p.body.bones[s.bone].name, "mass": s.mass, "group": format!("{:?}", s.group), "limb": s.limb,
                        "parent": s.parent.map(|k| p.segments[k].name.clone()), "joint": s.joint.as_ref().map(|j| format!("{j:?}")),
                        "radius": s.radius, "centre": s.centre.to_array(), "end": s.end.to_array(), "head": s.head.to_array(), "shape": shape,
                        "rest": { "at": s.rest.translation.to_array(), "turn": s.rest.rotation.to_array() },
                    })
                })
                .collect();
            json!({ "person": p.label, "body": p.body.name, "mass": p.mass, "height": p.height, "bones": p.body.bones.len(), "segments": segs })
        })
        .collect();
    log(w, json!({ "event": "segments", "people": table }));
}

// Every texture a material in the world refers to, and every font, loaded (or failed: it will not come).
fn loaded(world: &World) -> bool {
    let server = world.resource::<AssetServer>();
    let done = |id: bevy::asset::UntypedAssetId| server.get_load_state(id).is_none_or(|s| !s.is_loading());
    let materials = world.resource::<Assets<StandardMaterial>>();
    let textures = materials.iter().flat_map(|(_, m)| [&m.base_color_texture, &m.normal_map_texture, &m.metallic_roughness_texture, &m.emissive_texture]);
    let fonts = world.resource::<Assets<Font>>().ids().count() > 0;
    textures.flatten().all(|h| done(h.id().untyped())) && fonts
}

fn run(world: &mut World) {
    world.resource_mut::<Runner>().frame += 1;
    let frame = world.resource::<Runner>().frame;
    if world.resource::<Runner>().started.is_none() {
        // Ready once the hall is filled, everything is in, and a few frames have gone to spawning the glTF scenes and
        // sending the textures' mipmaps up.
        let ready = *world.resource::<State<Loading>>().get() == Loading::Done && loaded(world);
        let mut r = world.resource_mut::<Runner>();
        if ready {
            r.waited += 1;
            if r.waited >= 30 {
                r.started = Some(frame);
                r.waited = 0;
                info!("scenario {} starts at frame {frame}", r.name);
            }
        } else if frame > 60 * 120 {
            panic!("scenario {}: not loaded after {frame} frames", r.name);
        }
        let started = r.started.is_some();
        if started {
            log(world, json!({ "event": "loaded" }));
        }
        return;
    }
    loop {
        let step = world.resource_mut::<Runner>().steps.pop_front();
        match step {
            None => break,
            Some(Step::Wait(n)) => {
                let mut r = world.resource_mut::<Runner>();
                r.waited += 1;
                if r.waited < n {
                    r.steps.push_front(Step::Wait(n));
                    return;
                }
                r.waited = 0;
            }
            Some(Step::Do(mut f)) => f(world),
            Some(Step::Shot(name)) => {
                let (path, saved) = {
                    let mut r = world.resource_mut::<Runner>();
                    r.shots += 1;
                    (r.out.join(format!("{name}.png")), r.saved.clone())
                };
                world
                    .spawn(Screenshot::primary_window())
                    .observe(save_to_disk(path.clone()))
                    .observe(move |_: On<ScreenshotCaptured>| {
                        saved.fetch_add(1, Ordering::SeqCst);
                    });
                log(world, json!({ "event": "screenshot", "file": path }));
                // (One a frame: the next step sees the next frame.)
                return;
            }
        }
    }
    // All done: once the pictures are on disk, the log, and out.
    let r = world.resource::<Runner>();
    if r.saved.load(Ordering::SeqCst) < r.shots {
        return;
    }
    let started = r.started.unwrap();
    let summary = json!({
        "scenario": r.name,
        "seed": r.seed,
        "dt": 1.0 / 60.0,
        "frames": frame - started,
        "loaded_at": started,
        "log": world.resource::<Log>().0,
    });
    let out = r.out.join("log.json");
    std::fs::write(&out, serde_json::to_string_pretty(&summary).unwrap()).unwrap_or_else(|e| panic!("{}: {e}", out.display()));
    info!("scenario {} done: {}", r.name, out.display());
    world.write_message(AppExit::Success);
}

pub fn plugin(this: Run) -> impl Fn(&mut App) {
    move |app: &mut App| {
        let steps = steps(&this.name).unwrap_or_else(|| panic!("no scenario {:?}", this.name));
        std::fs::create_dir_all(&this.out).unwrap_or_else(|e| panic!("{}: {e}", this.out.display()));
        app.insert_resource(Rng::new(this.seed))
            .init_resource::<Log>()
            .insert_resource(Runner {
                name: this.name.clone(),
                seed: this.seed,
                out: this.out.clone(),
                steps: steps.into(),
                frame: 0,
                started: None,
                waited: 0,
                shots: 0,
                saved: Arc::new(AtomicUsize::new(0)),
            })
            .add_systems(Last, run);
    }
}
