// The Escape menu (the TS game had none: the browser gave the pointer back on Escape, and that was all). Escape in play
// pauses the game: its clock stops (Time<Virtual>; the physics' fixed steps are taken out of it, so the bodies stand
// still, and everything else timed by it waits), the sound is held where it is, and the pointer is given back. Resume
// (or Escape again), Settings, Quit. A click on the room takes the pointer again, as before (player.rs `grab`).
//
// The settings are the sound's three volumes (sound.rs's tracks), the picture's (graphics.rs: the F3 preset, the scale,
// vertical sync, the window) and the view's (its width, the mouse's speed: player.rs), kept between runs in
// settings.json in the folder where graphics.rs kept the F3 preset (`graphics::kept`).
//
// What it draws is the HUD's: IM Fell on a darkened picture, plain nodes and text only, which the HUD has drawn from the
// first frame, so opening it makes no new pipeline (the `menu` scenario counts them).

use std::path::PathBuf;

use bevy::prelude::*;
use bevy::ui::{RelativeCursorPosition, UiSystems};
use bevy::window::{CursorGrabMode, CursorOptions, MonitorSelection, PresentMode, PrimaryWindow, WindowMode};
use serde::{Deserialize, Serialize};

use crate::graphics::{Graphics, PRESETS};
use crate::hud::{font, shadow, BRIGHT, DIM, FAINT, INK, REM};
use crate::sound::Sound;

#[derive(Resource, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Settings {
    // Where the sliders are, 0 to 1 (sound.rs takes their squares as gains).
    pub master: f32,
    pub effects: f32,
    pub voices: f32,
    // The F3 preset by name; the picture's scale a side (0: following the frame rate, graphics.rs `adapt`); vertical
    // sync; borderless fullscreen or a window.
    pub quality: String,
    pub scale: f32,
    pub vsync: bool,
    pub fullscreen: bool,
    // Degrees across the view, and the mouse's speed (1: the TS's).
    pub fov: f32,
    pub sensitivity: f32,
    // Where they are kept: none in a scenario, whose runs are the same on any machine and keep nothing of the player's.
    #[serde(skip)]
    path: Option<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            master: 1.0, effects: 1.0, voices: 1.0, quality: PRESETS[0].into(), scale: 0.0, vsync: true, fullscreen: false,
            fov: crate::player::FOV_ACROSS.to_degrees(), sensitivity: 1.0, path: None,
        }
    }
}

// The choices a setting has (a click goes to the next), and the sliders' ranges.
const SCALES: [f32; 6] = [0.0, 1.0, 0.85, 0.7, 0.55, 0.4];
const FOV: (f32, f32) = (60.0, 110.0);
const SENSITIVITY: (f32, f32) = (0.2, 3.0);

impl Settings {
    // The player's, or the defaults (and the F3 preset from the file it was kept in before there were settings).
    pub fn load() -> Settings {
        let Some(dir) = crate::graphics::kept() else { return Settings::default() };
        let path = dir.join("settings.json");
        let read = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Settings>(&bytes).map_err(|e| warn!("{}: {e}; the defaults instead", path.display())).ok(),
            Err(_) => None,
        };
        let mut s = read.unwrap_or_else(|| {
            let quality = std::fs::read_to_string(dir.join("quality")).ok().map(|q| q.trim().to_string());
            Settings { quality: quality.unwrap_or_default(), ..default() }
        });
        s.path = Some(path);
        s.fixed()
    }

    // Each within what it can be: a file edited by hand, or from another version, is read for what makes sense in it.
    fn fixed(mut self) -> Settings {
        for v in [&mut self.master, &mut self.effects, &mut self.voices] {
            *v = if v.is_finite() { v.clamp(0.0, 1.0) } else { 1.0 };
        }
        if !PRESETS.contains(&self.quality.as_str()) {
            self.quality = PRESETS[0].into();
        }
        if !SCALES.contains(&self.scale) {
            self.scale = 0.0;
        }
        let d = Settings::default();
        self.fov = if self.fov.is_finite() { self.fov.clamp(FOV.0, FOV.1) } else { d.fov };
        self.sensitivity = if self.sensitivity.is_finite() { self.sensitivity.clamp(SENSITIVITY.0, SENSITIVITY.1) } else { d.sensitivity };
        self
    }

    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        let json = serde_json::to_string_pretty(self).expect("settings to JSON");
        if let Err(e) = std::fs::create_dir_all(path.parent().unwrap()).and_then(|_| std::fs::write(path, json)) {
            warn!("{}: {e}; the settings are not kept", path.display());
        }
    }
}

#[derive(Resource, Default)]
pub struct Menu {
    pub open: bool,
    // On the settings page.
    pub settings: bool,
    // What the game was last made to be (paused or not), and the slider being dragged.
    was: bool,
    dragging: Option<Control>,
}

// Whether the game is being played (not behind the menu): a run condition.
pub fn playing(menu: Res<Menu>) -> bool {
    !menu.open
}

#[derive(Component, Clone, Copy, PartialEq, Debug)]
enum Control {
    Resume,
    Settings,
    Quit,
    Back,
    Master,
    Effects,
    Voices,
    Quality,
    Scale,
    Vsync,
    Window,
    Fov,
    Sensitivity,
}

impl Control {
    // A slider's range and where it is in it (0 to 1); None for anything else.
    fn slider(self, s: &Settings) -> Option<(f32, f32, f32)> {
        let (v, (a, b)) = match self {
            Control::Master => (s.master, (0.0, 1.0)),
            Control::Effects => (s.effects, (0.0, 1.0)),
            Control::Voices => (s.voices, (0.0, 1.0)),
            Control::Fov => (s.fov, FOV),
            Control::Sensitivity => (s.sensitivity, SENSITIVITY),
            _ => return None,
        };
        Some((a, b, (v - a) / (b - a)))
    }

    fn set(self, s: &mut Settings, at: f32) {
        let Some((a, b, _)) = self.slider(s) else { return };
        let v = a + (b - a) * at.clamp(0.0, 1.0);
        match self {
            Control::Master => s.master = v,
            Control::Effects => s.effects = v,
            Control::Voices => s.voices = v,
            Control::Fov => s.fov = v.round(),
            Control::Sensitivity => s.sensitivity = (v * 20.0).round() / 20.0,
            _ => {}
        }
    }

    // The next choice of a setting with choices.
    fn next(self, s: &mut Settings) {
        let after = |list: &[f32], v: f32| list[(list.iter().position(|&x| x == v).unwrap_or(0) + 1) % list.len()];
        match self {
            Control::Quality => s.quality = PRESETS[(PRESETS.iter().position(|&p| p == s.quality).unwrap_or(0) + 1) % PRESETS.len()].into(),
            Control::Scale => s.scale = after(&SCALES, s.scale),
            Control::Vsync => s.vsync = !s.vsync,
            Control::Window => s.fullscreen = !s.fullscreen,
            _ => {}
        }
    }

    fn shows(self, s: &Settings) -> String {
        match self {
            Control::Master | Control::Effects | Control::Voices => format!("{:.0}%", self.slider(s).unwrap().2 * 100.0),
            Control::Fov => format!("{:.0}\u{b0}", s.fov),
            Control::Sensitivity => format!("{:.2}", s.sensitivity),
            Control::Quality => s.quality.clone(),
            Control::Scale if s.scale == 0.0 => "Follows the frame rate".into(),
            Control::Scale => format!("{:.0}%", s.scale * 100.0),
            Control::Vsync => (if s.vsync { "On" } else { "Off" }).into(),
            Control::Window => (if s.fullscreen { "Borderless fullscreen" } else { "Windowed" }).into(),
            _ => String::new(),
        }
    }
}

#[derive(Component)]
struct Root;
// The main page (false) or the settings (true).
#[derive(Component)]
struct Page(bool);
// What a setting is now, as text, and a slider's filled part.
#[derive(Component)]
struct Shows(Control);
#[derive(Component)]
struct Fill(Control);

fn spawn(mut commands: Commands, assets: Res<AssetServer>) {
    let roman: Handle<Font> = assets.load("fonts/im-fell-english.ttf");
    let italic: Handle<Font> = assets.load("fonts/im-fell-english-italic.ttf");
    let column = |gap: f32| Node { flex_direction: FlexDirection::Column, align_items: AlignItems::Center, row_gap: px(gap * REM), ..default() };
    let item = |c: &mut ChildSpawnerCommands, text: &str, control: Control, size: f32| {
        c.spawn((Text::new(text), font(&roman, size), TextColor(INK), shadow(), control, RelativeCursorPosition::default()));
    };
    let heading = |c: &mut ChildSpawnerCommands, text: &str| {
        c.spawn((Text::new(text), font(&italic, 1.0), TextColor(FAINT), shadow(), Node { margin: UiRect::top(px(0.7 * REM)), ..default() }));
    };
    let row = |c: &mut ChildSpawnerCommands, label: &str, control: Control| {
        c.spawn(Node { width: px(30.0 * REM), justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::Center, ..default() }).with_children(|r| {
            r.spawn((Text::new(label), font(&roman, 1.05), TextColor(INK), shadow()));
            if control.slider(&Settings::default()).is_some() {
                r.spawn(Node { align_items: AlignItems::Center, column_gap: px(0.9 * REM), ..default() }).with_children(|r| {
                    // (The line is thin; what takes the click is the height of a line of text round it.)
                    r.spawn((Node { width: px(11.0 * REM), height: px(1.3 * REM), align_items: AlignItems::Center, ..default() }, control,
                             RelativeCursorPosition::default()))
                        .with_children(|t| {
                            t.spawn((Node { width: percent(100), height: px(3), ..default() }, BackgroundColor(DIM))).with_children(|b| {
                                b.spawn((Node { width: percent(0), height: percent(100), ..default() }, BackgroundColor(INK), Fill(control)));
                            });
                        });
                    r.spawn((Text::new(""), font(&roman, 1.0), TextColor(FAINT), shadow(), Node { width: px(3.2 * REM), ..default() },
                             TextLayout::justify(Justify::Right), Shows(control)));
                });
            } else {
                r.spawn((Text::new(""), font(&roman, 1.05), TextColor(INK), shadow(), control, RelativeCursorPosition::default(), Shows(control)));
            }
        });
    };
    commands
        .spawn((
            Node { position_type: PositionType::Absolute, width: percent(100), height: percent(100), justify_content: JustifyContent::Center,
                   align_items: AlignItems::Center, ..default() },
            // (Blended in linear light: 0.9 leaves the picture and the HUD about a third as bright to the eye.)
            BackgroundColor(Color::srgba(0.02, 0.02, 0.022, 0.9)),
            GlobalZIndex(10),
            Visibility::Hidden,
            Root,
        ))
        .with_children(|root| {
            root.spawn((column(1.0), Page(false))).with_children(|c| {
                c.spawn((Text::new("Paused"), font(&italic, 2.4), TextColor(FAINT), shadow(), Node { margin: UiRect::bottom(px(1.2 * REM)), ..default() }));
                item(c, "Resume", Control::Resume, 1.6);
                item(c, "Settings", Control::Settings, 1.6);
                item(c, "Quit", Control::Quit, 1.6);
            });
            root.spawn((column(0.45), Page(true))).with_children(|c| {
                c.spawn((Text::new("Settings"), font(&italic, 2.0), TextColor(FAINT), shadow(), Node { margin: UiRect::bottom(px(0.4 * REM)), ..default() }));
                heading(c, "Sound");
                row(c, "Everything", Control::Master);
                row(c, "Effects", Control::Effects);
                row(c, "Voices", Control::Voices);
                heading(c, "Picture");
                row(c, "Quality (F3)", Control::Quality);
                row(c, "Resolution", Control::Scale);
                row(c, "Vertical sync", Control::Vsync);
                row(c, "Window", Control::Window);
                row(c, "Field of view", Control::Fov);
                heading(c, "Mouse");
                row(c, "Sensitivity", Control::Sensitivity);
                c.spawn(Node { height: px(0.8 * REM), ..default() });
                item(c, "Back", Control::Back, 1.4);
            });
        });
}

// Escape, and the mouse on the menu's controls. (In PostUpdate: the click that resumes has been seen by the weapons
// with the pointer still free, so it fires nothing.)
fn act(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    mut menu: ResMut<Menu>,
    mut settings: ResMut<Settings>,
    controls: Query<(&Control, &RelativeCursorPosition)>,
    warm: Option<Res<crate::warm::Warm>>,
    mut exit: MessageWriter<AppExit>,
) {
    // (Not over the warm-up's loading screen, which is drawn over everything.)
    if keys.just_pressed(KeyCode::Escape) && warm.is_none_or(|w| !w.on || w.done) {
        match (menu.open, menu.settings) {
            (false, _) => menu.open = true,
            (true, true) => menu.settings = false,
            (true, false) => menu.open = false,
        }
    }
    if !menu.open {
        return;
    }
    if mouse.just_pressed(MouseButton::Left) {
        let page = menu.settings;
        let on = controls.iter().find(|(c, r)| r.cursor_over() && matches!(c, Control::Resume | Control::Settings | Control::Quit) != page).map(|(c, _)| *c);
        match on {
            Some(Control::Resume) => menu.open = false,
            Some(Control::Settings) => menu.settings = true,
            Some(Control::Back) => menu.settings = false,
            Some(Control::Quit) => {
                exit.write(AppExit::Success);
            }
            Some(c) if c.slider(&settings).is_some() => menu.dragging = Some(c),
            Some(c) => {
                c.next(&mut settings);
                settings.save();
            }
            None => {}
        }
    }
    if let Some(c) = menu.dragging {
        if let Some(x) = controls.iter().find(|(d, _)| **d == c).and_then(|(_, r)| r.normalized) {
            // (Only when it moves: a resource changed every frame would be applied every frame.)
            let mut s = settings.clone();
            c.set(&mut s, x.x + 0.5);
            if s != *settings {
                *settings = s;
            }
        }
        if !mouse.pressed(MouseButton::Left) {
            menu.dragging = None;
            settings.save();
        }
    }
}

// The game paused or going on, as the menu is open or not: its clock, the sound, the pointer.
fn pause(mut menu: ResMut<Menu>, mut time: ResMut<Time<Virtual>>, mut sound: ResMut<Sound>, mut cursor: Query<&mut CursorOptions, With<PrimaryWindow>>,
         mut root: Query<&mut Visibility, With<Root>>) {
    if menu.open == menu.was {
        return;
    }
    menu.was = menu.open;
    if menu.open {
        time.pause();
    } else {
        time.unpause();
        menu.settings = false;
        menu.dragging = None;
    }
    sound.paused = menu.open;
    if let Ok(mut c) = cursor.single_mut() {
        c.grab_mode = if menu.open { CursorGrabMode::None } else { CursorGrabMode::Locked };
        c.visible = menu.open;
    }
    for mut v in &mut root {
        *v = if menu.open { Visibility::Inherited } else { Visibility::Hidden };
    }
}

// What the menu shows: the page, each setting as it is, a control under the pointer lit.
fn show(menu: Res<Menu>, settings: Res<Settings>, mut pages: Query<(&Page, &mut Node), Without<Fill>>, mut texts: Query<(&Shows, &mut Text)>,
        mut fills: Query<(&Fill, &mut Node), Without<Page>>, mut lit: Query<(&Control, &RelativeCursorPosition, &mut TextColor)>) {
    if !menu.open {
        return;
    }
    for (page, mut node) in &mut pages {
        let display = if page.0 == menu.settings { Display::Flex } else { Display::None };
        if node.display != display {
            node.display = display;
        }
    }
    if settings.is_changed() || menu.is_changed() {
        for (shows, mut text) in &mut texts {
            let s = shows.0.shows(&settings);
            if text.0 != s {
                text.0 = s;
            }
        }
        for (fill, mut node) in &mut fills {
            node.width = percent(fill.0.slider(&settings).map_or(0.0, |s| s.2 * 100.0));
        }
    }
    for (c, r, mut colour) in &mut lit {
        let want = if r.cursor_over() || menu.dragging == Some(*c) { BRIGHT } else { INK };
        if colour.0 != want {
            colour.0 = want;
        }
    }
}

// The settings put where they act, at the start and whenever they change.
fn apply(settings: Res<Settings>, mut sound: ResMut<Sound>, mut graphics: ResMut<Graphics>, mut windows: Query<&mut Window, With<PrimaryWindow>>,
         mut players: Query<&mut crate::player::Player>) {
    if !settings.is_changed() {
        return;
    }
    let s = &*settings;
    sound.volume = [s.master, s.effects, s.voices];
    let preset = PRESETS.iter().position(|&p| p == s.quality).unwrap_or(0);
    if graphics.preset != preset {
        graphics.preset = preset;
    }
    if graphics.scale != s.scale {
        graphics.scale = s.scale;
    }
    if let Ok(mut w) = windows.single_mut() {
        // (Bevy's own default is Fifo, vsync that every device has: what "on" is, so the default changes nothing.)
        let present = if s.vsync { PresentMode::Fifo } else { PresentMode::AutoNoVsync };
        let mode = if s.fullscreen { WindowMode::BorderlessFullscreen(MonitorSelection::Current) } else { WindowMode::Windowed };
        if w.present_mode != present {
            w.present_mode = present;
        }
        if w.mode != mode {
            w.mode = mode;
        }
    }
    for mut p in &mut players {
        p.look_speed = s.sensitivity;
    }
}

pub fn plugin(settings: Settings) -> impl Fn(&mut App) {
    move |app: &mut App| {
        app.insert_resource(settings.clone())
            .init_resource::<Menu>()
            .add_systems(Startup, spawn)
            .add_systems(Update, apply)
            .add_systems(PostUpdate, (act, pause, show).chain().before(UiSystems::Prepare));
    }
}

#[test]
fn settings_round_trip() {
    let s = Settings { master: 0.5, voices: 0.25, quality: "Low".into(), scale: 0.7, vsync: false, fullscreen: true, fov: 95.0, sensitivity: 1.35, ..default() };
    let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
    assert_eq!(back, s);
    // A file from before a setting existed keeps the rest and takes the default for it; nonsense is put right.
    let old: Settings = serde_json::from_str(r#"{ "master": 0.3, "quality": "Ultra", "fov": 500, "scale": 0.33 }"#).unwrap();
    let old = old.fixed();
    assert_eq!((old.master, old.effects, old.quality.as_str(), old.fov, old.scale), (0.3, 1.0, "High", FOV.1, 0.0));
}

// The `menu` scenario: the menu opened over the hall, its main page and its settings photographed, the pipelines made by
// opening it counted (there should be none), a slider dragged and a choice clicked as the mouse would, and the settings
// written to the scenario's folder and read back.
pub fn scenario() -> Vec<crate::scenario::Step> {
    use crate::scenario::{log, Step};
    use serde_json::json;
    use std::sync::atomic::Ordering;
    #[derive(Resource)]
    struct Before(usize);
    let made = |w: &World| w.resource::<crate::warm::Pipelines>().made.load(Ordering::SeqCst);
    let mut s = vec![Step::Shot("menu_hall".into()), Step::Wait(3)];
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let p = w.resource::<crate::warm::Pipelines>().clone();
        p.note.store(true, Ordering::SeqCst);
        let n = made(w);
        w.insert_resource(Before(n));
        w.resource_mut::<Menu>().open = true;
    })));
    s.push(Step::Wait(4));
    s.push(Step::Shot("menu_main".into()));
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Menu>().settings = true)));
    s.push(Step::Wait(4));
    s.push(Step::Shot("menu_settings".into()));
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let paused = w.resource::<Time<Virtual>>().is_paused();
        let sound = w.resource::<Sound>().paused;
        let new = w.resource::<crate::warm::Pipelines>().new.lock().unwrap().clone();
        let n = made(w) - w.resource::<Before>().0;
        log(w, json!({ "event": "opened", "time_paused": paused, "sound_paused": sound, "pipelines_made": n, "new": new }));
        // As the mouse would: the effects slider dragged to a third, the quality clicked on to the next.
        let mut settings = w.resource_mut::<Settings>();
        Control::Effects.set(&mut settings, 1.0 / 3.0);
        Control::Quality.next(&mut settings);
    })));
    s.push(Step::Wait(4));
    s.push(Step::Shot("menu_changed".into()));
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let out = w.resource::<crate::scenario::Out>().0.clone();
        let mut settings = w.resource::<Settings>().clone();
        settings.path = Some(out.join("settings.json"));
        settings.save();
        let back = serde_json::from_slice::<Settings>(&std::fs::read(out.join("settings.json")).unwrap()).unwrap();
        let same = Settings { path: settings.path.clone(), ..back.clone() } == settings;
        let preset = w.resource::<Graphics>().preset;
        let volume = w.resource::<Sound>().volume;
        log(w, json!({ "event": "settings", "saved": back, "read_back_the_same": same, "graphics_preset": preset, "sound_volume": volume }));
        w.resource_mut::<Menu>().open = false;
    })));
    s.push(Step::Wait(4));
    s.push(Step::Do(Box::new(|w: &mut World| {
        let paused = w.resource::<Time<Virtual>>().is_paused();
        log(w, json!({ "event": "resumed", "time_paused": paused, "sound_paused": w.resource::<Sound>().paused }));
    })));
    s
}
