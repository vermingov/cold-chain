// A body's bones as rigid bodies in Havok, always: muscles (motor.ts) hold
// them in a pose, and what the muscles cannot hold, gravity and blows move.
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
// name, the bone that leads it, its share of the body's weight, its shape, and the joint to its parent. A joint is
// given the way a physiotherapist measures one, in degrees from the rest pose: `bend` is the pose control (person.ts)
// that bends it and how far either way, `side` the control that swings it out of that plane (null where none does, as
// in a knee) and how far, `twist` how far it turns about the limb's own length, `hinge` the line it bends about
// (across the body, 'x', or across the limb and the way the body faces, 'elbow'), and `muscle` the most the muscles
// across it turn it with, in N m. Which way each control turns the joint is read off the skeleton (_join), not
// written down here: a sign typed by hand once let every knee bend forward. `neutral` is where a joint's range is
// measured from when that is not the rest pose: the shoulder's from the arm hanging, not held out as the model stands.

const J = (parent, hinge, bend, side, twist, muscle, neutral = []) => ({ parent, hinge, bend, side, twist, muscle, neutral });
const LOCK = (parent, hinge) => ({ parent, hinge, lock: true });

const SEGMENTS = (s) => [
    // (In across the body as far as the shoulder blade sliding forward takes it, which this has no bone for: a hand
    // reaching the other arm needs it.)
    [`upperarm${s}`, `upperarm01.${s}`, 0.014, 'capsule', J('chest', 'x', [`shoulderFlex${s}`, -60, 175], [`shoulderAbduct${s}`, -50, 165], 85, 110,
        [[`shoulderAbduct${s}`, -36], [`shoulderFlex${s}`, -26]])],
    [`upperarm2${s}`, midOf('upperarm01', s), 0.013, 'capsule', LOCK(`upperarm${s}`, 'x')],
    [`forearm${s}`, `lowerarm01.${s}`, 0.009, 'capsule', J(`upperarm2${s}`, 'elbow', [`elbow${s}`, -6, 150], [null, -5, 5], 15, 80)],
    [`forearm2${s}`, midOf('lowerarm01', s), 0.008, 'capsule', LOCK(`forearm${s}`, 'elbow')],
    [`hand${s}`, `wrist.${s}`, 0.006, 'box', J(`forearm2${s}`, 'elbow', [`wrist${s}`, -75, 75], [null, -25, 25], 70, 25)],
    [`thigh${s}`, `upperleg01.${s}`, 0.06, 'capsule', J('pelvis', 'x', [`hipFlex${s}`, -30, 125], [`hipAbduct${s}`, -30, 50], 40, 320)],
    [`thigh2${s}`, midOf('upperleg01', s), 0.05, 'capsule', LOCK(`thigh${s}`, 'x')],
    [`shin${s}`, `lowerleg01.${s}`, 0.023, 'capsule', J(`thigh2${s}`, 'x', [`knee${s}`, -6, 150], [null, -4, 4], 8, 280)],
    [`shin2${s}`, midOf('lowerleg01', s), 0.02, 'capsule', LOCK(`shin${s}`, 'x')],
    [`foot${s}`, `foot.${s}`, 0.014, 'box', J(`shin2${s}`, 'x', [`ankle${s}`, -50, 25], [null, -10, 10], 22, 200)],
];
const TRUNK_SEGMENTS = [
    ['pelvis', 'root', 0.14, 'box', null],
    ['belly', 'spine03', 0.12, 'box', J('pelvis', 'x', ['spineFlex', -25, 45], ['spineSide', -25, 25], 20, 300)],
    ['chest', 'spine01', 0.22, 'box', J('belly', 'x', ['spineFlex', -20, 40], ['spineSide', -25, 25], 30, 260)],
    ['head', 'neck01', 0.08, 'sphere', J('chest', 'x', ['neckFlex', -55, 70], ['headTilt', -40, 40], 75, 60)],
];
const ALL: any[] = [...TRUNK_SEGMENTS, ...SEGMENTS('L'), ...SEGMENTS('R')];
const TRUNK_NAMES = new Set(TRUNK_SEGMENTS.map(([name]) => name));
// The halves of the arms and legs at the trunk.
const ROOT = /^(upperarm|thigh)[LR]$/;
// Where a turn of the spine or neck is spread over every bone of it on screen, so a bow is a curve.
const SPREAD = new Set(['belly', 'chest', 'head']);
// A joint's three axes in Havok's order: the hinge it bends about, the limb's own length, and across both.
const ANGULAR = [AXIS.ANGULAR_X, AXIS.ANGULAR_Y, AXIS.ANGULAR_Z];
const RAD = Math.PI / 180;

const FORWARD = new V3(0, 0, 1);
// Collision bits. A person's own segments meet each other as they would anyone else's (a hand on the belly, one knee on
// the other, an arm against the chest or across the other), all but neighbours at a joint, whose constraint leaves them
// be (Havok's per-pair switch, `collision: false`; for both halves of the long bones either side of an elbow or a knee,
// _apart). The shapes are fitted so that no other pair meets standing at rest
// (_shape: the upper arm off the shoulder's bulge, the belly's box below the chest's). Each person has a bit of their
// own above these, which is what tells their own segments from anyone else's; the kinds are for pieces cut off (_cut).
const WORLD = 1;                // the room and loose things
const TRUNK = 2;                // pelvis, belly, chest, head
const ROOTS = 4;                // upper arms and thighs, their halves at the trunk
const LIMBS = 8;                // the rest of the arms and legs
// A segment's shape is this much of the outside of what it carries, flesh and clothes: the rest is give. (Fitted to the
// middle of the skin at four fifths of it, a body lying down had its back, its trousers and its shoe soles 4 to 8 cm
// into the floor, and a hand on the belly sank into the shirt.)
const THIN = 0.95;
const GARMENT = 0.015;          // m: the most a segment's shape is grown for the clothes over it
const TONE = { alive: 18, out: 5, dead: 1.2 };      // Nm of resistance in every joint: muscle with a mind behind it, without, and none
// A muscle as a spring (hold): N m per radian off its aim for each N m it has (all of it at a fifth of a radian off), and
// its damping, of critical for what the joint swings (`swing`, kg m2, everything past the joint about it).
const STIFF = 5, DAMP = 0.8;
const AXIS_SHARE = [1, 0.6, 0.8];   // hinge, twist, side: the muscle across each
// A broken shaft's two ends grating on each other in the flesh, N m per kg the far half weighs: it hangs and swings at
// the break, catching a little, whatever the muscles above are doing (the tone is the joints', not the break's).
const GRATE = 1.2;

// A turn `q` (in a joint's parent's frame) as the joint's three angles. Havok's 6DoF joint reads a turn as about its
// first axis, then its second, then its third, each about the axis as already turned (measured: a motor target of
// (x, y, z) settles at Rx(x) Ry(y) Rz(z) to five places), so the second angle is the one that runs out at 90 degrees,
// and a joint's big bend is put on the first.
export function jointAngles(q: BABYLON.Quaternion, frame: BABYLON.Vector3[], out: number[]) {
    const [a, b, c] = frame;
    const x = q.x * a.x + q.y * a.y + q.z * a.z, y = q.x * b.x + q.y * b.y + q.z * b.z, z = q.x * c.x + q.y * c.y + q.z * c.z, w = q.w;
    out[0] = Math.atan2(-2 * (y * z - x * w), 1 - 2 * (x * x + y * y));
    out[1] = Math.asin(Math.max(-1, Math.min(1, 2 * (x * z + y * w))));
    out[2] = Math.atan2(-2 * (x * y - z * w), 1 - 2 * (y * y + z * z));
    return out;
}

const _v = new V3(), _q = new Q(), _q2 = new Q(), _I = Q.Identity();
const _p = new V3(), _qp = new Q();

export class Ragdoll {
    declare person: any;
    declare scene: BABYLON.Scene;
    declare segments: any[];
    declare byName: Map<string, any>;
    declare limp: boolean;
    declare between: any[];
    declare tone: number;
    declare mass: number;
    declare _qWorld: BABYLON.Quaternion;
    declare _inv: BABYLON.Matrix;
    declare _moved: BABYLON.Observer<BABYLON.Scene>;
    declare attached: any[];
    declare _cuts: any[];
    declare _apart: BABYLON.Physics6DoFConstraint[];

    // `person` is made from withMidBones' data; `mass` in kg; `bit` this person's own collision bit (8 and up, one bit).
    constructor(person, { mass = 75, bit = 8 } = {}) {
        this.person = person;
        this.scene = person.scene;
        this.limp = false;
        this.tone = TONE.alive;
        this.mass = mass;
        this._qWorld = new Q();
        this._inv = new BABYLON.Matrix();
        const { byName } = person;
        const bones = person.header.bones;
        const leads = new Map(ALL.map(([name, bone]) => [bone, name]));
        // Which segment each bone's flesh moves with: its own, or the nearest it hangs from.
        const segmentOf = new Map();
        for (const b of bones) {
            let at = b;
            while (at && !leads.has(at.name)) at = at.parent >= 0 ? bones[at.parent] : null;
            segmentOf.set(b.name, at ? leads.get(at.name) : 'pelvis');
        }
        const flesh = this._flesh(segmentOf), clothes = this._flesh(segmentOf, 'cloth');
        // (sandbox.ts hands out bits from 8 up; ours start one higher, past LIMBS.)
        const own = bit << 1;

        this.segments = [];
        this.byName = new Map();
        for (const [name, bone, share, shape, joint] of ALL) {
            const node = new BABYLON.TransformNode('rd_' + name, this.scene);
            node.rotationQuaternion = Q.Identity();
            const head = byName[bone].head;
            const limb = !TRUNK_NAMES.has(name) && !ROOT.test(name);
            const seg = { name, bone, node, head, joint, limb, shape: null, body: null, constraint: null, parent: null, broken: false, locked: false, mass: mass * share,
                points: flesh.get(name) || [], clothes: clothes.get(name) || [], abs: new Q(), chain: [], spread: [], frame: null, unneutral: Q.Identity(), lo: [0, 0, 0], hi: [0, 0, 0], muscle: joint?.muscle ?? 0,
                motor: { on: false, made: false, f: -1, t: [NaN, NaN, NaN] } };
            seg.shape = this._shape(seg, shape, byName);
            const kind = TRUNK_NAMES.has(name) ? TRUNK : limb ? LIMBS : ROOTS;
            seg.shape.filterMembershipMask = kind | own;
            seg.shape.filterCollideMask = ~own;
            seg.shape.material = { friction: 0.75, restitution: 0.02 };
            this.segments.push(seg);
            this.byName.set(name, seg);
        }
        for (const seg of this.segments) if (seg.joint) seg.parent = this.byName.get(seg.joint.parent);
        // What each joint swings: everything past it, about it, as the body stands at rest.
        for (const seg of this.segments) {
            seg.swing = 0.002;
            for (const d of this.segments) {
                let at = d;
                while (at && at !== seg) at = at.parent;
                if (at) seg.swing += d.mass * V3.DistanceSquared(d.head.add(d.centre), seg.head);
            }
        }
        this.attached = this.segments;
        this._cuts = [];
        this._chains();
        // The bones that lie between one segment's bone and the next (spine04 between pelvis and belly): drive() turns
        // the ones it spreads a bend over and leaves the rest straight.
        const isLead = new Set(ALL.map(([, bone]) => bone));
        this.between = [];
        for (const b of bones) {
            if (isLead.has(b.name) || /finger|metacarpal|toe|eye|jaw|tongue|orbic|levator|risor|oris|temporal|special|cheek|nose|brow|lip|mouth|labi|mental|masseter/.test(b.name)) continue;
            this.between.push(byName[b.name].bone);
        }
        this._place();
        for (const seg of this.segments) {
            seg.body = new BABYLON.PhysicsBody(seg.node, MOTION.DYNAMIC, false, this.scene);
            seg.body.shape = seg.shape;
            // Mass given alone keeps the turning inertia of the shape at Havok's own density, which made a 1 kg hand
            // as hard to spin as a block of lead; the inertia is scaled with the mass.
            const own = seg.body.computeMassProperties();
            // Hands and feet are given three times their turning inertia: at their own, a 1 kg foot under a 70 kg body
            // was spun by every correction the solver made and dragged the joints above it loose.
            const spin = /^(hand|foot)/.test(seg.name) ? 3 : 1;
            seg.body.setMassProperties({ mass: seg.mass, centerOfMass: own.centerOfMass, inertia: own.inertia.scale(spin * seg.mass / own.mass), inertiaOrientation: own.inertiaOrientation });
            seg.body.setLinearDamping(0.05);
            seg.body.setAngularDamping(0.5);
        }
        for (const seg of this.segments) if (seg.joint) this._join(seg);
        // A long bone is two bodies (withMidBones), so the two halves of an upper arm and of a forearm are not all joined
        // to each other at the elbow, though the bones are: an elbow or a knee bent far put the far half of one into the
        // near half of the other, and the joint's limit and the contact fought. These are kept apart the way the joints
        // keep theirs (a constraint that holds nothing, collision off: Havok's per-pair switch). The shoulder and hip are
        // not: the halves of an upper arm or thigh meet the trunk, which is what keeps an arm out of the chest.
        this._apart = [];
        for (const s of ['L', 'R']) {
            for (const [a, b] of [['upperarm', 'forearm'], ['upperarm', 'forearm2'], ['upperarm2', 'forearm2'], ['forearm', 'hand'],
                ['thigh', 'shin'], ['thigh', 'shin2'], ['thigh2', 'shin2'], ['shin', 'foot']]) {
                const c = new BABYLON.Physics6DoFConstraint({ pivotA: V3.Zero(), pivotB: V3.Zero(), collision: false }, [], this.scene);
                this.byName.get(a + s).body.addConstraint(this.byName.get(b + s).body, c);
                this._apart.push(c);
            }
        }
        for (const b of this.between) b.setRotationQuaternion(Q.Identity(), BABYLON.Space.LOCAL);
        this.setTone('alive');
        // The skeleton put where the bodies are as soon as they have moved, before the picture is drawn: following them
        // only in the next frame's update, a body was drawn where it had been a frame before, a head falling at 6 m/s
        // 10 cm above its body and, the frame it landed, through the floor.
        this._moved = this.scene.onAfterPhysicsObservable.add(() => this.drive());
    }

    // The rest-space corners of the skin (or, `kind` 'cloth', the clothes) that move with each segment, for its shape.
    _flesh(segmentOf, kind = 'skin') {
        const { header, arrays } = this.person.lib.bodies.get(this.person.bodyName);
        const out = new Map();
        const skin = header.parts.filter((p) => p.kind === kind);
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
        const pts = seg.points.map((p) => p.subtract(seg.head)), cloth = seg.clothes.map((p) => p.subtract(seg.head));
        const end = this._end(seg, byName);
        seg.end = end;
        if (kind === 'capsule') {
            const axis = end.normalizeToNew(), length = end.length();
            const out = (list) => list.map((p) => {
                const t = Math.max(0, Math.min(length, V3.Dot(p, axis)));
                return p.subtract(axis.scale(t)).length();
            }).sort((a, b) => a - b);
            // (An upper arm's half at the shoulder carries the shoulder's cap and the armpit's skin, which are the trunk's
            // to stand off: fitted to them, it stood 3 to 4 cm into the side of the belly with the arm hanging. Its arm is
            // what lies past the first third.)
            const arm = /^upperarm[LR]$/.test(seg.name), own = (p) => !arm || V3.Dot(p, axis) > length / 3;
            const skin = out(pts.filter(own)), worn = out(cloth.filter(own)), at = (list, f) => list[Math.floor((list.length - 1) * f)];
            // Most of the way out, not all of it (a fold or a cuff standing off is not what the limb rests on), and what is
            // worn over it as far as it fits close: a baggy sleeve or a hoodie's hem is not something to stand on.
            const over = worn.length ? Math.max(0, Math.min(GARMENT, at(worn, 0.5) - at(skin, 0.5))) : 0;
            // (A thigh's half at the hip carries the buttock, well off the bone: taken all the way out, the thighs stood
            // pressed into each other.)
            const r = Math.max(0.025, (at(skin, arm ? 0.5 : ROOT.test(seg.name) ? 0.7 : 0.9) + over) * THIN);
            seg.radius = r;
            seg.geo = { kind, a: axis.scale(Math.min(r, length / 2)), b: axis.scale(Math.max(length - r, length / 2)), r };
            seg.centre = end.scale(0.5);
            return new BABYLON.PhysicsShapeCapsule(seg.geo.a, seg.geo.b, r, this.scene);
        }
        // Its box, leaving out the outermost few corners each way (a collar, a hood's peak), but for a foot, whose shoe's
        // sole and toe are what it stands and lies on.
        // Then out over what is worn on it, as far as a close fit goes (a shoe's sole and toe all the way).
        const foot = seg.name.startsWith('foot'), edge = foot ? 0 : 0.02, fit = foot ? 0.05 : GARMENT;
        const cut = (list, k, f) => list.map((p) => p[k]).sort((a, b) => a - b)[Math.floor((list.length - 1) * f)];
        const lo = new V3(), hi = new V3();
        for (const k of ['x', 'y', 'z']) {
            lo[k] = cut(pts, k, edge);
            hi[k] = cut(pts, k, 1 - edge);
            if (!cloth.length) continue;
            lo[k] = Math.max(lo[k] - fit, Math.min(lo[k], cut(cloth, k, edge)));
            hi[k] = Math.min(hi[k] + fit, Math.max(hi[k], cut(cloth, k, 1 - edge)));
        }
        // A trunk box ends where the next one up begins: the belly's flesh reaches up the flanks past the chest's bone, and
        // its box, square, stood out there into the upper arms hanging beside the ribs.
        const next = { pelvis: 'belly', belly: 'chest' }[seg.name];
        if (next) hi.y = Math.min(hi.y, byName[ALL.find(([n]) => n === next)[1]].head.y - seg.head.y);
        const centre = lo.add(hi).scale(0.5), size = hi.subtract(lo);
        if (kind === 'sphere') {
            // The skull, from the corners above where the head sits on the neck, round the middle of them. (Fitted to the
            // whole of head and neck, it sat low and the back of a head lying on the floor went 11 cm into it.)
            const above = byName.head.head.y - seg.head.y;
            const skull = pts.filter((p) => p.y > above);
            const mid = skull.reduce((a, p) => a.addInPlace(p), new V3()).scaleInPlace(1 / skull.length);
            const reach = skull.map((p) => V3.Distance(p, mid)).sort((a, b) => a - b);
            seg.radius = reach[Math.floor(reach.length * 0.75)] * THIN;
            seg.centre = mid;
            seg.geo = { kind, c: seg.centre, r: seg.radius };
            return new BABYLON.PhysicsShapeSphere(seg.centre, seg.radius, this.scene);
        }
        if (seg.name.startsWith('hand')) return this._hand(seg, pts);
        seg.radius = Math.min(size.x, size.z) * 0.5 * THIN;
        const extent = new V3(size.x * THIN, size.y * (foot ? 1 : 0.92), size.z * (foot ? 1 : THIN));
        seg.centre = centre;
        seg.geo = { kind, c: centre, h: extent.scale(0.5), q: Q.Identity() };
        return new BABYLON.PhysicsShapeBox(centre, Q.Identity(), extent, this.scene);
    }

    // A hand's box, laid along the hand: its length, its breadth across the palm and thumb, and its thickness, the
    // three ways its flesh lies (the axes of its spread). Square to the body, a hand held out at rest slanting forward
    // and in made a box 10 x 12 x 13 cm round a hand under 5 cm thick, and nothing it reached for came nearer its
    // middle than 5 to 7 cm: a hand on a belly or a wounded arm stopped short of it.
    _hand(seg, pts: BABYLON.Vector3[]) {
        const mid = pts.reduce((a, p) => a.addInPlace(p), new V3()).scaleInPlace(1 / pts.length);
        const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const p of pts) {
            const d = [p.x - mid.x, p.y - mid.y, p.z - mid.z];
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (d[i] * d[j]) / pts.length;
        }
        // The two widest ways by power iteration, the third square to both.
        const axes = [];
        for (let k = 0; k < 2; k++) {
            let v = k ? new V3(0, 0, 1) : new V3(0, 1, 0);
            for (let it = 0; it < 60; it++) {
                if (k) v.subtractInPlace(axes[0].scale(V3.Dot(v, axes[0])));
                v = new V3(C[0][0] * v.x + C[0][1] * v.y + C[0][2] * v.z, C[1][0] * v.x + C[1][1] * v.y + C[1][2] * v.z, C[2][0] * v.x + C[2][1] * v.y + C[2][2] * v.z).normalize();
            }
            if (k) v.subtractInPlace(axes[0].scale(V3.Dot(v, axes[0]))).normalize();
            axes.push(v);
        }
        axes.push(V3.Cross(axes[0], axes[1]).normalize());
        // (Across the palm, not out to the thumb's tip held away from it as the model stands: a hand that closes or holds
        // something has its thumb in.)
        const lo = new V3(), hi = new V3(), at = (list, f) => list[Math.floor((list.length - 1) * f)];
        ['x', 'y', 'z'].forEach((k, i) => {
            const along = pts.map((p) => V3.Dot(p.subtract(mid), axes[i])).sort((a, b) => a - b), edge = i === 1 ? 0.08 : 0.02;
            lo[k] = at(along, edge);
            hi[k] = at(along, 1 - edge);
        });
        const q = Q.RotationQuaternionFromAxis(axes[0], axes[1], axes[2]);
        const centre = mid.add(lo.add(hi).scale(0.5).applyRotationQuaternion(q)), extent = hi.subtract(lo).scaleInPlace(THIN);
        seg.radius = extent.z / 2;
        seg.centre = centre;
        seg.geo = { kind: 'box', c: centre, h: extent.scale(0.5), q };
        return new BABYLON.PhysicsShapeBox(centre, q, extent, this.scene);
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

    // For every joint, the bones whose turns make it up, from the bone after the parent segment's down to the segment's
    // own (and on to the skull, for the neck): motor.ts turns a pose into the joint's target with them.
    _chains() {
        const bones = this.person.header.bones;
        for (const seg of this.segments) {
            if (!seg.parent) continue;
            const chain = [];
            let at = bones.find((b) => b.name === seg.bone);
            while (at && at.name !== seg.parent.bone) { chain.unshift(at.name); at = at.parent >= 0 ? bones[at.parent] : null; }
            if (seg.name === 'head') chain.push('neck02', 'neck03', 'head');
            seg.chain = chain;
            seg.spread = SPREAD.has(seg.name) ? chain.map((n) => this.person.byName[n].bone) : [this.person.byName[seg.bone].bone];
        }
    }

    // The joint between a segment and its parent, at the segment's bone head, with its range read off the skeleton.
    _join(seg) {
        const j = seg.joint, parent = seg.parent;
        // The neutral turn, composed as person.apply would (each later turn on the left); the parent's frame is laid out
        // round the limb as it lies there, and the limb's own frame is that frame turned back by it.
        const neutral = Q.Identity();
        if (!j.lock) for (const [control, deg] of j.neutral) neutral.copyFrom(Q.RotationAxis(this.person.hinges[control].axis, deg * RAD).multiply(neutral));
        seg.unneutral = Q.Inverse(neutral);
        const along = seg.end.normalizeToNew().applyRotationQuaternion(neutral);
        let hinge = j.hinge === 'elbow' ? V3.Cross(along, FORWARD).normalize() : new V3(1, 0, 0);
        hinge = hinge.subtract(along.scale(V3.Dot(hinge, along))).normalize();
        seg.frame = [hinge, along, V3.Cross(hinge, along)];
        // Where it turns: for a spine or neck, whose turn drive() spreads over every bone of it, the middle of those
        // bones' joints, about which the curve they make swings what is past them as one turn would (about the first
        // joint, the skull drawn on a curved neck lay 7 cm from the head's body, and through the floor under it).
        const pivot = seg.spread.length > 1 ? seg.spread.reduce((a, b) => a.addInPlace(this.person.byName[b.name].head), new V3()).scaleInPlace(1 / seg.spread.length) : seg.head;
        const params = { pivotA: pivot.subtract(parent.head), pivotB: pivot.subtract(seg.head), axisA: hinge, perpAxisA: along,
            axisB: hinge.applyRotationQuaternion(seg.unneutral), perpAxisB: along.applyRotationQuaternion(seg.unneutral), collision: false };
        const limits: any[] = [{ axis: AXIS.LINEAR_DISTANCE, minLimit: 0, maxLimit: 0 }];
        if (j.lock) {
            for (const axis of ANGULAR) limits.push({ axis, minLimit: 0, maxLimit: 0 });
        } else {
            this._range(seg, 0, j.bend);
            this._range(seg, 2, j.side);
            seg.lo[1] = -j.twist * RAD;
            seg.hi[1] = j.twist * RAD;
            ANGULAR.forEach((axis, i) => limits.push({ axis, minLimit: seg.lo[i], maxLimit: seg.hi[i] }));
        }
        seg.constraint = new BABYLON.Physics6DoFConstraint(params, limits, this.scene);
        parent.body.addConstraint(seg.body, seg.constraint);
        seg.locked = !!j.lock;
    }

    // Axis `i` of a joint's range from [control, lo, hi]: the control is turned a little on the skeleton to see which
    // of the joint's axes it moves, and which way.
    _range(seg, i, [control, lo, hi]) {
        let sign = 1;
        if (control) {
            const h = this.person.hinges[control];
            const a = jointAngles(Q.RotationAxis(h.axis, 0.3), seg.frame, [0, 0, 0]);
            const most = a.map(Math.abs).indexOf(Math.max(...a.map(Math.abs)));
            if (most !== i) console.warn(`ragdoll: ${control} turns ${seg.name}'s joint about axis ${most}, not ${i}`);
            sign = Math.sign(a[i]) || 1;
        }
        seg.lo[i] = (sign > 0 ? lo : -hi) * RAD;
        seg.hi[i] = (sign > 0 ? hi : -lo) * RAD;
        seg.sign = seg.sign ?? [1, 1, 1];
        seg.sign[i] = sign;
    }

    // Every segment's body put where its bone is in the person's pose now: once, before the bodies exist.
    _place() {
        const { person } = this;
        person.skeleton.computeAbsoluteMatrices(true);
        person._sync();
        const world = person.mesh.getWorldMatrix();
        const m = new BABYLON.Matrix(), scale = new V3();
        for (const seg of this.segments) {
            person.byName[seg.bone].bone.getAbsoluteMatrix().multiplyToRef(world, m);
            m.decompose(scale, seg.node.rotationQuaternion, seg.node.position);
        }
    }

    // --- the joints' muscles -----------------------------------------------------------

    // How a joint is turned now: its child's turn in its parent's frame.
    relative(seg, out: BABYLON.Quaternion) {
        Q.InverseToRef(seg.parent.node.rotationQuaternion, out);
        return out.multiplyInPlace(seg.node.rotationQuaternion);
    }

    // A joint's three angles now (hinge, twist, side), radians, from its neutral.
    angles(seg, out: number[]) { return jointAngles(this.relative(seg, _q).multiplyInPlace(seg.unneutral), seg.frame, out); }

    // Muscle on a joint: its motors pull it toward `target` (hinge, twist, side, radians) with up to `strength` (0 to
    // 1) of what its muscles have. A muscle is a spring with give, not a servo: it pulls harder the further the joint is
    // from where it is aimed (STIFF of its most per radian, stiffness growing with how hard it works), damped like a limb
    // (DAMP of critical, for what the joint swings), and never past its most. (Havok's POSITION motor reaches its target
    // within one step whatever is in the way, up to its force: a hand or a foot held to an angle against a contact, or
    // against a target worked out each frame from where the body had just been shaken to, was driven back and forth at
    // the step rate, 1 to 9 rad/s with the body still.) Havok's SPRING_FORCE motor, which Babylon's plugin does not name
    // (its own `HP_Constraint_SetAxisMotorStiffness` / `...Damping` / `...PositionTarget`, HavokPhysics.d.ts 1.3.14).
    // Nothing is sent that has not changed.
    hold(seg, target: number[], strength: number) {
        const c = seg.constraint, m = seg.motor;
        const on = strength > 0.004 && !seg.locked;
        const hk = (this.scene.getPhysicsEngine().getPhysicsPlugin() as any), hp = hk._hknp;
        const each = (fn) => { for (const id of c._pluginData) for (let i = 0; i < 3; i++) fn(id, hk._constraintAxisToNative(ANGULAR[i]), i); };
        if (on !== m.on) {
            // A muscle lets go by its motors losing their force, not the motors: Havok (1.3.10 to 1.3.14) frees memory
            // it still uses when a position motor is set back to NONE, and a later motor call traps (memory access out of
            // bounds, every frame after it failing). A motor of no force swings a joint as none does (to 1e-7 m). The
            // motor's kind is set once and never changed.
            if (on && !m.made) each((id, axis) => hp.HP_Constraint_SetAxisMotorType(id, axis, hp.ConstraintMotorType.SPRING_FORCE));
            m.made ||= on;
            m.on = on;
            m.f = -1;
            m.t.fill(NaN);
        }
        if (!m.made) return;
        const f = on ? strength * seg.muscle : 0;
        if (Math.abs(f - m.f) > 0.03 * m.f + 0.2 || (f === 0 && m.f !== 0)) {
            // (Twist and the side bend have less muscle across them than the main bend.)
            const k = f * STIFF, d = 2 * DAMP * Math.sqrt(k * seg.swing);
            each((id, axis, i) => {
                const share = AXIS_SHARE[i];
                hp.HP_Constraint_SetAxisMotorMaxForce(id, axis, f * share);
                hp.HP_Constraint_SetAxisMotorStiffness(id, axis, k * share);
                hp.HP_Constraint_SetAxisMotorDamping(id, axis, d * Math.sqrt(share));
            });
            m.f = f;
        }
        if (!on) return;
        for (let i = 0; i < 3; i++) {
            const t = Math.max(seg.lo[i] + 0.02, Math.min(seg.hi[i] - 0.02, target[i]));
            if (!(Math.abs(t - m.t[i]) < 0.002)) { each((id, axis, j) => j === i && hp.HP_Constraint_SetAxisMotorPositionTarget(id, axis, t)); m.t[i] = t; }
        }
    }

    // Whether a segment is on a piece cut off the body (dismember.ts marks the piece's first segment `severed`).
    cutOff(seg) {
        for (let at = seg; at; at = at.parent) if (at.severed) return true;
        return false;
    }

    // A piece cut off is not the body's any more: its weight, balance and pushes go without it (`attached`, and the
    // mass). Its first segment, still inside the stump where it was cut, meets nothing of the body until it is clear
    // of it (met at once, it was thrown out of it), and from then on meets all of it, as anything else would.
    _severed() {
        let n = 0;
        for (const seg of this.segments) if (seg.severed) n++;
        if (n !== this._cuts.length) {
            this._cuts = this.segments.filter((seg) => seg.severed).map((seg) => this._cuts.find((c) => c.seg === seg) ?? this._cut(seg));
            this.attached = this.segments.filter((seg) => !this.cutOff(seg));
            this.mass = this.attached.reduce((sum, seg) => sum + seg.mass, 0);
            this._toned = false;
            this.setTone(this.tone);
        }
        for (const c of this._cuts) {
            if (c.clear) continue;
            const { seg } = c, at = this.worldPoint(seg.parent, seg.head.subtract(seg.parent.head), _v);
            if (V3.Distance(at, seg.node.position) < seg.radius + seg.parent.radius) continue;
            c.clear = true;
            seg.shape.filterMembershipMask = LIMBS | c.own;
            seg.shape.filterCollideMask = ~c.own;
        }
    }

    _cut(seg) {
        const own = seg.shape.filterMembershipMask & ~(TRUNK | ROOTS | LIMBS);
        seg.shape.filterMembershipMask = own;
        seg.shape.filterCollideMask = ~own;
        return { seg, own, clear: false };
    }

    // Whether a segment hangs past a broken bone, with nothing to move it but its own weight.
    loose(seg) {
        for (let at = seg; at; at = at.parent) if (at.broken) return true;
        return false;
    }

    // How much the joints resist being moved, muscles or no: 'alive', 'out' (unconscious) or 'dead', or N m. A piece cut
    // off has no tone to keep: its joints are a dead body's whatever the person's are (with the living tone a severed
    // leg landed with its ankle held as it was, 5 degrees of give against 20 dead).
    setTone(state) {
        const tone = typeof state === 'number' ? state : TONE[state];
        if (Math.abs(tone - this.tone) < 0.01 && this._toned) return;
        this.tone = tone;
        this._toned = true;
        for (const seg of this.segments) {
            if (!seg.constraint || seg.locked) continue;
            // (A broken shaft's mid joint keeps its grating, breakAt's: given the tone, a broken shin was held at the break
            // by 4.5 N m while awake and let go when they passed out.)
            const k = this.cutOff(seg) ? TONE.dead : this.tone;
            for (const axis of ANGULAR) seg.constraint.setAxisFriction(axis, seg.joint.lock ? GRATE * seg.mass : k * seg.mass / 6);
        }
    }
    declare _toned: boolean;

    // The long bone of a segment broken at its middle: the two halves are held only by flesh.
    breakAt(name) {
        const seg = this.byName.get(name + '2') ?? this.byName.get(name);
        if (!seg || !seg.locked || seg.broken) return false;
        seg.broken = true;
        seg.locked = false;
        const c = seg.constraint;
        // Bent most about the joint's own hinge, less across it, and turned a little about its length.
        for (const [axis, most] of [[AXIS.ANGULAR_X, 1.4], [AXIS.ANGULAR_Y, 0.6], [AXIS.ANGULAR_Z, 1.1]]) {
            c.setAxisMode(axis, LIMIT.LIMITED);
            c.setAxisMinLimit(axis, -most);
            c.setAxisMaxLimit(axis, most);
            c.setAxisFriction(axis, GRATE * seg.mass);
        }
        return true;
    }

    // --- where the body is ----------------------------------------------------------

    // A point given in a segment's own frame, in the world.
    worldPoint(seg, local: BABYLON.Vector3, out: BABYLON.Vector3) {
        local.rotateByQuaternionToRef(seg.node.rotationQuaternion, out);
        return out.addInPlace(seg.node.position);
    }

    // The middle of the body's weight.
    com(out: BABYLON.Vector3) {
        out.setAll(0);
        for (const seg of this.attached) out.addInPlace(this.worldPoint(seg, seg.centre, _v).scaleInPlace(seg.mass));
        return out.scaleInPlace(1 / this.mass);
    }

    // How fast the middle of the body's weight is moving.
    comVelocity(out: BABYLON.Vector3) {
        out.setAll(0);
        for (const seg of this.attached) {
            seg.body.getLinearVelocityToRef(_v);
            out.addInPlace(_v.scaleInPlace(seg.mass));
        }
        return out.scaleInPlace(1 / this.mass);
    }

    // The lowest point of a segment's shape, as a height in the world.
    lowest(seg) {
        const g = seg.geo, q = seg.node.rotationQuaternion;
        if (g.kind === 'capsule') return Math.min(this.worldPoint(seg, g.a, _v).y, this.worldPoint(seg, g.b, _v).y) - g.r;
        if (g.kind === 'sphere') return this.worldPoint(seg, g.c, _v).y - g.r;
        // A box: how far down its corners reach from its middle, by how its three axes now point.
        const { x, y, z, w } = q.multiplyToRef(g.q, _qp);
        const down = Math.abs(2 * (x * y + z * w)) * g.h.x + Math.abs(1 - 2 * (x * x + z * z)) * g.h.y + Math.abs(2 * (y * z - x * w)) * g.h.z;
        return this.worldPoint(seg, g.c, _v).y - down;
    }

    // --- the bones follow the bodies ------------------------------------------------------

    // The skeleton put where the bodies are. Called every frame.
    drive() {
        const { person } = this;
        this._severed();
        person._sync();
        const world = person.mesh.getWorldMatrix();
        world.decompose(undefined, this._qWorld, undefined);
        world.invertToRef(this._inv);
        Q.InverseToRef(this._qWorld, _q2);
        for (const seg of this.segments) _q2.multiplyToRef(seg.node.rotationQuaternion, seg.abs);
        for (const seg of this.segments) {
            if (!seg.parent) {
                const bone = person.byName[seg.bone].bone;
                bone.setPosition(V3.TransformCoordinates(seg.node.position, this._inv), BABYLON.Space.LOCAL);
                bone.setRotationQuaternion(seg.abs, BABYLON.Space.LOCAL);
                continue;
            }
            Q.InverseToRef(seg.parent.abs, _q).multiplyInPlace(seg.abs);
            if (seg.spread.length === 1) { seg.spread[0].setRotationQuaternion(_q, BABYLON.Space.LOCAL); continue; }
            if (_q.w < 0) _q.scaleInPlace(-1);
            Q.SlerpToRef(_I, _q, 1 / seg.spread.length, _q2);
            for (const bone of seg.spread) bone.setRotationQuaternion(_q2, BABYLON.Space.LOCAL);
        }
    }

    // A blow: `impulse` (N s, world) at `at` (world) on the segment named.
    push(name, impulse, at) {
        this.byName.get(name)?.body.applyImpulse(impulse, at);
    }

    // The segment whose shape is nearest a world point, and how far it is.
    // (By the shapes themselves: measured from each segment's bone line, a shot to the face went to the chest, whose line
    // runs up to the neck, and not to the head, whose bone is the neck's.)
    nearest(at) {
        let best = null, d = Infinity;
        for (const seg of this.segments) {
            const dist = this.outside(seg, at);
            if (dist < d) { d = dist; best = seg; }
        }
        return { seg: best, distance: d };
    }

    // How far a world point lies outside a segment's shape (less than nothing inside it).
    outside(seg, at: BABYLON.Vector3) {
        const g = seg.geo, p = at.subtractToRef(seg.node.position, _p).applyRotationQuaternionInPlace(Q.InverseToRef(seg.node.rotationQuaternion, _qp));
        if (g.kind === 'sphere') return V3.Distance(p, g.c) - g.r;
        if (g.kind === 'capsule') {
            const ab = g.b.subtract(g.a), t = Math.max(0, Math.min(1, V3.Dot(p.subtract(g.a), ab) / Math.max(1e-9, ab.lengthSquared())));
            return V3.Distance(p, g.a.add(ab.scaleInPlace(t))) - g.r;
        }
        p.subtractInPlace(g.c).applyRotationQuaternionInPlace(Q.InverseToRef(g.q, _qp));
        const x = Math.abs(p.x) - g.h.x, y = Math.abs(p.y) - g.h.y, z = Math.abs(p.z) - g.h.z;
        return Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) + Math.min(Math.max(x, y, z), 0);
    }

    // A segment's two ends in the world, from its body.
    segmentEnds(seg) {
        const m = seg.node.computeWorldMatrix(true);
        return [seg.node.position.clone(), V3.TransformCoordinates(seg.end, m)];
    }

    // Where the body as a whole is: the middle of its pelvis.
    get centre() { return this.byName.get('pelvis').node.position; }

    dispose() {
        this.scene.onAfterPhysicsObservable.remove(this._moved);
        for (const c of this._apart) c.dispose();
        for (const seg of this.segments) {
            seg.constraint?.dispose();
            seg.body?.dispose();
            seg.shape?.dispose();
            seg.node.dispose();
        }
    }
}

export { WORLD };
