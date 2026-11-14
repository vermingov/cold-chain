// The arm of whoever is at the table.
//
// They are never seen whole: only a gloved hand is drawn, with the tool in
// it, the glove's cuff a little way up the wrist. The arm is not drawn. It is a person's arm
// all the same (person.js), on a person's bones, so that fingers close
// round a handle the way fingers do and a wrist turns no further than a
// wrist can.
//
// The arm is put where the tool is, and not the other way about. Whatever
// is held says where it has to be held (a grip: a place, the way its handle
// lies and which way its back faces). The hand is laid on that, the wrist
// is wherever that leaves it, and the elbow is found between the wrist and
// a shoulder that hangs beside and below the eye.
//
// But which way a handle lies is the arm's to say first (`slack`): a tool
// that turned to face wherever it was being moved would ask of a wrist
// what no wrist does. A hand holds a pen one way, and it is the arm that
// moves.

import * as BABYLON from '@babylonjs/core';
const Q = BABYLON.Quaternion;
const V3 = BABYLON.Vector3;

// Where the shoulder is from the eye, in metres: out to its own side, down, and forward.
const SHOULDER = { out: 0.17, down: 0.24, forward: -0.02 };
// The elbow hangs down and out from the line between shoulder and wrist.
const ELBOW_HANGS = { out: 0.5, down: 1, forward: -0.3 };
// Where the elbow goes round the line from shoulder to wrist is wherever
// leaves the wrist straightest: the forearm comes in behind the hand the way
// the hand is turned, so a hand that holds a blade across the body has its
// arm come round to hold it so, and not a wrist bent back on itself. But
// not into anything: an arm keeps `clear` metres between itself
// and the body and the table, and its elbow `eye` metres from the eye. It is
// looked for `swings` radians at a time, no more than `most` either way from
// where it hangs (an elbow does not go up over the arm), and the elbow comes
// round to it `eases` of the way a frame, never at a jump.
const KEEPS = { clear: 0.045, eye: 0.38, swings: 0.15, most: 1.8, eases: 0.2 };
const REACH = 0.985;            // of the arm's whole length: it is never drawn quite straight
const LEANS = 0.6;              // a shoulder that leans in goes this far down for each metre forward
const SLACK_OUT = 0.22;         // metres out to its side that an elbow stands, for which way a held tool lies
const WEB = 0.014;              // metres out on the back of the hand from the bones that a handle rests on the web of the thumb
// What it wears: a glove, skin tight, its cuff running `cuff` up the forearm.
const WORN = { glove: 0.0006, cuff: 0.045 };
const NITRILE = { colour: [0.08, 0.2, 0.4], rough: 0.4 };

// How the fingers lie for each thing a hand does, in degrees a joint from
// the hand at rest (a finger's three joints run from the knuckle out; `cup`
// bends the ring and little metacarpals, the palm closing round what is held;
// the thumb as person.ts's thumbBase, thumbIn and thumb). Each finger's last
// joint takes about two thirds of its middle one, as the tendons couple them.
export const HOLDS = {
    // A scalpel held as a pen is: on the middle finger, under the index, the thumb's pad against it.
    pen: {
        index: [46, 38, 18], middle: [56, 52, 26], ring: [70, 82, 44], little: [76, 88, 48], cup: 5,
        thumbIn: -10, thumbBase: 30, thumb: 15,
    },
    // A hand about to take hold: fingers a little curled, the thumb out from them.
    open: {
        index: [14, 16, 8], middle: [16, 18, 9], ring: [20, 22, 10], little: [24, 24, 12],
        thumbIn: 5, thumbBase: 15, thumb: 6,
    },
    // Flesh taken between the thumb and the first two fingers, the other two tucked away.
    pinch: {
        index: [40, 34, 14], middle: [48, 42, 18], ring: [72, 86, 50], little: [78, 90, 54], cup: 6,
        thumbIn: 10, thumbBase: 15, thumb: 15,
    },
    // A fist: the fingers rolled tight into the palm, their tips on it, the ring and little metacarpals cupped, the
    // thumb out from the palm and across the middle bones of the first two fingers (bent down into the palm instead,
    // it went in under them).
    fist: {
        index: [86, 100, 66], middle: [90, 104, 70], ring: [92, 106, 72], little: [92, 106, 72], cup: 15,
        thumbIn: -30, thumbBase: 30, thumb: 60,
    },
    // The rest close round a handle (hands.ts finds the handle's line from where the fingers lie). A gun's grip, about
    // 3 by 5 cm: the last three fingers round it, the index along the frame to the trigger, the thumb down the far side.
    grip: {
        index: [22, 38, 16], middle: [62, 78, 50], ring: [66, 80, 52], little: [70, 82, 54], cup: 8,
        thumbIn: 30, thumbBase: 10, thumb: 22,
    },
    // The other hand on a gun's grip, round the fingers of the one holding it: all four wrapped, opened wider.
    support: {
        index: [48, 58, 34], middle: [52, 62, 38], ring: [56, 64, 40], little: [60, 66, 42], cup: 6,
        thumbIn: 10, thumbBase: 15, thumb: 8,
    },
    // A forend or handguard, 4 to 5 cm across, cradled from below: fingers round its far side, the thumb along this one.
    wrap: {
        index: [36, 50, 30], middle: [40, 54, 32], ring: [44, 56, 34], little: [48, 58, 36], cup: 5,
        thumbIn: 10, thumbBase: 20, thumb: 8,
    },
    // A handle about 3 cm across (knife, sword, bat): a full grip, the index too, the thumb over the fingers.
    handle: {
        index: [64, 84, 54], middle: [68, 88, 58], ring: [72, 90, 60], little: [74, 92, 62], cup: 10,
        thumbIn: 25, thumbBase: 20, thumb: 35,
    },
    // A ball 6 to 7 cm across (the grenade, the gauze roll): fingers spread round it, the thumb against them.
    ball: {
        index: [30, 40, 24], middle: [32, 42, 26], ring: [36, 44, 28], little: [40, 46, 30], cup: 8,
        thumbIn: 30, thumbBase: 25, thumb: 15,
    },
};

// A hold as a pose a person can be given.
function fingerPose(hold, side) {
    const pose = {};
    for (const [finger, bends] of Object.entries(hold)) {
        if (Array.isArray(bends)) bends.forEach((bend, k) => { pose[`${finger}${k + 1}${side}`] = bend; });
        else pose[finger + side] = bends;
    }
    return pose;
}

// The part of a person's skin whose triangles `keep` keeps, as a mesh of
// its own on the person's bones, every corner pushed `off` metres out from
// the skin. `keep` is given a triangle's three corners.
export function worn(person, name, keep, off, material) {
    const { arrays } = person.lib.bodies.get(person.bodyName);
    const index = arrays.index, corner = new Map(), data = new BABYLON.VertexData();
    const positions = [], normals = [], joints = [], weights = [], indices = [];
    for (const part of person.header.parts.filter((p) => p.kind === 'skin')) {
        for (let t = part.indexStart; t < part.indexStart + part.indexCount; t += 3) {
            const three = [index[t], index[t + 1], index[t + 2]];
            if (!keep(three)) continue;
            for (const i of three) {
                if (!corner.has(i)) {
                    corner.set(i, positions.length / 3);
                    for (let k = 0; k < 3; k++) positions.push(arrays.position[i * 3 + k] + arrays.normal[i * 3 + k] * off);
                    for (let k = 0; k < 3; k++) normals.push(arrays.normal[i * 3 + k]);
                    for (let k = 0; k < 4; k++) joints.push(arrays.joints[i * 4 + k]);
                    for (let k = 0; k < 4; k++) weights.push(arrays.weights[i * 4 + k] / 255);
                }
                indices.push(corner.get(i));
            }
        }
    }
    const mesh = new BABYLON.Mesh(name, person.scene);
    data.positions = positions;
    data.normals = normals;
    data.matricesIndices = joints;
    data.matricesWeights = weights;
    data.indices = indices;
    data.applyToMesh(mesh);
    mesh.parent = person.body;
    mesh.position.copyFrom(person.mesh.position);
    mesh.skeleton = person.skeleton;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;       // the skinned bounds lie
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.material = material;
    return mesh;
}

export function plain(scene, name, { colour, rough }) {
    const material = new BABYLON.PBRMaterial(name, scene);
    material.albedoColor = BABYLON.Color3.FromArray(colour);
    material.metallic = 0;
    material.roughness = rough;
    material.environmentIntensity = 0;
    material.maxSimultaneousLights = 8;
    // A glove is seen into at its cuff.
    material.backFaceCulling = false;
    return material;
}

export class Arm {
    declare side: any;
    declare camera: any;
    declare clear: any;
    declare person: any;
    declare bones: { upper: any; fore: any; twist: any; wrist: any; };
    declare lengths: number[];
    declare meshes: BABYLON.Mesh[];
    declare holding: any;
    declare fingers: {};
    declare grasp: { at: any; along: BABYLON.Vector3; rotation: BABYLON.Quaternion; };
    declare bent: any;
    declare shift: BABYLON.Vector3;

    // `lib` is the People, `bodyName` whose arm it is, `side` 'L' or 'R',
    // and `camera` the eye it hangs beside. `clear(point)` says how far a
    // point of the world is above whatever is under it (the body, the
    // table): the arm keeps out of those.
    constructor(lib, bodyName, side, camera, { clear = null, hold = 'pen' } = {}) {
        this.side = side;
        this.camera = camera;
        this.shift = V3.Zero();
        this.clear = clear;
        const person = this.person = lib.make(bodyName, { dressed: false, name: 'arm' + side });
        person.mesh.isVisible = false;
        person.blinks = false;

        const b = (name) => person.byName[`${name}.${side}`];
        this.bones = { upper: b('upperarm01'), fore: b('lowerarm01'), twist: b('lowerarm02'), wrist: b('wrist') };
        const { upper, fore, wrist } = this.bones;
        this.lengths = [V3.Distance(upper.head, fore.head), V3.Distance(fore.head, wrist.head)];

        // Which of the body's corners are this arm, and which of those its hand.
        const { arrays } = lib.bodies.get(bodyName);
        const names = person.header.bones.map((bone) => bone.name);
        // Each corner belongs to the bone it hangs on most.
        const owner = Array.from({ length: person.header.vertexCount }, (_, i) => {
            let k = 0;
            for (let j = 1; j < 4; j++) if (arrays.weights[i * 4 + j] > arrays.weights[i * 4 + k]) k = j;
            return names[arrays.joints[i * 4 + k]];
        });
        const mine = (i, kinds) => owner[i].endsWith('.' + side) && kinds.test(owner[i]);
        const fromWrist = (i) => Math.hypot(arrays.position[i * 3] - wrist.head.x, arrays.position[i * 3 + 1] - wrist.head.y, arrays.position[i * 3 + 2] - wrist.head.z);
        const onArm = (i) => mine(i, /^lowerarm/), onHand = (i) => mine(i, /^(wrist|metacarpal|finger)/);
        this.meshes = [
            worn(person, 'glove' + side, (three) => three.every((i) => onHand(i) || (onArm(i) && fromWrist(i) < WORN.cuff)), WORN.glove, plain(person.scene, 'glove', NITRILE)),
        ];
        this.hold(hold);
        this.reach(null);
    }

    // Close the fingers the way one of HOLDS says.
    hold(name) {
        if (this.holding === name) return;
        this.holding = name;
        this.fingers = fingerPose(HOLDS[name], this.side);
        this._stand();
        this.grasp = this._grasp();
    }

    // Which way the handle of a tool lies in the hand when the wrist is
    // slack, for a tool whose point is at `point` of the world: the forearm
    // runs from where the elbow hangs to about there, and the hand goes on
    // from the forearm the way it was made. (The elbow is taken to stand out
    // from the body: cutting close in, a hand holds the handle off to its
    // own side, not back at its face.)
    slack(point) {
        const ahead = this.camera.getDirection(V3.Forward()), out = new V3(ahead.z, 0, -ahead.x).normalize().scale(this.side === 'R' ? SLACK_OUT : -SLACK_OUT);
        const { fore, wrist } = this.bones, elbow = this._shoulder().add(out).add(new V3(0, -this.lengths[0], 0)), turn = Q.Identity();
        Q.FromUnitVectorsToRef(this._out(wrist.head.subtract(fore.head).normalize()), point.subtract(elbow).normalize(), turn);
        return this._out(this.grasp.along).applyRotationQuaternion(turn);
    }

    // Every bone to its pose, the fingers closed and the arm as straight as
    // it was made, and the person standing where the eye is: facing the way
    // it looks, their shoulder where a shoulder would be.
    _stand() {
        const person = this.person, ahead = this.camera.getDirection(V3.Forward());
        // Posed again only when the fingers change: the whole skeleton goes through apply(), and reach() sets every bone
        // it moves (the arm's four) outright, so from one frame to the next nothing else would differ.
        if (person.pose !== this.fingers) person.apply(this.fingers, { ground: null });
        person.root.rotation.y = Math.atan2(ahead.x, ahead.z);
        person.root.position.copyFrom(this._shoulder().subtract(this._out(this.bones.upper.head)));
    }

    // Put the hand on a grip: { at, along, back } in the world, `along` the
    // way the handle runs from the grip toward the heel of the hand and
    // `back` the way the back of the tool faces. With null, take the arm away.
    // Given `elbow` (a point of the world), the elbow goes round to that side
    // of the line from shoulder to wrist at once, rather than easing round to
    // where it leaves the wrist straightest (a fist that has worked out its
    // own arm: fist.ts).
    reach(grip: { at: BABYLON.Vector3; along: BABYLON.Vector3; back: BABYLON.Vector3; elbow?: BABYLON.Vector3 } | null) {
        for (const mesh of this.meshes) mesh.setEnabled(!!grip);
        if (!grip) return;
        const person = this.person, { upper, fore, twist, wrist } = this.bones, [a, b] = this.lengths;
        this._stand();

        // From here on, in the person's own frame. The hand is turned so
        // its grasp lies on the grip, which says where the wrist is.
        const turned = this._in(grip.at, grip.along, grip.back);
        const hand = turned.rotation.multiply(Q.Inverse(this.grasp.rotation));
        let at = turned.at.subtract(this.grasp.at.subtract(wrist.head).applyRotationQuaternion(hand));
        // Too far to reach, and they lean in: the shoulder goes with it, and
        // it goes down as it goes forward, bending over the table (it does
        // not come up into the eye's way).
        const far = V3.Distance(at, upper.head), most = (a + b) * REACH;
        if (far > most) {
            const toward = at.subtract(upper.head), level = new V3(toward.x, 0, toward.z), over = new V3(0, -level.length() * LEANS, 0);
            // How far along that bend the shoulder has to go to bring the wrist within reach.
            const bend = level.add(over).normalize(), along = V3.Dot(toward, bend), off = toward.subtract(bend.scale(along)).length();
            const lean = bend.scale(Math.max(0, along - Math.sqrt(Math.max(0, most * most - off * off))));
            person.root.position.addInPlace(this._out(lean));
            at = at.subtract(lean);
        }

        // The elbow: the one place that is `a` from the shoulder and `b` from the wrist, on the side it hangs.
        const line = at.subtract(upper.head), reach = line.length(), toward = line.scale(1 / reach);
        const hangs = new V3(ELBOW_HANGS.out * (this.side === 'R' ? 1 : -1), -ELBOW_HANGS.down, ELBOW_HANGS.forward);
        const aside = hangs.subtract(toward.scale(V3.Dot(hangs, toward))).normalize();
        const near = (a * a + reach * reach - b * b) / (2 * reach), round = Math.sqrt(Math.max(0, a * a - near * near));
        const elbowAt = (turn) => upper.head.add(toward.scale(near)).add(aside.scale(Math.cos(turn) * round)).add(V3.Cross(toward, aside).scale(Math.sin(turn) * round));
        // (Where the forearm would run if the wrist were straight: the way the hand is turned, carried on up the arm.)
        let turn: number;
        if (grip.elbow) {
            const e = this._in(grip.elbow, V3.Right(), V3.Up()).at.subtract(upper.head.add(toward.scale(near)));
            turn = this.bent = Math.atan2(V3.Dot(e, V3.Cross(toward, aside)), V3.Dot(e, aside));
        } else turn = this._swing(elbowAt, at, wrist.head.subtract(fore.head).normalize().applyRotationQuaternion(hand));
        const elbow = elbowAt(turn);

        // The upper arm swings to point at it, the forearm bends on from there to the wrist.
        const swing = Q.Identity(), bend = Q.Identity();
        Q.FromUnitVectorsToRef(fore.head.subtract(upper.head).normalize(), elbow.subtract(upper.head).normalize(), swing);
        const lies = wrist.head.subtract(fore.head).normalize();
        Q.FromUnitVectorsToRef(lies.applyRotationQuaternion(swing), at.subtract(elbow).normalize(), bend);
        const forearm = bend.multiply(swing);
        // What is left over is the wrist's, except the part that is a turn
        // about the forearm itself: that is the two bones of the forearm
        // rolling over each other, from nothing at the elbow to all of it at
        // the wrist. Half is put on each of the forearm's two bones (all of it
        // on the second wrung the skin between them thin, like a sweet's
        // wrapper).
        const left = Q.Inverse(forearm).multiply(hand);
        const about = V3.Dot(new V3(left.x, left.y, left.z), lies);
        const roll = Math.hypot(about, left.w) < 1e-4 ? Q.Identity() : new Q(lies.x * about, lies.y * about, lies.z * about, left.w).normalize();
        const half = Q.Slerp(Q.Identity(), roll, 0.5);
        upper.bone.setRotationQuaternion(swing, BABYLON.Space.LOCAL);
        fore.bone.setRotationQuaternion(Q.Inverse(swing).multiply(forearm).multiply(half), BABYLON.Space.LOCAL);
        twist.bone.setRotationQuaternion(half, BABYLON.Space.LOCAL);
        wrist.bone.setRotationQuaternion(Q.Inverse(roll).multiply(left), BABYLON.Space.LOCAL);
    }

    // How far round the line from shoulder to wrist the elbow swings from
    // where it hangs (`elbowAt(turn)`, in the person's own frame): where the
    // forearm runs nearest to `forearm` (the way it would run with the wrist
    // straight), of the turns that keep the arm out of the body, off the
    // table and away from the eye; or, if none does, the one that comes
    // nearest to doing so.
    _swing(elbowAt, wrist, forearm) {
        const shoulder = this.bones.upper.head, world = (p) => this.person.root.position.add(this._out(p)), eye = this.camera.globalPosition;
        const room = (turn) => {
            const elbow = elbowAt(turn);
            let least = V3.Distance(world(elbow), eye) - KEEPS.eye + KEEPS.clear;
            for (const [from, to] of [[shoulder, elbow], [elbow, wrist]]) {
                for (const t of [0.35, 0.65, 1]) least = Math.min(least, this.clear(world(V3.Lerp(from, to, t))));
            }
            return least;
        };
        const was = this.bent || 0, straight = (turn) => V3.Dot(wrist.subtract(elbowAt(turn)).normalize(), forearm);
        let best = 0, most = -Infinity, chosen = null, truest = -Infinity;
        for (let turn = -KEEPS.most; turn <= KEEPS.most; turn += KEEPS.swings) {
            const has = this.clear ? room(turn) : KEEPS.clear;
            if (has >= KEEPS.clear) {
                const true_ = straight(turn);
                if (true_ > truest) { truest = true_; chosen = turn; }
            } else if (chosen === null && has > most) { most = has; best = turn; }
        }
        this.bent = was + ((chosen === null ? best : chosen) - was) * KEEPS.eases;
        return this.bent;
    }

    // Where the shoulder hangs in the world: `shift` from where it hangs square to the eye (m: out to its own side, up,
    // forward), as a body turned to bring one shoulder forward has it.
    _shoulder() {
        const ahead = this.camera.getDirection(V3.Forward()), level = new V3(ahead.x, 0, ahead.z).normalize();
        const right = new V3(level.z, 0, -level.x), sign = this.side === 'R' ? 1 : -1, s = this.shift;
        return this.camera.globalPosition.add(right.scale(sign * (SHOULDER.out + s.x))).add(level.scale(SHOULDER.forward + s.z)).add(new V3(0, s.y - SHOULDER.down, 0));
    }

    // A vector of the person's own frame, as it lies in the world.
    _out(v) {
        return v.applyRotationQuaternion(Q.RotationAxis(V3.Up(), this.person.root.rotation.y));
    }

    // A grip of the world in the person's own frame: where, and turned how.
    _in(at, along, back) {
        const home = Q.RotationAxis(V3.Up(), -this.person.root.rotation.y);
        const x = along.applyRotationQuaternion(home), y = back.applyRotationQuaternion(home);
        return { at: at.subtract(this.person.root.position).applyRotationQuaternion(home), rotation: Q.RotationQuaternionFromAxis(x, y, V3.Cross(x, y)) };
    }

    // Where a handle lies in the closed hand, with the arm as it was made:
    // held at the tips of the thumb and the first two fingers, and running
    // back from there over the web of the thumb, the index finger on top of
    // it. The bones run down the middle of the fingers, and a handle lies on
    // the skin: so it rests on the web, not in it, `WEB` metres out on the
    // back of the hand from the bones there. In the person's own frame.
    _grasp() {
        const person = this.person, here = (name, end) => this._in(person.joint(`${name}.${this.side}`, end), V3.Right(), V3.Up()).at;
        const thumb = here('finger1-3', 'tail'), index = here('finger2-3', 'tail'), middle = here('finger3-3', 'tail');
        const tips = thumb.add(index).add(middle).scale(1 / 3);
        // The back of the hand: away from where the last two fingers curl to.
        const knuckles = here('finger4-1', 'head').add(here('finger5-1', 'head')).scale(0.5), curled = here('finger4-3', 'tail').add(here('finger5-3', 'tail')).scale(0.5);
        const forward = knuckles.subtract(here('wrist', 'head')).normalize(), palm = curled.subtract(knuckles);
        const dorsal = palm.subtract(forward.scale(V3.Dot(palm, forward))).normalize().negate();
        const web = V3.Lerp(here('finger2-1', 'head'), here('finger1-2', 'head'), 0.35).add(dorsal.scale(WEB));
        const along = web.subtract(tips).normalize(), over = index.subtract(tips);
        const back = over.subtract(along.scale(V3.Dot(over, along))).normalize();
        return { at: tips, along, rotation: Q.RotationQuaternionFromAxis(along, back, V3.Cross(along, back)) };
    }
}
