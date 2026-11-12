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

const LEVEL = 0.7;              // how loud everything is: recordings are set near full scale, and several sound at once
const QUIET = 0.07;             // a recording is sounding where it is louder than this much of its loudest
const HOP = 0.01;               // seconds: how finely that is looked for
// Seconds: the shortest burst there is, the longest pause inside one, how far ahead of it to start, and how long a
// single one is left to ring when it is played alone.
const BURST = { least: 0.02, joins: 0.09, lead: 0.012, rings: 0.3 };
// A stream plays `length` seconds at a time, each faded over `fade` into the
// next, and is told what to do about `ahead` seconds before it is heard.
const STREAM = { length: 0.22, fade: 0.07, ahead: 0.12, eases: 0.035 };

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

export class Sound {
    declare context: AudioContext;
    declare out: GainNode;
    declare takes: Map<any, any>;
    declare streams: any[];

    constructor() {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.out = this.context.createGain();
        this.out.gain.value = LEVEL;
        this.out.connect(this.context.destination);
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

    // Whether there is any recording called `name`. (What has none is not heard: nothing is made up to stand in.)
    has(name) { return this.takes.has(name); }

    // A stream of the recordings called `name`.
    stream(name) {
        const stream = new Stream(this, this.takes.get(name));
        this.streams.push(stream);
        return stream;
    }

    // One burst of one of the recordings called `name`, now: `gain` loud,
    // at `rate` times its own speed (a little either way of 1 keeps two the
    // same from sounding the same).
    // With `most` (seconds) it is one strike instead (`hits`), cut off at most that long after it: a footstep.
    shot(name, { gain = 1, rate = 1, most = 0 } = {}) {
        const takes = this.takes.get(name), take = takes[Math.floor(Math.random() * takes.length)];
        if (most && take.hits.length) {
            const which = Math.floor(Math.random() * take.hits.length), from = Math.max(0, take.hits[which] - BURST.lead);
            const next = which + 1 < take.hits.length ? take.hits[which + 1] - BURST.lead : take.buffer.duration;
            this._play(take.buffer, this.context.currentTime, from, Math.min(most, next - from), 0.004, 0.08, gain, rate * (0.96 + Math.random() * 0.08), this.out);
            return;
        }
        const which = Math.floor(Math.random() * take.bursts.length), [from, to] = take.bursts[which];
        // It rings on after it has gone quiet, as far as the next one or the end.
        const until = Math.min(to + BURST.rings, which + 1 < take.bursts.length ? take.bursts[which + 1][0] : take.buffer.duration);
        this._play(take.buffer, this.context.currentTime, from, until - from, 0.004, 0.05, gain, rate * (0.96 + Math.random() * 0.08), this.out);
    }

    // A stream no longer wanted: it falls silent and is no longer kept going.
    drop(stream) {
        stream.level.disconnect();
        this.streams = this.streams.filter((s) => s !== stream);
    }

    // Once a frame: every stream lines up what it will be playing next.
    update() {
        for (const stream of this.streams) stream._ahead();
    }

    // A length of a recording, from `from` for `length` seconds, starting
    // at `when`, faded in and out, into `into`.
    _play(buffer, when, from, length, fadeIn, fadeOut, gain, rate, into) {
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
        source.onended = () => level.disconnect();
    }
}

class Stream {
    declare sound: any;
    declare takes: any;
    declare level: any;
    declare driven: number;
    declare rate: number;
    declare next: number;
    declare take: any;
    declare head: number;
    declare until: number;

    constructor(sound, takes) {
        this.sound = sound;
        this.takes = takes;
        this.level = sound.context.createGain();
        this.level.gain.value = 0;
        this.level.connect(sound.out);
        this.driven = 0;
        this.rate = 1;
        this.next = 0;                  // when the next length is due to start
        this.take = null;               // which recording it is in, and where
        this.head = 0;
        this.until = 0;
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
