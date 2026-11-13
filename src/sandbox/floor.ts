// Blood on the floor: how deep it stands at each place, how it spreads, and
// how it dries.
//
// The floor is a grid of 12.5 mm squares, each holding a depth of blood.
// Blood runs from deeper to shallower (and from higher to lower: no concrete
// floor is flat, it rises and falls a millimetre or two over half a metre),
// as readily as a film of its depth can flow (the cube of the depth, over
// its viscosity: a thin smear hardly moves, a pool levels at once). It does
// not wet dry floor until it stands deep enough to push its edge over it:
// two to three millimetres on concrete, which is how deep a pool of blood
// is, and that edge is caught on every grain and pore, so it is ragged. A
// thin film stays behind wherever it has been. It thickens as it clots (a
// few minutes), skins over and darkens as it dries (tens of minutes), and
// goes brown-black.
//
// Drawn by one plane over the part of the floor with blood on it, its
// shader (Puddle) reading the depths: dark red where it is deep, red-brown
// where it is a smear, a surface as smooth as water while it is wet whose
// edge rounds up and catches the lamps.

import * as BABYLON from '@babylonjs/core';
import { GLSL_BLOOD, MU, RHO, noise2, sendPart } from './fluid.ts';

const CELL = 0.0125;            // metres
const TILE = 32;                // cells a side of the tiles the floor is woken and put to sleep by
const STEP = 1 / 30;            // seconds between moves
const STANDS = 0.0025;          // metres: how deep blood must stand to push its edge on over dry floor, on average
const STAYS = 0.00006;          // metres: the film left behind where it has been
const MOST_MM = 4;              // the deepest the texture tells apart
const CLOTS = 360;              // seconds for blood on a floor to thicken to a third of its first runniness
const DRIES = 1400;             // seconds for a pool to lose two thirds of its wetness (a smear is quicker)
const MOVES = (RHO * 9.81 * STEP) / (3 * MU * CELL * CELL);     // how much of a depth difference a film moves a step, per cubic metre of depth

export class Floor {
    declare scene: BABYLON.Scene;
    declare n: number;
    declare x0: number;
    declare z0: number;
    declare h: Float32Array;
    declare change: Float32Array;
    declare rise: Float32Array;
    declare edge: Float32Array;
    declare born: Float32Array;
    declare tiles: number;
    declare awake: Uint8Array;
    declare made: Uint8Array;
    declare quiet: Uint16Array;
    declare wet: Set<number>;
    declare data: Uint8Array;
    declare texture: BABYLON.RawTexture;
    declare mesh: BABYLON.Mesh;
    declare material: BABYLON.PBRMaterial;
    declare clock: number;
    declare wait: number;
    declare dirty: Set<number>;
    declare shaded: number;
    declare sent: number;
    declare area: number[] | null;
    declare pending: number[] | null;
    declare covered: ((x: number, z: number) => boolean) | null;

    // `half` the half-width of the square floor in metres; `reflect` what a wet surface shows.
    constructor(scene: BABYLON.Scene, half: number, reflect: BABYLON.BaseTexture | null) {
        this.scene = scene;
        this.n = Math.ceil((half * 2) / CELL / TILE) * TILE;
        this.x0 = this.z0 = -(this.n * CELL) / 2;
        const cells = this.n * this.n;
        this.h = new Float32Array(cells);
        this.change = new Float32Array(cells);
        this.rise = new Float32Array(cells);
        this.edge = new Float32Array(cells);
        this.born = new Float32Array(cells);
        this.tiles = this.n / TILE;
        this.awake = new Uint8Array(this.tiles * this.tiles);
        this.made = new Uint8Array(this.tiles * this.tiles);
        this.quiet = new Uint16Array(this.tiles * this.tiles);
        this.wet = new Set();
        this.data = new Uint8Array(cells * 2);
        this.texture = new BABYLON.RawTexture(this.data, this.n, this.n, BABYLON.Constants.TEXTUREFORMAT_RG, scene, false, false,
            BABYLON.Texture.BILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
        this.texture.wrapU = this.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.clock = 0;
        this.wait = 0;
        this.dirty = new Set();
        this.shaded = 0;
        this.sent = 0;
        this.area = null;
        this.pending = null;
        this.covered = null;     // where something stands on the floor (map.ts): blood does not run in under it

        this.mesh = BABYLON.MeshBuilder.CreateGround('bloodFloor', { width: 1, height: 1 }, scene);
        this.mesh.position.y = 0.0007;
        this.mesh.isPickable = false;
        this.mesh.receiveShadows = true;
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.isVisible = false;
        const m = new BABYLON.PBRMaterial('bloodFloor', scene);
        m.albedoColor = new BABYLON.Color3(0.1, 0.004, 0.003);
        m.metallic = 0;
        m.roughness = 0.05;
        m.reflectionTexture = reflect;
        m.environmentIntensity = 0.9;
        m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        // Where there is no blood there is nothing to catch the lamp.
        m.useSpecularOverAlpha = false;
        m.useRadianceOverAlpha = false;
        m.zOffset = -1;
        m.maxSimultaneousLights = 8;
        new Puddle(m, this);
        this.material = m;
        this.mesh.material = m;
    }

    _cell(x: number, z: number) {
        const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
        return i < 1 || j < 1 || i >= this.n - 1 || j >= this.n - 1 ? -1 : j * this.n + i;
    }

    // The floor's own lie, made the first time a tile is wet: how high each cell is (a couple of millimetres of
    // unevenness over half a metre, less over a few centimetres) and how deep blood must stand to wet it.
    _make(t: number) {
        this.made[t] = 1;
        const tx = t % this.tiles, tz = Math.floor(t / this.tiles);
        for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
            const gx = tx * TILE + i, gz = tz * TILE + j, c = gz * this.n + gx;
            const x = gx * CELL, z = gz * CELL;
            this.rise[c] = 0.0016 * noise2(x / 0.45, z / 0.45) + 0.0006 * noise2(x / 0.11 + 7, z / 0.11) + 0.00015 * noise2(x / 0.03, z / 0.03 + 3);
            this.edge[c] = STANDS * (0.6 + 0.55 * noise2(x / 0.05 + 11, z / 0.05) + 0.35 * noise2(x / 0.017, z / 0.017 + 5));
            // Under a wall or a ledge, the floor is a metre higher: nothing flows uphill into it.
            if (this.covered?.(this.x0 + x + CELL / 2, this.z0 + z + CELL / 2)) this.rise[c] = 1;
        }
    }

    _wake(c: number) {
        const t = Math.floor(Math.floor(c / this.n) / TILE) * this.tiles + Math.floor((c % this.n) / TILE);
        if (!this.made[t]) this._make(t);
        this.awake[t] = 1;
        this.quiet[t] = 0;
    }

    _tile(c: number) { return Math.floor(Math.floor(c / this.n) / TILE) * this.tiles + Math.floor((c % this.n) / TILE); }

    // Cell `c` as the card has it: the depth (as a square root, so a thin smear still has steps) and how wet it is (thin
    // blood dries in minutes; a pool keeps wet under its skin far longer). Its tile is sent again only if that changed.
    _encode(c: number) {
        const hc = this.h[c];
        const r = Math.round(Math.sqrt(Math.min(1, hc / (MOST_MM / 1000))) * 255);
        const keeps = 200 + DRIES * Math.min(1, hc / STANDS);
        const g = hc > 0 ? Math.round(255 * Math.exp(-(this.clock - this.born[c]) / keeps)) : 0;
        if (this.data[c * 2] === r && this.data[c * 2 + 1] === g) return;
        this.data[c * 2] = r;
        this.data[c * 2 + 1] = g;
        this.dirty.add(this._tile(c));
    }

    // `ml` of blood onto the floor at (x, z).
    add(x: number, z: number, ml: number) {
        const c = this._cell(x, z);
        if (c < 0 || ml <= 0) return;
        this._wake(c);
        const add = (ml * 1e-6) / (CELL * CELL);
        if (this.h[c] < add * 2) this.born[c] = this.clock;
        this.h[c] += add;
        this.wet.add(c);
        this._encode(c);
    }

    // Whether blood at (x, z) is still a liquid a drop would fall into: standing at least `deep` metres and not yet
    // dried to a skin (the card's wetness, _encode, above a third).
    liquid(x: number, z: number, deep = 0.0004) {
        const c = this._cell(x, z);
        if (c < 0 || this.h[c] < deep) return false;
        return Math.exp(-(this.clock - this.born[c]) / (200 + DRIES * Math.min(1, this.h[c] / STANDS))) > 0.33;
    }

    // `ml` of blood into the pool round (x, z): a drop falling into a pool merges with it and its surface levels out
    // again within a moment, so it raises the liquid within `r` metres evenly instead of piling up in one cell (which
    // the slow flow below then drew as a crater for minutes). Where none of it there is liquid, the one cell.
    pour(x: number, z: number, ml: number, r = 0.04) {
        const cells = [], k = Math.ceil(r / CELL);
        for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
            if (i * i + j * j > k * k) continue;
            if (this.liquid(x + i * CELL, z + j * CELL, STAYS)) cells.push([x + i * CELL, z + j * CELL]);
        }
        if (!cells.length) { this.add(x, z, ml); return; }
        for (const [cx, cz] of cells) this.add(cx, cz, ml / cells.length);
    }

    // How deep blood stands at (x, z), metres.
    depth(x: number, z: number) {
        const c = this._cell(x, z);
        return c < 0 ? 0 : this.h[c];
    }

    // Up to `ml` taken off the floor within `r` of (x, z) (something lying in it, a shoe), from the deepest first;
    // what it got.
    take(x: number, z: number, r: number, ml: number) {
        const got = [];
        const k = Math.ceil(r / CELL);
        const ci = this._cell(x, z);
        if (ci < 0) return 0;
        for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) {
            if (i * i + j * j > k * k) continue;
            const c = ci + j * this.n + i;
            if (this.h[c] > STAYS) got.push(c);
        }
        let taken = 0;
        const each = (ml * 1e-6) / (CELL * CELL) / Math.max(1, got.length);
        for (const c of got) {
            const t = Math.min(each, this.h[c] - STAYS * 0.5);
            this.h[c] -= t;
            taken += t * CELL * CELL * 1e6;
            this._wake(c);
            this._encode(c);
        }
        return taken;
    }

    // A step's flows are worked out in one frame and applied in the next, each about half of what it costs (both in the
    // same frame when frames come slower than steps).
    update(dt: number) {
        this.clock += dt;
        this.wait += dt;
        if (this.pending) this._settle(this.pending);
        if (this.wait >= STEP) {
            this.wait = 0;
            this._flow();
        }
        this._send();
    }

    // One step of every awake tile: each wet cell gives to each lower neighbour as much as a film its depth would carry.
    _flow() {
        const { n, h, change, rise, edge, born, clock } = this;
        const steps = [1, -1, n, -n];
        const touched = [];
        for (let t = 0; t < this.awake.length; t++) {
            if (!this.awake[t]) continue;
            touched.push(t);
            const tx = t % this.tiles, tz = Math.floor(t / this.tiles);
            for (let j = 0; j < TILE; j++) {
                let c = (tz * TILE + j) * n + tx * TILE;
                for (let i = 0; i < TILE; i++, c++) {
                    const hc = h[c];
                    if (hc <= STAYS) continue;
                    const top = hc + rise[c];
                    const free = hc - STAYS;
                    let given = 0, ease = -1;
                    for (let k = 0; k < 4; k++) {
                        const d = c + steps[k];
                        if (!edge[d]) this._wake(d);
                        const drop = top - h[d] - rise[d];
                        if (drop <= 0) continue;
                        // Dry floor is wetted only by blood standing deep enough to push its edge over it.
                        if (h[d] < STAYS * 0.5 && hc < edge[d]) continue;
                        // Runnier while fresh, thicker as it clots; and a film moves as the cube of its depth.
                        if (ease < 0) ease = Math.min(0.11, MOVES * hc * hc * hc * Math.exp(-(clock - born[c]) / CLOTS));
                        const q = Math.min(ease * drop, free * 0.24);
                        if (q <= 1e-9) continue;
                        change[d] += q;
                        given += q;
                        if (h[d] < q * 2) born[d] = born[c];
                    }
                    change[c] -= given;
                }
            }
        }
        this.pending = touched;
    }

    // What the step gives, applied after, so the order the cells were gone through does not show; cells at a tile's edge
    // give into the next.
    _settle(touched: number[]) {
        const { n, h, change } = this;
        this.pending = null;
        for (const t of touched) {
            const tx = t % this.tiles, tz = Math.floor(t / this.tiles);
            let moved = 0;
            for (let j = -1; j <= TILE; j++) {
                const gz = tz * TILE + j;
                if (gz < 0 || gz >= n) continue;
                const rim = j < 0 || j === TILE;
                for (let i = -1; i <= TILE; i++) {
                    const gx = tx * TILE + i;
                    if (gx < 0 || gx >= n) continue;
                    const c = gz * n + gx, d = change[c];
                    if (!d) continue;
                    change[c] = 0;
                    // (Every cell with blood in it is in `wet` already.)
                    if (!h[c]) this.wet.add(c);
                    h[c] = Math.max(0, h[c] + d);
                    moved += Math.abs(d);
                    if (rim || i < 0 || i === TILE) this._wake(c); else this.quiet[t] = 0;
                    this._encode(c);
                }
            }
            // A tile where next to nothing has moved for two thirds of a second sleeps until something lands in it.
            if (moved < 2e-6) { if (++this.quiet[t] > 20) this.awake[t] = 0; } else this.quiet[t] = 0;
        }
    }

    // What changed goes up to the card, a tile at a time; and every few seconds all of it is coloured again, as it dries.
    _send() {
        if (this.clock - this.shaded > 10 && this.wet.size) {
            this.shaded = this.clock;
            for (const c of this.wet) this._encode(c);
        }
        if (!this.dirty.size || this.clock - this.sent < 0.1) return;
        this.sent = this.clock;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const t of this.dirty) {
            const tx = (t % this.tiles) * TILE, tz = Math.floor(t / this.tiles) * TILE;
            sendPart(this.texture, this.data, [this.n, this.n], [tx, tz, 0, tx + TILE, tz + TILE, 1]);
            x0 = Math.min(x0, tx); z0 = Math.min(z0, tz); x1 = Math.max(x1, tx + TILE); z1 = Math.max(z1, tz + TILE);
        }
        this.dirty.clear();
        // The plane covers what has blood on it.
        const a = this.area;
        const nx0 = x0 * CELL + this.x0, nz0 = z0 * CELL + this.z0, nx1 = x1 * CELL + this.x0, nz1 = z1 * CELL + this.z0;
        if (!a || nx0 < a[0] || nz0 < a[1] || nx1 > a[2] || nz1 > a[3]) {
            this.area = a ? [Math.min(a[0], nx0), Math.min(a[1], nz0), Math.max(a[2], nx1), Math.max(a[3], nz1)] : [nx0, nz0, nx1, nz1];
            const [ax0, az0, ax1, az1] = this.area;
            this.mesh.position.x = (ax0 + ax1) / 2;
            this.mesh.position.z = (az0 + az1) / 2;
            this.mesh.scaling.set(ax1 - ax0, 1, az1 - az0);
            this.mesh.isVisible = true;
        }
    }

    clear() {
        this.h.fill(0);
        this.change.fill(0);
        this.pending = null;
        this.data.fill(0);
        this.awake.fill(0);
        this.wet.clear();
        this.dirty.clear();
        this.texture.update(this.data);
        this.area = null;
        this.mesh.isVisible = false;
    }

    dispose() {
        this.texture.dispose();
        this.mesh.dispose();
    }
}

// The floor's blood drawn: depth into colour, gloss and the bend of its surface.
class Puddle extends BABYLON.MaterialPluginBase {
    declare floor: Floor;

    constructor(material: BABYLON.Material, floor: Floor) {
        super(material, 'Puddle', 200, { PUDDLE: false });
        this.floor = floor;
        this._enable(true);
    }

    getClassName() { return 'Puddle'; }

    prepareDefines(defines) { defines.PUDDLE = true; }

    getSamplers(samplers) { samplers.push('puddleMap'); }

    getUniforms() { return { ubo: [{ name: 'puddleArea', size: 4, type: 'vec4' }] }; }

    bindForSubMesh(ubo) {
        const f = this.floor, size = f.n * CELL;
        ubo.updateFloat4('puddleArea', f.x0, f.z0, 1 / size, f.n);
        ubo.setTexture('puddleMap', f.texture);
    }

    getActiveTextures(textures) { textures.push(this.floor.texture); }

    hasTexture(texture) { return texture === this.floor.texture; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef PUDDLE
uniform sampler2D puddleMap;
${GLSL_BLOOD}
float puddleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float puddleNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(puddleHash(i), puddleHash(i + vec2(1, 0)), f.x), mix(puddleHash(i + vec2(0, 1)), puddleHash(i + vec2(1, 1)), f.x), f.y); }
// A cubic B-spline's four weights at fraction t, and their slopes.
vec4 puddleW(float t) { float t2 = t * t, t3 = t2 * t; return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0; }
vec4 puddleS(float t) { float t2 = t * t; return vec4(-1.0 + 2.0 * t - t2, -4.0 * t + 3.0 * t2, 1.0 + 2.0 * t - 3.0 * t2, t2) * 0.5; }
#endif
`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef PUDDLE
float puddleGloss = 0.0;
{
    // The cells read as a smooth surface (a cubic B-spline over the 4 by 4 cells about this point), not the grid's
    // squares: where blood is at all (wet cells, 1, against dry, 0), how deep it is, how wet, and how each changes across
    // the floor. Read a little off where this point is, by a smooth noise: blood's edge wanders with the floor's grain.
    vec2 pw = vPositionW.xz + (vec2(puddleNoise(vPositionW.xz * 17.0), puddleNoise(vPositionW.xz * 17.0 + 9.0)) - 0.5) * 0.009
        + (vec2(puddleNoise(vPositionW.xz * 61.0 + 3.0), puddleNoise(vPositionW.xz * 61.0 + 5.0)) - 0.5) * 0.003;
    vec2 tc = (pw - puddleArea.xy) * puddleArea.z * puddleArea.w - 0.5, base = floor(tc), f = tc - base;
    vec4 wx = puddleW(f.x), wz = puddleW(f.y), sx = puddleS(f.x), sz = puddleS(f.y);
    ivec2 at = ivec2(base) - 1, last = ivec2(int(puddleArea.w) - 1);
    // (Four filtered reads, each the mean of four cells, find a floor with no blood near it at a quarter of the cost.)
    vec2 q = (vec2(at) + 1.0) / puddleArea.w, h = vec2(2.0 / puddleArea.w, 0.0);
    if (texture2D(puddleMap, q).r + texture2D(puddleMap, q + h).r + texture2D(puddleMap, q + h.yx).r + texture2D(puddleMap, q + h.xx).r == 0.0) discard;
    float on = 0.0, onX = 0.0, onZ = 0.0, mm = 0.0, mmX = 0.0, mmZ = 0.0, wet = 0.0;
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
        vec2 s = texelFetch(puddleMap, clamp(at + ivec2(i, j), ivec2(0), last), 0).rg;
        float there = step(0.03, s.r), deep = s.r * s.r * ${MOST_MM.toFixed(1)};
        float w = wx[i] * wz[j], ax = sx[i] * wz[j], az = wx[i] * sz[j];
        on += there * w; onX += there * ax; onZ += there * az;
        mm += deep * w; mmX += deep * ax; mmZ += deep * az;
        wet += s.g * there * w;
    }
    // The edge is where the wet cells give way to dry ones, as smooth a curve as they allow.
    const float EDGE = 0.3;
    float fw = max(fwidth(on), 1e-4);
    float cover = smoothstep(EDGE - fw, EDGE + fw, on + (puddleNoise(vPositionW.xz * 260.0) - 0.5) * 0.04);
    if (cover < 0.003) discard;
    // How deep the blood about here stands (the wet cells' own depth, not thinned by the dry ones beside them), and at its
    // very edge thinning to nothing over a few millimetres: a thin bright rim round a dark pool, its meniscus.
    float inv = 1.0 / max(on, 0.05);
    float pool = mm * inv;
    float rim = smoothstep(EDGE, EDGE + 0.2, on);
    float shown = pool * mix(0.08, 1.0, rim);
    wet *= inv;
    // The surface of the blood: its depth's slope across the floor (per mm of floor, a cell being ${(CELL * 1000).toFixed(1)}).
    float t = clamp((on - EDGE) / 0.2, 0.0, 1.0);
    vec2 grad = ((vec2(mmX, mmZ) - pool * vec2(onX, onZ)) * inv * mix(0.08, 1.0, rim) + pool * 0.92 * 30.0 * t * (1.0 - t) * vec2(onX, onZ))
        / ${(CELL * 1000).toFixed(1)};
    // Drying, it skins over and wrinkles.
    float crinkle = (1.0 - wet) * (puddleNoise(vPositionW.xz * 700.0) - 0.5) * 0.25;
    normalW = normalize(vec3(-grad.x + crinkle, 1.0, -grad.y - crinkle));
    surfaceAlbedo = bloodOver(vec3(0.21, 0.2, 0.185), shown, wet);
    alpha = cover * clamp(0.5 + shown * 2.5, 0.0, 1.0);
    puddleGloss = cover * mix(0.55, 0.97, smoothstep(0.05, 0.6, wet)) * smoothstep(0.0, 0.04, shown);
}
#endif
`,
            '!(float diffuseRoughness=reflectivityOut\\.diffuseRoughness;)': `$1
#ifdef PUDDLE
microSurface = puddleGloss;
roughness = 1.0 - microSurface;
#endif
`,
        };
    }
}

export { CELL };
