// The sounds of the game outside the table: the air of each place, steps,
// the phone, the door, the spade, the bier, the van.
//
// They are recordings (tools/sounds.py makes assets/sounds from what was
// passed on dev/listen.html), played through sound.js. A sound nobody has
// passed is not in the manifest and is silent: nothing here stands in for
// it. What goes on happening (the air, the bier's wheels, the engine) is a
// stream, driven every frame as loud as it should be; what happens once is
// a shot.

import { Sound } from '../sound.ts';

// How loud each is against the others.
const LEVEL = { room: 0.45, night: 0.6, step: 0.55, ring: 0.7, beep: 0.6, handset: 0.7, door: 0.8, dig: 0.75, lid: 0.85, bier: 0.6, van: 0.7 };
const RINGS = 3.2;          // seconds from one double ring to the next
// What is one strike out of a recording of many, and how long that strike may last, seconds: a footfall never runs
// into the next, a spadeful is the spade going in and the clay giving, the door is opened and not shut again.
const MOST = { step: 0.42, dig: 1.0, lid: 1.6, handset: 0.9, door: 1.8 };

export class Noises {
    declare sound: any;
    declare beds: Map<any, any>;
    declare ringing: number;

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

    // Something that happens once. `gain` is how hard, 0 to 1; `at`, where in the world it happens ([x, y, z]), if
    // anywhere but in the player's own hands.
    shot(name, gain = 1, at = null) {
        const kind = name.replace(/-.*/, '');
        if (this.sound.has(name)) this.sound.shot(name, { gain: gain * (LEVEL[kind] ?? 1), most: MOST[kind] ?? 0, at });
    }

    // Something that goes on, this frame as loud as `level` (0 for silent), at `rate` of its own speed; from `at`
    // ([x, y, z]) if it is somewhere in particular.
    drive(name, level, rate = 1, at = null) {
        if (!this.sound.has(name)) return;
        if (!this.beds.has(name)) this.beds.set(name, this.sound.stream(name, at));
        const bed = this.beds.get(name);
        if (at) bed.at(at);
        bed.drive(level * (LEVEL[name] ?? 1), rate);
    }

    // The room everything is heard in from now: 'flat', 'yard', 'cold'.
    room(name) { this.sound.room(name); }

    // A footfall of whoever is walking, on what is underfoot, as hard as it came down.
    step(surface, weight) { this.shot('step-' + surface, weight); }

    // The phone, ringing until it is stopped, from where it is ([x, y, z]).
    ring(on, at = null) {
        clearInterval(this.ringing);
        this.ringing = null;
        if (!on) return;
        this.shot('ring', 1, at);
        this.ringing = window.setInterval(() => this.shot('ring', 1, at), RINGS * 1000);
    }

    // Everything that was going on stops: the place is being left.
    hush() {
        this.ring(false);
        for (const stream of this.beds.values()) stream.drive(0);
    }

    update() { this.sound.update(); }
}
