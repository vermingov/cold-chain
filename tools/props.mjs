#!/usr/bin/env node
// Things to stand in the rooms.
//
// Every object in the building is one of Poly Haven's 3D models
// (polyhaven.com/models, CC0), fetched as glTF at 1k and reduced to what this
// game can use: one small binary of geometry per model, read by src/models.js,
// and its texture maps beside it. The glTF is parsed here by hand, for the same
// reason the figures have their own format: the only reader is ours, and
// Babylon's glTF loader is another megabyte of JavaScript to ship for no gain.
//
//     node tools/props.mjs                    build whatever is missing
//     node tools/props.mjs --force            build everything again
//     node tools/props.mjs barrel_03 trashbag only these
//
// Raw downloads are kept in ~/.cache/cold-chain/dl/props/<id>/ (PROPS_CACHE moves
// it), so building again costs no network. PROPS_OUT builds somewhere other
// than assets/props.
//
// Coordinates. glTF is right-handed and Babylon is left-handed. X is mirrored
// (x -> -x, positions and normals), which is exactly what the root node of
// Babylon's own glTF loader does, and the mirror turns glTF's counter-clockwise
// front faces into the clockwise ones Babylon wants, so indices go out in
// their original order and UVs are untouched. For the textures that means:
// load them with invertY = false, and set invertNormalMapX on the material
// (the normal maps are OpenGL-style, and their X went with the mirror). Both
// are written into every header.
//
// Anchors. Each model is moved so that placing it is one position and one yaw:
//
//     floor     stands on y = 0, centred in x and z, its front facing +Z
//     wall      hangs on a wall whose surface is the plane z = 0 and sticks
//               out toward +Z; centred in x, and in y on its own middle
//     ceiling   hangs down from y = 0, centred in x and z
//
// Glass. A material whose name ends in _glass becomes a part marked
// `glass: true`, for the runtime to draw thin and see-through. Poly Haven's
// glass is transmissive in Blender and comes out of the glTF export as an
// opaque sheet, which would board up every clock face and lamp.
//
// What is left out: emission (nothing down there is switched on) and vertex
// colours.
//
// Output, in assets/props/:
//     <id>.bin                      'SIXP', u32 version, u32 header length, a
//                                   JSON header, then raw little-endian arrays
//                                   (position, normal, uv, index), each padded
//                                   to four bytes: the figures' container
//     <id>[_<part>]_albedo.jpg      colour, with ambient occlusion folded in
//     <id>[_<part>]_normal.jpg
//     <id>[_<part>]_orm.jpg         roughness in green, metalness in blue
//     manifest.json                 size, bounds and anchor of every model, so
//                                   a level can be furnished before any
//                                   geometry has been fetched
//
// tools/vendor/meshopt_simplifier.module.js is meshoptimizer's simplifier
// (github.com/zeux/meshoptimizer, MIT, Arseny Kapoulkine), version 0.25, its
// single-file build with the WebAssembly inside.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from './vendor/meshopt_simplifier.module.js';

const OUT = process.env.PROPS_OUT || join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'props');
const CACHE = process.env.PROPS_CACHE || join(homedir(), '.cache', 'six-v3', 'dl', 'props');
const API = 'https://api.polyhaven.com/files/';
// Poly Haven asks every client of its API to say who it is.
const AGENT = { 'User-Agent': 'six-six-s1x-props/1 (offline asset build)' };

const ANCHORS = {
    floor: 'stands on y = 0, centred in x and z, front facing +Z',
    wall: 'hangs on a wall whose surface is the plane z = 0 and sticks out toward +Z; centred in x, and in y on its own middle',
    ceiling: 'hangs down from y = 0, centred in x and z',
};

// The models, by Poly Haven id.
//
//   anchor   how it is mounted (above)
//   yaw      degrees about Y, the same way round as a mesh's rotation.y, that
//            bring the model's front to +Z; found by looking at renders
//   pitch    degrees about X, applied first, for the model that stands on
//            edge and should lie down
//   scale    for the download that is not in metres
//   nodes    some downloads are several objects side by side: keep the nodes
//            whose names match
//   drop     parts to leave out, by name
//   triangles
//            a budget of its own, for the model that falls apart at the one
//            its size allows
//   skip     why the model is not built at all
const MODELS = {
    // the yard
    large_iron_gate: { anchor: 'floor' },
    gothic_statue: { anchor: 'floor' },
    concrete_cat_statue: { anchor: 'floor' },
    painted_wooden_bench: { anchor: 'floor' },
    street_lamp_01: { anchor: 'floor' },
    tree_stump_01: { anchor: 'floor' },
    shrub_02: { anchor: 'floor' },
    shrub_03: { anchor: 'floor' },
    metal_trash_can: { anchor: 'floor', nodes: /rust/i },
    wooden_bucket_01: { anchor: 'floor' },
    watering_can_metal_01: { anchor: 'floor' },
    covered_car: { anchor: 'floor' },
    // what the work is done with
    rusted_spade_01: { anchor: 'floor' },
    picke_dirty_01: { anchor: 'floor' },
    crowbar_01: { anchor: 'floor' },
    hand_truck: { anchor: 'floor' },
    vintage_oil_lamp: { anchor: 'floor' },
    wooden_lantern_01: { anchor: 'floor' },
    vintage_flashlight: { anchor: 'floor' },
    // the flat
    dining_table: { anchor: 'floor' },
    dining_chair_02: { anchor: 'floor' },
    sofa_02: { anchor: 'floor' },
    Television_01: { anchor: 'floor' },
    vintage_electric_kettle: { anchor: 'floor' },
    wall_clock: { anchor: 'floor' },
    pull_chain_light_socket: { anchor: 'floor' },
    cardboard_box_01: { anchor: 'floor' },
    drawer_cabinet: { anchor: 'floor' },
    // the cold room
    medical_box: { anchor: 'floor' },
    metal_toolbox: { anchor: 'floor' },
};

// Triangles a model may keep, by its largest dimension in metres. A wardrobe
// fills the frame and a bottle never does.
function triangleBudget(largest) {
    if (largest > 1.2) return 6000;
    if (largest >= 0.5) return 3500;
    return 1200;
}

const textureSize = (largest) => (largest > 1.0 ? 1024 : 512);

// Anything outside this is a modelling mistake or a unit mix-up, not furniture.
const SANE_SIZE = [0.03, 8];

// --- fetching ----------------------------------------------------------------

async function download(url, path) {
    if (existsSync(path)) return;
    const res = await fetch(url, { headers: AGENT });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

// The model's glTF, its buffer and its textures, from the cache or the network.
async function fetchModel(id) {
    const dir = join(CACHE, id);
    await download(API + id, join(dir, 'files.json'));
    const files = JSON.parse(readFileSync(join(dir, 'files.json')));
    const entry = files.gltf && files.gltf['1k'] && files.gltf['1k'].gltf;
    if (!entry) throw new Error('Poly Haven has no 1k glTF for it');
    const gltfPath = join(dir, basename(entry.url));
    await download(entry.url, gltfPath);
    for (const [relative, file] of Object.entries(entry.include)) await download(file.url, join(dir, relative));
    const gltf = JSON.parse(readFileSync(gltfPath));
    const bin = readFileSync(join(dir, gltf.buffers[0].uri));
    return { dir, gltf, bin };
}

// --- matrices, column-major as glTF writes them ------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
    const m = new Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return m;
}

function fromTRS([tx, ty, tz] = [0, 0, 0], [x, y, z, w] = [0, 0, 0, 1], [sx, sy, sz] = [1, 1, 1]) {
    return [
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

// glTF to the game: mirror X, tip the model over if it was modelled standing
// when it should lie, turn it to face +Z, and bring it to metres. The turns
// are the ones Babylon makes for rotation.x and rotation.y in a left-handed
// scene.
function toGame({ yaw = 0, pitch = 0, scale = 1 }) {
    const [cy, sy] = [Math.cos(yaw * Math.PI / 180), Math.sin(yaw * Math.PI / 180)];
    const [cp, sp] = [Math.cos(pitch * Math.PI / 180), Math.sin(pitch * Math.PI / 180)];
    const turn = ([x, y, z]) => {
        const tipped = [x, y * cp - z * sp, y * sp + z * cp];
        return [(tipped[0] * cy + tipped[2] * sy) * scale, tipped[1] * scale, (tipped[2] * cy - tipped[0] * sy) * scale, 0];
    };
    return [...turn([-1, 0, 0]), ...turn([0, 1, 0]), ...turn([0, 0, 1]), 0, 0, 0, 1];
}

// What normals are multiplied by: the cofactors of the upper 3x3, row by row,
// which is the inverse transpose times the determinant. Returned with the
// determinant so the caller can take its sign back out.
function normalMatrix(m) {
    const [a, b, c, , d, e, f, , g, h, i] = m;
    const rows = [
        [e * i - f * h, c * h - b * i, b * f - c * e],
        [f * g - d * i, a * i - c * g, c * d - a * f],
        [d * h - e * g, b * g - a * h, a * e - b * d],
    ];
    return { rows, det: a * rows[0][0] + d * rows[0][1] + g * rows[0][2] };
}

// --- reading the glTF --------------------------------------------------------

const FLOAT = 5126;
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3 };
const INDEX_READERS = {
    5121: [1, (d, at) => d.getUint8(at)],
    5123: [2, (d, at) => d.getUint16(at, true)],
    5125: [4, (d, at) => d.getUint32(at, true)],
};

function accessorSpan(gltf, index) {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    return { accessor, view, start: (view.byteOffset || 0) + (accessor.byteOffset || 0) };
}

function readFloats(gltf, bin, index) {
    const { accessor, view, start } = accessorSpan(gltf, index);
    if (accessor.componentType !== FLOAT) throw new Error(`accessor ${index} is not float`);
    const width = WIDTH[accessor.type];
    const stride = view.byteStride || width * 4;
    const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const out = new Float32Array(accessor.count * width);
    for (let i = 0; i < accessor.count; i++) {
        for (let k = 0; k < width; k++) out[i * width + k] = data.getFloat32(start + i * stride + k * 4, true);
    }
    return out;
}

function readIndices(gltf, bin, index) {
    const { accessor, start } = accessorSpan(gltf, index);
    const [bytes, read] = INDEX_READERS[accessor.componentType];
    const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const out = new Uint32Array(accessor.count);
    for (let i = 0; i < accessor.count; i++) out[i] = read(data, start + i * bytes);
    return out;
}

// One primitive's triangles, moved by `matrix` into the game's space.
function readPrimitive(gltf, bin, primitive, matrix) {
    if ((primitive.mode ?? 4) !== 4) throw new Error('a primitive that is not triangles');
    const { POSITION, NORMAL, TEXCOORD_0 } = primitive.attributes;
    if (NORMAL === undefined || TEXCOORD_0 === undefined) throw new Error('a primitive without normals or UVs');
    const position = readFloats(gltf, bin, POSITION);
    const normal = readFloats(gltf, bin, NORMAL);
    const uv = readFloats(gltf, bin, TEXCOORD_0);
    const index = primitive.indices === undefined
        ? Uint32Array.from({ length: position.length / 3 }, (_, i) => i)
        : readIndices(gltf, bin, primitive.indices);

    const m = matrix;
    const { rows, det } = normalMatrix(m);
    const sign = Math.sign(det);
    for (let i = 0; i < position.length; i += 3) {
        const x = position[i], y = position[i + 1], z = position[i + 2];
        position[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        position[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        position[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const n = rows.map((row) => sign * (row[0] * normal[i] + row[1] * normal[i + 1] + row[2] * normal[i + 2]));
        const length = Math.hypot(...n) || 1;
        normal[i] = n[0] / length;
        normal[i + 1] = n[1] / length;
        normal[i + 2] = n[2] / length;
    }
    // The conversion is itself a mirror, and that one mirror is what makes
    // the original index order right for Babylon. A node that carries a
    // mirror of its own cancels it, and its triangles have to be turned over.
    if (det > 0) {
        for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    }
    return { material: primitive.material, position, normal, uv, index };
}

// Every primitive in the scene with its node's transform baked in. `keep`
// picks nodes by name when a download holds more than one object.
function flatten(gltf, bin, game, keep) {
    const primitives = [];
    const visit = (nodeIndex, parent) => {
        const node = gltf.nodes[nodeIndex];
        const world = multiply(parent, node.matrix || fromTRS(node.translation, node.rotation, node.scale));
        if (node.mesh !== undefined && (!keep || keep.test(node.name))) {
            const matrix = multiply(game, world);
            for (const primitive of gltf.meshes[node.mesh].primitives) {
                primitives.push(readPrimitive(gltf, bin, primitive, matrix));
            }
        }
        for (const child of node.children || []) visit(child, world);
    };
    for (const root of gltf.scenes[gltf.scene || 0].nodes) visit(root, IDENTITY);
    if (!primitives.length) throw new Error('no meshes in it');
    return primitives;
}

// --- materials ---------------------------------------------------------------

// What a glTF material comes to once colour, emission and transmission are
// gone: three source images, three factors and two flags. Materials that come
// to the same thing are drawn as one part.
function describeMaterial(gltf, material, id) {
    const pbr = material.pbrMetallicRoughness || {};
    const image = (ref) => (ref ? gltf.images[gltf.textures[ref.index].source].uri : null);
    const [r, g, b] = pbr.baseColorFactor || [1, 1, 1];
    const own = material.name.startsWith(id + '_') ? material.name.slice(id.length + 1) : 'main';
    return {
        name: own,
        glass: /_glass$/.test(material.name),
        doubleSided: Boolean(material.doubleSided),
        diffuse: image(pbr.baseColorTexture),
        normal: image(material.normalTexture),
        arm: image(pbr.metallicRoughnessTexture),
        grey: 0.2126 * r + 0.7152 * g + 0.0722 * b,       // linear, as glTF factors are
        roughness: pbr.roughnessFactor ?? 1,
        metallic: pbr.metallicFactor ?? 1,
    };
}

const sameLook = ({ name, ...a }, { name: _, ...b }) => JSON.stringify(a) === JSON.stringify(b);

// One mesh out of many primitives: vertices end to end, triangles gathered
// into one run of indices per distinct material.
function assemble(gltf, primitives, id, drop = []) {
    const parts = [];
    for (const primitive of primitives) {
        const look = describeMaterial(gltf, gltf.materials[primitive.material], id);
        if (drop.includes(look.name)) continue;
        let part = parts.find((p) => sameLook(p.look, look));
        if (!part) {
            // Part names become file names, so two parts may not share one.
            if (parts.some((p) => p.look.name === look.name)) look.name += parts.length + 1;
            parts.push(part = { look, primitives: [] });
        }
        part.primitives.push(primitive);
    }

    const kept = parts.flatMap((p) => p.primitives);
    const vertexCount = kept.reduce((n, p) => n + p.position.length / 3, 0);
    const mesh = {
        position: new Float32Array(vertexCount * 3),
        normal: new Float32Array(vertexCount * 3),
        uv: new Float32Array(vertexCount * 2),
        index: new Uint32Array(kept.reduce((n, p) => n + p.index.length, 0)),
        parts: [],
    };
    let vertex = 0, at = 0;
    for (const { look, primitives: own } of parts) {
        const indexStart = at;
        for (const p of own) {
            mesh.position.set(p.position, vertex * 3);
            mesh.normal.set(p.normal, vertex * 3);
            mesh.uv.set(p.uv, vertex * 2);
            for (const i of p.index) mesh.index[at++] = i + vertex;
            vertex += p.position.length / 3;
        }
        mesh.parts.push({ look, indexStart, indexCount: at - indexStart });
    }
    return mesh;
}

// --- geometry ----------------------------------------------------------------

// Tenths of a millimetre: all a header needs, and stable from run to run.
const round = (v) => Math.round(v * 1e4) / 1e4;

function boundsOf(position) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i++) {
        const v = position[i], k = i % 3;
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
    }
    return { min, max };
}

// The simplifier's error is a fraction of the model's size. Past this much
// the model has stopped being simplified and started being destroyed. Found
// by looking: the generator at 0.07 is whole, the payphone at 0.5 is a shell.
const WRECKED = 0.1;

// One run of indices cut down to `target` of them. Normals are weighed in so
// that a hard edge costs more to remove than a wrinkle in a flat panel, and
// `Prune` lets loose scraps (a screw head, a strand of wire) go once they are
// smaller than the error already accepted elsewhere.
//
// The first attempt keeps every seam in the UVs and normals where it is.
// Some models are nothing but seams: flat-shaded, every face with corners of
// its own, so no edge may collapse and the only way down is to prune whole
// pieces away until the thing is a shell. For those, collapsing across seams
// (`Permissive`) is the lesser harm.
function reduce(mesh, indices, target) {
    const attempt = (...flags) => MeshoptSimplifier.simplifyWithAttributes(
        indices, mesh.position, 3, mesh.normal, 3, [0.5, 0.5, 0.5], null, target, 1, flags);
    const [careful, error] = attempt('Prune');
    return error < WRECKED ? careful : attempt('Prune', 'Permissive')[0];
}

// A part this small is a pane of glass or a paper label: it is left whole.
const TOO_SMALL_TO_CUT = 48;

// Bring the triangle count down to `budget`, each part taking the share of it
// that it had of the original.
function simplify(mesh, budget) {
    const count = (part) => part.indexCount / 3;
    if (mesh.parts.reduce((n, part) => n + count(part), 0) <= budget) return;
    const whole = mesh.parts.filter((part) => count(part) <= TOO_SMALL_TO_CUT);
    const cut = mesh.parts.filter((part) => !whole.includes(part));
    const share = (budget - whole.reduce((n, part) => n + count(part), 0)) / cut.reduce((n, part) => n + count(part), 0);

    const runs = mesh.parts.map((part) => {
        const own = mesh.index.subarray(part.indexStart, part.indexStart + part.indexCount);
        return whole.includes(part) ? own : reduce(mesh, own, Math.floor(count(part) * share) * 3);
    });
    mesh.index = new Uint32Array(runs.reduce((n, run) => n + run.length, 0));
    let at = 0;
    mesh.parts.forEach((part, i) => {
        mesh.index.set(runs[i], at);
        part.indexStart = at;
        part.indexCount = runs[i].length;
        at += runs[i].length;
    });
}

// Merge vertices that are the same in every attribute and drop the ones no
// triangle uses any more, in order of first use.
function weld(mesh) {
    const packed = new Float32Array(8);
    const bits = new Uint32Array(packed.buffer);
    const seen = new Map();
    const position = [], normal = [], uv = [];
    for (let i = 0; i < mesh.index.length; i++) {
        const v = mesh.index[i];
        packed.set(mesh.position.subarray(v * 3, v * 3 + 3), 0);
        packed.set(mesh.normal.subarray(v * 3, v * 3 + 3), 3);
        packed.set(mesh.uv.subarray(v * 2, v * 2 + 2), 6);
        const key = bits.join(',');
        if (!seen.has(key)) {
            seen.set(key, seen.size);
            position.push(packed[0], packed[1], packed[2]);
            normal.push(packed[3], packed[4], packed[5]);
            uv.push(packed[6], packed[7]);
        }
        mesh.index[i] = seen.get(key);
    }
    mesh.position = new Float32Array(position);
    mesh.normal = new Float32Array(normal);
    mesh.uv = new Float32Array(uv);
}

// Move the mesh onto its anchor (the conventions at the top of the file).
function anchor(mesh, how) {
    const { min, max } = boundsOf(mesh.position);
    const middle = (k) => (min[k] + max[k]) / 2;
    const shift = {
        floor: [middle(0), min[1], middle(2)],
        wall: [middle(0), middle(1), min[2]],
        ceiling: [middle(0), max[1], middle(2)],
    }[how];
    for (let i = 0; i < mesh.position.length; i++) mesh.position[i] -= shift[i % 3];
}

// --- textures ----------------------------------------------------------------

const magick = (...args) => execFileSync('magick', args);

// Colour, with the occlusion (red of the arm map) multiplied in at two-thirds
// strength: the lights here are lamps and a moon, and occlusion that only
// dims ambient light would never be seen. A base colour factor is folded in
// as its luminance; the map is gamma-encoded and the factor is not, hence
// the power.
function bakeAlbedo(dir, look, size, out) {
    const args = [join(dir, look.diffuse), '-colorspace', 'sRGB'];
    if (look.arm) {
        args.push('(', join(dir, look.arm), '-channel', 'R', '-separate', '-level', '-50%,100%', ')',
            '-compose', 'multiply', '-composite');
    }
    if (look.grey !== 1) args.push('-evaluate', 'multiply', String(look.grey ** (1 / 2.2)));
    magick(...args, '-resize', `${size}x${size}`, '-type', 'TrueColor', '-quality', '86', out);
}

function bakeNormal(dir, look, size, out) {
    magick(join(dir, look.normal), '-resize', `${size}x${size}`, '-quality', '90', out);
}

// Occlusion, roughness, metalness in red, green, blue, as Poly Haven packs
// them, with the material's two factors multiplied into their channels so the
// runtime has nothing to scale.
function bakeOrm(dir, look, size, out) {
    const args = [join(dir, look.arm), '-colorspace', 'sRGB', '-type', 'TrueColor'];
    if (look.roughness !== 1) args.push('-channel', 'G', '-evaluate', 'multiply', String(look.roughness), '+channel');
    if (look.metallic !== 1) args.push('-channel', 'B', '-evaluate', 'multiply', String(look.metallic), '+channel');
    magick(...args, '-resize', `${size}x${size}`, '-quality', '84', out);
}

const MAPS = [
    { kind: 'albedo', source: (look) => look.diffuse, recipe: (look) => [look.diffuse, look.arm, look.grey], bake: bakeAlbedo },
    { kind: 'normal', source: (look) => look.normal, recipe: (look) => [look.normal], bake: bakeNormal },
    { kind: 'orm', source: (look) => look.arm, recipe: (look) => [look.arm, look.roughness, look.metallic], bake: bakeOrm },
];

// Bake every map the parts need and return each part as the header describes
// it. Parts that would bake the same file share it.
function bakeParts(id, dir, parts, size) {
    const baked = new Map();
    return parts.map(({ look, indexStart, indexCount }) => {
        const textures = {};
        for (const map of MAPS) {
            if (!map.source(look)) continue;
            const recipe = JSON.stringify([map.kind, ...map.recipe(look)]);
            if (!baked.has(recipe)) {
                const file = parts.length > 1 ? `${id}_${look.name}_${map.kind}.jpg` : `${id}_${map.kind}.jpg`;
                map.bake(dir, look, size, join(OUT, file));
                baked.set(recipe, file);
            }
            textures[map.kind] = baked.get(recipe);
        }
        const part = { name: look.name, indexStart, indexCount, doubleSided: look.doubleSided, textures };
        if (look.glass) part.glass = true;
        // With no map to carry them, the factors are all there is.
        if (!textures.albedo) part.grey = round(look.grey);
        if (!textures.orm) Object.assign(part, { roughness: round(look.roughness), metallic: round(look.metallic) });
        return part;
    });
}

// --- the container -----------------------------------------------------------

const TYPE_NAMES = new Map([[Float32Array, 'float32'], [Uint16Array, 'uint16'], [Uint32Array, 'uint32']]);

function writeContainer(path, header, arrays) {
    const layout = [], blobs = [];
    let offset = 0;
    for (const [name, array] of Object.entries(arrays)) {
        const raw = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
        const pad = -raw.length & 3;
        layout.push({ name, offset, length: raw.length, type: TYPE_NAMES.get(array.constructor) });
        blobs.push(raw, Buffer.alloc(pad));
        offset += raw.length + pad;
    }
    let head = JSON.stringify({ ...header, arrays: layout });
    head += ' '.repeat(-Buffer.byteLength(head) & 3);
    const lead = Buffer.alloc(12);
    lead.write('SIXP', 0, 'latin1');
    lead.writeUInt32LE(1, 4);
    lead.writeUInt32LE(Buffer.byteLength(head), 8);
    writeFileSync(path, Buffer.concat([lead, Buffer.from(head), ...blobs]));
}

function readHeader(path) {
    const file = readFileSync(path);
    return JSON.parse(file.subarray(12, 12 + file.readUInt32LE(8)).toString());
}

const texturesOf = (header) => [...new Set(header.parts.flatMap((part) => Object.values(part.textures)))];

// --- one model ---------------------------------------------------------------

const binPath = (id) => join(OUT, `${id}.bin`);

// A model built before may have named its files differently.
function removeBuilt(id) {
    if (!existsSync(binPath(id))) return;
    for (const file of texturesOf(readHeader(binPath(id)))) rmSync(join(OUT, file), { force: true });
    rmSync(binPath(id));
}

async function build(id, model) {
    const { dir, gltf, bin } = await fetchModel(id);
    const mesh = assemble(gltf, flatten(gltf, bin, toGame(model), model.nodes), id, model.drop);
    const sourceTriangles = mesh.index.length / 3;

    const source = boundsOf(mesh.position);
    const largest = Math.max(...source.max.map((v, k) => v - source.min[k]));
    if (largest < SANE_SIZE[0] || largest > SANE_SIZE[1]) throw new Error(`absurd size: ${largest.toFixed(3)} m across`);

    simplify(mesh, model.triangles || triangleBudget(largest));
    weld(mesh);
    anchor(mesh, model.anchor);
    if (mesh.position.length / 3 <= 65535) mesh.index = Uint16Array.from(mesh.index);

    removeBuilt(id);
    const bounds = boundsOf(mesh.position);
    const header = {
        name: id,
        anchor: model.anchor,
        sourceTriangles,
        triangles: mesh.index.length / 3,
        vertexCount: mesh.position.length / 3,
        bounds: { min: bounds.min.map(round), max: bounds.max.map(round) },
        parts: bakeParts(id, dir, mesh.parts, textureSize(largest)),
        invertY: false,
        invertNormalMapX: true,
        source: `polyhaven.com/a/${id} (CC0)`,
    };
    // The geometry goes last: a .bin on disk means its textures are too.
    writeContainer(binPath(id), header, { position: mesh.position, normal: mesh.normal, uv: mesh.uv, index: mesh.index });
}

// --- the manifest and the report ---------------------------------------------

// Rebuilt from the headers on disk every time, so it cannot drift from them.
function writeManifest() {
    const models = {};
    for (const file of readdirSync(OUT).filter((name) => name.endsWith('.bin')).sort()) {
        const header = readHeader(join(OUT, file));
        const { min, max } = header.bounds;
        const bytes = [file, ...texturesOf(header)].reduce((n, name) => n + statSync(join(OUT, name)).size, 0);
        models[header.name] = {
            anchor: header.anchor,
            bounds: header.bounds,
            bytes,
            file,
            size: max.map((v, k) => round(v - min[k])),
            sourceTriangles: header.sourceTriangles,
            triangles: header.triangles,
        };
    }
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ anchors: ANCHORS, models }, null, 1) + '\n');
    return models;
}

function report(models, skipped) {
    const row = (id, anchor, triangles, size, bytes) =>
        console.log(`${id.padEnd(30)} ${anchor.padEnd(8)} ${triangles.padStart(15)}   ${size.padEnd(19)} ${String(bytes).padStart(8)}`);
    row('model', 'anchor', 'triangles', 'size (m)', 'bytes');
    let total = 0;
    for (const [id, m] of Object.entries(models)) {
        row(id, m.anchor, `${m.sourceTriangles} -> ${m.triangles}`, m.size.map((v) => v.toFixed(2)).join(' x '), m.bytes);
        total += m.bytes;
    }
    console.log(`${Object.keys(models).length} models, ${(total / 1048576).toFixed(1)} MB`);
    for (const { id, why } of skipped) console.log(`skipped ${id}: ${why}`);
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const named = args.filter((arg) => arg !== '--force');
    const unknown = named.filter((id) => !MODELS[id]);
    if (unknown.length) throw new Error('not in the table: ' + unknown.join(', '));

    mkdirSync(OUT, { recursive: true });
    await MeshoptSimplifier.ready;
    const skipped = [];
    for (const id of named.length ? named : Object.keys(MODELS)) {
        const model = MODELS[id];
        if (model.skip) { skipped.push({ id, why: model.skip }); continue; }
        if (existsSync(binPath(id)) && !force) continue;
        // One bad model is reported and the rest are still built.
        try {
            await build(id, model);
        } catch (error) {
            skipped.push({ id, why: error.message });
        }
    }
    report(writeManifest(), skipped);
}

await main();
