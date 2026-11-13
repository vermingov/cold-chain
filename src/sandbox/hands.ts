// The player's two arms on whatever is held in them.
//
// Each is a person's arm (table/arm.ts), dressed as fist.ts dresses the punching one (their own skin and a jacket
// sleeve); the right is the very arm that punches. What is held says where each hand goes on it (weapons.ts HELD: a
// place on the thing, the way its handle runs through the hand and the way the hand lies along it), and the fingers
// close round it as one of HOLDS says. Each arm is then solved from its shoulder to that hand (Arm.reach), so the arms
// go wherever the thing goes: a recoil, a swing or a reload moves the thing, and the hands come with it.

import * as BABYLON from '@babylonjs/core';
import { Arm } from '../table/arm.ts';
import { ownArm } from './fist.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;

// Which way from the shoulder each elbow is (in the person's own frame: x out to its side, y up, z ahead): down and a
// little out, as elbows are under something held up in front; else an arm solved for the straightest wrist put the
// elbow up and out beside the gun.
const ELBOW = { out: 0.35, down: 1, ahead: -0.1 };
// Holds whose fingers close round a handle (the others hold things at the finger tips, as Arm's own grasp has it).
const WRAPS = new Set(['grip', 'support', 'wrap', 'handle', 'ball']);

// A hand on a thing, in the thing's own frame: closed as `hold` (HOLDS), the handle's line through the hand at `at`,
// running `along` from the index finger's side toward the little finger's, and the hand lying `back` from the wrist to
// the knuckles (square to `along`, or made so). `shoulder`: that arm's shoulder brought this far from where it hangs
// (Arm.shift): a long gun's other hand reaches its forend because the body turns that shoulder forward.
export type Grip = { hold: string; at: number[]; along: number[]; back: number[]; shoulder?: number[] };

export class Hands {
    declare arms: Record<'R' | 'L', Arm>;
    declare grasps: Map<string, Arm['grasp']>;

    constructor(people, body: string, camera: BABYLON.Camera, right: Arm, cast?: (m: BABYLON.AbstractMesh) => void) {
        this.arms = { R: right, L: ownArm(people, body, 'L', camera, 'open', cast) };
        this.grasps = new Map();
        this.arms.L.reach(null);
    }

    // Hand `side` on `grip`, in the frame `frame` (a world matrix), or taken away (null).
    put(side: 'R' | 'L', grip: Grip | null, frame?: BABYLON.Matrix) {
        const arm = this.arms[side];
        if (!grip) { if (arm.meshes[0].isEnabled()) arm.reach(null); arm.shift.setAll(0); return; }
        if (grip.shoulder) arm.shift.fromArray(grip.shoulder); else arm.shift.setAll(0);
        if (arm.holding !== grip.hold) {
            arm.hold(grip.hold);
            if (WRAPS.has(grip.hold)) {
                const key = side + grip.hold;
                if (!this.grasps.has(key)) this.grasps.set(key, wrapped(arm));
                arm.grasp = this.grasps.get(key);
            }
        }
        const along = V3.TransformNormal(V3.FromArray(grip.along), frame).normalize();
        let back = V3.TransformNormal(V3.FromArray(grip.back), frame);
        back = back.subtract(along.scale(V3.Dot(back, along))).normalize();
        // (turned by the way the person faced last frame: reach() turns them to this one)
        const elbow = arm._shoulder().add(arm._out(new V3(side === 'R' ? ELBOW.out : -ELBOW.out, -ELBOW.down, ELBOW.ahead)));
        arm.reach({ at: V3.TransformCoordinates(V3.FromArray(grip.at), frame), along, back, elbow });
    }
}

// Where a handle lies in a hand closed round it: on the middle of the rings the middle and ring fingers make round it (a
// finger's knuckle, middle and last joints lie on a circle about what it holds), running across the palm from the index
// finger's knuckle toward the little finger's; its back the way the hand runs from the wrist to the knuckles. In the
// person's own frame, the arm as it was made.
function wrapped(arm: Arm) {
    const person = arm.person, here = (name: string, end = 'head') => arm._in(person.joint(`${name}.${arm.side}`, end), V3.Right(), V3.Up()).at;
    const ring = (f: number) => circle(here(`finger${f}-1`), here(`finger${f}-2`), here(`finger${f}-3`));
    const along = here('finger5-1').subtract(here('finger2-1')).normalize();
    const long = here('finger3-1').subtract(here('wrist'));
    const back = long.subtract(along.scale(V3.Dot(long, along))).normalize();
    return { at: ring(3).add(ring(4)).scale(0.5), along, rotation: Q.RotationQuaternionFromAxis(along, back, V3.Cross(along, back)) };
}

// The centre of the circle through three points.
function circle(a: BABYLON.Vector3, b: BABYLON.Vector3, c: BABYLON.Vector3) {
    const ab = b.subtract(a), ac = c.subtract(a), n = V3.Cross(ab, ac);
    return a.add(V3.Cross(n, ab).scale(ac.lengthSquared()).add(V3.Cross(ac, n).scale(ab.lengthSquared())).scale(1 / (2 * n.lengthSquared())));
}
