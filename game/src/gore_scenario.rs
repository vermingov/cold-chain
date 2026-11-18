// The `gore` scenario: gunshot wounds, a belly blown open and blood soaked into a shirt, close up, as a player makes them
// (the shotgun and the pistol fired from the hands at the line-up) and from where a player looks at them after: in
// front of the wound, from the side of the body lying on its back, and from above. The play-test's reports: holes like a
// drilled tube in rings, bowel poking out as a cone and as flat shards, the shirt's stain one hard-edged blob.
// `gore-belly`, `gore-bare`, `gore-pellets`, `gore-head`, `gore-pistol` run a part each.

use bevy::ecs::system::RunSystemOnce;
use bevy::prelude::*;
use serde_json::{json, Value};

use crate::head_scenario::{hide_hud, look, Lamp, LAMP};
use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::scenario::{log, Step};
use crate::weapons::Weapons;

fn act(f: impl Fn(&mut World) + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(f))
}

// Person `n` of the line-up (west to east).
fn person(w: &mut World, n: usize) -> Entity {
    let mut q = w.query::<(Entity, &Person)>();
    let mut v: Vec<_> = q.iter(w).map(|(e, p)| (e, p.body.name.clone())).collect();
    v.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.1));
    v[n].0
}

// Where the wound is kept: the segment it went in at and the point in that segment's frame, so it is found again where
// the body has fallen.
#[derive(Resource, Default)]
struct Marked(Vec<(String, Entity, usize, Vec3)>);

// `weapon` fired from the hands at person `n`'s `part` from `far` metres; the first skin it went in at marked as `name`.
fn fire(name: &'static str, n: usize, part: &'static str, far: f32, weapon: &'static str) -> Vec<Step> {
    vec![
        act(|w| {
            let _ = w.run_system_once(crate::sandbox::reset);
        }),
        act(move |w| crate::warm::take(w, weapon)),
        Step::Wait(90),
        act(move |w| {
            // (Then looked at a point 9 cm left of the part and 12 above it, so that the bore, which is held that far
            // right of the eye and below it, runs through the part: close up, that is the difference between the belly
            // and the flank, or the head and the chest.)
            let Some((_, at)) = crate::warm::aim(w, n, part, far) else { return };
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                let eye = p.eye().translation;
                // (The head's segment starts at the neck: its vault, where a charge bursts the skull, is some 12 cm up.)
                let up = if part == "head" { 0.12 } else { 0.0 };
                let d = at + Vec3::new(-0.09, 0.12 + up, 0.0) - eye;
                p.yaw = (-d.x).atan2(-d.z);
                p.pitch = d.y.atan2(d.x.hypot(d.z));
            }
        }),
        Step::Wait(20),
        act(|w| {
            let h = w.resource::<crate::weapons::Hand>();
            let (back, tilt, against) = (h.back, h.tilt, h.against.map(|a| a.1.to_array()));
            let wp = w.resource::<Weapons>();
            let state = json!({ "slot": wp.slots[wp.slot], "reloading": wp.reloading, "busy": wp.busy });
            eprintln!("GORE aimed back {back} tilt {tilt} against {against:?} {state} boxes {:?}", w.resource::<crate::weapons::Hand>().boxes);
            log(w, json!({ "event": "aimed", "back": back, "tilt": tilt, "against": against, "weapons": state }));
            w.resource_mut::<Weapons>().log.clear();
            crate::warm::press(w, 0);
        }),
        Step::Wait(2),
        act(|w| crate::warm::release(w, 0)),
        Step::Wait(3),
        act(move |w| {
            let hits = std::mem::take(&mut w.resource_mut::<Weapons>().log);
            let who = person(w, n);
            let first = hits.iter().find(|h| h.get("hit").and_then(Value::as_str) == Some("pierce") && h.get("point").is_some_and(|p| !p.is_null()));
            let ms = hits.iter().find_map(|h| h.get("ms").and_then(Value::as_f64));
            if let Some(h) = first {
                let p = h["point"].as_array().unwrap();
                let at = Vec3::new(p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32, p[2].as_f64().unwrap() as f32);
                let rd = w.get::<Ragdoll>(who).unwrap();
                let (k, _) = rd.nearest(at);
                let local = rd.segs[k].now.compute_affine().inverse().transform_point3(at);
                w.resource_mut::<Marked>().0.push((name.into(), who, k, local));
            }
            eprintln!("GORE fired {name} {}", json!(hits));
            log(w, json!({ "event": "fired", "what": name, "ms": ms, "hits": hits }));
        }),
        // Knocked out a moment after, so that the hands that go to the wound do not cover it in the pictures (alive and
        // bleeding: the clothes soak as they would).
        Step::Wait(40),
        act(move |w| {
            let who = person(w, n);
            if let Some(mut v) = w.get_mut::<crate::vitals::Vitals>(who) {
                v.out = 600.0;
            }
        }),
    ]
}

// The marked wound `name` now: where, which way out of the body its skin faces (from its segment's middle), and the
// person's right (their pelvis's).
fn marked(w: &mut World, name: &str) -> Option<(Vec3, Vec3, Vec3)> {
    let (_, who, k, local) = w.resource::<Marked>().0.iter().find(|m| m.0 == name)?.clone();
    let rd = w.get::<Ragdoll>(who)?;
    let at = rd.segs[k].now.transform_point(local);
    Some((at, (at - rd.middle(k)).normalize_or(Vec3::Y), rd.segs[0].now.rotation * Vec3::X))
}

// Pictures of wound `name` from `far`: straight on, from the side (toward the person's right: beside a body lying on
// its back) and between.
fn pictures(name: &'static str, tag: &'static str, far: f32) -> Vec<Step> {
    let mut s = Vec::new();
    for (view, turn) in [("front", 0.0f32), ("oblique", 45.0), ("side", 78.0)] {
        s.push(act(move |w| {
            hide_hud(w);
            let Some((at, n, right)) = marked(w, name) else { return };
            let across = (right - n * right.dot(n)).normalize_or(Vec3::X);
            let t = turn.to_radians();
            let d = (n * t.cos() + across * t.sin() + Vec3::Y * 0.1).normalize();
            look(w, at, at + d * far);
        }));
        s.push(Step::Wait(3));
        s.push(Step::Shot(format!("{name}_{tag}_{view}")));
    }
    s
}

pub fn steps(part: &str) -> Vec<Step> {
    let all = part.is_empty();
    let mut s = vec![act(|w| {
        w.init_resource::<Marked>();
        w.spawn((Lamp, PointLight { intensity: LAMP, range: 2.0, radius: 0.03, shadow_maps_enabled: false, ..default() }, Transform::from_xyz(0.0, -50.0, 0.0)));
    })];
    // The shotgun's charge into the young man's belly, the muzzle some 35 cm off (one mass: the wall blown open), as in
    // the play-test; at once, a few seconds on (lying), and half a minute on (the shirt soaked).
    if all || part == "belly" {
        s.extend(fire("belly", 2, "belly", 1.6, "shotgun"));
        s.push(Step::Wait(240));
        s.extend(pictures("belly", "4s", 0.35));
        s.extend(pictures("belly", "4s_wide", 0.8));
        s.push(Step::Wait(if std::env::var("GORE_QUICK").is_ok() { 30 } else { 1500 }));
        s.extend(pictures("belly", "30s", 0.35));
        s.extend(pictures("belly", "30s_wide", 0.8));
    }
    // The same into the naked man's belly: the wound on bare skin.
    if all || part == "bare" {
        s.extend(fire("bare", 4, "belly", 1.6, "shotgun"));
        s.push(Step::Wait(240));
        s.extend(pictures("bare", "4s", 0.3));
        s.extend(pictures("bare", "4s_close", 0.16));
    }
    // From 3 m into the naked man's belly, the pellets parted.
    if all || part == "pellets" {
        s.extend(fire("pellets", 4, "belly", 3.0, "shotgun"));
        s.push(Step::Wait(240));
        s.extend(pictures("pellets", "4s", 0.3));
        s.extend(pictures("pellets", "4s_wide", 0.7));
    }
    // The charge into the groundskeeper's head.
    if all || part == "head" {
        s.extend(fire("head", 1, "head", 1.6, "shotgun"));
        s.push(Step::Wait(240));
        s.extend(pictures("head", "4s", 0.3));
    }
    // A pistol bullet into the naked man's belly from 2.5 m.
    if all || part == "pistol" {
        s.extend(fire("pistol", 4, "belly", 2.5, "pistol"));
        s.push(Step::Wait(240));
        s.extend(pictures("pistol", "4s", 0.15));
    }
    s
}
