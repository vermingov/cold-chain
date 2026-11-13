// The belly or chest opened: what is inside seen, and what can come out.
//
// An opening is a hole through the body's wall: the skin and the clothes
// over it are not drawn there (hider.ts), its lips show the layers the wall
// was cut through (marks.ts's rim), and through it the body's own organs
// are seen, the real ones from anatomy.ts in their places, each in a wet
// look of its own: the small bowel's pink coils with the fine vessels that
// run round them, the liver dark and glossy, the stomach, the colon, the
// lungs and the heart behind the ribs, and blood on them where they were hit
// and round the opening. Behind the skin, where no organ is, the body's wall
// is seen from inside (hider.ts's `opens`).
//
// Nothing is made to fall out. Behind an opening in the belly lie the
// organs that are free to move: loops of small bowel on their long
// mesentery, the colon on its shorter one, the stomach held at both ends.
// Each is a rope of points (verlet) of its own width, lying in the belly,
// held by its attachments, kept in by the wall everywhere but the opening.
// What pushes on them is what pushes on the real ones: the pressure in the
// belly (the tone of a living wall, and the weight of everything above the
// opening, the belly's contents behaving like a fluid), and, once a part is
// out, its own weight and the body's motion. A part comes through only if
// the opening is wide enough for it doubled over on itself (both ends of a
// loop stay inside): a gunshot or a short stab cannot let bowel out, a long
// slash or a wall blown open can, and then it slides out, hangs and lies on
// the body or the floor. What is out can be taken hold of and pulled.
//
// What comes out, from the literature on abdominal stab wounds with evisceration: mostly omentum, then small bowel,
// less often colon, and stomach (an 81-patient series: omentum 75 %, small bowel 22 %, colon 2 %, PubMed 10528593;
// another of 61 with organs out: small bowel 59 %, colon 28 %, stomach 13 %). The omentum is not in the anatomy.
// Intra-abdominal pressure in healthy adults (Cobb et al., J Surg Res 2005, bladder pressure): about 2 mmHg lying,
// 20 standing (most of it the weight of the contents), 80 to 100+ coughing or straining.

import * as BABYLON from '@babylonjs/core';
import { GLSL_BLOOD } from './fluid.ts';
const V3 = BABYLON.Vector3;

// A cut must be this deep to go through the abdominal wall (skin, fat, muscle and peritoneum: 2 to 4 cm in a lean man).
export const WALL = 0.025;
// Joules a heavy charge must leave in the trunk to blow a hole through its wall, and kPa of a blast to burst it.
export const BLOWN = 600;
export const BURST = 1400;

const CLOTHES = 0.04;       // m the clothes stand off the body, which what is out lies on
const REACH = 0.2;          // m round an opening within which the organs are drawn, and within which they can come out
const SIDES = 16;           // round each rope drawn along it
const SPLIT = 2;            // pieces each step of a rope is drawn in, along a smooth curve through its points
const DENSITY = 1040;       // kg/m3 of bowel with its contents
const MMHG = 133.3;
const PACKED = 10;          // the packed contents a bit of bowel has to move to come forward, over its own mass

// What can come out: half its width, metres of it free behind the opening, how far its attachments let its middle go
// from where they hold it, and how many.
const ROPES: Record<string, { r: number; length: number; tether: number; count: number }> = {
    bowel: { r: 0.014, length: 0.6, tether: 0.16, count: 3 },
    colon: { r: 0.024, length: 0.4, tether: 0.07, count: 1 },
    stomach: { r: 0.032, length: 0.26, tether: 0.05, count: 1 },
};

// The look of each kind of thing inside: albedo (sRGB 0-255), how many fine vessels run over it, how mottled it is,
// how much fat lies on it, how rough it is.
const LOOK: Record<string, { c: number[]; vessels: number; mottle: number; fat: number; rough: number }> = {
    bowel: { c: [214, 132, 120], vessels: 0.7, mottle: 0.25, fat: 0.05, rough: 0.32 },
    colon: { c: [196, 140, 118], vessels: 0.5, mottle: 0.35, fat: 0.35, rough: 0.36 },
    stomach: { c: [206, 140, 132], vessels: 0.8, mottle: 0.3, fat: 0.15, rough: 0.34 },
    liver: { c: [96, 26, 20], vessels: 0.1, mottle: 0.5, fat: 0, rough: 0.22 },
    gallbladder: { c: [84, 118, 76], vessels: 0.2, mottle: 0.2, fat: 0, rough: 0.2 },
    spleen: { c: [92, 30, 46], vessels: 0.1, mottle: 0.4, fat: 0, rough: 0.25 },
    pancreas: { c: [222, 176, 132], vessels: 0.2, mottle: 0.8, fat: 0.2, rough: 0.4 },
    kidney: { c: [120, 40, 32], vessels: 0.1, mottle: 0.3, fat: 0.3, rough: 0.25 },
    adrenal: { c: [214, 160, 70], vessels: 0, mottle: 0.4, fat: 0.3, rough: 0.35 },
    bladder: { c: [222, 196, 168], vessels: 0.5, mottle: 0.2, fat: 0.1, rough: 0.3 },
    lung: { c: [206, 140, 140], vessels: 0.2, mottle: 0.9, fat: 0, rough: 0.3 },
    heart: { c: [120, 26, 24], vessels: 0.5, mottle: 0.3, fat: 0.6, rough: 0.3 },
    muscle: { c: [140, 30, 26], vessels: 0.1, mottle: 0.3, fat: 0, rough: 0.35 },
    airway: { c: [220, 196, 186], vessels: 0.3, mottle: 0.1, fat: 0, rough: 0.35 },
    oesophagus: { c: [190, 110, 100], vessels: 0.3, mottle: 0.2, fat: 0, rough: 0.35 },
    bone: { c: [226, 214, 188], vessels: 0.05, mottle: 0.2, fat: 0, rough: 0.45 },
    cartilage: { c: [214, 218, 212], vessels: 0, mottle: 0.1, fat: 0, rough: 0.3 },
};
// What is drawn through an opening (not the skull's contents, nor the limbs' bones, nor what lies behind the belly's
// lining at the back: the kidneys and the glands on them).
const SHOWN = /^(bowel|colon|stomach|liver|gallbladder|spleen|pancreas|bladder|lung|heart|muscle|airway|oesophagus)$/;
const SHOWN_BONES = /rib|sternum|vertebra|sacrum|hip bone|costal/;

// --- what others call ---------------------------------------------------------------------

// An opening through the wall of person `npc`'s belly or chest at skin crossing `hit` (npc.surface's), running along
// world direction `along`, `length` by `width` metres. Returns the opening, or null if `hit` is not on the trunk.
export function open(npc, hit, along: BABYLON.Vector3, length: number, width: number) {
    return (npc.viscera as Viscera).open(hit, along, length, width);
}

// A blade drawn across person `npc` through skin crossings `hits`, `deep` metres into the flesh (npc.slash): a long
// enough cut through the wall of the belly or chest opens it.
export function slashed(npc, hits, deep: number) {
    if (deep < WALL) return null;
    // (A crossing found on the body at rest has no point in the world: it is worked out.)
    const skin = hits.filter((h) => h.kind === 'skin').map((h) => (h.point ? h : { ...h, point: npc.worldOf(h.rest, h.owner).at })).filter((h) => trunk(npc, h.point));
    if (skin.length < 2) return null;
    let length = 0;
    for (let k = 1; k < skin.length; k++) length += Math.min(0.15, V3.Distance(skin[k - 1].rest, skin[k].rest));
    if (length < 0.06) return null;
    const mid = skin[Math.floor(skin.length / 2)];
    const along = skin[skin.length - 1].point.subtract(skin[0].point).normalize();
    // A cut through the wall gapes: the muscles either side pull it open, more the longer it is.
    return open(npc, mid, along, length, Math.min(0.06, 0.01 + length * 0.28));
}

// A heavy charge (a shotgun's at contact range) `calibre` metres across that left `spent` joules in person `npc`, in
// at skin crossing `hit`. The hole it blows through the wall is about as wide as the charge was, wider the more it
// spent: 2 to 4 cm at contact to 30 cm (DiMaio, dev/research/wounds.md 5.1), the wad and the gas tearing the edge.
export function blown(npc, hit, spent: number, calibre: number) {
    if (!hit || spent < BLOWN * 0.5 || !trunk(npc, hit.point)) return null;
    const r = (calibre / 2) * (1 + 0.6 * Math.min(1, spent / (BLOWN * 2)));
    return open(npc, hit, new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), r * 2, r * 2);
}

// A blast whose peak overpressure at person `npc`'s belly was `kPa`, from world point `from`: close enough, it tears
// the wall open, wider the closer it was.
export function burst(npc, from: BABYLON.Vector3, kPa: number) {
    if (kPa < BURST * 0.6) return null;
    const belly = npc.ragdoll.byName.get('belly'), at = npc.ragdoll.worldPoint(belly, belly.centre, new V3());
    const dir = at.subtract(from).normalize();
    const hit = npc.surface(at.subtract(dir.scale(0.4)), dir, 0.5).find((h) => h.kind === 'skin');
    if (!hit) return null;
    const k = Math.min(1.6, kPa / BURST);
    return open(npc, hit, V3.Up(), 0.12 * k, 0.07 * k);
}

// What of an organ came out that is nearest the line from `origin` along unit `dir`, within `far`, on any of `npcs`:
// something to take hold of with pull(), or null. (Out of the body, or in the opening itself: a hand can reach that.)
export function pick(npcs, origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number) {
    let best = null;
    for (const npc of npcs) {
        const v = npc.viscera as Viscera;
        for (const loop of v?.loops ?? []) {
            for (let i = 2; i < loop.count - 2; i++) {
                if (!loop.out[i] && !loop.passing[i]) continue;
                const p = loop.at(i), t = V3.Dot(p.subtract(origin), dir);
                if (t < 0 || t > far) continue;
                const miss = V3.Distance(origin.add(dir.scale(t)), p);
                if (miss < loop.r * 2.2 && (!best || t < best.distance)) best = { viscera: v, loop, index: i, distance: t };
            }
        }
    }
    return best;
}

// Pull what pick() found toward world point `to`: as a hand holding it would, and more of it comes out after it.
export function pull(held, to: BABYLON.Vector3) {
    held.loop.hold = { index: held.index, to: to.clone() };
}

export function letGo(held) { if (held?.loop) held.loop.hold = null; }

// An organ `part` (anatomy.ts's) wounded at world point `at` by a missile `wide` metres across its channel: blood
// on it there, seen when the body is open (wounds.ts).
export function bled(npc, part, at: BABYLON.Vector3, wide: number) {
    (npc.viscera as Viscera)?.bled(part, at, wide);
}

// --- one person's insides ---------------------------------------------------------------------

function trunk(npc, point: BABYLON.Vector3) { return region(npc, point) !== null; }
function region(npc, point: BABYLON.Vector3): 'belly' | 'chest' | null {
    if (!point) return null;
    const name = npc.ragdoll.nearest(point).seg?.name;
    return name === 'belly' || name === 'pelvis' ? 'belly' : name === 'chest' ? 'chest' : null;
}

type Opening = { at: BABYLON.Vector3; normal: BABYLON.Vector3; ex: BABYLON.Vector3; owner: any; half: number[] };

export class Viscera {
    declare npc: any;
    declare openings: Opening[];
    declare loops: Loop[];
    declare mesh: BABYLON.Mesh | null;
    declare tubes: Map<string, BABYLON.PBRMaterial>;
    declare spots: { at: BABYLON.Vector3; r: number }[];
    declare _stale: boolean;
    declare _drip: number;
    declare _told: Set<string>;

    constructor(npc) {
        this.npc = npc;
        this.openings = [];
        this.loops = [];
        this.mesh = null;
        this.spots = [];
        this._stale = false;
        this._drip = 0;
        this._told = new Set();
    }

    open(hit, along: BABYLON.Vector3, length: number, width: number) {
        const npc = this.npc;
        if (!hit || hit.kind !== 'skin' || !trunk(npc, hit.point ?? npc.worldOf(hit.rest, hit.owner).at)) return null;
        hit = hit.point ? hit : { ...hit, point: npc.worldOf(hit.rest, hit.owner).at };
        // Rest space: the opening's middle, which way it runs, which way the skin faces.
        const toRest = npc.restToWorld(hit.owner).clone().invert(), n = hit.restNormal;
        let ex = V3.TransformNormal(along, toRest);
        ex = ex.subtract(n.scale(V3.Dot(ex, n)));
        ex = ex.lengthSquared() > 1e-8 ? ex.normalize() : tangent(n);
        const half = [Math.max(length / 2, width / 2), width / 2];
        const o: Opening = { at: hit.rest.clone(), normal: n.clone(), ex, owner: hit.owner, half };
        // The wall: no skin there, nor the clothes over it, which are torn a little wider; the skin under the clothes shown
        // round it; seen through, the body's inside.
        const hole = { at: o.at, ex, ey: n, half };
        for (const h of [npc.skinHider, ...npc.underHiders]) { h.add(hole); h.opens(); }
        for (const h of npc.clothHiders) h.add({ at: o.at, ex, ey: n, half: [half[0] * 1.1 + 0.005, half[1] * 1.15 + 0.004] });
        for (const h of npc.underHiders) h.window(o.at, n, half[0] + 0.015, 0.05);
        this._lips(o);
        this.openings.push(o);
        this._organs();
        // What it does: the wall's own vessels bleed, and the chest open, the lung falls in.
        const v = npc.vitals, chest = region(npc, npc.worldOf(o.at, o.owner).at) === 'chest';
        v.pain = Math.min(1, v.pain + 0.5);
        v.bleed({ name: chest ? 'chest wall' : 'abdominal wall', rate: 0.0008 + length * 0.006, clots: 0.006, source: { mark: hit } });
        if (chest) {
            // Air drawn in through the hole as the chest rises: the lung on that side falls in (a sucking chest wound).
            const side = V3.Dot(o.at, V3.Right()) > 0 ? 'L' : 'R';
            v.lungs[`leak${side}`] = true;
            v.injure('Chest wall opened: air sucked in, the lung collapsing', 8);
        } else {
            v.injure('Belly opened: organs showing', 7);
            this._behind(o);
        }
        npc.world.sound?.shot('wet', { at: npc.worldOf(o.at, o.owner).at.asArray(), gain: 0.8 });
        return o;
    }

    bled(part, at: BABYLON.Vector3, wide: number) {
        if (this.spots.length >= 96) return;
        const rest = V3.TransformCoordinates(at, this.npc.restToWorld(part.owner).clone().invert());
        this.spots.push({ at: rest, r: 0.02 + wide * 1.5 });
        this._stale = true;
    }

    // The lips of the opening: the layers of the wall it went through, all round its edge (the lens hider.ts leaves), in
    // a band wider the wider it gapes: the skin draws back further than the fat under it.
    _lips(o: Opening) {
        // (Each point of the edge found on the skin by a line in from outside along the skin's facing: the edge laid
        // flat across a curved belly stands off it, nearer the clothes than the skin, and nearest() then finds cloth.)
        const npc = this.npc, ey = V3.Cross(o.normal, o.ex), edge = [];
        for (let k = 0; k < 40; k++) {
            const a = (k / 40) * Math.PI * 2, x = Math.cos(a) * o.half[0];
            const w = npc.worldOf(o.at.add(o.ex.scale(x)).add(ey.scale(Math.sign(Math.sin(a)) * gape(o.half, x))), o.owner, o.normal);
            const on = npc.surface(w.at.add(w.normal.scale(0.1)), w.normal.scale(-1), 0.2).find((h) => h.kind === 'skin');
            if (on) edge.push(on);
        }
        if (edge.length > 2) npc.marks.lip(edge, Math.min(0.015, 0.006 + o.half[1] * 0.25));
    }

    // --- what can come out ----------------------------------------------------------------------

    // The free organs that lie behind opening `o` (within reach of it in the anatomy): each as a rope in its place, its
    // ends where its attachments hold it, a little deeper than the wall, all of it inside to begin with.
    _behind(o: Opening) {
        if (this.loops.length >= 6) return;
        const npc = this.npc;
        for (const [kind, spec] of Object.entries(ROPES)) {
            // The nearest of that organ to the opening; none near, nothing of it behind.
            let near = null, best = REACH;
            for (const part of npc.insides.parts) {
                if (part.kind !== kind) continue;
                for (const c of part.clusters) {
                    const d = boxDistance(c.lo, c.hi, o.at);
                    if (d < best) { best = d; near = c.lo.add(c.hi).scale(0.5); }
                }
            }
            // (Already one of these from an opening close by: the same organ.)
            if (!near || this.loops.some((l) => l.kind === kind && V3.Distance(l.o.at, o.at) < 0.12)) continue;
            const ey = V3.Cross(o.normal, o.ex);
            const toward = near.subtract(o.at), depth = Math.min(-(WALL + spec.r * 2 + 0.02), Math.max(-0.12, V3.Dot(toward, o.normal)));
            for (let k = 0; k < spec.count; k++) {
                // Side by side behind the opening, shifted a little toward where the organ lies.
                const s = (k - (spec.count - 1) / 2) * spec.r * 2.6;
                const root = o.at.add(o.normal.scale(depth)).add(o.ex.scale(V3.Dot(toward, o.ex) * 0.3 + (Math.random() - 0.5) * 0.02)).add(ey.scale(V3.Dot(toward, ey) * 0.3 + s));
                const gap = spec.r * (1.5 + Math.random());
                this.loops.push(new Loop(this, o, kind, root.add(o.ex.scale(-gap)), root.add(o.ex.scale(gap))));
            }
        }
    }

    // The outside of each kind that can come out (small bowel, colon, stomach): its painted wall and its relief, a soft
    // wet sheen on it (the serosa glistens; it is not lacquered), and blood on it where it came through the wound. (One
    // for each kind for everybody.)
    _tube(kind: string) {
        const scene: BABYLON.Scene = this.npc.world.scene, old = scene.getMaterialByName(`${kind}_out`);
        if (old) return old as BABYLON.PBRMaterial;
        const m = new BABYLON.PBRMaterial(`${kind}_out`, scene), look = this._tubeLook(kind);
        m.albedoTexture = look.albedo;
        m.bumpTexture = look.relief;
        m.bumpTexture.level = 1;
        m.metallic = 0;
        m.roughness = 0.5;
        // The wet film on it: a thin coat with its own small sharp highlights, broken up by the same relief. (A clear
        // coat takes no part of the bump map unless given it: on a smooth tube its highlight ran the length of a loop as
        // one white streak.)
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 0.45;
        m.clearCoat.roughness = 0.24;
        m.clearCoat.bumpTexture = look.relief;
        m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
        m.environmentIntensity = 0.3;
        m.maxSimultaneousLights = 8;
        new Bloodied(m);
        return m;
    }

    // The organs near any opening, as a mesh of their own, each part in its own look, carried by the bones the
    // anatomy hangs them from (as the x-ray is).
    _organs() {
        const npc = this.npc, data = npc.insides.data, { position, normal, index } = data;
        const scene: BABYLON.Scene = npc.world.scene;
        // Whole clusters (about fifty triangles each) near an opening, part by part, by the look each is drawn in.
        const groups = new Map<string, { tris: Int32Array; owner: number }[]>();
        let tris = 0;
        for (const part of npc.insides.parts) {
            const kind = part.kind === 'bone' || part.kind === 'cartilage' ? (SHOWN_BONES.test(part.name) ? part.kind : null) : SHOWN.test(part.kind) ? part.kind : null;
            if (!kind) continue;
            for (const c of part.clusters) {
                if (!this.openings.some((o) => boxDistance(c.lo, c.hi, o.at) < REACH)) continue;
                (groups.get(kind) ?? groups.set(kind, []).get(kind)).push({ tris: c.tris, owner: part.owner.index });
                tris += c.tris.length;
            }
        }
        this.mesh?.dispose();
        this.mesh = null;
        if (!tris) return;
        // The corners they use, each once, carried by its part's bone.
        const remap = this._remap ?? (this._remap = new Int32Array(position.length / 3));
        remap.fill(-1);
        const P: number[] = [], N: number[] = [], J: number[] = [], G: number[] = [], I = new Uint32Array(tris * 3), subs: [string, number, number][] = [];
        let k = 0;
        for (const [kind, list] of groups) {
            const start = k;
            for (const { tris: t, owner } of list) for (const i of t) for (let j = 0; j < 3; j++) {
                const v = index[i + j];
                if (remap[v] < 0) {
                    remap[v] = P.length / 3;
                    P.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
                    N.push(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
                    J.push(owner, 0, 0, 0);
                    G.push(this._bloodAt(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]));
                }
                I[k++] = remap[v];
            }
            subs.push([kind, start, k - start]);
        }
        const mesh = new BABYLON.Mesh(`${npc.person.mesh.name}_viscera`, scene);
        const vd = new BABYLON.VertexData();
        const W = new Float32Array(J.length);
        for (let i = 0; i < W.length; i += 4) W[i] = 1;
        Object.assign(vd, { positions: new Float32Array(P), normals: new Float32Array(N), indices: I, matricesIndices: new Float32Array(J), matricesWeights: W });
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData(BLOOD, new Float32Array(G), false, 1);
        const { person } = npc;
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
        mesh.skeleton = person.skeleton;
        mesh.numBoneInfluencers = 1;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        // (The skin would shadow everything inside it: light comes in through the opening, which the shadow maps, drawn
        // from the whole skin, do not know of.)
        mesh.receiveShadows = false;
        const multi = new BABYLON.MultiMaterial(mesh.name + 'M', scene);
        multi.subMaterials = subs.map(([kind]) => this._material(kind));
        mesh.material = multi;
        mesh.subMeshes = [];
        const vertices = P.length / 3;
        subs.forEach(([, start, n], m) => new BABYLON.SubMesh(m, 0, vertices, start, n, mesh));
        this.mesh = mesh;
    }
    declare _remap: Int32Array;

    // Millimetres of blood lying on the organs at rest point (x, y, z): round each opening, where the wall's vessels
    // bleed into the belly and the blood wells up through it, and round each place a missile or a blade went through an
    // organ; in patches, thinning out from the middle.
    _bloodAt(x: number, y: number, z: number) {
        let mm = 0;
        for (const o of this.openings) {
            const d = Math.hypot(x - o.at.x, y - o.at.y, z - o.at.z), r = o.half[0] + 0.06;
            if (d < r) mm = Math.max(mm, 0.04 * (1 - d / r));
        }
        for (const s of this.spots) {
            const d = Math.hypot(x - s.at.x, y - s.at.y, z - s.at.z);
            if (d < s.r) mm = Math.max(mm, 0.25 * (1 - (d / s.r) ** 2));
        }
        if (!mm) return 0;
        const patch = 0.5 + 0.5 * Math.sin(x * 160 + Math.sin(y * 110) * 2) * Math.sin(z * 140 + y * 90);
        return mm * (0.3 + 0.7 * patch);
    }

    // (One for each kind for everybody: made the first time anyone's insides are seen.)
    _material(kind: string) {
        const scene: BABYLON.Scene = this.npc.world.scene, look = LOOK[kind] ?? LOOK.muscle;
        const old = scene.getMaterialByName(`organ_${kind}`);
        if (old) return old;
        const m = new BABYLON.PBRMaterial(`organ_${kind}`, scene);
        m.albedoColor = BABYLON.Color3.FromInts(look.c[0], look.c[1], look.c[2]).toLinearSpace();
        m.metallic = 0;
        // Wet, but its sheen from the surface itself, broken by the unevenness Wet bends its normal with. (A clear coat
        // here takes the bare normal of the anatomy's broad flat facets: each a mirror of the room, a glass dome seen down
        // a hole into the belly.)
        m.roughness = look.rough;
        m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
        m.environmentIntensity = 0.3;
        m.maxSimultaneousLights = 8;
        new Wet(m, look);
        new Bloodied(m);
        return m;
    }

    // The outside of a kind that can come out, painted round and along it (u along it, v round it, v = 0 and 1 the side
    // its mesentery holds, which Loop.draw turns toward where it is held), and how high each place of it stands (a
    // normal map). What they look like (Moore, Dalley & Agur, Clinically Oriented Anatomy, 7th ed., ch. 2, the small and
    // large intestine compared; Gray's Anatomy, 41st ed., chs. 65 and 66):
    // - small bowel: pinkish grey to tan, its serosa thin and glistening; straight vessels (vasa recta) from the arcades
    //   in its mesentery run round it every few millimetres; the mesentery meets it along one side as yellow fat with
    //   the arcades in it.
    // - colon: greyer tan, gathered into sacculations (haustra) by three flat bands of muscle about a centimetre wide
    //   (taeniae coli), small tags of fat (omental appendices) hanging from them.
    // - stomach: pinkish tan, the gastroepiploic arcade in the omentum's fat along its curvature, its branches running
    //   across the wall.
    _tubeLook(kind: string) {
        const scene: BABYLON.Scene = this.npc.world.scene, W = 512, H = 256;
        const had = scene.getTextureByName(`${kind}_wall`);
        if (had) return { albedo: had, relief: scene.getTextureByName(`${kind}_relief`) as BABYLON.Texture };
        const sheet = (name: string) => {
            const s = new BABYLON.DynamicTexture(name, { width: W, height: H }, scene, true);
            s.wrapU = s.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
            return s;
        };
        const albedo = sheet(`${kind}_wall`), relief = sheet(`${kind}_relief`);
        const g = albedo.getContext() as CanvasRenderingContext2D;
        // Height, drawn alongside the colour: light is high.
        const hc = document.createElement('canvas');
        hc.width = W; hc.height = H;
        const h = hc.getContext('2d');
        h.fillStyle = 'rgb(128,128,128)';
        h.fillRect(0, 0, W, H);
        const rnd = Math.random;
        // Each thing drawn where it is and again a picture's width or height over, so the pictures tile.
        const tiled = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
            for (const dx of [0, -W, W]) for (const dy of [0, -H, H]) if (x + dx > -r && x + dx < W + r && y + dy > -r && y + dy < H + r) draw(x + dx, y + dy);
        };
        const blob = (x: number, y: number, rx: number, ry: number, colour: string, lift = 0) => tiled(x, y, Math.max(rx, ry), (px, py) => {
            const turn = rnd() * 3;
            g.fillStyle = colour;
            g.beginPath(); g.ellipse(px, py, rx, ry, turn, 0, Math.PI * 2); g.fill();
            if (!lift) return;
            h.fillStyle = lift > 0 ? `rgba(255,255,255,${lift})` : `rgba(0,0,0,${-lift})`;
            h.beginPath(); h.ellipse(px, py, rx, ry, turn, 0, Math.PI * 2); h.fill();
        });
        const base = { bowel: [192, 154, 142], colon: [176, 160, 140], stomach: [196, 152, 138] }[kind];
        g.fillStyle = `rgb(${base})`;
        g.fillRect(0, 0, W, H);
        // Mottled: greyer, pinker and tanner patches.
        for (let k = 0; k < 1800; k++) {
            const r = rnd(), c = r < 0.4 ? '170,152,146' : r < 0.75 ? '206,150,140' : '200,172,134';
            blob(rnd() * W, rnd() * H, 3 + rnd() * 12, 2 + rnd() * 7, `rgba(${c},${0.1 + rnd() * 0.12})`, (rnd() - 0.5) * 0.08);
        }
        // The serosa is not smooth: fine lumps, a millimetre or two, that break the light into small highlights.
        for (let k = 0; k < 3000; k++) {
            const x = rnd() * W, y = rnd() * H, r = 1.5 + rnd() * 3, lift = (rnd() - 0.4) * 0.35;
            tiled(x, y, r, (px, py) => { h.fillStyle = lift > 0 ? `rgba(255,255,255,${lift})` : `rgba(0,0,0,${-lift})`; h.beginPath(); h.arc(px, py, r, 0, Math.PI * 2); h.fill(); });
        }
        // Vessels: a wavering line from (x, y), `dir` down (1) or up (-1) the picture, tapering, a branch now and then.
        // They lie under the serosa, a thin translucent layer: seen through it, soft-edged and low in contrast.
        g.lineCap = h.lineCap = 'round';
        const vessel = (x: number, y: number, dir: number, len: number, width: number, colour: string, lift: number, across = false) => {
            let px = x, py = y, bend = (rnd() - 0.5) * 0.5;
            for (let s = 0; s < len; s += 3) {
                const nx = across ? px + 3 * dir : px + Math.sin(bend) * 3 * dir + (rnd() - 0.5) * 1.2;
                const ny = across ? py + Math.sin(bend) * 3 + (rnd() - 0.5) * 1.2 : py + Math.cos(bend) * 3 * dir;
                const w = Math.max(0.5, width * (1 - (s / len) * 0.7));
                tiled(px, py, 6, (ax, ay) => {
                    g.filter = 'blur(1.2px)'; g.strokeStyle = colour; g.lineWidth = w;
                    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + nx - px, ay + ny - py); g.stroke();
                    g.filter = 'none';
                    h.strokeStyle = `rgba(255,255,255,${lift})`; h.lineWidth = w;
                    h.beginPath(); h.moveTo(ax, ay); h.lineTo(ax + nx - px, ay + ny - py); h.stroke();
                });
                px = nx; py = ny; bend += (rnd() - 0.5) * 0.3;
                if (rnd() < 0.05 && width > 0.9) vessel(px, py, dir, (len - s) * 0.5, width * 0.6, colour, lift, across);
            }
        };
        // Arteries a dull red, veins beside them blue-purple, both faint through the serosa.
        const red = () => `rgba(${128 + rnd() * 25},${46 + rnd() * 14},${58 + rnd() * 14},${0.1 + rnd() * 0.1})`;
        const vein = () => `rgba(${92 + rnd() * 16},${70 + rnd() * 14},${112 + rnd() * 18},${0.12 + rnd() * 0.1})`;
        // Where the mesentery (the omentum, the mesocolon) holds it: yellow lobulated fat, the arcade running along it.
        const held = (fat: number, lobules: number) => {
            for (let k = 0; k < lobules; k++) {
                const y = (rnd() < 0.5 ? rnd() : -rnd()) * fat * H;
                blob(rnd() * W, y < 0 ? H + y : y, 4 + rnd() * 8, 3 + rnd() * 6, `rgba(${222 + rnd() * 16},${186 + rnd() * 20},${96 + rnd() * 30},${0.55 + rnd() * 0.35})`, 0.35);
            }
            for (const y0 of [fat * H * 0.45, H - fat * H * 0.45]) vessel(0, y0, 1, W + 20, 2, 'rgba(116,44,58,0.32)', 0.25, true);
        };
        if (kind === 'bowel') {
            held(0.07, 420);
            for (let x = 0; x < W; x += 9 + rnd() * 12) {
                vessel(x, H * 0.05, 1, H * (0.15 + rnd() * 0.25), 0.7 + rnd() * 0.6, rnd() < 0.6 ? red() : vein(), 0.15);
                vessel(x + rnd() * 5, H * 0.95, -1, H * (0.15 + rnd() * 0.25), 0.7 + rnd() * 0.6, rnd() < 0.6 ? red() : vein(), 0.15);
            }
        } else if (kind === 'colon') {
            // Haustra: six to a picture's length, a crease between each and the next, bulging between.
            const N = 6;
            for (let k = 0; k < N; k++) {
                const x = (k / N) * W + (rnd() - 0.5) * 8;
                for (let y = 0; y < H; y += 4) blob(x + Math.sin(y * 0.05 + k) * 4, y, 3 + rnd() * 2, 4, 'rgba(120,98,88,0.3)', -0.45);
                for (let y = 0; y < H; y += 6) blob(x + W / N / 2, y, W / N / 3, 5, 'rgba(190,170,150,0.05)', 0.12);
            }
            held(0.06, 160);
            // The taeniae: flat bands, paler, their fibres running along, at a third of the way round from each other.
            for (const yc of [H / 3, (2 * H) / 3]) {
                for (let x = 0; x < W; x += 2) blob(x, yc + (rnd() - 0.5) * 10, 3 + rnd() * 4, 1.5, `rgba(${200 + rnd() * 16},${186 + rnd() * 14},${160 + rnd() * 14},0.5)`, 0.05);
                // Omental appendices: little tags of yellow fat along them.
                for (let x = rnd() * 40; x < W; x += 35 + rnd() * 40) blob(x, yc + (rnd() - 0.5) * 24, 6 + rnd() * 6, 4 + rnd() * 5, `rgba(${226 + rnd() * 14},${192 + rnd() * 16},${98 + rnd() * 24},0.85)`, 0.6);
            }
            for (let x = 0; x < W; x += 9 + rnd() * 10) {
                vessel(x, H * 0.04, 1, H * (0.1 + rnd() * 0.2), 0.7 + rnd() * 0.5, rnd() < 0.6 ? red() : vein(), 0.15);
                vessel(x, H * 0.96, -1, H * (0.1 + rnd() * 0.2), 0.7 + rnd() * 0.5, rnd() < 0.6 ? red() : vein(), 0.15);
            }
        } else {
            held(0.12, 600);
            for (let x = 0; x < W; x += 12 + rnd() * 16) {
                vessel(x, H * 0.08, 1, H * (0.2 + rnd() * 0.25), 1 + rnd() * 0.6, rnd() < 0.6 ? red() : vein(), 0.15);
                vessel(x, H * 0.92, -1, H * (0.2 + rnd() * 0.25), 1 + rnd() * 0.6, rnd() < 0.6 ? red() : vein(), 0.15);
            }
        }
        albedo.update(true);
        // The relief: from the height, which way each place faces (a tangent-space normal map).
        h.filter = 'blur(1px)';
        h.drawImage(hc, 0, 0);
        const hd = h.getImageData(0, 0, W, H).data, rg = relief.getContext() as CanvasRenderingContext2D;
        const out = rg.createImageData(W, H), od = out.data, at = (x: number, y: number) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * 2.5, dy = (at(x, y + 1) - at(x, y - 1)) * 2.5, l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
            od[i] = (0.5 - dx / l / 2) * 255; od[i + 1] = (0.5 + dy / l / 2) * 255; od[i + 2] = (0.5 + 0.5 / l) * 255; od[i + 3] = 255;
        }
        rg.putImageData(out, 0, 0);
        relief.update(true);
        return { albedo, relief };
    }

    // --- every frame ------------------------------------------------------------------------

    update(dt: number) {
        if (this._stale && this.openings.length) { this._organs(); for (const l of this.loops) l.bloodied(); }
        this._stale = false;
        if (!this.loops.length) return;
        const npc = this.npc, rd = npc.ragdoll, v = npc.vitals;
        // The body as capsules, for what is out to lie on; the belly and pelvis also as the cavity it is in.
        const bodies = [], cavity = [];
        for (const seg of rd.segments) {
            if (seg.severed) continue;
            const [a, b] = rd.segmentEnds(seg);
            bodies.push({ a, b, r: seg.radius / 0.82 + CLOTHES, seg });
            if (seg.name === 'belly' || seg.name === 'pelvis') cavity.push({ a, b, r: seg.radius / 0.82 });
        }
        // The pressure in the belly over the outside's, in pascals: the wall's tone (more in a man awake, in pain, guarding
        // or straining; none once dead), and the weight of the contents above each opening (Cobb et al.: about 2 mmHg
        // lying, 20 standing).
        const tone = v.dead ? 0 : (2 + 10 * v.conscious * Math.min(1, 0.3 + v.pain)) * MMHG;
        let top = -Infinity;
        for (const c of cavity) top = Math.max(top, c.a.y + c.r - WALL, c.b.y + c.r - WALL);
        let low = null;
        for (const loop of this.loops) loop.step(dt, bodies, cavity, tone, top);
        this._apart();
        for (const loop of this.loops) {
            loop.draw();
            const l = loop.lowest();
            if (l && (!low || l.y < low.y)) low = l;
            if (loop.came && !this._told.has(loop.kind)) {
                this._told.add(loop.kind);
                v.injure(loop.kind === 'bowel' ? 'Small bowel out through the wound' : loop.kind === 'colon' ? 'Colon out through the wound' : 'Stomach out through the wound', 9);
            }
        }
        // Blood off the lowest of what is out, a drop at a time.
        if (low && v.beating && (this._drip -= dt) < 0) {
            this._drip = 0.4 + Math.random() * 0.8;
            npc.world.blood.drip(low.add(new V3(0, -0.014, 0)), 0.05);
        }
    }

    // Loops lie on each other, not through each other: any two points closer than their widths are pushed apart.
    _apart() {
        const all = this.loops;
        for (let a = 0; a < all.length; a++) for (let b = a; b < all.length; b++) {
            const P = all[a].p, Q = all[b].p, n = all[a].count, m = all[b].count, w = (all[a].r + all[b].r) * 0.95;
            for (let i = 3; i < n - 3; i++) for (let j = a === b ? i + 3 : 3; j < m - 3; j++) {
                const dx = Q[j * 3] - P[i * 3], dy = Q[j * 3 + 1] - P[i * 3 + 1], dz = Q[j * 3 + 2] - P[i * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= w * w || d2 < 1e-12) continue;
                const d = Math.sqrt(d2), push = ((w - d) / d) * 0.5;
                P[i * 3] -= dx * push; P[i * 3 + 1] -= dy * push; P[i * 3 + 2] -= dz * push;
                Q[j * 3] += dx * push; Q[j * 3 + 1] += dy * push; Q[j * 3 + 2] += dz * push;
            }
        }
    }

    dispose() {
        this.mesh?.dispose();
        for (const l of this.loops) l.dispose();
    }
}

// --- a rope of an organ that can come out (a loop of bowel, the colon, the stomach) --------------------------------

class Loop {
    declare v: Viscera;
    declare o: Opening;
    declare kind: string;
    declare r: number;
    declare tether: number;
    declare ends: BABYLON.Vector3[];
    declare count: number;
    declare rest: number;
    declare p: Float32Array;
    declare q: Float32Array;
    declare out: Uint8Array;
    declare passing: Uint8Array;
    declare gore: Float32Array;
    declare came: boolean;
    declare hold: { index: number; to: BABYLON.Vector3 } | null;
    declare reach: Float32Array;
    declare mesh: BABYLON.Mesh;
    declare _pos: Float32Array;
    declare _nor: Float32Array;
    declare _blood: Float32Array;
    declare _bloody: boolean;

    // A rope of organ `kind` behind opening `o`, its ends held at rest points `a` and `b` (inside the belly).
    constructor(v: Viscera, o: Opening, kind: string, a: BABYLON.Vector3, b: BABYLON.Vector3) {
        const spec = ROPES[kind];
        this.v = v;
        this.o = o;
        this.kind = kind;
        this.r = spec.r;
        this.tether = spec.tether;
        this.ends = [a, b];
        this.rest = Math.max(0.015, spec.r);
        const n = (this.count = Math.round(spec.length / this.rest) + 1);
        this.p = new Float32Array(n * 3);
        this.q = new Float32Array(n * 3);
        this.out = new Uint8Array(n);
        this.passing = new Uint8Array(n);
        // Millimetres of blood on it, at each point: none until it comes through the wound.
        this.gore = new Float32Array(n);
        this.came = false;
        this.hold = null;
        // (How far each point's attachments let it go, a little more or less here and there.)
        this.reach = Float32Array.from({ length: n }, (_, i) => 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(i * 0.9 + Math.random() * 6)) * Math.random());
        // It starts where it lies: from one end to the other in folds behind the wall, none of it through.
        const npc = v.npc, ey = V3.Cross(o.normal, o.ex), wall = -(WALL + spec.r * 1.5);
        const lift = wall - V3.Dot(a.add(b).scale(0.5).subtract(o.at), o.normal);
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1), s = Math.sin(t * Math.PI);
            const p = npc.worldOf(V3.Lerp(a, b, t).add(o.normal.scale(lift * s)).add(ey.scale(Math.sin(t * Math.PI * 4) * 0.035 * s)), o.owner).at;
            this.p.set([p.x, p.y, p.z], i * 3);
            this.q.set([p.x, p.y, p.z], i * 3);
        }
        this._build();
        this.bloodied();
    }

    // Blood on it where it lies in the belly as on the organs round it (Viscera._bloodAt): round the opening, and where
    // what made it went through it or past it. (Without it what lay behind a shotgun's hole was the one clean, pale thing
    // in a bloody cavity.)
    bloodied() {
        const toRest = this.v.npc.restToWorld(this.o.owner).clone().invert(), at = new V3();
        for (let i = 0; i < this.count; i++) {
            V3.TransformCoordinatesFromFloatsToRef(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2], toRest, at);
            this.gore[i] = Math.max(this.gore[i], this.v._bloodAt(at.x, at.y, at.z));
        }
        this._bloody = true;
    }

    at(i: number) { return new V3(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]); }

    // The two ends where they are now, held inside.
    _ends() {
        const npc = this.v.npc;
        return this.ends.map((e) => npc.worldOf(e, this.o.owner).at);
    }

    // The lowest point of it that is out, or null.
    lowest() {
        let best = -1;
        for (let i = 1; i < this.count - 1; i++) if (this.out[i] && (best < 0 || this.p[i * 3 + 1] < this.p[best * 3 + 1])) best = i;
        return best < 0 ? null : this.at(best);
    }

    // `tone` pascals of pressure in the belly from its wall; `top` the height (world y) of the top of the cavity.
    step(dt: number, bodies, cavity, tone: number, top: number) {
        const npc = this.v.npc, p = this.p, q = this.q, n = this.count, R = this.r, o = this.o;
        // The opening as it is now: its middle, the way the skin faces, the way it runs and across it.
        const face = npc.worldOf(o.at, o.owner, o.normal), F = face.at, N = face.normal;
        const E = npc.worldOf(o.at.add(o.ex), o.owner).at.subtract(F);
        E.subtractInPlace(N.scale(V3.Dot(E, N))).normalize();
        const Y = V3.Cross(N, E);
        // A loop squeezes a little: through anything wider than seven tenths of itself.
        const squeeze = R * 0.7;
        // The pressure pushing it out where it presses on the opening: the tone and the weight of what lies above, and
        // as acceleration of the bit of it in the opening (its area across over its mass, and the mass of the packed
        // contents it has to move aside to get there, some ten times its own).
        const pressure = tone + DENSITY * 9.81 * Math.max(0, Math.min(0.3, top - F.y));
        const push = (2 * pressure) / (Math.PI * R * DENSITY) / PACKED;
        // The belly fuller than the capsules it is drawn round: the cavity reaches the wall at the opening.
        let fuller = Infinity;
        for (const c of cavity) fuller = Math.min(fuller, distToSegment(F.x, F.y, F.z, c) - c.r);
        fuller = Math.max(0, Math.min(0.05, fuller));
        bodies = bodies.filter((c) => segmentNear(c, F, this.tether + 0.25 + c.r));
        const h = Math.min(dt, 1 / 30), g = -9.81 * h * h;
        // Inside it is packed among the rest, which hold it up and slow it (no weight of its own there: the belly's
        // contents bear it as a fluid would); out, it falls and swings, a little slowed by the air and its own give.
        const keepIn = Math.exp(-60 * h), keepOut = Math.exp(-0.9 * h), keepPassing = Math.exp(-40 * h);
        // (What lies over the opening, inside, has the belly's pressure behind it and none in front: it is pressed into
        // the opening, and through it if it fits.)
        const over = o.half[0] + R * 2;
        for (let i = 1; i < n - 1; i++) {
            const k = i * 3;
            const keep = this.out[i] ? keepOut : this.passing[i] ? keepPassing : keepIn;
            let along = 0;
            if (this.passing[i]) along = push * h * h;
            else if (!this.out[i]) {
                const dx = p[k] - F.x, dy = p[k + 1] - F.y, dz = p[k + 2] - F.z, hn = dx * N.x + dy * N.y + dz * N.z;
                const lx = dx - N.x * hn, ly = dy - N.y * hn, lz = dz - N.z * hn;
                if (lx * lx + ly * ly + lz * lz < over * over) along = push * h * h;
            }
            for (let j = 0; j < 3; j++) {
                const now = p[k + j], vel = (now - q[k + j]) * keep;
                q[k + j] = now;
                p[k + j] = now + vel + (this.out[i] && j === 1 ? g : 0) + along * (j === 0 ? N.x : j === 1 ? N.y : N.z);
            }
        }
        // A hand pulling on it draws more after it, out of the belly: what holds it gives, as far as there is more of it
        // behind (the small bowel is metres long; its mesentery folds out as it is pulled).
        if (this.hold) {
            const k = this.hold.index * 3, to = this.hold.to;
            if (Math.hypot(p[k] - to.x, p[k + 1] - to.y, p[k + 2] - to.z) > 0.03) {
                const spec = ROPES[this.kind], base = Math.max(0.015, spec.r);
                this.tether = Math.min(spec.tether * 3, this.tether + h * 0.3);
                // (The rope stands for the part free behind the opening: more of it, its points further apart.)
                this.rest = Math.min(base * 2.5, this.rest + h * base * 0.8);
            }
        }
        const [a, b] = this._ends();
        p.set([a.x, a.y, a.z], 0);
        p.set([b.x, b.y, b.z], (n - 1) * 3);
        const rest = this.rest;
        for (let iter = 0; iter < 6; iter++) {
            for (let i = 0; i + 1 < n; i++) {
                const k = i * 3, l = k + 3;
                const dx = p[l] - p[k], dy = p[l + 1] - p[k + 1], dz = p[l + 2] - p[k + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                const diff = (d - rest) / d * 0.5, fa = i === 0 ? 0 : 1, fb = i + 1 === n - 1 ? 0 : 1, sum = fa + fb || 1;
                p[k] += dx * diff * 2 * fa / sum; p[k + 1] += dy * diff * 2 * fa / sum; p[k + 2] += dz * diff * 2 * fa / sum;
                p[l] -= dx * diff * 2 * fb / sum; p[l + 1] -= dy * diff * 2 * fb / sum; p[l + 2] -= dz * diff * 2 * fb / sum;
            }
            // It does not fold flat on itself: points two apart are kept most of its width apart (it bends, it is not
            // stiff: nothing else holds it straight).
            for (let i = 0; i + 2 < n; i++) {
                const k = i * 3, l = k + 6, dx = p[l] - p[k], dy = p[l + 1] - p[k + 1], dz = p[l + 2] - p[k + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                if (d >= R * 1.6) continue;
                const s = (R * 1.6 - d) / d * 0.25;
                if (i > 0) { p[k] -= dx * s; p[k + 1] -= dy * s; p[k + 2] -= dz * s; }
                if (i + 2 < n - 1) { p[l] += dx * s; p[l + 1] += dy * s; p[l + 2] += dz * s; }
            }
            if (this.hold) {
                const k = this.hold.index * 3, to = this.hold.to;
                p[k] += (to.x - p[k]) * 0.5; p[k + 1] += (to.y - p[k + 1]) * 0.5; p[k + 2] += (to.z - p[k + 2]) * 0.5;
            }
            // Held by its attachments: no point gets further from where they hold it than they reach (most at its
            // middle), so a long loop hangs in folds, not as a cord.
            const rx = (p[0] + p[(n - 1) * 3]) / 2, ry = (p[1] + p[(n - 1) * 3 + 1]) / 2, rz = (p[2] + p[(n - 1) * 3 + 2]) / 2;
            for (let i = 1; i < n - 1; i++) {
                const k = i * 3, most = (0.06 + this.tether * Math.sin((i / (n - 1)) * Math.PI)) * this.reach[i];
                const dx = p[k] - rx, dy = p[k + 1] - ry, dz = p[k + 2] - rz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > most) { const s = most / d; p[k] = rx + dx * s; p[k + 1] = ry + dy * s; p[k + 2] = rz + dz * s; }
            }
            // The wall: it is in the belly or out of it, and goes from one to the other only through the opening.
            for (let i = 1; i < n - 1; i++) {
                const k = i * 3, dx = p[k] - F.x, dy = p[k + 1] - F.y, dz = p[k + 2] - F.z;
                const hn = dx * N.x + dy * N.y + dz * N.z, x = dx * E.x + dy * E.y + dz * E.z, y = dx * Y.x + dy * Y.y + dz * Y.z;
                const through = Math.abs(y) < gape(o.half, x) - squeeze;
                const held = this.hold?.index === i;
                this.passing[i] = through && hn > -(WALL + R * 3) && hn < R * 2 ? 1 : 0;
                if (!this.out[i]) {
                    if (through && hn > R * 0.5) { this.out[i] = 1; this.gore[i] = Math.max(this.gore[i], 0.004 + Math.random() * 0.025); this._bloody = true; continue; }
                    // Behind the wall where it is whole (the plane of the skin there, far enough round the opening).
                    if (!through && !held && hn > -(WALL + R) && Math.abs(x) < o.half[0] + 0.15 && Math.abs(y) < o.half[0] + 0.15) {
                        const s = hn + WALL + R; p[k] -= N.x * s; p[k + 1] -= N.y * s; p[k + 2] -= N.z * s;
                    }
                    // And in the cavity, not through the back or the sides.
                    if (!this.passing[i]) {
                        let best = null, over = Infinity;
                        for (const c of cavity) {
                            const e = distToSegment(p[k], p[k + 1], p[k + 2], c) - (c.r + fuller - WALL - R);
                            if (e < over) { over = e; best = c; }
                        }
                        if (best && over > 0) {
                            const near = nearestOnSegment(p[k], p[k + 1], p[k + 2], best), d = over + best.r + fuller - WALL - R, s = (d - over) / d;
                            p[k] = near[0] + (p[k] - near[0]) * s; p[k + 1] = near[1] + (p[k + 1] - near[1]) * s; p[k + 2] = near[2] + (p[k + 2] - near[2]) * s;
                        }
                    }
                } else {
                    if (through && hn < -(WALL + R)) { this.out[i] = 0; continue; }
                    // Lying on the skin round the opening, or on the clothes further off.
                    // (In the hole torn in the clothes over the opening it lies on the skin; further off, on the clothes, which it
                    // lifts and pushes aside near the hole.)
                    const lie = R + CLOTHES * Math.min(1, Math.max(0, Math.abs(y) - gape(o.half, x), Math.abs(x) - o.half[0]) / 0.1);
                    if (!through && !held && hn < lie && Math.abs(x) < o.half[0] + 0.15 && Math.abs(y) < o.half[0] + 0.15) {
                        const s = lie - hn; p[k] += N.x * s; p[k + 1] += N.y * s; p[k + 2] += N.z * s;
                    }
                }
            }
            // The floor, and the rest of the body, which what is out lies on and slides off.
            for (let i = 1; i < n - 1; i++) {
                const k = i * 3;
                if (!this.out[i]) continue;
                if (p[k + 1] < R) { p[k + 1] = R; q[k] = p[k] - (p[k] - q[k]) * 0.6; q[k + 2] = p[k + 2] - (p[k + 2] - q[k + 2]) * 0.6; }
                if (this.passing[i]) continue;
                for (const c of bodies) {
                    const r = c.r + R * 0.8;
                    const near = nearestOnSegment(p[k], p[k + 1], p[k + 2], c);
                    const dx = p[k] - near[0], dy = p[k + 1] - near[1], dz = p[k + 2] - near[2], d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 >= r * r || d2 < 1e-12) continue;
                    const d = Math.sqrt(d2), s = (r - d) / d;
                    p[k] += dx * s; p[k + 1] += dy * s; p[k + 2] += dz * s;
                }
            }
        }
        // Out for good once a part of it is clear of the wall.
        if (!this.came) for (let i = 1; i < n - 1; i++) {
            const k = i * 3;
            if (this.out[i] && (p[k] - F.x) * N.x + (p[k + 1] - F.y) * N.y + (p[k + 2] - F.z) * N.z > R * 2.5) { this.came = true; break; }
        }
    }

    // --- drawing ----------------------------------------------------------------------------

    _build() {
        const scene = this.v.npc.world.scene, rings = (this.count - 1) * SPLIT + 1;
        const pos = new Float32Array(rings * SIDES * 3), uv = new Float32Array(rings * SIDES * 2), index: number[] = [];
        // (The picture's length runs 0.12 to a step of a small bowel's points: the same size on a wider one.)
        const along = 0.12 * (this.rest / 0.015) * (0.014 / this.r);
        for (let i = 0; i < rings; i++) for (let s = 0; s < SIDES; s++) {
            uv[(i * SIDES + s) * 2] = (i / SPLIT) * along;
            uv[(i * SIDES + s) * 2 + 1] = s / (SIDES - 1);
            if (i + 1 < rings && s + 1 < SIDES) {
                const a = i * SIDES + s, b = a + 1, c = a + SIDES, d = c + 1;
                index.push(a, c, b, b, c, d);
            }
        }
        const mesh = new BABYLON.Mesh(`${this.kind}_loop`, scene);
        const vd = new BABYLON.VertexData();
        Object.assign(vd, { positions: pos, indices: index, uvs: uv, normals: new Float32Array(pos.length) });
        vd.applyToMesh(mesh, true);
        this._blood = new Float32Array(rings * SIDES);
        mesh.setVerticesData(BLOOD, this._blood, true, 1);
        this._bloody = true;
        mesh.material = this.v._tube(this.kind);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.receiveShadows = true;
        this.v.npc.world.shadows?.addShadowCaster(mesh);
        this.mesh = mesh;
        this._pos = pos;
        this._nor = new Float32Array(pos.length);
        this._line = new Float32Array(rings * 3);
        this._index = index;
        this._along = along;
    }
    declare _line: Float32Array;
    declare _index: number[];
    declare _along: number;

    draw() {
        const n = this.count, p = this.p, pos = this._pos, nor = this._nor, line = this._line, rings = (n - 1) * SPLIT + 1, R = this.r;
        // A smooth curve through the points (Catmull and Rom), SPLIT pieces to each step.
        for (let i = 0; i + 1 < n; i++) {
            const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
            for (let k = 0; k < SPLIT; k++) {
                const t = k / SPLIT, t2 = t * t, t3 = t2 * t;
                for (let j = 0; j < 3; j++) {
                    const a = p[i0 * 3 + j], b = p[i * 3 + j], c = p[i2 * 3 + j], d = p[i3 * 3 + j];
                    line[(i * SPLIT + k) * 3 + j] = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
                }
            }
        }
        line.set(p.subarray((n - 1) * 3, n * 3), (rings - 1) * 3);
        // A frame carried along it, its first axis turned toward where its attachments hold it (the middle of its two
        // ends): the side its mesentery meets it (v = 0 of its picture) faces that way, as it does on a real loop. (Carried
        // on from the last ring where that way is along it.)
        const rx = (p[0] + p[(n - 1) * 3]) / 2, ry = (p[1] + p[(n - 1) * 3 + 1]) / 2, rz = (p[2] + p[(n - 1) * 3 + 2]) / 2;
        const step = this.rest / SPLIT, kind = this.kind;
        let ux = 0, uy = 1, uz = 0;
        for (let i = 0; i < rings; i++) {
            const a = Math.max(0, i - 1) * 3, b = Math.min(rings - 1, i + 1) * 3, x = line[i * 3], y = line[i * 3 + 1], z = line[i * 3 + 2];
            let tx = line[b] - line[a], ty = line[b + 1] - line[a + 1], tz = line[b + 2] - line[a + 2];
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
            tx /= tl; ty /= tl; tz /= tl;
            let hx = rx - x, hy = ry - y, hz = rz - z, dot = hx * tx + hy * ty + hz * tz;
            hx -= tx * dot; hy -= ty * dot; hz -= tz * dot;
            const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (hl > 0.01) { ux = hx / hl; uy = hy / hl; uz = hz / hl; }
            dot = ux * tx + uy * ty + uz * tz;
            ux -= tx * dot; uy -= ty * dot; uz -= tz * dot;
            let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
            if (ul < 1e-3) { ux = Math.abs(ty) < 0.9 ? 0 : 1; uy = Math.abs(ty) < 0.9 ? 1 : 0; uz = 0; dot = ux * tx + uy * ty; ux -= tx * dot; uy -= ty * dot; uz -= tz * dot; ul = Math.sqrt(ux * ux + uy * uy + uz * uz); }
            ux /= ul; uy /= ul; uz /= ul;
            const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
            // Where it bends, its inner side is pressed together into soft creases and its outer side drawn smooth.
            const a1 = Math.max(0, i - 2) * 3, b1 = Math.min(rings - 1, i + 2) * 3, span = ((b1 - a1) / 6) * step || 1;
            let cx = line[a1] + line[b1] - 2 * x, cy = line[a1 + 1] + line[b1 + 1] - 2 * y, cz = line[a1 + 2] + line[b1 + 2] - 2 * z;
            const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1, fold = Math.min(1, ((cl / (span * span)) * R) * 1.5);
            cx /= cl; cy /= cl; cz /= cl;
            // Wider and narrower along its length, as a bowel with its contents in it is.
            const f = i / SPLIT, u = f * this._along, r = R * (0.88 + 0.16 * Math.sin(f * 1.7 + 0.6) * Math.sin(f * 0.53 + 1.3));
            // The colon gathered into haustra between creases (six to its picture's length, where it paints them).
            const haustra = kind === 'colon' ? 0.84 + 0.16 * Math.pow(Math.sin(Math.PI * ((u * 6) % 1)), 0.6) : 1;
            for (let s2 = 0; s2 < SIDES; s2++) {
                const c = COS[s2], sn = SIN[s2], o = (i * SIDES + s2) * 3;
                const nx = ux * c + wx * sn, ny = uy * c + wy * sn, nz = uz * c + wz * sn;
                let k = haustra;
                // The mesentery's fat along the side it holds: a soft ridge (the colon's mesocolon less, the stomach's
                // omentum more), and the colon's taeniae, flat bands drawing it in a third of the way round each.
                const toward = Math.pow(Math.max(0, c), 8);
                if (kind === 'colon') k *= (1 + 0.2 * toward) * (1 - 0.06 * Math.pow(Math.max(0, Math.cos(Math.atan2(sn, c) - (2 * Math.PI) / 3)), 30) - 0.06 * Math.pow(Math.max(0, Math.cos(Math.atan2(sn, c) + (2 * Math.PI) / 3)), 30));
                else k *= 1 + (kind === 'stomach' ? 0.3 : 0.4) * toward;
                const inner = nx * cx + ny * cy + nz * cz;
                k *= 1 - 0.28 * fold * Math.max(0, inner) * (0.75 + 0.25 * Math.sin(f * 9 + s2)) + 0.04 * fold * Math.max(0, -inner);
                pos[o] = x + nx * r * k; pos[o + 1] = y + ny * r * k; pos[o + 2] = z + nz * r * k;
            }
        }
        // Normals from the shape itself (it is not round), the seam where the picture wraps made one.
        BABYLON.VertexData.ComputeNormals(pos, this._index, nor);
        for (let i = 0; i < rings; i++) {
            const a = i * SIDES * 3, b = (i * SIDES + SIDES - 1) * 3;
            for (let j = 0; j < 3; j++) nor[a + j] = nor[b + j] = (nor[a + j] + nor[b + j]) / 2;
        }
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nor);
        // Blood on it where it came through the wound, in patches, not a coat of paint.
        if (this._bloody) {
            this._bloody = false;
            const b = this._blood;
            for (let i = 0; i < rings; i++) {
                const t = i / SPLIT, k = Math.min(n - 2, Math.floor(t)), g = this.gore[k] + (this.gore[k + 1] - this.gore[k]) * (t - k);
                for (let s2 = 0; s2 < SIDES; s2++) b[i * SIDES + s2] = g * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2.3 + s2 * 0.9) * Math.sin(t * 0.7 + s2 * 0.4 + 1)));
            }
            this.mesh.updateVerticesData(BLOOD, b);
        }
    }

    dispose() {
        this.mesh.dispose();
    }
}

const COS = Float32Array.from({ length: SIDES }, (_, s) => Math.cos((s / (SIDES - 1)) * Math.PI * 2));
const SIN = Float32Array.from({ length: SIDES }, (_, s) => Math.sin((s / (SIDES - 1)) * Math.PI * 2));

// The nearest point to (x, y, z) on the segment from capsule `c`'s end a to its end b.
function nearestOnSegment(x: number, y: number, z: number, c) {
    const ux = c.b.x - c.a.x, uy = c.b.y - c.a.y, uz = c.b.z - c.a.z, uu = ux * ux + uy * uy + uz * uz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - c.a.x) * ux + (y - c.a.y) * uy + (z - c.a.z) * uz) / uu));
    return [c.a.x + ux * t, c.a.y + uy * t, c.a.z + uz * t];
}

function distToSegment(x: number, y: number, z: number, c) {
    const [nx, ny, nz] = nearestOnSegment(x, y, z, c);
    return Math.hypot(x - nx, y - ny, z - nz);
}

// Half the width of an opening `half` metres ([half its length, half its width at most]) at `x` metres along it from its
// middle. A cut through skin gapes as the skin either side is pulled apart by its tension, most at the middle and
// closing to its ends (dev/research/tissue-mechanics.md, wounds.md: a cut across Langer's lines gapes into an
// ellipse); a hole as wide as it is long is round. hider.ts draws the same shape.
function gape(half: number[], x: number) {
    const along = Math.min(1, Math.abs(x) / half[0]), lens = 0.5 + 0.5 * Math.min(1, Math.max(0, (half[0] / half[1] - 1) * 0.5));
    return half[1] * Math.pow(Math.max(0, 1 - along * along), lens);
}

// Whether the capsule `c` (ends a, b) comes within `r` of point `p`.
function segmentNear(c, p: BABYLON.Vector3, r: number) {
    return distToSegment(p.x, p.y, p.z, c) < r;
}

function tangent(n: BABYLON.Vector3) {
    const hint = Math.abs(n.y) < 0.9 ? V3.Up() : V3.Forward();
    return hint.subtract(n.scale(V3.Dot(hint, n))).normalize();
}

function boxDistance(lo: BABYLON.Vector3, hi: BABYLON.Vector3, p: BABYLON.Vector3) {
    const dx = Math.max(lo.x - p.x, 0, p.x - hi.x), dy = Math.max(lo.y - p.y, 0, p.y - hi.y), dz = Math.max(lo.z - p.z, 0, p.z - hi.z);
    return Math.hypot(dx, dy, dz);
}

// --- the organs' own surface -------------------------------------------------------------------
//
// Organs have no picture of their own (the anatomy is shapes): their surface is made where it is drawn, from their
// places at rest, so it stays on them as they move. Small vessels running over it, the mottling of a liver's lobules or
// a lung's, fat in the heart's grooves and on the colon, and a fine unevenness that catches the light.

const GLSL_WET_NOISE = `
float wetHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float wetNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wetHash(i), wetHash(i + vec3(1, 0, 0)), f.x), mix(wetHash(i + vec3(0, 1, 0)), wetHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(wetHash(i + vec3(0, 0, 1)), wetHash(i + vec3(1, 0, 1)), f.x), mix(wetHash(i + vec3(0, 1, 1)), wetHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

class Wet extends BABYLON.MaterialPluginBase {
    declare look: { vessels: number; mottle: number; fat: number };

    constructor(material, look) {
        super(material, 'Wet', 220, { WET: false });
        this.look = look;
        this._enable(true);
    }

    getClassName() { return 'Wet'; }

    prepareDefines(defines) { defines.WET = true; }

    getUniforms() { return { ubo: [{ name: 'wetLook', size: 3, type: 'vec3' }] }; }

    bindForSubMesh(ubo) { ubo.updateFloat3('wetLook', this.look.vessels, this.look.mottle, this.look.fat); }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return { CUSTOM_VERTEX_DEFINITIONS: '#ifdef WET\nvarying vec3 vWetRest;\n#endif\n', CUSTOM_VERTEX_MAIN_BEGIN: '#ifdef WET\nvWetRest = position;\n#endif\n' };
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef WET\nvarying vec3 vWetRest;\n${GLSL_WET_NOISE}#endif\n`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef WET
{
    vec3 p = vWetRest;
    // Each scale fades to its middle where a pixel covers more than half of one of its cells: finer than that it can
    // only flicker and glint from pixel to pixel (the sparkle seen in an opened belly). wetFade(f): f cells a metre.
    float px = max(length(dFdx(p)), length(dFdy(p)));
    #define wetFade(f) clamp(1.0 / ((f) * px) - 1.0, 0.0, 1.0)
    float broad = mix(0.5, wetNoise(p * 40.0), wetFade(40.0)), mid = mix(0.5, wetNoise(p * 160.0), wetFade(160.0)), fine = mix(0.5, wetNoise(p * 700.0), wetFade(700.0));
    // Vessels: thin lines where a stretched noise crosses its middle, branching where two scales meet. A line is a
    // twentieth of a cell wide: drawn only where that is a pixel or more.
    float r1 = 1.0 - abs(wetNoise(p * vec3(90.0, 140.0, 90.0)) * 2.0 - 1.0), r2 = 1.0 - abs(wetNoise(p * 260.0 + 3.1) * 2.0 - 1.0);
    float vessel = (smoothstep(0.93, 0.985, r1) * wetFade(140.0 * 10.0) + 0.6 * smoothstep(0.95, 0.99, r2) * wetFade(260.0 * 10.0)) * wetLook.x;
    float spots = smoothstep(0.55, 0.75, wetNoise(p * 150.0)) * wetLook.y * wetFade(150.0 * 2.0);
    float fatty = smoothstep(0.58, 0.72, wetNoise(p * 28.0 + 7.7)) * wetLook.z;
    vec3 base = surfaceAlbedo * (0.82 + 0.3 * broad) * (0.92 + 0.12 * mid);
    base *= 1.0 - 0.35 * spots;
    base = mix(base, vec3(0.62, 0.36, 0.09), fatty);
    base = mix(base, vec3(0.2, 0.012, 0.01), clamp(vessel, 0.0, 0.85));
    surfaceAlbedo = base;
    // A fine unevenness (and the vessels standing a little proud) bending the light: in metres, a few tenths of a
    // millimetre high. (Taken as metres unscaled it tipped the surface nearly flat to the eye: glinting specks.)
    float h = (mid * 0.6 + fine * 0.25 + vessel * 0.4 + fatty * 0.6) * 0.0003;
    vec3 dpx = dFdx(vPositionW), dpy = dFdy(vPositionW);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1v = cross(dpy, normalW), r2v = cross(normalW, dpx);
    float det = dot(dpx, r1v);
    vec3 grad = sign(det) * (dhx * r1v + dhy * r2v);
    normalW = normalize(abs(det) * normalW - grad);
}
#endif
`,
        };
    }
}

// --- blood lying on them ----------------------------------------------------------------------
//
// How much blood lies on each corner of what is drawn (millimetres, a vertex attribute of the mesh's own), laid over
// the organ's colour as a film of blood is (fluid.ts's Beer-Lambert colour): a thin film reddens, a thick one is dark.

const BLOOD = 'organBlood';

class Bloodied extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'Bloodied', 221, { BLOODIED: false });
        this._enable(true);
    }

    getClassName() { return 'Bloodied'; }

    prepareDefines(defines) { defines.BLOODIED = true; }

    getAttributes(attributes) { attributes.push(BLOOD); }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return { CUSTOM_VERTEX_DEFINITIONS: `#ifdef BLOODIED\nattribute float ${BLOOD};\nvarying float vOrganBlood;\n#endif\n`, CUSTOM_VERTEX_MAIN_BEGIN: `#ifdef BLOODIED\nvOrganBlood = ${BLOOD};\n#endif\n` };
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef BLOODIED\nvarying float vOrganBlood;\n${GLSL_BLOOD}#endif\n`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: '#ifdef BLOODIED\nsurfaceAlbedo = bloodOver(surfaceAlbedo, vOrganBlood, 1.0);\n#endif\n',
        };
    }
}
