// The lattice: the wall of the belly as a net.
//
// Tissue is simulated here as what it is, a sheet under tension (tissue.js),
// and a sheet has to be made of something. This is it: places a few
// millimetres apart in rows, every other row set half a step over, so that
// each has six neighbours all the same distance off and the net is as stiff
// one way as another. Between them are the triangles that are the sheet and
// the stretches of thread (edges) that are its strength.
//
// Nothing in here ever changes but where a place is. A blade does not remove
// places or triangles, it parts the thread between two triangles, and what
// that does to the sheet is tissue.js's affair.

export const STEP = 0.005;      // metres from a place to each of its six neighbours

// A net over a rectangle `width` by `length` metres, of the places where
// `on(x, y)` says there is body. Returns:
//   count, x, y      the places
//   tris             three places a triangle, all wound the same way
//   edges            for each stretch: its two places (a, b) and the one or two triangles it is a side of (t1, t2; -1 for none)
//   edgeOf(a, b)     which stretch joins two places, or -1
//   near             for each place, the stretches that leave it (`near.from[p]` to `near.from[p + 1]` in `near.edge`)
//   round            for each place, the triangles it is a corner of, the same way (`round.tri`)
export function lattice(width, length, on) {
    const rise = STEP * Math.sqrt(3) / 2, cols = Math.floor(width / STEP), rows = Math.floor(length / rise);
    const at = new Int32Array(cols * rows).fill(-1), xs = [], ys = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const x = (i + (j & 1) * 0.5) * STEP, y = j * rise;
            if (!on(x, y)) continue;
            at[j * cols + i] = xs.length;
            xs.push(x);
            ys.push(y);
        }
    }
    const place = (i, j) => (i < 0 || i >= cols ? -1 : at[j * cols + i]);
    const tris = [];
    for (let j = 0; j + 1 < rows; j++) {
        for (let i = 0; i < cols; i++) {
            // The two triangles between this place, the next along, and the row below: which two depends on which row is set over.
            const pairs = j & 1
                ? [[place(i, j), place(i + 1, j + 1), place(i, j + 1)], [place(i, j), place(i + 1, j), place(i + 1, j + 1)]]
                : [[place(i, j), place(i + 1, j), place(i, j + 1)], [place(i + 1, j), place(i + 1, j + 1), place(i, j + 1)]];
            for (const three of pairs) if (three.every((p) => p >= 0)) tris.push(...three);
        }
    }

    const count = xs.length, key = (a, b) => (a < b ? a * count + b : b * count + a), found = new Map();
    const edges = { a: [], b: [], t1: [], t2: [] };
    for (let t = 0; t < tris.length / 3; t++) {
        for (let k = 0; k < 3; k++) {
            const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];
            if (found.has(key(a, b))) {
                edges.t2[found.get(key(a, b))] = t;
            } else {
                found.set(key(a, b), edges.a.length);
                edges.a.push(a); edges.b.push(b); edges.t1.push(t); edges.t2.push(-1);
            }
        }
    }
    return {
        count, x: Float32Array.from(xs), y: Float32Array.from(ys), tris: Uint32Array.from(tris),
        edges: { count: edges.a.length, a: Uint32Array.from(edges.a), b: Uint32Array.from(edges.b), t1: Int32Array.from(edges.t1), t2: Int32Array.from(edges.t2) },
        edgeOf: (a, b) => found.get(key(a, b)) ?? -1,
        near: listed(count, edges.a.length, (e, put) => { put(edges.a[e], e); put(edges.b[e], e); }, 'edge'),
        round: listed(count, tris.length / 3, (t, put) => { for (let k = 0; k < 3; k++) put(tris[t * 3 + k], t); }, 'tri'),
    };
}

// For each of `count` places, the things (of `things`) that `each(thing, put)` puts against it, packed end to end.
function listed(count, things, each, name) {
    const from = new Uint32Array(count + 1);
    for (let i = 0; i < things; i++) each(i, (place) => { from[place + 1]++; });
    for (let p = 0; p < count; p++) from[p + 1] += from[p];
    const packed = new Uint32Array(from[count]), next = from.slice(0, count);
    for (let i = 0; i < things; i++) each(i, (place) => { packed[next[place]++] = i; });
    return { from, [name]: packed };
}
