// The town round the cemetery.
//
// St Dymphna's is not in a field: it is a walled yard in a northern town,
// and over its walls are the backs of terraces, a lit window here and there
// where somebody is still up, a church tower to the north-west, and the
// sodium lamps along Vicarage Road. None of it can be walked to; it is there
// to be seen over the wall and through the mist, so the dark has an edge.

import * as BABYLON from '@babylonjs/core';
import { BOUNDS, heightAt } from '../map/plan.ts';
import { Buf } from '../geometry.ts';
import { makeRng } from '../rng.ts';

const V3 = BABYLON.Vector3;
// Rows of houses: where the row's front runs (a line, x0 z0 to x1 z1), which way its windows face (toward the yard),
// how far it stands back, and how high its houses are.
const ROWS = [
    { from: [-64, 156], to: [-8, 156], faces: [0, -1], storeys: 2 },         // backs of the terraces north of the wall, past their yards
    { from: [10, 160], to: [66, 160], faces: [0, -1], storeys: 2 },
    { from: [-78, 10], to: [-78, 62], faces: [1, 0], storeys: 2 },           // west, over the lych gate's footpath
    { from: [-80, 76], to: [-80, 140], faces: [1, 0], storeys: 2 },
    { from: [84, 4], to: [84, 70], faces: [-1, 0], storeys: 2 },             // east, past the service track and its field
    { from: [88, 86], to: [88, 146], faces: [-1, 0], storeys: 2 },
    { from: [-80, -16], to: [80, -16], faces: [0, 1], storeys: 3 },          // across Vicarage Road: shops with flats over
];
const HOUSE = 5.4, STOREY = 2.8, DEEP = 8, ROOF = 2.6;
const LIT = 0.16;           // of windows that have somebody up behind them
const TOWER = { at: [-52, 172], wide: 6, high: 26 };
const LAMPS = [-44, -26, 24, 44];       // x of the sodium lamps along Vicarage Road (the one at the gate is the yard's own)

function painted(scene, name, colour, rough) {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = BABYLON.Color3.FromArray(colour);
    m.metallic = 0;
    m.roughness = rough;
    m.environmentIntensity = 0;
    m.maxSimultaneousLights = 8;
    return m;
}

function glow(scene, name, colour) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = BABYLON.Color3.FromArray(colour);
    m.fogEnabled = true;
    return m;
}

// Curtains with a lamp behind them, as somebody across the way sees them.
function curtained(scene, warm) {
    const tex = new BABYLON.DynamicTexture('window', { width: 32, height: 48 }, scene, true);
    const ctx = tex.getContext(), light = ctx.createRadialGradient(16, 30, 1, 16, 24, 34);
    light.addColorStop(0, warm ? '#ffc278' : '#a8c4ff');
    light.addColorStop(1, warm ? '#5a2c0c' : '#1c2a4a');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 32, 48);
    ctx.fillStyle = 'rgba(20,10,4,0.35)';
    for (let x = 0; x < 32; x += 5) ctx.fillRect(x, 0, 2, 48);
    ctx.fillStyle = '#0c0805';
    ctx.fillRect(15, 0, 2, 48);
    ctx.fillRect(0, 23, 32, 2);
    tex.update(true);
    const m = new BABYLON.StandardMaterial('lit window', scene);
    m.disableLighting = true;
    m.emissiveTexture = tex;
    m.diffuseColor = BABYLON.Color3.Black();
    return m;
}

// A row of houses along a line from `from` to `to`, their windows to `faces`, into the town's buffers (brick, slates)
// and its window panes (dark, warm, cold).
function terrace(scene, rng, town, { from: [x0, z0], to: [x1, z1], faces: [fx, fz], storeys }) {
    const length = Math.hypot(x1 - x0, z1 - z0), along = [(x1 - x0) / length, (z1 - z0) / length], back = [-fx, -fz];
    for (let s = 0; s + HOUSE <= length; s += HOUSE) {
        // No two houses quite alike: some stand forward or back of the line, some are taller, some are gone.
        if (rng() < 0.06) continue;
        const set = (rng() - 0.5) * 1.2;
        const ax = x0 + along[0] * s + fx * set, az = z0 + along[1] * s + fz * set, bx = ax + along[0] * HOUSE, bz = az + along[1] * HOUSE;
        const ground = heightAt((ax + bx) / 2, (az + bz) / 2), high = storeys * STOREY + (rng() - 0.3) * 1.6;
        // The house as a block standing back from its front, and its roof ridge along the row.
        const corners = [[ax, az], [bx, bz], [bx + back[0] * DEEP, bz + back[1] * DEEP], [ax + back[0] * DEEP, az + back[1] * DEEP]];
        const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
        town.brick.box([Math.min(...xs), ground - 0.5, Math.min(...zs)], [Math.max(...xs), ground + high, Math.max(...zs)], 1.2);
        const eave = ground + high, ridge = eave + ROOF;
        const ridgeA = [ax + back[0] * DEEP / 2, az + back[1] * DEEP / 2], ridgeB = [bx + back[0] * DEEP / 2, bz + back[1] * DEEP / 2];
        town.slates.face([[ax, eave, az], [bx, eave, bz], [ridgeB[0], ridge, ridgeB[1]], [ridgeA[0], ridge, ridgeA[1]]], [fx, 1, fz],
            [[0, 0], [HOUSE / 1.5, 0], [HOUSE / 1.5, 2.4], [0, 2.4]]);
        town.slates.face([[corners[3][0], eave, corners[3][1]], [corners[2][0], eave, corners[2][1]], [ridgeB[0], ridge, ridgeB[1]], [ridgeA[0], ridge, ridgeA[1]]],
            [-fx, 1, -fz], [[0, 0], [HOUSE / 1.5, 0], [HOUSE / 1.5, 2.4], [0, 2.4]]);
        // The gable walls up into the roof at each end, so a house taller than its neighbour has a gable, not a hole.
        for (const [p, q, top, toward] of [[[ax, az], corners[3], ridgeA, [-along[0], 0, -along[1]]], [[bx, bz], corners[2], ridgeB, [along[0], 0, along[1]]]]) {
            town.brick.face([[p[0], eave, p[1]], [q[0], eave, q[1]], [top[0], ridge, top[1]]], toward, [[0, 0], [DEEP / 1.2, 0], [DEEP / 2.4, ROOF / 1.2]]);
        }
        // A gutter along the front eave.
        town.trim.bar([ax, eave - 0.05, az].map((c, k) => c + [fx, 0, fz][k] * 0.12), [bx, eave - 0.05, bz].map((c, k) => c + [fx, 0, fz][k] * 0.12), 0.1, 0.1, 1);
        // A chimney stack on the party wall, most of them, with its pots.
        if (rng() < 0.75) {
            const cx = ridgeA[0], cz = ridgeA[1], tall = 0.9 + rng() * 0.8;
            town.brick.box([cx - 0.4, ridge - 0.6, cz - 0.3], [cx + 0.4, ridge + tall, cz + 0.3], 1.2);
            for (const k of [-0.18, 0.18]) town.brick.box([cx + k - 0.08, ridge + tall, cz - 0.08], [cx + k + 0.08, ridge + tall + 0.35, cz + 0.08], 1.2);
        }
        // A window or two on each floor, on the face toward the yard, each in a painted frame on a stone sill; and on the
        // ground floor of a street front, a door between them under its fanlight.
        const onFront = (w, up, out = 0): [number, number, number] => [ax + along[0] * HOUSE * w + fx * out, ground + up, az + along[1] * HOUSE * w + fz * out];
        for (let f = 0; f < storeys; f++) {
            for (const w of [0.24, 0.76]) {
                const pane = BABYLON.MeshBuilder.CreatePlane('house window', { width: 1.0, height: 1.25 }, scene);
                pane.position.set(...onFront(w, f * STOREY + 1.6, 0.03));
                pane.rotation.y = Math.atan2(-fx, -fz);
                const roll = rng();
                (roll < LIT ? town.warm : roll < LIT * 1.25 ? town.cold : town.dark).push(pane);
                const [cx, cy, cz] = onFront(w, f * STOREY + 1.6, 0.05);
                const half = [along[0] * 0.56, along[1] * 0.56];
                town.trim.bar([cx - half[0], cy - 0.66, cz - half[1]], [cx + half[0], cy - 0.66, cz + half[1]], 0.08, 0.1, 1);
                town.trim.bar([cx - half[0], cy + 0.66, cz - half[1]], [cx + half[0], cy + 0.66, cz + half[1]], 0.08, 0.06, 1);
                for (const k of [-1, 1]) town.trim.bar([cx + half[0] * k, cy - 0.66, cz + half[1] * k], [cx + half[0] * k, cy + 0.66, cz + half[1] * k], 0.07, 0.06, 1);
                town.trim.bar([cx, cy - 0.62, cz], [cx, cy + 0.62, cz], 0.04, 0.04, 1);
                town.sills.bar([cx - half[0] * 1.15, cy - 0.74, cz - half[1] * 1.15].map((c, k) => c + [fx, 0, fz][k] * 0.05),
                    [cx + half[0] * 1.15, cy - 0.74, cz + half[1] * 1.15].map((c, k) => c + [fx, 0, fz][k] * 0.05), 0.08, 0.16, 1);
            }
        }
        if (storeys >= 2 && rng() < 0.85) {
            const [dx, dy, dz] = onFront(0.5, 1.0, 0.04), half = [along[0] * 0.45, along[1] * 0.45];
            town.doors.face([[dx - half[0], dy - 1.0, dz - half[1]], [dx + half[0], dy - 1.0, dz + half[1]], [dx + half[0], dy + 1.0, dz + half[1]], [dx - half[0], dy + 1.0, dz - half[1]]],
                [fx, 0, fz], [[0, 0], [1, 0], [1, 2], [0, 2]]);
            town.sills.bar([dx - half[0] * 1.3, ground + 0.06, dz - half[1] * 1.3].map((c, k) => c + [fx, 0, fz][k] * 0.15),
                [dx + half[0] * 1.3, ground + 0.06, dz + half[1] * 1.3].map((c, k) => c + [fx, 0, fz][k] * 0.15), 0.14, 0.32, 1);
        }
    }
}

// The town further off, all the way round: short rows facing every way, at `FAR` metres from the middle of the
// cemetery, so that past the near houses there are more, going on into the mist.
const FAR = { middle: [0, 66], from: 95, to: 175, rows: 46 };
function farRows(rng) {
    const rows = [];
    for (let i = 0; i < FAR.rows; i++) {
        const a = rng() * Math.PI * 2, d = FAR.from + rng() * (FAR.to - FAR.from);
        const cx = FAR.middle[0] + Math.cos(a) * d, cz = FAR.middle[1] + Math.sin(a) * d;
        // Facing the cemetery, squared to the streets (which run north and east like everything else here).
        const square = Math.round(Math.atan2(-Math.sin(a), -Math.cos(a)) / (Math.PI / 2)) * (Math.PI / 2);
        const fx = Math.round(Math.cos(square)), fz = Math.round(Math.sin(square)), half = (3 + Math.floor(rng() * 6)) * HOUSE / 2;
        rows.push({ from: [cx - fz * half, cz + fx * half], to: [cx + fz * half, cz - fx * half], faces: [fx, fz], storeys: 2 + (rng() < 0.2 ? 1 : 0) });
    }
    return rows;
}

export function buildTown(scene, surfaces) {
    const rng = makeRng(4417), town = { brick: new Buf(), slates: new Buf(), trim: new Buf(), sills: new Buf(), doors: new Buf(), dark: [] as BABYLON.Mesh[], warm: [] as BABYLON.Mesh[], cold: [] as BABYLON.Mesh[] };
    for (const row of [...ROWS, ...farRows(rng)]) terrace(scene, rng, town, row);
    const { brick, slates, dark, warm, cold } = town;
    // The church tower over the roofs to the north-west, with its louvres black.
    const [tx, tz] = TOWER.at, tg = heightAt(tx, tz);
    brick.box([tx - TOWER.wide / 2, tg, tz - TOWER.wide / 2], [tx + TOWER.wide / 2, tg + TOWER.high, tz + TOWER.wide / 2], 1.2);
    slates.face([[tx - TOWER.wide / 2, tg + TOWER.high, tz - TOWER.wide / 2], [tx + TOWER.wide / 2, tg + TOWER.high, tz - TOWER.wide / 2], [tx, tg + TOWER.high + 9, tz]], [0, 0.4, -1], [[0, 0], [4, 0], [2, 6]]);
    slates.face([[tx + TOWER.wide / 2, tg + TOWER.high, tz - TOWER.wide / 2], [tx + TOWER.wide / 2, tg + TOWER.high, tz + TOWER.wide / 2], [tx, tg + TOWER.high + 9, tz]], [1, 0.4, 0], [[0, 0], [4, 0], [2, 6]]);
    slates.face([[tx - TOWER.wide / 2, tg + TOWER.high, tz + TOWER.wide / 2], [tx - TOWER.wide / 2, tg + TOWER.high, tz - TOWER.wide / 2], [tx, tg + TOWER.high + 9, tz]], [-1, 0.4, 0], [[0, 0], [4, 0], [2, 6]]);

    const meshes = [
        brick.toMesh('town brick', scene, surfaces.material('brick', { tint: [0.55, 0.5, 0.47] })),
        slates.toMesh('town roofs', scene, surfaces.material('slates')),
        town.trim.toMesh('town paintwork', scene, painted(scene, 'window frames', [0.5, 0.49, 0.45], 0.45)),
        town.sills.toMesh('town sills', scene, surfaces.material('limestone')),
        town.doors.toMesh('town doors', scene, painted(scene, 'front doors', [0.05, 0.09, 0.07], 0.35)),
    ];
    const unlit = glow(scene, 'dark window', [0.006, 0.007, 0.009]), home = curtained(scene, true), telly = curtained(scene, false);
    // Every window of a kind as one mesh: there are a thousand and more of them.
    for (const [panes, material] of [[dark, unlit], [warm, home], [cold, telly]] as [BABYLON.Mesh[], BABYLON.Material][]) {
        if (!panes.length) continue;
        const merged = BABYLON.Mesh.MergeMeshes(panes, true, true);
        merged.material = material;
        meshes.push(merged);
    }

    // Lamps along Vicarage Road: a sodium head on its post, and the pool it throws on the road under it.
    const sodium = glow(scene, 'sodium head', [3.2, 1.6, 0.45]), post = glow(scene, 'lamp post', [0.01, 0.01, 0.01]);
    const pool = poolMaterial(scene);
    for (const x of LAMPS) {
        const z = -2.4, g = heightAt(x, z);
        const pole = BABYLON.MeshBuilder.CreateCylinder('town lamp', { height: 5.5, diameter: 0.12, tessellation: 6 }, scene);
        pole.position.set(x, g + 2.75, z);
        pole.material = post;
        const head = BABYLON.MeshBuilder.CreateSphere('town lamp head', { diameter: 0.28, segments: 6 }, scene);
        head.position.set(x, g + 5.5, z);
        head.material = sodium;
        const lit = BABYLON.MeshBuilder.CreateGround('lamp pool', { width: 11, height: 11 }, scene);
        lit.position.set(x, g + 0.03, z - 1.5);
        lit.material = pool;
        meshes.push(pole, head, lit);
    }
    for (const mesh of meshes) {
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
    }
    return { meshes };
}

// The orange pool of a sodium lamp on wet tarmac, drawn as light laid on the road (added, never darkening it).
function poolMaterial(scene) {
    const tex = new BABYLON.DynamicTexture('lamp pool', { width: 128, height: 128 }, scene, true);
    const ctx = tex.getContext(), pool = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    pool.addColorStop(0, 'rgba(255,150,50,0.55)');
    pool.addColorStop(0.5, 'rgba(160,80,20,0.18)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, 128, 128);
    tex.hasAlpha = true;
    tex.update(true);
    const m = new BABYLON.StandardMaterial('lamp pool', scene);
    m.disableLighting = true;
    m.emissiveTexture = tex;
    m.opacityTexture = tex;
    m.alphaMode = BABYLON.Engine.ALPHA_ADD;
    m.diffuseColor = BABYLON.Color3.Black();
    return m;
}
