// The grass itself.
//
// A scan of a lawn is a photograph laid on the floor, and a torch held at
// the hip shows it up for one: nothing in it stands. So the ground round
// the player is planted with real blades, some thousands of tufts of them,
// each blade two slivers of triangle that lean and taper.
//
// They are not planted across the cemetery. One square of tufts is made,
// and the shader lays it as a tiling of the whole world and draws only the
// tile round the eye: walk, and the tufts that fall off the back of the
// square turn up at the front, in the same places they will always be. How
// tall a tuft stands is read from the ground's own mask where it comes
// down: nothing on a path, short on a mown lawn, long where nobody mows.

import * as BABYLON from '@babylonjs/core';
import { HEIGHT_GLSL, PATHS } from '../map/plan.ts';
import { makeRng } from '../rng.ts';
import { HOLE, LAND } from './ground.ts';

const PATCH = 36;               // metres square of grass, always round the eye
const TUFTS = 13000;
const BLADES = 7;               // to a tuft
const MOWN = 0.36;              // how tall a mown blade is, against one left alone
// What a blade is made of, as light: winter green, and straw where it has died back.
const GREEN = [0.1, 0.14, 0.04], STRAW = [0.22, 0.19, 0.085];

const GLSL_VERTEX_DEFINITIONS = `
#ifdef GRASSFIELD
attribute vec2 grassRoot;       // where in the square this blade's tuft is
uniform sampler2D grassMask;
${HEIGHT_GLSL}
#endif
`;

const GLSL_PLANT = `
#ifdef GRASSFIELD
// The repeat of the square that is nearest the eye.
vec2 grassAt = grassEye.xz + mod(grassRoot - grassEye.xz, grassPatch.x) - grassPatch.x * 0.5;
// Gravel, mud, left to grow, under a tree.
vec4 grassPaint = texture2D(grassMask, (grassAt - grassLand.xy) / grassLand.z);
float grassTall = (1.0 - smoothstep(0.2, 0.55, max(grassPaint.r, grassPaint.g))) * mix(grassPatch.y, 1.0, grassPaint.b) * (1.0 - 0.5 * grassPaint.a);
// None on the road, and thinning to nothing at the edge of what is drawn.
grassTall *= step(grassRoad.y, abs(grassAt.y - grassRoad.x));
// Nor in an open grave, nor on the turf cut off round it.
grassTall *= 1.0 - float(all(greaterThan(grassAt, grassHole.xy - 0.12)) && all(lessThan(grassAt, grassHole.zw + 0.12)));
grassTall *= 1.0 - smoothstep(grassPatch.x * 0.34, grassPatch.x * 0.48, distance(grassAt, grassEye.xz));
float grassSpread = min(1.0, grassTall * 3.0);
vec3 grassBlade = position * vec3(grassSpread, grassTall, grassSpread);
// What air there is moves the tips.
grassBlade.xz += vec2(sin(grassEye.w * 0.9 + grassAt.x * 0.7), cos(grassEye.w * 0.7 + grassAt.y * 0.6)) * 0.12 * grassBlade.y * grassBlade.y;
positionUpdated = vec3(grassAt.x, heightAt(grassAt), grassAt.y) + grassBlade;
#endif
`;

class GrassField extends BABYLON.MaterialPluginBase {
    declare mask: any;
    declare road: { id: string; width: number; points: number[][]; };

    constructor(material, mask) {
        super(material, 'GrassField', 230, { GRASSFIELD: false });
        this.mask = mask;
        this.road = PATHS.find((p) => p.id === 'road');
        this._enable(true);
    }

    getClassName() { return 'GrassField'; }

    prepareDefines(defines) { defines.GRASSFIELD = true; }

    isReadyForSubMesh() { return this.mask.isReady(); }

    getAttributes(attributes) { attributes.push('grassRoot'); }

    getSamplers(samplers) { samplers.push('grassMask'); }

    getUniforms() {
        return {
            ubo: [{ name: 'grassEye', size: 4, type: 'vec4' }, { name: 'grassPatch', size: 2, type: 'vec2' },
                { name: 'grassLand', size: 3, type: 'vec3' }, { name: 'grassRoad', size: 2, type: 'vec2' }, { name: 'grassHole', size: 4, type: 'vec4' }],
            vertex: '#ifdef GRASSFIELD\nuniform vec4 grassEye;\nuniform vec2 grassPatch;\nuniform vec3 grassLand;\nuniform vec2 grassRoad;\nuniform vec4 grassHole;\n#endif',
        };
    }

    bindForSubMesh(ubo, scene) {
        const eye = scene.activeCamera.globalPosition;
        // Where the eye is, and in the fourth place what time it is.
        ubo.updateFloat4('grassEye', eye.x, eye.y, eye.z, performance.now() / 1000);
        ubo.updateFloat2('grassPatch', PATCH, MOWN);
        ubo.updateFloat3('grassLand', LAND.x0, LAND.z0, LAND.size);
        ubo.updateFloat2('grassRoad', this.road.points[0][1], this.road.width / 2 + 0.6);
        ubo.updateFloat4('grassHole', ...HOLE);
        ubo.setTexture('grassMask', this.mask);
    }

    getActiveTextures(textures) { textures.push(this.mask); }

    hasTexture(texture) { return texture === this.mask; }

    getCustomCode(shaderType) {
        if (shaderType !== 'vertex') return null;
        return { CUSTOM_VERTEX_DEFINITIONS: GLSL_VERTEX_DEFINITIONS, CUSTOM_VERTEX_UPDATE_POSITION: GLSL_PLANT };
    }
}

// One blade into the arrays: a base, a waist and a tip, leaning one way.
// `at` is its foot within the tuft, `facing` the way its flat looks.
function blade(out, rng, root, at, colour) {
    // Most blades are short and a few are long, as in any grass.
    const facing = rng() * Math.PI * 2, height = 0.08 + rng() ** 2.2 * 0.3, width = 0.011 + rng() * 0.009, lean = (0.15 + rng() * 0.5) * height;
    const flat = [Math.cos(facing), Math.sin(facing)], side = [-flat[1], flat[0]];
    // Up the blade: how far up, how far over, how wide, how bright.
    const stations = [[0, 0, 1, 0.45], [0.55, 0.3, 0.72, 0.85], [1, 1, 0.08, 1.15]];
    const first = out.positions.length / 3;
    for (const [up, over, wide, bright] of stations) {
        for (const s of [-1, 1]) {
            out.positions.push(at[0] + flat[0] * lean * over + side[0] * s * width * wide / 2, height * up,
                at[1] + flat[1] * lean * over + side[1] * s * width * wide / 2);
            // Lit as something standing that also takes light from above, like the ground it is in.
            out.normals.push(flat[0] * 0.55, 0.83, flat[1] * 0.55);
            out.roots.push(root[0], root[1]);
            out.colors.push(colour[0] * bright, colour[1] * bright, colour[2] * bright, 1);
        }
    }
    for (const i of [0, 2]) out.indices.push(first + i, first + i + 1, first + i + 2, first + i + 1, first + i + 3, first + i + 2);
}

// The square of tufts, as one mesh that the shader plants. `mask` is the
// ground's own (ground.js), so grass and ground agree about where a path is.
export function buildGrass(scene, mask) {
    const rng = makeRng(2203);
    const out = { positions: [], normals: [], roots: [], colors: [], indices: [] };
    for (let t = 0; t < TUFTS; t++) {
        const root = [rng() * PATCH, rng() * PATCH], dead = rng();
        const colour = GREEN.map((g, c) => (g + (STRAW[c] - g) * dead) * (0.75 + rng() * 0.5));
        for (let b = 0; b < BLADES; b++) blade(out, rng, root, [(rng() - 0.5) * 0.16, (rng() - 0.5) * 0.16], colour);
    }

    const mesh = new BABYLON.Mesh('grass', scene);
    const data = new BABYLON.VertexData();
    data.positions = out.positions;
    data.normals = out.normals;
    data.colors = out.colors;
    data.indices = out.indices;
    data.applyToMesh(mesh);
    mesh.setVerticesBuffer(new BABYLON.VertexBuffer(scene.getEngine(), out.roots, 'grassRoot', false, false, 2));

    const material = new BABYLON.PBRMaterial('grass', scene);
    material.albedoColor = BABYLON.Color3.White();      // the blades carry their own colour
    material.metallic = 0;
    material.roughness = 0.8;
    material.specularIntensity = 0.35;
    material.environmentIntensity = 0;
    material.maxSimultaneousLights = 8;
    material.backFaceCulling = false;
    material.twoSidedLighting = true;
    new GrassField(material, mask);
    mesh.material = material;

    // Where the blades are is decided in the shader, so nothing the engine
    // knows about the mesh says whether it is in view.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.hasVertexAlpha = false;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
}
