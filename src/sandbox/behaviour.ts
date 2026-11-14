// What a person does with their body: stands and keeps their balance, steps to
// catch it, falls and puts their hands out, gets up, drags themselves along
// with a broken leg, curls up round a wound, or nothing at all.
//
// It never moves the body itself. It picks a pose for the muscles to pull
// toward (motor.ts) and how hard, and the few pushes a body gives itself
// through what it is on: the physics does the rest, so a blow still throws a
// person about as hard as it would have anyway, and a person too weak to
// stand does not.
//
// How strong someone is comes from their vitals each frame: how awake they
// are (which blood loss and a blow to the head take away) and which limbs
// still answer. Pain and the size of a blow do not take strength away; they
// change what the body does with it: a punch makes a man flinch, stagger,
// double over or guard, not go limp. Out cold or dead, the muscles let go
// and only the joints' stiffness is left.

import * as BABYLON from '@babylonjs/core';
import * as P from '../poses.ts';
import { Muscles, type Strength } from './motor.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;

const G = 9.81;
const TOUCH = 0.035;            // m: a segment this close to the floor is on it
const REACH = 0.72;             // m: the longest step that still catches a fall
const STEPS = 7;                // stumbling steps before the legs give up
const TILT = 0.4;               // rad: a body leaning this far out past its feet has gone
const RAD = Math.PI / 180;

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (x) => { const k = clamp(x); return k * k * (3 - 2 * k); };
const add = (base, changes) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(changes)) out[k] = (out[k] || 0) + (v as number);
    return out;
};

// --- poses for the floor ---------------------------------------------------------------
//
// Written from RELAXED (arms hanging) like poses.ts's, for an upright trunk (_rise adds the trunk's lean to the hips).
// ALL4's `_pitch` and KNEEL are only for _measure, which poses the skeleton to find how high a body is in them.

const ALL4 = { ...add(P.RELAXED, { hipFlexL: 92, hipFlexR: 92, kneeL: 95, kneeR: 95, ankleL: -30, ankleR: -30, shoulderFlexL: 86, shoulderFlexR: 86,
    elbowL: -10, elbowR: -10, curlL: -30, curlR: -30, neckFlex: -35, headFlex: -10 }), _pitch: 90 };
const KNEEL = add(P.RELAXED, { hipFlexL: 4, hipFlexR: 4, kneeL: 92, kneeR: 92, ankleL: -40, ankleR: -40, spineFlex: 6, neckFlex: 6 });
const LUNGE = add(P.RELAXED, { hipFlexR: 82, kneeR: 84, ankleR: 2, hipFlexL: 2, kneeL: 92, ankleL: -40, spineFlex: 18, shoulderFlexR: 22, elbowR: 30 });
// (The hands as a hand lies with nothing working it: loosely curled, more toward the little finger.)
const REST = add(P.RELAXED, { hipFlexL: 10, kneeL: 16, hipFlexR: 5, kneeR: 9, elbowL: 18, elbowR: 22, curlL: 8, curlR: 5, thumbL: 4, thumbR: 2, neckFlex: 8 });

// Curled up round it: knees drawn in, arms in, rocking and turning with how much it hurts.
function curled(t, pain) {
    const a = 0.4 + pain * 0.6, s = Math.sin(t * 1.3), c = Math.sin(t * 0.7 + 1);
    return add(P.RELAXED, {
        hipFlexL: 68 + 18 * s * a, hipFlexR: 74 - 16 * s * a, kneeL: 96 + 12 * c * a, kneeR: 102 - 10 * c * a,
        spineFlex: 28 + 8 * c * a, spineTwist: 12 * Math.sin(t * 0.9) * a, spineSide: 8 * Math.sin(t * 0.6) * a,
        neckFlex: 28 + 10 * s * a, headTilt: 10 * c * a,
        // (The arms in over the front of the trunk, not into it: drawn across it at -14 degrees, the upper arms pressed into
        // the belly with all the shoulder had.)
        shoulderFlexL: 70, shoulderFlexR: 70, shoulderAbductL: 6, shoulderAbductR: 6, elbowL: 95, elbowR: 90, curlL: 55, curlR: 60,
    });
}

// Hands out toward the floor the way the body is going: ahead, behind or to one side (`side` +1 their right).
function braced(way: 'ahead' | 'behind' | 'side', side: number, give: number) {
    // The knees go first: forward onto them, back into a sit, sideways onto the near hip.
    const legs = { hipFlexL: 45 * give, hipFlexR: 40 * give, kneeL: 80 * give, kneeR: 72 * give, ankleL: -15, ankleR: -15 };
    if (way === 'ahead') return add(P.RELAXED, { ...legs, shoulderFlexL: 95, shoulderFlexR: 95, shoulderAbductL: 22, shoulderAbductR: 22, elbowL: 22, elbowR: 22,
        curlL: -45, curlR: -45, thumbL: -30, thumbR: -30, thumbBaseL: 30, thumbBaseR: 30, thumbInL: -25, thumbInR: -25, neckFlex: -25, spineFlex: -4 });
    if (way === 'behind') return add(P.RELAXED, { ...legs, hipFlexL: 80 * give, hipFlexR: 74 * give, kneeL: 100 * give, kneeR: 92 * give,
        shoulderFlexL: -40, shoulderFlexR: -40, shoulderAbductL: 38, shoulderAbductR: 38, elbowL: 14, elbowR: 14, curlL: -45, curlR: -45, thumbL: -30, thumbR: -30, thumbBaseL: 30, thumbBaseR: 30, thumbInL: -25, thumbInR: -25, neckFlex: 40, spineFlex: 28 });
    const near = side > 0 ? 'R' : 'L', far = side > 0 ? 'L' : 'R';
    return add(P.RELAXED, { ...legs, ['shoulderAbduct' + near]: 78, ['shoulderFlex' + near]: 22, ['elbow' + near]: 12, ['curl' + near]: -45, ['thumb' + near]: -30, ['thumbBase' + near]: 30, ['thumbIn' + near]: -25,
        ['shoulderFlex' + far]: 55, ['shoulderAbduct' + far]: -20, ['elbow' + far]: 60, spineSide: -12 * side, neckFlex: 15 });
}

// The army crawl, lying on the front: the elbows out to the sides on the floor, one forearm put out ahead while the other
// elbow, planted beside the chest, drags the body up to it; the head up. (With the arms in at the sides, as a body standing
// holds them, lying prone they went in under the chest and the hands were trapped under it.)
function crawling(phase) {
    const reachL = (1 + Math.sin(phase)) / 2, reachR = 1 - reachL;
    // (Out to the side first and forward last, as person.ts turns a shoulder: an arm out at 70 degrees is only spun about
    // its own length by the forward turn, so the elbow is brought forward by the forward turn with the arm half out.)
    const arm = (k, r) => ({ ['shoulderFlex' + k]: 110 + 55 * r, ['shoulderAbduct' + k]: 42 - 12 * r, ['elbow' + k]: 100 - 75 * r, ['curl' + k]: 20 + 25 * (1 - r) });
    // The legs trail, a knee drawn up a little on the side that reaches.
    return add(P.RELAXED, { ...arm('L', reachL), ...arm('R', reachR), spineFlex: -12, neckFlex: -42, headFlex: -12, spineSide: 6 * Math.sin(phase),
        hipFlexL: 4 + 10 * reachL, hipAbductL: 6 * reachL, kneeL: 8 + 14 * reachL, hipFlexR: 4 + 10 * reachR, hipAbductR: 6 * reachR, kneeR: 8 + 14 * reachR,
        ankleL: -30, ankleR: -30 });
}

const _v = new V3(), _t = new V3(), _q = new Q(), _qa = new Q(), _qb = new Q(), _w = new V3(), _spin = new V3();
// How an arm reaching for the body is drawn to hold itself, where more than one way reaches (_armTo): each control's
// preferred value and how much it counts (metres of miss a degree away is worth). The elbow forward of the trunk, so the
// forearm comes to the body from in front and not through its side; the upper arm as little twisted as will do.
const PREFER = [[0, 0], [10, 0.0006], [0, 0.0006], [0, 0]];
const ARM = ['shoulderAbduct', 'shoulderFlex', 'shoulderTwist', 'elbow'], LEG = ['hipFlex', 'hipAbduct', 'knee', 'ankle'];

export class Behaviour {
    declare npc: any;
    declare rd: any;
    declare muscles: Muscles;
    declare state: 'stand' | 'fall' | 'down';
    declare mode: string;
    declare next: string;
    declare t: number;
    declare clock: number;
    declare heading: number;
    declare will: number;
    declare react: any;
    declare fence: number;
    declare retch: number;          // 0 to 1: how far a retch is folding them over now (throat.ts)
    declare fenceArms: string;
    declare wasOut: boolean;
    declare settle: number;
    declare flinch: Record<string, number>;
    declare wound: { seg: any; local: BABYLON.Vector3; out: BABYLON.Vector3; t: number; size: number; hands?: string[]; front?: boolean } | null;
    declare hurt: Record<string, boolean>;
    declare holding: Record<string, boolean>;       // the hands on a wound this frame (_hold)
    declare _grips: Record<string, { to: BABYLON.Vector3; best: number; since: number; hold: BABYLON.Vector3 | null; t: number }>;     // (to and hold in the chest's frame)
    declare favour: { side: string; how: number } | null;
    declare hunch: number;
    declare _arms: Record<string, any>;
    declare com: BABYLON.Vector3;
    declare vel: BABYLON.Vector3;
    declare step: any;
    declare steps: number;
    declare heights: Record<string, { pelvis: number; chest: number; hip?: number }>;
    declare leg: Record<string, any>;
    declare foot: { ankle: number; ahead: number; middle: number };
    declare lookSign: number;
    declare lying: number;
    declare wait: number;
    declare tries: number;
    declare phase: number;
    declare landed: boolean;
    declare air: number;
    declare lastStep: string;
    declare touching: any[];
    declare strength: Strength;
    declare pushes: ((dt: number) => void)[];
    declare _why: string;           // why they last went over, for the rig
    declare floor: number;          // the height of what is under them (the hall's floor, a ledge): what feet, knees and hands push on

    constructor(npc) {
        this.npc = npc;
        const rd = this.rd = npc.ragdoll;
        this.muscles = new Muscles(rd);
        this.state = 'stand';
        this.mode = '';
        this.t = 0;
        this.clock = npc.clock ?? 0;
        this.heading = npc.person.root.rotation.y;
        this.will = 1;
        this.react = null;
        this.fence = 0;
        this.retch = 0;
        this.fenceArms = '';
        this.wasOut = false;
        this.settle = 0;
        this.flinch = {};
        this.wound = null;
        this.hurt = { L: false, R: false };
        this.holding = {};
        this._grips = {};
        this.favour = null;
        this.hunch = 0;
        this.com = rd.com(new V3());
        this.floor = npc.world.ground?.(this.com.x, this.com.z, this.com.y) ?? 0;
        this.vel = new V3();
        this.step = null;
        this.steps = 0;
        this.lying = 0;
        this.wait = 0;
        this.tries = 0;
        this.phase = 0;
        this.landed = true;
        this.air = 0;
        this.touching = [];
        this.strength = { trunk: 1, neck: 1, armL: 1, armR: 1, legL: 1, legR: 1 };
        this.pushes = [];
        this._guarded = new Set();
        this._eased = {};
        this._dt = 1 / 60;
        this._cradle = '';
        this._measure();
    }

    // How high the pelvis and chest are standing, kneeling and on all fours, read off this person's own skeleton; and
    // the legs' lengths and rest angles, for stepping.
    _measure() {
        const { person } = this.npc, rd = this.rd;
        const body = person.body, was = [body.position.clone(), body.rotationQuaternion.clone()];
        const at = (pose, ground) => {
            person.apply(pose, { ground });
            return { pelvis: person.joint('root').y, chest: person.joint('spine01').y };
        };
        // (Over whatever they were made standing on.)
        const f = this.floor;
        const all4 = at(ALL4, 'all4'), kneel = at(KNEEL, 'knees');
        this.heights = { stand: { pelvis: rd.centre.y - f, chest: rd.byName.get('chest').node.position.y - f, hip: rd.byName.get('thighL').node.position.y - f },
            all4: { pelvis: all4.pelvis - f, chest: all4.chest - f }, kneel: { pelvis: kneel.pelvis - f, chest: kneel.chest - f } };
        body.position.copyFrom(was[0]);
        body.rotationQuaternion.copyFrom(was[1]);
        for (const b of rd.between) b.setRotationQuaternion(Q.Identity(), BABYLON.Space.LOCAL);
        rd.drive();
        this.leg = {};
        for (const side of ['L', 'R']) {
            const hip = person.byName[`upperleg01.${side}`].head, knee = person.byName[`lowerleg01.${side}`].head, ankle = person.byName[`foot.${side}`].head;
            const leg: any = { a: V3.Distance(hip, knee), b: V3.Distance(knee, ankle), out: side === 'L' ? -1 : 1 };
            [leg.flex, leg.abduct, leg.knee, leg.shin] = legAngles(ankle.subtract(hip), leg);
            this.leg[side] = leg;
        }
        const foot = rd.byName.get('footL');
        const middle = rd.worldPoint(foot, foot.centre, new V3());
        const low = rd.lowest(foot);
        this.foot = { ankle: foot.node.position.y - low, middle: middle.y - low, ahead: V3.Dot(middle.subtract(foot.node.position), this._facing()) };
        // Which way a positive neckTwist turns the face: toward their right (+1) or left.
        const twisted = new V3(0, 0, 1).applyRotationQuaternion(Q.RotationAxis(person.hinges.neckTwist.axis, 0.3));
        this.lookSign = Math.sign(twisted.x) || 1;
    }

    _facing(h = this.heading) { return new V3(Math.sin(h), 0, Math.cos(h)); }

    // --- from outside ---------------------------------------------------------------------

    // A blow or a shot: the push itself, the flinch the muscles make of it, and for a few seconds what a body does about
    // a blow there: winded by one to the belly or chest (doubled over), guarding the face after one to the head, a leg
    // that gives for a moment after one to it. Where it landed is the wound they tend for as long as it hurts (_tend).
    // Whether they stay up is the balance's business; nothing here takes their strength.
    hit(seg, impulse: BABYLON.Vector3, point: BABYLON.Vector3, jolt: number) {
        const rd = this.rd;
        rd.push(seg.name, impulse, point);
        // A piece cut off is not felt: the push is all there is to it.
        if (rd.cutOff(seg)) return;
        const into = seg.node.computeWorldMatrix(true).clone().invert();
        // (Pellets or fragments landing together on one part are one wound, as big as all of them.)
        const was = this.wound, size = impulse.length() + (was && was.seg === seg && was.t < 0.3 ? was.size : 0);
        this.wound = { seg, local: V3.TransformCoordinates(point, into), out: V3.TransformNormal(impulse.normalizeToNew().negateInPlace(), into), t: 0, size };
        const k = Math.min(1, impulse.length() / 16) * (0.4 + jolt);
        const hard = Math.min(1, impulse.length() / 12), base = seg.name.replace(/2?[LR]$/, '');
        // An arm shot, cut or struck hard is not used to hold anything with.
        if (hard > 0.15 && /^(upperarm|forearm|hand)$/.test(base)) this.hurt[seg.name.slice(-1)] = true;
        if (this.state !== 'stand') return;
        if (hard > 0.15) {
            const kind = base === 'belly' || base === 'chest' ? 'winded' : base === 'head' ? 'guard' : /^(thigh|shin|foot)$/.test(base) ? 'leg' : '';
            const length = { winded: 1.5 + 2.5 * hard, guard: 0.8 + 1.5 * hard, leg: 0.5 + 0.6 * hard }[kind];
            if (kind) this.react = { kind, t: 0, length, hard, side: seg.name.slice(-1) };
        }
        const local = V3.TransformNormal(impulse, this.npc.person.root.getWorldMatrix().clone().invert());
        this.flinch.spineFlex = (this.flinch.spineFlex ?? 0) + Math.sign(local.z || 1) * 22 * k;
        this.flinch.spineSide = (this.flinch.spineSide ?? 0) + -Math.sign(local.x || 1) * 14 * k;
        this.flinch.spineTwist = (this.flinch.spineTwist ?? 0) + (Math.random() - 0.5) * 20 * k;
        if (seg.name === 'head') this.flinch.headFlex = (this.flinch.headFlex ?? 0) - 25 * k;
    }

    // Off their feet whatever their balance says.
    knockDown() {
        if (this.state === 'stand') this._go('fall');
    }

    _go(state, mode = '') {
        if (state === 'fall' && this.state !== 'fall') this.landed = false;
        if (state === 'down' && this.state !== 'down') { this.lying = 0; this.wait = 1.5 + Math.random() * 1.5; }
        this.state = state;
        this.mode = mode;
        this.t = 0;
        this.step = null;
        this.steps = 0;
        this.react = null;
    }

    // --- every frame, and every step -------------------------------------------------------

    // The pushes a body gives itself are decided once a frame and given every physics step (sandbox.ts cuts a frame into
    // steps of at most 1/120 s), each worked out again from where the body is by then: given once a frame, a slow
    // frame left the balance unminded for a tenth of a second.
    act(push: (dt: number) => void) { this.pushes.push(push); }

    beforeStep(dt: number) {
        for (const push of this.pushes) push(dt);
        this.rd.shoulders(dt);
    }

    update(dt: number) {
        const npc = this.npc, v = npc.vitals, rd = this.rd;
        this.pushes.length = 0;
        this._dt = dt;
        this.clock += dt;
        this.t += dt;
        for (const k of Object.keys(this.flinch)) this.flinch[k] *= Math.exp(-5 * dt);
        this._strengthen(dt);
        rd.setTone(v.dead || !v.beating ? 'dead' : this.will < 0.05 ? 'out' : 'alive');

        rd.com(this.com);
        rd.comVelocity(this.vel);
        // What is under them: the highest thing under their weight no higher than their feet.
        const low = Math.min(rd.lowest(rd.byName.get('footL')), rd.lowest(rd.byName.get('footR')));
        this.floor = this.npc.world.ground?.(this.com.x, this.com.z, low + 0.1) ?? 0;
        this.touching = this.state === 'stand' ? [] : rd.attached.filter((s) => rd.lowest(s) < this.floor + TOUCH);

        // Knocked out: two people in three hold one arm or both stiffly up for a moment as they go down (the fencing
        // response, dev/research/blunt-trauma.md), a reflex and not the will, so it is held whatever else has let go.
        const out = (v.out ?? 0) > 0;
        if (out && !this.wasOut && Math.random() < 0.67) {
            this.fence = 1.2 + Math.random() * 1.3;
            this.fenceArms = ['L', 'R', 'LR'][Math.floor(Math.random() * 3)];
        }
        this.wasOut = out;

        let pose;
        if (this.state === 'stand') pose = this._stand(dt);
        if (this.state === 'fall') pose = this._fall(dt);
        if (this.state === 'down') pose = this._down(dt);
        // A retch (throat.ts) folds the trunk over the belly's squeeze and drops the head, on whatever else they are doing.
        if (this.retch > 0.02) pose = add(pose, { spineFlex: 24 * this.retch, neckFlex: 18 * this.retch, headFlex: 8 * this.retch });
        if (this.fence > 0) {
            this.fence -= dt;
            pose = { ...pose };
            for (const k of this.fenceArms) {
                Object.assign(pose, { ['shoulderFlex' + k]: 95, ['shoulderAbduct' + k]: -10, ['elbow' + k]: k === 'L' ? 15 : 70, ['curl' + k]: 40 });
                if (!v.paralysed.arms) this.strength['arm' + k] = 0.6;
            }
        }
        this.muscles.follow(pose, this.strength, this._guard(dt), dt);
        rd.limp = this.state !== 'stand';
        npc.down = rd.limp;
    }

    // How strong each part of the body is now: as awake as they are (none below 0.2, all of it from 0.6, so a man dazed
    // by a blow still stands on his own legs), all at once when knocked out and slowly as someone fades; and nothing in
    // a limb the cord no longer reaches.
    _strengthen(dt) {
        const npc = this.npc, v = npc.vitals;
        const want = v.dead || !v.beating ? 0 : clamp((v.conscious - 0.2) / 0.4);
        const rate = want < this.will ? (v.conscious < 0.3 ? 8 : 1.2) : 1.5;
        this.will += (want - this.will) * Math.min(1, rate * dt);
        const w = this.will, s = this.strength;
        s.trunk = s.neck = w;
        s.armL = s.armR = v.paralysed.arms ? 0 : w;
        s.legL = s.legR = v.paralysed.legs ? 0 : w;
    }

    // The limbs with a broken bone in them, which are kept still (motor.ts `follow`): a broken arm is not put up to
    // guard, braced with or swung, a broken leg not drawn up or kicked; only an arm the hurt arm's cradle is holding in
    // (_tend) is moved, gently. Every movement at a break grates the ends on each other, and hurts.
    _guard(dt) {
        const rd = this.rd, v = this.npc.vitals, out = this._guarded;
        out.clear();
        for (const side of ['L', 'R']) {
            if (this._broken('arm', side) && this._cradle !== side) out.add('arm' + side);
            if (this._broken('leg', side)) out.add('leg' + side);
        }
        for (const seg of rd.attached) {
            if (!seg.broken || !seg.joint?.lock) continue;
            seg.body.getAngularVelocityToRef(_v);
            seg.parent.body.getAngularVelocityToRef(_t);
            v.pain = Math.min(1, v.pain + 0.04 * _v.subtractInPlace(_t).length() * dt * this.will);
        }
        return out;
    }
    declare _guarded: Set<string>;
    declare _cradle: string;

    // Whether limb `kind` ('arm' or 'leg') on `side` has a bone broken in it: a shaft or joint let go at a mid joint or a
    // joint (ragdoll `loose` at its far end), or a bone of the foot, hand or wrist.
    _broken(kind: 'arm' | 'leg', side: string) {
        const rd = this.rd;
        if (rd.loose(rd.byName.get((kind === 'arm' ? 'hand' : 'foot') + side))) return true;
        const keys = kind === 'arm' ? /^(humerus|radius|ulna|scaphoid|carpal|metacarpal)$/ : /^(femur|tibia|fibula|calcaneus|tarsal|metatarsal|kneecap)$/;
        return !!this.npc.bones?.breaks.some((b) => b.side === side && keys.test(b.key));
    }

    _canStand() {
        const npc = this.npc, rd = this.rd;
        return !npc.legGone && !npc.vitals.paralysed.legs && !rd.loose(rd.byName.get('footL')) && !rd.loose(rd.byName.get('footR'));
    }

    // --- on their feet ----------------------------------------------------------------------

    _stand(dt) {
        const npc = this.npc, v = npc.vitals, rd = this.rd;
        const pelvis = rd.byName.get('pelvis'), chest = rd.byName.get('chest');
        const feet = ['L', 'R'].map((side) => rd.byName.get('foot' + side));
        // A foot stepping is not stood on, even before it leaves the floor: the weight goes over the other one first.
        const down = feet.filter((f) => rd.lowest(f) < this.floor + TOUCH && f !== this.step?.swing);
        const ground = footprint(rd, down.length ? down : feet);
        const centre = ground.centre;
        // Gone over: the body's weight leaning out past the edge of the feet further than saving (measured over both feet
        // wherever they are: a step lands one at a time; a hard blow swings the pelvis or the chest further than this on
        // its own, and they come back), sunk, or off the floor.
        const lean = Math.atan2(Math.max(0, outside(footprint(rd, feet).hull, this.com.x, this.com.z)), this.com.y - this.floor);
        this.air = feet.some((f) => rd.lowest(f) < this.floor + TOUCH) ? 0 : this.air + dt;
        const why = npc.grabbed ? 'grabbed' : !this._canStand() ? 'legs' : this.will < 0.3 ? 'will' : lean > TILT ? 'lean'
            : this.com.y - this.floor < this.heights.stand.pelvis * 0.6 ? 'sunk' : this.air > 0.25 ? 'air' : '';
        if (why) {
            this._why = why;
            this._go('fall');
            return this._fall(dt);
        }
        // A twist the body has been given is let stand, slowly: they do not swing back to face where they faced.
        const q = pelvis.node.rotationQuaternion;
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
        let turn = yaw - this.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.heading += turn * Math.min(1, dt * 0.6);

        const pose = P.stand(this.clock, { breathe: 1 + v.lost * 3 });
        for (const [k, a] of Object.entries(this.flinch)) pose[k] = (pose[k] || 0) + a;
        // Somebody hurt holds themselves bent over it; somebody dazed sways, head down.
        const daze = v.daze ?? 0;
        pose.spineFlex = (pose.spineFlex || 0) + v.pain * 14;
        pose.spineSide = (pose.spineSide || 0) + daze * 6 * Math.sin(this.clock * 0.8);
        pose.neckFlex = (pose.neckFlex || 0) + daze * 14;
        pose.headTilt = (pose.headTilt || 0) + daze * 8 * Math.sin(this.clock * 0.6 + 1);
        this._look(pose, v.conscious * 0.8);
        // Arms just clear of the belly and the hands of the thighs: hanging straight they are pulled into them and rattle.
        // (At 7 degrees the upper arms, which meet the belly now, lay on it and shook the hands.)
        pose.shoulderAbductL += 10;
        pose.shoulderAbductR += 10;

        // Balance. Where the body's weight would come to rest if it stopped on its own (the capture point) against the
        // ground under the feet: inside, the feet keep the body upright; outside, a step.
        const f = this._facing(), r = new V3(f.z, 0, -f.x);
        const omega = Math.sqrt(G / Math.max(0.5, this.com.y));
        const xi = this.com.add(this.vel.scale(1 / omega));
        xi.y = this.floor;

        // The planted legs hold the hips at standing height over wherever the feet are: after a step one leg reaches
        // forward and the other back, and pulled back straight under the body they dragged the new foot back with them.
        // As high as standing, or as high as every planted leg can reach from where its foot is: feet apart, the hips are
        // lower. (Every leg held to full height in a stride pushed against the other through the floor, shoved the body
        // on and buckled a knee.)
        let hipY = this.floor + this.heights.stand.hip;
        for (const foot of down) {
            const side = foot.name.slice(-1), leg = this.leg[side], hip = rd.byName.get('thigh' + side).node.position, ankle = foot.node.position;
            const reach = 0.97 * (leg.a + leg.b), across = Math.hypot(ankle.x - hip.x, ankle.z - hip.z);
            hipY = Math.min(hipY, ankle.y + Math.sqrt(Math.max(0, reach * reach - across * across)));
        }
        // Not into a crouch, though: a long stride is stood in with the legs reaching, the hips a little lower.
        hipY = Math.max(hipY, this.floor + this.heights.stand.hip - 0.1);
        // On one foot mid-step, the leg holds the hips up under the pelvis as it is, and leaves its lean alone: levelling
        // it through the one planted leg pushed the body on over that foot, toward the way it was already falling.
        this._tend(pose, dt);
        // A broken bone in a foot that still lets them stand (a toe's long bone, the fibula alone): the weight kept off it.
        for (const side of ['L', 'R']) if (this._broken('leg', side)) {
            this.favour = { side: side === 'L' ? 'R' : 'L', how: 1 };
            this.strength['leg' + side] *= 0.5;
        }
        // Dazed, the weight wanders and is caught late; just up off the floor, they stand braced a moment first. Hurt in
        // a leg, it is carried over the other foot.
        this.settle = Math.max(0, this.settle - dt);
        const wander = this.settle > 0 ? 0 : daze * 0.04;
        const aim = centre.add(new V3(Math.sin(this.clock * 0.9 + 1.3), 0, Math.sin(this.clock * 0.7)).scaleInPlace(wander));
        const good = this.favour && down.find((foot) => foot.name.endsWith(this.favour.side));
        if (good && down.length === 2) {
            const over = rd.worldPoint(good, good.centre, _v).subtractInPlace(centre).scaleInPlace(0.5 * this.favour.how);
            aim.x += over.x;
            aim.z += over.z;
        }
        // The hips go where the weight needs them: back under a body doubled over, forward under one leaning back, so
        // that the weight stays over the feet as the back bends (the ankles alone hold only what the soles can press).
        const shift = aim.subtract(this.com);
        shift.y = 0;
        if (shift.length() > 0.1) shift.scaleInPlace(0.1 / shift.length());
        // (Eased over 60 ms: worked out each frame from where the hips and feet had just been jolted to, a planted leg's
        // aim jumped from frame to frame, and the foot it could not turn passed every jump up the shin, 1 to 6 rad/s of
        // buzz in a foot and shin standing still.)
        for (const foot of down) {
            this._legTo(foot.name.slice(-1), foot.node.position, pose, f, hipY, !this.step, shift);
            this._ease('leg' + foot.name.slice(-1), LEG, foot.name.slice(-1), pose, 0.06);
        }
        this._react(pose, dt);

        // The ankle strategy: the body swayed back over the middle of the feet as a whole, as hard as the feet can push
        // for it. Feet only press the floor, so carrying the weight one way needs the floor pressed on the other side of
        // it, which is worth the body's weight times how far that edge of the feet lies: nothing once the weight is over
        // a toe or a heel, and then a step has to do it. The sway is spread over the whole body the way the floor's push
        // through the feet moves it, each part by its weight and its height (as one turn of the pelvis, the joints had to
        // pass it on and rang with it).
        const legs = Math.min(this.strength.legL, this.strength.legR);
        const facing = Q.RotationAxis(BABYLON.Axis.Y, this.heading);
        const bent = facing.multiply(Q.RotationAxis(BABYLON.Axis.X, (pose.spineFlex || 0) * RAD));
        const kp = 30 * (1 - 0.3 * daze), kd = 9 * (1 - 0.3 * daze) * (this.settle > 0 ? 2 : 1);
        if (down.length) this.act((dt) => {
            rd.com(this.com);
            rd.comVelocity(this.vel);
            const height = Math.max(0.5, this.com.y - this.floor);
            const sway = aim.subtract(this.com).scaleInPlace(kp).subtractInPlace(this.vel.scale(kd));
            sway.y = 0;
            const lever = sway.length() > 1e-6 ? inside(ground.hull, this.com.x, this.com.z, -sway.x, -sway.z) : 0;
            const most = G * lever * legs / height;
            if (sway.length() > most) sway.scaleInPlace(most / sway.length());
            // And the catch a stumble makes: steps never land exactly where they should, and a body that has to step
            // again for every one that fell short never stops. Whatever foot is down slows the body's going, up to a
            // quarter of its weight, as long as it is going no faster than legs can catch (a hard shove still puts them
            // down). (Only while stepping, a light shove that should have been stood was stepped after, step after step.)
            const speed = Math.hypot(this.vel.x, this.vel.z);
            if (speed > 0.01 && speed < 1.4) sway.addInPlace(new V3(this.vel.x, 0, this.vel.z).scaleInPlace(-Math.min(2.6 * legs, 5 * speed) / speed));
            this.muscles.lean(sway, height, down, dt);
            // The trunk's spin as a whole (pelvis, belly and chest by their weight), which the turns below are damped
            // against (motor.ts `toward`).
            this._spinOfTrunk();
            // And turned to face where they mean to, as hard as the soles' grip allows. (For a standing body's 1.5 kg m2
            // about its length: at 40 kg m2 its damping alone was more than a step can give and turned it back and forth.)
            _t.set(0, clamp(this.muscles.toward(pelvis, facing, 40, 1.5, Infinity, _v, _spin).y, -40 * legs, 40 * legs), 0);
            pelvis.body.applyAngularImpulse(_t.scale(dt));
            // The trunk kept upright over the legs, the hip strategy, as far as the muscles round the hips (about 300 N m
            // both together) and the back hold it, pushing on the floor through the legs: without it a stride pitched the
            // pelvis forty degrees over the front leg and took the body down, and at a third of that a shove still tipped
            // the trunk back a little more with every step until it lay back at fifty degrees. The chest is held as far
            // over as the pose bends the back, so a body doubled over is not straightened.
            this.muscles.toward(pelvis, facing, 25, 12, 300 * legs, _t, _spin);
            pelvis.body.applyAngularImpulse(_t.set(_t.x, 0, _t.z).scaleInPlace(dt));
            this.muscles.toward(chest, bent, 25, 12, 150 * legs, _t, _spin);
            chest.body.applyAngularImpulse(_t.set(_t.x, 0, _t.z).scaleInPlace(dt));
        });

        // A step only once the weight is clearly going past the feet: a sway that tips just over the edge is swayed back.
        // A foot that has come off the floor without being stepped (the trailing one, left behind as the weight goes over
        // the other) is stepped at once: left hanging, it was nothing to stand on.
        const lifted = down.length === 1 ? feet.find((foot) => !down.includes(foot)) : null;
        if (!this.step && (lifted || (down.length === 2 && outside(ground.hull, xi.x, xi.z) > (this.settle > 0 ? 0.1 : 0.08)))) {
            if (this.steps >= STEPS || V3.Distance(xi, centre) > REACH * 1.4) { this._why = this.steps >= STEPS ? 'steps' : 'far'; this._go('fall'); return this._fall(dt); }
            this._startStep(xi, f, r, feet, lifted?.name.slice(-1));
            // Caught already over the planted foot, the lifted one only closes up beside it, and they stand.
            if (lifted && outside(ground.hull, xi.x, xi.z) < 0.04) {
                const at = down[0].node.position, out = lifted.name.endsWith('R') ? 1 : -1;
                this.step.to = new V3(at.x, this.floor, at.z).addInPlace(r.scale(0.2 * out));
                this.step.closing = true;
                this.steps--;
            }
        }
        if (this.step) this._stepping(dt, pose, f, xi, r);
        else if (outside(ground.hull, xi.x, xi.z) < -0.02) this.steps = 0;
        return pose;
    }

    // A step to where the weight is going: the trailing foot forward or back, or the foot on the side it is falling to.
    _startStep(xi: BABYLON.Vector3, f, r, feet, only?: string) {
        const mid = feet[0].node.position.add(feet[1].node.position).scale(0.5);
        const to = xi.subtract(mid);
        to.y = 0;
        const along = V3.Dot(to, f), across = V3.Dot(to, r);
        // The first step is the trailing foot's, or the foot on the side the weight is going to; then the feet take turns
        // (stepping sideways, the inside foot follows the outside one).
        let side = only;
        if (!side && this.steps && this.lastStep) side = this.lastStep === 'L' ? 'R' : 'L';
        else if (!side && Math.abs(across) > Math.abs(along) * 0.7) side = across > 0 ? 'R' : 'L';
        else if (!side) side = V3.Dot(feet[0].node.position, to) < V3.Dot(feet[1].node.position, to) ? 'L' : 'R';
        this.lastStep = side;
        const swing = this.rd.byName.get('foot' + side);
        const here = this.rd.worldPoint(swing, swing.centre, new V3());
        const landing = this._landing(xi, side, r);
        // A quick step, a little longer the further it goes: a reactive step is a quarter to a third of a second.
        this.step = { side, swing, from: new V3(here.x, this.floor, here.z), to: landing, t: 0, length: clamp(0.18 + 0.15 * V3.Distance(here, landing), 0.2, 0.3) };
        this.steps++;
    }

    // Where a step should land to catch the weight going to `xi`: past it, on its own side of the planted foot (a step
    // to the right is the right foot's, and lands right of the left), and no further than a leg reaches. Past it by
    // more the faster the body is going: a foot put down just at the capture point leaves the floor nothing to brake
    // with (the weight arrives over the edge of the sole), and the next step is needed at once.
    _landing(xi: BABYLON.Vector3, side, r) {
        const stance = this.rd.byName.get('foot' + (side === 'L' ? 'R' : 'L')).node.position;
        const planted = new V3(stance.x, this.floor, stance.z);
        const to = xi.subtract(planted);
        to.y = 0;
        let target = xi.add(to.normalizeToNew().scale(0.1 + 0.08 * Math.hypot(this.vel.x, this.vel.z)));
        target.y = this.floor;
        const out = side === 'R' ? 1 : -1;
        const sideways = V3.Dot(target.subtract(planted), r) * out;
        if (sideways < 0.14) target.addInPlace(r.scale((0.14 - sideways) * out));
        const reach = target.subtract(planted);
        if (reach.length() > REACH) target = planted.add(reach.scale(REACH / reach.length()));
        return target;
    }

    // The swing foot on its way. It is aimed at the capture point as it is now, not where it was at push-off: with only
    // one foot down it runs away from it the whole time the step takes (by e to the power of the step's length times
    // the body's natural rate, nearly three times as far), and a step aimed at where it was falls short.
    _stepping(dt, pose, f, xi, r) {
        const st = this.step, rd = this.rd;
        st.t += dt;
        const s = clamp(st.t / st.length), lift = 0.06 * Math.sin(Math.PI * s);
        if (s < 0.95 && !st.closing) st.to = this._landing(xi, st.side, r);
        const at = V3.Lerp(st.from, st.to, smooth(s));
        const middle = new V3(at.x, this.floor + this.foot.middle + lift, at.z);
        const ankle = middle.subtract(f.scale(this.foot.ahead));
        ankle.y = this.floor + this.foot.ankle + lift;
        this._legTo(st.side, ankle, pose, f);
        pose['ankle' + st.side] += 8 * Math.sin(Math.PI * s);
        // The foot carried to its place by the leg's own muscles, the hip taking the pull.
        const most = 220 * this.strength['leg' + st.side];
        this.act((dt) => this.muscles.push(st.swing, this.muscles.reach(st.swing, middle, 300, 6, most, _t), [rd.byName.get('pelvis')], dt));
        // Down when it touches: a foot kept hovering for its mark let the weight run on past the other one.
        if ((s >= 1 && rd.lowest(st.swing) < this.floor + TOUCH) || st.t > st.length + 0.15) this.step = null;
    }

    // What a standing body is doing about the last blow (hit()), laid over its pose: quick in, easing off.
    _react(pose, dt) {
        const r = this.react;
        if (!r) return;
        r.t += dt;
        if (r.t > r.length) { this.react = null; return; }
        // Keeping their feet comes first: mid-step the body does not double over or let a leg go.
        // Guarding is quick; doubling over takes a moment (snapped over at once, the trunk threw the weight out past the
        // toes and the person stepped after it again and again).
        const onset = r.kind === 'winded' ? 0.4 : 0.15;
        const e = smooth(r.t / onset) * (1 - smooth((r.t - r.length * 0.4) / (r.length * 0.6))) * (0.5 + 0.5 * r.hard) * (this.step ? 0.2 : 1);
        const more = (changes) => { for (const [k, a] of Object.entries(changes)) pose[k] = (pose[k] || 0) + (a as number) * e; };
        if (r.kind === 'winded') {
            // Winded: folded over the blow, knees giving a little, both arms in over it.
            // (The fold is the back's: bent at the hips as well, over legs holding the weight over the feet, the whole
            // body tipped forward.)
            // (As far over as tending a wound there has not bent them already.)
            more({ spineFlex: Math.max(0, 34 - this.hunch), neckFlex: 12, kneeL: 12, kneeR: 12 });
        } else if (r.kind === 'guard') {
            // Hands up in front of the face, closed, the thumbs in over the fingers, chin down. (Not a hand already gone to the
            // wound, _tend: laid over its reach, the guard drove it on into the face and it shook there.)
            more({ neckFlex: 14, spineFlex: 8 });
            for (const k of ['L', 'R']) if (!this.holding[k]) more({ ['shoulderFlex' + k]: 75, ['shoulderAbduct' + k]: 8, ['elbow' + k]: 115, ['curl' + k]: k === 'L' ? 56 : 60,
                ['thumb' + k]: k === 'L' ? 24 : 25, ['thumbBase' + k]: 52, ['thumbIn' + k]: -55 });
        } else if (r.kind === 'leg') {
            // A dead leg: it gives at the knee for a moment, and the balance has to cope.
            this.strength['leg' + r.side] *= 1 - 0.7 * e;
            more({ ['knee' + r.side]: 22, ['hipFlex' + r.side]: 8 });
        }
    }

    // Where it hurts, tended for as long as it hurts (the last wound, hit()): shot or cut in an arm, the other hand holds
    // it and the arm is kept in against the body; in a leg, the weight goes onto the other one and the knee eases, a hand
    // on a thigh; in the trunk, the neck or the head, the hand that gets there best, both for a big wound, and they bend
    // over it. Never with a hand whose arm is hurt, broken or cut off. All of it is muscle: the hands are pulled to the
    // place by the arms (_hold) and the rest is the pose's, so a blow still moves them as it would. Nobody too far gone
    // to mind does any of it. `lying`: on the floor, the hands only.
    _tend(pose, dt, lying = false) {
        const w = this.wound, v = this.npc.vitals;
        this.favour = null;
        this.hunch = 0;
        this.holding = {};
        this._cradle = '';
        if (!w) return;
        // A wound on a piece since cut off is tended where the piece was cut from: the stump, held at its end (the hand
        // went after the arm lying on the floor).
        while (this.rd.cutOff(w.seg)) {
            let root = w.seg;
            while (!root.severed) root = root.parent;
            w.seg = root.parent;
            w.local = root.head.subtract(root.parent.head);
            w.out = w.local.normalizeToNew();
            w.hands = undefined;
            w.front = undefined;
        }
        w.t += dt;
        // Quick to it (a third of a second), as much as it hurts, and not at all once the mind is going.
        // (A blow to the head that dazes hurts little, but the hands still go to the face.)
        const hurt = Math.max(v.pain, w.seg.name === 'head' ? (v.daze ?? 0) : 0);
        const e = smooth(w.t / 0.35) * clamp((hurt - 0.05) / 0.2) * clamp((this.will - 0.3) / 0.3);
        if (e < 0.02) return;
        const seg = w.seg, m = seg.node.computeWorldMatrix(true);
        const at = V3.TransformCoordinates(w.local, m), out = V3.TransformNormal(w.out, m).normalize();
        // Laid on it: just off the skin over it, where the shape inside the flesh stops the hand.
        const on = at.addInPlace(out.scale(0.02));
        const name = seg.name, limb = /[LR]$/.test(name);
        // The side a limb is on is its name's (L the person's own left, at -x in their frame, as the hands' and the pose's
        // L); a wound in the trunk is on the side its place is: +x is the body's right.
        const side = limb ? name.slice(-1) : w.local.x > 0 ? 'R' : 'L', other = side === 'L' ? 'R' : 'L';
        const more = (changes) => { if (!lying) for (const [k, a] of Object.entries(changes)) pose[k] = (pose[k] || 0) + (a as number) * e; };
        if (/^(upperarm|forearm|hand)/.test(name)) {
            // The hurt arm hugged to the body, the forearm across the front of the belly toward the other side, and held
            // there gently: its reach worked out round the body (_armTo), so that it lies on the belly and is not pulled
            // into it (posed by hand, the forearm went into the belly and the arm shook against it). There the other hand
            // holds it.
            const hand = this.rd.byName.get('hand' + side);
            if (!lying && !this.rd.cutOff(hand)) {
                const belly = this.rd.byName.get('belly'), g = belly.geo;
                // (Low on the belly and not far across: the other arm reaches over it to the wound.)
                const cradle = this.rd.worldPoint(belly, new V3(g.c.x + (side === 'L' ? 0.04 : -0.04), g.c.y - g.h.y * 0.2, g.c.z + g.h.z + 0.05), new V3());
                const reach = this._armTo(side, cradle), all = smooth(e * 2.5);
                this._reachPose(side, reach, all, pose);
                pose['curl' + side] = 35;
                this.strength['arm' + side] *= 1 - 0.5 * e;
                this._cradle = side;
            }
            if (this._free(other)) {
                // The back of the shoulder or arm the other hand cannot get round to is clutched from in front, over the same
                // place on the arm. (Sent after the back, out of its reach, the hand stopped wedged between the chest and
                // the hurt arm held across it, and the two arms shook against each other, 18 to 24 rad/s.)
                const ahead = new V3(0, 0, 1).applyRotationQuaternion(this.rd.byName.get('chest').node.rotationQuaternion);
                // (Decided once for the wound: decided every frame, a reach missing by about the limit went back and forth.)
                w.front ??= V3.Dot(out, ahead) < -0.3 && this._armTo(other, on).miss > 0.05;
                if (w.front) {
                    const [a, b] = this.rd.segmentEnds(seg), line = b.subtract(a), t = clamp(V3.Dot(on.subtract(a), line) / line.lengthSquared());
                    on.copyFrom(a.add(line.scale(t))).addInPlace(ahead.scale(seg.radius + 0.02));
                    out.copyFrom(ahead);
                }
                this._hold(other, on, out, e, pose);
            }
            more({ spineFlex: 8, neckFlex: 14 });
        } else if (/^(thigh|shin|foot)/.test(name)) {
            // A hand to a thigh, which it reaches standing (the one on its side, or the other if that one cannot); lower
            // down only lying, curled up to it.
            const by = this._free(side) ? side : this._free(other) ? other : null;
            if (by && (lying || name.startsWith('thigh'))) this._hold(by, on, out, e, pose);
            this.strength['leg' + side] *= 1 - 0.45 * e;
            this.favour = { side: other, how: e };
            more({ ['knee' + side]: 16, ['hipFlex' + side]: 8, ['ankle' + side]: 6, spineFlex: 8 });
        } else {
            // The trunk, the neck, the face or the scalp: the free hand that gets nearest it (the arm's own reach worked out
            // round the body, _armTo), and for a big wound (a shotgun's, a rifle's way out) the other over it.
            if (!w.hands || w.hands.some((k) => !this._free(k))) {
                // (Not the hand whose own upper arm lies over the place, an armpit or the flank under it: reaching for it,
                // that arm went up and round itself, flailing.)
                const free = ['L', 'R'].filter((k) => this._free(k) && !this._under(k, on));
                const miss = (k) => this._armTo(k, on).miss + (k === side ? 0 : 0.02);
                free.sort((a, b) => miss(a) - miss(b));
                w.hands = free.slice(0, w.size > 6 ? 2 : 1);
            }
            const [first, second] = w.hands;
            if (first) this._hold(first, on, out, e, pose);
            if (second) this._hold(second, on.add(name === 'head' ? out.scale(0.025) : this._up().scale(0.05)), out, e * 0.8, pose);
            if (name === 'head') {
                // The head down into the hands.
                this.hunch = 10 * e;
                more({ spineFlex: 10, neckFlex: 22 });
            } else {
                const belly = name !== 'chest';
                this.hunch = (belly ? 26 : 12) * e;
                more({ spineFlex: belly ? 26 : 12, neckFlex: 10, kneeL: belly ? 8 : 0, kneeR: belly ? 8 : 0 });
            }
        }
    }

    // An arm's reach (_armTo) laid over the pose by `all` (0 to 1), eased toward over a tenth of a second: the reach is
    // solved again every frame from where the body has just moved to, and now and then from a new start (its seeds),
    // and taken as it came the arm's aim jumped by degrees from one frame to the next and the arm shook after it.
    _reachPose(side, reach, all, pose) {
        for (const c of ARM) pose[c + side] = (pose[c + side] || 0) + (reach[c] - (pose[c + side] || 0)) * all;
        this._ease('arm' + side, ARM, side, pose, 0.1);
    }

    // The pose's `controls` (on `side`) eased toward over `tau` seconds, for as long as they are asked for every frame.
    _ease(key, controls: string[], side, pose, tau) {
        const was = (this._eased[key] ??= {}), k = Math.min(1, this._dt / tau), fresh = this.clock - (was.t ?? -1) > 0.1;
        for (const c of controls) {
            const want = pose[c + side] || 0;
            was[c] = fresh || was[c] === undefined ? want : was[c] + (want - was[c]) * k;
            pose[c + side] = was[c];
        }
        was.t = this.clock;
    }
    declare _eased: Record<string, any>;
    declare _dt: number;

    // Whether a place (world) lies under the upper arm on `side`, within a hand's breadth of it.
    _under(side, at: BABYLON.Vector3) {
        const rd = this.rd, a = rd.byName.get('upperarm' + side), elbow = rd.segmentEnds(rd.byName.get('upperarm2' + side))[1];
        const from = a.node.position, line = elbow.subtract(from), t = clamp(V3.Dot(at.subtract(from), line) / line.lengthSquared());
        return V3.Distance(at, from.add(line.scale(t))) < a.radius + 0.07;
    }

    // Which way is up the trunk.
    _up() { return new V3(0, 1, 0).applyRotationQuaternion(this.rd.byName.get('chest').node.rotationQuaternion); }

    // Whether hand `side` can hold anything: an arm with strength in it, not hurt (hit()), broken above the hand or cut off.
    _free(side) {
        const rd = this.rd, hand = rd.byName.get('hand' + side);
        return this.strength['arm' + side] >= 0.05 && !this.hurt[side] && !this._broken('arm', side) && !rd.cutOff(hand);
    }

    // Hand `side` put on `at` (world, just off the skin, which faces `out`): the arm's joints posed to reach it (_armTo),
    // blended in by `how` (0 to 1), and the last of the way, and the press on it, by a pull of the hand itself, which its
    // arm pays for at the chest. Where the arm cannot get to it without going through the body, the hand goes as near as
    // it can. On it, it only presses; held up on the way (the other arm, the body), it stays where it got to and stops
    // pulling, and tries again a little later: a hand pulled on through the body fought its shape and shook.
    _hold(side, at: BABYLON.Vector3, out: BABYLON.Vector3, how, pose) {
        const rd = this.rd, hand = rd.byName.get('hand' + side);
        if (!this._free(side) || how <= 0.05) return;
        this.holding[side] = true;
        // A reach starts from the arm out in front, bent: from where it hangs, the nearest way to a place across the
        // body is through it.
        if (how < 0.06 && this._arms?.[side]) this._arms[side].x = [-40, 10, 0, 80];
        // Not inside anything else of the body (a wound on an arm held in against the side): out over it until clear. (Only
        // what it is truly inside: the wound's own limb, and anything merely near, left the hand pushed out 6 to 8 cm.)
        const wound = this.wound?.seg, limb = wound && /[LR]$/.test(wound.name) ? wound.name.replace(/^([a-z]+?)2?([LR])$/, '$1') : '';
        const skip = (s) => s === wound || (/^(upperarm|forearm|hand)/.test(s.name) && s.name.endsWith(side)) || (limb && s.name.replace(/2?([LR])$/, '') === limb && s.name.endsWith(wound.name.slice(-1)));
        for (let k = 0; k < 3 && rd.attached.some((s) => !skip(s) && rd.outside(s, at) < -0.005); k++) at = at.add(out.scale(0.02));
        const now = rd.worldPoint(hand, hand.centre, new V3());
        // Where it is going and where it was held up are kept as the chest carries them, and it is sent again only when the
        // place has moved on the body. (Kept in the room, a body swaying 5 cm sent the hand off again, and one held up was
        // pulled back to where the room had been; with a try again every second and a half besides, a hand that could
        // not get to a shoulder or an armpit went back and forth at it for as long as it hurt, the arm waving.)
        const chest = rd.byName.get('chest'), cq = chest.node.rotationQuaternion, cp = chest.node.position;
        Q.InverseToRef(cq, _q);
        const local = at.subtract(cp).applyRotationQuaternionInPlace(_q);
        let g = this._grips[side];
        if (!g || V3.Distance(g.to, local) > 0.05) g = this._grips[side] = { to: local, best: Infinity, since: this.clock, hold: null, t: this.clock };
        const held = g.hold && g.hold.applyRotationQuaternion(cq).addInPlace(cp);
        const reach = this._armTo(side, held ?? at), to = held ?? (reach.miss > 0.03 ? reach.hand : at);
        const d = V3.Distance(now, to);
        // (On it: the hand's middle within its own half thickness and a little of where it is going, which lies just off
        // the skin.)
        const touching = d < 0.06;
        if (!g.hold && d < g.best - 0.01) { g.best = d; g.since = this.clock; }
        if (!g.hold && !touching && this.clock - g.since > 0.3) { g.hold = now.subtract(cp).applyRotationQuaternionInPlace(_q); g.t = this.clock; }
        // A hand goes all the way or not at all: how much it hurts is in how hard it presses (and how bent over they are).
        const all = smooth(how * 2.5);
        this._reachPose(side, reach, all, pose);
        pose['curl' + side] = 25;
        // On it, or held up on the way, the arm lets the hand lie where it is, its muscles easing off rather than driving
        // it on into what stopped it.
        // (On it, a third: the arm's aim is just off the skin of something that moves, and at three quarters the arm's
        // springs drove the hand on into it, 30 N at the hand for 2 cm, and it rattled there.)
        if (g.hold || touching) this.strength['arm' + side] *= g.hold ? 0.6 : 0.35;
        if (g.hold) return;
        const carrier = this.wound?.seg ?? null;
        if (touching) {
            // Pressed into the skin a little, as firmly as it hurts.
            const into = at.subtract(out.scale(0.03)), most = 12 * this.will * how;
            this.act((dt) => this.muscles.push(hand, this.muscles.reach(hand, into, 25, 1.5, most, _t, carrier), [chest], dt));
        } else {
            const most = 30 * this.will * how;
            this.act((dt) => this.muscles.push(hand, this.muscles.reach(hand, to, 60, 1.5, most, _t, carrier), [chest], dt));
        }
    }

    // The shoulder and elbow (pose controls, degrees) that put the middle of hand `side` at `at` (world), as near as the
    // arm reaches without going through the trunk, from where they were asked to be last time: damped least squares on
    // the arm as the skeleton turns it (person.ts: twist, then out to the side, then forward, at the shoulder; the elbow
    // on its own hinge), in the chest's own frame, where the shoulder does not move. The twist is what takes a bent arm's
    // hand across the front of the body (to the belly, the other arm); it is kept as little as will do. Also `miss`, how
    // far from `at` the hand stays, and `hand`, where it gets to (world).
    _armTo(side, at: BABYLON.Vector3) {
        const rd = this.rd, person = this.npc.person, chest = rd.byName.get('chest');
        let arm = this._arms?.[side];
        if (!arm) {
            const b = (n) => person.byName[`${n}.${side}`].head, hand = rd.byName.get('hand' + side);
            arm = (this._arms ??= {})[side] = { x: [P.RELAXED['shoulderAbduct' + side], P.RELAXED['shoulderFlex' + side], 0, 30], seed: [0, 0, 0, 0], frame: 0, goal: null,
                s: b('upperarm01'), upper: b('lowerarm01').subtract(b('upperarm01')), fore: b('wrist').add(hand.centre).subtract(b('lowerarm01')),
                axes: ['shoulderAbduct', 'shoulderFlex', 'shoulderTwist', 'elbow'].map((k) => person.hinges[k + side].axis),
                boxes: ['chest', 'belly', 'pelvis'].map((n) => ({ seg: rd.byName.get(n), o: new V3(), inv: new Q() })),
                out: { shoulderAbduct: 0, shoulderFlex: 0, shoulderTwist: 0, elbow: 0, miss: 0, hand: new V3() } };
        }
        // The place as it would be with the chest standing at rest, and the trunk's boxes as they stand to the chest now.
        Q.InverseToRef(chest.node.rotationQuaternion, _q);
        at.subtractToRef(chest.node.position, _goal).applyRotationQuaternionInPlace(_q).addInPlace(chest.head);
        for (const b of arm.boxes) {
            b.seg.node.position.subtractToRef(chest.node.position, b.o).applyRotationQuaternionInPlace(_q).addInPlace(chest.head);
            Q.InverseToRef(_q.multiplyToRef(b.seg.node.rotationQuaternion, _qa), b.inv);
        }
        // From where the arm was; and, when the place has moved or the hand is not getting there, from each of a few ways
        // of holding the arm (up in front of the chest, across it, down by the side), which the arm hanging does not find
        // its way to: the best, unless it is barely better, so the arm does not flick from one to the other.
        const x = arm.x;
        let miss = descend(arm, x, 3, side);
        const moved = !arm.goal || V3.DistanceSquared(arm.goal, _goal) > 0.02 * 0.02;
        if (moved || (miss > 0.03 && arm.frame++ % 8 === 0)) {
            arm.goal = _goal.clone();
            for (const seed of SEEDS) {
                for (let k = 0; k < 4; k++) arm.seed[k] = seed[k];
                const m = descend(arm, arm.seed, 12, side);
                if (m < miss - 0.03) { for (let k = 0; k < 4; k++) x[k] = arm.seed[k]; miss = m; }
            }
            descend(arm, x, 1, side);
        }
        const o = arm.out;
        [o.shoulderAbduct, o.shoulderFlex, o.shoulderTwist, o.elbow] = x;
        o.miss = arm.reach;
        handAt(arm, x, o.hand).subtractInPlace(chest.head).applyRotationQuaternionInPlace(chest.node.rotationQuaternion).addInPlace(chest.node.position);
        return o;
    }

    // The leg's joints (pose controls) that put its ankle at `ankle` (world) with the foot level with the floor, from
    // the hip where it is or, given `hipY`, from the hip at that height under the pelvis set upright where it faces now:
    // what the leg should be for the body to stand over that foot, so that the hip holds the pelvis upright to it. (Set
    // to the way they mean to face instead, a pelvis twisted by a blow fought the planted leg and dragged the foot.)
    _legTo(side, ankle: BABYLON.Vector3, pose, f, hipY?: number, upright = true, shift?: BABYLON.Vector3) {
        const rd = this.rd, leg = this.leg[side], pelvis = rd.byName.get('pelvis'), q = pelvis.node.rotationQuaternion;
        const turn = hipY === undefined || !upright ? q : Q.RotationAxis(BABYLON.Axis.Y, Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)));
        Q.InverseToRef(turn, _q);
        ankle.subtractToRef(rd.byName.get('thigh' + side).node.position, _v);
        if (shift) _v.subtractInPlace(shift);
        if (hipY !== undefined) _v.y = ankle.y - hipY;
        _v.rotateByQuaternionToRef(_q, _v);
        const [flex, abduct, knee, shin] = legAngles(_v, leg);
        const tip = Math.asin(clamp(V3.Dot(new V3(0, 1, 0).applyRotationQuaternion(turn), f), -1, 1));
        pose['hipFlex' + side] = (flex - leg.flex) / RAD;
        pose['hipAbduct' + side] = (abduct - leg.abduct) / RAD;
        pose['knee' + side] = (knee - leg.knee) / RAD;
        // A shin leaning forward over a level foot is a foot bent up toward it; a forward-tipped pelvis leans it back.
        pose['ankle' + side] = (leg.shin - shin + tip) / RAD;
    }

    // The head turned to whoever is looking at them, as far as a neck turns.
    _look(pose, weight) {
        const head = this.rd.byName.get('head'), eye = this.npc.world.camera?.position;
        if (!eye || weight <= 0) return;
        const chest = this.rd.byName.get('chest');
        const to = eye.subtract(head.node.position);
        Q.InverseToRef(chest.node.rotationQuaternion, _q);
        to.rotateByQuaternionToRef(_q, _v);
        const yaw = clamp(Math.atan2(_v.x, _v.z), -1.1, 1.1), pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.5);
        pose.neckTwist = (pose.neckTwist || 0) + yaw * this.lookSign * weight / RAD;
        pose.neckFlex = (pose.neckFlex || 0) - pitch * weight / RAD;
    }

    // --- going down ----------------------------------------------------------------------

    // Falling: the legs give, and anyone awake enough puts their hands out the way they are going.
    _fall(dt) {
        const rd = this.rd, s = this.strength, will = this.will;
        const chest = rd.byName.get('chest');
        const flat = new V3(this.vel.x, 0, this.vel.z);
        if (flat.length() < 0.3) {
            const up = new V3(0, 1, 0).applyRotationQuaternion(chest.node.rotationQuaternion);
            flat.set(up.x, 0, up.z);
        }
        const going = flat.length() > 1e-3 ? flat.normalize() : this._facing();
        const front = new V3(0, 0, 1).applyRotationQuaternion(chest.node.rotationQuaternion);
        const right = new V3(1, 0, 0).applyRotationQuaternion(chest.node.rotationQuaternion);
        const ahead = V3.Dot(going, front), aside = V3.Dot(going, right);
        const way = ahead > 0.45 ? 'ahead' : ahead < -0.45 ? 'behind' : 'side';
        const pose = braced(way, Math.sign(aside) || 1, smooth(this.t * 2.5));
        s.legL *= 0.3; s.legR *= 0.3; s.trunk *= 0.5;
        // The hands themselves sent toward the floor where it will be hit.
        if (will > 0.3) {
            for (const side of ['L', 'R']) {
                const hand = rd.byName.get('hand' + side), arm = s['arm' + side];
                if (!arm || this._broken('arm', side)) continue;
                const spot = this.com.add(going.scale(0.5)).add(right.scale((side === 'R' ? 0.22 : -0.22)));
                spot.y = this.floor + 0.08;
                this.act((dt) => this.muscles.push(hand, this.muscles.reach(hand, spot, 120, 3, 70 * arm * will, _t), [chest], dt));
            }
        }
        // The body meeting the floor, heard once.
        const trunk = ['pelvis', 'belly', 'chest'].map((n) => rd.byName.get(n));
        if (!this.landed && trunk.some((seg) => rd.lowest(seg) < this.floor + TOUCH)) {
            this.landed = true;
            this.npc.world.sound?.shot('body-fall', { follow: () => rd.centre.asArray(), gain: clamp(0.4 + Math.abs(this.vel.y) / 4) });
        }
        if ((this.com.y - this.floor < this.heights.stand.pelvis * 0.5 && this.vel.length() < 0.5 && this.t > 0.4) || this.t > 4) this._go('down');
        return pose;
    }

    // --- on the floor -----------------------------------------------------------------------

    _down(dt) {
        this.lying += dt;
        if (!this.mode || this._modeDone()) this._choose();
        switch (this.mode) {
            case 'roll': return this._roll(dt);
            case 'push': case 'lunge': case 'rise': return this._rise(dt);
            case 'crawl': return this._crawl(dt);
            case 'creep': return this._creep(dt);
            case 'writhe': return this._writhe(dt);
            case 'rest': {
                const s = this.strength;
                for (const k of Object.keys(s)) s[k] *= 0.15;
                const pose = { ...REST };
                this._look(pose, this.npc.vitals.conscious * 0.6);
                s.neck = this.will * 0.6;
                return pose;
            }
            default: {
                const s = this.strength;
                for (const k of Object.keys(s)) s[k] = 0;
                return REST;
            }
        }
    }

    // Whether what they are doing on the floor should be thought about again.
    _modeDone() {
        const w = this.will;
        if (this.mode === 'still') return w > 0.15;
        if (w < 0.12) return true;
        if (this.mode === 'rest' || this.mode === 'writhe') return this.t > 1;
        if (this.mode === 'crawl' || this.mode === 'creep') return w < 0.35 || this.t > 12;
        return false;
    }

    // What someone on the floor does next, by how they are.
    _choose() {
        const npc = this.npc, v = npc.vitals, w = this.will;
        const mode = (m, next = '') => { if (m !== this.mode) this.t = 0; this.mode = m; this.next = next; };
        if (w < 0.12) return mode('still');
        // Coming round, they lie a while first, longer the more muddled.
        if (this.mode === 'still') this.wait = Math.max(this.wait, this.lying + 3 + 5 * (v.daze ?? 0));
        if (npc.grabbed) return mode('writhe');
        const prone = this._front().y < -0.5;
        // (An arm broken is no use to drag the body with: both broken, they lie where they are.)
        const arms = ['L', 'R'].some((k) => this.strength['arm' + k] > 0.3 && !this._broken('arm', k));
        if (this._canStand() && w > 0.55 && v.pain < 0.75 && this.lying > this.wait)
            return prone ? mode('push') : mode('roll', 'push');
        if (!this._canStand() && w > 0.4 && arms && this.lying > 2.5 + v.pain * 4) {
            // On hands and knees with one leg hurt and the rest sound (the bad one held off the floor and dragged); on the
            // elbows, the legs trailing, when neither leg will take a knee or an arm is gone.
            const kind = this._onAllFours() ? 'creep' : 'crawl';
            return prone ? mode(kind) : mode('roll', kind);
        }
        if (v.pain > 0.35 || v.lost > 0.2) return mode('writhe');
        return mode('rest');
    }

    // Which way the chest faces: down when lying on the front.
    _front() { return new V3(0, 0, 1).applyRotationQuaternion(this.rd.byName.get('chest').node.rotationQuaternion); }

    // Only the limbs on the floor can push the body off it.
    _limbsDown() { return this.touching.filter((s) => s.limb || /^(upperarm|hand)/.test(s.name)); }

    // Over onto the front: a knee drawn up and pushed off, an arm thrown across.
    _roll(dt) {
        const rd = this.rd, front = this._front();
        const chest = rd.byName.get('chest'), pelvis = rd.byName.get('pelvis');
        const along = chest.node.position.subtract(pelvis.node.position).normalize();
        if (front.y < -0.6) { this.mode = this.next || 'rest'; this.t = 0; return REST; }
        if (this.t > 5) return this._fail();
        // Turning the front down about the body's own length: which way round is shorter.
        const way = Math.sign(V3.Dot(V3.Cross(front, new V3(0, -1, 0)), along)) || 1;
        const right = new V3(1, 0, 0).applyRotationQuaternion(chest.node.rotationQuaternion);
        const toward = V3.Dot(V3.Cross(along, right), new V3(0, -1, 0)) * way > 0 ? 'R' : 'L';
        const away = toward === 'R' ? 'L' : 'R';
        const pose = add(REST, { ['hipFlex' + away]: 55, ['knee' + away]: 85, ['shoulderFlex' + away]: 95, ['shoulderAbduct' + away]: -40, ['elbow' + away]: 20,
            ['shoulderAbduct' + toward]: 30, neckFlex: 15 });
        // The push off the floor with that leg and arm, as the turn it gives the trunk about its own length, easing off
        // as it gets going: given back to the limbs on the floor instead, it only wrung the trunk against them.
        const most = 200 * this.will;
        if (this._limbsDown().length) this.act((dt) => {
            chest.body.getAngularVelocityToRef(_v);
            const k = clamp(1 - V3.Dot(_v, along) * way / 2.5) * most * way * dt;
            chest.body.applyAngularImpulse(along.scale(k * 0.6));
            pelvis.body.applyAngularImpulse(along.scale(k * 0.4));
        });
        return pose;
    }

    // Up from the front: onto hands and knees, up onto the knees, one foot forward, and up. Each stage leans on the
    // floor through the limbs on it, as hard as the person still can, and gives up if it does not get there in time.
    _rise(dt) {
        const rd = this.rd, will = this.will, h = this.heights;
        if (will < 0.4 || !this._canStand()) return this._fail();
        const pelvis = rd.byName.get('pelvis'), chest = rd.byName.get('chest');
        const head = rd.byName.get('head').node.position;
        if (this.t < dt * 1.5) {
            const to = head.subtract(pelvis.node.position);
            this.heading = this.mode === 'push' ? Math.atan2(to.x, to.z) : this.heading;
        }
        const limbs = this._limbsDown();
        const yaw = Q.RotationAxis(BABYLON.Axis.Y, this.heading);
        let pose, pitch = 0, lift = { pelvis: h.all4.pelvis, chest: h.all4.chest }, most = 0.75, time = 4, done = false, over: BABYLON.Vector3 = null;
        if (this.mode === 'push') {
            pose = ALL4;
            pitch = 90;
            done = pelvis.node.position.y - this.floor > h.all4.pelvis * 0.85 && chest.node.position.y - this.floor > h.all4.chest * 0.85 && this.t > 0.9;
        } else if (this.mode === 'lunge') {
            // One foot brought forward under the body, the trunk coming up off the hands.
            const k = smooth(this.t / 0.8);
            pose = P.mix(ALL4, LUNGE, k);
            pitch = 90 - 45 * k;
            lift = { pelvis: h.kneel.pelvis, chest: h.kneel.pelvis + (h.kneel.chest - h.kneel.pelvis) * 0.7 };
            const foot = rd.byName.get('footR');
            const spot = pelvis.node.position.add(this._facing().scale(0.4));
            spot.y = this.floor + this.foot.middle;
            this.act((dt) => this.muscles.push(foot, this.muscles.reach(foot, spot, 120, 5, 220 * will, _t), [pelvis], dt));
            done = this.t > 0.9 && (V3.Distance(rd.worldPoint(foot, foot.centre, _v), spot) < 0.15 || this.t > 1.5);
            time = 2.5;
        } else {
            // And up off the front foot.
            const k = smooth(this.t / 1.3);
            pose = P.mix(LUNGE, P.stand(this.clock), k);
            pitch = 45 * (1 - k);
            const kneel = { pelvis: h.kneel.pelvis, chest: h.kneel.pelvis + (h.kneel.chest - h.kneel.pelvis) * 0.7 };
            lift = { pelvis: kneel.pelvis + (h.stand.pelvis - kneel.pelvis) * k, chest: kneel.chest + (h.stand.chest - kneel.chest) * k };
            most = 0.85;
            // Standing once the hips are up and the weight is over the feet.
            const feet = ['footL', 'footR'].map((k) => rd.byName.get(k));
            // Up mostly over the front foot, the back leg straightening behind: they come up into a stride and stand in it,
            // both feet down and the weight between them. (Brought up beside the front one at once, the back foot left
            // them on one leg with the weight still behind it, and they sat back down.)
            const front = rd.byName.get('footR').node.position, back = rd.byName.get('footL').node.position;
            over = V3.Lerp(back, front, 0.7).addInPlace(this._facing().scale(this.foot.ahead));
            over.y = 0;
            done = this.t > 1.0 && pelvis.node.position.y - this.floor > h.stand.pelvis * 0.93 && feet.every((foot) => rd.lowest(foot) < this.floor + TOUCH)
                && outside(footprint(rd, feet).hull, this.com.x, this.com.z) < -0.03 && Math.hypot(this.vel.x, this.vel.z) < 0.15;
            time = 3.5;
        }
        // The legs' poses are written for an upright trunk; with it tipped forward the hips bend that much more to keep
        // the thighs where they were meant to be (on all fours, straight down).
        if (this.mode !== 'push') pose = { ...pose, hipFlexL: (pose.hipFlexL || 0) + pitch, hipFlexR: (pose.hipFlexR || 0) + pitch };
        if (done) {
            const order = ['push', 'lunge', 'rise'];
            const next = order[order.indexOf(this.mode) + 1];
            if (!next) {
                this.tries = 0;
                this._go('stand');
                this.settle = 2.5;
                return this._stand(dt);
            }
            this.mode = next;
            this.t = 0;
            return pose;
        }
        if (this.t > time) {
            // Nearly up off the front foot, both feet down, they stand and let the balance have it (it steps or it goes
            // over): failed there, the muscles let go all at once and a body all but standing dropped to the floor in a
            // second, and got up and dropped again, up and down.
            const feet = ['footL', 'footR'].map((k) => rd.byName.get(k));
            if (this.mode === 'rise' && pelvis.node.position.y - this.floor > (h.kneel.pelvis + h.stand.pelvis) / 2 && feet.every((foot) => rd.lowest(foot) < this.floor + TOUCH)) {
                this.tries = 0;
                this._go('stand');
                this.settle = 2.5;
                return this._stand(dt);
            }
            return this._fail();
        }
        // The trunk lifted toward the stage's height and turned toward its lean, pushing down through the limbs.
        const want = yaw.multiply(Q.RotationAxis(BABYLON.Axis.X, pitch * RAD));
        const weight = rd.mass * G;
        for (const [seg, height, share] of [[pelvis, lift.pelvis, 0.45], [chest, lift.chest, 0.55]] as [any, number, number][]) {
            this.act((dt) => {
                seg.body.getLinearVelocityToRef(_v);
                const up = clamp(rd.mass * share * (G * 0.55 + 30 * (this.floor + height - seg.node.position.y) - 9 * _v.y), 0, weight * share * most * will);
                // Braced against going anywhere but up (the limbs on the floor hold the body's drift), or, rising off the
                // front foot, carried forward over it.
                const m = rd.mass * share, side = new V3(-_v.x * 4 * m, up, -_v.z * 4 * m);
                if (over) {
                    side.x += clamp(m * 12 * (over.x - this.com.x), -0.25 * weight * share, 0.25 * weight * share);
                    side.z += clamp(m * 12 * (over.z - this.com.z), -0.25 * weight * share, 0.25 * weight * share);
                }
                this.muscles.push(seg, side, limbs, dt);
                // The lean steered like the roll: as a turn of the trunk itself, while there is floor to push on.
                if (limbs.length) seg.body.applyAngularImpulse(this.muscles.toward(seg, want, 30, 12, 160 * will, _t, this._spinOfTrunk()).scaleInPlace(dt));
            });
        }
        return pose;
    }

    // A stage of getting up that did not work: back down for a while, and another go if they still can.
    _fail() {
        this.tries++;
        // Longer between tries the more of them have failed.
        this.wait = this.lying + 2 + Math.random() * 3 + Math.min(4, this.tries) * 3;
        this.mode = 'rest';
        this.t = 0;
        return REST;
    }

    // Whether they can go on hands and knees: both arms sound, the cord whole, and one leg sound to kneel on.
    _onAllFours() {
        const v = this.npc.vitals, legs = ['L', 'R'].filter((k) => !this._broken('leg', k) && !this.rd.cutOff(this.rd.byName.get('foot' + k)));
        return !v.paralysed.legs && !v.paralysed.arms && legs.length > 0 && ['L', 'R'].every((k) => !this._broken('arm', k) && !this.rd.cutOff(this.rd.byName.get('hand' + k)));
    }

    // On hands and knees, away from whoever did it: a hand and the knee on the other side forward together, then the other
    // two, the trunk held up level over them by the limbs on the floor (as getting up holds it, _rise) and carried on by
    // them. A broken leg is not posed (_guard): it trails behind on the floor.
    _creep(dt) {
        const rd = this.rd, will = this.will;
        if (this._front().y > -0.3) { this.mode = 'roll'; this.next = 'creep'; this.t = 0; return REST; }
        const pelvis = rd.byName.get('pelvis'), chest = rd.byName.get('chest');
        if (this.t < dt * 1.5) {
            const eye = this.npc.world.camera?.position ?? V3.Zero();
            this.heading = Math.atan2(chest.node.position.x - eye.x, chest.node.position.z - eye.z);
        }
        // Up onto all fours first, then on at about a stride a second and a half.
        const up = smooth(this.t / 1.2);
        this.phase += dt * (2 * Math.PI / 1.5) * (0.5 + 0.5 * will) * up;
        const pose: any = { ...ALL4 };
        const swing = (k) => Math.max(0, Math.sin(this.phase + k)) * up;
        for (const [hand, knee, k] of [['L', 'R', 0], ['R', 'L', Math.PI]] as [string, string, number][]) {
            // The hand lifted and carried forward (the elbow bending to clear the floor), the knee drawn up under the hips.
            pose['shoulderFlex' + hand] += 26 * swing(k) - 8 * swing(k + Math.PI);
            pose['elbow' + hand] += 25 * swing(k);
            // (No further than a few degrees past square to the trunk: drawn up further, the thigh went into the belly.)
            pose['hipFlex' + knee] += 12 * swing(k) - 12 * swing(k + Math.PI);
            pose['knee' + knee] += 15 * swing(k);
        }
        pose.spineSide = 5 * Math.sin(this.phase);
        const f = this._facing(), limbs = this._limbsDown();
        const want = Q.RotationAxis(BABYLON.Axis.Y, this.heading).multiply(Q.RotationAxis(BABYLON.Axis.X, Math.PI / 2));
        const weight = rd.mass * G, pace = 0.3 * will * up;
        this._spinOfTrunk();
        // The hips a thigh and a knee's thickness up off the floor, the trunk level with them. (_measure's all-fours heights,
        // 0.79 m at the hips, are of legs left nearly straight: held up toward them, the lift ran out and the body sagged.)
        const hips = this.leg.L.a + 0.06;
        for (const [seg, height, share] of [[pelvis, hips, 0.45], [chest, hips, 0.55]] as [any, number, number][]) {
            this.act((dt) => {
                if (!limbs.length) return;
                seg.body.getLinearVelocityToRef(_v);
                const m = rd.mass * share;
                const lift = clamp(m * (G * 0.55 + 30 * (this.floor + height - seg.node.position.y) - 9 * _v.y), 0, weight * share * 0.8 * will);
                // Carried on at the pace along the way they face, held from drifting across it.
                const along = V3.Dot(_v, f), push = clamp(m * 6 * (pace - along), -0.15 * weight * share, 0.15 * weight * share);
                const force = new V3(f.x * push - (_v.x - f.x * along) * 4 * m, lift, f.z * push - (_v.z - f.z * along) * 4 * m);
                this.muscles.push(seg, force, limbs, dt);
                this._spinOfTrunk();
                seg.body.applyAngularImpulse(this.muscles.toward(seg, want, 30, 12, 160 * will, _t, _spin).scaleInPlace(dt));
            });
        }
        return pose;
    }

    // The trunk's spin as a whole (pelvis, belly and chest by their weight), in _spin: what turns given to the trunk are
    // damped against (motor.ts `toward`).
    _spinOfTrunk() {
        _spin.setAll(0);
        let mass = 0;
        for (const n of ['pelvis', 'belly', 'chest']) { const seg = this.rd.byName.get(n); seg.body.getAngularVelocityToRef(_w); _spin.addInPlace(_w.scaleInPlace(seg.mass)); mass += seg.mass; }
        return _spin.scaleInPlace(1 / mass);
    }

    // Dragging themselves away from whoever did it, on their elbows, the legs trailing.
    _crawl(dt) {
        const rd = this.rd, will = this.will, s = this.strength;
        // (Flat on the front first: crawling from three-quarters over, the arm underneath was dragged under the hips.)
        if (this._front().y > -0.5) { this.mode = 'roll'; this.next = 'crawl'; this.t = 0; return REST; }
        const chest = rd.byName.get('chest');
        if (this.t < dt * 1.5) {
            const eye = this.npc.world.camera?.position ?? V3.Zero();
            this.heading = Math.atan2(chest.node.position.x - eye.x, chest.node.position.z - eye.z);
        }
        this.phase += dt * (2 * Math.PI / 1.9) * (0.5 + 0.5 * will);
        const pose = crawling(this.phase);
        s.legL *= 0.12; s.legR *= 0.12;
        const f = this._facing();
        const limbs = this._limbsDown();
        for (const side of ['L', 'R']) {
            const hand = rd.byName.get('hand' + side), arm = s['arm' + side];
            if (!arm || this._broken('arm', side)) continue;
            const reaching = Math.cos(this.phase) * (side === 'L' ? 1 : -1);
            if (reaching > 0) {
                // (Out past the side of the head: at 20 cm either side the forearm went across the face.)
                const spot = chest.node.position.add(f.scale(0.5)).add(new V3(f.z, 0, -f.x).scale(side === 'R' ? 0.36 : -0.36));
                spot.y = this.floor + 0.04;
                this.act((dt) => this.muscles.push(hand, this.muscles.reach(hand, spot, 80, 2, 45 * arm * will, _t), [chest], dt));
            } else {
                // The forearm on the floor (or the hand, whichever is down) holds, and the body is pulled up to it.
                const fore = rd.byName.get('forearm2' + side), on = rd.lowest(fore) < rd.lowest(hand) ? fore : hand;
                if (rd.lowest(on) > this.floor + TOUCH * 2) continue;
                const pull = -reaching * 230 * arm * will;
                this.act((dt) => {
                    this.muscles.push(chest, f.scale(pull), [on], dt);
                    this.muscles.push(on, new V3(0, -pull * 0.7, 0), [chest], dt);
                });
            }
        }
        const along = Q.RotationAxis(BABYLON.Axis.Y, this.heading).multiply(Q.RotationAxis(BABYLON.Axis.X, Math.PI / 2));
        this.act((dt) => this.muscles.turn(chest, this.muscles.toward(chest, along, 8, 10, 80 * will, _t, this._spinOfTrunk()), limbs, dt));
        return pose;
    }

    // Curled round it, rocking, a hand pressed to where it hurts.
    _writhe(dt) {
        const rd = this.rd, v = this.npc.vitals, s = this.strength, will = this.will;
        const pose = curled(this.clock, v.pain);
        // (The arms keep enough to hold the wound.)
        for (const k of Object.keys(s)) s[k] *= k.startsWith('arm') ? 0.8 : 0.45;
        this._tend(pose, dt, true);
        // Rolling from side to side with it.
        const rock = Math.sin(this.clock * 0.8) * 30 * v.pain * will;
        const chest = rd.byName.get('chest'), pelvis = rd.byName.get('pelvis');
        const along = chest.node.position.subtract(pelvis.node.position).normalize();
        const limbs = this._limbsDown();
        this.act((dt) => this.muscles.turn(chest, along.scale(rock), limbs, dt));
        return pose;
    }
}

// --- geometry ---------------------------------------------------------------------------

// The ground the feet cover: the corners of each foot's sole, their hull on the floor, and its middle.
function footprint(rd, feet) {
    const points = [];
    const corner = new V3();
    for (const foot of feet) {
        const { c, h } = foot.geo;
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            rd.worldPoint(foot, new V3(c.x + x * h.x, c.y - h.y, c.z + z * h.z), corner);
            points.push([corner.x, corner.z]);
        }
    }
    const hull = convexHull(points);
    const centre = new V3(0, 0, 0);
    for (const [x, z] of hull) { centre.x += x / hull.length; centre.z += z / hull.length; }
    return { hull, centre };
}

// Andrew's monotone chain: the hull of 2D points, counter-clockwise.
export function convexHull(points: number[][]) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// How far a point lies outside a counter-clockwise convex polygon (less than zero inside): its distance past the
// edge it is furthest past.
export function outside(hull: number[][], x: number, z: number) {
    let most = -Infinity;
    for (let i = 0; i < hull.length; i++) {
        const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
        const ex = bx - ax, ez = bz - az, n = Math.hypot(ex, ez) || 1;
        most = Math.max(most, ((x - ax) * ez - (z - az) * ex) / n);
    }
    return most;
}

// How far a point inside a counter-clockwise convex polygon is from its edge going along (dx, dz); 0 from outside.
export function inside(hull: number[][], x: number, z: number, dx: number, dz: number) {
    const n = Math.hypot(dx, dz) || 1;
    dx /= n; dz /= n;
    let most = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
        const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez) || 1;
        const past = ((x - ax) * ez - (z - az) * ex) / len, toward = (dx * ez - dz * ex) / len;
        if (past > 0) return 0;
        if (toward > 1e-9) most = Math.min(most, -past / toward);
    }
    return most === Infinity ? 0 : most;
}

// Where the middle of an arm's hand is for its controls `x` (_armTo: out to the side, forward, twist, elbow; degrees),
// in rest space as the chest stands; and the elbow (_elbow) and the forearm from it to the hand (_fore).
const _goal = new V3(), _elbow = new V3(), _fore = new V3(), _now = new V3(), _pt = new V3(), _loc = new V3();
const _A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], _g = [0, 0, 0, 0];
function handAt(arm, x: number[], out: BABYLON.Vector3) {
    const [ab, fl, tw, el] = arm.axes;
    Q.RotationAxisToRef(fl, x[1] * RAD, _qa).multiplyInPlace(Q.RotationAxisToRef(ab, x[0] * RAD, _qb)).multiplyInPlace(Q.RotationAxisToRef(tw, x[2] * RAD, _qb));
    arm.upper.rotateByQuaternionToRef(_qa, _elbow).addInPlace(arm.s);
    _qa.multiplyInPlace(Q.RotationAxisToRef(el, x[3] * RAD, _qb));
    arm.fore.rotateByQuaternionToRef(_qa, _fore);
    return out.copyFrom(_fore).addInPlace(_elbow);
}

// The ways of holding an arm a reach is tried from (_armTo): up in front of the chest, across it high and low, in front
// of the belly, down by the side, down in front of the thigh.
const SEEDS = [[-60, 40, 0, 95], [-80, 65, 25, 105], [-45, 80, -30, 125], [-30, 20, 60, 85], [10, 25, 10, 60], [-45, 25, -20, 25]];
// The forearm and hand kept out of the trunk's boxes (_armTo): at the elbow, half way down it, near the wrist, the
// hand's middle and the fingertips, by about their flesh (m). (The hand only as far as its palm: it is meant to come to
// the body; let through, it went across the front of the chest through the chest's box and stopped on it.)
const ALONG = [0, 0.5, 0.75, 1, 1.2], FLESH = [0.04, 0.036, 0.03, 0.018, 0.008];
// And the upper arm's lower half, which meets the belly and the hips (the half at the shoulder is jointed to the chest):
// left out, a reach across the body was solved with the upper arm inside the belly's flank, and the shoulder's spring
// pressed it there, 100 to 450 N, the arm shaking against it.
const UPPER = [0.6, 0.85], UPPER_FLESH = 0.04;

// What a reach misses by, as a list (_r, its length returned): the hand from _goal, then how deep each point of the
// forearm is in the trunk, then each point of the upper arm in the belly or the hips.
const _r = new Array(10).fill(0), _r2 = new Array(10).fill(0), _J = [_r.slice(), _r.slice(), _r.slice(), _r.slice()];
function misses(arm, x: number[], r: number[]) {
    handAt(arm, x, _now);
    r[0] = _now.x - _goal.x; r[1] = _now.y - _goal.y; r[2] = _now.z - _goal.z;
    for (let k = 0; k < ALONG.length; k++) {
        _pt.copyFrom(_fore).scaleInPlace(ALONG[k]).addInPlace(_elbow);
        let deep = 0;
        for (const b of arm.boxes) {
            const g = b.seg.geo;
            _pt.subtractToRef(b.o, _loc).applyRotationQuaternionInPlace(b.inv);
            const into = Math.max(Math.abs(_loc.x - g.c.x) - g.h.x, Math.abs(_loc.y - g.c.y) - g.h.y, Math.abs(_loc.z - g.c.z) - g.h.z) - FLESH[k];
            if (into < 0) deep = Math.max(deep, -into);
        }
        r[3 + k] = 2 * deep;
    }
    for (let k = 0; k < UPPER.length; k++) {
        _pt.copyFrom(_elbow).subtractInPlace(arm.s).scaleInPlace(UPPER[k]).addInPlace(arm.s);
        let deep = 0;
        for (let i = 1; i < arm.boxes.length; i++) {
            const b = arm.boxes[i], g = b.seg.geo;
            _pt.subtractToRef(b.o, _loc).applyRotationQuaternionInPlace(b.inv);
            const into = Math.max(Math.abs(_loc.x - g.c.x) - g.h.x, Math.abs(_loc.y - g.c.y) - g.h.y, Math.abs(_loc.z - g.c.z) - g.h.z) - UPPER_FLESH;
            if (into < 0) deep = Math.max(deep, -into);
        }
        r[3 + ALONG.length + k] = 2 * deep;
    }
    return Math.hypot(...r);
}

// `steps` of damped least squares taking `x` toward putting the hand at _goal with the forearm outside the trunk; what
// it misses by then (misses()), and how far the hand is from _goal (arm.reach).
// (Never back behind the body, nor in across it: a hand for a wound goes in front of the trunk, not through it; held
// forward, the arm crosses the front of the chest as far as the shoulder lets it.)
const ARM_LO = [-42, -36, -80, 0], ARM_HI = [129, 149, 80, 145];
function descend(arm, x: number[], steps: number, side: string) {
    for (let it = 0; it < steps; it++) {
        if (misses(arm, x, _r) < 0.004) break;
        for (let k = 0; k < 4; k++) {
            x[k] += 1;
            misses(arm, x, _r2);
            x[k] -= 1;
            for (let i = 0; i < _r.length; i++) _J[k][i] = _r2[i] - _r[i];
        }
        // (J^T J + damping) dx = -J^T r, the arm also drawn toward the way it is most often held.
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let sum = 0;
                for (let n = 0; n < _r.length; n++) sum += _J[i][n] * _J[j][n];
                _A[i][j] = sum + (i === j ? 2e-6 + PREFER[i][1] ** 2 : 0);
            }
            let sum = 0;
            for (let n = 0; n < _r.length; n++) sum += _J[i][n] * _r[n];
            _g[i] = -sum - PREFER[i][1] ** 2 * (x[i] - PREFER[i][0]);
        }
        const dx = solve(_A, _g);
        for (let k = 0; k < 4; k++) x[k] = clamp(x[k] + clamp(dx[k], -25, 25), ARM_LO[k], ARM_HI[k]);
        x[0] = Math.max(x[0], Math.max(-86, ARM_LO[0] - 0.7 * Math.max(0, x[1] - P.RELAXED['shoulderFlex' + side])));
    }
    const m = misses(arm, x, _r);
    arm.reach = Math.hypot(_r[0], _r[1], _r[2]);
    return m;
}

// x for A x = b, A square: Gaussian elimination with partial pivoting (A and b are used up).
function solve(A: number[][], b: number[]) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        [b[c], b[p]] = [b[p], b[c]];
        for (let r = c + 1; r < n; r++) {
            const k = A[r][c] / (A[c][c] || 1e-12);
            for (let j = c; j < n; j++) A[r][j] -= k * A[c][j];
            b[r] -= k * b[c];
        }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let sum = b[r];
        for (let j = r + 1; j < n; j++) sum -= A[r][j] * x[j];
        x[r] = sum / (A[r][r] || 1e-12);
    }
    return x;
}

// A leg reaching from its hip to a point `to` (in the pelvis's frame: +Z ahead, +Y up): how far forward the thigh
// swings, how far out, how far the knee bends, and how far forward the shin then leans, radians.
function legAngles(to: BABYLON.Vector3, leg) {
    const d = clamp(to.length(), 0.3, (leg.a + leg.b) * 0.995);
    const knee = Math.PI - Math.acos(clamp((leg.a * leg.a + leg.b * leg.b - d * d) / (2 * leg.a * leg.b), -1, 1));
    const ahead = Math.acos(clamp((leg.a * leg.a + d * d - leg.b * leg.b) / (2 * leg.a * d), -1, 1));
    const flex = Math.atan2(to.z, -to.y) + ahead;
    return [flex, Math.atan2(leg.out * to.x, -to.y), knee, flex - knee];
}
