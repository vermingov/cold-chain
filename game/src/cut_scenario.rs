// The `cut` scenario (scenario.rs): the body opened. A sword through a forearm, a thigh and the neck; a shotgun's charge
// at contact range into a belly; a knife drawn across a belly; a shin broken and its end out through the skin; a skull
// broken by a bat; and all of it seen through (X). Close, lit pictures of each cut face, stump, piece, the organs and the
// shards, and the time each cost into the log.
//
// What a player's hands would do is done here the way weapons.rs does it, by the same calls: an edge's chops
// (dismember::chop), a charge pierced into the body (wounds::pierce, whose `Happened::Charge` dismember.rs and viscera.rs
// take), a slash's skin crossings (viscera::slashed), a blow (wounds::blow). A step runs at the end of a frame, after the
// systems that take what medicine hands over have run, so it runs them at once (`taken`).

use bevy::ecs::system::RunSystemOnce;
use bevy::prelude::*;
use serde_json::json;

use crate::anatomy::Seeing;
use crate::map::Map;
use crate::npc::{self, Kind};
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::scenario::{log, person_at, Step};
use crate::{babylon, dismember, viscera};

// What medicine handed over in a step, taken at once.
fn taken(w: &mut World) {
    let t = std::time::Instant::now();
    w.run_system_once(dismember::taken_system).ok();
    w.run_system_once(crate::shards::redraw).ok();
    let ms = t.elapsed().as_secs_f32() * 1000.0;
    log(w, json!({ "event": "taken", "ms": ms }));
}

// A point between two bones' heads on person `who`, in the world now.
fn between(w: &mut World, who: Entity, a: &str, b: &str, t: f32) -> Vec3 {
    npc::with(w, who, |npc| {
        let (ia, ib) = (npc.bone_index(a), npc.bone_index(b));
        let (ha, hb) = (npc.body().bones[ia].head, npc.body().bones[ib].head);
        npc.rest_to_world(ia).transform_point3(ha.lerp(hb, t))
    })
    .unwrap()
}

// The eye put at `from`, looking at `at`.
fn look(w: &mut World, at: Vec3, from: Vec3) {
    w.resource_scope(|w, map: Mut<Map>| {
        let ground = map.ground(from.x, from.z, f32::INFINITY);
        let mut q = w.query::<&mut Player>();
        for mut p in q.iter_mut(w) {
            p.spawn(&map, from.x, from.z, Some(at), from.y - ground);
        }
    });
}

// A picture of what `at` finds, seen from `off` away from it (world), lit by a lamp held by the eye.
fn shot(s: &mut Vec<Step>, name: &str, at: impl Fn(&mut World) -> Option<Vec3> + Send + Sync + 'static, off: Vec3) {
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let Some(p) = at(w) else { return };
        look(w, p, p + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = p + off * 0.9 + Vec3::Y * 0.15;
        }
    })));
    s.push(Step::Wait(4));
    s.push(Step::Shot(name.into()));
}

// The photographer's lamp: close pictures in the hall's own light are mostly shadow (the hall's lamps are high and far).
#[derive(Component)]
struct Lamp;

fn stump(i: usize, k: usize, piece: bool) -> impl Fn(&mut World) -> Option<Vec3> + Send + Sync {
    move |w: &mut World| {
        let who = person_at(w, i);
        dismember::end_world(w, who, k, piece).map(|(at, _)| at)
    }
}

// Which way to look at a stump's end or a piece's from: along its face, a little off it.
fn facing(i: usize, k: usize, piece: bool, d: f32) -> impl Fn(&mut World) -> Option<Vec3> + Send + Sync {
    move |w: &mut World| {
        let who = person_at(w, i);
        let (at, n) = dismember::end_world(w, who, k, piece)?;
        // (From the side it faces, a little above it, never under the floor.)
        let mut off = (n + Vec3::Y * 0.25).normalize() * d;
        let ground = w.resource::<Map>().ground(at.x + off.x, at.z + off.z, f32::INFINITY);
        if at.y + off.y < ground + 0.12 {
            off.y = ground + 0.12 - at.y;
        }
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off * 0.9 + Vec3::Y * 0.12;
        }
        None
    }
}

fn close_on(s: &mut Vec<Step>, name: &str, f: impl Fn(&mut World) -> Option<Vec3> + Send + Sync + 'static) {
    s.push(Step::Do(Box::new(move |w: &mut World| {
        f(w);
    })));
    s.push(Step::Wait(4));
    s.push(Step::Shot(name.into()));
}

// `part`: "limbs", "belly", "bones", or everything (the whole scenario, `cut`).
pub fn steps(part: &str) -> Vec<Step> {
    let all = part.is_empty();
    let mut s = Vec::new();
    s.push(Step::Do(Box::new(|w: &mut World| {
        // (0.3 cd: it fills the shadows without lighting a close stump twice as brightly as the hall lights a face, which
        // left skin and cloth white and the cut red glowing. tools/port-cut.mjs lights the TS's the same.)
        w.spawn((Lamp, PointLight { intensity: 0.3 * crate::map::CANDELA, range: 3.0, radius: 0.05, shadow_maps_enabled: false, ..default() }, Transform::from_xyz(0.0, -50.0, 0.0)));
    })));
    // The people settled into their stance.
    s.push(Step::Wait(90));

    if all || part == "limbs" {
    // 1. A sword's chop through the old man's right forearm (about 90 J: one blow takes it).
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 0);
        let p = between(w, who, "lowerarm01.R", "wrist.R", 0.55);
        let t = std::time::Instant::now();
        let off = dismember::chop(w, who, p, babylon(-1.0, -0.3, 0.0).normalize(), 90.0);
        log(w, json!({ "event": "chop", "what": "forearm", "off": off, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(2));
    close_on(&mut s, "forearm_stump", facing(0, 0, false, 0.32));
    close_on(&mut s, "forearm_piece_fresh", facing(0, 0, true, 0.32));
    s.push(Step::Wait(150));
    close_on(&mut s, "forearm_piece", facing(0, 0, true, 0.35));
    shot(&mut s, "forearm_wide", stump(0, 0, false), babylon(0.4, 0.3, -1.2));

    // 2. Three chops into the groundskeeper's left thigh (260 J to go through; each blow goes on from the last).
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 1);
        let p = between(w, who, "upperleg01.L", "lowerleg01.L", 0.5);
        let mut off = false;
        let t = std::time::Instant::now();
        for _ in 0..3 {
            off = dismember::chop(w, who, p, babylon(1.0, -0.2, 0.0).normalize(), 120.0) || off;
        }
        log(w, json!({ "event": "chop", "what": "thigh", "off": off, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(2));
    close_on(&mut s, "thigh_stump_fresh", facing(1, 0, false, 0.4));
    s.push(Step::Wait(180));
    close_on(&mut s, "thigh_stump", facing(1, 0, false, 0.45));
    close_on(&mut s, "thigh_piece", facing(1, 0, true, 0.45));

    // 3. Two chops through the young man's neck (120 J).
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 2);
        let p = between(w, who, "neck01", "head", 0.9);
        let mut off = false;
        let t = std::time::Instant::now();
        for _ in 0..2 {
            off = dismember::chop(w, who, p, babylon(-1.0, 0.0, 0.2).normalize(), 90.0) || off;
        }
        log(w, json!({ "event": "chop", "what": "neck", "off": off, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(2));
    close_on(&mut s, "neck_stump_fresh", facing(2, 0, false, 0.35));
    close_on(&mut s, "head_fresh", facing(2, 0, true, 0.35));
    s.push(Step::Wait(180));
    close_on(&mut s, "neck_stump", facing(2, 0, false, 0.4));
    close_on(&mut s, "head", facing(2, 0, true, 0.4));

    }
    if all || part == "belly" {
    // 4. A shotgun's charge at contact range into the man in the hood's belly: its pellets one mass (1.45 kJ, the wad's
    // width), which blows the wall open.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 3);
        let p = between(w, who, "spine03", "spine03", 0.0) + babylon(0.03, -0.02, 0.0);
        let dir = babylon(0.0, 0.0, 1.0);
        // (weapons.rs's charge, half a metre from the muzzle: nine pellets' energy less a twentieth, one mass.)
        let m = crate::wounds::Missile { energy: 170.0 * 9.0 * 0.95, mass: 0.0035 * 9.0, speed: Some(400.0), calibre: 0.022, channel: 0.024, soft: 42.0, hard: 120.0,
                                         name: Some("charge".into()), ..default() };
        let t = std::time::Instant::now();
        let r = npc::with(w, who, |npc| crate::wounds::pierce(npc, p - dir * 0.6, dir, &m, 1.2).energy);
        taken(w);
        let ms = t.elapsed().as_secs_f32() * 1000.0;
        let opened = viscera::openings(w, who);
        log(w, json!({ "event": "charge", "left": r, "ms": ms, "opened": opened }));
    })));
    s.push(Step::Wait(3));
    shot(&mut s, "belly_blown_fresh", move |w| {
        let who = person_at(w, 3);
        viscera::opening_world(w, who, 0).map(|(at, _)| at)
    }, babylon(0.05, 0.12, -0.38));
    s.push(Step::Wait(240));
    close_on(&mut s, "belly_blown", move |w: &mut World| {
        let who = person_at(w, 3);
        let (at, n) = viscera::opening_world(w, who, 0)?;
        let off = (n * 0.4 + Vec3::Y * 0.15).normalize() * 0.42;
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off + Vec3::Y * 0.1;
        }
        None
    });

    // 5. A knife drawn across the old man's belly, 4 cm deep: through the wall, a long cut that gapes.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 0);
        let centre = between(w, who, "spine03", "spine03", 0.0);
        let dir = babylon(0.0, 0.0, 1.0);
        let t = std::time::Instant::now();
        let hits: Vec<npc::Crossing> = (0..9)
            .filter_map(|k| {
                let x = (k as f32 - 4.0) * 0.022;
                let from = centre + babylon(x, -0.01 + 0.002 * k as f32, 0.0) - dir * 0.5;
                npc::with(w, who, |npc| npc.surface(from, dir, 1.0, false).into_iter().find(|h| h.kind == Kind::Skin)).flatten()
            })
            .collect();
        let opened = viscera::slashed(w, who, &hits, 0.04);
        log(w, json!({ "event": "slash", "crossings": hits.len(), "opened": opened, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(3));
    close_on(&mut s, "belly_slit_fresh", move |w: &mut World| {
        let who = person_at(w, 0);
        let k = viscera::openings(w, who).saturating_sub(1);
        let (at, n) = viscera::opening_world(w, who, k)?;
        let off = (n + Vec3::Y * 0.3).normalize() * 0.4;
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off + Vec3::Y * 0.1;
        }
        None
    });
    s.push(Step::Wait(300));
    close_on(&mut s, "belly_slit", move |w: &mut World| {
        let who = person_at(w, 0);
        let k = viscera::openings(w, who).saturating_sub(1);
        let (at, n) = viscera::opening_world(w, who, k)?;
        let off = (n * 0.5 + Vec3::Y * 0.6).normalize() * 0.5;
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off + Vec3::Y * 0.1;
        }
        None
    });

    }
    if all || part == "bones" {
    // 6. The man in the hood's left shin broken by a bat, then bent at the break until its end comes through the skin.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 3);
        let p = between(w, who, "lowerleg01.L", "foot.L", 0.5);
        let dir = babylon(0.0, 0.0, 1.0);
        let t = std::time::Instant::now();
        npc::with(w, who, |npc| {
            if let Some(skin) = npc.surface(p - dir * 0.4, dir, 0.6, false).into_iter().find(|h| h.kind == Kind::Skin) {
                crate::wounds::blow(npc, skin.point, dir, 0.79, 15.5, None);
                crate::wounds::blow(npc, skin.point, dir, 0.79, 18.0, None);
            }
            npc.bones().opens(|seg| if seg.starts_with("shin2") { 80.0 } else { 0.0 });
        });
        taken(w);
        let breaks: Vec<String> = w.get::<npc::Hurt>(who).unwrap().bones.breaks.iter().map(|b| format!("{} {} {}", b.part, b.r#type, if b.through { "through" } else { "" })).collect();
        log(w, json!({ "event": "shin", "breaks": breaks, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(3));
    close_on(&mut s, "shin_open", move |w: &mut World| {
        let who = person_at(w, 3);
        let at = between(w, who, "lowerleg01.L", "foot.L", 0.5);
        let off = babylon(0.25, 0.15, -0.3);
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off + Vec3::Y * 0.1;
        }
        None
    });

    // 7. A bat on the groundskeeper's head: the skull broken.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 1);
        let p = between(w, who, "head", "head", 0.0) + babylon(0.0, 0.08, 0.0);
        let dir = babylon(0.0, -0.3, 1.0).normalize();
        npc::with(w, who, |npc| {
            if let Some(skin) = npc.surface(p - dir * 0.4, dir, 0.6, false).into_iter().find(|h| h.kind == Kind::Skin) {
                crate::wounds::blow(npc, skin.point, dir, 1.2, 20.0, Some(crate::wounds::Tool::Named("hammer")));
            }
        });
        taken(w);
        let breaks: Vec<String> = w.get::<npc::Hurt>(who).unwrap().bones.breaks.iter().map(|b| format!("{} {}", b.part, b.r#type)).collect();
        log(w, json!({ "event": "skull", "breaks": breaks }));
    })));
    s.push(Step::Wait(30));

    // 8. Everyone seen through: the breaks in the x-ray, the hurt parts in their hurt look.
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = true)));
    s.push(Step::Wait(2));
    close_on(&mut s, "xray_shin", move |w: &mut World| {
        let who = person_at(w, 3);
        let at = between(w, who, "lowerleg01.L", "foot.L", 0.5);
        let off = babylon(0.3, 0.1, -0.35);
        look(w, at, at + off);
        let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
        for mut t in q.iter_mut(w) {
            t.translation = at + off + Vec3::Y * 0.1;
        }
        None
    });
    close_on(&mut s, "xray_skull", move |w: &mut World| {
        let who = person_at(w, 1);
        let rd = w.get::<Ragdoll>(who)?;
        let at = rd.segs[rd.by_name("head")].now.translation + Vec3::Y * 0.08;
        let off = Vec3::new(0.0, 0.35, 0.25);
        look(w, at, at + off);
        None
    });
    s.extend(crate::scenario::view("xray_all", 0.0, -1.5, [0.0, 0.6, 2.2], 1.65));
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Seeing>().0 = false)));
    }
    if all || part == "limbs" {
    // 9. A grenade (0.25 kg of TNT) at the young man's feet, now lying headless: what a blast costs.
    s.push(Step::Do(Box::new(|w: &mut World| {
        let who = person_at(w, 2);
        let at = w.get::<Ragdoll>(who).map(|rd| rd.segs[rd.by_name("footL")].now.translation).unwrap_or_default() + Vec3::new(0.2, 0.0, 0.0);
        let t = std::time::Instant::now();
        let gone = dismember::blast(w, who, at, 0.25);
        taken(w);
        log(w, json!({ "event": "blast", "gone": gone, "ms": t.elapsed().as_secs_f32() * 1000.0 }));
    })));
    s.push(Step::Wait(60));
    s.extend(crate::scenario::view("after", 0.0, -1.0, [0.0, 0.3, 2.2], 1.65));
    }
    s
}
