// What a wound looks like from outside: painted into a sheet laid over the
// person's own skin and clothes in their texture space (Babylon's decal map),
// so it moves with every bend of the body and costs nothing to draw.
//
// Sizes are real: each mark is painted at the size of the thing that made it,
// using how many texture units a metre of skin takes up where it landed.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

const SIZE = 2048;

export class Marks {
    declare skin: BABYLON.DynamicTexture;
    declare cloth: BABYLON.DynamicTexture;
    declare depth: BABYLON.DynamicTexture;
    declare _dirty: Set<BABYLON.DynamicTexture>;
    declare _soaked: Map<any, number>;
    declare _old: boolean;
    declare npc: any;
    declare stains: { at: BABYLON.Vector3; n: BABYLON.Vector3; litres: number; radius: number; i: number }[];
    declare _frames: number;
    declare _flush: BABYLON.Observer<BABYLON.Scene>;
    declare scene: BABYLON.Scene;

    constructor(scene, npc) {
        this.scene = scene;
        this._dirty = new Set();
        this._soaked = new Map();
        this._frames = 0;
        this.npc = npc;
        this.stains = [];
        const sheet = (name, mesh) => {
            const t = new BABYLON.DynamicTexture(name, { width: SIZE, height: SIZE }, scene, true);
            t.hasAlpha = true;
            t.getContext().clearRect(0, 0, SIZE, SIZE);
            t.update();
            (mesh as any).decalMap = { texture: t, isReady: () => true, dispose() {} };
            for (const m of (mesh.material as BABYLON.MultiMaterial).subMaterials) {
                if (m && /person_(skin|cloth)/.test(m.name)) {
                    const decal = (m as any).decalMap;
                    if (decal) decal.isEnabled = true;
                }
            }
            return t;
        };
        this.skin = sheet(npc.person.mesh.name + '_wounds', npc.person.mesh);
        // How deep the flesh is open at each place of the skin (red, to 4 cm), and how much blood lies in it (green):
        // what Gore draws as wounds.
        this.depth = new BABYLON.DynamicTexture(npc.person.mesh.name + '_depth', { width: SIZE, height: SIZE }, scene, false);
        this.depth.hasAlpha = false;
        this.depth.wrapU = this.depth.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        const dg = this.depth.getContext() as CanvasRenderingContext2D;
        dg.fillStyle = '#000';
        dg.fillRect(0, 0, SIZE, SIZE);
        this.depth.update();
        this.cloth = sheet(npc.person.mesh.name + '_stains', npc.clothes);
        // Painted marks go up to the card once a frame, however many were painted.
        this._flush = scene.onBeforeRenderObservable.add(() => {
            if (++this._frames % 600 === 0) this.age();
            for (const t of this._dirty) t.update();
            this._dirty.clear();
        });
    }

    _paint(hit, draw) {
        const t = hit.kind === 'cloth' ? this.cloth : this.skin;
        const g = t.getContext() as CanvasRenderingContext2D;
        const x = hit.uv[0] * SIZE, y = (1 - hit.uv[1]) * SIZE;
        const px = (metres) => Math.max(1, metres * hit.scale * SIZE);
        g.save();
        draw(g, x, y, px);
        g.restore();
        this._dirty.add(t);
    }

    // Where something went through: `size` across in metres, `out` for the way out (torn, bigger, everted).
    hole(hit, size, out, ring = true) {
        this._paint(hit, (g, x, y, px) => {
            const r = px(size / 2);
            if (hit.kind === 'cloth') {
                ragged(g, x, y, r * (out ? 1.4 : 1.1), 'rgba(8,6,6,0.97)', out ? 0.45 : 0.25);
                return;
            }
            // Round a bullet's way into skin, a ring about a millimetre wide that it scraped going in: red-brown, drying
            // darker. A way out has none, and nor, often, has a rifle's way in (dev/research/wounds.md).
            if (out || !ring) return;
            const hole = px(Math.max(0.0018, size * 0.25)), band = px(0.0011);
            soft(g, x, y, hole + band * 1.6, 'rgba(120,52,38,0.85)');
            soft(g, x, y, hole + band * 0.6, 'rgba(95,30,24,0.9)');
        });
    }

    // --- wounds, as depth in the flesh (Gore below draws them) -----------------------------------

    _open(hit, draw) {
        const g = this.depth.getContext() as CanvasRenderingContext2D;
        const x = hit.uv[0] * SIZE, y = (1 - hit.uv[1]) * SIZE;
        const px = (metres) => Math.max(1, metres * hit.scale * SIZE);
        g.save();
        g.globalCompositeOperation = 'lighten';
        draw(g, x, y, px);
        g.restore();
        this._dirty.add(this.depth);
    }

    // A bullet's way into skin: a round hole as wide as the skin let it be (a little under the bullet), its walls
    // steep, its track going down out of sight and filling with blood.
    entry(hit, size) {
        this._open(hit, (g, x, y, px) => {
            // Skin is elastic: a 9 mm bullet leaves a hole of 3 to 6 mm (dev/research/wounds.md).
            const r = px(Math.max(0.0017, size * 0.26));
            const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.15);
            grad.addColorStop(0, 'rgb(240,240,0)');
            grad.addColorStop(0.55, 'rgb(225,230,0)');
            grad.addColorStop(0.8, 'rgb(60,200,0)');
            grad.addColorStop(1, 'rgb(0,0,0)');
            g.fillStyle = grad;
            g.beginPath(); g.arc(x, y, r * 1.15, 0, Math.PI * 2); g.fill();
        });
    }

    // A bullet's way out: torn, not punched, ragged and wider, with splits running out of it.
    // Torn rather than punched: a slit, a star of three or four splits, or a crescent, the splits tapering to
    // nothing at their ends (dev/research/wounds.md), with a ragged opening where they meet.
    exit(hit, size) {
        this._open(hit, (g, x, y, px) => {
            const r = px(size * 0.5), arms = 2 + Math.floor(Math.random() * 3), turn = Math.random() * Math.PI;
            g.filter = 'blur(1px)';
            g.lineCap = 'round';
            for (let k = 0; k < arms; k++) {
                const a = turn + (k / arms) * Math.PI * 2 + (Math.random() - 0.5) * 0.7, reach = r * (0.8 + Math.random() * 0.7);
                const bend = (Math.random() - 0.5) * 0.6;
                // Each split drawn as strokes narrowing from the middle out, deepest along its line.
                for (let s = 0; s < 6; s++) {
                    const t0 = s / 6, t1 = (s + 1) / 6, w = r * 0.32 * (1 - t0);
                    const p = (t) => [x + Math.cos(a + bend * t) * reach * t, y + Math.sin(a + bend * t) * reach * t];
                    g.lineWidth = Math.max(1, w);
                    g.strokeStyle = `rgb(${Math.round(200 * (1 - t0 * 0.6))},230,0)`;
                    g.beginPath(); g.moveTo(...p(t0)); g.lineTo(...p(t1)); g.stroke();
                }
            }
            const grad = g.createRadialGradient(x, y, 0, x, y, r * 0.45);
            grad.addColorStop(0, 'rgb(230,240,0)');
            grad.addColorStop(1, 'rgb(0,0,0)');
            g.fillStyle = grad;
            g.beginPath(); g.arc(x, y, r * 0.45, 0, Math.PI * 2); g.fill();
        });
    }

    // A blade's way in: a slit up to 2 mm shorter than the blade is wide, gaping a little, deep in the middle.
    stab(hit, wide, turn = Math.random() * Math.PI) {
        this._open(hit, (g, x, y, px) => {
            const half = px(Math.max(0.004, wide - 0.002) / 2), dx = Math.cos(turn) * half, dy = Math.sin(turn) * half;
            g.lineCap = 'round';
            for (const [w, c] of [[px(0.005), 'rgb(70,60,0)'], [px(0.0028), 'rgb(170,140,0)'], [px(0.0012), 'rgb(250,200,0)']]) {
                g.lineWidth = w; g.strokeStyle = c;
                g.beginPath(); g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy); g.stroke();
            }
        });
    }

    // A blade drawn through the skin from `a` to `b`, `deep` metres into the flesh: a slot that gapes as the skin
    // either side pulls back, shallow at its lips and deepest along its middle, so the fat shows down its sides.
    // `gapes` is how much of its full gape this stretch opens (a cut gapes most in its middle).
    cut(a, b, deep, gapes = 1) {
        if (Math.hypot(a.uv[0] - b.uv[0], a.uv[1] - b.uv[1]) > 0.04) return;
        const most = Math.min(1, deep / 0.04);
        this._open(a, (g, x, y, px) => {
            const x2 = b.uv[0] * SIZE, y2 = (1 - b.uv[1]) * SIZE, gape = Math.min(0.009, 0.0012 + deep * 0.12 * gapes);
            g.lineCap = 'round';
            g.filter = 'blur(1px)';
            for (const [w, share] of [[1, 0.25], [0.6, 0.6], [0.25, 1]]) {
                g.lineWidth = px(gape * w);
                g.strokeStyle = `rgb(${Math.round(255 * most * share)},${Math.round(235 * Math.min(1, share * 1.6))},0)`;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
            }
        });
    }

    // The lip of skin cut right through along a loop (`points`, each with its `uv`), `scale` texture units to a metre
    // there: the layers it was cut through show along it for `wide` metres in from the edge, `deep` (0 to 1 of the
    // sheet's 4 cm) at the edge itself, and blood lies in them. A torn edge (`ragged`) wanders in and out.
    rim(points: { uv: number[] }[], scale: number, wide: number, deep: number, ragged = false) {
        const g = this.depth.getContext() as CanvasRenderingContext2D;
        g.save();
        g.globalCompositeOperation = 'lighten';
        g.lineCap = 'round';
        g.filter = 'blur(1px)';
        const px = (m: number) => Math.max(1, m * scale * SIZE);
        for (let k = 0; k < points.length; k++) {
            const a = points[k].uv, b = points[(k + 1) % points.length].uv;
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.03) continue;
            const w = wide * (ragged ? 0.5 + Math.random() : 1);
            for (const [width, share] of [[1, 0.15], [0.55, 0.5], [0.2, 1]]) {
                g.lineWidth = px(w * width * 2);
                g.strokeStyle = `rgb(${Math.round(255 * deep * share)},${Math.round(200 * Math.min(1, share * 1.5))},0)`;
                g.beginPath(); g.moveTo(a[0] * SIZE, (1 - a[1]) * SIZE); g.lineTo(b[0] * SIZE, (1 - b[1]) * SIZE); g.stroke();
            }
        }
        g.restore();
        this._dirty.add(this.depth);
    }

    // The lips of an opening right through the body's wall (viscera.ts): its edge through skin crossings `edge` (in
    // order, all round it), and out from it, in a band about `lip` metres wide, the wall's layers as its cut face shows
    // them: the skin's cut edge, the fat under it, the white sheath, then the muscle, deeper the nearer the hole, and
    // a little blood in them. A torn wall draws back unevenly, so the band is wider here and narrower there. (Inside the edge,
    // no skin is drawn.) The depth runs down evenly across the band, so that each layer shows as wide as it is thick
    // in it; flat steps of depth showed one layer only, the fat, as a band of one colour.
    lip(edge, lip: number) {
        const g = this.depth.getContext() as CanvasRenderingContext2D, n = edge.length;
        const px = (m: number) => Math.max(1, m * edge[0].scale * SIZE);
        const phase = Math.random() * 6;
        const wide = edge.map((_, k) => lip * (0.55 + 0.5 * (0.5 + 0.5 * Math.sin(k * 0.6 + phase) * Math.sin(k * 0.21 + phase * 1.7)) + 0.2 * Math.random()));
        g.save();
        g.globalCompositeOperation = 'lighten';
        g.lineCap = 'round';
        g.filter = 'blur(1px)';
        const STEPS = 10;
        for (let s = 0; s < STEPS; s++) {
            // From the band's outer edge (out = 1: the skin's cut edge, 1 mm deep) to the hole (the muscle, 14 mm on the
            // sheet's scale, where Gore draws it red; deeper it draws a wound's dark depths). A little blood in it, most
            // in the muscle: more and it covers the layers.
            const out = 1 - s / STEPS, deep = 0.03 + 0.33 * (1 - out);
            g.strokeStyle = `rgb(${Math.round(255 * deep)},${Math.round(255 * (0.08 + 0.5 * deep))},0)`;
            for (let k = 0; k < n; k++) {
                const a = edge[k].uv, b = edge[(k + 1) % n].uv;
                if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.04) continue;
                g.lineWidth = px(out * (wide[k] + wide[(k + 1) % n]));
                g.beginPath(); g.moveTo(a[0] * SIZE, (1 - a[1]) * SIZE); g.lineTo(b[0] * SIZE, (1 - b[1]) * SIZE); g.stroke();
            }
        }
        g.restore();
        this._dirty.add(this.depth);
    }

    // A bruise where a blow landed.
    bruise(hit, size) {
        if (!hit) return;
        this._paint(hit, (g, x, y, px) => {
            soft(g, x, y, px(size), 'rgba(70,20,45,0.45)');
            soft(g, x, y, px(size * 0.5), 'rgba(90,15,30,0.4)');
        });
    }

    // Blood on the skin, running: a streak from one place to the next (runs.ts), `wide` metres across, `mm` thick. Kept
    // in the skin's film (film.ts), which draws it as blood lying on skin.
    trail(a, b, wide, mm = 0.1) { this.npc.film?.stroke(a, b, wide, mm); }

    // Blood lying on skin that is not running anywhere: a patch `r` across, `mm` thick.
    smear(hit, r, mm = 0.15) { this.npc.film?.blot(hit, r, mm); }

    // Blood into cloth at `hit`: the clothes take it in and wick it through themselves (soak.ts). Returns whether the
    // cloth there is full, after which what comes runs out of it.
    drink(hit, litres) {
        const soak = this.npc.soak;
        if (!soak?.add(hit.rest, litres * 1000)) return true;
        return soak.fullness(hit.rest) > 1;
    }

    // Once in a while: blood that has been out a while goes darker and browner as it dries.
    age() {
        if (!this._old) return;
        for (const t of [this.skin, this.cloth]) {
            const g = t.getContext() as CanvasRenderingContext2D;
            g.save();
            g.globalCompositeOperation = 'source-atop';
            g.fillStyle = 'rgba(40,14,8,0.05)';
            g.fillRect(0, 0, SIZE, SIZE);
            g.restore();
            this._dirty.add(t);
        }
    }

    dispose() {
        this.scene.onBeforeRenderObservable.remove(this._flush);
        this.skin.dispose();
        this.cloth.dispose();
        this.depth.dispose();
    }
}

function soft(g, x, y, r, colour) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.7, colour);
    grad.addColorStop(1, colour.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
}

// A hole with a torn edge: `jag` is how far in and out its edge wanders.
function ragged(g, x, y, r, colour, jag) {
    g.fillStyle = colour;
    g.beginPath();
    const n = 11;
    for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2, rr = r * (1 - jag / 2 + Math.random() * jag);
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
}

// --- drawing them ---------------------------------------------------------------------------
//
// The skin is never cut away. Where the depth sheet says the flesh is open, the skin's own shader draws what is
// there: the skin's cut edge, then yellow fat, the white sheath, red muscle going dark with depth, and blood lying in
// the bottom; and it bends the surface's normal down the walls, so that light falls into a wound and its far wall
// is lit and its near wall is in shadow. It goes wherever the skin goes, round a face or a finger.

// (noise, for lips that are not ruled lines)
const GLSL_GORE_NOISE = `
float goreHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float goreNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(goreHash(i), goreHash(i + vec2(1, 0)), f.x), mix(goreHash(i + vec2(0, 1)), goreHash(i + vec2(1, 1)), f.x), f.y); }
`;

const GLSL_GORE = `
#ifdef GORE
float goreWet = 0.0;
{
    vec2 gu = vMainUV1;
    vec3 gdp1 = dFdx(vPositionW), gdp2 = dFdy(vPositionW);
    vec2 gdu1 = dFdx(gu), gdu2 = dFdy(gu);
    vec4 gm = texture2D(goreDepth, gu);
    if (gm.r > 0.004 || gm.g > 0.004) {
        float hx = texture2D(goreDepth, gu + vec2(goreTexel.x, 0.0)).r - texture2D(goreDepth, gu - vec2(goreTexel.x, 0.0)).r;
        float hy = texture2D(goreDepth, gu + vec2(0.0, goreTexel.y)).r - texture2D(goreDepth, gu - vec2(0.0, goreTexel.y)).r;
        // The skin's own directions across its picture, from how both change across the screen.
        vec3 gn = normalW, gp2 = cross(gdp2, gn), gp1 = cross(gn, gdp1);
        vec3 gt = gp2 * gdu1.x + gp1 * gdu2.x, gb = gp2 * gdu1.y + gp1 * gdu2.y;
        float gs = inversesqrt(max(dot(gt, gt), dot(gb, gb)) + 1e-20);
        normalW = normalize(gn + (gt * gs * hx + gb * gs * hy) * 6.0);
        // Depth in millimetres, made uneven so that the lips and the layers in the walls wander as real ones do.
        // (The finest noise fades to its middle where a pixel covers more than one of its cells: further off it only
        // sparkles.)
        float gstep = max(max(abs(gdu1.x), abs(gdu2.x)), max(abs(gdu1.y), abs(gdu2.y)));
        float gfine = clamp(1.6 - gstep * 2600.0, 0.0, 1.0), gmid = clamp(1.6 - gstep * 900.0, 0.0, 1.0);
        float d = gm.r * 40.0 * (0.8 + 0.4 * mix(0.5, goreNoise(gu * 2600.0), gfine)) + (mix(0.5, goreNoise(gu * 900.0), gmid) - 0.5) * 1.2;
        // Fat in lobules a few millimetres across, each a little more or less yellow, the septa between them paler.
        vec3 fat = vec3(0.84, 0.66, 0.32) * (0.86 + 0.24 * mix(0.5, goreNoise(gu * 1300.0 + 5.0), clamp(1.6 - gstep * 1300.0, 0.0, 1.0)));
        vec3 flesh = mix(vec3(0.5, 0.17, 0.15), fat, smoothstep(1.4, 2.6, d));
        flesh = mix(flesh, vec3(0.68, 0.62, 0.56), smoothstep(9.5, 11.0, d));
        flesh = mix(flesh, vec3(0.36, 0.06, 0.05), smoothstep(11.5, 13.0, d));
        flesh = mix(flesh, vec3(0.08, 0.005, 0.004), smoothstep(15.0, 30.0, d));
        surfaceAlbedo = mix(surfaceAlbedo, toLinearSpace(flesh), smoothstep(0.1, 0.9, d));
        // Blood fills a fresh wound from the bottom and wells over its lips.
        float blood = gm.g * (0.5 + 0.5 * smoothstep(0.0, 3.0, d)) * (0.85 + 0.3 * mix(0.5, goreNoise(gu * 1500.0), gfine));
        surfaceAlbedo = mix(surfaceAlbedo, toLinearSpace(vec3(0.36, 0.025, 0.02)), clamp(blood, 0.0, 0.93));
        surfaceAlbedo *= 1.0 - 0.6 * smoothstep(3.0, 30.0, d);
        // Cut flesh is wet: a soft sheen on it, and more where blood lies.
        goreWet = max(smoothstep(0.3, 1.5, d), clamp(blood, 0.0, 1.0));
    }
}
#endif
`;

export class Gore extends BABYLON.MaterialPluginBase {
    declare depth: BABYLON.Texture;

    constructor(material, depth) {
        super(material, 'Gore', 225, { GORE: false });
        this.depth = depth;
        this._enable(true);
    }

    getClassName() { return 'Gore'; }

    prepareDefines(defines) { defines.GORE = true; }

    getSamplers(samplers) { samplers.push('goreDepth'); }

    getUniforms() { return { ubo: [{ name: 'goreTexel', size: 2, type: 'vec2' }] }; }

    bindForSubMesh(ubo) {
        ubo.updateFloat2('goreTexel', 1 / SIZE, 1 / SIZE);
        ubo.setTexture('goreDepth', this.depth);
    }

    getActiveTextures(textures) { textures.push(this.depth); }

    hasTexture(texture) { return texture === this.depth; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GORE\nuniform sampler2D goreDepth;\n${GLSL_GORE_NOISE}#endif\n`, CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_GORE,
            // (Once the roughness is read. Hider hangs its own change on the same line under the key with `float `: code of
            // two plugins under one key is joined into one replacement, which would declare it twice.)
            '!(roughness=reflectivityOut\\.roughness;)': `$1
#ifdef GORE
microSurface = mix(microSurface, 0.72, goreWet);
roughness = 1.0 - microSurface;
#endif
`,
        };
    }
}

