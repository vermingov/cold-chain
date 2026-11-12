// What cannot be walked through.
//
// Every solid thing in a place, seen from above: a round for a tree or a
// headstone, a rectangle for a building or a length of wall. They are kept
// in a coarse grid, so whoever is walking is only ever tested against what
// is within a few metres of them.

const CELL = 4;         // metres to a square of the grid

export class Solids {
    constructor() {
        this.cells = new Map();     // "i,j" -> the solids that touch that square
    }

    _file(solid, x0, z0, x1, z1) {
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
            for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
                const key = i + ',' + j;
                if (!this.cells.has(key)) this.cells.set(key, []);
                this.cells.get(key).push(solid);
            }
        }
    }

    round(x, z, radius) { this._file({ x, z, radius }, x - radius, z - radius, x + radius, z + radius); }

    box(x0, z0, x1, z1) { this._file({ x0, z0, x1, z1 }, x0, z0, x1, z1); }

    // Move `at` ({ x, z }, changed in place) out of anything it is inside,
    // for a body of `radius`. Returns the way it was pushed, as a unit [x, z],
    // or null if it touched nothing: whoever is moving takes that out of
    // their speed, and slides.
    push(at, radius) {
        let pushed = null;
        // Twice: being pushed out of one thing can be into the next.
        for (let pass = 0; pass < 2; pass++) {
            const reachI = [Math.floor((at.x - radius) / CELL), Math.floor((at.x + radius) / CELL)];
            const reachJ = [Math.floor((at.z - radius) / CELL), Math.floor((at.z + radius) / CELL)];
            for (let i = reachI[0]; i <= reachI[1]; i++) {
                for (let j = reachJ[0]; j <= reachJ[1]; j++) {
                    for (const solid of this.cells.get(i + ',' + j) || []) pushed = clear(at, radius, solid) || pushed;
                }
            }
        }
        return pushed;
    }
}

// Push `at` clear of one solid. The way it went, or null.
function clear(at, radius, solid) {
    const round = solid.radius !== undefined;
    // The nearest point of the solid's edge-or-inside to the body's middle.
    const nx = round ? solid.x : Math.max(solid.x0, Math.min(at.x, solid.x1));
    const nz = round ? solid.z : Math.max(solid.z0, Math.min(at.z, solid.z1));
    const room = radius + (round ? solid.radius : 0);
    const dx = at.x - nx, dz = at.z - nz, apart = Math.hypot(dx, dz);
    if (apart >= room) return null;
    if (apart > 1e-6) {
        at.x = nx + dx / apart * (room + 0.001);
        at.z = nz + dz / apart * (room + 0.001);
        return [dx / apart, dz / apart];
    }
    if (round) { at.x = solid.x + room; return [1, 0]; }
    // Right inside a rectangle: out by whichever side is nearest.
    const out = [[at.x - solid.x0, -1, 0], [solid.x1 - at.x, 1, 0], [at.z - solid.z0, 0, -1], [solid.z1 - at.z, 0, 1]]
        .reduce((a, b) => (b[0] < a[0] ? b : a));
    at.x += out[1] * (out[0] + radius + 0.001);
    at.z += out[2] * (out[0] + radius + 0.001);
    return [out[1], out[2]];
}
