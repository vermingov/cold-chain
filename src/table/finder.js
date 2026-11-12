// Finding what a ray meets in a mesh, quickly.
//
// A blade in the belly has to know every frame what its point is on, and
// the engine's own way of finding out tries every triangle of every organ
// the ray comes near: a millisecond a time, several times a frame, which is
// a hand that stutters. This sorts a mesh's triangles into a tree of boxes
// once, so that a ray is only tried against the few it passes close to.
//
// It is for meshes that keep their shape (an organ is moved, never bent):
// the tree is in the mesh's own frame and the ray is brought into it.

const LEAF = 8;                 // a box is not divided once it holds this few triangles

export class Finder {
    constructor(mesh) {
        this.mesh = mesh;
        const at = this.at = mesh.getVerticesData('position'), index = mesh.getIndices(), count = index.length / 3;
        // Each triangle's corners and its middle, then the triangles in tree order.
        this.corners = Uint32Array.from(index);
        const middle = new Float32Array(count * 3);
        for (let t = 0; t < count; t++) {
            for (let k = 0; k < 3; k++) middle[t * 3 + k] = (at[index[t * 3] * 3 + k] + at[index[t * 3 + 1] * 3 + k] + at[index[t * 3 + 2] * 3 + k]) / 3;
        }
        this.order = Uint32Array.from({ length: count }, (_, t) => t);
        // Boxes: each six numbers of bounds, and where its triangles or its two halves are.
        this.bounds = [];
        this.halves = [];           // for each box: [first triangle, how many] of a leaf, or [-(left box), right box]
        this._box(0, count, middle);
        this.bounds = Float32Array.from(this.bounds);
        this.halves = Int32Array.from(this.halves);
    }

    // The box round triangles `from` to `to` of the order, divided in two
    // across its longest side if it holds many. Returns which box it is.
    _box(from, to, middle) {
        const { at, corners, order } = this, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
        for (let i = from; i < to; i++) {
            for (let c = 0; c < 3; c++) {
                const corner = corners[order[i] * 3 + c] * 3;
                for (let k = 0; k < 3; k++) { low[k] = Math.min(low[k], at[corner + k]); high[k] = Math.max(high[k], at[corner + k]); }
            }
        }
        const box = this.bounds.length / 6;
        this.bounds.push(...low, ...high);
        this.halves.push(from, to - from);
        if (to - from <= LEAF) return box;
        const size = [high[0] - low[0], high[1] - low[1], high[2] - low[2]], axis = size.indexOf(Math.max(...size));
        const sorted = Array.from(order.subarray(from, to)).sort((a, b) => middle[a * 3 + axis] - middle[b * 3 + axis]);
        order.set(sorted, from);
        const half = (from + to) >> 1, left = this._box(from, half, middle), right = this._box(half, to, middle);
        this.halves[box * 2] = -left;
        this.halves[box * 2 + 1] = right;
        return box;
    }

    // Where a ray of the world first meets the mesh, no further off than
    // `within` metres: { far, point, normal }, the normal facing back along
    // the ray. Or null.
    meet(ray, within = Infinity) {
        const world = this.mesh.getWorldMatrix(), into = BABYLON.Matrix.Invert(world);
        const o = BABYLON.Vector3.TransformCoordinates(ray.origin, into), d = BABYLON.Vector3.TransformNormal(ray.direction, into);
        const { at, corners, order, bounds, halves } = this, ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z, todo = [0];
        let nearest = within, found = -1;
        while (todo.length) {
            const box = todo.pop(), b = box * 6;
            // Where the ray is inside the box, if anywhere nearer than what is already found.
            const x1 = (bounds[b] - o.x) * ix, x2 = (bounds[b + 3] - o.x) * ix, y1 = (bounds[b + 1] - o.y) * iy, y2 = (bounds[b + 4] - o.y) * iy;
            const z1 = (bounds[b + 2] - o.z) * iz, z2 = (bounds[b + 5] - o.z) * iz;
            const enters = Math.max(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)), leaves = Math.min(Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2));
            if (leaves < Math.max(enters, 0) || enters > nearest) continue;
            if (halves[box * 2] < 0) { todo.push(-halves[box * 2], halves[box * 2 + 1]); continue; }
            for (let i = halves[box * 2], last = i + halves[box * 2 + 1]; i < last; i++) {
                const far = this._triangle(order[i], o, d);
                if (far > 0 && far < nearest) { nearest = far; found = order[i]; }
            }
        }
        if (found < 0) return null;
        const [a, b, c] = [0, 1, 2].map((k) => BABYLON.Vector3.FromArray(at, corners[found * 3 + k] * 3));
        const normal = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Cross(b.subtract(a), c.subtract(a)), world).normalize();
        if (BABYLON.Vector3.Dot(normal, ray.direction) > 0) normal.scaleInPlace(-1);
        return { far: nearest, point: ray.origin.add(ray.direction.scale(nearest)), normal };
    }

    // How far along a ray (from `o`, going `d`) triangle `t` is met, or -1.
    _triangle(t, o, d) {
        const { at, corners } = this, a = corners[t * 3] * 3, b = corners[t * 3 + 1] * 3, c = corners[t * 3 + 2] * 3;
        const e1x = at[b] - at[a], e1y = at[b + 1] - at[a + 1], e1z = at[b + 2] - at[a + 2], e2x = at[c] - at[a], e2y = at[c + 1] - at[a + 1], e2z = at[c + 2] - at[a + 2];
        const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) return -1;
        const tx = o.x - at[a], ty = o.y - at[a + 1], tz = o.z - at[a + 2], u = (tx * px + ty * py + tz * pz) / det;
        if (u < 0 || u > 1) return -1;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d.x * qx + d.y * qy + d.z * qz) / det;
        if (v < 0 || u + v > 1) return -1;
        return (e2x * qx + e2y * qy + e2z * qz) / det;
    }
}
