// A Wavefront OBJ's positions and faces (triangulated), and its loose parts: the sets of faces joined by shared
// vertices. Only `v` and `f` are read: the meshes these scripts take carry no UVs or normals worth keeping.
import { readFileSync } from 'node:fs';

export function readObj(file) {
    const pos = [], tris = [], groups = [];
    let group = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const w = line.trim().split(/\s+/);
        if (w[0] === 'v') pos.push(+w[1], +w[2], +w[3]);
        else if (w[0] === 'o' || w[0] === 'g') group++;
        else if (w[0] === 'f') {
            const ix = w.slice(1).map((s) => { const i = parseInt(s, 10); return i < 0 ? pos.length / 3 + i : i - 1; });
            for (let k = 1; k + 1 < ix.length; k++) { tris.push(ix[0], ix[k], ix[k + 1]); groups.push(group); }
        }
    }
    return { pos: new Float32Array(pos), tris: new Uint32Array(tris), groups };
}

// Each triangle's part number, parts being joined through shared vertices (union-find).
export function parts({ pos, tris }) {
    const up = new Int32Array(pos.length / 3).map((_, i) => i);
    const find = (i) => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
    for (let t = 0; t < tris.length; t += 3) for (const k of [1, 2]) up[find(tris[t + k])] = find(tris[t]);
    const ids = new Map();
    const of = new Int32Array(tris.length / 3);
    for (let t = 0; t < of.length; t++) { const r = find(tris[t * 3]); if (!ids.has(r)) ids.set(r, ids.size); of[t] = ids.get(r); }
    return { of, count: ids.size };
}
