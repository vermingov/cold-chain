// What is inside a person, where it is now, and what a line through them meets.
//
// The parts are tools/anatomy.py's: the skeleton, the organs of the head,
// chest and belly from BodyParts3D, fitted to each body, every one hung from
// a bone of its skeleton. They are kept in that bone's rest space and never
// moved: a question about the world (where does this shot go?) is turned into
// each bone's rest space instead, which is one matrix per bone, not a hundred
// thousand corners skinned every frame.
//
// A long bone is in two halves, like the limb it is in (ragdoll.ts): the half
// past the middle hangs from the mid bone, so a broken femur shows broken.
// Where a bone breaks is drawn by bones.ts and shards.ts.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

const CLUSTER = 48;     // triangles to a box of the coarse tree each part's triangles are sorted into

const files = new Map<string, Promise<any>>();

// One file per body, fetched once.
export function loadAnatomy(url: string) {
    if (!files.has(url)) files.set(url, (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(url + ': ' + res.status);
        const buf = await res.arrayBuffer();
        const view = new DataView(buf);
        if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'CCAF') throw new Error(url + ': not an anatomy');
        const length = view.getUint32(8, true);
        const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, length)));
        const at = (name) => header.arrays.find((a) => a.name === name);
        const base = 12 + length;
        return {
            header,
            position: new Float32Array(buf, base + at('position').offset, at('position').length / 4),
            normal: new Float32Array(buf, base + at('normal').offset, at('normal').length / 4),
            index: new Uint32Array(buf, base + at('index').offset, at('index').length / 4),
        };
    })());
    return files.get(url);
}

// What each kind of thing looks like when it is seen (the x-ray), and when it is hurt.
const LOOKS = {
    bone: [0.86, 0.82, 0.7], skull: [0.86, 0.82, 0.7], cartilage: [0.78, 0.8, 0.82], brain: [0.78, 0.6, 0.6], brainstem: [0.78, 0.6, 0.6], heart: [0.55, 0.08, 0.08],
    lung: [0.85, 0.5, 0.52], liver: [0.4, 0.09, 0.07], spleen: [0.38, 0.1, 0.18], kidney: [0.5, 0.15, 0.12], stomach: [0.8, 0.52, 0.48],
    bowel: [0.85, 0.6, 0.55], colon: [0.75, 0.55, 0.45], bladder: [0.85, 0.75, 0.55], pancreas: [0.85, 0.7, 0.5], gallbladder: [0.3, 0.45, 0.2],
    adrenal: [0.85, 0.6, 0.2], muscle: [0.55, 0.15, 0.12], airway: [0.85, 0.75, 0.7], oesophagus: [0.8, 0.5, 0.45],
    artery: [0.75, 0.05, 0.05], vein: [0.2, 0.15, 0.45], cord: [0.92, 0.88, 0.7],
};

export class Insides {
    declare person: any;
    declare parts: any[];
    declare tubes: any[];
    declare data: any;
    declare mesh: BABYLON.Mesh;
    declare hurtMaterial: Record<string, number>;
    declare drawn: Uint32Array;

    constructor(person, data) {
        this.person = person;
        this.data = data;
        const { byName } = person;
        // A long bone's half past the middle belongs to the mid bone (ragdoll.ts's withMidBones).
        const halves = (boneName) => {
            const m = /^(\w+01)\.([LR])$/.exec(boneName);
            const mid = m && byName[`mid-${m[1]}.${m[2]}`];
            return mid ? { first: byName[boneName], mid, from: byName[boneName].head, to: mid.tail } : null;
        };
        // The head and neck hang from the neck's first bone in the file, but a turn of the head is spread over the neck's
        // bones down to the skull (ragdoll.ts): each piece goes with the neck bone at its height, the skull with the head's.
        const neck = ['neck01', 'neck02', 'neck03', 'head'].map((n) => byName[n]);
        const ownerAt = (boneName, x, y, z) => {
            if (boneName === 'neck01') return neck.findLast((b) => b.head.y <= y) ?? neck[0];
            const h = halves(boneName);
            if (!h) return byName[boneName];
            const d = h.to.subtract(h.from);
            const t = ((x - h.from.x) * d.x + (y - h.from.y) * d.y + (z - h.from.z) * d.z) / d.lengthSquared();
            return t > 0.5 ? h.mid : h.first;
        };

        const { position, index } = data;
        this.parts = [];
        for (const p of data.header.parts) {
            // The triangles of the part by which bone carries them.
            const groups = new Map();
            for (let i = p.indexStart; i < p.indexStart + p.indexCount; i += 3) {
                const a = index[i], b = index[i + 1], c = index[i + 2];
                const x = (position[a * 3] + position[b * 3] + position[c * 3]) / 3;
                const y = (position[a * 3 + 1] + position[b * 3 + 1] + position[c * 3 + 1]) / 3;
                const z = (position[a * 3 + 2] + position[b * 3 + 2] + position[c * 3 + 2]) / 3;
                const owner = ownerAt(p.bone, x, y, z);
                if (!groups.has(owner)) groups.set(owner, []);
                groups.get(owner).push(i);
            }
            for (const [owner, tris] of groups) {
                this.parts.push({ name: p.name, kind: p.kind, source: p, owner, half: groups.size > 1 ? (owner === byName[p.bone] ? 'upper' : 'lower') : null,
                    clusters: cluster(position, index, tris) });
            }
        }
        this.tubes = data.header.tubes.map((t) => ({
            name: t.name, kind: t.kind,
            points: t.path.map(([x, y, z, r], i) => ({ rest: new V3(x, y, z), r, owner: ownerAt(t.bones[i], x, y, z) })),
            cut: new Set<number>(),
        }));
    }

    // Each bone's matrix from the person's rest space to the world as they are now.
    _restToWorld() {
        const { person } = this;
        person.skeleton.computeAbsoluteMatrices(true);
        person._sync();
        const world = person.mesh.getWorldMatrix();
        const out = new Map();
        const get = (owner) => {
            if (!out.has(owner)) {
                const m = BABYLON.Matrix.Translation(-owner.head.x, -owner.head.y, -owner.head.z).multiply(owner.bone.getAbsoluteMatrix()).multiply(world);
                out.set(owner, { m, inv: m.clone().invert() });
            }
            return out.get(owner);
        };
        return get;
    }

    // Everything the line from `origin` along unit `dir` passes through, nearer than `far`: [{ part, enter, leave }] in
    // order, and the vessels it comes within `reach` of: [{ tube, at (index of the point), t, miss }]. `only` the parts
    // it says, if given.
    trace(origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number, reach = 0, only: ((part) => boolean) | null = null) {
        const transform = this._restToWorld();
        const spans = [];
        const o = new V3(), d = new V3();
        for (const part of this.parts) {
            if (only && !only(part)) continue;
            const { inv } = transform(part.owner);
            V3.TransformCoordinatesToRef(origin, inv, o);
            V3.TransformNormalToRef(dir, inv, d);
            const ts = [];
            for (const c of part.clusters) {
                if (!slab(o, d, c.lo, c.hi, far)) continue;
                for (const i of c.tris) {
                    const t = triangle(o, d, this.data.position, this.data.index, i);
                    if (t > 0 && t < far) ts.push(t);
                }
            }
            if (!ts.length) continue;
            ts.sort((a, b) => a - b);
            // In and out of a closed surface in turns; one left over is a way in that never came out before `far`.
            for (let k = 0; k < ts.length; k += 2) spans.push({ part, enter: ts[k], leave: k + 1 < ts.length ? ts[k + 1] : Math.min(far, ts[k] + 0.01) });
        }
        spans.sort((a, b) => a.enter - b.enter);
        // A hollow organ (the heart's chambers, the bowel) is crossed many times: one span from its first wall to its last.
        for (let k = spans.length - 1; k > 0; k--) {
            const prev = spans.findLast((s, j) => j < k && s.part.name === spans[k].part.name);
            if (prev && spans[k].enter - prev.leave < 0.08) {
                prev.leave = Math.max(prev.leave, spans[k].leave);
                spans.splice(k, 1);
            }
        }

        const vessels = [];
        for (const tube of this.tubes) {
            let best = null;
            for (let i = 0; i + 1 < tube.points.length; i++) {
                const a = V3.TransformCoordinates(tube.points[i].rest, transform(tube.points[i].owner).m);
                const b = V3.TransformCoordinates(tube.points[i + 1].rest, transform(tube.points[i + 1].owner).m);
                const { t, distance } = rayToSegment(origin, dir, a, b);
                const miss = distance - tube.points[i].r - reach;
                if (t > 0 && t < far && miss < 0 && (!best || miss < best.miss)) best = { tube, at: i, t, miss, where: V3.Lerp(a, b, 0.5) };
            }
            if (best) vessels.push(best);
        }
        vessels.sort((a, b) => a.t - b.t);
        return { spans, vessels };
    }

    // Where a point of a tube is now, in the world.
    tubePoint(tube, i) {
        const p = tube.points[i];
        return V3.TransformCoordinates(p.rest, this._restToWorld()(p.owner).m);
    }

    // --- the x-ray -------------------------------------------------------------------

    // A mesh of all of it, skinned to the person's own skeleton (each corner wholly to one bone), shown when asked.
    build(scene: BABYLON.Scene) {
        const { position, normal, index, header } = this.data;
        const { person } = this;
        const n = position.length / 3;
        const bones = new Float32Array(n * 4), weights = new Float32Array(n * 4);
        for (const part of this.parts) {
            const at = part.owner.index;
            for (const c of part.clusters) for (const i of c.tris) for (let k = 0; k < 3; k++) {
                const v = index[i + k];
                bones[v * 4] = at;
                weights[v * 4] = 1;
            }
        }
        const mesh = new BABYLON.Mesh(person.mesh.name + '_insides', scene);
        const vd = new BABYLON.VertexData();
        vd.positions = position;
        vd.normals = normal;
        // This person's own copy of the triangles (the file's is shared): round a break they are taken out and drawn
        // again, broken (shards.ts).
        this.drawn = index.slice();
        vd.indices = this.drawn;
        vd.matricesIndices = bones;
        vd.matricesWeights = weights;
        vd.applyToMesh(mesh, false);
        mesh.setIndices(this.drawn, null, true);
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
        mesh.skeleton = person.skeleton;
        mesh.numBoneInfluencers = 1;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        const kinds = Object.keys(LOOKS);
        const multi = new BABYLON.MultiMaterial(mesh.name + 'M', scene);
        const look = (kind, hurt) => {
            const m = new BABYLON.PBRMaterial(`inside_${kind}${hurt ? '_hurt' : ''}`, scene);
            const c = LOOKS[kind] ?? [0.6, 0.3, 0.3];
            m.albedoColor = hurt ? new BABYLON.Color3(c[0] * 0.45 + 0.25, c[1] * 0.25, c[2] * 0.25) : BABYLON.Color3.FromArray(c);
            m.metallic = 0;
            m.roughness = kind === 'bone' || kind === 'skull' ? 0.55 : 0.3;
            if (hurt) { m.emissiveColor = new BABYLON.Color3(0.25, 0.02, 0.02); }
            return m;
        };
        multi.subMaterials = [...kinds.map((k) => look(k, false)), ...kinds.map((k) => look(k, true))];
        mesh.material = multi;
        mesh.subMeshes = [];
        for (const p of header.parts) {
            const sub = new BABYLON.SubMesh(Math.max(0, kinds.indexOf(p.kind)), p.vertexStart, p.vertexCount, p.indexStart, p.indexCount, mesh);
            p.sub = sub;
        }
        this.hurtMaterial = Object.fromEntries(kinds.map((k, i) => [k, i + kinds.length]));
        mesh.setEnabled(false);
        this.mesh = mesh;
        return mesh;
    }

    // Shown hurt in the x-ray.
    hurt(name) {
        const p = this.data.header.parts.find((x) => x.name === name);
        if (p?.sub && this.hurtMaterial) p.sub.materialIndex = this.hurtMaterial[p.kind];
    }

    // The x-ray's look for a kind of thing, whole or hurt.
    material(kind: string, hurt = false) {
        const kinds = Object.keys(LOOKS);
        return (this.mesh.material as BABYLON.MultiMaterial).subMaterials[kinds.indexOf(kind) + (hurt ? kinds.length : 0)];
    }

    // Triangles (offsets into the index) no longer drawn in the x-ray: a broken bone drawn in pieces of its own instead.
    hide(tris: number[]) {
        for (const i of tris) this.drawn[i + 1] = this.drawn[i + 2] = this.drawn[i];
        this.mesh.updateIndices(this.drawn, 0, true);
    }

    dispose() { this.mesh?.dispose(false, true); }
}

// The triangles `tris` (offsets into `index`) sorted into boxes of about CLUSTER each, by halving the longest side.
function cluster(position, index, tris) {
    const centre = (i, axis) => (position[index[i] * 3 + axis] + position[index[i + 1] * 3 + axis] + position[index[i + 2] * 3 + axis]) / 3;
    const out = [];
    const split = (list) => {
        const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity);
        for (const i of list) for (let k = 0; k < 3; k++) {
            const v = index[i + k] * 3;
            lo.x = Math.min(lo.x, position[v]); lo.y = Math.min(lo.y, position[v + 1]); lo.z = Math.min(lo.z, position[v + 2]);
            hi.x = Math.max(hi.x, position[v]); hi.y = Math.max(hi.y, position[v + 1]); hi.z = Math.max(hi.z, position[v + 2]);
        }
        if (list.length <= CLUSTER) { out.push({ lo, hi, tris: Int32Array.from(list) }); return; }
        const size = hi.subtract(lo);
        const axis = size.x > size.y && size.x > size.z ? 0 : size.y > size.z ? 1 : 2;
        list.sort((a, b) => centre(a, axis) - centre(b, axis));
        const half = list.length >> 1;
        split(list.slice(0, half));
        split(list.slice(half));
    };
    split(tris);
    return out;
}

// Whether the line meets the box before `far`.
function slab(o, d, lo, hi, far) {
    let t0 = 0, t1 = far;
    for (const k of ['x', 'y', 'z']) {
        const inv = 1 / d[k];
        let a = (lo[k] - o[k]) * inv, b = (hi[k] - o[k]) * inv;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) return false;
    }
    return true;
}

// Möller and Trumbore: how far along the line the triangle at `i` is met, or -1.
function triangle(o, d, p, index, i) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const f = 1 / det;
    const sx = o.x - p[a], sy = o.y - p[a + 1], sz = o.z - p[a + 2];
    const u = f * (sx * px + sy * py + sz * pz);
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (d.x * qx + d.y * qy + d.z * qz);
    if (v < 0 || u + v > 1) return -1;
    return f * (e2x * qx + e2y * qy + e2z * qz);
}

// The nearest the line (o, unit d) comes to the segment a-b: how far along the line, and how near.
export function rayToSegment(o, d, a, b) {
    const u = b.subtract(a), w = o.subtract(a);
    const uu = V3.Dot(u, u), ud = V3.Dot(u, d), uw = V3.Dot(u, w), dw = V3.Dot(d, w);
    const den = uu - ud * ud;
    let s = den > 1e-9 ? (uw - ud * dw) / den : 0;
    s = Math.max(0, Math.min(1, s));
    const onSeg = a.add(u.scale(s));
    const t = V3.Dot(onSeg.subtract(o), d);
    return { t, distance: V3.Distance(o.add(d.scale(t)), onSeg) };
}

export { triangle };

// --- cross-sections ---------------------------------------------------------------
//
// Where a plane cuts a closed surface: the outline it leaves on the plane. A limb cut through shows the skin's outline,
// and inside it each bone's, each read off the same triangles that are drawn (dismember.ts).

export type SectionPoint = { x: number; y: number; a: number; b: number; t: number };

// Where the plane through `c` square to unit `n` cuts triangles `tris` (offsets into `index`, corners in `position`):
// loops of points in the plane's own directions `e1`, `e2`, metres from `c`. Each point says which two corners' edge it
// lies on and how far along (`a`, `b`, `t`), to read anything else there off the corners. A surface whose corners are
// doubled along a seam (the skin's picture) leaves pieces of outline that are joined again where their ends meet.
export function section(position, index, tris: Iterable<number>, c: BABYLON.Vector3, n: BABYLON.Vector3, e1: BABYLON.Vector3, e2: BABYLON.Vector3) {
    const side = (v: number) => (position[v * 3] - c.x) * n.x + (position[v * 3 + 1] - c.y) * n.y + (position[v * 3 + 2] - c.z) * n.z;
    const points = new Map<number, SectionPoint>(), links = new Map<number, number[]>();
    const link = (k: number, to: number) => (links.get(k) ?? links.set(k, []).get(k)).push(to);
    for (const i of tris) {
        const v = [index[i], index[i + 1], index[i + 2]], s = v.map(side), crossed = [];
        for (let k = 0; k < 3; k++) {
            const a = v[k], b = v[(k + 1) % 3], sa = s[k], sb = s[(k + 1) % 3];
            if ((sa > 0) === (sb > 0)) continue;
            const key = a < b ? a * 4194304 + b : b * 4194304 + a;
            if (!points.has(key)) {
                const t = sa / (sa - sb);
                const x = position[a * 3] + (position[b * 3] - position[a * 3]) * t - c.x;
                const y = position[a * 3 + 1] + (position[b * 3 + 1] - position[a * 3 + 1]) * t - c.y;
                const z = position[a * 3 + 2] + (position[b * 3 + 2] - position[a * 3 + 2]) * t - c.z;
                points.set(key, { x: x * e1.x + y * e1.y + z * e1.z, y: x * e2.x + y * e2.y + z * e2.z, a, b, t });
            }
            crossed.push(key);
        }
        if (crossed.length === 2) { link(crossed[0], crossed[1]); link(crossed[1], crossed[0]); }
    }
    // Walk the links, from loose ends first so that a broken outline is walked whole.
    const used = new Set<number>(), chains: SectionPoint[][] = [];
    const walk = (start: number) => {
        const chain = [];
        let prev = -1, at = start;
        while (at !== undefined && !used.has(at)) {
            used.add(at);
            chain.push(points.get(at));
            const next = links.get(at).find((k) => k !== prev && !used.has(k));
            prev = at;
            at = next;
        }
        if (chain.length > 1) chains.push(chain);
    };
    for (const [k, l] of links) if (l.length === 1 && !used.has(k)) walk(k);
    for (const k of links.keys()) if (!used.has(k)) walk(k);
    // Pieces whose ends meet (within half a millimetre) are one outline.
    const near = (p: SectionPoint, q: SectionPoint) => Math.hypot(p.x - q.x, p.y - q.y) < 0.0005;
    for (let joined = true; joined;) {
        joined = false;
        for (let i = 0; i < chains.length && !joined; i++) {
            const a = chains[i];
            if (near(a[0], a[a.length - 1])) continue;
            for (let j = 0; j < chains.length; j++) {
                if (i === j) continue;
                const b = chains[j], end = a[a.length - 1];
                if (near(end, b[0])) a.push(...b);
                else if (near(end, b[b.length - 1])) a.push(...b.reverse());
                else if (near(a[0], b[b.length - 1])) a.unshift(...b);
                else if (near(a[0], b[0])) a.unshift(...b.reverse());
                else continue;
                chains.splice(j, 1);
                joined = true;
                break;
            }
        }
    }
    return chains.filter((l) => l.length >= 3);
}

// The area of a loop of points (positive one way round, negative the other).
export function loopArea(loop: { x: number; y: number }[]) {
    let s = 0;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += (loop[j].x - loop[i].x) * (loop[j].y + loop[i].y);
    return s / 2;
}

// Whether point (x, y) is inside a loop.
export function inLoop(loop: { x: number; y: number }[], x: number, y: number) {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}
