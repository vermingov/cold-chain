// Raw geometry: the buffer every piece of the building is written into.
//
// Nothing in a level is a model. Walls, floors, pilasters, pipes and door
// frames are all quads, boxes and tubes pushed into a handful of buffers, one
// per material per sector of the plan, and turned into meshes once at the end.
//
// Every vertex carries a colour. Its grey is the contact shade: how much of
// the light that reaches a point is lost because it sits in a corner, under a
// skirting or against a ceiling. Its alpha is how damp the surface is there.
// Both are written by whoever builds the piece and read by the surface shader
// (grime.js), so a corridor has dark corners and wet patches without a single
// texture being made for it.
//
// Winding: a quad through o, o + e1, o + e1 + e2, o + e2 faces along e2 x e1.

import * as BABYLON from '@babylonjs/core';
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const four = (v) => (Array.isArray(v) ? v : [v, v, v, v]);

// The six faces of an axis-aligned box: which way each looks, its first
// corner as a pick of min (0) or max (1) on each axis, the two edges walked
// from there, and which world axes its texture runs along.
const BOX_FACES = {
    px: { n: [1, 0, 0], o: [1, 0, 0], e1: [0, 0, 1], e2: [0, 1, 0], uv: [2, 1] },
    nx: { n: [-1, 0, 0], o: [0, 0, 1], e1: [0, 0, -1], e2: [0, 1, 0], uv: [2, 1] },
    py: { n: [0, 1, 0], o: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], uv: [0, 2] },
    ny: { n: [0, -1, 0], o: [0, 0, 0], e1: [0, 0, 1], e2: [1, 0, 0], uv: [0, 2] },
    pz: { n: [0, 0, 1], o: [1, 0, 1], e1: [-1, 0, 0], e2: [0, 1, 0], uv: [0, 1] },
    nz: { n: [0, 0, -1], o: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], uv: [0, 1] },
};

export class Buf {
    declare positions: any[];
    declare normals: any[];
    declare uvs: any[];
    declare colors: any[];
    declare indices: any[];

    constructor() {
        this.positions = [];
        this.normals = [];
        this.uvs = [];
        this.colors = [];
        this.indices = [];
    }

    get empty() { return this.indices.length === 0; }

    // One vertex; returns its index. `shade` is the contact shade (1 is
    // open, 0 is a crack no light gets into) and `damp` how wet it is.
    vertex(p, n, uv, shade = 1, damp = 0) {
        const index = this.positions.length / 3;
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.uvs.push(uv[0], uv[1]);
        this.colors.push(shade, shade, shade, damp);
        return index;
    }

    // Four corners, counter-clockwise seen from the side the normal points to.
    // `shade` and `damp` are one value for the whole quad or one per corner.
    quad(p, n, uv, { shade = 1, damp = 0 }: { shade?: number | number[]; damp?: number | number[] } = {}) {
        const s = four(shade), d = four(damp);
        const base = this.positions.length / 3;
        for (let i = 0; i < 4; i++) this.vertex(p[i], n, uv[i], s[i], d[i]);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // One triangle, counter-clockwise seen from the side its normal points to.
    tri(p, n, uv, { shade = 1, damp = 0 } = {}) {
        const base = this.positions.length / 3;
        for (let i = 0; i < 3; i++) this.vertex(p[i], n, uv[i], shade, damp);
        this.indices.push(base, base + 1, base + 2);
    }

    // A quad or a triangle wound whichever way makes it face `toward`, for
    // anything whose corners are easier to name than to order.
    face(p, toward, uv, opts = {}) {
        const last = p.length - 1;
        const e1 = [0, 1, 2].map((k) => p[1][k] - p[0][k]), e2 = [0, 1, 2].map((k) => p[last][k] - p[0][k]);
        const n = normalise(cross(e2, e1));
        const away = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0;
        const order = away ? p.map((_, i) => last - i) : p.map((_, i) => i);
        const draw = p.length === 4 ? this.quad : this.tri;
        draw.call(this, order.map((i) => p[i]), away ? n.map((c) => -c) : n, order.map((i) => uv[i]), opts);
    }

    // A flat outline given thickness: a headstone, a door, a board cut to a
    // shape. `outline` is points in x and y, counter-clockwise as drawn on
    // paper with x to the right, and convex; the piece stands on z = 0
    // between -depth/2 and +depth/2. (Seen from +z in this left-handed world
    // x runs to the left, so the +z cap is the outline walked backwards.)
    // Edges that turn gently share their normals, so an arch is round.
    extrude(outline, depth, tile, { shade = 1 } = {}) {
        const n = outline.length, half = depth / 2;
        const cx = outline.reduce((a, p) => a + p[0], 0) / n, cy = outline.reduce((a, p) => a + p[1], 0) / n;
        for (const [z, nz] of [[half, 1], [-half, -1]]) {
            for (let i = 0; i < n; i++) {
                const a = outline[i], b = outline[(i + 1) % n];
                const corners = nz > 0 ? [[cx, cy], b, a] : [[cx, cy], a, b];
                this.tri(corners.map(([x, y]) => [x, y, z]), [0, 0, nz], corners.map(([x, y]) => [x / tile, y / tile]), { shade });
            }
        }
        // The edge, walked round. Each corner's normal is its two edges'
        // averaged where they meet gently and kept apart where they do not.
        const edge = (i) => { const a = outline[i], b = outline[(i + 1) % n]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; };
        const soft = (e, f) => (e[0] * f[0] + e[1] * f[1] > 0.75 ? normalise([e[0] + f[0], e[1] + f[1], 0]) : [e[0], e[1], 0]);
        let run = 0;
        for (let i = 0; i < n; i++) {
            const a = outline[i], b = outline[(i + 1) % n];
            const here = edge(i), before = edge((i + n - 1) % n), after = edge((i + 1) % n);
            const na = soft(here, before), nb = soft(here, after);
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const base = this.positions.length / 3;
            this.vertex([a[0], a[1], half], na, [run / tile, half / tile], shade);
            this.vertex([b[0], b[1], half], nb, [(run + length) / tile, half / tile], shade);
            this.vertex([b[0], b[1], -half], nb, [(run + length) / tile, -half / tile], shade);
            this.vertex([a[0], a[1], -half], na, [run / tile, -half / tile], shade);
            this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            run += length;
        }
    }

    // A straight length of something square-cut: a coping, a bargeboard, a
    // gutter, a glazing bar. It runs from `a` to `b`, is `wide` across and
    // `deep` through, and `up` is the way its depth faces (anything not
    // along it will do: it is squared up).
    bar(a, b, wide, deep, tile, { up = [0, 1, 0], shade = 1 } = {}) {
        const along = normalise([0, 1, 2].map((k) => b[k] - a[k]));
        // Running along `up` itself, any other way will do for it.
        if (Math.abs(along[0] * up[0] + along[1] * up[1] + along[2] * up[2]) > 0.999) up = Math.abs(along[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
        const side = normalise(cross(up, along)), top = cross(along, side);
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const corner = (end, s, t) => [0, 1, 2].map((k) => end[k] + side[k] * s * wide / 2 + top[k] * t * deep / 2);
        // The four long faces, each named by the way it looks.
        for (const [s, t] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const [p, q] = s ? [[s, -1], [s, 1]] : [[-1, t], [1, t]];
            const girth = s ? deep : wide;
            this.face([corner(a, p[0], p[1]), corner(a, q[0], q[1]), corner(b, q[0], q[1]), corner(b, p[0], p[1])], [0, 1, 2].map((k) => side[k] * s + top[k] * t),
                [[0, 0], [girth / tile, 0], [girth / tile, length / tile], [0, length / tile]], { shade });
        }
        for (const [end, sign] of [[a, -1], [b, 1]]) {
            this.face([corner(end, -1, -1), corner(end, 1, -1), corner(end, 1, 1), corner(end, -1, 1)], along.map((c) => c * sign),
                [[0, 0], [wide / tile, 0], [wide / tile, deep / tile], [0, deep / tile]], { shade });
        }
    }

    // An axis-aligned box. `skip` names faces to leave out (the ones buried
    // in a wall or a ceiling: 'px', 'nx', 'py', 'ny', 'pz', 'nz'). The
    // texture is laid in world space at `tile` metres a repeat, so a box of
    // wall material standing against a wall carries the wall's own grain
    // across onto it. `foot` darkens the bottom edge, for anything standing
    // on a floor; `head` the top edge, for anything hung under a ceiling.
    box(min, max, tile, { skip = [], shade = 1, foot = 1, head = 1, damp = 0 } = {}) {
        const pick = (c) => [c[0] ? max[0] : min[0], c[1] ? max[1] : min[1], c[2] ? max[2] : min[2]];
        const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        for (const [name, f] of Object.entries(BOX_FACES)) {
            if (skip.includes(name)) continue;
            const o = pick(f.o);
            const corner = (a, b) => [0, 1, 2].map((k) => o[k] + f.e1[k] * size[k] * a + f.e2[k] * size[k] * b);
            const p = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
            const lit = p.map((c) => shade * (c[1] - min[1] < 1e-6 ? foot : 1) * (max[1] - c[1] < 1e-6 ? head : 1));
            this.quad(p, f.n, p.map((c) => [c[f.uv[0]] / tile, c[f.uv[1]] / tile]), { shade: lit, damp });
        }
    }

    // A round pipe along a list of points, with smooth sides. Bends are
    // whatever the path does: the caller puts a few points round a corner
    // for an elbow. `radius` is one number, or one per point for anything
    // that swells or tapers: a bulb, a lamp shade, a flange. `v` runs along
    // the pipe in world metres over `tile`.
    tube(path, radius, tile, { sides = 8, shade = 1, damp = 0 } = {}) {
        const radiusAt = (i) => (Array.isArray(radius) ? radius[i] : radius);
        const rings = [];
        let run = 0;
        let u = null;
        for (let i = 0; i < path.length; i++) {
            const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
            const d = normalise([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
            // Carry the frame along the pipe rather than rebuild it at each
            // ring: rebuilt, it flips at a bend and the pipe wrings its neck.
            const guess = u || (Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
            const v = normalise(cross(d, guess));
            u = cross(v, d);
            if (i > 0) run += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
            const ring = [];
            const r = radiusAt(i);
            for (let s = 0; s <= sides; s++) {
                const t = (s / sides) * Math.PI * 2;
                const n = [0, 1, 2].map((k) => u[k] * Math.cos(t) + v[k] * Math.sin(t));
                const p = [0, 1, 2].map((k) => path[i][k] + n[k] * r);
                ring.push(this.vertex(p, n, [(s / sides) * r * 6.28 / tile, run / tile], shade, damp));
            }
            rings.push(ring);
        }
        for (let i = 0; i + 1 < rings.length; i++) {
            const a = rings[i], b = rings[i + 1];
            for (let s = 0; s < sides; s++) {
                this.indices.push(a[s], b[s], b[s + 1], a[s], b[s + 1], a[s + 1]);
            }
        }
    }

    toMesh(name, scene, material) {
        const mesh = new BABYLON.Mesh(name, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = this.positions;
        vd.normals = this.normals;
        vd.uvs = this.uvs;
        vd.colors = this.colors;
        vd.indices = this.indices;
        vd.applyToMesh(mesh, false);
        mesh.material = material;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        // The colour's alpha is dampness, not see-through.
        mesh.hasVertexAlpha = false;
        return mesh;
    }
}

function normalise(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

// A rectangle of surface cut into a grid, so the contact shade can change
// across it: dark along the edges that meet something and open in the middle.
// `o` is a corner, `e1` and `e2` unit vectors along its two sides, `us` and
// `vs` the distances along each at which it is cut. `at(u, v)` gives the
// shade and the dampness of a point, `uv(p)` its texture coordinate.
export function patch(buf, o, e1, e2, us, vs, { at, uv }) {
    const n = cross(e2, e1);
    const point = (u, v) => [0, 1, 2].map((k) => o[k] + e1[k] * u + e2[k] * v);
    for (let i = 0; i + 1 < us.length; i++) {
        for (let j = 0; j + 1 < vs.length; j++) {
            const corners = [[us[i], vs[j]], [us[i + 1], vs[j]], [us[i + 1], vs[j + 1]], [us[i], vs[j + 1]]];
            const p = corners.map(([u, v]) => point(u, v));
            const marks = corners.map(([u, v]) => at(u, v));
            buf.quad(p, n, p.map(uv), { shade: marks.map((m) => m.shade), damp: marks.map((m) => m.damp) });
        }
    }
}
