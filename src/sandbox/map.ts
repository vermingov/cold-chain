// The sandbox's hall, laid out as a test map: a measured grid on everything (a line every 10 cm, heavier every 25 cm,
// heaviest every metre, the heights numbered on the walls), and things to try people, falls, guns and blood on. Up the
// east side a ramp, ledges at one, two and three metres with stairs between them, and a balcony along the north wall on
// pillars; across the south end a low and a high wall to shoot over and round, and a corridor with a doorway into it; a
// few crates in the north-west. The middle is kept clear for the people's line-up and the arsenal board on the west wall.
//
// Everything is a box (the ramp a box tilted), listed once in BLOCKS: from that list the hall is drawn (one mesh for the
// room, one for everything in it, one for the hazard stripes on drop edges, one for the numbers), made solid to Havok
// (one static body), walked on by the player (ground, push) and landed on by blood (land, covered).

import * as BABYLON from '@babylonjs/core';
import { clear } from '../solids.ts';
import { WORLD } from './ragdoll.ts';
const V3 = BABYLON.Vector3;

export const HALL = { x: 11, z: 11, height: 5.5 };
const STEP = 0.45;      // m: the highest thing the player steps up onto as they walk (player.ts BODY.climb: a stair, not a 50 cm crate)
const HEAD = 1.8;       // m: how tall the player is, for walking under things

// What each kind of thing is coloured (linear): neutral greys for the room, a strong colour for each kind of structure,
// as prototype maps do, so that what a thing is for reads from across the hall.
const COLOUR = {
    floor: [0.13, 0.13, 0.13], wall: [0.3, 0.3, 0.29], roof: [0.12, 0.12, 0.12],
    climb: [0.6, 0.2, 0.04], pillar: [0.3, 0.3, 0.33], cover: [0.07, 0.17, 0.42], crate: [0.15, 0.32, 0.1],
};

type Block = { kind: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; ramp: boolean };
const BLOCKS: Block[] = [];
const block = (kind, x0, x1, y0, y1, z0, z1, ramp = false) => { BLOCKS.push({ kind, x0, x1, y0, y1, z0, z1, ramp }); };
// Five stairs of 20 cm rise and 30 cm going, rising north from `from` metres.
const stairs = (x0, x1, z0, from) => { for (let k = 0; k < 5; k++) block('climb', x0, x1, 0, from + 0.2 * (k + 1), z0 + 0.3 * k, z0 + 0.3 * (k + 1)); };

// The climb: a ramp (1 in 5) up to a ledge a metre high, stairs up to one at two metres, stairs up to a tower at three,
// which opens onto the balcony. Every ledge drops straight to the floor along its west edge.
block('climb', 8, 11, 0, 1, -9, -4, true);
block('climb', 6.5, 11, 0, 1, -4, -0.5);
block('climb', 6.5, 8.5, 0, 1, -0.5, 1);
stairs(8.5, 11, -0.5, 1);
block('climb', 6.5, 11, 0, 2, 1, 4.5);
block('climb', 6.5, 8.5, 0, 2, 4.5, 6);
stairs(8.5, 11, 4.5, 2);
block('climb', 6.5, 11, 0, 3, 6, 11);
// The balcony: a 30 cm slab three metres up, open underneath, on four pillars along its front.
block('climb', -8, 6.5, 2.7, 3, 8, 11);
for (const x of [-7.5, -3.5, 0.5, 4.5]) block('pillar', x - 0.2, x + 0.2, 0, 2.7, 8.05, 8.45);
// Cover: a wall a metre high, one 2.2 m high, and a corridor along the south wall, open at its east end, with a doorway
// (1 m by 2.2 m) through its wall.
block('cover', -1, 1.5, 0, 1, -6.65, -6.35);
block('cover', 2.5, 5, 0, 2.2, -8.65, -8.35);
block('cover', -11, -6.5, 0, 3, -8.65, -8.35);
block('cover', -5.5, -2, 0, 3, -8.65, -8.35);
block('cover', -6.5, -5.5, 2.2, 3, -8.65, -8.35);
// Crates: a metre, sixty centimetres on top of it, half a metre.
block('crate', -7.5, -6.5, 0, 1, 4.5, 5.5);
block('crate', -7.3, -6.7, 1, 1.6, 4.7, 5.3);
block('crate', -6.2, -5.7, 0, 0.5, 4.6, 5.1);

// Edges with a drop of a metre or more under them, striped: [x0, z0, x1, z1, height, which way is out (x, z)].
const EDGES = [
    [6.5, -4, 6.5, 1, 1, -1, 0], [6.5, -4, 8, -4, 1, 0, -1],
    [6.5, 1, 6.5, 6, 2, -1, 0], [6.5, 1, 8.5, 1, 2, 0, -1],
    [6.5, 6, 6.5, 8, 3, -1, 0], [6.5, 6, 8.5, 6, 3, 0, -1],
    [-8, 8, 6.5, 8, 3, 0, -1], [-8, 8, -8, 11, 3, -1, 0],
];

// Heights written on things: [text, x, y, z, which way the face looks (x, z), letter height].
const SIGNS: [string, number, number, number, number, number, number][] = [
    ['1 m', 6.5, 0.75, -2, -1, 0, 0.12], ['2 m', 6.5, 1.75, 3, -1, 0, 0.12], ['3 m', 6.5, 2.75, 7, -1, 0, 0.12],
    ['3 m', -2, 2.78, 8, 0, -1, 0.1], ['1 m', 0.25, 0.85, -6.65, 0, -1, 0.12], ['2.2 m', 3.75, 2.05, -8.65, 0, -1, 0.12],
    ['2.2 m', -6, 2.5, -8.65, 0, -1, 0.12], ['1 m', -7, 0.85, 4.5, 0, -1, 0.1], ['0.5 m', -5.95, 0.4, 4.6, 0, -1, 0.07],
];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// How high a block's top is at (x, z): the ramp's rises from its south end to its north.
const top = (b: Block, x: number, z: number) => (b.ramp ? b.y0 + (b.y1 - b.y0) * clamp((z - b.z0) / (b.z1 - b.z0), 0, 1) : b.y1);
const OUT = [new V3(0, 1, 0), new V3(0, -1, 0), new V3(-1, 0, 0), new V3(1, 0, 0), new V3(0, 0, -1), new V3(0, 0, 1)];   // each face's way out
const SLOPE = (() => { const r = BLOCKS.find((b) => b.ramp); return new V3(0, r.z1 - r.z0, -(r.y1 - r.y0)).normalize(); })();

// The blocks over each square metre of the floor, so that a drop is only tested against what is near it.
const CELLS: number[][] = [];
BLOCKS.forEach((b, k) => {
    for (let i = Math.floor(b.x0 + HALL.x); i <= Math.floor(b.x1 + HALL.x - 1e-6); i++)
        for (let j = Math.floor(b.z0 + HALL.z); j <= Math.floor(b.z1 + HALL.z - 1e-6); j++) (CELLS[j * HALL.x * 2 + i] ??= []).push(k);
});
const near = (x: number, z: number) => CELLS[Math.floor(z + HALL.z) * HALL.x * 2 + Math.floor(x + HALL.x)] ?? [];

// The height of what is underfoot at (x, z): the highest top there no higher than `below` (the floor, if nothing is).
export function ground(x: number, z: number, below = Infinity) {
    let g = 0;
    for (const k of near(x, z)) {
        const b = BLOCKS[k];
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        const t = top(b, x, z);
        if (t <= below && t > g) g = t;
    }
    return g;
}

// Whether the floor at (x, z) is under something standing on it (blood does not run in there).
export function covered(x: number, z: number) {
    return near(x, z).some((k) => { const b = BLOCKS[k]; return b.y0 === 0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; });
}

// What the player cannot walk through, for feet at `feet`: what rises more than a step above them and does not pass over
// their head. Moves `at` out of it (solids.ts); the way it was pushed, or null.
export const solids = {
    push(at: { x: number; z: number }, radius: number, feet = 0) {
        let pushed = null;
        for (let pass = 0; pass < 2; pass++) for (const b of BLOCKS) {
            if (b.y0 >= feet + HEAD) continue;
            const nx = clamp(at.x, b.x0, b.x1), nz = clamp(at.z, b.z0, b.z1);
            if ((nx - at.x) ** 2 + (nz - at.z) ** 2 >= radius * radius || top(b, nx, nz) <= feet + STEP) continue;
            pushed = clear(at, radius, b) || pushed;
        }
        return pushed;
    },
};

// Whether a drop now at `at`, going `vel`, is inside a block: if so it is put back on the face it came in through (the
// one it crossed last), and that face's normal returned; null if it is in the open.
export function land(at: BABYLON.Vector3, vel: BABYLON.Vector3) {
    for (const k of near(at.x, at.z)) {
        const b = BLOCKS[k], t = top(b, at.x, at.z);
        if (at.x <= b.x0 || at.x >= b.x1 || at.z <= b.z0 || at.z >= b.z1 || at.y >= t || at.y <= b.y0) continue;
        let soonest = Infinity, face = 0;
        const crossed = (depth: number, speed: number, f: number) => { if (speed > 1e-6 && depth / speed < soonest) { soonest = depth / speed; face = f; } };
        crossed(t - at.y, -vel.y, 0);
        if (b.y0 > 0) crossed(at.y - b.y0, vel.y, 1);
        crossed(at.x - b.x0, vel.x, 2);
        crossed(b.x1 - at.x, -vel.x, 3);
        crossed(at.z - b.z0, vel.z, 4);
        crossed(b.z1 - at.z, -vel.z, 5);
        const off = 0.001;
        if (face === 0) at.y = t + off;
        else if (face === 1) at.y = b.y0 - off;
        else if (face === 2) at.x = b.x0 - off;
        else if (face === 3) at.x = b.x1 + off;
        else if (face === 4) at.z = b.z0 - off;
        else at.z = b.z1 + off;
        return face === 0 && b.ramp ? SLOPE : OUT[face];
    }
    return null;
}

// The grid, drawn from where each point is in the world and which way its face looks, so it is the same measured metre
// on every surface: lines every 10 cm, 25 cm and a metre, and alternate square metres a shade apart. Lines thinner than
// a pixel fade out rather than shimmer.
class Grid extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'Grid', 220, { GRID: false });
        this._enable(true);
    }

    getClassName() { return 'Grid'; }

    prepareDefines(defines) { defines.GRID = true; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GRID
float gridLine(vec2 p, float every, float wide) {
    vec2 off = abs(fract(p / every + 0.5) - 0.5) * every, px = fwidth(p);
    vec2 on = 1.0 - smoothstep(vec2(wide * 0.5), vec2(wide * 0.5) + px, off);
    return max(on.x, on.y) * (1.0 - smoothstep(every * 0.04, every * 0.12, max(px.x, px.y)));
}
#endif
`,
            CUSTOM_FRAGMENT_UPDATE_ALBEDO: `#ifdef GRID
{
    vec3 facing = abs(vNormalW);
    vec2 gp = facing.y > 0.5 ? vPositionW.xz : facing.x > facing.z ? vPositionW.zy : vPositionW.xy;
    float line = max(max(gridLine(gp, 0.1, 0.003) * 0.22, gridLine(gp, 0.25, 0.005) * 0.4), gridLine(gp, 1.0, 0.012) * 0.75);
    vec2 square = floor(gp + 0.0001);
    surfaceAlbedo *= (1.0 + 0.05 * (mod(square.x + square.y, 2.0) * 2.0 - 1.0)) * (1.0 - line);
}
#endif
`,
        };
    }
}

// Geometry put together a face at a time, with the face's colour on its corners and its UVs laid in the world (the
// concrete's relief and roughness, a tile every 2.5 m, as the old hall had them).
class Sheet {
    p: number[] = []; n: number[] = []; c: number[] = []; uv: number[] = []; i: number[] = [];

    face(corners: number[][], normal: number[], colour: number[], tile = 2.5) {
        const base = this.p.length / 3, [nx, ny, nz] = normal.map(Math.abs);
        for (const q of corners) {
            this.p.push(...q);
            this.n.push(...normal);
            this.c.push(...colour, 1);
            const [u, v] = ny > 0.5 ? [q[0], q[2]] : nx > nz ? [q[2], q[1]] : [q[0], q[1]];
            this.uv.push(u / tile, v / tile);
        }
        for (let k = 1; k + 1 < corners.length; k++) {
            // Babylon's front face is the side (p1 - p2) x (p3 - p2) points to (VertexData.ComputeNormals).
            const [a, b, c] = [corners[0], corners[k], corners[k + 1]];
            const out = V3.Cross(V3.FromArray(a).subtract(V3.FromArray(b)), V3.FromArray(c).subtract(V3.FromArray(b)));
            const tri = [base, base + k, base + k + 1];
            this.i.push(...(V3.Dot(out, V3.FromArray(normal)) >= 0 ? tri : [tri[0], tri[2], tri[1]]));
        }
    }

    mesh(name: string, scene: BABYLON.Scene, material: BABYLON.Material) {
        const m = new BABYLON.Mesh(name, scene);
        const data = new BABYLON.VertexData();
        Object.assign(data, { positions: this.p, normals: this.n, colors: this.c, uvs: this.uv, indices: this.i });
        if (!this.c.length) data.colors = null;
        data.applyToMesh(m);
        m.material = material;
        m.freezeWorldMatrix();
        return m;
    }
}

// A block's faces: all but a bottom on the floor.
function faces(s: Sheet, b: Block) {
    const { x0, x1, y0, y1, z0, z1 } = b, colour = COLOUR[b.kind];
    const h0 = b.ramp ? y0 : y1;    // the top's height at its south end
    s.face([[x0, h0, z0], [x1, h0, z0], [x1, y1, z1], [x0, y1, z1]], b.ramp ? SLOPE.asArray() : [0, 1, 0], colour);
    if (y0 > 0) s.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], colour);
    s.face([[x0, y0, z0], [x0, h0, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], colour);
    s.face([[x1, y0, z0], [x1, h0, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], colour);
    if (h0 > y0) s.face([[x0, y0, z0], [x1, y0, z0], [x1, h0, z0], [x0, h0, z0]], [0, 0, -1], colour);
    s.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], colour);
}

// Yellow and black, at 45 degrees, tiling.
function stripes(scene) {
    const t = new BABYLON.DynamicTexture('hazard', { width: 128, height: 128 }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D;
    g.fillStyle = '#d9a90f';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#141414';
    for (let k = -2; k < 4; k++) {
        g.beginPath();
        g.moveTo(k * 64, 0); g.lineTo(k * 64 + 32, 0); g.lineTo(k * 64 + 32 + 128, 128); g.lineTo(k * 64 + 128, 128);
        g.fill();
    }
    t.update();
    return t;
}

// The numbers, white on black cards so they read on any colour, each on a row of one texture: [the texture, row of each
// text, how wide each is for its height].
function lettering(scene, texts: string[]) {
    const ROW = 64, W = 256;
    const t = new BABYLON.DynamicTexture('mapSigns', { width: W, height: ROW * texts.length }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D;
    g.font = 'bold 44px sans-serif';
    g.textBaseline = 'middle';
    const wide = texts.map((text, k) => {
        const w = Math.min(W, g.measureText(text).width + 24);
        g.fillStyle = '#111';
        g.fillRect(0, k * ROW + 2, w, ROW - 4);
        g.fillStyle = '#eee';
        g.fillText(text, 12, k * ROW + ROW / 2 + 1);
        return w / W;
    });
    t.update();
    return { texture: t, row: (text) => texts.indexOf(text), aspect: wide.map((w) => (w * W) / ROW), u: wide, rows: texts.length };
}

// The hall's lights: two big lamps over the line-up casting shadows, four more over the rest without (one over the
// balcony reaching only as far down as its deck, so the floor under the slab is not lit through it), and a little from
// everywhere.
function light(scene) {
    const fill = new BABYLON.HemisphericLight('fill', new V3(0, 1, 0), scene);
    fill.intensity = 0.45;
    fill.diffuse = new BABYLON.Color3(0.85, 0.88, 0.95);
    fill.groundColor = new BABYLON.Color3(0.25, 0.24, 0.23);
    const shadows = [];
    const lamps = [];
    for (const [x, z, power, range, angle] of [[-2.5, 1, 70], [2.5, 1, 70], [3, -6.5, 30], [-6.5, -3, 30], [8.75, 1.5, 30], [2.5, 9.5, 30, 4.6, 2.3]]) {
        const lamp = new BABYLON.SpotLight('lamp', new V3(x, HALL.height - 0.3, z), new V3(0, -1, 0), angle ?? 1.75, 1.5, scene);
        lamp.falloffType = BABYLON.Light.FALLOFF_GLTF;
        if (range) lamp.range = range;
        lamp.intensity = power;
        lamp.diffuse = new BABYLON.Color3(1, 0.96, 0.9);
        lamp.shadowMinZ = 0.3;
        lamp.shadowMaxZ = 12;
        lamps.push(lamp);
        if (power < 70) continue;
        const s = new BABYLON.ShadowGenerator(2048, lamp);
        s.usePercentageCloserFiltering = true;
        s.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
        s.bias = 0.0006;
        s.normalBias = 0.012;
        shadows.push(s);
    }
    return { fill, lamps, shadows };
}

// The hall built: its meshes, the reflections wet things show, its lights, and one static body for all of it.
export function buildMap(scene: BABYLON.Scene, surfaces) {
    const lights = light(scene);
    const { x: W, z: D, height: H } = HALL;

    // Painted concrete: the colour is the faces', the relief and roughness the old hall's concrete.
    const maps = surfaces.maps('ceiling');
    const paint = new BABYLON.PBRMaterial('mapPaint', scene);
    paint.bumpTexture = maps.normal;
    paint.invertNormalMapX = true;      // the maps are OpenGL-style and Babylon is left-handed
    paint.metallic = 0;
    paint.roughness = 0.9;
    paint.metallicTexture = maps.rough;
    paint.useRoughnessFromMetallicTextureGreen = true;
    paint.useMetallnessFromMetallicTextureBlue = false;
    paint.useRoughnessFromMetallicTextureAlpha = false;
    paint.useAmbientOcclusionFromMetallicTextureRed = false;
    paint.maxSimultaneousLights = 8;
    paint.environmentIntensity = 0;
    paint.specularIntensity = 0.6;
    new Grid(paint);

    const room = new Sheet();
    room.face([[-W, 0, -D], [W, 0, -D], [W, 0, D], [-W, 0, D]], [0, 1, 0], COLOUR.floor);
    room.face([[-W, H, -D], [W, H, -D], [W, H, D], [-W, H, D]], [0, -1, 0], COLOUR.roof);
    room.face([[-W, 0, D], [W, 0, D], [W, H, D], [-W, H, D]], [0, 0, -1], COLOUR.wall);
    room.face([[-W, 0, -D], [W, 0, -D], [W, H, -D], [-W, H, -D]], [0, 0, 1], COLOUR.wall);
    room.face([[W, 0, -D], [W, 0, D], [W, H, D], [W, H, -D]], [-1, 0, 0], COLOUR.wall);
    room.face([[-W, 0, -D], [-W, 0, D], [-W, H, D], [-W, H, -D]], [1, 0, 0], COLOUR.wall);
    const hall = room.mesh('hall', scene, paint);
    const things = new Sheet();
    for (const b of BLOCKS) faces(things, b);
    const structures = things.mesh('structures', scene, paint);
    for (const m of [hall, structures]) {
        m.receiveShadows = true;
        m.metadata = { solid: true };
    }
    for (const s of lights.shadows) s.addShadowCaster(structures);

    // The stripes: 12 cm along the top of each drop edge and down its face, a few millimetres proud of it.
    const hazard = new BABYLON.PBRMaterial('hazard', scene);
    hazard.albedoTexture = stripes(scene);
    hazard.metallic = 0;
    hazard.roughness = 0.6;
    hazard.maxSimultaneousLights = 8;
    hazard.environmentIntensity = 0;
    const strip = new Sheet(), white = [1, 1, 1], E = 0.004, S = 0.12;
    for (const [x0, z0, x1, z1, y, ox, oz] of EDGES) {
        const ix = -ox * S, iz = -oz * S, px = ox * E, pz = oz * E;
        strip.face([[x0 + px, y + E, z0 + pz], [x1 + px, y + E, z1 + pz], [x1 + px + ix, y + E, z1 + pz + iz], [x0 + px + ix, y + E, z0 + pz + iz]], [0, 1, 0], white, 0.25);
        strip.face([[x0 + px, y + E, z0 + pz], [x1 + px, y + E, z1 + pz], [x1 + px, y - S, z1 + pz], [x0 + px, y - S, z0 + pz]], [ox, 0, oz], white, 0.25);
    }
    const edges = strip.mesh('hazard', scene, hazard);
    edges.receiveShadows = true;
    edges.isPickable = false;

    // The numbers: the heights up every wall every four metres (where nothing stands in front of them or hangs there),
    // and each structure's height on it.
    const signs = [...SIGNS];
    for (let y = 1; y < H; y++) {
        for (let u = -8; u <= 8; u += 4) {
            for (const [x, z, nx, nz] of [[u, D, 0, -1], [u, -D, 0, 1], [W, u, -1, 0], [-W, u, 1, 0]]) {
                const ix = x + nx * 0.2, iz = z + nz * 0.2;
                if (BLOCKS.some((b) => ix > b.x0 && ix < b.x1 && iz > b.z0 && iz < b.z1 && y + 0.15 > b.y0 && y - 0.05 < b.y1)) continue;
                if (nx === 1 && iz > -5.2 && iz < 2.8 && y < 3) continue;    // the arsenal board
                signs.push([`${y} m`, x, y + 0.16, z, nx, nz, 0.24]);
            }
        }
    }
    const letters = lettering(scene, [...new Set(signs.map((s) => s[0]))]);
    const written = new Sheet();
    for (const [text, x, y, z, nx, nz, high] of signs) {
        const k = letters.row(text), wide = high * letters.aspect[k];
        // Along the face, to the right as one looks at it; left-aligned at (x, z), centred on y.
        const rx = -nz, rz = nx, px = x + nx * 0.003, pz = z + nz * 0.003;
        const corners = [[px, y - high / 2, pz], [px + rx * wide, y - high / 2, pz + rz * wide], [px + rx * wide, y + high / 2, pz + rz * wide], [px, y + high / 2, pz]];
        written.face(corners, [nx, 0, nz], [1, 1, 1]);
        const v0 = 1 - (k + 1) / letters.rows, v1 = 1 - k / letters.rows;
        written.uv.splice(written.uv.length - 8, 8, 0, v0, letters.u[k], v0, letters.u[k], v1, 0, v1);
    }
    const ink = new BABYLON.PBRMaterial('mapSigns', scene);
    ink.albedoTexture = letters.texture;
    ink.metallic = 0;
    ink.roughness = 0.7;
    ink.maxSimultaneousLights = 8;
    ink.environmentIntensity = 0;
    ink.zOffset = -1;
    const numbers = written.mesh('mapSigns', scene, ink);
    numbers.receiveShadows = true;
    numbers.isPickable = false;

    // The lamps' housings: lit panels, which is what anything wet or polished shows most of. One mesh for all of them.
    const glow = new BABYLON.PBRMaterial('lampGlass', scene);
    glow.emissiveColor = new BABYLON.Color3(1, 0.96, 0.9);
    glow.emissiveIntensity = 6;
    const panels = lights.lamps.map((lamp) => {
        const panel = BABYLON.MeshBuilder.CreateDisc('lampGlass', { radius: 0.35, tessellation: 32 }, scene);
        panel.rotation.x = Math.PI / 2;
        panel.position.copyFrom(lamp.position.add(new V3(0, 0.02, 0)));
        return panel;
    });
    const glass = BABYLON.Mesh.MergeMeshes(panels, true);
    glass.name = 'lampGlass';
    glass.material = glow;
    glass.isPickable = false;
    glass.freezeWorldMatrix();

    // Solid to Havok: the floor, walls and roof as slabs behind their faces, and every block, all one static body.
    const shape = new BABYLON.PhysicsShapeContainer(scene);
    const slab = (centre: BABYLON.Vector3, size: BABYLON.Vector3, turn = BABYLON.Quaternion.Identity()) => {
        const box = new BABYLON.PhysicsShapeBox(centre, turn, size, scene);
        box.filterMembershipMask = WORLD;
        box.material = { friction: 0.8, restitution: 0.05 };
        shape.addChild(box);
    };
    slab(new V3(0, -0.5, 0), new V3(W * 2, 1, D * 2));
    slab(new V3(0, H + 0.5, 0), new V3(W * 2, 1, D * 2));
    slab(new V3(0, H / 2, D + 0.5), new V3(W * 2, H, 1));
    slab(new V3(0, H / 2, -D - 0.5), new V3(W * 2, H, 1));
    slab(new V3(W + 0.5, H / 2, 0), new V3(1, H, D * 2));
    slab(new V3(-W - 0.5, H / 2, 0), new V3(1, H, D * 2));
    for (const b of BLOCKS) {
        if (!b.ramp) { slab(new V3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), new V3(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0)); continue; }
        // The ramp: a half-metre slab tilted to lie under its top, from below the floor at the foot into the ledge at the head.
        const rise = b.y1 - b.y0, run = b.z1 - b.z0, long = Math.hypot(rise, run), T = 0.5;
        const centre = new V3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2).subtract(SLOPE.scale(T / 2));
        slab(centre, new V3(b.x1 - b.x0, T, long), BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, -Math.atan2(rise, run)));
    }
    shape.filterMembershipMask = WORLD;
    const body = new BABYLON.PhysicsBody(new BABYLON.TransformNode('hallBody', scene), BABYLON.PhysicsMotionType.STATIC, false, scene);
    body.shape = shape;

    const reflections = new BABYLON.ReflectionProbe('hall', 256, scene);
    reflections.position.set(0, 1.4, 0);
    reflections.renderList.push(hall, structures, edges, glass);
    reflections.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    return { lights, meshes: [hall, structures, edges, numbers, glass], reflections };
}
