// M4A1 carbine: nisu's CC0 model (OpenGameArt) from FBX to GLB, its 2K PBR maps at 1K WebP.
//   node tools/arms/m4.mjs <dir with M4A1.fbx and its M4A1_*.png>
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { TOOLS, io, texture, metalRough, save } from './lib.mjs';

const src = process.argv[2];
const work = mkdtempSync(tmpdir() + '/m4-');
execFileSync(TOOLS + '/node_modules/fbx2gltf/bin/Linux/FBX2glTF', ['--binary', '--input', src + '/M4A1.fbx', '--output', work + '/m4']);
const doc = await io().read(work + '/m4.glb');

const mat = doc.getRoot().listMaterials()[0].setName('m4a1');
mat.setBaseColorTexture(await texture(doc, 'm4a1_diff', src + '/M4A1_Base_Color.png'))
    .setNormalTexture(await texture(doc, 'm4a1_nor_gl', src + '/M4A1_Normal.png', 1024, 92))
    .setMetallicRoughnessTexture(await texture(doc, 'm4a1_rough_metal', await metalRough(src + '/M4A1_Roughness.png', src + '/M4A1_Metallic.png')))
    .setMetallicFactor(1).setRoughnessFactor(1).setBaseColorFactor([1, 1, 1, 1]);
doc.getRoot().listScenes()[0].listChildren()[0].setName('m4a1');
await save(doc, 'm4.glb');
