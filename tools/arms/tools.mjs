// The shovel, the sledgehammer and the claw hammer: Poly Haven's CC0 models (1k glTF downloads, real size already),
// repacked as GLB with WebP textures.
//   node tools/arms/tools.mjs <weapons-src dir with shovel/, sledge/ and hammer/ as tools/... ph-get.py fetched them>
import { io, fn, sharp, save } from './lib.mjs';

const src = process.argv[2];
const MODELS = { shovel: 'shovel/rusted_spade_01_1k.gltf', sledge: 'sledge/sledgehammer_01_1k.gltf', hammer: 'hammer/wooden_hammer_01_1k.gltf' };
for (const [name, file] of Object.entries(MODELS)) {
    const doc = await io().read(`${src}/${file}`);
    await doc.transform(
        fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], slots: /^(?!normalTexture).*$/, quality: 85 }),
        fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], slots: /^normalTexture$/, quality: 90 }),
    );
    await save(doc, name + '.glb');
}
