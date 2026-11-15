// A person's circulation, breathing and brain, second by second (src/sandbox/vitals.ts).
//
// Not a health bar. Blood is litres in a body and comes out of holes at a rate set by how big the hole is, whether an
// artery is in it, and how hard the heart is pushing; the heart speeds up as the blood runs out, then cannot keep the
// pressure up; a brain short of pressure or oxygen switches the person off in seconds and is gone in minutes. The
// figures are the textbook ones: about 70 ml of blood to a kilo, the four classes of haemorrhage, a cut carotid
// emptying a person in a minute or two.

use bevy::prelude::*;

use crate::npc::Crossing;

const NORMAL_HR: f32 = 72.0;
const NORMAL_MAP: f32 = 93.0;
const NORMAL_SPO2: f32 = 98.0;
const NORMAL_RR: f32 = 14.0;
const SETTLE: f32 = 2.5; // seconds the heart rate and pressure take to follow what the body asks of them
const RESERVE: f32 = 10.0; // seconds a brain stays awake with no blood reaching it
const BRAIN_DEATH: f32 = 300.0; // seconds of no blood to the brain before it is gone for good
const COLLAPSE: f32 = 75.0; // seconds a punctured lung takes to collapse

// The dice everything medical throws (a knockout is a chance, an exit wound's size varies). The TS drew on Math.random;
// this is the generator the port's checks put in its place there (dev/PORT.md "Medicine"), so that a shot fired with
// the same seed in both throws the same numbers in the same order: s = s * 1103515245 + 12345 (mod 2^32), over 2^32.
#[derive(Resource, Clone)]
pub struct Dice(pub u32);

impl Dice {
    pub fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1103515245).wrapping_add(12345);
        (self.0 as f64 / 4_294_967_296.0) as f32
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rhythm {
    Sinus,
    Fibrillating,
    None,
}

// Where inside the body a bleed runs to (throat.rs), if not out of a wound.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Into {
    Mouth,
    Airway,
    Stomach,
    Nose,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    L,
    R,
}

// Where a bleed comes out: the place on the skin (a crossing, npc.rs), and the vessel it is, if it is one (a tube of
// the anatomy and the point along it), for whatever draws it (blood.rs, phase 3).
#[derive(Clone, Default, Debug)]
pub struct Source {
    pub mark: Option<Crossing>,
    pub tube: Option<(usize, usize)>,
}

#[derive(Clone, Debug)]
pub struct Bleed {
    pub name: String,
    // Litres a second at normal pressure, and how fast it clots down (per second).
    pub rate: f32,
    pub arterial: bool,
    pub internal: bool,
    pub clots: f32,
    pub lost: f32,
    pub spurts: bool,
    pub source: Source,
    // What is coming out now, litres a second.
    pub flow: f32,
    // What a dressing over it leaves of its flow, and the dressing (dressing.rs: an index into the person's).
    pub dressed: Option<f32>,
    pub dressing: Option<usize>,
    // Where inside it runs to (throat.rs), and which lung.
    pub into: Option<Into>,
    pub side: Option<Side>,
}

impl Bleed {
    // A bleed with the TS's defaults (vitals.ts bleed): not arterial, out of the body, clotting at 0.01.
    pub fn new(name: impl std::convert::Into<String>, rate: f32) -> Bleed {
        Bleed {
            name: name.into(), rate, arterial: false, internal: false, clots: 0.01, lost: 0.0, spurts: false, source: Source::default(), flow: 0.0,
            dressed: None, dressing: None, into: None, side: None,
        }
    }
    pub fn arterial(mut self, a: bool) -> Self {
        self.arterial = a;
        self
    }
    pub fn internal(mut self, i: bool) -> Self {
        self.internal = i;
        self
    }
    pub fn clots(mut self, c: f32) -> Self {
        self.clots = c;
        self
    }
    pub fn spurts(mut self, s: bool) -> Self {
        self.spurts = s;
        self
    }
    pub fn into(mut self, i: Into) -> Self {
        self.into = Some(i);
        self
    }
    pub fn side(mut self, s: Side) -> Self {
        self.side = Some(s);
        self
    }
    pub fn mark(mut self, m: Option<Crossing>) -> Self {
        self.source.mark = m;
        self
    }
    pub fn tube(mut self, tube: usize, at: usize) -> Self {
        self.source.tube = Some((tube, at));
        self
    }
}

#[derive(Clone, Debug)]
pub struct Injury {
    pub text: String,
    pub severity: f32,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Lungs {
    pub l: f32,
    pub r: f32,
    pub leak_l: bool,
    pub leak_r: bool,
}

impl Lungs {
    pub fn get(&self, s: Side) -> f32 {
        if s == Side::L { self.l } else { self.r }
    }
    pub fn set(&mut self, s: Side, v: f32) {
        if s == Side::L { self.l = v } else { self.r = v }
    }
    pub fn leak(&mut self, s: Side) {
        if s == Side::L { self.leak_l = true } else { self.leak_r = true }
    }
}

#[derive(Component, Clone)]
pub struct Vitals {
    pub full: f32,
    pub volume: f32,
    pub bleeds: Vec<Bleed>,
    pub pump: f32,
    pub rhythm: Rhythm,
    pub hr: f32,
    // Mean arterial pressure, mmHg.
    pub map: f32,
    pub spo2: f32,
    pub rr: f32,
    pub lungs: Lungs,
    pub airway: f32,
    // How much of each lung's airspace is full of blood, and of the throat blocked by blood pooled in it, 0 to 1
    // (throat.rs).
    pub flooded: (f32, f32),
    pub choked: f32,
    pub breathing: bool,
    pub reserve: f32,
    pub brain_damage: f32,
    pub starved: f32,
    concussion: f32,
    // Seconds left knocked out.
    pub out: f32,
    // 0 to 1: how muddled after a blow to the head, wearing off over minutes.
    pub daze: f32,
    pub pain: f32,
    pub paralysed_legs: bool,
    pub paralysed_arms: bool,
    // An eye that no longer sees (eyes.rs).
    pub blind: (bool, bool),
    pub injuries: Vec<Injury>,
    pub dead: bool,
    pub low_pressure: f32,
    pub beat: f32,
    // Heartbeats so far (the TS's onBeat callback: whatever beats with the heart counts them).
    pub beats: u32,
    pub time: f32,
    // Seconds since the heart last beat.
    pub stopped: f32,
}

impl Vitals {
    pub fn new(mass: f32) -> Self {
        let full = 0.07 * mass;
        Vitals {
            full, volume: full, bleeds: Vec::new(), pump: 1.0, rhythm: Rhythm::Sinus, hr: NORMAL_HR, map: NORMAL_MAP, spo2: NORMAL_SPO2, rr: NORMAL_RR,
            lungs: Lungs { l: 1.0, r: 1.0, leak_l: false, leak_r: false }, airway: 1.0, flooded: (0.0, 0.0), choked: 0.0, breathing: true,
            reserve: 1.0, brain_damage: 0.0, starved: 0.0, concussion: 0.0, out: 0.0, daze: 0.0, pain: 0.0, paralysed_legs: false,
            paralysed_arms: false, blind: (false, false), injuries: Vec::new(), dead: false, low_pressure: 0.0, beat: 0.0, beats: 0, time: 0.0,
            stopped: 0.0,
        }
    }

    pub fn lost(&self) -> f32 {
        1.0 - self.volume / self.full
    }

    pub fn beating(&self) -> bool {
        self.rhythm == Rhythm::Sinus
    }

    // 1 awake and making sense, down to 0.
    pub fn conscious(&self) -> f32 {
        if self.dead || !self.beating() {
            return self.reserve.min(0.3) * 0.5;
        }
        let brain = if self.brain_damage > 0.04 { 0.0 } else { 1.0 - self.brain_damage * 10.0 };
        let blood = ((self.reserve - 0.15) / 0.55).clamp(0.0, 1.0);
        let lost = self.lost();
        let shock = if lost > 0.38 { (1.0 - (lost - 0.38) / 0.08).max(0.0) } else { 1.0 };
        let knocked = if self.out > 0.0 { 0.12 } else { 1.0 - self.daze * 0.45 };
        brain.min(blood).min(shock).min(knocked).clamp(0.0, 1.0)
    }

    pub fn systolic(&self) -> i32 {
        (self.map * 1.32).round() as i32
    }

    pub fn diastolic(&self) -> i32 {
        (self.map * 0.84).round() as i32
    }

    // What a person in this state is, in a word or two.
    pub fn state(&self) -> &'static str {
        if self.dead {
            return "Dead";
        }
        if !self.beating() {
            return if self.rhythm == Rhythm::Fibrillating { "Cardiac arrest (fibrillating)" } else { "Cardiac arrest" };
        }
        if !self.breathing {
            return "Not breathing";
        }
        let c = self.conscious();
        if c < 0.35 {
            "Unconscious"
        } else if c < 0.75 {
            "Confused"
        } else if self.pain > 0.5 {
            "Conscious, in pain"
        } else {
            "Conscious"
        }
    }

    // How hard the brain has been shaken by blows to the head, 0 to 1. Only blows to the head add to it.
    pub fn concussion(&self) -> f32 {
        self.concussion
    }

    // Each blow is judged as it lands: a hard one knocks a person out for seconds to a minute or so, and they come round
    // muddled; a lighter one only dazes them. A knockout is a chance, not a certainty, and it does not come from a body
    // blow at all (dev/research/blunt-trauma.md: concussion follows the head's rotational acceleration, a punch is near
    // the threshold, a full bat swing well over it). (The TS's setter of `concussion`.)
    pub fn concuss(&mut self, value: f32, dice: &mut Dice) {
        let blow = value - self.concussion;
        self.concussion = value.clamp(0.0, 1.0);
        if blow <= 0.0 {
            return;
        }
        let chance = ((blow - 0.22) / 0.45).clamp(0.0, 1.0);
        if dice.next() < chance {
            self.out = self.out.max(4.0 + blow * 70.0 * (0.5 + dice.next()));
        }
        self.daze = (self.daze + blow * 0.8).min(1.0);
        if self.out > 0.0 {
            self.injuries.retain(|i| i.text != "Dazed by a blow to the head");
            self.injure("Knocked out by a blow to the head", 6.0);
        } else if blow > 0.15 && !self.injuries.iter().any(|i| i.text.starts_with("Knocked out")) {
            self.injure("Dazed by a blow to the head", 3.0);
        }
    }

    // A new bleed; its index in `bleeds`, which never shrinks.
    pub fn bleed(&mut self, b: Bleed) -> usize {
        self.bleeds.push(b);
        self.bleeds.len() - 1
    }

    pub fn injure(&mut self, text: impl AsRef<str>, severity: f32) {
        let text = text.as_ref();
        if !self.injuries.iter().any(|i| i.text == text) {
            self.injuries.push(Injury { text: text.to_string(), severity });
        }
        // (Stable, as the TS's sort: equal severities keep the order they came in.)
        self.injuries.sort_by(|a, b| b.severity.total_cmp(&a.severity));
    }

    // The heart stops, or never starts again.
    pub fn arrest(&mut self, rhythm: Rhythm) {
        if self.rhythm == Rhythm::Sinus {
            self.rhythm = rhythm;
        }
    }

    pub fn update(&mut self, dt: f32) {
        self.time += dt;
        let f = self.volume / self.full;
        // --- the heart and the pressure it makes
        let preload = ((f - 0.4) / 0.6).clamp(0.0, 1.0).powf(0.8);
        if self.beating() {
            let fear = self.pain.min(1.0) * 18.0;
            let want = (NORMAL_HR + 95.0 * ((1.0 - f) / 0.33).min(1.0) + fear).min(170.0);
            // Past what can be made up for, the heart slows and stops.
            let hr = if f < 0.5 { want * ((f - 0.4) / 0.1).max(0.35) } else { want };
            self.hr += (hr - self.hr) * (dt / SETTLE).min(1.0);
            let squeeze = 1.0 + 0.22 * ((1.0 - f) / 0.3).min(1.0);
            let map = NORMAL_MAP * preload * self.pump * (self.hr / NORMAL_HR).sqrt().min(1.15) * squeeze * (0.4 + 0.6 * (self.spo2 / 85.0).min(1.0));
            self.map += (map - self.map) * (dt / SETTLE).min(1.0);
            self.low_pressure = if self.map < 28.0 { self.low_pressure + dt } else { 0.0 };
            if self.low_pressure > 4.0 || f < 0.42 || self.pump < 0.15 || self.spo2 < 35.0 {
                self.arrest(if self.pump < 0.15 || self.spo2 < 35.0 { Rhythm::Fibrillating } else { Rhythm::None });
            }
            self.beat += dt * self.hr / 60.0;
            if self.beat >= 1.0 {
                self.beat -= 1.0;
                self.beats += 1;
            }
        } else {
            self.hr += (0.0 - self.hr) * (dt * 3.0).min(1.0);
            self.map += (6.0 - self.map) * (dt / 4.0).min(1.0);
            self.stopped += dt;
            // Fibrillation runs down to nothing in a few minutes without a shock.
            if self.stopped > 180.0 && self.rhythm == Rhythm::Fibrillating {
                self.rhythm = Rhythm::None;
            }
        }

        // --- blood out
        let mut out = 0.0;
        // With the heart stopped a wound still drains, by its own weight, slower and slower as the blood settles and
        // clots: a dead man shot in the head still bleeds onto the floor.
        let drains = if self.beating() { 0.0 } else { 0.2 * (-self.stopped / 300.0).exp() };
        for b in &mut self.bleeds {
            let push = (self.map.max(0.0) / NORMAL_MAP).powf(if b.arterial { 1.0 } else { 0.6 }).max(if b.internal { 0.0 } else { drains });
            b.flow = b.rate * push * b.dressed.unwrap_or(1.0);
            let lost = b.flow * dt;
            b.lost += lost;
            out += lost;
            b.rate *= (-b.clots * dt * if b.arterial { 0.15 } else { 1.0 }).exp();
        }
        self.volume = (self.volume - out).max(0.0);

        // --- breathing and oxygen
        if self.lungs.leak_l {
            self.lungs.l = (self.lungs.l - dt / COLLAPSE).max(0.05);
        }
        if self.lungs.leak_r {
            self.lungs.r = (self.lungs.r - dt / COLLAPSE).max(0.05);
        }
        // (Blood breathed into a lung fills the airspaces that would have taken up the oxygen: throat.rs.)
        let air = if self.breathing {
            ((self.lungs.l * (1.0 - self.flooded.0) + self.lungs.r * (1.0 - self.flooded.1)) / 2.0) * self.airway * (1.0 - self.choked)
        } else {
            0.0
        };
        self.rr = if self.breathing && self.beating() { NORMAL_RR + 16.0 * ((1.0 - f) / 0.35).min(1.0) + 10.0 * (1.0 - air) } else { 0.0 };
        let spo2 = if air > 0.0 && self.beating() { 70.0 + 28.0 * air.sqrt() } else { 20.0 };
        self.spo2 += (spo2 - self.spo2) * (dt / if spo2 < self.spo2 { 25.0 } else { 6.0 }).min(1.0);

        // --- the brain
        let reaching = ((self.map - 25.0) / 40.0).clamp(0.0, 1.0) * ((self.spo2 - 50.0) / 40.0).clamp(0.0, 1.0);
        if reaching < 0.5 {
            self.reserve = (self.reserve - dt / RESERVE * (1.0 - reaching * 2.0)).max(0.0);
        } else {
            self.reserve = (self.reserve + dt / 20.0).min(1.0);
        }
        self.starved = if self.reserve <= 0.05 { self.starved + dt } else { (self.starved - dt * 0.2).max(0.0) };
        self.concussion = (self.concussion - dt / 40.0).max(0.0);
        self.out = (self.out - dt).max(0.0);
        self.daze = (self.daze - dt / 240.0).max(0.0);
        self.pain = (self.pain - dt / 90.0).max(0.0);
        if self.starved > BRAIN_DEATH || self.brain_damage > 0.25 {
            self.dead = true;
        }
        if self.dead {
            if self.rhythm == Rhythm::Sinus {
                self.rhythm = Rhythm::None;
            }
            self.breathing = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Dice as the TS's checks seed Math.random: the first throw from 12345.
    #[test]
    fn dice_as_the_lcg() {
        let mut d = Dice(12345);
        let s = (12345u64 * 1103515245 + 12345) % (1 << 32);
        assert!((d.next() as f64 - s as f64 / 4294967296.0).abs() < 1e-7);
    }

    // A cut femoral artery (vessel rate at r = 4 mm: 1.2 * 16 * 0.001 = 19 ml/s at normal pressure) bleeds a 75 kg man
    // into cardiac arrest within a few minutes, and he is out cold well before.
    #[test]
    fn femoral_bleeds_out() {
        let mut v = Vitals::new(75.0);
        v.bleed(Bleed::new("femoral artery", 1.2 * 16.0 * 0.001).arterial(true).clots(0.004));
        let mut out_at = None;
        for k in 0..60 * 600 {
            v.update(1.0 / 60.0);
            if out_at.is_none() && v.conscious() < 0.35 {
                out_at = Some(k as f32 / 60.0);
            }
            if !v.beating() {
                break;
            }
        }
        assert!(!v.beating(), "still beating with {} L lost", v.full - v.volume);
        let t = v.time;
        assert!(t > 40.0 && t < 300.0, "arrest at {t}");
        assert!(out_at.unwrap() < t);
    }

    // Untouched, nothing moves off normal; a holed lung collapses to 5% in 75 s and the oxygen falls with it.
    #[test]
    fn steady_and_lung() {
        let mut v = Vitals::new(80.0);
        for _ in 0..600 {
            v.update(0.1);
        }
        assert!((v.hr - 72.0).abs() < 0.01 && (v.map - 93.0).abs() < 1.0 && (v.spo2 - 98.0).abs() < 0.01, "{} {} {}", v.hr, v.map, v.spo2);
        v.lungs.leak_r = true;
        for _ in 0..750 {
            v.update(0.1);
        }
        assert!((v.lungs.r - 0.05).abs() < 1e-4);
        // air = (1 + 0.05) / 2: spo2 falls toward 70 + 28 sqrt(0.525) = 90.3, a third of the way each 25 s.
        for _ in 0..2000 {
            v.update(0.1);
        }
        assert!(v.spo2 < 90.4 && v.spo2 > 90.2, "{}", v.spo2);
    }

    // The heart stopped: no pressure, the brain's reserve gone in ten seconds, dead after five minutes starved.
    #[test]
    fn arrest_to_death() {
        let mut v = Vitals::new(75.0);
        v.arrest(Rhythm::Fibrillating);
        for _ in 0..(60 * 320) {
            v.update(1.0 / 60.0);
        }
        assert!(v.dead && v.rhythm == Rhythm::None && !v.breathing);
    }
}
