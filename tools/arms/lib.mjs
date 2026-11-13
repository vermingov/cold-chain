// What the arms scripts share: glTF-Transform and sharp, from the scratch install outside the repo
// (npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp fbx2gltf in ARMS_TOOLS).
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

export const TOOLS = process.env.ARMS_TOOLS || homedir() + '/.cache/cold-chain/wtools';
const require = createRequire(TOOLS + '/package.json');
export const { Document, NodeIO } = require('@gltf-transform/core');
export const { EXTTextureWebP, ALL_EXTENSIONS } = require('@gltf-transform/extensions');
export const fn = require('@gltf-transform/functions');
export const sharp = require('sharp');
export const OUT = new URL('../../assets/models/weapons/', import.meta.url).pathname;

export const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

// A WebP texture from a picture (a path or a sharp pipeline), `size` px square.
export async function texture(doc, name, img, size = 1024, quality = 88) {
    const pipe = typeof img === 'string' ? sharp(img) : img;
    const data = await pipe.resize(size, size, { fit: 'fill' }).webp({ quality }).toBuffer();
    return doc.createTexture(name).setImage(new Uint8Array(data)).setMimeType('image/webp');
}

// glTF's metallicRoughness picture: roughness in green, metalness in blue.
export function metalRough(rough, metal) {
    const img = (x) => (typeof x === 'string' ? sharp(x) : x);
    const g = img(rough).greyscale().toColourspace('b-w');
    return img(metal).greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true }).then(async (m) => {
        const r = await g.resize(m.info.width, m.info.height).raw().toBuffer();
        const out = Buffer.alloc(m.info.width * m.info.height * 3);
        for (let i = 0; i < m.info.width * m.info.height; i++) { out[i * 3] = 255; out[i * 3 + 1] = r[i]; out[i * 3 + 2] = m.data[i * m.info.channels]; }
        return sharp(out, { raw: { width: m.info.width, height: m.info.height, channels: 3 } });
    });
}

export async function save(doc, file) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
    await doc.transform(fn.prune(), fn.dedup());
    await io().write(OUT + file, doc);
}
