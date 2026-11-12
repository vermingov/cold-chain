// The town round the cemetery.
//
// St Dymphna's is not in a field: it is a walled yard in a northern town,
// and over its walls are the backs of terraces, a lit window here and there
// where somebody is still up, a church tower to the north-west, and the
// sodium lamps along Vicarage Road. None of it can be walked to; it is there
// to be seen over the wall and through the mist, so the dark has an edge.
//
// The houses, their gable ends and the tower are the forge's building kit
// (tools/forge/models/buildings.py, assets/models/buildings/kit.glb). The
// town does not move, so every piece is put where it stands and all of a
// material is one mesh: the whole town, near rows and far ones, the tower
// and the lit windows, is a couple of dozen draws.

import * as BABYLON from '@babylonjs/core';
import { glb } from '../glb.ts';
import { heightAt } from '../map/plan.ts';
import { makeRng } from '../rng.ts';

const V3 = BABYLON.Vector3;
// Rows of houses: where the row's line runs (x0 z0 to x1 z1), which way it looks (toward the yard), how high its
// houses are, and whether it is the backs of the houses that look that way.
const ROWS = [
    { from: [-64, 156], to: [-8, 156], faces: [0, -1], storeys: 2, backs: true },   // backs of the terraces north of the wall, past their yards
    { from: [10, 160], to: [66, 160], faces: [0, -1], storeys: 2, backs: true },
    { from: [-78, 10], to: [-78, 62], faces: [1, 0], storeys: 2 },           // west, over the lych gate's footpath
    { from: [-80, 76], to: [-80, 140], faces: [1, 0], storeys: 2 },
    { from: [84, 4], to: [84, 70], faces: [-1, 0], storeys: 2 },             // east, past the service track and its field
    { from: [88, 86], to: [88, 146], faces: [-1, 0], storeys: 2 },
    { from: [-80, -16], to: [80, -16], faces: [0, 1], storeys: 3 },          // across Vicarage Road: shops with flats over
];
const HOUSE = 5.4, DEEP = 8;            // a house of the kit, side to side and front to back (tools/forge/models/terrace.py)
const LIT = 0.16;           // of windows that have somebody up behind them
const GAP = 0.06;           // of houses that are gone, leaving the ends of two terraces
const BAYS = 0.4;           // of terraces with bay windows
const TOWER = { at: [-52, 172] };
const LAMPS = [-44, -26, 24, 44];       // x of the sodium lamps along Vicarage Road (the one at the gate is the yard's own)
// The colours the kit's front doors and shop fronts are painted (linear, as the forge's surfaces.py has them); the
// shops' in the order of their signs in the kit's picture of them.
const DOORS = [[0.03, 0.11, 0.065], [0.26, 0.025, 0.025], [0.025, 0.05, 0.14], [0.018, 0.018, 0.02]];
const SHOPS = [[0.03, 0.075, 0.06], [0.16, 0.02, 0.025], [0.015, 0.015, 0.017], [0.02, 0.04, 0.11]];

function glow(scene, name, colour) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = BABYLON.Color3.FromArray(colour);
    m.fogEnabled = true;
    return m;
}

// --- the kit ------------------------------------------------------------------------------------------------------

// A piece of the kit as the game draws it: its parts (one per material) with their vertices in the piece's own
// frame, Babylon's way round, and its lit panes the same. A piece's front looks +z; its ground is y = 0.
export type Piece = { parts: { data: BABYLON.VertexData, material: BABYLON.Material }[], panes: BABYLON.VertexData[] };

export type Kit = { pieces: Map<string, Piece>, material: (name: string) => BABYLON.Material };
const kits = new WeakMap<BABYLON.Scene, Promise<Kit>>();

// The kit's pieces by name and its materials, loaded into `scene` once.
export function kit(scene: BABYLON.Scene, base = ''): Promise<Kit> {
    if (!kits.has(scene)) kits.set(scene, glb(scene, 'buildings/kit', base).then(unpack));
    return kits.get(scene);
}

function unpack(container: BABYLON.AssetContainer): Kit {
    const all = new Map<string, Piece>();
    for (const node of container.rootNodes[0].getChildren()) {
        const piece: Piece = { parts: [], panes: [] };
        // (A piece of one material is itself the mesh; one of more has a mesh for each under it.)
        const meshes = [node, ...(node as BABYLON.TransformNode).getChildMeshes(true)] as BABYLON.Mesh[];
        for (const mesh of meshes.filter((m) => m instanceof BABYLON.Mesh && m.getTotalVertices() > 0)) {
            // (The file's root turns glTF's hand to Babylon's; it is put into the vertices, the winding with it.)
            const world = mesh.computeWorldMatrix(true), data = BABYLON.VertexData.ExtractFromMesh(mesh, true, true).transform(world);
            // A mirror (the root's turn of hand) turns every triangle round: wind them back.
            if (world.determinant() < 0) for (let i = 0; i < data.indices.length; i += 3) [data.indices[i + 1], data.indices[i + 2]] = [data.indices[i + 2], data.indices[i + 1]];
            if (mesh.name.includes('.pane.')) piece.panes.push(data);
            else piece.parts.push({ data, material: mesh.material });
        }
        all.set(node.name, piece);
    }
    for (const material of container.materials) {
        if (!(material instanceof BABYLON.PBRMaterial)) continue;
        material.maxSimultaneousLights = 8;
        material.environmentIntensity = 0;
        material.backFaceCulling = true;
        material.ambientTextureImpactOnAnalyticalLights = 0.7;     // the baked occlusion, under the lamps and the moon
    }
    return { pieces: all, material: (name) => container.materials.find((m) => m.name === name) };
}

// Where a piece stands: at (x, z) on the ground, its front looking `yaw` round from +z.
export function standing(x: number, z: number, yaw: number, y = heightAt(x, z)) {
    return BABYLON.Matrix.Compose(V3.One(), BABYLON.Quaternion.RotationYawPitchRoll(yaw, 0, 0), new V3(x, y, z));
}

// A piece's material to be painted by its vertices' colours (the doors, the shop fronts): white under them.
function paintable(material: BABYLON.Material) {
    const m = material.clone(`${material.name} painted`) as BABYLON.PBRMaterial;
    m.albedoColor = BABYLON.Color3.White();
    return m;
}

// Many copies of the kit's parts of one material, each moved to where its piece stands, as one mesh: the town is
// still, so all of it of a material is one draw.
export class Batch {
    positions: number[] = [];
    normals: number[] = [];
    uvs: number[] = [];
    uvs2: number[] = [];
    colors: number[] = [];
    indices: number[] = [];

    // `data` moved by `at`, its texture coordinates `down` the picture, painted `colour` if it is given.
    add(data: BABYLON.VertexData, at: BABYLON.Matrix, down = 0, colour?: number[]) {
        const base = this.positions.length / 3, p = new V3(), n = new V3();
        for (let i = 0; i < data.positions.length; i += 3) {
            V3.TransformCoordinatesFromFloatsToRef(data.positions[i], data.positions[i + 1], data.positions[i + 2], at, p);
            V3.TransformNormalFromFloatsToRef(data.normals[i], data.normals[i + 1], data.normals[i + 2], at, n);
            this.positions.push(p.x, p.y, p.z);
            this.normals.push(n.x, n.y, n.z);
        }
        for (let i = 0; i < data.uvs.length; i += 2) this.uvs.push(data.uvs[i], data.uvs[i + 1] + down);
        if (data.uvs2) for (const v of data.uvs2) this.uvs2.push(v);
        if (colour) for (let i = 0; i < data.positions.length; i += 3) this.colors.push(colour[0], colour[1], colour[2], 1);
        for (const index of data.indices) this.indices.push(base + index);
    }

    mesh(scene: BABYLON.Scene, name: string, material: BABYLON.Material) {
        const mesh = new BABYLON.Mesh(name, scene);
        Object.assign(new BABYLON.VertexData(), {
            positions: this.positions, normals: this.normals, uvs: this.uvs, uvs2: this.uvs2.length ? this.uvs2 : null,
            colors: this.colors.length ? this.colors : null, indices: this.indices,
        }).applyToMesh(mesh);
        mesh.material = material;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        return mesh;
    }
}

// --- the rows -----------------------------------------------------------------------------------------------------

type Placed = { piece: string, at: BABYLON.Matrix, paint?: number };

// A row of houses along a line, in terraces: here and there a house is gone and the terrace ends there, closed by a
// gable end on each side of the gap. Near rows are the kit's houses (with bays in some terraces, shops on the road);
// far ones are its far boxes.
function terrace(rng, { from: [x0, z0], to: [x1, z1], faces: [fx, fz], storeys, backs = false }, far: boolean): Placed[] {
    const length = Math.hypot(x1 - x0, z1 - z0), along = [(x1 - x0) / length, (z1 - z0) / length];
    // The way the houses' fronts look; with their backs to the yard, the row's line is their back wall.
    const front = backs ? [-fx, -fz] : [fx, fz], set = backs ? DEEP : 0;
    const yaw = Math.atan2(front[0], front[1]);
    const toRight = along[0] * -Math.cos(yaw) + along[1] * Math.sin(yaw) > 0;      // a house's right, from the street
    const kind = far ? `house_${storeys}_far` : storeys === 3 ? 'house_shop' : rng() < BAYS ? 'house_bay' : 'house_plain';
    const end = (side: string) => `gable_${storeys}_${side}${far ? '_far' : ''}`;
    const placed: Placed[] = [];
    let run: Placed[] = [];
    const close = () => {
        if (!run.length) return;
        const [first, last] = toRight ? [run[0], run[run.length - 1]] : [run[run.length - 1], run[0]];
        placed.push(...run, { piece: end('left'), at: first.at }, { piece: end('right'), at: last.at });
        run = [];
    };
    for (let s = 0; s + HOUSE <= length; s += HOUSE) {
        if (rng() < GAP) {
            close();
            continue;
        }
        const x = x0 + along[0] * (s + HOUSE / 2) + front[0] * set, z = z0 + along[1] * (s + HOUSE / 2) + front[1] * set;
        run.push({ piece: kind, at: standing(x, z, yaw), paint: Math.floor(rng() * 4) });
    }
    close();
    return placed;
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

// Every piece where it stands, drawn: the houses' doors and shop fronts in their colours, the shops' signs each on
// its own row of the kit's picture of them, all of a material as one mesh; the lit windows (a share of all of them,
// some lit by a television) as two meshes more, the dark ones left to the kit's glass.
async function raise(scene: BABYLON.Scene, placed: Placed[], rng) {
    const { pieces, material } = await kit(scene);
    const batches = new Map<BABYLON.Material, Batch>(), paints = new Map<string, BABYLON.Material>();
    const batch = (m: BABYLON.Material) => batches.get(m) ?? batches.set(m, new Batch()).get(m);
    // (Every door is one material, and every shop front, whatever its colour: the colour is in the vertices.)
    const painted = (m: BABYLON.Material) => {
        const kind = m.name.startsWith('paint_shop') ? 'shop' : 'door';
        if (!paints.has(kind)) paints.set(kind, paintable(m));
        return paints.get(kind);
    };
    const warm = new Batch(), cold = new Batch();
    // The tower's door looks south, to the yard.
    for (const { piece: name, at, paint } of [...placed, { piece: 'church_tower', at: standing(TOWER.at[0], TOWER.at[1], Math.PI) }]) {
        const piece = pieces.get(name);
        for (const { data, material: m } of piece.parts) {
            // (The signs are a column of four in their picture; the kit's shop has the first.)
            if (m.name === 'shop_sign') batch(m).add(data, at, paint / 4);
            else if (/^paint_(door|shop)/.test(m.name)) batch(painted(m)).add(data, at, 0, (m.name.startsWith('paint_shop') ? SHOPS : DOORS)[paint]);
            else batch(m).add(data, at);
        }
        for (const pane of piece.panes) {
            const roll = rng();
            if (roll < LIT) warm.add(pane, at);
            else if (roll < LIT * 1.25 && curtained(pane)) cold.add(pane, at);
        }
    }
    const lit = material('window_lit');
    return [...[...batches].map(([m, b]) => b.mesh(scene, `town ${m.name}`, m)),
        warm.mesh(scene, 'town windows warm', lit), cold.mesh(scene, 'town windows cold', telly(scene, lit))];
}

// Whether a lit pane shows curtains (a room behind it), not a shop or a hall: the curtained windows are the bottom
// half of the kit's picture of them, which glTF counts from the top.
function curtained(pane: BABYLON.VertexData) {
    return pane.uvs[1] > 0.5;
}

// The same vertices with their texture coordinates moved down the picture by `by`.
function shifted(data: BABYLON.VertexData, by: number) {
    return Object.assign(new BABYLON.VertexData(), {
        positions: data.positions, normals: data.normals, indices: data.indices, uvs: Array.from(data.uvs, (v, i) => (i % 2 ? v + by : v)),
    });
}

// The bluish flicker of a television through curtains: the lit windows' material, its picture turned cold.
function telly(scene, warm: BABYLON.Material) {
    const tex = new BABYLON.DynamicTexture('telly', { width: 32, height: 48 }, scene, true);
    const ctx = tex.getContext(), light = ctx.createRadialGradient(16, 30, 1, 16, 24, 34);
    light.addColorStop(0, '#a8c4ff');
    light.addColorStop(1, '#1c2a4a');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 32, 48);
    ctx.fillStyle = 'rgba(20,10,4,0.35)';
    for (let x = 0; x < 32; x += 5) ctx.fillRect(x, 0, 2, 48);
    tex.update(true);
    // (The panes' coordinates are a quarter of the kit's picture of windows: the picture here covers each.)
    tex.uScale = tex.vScale = 2;
    const m = warm.clone('telly') as BABYLON.PBRMaterial;
    m.emissiveTexture = tex;
    return m;
}

export function buildTown(scene, _surfaces) {
    const rng = makeRng(4417);
    const rows = [...ROWS.map((row) => ({ row, far: false })), ...farRows(rng).map((row) => ({ row, far: true }))];
    const placed = rows.flatMap(({ row, far }) => terrace(rng, row, far));
    const meshes: BABYLON.Mesh[] = [];

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
    // The houses come when the kit has loaded; `meshes` is the town's from then on.
    const ready = raise(scene, placed, rng).then((made) => { meshes.push(...made); });
    return { meshes, ready };
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
