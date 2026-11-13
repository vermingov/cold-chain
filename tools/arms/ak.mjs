// AK-47: lamoot's CC0 high-poly model (OpenGameArt), which comes as one untextured mesh. Its loose parts are sorted
// into the wooden furniture and the steel, each gets box-projected texture coordinates and smooth normals, and the
// two materials take CC0 textures: Poly Haven's lacquered cherry wood (warmed to the AK's red-brown lacquer) and
// ambientCG's Metal038 scratched steel (darkened to blued steel).
//   node tools/arms/ak.mjs <highpoly_ak47.obj> <dir with the textures>
import { Document, sharp, texture, metalRough, save } from './lib.mjs';
import { readObj, parts } from './obj.mjs';

const [objFile, tex] = process.argv.slice(2);
const SCALE = 0.1;                  // the model is 8.8 units long; the rifle is 0.88 m
const CENTRE_X = 2.44;              // its middle, side to side
const obj = readObj(objFile);
const { of, count } = parts(obj);

// Each part's box, in the model's own units: x across (+x the right side), y up, z back (the muzzle at -z).
const box = Array.from({ length: count }, () => ({ n: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }));
for (let t = 0; t < of.length; t++) {
    const b = box[of[t]]; b.n++;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
        const x = obj.pos[obj.tris[t * 3 + k] * 3 + a];
        b.lo[a] = Math.min(b.lo[a], x); b.hi[a] = Math.max(b.hi[a], x);
    }
}
// The furniture: the butt (reaches the back end), the pistol grip (the lowest thing behind the magazine), and the
// two handguards (the big parts between the gas block and the receiver).
const wooden = box.map((b) => b.hi[2] > 4.1 || (b.lo[1] < -0.7 && b.lo[2] > 1)
    || (b.n > 700 && b.lo[2] > -2.5 && b.hi[2] < -0.85 && b.hi[0] - b.lo[0] > 0.3));
const woodCount = wooden.filter(Boolean).length;
if (woodCount !== 4) throw new Error(`expected 4 wooden parts, found ${woodCount}`);

// Smooth normals over the welded mesh, area weighted.
const P = obj.pos, T = obj.tris;
const normals = new Float32Array(P.length);
const faceN = new Float32Array(T.length);
for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]];
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += n[k];
    for (let k = 0; k < 3; k++) faceN[t + k] = n[k];
}
for (let v = 0; v < normals.length; v += 3) {
    const l = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v + k] /= l;
}

// One primitive per material. A vertex is split only where the faces round it are projected from different sides;
// the grain (the texture's u) runs along the rifle on the sides, top and bottom.
function build(doc, buffer, wood, metresPerTile) {
    const out = { pos: [], nor: [], uv: [], idx: [] }, seen = new Map();
    for (let t = 0; t < T.length; t += 3) {
        if (wooden[of[t / 3]] !== wood) continue;
        const n = [faceN[t], faceN[t + 1], faceN[t + 2]].map(Math.abs);
        const side = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
        for (let k = 0; k < 3; k++) {
            const v = T[t + k], key = v * 3 + side;
            if (!seen.has(key)) {
                const [x, y, z] = [(P[v * 3] - CENTRE_X) * SCALE, P[v * 3 + 1] * SCALE, P[v * 3 + 2] * SCALE];
                const [u, w] = side === 0 ? [z, y] : side === 1 ? [z, x] : [x, y];
                seen.set(key, out.pos.length / 3);
                out.pos.push(x, y, z);
                out.nor.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
                out.uv.push(u / metresPerTile, -w / metresPerTile);
            }
            out.idx.push(seen.get(key));
        }
    }
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    return doc.createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(out.pos)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(out.nor)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(out.uv)))
        .setIndices(acc('SCALAR', out.pos.length / 3 > 65535 ? new Uint32Array(out.idx) : new Uint16Array(out.idx)));
}

const doc = new Document();
const buffer = doc.createBuffer();
const W = tex + '/', M = tex + '/Metal038_1K-JPG_';

// Lacquered birch on a real AK reads redder and lighter than this dark cherry stain.
const woodColour = sharp(W + 'cherry_diff.jpg').linear([2.6, 2.0, 1.9], [0, 0, 0]);
const wood = doc.createMaterial('ak47_wood')
    .setBaseColorTexture(await texture(doc, 'ak47_wood_diff', woodColour))
    .setNormalTexture(await texture(doc, 'ak47_wood_nor_gl', W + 'cherry_nor_gl.jpg', 1024, 92))
    .setMetallicRoughnessTexture(await texture(doc, 'ak47_wood_rough', await metalRough(sharp(W + 'cherry_rough.jpg').linear(0.8, 30), sharp(W + 'cherry_rough.jpg').linear(0, 0))))
    .setMetallicFactor(0).setRoughnessFactor(1);
// Blued steel: near black, the scratches and wear of the texture kept as faint lighter marks.
const steelColour = sharp(M + 'Color.jpg').linear(0.32, -6);
const steel = doc.createMaterial('ak47_steel')
    .setBaseColorTexture(await texture(doc, 'ak47_steel_diff', steelColour))
    .setNormalTexture(await texture(doc, 'ak47_steel_nor_gl', M + 'NormalGL.jpg', 1024, 92))
    .setMetallicRoughnessTexture(await texture(doc, 'ak47_steel_rough_metal', await metalRough(sharp(M + 'Roughness.jpg').linear(0.9, 25), M + 'Metalness.jpg')))
    .setMetallicFactor(1).setRoughnessFactor(1);

const mesh = doc.createMesh('ak47')
    .addPrimitive(build(doc, buffer, false, 0.2).setMaterial(steel))
    .addPrimitive(build(doc, buffer, true, 0.35).setMaterial(wood));
doc.createScene('ak47').addChild(doc.createNode('ak47').setMesh(mesh));
await save(doc, 'ak.glb');
