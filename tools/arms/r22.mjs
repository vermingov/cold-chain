// A .22 LR semi-automatic carbine of the Ruger 10/22 pattern, built here: no CC0 or CC-BY model of one could be
// downloaded without an account. Real measures of the 10/22 Carbine: 37 in (940 mm) overall, an 18.5 in (470 mm) barrel
// 0.920 in at the breech turned down to 0.620 in, a receiver about 7.2 x 1.1 in, a 13.5 in pull, the 10-round rotary
// magazine flush under the receiver ahead of the trigger guard, the bolt handle on the right, a barrel band near the
// muzzle. Stock: Poly Haven's "Fine Grained Wood" (Rob Tuytel, CC0) stained to the usual walnut-brown birch; receiver
// black anodised and barrel blued over ambientCG's Metal038 (CC0).
//   node tools/arms/r22.mjs <dir with wood_Diffuse.jpg, wood_nor_gl.jpg, wood_Rough.jpg> <dir with Metal038_1K-JPG_*.jpg>
// glTF frame: metres, y up, the bore along +z at y = 0 (the muzzle at z = 0.47, the receiver's front face at 0), the
// gun's right side toward -x. The magazine (`mag`) and bolt handle (`handle`) are nodes of their own, for the reload.
import { Document, sharp, texture, metalRough, save } from './lib.mjs';

const [woodDir, metalDir] = process.argv.slice(2).map((d) => d + '/');
const TILE = 0.6;                      // metres one repeat of the wood covers (Poly Haven's 0.6 m scan)

const mesh = () => ({ pos: [], nor: [], uv: [], idx: [] });
// Rings of `n` points (each [x, y, z]) joined into a tube, optionally capped at each end; normals worked out after.
function loft(rings, { capStart = false, capEnd = false } = {}) {
    const out = mesh(), n = rings[0].length;
    for (const ring of rings) for (const p of ring) { out.pos.push(...p); out.uv.push(p[2] / TILE, (p[1] + Math.abs(p[0]) * 0.6) / TILE); }
    for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k < n; k++) {
        const a = j * n + k, b = j * n + ((k + 1) % n), c = b + n, d = a + n;
        out.idx.push(a, d, c, a, c, b);
    }
    const cap = (ring, flip) => {
        const base = out.pos.length / 3, c = ring.reduce((s, p) => s.map((v, i) => v + p[i] / n), [0, 0, 0]);
        out.pos.push(...c); out.uv.push(c[0] / TILE, c[1] / TILE);
        for (const p of ring) { out.pos.push(...p); out.uv.push(p[0] / TILE, p[1] / TILE); }
        for (let k = 0; k < n; k++) flip ? out.idx.push(base, base + 1 + k, base + 1 + ((k + 1) % n)) : out.idx.push(base, base + 1 + ((k + 1) % n), base + 1 + k);
    };
    if (capStart) cap(rings[0], true);
    if (capEnd) cap(rings[rings.length - 1], false);
    return smooth(out);
}
// Smooth normals from the faces round each vertex.
function smooth(m) {
    const nor = new Float32Array(m.pos.length);
    for (let t = 0; t < m.idx.length; t += 3) {
        const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]].map((i) => m.pos.slice(i * 3, i * 3 + 3));
        const u = a.map((v, i) => b[i] - v), w = a.map((v, i) => c[i] - v);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        for (const i of [m.idx[t], m.idx[t + 1], m.idx[t + 2]]) for (let k = 0; k < 3; k++) nor[i * 3 + k] += n[k];
    }
    for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; m.nor.push(nor[i] / l, nor[i + 1] / l, nor[i + 2] / l); }
    return m;
}
// A rounded-rectangle section (superellipse, power 4) `hw` wide each side and from `lo` to `hi` in y, at z.
const section = (z, lo, hi, hw, n = 24, cx = 0) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const e = (v) => Math.sign(v) * Math.abs(v) ** 0.5;
    return [cx + hw * e(c), (lo + hi) / 2 + ((hi - lo) / 2) * e(s), z];
});
// A turned part along z: `profile` is [r, z] pairs, from one end to the other.
const turned = (profile, n = 32) => loft(profile.map(([r, z]) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a), z];
})));
const box = (x0, y0, z0, x1, y1, z1, r = 0.0015) => {
    // a box with its long edges along z slightly rounded: a lofted section, capped.
    const hw = (x1 - x0) / 2, cx = (x0 + x1) / 2, bevel = (z) => section(z, y0, y1, hw, 16, cx);
    return loft([bevel(z0), bevel(z0 + Math.min(r, (z1 - z0) / 3)), bevel(z1 - Math.min(r, (z1 - z0) / 3)), bevel(z1)], { capStart: true, capEnd: true });
};
function merge(...ms) {
    const out = mesh();
    for (const m of ms) { const b = out.pos.length / 3; out.pos.push(...m.pos); out.nor.push(...m.nor); out.uv.push(...m.uv); out.idx.push(...m.idx.map((i) => i + b)); }
    return out;
}

// --- the parts ------------------------------------------------------------------------------------------------------
// Barrel: 0.920 in for the first inch, a short taper, 0.620 in to the muzzle; the crown recessed round a 5.6 mm bore.
const barrel = turned([[0.0117, -0.002], [0.0117, 0.025], [0.0079, 0.06], [0.0079, 0.468], [0.0072, 0.47], [0.0029, 0.47], [0.0029, 0.44]], 40);
// Receiver: a flat-sided box with a round top, its bottom inside the stock; a trigger guard and trigger below it.
const receiver = loft([-0.183, -0.18, -0.003, 0].map((z) => section(z, -0.024, 0.019, 0.0138, 28)), { capStart: true, capEnd: true });
const guard = merge(box(-0.0045, -0.068, -0.155, 0.0045, -0.062, -0.075), box(-0.0045, -0.068, -0.08, 0.0045, -0.04, -0.074), box(-0.0045, -0.068, -0.157, 0.0045, -0.045, -0.151));
const trigger = box(-0.003, -0.06, -0.122, 0.003, -0.035, -0.114, 0.001);
// Sights: a bead post near the muzzle, a folding leaf on the barrel ahead of the receiver.
const sights = merge(box(-0.002, 0.006, 0.448, 0.002, 0.016, 0.458, 0.0008), box(-0.006, 0.006, 0.14, 0.006, 0.013, 0.148, 0.0008));
// Barrel band round barrel and forend, 15 cm back from the muzzle.
const band = loft([0.312, 0.313, 0.324, 0.325].map((z, i) => section(z, -0.037 - (i % 3 ? 0.0015 : 0), 0.0095 + (i % 3 ? 0.0015 : 0), 0.0185 + (i % 3 ? 0.0012 : 0), 28)));
// Stock: stations along the gun (z, top, bottom, half-width), butt to forend tip.
const STOCK = [[-0.47, -0.006, -0.126, 0.02], [-0.44, 0.0, -0.118, 0.021], [-0.33, 0.002, -0.088, 0.02], [-0.27, -0.008, -0.066, 0.0165], [-0.22, -0.012, -0.062, 0.017],
    [-0.19, -0.004, -0.06, 0.019], [-0.16, -0.004, -0.058, 0.02], [-0.04, -0.004, -0.062, 0.021], [0.0, -0.004, -0.05, 0.02], [0.1, -0.004, -0.042, 0.0185],
    [0.3, -0.004, -0.036, 0.0165], [0.33, -0.006, -0.032, 0.014], [0.336, -0.01, -0.028, 0.008]];
const stock = loft(STOCK.map(([z, top, bottom, hw]) => section(z, bottom, top, hw, 32)), { capStart: true, capEnd: true });
const buttplate = loft([-0.4765, -0.475, -0.471, -0.47].map((z, i) => section(z, -0.1255 + (i ? 0 : 0.002), -0.0065 - (i ? 0 : 0.002), 0.0195 - (i ? 0 : 0.002), 32)), { capStart: true });
// The rotary magazine's housing, its floor flush with the stock's belly, and the release lever ahead of the guard.
const mag = merge(box(-0.0125, -0.063, -0.068, 0.0125, -0.02, -0.03, 0.002), box(-0.004, -0.065, -0.075, 0.004, -0.06, -0.068, 0.001));
// Bolt handle: a short rod out of the right side's slot, a knob on its end.
const handle = merge(loft([0, 1].map((t) => Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * 2 * Math.PI;
    return [-0.0135 - t * 0.016, 0.004 + 0.0028 * Math.sin(a), -0.052 + 0.0028 * Math.cos(a)];
})), { capStart: true }), box(-0.034, -0.0005, -0.0575, -0.0285, 0.0085, -0.0465, 0.002));

// --- materials ------------------------------------------------------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const M = metalDir + 'Metal038_1K-JPG_';
// Walnut-brown stain over the light wood: its grain kept as shading.
const stain = async () => {
    const { data, info } = await sharp(woodDir + 'wood_Diffuse.jpg').greyscale().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 3), tone = [108, 62, 34];
    for (let i = 0; i < info.width * info.height; i++) { const s = 0.45 + (data[i] / 255) * 0.75; for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, tone[c] * s); }
    return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } });
};
const black = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
const wood = doc.createMaterial('r22_stock')
    .setBaseColorTexture(await texture(doc, 'r22_stock_diff', await stain()))
    .setNormalTexture(await texture(doc, 'r22_stock_nor_gl', woodDir + 'wood_nor_gl.jpg', 1024, 92))
    .setMetallicRoughnessTexture(await texture(doc, 'r22_stock_rough_metal', await metalRough(sharp(woodDir + 'wood_Rough.jpg').linear(0.6, 40), sharp(black)), 512))
    .setMetallicFactor(0).setRoughnessFactor(1);
const steelNormal = await texture(doc, 'r22_steel_nor_gl', M + 'NormalGL.jpg', 512, 90);
const steelRough = await texture(doc, 'r22_steel_rough_metal', await metalRough(sharp(M + 'Roughness.jpg').linear(0.8, 60), M + 'Metalness.jpg'), 512);
const steelColour = await texture(doc, 'r22_steel_diff', M + 'Color.jpg', 512);
const blued = doc.createMaterial('r22_blued').setBaseColorTexture(steelColour).setBaseColorFactor([0.13, 0.135, 0.15, 1])
    .setNormalTexture(steelNormal).setMetallicRoughnessTexture(steelRough).setMetallicFactor(1).setRoughnessFactor(0.9);
const anodised = doc.createMaterial('r22_receiver').setBaseColorTexture(steelColour).setBaseColorFactor([0.075, 0.075, 0.08, 1])
    .setNormalTexture(steelNormal).setMetallicRoughnessTexture(steelRough).setMetallicFactor(0.6).setRoughnessFactor(1);
const plastic = doc.createMaterial('r22_plastic').setBaseColorFactor([0.035, 0.035, 0.037, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);

// --- out ------------------------------------------------------------------------------------------------------------
function primitive(m, material) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    return doc.createPrimitive().setMaterial(material)
        .setAttribute('POSITION', acc('VEC3', new Float32Array(m.pos)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(m.nor)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(m.uv)))
        .setIndices(acc('SCALAR', new Uint32Array(m.idx)));
}
const node = (name, ...prims) => doc.createNode(name).setMesh(prims.reduce((me, p) => me.addPrimitive(p), doc.createMesh(name)));
const scene = doc.createScene('r22');
const root = doc.createNode('r22');
scene.addChild(root);
root.addChild(node('body', primitive(stock, wood), primitive(merge(barrel, sights, band), blued), primitive(merge(receiver, guard, trigger), anodised), primitive(buttplate, plastic)));
root.addChild(node('mag', primitive(mag, plastic)));
root.addChild(node('handle', primitive(handle, blued)));
await save(doc, 'r22.glb');
