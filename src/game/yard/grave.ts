// A grave being opened.
//
// The turf is cut back and the ground is gone from a rectangle the size of
// the coffin and a little more (the ground and the grass leave it out:
// yard/ground.ts's HOLE). In its place is a pit with clay sides, as deep as
// it has been dug, the spoil heaped beside it. A council grave is shallow:
// the lid is a metre down. Under the lid, in what he was buried in, is
// whoever is in it.
//
// It is dug a spadeful at a time and the lid is broken with the bar. The
// yard says when; this only does it.

import * as BABYLON from '@babylonjs/core';
import { Buf } from '../../geometry.ts';
import { heightAt } from '../../map/plan.ts';
import { HOLE } from '../../yard/ground.ts';
import * as P from '../../poses.ts';
import { place } from '../../glb.ts';
import { fill } from './bier.ts';
import { field } from '../../noise.ts';
import { makeRng } from '../../rng.ts';

const V3 = BABYLON.Vector3;
// The hole, from the middle of the plot: west to east (the head is west, under the marker) and either side.
const CUT = { west: -0.87, east: 1.09, half: 0.43 };      // room for the coffin's end handles past the rough of the clay
const COFFIN = { long: 1.84, wide: 0.56, deep: 0.34, lid: 0.025 };
const LID = 1.0;                // metres down to the top of the lid
const SPADEFULS = 18;           // to get down to it (a real one is hours; this is the part worth playing)
const HEAP = { most: [2.0, 0.9, 1.05], off: 1.05 };     // the spoil, all out: long, high (half of it shows) and wide; and how far north of the middle it is thrown
const PLATE = { wide: 0.16, high: 0.05, on: 0.0025 };      // `on`: over the lid's top, on the brass of the forged plate
const WALL = { step: 0.15, rough: 0.07 };     // the pit's sides: metres between their points, and how far in or out a point may be

export class Grave {
    declare scene: any;
    declare plot: any;
    declare burial: any;
    declare flatten: any;
    declare surface: number;
    declare dug: number;
    declare open: boolean;
    declare soil: any;
    declare pit: BABYLON.Mesh;
    declare rough: (x: any, y: any) => number;
    declare heap: BABYLON.Mesh;
    declare coffin: BABYLON.Mesh;
    declare lid: BABYLON.Mesh;
    declare plate: BABYLON.Mesh;
    declare coffinTop: number;
    declare body: any;
    declare halves: BABYLON.TransformNode[];
    declare spares: BABYLON.TransformNode[];
    declare model: BABYLON.TransformNode;

    // `plot` is the plan's, `burial` story.ts's, `surfaces` has soil. `people` has the body's person loaded.
    constructor(scene, plot, burial, { surfaces, people, flatten }) {
        this.scene = scene;
        this.plot = plot;
        this.burial = burial;
        this.flatten = flatten;
        this.surface = heightAt(plot.x, plot.z);
        this.dug = 0;                   // spadefuls out
        this.open = false;              // the lid broken
        this.soil = surfaces.material('soil', { mottle: 0.3 });
        this.pit = null;

        this.rough = field(makeRng(Math.round(plot.x * 97 + plot.z * 31)), 8);
        const heap = spoil(scene, this.soil, Math.round(plot.x * 13 + plot.z * 7));
        heap.position.set(plot.x + 0.1, this.surface - 0.05, plot.z + HEAP.off);
        heap.scaling.setAll(0);
        heap.receiveShadows = true;
        this.heap = heap;

        // The coffin, its lid and the plate on the lid, at the bottom of where the hole will go.
        const top = this.surface - LID, x = plot.x + (CUT.west + CUT.east) / 2, z = plot.z;
        // The forged coffin (tools/forge/models/yard.py), head to the west. Its body and lid are here at once, for the
        // shadows; what they look like comes when the model has loaded, and with it two more lids, split, for when the
        // bar has been at it. The name is the game's own plate, laid on the forged one.
        this.coffin = new BABYLON.Mesh('coffin', scene);
        this.lid = new BABYLON.Mesh('lid', scene);
        this.plate = plate(scene, burial.plate, new V3(x - 0.45, top + PLATE.on, z));
        this.plate.setEnabled(false);
        this.coffinTop = top;
        this.model = new BABYLON.TransformNode('coffin model', scene);
        this.model.position.set(x, top - COFFIN.deep, z);
        this.model.rotation.y = -Math.PI / 2;
        this._dress(scene);
        for (const mesh of [this.coffin, this.lid]) mesh.setEnabled(false);

        // Him, on his back, head to the west, hands at his sides, in what the council buried him in.
        const body = people.make(burial.body, { dressed: true, dead: true, bald: true, name: 'buried' });
        body.blinks = false;
        body.blink = 1;
        body.root.position.set(x - 0.02, top - COFFIN.deep + 0.03, z);
        body.root.rotation.y = Math.PI / 2;
        body.apply({ ...P.RELAXED, _pitch: -90, jaw: 4, shoulderAbductL: -32, shoulderAbductR: -32, elbowL: 4, elbowR: 4, curlL: 30, curlR: 30,
            ankleL: -25, ankleR: -25 }, { ground: 'skin' });
        body.setEnabled(false);
        this.body = body;
    }

    get depth() { return (this.dug / SPADEFULS) * LID; }

    get down() { return this.dug >= SPADEFULS; }

    // The hole on the plan, [x0, z0, x1, z1]: once it is cut, nobody walks over it.
    get hole() {
        const { x, z } = this.plot;
        return [x + CUT.west, z - CUT.half, x + CUT.east, z + CUT.half];
    }

    // Where things about the grave are, for the hand: the middle of the hole at the ground, the lid's plate, his belly, his hands.
    get middle() { return new V3(this.plot.x + 0.1, this.surface, this.plot.z); }

    at(what) {
        const x = this.plot.x + (CUT.west + CUT.east) / 2, z = this.plot.z, y = this.coffinTop;
        const places = { plate: [x - 0.45, y, z], belly: [x + 0.1, y - 0.1, z], hands: [x + 0.05, y - 0.15, z - 0.2], lid: [x, y, z] };
        return V3.FromArray(places[what]);
    }

    // The nearest place to `from` ({ x, z }) that a spade would go in at, at the bottom of the hole as it is; or, `lid`,
    // where a bar goes under the lid's edge.
    reach(from, lid = false) {
        const { x, z } = this.plot, inset = lid ? 0 : 0.22;
        const middle = x + (CUT.west + CUT.east) / 2, half = lid ? [COFFIN.long / 2, COFFIN.wide / 2] : [(CUT.east - CUT.west) / 2 - inset, CUT.half - inset];
        const px = Math.max(middle - half[0], Math.min(middle + half[0], from.x)), pz = Math.max(z - half[1], Math.min(z + half[1], from.z));
        return new V3(px, lid ? this.coffinTop : this.surface - this.depth, pz);
    }

    // One spadeful out. The first takes the turf off and opens the ground.
    spadeful() {
        if (this.down) return;
        if (!this.dug) this._cut();
        this.dug++;
        const out = this.dug / SPADEFULS;
        this.heap.scaling.set(HEAP.most[0] * Math.sqrt(out), HEAP.most[1] * out, HEAP.most[2] * Math.sqrt(out));
        if (this.down) {
            this.coffin.setEnabled(true);
            this.lid.setEnabled(true);
            this.body.setEnabled(true);
        }
        this._sides();
    }

    // The bar under the lid's edge: it splits along its length and the halves are put up on the spoil.
    breakLid() {
        this.open = true;
        this.lid.setEnabled(false);
        if (!this.spares) return;
        const halves = this.spares;
        halves.forEach((half, i) => {
            this._rest(half, this.plot.x + 0.1 + i * 0.12, this.plot.z + HEAP.off - 0.15 + i * 0.3, 0.08 * i, 0.25 - i * 0.4);
            half.setEnabled(true);
        });
        this.plate.parent = halves[0];
        this.plate.position.set(-0.45, COFFIN.lid / 2 + 0.001, 0);
        this.plate.rotationQuaternion = null;
        this.plate.rotation.set(Math.PI / 2, 0, 0);
        this.plate.scaling.setAll(1);
        this.plate.setEnabled(true);
        this.halves = halves;
    }

    // Lay a lid half (its middle at its origin, its length along its x) on the spoil and the ground about (x, z), turned
    // `yaw` and rolled `roll`: lying on what is highest under it, tipped along its length to rest on two points of it.
    _rest(half, x, z, yaw, roll) {
        this.heap.computeWorldMatrix(true);
        const along = new V3(Math.cos(yaw), 0, -Math.sin(yaw)), across = new V3(Math.sin(yaw), 0, Math.cos(yaw));
        const reach = COFFIN.long / 2, side = COFFIN.wide / 4 * Math.cos(roll) + 0.02, under = COFFIN.lid / 2;
        const ts = Array.from({ length: 25 }, (_, k) => -reach + (2 * reach * k) / 24);
        const heights = ts.map((t) => Math.max(...[-side, 0, side].map((w) => {
            const at = new V3(x, 0, z).addInPlace(along.scale(t)).addInPlace(across.scale(w));
            const hit = new BABYLON.Ray(new V3(at.x, this.surface + 3, at.z), new V3(0, -1, 0), 6).intersectsMesh(this.heap, false);
            return Math.max(heightAt(at.x, at.z), hit.hit ? hit.pickedPoint.y : -Infinity);
        })) + under + Math.abs(Math.sin(roll)) * side);
        // The lowest line over all of them through the middle: level on the highest, or through a point either side.
        let best = { mid: Math.max(...heights), slope: 0 };
        for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
            if (ts[i] > 0 || ts[j] < 0) continue;
            const slope = (heights[j] - heights[i]) / (ts[j] - ts[i]), mid = heights[i] - slope * ts[i];
            if (mid < best.mid && ts.every((t, k) => mid + slope * t >= heights[k] - 1e-4)) best = { mid, slope };
        }
        half.position.set(x, best.mid, z);
        half.rotation.set(roll, yaw, Math.atan(best.slope));
    }

    // The forged coffin into the stand-ins, the plate onto its lid, and the split lid made ready.
    async _dress(scene) {
        const [whole, ...split] = await Promise.all([0, 1, 2].map(() => place(scene, 'props/coffin')));
        whole.root.parent = this.model;
        fill(this.coffin, whole.parts.get('coffin') as BABYLON.Mesh);
        fill(this.lid, whole.parts.get('coffin_lid') as BABYLON.Mesh);
        if (!this.open) {
            this.plate.setParent(this.lid);
            this.plate.setEnabled(true);
        }
        // Each half: a lid as wide as half of one, its middle where the half is put.
        this.spares = split.map(({ root, parts }) => {
            const half = new BABYLON.TransformNode('lid half', scene), fit = new BABYLON.TransformNode('lid half model', scene);
            fit.parent = half;
            fit.rotation.y = -Math.PI / 2;
            fit.scaling.x = 0.5;
            fit.position.y = -(COFFIN.deep - COFFIN.lid / 2);
            root.parent = fit;
            parts.get('coffin').dispose();
            parts.get('plate').setEnabled(false);
            for (const mesh of root.getChildMeshes()) mesh.receiveShadows = true;
            half.setEnabled(false);
            return half;
        });
        if (this.open) {
            this.open = false;
            this.breakLid();
        }
    }

    // Lifted out: the body is the bier's now.
    emptied() { this.body.setEnabled(false); }

    _cut() {
        HOLE.splice(0, 4, ...this.hole);
        this.flatten(this.plot.id);
    }

    // The clay sides, from the ground at the edge down to how far it is dug, and the bottom.
    _sides() {
        if (this.pit) this.pit.dispose();
        const { x, z } = this.plot, buf = new Buf();
        const x0 = x + CUT.west, x1 = x + CUT.east, z0 = z - CUT.half, z1 = z + CUT.half;
        const bottom = this.down ? this.coffinTop - COFFIN.deep - 0.04 : this.surface - this.depth;
        const middle = [x + 0.1, bottom, z];
        // Each side, walked in short lengths so its top follows the lie of the ground, and down in short drops; every
        // point but those at the top and the corners pushed in or out a little, as a spade leaves clay.
        [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]].forEach(([a, b], side) => {
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(length / WALL.step);
            const inward = [middle[0] - (a[0] + b[0]) / 2, middle[2] - (a[1] + b[1]) / 2], d = Math.hypot(...inward);
            const n = inward.map((c) => c / d);
            const top = (t) => heightAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) + 0.015;
            const drops = Math.max(1, Math.ceil((top(0.5) - bottom) / WALL.step));
            const point = (i, k) => {
                const t = i / steps, s = k / drops, y = top(t) + (bottom - top(t)) * s;
                const push = WALL.rough * (this.rough(side * 0.25 + t * 0.25, s * 0.3 + 0.1) - 0.5) * Math.sin(Math.PI * t) * Math.min(1, s * 3);
                return [a[0] + (b[0] - a[0]) * t + n[0] * push, y, a[1] + (b[1] - a[1]) * t + n[1] * push];
            };
            for (let i = 0; i < steps; i++) for (let k = 0; k < drops; k++) {
                const corners = [point(i, k), point(i + 1, k), point(i + 1, k + 1), point(i, k + 1)];
                buf.face(corners, [n[0], 0, n[1]], corners.map(([cx, cy, cz]) => [(cx + cz) / 1.3, cy / 1.3]),
                    { shade: [1 - 0.5 * k / drops, 1 - 0.5 * k / drops, 1 - 0.5 * (k + 1) / drops, 1 - 0.5 * (k + 1) / drops] });
            }
        });
        buf.face([[x0, bottom, z0], [x1, bottom, z0], [x1, bottom, z1], [x0, bottom, z1]], [0, 1, 0],
            [[x0 / 1.3, z0 / 1.3], [x1 / 1.3, z0 / 1.3], [x1 / 1.3, z1 / 1.3], [x0 / 1.3, z1 / 1.3]], { shade: 0.5 });
        this.pit = buf.toMesh('pit', this.scene, this.soil);
    }

    dispose() {
        HOLE.splice(0, 4, 1e6, 1e6, 1e6, 1e6);
        for (const node of [this.pit, this.heap, this.coffin, this.lid, this.plate, this.model, ...(this.spares || [])]) node?.dispose();
        this.body.dispose();
    }
}

// The spoil: clay thrown up in a heap, lumpy and ragged at its foot, a metre across before it is scaled (as a ball a
// metre through would be), from a little under the ground to half a metre up at the most.
function spoil(scene, material, seed) {
    const rng = makeRng(seed), lumps = field(rng, 5), clods = field(rng, 19);
    const buf = new Buf(), rings = 9, around = 30;
    const at = (i, j) => {
        const r = i / rings, a = (j / around) * Math.PI * 2, u = 0.5 + Math.cos(a) * r * 0.45, v = 0.5 + Math.sin(a) * r * 0.45;
        const edge = 0.5 * (0.8 + 0.35 * lumps(u, v));
        const y = i === rings ? -0.12 : 0.5 * Math.cos(r * Math.PI / 2) ** 0.7 * (0.7 + 0.6 * lumps(v, u)) + 0.05 * (clods(u, v) - 0.5) * r;
        return [Math.cos(a) * r * edge, y, Math.sin(a) * r * edge];
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
        const corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const out = [0, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0));
        buf.face(i ? corners : corners.slice(1), [out[0], 0.6, out[1]], (i ? corners : corners.slice(1)).map(([x, , z]) => [x / 0.7, z / 0.7]),
            { shade: 1 - 0.4 * (i / rings) ** 2 });
    }
    return buf.toMesh('spoil', scene, material);
}

// A brass plate with a name on it, lying on the lid.
function plate(scene, words, at) {
    const tex = new BABYLON.DynamicTexture('plate', { width: 512, height: 160 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#6d5a32';
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = '#2a2112';
    ctx.font = '44px Fell';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(words || '', 256, 82);
    tex.update(true);
    const m = new BABYLON.PBRMaterial('plate', scene);
    m.albedoTexture = tex;
    // (Brass with nothing round it to reflect is black: it is lit as a dull thing instead.)
    m.metallic = 0;
    m.roughness = 0.4;
    m.environmentIntensity = 0;
    const mesh = BABYLON.MeshBuilder.CreatePlane('plate', { width: PLATE.wide, height: PLATE.high }, scene);
    // Face up, read from the south side of the grave.
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copyFrom(at);
    mesh.material = m;
    return mesh;
}
