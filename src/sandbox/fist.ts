// The player's right arm, drawn while it punches.
//
// A person's arm (table/arm.ts: a person's bones, the hand closed into a fist, the elbow found between a shoulder
// beside and below the eye and the wrist), in that person's own skin and sleeve. What is moved is the knuckles. An
// untrained man telegraphs it: the fist comes up from below and is drawn back beside the cheek, then driven at the
// middle of the view, turning over from upright to most of the way flat as it goes and fastest a little before it
// lands (7 m/s at the hand, dev/research/blunt-trauma.md). What it lands on stops it short and gives a little under
// it, and the arm comes back off it; a miss carries it on to the end of the arm and is pulled back slower.

import * as BABYLON from '@babylonjs/core';
import { Arm } from '../table/arm.ts';
const V3 = BABYLON.Vector3;

// The knuckles, in the eye's frame (x right, y up, z ahead), m.
const DOWN = new V3(0.2, -0.5, 0.12);       // hanging, below the picture
const COCKED = new V3(0.17, -0.15, 0.08);   // drawn back beside the cheek
const MISS = new V3(0.02, -0.04, 0.6);      // the arm's end, nothing met
const ELBOW = new V3(0.22, -0.32, -0.15);   // the forearm runs back from the fist toward about here
const SPEED = 7;                             // m/s at the hand, the most
const SINKS = 0.02;                          // m the fist goes on into what it lands on, the flesh and the arm giving
const ARM = /^(upperarm|lowerarm|wrist|finger).*\.R$/;

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
    declare land: (() => boolean) | null;
    declare driving: (() => void) | null;

    constructor(people, body: string, camera: BABYLON.Camera, cast?: (m: BABYLON.AbstractMesh) => void) {
        this.camera = camera;
        this.arm = new Arm(people, body, 'R', camera, { hold: 'fist' });
        for (const m of this.arm.meshes) m.dispose();
        this.arm.meshes = [armOnly(this.arm.person)];
        cast?.(this.arm.meshes[0]);
        this.arm.grasp = knuckles(this.arm);
        this.arm.reach(null);
        this.keys = [];
        this.t = -1;
        this.at = DOWN.clone();
        this.contact = -1;
        this.land = this.driving = null;
    }

    // A punch at `target` (a point of the world in reach, or null for none). `driving` is told when the fist sets off
    // toward it, `land` asked when the knuckles get there: true if something was there to stop them.
    punch(target: BABYLON.Vector3 | null, { driving, land }: { driving?: () => void; land?: () => boolean } = {}) {
        const from = this.t >= 0 ? this.at.clone() : DOWN.clone();
        const to = target ? V3.TransformCoordinates(target, this.camera.getWorldMatrix().clone().invert()) : MISS.clone();
        const up = 0.11 * Math.min(1, Math.max(0.35, V3.Distance(from, COCKED) / V3.Distance(DOWN, COCKED)));
        // The mean of `drive` is three quarters of its most.
        const go = Math.min(0.17, Math.max(0.06, V3.Distance(COCKED, to) / (SPEED * 0.75)));
        this.keys = [{ at: from, t: 0, turn: 0, ease: smooth }, { at: COCKED, t: up, turn: 0, ease: smooth }, { at: to, t: up + go, turn: 1, ease: drive, arc: 0.05 }];
        this.contact = up + go;
        this.t = 0;
        this.driving = driving ?? null;
        this.land = land ?? (() => false);
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
        const go = this.keys[1].t;
        if (this.driving && was < go && this.t >= go) { this.driving(); this.driving = null; }
        if (this.land && this.t >= this.contact) this._landed(this.land());
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

    // At the target: stopped there, the flesh and the arm giving a little, and back off it; or, nothing there, on to the
    // end of the arm, the shoulder pulled after it, and slowly back.
    _landed(hit: boolean) {
        this.land = null;
        const t = this.contact, at = this.keys[2].at, way = at.subtract(COCKED).normalize(), back = COCKED.add(new V3(0.01, -0.03, 0));
        this.keys.length = 3;
        if (hit) {
            this.keys.push({ at: at.add(way.scale(SINKS)), t: t + 0.035, turn: 1, ease: off },
                { at: back, t: t + 0.25, turn: 0.4, ease: off }, { at: DOWN, t: t + 0.45, turn: 0, ease: onto });
        } else {
            this.keys.push({ at: MISS.add(way.scale(0.03)), t: t + 0.07, turn: 1.1, ease: off },
                { at: back, t: t + 0.36, turn: 0.4, ease: smooth }, { at: DOWN, t: t + 0.58, turn: 0, ease: onto });
        }
    }

    // The knuckles to `this.at`, the fist turned `turn` of the way over from upright (its back to the right) to most of
    // the way flat (its back up), the forearm running back from it toward where the elbow is.
    _pose(turn: number) {
        const m = this.camera.getWorldMatrix(), a = turn * 1.1;
        const along = ELBOW.subtract(this.at).normalize();
        let back = new V3(Math.cos(a), Math.sin(a), 0);
        back = back.subtract(along.scale(V3.Dot(back, along))).normalize();
        this.arm.reach({ at: V3.TransformCoordinates(this.at, m), along: V3.TransformNormal(along, m), back: V3.TransformNormal(back, m) });
    }
}

// The person's own mesh cut down to the right arm: the skin of the hand and the sleeve, in their own materials. (Cut at
// the shoulder, which is behind the eye.)
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
        if (p.under || (p.kind !== 'skin' && p.kind !== 'cloth')) return;
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

// Where a fist lands, for Arm.reach: on the skin over the first two knuckles, the hand running back from there to the
// wrist, its back away from the curled fingers. In the person's own frame, the arm as it was made.
function knuckles(arm: Arm) {
    const person = arm.person, here = (name: string, end = 'head') => arm._in(person.joint(`${name}.R`, end), V3.Right(), V3.Up()).at;
    const mid = V3.Lerp(here('finger2-1'), here('finger3-1'), 0.5), ahead = mid.subtract(here('wrist')).normalize();
    const curled = V3.Lerp(here('finger2-3', 'tail'), here('finger3-3', 'tail'), 0.5).subtract(mid);
    const back = curled.subtract(ahead.scale(V3.Dot(curled, ahead))).normalize().negate(), along = ahead.negate();
    return { at: mid.add(ahead.scale(0.015)), along, rotation: BABYLON.Quaternion.RotationQuaternionFromAxis(along, back, V3.Cross(along, back)) };
}
