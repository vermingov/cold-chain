// Draw the cemetery flat, from the same plan the game is built from.
//
//     node tools/plan.mjs [out.svg]
//
// A plan is the quickest way to see whether the place makes sense: where the
// gate is from the chapel, how far the public graves are from the lodge's
// window, whether a row can be counted. Ten pixels to the metre.

import { writeFileSync } from 'node:fs';
import { BOUNDS, BUILDINGS, GATES, GRAVE, PATHS, SECTIONS, plots, trees } from '../src/map/plan.js';

const out = process.argv[2] || 'dev/plan.svg';
const S = 10, MARGIN = 14;
const view = { x0: BOUNDS.x0 - MARGIN - 14, x1: BOUNDS.x1 + MARGIN + 14, z0: BOUNDS.z0 - MARGIN - 4, z1: BOUNDS.z1 + MARGIN };
const X = (x) => ((x - view.x0) * S).toFixed(1);
const Y = (z) => ((view.z1 - z) * S).toFixed(1);
const INK = '#23201c', PAPER = '#e9e4d8', PALE = '#cfc8b8';

const parts = [];
const add = (s) => parts.push(s);

add(`<rect width="100%" height="100%" fill="${PAPER}"/>`);

// Paths first, so everything else sits on them.
for (const p of PATHS) {
    const d = p.points.map(([x, z], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(z)}`).join(' ');
    add(`<path d="${d}" fill="none" stroke="${PALE}" stroke-width="${p.width * S}" stroke-linecap="butt" stroke-linejoin="round"/>`);
}

// The wall, broken at the gates.
const wall = { south: [[BOUNDS.x0, 0], [BOUNDS.x1, 0]], north: [[BOUNDS.x0, BOUNDS.z1], [BOUNDS.x1, BOUNDS.z1]],
    west: [[BOUNDS.x0, 0], [BOUNDS.x0, BOUNDS.z1]], east: [[BOUNDS.x1, 0], [BOUNDS.x1, BOUNDS.z1]] };
for (const [side, [[ax, az], [bx, bz]]] of Object.entries(wall)) {
    const alongX = side === 'south' || side === 'north';
    const gaps = GATES.filter((g) => g.wall === side).map((g) => [g.at - g.width / 2, g.at + g.width / 2]).sort((a, b) => a[0] - b[0]);
    let from = alongX ? ax : az;
    const to = alongX ? bx : bz;
    for (const [g0, g1] of [...gaps, [to, to]]) {
        const p = (t) => (alongX ? `${X(t)} ${Y(az)}` : `${X(ax)} ${Y(t)}`);
        add(`<path d="M${p(from)} L${p(g0)}" stroke="${INK}" stroke-width="5"/>`);
        from = g1;
    }
}

for (const b of BUILDINGS) {
    const [w, d] = b.size;
    add(`<rect x="${X(b.at[0] - w / 2)}" y="${Y(b.at[1] + d / 2)}" width="${w * S}" height="${d * S}" fill="${INK}"/>`);
}

// Every plot: a taken one is drawn as its grave, an empty one as its outline.
for (const p of plots()) {
    const x = X(p.x - GRAVE.length / 2), y = Y(p.z + GRAVE.width / 2);
    add(`<rect x="${x}" y="${y}" width="${GRAVE.length * S}" height="${GRAVE.width * S}" `
        + (p.taken ? `fill="${INK}" fill-opacity="0.55"/>` : `fill="none" stroke="${INK}" stroke-opacity="0.25" stroke-width="0.6"/>`));
}

for (const t of trees()) {
    add(`<circle cx="${X(t.x)}" cy="${Y(t.z)}" r="${(t.size * 3.2 * S).toFixed(1)}" fill="${INK}" fill-opacity="0.08" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.8"/>`);
}

// What things are called.
const label = (x, z, text, size = 15, anchor = 'middle') =>
    add(`<text x="${X(x)}" y="${Y(z)}" font-family="Georgia, serif" font-size="${size}" text-anchor="${anchor}" fill="${INK}">${text}</text>`);
for (const s of SECTIONS) label((s.x[0] + s.x[1]) / 2, s.z[1] + 1.2, `${s.id}  ${s.name}`, 17);
label(0, 80.5, 'Chapel of rest', 14);
label(-11, 14, 'Lodge', 14);
label(-6.5, 90.6, 'Store', 12);
label(0, -11.5, 'Vicarage Road', 15);
label(3.4, -2.6, 'Main gate', 13, 'start');
label(-57.5, 43, 'Lych gate', 13, 'end');
label(64.5, 99, 'Service gate', 13, 'start');
label(64.5, 50, 'Service track', 13, 'start');

// North, and how long twenty metres is.
add(`<path d="M${X(view.x1 - 9)} ${Y(view.z1 - 16)} L${X(view.x1 - 9)} ${Y(view.z1 - 6)} M${X(view.x1 - 10.2)} ${Y(view.z1 - 8.4)} L${X(view.x1 - 9)} ${Y(view.z1 - 6)} L${X(view.x1 - 7.8)} ${Y(view.z1 - 8.4)}" stroke="${INK}" stroke-width="1.6" fill="none"/>`);
label(view.x1 - 9, view.z1 - 3.6, 'N', 15);
add(`<path d="M${X(view.x0 + 6)} ${Y(view.z0 + 5)} L${X(view.x0 + 26)} ${Y(view.z0 + 5)}" stroke="${INK}" stroke-width="2"/>`);
label(view.x0 + 16, view.z0 + 6.4, '20 m', 13);

const width = (view.x1 - view.x0) * S, height = (view.z1 - view.z0) * S;
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${parts.join('\n')}\n</svg>\n`);

const all = plots();
console.log(`${out}: ${all.length} plots, ${all.filter((p) => p.taken).length} taken, ${trees().length} trees`);
for (const s of SECTIONS) {
    const mine = all.filter((p) => p.section === s.id);
    console.log(`  ${s.id} ${s.name.padEnd(18)} ${Math.max(...mine.map((p) => p.row))} rows of ${Math.max(...mine.map((p) => p.number))}, ${mine.filter((p) => p.taken).length} graves`);
}
