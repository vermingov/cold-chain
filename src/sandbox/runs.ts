// Blood on a body: what it does once it is on the skin.
//
// Blood out of a wound, or a drop that lands on someone, sits where it is as
// a bead, held by the skin, until there is enough of it for its weight to
// tear it loose (on upright skin about a hundredth of a millilitre; on skin
// lying flat far more, and there it spreads into a puddle first). Then it
// runs downhill over the body as the body lies now, as fast as its weight
// and the slope drive it through its own stickiness, wandering a little as
// the skin's grain turns it, leaving a film behind that uses it up. Blood
// coming after it finds the wetted path and keeps to it, running faster and
// losing less, so a wound that keeps bleeding draws one rivulet that grows
// longer and longer; rivulets that meet join, and a heavy one splits. Where
// the skin turns to face the floor (a chin, a nose, an elbow, the fingertips)
// it gathers into a hanging drop that falls when it is heavy enough (about
// 0.05 ml). It soaks into clothes it reaches (soak.ts), and goes into the
// pool when it reaches the floor.
//
// All of it happens on the person at rest, where the skin never moves: a run
// is a point on the rest mesh, and "downhill" is the world's down turned into
// the rest frame of the bone it is on. So a man rolled over has his blood
// start running the other way. What it leaves is painted into the skin's
// film (film.ts); the bead running at its head is drawn by blood.ts.

import * as BABYLON from '@babylonjs/core';
import { DRIP } from './fluid.ts';
const V3 = BABYLON.Vector3;
const TMP = new V3();

const CELL = 0.03;          // metres: the grid the skin's triangles are filed in, for finding the one under a point
const WETS = 0.004;         // metres: the cells the wetted paths are kept in
const STEP = 1 / 30;        // seconds between moves of the runs
const MOST = 60;            // runs on one person at once
const HOLDS = 0.012;        // ml: the bead upright skin holds before it runs (less is held where it is less steep)
const SPEED = 0.06;         // metres a second a 0.05 ml bead runs straight down dry skin
const LEAVES = 0.0035;      // ml a run leaves on each centimetre of dry skin
const LEAVES_WET = 0.0004;  // and of skin already wet with blood
const POOLS = 0.0008;       // metres: how deep blood lying on flat skin stands

type Run = { rest: BABYLON.Vector3; ml: number; hit: any; age: number; still: number; moving: boolean; hang: boolean; turn: number; spread: number;
    way: BABYLON.Vector3; from: object | null };

// The skin and the clothes of a body, filed by where their triangles are at rest (each in every cell its box touches,
// so that looking near a point needs only the cells within reach of it), with a ball round each (its middle and how far
// its corners reach) to pass most of them by at a glance, which triangles meet at each corner, and which are the skin
// under the clothes. Made once per body.
const filed = new Map<string, any>();
function fileOf(npc) {
    const key = npc.person.bodyName;
    if (filed.has(key)) return filed.get(key);
    const { header, arrays } = npc.person.lib.bodies.get(key);
    const pos = arrays.position, index = arrays.index;
    const grids = { skin: new Map(), cloth: new Map(), around: new Map<number, number[]>(), ball: new Float32Array(index.length / 3 * 4),
        under: new Uint8Array(index.length / 3), seen: new Uint32Array(index.length / 3), looks: 0 };
    for (const part of header.parts) {
        const grid = part.kind === 'skin' ? grids.skin : part.kind === 'cloth' ? grids.cloth : null;
        if (!grid) continue;
        for (let t = part.indexStart; t < part.indexStart + part.indexCount; t += 3) {
            let x = 0, y = 0, z = 0;
            for (let k = 0; k < 3; k++) {
                const v = index[t + k];
                x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2];
                if (part.kind === 'skin') { if (!grids.around.has(v)) grids.around.set(v, []); grids.around.get(v).push(t); }
            }
            x /= 3; y /= 3; z /= 3;
            let r = 0;
            const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (let k = 0; k < 3; k++) {
                const v = index[t + k];
                r = Math.max(r, Math.hypot(pos[v * 3] - x, pos[v * 3 + 1] - y, pos[v * 3 + 2] - z));
                for (let e = 0; e < 3; e++) { lo[e] = Math.min(lo[e], pos[v * 3 + e]); hi[e] = Math.max(hi[e], pos[v * 3 + e]); }
            }
            grids.ball.set([x, y, z, r], (t / 3) * 4);
            if (part.under) grids.under[t / 3] = 1;
            for (let i = Math.floor(lo[0] / CELL); i <= Math.floor(hi[0] / CELL); i++)
                for (let j = Math.floor(lo[1] / CELL); j <= Math.floor(hi[1] / CELL); j++)
                    for (let k = Math.floor(lo[2] / CELL); k <= Math.floor(hi[2] / CELL); k++) {
                        const cell = cellKey(i, j, k);
                        if (!grid.has(cell)) grid.set(cell, []);
                        grid.get(cell).push(t);
                    }
        }
    }
    filed.set(key, grids);
    return grids;
}

export class Runs {
    declare npc: any;
    declare runs: Run[];
    declare clock: number;
    declare wet: Map<number, number>;

    constructor(npc) {
        this.npc = npc;
        this.runs = [];
        this.clock = 0;
        this.wet = new Map();
    }

    // `ml` of blood put on the skin at `hit` (a crossing from npc.surface, or a place found by `onto`). Onto a bead
    // already there, if there is one. Blood from a wound that keeps bleeding (`from`, the bleed) feeds the stream that
    // wound already has running, wherever its head has got to: it comes down the wet track behind it.
    start(hit, ml: number, from: object | null = null) {
        if (!hit || ml <= 0) return;
        if (hit.kind === 'cloth') { this.npc.soak?.add(hit.rest, ml); return; }
        if (from) {
            const head = this.runs.find((r) => r.from === from);
            if (head) { head.ml += ml; head.still = 0; return; }
        }
        let near = null, best = 0.004 * 0.004;
        for (const r of this.runs) {
            const d = V3.DistanceSquared(r.rest, hit.rest);
            if (d < best) { best = d; near = r; }
        }
        if (!near && this.runs.length >= MOST) near = this.runs.reduce((a, b) => (V3.DistanceSquared(a.rest, hit.rest) < V3.DistanceSquared(b.rest, hit.rest) ? a : b));
        if (near) { near.ml += ml; near.still = 0; return; }
        this.runs.push({ rest: hit.rest.clone(), ml, hit, age: 0, still: 0, moving: false, hang: false, turn: 0, spread: 0, way: V3.Zero(), from });
    }

    // The place on this person's skin (or clothes) nearest a world point, as a crossing: or null if it is not on them.
    onto(world: BABYLON.Vector3, owner) {
        const m = this.npc.restToWorld(owner);
        const rest = V3.TransformCoordinates(world, m.clone().invert());
        return this.nearest(rest, 0.03);
    }

    // The nearest skin or clothes to a rest-space point, within `far`, as a crossing: { kind, rest, restNormal, uv,
    // scale, owner }.
    nearest(rest: BABYLON.Vector3, far = 0.015) {
        const grids = fileOf(this.npc);
        let best = null;
        for (const kind of ['cloth', 'skin']) {
            const found = this._closest(grids[kind], rest, far);
            if (found && (!best || found.d < best.d - 0.004)) best = { ...found, kind };
        }
        return best ? this._crossing(best.t, best.w, best.kind) : null;
    }

    // A crossing like npc.crossing's, and whether it is on the skin under the clothes.
    _crossing(t: number, w: number[], kind: string) {
        const c = this.npc.crossing(t, w, kind);
        c.under = kind === 'skin' && fileOf(this.npc).under[t / 3] === 1;
        return c;
    }

    _closest(grid, p: BABYLON.Vector3, far) {
        // A triangle is in every cell its box touches: once each, however many of the cells within reach it is in.
        const filed = fileOf(this.npc), seen = filed.seen, look = ++filed.looks;
        const list = [];
        for (let i = Math.floor((p.x - far) / CELL); i <= Math.floor((p.x + far) / CELL); i++)
            for (let j = Math.floor((p.y - far) / CELL); j <= Math.floor((p.y + far) / CELL); j++)
                for (let k = Math.floor((p.z - far) / CELL); k <= Math.floor((p.z + far) / CELL); k++) {
                    const here = grid.get(cellKey(i, j, k));
                    if (here) for (const t of here) if (seen[t / 3] !== look) { seen[t / 3] = look; list.push(t); }
                }
        return this._best(list, p, far);
    }

    _best(list: Iterable<number>, p: BABYLON.Vector3, far: number) {
        const { arrays } = this.npc.person.lib.bodies.get(this.npc.person.bodyName);
        const pos = arrays.position, index = arrays.index, ball = fileOf(this.npc).ball;
        let best = null, near = far;
        for (const t of list) {
            const i = (t / 3) * 4;
            const bx = p.x - ball[i], by = p.y - ball[i + 1], bz = p.z - ball[i + 2], reach = near + ball[i + 3];
            if (bx * bx + by * by + bz * bz > reach * reach) continue;
            const d = closestOnTriangle(p.x, p.y, p.z, pos, index[t] * 3, index[t + 1] * 3, index[t + 2] * 3);
            if (d < near) { near = d; best = { t, w: [NEAREST[0], NEAREST[1], NEAREST[2]], d }; }
        }
        return best;
    }

    // The skin near a place a run is at, found by looking only at the triangles round the one it is on (a run moves
    // millimetres a step); the whole grid only if that finds nothing (a seam in the skin's picture).
    _step(hit, p: BABYLON.Vector3) {
        const around = fileOf(this.npc).around;
        const list = new Set<number>();
        for (const v of hit.corners ?? []) for (const t of around.get(v) ?? []) list.add(t);
        const found = this._best(list, p, 0.004);
        if (found) return this._crossing(found.t, found.w, 'skin');
        return this.nearest(p, 0.02);
    }

    // Where `rest`, on the skin at crossing `hit`, is drawn now: carried by each bone the skin there moves with, as much
    // as it does, as the skin itself is (by its one main bone alone, a drop hung a couple of centimetres off the chin
    // of a jaw hanging open). `matrix` gives a bone's rest-to-world matrix.
    _at(hit, rest: BABYLON.Vector3, matrix: (owner) => BABYLON.Matrix) {
        const weights = hit.weights ?? (hit.weights = hit.corners ? this.npc.weightsAt(hit.corners, hit.shares) : [{ owner: hit.owner, w: 1 }]);
        const out = new V3(), p = TMP;
        for (const { owner, w } of weights) out.addInPlace(V3.TransformCoordinatesToRef(rest, matrix(owner), p).scaleInPlace(w));
        return out;
    }

    _wetKey(p: BABYLON.Vector3) {
        return (Math.floor(p.x / WETS) + 512) + (Math.floor(p.y / WETS) + 512) * 1024 + (Math.floor(p.z / WETS) + 512) * 1048576;
    }

    // Every few hundredths of a second: each run is held, or runs on downhill and leaves its trail.
    update(dt: number) {
        this.clock += dt;
        if (this.clock >= STEP && this.runs.length) {
            const step = this.clock;
            this.clock = 0;
            this._move(step);
        }
        this._draw();
    }

    _move(step: number) {
        const { npc } = this, film = npc.film, blood = npc.world.blood;
        const frames = new Map();
        const frame = (owner) => {
            let f = frames.get(owner);
            if (!f) {
                const m = npc.restToWorld(owner), inv = m.clone().invert();
                f = { m, down: V3.TransformNormal(new V3(0, -1, 0), inv).normalize() };
                frames.set(owner, f);
            }
            return f;
        };
        const kept: Run[] = [];
        for (const run of this.runs) {
            run.age += step;
            const hit = run.hit, n = hit.restNormal, f = frame(hit.owner);
            const along = f.down.subtract(n.scale(V3.Dot(f.down, n)));
            const steep = along.length();
            const at = this._at(hit, run.rest, (o) => frame(o).m), facing = V3.TransformNormal(n, f.m).normalize();
            // At the floor: into the pool there.
            if (at.y < 0.02) { blood.floor.add(at.x, at.z, run.ml); continue; }
            // Skin facing the floor, or a low point it cannot run on from: it hangs, and falls a drop at a time. Only while
            // that skin still faces down: a body turned over takes the drop round with it, and it runs on from there.
            // (Kept hanging, it went on dripping from the skin's top, the drops falling out through the body.)
            if (run.hang && facing.y > -0.1) run.hang = false;
            if (facing.y < -0.85 || run.hang) {
                run.hang = true;
                run.moving = false;
                while (run.ml >= DRIP) {
                    blood.drip(at.add(facing.scale(0.002)).addInPlaceFromFloats(0, -0.003, 0), DRIP);
                    run.ml -= DRIP;
                }
                run.still += step;
                if (run.still < 90 && run.ml > 0.002) kept.push(run);
                continue;
            }
            const holds = HOLDS / Math.max(0.06, steep);
            if (!run.moving) {
                if (run.ml < holds) {
                    // Held: on flat skin it spreads into a puddle as wide as it is deep; then, unfed, it dries where it is.
                    const r = Math.sqrt((run.ml * 1e-6) / (Math.PI * POOLS));
                    if (r > run.spread * 1.15 && r > 0.0015) { film?.blot(hit, r, POOLS * 1000 * 0.6); run.spread = r; }
                    run.still += step;
                    if (run.still < 25) kept.push(run);
                    else film?.blot(hit, Math.max(0.0015, r), 0.25);
                    continue;
                }
                run.moving = true;
            }
            // Running: downhill, turned a little by the skin's grain, and toward blood already run here.
            const base = steep > 1e-4 ? along.scale(1 / steep) : tangentOf(n);
            const side = V3.Cross(n, base);
            run.turn += (Math.random() - 0.5) * 0.35 - run.turn * 0.15;
            const probe = (a) => this.wet.get(this._wetKey(run.rest.add(base.scale(Math.cos(a) * 0.006)).addInPlace(side.scale(Math.sin(a) * 0.006)))) ?? 0;
            const left = probe(-0.5), right = probe(0.5), ahead = probe(0);
            if (Math.max(left, right) > Math.max(0.002, ahead * 1.5)) run.turn = run.turn * 0.5 + (left > right ? -0.5 : 0.5) * 0.5;
            const way = base.scale(Math.cos(run.turn)).addInPlace(side.scale(Math.sin(run.turn)));
            const wet = ahead > 0.002;
            const go = Math.min(0.03, SPEED * steep * Math.min(8, Math.max(0.35, Math.pow(run.ml / 0.05, 2 / 3))) * (wet ? 2 : 1) * step);
            const next = this._step(hit, run.rest.add(way.scale(go)));
            // Nowhere on from here (a seam in the skin's picture): it gathers here as at a low point.
            if (!next) {
                if (facing.y < -0.1) { run.hang = true; kept.push(run); continue; }
                const r = Math.sqrt((run.ml * 1e-6) / (Math.PI * POOLS));
                if (r > run.spread * 1.15) { film?.blot(hit, r, POOLS * 1000 * 0.6); run.spread = r; }
                run.moving = false;
                if ((run.still += step) < 25) kept.push(run);
                continue;
            }
            // Into the clothes; or under them, where the cloth lying on the skin drinks it.
            if ((next.kind === 'cloth' || next.under) && (npc.soak?.add(next.rest, run.ml) || next.kind === 'cloth')) continue;
            // Downhill along the skin leads up again: this is the lowest place. Facing down, it gathers into a drop
            // here; facing up (an eye socket, the hollow of a collarbone), it fills it, and spills over once full.
            if (this._at(next, next.rest, (o) => frame(o).m).y > at.y + 0.0002) {
                if (facing.y < -0.1) { run.hang = true; kept.push(run); continue; }
                if (run.ml < 1.5) {
                    const r = Math.sqrt((run.ml * 1e-6) / (Math.PI * POOLS));
                    if (r > run.spread * 1.15) { film?.blot(hit, r, POOLS * 1000 * 0.6); run.spread = r; }
                    run.turn = (Math.random() - 0.5) * 2.5;
                    kept.push(run);
                    continue;
                }
            }
            // Under an overhang (the brow, the jaw) a heavy stream lets drops go as it passes.
            if (facing.y < -0.3 && run.ml > DRIP * 2) {
                blood.drip(at.add(facing.scale(0.002)), DRIP);
                run.ml -= DRIP;
            }
            // What it leaves behind, and the streak that is.
            const left2 = Math.min(run.ml, (wet ? LEAVES_WET : LEAVES) * go * 100);
            const key = this._wetKey(next.rest);
            this.wet.set(key, (this.wet.get(key) ?? 0) + left2);
            const bead = 1.6 * Math.cbrt(run.ml * 1000) / 1000;
            const wide = Math.min(0.008, Math.max(0.0012, bead * 0.55));
            film?.stroke(hit, next, wide, Math.min(0.4, Math.max(0.03, (left2 * 1000) / (wide * 1000 * Math.max(0.5, go * 1000)))));
            run.ml -= left2;
            run.way = V3.TransformNormal(way, f.m);
            run.rest = next.rest;
            run.hit = next;
            run.still = 0;
            if (run.ml < holds * 0.6) run.moving = false;
            // A heavy run splits where the skin lets it go two ways.
            if (run.ml > 0.12 && Math.random() < 0.015 * (run.ml / 0.12) && this.runs.length + kept.length < MOST) {
                const share = run.ml * 0.35;
                run.ml -= share;
                kept.push({ ...run, rest: run.rest.clone(), ml: share, turn: run.turn + (Math.random() < 0.5 ? -0.6 : 0.6), spread: 0 });
            }
            if (run.age < 300) kept.push(run);
        }
        // Runs that meet join.
        for (let i = 0; i < kept.length; i++) {
            const a = kept[i];
            if (!a) continue;
            for (let j = i + 1; j < kept.length; j++) {
                const b = kept[j];
                if (!b || V3.DistanceSquared(a.rest, b.rest) > 0.003 * 0.003) continue;
                a.ml += b.ml;
                a.moving = a.moving || b.moving;
                kept[j] = null;
            }
        }
        this.runs = kept.filter(Boolean);
    }

    // The bead at the head of each run, and the drop hanging where one is about to fall, where they are this frame.
    _draw() {
        const blood = this.npc.world.blood, frames = new Map();
        const matrix = (owner) => { let m = frames.get(owner); if (!m) { m = this.npc.restToWorld(owner); frames.set(owner, m); } return m; };
        for (const run of this.runs) {
            const bead = 1.6 * Math.cbrt(run.ml * 1000) / 1000;
            if (bead < 0.0012) continue;
            const at = this._at(run.hit, run.rest, matrix), normal = V3.TransformNormal(run.hit.restNormal, matrix(run.hit.owner)).normalize();
            const r = bead / 2, h = Math.min(0.0014, r * 0.5);
            const way = run.way.lengthSquared() > 0.1 ? run.way : V3.Cross(normal, V3.Right());
            blood.bead(at, normal, way.normalize(), r, h, run.hang ? Math.min(0.006, (run.ml / DRIP) * r * 1.4) : 0);
        }
    }
}

function cellKey(i: number, j: number, k: number) { return (i + 512) + (j + 512) * 1024 + (k + 512) * 1048576; }

// Some direction along a surface whose normal is `n`.
function tangentOf(n: BABYLON.Vector3) {
    const hint = Math.abs(n.y) < 0.9 ? V3.Up() : V3.Forward();
    return hint.subtract(n.scale(V3.Dot(hint, n))).normalize().scale(-1);
}

// How far point p is from the triangle whose corners start at `a`, `b`, `c` in `pos`; how much of each corner the
// nearest point of it is goes into NEAREST. (Ericson's closest point on a triangle, in plain numbers: it is run for
// every triangle near every drop that reaches someone.)
const NEAREST = new Float64Array(3);
function closestOnTriangle(px: number, py: number, pz: number, pos: ArrayLike<number>, a: number, b: number, c: number) {
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const abx = pos[b] - ax, aby = pos[b + 1] - ay, abz = pos[b + 2] - az, acx = pos[c] - ax, acy = pos[c + 1] - ay, acz = pos[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    let u: number, v: number;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d1 <= 0 && d2 <= 0) { u = 0; v = 0; }
    else if (d3 >= 0 && d4 <= d3) { u = 1; v = 0; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); v = 0; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; v = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; v = d2 / (d2 - d6); }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { v = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 1 - v; }
    else { const den = 1 / (va + vb + vc); u = vb * den; v = vc * den; }
    NEAREST[0] = 1 - u - v; NEAREST[1] = u; NEAREST[2] = v;
    const dx = apx - abx * u - acx * v, dy = apy - aby * u - acy * v, dz = apz - acz * v - abz * u;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
