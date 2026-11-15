// A body meeting something (src/sandbox/thuds.ts): the sound of it, from Rapier's contacts as they begin (not every
// step they last), and a hard slam into something standing (a wall, a pillar, a crate's side) taken as a blunt blow.
// Landings on what is under them are bones.rs's (_falls), so a contact from below is only heard here.

use std::collections::HashMap;

use bevy::prelude::*;
use bevy_rapier3d::prelude::*;

use crate::behaviour::Grabbed;
use crate::map::Map;
use crate::ragdoll::{Ragdoll, Steps};
use crate::rng::Rng;

const HEARD: f32 = 1.2; // m/s: the least speed lost against something that is heard
const HURTS: f32 = 3.0; // m/s: the least speed lost against something standing that bruises or breaks
const AGAIN: f32 = 0.15; // s: the least time between two sounds from one segment (a body rolling is not a drum roll)
const LYING: f32 = 0.2; // m: a segment whose middle is this near the floor lies on it (a trunk's is 10 to 15 cm up)

// A sound to be played where it happened, as loud as `gain` (0 to 1): one of the takes in assets/sounds by name.
// port: needs sound.rs: nothing plays these yet; the scenarios write them to their log.
#[derive(Message, Clone, Debug)]
pub struct Heard {
    pub name: &'static str,
    pub at: Vec3,
    pub gain: f32,
}

// A person's segment slammed into something standing, at `toward` m/s: wounds.rs's blunt blow ('wall'), when it comes.
// port: wounds.rs `blow(npc, point, normal, mass, toward, 'wall')`.
#[derive(Message, Clone, Debug)]
pub struct Slam {
    pub person: Entity,
    pub seg: usize,
    pub point: Vec3,
    pub normal: Vec3,
    pub mass: f32,
    pub toward: f32,
}

// A person taken hold of and pulled (Grabbed): what of them lies on the floor is heard sliding on it, from where it is,
// as loud as it slides fast; silent once it stops or is let go. The 'drag' take's stream, for sound.rs to drive.
#[derive(Resource, Default, Debug)]
pub struct Dragging {
    pub at: Vec3,
    pub gain: f32,
}

// When each segment was last heard (s).
#[derive(Resource, Default)]
struct Last(HashMap<Entity, f32>);

fn met(
    mut events: MessageReader<CollisionEvent>,
    context: ReadRapierContext,
    time: Res<Time>,
    people: Query<(Entity, &Ragdoll)>,
    mut last: ResMut<Last>,
    mut rng: ResMut<Rng>,
    mut heard: MessageWriter<Heard>,
    mut slams: MessageWriter<Slam>,
) {
    let mut started: Vec<(Entity, Entity)> = Vec::new();
    for e in events.read() {
        if let CollisionEvent::Started(a, b, _) = e {
            started.push((*a, *b));
        }
    }
    if started.is_empty() {
        return;
    }
    let Ok(context) = context.single() else { return };
    let mut body_of: HashMap<Entity, (Entity, usize)> = HashMap::new();
    for (p, rd) in &people {
        for (k, s) in rd.segs.iter().enumerate() {
            body_of.insert(s.entity, (p, k));
        }
    }
    let now = time.elapsed_secs();
    for (a, b) in started {
        let Some(pair) = context.contact_pair(a, b) else { continue };
        let (mut impulse, mut point, mut normal) = (0.0, None, Vec3::ZERO);
        for m in (0..pair.manifolds_len()).filter_map(|i| pair.manifold(i)) {
            impulse += m.points().map(|p| p.impulse()).sum::<f32>();
            if point.is_none() {
                point = m.solver_contact(0).map(|c| c.point());
                normal = m.normal();
            }
        }
        let Some(point) = point else { continue };
        for (who, other) in [(a, b), (b, a)] {
            let Some(&(person, k)) = body_of.get(&who) else { continue };
            let other = body_of.get(&other);
            let rd = people.get(person).unwrap().1;
            let seg = &rd.segs[k];
            // A segment's own neighbours meet all the time as it moves: only a hard one is heard.
            let own = other.is_some_and(|o| o.0 == person);
            let speed = impulse / seg.def.mass.max(0.3);
            if speed < if own { HEARD * 2.0 } else { HEARD } {
                continue;
            }
            if now - last.0.get(&who).copied().unwrap_or(-1.0) < AGAIN {
                continue;
            }
            last.0.insert(who, now);
            let base = seg.def.name.trim_end_matches(['L', 'R']).trim_end_matches('2');
            let loud = ((speed - HEARD * 0.5) / 6.0).min(1.0);
            let trunk = matches!(base, "pelvis" | "belly" | "chest");
            // Into something standing (a wall, a pillar, a crate's side), not a person and not from below. (By the
            // contact's own normal: by the way from the segment's middle to the contact, a hand or a foot, flat boxes,
            // touching the floor at an edge was a slam into a wall, and people lying or getting up broke their wrists,
            // forearms and feet on the floor, the pain sent them down again, and they went up and down.)
            let side = other.is_none() && normal.y.abs() < 0.6;
            // A head knocks on the floor or a wall (on a person it is a blow); a trunk slams into a wall or falls; a limb
            // slaps (a soft one sometimes only lands), or a fast one hits as hard as a blow.
            let take = if base == "head" {
                if other.is_some() { "blunt" } else { "head-hit" }
            } else if trunk {
                if side { "body-slam" } else { "body-fall" }
            } else if speed > 3.5 {
                "blunt"
            } else if speed < 2.5 && rng.next() < 0.4 {
                "lay"
            } else {
                "limb-slap"
            };
            if std::env::var("THUDS").is_ok() {
                info!("thud {} {} against {:?} speed {speed:.2} impulse {impulse:.2}", rd.segs[k].def.name, take, other.map(|o| people.get(o.0).unwrap().1.segs[o.1].def.name.clone()));
            }
            heard.write(Heard { name: take, at: point, gain: if trunk { loud } else { loud * 0.8 } });
            // Into something standing, hard: the wall gives nothing and the part takes it as a blow, at the speed it was
            // going toward the wall before the step, broad and flat over the whole part ('wall'). (From below is a
            // landing: bones.rs counts those.) Not at the contact's impulse over the part's own mass: a forearm pinned
            // between the trunk and the wall takes an impulse that would stop the trunk too, and read as its own speed it
            // was 12 to 25 m/s from a body thrown at 3 to 8, which broke every ulna and arm against the wall like a bat.
            let n = (rd.middle(k) - point).normalize_or_zero();
            let toward = -seg.was.dot(n);
            if side && toward > HURTS {
                slams.write(Slam { person, seg: k, point, normal: n, mass: seg.def.mass, toward });
            }
        }
    }
}

fn drag(map: Res<Map>, people: Query<&Ragdoll, With<Grabbed>>, mut dragging: ResMut<Dragging>) {
    let (mut slid, mut mass, mut at) = (0.0, 0.0, Vec3::ZERO);
    for rd in &people {
        for k in 0..rd.segs.len() {
            let c = rd.middle(k);
            if c.y - map.ground(c.x, c.z, c.y + 0.05) > LYING {
                continue;
            }
            let s = &rd.segs[k];
            slid += s.vel.x.hypot(s.vel.z) * s.def.mass;
            mass += s.def.mass;
            at += c * s.def.mass;
        }
    }
    let speed = if mass > 5.0 { slid / mass } else { 0.0 };
    if mass > 0.0 {
        dragging.at = at / mass;
    }
    dragging.gain = if speed > 0.1 { (speed / 1.5).min(1.0) * 0.8 } else { 0.0 };
}

pub fn plugin(app: &mut App) {
    app.add_message::<Heard>()
        .add_message::<Slam>()
        .init_resource::<Dragging>()
        .init_resource::<Last>()
        .add_systems(FixedUpdate, met.after(Steps::Read))
        .add_systems(Update, drag);
}
