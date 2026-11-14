// Desert Eagle Mark XIX .50 AE (6 inch barrel): SirDraco65's CC0 model (OpenGameArt) from FBX to GLB, scaled to the real
// gun's 273 mm (10.75 in) overall length; its 2K maps at 1K WebP (512 for the small parts), roughness and metalness
// packed into one texture, the baked bevel maps as normal maps. The armature (an animation rig with bones named like the
// meshes) is dropped, so the slide and magazine are found by name.
//   node tools/arms/deagle.mjs <the zip's Export dir>
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { TOOLS, io, texture, metalRough, save } from './lib.mjs';

const src = process.argv[2], tex = src + '/Textures/';
const work = mkdtempSync(tmpdir() + '/deagle-');
execFileSync(TOOLS + '/node_modules/fbx2gltf/bin/Linux/FBX2glTF', ['--binary', '--input', src + '/Desert Eagle.fbx', '--output', work + '/deagle']);
const doc = await io().read(work + '/deagle.glb');
const root = doc.getRoot();
for (const n of root.listNodes()) if (n.getName() === 'Armature') { const gone = [n]; while (gone.length) { const x = gone.pop(); gone.push(...x.listChildren()); x.dispose(); } }
for (const a of root.listAnimations()) a.dispose();
const top = root.listScenes()[0].listChildren()[0].setName('deagle');
top.setScale([0.0593, 0.0593, 0.0593]);     // 4.602 model units muzzle to beavertail = 273 mm

// Each material's own maps; the bevel bakes are the normal maps (Frame.png is the frame's).
const NORMAL = { Barrel: 'BarrelBevelBake.png', Accessories: 'Accessories Bevel Bake.png', Slide: 'Slide Bevel Bake.png', Frame: 'Frame.png',
    Grip: 'Grip Bevel Bake.png', Magazine: 'Magazine Bevel Bake.png', Bullets: 'Bullet Bevel Bake.png' };
const BIG = new Set(['Barrel', 'Slide', 'Frame']);
for (const mat of root.listMaterials()) {
    const name = mat.getName(), size = BIG.has(name) ? 1024 : 512, base = tex + `Desert Eagle 6_${name}_`;
    mat.setName('deagle_' + name.toLowerCase())
        .setBaseColorTexture(await texture(doc, `deagle_${name}_diff`, base + 'BaseColor.png', size))
        .setNormalTexture(await texture(doc, `deagle_${name}_nor_gl`, tex + NORMAL[name], size, 92))
        .setMetallicRoughnessTexture(await texture(doc, `deagle_${name}_rough_metal`, await metalRough(base + 'Roughness.png', base + 'Metallic.png'), size))
        .setOcclusionTexture(null).setMetallicFactor(1).setRoughnessFactor(1).setBaseColorFactor([1, 1, 1, 1]);
}
await save(doc, 'deagle.glb');
