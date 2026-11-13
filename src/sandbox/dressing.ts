// Bandages: a wound dressed by hand, and a medkit that dresses them all.
//
// A dressing is gauze held down hard on a wound. What it does to the bleeding is what pressure does: a vein or the
// small vessels of skin and muscle close under it and stop within a minute or two; an artery's pressure is far above
// what a bandage can press with, so it only slows (a limb artery needs a tourniquet, or packing and a minute or more
// of hard pressure on top: TCCC guidelines; Kragh et al. 2008); and nothing pressed on the skin closes a torn liver or
// spleen under it, it only holds the wall's hole a little shut. The figures are in DRESSED.
//
// What is put on is the body's own skin where the wound is, copied, lifted a few millimetres and skinned to the same
// bones, so it lies on the body and moves with it whatever the ragdoll does: a pad taped over a wound on the trunk,
// head or neck, a gauze roll wound round an arm or a leg, and round and over the end of a stump. Clothes over it are
// cut away first, as a medic's shears do. The blood still coming out of the wound goes into the gauze, which takes up
// about what gauze does (GAUZE) and shows it on top, spreading as it fills, red when fresh and browner as it dries;
// once it is full the rest runs out from under it (runs.ts).

import * as BABYLON from '@babylonjs/core';
import { convexHull } from './behaviour.ts';
import { BruiseLayer } from './bruise.ts';
const V3 = BABYLON.Vector3;

// What a dressing leaves of a vessel's flow, by kind of bleeding.
const DRESSED = { seeping: 0.05, arterial: 0.35, inside: 0.75 };
// Millilitres of blood a square centimetre of the dressing holds: a 12-ply gauze pad takes up about 0.15, a few turns
// of open gauze roll about half that (gauze takes up several times its weight; a 10 cm pad weighs a few grams).
const GAUZE = { pad: 0.15, wrap: 0.08 };
const SECONDS = 4;          // to put one on: a game's few seconds for what takes a minute with pressure held
const REACH = 1.9;          // metres from the eye to a wound that can be reached (one on the floor, kneeling down to it)
const SIDE = 0.05;          // half a 10 cm pad
const FACE = 0.035;         // half the 7 cm pad put on a face or a neck
const BAND = 0.07;          // the roller bandage wound round a head is 7 cm wide
const BENDS = 0.05;         // m: a pad's gauze bends no tighter than this over what it lies on (it bridges an eye's hollow)
const ROLL = 0.1;           // the gauze roll is 10 cm wide
const PX = 512;             // each dressing's picture

// How a bleed is helped: an artery open to the air, anything inside the body, or the rest.
const helped = (b) => (b.internal ? DRESSED.inside : b.arterial ? DRESSED.arterial : DRESSED.seeping);

// The wounds on person `npc` that are open (any of their bleeds undressed) and come out through the skin (a bleed
// outside, or a bullet's way out, which is where what it tore inside comes out): bleeds
// within 4 cm of each other, now, are one wound. [{ npc, mark, at, normal, bleeds, flow }], worst first.
export function wounds(npc) {
    const list = [];
    for (const b of npc.vitals.bleeds) {
        const mark = b.source?.mark;
        if (!mark?.rest || !mark.owner) continue;
        const { at, normal } = npc.worldOf(mark.rest, mark.owner, mark.restNormal);
        let w = list.find((w) => V3.Distance(w.at, at) < 0.04);
        if (!w) list.push(w = { npc, mark, at, normal, bleeds: [], flow: 0, open: false, outside: false });
        w.bleeds.push(b);
        w.flow += b.flow ?? 0;
        if (!b.internal || mark.open) w.outside = true;
        if (b.dressed === undefined) w.open = true;
    }
    return list.filter((w) => w.outside && w.open).sort((a, b) => b.flow - a.flow);
}

// The player putting dressings on: the bandage on the wound looked at, the medkit on every open wound of the person
// looked at, worst first, one after another while the button is held. Also keeps every dressing in the room up.
export class Medic {
    declare weapons: any;
    declare job: { wound: any; t: number } | null;
    declare prompt: string;
    declare clock: number;

    constructor(weapons) {
        this.weapons = weapons;
        this.job = null;
        this.prompt = '';
        this.clock = 0;
    }

    // How far through the one being put on, 0 to 1, or null.
    get working() { return this.job ? this.job.t / SECONDS : null; }

    update(dt: number) {
        const w = this.weapons, world = w.world;
        for (const npc of world.npcs) for (const d of [...(npc.dressings ?? [])]) d.update(dt);
        const arm = w.arm;
        if (arm.kind !== 'dress') { this.job = null; this.prompt = ''; return; }
        const wound = arm.key === 'medkit' ? this._person() : this._aim();
        if (!wound) {
            this.job = null;
            this.prompt = '';
            return;
        }
        const n = arm.key === 'medkit' ? wounds(wound.npc).length : 1;
        this.prompt = `<b>Hold left click</b> ${arm.key === 'medkit' ? `Dress ${n > 1 ? `all ${n} wounds` : 'the wound'}` : 'Dress the wound'}`;
        if (!w.firing) { this.job = null; return; }
        // The same wound as last frame is the one its first bleed is still in.
        if (!this.job || !wound.bleeds.includes(this.job.wound.bleeds[0])) this.job = { wound, t: 0 };
        this.job.wound = wound;
        this.clock += dt;
        this.job.t += dt;
        this.prompt = `Dressing${n > 1 ? ` (${n} left)` : ''} ${Math.round(Math.min(1, this.job.t / SECONDS) * 100)}%`;
        if (this.job.t < SECONDS) return;
        dress(wound);
        this.job = null;
    }

    // The open wound nearest the middle of the view, within reach and facing the eye.
    _aim() {
        const { camera, npcs } = this.weapons.world;
        const eye = camera.globalPosition, ahead = camera.getDirection(V3.Forward());
        let best = null, score = Infinity;
        for (const npc of npcs) {
            if (V3.Distance(eye, npc.ragdoll.centre) > REACH + 1.2) continue;
            for (const w of wounds(npc)) {
                const to = w.at.subtract(eye), t = V3.Dot(to, ahead);
                if (t < 0.1 || t > REACH || (w.normal && V3.Dot(w.normal, ahead) > 0.3)) continue;
                const off = to.subtract(ahead.scale(t)).length() / t;
                if (off < 0.09 && off < score) { best = w; score = off; }
            }
        }
        return best;
    }

    // The worst open wound of whoever is in front of the eye.
    _person() {
        const { camera } = this.weapons.world;
        const near = this.weapons._person(camera.globalPosition, camera.getDirection(V3.Forward()), REACH);
        return near ? wounds(near.npc)[0] ?? null : null;
    }
}

// --- one dressing ---------------------------------------------------------------------

// The person's mesh data: rest positions, normals, triangles, weights.
const bodyOf = (npc) => npc.person.lib.bodies.get(npc.person.bodyName);

// Two directions square to unit `n` and to each other, the first as near to up as it can be.
function frame(n: BABYLON.Vector3) {
    const hint = Math.abs(n.y) < 0.9 ? V3.Up() : V3.Forward();
    const ey = hint.subtract(n.scale(V3.Dot(hint, n))).normalize();
    return { ex: V3.Cross(ey, n).normalize(), ey };
}

// Put a dressing on wound `w` (from wounds()).
export function dress(w) {
    const npc = w.npc;
    const d = new Dressing(npc, w.mark);
    if (!d.mesh) return null;
    (npc.dressings ??= []).push(d);
    // Every bleed under it, this wound's and any other it covers.
    for (const b of npc.vitals.bleeds) {
        const mark = b.source?.mark;
        if (!w.bleeds.includes(b) && !(mark?.rest && d.covers(mark.rest))) continue;
        b.dressed = helped(b);
        b.dressing = d;
    }
    return d;
}

class Dressing {
    declare npc: any;
    declare mark: any;
    declare mesh: BABYLON.Mesh | null;
    declare material: BABYLON.PBRMaterial;
    declare texture: BABYLON.DynamicTexture;
    declare base: HTMLCanvasElement;
    declare covers: (rest: BABYLON.Vector3) => boolean;
    declare kind: 'pad' | 'wrap' | 'stump';
    declare side: number;
    declare area: number;
    declare band: { at: BABYLON.Vector3; axis: BABYLON.Vector3; r: number } | null;
    declare rider: any;
    declare layout: { Tu: number; Tv: number; x0: number; y0: number; top: number };
    declare per: number;
    declare capacity: number;
    declare held: number;
    declare since: number;
    declare painted: { r: number; dry: number; at: number };
    declare rest: Float32Array;
    declare verts: Int32Array;
    declare seen: number;
    declare wobble: number[];

    constructor(npc, mark) {
        this.npc = npc;
        this.mark = mark;
        this.held = 0;
        this.since = 0;
        this.seen = npc.dismember.cuts.length;
        this.painted = { r: 0, dry: 0, at: 0 };
        this.wobble = [0, 1, 2].map(() => Math.random() * Math.PI * 2);
        const layer = (npc.dressings ?? []).filter((d) => d.covers(mark.rest)).length;
        const built = this._shape(mark, layer);
        if (!built) { this.mesh = null; return; }
        this._mesh(built);
        this._picture();
        this._clothes(mark);
        // Swelling under it (bruise.ts) lifts it, at once where it lies on the skin, and it presses the swelling back.
        new BruiseLayer(this.material, npc.bruise, false);
        this.rider = npc.bruise.ride(this.mesh, this.rest, 0, 1);
    }

    // The patch of skin it lies on, lifted off it: corners (the skin's own, for their bones), positions, normals, and
    // where each is on the dressing (x, y in metres, which the picture is drawn in).
    _shape(mark, layer) {
        const npc = this.npc, { header, arrays } = bodyOf(npc);
        const pos = arrays.position, nor = arrays.normal, index = arrays.index;
        const P = (v) => new V3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), N = (v) => new V3(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        const lift = 0.0028 + layer * 0.003;
        const cut = mark.corners?.length ? null : npc.dismember.cuts.find((c) => c.prox === mark.owner && V3.Distance(c.c, mark.rest) < 0.2);
        this.side = SIDE;
        this.band = null;
        const region = cut ? null : this._region(mark);
        if (region) return this._head(mark, lift, region);
        const limb = !cut && /upperarm|lowerarm|upperleg|lowerleg/.test(mark.owner.bone.name);
        // Each corner of the skin: on it (with its x, y and lifted place), or null.
        let place: (v: number) => { x: number; y: number; at: BABYLON.Vector3; n: BABYLON.Vector3 } | null;
        let cap = null;
        if (!limb && !cut) {
            // A pad, square on the skin, centred on the wound, its sides along the body and across it; the pad thickest
            // in the middle where it is folded over itself, the tape over its ends thinner.
            this.kind = 'pad';
            const c = mark.rest, n = mark.restNormal, { ex, ey } = frame(n), H = SIDE * 1.6;
            this.layout = { Tu: 2 * H, Tv: 2 * H, x0: -H, y0: -H, top: 0 };
            this.covers = (r) => { const d = r.subtract(c); return Math.abs(V3.Dot(d, ex)) < SIDE + 0.01 && Math.abs(V3.Dot(d, ey)) < SIDE + 0.01 && Math.abs(V3.Dot(d, n)) < 0.03; };
            place = (v) => {
                const d = P(v).subtract(c), x = V3.Dot(d, ex), y = V3.Dot(d, ey);
                if (Math.abs(x) > H || Math.abs(y) > H || Math.abs(V3.Dot(d, n)) > 0.04) return null;
                let nv = N(v);
                if (V3.Dot(nv, n) < 0) nv = nv.scale(-1);
                if (V3.Dot(nv, n) < 0.3) return null;
                const pad = Math.abs(x) < SIDE && Math.abs(y) < SIDE ? 0.002 + 0.004 * Math.exp(-(x * x + y * y) / 0.0009) : 0;
                return { x, y, at: P(v).add(nv.scale(lift + pad)), n: nv };
            };
        } else {
            // Round a limb: the line it runs along, and how far out its skin is at the wound; or at a stump, the line
            // square to the cut, ending at it.
            const owner = mark.owner;
            const a = cut ? cut.c : owner.head, axis = cut ? cut.n.clone() : owner.tail.subtract(owner.head).normalize();
            const along = (q: BABYLON.Vector3) => V3.Dot(q.subtract(a), axis);
            const out = (q: BABYLON.Vector3) => q.subtract(a).subtract(axis.scale(along(q)));
            const p0 = cut ? -ROLL / 2 : along(mark.rest);
            let r0 = out(mark.rest).length();
            if (cut) {
                // A stump's wound is on the cut face: how thick the limb is there is read off the skin just above it.
                const ring = [];
                for (const part of header.parts) {
                    if (part.kind !== 'skin') continue;
                    for (let v = part.vertexStart; v < part.vertexStart + part.vertexCount; v++) {
                        const p = along(P(v)), r = out(P(v)).length();
                        if (p < 0 && p > -0.025 && r < 0.2) ring.push(r);
                    }
                }
                ring.sort((x, y) => x - y);
                r0 = ring[Math.floor(ring.length * 0.6)] ?? 0.05;
            }
            const far = r0 * 1.45 + 0.02, e0 = cut ? frame(axis).ex : out(mark.rest).normalize(), e1 = V3.Cross(axis, e0);
            const round = 2 * Math.PI * (r0 + lift);
            this.kind = cut ? 'stump' : 'wrap';
            const low = cut ? -ROLL : p0 - ROLL / 2, high = cut ? 0 : p0 + ROLL / 2;
            this.covers = (r) => { const p = along(r); return p > low - 0.01 && p < high + (cut ? 0.05 : 0.01) && out(r).length() < far; };
            place = (v) => {
                const q = P(v), p = along(q);
                if (p < low - 0.012 || p > high + (cut ? 0 : 0.012)) return null;
                const o = out(q), r = o.length();
                if (r > far || r < r0 * 0.3) return null;
                let nv = N(v);
                const radial = o.scale(1 / r);
                if (V3.Dot(nv, radial) < 0) nv = nv.scale(-1);
                if (V3.Dot(nv, radial) < 0.2) return null;
                const x = Math.atan2(V3.Dot(o, e1), V3.Dot(o, e0)) * (r0 + lift);
                // The pad under the turns, over the wound.
                const pad = cut ? 0 : 0.004 * Math.exp(-(x * x + (p - p0) * (p - p0)) / 0.0009);
                return { x, y: cut ? p : p - p0, at: q.add(nv.scale(lift + pad)), n: nv };
            };
            if (cut) {
                // Over the end: the turns gathered across it, a low dome.
                const rc = r0 + lift + 0.002;
                this.layout = { Tu: round, Tv: ROLL + rc + 0.02, x0: -round / 2, y0: -ROLL - 0.01, top: rc };
                cap = { a, axis, e0, e1, rc, round };
            } else this.layout = { Tu: round, Tv: ROLL + 0.03, x0: -round / 2, y0: -ROLL / 2 - 0.015, top: 0 };
        }

        // The triangles of skin wholly on it, each corner its own (the roll's seam, opposite the wound, needs two).
        const mi = npc.dismember._mi, mw = npc.dismember._mw;
        const joint = (v, k) => (mi ? mi[v * 4 + k] : arrays.joints[v * 4 + k]), weight = (v, k) => (mw ? mw[v * 4 + k] : arrays.weights[v * 4 + k] / 255);
        const out = { P: [], N: [], U: [], J: [], W: [], rest: [], verts: [] };
        const corner = (at: BABYLON.Vector3, n: BABYLON.Vector3, x: number, y: number, rest: BABYLON.Vector3, js: number[], ws: number[], v: number) => {
            out.P.push(at.x, at.y, at.z); out.N.push(n.x, n.y, n.z);
            const L = this.layout;
            out.U.push((x - L.x0) / L.Tu, (y - L.y0) / L.Tv);
            out.J.push(...js); out.W.push(...ws);
            out.rest.push(rest.x, rest.y, rest.z);
            out.verts.push(v);
        };
        const done = new Map();
        for (const part of header.parts) {
            if (part.kind !== 'skin') continue;
            for (let i = part.indexStart; i < part.indexStart + part.indexCount; i += 3) {
                const tri = [index[i], index[i + 1], index[i + 2]];
                const on = tri.map((v) => (done.has(v) ? done.get(v) : done.set(v, place(v)).get(v)));
                if (on.some((o) => !o)) continue;
                let xs = on.map((o) => o.x);
                if (this.kind !== 'pad' && Math.max(...xs) - Math.min(...xs) > this.layout.Tu / 2) xs = xs.map((x) => (x < 0 ? x + this.layout.Tu : x));
                tri.forEach((v, k) => corner(on[k].at, on[k].n, xs[k], on[k].y, P(v), [0, 1, 2, 3].map((q) => joint(v, q)), [0, 1, 2, 3].map((q) => weight(v, q)), v));
            }
        }
        if (out.P.length < 9) return null;
        if (cap) {
            // The dome: rings in to the middle, carried by the bone the stump hangs from. Its x runs round as the roll's
            // does; its y goes on from the rim over the top, so the wound is at the top of the picture.
            const S = 24, R = 5, bone = mark.owner.index;
            const at = (k, s) => {
                const rho = cap.rc * (1 - k / R), th = (s / S) * Math.PI * 2 - Math.PI;
                const radial = cap.e0.scale(Math.cos(th)).add(cap.e1.scale(Math.sin(th)));
                const up = 0.35 * cap.rc * Math.sin((Math.PI / 2) * (k / R));
                const n = radial.scale(Math.cos((Math.PI / 2) * (k / R))).add(cap.axis.scale(Math.sin((Math.PI / 2) * (k / R)))).normalize();
                return { p: cap.a.add(radial.scale(rho)).add(cap.axis.scale(up - 0.003)), n, x: th * cap.round / (2 * Math.PI), y: cap.rc - rho };
            };
            for (let k = 0; k < R; k++) {
                for (let s = 0; s < S; s++) {
                    const quad = [at(k, s), at(k, s + 1), at(k + 1, s + 1), at(k + 1, s)];
                    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
                        for (const q of tri) corner(quad[q].p, quad[q].n, quad[q].x, quad[q].y, quad[q].p, [bone, 0, 0, 0], [1, 0, 0, 0], -1);
                    }
                }
            }
        }
        return out;
    }

    // Where on the head or neck a wound is, for what is put on it: 'face' (below the brows, in front: a pad taped on),
    // 'scalp' (the forehead above the brows, the temples, the crown, the back: a pad held by a roller bandage wound round
    // the head), 'neck' (a pad taped on: nothing is wound round a neck), or null off the head and neck.
    _region(mark): 'face' | 'scalp' | 'neck' | null {
        const bones = this.npc.person.header.bones;
        for (let at = mark.owner.index; at >= 0; at = bones[at].parent) {
            const name = bones[at].name;
            if (/^neck0\d$/.test(name)) return 'neck';
            if (name === 'head') {
                const eye = this.npc.person.byName['eye.L'].head;
                return mark.rest.y < eye.y + 0.025 && mark.restNormal.z > -0.2 ? 'face' : 'scalp';
            }
            if (/^spine/.test(name)) return null;
        }
        return null;
    }

    // A dressing on the head or neck, made as gauze lies and not as a copy of the skin under it (which, over a nose, an
    // eye and a cheek, came apart into scraps where the skin turned away). A pad is a sheet laid over the skin round the
    // wound that bends no tighter than gauze does: it rests on the nose and the cheekbone and bridges the eye's hollow,
    // with clean edges and tape over two of them. Round the head, a band: the roller bandage's turns, taut over the skull
    // and the hair as a bandage pulled round it is (the convex outline of the head across each line of it), through the
    // wound and round the back below the occiput, or across the forehead above the brows for one at the back, with the
    // pad under it over the wound. Carried by the head's bone (a neck pad by the neck's, as the skin under it is).
    _head(mark, lift: number, region: 'face' | 'scalp' | 'neck') {
        const npc = this.npc, person = npc.person, { header, arrays } = bodyOf(npc), bones = header.bones;
        const pos = arrays.position;
        const P = (v) => new V3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        const mi = npc.dismember._mi, mw = npc.dismember._mw;
        const joint = (v, k) => (mi ? mi[v * 4 + k] : arrays.joints[v * 4 + k]), weight = (v, k) => (mw ? mw[v * 4 + k] : arrays.weights[v * 4 + k] / 255);
        // A corner of the dressing moves with the bones the skin under it moves with, the face's own little ones (a lid, a
        // lip) given to the head they hang from: the gauze does not follow a lid.
        const keep = (b) => { while (b >= 0 && !/^(head|jaw|neck0\d|spine0\d|clavicle\.[LR]|root)$/.test(bones[b].name)) b = bones[b].parent; return Math.max(0, b); };
        const skinOf = (v) => {
            const js = [0, 0, 0, 0], ws = [0, 0, 0, 0];
            for (let k = 0; k < 4; k++) {
                const b = keep(joint(v, k)), w = weight(v, k);
                if (w <= 0) continue;
                const slot = js.indexOf(b) >= 0 && ws[js.indexOf(b)] > 0 ? js.indexOf(b) : ws.indexOf(0);
                js[slot] = b; ws[slot] += w;
            }
            return { js, ws };
        };
        const near = (kinds: string[], test: (p: BABYLON.Vector3) => boolean) => {
            const list: number[] = [];
            for (const part of header.parts) {
                if (!kinds.includes(part.kind)) continue;
                for (let v = part.vertexStart; v < part.vertexStart + part.vertexCount; v++) if (test(P(v))) list.push(v);
            }
            return list;
        };
        const out = { P: [], N: [], U: [], J: [], W: [], rest: [], verts: [] };
        // A grid of corners `rows` x `cols` (each { at, rest, x, y, v, js, ws }) as triangles, its normals from the grid.
        const sheet = (grid, rows: number, cols: number) => {
            const at = (i, j) => grid[i * cols + j];
            const normal = (i, j) => {
                const a = at(Math.min(rows - 1, i + 1), j) ?? at(i, j), b = at(Math.max(0, i - 1), j) ?? at(i, j);
                const c = at(i, Math.min(cols - 1, j + 1)) ?? at(i, j), d = at(i, Math.max(0, j - 1)) ?? at(i, j);
                return V3.Cross(a.at.subtract(b.at), c.at.subtract(d.at)).normalize();
            };
            const L = this.layout;
            for (let i = 0; i + 1 < rows; i++) {
                for (let j = 0; j + 1 < cols; j++) {
                    const quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
                    if (quad.some(([a, b]) => !at(a, b))) continue;
                    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
                        for (const q of tri) {
                            const [a, b] = quad[q], g = at(a, b);
                            let n = normal(a, b);
                            if (V3.Dot(n, g.out) < 0) n = n.scale(-1);
                            out.P.push(g.at.x, g.at.y, g.at.z); out.N.push(n.x, n.y, n.z);
                            out.U.push((g.x - L.x0) / L.Tu, (g.y - L.y0) / L.Tv);
                            out.J.push(...g.js); out.W.push(...g.ws);
                            out.rest.push(g.rest.x, g.rest.y, g.rest.z);
                            out.verts.push(g.v);
                        }
                    }
                }
            }
        };

        if (region !== 'scalp') {
            this.kind = 'pad';
            const side = (this.side = FACE), H = side * 1.6, G = 25;
            const c = mark.rest, n = mark.restNormal, { ex, ey } = frame(n);
            this.layout = { Tu: 2 * H, Tv: 2 * H, x0: -H, y0: -H, top: 0 };
            this.area = 4 * side * side;
            this.covers = (r) => { const d = r.subtract(c); return Math.abs(V3.Dot(d, ex)) < side + 0.01 && Math.abs(V3.Dot(d, ey)) < side + 0.01 && Math.abs(V3.Dot(d, n)) < 0.03; };
            // The skin (and the eyes in it) round the wound, in the pad's own terms: across, up, and how high off it.
            const pts = near(['skin', 'eyes'], (p) => { const d = p.subtract(c); return Math.abs(V3.Dot(d, ex)) < H + 0.03 && Math.abs(V3.Dot(d, ey)) < H + 0.03 && V3.Dot(d, n) > -0.06; })
                .map((v) => { const d = P(v).subtract(c); return [V3.Dot(d, ex), V3.Dot(d, ey), V3.Dot(d, n), v]; });
            const skin = new Set(near(['skin'], () => true).filter((v) => pts.some((p) => p[3] === v)));
            const grid = [];
            for (let i = 0; i <= G; i++) {
                for (let j = 0; j <= G; j++) {
                    const x = -H + (2 * H * j) / G, y = -H + (2 * H * i) / G;
                    // As high as the skin anywhere near, less how far gauze bends down from there.
                    let h = -Infinity, best = Infinity, v = -1;
                    for (const [px, py, ph, pv] of pts) {
                        const d2 = (px - x) ** 2 + (py - y) ** 2;
                        if (d2 > 0.0009) continue;
                        h = Math.max(h, ph - d2 / (2 * BENDS));
                    }
                    if (h === -Infinity) { grid.push(null); continue; }
                    // (Moved by the skin under it: the nearest corner of skin on top, not one under the nose's other side.)
                    for (const [px, py, ph, pv] of pts) {
                        const d2 = (px - x) ** 2 + (py - y) ** 2;
                        if (ph > h - 0.012 && d2 < best && skin.has(pv)) { best = d2; v = pv; }
                    }
                    if (v < 0) { grid.push(null); continue; }
                    const pad = Math.abs(x) < side && Math.abs(y) < side ? 0.002 + 0.003 * Math.exp(-(x * x + y * y) / (side * side * 0.36)) : 0;
                    const rest = c.add(ex.scale(x)).addInPlace(ey.scale(y)).addInPlace(n.scale(h));
                    grid.push({ at: rest.add(n.scale(lift + pad)), rest, out: n, x, y, v, ...skinOf(v) });
                }
            }
            sheet(grid, G + 1, G + 1);
        } else {
            this.kind = 'wrap';
            // The skull's middle and the head's own up, forward and across, at rest.
            const head = person.byName['head'], rd = npc.ragdoll.byName.get('head');
            const o = rd.geo.c.add(rd.head), up = head.tail.subtract(head.head).normalize();
            const fwd = new V3(0, 0, 1).subtract(up.scale(up.z)).normalize(), eye = person.byName['eye.L'].head;
            const c = mark.rest, way = c.subtract(o).subtract(up.scale(V3.Dot(c.subtract(o), up))).normalize();
            // The turns pass through the wound and, on the far side of the head, above the brows in front, above the ears at
            // the side, under the bump of the occiput at the back (where they hold without sliding up off it).
            const f = -V3.Dot(way, fwd), rise = f > 0 ? 0.02 + 0.015 * f : 0.02 + 0.03 * f;
            const anchor = o.subtract(way.scale(0.09));
            anchor.addInPlace(up.scale(eye.y + rise - anchor.y));
            const across = V3.Cross(up, way).normalize();
            let m = V3.Cross(c.subtract(anchor), across).normalize();
            if (V3.Dot(m, up) < 0) m = m.scale(-1);
            const mid = o.subtract(m.scale(V3.Dot(o.subtract(c), m)));
            const e0 = c.subtract(mid).normalize(), e1 = V3.Cross(m, e0).normalize();
            const skull = near(['skin', 'hair', 'eyes', 'brows'], (p) => V3.Distance(p, o) < 0.17 && p.y > person.byName['neck02'].head.y);
            // Across each line of the band, the outline of the head (and hair) there, and how far out it is each way round.
            const ROWS = 9, COLS = 72, wide = BAND / 2 + 0.012;
            const radius = (s: number) => {
                const flat = [];
                for (const v of skull) {
                    const d = P(v).subtract(mid);
                    if (Math.abs(V3.Dot(d, m) - s) < 0.007) flat.push([V3.Dot(d, e0), V3.Dot(d, e1)]);
                }
                if (flat.length < 8) return null;
                const hull = convexHull(flat);
                return Array.from({ length: COLS }, (_, k) => {
                    const th = (k / COLS) * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th);
                    let far = 0;
                    for (let q = 0; q < hull.length; q++) {
                        const [ax, ay] = hull[q], [bx, by] = hull[(q + 1) % hull.length];
                        const ex2 = bx - ax, ey2 = by - ay, den = dx * ey2 - dy * ex2;
                        if (Math.abs(den) < 1e-12) continue;
                        const t = (ax * ey2 - ay * ex2) / den, u = (ax * dy - ay * dx) / den;
                        if (t > 0 && u >= 0 && u <= 1) far = Math.max(far, t);
                    }
                    return far;
                });
            };
            const rows = Array.from({ length: ROWS }, (_, i) => -wide + (2 * wide * i) / (ROWS - 1));
            const rings = rows.map(radius);
            const middle = rings[(ROWS - 1) / 2];
            if (!middle) return null;
            const round = middle.reduce((a, r, k) => a + Math.hypot(r * Math.cos((2 * Math.PI) / COLS) - middle[(k + 1) % COLS], r * Math.sin((2 * Math.PI) / COLS)), 0);
            this.layout = { Tu: round, Tv: BAND + 0.03, x0: -round / 2, y0: -BAND / 2 - 0.015, top: 0 };
            this.area = round * BAND;
            this.band = { at: mid, axis: m, r: Math.max(...middle) + 0.03 };
            this.covers = (r) => Math.abs(V3.Dot(r.subtract(mid), m)) < BAND / 2 + 0.01 && V3.Distance(r, o) < 0.16;
            const bone = head.index, grid = [];
            for (let i = 0; i < ROWS; i++) {
                for (let k = 0; k <= COLS; k++) {
                    const ring = rings[i], th = (k / COLS) * Math.PI * 2, r = ring?.[k % COLS];
                    if (!r) { grid.push(null); continue; }
                    // The pad under the turns, over the wound.
                    // (x runs on from the wound all the way round, so the picture, repeating, meets itself where the ring closes.)
                    const x = (k / COLS) * round, y = rows[i], off = k <= COLS / 2 ? x : x - round;
                    const pad = 0.004 * Math.exp(-(off * off + y * y) / 0.0009);
                    const dir = e0.scale(Math.cos(th)).addInPlace(e1.scale(Math.sin(th)));
                    const rest = mid.add(m.scale(y)).addInPlace(dir.scale(r));
                    grid.push({ at: rest.add(dir.scale(lift + pad)), rest, out: dir, x, y, v: -1, js: [bone, 0, 0, 0], ws: [1, 0, 0, 0] });
                }
            }
            sheet(grid, ROWS, COLS + 1);
        }
        return out.P.length < 9 ? null : out;
    }

    _mesh(b) {
        const npc = this.npc, person = npc.person, scene = npc.world.scene;
        const mesh = new BABYLON.Mesh(`dressing_${person.mesh.name}`, scene);
        const count = b.P.length / 3;
        const vd = new BABYLON.VertexData();
        const indices = Array.from({ length: count }, (_, i) => i);
        Object.assign(vd, { positions: Float32Array.from(b.P), normals: Float32Array.from(b.N), uvs: Float32Array.from(b.U), indices: Uint32Array.from(indices),
            matricesIndices: Float32Array.from(b.J), matricesWeights: Float32Array.from(b.W) });
        vd.applyToMesh(mesh, true);
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
        mesh.skeleton = person.skeleton;
        mesh.numBoneInfluencers = 4;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        this.mesh = mesh;
        this.rest = Float32Array.from(b.rest);
        this.verts = Int32Array.from(b.verts);
        const L = this.layout;
        this.per = this.kind === 'pad' ? GAUZE.pad : GAUZE.wrap;
        this.capacity = (this.area ?? (this.kind === 'pad' ? 4 * SIDE * SIDE : L.Tu * ROLL)) * 1e4 * this.per;

        const texture = new BABYLON.DynamicTexture(`dressing_${person.mesh.name}`, { width: PX, height: PX }, scene, true);
        texture.hasAlpha = true;
        texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        if (this.kind === 'pad') texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        const m = new BABYLON.PBRMaterial(`dressing_${person.mesh.name}`, scene);
        m.albedoTexture = texture;
        m.useAlphaFromAlbedoTexture = true;
        m.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST;
        m.alphaCutOff = 0.5;
        m.metallic = 0;
        m.roughness = 0.93;
        // (Only its outside is ever seen; drawn both ways, the dome over a stump needs no particular winding.)
        m.backFaceCulling = false;
        mesh.material = m;
        this.material = m;
        this.texture = texture;
    }

    // From metres on the dressing to the picture's pixels (y up).
    _metres(g: CanvasRenderingContext2D) {
        const L = this.layout;
        g.setTransform(PX / L.Tu, 0, 0, -PX / L.Tv, -L.x0 * PX / L.Tu, PX + L.y0 * PX / L.Tv);
    }

    // The gauze itself, drawn once: white cotton, its weave, the folds of a pad and the tape over it, or the edges of
    // the turns of a roll laid half over each other.
    _picture() {
        const base = document.createElement('canvas');
        base.width = base.height = PX;
        const g = base.getContext('2d');
        const L = this.layout;
        this._metres(g);
        const speckle = (x0, y0, w, h, n) => {
            for (let k = 0; k < n; k++) {
                g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,115,105,0.12)';
                g.fillRect(x0 + Math.random() * w, y0 + Math.random() * h, 0.0008, 0.0008);
            }
        };
        if (this.kind === 'pad') {
            const SIDE = this.side, k = SIDE / 0.05;
            // The pad: folded gauze, its weave in a 1.5 mm grid, the fold lines a third of the way in.
            g.fillStyle = 'rgb(236,234,227)';
            g.beginPath();
            g.roundRect(-SIDE, -SIDE, SIDE * 2, SIDE * 2, 0.004);
            g.fill();
            g.lineWidth = 0.0003;
            g.strokeStyle = 'rgba(150,145,135,0.25)';
            for (let s = -SIDE; s <= SIDE; s += 0.0015) {
                g.beginPath(); g.moveTo(s, -SIDE); g.lineTo(s, SIDE); g.stroke();
                g.beginPath(); g.moveTo(-SIDE, s); g.lineTo(SIDE, s); g.stroke();
            }
            g.lineWidth = 0.0012;
            g.strokeStyle = 'rgba(120,115,105,0.35)';
            for (const s of [-SIDE / 3, SIDE / 3]) { g.beginPath(); g.moveTo(s, -SIDE); g.lineTo(s, SIDE); g.stroke(); }
            g.strokeRect(-SIDE + 0.003, -SIDE + 0.003, SIDE * 2 - 0.006, SIDE * 2 - 0.006);
            speckle(-SIDE, -SIDE, SIDE * 2, SIDE * 2, 2500);
            // Two strips of tape over its top and bottom edges, torn off the roll at their ends.
            for (const y of [SIDE - 0.012 * k, -SIDE - 0.012 * k]) {
                const ends = (x) => [0, 1, 2, 3, 4].map((j) => [x + (j % 2 ? 0.002 : -0.002) * Math.sign(x), y + j * 0.006 * k] as [number, number]);
                g.fillStyle = 'rgb(226,221,206)';
                g.beginPath();
                for (const [x, yy] of ends(-0.074 * k)) g.lineTo(x, yy);
                for (const [x, yy] of ends(0.074 * k).reverse()) g.lineTo(x, yy);
                g.closePath();
                g.fill();
                g.fillStyle = 'rgba(160,150,130,0.25)';
                for (let x = -0.07 * k; x < 0.07 * k; x += 0.003) g.fillRect(x, y + 0.0115 * k, 0.0012, 0.0008);
            }
        } else {
            // The roll: wound round with each turn half over the last, so the edge of a turn crosses the band on a slant
            // and comes round to meet the next (it repeats round the limb, which its picture does).
            const top = L.y0 + L.Tv - 0.01 - (this.kind === 'stump' ? 0 : 0.005), bottom = L.y0 + 0.01 + (this.kind === 'stump' ? 0 : 0.005);
            g.fillStyle = 'rgb(240,239,233)';
            g.beginPath();
            for (let x = L.x0; x <= L.x0 + L.Tu + 0.001; x += 0.004) g.lineTo(x, top + (this.kind === 'stump' ? 0.01 : Math.sin(x * 400) * 0.0008));
            for (let x = L.x0 + L.Tu; x >= L.x0 - 0.001; x -= 0.004) g.lineTo(x, bottom + Math.sin(x * 330 + 1) * 0.0008);
            g.closePath();
            g.fill();
            // Its crinkle, square to the way it was wound.
            g.lineWidth = 0.0004;
            for (let x = L.x0; x < L.x0 + L.Tu; x += 0.002) {
                g.strokeStyle = Math.random() < 0.5 ? 'rgba(140,135,125,0.18)' : 'rgba(255,255,255,0.3)';
                g.beginPath(); g.moveTo(x, bottom); g.lineTo(x, top); g.stroke();
            }
            const pitch = ROLL / 2;
            g.lineWidth = 0.0016;
            for (let y = bottom - pitch * 2; y < top + pitch; y += pitch) {
                g.strokeStyle = 'rgba(95,90,80,0.32)';
                g.beginPath(); g.moveTo(L.x0, y); g.lineTo(L.x0 + L.Tu, y + pitch); g.stroke();
                g.strokeStyle = 'rgba(255,255,255,0.4)';
                g.beginPath(); g.moveTo(L.x0, y + 0.0018); g.lineTo(L.x0 + L.Tu, y + pitch + 0.0018); g.stroke();
            }
            speckle(L.x0, bottom, L.Tu, top - bottom, 4000);
            // (Nothing past the band's edges.)
            g.globalCompositeOperation = 'destination-in';
            g.fillStyle = '#fff';
            g.beginPath();
            for (let x = L.x0; x <= L.x0 + L.Tu + 0.001; x += 0.004) g.lineTo(x, top + (this.kind === 'stump' ? 0.01 : Math.sin(x * 400) * 0.0008));
            for (let x = L.x0 + L.Tu; x >= L.x0 - 0.001; x -= 0.004) g.lineTo(x, bottom + Math.sin(x * 330 + 1) * 0.0008);
            g.closePath();
            g.fill();
            g.globalCompositeOperation = 'source-over';
        }
        this.base = base;
        this._paint();
    }

    // The blood in it, as far as it has spread: what it holds over what a square centimetre takes up is the wet area,
    // round the wound. Darkest in the middle where the gauze is full, a paler fringe where only serum has wicked ahead.
    _paint() {
        const g = this.texture.getContext() as CanvasRenderingContext2D, L = this.layout;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, PX, PX);
        g.drawImage(this.base, 0, 0);
        const r = Math.sqrt(this.held / this.per / Math.PI) / 100;
        const dry = 1 - Math.exp(-this.since / 900);
        this.painted = { r, dry, at: this.npc.vitals.time };
        if (r > 0.002) {
            this._metres(g);
            g.globalCompositeOperation = 'multiply';
            const mix = (a, b) => a.map((x, k) => Math.round(x + (b[k] - x) * dry)).join(',');
            const core = mix([118, 10, 12], [72, 24, 17]), rim = mix([160, 26, 26], [100, 38, 26]), serum = mix([226, 170, 158], [200, 165, 140]);
            const [w0, w1, w2] = this.wobble;
            const edge = (t) => 1 + 0.12 * Math.sin(3 * t + w0) + 0.07 * Math.sin(5 * t + w1) + 0.04 * Math.sin(9 * t + w2);
            if (this.kind === 'stump') {
                // From the top of the end down.
                const top = L.top, low = top - r;
                const grad = g.createLinearGradient(0, top, 0, low - r * 0.15);
                grad.addColorStop(0, `rgb(${core})`); grad.addColorStop(0.75, `rgb(${rim})`); grad.addColorStop(0.9, `rgb(${rim})`); grad.addColorStop(1, `rgb(${serum})`);
                g.fillStyle = grad;
                g.beginPath();
                g.moveTo(L.x0, top + 0.05);
                for (let x = L.x0; x <= L.x0 + L.Tu; x += 0.004) g.lineTo(x, top - r * edge((x - L.x0) / L.Tu * Math.PI * 2) - r * 0.1);
                g.lineTo(L.x0 + L.Tu, top + 0.05);
                g.fill();
            } else {
                // Round the wound, and again a turn either way round a limb, so a stain past the seam comes round.
                for (const shift of this.kind === 'pad' ? [0] : [-L.Tu, 0, L.Tu]) {
                    const grad = g.createRadialGradient(shift, 0, 0, shift, 0, r * 1.25);
                    grad.addColorStop(0, `rgb(${core})`); grad.addColorStop(0.55, `rgb(${core})`); grad.addColorStop(0.75, `rgb(${rim})`);
                    grad.addColorStop(0.86, `rgb(${serum})`); grad.addColorStop(1, 'rgb(255,255,255)');
                    g.fillStyle = grad;
                    g.beginPath();
                    for (let k = 0; k <= 48; k++) {
                        const t = (k / 48) * Math.PI * 2, rr = r * 1.1 * edge(t);
                        g.lineTo(shift + Math.cos(t) * rr, Math.sin(t) * rr);
                    }
                    g.fill();
                }
            }
            // (Only on the gauze.)
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalCompositeOperation = 'destination-in';
            g.drawImage(this.base, 0, 0);
            g.globalCompositeOperation = 'source-over';
        }
        this.texture.update();
    }

    // The clothes over it cut away, and the skin under them shown there.
    _clothes(mark) {
        const npc = this.npc, { header } = bodyOf(npc);
        const under = new Set(header.parts.filter((p) => p.kind === 'skin' && p.under).map((p) => [p.vertexStart, p.vertexStart + p.vertexCount]));
        const covered = [...this.verts].some((v) => v >= 0 && [...under].some(([a, b]) => v >= a && v < b));
        if (!covered) return;
        const center = new V3(0, 0, 0);
        for (let i = 0; i < this.rest.length; i += 3) center.addInPlace(new V3(this.rest[i], this.rest[i + 1], this.rest[i + 2]));
        center.scaleInPlace(3 / this.rest.length);
        let at: BABYLON.Vector3, ey: BABYLON.Vector3, r: number;
        if (this.band) ({ at, axis: ey, r } = this.band);
        else if (this.kind === 'pad') { at = mark.rest; ey = mark.restNormal; r = this.side * 1.55; }
        else {
            // A band of the sleeve or trouser leg the width of the roll: an opening round the limb's line, as wide as the limb.
            const owner = mark.owner, cut = this.kind === 'stump';
            ey = cut ? npc.dismember.cuts.find((c) => c.prox === owner)?.n ?? owner.tail.subtract(owner.head).normalize() : owner.tail.subtract(owner.head).normalize();
            at = center;
            let far = 0;
            for (let i = 0; i < this.rest.length; i += 3) {
                const d = new V3(this.rest[i], this.rest[i + 1], this.rest[i + 2]).subtract(at);
                far = Math.max(far, d.subtract(ey.scale(V3.Dot(d, ey))).length());
            }
            r = far + 0.05;
        }
        const { ex } = frame(ey);
        for (const h of npc.clothHiders) h.add({ at, ex, ey, half: [r, r] });
        for (const h of npc.underHiders) h.window(at, ey, r, this.band ? BAND / 2 + 0.01 : this.kind === 'pad' ? 0.06 : ROLL / 2 + 0.01);
        npc.world.sound?.shot('snip', { at: npc.worldOf(mark.rest, mark.owner).at.asArray(), gain: 0.6 });
    }

    // Blood out of the wound under it this frame (npc._bleed): into the gauze until it is full, then out from under it.
    take(b, ml: number) {
        this.held += ml;
        this.since = 0;
        const over = this.held - this.capacity;
        if (over > 0) {
            this.held = this.capacity;
            const mark = b.source?.mark;
            if (mark) this.npc.runs.start(mark, over, b);
        }
    }

    update(dt: number) {
        if (!this.mesh) return;
        this.since += dt;
        const npc = this.npc;
        this.mesh.visibility = npc.person.mesh.visibility;
        if (npc.dismember.cuts.length > this.seen) this._severed();
        if (!this.mesh) return;
        // New blood shown a few times a second, and the drying slowly.
        const r = Math.sqrt(this.held / this.per / Math.PI) / 100, dry = 1 - Math.exp(-this.since / 900);
        if (npc.vitals.time - this.painted.at > 0.25 && (r - this.painted.r > 0.0007 || Math.abs(dry - this.painted.dry) > 0.04)) this._paint();
        // A new wound under it (shot through it): its blood goes into the gauze too, but nothing presses on it.
        for (const b of npc.vitals.bleeds) {
            if (b.dressing || !b.source?.mark?.rest || !this.covers(b.source.mark.rest)) continue;
            b.dressing = this;
        }
    }

    // A limb cut off since it was put on (dismember.ts). Cut through, it comes away (it is cut through as the limb is).
    // Wholly on the piece, it goes with it; wholly on the body, it stays; either way its corners are carried only by
    // the bones of their side, as the skin's are.
    _severed() {
        const npc = this.npc, bones = npc.person.header.bones;
        const mi = this.mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind) as Float32Array;
        const mw = this.mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind) as Float32Array;
        for (const cut of npc.dismember.cuts.slice(this.seen)) {
            const root = cut.tip.index;
            const gone = (i) => { for (let at = i; at >= 0; at = bones[at].parent) if (at === root) return true; return false; };
            let touched = false, past = 0, before = 0;
            for (let v = 0; v < this.rest.length / 3; v++) {
                if ([0, 1, 2, 3].some((k) => mw[v * 4 + k] > 0 && gone(mi[v * 4 + k]))) touched = true;
                const d = (this.rest[v * 3] - cut.c.x) * cut.n.x + (this.rest[v * 3 + 1] - cut.c.y) * cut.n.y + (this.rest[v * 3 + 2] - cut.c.z) * cut.n.z;
                if (d > 0) past++; else before++;
            }
            if (!touched) continue;
            if (past && before) { this.dispose(); return; }
            const piece = past > 0, to = piece ? root : cut.prox.index;
            for (let v = 0; v < this.rest.length / 3; v++) {
                for (let k = 0; k < 4; k++) if (mw[v * 4 + k] > 0 && gone(mi[v * 4 + k]) !== piece) mi[v * 4 + k] = to;
            }
        }
        this.seen = npc.dismember.cuts.length;
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind, mi);
    }

    dispose() {
        if (!this.mesh) return;
        for (const b of this.npc.vitals.bleeds) if (b.dressing === this) { delete b.dressing; delete b.dressed; }
        const list = this.npc.dressings;
        if (list?.includes(this)) list.splice(list.indexOf(this), 1);
        this.npc.bruise?.unride(this.rider);
        this.mesh.dispose();
        this.material.dispose();
        this.texture.dispose();
        this.mesh = null;
    }
}

// --- the things in the hand and on the wall ------------------------------------------------

// A roll of white gauze, 10 cm wide and 5 across, its loose end hanging; and a medkit, a green pouch with the white
// first-aid cross (ISO 7010 E003) and a strap. Both are made here: x right, y up, z ahead, as held.
export function buildKit(scene) {
    const roll = new BABYLON.TransformNode('kit_bandage', scene);
    const gauze = new BABYLON.DynamicTexture('kit_gauze', { width: 256, height: 256 }, scene, true);
    {
        const g = gauze.getContext() as CanvasRenderingContext2D;
        // Left half: the outside of the roll, its crinkled weave. Right half: an end, the turns showing as rings.
        g.fillStyle = 'rgb(238,237,231)';
        g.fillRect(0, 0, 256, 256);
        for (let x = 0; x < 128; x += 2) { g.fillStyle = x % 4 ? 'rgba(150,145,135,0.2)' : 'rgba(255,255,255,0.4)'; g.fillRect(x, 0, 1, 256); }
        for (let r = 10; r < 62; r += 2.2) {
            g.strokeStyle = `rgba(150,145,135,${0.15 + Math.random() * 0.2})`;
            g.lineWidth = 1;
            g.beginPath(); g.arc(192, 128, r, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = 'rgb(205,200,188)';
        g.beginPath(); g.arc(192, 128, 9, 0, Math.PI * 2); g.fill();
        gauze.update();
    }
    const white = new BABYLON.PBRMaterial('kit_gauze', scene);
    white.albedoTexture = gauze;
    white.metallic = 0;
    white.roughness = 0.95;
    const body = BABYLON.MeshBuilder.CreateCylinder('kit_roll', { diameter: 0.05, height: ROLL, tessellation: 28,
        faceUV: [new BABYLON.Vector4(0.5, 0, 1, 1), new BABYLON.Vector4(0, 0, 0.5, 1), new BABYLON.Vector4(0.5, 0, 1, 1)] }, scene);
    body.rotation.z = Math.PI / 2;
    body.material = white;
    body.parent = roll;
    const tail = BABYLON.MeshBuilder.CreatePlane('kit_tail', { width: ROLL, height: 0.07, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    tail.position.set(0, -0.035, -0.025);
    tail.rotation.x = 0.15;
    tail.material = white;
    tail.parent = roll;

    const kit = new BABYLON.TransformNode('kit_medkit', scene);
    const face = new BABYLON.DynamicTexture('kit_medkit', { width: 512, height: 256 }, scene, true);
    {
        const g = face.getContext() as CanvasRenderingContext2D;
        // Left: the front, nylon with the cross on it. Right: the rest of the pouch, plain.
        for (const x0 of [0, 256]) {
            g.fillStyle = 'rgb(18,104,58)';
            g.fillRect(x0, 0, 256, 256);
            for (let k = 0; k < 2500; k++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'; g.fillRect(x0 + Math.random() * 256, Math.random() * 256, 2, 1); }
            g.strokeStyle = 'rgba(0,0,0,0.45)';
            g.lineWidth = 3;
            g.setLineDash([6, 4]);
            g.strokeRect(x0 + 8, 8, 240, 240);
            g.setLineDash([]);
        }
        g.fillStyle = 'rgb(240,240,236)';
        g.fillRect(128 - 22, 128 - 70, 44, 140);
        g.fillRect(128 - 70, 128 - 22, 140, 44);
        face.update();
    }
    const nylon = new BABYLON.PBRMaterial('kit_medkit', scene);
    nylon.albedoTexture = face;
    nylon.metallic = 0;
    nylon.roughness = 0.75;
    const front = new BABYLON.Vector4(0, 0, 0.5, 1), plain = new BABYLON.Vector4(0.5, 0, 1, 1);
    // (Box faces: back, front, right, left, top, bottom; the one toward the eye is the "back", at -z.)
    const box = BABYLON.MeshBuilder.CreateBox('kit_box', { width: 0.22, height: 0.15, depth: 0.08, faceUV: [front, front, plain, plain, plain, plain] }, scene);
    box.material = nylon;
    box.parent = kit;
    const strap = BABYLON.MeshBuilder.CreateTube('kit_strap', {
        path: Array.from({ length: 9 }, (_, k) => new V3(-0.06 + 0.12 * k / 8, 0.075 + Math.sin(Math.PI * k / 8) * 0.035, 0)), radius: 0.006, tessellation: 8 }, scene);
    const black = new BABYLON.PBRMaterial('kit_strap', scene);
    black.albedoColor = new BABYLON.Color3(0.03, 0.03, 0.03);
    black.metallic = 0;
    black.roughness = 0.8;
    strap.material = black;
    strap.parent = kit;
    return { bandage: roll, medkit: kit };
}
