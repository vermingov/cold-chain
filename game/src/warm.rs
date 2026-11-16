// Every render pipeline the game will need, made while the loading screen is up rather than the first time something
// is seen or happens (src/sandbox/warm.ts). In the TS a shader compiled on first use froze frames (the first head shot);
// in Bevy a pipeline still compiling leaves what needs it undrawn for those frames instead (a wound, a held gun, the
// x-ray missing for a moment), and in a scenario (synchronous compilation) it holds the frame up as the TS's did.
//
// A pipeline is made for each mix of material, mesh layout and view that is drawn, when it is first drawn in view: so the
// people are put through what happens to people once, off the clock, behind the loading screen, in front of the camera,
// waiting for the pipelines after each step (each step's mix is its own pipeline; the cache keeps them, so the next
// people find them made), and then the room is reset as K resets it. The list is anyone's to add to: whatever a job
// draws only after an event (a cut's faces, blood on the floor, a dressing, the x-ray) adds the event here.
//
//     warm::add(app, "the floor's blood", 4, |w: &mut World| { ... });   // say what it is, frames to wait at least, do it
//
// `Pipelines` counts the pipelines made (the render world's own count, sent back), and what each new one was made for;
// the `warm` scenario plays a fight after the warm-up and logs how many were made during it, which should be none.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use bevy::ecs::system::RunSystemOnce;
use bevy::prelude::*;
use bevy::render::render_resource::PipelineCache;
use bevy::render::{Render, RenderApp, RenderSystems};

use crate::player::Player;
use crate::weapons::{Act, Weapons};

pub type Rehearse = Box<dyn FnMut(&mut World) + Send + Sync>;

// The pipelines made so far, and those still being made (the render world's PipelineCache, read after each frame is
// drawn), and, when `note` is on, what each new one was for.
#[derive(Resource, Clone, Default)]
pub struct Pipelines {
    pub made: Arc<AtomicUsize>,
    pub waiting: Arc<AtomicUsize>,
    pub note: Arc<AtomicBool>,
    pub new: Arc<Mutex<Vec<String>>>,
}

#[derive(Resource, Default)]
pub struct Warm {
    list: Vec<(String, u32, Rehearse)>,
    // Whether it runs at all (the game, and the `warm` scenario; other scenarios start as they were), where it is, and
    // since when nothing has been waiting.
    pub on: bool,
    at: usize,
    frames: u32,
    quiet: u32,
    started: bool,
    pub done: bool,
    // What the player carried and where they stood, put back afterwards.
    carried: Option<([Option<&'static str>; 6], [Option<&'static str>; 12], usize)>,
    screen: Option<Entity>,
}

// A step of the warm-up: what the loading screen says, at least how many frames it is given, and what it does.
pub fn add(app: &mut App, say: &str, frames: u32, f: impl FnMut(&mut World) + Send + Sync + 'static) {
    app.world_mut().get_resource_or_init::<Warm>().list.push((say.to_string(), frames, Box::new(f)));
}

// Whether the game can start: warmed, or not warming.
pub fn ready(world: &World) -> bool {
    world.get_resource::<Warm>().is_none_or(|w| !w.on || w.done)
}

#[derive(Component)]
struct Screen;

// A frame of the warm-up, with the world in hand.
fn drive(world: &mut World) {
    let Some(mut warm) = world.get_resource_mut::<Warm>().map(|mut w| std::mem::take(&mut *w)) else { return };
    step(world, &mut warm);
    *world.resource_mut::<Warm>() = warm;
}

fn step(world: &mut World, warm: &mut Warm) {
    if !warm.on || warm.done {
        return;
    }
    if !warm.started {
        // Once the hall is up and everything it is made of is in (the scenario's own test), and the people are standing.
        let up = *world.resource::<State<crate::Loading>>().get() == crate::Loading::Done && crate::scenario::loaded(world);
        let people = world.query::<&crate::npc::Hurt>().iter(world).count() > 0;
        if !(up && people) {
            return;
        }
        warm.started = true;
        let w = world.resource::<Weapons>();
        warm.carried = Some((w.slots, w.bag, w.slot));
        let mut sound = world.resource_mut::<crate::sound::Sound>();
        sound.mute_direct = true;
        sound.mute_ring = true;
        warm.screen = Some(world.spawn((
            Screen,
            Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), justify_content: JustifyContent::Center,
                   align_items: AlignItems::Center, ..default() },
            BackgroundColor(Color::srgb(0.02, 0.02, 0.022)),
            GlobalZIndex(1000),
            Text::new("Preparing shaders: the hall."),
            TextColor(Color::srgb(0.75, 0.72, 0.66)),
        )).id());
        warm.frames = 0;
        info!("warm-up: {} steps", warm.list.len());
        return;
    }
    warm.frames += 1;
    let p = world.resource::<Pipelines>().clone();
    let waiting = p.waiting.load(Ordering::SeqCst);
    warm.quiet = if waiting == 0 { warm.quiet + 1 } else { 0 };
    let least = if warm.at == 0 { 2 } else { warm.list.get(warm.at - 1).map_or(2, |s| s.1) };
    // Each step given its frames, and then until nothing has been waiting for two frames running (a pipeline is asked for
    // in the frame after what needs it is first seen).
    if warm.frames < least || warm.quiet < 3 {
        return;
    }
    warm.frames = 0;
    warm.quiet = 0;
    if warm.at < warm.list.len() {
        let (say, _, f) = &mut warm.list[warm.at];
        info!("warm-up: {say} ({} pipelines so far)", p.made.load(Ordering::SeqCst));
        if let Some(mut t) = warm.screen.and_then(|e| world.get_mut::<Text>(e)) {
            t.0 = format!("Preparing shaders: {say}.");
        }
        f(world);
        warm.at += 1;
        return;
    }
    if warm.at == warm.list.len() {
        // Whatever happened in the rehearsal, the room is put back as it was: new people, what was carried, the player
        // where the game starts them.
        let _ = world.run_system_once(crate::sandbox::reset);
        if let Some((slots, bag, slot)) = warm.carried {
            let mut w = world.resource_mut::<Weapons>();
            w.slots = slots;
            w.bag = bag;
            w.queue.push(Act::Select(slot));
        }
        world.resource_scope(|world, map: Mut<crate::map::Map>| {
            for mut p in world.query::<&mut Player>().iter_mut(world) {
                p.spawn(&map, 0.0, 4.0, Some(crate::babylon(0.0, 1.4, 2.0)), 1.65);
            }
        });
        if let Some(mut t) = warm.screen.and_then(|e| world.get_mut::<Text>(e)) {
            t.0 = "Preparing shaders: the people.".into();
        }
        warm.at += 1;
        return;
    }
    if let Some(e) = warm.screen.take() {
        world.despawn(e);
    }
    let mut sound = world.resource_mut::<crate::sound::Sound>();
    sound.mute_direct = false;
    sound.mute_ring = false;
    warm.done = true;
    info!("warm-up done: {} pipelines", p.made.load(Ordering::SeqCst));
}

// The render world's count, after each frame is drawn; with `note` on, what each pipeline made since the last look was
// for (its label and its vertex shader's switches).
fn count(cache: Res<PipelineCache>, p: Res<Pipelines>, mut seen: Local<usize>) {
    let n = cache.pipelines().count();
    if p.note.load(Ordering::SeqCst) && n > *seen {
        let mut new = p.new.lock().unwrap();
        for c in cache.pipelines().skip(*seen) {
            new.push(describe(&c.descriptor));
        }
    }
    *seen = n;
    p.made.store(n, Ordering::SeqCst);
    p.waiting.store(cache.waiting_pipelines().count(), Ordering::SeqCst);
}

fn describe(d: &bevy::render::render_resource::PipelineDescriptor) -> String {
    use bevy::render::render_resource::PipelineDescriptor as D;
    let (label, defs) = match d {
        D::RenderPipelineDescriptor(r) => (r.label.clone(), r.vertex.shader_defs.iter().map(|d| format!("{d:?}")).collect::<Vec<_>>()),
        D::ComputePipelineDescriptor(c) => (c.label.clone(), c.shader_defs.iter().map(|d| format!("{d:?}")).collect()),
        D::MeshPipelineDescriptor(m) => (m.label.clone(), Vec::new()),
    };
    format!("{} {}", label.unwrap_or_default(), defs.join(" "))
}

// --- what is rehearsed here (everything on this branch that is drawn only after an event) -----------------------------

// The player `far` in front of segment `part` of the `n`th person (the line-up's order), looking at it.
pub fn aim(w: &mut World, n: usize, part: &str, far: f32) -> Option<(Entity, Vec3)> {
    let mut q = w.query::<(Entity, &crate::person::Person, &crate::ragdoll::Ragdoll)>();
    let mut people: Vec<_> = q.iter(w).map(|(e, p, rd)| (e, p.body.name.clone(), rd.segs.iter().find(|s| s.def.name == part).map(|s| s.now.translation))).collect();
    people.sort_by_key(|p| crate::sandbox::BODIES.iter().position(|b| *b == p.1));
    let (e, _, at) = people.into_iter().nth(n)?;
    let at = at?;
    w.resource_scope(|w, map: Mut<crate::map::Map>| {
        for mut p in w.query::<&mut Player>().iter_mut(w) {
            p.spawn(&map, at.x, at.z + far, Some(at), 1.65);
        }
    });
    Some((e, at))
}

// `key` in the hand, ready and loaded.
pub fn take(w: &mut World, key: &'static str) {
    let mut wp = w.resource_mut::<Weapons>();
    wp.slots[0] = Some(key);
    wp.busy = 0.0;
    wp.reloading = 0.0;
    if let Some(r) = crate::weapons::arm(key).rounds {
        wp.ammo.insert(key, r);
    }
    wp.queue.push(Act::Select(0));
}

pub fn press(w: &mut World, button: u8) {
    let mut wp = w.resource_mut::<Weapons>();
    wp.busy = 0.0;
    wp.reloading = 0.0;
    wp.queue.push(Act::Press(button));
}

pub fn release(w: &mut World, button: u8) {
    w.resource_mut::<Weapons>().queue.push(Act::Release(button));
}

fn rehearse(app: &mut App) {
    add(app, "the hall", 2, |_| {});
    // Everything that can be held, in the hand (each its own models and materials, drawn over the room: held.wesl).
    for a in crate::weapons::ARMS.iter().filter(|a| !a.key.is_empty()) {
        let key = a.key;
        add(app, a.name, 3, move |w| {
            aim(w, 0, "chest", 2.6);
            take(w, key);
        });
    }
    // Each gun at someone (the shot, the flash, the case thrown, the hole in what is behind, the wound and the blood),
    // and the same shot put straight through them as well, in case the hands had not come round to it.
    let shots: [(&'static str, usize, &'static str, f32); 10] = [("pistol", 0, "chest", 2.6), ("m4", 0, "thighL", 2.6), ("ak", 1, "belly", 2.6),
        ("rifle", 1, "head", 2.6), ("shotgun", 2, "belly", 0.9), ("shotgun", 3, "chest", 5.0), ("pistol", 2, "upperarmR", 2.6),
        ("rifle", 3, "thighR", 2.6), ("deagle", 0, "belly", 2.6), ("r22", 2, "thighL", 2.6)];
    for (key, n, part, far) in shots {
        // (given time for the hands to come up and round to it: shot from below the view, the flash and the powder's
        // sparks would not be seen)
        add(app, crate::weapons::arm(key).name, 50, move |w| {
            take(w, key);
            aim(w, n, part, far);
        });
        add(app, crate::weapons::arm(key).name, 30, move |w| {
            let Some((who, at)) = aim(w, n, part, far) else { return };
            press(w, 0);
            let gun = crate::weapons::arm(key).gun.as_ref().unwrap();
            let m = gun.m.wounds();
            let from = at + Vec3::new(0.0, 0.0, far);
            crate::npc::with(w, who, |npc| crate::wounds::pierce(npc, from, (at - from).normalize(), &m, far + 1.0));
        });
        add(app, crate::weapons::arm(key).name, 4, |w| release(w, 0));
    }
    // A dressing on someone's wound (its gauze, port/skin).
    add(app, "a dressing", 4, |w| {
        let Some((who, _)) = aim(w, 0, "belly", 1.2) else { return };
        crate::npc::with(w, who, |npc| {
            if let Some(wound) = crate::dressing::wounds(npc).into_iter().next() {
                crate::dressing::dress(npc, &wound);
            }
        });
    });
    // A stab and a cut, a blow with the bat, a punch; a thing thrown, and the grenade.
    for (key, button, part, far) in [("knife", 0u8, "belly", 0.7), ("sword", 2, "forearmL", 0.7), ("bat", 0, "head", 0.7), ("fists", 2, "head", 0.5)] {
        add(app, "blades and blows", 3, move |w| {
            take(w, key);
            aim(w, 3, part, far);
        });
        add(app, "blades and blows", 20, move |w| press(w, button));
        add(app, "blades and blows", 30, move |w| release(w, button));
    }
    add(app, "things thrown", 3, |w| {
        take(w, "throw");
        aim(w, 1, "chest", 3.0);
    });
    add(app, "things thrown", 3, |w| press(w, 0));
    add(app, "things thrown", 60, |w| release(w, 0));
    add(app, "the grenade", 3, |w| {
        take(w, "grenade");
        aim(w, 3, "chest", 6.0);
    });
    add(app, "the grenade", 3, |w| press(w, 0));
    add(app, "the grenade", 300, |w| release(w, 0));
    // The face: an eye shot, teeth knocked out and broken, the tongue torn, blood in the mouth (eyes.rs, teeth.rs,
    // throat.rs's looks).
    add(app, "the face", 60, |w| {
        take(w, "hands");
        let Some((who, at)) = aim(w, 0, "head", 0.6) else { return };
        crate::npc::with(w, who, |npc| {
            let ahead = Vec3::Z;
            let m = crate::weapons::arm("shotgun").gun.as_ref().unwrap().m.wounds();
            let b = npc.bone_index("eye.R");
            let eye = npc.world_of(npc.body().bones[b].head, b, None).0;
            crate::wounds::pierce(npc, eye + ahead * 0.5, -ahead, &crate::wounds::Missile { name: Some("pellet".into()), ..m }, 1.0);
            if let Some((rest, owner)) = npc.hurt.throat.centre {
                let c = npc.world_of(rest, owner, None).0;
                npc.teeth().shot(c + ahead * 0.3, -ahead, 0.4);
                npc.teeth().blow(c + ahead * 0.02 + Vec3::X * 0.015, -ahead, 900.0, 0.01, true);
                if let Some(hit) = npc.surface(c + ahead * 0.3, -ahead, 0.4, true).into_iter().find(|h| h.kind == crate::npc::Kind::Tongue) {
                    npc.throat_tear(&hit, 0.009);
                }
            }
            npc.throat().take(crate::vitals::Into::Mouth, None, 30.0);
        });
        let _ = at;
    });
    // The body opened (port/cut): a forearm cut off by a blade and a shin by a shot (the cut faces, the caps, the
    // flesh round them), a belly torn open by a blast (the wall's cut faces and the organs out), a head off (a face on a
    // piece of its own); each seen.
    add(app, "limbs off", 6, |w| {
        if let Some((who, _)) = aim(w, 0, "forearmL", 1.4) {
            crate::dismember::sever(w, who, crate::dismember::Limb::Forearm, "L", None, None, crate::dismember::How::Blade);
        }
    });
    add(app, "limbs off", 6, |w| {
        if let Some((who, _)) = aim(w, 1, "shinR", 1.6) {
            crate::dismember::sever(w, who, crate::dismember::Limb::Shin, "R", None, None, crate::dismember::How::Shot);
        }
    });
    add(app, "the belly", 6, |w| {
        if let Some((who, at)) = aim(w, 2, "belly", 1.0) {
            crate::viscera::burst(w, who, at + Vec3::Z * 0.3, 1e4);
        }
    });
    add(app, "the head", 6, |w| {
        if let Some((who, _)) = aim(w, 3, "head", 1.0) {
            crate::dismember::sever(w, who, crate::dismember::Limb::Head, "", None, None, crate::dismember::How::Blade);
        }
    });
    // Seen through (X), and back.
    add(app, "the insides", 3, |w| {
        aim(w, 1, "chest", 2.6);
        w.resource_mut::<crate::anatomy::Seeing>().0 = true;
    });
    add(app, "the insides", 3, |w| w.resource_mut::<crate::anatomy::Seeing>().0 = false);
}

pub fn plugin(on: bool) -> impl Fn(&mut App) {
    move |app: &mut App| {
        let p = Pipelines::default();
        // (What this file rehearses first, then what the other plugins added, whichever was added to the app first.)
        let theirs = app.world_mut().remove_resource::<Warm>().map_or_else(Vec::new, |w| w.list);
        app.insert_resource(p.clone()).insert_resource(Warm { on, ..default() }).add_systems(Last, drive);
        rehearse(app);
        app.world_mut().resource_mut::<Warm>().list.extend(theirs);
        if let Some(render) = app.get_sub_app_mut(RenderApp) {
            render.insert_resource(p).add_systems(Render, count.in_set(RenderSystems::Cleanup));
        }
    }
}

// --- the check -------------------------------------------------------------------------------------------------------
//
// `cargo run -- --scenario warm --out <dir>`: after the warm-up (which the scenario waits for), a fight as a player would
// have it: the line-up shot with each gun, stabbed, slashed and clubbed, a grenade, blood left to run, an eye shot and
// teeth knocked out, the x-ray on and off; the pipelines made during it counted, and each new one's description, into
// the log. It should be none.

pub fn scenario() -> Vec<crate::scenario::Step> {
    use crate::scenario::{log, Step};
    use serde_json::json;
    // (A picture first: the screenshot's own pipeline is the check's, not the game's.)
    let mut s = vec![Step::Shot("warm_start".into()), Step::Wait(3)];
    s.push(Step::Do(Box::new(|w: &mut World| {
        let p = w.resource::<Pipelines>().clone();
        p.note.store(true, Ordering::SeqCst);
        let made = p.made.load(Ordering::SeqCst);
        log(w, json!({ "event": "warmed", "pipelines": made }));
        w.insert_resource(Before(made));
    })));
    let act = |f: fn(&mut World)| Step::Do(Box::new(f));
    let mut fight = |key: &'static str, n: usize, part: &'static str, far: f32, button: u8, hold: u32| {
        s.push(Step::Do(Box::new(move |w: &mut World| {
            take(w, key);
            aim(w, n, part, far);
        })));
        // (the hands come round to it)
        s.push(Step::Wait(50));
        s.push(Step::Do(Box::new(move |w: &mut World| press(w, button))));
        s.push(Step::Wait(hold));
        s.push(Step::Do(Box::new(move |w: &mut World| release(w, button))));
        s.push(Step::Wait(40));
    };
    fight("pistol", 1, "chest", 2.5, 0, 2);
    fight("shotgun", 2, "belly", 2.0, 0, 2);
    fight("ak", 0, "thighR", 3.0, 0, 15);
    fight("rifle", 3, "head", 3.0, 0, 2);
    fight("knife", 1, "belly", 0.6, 0, 10);
    fight("sword", 2, "upperarmL", 0.8, 2, 10);
    fight("bat", 0, "head", 0.8, 0, 10);
    fight("fists", 3, "head", 0.5, 2, 10);
    fight("grenade", 1, "chest", 5.0, 0, 3);
    s.push(Step::Wait(240));
    s.push(act(|w| {
        // An eye and the teeth, as the face's own check does them.
        let Some((who, _)) = aim(w, 2, "head", 0.6) else { return };
        crate::npc::with(w, who, |npc| {
            let m = crate::weapons::arm("pistol").gun.as_ref().unwrap().m.wounds();
            let b = npc.bone_index("eye.L");
            let eye = npc.world_of(npc.body().bones[b].head, b, None).0;
            crate::wounds::pierce(npc, eye + Vec3::Z * 0.5, Vec3::NEG_Z, &m, 1.0);
        });
    }));
    s.push(Step::Wait(120));
    s.push(Step::Shot("warm_after".into()));
    s.push(act(|w| w.resource_mut::<crate::anatomy::Seeing>().0 = true));
    s.push(Step::Wait(30));
    s.push(Step::Shot("warm_xray".into()));
    s.push(act(|w| w.resource_mut::<crate::anatomy::Seeing>().0 = false));
    // Blood left to run a while.
    s.push(Step::Wait(600));
    s.push(act(|w| {
        let p = w.resource::<Pipelines>().clone();
        let made = p.made.load(Ordering::SeqCst);
        let before = w.resource::<Before>().0;
        let new = p.new.lock().unwrap().clone();
        info!("pipelines made after the warm-up: {}", made - before);
        log(w, json!({ "event": "after the fight", "pipelines": made, "made_after_warm_up": made - before, "new": new }));
    }));
    s
}

#[derive(Resource)]
struct Before(usize);
