// Light baked offline (tools/forge): what a place sends out to be baked, and what comes back.
//
// A place built here is sent to Blender as it is: each mesh that is to be
// lit by the bake, in the world, with roughly what colour it is (so light
// bouncing off a wall comes back the colour of the wall), and the lights.
// Cycles lays a second set of coordinates over all of them, one picture for
// the lot, and bakes into it all the light that falls on them, straight
// from the lamps and bounced off everything else: the soft shadows in the
// corners, the glow of the street lamp on the ceiling, the warmth of a
// lampshade on the paper. Back here, each mesh takes its coordinates and the
// picture, and the lamps stop lighting those meshes themselves, but for the
// shine off them.
//
// Brightness. A light of intensity I here lights a surface d metres off by
// I / d²; in Cycles a point light of P watts gives a diffuse pass of
// P / (4π² d²). So a lamp goes to Blender as 4πI watts and the pass comes
// back multiplied by π (tools/forge/bake.py).

const V3 = BABYLON.Vector3;
// The picture holds light up to this many times "lit" (1): kept in eight bits, sRGB-encoded so the dark end, where
// all of a night is, keeps its steps.
export const RANGE = 4;

// What `meshes` and `lights` are, for Blender: { meshes: [{ name, positions, indices, colour }], lights: [...] }.
export async function describe(meshes, lights) {
    const out = [];
    for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const local = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind), facing = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
        const world = mesh.getWorldMatrix(), positions = [], normals = [], p = new V3();
        for (let i = 0; i < local.length; i += 3) {
            V3.TransformCoordinatesFromFloatsToRef(local[i], local[i + 1], local[i + 2], world, p);
            positions.push(p.x, p.y, p.z);
            V3.TransformNormalFromFloatsToRef(facing[i], facing[i + 1], facing[i + 2], world, p);
            p.normalize();
            normals.push(p.x, p.y, p.z);
        }
        out.push({ name: mesh.name, positions, normals, indices: [...mesh.getIndices()], colour: await albedo(mesh.material) });
    }
    return {
        meshes: out,
        lights: lights.map((light) => ({
            kind: light instanceof BABYLON.SpotLight ? 'spot' : light instanceof BABYLON.HemisphericLight ? 'sky' : 'point',
            position: light.position?.asArray(), direction: light.direction?.asArray(), angle: light.angle,
            colour: light.diffuse.asArray(), intensity: light.intensity, range: light.range,
        })),
    };
}

// Roughly what colour a material is: its colour times the average of its picture, if it has one.
async function albedo(material) {
    const tint = (material.albedoColor || material.diffuseColor || BABYLON.Color3.White()).asArray();
    const url = material.albedoTexture?.url || material.diffuseTexture?.url;
    if (!url) return tint;
    const image = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(16, 16), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data, mean = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += (data[i + c] / 255) ** 2.2 / 256;
    return tint.map((t, c) => t * mean[c]);
}

// Put a bake on the meshes it was made for (by name), if there is one at `base` (base.json, base.png). The lamps
// named in `lamps` go on giving those meshes their shine, and no longer their light. Resolves to whether there was.
export async function lay(scene, meshes, lamps, base) {
    const res = await fetch(base + '.json');
    if (!res.ok) return false;
    const baked = await res.json(), picture = new BABYLON.Texture(base + '.png', scene, false, false);
    picture.coordinatesIndex = 1;
    picture.level = RANGE;
    // (Every mesh on a material that reads the picture has to have been baked: the place sends them all.)
    for (const mesh of meshes) {
        const uv2 = baked.uv2[mesh.name];
        if (!uv2) continue;
        mesh.setVerticesData(BABYLON.VertexBuffer.UV2Kind, uv2);
        mesh.material.lightmapTexture = picture;
    }
    for (const lamp of lamps) lamp.lightmapMode = BABYLON.Light.LIGHTMAP_SPECULAR;
    return true;
}
