// What blows do to the skin they land on, and what that skin does about it
// over the next minutes.
//
// Not a picture stamped where a fist landed. Each place of the skin (each
// corner of the mesh, the seams of its picture welded back together) keeps
// what has happened to the tissue under it: how damaged it is, how red, how
// much blood has leaked out of torn vessels and how much of that has come up
// to where it shows, how swollen. A blow adds to that, more where it lands
// harder, more over bone (the skin is crushed against it), more in lax
// tissue (the eyelids); and tissue already hurt tears more easily, so the
// fifth punch to a cheek does far more than the first. Then, on its own
// clock, a few times a second and only where something is still changing:
//
// - nothing at the instant of the blow; redness (vessels opened up) comes
//   over a few seconds (the red reaction of Lewis's triple response, 3 to 15
//   s) and fades over half an hour; a hard blow's middle is blanched for a
//   few seconds;
// - torn vessels go on leaking for minutes, until they clot, and the blood
//   out comes up through the tissue to show: over bone in tens of minutes,
//   through thick flesh over hours. Red-purple at first, darker and bluer
//   over hours as it loses its oxygen; never darker than skin whose dermis
//   is full of blood (more below that does not show through it);
// - that blood spreads over hours, and settles downhill (a blow to the brow
//   ends up round the eye over a day), collecting in lax tissue;
// - the tissue swells (oedema) over minutes to hours, and the blood out
//   swells it too as it gathers: the skin is pushed out along its normal in
//   the skin's own vertex shader, its normals bent to match, and an eye
//   swells shut.
//
// The dead have no circulation: no new redness or swelling, and no new
// bleeding into a bruise past the first minute or two; blood already out
// still comes up. On the real clock: the game has no time scale of its own
// (dev/research/blunt-trauma.md has the course and its sources).
//
// Hard or repeated blows over bone split the skin (brow, cheekbone, lip on
// the teeth, scalp), and a blow to the nose makes it bleed; both through the
// wounds the rest of the body has (marks.ts, vitals.ts, runs.ts). A facial
// bone broken under the skin (bones.ts) swells and bruises round it, and
// shifts the face over it.
//
// Everything is kept in the mesh's rest space, never the skin's picture: the
// picture is shared and mirrored in places.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

const TICK = 0.2;               // seconds between the skin's own steps
const QUIET = 1;                // seconds between steps of a place only slowly settling
const STRIDE = 10;              // floats a corner sends: tint (4), shift (3), tilt (3)
const RECORDS = 16;             // recent blows whose shape (a bat's tramlines, a hard blow's pale middle) is drawn
const DOSE = 120;               // J into the soft tissue for one unit of damage at the middle of a fist's patch
const TEARS = 0.12;             // damage a blow must do before vessels tear (a light slap only reddens)
const LEAK = 0.00875;           // per second, of what tore, leaking out of the vessels at first (2.1 of it in all)
const CLOTS = 240;              // seconds for the leak to clot down to a third
const REDDENS = 3;              // seconds for redness to come up to two thirds
const FADES = 1800;             // seconds for redness to fade to a third
const SWELLS = 900;             // seconds for swelling to come up to two thirds of what it will be
const SHOWS = 600;              // seconds for blood out to come up to show through skin over bone (two thirds)
const DEEP = 10800;             // and as many more through thick flesh
const BLUES = 10800;            // seconds for blood that shows to lose most of its oxygen (red-purple to blue-purple)
const SWELL = 0.0035;           // m of oedema a unit of damage brings, over bone
const HAEMATOMA = 0.004;        // m of swelling a unit of blood out brings
const SPREADS = 1.7e-8;         // m2/s: how fast blood out spreads through the tissue, fresh (about 2 cm in all)
const SETTLES = 21600;          // seconds for that to slow to a third, as it clots
const SINKS = 1.7e-7;           // m/s: how fast blood that shows creeps downhill
const TRACKS = 5e-7;            // m/s: and deep blood, along the planes between the layers (brow to lids in a day)
const SPLITS = 1.6;             // damage over bone past which skin splits under one more blow
const MET = 0.012;              // m: a layer standing further off the skin than this is never met by its swelling
const SQUEEZE = 0.3;            // of the swelling a tight dressing presses back (a compression bandage's job)

// What hits (bones.ts's TOOLS): how stiff it is (N/m) and the patch it lands on (cm2).
const TOOLS = { fist: { k: 9e3, area: 40 }, bat: { k: 2e6, area: 8 }, flat: { k: 5e6, area: 25 }, edge: { k: 5e6, area: 2 } };
const toolOf = (mass: number, speed: number, tool?: number | string) => typeof tool === 'string' ? TOOLS[tool] ?? TOOLS.flat
    : tool !== undefined ? { k: tool, area: tool < 2e4 ? 40 : tool < 1e5 ? 30 : 25 } : mass < 1.2 && speed > 10 ? TOOLS.bat : TOOLS.flat;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const cellOf = (x: number, y: number, z: number, size: number) => ((Math.floor(x / size) + 512) * 1024 + Math.floor(y / size) + 512) * 1024 + Math.floor(z / size) + 512;

// What a facial or skull fracture (bones.ts's types) does to the face over it: swelling `swell` units over `wide` m
// round it, `blood` units of bleeding into the tissue, `eyes` blood tracking round one eye or both, and the face over
// it moved: `push` m in, `shove` m sideways (a nose knocked over, a jaw stepped).
const BROKE: Record<string, { swell: number; wide: number; blood: number; eyes?: 'near' | 'both'; push?: number; shove?: number }> = {
    nasal: { swell: 1.4, wide: 0.014, blood: 0.8, eyes: 'both', shove: 0.0045 },
    zygoma: { swell: 1.2, wide: 0.02, blood: 0.9, eyes: 'near', push: 0.003 },
    blowout: { swell: 1.8, wide: 0.02, blood: 1.2, eyes: 'near' },
    lefort1: { swell: 1.2, wide: 0.028, blood: 0.8, push: 0.003 },
    lefort2: { swell: 1.6, wide: 0.03, blood: 1, eyes: 'both', push: 0.004 },
    lefort3: { swell: 2, wide: 0.035, blood: 1.2, eyes: 'both', push: 0.005 },
    chin: { swell: 1, wide: 0.02, blood: 0.7, shove: 0.002 },
    body: { swell: 1, wide: 0.02, blood: 0.7, shove: 0.002 },
    angle: { swell: 1, wide: 0.022, blood: 0.6 },
    condyle: { swell: 0.8, wide: 0.018, blood: 0.4 },
    condyles: { swell: 0.8, wide: 0.02, blood: 0.5 },
    linear: { swell: 1.2, wide: 0.025, blood: 1.2 },
    depressed: { swell: 1.4, wide: 0.02, blood: 1.5, push: 0.004 },
    basilar: { swell: 0, wide: 0.02, blood: 0, eyes: 'both' },
};

export class Bruise {
    declare npc: any;
    declare count: number;
    declare pos: Float32Array;
    declare nor: Float32Array;
    declare owner: any[];
    declare vStart: Int32Array;
    declare vList: Int32Array;
    declare flip: Int8Array;
    declare eStart: Int32Array;
    declare eTo: Int32Array;
    declare eLen: Float32Array;
    declare grid: Map<number, number[]>;
    declare bone: Map<number, number[]> | null;
    declare lax: Float32Array;
    declare rim: Float32Array;
    declare anvil: Float32Array;
    declare damage: Float32Array;
    declare ery: Float32Array;
    declare eryT: Float32Array;
    declare leak: Float32Array;
    declare pool: Float32Array;
    declare blood: Float32Array;
    declare age: Float32Array;
    declare oed: Float32Array;
    declare oedT: Float32Array;
    declare shift: Float32Array;
    declare h: Float32Array;
    declare active: Uint8Array;
    declare list: number[];
    declare last: Float32Array;
    declare _next: number;
    declare _down: Map<any, BABYLON.Vector3>;
    declare sent: Float32Array;
    declare data: Float32Array;
    declare buffer: BABYLON.Buffer;
    declare dirty: Uint8Array;
    declare changed: number[];
    declare at: Float32Array;
    declare axis: Float32Array;
    declare face: Float32Array;
    declare records: number;
    declare clock: number;
    declare _wait: number;
    declare eyes: { side: 'L' | 'R'; centre: BABYLON.Vector3; lid: number[] }[];
    declare splits: { rest: BABYLON.Vector3; bleed: any }[];
    declare _seen: number;
    declare _nose: BABYLON.Vector3 | null;
    declare spent: number;
    declare _unknown: number;
    declare materials: BABYLON.Material[];
    declare press: Float32Array;
    declare riders: Rider[];
    declare _carry: boolean;

    constructor(npc) {
        this.npc = npc;
        const person = npc.person, { arrays } = person.lib.bodies.get(person.bodyName);
        const pos = arrays.position, nor = arrays.normal, index = arrays.index, n = person.header.vertexCount;
        // The skin's corners, those at one place (the seams of its picture) welded into one.
        const key = new Map<number, number>(), nodeOf = new Int32Array(n).fill(-1), first: number[] = [];
        const q = (x: number) => Math.round(x * 1e4) + 20000;
        for (const p of person.header.parts) {
            if (p.kind !== 'skin') continue;
            for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) {
                const k = (q(pos[v * 3]) * 4e4 + q(pos[v * 3 + 1])) * 4e4 + q(pos[v * 3 + 2]);
                let i = key.get(k);
                if (i === undefined) { i = first.length; key.set(k, i); first.push(v); }
                nodeOf[v] = i;
            }
        }
        const M = (this.count = first.length);
        this.pos = new Float32Array(M * 3);
        this.nor = new Float32Array(M * 3);
        this.owner = new Array(M);
        for (let i = 0; i < M; i++) {
            const v = first[i], rest = new V3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            this.owner[i] = npc._owner(v);
            const out = npc._outward(new V3(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]).normalize(), rest, this.owner[i]);
            this.pos.set([rest.x, rest.y, rest.z], i * 3);
            this.nor.set([out.x, out.y, out.z], i * 3);
        }
        this.grid = new Map();
        for (let i = 0; i < M; i++) {
            const c = cellOf(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], 0.02);
            (this.grid.get(c) ?? this.grid.set(c, []).get(c)).push(i);
        }
        // The brows ride on the skin they grow from: each of their corners is one of the nearest place's. (The lashes grow
        // from the lids' margins, which do not swell.)
        for (const p of person.header.parts) {
            if (p.kind !== 'brows') continue;
            for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) {
                let best = 0.02;
                this._around(new V3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), 0.02, (i, d) => { if (d < best) { best = d; nodeOf[v] = i; } });
            }
        }
        // Each place's corners, and which of them have their own normals pointing in (some under the clothes do).
        const per = new Int32Array(M + 1);
        for (let v = 0; v < n; v++) if (nodeOf[v] >= 0) per[nodeOf[v] + 1]++;
        for (let i = 0; i < M; i++) per[i + 1] += per[i];
        this.vStart = per;
        this.vList = new Int32Array(per[M]);
        this.flip = new Int8Array(n);
        const fill = per.slice(0, M);
        for (let v = 0; v < n; v++) {
            const i = nodeOf[v];
            if (i < 0) continue;
            this.vList[fill[i]++] = v;
            this.flip[v] = nor[v * 3] * this.nor[i * 3] + nor[v * 3 + 1] * this.nor[i * 3 + 1] + nor[v * 3 + 2] * this.nor[i * 3 + 2] < 0 ? -1 : 1;
        }
        // A place whose own normal had to be turned to face out is the inside of a fold (the back of an eyelid) or skin
        // under clothes: pushed out along that normal it would come through the skin in front of it. It does not swell.
        const inner = new Uint8Array(M);
        for (let i = 0; i < M; i++) { const v = first[i]; inner[i] = nor[v * 3] * this.nor[i * 3] + nor[v * 3 + 1] * this.nor[i * 3 + 1] + nor[v * 3 + 2] * this.nor[i * 3 + 2] < 0 ? 1 : 0; }
        // Which places are next to which, across the skin.
        // Each edge of each triangle as one number, sorted: an edge met once is a free edge of the skin.
        let count = 0;
        for (const p of person.header.parts) if (p.kind === 'skin') count += p.indexCount;
        const edges = new Float64Array(count);
        let m = 0;
        for (const p of person.header.parts) {
            if (p.kind !== 'skin') continue;
            for (let t = p.indexStart; t < p.indexStart + p.indexCount; t += 3) {
                for (let k = 0; k < 3; k++) {
                    const a = nodeOf[index[t + k]], b = nodeOf[index[t + (k + 1) % 3]];
                    if (a !== b) edges[m++] = Math.min(a, b) * M + Math.max(a, b);
                }
            }
        }
        const sorted = edges.subarray(0, m).sort(), held: number[] = [], degree = new Int32Array(M + 1), unique: number[] = [];
        for (let k = 0; k < m; k++) {
            if (k > 0 && sorted[k] === sorted[k - 1]) continue;
            const a = Math.floor(sorted[k] / M), b = sorted[k] % M;
            if (sorted[k + 1] !== sorted[k]) held.push(a, b);
            unique.push(a, b);
            degree[a + 1]++; degree[b + 1]++;
        }
        for (let i = 0; i < M; i++) if (inner[i]) held.push(i);
        for (let i = 0; i < M; i++) degree[i + 1] += degree[i];
        this.eStart = degree;
        this.eTo = new Int32Array(degree[M]);
        this.eLen = new Float32Array(degree[M]);
        const at = degree.slice(0, M);
        for (let k = 0; k < unique.length; k += 2) {
            const a = unique[k], b = unique[k + 1];
            const len = Math.max(5e-4, Math.hypot(this.pos[a * 3] - this.pos[b * 3], this.pos[a * 3 + 1] - this.pos[b * 3 + 1], this.pos[a * 3 + 2] - this.pos[b * 3 + 2]));
            this.eTo[at[a]] = b; this.eLen[at[a]++] = len;
            this.eTo[at[b]] = a; this.eLen[at[b]++] = len;
        }
        this.bone = null;
        for (const k of ['lax', 'damage', 'ery', 'eryT', 'leak', 'pool', 'blood', 'age', 'oed', 'oedT', 'h', 'last']) this[k] = new Float32Array(M);
        this.anvil = new Float32Array(M).fill(NaN);
        this.shift = new Float32Array(M * 3);
        this.active = new Uint8Array(M);
        this.sent = new Float32Array(M * 4);
        this._next = 0;
        this._down = new Map();
        this.list = [];
        this._landmarks();
        this._rims(held);
        this._bones();
        this._unknown = 0;

        // What the shader reads, a corner at a time, sent up only where it changed.
        this.data = new Float32Array(n * STRIDE);
        this.buffer = new BABYLON.Buffer(npc.world.scene.getEngine(), this.data, true, STRIDE);
        const mesh = person.mesh as BABYLON.Mesh;
        mesh.setVerticesBuffer(this.buffer.createVertexBuffer('bruiseTint', 0, 4));
        mesh.setVerticesBuffer(this.buffer.createVertexBuffer('bruiseShift', 4, 3));
        mesh.setVerticesBuffer(this.buffer.createVertexBuffer('bruiseTilt', 7, 3));
        // (the brows' and hair's materials made this person's own, to move them with the skin; the clothes' are already)
        const multi = mesh.material as BABYLON.MultiMaterial, subs = multi.subMaterials.slice();
        this.materials = [];
        person.header.parts.forEach((p, k) => {
            if ((p.kind !== 'brows' && p.kind !== 'hair') || !subs[k]) return;
            subs[k] = subs[k].clone(`${subs[k].name}:${mesh.name}`);
            new BruiseLayer(subs[k], this, false);
            this.materials.push(subs[k]);
        });
        multi.subMaterials = subs;
        const worn = (npc.clothes?.material as BABYLON.MultiMaterial)?.subMaterials;
        person.header.parts.forEach((p, k) => { if (p.worn && worn?.[k]) new BruiseLayer(worn[k], this, false); });
        this.dirty = new Uint8Array(n);
        this.changed = [];
        // What lies on the skin is carried out by its swelling where the swelling reaches it: the clothes and the hair
        // (corners of this same mesh) and dressings (ride()). A sleeve standing off is met only once the skin has come
        // out to it, a tight one or a dressing at once; and a tight layer presses back (`press`).
        this.press = new Float32Array(M);
        this.riders = [];
        this._carry = false;
        // (Hair presses on nothing.)
        for (const hair of [false, true]) {
            const layers: number[] = [];
            for (const p of person.header.parts) if (hair ? p.kind === 'hair' : p.worn) for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) layers.push(v);
            const at = new Float32Array(layers.length * 3);
            layers.forEach((v, k) => at.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], k * 3));
            if (layers.length) this.ride(null, at, 0, hair ? 0 : 0.3, Int32Array.from(layers));
        }
        this.at = new Float32Array(RECORDS * 4);
        this.axis = new Float32Array(RECORDS * 4);
        this.face = new Float32Array(RECORDS * 4);
        this.records = 0;
        this.clock = 0;
        this._wait = 0;
        this.splits = [];
        this._seen = npc.bones?.breaks.length ?? 0;
        this._nose = null;
        this.spent = 0;
    }

    // Where tissue is lax and swells and fills with blood easily: the eyelids most, the lips, the nose. And each eye's
    // lids, which close as they swell.
    _landmarks() {
        const by = this.npc.person.byName, M = this.count, P = this.pos;
        const eyes = (['L', 'R'] as const).map((side) => ({ side, centre: by[`eye.${side}`].head.clone(), lid: [] as number[] }));
        const mouth = [by['risorius03.L'].head, by['risorius03.R'].head];
        for (let i = 0; i < M; i++) {
            const p = new V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
            let lax = 1;
            for (const e of eyes) {
                if (p.z < e.centre.z - 0.012) continue;
                const d = V3.Distance(p, e.centre);
                lax += 1.1 * (1 - smooth(0.012, 0.042, d));
                if (d < 0.022 && Math.abs(p.y - e.centre.y) < 0.016) e.lid.push(i);
            }
            // (the lips: round the line from one corner of the mouth to the other, in front)
            const ab = mouth[1].subtract(mouth[0]), t = clamp(V3.Dot(p.subtract(mouth[0]), ab) / ab.lengthSquared(), 0, 1);
            const lips = V3.Distance(p, mouth[0].add(ab.scale(t)));
            if (p.z > mouth[0].z - 0.004) lax += 0.7 * (1 - smooth(0.007, 0.016, lips));
            this.lax[i] = lax;
        }
        this.eyes = eyes;
    }

    // The skin's free edges (the lids' margins, the lips' inner edge) do not swell out: the tissue there is held to the
    // eye, the teeth. Swelling rises with the distance across the skin from them: slowly round the eyes, where the lids
    // are thin folds that would go through each other (an eye swells shut by its lids coming down: face.ts), quickly
    // elsewhere (a lip swells nearly to its edge). `held` are those edges' places and the insides of folds.
    _rims(held: number[]) {
        const M = this.count, far = new Float32Array(M).fill(1), queue = [...held];
        for (const i of held) far[i] = 0;
        for (let head = 0; head < queue.length; head++) {
            const i = queue[head];
            for (let e = this.eStart[i]; e < this.eStart[i + 1]; e++) {
                const j = this.eTo[e], d = far[i] + this.eLen[e];
                if (d < far[j] && d < 0.02) { far[j] = d; queue.push(j); }
            }
        }
        this.rim = new Float32Array(M);
        for (let i = 0; i < M; i++) {
            const p = new V3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
            const eye = Math.min(...this.eyes.map((e) => V3.Distance(p, e.centre)));
            this.rim[i] = smooth(0.0015, eye < 0.035 ? 0.016 : 0.005, far[i]);
        }
    }

    // How hard the bone under place `i` is against the skin: 1 where it lies a few millimetres under it (brow,
    // cheekbone, shin, scalp, the lips on the teeth), 0 with three centimetres or more of flesh between. Found when
    // first needed, from the person's own skeleton (anatomy.ts) and teeth.
    _anvil(i: number) {
        if (!Number.isNaN(this.anvil[i])) return this.anvil[i];
        if (!this.bone) this._bones();
        const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
        let best = 0.03 * 0.03;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            const list = this.bone.get(cellOf(x + a * 0.03, y + b * 0.03, z + c * 0.03, 0.03));
            if (list) for (let k = 0; k < list.length; k += 3) {
                const d = (list[k] - x) ** 2 + (list[k + 1] - y) ** 2 + (list[k + 2] - z) ** 2;
                if (d < best) best = d;
            }
        }
        return (this.anvil[i] = 1 - smooth(0.004, 0.03, Math.sqrt(best)));
    }

    // The bones' and teeth's surfaces as points about 6 mm apart, filed by 3 cm.
    _bones() {
        this.bone = new Map();
        const seen = new Set<number>();
        const put = (x: number, y: number, z: number) => {
            const fine = cellOf(x, y, z, 0.006);
            if (seen.has(fine)) return;
            seen.add(fine);
            const c = cellOf(x, y, z, 0.03);
            (this.bone.get(c) ?? this.bone.set(c, []).get(c)).push(x, y, z);
        };
        const { position: P, index: I } = this.npc.insides.data, corner = new Uint8Array(P.length / 3);
        for (const part of this.npc.insides.parts) {
            if (part.kind !== 'bone' && part.kind !== 'skull' && part.kind !== 'cartilage') continue;
            for (const c of part.clusters) for (const t of c.tris) { corner[I[t]] = 1; corner[I[t + 1]] = 1; corner[I[t + 2]] = 1; }
        }
        for (let v = 0; v < corner.length; v++) if (corner[v]) put(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const person = this.npc.person, { arrays } = person.lib.bodies.get(person.bodyName);
        for (const p of person.header.parts) if (p.kind === 'teeth') {
            for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) put(arrays.position[v * 3], arrays.position[v * 3 + 1], arrays.position[v * 3 + 2]);
        }
    }

    // Each place within `far` of rest point `at`, with its distance.
    _around(at: BABYLON.Vector3, far: number, each: (i: number, d: number) => void) {
        const r = Math.ceil(far / 0.02);
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
            const list = this.grid.get(cellOf(at.x + a * 0.02, at.y + b * 0.02, at.z + c * 0.02, 0.02));
            if (list) for (const i of list) {
                const d = Math.hypot(this.pos[i * 3] - at.x, this.pos[i * 3 + 1] - at.y, this.pos[i * 3 + 2] - at.z);
                if (d < far) each(i, d);
            }
        }
    }

    _wake(i: number) {
        if (this.active[i]) return;
        this.active[i] = 1;
        this.last[i] = this.clock;
        this.list.push(i);
    }

    // How much blood is getting round the body, 1 normal; nothing with the heart stopped.
    _flow() {
        const v = this.npc.vitals;
        return v.beating && !v.dead ? clamp(v.map / 93, 0, 1.2) : 0;
    }

    // --- a blow ----------------------------------------------------------------------------------

    // Something of `mass` kg at `speed` m/s going `dir` (world) into the skin at crossing `hit` (npc.surface's), `tool`
    // what it is (wounds.ts's blow).
    blow(hit, dir: BABYLON.Vector3, mass: number, speed: number, tool?: number | string) {
        if (!hit) return;
        const started = performance.now();
        const npc = this.npc, v = npc.vitals;
        const energy = 0.5 * mass * speed * speed, what = toolOf(mass, speed, tool);
        // A bat lands along a line and leaves two bands with a pale strip between (tramlines); anything else a patch.
        const rod = what.k >= 1e5 && what.area < 15;
        const contact = Math.sqrt(what.area / Math.PI) / 100;
        // (A bat's tissue is torn at the edges of its line, either side of it: the field is as wide as the bands are apart, and
        // the shader draws the bands in it.)
        const sigma = contact * (rod ? 0.9 : 0.45);
        // A small hard face puts the same energy into less tissue.
        const peak = (energy / DOSE) * clamp(Math.sqrt(40 / what.area), 1, 3);
        const toRest = npc.restToWorld(hit.owner).clone().invert();
        const n = hit.restNormal as BABYLON.Vector3, rest = hit.rest as BABYLON.Vector3;
        const d = V3.TransformNormal(dir, toRest).normalize();
        // The bat's own line, across the way it swung (it swings flat), laid on the skin.
        let axis = V3.Cross(V3.TransformNormal(V3.Up(), toRest), d);
        axis = axis.subtract(n.scale(V3.Dot(axis, n)));
        if (axis.lengthSquared() < 1e-6) axis = V3.Cross(n, Math.abs(n.y) < 0.9 ? V3.Up() : V3.Right());
        axis.normalize();
        const flow = this._flow();
        // A body whose heart has just stopped still has blood in its vessels to bruise with, for a minute or two.
        const bleeds = flow > 0 ? 1 : 0.15 * Math.exp(-v.stopped / 120);
        let worst = -1, worstHit = 0;
        this._around(rest, Math.max(sigma * (rod ? 6 : 3.6), 0.012), (i, dist) => {
            const nx = this.nor[i * 3], ny = this.nor[i * 3 + 1], nz = this.nor[i * 3 + 2];
            // (not through to the far side of a lip, an ear or a finger)
            if (nx * n.x + ny * n.y + nz * n.z < 0.15) return;
            const ox = this.pos[i * 3] - rest.x, oy = this.pos[i * 3 + 1] - rest.y, oz = this.pos[i * 3 + 2] - rest.z;
            let r2 = dist * dist;
            if (rod) { const along = ox * axis.x + oy * axis.y + oz * axis.z; r2 -= along * along * (1 - 1 / 4.84); }
            const swells = Math.exp(-r2 / (2 * (sigma * 1.3) ** 2)), hurt = Math.exp(-r2 / (2 * sigma * sigma));
            // (too little to see: not woken)
            if (peak * swells < 0.05) return;
            const a = this._anvil(i), q = peak * hurt * (0.35 + 0.65 * a);
            const before = this.damage[i];
            this.damage[i] += q;
            const torn = Math.max(0, q * (1 + 1.2 * before) - TEARS) * this.lax[i];
            // (all of it through the leak: none out, so none swelling or showing, at the instant of the blow)
            this.leak[i] += torn * LEAK * bleeds;
            this.eryT[i] = 1 - (1 - this.eryT[i]) * Math.exp(-4 * q);
            this.oedT[i] += peak * swells * (0.35 + 0.65 * a) * (0.5 + a) * this.lax[i] * SWELL;
            if (q * a > worstHit) { worstHit = q * a; worst = i; }
            this._wake(i);
        });
        this._record(rest, rod ? contact * 0.55 : contact, axis, n, rod ? 2 : peak > 0.6 ? 1 : 0);
        if (worst >= 0) this._split(worst, worstHit, rod ? axis : null);
        this._noseBlow(rest, peak);
        this._breaks();
        this.spent += performance.now() - started;
    }

    // A recent blow's shape, for the shader: where (rest), how wide, which way a bat lay, which way the skin faced,
    // when. `kind` 2 a bat's tramlines, 1 a hard blow's ring, 0 nothing to draw but the field itself.
    _record(at: BABYLON.Vector3, wide: number, axis: BABYLON.Vector3, n: BABYLON.Vector3, kind: number) {
        if (!kind) return;
        if (this.records === RECORDS) {
            for (const a of [this.at, this.axis, this.face]) a.copyWithin(0, 4);
            this.records--;
        }
        const k = this.records++ * 4;
        this.at.set([at.x, at.y, at.z, wide], k);
        this.axis.set([axis.x, axis.y, axis.z, kind], k);
        this.face.set([n.x, n.y, n.z, this.clock], k);
    }

    // Skin crushed against bone splits: under one hard blow (a bat), or under one more of many (fists to a brow). A
    // split near one already there opens it further. Its line runs along the bone's edge (a brow, a cheekbone, a jaw)
    // or down a lip; on the scalp along the bat. Torn, not cut: ragged, zig-zag, bruised round (the bruise is ours).
    _split(i: number, hit: number, along: BABYLON.Vector3 | null) {
        const npc = this.npc, v = npc.vitals;
        const at = new V3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), n = new V3(this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]);
        // (The scalp and face are thin over bone and split far more readily than a limb.)
        const by = npc.person.byName, head = at.y > by['jaw'].head.y - 0.06 && V3.Distance(at, by['head'].head) < 0.17;
        const total = this.damage[i] * this._anvil(i);
        if (hit < (head ? 0.9 : 1.8) && !(total > SPLITS * (head ? 1 : 1.6) && hit > 0.12)) return;
        const old = this.splits.find((s) => V3.Distance(s.rest, at) < 0.015);
        if (old) { old.bleed.rate += head ? 0.0003 : 0.0001; return; }
        const lip = this.lax[i] > 1.3 && !this.eyes.some((e) => V3.Distance(at, e.centre) < 0.04);
        let way = along ?? (lip ? V3.Up() : V3.Right());
        if (!along && !head) way = V3.Cross(n, new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5));
        way = way.subtract(n.scale(V3.Dot(way, n))).normalize();
        const side = V3.Cross(n, way);
        const long = 0.009 + 0.011 * clamp(hit - 0.4, 0, 1), steps = 7;
        const path = [];
        for (let k = 0; k <= steps; k++) {
            const t = k / steps - 0.5, jag = k === 0 || k === steps ? 0 : (Math.random() - 0.5) * 0.004;
            const c = npc.runs.nearest(at.add(way.scale(t * long)).add(side.scale(jag)), 0.02);
            if (c?.kind === 'skin') path.push(c);
        }
        if (path.length < 2) return;
        const deep = 0.0025 + 0.002 * clamp(hit, 0, 1);
        for (let k = 0; k + 1 < path.length; k++) {
            const t = (k + 0.5) / (path.length - 1);
            npc.marks.cut(path[k], path[k + 1], deep * (0.5 + 0.5 * Math.sin(Math.PI * t)), 0.4 + 0.5 * Math.sin(Math.PI * t));
        }
        const mid = path[Math.floor(path.length / 2)];
        // The scalp and face bleed far more than skin anywhere else split as far.
        const bleed = v.bleed({ name: 'laceration', rate: head ? 0.0007 : 0.0001, clots: 0.012, source: { mark: mid } });
        npc.welling(mid, 1.2);
        this.splits.push({ rest: at, bleed });
        v.pain = Math.min(1, v.pain + 0.1);
        v.injure(`Skin split by the blow over the ${this._where(i, lip)}`, 2);
    }

    _where(i: number, lip: boolean) {
        const at = new V3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
        const eye = this.eyes.reduce((a, b) => (V3.Distance(at, a.centre) < V3.Distance(at, b.centre) ? a : b));
        const side = eye.centre.x < 0 ? 'left' : 'right', dy = at.y - eye.centre.y, de = V3.Distance(at, eye.centre);
        if (lip) return 'lip';
        if (de < 0.05 && dy > 0.006) return `${side} brow`;
        if (de < 0.06 && dy < -0.006 && dy > -0.04) return `${side} cheekbone`;
        if (de < 0.11 && dy > 0.04) return 'forehead';
        if (de < 0.12) return dy < -0.04 ? 'jaw' : 'scalp';
        const seg = this.npc.ragdoll.nearest(V3.TransformCoordinates(at, this.npc.restToWorld(this.owner[i]))).seg?.name ?? '';
        return { upperarm: 'arm', forearm: 'forearm', hand: 'hand', thigh: 'thigh', shin: 'shin', chest: 'ribs', belly: 'belly' }[seg.replace(/2?[LR]$/, '')] ?? 'bone';
    }

    // A blow to the nose makes it bleed from the nostrils (the vessels just inside, Kiesselbach's area), broken or not.
    _noseBlow(rest: BABYLON.Vector3, peak: number) {
        const tip = this._noseTip();
        if (!tip || V3.Distance(rest, tip) > 0.028 || peak < 0.2) return;
        const v = this.npc.vitals;
        if (v.bleeds.some((b) => b.name === 'nosebleed' && b.rate > 2e-5)) return;
        const nostril = this.npc.runs.nearest(tip.add(new V3(0, -0.013, -0.007)), 0.02);
        if (nostril?.kind !== 'skin') return;
        v.bleed({ name: 'nosebleed', rate: 0.00008 + 0.0002 * clamp(peak, 0, 1.5), clots: 0.008, source: { mark: nostril } });
        this.npc.welling(nostril, 0.5);
    }

    // The tip of the nose: the skin furthest forward on the middle line between the eyes and the mouth.
    _noseTip() {
        if (this._nose) return this._nose;
        const [l, r] = this.eyes.map((e) => e.centre), mouth = this.npc.person.byName['risorius03.L'].head;
        const mid = (l.x + r.x) / 2;
        let best = -1;
        for (let i = 0; i < this.count; i++) {
            const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
            if (Math.abs(x - mid) > 0.006 || y > l.y - 0.01 || y < mouth.y + 0.008) continue;
            if (best < 0 || z > this.pos[best * 3 + 2]) best = i;
        }
        return (this._nose = best < 0 ? null : new V3(this.pos[best * 3], this.pos[best * 3 + 1], this.pos[best * 3 + 2]));
    }

    // Bones of the face and skull broken since last looked: swelling and bleeding round each, and the face over it
    // moved as the bone under it was.
    _breaks() {
        const breaks = this.npc.bones?.breaks;
        if (!breaks) return;
        for (; this._seen < breaks.length; this._seen++) {
            const br = breaks[this._seen], how = BROKE[br.type];
            if (!how || br.how === 'shot') continue;
            const at = br.at as BABYLON.Vector3;
            this._around(at, how.wide * 2.5, (i, dist) => {
                const w = Math.exp(-(dist * dist) / (2 * how.wide * how.wide));
                this.oedT[i] += how.swell * w * this.lax[i] * SWELL * 1.5;
                this.leak[i] += how.blood * w * LEAK * this.lax[i];
                this.damage[i] += how.swell * w * 0.5;
                const n = new V3(this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]);
                const sideways = br.dir ? Math.sign((br.dir as BABYLON.Vector3).x || 1) : 1;
                const s = this.shift, near = Math.exp(-(dist * dist) / (2 * (how.wide * 0.7) ** 2));
                if (how.push) { s[i * 3] -= n.x * how.push * near; s[i * 3 + 1] -= n.y * how.push * near; s[i * 3 + 2] -= n.z * how.push * near; }
                if (how.shove) s[i * 3] += sideways * how.shove * near;
                this.sent[i * 4 + 3] = NaN;
                this._wake(i);
            });
            // Blood tracks round the eyes from a broken nose or midface, and from the skull's floor (raccoon eyes).
            if (how.eyes) for (const e of this.eyes) {
                if (how.eyes === 'near' && V3.Distance(e.centre, at) > V3.Distance(this.eyes.find((o) => o !== e).centre, at)) continue;
                this._around(e.centre.add(new V3(0, -0.006, 0.012)), 0.03, (i, dist) => {
                    if (this.pos[i * 3 + 2] < e.centre.z - 0.01) return;
                    const w = Math.exp(-(dist * dist) / (2 * 0.012 * 0.012));
                    this.pool[i] += (how.blood || 0.8) * w * this.lax[i] * 0.5;
                    this.oedT[i] += (how.swell || 0.5) * w * this.lax[i] * SWELL * 0.6;
                    this._wake(i);
                });
            }
        }
    }

    // --- the skin's own clock ----------------------------------------------------------------------

    // Each frame a share of the places still changing take their step, so that each steps about every TICK and no one
    // frame pays for all of them; what they changed goes up to the card every TICK.
    update(dt: number) {
        this.clock += dt;
        const started = performance.now();
        if (this._seen < (this.npc.bones?.breaks.length ?? 0)) this._breaks();
        if (this.list.length) this._step(Math.ceil(this.list.length * Math.min(1, dt / TICK)));
        // Nothing to do: how near the bone is, found ahead of the blows, a little at a time.
        else for (let k = 0; k < 32 && this._unknown < this.count; k++) this._anvil(this._unknown++);
        if ((this._wait -= dt) <= 0) {
            this._wait = TICK;
            this._send();
            this._eyes();
        }
        this.spent += performance.now() - started;
    }

    _step(quota: number) {
        const v = this.npc.vitals, flow = this._flow();
        // A stopped heart lets a torn vessel ooze a little, briefly.
        const late = flow > 0 ? flow : 0.15 * Math.exp(-v.stopped / 120);
        this._down.clear();
        for (let n = 0; n < quota && this.list.length; n++) {
            if (this._next >= this.list.length) this._next = 0;
            const i = this.list[this._next];
            // A place only slowly settling (no blood still coming, its swelling up) steps once a second.
            if (this.leak[i] === 0 && this.pool[i] < 0.02 && this.clock - this.last[i] < QUIET && Math.abs(this.oedT[i] - this.oed[i]) < 2e-4) {
                this._next++;
                n -= 0.875;
                continue;
            }
            const dt = Math.min(QUIET * 1.5, this.clock - this.last[i]);
            this.last[i] = this.clock;
            if (this.leak[i] > 0) {
                this.pool[i] += this.leak[i] * dt * late;
                this.leak[i] *= Math.exp(-dt / (flow > 0 ? CLOTS : 60));
                if (this.leak[i] < 1e-5) this.leak[i] = 0;
            }
            // Blood out comes up to show: over bone in tens of minutes, through thick flesh over hours.
            if (this.pool[i] > 0) {
                const up = this.pool[i] * Math.min(1, dt / (SHOWS + DEEP * (1 - this._anvil(i))));
                this.pool[i] -= up;
                this.age[i] = (this.age[i] * this.blood[i]) / (this.blood[i] + up + 1e-9);
                this.blood[i] += up;
            }
            this.age[i] += dt;
            // Redness needs blood coming: it goes from a dead face within seconds.
            this.ery[i] += (this.eryT[i] * Math.min(1, flow) - this.ery[i]) * Math.min(1, dt / (flow > 0 ? REDDENS : 15));
            this.eryT[i] *= Math.exp(-dt / FADES);
            if (flow > 0) this.oed[i] += (this.oedT[i] - this.oed[i]) * Math.min(1, (dt * flow) / SWELLS);
            if (this.blood[i] > 1e-4 || this.pool[i] > 1e-4) this._spread(i, flow > 0 ? dt : dt * 0.3);
            this._touch(i);
            // What is still changing stays on the clock; what has settled leaves it.
            const busy = this.leak[i] > 0 || this.pool[i] > 2e-3 || this.eryT[i] > 0.004 || Math.abs(this.ery[i] - this.eryT[i] * Math.min(1, flow)) > 0.004
                || (flow > 0 && this.oedT[i] - this.oed[i] > 2e-5) || (this.blood[i] > 0.01 && this.age[i] < 3 * BLUES);
            if (busy) { this._next++; continue; }
            this.active[i] = 0;
            const last = this.list.pop();
            if (this._next < this.list.length) this.list[this._next] = last;
        }
    }

    // Blood out from place `i` spreads to where there is less, slower as it clots, into lax tissue most; and creeps
    // downhill, the deep blood faster, along the planes between the layers; slower with no heart pushing it. (An edge
    // between two places both on the clock is taken half by each.)
    _spread(i: number, dt: number) {
        const P = this.pos, owner = this.owner[i];
        let g = this._down.get(owner);
        if (!g) { g = V3.TransformNormal(new V3(0, -1, 0), this.npc.restToWorld(owner).clone().invert()).normalize(); this._down.set(owner, g); }
        const slow = Math.exp(-this.age[i] / SETTLES), li = this.lax[i];
        for (let e = this.eStart[i]; e < this.eStart[i + 1]; e++) {
            const j = this.eTo[e], len = this.eLen[e], lj = this.lax[j], half = this.active[j] ? 0.5 : 1;
            const w = Math.min(0.08, (SPREADS * slow * dt) / (len * len)) * Math.min(li, lj);
            const hill = ((P[j * 3] - P[i * 3]) * g.x + (P[j * 3 + 1] - P[i * 3 + 1]) * g.y + (P[j * 3 + 2] - P[i * 3 + 2]) * g.z) / len;
            const sink = Math.min(0.1, (SINKS * dt) / len) * hill, track = Math.min(0.15, (TRACKS * dt) / len) * hill;
            let fb = w * (this.blood[i] / li - this.blood[j] / lj), fp = w * (this.pool[i] / li - this.pool[j] / lj);
            fb = (fb + (sink > 0 ? sink * this.blood[i] * slow : sink * this.blood[j] * slow)) * half;
            fp = (fp + (track > 0 ? track * this.pool[i] : track * this.pool[j])) * half;
            fb = clamp(fb, -this.blood[j] * 0.5, this.blood[i] * 0.5);
            fp = clamp(fp, -this.pool[j] * 0.5, this.pool[i] * 0.5);
            if (fb > 0) this.age[j] = (this.age[j] * this.blood[j] + this.age[i] * fb) / (this.blood[j] + fb);
            this.blood[i] -= fb; this.blood[j] += fb;
            this.pool[i] -= fp; this.pool[j] += fp;
            if (!this.active[j] && (Math.abs(fb) > 1e-4 || Math.abs(fp) > 1e-4)) this._wake(j);
        }
    }

    // Place `i` drawn again if it changed enough to see, and the places round it if its swelling did (it bends their
    // normals too).
    _touch(i: number) {
        const cap = 0.003 + 0.006 * this.lax[i];
        const swollen = this.oed[i] + HAEMATOMA * (this.pool[i] + this.blood[i]);
        const h = (this.h[i] = cap * (1 - Math.exp(-swollen / cap)) * this.rim[i] * (1 - SQUEEZE * this.press[i]));
        const w = this.sent, blue = 1 - Math.exp(-this.age[i] / BLUES);
        const moved = !(Math.abs(h - w[i * 4 + 3]) < 6e-5);
        if (!moved && Math.abs(this.ery[i] - w[i * 4]) < 0.004 && Math.abs(this.blood[i] - w[i * 4 + 1]) < 0.004 && Math.abs(blue - w[i * 4 + 2]) < 0.02) return;
        w.set([this.ery[i], this.blood[i], blue, h], i * 4);
        this._write(i, blue);
        if (moved) for (let e = this.eStart[i]; e < this.eStart[i + 1]; e++) this._write(this.eTo[e], w[this.eTo[e] * 4 + 2]);
    }

    // What the shader reads at place `i`'s corners: its colour (redness, blood showing, how blue that blood has gone,
    // swelling in cm), how far it moved (swollen out along its normal, and the bone under it moved), and how its normal
    // tips with the swelling's slope.
    _write(i: number, blue: number) {
        const P = this.pos, N = this.nor, h = this.h;
        // The swelling's slope across the skin: the change to each neighbour along the way to it, over how far.
        let gx = 0, gy = 0, gz = 0, wsum = 0;
        for (let e = this.eStart[i]; e < this.eStart[i + 1]; e++) {
            const j = this.eTo[e], dh = h[j] - h[i];
            const x = P[j * 3] - P[i * 3], y = P[j * 3 + 1] - P[i * 3 + 1], z = P[j * 3 + 2] - P[i * 3 + 2];
            gx += dh * x; gy += dh * y; gz += dh * z;
            wsum += x * x + y * y + z * z;
        }
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        if (wsum > 0) { gx *= 2 / wsum; gy *= 2 / wsum; gz *= 2 / wsum; }
        const along = gx * nx + gy * ny + gz * nz;
        gx -= along * nx; gy -= along * ny; gz -= along * nz;
        const sx = nx * h[i] + this.shift[i * 3], sy = ny * h[i] + this.shift[i * 3 + 1], sz = nz * h[i] + this.shift[i * 3 + 2];
        const D = this.data;
        this._carry = true;
        for (let k = this.vStart[i]; k < this.vStart[i + 1]; k++) {
            const v = this.vList[k], o = v * STRIDE, f = -this.flip[v];
            D[o] = this.ery[i]; D[o + 1] = this.blood[i]; D[o + 2] = blue; D[o + 3] = h[i] * 100;
            D[o + 4] = sx; D[o + 5] = sy; D[o + 6] = sz;
            D[o + 7] = gx * f; D[o + 8] = gy * f; D[o + 9] = gz * f;
            if (!this.dirty[v]) { this.dirty[v] = 1; this.changed.push(v); }
        }
    }

    // What changed, up to the card: the corners changed, in runs (gaps of a few corners sent along with them).
    _send() {
        if (this._carry) this._carried();
        const changed = this.changed;
        if (!changed.length) return;
        changed.sort((a, b) => a - b);
        let from = changed[0], to = from;
        const flush = () => this.buffer.updateDirectly(this.data.subarray(from * STRIDE, (to + 1) * STRIDE), from * STRIDE, to - from + 1);
        for (const v of changed) {
            this.dirty[v] = 0;
            if (v - to > 48) { flush(); from = v; }
            to = v;
        }
        flush();
        changed.length = 0;
    }

    // An eye swells shut: the face (face.ts) closes its lids as far as the swelling round them has come up.
    _eyes() {
        const face = this.npc.face;
        if (!face) return;
        for (const e of this.eyes) {
            // (how swollen the tissue of the lids is, whatever their margins do)
            let sum = 0;
            for (const i of e.lid) { const cap = 0.003 + 0.006 * this.lax[i]; sum += cap * (1 - Math.exp(-(this.oed[i] + HAEMATOMA * (this.pool[i] + this.blood[i])) / cap)); }
            face.swollen[e.side] = smooth(0.002, 0.008, e.lid.length ? sum / e.lid.length : 0);
        }
    }

    // A layer over the skin to be carried out by its swelling: corners at rest positions `at` (x, y, z each), standing
    // `base` m off the skin where they lie on it, pressing on it by `tight` (0 to 1) where they do. `mesh` given, the
    // layer is a mesh of its own (a dressing) and is given its own shift to read; otherwise it is corners `slots` of
    // this person's mesh.
    ride(mesh: BABYLON.Mesh | null, at: ArrayLike<number>, base: number, tight: number, slots: Int32Array | null = null): Rider {
        const n = at.length / 3, place = new Int32Array(n).fill(-1), gap = new Float32Array(n), P = this.pos, N = this.nor, p = new V3();
        for (let k = 0; k < n; k++) {
            p.set(at[k * 3], at[k * 3 + 1], at[k * 3 + 2]);
            let best = MET;
            this._around(p, MET, (i, d) => {
                const off = (p.x - P[i * 3]) * N[i * 3] + (p.y - P[i * 3 + 1]) * N[i * 3 + 1] + (p.z - P[i * 3 + 2]) * N[i * 3 + 2];
                if (off > -0.003 && d < best) { best = d; place[k] = i; gap[k] = Math.max(0, off - base); }
            });
        }
        const r: Rider = { mesh, buffer: null, data: this.data, stride: STRIDE, offset: 4, slots, place, gap, tight };
        if (mesh) {
            r.data = new Float32Array(n * 3);
            r.stride = 3;
            r.offset = 0;
            r.buffer = new BABYLON.Buffer(this.npc.world.scene.getEngine(), r.data, true, 3);
            mesh.setVerticesBuffer(r.buffer.createVertexBuffer('bruiseShift', 0, 3));
        }
        this.riders.push(r);
        this._pressed();
        this._carry = true;
        this._carried();
        return r;
    }

    unride(r: Rider) {
        const k = this.riders.indexOf(r);
        if (k < 0) return;
        this.riders.splice(k, 1);
        r.buffer?.dispose();
        this._pressed();
    }

    // How hard what lies on each place presses on it: a tight layer touching it all of its own `tight`, nothing from one
    // standing 3 mm or more off. Places whose press changed are put back on the clock to swell to it.
    _pressed() {
        const was = this.press.slice();
        this.press.fill(0);
        for (const r of this.riders) {
            for (let k = 0; k < r.place.length; k++) {
                const i = r.place[k];
                if (i >= 0) this.press[i] = Math.max(this.press[i], r.tight * (1 - smooth(0, 0.003, r.gap[k])));
            }
        }
        for (let i = 0; i < this.count; i++) if (this.press[i] !== was[i] && this.oed[i] + this.pool[i] + this.blood[i] > 0) this._wake(i);
    }

    // Every layer moved out by as much of the swelling under it as reaches it.
    _carried() {
        this._carry = false;
        const h = this.h, N = this.nor, S = this.shift;
        for (const r of this.riders) {
            let lo = Infinity, hi = -1;
            for (let k = 0; k < r.place.length; k++) {
                const i = r.place[k];
                if (i < 0) continue;
                const out = Math.max(0, h[i] - r.gap[k]), v = r.slots ? r.slots[k] : k, o = v * r.stride + r.offset, D = r.data;
                const x = N[i * 3] * out + S[i * 3], y = N[i * 3 + 1] * out + S[i * 3 + 1], z = N[i * 3 + 2] * out + S[i * 3 + 2];
                if (Math.abs(D[o] - x) + Math.abs(D[o + 1] - y) + Math.abs(D[o + 2] - z) < 2e-5) continue;
                D[o] = x; D[o + 1] = y; D[o + 2] = z;
                if (!r.buffer) { if (!this.dirty[v]) { this.dirty[v] = 1; this.changed.push(v); } }
                else { lo = Math.min(lo, k); hi = k; }
            }
            if (r.buffer && hi >= 0) r.buffer.updateDirectly(r.data.subarray(lo * 3, (hi + 1) * 3), lo * 3, hi - lo + 1);
        }
    }

    dispose() {
        for (const r of this.riders) r.buffer?.dispose();
        this.buffer.dispose();
        for (const m of this.materials) m.dispose();
    }
}

// --- drawing it ---------------------------------------------------------------------------------
//
// In the skin's own shaders. The vertex shader moves each corner out by its swelling (and the bone under it) before the
// skeleton moves it, and tips its normal by the swelling's slope. The fragment shader colours the skin by what is in it:
// haemoglobin under the skin takes out green and blue far more than red, so a little blood near the surface is red-purple;
// deeper, and as it loses its oxygen, it takes more red and leaves blue, going purple to blue-black. Redness is opened
// vessels: more red, less green. Blotchy, with an uneven edge and pinpoint bleeds round a fresh one, never a smooth disc.
// A bat's two bands with the pale strip between (the tissue under the bat is crushed and its vessels survive; those at its
// edges tear), and a hard blow's blanched middle, are drawn from the last few blows' shapes and fade as the blood spreads.

const GLSL_NOISE = `
float bruiseHash(vec3 p) { return fract(sin(dot(p, vec3(41.3, 289.1, 113.7))) * 43758.5453); }
float bruiseNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(bruiseHash(i), bruiseHash(i + vec3(1, 0, 0)), f.x), mix(bruiseHash(i + vec3(0, 1, 0)), bruiseHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(bruiseHash(i + vec3(0, 0, 1)), bruiseHash(i + vec3(1, 0, 1)), f.x), mix(bruiseHash(i + vec3(0, 1, 1)), bruiseHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const GLSL_BRUISE = `
#ifdef BRUISE
float bruiseGloss = 0.0;
{
    vec4 bt = vBruiseTint;
    float pat = 0.0, pale = 0.0;
    for (int i = 0; i < ${RECORDS}; i++) {
        if (float(i) >= bruiseCount) break;
        vec3 d = vBruiseRest - bruiseAt[i].xyz;
        float rc = bruiseAt[i].w;
        if (dot(d, d) > 16.0 * rc * rc) continue;
        vec3 n = bruiseFace[i].xyz;
        float off = dot(d, n);
        if (abs(off) > 1.5 * rc + 0.01) continue;
        vec3 fl = d - n * off;
        float age = bruiseNow - bruiseFace[i].w, q = 0.0, mid = 0.0;
        if (bruiseAxis[i].w > 1.5) {
            // Tramlines: the bat's line across the skin, bands either side of it.
            vec3 ax = bruiseAxis[i].xyz, ac = normalize(cross(ax, n));
            float u = abs(dot(fl, ac)) / rc + (bruiseNoise(vBruiseRest * 700.0) - 0.5) * 0.25, v = abs(dot(fl, ax)) / (rc * 3.5);
            float ends = 1.0 - smoothstep(0.55, 1.0, v);
            mid = exp(-u * u / 0.3) * ends;
            q = (exp(-(u - 1.15) * (u - 1.15) / 0.1) - mid) * ends;
        } else {
            float r = length(fl) / rc + (bruiseNoise(vBruiseRest * 500.0) - 0.5) * 0.3;
            mid = 1.0 - smoothstep(0.3, 0.7, r);
            q = exp(-(r - 0.9) * (r - 0.9) / 0.06) - mid;
        }
        pat += q * exp(-age / 480.0);
        pale = max(pale, mid * exp(-age / 6.0));
    }
    float n1 = bruiseNoise(vBruiseRest * 160.0), n2 = bruiseNoise(vBruiseRest * 1400.0), n3 = bruiseNoise(vBruiseRest * 48.0);
    float b = bt.y * clamp(1.0 + pat * 0.85, 0.3, 2.2) * (0.62 + 0.5 * n3 + 0.3 * (n1 - 0.5));
    // The dermis full of blood is as dark as a bruise gets: blood under that does not show through it.
    b = 0.8 * (1.0 - exp(-b / 0.8));
    // A thin edge shows only in places; pinpoint bleeds round a fresh one.
    b = max(0.0, b - 0.07 * (1.0 - n1));
    b += step(0.92, n2) * smoothstep(0.08, 0.2, bt.y) * (1.0 - smoothstep(0.3, 0.7, bt.y)) * 0.3 * (1.0 - smoothstep(0.2, 0.6, bt.z));
    vec3 absorb = mix(vec3(1.2, 2.4, 2.0), vec3(2.0, 2.1, 1.25), bt.z);
    surfaceAlbedo *= exp(-absorb * b);
    float ery = clamp(bt.x * clamp(1.0 + pat * 0.5, 0.0, 1.6) * (1.0 - 0.9 * pale) * (0.8 + 0.4 * n3), 0.0, 1.0);
    surfaceAlbedo *= mix(vec3(1.0), vec3(1.1, 0.56, 0.6), ery);
    surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * 1.12 + 0.01, pale * 0.6);
    // Skin stretched over a swelling is tight and shines.
    bruiseGloss = smoothstep(0.25, 1.2, bt.w) * 0.15;
}
#endif
`;

// A layer carried by the swelling (Bruise.ride).
type Rider = { mesh: BABYLON.Mesh | null; buffer: BABYLON.Buffer | null; data: Float32Array; stride: number; offset: number; slots: Int32Array | null;
    place: Int32Array; gap: Float32Array; tight: number };

export class BruiseLayer extends BABYLON.MaterialPluginBase {
    declare bruise: Bruise;
    declare colour: boolean;

    // Before Gore (225): a wound's flesh is drawn over the bruise round it. Without `colour`, it only moves the surface
    // with the skin's swelling (brows, lashes).
    constructor(material: BABYLON.Material, bruise: Bruise, colour = true) {
        super(material, 'Bruise', 220, { BRUISE: false, BRUISE_SHIFT: false });
        this.bruise = bruise;
        this.colour = colour;
        this._enable(true);
    }

    getClassName() { return 'BruiseLayer'; }

    prepareDefines(defines) { defines.BRUISE = this.colour; defines.BRUISE_SHIFT = true; }

    getAttributes(attributes: string[]) { attributes.push(...(this.colour ? ['bruiseTint', 'bruiseShift', 'bruiseTilt'] : ['bruiseShift'])); }

    // (Declared in the shader's own definitions below, as Hider's are: the material uses a uniform buffer.)
    getUniforms() { return { externalUniforms: ['bruiseAt', 'bruiseAxis', 'bruiseFace', 'bruiseCount', 'bruiseNow'] }; }

    bindForSubMesh(_ubo, _scene, _engine, subMesh) {
        const effect = subMesh.effect, b = this.bruise;
        if (!effect || !this.colour) return;
        effect.setFloat('bruiseCount', b.records);
        effect.setFloat('bruiseNow', b.clock);
        if (!b.records) return;
        effect.setFloatArray4('bruiseAt', b.at);
        effect.setFloatArray4('bruiseAxis', b.axis);
        effect.setFloatArray4('bruiseFace', b.face);
    }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') {
            return {
                CUSTOM_VERTEX_DEFINITIONS: '#ifdef BRUISE_SHIFT\nattribute vec3 bruiseShift;\n#endif\n#ifdef BRUISE\nattribute vec4 bruiseTint;\nattribute vec3 bruiseTilt;\nvarying vec4 vBruiseTint;\nvarying vec3 vBruiseRest;\n#endif\n',
                CUSTOM_VERTEX_UPDATE_POSITION: '#ifdef BRUISE_SHIFT\npositionUpdated += bruiseShift;\n#endif\n',
                CUSTOM_VERTEX_UPDATE_NORMAL: '#if defined(BRUISE) && defined(NORMAL)\nnormalUpdated = normalize(normalUpdated + bruiseTilt);\n#endif\n',
                CUSTOM_VERTEX_MAIN_END: '#ifdef BRUISE\nvBruiseTint = bruiseTint;\nvBruiseRest = position;\n#endif\n',
            };
        }
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef BRUISE\nvarying vec4 vBruiseTint;\nvarying vec3 vBruiseRest;\nuniform vec4 bruiseAt[${RECORDS}];\nuniform vec4 bruiseAxis[${RECORDS}];\nuniform vec4 bruiseFace[${RECORDS}];\nuniform float bruiseCount;\nuniform float bruiseNow;\n${GLSL_NOISE}#endif\n`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_BRUISE,
            // (Hider and FilmLayer each take a whole line of this as their point: two plugins at one point repeat its line.)
            '!(diffuseRoughness=reflectivityOut\\.diffuseRoughness;)': `$1
#ifdef BRUISE
microSurface = mix(microSurface, 0.8, bruiseGloss);
roughness = 1.0 - microSurface;
#endif
`,
        };
    }
}
