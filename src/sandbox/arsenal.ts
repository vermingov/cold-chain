// The arsenal: a steel board on the west wall with one of everything there is to hold hung on it, lit from above.
// Look at a thing on it and press E to take it (weapons.take).

import * as BABYLON from '@babylonjs/core';
import { HALL } from './map.ts';
const V3 = BABYLON.Vector3;

// What hangs where: two rows, long guns over the rest, laid out along the wall from the south end.
const ROWS = [
    { y: 1.78, keys: ['rifle', 'shotgun', 'ak', 'm4'] },
    { y: 1.12, keys: ['pistol', 'knife', 'sword', 'bat', 'grenade', 'throw', 'bandage', 'medkit'] },
];
const WALL = { x: -HALL.x, z: -1.2, width: 7.2, height: 1.7, y: 1.45 };
const GAP = 0.28;
const BOX = 'cardboard_box_01';     // "Throw things" is shown by one of the things thrown
// Turned on the wall from how they are held: the medkit's cross and the bandage roll's side to the room.
const TURNED = { bandage: -Math.PI / 2, medkit: -Math.PI / 2 };

export async function buildArsenal(world, weapons) {
    const { scene, models } = world;
    const board = BABYLON.MeshBuilder.CreatePlane('arsenal', { width: WALL.width, height: WALL.height }, scene);
    board.rotation.y = -Math.PI / 2;
    board.position.set(WALL.x + 0.015, WALL.y, WALL.z);
    const steel = new BABYLON.PBRMaterial('arsenal', scene);
    steel.albedoColor = new BABYLON.Color3(0.16, 0.165, 0.17);
    steel.metallic = 0.6;
    steel.roughness = 0.55;
    board.material = steel;
    board.receiveShadows = true;
    board.metadata = { solid: true };
    board.freezeWorldMatrix();

    const lamp = new BABYLON.SpotLight('arsenalLamp', new V3(WALL.x + 1.6, 3.6, WALL.z), new V3(-0.55, -1, 0).normalize(), 2.1, 1.2, scene);
    lamp.falloffType = BABYLON.Light.FALLOFF_GLTF;
    lamp.intensity = 45;
    lamp.diffuse = new BABYLON.Color3(1, 0.95, 0.88);

    await models.prepare([BOX]);
    const hung = [];
    for (const row of ROWS) {
        const placed = [];
        for (const key of row.keys) {
            let node: BABYLON.TransformNode | null = null;
            if (key === 'throw') {
                const source = models.sources.get(BOX);
                if (source) node = source.createInstance('arsenal_throw');
            } else if (weapons.models.has(key)) {
                node = weapons.models.get(key).instantiateHierarchy(null, { doNotInstantiate: true });   // clones: the originals in the hand are switched off
                node.setEnabled(true);
            }
            if (!node) continue;
            node.parent = null;
            if (TURNED[key]) node.rotation.y = TURNED[key];
            node.position.setAll(0);
            node.computeWorldMatrix(true);
            placed.push({ key, node, ...node.getHierarchyBoundingVectors(true) });
        }
        // Side by side along the wall, centred on the board, each standing just off it.
        const width = placed.reduce((sum, p) => sum + (p.max.z - p.min.z), 0) + GAP * (placed.length - 1);
        let z = WALL.z - width / 2;
        for (const p of placed) {
            p.node.position.set(WALL.x + 0.03 - p.min.x, row.y - (p.min.y + p.max.y) / 2, z - p.min.z);
            z += p.max.z - p.min.z + GAP;
            const meshes = p.node instanceof BABYLON.AbstractMesh ? [p.node, ...p.node.getChildMeshes()] : p.node.getChildMeshes();
            // No shadow casters: the board is outside the cones of the lamps that cast shadows, and a shadow map draws
            // every caster on its list each frame, seen or not (35 meshes three times over).
            for (const mesh of meshes) {
                mesh.isPickable = true;
                mesh.metadata = { ...(mesh.metadata ?? {}), arsenal: p.key };
            }
            hung.push(p.key);
        }
    }
    // Light lies still on the board once it is hung.
    for (const mesh of scene.meshes) if (mesh.metadata?.arsenal) mesh.freezeWorldMatrix();

    return {
        hung,
        // The thing on the board the eye is on, within reach: its key, or null.
        look(eye: BABYLON.Vector3, ahead: BABYLON.Vector3) {
            const pick = scene.pickWithRay(new BABYLON.Ray(eye, ahead, 2.6), (m) => !!m.metadata?.arsenal);
            return pick?.hit ? pick.pickedMesh.metadata.arsenal : null;
        },
    };
}
