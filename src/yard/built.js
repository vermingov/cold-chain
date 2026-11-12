// What was built: the wall round the place, its gates, the chapel of rest,
// the sexton's lodge, the store.
//
// All of it from the plan, in scanned stone, brick and slate, into one
// buffer per material. A building here is a box under a roof and then
// everything a mason does to stop it looking like one: coped gables,
// buttresses, dressed stone round every opening, quoins, a bellcote,
// gutters and the pipes down from them. These are the outsides only: what
// is inside the chapel is its own scene, and from the yard a window is a
// dark pane and a door is shut.

import { Buf } from '../geometry.js';
import { BOUNDS, BUILDINGS, GATES, heightAt } from '../map/plan.js';
import { OUTLINES } from './outlines.js';

const WALL = { height: 2.15, thick: 0.46, run: 4 };
const PIER = { size: 0.78, height: 3.0 };

// A buffer for each material used, made as it is first asked for.
class Yard {
    constructor() { this.bufs = new Map(); }
    of(surface) {
        if (!this.bufs.has(surface)) this.bufs.set(surface, new Buf());
        return this.bufs.get(surface);
    }
}

// Metres to a repeat: each scan's own size, or near it.
const TILE = { wall: 2.0, ashlar: 2.0, brick: 1.0, slates: 1.5, flags: 3.0, post: 2.0, coffin: 2.0, limestone: 1.5, iron: 1.0, glass: 1 };
// How a surface is asked for, where it is not wanted as it came: cast iron
// is painted black under its rust, and a door that has stood in the weather
// has lost the red of new wood.
const LOOKS = { iron: { tint: [0.3, 0.27, 0.26] }, coffin: { tint: [0.42, 0.36, 0.33] } };

// --- the wall ----------------------------------------------------------------

// The four sides as runs between corners: where each starts, which way it
// goes, how long it is.
function sides() {
    const { x0, x1, z0, z1 } = BOUNDS;
    return {
        south: { from: [x0, z0], dir: [1, 0], length: x1 - x0, origin: x0 },
        north: { from: [x0, z1], dir: [1, 0], length: x1 - x0, origin: x0 },
        west: { from: [x0, z0], dir: [0, 1], length: z1 - z0, origin: z0 },
        east: { from: [x1, z0], dir: [0, 1], length: z1 - z0, origin: z0 },
    };
}

function pier(yard, x, z) {
    const h = heightAt(x, z), s = PIER.size / 2;
    yard.of('ashlar').box([x - s, h - 0.4, z - s], [x + s, h + PIER.height, z + s], TILE.ashlar, { foot: 0.6 });
    yard.of('limestone').box([x - s - 0.07, h + PIER.height, z - s - 0.07], [x + s + 0.07, h + PIER.height + 0.16, z + s + 0.07], TILE.limestone);
}

function boundary(yard) {
    for (const [name, side] of Object.entries(sides())) {
        const gates = GATES.filter((g) => g.wall === name).sort((a, b) => a.at - b.at);
        const gaps = gates.map((g) => [g.at - side.origin - g.width / 2, g.at - side.origin + g.width / 2]);
        const at = (t) => [side.from[0] + side.dir[0] * t, side.from[1] + side.dir[1] * t];
        let from = 0;
        for (const [g0, g1] of [...gaps, [side.length, side.length]]) {
            // In short lengths, each stepped to the ground under it, the way
            // a wall goes over a slope.
            for (let t = from; t < g0 - 0.01; t += WALL.run) {
                const end = Math.min(g0, t + WALL.run);
                const [ax, az] = at(t), [bx, bz] = at(end);
                const ground = [heightAt(ax, az), heightAt(bx, bz)];
                const top = Math.max(...ground) + WALL.height, half = WALL.thick / 2;
                const min = [Math.min(ax, bx) - (side.dir[1] ? half : 0), Math.min(...ground) - 0.5, Math.min(az, bz) - (side.dir[0] ? half : 0)];
                const max = [Math.max(ax, bx) + (side.dir[1] ? half : 0), top, Math.max(az, bz) + (side.dir[0] ? half : 0)];
                yard.of('wall').box(min, max, TILE.wall, { foot: 0.55 });
                yard.of('flags').box([min[0] - 0.05, top, min[2] - 0.05], [max[0] + 0.05, top + 0.09, max[2] + 0.05], TILE.flags);
            }
            if (g0 < side.length) for (const t of [g0, g1]) pier(yard, ...at(t));
            from = g1;
        }
        gates.forEach((gate, i) => { if (gate.kind === 'chain') chain(yard, at(gaps[i][0]), at(gaps[i][1])); });
    }
}

// A chain hung across a gateway from pier to pier, padlocked in the middle.
function chain(yard, [ax, az], [bx, bz]) {
    const links = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        links.push([x, heightAt(x, z) + 1.0 - 0.32 * 4 * t * (1 - t), z]);
    }
    yard.of('iron').tube(links, 0.022, TILE.iron, { sides: 5 });
    const [mx, my, mz] = links[5];
    yard.of('iron').box([mx - 0.035, my - 0.11, mz - 0.035], [mx + 0.035, my - 0.01, mz + 0.035], TILE.iron);
}

// --- roofs and what trims them -------------------------------------------------

// A pitched roof over a rectangle, its ridge along `axis` ('x' or 'z'), with
// the two gable ends closed in `gable` material up to the slates. The slates
// overhang the walls by `eave` and the gables by `verge`. Returns the roof
// in its own terms, for whatever is fixed to it afterwards: `point(across,
// along, y)` is so far from the ridge line, so far along it, at a height.
function pitched(yard, [cx, cz], [w, d], eaves, rise, axis, gable, { eave = 0.3, verge = 0.3 } = {}) {
    const alongZ = axis === 'z';
    const half = (alongZ ? w : d) / 2, long = (alongZ ? d : w) / 2;
    const point = (across, along, y) => (alongZ ? [cx + across, y, cz + along] : [cx + along, y, cz + across]);
    const pitch = rise / half, slope = Math.hypot(half + eave, (half + eave) * pitch), reach = long + verge;
    const t = TILE.slates, gt = TILE[gable];
    const faces = (s) => (alongZ ? [s * rise, half, 0] : [0, half, s * rise]);
    for (const s of [1, -1]) {
        const edge = s * (half + eave), low = eaves - eave * pitch;
        yard.of('slates').face(
            [point(edge, -reach, low), point(edge, reach, low), point(0, reach, eaves + rise), point(0, -reach, eaves + rise)],
            faces(s), [[0, 0], [2 * reach / t, 0], [2 * reach / t, slope / t], [0, slope / t]]);
        const end = [point(-half, s * long, eaves), point(half, s * long, eaves), point(0, s * long, eaves + rise)];
        yard.of(gable).face(end, alongZ ? [0, 0, s] : [s, 0, 0], end.map((q) => [(alongZ ? q[0] : q[2]) / gt, q[1] / gt]));
    }
    return { point, half, long, pitch, eaves, rise, eave, verge, faces };
}

// A length of `surface` up each slope at each end of a roof: the coping on
// a gable wall that stands above the slates, or the bargeboard under slates
// that sail past it. `out` is how far beyond the gable wall its middle runs
// (less than nothing for a coping, which sits on the wall), `lift` how far
// off the slates.
function verges(yard, roof, surface, { out, wide, deep, lift }) {
    const buf = yard.of(surface);
    for (const s of [1, -1]) {
        for (const end of [1, -1]) {
            const along = end * (roof.long + out), foot = roof.half + roof.eave;
            buf.bar(roof.point(s * foot, along, roof.eaves - roof.eave * roof.pitch + lift), roof.point(0, along, roof.eaves + roof.rise + lift),
                wide, deep, TILE[surface], { up: roof.faces(s) });
        }
    }
}

// A cast-iron gutter along each eave, and a pipe down from it at each of
// `drops` (distances along the ridge line from the middle of the roof).
function gutters(yard, roof, ground, drops) {
    const iron = yard.of('iron'), reach = roof.long + roof.verge;
    for (const s of [1, -1]) {
        const out = s * (roof.half + roof.eave + 0.05), y = roof.eaves - roof.eave * roof.pitch - 0.06;
        iron.bar(roof.point(out, -reach, y), roof.point(out, reach, y), 0.12, 0.09, TILE.iron);
        // Out of the gutter, back under the eave to the wall, and down it.
        const wall = s * (roof.half + 0.07);
        for (const along of drops) {
            iron.tube([roof.point(out, along, y), roof.point(out, along, y - 0.12), roof.point(wall, along, y - 0.12 - roof.eave * 0.9),
                roof.point(wall, along, ground - 0.1)], 0.042, TILE.iron, { sides: 6 });
        }
    }
}

// --- doors and windows ----------------------------------------------------------

// A door or a window in a wall. The wall is not cut: the dressed stone round
// the opening stands proud of it, as a doorcase does, and what fills the
// opening lies on the wall's own face at the back of that.
//   frame     { at, right, out }: the middle of the sill on the wall's face,
//             the way the wall runs, the way it looks
//   shape     which outline (outlines.js), `width` and `height` of the opening
//   margin    how wide the dressed stone is; `proud`, how far it stands out
//   fill      the surface in the opening, or null to leave it for the caller
//   sill      true for a stone sill under it
function opening(yard, frame, { shape, width, height, margin, proud, surround = 'limestone', fill = 'glass', sill = false }) {
    const { at, right, out } = frame;
    const place = ([x, y], d) => [at[0] + right[0] * x + out[0] * d, at[1] + y, at[2] + right[2] * x + out[2] * d];
    const closed = shape === 'oculus';
    const inner = OUTLINES[shape](width, height);
    // The same shape, bigger by the margin all round: all round but
    // underneath, unless it is a shape with no underneath.
    const outer = OUTLINES[shape](width + 2 * margin, height + (closed ? 2 : 1) * margin, closed ? -margin : 0);
    const stone = yard.of(surround), t = TILE[surround];
    const middle = place([0, height / 2], 0);

    for (let i = 0; i + 1 < inner.length; i++) {
        const ring = [outer[i], outer[i + 1], inner[i + 1], inner[i]];
        stone.face(ring.map((p) => place(p, proud)), out, ring.map(([x, y]) => [x / t, y / t]));
        // The reveal looks into the opening and the stone's outside edge away from it.
        for (const [a, b, sign] of [[inner[i], inner[i + 1], -1], [outer[i], outer[i + 1], 1]]) {
            const mid = place([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            stone.face([place(a, proud), place(b, proud), place(b, 0), place(a, 0)], mid.map((c, k) => (c - middle[k]) * sign),
                [[0, 0], [length / t, 0], [length / t, proud / t], [0, proud / t]], { shade: sign < 0 ? 0.7 : 1 });
        }
    }
    if (sill) {
        const reach = width / 2 + margin + 0.05;
        stone.bar(place([-reach, -0.06], proud / 2 + 0.03), place([reach, -0.06], proud / 2 + 0.03), proud + 0.06, 0.12, t);
    }
    if (fill) {
        const pane = yard.of(fill), ft = TILE[fill];
        const hub = [0, height / 2];
        for (let i = 0; i < inner.length; i++) {
            const wedge = [hub, inner[i], inner[(i + 1) % inner.length]];
            pane.face(wedge.map((p) => place(p, 0.012)), out, wedge.map(([x, y]) => [x / ft, y / ft]), { shade: 0.85 });
        }
    }
}

// Dressed corner stones, long and short by turns, up the corner at (x, z)
// from `from` to `to`. `inX` and `inZ` say which way the building is from it.
function quoins(yard, [x, z], [inX, inZ], from, to) {
    const stone = yard.of('limestone'), course = 0.3, proud = 0.025;
    for (let y = from, i = 0; y + course <= to; y += course + 0.015, i++) {
        const [alongX, alongZ] = i % 2 ? [0.24, 0.46] : [0.46, 0.24];
        const xs = [x - inX * proud, x + inX * alongX], zs = [z - inZ * proud, z + inZ * alongZ];
        stone.box([Math.min(...xs), y, Math.min(...zs)], [Math.max(...xs), y + course, Math.max(...zs)], TILE.limestone);
    }
}

// --- the chapel of rest ----------------------------------------------------------

// The bellcote on the south gable: two piers, a head over them, a little
// roof of its own and the bell in the gap. `apex` is the top of the gable.
function bellcote(yard, cx, z, apex) {
    const stone = yard.of('ashlar'), t = TILE.ashlar, deep = [z, z + 0.5];
    stone.box([cx - 0.62, apex - 0.9, deep[0]], [cx + 0.62, apex + 0.35, deep[1]], t);
    for (const side of [-1, 1]) {
        const xs = [cx + side * 0.36, cx + side * 0.62];
        stone.box([Math.min(...xs), apex + 0.35, deep[0]], [Math.max(...xs), apex + 1.35, deep[1]], t);
    }
    yard.of('limestone').box([cx - 0.68, apex + 1.35, deep[0] - 0.05], [cx + 0.68, apex + 1.55, deep[1] + 0.05], TILE.limestone);
    pitched(yard, [cx, z + 0.25], [1.36, 0.6], apex + 1.55, 0.6, 'z', 'limestone', { eave: 0.06, verge: 0.06 });
    const hang = (y) => [cx, apex + y, z + 0.25];
    yard.of('iron').tube([hang(1.34), hang(1.22), hang(1.1), hang(0.94), hang(0.8)], [0.025, 0.09, 0.14, 0.17, 0.24], TILE.iron, { sides: 10 });
}

function chapel(yard, b) {
    const [cx, cz] = b.at, [w, d] = b.size;
    const ground = heightAt(cx, cz), eaves = ground + 4.2, rise = 4.6;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const stone = yard.of('ashlar'), dressed = yard.of('limestone'), t = TILE.ashlar, dt = TILE.limestone;
    stone.box([x0, ground - 0.6, z0], [x1, eaves, z1], t, { skip: ['py', 'ny'], foot: 0.5 });
    stone.box([x0 - 0.12, ground - 0.6, z0 - 0.12], [x1 + 0.12, ground + 0.55, z1 + 0.12], t, { skip: ['ny'], foot: 0.5 });
    dressed.box([x0 - 0.14, ground + 0.55, z0 - 0.14], [x1 + 0.14, ground + 0.63, z1 + 0.14], dt, { skip: ['ny'] });

    // The roof stops at the gables, which stand above it under their copings.
    const roof = pitched(yard, b.at, b.size, eaves, rise, 'z', 'ashlar', { eave: 0.25, verge: 0 });
    verges(yard, roof, 'limestone', { out: -0.2, wide: 0.46, deep: 0.17, lift: 0.1 });
    for (const side of [-1, 1]) {
        for (const end of [-1, 1]) {
            // The kneeler: the block a coping starts from.
            const x = cx + side * (w / 2 + 0.1), z = cz + end * (d / 2 - 0.2);
            dressed.box([x - 0.24, eaves - 0.42, z - 0.25], [x + 0.24, eaves + 0.12, z + 0.25], dt);
        }
    }
    dressed.bar(roof.point(0, -d / 2 + 0.45, eaves + rise + 0.04), roof.point(0, d / 2 - 0.45, eaves + rise + 0.04), 0.22, 0.1, dt);
    gutters(yard, roof, ground, [-d / 2 + 1.3, d / 2 - 1.3]);

    // Buttresses at the corners and twice down each long side, in two
    // stages with a weathering on each.
    for (const z of [z0 + 0.3, z0 + d / 3, z0 + 2 * d / 3, z1 - 0.3]) {
        for (const side of [-1, 1]) {
            const x = side < 0 ? x0 : x1, span = (deep) => [Math.min(x, x + side * deep), Math.max(x, x + side * deep)];
            const [lowA, lowB] = span(0.7), [highA, highB] = span(0.45);
            stone.box([lowA, ground - 0.6, z - 0.3], [lowB, ground + 2.9, z + 0.3], t, { foot: 0.5 });
            dressed.box([lowA - 0.02, ground + 2.9, z - 0.32], [lowB + 0.02, ground + 3.02, z + 0.32], dt);
            stone.box([highA, ground + 3.02, z - 0.3], [highB, ground + 3.6, z + 0.3], t);
            dressed.box([highA - 0.02, ground + 3.6, z - 0.32], [highB + 0.02, ground + 3.7, z + 0.32], dt);
        }
    }

    // Lancets down both sides.
    for (const z of [z0 + d / 6 + 0.4, z0 + d / 2, z1 - d / 6 - 0.4]) {
        for (const side of [-1, 1]) {
            opening(yard, { at: [side < 0 ? x0 : x1, ground + 1.45, z], right: [0, 0, 1], out: [side, 0, 0] },
                { shape: 'gothic', width: 0.62, height: 2.0, margin: 0.14, proud: 0.1, sill: true });
        }
    }

    // The south front: the door in its doorcase on two steps, a round
    // window over it, and the bellcote on the gable.
    const south = { right: [1, 0, 0], out: [0, 0, -1] };
    opening(yard, { ...south, at: [cx, ground + 0.3, z0] }, { shape: 'gothic', width: 1.8, height: 3.2, margin: 0.32, proud: 0.28, fill: 'coffin' });
    const iron = yard.of('iron');
    iron.box([cx - 0.012, ground + 0.3, z0 - 0.03], [cx + 0.012, ground + 3.4, z0 - 0.012], TILE.iron);
    for (const y of [0.75, 1.55]) {
        for (const side of [-1, 1]) {
            const xs = [cx + side * 0.2, cx + side * 0.88];
            iron.box([Math.min(...xs), ground + y, z0 - 0.034], [Math.max(...xs), ground + y + 0.07, z0 - 0.012], TILE.iron);
        }
    }
    yard.of('flags').box([cx - 1.9, ground - 0.3, z0 - 1.4], [cx + 1.9, ground + 0.15, z0], TILE.flags, { foot: 0.6 });
    yard.of('flags').box([cx - 1.6, ground + 0.15, z0 - 0.9], [cx + 1.6, ground + 0.3, z0], TILE.flags);
    opening(yard, { ...south, at: [cx, eaves + 1.0, z0] }, { shape: 'oculus', width: 1.1, height: 1.1, margin: 0.17, proud: 0.1 });
    bellcote(yard, cx, z0, eaves + rise);
    // A cross on the north gable.
    const cross = [cx, eaves + rise, z1 - 0.2];
    dressed.bar([cross[0], cross[1] + 0.1, cross[2]], [cross[0], cross[1] + 1.0, cross[2]], 0.12, 0.12, dt, { up: [0, 0, 1] });
    dressed.bar([cross[0] - 0.28, cross[1] + 0.7, cross[2]], [cross[0] + 0.28, cross[1] + 0.7, cross[2]], 0.12, 0.12, dt);

    // The cold room's own door, on the east side, plain, with a lamp on a
    // bracket over it.
    const dz = cz + 4.5, lamp = [x1 + 0.3, ground + 2.5, dz];
    opening(yard, { at: [x1, ground + 0.12, dz], right: [0, 0, 1], out: [1, 0, 0] },
        { shape: 'square', width: 1.0, height: 2.05, margin: 0.12, proud: 0.08, fill: 'post' });
    yard.of('flags').box([x1, ground - 0.3, dz - 0.8], [x1 + 0.9, ground + 0.12, dz + 0.8], TILE.flags, { foot: 0.6 });
    iron.bar([x1, lamp[1] + 0.2, dz], [lamp[0], lamp[1] + 0.2, dz], 0.03, 0.03, TILE.iron);
    iron.tube([[lamp[0], lamp[1] + 0.2, dz], [lamp[0], lamp[1] + 0.12, dz], [lamp[0], lamp[1] + 0.02, dz]], [0.02, 0.05, 0.15], TILE.iron, { sides: 10 });
    return { coldDoor: [x1 + 0.6, ground, dz], lamp };
}

// --- the lodge and the store -------------------------------------------------------

function lodge(yard, b) {
    const [cx, cz] = b.at, [w, d] = b.size;
    const ground = heightAt(cx, cz), eaves = ground + 2.7, rise = 2.5;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const brick = yard.of('brick'), t = TILE.brick;
    brick.box([x0, ground - 0.5, z0], [x1, eaves, z1], t, { skip: ['py', 'ny'], foot: 0.55 });
    brick.box([x0 - 0.05, ground - 0.5, z0 - 0.05], [x1 + 0.05, ground + 0.4, z1 + 0.05], t, { skip: ['ny'], foot: 0.55 });
    for (const [corner, inward] of [[[x0, z0], [1, 1]], [[x1, z0], [-1, 1]], [[x0, z1], [1, -1]], [[x1, z1], [-1, -1]]]) {
        quoins(yard, corner, inward, ground + 0.4, eaves - 0.05);
    }

    const roof = pitched(yard, b.at, b.size, eaves, rise, 'x', 'brick', { eave: 0.35, verge: 0.35 });
    verges(yard, roof, 'post', { out: 0.33, wide: 0.045, deep: 0.2, lift: -0.11 });
    gutters(yard, roof, ground, [-w / 2 + 0.4, w / 2 - 0.4]);

    // The chimney: its stack, a stone cap, two pots.
    const stack = [x0 + 1.0, x0 + 1.7], top = eaves + rise + 1.1;
    brick.box([stack[0], eaves + 1.2, cz - 0.35], [stack[1], top, cz + 0.35], t);
    yard.of('limestone').box([stack[0] - 0.06, top, cz - 0.41], [stack[1] + 0.06, top + 0.12, cz + 0.41], TILE.limestone);
    for (const z of [cz - 0.16, cz + 0.16]) {
        const x = (stack[0] + stack[1]) / 2;
        brick.tube([[x, top + 0.12, z], [x, top + 0.5, z]], [0.11, 0.09], t, { sides: 8 });
    }

    // On the avenue side: the door, south of it the window with the light
    // in it, north of it a dark one. Another dark one looks at the gate.
    const east = { right: [0, 0, 1], out: [1, 0, 0] }, pane = { shape: 'square', margin: 0.1, proud: 0.06, sill: true };
    opening(yard, { ...east, at: [x1, ground + 0.1, cz] }, { shape: 'square', width: 0.9, height: 1.95, margin: 0.1, proud: 0.06, fill: 'coffin' });
    yard.of('flags').box([x1, ground - 0.3, cz - 0.7], [x1 + 0.7, ground + 0.1, cz + 0.7], TILE.flags, { foot: 0.6 });
    const lit = { centre: [x1 + 0.015, ground + 1.5, cz - 1.9], size: [1.15, 1.2], normal: [1, 0, 0] };
    opening(yard, { ...east, at: [x1, ground + 0.9, cz - 1.9] }, { ...pane, width: lit.size[0], height: lit.size[1], fill: null });
    opening(yard, { ...east, at: [x1, ground + 0.9, cz + 1.9] }, { ...pane, width: 1.15, height: 1.2 });
    opening(yard, { at: [x0 + 2.75, ground + 0.95, z0], right: [1, 0, 0], out: [0, 0, -1] }, { ...pane, width: 1.1, height: 1.15 });
    return { window: lit };
}

function store(yard, b) {
    const [cx, cz] = b.at, [w, d] = b.size;
    const ground = heightAt(cx, cz);
    yard.of('post').box([cx - w / 2, ground - 0.2, cz - d / 2], [cx + w / 2, ground + b.height, cz + d / 2], TILE.post, { skip: ['ny'], foot: 0.5 });
    yard.of('slates').box([cx - w / 2 - 0.2, ground + b.height, cz - d / 2 - 0.2], [cx + w / 2 + 0.2, ground + b.height + 0.07, cz + d / 2 + 0.2], TILE.slates);
}

// The lych gate: four oak posts and a roof over the footpath.
function lychGate(yard, gate) {
    const x = BOUNDS.x0, z = gate.at, ground = heightAt(x, z);
    for (const [dx, dz] of [[-0.9, -0.95], [-0.9, 0.95], [0.9, -0.95], [0.9, 0.95]]) {
        yard.of('post').box([x + dx - 0.09, ground - 0.3, z + dz - 0.09], [x + dx + 0.09, ground + 2.3, z + dz + 0.09], TILE.post, { foot: 0.5 });
    }
    const roof = pitched(yard, [x, z], [2.6, 2.5], ground + 2.3, 1.1, 'x', 'post', { eave: 0.25, verge: 0.25 });
    verges(yard, roof, 'post', { out: 0.23, wide: 0.05, deep: 0.16, lift: -0.09 });

    // The gate under it, shut: two rails, the pales between them, a brace.
    const oak = yard.of('post'), t = TILE.post, half = gate.width / 2 - 0.04;
    const on = (along, y) => [x, ground + y, z + along];
    for (const y of [0.28, 1.08]) oak.bar(on(-half, y), on(half, y), 0.05, 0.09, t);
    for (let along = -half + 0.06; along <= half - 0.05; along += 0.19) oak.bar(on(along, 0.2), on(along, 1.2), 0.07, 0.025, t, { up: [1, 0, 0] });
    oak.bar(on(-half, 0.3), on(half, 1.05), 0.05, 0.07, t);
}

// Everything built, as meshes. `glass` is a material for dark panes. Returns
// the meshes and the places the yard's lights and doors need to know.
export function buildBuilt(scene, surfaces, glass) {
    const yard = new Yard();
    boundary(yard);
    const places = {};
    for (const b of BUILDINGS) {
        if (b.id === 'chapel') places.chapel = chapel(yard, b);
        else if (b.id === 'lodge') places.lodge = lodge(yard, b);
        else store(yard, b);
    }
    lychGate(yard, GATES.find((g) => g.kind === 'lych'));

    const meshes = [];
    for (const [surface, buf] of yard.bufs) {
        const mesh = buf.toMesh('built_' + surface, scene, surface === 'glass' ? glass : surfaces.material(surface, LOOKS[surface]));
        mesh.isPickable = true;
        meshes.push(mesh);
    }
    return { meshes, places };
}
