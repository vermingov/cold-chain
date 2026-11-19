// A bout in the ring (ring.rs; BACKLOG item 6): B puts an opponent in the ring, and when one is beaten (dead, or out cold
// for a count of ten) a fresh one climbs in in their place. What the opponent does is whatever every person does
// (behaviour.rs): their own fighting (a guard, punches thrown at the player) waits for the new active-ragdoll controller
// (dev/PORT.md, "The ring and the bout"). Here are its hooks: the `Opponent` marker, the spawn and the respawn, and the
// player's own harm from being hit (`Harm::struck`), which nothing yet calls but a test, because nothing yet hits the
// player.
//
// The player's harm is a blow's as a person's is (wounds.rs `blow`, vitals.rs): concussion from the energy reaching the
// head (a full straight's 175 J is a knockout), pain from any blow; knocked out, they go down where they stand and come
// round over some 10 to 30 s, longer the harder they were hit, and stay groggy a while after.

use bevy::prelude::*;

use crate::person::Person;
use crate::player::Player;
use crate::ragdoll::Ragdoll;
use crate::ring::RING;
use crate::vitals::Vitals;

// Seconds out cold that end a bout (the count of ten), and how long after it ends the next opponent is in.
const COUNT: f32 = 10.0;
const NEXT: f32 = 3.0;

// A person who is in the ring to fight the player, and how long they have been down for the count.
#[derive(Component, Default)]
pub struct Opponent {
    pub down: f32,
}

// Somebody shoved at the ropes in the `ring` scenario.
#[derive(Component)]
struct Shoved;

// The bout: how many opponents there have been, and the seconds until the next one is put in (when one is beaten).
#[derive(Resource, Default)]
pub struct Bout {
    pub opponents: u32,
    pub beaten: u32,
    pub next: Option<f32>,
}

// The player's own harm from being struck.
#[derive(Resource, Default)]
pub struct Harm {
    // 0 to 1 each: how hard they have been hit in the head lately (decaying), how much it hurts.
    pub concussion: f32,
    pub pain: f32,
    // Seconds left out cold (they lie where they fell), and groggy after it.
    pub out: f32,
    pub groggy: f32,
    pub blows: u32,
    // Whether they were put down by it (and so are to be let up).
    down: bool,
}

impl Harm {
    // A blow on the player of `mass` kg at `speed` m/s, to the head or not: what the fighting AI calls when a punch lands
    // (its own fist's, as fist.rs works them out: a jab 1 kg at 6 m/s, a full straight 3.2 kg at 10.5 m/s). Concussion
    // as wounds.rs gives a person (energy / 160 J added, and a knockout at once from 60 J into the head with luck against
    // it: vitals.rs `concuss`), here without the dice: out past 0.8.
    pub fn struck(&mut self, mass: f32, speed: f32, head: bool) {
        let energy = 0.5 * mass * speed * speed;
        self.blows += 1;
        self.pain = (self.pain + energy / 400.0).min(1.0);
        if head {
            self.concussion = (self.concussion + energy / 160.0).min(1.0);
            if self.concussion > 0.8 && self.out <= 0.0 {
                self.out = 10.0 + 20.0 * self.concussion;
            }
        }
    }

    fn update(&mut self, dt: f32) {
        if self.out > 0.0 {
            self.out -= dt;
            if self.out <= 0.0 {
                self.groggy = 20.0;
            }
            return;
        }
        self.groggy = (self.groggy - dt).max(0.0);
        // (A concussion's effects pass over minutes; pain over a minute or so.)
        self.concussion *= (-dt / 120.0).exp();
        self.pain *= (-dt / 60.0).exp();
    }
}

// A fresh opponent into the ring: in the far (south-east) corner, facing the middle.
fn put_in(spawner: &mut crate::sandbox::Spawner, bout: &mut Bout) {
    let body = crate::sandbox::BODIES[bout.opponents as usize % crate::sandbox::BODIES.len()];
    let at = RING.corner(2);
    let to = RING.middle() - at;
    // (The TS's yaw: its z is ours turned round.)
    let yaw = to.x.atan2(-to.z);
    let e = spawner.spawn(body, at, yaw);
    spawner.mark(e, Opponent::default());
    bout.opponents += 1;
}

// B: an opponent in the ring, if there is none yet (one at a time).
fn call(mut spawner: crate::sandbox::Spawner, mut bout: ResMut<Bout>, opponents: Query<(), With<Opponent>>) {
    if !opponents.is_empty() || bout.next.is_some() {
        return;
    }
    put_in(&mut spawner, &mut bout);
}

// Each opponent counted out (or dead) taken away, and a fresh one put in a few seconds later; the player's harm passing.
#[allow(clippy::too_many_arguments)]
fn referee(
    time: Res<Time>,
    mut commands: Commands,
    mut bout: ResMut<Bout>,
    mut harm: ResMut<Harm>,
    mut opponents: Query<(Entity, &mut Opponent, &Vitals, Option<&Ragdoll>), With<Person>>,
    mut spawner: crate::sandbox::Spawner,
    mut players: Query<&mut Player>,
) {
    let dt = time.delta_secs();
    harm.update(dt);
    for mut p in &mut players {
        // Out cold, the player lies where they fell (held, on the floor); groggy after, slow.
        if harm.out > 0.0 {
            p.held = true;
            p.crouch = 1.0;
            harm.down = true;
        } else if harm.down {
            p.held = false;
            harm.down = false;
        }
        p.slowed = if harm.groggy > 0.0 { 0.6 } else { 1.0 };
    }
    for (e, mut o, v, rd) in &mut opponents {
        if v.dead || v.conscious() < 0.3 {
            o.down += dt;
        } else {
            o.down = 0.0;
        }
        if v.dead || o.down > COUNT {
            for part in rd.into_iter().flat_map(|rd| rd.entities()) {
                commands.entity(part).despawn();
            }
            commands.entity(e).despawn();
            bout.beaten += 1;
            bout.next = Some(NEXT);
        }
    }
    if let Some(t) = bout.next.as_mut() {
        *t -= dt;
        if *t <= 0.0 {
            bout.next = None;
            put_in(&mut spawner, &mut bout);
        }
    }
}

// The opponent's punches that landed on the player (behaviour.rs `fight`).
fn landed(mut harm: ResMut<Harm>, mut opponents: Query<&mut crate::behaviour::Behaviour, With<Opponent>>) {
    for mut b in &mut opponents {
        for (mass, speed, head) in std::mem::take(&mut b.blows) {
            harm.struck(mass, speed, head);
        }
    }
}

// K clears the room, the opponent with it: the bout starts again with the next B.
fn reset(mut bout: ResMut<Bout>) {
    bout.next = None;
}

pub fn plugin(app: &mut App) {
    use bevy::input::common_conditions::input_just_pressed;
    app.init_resource::<Bout>()
        .init_resource::<Harm>()
        .add_systems(Update, (call.run_if(input_just_pressed(KeyCode::KeyB)), reset.run_if(input_just_pressed(KeyCode::KeyK)), referee.after(crate::player::walk), landed).run_if(crate::menu::playing));
}

#[cfg(test)]
mod tests {
    use super::*;

    // A jab to the head dazes; a full straight knocks out, for 10 to 30 s; a body blow only hurts.
    #[test]
    fn struck() {
        let mut h = Harm::default();
        h.struck(1.0, 6.0, true);
        assert!(h.out == 0.0 && h.concussion > 0.1);
        h.struck(3.2, 10.5, false);
        assert!(h.out == 0.0 && h.pain > 0.4);
        h.struck(3.2, 10.5, true);
        assert!((10.0..=30.0).contains(&h.out));
    }
}

// --- the `ring` scenario -------------------------------------------------------------------------------------------------
//
// The ring from across the hall and close; the board's bottom row (the dusters and the gloves); an opponent put in (B);
// somebody shoved against the ropes and back off them; the player walking into the ropes and thrown back, then ducking
// through them; the opponent killed and the next one put in. Where each was, a few times a second, into the log.
pub fn scenario() -> Vec<crate::scenario::Step> {
    use crate::scenario::{log, view, Step};
    use bevy::ecs::system::RunSystemOnce;
    use serde_json::json;
    let act = |f: Box<dyn FnMut(&mut World) + Send + Sync>| Step::Do(f);
    let opponent = |w: &mut World| -> Option<Entity> { w.query_filtered::<Entity, With<Opponent>>().iter(w).next() };
    let mut s = vec![Step::Wait(30)];
    s.extend(view("ring_wide", -2.0, 0.5, [4.0, 0.8, -5.8], 1.65));
    s.extend(view("ring_close", 1.0, -3.0, [4.0, 1.0, -5.8], 1.65));
    // The board's bottom row, from in front of it.
    s.push(act(Box::new(|w: &mut World| {
        let hung: Vec<_> = w.resource::<crate::arsenal::Arsenal>().hung.iter().filter(|h| h.0 == "dusters" || h.0 == "gloves").map(|h| (h.1 + h.2) / 2.0).collect();
        let Some(&at) = hung.first() else { return };
        let mid = hung.iter().sum::<Vec3>() / hung.len() as f32;
        w.resource_scope(|w, map: Mut<crate::map::Map>| {
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                p.spawn(&map, mid.x + 0.9, mid.z, Some(mid), at.y + 0.2);
            }
        });
    })));
    s.push(Step::Wait(6));
    s.push(Step::Shot("board_worn".into()));
    // B.
    s.push(act(Box::new(|w: &mut World| {
        let _ = w.run_system_once(call);
    })));
    s.push(Step::Wait(120));
    s.extend(view("opponent_in", 3.0, -1.0, [4.5, 1.0, -6.5], 1.65));
    // Somebody standing 60 cm from the north ropes, shoved at them: every segment given 2.5 m/s north.
    s.push(act(Box::new(|w: &mut World| {
        let mut state: bevy::ecs::system::SystemState<crate::sandbox::Spawner> = bevy::ecs::system::SystemState::new(w);
        let mut spawner = state.get_mut(w).unwrap();
        let e = spawner.spawn("buyer", crate::babylon(4.0, RING.floor, RING.z1 - 0.9), 0.0);
        spawner.mark(e, Shoved);
        state.apply(w);
    })));
    s.push(Step::Wait(90));
    let shoved = |w: &mut World| -> Option<Entity> { w.query_filtered::<Entity, With<Shoved>>().iter(w).next() };
    s.push(act(Box::new(move |w: &mut World| {
        let Some(e) = shoved(w) else { return };
        let bodies: Vec<Entity> = w.get::<Ragdoll>(e).map(|rd| rd.segs.iter().map(|s| s.entity).collect()).unwrap_or_default();
        for b in bodies {
            if let Some(mut v) = w.get_mut::<bevy_rapier3d::prelude::Velocity>(b) {
                v.linear += crate::babylon(0.0, 0.0, 2.5);
            }
        }
    })));
    for k in 0..12 {
        s.push(Step::Wait(6));
        s.push(act(Box::new(move |w: &mut World| {
            let Some(e) = shoved(w) else { return };
            let at = w.get::<Ragdoll>(e).map(|rd| rd.middle(rd.by_name("chest"))).map(|p| crate::babylon(p.x, p.y, p.z).to_array());
            let ropes: Vec<f32> = w.query::<(&crate::ring::Rope, &Transform)>().iter(w).map(|(_, t)| -t.translation.z).filter(|z| *z > RING.z1 - 0.6).collect();
            log(w, json!({ "event": "shoved at the ropes", "frame": (k + 1) * 6, "chest_ts": at, "north_ropes_ts_z": ropes, "ropes_at_rest_ts_z": RING.z1 - 0.3 }));
        })));
        if k == 1 {
            s.extend(view("on_the_ropes", 2.0, -6.5, [4.0, 1.0, -3.7], 1.65));
        }
    }
    s.push(Step::Wait(60));
    s.extend(view("off_the_ropes", 2.0, -6.5, [4.0, 1.0, -3.7], 1.65));
    // The player inside, walking north into the ropes for a second and a half, then on, ducked.
    s.push(act(Box::new(|w: &mut World| {
        w.resource_scope(|w, map: Mut<crate::map::Map>| {
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                let at = crate::babylon(2.6, 0.0, -5.0);
                p.spawn(&map, at.x, at.z, Some(crate::babylon(2.6, 1.4, 0.0)), 1.65);
            }
        });
    })));
    s.push(Step::Wait(30));
    let walk = |key: KeyCode, down: bool| {
        Step::Do(Box::new(move |w: &mut World| {
            let mut keys = w.resource_mut::<ButtonInput<KeyCode>>();
            if down { keys.press(key) } else { keys.release(key) }
        }))
    };
    let where_ = |what: &'static str| {
        Step::Do(Box::new(move |w: &mut World| {
            let p = w.query::<&Player>().iter(w).next().map(|p| crate::babylon(p.pos.x, 0.0, p.pos.y));
            log(w, json!({ "event": what, "player_ts": p.map(|p| [p.x, p.z]), "north_ropes_ts_z": RING.z1 - 0.3 }));
        }))
    };
    s.push(where_("player in the ring"));
    s.push(walk(KeyCode::KeyW, true));
    for k in 0..9 {
        s.push(Step::Wait(10));
        s.push(where_(if k < 8 { "walking into the ropes" } else { "against the ropes" }));
    }
    s.push(Step::Shot("player_on_the_ropes".into()));
    s.push(walk(KeyCode::KeyW, false));
    s.push(Step::Wait(30));
    s.push(where_("let go"));
    s.push(walk(KeyCode::KeyC, true));
    s.push(Step::Wait(20));
    s.push(walk(KeyCode::KeyW, true));
    for _ in 0..8 {
        s.push(Step::Wait(15));
        s.push(where_("ducked, walking on"));
    }
    s.push(walk(KeyCode::KeyW, false));
    s.push(walk(KeyCode::KeyC, false));
    s.push(Step::Wait(30));
    s.push(where_("through"));
    // The opponent killed: taken away, and another in three seconds on.
    s.push(act(Box::new(move |w: &mut World| {
        if let Some(e) = opponent(w) {
            if let Some(mut v) = w.get_mut::<Vitals>(e) {
                v.dead = true;
            }
        }
    })));
    s.push(Step::Wait(30));
    s.push(act(Box::new(move |w: &mut World| {
        let n = w.query_filtered::<(), With<Opponent>>().iter(w).count();
        let b = w.resource::<Bout>();
        let (opponents, beaten, next) = (b.opponents, b.beaten, b.next);
        log(w, json!({ "event": "after the kill", "opponents_now": n, "opponents_so_far": opponents, "beaten": beaten, "next_in_s": next }));
    })));
    s.push(Step::Wait(200));
    s.push(act(Box::new(move |w: &mut World| {
        let n = w.query_filtered::<(), With<Opponent>>().iter(w).count();
        let opponents = w.resource::<Bout>().opponents;
        log(w, json!({ "event": "the next one", "opponents_now": n, "opponents_so_far": opponents }));
    })));
    s.extend(view("next_opponent", 3.0, -1.0, [4.5, 1.0, -6.5], 1.65));
    s
}

// The opponent's fighting (behaviour.rs `fight`): the player in the middle of the ring, still, facing the corner the
// opponent comes in at; twelve seconds of what the opponent does (how far off, standing or not, punches landed and what
// they did to the player), then blows to the opponent's head as the player's fists give them (behaviour.rs `hit`): six
// light, a second apart, then three hard together, and fifteen seconds to see them go down and get up.
pub fn spar() -> Vec<crate::scenario::Step> {
    use crate::scenario::{log, Step};
    use bevy::ecs::system::RunSystemOnce;
    use serde_json::json;
    let opponent = |w: &mut World| -> Option<Entity> { w.query_filtered::<Entity, With<Opponent>>().iter(w).next() };
    let mut s = vec![Step::Wait(30)];
    // (In the hall instead, quicker: the groundskeeper made the opponent where he stands, the player 2.4 m in front.)
    if std::env::var("SPAR_HALL").is_ok() {
        s.push(Step::Do(Box::new(|w: &mut World| {
            let e = crate::scenario::person_at(w, 1);
            w.entity_mut(e).insert(Opponent::default());
            let c = w.get::<Ragdoll>(e).unwrap().middle(w.get::<Ragdoll>(e).unwrap().by_name("chest"));
            let ahead = w.get::<Transform>(e).unwrap().rotation * Vec3::NEG_Z;
            let at = c + Vec3::new(ahead.x, 0.0, ahead.z).normalize_or(Vec3::Z) * 2.4;
            w.resource_scope(|w, map: Mut<crate::map::Map>| {
                for mut p in w.query::<&mut Player>().iter_mut(w) {
                    p.spawn(&map, at.x, at.z, Some(c), 1.65);
                }
            });
        })));
    } else {
    s.push(Step::Do(Box::new(|w: &mut World| {
        w.resource_scope(|w, map: Mut<crate::map::Map>| {
            let (mid, corner) = (RING.middle(), RING.corner(2));
            for mut p in w.query::<&mut Player>().iter_mut(w) {
                p.spawn(&map, mid.x, mid.z, Some(corner + Vec3::Y * 1.4), 1.65);
            }
        });
        let _ = w.run_system_once(call);
    })));
    }
    let report = move |what: &'static str| {
        Step::Do(Box::new(move |w: &mut World| {
            let Some(e) = opponent(w) else { return };
            let p = w.query::<&Player>().iter(w).next().map(|p| Vec3::new(p.pos.x, 0.0, p.pos.y)).unwrap_or_default();
            let eye = w.query::<&Player>().iter(w).next().map(|p| p.eye().translation).unwrap_or_default();
            let (state, mode) = w.get::<crate::behaviour::Behaviour>(e).map(|b| (format!("{:?}", b.state), format!("{:?}", b.mode))).unwrap_or_default();
            let c = w.get::<Ragdoll>(e).map(|rd| rd.middle(rd.by_name("chest"))).unwrap_or_default();
            let h = w.resource::<Harm>();
            let (blows, conc, pain, out) = (h.blows, h.concussion, h.pain, h.out);
            log(w, json!({ "event": what, "apart": Vec3::new(c.x - p.x, 0.0, c.z - p.z).length(), "state": state, "mode": mode,
                "blows_on_player": blows, "concussion": conc, "pain": pain, "out_s": out,
                "chest": (c * 100.0).round() / 100.0, "eye": (eye * 100.0).round() / 100.0 }));
        }))
    };
    for k in 0..24 {
        s.push(Step::Wait(30));
        s.push(report("sparring"));
        if k % 6 == 5 {
            s.push(Step::Shot(format!("spar_{}", k / 6)));
        }
    }
    if std::env::var("SPAR_SHORT").is_ok() {
        return s;
    }
    let blow = move |n: f32| {
        Step::Do(Box::new(move |w: &mut World| {
            let Some(e) = opponent(w) else { return };
            let p = w.query::<&Player>().iter(w).next().map(|p| p.eye().translation).unwrap_or_default();
            w.resource_scope(|w, mut rng: Mut<crate::rng::Rng>| {
                let mut q = w.query::<(&mut Ragdoll, &mut crate::behaviour::Behaviour, &Transform)>();
                let Ok((mut rd, mut b, root)) = q.get_mut(w, e) else { return };
                let head = rd.by_name("head");
                let at = rd.middle(head);
                let way = Vec3::new(at.x - p.x, 0.0, at.z - p.z).normalize_or(Vec3::X);
                b.hit(&mut rd, root, &mut rng, head, way * n, at - way * 0.08, 0.5);
            });
        }))
    };
    for _ in 0..6 {
        s.push(blow(6.0));
        s.push(Step::Wait(60));
        s.push(report("struck lightly"));
    }
    s.push(Step::Shot("spar_struck".into()));
    for _ in 0..3 {
        s.push(blow(30.0));
        s.push(Step::Wait(4));
    }
    for k in 0..30 {
        s.push(Step::Wait(30));
        s.push(report("struck hard"));
        if k % 10 == 3 {
            s.push(Step::Shot(format!("spar_down_{}", k / 10)));
        }
    }
    s
}
