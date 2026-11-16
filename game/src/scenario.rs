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
        "arsenal-use" => s = crate::weapons::scenario(),
        "wounds" => s = wounds(),
        "cut" => s = crate::cut_scenario::steps(""),
        "cut-limbs" | "cut-belly" | "cut-bones" => s = crate::cut_scenario::steps(&name[4..]),
        // The look of hurt on the skin (port/skin): skin.rs.
        "skin" => s = crate::skin::scenario(),
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
    // Per segment: steps, the sum of the squared second difference, of |w|.
    segs: Vec<(u32, f64, f64)>,
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
        acc.segs.resize(rd.segs.len(), (0, 0.0, 0.0));
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
        for (&(e, t), acc) in &j.bins {
            let Some(i) = people.iter().position(|&p| p == e) else { continue };
            if !pick(i, t, acc.state.unwrap(), acc.mode.unwrap()) {
                continue;
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
        info!("jitter {name}: mean hf {mean:.2} rad/s over {seconds} person-seconds");
        log(w, json!({ "event": "jitter", "situation": name, "person_seconds": seconds, "mean_hf": (mean * 1000.0).round() / 1000.0, "worst": worst }));
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
        Some(json!({ "person": i, "t": t, "state": format!("{:?}", acc.state?), "mode": format!("{:?}", acc.mode?), "hf": (mean * 100.0).round() / 100.0 }))
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
            s.push(Step::Wait(60 * 12));
            film(&mut s, "crawl", 1, 8, 6, -0.3, -1.8, 1.4);
            s.push(Step::Wait(60 * 10));
            s.push(situation("crawl", |_, _, _, m| m == Mode::Crawl));
        }
        // The fourth person taken by the right hand from 1.4 m off and swept about for eight seconds (the eye's yaw 0.6
        // rad either way at 0.4 Hz, its pitch at 0.27 Hz), as jitter.mjs did, then let go.
        "drag" => {
            s.push(Step::Wait(60));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let e = everyone(w)[3];
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
                let eye = w.query::<&Player>().iter(w).next().unwrap().eye().translation;
                let g = Grabbed::at(w.entity(e).get::<Ragdoll>().unwrap(), at, eye);
                w.entity_mut(e).insert(g);
                let yaw0 = w.query::<&Player>().iter(w).next().unwrap().yaw;
                let mut runner = w.resource_mut::<Runner>();
                let mut steps = Vec::new();
                for k in 0..480u32 {
                    let t = k as f32 / 60.0;
                    steps.push(Step::Do(Box::new(move |w: &mut World| {
                        let mut q = w.query::<&mut Player>();
                        let eye = {
                            let mut p = q.iter_mut(w).next().unwrap();
                            p.yaw = yaw0 + 0.6 * (t * std::f32::consts::TAU * 0.4).sin();
                            // (The TS's pitch 0.35 down is -0.35 here: up is positive.)
                            p.pitch = -(0.35 + 0.15 * (t * std::f32::consts::TAU * 0.27).sin());
                            p.eye()
                        };
                        let mut q = w.query::<&mut Grabbed>();
                        for mut g in q.iter_mut(w) {
                            g.aim(eye.translation, eye.forward().as_vec3());
                        }
                    })));
                    steps.push(if k == 150 || k == 165 || k == 180 || k == 195 || k == 210 || k == 225 { Step::Shot(format!("drag_{}", (k - 150) / 15)) } else { Step::Wait(2) });
                }
                steps.push(Step::Do(Box::new(move |w: &mut World| {
                    w.entity_mut(e).remove::<Grabbed>();
                })));
                for step in steps.into_iter().rev() {
                    runner.steps.push_front(step);
                }
            })));
            s.push(Step::Wait(120));
            s.push(situation("dragged by the hand", |i, t, _, _| i == 3 && (2..=8).contains(&t)));
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
    Some(s)
}

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
                        Some(skin) => crate::wounds::blow(npc, skin.point, dir, 0.79, 15.5, None),
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

// The person standing `i`th in the line (sandbox.rs's order: the old man, the groundskeeper, the young man, the hood).
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
