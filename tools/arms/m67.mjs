// M67 fragmentation grenade, built here: no free model of it exists under CC0 or CC-BY. Real measures: a 63.5 mm
// steel sphere, the M213 fuze on top (about 90 mm in all), the spoon (safety lever) down its side, the pin through
// the fuze head with its pull ring. Painted olive drab with the yellow band of high explosive, over ambientCG's
// PaintedMetal002 (CC0: its chips, scratches and roughness kept, its blue paint replaced); the fuze, pin and ring are
// steel over ambientCG's Metal038 (CC0).
//   node tools/arms/m67.mjs <dir with the textures>
// Metres, y up, the body's centre at the origin, the spoon on +x, the pin along z with the ring at -z.
import { Document, sharp, texture, metalRough, save } from './lib.mjs';

const tex = process.argv[2] + '/';
const R = 0.03175;                  // the body's radius
const TILE = 0.1;                   // metres one texture repeat covers
const rad = (d) => (d * Math.PI) / 180;

// A surface of revolution about y: `profile` is [r, y] from bottom to top, `sharp` the indices of its corners.
function lathe(profile, sides = 64, sharpAt = []) {
    const rows = [];
    profile.forEach((p, i) => {
        const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
        const nrm = (a, b) => { const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; };
        if (sharpAt.includes(i)) { rows.push([p, nrm(prev, p)], [p, nrm(p, next)]); return; }
        const n = nrm(prev, next);
        rows.push([p, n]);
    });
    const out = mesh();
    let along = 0;
    rows.forEach(([p, n], j) => {
        if (j) along += Math.hypot(p[0] - rows[j - 1][0][0], p[1] - rows[j - 1][0][1]);
        for (let k = 0; k <= sides; k++) {
            const a = (k / sides) * 2 * Math.PI, c = Math.cos(a), s = -Math.sin(a);
            out.pos.push(p[0] * c, p[1], p[0] * s);
            out.nor.push(n[0] * c, n[1], n[0] * s);
            out.uv.push((k / sides) * 2 * Math.PI * R / TILE, along / TILE);
        }
    });
    grid(out, 0, rows.length, sides + 1);
    return out;
}

// A cross-section (`outline`, [a, b] counter-clockwise) swept along `path`; b runs along `side` (square to the
// path), a along side × tangent. `smooth`: a round section, normals from its centre; otherwise hard corners.
function sweep(path, outline, side, { smooth = false, closed = false } = {}) {
    const out = mesh();
    const pts = closed ? [...path, path[0]] : path;
    const frames = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let t = sub(b, a);
        if (closed && (i === 0 || i === pts.length - 1)) t = sub(path[1], path[path.length - 1]);
        t = norm(t);
        return { p, t, n: norm(cross(side, t)) };
    });
    const at = (f, [a, b]) => add(f.p, add(scale(f.n, a), scale(side, b)));
    const dir = (f, [a, b]) => norm(add(scale(f.n, a), scale(side, b)));
    const lengths = [0];
    for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + len(sub(pts[i], pts[i - 1])));
    const ring = smooth ? [outline] : outline.map((o, i) => [o, outline[(i + 1) % outline.length]]);
    for (const strip of ring) {
        const pts2 = smooth ? [...strip, strip[0]] : strip;
        const edgeN = smooth ? null : [pts2[1][1] - pts2[0][1], -(pts2[1][0] - pts2[0][0])];
        const base = out.pos.length / 3;
        frames.forEach((f, i) => pts2.forEach((o, k) => {
            out.pos.push(...at(f, o));
            out.nor.push(...(smooth ? dir(f, o) : dir(f, edgeN)));
            out.uv.push(lengths[i] / TILE, (k / (pts2.length - 1)) * 0.01 / TILE);
        }));
        grid(out, base, frames.length, pts2.length);
    }
    return out;
}

// A box with flat faces, from its two corners.
function box([x0, y0, z0], [x1, y1, z1]) {
    const out = mesh();
    const faces = [
        [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
        [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
        [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
        [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
        [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [n, quad] of faces) {
        const b = out.pos.length / 3;
        quad.forEach((p, i) => { out.pos.push(...p); out.nor.push(...n); out.uv.push((i === 1 || i === 2) * 0.1, (i > 1) * 0.1); });
        out.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return out;
}

function mesh() { return { pos: [], nor: [], uv: [], idx: [] }; }
// Two triangles for each cell of a rows × cols grid of vertices starting at `base`.
function grid(out, base, rows, cols) {
    for (let j = 0; j + 1 < rows; j++) for (let k = 0; k + 1 < cols; k++) {
        const a = base + j * cols + k, b = a + 1, c = a + cols + 1, d = a + cols;
        out.idx.push(a, b, c, a, c, d);
    }
}
function merge(...ms) {
    const out = mesh();
    for (const m of ms) { const b = out.pos.length / 3; out.pos.push(...m.pos); out.nor.push(...m.nor); out.uv.push(...m.uv); out.idx.push(...m.idx.map((i) => i + b)); }
    return out;
}
const sub = (a, b) => a.map((x, i) => x - b[i]), add = (a, b) => a.map((x, i) => x + b[i]), scale = (a, s) => a.map((x) => x * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a), norm = (a) => scale(a, 1 / (len(a) || 1));
const circle = (r, n) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);

// --- the parts ----------------------------------------------------------------------------------------------------
// The body: the sphere from its bottom up to the neck, a faint weld seam round the middle, the threaded collar.
const TOP = 64;                     // degrees above the middle where the sphere meets the neck
const bodyProfile = [];
for (let d = -90; d <= TOP; d += 4) {
    const seam = Math.abs(d) < 1 ? 0.00035 : 0;
    bodyProfile.push([(R + seam) * Math.cos(rad(d)), R * Math.sin(rad(d))]);
}
const neck = bodyProfile.length;
bodyProfile.push([0.0128, R * Math.sin(rad(TOP)) + 0.0004], [0.0128, 0.0318], [0.0112, 0.0322]);
const body = lathe(bodyProfile, 72, [neck - 1, neck, neck + 1]);
// The yellow band just under the neck, a hair proud of the paint.
const bandProfile = [];
for (let d = 50; d <= 57; d += 1) bandProfile.push([(R + 0.00012) * Math.cos(rad(d)), (R + 0.00012) * Math.sin(rad(d))]);
const band = lathe(bandProfile, 72);

// The fuze: its body screwed into the collar, a shoulder, the striker housing and its domed cap.
const fuzeProfile = [[0, 0.029], [0.0098, 0.029], [0.0098, 0.0345], [0.0103, 0.0352], [0.0103, 0.0405], [0.0094, 0.0414],
    [0.0088, 0.0414], [0.0088, 0.0505], [0.0080, 0.0525], [0.0064, 0.0538], [0.0040, 0.0546], [0, 0.0549]];
const fuze = lathe(fuzeProfile, 48, [2, 3, 4, 5, 6, 7]);
// The two lugs on the spoon's side that the lever hooks under, the pin passing through them.
const lugs = merge(box([0.0080, 0.0420, 0.0038], [0.0128, 0.0525, 0.0052]), box([0.0080, 0.0420, -0.0052], [0.0128, 0.0525, -0.0038]));

// The spoon: hooked over the lugs at the top, then down the fuze and over the sphere, its end lifting off a little.
const spoonPath = [[0.0035, 0.0556], [0.0080, 0.0556], [0.0118, 0.0550], [0.0136, 0.0532], [0.0142, 0.0490], [0.0142, 0.0400]];
for (let d = 62; d >= -34; d -= 4) {
    const lift = d < -18 ? (-18 - d) * 0.00009 : 0;
    spoonPath.push([(R + 0.0021 + lift) * Math.cos(rad(d)), (R + 0.0021 + lift) * Math.sin(rad(d))]);
}
// A shallow channel 13 mm wide: the plate and two flanges turned in toward the body.
const W = 0.0065, T = 0.0008, F = 0.0019;
const spoonSection = [[T, -W], [T, W], [-F, W], [-F, W - T], [0, W - T], [0, -W + T], [-F, -W + T], [-F, -W]];
const spoon = sweep(spoonPath.map(([x, y]) => [x, y, 0]), spoonSection, [0, 0, 1]);

// The pin through the lugs (along z), and the pull ring hanging from its end.
const PIN = [0.0104, 0.0472];
const pin = sweep([[PIN[0], PIN[1], 0.0085], [PIN[0], PIN[1], -0.0125]], circle(0.0009, 10), [0, 1, 0], { smooth: true });
const RING = 0.0115;
const ringCentre = [PIN[0] + 0.001, PIN[1] - 0.004, -0.0125 - Math.sqrt(RING * RING - 0.004 * 0.004)];
const ringPath = circle(RING, 40).map(([a, b]) => [ringCentre[0], ringCentre[1] + b, ringCentre[2] + a]);
const ring = sweep(ringPath, circle(0.0011, 10), [1, 0, 0], { smooth: true, closed: true });

// --- materials ----------------------------------------------------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const P = tex + 'PaintedMetal002_1K-JPG_', M = tex + 'Metal038_1K-JPG_';

// Olive drab where there is paint, bare steel where it has chipped (the texture's metalness says which).
async function paintColour() {
    const metal = await sharp(P + 'Metalness.jpg').greyscale().raw().toBuffer({ resolveWithObject: true });
    const shade = await sharp(P + 'Color.jpg').greyscale().resize(metal.info.width, metal.info.height).raw().toBuffer();
    const n = metal.info.width * metal.info.height, od = [78, 82, 52], steel = [104, 106, 104], out = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) {
        const m = metal.data[i * metal.info.channels] / 255, s = 0.75 + (shade[i] / 130) * 0.25;
        for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, (od[c] * (1 - m) + steel[c] * m) * s);
    }
    return sharp(out, { raw: { width: metal.info.width, height: metal.info.height, channels: 3 } });
}
const paintNormal = await texture(doc, 'm67_paint_nor_gl', P + 'NormalGL.jpg', 1024, 92);
const paintRough = await texture(doc, 'm67_paint_rough_metal', await metalRough(sharp(P + 'Roughness.jpg').linear(1.2, 80), P + 'Metalness.jpg'));
const paint = doc.createMaterial('m67_paint')
    .setBaseColorTexture(await texture(doc, 'm67_paint_diff', await paintColour()))
    .setNormalTexture(paintNormal).setMetallicRoughnessTexture(paintRough).setMetallicFactor(1).setRoughnessFactor(1);
const yellow = doc.createMaterial('m67_yellow').setBaseColorFactor([0.62, 0.48, 0.05, 1])
    .setNormalTexture(paintNormal).setMetallicRoughnessTexture(paintRough).setMetallicFactor(0).setRoughnessFactor(1);
const steelNormal = await texture(doc, 'm67_steel_nor_gl', M + 'NormalGL.jpg', 512, 90);
const steelRough = await texture(doc, 'm67_steel_rough_metal', await metalRough(M + 'Roughness.jpg', M + 'Metalness.jpg'), 512);
const steelColour = await texture(doc, 'm67_steel_diff', M + 'Color.jpg', 512);
// The fuze's dull phosphated steel; the pin and ring bright spring steel.
const fuzeRough = await texture(doc, 'm67_fuze_rough_metal', await metalRough(sharp(M + 'Roughness.jpg').linear(1, 95), M + 'Metalness.jpg'), 512);
const fuzeSteel = doc.createMaterial('m67_fuze').setBaseColorTexture(steelColour).setBaseColorFactor([0.62, 0.63, 0.55, 1])
    .setNormalTexture(steelNormal).setMetallicRoughnessTexture(fuzeRough).setMetallicFactor(0.85).setRoughnessFactor(1);
const wire = doc.createMaterial('m67_wire').setBaseColorTexture(steelColour).setBaseColorFactor([1, 1, 0.97, 1])
    .setNormalTexture(steelNormal).setMetallicRoughnessTexture(steelRough).setMetallicFactor(1).setRoughnessFactor(0.7);
const spoonPaint = doc.createMaterial('m67_spoon').setBaseColorTexture(paint.getBaseColorTexture())
    .setNormalTexture(paintNormal).setMetallicRoughnessTexture(paintRough).setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(true);

// --- out ----------------------------------------------------------------------------------------------------------
function primitive(m, material) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    return doc.createPrimitive().setMaterial(material)
        .setAttribute('POSITION', acc('VEC3', new Float32Array(m.pos)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(m.nor)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(m.uv)))
        .setIndices(acc('SCALAR', new Uint16Array(m.idx)));
}
const node = (name, ...prims) => doc.createNode(name).setMesh(prims.reduce((me, p) => me.addPrimitive(p), doc.createMesh(name)));
const scene = doc.createScene('m67');
const root = doc.createNode('m67');
scene.addChild(root);
// The spoon and the pin are their own nodes, so the game can fling the one and pull the other.
root.addChild(node('body', primitive(body, paint), primitive(band, yellow), primitive(merge(fuze, lugs), fuzeSteel)));
root.addChild(node('spoon', primitive(spoon, spoonPaint)));
root.addChild(node('pin', primitive(merge(pin, ring), wire)));
await save(doc, 'grenade.glb');
