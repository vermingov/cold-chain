// What a broken bone looks like. In the x-ray (anatomy.ts's mesh): the line it
// broke along, drawn dark where the break crosses the bone's surface, and the
// pieces it broke into moved off where they were. Outside: the end of a
// broken bone come out through the skin.
//
// A break is a surface through the bone. `cut(p)` says how far a point of the
// bone (rest space) lies to one side of it, so the same few lines draw a
// transverse break (a plane across the bone), an oblique one (the plane
// slanted), a spiral (the plane wound round the bone's length), or a ring
// round a bullet's hole. The bone's own triangles are long slivers down a
// shaft, far too coarse to break along, so round a break they are taken out of
// the x-ray, cut small (region) and drawn again here, each small one with the
// half of the bone it is now part of.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

const STEP = 0.004;         // m: no side of a triangle round a break longer than this

export type Cut = (p: BABYLON.Vector3) => number;
export type Tri = { p: BABYLON.Vector3[]; n: BABYLON.Vector3[]; centre: BABYLON.Vector3; owner: any; move?: (p: BABYLON.Vector3) => BABYLON.Vector3; turn?: BABYLON.Quaternion };

// A ragged edge for a break, a few millimetres either way, the same at the same place every time it is asked.
export const jag = (p: BABYLON.Vector3, most: number) =>
    most * (Math.sin(p.x * 731 + p.y * 413) * Math.sin(p.y * 617 - p.z * 389) * 0.7 + 0.3 * Math.sin(p.z * 977 + p.x * 241));

const corner = (array, v) => new V3(array[v * 3], array[v * 3 + 1], array[v * 3 + 2]);
const middle = (p: BABYLON.Vector3[]) => p[0].add(p[1]).addInPlace(p[2]).scaleInPlace(1 / 3);

// Bone `name`'s triangles that `take` takes in (any corner or the middle) or that `cut` crosses, taken out of the
// x-ray's own mesh for whoever asked to draw. Those that `label` puts on more than one side of something (a break, the
// edge of a piece) are cut down small; one left whole that `stays` keeps is left in the x-ray as it was, which is most.
export function region(npc, name: string, take: (p: BABYLON.Vector3) => boolean, cut: Cut | null, label: (p: BABYLON.Vector3) => string,
    stays: (t: Tri) => boolean = () => false): Tri[] {
    const { position, normal, index } = npc.insides.data, out: Tri[] = [], taken: number[] = [];
    // (A corner is shared by half a dozen triangles: what it is labelled is worked out once.)
    const labels = new Map<number, string>();
    const labelOf = (v: number, p: BABYLON.Vector3) => labels.get(v) ?? labels.set(v, label(p)).get(v);
    for (const part of npc.insides.parts) {
        if (part.name !== name) continue;
        for (const c of part.clusters) for (const i of c.tris) {
            if (npc.insides.drawn[i] === npc.insides.drawn[i + 1]) continue;     // taken by an earlier break
            const p = [0, 1, 2].map((j) => corner(position, index[i + j]));
            const k = cut && p.map(cut);
            if (!p.some(take) && !take(middle(p)) && !(k && Math.min(...k) <= 0 && Math.max(...k) >= 0)) continue;
            const before = out.length;
            split(p, [0, 1, 2].map((j) => corner(normal, index[i + j])), p.map((q, j) => labelOf(index[i + j], q)), part.owner, label, out);
            if (out.length === before + 1 && stays(out[before])) out.pop();
            else taken.push(i);
        }
    }
    if (taken.length) npc.insides.hide(taken);
    return out;
}

// A triangle (corners `p`, normals `n`, corners' labels `l`) halved across its longest side until its corners and middle
// agree on their `label` or no side is longer than STEP.
function split(p: BABYLON.Vector3[], n: BABYLON.Vector3[], l: string[], owner, label: (p: BABYLON.Vector3) => string, out: Tri[]) {
    const sides = [V3.DistanceSquared(p[0], p[1]), V3.DistanceSquared(p[1], p[2]), V3.DistanceSquared(p[2], p[0])];
    const longest = sides.indexOf(Math.max(...sides));
    const centre = middle(p);
    if (sides[longest] <= STEP * STEP || (l[0] === l[1] && l[1] === l[2] && label(centre) === l[0])) { out.push({ p, n, centre, owner }); return; }
    const a = longest, b = (a + 1) % 3, c = (a + 2) % 3;
    const mp = V3.Lerp(p[a], p[b], 0.5), mn = V3.Lerp(n[a], n[b], 0.5).normalize(), ml = label(mp);
    split([p[a], mp, p[c]], [n[a], mn, n[c]], [l[a], ml, l[c]], owner, label, out);
    split([mp, p[b], p[c]], [mn, n[b], n[c]], [ml, l[b], l[c]], owner, label, out);
}

// The triangles `cut` passes through, `near` enough: the line a break makes on the bone, dark as on a film.
export function crack(npc, tris: Tri[], cut: Cut, near: (p: BABYLON.Vector3) => boolean = () => true) {
    const crossed = tris.filter((t) => {
        if (!near(t.centre)) return false;
        const k = t.p.map(cut);
        return Math.min(...k) <= 0 && Math.max(...k) >= 0;
    });
    return crossed.length ? sheet(npc, 'fracture_line', crossed, lineMaterial(npc.world.scene), { lift: 0.0007 }) : null;
}

// Triangles drawn as bone, each carried by its own bone and put where its `move` (and its normals where its `turn`)
// sends it: in the x-ray as hurt bone, or with `bare` outside it, always seen, as wet bone that is red where it broke
// (`bare(p)` 1 there, down to 0 away from it).
export function bone(npc, tris: Tri[], bare: ((p: BABYLON.Vector3) => number) | null = null) {
    if (!tris.length) return null;
    if (!bare) return sheet(npc, 'fracture_bone', tris, npc.insides.material('bone', true));
    // Bone under a film of blood, going to raw red marrow and clot at the break.
    const colour = (p) => { const red = bare(p); return [0.72 - 0.4 * red, 0.6 - 0.56 * red, 0.5 - 0.47 * red, 1]; };
    return sheet(npc, 'bone_out', tris, bareMaterial(npc.world.scene), { colour, xray: false });
}

// Triangles as a mesh of their own, skinned as the x-ray is (each wholly to its triangle's bone) and lifted `lift`
// metres along their normals; in the x-ray (shown and hidden with it), or always.
function sheet(npc, name: string, tris: Tri[], material: BABYLON.Material, { lift = 0, colour = null, xray = true }: { lift?: number; colour?: (p) => number[]; xray?: boolean } = {}) {
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), bones = new Float32Array(n * 4), weights = new Float32Array(n * 4);
    const colours = colour ? new Float32Array(n * 4) : null;
    const facing = new V3();
    tris.forEach((t, k) => {
        for (let j = 0; j < 3; j++) {
            const o = k * 3 + j;
            if (t.turn) t.n[j].rotateByQuaternionToRef(t.turn, facing);
            else facing.copyFrom(t.n[j]);
            const at = t.move ? t.move(t.p[j]) : t.p[j];
            pos[o * 3] = at.x + facing.x * lift; pos[o * 3 + 1] = at.y + facing.y * lift; pos[o * 3 + 2] = at.z + facing.z * lift;
            nor[o * 3] = facing.x; nor[o * 3 + 1] = facing.y; nor[o * 3 + 2] = facing.z;
            bones[o * 4] = t.owner.index;
            weights[o * 4] = 1;
            if (colours) colours.set(colour(t.p[j]), o * 4);
        }
    });
    const { person, insides } = npc;
    const mesh = new BABYLON.Mesh(`${person.mesh.name}_${name}`, npc.world.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.normals = nor;
    vd.indices = Uint32Array.from({ length: n }, (_, i) => i);
    vd.matricesIndices = bones;
    vd.matricesWeights = weights;
    if (colours) vd.colors = colours;
    vd.applyToMesh(mesh, false);
    if (xray) mesh.parent = insides.mesh;
    else {
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
    }
    mesh.skeleton = person.skeleton;
    mesh.numBoneInfluencers = 1;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.material = material;
    return mesh;
}

function lineMaterial(scene) {
    const old = scene.getMaterialByName('fracture_line');
    if (old) return old;
    const m = new BABYLON.StandardMaterial('fracture_line', scene);
    m.diffuseColor = new BABYLON.Color3(0.03, 0.01, 0.01);
    m.emissiveColor = new BABYLON.Color3(0.08, 0.005, 0.005);
    m.specularColor = BABYLON.Color3.Black();
    m.zOffset = -2;
    return m;
}

function bareMaterial(scene) {
    const old = scene.getMaterialByName('bone_out');
    if (old) return old;
    const m = new BABYLON.PBRMaterial('bone_out', scene);
    m.albedoColor = BABYLON.Color3.White();
    m.metallic = 0;
    m.roughness = 0.38;
    m.backFaceCulling = false;
    return m;
}
