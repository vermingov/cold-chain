// The field: the front of the body, as the knife finds it.
//
// A body on its back is, to whoever is opening it, a surface seen from
// above: so far across, so far down from the neck, and at each place a
// height. Everything the knife does is kept in those terms, over the trunk
// from the collarbones to the pubis.
//
// The surface is taken once from the skinned mesh, by drawing its triangles
// into a grid: height, which way the skin faces, and where on the skin's
// own picture each place is. The dead do not move. Which way the body as a
// whole lies at each place is kept too (`lean`): a wound opens along that,
// not along whatever the skin is doing in the pit of a navel.
//
// What the body is made of there, and what a blade does to it, are
// tissue.js's and blade.js's. What is here is the body they are told about:
// where its edge is, where the ribs stop a blade, how tight it is drawn.

import { Blade } from './blade.js';
import { lattice } from './lattice.js';
import { SKIN, Tissue } from './tissue.js';

export const HEIGHT_PX = 0.002; // metres to a square of the surface's grid
// How far past the joints the field goes: above the neck, below the hips, beyond the shoulders.
const MARGIN = { head: -0.02, feet: 0.11, side: 0.03 };
const BROAD = 7;                // squares of the surface's grid either way that the lie of the body is taken over
const THROAT = 0.03;            // how far down the field (of 1) the neck goes: nothing under the skin is drawn above that
// Where the tissue that can be cut takes over from the body's own skin, in
// metres in from the edge of the trunk: the net begins at `net` (or a step
// of the net further in, its edge being ragged), the body's skin stops
// being drawn at `skin`, and out as far as `held` the net is fixed to the
// body, so that where the two meet nothing moves.
export const EDGE = { net: 0.006, skin: 0.013, held: 0.022 };
// How tight the skin and the deep sheet are drawn, across the belly and
// down it, as a share of their length. Skin is tightest across (its lines of
// tension run round the belly): a 10 cm cut down the belly gapes 6-10 mm,
// one across it 2-4 mm. The white seam down the middle hardly gapes at all,
// 2-5 mm cut down it and next to nothing across (dev/research/
// tissue-mechanics.md, "Suggested targets"; these were tuned against them
// with ~/.cache/cold-chain/gape.mjs).
const TIGHT = [[0.12, 0.028], [0.012, 0.003]];
// Either side of the seam down the middle, `SEAM` metres from it, the deep
// sheet is muscle in its sheath: soft, and drawn back 1-3 mm from a cut.
const MUSCLE = [0.006, 0.004], SEAM = 0.01;
const SPARE = 3;                // milliseconds a frame the tissue is given to move in, after its first turn
const BLADE = 0.0025;           // metres of room a blade or a finger needs to get into a wound
export const WALL = 0.024;      // metres from the skin to the inside, through the wall of the belly
const SKIN_PROPER = 0.083;      // of the wall: the skin itself, over its fat (blade.js's HIDE)
// Where the ribs are. The breastbone ends this far down the field (of 1),
// and the edge of the ribs falls away from there toward each flank by so
// much for the whole width. Over them a blade goes no deeper than the bone,
// which falls away over `edge` metres at their edge.
export const RIBS = { end: 0.37, falls: 0.4, bone: 0.8, edge: 0.012 };

export class Field {
    constructor(scene, person) {
        // The trunk's own frame on the table: where its corner is, which way
        // is across (toward the body's left) and which way is down it.
        const flat = (v) => [v.x, v.z];
        const neck = flat(person.joint('neck01')), shoulders = [flat(person.joint('upperarm01.L')), flat(person.joint('upperarm01.R'))];
        const hips = [flat(person.joint('upperleg01.L')), flat(person.joint('upperleg01.R'))];
        const groin = [(hips[0][0] + hips[1][0]) / 2, (hips[0][1] + hips[1][1]) / 2];
        const trunk = Math.hypot(groin[0] - neck[0], groin[1] - neck[1]);
        this.along = [(groin[0] - neck[0]) / trunk, (groin[1] - neck[1]) / trunk];
        const left = [shoulders[0][0] - shoulders[1][0], shoulders[0][1] - shoulders[1][1]];
        const side = -this.along[1] * left[0] + this.along[0] * left[1] > 0 ? 1 : -1;
        this.across = [-this.along[1] * side, this.along[0] * side];
        this.width = Math.hypot(...left) + 2 * MARGIN.side;
        this.length = trunk + MARGIN.head + MARGIN.feet;
        this.origin = [neck[0] - this.along[0] * MARGIN.head - this.across[0] * this.width / 2,
            neck[1] - this.along[1] * MARGIN.head - this.across[1] * this.width / 2];

        this.blade = { u: 0, v: 0, sinks: 0 };      // where the point of the blade is, and how hard it bears on the skin (metres)

        this._measure(person);
        this.cover = new BABYLON.RawTexture(Uint8Array.from(this.inland, (far) => Math.min(255, far * 16)), this.hw, this.hh,
            BABYLON.Engine.TEXTUREFORMAT_R, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
        this.cover.wrapU = this.cover.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

        this.tissue = new Tissue(lattice(this.width, this.length, (x, y) => this._inland(x, y) >= EDGE.net), {
            held: (x, y) => this._inland(x, y) < EDGE.held,
            bone: (x, y) => this._belly(x, y) < 0,
            strain: (sheet, x) => (sheet === 1 && Math.abs(x - this.width / 2) > SEAM ? MUSCLE : TIGHT[sheet]),
            thick: [SKIN * WALL, (1 - SKIN) * WALL],
            bears: [SKIN_PROPER / SKIN, 1],
        });
        this.stirred = false;
        this.tissue.rouse();
        this.knife = new Blade(this.tissue, (x, y) => RIBS.bone + (1 - RIBS.bone) * Math.max(0, Math.min(1, this._belly(x, y) / RIBS.edge)));
    }

    // --- where things are ---------------------------------------------------

    // Where a point of the world is on the field: [u, v], each 0 to 1 inside it.
    place(x, z) {
        const dx = x - this.origin[0], dz = z - this.origin[1];
        return [(dx * this.across[0] + dz * this.across[1]) / this.width, (dx * this.along[0] + dz * this.along[1]) / this.length];
    }

    // The same as two rows a shader can use: u = dot(vec3(x, z, 1), rows.u).
    get rows() {
        const row = (axis, size) => [axis[0] / size, axis[1] / size, -(this.origin[0] * axis[0] + this.origin[1] * axis[1]) / size];
        return { u: row(this.across, this.width), v: row(this.along, this.length) };
    }

    // The body's surface over the field, from its skin as posed.
    _measure(person) {
        const hw = this.hw = Math.ceil(this.width / HEIGHT_PX), hh = this.hh = Math.ceil(this.length / HEIGHT_PX);
        const heights = this.heights = new Float32Array(hw * hh).fill(-Infinity);
        // And at each place: which way the skin faces, and where on the skin's picture it is.
        const faces = this.faces = new Float32Array(hw * hh * 3), picture = this.picture = new Float32Array(hw * hh * 2);
        const over = [];            // every triangle of skin over the field: its corners in the mesh, its middle here
        const mesh = person.mesh, world = mesh.computeWorldMatrix(true);
        const local = mesh.getPositionData(true, true), lean = mesh.getNormalsData(true, true), uvs = mesh.getVerticesData('uv');
        const index = mesh.getIndices(), p = new BABYLON.Vector3(), n = new BABYLON.Vector3();
        // A forearm lying beside the hip is over the field too, and is not
        // part of it: leave out whatever hangs mostly on its bones. (The
        // shoulder is: it is the top of the trunk's own corner.)
        const { joints, weights } = person.lib.bodies.get(person.bodyName).arrays;
        const arm = person.header.bones.map((b) => /lowerarm|wrist|finger|metacarpal/.test(b.name));
        const onArm = (i) => {
            let most = 0;
            for (let k = 1; k < 4; k++) if (weights[i * 4 + k] > weights[i * 4 + most]) most = k;
            return arm[joints[i * 4 + most]];
        };
        // A corner of the mesh as the field has it: across, down, height, then its lean and its place on the picture.
        const corner = (i) => {
            BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(local[i * 3], local[i * 3 + 1], local[i * 3 + 2], world, p);
            BABYLON.Vector3.TransformNormalFromFloatsToRef(lean[i * 3], lean[i * 3 + 1], lean[i * 3 + 2], world, n);
            const [u, v] = this.place(p.x, p.z);
            return [u * hw, v * hh, p.y, n.x, n.y, n.z, uvs[i * 2], uvs[i * 2 + 1]];
        };
        for (const part of person.header.parts.filter((q) => q.kind === 'skin')) {
            for (let t = part.indexStart; t < part.indexStart + part.indexCount; t += 3) {
                if (onArm(index[t]) || onArm(index[t + 1]) || onArm(index[t + 2])) continue;
                const [a, b, c] = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
                const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
                if (Math.abs(area) < 1e-9) continue;
                if ([a, b, c].every((q) => q[0] > -4 && q[0] < hw + 4 && q[1] > THROAT * hh && q[1] < hh + 4)) {
                    over.push({ corners: [index[t], index[t + 1], index[t + 2]], middle: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3) });
                }
                const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(hw - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
                const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(hh - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        // How much of each corner this pixel is.
                        const wa = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
                        const wb = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
                        const wc = 1 - wa - wb;
                        if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
                        const mix = (k) => wa * a[k] + wb * b[k] + wc * c[k], at = y * hw + x;
                        // The top of the body is what is wanted: its back is under it.
                        if (mix(2) <= heights[at]) continue;
                        heights[at] = mix(2);
                        faces.set([mix(3), mix(4), mix(5)], at * 3);
                        picture.set([mix(6), mix(7)], at * 2);
                    }
                }
            }
        }
        this.top = heights.reduce((m, v) => Math.max(m, v), -Infinity);
        const onBody = (at) => heights[at] > -Infinity;
        this.lean = evened(evened(faces, onBody, hw, hh, 1, BROAD), onBody, hw, hh, hw, BROAD);

        // How far in from the edge of the body each place is, in pixels of
        // this grid: two sweeps, each pixel one more than its nearest
        // neighbour already counted.
        const inland = this.inland = new Float32Array(hw * hh);
        const sweep = (from, to, step) => {
            for (let y = from[1]; y !== to[1]; y += step) {
                for (let x = from[0]; x !== to[0]; x += step) {
                    const at = y * hw + x, edge = x === 0 || y === 0 || x === hw - 1 || y === hh - 1;
                    if (heights[at] === -Infinity || edge) { inland[at] = 0; continue; }
                    inland[at] = Math.min(step > 0 ? Infinity : inland[at], inland[at - step] + 1, inland[at - step * hw] + 1);
                }
            }
        };
        sweep([0, 0], [hw, hh], 1);
        sweep([hw - 1, hh - 1], [-1, -1], -1);
        // The whole trunk under the field, front and back, for whatever is drawn inside it.
        this.around = over.flatMap((t) => t.corners);
    }

    // The four places of the surface's grid round [u, v], and how much of each [u, v] is: [[index, share], ...].
    _round(u, v) {
        const x = Math.max(0, Math.min(this.hw - 1.001, u * this.hw - 0.5)), y = Math.max(0, Math.min(this.hh - 1.001, v * this.hh - 0.5));
        const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, at = j * this.hw + i;
        return [[at, (1 - fx) * (1 - fy)], [at + 1, fx * (1 - fy)], [at + this.hw, (1 - fx) * fy], [at + this.hw + 1, fx * fy]];
    }

    // The height of the body at [u, v], or -Infinity off it.
    heightAt(u, v) {
        return this._round(u, v).reduce((height, [at, share]) => height + this.heights[at] * share, 0);
    }

    // The skin at [u, v] as it was taken from the body: its height, which
    // way it faces, which way the body lies under it, and where on the
    // skin's own picture it is. At the very edge of the body, whatever of it
    // is there; off it, null.
    skinAt(u, v) {
        const skin = { height: 0, faces: [0, 0, 0], lean: [0, 0, 0], picture: [0, 0] };
        let whole = 0;
        for (const [at, share] of this._round(u, v)) {
            if (this.heights[at] === -Infinity) continue;
            whole += share;
            skin.height += this.heights[at] * share;
            for (let k = 0; k < 3; k++) skin.faces[k] += this.faces[at * 3 + k] * share;
            for (let k = 0; k < 3; k++) skin.lean[k] += this.lean[at * 3 + k] * share;
            for (let k = 0; k < 2; k++) skin.picture[k] += this.picture[at * 2 + k] * share;
        }
        if (whole < 1e-6) return null;
        skin.height /= whole;
        skin.picture = skin.picture.map((p) => p / whole);
        return skin;
    }

    // The point of the world over [u, v] on the skin.
    point(u, v) {
        return new BABYLON.Vector3(this.origin[0] + this.across[0] * u * this.width + this.along[0] * v * this.length, this.heightAt(u, v),
            this.origin[1] + this.across[1] * u * this.width + this.along[1] * v * this.length);
    }

    // Which way the body faces at [u, v]: its broad lie, which is there right
    // up to the edge of the body (the slope of the heights is not: a step
    // off the edge there is no height).
    normal(u, v) {
        const skin = this.skinAt(u, v);
        return skin ? BABYLON.Vector3.FromArray(skin.lean).normalize() : BABYLON.Vector3.Up();
    }

    // Where a ray from above first meets the body: { u, v, point }, or null
    // if it misses the trunk.
    hit(ray) {
        const { origin, direction } = ray;
        if (direction.y > -0.05) return null;
        const under = (t) => {
            const x = origin.x + direction.x * t, y = origin.y + direction.y * t, z = origin.z + direction.z * t;
            const [u, v] = this.place(x, z);
            if (u < 0 || u > 1 || v < 0 || v > 1) return null;
            const height = this.heightAt(u, v);
            return height > -Infinity && y < height ? [u, v] : null;
        };
        // Down from just above the highest point of the body, a few
        // millimetres at a time, then the last step halved until it is fine.
        let t = (this.top + 0.01 - origin.y) / direction.y;
        const step = 0.004, far = (this.top - 0.4 - origin.y) / direction.y;
        while (t < far && !under(t)) t += step;
        if (t >= far) return null;
        let clear = t - step;
        for (let i = 0; i < 6; i++) {
            const mid = (clear + t) / 2;
            if (under(mid)) t = mid; else clear = mid;
        }
        const [u, v] = under(t);
        return { u, v, point: this.point(u, v) };
    }

    // How far below the edge of the ribs a spot is, in metres down the
    // field: less than nothing is over bone. A spot is [x, y] in metres
    // across the field and down it.
    _belly(x, y) {
        return y - (RIBS.end + RIBS.falls * Math.abs(x / this.width - 0.5)) * this.length;
    }

    // How far in from the edge of the trunk a spot is, in metres.
    _inland(x, y) {
        const i = Math.floor(x / this.width * this.hw), j = Math.floor(y / this.length * this.hh);
        return i < 0 || j < 0 || i >= this.hw || j >= this.hh ? 0 : this.inland[j * this.hw + i] * HEIGHT_PX;
    }

    // --- the blade, the hand, and what they have done ------------------------------

    // The blade goes in: what is cut from now is added to what was there.
    begin() { this.knife.begin(); }

    // The blade drawn from one place to another, each [u, v], pressing so
    // hard that it would go `press` (0 to 1) deeper than the wound was.
    // Returns how far past the whole wall that would have gone, at the most:
    // over nothing, the blade has been in whatever lies under.
    cut(from, to, press) {
        return this.knife.draw(from[0] * this.width, from[1] * this.length, to[0] * this.width, to[1] * this.length, press);
    }

    // The blade held where it is for a moment: it sinks, by `sink` (of 1).
    dwell(at, sink) { this.knife.dwell(at[0] * this.width, at[1] * this.length, sink); }

    // The blade went on without cutting: whatever it cuts next is a cut of its own, not this one carried on.
    lift() { this.knife.lift(); }

    // How far under the skin's own surface the point of a blade at [u, v]
    // comes to rest, in metres. (Round the edge of the trunk there is no
    // tissue to be open: there a blade is on the body's own skin.)
    sunkAt(u, v) {
        const x = u * this.width, y = v * this.length;
        return this._inland(x, y) < EDGE.held ? 0 : this.knife.rests(x, y) * WALL;
    }

    // Once a frame: the tissue moves toward rest. Whether it moved is kept in `stirred`.
    update() { this.stirred = this.tissue.settle(SPARE); }

    // Whether the wall is open at [u, v]: neither skin nor the sheet under
    // it, there or a blade's width to any side. (The lips of a cut that has
    // not gaped are a hair apart, and nothing goes in by a hair.)
    open(u, v) {
        const x = u * this.width, y = v * this.length;
        return [[0, 0], [BLADE, 0], [-BLADE, 0], [0, BLADE], [0, -BLADE]].every(([dx, dy]) => this.tissue.under(0, x + dx, y + dy) < 0 && this.tissue.under(1, x + dx, y + dy) < 0);
    }

    // A hand takes hold of the skin at [u, v] (and of the whole wall, on
    // the lip of a wound that is through it). Returns whether there was
    // anything there to take.
    grab(u, v) { return this.tissue.grab(u * this.width, v * this.length); }

    // The hand moves this far from where it took hold, in [u, v], and what it has comes with it as far as
    // it will.
    drag(du, dv) { this.tissue.drag(du * this.width, dv * this.length); }

    // The hand lets go, and what it had goes back as far as anything still holds it.
    letGo() { this.tissue.letGo(); }

    // A retractor keeps what the hand has where the hand has it, and the hand is free. Whether there was anything.
    pin() { return !!this.tissue.pin(); }

    // The retractor holding nearest [u, v] is taken out. Whether there was one.
    unpin(u, v) { return this.tissue.unpin(u * this.width, v * this.length); }

    // Where each retractor holds, now, and which way it pulls: [{ at: [u, v], pulls: [du, dv] }].
    get pinned() {
        const { tissue } = this;
        return tissue.pins.map((pin) => {
            const point = pin.points[0];
            return { at: [tissue.x[point] / this.width, tissue.y[point] / this.length], pulls: [pin.dx / this.width, pin.dy / this.length] };
        });
    }

    // If what the hand has hold of is a piece that nothing holds any more,
    // it comes away: it is taken out of the tissue and returned as a shape
    // in the world, as it lay (piece.js makes a thing of it), or null. (It
    // is looked for again only when something has been cut or torn.)
    lift() {
        const tissue = this.tissue, has = tissue.hand, asked = tissue.shape + ':' + tissue.tore + ':' + (has && has.tri);
        if (!has || asked === this.asked) return null;
        this.asked = asked;
        const taken = tissue.freed(has.sheet, has.tri);
        if (!taken) return null;
        const shape = this._shape(taken);
        tissue.take(taken);
        return shape;
    }

    // A piece of the tissue as a slab in the world: its top where the top
    // of it is (the skin's surface, or the deep sheet's where only that
    // came), its bottom as far under that as it is thick, straight down the
    // body's lie. { top, bottom, normal: [V3], picture: [u, v] each, tris: [a, b, c] each, rim: [a, b] each
    // (the sides along its edge), skin: whether its top is skin, deep: whether its bottom is the deep sheet }.
    _shape([skinTris, deepTris]) {
        const tissue = this.tissue, skin = skinTris.length > 0, which = skin ? 0 : 1, tris = skin ? skinTris : deepTris, tri = tissue.sheets[which].tri;
        const top = skin ? 0 : SKIN * WALL, thick = (skin ? SKIN * WALL : 0) + (deepTris.length ? (1 - SKIN) * WALL : 0);
        const index = new Map(), shape = { top: [], bottom: [], normal: [], picture: [], tris: [], rim: [], skin, deep: deepTris.length > 0 };
        const corner = (point) => {
            if (index.has(point)) return index.get(point);
            const u = tissue.x[point] / this.width, v = tissue.y[point] / this.length, lean = this.normal(u, v), at = this.point(u, v).subtract(lean.scale(top));
            const p = tissue.place[point], home = this.skinAt(tissue.homeX[p] / this.width, tissue.homeY[p] / this.length);
            index.set(point, shape.top.length);
            shape.top.push(at); shape.bottom.push(at.subtract(lean.scale(thick))); shape.normal.push(lean); shape.picture.push(home ? home.picture : [0, 0]);
            return index.get(point);
        };
        const inside = new Set(tris);
        for (const t of tris) {
            shape.tris.push([corner(tri[t * 3]), corner(tri[t * 3 + 1]), corner(tri[t * 3 + 2])]);
            for (let k = 0; k < 3; k++) {
                const e = tissue.sides[t * 3 + k], other = e < 0 ? -1 : tissue.net.edges.t1[e] === t ? tissue.net.edges.t2[e] : tissue.net.edges.t1[e];
                if (other < 0 || !inside.has(other)) shape.rim.push([corner(tri[t * 3 + k]), corner(tri[t * 3 + (k + 1) % 3])]);
            }
        }
        return shape;
    }

    // Where what the hand has hold of is now, in [u, v] (the middle of it), or null if it has nothing.
    held() {
        const has = this.tissue.hand;
        if (!has) return null;
        let x = 0, y = 0;
        for (const point of has.points) { x += this.tissue.x[point]; y += this.tissue.y[point]; }
        return [x / has.points.length / this.width, y / has.points.length / this.length];
    }
}

// A grid of directions, each evened out with those up to `reach` squares
// from it along one line of the grid (`step` is 1 for across, the grid's
// width for down), counting only squares the body is `on`.
function evened(directions, on, hw, hh, step, reach) {
    const out = new Float32Array(directions.length), line = step === 1 ? hw : hh;
    for (let at = 0; at < hw * hh; at++) {
        if (!on(at)) continue;
        const along = step === 1 ? at % hw : Math.floor(at / hw);
        for (let o = Math.max(-reach, -along); o <= Math.min(reach, line - 1 - along); o++) {
            const other = at + o * step;
            if (!on(other)) continue;
            for (let k = 0; k < 3; k++) out[at * 3 + k] += directions[other * 3 + k];
        }
    }
    return out;
}
