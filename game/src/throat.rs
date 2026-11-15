// Blood in a person's mouth, airways and stomach, and where gravity, breath and reflexes take it
// (src/sandbox/throat.ts, dev/research/airway-blood.md). The pool in the mouth, the wet tongue and teeth, the tears in
// the tongue and every stream and spray it throws are drawn by phase 3 (blood.rs, face.rs): here what goes where.
//
// Three volumes, in millilitres: what lies in the mouth and the pharynx behind it, what has reached each lung's
// airways, and what is in the stomach. Blood comes into them from wounds (vitals.rs bleeds with `into`): a holed lung or
// windpipe bleeds into the airways, a torn tongue, cheek, broken jaw, knocked out tooth into the mouth, the back of a
// bleeding nose into the throat, a holed stomach or gullet into the stomach.
//
// The mouth drains by gravity, as the head lies now: out over the lower lip or a corner of the mouth when the face is
// turned down or to the side (the recovery position), and back toward the larynx when the person lies on their back or
// sits slumped upright. Awake, the throat protects itself: blood reaching the back of it is swallowed, a mouthful is
// spat out, and blood in the airways is coughed up into the mouth and out. Unconscious, the reflexes are gone, and every
// breath draws what lies in the throat down into the lungs, where it fills the airspaces that would have taken up oxygen
// (vitals `flooded`) and the pooled blood in the throat itself gurgles and narrows the airway (`choked`). The stomach
// does not keep much blood down: past a hundred millilitres or so it makes the person sick, and the retching brings it
// back up the gullet into the mouth, and out, or, lying on the back unconscious, into the lungs.

use bevy::prelude::*;

use crate::npc::{Crossing, Happened, Kind, Npc};
use crate::vitals::{Into, Side};

const HOLDS: f32 = 60.0; // ml the mouth and pharynx hold before more is pushed out between the lips (an estimate: a mouthful)
const POURS: f32 = 3.0; // 1/s: how fast a mouth turned down empties, as a share of what is in it, lips apart
const SWALLOW: f32 = 20.0; // ml in one swallow (a man's natural sip of water is about 21 ml: Adnerhill 1989)
const DRAWN: f32 = 0.2; // 1/s: share of the blood pooled at the back of the throat each breath draws in, unconscious, at 14 a minute
const SPOILS: f32 = 120.0; // ml of blood in one lung's airways that take away two thirds of what it can do (airway-blood.md sec. 2)
const CLEARS: f32 = 0.3; // share of the blood in a lung's large airways one cough brings up
const SICK: f32 = 30.0; // ml in the stomach before it starts to turn it (a pistol hole in it bleeds some 70 ml into it before clotting)
const HEAVE: f32 = 0.7; // seconds a retch takes
const EMPTIES: f32 = 1.2; // seconds the stomach takes to empty in one vomit
const SURGE: f32 = 0.3; // seconds: most of a vomit comes up in the first heave's surge, the rest after it

fn ramp(x: f32, a: f32, b: f32) -> f32 {
    ((x - a) / (b - a)).clamp(0.0, 1.0)
}

#[derive(Default)]
pub struct Throat {
    pub mouth: f32,
    pub lungs: (f32, f32),
    pub stomach: f32,
    // On its way up the gullet in a vomit.
    pub gullet: f32,
    // Share of the blood in the mouth that came up from the lungs, frothy, and that came up from the stomach.
    pub froth: f32,
    pub dark: f32,
    // 0 to 1: how much blood is on the tongue and teeth (face.rs draws it).
    pub coat: f32,
    pub tears: usize,
    pub nausea: f32,
    // Retches still to come before the vomit.
    pub heaves: u32,
    pub heave_t: f32,
    // Seconds left of a vomit, and the ml coming up out of the stomach in it.
    pub vomiting: f32,
    pub emptying: f32,
    // Degrees the jaw is forced open by a retch or a vomit (face.rs), and how far the body folds over (behaviour.rs).
    pub gape: f32,
    pub retch: f32,
    pub cough_in: f32,
    pub swallow_in: f32,
    pub breath: f32,
    pub pour: f32,
    // The three ways out of the mouth (the middle of the lower lip and the corners), places on the skin, and the middle
    // of the dental arch on the skull at rest and the bone that carries it.
    pub outlets: Vec<Crossing>,
    pub centre: Option<(Vec3, usize)>,
    pub fwd: Vec3,
    pub up: Vec3,
    pub right: Vec3,
    pub to_lips: f32,
    pub to_throat: f32,
}

impl Throat {
    pub fn spoiled(&self) -> (f32, f32) {
        (1.0 - (-self.lungs.0 / SPOILS).exp(), 1.0 - (-self.lungs.1 / SPOILS).exp())
    }
}

impl Npc<'_> {
    // Where the mouth is on this body: the middle of the dental arch (on the skull), and the three ways out of it, the
    // middle of the lower lip and the two corners, as places on the skin (found once, at rest, from the teeth: ahead is -Z
    // here, the TS's +Z; +X the person's right in both).
    pub fn find_mouth(&mut self) {
        self.hurt.throat.cough_in = 1.0;
        self.hurt.throat.swallow_in = 1.0;
        let teeth = self.hurt.teeth.teeth.clone();
        if teeth.is_empty() {
            return;
        }
        let body = self.person.body.clone();
        let at = |t: &crate::teeth::Tooth| (t.v0..=t.v1).map(|v| body.position[v as usize]).sum::<Vec3>() / (t.v1 - t.v0 + 1) as f32;
        let centre = teeth.iter().map(at).sum::<Vec3>() / teeth.len() as f32;
        let Some(head) = teeth.iter().find(|t| t.upper).map(|t| t.owner) else { return };
        self.hurt.throat.centre = Some((centre, head));
        let named = |f: &dyn Fn(&str) -> bool| teeth.iter().filter(|t| f(&t.name)).map(at).collect::<Vec<_>>();
        let front = named(&|n| n.starts_with("lower ") && n.ends_with(" central incisor"));
        let canines = named(&|n| n.starts_with("lower ") && n.ends_with(" canine"));
        let mut want = Vec::new();
        if !front.is_empty() {
            want.push(front.iter().sum::<Vec3>() / front.len() as f32 + Vec3::new(0.0, -0.006, -0.014));
        }
        for c in canines {
            want.push(c + Vec3::new(c.x.signum() * 0.011, 0.0, -0.006));
        }
        for p in want {
            if let Some(hit) = self.nearest_rest(p, 0.025).filter(|h| h.kind == Kind::Skin) {
                self.hurt.throat.outlets.push(hit);
            }
        }
    }

    // Where a line from `origin` along `dir` crosses the mouth, between `from` and `to` metres along it: a wound through
    // the tongue, the floor of the mouth, the palate or a cheek, which bleeds into the mouth.
    pub fn throat_crossed(&self, origin: Vec3, dir: Vec3, from: f32, to: f32) -> bool {
        let Some((rest, owner)) = self.hurt.throat.centre else { return false };
        let c = self.rest_to_world(owner).transform_point3(rest);
        let along = (c - origin).dot(dir);
        if along < from - 0.03 || along > to + 0.03 {
            return false;
        }
        (origin + dir * along - c).length_squared() < 0.024 * 0.024
    }

    // A shot or blade through the tongue (`hit`, its crossing of it): torn open there, its bleeding into the mouth
    // (wounds.rs's crossing of it). A bullet tears muscle wider than itself, and bruises round that (the card throat.ts drew
    // over it was twice the bullet across: an estimate).
    pub fn throat_tear(&mut self, hit: &Crossing, size: f32) {
        if self.hurt.throat.tears >= 6 {
            return;
        }
        self.hurt.throat.tears += 1;
        self.hurt.happened.push(Happened::Tongue { hit: hit.clone(), size: (size * 2.0).max(0.014) });
        self.vitals.injure("Tongue torn through", 4.0);
    }

}

impl<'a> Npc<'a> {
    pub fn throat<'n>(&'n mut self) -> ThroatOf<'n, 'a> {
        ThroatOf(self)
    }
}

pub struct ThroatOf<'n, 'a>(pub &'n mut Npc<'a>);

impl ThroatOf<'_, '_> {
    fn t(&mut self) -> &mut Throat {
        &mut self.0.hurt.throat
    }

    // A bleed with somewhere to go inside gives this frame's `ml` to it. Returns the share that still comes out of the
    // bleed's own wound: none, but the front of a nosebleed, which runs out of the nostrils as much as the head is upright
    // or face down and back into the throat as much as it lies face up.
    pub fn take(&mut self, into: Into, side: Option<Side>, ml: f32) -> f32 {
        match into {
            Into::Mouth => {
                self.t().mouth += ml;
                0.0
            }
            Into::Stomach => {
                self.t().stomach += ml;
                0.0
            }
            Into::Airway => {
                self.lungward(ml, side);
                0.0
            }
            Into::Nose => {
                let back = (0.25 + 0.6 * self.0.hurt.throat.fwd.y).clamp(0.05, 0.85);
                self.t().mouth += ml * back;
                1.0 - back
            }
        }
    }

    // Blood into the airways, shared between the lungs: the right main bronchus is wider and steeper and takes more (sec.
    // 2), and lying on one side, the lower lung takes most.
    fn lungward(&mut self, ml: f32, side: Option<Side>) {
        match side {
            Some(Side::L) => return self.t().lungs.0 += ml,
            Some(Side::R) => return self.t().lungs.1 += ml,
            None => {}
        }
        let tilt = self.0.segment("chest").map_or(0.0, |c| -(self.0.segment_world(c).rotation * Vec3::X).y);
        let r = (0.58 + 0.4 * tilt).clamp(0.1, 0.9);
        let t = self.t();
        t.lungs.1 += ml * r;
        t.lungs.0 += ml * (1.0 - r);
    }

    pub fn update(&mut self, dt: f32) {
        let Some(head) = self.0.segment("head") else { return };
        if dt <= 0.0 {
            return;
        }
        let rot = self.0.segment_world(head).rotation;
        // (The head's ahead is its -Z here, the TS's +Z.)
        let (f, u, r) = (rot * Vec3::NEG_Z, rot * Vec3::Y, rot * Vec3::X);
        // How much gravity pulls the mouth's blood toward the lips (the lower lip stands a little above the floor of the
        // mouth: upright, none goes over it), toward either corner (a head on its side), and toward the larynx, below and
        // behind the mouth (lying face up, or upright).
        let lip = -(f.y * 0.95 + u.y * 0.12);
        let corner = -(f.y * 0.55 + u.y * 0.1) + r.y.abs() * 0.8;
        {
            let t = self.t();
            (t.fwd, t.up, t.right) = (f, u, r);
            t.to_lips = lip.max(corner);
            t.to_throat = -(-f.y * 0.5 - u.y * 0.85);
        }
        let v = &*self.0.vitals;
        let alive = !v.dead && v.beating();
        let awake = if alive { v.conscious() } else { 0.0 };
        // The cough, gag and swallow need a working brainstem and somebody nearly awake; they fade with stupor (GCS 8 and
        // below protects no airway: sec. 4).
        let reflex = ramp(awake, 0.15, 0.5);
        let breathing = v.breathing && alive;
        let (rr, paralysed_arms) = (v.rr, v.paralysed_arms);

        self.stomach(dt, alive, awake);
        self.heave(dt, alive, awake);

        // --- the mouth: out between the lips by gravity, faster the more the jaw is open
        // port: phase 3 face. The TS read how far the face holds the jaw open now (face.jaw); here the pose's jaw, or how
        // far a broken jaw or a retch lets it hang.
        let jaw = self.0.bones().mouth_open().max(self.0.hurt.bones.jaw_hangs).max(self.0.hurt.throat.gape);
        let open = ramp(jaw, 1.0, 10.0);
        let mut out = 0.0;
        let t = self.t();
        if t.mouth > 0.05 {
            let drive = ramp(t.to_lips, 0.05, 0.6);
            out = t.mouth * (POURS * drive * (0.06 + 0.94 * open) * dt).min(1.0);
            // More than it holds is pushed out past the lips whichever way the head lies.
            if t.mouth - out > HOLDS {
                out = t.mouth - HOLDS;
            }
            t.mouth -= out;
        }
        if out > 0.0 {
            self.spill(out, dt);
        }

        // --- the back of the throat: swallowed awake, breathed in out cold
        let back = ramp(self.0.hurt.throat.to_throat, 0.1, 0.6);
        if self.0.hurt.throat.mouth > 0.05 && back > 0.0 {
            if reflex > 0.5 {
                self.t().swallow_in -= dt;
                if self.0.hurt.throat.swallow_in < 0.0 && self.0.hurt.throat.mouth > 4.0 {
                    // A mouthful awake and able: spat out, if the face is not turned up; otherwise swallowed.
                    let t = &self.0.hurt.throat;
                    if t.mouth > 5.0 && awake > 0.6 && t.to_lips > -0.5 && self.0.dice.next() < 0.6 {
                        self.spit();
                    } else {
                        let t = self.t();
                        let gulp = t.mouth.min(SWALLOW);
                        t.mouth -= gulp;
                        t.stomach += gulp;
                    }
                    self.t().swallow_in = 1.5 + self.0.dice.next() * 2.0;
                }
            } else if breathing {
                let t = self.t();
                let drawn = t.mouth * (DRAWN * back * (1.0 - reflex) * (rr / 14.0) * dt).min(1.0);
                t.mouth -= drawn;
                self.lungward(drawn, None);
            }
        }
        let t = self.t();
        if t.mouth < 0.05 {
            t.froth = 0.0;
            t.dark = 0.0;
        }

        // --- the airways: coughed up while there is a cough
        let wet = t.lungs.0 + t.lungs.1;
        if breathing && reflex > 0.3 && wet > 2.0 {
            self.t().cough_in -= dt;
            if self.0.hurt.throat.cough_in < 0.0 {
                self.t().cough_in = 1.2 + 4.0 * (-wet / 30.0).exp() * (0.6 + self.0.dice.next() * 0.8);
                // With the cord cut in the neck the belly's muscles that drive a cough are paralysed: what is left is the
                // diaphragm's and the neck's, a weak one (how weak is an estimate).
                self.cough(reflex * if paralysed_arms { 0.4 } else { 1.0 });
            }
        }
        let s = self.0.hurt.throat.spoiled();
        let mouth = self.0.hurt.throat.mouth;
        let v = &mut *self.0.vitals;
        v.flooded = s;
        // A pool at the back of the throat of someone who cannot clear it narrows the airway.
        v.choked = ramp(mouth, 15.0, 70.0) * back * (1.0 - reflex);

        // --- breaths heard through blood: in the throat, or in the big airways
        if breathing && rr > 0.0 {
            let t = self.t();
            t.breath += (dt * rr) / 60.0;
            if t.breath >= 1.0 {
                t.breath -= 1.0;
                let wet = t.lungs.0 + t.lungs.1;
                let gurgle = (ramp(t.mouth, 4.0, 30.0) * back * (1.0 - reflex * 0.7)).max(ramp(wet, 15.0, 120.0));
                // Breathing through blood in the big airways froths it, and each breath out drives some of the froth up the
                // windpipe into the throat with no cough to do it: the froth at the mouth and nose of the drowned (sec. 4;
                // how much a breath carries is an estimate).
                let frothed = ((wet - 30.0).max(0.0) * 0.01).min(2.0);
                if frothed > 0.0 {
                    t.lungs.0 -= (frothed * t.lungs.0) / wet;
                    t.lungs.1 -= (frothed * t.lungs.1) / wet;
                    t.froth = (t.froth * t.mouth + frothed) / (t.mouth + frothed);
                    t.mouth += frothed;
                }
                if gurgle > 0.15 {
                    self.0.sound("gurgle", None, 0.25 + 0.5 * gurgle);
                }
            }
        }
        // Blood in the mouth wets the tongue and teeth red, at once, and stays on them a while after it has gone (wiped off
        // by the tongue and saliva over a minute or so: an estimate). face.rs draws it (phase 3).
        let t = self.t();
        let want = ramp(t.mouth, 0.3, 12.0);
        t.coat = if want > t.coat { t.coat + (want - t.coat) * (dt * 4.0).min(1.0) } else { want.max(t.coat - dt / 60.0) };
    }

    // Blood out over the lips, `ml` this frame. It goes out at the lowest of the three ways out; a trickle runs down the
    // chin or cheek from there (runs.rs, which hangs it at the chin and drips it), and a pour falls as drops.
    fn spill(&mut self, ml: f32, dt: f32) {
        let Some((hit, at, out)) = self.lowest() else { return };
        self.t().pour += ml;
        let pour = self.0.hurt.throat.pour;
        if pour < 0.25 {
            return;
        }
        let rate = ml / dt;
        let happened = &mut self.0.hurt.happened;
        if rate < 1.5 {
            happened.push(Happened::Runs { hit: hit.clone(), ml: pour, from: None });
        } else {
            happened.push(Happened::Runs { hit: hit.clone(), ml: pour * 0.25, from: None });
            happened.push(Happened::Spray { at: at + out * 0.006, dir: (out * 0.3 + Vec3::NEG_Y).normalize(), speed: 0.35, ml: pour * 0.75, spread: 0.3, size: 2.5 });
        }
        happened.push(Happened::Blot { hit, r: 0.006, wet: 0.25 });
        self.t().pour = 0.0;
    }

    // The way out of the mouth lowest in the world now, placed: the crossing, where it is, and which way out of the mouth
    // it faces.
    fn lowest(&self) -> Option<(Crossing, Vec3, Vec3)> {
        let t = &self.0.hurt.throat;
        let mut best: Option<(Crossing, Vec3)> = None;
        for o in &t.outlets {
            let at = self.0.rest_to_world(o.owner).transform_point3(o.rest);
            if best.as_ref().is_none_or(|b| at.y < b.1.y) {
                best = Some((o.clone(), at));
            }
        }
        let (hit, at) = best?;
        let out = t.centre.map_or(Vec3::ZERO, |(rest, owner)| (at - self.0.rest_to_world(owner).transform_point3(rest)).normalize());
        Some((hit, at, out))
    }

    // A cough: a share of the blood in each lung's large airways up into the mouth, frothed with the air that drives it,
    // and most of the mouth thrown out of it in a spray of fine drops and a few clots (sec. 3).
    fn cough(&mut self, strength: f32) {
        let t = self.t();
        let mut up = 0.0;
        for lung in [&mut t.lungs.0, &mut t.lungs.1] {
            let c = (*lung * CLEARS * strength).min(15.0);
            *lung -= c;
            up += c;
        }
        t.froth = (t.froth * t.mouth + up) / (t.mouth + up).max(1e-6);
        t.mouth += up;
        // (Even a millilitre or two brought up comes out in the cough as a pink spray: frothed, it looks more than it is.)
        let wet = t.mouth > 0.5;
        if wet {
            self.0.sound("cough-wet", None, 0.9);
            self.0.hurt.said.until = self.0.hurt.clock + 1.5;
        } else {
            self.0.say("cough", 0.9, true);
        }
        if !wet {
            return;
        }
        if !self.0.vitals.injuries.iter().any(|i| i.text == "Coughing up blood") {
            self.0.vitals.injure("Coughing up blood", 5.0);
        }
        let Some((hit, at, out)) = self.lowest() else { return };
        let t = self.t();
        let thrown = t.mouth * 0.6 * strength;
        t.mouth -= thrown;
        let (fwd, froth, mouth) = (t.fwd, t.froth, t.mouth);
        let from = at + fwd * 0.008;
        let way = (fwd + out).normalize();
        // Frothy blood is fine: most of it a mist of small drops, carried far; the rest clots and strings that drop near.
        let happened = &mut self.0.hurt.happened;
        happened.push(Happened::Spray { at: from, dir: way, speed: 4.5, ml: thrown * 0.55, spread: 0.45, size: 0.45 + 0.4 * (1.0 - froth) });
        happened.push(Happened::Spray { at: from, dir: (way + Vec3::NEG_Y * 0.4).normalize(), speed: 1.4, ml: thrown * 0.45, spread: 0.35, size: 2.2 });
        happened.push(Happened::Runs { hit: hit.clone(), ml: mouth.min(1.5), from: None });
        happened.push(Happened::Blot { hit, r: 0.01, wet: 0.3 });
    }

    // A mouthful spat out, forward and down.
    fn spit(&mut self) {
        let Some((hit, at, _)) = self.lowest() else { return };
        let t = self.t();
        let ml = t.mouth * 0.85;
        t.mouth -= ml;
        let fwd = t.fwd;
        self.0.hurt.happened.push(Happened::Spray { at: at + fwd * 0.008, dir: (fwd + Vec3::NEG_Y * 0.3).normalize(), speed: 3.0, ml, spread: 0.15, size: 3.0 });
        self.0.hurt.happened.push(Happened::Runs { hit, ml: 0.4, from: None });
        self.0.sound("spit", None, 0.7);
    }

    // Blood in the stomach turns it: sicker the more there is, until the person retches (an estimate: no study gives the
    // volume, sec. 5).
    fn stomach(&mut self, dt: f32, alive: bool, awake: f32) {
        if !alive {
            self.t().nausea = 0.0;
            return;
        }
        let t = self.t();
        t.nausea = (t.nausea + dt * ((t.stomach - SICK).max(0.0) / 1500.0 - 0.004)).max(0.0);
        if t.nausea >= 1.0 && t.heaves == 0 && t.vomiting <= 0.0 {
            t.nausea = 0.0;
            let heaves = 2 + (self.0.dice.next() * 3.0 * awake).floor() as u32;
            self.t().heaves = heaves;
            self.t().heave_t = 0.0;
            self.sound("retch", 0.9);
        }
    }

    // Retching, then the vomit: the stomach squeezed by the belly's muscles, the body folding over it with each heave, the
    // jaw forced open, and what comes up driven up the gullet into the mouth and out of it. A person out cold still vomits,
    // weakly; what does not get out lies in the throat.
    fn heave(&mut self, dt: f32, alive: bool, awake: f32) {
        let (mut fold, mut gape) = (0.0, 0.0);
        if self.0.hurt.throat.heaves > 0 && alive {
            let t = self.t();
            t.heave_t += dt;
            let p = (std::f32::consts::PI * (t.heave_t / HEAVE).min(1.0)).sin();
            fold = p;
            gape = 18.0 * p;
            if t.heave_t >= HEAVE {
                t.heave_t = 0.0;
                t.heaves -= 1;
                if t.heaves == 0 {
                    t.vomiting = EMPTIES;
                    let stomach = t.stomach;
                    self.t().emptying = stomach * (0.6 + 0.3 * self.0.dice.next());
                    self.sound("vomit", 1.0);
                    if !self.0.vitals.injuries.iter().any(|i| i.text == "Vomiting blood") {
                        self.0.vitals.injure("Vomiting blood", 5.0);
                    }
                } else {
                    self.sound("retch", 0.8);
                }
            }
        }
        let t = self.t();
        if t.vomiting > 0.0 {
            // (Its share of the vomit this frame, out of a surge falling away over SURGE.)
            let was = EMPTIES - t.vomiting;
            let now = EMPTIES.min(was + dt);
            let up = t.stomach.min((t.emptying * ((-was / SURGE).exp() - (-now / SURGE).exp())) / (1.0 - (-EMPTIES / SURGE).exp()));
            t.stomach -= up;
            t.gullet += up;
            t.vomiting -= dt;
            fold = 1.0;
            gape = 30.0;
        }
        // Up the gullet in a fraction of a second; most of it out of the mouth with the force behind it.
        if t.gullet > 0.01 {
            let up = t.gullet * (dt * 10.0).min(1.0);
            t.gullet -= up;
            let forced = if t.vomiting > 0.0 { up * (0.35 + 0.55 * ramp(awake, 0.1, 0.6)) } else { 0.0 };
            if up > forced {
                t.dark = (t.dark * t.mouth + up - forced) / (t.mouth + up - forced);
            }
            t.mouth += up - forced;
            if forced > 0.0 {
                self.gush(forced, dt);
            }
        }
        let t = self.t();
        t.gape += (gape - t.gape) * (dt * 12.0).min(1.0);
        // port: needs body (behaviour's `retch`: the body folding over with each heave).
        t.retch = fold * (0.4 + 0.6 * ramp(awake, 0.1, 0.6));
    }

    // Vomit out of the open mouth: a rope of it as thick as the flow and the gape make it, leaving slower than it looks (the
    // mouth is wide, and a wide mouth lets it out without speed), with clots in it thrown as lumps; where it lands, it
    // splashes and pools (blood.rs, floor.rs).
    fn gush(&mut self, ml: f32, dt: f32) {
        let Some((hit, at, out)) = self.lowest() else { return };
        let speed = 0.8 + 0.7 * self.0.dice.next();
        let q = (ml * 0.8 * 1e-6) / dt;
        let r = (q / (std::f32::consts::PI * speed)).sqrt().clamp(0.003, 0.012);
        let fwd = self.0.hurt.throat.fwd;
        let way = (fwd * 0.8 + out * 0.4 + Vec3::NEG_Y * 0.3).normalize();
        let from = at + fwd * 0.01;
        let happened = &mut self.0.hurt.happened;
        happened.push(Happened::Stream { bleed: None, at: from, dir: way, speed, ml: ml * 0.8, r });
        happened.push(Happened::Spray { at: from, dir: way, speed, ml: ml * 0.2, spread: 0.3, size: 3.0 });
        happened.push(Happened::Runs { hit, ml: ml * 0.04, from: None });
    }

    fn sound(&mut self, name: &str, gain: f32) {
        self.0.sound(name, None, gain);
        self.0.hurt.said.until = self.0.hurt.clock + 2.0;
    }
}
