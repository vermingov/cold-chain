// The sounds of the game outside the table: the air of each place, steps,
// the phone, the door, the spade, the bier, the van.
//
// They are recordings (tools/sounds.py makes assets/sounds from what was
// passed on dev/listen.html), played through sound.js. A sound nobody has
// passed is not in the manifest and is silent: nothing here stands in for
// it. What goes on happening (the air, the bier's wheels, the engine) is a
// stream, driven every frame as loud as it should be; what happens once is
// a shot.

import { Sound } from '../sound.js';

// How loud each is against the others.
const LEVEL = { room: 0.45, night: 0.6, step: 0.55, ring: 0.7, beep: 0.6, handset: 0.7, door: 0.8, dig: 0.75, lid: 0.85, bier: 0.6, van: 0.7 };
const RINGS = 3.2;          // seconds from one double ring to the next
// What is one strike out of a recording of many, and how long that strike may last, seconds: a footfall never runs
// into the next, a spadeful is the spade going in and the clay giving, the door is opened and not shut again.
const MOST = { step: 0.42, dig: 1.0, lid: 1.6, handset: 0.9, door: 1.8 };

export class Noises {
    constructor(sound) {
        this.sound = sound;
        this.beds = new Map();          // name -> its stream, while it is being driven
        this.ringing = null;
    }

    static async open(base = 'assets/sounds/') {
        const sound = new Sound();
        sound.context.resume();
        const manifest = await (await fetch(base + 'manifest.json')).json();
        await sound.load(base, manifest);
        return new Noises(sound);
    }

    // Something that happens once. `gain` is how hard, 0 to 1.
    shot(name, gain = 1) {
        const kind = name.replace(/-.*/, '');
        if (this.sound.has(name)) this.sound.shot(name, { gain: gain * (LEVEL[kind] ?? 1), most: MOST[kind] ?? 0 });
    }

    // Something that goes on, this frame as loud as `level` (0 for silent), at `rate` of its own speed.
    drive(name, level, rate = 1) {
        if (!this.sound.has(name)) return;
        if (!this.beds.has(name)) this.beds.set(name, this.sound.stream(name));
        this.beds.get(name).drive(level * (LEVEL[name] ?? 1), rate);
    }

    // A footfall of whoever is walking, on what is underfoot, as hard as it came down.
    step(surface, weight) { this.shot('step-' + surface, weight); }

    // The phone, ringing until it is stopped.
    ring(on) {
        clearInterval(this.ringing);
        this.ringing = null;
        if (!on) return;
        this.shot('ring');
        this.ringing = setInterval(() => this.shot('ring'), RINGS * 1000);
    }

    // Everything that was going on stops: the place is being left.
    hush() {
        this.ring(false);
        for (const stream of this.beds.values()) stream.drive(0);
    }

    update() { this.sound.update(); }
}
