// Sound: recordings, played so that they follow what is happening.
//
// Nothing here makes a sound. Every sound in the game is a recording of a
// real thing (tools/sounds.py says which, and whose), and all this does is
// decide which part of which recording is heard when, and how loud.
//
// A recording of a knife going through meat is somebody's ten strokes with
// pauses between. A blade in the game is drawn for as long and as fast as
// the player draws it. So a recording is not played from its start: what is
// kept of it is where the sound is (its bursts), and
//
//   a stream    plays through those, a short length at a time, each length
//               faded into the next, for as long as it is driven and as
//               loud as it is driven. Stop driving it and it stops: a
//               blade that halts is silent in a twentieth of a second.
//   a shot      plays one burst, once: a thing put down, a thing that gives.
//
// A sound with a place in the world (`at`) is heard from there, through the
// head (HRTF): the van behind the bars, the sexton's spade over the wall.
// Everything is heard in the room it is in (`room`), and the whole goes
// through a limiter, so that nothing that sounds at once can clip.

import * as BABYLON from '@babylonjs/core';

const LEVEL = 0.7;              // how loud everything is: recordings are set near full scale, and several sound at once
const QUIET = 0.07;             // a recording is sounding where it is louder than this much of its loudest
const HOP = 0.01;               // seconds: how finely that is looked for
// Seconds: the shortest burst there is, the longest pause inside one, how far ahead of it to start, and how long a
// single one is left to ring when it is played alone.
const BURST = { least: 0.02, joins: 0.09, lead: 0.012, rings: 0.3 };
// A stream plays `length` seconds at a time, each faded over `fade` into the
// next, and is told what to do about `ahead` seconds before it is heard.
const STREAM = { length: 0.22, fade: 0.07, ahead: 0.12, eases: 0.035 };
// The rooms things are heard in: how long the room rings on (seconds to fall 60 dB), how late the first of it comes
// back (seconds), how much of it is heard against the sound itself, and how dark it is (the share of each sample of
// the ring carried into the next: more is duller).
const ROOMS = {
    flat: { rings: 0.45, late: 0.008, wet: 0.16, dark: 0.55 },
    yard: { rings: 1.6, late: 0.045, wet: 0.1, dark: 0.75 },
    cold: { rings: 1.1, late: 0.006, wet: 0.24, dark: 0.3 },
    none: { rings: 0.05, late: 0, wet: 0, dark: 0 },
};
// How a sound with a place falls away with distance (metres).
const FALLS = { near: 1.5, far: 60, rolls: 1.1 };
// How much of a sound with a place goes into the room's ring, whatever its distance: a room gives back about the same
// whether a voice is near or far, while the voice itself falls away, and how much of what is heard is room is the
// ear's measure of how far off a thing is. 4.5 makes the two equal at 2.8 m (measured through this panner and the
// 'cold' ring), the hall's critical distance: 0.057 * sqrt(volume / RT60) = 0.057 * sqrt(22 * 22 * 5.5 / 1.1).
const FAR = 4.5;
// A sound with something solid between it and the ears is heard round it, not through it: duller and quieter
// (diffraction over a barrier costs 5 to 15 dB, the most at high frequencies: Maekawa 1968).
// shortcut: hidden or not by the one straight line, no loss graded by how far round it is; grade it by the path
// difference if the change sounds abrupt at an edge.
const SHUT = { frequency: 1000, gain: 0.35 }, OPEN = 20000;

// Where a recording is sounding: [[from, to], ...] in seconds.
function bursts(buffer) {
    const data = buffer.getChannelData(0), hop = Math.round(HOP * buffer.sampleRate), loud = [];
    for (let i = 0; i + hop <= data.length; i += hop) {
        let sum = 0;
        for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
        loud.push(Math.sqrt(sum / hop));
    }
    const floor = Math.max(...loud) * QUIET, found = [];
    loud.forEach((level, i) => {
        if (level < floor) return;
        const last = found[found.length - 1];
        if (last && i * HOP - last[1] <= BURST.joins) last[1] = (i + 1) * HOP;
        else found.push([Math.max(0, i * HOP - BURST.lead), (i + 1) * HOP]);
    });
    const kept = found.filter(([from, to]) => to - from >= BURST.least);
    return kept.length ? kept : [[0, buffer.duration]];
}

// Where in a recording something strikes: a foot coming down, a spade going in. A recording of somebody walking
// is never quiet between steps (there is the room, the coat, the other foot), so its bursts are the whole walk; a
// strike is where it gets suddenly louder than it has just been. Seconds, at least `HIT.apart` from each other.
const HIT = { rises: 2.6, over: 0.1, apart: 0.25, loudest: 0.12 };
function hits(buffer) {
    const data = buffer.getChannelData(0), hop = Math.round(HOP * buffer.sampleRate), loud = [];
    for (let i = 0; i + hop <= data.length; i += hop) {
        let sum = 0;
        for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
        loud.push(Math.sqrt(sum / hop));
    }
    const floor = Math.max(...loud) * HIT.loudest, back = Math.round(HIT.over / HOP), found = [];
    for (let i = back; i < loud.length; i++) {
        let before = 0;
        for (let j = i - back; j < i; j++) before += loud[j];
        before /= back;
        if (loud[i] > floor && loud[i] > before * HIT.rises && (!found.length || i * HOP - found[found.length - 1] >= HIT.apart)) found.push(i * HOP);
    }
    return found;
}

const FORWARD = BABYLON.Vector3.Forward(), UP = BABYLON.Vector3.Up();

export class Sound {
    declare context: AudioContext;
    declare out: GainNode;
    declare takes: Map<any, any>;
    declare streams: any[];
    declare limiter: DynamicsCompressorNode;
    declare ring: ConvolverNode;
    declare wet: GainNode;
    declare rooms: Map<string, AudioBuffer>;
    declare direct: GainNode;
    declare far: GainNode;
    declare placed: Set<Place>;
    declare ear: number[] | null;
    declare screened: ((a: number[], b: number[]) => boolean) | null;

    constructor() {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        const context = this.context;
        this.out = context.createGain();
        this.out.gain.value = LEVEL;
        // Straight to the limiter, and through the room's ring to it as well.
        this.limiter = context.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.2;
        this.ring = context.createConvolver();
        this.wet = context.createGain();
        this.out.connect(this.limiter);
        this.out.connect(this.ring).connect(this.wet).connect(this.limiter);
        // A sound with a place: itself straight to the limiter, and into the ring at the same level wherever it is.
        this.direct = context.createGain();
        this.direct.connect(this.limiter);
        this.far = context.createGain();
        this.far.gain.value = FAR;
        this.far.connect(this.ring);
        this.placed = new Set();
        this.ear = null;
        this.screened = null;       // whether something solid stands between two places (the map says)
        this.limiter.connect(context.destination);
        this.rooms = new Map();
        this.room('none');
        this.takes = new Map();         // name -> [{ buffer, bursts }]
        this.streams = [];
        // A page may not sound until somebody has touched it.
        for (const first of ['pointerdown', 'keydown']) window.addEventListener(first, () => this.context.resume(), { once: true });
    }

    // Fetch the recordings a manifest names: { name: [file, ...] }, files under `base`.
    async load(base: string, manifest: Record<string, string[]>) {
        await Promise.all(Object.entries(manifest).map(async ([name, files]) => {
            this.takes.set(name, await Promise.all(files.map(async (file) => {
                const res = await fetch(base + file);
                if (!res.ok) throw new Error(base + file + ': ' + res.status);
                const buffer = await this.context.decodeAudioData(await res.arrayBuffer());
                return { buffer, bursts: bursts(buffer), hits: hits(buffer) };
            })));
        }));
        return this;
    }

    // Heard as in the room called `name` (ROOMS) from now on.
    room(name) {
        const room = ROOMS[name] || ROOMS.none;
        if (!this.rooms.has(name)) this.rooms.set(name, this._ringing(room));
        this.ring.buffer = this.rooms.get(name);
        this.wet.gain.setTargetAtTime(room.wet, this.context.currentTime, 0.05);
    }

    // Where the ears are, and which way they face: a camera, once a frame.
    listen(camera) {
        const { listener, currentTime: now } = this.context, at = camera.globalPosition, ahead = camera.getDirection(FORWARD), up = camera.getDirection(UP);
        if (!Number.isFinite(at.x + at.y + at.z)) return;
        this.ear = [at.x, at.y, at.z];
        // (Babylon's world is left-handed and Web Audio's right-handed: z is turned round.)
        // Firefox's listener has no positionX and the rest, only the older setPosition and setOrientation.
        if (!listener.positionX) {
            listener.setPosition(at.x, at.y, -at.z);
            listener.setOrientation(ahead.x, ahead.y, -ahead.z, up.x, up.y, -up.z);
            return;
        }
        for (const [param, value] of [[listener.positionX, at.x], [listener.positionY, at.y], [listener.positionZ, -at.z],
            [listener.forwardX, ahead.x], [listener.forwardY, ahead.y], [listener.forwardZ, -ahead.z],
            [listener.upX, up.x], [listener.upY, up.y], [listener.upZ, -up.z]]) param.setTargetAtTime(value, now, 0.02);
    }

    // A place in the world to hear something from, [x, y, z] in the game's world, or wherever `follow` says each frame;
    // its `input` is what the sound goes into. Let go of with release().
    place(at, follow = null): Place {
        const context = this.context;
        const input = context.createGain(), muffle = new BiquadFilterNode(context, { type: 'lowpass', frequency: OPEN, Q: 0.5 }), hush = context.createGain();
        const panner = new PannerNode(context, {
            panningModel: 'HRTF', distanceModel: 'inverse', refDistance: FALLS.near, maxDistance: FALLS.far, rolloffFactor: FALLS.rolls,
            positionX: at[0], positionY: at[1], positionZ: -at[2],
        });
        input.connect(muffle).connect(hush).connect(panner).connect(this.direct);
        input.connect(this.far);
        const place = { input, muffle, hush, panner, at, follow };
        this.placed.add(place);
        this._hear(place, true);
        return place;
    }

    release(place: Place) {
        for (const node of [place.input, place.muffle, place.hush, place.panner]) node.disconnect();
        this.placed.delete(place);
    }

    // Where a place is now, and whether anything solid stands between it and the ears.
    _hear(place: Place, first = false) {
        const now = this.context.currentTime, at = place.follow ? place.follow() : place.at;
        if (!Number.isFinite(at[0] + at[1] + at[2])) return;
        place.at = at;
        if (!first) {
            place.panner.positionX.setTargetAtTime(at[0], now, 0.03);
            place.panner.positionY.setTargetAtTime(at[1], now, 0.03);
            place.panner.positionZ.setTargetAtTime(-at[2], now, 0.03);
        }
        const shut = !!(this.ear && this.screened?.(this.ear, at));
        if (first) { place.muffle.frequency.value = shut ? SHUT.frequency : OPEN; place.hush.gain.value = shut ? SHUT.gain : 1; return; }
        place.muffle.frequency.setTargetAtTime(shut ? SHUT.frequency : OPEN, now, 0.05);
        place.hush.gain.setTargetAtTime(shut ? SHUT.gain : 1, now, 0.05);
    }

    // The ring of a room, made once: a burst that dies away as the room's walls give back less of it each time, darker
    // the further it goes, a little different in each ear.
    _ringing({ rings, late, dark }) {
        const rate = this.context.sampleRate, length = Math.ceil((rings + late) * rate), buffer = this.context.createBuffer(2, length, rate);
        for (let ear = 0; ear < 2; ear++) {
            const data = buffer.getChannelData(ear);
            let held = 0;
            for (let i = Math.floor(late * rate); i < length; i++) {
                const t = i / rate - late;
                held = held * dark + (Math.random() * 2 - 1) * (1 - dark);
                data[i] = held * Math.pow(10, -3 * t / rings);
            }
        }
        return buffer;
    }

    // Whether there is any recording called `name`. (What has none is not heard: nothing is made up to stand in.)
    has(name) { return this.takes.has(name); }

    // A stream of the recordings called `name`; heard from a place (`at`) if it has one.
    stream(name, at = null) {
        const stream = new Stream(this, this.takes.get(name), at ? this.place(at) : null);
        this.streams.push(stream);
        return stream;
    }

    // One burst of one of the recordings called `name`, now: `gain` loud,
    // at `rate` times its own speed (a little either way of 1 keeps two the
    // same from sounding the same).
    // With `most` (seconds) it is one strike instead (`hits`), cut off at most that long after it: a footstep.
    // With `at` ([x, y, z]) it is heard from there; with `follow` (a function giving [x, y, z]) from wherever that is
    // each frame until it ends: a voice from a head that falls or is dragged, not from where it was when it began.
    shot(name, { gain = 1, rate = 1, most = 0, at = null, follow = null } = {}): { buffer: AudioBuffer; from: number; rate: number; start: number; length: number } {
        const takes = this.takes.get(name), take = takes[Math.floor(Math.random() * takes.length)];
        const place = at || follow ? this.place(follow ? follow() : at, follow) : null, into = place ? place.input : this.out;
        if (most && take.hits.length) {
            const which = Math.floor(Math.random() * take.hits.length), from = Math.max(0, take.hits[which] - BURST.lead);
            const next = which + 1 < take.hits.length ? take.hits[which + 1] - BURST.lead : take.buffer.duration;
            const r = rate * (0.96 + Math.random() * 0.08);
            this._play(take.buffer, this.context.currentTime, from, Math.min(most, next - from), 0.004, 0.08, gain, r, into, place);
            return { buffer: take.buffer, from, rate: r, start: this.context.currentTime, length: Math.min(most, next - from) };
        }
        const which = Math.floor(Math.random() * take.bursts.length), [from, to] = take.bursts[which];
        // It rings on after it has gone quiet, as far as the next one or the end.
        const until = Math.min(to + BURST.rings, which + 1 < take.bursts.length ? take.bursts[which + 1][0] : take.buffer.duration);
        const r = rate * (0.96 + Math.random() * 0.08);
        this._play(take.buffer, this.context.currentTime, from, until - from, 0.004, 0.05, gain, r, into, place);
        // What is playing, for whoever wants to follow it (a face mouthing its own voice).
        return { buffer: take.buffer, from, rate: r, start: this.context.currentTime, length: until - from };
    }

    // A stream no longer wanted: it falls silent and is no longer kept going.
    drop(stream) {
        stream.level.disconnect();
        if (stream.place) this.release(stream.place);
        this.streams = this.streams.filter((s) => s !== stream);
    }

    // Once a frame: every stream lines up what it will be playing next.
    update() {
        for (const stream of this.streams) stream._ahead();
        for (const place of this.placed) this._hear(place);
    }

    // A length of a recording, from `from` for `length` seconds, starting
    // at `when`, faded in and out, into `into` (its place, `owned`, let go of with it).
    _play(buffer, when, from, length, fadeIn, fadeOut, gain, rate, into, owned: Place | null = null) {
        const source = this.context.createBufferSource(), level = this.context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const lasts = length / rate;
        level.gain.setValueAtTime(0, when);
        level.gain.linearRampToValueAtTime(gain, when + fadeIn);
        level.gain.setValueAtTime(gain, when + Math.max(fadeIn, lasts - fadeOut));
        level.gain.linearRampToValueAtTime(0, when + lasts);
        source.connect(level).connect(into);
        source.start(when, from, length);
        source.onended = () => {
            level.disconnect();
            if (owned) this.release(owned);
        };
    }
}

type Place = { input: GainNode; muffle: BiquadFilterNode; hush: GainNode; panner: PannerNode; at: number[]; follow: (() => number[]) | null };

class Stream {
    declare sound: any;
    declare place: Place | null;
    declare takes: any;
    declare level: any;
    declare driven: number;
    declare rate: number;
    declare next: number;
    declare take: any;
    declare head: number;
    declare until: number;

    constructor(sound, takes, place: Place | null = null) {
        this.sound = sound;
        this.takes = takes;
        this.place = place;
        this.level = sound.context.createGain();
        this.level.gain.value = 0;
        this.level.connect(place ? place.input : sound.out);
        this.driven = 0;
        this.rate = 1;
        this.next = 0;                  // when the next length is due to start
        this.take = null;               // which recording it is in, and where
        this.head = 0;
        this.until = 0;
    }

    // Heard from somewhere else now, [x, y, z] (only a stream made with a place has one).
    at(where) {
        if (this.place) this.place.at = where;     // (moved there by Sound.update, as every place is)
    }

    // How loud it is to be from now (0 is silent), and how fast its recordings are to run.
    drive(level, rate = 1) {
        const context = this.sound.context;
        this.driven = level;
        this.rate = rate;
        this.level.gain.setTargetAtTime(level, context.currentTime, STREAM.eases);
    }

    _ahead() {
        const context = this.sound.context, now = context.currentTime, step = STREAM.length - STREAM.fade;
        if (this.driven <= 0) {
            // Silent, and nothing lined up: when it is next driven it starts somewhere new, at once.
            if (now > this.next) this.take = null;
            return;
        }
        if (this.next < now) this.next = now;
        while (this.next < now + STREAM.ahead) {
            // On through the burst it is in, or into another when this one runs out.
            if (!this.take || this.head + STREAM.length > this.until) {
                this.take = this.takes[Math.floor(Math.random() * this.takes.length)];
                const long = this.take.bursts.filter(([from, to]) => to - from > STREAM.length);
                [this.head, this.until] = long.length ? long[Math.floor(Math.random() * long.length)] : [0, this.take.buffer.duration];
            }
            // Each length goes on exactly where the last will be when it fades: the two are the same sound there, and nothing is heard of the join.
            const rate = this.rate;
            this.sound._play(this.take.buffer, this.next, this.head, STREAM.length * rate, STREAM.fade, STREAM.fade, 1, rate, this.level);
            this.head += step * rate;
            this.next += step;
        }
    }
}
