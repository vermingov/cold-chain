// Hidden: a body's own mesh, not drawn where tissue has taken its place.
//
// The front of a body that can be cut is tissue (tissue.js), and whatever
// of the person was there before, the skin and the lining under it, must
// not be drawn there as well. This is the plugin that leaves it out.

import { EDGE, HEIGHT_PX } from './field.js';

const GLSL_HIDDEN = `
#ifdef HIDDEN
// Where on the skin this is under, for a mesh that lies in from the skin.
vec2 hiddenOver = vPositionW.xz + normalize(vNormalW).xz * hiddenSunk;
vec2 hiddenAt = vec2(dot(vec3(hiddenOver, 1.0), hiddenU), dot(vec3(hiddenOver, 1.0), hiddenV));
// Only its front, and only where the tissue is: the tissue's edge is fixed
// to the body a little further out than this, so where the two meet nothing moves.
if (vNormalW.y > 0.1 && hiddenAt.x > 0.0 && hiddenAt.x < 1.0 && hiddenAt.y > 0.0 && hiddenAt.y < 1.0
    && texture2D(hiddenCover, hiddenAt).r * ${(255 / 16 * HEIGHT_PX).toFixed(5)} > ${EDGE.skin.toFixed(4)}) discard;
#endif
`;

export class Hidden extends BABYLON.MaterialPluginBase {
    // `sunk` is how far in from the skin the mesh lies, in metres, for one that is not the skin itself.
    constructor(material, field, sunk = 0) {
        super(material, 'Hidden', 240, { HIDDEN: false });
        this.field = field;
        this.sunk = sunk;
        this._enable(true);
    }

    getClassName() { return 'Hidden'; }

    prepareDefines(defines) { defines.HIDDEN = true; }

    isReadyForSubMesh() { return this.field.cover.isReady(); }

    getSamplers(samplers) { samplers.push('hiddenCover'); }

    getUniforms() {
        return {
            ubo: [{ name: 'hiddenU', size: 3, type: 'vec3' }, { name: 'hiddenV', size: 3, type: 'vec3' }, { name: 'hiddenSunk', size: 1, type: 'float' }],
            fragment: '#ifdef HIDDEN\nuniform vec3 hiddenU;\nuniform vec3 hiddenV;\nuniform float hiddenSunk;\n#endif',
        };
    }

    bindForSubMesh(ubo) {
        const { u, v } = this.field.rows;
        ubo.updateFloat3('hiddenU', ...u);
        ubo.updateFloat3('hiddenV', ...v);
        ubo.updateFloat('hiddenSunk', this.sunk);
        ubo.setTexture('hiddenCover', this.field.cover);
    }

    getActiveTextures(textures) { textures.push(this.field.cover); }

    hasTexture(texture) { return texture === this.field.cover; }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return null;
        return { CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef HIDDEN\nuniform sampler2D hiddenCover;\n#endif\n', CUSTOM_FRAGMENT_UPDATE_ALBEDO: GLSL_HIDDEN };
    }
}
