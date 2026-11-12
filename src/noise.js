// Noise to break things up with.
//
// A scanned surface is two metres of the world repeated, and from across a
// lawn or up a gable the repeat is all the eye sees. This is the cure: one
// small texture of smooth noise that tiles, three different fields of it in
// red, green and blue, which shaders sample at sizes far bigger than any
// surface's own repeat and use to shift a colour or pick between two.

import { makeRng } from './rng.js';

const SIZE = 256;
const made = new WeakMap();

// A field of smooth noise over the unit square that meets itself at the
// edges: random values on a grid of `cells`, eased between.
export function field(rng, cells) {
    const lattice = Float32Array.from({ length: cells * cells }, () => rng());
    const at = (i, j) => lattice[(j % cells) * cells + (i % cells)];
    const ease = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
        const fx = x * cells, fy = y * cells, i = Math.floor(fx), j = Math.floor(fy);
        const u = ease(fx - i), v = ease(fy - j);
        return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
    };
}

// Several fields laid over each other, each finer and fainter than the last.
export function layered(rng, cells) {
    const fields = cells.map((c) => field(rng, c));
    const total = fields.reduce((sum, _, i) => sum + 0.5 ** i, 0);
    return (x, y) => fields.reduce((sum, f, i) => sum + f(x, y) * 0.5 ** i, 0) / total;
}

// The scene's noise texture, made the first time it is asked for.
export function noiseTexture(scene) {
    if (made.has(scene)) return made.get(scene);
    const rng = makeRng(4099);
    const channels = [layered(rng, [5, 11]), layered(rng, [7, 17]), layered(rng, [9, 23])];
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const o = (y * SIZE + x) * 4;
            // Layered noise bunches round the middle; spread it back out.
            channels.forEach((f, c) => { data[o + c] = Math.max(0, Math.min(255, ((f(x / SIZE, y / SIZE) - 0.5) * 1.9 + 0.5) * 255)); });
            data[o + 3] = 255;
        }
    }
    const tex = BABYLON.RawTexture.CreateRGBATexture(data, SIZE, SIZE, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.name = 'noise';
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    made.set(scene, tex);
    return tex;
}
