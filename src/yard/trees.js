// The trees, in winter.
//
// Bare: a trunk, and every limb dividing into smaller ones until they are
// twigs. Against fog and a low sky that is all a tree is, and it is built
// here rather than fetched because a scanned tree is millions of triangles
// of leaves this season does not have.
//
// A handful of trees are grown once and every tree in the plan is one of
// them, turned and scaled: the eye does not catch the same limes down an
// avenue, and planted limes are the same tree anyway.

import { Buf } from '../geometry.js';
import { makeRng } from '../rng.js';
import { heightAt } from '../map/plan.js';

// How each kind grows. `spread` is how far a limb leaves the line of its
// parent, `lift` how hard everything reaches up, `taper` how much thinner a
// limb is than what it came from.
const KINDS = {
    lime: { trunk: 0.3, first: 2.6, spread: 0.52, lift: 0.5, taper: 0.62, depth: 6, forks: [2, 3], surface: 'bark' },
    oak: { trunk: 0.42, first: 2.0, spread: 0.85, lift: 0.22, taper: 0.66, depth: 6, forks: [2, 3], surface: 'oakbark' },
    sapling: { trunk: 0.07, first: 1.2, spread: 0.5, lift: 0.6, taper: 0.6, depth: 4, forks: [2, 2], surface: 'bark' },
};
const VARIANTS = 2;
const BLOCK = 30;       // metres square of yard whose trees are drawn together

// How thick a tree of the plan's is at the foot, in metres from its middle.
export const trunkOf = (tree) => KINDS[tree.kind].trunk * tree.size;

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// One limb: a few bent segments, thinning, and at its end the limbs that
// come off it.
function limb(buf, kind, rng, from, heading, length, radius, depth) {
    const segments = depth > 3 ? 4 : 3;
    const path = [from], radii = [radius];
    let at = from, dir = heading;
    for (let i = 1; i <= segments; i++) {
        // It wanders, and it reaches for the light.
        dir = unit(add(add(dir, [rng() - 0.5, rng() - 0.5, rng() - 0.5], 0.28), [0, 1, 0], kind.lift * 0.22));
        at = add(at, dir, length / segments);
        path.push(at);
        radii.push(radius * (1 - (1 - kind.taper) * (i / segments)));
    }
    const sides = radius > 0.09 ? 8 : radius > 0.03 ? 5 : 3;
    buf.tube(path, radii, 0.9, { sides });
    if (depth <= 1) return;

    const forks = kind.forks[0] + rng.int(kind.forks[1] - kind.forks[0] + 1);
    const turn = rng() * Math.PI * 2;
    for (let f = 0; f < forks; f++) {
        // Round the parent, evenly, each leaning out from it.
        const a = turn + (f / forks) * Math.PI * 2;
        const side = unit([Math.cos(a), 0.15, Math.sin(a)]);
        const out = unit(add(dir, side, kind.spread * (0.7 + rng() * 0.6)));
        limb(buf, kind, rng, at, out, length * (0.66 + rng() * 0.16), radii[segments] * (0.78 + rng() * 0.12), depth - 1);
    }
}

function grow(kind, seed) {
    const rng = makeRng(seed);
    const buf = new Buf();
    limb(buf, kind, rng, [0, -0.3, 0], [0, 1, 0], kind.first + 0.3, kind.trunk, kind.depth);
    return buf;
}

// Every tree in the plan. Returns the meshes, for whoever makes them cast.
export function buildTrees(scene, surfaces, trees) {
    const meshes = [];
    for (const [name, kind] of Object.entries(KINDS)) {
        const mine = trees.filter((t) => t.kind === name);
        for (let v = 0; v < VARIANTS; v++) {
            const these = mine.filter((_, i) => i % VARIANTS === v);
            if (!these.length) continue;
            const shape = grow(kind, 977 * (v + 1) + name.length);
            // Drawn a block of the yard at a time, so what is out of sight is not drawn (stones.js does the same).
            const blocks = new Map();
            for (const t of these) {
                const key = Math.floor(t.x / BLOCK) + ',' + Math.floor(t.z / BLOCK);
                if (!blocks.has(key)) blocks.set(key, []);
                blocks.get(key).push(t);
            }
            for (const [key, here] of blocks) {
                // (Each its own geometry: the instances are kept on the geometry, and a clone would share them.)
                const mesh = shape.toMesh(`tree_${name}${v}_${key}`, scene, surfaces.material(kind.surface));
                mesh.useVertexColors = false;
                const data = new Float32Array(here.length * 16);
                here.forEach((t, i) => {
                    const turn = BABYLON.Quaternion.RotationYawPitchRoll(t.x * 12.9898 + t.z * 78.233, 0, 0);
                    BABYLON.Matrix.Compose(new BABYLON.Vector3(t.size, t.size, t.size), turn, new BABYLON.Vector3(t.x, heightAt(t.x, t.z), t.z))
                        .copyToArray(data, i * 16);
                });
                mesh.thinInstanceSetBuffer('matrix', data, 16, true);
                mesh.thinInstanceRefreshBoundingInfo(false);
                mesh.receiveShadows = true;
                mesh.isPickable = false;
                meshes.push(mesh);
            }
        }
    }
    return meshes;
}
