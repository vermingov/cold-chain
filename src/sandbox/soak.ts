// Blood in clothes: how much of it the cloth holds at each place, and how it
// gets about in there.
//
// Cloth drinks blood into the spaces between its fibres and pulls it along
// them (wicking: Lucas-Washburn, the wetted patch growing as the square
// root of time), so a stain grows from where the blood came in, its edge
// sharp because a fibre is wet or it is not, and ragged because the weave is
// not the same everywhere. Past what the cloth can hold by wicking (its
// field capacity), the rest is free liquid and runs down through it under
// gravity, as the body lies now; where it can go no lower (a hem, a
// shirt-tail, a cuff) it gathers and drips. A thin cotton shirt holds about
// 0.3 litres to the square metre, denim and work twill half again as much,
// wool suiting about as much as cotton, leather next to nothing.
//
// Kept on a grid of 8 mm cubes over the person at rest (their clothes' own
// picture can give both legs one place), sent to the card as a 3D texture
// that the clothes' shader (hider.ts) reads by the rest position of each
// point it draws: red how full the cloth is, green how wet it still is.

import * as BABYLON from '@babylonjs/core';
import { DRIP, across, sendPart } from './fluid.ts';
const V3 = BABYLON.Vector3;

const VOX = 0.008;              // metres: a cube of the grid
const STEP = 1 / 12;            // seconds between moves of the blood in the cloth
const WICK = 1.6;               // how fast cloth pulls blood from fuller to emptier (1/s, at full)
const DRAINS = 2.5;             // how fast free blood runs down through it (1/s)
const HOLDS = 0.7;              // of what it can hold, the part held by wicking; past it the blood runs
const OVER = 1.3;               // how much past full a cloth can be before it drips (blood standing on it)
const DRIES = 1500;             // seconds for soaked cloth to lose two thirds of its wetness
// Litres a square metre holds, by what the garment is.
const HOLD = [[/shoe|boot/, 0.04], [/worksuit|overall|jean|denim/, 0.5], [/casual/, 0.42], [/suit/, 0.36], [/./, 0.32]] as const;

type Grid = { o: BABYLON.Vector3; n: number[]; cap: Float32Array; owner: Uint16Array; weave: Float32Array; bones: any[]; copies: Map<number, number[]> };

// The grid of one body: how much each cube holds (the area of cloth in it times what that cloth holds), which bone
// each moves with, and how readily the weave in it wicks. Made once per body.
const grids = new Map<string, Grid>();
function gridOf(npc): Grid {
    const key = npc.person.bodyName;
    if (grids.has(key)) return grids.get(key);
    const { header, arrays } = npc.person.lib.bodies.get(key);
    const pos = arrays.position, index = arrays.index;
    const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity);
    for (const p of header.parts) {
        if (p.kind !== 'cloth') continue;
        for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) {
            lo.minimizeInPlaceFromFloats(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            hi.maximizeInPlaceFromFloats(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        }
    }
    const o = lo.subtractFromFloats(VOX * 2, VOX * 2, VOX * 2);
    const n = [0, 1, 2].map((k) => Math.ceil((hi.asArray()[k] - o.asArray()[k]) / VOX) + 2);
    const cells = n[0] * n[1] * n[2];
    const cap = new Float32Array(cells), owner = new Uint16Array(cells), weight = new Float32Array(cells), weave = new Float32Array(cells);
    const a = new V3(), b = new V3(), c = new V3(), p = new V3();
    for (const part of header.parts) {
        if (part.kind !== 'cloth') continue;
        const hold = HOLD.find(([re]) => re.test(part.name + ':' + (part.texture?.file ?? '')))[1] * 1000;     // ml a square metre
        for (let t = part.indexStart; t < part.indexStart + part.indexCount; t += 3) {
            const ia = index[t], ib = index[t + 1], ic = index[t + 2];
            a.set(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
            b.set(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
            c.set(pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]);
            const area = V3.Cross(b.subtract(a), c.subtract(a)).length() / 2;
            // Points over the triangle a few millimetres apart, each carrying its share of the area to its cube.
            const k = Math.max(1, Math.ceil(Math.sqrt(area) / (VOX * 0.4)));
            let bone = 0, most = -1;
            for (let j = 0; j < 4; j++) if (arrays.weights[ia * 4 + j] > most) { most = arrays.weights[ia * 4 + j]; bone = arrays.joints[ia * 4 + j]; }
            for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) {
                const u = (i + 1 / 3) / k, v = (j + 1 / 3) / k;
                p.copyFrom(a).scaleInPlace(1 - u - v).addInPlace(b.scale(u)).addInPlace(c.scale(v));
                const cell = Math.floor((p.x - o.x) / VOX) + n[0] * (Math.floor((p.y - o.y) / VOX) + n[1] * Math.floor((p.z - o.z) / VOX));
                const share = area / (k * (k + 1) / 2);
                cap[cell] += share * hold;
                if (share > weight[cell]) { weight[cell] = share; owner[cell] = bone; }
            }
        }
    }
    for (let i = 0; i < cells; i++) {
        if (!cap[i]) continue;
        // Thread to thread the weave pulls blood unevenly: some cubes take it twice as readily as others.
        const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        weave[i] = 0.75 + 0.5 * (h - Math.floor(h));
    }
    // The empty cubes round the cloth show what the cloth next to them holds: the shader reads between cubes, and an
    // empty one beside a soaked one would otherwise make the stain fade wherever the cloth runs close to a cube's edge.
    const copies = new Map<number, number[]>();
    const nx = n[0], nxy = n[0] * n[1];
    for (let z = 1; z < n[2] - 1; z++) for (let y = 1; y < n[1] - 1; y++) for (let x = 1; x < n[0] - 1; x++) {
        const c = x + nx * y + nxy * z;
        if (cap[c]) continue;
        let best = -1;
        for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const d = c + i + nx * j + nxy * k;
            if (cap[d] && (best < 0 || cap[d] > cap[best])) best = d;
        }
        if (best < 0) continue;
        if (!copies.has(best)) copies.set(best, []);
        copies.get(best).push(c);
    }
    const bones = header.bones.map((bn) => npc.person.byName[bn.name]);
    const grid = { o, n, cap, owner, weave, bones, copies };
    grids.set(key, grid);
    return grid;
}

export class Soak {
    declare npc: any;
    declare grid: Grid;
    declare ml: Float32Array;
    declare born: Float32Array;
    declare change: Float32Array;
    declare live: number[];
    declare isLive: Uint8Array;
    declare drips: Map<number, number>;
    declare data: Uint8Array;
    declare texture: BABYLON.RawTexture3D;
    declare clock: number;
    declare wait: number;
    declare box: number[];
    declare shaded: number;

    constructor(scene: BABYLON.Scene, npc) {
        this.npc = npc;
        this.grid = gridOf(npc);
        const [nx, ny, nz] = this.grid.n, cells = nx * ny * nz;
        this.ml = new Float32Array(cells);
        this.born = new Float32Array(cells);
        this.change = new Float32Array(cells);
        this.isLive = new Uint8Array(cells);
        this.live = [];
        this.drips = new Map();
        this.data = new Uint8Array(cells * 2);
        this.texture = new BABYLON.RawTexture3D(this.data, nx, ny, nz, BABYLON.Constants.TEXTUREFORMAT_RG, scene, false, false,
            BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
        this.texture.wrapU = this.texture.wrapV = this.texture.wrapR = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.clock = 0;
        this.wait = 0;
        this.shaded = 0;
        this.box = null;
    }

    // Where the grid is, for the shader: its corner and one over its size, in rest space.
    get origin() { return this.grid.o; }
    get scale() { return new V3(1 / (this.grid.n[0] * VOX), 1 / (this.grid.n[1] * VOX), 1 / (this.grid.n[2] * VOX)); }

    // The cube of cloth at a rest-space point, or the fullest-holding one next to it (-1 if there is no cloth there).
    cellAt(rest: BABYLON.Vector3) {
        const { o, n, cap } = this.grid;
        const x = Math.floor((rest.x - o.x) / VOX), y = Math.floor((rest.y - o.y) / VOX), z = Math.floor((rest.z - o.z) / VOX);
        let best = -1, most = 0;
        for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const X = x + i, Y = y + j, Z = z + k;
            if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
            const c = X + n[0] * (Y + n[1] * Z), w = cap[c] / (1 + 2 * (Math.abs(i) + Math.abs(j) + Math.abs(k)));
            if (w > most) { most = w; best = c; }
        }
        return best;
    }

    // `ml` of blood into the cloth at `rest`. False if there is no cloth there to take it.
    add(rest: BABYLON.Vector3, ml: number) {
        const c = this.cellAt(rest);
        if (c < 0 || ml <= 0) return false;
        // What was dry, or mostly fresh blood now, counts as freshly wet.
        if (this.ml[c] < ml * 3) this.born[c] = this.clock;
        this.ml[c] += ml;
        this._wake(c);
        this._encode(c);
        return true;
    }

    // Up to `ml` wiped off the cloth at `rest`; what it gave.
    take(rest: BABYLON.Vector3, ml: number) {
        const c = this.cellAt(rest);
        if (c < 0) return 0;
        const got = Math.min(ml, this.ml[c] * 0.5);
        this.ml[c] -= got;
        this._encode(c);
        return got;
    }

    // How full the cloth at `rest` is: 0 dry, 1 holding all it can, more with blood standing on it.
    fullness(rest: BABYLON.Vector3) {
        const c = this.cellAt(rest);
        return c < 0 ? 0 : this.ml[c] / this.grid.cap[c];
    }

    _wake(c: number) {
        if (!this.isLive[c]) { this.isLive[c] = 1; this.live.push(c); }
    }

    // Cube `c` as the card has it: how full (as a square root, so a faint stain still has steps), and how wet. Marked to
    // be sent only if that changed.
    _encode(c: number) {
        const cap = this.grid.cap[c], full = Math.min(OVER, this.ml[c] / cap);
        const r = Math.round(Math.sqrt(full / OVER) * 255);
        const g = this.ml[c] > 0 ? Math.round(255 * Math.exp(-(this.clock - this.born[c]) / DRIES)) : 0;
        if (this.data[c * 2] === r && this.data[c * 2 + 1] === g) return;
        this.data[c * 2] = r;
        this.data[c * 2 + 1] = g;
        this._mark(c);
        for (const e of this.grid.copies.get(c) ?? []) {
            this.data[e * 2] = r;
            this.data[e * 2 + 1] = g;
            this._mark(e);
        }
    }

    _mark(c: number) {
        const nx = this.grid.n[0], ny = this.grid.n[1];
        const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
        const b = this.box;
        if (!b) this.box = [x, y, z, x + 1, y + 1, z + 1];
        else {
            if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
            if (x + 1 > b[3]) b[3] = x + 1; if (y + 1 > b[4]) b[4] = y + 1; if (z + 1 > b[5]) b[5] = z + 1;
        }
    }

    update(dt: number) {
        this.clock += dt;
        this.wait += dt;
        if (this.wait < STEP || !this.live.length) { this._send(); return; }
        const step = Math.min(this.wait, 0.2);
        this.wait = 0;
        const { cap, owner, weave, n, bones } = this.grid, { ml, change } = this;
        const nx = n[0], nxy = n[0] * n[1];
        const steps = [1, -1, nx, -nx, nxy, -nxy];
        // Down, as each bone lies now, in the rest frame: worked out once a step for the bones that have blood on them.
        const downs = new Map<number, number[]>();
        const downOf = (bone) => {
            let d = downs.get(bone);
            if (!d) {
                const owner = bones[bone];
                const v = owner ? V3.TransformNormal(new V3(0, -1, 0), this.npc.restToWorld(owner).clone().invert()).normalize() : new V3(0, -1, 0);
                d = [v.x, -v.x, v.y, -v.y, v.z, -v.z];
                downs.set(bone, d);
            }
            return d;
        };
        const out = [0, 0, 0, 0, 0, 0];
        const live = this.live.slice();
        const give = (c: number, j: number, moved: number) => {
            change[c] -= moved;
            change[j] += moved;
            if (ml[j] < moved * 3) this.born[j] = this.born[c];
            if (!this.isLive[j]) { this.isLive[j] = 1; this.live.push(j); }
        };
        for (const c of live) {
            let have = ml[c];
            if (have < 1e-7) continue;
            const hold = cap[c], down = downOf(owner[c]);
            // Blood standing on cloth that cannot take any more runs over it onto the cloth round it, down first, and
            // soaks in there; with nowhere left to go, it gathers into drops.
            if (have > OVER * hold) {
                const spare = have - OVER * hold;
                let sum = 0;
                for (let k = 0; k < 6; k++) {
                    const j = c + steps[k];
                    out[k] = cap[j] && ml[j] < OVER * cap[j] ? Math.max(0.03, down[k] + 0.35) : 0;
                    sum += out[k];
                }
                if (sum > 0) { for (let k = 0; k < 6; k++) if (out[k]) give(c, c + steps[k], (spare * out[k]) / sum); }
                else {
                    const gathered = (this.drips.get(c) ?? 0) + spare;
                    change[c] -= spare;
                    if (gathered >= DRIP) { this._drip(c, gathered); this.drips.delete(c); } else this.drips.set(c, gathered);
                }
                have -= spare;
            }
            const full = have / hold;
            // Cloth barely damp hardly wicks at all (the square of its fullness): not worth working out.
            if (full < 0.02) continue;
            let total = 0;
            for (let k = 0; k < 6; k++) {
                out[k] = 0;
                const j = c + steps[k], cj = cap[j];
                if (!cj) continue;
                const fj = ml[j] / cj;
                let flow = 0;
                // Wicking: from fuller to emptier, readily where both are wet, hardly at all into dry fibre from a damp
                // one (so the edge of a stain is sharp).
                if (full > fj) { const m = (full + fj) * 0.5; flow = WICK * m * m * (full - fj) * Math.min(hold, cj) * weave[j]; }
                // Free blood past what wicking holds runs down.
                if (down[k] > 0.2 && full > HOLDS && fj < OVER) flow += DRAINS * (full - HOLDS) * down[k] * hold;
                out[k] = flow * step;
                total += out[k];
            }
            const scale = total > have * 0.45 ? (have * 0.45) / total : 1;
            for (let k = 0; k < 6; k++) if (out[k]) give(c, c + steps[k], out[k] * scale);
        }
        for (const c of this.live) {
            if (change[c]) { ml[c] = Math.max(0, ml[c] + change[c]); change[c] = 0; this._encode(c); }
        }
        this._send();
    }

    // A drop falling from the cloth at cube `c`, from where that cube is now.
    _drip(c: number, ml: number) {
        const { o, n, owner, bones } = this.grid;
        const x = c % n[0], y = Math.floor(c / n[0]) % n[1], z = Math.floor(c / (n[0] * n[1]));
        const rest = new V3(o.x + (x + 0.5) * VOX, o.y + (y + 0.5) * VOX, o.z + (z + 0.5) * VOX);
        const bone = bones[owner[c]];
        if (!bone) return;
        const at = this.npc.worldOf(rest, bone).at;
        this.npc.world.blood.drip(at.addInPlaceFromFloats(0, -0.006, 0), ml, across(ml));
    }

    // What changed goes up to the card; and every few seconds every cube with blood in it is coloured again, as it dries.
    _send() {
        if (this.clock - this.shaded > 4 && this.live.length) {
            this.shaded = this.clock;
            for (const c of this.live) this._encode(c);
        }
        if (!this.box) return;
        sendPart(this.texture, this.data, this.grid.n, this.box);
        this.box = null;
    }

    dispose() { this.texture.dispose(); }
}

export { OVER, VOX };
