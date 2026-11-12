// The lining of the body: the inside of the wall, all the way round the
// trunk. It is what is seen past the organs, and what they lie in.
//
// It is the person's own triangles on the person's own bones, sunk a wall's
// thickness. In front, where the wall is tissue that can be cut, it is not
// drawn: there the deep sheet has an underside of its own (flesh.js).

import { noiseTexture } from '../noise.js';
import { WALL } from './field.js';
import { Hidden } from './hidden.js';

const SINK = WALL + 0.004;      // metres in from the skin
// A smooth wet skin of its own, pale, with fat lying behind it in drifts.
const LOOK = { colour: [0.6, 0.36, 0.3], rough: 0.36, wander: 0.25, drifts: 0.13 };

const GLSL_LINING = `
#ifdef LINING
surfaceAlbedo *= 1.0 + ${LOOK.wander.toFixed(2)} * (texture2D(liningNoise, (vPositionW.xz + vPositionW.y * vec2(0.8, 0.6)) / ${LOOK.drifts.toFixed(2)}).g * 2.0 - 1.0);
#endif
`;

class Lining extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'Lining', 230, { LINING: false });
        this.noise = noiseTexture(material.getScene());
        this._enable(true);
    }

    getClassName() { return 'Lining'; }

    prepareDefines(defines) { defines.LINING = true; }

    isReadyForSubMesh() { return this.noise.isReady(); }

    getSamplers(samplers) { samplers.push('liningNoise'); }

    bindForSubMesh(ubo) { ubo.setTexture('liningNoise', this.noise); }

    getActiveTextures(textures) { textures.push(this.noise); }

    hasTexture(texture) { return texture === this.noise; }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return { CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef LINING\npositionUpdated -= normalUpdated * ${SINK.toFixed(4)};\n#endif\n` };
        return { CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef LINING\nuniform sampler2D liningNoise;\n#endif\n', CUSTOM_FRAGMENT_UPDATE_ALBEDO: GLSL_LINING };
    }
}

export function lining(scene, person, field) {
    const { arrays } = person.lib.bodies.get(person.bodyName);
    const mesh = new BABYLON.Mesh(person.bodyName + 'Lining', scene);
    const data = new BABYLON.VertexData();
    data.positions = arrays.position;
    data.normals = arrays.normal;
    data.matricesIndices = Float32Array.from(arrays.joints);
    data.matricesWeights = Float32Array.from(arrays.weights, (w) => w / 255);
    data.indices = field.around;
    data.applyToMesh(mesh, false);
    mesh.parent = person.body;
    mesh.position.copyFrom(person.mesh.position);
    mesh.skeleton = person.skeleton;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;       // the skinned bounds lie
    mesh.isPickable = false;
    mesh.receiveShadows = true;

    const material = new BABYLON.PBRMaterial('lining', scene);
    material.albedoColor = BABYLON.Color3.FromArray(LOOK.colour).toLinearSpace();
    material.metallic = 0;
    material.roughness = LOOK.rough;
    material.specularIntensity = 0.4;
    material.environmentIntensity = 0;
    material.maxSimultaneousLights = 8;
    // It is looked at from inside.
    material.backFaceCulling = false;
    material.twoSidedLighting = true;
    new Lining(material);
    new Hidden(material, field, SINK);
    mesh.material = material;
    return mesh;
}
