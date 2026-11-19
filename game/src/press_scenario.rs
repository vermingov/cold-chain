// The `press` scenario: a gun's muzzle pressed against someone, or nearly, and fired (the play-test's report: "if I
// stand very close with my gun's barrel against somebody, sometimes it doesn't even hit them"). Each gun against each
// part of a person standing, from straight in front and from 40 degrees round, the muzzle 5 cm into them (a player who
// walks on into someone: the long guns can only be pulled back a few centimetres), on the skin, and 1, 3 and 10 cm off;
// then the same at a few parts of people lying on the floor, and of people staggering from a shove as the shot goes.
// Each shot is logged with whether the barrel's line, from half a metre behind the muzzle on, passes through anyone's
// skin, and whether the shot went in: a miss where it does is the report's.
// `press-pistol`, `press-ak`, `press-m4`, `press-shotgun`, `press-rifle` (standing), `press-lying`, `press-shove`,
// `press-walk`.
//
// The player is put where the gun, held as it is at rest, has its muzzle at that point and its bore along the line in:
// the eye standing (1.65 m) or crouched (0.92 m), whichever reaches, turned to the pitch that brings the muzzle there.
// What the hands then do with it (pulled back off what it meets, the sway) is the game's own, and the line is read off
// the shot as it went.

use bevy::ecs::system::RunSystemOnce;
use bevy::prelude::*;
use serde_json::{json, Value};

use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::scenario::{log, Step};
use crate::weapons::{Hand, Weapons};

const GUNS: [&str; 5] = ["pistol", "ak", "m4", "shotgun", "rifle"];
const PARTS: [&str; 10] = ["head", "neck", "chest", "belly", "pelvis", "upperarmL", "forearmL", "handL", "thighL", "shinL"];
// m: the muzzle off the skin along the bore (less than nothing: in).
const OFF: [f32; 5] = [-0.05, 0.0, 0.01, 0.03, 0.10];
// Degrees round from straight in front (the line-up faces +z, the player comes from there).
const TURNS: [f32; 2] = [0.0, 40.0];

fn act(f: impl Fn(&mut World) + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(f))
}

fn people(w: &mut World) -> Vec<Entity> {
    let mut q = w.query::<(Entity, &Person)>();
    let mut v: Vec<_> = q.iter(w).map(|(e, p)| (e, p.body.name.clone())).collect();
    v.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.1));
    v.into_iter().map(|p| p.0).collect()
}

// The gun as held at rest, nothing against it: the hand in the eye's frame and the muzzle in the hand's.
#[derive(Resource, Clone, Copy)]
struct Rest(Transform, Vec3);

// What a shot is: whose part, how far off, from how far round; and where the player was put for it.
#[derive(Resource, Default)]
struct Planned(Option<Value>);

// The first skin along a line (not clothes: a sleeve standing off an arm is not the body).
fn skin(w: &mut World, who: Entity, o: Vec3, d: Vec3, far: f32) -> Option<f32> {
    crate::npc::with(w, who, |n| n.surface(o, d, far, false).into_iter().find(|h| h.kind == crate::npc::Kind::Skin).map(|h| h.t)).flatten()
}

// The player put so that the muzzle is `off` from person `who`'s `part` along a bore that comes in `turn` degrees round
// from in front: the eye at `eye` over the floor. None where no pitch reaches.
fn reach(w: &mut World, who: Entity, part: &str, off: f32, turn: f32, eye: f32) -> Option<(Vec3, f32, f32, Vec3, Vec3)> {
    let Rest(hand, tip) = *w.resource::<Rest>();
    let rd = w.get::<Ragdoll>(who)?;
    // (The neck is the head's segment's lower end: it starts there.)
    let k = rd.segs.iter().position(|s| s.def.name == if part == "neck" { "head" } else { part })?;
    let def = &rd.segs[k].def;
    let c = if part == "neck" { rd.world_point(k, def.head.lerp(def.end, 0.12)) } else { rd.middle(k) };
    let level = Quat::from_rotation_y(turn.to_radians()) * Vec3::NEG_Z;
    let held = hand.translation + hand.rotation * tip;
    // For a pitch: the yaw that lays the bore's heading on `level`, the bore, where it meets the skin on the line through
    // the part's middle, and the eye that puts the muzzle `off` short of that. How far the eye is then above where it must be.
    let at = |w: &mut World, pitch: f32| -> (f32, f32, Vec3, Vec3, Vec3) {
        let mut yaw = (-level.x).atan2(-level.z);
        for _ in 0..4 {
            let r = Quat::from_euler(EulerRot::YXZ, yaw, pitch, 0.0);
            let d = r * hand.rotation * Vec3::NEG_Z;
            let (want, got) = ((-level.x).atan2(-level.z), (-d.x).atan2(-d.z));
            yaw += want - got;
        }
        let r = Quat::from_euler(EulerRot::YXZ, yaw, pitch, 0.0);
        let d = r * hand.rotation * Vec3::NEG_Z;
        let p = skin(w, who, c - d * 1.0, d, 1.0).map_or(c, |t| c - d + d * t);
        let m = p - d * off;
        (yaw, pitch, m - r * held, d, p)
    };
    let floor = w.resource::<crate::map::Map>().ground(c.x, c.z + 0.6, f32::INFINITY);
    let (mut lo, mut hi) = (-1.5f32, 0.8f32);
    let (f_lo, f_hi) = (at(w, lo).2.y - floor - eye, at(w, hi).2.y - floor - eye);
    if f_lo.signum() == f_hi.signum() {
        return None;
    }
    for _ in 0..30 {
        let mid = (lo + hi) / 2.0;
        let f = at(w, mid).2.y - floor - eye;
        if f.signum() == f_lo.signum() {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let (yaw, pitch, e, d, p) = at(w, (lo + hi) / 2.0);
    Some((e, yaw, pitch, d, p))
}

fn place(w: &mut World, n: usize, part: &'static str, off: f32, turn: f32, case: &'static str) {
    let who = people(w)[n];
    let label = w.get::<Person>(who).unwrap().label.clone();
    let found = [1.65, 0.92].into_iter().find_map(|eye| reach(w, who, part, off, turn, eye).map(|r| (eye, r)));
    let plan = json!({ "case": case, "person": label, "part": part, "off": off, "turn": turn });
    let Some((eye, (e, yaw, pitch, d, p))) = found else {
        w.resource_mut::<Planned>().0 = Some(json!({ "plan": plan, "unreachable": true }));
        return;
    };
    w.resource_scope(|w, map: Mut<crate::map::Map>| {
        for mut pl in w.query::<&mut Player>().iter_mut(w) {
            pl.spawn(&map, e.x, e.z, None, eye);
            pl.yaw = yaw;
            pl.pitch = pitch;
        }
    });
    w.resource_mut::<Planned>().0 = Some(json!({ "plan": plan, "eye": eye, "skin": p.to_array(), "bore": d.to_array() }));
}

fn fire(w: &mut World) {
    if w.resource::<Planned>().0.as_ref().is_some_and(|p| p.get("unreachable").is_some()) {
        return;
    }
    let mut wp = w.resource_mut::<Weapons>();
    let key = wp.arm().key;
    if let Some(r) = crate::weapons::arm(key).rounds {
        wp.ammo.insert(key, r);
    }
    wp.log.clear();
    let h = w.resource::<Hand>();
    let held = json!({ "back": h.back, "tilt": h.tilt, "against": h.against.is_some() });
    if let Some(p) = w.resource_mut::<Planned>().0.as_mut() {
        p["held"] = held;
    }
    crate::warm::press(w, 0);
}

// The shot as it went: the line from its muzzle along its bore, whether that line meets anyone's skin (from half a metre
// behind the muzzle: a barrel poked into someone is in them), whether it went in, and where.
fn record(w: &mut World) {
    let Some(mut plan) = w.resource_mut::<Planned>().0.take() else { return };
    if plan.get("unreachable").is_some() {
        log(w, json!({ "event": "press", "shot": plan }));
        return;
    }
    let hits = std::mem::take(&mut w.resource_mut::<Weapons>().log);
    let shot = hits.iter().find(|h| h.get("shot").is_some()).cloned();
    let v = |x: &Value| Vec3::new(x[0].as_f64().unwrap() as f32, x[1].as_f64().unwrap() as f32, x[2].as_f64().unwrap() as f32);
    let line = shot.as_ref().map(|s| (v(&s["muzzle"]), v(&s["dir"])));
    let mut through: Option<(String, f32)> = None;
    if let Some((m, d)) = line {
        for e in people(w) {
            if let Some(t) = skin(w, e, m - d * 0.5, d, 3.5) {
                let label = w.get::<Person>(e).unwrap().label.clone();
                if through.as_ref().is_none_or(|b| t - 0.5 < b.1) {
                    through = Some((label, t - 0.5));
                }
            }
        }
    }
    let went_in: Vec<Value> = hits.iter().filter(|h| h.get("hit").and_then(Value::as_str) == Some("pierce")).cloned().collect();
    let first = went_in.first().map(|h| json!({ "person": h["person"], "segment": h["segment"], "point": h["point"], "missile": h["missile"] }));
    plan["fired"] = json!(shot.is_some());
    plan["line"] = json!(line.map(|(m, d)| [m.to_array(), d.to_array()]));
    plan["through"] = json!(through.map(|t| json!([t.0, t.1])));
    plan["hit"] = json!(!went_in.is_empty());
    plan["first"] = json!(first);
    plan["walls"] = json!(hits.iter().filter(|h| h.get("hit").and_then(Value::as_str) == Some("wall")).count());
    let miss = plan["through"].is_array() && went_in.is_empty();
    eprintln!("PRESS {} {}", if miss { "MISS" } else if went_in.is_empty() { "clear" } else { "hit" }, plan);
    log(w, json!({ "event": "press", "shot": plan }));
}

// How the shot is come to: put there and held still, the person shoved a moment before it, or the player walking on into
// them with the gun held out (W held from a quarter of a metre off: what a player does who "stands very close").
#[derive(Clone, Copy)]
enum Way {
    Still,
    Shove(Vec3),
    Walk,
}

fn shot(s: &mut Vec<Step>, settle: u32, n: usize, part: &'static str, off: f32, turn: f32, case: &'static str, way: Way) {
    s.push(act(move |w| place(w, n, part, off, turn, case)));
    if let Way::Walk = way {
        s.push(Step::Wait(settle));
        s.push(act(|w| w.resource_mut::<ButtonInput<KeyCode>>().press(KeyCode::KeyW)));
        s.push(Step::Wait(40));
    } else if let Way::Shove(by) = way {
        // (Shoved once the player is there: the shot goes as they stagger.)
        s.push(Step::Wait(2));
        s.push(act(move |w| {
            let who = people(w)[n];
            if let Some(mut rd) = w.get_mut::<Ragdoll>(who) {
                let k = rd.by_name("chest");
                let at = rd.middle(k);
                rd.push(k, by, at);
            }
        }));
        s.push(Step::Wait(8));
    } else {
        s.push(Step::Wait(settle));
    }
    s.push(act(fire));
    s.push(Step::Wait(2));
    s.push(act(|w| {
        crate::warm::release(w, 0);
        w.resource_mut::<ButtonInput<KeyCode>>().release(KeyCode::KeyW);
    }));
    s.push(Step::Wait(2));
    s.push(act(record));
}

fn reset() -> Step {
    act(|w| {
        let _ = w.run_system_once(crate::sandbox::reset);
    })
}

// `key` taken, held a while with nobody near (the hall's far side), and its rest noted.
fn take(s: &mut Vec<Step>, key: &'static str) {
    s.push(act(move |w| {
        crate::warm::aim(w, 0, "chest", 4.0);
        crate::warm::take(w, key);
    }));
    s.push(Step::Wait(90));
    s.push(act(|w| {
        let key = w.resource::<Weapons>().arm().key;
        let h = w.resource::<Hand>();
        let tip = h.anchors.get(key).map_or(Vec3::new(0.0, 0.0, -0.6), |a| a.tip);
        let rest = Rest(h.local, tip);
        log(w, json!({ "event": "rest", "key": key, "hand": [rest.0.translation.to_array(), rest.0.rotation.to_array()], "tip": tip.to_array(), "back": h.back }));
        w.insert_resource(rest);
    }));
}

pub fn steps(part: &str) -> Vec<Step> {
    let mut s = vec![act(|w| {
        w.init_resource::<Planned>();
        let rd: Vec<String> = w.query::<&Ragdoll>().iter(w).next().map(|rd| rd.segs.iter().map(|s| s.def.name.clone()).collect()).unwrap_or_default();
        log(w, json!({ "event": "segments", "names": rd }));
    })];
    let settle = |key: &str| if key == "rifle" { 60 } else { 14 };
    for key in GUNS.iter().copied().filter(|k| part == *k) {
        take(&mut s, key);
        // Five people, one shot each, then the line-up again: each shot into someone standing and unhurt.
        let mut i = 0;
        for p in PARTS {
            for off in OFF {
                for turn in TURNS {
                    if i % 5 == 0 {
                        s.push(reset());
                        s.push(Step::Wait(40));
                    }
                    shot(&mut s, settle(key), i % 5, p, off, turn, "standing", Way::Still);
                    i += 1;
                }
            }
        }
    }
    // Lying: everyone knocked out and let fall, then each gun at a few parts of them, on the skin and 3 cm off.
    if part == "lying" {
        for key in GUNS {
            take(&mut s, key);
            s.push(reset());
            s.push(Step::Wait(30));
            s.push(act(|w| {
                for e in people(w) {
                    if let Some(mut v) = w.get_mut::<crate::vitals::Vitals>(e) {
                        v.out = 600.0;
                    }
                }
            }));
            s.push(Step::Wait(300));
            let mut i = 0;
            for p in ["head", "chest", "belly", "thighL"] {
                for off in [0.0, 0.03] {
                    for turn in TURNS {
                        shot(&mut s, settle(key), i % 5, p, off, turn, "lying", Way::Still);
                        i += 1;
                    }
                }
            }
        }
    }
    // Walking on into them: each gun from a quarter of a metre off at a few parts, the shot 40 frames into the walk.
    if part == "walk" {
        for key in GUNS {
            take(&mut s, key);
            let mut i = 0;
            for p in ["head", "chest", "belly", "upperarmL", "thighL"] {
                for turn in TURNS {
                    if i % 5 == 0 {
                        s.push(reset());
                        s.push(Step::Wait(40));
                    }
                    shot(&mut s, settle(key), i % 5, p, 0.25, turn, "walking", Way::Walk);
                    i += 1;
                }
            }
        }
    }
    // Shoved: a push at the chest (to the side, away, toward the player) a few frames before the shot, on the skin.
    if part == "shove" {
        for key in GUNS {
            take(&mut s, key);
            let mut i = 0;
            for p in ["head", "chest", "belly", "upperarmL"] {
                for by in [Vec3::X * 60.0, Vec3::NEG_Z * 60.0, Vec3::Z * 60.0] {
                    if i % 5 == 0 {
                        s.push(reset());
                        s.push(Step::Wait(40));
                    }
                    shot(&mut s, settle(key), i % 5, p, 0.0, 0.0, "shoved", Way::Shove(by));
                    i += 1;
                }
            }
        }
    }
    s
}
