// The flat: where a night begins and ends.
//
// One room over a shop on the main road: papered walls going at the seams,
// a carpet that has had people living on it, a bare bulb on a flex. A sash
// window with curtains looks down on the road and the sodium lamp at the
// kerb (street.js). The door is a four-panelled one in its frame, and it
// opens when it is gone through. The answering machine's light is going
// when the player comes in, and the phone rings when the messages are done.
// In the morning it is the same room in a grey light, and what the night
// was worth is on the table.

import * as BABYLON from '@babylonjs/core';
import { Player } from '../player.ts';
import { Models } from '../models.ts';
import { Surfaces, Mottle } from '../surfaces.ts';
import { noiseTexture } from '../noise.ts';
import { Buf } from '../geometry.ts';
import { gradePicture } from '../picture.ts';
import { Solids } from '../solids.ts';
import { Clipboard } from './clipboard.ts';
import { Things } from './things.ts';
import { buildStreet } from './street.ts';
import { lay } from '../bake.ts';
import { place } from '../glb.ts';

const V3 = BABYLON.Vector3;
// The room, from its middle on the floor: across (x), deep (z), high; and how thick its walls are. The door is in
// the south wall, the window in the north one, over the road.
const ROOM = { wide: 4.2, deep: 5, high: 2.55, wall: 0.24 };
const DOOR = { x: 1.45, wide: 0.82, high: 1.98, opens: 1.25, hinge: [0.4085, 0.028] };    // hinge: its line, in from the middle and in from the room
const WINDOW = { x: -0.4, wide: 1.25, sill: 0.82, high: 1.42 };
const TABLE = { at: [1.72, -0.35], size: [0.66, 0.74, 1.0] };     // against the east wall by the door: middle, then size across, high, deep
// What lights it: a bare bulb at night, a grey day in the morning.
const LIGHT = { bulb: 8, day: 0.75 };
const BOX = 0.325;          // how high the cardboard box by the east wall is under the radio's feet (its top sags in the middle)
const BLINK = 1.1;          // seconds the machine's light takes to go on and off
// What the bake lights (tools/forge): the room's own surfaces, and everything else on their materials.
const BAKED = ['walls', 'floor', 'ceiling', 'woodwork', 'window frame', 'table top', 'table legs', 'radiator'];
const SURFACES = ['wallpaper', 'carpet', 'ceiling', 'tabletop', 'pavement', 'terrace', 'tarmac', 'slates', 'limestone'];

function paint(scene, name, colour, rough, mottle = 0.18) {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = BABYLON.Color3.FromArray(colour);
    m.metallic = 0;
    m.roughness = rough;
    m.environmentIntensity = 0;
    m.maxSimultaneousLights = 6;
    if (mottle) new Mottle(m, noiseTexture(scene), mottle, 1.1);
    return m;
}

// The walls, floor and ceiling, with the openings for the door and the window, each surface its own buffer so the
// paper, the carpet and the plaster are laid in metres across the room. The walls are as thick as walls are, so the
// window sits in a reveal.
function shell(materials, scene) {
    const { wide, deep, high, wall: t } = ROOM, w = wide / 2, d = deep / 2;
    const paper = new Buf(), floor = new Buf(), ceiling = new Buf(), gloss = new Buf();
    floor.box([-w, -0.1, -d], [w, 0, d], 2.4, { skip: ['ny'] });
    ceiling.box([-w, high, -d], [w, high + 0.1, d], 2.2, { skip: ['py'] });
    // Each wall, as a slab, inside face only, with the gaps left.
    const slab = (x0, y0, z0, x1, y1, z1, face) => paper.box([x0, y0, z0], [x1, y1, z1], 0.53, { skip: ['px', 'nx', 'py', 'ny', 'pz', 'nz'].filter((f) => f !== face), foot: 0.6, head: 0.75 });
    slab(-w - t, 0, -d, -w, high, d, 'px');
    slab(w, 0, -d, w + t, high, d, 'nx');
    slab(-w, 0, -d - t, DOOR.x - DOOR.wide / 2, high, -d, 'pz');
    slab(DOOR.x + DOOR.wide / 2, 0, -d - t, w, high, -d, 'pz');
    slab(DOOR.x - DOOR.wide / 2, DOOR.high, -d - t, DOOR.x + DOOR.wide / 2, high, -d, 'pz');
    const { x: wx, wide: ww, sill, high: wh } = WINDOW;
    slab(-w, 0, d, wx - ww / 2, high, d + t, 'nz');
    slab(wx + ww / 2, 0, d, w, high, d + t, 'nz');
    slab(wx - ww / 2, 0, d, wx + ww / 2, sill, d + t, 'nz');
    slab(wx - ww / 2, sill + wh, d, wx + ww / 2, high, d + t, 'nz');
    // The reveal round the window, papered too.
    for (const [a, b, toward] of [[[wx - ww / 2, sill + wh], [wx - ww / 2, sill], [1, 0, 0]], [[wx + ww / 2, sill], [wx + ww / 2, sill + wh], [-1, 0, 0]],
        [[wx - ww / 2, sill + wh], [wx + ww / 2, sill + wh], [0, -1, 0]]]) {
        const corners = [[a[0], a[1], d], [b[0], b[1], d], [b[0], b[1], d + t * 0.6], [a[0], a[1], d + t * 0.6]];
        paper.face(corners, toward, corners.map(([cx, cy, cz]) => [(cx + cz) / 0.53, cy / 0.53]), { shade: 0.8 });
    }
    // Skirting, picture rail, the door's architrave and lining, the window board.
    const run = (a, b, h0, h1) => gloss.box(a.map((v, k) => Math.min(v, b[k])).map((v, k) => (k === 1 ? h0 : v)), a.map((v, k) => Math.max(v, b[k])).map((v, k) => (k === 1 ? h1 : v)), 1);
    run([-w, 0, -d], [w, 0, -d + 0.018], 0, 0.16);
    run([-w, 0, d - 0.018], [w, 0, d], 0, 0.16);
    run([-w, 0, -d], [-w + 0.018, 0, d], 0, 0.16);
    run([w - 0.018, 0, -d], [w, 0, d], 0, 0.16);
    for (const [a, b] of [[[-w, 0, -d], [w, 0, -d + 0.02]], [[-w, 0, d - 0.02], [w, 0, d]], [[-w, 0, -d], [-w + 0.02, 0, d]], [[w - 0.02, 0, -d], [w, 0, d]]]) run(a, b, 2.1, 2.14);
    const dx0 = DOOR.x - DOOR.wide / 2, dx1 = DOOR.x + DOOR.wide / 2;
    gloss.box([dx0 - 0.07, 0, -d - 0.01], [dx0, DOOR.high + 0.07, -d + 0.016], 1);
    gloss.box([dx1, 0, -d - 0.01], [dx1 + 0.07, DOOR.high + 0.07, -d + 0.016], 1);
    gloss.box([dx0 - 0.07, DOOR.high, -d - 0.01], [dx1 + 0.07, DOOR.high + 0.07, -d + 0.016], 1);
    gloss.box([dx0 - 0.01, 0, -d - t], [dx0, DOOR.high, -d], 1);
    gloss.box([dx1, 0, -d - t], [dx1 + 0.01, DOOR.high, -d], 1);
    gloss.box([wx - ww / 2 - 0.05, sill - 0.03, d - 0.05], [wx + ww / 2 + 0.05, sill, d + t * 0.6], 1);
    return [paper.toMesh('walls', scene, materials.paper), floor.toMesh('floor', scene, materials.carpet), ceiling.toMesh('ceiling', scene, materials.ceiling),
        gloss.toMesh('woodwork', scene, materials.gloss)];
}

// The sash window: its box frame, the two sashes with their glazing bars, the glass, and the curtains half drawn.
function sashWindow(scene, materials) {
    const { x, wide: w, sill, high: h } = WINDOW, z = ROOM.deep / 2 + ROOM.wall * 0.6, frame = new Buf();
    const bar = (x0, y0, x1, y1, z0, z1) => frame.box([x0, y0, z0], [x1, y1, z1], 1);
    bar(x - w / 2, sill, x - w / 2 + 0.06, sill + h, z - 0.06, z);
    bar(x + w / 2 - 0.06, sill, x + w / 2, sill + h, z - 0.06, z);
    bar(x - w / 2, sill + h - 0.06, x + w / 2, sill + h, z - 0.06, z);
    bar(x - w / 2, sill, x + w / 2, sill + 0.06, z - 0.06, z);
    // The two sashes overlap at the meeting rail; each has one bar down its middle.
    const meet = sill + h / 2;
    bar(x - w / 2 + 0.06, meet - 0.035, x + w / 2 - 0.06, meet + 0.035, z - 0.05, z - 0.01);
    for (const [y0, y1, zz] of [[sill + 0.06, meet, z - 0.035], [meet, sill + h - 0.06, z - 0.015]]) {
        bar(x - 0.015, y0, x + 0.015, y1, zz - 0.015, zz + 0.01);
        bar(x - w / 2 + 0.06, y0, x - w / 2 + 0.1, y1, zz - 0.02, zz + 0.01);
        bar(x + w / 2 - 0.1, y0, x + w / 2 - 0.06, y1, zz - 0.02, zz + 0.01);
    }
    const glass = BABYLON.MeshBuilder.CreatePlane('glass', { width: w - 0.12, height: h - 0.12 }, scene);
    glass.position.set(x, sill + h / 2, z - 0.02);
    glass.rotation.y = Math.PI;
    glass.material = materials.glass;
    // Curtains on a rail above the window, gathered in folds, drawn most of the way back to either side.
    const rail = BABYLON.MeshBuilder.CreateCylinder('curtain rail', { diameter: 0.025, height: w + 0.6, tessellation: 10 }, scene);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(x, sill + h + 0.18, ROOM.deep / 2 - 0.08);
    rail.material = materials.brass;
    const curtains = [-1, 1].map((side) => curtain(scene, materials.curtain, x + side * (w / 2 + 0.02), side, sill + h + 0.17, sill - 0.25));
    return [frame.toMesh('window frame', scene, materials.gloss), glass, rail, ...curtains];
}

// One curtain hanging from `top` to `bottom`, its inner edge at x, gathered out to the side `side` (-1 or 1):
// a sheet folded in soft pleats, deeper at the rail than at the hem.
function curtain(scene, material, x, side, top, bottom) {
    const across = 18, down = 10, wide = 0.42, z = ROOM.deep / 2 - 0.1;
    const positions = [], indices = [], uvs = [];
    for (let j = 0; j <= down; j++) {
        const y = top + (bottom - top) * (j / down), loose = j / down;
        for (let i = 0; i <= across; i++) {
            const s = i / across;
            positions.push(x + side * s * wide * (1 - 0.15 * loose), y, z - Math.sin(s * Math.PI * 7) * 0.035 * (1.2 - 0.4 * loose));
            uvs.push(s * 2, loose * 4);
        }
    }
    for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) {
        const a = j * (across + 1) + i, b = a + 1, c = a + across + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    const mesh = new BABYLON.Mesh('curtain', scene), data = new BABYLON.VertexData(), normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    Object.assign(data, { positions, indices, normals, uvs });
    data.applyToMesh(mesh);
    mesh.material = material;
    return mesh;
}

// The door in its opening, hinged on its west edge: the forged one (tools/forge/models/flat.py), its leaf with the
// knobs and the hinges on it. Its frame stays out: the room's woodwork is the frame, baked with the room. The model
// hangs on its left as seen from the room and this door on its right, so it is mirrored. Returns its hinge, to swing
// it open.
async function door(scene) {
    const { root, parts } = await place(scene, 'props/door');
    parts.get('door_frame').dispose();
    const hinge = new BABYLON.TransformNode('door hinge', scene);
    hinge.position.set(DOOR.x - DOOR.hinge[0], 0, -ROOM.deep / 2 - DOOR.hinge[1]);
    const fit = new BABYLON.TransformNode('door model', scene);
    fit.parent = hinge;
    fit.position.set(DOOR.hinge[0], 0, DOOR.hinge[1]);
    fit.scaling.x = -1;
    root.parent = fit;
    return { hinge, meshes: root.getChildMeshes() };
}

// The kitchen table, a worn top on square legs.
function table(scene, materials) {
    const [x, z] = TABLE.at, [w, h, d] = TABLE.size, top = new Buf(), legs = new Buf();
    top.box([x - w / 2, h - 0.03, z - d / 2], [x + w / 2, h, z + d / 2], 0.8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = x + sx * (w / 2 - 0.05), lz = z + sz * (d / 2 - 0.05);
        legs.box([lx - 0.022, 0, lz - 0.022], [lx + 0.022, h - 0.03, lz + 0.022], 0.8, { foot: 0.6 });
    }
    legs.box([x - w / 2 + 0.04, h - 0.11, z - d / 2 + 0.04], [x + w / 2 - 0.04, h - 0.03, z + d / 2 - 0.04], 0.8, { skip: ['py'] });
    return [top.toMesh('table top', scene, materials.tabletop), legs.toMesh('table legs', scene, materials.tabletop)];
}

// The answering machine and the phone beside it, on the table, forged (tools/forge/models/flat.py), both facing west
// toward whoever sits there. Returns the light that blinks and where each is.
async function phoneAndMachine(scene) {
    const [x, z] = TABLE.at, top = TABLE.size[1];
    const [phone, machine] = await Promise.all([stand(scene, 'props/phone', [x - 0.04, top, z - 0.18], -Math.PI / 2),
        stand(scene, 'props/answering_machine', [x - 0.03, top, z + 0.16], -Math.PI / 2)]);
    return {
        lamp: machine.parts.get('lamp'), meshes: [...phone.root.getChildMeshes(), ...machine.root.getChildMeshes()],
        machineAt: new V3(x - 0.03, top + 0.03, z + 0.16), phoneAt: new V3(x - 0.02, top + 0.06, z - 0.18), handset: phone.parts.get('handset'),
    };
}

// A forged model standing at `at`, its front turned to `yaw` (0: +z).
async function stand(scene, path, at, yaw) {
    const model = await place(scene, path), fit = new BABYLON.TransformNode(path, scene);
    fit.position.set(at[0], at[1], at[2]);
    fit.rotation.y = yaw;
    model.root.parent = fit;
    return model;
}

// Letters on the table, face up: what came in the post.
function letters(scene, material) {
    const [x, z] = TABLE.at, top = TABLE.size[1];
    // Long way across the table, in the gaps either side of the phone and the machine.
    return [[0.0, -0.405, Math.PI / 2 + 0.03], [0.02, 0.385, Math.PI / 2 - 0.03]].map(([dx, dz, turn], i) => {
        const sheet = BABYLON.MeshBuilder.CreatePlane('letter' + i, { width: 0.21, height: 0.297 }, scene);
        sheet.rotation.set(Math.PI / 2, turn, 0);
        sheet.position.set(x + dx - 0.08, top + 0.002 + i * 0.001, z + dz);
        sheet.material = material;
        return sheet;
    });
}

// A radiator under the window: a panel of upright channels on two brackets.
function radiator(scene, material) {
    const buf = new Buf(), { x, wide } = WINDOW, z = ROOM.deep / 2 - 0.06;
    for (let cx = x - wide / 2 + 0.08; cx < x + wide / 2 - 0.08; cx += 0.045) buf.box([cx, 0.16, z - 0.035], [cx + 0.035, 0.72, z], 1);
    buf.box([x - wide / 2 + 0.06, 0.66, z - 0.04], [x + wide / 2 - 0.06, 0.7, z], 1);
    buf.box([x - wide / 2 + 0.06, 0.18, z - 0.04], [x + wide / 2 - 0.06, 0.22, z], 1);
    return buf.toMesh('radiator', scene, material);
}

// Build the flat, for the start of a night or for the morning after one.
export async function openFlat(engine, canvas, { screen, noises, morning = false }) {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = morning ? new BABYLON.Color4(0.16, 0.17, 0.18, 1) : new BABYLON.Color4(0.012, 0.009, 0.007, 1);
    // The road's air: sodium haze at night, a wet grey in the morning.
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.035;
    scene.fogColor = morning ? new BABYLON.Color3(0.16, 0.17, 0.18) : new BABYLON.Color3(0.035, 0.02, 0.01);
    const w = ROOM.wide / 2, d = ROOM.deep / 2;

    const surfaces = new Surfaces(scene, 'assets/surfaces/');
    await surfaces.load(SURFACES);
    const glass = new BABYLON.PBRMaterial('glass', scene);
    glass.albedoColor = new BABYLON.Color3(0.02, 0.025, 0.025);
    glass.metallic = 0;
    glass.roughness = 0.05;
    glass.alpha = 0.18;
    glass.environmentIntensity = 0;
    glass.backFaceCulling = false;
    const materials = {
        paper: surfaces.material('wallpaper', { tint: [0.82, 0.78, 0.66] }),
        carpet: surfaces.material('carpet', { tint: [0.62, 0.5, 0.42] }),
        ceiling: surfaces.material('ceiling', { tint: [0.78, 0.74, 0.64] }),
        tabletop: surfaces.material('tabletop'),
        gloss: paint(scene, 'gloss', [0.26, 0.245, 0.2], 0.5),
        brass: paint(scene, 'brass', [0.42, 0.32, 0.14], 0.35, 0),
        letter: paint(scene, 'letter', [0.74, 0.73, 0.68], 0.85, 0.05),
        curtain: paint(scene, 'curtain', [0.32, 0.17, 0.08], 0.9, 0.25),
        glass,
    };
    materials.curtain.backFaceCulling = false;
    materials.curtain.twoSidedLighting = true;
    const devices = { ...(await phoneAndMachine(scene)), blinking: true };
    const entrance = await door(scene);
    // The radio on the box by the east wall, facing into the room.
    const radio = await stand(scene, 'props/radio', [w - 0.3, BOX, 1.4], -Math.PI / 2);
    const meshes = [...shell(materials, scene), ...sashWindow(scene, materials), ...table(scene, materials), ...letters(scene, materials.letter),
        ...devices.meshes, ...entrance.meshes, ...radio.root.getChildMeshes(), radiator(scene, materials.gloss)];

    const models = new Models(scene, { cast() {}, uncast() {} }, 'assets/props/');
    const FURNISHED: [string, number[], number][] = [
        ['sofa_02', [-w + 0.45, 0, 0.2], Math.PI / 2],
        ['cardboard_box_01', [w - 0.35, 0, 1.4], Math.PI / 2],
        ['dining_chair_02', [TABLE.at[0] - 0.55, 0, TABLE.at[1] + 0.1], Math.PI / 2 + 0.25],
        ['drawer_cabinet', [-w + 0.6, 0, d - 0.3], Math.PI],
        ['vintage_electric_kettle', [-w + 0.4, 0.84, d - 0.3], 2.6],
        ['pull_chain_light_socket', [0, ROOM.high - 0.17, 0.2], 0],
        ['wall_clock', [w - 0.03, 1.72, -1.2], -Math.PI / 2],
    ];
    await models.prepare([...new Set(FURNISHED.map((f) => f[0]))]);
    for (const [name, [x, y, z], yaw] of FURNISHED) models.place(name, { position: new V3(x, y, z), yaw, shadows: false });
    const street = await buildStreet(scene, { front: d + ROOM.wall, surfaces, models, morning });

    // The bulb on its flex, the street lamp in at the window, the day in the morning.
    const bulbAt = new V3(0, ROOM.high - 0.34, 0.2);
    const bulb = new BABYLON.PointLight('bulb', bulbAt, scene);
    bulb.diffuse = new BABYLON.Color3(1, 0.76, 0.46);
    bulb.intensity = morning ? 0 : LIGHT.bulb;
    bulb.range = 10;
    bulb.shadowMinZ = 0.05;
    bulb.shadowMaxZ = 8;
    const glow = BABYLON.MeshBuilder.CreateSphere('bulb', { diameter: 0.065, segments: 10 }, scene);
    glow.position.copyFrom(bulbAt);
    const bulbGlass = new BABYLON.StandardMaterial('bulb glass', scene);
    glow.material = bulbGlass;
    bulbGlass.disableLighting = true;
    bulbGlass.emissiveColor = morning ? new BABYLON.Color3(0.3, 0.29, 0.26) : new BABYLON.Color3(3, 2.4, 1.6);
    const day = new BABYLON.HemisphericLight('day', new V3(0.1, 0.3, 1), scene);
    day.diffuse = morning ? new BABYLON.Color3(0.6, 0.65, 0.72) : new BABYLON.Color3(0.8, 0.5, 0.25);
    day.groundColor = new BABYLON.Color3(0.18, 0.15, 0.12);
    day.intensity = morning ? LIGHT.day : 0.06;
    const shadows = new BABYLON.ShadowGenerator(1024, morning ? street.light : bulb);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.002;
    for (const mesh of [...meshes, ...models.placed.map((p) => p.mesh)]) {
        shadows.addShadowCaster(mesh);
        mesh.receiveShadows = true;
    }
    // The street lamp comes in at the window and nowhere else: the walls stand in its way. Nothing out there moves,
    // so its shadows are drawn once.
    // On what the bake does not light (the furniture, the forged things), a map this coarse a room's width from the
    // lamp draws the sash's thin bars as a scatter of blocks and every edge as steps: the bars are left out of it, and
    // what is in it is drawn soft.
    const sill = new BABYLON.ShadowGenerator(1024, street.light);
    sill.useCloseExponentialShadowMap = true;
    sill.depthScale = 60;
    sill.bias = 0.004;
    sill.getShadowMap().refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    for (const mesh of meshes) if (mesh.name !== 'window frame') sill.addShadowCaster(mesh);

    const solids = new Solids();
    solids.box(-w - 1, -d - 1, -w, d + 1);
    solids.box(w, -d - 1, w + 1, d + 1);
    solids.box(-w - 1, d, w + 1, d + 1);
    solids.box(-w - 1, -d - 1, w + 1, -d);
    solids.box(TABLE.at[0] - TABLE.size[0] / 2, TABLE.at[1] - TABLE.size[2] / 2, TABLE.at[0] + TABLE.size[0] / 2, TABLE.at[1] + TABLE.size[2] / 2);
    solids.box(-w, -0.7, -w + 0.9, 1.1);                    // the sofa
    solids.box(w - 0.6, 1.1, w, 1.7);                       // the box and the radio on it
    solids.box(-w, d - 0.55, -w + 1.2, d);                  // the cabinet
    const player = new Player(scene, canvas, {
        ground: () => 0, solids, limits: { x0: -w, z0: -d, x1: w, z1: d }, underfoot: () => 'carpet',
    });
    player.spawn(DOOR.x - 0.3, -d + 0.55, { toward: [TABLE.at[0], 0.8, TABLE.at[1]] });
    player.onStep = (surface, weight) => noises?.step(surface, weight);
    const camera = player.camera;
    camera.minZ = 0.03;
    camera.maxZ = 80;
    gradePicture(scene, camera, { exposure: morning ? 1.3 : 1.6 });
    const clipboard = new Clipboard(scene, camera, { bright: 0.85 });
    const things = new Things(camera, screen);

    // Light baked in Blender, if it has been (tools/forge/bake.sh flat): the lamps then give these surfaces only
    // their shine, and the bake gives them the rest, bounced light and soft shadow and all.
    const baked = scene.meshes.filter((mesh) => BAKED.includes(mesh.name)), lamps = [bulb, street.light, day];
    await lay(scene, baked, lamps, `assets/baked/flat-${morning ? 'morning' : 'night'}`);

    let clock = 0, opening = null;
    return {
        scene, player, clipboard, things, devices, bake: { meshes: baked, lights: lamps }, room: 'flat',
        door: new V3(DOOR.x, 1.1, -d),
        sofa: new V3(-w + 0.45, 0.45, 0.2),
        // Swing the door open, over `seconds`.
        open(seconds = 0.9) {
            return new Promise((done) => { opening = { t: 0, seconds, done }; });
        },
        update(dt) {
            clock += dt;
            noises?.drive('room', 1);
            player.update(dt);
            things.update();
            clipboard.update(dt);
            devices.lamp.setEnabled(devices.blinking && clock % BLINK < BLINK / 2);
            if (opening) {
                opening.t = Math.min(1, opening.t + dt / opening.seconds);
                entrance.hinge.rotation.y = -DOOR.opens * (1 - (1 - opening.t) ** 2);
                if (opening.t >= 1) { opening.done(); opening = null; }
            }
        },
        dispose() {
            things.dispose();
            player.dispose();
            scene.dispose();
        },
    };
}
