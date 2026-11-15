// What is drawn over the picture (src/sandbox/hud.ts): the build, the aim, what is in hand, and the readings of
// whoever is being looked at, as a bedside monitor would give them, with what has been done to them under it. The
// look is play.html's: IM Fell on the picture with a soft shadow under it, sizes in its rems (16 px).

use bevy::prelude::*;
use bevy::text::{FontSize, LineHeight};

use crate::arsenal::Arsenal;
use crate::person::Person;
use crate::player::Player;
use crate::vitals::Vitals;
use crate::weapons::{arm, Weapons};

const REM: f32 = 16.0;
const INK: Color = Color::srgb(0.867, 0.843, 0.784); // #ddd7c8
const FAINT: Color = Color::srgb(0.561, 0.537, 0.486); // #8f897c
const DIM: Color = Color::srgb(0.373, 0.353, 0.318); // #5f5a51
const BRIGHT: Color = Color::srgb(0.945, 0.925, 0.878); // #f1ece0
const PALE: Color = Color::srgb(0.788, 0.765, 0.706); // #c9c3b4
const WARN: Color = Color::srgb(0.878, 0.541, 0.455); // #e08a74
const HELP: Color = Color::srgb(0.647, 0.624, 0.565); // #a59f90

#[derive(Resource)]
struct Fonts {
    roman: Handle<Font>,
    italic: Handle<Font>,
}

// A line said for a moment at the bottom right (graphics.rs: the quality preset), gone after two and a half seconds.
#[derive(Resource, Default)]
pub struct Note {
    text: String,
    at: f32,
}

impl Note {
    pub fn say(&mut self, text: String, now: f32) {
        self.text = text;
        self.at = now;
    }
}

#[derive(Component)]
struct Aim;
#[derive(Component)]
struct Slots;
#[derive(Component)]
struct Prompt;
#[derive(Component)]
struct Ammo;
#[derive(Component)]
struct Monitor;
#[derive(Component)]
struct Help;
#[derive(Component)]
struct NoteText;

fn font(f: &Handle<Font>, rem: f32) -> TextFont {
    TextFont { font: f.into(), font_size: FontSize::Px(rem * REM), ..default() }
}

fn shadow() -> TextShadow {
    TextShadow { offset: Vec2::new(0.0, 1.0), color: Color::srgba(0.0, 0.0, 0.0, 0.85) }
}

fn at(left: Option<f32>, top: Option<f32>, right: Option<f32>, bottom: Option<f32>) -> Node {
    let v = |x: Option<f32>| x.map_or(Val::Auto, |r| px(r * REM));
    Node { position_type: PositionType::Absolute, left: v(left), top: v(top), right: v(right), bottom: v(bottom), ..default() }
}

fn spawn(mut commands: Commands, assets: Res<AssetServer>) {
    let fonts = Fonts { roman: assets.load("fonts/im-fell-english.ttf"), italic: assets.load("fonts/im-fell-english-italic.ttf") };
    let r = &fonts.roman;
    commands.spawn((at(Some(1.0), Some(0.8), None, None), Text::new(format!("Cold Chain {}", env!("CARGO_PKG_VERSION"))), font(r, 0.85),
                    TextColor(Color::srgb(0.71, 0.682, 0.624)), shadow()));
    commands.spawn((
        Node {
            position_type: PositionType::Absolute, left: percent(50), top: percent(50), width: px(4), height: px(4), margin: UiRect::all(px(-2)),
            border_radius: BorderRadius::MAX, ..default()
        },
        BackgroundColor(INK),
        Aim,
    ));
    commands.spawn((
        Node { position_type: PositionType::Absolute, bottom: px(1.1 * REM), width: percent(100), justify_content: JustifyContent::Center, column_gap: px(1.3 * REM), ..default() },
        Slots,
    ));
    commands.spawn((
        Node { position_type: PositionType::Absolute, top: Val::Percent(50.0), margin: UiRect::top(px(2.2 * REM)), width: percent(100), justify_content: JustifyContent::Center, ..default() },
        Prompt,
    ));
    commands.spawn((at(None, None, Some(1.4), Some(1.0)), Text::new(""), font(r, 1.5), TextColor(INK), shadow(), Ammo));
    commands.spawn((Node { width: px(19.0 * REM), flex_direction: FlexDirection::Column, ..at(None, Some(1.0), Some(1.4), None) }, Monitor));
    let help = [
        "Left click: fire, stab, swing, grab or throw. Right click: cut with a blade or change what you throw.",
        "Fists: left click punches with the left, right click with the right; hold to wind up a harder punch.",
        "1 to 6 or the mouse wheel: change what you hold. R: reload. E: take from the wall. G: put it back. Tab: what you carry.",
        "Bandage or medkit: hold left click on a wound (the medkit dresses all of them, one after another).",
        "N: another person where you are looking. X: see inside them. K: clear the room. H: hide this.",
    ];
    commands.spawn((Node { width: px(34.0 * REM), flex_direction: FlexDirection::Column, ..at(Some(1.0), None, None, Some(1.0)) }, Help)).with_children(|c| {
        for line in help {
            c.spawn((Text::new(line), font(r, 0.9), LineHeight::RelativeToFont(1.35), TextColor(HELP), shadow()));
        }
    });
    commands.spawn((at(None, None, Some(1.0), Some(3.2)), Text::new(""), font(r, 0.9), TextColor(HELP), shadow(), NoteText));
    commands.insert_resource(fonts);
}

fn toggle(keys: Res<ButtonInput<KeyCode>>, mut help: Query<&mut Visibility, With<Help>>) {
    if keys.just_pressed(KeyCode::KeyH) {
        for mut v in &mut help {
            *v = if *v == Visibility::Hidden { Visibility::Inherited } else { Visibility::Hidden };
        }
    }
}

// Who is looked at: the nearest person whose middle is within a narrowing cone of the view, out to 25 m.
pub fn looked_at<'a>(eye: &Transform, people: impl Iterator<Item = (Entity, &'a Person)>) -> Option<Entity> {
    let ahead = eye.forward().as_vec3();
    let mut best = None;
    let mut near = 25.0;
    for (e, p) in people {
        let centre = p.segments.iter().find(|s| s.name == "belly").map_or(Vec3::ZERO, |s| s.rest.translation);
        let d = eye.translation.distance(centre);
        if d > near {
            continue;
        }
        if (centre - eye.translation).normalize().dot(ahead) > 0.97 - 0.15 / d.max(1.0) {
            best = Some(e);
            near = d;
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn update(
    mut commands: Commands,
    fonts: Res<Fonts>,
    weapons: Res<Weapons>,
    arsenal: Option<Res<Arsenal>>,
    note: Res<Note>,
    time: Res<Time<Real>>,
    eye: Query<&Transform, With<Player>>,
    people: Query<(Entity, &Person, &Vitals)>,
    slots: Query<Entity, With<Slots>>,
    prompt: Query<Entity, With<Prompt>>,
    monitor: Query<Entity, With<Monitor>>,
    mut ammo: Query<&mut Text, (With<Ammo>, Without<NoteText>)>,
    mut said: Query<&mut Text, (With<NoteText>, Without<Ammo>)>,
    mut aim: Query<&mut Node, With<Aim>>,
    mut last: Local<(String, String, String)>,
) {
    let r = &fonts.roman;
    // The slots: the one in hand bright, empty ones dim.
    let bar: String = weapons.slots.iter().enumerate().map(|(i, k)| format!("{i}{}{:?}|", (i == weapons.slot) as u8, k)).collect();
    if bar != last.0 {
        last.0 = bar;
        for e in &slots {
            commands.entity(e).despawn_children();
            for (i, k) in weapons.slots.iter().enumerate() {
                let on = i == weapons.slot;
                let (num, name) = if on { (PALE, BRIGHT) } else if k.is_none() { (DIM, DIM) } else { (Color::srgb(0.435, 0.416, 0.376), FAINT) };
                commands.spawn((Node { align_items: AlignItems::Baseline, ..default() }, ChildOf(e))).with_children(|c| {
                    c.spawn((Text::new(format!("{}", i + 1)), font(r, 0.8), TextColor(num), shadow(), Node { margin: UiRect::right(px(0.2 * REM)), ..default() }));
                    c.spawn((Text::new(k.map_or("Hands", |k| arm(k).name)), font(r, 1.0), TextColor(name), shadow()));
                });
            }
        }
    }
    let Ok(eye) = eye.single() else { return };
    // What is on the board within reach, to take.
    let on = arsenal.and_then(|a| a.look(eye.translation, eye.forward().as_vec3()));
    let text = on.map(|k| {
        let verb = if weapons.slots.contains(&Some(k)) { "Hold" } else if weapons.slots.contains(&None) { "Take" } else { "Swap for" };
        ("E".to_string(), format!("{verb} the {}", arm(k).name))
    });
    // (Else what the bandage or the medkit can do here: "Hold left click: Dress the wound", or how far a dressing is on.)
    let text = text.or_else(|| {
        let m = &weapons.medic.prompt;
        (!m.is_empty()).then(|| m.split_once(": ").map_or((String::new(), m.clone()), |(k, t)| (k.to_string(), t.to_string())))
    });
    let p = text.as_ref().map(|(k, t)| format!("{k}|{t}")).unwrap_or_default();
    if p != last.1 {
        last.1 = p;
        for e in &prompt {
            commands.entity(e).despawn_children();
            if let Some((k, t)) = &text {
                commands.spawn((Node { align_items: AlignItems::Baseline, ..default() }, ChildOf(e))).with_children(|c| {
                    if !k.is_empty() {
                        c.spawn((Text::new(k.clone()), font(r, 0.8), TextColor(FAINT), shadow(), Node { margin: UiRect::right(px(0.35 * REM)), ..default() }));
                    }
                    c.spawn((Text::new(t.clone()), font(r, 1.1), TextColor(INK), shadow()));
                });
            }
        }
    }
    let a = weapons.arm();
    let rounds = match a.rounds {
        Some(_) if weapons.reloading > 0.0 => "Reloading".to_string(),
        Some(n) => format!("{} / {n}", weapons.ammo[a.key]),
        None if a.kind == crate::weapons::Kind::Throw => format!("Throwing a {}", weapons.throwing()),
        None => String::new(),
    };
    // The crosshair where the gun's bore meets the world (weapons.rs `sight`), the middle of the view for anything else.
    let (left, top) = weapons.sight.map_or((50.0, 50.0), |p| (p.x * 100.0, p.y * 100.0));
    for mut n in &mut aim {
        if n.left != percent(left) || n.top != percent(top) {
            n.left = percent(left);
            n.top = percent(top);
        }
    }
    for mut t in &mut ammo {
        if t.0 != rounds {
            t.0 = rounds.clone();
        }
    }
    let now = time.elapsed_secs();
    let line = if now - note.at < 2.5 { note.text.clone() } else { String::new() };
    for mut t in &mut said {
        if t.0 != line {
            t.0 = line.clone();
        }
    }

    // The monitor of whoever is looked at.
    let shown = looked_at(eye, people.iter().map(|(e, p, _)| (e, p))).and_then(|e| people.get(e).ok());
    let key = shown.map(|(_, p, v)| format!("{}{}{}{}{}{}", p.label, v.hr.round(), v.map, v.spo2.round(), v.volume, v.injuries.len())).unwrap_or_default();
    if key == last.2 {
        return;
    }
    last.2 = key;
    for e in &monitor {
        commands.entity(e).despawn_children();
        let Some((_, p, v)) = shown else { continue };
        commands.spawn((Text::new(p.label.clone()), font(r, 1.35), TextColor(INK), shadow(), ChildOf(e)));
        let warn_state = v.dead || !v.beating();
        commands.spawn((Text::new(v.state()), font(&fonts.italic, 1.1), TextColor(if warn_state { WARN } else { PALE }), shadow(),
                        Node { margin: UiRect::new(px(0), px(0), px(0.1 * REM), px(0.5 * REM)), ..default() }, ChildOf(e)));
        let litres = v.full - v.volume;
        let rows = [
            ("Heart rate", if v.beating() { format!("{} bpm", v.hr.round()) } else { "none".into() }, !v.beating() || v.hr > 120.0),
            ("Blood pressure", if v.beating() { format!("{}/{}", v.systolic(), v.diastolic()) } else { "none".into() }, v.map < 65.0),
            ("Oxygen", format!("{}%", v.spo2.round()), v.spo2 < 90.0),
            ("Breathing", if v.breathing && v.beating() { format!("{} a minute", v.rr.round()) } else { "none".into() }, !v.breathing),
            ("Blood lost", format!("{litres:.2} L of {:.1}", v.full), v.lost() > 0.15),
        ];
        for (name, value, warn) in rows {
            let colour = if warn { WARN } else { INK };
            commands.spawn((Node { justify_content: JustifyContent::SpaceBetween, padding: UiRect::vertical(px(0.1 * REM)), ..default() }, ChildOf(e))).with_children(|c| {
                c.spawn((Text::new(name), font(r, 0.98), TextColor(colour), shadow()));
                c.spawn((Text::new(value), font(r, 0.92), TextColor(colour), shadow()));
            });
        }
        let mut list: Vec<String> = v.injuries.iter().take(8).map(|i| i.text.clone()).collect();
        if v.injuries.len() > 8 {
            list.push(format!("and {} more", v.injuries.len() - 8));
        }
        for (k, line) in list.into_iter().enumerate() {
            let top = if k == 0 { 0.7 * REM } else { 0.0 };
            commands.spawn((Text::new(line), font(r, 0.95), TextColor(PALE), shadow(), Node { margin: UiRect::top(px(top)), ..default() }, ChildOf(e)));
        }
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Note>().add_systems(Startup, spawn).add_systems(Update, (toggle, update));
}
