// What a bullet, a blade or a blow does to a person (src/sandbox/wounds.ts).
//
// A shot is a line through them. Along it, from the skin in, it goes through whatever is there: skin, fat, muscle, the
// bones and organs anatomy.rs knows, and past any vessel near enough to be torn by the wound channel. It spends its
// energy as it goes, a little on each centimetre of soft tissue and a great deal on bone, and stops where it has none
// left; what is left when it comes out the far side carries on to whatever is behind. Each thing hurt says what it does
// to the body (vitals.rs): a severed femoral artery bleeds a litre and a half a minute, a holed lung slowly collapses.
// What it does to a bone, and the bone to the body, is bones.rs's; the pieces of a bone it shatters fly on through the
// flesh like small bullets of their own (shards).
//
// A blow is an impulse into the segment it lands on and a force on the first bone in its way (bones.rs's impact).
//
// The two ways in, for whatever fires, stabs, cuts or swings (weapons.rs):
//     pierce(&mut npc, origin, dir, &missile, far) -> Pierced
//     blow(&mut npc, point, dir, mass, speed, tool)
// with the person borrowed through `npc::with(world, entity, |npc| ...)`. Both are the TS's, argument for argument.

use bevy::prelude::*;

use crate::anatomy::{Span, Traced, VesselHit};
use crate::npc::{Crossing, Happened, Held, Kind, Look, Npc, Skinned, Way};
use crate::vitals::{Bleed, Into, Rhythm, Side};

#[derive(Clone, Debug, Default)]
pub struct Missile {
    pub energy: f32, // joules at the skin
    pub mass: f32, // kg, for the push it gives
    pub calibre: f32, // metres across: the hole it makes
    pub channel: f32, // metres: how far either side of its path tissue is torn (the permanent cavity)
    pub soft: f32, // joules lost per centimetre of soft tissue
    pub hard: f32, // and of bone
    pub reach: Option<f32>, // metres into the body it can go at most (a blade's length)
    pub blade: bool,
    pub slash: bool, // drawn across rather than driven in: no hole, the caller draws the cut
    pub name: Option<String>, // what it is, for the injury list ('fragment', 'pellet'); a bullet if none
    pub speed: Option<f32>, // m/s at the muzzle (a gun's)
    // A blade's: which way across it its edge is (unit, world, from the back to the edge), how many edges it has, and
    // how far from its point it reaches its full width (`calibre`).
    pub across: Option<Vec3>,
    pub edges: Option<u32>,
    pub taper: Option<f32>,
    // A gun's pellets a shot (the eye's injury says pellet when there are several).
    pub pellets: Option<u32>,
    // How far behind the line's start the muzzle it came out of is (m): a shot from the hands starts at the muzzle, and
    // further on through someone it starts where it came out. None: a line followed from the eye (MUZZLE).
    pub muzzle: Option<f32>,
}

// A stab's slit gapes as the skin either side pulls it open (dev/research/stab-wounds.md sec. 3, tissue-mechanics.md
// sec. 2): a slit 2a long in a skin under stress sigma opens by 4 sigma a / E at its middle, with sigma about 50 kPa along
// the tension lines and 22 kPa across them (pre-strain 23:10, Deroy 2017) and E about 1.2 MPa (Ni Annaidh 2012). The fat
// under it holds it to the lower part of that (x 0.6, an estimate).
const STRESS_ALONG: f32 = 50e3;
const STRESS_ACROSS: f32 = 22e3;
const SKIN_E: f32 = 1.2e6;
const HELD_OPEN: f32 = 0.6;
// A straight thrust leaves a slit up to 2 mm shorter than the blade is wide where it reached (the skin draws back:
// forensicmed.co.uk on stab wounds, Hunt 2003).
const SHRINKS: f32 = 0.002;
// A shot followed from the eye with no muzzle given (`Missile::muzzle`): the muzzle about this far ahead of it
// (weapons.ts HELD plus the barrel).
const MUZZLE: f32 = 0.45;

// How big an organ is, roughly, through: to say how much of it a path of a given length wrecks.
fn through(kind: &str) -> f32 {
    match kind {
        "heart" => 0.1,
        "lung" => 0.16,
        "liver" => 0.15,
        "spleen" => 0.09,
        "kidney" => 0.07,
        "brain" => 0.14,
        "stomach" => 0.1,
        "bowel" => 0.2,
        "colon" => 0.15,
        "penis" => 0.035,
        "testis" => 0.03,
        "prostate" => 0.04,
        _ => 0.08,
    }
}

// Litres a second an organ bleeds when holed through, before the heart's push is taken into account.
pub fn organ_bleed(kind: &str) -> Option<f32> {
    Some(match kind {
        "heart" => 0.07,
        "liver" => 0.012,
        "spleen" => 0.01,
        "kidney" => 0.007,
        "lung" => 0.004,
        "brain" => 0.002,
        "pancreas" => 0.003,
        "stomach" => 0.002,
        "bowel" => 0.0015,
        "colon" => 0.0015,
        "gallbladder" => 0.001,
        "bladder" => 0.0008,
        "adrenal" => 0.001,
        "muscle" => 0.001,
        "airway" => 0.001,
        "oesophagus" => 0.001,
        "brainstem" => 0.001,
        // The penis's erectile bodies are blood spaces, and the prostate lies in a plexus of veins: both bleed freely.
        "penis" => 0.003,
        "prostate" => 0.002,
        "testis" => 0.001,
        "gland" => 0.0008,
        _ => return None,
    })
}

const AIRWAYS: f32 = 0.15; // share of a torn lung's bleeding that goes into its own airways rather than the chest
const TRACK_IN: f32 = 0.3; // share of a neck wound's bleeding that runs into a windpipe holed along it (an estimate)

// The rate a vessel of radius r (metres) bleeds, cut through, at normal pressure: a carotid about a litre a minute.
pub fn vessel_rate(r: f32, arterial: bool) -> f32 {
    (if arterial { 1.2 } else { 0.55 }) * (r * 1000.0).powi(2) * 0.001
}

pub fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or_else(String::new, |f| f.to_uppercase().collect::<String>() + c.as_str())
}

// What a line did: whether it stopped in them, where it stopped (or left them), the energy it still has, whether it
// met them at all, and where it went in.
#[derive(Clone, Debug)]
pub struct Pierced {
    pub stopped: bool,
    pub at: Option<Vec3>,
    pub energy: f32,
    pub hit: bool,
    pub enter: Option<Crossing>,
}

// A line from `origin` along unit `dir` through the person, carrying `m`, as far as `far` (the TS's default 3).
pub fn pierce(npc: &mut Npc, origin: Vec3, dir: Vec3, m: &Missile, far: f32) -> Pierced {
    pierce_with(npc, origin, dir, m, far, None)
}

// What a line meets in someone, worked out beforehand (a grenade's fragments, many lines at once on the compute threads:
// weapons.rs): their skin and clothes as pierce's Npc::surface finds them, and their insides as its Npc::trace does, if
// the line met skin. Neither changes anything, so pierce given them does what it would have done asking for them.
pub struct Lines {
    pub surface: Vec<Crossing>,
    pub trace: Option<(Vec<Span>, Vec<VesselHit>)>,
}

// The Lines pierce(origin, dir, m, far) would ask for, of someone looked at as `look` (skinned `sk`) with their insides
// `traced` held at `held`.
#[allow(clippy::too_many_arguments)]
pub fn lines(look: &Look, sk: &Skinned, traced: &Traced, held: &Held, origin: Vec3, dir: Vec3, m: &Missile, far: f32) -> Lines {
    let surface = look.surface(sk, origin, dir, far, true);
    let trace = surface.iter().any(|h| h.kind == Kind::Skin).then(|| crate::anatomy::trace(traced, &[], Some(held), origin, dir, far, m.channel, None));
    Lines { surface, trace }
}

// pierce, with what the line meets already worked out (`lines`), or not.
pub fn pierce_with(npc: &mut Npc, origin: Vec3, dir: Vec3, m: &Missile, far: f32, pre: Option<Lines>) -> Pierced {
    let (surface, mut traced) = match pre {
        Some(l) => (l.surface, l.trace),
        None => (npc.surface(origin, dir, far, true), None),
    };
    let mut skins: Vec<Crossing> = surface.iter().filter(|h| h.kind == Kind::Skin).cloned().collect();
    // The eyes in its way, the first crossing of each (eyes.rs). One met from in front, through the open lids or just
    // behind a shut lid, is the way in: the skin of the socket behind it (and a shut lid's, in front) is the one crossing
    // into the head, not two.
    let eyes: Vec<Crossing> = surface
        .iter()
        .enumerate()
        .filter(|(k, h)| h.kind == Kind::Eye && !surface[..*k].iter().any(|o| o.kind == Kind::Eye && o.owner == h.owner))
        .map(|(_, h)| h.clone())
        .collect();
    let via_eye = match (skins.first(), eyes.first()) {
        (Some(s0), Some(e)) if e.t < skins.get(1).map_or(f32::INFINITY, |s| s.t).min(s0.t + 0.03) => Some(e.clone()),
        _ => None,
    };
    if let Some(ve) = &via_eye {
        skins = skins.into_iter().enumerate().filter(|(k, h)| *k == 0 || h.t > ve.t + 0.035).map(|(_, h)| h).collect();
    }
    if skins.is_empty() {
        // Only clothes in the way (a sleeve standing off an arm): a hole in them and nothing else.
        for h in surface.iter().filter(|h| h.kind == Kind::Cloth) {
            npc.wound(h, Way::In, m.calibre);
        }
        return Pierced { stopped: false, at: None, energy: m.energy, hit: !surface.is_empty(), enter: None };
    }
    let (spans, vessels) = traced.take().unwrap_or_else(|| npc.trace(origin, dir, far, m.channel, None));
    let first = npc.vitals.bleeds.len();
    let mut energy = m.energy;
    let mut stop_at = f32::INFINITY;
    let enter_t = skins[0].t;
    // Clothes before the skin are holed where it went in, and the blood from the wound soaks into them there. (A blade's
    // slit, in them and in the skin, is cut once how deep it went is known: below.)
    let cloths: Vec<Crossing> = surface.iter().filter(|h| h.kind == Kind::Cloth && h.t <= enter_t + 0.02).cloned().collect();
    for h in &cloths {
        if !m.blade {
            npc.wound(h, Way::In, m.calibre);
        }
        skins[0].cloth = Some(Box::new(h.clone()));
    }
    // The way in, opened in the flesh; round a bullet's, the ring of skin it scraped and bruised going in. Nothing more on
    // the skin yet: the blood comes as the wound bleeds (dev/research/gunshot-blood.md sec. 2).
    if !m.slash && !m.blade {
        let ring = m.speed.unwrap_or(0.0) < 600.0;
        npc.hurt.happened.push(Happened::Hole { hit: skins[0].clone(), size: m.calibre, open: false, ring });
        let enter = skins[0].clone();
        npc.wound(&enter, Way::In, m.calibre);
    }
    // Where the path is inside the body: between each skin crossing and the next.
    let inside: Vec<(f32, f32)> = (0..skins.len()).step_by(2).map(|k| (skins[k].t, skins.get(k + 1).map_or(skins[k].t + 0.05, |s| s.t))).collect();
    let limit = m.reach.filter(|&r| r != 0.0).map_or(f32::INFINITY, |r| enter_t + r);

    // Walk the path: soft tissue between the hard things, and the things themselves.
    let mut t = enter_t;
    let mut bones = 0;
    let tr = npc.traced.clone();
    let events: Vec<_> = spans.iter().filter(|s| s.enter < far.min(limit) && inside.iter().any(|&(a, b)| s.enter < b && s.leave > a)).cloned().collect();
    // Energy spent on the tissue from `t` to `to` at `rate` J/cm: false where it ran out (and where, `stop_at`).
    let spend = |to: f32, rate: f32, t: &mut f32, energy: &mut f32, stop_at: &mut f32| spent(to, rate, t, energy, stop_at);
    let mut fragments: f32 = 1.0;
    for s in &events {
        if stop_at < f32::INFINITY {
            break;
        }
        if s.enter > t && !spend(s.enter.min(limit), m.soft, &mut t, &mut energy, &mut stop_at) {
            break;
        }
        if t >= limit {
            stop_at = limit;
            break;
        }
        // (All of the part the line crossed, though it began inside one already walked: the windpipe within a lung's span.)
        let length = (s.leave.min(limit) - s.enter).max(0.0);
        let part = &tr.parts[s.part];
        let kind = part.kind.as_str();
        if kind == "bone" || kind == "skull" || kind == "cartilage" {
            let at = energy;
            let point = origin + dir * t.max(s.enter);
            // A blade is stopped by bone, and does not break it: a heavy one bites into it.
            if m.blade {
                // Except behind an eye: the socket's roof (the frontal bone's orbital plate) and inner wall (the ethmoid's)
                // are paper-thin, under a millimetre, and a blade driven up or in through the eye goes on into the brain;
                // straight back it meets the apex, the sphenoid's thick body, and stops (eye-trauma.md sec. 1-2).
                if let Some(ve) = &via_eye {
                    if at > 25.0 && (part.name.contains("frontal") || part.name.contains("ethmoid")) && t < ve.t + 0.07 {
                        energy -= 15.0;
                        npc.vitals.injure("Blade through the back of the eye socket into the skull", 8.0);
                        continue;
                    }
                }
                if at > 60.0 {
                    npc.vitals.injure(format!("{} notched by the blade", cap(&part.name)), 3.0);
                }
                stop_at = t.max(s.enter);
                energy = 0.0;
                break;
            }
            // (A bone is paid for by its thickness, not by how long the line runs inside it: the skull is several shells one
            // inside another, and a line along a long bone is not through it.)
            let thick = crate::bones::thickness(&part.name);
            let held = !spend(s.leave.min(limit).min(t.max(s.enter) + thick), m.hard, &mut t, &mut energy, &mut stop_at);
            let pieces = npc.bones().shot(s.part, point, dir, at, m.calibre, s.leave - s.enter);
            if pieces > 0 {
                let from = origin + dir * s.leave.min(if held { stop_at } else { s.leave });
                shards(npc, from, dir, pieces, (at - energy) * 0.3);
            }
            if held {
                break;
            }
            t = t.max(s.leave.min(limit));
            bones += 1;
            fragments = (fragments + if pieces > 0 { 0.25 * pieces as f32 } else { 0.2 }).min(2.0);
            continue;
        }
        organ(npc, s.part, length, m, fragments, origin + dir * t.max(s.enter));
        if !spend(s.leave.min(limit), m.soft * if kind == "liver" || kind == "brain" { 0.8 } else { 1.0 }, &mut t, &mut energy, &mut stop_at) {
            break;
        }
        if t >= limit {
            stop_at = limit;
            break;
        }
    }
    if stop_at == f32::INFINITY {
        // On to the far side of the body, through what flesh is left.
        let out = inside.iter().find(|&&(_, b)| b > t).map_or(t, |&(_, b)| b);
        if out < limit && spend(out, m.soft, &mut t, &mut energy, &mut stop_at) {
            stop_at = f32::INFINITY;
        } else if stop_at == f32::INFINITY {
            stop_at = out.min(limit);
        }
    }

    // The teeth in its way, and the vessels the channel tore, up to where it stopped.
    if !m.blade {
        npc.teeth().shot(origin, dir, stop_at.min(far));
    }
    for hit in &vessels {
        if hit.t < stop_at {
            vessel(npc, hit, m);
        }
    }
    // The flesh itself: skin, fat and muscle bleed a little from any wound.
    let deep = stop_at.min(inside[0].1) - enter_t;
    // (A blade into an open eye cuts the eye, not the socket's skin behind it: eyes.rs.)
    if m.blade && !m.slash && !via_eye.as_ref().is_some_and(|ve| ve.t < enter_t) {
        slit(npc, &skins[0], &cloths, dir, m, deep);
    }
    // Each eye it went through, hurt as an eye: through and through if the path went on well past it. What runs out of
    // the one it went in by runs from that lower lid.
    // (A blade drawn across an open eye cuts it as its point would: the TS left slashes out, and a sword across the eyes
    // left them whole.)
    let mut lid: Option<Crossing> = None;
    for h in &eyes {
        if h.t < stop_at {
            let out = npc.eyes().pierced(h, m, dir, stop_at.min(far) - h.t, stop_at > h.t + 0.04);
            if via_eye.as_ref().is_some_and(|ve| ve.t == h.t && ve.t < enter_t) {
                lid = out;
            }
        }
    }
    // A bullet's track past an eye breaks the orbit round it (eyes.rs).
    if !m.blade {
        npc.eyes().near(origin, dir, enter_t, stop_at.min(far), m.energy);
    }
    // In through an open mouth the way in is the back of the throat, and it bleeds into the mouth.
    let in_mouth = npc.throat_crossed(origin, dir, enter_t - 0.08, enter_t - 0.035);
    let mut b = Bleed::new("wound", 0.00025 * (m.channel / 0.006) * (deep / 0.05 + 0.3).min(1.0)).clots(0.02).mark(Some(skins[0].clone()));
    if in_mouth {
        b = b.internal(true).into(Into::Mouth);
    }
    npc.vitals.bleed(b);
    // Through the mouth: the tongue, palate and cheeks are full of vessels (the lingual and facial arteries' branches)
    // and bleed into it (throat.rs).
    if npc.throat_crossed(origin, dir, enter_t - 0.08, stop_at.min(far)) {
        npc.vitals.bleed(Bleed::new("mouth", 0.0009 * (m.channel / 0.006).min(2.0)).internal(true).clots(0.005).into(Into::Mouth));
        npc.vitals.injure("Wound through the mouth", 4.0);
        npc.throat_wall(origin, dir, enter_t - 0.08, stop_at.min(far), m.calibre);
    }
    for h in &surface {
        if h.kind == Kind::Tongue && h.t < stop_at.min(far) {
            npc.throat_tear(h, m.calibre);
        }
    }
    npc.vitals.pain = (npc.vitals.pain + 0.25 + if bones > 0 { 0.25 } else { 0.0 }).min(1.0);
    let region = region_of(npc, skins[0].point);
    npc.vitals.injure(wound_text(m, &region, deep, stop_at == f32::INFINITY), 1.0 + (deep * 20.0).min(3.0));

    // Every crossing of the skin it got to: out of an arm and into the chest behind it, and out the far side.
    let exited = stop_at == f32::INFINITY;
    let mut exit_at: Option<Vec3> = None;
    let mut exit_hit: Option<usize> = None;
    for k in 1..skins.len() {
        if skins[k].t >= stop_at || m.slash {
            continue;
        }
        let out = k % 2 == 1;
        let size = if out { exit_size(npc, m, fragments) } else { m.calibre };
        let h = skins[k].clone();
        npc.wound(&h, if out { Way::Out } else { Way::In }, size);
        if out && !m.blade {
            let seg = npc.nearest_name(h.point).map(str::to_string);
            tear(npc, &h, size, seg.as_deref().unwrap_or("chest"));
        }
        if out {
            exit_at = Some(h.point);
            exit_hit = Some(k);
            // (open: a hole a dressing can go on, dressing.rs)
            skins[k].open = true;
        }
    }
    if exited {
        let last = skins[skins.len() - 1].t;
        for h in surface.iter().filter(|h| h.kind == Kind::Cloth && h.t > last) {
            npc.wound(h, Way::Out, m.calibre * 2.0);
            if let Some(k) = exit_hit {
                skins[k].cloth = Some(Box::new(h.clone()));
            }
        }
    }
    let exit = exit_hit.map(|k| skins[k].clone());
    let enter = skins[0].clone();
    // The scalp and face are full of small vessels and bleed far more than a wound anywhere else of the same size. The
    // neck (on the head's segment too) is not: its skin bleeds as skin, and what lies under it by the vessels met.
    let face = |npc: &Npc, h: Option<&Crossing>| h.is_some_and(|h| !npc.body().bones[h.owner].name.starts_with("neck") && !npc.in_neck(h.point));
    if npc.nearest_name(enter.point) == Some("head") && lid.is_none() {
        // (A blade drawn across the face crosses the skin every centimetre or so: a cut bleeds as the scalp does for each
        // few centimetres of it, not for each place it was found.)
        let cut_there = m.slash && npc.vitals.bleeds.iter().any(|b| b.name == "scalp" && b.source.mark.as_ref().is_some_and(|k| k.rest.distance(enter.rest) < 0.03));
        if face(npc, Some(&enter)) && !in_mouth && !cut_there {
            npc.vitals.bleed(Bleed::new("scalp", 0.0012 * if m.blade { 1.5 } else { 1.0 }).clots(0.003).mark(Some(enter.clone())));
        }
        if face(npc, exit.as_ref()) {
            npc.vitals.bleed(Bleed::new("scalp", 0.002).clots(0.003).mark(exit.clone()));
        }
    }
    // At the moment it is made a wound holds its blood: a blade fills the track it cuts until it is drawn out, and a
    // bullet's holes are small, clothed or raised, and the bleeding is mostly inside (stab-wounds.md sec. 1,
    // gunshot-blood.md sec. 2). A little follows the blade out or wets the lips of a hole (an estimate); the rest comes as
    // the wound bleeds (npc.bleed), welling over seconds.
    if !m.slash {
        if lid.is_none() {
            npc.welling(Some(&enter), 0.03);
        }
        npc.welling(exit.as_ref(), 0.1);
    }
    // A hole in the larynx or the windpipe opens the track into the airway: what the vessels and flesh torn along it bleed
    // runs in through the hole as well as out of the skin, and is breathed down and coughed up (dev/research/airway-blood.md
    // sec. 1).
    if npc.vitals.bleeds[first..].iter().any(|b| b.into == Some(Into::Airway) && b.side.is_none()) {
        let mine = npc.vitals.bleeds.len();
        for k in first..mine {
            let b = npc.vitals.bleeds[k].clone();
            if b.internal || b.into.is_some() {
                continue;
            }
            npc.vitals.bleed(Bleed { name: format!("{}, into the windpipe", b.name), rate: b.rate * TRACK_IN, internal: true, into: Some(Into::Airway), ..Bleed::new("", 0.0).arterial(b.arterial).clots(b.clots) });
            npc.vitals.bleeds[k].rate *= 1.0 - TRACK_IN;
        }
    }
    // What bleeds comes out of the wound: the way out if there is one, it being the bigger.
    for b in &mut npc.vitals.bleeds[first..] {
        let mark = match b.source.mark.take() {
            Some(mk) if lid.is_some() && same(&mk, &enter) => lid.clone(),
            Some(mk) => Some(mk),
            None => exit.clone().or(lid.clone()).or(Some(enter.clone())),
        };
        b.source.mark = mark;
    }
    // The push it gave: its momentum, as much of it as it left in the body.
    let share = if m.energy > 0.0 { (m.energy - energy) / m.energy } else { 1.0 };
    let speed = ((2.0 * m.energy) / m.mass.max(1e-4)).sqrt();
    npc.hit(enter.point, dir * (m.mass * speed * share.sqrt()), if m.blade { 0.2 } else { 1.0 });
    // (No spatter from a blade: a stab or a cut throws nothing out of the wound; what flies comes off the blade, weapons.rs.)
    // (npc.spatter: thrown by blood.rs `take`.)
    if !m.slash && !m.blade {
        // (Powder and soot come out of any gun's muzzle, a shotgun's with its pellets; a grenade's fragments have none.)
        let range = if m.name.as_deref().is_some_and(|n| n != "pellet" && n != "charge") { f32::INFINITY } else { enter_t + m.muzzle.unwrap_or(-MUZZLE) };
        npc.hurt.happened.push(Happened::Spatter { enter: enter.clone(), dir, exit: exit_at, energy: m.energy, exited, range });
    }
    // A heavy edge may go right through a limb once the swing is through (npc.slash); a charge that is still one mass
    // (a shotgun's at contact range) may tear one off now.
    // (dismember.rs and viscera.rs take them: the mesh cutting decides; here only what was asked of it.)
    if m.slash {
        npc.hurt.happened.push(Happened::Edge { energy: m.energy, at: enter.point, dir });
    } else if m.channel >= 0.015 && !m.blade {
        npc.hurt.happened.push(Happened::Charge { energy: m.energy - if exited { energy } else { 0.0 }, at: enter.point, dir, hit: enter.clone(), calibre: m.calibre });
    } else if !m.blade && m.speed.unwrap_or(0.0) > 600.0 && npc.nearest_name(enter.point) == Some("head") {
        // A rifle's bullet through the head: what it spent there may burst the skull open where it left (viscera.rs).
        let out = exit.clone().unwrap_or_else(|| enter.clone());
        npc.hurt.happened.push(Happened::Charge { energy: m.energy - if exited { energy } else { 0.0 }, at: out.point, dir, hit: out, calibre: m.calibre });
    }
    Pierced {
        stopped: !exited,
        at: if exited { exit_at } else { Some(origin + dir * stop_at.min(far)) },
        energy: if exited { energy } else { 0.0 },
        hit: true,
        enter: Some(enter),
    }
}

// The same crossing (a clone of it): the TS compared objects.
fn same(a: &Crossing, b: &Crossing) -> bool {
    a.t == b.t && a.corners == b.corners && a.kind == b.kind
}

// Energy spent on the tissue from `t` to `to` at `rate` J/cm (pierce's `spend`): false where it ran out, and where it
// did is `stop_at`.
pub fn spent(to: f32, rate: f32, t: &mut f32, energy: &mut f32, stop_at: &mut f32) -> bool {
    let cm = (to - *t) * 100.0;
    if cm <= 0.0 {
        return true;
    }
    if *energy - cm * rate <= 0.0 {
        *stop_at = *t + *energy / rate / 100.0;
        *energy = 0.0;
        return false;
    }
    *energy -= cm * rate;
    *t = to;
    true
}

// Part `p` of the traced insides holed along `length` m; `at`: the world point where it went into the organ, where blood
// lies on it after.
fn organ(npc: &mut Npc, p: usize, length: f32, m: &Missile, fragments: f32, at: Vec3) {
    let part = &npc.traced.clone().parts[p];
    let kind = part.kind.as_str();
    let size = through(kind);
    let wreck = ((length / size) * (m.channel / 0.006) * 0.4 * fragments).min(1.0);
    npc.hurt_part(&part.name);
    // (viscera.rs: blood lying on the organ.)
    npc.hurt.happened.push(Happened::Bled { part: part.name.clone(), at, channel: m.channel });
    let name = cap(&part.name);
    let v = &mut *npc.vitals;
    match kind {
        "heart" => {
            v.pump = (v.pump - wreck * 2.2).max(0.0);
            v.bleed(Bleed::new(&part.name, 0.07 * (0.4 + wreck)).arterial(true).internal(true).clots(0.0));
            if wreck > 0.12 {
                v.arrest(Rhythm::Fibrillating);
            }
            v.injure(if wreck > 0.3 { "Heart torn open" } else { "Heart wounded" }, 10.0);
            return;
        }
        "brain" => {
            v.brain_damage += 0.08 + wreck * 0.7;
            v.bleed(Bleed::new(&part.name, 0.002).internal(true).clots(0.004));
            v.injure(if wreck > 0.3 { "Brain destroyed along the wound" } else { "Brain injured" }, 10.0);
            return;
        }
        "brainstem" => {
            v.dead = true;
            v.arrest(Rhythm::None);
            v.injure("Brainstem destroyed", 11.0);
            return;
        }
        "lung" => {
            let side = if part.name.contains("left") { Side::L } else { Side::R };
            v.lungs.leak(side);
            v.lungs.set(side, (v.lungs.get(side) - wreck * 0.4).max(0.05));
            v.bleed(Bleed::new(&part.name, 0.004 * (0.5 + wreck)).internal(true).clots(0.003));
            // Most of a torn lung bleeds into the chest round it; some into its own airways, and is coughed up
            // (dev/research/airway-blood.md sec. 1: the share is an estimate).
            v.bleed(Bleed::new(format!("{} into its airways", part.name), 0.004 * AIRWAYS * (0.5 + wreck)).internal(true).clots(0.003)
                .into(Into::Airway).side(side));
            v.injure(format!("{name} punctured, collapsing"), 7.0);
            return;
        }
        "airway" => {
            v.airway = (v.airway - 0.5).max(0.1);
            // A holed windpipe bleeds into itself, down into the lungs.
            v.bleed(Bleed::new(&part.name, 0.001 * (0.3 + wreck)).internal(true).clots(0.006).into(Into::Airway));
            v.injure("Windpipe holed", 7.0);
            return;
        }
        _ => {}
    }
    let rate = organ_bleed(kind).unwrap_or(0.001) * (0.3 + wreck);
    v.bleed(Bleed::new(&part.name, rate).internal(true).clots(if kind == "liver" || kind == "spleen" { 0.002 } else { 0.006 }));
    // A holed stomach or gullet bleeds into itself as well as round it: from its lining into the stomach.
    if kind == "stomach" || kind == "oesophagus" {
        v.bleed(Bleed::new(format!("{}, into it", part.name), rate * 0.6).internal(true).clots(0.006).into(Into::Stomach));
    }
    v.injure(format!("{name} {}", if wreck > 0.5 { "torn apart" } else { "lacerated" }), 3.0 + rate * 300.0);
}

fn vessel(npc: &mut Npc, hit: &crate::anatomy::VesselHit, _m: &Missile) {
    if !npc.hurt.cut.insert((hit.tube, hit.at)) {
        return;
    }
    let tube = &npc.traced.clone().tubes[hit.tube];
    let r = tube.points[hit.at].1;
    // A blade or a bullet that only grazed it opens it partly.
    let through = if hit.miss < -r { 1.0 } else { 0.5 };
    // Cut at the vertebra nearest the cut: from C4 up the diaphragm stops with it, below that the person still breathes
    // on the diaphragm (bones.cord).
    if tube.kind == "cord" {
        let level = npc.bones().level_at(hit.r#where);
        npc.bones().cord(&level, "severed");
        return;
    }
    let arterial = tube.kind == "artery";
    let in_trunk = ["aorta", "vena cava", "iliac", "subclavian"].iter().any(|w| tube.name.contains(w));
    npc.vitals.bleed(Bleed::new(&tube.name, vessel_rate(r, arterial) * through).arterial(arterial).internal(in_trunk)
        .clots(if arterial { 0.004 } else { 0.012 }).spurts(arterial && !in_trunk).tube(hit.tube, hit.at));
    npc.vitals.injure(format!("{} {}", cap(&tube.name), if through == 1.0 { "severed" } else { "nicked" }), if arterial { 8.0 + r * 300.0 } else { 5.0 });
}

// The pieces of a bone a bullet shattered, driven on from `at` in a cone round `dir` with `energy` J between them: each a
// small missile of its own, tearing what lies within a few centimetres (Bartlett et al. 2000: bone fragments are the
// secondary missiles of a high-velocity wound).
fn shards(npc: &mut Npc, at: Vec3, dir: Vec3, count: u32, energy: f32) {
    let piece = Missile { energy: energy / count as f32, mass: 0.002, calibre: 0.004, channel: 0.003, soft: 4.0, hard: 200.0, ..default() };
    let side = dir.cross(if dir.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
    let up = dir.cross(side);
    let tr = npc.traced.clone();
    for _ in 0..count {
        let a = npc.dice.next() * std::f32::consts::TAU;
        let spread = 0.15 + npc.dice.next() * 0.45;
        let d = (dir + side * (a.cos() * spread) + up * (a.sin() * spread)).normalize();
        let reach = (piece.energy / piece.soft / 100.0).min(0.12);
        if reach < 0.01 {
            continue;
        }
        let (spans, vessels) = npc.trace(at, d, reach, piece.channel, None);
        for s in &spans {
            let kind = &tr.parts[s.part].kind;
            if !(kind.contains("bone") || kind.contains("skull") || kind.contains("cartilage")) {
                organ(npc, s.part, s.leave.min(reach) - s.enter, &piece, 1.0, at + d * s.enter);
            }
        }
        for hit in &vessels {
            vessel(npc, hit, &piece);
        }
    }
    if count > 2 {
        npc.vitals.injure("Bone shattered into the flesh around it", 4.0);
    }
}

// --- what a blade's way in and a bullet's way out look like --------------------------------------------------------

// The slit a blade drawn `deep` metres into the person along `dir` leaves in the skin at crossing `enter` and in the
// clothes over it (`cloths`) (dev/research/stab-wounds.md sec. 3). It lies where the blade's plane meets the skin: with
// the thrust along d, the blade's width along e and the skin's normal n, the blade's sides cross the skin at
// +-(w/2)(e - d (e.n)/(d.n)), so a slanting thrust leaves a longer slit. w is the blade's width where it reached (its
// point is narrower), less up to 2 mm as the skin draws back. Its edge end is sharp; its back end squared, if it has a
// back. (What the slit looks like is marks.rs's, phase 3: here where it is and how far it gapes.)
fn slit(npc: &mut Npc, enter: &Crossing, cloths: &[Crossing], dir: Vec3, m: &Missile, deep: f32) {
    let n = enter.normal;
    let e = m.across.unwrap_or_else(|| dir.cross(if dir.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }));
    let e = (e - dir * e.dot(dir)).normalize();
    // (A thrust nearly along the skin would make a slit without end: no slant past about 70 degrees counts.)
    let dn = dir.dot(n).min(-0.35);
    let w = m.calibre * (deep / m.taper.unwrap_or(0.01)).clamp(0.15, 1.0);
    let sides = e - dir * (e.dot(n) / dn);
    let long = sides.length() * w;
    let half = sides.normalize() * ((long - SHRINKS).max(0.002) / 2.0); // world, from the middle to the edge end
    // The skin at each end, found on the body at rest.
    let to_rest = npc.rest_to_world(enter.owner).inverse();
    let along = to_rest.transform_vector3(half);
    let ends = [enter.rest - along, enter.rest + along].map(|p| npc.nearest_rest(p, 0.02));
    if !ends.iter().all(|h| h.as_ref().is_some_and(|h| h.kind == Kind::Skin)) {
        return;
    }
    // How far it gapes: by its angle to the tension lines, which run round the bone it is on (across the trunk and neck,
    // round a limb: stab-wounds.md sec. 3), give or take a third (Hunt 2003: the lines often fail to predict it).
    let a = along.length();
    let bone = &npc.body().bones[enter.owner];
    let axis = bone.tail - bone.head;
    let line = enter.rest_normal.cross(axis);
    let flat = if line.length_squared() > 1e-10 { line.normalize() } else { along.normalize() };
    let c = along.normalize().dot(flat);
    let sin2 = 1.0 - c * c;
    let open = (4.0 * (STRESS_ALONG * sin2 + STRESS_ACROSS * c * c) * a) / SKIN_E;
    let gape = (open / 2.0) * HELD_OPEN * (0.7 + npc.dice.next() * 0.6);
    let [a, b] = ends.map(Option::unwrap);
    // The clothes are slit the same way, cleanly, and the skin under them shows through it.
    npc.hurt.happened.push(Happened::Stab { ends: [a, b], gape, double: m.edges.unwrap_or(1) > 1, cloths: cloths.to_vec() });
}

// How big a bullet's way out is (dev/research/gunshot-blood.md sec. 3, DiMaio 1999 ch. 4 and 7): larger and more
// irregular than the way in because the bullet yaws, tumbles and deforms in the body; a handgun's often a small slit,
// sometimes smaller than its way in; a rifle's in the trunk mostly up to 25 mm, the largest DiMaio saw 75 x 40. Bigger
// once it has broken up on bone (`fragments`). The spread within those ranges is a guess.
fn exit_size(npc: &mut Npc, m: &Missile, fragments: f32) -> f32 {
    if m.name.is_some() {
        return m.calibre * 1.2;
    }
    let rifle = m.speed.unwrap_or(0.0) > 600.0;
    let k = if rifle { 1.6 + npc.dice.next() * 1.6 } else { 1.0 + npc.dice.next() * 0.8 };
    (m.calibre * k * fragments).min(0.075)
}

// How thick the fat under the skin is, by where (metres), for what a torn edge shows of it: a man's belly about 14 mm at
// a normal weight (tissue-mechanics.md sec. 1: 13.8 mm, JCDR; 17.9 mm at BMI 28, Derraik 2014); elsewhere estimates.
fn fat_under(seg: &str) -> f32 {
    match seg {
        "head" => 0.004,
        "forearm" => 0.004,
        "hand" => 0.002,
        "upperarm" => 0.006,
        "shin" => 0.005,
        "foot" => 0.003,
        "thigh" => 0.01,
        "chest" => 0.008,
        "belly" | "pelvis" => 0.014,
        _ => 0.008,
    }
}

// A segment's name without its side and half: /2?[LR]$/ gone.
pub fn base_of(seg: &str) -> &str {
    let s = seg.strip_suffix('L').or_else(|| seg.strip_suffix('R')).unwrap_or(seg);
    if s.len() < seg.len() { s.strip_suffix('2').unwrap_or(s) } else { s }
}

// A bullet's way out, torn right through the skin (not a picture on it): one slit (lax skin), two crossing (a star), or
// three (a star over bone: the scalp), `size` across. The lips turned out, the fat showing in them, no scraped ring
// (DiMaio 1999 ch. 4). Its shape is worked out here, with the TS's dice in the TS's order; the lips found round it on
// the skin and the hole cut are hider.rs's and marks.rs's (phase 3).
fn tear(npc: &mut Npc, h: &Crossing, size: f32, seg: &str) {
    let over_bone = seg == "head";
    let fat = fat_under(base_of(seg));
    let n = h.rest_normal;
    let side = n.cross(if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
    let up = n.cross(side);
    let arms = if over_bone { 3 } else if size < 0.012 { 1 } else { 1 + (npc.dice.next() * 2.0).floor() as usize };
    let turn = npc.dice.next() * std::f32::consts::PI;
    let mut out = Vec::new();
    for k in 0..arms {
        let t = turn + (k as f32 / arms as f32) * std::f32::consts::PI + (npc.dice.next() - 0.5) * 0.5;
        let ex = side * t.cos() + up * t.sin();
        // Each split a lens, its middle open about a fifth of its length (an estimate).
        let half = [(size / 2.0) * (0.75 + npc.dice.next() * 0.5), size * if arms > 1 { 0.12 } else { 0.2 }];
        out.push((ex, half));
    }
    npc.hurt.happened.push(Happened::Tear { hit: h.clone(), arms: out, lip: 0.0015 + size * 0.04, fat });
}

// Which part of the body a point of skin is on, in words.
pub fn region_of(npc: &Npc, point: Vec3) -> String {
    let seg = npc.nearest_name(point).unwrap_or("pelvis");
    let side = if seg.ends_with('L') { "left " } else if seg.ends_with('R') { "right " } else { "" };
    let base = base_of(seg);
    let word = match base {
        "head" | "chest" if npc.in_neck(point) => "neck",
        "head" => "head",
        "chest" => "chest",
        "belly" => "abdomen",
        "pelvis" => "pelvis",
        "upperarm" => "upper arm",
        "forearm" => "forearm",
        "hand" => "hand",
        "thigh" => "thigh",
        "shin" => "lower leg",
        "foot" => "foot",
        b => b,
    };
    format!("{side}{word}")
}

pub fn wound_text(m: &Missile, region: &str, deep: f32, through: bool) -> String {
    if m.slash {
        return if deep < 0.012 { format!("Cut to the {region}") } else { format!("Deep cut to the {region}") };
    }
    if m.blade {
        return if deep < 0.025 { format!("Cut to the {region}") } else { format!("Stab wound to the {region}, {} cm deep", js_round(deep * 100.0)) };
    }
    if let Some(name) = &m.name {
        return if through { format!("{} through the {region}", cap(name)) } else { format!("{} in the {region}, lodged", cap(name)) };
    }
    if through { format!("Gunshot through the {region}") } else { format!("Gunshot to the {region}, bullet lodged") }
}

// Math.round: halves up, toward +infinity.
pub fn js_round(x: f32) -> i64 {
    (x + 0.5).floor() as i64
}

// --- blows ---------------------------------------------------------------------------------------------------------

// What hits, in a blow: one of bones.rs's TOOLS by name ('fist', 'bat', 'flat', 'edge', 'hammer', 'wall'), or how
// stiff it is (N/m) if it is not plainly one of those (an empty cardboard box gives far more than the flesh, a fist and
// arm about 9 kN/m). None: a light fast thing is a bat, anything else a flat heavy thing.
#[derive(Clone, Copy, Debug)]
pub enum Tool {
    Named(&'static str),
    Stiff(f32),
}

// Something swung or thrown into the person at `point`, moving along `dir` at `speed` m/s with `mass` kg behind it.
// The peak force the bone or chest under it took (N; 0 where none was in the way).
pub fn blow(npc: &mut Npc, point: Vec3, dir: Vec3, mass: f32, speed: f32, tool: Option<Tool>) -> f32 {
    let pain = npc.vitals.pain;
    let first = npc.vitals.bleeds.len();
    let seg = npc.struck(point, dir);
    let skin = npc.surface(point - dir * 0.25, dir, 0.5, false).into_iter().find(|h| h.kind == Kind::Skin);
    let name = seg.map_or("chest".to_string(), |k| npc.person.segments[k].name.clone());
    let energy = 0.5 * mass * speed * speed;
    let base = base_of(&name).to_string();
    // The bone first in its way takes the force the flesh over it lets through (bones.rs); the soft parts take the energy.
    let force = seg.map_or(0.0, |k| npc.bones().impact(k, point, dir, mass, speed, tool));
    // (A blow to the throat is not one to the head: no concussion, nor the scalp's bleeding. What it breaks there, the
    // larynx, is bones.rs's.)
    if base == "head" && npc.in_neck(point) {
        npc.vitals.injure("Blow to the throat", 3.0);
    } else if base == "head" {
        let c = (npc.vitals.concussion() + energy / 160.0).min(1.0);
        npc.vitals.concuss(c, npc.dice);
        if energy > 90.0 {
            npc.vitals.bleed(Bleed::new("scalp", 0.0008).clots(0.01));
        }
        npc.vitals.injure(if energy > 60.0 { "Head struck: knocked out" } else { "Head struck" }, if energy > 60.0 { 6.0 } else { 3.0 });
    } else if base == "belly" && energy > 140.0 {
        let which = if npc.dice.next() < 0.5 { "spleen" } else { "liver" };
        if let Some(p) = npc.traced.parts.iter().position(|p| p.name == which) {
            rupture(npc, p, energy);
        }
    } else if base == "chest" && energy > 120.0 {
        // (The TS's `||`: no throw when the lung already leaks.)
        if !npc.vitals.lungs.leak_r {
            npc.vitals.lungs.leak_r = npc.dice.next() < 0.3;
        }
    }
    // One blow hurts as much as one blow can, whatever it broke.
    npc.vitals.pain = (npc.vitals.pain + energy / 400.0).min(1.0).min(pain + 0.45);
    let region = region_of(npc, point);
    npc.vitals.injure(format!("Blunt blow to the {region}"), 1.0 + energy / 100.0);
    if let Some(s) = &skin {
        for b in &mut npc.vitals.bleeds[first..] {
            b.source.mark = Some(s.clone());
        }
    }
    // Redness, bruising, swelling and split skin (bruise.rs), after the line above: its own bleeds come out where it says.
    npc.bruise().blow(skin.as_ref(), dir, mass, speed, tool);
    // The eye under it: blood under its white, in its front chamber, or burst by something narrower than the socket's
    // rim (eyes.rs; the socket's floor is bones.rs's).
    let narrow = match tool {
        Some(Tool::Named(t)) => t == "bat" || t == "edge" || t == "hammer",
        Some(Tool::Stiff(k)) => k > 1e5,
        None => mass < 1.2 && speed > 10.0,
    };
    if base == "head" {
        npc.eyes().struck(point, dir, energy, narrow);
    }
    npc.hit(point, dir * (mass * speed * 0.9), 0.0);
    force
}

fn rupture(npc: &mut Npc, p: usize, energy: f32) {
    let part = &npc.traced.clone().parts[p];
    npc.hurt_part(&part.name);
    npc.vitals.bleed(Bleed::new(&part.name, organ_bleed(&part.kind).unwrap_or(0.001) * (energy / 300.0).min(1.0)).internal(true).clots(0.003));
    npc.vitals.injure(format!("{} ruptured by the blow", cap(&part.name)), 6.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    // Energy spent: a pistol bullet (480 J, 12 J/cm) through 20 cm of soft tissue keeps 240 J; through 50 cm it stops at
    // 40 cm.
    #[test]
    fn energy_spend() {
        let (mut t, mut e, mut stop) = (0.0, 480.0, f32::INFINITY);
        assert!(spent(0.2, 12.0, &mut t, &mut e, &mut stop));
        assert!((e - 240.0).abs() < 1e-3 && (t - 0.2).abs() < 1e-6);
        assert!(!spent(0.5, 12.0, &mut t, &mut e, &mut stop));
        assert!((stop - 0.4).abs() < 1e-5 && e == 0.0);
    }

    // A carotid (r 3 mm) about a litre a minute, cut through; a jugular's 0.55 of an artery's.
    #[test]
    fn vessel_rates() {
        assert!((vessel_rate(0.003, true) - 0.0108).abs() < 1e-6);
        assert!((vessel_rate(0.004, false) - 0.0088).abs() < 1e-6);
        assert_eq!(organ_bleed("heart"), Some(0.07));
        assert_eq!(organ_bleed("cerebellum"), None);
    }

    #[test]
    fn words() {
        let gun = Missile { energy: 480.0, ..default() };
        assert_eq!(wound_text(&gun, "chest", 0.2, true), "Gunshot through the chest");
        assert_eq!(wound_text(&gun, "left thigh", 0.2, false), "Gunshot to the left thigh, bullet lodged");
        let knife = Missile { blade: true, ..default() };
        assert_eq!(wound_text(&knife, "abdomen", 0.085, false), "Stab wound to the abdomen, 9 cm deep");
        assert_eq!(wound_text(&knife, "abdomen", 0.02, false), "Cut to the abdomen");
        let frag = Missile { name: Some("fragment".into()), ..default() };
        assert_eq!(wound_text(&frag, "head", 0.05, false), "Fragment in the head, lodged");
        assert_eq!(base_of("thigh2L"), "thigh");
        assert_eq!(base_of("upperarmR"), "upperarm");
        assert_eq!(base_of("chest"), "chest");
        assert_eq!(js_round(2.5), 3);
    }
}
