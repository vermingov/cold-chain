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
const STEP = 1 / 8;             // seconds between moves of the blood in the cloth
const MOST = 1800;              // cubes worked out a step at most; the rest wait for the next
const SENDS = 0.25;             // seconds at least between sending what changed to the card
const WICK = 1.6;               // how fast cloth pulls blood from fuller to emptier (1/s, at full)
const DRAINS = 2.5;             // how fast free blood runs down through it (1/s)
const HOLDS = 0.7;              // of what it can hold, the part held by wicking; past it the blood runs
const OVER = 1.3;               // how much past full a cloth can be before it drips (blood standing on it)
const DRIES = 1500;             // seconds for soaked cloth to lose two thirds of its wetness
// Litres a square metre holds, by what the garment is.
const HOLD = [[/shoe|boot/, 0.04], [/worksuit|overall|jean|denim/, 0.5], [/casual/, 0.42], [/suit/, 0.36], [/./, 0.32]] as const;

type Grid = { o: BABYLON.Vector3; n: number[]; cap: Float32Array; owner: Uint16Array; weave: Float32Array; bones: any[]; copyFrom: Int32Array; copyAt: Int32Array; copyTo: Int32Array };

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
    // (Kept as lists end to end: cube c's copies are copyTo[copyAt[k]..copyAt[k + 1]] where copyFrom[k] = c, found by
    // copyIndex below.)
    const sources = [...copies.keys()].sort((a, b) => a - b);
    const copyFrom = new Int32Array(sources), copyAt = new Int32Array(sources.length + 1), list = [];
    sources.forEach((c, k) => { copyAt[k] = list.length; list.push(...copies.get(c)); });
    copyAt[sources.length] = list.length;
    const bones = header.bones.map((bn) => npc.person.byName[bn.name]);
    const grid = { o, n, cap, owner, weave, bones, copyFrom, copyAt, copyTo: new Int32Array(list) };
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
    declare work: Int32Array;
    declare next: Int32Array;
    declare queued: number;
    declare touched: Int32Array;
    declare isActive: Uint8Array;
    declare quiet: Uint8Array;
    declare copyIndex: Int32Array;
    declare downs: Float32Array;
    declare downStep: Int32Array;
    declare steps: number;
    declare sent: number;
    declare stirred: number;
    declare drips: Map<number, number>;
    declare data: Uint8Array;
    declare texture: BABYLON.RawTexture3D;
    declare clock: number;
    declare wait: number;
    declare dirty: Set<number>;
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
        this.isActive = new Uint8Array(cells);
        this.quiet = new Uint8Array(cells);
        this.work = new Int32Array(1024);
        this.next = new Int32Array(1024);
        this.queued = 0;
        this.touched = new Int32Array(1024);
        this.copyIndex = new Int32Array(cells).fill(-1);
        this.grid.copyFrom.forEach((c, k) => { this.copyIndex[c] = k; });
        this.downs = new Float32Array(this.grid.bones.length * 6);
        this.downStep = new Int32Array(this.grid.bones.length).fill(-1);
        this.steps = 0;
        this.sent = 0;
        this.stirred = 0;
        this.drips = new Map();
        this.data = new Uint8Array(cells * 2);
        this.texture = new BABYLON.RawTexture3D(this.data, nx, ny, nz, BABYLON.Constants.TEXTUREFORMAT_RG, scene, false, false,
            BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
        this.texture.wrapU = this.texture.wrapV = this.texture.wrapR = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.clock = 0;
        this.wait = 0;
        // (Recoloured as it dries every 12 s, people out of step with each other.)
        this.shaded = Math.random() * 12;
        this.dirty = new Set();
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
        const fresh = this.ml[c] < ml * 3;
        if (fresh) this.born[c] = this.clock;
        this.ml[c] += ml;
        this._wake(c);
        this._encode(c, fresh);
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

    // Cube `c` has blood in it, and is to be worked out until it settles.
    _wake(c: number) {
        if (!this.isLive[c]) { this.isLive[c] = 1; this.live.push(c); }
        this.quiet[c] = 0;
        this._queue(c);
    }

    _queue(c: number) {
        if (this.isActive[c]) return;
        this.isActive[c] = 1;
        if (this.queued >= this.next.length) this.next = grown(this.next);
        this.next[this.queued++] = c;
    }

    // Cube `c` as the card has it: how full (as a square root, so a faint stain still has steps) and, when it is
    // newly wet, freshly wet again or being recoloured as it dries, how wet. Marked to be sent only if that changed.
    _encode(c: number, wetness = false) {
        const { cap, copyAt, copyTo } = this.grid, data = this.data;
        const full = Math.min(OVER, this.ml[c] / cap[c]);
        const r = Math.round(Math.sqrt(full / OVER) * 255);
        const g = !wetness && data[c * 2 + 1] ? data[c * 2 + 1] : this.ml[c] > 0 ? Math.round(255 * Math.exp(-(this.clock - this.born[c]) / DRIES)) : 0;
        if (data[c * 2] === r && data[c * 2 + 1] === g) return;
        data[c * 2] = r;
        data[c * 2 + 1] = g;
        this._mark(c);
        const k = this.copyIndex[c];
        if (k < 0) return;
        for (let i = copyAt[k]; i < copyAt[k + 1]; i++) {
            const e = copyTo[i];
            data[e * 2] = r;
            data[e * 2 + 1] = g;
            this._mark(e);
        }
    }

    // The 8-cube brick that holds cube `c` is to be sent to the card again. (Sending one box round everything that
    // changed sent most of the torso every step, and the copy alone took milliseconds.)
    _mark(c: number) {
        const nx = this.grid.n[0], ny = this.grid.n[1];
        const x = c % nx, y = ((c / nx) | 0) % ny, z = (c / (nx * ny)) | 0;
        this.dirty.add((x >> 3) + 64 * ((y >> 3) + 64 * (z >> 3)));
    }

    // Down, as bone `b` lies now, in the rest frame, as the share of it along each of the six ways out of a cube; worked
    // out once a step for the bones that have blood on them.
    _down(b: number) {
        if (this.downStep[b] !== this.steps) {
            this.downStep[b] = this.steps;
            const bone = this.grid.bones[b];
            const v = bone ? V3.TransformNormal(DOWN, this.npc.restToWorld(bone).clone().invert()).normalize() : DOWN;
            this.downs.set([v.x, -v.x, v.y, -v.y, v.z, -v.z], b * 6);
        }
        return b * 6;
    }

    // A step works out only the cubes still changing: a cube sleeps once its blood has changed by a sliver of what it
    // holds for a few steps running, and wakes when blood comes into it, when a fuller neighbour could give it some, or
    // (every second and a half, for the body may have been turned over) when it holds more than wicking keeps and could
    // drain. At most MOST a step: a great soaking spreads a little slower, it does not cost more.
    update(dt: number) {
        this.clock += dt;
        this.wait += dt;
        if (this.wait >= STEP && this.live.length) {
            const step = Math.min(this.wait, 0.25);
            this.wait = 0;
            this.steps++;
            if (this.clock - this.stirred > 1.5) {
                this.stirred = this.clock;
                const { ml } = this, cap = this.grid.cap;
                for (const c of this.live) if (ml[c] > HOLDS * cap[c]) this._wake(c);
            }
            if (this.queued) this._step(step);
        }
        this._send();
    }

    _step(step: number) {
        const { cap, owner, weave, n } = this.grid, { ml, change, born, isActive, quiet, isLive, downs } = this;
        const nx = n[0], nxy = n[0] * n[1];
        STEPS[0] = 1; STEPS[1] = -1; STEPS[2] = nx; STEPS[3] = -nx; STEPS[4] = nxy; STEPS[5] = -nxy;
        // This step's cubes are those queued; the rest of the queue (past MOST) stays queued.
        const work = this.next, count = Math.min(this.queued, MOST);
        this.next = this.work;
        this.work = work;
        if (this.next.length < work.length) this.next = new Int32Array(work.length);
        const left = this.queued - count;
        this.next.set(work.subarray(count, this.queued));
        this.queued = left;
        for (let i = 0; i < count; i++) isActive[work[i]] = 0;
        let touched = this.touched, nt = 0;
        const touch = (c: number) => {
            if (nt >= touched.length) this.touched = touched = grown(touched);
            touched[nt++] = c;
        };
        const give = (c: number, j: number, m: number) => {
            if (change[j] === 0) touch(j);
            change[j] += m;
            if (ml[j] < m * 3) born[j] = born[c];
            if (!isLive[j]) { isLive[j] = 1; this.live.push(j); }
            this._queue(j);
        };
        for (let i = 0; i < count; i++) {
            const c = work[i];
            let have = ml[c];
            if (have < 1e-7) continue;
            const hold = cap[c], d0 = this._down(owner[c]);
            // Blood standing on cloth that cannot take any more runs over it onto the cloth round it, down first, and
            // soaks in there; with nowhere left to go, it gathers into drops.
            if (have > OVER * hold) {
                const spare = have - OVER * hold;
                let sum = 0;
                for (let k = 0; k < 6; k++) {
                    const j = c + STEPS[k];
                    OUT[k] = cap[j] > 0 && ml[j] < OVER * cap[j] ? Math.max(0.03, downs[d0 + k] + 0.35) : 0;
                    sum += OUT[k];
                }
                if (change[c] === 0) touch(c);
                change[c] -= spare;
                if (sum > 0) { for (let k = 0; k < 6; k++) if (OUT[k] > 0) give(c, c + STEPS[k], (spare * OUT[k]) / sum); }
                else {
                    const gathered = (this.drips.get(c) ?? 0) + spare;
                    if (gathered >= DRIP) { this._drip(c, gathered); this.drips.delete(c); } else this.drips.set(c, gathered);
                }
                have -= spare;
            }
            const full = have / hold;
            // Cloth barely damp hardly wicks at all (the square of its fullness): not worth working out.
            if (full < 0.02) continue;
            let total = 0;
            for (let k = 0; k < 6; k++) {
                OUT[k] = 0;
                const j = c + STEPS[k], cj = cap[j];
                if (cj === 0) continue;
                const fj = ml[j] / cj;
                // A fuller neighbour asleep could give to this one: wake it.
                if (!isActive[j] && fj > full * 1.3 + 0.03) { quiet[j] = 0; this._queue(j); }
                let flow = 0;
                // Wicking: from fuller to emptier, readily where both are wet, hardly at all into dry fibre from a damp
                // one (so the edge of a stain is sharp).
                if (full > fj) { const m = (full + fj) * 0.5; flow = WICK * m * m * (full - fj) * (hold < cj ? hold : cj) * weave[j]; }
                // Free blood past what wicking holds runs down.
                const dk = downs[d0 + k];
                if (dk > 0.2 && full > HOLDS && fj < OVER) flow += DRAINS * (full - HOLDS) * dk * hold;
                OUT[k] = flow * step;
                total += OUT[k];
            }
            if (total === 0) continue;
            const scale = total > have * 0.45 ? (have * 0.45) / total : 1;
            if (change[c] === 0) touch(c);
            change[c] -= total * scale;
            for (let k = 0; k < 6; k++) if (OUT[k] > 0) give(c, c + STEPS[k], OUT[k] * scale);
        }
        for (let i = 0; i < nt; i++) {
            const c = touched[i], d = change[c];
            if (d === 0) continue;
            // Still changing, or settled. (What flows in and out at once, as blood wicked up against gravity draining it
            // down, is no change.)
            if (Math.abs(d) > cap[c] * 0.004) quiet[c] = 0;
            const v = ml[c] + d;
            ml[c] = v > 0 ? v : 0;
            change[c] = 0;
            this._encode(c, born[c] === this.clock);
        }
        for (let i = 0; i < count; i++) { const c = work[i]; if (quiet[c] === 0 || ++quiet[c] < 4) this._queue(c); }
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

    // What changed goes up to the card, not oftener than SENDS, in runs of 8-cube bricks; and every few seconds every
    // cube with blood in it is coloured again, as it dries.
    _send() {
        if (this.clock - this.shaded > 12 && this.live.length) {
            this.shaded = this.clock;
            for (const c of this.live) this._encode(c, true);
        }
        if (!this.dirty.size || this.clock - this.sent < SENDS) return;
        this.sent = this.clock;
        const n = this.grid.n, rows = new Map<number, number[]>();
        for (const k of this.dirty) {
            const row = (k / 64) | 0, x = k % 64, r = rows.get(row);
            if (!r) rows.set(row, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
        }
        for (const [row, [x0, x1]] of rows) {
            const y = (row % 64) * 8, z = ((row / 64) | 0) * 8;
            sendPart(this.texture, this.data, n, [x0 * 8, y, z, Math.min(n[0], x1 * 8 + 8), Math.min(n[1], y + 8), Math.min(n[2], z + 8)]);
        }
        this.dirty.clear();
    }

    dispose() { this.texture.dispose(); }
}

const STEPS = new Int32Array(6), OUT = new Float64Array(6), DOWN = new V3(0, -1, 0);

function grown(a: Int32Array) {
    const b = new Int32Array(a.length * 2);
    b.set(a);
    return b;
}

export { OVER, VOX };
