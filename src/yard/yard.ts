// The yard: St Dymphna's, at night, put together.
//
// The plan (map/plan.js) says where everything is. This fetches what the
// place is made of, builds the ground, the stones, the trees and the
// buildings from it, stands the furniture about, and lights what is lit: the
// street lamp at the gate, the sexton's window, the lamp over the cold
// room's door.

import * as BABYLON from '@babylonjs/core';
import { BOUNDS, BUILDINGS, GATES, heightAt, plots, trees, underfoot } from '../map/plan.ts';
import { Solids } from '../solids.ts';
import { register } from '../map/register.ts';
import { buildGround } from './ground.ts';
import { buildGrass } from './grass.ts';
import { buildStones } from './stones.ts';
import { buildTrees, trunkOf } from './trees.ts';
import { buildBuilt } from './built.ts';
import { buildTown } from './town.ts';
import { Mist } from './mist.ts';
import { buildTokens } from './tokens.ts';

const V3 = BABYLON.Vector3;

const SURFACES = ['grass', 'rough', 'leaves', 'gravel', 'mud', 'tarmac', 'soil', 'wall', 'ashlar', 'brick', 'slates', 'flags',
    'sandstone', 'limestone', 'granite', 'lichen', 'iron', 'bark', 'oakbark', 'post', 'coffin'];

// What stands about the place: model, where (x, z), which way it faces.
const FURNITURE: [string, [number, number], number][] = [
    ['street_lamp_01', [5.4, -2.3], Math.PI],
    ['covered_car', [-17, -4.4], Math.PI / 2],
    ['painted_wooden_bench', [-2.5, 24], Math.PI / 2],
    ['painted_wooden_bench', [2.5, 47], -Math.PI / 2],
    ['metal_trash_can', [4.2, 60.5], 0.4],
    ['gothic_statue', [-27, 25.5], Math.PI / 2],
    ['concrete_cat_statue', [21.6, 20.4], 2.1],
    ['tree_stump_01', [33, 14], 1.0],
    ['tree_stump_01', [-38, 60], 2.6],
    ['wooden_bucket_01', [-4.5, 87.2], 0.3],
    ['watering_can_metal_01', [-4.4, 88.3], 1.9],
    ['shrub_02', [-52, 20], 0.3],
    ['shrub_02', [51, 70], 2.2],
    ['shrub_02', [-30, 129], 1.4],
];

function glass(scene) {
    const m = new BABYLON.PBRMaterial('pane', scene);
    m.albedoColor = new BABYLON.Color3(0.004, 0.005, 0.006);
    m.metallic = 0;
    m.roughness = 0.07;
    m.environmentIntensity = 0;
    return m;
}

// The window with somebody home behind it: curtains, drawn, with a lamp on
// the far side of them.
function litWindow(scene, { centre, size, normal }) {
    const W = 128, H = 128;
    const tex = new BABYLON.DynamicTexture('litWindow', { width: W, height: H }, scene, true);
    const ctx = tex.getContext();
    const glow = ctx.createRadialGradient(W * 0.6, H * 0.62, 4, W * 0.5, H * 0.5, W * 0.75);
    glow.addColorStop(0, '#ffd08a');
    glow.addColorStop(0.5, '#c98a44');
    glow.addColorStop(1, '#5a3414');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // The folds of the curtain, and the bars of the window in front of them.
    for (let x = 0; x < W; x += 9) {
        ctx.fillStyle = `rgba(40,20,5,${0.12 + 0.16 * Math.abs(Math.sin(x * 0.7))})`;
        ctx.fillRect(x, 0, 4, H);
    }
    ctx.fillStyle = '#120a04';
    ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, H - 5, W, 5); ctx.fillRect(0, 0, 5, H); ctx.fillRect(W - 5, 0, 5, H);
    ctx.fillRect(W / 2 - 3, 0, 6, H); ctx.fillRect(0, H / 2 - 3, W, 6);
    tex.update(true);

    const m = new BABYLON.StandardMaterial('litWindow', scene);
    m.emissiveTexture = tex;
    m.diffuseColor = BABYLON.Color3.Black();
    m.specularColor = BABYLON.Color3.Black();
    m.disableLighting = true;
    const pane = BABYLON.MeshBuilder.CreatePlane('litWindow', { width: size[0], height: size[1] }, scene);
    pane.material = m;
    pane.position = V3.FromArray(centre);
    pane.rotation.y = Math.atan2(-normal[0], -normal[2]);
    pane.isPickable = false;

    // What it throws on the path outside.
    const light = new BABYLON.SpotLight('window', pane.position.add(V3.FromArray(normal).scale(0.1)),
        V3.FromArray(normal).add(new V3(0, -0.35, 0)).normalize(), 2.2, 1.5, scene);
    light.falloffType = BABYLON.Light.FALLOFF_GLTF;
    light.diffuse = new BABYLON.Color3(1.0, 0.72, 0.4);
    light.specular = light.diffuse;
    light.intensity = 6;
    light.range = 12;
    return { pane, light };
}

// A lamp that points down: where it is, its colour, how strong, how far.
function downLight(scene, name, at, colour, intensity, range, angle = 2.3) {
    const light = new BABYLON.SpotLight(name, V3.FromArray(at), new V3(0, -1, 0), angle, 1.2, scene);
    light.falloffType = BABYLON.Light.FALLOFF_GLTF;
    light.diffuse = BABYLON.Color3.FromArray(colour);
    light.specular = light.diffuse;
    light.intensity = intensity;
    light.range = range;
    return light;
}

// A small thing that glows, at a lamp.
function bulb(scene, name, at, colour, size) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.emissiveColor = BABYLON.Color3.FromArray(colour);
    m.disableLighting = true;
    const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: size, segments: 8 }, scene);
    mesh.material = m;
    mesh.position = V3.FromArray(at);
    mesh.isPickable = false;
    return mesh;
}

// How far it is from `from`, looking along `along` (a unit), to the first
// thing a torch held there would light: a stone, a building, the ground.
// Nothing beyond `limit` is looked for. It is rough and meant to be: it is
// for knowing whether the player is peering at something close.
function reach(heads, from, along, limit = 12) {
    let nearest = limit;
    for (let t = 0.4; t < nearest; t += 0.4) {
        if (from.y + along.y * t < heightAt(from.x + along.x * t, from.z + along.z * t)) nearest = t;
    }
    for (const [x, y, z] of heads) {
        const dx = x - from.x, dy = y - from.y, dz = z - from.z;
        const t = dx * along.x + dy * along.y + dz * along.z;
        if (t > 0.2 && t < nearest && dx * dx + dy * dy + dz * dz - t * t < 0.18) nearest = t;
    }
    for (const b of BUILDINGS) {
        // The stretch of the ray that is over the building's rectangle on the plan.
        let enter = 0, leave = nearest;
        for (const [p, d, mid, half] of [[from.x, along.x, b.at[0], b.size[0] / 2], [from.z, along.z, b.at[1], b.size[1] / 2]]) {
            const a = (mid - half - p) / (d || 1e-9), c = (mid + half - p) / (d || 1e-9);
            enter = Math.max(enter, Math.min(a, c));
            leave = Math.min(leave, Math.max(a, c));
        }
        if (enter < leave) nearest = enter;
    }
    return nearest;
}

// Everything in the yard that stops a walker: the wall and what shuts its
// gates, the buildings, the trees, the stones, the furniture. `heads` is
// the stones' (stones.js) and `models` knows how big the furniture is.
function obstacles(heads, models) {
    const solids = new Solids();
    const { x0, x1, z0, z1 } = BOUNDS, thick = 0.25;
    // Each side of the wall: where it runs from and to, and how to lay a length of it.
    const sides: Record<string, [number, number, (a: number, b: number) => void]> = {
        south: [x0, x1, (a, b) => solids.box(a, z0 - thick, b, z0 + thick)],
        north: [x0, x1, (a, b) => solids.box(a, z1 - thick, b, z1 + thick)],
        west: [z0, z1, (a, b) => solids.box(x0 - thick, a, x0 + thick, b)],
        east: [z0, z1, (a, b) => solids.box(x1 - thick, a, x1 + thick, b)],
    };
    for (const [name, [from, to, lay]] of Object.entries(sides)) {
        let at = from;
        for (const gate of GATES.filter((g) => g.wall === name).sort((a, b) => a.at - b.at)) {
            lay(at, gate.at - gate.width / 2);
            at = gate.at + gate.width / 2;
            // The lych gate is shut and the service gate chained. The main
            // gate has one leaf shut and the other standing open into the yard.
            if (gate.id === 'main') {
                solids.box(gate.at - gate.width / 2, z0 - 0.1, gate.at, z0 + 0.1);
                solids.box(gate.at + gate.width / 2 - 0.65, z0, gate.at + gate.width / 2 - 0.1, z0 + gate.width / 2);
            } else lay(gate.at - gate.width / 2, gate.at + gate.width / 2);
        }
        lay(at, to);
    }
    for (const b of BUILDINGS) {
        // The chapel's buttresses stand out from its long sides.
        const out = b.id === 'chapel' ? [0.55, 0.15] : [0.08, 0.08];
        solids.box(b.at[0] - b.size[0] / 2 - out[0], b.at[1] - b.size[1] / 2 - out[1], b.at[0] + b.size[0] / 2 + out[0], b.at[1] + b.size[1] / 2 + out[1]);
    }
    for (const tree of trees()) solids.round(tree.x, tree.z, trunkOf(tree) * 0.9);
    for (const [x, , z, girth] of heads) if (girth) solids.round(x, z, girth);
    for (const [name, [x, z], yaw] of FURNITURE) {
        const [wide, tall, deep] = models.info(name).size;
        if (tall < 0.5) continue;       // stepped over
        const cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw));
        const halfX = (cos * wide + sin * deep) / 2, halfZ = (sin * wide + cos * deep) / 2;
        solids.box(x - halfX, z - halfZ, x + halfX, z + halfZ);
    }
    return solids;
}

// As far as anybody can walk: the yard, and the road in front of it.
const LIMITS = { x0: BOUNDS.x0 - 12, z0: -9.3, x1: BOUNDS.x1 + 12, z1: BOUNDS.z1 + 4 };

// Build it all. `surfaces` and `models` are the game's loaders; `night`
// takes whatever should throw a shadow in the moonlight; `fonts` is where
// the typefaces the stones are lettered in are kept. `buried` is anybody put
// in the ground since the register was written (story.ts's burials): their
// plots are taken, with a fresh mound and a marker, and the register says
// who is in them.
export async function buildYard(scene, { surfaces, models, night, fonts, buried = [] }) {
    await Promise.all([surfaces.load(SURFACES), models.prepare([...new Set([...FURNITURE.map((f) => f[0]), 'large_iron_gate'])])]);

    const { mesh: ground, mask } = buildGround(scene, surfaces);
    const grass = buildGrass(scene, mask);
    const fresh = new Set(buried.map((b) => b.plot));
    const people = register();
    for (const b of buried) people.set(b.plot, b);
    const laid = plots().map((p) => (fresh.has(p.id) ? { ...p, taken: true, fresh: true } : p));
    const { meshes: stones, heads, flatten: unmound } = await buildStones(scene, surfaces, laid, people, fonts);
    const wood = buildTrees(scene, surfaces, trees());
    const { meshes: built, places } = buildBuilt(scene, surfaces, glass(scene));
    night.cast([...stones, ...wood, ...built]);
    const town = buildTown(scene, surfaces);
    const tokens = buildTokens(scene, laid);
    // A grave dug into loses its mound and whatever was left on it.
    const flatten = (plot) => { unmound(plot); tokens.clear(plot); };
    const mist = new Mist(scene, night.camera);

    for (const [name, [x, z], yaw] of FURNITURE) {
        models.place(name, { position: new V3(x, heightAt(x, z), z), yaw });
    }
    // The main gate: one leaf shut, one left standing open.
    const gate = GATES.find((g) => g.id === 'main');
    const leaf = gate.width / 2 / models.info('large_iron_gate').size[0];
    models.place('large_iron_gate', { position: new V3(gate.at - gate.width / 4, heightAt(0, 0), BOUNDS.z0), scale: leaf });
    models.place('large_iron_gate', {
        position: new V3(gate.at + gate.width / 2 - 0.35, heightAt(0, 0), BOUNDS.z0 + gate.width / 4 - 0.1), yaw: Math.PI / 2 - 0.25, scale: leaf,
    });
    // The service gate in the east wall: both leaves shut, chained.
    const service = GATES.find((g) => g.id === 'service');
    const serviceLeaf = service.width / 2 / models.info('large_iron_gate').size[0];
    for (const side of [-1, 1]) {
        const z = service.at + side * service.width / 4;
        models.place('large_iron_gate', { position: new V3(BOUNDS.x1, heightAt(BOUNDS.x1, z), z), yaw: Math.PI / 2, scale: serviceLeaf });
    }

    const sodium = [1.0, 0.55, 0.16], tungsten = [1.0, 0.8, 0.55];
    const lampHead = [5.4, heightAt(5.4, -2.3) + 3.42, -2.3];
    const lights = {
        street: downLight(scene, 'street', lampHead, sodium, 80, 26, 2.5),
        coldDoor: downLight(scene, 'coldDoor', places.chapel.lamp, tungsten, 9, 9),
        window: litWindow(scene, places.lodge.window).light,
    };
    bulb(scene, 'streetBulb', lampHead, sodium.map((c) => c * 3), 0.2);
    bulb(scene, 'coldDoorBulb', places.chapel.lamp, tungsten.map((c) => c * 2.5), 0.09);

    return {
        ground, grass, stones, trees: wood, built, places, lights, flatten, town, mist, tokens,
        reach: (from, along) => reach(heads, from, along),
        // What a player needs of the place (player.js).
        footing: { ground: heightAt, solids: obstacles(heads, models), limits: LIMITS, underfoot },
    };
}
