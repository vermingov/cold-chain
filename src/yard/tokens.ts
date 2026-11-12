// What people leave on graves.
//
// The recent ground is looked after, some of it: a grave candle burning in
// red glass, flowers in a pot gone brown with the frost, a wreath on a mound
// nobody has had time to put a stone on. The old ground has none of it. The
// candles are the only lights in the yard nobody switched on, and they
// flicker, each on its own.

import * as BABYLON from '@babylonjs/core';
import { GRAVE, heightAt } from '../map/plan.ts';
import { Buf } from '../geometry.ts';

const V3 = BABYLON.Vector3;
// Of the taken plots of each kind of ground, how many have a candle, flowers, and (fresh mounds only) a wreath.
const KEPT = { lawn: [0.07, 0.16], postwar: [0.02, 0.07], public: [0.06, 0.12], meadow: [0.04, 0.1], victorian: [0, 0.01] };
const FLAMES = 4;           // groups of candles, each flickering on its own
// The red glass glows dimly; the flame in it is small and bright enough to bloom.
const CANDLE: { colour: [number, number, number]; flame: [number, number, number]; flicker: number } = { colour: [0.55, 0.05, 0.02], flame: [7, 3.2, 0.9], flicker: 0.28 };

// A grave candle: a red glass pot with a pierced tin lid.
function candleMesh(scene) {
    const glass = BABYLON.MeshBuilder.CreateCylinder('grave candle', { height: 0.13, diameterTop: 0.07, diameterBottom: 0.085, tessellation: 10 }, scene);
    glass.position.y = 0.065;
    glass.bakeCurrentTransformIntoVertices();
    return glass;
}

// A pot of flowers: the pot, stems, and heads in two colours gone dull with frost, all one mesh coloured by vertex.
function flowerMesh(scene) {
    const buf = new Buf();
    buf.tube([[0, 0, 0], [0, 0.16, 0]], [0.07, 0.085], 1, { sides: 10, shade: 0.35 });
    const heads = [[0.03, 0.27, 0.02], [-0.04, 0.3, 0.01], [0.0, 0.33, -0.03], [0.05, 0.31, -0.04], [-0.02, 0.26, 0.05], [0.04, 0.24, 0.05]];
    for (const [x, y, z] of heads) {
        buf.tube([[0, 0.15, 0], [x * 0.7, y - 0.03, z * 0.7]], 0.004, 1, { sides: 4, shade: 0.3 });
        buf.tube([[x * 0.7, y - 0.03, z * 0.7], [x, y, z], [x * 1.05, y + 0.012, z * 1.05]], [0.012, 0.022, 0.006], 1, { sides: 6, shade: 0.9 });
    }
    const mesh = buf.toMesh('grave flowers', scene, null);
    // Colour by height: pot dark, stems green, heads the colour of old carnations.
    const positions = mesh.getVerticesData('position'), colours = [];
    for (let i = 0; i < positions.length; i += 3) {
        const y = positions[i + 1];
        colours.push(...(y < 0.17 ? [0.08, 0.09, 0.07, 1] : y < 0.23 ? [0.1, 0.16, 0.06, 1] : [0.42, 0.09, 0.12, 1]));
    }
    mesh.setVerticesData('color', colours);
    return mesh;
}

// How far up a fresh mound (stones.ts's moundMesh) its top is, at a place off the middle of its plot.
function onMound(dx, dz) {
    const r = Math.min(1, Math.hypot(dx / (GRAVE.length * 0.52), dz / (GRAVE.width * 0.56)));
    return 0.2 * Math.cos(r * Math.PI / 2) - 0.02;
}

// A wreath laid flat on a mound.
function wreathMesh(scene) {
    const ring = BABYLON.MeshBuilder.CreateTorus('wreath', { diameter: 0.42, thickness: 0.09, tessellation: 18 }, scene);
    ring.position.y = 0.04;
    ring.bakeCurrentTransformIntoVertices();
    return ring;
}

function plain(scene, name, colour, rough, vertex = false) {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = BABYLON.Color3.FromArray(colour);
    m.metallic = 0;
    m.roughness = rough;
    m.environmentIntensity = 0;
    m.maxSimultaneousLights = 8;
    return m;
}

// Each of `matrices` carries the plot it is on (`plot`), so that what is on a grave can be taken off it when it is dug.
const instanced = (mesh, matrices) => {
    const data = new Float32Array(matrices.length * 16);
    matrices.forEach((m, i) => m.copyToArray(data, i * 16));
    mesh.thinInstanceSetBuffer('matrix', data, 16, false);
    mesh.plots = matrices.map((m) => m.plot);
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
};

// `plots` as the yard laid them (taken, fresh). Returns the meshes, and `update(t)` to make the candles flicker.
export function buildTokens(scene, plots) {
    const candles = Array.from({ length: FLAMES }, () => []), flowers = [], wreaths = [];
    for (const plot of plots) {
        if (!plot.taken) continue;
        const [candle, flower] = KEPT[plot.era] || [0, 0];
        // The plot's own dice, thrown again for each thing, so the same graves are kept every time.
        const roll = (k) => (plot.roll * k) % 1;
        // In front of the stone, which stands at the head (west) of the grave.
        const head = plot.x - GRAVE.length / 2 + 0.42, side = (roll(17) - 0.5) * 0.4;
        const at = (dx, dz, turn) => {
            const x = head + dx, z = plot.z + side + dz;
            const matrix = BABYLON.Matrix.Compose(V3.One(), BABYLON.Quaternion.RotationAxis(V3.Up(), turn), new V3(x, heightAt(x, z) - 0.01 + (plot.fresh ? onMound(x - plot.x, z - plot.z) : 0), z));
            return Object.assign(matrix, { plot: plot.id });
        };
        if (roll(29) < candle) candles[Math.floor(roll(41) * FLAMES)].push(at(0, -0.15, 0));
        if (roll(53) < flower) flowers.push(at(0.05, 0.18, roll(61) * 6.28));
        if (plot.fresh || (plot.era === 'public' && roll(71) < 0.1)) wreaths.push(at(0.7, -side, roll(83) * 6.28));
    }
    const glass = candles.map((_, i) => {
        const m = new BABYLON.StandardMaterial('candle glass ' + i, scene);
        m.disableLighting = true;
        m.emissiveColor = BABYLON.Color3.FromArray(CANDLE.colour);
        return m;
    });
    const flames = candles.map((_, i) => {
        const m = new BABYLON.StandardMaterial('candle flame ' + i, scene);
        m.disableLighting = true;
        m.emissiveColor = BABYLON.Color3.FromArray(CANDLE.flame);
        return m;
    });
    const meshes = [];
    candles.forEach((group, i) => {
        if (!group.length) return;
        const mesh = candleMesh(scene);
        mesh.material = glass[i];
        mesh.hasVertexAlpha = false;
        glass[i].alpha = 0.85;
        meshes.push(instanced(mesh, group));
        const flame = BABYLON.MeshBuilder.CreateSphere('candle flame', { diameter: 0.022, segments: 6 }, scene);
        flame.scaling.y = 1.6;
        flame.position.y = 0.075;
        flame.bakeCurrentTransformIntoVertices();
        flame.material = flames[i];
        meshes.push(instanced(flame, group));
    });
    if (flowers.length) {
        const mesh = flowerMesh(scene);
        mesh.material = plain(scene, 'flowers', [1, 1, 1], 0.8, true);
        meshes.push(instanced(mesh, flowers));
    }
    if (wreaths.length) {
        const mesh = wreathMesh(scene);
        mesh.material = plain(scene, 'wreath', [0.06, 0.12, 0.05], 0.7);
        meshes.push(instanced(mesh, wreaths));
    }
    return {
        meshes,
        // Whatever was left on a plot is put out of the way: it is being dug.
        clear(plot) {
            for (const mesh of meshes) mesh.plots.forEach((on, i) => { if (on === plot) mesh.thinInstanceSetMatrixAt(i, BABYLON.Matrix.Scaling(0, 0, 0)); });
        },
        // Each group of candles brightens and gutters on its own beat.
        update(t) {
            glass.forEach((m, i) => {
                const wave = Math.sin(t * (7.1 + i * 1.7) + i * 2) * 0.5 + Math.sin(t * (13.3 + i * 2.3) + i) * 0.3 + Math.sin(t * 2.1 + i * 4) * 0.2;
                m.emissiveColor.copyFrom(BABYLON.Color3.FromArray(CANDLE.colour).scale(1 + CANDLE.flicker * wave));
                flames[i].emissiveColor.copyFrom(BABYLON.Color3.FromArray(CANDLE.flame).scale(1 + CANDLE.flicker * 1.5 * wave));
            });
        },
    };
}
