// Blood lying on skin: how thick it is at each place of the skin, and how
// wet it still is, kept in a sheet laid over the skin's own picture.
//
// Red is the film's thickness (to 0.6 mm: blood thicker than that on skin
// runs off), green how wet it still is. The skin's shader (FilmLayer, below)
// draws it as what it is: a layer of blood over the skin, which lets red
// through and stops green and blue, so a smear is bright red and a thick
// streak nearly black-red; glossy while it is wet, with its edges standing up
// off the skin to catch the light; going brown and dull as it dries. A thin
// film of blood on skin dries in five to ten minutes.

import * as BABYLON from '@babylonjs/core';
import { GLSL_BLOOD, sendCanvasPart } from './fluid.ts';

const SIZE = 2048;
const MOST_MM = 0.6;            // the thickest film the sheet holds
const DRIES = 420;              // seconds for a film's wetness to fall to a third
const SENDS = 0.12;             // seconds at least between sending the sheet to the card

// The sheet is painted the way up the card reads it (row 0 is v = 0), so that a part of it can be sent as it is.
export class Film {
    declare texture: BABYLON.DynamicTexture;
    declare g: CanvasRenderingContext2D;
    declare sent: number;
    declare clock: number;
    declare dried: number;
    declare painted: number;
    declare lines: Map<string, number[]>;
    declare dirty: number[] | null;
    declare used: number[] | null;

    constructor(scene: BABYLON.Scene, name: string) {
        this.texture = new BABYLON.DynamicTexture(name + '_film', { width: SIZE, height: SIZE }, scene, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
        this.texture.hasAlpha = false;
        this.texture.wrapU = this.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.g = this.texture.getContext() as CanvasRenderingContext2D;
        this.g.fillStyle = '#000';
        this.g.fillRect(0, 0, SIZE, SIZE);
        this.texture.update(false);
        this.sent = 0;
        this.clock = 0;
        this.dried = 0;
        this.painted = -Infinity;
        this.lines = new Map();
        this.dirty = null;
        this.used = null;
    }

    // The part of the sheet painted since it was last sent, and all of it ever painted (which is what dries).
    _touch(x0: number, y0: number, x1: number, y1: number) {
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(SIZE, Math.ceil(x1)); y1 = Math.min(SIZE, Math.ceil(y1));
        if (x1 <= x0 || y1 <= y0) return;
        for (const k of ['dirty', 'used']) {
            const r = this[k];
            this[k] = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
        }
        this.painted = this.clock;
    }

    // Blood laid along the skin from crossing `a` to crossing `b`: a streak `wide` metres across, `mm` thick down its
    // middle and thinner to its edges, as a stream's cross-section is rounded. Where blood already lies it is as thick
    // as the thicker of the two (a stream running again down its own track does not pile up), and wet again. Kept until
    // the frame's end and drawn with every other streak of the same width and thickness at once: taking the thicker is
    // the same in any order.
    stroke(a, b, wide: number, mm: number) {
        if (Math.hypot(a.uv[0] - b.uv[0], a.uv[1] - b.uv[1]) > 0.03) return;
        const w = Math.min(40, Math.max(1, wide * Math.min(3, a.scale) * SIZE));
        const x0 = a.uv[0] * SIZE, y0 = a.uv[1] * SIZE, x1 = b.uv[0] * SIZE, y1 = b.uv[1] * SIZE;
        for (const [k, share] of [[1, 0.4], [0.66, 0.72], [0.33, 1]]) {
            const key = Math.max(1, Math.round(w * k * 2) / 2) + '|' + Math.max(1, Math.min(255, Math.round((mm * share / MOST_MM) * 64) * 4));
            let list = this.lines.get(key);
            if (!list) this.lines.set(key, list = []);
            list.push(x0, y0, x1, y1);
        }
        this._touch(Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w);
    }

    // A patch of blood at `hit` about `r` metres across and `mm` thick: a drop's mark, or what a wound wells up. Its
    // edge is uneven, as blood stops where the skin's grain and hairs stop it.
    blot(hit, r: number, mm: number) {
        const g = this.g, x = hit.uv[0] * SIZE, y = hit.uv[1] * SIZE, R = Math.min(160, Math.max(0.8, r * Math.min(3, hit.scale) * SIZE));
        const lobes = 7 + Math.floor(Math.random() * 5), turn = Math.random() * 6.28;
        const offsets = Array.from({ length: lobes * 2 }, () => 0.78 + 0.32 * Math.random());
        const shape = (k) => {
            g.beginPath();
            for (let i = 0; i <= lobes * 2; i++) {
                const t = (i / (lobes * 2)) * Math.PI * 2 + turn, rr = R * k * offsets[i % (lobes * 2)];
                g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
            }
            g.fill();
        };
        g.globalCompositeOperation = 'lighten';
        for (const [k, share] of [[1, 0.45], [0.7, 0.75], [0.4, 1]]) {
            g.fillStyle = level(mm * share);
            shape(k);
        }
        g.globalCompositeOperation = 'source-over';
        this._touch(x - R * 1.2, y - R * 1.2, x + R * 1.2, y + R * 1.2);
    }

    // Each frame: the streaks laid this frame are drawn; the film dries a little (every few seconds, all of it at once,
    // for twenty minutes after the last blood came, after which it is dry); and what changed goes up to the card, not
    // oftener than SENDS, only the part of the sheet that changed.
    update(dt: number) {
        this.clock += dt;
        if (this.lines.size) {
            const g = this.g;
            g.lineCap = 'round';
            g.globalCompositeOperation = 'lighten';
            for (const [key, list] of this.lines) {
                const [w, r] = key.split('|');
                g.lineWidth = +w;
                g.strokeStyle = `rgb(${r},255,0)`;
                g.beginPath();
                for (let i = 0; i < list.length; i += 4) { g.moveTo(list[i], list[i + 1]); g.lineTo(list[i + 2], list[i + 3]); }
                g.stroke();
            }
            g.globalCompositeOperation = 'source-over';
            this.lines.clear();
        }
        if (this.used && this.clock - this.dried > 8 && this.clock - this.painted < DRIES * 3) {
            const k = Math.round(255 * Math.exp(-(this.clock - this.dried) / DRIES));
            this.dried = this.clock;
            const [x0, y0, x1, y1] = this.used;
            this.g.globalCompositeOperation = 'multiply';
            this.g.fillStyle = `rgb(255,${k},255)`;
            this.g.fillRect(x0, y0, x1 - x0, y1 - y0);
            this.g.globalCompositeOperation = 'source-over';
            this.dirty = this.dirty ? [Math.min(this.dirty[0], x0), Math.min(this.dirty[1], y0), Math.max(this.dirty[2], x1), Math.max(this.dirty[3], y1)] : [...this.used];
        }
        if (this.dirty && this.clock - this.sent > SENDS) {
            sendCanvasPart(this.texture, this.g.canvas as HTMLCanvasElement, this.dirty);
            this.dirty = null;
            this.sent = this.clock;
        }
    }

    dispose() { this.texture.dispose(); }
}

// A thickness as the sheet holds it (red), freshly wet (green).
function level(mm: number) {
    return `rgb(${Math.max(1, Math.min(255, Math.round((mm / MOST_MM) * 255)))},255,0)`;
}

// The skin drawn with the blood on it. After Gore (the wounds), so blood runs over a wound's lips.
export class FilmLayer extends BABYLON.MaterialPluginBase {
    declare film: Film;

    constructor(material: BABYLON.Material, film: Film) {
        super(material, 'Film', 228, { FILM: false });
        this.film = film;
        this._enable(true);
    }

    getClassName() { return 'FilmLayer'; }

    prepareDefines(defines) { defines.FILM = true; }

    getSamplers(samplers) { samplers.push('filmMap'); }

    getUniforms() { return { ubo: [{ name: 'filmTexel', size: 1, type: 'float' }] }; }

    bindForSubMesh(ubo) {
        ubo.updateFloat('filmTexel', 1 / SIZE);
        ubo.setTexture('filmMap', this.film.texture);
    }

    getActiveTextures(textures) { textures.push(this.film.texture); }

    hasTexture(texture) { return texture === this.film.texture; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef FILM\nuniform sampler2D filmMap;\n${GLSL_BLOOD}#endif\n`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef FILM
float filmGloss = 0.0;
{
    vec2 fu = vMainUV1;
    vec4 fm = texture2D(filmMap, fu);
    float fmm = fm.r * ${MOST_MM.toFixed(2)};
    if (fmm > 0.003) {
        // The film's edges stand off the skin: its surface bends with how its thickness changes across it.
        float fx = texture2D(filmMap, fu + vec2(filmTexel, 0.0)).r - texture2D(filmMap, fu - vec2(filmTexel, 0.0)).r;
        float fy = texture2D(filmMap, fu + vec2(0.0, filmTexel)).r - texture2D(filmMap, fu - vec2(0.0, filmTexel)).r;
        vec3 fp1 = dFdx(vPositionW), fp2 = dFdy(vPositionW);
        vec2 fu1 = dFdx(fu), fu2 = dFdy(fu);
        vec3 fn = normalW, fq2 = cross(fp2, fn), fq1 = cross(fn, fp1);
        vec3 ft = fq2 * fu1.x + fq1 * fu2.x, fb = fq2 * fu1.y + fq1 * fu2.y;
        float fs = inversesqrt(max(dot(ft, ft), dot(fb, fb)) + 1e-20);
        normalW = normalize(fn - (ft * fs * fx + fb * fs * fy) * 5.0 * fm.g);
        surfaceAlbedo = bloodOver(surfaceAlbedo, fmm, fm.g);
        filmGloss = smoothstep(0.003, 0.05, fmm) * mix(0.3, 1.0, fm.g);
    }
}
#endif
`,
            // Wet blood is as smooth as water; dried, a dull satin.
            '!(float diffuseRoughness=reflectivityOut\\.diffuseRoughness;)': `$1
#ifdef FILM
microSurface = mix(microSurface, 0.94, filmGloss);
roughness = 1.0 - microSurface;
#endif
`,
        };
    }
}
