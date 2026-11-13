// A face that shows what is happening to the person behind it.
//
// The people's skeletons have few face bones: the jaw, an upper and a lower
// lid on each eye, and the corners of the mouth. That is enough for what pain
// and dying do to a face: the eyes screwed up and the mouth pulled back off
// the teeth in a grimace; the jaw dropped in a scream and moving with every
// sound the voice makes (followed from the recording itself as it plays); the
// corners pulled down in weeping; the jaw slack and the lids half down once
// nobody is behind the face any more. (No brows: they would need bones the
// people do not have.)

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion, RAD = Math.PI / 180;

const FOLLOWS = 14;         // per second: how fast the face goes to what it is showing (a jaw is quick, not instant)
const WINDOW = 0.03;        // seconds of the voice the mouth is opened by, at each moment

export class Face {
    declare person: any;
    declare jaw: number;
    declare squint: number;
    declare grimace: number;
    declare weep: number;
    declare voice: any;
    declare now: () => number;

    constructor(person) {
        this.person = person;
        this.jaw = 0;
        this.squint = 0;
        this.grimace = 0;
        this.weep = 0;
        this.voice = null;
        this.now = () => 0;
    }

    // A recording now coming out of this person's mouth (Sound.shot's account of it), to be mouthed.
    speak(playing, now: () => number) {
        this.voice = playing;
        this.now = now;
    }

    // How loud the voice is at this moment, 0 to 1, from the recording itself.
    _loudness() {
        const v = this.voice;
        if (!v) return 0;
        const t = this.now() - v.start;
        if (t < 0 || t > v.length / v.rate) { this.voice = t < 0 ? v : null; return 0; }
        const data = v.buffer.getChannelData(0), sr = v.buffer.sampleRate;
        const at = Math.floor((v.from + t * v.rate) * sr), n = Math.floor(WINDOW * sr);
        let sum = 0;
        for (let i = Math.max(0, at - n); i < Math.min(data.length, at); i++) sum += data[i] * data[i];
        return Math.min(1, Math.sqrt(sum / n) * 4.5);
    }

    // `v` is the person's vitals. Called after the person's own blink and mouth (Person._face), over them.
    // `hangs` is how far (degrees) a broken or dislocated jaw hangs open whatever the face would do.
    update(dt, v, crying: boolean, hangs = 0) {
        const conscious = v.dead ? 0 : v.conscious, k = Math.min(1, dt * FOLLOWS);
        const pain = conscious > 0.35 ? Math.min(1, v.pain * 1.3) : 0;
        const loud = this._loudness();
        // The jaw: open with the voice, a little slack while hurting, hanging once out cold, dropped once dead.
        const jaw = Math.max(loud * 30, v.dead ? 16 : conscious < 0.35 ? 9 : pain * 4, hangs);
        this.jaw += (jaw - this.jaw) * Math.min(1, dt * (jaw > this.jaw ? 30 : 12));
        this.squint += (pain - this.squint) * k;
        this.grimace += (Math.max(pain * 0.8, loud * 0.9) * (conscious > 0.35 ? 1 : 0) - this.grimace) * k;
        this.weep += ((crying ? 1 : 0) - this.weep) * Math.min(1, dt * 3);
        const p = this.person, by = p.byName;
        // (Person.apply posed the jaw from its own controls; the face's opening is added to it.)
        const jawBone = by.jaw?.bone;
        if (jawBone) jawBone.setRotationQuaternion(Q.RotationAxis(p.hinges.jaw.axis, this.jaw * RAD), BABYLON.Space.LOCAL);
        for (const side of ['L', 'R']) {
            const upper = by[`orbicularis03.${side}`], lower = by[`orbicularis04.${side}`];
            // Lids: screwed up in pain; half down out cold; open and still in death (the dead do not shut their eyes).
            const shut = Math.max(p.blink, this.squint * 0.5, conscious < 0.35 && !v.dead ? 0.7 : 0);
            if (upper) upper.bone.setRotationQuaternion(Q.RotationAxis(new V3(1, 0, 0), shut * 0.55), BABYLON.Space.LOCAL);
            if (lower) lower.bone.setRotationQuaternion(Q.RotationAxis(new V3(1, 0, 0), -(shut * 0.18 + this.squint * 0.08)), BABYLON.Space.LOCAL);
            // The corners of the mouth: back and up off the teeth in a grimace or a scream, down in weeping.
            const corner = by[`risorius03.${side}`];
            if (!corner) continue;
            const s = side === 'L' ? -1 : 1, parent = by[p._parentName(`risorius03.${side}`)];
            const pull = new V3(s * 0.011 * this.grimace, 0.003 * this.grimace - 0.009 * this.weep - 0.004 * (this.jaw / 30), -0.005 * this.grimace);
            corner.bone.setPosition(corner.head.subtract(parent.head).add(pull), BABYLON.Space.LOCAL);
        }
    }
}
