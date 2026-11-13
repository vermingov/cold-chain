// The people: the dead on the table and the living at the gate.
//
// Each is one skinned mesh built offline by tools/people.py from MakeHuman's
// CC0 base mesh and base assets: a photographed skin, eyes, brows, lashes,
// teeth, hair, and the clothes they were buried or turned up in. They are
// posed procedurally. Nothing is keyframed: a pose is a handful of joint
// angles in anatomical terms, hip flexion, knee flexion, how far the jaw
// hangs, and every movement is a function from time to one of those.
//
// The bones' rest frames are world-aligned (tools/people.py writes only
// positions), so a rotation applied to a bone in its rest pose is a rotation
// about a fixed axis of the person's own body. Each hinge below names that
// axis and the direction positive should move the limb, and the direction is
// checked against the rest geometry at load rather than trusted to a sign
// convention nobody can remember.

import * as BABYLON from '@babylonjs/core';
const Q = BABYLON.Quaternion;
const V3 = BABYLON.Vector3;

// --- the file ----------------------------------------------------------------

async function readPerson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ': ' + res.status);
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== 'CCPF') throw new Error(url + ': not a person');
    const headLen = view.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, headLen)));
    const base = 12 + headLen;
    const types = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };
    const arrays = {};
    for (const a of header.arrays) {
        const T = types[a.type];
        arrays[a.name] = new T(buf, base + a.offset, a.length / T.BYTES_PER_ELEMENT);
    }
    return { header, arrays };
}

// --- anatomy -----------------------------------------------------------------
//
// Every control the poses use: which bone it turns, about which axis of the
// rest body, and which way positive should carry the far end of that bone.
// Axes are in the person's own frame: +Z forward, +Y up, their left at
// -X. `toward` is checked at load; if a positive turn moves the bone's tail
// the other way the axis is flipped, so the poses below can say "flex the
// knee 90" and mean it.

const FORWARD = new V3(0, 0, 1);
const FINGERS = ['index', 'middle', 'ring', 'little'];
const UP = new V3(0, 1, 0);

function hingesFor(side) {
    const s = side === 'L' ? -1 : 1;             // outward along X for this side
    const out = new V3(s, 0, 0);
    const b = (n) => `${n}.${side}`;
    return {
        [`hipFlex${side}`]: { bone: b('upperleg01'), axis: 'x', toward: FORWARD, order: 2 },
        [`hipAbduct${side}`]: { bone: b('upperleg01'), axis: 'z', toward: out, order: 1 },
        [`hipTwist${side}`]: { bone: b('upperleg01'), axis: 'y', toward: null, order: 0 },
        [`knee${side}`]: { bone: b('lowerleg01'), axis: 'x', toward: FORWARD.scale(-1) },
        [`ankle${side}`]: { bone: b('foot'), axis: 'x', toward: UP },
        [`shoulderFlex${side}`]: { bone: b('upperarm01'), axis: 'x', toward: FORWARD, order: 2 },
        [`shoulderAbduct${side}`]: { bone: b('upperarm01'), axis: 'z', toward: UP, order: 1 },
        [`shoulderTwist${side}`]: { bone: b('upperarm01'), axis: 'bone', toward: null, order: 0 },
        [`elbow${side}`]: { bone: b('lowerarm01'), axis: 'elbow', toward: FORWARD },
        [`forearmTwist${side}`]: { bone: b('lowerarm02'), axis: 'bone', toward: null },
        [`wrist${side}`]: { bone: b('wrist'), axis: 'elbow', toward: FORWARD },
        [`shrug${side}`]: { bone: b('clavicle'), axis: 'z', toward: UP },
    };
}

const HINGES = {
    ...hingesFor('L'),
    ...hingesFor('R'),
    // The spine bends in five places; `spine` controls are spread over all of
    // them so a bow is a curve and not a hinge at the waist.
    spineFlex: { bones: ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'], axis: 'x', toward: FORWARD, tip: 'spine01', order: 2 },
    spineSide: { bones: ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'], axis: 'z', toward: new V3(1, 0, 0), tip: 'spine01', order: 1 },
    spineTwist: { bones: ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'], axis: 'y', toward: null, order: 0 },
    // The head nods before it turns, which is what makes a turned head still
    // look down at something rather than tip over sideways.
    neckFlex: { bones: ['neck01', 'neck02', 'neck03'], axis: 'x', toward: FORWARD, tip: 'neck03', order: 0 },
    neckTwist: { bones: ['neck01', 'neck02', 'neck03'], axis: 'y', toward: null, order: 2 },
    headFlex: { bone: 'head', axis: 'x', toward: FORWARD, order: 0 },
    headTilt: { bone: 'head', axis: 'z', toward: new V3(1, 0, 0), order: 1 },
    headTwist: { bone: 'head', axis: 'y', toward: null, order: 2 },
    jaw: { bone: 'jaw', axis: 'x', toward: UP.scale(-1) },
    pelvisTilt: { bone: 'root', axis: 'x', toward: FORWARD, tip: 'spine05' },
};

// What touches the floor, for each way of being on it: joint, which end, and
// how far the surface of the body sits below that end. An ankle joint is seven
// centimetres above the sole it stands on.
const CONTACTS = {
    feet: [['foot.L', 'head', 0.074], ['foot.R', 'head', 0.074], ['foot.L', 'tail', 0.03], ['foot.R', 'tail', 0.03]],
    knees: [['lowerleg01.L', 'head', 0.055], ['lowerleg01.R', 'head', 0.055],
        ['foot.L', 'head', 0.05], ['foot.R', 'head', 0.05], ['foot.L', 'tail', 0.025], ['foot.R', 'tail', 0.025]],
    all4: [['lowerleg01.L', 'head', 0.055], ['lowerleg01.R', 'head', 0.055],
        ['wrist.L', 'head', 0.03], ['wrist.R', 'head', 0.03], ['finger3-3.L', 'tail', 0.008], ['finger3-3.R', 'tail', 0.008]],
    // Lying down: everything that could touch the floor might.
    prone: [['head', 'head', 0.1], ['head', 'tail', 0.09], ['spine01', 'head', 0.12], ['spine04', 'head', 0.12],
        ['lowerleg01.L', 'head', 0.055], ['lowerleg01.R', 'head', 0.055], ['foot.L', 'tail', 0.03], ['foot.R', 'tail', 0.03],
        ['wrist.L', 'head', 0.03], ['wrist.R', 'head', 0.03]],
};

// How a hand closes (_hand): the share of `curl` each joint of a finger takes
// closing (MCP, PIP, DIP: the DIP two thirds of the PIP) and opening past
// rest, where each stops, index to little finger how far each goes, the ring
// and little metacarpals' bend at their base for each degree (they cup the
// palm 7 and 15 degrees in a fist), how much one person's fingers differ, how
// far a knuckle's axis turns toward the middle finger's, and how far the
// thumb's turns from the fingers'.
const HAND = {
    GAIN: [0.86, 1, 0.67], OPEN: [1, 0.15, 0.3], RANGE: [[-35, 92], [-5, 110], [-10, 85]], CASCADE: [0.9, 1, 1.06, 1.12],
    CUP: [0.07, 0.14], VARY: 0.12, CONVERGE: 0.6, THUMB_TURN: 100,
};

const _rest = Q.Identity();

// Degrees in, radians out. Poses are written in degrees because people think
// about joints in degrees.
const RAD = Math.PI / 180;

// --- materials ---------------------------------------------------------------
//
// What each kind of part is made of. Skin is not matte and not wet: a soft
// sheen that the lamp runs along. Eyes are the wettest thing on a face.
// Hair, brows and lashes are cards with see-through painted into them: hair
// is cut out hard so it sorts with everything else, the finer ones are
// blended.
const KINDS = {
    skin: { rough: 0.52, specular: 0.55 },
    // The same skin with the blood gone out of it.
    deadSkin: { rough: 0.62, specular: 0.35, tint: [0.74, 0.77, 0.7] },
    eyes: { rough: 0.08, specular: 1.0, blend: true },
    teeth: { rough: 0.3, specular: 0.6, blend: true, tint: [0.62, 0.6, 0.5] },
    // (Inside a mouth the lips, cheeks and teeth shade the tongue, and nothing here draws that shade: it is in its colour.)
    tongue: { rough: 0.35, specular: 0.5, tint: [0.55, 0.42, 0.42] },
    brows: { rough: 0.8, specular: 0.1, blend: true },
    lashes: { rough: 0.8, specular: 0.1, blend: true },
    hair: { rough: 0.6, specular: 0.25, cut: 0.35, twoSided: true },
    cloth: { rough: 0.85, specular: 0.2, twoSided: true },
};

// --- the library -------------------------------------------------------------

// Everyone the game can show, fetched once, and the textures they share.
export class People {
    declare scene: any;
    declare base: string;
    declare bodies: Map<any, any>;
    declare textures: Map<any, any>;
    declare materials: Map<any, any>;

    constructor(scene, base = 'assets/people/') {
        this.scene = scene;
        this.base = base;
        this.bodies = new Map();
        this.textures = new Map();
        this.materials = new Map();
    }

    async load(names) {
        await Promise.all(names.map(async (n) => {
            if (!this.bodies.has(n)) this.bodies.set(n, await readPerson(`${this.base}${n}.bin`));
        }));
        return this;
    }

    _texture(info) {
        if (!this.textures.has(info.file)) {
            const t = new BABYLON.Texture(this.base + info.file, this.scene);
            t.hasAlpha = info.alpha;
            t.anisotropicFilteringLevel = 8;
            this.textures.set(info.file, t);
        }
        return this.textures.get(info.file);
    }

    // One material for each kind of part with each texture: two people in
    // the same suit share it.
    material(part, dead = false) {
        const name = dead && part.kind === 'skin' ? 'deadSkin' : part.kind;
        const key = name + ':' + (part.texture ? part.texture.file : '-');
        if (this.materials.has(key)) return this.materials.get(key);
        const kind = KINDS[name];
        const m = new BABYLON.PBRMaterial('person_' + key, this.scene);
        m.metallic = 0;
        m.roughness = kind.rough;
        m.specularIntensity = kind.specular;
        m.environmentIntensity = 0;
        m.maxSimultaneousLights = 8;
        m.backFaceCulling = !kind.twoSided;
        if (part.texture) {
            m.albedoTexture = this._texture(part.texture);
            if (part.texture.alpha && kind.cut) {
                m.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
                m.alphaCutOff = kind.cut;
                m.useAlphaFromAlbedoTexture = true;
            } else if (part.texture.alpha && kind.blend) {
                m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
                m.useAlphaFromAlbedoTexture = true;
                // Only what is painted shines: a highlight drawn over the
                // clear part of a lash card is a pale square on the face.
                m.useSpecularOverAlpha = false;
                m.useRadianceOverAlpha = false;
            }
        } else {
            m.albedoColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        }
        if (kind.tint) m.albedoColor = BABYLON.Color3.FromArray(kind.tint);
        this.materials.set(key, m);
        return m;
    }

    make(name, opts) { return new Person(this, name, opts); }
}

// --- one person --------------------------------------------------------------

export class Person {
    declare lib: any;
    declare scene: any;
    declare header: any;
    declare bodyName: any;
    declare height: number;
    declare root: BABYLON.TransformNode;
    declare pelvis: BABYLON.Vector3;
    declare body: BABYLON.TransformNode;
    declare mesh: BABYLON.Mesh;
    declare multi: BABYLON.MultiMaterial;
    declare bald: boolean;
    declare pose: Record<string, any>;
    declare look: any;
    declare lookWeight: number;
    declare blink: number;
    declare blinks: boolean;
    declare _blinkClock: number;
    declare _blinking: number;
    declare smile: number;
    declare dressed: any;
    declare bones: any[];
    declare byName: Record<string, any>;
    declare skeleton: BABYLON.Skeleton;
    declare hinges: Record<string, any>;
    declare halves: BABYLON.Bone[][];

    // `dead` is drawn in a body's colours rather than a person's, and has
    // no hair that `bald` takes away.
    constructor(lib, bodyName, { scale = 1, dressed = true, dead = false, bald = false, name = bodyName } = {}) {
        const scene = lib.scene;
        const { header, arrays } = lib.bodies.get(bodyName);
        this.lib = lib;
        this.scene = scene;
        this.header = header;
        this.bodyName = bodyName;
        this.height = header.height * scale;

        // Three levels. `root` is where the owner puts the person and which
        // way they face. `body` is what a pose moves as a whole, tipped
        // forward to crawl, laid on its back, and it turns about the pelvis
        // rather than the feet, which is where a body's weight actually is.
        // The mesh hangs under it, offset so its own origin (the floor under
        // the feet) lines up again.
        this.root = new BABYLON.TransformNode(name + 'Root', scene);
        this.root.scaling.setAll(scale);
        const pelvis = header.bones.find((b) => b.name === 'root').head;
        this.pelvis = V3.FromArray(pelvis);
        this.body = new BABYLON.TransformNode(name + 'Body', scene);
        this.body.parent = this.root;
        this.body.position.copyFrom(this.pelvis);
        this.body.rotationQuaternion = Q.Identity();

        const mesh = new BABYLON.Mesh(name, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = arrays.position;
        vd.normals = arrays.normal;
        vd.uvs = arrays.uv;
        vd.indices = arrays.index;
        const n = header.vertexCount;
        const mi = new Float32Array(n * 4), mw = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) {
            mi[i] = arrays.joints[i];
            mw[i] = arrays.weights[i] / 255;
        }
        vd.matricesIndices = mi;
        vd.matricesWeights = mw;
        vd.applyToMesh(mesh, false);
        mesh.parent = this.body;
        mesh.position.copyFrom(this.pelvis.scale(-1));
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.alwaysSelectAsActiveMesh = true;   // the skinned bounds lie
        mesh.numBoneInfluencers = 4;
        this.mesh = mesh;

        this._buildSkeleton(header);
        mesh.skeleton = this.skeleton;

        const multi = new BABYLON.MultiMaterial(name + 'M', scene);
        multi.subMaterials = header.parts.map((p) => lib.material(p, dead));
        mesh.material = multi;
        this.multi = multi;
        this.bald = bald;
        this.dress(dressed);

        this._calibrate();
        this.pose = {} as Record<string, any>;
        this.look = null;           // world point the head and eyes turn to, or null
        this.lookWeight = 0;
        this.blink = 0;             // 0 open, 1 shut
        this.blinks = true;         // the dead do not
        this._blinkClock = 2 + Math.random() * 3;
        this._blinking = -1;
        this.smile = 0;             // corners of the mouth pulled out and up
    }

    dispose() {
        this.mesh.dispose();
        this.skeleton.dispose();
        this.root.dispose();
        this.multi.dispose();
    }

    setEnabled(on) { this.root.setEnabled(on); }

    // In what they wore, or without it. Under clothes the skin they cover is
    // not drawn at all: drawn, it comes through the cloth at every bend.
    dress(on) {
        this.dressed = on;
        this.mesh.subMeshes = [];
        this.header.parts.forEach((p, i) => {
            if (on ? p.under : p.worn) return;
            if (this.bald && p.kind === 'hair') return;
            new BABYLON.SubMesh(i, p.vertexStart, p.vertexCount, p.indexStart, p.indexCount, this.mesh);
        });
    }

    // --- construction ---------------------------------------------------------

    _buildSkeleton(header) {
        const sk = new BABYLON.Skeleton(header.name, header.name, this.scene);
        this.bones = [];
        this.byName = {} as Record<string, any>;
        header.bones.forEach((b, i) => {
            const parent = b.parent >= 0 ? this.bones[b.parent] : null;
            const ph = b.parent >= 0 ? header.bones[b.parent].head : [0, 0, 0];
            const local = BABYLON.Matrix.Translation(b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]);
            const bone = new BABYLON.Bone(b.name, sk, parent, local, local.clone(), local.clone(), i);
            this.bones.push(bone);
            this.byName[b.name] = { bone, index: i, head: V3.FromArray(b.head), tail: V3.FromArray(b.tail) };
        });
        this.skeleton = sk;
        // Each finger joint's half-turn bone (people.py: the skin over the joint is on it) and the phalanx it halves.
        this.halves = header.bones.filter((b) => /^finger\d-\dh\./.test(b.name)).map((b) => [this.byName[b.name].bone, this.byName[b.name.replace('h.', '.')].bone]);
    }

    // Work out, for each hinge, the axis that turns the way its name says.
    _calibrate() {
        this.hinges = {} as Record<string, any>;
        const probe = (entry, bone, axisVec) => {
            if (!entry.toward) return axisVec;
            const { head, tail } = this.byName[bone];
            const tipName = entry.tip || null;
            const tip = tipName ? this.byName[tipName].tail : tail;
            const arm = tip.subtract(head);
            const q = Q.RotationAxis(axisVec, 0.2);
            const moved = arm.applyRotationQuaternion(q).subtract(arm);
            return V3.Dot(moved, entry.toward) >= 0 ? axisVec : axisVec.scale(-1);
        };
        const axisOf = (entry, bone) => {
            const { head, tail } = this.byName[bone];
            const along = tail.subtract(head).normalize();
            switch (entry.axis) {
                case 'x': return new V3(1, 0, 0);
                case 'y': return new V3(0, 1, 0);
                case 'z': return new V3(0, 0, 1);
                case 'bone': return along;
                // A hinge across the limb: perpendicular to where it points
                // and to the way the body faces.
                case 'elbow': return V3.Cross(along, FORWARD).normalize();
                default: throw new Error('axis ' + entry.axis);
            }
        };
        for (const [name, entry] of Object.entries(HINGES)) {
            const list = 'bones' in entry ? entry.bones : [entry.bone];
            const axis = probe(entry, list[0], axisOf(entry, list[0]));
            this.hinges[name] = { bones: list.map((b) => this.byName[b]), axis, order: ('order' in entry ? entry.order : undefined) ?? 1 };
        }
        for (const side of ['L', 'R']) this._hand(side);
    }

    // The hand's controls. `curl` closes a hand the way a hand closes, every
    // finger at once: the middle joint (PIP) leads, the knuckle (MCP) a little
    // behind it and the last joint (DIP) two thirds of the middle one, as the
    // tendons couple them; the index least and the little finger most (a hand
    // at rest lies in that cascade); the ring and little metacarpals bending
    // at their base so the palm cups round what it closes on; each joint
    // stopping where it stops (MCP 90, PIP 110, DIP 85). Opening past rest
    // (negative) is nearly all at the knuckles: a PIP barely straightens past
    // flat. Every finger of every person is a little different (VARY).
    // Then one finger at a time, joint by joint (index1R is the knuckle of
    // the right index), for a hand holding something; `cup` the ring and
    // little metacarpals alone; and the thumb, which bends its own way.
    _hand(side) {
        const b = (n) => this.byName[`${n}.${side}`];
        // Toward the palm: the way the fingers already curl at rest.
        const wrist = b('wrist').head;
        let palm = V3.Cross(b('finger2-1').head.subtract(wrist), b('finger5-1').head.subtract(wrist)).normalize();
        const curls = b('finger3-3').head.subtract(b('finger3-2').head).normalize().subtract(b('finger3-2').head.subtract(b('finger3-1').head).normalize());
        if (V3.Dot(palm, curls) < 0) palm = palm.scale(-1);
        const flat = (v) => v.subtract(palm.scale(V3.Dot(palm, v))).normalize();
        const middle = flat(b('finger3-2').head.subtract(b('finger3-1').head));
        // An axis across a bone (which way it runs: `d`) turned so that positive carries the bone toward the palm.
        const toward = (d, axis) => {
            const moved = d.applyRotationQuaternion(Q.RotationAxis(axis, 0.3)).subtract(d);
            return V3.Dot(moved, palm) >= 0 ? axis : axis.scale(-1);
        };
        const along = (bone, next) => (next ? next.head : bone.tail).subtract(bone.head).normalize();
        // Each bone of each finger bends about its own line across it, in the palm's plane (one line across the
        // knuckles for the whole hand is 20 degrees off square to the index and the little finger, which fan out from
        // the middle: they closed sideways, a splayed claw). The knuckle's line is taken square to the finger pulled
        // CONVERGE of the way into line with the middle finger, so that closing, the fingers come together and point
        // at the heel of the thumb (the scaphoid) as a real fist's do, instead of each folding down its own spread.
        // How far each finger is turned out from the middle one (radians, about `palm`).
        const spread = [2, 3, 4, 5].map((f) => {
            const d = flat(along(b(`finger${f}-1`), b(`finger${f}-2`)));
            return Math.atan2(V3.Dot(V3.Cross(d, middle), palm), V3.Dot(d, middle));
        });
        const flexes = (f, k) => {
            const bone = b(`finger${f}-${k}`), d = along(bone, k < 3 ? b(`finger${f}-${k + 1}`) : null);
            const square = k === 1 ? d.applyRotationQuaternion(Q.RotationAxis(palm, spread[f - 2] * HAND.CONVERGE)) : d;
            return toward(d, V3.Cross(square, palm).normalize());
        };
        const bones = [], axes = [];
        for (const f of [2, 3, 4, 5]) for (const k of [1, 2, 3]) { bones.push(b(`finger${f}-${k}`)); axes.push(flexes(f, k)); }
        // (people.py gives the hands their metacarpals; a file from before it does not)
        const cups = [b('metacarpal3'), b('metacarpal4')].filter(Boolean);
        const cupAxes = cups.map((m, i) => toward(along(m, b(`finger${i + 4}-1`)), V3.Cross(along(m, b(`finger${i + 4}-1`)), palm).normalize()));
        const vary = [0, 1, 2, 3].map(() => 1 + (Math.random() - 0.5) * HAND.VARY);
        // (The MakeHuman hand lies with its fingers spread; closing, they come together, CONVERGE of the way to the
        // middle finger by curl 30, in line with their knuckles' axes. Listed first, so that each finger is turned in
        // before it bends: the other way round it was swung sideways once bent.)
        const knuckles = [0, 3, 6, 9].map((k) => bones[k]);
        const curl = (deg, k) => {
            if (k < 4) return spread[k] / RAD * HAND.CONVERGE * Math.max(0, Math.min(1, deg / 30));
            if (k >= 16) return Math.max(0, deg) * HAND.CUP[k - 16];
            const joint = (k - 4) % 3, finger = (k - 4 - joint) / 3, [lo, hi] = HAND.RANGE[joint];
            const gain = (deg >= 0 ? HAND.GAIN[joint] : HAND.OPEN[joint]) * HAND.CASCADE[finger] * vary[finger];
            return Math.max(lo, Math.min(hi, deg * gain));
        };
        this.hinges['curl' + side] = { bones: [...knuckles, ...bones, ...cups], axis: axes[4], axes: [palm, palm, palm, palm, ...axes, ...cupAxes], bend: curl, fingers: true };
        FINGERS.forEach((finger, i) => {
            for (const k of [1, 2, 3]) this.hinges[`${finger}${k}${side}`] = { bones: [bones[i * 3 + k - 1]], axis: axes[i * 3 + k - 1], fingers: true };
        });
        if (cups.length) this.hinges['cup' + side] = { bones: cups, axis: cupAxes[1], axes: cupAxes, bend: (deg, k) => deg * HAND.CUP[k] / HAND.CUP[1], fingers: true };

        // The thumb. Its first bone (the metacarpal, in the heel of the hand) swings away from the palm (`thumbBase`)
        // and round in front of it to meet the fingers (`thumbIn`, about the line the hand lies along). Its other two
        // joints bend across the palm toward the little finger (`thumb`, the MCP 0.8 of the IP), about a line turned
        // THUMB_TURN round from the fingers' (the thumb's nail faces the side, not the back of the hand); bent the
        // fingers' way it folded down onto the palm and its tip went through them in a fist.
        const t1 = b('finger1-1'), t2 = b('finger1-2'), t3 = b('finger1-3');
        const thumbDir = along(t1, t2), turn = HAND.THUMB_TURN * RAD, little = b('finger5-1').head.subtract(t2.head).normalize();
        const thumbFlex = (bone, next) => {
            const d = along(bone, next), across = V3.Cross(d, palm).normalize(), out = palm.subtract(d.scale(V3.Dot(palm, d))).normalize();
            const axis = across.scale(Math.cos(turn)).add(out.scale(Math.sin(turn) * (side === 'R' ? 1 : -1))).normalize();
            const moved = d.applyRotationQuaternion(Q.RotationAxis(axis, 0.3)).subtract(d);
            return V3.Dot(moved, little) >= 0 ? axis : axis.scale(-1);
        };
        const thumbAxes = [thumbFlex(t2, t3), thumbFlex(t3, null)];
        this.hinges['thumb' + side] = { bones: [t2, t3], axis: thumbAxes[1], axes: thumbAxes, bend: (deg, k) => deg * (k ? 1 : 0.8), fingers: true };
        this.hinges['thumbBase' + side] = { bones: [t1], axis: toward(thumbDir, V3.Cross(thumbDir, palm).normalize()), order: 1, fingers: true };
        const lies = b('finger3-1').head.subtract(wrist).normalize();
        const swung = thumbDir.applyRotationQuaternion(Q.RotationAxis(lies, 0.3)).subtract(thumbDir);
        // (away from the palm first, then round: the other way round the swing carried it under the fingers)
        this.hinges['thumbIn' + side] = { bones: [t1], axis: V3.Dot(swung, curls) >= 0 ? lies : lies.scale(-1), order: 2, fingers: true };
    }

    // --- posing ---------------------------------------------------------------

    // Every finger joint's half-turn bone turned half as far as the phalanx past it, wherever that was put.
    halve() {
        for (const [half, bone] of this.halves) half.setRotationQuaternion(Q.Slerp(_rest, bone.rotationQuaternion ?? _rest, 0.5), BABYLON.Space.LOCAL);
    }

    // `pose` is a map of control name to degrees. Anything not named stays at
    // rest. Called every frame by whoever owns the person.
    //
    // `ground` names what should be touching the floor afterwards — feet by
    // default, knees for kneeling, hands and knees for crawling — and the body
    // is lifted or dropped until the lowest of them just does. Pass null for a
    // person who is not standing on anything, and 'skin' for one laid down.
    apply(pose: Record<string, number>, { ground = 'feet' } = {}) {
        this.pose = pose;
        const pitch = (pose._pitch || 0) * RAD, roll = (pose._roll || 0) * RAD;
        const tip = Q.RotationAxis(this.hinges.spineFlex.axis, pitch)
            .multiply(Q.RotationAxis(this.hinges.spineSide.axis, roll));
        this.body.rotationQuaternion.copyFrom(tip);
        this.body.position.set(this.pelvis.x + (pose._x || 0), this.pelvis.y + (pose._y || 0),
            this.pelvis.z + (pose._z || 0));
        // Each bone collects its turns and applies them in a fixed order —
        // twist, then out to the side, then forward — whatever order the pose
        // happened to list them in. The order matters: an arm lowered to the
        // side and then swung forward ends up in front of the chest, and the
        // same two turns the other way round end up somewhere else.
        const turns = new Map<any, [number, BABYLON.Quaternion][]>();
        const add = (entry, q, order = 5) => {
            if (!turns.has(entry)) turns.set(entry, []);
            turns.get(entry).push([order, q]);
        };
        for (const [name, deg] of Object.entries(pose)) {
            const h = this.hinges[name];
            if (!h || !deg) continue;
            const share = h.bones.length > 1 && !h.fingers ? 1 / h.bones.length : 1;
            const q = Q.RotationAxis(h.axis, deg * RAD * share);
            h.bones.forEach((b, k) => add(b, h.axes ? Q.RotationAxis(h.axes[k], (h.bend ? h.bend(deg, k) : deg) * RAD * share) : q, h.order));
        }
        this._lookAt(add);
        for (const b of Object.values(this.byName)) {
            const list = turns.get(b);
            let total = Q.Identity();
            if (list) {
                list.sort((x, y) => x[0] - y[0]);
                // Babylon's a.multiply(b) turns by b first, so each later turn
                // goes on the left.
                for (const [, q] of list) total = q.multiply(total);
            }
            b.bone.setRotationQuaternion(total, BABYLON.Space.LOCAL);
        }
        this.halve();
        this._face();
        if (ground === 'skin') this._settle();
        else if (ground) this._ground(CONTACTS[ground]);
    }

    // Laid down on whatever is under the root: the lowest point of the skin
    // itself is found and put there. The joints are no guide for a body on
    // its back (the pelvis joint is nearer the spine than the middle), and
    // this is asked for when a body is put down, not every frame, so skinning
    // it once on the CPU is nothing.
    _settle() {
        this.skeleton.computeAbsoluteMatrices(true);
        this._sync();
        const skinned = this.mesh.getPositionData(true, true);
        const toRoot = this.mesh.getWorldMatrix().multiply(this.root.getWorldMatrix().clone().invert());
        const skin = this.header.parts[0];
        const p = new V3();
        let low = Infinity;
        for (let i = skin.vertexStart; i < skin.vertexStart + skin.vertexCount; i++) {
            V3.TransformCoordinatesFromFloatsToRef(skinned[i * 3], skinned[i * 3 + 1], skinned[i * 3 + 2], toRoot, p);
            low = Math.min(low, p.y);
        }
        this.body.position.y -= low - (this.pose._y || 0);
    }

    // Lowest point of the named contacts, in the root's own space, and move
    // the body so it sits on y = 0 (plus whatever `_y` asked for).
    _ground(contacts) {
        this.skeleton.computeAbsoluteMatrices(true);
        this._sync();
        const toRoot = this.mesh.getWorldMatrix().multiply(this.root.getWorldMatrix().clone().invert());
        let low = Infinity;
        for (const [name, which, radius] of contacts) {
            const b = this.byName[name];
            const local = which === 'tail' ? b.tail : b.head;
            const m = b.bone.getAbsoluteMatrix();
            const restToBone = local.subtract(b.head);
            const p = V3.TransformCoordinates(V3.TransformCoordinates(restToBone, m), toRoot);
            low = Math.min(low, p.y - radius);
        }
        this.body.position.y -= low - (this.pose._y || 0);
    }

    // Head and eyes toward a point, within what a neck will do.
    _lookAt(add) {
        if (!this.look || this.lookWeight <= 0) return;
        const head = this.byName.head;
        const inv = this.root.computeWorldMatrix(true).clone().invert();
        const target = V3.TransformCoordinates(this.look, inv);
        const from = head.head.add(new V3(0, 0.08, 0));
        const d = target.subtract(from);
        const yaw = Math.atan2(d.x, d.z);
        const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        const w = this.lookWeight;
        const clampYaw = Math.max(-1.3, Math.min(1.3, yaw)) * w;
        const clampPitch = Math.max(-0.7, Math.min(0.6, pitch)) * w;
        add(this.byName.neck02, Q.RotationAxis(UP, clampYaw * 0.5), 9);
        add(head, Q.RotationAxis(this.hinges.headFlex.axis, -clampPitch), 8);
        add(head, Q.RotationAxis(UP, clampYaw * 0.5), 9);
        // The eyes take whatever the neck would not, up to where eyes go.
        const rest = yaw - clampYaw;
        for (const e of ['eye.L', 'eye.R']) {
            add(this.byName[e], Q.RotationAxis(UP, Math.max(-0.5, Math.min(0.5, rest))), 9);
        }
    }

    // Blinks, and the mouth. Separate from the body pose because every
    // person does them whatever else they are doing.
    tick(dt) {
        if (!this.blinks) return;
        if (this._blinking >= 0) {
            this._blinking += dt;
            this.blink = this._blinking < 0.06 ? this._blinking / 0.06 : Math.max(0, 1 - (this._blinking - 0.06) / 0.12);
            if (this._blinking > 0.18) { this._blinking = -1; this.blink = 0; }
        } else if ((this._blinkClock -= dt) <= 0) {
            this._blinking = 0;
            this._blinkClock = 2.5 + Math.random() * 5;
        }
    }

    _face() {
        for (const side of ['L', 'R']) {
            const upper = this.byName[`orbicularis03.${side}`];
            const lower = this.byName[`orbicularis04.${side}`];
            if (upper) upper.bone.setRotationQuaternion(Q.RotationAxis(new V3(1, 0, 0), this.blink * 0.55), BABYLON.Space.LOCAL);
            if (lower) lower.bone.setRotationQuaternion(Q.RotationAxis(new V3(1, 0, 0), -this.blink * 0.18), BABYLON.Space.LOCAL);
            const corner = this.byName[`risorius03.${side}`];
            if (corner) {
                const s = side === 'L' ? -1 : 1;
                const rest = corner.head.subtract(this.byName.head.head);
                const off = new V3(s * 0.022, 0.012, -0.006).scale(this.smile);
                corner.bone.setPosition(rest.add(off).add(this.byName.head.head).subtract(
                    this.byName[this._parentName(`risorius03.${side}`)].head), BABYLON.Space.LOCAL);
            }
        }
    }

    _parentName(name) {
        const b = this.header.bones.find((x) => x.name === name);
        return this.header.bones[b.parent].name;
    }

    // Babylon caches world matrices per frame, and anything that moved the
    // person since then has left them stale. Recompute the chain top down.
    _sync() {
        this.root.computeWorldMatrix(true);
        this.body.computeWorldMatrix(true);
        this.mesh.computeWorldMatrix(true);
    }

    // World position of a joint as currently posed.
    joint(name, which = 'head') {
        const b = this.byName[name];
        this.skeleton.computeAbsoluteMatrices(true);
        this._sync();
        const m = b.bone.getAbsoluteMatrix().multiply(this.mesh.getWorldMatrix());
        const local = which === 'head' ? V3.Zero() : b.tail.subtract(b.head);
        return V3.TransformCoordinates(local, m);
    }
}

export { HINGES, RAD };
