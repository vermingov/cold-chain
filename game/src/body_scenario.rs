// The player's body and what they hold, in the world (BACKLOG items 1 and 2): checks.
//
// - `body-push`: walking and running into people standing in the line-up, and leaning into one for a few seconds. Logs
//   the player's pace and where they are, each person's middle and what their balance does, and how near the player's
//   line came to the person's (no passing through).
// - `body-press`: the pistol walked up against a chest and fired there (where the muzzle was, how far off the skin, where
//   the shot went in and with what range for the powder), then against a wall and fired; the rifle walked into a wall.
// - `body-melee`: each blade and tool swung and stabbed with a wall a step ahead (nothing should be met, and the head or
//   the blade should stay out of the wall), and swung at a person close by and beside one's head.
// - `body-jump`: a jump on the spot (how high, how long), Space again in the air (nothing), onto the half-metre crate,
//   and walking over and jumping over a body lying on the floor.
//
// Positions here are Bevy's.

use bevy::prelude::*;
use serde_json::{json, Value};

use crate::behaviour::Behaviour;
use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::scenario::{log, Step};
use crate::weapons::{Act, Hand, Weapons};

// The player at (x, z), eye `eye` over the floor, looking at `toward`.
fn put(x: f32, z: f32, toward: Vec3, eye: f32) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        w.resource_scope(|w, map: Mut<crate::map::Map>| {
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                p.spawn(&map, x, z, Some(toward), eye);
            }
        });
    }))
}

fn keys(down: &'static [KeyCode], up: &'static [KeyCode]) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let mut k = w.resource_mut::<ButtonInput<KeyCode>>();
        for c in up {
            k.release(*c);
        }
        for c in down {
            k.press(*c);
        }
    }))
}

fn reset() -> Step {
    Step::Do(Box::new(|w: &mut World| {
        use bevy::ecs::system::RunSystemOnce;
        let _ = w.run_system_once(crate::sandbox::reset);
    }))
}

// The people in line-up order (west to east).
fn people(w: &mut World) -> Vec<Entity> {
    let mut q = w.query::<(Entity, &Person)>();
    let mut v: Vec<_> = q.iter(w).map(|(e, p)| (e, p.body.name.clone())).collect();
    v.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.1));
    v.into_iter().map(|p| p.0).collect()
}

// Where the player and person `n` are, and how fast; what the person's balance is doing; the held thing pulled back.
fn sample(w: &mut World, tag: &str, n: usize) -> Value {
    let p = w.query::<&Player>().iter(w).next().map(|p| (p.pos, p.vel, p.height, p.falling, p.body)).unwrap();
    let body = p.4.and_then(|b| w.get::<Transform>(b).map(|t| t.translation));
    let who = people(w).get(n).copied();
    let them = who.and_then(|e| {
        let rd = w.get::<Ragdoll>(e)?;
        let chest = rd.segs[rd.by_name("chest")].now.translation;
        let (com, v) = (rd.com(), rd.com_velocity());
        let b = w.get::<Behaviour>(e)?;
        // (How near the player's line came to their chest's: under the body's half width plus the chest's, through them.)
        let apart = Vec2::new(chest.x, chest.z).distance(p.0);
        Some(json!({ "com": com.to_array(), "speed": v.length(), "state": format!("{:?}/{:?}", b.state, b.mode), "apart": apart }))
    });
    let h = w.resource::<Hand>();
    json!({ "tag": tag, "pos": p.0.to_array(), "speed": p.1.length(), "height": p.2, "falling": p.3, "body": body.map(|b| b.to_array()),
            "back": h.back, "tilt": h.tilt, "against": h.against.map(|a| a.1.to_array()), "person": them })
}

fn note(tag: &'static str, n: usize) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let v = sample(w, tag, n);
        log(w, json!({ "event": "sample", "at": v }));
    }))
}

// Samples every `every` frames for `frames`.
fn watch(s: &mut Vec<Step>, tag: &'static str, n: usize, frames: u32, every: u32) {
    for _ in 0..frames / every {
        s.push(Step::Wait(every));
        s.push(note(tag, n));
    }
}

// The muzzle (or point) of what is held in the world, the way it points, and the first skin of anyone along it from 30 cm
// behind the muzzle: how far the muzzle is off that skin (less than nothing: in it).
fn muzzle(w: &mut World, tag: &str) {
    let key = w.resource::<Weapons>().arm().key;
    let eye = *w.query_filtered::<&Transform, With<Player>>().iter(w).next().unwrap();
    let h = w.resource::<Hand>();
    let Some(tip) = h.anchors.get(key).map(|a| a.tip) else { return };
    let hand = h.world(&eye);
    let (at, dir) = (hand.transform_point(tip), hand.rotation * Vec3::NEG_Z);
    let (back, tilt) = (h.back, h.tilt);
    let mut skin: Option<(f32, String)> = None;
    for e in people(w) {
        let label = w.get::<Person>(e).unwrap().label.clone();
        if let Some(c) = crate::npc::with(w, e, |n| crate::weapons::surface(n, at - dir * 0.3, dir, 1.0)).flatten() {
            if skin.as_ref().is_none_or(|s| c.t - 0.3 < s.0) {
                skin = Some((c.t - 0.3, label));
            }
        }
    }
    log(w, json!({ "event": "muzzle", "tag": tag, "key": key, "at": at.to_array(), "dir": dir.to_array(), "skin_ahead": skin.map(|s| json!([s.0, s.1])),
                    "back": back, "tilt": tilt }));
}

fn hits(tag: &'static str) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let hits = std::mem::take(&mut w.resource_mut::<Weapons>().log);
        log(w, json!({ "event": "hits", "tag": tag, "hits": hits }));
    }))
}

fn act(a: Act) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let mut wp = w.resource_mut::<Weapons>();
        wp.busy = 0.0;
        wp.queue.push(a);
    }))
}

// A picture from beside the player (the hands and what they hold seen from the right and a little ahead).
fn side(s: &mut Vec<Step>, name: String) {
    let off = Transform::from_xyz(0.7, 0.0, -0.25).looking_at(Vec3::new(0.0, -0.15, -0.55), Vec3::Y);
    s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<crate::weapons::Aside>().0 = Some(off))));
    s.push(Step::Wait(1));
    s.push(Step::Shot(name));
    s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::weapons::Aside>().0 = None)));
}

const W: KeyCode = KeyCode::KeyW;
const SHIFT: KeyCode = KeyCode::ShiftLeft;
const SPACE: KeyCode = KeyCode::Space;

pub fn steps(name: &str) -> Vec<Step> {
    let mut s = vec![Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::graphics::Graphics>().level = 4.0))];
    let line = |i: usize| -2.25 + 1.5 * i as f32; // the line-up's x, at z = -2.2
    match name {
        "push" => {
            s.push(Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "hands"))));
            s.push(Step::Wait(90));
            // Walked into the second person from 2.4 m, then on into them for two seconds.
            s.push(put(line(1), 0.2, Vec3::new(line(1), 1.3, -2.2), 1.65));
            s.push(Step::Wait(2));
            s.push(note("walk: start", 1));
            s.push(keys(&[W], &[]));
            watch(&mut s, "walk", 1, 150, 6);
            s.push(Step::Shot("push_walk_contact".into()));
            watch(&mut s, "walk: leaning", 1, 120, 10);
            s.push(Step::Shot("push_walk_after".into()));
            s.push(keys(&[], &[W]));
            watch(&mut s, "walk: let go", 1, 120, 20);
            // Run into the third.
            s.push(put(line(2), 0.6, Vec3::new(line(2), 1.3, -2.2), 1.65));
            s.push(Step::Wait(2));
            s.push(keys(&[W, SHIFT], &[]));
            watch(&mut s, "run", 2, 90, 3);
            s.push(Step::Shot("push_run_contact".into()));
            s.push(keys(&[], &[W, SHIFT]));
            watch(&mut s, "run: after", 2, 180, 10);
            s.push(Step::Shot("push_run_after".into()));
            // Seen from the side: the fourth walked into from the south, the camera off to the east.
            s.push(reset());
            s.push(Step::Wait(90));
            s.push(put(line(3), 0.0, Vec3::new(line(3), 1.3, -2.2), 1.65));
            s.push(Step::Wait(2));
            s.push(keys(&[W], &[]));
            watch(&mut s, "walk 4th", 3, 100, 10);
            s.push(Step::Do(Box::new(|w: &mut World| {
                let off = Transform::from_xyz(1.6, 0.0, 0.6).looking_at(Vec3::new(0.0, -0.6, -0.6), Vec3::Y);
                w.resource_mut::<crate::weapons::Aside>().0 = Some(off);
            })));
            s.push(Step::Wait(1));
            s.push(Step::Shot("push_side".into()));
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<crate::weapons::Aside>().0 = None)));
            s.push(keys(&[], &[W]));
            watch(&mut s, "walk 4th: after", 3, 60, 10);
        }
        "press" => {
            s.push(Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "pistol"))));
            s.push(Step::Wait(90));
            // Up to the second person's chest from 1.4 m.
            s.push(put(line(1), -0.8, Vec3::new(line(1), 1.3, -2.2), 1.65));
            s.push(Step::Wait(30));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "chest: at rest"))));
            s.push(keys(&[W], &[]));
            for _ in 0..12 {
                s.push(Step::Wait(5));
                s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "chest: walking in"))));
            }
            s.push(keys(&[], &[W]));
            s.push(Step::Wait(10));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "chest: pressed"))));
            s.push(note("chest: pressed", 1));
            s.push(Step::Shot("press_chest".into()));
            side(&mut s, "press_chest_side".into());
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Weapons>().log.clear())));
            s.push(act(Act::Press(0)));
            s.push(Step::Wait(1));
            s.push(act(Act::Release(0)));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "chest: fired"))));
            s.push(hits("chest: fired"));
            s.push(Step::Wait(20));
            s.push(Step::Shot("press_chest_fired".into()));
            // At the south wall (Bevy z = 11), walked into it, and fired.
            s.push(reset());
            s.push(put(3.0, 9.6, Vec3::new(3.0, 1.4, 11.0), 1.65));
            s.push(Step::Wait(20));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "wall: at rest"))));
            s.push(keys(&[W], &[]));
            s.push(Step::Wait(70));
            s.push(keys(&[], &[W]));
            s.push(Step::Wait(10));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "wall: pressed"))));
            s.push(note("wall: pressed", 0));
            s.push(Step::Shot("press_wall".into()));
            side(&mut s, "press_wall_side".into());
            s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Weapons>().log.clear())));
            s.push(act(Act::Press(0)));
            s.push(Step::Wait(1));
            s.push(act(Act::Release(0)));
            s.push(hits("wall: fired"));
            s.push(Step::Wait(20));
            // The rifle walked into the wall: pulled back, then the muzzle down.
            s.push(Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "rifle"))));
            s.push(put(3.0, 9.0, Vec3::new(3.0, 1.4, 11.0), 1.65));
            s.push(Step::Wait(30));
            s.push(keys(&[W], &[]));
            s.push(Step::Wait(80));
            s.push(keys(&[], &[W]));
            s.push(Step::Wait(15));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "rifle wall: pressed"))));
            s.push(Step::Shot("press_rifle_wall".into()));
            side(&mut s, "press_rifle_wall_side".into());
            // Backed off: it goes out again.
            s.push(keys(&[KeyCode::KeyS], &[]));
            s.push(Step::Wait(40));
            s.push(keys(&[], &[KeyCode::KeyS]));
            s.push(Step::Wait(30));
            s.push(Step::Do(Box::new(|w: &mut World| muzzle(w, "rifle wall: backed off"))));
        }
        "melee" => {
            for key in ["knife", "sword", "bat", "shovel", "sledge", "hammer"] {
                s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::take(w, key))));
                s.push(reset());
                // Facing the south wall from 0.45 m: a cut or blow, then a stab or one from overhead. Nothing to meet.
                s.push(put(3.0, 10.55, Vec3::new(3.0, 1.4, 11.0), 1.65));
                s.push(Step::Wait(40));
                s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Weapons>().log.clear())));
                for (button, what) in [(0, "wall: swing"), (2, "wall: other button")] {
                    s.push(act(Act::Press(button)));
                    s.push(Step::Wait(1));
                    s.push(act(Act::Release(button)));
                    // The deepest any point of its box went past the wall's face (z = 11 - the box is in the hand's frame).
                    for k in 0..30 {
                        s.push(Step::Wait(2));
                        s.push(Step::Do(Box::new(move |w: &mut World| {
                            let eye = *w.query_filtered::<&Transform, With<Player>>().iter(w).next().unwrap();
                            let h = w.resource::<Hand>();
                            let Some(&(lo, hi)) = h.boxes.get(key) else { return };
                            let hand = h.world(&eye);
                            let deepest = (0..8)
                                .map(|c| hand.transform_point(Vec3::new([lo.x, hi.x][c & 1], [lo.y, hi.y][(c >> 1) & 1], [lo.z, hi.z][c >> 2])).z - 11.0)
                                .fold(f32::MIN, f32::max);
                            let (back, tilt) = (h.back, h.tilt);
                            log(w, json!({ "event": "into wall", "key": key, "what": what, "k": k, "deepest": deepest, "back": back, "tilt": tilt }));
                        })));
                        if k == 6 {
                            s.push(Step::Shot(format!("melee_{key}_{button}_wall")));
                        }
                    }
                    s.push(hits(what));
                }
                // At the third person's belly from 0.55 m: swung (hits), then 0.6 m to one side of the head (nothing).
                s.push(put(line(2), -2.2 + 0.55 + 0.15, Vec3::new(line(2), 1.1, -2.2), 1.65));
                s.push(Step::Wait(30));
                s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Weapons>().log.clear())));
                s.push(act(Act::Press(0)));
                s.push(Step::Wait(1));
                s.push(act(Act::Release(0)));
                s.push(Step::Wait(8));
                s.push(Step::Shot(format!("melee_{key}_person")));
                s.push(Step::Wait(50));
                s.push(hits("person: swing"));
                s.push(reset());
                s.push(Step::Wait(30));
                s.push(put(line(2) + 0.6, -2.2 + 0.55, Vec3::new(line(2) + 0.6, 1.5, -2.2), 1.65));
                s.push(Step::Wait(30));
                s.push(Step::Do(Box::new(move |w: &mut World| w.resource_mut::<Weapons>().log.clear())));
                s.push(act(Act::Press(0)));
                s.push(Step::Wait(1));
                s.push(act(Act::Release(0)));
                s.push(Step::Wait(60));
                s.push(hits("beside a head: swing"));
            }
        }
        "jump" => {
            s.push(Step::Do(Box::new(|w: &mut World| crate::warm::take(w, "hands"))));
            s.push(put(0.0, 4.0, Vec3::new(0.0, 1.4, -2.0), 1.65));
            s.push(Step::Wait(10));
            s.push(keys(&[SPACE], &[]));
            for k in 0..50 {
                s.push(Step::Wait(1));
                s.push(note("jump", 0));
                if k == 18 {
                    s.push(Step::Shot("jump_top".into()));
                }
                // Space let go and pressed again in the air: nothing.
                if k == 10 {
                    s.push(keys(&[], &[SPACE]));
                }
                if k == 14 {
                    s.push(keys(&[SPACE], &[]));
                }
            }
            s.push(keys(&[], &[SPACE]));
            s.push(Step::Wait(20));
            // Onto the half-metre crate (TS x -6.2 to -5.7, z 4.6 to 5.1): walked at it from the south-east, jumping.
            s.push(put(-5.95, -3.6, Vec3::new(-5.95, 0.5, -4.85), 1.65));
            s.push(Step::Wait(10));
            s.push(keys(&[W], &[]));
            watch(&mut s, "walk at the crate", 0, 30, 5);
            s.push(keys(&[SPACE], &[]));
            watch(&mut s, "jump at the crate", 0, 60, 3);
            s.push(keys(&[], &[W, SPACE]));
            s.push(Step::Wait(20));
            s.push(note("on the crate?", 0));
            s.push(Step::Shot("jump_crate".into()));
            // A body on the floor: the second knocked down; walked over, then jumped over.
            s.push(put(line(1), 0.5, Vec3::new(line(1), 0.0, -2.2), 1.65));
            s.push(Step::Do(Box::new(|w: &mut World| {
                let who = people(w)[1];
                w.resource_scope(|w, mut rng: Mut<crate::rng::Rng>| {
                    let mut b = w.get_mut::<Behaviour>(who).unwrap();
                    b.knock_down(&mut rng);
                });
            })));
            s.push(Step::Wait(240));
            s.push(Step::Shot("jump_body_lying".into()));
            s.push(note("lying: before", 1));
            s.push(keys(&[W], &[]));
            watch(&mut s, "walk over", 1, 180, 10);
            s.push(keys(&[], &[W]));
            s.push(put(line(1), -4.5, Vec3::new(line(1), 0.0, -2.2), 1.65));
            s.push(Step::Wait(30));
            s.push(note("lying: before the jump", 1));
            s.push(keys(&[W], &[]));
            s.push(Step::Wait(50));
            s.push(keys(&[SPACE], &[]));
            watch(&mut s, "jump over", 1, 90, 5);
            s.push(keys(&[], &[W, SPACE]));
        }
        _ => {}
    }
    s
}
