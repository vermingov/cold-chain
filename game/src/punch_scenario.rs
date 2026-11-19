// `cargo run -- --scenario punch-damage --out <dir>`: what one punch does to someone unhurt, counted over many.
//
// Each of the line-up (the 78-year-old first) is punched twenty times in each way: quick (a tap: a jab) and charged (a
// full second's wind-up); with the bare fists, in boxing gloves and in knuckle dusters (worn.rs); at the face, the jaw
// and the chest. Each lands as a thrown punch lands (fist.rs `landing`, what is worn and its tool, wounds.rs `blow`),
// from straight in front a little above, on a point scattered about the aim as real punches are (the face: brows, eyes,
// nose and cheeks; the jaw: chin and both sides; the chest: over the breastbone and the ribs either side). After each,
// the person is put back as they were (bones, teeth, eyes, skin, vitals), so every punch is the first: what is counted
// is how often one punch breaks a bone, bruises, splits the skin or knocks out, not what twenty in a row do. The numbers
// are in the log, one line for each person, way and target.

use bevy::prelude::*;
use serde_json::json;

use crate::scenario::{log, Step};

const TIMES: usize = 20;

// Where each target is aimed (the person's own frame: x to their left, y up, z ahead) and how far the punches scatter
// about it, m.
fn aim(npc: &crate::npc::Npc, target: &str) -> (Vec3, Vec3, Vec3) {
    let head = npc.segment_world(npc.segment("head").unwrap());
    let ahead = head.rotation * Vec3::NEG_Z;
    let bone = |n: &str, tail: bool| {
        let b = npc.bone_index(n);
        let bone = &npc.body().bones[b];
        npc.world_of(if tail { bone.tail } else { bone.head }, b, None).0
    };
    match target {
        // (Between the eyes and a little down: the nose's bridge; the scatter takes in the brows and the cheeks.)
        "face" => ((bone("eye.L", false) + bone("eye.R", false)) / 2.0 - Vec3::Y * 0.015, Vec3::new(0.03, 0.03, 0.0), ahead),
        // (The point of the chin is the jaw bone's end; aimed a little above it, so that the scatter stays on the jaw and
        // not under it on the throat.)
        "jaw" => (bone("jaw", true) + Vec3::Y * 0.025, Vec3::new(0.04, 0.01, 0.0), ahead),
        _ => {
            let chest = npc.segment_world(npc.segment("chest").unwrap());
            (chest.translation, Vec3::new(0.06, 0.05, 0.0), chest.rotation * Vec3::NEG_Z)
        }
    }
}

pub fn steps() -> Vec<Step> {
    let mut s = vec![Step::Wait(120)];
    for n in 0..crate::sandbox::BODIES.len() {
        s.push(Step::Do(Box::new(move |w: &mut World| battery(w, n))));
        s.push(Step::Wait(5));
    }
    s
}

fn battery(w: &mut World, n: usize) {
    let mut q = w.query::<(Entity, &crate::person::Person)>();
    let mut people: Vec<_> = q.iter(w).map(|(e, p)| (e, p.body.name.clone())).collect();
    people.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.1));
    let Some(&(who, _)) = people.get(n) else { return };
    let mut lines = Vec::new();
    crate::npc::with(w, who, |npc| {
        // (The same scatter for everyone: a small generator of its own, not the game's dice, which the blows use.)
        let mut seed = 0x2545_f491_u32;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as f32 / u32::MAX as f32) * 2.0 - 1.0
        };
        for key in ["fists", "gloves", "dusters"] {
            let (worn, tool) = crate::worn::wear(key);
            for (how, charge) in [("quick", 0.0), ("charged", 1.0)] {
                let (mass, speed) = crate::fist::landing(charge);
                for target in ["face", "jaw", "chest"] {
                    let (mut broke, mut bruised, mut split, mut out, mut missed) = (0, 0, 0, 0, 0);
                    let (mut force, mut what) = (0.0, std::collections::BTreeMap::<String, usize>::new());
                    for _ in 0..TIMES {
                        let (at, spread, ahead) = aim(npc, target);
                        let to = at + Vec3::new(next() * spread.x, next() * spread.y, 0.0);
                        // (From in front, a little down: the fist comes from the shoulder.)
                        let dir = (-ahead - Vec3::Y * 0.05).normalize();
                        let Some(c) = crate::weapons::surface(npc, to - dir * 0.25, dir, 0.5) else {
                            missed += 1;
                            continue;
                        };
                        let saved = (npc.hurt.bones.clone(), npc.hurt.teeth.clone(), npc.hurt.eyes.clone(), npc.hurt.bruise.clone(),
                                     npc.hurt.hurt.clone(), npc.hurt.happened.len(), npc.vitals.clone());
                        let (breaks, splits) = (npc.hurt.bones.breaks.len(), npc.hurt.bruise.splits.len());
                        let leak: f32 = npc.hurt.bruise.leak.iter().sum();
                        force += crate::wounds::blow(npc, c.point, dir, mass + worn, speed, Some(tool));
                        let new = &npc.hurt.bones.breaks[breaks..];
                        if !new.is_empty() {
                            broke += 1;
                            for b in new {
                                *what.entry(format!("{} ({})", b.part, b.r#type)).or_default() += 1;
                            }
                        }
                        bruised += (npc.hurt.bruise.leak.iter().sum::<f32>() > leak) as usize;
                        split += (npc.hurt.bruise.splits.len() > splits) as usize;
                        out += (npc.vitals.out > 0.0) as usize;
                        let (bones, teeth, eyes, bruise, hurt, happened, vitals) = saved;
                        (npc.hurt.bones, npc.hurt.teeth, npc.hurt.eyes, npc.hurt.bruise, npc.hurt.hurt) = (bones, teeth, eyes, bruise, hurt);
                        npc.hurt.happened.truncate(happened);
                        *npc.vitals = vitals;
                    }
                    let landed = (TIMES - missed).max(1);
                    lines.push(json!({ "event": "punches", "person": npc.person.label, "age": npc.hurt.bones.age, "with": key, "how": how,
                                       "at": target, "mass": mass + worn, "speed": speed, "newtons": force / landed as f32, "landed": TIMES - missed,
                                       "broke": broke, "bruised": bruised, "split": split, "knocked_out": out, "breaks": what }));
                }
            }
        }
    });
    for l in lines {
        log(w, l);
    }
}

// `--scenario punch-look`: how a punch looks from the thrower's eyes, frame by frame. Bare and gloved, the left and the
// right, a tap and a full wind-up, each thrown down the empty hall from the guard (a picture as it is let go, then one
// every frame for the half second it takes to go out and come back, `{fist}_{side}_{how}_{frame}`); and a full right
// thrown at a face (`{fist}_face_right_{frame}`), to see it land and come off.
pub fn look() -> Vec<Step> {
    let mut s = Vec::new();
    for key in ["fists", "gloves"] {
        s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::take(w, key))));
        s.push(Step::Wait(30));
        for (side, button) in [("left", 0u8), ("right", 2u8)] {
            for (how, held) in [("quick", 2u32), ("charged", 60)] {
                s.extend(crate::scenario::view(&format!("{key}_{side}_{how}_guard"), 0.0, -2.0, [0.0, 1.5, -10.0], 1.65));
                s.push(Step::Wait(20));
                s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::press(w, button))));
                s.push(Step::Wait(held));
                s.push(Step::Shot(format!("{key}_{side}_{how}_00")));
                s.push(Step::Do(Box::new(move |w: &mut World| crate::warm::release(w, button))));
                for f in 1..=30 {
                    s.push(Step::Wait(1));
                    s.push(Step::Shot(format!("{key}_{side}_{how}_{f:02}")));
                }
                s.push(Step::Wait(40));
            }
        }
        // At a face: the young man, from 55 cm off his head, looking him in the eyes.
        s.push(Step::Do(Box::new(|w: &mut World| {
            if let Some((_, at)) = crate::warm::aim(w, 2, "head", 0.55) {
                w.resource_scope(|w, map: Mut<crate::map::Map>| {
                    for mut p in w.query::<&mut crate::player::Player>().iter_mut(w) {
                        p.spawn(&map, at.x, at.z + 0.55, Some(at + Vec3::Y * 0.13), 1.65);
                    }
                });
            }
        })));
        s.push(Step::Wait(30));
        s.push(Step::Do(Box::new(|w: &mut World| crate::warm::press(w, 2))));
        s.push(Step::Wait(60));
        s.push(Step::Shot(format!("{key}_face_right_00")));
        s.push(Step::Do(Box::new(|w: &mut World| crate::warm::release(w, 2))));
        for f in 1..=24 {
            s.push(Step::Wait(1));
            s.push(Step::Shot(format!("{key}_face_right_{f:02}")));
        }
        s.push(Step::Wait(40));
        s.push(Step::Do(Box::new(|w: &mut World| {
            use bevy::ecs::system::RunSystemOnce;
            let _ = w.run_system_once(crate::sandbox::reset);
        })));
        s.push(Step::Wait(60));
    }
    s
}
