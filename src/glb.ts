// Models made in the forge (tools/forge/models): glTF binaries in assets/models, loaded once per scene and put in
// the world as often as they are wanted.

import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const loaded = new WeakMap<BABYLON.Scene, Map<string, Promise<BABYLON.AssetContainer>>>();

// The model at `assets/models/<path>.glb` (e.g. 'props/phone'), loaded into `scene` once and kept: its meshes,
// materials and textures, not yet in the world.
export function glb(scene: BABYLON.Scene, path: string, base = ''): Promise<BABYLON.AssetContainer> {
    if (!loaded.has(scene)) loaded.set(scene, new Map());
    const mine = loaded.get(scene);
    if (!mine.has(path)) mine.set(path, BABYLON.LoadAssetContainerAsync(`${base}assets/models/${path}.glb`, scene));
    return mine.get(path);
}

// A copy of it in the world: its root, and each of its nodes by name (so parts that move can be found).
export async function place(scene: BABYLON.Scene, path: string, base = '') {
    const made = (await glb(scene, path, base)).instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
    const root = made.rootNodes[0] as BABYLON.TransformNode, parts = new Map<string, BABYLON.TransformNode>();
    for (const node of root.getDescendants(false)) parts.set(node.name, node as BABYLON.TransformNode);
    return { root, parts };
}
