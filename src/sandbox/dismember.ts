// A limb, or the head, cut off.
//
// What comes away is the ragdoll's own: the segment below the cut and all
// that hangs from it are already bodies in the physics world, joined to the
// rest at a joint, and the skeleton follows them. Severing lets that joint go
// and from then on puts the piece's first bone where its body is, not where
// its parent bone would have it. The skin and clothes are split between two
// meshes at the cut: the body keeps what is on its side and the piece takes
// the rest, each with its weights given wholly to the bones on its side so
// nothing stretches across the gap; the triangles the cut runs through are in
// both, and each draws only its own side of the plane (hider.ts).
//
// Both ends are closed with what a limb cut through shows: the skin's cut
// edge, the yellow fat under it, the white sheath round the muscle, the
// muscles in their compartments, the bone's own outline read off the
// skeleton (a ring of cortex round its marrow), and the vessels the anatomy
// says cross there, the arteries holding their round shape and the veins
// collapsed. The arteries in the stump pump out with every beat until the
// heart has nothing left to pump (vitals.ts), which, from a thigh, is a few
// minutes.
//
// What takes a limb off: an edge driven through bone in one blow (a sword's
// chop, a machete's), or two or three blows to the same place; a shotgun's
// charge at contact range, while its pellets still fly as one mass; a blast
// close enough. The figures are below.

import * as BABYLON from '@babylonjs/core';
import { section, inLoop, loopArea, type SectionPoint } from './anatomy.ts';
import { burst } from './viscera.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;

type How = 'blade' | 'shot' | 'blast';
export type Limb = 'hand' | 'forearm' | 'upperarm' | 'foot' | 'shin' | 'thigh' | 'head';

// What comes off: `root` the ragdoll segment that comes away (with everything below it), the cut made across the line
// from bone `from`'s head to bone `to`'s, `at` of the way along it and a blow can move it `play` either way; `reach` how
// far from the middle of the cut the limb's flesh goes; `fat` millimetres of fat under its skin; `rank` how bad the
// injury is (vitals' list).
const LIMBS: Record<Limb, { root: string; from: string; to: string; at: number; play: number; reach: number; fat: number; rank: number }> = {
    hand: { root: 'hand', from: 'lowerarm01', to: 'wrist', at: 0.9, play: 0.04, reach: 0.07, fat: 2.5, rank: 8 },
    forearm: { root: 'forearm2', from: 'lowerarm01', to: 'wrist', at: 0.55, play: 0.18, reach: 0.08, fat: 4, rank: 9 },
    upperarm: { root: 'upperarm2', from: 'upperarm01', to: 'lowerarm01', at: 0.5, play: 0.15, reach: 0.1, fat: 7, rank: 10 },
    foot: { root: 'foot', from: 'lowerleg01', to: 'foot', at: 0.92, play: 0.03, reach: 0.08, fat: 3, rank: 8 },
    shin: { root: 'shin2', from: 'lowerleg01', to: 'foot', at: 0.55, play: 0.18, reach: 0.1, fat: 4, rank: 10 },
    thigh: { root: 'thigh2', from: 'upperleg01', to: 'lowerleg01', at: 0.5, play: 0.15, reach: 0.15, fat: 12, rank: 11 },
    head: { root: 'head', from: 'neck01', to: 'head', at: 0.28, play: 0.1, reach: 0.1, fat: 4, rank: 12 },
};

// The ragdoll segment a point is on, as the limb that would come off there.
const SEGMENT_LIMB: Record<string, Limb> = { hand: 'hand', forearm: 'forearm', forearm2: 'forearm', upperarm: 'upperarm', upperarm2: 'upperarm',
    foot: 'foot', shin: 'shin', shin2: 'shin', thigh: 'thigh', thigh2: 'thigh', head: 'head' };

// Joules an edge must bring in one blow to go through skin, muscle and bone. Set so that a sword's full chop (about 90 J
// here) takes a hand or a forearm, as machete attacks do in one blow (dev/research/wounds.md, chop wounds), and needs two
// or more for an upper arm, a neck or a thigh; a blow that does not go through leaves the bone notched, and the next to
// the same place goes on from there (`CARRIES` of the earlier ones counts).
export const CHOP: Record<Limb, number> = { hand: 45, forearm: 75, foot: 80, shin: 150, upperarm: 130, head: 120, thigh: 260 };
const CARRIES = 0.75;
// Joules a single heavy charge must leave in the limb: a shotgun's at contact range, its pellets still one mass (about
// 1.4 kJ from the shotgun here, of which a forearm takes 350 to 500 J: 7 cm of flesh and a bone), tears off a hand, a
// forearm or a foot, and a leg only with far more (the literature has contact shotgun wounds of the forearm and hand as
// near-amputations; of the thigh, as shattered femurs).
export const CHARGE: Record<Limb, number> = { hand: 180, forearm: 300, foot: 320, shin: 650, upperarm: 650, head: 1100, thigh: 1500 };
// kPa of a blast's peak overpressure that tears the limb off. Traumatic amputation by blast is a near-field injury:
// these put a hand grenade's (0.25 kg TNT) reach for a hand or forearm at about 0.8 m and for a thigh at about 0.6 m.
export const BLAST: Record<Limb, number> = { hand: 700, forearm: 900, foot: 800, shin: 1100, upperarm: 1300, head: 2000, thigh: 1800 };

// Peak overpressure (kPa) at `r` metres from `tnt` kg of TNT in the open (Mills 1987, a fit to Kingery and Bulmash).
export function overpressure(r: number, tnt: number) {
    const z = Math.max(0.3, r / Math.cbrt(Math.max(1e-4, tnt)));
    return 1772 / z ** 3 - 114 / z ** 2 + 108 / z;
}

// The litres a second a vessel of radius r (metres) bleeds cut right through, at normal pressure (wounds.ts's figure).
const vesselRate = (r: number, arterial: boolean) => (arterial ? 1.2 : 0.55) * Math.pow(r * 1000, 2) * 0.001;
const WORDS: Record<Limb, string> = { hand: 'hand', forearm: 'forearm', upperarm: 'upper arm', foot: 'foot', shin: 'lower leg', thigh: 'thigh', head: 'head' };

// --- what others call ---------------------------------------------------------------------

// Which limb (and side) a world point on person `npc` is on, or null on the trunk. A point on the skull is not on
// the neck: a blade to the head does not take it off.
export function limbAt(npc, point: BABYLON.Vector3): { limb: Limb; side: string } | null {
    const seg = npc.ragdoll.nearest(point).seg;
    const m = /^([a-z]+\d?)([LR]?)$/.exec(seg?.name ?? '');
    const limb = m && SEGMENT_LIMB[m[1]];
    if (!limb) return null;
    if (limb === 'head') {
        const { byName } = npc.person, a = byName.neck01, b = byName.head;
        const rest = V3.TransformCoordinates(point, npc.restToWorld(a).clone().invert());
        const s = V3.Dot(rest.subtract(a.head), b.head.subtract(a.head)) / V3.DistanceSquared(a.head, b.head);
        if (s > 1.05) return null;
    }
    return { limb, side: m[2] };
}

// Whether `energy` joules brought by `how` would take off `limb` (no side effects). For a blast, `energy` is the peak
// overpressure in kPa.
export function severs(limb: Limb, energy: number, how: How) {
    return energy >= (how === 'blade' ? CHOP : how === 'shot' ? CHARGE : BLAST)[limb];
}

// Cut `limb` (on `side`, 'L' or 'R'; '' for the head) off person `npc`, across the place nearest world point `point`,
// the blow travelling along `dir`. False if it is already off. `how` is what did it: a blade cuts clean, a charge or a
// blast tears.
export function sever(npc, limb: Limb, side = '', point: BABYLON.Vector3 | null = null, dir: BABYLON.Vector3 | null = null, how: How = 'blade') {
    return (npc.dismember as Dismember).sever(limb, side, point, dir, how);
}

// A heavy edge brought down on person `npc` at world point `point`, travelling along `dir`, with `energy` joules: off,
// if it is enough (with what earlier blows there did); otherwise a deep chop into the bone. True if something came off.
export function chop(npc, point: BABYLON.Vector3, dir: BABYLON.Vector3, energy: number) {
    const at = limbAt(npc, point);
    if (!at) return false;
    const d = npc.dismember as Dismember, key = at.limb + at.side;
    const total = (d.chops.get(key) ?? 0) * CARRIES + energy;
    d.chops.set(key, total);
    if (severs(at.limb, total, 'blade')) return d.sever(at.limb, at.side, point, dir, 'blade');
    if (energy > CHOP[at.limb] * 0.35) {
        npc.vitals.injure(at.limb === 'head' ? 'Neck chopped into the spine' : `${at.side === 'L' ? 'Left' : 'Right'} ${WORDS[at.limb]} chopped into the bone`, 5);
        npc.crack();
    }
    return false;
}

// A blast of `tnt` kg (TNT equivalent) at world point `at`: every limb close enough to it torn off, and the belly burst
// open if it was close enough to that (viscera.ts). Returns what came off.
export function blast(npc, at: BABYLON.Vector3, tnt: number) {
    const gone: string[] = [], d = npc.dismember as Dismember;
    // (Nearest the body first: a leg torn off below the knee takes its foot with it.)
    for (const [limb, sides] of [['head', ''], ['thigh', 'LR'], ['upperarm', 'LR'], ['shin', 'LR'], ['forearm', 'LR'], ['foot', 'LR'], ['hand', 'LR']] as [Limb, string][]) {
        for (const side of sides || ['']) {
            const p = d.place(limb, side);
            if (!p) continue;
            const kPa = overpressure(V3.Distance(at, p), tnt) * (0.75 + Math.random() * 0.5);
            if (severs(limb, kPa, 'blast') && d.sever(limb, side, p, p.subtract(at).normalize(), 'blast')) gone.push(limb + side);
        }
    }
    const belly = npc.ragdoll.byName.get('belly');
    if (burst(npc, at, overpressure(V3.Distance(at, npc.ragdoll.worldPoint(belly, belly.centre, new V3())), tnt))) gone.push('belly');
    return gone;
}

// --- from wounds.ts and npc.ts ---------------------------------------------------------------

// The strongest cut a swing made on each limb of each person, kept until the swing is through (npc.slash).
const swings = new WeakMap<object, Map<string, { energy: number; point: BABYLON.Vector3; dir: BABYLON.Vector3 }>>();

// A blade drawn across person `npc` (wounds.ts, every line of a swing that met them).
export function edge(npc, energy: number, point: BABYLON.Vector3, dir: BABYLON.Vector3) {
    const at = limbAt(npc, point);
    if (!at) return;
    const cuts = swings.get(npc) ?? swings.set(npc, new Map()).get(npc), key = at.limb + at.side, had = cuts.get(key);
    if (!had || energy > had.energy) cuts.set(key, { energy, point: point.clone(), dir: dir.clone() });
}

// The swing is through: its strongest cut on each limb it met is one chop there.
export function swung(npc) {
    const cuts = swings.get(npc);
    if (!cuts) return false;
    swings.delete(npc);
    let off = false;
    for (const c of cuts.values()) off = chop(npc, c.point, c.dir, c.energy) || off;
    return off;
}

// A heavy charge (a missile with a wide channel: a shotgun's at contact range) that left `spent` joules in person `npc`,
// having gone in at world point `point` along `dir`.
export function charge(npc, spent: number, point: BABYLON.Vector3, dir: BABYLON.Vector3) {
    const at = limbAt(npc, point);
    if (!at || !severs(at.limb, spent, 'shot')) return false;
    return (npc.dismember as Dismember).sever(at.limb, at.side, point, dir, 'shot');
}

// --- one person's cuts --------------------------------------------------------------------

type Cut = {
    limb: Limb; side: string; how: How; root: any; segs: Set<any>; rootBone: BABYLON.Bone; spread: BABYLON.Bone[];
    prox: any; tip: any; c: BABYLON.Vector3; n: BABYLON.Vector3; meshes: BABYLON.Mesh[]; drains: number; mark: any;
};

export class Dismember {
    declare npc: any;
    declare cuts: Cut[];
    declare chops: Map<string, number>;
    declare owners: Map<number, any>;
    declare _mi: Float32Array;
    declare _mw: Float32Array;
    declare _drawn: Uint32Array;
    declare _textures: BABYLON.BaseTexture[];

    constructor(npc) {
        this.npc = npc;
        this.cuts = [];
        this.chops = new Map();
        this.owners = new Map();
        this._textures = [];
    }

    // Where the cut across `limb` would be, in the world now (null if it is off already).
    place(limb: Limb, side: string) {
        const { byName } = this.npc.person, L = LIMBS[limb], sfx = limb === 'head' ? '' : '.' + side;
        const a = byName[L.from + sfx], b = byName[L.to + sfx];
        if (!a || !b || this.off(limb, side)) return null;
        const rest = V3.Lerp(a.head, b.head, L.at);
        return V3.TransformCoordinates(rest, this.npc.restToWorld(a));
    }

    // Whether `limb` is off, or hangs from something that is.
    off(limb: Limb, side: string) {
        const seg = this.npc.ragdoll.byName.get(LIMBS[limb].root + side);
        return !seg || this.cuts.some((c) => c.segs.has(seg));
    }

    sever(limb: Limb, side: string, point: BABYLON.Vector3 | null, dir: BABYLON.Vector3 | null, how: How) {
        const npc = this.npc, person = npc.person, rd = npc.ragdoll, L = LIMBS[limb];
        if (limb === 'head') side = '';
        const root = rd.byName.get(L.root + side);
        if (!root || this.off(limb, side) || this.cuts.length >= 8) return false;
        const sfx = limb === 'head' ? '' : '.' + side, bones = person.header.bones;
        const a = person.byName[L.from + sfx], b = person.byName[L.to + sfx];
        const rootIndex = person.byName[root.bone].index, prox = person.byName[bones[bones[rootIndex].parent].name];

        // The cut: across the line from a to b, where the blow landed (within the limb's play), turned toward the plane the
        // blade travelled in.
        const toRest = npc.restToWorld(a).clone().invert();
        const ab = b.head.subtract(a.head), u = ab.normalizeToNew();
        let s = L.at;
        if (point) s = Math.max(L.at - L.play, Math.min(L.at + L.play, V3.Dot(V3.TransformCoordinates(point, toRest).subtract(a.head), ab) / ab.lengthSquared()));
        const c = a.head.add(ab.scale(s));
        let n = u.clone();
        if (dir && how === 'blade') {
            const d = V3.TransformNormal(dir, toRest).normalize();
            const off = u.subtract(d.scale(V3.Dot(u, d)));
            if (off.lengthSquared() > 0.25) n = V3.Lerp(u, off.normalize(), 0.6).normalize();
        } else if (limb !== 'head') n = u.add(new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(0.3)).normalize();
        if (V3.Dot(n, u) < 0.6) n = V3.Lerp(u, n, 0.5).normalize();

        // Which bones go: the root's and all below it; which segments: theirs.
        const gone = new Uint8Array(bones.length);
        const below = (i: number) => (i === rootIndex ? 1 : bones[i].parent < 0 ? 0 : (gone[i] = below(bones[i].parent)));
        for (let i = 0; i < bones.length; i++) gone[i] = below(i);
        const segs = new Set(rd.segments.filter((sg) => gone[person.byName[sg.bone].index]));
        // The bones of the segment the cut is in: their flesh past the plane goes too.
        const near = new Uint8Array(bones.length);
        for (let i = 0; i < bones.length; i++) {
            let at = i;
            while (at >= 0 && !rd.segments.some((sg) => sg.bone === bones[at].name)) at = bones[at].parent;
            if (at >= 0 && rd.segments.find((sg) => sg.bone === bones[at].name) === root.parent) near[i] = 1;
        }
        const cut = this._split(limb, side, c, n, gone, near, rootIndex, prox, L.reach, how);
        if (!cut) return false;
        Object.assign(cut, { how, segs, root, prox, tip: person.byName[root.bone], rootBone: person.byName[root.bone].bone,
            spread: root.spread.filter((bn) => bn !== person.byName[root.bone].bone) });

        // The joint lets go: the piece is its own from now on, with no muscle in it.
        root.constraint.isEnabled = false;
        root.broken = true;
        root.severed = true;
        if (dir) root.body.applyImpulse(dir.scale(how === 'blade' ? 3 : how === 'shot' ? 9 : 25).add(new V3(0, 1.5, 0)), point ?? rd.worldPoint(root, root.centre, new V3()));

        this._ends(cut, how);
        this._bleed(cut, how);
        this._hurt(cut);
        this.cuts.push(cut);
        return true;
    }

    // --- the meshes ---------------------------------------------------------------------------

    // The body's skin and clothes split at the plane through `c` square to `n`: what is past it (and on the limb) given
    // to a mesh of its own, carried by the limb's bones; what stays carried only by the body's.
    _split(limb: Limb, side: string, c: BABYLON.Vector3, n: BABYLON.Vector3, gone: Uint8Array, near: Uint8Array, rootIndex: number, prox, reach: number, how: How) {
        const npc = this.npc, person = npc.person, mesh: BABYLON.Mesh = person.mesh;
        const { header, arrays } = person.lib.bodies.get(person.bodyName);
        if (!this._mi) {
            this._mi = Float32Array.from(mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind));
            this._mw = Float32Array.from(mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind));
            this._drawn = Uint32Array.from(arrays.index);
            mesh.geometry.setIndices(this._drawn.slice(), null, true, true);
        }
        const mi = this._mi, mw = this._mw, pos = arrays.position, drawn = this._drawn;
        const vertices = header.vertexCount;
        // Past the plane, and carried by the limb (or by the segment the cut is in, near the cut).
        const past = new Uint8Array(vertices);
        for (let v = 0; v < vertices; v++) {
            const x = pos[v * 3] - c.x, y = pos[v * 3 + 1] - c.y, z = pos[v * 3 + 2] - c.z;
            if (x * n.x + y * n.y + z * n.z <= 0) continue;
            let limbs = 0, here = 0;
            for (let k = 0; k < 4; k++) {
                if (!mw[v * 4 + k]) continue;
                if (gone[mi[v * 4 + k]]) limbs += mw[v * 4 + k];
                else if (near[mi[v * 4 + k]]) here += mw[v * 4 + k];
            }
            if (limbs > 0 || (here > 0 && x * x + y * y + z * z < reach * reach * 4)) past[v] = 1;
        }
        // Triangles: wholly past (the piece's), not at all (the body's), or across the plane (both, for skin and clothes,
        // which are cut at the plane as they are drawn; anything else goes with the side most of it is on).
        const parts = header.parts, piece: number[][] = parts.map(() => []);
        parts.forEach((p, pi) => {
            const both = p.kind === 'skin' || p.kind === 'cloth';
            for (let i = p.indexStart; i < p.indexStart + p.indexCount; i += 3) {
                if (drawn[i] === drawn[i + 1] && drawn[i] === drawn[i + 2]) continue;
                const k = past[drawn[i]] + past[drawn[i + 1]] + past[drawn[i + 2]];
                if (!k) continue;
                piece[pi].push(drawn[i], drawn[i + 1], drawn[i + 2]);
                if (k === 3 || (!both && k >= 2)) drawn[i + 1] = drawn[i + 2] = drawn[i];
            }
        });
        if (!piece.some((l) => l.length)) return null;
        // The body's corners: whatever weight they had on the limb's bones goes to the bone the limb hung from.
        const reweigh = (v: number, from: (b: number) => boolean, to: number, w: Float32Array, j: Float32Array, o: number) => {
            let changed = false;
            for (let k = 0; k < 4; k++) {
                if (!w[o + k] || !from(j[o + k])) continue;
                const same = [0, 1, 2, 3].find((q) => q !== k && w[o + q] && j[o + q] === to);
                if (same !== undefined) { w[o + same] += w[o + k]; w[o + k] = 0; } else j[o + k] = to;
                changed = true;
            }
            return changed;
        };
        const kept = new Uint8Array(vertices);
        for (let i = 0; i < drawn.length; i += 3) if (drawn[i] !== drawn[i + 1] || drawn[i] !== drawn[i + 2]) kept[drawn[i]] = kept[drawn[i + 1]] = kept[drawn[i + 2]] = 1;
        for (let v = 0; v < vertices; v++) {
            if (!kept[v] || !reweigh(v, (b) => !!gone[b], prox.index, mw, mi, v * 4)) continue;
            this.owners.set(v, this._heaviest(mi, mw, v * 4));
        }
        mesh.setVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind, mi, true);
        mesh.setVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind, mw, true);
        mesh.geometry.updateIndices(drawn, 0, true);

        // The piece: its own copy of the corners it uses, carried wholly by the limb's bones.
        const map = new Map<number, number>(), list: number[] = [];
        for (const tris of piece) for (const v of tris) if (!map.has(v)) { map.set(v, list.length); list.push(v); }
        const m = list.length, P = new Float32Array(m * 3), N = new Float32Array(m * 3), U = new Float32Array(m * 2), J = new Float32Array(m * 4), W = new Float32Array(m * 4);
        list.forEach((v, k) => {
            for (let q = 0; q < 3; q++) { P[k * 3 + q] = pos[v * 3 + q]; N[k * 3 + q] = arrays.normal[v * 3 + q]; }
            U[k * 2] = arrays.uv[v * 2]; U[k * 2 + 1] = arrays.uv[v * 2 + 1];
            // (The piece's weights are the file's, the body's own having been changed at earlier cuts.)
            for (let q = 0; q < 4; q++) { J[k * 4 + q] = arrays.joints[v * 4 + q]; W[k * 4 + q] = arrays.weights[v * 4 + q] / 255; }
            reweigh(v, (bn) => !gone[bn], rootIndex, W, J, k * 4);
        });
        const index: number[] = [], ranges: { part: number; start: number; count: number }[] = [];
        piece.forEach((tris, pi) => {
            if (!tris.length) return;
            ranges.push({ part: pi, start: index.length, count: tris.length });
            for (const v of tris) index.push(map.get(v));
        });
        const skin = new BABYLON.Mesh(`${mesh.name}_${limb}${side}`, npc.world.scene);
        const vd = new BABYLON.VertexData();
        Object.assign(vd, { positions: P, normals: N, uvs: U, indices: Uint32Array.from(index), matricesIndices: J, matricesWeights: W });
        vd.applyToMesh(skin, false);
        const cloth = skin.clone(skin.name + '_clothes', null) as BABYLON.Mesh;
        const worn = (pi: number) => npc.clothes.subMeshes.some((sm) => sm.materialIndex === pi);
        const bare = (pi: number) => mesh.subMeshes.some((sm) => sm.materialIndex === pi);
        skin.subMeshes = [];
        cloth.subMeshes = [];
        for (const r of ranges) {
            if (bare(r.part)) new BABYLON.SubMesh(r.part, 0, m, r.start, r.count, skin);
            if (worn(r.part)) new BABYLON.SubMesh(r.part, 0, m, r.start, r.count, cloth);
        }
        const k = npc.skinHider.cutCount;
        for (const [piece, like] of [[skin, mesh], [cloth, npc.clothes]] as [BABYLON.Mesh, BABYLON.Mesh][]) {
            piece.parent = mesh.parent;
            piece.position.copyFrom(mesh.position);
            piece.skeleton = person.skeleton;
            piece.numBoneInfluencers = 4;
            piece.material = like.material;
            piece.alwaysSelectAsActiveMesh = true;
            piece.isPickable = false;
            piece.receiveShadows = true;
            (piece as any).decalMap = (like as any).decalMap;
            npc.world.shadows?.addShadowCaster(piece);
        }
        // Each side draws only its own side of the plane; the skin under the clothes shows round the cut, where the sleeve
        // or trouser leg ends with it.
        for (const h of [npc.skinHider, ...npc.underHiders, ...npc.clothHiders]) {
            h.cut(c, n, reach, how !== 'blade');
            h.keeps(skin, k);
            h.keeps(cloth, k);
        }
        for (const h of npc.underHiders) h.window(c, n, reach, 0.012);
        return { limb, side, c, n, meshes: [skin, cloth], drains: 0, mark: null } as unknown as Cut;
    }

    // The byName entry of the bone carrying most of corner weights at `o`.
    _heaviest(mi: Float32Array, mw: Float32Array, o: number) {
        let best = 0, bone = 0;
        for (let k = 0; k < 4; k++) if (mw[o + k] > best) { best = mw[o + k]; bone = mi[o + k]; }
        const { person } = this.npc;
        return person.byName[person.header.bones[bone].name];
    }

    // --- the two ends ---------------------------------------------------------------------------

    // The stump and the piece closed with what the cut goes through.
    _ends(cut: Cut, how: How) {
        const npc = this.npc, person = npc.person, scene = npc.world.scene;
        const { c, n } = cut;
        const e1 = V3.Cross(n, Math.abs(n.y) < 0.9 ? V3.Up() : V3.Right()).normalize(), e2 = V3.Cross(n, e1);
        const L = LIMBS[cut.limb], reach = L.reach;
        // The skin's outline here: the loop round the middle of the cut.
        const { header, arrays } = person.lib.bodies.get(person.bodyName);
        const tris: number[] = [];
        for (const p of header.parts) {
            if (p.kind !== 'skin') continue;
            for (let i = p.indexStart; i < p.indexStart + p.indexCount; i += 3) {
                const v = arrays.index[i];
                if (Math.abs(arrays.position[v * 3] - c.x) < reach * 1.5 && Math.abs(arrays.position[v * 3 + 1] - c.y) < reach * 1.5 && Math.abs(arrays.position[v * 3 + 2] - c.z) < reach * 1.5) tris.push(i);
            }
        }
        const loops = section(arrays.position, arrays.index, tris, c, n, e1, e2);
        let skin = loops.filter((l) => inLoop(l, 0, 0)).sort((p, q) => Math.abs(loopArea(p)) - Math.abs(loopArea(q)))[0];
        if (!skin) skin = loops.sort((p, q) => Math.abs(loopArea(q)) - Math.abs(loopArea(p)))[0];
        if (!skin) return;
        // What is inside it: bones and the neck's tubes as outlines, vessels as points.
        const data = npc.insides.data, inside = (x: number, y: number) => inLoop(skin, x, y);
        const solids: { kind: string; name: string; loop: SectionPoint[] }[] = [];
        const seen = new Set<string>();
        for (const part of npc.insides.parts) {
            if (!/bone|skull|cartilage|airway|oesophagus/.test(part.kind) || seen.has(part.name)) continue;
            const near: number[] = [];
            for (const cl of part.clusters) {
                if (!boxNear(cl.lo, cl.hi, c, n, reach)) continue;
                for (const i of cl.tris) near.push(i);
            }
            if (!near.length) continue;
            // (A part split between two bones is one outline: both halves at once.)
            for (const other of npc.insides.parts) if (other !== part && other.name === part.name) for (const cl of other.clusters) if (boxNear(cl.lo, cl.hi, c, n, reach)) for (const i of cl.tris) near.push(i);
            seen.add(part.name);
            for (const loop of section(data.position, data.index, near, c, n, e1, e2)) {
                const mid = centroid(loop);
                if (Math.abs(loopArea(loop)) > 2e-6 && inside(mid.x, mid.y)) solids.push({ kind: part.kind, name: part.name, loop });
            }
        }
        const vessels: { kind: string; name: string; x: number; y: number; r: number }[] = [];
        for (const tube of npc.insides.tubes) {
            for (let i = 0; i + 1 < tube.points.length; i++) {
                const p = tube.points[i].rest, q = tube.points[i + 1].rest;
                const sp = V3.Dot(p.subtract(c), n), sq = V3.Dot(q.subtract(c), n);
                if ((sp > 0) === (sq > 0)) continue;
                const at = V3.Lerp(p, q, sp / (sp - sq)).subtract(c), x = V3.Dot(at, e1), y = V3.Dot(at, e2);
                if (inside(x, y)) vessels.push({ kind: tube.kind, name: tube.name, x, y, r: Math.max(0.0015, tube.points[i].r) });
            }
            // The carotids and jugulars in the file stop at the root of the neck; in a neck they run on straight up it to
            // the skull, so they are carried on up to the cut.
            if (cut.limb === 'head' && /carotid|jugular/.test(tube.name) && !vessels.some((v) => v.name === tube.name)) {
                const top = tube.points.reduce((p, q) => (V3.Dot(q.rest.subtract(c), n) > V3.Dot(p.rest.subtract(c), n) ? q : p));
                const up = V3.Dot(c.subtract(top.rest), n);
                if (up > 0 && up < 0.1) {
                    const at = top.rest.add(n.scale(up)).subtract(c), x = V3.Dot(at, e1), y = V3.Dot(at, e2);
                    if (inside(x, y)) vessels.push({ kind: tube.kind, name: tube.name, x, y, r: Math.max(0.0025, top.r) });
                }
            }
        }
        const look = paint(scene, skin, solids, vessels, L.fat / 1000, how !== 'blade', cut.limb);
        this._textures.push(look.albedo, look.bump, look.surface);
        cut.mark = { look, skin, solids, vessels, e1, e2 };
        const material = capMaterial(scene, look);
        const torn = how !== 'blade';
        // The stump's end faces down the limb, carried by the bone it hung from; the piece's the other way, by its own.
        const stump = capMesh(npc, `${person.mesh.name}_stump_${cut.limb}${cut.side}`, c, n, e1, e2, skin, solids, look, 1, cut.prox.index, torn ? 0.016 : 0.005, torn);
        const end = capMesh(npc, `${person.mesh.name}_end_${cut.limb}${cut.side}`, c, n, e1, e2, skin, solids, look, -1, cut.tip.index, torn ? 0.008 : 0.004, torn);
        for (const m of [stump, end]) { m.material = material; npc.world.shadows?.addShadowCaster(m); }
        cut.meshes.push(stump, end);
        // The skin's cut edge: its lip shows the layers it was cut through, a ragged band of them where it was torn.
        npc.marks.rim(skin.map((p) => uvOf(arrays, p)), uvScale(arrays, skin), torn ? 0.022 : 0.005, torn ? 0.55 : 0.22, torn);
    }

    // --- blood ----------------------------------------------------------------------------------

    // Every artery the cut goes through pumps out of the stump, its vein beside it bleeds, and the muscle oozes. The
    // piece drains what was in it.
    _bleed(cut: Cut, how: How) {
        const npc = this.npc, v = npc.vitals, info = cut.mark;
        const { c, n } = cut;
        const mark = (x: number, y: number) => ({ kind: 'skin', rest: c.add(info.e1.scale(x)).add(info.e2.scale(y)).add(n.scale(0.004)), restNormal: n.clone(), owner: cut.prox,
            corners: [], uv: [0, 0], scale: 1 });
        const side = cut.side ? (cut.side === 'L' ? 'left ' : 'right ') : '';
        for (const vs of info?.vessels ?? []) {
            if (vs.kind === 'cord') continue;
            const arterial = vs.kind === 'artery';
            // A torn artery curls up and clamps down a little; a cut one does not.
            const clamp = how === 'blade' ? 1 : 0.7;
            v.bleed({ name: vs.name, rate: vesselRate(vs.r, arterial) * clamp, arterial, spurts: arterial, clots: arterial ? 0.003 : 0.01, source: { mark: mark(vs.x, vs.y) } });
            if (arterial && !/carotid/.test(vs.name)) v.bleed({ name: vs.name.replace('artery', 'vein'), rate: vesselRate(vs.r * 1.2, false), clots: 0.01, source: { mark: mark(vs.x + vs.r * 2.4, vs.y) } });
        }
        // The cut muscle and bone marrow ooze, more from a big cut.
        v.bleed({ name: `${side}${WORDS[cut.limb]} stump`, rate: 0.0015 * (LIMBS[cut.limb].reach / 0.1) ** 2, clots: 0.006, source: { mark: mark(0, 0) } });
        cut.drains = 0.04 * (LIMBS[cut.limb].reach / 0.1) ** 2;
        // The blood thrown out as it comes away.
        const at = npc.worldOf(c, cut.prox, n);
        npc.world.blood.spray(at.at, at.normal, how === 'blade' ? 2.5 : 5, how === 'blade' ? 25 : 60, 0.7, 1.4);
    }

    _hurt(cut: Cut) {
        const npc = this.npc, v = npc.vitals;
        const side = cut.side ? (cut.side === 'L' ? 'Left ' : 'Right ') : '';
        v.pain = 1;
        npc.crack();
        npc.world.sound?.shot('flesh', { at: npc.worldOf(cut.c, cut.prox).at.asArray(), gain: 1 });
        if (cut.limb === 'head') {
            // The brain cut off from its blood and the cord from the body: out at once, dead within seconds.
            v.injure('Decapitated', 12);
            v.paralysed.legs = v.paralysed.arms = true;
            v.breathing = false;
            v.brainDamage = Math.max(v.brainDamage, 0.2);
            this._death = 6;
            npc.person.look = null;
            npc.knockDown();
            return;
        }
        v.injure(`${side}${WORDS[cut.limb]} cut off`, LIMBS[cut.limb].rank);
        if (/foot|shin|thigh/.test(cut.limb)) { npc.legGone = true; npc.knockDown(); }
    }
    declare _death: number;

    // --- every frame ----------------------------------------------------------------------------

    // After the ragdoll has put the skeleton where the bodies are: each piece's first bone where its own body is (its
    // parent bone is on the body now, not on it), and the bones a bend was spread over kept straight in it.
    update(dt: number) {
        if (!this.cuts.length) return;
        const npc = this.npc, person = npc.person;
        if (this._death > 0 && (this._death -= dt) <= 0) npc.vitals.dead = true;
        const world = person.mesh.getWorldMatrix();
        world.invertToRef(_inv);
        world.decompose(undefined, _qw, undefined);
        Q.InverseToRef(_qw, _qw);
        for (const cut of this.cuts) {
            const seg = cut.root, bone = cut.rootBone;
            _qw.multiplyToRef(seg.node.rotationQuaternion, _q);
            V3.TransformCoordinatesToRef(seg.node.position, _inv, _p);
            BABYLON.Matrix.ComposeToRef(_one, _q, _p, _m);
            bone.getParent().getAbsoluteMatrix().invertToRef(_m2);
            _m.multiplyToRef(_m2, _m);
            _m.decompose(_s, _q, _p);
            bone.setRotationQuaternion(_q, BABYLON.Space.LOCAL);
            bone.setPosition(_p, BABYLON.Space.LOCAL);
            for (const b of cut.spread) b.setRotationQuaternion(Q.Identity(), BABYLON.Space.LOCAL);
            // What was in the piece runs out of its cut end, less and less.
            if (cut.drains > 1e-5) {
                const end = npc.worldOf(cut.c, cut.tip, cut.n.scale(-1));
                npc.world.blood.run(end.at.add(end.normal.scale(0.01)), cut.drains * 0.02, dt);
                cut.drains *= Math.exp(-dt / 25);
            }
        }
    }

    dispose() {
        // (The pieces wear the person's own materials; the cut faces have one of their own.)
        for (const cut of this.cuts) for (const [k, m] of cut.meshes.entries()) m.dispose(false, k >= 2);
        for (const t of this._textures) t.dispose();
    }
}

const _inv = new BABYLON.Matrix(), _m = new BABYLON.Matrix(), _m2 = new BABYLON.Matrix(), _qw = new Q(), _q = new Q(), _p = new V3(), _s = new V3(), _one = new V3(1, 1, 1);

// Whether a box (rest space) comes within `reach` of the plane's middle and the plane runs through it.
function boxNear(lo: BABYLON.Vector3, hi: BABYLON.Vector3, c: BABYLON.Vector3, n: BABYLON.Vector3, reach: number) {
    if (lo.x > c.x + reach || hi.x < c.x - reach || lo.y > c.y + reach || hi.y < c.y - reach || lo.z > c.z + reach || hi.z < c.z - reach) return false;
    let below = false, above = false;
    for (let k = 0; k < 8; k++) {
        const p = new V3(k & 1 ? hi.x : lo.x, k & 2 ? hi.y : lo.y, k & 4 ? hi.z : lo.z);
        if (V3.Dot(p.subtract(c), n) > 0) above = true; else below = true;
    }
    return above && below;
}

function centroid(loop: { x: number; y: number }[]) {
    let x = 0, y = 0;
    for (const p of loop) { x += p.x; y += p.y; }
    return { x: x / loop.length, y: y / loop.length };
}

// A point of the skin's outline in the skin's picture.
function uvOf(arrays, p: SectionPoint) {
    const u = arrays.uv;
    return { uv: [u[p.a * 2] + (u[p.b * 2] - u[p.a * 2]) * p.t, u[p.a * 2 + 1] + (u[p.b * 2 + 1] - u[p.a * 2 + 1]) * p.t] };
}

// Texture units to a metre of skin along an outline: its edges' lengths in the picture against their lengths at rest.
function uvScale(arrays, loop: SectionPoint[]) {
    const p = arrays.position, u = arrays.uv;
    let a = 0, b = 0;
    for (const q of loop) {
        a += Math.hypot(u[q.a * 2] - u[q.b * 2], u[q.a * 2 + 1] - u[q.b * 2 + 1]);
        b += Math.hypot(p[q.a * 3] - p[q.b * 3], p[q.a * 3 + 1] - p[q.b * 3 + 1], p[q.a * 3 + 2] - p[q.b * 3 + 2]);
    }
    return a / Math.max(1e-9, b);
}

// A loop resampled to `count` points evenly round it.
function resample(loop: { x: number; y: number }[], count: number) {
    const lengths = [0];
    for (let i = 1; i <= loop.length; i++) lengths.push(lengths[i - 1] + Math.hypot(loop[i % loop.length].x - loop[i - 1].x, loop[i % loop.length].y - loop[i - 1].y));
    const total = lengths[loop.length], out: { x: number; y: number }[] = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
        const want = (k / count) * total;
        while (lengths[j + 1] < want) j++;
        const a = loop[j], b = loop[(j + 1) % loop.length], t = (want - lengths[j]) / Math.max(1e-9, lengths[j + 1] - lengths[j]);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    // Always the same way round (anticlockwise in the plane's own directions).
    return loopArea(out) < 0 ? out.reverse() : out;
}

// The loop moved in by `by(i)` metres at each point (inward for an anticlockwise loop).
function inset(loop: { x: number; y: number }[], by: (i: number) => number) {
    return loop.map((p, i) => {
        const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
        const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1, d = by(i);
        return { x: p.x - (ty / l) * d, y: p.y + (tx / l) * d };
    });
}

// Smooth noise round a loop: `k` of the way round, the same for the same seed.
const wobble = (k: number, seed: number) => Math.sin(k * Math.PI * 2 * 3 + seed) * 0.5 + Math.sin(k * Math.PI * 2 * 7 + seed * 1.7) * 0.3 + Math.sin(k * Math.PI * 2 * 13 + seed * 2.3) * 0.2;

// --- the cut face: painted ------------------------------------------------------------------------
//
// A picture of the cut face, its height at each point and how glossy it is, in the plane's own directions and at its
// real size. The outlines (skin, the fat's inner edge, each bone) are drawn as shapes into a mask of what is where;
// then every point is coloured for what it is: muscle in bellies of their own, each a slightly different red and
// swelling a little out of the sheath round it, with the fine grain of fibre bundles seen end on; fat in lobules;
// cortex round marrow; and blood lying over all of it, thickest in the hollows, where the face is glossiest.

const SIZE = 512;
// What is at each point. Layers that touch are numbered next to each other, so that where the mask's soft edges blend
// two of them the blend reads as one or the other and never as a third.
const OUT = 0, EPIDERMIS = 1, DERMIS = 2, FAT = 3, FASCIA = 4, MUSCLE = 5, CORTEX = 6, MARROW = 7, SPONGY = 8;
type Look = { albedo: BABYLON.DynamicTexture; bump: BABYLON.DynamicTexture; surface: BABYLON.DynamicTexture; E: number; height: (x: number, y: number) => number };

function paint(scene: BABYLON.Scene, skinLoop: SectionPoint[], solids, vessels, fat: number, torn: boolean, limb: Limb): Look {
    const skin = resample(skinLoop, 160);
    let E = 0;
    for (const p of skin) E = Math.max(E, Math.abs(p.x), Math.abs(p.y));
    E *= 1.06;
    const X = (x: number) => (x / (2 * E) + 0.5) * SIZE, Y = (y: number) => (0.5 - y / (2 * E)) * SIZE, M = (m: number) => (m / (2 * E)) * SIZE;
    const seed = Math.random() * 1000;
    // The mask.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskCanvas.height = SIZE;
    const mk = maskCanvas.getContext('2d', { willReadFrequently: true });
    const shape = (loop: { x: number; y: number }[], what: number) => {
        mk.beginPath();
        loop.forEach((p, i) => (i ? mk.lineTo(X(p.x), Y(p.y)) : mk.moveTo(X(p.x), Y(p.y))));
        mk.closePath();
        mk.fillStyle = `rgb(${what * 28},0,0)`;
        mk.fill();
    };
    const k = skin.length, rough = torn ? 1 : 0;
    shape(skin, EPIDERMIS);
    shape(inset(skin, (i) => 0.0004 + rough * Math.abs(wobble(i / k, seed)) * 0.0007), DERMIS);
    shape(inset(skin, (i) => 0.0021 + rough * Math.abs(wobble(i / k, seed + 1)) * 0.001), FAT);
    const sheath = inset(skin, (i) => 0.0021 + fat * (0.7 + 0.5 * wobble(i / k, seed + 3)));
    shape(sheath, FASCIA);
    shape(inset(sheath, () => 0.0006), MUSCLE);
    const bones = solids.filter((b) => b.kind === 'bone' || b.kind === 'skull');
    for (const b of bones) {
        const loop = resample(b.loop, 96), area = Math.abs(loopArea(loop));
        // A long bone's shaft is a tube of cortex round marrow; a small bone, or a long bone's end, is spongy through.
        const wall = area > 2.5e-4 ? 0.0045 : area > 7e-5 ? 0.0026 : 0;
        const inner = wall ? inset(loop, () => wall) : null;
        if (inner && Math.abs(loopArea(inner)) > 3e-6) { shape(loop, CORTEX); shape(inner, MARROW); } else shape(loop, SPONGY);
    }
    const mask = mk.getImageData(0, 0, SIZE, SIZE).data;

    // Every point coloured for what it is.
    const albedo = new BABYLON.DynamicTexture('cut_face', { width: SIZE, height: SIZE }, scene, true);
    const surface = new BABYLON.DynamicTexture('cut_face_surface', { width: SIZE, height: SIZE }, scene, true);
    const g = albedo.getContext() as CanvasRenderingContext2D, sg = surface.getContext() as CanvasRenderingContext2D;
    const img = g.createImageData(SIZE, SIZE), sur = sg.createImageData(SIZE, SIZE), px = img.data, sp = sur.data;
    const field = new Float32Array(SIZE * SIZE);
    const cellMuscle = Math.max(0.008, Math.min(0.026, E / 3)), cellFat = 0.0024;
    const metre = (2 * E) / SIZE;
    const wet = torn ? 0.4 : 0.56;          // the lower, the more of the face lies under blood
    for (let py = 0, i = 0, q = 0; py < SIZE; py++) {
        for (let pxx = 0; pxx < SIZE; pxx++, i += 4, q++) {
            const what = Math.round(mask[i] / 28);
            if (what === OUT) { field[q] = 0.4; sp[i + 1] = 140; sp[i + 3] = 255; continue; }
            const x = (pxx + 0.5) * metre - E, y = E - (py + 0.5) * metre;
            const grain = vnoise(x / 0.0006 + seed, y / 0.0006), broad = vnoise(x / 0.004 - seed, y / 0.004);
            let r = 0, gg = 0, b = 0, h = 0.45, rough = 0.5, blood = 0;
            if (what === MUSCLE) {
                // Bellies: cells of a jittered grid, their borders wavy, a pale sheet of fascia along each border.
                const wx = x + (vnoise(x / 0.012, y / 0.012 + seed) - 0.5) * cellMuscle * 0.5, wy = y + (vnoise(x / 0.012 + 7, y / 0.012 - seed) - 0.5) * cellMuscle * 0.5;
                const cell = worley(wx / cellMuscle, wy / cellMuscle, seed);
                const edge = (cell.f2 - cell.f1) * cellMuscle, shade = 0.84 + 0.3 * cell.id;
                // Between some bellies a pale sheet of fascia; between others only a fold where one meets the next.
                const sheet = (1 - smooth(0.00015, 0.00045, edge)) * (hash(Math.floor(cell.id * 977 + cell.id2 * 977), 3, seed) > 0.45 ? 0.75 : 0);
                const f = shade * (0.86 + 0.22 * grain) * (0.72 + 0.28 * smooth(0, 0.0016, edge));
                r = 156 * f; gg = 32 * f; b = 27 * f;
                r += (212 - r) * sheet; gg += (194 - gg) * sheet; b += (186 - b) * sheet;
                h = 0.5 + 0.07 * (0.6 + 0.8 * cell.id) * smooth(0, cellMuscle * 0.45, edge) + grain * 0.012 * (1 + rough);
                rough = 0.38;
                blood = 1;
            } else if (what === FAT) {
                const cell = worley(x / cellFat + seed, y / cellFat, seed + 5), edge = (cell.f2 - cell.f1) * cellFat;
                const f = (0.88 + 0.16 * cell.id) * (0.92 + 0.12 * grain);
                r = 228 * f; gg = 182 * f; b = 90 * f;
                const septum = 1 - smooth(0.00008, 0.00025, edge);
                r += (236 - r) * septum * 0.6; gg += (214 - gg) * septum * 0.6; b += (170 - b) * septum * 0.6;
                h = 0.4 + 0.025 * smooth(0, cellFat * 0.4, edge);
                rough = 0.5;
                blood = 0.45;
            } else if (what === FASCIA) { r = 214; gg = 204; b = 198; h = 0.46; rough = 0.3; blood = 0.7; }
            else if (what === DERMIS) { r = 226 + grain * 12; gg = 196 + grain * 10; b = 182 + grain * 8; h = 0.43; rough = 0.55; blood = 0.3; }
            else if (what === EPIDERMIS) { r = 150; gg = 102; b = 82; h = 0.42; rough = 0.6; }
            else if (what === CORTEX) {
                const f = 0.9 + 0.1 * vnoise(x / 0.0003, y / 0.0012) + 0.04 * grain;
                r = 232 * f; gg = 220 * f; b = 194 * f; h = 0.64; rough = 0.42; blood = 0.35;
            } else if (what === MARROW) {
                const red = smooth(0.45, 0.6, broad * 0.6 + grain * 0.4);
                r = 206 + (142 - 206) * red; gg = 150 + (28 - 150) * red; b = 62 + (20 - 62) * red; h = 0.57; rough = 0.35; blood = 0.6;
            } else if (what === SPONGY) {
                const hole = smooth(0.55, 0.7, vnoise(x / 0.0007 + seed, y / 0.0007));
                r = 214 + (120 - 214) * hole; gg = 182 + (26 - 182) * hole; b = 160 + (20 - 160) * hole; h = 0.6 - hole * 0.04; rough = 0.4; blood = 0.4;
            }
            // Blood over it: in pools and smears that come and go with a broad noise, never quite the same twice.
            const lying = blood * smooth(wet, wet + 0.14, vnoise(x / 0.011 + seed * 0.3, y / 0.011) * 0.75 + broad * 0.25);
            if (lying > 0) {
                const dark = 0.8 + 0.3 * grain;
                r += (92 * dark - r) * lying * 0.85; gg += (7 - gg) * lying * 0.85; b += (6 - b) * lying * 0.85;
                h += (0.49 - h) * lying * 0.6;
                rough += (0.1 - rough) * lying;
            }
            px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = 255;
            sp[i] = 255; sp[i + 1] = rough * 255; sp[i + 2] = 0; sp[i + 3] = 255;
            field[q] = h;
        }
    }
    g.putImageData(img, 0, 0);
    sg.putImageData(sur, 0, 0);

    // Over the picture: what the outlines do not give.
    const names = bones.map((b) => b.name);
    // Between radius and ulna, tibia and fibula, the white interosseous membrane.
    for (const [one, two] of [['radius', 'ulna'], ['tibia', 'fibula']]) {
        const a = bones.find((b) => b.name.endsWith(one)), c = bones.find((b) => b.name.endsWith(two));
        if (!a || !c || !names.length) continue;
        let best = null;
        for (const p of a.loop) for (const q2 of c.loop) { const d = Math.hypot(p.x - q2.x, p.y - q2.y); if (!best || d < best.d) best = { p, q: q2, d }; }
        g.strokeStyle = 'rgba(224,214,206,0.9)'; g.lineWidth = Math.max(1, M(0.0006));
        g.beginPath(); g.moveTo(X(best.p.x), Y(best.p.y)); g.lineTo(X(best.q.x), Y(best.q.y)); g.stroke();
    }
    // The neck's tubes: the windpipe held open by its cartilage, a dark hole; the gullet collapsed, pink.
    for (const t of solids) {
        if (t.kind !== 'airway' && t.kind !== 'oesophagus' && t.kind !== 'cartilage') continue;
        const loop = resample(t.loop, 64);
        const fillLoop = (l: { x: number; y: number }[], colour: string) => {
            g.beginPath(); l.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)))); g.closePath(); g.fillStyle = colour; g.fill();
        };
        if (t.kind === 'cartilage') { fillLoop(loop, 'rgb(206,212,208)'); continue; }
        fillLoop(loop, t.kind === 'airway' ? 'rgb(222,212,204)' : 'rgb(170,82,74)');
        const lumen = inset(loop, () => (t.kind === 'airway' ? 0.0022 : 0.0032));
        if (Math.abs(loopArea(lumen)) > 1e-6) fillLoop(lumen, t.kind === 'airway' ? 'rgb(14,3,3)' : 'rgb(92,20,22)');
    }
    // Toward the wrist and the ankle the muscles have become tendons: pearly cords in the flesh, glossy where cut. (The
    // anatomy has no tendons: they are placed in the muscle round the bones, as many as a wrist or ankle has.)
    const tendons = limb === 'hand' ? 11 : limb === 'foot' ? 9 : limb === 'forearm' || limb === 'shin' ? 3 : 0;
    for (let n = 0, tries = 0; n < tendons && tries < 400; tries++) {
        const p = skin[Math.floor(Math.random() * k)], t = 0.45 + Math.random() * 0.4, mid = centroid(skin);
        const x = mid.x + (p.x - mid.x) * t, y = mid.y + (p.y - mid.y) * t, cx = Math.floor(X(x)), cy = Math.floor(Y(y));
        if (Math.round(mask[(cy * SIZE + cx) * 4] / 28) !== MUSCLE) continue;
        const rx = M(0.0012 + Math.random() * 0.0016), ry = rx * (0.5 + Math.random() * 0.4), turn = Math.random() * Math.PI;
        g.fillStyle = 'rgb(226,220,208)';
        g.beginPath(); g.ellipse(cx, cy, rx, ry, turn, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(244,240,232,0.7)';
        g.beginPath(); g.ellipse(cx - rx * 0.2, cy - ry * 0.2, rx * 0.5, ry * 0.45, turn, 0, Math.PI * 2); g.fill();
        sg.fillStyle = 'rgb(255,60,0)';
        sg.beginPath(); sg.ellipse(cx, cy, rx, ry, turn, 0, Math.PI * 2); sg.fill();
        for (let yy = Math.floor(cy - rx); yy <= cy + rx; yy++) for (let xx = Math.floor(cx - rx); xx <= cx + rx; xx++) {
            if (xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && Math.hypot(xx - cx, yy - cy) < ry) field[yy * SIZE + xx] = 0.52;
        }
        n++;
    }
    // Vessels: an artery's thick pale wall holds it open round its small lumen, blood welling from it; a vein lies
    // collapsed and dark (the anatomy has the limbs' arteries; their veins run beside them); the cord shows its grey
    // butterfly in white, in its sheath.
    for (const v of vessels) {
        const x = X(v.x), y = Y(v.y), r = Math.max(2, M(v.r));
        const ring = (rr: number, colour: string) => { g.fillStyle = colour; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); };
        if (v.kind === 'cord') {
            ring(r * 1.4, 'rgb(212,198,182)');
            ring(r, 'rgb(236,226,206)');
            g.fillStyle = 'rgb(172,146,140)';
            g.beginPath(); g.ellipse(x - r * 0.33, y, r * 0.26, r * 0.62, 0.35, 0, Math.PI * 2); g.ellipse(x + r * 0.33, y, r * 0.26, r * 0.62, -0.35, 0, Math.PI * 2); g.fill();
            continue;
        }
        const pool = g.createRadialGradient(x, y, 0, x, y, r * 5);
        pool.addColorStop(0, 'rgba(58,2,2,0.8)'); pool.addColorStop(1, 'rgba(58,2,2,0)');
        g.fillStyle = pool; g.beginPath(); g.arc(x, y, r * 5, 0, Math.PI * 2); g.fill();
        if (v.kind === 'artery') {
            ring(r * 1.05, 'rgb(230,212,200)');
            ring(r * 0.5, 'rgb(40,2,2)');
            if (!/carotid|aorta/.test(v.name)) {
                g.fillStyle = 'rgb(60,12,26)';
                g.beginPath(); g.ellipse(x + M(v.r * 2.4), y, r * 1.15, r * 0.48, 0.4, 0, Math.PI * 2); g.fill();
            }
        } else {
            g.fillStyle = 'rgb(60,12,26)';
            g.beginPath(); g.ellipse(x, y, r * 1.3, r * 0.55, 0.6, 0, Math.PI * 2); g.fill();
        }
    }
    // Torn flesh: shreds of muscle pulled out of line, and dark clot between them.
    if (torn) {
        for (let n = 0; n < 120; n++) {
            const p = skin[Math.floor(Math.random() * k)], t = 0.25 + Math.random() * 0.75, mid = centroid(skin);
            const x = mid.x + (p.x - mid.x) * t, y = mid.y + (p.y - mid.y) * t, a = Math.random() * Math.PI * 2, l = M(0.002 + Math.random() * 0.008);
            g.strokeStyle = Math.random() < 0.55 ? 'rgba(150,26,22,0.85)' : 'rgba(36,2,2,0.75)';
            g.lineWidth = Math.max(1, M(0.0007 + Math.random() * 0.0016));
            g.lineCap = 'round';
            g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(x) + Math.cos(a) * l, Y(y) + Math.sin(a) * l); g.stroke();
        }
    }
    albedo.update(true);
    surface.update(true);

    // The bend of the surface (a normal map) from its height.
    const bump = new BABYLON.DynamicTexture('cut_face_bump', { width: SIZE, height: SIZE }, scene, true);
    const bg = bump.getContext() as CanvasRenderingContext2D, bi = bg.createImageData(SIZE, SIZE), bp = bi.data;
    const at = (x: number, y: number) => field[(y < 0 ? 0 : y >= SIZE ? SIZE - 1 : y) * SIZE + (x < 0 ? 0 : x >= SIZE ? SIZE - 1 : x)];
    const steep = 0.004 / metre;
    for (let y = 0, i = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++, i += 4) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * steep, dy = (at(x, y + 1) - at(x, y - 1)) * steep, l = Math.hypot(dx, dy, 1);
        bp[i] = (-dx / l * 0.5 + 0.5) * 255; bp[i + 1] = (dy / l * 0.5 + 0.5) * 255; bp[i + 2] = (0.5 / l + 0.5) * 255; bp[i + 3] = 255;
    }
    bg.putImageData(bi, 0, 0);
    bump.update(true);
    // Heights in metres for the cut face's own shape: the muscle swelling a few millimetres out of its sheath, bone
    // standing proud, the fat a little sunk.
    const height = (x: number, y: number) => {
        const fx = X(x), fy = Y(y), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const v = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
        return (v - 0.42) * (torn ? 0.08 : 0.05);
    };
    return { albedo, bump, surface, E, height };
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Value noise from a fixed table of random values, 0 to 1, smooth between whole numbers.
const TABLE = Float32Array.from({ length: 65536 }, () => Math.random());
function vnoise(x: number, y: number) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i0 = (iy & 255) << 8, i1 = ((iy + 1) & 255) << 8, x0 = ix & 255, x1 = (ix + 1) & 255;
    const a = TABLE[i0 + x0], b = TABLE[i0 + x1], c = TABLE[i1 + x0], d = TABLE[i1 + x1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

// A whole-number cell's own random number, 0 to 1.
function hash(i: number, j: number, seed: number) {
    let h = (i * 374761393 + j * 668265263 + Math.floor(seed) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Worley's cells over a jittered grid: how far the nearest cell's point is and the next nearest, and the nearest's own
// random number.
const _cell = { f1: 0, f2: 0, id: 0, id2: 0 };
function worley(x: number, y: number, seed: number) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0, id2 = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const cx = ix + i, cy = iy + j, h = hash(cx, cy, seed);
        const dx = cx + 0.1 + 0.8 * h - x, dy = cy + 0.1 + 0.8 * hash(cy, cx, seed + 1) - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; id2 = id; f1 = d; id = h; } else if (d < f2) { f2 = d; id2 = h; }
    }
    _cell.f1 = f1; _cell.f2 = f2; _cell.id = id; _cell.id2 = id2;
    return _cell;
}

function capMaterial(scene: BABYLON.Scene, look: Look) {
    const m = new BABYLON.PBRMaterial('cut_face', scene);
    m.albedoTexture = look.albedo;
    m.bumpTexture = look.bump;
    // How rough each point is (green) from the picture's own map: blood lying on it is glossy.
    m.metallicTexture = look.surface;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.useAmbientOcclusionFromMetallicTextureRed = false;
    m.metallic = 1;
    m.roughness = 1;
    // Cut flesh is wet: a thin film of tissue fluid over all of it.
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.5;
    m.clearCoat.roughness = 0.15;
    m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
    m.environmentIntensity = 0.35;
    m.maxSimultaneousLights = 8;
    return m;
}

// The cut face as a mesh: the skin's outline filled in rings toward the bone, raised or sunk by the painted heights,
// each bone standing proud of it as a short stub with its own end face; skinned wholly to bone `bone`. `facing` 1 for
// the stump (facing down the limb, along n), -1 for the piece.
function capMesh(npc, name: string, c: BABYLON.Vector3, n: BABYLON.Vector3, e1: BABYLON.Vector3, e2: BABYLON.Vector3, skinLoop: SectionPoint[], solids, look: Look,
    facing: number, bone: number, proud: number, torn: boolean) {
    const pos: number[] = [], uv: number[] = [], index: number[] = [];
    const E = look.E;
    const put = (x: number, y: number, up: number) => {
        const p = c.add(e1.scale(x)).add(e2.scale(y)).add(n.scale(up * facing));
        pos.push(p.x, p.y, p.z);
        uv.push(x / (2 * E) + 0.5, y / (2 * E) + 0.5);
        return pos.length / 3 - 1;
    };
    // (Faces turned to face out of the stump, or out of the piece.)
    const tri = (a: number, b: number, d: number) => (facing > 0 ? index.push(a, d, b) : index.push(a, b, d));
    const skin = resample(skinLoop, 96), bones = solids.filter((s) => s.kind === 'bone' || s.kind === 'skull');
    const middle = bones.length ? centroid(bones.flatMap((b) => b.loop)) : centroid(skin);
    const RINGS = 9;
    const rings: number[][] = [];
    for (let j = 0; j <= RINGS; j++) {
        const t = j / RINGS, ring: number[] = [];
        for (const p of skin) {
            const x = middle.x + (p.x - middle.x) * t, y = middle.y + (p.y - middle.y) * t;
            // The skin's edge stays on the plane; inside it, the flesh's own height.
            ring.push(put(x, y, j === RINGS ? 0 : look.height(x, y) * Math.min(1, (1 - t) * 6)));
            if (j === 0) break;
        }
        rings.push(ring);
    }
    const count = skin.length;
    for (let i = 0; i < count; i++) tri(rings[0][0], rings[1][i], rings[1][(i + 1) % count]);
    for (let j = 1; j < RINGS; j++) for (let i = 0; i < count; i++) {
        const a = rings[j][i], b = rings[j][(i + 1) % count], d = rings[j + 1][i], e = rings[j + 1][(i + 1) % count];
        tri(a, d, e); tri(a, e, b);
    }
    // The bones: a wall from below the flesh's face up to where they end, and their end faces; a torn bone ends in points.
    for (const b of bones) {
        if (Math.abs(loopArea(b.loop)) < 1.2e-5) continue;
        const loop = resample(b.loop, 40), mid = centroid(loop), k = loop.length;
        const tops = loop.map((p, i) => proud * (torn ? 0.6 + 0.8 * Math.abs(wobble(i / k, mid.x * 900)) + (i % 7 === 0 ? 0.9 : 0) : 0.9 + 0.2 * Math.abs(wobble(i / k, 3))));
        const low = loop.map((p) => put(p.x, p.y, -0.003)), high = loop.map((p, i) => put(p.x + (mid.x - p.x) * 0.02, p.y + (mid.y - p.y) * 0.02, tops[i]));
        for (let i = 0; i < k; i++) { const j = (i + 1) % k; tri(low[i], low[j], high[j]); tri(low[i], high[j], high[i]); }
        const centre = put(mid.x, mid.y, Math.min(...tops) * 0.9);
        for (let i = 0; i < k; i++) tri(centre, high[i], high[(i + 1) % k]);
    }
    const mesh = new BABYLON.Mesh(name, npc.world.scene);
    const vd = new BABYLON.VertexData();
    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(pos, index, normals);
    const vertices = pos.length / 3;
    Object.assign(vd, { positions: pos, indices: index, normals, uvs: uv,
        matricesIndices: new Float32Array(vertices * 4).map((_, i) => (i % 4 === 0 ? bone : 0)), matricesWeights: new Float32Array(vertices * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)) });
    vd.applyToMesh(mesh, false);
    const { person } = npc;
    mesh.parent = person.mesh.parent;
    mesh.position.copyFrom(person.mesh.position);
    mesh.skeleton = person.skeleton;
    mesh.numBoneInfluencers = 1;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
}

export { LIMBS };
