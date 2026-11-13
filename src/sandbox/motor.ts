// Muscles: what a person's joints aim for and how hard they pull.
//
// A pose (poses.ts: joint angles by name, in degrees) is turned into each
// joint's target the way person.ts would turn the skeleton's bones, so the
// same `kneeL: 90` that bends a posed person's knee bends a ragdoll's, and the
// joint's motors (ragdoll.hold) pull toward it with whatever strength the body
// has left in that limb.
//
// Muscles move a body against itself; to rise, keep upright or drag itself
// along it has to push on something. The few pushes behaviour.ts asks for
// beyond the joints (lifting the trunk off the floor, staying upright, a hand
// reaching for a wound) are therefore always paid for: what pushes one part
// pushes another the other way, mostly the limbs that are on the floor, so a
// body with nothing under it cannot lift itself, and one standing on its feet
// can only keep upright as hard as its feet can press.

import * as BABYLON from '@babylonjs/core';
import { jointAngles, type Ragdoll } from './ragdoll.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;

const RAD = Math.PI / 180;
// Which of the strengths behaviour.ts gives each joint goes by.
const PART = (name: string) => /^(belly|chest)$/.test(name) ? 'trunk' : name === 'head' ? 'neck'
    : /^(upperarm|forearm|hand)/.test(name) ? 'arm' + name.slice(-1) : 'leg' + name.slice(-1);

export type Strength = { trunk: number; neck: number; armL: number; armR: number; legL: number; legR: number };

const _q = new Q(), _q2 = new Q(), _local = new Q(), _v = new V3(), _w = new V3(), _a = new V3();

export class Muscles {
    declare ragdoll: Ragdoll;
    declare joints: { seg: any; part: string; bones: any[][]; target: number[]; q: BABYLON.Quaternion }[];
    declare fingers: { bone: BABYLON.Bone; turns: any[]; hand: any }[];
    declare _curl: string;
    declare _hands: string[];

    constructor(ragdoll: Ragdoll) {
        this.ragdoll = ragdoll;
        const person = ragdoll.person;
        // Every control that turns each bone, in the order person.apply turns them: twist, out to the side, forward.
        const turns = new Map<string, any[]>();
        for (const [control, h] of Object.entries(person.hinges) as [string, any][]) {
            const share = h.bones.length > 1 && !h.fingers ? 1 / h.bones.length : 1;
            h.bones.forEach((b, k) => {
                const name = b.bone.name;
                if (!turns.has(name)) turns.set(name, []);
                // (a finger bone bends about its own line across it: person.ts's `axes`)
                turns.get(name).push({ control, axis: h.axes?.[k] ?? h.axis, share, order: h.order ?? 1, fingers: !!h.fingers, bend: h.bend ? (deg) => h.bend(deg, k) : null });
            });
        }
        for (const list of turns.values()) list.sort((a, b) => a.order - b.order);
        this.joints = ragdoll.segments.filter((s) => s.parent && !s.locked)
            .map((seg) => ({ seg, part: PART(seg.name), bones: seg.chain.map((n) => turns.get(n) ?? []), target: [0, 0, 0], q: new Q() }));
        // The fingers have no bodies: they are posed straight from the pose, to curl round nothing or open to brace.
        this.fingers = [...turns.entries()].filter(([, list]) => list.some((t) => t.fingers))
            .map(([name, list]) => ({ bone: person.byName[name].bone, turns: list, hand: ragdoll.byName.get('hand' + name.slice(-1)) }));
        this._hands = [...new Set(this.fingers.flatMap((f) => f.turns.map((t) => t.control)))];
        this._curl = '';
    }

    // The turn a pose gives a run of bones, as person.apply composes it.
    _turn(bones: any[][], pose, out: BABYLON.Quaternion) {
        out.copyFromFloats(0, 0, 0, 1);
        for (const list of bones) {
            _local.copyFromFloats(0, 0, 0, 1);
            for (const t of list) {
                const deg = pose[t.control];
                if (!deg) continue;
                Q.RotationAxisToRef(t.axis, (t.bend ? t.bend(deg) : deg) * RAD * t.share, _q);
                _q.multiplyToRef(_local, _q2);
                _local.copyFrom(_q2);
            }
            out.multiplyInPlace(_local);
        }
        return out;
    }

    // Every joint pulled toward `pose` with the strength of its part of the body (0 to 1); a joint below a broken bone
    // is left to hang.
    follow(pose, strength: Strength) {
        const rd = this.ragdoll;
        for (const j of this.joints) {
            const s = rd.loose(j.seg) ? 0 : strength[j.part];
            if (s > 0.004) rd.hold(j.seg, jointAngles(this._turn(j.bones, pose, j.q).multiplyInPlace(j.seg.unneutral), j.seg.frame, j.target), s);
            else rd.hold(j.seg, j.target, 0);
        }
        // (Every control a finger answers to: keyed on the curl and thumb alone, a hand told to cup or to hold its
        // thumb in did not.)
        let curl = '';
        for (const c of this._hands) curl += (pose[c] | 0) + ',';
        if (curl !== this._curl) {
            this._curl = curl;
            // (A hand cut off keeps the fingers as they were: nothing curls them any more.)
            // (Into a quaternion of its own: `_turn` works in _q2, and given it to fill as well it squared each finger's
            // turn, so a guard's half-closed hands bent every finger joint twice over, out flat and splayed.)
            for (const f of this.fingers) if (!rd.cutOff(f.hand)) f.bone.setRotationQuaternion(this._turn([f.turns], pose, new Q()), BABYLON.Space.LOCAL);
        }
    }

    // --- pushes the body gives itself ---------------------------------------------------

    // `force` (N, world) on segment `seg` for `dt`, and the same back on the segments `against`.
    push(seg, force: BABYLON.Vector3, against: any[], dt: number) {
        if (!against.length) return;
        const rd = this.ragdoll;
        seg.body.applyImpulse(force.scale(dt), rd.worldPoint(seg, seg.centre, _w).clone());
        const back = force.scale(-dt / against.length);
        for (const s of against) s.body.applyImpulse(back, rd.worldPoint(s, s.centre, _w).clone());
    }

    // `torque` (N m, world) on segment `seg` for `dt`, and the same back on the segments `against`.
    turn(seg, torque: BABYLON.Vector3, against: any[], dt: number) {
        if (!against.length) return;
        seg.body.applyAngularImpulse(torque.scale(dt));
        const back = torque.scale(-dt / against.length);
        for (const s of against) s.body.applyAngularImpulse(back);
    }

    // The whole body swayed as the floor sways it through the feet: every part but `planted` pushed along `accel`
    // (m/s2, level) in proportion to its weight and its height over the floor, as if turned about the ankles, so the
    // middle of the weight is carried at `accel` and no joint has to pass the push on.
    lean(accel: BABYLON.Vector3, height: number, planted: any[], dt: number) {
        const rd = this.ragdoll;
        for (const seg of rd.attached) {
            if (planted.includes(seg)) continue;
            rd.worldPoint(seg, seg.centre, _w);
            const k = seg.mass * dt * Math.max(0, _w.y) / height;
            seg.body.applyImpulse(_v.copyFrom(accel).scaleInPlace(k), _w);
        }
    }

    // The torque that turns `seg` toward the world turn `want` like a damped spring (`rate`, per second squared, for
    // a body of `inertia` kg m2), no more than `most` N m.
    toward(seg, want: BABYLON.Quaternion, rate: number, inertia: number, most: number, out: BABYLON.Vector3) {
        Q.InverseToRef(seg.node.rotationQuaternion, _q);
        want.multiplyToRef(_q, _q2);
        if (_q2.w < 0) _q2.scaleInPlace(-1);
        const s = Math.hypot(_q2.x, _q2.y, _q2.z), angle = 2 * Math.atan2(s, _q2.w);
        out.set(_q2.x, _q2.y, _q2.z).scaleInPlace(s > 1e-6 ? angle / s : 0);
        seg.body.getAngularVelocityToRef(_a);
        out.scaleInPlace(rate).subtractInPlace(_a.scaleInPlace(2 * Math.sqrt(rate))).scaleInPlace(inertia);
        const n = out.length();
        if (n > most) out.scaleInPlace(most / n);
        return out;
    }

    // The force that carries `seg`'s middle toward `at` like a damped spring (`rate` per second squared) for `mass`
    // kg, no more than `most` N.
    reach(seg, at: BABYLON.Vector3, rate: number, mass: number, most: number, out: BABYLON.Vector3) {
        this.ragdoll.worldPoint(seg, seg.centre, _v);
        seg.body.getLinearVelocityToRef(_a);
        at.subtractToRef(_v, out).scaleInPlace(rate).subtractInPlace(_a.scaleInPlace(2 * Math.sqrt(rate))).scaleInPlace(mass);
        const n = out.length();
        if (n > most) out.scaleInPlace(most / n);
        return out;
    }
}
