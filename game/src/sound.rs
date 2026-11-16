// Sound (src/sound.ts): recordings, played so that they follow what is happening.
//
// Nothing here makes a sound. Every sound in the game is a recording of a real thing (the ElevenLabs takes in
// assets/sounds, tools/sfx.py; the people's cries in assets/cries), and all this does is decide which part of which
// recording is heard when, and how loud.
//
// A recording of a knife going through meat is somebody's ten strokes with pauses between. A blade in the game is
// drawn for as long and as fast as the player draws it. So a recording is not played from its start: what is kept of
// it is where the sound is (its bursts), and
//
//   a stream    plays through those, a short length at a time, each length faded into the next, for as long as it is
//               driven and as loud as it is driven. Stop driving it and it stops: a blade that halts is silent in a
//               twentieth of a second.
//   a shot      plays one burst, once: a thing put down, a thing that gives.
//
// A sound with a place in the world (`at`, or an entity it follows) is heard from there: louder near, quieter far,
// panned to the side it is on, duller through a wall. Everything is heard in the room it is in (`room`), and the whole
// goes through a limiter, so that nothing that sounds at once can clip.
//
// The mixing is kira's (0.12): Bevy's own audio (rodio) has no filters, sends or effects to build this from, and
// bevy_kira_audio's spatial sound is only a gain and a pan on each instance, so kira is used directly. Neither, nor
// any maintained Rust crate, does HRTF (the TS had Web Audio's HRTF panner): a sound with a place is panned between the
// ears at equal power, as Web Audio's 'equalpower' panner does, with its distance and the wall between as the TS had
// them. The room is kira's reverb (Freeverb) in place of the TS's convolution with a made ring; its decay and level
// are calibrated (ROOMS, RING) so that, as in the TS, the room and the sound itself are as loud at the hall's critical
// distance (the `sound` scenario measures it).
//
// Each sound is played twice, in step: once on its way to the ears (through its place's filter, distance and pan), and
// once into the room's ring, at the level it has before any of that. (Kira sends a track's output after its effects
// and its volume; the TS's room heard every sound with a place at the same level wherever it was, unmuffled, and that
// is what tells the ear how far off it is.)
//
// Without a sound device (the cloud machine) the mixer is not made: everything is still decided and recorded
// (`heard`), and nothing sounds. A scenario mixes into memory instead (`Tap`) so that what would be heard can be
// measured.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bevy::prelude::*;
use kira::backend::{Backend, Renderer};
use kira::effect::compressor::CompressorBuilder;
use kira::effect::filter::{FilterBuilder, FilterHandle, FilterMode};
use kira::effect::panning_control::{PanningControlBuilder, PanningControlHandle};
use kira::effect::reverb::ReverbBuilder;
use kira::info::Info;
use kira::sound::static_sound::{StaticSoundData, StaticSoundHandle, StaticSoundSettings};
use kira::sound::{PlaybackState, Sound as KiraSound, SoundData};
use kira::track::{MainTrackBuilder, TrackBuilder, TrackHandle};
use kira::{AudioManager, AudioManagerSettings, Capacities, Decibels, DefaultBackend, Frame, Mix, Panning, StartTime, Tween};

use crate::map::Map;
use crate::player::Player;
use crate::rng::Rng;

const LEVEL: f32 = 0.7; // how loud everything is: recordings are set near full scale, and several sound at once
const QUIET: f32 = 0.07; // a recording is sounding where it is louder than this much of its loudest
const HOP: f64 = 0.01; // seconds: how finely that is looked for
// Seconds: the shortest burst there is, the longest pause inside one, how far ahead of it to start, and how long a
// single one is left to ring when it is played alone.
struct Bursts {
    least: f64,
    joins: f64,
    lead: f64,
    rings: f64,
}
const BURST: Bursts = Bursts { least: 0.02, joins: 0.09, lead: 0.012, rings: 0.3 };
// A stream plays `length` seconds at a time, each faded over `fade` into the next; how loud it is driven is eased in
// over `eases` (a time constant).
struct Streaming {
    length: f64,
    fade: f64,
    eases: f64,
}
const STREAM: Streaming = Streaming { length: 0.22, fade: 0.07, eases: 0.035 };
// The rooms things are heard in: how long the room rings on (seconds to fall 60 dB), and how much of it is heard against
// the sound itself. (The TS also had how late the first of it comes back and how dark its made ring was; Freeverb's
// first echo comes 25 ms after the sound whatever the room, and how dark it is is its `damping`, the same for all.)
pub struct Room {
    pub rings: f32,
    pub wet: f32,
}
pub const ROOMS: [(&str, Room); 4] = [
    ("flat", Room { rings: 0.45, wet: 0.16 }),
    ("yard", Room { rings: 1.6, wet: 0.1 }),
    ("cold", Room { rings: 1.1, wet: 0.24 }),
    ("none", Room { rings: 0.05, wet: 0.0 }),
];
// Freeverb's combs (25 to 37 ms at 44.1 kHz): the mean of their lengths, from which a feedback giving a room's ring is
// worked out (each pass round a comb is that much quieter: RT60 = -3 D / log10(g)), and how much of the high end each
// pass loses (the TS's ring was a fairly bright noise: little).
const COMB: f32 = 1367.75 / 44100.0;
const DAMPING: f64 = 0.2;
// The ring's own level against the TS's convolver: what makes a sound at 2.8 m as loud in the room as itself, with the
// TS's FAR. Measured in the `sound` scenario: at 1.0 the room came out 4.4 dB over the shot itself.
const RING: f32 = 0.6;
// How a sound with a place falls away with distance (metres): Web Audio's inverse model, as the TS's panner had it.
struct Falls {
    near: f32,
    rolls: f32,
}
const FALLS: Falls = Falls { near: 1.5, rolls: 1.1 };
// How much of a sound with a place goes into the room's ring, whatever its distance: a room gives back about the same
// whether a voice is near or far, while the voice itself falls away, and how much of what is heard is room is the ear's
// measure of how far off a thing is. 4.5 makes the two equal at 2.8 m, the hall's critical distance: 0.057 * sqrt(volume
// / RT60) = 0.057 * sqrt(22 * 22 * 5.5 / 1.1).
const FAR: f32 = 4.5;
// A sound with something solid between it and the ears is heard round it, not through it: duller and quieter
// (diffraction over a barrier costs 5 to 15 dB, the most at high frequencies: Maekawa 1968).
// shortcut: hidden or not by the one straight line, no loss graded by how far round it is; grade it by the path
// difference if the change sounds abrupt at an edge.
const SHUT_FREQUENCY: f64 = 1000.0;
const SHUT_GAIN: f32 = 0.35;
const OPEN: f64 = 20000.0;
// The TS's lowpass had Q 0.5, which Web Audio takes in decibels for a lowpass: a peak of 0.5 dB, a linear Q of 1.06.
// Kira's state-variable filter has k = 2 - 1.9 resonance, and k = 1 / Q.
const RESONANCE: f64 = (2.0 - 1.0 / 1.059) / 1.9;

// Where in a recording something strikes: a foot coming down, a spade going in. A recording of somebody walking is never
// quiet between steps (there is the room, the coat, the other foot), so its bursts are the whole walk; a strike is where
// it gets suddenly louder than it has just been. Seconds, at least `apart` from each other.
struct Hits {
    rises: f32,
    over: f64,
    apart: f64,
    loudest: f32,
}
const HIT: Hits = Hits { rises: 2.6, over: 0.1, apart: 0.25, loudest: 0.12 };

// One recording: its samples, where it is sounding, where it strikes.
pub struct Take {
    pub data: StaticSoundData,
    pub bursts: Vec<(f64, f64)>,
    pub hits: Vec<f64>,
    pub duration: f64,
}

// How loud each HOP of a recording is (root mean square of its first channel).
fn loudness(frames: &[Frame], rate: u32) -> Vec<f32> {
    let hop = (HOP * rate as f64).round() as usize;
    frames.chunks_exact(hop).map(|c| (c.iter().map(|f| f.left * f.left).sum::<f32>() / hop as f32).sqrt()).collect()
}

// Where a recording is sounding: [(from, to), ...] in seconds.
fn bursts(loud: &[f32], duration: f64) -> Vec<(f64, f64)> {
    let floor = loud.iter().cloned().fold(0.0, f32::max) * QUIET;
    let mut found: Vec<(f64, f64)> = Vec::new();
    for (i, &level) in loud.iter().enumerate() {
        if level < floor {
            continue;
        }
        let t = i as f64 * HOP;
        match found.last_mut() {
            Some(last) if t - last.1 <= BURST.joins => last.1 = (i + 1) as f64 * HOP,
            _ => found.push(((t - BURST.lead).max(0.0), (i + 1) as f64 * HOP)),
        }
    }
    let kept: Vec<(f64, f64)> = found.into_iter().filter(|(a, b)| b - a >= BURST.least).collect();
    if kept.is_empty() { vec![(0.0, duration)] } else { kept }
}

fn hits(loud: &[f32]) -> Vec<f64> {
    let floor = loud.iter().cloned().fold(0.0, f32::max) * HIT.loudest;
    let back = (HIT.over / HOP).round() as usize;
    let mut found: Vec<f64> = Vec::new();
    for i in back..loud.len() {
        let before = loud[i - back..i].iter().sum::<f32>() / back as f32;
        if loud[i] > floor && loud[i] > before * HIT.rises && found.last().is_none_or(|&f| i as f64 * HOP - f >= HIT.apart) {
            found.push(i as f64 * HOP);
        }
    }
    found
}

fn read(path: &std::path::Path) -> Option<Take> {
    let data = StaticSoundData::from_file(path).map_err(|e| warn!("{}: {e}", path.display())).ok()?;
    let duration = data.duration().as_secs_f64();
    let loud = loudness(&data.frames, data.sample_rate);
    Some(Take { bursts: bursts(&loud, duration), hits: hits(&loud), duration, data })
}

fn db(gain: f32) -> Decibels {
    if gain <= 0.001 { Decibels::SILENCE } else { Decibels(20.0 * gain.log10()) }
}

fn tween(seconds: f64) -> Tween {
    Tween { duration: Duration::from_secs_f64(seconds), ..default() }
}

// How a sound is asked for (`Sound::play`).
#[derive(Clone, Copy)]
pub struct Play {
    // How loud, and at what speed (a little either way of 1 keeps two the same from sounding the same).
    pub gain: f32,
    pub rate: f32,
    // Seconds: with `most`, it is one strike instead (`hits`), cut off at most that long after it: a footstep.
    pub most: f32,
    // Heard from there; or from wherever the entity is (its GlobalTransform), each frame, until it ends: a voice from a
    // head that falls or is dragged, not from where it was when it began. Neither: heard as if from inside the head.
    pub at: Option<Vec3>,
    pub follow: Option<Entity>,
}

impl Default for Play {
    fn default() -> Self {
        Play { gain: 1.0, rate: 1.0, most: 0.0, at: None, follow: None }
    }
}

impl Play {
    pub fn at(at: Vec3) -> Self {
        Play { at: Some(at), ..default() }
    }
    pub fn gain(self, gain: f32) -> Self {
        Play { gain, ..self }
    }
    pub fn rate(self, rate: f32) -> Self {
        Play { rate, ..self }
    }
}

// What is playing, for whoever wants to follow it (a face mouthing its own voice) or stop it (`cut`).
pub struct Voice {
    pub name: String,
    // The take's samples, and which of them: from `from` seconds for `length`, at `rate` times their speed, begun at
    // `start` (Sound::now's clock).
    pub data: StaticSoundData,
    pub from: f64,
    pub length: f64,
    pub rate: f32,
    pub start: f64,
    handles: Vec<StaticSoundHandle>,
    cut: bool,
}

#[derive(Clone)]
pub struct Playing(Arc<Mutex<Voice>>);

impl Playing {
    // Cut off where it is, in 50 ms: a cry stops when the one crying is knocked out or killed.
    pub fn cut(&self) {
        let mut v = self.0.lock().unwrap();
        v.cut = true;
        for h in &mut v.handles {
            h.stop(tween(0.05));
        }
    }

    pub fn voice(&self) -> std::sync::MutexGuard<'_, Voice> {
        self.0.lock().unwrap()
    }
}

// A stream (`Sound::stream`): driven every frame by whoever has it; dropped, it falls silent and is let go of.
pub struct Stream(Arc<Driven>);

struct Driven {
    level: AtomicU32,
    rate: AtomicU32,
    gone: AtomicBool,
    at: Mutex<Option<Vec3>>,
}

impl Stream {
    // How loud it is to be from now (0 is silent), and how fast its recordings are to run.
    pub fn drive(&self, level: f32, rate: f32) {
        self.0.level.store(level.to_bits(), Ordering::Relaxed);
        self.0.rate.store(rate.to_bits(), Ordering::Relaxed);
    }

    // Heard from somewhere else now (only a stream made with a place has one).
    pub fn at(&self, at: Vec3) {
        let mut a = self.0.at.lock().unwrap();
        if a.is_some() {
            *a = Some(at);
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.0.gone.store(true, Ordering::Relaxed);
    }
}

// Where a sound with a place is heard from.
enum From {
    At(Vec3),
    Follow(Entity),
    Stream(Arc<Driven>),
}

// The mixer, when there is one: the main track's limiter, the dry track (sounds with no place), the room's ring and
// the two ways into it, and the track the places hang under.
struct Mixer {
    dry: TrackHandle,
    ring: TrackHandle,
    reverb: kira::effect::reverb::ReverbHandle,
    ring_dry: TrackHandle,
    ring_far: TrackHandle,
    direct: TrackHandle,
}

struct Place {
    from: From,
    at: Vec3,
    track: Option<(TrackHandle, FilterHandle, PanningControlHandle)>,
    voices: Vec<Playing>,
    stream: Option<Arc<Driven>>,
    first: bool,
}

// A sound asked for this frame, not yet sounding: made at the end of the frame, once everything that will be asked for
// in this moment has been (`together`).
struct Asked {
    take: Arc<Take>,
    from: f64,
    length: f64,
    fade_in: f64,
    fade_out: f64,
    gain: f32,
    rate: f32,
    place: Option<From>,
    voice: Playing,
    merged: u32,
}

// What was heard and how, for the scenarios' logs (drained by whoever reads it).
#[derive(Clone, Debug, serde::Serialize)]
pub struct Heard {
    pub name: String,
    pub take: usize,
    pub from: f64,
    pub length: f64,
    pub rate: f32,
    pub gain: f32,
    pub merged: u32,
    pub at: Option<[f32; 3]>,
    pub distance: Option<f32>,
    // What its place did to it as it began: the distance's gain, the wall's (and the lowpass's cutoff, Hz), the pan.
    pub falls: f32,
    pub hush: f32,
    pub cutoff: f64,
    pub pan: f32,
    pub time: f64,
}

#[derive(Resource)]
pub struct Sound {
    // A sound's name ("shot-pistol") and its takes, one picked each time it is played.
    pub takes: HashMap<String, Vec<Arc<Take>>>,
    mixer: Option<Mixer>,
    places: Vec<Place>,
    asked: Vec<Asked>,
    together: HashMap<String, Vec<usize>>,
    ear: Option<(Vec3, Quat)>,
    room: &'static str,
    // Its own dice, so what is heard never changes what the game's own random numbers do next.
    rng: Rng,
    now: f64,
    pub heard: Vec<Heard>,
    // For measuring (the `sound` scenario): the sounds' own way to the ears, or the room's, silenced.
    pub mute_direct: bool,
    pub mute_ring: bool,
    // The sandbox's room tone (sandbox.ts `world.tone`), driven always.
    pub tone: Option<Stream>,
}

// The mixer with no sound device: the scenarios render it here, a frame at a time, and keep how loud each frame was.
#[derive(Resource, Clone, Default)]
pub struct Tap(pub Arc<Mutex<Option<Renderer>>>);

// Each frame's energy at the ears (the sum of the squares of its samples, left and right) and its loudest sample.
#[derive(Resource, Default)]
pub struct Meter {
    pub frames: Vec<[f32; 3]>,
}

pub const RATE: u32 = 48000;

impl Backend for Tap {
    type Settings = Tap;
    type Error = ();

    fn setup(settings: Tap, _: usize) -> Result<(Self, u32), ()> {
        Ok((settings, RATE))
    }

    fn start(&mut self, renderer: Renderer) -> Result<(), ()> {
        *self.0.lock().unwrap() = Some(renderer);
        Ok(())
    }
}

impl Sound {
    fn new() -> Self {
        Sound {
            takes: HashMap::new(),
            mixer: None,
            places: Vec::new(),
            asked: Vec::new(),
            together: HashMap::new(),
            ear: None,
            room: "none",
            rng: Rng::new(20261115),
            now: 0.0,
            heard: Vec::new(),
            mute_direct: false,
            mute_ring: false,
            tone: None,
        }
    }

    // Whether there is any recording called `name`. (What has none is not heard: nothing is made up to stand in.)
    pub fn has(&self, name: &str) -> bool {
        self.takes.contains_key(name)
    }

    // Seconds since the sound began, the clock `Voice::start` is on.
    pub fn now(&self) -> f64 {
        self.now
    }

    // Heard as in the room called `name` (ROOMS) from now on.
    pub fn room(&mut self, name: &'static str) {
        self.room = name;
        let room = &ROOMS.iter().find(|r| r.0 == name).unwrap_or(&ROOMS[3]).1;
        if let Some(m) = &mut self.mixer {
            m.reverb.set_feedback(10f64.powf(-3.0 * COMB as f64 / room.rings as f64), tween(0.05));
            m.ring.set_volume(db(room.wet * RING), tween(0.05));
        }
    }

    // One burst of one of the recordings called `name`, now (once this frame is over), `how` (Play). None if there is
    // no such recording.
    // The same recording asked for again in the same moment from within a metre of where it is already sounding is that
    // one sound made louder (as loud as the two together, by their power), not another: a shotgun's nine pellets into one
    // body are one blow to the ear, and each sound with a place is a track and two voices of its own.
    pub fn play(&mut self, name: &str, how: Play) -> Option<Playing> {
        let takes = self.takes.get(name)?;
        if let (Some(at), None, true) = (how.at, how.follow, how.most == 0.0) {
            // (Any of them already asked for this moment, not only the first: a grenade's fragments into four people
            // asked for 123 at once, and the TS's first-only made 123 places.)
            let near = self.together.get(name).and_then(|ks| {
                ks.iter().copied().find(|&k| matches!(&self.asked[k].place, Some(From::At(there)) if there.distance(at) < 1.0))
            });
            if let Some(k) = near {
                let same = &mut self.asked[k];
                same.gain = (same.gain * same.gain + how.gain * how.gain).sqrt();
                same.merged += 1;
                return Some(same.voice.clone());
            }
        }
        let take = takes[(self.rng.next() * takes.len() as f32) as usize % takes.len()].clone();
        let rate = how.rate * (0.96 + self.rng.next() * 0.08);
        let (from, length, fade_out) = if how.most > 0.0 && !take.hits.is_empty() {
            let which = (self.rng.next() * take.hits.len() as f32) as usize % take.hits.len();
            let from = (take.hits[which] - BURST.lead).max(0.0);
            let next = take.hits.get(which + 1).map_or(take.duration, |h| h - BURST.lead);
            (from, (how.most as f64).min(next - from), 0.08)
        } else {
            let which = (self.rng.next() * take.bursts.len() as f32) as usize % take.bursts.len();
            let (from, to) = take.bursts[which];
            // It rings on after it has gone quiet, as far as the next one or the end.
            let until = (to + BURST.rings).min(take.bursts.get(which + 1).map_or(take.duration, |b| b.0));
            (from, until - from, 0.05)
        };
        let voice = Playing(Arc::new(Mutex::new(Voice {
            name: name.into(), data: take.data.clone(), from, length, rate, start: self.now, handles: Vec::new(), cut: false,
        })));
        let place = match (how.follow, how.at) {
            (Some(e), _) => Some(From::Follow(e)),
            (None, Some(at)) => Some(From::At(at)),
            _ => None,
        };
        if matches!(place, Some(From::At(_))) && how.most == 0.0 {
            self.together.entry(name.into()).or_default().push(self.asked.len());
        }
        self.asked.push(Asked { take, from, length, fade_in: 0.004, fade_out, gain: how.gain, rate, place, voice: voice.clone(), merged: 1 });
        Some(voice)
    }

    // A stream of the recordings called `name`, heard from `at` if it has one (moved with Stream::at). Silent until
    // driven.
    pub fn stream(&mut self, name: &str, at: Option<Vec3>) -> Option<Stream> {
        let takes = self.takes.get(name)?.clone();
        let driven = Arc::new(Driven { level: AtomicU32::new(0), rate: AtomicU32::new(1f32.to_bits()), gone: AtomicBool::new(false), at: Mutex::new(at) });
        let seed = (self.rng.next() * 4294967295.0) as u32 | 1;
        let mut place = at.map(|a| Place { from: From::Stream(driven.clone()), at: a, track: None, voices: Vec::new(), stream: Some(driven.clone()), first: true });
        if let Some(m) = &mut self.mixer {
            let grains = || Grains { takes: takes.clone(), driven: driven.clone(), seed, level: 0.0, lengths: Vec::with_capacity(4), next: 0.0, take: None };
            match &mut place {
                Some(p) => {
                    let t = Self::track(&mut m.direct);
                    p.track = Some(t);
                    let _ = p.track.as_mut().unwrap().0.play(grains());
                    let _ = m.ring_far.play(grains());
                }
                None => {
                    let _ = m.dry.play(grains());
                    let _ = m.ring_dry.play(grains());
                }
            }
        }
        if let Some(p) = place {
            self.places.push(p);
        }
        Some(Stream(driven))
    }

    // A place's own track: its lowpass (the wall), its pan, and its volume (the distance and the wall).
    fn track(direct: &mut TrackHandle) -> (TrackHandle, FilterHandle, PanningControlHandle) {
        let mut b = TrackBuilder::new().volume(Decibels::SILENCE);
        let filter = b.add_effect(FilterBuilder::new().mode(FilterMode::LowPass).cutoff(OPEN).resonance(RESONANCE));
        let pan = b.add_effect(PanningControlBuilder(Panning::CENTER.into()));
        let track = direct.add_sub_track(b).expect("sound: too many places at once");
        (track, filter, pan)
    }

    // What a place is to the ears where it is now: the distance's gain, the wall's gain and cutoff, the pan; and how far.
    fn hear(&self, at: Vec3, map: &Map) -> (f32, f32, f64, f32, f32) {
        let Some((ear, turn)) = self.ear else { return (1.0, 1.0, OPEN, 0.0, 0.0) };
        let d = ear.distance(at);
        let falls = FALLS.near / (FALLS.near + FALLS.rolls * (d.max(FALLS.near) - FALLS.near));
        let shut = map.screened(ear, at);
        // Equal power between the ears by the way it lies round the head, a sound behind heard as from the front
        // (Web Audio's 'equalpower').
        let local = turn.inverse() * (at - ear);
        let mut azimuth = local.x.atan2(-local.z).to_degrees();
        if azimuth > 90.0 {
            azimuth = 180.0 - azimuth;
        } else if azimuth < -90.0 {
            azimuth = -180.0 - azimuth;
        }
        let pan = if d < 1e-4 { 0.0 } else { azimuth / 90.0 };
        (falls, if shut { SHUT_GAIN } else { 1.0 }, if shut { SHUT_FREQUENCY } else { OPEN }, pan, d)
    }
}

// A stream's sound, on the mixer's thread: through the bursts of its recordings a length at a time, each length faded
// into the next exactly where the last will be when it fades (the two are the same sound there, and nothing is heard of
// the join), as loud and as fast as it is driven. Two of these with the same seed and the same driving play the same
// (the one to the ears and the one into the room).
struct Grains {
    takes: Vec<Arc<Take>>,
    driven: Arc<Driven>,
    seed: u32,
    level: f32,
    // Each length sounding: which take, where in it (its samples), how long it has played and lasts (s), its speed.
    lengths: Vec<(usize, f64, f64, f64, f64)>,
    // Seconds until the next length is due, and the take and burst it is in: (take, head, until).
    next: f64,
    take: Option<(usize, f64, f64)>,
}

impl Grains {
    fn dice(&mut self) -> f32 {
        self.seed = self.seed.wrapping_mul(1664525).wrapping_add(1013904223);
        self.seed as f32 / 4294967296.0
    }
}

impl SoundData for Grains {
    type Error = ();
    type Handle = ();

    fn into_sound(self) -> Result<(Box<dyn KiraSound>, ()), ()> {
        Ok((Box::new(self), ()))
    }
}

impl KiraSound for Grains {
    fn process(&mut self, out: &mut [Frame], dt: f64, _: &Info) {
        let driven = f32::from_bits(self.driven.level.load(Ordering::Relaxed));
        let rate = f32::from_bits(self.driven.rate.load(Ordering::Relaxed)) as f64;
        let ease = 1.0 - (-dt / STREAM.eases).exp() as f32;
        let step = STREAM.length - STREAM.fade;
        for frame in out.iter_mut() {
            if self.next <= 0.0 {
                if driven <= 0.0 {
                    // Silent, and nothing lined up: when it is next driven it starts somewhere new, at once.
                    self.take = None;
                    self.next = 0.0;
                } else {
                    // On through the burst it is in, or into another when this one runs out.
                    if self.take.is_none_or(|(_, head, until)| head + STREAM.length > until) {
                        let k = (self.dice() * self.takes.len() as f32) as usize % self.takes.len();
                        let t = &self.takes[k];
                        let long: Vec<(f64, f64)> = t.bursts.iter().cloned().filter(|(a, b)| b - a > STREAM.length).collect();
                        let (head, until) = if long.is_empty() { (0.0, t.duration) } else { long[(self.dice() * long.len() as f32) as usize % long.len()] };
                        self.take = Some((k, head, until));
                    }
                    let (k, head, until) = self.take.unwrap();
                    let sr = self.takes[k].data.sample_rate as f64;
                    self.lengths.push((k, head * sr, 0.0, STREAM.length, rate));
                    self.take = Some((k, head + step * rate, until));
                    self.next += step;
                }
            }
            self.next -= dt;
            self.level += (driven - self.level) * ease;
            let mut sum = 0.0;
            for (k, pos, age, lasts, r) in self.lengths.iter_mut() {
                let d = &self.takes[*k].data;
                let i = *pos as usize;
                let (a, b) = (d.frames.get(i).map_or(0.0, |f| f.left), d.frames.get(i + 1).map_or(0.0, |f| f.left));
                let s = a + (b - a) * (*pos - i as f64) as f32;
                let env = (*age / STREAM.fade).min(1.0).min((*lasts - *age) / STREAM.fade).max(0.0) as f32;
                sum += s * env;
                *pos += *r * d.sample_rate as f64 * dt;
                *age += dt;
            }
            self.lengths.retain(|l| l.2 < l.3);
            *frame = Frame::from_mono(sum * self.level);
        }
    }

    fn finished(&self) -> bool {
        self.driven.gone.load(Ordering::Relaxed)
    }
}

// Every recording the manifests name, read and looked through once.
fn load(mut sound: ResMut<Sound>) {
    let started = std::time::Instant::now();
    for dir in ["sounds", "cries"] {
        let path = crate::asset_file(&format!("{dir}/manifest.json"));
        let manifest: HashMap<String, Vec<String>> =
            serde_json::from_slice(&std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("sound manifest");
        for (name, files) in manifest {
            let takes: Vec<Arc<Take>> = files.iter().filter_map(|f| read(&crate::asset_file(&format!("{dir}/{f}")))).map(Arc::new).collect();
            if !takes.is_empty() {
                sound.takes.insert(name, takes);
            }
        }
    }
    info!("sound: {} recordings read in {:.1} s", sound.takes.len(), started.elapsed().as_secs_f32());
}

// The mixer: on the sound device, or for a scenario into memory (Tap); with neither, none.
fn mix(world: &mut World) {
    let scenario = std::env::args().any(|a| a == "--scenario");
    let main = MainTrackBuilder::new().with_effect(
        CompressorBuilder::new().threshold(-3.0).ratio(20.0).attack_duration(Duration::from_millis(2)).release_duration(Duration::from_millis(200)),
    );
    let capacities = Capacities { sub_track_capacity: 512, ..default() };
    let made = if scenario {
        let tap = Tap::default();
        world.insert_resource(tap.clone());
        world.init_resource::<Meter>();
        AudioManager::<Tap>::new(AudioManagerSettings { capacities, main_track_builder: main, backend_settings: tap, internal_buffer_size: 128 })
            .ok()
            .map(|mut m| (tracks(|b| m.add_sub_track(b).unwrap()), Box::new(m) as Box<dyn std::any::Any>))
    } else {
        match AudioManager::<DefaultBackend>::new(AudioManagerSettings { capacities, main_track_builder: main, ..default() }) {
            Ok(mut m) => Some((tracks(|b| m.add_sub_track(b).unwrap()), Box::new(m) as Box<dyn std::any::Any>)),
            Err(e) => {
                warn!("sound: no sound device ({e}); nothing will be heard");
                None
            }
        }
    };
    if let Some((mixer, manager)) = made {
        world.insert_non_send(Manager(manager));
        world.resource_mut::<Sound>().mixer = Some(mixer);
    }
    // The sandbox's room (sandbox.ts: 'cold'), and its tone, always there under everything.
    let mut sound = world.resource_mut::<Sound>();
    sound.room("cold");
    sound.tone = sound.stream("room-sandbox", None);
    if let Some(t) = &sound.tone {
        t.drive(0.35, 1.0);
    }
}

// (Kept so the mixer lives as long as the game: everything after it is done through the tracks' handles.)
struct Manager(#[allow(dead_code)] Box<dyn std::any::Any>);

fn tracks(mut add: impl FnMut(TrackBuilder) -> TrackHandle) -> Mixer {
    let mut ring = TrackBuilder::new().sub_track_capacity(4);
    let reverb = ring.add_effect(ReverbBuilder::new().feedback(0.8).damping(DAMPING).mix(Mix::WET));
    let mut ring = add(ring);
    let ring_dry = ring.add_sub_track(TrackBuilder::new().volume(db(LEVEL))).unwrap();
    let ring_far = ring.add_sub_track(TrackBuilder::new().volume(db(FAR))).unwrap();
    Mixer {
        dry: add(TrackBuilder::new().volume(db(LEVEL))),
        ring,
        reverb,
        ring_dry,
        ring_far,
        direct: add(TrackBuilder::new().sub_track_capacity(480)),
    }
}

// Where the ears are, and which way they face: the camera, once a frame; every place heard from where it is now; and
// what was asked for this frame made to sound.
fn listen(
    mut sound: ResMut<Sound>,
    map: Res<Map>,
    time: Res<Time>,
    eye: Query<&GlobalTransform, With<Player>>,
    things: Query<&GlobalTransform>,
) {
    let sound = &mut *sound;
    sound.now += time.delta_secs_f64();
    if let Ok(g) = eye.single() {
        let (_, turn, at) = g.to_scale_rotation_translation();
        if at.is_finite() {
            sound.ear = Some((at, turn));
        }
    }
    let room = sound.room;
    let wet = ROOMS.iter().find(|r| r.0 == room).map_or(0.0, |r| r.1.wet);
    if let Some(m) = &mut sound.mixer {
        m.ring.set_volume(db(if sound.mute_ring { 0.0 } else { wet * RING }), tween(0.02));
        m.dry.set_volume(db(if sound.mute_direct { 0.0 } else { LEVEL }), tween(0.02));
    }

    // What was asked for this moment, made.
    let asked = std::mem::take(&mut sound.asked);
    sound.together.clear();
    for a in asked {
        let mut place = a.place.map(|from| {
            let at = match &from {
                From::At(v) => *v,
                From::Follow(e) => things.get(*e).map_or(Vec3::ZERO, |g| g.translation()),
                From::Stream(_) => unreachable!(),
            };
            Place { from, at, track: None, voices: vec![a.voice.clone()], stream: None, first: true }
        });
        let (falls, hush, cutoff, pan, distance) = match &place {
            Some(p) => sound.hear(p.at, &map),
            None => (1.0, 1.0, OPEN, 0.0, 0.0),
        };
        let mut v = a.voice.voice();
        v.start = sound.now;
        sound.heard.push(Heard {
            name: v.name.clone(),
            take: sound.takes[&v.name].iter().position(|t| Arc::ptr_eq(t, &a.take)).unwrap_or(0),
            from: a.from,
            length: a.length,
            rate: a.rate,
            gain: a.gain,
            merged: a.merged,
            at: place.as_ref().map(|p| p.at.to_array()),
            distance: place.as_ref().map(|_| distance),
            falls,
            hush,
            cutoff,
            pan,
            time: sound.now,
        });
        let Some(m) = &mut sound.mixer else { continue };
        if v.cut {
            continue;
        }
        // A length of the recording, faded in and out, at its gain and speed: once to the ears, once into the room.
        let lasts = a.length / a.rate as f64;
        let data = a.take.data.slice(a.from..(a.from + a.length).min(a.take.duration)).with_settings(
            StaticSoundSettings::new().volume(db(a.gain)).playback_rate(a.rate as f64).fade_in_tween(tween(a.fade_in)),
        );
        let fade = Tween { start_time: StartTime::Delayed(Duration::from_secs_f64((lasts - a.fade_out).max(0.0))), ..tween(a.fade_out) };
        let mut handles = Vec::new();
        match &mut place {
            Some(p) => {
                let mut t = Sound::track(&mut m.direct);
                handles.extend(t.0.play(data.clone()).ok());
                handles.extend(m.ring_far.play(data).ok());
                p.track = Some(t);
            }
            None => {
                handles.extend(m.dry.play(data.clone()).ok());
                handles.extend(m.ring_dry.play(data).ok());
            }
        }
        for h in &mut handles {
            h.set_volume(Decibels::SILENCE, fade);
        }
        v.handles = handles;
        drop(v);
        if let Some(p) = place {
            sound.places.push(p);
        }
    }

    // Every place where it is now, and whether anything solid stands between it and the ears.
    let mut places = std::mem::take(&mut sound.places);
    places.retain_mut(|p| {
        let done = match &p.stream {
            Some(s) => s.gone.load(Ordering::Relaxed),
            None => p.voices.iter().all(|v| v.voice().handles.iter().all(|h| h.state() == PlaybackState::Stopped)),
        };
        if done {
            return false;
        }
        let at = match &p.from {
            From::At(v) => Some(*v),
            From::Follow(e) => things.get(*e).ok().map(|g| g.translation()),
            From::Stream(s) => *s.at.lock().unwrap(),
        };
        if let Some(at) = at.filter(|a| a.is_finite()) {
            p.at = at;
        }
        let (falls, hush, cutoff, pan, _) = sound.hear(p.at, &map);
        let gain = if sound.mute_direct { 0.0 } else { falls * hush };
        if let Some((track, filter, panning)) = &mut p.track {
            // (At once as it begins; eased after that, as the TS's setTargetAtTime.)
            let (t, f) = if p.first { (tween(0.0), tween(0.0)) } else { (tween(0.06), tween(0.1)) };
            track.set_volume(db(gain), t);
            filter.set_cutoff(cutoff, f);
            panning.set_panning(Panning(pan), t);
        }
        p.first = false;
        true
    });
    sound.places = places;
}

// The scenarios' mixer, a frame's worth of samples at a time, into the meter.
fn render(tap: Option<Res<Tap>>, meter: Option<ResMut<Meter>>, time: Res<Time>) {
    let (Some(tap), Some(mut meter)) = (tap, meter) else { return };
    let mut r = tap.0.lock().unwrap();
    let Some(r) = r.as_mut() else { return };
    let n = (time.delta_secs_f64() * RATE as f64).round() as usize;
    let mut buf = vec![0.0f32; n * 2];
    for chunk in buf.chunks_mut(256) {
        r.on_start_processing();
        r.process(chunk, 2);
    }
    let (mut l, mut rr, mut peak) = (0.0, 0.0, 0.0f32);
    for s in buf.chunks(2) {
        l += s[0] * s[0];
        rr += s[1] * s[1];
        peak = peak.max(s[0].abs()).max(s[1].abs());
    }
    meter.frames.push([l, rr, peak]);
}

// What hurt people say and what their hurts sound like (npc.rs Happened, the TS's npc.say and world.sound.shot): a cry
// (`kind`-`voice`, the voice being the body's) from the head, following it as it falls or is dragged; the one playing cut
// off when they are knocked out or killed mid-cry; a take at a place, or at the head.
fn hurts(mut sound: ResMut<Sound>, people: Query<(Entity, &crate::person::Person, &crate::npc::Hurt)>, mut saying: Local<HashMap<Entity, Playing>>) {
    use crate::npc::Happened;
    for (e, p, h) in &people {
        let head = p.body.by_name.get("head").map(|&i| p.joints[i]);
        for x in &h.happened {
            match x {
                Happened::Say { kind, gain } => {
                    if let Some(playing) = sound.play(&format!("{kind}-{}", p.body.name), Play { gain: *gain, follow: head, ..default() }) {
                        saying.insert(e, playing);
                    }
                }
                Happened::Cut => {
                    if let Some(playing) = saying.remove(&e) {
                        playing.cut();
                    }
                }
                Happened::Sound { name, at, gain } => {
                    sound.play(name, Play { gain: *gain, at: *at, follow: if at.is_some() { None } else { head }, ..default() });
                }
                _ => {}
            }
        }
    }
    saying.retain(|e, _| people.contains(*e));
}

// What the bodies make heard (thuds.rs): their thuds and falls where they happen, and a body dragged sliding on the
// floor, from where it is, as loud as it slides fast (the 'drag' stream, made the first time it is wanted).
fn bodies(mut sound: ResMut<Sound>, mut heard: MessageReader<crate::thuds::Heard>, dragging: Res<crate::thuds::Dragging>, mut drag: Local<Option<Stream>>) {
    for h in heard.read() {
        sound.play(h.name, Play::at(h.at).gain(h.gain));
    }
    if drag.is_none() && dragging.gain > 0.0 {
        *drag = sound.stream("drag", Some(dragging.at));
    }
    if let Some(d) = drag.as_ref() {
        d.at(dragging.at);
        d.drive(dragging.gain, 1.0);
    }
}

// A footfall heard (player.ts onStep): harder running, softer on the heels.
fn steps(mut sound: ResMut<Sound>, players: Query<&Player>, mut last: Local<u32>) {
    let Ok(p) = players.single() else { return };
    if p.steps != *last {
        *last = p.steps;
        let weight = if p.running { 1.0 } else { 0.55 - p.crouch * 0.3 };
        sound.play("step-tarmac", Play { gain: weight * 0.8, most: 0.4, ..default() });
    }
}

pub fn plugin(app: &mut App) {
    app.insert_resource(Sound::new())
        .add_systems(Startup, (load, mix).chain())
        .add_systems(Update, steps)
        .add_systems(PostUpdate, (hurts, bodies, crate::profiler::timed("sound", listen), render).chain().after(bevy::transform::TransformSystems::Propagate));
}

#[test]
fn bursts_of_a_made_signal() {
    // Silence, a tenth of a second of sound, a twentieth of silence (joined: under `joins`), more sound, then silence.
    let mut loud = vec![0.0; 10];
    loud.extend([1.0; 10]);
    loud.extend([0.0; 5]);
    loud.extend([1.0; 10]);
    loud.extend([0.0; 30]);
    let b = bursts(&loud, 0.65);
    assert_eq!(b.len(), 1);
    assert!((b[0].0 - (0.1 - BURST.lead)).abs() < 1e-9 && (b[0].1 - 0.35).abs() < 1e-9, "{b:?}");
    // A sudden rise is a hit; a steady level after it is not.
    let mut steady = vec![0.1; 20];
    steady.extend([1.0; 40]);
    assert_eq!(hits(&steady), vec![0.2]);
}

// The `sound` scenario: a take played at known places round the player, and what was done to it on its way to the ears
// (Heard: the distance's gain, the wall's, the pan) and how loud it came out (the Tap's meter), into the log. Then the
// room measured: how long it rings (RT60) and how loud it is against the sound itself at 2.8 m, the hall's critical
// distance, where the two should be equal; the same take asked for nine times at once (merged into one); a cry cut
// off; a stream driven and let go.
pub fn scenario() -> Vec<crate::scenario::Step> {
    use crate::scenario::{log, view, Step};
    use serde_json::json;
    // The player at the TS's (3.75, -6), looking north along the hall, the 2.2 m wall 2.5 m behind them.
    let mut s = view("sound_place", 3.75, -6.0, [3.75, 1.65, 4.0], 1.65);
    let quiet = |w: &mut World| {
        // (Drawn at a quarter of the window a side from here on: nothing more is looked at, and the software renderer
        // takes most of a second a frame at full size.)
        w.resource_mut::<crate::graphics::Graphics>().level = 4.0;
        let mut sound = w.resource_mut::<Sound>();
        sound.tone = None;
        sound.heard.clear();
    };
    s.push(Step::Do(Box::new(quiet)));
    s.push(Step::Wait(30));
    // Energy over `frames` from now, in dB (of a full-scale sine's per-frame energy), after `then` has run.
    fn measure(s: &mut Vec<Step>, what: String, frames: u32, then: impl FnMut(&mut World) + Send + Sync + 'static) {
        s.push(Step::Do(Box::new(|w: &mut World| w.resource_mut::<Meter>().frames.clear())));
        s.push(Step::Do(Box::new(then)));
        s.push(Step::Wait(frames));
        s.push(Step::Do(Box::new(move |w: &mut World| {
            let frames = std::mem::take(&mut w.resource_mut::<Meter>().frames);
            let energy: f32 = frames.iter().map(|f| f[0] + f[1]).sum();
            let peak = frames.iter().map(|f| f[2]).fold(0.0, f32::max);
            let curve: Vec<f32> = frames.iter().map(|f| (10.0 * ((f[0] + f[1]) / (RATE as f32 / 60.0)).max(1e-12).log10() * 10.0).round() / 10.0).collect();
            let heard = std::mem::take(&mut w.resource_mut::<Sound>().heard);
            // How fast it dies away once the sound itself is over: the slope between 20 and 45 dB under the loudest
            // frame, as seconds to fall 60 dB.
            let top = curve.iter().cloned().fold(-200.0, f32::max);
            let at = |below: f32| curve.iter().rposition(|&x| x >= top - below);
            let rt60 = match (at(20.0), at(45.0)) {
                (Some(a), Some(b)) if b > a => Some(60.0 * (b - a) as f32 / 60.0 / (curve[a] - curve[b]).max(1e-3)),
                _ => None,
            };
            log(w, json!({ "event": "sound", "what": what, "energy_db": 10.0 * (energy / RATE as f32).max(1e-12).log10(), "peak": peak,
                           "rt60": rt60, "heard": heard, "frames_db": curve }));
        })));
    }
    let ear = || crate::babylon(3.75, 1.65, -6.0);
    let play_at = |at: Vec3| move |w: &mut World| {
        w.resource_mut::<Sound>().play("shot-pistol", Play::at(at));
    };
    for (what, at) in [
        ("ahead 1 m", ear() + Vec3::NEG_Z),
        ("ahead 2.8 m", ear() + Vec3::NEG_Z * 2.8),
        ("ahead 10 m", ear() + Vec3::NEG_Z * 10.0),
        ("ahead 15 m (the far wall)", ear() + Vec3::NEG_Z * 15.0),
        ("left 3 m", ear() + Vec3::NEG_X * 3.0),
        ("right 3 m", ear() + Vec3::X * 3.0),
        ("ahead 4.5 m, in the open", ear() + Vec3::NEG_Z * 4.5),
        // (The TS's (3.75, 1.2, -10.5): behind the 2.2 m cover wall, 4.5 m off.)
        ("behind 4.5 m, through the wall", crate::babylon(3.75, 1.65, -10.5)),
    ] {
        measure(&mut s, what.into(), 150, play_at(at));
    }
    // No place: heard as from inside the head.
    measure(&mut s, "no place".into(), 150, |w: &mut World| {
        w.resource_mut::<Sound>().play("shot-pistol", Play::default());
    });
    // The room against the sound itself at 2.8 m, each alone.
    for (what, direct, ring) in [("2.8 m, the sound alone", false, true), ("2.8 m, the room alone", true, false)] {
        measure(&mut s, what.into(), 180, move |w: &mut World| {
            let mut sound = w.resource_mut::<Sound>();
            sound.mute_direct = direct;
            sound.mute_ring = ring;
            sound.play("shot-pistol", Play::at(ear() + Vec3::NEG_Z * 2.8));
        });
    }
    s.push(Step::Do(Box::new(|w: &mut World| {
        let mut sound = w.resource_mut::<Sound>();
        sound.mute_direct = false;
        sound.mute_ring = false;
    })));
    // Nine pellets into one body: one sound, as loud as the nine together.
    measure(&mut s, "nine at once".into(), 120, move |w: &mut World| {
        let mut sound = w.resource_mut::<Sound>();
        for k in 0..9 {
            sound.play("bullet-flesh", Play::at(ear() + Vec3::new(0.05 * k as f32, 0.0, -3.0)));
        }
    });
    // A cry cut off 0.3 s in.
    measure(&mut s, "a cry, its first 0.3 s".into(), 18, move |w: &mut World| {
        let p = w.resource_mut::<Sound>().play("scream-hood", Play::at(ear() + Vec3::new(1.0, 0.0, -2.0)));
        w.insert_resource(Cry(p));
    });
    measure(&mut s, "a cry, cut 0.3 s in".into(), 60, |w: &mut World| {
        if let Some(p) = &w.resource::<Cry>().0 {
            p.cut();
        }
    });
    // A drag: driven for a second, let go.
    s.push(Step::Do(Box::new(move |w: &mut World| {
        let st = w.resource_mut::<Sound>().stream("drag", Some(ear() + Vec3::new(0.5, -1.4, -1.5)));
        if let Some(st) = &st {
            st.drive(0.8, 1.0);
        }
        w.insert_resource(Dragging(st));
    })));
    measure(&mut s, "a drag, driven".into(), 60, |_: &mut World| {});
    measure(&mut s, "a drag, let go".into(), 30, |w: &mut World| {
        if let Some(st) = &w.resource::<Dragging>().0 {
            st.drive(0.0, 1.0);
        }
    });
    s.push(Step::Do(Box::new(|w: &mut World| {
        w.remove_resource::<Dragging>();
    })));
    s
}

#[derive(Resource)]
struct Cry(Option<Playing>);
#[derive(Resource)]
struct Dragging(Option<Stream>);
