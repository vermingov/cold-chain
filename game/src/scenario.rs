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

use bevy::ecs::system::RunSystemOnce;
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
    // A frame at a time until it says so (or `most` frames have gone): a moment that cannot be counted in advance.
    Until(Box<dyn FnMut(&mut World) -> bool + Send + Sync>, u32),
}

// Where the run's pictures and log go.
#[derive(Resource)]
pub struct Out(pub PathBuf);

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
                let (x, z) = ((i as f32 - (crate::sandbox::BODIES.len() as f32 - 1.0) / 2.0) * 1.5, 2.2);
                s.push(only(Some(body)));
                s.extend(view(&format!("people_{body}_front"), x, z - 2.1, [x, 0.95, z], 1.0));
                s.extend(view(&format!("people_{body}_side"), x + 2.1, z, [x, 0.95, z], 1.0));
                s.extend(view(&format!("people_{body}_hips"), x + 0.25, z - 0.75, [x, 0.85, z], 0.95));
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
        "arsenal-use" => s = crate::weapons::scenario(),
        "viewmodel" => s = crate::weapons::viewmodel(),
        "punches" => s = crate::fist::scenario(),
        "blasts" => s = crate::weapons::blasts(),
        "wounds" => s = wounds(),
        "cut" => s = crate::cut_scenario::steps(""),
        "stumps" => s = crate::cut_scenario::stumps(true),
        "stumps-dressed" => s = crate::cut_scenario::stumps(false),
        "cut-limbs" | "cut-belly" | "cut-bones" => s = crate::cut_scenario::steps(&name[4..]),
        "blood" => s = crate::blood::scenario(),
        // The look of hurt on the skin (port/skin): skin.rs.
        "skin" => s = crate::skin::scenario(),
        // Gunshot wounds, in and out, close up (port/wound): skin.rs.
        "gunshot" => s = crate::skin::gunshot(),
        // The face, the eyes and the mouth (port/face): face.rs; every pipeline made before play (warm.rs).
        "face" => s = crate::face::scenario(),
        "warm" => s = crate::warm::scenario(),
        // The mouth filling with blood, the face cut, the skull opened, the eyes hurt (BACKLOG item 7): head_scenario.rs.
        "head" => s = crate::head_scenario::steps(""),
        "head-mouth" | "head-face" | "head-skull" | "head-eyes" => s = crate::head_scenario::steps(&name[5..]),
        // The Escape menu and its settings (menu.rs).
        "menu" => s = crate::menu::scenario(),
        _ => return body(name),
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
pub fn loaded(world: &World) -> bool {
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
        let ready = *world.resource::<State<Loading>>().get() == Loading::Done && loaded(world) && crate::warm::ready(world);
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
            Some(Step::Until(mut f, most)) => {
                if most > 0 && !f(world) {
                    world.resource_mut::<Runner>().steps.push_front(Step::Until(f, most - 1));
                    return;
                }
            }
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
            .insert_resource(Out(this.out.clone()))
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
            .init_resource::<Jitter>()
            .add_systems(FixedUpdate, jitter.after(crate::ragdoll::Steps::Read))
            .add_systems(Last, (heard, run).chain());
    }
}

// --- the body (port/body) --------------------------------------------------------------------------------------------
//
// The ragdolls and what works them, against the TS game's numbers: standing, shoved over, getting up, crawling, dragged
// by a hand, dead. Each logs what the people are doing second by second and how much they shake: the jitter measure of
// the TS's scratch rig (jitter.mjs), each segment's high-frequency spin, the RMS of the second difference of its
// angular velocity from one physics step to the next (rad/s), per second; a situation's number is that over every
// segment, second and person in it, as the TS's multi.py and analyse.py took it.

use crate::behaviour::{Behaviour, Grabbed, Mode, State as Doing};
use crate::ragdoll::Ragdoll;

#[derive(Default)]
struct Acc {
    state: Option<Doing>,
    mode: Option<Mode>,
    // Where the chest was as the second began (the TS's jitter.mjs `at`: how far and fast they went).
    at: Option<Vec3>,
    // Per segment: steps, the sum of the squared second difference, of |w|.
    segs: Vec<(u32, f64, f64)>,
    // Per segment, the most its joint went past its range on each axis (hinge, twist, side), and the shoulders past
    // their cone (left, right): radians.
    past: Vec<[f32; 3]>,
    cone: [f32; 2],
}

#[derive(Resource, Default)]
struct Jitter {
    // Per person (by entity): each segment's last two angular velocities, and the seconds measured.
    last: std::collections::HashMap<Entity, Vec<(Option<Vec3>, Option<Vec3>)>>,
    bins: std::collections::BTreeMap<(Entity, u32), Acc>,
    // Rapier's own time for its steps (ms), and how many.
    step_ms: f64,
    steps: u32,
}

fn jitter(time: Res<Time>, runner: Res<Runner>, mut j: ResMut<Jitter>, people: Query<(Entity, &Ragdoll, &Behaviour)>,
          sims: Query<&bevy_rapier3d::prelude::RapierContextSimulation>) {
    let Some(started) = runner.started else { return };
    for sim in &sims {
        j.step_ms += sim.step_stats().step_time_ms;
        j.steps += 1;
    }
    let second = ((runner.frame - started) / 60) as u32;
    let _ = time;
    for (e, rd, b) in &people {
        let last = j.last.entry(e).or_insert_with(|| vec![(None, None); rd.segs.len()]).clone();
        let mut now = last.clone();
        let acc = j.bins.entry((e, second)).or_default();
        acc.state = Some(b.state);
        acc.mode = Some(b.mode);
        acc.at.get_or_insert(rd.segs[rd.by_name("chest")].now.translation);
        acc.segs.resize(rd.segs.len(), (0, 0.0, 0.0));
        acc.past.resize(rd.segs.len(), [0.0; 3]);
        for (k, s) in rd.segs.iter().enumerate() {
            if s.def.parent.is_some() && !s.def.joint.as_ref().unwrap().lock && !rd.cut_off(k) {
                let p = rd.past(k);
                for i in 0..3 {
                    acc.past[k][i] = acc.past[k][i].max(p[i]);
                }
            }
        }
        for (i, side) in ["L", "R"].iter().enumerate() {
            let arm = rd.by_name(&format!("upperarm{side}"));
            if !rd.segs[arm].broken && !rd.cut_off(arm) {
                acc.cone[i] = acc.cone[i].max(rd.cone(arm));
            }
        }
        for (k, s) in rd.segs.iter().enumerate() {
            let w = s.spin;
            if let (Some(p), Some(p2)) = last[k] {
                let h = w - 2.0 * p + p2;
                let a = &mut acc.segs[k];
                a.0 += 1;
                a.1 += h.length_squared() as f64;
                a.2 += w.length() as f64;
            }
            now[k] = (Some(w), last[k].0);
        }
        j.last.insert(e, now);
    }
}

// The people in the order they were made.
fn everyone(w: &mut World) -> Vec<Entity> {
    let mut q = w.query_filtered::<Entity, With<Person>>();
    let mut v: Vec<Entity> = q.iter(w).collect();
    v.sort();
    v
}

// The mean high-frequency spin over every segment, second and person `pick` takes (person's place in the line, second,
// state, mode), and the five segments that shake most; into the log as `name`.
fn situation(name: &'static str, pick: impl Fn(usize, u32, Doing, Mode) -> bool + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let people = everyone(w);
        let names: Vec<String> = {
            let mut q = w.query::<&Ragdoll>();
            q.iter(w).next().map(|rd| rd.segs.iter().map(|s| s.def.name.clone()).collect()).unwrap_or_default()
        };
        let j = w.resource::<Jitter>();
        let mut per: Vec<(f64, f64, u32)> = vec![(0.0, 0.0, 0); names.len()];
        // The most each joint went past its range (degrees, and on which axis), and the shoulders past their cone.
        let mut past: Vec<(f32, usize)> = vec![(0.0, 0); names.len()];
        let mut cone = [0.0f32; 2];
        for (&(e, t), acc) in &j.bins {
            let Some(i) = people.iter().position(|&p| p == e) else { continue };
            if !pick(i, t, acc.state.unwrap(), acc.mode.unwrap()) {
                continue;
            }
            for (k, p) in acc.past.iter().enumerate() {
                for i in 0..3 {
                    if p[i] > past[k].0 {
                        past[k] = (p[i], i);
                    }
                }
            }
            for i in 0..2 {
                cone[i] = cone[i].max(acc.cone[i]);
            }
            for (k, &(n, h2, wsum)) in acc.segs.iter().enumerate() {
                if n > 0 && k < per.len() {
                    per[k].0 += (h2 / n as f64).sqrt();
                    per[k].1 += wsum / n as f64;
                    per[k].2 += 1;
                }
            }
        }
        let rows: Vec<(String, f64, f64)> = per.iter().zip(&names).filter(|(p, _)| p.2 > 0).map(|(p, n)| (n.clone(), p.0 / p.2 as f64, p.1 / p.2 as f64)).collect();
        let seconds = per.first().map_or(0, |p| p.2);
        let mean = if rows.is_empty() { 0.0 } else { rows.iter().map(|r| r.1).sum::<f64>() / rows.len() as f64 };
        let mut worst = rows.clone();
        worst.sort_by(|a, b| b.1.total_cmp(&a.1));
        let worst: Vec<Value> = worst.iter().take(5).map(|(n, hf, w)| json!({ "seg": n, "hf": (hf * 100.0).round() / 100.0, "w": (w * 100.0).round() / 100.0 })).collect();
        const AXES: [&str; 3] = ["hinge", "twist", "side"];
        let deg = |r: f32| (r / crate::person::RAD * 10.0).round() / 10.0;
        let mut over: Vec<(String, f32, usize)> = past.iter().zip(&names).map(|(p, n)| (n.clone(), p.0, p.1)).filter(|p| p.1 > 0.0).collect();
        over.sort_by(|a, b| b.1.total_cmp(&a.1));
        let over: Vec<Value> = over.iter().take(6).map(|(n, r, i)| json!({ "seg": n, "axis": AXES[*i], "deg": deg(*r) })).collect();
        info!("jitter {name}: mean hf {mean:.2} rad/s over {seconds} person-seconds; past range {over:?}, cone {cone:?}");
        log(w, json!({ "event": "jitter", "situation": name, "person_seconds": seconds, "mean_hf": (mean * 1000.0).round() / 1000.0, "worst": worst,
            "past_range": over, "past_cone_deg": cone.map(|c| deg(c.max(0.0))),
            "segments": rows.iter().map(|(n, hf, _)| json!([n, (hf * 1000.0).round() / 1000.0])).collect::<Vec<_>>() }));
    }))
}

// Second by second, what each person was doing, where their chest was, and their mean high-frequency spin.
fn timeline(w: &mut World) {
    let people = everyone(w);
    let mut chests = std::collections::HashMap::new();
    {
        let mut q = w.query::<(Entity, &Ragdoll)>();
        for (e, rd) in q.iter(w) {
            chests.insert(e, rd.segs[rd.by_name("chest")].now.translation);
        }
    }
    let j = w.resource::<Jitter>();
    let rows: Vec<Value> = j.bins.iter().filter_map(|(&(e, t), acc)| {
        let i = people.iter().position(|&p| p == e)?;
        let hf: Vec<f64> = acc.segs.iter().filter(|s| s.0 > 0).map(|s| (s.1 / s.0 as f64).sqrt()).collect();
        let mean = hf.iter().sum::<f64>() / hf.len().max(1) as f64;
        let at = acc.at.map(|a| [a.x, a.y, a.z].map(|c| (c * 1000.0).round() / 1000.0));
        Some(json!({ "person": i, "t": t, "state": format!("{:?}", acc.state?), "mode": format!("{:?}", acc.mode?), "hf": (mean * 100.0).round() / 100.0, "at": at }))
    }).collect();
    let at: Vec<Value> = people.iter().map(|e| json!(chests.get(e).map(|c| c.to_array()))).collect();
    let ms = j.step_ms / j.steps.max(1) as f64;
    log(w, json!({ "event": "timeline", "seconds": rows, "chests": at, "physics_ms_per_step": (ms * 100.0).round() / 100.0 }));
}

// What is heard (thuds.rs), into the log while sound.rs is not there to play it.
fn heard(mut heard: MessageReader<crate::thuds::Heard>, runner: Res<Runner>, mut log: ResMut<Log>) {
    for h in heard.read() {
        log.0.push(json!({ "frame": runner.frame, "what": { "event": "heard", "name": h.name, "at": h.at.to_array(), "gain": (h.gain * 100.0).round() / 100.0 } }));
    }
}

// Every person (or the `i`th) made to do something, with their body, mind and the dice.
fn each(i: Option<usize>, f: impl Fn(&mut Ragdoll, &mut Behaviour, &mut Rng) + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let people = everyone(w);
        w.resource_scope(|w, mut rng: Mut<Rng>| {
            for (n, &e) in people.iter().enumerate() {
                if i.is_some_and(|i| i != n) {
                    continue;
                }
                let mut q = w.query::<(&mut Ragdoll, &mut Behaviour)>();
                let (mut rd, mut b) = q.get_mut(w, e).unwrap();
                f(&mut rd, &mut b, &mut rng);
            }
        });
    }))
}

// Steps put next, before the rest (for a step that works out what it will do when it comes to it).
pub fn push_front(w: &mut World, steps: VecDeque<Step>) {
    let mut runner = w.resource_mut::<Runner>();
    for s in steps.into_iter().rev() {
        runner.steps.push_front(s);
    }
}

// The player put `back` metres off person `i`'s chest, `side` to their right of the line from them to the hall's south
// end, the eye `eye` high, looking at the chest; a picture.
fn watch(name: String, i: usize, back: f32, side: f32, eye: f32) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let e = everyone(w)[i];
        let c = {
            let rd = w.entity(e).get::<Ragdoll>().unwrap();
            rd.segs[rd.by_name("chest")].now.translation
        };
        w.resource_scope(|w, map: Mut<Map>| {
            let mut q = w.query::<&mut Player>();
            for mut p in q.iter_mut(w) {
                p.spawn(&map, c.x + side, c.z + back, Some(c), eye);
            }
        });
        let mut runner = w.resource_mut::<Runner>();
        runner.steps.push_front(Step::Shot(name.clone()));
        runner.steps.push_front(Step::Wait(3));
    }))
}

// `n` pictures `every` frames apart, the player kept on person `i` as they move.
fn film(s: &mut Vec<Step>, name: &str, i: usize, n: usize, every: u32, back: f32, side: f32, eye: f32) {
    for k in 0..n {
        s.push(watch(format!("{name}_{k}"), i, back, side, eye));
        s.push(Step::Wait(every));
    }
}

fn body(name: &str) -> Option<Vec<Step>> {
    let mut s: Vec<Step> = Vec::new();
    match name {
        // Four people standing ten seconds: no drift, no jitter.
        "stand" => {
            s.push(Step::Do(Box::new(timeline_start)));
            s.extend(view("stand_0", 0.0, -2.0, [0.0, 1.0, 2.2], 1.65));
            for k in 1..5 {
                s.push(Step::Wait(120));
                s.extend(view(&format!("stand_{k}"), 0.0, -2.0, [0.0, 1.0, 2.2], 1.65));
            }
            s.push(Step::Wait(100));
            film(&mut s, "stand_feet", 1, 1, 2, -1.0, 0.6, 0.6);
            s.push(situation("standing", |_, t, st, _| t >= 1 && st == Doing::Stand));
            s.push(Step::Do(Box::new(drift)));
        }
        // Knocked out and shoved hard backwards (north, away from the player): falling, then lying still.
        "fall" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                for mut v in w.query::<&mut crate::vitals::Vitals>().iter_mut(w) {
                    v.out = 1e9;
                }
            })));
            s.push(each(None, |rd, b, rng| {
                let chest = rd.by_name("chest");
                let at = rd.middle(chest);
                rd.push(chest, Vec3::new(0.0, 0.0, -60.0), at);
                b.knock_down(rng);
            }));
            film(&mut s, "fall", 1, 8, 20, -2.2, 1.6, 1.4);
            s.push(Step::Wait(240));
            s.extend(view("fall_still", 0.0, -1.0, [0.0, 0.2, 3.0], 1.65));
            s.push(situation("lying still after the fall", |_, t, st, _| t >= 6 && st == Doing::Down));
        }
        // Shoved over from behind, awake: down on the front, then up again (onto all fours, a knee, a foot, up).
        "getup" => {
            s.push(Step::Wait(60));
            s.push(each(None, |rd, b, rng| {
                let chest = rd.by_name("chest");
                let at = rd.middle(chest);
                rd.push(chest, Vec3::new(0.0, 0.0, 60.0), at);
                b.knock_down(rng);
            }));
            film(&mut s, "getup", 2, 16, 45, -2.6, 1.8, 1.5);
            s.push(Step::Wait(120));
            s.push(situation("getting up", |_, t, st, _| t >= 2 && st == Doing::Down));
            s.push(situation("stood up again", |_, t, st, _| t >= 4 && st == Doing::Stand));
        }
        // Legs paralysed: down, rolled onto the front, and dragging themselves away on the elbows.
        "crawl" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                for mut v in w.query::<&mut crate::vitals::Vitals>().iter_mut(w) {
                    v.paralysed_legs = true;
                }
            })));
            s.push(each(None, |_, b, rng| b.knock_down(rng)));
            // (The player stays where they start until then: each crawls away from the eye as it was when they began.)
            s.push(Step::Wait(60 * 12));
            film(&mut s, "crawl", 1, 8, 6, -0.3, -2.6, 2.2);
            s.push(Step::Wait(60 * 10));
            s.push(situation("crawl", |_, _, _, m| m == Mode::Crawl));
        }
        // The groundskeeper (the TS's npc 3, whom jitter.mjs dragged; tools/port-drag.mjs does the same in the TS game)
        // taken by the right hand from 1.4 m off and swept about for eight seconds (the eye's yaw 0.6 rad either way at
        // 0.4 Hz, its pitch at 0.27 Hz), as jitter.mjs did, then let go.
        "drag" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let e = person_at(w, 1);
                let (at, centre) = {
                    let rd = w.entity(e).get::<Ragdoll>().unwrap();
                    let hand = rd.by_name("handR");
                    (rd.middle(hand), rd.centre())
                };
                let mut back = centre - at;
                back.y = 0.0;
                let back = back.normalize();
                w.resource_scope(|w, map: Mut<Map>| {
                    let mut q = w.query::<&mut Player>();
                    for mut p in q.iter_mut(w) {
                        p.spawn(&map, at.x - back.x * 1.4, at.z - back.z * 1.4, Some(at), 1.65);
                    }
                });
                let (eye, yaw0) = {
                    let p = w.query::<&Player>().iter(w).next().unwrap();
                    (p.eye().translation, p.yaw)
                };
                let g = Grabbed::at(w.entity(e).get::<Ragdoll>().unwrap(), at, eye);
                w.entity_mut(e).insert(g);
                let mut runner = w.resource_mut::<Runner>();
                let mut steps = Vec::new();
                for k in 0..480u32 {
                    let t = k as f32 / 60.0;
                    if k == 144 || k == 230 {
                        steps.push(cameras(true));
                    } else if k == 0 || k == 151 || k == 264 {
                        steps.push(cameras(false));
                    }
                    // (The dragger's eye is kept here, standing where they took hold: the player's own camera is free to
                    // be put beside the body for the pictures.)
                    steps.push(Step::Do(Box::new(move |w: &mut World| {
                        let yaw = yaw0 + 0.6 * (t * std::f32::consts::TAU * 0.4).sin();
                        // (The TS's pitch 0.35 down is -0.35 here: up is positive.)
                        let pitch = -(0.35 + 0.15 * (t * std::f32::consts::TAU * 0.27).sin());
                        let ahead = Quat::from_euler(EulerRot::YXZ, yaw, pitch, 0.0) * Vec3::NEG_Z;
                        let mut q = w.query::<&mut Grabbed>();
                        for mut g in q.iter_mut(w) {
                            g.aim(eye, ahead);
                        }
                        // Where the hand held is against where it is drawn to, each second.
                        if k % 60 == 0 {
                            let Some(g) = w.entity(e).get::<Grabbed>().map(|g| (g.seg, g.local, g.target)) else { return };
                            let rd = w.entity(e).get::<Ragdoll>().unwrap();
                            let held = rd.world_point(g.0, g.1);
                            log(w, json!({ "event": "held", "t": t, "segment": rd.segs[g.0].def.name, "at": held.to_array(), "target": g.2.map(|t| t.to_array()) }));
                        }
                    })));
                    // Seen from beside: the dragger's own view, then a strip of frames from 2 m off the body's middle.
                    if k == 150 {
                        steps.push(Step::Shot("drag_eye".into()));
                    } else if (240..264).contains(&k) && k % 3 == 0 {
                        steps.push(Step::Do(Box::new(move |w: &mut World| {
                            let c = w.entity(e).get::<Ragdoll>().unwrap().centre();
                            w.resource_scope(|w, map: Mut<Map>| {
                                let mut q = w.query::<&mut Player>();
                                for mut p in q.iter_mut(w) {
                                    p.spawn(&map, c.x + 1.6, c.z + 1.2, Some(c), 1.3);
                                }
                            });
                        })));
                        steps.push(Step::Shot(format!("drag_{}", (k - 240) / 3)));
                    } else {
                        steps.push(Step::Wait(2));
                    }
                }
                steps.push(Step::Do(Box::new(move |w: &mut World| {
                    w.entity_mut(e).remove::<Grabbed>();
                })));
                for step in steps.into_iter().rev() {
                    runner.steps.push_front(step);
                }
            })));
            s.push(Step::Wait(120));
            // (`everyone` sorts by entity, which puts the line-up the other way round: the groundskeeper is its third.)
            s.push(situation("dragged by the hand", |i, t, _, _| i == 2 && (2..=8).contains(&t)));
        }
        // Dead (the heart stopped) and down: lying dead and still.
        "dead" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let mut q = w.query::<&mut crate::vitals::Vitals>();
                for mut v in q.iter_mut(w) {
                    v.dead = true;
                    v.brain_damage = 1.0;
                }
            })));
            s.push(each(None, |_, b, rng| b.knock_down(rng)));
            film(&mut s, "dead", 2, 4, 60, -2.4, 1.2, 1.5);
            s.push(Step::Wait(60 * 6));
            s.extend(view("dead_still", 0.0, -1.0, [0.0, 0.2, 3.0], 1.65));
            s.push(situation("dead lying still", |_, t, _, _| t >= 4));
        }
        // Joints loaded past what they allow (port/item7-joints): a blow across one standing man's forearm and one to the
        // side of another's head, a kick across the knee of a man knocked out, a dead man thrown up and over. How far each
        // joint went past its range (`past_range`, degrees, as the joints' own angles read it) and the shoulders past
        // their cone, in each situation's log (every body scenario logs them).
        "limits" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let people = everyone(w);
                for (i, &e) in people.iter().enumerate() {
                    let Some(mut v) = w.get_mut::<crate::vitals::Vitals>(e) else { continue };
                    match i {
                        1 => v.out = 1e9,
                        2 => {
                            v.dead = true;
                            v.brain_damage = 1.0;
                        }
                        _ => {}
                    }
                }
            })));
            s.push(each(Some(1), |_, b, rng| b.knock_down(rng)));
            s.push(each(Some(2), |_, b, rng| b.knock_down(rng)));
            s.push(Step::Wait(60));
            // A bat's blow (0.8 kg at 15 m/s) across the forearm and to the side of the head; a kick (some 25 N s) across
            // the knee; the whole body thrown up and back at 5 m/s.
            s.push(each(Some(0), |rd, _, _| {
                let k = rd.by_name("forearmR");
                let at = rd.middle(k);
                rd.push(k, Vec3::new(-12.0, 0.0, 0.0), at);
            }));
            s.push(each(Some(3), |rd, _, _| {
                let k = rd.by_name("head");
                let at = rd.middle(k);
                rd.push(k, Vec3::new(12.0, 0.0, 0.0), at);
            }));
            s.push(each(Some(1), |rd, _, _| {
                let k = rd.by_name("shinL");
                let at = rd.segs[k].now.translation;
                rd.push(k, Vec3::new(25.0, 0.0, 0.0), at);
            }));
            // (Each part pushed at its bone's head, as the grenade's blast pushes them, so the body turns as it goes.)
            s.push(each(Some(2), |rd, _, _| {
                for k in rd.attached.clone() {
                    let at = rd.segs[k].now.translation;
                    let m = rd.segs[k].def.mass;
                    rd.push(k, Vec3::new(1.5, 4.0, -2.5) * m, at);
                }
            }));
            film(&mut s, "limits", 2, 6, 10, -2.6, 1.8, 1.5);
            s.push(Step::Wait(60 * 4));
            s.extend(view("limits_still", 0.0, -1.0, [0.0, 0.2, 3.0], 1.65));
            s.push(situation("blows", |i, t, _, _| i != 2 && (2..=4).contains(&t)));
            s.push(situation("thrown", |i, t, _, _| i == 2 && (2..=5).contains(&t)));
            s.push(situation("lying after", |i, t, _, _| i != 0 && t >= 6));
        }
        // The chest wall (port/item7-joints): how deep the breastbone and the front ribs and their cartilage lie under the
        // skin of each person standing, along lines straight back through the chest at the middle and 4.5 and 9 cm either
        // side (about the mid-clavicular line), every 2 cm down from the top of the breastbone. A real chest wall is 41-45 mm
        // deep at the mid-clavicular line on CT (dev/research/body-wall.md 1.2); the TS's bins had the front ribs 0-9 mm
        // under the skin before tools/anatomy.py `chest_depth`. Then the x-ray of it from the side and the front.
        "chest" => {
            s.push(Step::Wait(30));
            s.push(Step::Do(Box::new(|w: &mut World| {
                for (i, e) in everyone(w).into_iter().enumerate() {
                    let rows = crate::npc::with(w, e, |npc| {
                        let chest = npc.bone_index("spine01");
                        let m = npc.rest_to_world(chest);
                        let notch = (npc.body().bones[npc.bone_index("clavicle.L")].head + npc.body().bones[npc.bone_index("clavicle.R")].head) / 2.0;
                        let ahead = m.transform_vector3(Vec3::NEG_Z).normalize();
                        let mut rows = Vec::new();
                        for down in 0..12 {
                            for x in [-0.09, -0.045, 0.0, 0.045, 0.09] {
                                let at = m.transform_point3(notch + Vec3::new(x, -0.02 * down as f32, 0.0));
                                let from = at + ahead * 0.4;
                                let skin = npc.surface(from, -ahead, 0.8, false).into_iter().find(|c| c.kind == crate::npc::Kind::Skin).map(|c| c.t);
                                let bone = |p: &crate::anatomy::TracedPart| p.kind == "bone" || p.kind == "cartilage";
                                let (spans, _) = npc.trace(from, -ahead, 0.8, 0.0, Some(&bone));
                                let first = spans.first().map(|s| (s.enter, npc.traced.parts[s.part].name.clone()));
                                let depth = match (skin, &first) {
                                    (Some(a), Some((b, _))) => Some(((b - a) * 1000.0).round()),
                                    _ => None,
                                };
                                rows.push(json!({ "x_cm": x * 100.0, "down_cm": 2 * down, "depth_mm": depth, "part": first.map(|f| f.1) }));
                            }
                        }
                        (npc.person.label.clone(), rows)
                    });
                    if let Some((who, rows)) = rows {
                        log(w, json!({ "event": "chest wall", "person": i, "who": who, "rows": rows }));
                    }
                }
            })));
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = true)));
            for (i, side) in [(1usize, 0.9f32), (2, 0.9)] {
                s.push(watch(format!("chest_xray_side_{i}"), i, 0.0, side, 1.35));
                s.push(watch(format!("chest_xray_front_{i}"), i, -0.9, 0.0, 1.35));
            }
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = false)));
            s.push(watch("chest_skin_side".into(), 1, 0.0, 0.9, 1.35));
        }
        // K after heavy damage (the TS hung there): the line-up shot many times, cut with the sword and knife, a grenade,
        // blood left to run; then K, with the profiler open (its log, `coldchain-profile-*.json`, saved beside log.json)
        // and each frame's time round it logged.
        "khang" => {
            use crate::warm::{aim, press, release, take};
            s.push(Step::Do(Box::new(crate::profiler::open)));
            let fight: [(&'static str, usize, &'static str, f32, u8, u32); 14] = [
                ("ak", 0, "chest", 3.0, 0, 30), ("ak", 1, "belly", 3.0, 0, 30), ("shotgun", 2, "chest", 2.0, 0, 2), ("shotgun", 3, "belly", 2.0, 0, 2),
                ("pistol", 0, "head", 2.5, 0, 2), ("m4", 2, "thighL", 3.0, 0, 30), ("rifle", 3, "chest", 3.0, 0, 2),
                ("sword", 0, "upperarmL", 0.8, 2, 10), ("sword", 1, "forearmR", 0.8, 2, 10), ("sword", 2, "shinL", 0.8, 2, 10),
                ("knife", 3, "belly", 0.6, 0, 10), ("bat", 1, "head", 0.8, 0, 10), ("grenade", 1, "chest", 5.0, 0, 3), ("shotgun", 0, "belly", 1.5, 0, 2),
            ];
            for (key, n, part, far, button, hold) in fight {
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    take(w, key);
                    aim(w, n, part, far);
                })));
                s.push(Step::Wait(50));
                s.push(Step::Do(Box::new(move |w: &mut World| press(w, button))));
                s.push(Step::Wait(hold));
                s.push(Step::Do(Box::new(move |w: &mut World| release(w, button))));
                s.push(Step::Wait(40));
            }
            s.push(Step::Wait(300));
            s.extend(view("khang_before", 0.0, -3.0, [0.0, 0.5, 2.2], 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| w.insert_resource(Clock(std::time::Instant::now(), Vec::new())))));
            for k in 0..40 {
                if k == 5 {
                    s.push(Step::Do(Box::new(|w: &mut World| {
                        let t = std::time::Instant::now();
                        let _ = w.run_system_once(crate::sandbox::reset);
                        let ms = t.elapsed().as_secs_f64() * 1000.0;
                        log(w, json!({ "event": "reset", "system_ms": (ms * 10.0).round() / 10.0 }));
                    })));
                }
                s.push(Step::Do(Box::new(|w: &mut World| {
                    let mut c = w.resource_mut::<Clock>();
                    let now = std::time::Instant::now();
                    let ms = (now - c.0).as_secs_f64() * 1000.0;
                    c.0 = now;
                    c.1.push((ms * 10.0).round() / 10.0);
                })));
                s.push(Step::Wait(1));
            }
            s.push(Step::Do(Box::new(|w: &mut World| {
                let frames = w.resource::<Clock>().1.clone();
                log(w, json!({ "event": "frames round K (ms; K in the sixth)", "ms": frames }));
            })));
            s.extend(view("khang_after", 0.0, -3.0, [0.0, 0.5, 2.2], 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let dir = w.resource::<Out>().0.clone();
                crate::profiler::save_in(w, dir);
            })));
            s.push(Step::Wait(2));
        }
        // K and N: the room cleared and lined up again (every body and joint of the old people gone), then two more made
        // where the eye looks, one on the floor ahead and one up on the ledge.
        "keys" => {
            s.push(Step::Wait(30));
            s.push(Step::Do(Box::new(count)));
            s.push(Step::Do(Box::new(|w: &mut World| { let _ = w.run_system_once(crate::sandbox::reset); })));
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(count)));
            s.extend(view("keys_reset", 0.0, -2.0, [0.0, 1.0, 2.2], 1.65));
            s.extend(view("keys_aim_floor", 0.0, -3.0, [-2.0, 0.0, -0.5], 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| { let _ = w.run_system_once(crate::sandbox::spawn_looked_at); })));
            s.extend(view("keys_aim_ledge", 5.0, -2.0, [9.0, 1.0, -2.0], 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| { let _ = w.run_system_once(crate::sandbox::spawn_looked_at); })));
            s.push(Step::Wait(120));
            s.push(Step::Do(Box::new(count)));
            s.extend(view("keys_made", 3.0, -5.0, [3.0, 0.8, -1.0], 1.65));
        }
        // Dressings on an arm that is then cut off (dressing.rs `severed`): the old man shot through the right forearm
        // and wrist, the groundskeeper through the right upper arm and forearm, every wound dressed; then each right
        // forearm chopped through, the old man's across its dressing (it comes away), the groundskeeper's below the upper
        // arm's (it stays) and above the forearm's wound (that one goes with the piece).
        "dressing" => {
            s.push(Step::Wait(90));
            s.push(Step::Do(Box::new(|w: &mut World| {
                for (i, wounds) in [(0, [("lowerarm01.R", "wrist.R", 0.55), ("lowerarm01.R", "wrist.R", 0.95)]), (1, [("upperarm01.R", "lowerarm01.R", 0.5), ("lowerarm01.R", "wrist.R", 0.8)])] {
                    let who = person_at(w, i);
                    crate::npc::with(w, who, |npc| {
                        for (a, b, t) in wounds {
                            let (ia, ib) = (npc.bone_index(a), npc.bone_index(b));
                            let at = npc.rest_to_world(ia).transform_point3(npc.body().bones[ia].head.lerp(npc.body().bones[ib].head, t));
                            let dir = babylon(0.0, 0.0, 1.0);
                            crate::wounds::pierce(npc, at - dir * 1.5, dir, &missile("pistol"), 3.0);
                        }
                        while let Some(wound) = crate::dressing::wounds(npc).into_iter().next() {
                            if crate::dressing::dress(npc, &wound).is_none() {
                                break;
                            }
                        }
                    });
                }
            })));
            s.push(Step::Wait(30));
            s.push(Step::Do(Box::new(|w: &mut World| dressings(w, "dressed"))));
            s.extend(view("dressing_on", 0.0, -1.2, [-1.4, 1.1, 2.2], 1.6));
            s.push(Step::Do(Box::new(|w: &mut World| {
                for (i, t) in [(0, 0.55), (1, 0.45)] {
                    let who = person_at(w, i);
                    let p = crate::npc::with(w, who, |npc| {
                        let (ia, ib) = (npc.bone_index("lowerarm01.R"), npc.bone_index("wrist.R"));
                        npc.rest_to_world(ia).transform_point3(npc.body().bones[ia].head.lerp(npc.body().bones[ib].head, t))
                    });
                    let off = p.is_some_and(|p| crate::dismember::chop(w, who, p, babylon(-1.0, -0.3, 0.0).normalize(), 200.0));
                    log(w, json!({ "event": "chop", "person": i, "off": off }));
                }
            })));
            s.push(Step::Wait(3));
            s.push(Step::Do(Box::new(|w: &mut World| dressings(w, "cut"))));
            s.push(Step::Wait(120));
            s.push(Step::Do(Box::new(|w: &mut World| dressings(w, "two seconds on"))));
            s.extend(view("dressing_cut", 0.0, -1.2, [-1.4, 0.3, 2.0], 1.6));
            // Close on each stump and piece, from the side its end faces.
            for i in 0..2 {
                for piece in [false, true] {
                    s.push(Step::Do(Box::new(move |w: &mut World| {
                        let who = person_at(w, i);
                        let Some((at, n)) = crate::dismember::end_world(w, who, 0, piece) else { return };
                        let off = (n.with_y(0.0).normalize_or(Vec3::Z) * 0.5 + Vec3::Y * 0.3) * if piece { -1.0 } else { 1.0 };
                        let from = at + off.with_y(off.y.abs());
                        w.resource_scope(|w, map: Mut<Map>| {
                            let ground = map.ground(from.x, from.z, f32::INFINITY);
                            for mut p in w.query::<&mut Player>().iter_mut(w) {
                                p.spawn(&map, from.x, from.z, Some(at), (from.y - ground).max(0.25));
                            }
                        });
                    })));
                    s.push(Step::Wait(6));
                    s.push(Step::Shot(format!("dressing_{i}_{}", if piece { "piece" } else { "stump" })));
                }
            }
        }
        // The voice out cold and dead (the user: "they still scream even if they are unconscious or dead"): the old man
        // shot in the arm and, half a second into his scream, in the thigh, then knocked out a third of a second later;
        // the groundskeeper shot in the chest and dying a second on; the young man with blood in his airways and a
        // stomach full of it, coughing and retching, knocked out at three seconds; the hooded man shot and killed at once.
        // Every frame, what each says and whether anything of theirs is still to be heard while they are out or dead.
        "voices" => {
            s.push(Step::Wait(90));
            s.push(cameras(false));
            s.push(Step::Do(Box::new(|w: &mut World| {
                w.init_resource::<Said>();
                let young = person_at(w, 2);
                crate::npc::with(w, young, |npc| {
                    npc.hurt.throat.lungs = (40.0, 40.0);
                    npc.hurt.throat.stomach = 900.0;
                });
            })));
            let out = |i: usize, dead: bool| Step::Do(Box::new(move |w: &mut World| {
                let who = person_at(w, i);
                let mut v = w.get_mut::<crate::vitals::Vitals>(who).unwrap();
                if dead {
                    v.dead = true;
                } else {
                    v.out = 1e9;
                }
                log(w, json!({ "event": if dead { "killed" } else { "knocked out" }, "person": i }));
            }));
            s.push(shoot(0, "upperarm01.R", "lowerarm01.R", 0.5, "pistol"));
            s.push(shoot(1, "spine03", "spine02", 0.5, "rifle"));
            s.push(shoot(3, "spine03", "spine02", 0.5, "pistol"));
            s.push(out(3, true));
            for _ in 0..30 {
                s.push(Step::Do(Box::new(said)));
                s.push(Step::Wait(2));
            }
            s.push(shoot(0, "upperleg01.L", "lowerleg01.L", 0.5, "pistol"));
            for _ in 0..20 {
                s.push(Step::Do(Box::new(said)));
                s.push(Step::Wait(2));
            }
            s.push(out(0, false));
            for _ in 0..10 {
                s.push(Step::Do(Box::new(said)));
                s.push(Step::Wait(2));
            }
            s.push(out(1, true));
            for _ in 0..120 {
                s.push(Step::Do(Box::new(said)));
                s.push(Step::Wait(2));
            }
            s.push(out(2, false));
            for _ in 0..(60 * 20) {
                s.push(Step::Do(Box::new(said)));
                s.push(Step::Wait(2));
            }
            s.push(Step::Do(Box::new(|w: &mut World| {
                let s = w.remove_resource::<Said>().unwrap();
                log(w, json!({ "event": "voices", "said": s.said, "heard_out": s.out }));
            })));
        }
        // How often people cry out (the user: "a bit too excessive with the screaming"), against the TS's
        // (tools/port-screams.mjs does the same there): the four standing, each shot once with the pistol where it
        // hurts but does not kill (the old man's right upper arm, the groundskeeper's left thigh, the young man's belly,
        // the man in white's left shin), the old man again in the left thigh half a minute on, four shots into the
        // groundskeeper a quarter second apart at 45 s, and a minute of what follows with the physics running (they fall, writhe, crawl). Every voice started (a cry, a cough, a retch),
        // by person and kind, and how many are sounding at once across the room.
        "screams" => {
            s.push(Step::Wait(90));
            s.push(cameras(false));
            s.push(Step::Do(Box::new(|w: &mut World| {
                w.init_resource::<Cries>();
            })));
            s.push(shoot(0, "upperarm01.R", "lowerarm01.R", 0.5, "pistol"));
            s.push(shoot(1, "upperleg01.L", "lowerleg01.L", 0.5, "pistol"));
            s.push(shoot(2, "spine03", "spine02", 0.5, "pistol"));
            s.push(shoot(3, "lowerleg01.L", "foot.L", 0.5, "pistol"));
            // (And at 45 s four shots a quarter second apart into the groundskeeper, as a magazine is emptied.)
            let burst = [("upperarm01.L", "lowerarm01.L"), ("lowerarm01.L", "wrist.L"), ("upperarm01.R", "lowerarm01.R"), ("upperleg01.R", "lowerleg01.R")];
            for frame in 0..3600 {
                if frame == 1800 {
                    s.push(shoot(0, "upperleg01.L", "lowerleg01.L", 0.5, "pistol"));
                }
                if (2700..2760).contains(&frame) && frame % 15 == 0 {
                    let (a, b) = burst[(frame as usize - 2700) / 15];
                    s.push(shoot(1, a, b, 0.5, "pistol"));
                }
                s.push(Step::Do(Box::new(cries)));
                s.push(Step::Wait(2));
            }
            s.push(Step::Do(Box::new(|w: &mut World| {
                let c = w.remove_resource::<Cries>().unwrap();
                let minutes = c.frames as f32 / 3600.0;
                let count = |list: &[(u32, usize, &'static str)]| {
                    let mut by: Vec<std::collections::BTreeMap<&str, u32>> = vec![Default::default(); 4];
                    for &(_, i, kind) in list {
                        *by[i].entry(kind).or_default() += 1;
                    }
                    let per_minute: Vec<f32> = by.iter().map(|k| (k.values().sum::<u32>() as f32 / minutes * 10.0).round() / 10.0).collect();
                    let when: Vec<Value> = list.iter().map(|&(f, i, k)| json!([(f as f32 / 6.0).round() / 10.0, i, k])).collect();
                    json!({ "by_person": by, "per_person_per_minute": per_minute, "when": when })
                };
                log(w, json!({ "event": "screams", "seconds": c.frames as f32 / 60.0, "asked": count(&c.started), "voiced": count(&c.voiced),
                               "most_at_once": c.most, "mean_at_once": (c.sum as f32 / c.frames.max(1) as f32 * 100.0).round() / 100.0 }));
            })));
        }
        // A gun fired into a person standing, as a player fires it (taken in the hand, aimed at the chest from 3 m, a
        // click), and what they do for five seconds: the pistol at the old man, the rifle at the groundskeeper, the
        // shotgun at the young man (`pistol`, `rifle`, `shotgun`: one each; `guns`: all three). What they do a quarter
        // second at a time, their injuries and vitals after, and every sound heard. The TS's: scratch ts-guns.mjs.
        "guns" | "pistol" | "rifle" | "shotgun" => {
            s.push(Step::Wait(90));
            for (i, key) in [(0usize, "pistol"), (1, "rifle"), (2, "shotgun")] {
                if name != "guns" && name != key {
                    continue;
                }
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    crate::warm::take(w, key);
                    crate::warm::aim(w, i, "chest", 3.0);
                })));
                s.push(Step::Wait(42));
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    w.resource_mut::<crate::sound::Sound>().heard.clear();
                    crate::warm::press(w, 0);
                    log(w, json!({ "event": "fired", "gun": key, "person": i }));
                })));
                s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::release(w, 0))));
                for q in 0..=20 {
                    s.push(Step::Do(Box::new(move |w: &mut World| {
                        let who = person_at(w, i);
                        let b = w.get::<Behaviour>(who).unwrap();
                        let what = json!([q as f32 / 4.0, format!("{:?}", b.state), format!("{:?}", b.mode), b.why]);
                        let v = w.get::<crate::vitals::Vitals>(who).unwrap();
                        let felt = json!([(v.conscious() * 100.0).round() / 100.0, (v.pain * 100.0).round() / 100.0]);
                        log(w, json!({ "event": "after", "gun": key, "doing": what, "conscious_pain": felt }));
                    })));
                    s.push(Step::Wait(16));
                }
                s.push(Step::Do(Box::new(move |w: &mut World| {
                    let who = person_at(w, i);
                    let heard: Vec<Value> = std::mem::take(&mut w.resource_mut::<crate::sound::Sound>().heard).iter().map(|h| json!([h.name, (h.gain * 100.0).round() / 100.0])).collect();
                    let snap = crate::npc::with(w, who, |npc| snapshot(npc, 5.0)).unwrap();
                    log(w, json!({ "event": "gun", "gun": key, "snap": snap, "heard": heard }));
                })));
            }
        }
        // Every joint of the first person: where it is, where its muscle aims, its range, standing a moment.
        "joints" => {
            for _ in 0..4 {
                s.push(Step::Do(Box::new(joints)));
                s.push(Step::Wait(15));
            }
        }
        _ => return None,
    }
    s.push(Step::Do(Box::new(timeline)));
    // (Nothing drawn through the long waits: on the software renderer a frame drawn costs ten of the bodies' and
    // medicine's, and what is measured does not need it.)
    Some(s.into_iter().flat_map(|step| match step {
        Step::Wait(n) if n >= 30 => vec![cameras(false), Step::Wait(n), cameras(true)],
        step => vec![step],
    }).collect())
}

// The cameras on or off (skin.rs's).
// Person `i` shot from 1.5 m in front (the TS's +z) through the point `t` of the way from bone `a`'s head to `b`'s.
fn shoot(i: usize, a: &'static str, b: &'static str, t: f32, weapon: &'static str) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let who = person_at(w, i);
        crate::npc::with(w, who, |npc| {
            let (ia, ib) = (npc.bone_index(a), npc.bone_index(b));
            let at = npc.rest_to_world(ia).transform_point3(npc.body().bones[ia].head.lerp(npc.body().bones[ib].head, t));
            let dir = babylon(0.0, 0.0, 1.0);
            crate::wounds::pierce(npc, at - dir * 1.5, dir, &missile(weapon), 3.0);
        });
        log(w, json!({ "event": "shot", "person": i, "at": a }));
    }))
}

fn cameras(on: bool) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let mut q = w.query::<&mut Camera>();
        for mut c in q.iter_mut(w) {
            c.is_active = on;
        }
    }))
}

// The wall clock at the last frame, and each frame's time since (the khang scenario).
#[derive(Resource)]
struct Clock(std::time::Instant, Vec<f64>);

// Where each person's pelvis is as the run begins, to measure how far they drift standing.
#[derive(Resource)]
struct Start(Vec<Vec3>);

fn pelvises(w: &mut World) -> Vec<Vec3> {
    let people = everyone(w);
    people.iter().map(|&e| w.entity(e).get::<Ragdoll>().unwrap().centre()).collect()
}

fn timeline_start(w: &mut World) {
    let at = pelvises(w);
    w.insert_resource(Start(at));
}

fn drift(w: &mut World) {
    let now = pelvises(w);
    let was = w.resource::<Start>().0.clone();
    let moved: Vec<Value> = now.iter().zip(&was).map(|(a, b)| json!({ "level_cm": ((a - b).with_y(0.0).length() * 1000.0).round() / 10.0, "height_cm": ((a.y - b.y) * 1000.0).round() / 10.0 })).collect();
    log(w, json!({ "event": "drift", "people": moved }));
}

fn joints(w: &mut World) {
    let e = everyone(w)[0];
    let rd = w.entity(e).get::<Ragdoll>().unwrap();
    let deg = |a: [f32; 3]| a.map(|x| (x / crate::person::RAD).round());
    let rows: Vec<Value> = (0..rd.segs.len()).filter(|&k| rd.segs[k].def.parent.is_some()).map(|k| {
        let (t, f) = rd.aim(k);
        let s = &rd.segs[k];
        json!({ "seg": s.def.name, "now": deg(rd.angles(k)), "aim": deg(t), "f": f.round(), "lo": deg(s.lo), "hi": deg(s.hi), "y": (s.now.translation.y * 100.0).round() / 100.0 })
    }).collect();
    log(w, json!({ "event": "joints", "rows": rows }));
}

// What people said (Happened::Say, a cut, a retch or cough at the head), and every voice of theirs still to be heard once
// they were out or dead: frames, by person.
#[derive(Resource, Default)]
struct Said {
    playing: Vec<(Entity, crate::sound::Playing)>,
    said: Vec<Value>,
    out: Vec<Value>,
}

// The `screams` count: every voice started (frame since the shots, person, kind), and how many sound at once.
#[derive(Resource, Default)]
struct Cries {
    frames: u32,
    started: Vec<(u32, usize, &'static str)>,
    voiced: Vec<(u32, usize, &'static str)>,
    most: usize,
    sum: usize,
}

fn cries(w: &mut World) {
    let people: Vec<Entity> = (0..4).map(|i| person_at(w, i)).collect();
    let now = w.resource::<crate::sound::Sound>().now();
    let voices: Vec<(Entity, crate::sound::Playing, &'static str)> = w.resource::<crate::sound::Voices>().0.iter().map(|(e, (p, k))| (*e, p.clone(), *k)).collect();
    let at_once = voices.iter().filter(|(_, p, _)| p.sounding(now)).count();
    let mut c = w.remove_resource::<Cries>().unwrap();
    // (What was asked for above; what sound.rs voiced, begun this frame, here.)
    for (e, p, kind) in voices {
        if let Some(i) = people.iter().position(|&x| x == e).filter(|_| p.voice().start == now) {
            c.voiced.push((c.frames, i, kind));
        }
    }
    for (i, &e) in people.iter().enumerate() {
        let Some(h) = w.get::<crate::npc::Hurt>(e) else { continue };
        for x in &h.happened {
            let kind = match x {
                crate::npc::Happened::Say { kind, .. } => *kind,
                crate::npc::Happened::Sound { name, at: None, .. } if matches!(name.as_str(), "retch" | "vomit" | "cough-wet") => "retch, vomit or wet cough",
                _ => continue,
            };
            c.started.push((c.frames, i, kind));
        }
    }
    c.most = c.most.max(at_once);
    c.sum += at_once;
    c.frames += 1;
    w.insert_resource(c);
}

fn said(w: &mut World) {
    let frame = w.resource::<Runner>().frame;
    let now = w.resource::<crate::sound::Sound>().now();
    let voices: Vec<(Entity, crate::sound::Playing, &'static str)> = w.resource::<crate::sound::Voices>().0.iter().map(|(e, (p, k))| (*e, p.clone(), *k)).collect();
    let people: Vec<Entity> = (0..4).map(|i| person_at(w, i)).collect();
    let mut s = w.remove_resource::<Said>().unwrap();
    // (Each voice's lock taken one at a time: the same voice is in both lists.)
    let key = |p: &crate::sound::Playing| {
        let v = p.voice();
        (v.start, v.name.clone())
    };
    for (e, p, kind) in voices {
        let k = key(&p);
        if !s.playing.iter().any(|(_, q)| key(q) == k) {
            let i = people.iter().position(|&x| x == e);
            s.said.push(json!({ "frame": frame, "person": i, "kind": kind, "take": k.1 }));
            s.playing.push((e, p));
        }
    }
    for (i, &e) in people.iter().enumerate() {
        let awake = w.get::<crate::vitals::Vitals>(e).is_some_and(|v| v.conscious() > 0.35 && v.beating() && !v.dead);
        if awake {
            continue;
        }
        for (_, p) in s.playing.iter().filter(|(x, p)| *x == e && p.sounding(now)) {
            s.out.push(json!({ "frame": frame, "person": i, "take": p.voice().name.clone() }));
        }
    }
    w.insert_resource(s);
}

// The first two people's dressings: what each is on, whether it has come away, the bones its corners hang from, and the
// bleeds dressed.
fn dressings(w: &mut World, when: &str) {
    for i in 0..2 {
        let who = person_at(w, i);
        let skin: Vec<Entity> = w.get::<crate::skin::Skin>(who).map(|s| s.dressings.iter().map(|d| d.0).collect()).unwrap_or_default();
        let bones: Vec<Vec<String>> = skin.iter().map(|&e| {
            let names = &w.get::<Person>(who).unwrap().body.bones;
            let Some(h) = w.get::<Mesh3d>(e).map(|m| m.0.clone()) else { return Vec::new() };
            let meshes = w.resource::<Assets<Mesh>>();
            let mut used = std::collections::BTreeSet::new();
            if let (Some(bevy::mesh::VertexAttributeValues::Uint16x4(j)), Some(bevy::mesh::VertexAttributeValues::Float32x4(wt))) =
                (meshes.get(&h).and_then(|m| m.attribute(Mesh::ATTRIBUTE_JOINT_INDEX)), meshes.get(&h).and_then(|m| m.attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT))) {
                for (j, wt) in j.iter().zip(wt) {
                    for k in 0..4 {
                        if wt[k] > 0.0 {
                            used.insert(names[j[k] as usize].name.clone());
                        }
                    }
                }
            }
            used.into_iter().collect()
        }).collect();
        let h = w.get::<crate::npc::Hurt>(who).unwrap();
        let v = w.get::<crate::vitals::Vitals>(who).unwrap();
        let list: Vec<Value> = h.dressings.iter().enumerate().map(|(k, d)| json!({
            "kind": d.kind, "on": names_of(w, who, d.mark.owner), "off": d.off, "bones": bones.get(k),
            "bleeds": v.bleeds.iter().filter(|b| b.dressing == Some(k)).count(),
        })).collect();
        log(w, json!({ "event": "dressings", "when": when, "person": i, "dressings": list }));
    }
}

fn names_of(w: &World, who: Entity, bone: usize) -> String {
    w.get::<Person>(who).unwrap().body.bones[bone].name.clone()
}

// How many people there are, and how many rigid bodies and joints in all, into the log.
fn count(w: &mut World) {
    let people = w.query::<&Person>().iter(w).count();
    let bodies = w.query::<&bevy_rapier3d::prelude::RigidBody>().iter(w).count();
    let joints = w.query::<&bevy_rapier3d::prelude::ImpulseJoint>().iter(w).count();
    let at: Vec<Value> = w.query::<&Ragdoll>().iter(w).map(|rd| json!(rd.centre().to_array())).collect();
    log(w, json!({ "event": "count", "people": people, "bodies": bodies, "joints": joints, "at": at }));
}

// --- wounds: the same shots and blows as the TS game took (medicine, dev/PORT.md) ------------------------------------
//
// Each at the same place of a standing person (a bone's head as posed, and an offset, in the TS's space), from the
// front, on a person made whole again first and posed on the TS person's own breathing clock; the dice seeded as the TS
// check seeds Math.random (tools: the port's ts-wounds.mjs). Then a minute of their insides' clock, read at the TS's
// times. What hurt them goes in the log: the injuries, the bleeds, the breaks, the vital signs.

struct Shot {
    name: &'static str,
    person: usize,
    weapon: &'static str,
    bone: &'static str,
    offset: [f32; 3],
    pellets: &'static [[f32; 3]],
    // Then the medkit: every open wound dressed, worst first.
    dress: bool,
}

const PELLETS: [[f32; 3]; 9] = [[-0.03, -0.03, 0.0], [0.0, -0.03, 0.0], [0.03, -0.03, 0.0], [-0.03, 0.0, 0.0], [0.0, 0.0, 0.0], [0.03, 0.0, 0.0],
    [-0.03, 0.03, 0.0], [0.0, 0.03, 0.0], [0.03, 0.03, 0.0]];
const SHOTS: [Shot; 15] = [
    Shot { name: "rifle chest", person: 0, weapon: "rifle", bone: "spine01", offset: [0.03, 0.06, 0.0], pellets: &[], dress: false },
    Shot { name: "pistol belly", person: 1, weapon: "pistol", bone: "spine03", offset: [-0.06, 0.0, 0.0], pellets: &[], dress: false },
    Shot { name: "pistol neck", person: 2, weapon: "pistol", bone: "neck01", offset: [0.025, -0.03, 0.0], pellets: &[], dress: false },
    Shot { name: "pistol head", person: 3, weapon: "pistol", bone: "head", offset: [0.0, 0.07, 0.0], pellets: &[], dress: false },
    Shot { name: "rifle thigh", person: 0, weapon: "rifle", bone: "mid-upperleg01.L", offset: [0.0, 0.0, 0.0], pellets: &[], dress: false },
    Shot { name: "shotgun thigh", person: 1, weapon: "shotgun", bone: "mid-upperleg01.R", offset: [0.0, 0.0, 0.0], pellets: &PELLETS, dress: false },
    Shot { name: "knife belly", person: 2, weapon: "knife", bone: "spine03", offset: [0.05, 0.02, 0.0], pellets: &[], dress: false },
    Shot { name: "bat shin", person: 3, weapon: "bat", bone: "mid-lowerleg01.L", offset: [0.0, 0.0, 0.0], pellets: &[], dress: false },
    Shot { name: "bat head", person: 0, weapon: "bat", bone: "head", offset: [0.0, 0.06, 0.0], pellets: &[], dress: false },
    Shot { name: "pistol mouth", person: 1, weapon: "pistol", bone: "jaw", offset: [0.0, -0.03, 0.0], pellets: &[], dress: false },
    Shot { name: "pistol eye", person: 2, weapon: "pistol", bone: "eye.L", offset: [0.0, 0.0, 0.0], pellets: &[], dress: false },
    Shot { name: "bat mouth", person: 3, weapon: "bat", bone: "jaw", offset: [0.0, -0.02, 0.0], pellets: &[], dress: false },
    Shot { name: "bat chest", person: 0, weapon: "bat", bone: "spine01", offset: [0.06, 0.04, 0.0], pellets: &[], dress: false },
    Shot { name: "shotgun thigh dressed", person: 1, weapon: "shotgun", bone: "mid-upperleg01.R", offset: [0.0, 0.0, 0.0], pellets: &PELLETS, dress: true },
    Shot { name: "knife belly dressed", person: 2, weapon: "knife", bone: "spine03", offset: [0.05, 0.02, 0.0], pellets: &[], dress: true },
];
// Each shot's TS people's breathing clocks (npc.clock), as the TS check's line-up seeded them.
const CLOCKS: [[f32; 4]; 15] = [
    [9.953437, 1.125917, 9.438391, 1.91038], [9.579623, 0.727354, 6.705976, 7.415471], [1.70114, 7.488001, 7.410059, 9.114563],
    [1.591377, 2.309687, 1.928463, 5.384727], [7.952396, 9.888322, 1.618743, 2.172264], [6.803715, 5.951882, 1.190528, 4.966309],
    [5.464768, 9.904354, 2.333751, 8.069235], [5.895665, 5.740893, 3.519757, 4.244878], [9.548464, 4.805066, 7.201037, 3.941357],
    [8.554673, 7.663012, 8.291871, 4.884174], [7.049819, 2.107716, 6.973362, 5.930157], [7.535425, 5.501478, 2.81213, 5.5396],
    [3.764198, 1.875085, 8.795955, 2.020388], [9.343004, 9.88456, 3.250806, 1.43631], [0.294337, 8.830086, 6.545365, 2.548188],
];
const TIMES: [f32; 8] = [0.0, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0];

// What each weapon puts into a body (weapons.ts ARMS: the hands' job ports them to weapons.rs).
fn missile(weapon: &str) -> crate::wounds::Missile {
    use crate::wounds::Missile;
    let gun = |energy, mass, speed, calibre, channel, soft, hard, pellets| Missile {
        energy, mass, speed: Some(speed), calibre, channel, soft, hard, pellets: Some(pellets), ..default()
    };
    match weapon {
        "pistol" => gun(480.0, 0.008, 360.0, 0.009, 0.006, 12.0, 110.0, 1),
        "rifle" => gun(2700.0, 0.0097, 820.0, 0.0078, 0.012, 28.0, 160.0, 1),
        "shotgun" => gun(170.0, 0.0035, 400.0, 0.0084, 0.005, 9.0, 90.0, 9),
        _ => Missile { energy: 70.0, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40.0, reach: Some(0.17), blade: true, edges: Some(1),
            taper: Some(0.04), ..default() },
    }
}

fn wounds() -> Vec<Step> {
    let mut s = Vec::new();
    for (k, shot) in SHOTS.iter().enumerate() {
        s.push(Step::Do(Box::new(move |w: &mut World| {
            let who = person_at(w, shot.person);
            crate::npc::renew(w, who, CLOCKS[k][shot.person]);
            // The TS's ragdoll, built on the pose, drives the neck from the head's segment, whose turn is its lead bone's
            // (neck01's share of the neck's flex) spread evenly over the four bones from neck01 to the head (ragdoll.ts):
            // a person in the TS stands with a third of the stand pose's neck flex, and their head's segment as it was put on
            // the pose. Phase 2's ragdoll will do the same; here it is done by hand, or the head stands 2 to 4 mm off the TS's
            // and the mouth drains a few per cent differently.
            let segments = crate::npc::with(w, who, |npc| (0..npc.person.segments.len()).map(|k| npc.segment_world(k)).collect());
            w.get_mut::<crate::npc::Hurt>(who).unwrap().segments = segments;
            {
                let mut q = w.query::<&mut Person>();
                let mut p = q.get_mut(w, who).unwrap();
                let lead = p.posed.local[p.body.by_name["neck01"]];
                for n in ["neck01", "neck02", "neck03", "head"] {
                    let i = p.body.by_name[n];
                    p.posed.local[i] = Quat::IDENTITY.slerp(lead, 0.25);
                }
            }
            w.insert_resource(crate::vitals::Dice(2000 + k as u32));
            let dir = babylon(0.0, 0.0, 1.0);
            let result = crate::npc::with(w, who, |npc| {
                let bone = npc.bone_index(shot.bone);
                let target = npc.world_of(npc.body().bones[bone].head, bone, None).0 + babylon(shot.offset[0], shot.offset[1], shot.offset[2]);
                let mut res = Vec::new();
                match shot.weapon {
                    "bat" => match npc.surface(target - dir * 0.5, dir, 1.0, false).into_iter().find(|h| h.kind == crate::npc::Kind::Skin) {
                        Some(skin) => {
                            crate::wounds::blow(npc, skin.point, dir, 0.79, 15.5, None);
                        }
                        None => res.push(json!("missed")),
                    },
                    "knife" => {
                        let m = crate::wounds::Missile { across: Some(babylon(0.0, -1.0, 0.0)), ..missile("knife") };
                        let p = crate::wounds::pierce(npc, target - dir * 0.5, dir, &m, 0.5 + 0.17);
                        res.push(json!({ "stopped": p.stopped, "energy": p.energy }));
                    }
                    weapon => {
                        let pellets: &[[f32; 3]] = if shot.pellets.is_empty() { &[[0.0; 3]] } else { shot.pellets };
                        for o in pellets {
                            let p = crate::wounds::pierce(npc, target + babylon(o[0], o[1], o[2]) - dir * 1.5, dir, &missile(weapon), 3.0);
                            res.push(json!({ "stopped": p.stopped, "energy": (p.energy * 10.0).round() / 10.0, "hit": p.hit }));
                        }
                    }
                }
                // (The next throw of the dice: the same as the TS's if both threw as many in the shot.)
                res.push(json!(format!("dice {:.6}", npc.dice.next())));
                if shot.dress {
                    for _ in 0..12 {
                        let Some(w) = crate::dressing::wounds(npc).into_iter().next() else { break };
                        match crate::dressing::dress(npc, &w) {
                            Some(d) => res.push(json!(format!("{} {}", npc.hurt.dressings[d].kind, (npc.hurt.dressings[d].capacity * 100.0).round() / 100.0))),
                            None => {
                                res.push(json!("none"));
                                break;
                            }
                        }
                    }
                }
                let t = target;
                json!({ "target": [t.x, t.y, -t.z], "res": res })
            });
            log(w, json!({ "event": "shot", "name": shot.name, "person": shot.person, "result": result }));
        })));
        let mut at = 0.0;
        for &t in &TIMES {
            let frames = ((t - at) * 60.0).round() as u32;
            at = t;
            s.push(Step::Do(Box::new(move |w: &mut World| {
                let who = person_at(w, shot.person);
                for _ in 0..frames {
                    crate::npc::with(w, who, |npc| npc.update(1.0 / 60.0));
                }
                let snap = crate::npc::with(w, who, |npc| snapshot(npc, t)).unwrap();
                log(w, json!({ "event": "vitals", "name": shot.name, "snap": snap }));
            })));
        }
    }
    s
}

// The person standing `i`th in the line (sandbox.rs's order: the old man, the groundskeeper, the young man, the man in white, the naked man).
pub fn person_at(w: &mut World, i: usize) -> Entity {
    let body = crate::sandbox::BODIES[i];
    let mut q = w.query::<(Entity, &Person)>();
    q.iter(w).find(|(_, p)| p.body.name == body).unwrap().0
}

// How the person is doing, as the TS check reads it.
fn snapshot(npc: &mut crate::npc::Npc, t: f32) -> Value {
    let r = |x: f32, k: f32| (x * k).round() / k;
    let log: Vec<String> = npc.hurt.happened.drain(..).map(|h| match h {
        crate::npc::Happened::Say { kind, .. } => format!("say {kind}"),
        h => format!("{h:?}").split([' ', '{', '(']).next().unwrap().to_string(),
    }).collect();
    let v = &*npc.vitals;
    let th = &npc.hurt.throat;
    json!({
        "t": t, "state": v.state(), "hr": r(v.hr, 10.0), "map": r(v.map, 10.0), "spo2": r(v.spo2, 10.0), "rr": r(v.rr, 10.0), "lost": r(v.full - v.volume, 1e4),
        "conscious": r(v.conscious(), 1e3), "pain": r(v.pain, 1e3), "breathing": v.breathing, "rhythm": format!("{:?}", v.rhythm).to_lowercase(), "dead": v.dead,
        "pump": r(v.pump, 1e3), "lungs": [r(v.lungs.l, 1e3), r(v.lungs.r, 1e3)], "airway": r(v.airway, 1e3), "flooded": [r(v.flooded.0, 1e3), r(v.flooded.1, 1e3)],
        "choked": r(v.choked, 1e3), "throat": { "mouth": r(th.mouth, 100.0), "lungs": [r(th.lungs.0, 100.0), r(th.lungs.1, 100.0)], "stomach": r(th.stomach, 100.0) },
        "legGone": npc.hurt.leg_gone, "paralysed": { "legs": v.paralysed_legs, "arms": v.paralysed_arms }, "out": r(v.out, 100.0),
        "injuries": v.injuries.iter().map(|i| json!([i.text, r(i.severity, 1e3)])).collect::<Vec<_>>(),
        "bleeds": v.bleeds.iter().map(|b| json!([b.name, r(b.rate * 1000.0, 1e5), b.arterial, b.internal,
            b.into.map(|i| format!("{i:?}").to_lowercase()), b.side.map(|s| format!("{s:?}")), r(b.lost * 1000.0, 100.0), b.dressed])).collect::<Vec<_>>(),
        "breaks": npc.hurt.bones.breaks.iter().map(|b| json!([b.text, b.r#type, r(b.ratio, 1e3)])).collect::<Vec<_>>(),
        "log": log,
    })
}
