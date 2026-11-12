// What stands over the graves.
//
// A cemetery is read from its stones before anything else: tall and leaning
// in the old ground, low and regular on the lawns, and in the public ground
// nothing at all but a numbered iron marker and a mound. Each kind of stone
// is one mesh, cut to its outline, and every grave that has one is a thin
// instance of it, so thirteen hundred of them are a dozen draw calls.
//
// A stone stands at the head of its grave, the west end, and faces east
// along it. What is cut into its face comes from the register
// (inscriptions.js): each stone carries, beside where it stands, which
// inscription is its own.

import { Buf } from '../geometry.js';
import { GRAVE, heightAt } from '../map/plan.js';
import { OUTLINES } from './outlines.js';
import { Inscribed, paintInscriptions } from './inscriptions.js';

const SUNK = 0.3;       // how much of a stone is in the ground
const BLOCK = 20;       // metres square of yard whose stones are drawn together
const TILE = 1.5;       // metres of a slab's scan to a repeat

// How a stone was finished: how its surface is asked for, and the colour of
// what is cut into it ([r, g, b, how solid], as light). A mason's cut in
// plain stone is only shadow; polished granite is gilded, white marble
// leaded, and iron painted.
const FINISHES = {
    plain: { look: {}, ink: [0.03, 0.028, 0.025, 0.8] },
    polished: { look: { rough: 0.45, relief: 0.12, tint: [0.7, 0.7, 0.74] }, ink: [0.6, 0.42, 0.14, 0.9] },
    white: { look: { tint: [1.55, 1.55, 1.5] }, ink: [0.1, 0.1, 0.11, 0.85] },
    rusted: { look: { tint: [0.4, 0.33, 0.3] }, ink: [0.75, 0.75, 0.7, 0.9] },
};

// How much of its lettering a stone has lost, least to most, by the ground
// it stands in. Sixty winters do little to granite and a hundred and fifty
// take most of a sandstone face.
const WORN = { victorian: [0.35, 0.9], postwar: [0.0, 0.16], lawn: [0, 0], public: [0.05, 0.25] };

// A slab of a shape, so wide, so tall out of the ground, so thick.
const slab = (shape, w, h, depth) => (b, t) => b.extrude(OUTLINES[shape](w, h + SUNK, -SUNK), depth, t);

// The kinds of stone there are: how each is built, what it is cut from (a
// surface name; the same shape in two stones is two kinds) and how finished.
// `panel` is where its inscription goes: how far up the middle of it is, and
// how wide. A kind without one says nothing. `girth` is how far from its
// middle it stops somebody walking, where that is not a slab's usual.
const GIRTH = 0.3;
const KINDS = {
    tallRound: { stone: 'sandstone', panel: [0.74, 0.5], build: slab('round', 0.62, 1.35, 0.11) },
    tallGothic: { stone: 'limestone', panel: [0.8, 0.52], build: slab('gothic', 0.66, 1.55, 0.12) },
    tallShoulder: { stone: 'lichen', panel: [0.66, 0.56], build: slab('shoulder', 0.7, 1.25, 0.12) },
    greyRound: { stone: 'limestone', panel: [0.52, 0.46], build: slab('round', 0.58, 1.05, 0.1) },
    cross: {
        stone: 'limestone', girth: 0.38,
        build(b, t) {
            b.box([-0.36, -SUNK, -0.24], [0.36, 0.2, 0.24], t);
            b.box([-0.26, 0.2, -0.17], [0.26, 0.42, 0.17], t);
            b.box([-0.085, 0.42, -0.07], [0.085, 1.75, 0.07], t);
            b.box([-0.36, 1.22, -0.07], [0.36, 1.39, 0.07], t);
        },
    },
    chest: {
        stone: 'sandstone', over: true, girth: 0.62,
        build(b, t) {
            b.box([-0.92, -0.1, -0.4], [0.92, 0.62, 0.4], t, { foot: 0.6 });
            b.box([-1.0, 0.62, -0.46], [1.0, 0.72, 0.46], t);
        },
    },
    midRound: { stone: 'granite', finish: 'polished', panel: [0.4, 0.46], build: slab('round', 0.56, 0.86, 0.09) },
    midShoulder: { stone: 'limestone', finish: 'white', panel: [0.38, 0.5], build: slab('shoulder', 0.6, 0.8, 0.09) },
    midSquare: { stone: 'sandstone', panel: [0.38, 0.5], build: slab('square', 0.6, 0.72, 0.1) },
    lawnSquare: { stone: 'granite', finish: 'polished', panel: [0.25, 0.4], build: slab('square', 0.46, 0.46, 0.09) },
    lawnMarble: { stone: 'limestone', finish: 'white', panel: [0.21, 0.37], build: slab('square', 0.42, 0.4, 0.08) },
    // The public ground: an iron stake with a number plate, nothing else.
    marker: {
        stone: 'iron', finish: 'rusted', panel: [0.36, 0.13], girth: 0,
        build(b, t) {
            b.box([-0.012, -0.2, -0.012], [0.012, 0.42, 0.012], t);
            b.box([-0.075, 0.3, 0.012], [0.075, 0.42, 0.02], t);
        },
    },
    // The meadow: an oak post.
    post: { stone: 'post', girth: 0, build: (b, t) => b.box([-0.05, -0.3, -0.05], [0.05, 0.55, 0.05], t) },
};

// Which kinds an era's graves get, most likely first.
const BY_ERA = {
    victorian: ['tallRound', 'tallGothic', 'tallShoulder', 'greyRound', 'cross', 'tallRound', 'chest'],
    postwar: ['midRound', 'midShoulder', 'midSquare', 'midRound', 'greyRound'],
    lawn: ['lawnSquare', 'lawnMarble', 'lawnSquare'],
    public: ['marker'],
    meadow: ['post'],
};

// The matrix that stands a stone at the head of a plot, with the lean and
// the drift the years have given it.
function standing(plot, over) {
    const x = plot.x + (over ? 0 : -GRAVE.length / 2 + 0.12) + plot.drift[0];
    const z = plot.z + plot.drift[1];
    // An upright faces east along its grave; a tomb lies along it.
    const turn = BABYLON.Quaternion.RotationYawPitchRoll((over ? 0 : Math.PI / 2) + plot.twist, plot.tilt, plot.tilt * 0.6);
    return BABYLON.Matrix.Compose(BABYLON.Vector3.One(), turn, new BABYLON.Vector3(x, heightAt(x, z), z));
}

// A low heap of earth the length of a grave, for the ones not long filled.
function moundMesh(scene, material) {
    const buf = new Buf();
    const rings = 5, around = 14;
    const at = (i, j) => {
        const r = i / rings, a = (j / around) * Math.PI * 2;
        const lift = Math.cos(r * Math.PI / 2);
        return {
            p: [Math.cos(a) * r * GRAVE.length * 0.52, 0.2 * lift, Math.sin(a) * r * GRAVE.width * 0.56],
            n: [Math.cos(a) * r * 0.4, 1, Math.sin(a) * r * 0.9],
            shade: 1 - 0.35 * r * r,        // darker where it meets the grass
        };
    };
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < around; j++) {
            const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
            const base = buf.positions.length / 3;
            for (const c of q) buf.vertex(c.p, c.n, [c.p[0] / 1.4, c.p[2] / 1.4], c.shade);
            buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    return buf.toMesh('mound', scene, material);
}

// Which stone stands on which plot, and which of them say something. Gives
// back the stones of each kind as { matrix, inscription } (the inscription
// being the four numbers the stone's material wants, or nothing), the
// mounds and which plot each is on (`mounded`: plot id -> its place among
// them), the inscriptions to be painted, in the order they are numbered,
// and where the middle of every stone is and its girth (`heads`: x, y, z,
// girth).
function setOut(plots, people) {
    const stones = new Map(Object.keys(KINDS).map((k) => [k, []]));
    const mounds = [], mounded = new Map(), inscriptions = [], heads = [];
    for (const plot of plots) {
        if (!plot.taken) continue;
        const kinds = BY_ERA[plot.era], name = kinds[Math.floor(plot.roll * kinds.length)], kind = KINDS[name];
        const chance = plot.roll * 7 % 1;       // a second throw of the plot's own dice
        if ((plot.era === 'public' && plot.roll > 0.45) || plot.fresh) {
            mounds.push(BABYLON.Matrix.Translation(plot.x, heightAt(plot.x, plot.z) - 0.02, plot.z));
            mounded.set(plot.id, mounds.length - 1);
        }
        // One in five of the old stones is gone altogether.
        if (plot.era === 'victorian' && chance <= 0.2) continue;
        let inscription = null;
        if (kind.panel) {
            const [least, most] = WORN[plot.era];
            inscription = [inscriptions.length, ...kind.panel, least + (most - least) * (plot.roll * 13 % 1)];
            inscriptions.push({ era: plot.era, person: people.get(plot.id), plot });
        }
        const matrix = standing(plot, kind.over), foot = matrix.getTranslation();
        stones.get(name).push({ matrix, inscription });
        heads.push([foot.x, foot.y + 0.5, foot.z, kind.girth ?? GIRTH]);
    }
    return { stones, mounds, mounded, inscriptions, heads };
}

// `fixed` for what never moves again; a mound can be dug away.
const instanced = (mesh, matrices, fixed = true) => {
    const data = new Float32Array(matrices.length * 16);
    matrices.forEach((m, i) => m.copyToArray(data, i * 16));
    mesh.thinInstanceSetBuffer('matrix', data, 16, fixed);
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
};

// Every stone in the place. `plots` is the plan's and `people` the
// register's; `surfaces` has the stones loaded and `fonts` is where the
// typefaces are. Returns the meshes, so whoever lights the yard can make
// them cast, where the stones are (`heads`: the middle of each), and
// `flatten(plot id)`, which takes the mound off a plot.
export async function buildStones(scene, surfaces, plots, people, fonts) {
    const { stones, mounds, mounded, inscriptions, heads } = setOut(plots, people);
    const sheet = await paintInscriptions(scene, inscriptions, fonts);

    // A material for each stone and finish, its own (not the wall's) because
    // the lettering is fixed to it.
    const cut = new Map();
    const material = (kind) => {
        const finish = FINISHES[kind.finish || 'plain'], key = `${kind.stone}:${kind.finish}`;
        if (!cut.has(key)) {
            const m = surfaces.material(kind.stone, { ...finish.look, own: 'stones' });
            new Inscribed(m, sheet, finish.ink);
            cut.set(key, m);
        }
        return cut.get(key);
    };

    // Each kind of stone is drawn as one mesh for each block of the yard it stands in, so a block out of sight, or out
    // of the torch's reach, is not drawn at all (for the eye or for any shadow).
    const meshes = [];
    for (const [name, standing] of stones) {
        if (!standing.length) continue;
        const kind = KINDS[name], buf = new Buf();
        kind.build(buf, TILE);
        const blocks = new Map();
        for (const stone of standing) {
            const at = stone.matrix.getTranslation(), key = Math.floor(at.x / BLOCK) + ',' + Math.floor(at.z / BLOCK);
            if (!blocks.has(key)) blocks.set(key, []);
            blocks.get(key).push(stone);
        }
        for (const [key, here] of blocks) {
            // (Each its own geometry: the instances are kept on the geometry, and a clone would share them.)
            const mesh = buf.toMesh(`stone_${name}_${key}`, scene, material(kind));
            mesh.useVertexColors = false;
            instanced(mesh, here.map((s) => s.matrix));
            // A stone that says nothing has a panel of no width.
            mesh.thinInstanceSetBuffer('inscription', new Float32Array(here.flatMap((s) => s.inscription || [0, 0, 0, 0])), 4, true);
            mesh.thinInstanceRefreshBoundingInfo(false);
            meshes.push(mesh);
        }
    }
    const mound = mounds.length ? instanced(moundMesh(scene, surfaces.material('soil')), mounds, false) : null;
    if (mound) meshes.push(mound);
    // A grave dug into loses its mound.
    const flatten = (plot) => {
        if (!mounded.has(plot)) return;
        mound.thinInstanceSetMatrixAt(mounded.get(plot), BABYLON.Matrix.Scaling(0, 0, 0));
    };
    return { meshes, heads, flatten };
}
