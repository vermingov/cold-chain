// The sounds of the table.
//
// Nothing here is played because a thing has begun. It is played because of
// what is going on this frame, and as much as is going on: a blade is heard
// for as long as it is cutting, louder the faster it is drawn, and it
// sounds like what its point is in (skin, the fat under it, flesh, bone,
// an organ). Stop the hand and it stops. Tissue is heard while it moves:
// when a cut springs open, when a hand draws a lip back, when something
// inside is shifted. The few things that only happen once are heard once:
// the wall giving under the blade or tearing in the hand, a vessel parting,
// a hand taking hold, a thing laid down or let fall.
//
// It asks the tools and the tissue what they are doing and never the other
// way about: nothing on the table knows it is being listened to. And a thing
// there is no good recording of is not heard at all (assets/sounds has what
// there is): silence is nearer the truth than the wrong sound.

// What a blade sounds like in each thing, by name of recording, and how
// loud that is against the others.
import * as BABYLON from '@babylonjs/core';
const CUT = { skin: 0.75, fat: 0.8, flesh: 1, bone: 0.9, organ: 0.7 };
// A blade is heard from `least` metres a second and is as loud as it gets
// at `most`. Drawn fast, its recording runs up to `quickens` faster.
const DRAWN = { least: 0.004, most: 0.14, quickens: 0.22 };
// Tissue and what is inside are heard moving from `least` metres a second,
// loudest at `most`. (Flesh creeps on at a few millimetres a second for a
// while after it has been pulled, and that is not heard.)
const MOVES = { least: 0.012, most: 0.25, loud: 0.8 };
// A slow stroke moves a pixel now and a pixel then, and a blade wavers
// between skin and the fat under it: what it is in is taken over `over`
// seconds, so that neither is heard as a stutter.
const STEADY = { over: 0.09 };
// How loud the single sounds are. What goes on happening (a wall gives a stretch at a time, many a second, for as
// long as the blade is going through it) is one sound, made when it begins: it has to stop for `apart` seconds
// before it is heard again.
const ONCE = { give: 0.8, snip: 0.8, glove: 0.5, lay: 0.7, apart: 0.4 };

const eased = (value, least, most) => Math.max(0, Math.min(1, (value - least) / (most - least)));

export class Foley {
    declare sound: any;
    declare table: any;
    declare cuts: { [k: string]: any; };
    declare share: { [k: string]: number; };
    declare cutting: any;
    declare wet: any;
    declare heard: { gave: number; tore: number; severed: number; landed: number; held: any; when: {}; };
    declare lay: Map<any, any>;

    // `sound` is the Sound with the table's recordings loaded. `table` is
    // what there is to listen to: { scalpel, hand, field, organs, pieces }.
    constructor(sound, table) {
        this.sound = sound;
        this.table = table;
        this.cuts = Object.fromEntries(Object.keys(CUT).filter((what) => sound.has(what)).map((what) => [what, sound.stream(what)]));
        this.share = Object.fromEntries(Object.keys(CUT).map((what) => [what, 0]));       // how much of the blade's sound is each thing's, just now
        this.cutting = null;            // what the blade was last in
        this.wet = sound.has('wet') ? sound.stream('wet') : null;
        this.heard = { gave: 0, tore: 0, severed: 0, landed: 0, held: null, when: {} };
        this.lay = new Map([...table.organs.all.values()].map((organ) => [organ, organ.shift.clone()]));
    }

    update(dt) {
        const { scalpel, hand, field } = this.table, tissue = field.tissue;
        // The blade: it is heard as what it is in, as loud as it is being drawn fast. (How fast, the scalpel
        // has already taken over a moment: a blade that stops is silent as soon as that moment is past.)
        this.cutting = scalpel.down ? scalpel.cutting || this.cutting : null;
        const drawn = this.cutting ? Math.sqrt(eased(scalpel.speed, DRAWN.least, DRAWN.most)) : 0, turn = Math.min(1, dt / STEADY.over);
        for (const [what, stream] of Object.entries(this.cuts)) {
            this.share[what] += ((this.cutting === what ? 1 : 0) - this.share[what]) * turn;
            stream.drive(this.share[what] < 0.01 ? 0 : drawn * this.share[what] * CUT[what], 1 + DRAWN.quickens * (drawn - 0.5));
        }
        // Whatever is moving that is wet: the tissue coming to rest, and anything inside that is being shifted.
        let shifted = 0;
        for (const [organ, was] of this.lay) {
            shifted = Math.max(shifted, BABYLON.Vector3.Distance(organ.shift, was) / Math.max(dt, 1e-3));
            was.copyFrom(organ.shift);
        }
        const moving = Math.max(eased(tissue.went / Math.max(dt, 1e-3), MOVES.least, MOVES.most), eased(shifted, MOVES.least, MOVES.most));
        if (this.wet) this.wet.drive(Math.sqrt(moving) * MOVES.loud, 0.9 + 0.2 * moving);

        // And what happens once.
        if (tissue.gave > this.heard.gave || tissue.tore > this.heard.tore) this._once('give', ONCE.give);
        if (scalpel.severed > this.heard.severed) this._once('snip', ONCE.snip);
        if (hand.held && !this.heard.held) this._once('glove', ONCE.glove);
        if (!hand.held && this.heard.held && this.heard.held.organ) this._once('lay', ONCE.lay);
        if (this.table.pieces && this.table.pieces.landed > this.heard.landed) this._once('lay', ONCE.lay);
        if (this.table.pieces) this.heard.landed = this.table.pieces.landed;
        this.heard.gave = tissue.gave;
        this.heard.tore = tissue.tore;
        this.heard.severed = scalpel.severed;
        this.heard.held = hand.held;
        this.sound.update();
    }

    // The table is left: what was going on stops.
    dispose() {
        for (const stream of [...Object.values(this.cuts), this.wet]) if (stream) this.sound.drop(stream);
    }

    // A single sound, unless what makes it has been going on since it was last made.
    _once(name, gain) {
        const now = this.sound.context.currentTime, last = this.heard.when[name];
        this.heard.when[name] = now;
        if (this.sound.has(name) && !(now - last < ONCE.apart)) this.sound.shot(name, { gain });
    }
}
