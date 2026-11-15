// F2: where each frame's time goes (src/sandbox/profiler.ts). Shift+F2 prints the table (there is no clipboard here: it
// goes to the console, as the TS's did when copying failed); F4 saves the session's log.
//
// The TS put a timed wrapper over every method the game called each frame. Bevy times nothing of its own without its
// `trace` feature (spans for every system, read by an outside tool), which rebuilds all of Bevy; so the rows here are:
//   - each system the game wraps in `timed` (its own time, every frame: an Instant either side, nothing when F2 is
//     shut but the two clock reads);
//   - each of the main schedules (First, PreUpdate, the fixed steps with the physics, Update, PostUpdate, Last), their
//     time less that of the timed systems run inside them ("Update: other systems"), from a timed copy of Bevy's own
//     loop over them (Main::run_main);
//   - the render world's own schedule, on its own thread (it runs alongside the next frame's game code, so it is not in
//     the ranking's sum).
// Systems in one schedule run on several threads at once, so the rows can add up to more than the frame.
//
// Under the rows, what is drawn: the meshes in view by what they belong to (each is a draw call, less what Bevy batches
// together), as the TS's draw calls by source.
//
// While it is open it also keeps a log of the session (F4 saves it as coldchain-profile-<version>-<time>.json, read by
// tools/profile-report.mjs as the TS's was): a sample a second (the frame's mean, 95th percentile and worst, each row's
// mean and worst, draws, people, render scale and preset), every spike frame with the rows heaviest in it, and what the
// player did (`Notes`: a shot, a swing, a preset changed), so a spike can be put down to what came just before it. A
// summary is worked out on saving and written at the top. Kept from the first opening to the end, through closing and
// opening again, but only recorded while open; the samples are the last half hour's, the spikes the 300 worst.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use bevy::app::MainScheduleOrder;
use bevy::ecs::schedule::{ScheduleLabel, SingleThreadedExecutor};
use bevy::ecs::system::{Adapt, IntoAdapterSystem, RunSystemError};
use bevy::prelude::*;
use serde_json::{json, Map as JsonMap, Value};

use crate::graphics::Graphics;
use crate::person::Person;

const IDLE: &str = "waiting (GPU, screen, the render thread)";

// Recording: whether the profiler is open (the rows are only kept then).
static OPEN: AtomicBool = AtomicBool::new(false);
// This frame's time in each row (ns) and calls, and the timed systems' time in the schedule running now.
static ROWS: Mutex<Vec<(&'static str, u64, u32)>> = Mutex::new(Vec::new());
static INNER: AtomicU64 = AtomicU64::new(0);
static RENDER: AtomicU64 = AtomicU64::new(0);

fn add(name: &'static str, ns: u64) {
    let mut rows = ROWS.lock().unwrap();
    match rows.iter_mut().find(|r| r.0 == name) {
        Some(r) => {
            r.1 += ns;
            r.2 += 1;
        }
        None => rows.push((name, ns, 1)),
    }
}

// A system's own time, as a row called `name` (`timed(name, system)` in place of the system where it is added).
#[derive(Clone)]
pub struct Timer(&'static str);

impl<S: System<In = ()>> Adapt<S> for Timer {
    type In = ();
    type Out = S::Out;

    fn adapt(&mut self, input: (), run_system: impl FnOnce(()) -> Result<S::Out, RunSystemError>) -> Result<S::Out, RunSystemError> {
        if !OPEN.load(Ordering::Relaxed) {
            return run_system(input);
        }
        let t = Instant::now();
        let out = run_system(input);
        let ns = t.elapsed().as_nanos() as u64;
        add(self.0, ns);
        INNER.fetch_add(ns, Ordering::Relaxed);
        out
    }
}

pub fn timed<S, M>(name: &'static str, system: S) -> IntoAdapterSystem<Timer, S>
where
    S: IntoSystem<(), (), M>,
{
    IntoAdapterSystem::new(Timer(name), system)
}

// What the player did, from where it is done (weapons.rs: a shot, a swing). Nothing while shut. Seconds from the start.
#[derive(Resource, Default)]
pub struct Notes {
    pub events: Vec<(f64, String)>,
}

impl Notes {
    pub fn note(&mut self, now: f64, what: String) {
        if !OPEN.load(Ordering::Relaxed) {
            return;
        }
        self.events.push(((now * 1000.0).round() / 1000.0, what));
        if self.events.len() > 6000 {
            self.events.drain(0..1000);
        }
    }
}

// Bevy's own loop over the main schedules (Main::run_main), each timed.
#[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
struct Timed;

fn run_main(world: &mut World, mut once: Local<bool>) {
    if !*once {
        world.resource_scope(|world, order: Mut<MainScheduleOrder>| {
            for &label in &order.startup_labels {
                let _ = world.try_run_schedule(label);
            }
        });
        *once = true;
    }
    let open = OPEN.load(Ordering::Relaxed);
    world.resource_scope(|world, order: Mut<MainScheduleOrder>| {
        for &label in &order.labels {
            INNER.store(0, Ordering::Relaxed);
            let t = Instant::now();
            let _ = world.try_run_schedule(label);
            if open {
                let all = t.elapsed().as_nanos() as u64;
                let own = all.saturating_sub(INNER.load(Ordering::Relaxed));
                add(schedule_row(&format!("{label:?}")), own);
            }
        }
    });
}

fn schedule_row(label: &str) -> &'static str {
    match label {
        "First" => "First: other systems (time, input)",
        "PreUpdate" => "PreUpdate: other systems (input, assets)",
        "StateTransition" => "state transitions",
        "RunFixedMainLoop" => "fixed steps: physics (Rapier), other systems",
        "Update" => "Update: other systems",
        "SpawnScene" => "spawning scenes",
        "PostUpdate" => "PostUpdate: other systems (transforms, visibility)",
        "Last" => "Last: other systems",
        _ => "other schedules",
    }
}

// The render world's own schedule, timed on its thread.
#[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
struct TimedRender;

fn run_render(world: &mut World) {
    let t = Instant::now();
    let _ = world.try_run_schedule(bevy::render::Render);
    RENDER.store(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
}

#[derive(Default, Clone)]
struct Row {
    avg: f32,
    per: f32,
    worst: [f32; 5],
    sum: f32,
    max: f32,
    now: f32,
}

#[derive(Resource)]
struct Profiler {
    open: bool,
    shown: Option<Entity>,
    rows: HashMap<&'static str, Row>,
    draws: HashMap<String, Row>,
    gap: f32,
    slot: usize,
    drawn: f64,
    text: String,
    said: (String, f64),
    // The session's log.
    t0: Option<f64>,
    started: String,
    machine: Value,
    samples: Vec<Value>,
    spikes: Vec<Value>,
    totals: HashMap<String, (f32, f32)>,
    hist: Vec<u32>,
    times: Vec<f32>,
    second_at: f64,
    n: u32,
    spent: f32,
    cpu: f32,
    wait: f32,
    wait_max: f32,
    calls: f32,
    all_frames: u64,
    all_ms: f64,
    preset: String,
    level: f32,
    last: Option<Instant>,
    // A scenario's asks: open it (as F2, but recording only: its table is not drawn over the pictures), save the log into
    // a folder (as F4).
    ask_open: bool,
    quiet: bool,
    save_in: Option<std::path::PathBuf>,
}

impl Default for Profiler {
    fn default() -> Self {
        Profiler {
            open: false, shown: None, rows: HashMap::new(), draws: HashMap::new(), gap: 16.7, slot: 0, drawn: 0.0, text: String::new(),
            said: (String::new(), 0.0), t0: None, started: String::new(), machine: Value::Null, samples: Vec::new(), spikes: Vec::new(),
            totals: HashMap::new(), hist: vec![0; 501], times: Vec::with_capacity(1024), second_at: 0.0, n: 0, spent: 0.0, cpu: 0.0, wait: 0.0,
            wait_max: 0.0, calls: 0.0, all_frames: 0, all_ms: 0.0, preset: String::new(), level: 1.0, last: None, ask_open: false, quiet: false, save_in: None,
        }
    }
}

fn r2(x: f32) -> f32 {
    (x * 100.0).round() / 100.0
}

// The time now as the TS's log wrote it (ISO 8601, UTC), and as a file name's stamp, from the system clock.
fn stamp() -> (String, String) {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rest) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // (Days to a civil date: Howard Hinnant's algorithm.)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + (m <= 2) as i64;
    let (h, mi, s) = (rest / 3600, rest % 3600 / 60, rest % 60);
    (format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.000Z"), format!("{y:04}-{m:02}-{d:02}-{h:02}{mi:02}{s:02}"))
}

#[derive(Component)]
struct Overlay;

#[allow(clippy::too_many_arguments)]
fn keys(
    keys: Res<ButtonInput<KeyCode>>,
    mut p: ResMut<Profiler>,
    mut commands: Commands,
    notes: Res<Notes>,
    time: Res<Time<Real>>,
    adapter: Option<Res<bevy::render::renderer::RenderAdapterInfo>>,
    windows: Query<&Window>,
) {
    let shift = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if (keys.just_pressed(KeyCode::F4) || p.save_in.is_some()) && p.open {
        let dir = p.save_in.take();
        save(&mut p, &notes, time.elapsed_secs_f64(), dir);
    }
    let ask = std::mem::take(&mut p.ask_open) && !p.open;
    if !keys.just_pressed(KeyCode::F2) && !ask {
        return;
    }
    if shift && p.open {
        info!("\n{}", p.text);
        p.said = (", printed to the console".into(), time.elapsed_secs_f64());
        return;
    }
    if shift {
        return;
    }
    p.open = !p.open;
    OPEN.store(p.open, Ordering::Relaxed);
    if p.open {
        if p.t0.is_none() {
            p.t0 = Some(time.elapsed_secs_f64());
            p.started = stamp().0;
            let w = windows.iter().next();
            p.machine = json!({
                "gpu": adapter.as_ref().map(|a| a.name.clone()), "vendor": adapter.as_ref().map(|a| format!("{:#06x}", a.vendor)),
                "api": adapter.as_ref().map(|a| format!("{:?} ({})", a.backend, a.driver_info)),
                "screen": w.map(|w| format!("{}x{}", w.physical_width(), w.physical_height())),
                "canvas": w.map(|w| format!("{}x{}", w.width(), w.height())), "pixelRatio": w.map(|w| w.scale_factor()),
                "cores": std::thread::available_parallelism().map_or(0, |n| n.get()),
                "browser": format!("native: Bevy 0.20 on {} {}", std::env::consts::OS, std::env::consts::ARCH),
            });
        }
        p.second_at = time.elapsed_secs_f64();
        p.last = None;
        let (n, spent, cpu, wait, wait_max, calls) = (0, 0.0, 0.0, 0.0, 0.0, 0.0);
        (p.n, p.spent, p.cpu, p.wait, p.wait_max, p.calls) = (n, spent, cpu, wait, wait_max, calls);
        p.times.clear();
        if p.quiet {
            return;
        }
        let e = commands
            .spawn((
                Node { position_type: PositionType::Absolute, left: px(12), top: px(40), padding: UiRect::all(px(8)), ..default() },
                BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.72)),
                Text::new(""),
                TextFont { font_size: bevy::text::FontSize::Px(11.0), ..default() },
                TextColor(Color::srgb(0.85, 0.83, 0.78)),
                GlobalZIndex(10),
                Overlay,
            ))
            .id();
        p.shown = Some(e);
    } else {
        ROWS.lock().unwrap().clear();
        p.rows.clear();
        p.draws.clear();
        if let Some(e) = p.shown.take() {
            commands.entity(e).despawn();
        }
    }
}

// Each frame (at its very end): this frame's times into the averages and the worst of this second, and the log.
#[allow(clippy::too_many_arguments)]
fn tick(
    mut p: ResMut<Profiler>,
    mut notes: ResMut<Notes>,
    time: Res<Time<Real>>,
    graphics: Res<Graphics>,
    people: Query<(), With<Person>>,
    seen: Query<(Entity, &ViewVisibility), With<Mesh3d>>,
    parents: Query<&ChildOf>,
    names: Query<&Name>,
    mut text: Query<&mut Text, With<Overlay>>,
) {
    if !p.open {
        return;
    }
    let real = Instant::now();
    let now = time.elapsed_secs_f64();
    let dt = p.last.map_or(1000.0 / 60.0, |l| real.duration_since(l).as_secs_f32() * 1000.0);
    p.last = Some(real);
    let k = (dt / 1000.0).min(1.0);
    let t0 = p.t0.unwrap_or(now);
    let since = |t: f64| ((t - t0) * 1000.0).round() / 1000.0;
    let s = ((now as u64) % 5) as usize;
    if s != p.slot {
        p.slot = s;
        let Profiler { rows, draws, .. } = &mut *p;
        for r in rows.values_mut().chain(draws.values_mut()) {
            r.worst[s] = 0.0;
        }
    }
    // This frame's rows.
    let rows: Vec<(&'static str, u64, u32)> = std::mem::take(&mut *ROWS.lock().unwrap());
    let mut busy = 0.0;
    for (name, ns, calls) in &rows {
        let ms = *ns as f32 / 1e6;
        busy += ms;
        let r = p.rows.entry(name).or_default();
        r.now = ms;
        r.per += (*calls as f32 - r.per) * k;
    }
    let render = RENDER.load(Ordering::Relaxed) as f32 / 1e6;
    {
        let r = p.rows.entry("render world (its own thread, alongside)").or_default();
        r.now = render;
    }
    // The meshes in view by what they belong to: the nearest named thing they hang from, its numbers taken out (four
    // people's skins are one row).
    let mut draws: HashMap<String, f32> = HashMap::new();
    let mut total = 0.0;
    for (e, v) in &seen {
        if !v.get() {
            continue;
        }
        total += 1.0;
        let mut at = e;
        let mut name = "unnamed".to_string();
        for _ in 0..12 {
            if let Ok(n) = names.get(at) {
                name = n.as_str().chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).collect();
                break;
            }
            match parents.get(at) {
                Ok(c) => at = c.parent(),
                Err(_) => break,
            }
        }
        *draws.entry(name).or_default() += 1.0;
    }
    for r in p.draws.values_mut() {
        r.now = 0.0;
    }
    for (name, n) in draws {
        p.draws.entry(name).or_default().now = n;
    }
    // A spike against the frame rate it is running at: over 50 ms on a slow machine is every frame.
    if dt > 50f32.max(2.5 * p.gap) {
        let t = since(now);
        let from = t - dt as f64 / 1000.0 - 1.0;
        let mut heard: Vec<(String, u32)> = Vec::new();
        for (when, what) in notes.events.iter().rev() {
            if *when <= from {
                break;
            }
            match heard.iter_mut().find(|h| &h.0 == what) {
                Some(h) => h.1 += 1,
                None => heard.push((what.clone(), 1)),
            }
        }
        let before: Vec<String> = heard.into_iter().rev().map(|(w, n)| if n > 1 { format!("{w} (x{n})") } else { w }).collect();
        let mut top: Vec<(&'static str, f32)> = rows.iter().map(|r| (r.0, r.1 as f32 / 1e6)).filter(|r| r.1 >= 0.5).collect();
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        let top: Vec<String> = top.iter().take(6).map(|(n, ms)| format!("{n} {}", r2(*ms))).collect();
        p.spikes.push(json!({ "t": t, "ms": r2(dt), "cpu": r2(busy), "waiting": r2((dt - busy).max(0.0)), "compiles": 0, "draws": total as u32, "top": top, "before": before }));
        if p.spikes.len() > 300 {
            let (i, _) = p.spikes.iter().enumerate().min_by(|a, b| a.1["ms"].as_f64().unwrap_or(0.0).total_cmp(&b.1["ms"].as_f64().unwrap_or(0.0))).unwrap();
            p.spikes.remove(i);
        }
    }
    p.gap += (dt - p.gap) * k;
    let bin = (dt.round() as usize).min(500);
    p.hist[bin] += 1;
    p.all_frames += 1;
    p.all_ms += dt as f64;
    if p.times.len() < 1024 {
        p.times.push(dt);
    }
    p.n += 1;
    p.spent += dt;
    p.cpu += busy;
    p.wait += (dt - busy).max(0.0);
    p.wait_max = p.wait_max.max(dt - busy);
    p.calls += total;
    if graphics.name() != p.preset {
        p.preset = graphics.name().to_string();
        notes.note(now, format!("quality {} (F3)", p.preset));
    }
    if graphics.level != p.level {
        p.level = graphics.level;
        notes.note(now, format!("render scale {}%", (100.0 / graphics.level).round()));
    }
    let slot = p.slot;
    let Profiler { rows, draws, .. } = &mut *p;
    for r in rows.values_mut().chain(draws.values_mut()) {
        r.avg += (r.now - r.avg) * k;
        r.worst[slot] = r.worst[slot].max(r.now);
        r.sum += r.now;
        r.max = r.max.max(r.now);
        r.now = 0.0;
    }
    if now - p.second_at >= 1.0 {
        sample(&mut p, since(now), people.iter().count(), &graphics);
        p.second_at = now;
    }
    if now - p.drawn > 0.25 {
        p.drawn = now;
        draw(&mut p, now);
        if let Ok(mut t) = text.single_mut() {
            t.0 = p.text.clone();
        }
    }
}

// A second of the log: the frame's spread, each row's mean and worst (the ones under 0.05 ms and 1 ms left out).
fn sample(p: &mut Profiler, t: f64, people: usize, graphics: &Graphics) {
    let n = p.n.max(1) as f32;
    let mut sorted = p.times.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let at = |q: f32| sorted.get(((q * (sorted.len() as f32 - 1.0)).floor()) as usize).copied().unwrap_or(0.0);
    let mut systems = JsonMap::new();
    let mut keep = |name: String, sum: f32, max: f32, totals: &mut HashMap<String, (f32, f32)>| {
        let e = totals.entry(name.clone()).or_default();
        e.0 += sum;
        e.1 = e.1.max(max);
        if sum / n >= 0.05 || max >= 1.0 {
            systems.insert(name, json!([r2(sum / n), r2(max)]));
        }
    };
    let rows: Vec<(String, f32, f32)> = p.rows.iter().filter(|r| r.1.sum > 0.0).map(|(k, r)| (k.to_string(), r.sum, r.max)).collect();
    for (name, sum, max) in rows {
        keep(name, sum, max, &mut p.totals);
    }
    keep(IDLE.into(), p.wait, p.wait_max, &mut p.totals);
    p.samples.push(json!({
        "t": t, "frames": p.n, "fps": (1000.0 * n / p.spent.max(1e-3)).round(),
        "ms": [r2(p.spent / n), r2(at(0.95)), r2(at(1.0))],
        "cpu": r2(p.cpu / n), "waiting": r2(p.wait / n), "gpu": Value::Null,
        "draws": (p.calls / n).round(), "meshes": (p.calls / n).round(), "people": people,
        "scale": (100.0 / graphics.level).round(), "preset": graphics.name(), "systems": systems,
    }));
    if p.samples.len() > 1800 {
        p.samples.remove(0);
    }
    let Profiler { rows, draws, .. } = &mut *p;
    for r in rows.values_mut().chain(draws.values_mut()) {
        r.sum = 0.0;
        r.max = 0.0;
    }
    p.times.clear();
    (p.n, p.spent, p.cpu, p.wait, p.wait_max, p.calls) = (0, 0.0, 0.0, 0.0, 0.0, 0.0);
}

// Worked out on saving: where the time went over the whole session, and its worst moments.
fn summary(p: &Profiler) -> Value {
    let frames = p.all_frames.max(1) as f64;
    let at = |q: f64| {
        let mut seen = 0.0;
        for (ms, &c) in p.hist.iter().enumerate() {
            seen += c as f64;
            if seen >= q * frames {
                return ms;
            }
        }
        500
    };
    let hist_ms: f64 = p.hist.iter().enumerate().map(|(ms, &c)| ms as f64 * c as f64).sum::<f64>().max(1.0);
    let mut spread = JsonMap::new();
    let mut from = 0;
    for (band, to) in [("60+ fps", 17), ("45-60 fps", 22), ("30-45 fps", 33), ("15-30 fps", 67), ("under 15 fps", 500)] {
        let mut ms = 0.0;
        while from <= to {
            ms += p.hist[from] as f64 * from as f64;
            from += 1;
        }
        spread.insert(band.into(), json!(format!("{}%", (100.0 * ms / hist_ms).round())));
    }
    let mean = |k: &str| {
        let (mut sum, mut n) = (0.0, 0.0);
        for s in &p.samples {
            if let Some(x) = s[k].as_f64() {
                let f = s["frames"].as_f64().unwrap_or(0.0);
                sum += x * f;
                n += f;
            }
        }
        (n > 0.0).then(|| r2((sum / n) as f32))
    };
    let frame_ms = r2((p.all_ms / frames) as f32);
    let (cpu, wait) = (mean("cpu").unwrap_or(0.0), mean("waiting").unwrap_or(0.0));
    let bound = if frame_ms < 1000.0 / 55.0 {
        format!("neither: {frame_ms} ms a frame keeps up")
    } else if wait > cpu {
        format!("GPU, most likely: {wait} ms a frame waiting outside the game's code, {cpu} in it (no GPU timer here)")
    } else {
        format!("CPU: {cpu} ms a frame in the game's code, {wait} waiting")
    };
    let tally = |k: &str| {
        let mut seconds: HashMap<String, f64> = HashMap::new();
        for s in &p.samples {
            let key = match &s[k] {
                Value::String(x) => x.clone(),
                x => x.to_string(),
            };
            *seconds.entry(key).or_default() += s["frames"].as_f64().unwrap_or(0.0) * s["ms"][0].as_f64().unwrap_or(0.0) / 1000.0;
        }
        Value::Object(seconds.into_iter().map(|(k, v)| (k, json!(v.round()))).collect())
    };
    let pf = |ms: usize| if ms < 500 { ms.to_string() } else { "500+".into() };
    let mut worst: Vec<(&String, &(f32, f32))> = p.totals.iter().collect();
    worst.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0));
    let mut spikes = p.spikes.clone();
    spikes.sort_by(|a, b| b["ms"].as_f64().unwrap_or(0.0).total_cmp(&a["ms"].as_f64().unwrap_or(0.0)));
    json!({
        "recorded": { "seconds": (p.all_ms / 1000.0).round(), "frames": p.all_frames, "samples kept": p.samples.len() },
        "fps": { "mean": (1000.0 * frames / p.all_ms.max(1.0)).round(), "frame ms p50 p95 p99": format!("{} {} {}", pf(at(0.5)), pf(at(0.95)), pf(at(0.99))),
                 "share of time": spread },
        "bound": bound,
        "seconds at render scale %": tally("scale"),
        "seconds at preset": tally("preset"),
        "worst systems": worst.iter().take(12).map(|(name, (ms, w))| json!({ "name": name, "ms a frame": r2((*ms as f64 / frames) as f32), "worst": r2(*w),
            "share": format!("{}%", (100.0 * *ms as f64 / p.all_ms.max(1.0)).round()) })).collect::<Vec<_>>(),
        "worst spikes": spikes.into_iter().take(10).collect::<Vec<_>>(),
    })
}

// The log as a file: the summary and the machine laid out to be read, then a spike, an event or a sample a line.
fn save(p: &mut Profiler, notes: &Notes, now: f64, dir: Option<std::path::PathBuf>) {
    let version = env!("CARGO_PKG_VERSION");
    let name = format!("coldchain-profile-{version}-{}.json", stamp().1);
    let lines = |list: &[Value]| format!("[\n{}\n]", list.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",\n"));
    let t0 = p.t0.unwrap_or(0.0);
    let events: Vec<Value> = notes.events.iter().map(|(t, w)| json!([((t - t0) * 1000.0).round() / 1000.0, w])).collect();
    let head = json!({ "summary": summary(p), "version": version, "started": p.started, "machine": p.machine });
    let head = serde_json::to_string_pretty(&head).unwrap();
    let json = format!("{},\n  \"spikes\": {},\n  \"events\": {},\n  \"samples\": {}\n}}\n", &head[..head.len() - 2], lines(&p.spikes), lines(&events), lines(&p.samples));
    // Where a browser would have put it: the Downloads folder, if there is one.
    let dir = dir.unwrap_or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).filter(|d| d.is_dir()).unwrap_or_else(|| ".".into()));
    let path = dir.join(&name);
    p.said = match std::fs::write(&path, json) {
        Ok(()) => (format!(", saved {}", path.display()), now),
        Err(e) => (format!(", not saved: {e}"), now),
    };
}

fn draw(p: &mut Profiler, now: f64) {
    if now - p.said.1 > 4.0 {
        p.said.0.clear();
    }
    let gap = p.gap;
    let worst = |r: &Row| r.worst.iter().cloned().fold(0.0, f32::max);
    let pct = |ms: f32| (100.0 * ms / gap).round();
    let mut ranked: Vec<(String, Row)> = p.rows.iter().filter(|r| !r.0.starts_with("render world")).map(|(k, r)| (k.to_string(), r.clone())).collect();
    let busy: f32 = ranked.iter().map(|r| r.1.avg).sum();
    ranked.push((IDLE.into(), Row { avg: (gap - busy).max(0.0), per: 1.0, ..default() }));
    ranked.retain(|r| r.1.avg > 0.005);
    ranked.sort_by(|a, b| b.1.avg.total_cmp(&a.1.avg));
    let line = |name: &str, r: &Row| {
        let spike = worst(r) > 2.0 * r.avg + 1.0;
        format!("{:<42.42} {:>6.2} {:>6.1}{}{:>3}% {}", name, r.avg, worst(r), if spike { '!' } else { ' ' }, pct(r.avg), if r.per > 1.5 { format!("x{}", r.per.round()) } else { String::new() })
    };
    let mut out = vec![
        format!("Profiler   F2 close, Shift+F2 print, F4 save the log ({}:{:02} recorded){}", (p.all_ms / 60000.0) as u64, (p.all_ms / 1000.0) as u64 % 60, p.said.0),
        format!("{:.0} fps   {:.1} ms a frame", 1000.0 / gap, gap),
        String::new(),
        format!("{:<42} {:>6} {:>6}  frame", "own time, worst first", "ms", "max 5s"),
    ];
    out.extend(ranked.iter().map(|(n, r)| line(n, r)));
    if let Some(r) = p.rows.get("render world (its own thread, alongside)") {
        out.push(String::new());
        out.push(line("render world (its own thread, alongside)", r));
    }
    let mut draws: Vec<(&String, &Row)> = p.draws.iter().filter(|r| r.1.avg >= 0.5).collect();
    draws.sort_by(|a, b| b.1.avg.total_cmp(&a.1.avg));
    let total: f32 = p.draws.values().map(|r| r.avg).sum();
    out.push(String::new());
    out.push(format!("meshes in view by source ({}; each a draw call before batching)", total.round()));
    out.extend(draws.iter().take(16).map(|(n, r)| format!("{:<42.42} {:>6.0} {:>6.0}", n, r.avg, worst(r))));
    p.text = out.join("\n");
}

// For a scenario: the profiler opened, as F2 opens it; its log saved into `dir`, as F4 saves it.
pub fn open(world: &mut World) {
    let mut p = world.resource_mut::<Profiler>();
    p.ask_open = true;
    p.quiet = true;
}

pub fn save_in(world: &mut World, dir: std::path::PathBuf) {
    world.resource_mut::<Profiler>().save_in = Some(dir);
}

pub fn plugin(app: &mut App) {
    let mut timed = Schedule::new(Timed);
    timed.set_executor(SingleThreadedExecutor::new());
    timed.add_systems(run_main);
    app.add_schedule(timed);
    app.main_mut().update_schedule = Some(Timed.intern());
    if let Some(render) = app.get_sub_app_mut(bevy::render::RenderApp) {
        let mut s = Schedule::new(TimedRender);
        s.set_executor(SingleThreadedExecutor::new());
        s.add_systems(run_render);
        render.add_schedule(s);
        render.update_schedule = Some(TimedRender.intern());
    }
    app.init_resource::<Notes>().init_resource::<Profiler>().add_systems(Update, keys).add_systems(Last, tick);
}
