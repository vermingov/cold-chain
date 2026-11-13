// The player's right arm, drawn while it punches.
//
// A person's arm (table/arm.ts: a person's bones, the hand closed into a fist, the elbow found between a shoulder
// beside and below the eye and the wrist), in that person's own skin and sleeve. What is moved is the knuckles. An
// untrained man telegraphs it: the fist comes up from below and is drawn back beside the jaw, then driven at the
// middle of the view, turning over from upright to most of the way flat as it goes and fastest a little before it
// lands (7 m/s at the most, landing at about 5). The blow is dealt on the frame the knuckles get there, at the speed
// they get there with (weapons.ts). What it lands on stops it short and gives a little under it, and the arm comes
// back off it; a miss carries it on to the end of the arm and is pulled back slower.

import * as BABYLON from '@babylonjs/core';
import { Arm, worn, plain } from '../table/arm.ts';
const V3 = BABYLON.Vector3;

// The knuckles, in the eye's frame (x right, y up, z ahead), m.
const DOWN = new V3(0.2, -0.5, 0.12);       // hanging, below the picture
const COCKED = new V3(0.14, -0.09, 0.2);    // drawn back beside the jaw, at the bottom corner of the view (further in is out of it)
const MISS = new V3(0.02, -0.04, 0.6);      // the arm's end, nothing met
const HANGS = new V3(0.3, -1, -0.15);       // the way the elbow is off the line from shoulder to fist: down, a little out
const SPEED = 7;                             // m/s at the hand, the most
const ARM = /^(upperarm|lowerarm|wrist|finger).*\.R$/;
// What the player wears on it: a canvas work jacket, its sleeve down to a cuff short of the wrist, standing off the skin.
const SLEEVE = { colour: [0.24, 0.23, 0.2], rough: 0.85, off: 0.007, cuff: 0.03 };

type Key = { at: BABYLON.Vector3; t: number; turn: number; ease: (u: number) => number; arc?: number };
const smooth = (u: number) => u * u * (3 - 2 * u);
const drive = (u: number) => u * u * (2 - u);   // fastest at two thirds of the way, still moving when it gets there
const off = (u: number) => 1 - (1 - u) * (1 - u);
const onto = (u: number) => u * u;

export class Fist {
    declare arm: Arm;
    declare camera: BABYLON.Camera;
    declare keys: Key[];
    declare t: number;
    declare at: BABYLON.Vector3;
    declare contact: number;
    declare speed: number;
    declare land: ((speed: number, ahead: number) => number | null) | null;
    declare aim: (() => number | null) | null;
    declare hand: number;

    constructor(people, body: string, camera: BABYLON.Camera, cast?: (m: BABYLON.AbstractMesh) => void) {
        this.camera = camera;
        this.arm = new Arm(people, body, 'R', camera, { hold: 'fist' });
        for (const m of this.arm.meshes) m.dispose();
        this.arm.meshes = [armOnly(this.arm.person), sleeve(this.arm)];
        for (const m of this.arm.meshes) cast?.(m);
        this.arm.grasp = knuckles(this.arm);
        // From the wrist to the knuckles, in line with the forearm in a fist that is punching.
        this.hand = V3.Distance(this.arm.grasp.at, this.arm._in(this.arm.person.joint('wrist.R', 'head'), V3.Right(), V3.Up()).at);
        this.arm.reach(null);
        this.keys = [];
        this.t = -1;
        this.at = DOWN.clone();
        this.contact = -1;
        this.speed = 0;
        this.land = this.aim = null;
    }

    // A punch, thrown straight ahead of the eye. `aim` is asked as the fist sets off from beside the cheek: how far ahead
    // of the eye what it is thrown at is (m), or null for nothing in reach; it goes there, or on to the end of the arm.
    // (Asked then and not at the press, so that someone who staggered while it was drawn back is still where it lands.)
    // `land` is asked when the knuckles get there, with how fast they are going and how far ahead of the eye they are:
    // how far ahead the skin they met is, or null for none.
    punch({ aim, land }: { aim?: () => number | null; land?: (speed: number, ahead: number) => number | null } = {}) {
        const from = this.t >= 0 ? this.at.clone() : DOWN.clone();
        const up = 0.16 * Math.min(1, Math.max(0.35, V3.Distance(from, COCKED) / V3.Distance(DOWN, COCKED)));
        this.keys = [{ at: from, t: 0, turn: 0, ease: smooth }, { at: COCKED, t: up, turn: 0, ease: smooth }, { at: MISS, t: up + 1, turn: 1, ease: drive }];
        this.contact = Infinity;
        this.t = 0;
        this.aim = aim ?? (() => null);
        this.land = land ?? (() => null);
    }

    // Set off from beside the cheek at what `aim` says. `drive` is fastest two thirds of the way and lands at its mean
    // speed, three quarters of its most: an untrained arm going flat out lands at about 5 m/s, 670 N into a face
    // behind 1.8 kg of fist and forearm giving at 9 kN/m (weapons.ts), inside the 500 to 850 N measured.
    _drive() {
        const ahead = this.aim();
        this.aim = null;
        const to = ahead === null ? MISS.clone() : new V3(0, 0, ahead), far = V3.Distance(COCKED, to);
        const up = this.keys[1].t, go = Math.min(0.17, Math.max(0.06, far / (SPEED * 0.75)));
        this.keys[2] = { at: to, t: up + go, turn: 1, ease: drive, arc: 0.05 };
        this.contact = up + go;
        this.speed = far / go;
    }

    // Whatever is under way, put away (another thing taken up).
    stop() {
        this.t = -1;
        this.arm.reach(null);
    }

    update(dt: number) {
        if (this.t < 0) return;
        const was = this.t;
        this.t += dt;
        if (this.aim && was < this.keys[1].t && this.t >= this.keys[1].t) this._drive();
        if (this.land && this.t >= this.contact) this._landed(this.land(this.speed, this.keys[2].at.z));
        const keys = this.keys, last = keys[keys.length - 1];
        if (this.t >= last.t) { this.stop(); return; }
        let k = 1;
        while (keys[k].t <= this.t) k++;
        const a = keys[k - 1], b = keys[k], u = b.ease((this.t - a.t) / (b.t - a.t));
        this.at = V3.Lerp(a.at, b.at, u);
        // (thrown round a little from outside, the way an untrained arm swings in)
        if (b.arc) this.at.addInPlace(new V3(b.arc, -b.arc * 0.5, 0).scale(Math.sin(Math.PI * u)));
        this._pose(a.turn + (b.turn - a.turn) * u);
    }

    // At the target: stopped at the skin it met (where it was aimed, or a little nearer or further if they moved), held
    // there a moment and back off it; or, nothing there, on to the end of the arm, the shoulder pulled after it, and
    // slowly back. (Stopped at the skin and not on into it: the face is not dented under it, and knuckles going on two
    // centimetres into an undented face read as a fist passing through a head.)
    _landed(skin: number | null) {
        this.land = null;
        const t = this.contact, way = this.keys[2].at.subtract(COCKED).normalize(), back = COCKED.add(new V3(0.01, -0.03, 0));
        this.keys.length = 3;
        if (skin !== null) {
            const at = (this.keys[2].at = new V3(0, 0, skin));
            this.keys.push({ at, t: t + 0.035, turn: 1, ease: off },
                { at: back, t: t + 0.25, turn: 0.4, ease: off }, { at: DOWN, t: t + 0.45, turn: 0, ease: onto });
        } else {
            this.keys.push({ at: MISS.add(way.scale(0.03)), t: t + 0.07, turn: 1.1, ease: off },
                { at: back, t: t + 0.36, turn: 0.4, ease: smooth }, { at: DOWN, t: t + 0.58, turn: 0, ease: onto });
        }
    }

    // The knuckles to `this.at`, the fist turned `turn` of the way over from upright (its back to the right) to most of
    // the way flat (its back up). The arm is the right shoulder's (arm.ts): the elbow where an arm of that length from
    // there puts it, a little down and out from the line to the fist; and the wrist kept straight, the knuckles in line
    // with the forearm, so that the fist turns over by the forearm rolling (a hand aimed by itself bent the wrist back
    // and left the hand hanging off it).
    _pose(turn: number) {
        const m = this.camera.getWorldMatrix(), a = turn * 1.1, arm = this.arm;
        const at = V3.TransformCoordinates(this.at, m), shoulder = arm._shoulder(), [upper, fore] = arm.lengths, rest = fore + this.hand;
        const line = at.subtract(shoulder), toward = line.normalizeToNew(), far = Math.min(line.length(), (upper + rest) * 0.985);
        const near = (upper * upper + far * far - rest * rest) / (2 * far), round = Math.sqrt(Math.max(0, upper * upper - near * near));
        const hangs = V3.TransformNormal(HANGS, m), aside = hangs.subtract(toward.scale(V3.Dot(hangs, toward))).normalize();
        const elbow = shoulder.add(toward.scale(near)).add(aside.scale(round));
        const along = elbow.subtract(at).normalize();
        let back = V3.TransformNormal(new V3(Math.cos(a), Math.sin(a), 0), m);
        back = back.subtract(along.scale(V3.Dot(back, along))).normalize();
        arm.reach({ at, along, back, elbow });
    }
}

// The person's own mesh cut down to the right arm's skin, in its own material (their clothes are not the player's: the
// sleeve is sleeve()'s). Cut at the shoulder, which is behind the eye.
function armOnly(person) {
    const { arrays } = person.lib.bodies.get(person.bodyName);
    const names = person.header.bones.map((b) => b.name), mine = new Uint8Array(person.header.vertexCount);
    for (let i = 0; i < mine.length; i++) {
        let k = 0;
        for (let j = 1; j < 4; j++) if (arrays.weights[i * 4 + j] > arrays.weights[i * 4 + k]) k = j;
        mine[i] = ARM.test(names[arrays.joints[i * 4 + k]]) ? 1 : 0;
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

// The player's sleeve, made as the table's glove is (arm.ts's worn()): the skin of the upper arm and the forearm down to
// a cuff short of the wrist, pushed out off it the thickness of a jacket and what is under it, on the arm's bones.
function sleeve(arm: Arm) {
    const person = arm.person, { arrays } = person.lib.bodies.get(person.bodyName), names = person.header.bones.map((b) => b.name);
    const wrist = arm.bones.wrist.head, P = arrays.position, W = arrays.weights;
    const on = (i: number) => {
        let k = 0;
        for (let j = 1; j < 4; j++) if (W[i * 4 + j] > W[i * 4 + k]) k = j;
        return /^(upperarm|lowerarm).*\.R$/.test(names[arrays.joints[i * 4 + k]])
            && Math.hypot(P[i * 3] - wrist.x, P[i * 3 + 1] - wrist.y, P[i * 3 + 2] - wrist.z) > SLEEVE.cuff;
    };
    const mesh = worn(person, 'sleeve', (three: number[]) => three.every(on), SLEEVE.off, plain(person.scene, 'sleeve', SLEEVE));
    (mesh.material as BABYLON.PBRMaterial).environmentIntensity = 0.6;
    return mesh;
}

// Where a fist lands, for Arm.reach: on the skin over the first two knuckles, the hand running back from there to the
// wrist, its back away from the curled fingers. In the person's own frame, the arm as it was made.
function knuckles(arm: Arm) {
    const person = arm.person, here = (name: string, end = 'head') => arm._in(person.joint(`${name}.R`, end), V3.Right(), V3.Up()).at;
    const mid = V3.Lerp(here('finger2-1'), here('finger3-1'), 0.5), ahead = mid.subtract(here('wrist')).normalize();
    const curled = V3.Lerp(here('finger2-3', 'tail'), here('finger3-3', 'tail'), 0.5).subtract(mid);
    const back = curled.subtract(ahead.scale(V3.Dot(curled, ahead))).normalize().negate(), along = ahead.negate();
    return { at: mid.add(ahead.scale(0.015)), along, rotation: BABYLON.Quaternion.RotationQuaternionFromAxis(along, back, V3.Cross(along, back)) };
}
