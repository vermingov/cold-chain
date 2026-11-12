// A body's bones as rigid bodies in Havok: standing, it is the pose that moves
// them; fallen, they move the pose.
//
// Each segment of the body (pelvis, belly, chest, head, and every limb in
// halves) is one body in the physics world, joined to the next at the joint
// between them with the range of movement a real joint has. A long bone is two
// bodies locked together at its middle: when it breaks, the lock is let go
// and the limb bends where it broke, under its own weight.
//
// The people's skeletons have no bone in the middle of a femur, so one is put
// there (withMidBones) before a person is made, and the flesh of the lower half
// of the limb is given to it.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;
const AXIS = BABYLON.PhysicsConstraintAxis, LIMIT = BABYLON.PhysicsConstraintAxisLimitMode;
const MOTION = BABYLON.PhysicsMotionType;

// Long segments: their first bone, the twist bone that carries most of their flesh, and the bone at their far end.
const LONG = [['upperarm01', 'upperarm02', 'lowerarm01'], ['lowerarm01', 'lowerarm02', 'wrist'],
    ['upperleg01', 'upperleg02', 'lowerleg01'], ['lowerleg01', 'lowerleg02', 'foot']];
export const midOf = (first, side) => `mid-${first}.${side}`;
const BLEND = 0.08;         // of a segment's length, either side of its middle, over which the flesh is shared between the halves

// A copy of a person's file (person.ts's readPerson) with a bone in the middle of each long segment.
export function withMidBones({ header, arrays }) {
    const bones = header.bones.map((b) => ({ ...b }));
    const index = (name) => bones.findIndex((b) => b.name === name);
    const mids = [];
    for (const side of ['L', 'R']) {
        for (const [first, twist, next] of LONG) {
            const a = bones[index(`${first}.${side}`)], n = bones[index(`${next}.${side}`)];
            const at = index(`${twist}.${side}`);
            const head = a.head.map((v, i) => (v + n.head[i]) / 2);
            bones.splice(at + 1, 0, { name: midOf(first, side), parent: -1, head, tail: n.head });
            mids.push({ name: midOf(first, side), twist: `${twist}.${side}`, first: `${first}.${side}`, next: `${next}.${side}`, from: a.head, to: n.head });
        }
    }
    // Parents again by name, now that the order has changed.
    const old = header.bones;
    for (const b of bones) {
        if (b.name.startsWith('mid-')) b.parent = index(mids.find((m) => m.name === b.name).twist);
        else b.parent = b.parent >= 0 ? index(old[b.parent].name) : -1;
    }
    for (const m of mids) bones[index(m.next)].parent = index(m.name);

    // Each corner's bones by their new numbers, and the flesh past the middle of a long segment given to its mid bone.
    const remap = old.map((b) => index(b.name));
    const joints = new Uint16Array(arrays.joints.length), weights = new Uint8Array(arrays.weights);
    for (let i = 0; i < joints.length; i++) joints[i] = remap[arrays.joints[i]];
    const pos = arrays.position;
    const owners = new Map(mids.flatMap((m) => [[index(m.first), m], [index(m.twist), m]]));
    for (let v = 0; v < header.vertexCount; v++) {
        for (let k = 0; k < 4; k++) {
            const slot = v * 4 + k, m = owners.get(joints[slot]);
            if (!m || !weights[slot]) continue;
            const t = along(pos, v, m.from, m.to);
            const share = Math.min(1, Math.max(0, (t - 0.5 + BLEND) / (2 * BLEND)));
            if (share <= 0) continue;
            const free = [0, 1, 2, 3].map((j) => v * 4 + j).find((s) => !weights[s]);
            if (share >= 1 || free === undefined) {
                if (share >= 0.5 || free === undefined) joints[slot] = index(m.name);
                continue;
            }
            const moved = Math.round(weights[slot] * share);
            weights[slot] -= moved;
            joints[free] = index(m.name);
            weights[free] = moved;
        }
    }
    return { header: { ...header, bones }, arrays: { ...arrays, joints, weights } };
}

// How far along from `a` to `b` corner `v` of `pos` lies, 0 at a and 1 at b.
function along(pos, v, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    return ((pos[v * 3] - a[0]) * dx + (pos[v * 3 + 1] - a[1]) * dy + (pos[v * 3 + 2] - a[2]) * dz) / (dx * dx + dy * dy + dz * dz);
}

// --- the segments ----------------------------------------------------------------
//
// name, the bone that leads it, its share of the body's weight, its shape, and the joint to its parent: the parent
// segment, how far it twists about its own length, how far it bends about the joint's hinge (forward is positive
// for a hip, back for a knee), and how far it swings across that. Radians; `hinge` names the hinge's axis.

const SEGMENTS = (s) => {
    const side = s === 'L' ? -1 : 1;
    return [
        [`upperarm${s}`, `upperarm01.${s}`, 0.014, 'capsule', ['chest', [-1.2, 1.2], [-1.3, 2.6], [-1.6, 1.4], 'x']],
        [`upperarm2${s}`, midOf('upperarm01', s), 0.013, 'capsule', [`upperarm${s}`, 'lock']],
        [`forearm${s}`, `lowerarm01.${s}`, 0.009, 'capsule', [`upperarm2${s}`, [-0.9, 0.9], [-2.5, 0.05], [-0.08, 0.08], 'elbow']],
        [`forearm2${s}`, midOf('lowerarm01', s), 0.008, 'capsule', [`forearm${s}`, 'lock']],
        [`hand${s}`, `wrist.${s}`, 0.006, 'box', [`forearm2${s}`, [-0.25, 0.25], [-1.2, 1.2], [-0.45, 0.45], 'elbow']],
        [`thigh${s}`, `upperleg01.${s}`, 0.06, 'capsule', ['pelvis', [-0.6, 0.6], [-0.35, 2.1], [-0.9 * side, 0.45 * side].sort((a, b) => a - b), 'x']],
        [`thigh2${s}`, midOf('upperleg01', s), 0.05, 'capsule', [`thigh${s}`, 'lock']],
        [`shin${s}`, `lowerleg01.${s}`, 0.023, 'capsule', [`thigh2${s}`, [-0.12, 0.12], [-2.4, 0.03], [-0.06, 0.06], 'x']],
        [`shin2${s}`, midOf('lowerleg01', s), 0.02, 'capsule', [`shin${s}`, 'lock']],
        [`foot${s}`, `foot.${s}`, 0.014, 'box', [`shin2${s}`, [-0.25, 0.25], [-0.8, 0.6], [-0.3, 0.3], 'x']],
    ];
};
const TRUNK = [
    ['pelvis', 'root', 0.14, 'box', null],
    ['belly', 'spine03', 0.12, 'box', ['pelvis', [-0.35, 0.35], [-0.45, 0.7], [-0.35, 0.35], 'x']],
    ['chest', 'spine01', 0.22, 'box', ['belly', [-0.35, 0.35], [-0.35, 0.5], [-0.3, 0.3], 'x']],
    ['head', 'neck01', 0.08, 'sphere', ['chest', [-1.1, 1.1], [-0.8, 0.9], [-0.6, 0.6], 'x']],
];
const ALL: any[] = [...TRUNK, ...SEGMENTS('L'), ...SEGMENTS('R')];

const FORWARD = new V3(0, 0, 1);
const WORLD = 1;                // collision bits: the room and loose things
const BODIES = 2;               // every person's segments; each person also has one bit of their own (4 and up)
const THIN = 0.82;              // a segment's shape is this much of the flesh round its bone: the rest is give
const TONE = { alive: 18, out: 5, dead: 1.2 };      // Nm of resistance in every joint: muscle with a mind behind it, without, and none

export class Ragdoll {
    declare person: any;
    declare scene: BABYLON.Scene;
    declare segments: any[];
    declare byName: Map<string, any>;
    declare limp: boolean;
    declare between: any[];
    declare tone: number;
    declare _qWorld: BABYLON.Quaternion;

    // `person` is made from withMidBones' data; `mass` in kg; `bit` this person's own collision bit (4 and up).
    constructor(person, { mass = 75, bit = 4 } = {}) {
        this.person = person;
        this.scene = person.scene;
        this.limp = false;
        this.tone = TONE.alive;
        this._qWorld = new Q();
        const { byName } = person;
        const leads = new Map(ALL.map(([name, bone]) => [bone, name]));
        // Which segment each bone's flesh moves with: its own, or the nearest it hangs from.
        const segmentOf = new Map();
        for (const b of person.header.bones) {
            let at = b;
            while (at && !leads.has(at.name)) at = at.parent >= 0 ? person.header.bones[at.parent] : null;
            segmentOf.set(b.name, at ? leads.get(at.name) : 'pelvis');
        }
        const flesh = this._flesh(segmentOf);

        this.segments = [];
        this.byName = new Map();
        for (const [name, bone, share, shape, joint] of ALL) {
            const node = new BABYLON.TransformNode('rd_' + name, this.scene);
            node.rotationQuaternion = Q.Identity();
            const head = byName[bone].head;
            const seg = { name, bone, node, head, joint, shape: null, body: null, constraint: null, broken: false, mass: mass * share,
                prev: new V3(), prevQ: new Q(), points: flesh.get(name) || [] };
            seg.shape = this._shape(seg, shape, byName);
            seg.shape.filterMembershipMask = BODIES | bit;
            seg.shape.filterCollideMask = ~bit;
            seg.shape.material = { friction: 0.75, restitution: 0.02 };
            this.segments.push(seg);
            this.byName.set(name, seg);
        }
        // The bones that lie between one segment's bone and the next (spine04 between pelvis and belly): straight while fallen.
        const isLead = new Set(ALL.map(([, bone]) => bone));
        this.between = [];
        for (const b of person.header.bones) {
            if (isLead.has(b.name) || /finger|toe|eye|jaw|tongue|orbic|levator|risor|oris|temporal|special|cheek|nose|brow|lip|mouth|labi|mental|masseter/.test(b.name)) continue;
            this.between.push(byName[b.name].bone);
        }
        this.pose();
        for (const seg of this.segments) {
            seg.body = new BABYLON.PhysicsBody(seg.node, MOTION.ANIMATED, false, this.scene);
            seg.body.shape = seg.shape;
            seg.body.setMassProperties({ mass: seg.mass });
            seg.body.setLinearDamping(0.08);
            seg.body.setAngularDamping(0.6);
        }
        for (const seg of this.segments) if (seg.joint) this._join(seg);
    }

    // The rest-space corners of the skin that move with each segment, for its shape.
    _flesh(segmentOf) {
        const { header, arrays } = this.person.lib.bodies.get(this.person.bodyName);
        const out = new Map();
        const skin = header.parts.filter((p) => p.kind === 'skin');
        const names = header.bones.map((b) => b.name);
        for (const part of skin) {
            for (let v = part.vertexStart; v < part.vertexStart + part.vertexCount; v++) {
                let best = 0, bone = 0;
                for (let k = 0; k < 4; k++) if (arrays.weights[v * 4 + k] > best) { best = arrays.weights[v * 4 + k]; bone = arrays.joints[v * 4 + k]; }
                const seg = segmentOf.get(names[bone]);
                if (!out.has(seg)) out.set(seg, []);
                out.get(seg).push(new V3(arrays.position[v * 3], arrays.position[v * 3 + 1], arrays.position[v * 3 + 2]));
            }
        }
        return out;
    }

    // The segment's shape in its own frame, whose origin is its bone's head and whose axes are the body's at rest.
    _shape(seg, kind, byName) {
        const pts = seg.points.map((p) => p.subtract(seg.head));
        const end = this._end(seg, byName);
        if (kind === 'capsule') {
            const axis = end.normalizeToNew(), length = end.length();
            const distances = pts.map((p) => {
                const t = Math.max(0, Math.min(length, V3.Dot(p, axis)));
                return p.subtract(axis.scale(t)).length();
            }).sort((a, b) => a - b);
            const r = Math.max(0.025, distances[Math.floor(distances.length * 0.5)] * THIN);
            seg.radius = r;
            seg.end = end;
            return new BABYLON.PhysicsShapeCapsule(axis.scale(Math.min(r, length / 2)), axis.scale(Math.max(length - r, length / 2)), r, this.scene);
        }
        const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity);
        for (const p of pts) { lo.minimizeInPlace(p); hi.maximizeInPlace(p); }
        const centre = lo.add(hi).scale(0.5), size = hi.subtract(lo);
        seg.end = end;
        if (kind === 'sphere') {
            seg.radius = Math.min(size.x, size.z) * 0.5 * THIN;
            return new BABYLON.PhysicsShapeSphere(new V3(centre.x, centre.y + 0.04, centre.z), seg.radius, this.scene);
        }
        seg.radius = Math.min(size.x, size.z) * 0.5 * THIN;
        return new BABYLON.PhysicsShapeBox(centre, Q.Identity(), new V3(size.x * THIN, size.y * 0.92, size.z * THIN), this.scene);
    }

    // From a segment's bone head to its far end, in rest space.
    _end(seg, byName) {
        const next = { upperarm: 'upperarm2', upperarm2: 'forearm', forearm: 'forearm2', forearm2: 'hand', thigh: 'thigh2', thigh2: 'shin', shin: 'shin2', shin2: 'foot' };
        const m = /^([a-z]+\d?)([LR])$/.exec(seg.name);
        if (m && next[m[1]]) {
            const to = ALL.find(([n]) => n === next[m[1]] + m[2]);
            return byName[to[1]].head.subtract(seg.head);
        }
        return byName[this.person.header.bones.find((b) => b.name === seg.bone).name].tail.subtract(seg.head);
    }

    // The joint between a segment and its parent, at the segment's bone head.
    _join(seg) {
        const [parentName, ...spec] = seg.joint;
        const parent = this.byName.get(parentName);
        const twist = seg.end.normalizeToNew();
        let hinge = spec[3] === 'elbow' ? V3.Cross(twist, FORWARD).normalize() : new V3(1, 0, 0);
        hinge = hinge.subtract(twist.scale(V3.Dot(hinge, twist))).normalize();
        const params = { pivotA: seg.head.subtract(parent.head), pivotB: V3.Zero(), axisA: twist, axisB: twist, perpAxisA: hinge, perpAxisB: hinge, collision: false };
        const lock = spec[0] === 'lock';
        const limits = [{ axis: AXIS.LINEAR_DISTANCE, minLimit: 0, maxLimit: 0 }];
        if (lock) limits.push({ axis: AXIS.ANGULAR_X, minLimit: 0, maxLimit: 0 }, { axis: AXIS.ANGULAR_Y, minLimit: 0, maxLimit: 0 }, { axis: AXIS.ANGULAR_Z, minLimit: 0, maxLimit: 0 });
        else limits.push({ axis: AXIS.ANGULAR_X, minLimit: spec[0][0], maxLimit: spec[0][1] }, { axis: AXIS.ANGULAR_Y, minLimit: spec[1][0], maxLimit: spec[1][1] },
            { axis: AXIS.ANGULAR_Z, minLimit: spec[2][0], maxLimit: spec[2][1] });
        seg.constraint = new BABYLON.Physics6DoFConstraint(params, limits, this.scene);
        parent.body.addConstraint(seg.body, seg.constraint);
        seg.locked = lock;
    }

    // --- standing: the pose leads ----------------------------------------------------

    // Every segment's body put where its bone is now. Called after the person is posed, every frame they stand.
    pose() {
        const { person } = this;
        person.skeleton.computeAbsoluteMatrices(true);
        person._sync();
        const world = person.mesh.getWorldMatrix();
        const m = new BABYLON.Matrix(), scale = new V3(), q = new Q(), t = new V3();
        for (const seg of this.segments) {
            person.byName[seg.bone].bone.getAbsoluteMatrix().multiplyToRef(world, m);
            m.decompose(scale, q, t);
            seg.prev.copyFrom(seg.node.position);
            seg.prevQ.copyFrom(seg.node.rotationQuaternion);
            if (seg.body) seg.body.setTargetTransform(t, q);
            else { seg.node.position.copyFrom(t); seg.node.rotationQuaternion.copyFrom(q); }
        }
    }

    // --- fallen: the bodies lead -----------------------------------------------------

    // Let go: every segment falls under its own weight, moving as it was moving.
    fall(dt = 1 / 60) {
        if (this.limp) return;
        this.limp = true;
        for (const seg of this.segments) {
            const v = seg.node.position.subtract(seg.prev).scaleInPlace(1 / dt);
            seg.body.setMotionType(MOTION.DYNAMIC);
            seg.body.setLinearVelocity(v.length() < 6 ? v : V3.Zero());
            seg.body.setAngularVelocity(V3.Zero());
        }
        this.setTone(this.tone);
        for (const b of this.between) b.setRotationQuaternion(Q.Identity(), BABYLON.Space.LOCAL);
    }

    // How much the muscles hold the joints: 'alive', 'out' (unconscious) or 'dead'.
    setTone(state) {
        this.tone = typeof state === 'number' ? state : TONE[state];
        if (!this.limp) return;
        for (const seg of this.segments) {
            if (!seg.constraint || seg.locked) continue;
            for (const axis of [AXIS.ANGULAR_X, AXIS.ANGULAR_Y, AXIS.ANGULAR_Z]) seg.constraint.setAxisFriction(axis, this.tone * seg.mass / 6);
        }
    }

    // The long bone of a segment broken at its middle: the two halves are held only by flesh.
    breakAt(name) {
        const seg = this.byName.get(name + '2') ?? this.byName.get(name);
        if (!seg || !seg.locked || seg.broken) return false;
        seg.broken = true;
        seg.locked = false;
        const c = seg.constraint;
        for (const [axis, lo, hi] of [[AXIS.ANGULAR_X, -0.6, 0.6], [AXIS.ANGULAR_Y, -1.4, 1.4], [AXIS.ANGULAR_Z, -1.1, 1.1]]) {
            c.setAxisMode(axis, LIMIT.LIMITED);
            c.setAxisMinLimit(axis, lo);
            c.setAxisMaxLimit(axis, hi);
            c.setAxisFriction(axis, 0.4);
        }
        return true;
    }

    // The bones put where the bodies are. Called every frame once fallen.
    drive() {
        const { person } = this;
        person._sync();
        const world = person.mesh.getWorldMatrix();
        world.decompose(undefined, this._qWorld, undefined);
        const inverse = Q.Inverse(this._qWorld);
        const abs = new Map();
        for (const seg of this.segments) abs.set(seg.name, inverse.multiply(seg.node.rotationQuaternion));
        for (const seg of this.segments) {
            const bone = person.byName[seg.bone].bone;
            if (!seg.joint) {
                const local = V3.TransformCoordinates(seg.node.position, world.clone().invert());
                bone.setPosition(local, BABYLON.Space.LOCAL);
                bone.setRotationQuaternion(abs.get(seg.name), BABYLON.Space.LOCAL);
                continue;
            }
            const parentAbs = abs.get(seg.joint[0]);
            bone.setRotationQuaternion(Q.Inverse(parentAbs).multiply(abs.get(seg.name)), BABYLON.Space.LOCAL);
        }
    }

    // A blow: `impulse` (N s, world) at `at` (world) on the segment named.
    push(name, impulse, at) {
        const seg = this.byName.get(name);
        if (seg && this.limp) seg.body.applyImpulse(impulse, at);
    }

    // The segment whose shape is nearest a world point, and how far it is.
    nearest(at) {
        let best = null, d = Infinity;
        for (const seg of this.segments) {
            const e = this.segmentEnds(seg);
            const t = Math.max(0, Math.min(1, V3.Dot(at.subtract(e[0]), e[1].subtract(e[0])) / Math.max(1e-6, V3.DistanceSquared(e[0], e[1]))));
            const dist = V3.Distance(at, V3.Lerp(e[0], e[1], t)) - seg.radius;
            if (dist < d) { d = dist; best = seg; }
        }
        return { seg: best, distance: d };
    }

    // A segment's two ends in the world, from its body.
    segmentEnds(seg) {
        const m = seg.node.computeWorldMatrix(true);
        return [seg.node.position.clone(), V3.TransformCoordinates(seg.end, m)];
    }

    // Where the body as a whole is: the middle of its pelvis.
    get centre() { return this.byName.get('pelvis').node.position; }

    dispose() {
        for (const seg of this.segments) {
            seg.constraint?.dispose();
            seg.body?.dispose();
            seg.shape?.dispose();
            seg.node.dispose();
        }
    }
}

export { WORLD, BODIES };
