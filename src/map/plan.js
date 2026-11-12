// St Dymphna's municipal cemetery: the plan.
//
// Everything about the place that is a fact rather than a picture: where the
// wall runs and where it is broken, the paths, the buildings, the sections
// and every plot in them. The yard is built from this (yard/), the order
// sheet names plots out of it, and tools/plan.mjs draws it flat, which is
// the quickest way to see whether the place makes sense.
//
// Metres. The main gate is the origin. +z is north, into the cemetery; +x is
// east. Graves lie east to west as graves do, head at the west end with the
// stone over it, so a row of graves is a line running north.
//
// Nothing here knows about the engine: a tool run by node reads the same file
// the game does.

import { makeRng } from '../rng.js';

export const BOUNDS = { x0: -56, x1: 56, z0: 0, z1: 132 };

// Where the wall is broken. `at` is along the wall it is in.
export const GATES = [
    { id: 'main', wall: 'south', at: 0, width: 4.2, kind: 'iron' },         // onto Vicarage Road
    { id: 'lych', wall: 'west', at: 40, width: 1.6, kind: 'lych' },         // the footpath to the estate
    { id: 'service', wall: 'east', at: 96, width: 3.4, kind: 'chain' },     // the track the council's van uses
];

// Gravel and tarmac, as centre lines with a width.
export const PATHS = [
    { id: 'avenue', width: 3.4, points: [[0, 0], [0, 58]] },
    { id: 'forecourt', width: 11, points: [[0, 58], [0, 65]] },
    { id: 'cross', width: 2.2, points: [[-56, 40], [56, 40]] },
    { id: 'north', width: 2.2, points: [[-52, 96], [56, 96]] },
    { id: 'west walk', width: 1.6, points: [[-52, 40], [-52, 96]] },
    { id: 'chapel side', width: 2.4, points: [[7.5, 96], [7.5, 78], [4.5, 78]] },
    { id: 'lodge', width: 1.4, points: [[0, 9], [-6, 9]] },
    { id: 'road', width: 7, points: [[-80, -6], [80, -6]] },
    { id: 'service track', width: 3.4, points: [[62, -6], [62, 96], [56, 96]] },
];

// What stands in the place. Rectangles: centre, size across x and z.
export const BUILDINGS = [
    // The chapel of rest: where the work is done. Its door faces the avenue;
    // the cold room is the north end, with a door of its own on the east.
    { id: 'chapel', at: [0, 72], size: [9, 14], height: 5.2, doors: [{ side: 'south', at: 0 }, { side: 'east', at: 4.5 }] },
    // The sexton's lodge, just inside the gate. The window on the avenue is
    // the one with the light in it.
    { id: 'lodge', at: [-11, 9], size: [9, 6.5], height: 3.4, doors: [{ side: 'east', at: 0 }] },
    { id: 'tool store', at: [-6.5, 88], size: [3.2, 2.4], height: 2.3, doors: [{ side: 'east', at: 0 }] },
];

// The ground, by what is buried in it. `rows` run north; a grave is `plot`
// metres of a row and each row is `pitch` metres further east. `fill` is how
// much of it is taken, `era` what the stones are like, and `lean` how far
// they have been left to go.
export const SECTIONS = [
    { id: 'A', name: 'Old Ground, west', x: [-50, -5], z: [15, 36], pitch: 3.6, plot: 1.5, fill: 0.72, era: 'victorian', lean: 1 },
    { id: 'B', name: 'Old Ground, east', x: [5, 50], z: [5, 36], pitch: 3.6, plot: 1.5, fill: 0.7, era: 'victorian', lean: 1 },
    { id: 'C', name: 'West Lawn', x: [-48, -7], z: [44, 92], pitch: 3.2, plot: 1.3, fill: 0.9, era: 'postwar', lean: 0.3 },
    { id: 'D', name: 'East Lawn', x: [12, 50], z: [44, 92], pitch: 3.2, plot: 1.3, fill: 0.86, era: 'lawn', lean: 0.1 },
    { id: 'E', name: 'Public Graves', x: [12, 50], z: [100, 126], pitch: 3.0, plot: 1.25, fill: 0.8, era: 'public', lean: 0.2 },
    { id: 'F', name: 'Meadow Burials', x: [-50, -8], z: [100, 126], pitch: 4.2, plot: 2.1, fill: 0.45, era: 'meadow', lean: 0 },
];

// How big a grave is on the ground, whatever stands over it.
export const GRAVE = { length: 2.1, width: 0.9 };

// The lie of the land: a slow rise to the north and the unevenness of a
// place that has been dug and filled for a hundred and fifty years.
export function heightAt(x, z) {
    const rise = z * 0.021;
    const swell = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038) * 0.55 + Math.sin(x * 0.11 + z * 0.07) * 0.16;
    // The road outside is cut level.
    const inside = Math.min(1, Math.max(0, (z + 2) / 8));
    return (rise + swell) * inside;
}

// What is under a foot at (x, z): 'tarmac', 'gravel', 'mud' or 'grass'.
export function underfoot(x, z) {
    for (const path of PATHS) {
        for (let i = 0; i + 1 < path.points.length; i++) {
            const [ax, az] = path.points[i], [bx, bz] = path.points[i + 1];
            // How far along this length of the path the nearest point to the foot is.
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
            if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < path.width / 2) return path.id === 'road' ? 'tarmac' : 'gravel';
        }
    }
    // Nothing is given time to grow back in the public ground.
    const pauper = SECTIONS.find((s) => s.id === 'E');
    if (x > pauper.x[0] && x < pauper.x[1] && z > pauper.z[0] && z < pauper.z[1]) return 'mud';
    return 'grass';
}

// The same again for a shader, which has to stand things on the ground
// without asking: a GLSL `heightAt(vec2(x, z))`. Change one, change both.
export const HEIGHT_GLSL = `
float heightAt(vec2 p) {
    float rise = p.y * 0.021;
    float swell = sin(p.x * 0.045 + 1.3) * cos(p.y * 0.038) * 0.55 + sin(p.x * 0.11 + p.y * 0.07) * 0.16;
    return (rise + swell) * clamp((p.y + 2.0) / 8.0, 0.0, 1.0);
}
`;

// Every plot there is. Each has an address a person could be given (section,
// row, number, counted from the south end of the row), where it is, and
// whether anything is in it.
export function plots(seed = 1887) {
    const rng = makeRng(seed);
    const out = [];
    for (const s of SECTIONS) {
        let row = 0;
        for (let x = s.x[0] + GRAVE.length / 2; x + GRAVE.length / 2 <= s.x[1]; x += s.pitch) {
            row++;
            let number = 0;
            for (let z = s.z[0] + s.plot / 2; z + s.plot / 2 <= s.z[1]; z += s.plot) {
                number++;
                out.push({
                    id: `${s.id}-${row}-${number}`, section: s.id, row, number, era: s.era,
                    x, z, taken: rng.chance(s.fill),
                    // How the stone has gone over the years: its tilt, and
                    // how far out of line it has walked.
                    tilt: (rng() - 0.5) * 0.16 * s.lean, twist: (rng() - 0.5) * 0.2 * s.lean,
                    drift: [(rng() - 0.5) * 0.18 * s.lean, (rng() - 0.5) * 0.14 * s.lean],
                    roll: rng(),        // for whoever dresses it: which stone, which name
                });
            }
        }
    }
    return out;
}

// Trees: the avenue's two lines, the old ground's big ones, the boundary.
export function trees(seed = 31) {
    const rng = makeRng(seed);
    const out = [];
    for (let z = 10; z <= 54; z += 11) for (const x of [-4.6, 4.6]) out.push({ x, z, size: 1.0 + rng() * 0.2, kind: 'lime' });
    const scatter = (count, x0, x1, z0, z1, size, kind) => {
        for (let i = 0; i < count; i++) out.push({ x: rng.range(x0, x1), z: rng.range(z0, z1), size: size * (0.8 + rng() * 0.4), kind });
    };
    scatter(7, -50, -8, 16, 35, 1.15, 'oak');
    scatter(6, 8, 50, 6, 35, 1.15, 'oak');
    scatter(5, -53, -50, 44, 126, 0.9, 'lime');
    scatter(9, -50, 50, 127, 130.5, 1.0, 'oak');
    scatter(7, -48, -10, 101, 125, 0.45, 'sapling');
    scatter(3, 20, 46, 60, 86, 0.8, 'lime');
    // Nothing grows through a path or a building.
    return out.filter((t) => !BUILDINGS.some((b) => Math.abs(t.x - b.at[0]) < b.size[0] / 2 + 2 && Math.abs(t.z - b.at[1]) < b.size[1] / 2 + 2));
}
