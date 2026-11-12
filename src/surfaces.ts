// What things are made of.
//
// Each surface is a photoscanned material from Poly Haven, fetched by
// tools/surfaces.sh: colour, normal and roughness maps. This loads them by
// name and hands out materials made of them. Materials are PBR with nothing
// but direct light: what no lamp and no moon reaches is dark.
//
// Every material is mottled: its colour drifts lighter and darker across the
// world in blotches metres wide (noise.js), so a wall is not one photograph
// repeated and no two headstones of the same stone are the same grey.

import * as BABYLON from '@babylonjs/core';
import { noiseTexture } from './noise.ts';

const GLSL_MOTTLE = `
#ifdef MOTTLE
// Laid in the world, and slanted so that a wall gets blotches too.
vec2 mottleAt = vPositionW.xz + vPositionW.y * vec2(0.83, 0.57);
float mottle = texture2D(mottleNoise, mottleAt / mottleDepth.y).r * 0.6 + texture2D(mottleNoise, mottleAt / (mottleDepth.y * 0.18)).g * 0.4;
surfaceAlbedo *= 1.0 + mottleDepth.x * (mottle * 2.0 - 1.0);
#endif
`;

// Makes a material's colour drift across the world: `depth` is how far
// (0.3 is plenty), `size` how many metres across the broad blotches are.
export class Mottle extends BABYLON.MaterialPluginBase {
    declare noise: any;
    declare depth: any;
    declare size: number;

    constructor(material, noise, depth, size = 17) {
        super(material, 'Mottle', 210, { MOTTLE: false });
        this.noise = noise;
        this.depth = depth;
        this.size = size;
        this._enable(true);
    }

    getClassName() { return 'Mottle'; }

    prepareDefines(defines) { defines.MOTTLE = true; }

    isReadyForSubMesh() { return this.noise.isReady(); }

    getSamplers(samplers) { samplers.push('mottleNoise'); }

    getUniforms() {
        return {
            ubo: [{ name: 'mottleDepth', size: 2, type: 'vec2' }],
            fragment: '#ifdef MOTTLE\nuniform vec2 mottleDepth;\n#endif',
        };
    }

    bindForSubMesh(ubo) {
        ubo.updateFloat2('mottleDepth', this.depth, this.size);
        ubo.setTexture('mottleNoise', this.noise);
    }

    getActiveTextures(textures) { textures.push(this.noise); }

    hasTexture(texture) { return texture === this.noise; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef MOTTLE\nuniform sampler2D mottleNoise;\n#endif',
            CUSTOM_FRAGMENT_UPDATE_ALBEDO: GLSL_MOTTLE,
        };
    }
}

export class Surfaces {
    declare scene: any;
    declare base: string;
    declare loaded: Map<any, any>;
    declare loading: Map<any, any>;
    declare materials: Map<any, any>;

    constructor(scene, base = 'assets/surfaces/') {
        this.scene = scene;
        this.base = base;
        this.loaded = new Map();        // name -> { albedo, normal, rough }
        this.loading = new Map();       // name -> the fetch of it
        this.materials = new Map();
    }

    _texture(url) {
        return new Promise((resolve, reject) => {
            const t = new BABYLON.Texture(url, this.scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => resolve(t), (msg) => reject(new Error(url + ': ' + msg)));
            t.anisotropicFilteringLevel = 8;
        });
    }

    // One fetch per surface, however many ask for it while it is under way.
    load(names) {
        return Promise.all(names.map((name) => {
            if (!this.loading.has(name)) {
                const dir = `${this.base}${name}/`;
                this.loading.set(name, Promise.all(['albedo', 'normal', 'rough'].map((m) => this._texture(dir + m + '.jpg')))
                    .then(([albedo, normal, rough]) => { this.loaded.set(name, { albedo, normal, rough }); }));
            }
            return this.loading.get(name);
        }));
    }

    maps(name) {
        const maps = this.loaded.get(name);
        if (!maps) throw new Error('surface not loaded: ' + name);
        return maps;
    }

    // A material of one surface. `rough` scales its roughness map, `tint`
    // its colour, `relief` its normal map (a polished stone has the grain
    // of the rough one and none of its dents), `mottle` is how far its
    // colour drifts (0 for none); the same surface asked for the same way is
    // the same material. Whoever means to fix something of their own to the
    // material says who they are in `own`, and gets one nobody else has.
    material(name, { rough = 1, tint = null, relief = 1, mottle = 0.28, own = '' } = {}) {
        const key = `${name}:${rough}:${tint}:${relief}:${mottle}:${own}`;
        if (this.materials.has(key)) return this.materials.get(key);
        const maps = this.maps(name);
        const m = new BABYLON.PBRMaterial('surf_' + key, this.scene);
        m.albedoTexture = maps.albedo;
        m.bumpTexture = relief === 1 ? maps.normal : Object.assign(maps.normal.clone(), { level: relief });
        // The maps are OpenGL-style and Babylon is left-handed.
        m.invertNormalMapX = true;
        m.metallic = 0;
        m.roughness = rough;
        m.metallicTexture = maps.rough;
        m.useRoughnessFromMetallicTextureGreen = true;
        m.useMetallnessFromMetallicTextureBlue = false;
        m.useRoughnessFromMetallicTextureAlpha = false;
        m.useAmbientOcclusionFromMetallicTextureRed = false;
        m.maxSimultaneousLights = 8;
        m.environmentIntensity = 0;
        m.specularIntensity = 0.6;
        if (tint) m.albedoColor = BABYLON.Color3.FromArray(tint);
        if (mottle) new Mottle(m, noiseTexture(this.scene), mottle);
        this.materials.set(key, m);
        return m;
    }
}
