// What was built: the wall round the place, its gates, the chapel of rest,
// the sexton's lodge, the store.
//
// All of it from the plan. The wall, its piers and gates, the lych gate and
// the store are built here in scanned stone, brick and slate, into one
// buffer per material; the chapel of rest and the lodge are the forge's
// models (the building kit), with real openings, doors and windows. These
// are the outsides only: what is inside the chapel is its own scene, and
// from the yard a window is dark glass and a door is shut.

import * as BABYLON from '@babylonjs/core';
import { Buf } from '../geometry.ts';
import { BOUNDS, BUILDINGS, GATES, heightAt } from '../map/plan.ts';
import { Batch, kit, standing } from './town.ts';

const WALL = { height: 2.15, thick: 0.46, run: 4 };
const PIER = { size: 0.78, height: 3.0 };

// A buffer for each material used, made as it is first asked for.
class Yard {
    declare bufs: Map<any, any>;

    constructor() { this.bufs = new Map(); }
    of(surface) {
        if (!this.bufs.has(surface)) this.bufs.set(surface, new Buf());
        return this.bufs.get(surface);
    }
}

// Metres to a repeat: each scan's own size, or near it.
const TILE = { wall: 2.0, ashlar: 2.0, slates: 1.5, flags: 3.0, post: 2.0, limestone: 1.5, iron: 1.0 };
// How a surface is asked for, where it is not wanted as it came: cast iron
// is painted black under its rust.
const LOOKS = { iron: { tint: [0.3, 0.27, 0.26] } };

// --- the wall ----------------------------------------------------------------

// The four sides as runs between corners: where each starts, which way it
// goes, how long it is.
function sides() {
    const { x0, x1, z0, z1 } = BOUNDS;
    return {
        south: { from: [x0, z0], dir: [1, 0], length: x1 - x0, origin: x0 },
        north: { from: [x0, z1], dir: [1, 0], length: x1 - x0, origin: x0 },
        west: { from: [x0, z0], dir: [0, 1], length: z1 - z0, origin: z0 },
        east: { from: [x1, z0], dir: [0, 1], length: z1 - z0, origin: z0 },
    };
}

function pier(yard, x, z) {
    const h = heightAt(x, z), s = PIER.size / 2;
    yard.of('ashlar').box([x - s, h - 0.4, z - s], [x + s, h + PIER.height, z + s], TILE.ashlar, { foot: 0.6 });
    yard.of('limestone').box([x - s - 0.07, h + PIER.height, z - s - 0.07], [x + s + 0.07, h + PIER.height + 0.16, z + s + 0.07], TILE.limestone);
}

function boundary(yard) {
    for (const [name, side] of Object.entries(sides())) {
        const gates = GATES.filter((g) => g.wall === name).sort((a, b) => a.at - b.at);
        const gaps = gates.map((g) => [g.at - side.origin - g.width / 2, g.at - side.origin + g.width / 2]);
        const at = (t): [number, number] => [side.from[0] + side.dir[0] * t, side.from[1] + side.dir[1] * t];
        let from = 0;
        for (const [g0, g1] of [...gaps, [side.length, side.length]]) {
            // In short lengths, each stepped to the ground under it, the way
            // a wall goes over a slope.
            for (let t = from; t < g0 - 0.01; t += WALL.run) {
                const end = Math.min(g0, t + WALL.run);
                const [ax, az] = at(t), [bx, bz] = at(end);
                const ground = [heightAt(ax, az), heightAt(bx, bz)];
                const top = Math.max(...ground) + WALL.height, half = WALL.thick / 2;
                const min = [Math.min(ax, bx) - (side.dir[1] ? half : 0), Math.min(...ground) - 0.5, Math.min(az, bz) - (side.dir[0] ? half : 0)];
                const max = [Math.max(ax, bx) + (side.dir[1] ? half : 0), top, Math.max(az, bz) + (side.dir[0] ? half : 0)];
                yard.of('wall').box(min, max, TILE.wall, { foot: 0.55 });
                yard.of('flags').box([min[0] - 0.05, top, min[2] - 0.05], [max[0] + 0.05, top + 0.09, max[2] + 0.05], TILE.flags);
            }
            if (g0 < side.length) for (const t of [g0, g1]) pier(yard, ...at(t));
            from = g1;
        }
        gates.forEach((gate, i) => { if (gate.kind === 'chain') chain(yard, at(gaps[i][0]), at(gaps[i][1])); });
    }
}

// A chain hung across a gateway from pier to pier, padlocked in the middle.
function chain(yard, [ax, az], [bx, bz]) {
    const links = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        links.push([x, heightAt(x, z) + 1.0 - 0.32 * 4 * t * (1 - t), z]);
    }
    yard.of('iron').tube(links, 0.022, TILE.iron, { sides: 5 });
    const [mx, my, mz] = links[5];
    yard.of('iron').box([mx - 0.035, my - 0.11, mz - 0.035], [mx + 0.035, my - 0.01, mz + 0.035], TILE.iron);
}

// --- roofs and what trims them -------------------------------------------------

// A pitched roof over a rectangle, its ridge along `axis` ('x' or 'z'), with
// the two gable ends closed in `gable` material up to the slates. The slates
// overhang the walls by `eave` and the gables by `verge`. Returns the roof
// in its own terms, for whatever is fixed to it afterwards: `point(across,
// along, y)` is so far from the ridge line, so far along it, at a height.
function pitched(yard, [cx, cz], [w, d], eaves, rise, axis, gable, { eave = 0.3, verge = 0.3 } = {}) {
    const alongZ = axis === 'z';
    const half = (alongZ ? w : d) / 2, long = (alongZ ? d : w) / 2;
    const point = (across, along, y) => (alongZ ? [cx + across, y, cz + along] : [cx + along, y, cz + across]);
    const pitch = rise / half, slope = Math.hypot(half + eave, (half + eave) * pitch), reach = long + verge;
    const t = TILE.slates, gt = TILE[gable];
    const faces = (s) => (alongZ ? [s * rise, half, 0] : [0, half, s * rise]);
    for (const s of [1, -1]) {
        const edge = s * (half + eave), low = eaves - eave * pitch;
        yard.of('slates').face(
            [point(edge, -reach, low), point(edge, reach, low), point(0, reach, eaves + rise), point(0, -reach, eaves + rise)],
            faces(s), [[0, 0], [2 * reach / t, 0], [2 * reach / t, slope / t], [0, slope / t]]);
        const end = [point(-half, s * long, eaves), point(half, s * long, eaves), point(0, s * long, eaves + rise)];
        yard.of(gable).face(end, alongZ ? [0, 0, s] : [s, 0, 0], end.map((q) => [(alongZ ? q[0] : q[2]) / gt, q[1] / gt]));
    }
    return { point, half, long, pitch, eaves, rise, eave, verge, faces };
}

// A length of `surface` up each slope at each end of a roof: the coping on
// a gable wall that stands above the slates, or the bargeboard under slates
// that sail past it. `out` is how far beyond the gable wall its middle runs
// (less than nothing for a coping, which sits on the wall), `lift` how far
// off the slates.
function verges(yard, roof, surface, { out, wide, deep, lift }) {
    const buf = yard.of(surface);
    for (const s of [1, -1]) {
        for (const end of [1, -1]) {
            const along = end * (roof.long + out), foot = roof.half + roof.eave;
            buf.bar(roof.point(s * foot, along, roof.eaves - roof.eave * roof.pitch + lift), roof.point(0, along, roof.eaves + roof.rise + lift),
                wide, deep, TILE[surface], { up: roof.faces(s) });
        }
    }
}

// --- the chapel of rest and the lodge ------------------------------------------------

// The chapel and the lodge are the forge's (tools/forge/models/churchyard.py, in the building kit), each standing on
// its footprint with its sides to the compass. Until the kit has loaded each is an empty mesh, which is what the
// yard is given to cast shadows with; then the model's walls and roof are put into it, and its small parts are
// drawn beside it.
const PIECES = { chapel: 'chapel_of_rest', lodge: 'sextons_lodge' };

// Where the yard's lights go on the chapel: the cold room's door on the east wall, 4.5 m north of the middle, with
// the lamp on its bracket over it (as the kit's chapel has them).
function chapelPlaces(b) {
    const [cx, cz] = b.at, ground = heightAt(cx, cz), x1 = cx + b.size[0] / 2, dz = cz + 4.5;
    return { coldDoor: [x1 + 0.6, ground, dz], lamp: [x1 + 0.3, ground + 2.5, dz] };
}

// The lodge's window with the light in it: the one south of the door on the avenue. Its glass is where the kit's
// sash window has it, 0.19 m back in the wall, and the size of what is between the sashes' frames.
function lodgePlaces(b) {
    const [cx, cz] = b.at, ground = heightAt(cx, cz), x1 = cx + b.size[0] / 2;
    return { window: { centre: [x1 - 0.19, ground + 1.5, cz - 1.9], size: [1.02, 1.06], normal: [1, 0, 0] } };
}

// The parts of the kit's buildings that throw the shadows: their walls and roofs. The rest (glass, frames, doors,
// iron, pots) is small, and is drawn without.
const SHELL = ['ashlar', 'brick', 'stone', 'slate'];

function standIn(scene, name) {
    const mesh = new BABYLON.Mesh(name, scene);
    mesh.isPickable = true;
    return mesh;
}

// The kit's chapel and lodge put where they stand: each one's shell into its stand-in, its parts one after another,
// one sub-mesh each; the small parts of both, all of a material as one mesh, into `meshes`.
async function raise(scene, standing: [BABYLON.Mesh, string, BABYLON.Matrix][], meshes: BABYLON.Mesh[]) {
    const { pieces } = await kit(scene);
    const small = new Map<BABYLON.Material, Batch>();
    for (const [mesh, piece, at] of standing) {
        const shell = new BABYLON.MultiMaterial(piece, scene), parts: Batch[] = [];
        for (const { data, material } of pieces.get(piece).parts) {
            if (!SHELL.includes(material.name)) {
                if (!small.has(material)) small.set(material, new Batch());
                small.get(material).add(data, at);
                continue;
            }
            const part = new Batch();
            part.add(data, at);
            parts.push(part);
            shell.subMaterials.push(material);
        }
        const whole = new Batch(), ranges = [];
        for (const part of parts) {
            const start = whole.positions.length / 3, first = whole.indices.length;
            whole.positions.push(...part.positions);
            whole.normals.push(...part.normals);
            whole.uvs.push(...part.uvs);
            whole.uvs2.push(...part.uvs2);
            whole.indices.push(...part.indices.map((i) => i + start));
            ranges.push([start, part.positions.length / 3, first, part.indices.length]);
        }
        Object.assign(new BABYLON.VertexData(), whole).applyToMesh(mesh);
        mesh.material = shell;
        mesh.subMeshes = [];
        ranges.forEach(([start, count, first, length], i) => new BABYLON.SubMesh(i, start, count, first, length, mesh));
        mesh.refreshBoundingInfo();
    }
    for (const [material, batch] of small) meshes.push(batch.mesh(scene, `built ${material.name}`, material));
}

function store(yard, b) {
    const [cx, cz] = b.at, [w, d] = b.size;
    const ground = heightAt(cx, cz);
    yard.of('post').box([cx - w / 2, ground - 0.2, cz - d / 2], [cx + w / 2, ground + b.height, cz + d / 2], TILE.post, { skip: ['ny'], foot: 0.5 });
    yard.of('slates').box([cx - w / 2 - 0.2, ground + b.height, cz - d / 2 - 0.2], [cx + w / 2 + 0.2, ground + b.height + 0.07, cz + d / 2 + 0.2], TILE.slates);
}

// The lych gate: four oak posts and a roof over the footpath.
function lychGate(yard, gate) {
    const x = BOUNDS.x0, z = gate.at, ground = heightAt(x, z);
    for (const [dx, dz] of [[-0.9, -0.95], [-0.9, 0.95], [0.9, -0.95], [0.9, 0.95]]) {
        yard.of('post').box([x + dx - 0.09, ground - 0.3, z + dz - 0.09], [x + dx + 0.09, ground + 2.3, z + dz + 0.09], TILE.post, { foot: 0.5 });
    }
    const roof = pitched(yard, [x, z], [2.6, 2.5], ground + 2.3, 1.1, 'x', 'post', { eave: 0.25, verge: 0.25 });
    verges(yard, roof, 'post', { out: 0.23, wide: 0.05, deep: 0.16, lift: -0.09 });

    // The gate under it, shut: two rails, the pales between them, a brace.
    const oak = yard.of('post'), t = TILE.post, half = gate.width / 2 - 0.04;
    const on = (along, y) => [x, ground + y, z + along];
    for (const y of [0.28, 1.08]) oak.bar(on(-half, y), on(half, y), 0.05, 0.09, t);
    for (let along = -half + 0.06; along <= half - 0.05; along += 0.19) oak.bar(on(along, 0.2), on(along, 1.2), 0.07, 0.025, t, { up: [1, 0, 0] });
    oak.bar(on(-half, 0.3), on(half, 1.05), 0.05, 0.07, t);
}

// Everything built, as meshes: the procedural ones, and the chapel and the lodge (filled when the kit has loaded,
// `ready`). `_glass` was for their windows, which the kit brings. Returns the meshes and the places the yard's
// lights and doors need to know.
export function buildBuilt(scene, surfaces, _glass) {
    const yard = new Yard();
    boundary(yard);
    const places: Record<string, any> = {}, meshes = [], kitted: [BABYLON.Mesh, string, BABYLON.Matrix][] = [];
    for (const b of BUILDINGS) {
        if (b.id in PIECES) {
            places[b.id] = b.id === 'chapel' ? chapelPlaces(b) : lodgePlaces(b);
            const mesh = standIn(scene, 'built_' + b.id);
            kitted.push([mesh, PIECES[b.id], standing(b.at[0], b.at[1], Math.PI)]);
            meshes.push(mesh);
        } else store(yard, b);
    }
    lychGate(yard, GATES.find((g) => g.kind === 'lych'));

    for (const [surface, buf] of yard.bufs) {
        const mesh = buf.toMesh('built_' + surface, scene, surfaces.material(surface, LOOKS[surface]));
        mesh.isPickable = true;
        meshes.push(mesh);
    }
    return { meshes, places, ready: raise(scene, kitted, meshes) };
}
