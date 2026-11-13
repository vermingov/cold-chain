// What clothes and the skin under them show of wounds: a hole in a shirt
// where a bullet went through, blood soaked into the cloth, and the skin
// under the clothes, drawn only where a hole lets it be seen.
//
// All of it is kept in the person's rest space, which is what the mesh's own
// corners are in before the skeleton moves them, not in the clothes'
// picture: a pair of trousers may give both legs the same place in it.

import * as BABYLON from '@babylonjs/core';
import { GLSL_BLOOD } from './fluid.ts';
import { OVER, type Soak } from './soak.ts';

const MOST = 64;            // wounds (or holes in clothes) one person can have drawn

// Smooth noise over rest space, for the ragged edge of a stain.
const GLSL_NOISE = `
float hiderHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float hiderNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hiderHash(i), hiderHash(i + vec3(1, 0, 0)), f.x), mix(hiderHash(i + vec3(0, 1, 0)), hiderHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hiderHash(i + vec3(0, 0, 1)), hiderHash(i + vec3(1, 0, 1)), f.x), mix(hiderHash(i + vec3(0, 1, 1)), hiderHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export class Hider extends BABYLON.MaterialPluginBase {
    declare a: Float32Array;
    declare b: Float32Array;
    declare c: Float32Array;
    declare count: number;
    declare depth: number;
    declare reveal: boolean;
    declare windows: Float32Array;
    declare windowNormals: Float32Array;
    declare openings: number;
    declare field: Soak | null;

    // `depth` is how far either side of a wound's plane the person is not drawn (a little for skin; clothes stand off).
    constructor(material, depth = 0.025) {
        super(material, 'Hider', 230, { HIDER: false, HIDER_SOAK: false });
        this.a = new Float32Array(MOST * 4);
        this.b = new Float32Array(MOST * 4);
        this.c = new Float32Array(MOST * 4);
        this.count = 0;
        this.depth = depth;
        this.reveal = false;
        this.windows = new Float32Array(MOST * 4);
        this.windowNormals = new Float32Array(MOST * 4);
        this.openings = 0;
        this.field = null;
        this._enable(true);
    }

    getClassName() { return 'Hider'; }

    prepareDefines(defines) {
        defines.HIDER = this.reveal || this.count > 0 || !!this.field;
        defines.HIDER_SOAK = !!this.field;
    }

    // The blood in these clothes (soak.ts), drawn from now on.
    soaks(field: Soak) {
        this.field = field;
        this.markAllDefinesAsDirty();
    }

    // The other way round, for the skin under clothes: drawn only where a hole in the clothes over it lets it be seen,
    // a round window `radius` across at `at`, through clothes facing `n`.
    window(at: BABYLON.Vector3, n: BABYLON.Vector3, radius: number) {
        if (this.openings >= MOST) return;
        const k = this.openings++ * 4;
        this.windows.set([at.x, at.y, at.z, radius], k);
        this.windowNormals.set([n.x, n.y, n.z, 0.06], k);
        this.markAllDefinesAsDirty();
    }

    // An opening at `at` (rest space) running along `ex`, on skin facing `ey`: `half` is [half its length, half its
    // width]; [r, -1] is a frayed round hole in clothes.
    add({ at, ex, ey, half }) {
        if (this.count >= MOST) return false;
        const k = this.count++ * 4;
        this.a.set([at.x, at.y, at.z, half[0]], k);
        this.b.set([ex.x, ex.y, ex.z, half[1]], k);
        this.c.set([ey.x, ey.y, ey.z, this.depth], k);
        this.markAllDefinesAsDirty();
        return true;
    }

    get full() { return this.count >= MOST; }

    getUniforms() {
        return {
            // (Declared in the fragment's definitions below: a plugin's own `fragment` uniforms are only written into
            // the shader for materials that do not use a uniform buffer.)
            externalUniforms: ['hiderA', 'hiderB', 'hiderC', 'hiderCount', 'windowA', 'windowB', 'windowCount', 'hiderReveal', 'soakOrigin', 'soakScale'],
        };
    }

    getSamplers(samplers) { samplers.push('soakField'); }

    getActiveTextures(textures) { if (this.field) textures.push(this.field.texture); }

    hasTexture(texture) { return !!this.field && texture === this.field.texture; }

    bindForSubMesh(_ubo, _scene, _engine, subMesh) {
        const effect = subMesh.effect;
        if (!effect) return;
        if (this.field) {
            effect.setTexture('soakField', this.field.texture);
            effect.setVector3('soakOrigin', this.field.origin);
            effect.setVector3('soakScale', this.field.scale);
        }
        if (!this.count) return;
        effect.setFloatArray4('hiderA', this.a);
        effect.setFloatArray4('hiderB', this.b);
        effect.setFloatArray4('hiderC', this.c);
        effect.setFloat('hiderCount', this.count);
        effect.setFloatArray4('windowA', this.windows);
        effect.setFloatArray4('windowB', this.windowNormals);
        effect.setFloat('windowCount', this.openings);
        effect.setFloat('hiderReveal', this.reveal ? 1 : 0);
    }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') {
            return { CUSTOM_VERTEX_DEFINITIONS: '#ifdef HIDER\nvarying vec3 vHiderRest;\n#endif\n', CUSTOM_VERTEX_MAIN_BEGIN: '#ifdef HIDER\nvHiderRest = position;\n#endif\n' };
        }
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef HIDER\nvarying vec3 vHiderRest;\nuniform vec4 hiderA[${MOST}];\nuniform vec4 hiderB[${MOST}];\nuniform vec4 hiderC[${MOST}];\nuniform float hiderCount;\nuniform vec4 windowA[${MOST}];\nuniform vec4 windowB[${MOST}];\nuniform float windowCount;\nuniform float hiderReveal;\n${GLSL_NOISE}#endif\n#ifdef HIDER_SOAK\nuniform highp sampler3D soakField;\nuniform vec3 soakOrigin;\nuniform vec3 soakScale;\n${GLSL_BLOOD}#endif\n`,
            // Blood in the cloth (soak.ts): a stain whose edge is the weave's, red where a little has wicked in and dark
            // where the cloth is full, wet-dark and with a sheen where blood stands on it, drying brown with a darker
            // tide line at its edge. Round a bullet's hole in cloth, the fibres it dragged in are blackened (its wipe).
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef HIDER
float soakGloss = 0.0;
#ifdef HIDER_SOAK
{
    // The grid is 8 mm: read it a little off where this point is, by a smooth noise, so that a stain's edge wanders as
    // the weave makes it and does not follow the grid.
    vec3 sp = vHiderRest + (vec3(hiderNoise(vHiderRest * 55.0), hiderNoise(vHiderRest * 55.0 + 17.0), hiderNoise(vHiderRest * 55.0 + 31.0)) - 0.5) * 0.014;
    vec4 sk = texture(soakField, (sp - soakOrigin) * soakScale);
    float full = sk.r * sk.r * ${OVER.toFixed(2)};
    if (full > 0.002) {
        float n1 = hiderNoise(vHiderRest * 160.0), n2 = hiderNoise(vHiderRest * 420.0);
        // Where the cloth has drunk blood its fibres are full of it; past its edge they are dry. A little that reached a
        // dry patch (a mist, a fleck) shows as specks where fibres caught it.
        float cover = smoothstep(0.14, 0.26, full + (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.06);
        cover = max(cover, step(1.0 - full * 3.0, n2) * smoothstep(0.004, 0.03, full));
        float wet = sk.g;
        float mm = clamp(full, 0.15, 1.0) * 0.55 * (0.8 + 0.4 * n1);
        vec3 stained = bloodOver(surfaceAlbedo * mix(1.0, 0.8, wet), mm, wet);
        // Drying, blood is drawn to the edge of the stain and leaves it darker there (a tide line).
        float rim = smoothstep(0.14, 0.2, full) * (1.0 - smoothstep(0.22, 0.4, full)) * (1.0 - wet);
        stained = mix(stained, bloodOver(surfaceAlbedo, mm + 0.3, 0.0), rim * 0.7);
        surfaceAlbedo = mix(surfaceAlbedo, stained, cover);
        soakGloss = cover * smoothstep(1.0, 1.25, full) * wet;
    }
}
#endif
float scorched = 0.0;
for (int i = 0; i < ${MOST}; i++) {
    if (float(i) >= hiderCount) break;
    if (hiderB[i].w >= 0.0) continue;
    vec3 d = vHiderRest - hiderA[i].xyz;
    float r = length(d - hiderC[i].xyz * dot(d, hiderC[i].xyz)) / hiderA[i].w;
    scorched = max(scorched, 1.0 - smoothstep(1.0, 1.35, r));
}
surfaceAlbedo = mix(surfaceAlbedo, vec3(0.02, 0.012, 0.01), scorched * 0.85);
#endif
`,
            '!(float roughness=reflectivityOut\\.roughness;)': `$1
#ifdef HIDER_SOAK
microSurface = mix(microSurface, 0.6, soakGloss);
roughness = 1.0 - microSurface;
#endif
`,
            CUSTOM_FRAGMENT_MAIN_BEGIN: `
#ifdef HIDER
if (hiderReveal > 0.5) {
    bool seen = false;
    for (int i = 0; i < ${MOST}; i++) {
        if (float(i) >= windowCount) break;
        vec3 d = vHiderRest - windowA[i].xyz;
        if (abs(dot(d, windowB[i].xyz)) < windowB[i].w && length(d - windowB[i].xyz * dot(d, windowB[i].xyz)) < windowA[i].w) { seen = true; break; }
    }
    if (!seen) discard;
}
for (int i = 0; i < ${MOST}; i++) {
    if (float(i) >= hiderCount) break;
    vec3 d = vHiderRest - hiderA[i].xyz, across = cross(hiderB[i].xyz, hiderC[i].xyz);
    if (abs(dot(d, hiderC[i].xyz)) >= hiderC[i].w) continue;
    vec2 onPlane = vec2(dot(d, hiderB[i].xyz), dot(d, across));
    // A wound: a slot A.w long either way and B.w wide, round at its ends (a round hole when the two are equal).
    // A hole in clothes (a width below nothing): round, with a frayed edge.
    if (hiderB[i].w < 0.0) { float a = atan(onPlane.y, onPlane.x); if (length(onPlane) < hiderA[i].w * (0.8 + 0.25 * sin(a * 7.0 + hiderA[i].x * 900.0) * sin(a * 3.0))) discard; }
    else if (length(vec2(max(abs(onPlane.x) - (hiderA[i].w - hiderB[i].w), 0.0), onPlane.y)) < hiderB[i].w) discard;
}
#endif
`,
        };
    }
}
