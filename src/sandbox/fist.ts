// The player's fists, drawn while they are held up (weapons.ts 'fists'): one of these for each arm, the left mouse
// button the left's and the right the right's.
//
// A person's arm (table/arm.ts: a person's bones, the hand closed into a fist, the elbow found between a shoulder
// beside and below the eye and the wrist), in that person's own skin and sleeve. What is moved is the knuckles. Between
// punches the fist is up in a guard beside the jaw. A press winds it up: it is drawn back and down toward its shoulder,
// that shoulder taken back and the body turned away from the punch, the view leaning with it, further the longer it is
// held, to a second. Let go, it is driven straight out from its own side of the chin, the shoulder and the body turning
// in behind it, and turns over from upright to most of the way flat as it goes; a tap is a jab, thrown from the guard
// with the arm alone. It lands on the first skin its knuckles cross on the way (weapons.ts _fists: where the fist is,
// not where the eye looks), with the speed it is going and the mass behind it. What it lands on stops it there and it
// comes back off it to the guard; a miss carries it on to the end of the arm and is pulled back slower.

import * as BABYLON from '@babylonjs/core';
import { Arm, plain } from '../table/arm.ts';
const V3 = BABYLON.Vector3;

// How hard (dev/research/blunt-trauma.md): Olympic boxers' straight punches land at 9.1 +- 2.1 m/s with an effective
// mass of 2.9 kg and 3427 N peak (Walilko05); a jab, thrown from the guard with the arm alone, at about 6 m/s with the
// fist and forearm's 1.5 kg or so, lands at 1 to 2 kN. A full wind-up is taken as the boxer's straight: the hips and
// shoulder put the body's mass behind the fist and speed it up. In between, by how long it was wound up (`wind` s).
export const PUNCH = { jab: { speed: 6, mass: 1.5 }, full: { speed: 10, mass: 2.9 }, wind: 1 };

// The knuckles, in the eye's frame (x right, y up, z ahead; mirrored for the left fist, which is held a little further
// out in front, the lead hand), m.
const GUARD = { R: new V3(0.11, -0.08, 0.27), L: new V3(0.1, -0.07, 0.31) };
const DRAWN = new V3(0.17, -0.17, 0.12);    // wound all the way up: back and down toward the shoulder
const LINE = new V3(0.05, -0.06, 0);        // where it is driven out from, straight ahead: its own side of the chin
const MISS = 0.6;                           // m ahead of the eye: the arm's end, nothing met
const HANGS = new V3(0.3, -1, -0.15);       // the way the elbow is off the line from shoulder to fist: down, a little out
// The body's turn (`body`, -1 wound fully away to 1 driven fully in): the punching shoulder that far back or forward (m,
// as Arm.shift: out, up, ahead), and the view's yaw and lean with it (rad).
const AWAY = new V3(0, -0.015, -0.06), INTO = new V3(-0.03, 0, 0.08), LEAN = { yaw: 0.025, roll: 0.015 };
// What it lands with: the speed it gets there at and the mass behind it, and how far the fist and arm give (N/m). Taken
// so that on a face (bones.ts: the bone's pad in series, the head's mass behind it) a jab lands with about 1.2 kN and a
// full wind-up with about 2.6 kN.
export const FIST_GIVES = 5e4;
// What the player wears on the arms: a canvas work jacket. Its sleeve hangs `loose` m off the skin (upper arm, forearm)
// and ends `cuff` m short of the wrist in a hem `band` m long and `hem` m proud of the sleeve, its edge turned in `turn`
// m thick; above the hem the cloth gathers in shallow folds `fold` m deep. It is made `around` corners round, a ring
// every `step` m.
const SLEEVE = { colour: [0.24, 0.23, 0.2], rough: 0.85, loose: [0.011, 0.008], cuff: 0.03, band: 0.035, hem: 0.003, turn: 0.004,
    fold: 0.0012, around: 32, step: 0.008 };

type Key = { at: BABYLON.Vector3; t: number; turn: number; body: number; ease: (u: number) => number };
const smooth = (u: number) => u * u * (3 - 2 * u);
const drive = (u: number) => u * u * (2 - u);   // fastest at two thirds of the way, still moving when it gets there
const off = (u: number) => 1 - (1 - u) * (1 - u);
const onto = (u: number) => u * u;

export class Fist {
    declare arm: Arm;
    declare camera: BABYLON.Camera;
    declare side: 'R' | 'L';
    declare keys: Key[];
    declare t: number;
    declare wind: number;
    declare up: boolean;
    declare at: BABYLON.Vector3;
    declare turn: number;
    declare body: number;
    declare contact: number;
    declare speed: number;
    declare mass: number;
    declare flying: boolean;
    declare was: BABYLON.Vector3 | null;
    declare hand: number;

    constructor(arm: Arm, camera: BABYLON.Camera) {
        this.arm = arm;
        this.camera = camera;
        this.side = arm.side;
        arm.hold('fist');
        arm.grasp = knuckles(arm);
        // From the wrist to the knuckles, in line with the forearm in a fist that is punching.
        this.hand = V3.Distance(arm.grasp.at, arm._in(arm.person.joint(`wrist.${this.side}`, 'head'), V3.Right(), V3.Up()).at);
        arm.reach(null);
        this.keys = [];
        this.t = this.wind = -1;
        this.up = false;
        this.at = this._mine(GUARD[this.side]);
        this.turn = 0.25;
        this.body = 0;
        this.contact = -1;
        this.speed = this.mass = 0;
        this.flying = false;
        this.was = null;
    }

    // A point of the right fist's frame, as this fist's.
    _mine(v: BABYLON.Vector3) { return this.side === 'R' ? v.clone() : new V3(-v.x, v.y, v.z); }

    // Where the knuckles are, in the world.
    knuckles() { return V3.TransformCoordinates(this._mine(this.at), this.camera.getWorldMatrix()); }

    // The fists taken up (in the guard) or put away.
    raise(on: boolean) {
        if (on === this.up) return;
        this.up = on;
        this.t = this.wind = -1;
        this.flying = false;
        this.body = 0;
        this.at = this._mine(GUARD[this.side]);
        this.turn = 0.25;
        this.arm.shift.setAll(0);
        if (!on) this.arm.reach(null);
        // (The same arm holds what is held, closed some other way round it: hands.ts.)
        else if (this.arm.holding !== 'fist') { this.arm.hold('fist'); this.arm.grasp = knuckles(this.arm); }
    }

    // The button pressed: wound up from wherever it is, if it is not already on its way out.
    windUp() {
        if (!this.up || this.wind >= 0 || this.flying) return;
        this.t = -1;
        this.wind = 0;
    }

    // How far wound up, 0 (a tap: a jab) to 1 (held a second).
    get charge() { return this.wind < 0 ? 0 : Math.min(1, Math.max(0, (this.wind - 0.08) / (PUNCH.wind - 0.08))); }

    // Let go: thrown, straight out from its own side of the chin to the end of the arm, unless it meets something first
    // (stopAt).
    letGo() {
        if (this.wind < 0) return;
        const c = this.charge, line = this._mine(LINE);
        this.wind = -1;
        const to = new V3(line.x, line.y, MISS), far = V3.Distance(this.at, to);
        this.speed = PUNCH.jab.speed + (PUNCH.full.speed - PUNCH.jab.speed) * c;
        this.mass = PUNCH.jab.mass + (PUNCH.full.mass - PUNCH.jab.mass) * c;
        // At its speed through the end (drive() is fastest two thirds of the way and goes on at its mean speed).
        const go = Math.min(0.2, Math.max(0.05, far / this.speed));
        this.keys = [{ at: this.at.clone(), t: 0, turn: this.turn, body: this.body, ease: smooth }, { at: to, t: go, turn: 1, body: 0.4 + 0.6 * c, ease: drive }];
        this.contact = go;
        this.t = 0;
        this.flying = true;
    }

    // Whatever is under way, put away (another thing taken up).
    stop() { this.raise(false); }

    update(dt: number) {
        if (!this.up) return;
        if (this.wind >= 0) {
            // Wound up: drawn back, eased toward how far it is wound, the body turned away with it.
            this.wind += dt;
            const c = smooth(this.charge), ease = Math.min(1, dt * 12), toward = V3.Lerp(this._mine(GUARD[this.side]), this._mine(DRAWN), c);
            this.at = V3.Lerp(this.at, toward, ease);
            this.turn += (0.1 - this.turn) * ease;
            this.body += (-c - this.body) * ease;
        } else if (this.t >= 0) {
            this.t += dt;
            if (this.flying && this.t >= this.contact) this._landed(null);
            const keys = this.keys, last = keys[keys.length - 1];
            if (this.t >= last.t) { this.t = -1; this.at = last.at.clone(); this.turn = last.turn; this.body = last.body; }
            else {
                let k = 1;
                while (keys[k].t <= this.t) k++;
                const a = keys[k - 1], b = keys[k], u = b.ease((this.t - a.t) / (b.t - a.t));
                this.at = V3.Lerp(a.at, b.at, u);
                this.turn = a.turn + (b.turn - a.turn) * u;
                this.body = a.body + (b.body - a.body) * u;
            }
        } else {
            // In the guard, breathing.
            const guard = this._mine(GUARD[this.side]), breath = Math.sin(performance.now() / 700 + (this.side === 'R' ? 0 : 1.3));
            this.at = V3.Lerp(this.at, guard.add(new V3(0, breath * 0.003, 0)), Math.min(1, dt * 8));
            this.turn += (0.25 - this.turn) * Math.min(1, dt * 8);
            this.body *= Math.max(0, 1 - dt * 8);
        }
        this.arm.shift.copyFrom(this.body < 0 ? AWAY.scale(-this.body) : INTO.scale(this.body));
        this._pose(this.turn);
    }

    // The view's turn with the body (rad): yaw, roll. The body turns away from a wound-up fist and into it as it goes out.
    lean() {
        const sign = this.side === 'R' ? 1 : -1;
        return { yaw: -sign * this.body * LEAN.yaw, roll: sign * this.body * LEAN.roll };
    }

    // At the target: stopped at the skin it met (where it was aimed, or a little nearer or further if they moved), held
    // there a moment and back off it; or, nothing there, on to the end of the arm, the shoulder pulled after it, and
    // slowly back. (Stopped at the skin and not on into it: the face is not dented under it, and knuckles going on two
    // centimetres into an undented face read as a fist passing through a head.)
    _landed(at: BABYLON.Vector3 | null) {
        this.flying = false;
        const t = this.contact, hit = this.keys[1], guard = this._mine(GUARD[this.side]), body = hit.body;
        this.keys.length = 2;
        if (at) {
            hit.at = at;
            this.keys.push({ at, t: t + 0.035, turn: 1, body, ease: off }, { at: guard, t: t + 0.3, turn: 0.25, body: 0, ease: smooth });
        } else {
            const on = hit.at.add(hit.at.subtract(this.keys[0].at).normalize().scale(0.03));
            this.keys.push({ at: on, t: t + 0.07, turn: 1.1, body: body * 1.1, ease: off }, { at: guard, t: t + 0.45, turn: 0.25, body: 0, ease: onto });
        }
    }

    // Stopped where it met something (a point of the world, where the knuckles crossed its skin), now.
    stopAt(point: BABYLON.Vector3) {
        if (!this.flying) return;
        const here = V3.TransformCoordinates(point, this.camera.getWorldMatrix().clone().invert()), at = this._mine(here);
        // (The way here from the start as it was, ending now, at the skin.)
        this.keys[1] = { ...this.keys[1], at, t: this.t, turn: this.turn, body: this.body };
        this.contact = this.t;
        this._landed(at);
        this.at = at.clone();
    }

    // The knuckles to `this.at`, the fist turned `turn` of the way over from upright (its back outward) to most of the way
    // flat (its back up). The arm is its own shoulder's (arm.ts): the elbow where an arm of that length from there puts it,
    // a little down and out from the line to the fist; and the wrist kept straight, the knuckles in line with the forearm,
    // so that the fist turns over by the forearm rolling (a hand aimed by itself bent the wrist back and left the hand
    // hanging off it).
    _pose(turn: number) {
        const m = this.camera.getWorldMatrix(), a = turn * 1.1, arm = this.arm, sign = this.side === 'R' ? 1 : -1;
        const at = V3.TransformCoordinates(this._mine(this.at), m), shoulder = arm._shoulder(), [upper, fore] = arm.lengths, rest = fore + this.hand;
        const line = at.subtract(shoulder), toward = line.normalizeToNew(), far = Math.min(line.length(), (upper + rest) * 0.985);
        const near = (upper * upper + far * far - rest * rest) / (2 * far), round = Math.sqrt(Math.max(0, upper * upper - near * near));
        const hangs = V3.TransformNormal(this._mine(HANGS), m), aside = hangs.subtract(toward.scale(V3.Dot(hangs, toward))).normalize();
        const elbow = shoulder.add(toward.scale(near)).add(aside.scale(round));
        const along = elbow.subtract(at).normalize();
        let back = V3.TransformNormal(new V3(sign * Math.cos(a), Math.sin(a), 0), m);
        back = back.subtract(along.scale(V3.Dot(back, along))).normalize();
        arm.reach({ at, along, back, elbow });
    }
}

// One of the player's arms (`side` 'R' or 'L'): a person's arm (arm.ts) in their own skin and the jacket's sleeve.
export function ownArm(people, body: string, side: 'R' | 'L', camera: BABYLON.Camera, hold: string, cast?: (m: BABYLON.AbstractMesh) => void) {
    const arm = new Arm(people, body, side, camera, { hold });
    for (const m of arm.meshes) m.dispose();
    arm.meshes = [armOnly(arm.person, side), sleeve(arm)];
    for (const m of arm.meshes) cast?.(m);
    return arm;
}

// The person's own mesh cut down to one arm's skin, in its own material (their clothes are not the player's: the
// sleeve is sleeve()'s). Only the hand and the wrist, and the forearm as far into the sleeve as can be seen up it: the
// rest is under the sleeve, and came out through it where the forearm turned.
function armOnly(person, side: string) {
    const ARM = new RegExp(`^(lowerarm|wrist|metacarpal|finger).*\\.${side}$`), wrist = person.byName[`wrist.${side}`].head;
    const { arrays } = person.lib.bodies.get(person.bodyName), P = arrays.position;
    const names = person.header.bones.map((b) => b.name), mine = new Uint8Array(person.header.vertexCount);
    for (let i = 0; i < mine.length; i++) {
        let k = 0;
        for (let j = 1; j < 4; j++) if (arrays.weights[i * 4 + j] > arrays.weights[i * 4 + k]) k = j;
        const name = names[arrays.joints[i * 4 + k]];
        mine[i] = ARM.test(name) && (!name.startsWith('lowerarm') || Math.hypot(P[i * 3] - wrist.x, P[i * 3 + 1] - wrist.y, P[i * 3 + 2] - wrist.z) < SLEEVE.cuff + 0.05) ? 1 : 0;
    }
    const mesh = person.mesh as BABYLON.Mesh, index = arrays.index, kept: number[] = [], parts: number[][] = [];
    person.header.parts.forEach((p, k) => {
        if (p.under || p.kind !== 'skin') return;
        const start = kept.length;
        for (let t = p.indexStart; t < p.indexStart + p.indexCount; t += 3) {
            if (mine[index[t]] && mine[index[t + 1]] && mine[index[t + 2]]) kept.push(index[t], index[t + 1], index[t + 2]);
        }
        if (kept.length > start) parts.push([k, p.vertexStart, p.vertexCount, start, kept.length - start]);
    });
    mesh.setIndices(kept);
    mesh.subMeshes = [];
    for (const [k, vs, vc, is, ic] of parts) new BABYLON.SubMesh(k, vs, vc, is, ic, mesh);
    mesh.isVisible = true;
    return mesh;
}

// The player's sleeve, made round the arm as it was made: a tube along the bones from high on the upper arm (behind the
// eye) to the cuff, each ring of it laid round the arm's own skin there (out to the furthest of that skin each way
// round, as cloth lies across the hollows of an arm, not into them) and the rings eased into each other, so it is
// smooth however coarse the skin under it. The cuff's edge is turned in, so it has a thickness and is not seen into.
// Each corner hangs on the bones the skin nearest it hangs on, and so bends at the elbow and turns with the forearm as
// the skin does; but only on the arm's own bones: the arm is posed alone, the shoulder and chest left as made, and a
// sleeve made of the skin itself, partly on the collarbone over the shoulder, was stretched out into grey flaps
// across the view when the arm came up.
function sleeve(arm: Arm) {
    const person = arm.person, { arrays } = person.lib.bodies.get(person.bodyName), names: string[] = person.header.bones.map((b) => b.name);
    const P = arrays.position, J = arrays.joints, W = arrays.weights, n = SLEEVE.around, side = arm.side;
    const bone = (name: string) => person.byName[`${name}.${side}`], at = (i: number) => new V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const own = new RegExp(`^(upperarm|lowerarm)\\d+\\.${side}$`), keeps = new RegExp(`^(upperarm|lowerarm)\\d+\\.${side}$|^wrist\\.${side}$`);
    const skin: number[] = [];
    for (let i = 0; i < person.header.vertexCount; i++) {
        let k = 0;
        for (let j = 1; j < 4; j++) if (W[i * 4 + j] > W[i * 4 + k]) k = j;
        if (own.test(names[J[i * 4 + k]])) skin.push(i);
    }

    // The line it runs along: a fifth of the way down the upper arm, the elbow, and the cuff short of the wrist.
    const elbow = bone('lowerarm01').head, wrist = bone('wrist').head;
    const top = V3.Lerp(bone('upperarm01').head, elbow, 0.2), end = wrist.add(elbow.subtract(wrist).normalize().scale(SLEEVE.cuff));
    const upper = V3.Distance(top, elbow), length = upper + V3.Distance(elbow, end), count = Math.ceil(length / SLEEVE.step);
    const d1 = elbow.subtract(top).normalize(), d2 = end.subtract(elbow).normalize();
    // Each ring: its centre (the skin's middle there), the way the arm runs, two ways across it, and how far out the skin
    // reaches each way round from the centre.
    const rings: { c: BABYLON.Vector3; d: BABYLON.Vector3; u: BABYLON.Vector3; v: BABYLON.Vector3; s: number; reach: number[] }[] = [];
    let u = V3.Cross(d1, V3.Forward()).normalize();
    for (let k = 0; k <= count; k++) {
        const s = (k / count) * length, bend = Math.min(1, Math.max(0, (s - upper + 0.03) / 0.06));
        const c = s < upper ? top.add(d1.scale(s)) : elbow.add(d2.scale(s - upper));
        const d = V3.Lerp(d1, d2, bend * bend * (3 - 2 * bend)).normalize();
        u = u.subtract(d.scale(V3.Dot(u, d))).normalize();
        const v = V3.Cross(d, u), near = skin.map(at).filter((p) => Math.abs(V3.Dot(p.subtract(c), d)) < 0.012).map((p) => { const r = p.subtract(c); return r.subtract(d.scale(V3.Dot(r, d))); });
        const mid = near.reduce((m, r) => m.addInPlace(r), V3.Zero()).scale(1 / Math.max(1, near.length));
        const reach = Array.from({ length: n }, (_, i) => {
            const w = u.scale(Math.cos((2 * Math.PI * i) / n)).add(v.scale(Math.sin((2 * Math.PI * i) / n)));
            return near.reduce((most, r) => Math.max(most, V3.Dot(r.subtract(mid), w)), 0);
        });
        rings.push({ c: c.add(mid), d, u, v, s, reach });
    }
    // Eased: each ring and each way round toward its neighbours, a few times over.
    for (let pass = 0; pass < 4; pass++) {
        const was = rings.map((r) => ({ c: r.c.clone(), reach: r.reach.slice() }));
        rings.forEach((r, k) => {
            const a = was[Math.max(0, k - 1)], b = was[Math.min(rings.length - 1, k + 1)], me = was[k];
            r.c = a.c.add(me.c.scale(2)).add(b.c).scale(0.25);
            r.reach = me.reach.map((x, i) => (a.reach[i] + b.reach[i] + me.reach[(i + n - 1) % n] + me.reach[(i + 1) % n] + 4 * x) / 8);
        });
    }

    // The cloth: loose off the skin, the hem standing proud over its last few centimetres, folds gathered above it.
    const hemAt = length - SLEEVE.band, smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const out = (r: (typeof rings)[0], i: number) => {
        const a = (2 * Math.PI * i) / n, s = r.s;
        const folds = SLEEVE.fold * smooth(upper, upper + 0.06, s) * (1 - smooth(hemAt - 0.02, hemAt, s)) * Math.sin((2 * Math.PI * s) / 0.06 + 1.3 * Math.sin(2 * a + s * 25));
        return r.reach[i] + SLEEVE.loose[0] + (SLEEVE.loose[1] - SLEEVE.loose[0]) * smooth(upper - 0.05, upper + 0.05, s) + SLEEVE.hem * smooth(hemAt - 0.004, hemAt, s) + folds;
    };
    const round = (r: (typeof rings)[0], i: number, radius: number, ahead = 0) => {
        const a = (2 * Math.PI * i) / n;
        return r.c.add(r.d.scale(ahead)).add(r.u.scale(Math.cos(a) * radius)).add(r.v.scale(Math.sin(a) * radius));
    };
    const loops: BABYLON.Vector3[][] = rings.map((r) => Array.from({ length: n }, (_, i) => round(r, i, out(r, i))));
    // Over the edge in a half round and back inside the hem, `turn` in from its outside.
    const last = rings[rings.length - 1], lip = SLEEVE.turn / 2;
    for (let t = 1; t <= 4; t++) {
        const q = (t / 4) * Math.PI;
        loops.push(Array.from({ length: n }, (_, i) => round(last, i, out(last, i) - lip * (1 - Math.cos(q)), lip * Math.sin(q))));
    }
    for (const back of [0.008, 0.025]) {
        const r = rings[Math.max(0, Math.round((length - back) / (length / count)))];
        loops.push(Array.from({ length: n }, (_, i) => round(r, i, out(last, i) - SLEEVE.turn)));
    }

    const positions: number[] = [], indices: number[] = [], joints: number[] = [], weights: number[] = [];
    loops.forEach((loop, k) => {
        for (const p of loop) {
            positions.push(p.x, p.y, p.z);
            // On the bones of the nearest skin, whatever of it hangs on the shoulder or the chest given to the upper arm.
            let best = skin[0], far = Infinity;
            for (const i of skin) { const f = (P[i * 3] - p.x) ** 2 + (P[i * 3 + 1] - p.y) ** 2 + (P[i * 3 + 2] - p.z) ** 2; if (f < far) { far = f; best = i; } }
            for (let j = 0; j < 4; j++) {
                const b = J[best * 4 + j];
                joints.push(keeps.test(names[b]) ? b : bone('upperarm01').index);
                weights.push(W[best * 4 + j] / 255);
            }
        }
        if (k === 0) return;
        const a = (k - 1) * n, b = k * n;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            indices.push(a + i, b + i, b + j, a + i, b + j, a + j);
        }
    });
    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    // (Wound the way the body's skin is, so that its outside is the side drawn.)
    const probe = loops[1][0].subtract(rings[1].c);
    if (normals[n * 3] * probe.x + normals[n * 3 + 1] * probe.y + normals[n * 3 + 2] * probe.z < 0) {
        for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    }

    const data = new BABYLON.VertexData(), mesh = new BABYLON.Mesh('sleeve', person.scene);
    Object.assign(data, { positions, indices, normals, matricesIndices: joints, matricesWeights: weights });
    data.applyToMesh(mesh);
    mesh.parent = person.body;
    mesh.position.copyFrom(person.mesh.position);
    mesh.skeleton = person.skeleton;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;       // the skinned bounds lie
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    const material = plain(person.scene, 'sleeve', SLEEVE);
    material.backFaceCulling = true;
    material.environmentIntensity = 0.6;
    mesh.material = material;
    return mesh;
}

// Where a fist lands, for Arm.reach: on the skin over the first two knuckles, the hand running back from there to the
// wrist, its back away from the curled fingers. In the person's own frame, the arm as it was made.
function knuckles(arm: Arm) {
    const person = arm.person, here = (name: string, end = 'head') => arm._in(person.joint(`${name}.${arm.side}`, end), V3.Right(), V3.Up()).at;
    const mid = V3.Lerp(here('finger2-1'), here('finger3-1'), 0.5), ahead = mid.subtract(here('wrist')).normalize();
    const curled = V3.Lerp(here('finger2-3', 'tail'), here('finger3-3', 'tail'), 0.5).subtract(mid);
    const back = curled.subtract(ahead.scale(V3.Dot(curled, ahead))).normalize().negate(), along = ahead.negate();
    return { at: mid.add(ahead.scale(0.015)), along, rotation: BABYLON.Quaternion.RotationQuaternionFromAxis(along, back, V3.Cross(along, back)) };
}
