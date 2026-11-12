// What is cut into the stones.
//
// Every headstone that still has a face carries the name the register gives
// its plot, and every iron marker in the public ground its row and number,
// which is all there is to find a pauper by. A thousand of them are painted
// once, small, into one sheet (the atlas), and each stone is told which
// square of the sheet is its own. The stone's material then lays that
// square on its face as the colour of the cut: dark where a mason's chisel
// went into sandstone, gilt on polished granite, white paint on iron.
//
// The years take letters off a soft stone in patches, and `wear` is how far
// that has gone for each.

import { MONTHS } from '../map/register.js';
import { noiseTexture } from '../noise.js';

// The sheet: so many squares across and down, each so many pixels.
const ATLAS = { size: 4096, across: 32, down: 36, cell: [128, 112] };
// A stone's panel is the shape of its square on the sheet.
const PANEL_SHAPE = ATLAS.cell[1] / ATLAS.cell[0];
const MARGIN = 7;

const FACES = [
    ['Fell', 'im-fell-english.woff2', {}],
    ['Fell', 'im-fell-english-italic.woff2', { style: 'italic' }],
    ['Fell Capitals', 'im-fell-english-sc.woff2', {}],
    ['Cinzel', 'cinzel-medium.woff2', {}],
];

// What a stone of each time says, as lines: [text, CSS font, pixels high].
const WORDING = {
    victorian: (p) => [
        ['In Memory of', 'italic 13px Fell', 14],
        [p.forename, '21px "Fell Capitals"', 21],
        [p.surname, '21px "Fell Capitals"', 21],
        [`died ${p.died.day} ${MONTHS[p.died.month]} ${p.died.year}`, '12px Fell', 14],
        [p.age < 2 ? 'an infant' : `aged ${p.age} years`, 'italic 12px Fell', 14],
    ],
    postwar: (p) => [
        ['IN LOVING MEMORY OF', '9px Cinzel', 15],
        [p.forename.toUpperCase(), '19px Cinzel', 21],
        [p.surname.toUpperCase(), '19px Cinzel', 21],
        [`${p.born} – ${p.died.year}`, '14px Cinzel', 20],
    ],
    lawn: (p) => [
        [p.forename.toUpperCase(), '20px Cinzel', 24],
        [p.surname.toUpperCase(), '20px Cinzel', 24],
        [`${p.born} – ${p.died.year}`, '15px Cinzel', 22],
    ],
    // A marker has no name on it: the ground, the row, and the number in the row.
    public: (p, plot) => [
        [`${plot.section} · ROW ${plot.row}`, 'bold 17px sans-serif', 26],
        [String(plot.number), 'bold 58px sans-serif', 60],
    ],
};

async function loadFaces(base) {
    const faces = FACES.map(([family, file, descriptors]) => new FontFace(family, `url(${base}${file})`, descriptors));
    for (const face of await Promise.all(faces.map((f) => f.load()))) document.fonts.add(face);
}

// One square: its lines, centred, each squeezed if it is too long to fit.
function paintCell(ctx, x, lines) {
    const [w, h] = ATLAS.cell;
    const tall = lines.reduce((sum, line) => sum + line[2], 0);
    let y = (h - tall) / 2;
    for (const [text, font, high] of lines) {
        ctx.font = font;
        const wide = ctx.measureText(text).width, room = w - 2 * MARGIN;
        ctx.save();
        ctx.translate(x + w / 2, y + high * 0.78);
        if (wide > room) ctx.scale(room / wide, 1);
        ctx.fillText(text, 0, 0);
        ctx.restore();
        y += high;
    }
}

// The atlas for a list of inscriptions, each { era, person, plot }; the
// square an inscription gets is its place in the list. `fonts` is where the
// typefaces are. The sheet is painted a row of squares at a time, because a
// canvas the size of the whole of it is a great deal of memory to hold twice.
export async function paintInscriptions(scene, inscriptions, fonts) {
    if (inscriptions.length > ATLAS.across * ATLAS.down) throw new Error(`${inscriptions.length} inscriptions and room for ${ATLAS.across * ATLAS.down}`);
    await loadFaces(fonts);
    const [w, h] = ATLAS.cell;
    const strip = document.createElement('canvas');
    strip.width = ATLAS.size;
    strip.height = h;
    const ctx = strip.getContext('2d', { willReadFrequently: true });
    ctx.textAlign = 'center';
    const sheet = new Uint8Array(ATLAS.size * ATLAS.size);
    for (let row = 0; row * ATLAS.across < inscriptions.length; row++) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, strip.width, h);
        ctx.fillStyle = '#fff';
        inscriptions.slice(row * ATLAS.across, (row + 1) * ATLAS.across)
            .forEach(({ era, person, plot }, i) => paintCell(ctx, i * w, WORDING[era](person, plot)));
        const pixels = ctx.getImageData(0, 0, strip.width, h).data;
        for (let i = 0, o = row * h * ATLAS.size; i < pixels.length; i += 4, o++) sheet[o] = pixels[i];
    }
    const tex = new BABYLON.RawTexture(sheet, ATLAS.size, ATLAS.size, BABYLON.Engine.TEXTUREFORMAT_R, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.name = 'inscriptions';
    tex.anisotropicFilteringLevel = 8;
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return tex;
}

const GLSL_VERTEX_DEFINITIONS = `
#ifdef INSCRIBED
attribute vec4 inscription;     // its square on the sheet, the panel's height up the stone, the panel's width, how worn
varying vec4 vInscription;
varying vec3 vOnSlab;           // where on the stone, and whether this is its face
#endif
`;

const GLSL_VERTEX = `
#ifdef INSCRIBED
vInscription = inscription;
vOnSlab = vec3(position.xy, normal.z);
#endif
`;

const GLSL_FRAGMENT_DEFINITIONS = `
#ifdef INSCRIBED
uniform sampler2D inscribedSheet;
uniform sampler2D inscribedNoise;
varying vec4 vInscription;
varying vec3 vOnSlab;
#endif
`;

// A stone faces +z, and seen from there x runs to the left, hence the
// turning round of both.
const GLSL_CUT = `
#ifdef INSCRIBED
if (vInscription.z > 0.0 && vOnSlab.z > 0.5) {
    vec2 onPanel = vec2(0.5 - vOnSlab.x / vInscription.z, 0.5 - (vOnSlab.y - vInscription.y) / (vInscription.z * inscribedSquare.z));
    if (onPanel.x > 0.0 && onPanel.x < 1.0 && onPanel.y > 0.0 && onPanel.y < 1.0) {
        float square = floor(vInscription.x + 0.5);
        vec2 onSheet = (vec2(mod(square, inscribedSquare.w), floor(square / inscribedSquare.w)) + onPanel) * inscribedSquare.xy;
        float cut = texture2D(inscribedSheet, onSheet).r;
        // Weather takes the letters in patches.
        float sound = texture2D(inscribedNoise, (vPositionW.xy + vPositionW.zz) / 0.9).g;
        cut *= smoothstep(vInscription.w * 1.1 - 0.25, vInscription.w * 1.1, sound + 0.001) * (1.0 - 0.4 * vInscription.w);
        surfaceAlbedo = mix(surfaceAlbedo, inscribedInk.rgb, cut * inscribedInk.a);
    }
}
#endif
`;

// Lays a stone's square of the sheet on its face. `ink` is the colour of
// the cut and how solid it is: [r, g, b, a], as light. The mesh it is used
// on must carry the `inscription` attribute, one for each stone.
export class Inscribed extends BABYLON.MaterialPluginBase {
    constructor(material, sheet, ink) {
        super(material, 'Inscribed', 220, { INSCRIBED: false });
        this.sheet = sheet;
        this.noise = noiseTexture(material.getScene());
        this.ink = ink;
        this._enable(true);
    }

    getClassName() { return 'Inscribed'; }

    prepareDefines(defines) { defines.INSCRIBED = true; }

    isReadyForSubMesh() { return this.sheet.isReady() && this.noise.isReady(); }

    getAttributes(attributes) { attributes.push('inscription'); }

    getSamplers(samplers) { samplers.push('inscribedSheet', 'inscribedNoise'); }

    getUniforms() {
        return {
            ubo: [{ name: 'inscribedSquare', size: 4, type: 'vec4' }, { name: 'inscribedInk', size: 4, type: 'vec4' }],
            fragment: '#ifdef INSCRIBED\nuniform vec4 inscribedSquare;\nuniform vec4 inscribedInk;\n#endif',
        };
    }

    bindForSubMesh(ubo) {
        // A square's size as a share of the sheet, its shape, and how many to a row.
        ubo.updateFloat4('inscribedSquare', ATLAS.cell[0] / ATLAS.size, ATLAS.cell[1] / ATLAS.size, PANEL_SHAPE, ATLAS.across);
        ubo.updateFloat4('inscribedInk', ...this.ink);
        ubo.setTexture('inscribedSheet', this.sheet);
        ubo.setTexture('inscribedNoise', this.noise);
    }

    getActiveTextures(textures) { textures.push(this.sheet, this.noise); }

    hasTexture(texture) { return texture === this.sheet || texture === this.noise; }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return { CUSTOM_VERTEX_DEFINITIONS: GLSL_VERTEX_DEFINITIONS, CUSTOM_VERTEX_MAIN_END: GLSL_VERTEX };
        return { CUSTOM_FRAGMENT_DEFINITIONS: GLSL_FRAGMENT_DEFINITIONS, CUSTOM_FRAGMENT_UPDATE_ALBEDO: GLSL_CUT };
    }
}
