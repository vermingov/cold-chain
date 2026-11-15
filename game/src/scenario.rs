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
            .add_systems(Last, run);
    }
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
fn person_at(w: &mut World, i: usize) -> Entity {
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
