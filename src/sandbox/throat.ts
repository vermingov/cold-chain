// Blood in a person's mouth, airways and stomach, and where gravity, breath and
// reflexes take it (dev/research/airway-blood.md).
//
// Three volumes, in millilitres: what lies in the mouth and the pharynx behind
// it, what has reached each lung's airways, and what is in the stomach. Blood
// comes into them from wounds (vitals.ts bleeds with `into`): a holed lung or
// windpipe bleeds into the airways, a torn tongue, cheek, broken jaw, knocked
// out tooth into the mouth, the back of a bleeding nose into the throat, a holed
// stomach or gullet into the stomach.
//
// The mouth drains by gravity, as the head lies now: out over the lower lip or a
// corner of the mouth when the face is turned down or to the side (the recovery
// position), and back toward the larynx when the person lies on their back or
// sits slumped upright. Awake, the throat protects itself: blood reaching the
// back of it is swallowed, a mouthful is spat out, and blood in the airways is
// coughed up into the mouth and out. Unconscious, the reflexes are gone, and
// every breath draws what lies in the throat down into the lungs, where it
// fills the airspaces that would have taken up oxygen (vitals `flooded`) and
// the pooled blood in the throat itself gurgles and narrows the airway
// (`choked`). The stomach does not keep much blood down: past a hundred
// millilitres or so it makes the person sick, and the retching brings it back up
// the gullet into the mouth, and out, or, lying on the back unconscious, into
// the lungs.
//
// A few numbers a person, a few lookups a frame; nothing is made per frame.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3, M = BABYLON.Matrix;

const HOLDS = 60;           // ml the mouth and pharynx hold before more is pushed out between the lips (an estimate: a mouthful)
const POURS = 3;            // 1/s: how fast a mouth turned down empties, as a share of what is in it, lips apart
const SWALLOW = 20;         // ml in one swallow (a man's natural sip of water is about 21 ml: Adnerhill 1989)
const DRAWN = 0.2;          // 1/s: share of the blood pooled at the back of the throat each breath draws in, unconscious, at 14 a minute
const SPOILS = 120;         // ml of blood in one lung's airways that take away two thirds of what it can do (airway-blood.md sec. 2)
const CLEARS = 0.3;         // share of the blood in a lung's large airways one cough brings up
const SICK = 60;            // ml in the stomach before it starts to turn it
const HEAVE = 0.7;          // seconds a retch takes
const EMPTIES = 1.2;        // seconds the stomach takes to empty in one vomit

const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

// Scratch: one matrix and vectors, reused every frame.
const _m = new M(), _n = new M(), _down = new V3(0, -1, 0);
const AXIS = { fwd: new V3(0, 0, 1), up: new V3(0, 1, 0), right: new V3(1, 0, 0) };

type Outlet = { hit: any; at: BABYLON.Vector3; out: BABYLON.Vector3 };

export class Throat {
    declare npc: any;
    declare mouth: number;
    declare lungs: { L: number; R: number };
    declare stomach: number;
    declare gullet: number;          // on its way up the gullet in a vomit
    declare froth: number;           // share of the blood in the mouth that came up from the lungs, frothy
    declare nausea: number;
    declare heaves: number;          // retches still to come before the vomit
    declare heaveT: number;
    declare vomiting: number;        // seconds left of a vomit
    declare emptying: number;        // ml/s up out of the stomach while vomiting
    declare gape: number;            // degrees the jaw is forced open by a retch or a vomit (face.ts)
    declare coughIn: number;
    declare swallowIn: number;
    declare breath: number;
    declare pour: number;
    declare outlets: Outlet[];
    declare centre: { rest: BABYLON.Vector3; owner: any; at: BABYLON.Vector3 } | null;
    declare fwd: BABYLON.Vector3;
    declare up: BABYLON.Vector3;
    declare right: BABYLON.Vector3;
    declare toLips: number;
    declare toThroat: number;
    declare low: Outlet | null;

    constructor(npc) {
        this.npc = npc;
        this.mouth = 0;
        this.lungs = { L: 0, R: 0 };
        this.stomach = 0;
        this.gullet = 0;
        this.froth = 0;
        this.nausea = 0;
        this.heaves = 0;
        this.heaveT = 0;
        this.vomiting = 0;
        this.emptying = 0;
        this.gape = 0;
        this.coughIn = 1;
        this.swallowIn = 1;
        this.breath = 0;
        this.pour = 0;
        this.fwd = new V3(); this.up = new V3(); this.right = new V3();
        this.toLips = 0;
        this.toThroat = 0;
        this.low = null;
        this.outlets = [];
        this.centre = null;
        this._find();
    }

    // Where the mouth is on this body: the middle of the dental arch (on the skull), and the three ways out of it, the
    // middle of the lower lip and the two corners, as places on the skin (found once, at rest, from the teeth: rest +z is
    // forward, +x the person's right).
    _find() {
        const npc = this.npc, teeth = npc.bones?.teeth?.teeth ?? [], pos = npc._restPos;
        if (!teeth.length) return;
        const at = (t) => {
            const c = new V3();
            for (let v = t.v0; v <= t.v1; v++) c.addInPlaceFromFloats(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            return c.scaleInPlace(1 / (t.v1 - t.v0 + 1));
        };
        const centre = new V3();
        for (const t of teeth) centre.addInPlace(at(t));
        centre.scaleInPlace(1 / teeth.length);
        const head = teeth.find((t) => t.upper)?.owner;
        this.centre = { rest: centre, owner: head, at: new V3() };
        const named = (re: RegExp) => teeth.filter((t) => re.test(t.name)).map(at);
        const front = named(/^lower .* central incisor$/), canines = named(/^lower .* canine$/);
        const want = [];
        if (front.length) want.push(front.reduce((a, b) => a.add(b)).scale(1 / front.length).add(new V3(0, -0.006, 0.014)));
        for (const c of canines) want.push(c.add(new V3(Math.sign(c.x) * 0.011, 0, 0.006)));
        for (const p of want) {
            const hit = npc.runs.nearest(p, 0.025);
            if (hit?.kind === 'skin') this.outlets.push({ hit, at: new V3(), out: new V3() });
        }
    }

    // A bleed with somewhere to go inside (Bleed.into) gives this frame's `ml` to it. Returns the share that still
    // comes out of the bleed's own wound: none, but the front of a nosebleed, which runs out of the nostrils as much as
    // the head is upright or face down and back into the throat as much as it lies face up.
    take(b, ml: number) {
        if (b.into === 'mouth') { this.mouth += ml; return 0; }
        if (b.into === 'stomach') { this.stomach += ml; return 0; }
        if (b.into === 'airway') { this._lungward(ml, b.side); return 0; }
        if (b.into === 'nose') {
            const back = Math.max(0.05, Math.min(0.85, 0.25 + 0.6 * this.fwd.y));
            this.mouth += ml * back;
            return 1 - back;
        }
        return 1;
    }

    // Blood into the airways, shared between the lungs: the right main bronchus is wider and steeper and takes more
    // (sec. 2), and lying on one side, the lower lung takes most.
    _lungward(ml: number, side?: 'L' | 'R') {
        if (side) { this.lungs[side] += ml; return; }
        const chest = this.npc.ragdoll.byName.get('chest')?.node;
        const tilt = chest ? -chest.getDirectionToRef(AXIS.right, this.right).y : 0;
        const r = Math.max(0.1, Math.min(0.9, 0.58 + 0.4 * tilt));
        this.lungs.R += ml * r;
        this.lungs.L += ml * (1 - r);
    }

    // Where a line from `origin` along `dir` crosses the mouth, between `from` and `to` metres along it: a wound through
    // the tongue, the floor of the mouth, the palate or a cheek, which bleeds into the mouth.
    crossed(origin: BABYLON.Vector3, dir: BABYLON.Vector3, from: number, to: number) {
        if (!this.centre?.owner) return false;
        const c = this._place(this.centre.owner, this.centre.rest, this.centre.at);
        const along = (c.x - origin.x) * dir.x + (c.y - origin.y) * dir.y + (c.z - origin.z) * dir.z;
        if (along < from - 0.03 || along > to + 0.03) return false;
        const dx = origin.x + dir.x * along - c.x, dy = origin.y + dir.y * along - c.y, dz = origin.z + dir.z * along - c.z;
        return dx * dx + dy * dy + dz * dz < 0.024 * 0.024;
    }

    get spoiled() { return { L: 1 - Math.exp(-this.lungs.L / SPOILS), R: 1 - Math.exp(-this.lungs.R / SPOILS) }; }

    update(dt: number) {
        const npc = this.npc, v = npc.vitals;
        const head = npc.ragdoll.byName.get('head')?.node;
        if (!head || dt <= 0) return;
        head.getDirectionToRef(AXIS.fwd, this.fwd);
        head.getDirectionToRef(AXIS.up, this.up);
        head.getDirectionToRef(AXIS.right, this.right);
        const f = this.fwd, u = this.up, r = this.right;
        // How much gravity pulls the mouth's blood toward the lips (the lower lip stands a little above the floor of the
        // mouth: upright, none goes over it), toward either corner (a head on its side), and toward the larynx, below and
        // behind the mouth (lying face up, or upright).
        const lip = -(f.y * 0.95 + u.y * 0.12), corner = -(f.y * 0.55 + u.y * 0.1) + Math.abs(r.y) * 0.8;
        this.toLips = Math.max(lip, corner);
        this.toThroat = -(-f.y * 0.5 - u.y * 0.85);
        const alive = !v.dead && v.beating, awake = alive ? v.conscious : 0;
        // The cough, gag and swallow need a working brainstem and somebody nearly awake; they fade with stupor (GCS 8 and
        // below protects no airway: sec. 4).
        const reflex = ramp(awake, 0.15, 0.5);
        const breathing = v.breathing && alive;

        this._stomach(dt, alive, awake);
        this._heave(dt, alive, awake);

        // --- the mouth: out between the lips by gravity, faster the more the jaw is open
        const open = ramp(npc.face?.jaw ?? 0, 1, 10);
        let out = 0;
        if (this.mouth > 0.05) {
            const drive = ramp(this.toLips, 0.05, 0.6);
            out = this.mouth * Math.min(1, POURS * drive * (0.06 + 0.94 * open) * dt);
            // More than it holds is pushed out past the lips whichever way the head lies.
            if (this.mouth - out > HOLDS) out = this.mouth - HOLDS;
            this.mouth -= out;
        }
        if (out > 0) this._spill(out, dt);

        // --- the back of the throat: swallowed awake, breathed in out cold
        const back = ramp(this.toThroat, 0.1, 0.6);
        if (this.mouth > 0.05 && back > 0) {
            if (reflex > 0.5) {
                if ((this.swallowIn -= dt) < 0 && this.mouth > 4) {
                    // A mouthful awake and able: spat out, if the face is not turned up; otherwise swallowed.
                    if (this.mouth > 12 && awake > 0.6 && this.toLips > -0.5 && Math.random() < 0.45) this._spit();
                    else { const gulp = Math.min(this.mouth, SWALLOW); this.mouth -= gulp; this.stomach += gulp; }
                    this.swallowIn = 1.5 + Math.random() * 2;
                }
            } else if (breathing) {
                const drawn = this.mouth * Math.min(1, DRAWN * back * (1 - reflex) * (v.rr / 14) * dt);
                this.mouth -= drawn;
                this._lungward(drawn);
            }
        }
        if (this.mouth < 0.05) this.froth = 0;

        // --- the airways: coughed up while there is a cough
        const wet = this.lungs.L + this.lungs.R;
        if (breathing && reflex > 0.3 && wet > 2 && (this.coughIn -= dt) < 0) {
            this.coughIn = 1.2 + 4 * Math.exp(-wet / 30) * (0.6 + Math.random() * 0.8);
            this._cough(reflex);
        }
        const s = this.spoiled;
        v.flooded.L = s.L;
        v.flooded.R = s.R;
        // A pool at the back of the throat of someone who cannot clear it narrows the airway.
        v.choked = ramp(this.mouth, 15, 70) * back * (1 - reflex);

        // --- breaths heard through blood: in the throat, or in the big airways
        if (breathing && v.rr > 0) {
            this.breath += (dt * v.rr) / 60;
            if (this.breath >= 1) {
                this.breath -= 1;
                const gurgle = Math.max(ramp(this.mouth, 4, 30) * back * (1 - reflex * 0.7), ramp(wet, 15, 120));
                if (gurgle > 0.15) npc.world.sound?.shot('gurgle', { follow: () => head.position.asArray(), gain: 0.25 + 0.5 * gurgle });
            }
        }
    }

    // Blood out over the lips, `ml` this frame. It goes out at the lowest of the three ways out; a trickle runs down the
    // chin or cheek from there (runs.ts, which hangs it at the chin and drips it), and a pour falls as drops.
    _spill(ml: number, dt: number) {
        const o = this._lowest();
        if (!o) return;
        this.pour += ml;
        if (this.pour < 0.25) return;
        const npc = this.npc, rate = ml / dt;
        if (rate < 1.5) npc.runs.start(o.hit, this.pour);
        else {
            npc.runs.start(o.hit, this.pour * 0.25);
            npc.world.blood?.spray(o.at.add(o.out.scale(0.006)), o.out.scale(0.3).addInPlace(_down).normalize(), 0.35, this.pour * 0.75, 0.3, 2.5);
        }
        npc.film?.blot(o.hit, 0.006, 0.25);
        this.pour = 0;
    }

    // The way out of the mouth lowest in the world now, placed: where it is and which way out of the mouth it faces.
    _lowest() {
        let best = null;
        for (const o of this.outlets) {
            this._place(o.hit.owner, o.hit.rest, o.at);
            if (!best || o.at.y < best.at.y) best = o;
        }
        if (best && this.centre?.owner) {
            const c = this._place(this.centre.owner, this.centre.rest, this.centre.at);
            best.at.subtractToRef(c, best.out).normalize();
        }
        this.low = best;
        return best;
    }

    // A point of the body at rest on bone `owner`, where it is in the world now (npc.restToWorld without the garbage).
    _place(owner, rest: BABYLON.Vector3, into: BABYLON.Vector3) {
        M.TranslationToRef(-owner.head.x, -owner.head.y, -owner.head.z, _m);
        _m.multiplyToRef(owner.bone.getAbsoluteMatrix(), _n);
        _n.multiplyToRef(this.npc.person.mesh.getWorldMatrix(), _m);
        return V3.TransformCoordinatesToRef(rest, _m, into);
    }

    // A cough: a share of the blood in each lung's large airways up into the mouth, frothed with the air that drives it,
    // and most of the mouth thrown out of it in a spray of fine drops and a few clots (sec. 3).
    _cough(strength: number) {
        const npc = this.npc;
        let up = 0;
        for (const k of ['L', 'R'] as const) { const c = Math.min(15, this.lungs[k] * CLEARS * strength); this.lungs[k] -= c; up += c; }
        this.froth = (this.froth * this.mouth + up) / Math.max(1e-6, this.mouth + up);
        this.mouth += up;
        const wet = this.mouth > 2;
        const playing = wet ? npc.world.sound?.shot('cough-wet', { follow: () => npc.ragdoll.byName.get('head').node.position.asArray(), gain: 0.9 }) : null;
        if (playing) { npc.face.speak(playing, npc.world.sound.now, 'cough'); npc._said.until = performance.now() / 1000 + 1.5; }
        else npc.say('cough', 0.9, true);
        if (!wet) return;
        if (!npc.vitals.injuries.some((i) => i.text === 'Coughing up blood')) npc.vitals.injure('Coughing up blood', 5);
        const o = this._lowest();
        if (!o) return;
        const thrown = this.mouth * 0.6 * strength;
        this.mouth -= thrown;
        const blood = npc.world.blood, from = o.at.add(this.fwd.scale(0.008));
        const way = this.fwd.add(o.out).normalize();
        // Frothy blood is fine: most of it a mist of small drops, carried far; the rest clots and strings that drop near.
        blood?.spray(from, way, 4.5, thrown * 0.55, 0.45, 0.45 + 0.4 * (1 - this.froth));
        blood?.spray(from, way.add(_down.scale(0.4)).normalize(), 1.4, thrown * 0.45, 0.35, 2.2);
        npc.runs.start(o.hit, Math.min(this.mouth, 1.5));
        npc.film?.blot(o.hit, 0.01, 0.3);
    }

    // A mouthful spat out, forward and down.
    _spit() {
        const npc = this.npc, o = this._lowest();
        if (!o) return;
        const ml = this.mouth * 0.85;
        this.mouth -= ml;
        npc.world.blood?.spray(o.at.add(this.fwd.scale(0.008)), this.fwd.add(_down.scale(0.3)).normalize(), 3, ml, 0.15, 3);
        npc.runs.start(o.hit, 0.4);
        npc.world.sound?.shot('spit', { follow: () => npc.ragdoll.byName.get('head').node.position.asArray(), gain: 0.7 });
    }

    // Blood in the stomach turns it: sicker the more there is, until the person retches (an estimate: no study gives
    // the volume, sec. 5).
    _stomach(dt: number, alive: boolean, awake: number) {
        if (!alive) { this.nausea = 0; return; }
        this.nausea = Math.max(0, this.nausea + dt * (Math.max(0, this.stomach - SICK) / 1500 - 0.004));
        if (this.nausea >= 1 && !this.heaves && this.vomiting <= 0) {
            this.nausea = 0;
            this.heaves = 2 + Math.floor(Math.random() * 3 * awake);
            this.heaveT = 0;
            this._sound('retch', 0.9);
        }
    }

    // Retching, then the vomit: the stomach squeezed by the belly's muscles, the body folding over it with each heave,
    // the jaw forced open, and what comes up driven up the gullet into the mouth and out of it. A person out cold
    // still vomits, weakly; what does not get out lies in the throat.
    _heave(dt: number, alive: boolean, awake: number) {
        const npc = this.npc, b = npc.behaviour;
        let fold = 0, gape = 0;
        if (this.heaves > 0 && alive) {
            this.heaveT += dt;
            const p = Math.sin(Math.PI * Math.min(1, this.heaveT / HEAVE));
            fold = p; gape = 18 * p;
            if (this.heaveT >= HEAVE) {
                this.heaveT = 0;
                if (--this.heaves === 0) {
                    this.vomiting = EMPTIES;
                    this.emptying = (this.stomach * (0.6 + 0.3 * Math.random())) / EMPTIES;
                    this._sound('vomit', 1);
                    if (!npc.vitals.injuries.some((i) => i.text === 'Vomiting blood')) npc.vitals.injure('Vomiting blood', 5);
                } else this._sound('retch', 0.8);
            }
        }
        if (this.vomiting > 0) {
            const up = Math.min(this.stomach, this.emptying * dt);
            this.stomach -= up;
            this.gullet += up;
            this.vomiting -= dt;
            fold = 1; gape = 30;
        }
        // Up the gullet in a fraction of a second; most of it out of the mouth with the force behind it.
        if (this.gullet > 0.01) {
            const up = this.gullet * Math.min(1, dt * 10);
            this.gullet -= up;
            const forced = this.vomiting > 0 ? up * (0.35 + 0.55 * ramp(awake, 0.1, 0.6)) : 0;
            this.mouth += up - forced;
            if (forced > 0) this._gush(forced, dt);
        }
        this.gape += (gape - this.gape) * Math.min(1, dt * 12);
        if (b) b.retch = fold * (0.4 + 0.6 * ramp(awake, 0.1, 0.6));
    }

    // Vomit out of the open mouth: a rope of it, as fast as the heave drives it, as thick as there is of it.
    _gush(ml: number, dt: number) {
        const o = this._lowest();
        if (!o) return;
        const speed = 1.2 + 1.2 * Math.random(), q = (ml * 1e-6) / dt;
        const r = Math.min(0.009, Math.max(0.002, Math.sqrt(q / (Math.PI * speed))));
        const way = this.fwd.scale(0.8).addInPlace(o.out.scale(0.4)).addInPlace(_down.scale(0.3)).normalize();
        this.npc.world.blood?.stream(this, o.at.add(this.fwd.scale(0.01)), way, speed, ml, r, dt);
        this.npc.runs.start(o.hit, ml * 0.04);
    }

    _sound(name: string, gain: number) {
        const npc = this.npc, sound = npc.world.sound;
        const playing = sound?.shot(name, { follow: () => npc.ragdoll.byName.get('head').node.position.asArray(), gain });
        if (playing && npc.vitals.conscious > 0.35) npc.face.speak(playing, sound.now, name);
        npc._said.until = performance.now() / 1000 + 2;
    }
}
