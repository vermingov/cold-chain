// The belly or chest opened: what is inside seen, and what can fall out.
//
// An opening is a hole through the body's wall: the skin and the clothes
// over it are not drawn there (hider.ts), its lips show the layers the wall
// was cut through (marks.ts's rim), and through it the body's own organs
// are seen, the real ones from anatomy.ts in their places, each in a wet
// look of its own: the small bowel's pink coils with the fine vessels that
// run round them, the liver dark and glossy, the stomach, the colon, the
// lungs and the heart behind the ribs. Behind the skin, where no organ is,
// the body's wall is seen from inside (hider.ts's `opens`).
//
// A long enough opening in the belly lets the small bowel out. It is held
// in by little more than the abdominal wall; a slash longer than about ten
// centimetres through all of it, or the wall blown open, and loops of it
// slide out, both ends of each still inside, and hang, swing and lie where
// they fall: on the body, on the floor. Each loop is a rope of points
// (verlet), drawn as a tube of the bowel's own width with its mesentery
// running back into the wound. They bleed, and they can be taken hold of
// and pulled (pick, pull).

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

// Openings longer than this through the belly let the bowel out (Grabbe et al. on abdominal stab and slash wounds:
// evisceration follows wounds of the anterior wall from a few centimetres; long ones nearly always).
export const SPILLS = 0.1;
// A cut must be this deep to go through the abdominal wall (skin, fat, muscle and peritoneum: 2 to 4 cm in a lean man).
export const WALL = 0.025;
// Joules a heavy charge must leave in the belly to blow its wall open and let the bowel out; and kPa of a blast.
export const BLOWN = 600;
export const BURST = 1400;

const R = 0.014;            // m: half the small bowel's width (2.5 to 3 cm across)
const POINTS = 40;          // points to a loop
const SIDES = 12;           // round the tube drawn along it
const SPLIT = 2;            // pieces each step of a loop is drawn in, along a smooth curve through its points
const CLOTHES = 0.04;
const MESENTERY = 0.16;     // m: how far from where its mesentery is rooted a point of the bowel can get, at most (its middle)      // m the clothes stand off the body, which the bowel lies on
const REACH = 0.2;          // m round an opening within which the organs are drawn

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
// world direction `along`, `length` by `width` metres; `spill` whether the bowel comes out. Returns the opening, or
// null if `hit` is not on the trunk.
export function open(npc, hit, along: BABYLON.Vector3, length: number, width: number, spill = length >= SPILLS) {
    return (npc.viscera as Viscera).open(hit, along, length, width, spill);
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
    return open(npc, mid, along, length, Math.min(0.06, 0.01 + length * 0.28), length >= SPILLS && region(npc, mid.point) === 'belly');
}

// A heavy charge (a shotgun's at contact range) that left `spent` joules in person `npc`, in at skin crossing `hit`.
export function blown(npc, hit, spent: number) {
    if (!hit || spent < BLOWN * 0.5 || !trunk(npc, hit.point)) return null;
    const r = Math.min(0.045, 0.02 + (spent / BLOWN) * 0.012);
    return open(npc, hit, new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), r * 2, r * 2, spent >= BLOWN && region(npc, hit.point) === 'belly');
}

// A blast whose peak overpressure at person `npc`'s belly was `kPa`, from world point `from`.
export function burst(npc, from: BABYLON.Vector3, kPa: number) {
    if (kPa < BURST * 0.6) return null;
    const belly = npc.ragdoll.byName.get('belly'), at = npc.ragdoll.worldPoint(belly, belly.centre, new V3());
    const dir = at.subtract(from).normalize();
    const hit = npc.surface(at.subtract(dir.scale(0.4)), dir, 0.5).find((h) => h.kind === 'skin');
    if (!hit) return null;
    return open(npc, hit, V3.Up(), 0.12, 0.07, kPa >= BURST);
}

// The prolapsed bowel nearest the line from `origin` along unit `dir`, within `far`, on any of `npcs`: something to take
// hold of with pull(), or null.
export function pick(npcs, origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number) {
    let best = null;
    for (const npc of npcs) {
        const v = npc.viscera as Viscera;
        for (const loop of v?.loops ?? []) {
            for (let i = 2; i < loop.count - 2; i++) {
                const p = loop.at(i), t = V3.Dot(p.subtract(origin), dir);
                if (t < 0 || t > far) continue;
                const miss = V3.Distance(origin.add(dir.scale(t)), p);
                if (miss < R * 2.2 && (!best || t < best.distance)) best = { viscera: v, loop, index: i, distance: t };
            }
        }
    }
    return best;
}

// Pull what pick() found toward world point `to`: as a hand holding it would, and more of the bowel comes out after it.
export function pull(held, to: BABYLON.Vector3) {
    held.loop.hold = { index: held.index, to: to.clone() };
}

export function letGo(held) { if (held?.loop) held.loop.hold = null; }

// --- one person's insides ---------------------------------------------------------------------

function trunk(npc, point: BABYLON.Vector3) { return region(npc, point) !== null; }
function region(npc, point: BABYLON.Vector3): 'belly' | 'chest' | null {
    if (!point) return null;
    const name = npc.ragdoll.nearest(point).seg?.name;
    return name === 'belly' || name === 'pelvis' ? 'belly' : name === 'chest' ? 'chest' : null;
}

type Opening = { at: BABYLON.Vector3; normal: BABYLON.Vector3; ex: BABYLON.Vector3; owner: any; half: number[]; spill: boolean };

export class Viscera {
    declare npc: any;
    declare openings: Opening[];
    declare loops: Loop[];
    declare mesh: BABYLON.Mesh | null;
    declare tube: BABYLON.PBRMaterial;
    declare fan: BABYLON.PBRMaterial;
    declare _drip: number;

    constructor(npc) {
        this.npc = npc;
        this.openings = [];
        this.loops = [];
        this.mesh = null;
        this._drip = 0;
    }

    open(hit, along: BABYLON.Vector3, length: number, width: number, spill: boolean) {
        const npc = this.npc;
        if (!hit || hit.kind !== 'skin' || !trunk(npc, hit.point ?? npc.worldOf(hit.rest, hit.owner).at)) return null;
        hit = hit.point ? hit : { ...hit, point: npc.worldOf(hit.rest, hit.owner).at };
        // Rest space: the opening's middle, which way it runs, which way the skin faces.
        const toRest = npc.restToWorld(hit.owner).clone().invert(), n = hit.restNormal;
        let ex = V3.TransformNormal(along, toRest);
        ex = ex.subtract(n.scale(V3.Dot(ex, n)));
        ex = ex.lengthSquared() > 1e-8 ? ex.normalize() : tangent(n);
        const half = [Math.max(length / 2, width / 2), width / 2];
        const o: Opening = { at: hit.rest.clone(), normal: n.clone(), ex, owner: hit.owner, half, spill };
        // The wall: no skin there, nor the clothes over it, which are torn a little wider; the skin under the clothes shown
        // round it; seen through, the body's inside.
        const hole = { at: o.at, ex, ey: n, half };
        for (const h of [npc.skinHider, ...npc.underHiders]) { h.add(hole); h.opens(); }
        for (const h of npc.clothHiders) h.add({ at: o.at, ex, ey: n, half: [half[0] * 1.15 + 0.01, half[1] * 1.3 + 0.008] });
        for (const h of npc.underHiders) h.window(o.at, n, half[0] + 0.03, 0.05);
        this._lips(o);
        this.openings.push(o);
        this._organs();
        // What it does: the wall's own vessels bleed; and the belly open, the bowel comes after it.
        const v = npc.vitals, chest = region(npc, npc.worldOf(o.at, o.owner).at) === 'chest';
        v.pain = Math.min(1, v.pain + 0.5);
        v.bleed({ name: chest ? 'chest wall' : 'abdominal wall', rate: 0.0008 + length * 0.006, clots: 0.006, source: { mark: hit } });
        if (chest) {
            // Air drawn in through the hole as the chest rises: the lung on that side falls in (a sucking chest wound).
            const side = V3.Dot(o.at, V3.Right()) > 0 ? 'L' : 'R';
            v.lungs[`leak${side}`] = true;
            v.injure('Chest wall opened: air sucked in, the lung collapsing', 8);
        } else v.injure(spill ? 'Belly opened: bowel spilling out' : 'Belly opened: bowel showing', spill ? 9 : 7);
        npc.world.sound?.shot('wet', { at: npc.worldOf(o.at, o.owner).at.asArray(), gain: 0.8 });
        if (spill) this._spill(o);
        return o;
    }

    // The lips of the opening: the layers of the wall it went through, all round its edge.
    _lips(o: Opening) {
        const npc = this.npc, line = [];
        for (let k = -6; k <= 6; k++) {
            const on = npc.runs.nearest(o.at.add(o.ex.scale((k / 6) * Math.max(0, o.half[0] - o.half[1]))), 0.03);
            if (on?.kind === 'skin') line.push(on);
        }
        if (line.length) npc.marks.lip(line, o.half[1], 0.007);
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
        const P: number[] = [], N: number[] = [], J: number[] = [], I = new Uint32Array(tris * 3), subs: [string, number, number][] = [];
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

    // (One for each kind for everybody: made the first time anyone's insides are seen.)
    _material(kind: string) {
        const scene: BABYLON.Scene = this.npc.world.scene, look = LOOK[kind] ?? LOOK.muscle;
        const old = scene.getMaterialByName(`organ_${kind}`);
        if (old) return old;
        const m = new BABYLON.PBRMaterial(`organ_${kind}`, scene);
        m.albedoColor = BABYLON.Color3.FromInts(look.c[0], look.c[1], look.c[2]).toLinearSpace();
        m.metallic = 0;
        m.roughness = look.rough;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 0.8;
        m.clearCoat.roughness = 0.08;
        m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
        m.environmentIntensity = 0.3;
        m.maxSimultaneousLights = 8;
        new Wet(m, look);
        return m;
    }

    // --- the bowel out ----------------------------------------------------------------------

    // Two or three loops of small bowel, coming out through the opening over the next seconds.
    _spill(o: Opening) {
        if (this.loops.length >= 4) return;
        if (!this.tube) this._tubeLook();
        const count = o.half[0] > 0.07 ? 4 : 2;
        for (let k = 0; k < count; k++) {
            // Each loop's two ends deep in the belly, a little apart, under the opening.
            const s = (k - (count - 1) / 2) * Math.min(0.04, o.half[0] * 0.5) + (Math.random() - 0.5) * 0.01;
            const mid = o.at.add(o.ex.scale(s)).subtract(o.normal.scale(0.06));
            const gap = 0.02 + Math.random() * 0.025, across = V3.Cross(o.normal, o.ex).scale((Math.random() - 0.5) * 0.02);
            this.loops.push(new Loop(this, o, mid.add(o.ex.scale(-gap)).add(across), mid.add(o.ex.scale(gap)).subtract(across), 0.3 + Math.random() * 0.5 + o.half[0] * 2, k * 0.7 + Math.random() * 0.4));
        }
        this.npc.vitals.bleed({ name: 'mesentery', rate: 0.0012 * count, internal: true, clots: 0.004 });
    }

    // The bowel's outside, painted along its length: pink, glossy, the small vessels from its mesentery running round it
    // every few millimetres, branching as they go and fading toward the far side.
    _tubeLook() {
        const scene: BABYLON.Scene = this.npc.world.scene, W = 512, H = 256;
        if (scene.getMaterialByName('bowel_out')) {
            this.tube = scene.getMaterialByName('bowel_out') as BABYLON.PBRMaterial;
            this.fan = scene.getMaterialByName('mesentery') as BABYLON.PBRMaterial;
            return;
        }
        const t = new BABYLON.DynamicTexture('bowel_wall', { width: W, height: H }, scene, true);
        t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        const g = t.getContext() as CanvasRenderingContext2D;
        g.fillStyle = 'rgb(214,140,126)';
        g.fillRect(0, 0, W, H);
        for (let k = 0; k < 2600; k++) {
            const r = Math.random();
            g.fillStyle = r < 0.45 ? 'rgba(232,168,150,0.22)' : r < 0.85 ? 'rgba(176,96,86,0.16)' : 'rgba(200,170,120,0.2)';
            g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 2 + Math.random() * 10, 2 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2); g.fill();
        }
        // Across the picture (v) is round the bowel; v = 0 and 1 its mesenteric side, where the vessels come in.
        g.lineCap = 'round';
        // The straight vessels (vasa recta): from the mesenteric side, one every few millimetres, uneven, each running
        // part of the way round, tapering, a branch or two off it.
        const vessel = (x: number, y: number, dir: number, len: number, width: number) => {
            g.strokeStyle = `rgba(${120 + Math.random() * 40},${14 + Math.random() * 14},${20 + Math.random() * 12},${0.28 + Math.random() * 0.3})`;
            let px = x, py = y, bend = (Math.random() - 0.5) * 0.6;
            for (let s = 0; s < len; s += 3) {
                const nx = px + Math.sin(bend) * 3 * dir + (Math.random() - 0.5) * 1.4, ny = py + Math.cos(bend) * 3 * dir;
                g.lineWidth = Math.max(0.35, width * (1 - s / len));
                g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
                px = nx; py = ny; bend += (Math.random() - 0.5) * 0.25;
                if (Math.random() < 0.04 && width > 0.9) vessel(px, py, dir, (len - s) * 0.5, width * 0.6);
            }
        };
        for (let x = 0; x < W; x += 5 + Math.random() * 9) {
            vessel(x, 0, 1, H * (0.15 + Math.random() * 0.35), 1 + Math.random() * 1.2);
            vessel(x + Math.random() * 4, H, -1, H * (0.15 + Math.random() * 0.35), 1 + Math.random() * 1.2);
        }
        t.update(true);
        const m = new BABYLON.PBRMaterial('bowel_out', scene);
        m.albedoTexture = t;
        m.metallic = 0;
        m.roughness = 0.24;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 1;
        m.clearCoat.roughness = 0.04;
        m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
        m.environmentIntensity = 0.3;
        m.maxSimultaneousLights = 8;
        this.tube = m;
        // The mesentery: a thin, glistening sheet, see-through where it is only membrane, yellow where fat lies in it, and
        // the vessels running through it to the bowel in arches (arcades), branching as they go. Across the picture (v) is
        // from the bowel (0) toward the root.
        const mt = new BABYLON.DynamicTexture('mesentery_look', { width: 256, height: 256 }, scene, true);
        mt.hasAlpha = true;
        const mg = mt.getContext() as CanvasRenderingContext2D;
        mg.fillStyle = 'rgba(214,150,120,0.55)';
        mg.fillRect(0, 0, 256, 256);
        for (let k = 0; k < 160; k++) {
            const y = 40 + Math.random() * 216;
            mg.fillStyle = `rgba(${226 + Math.random() * 20},${178 + Math.random() * 30},${90 + Math.random() * 30},${0.35 + Math.random() * 0.4})`;
            mg.beginPath(); mg.ellipse(Math.random() * 256, y, 6 + Math.random() * 18, 4 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2); mg.fill();
        }
        mg.lineCap = 'round';
        for (let x = 0; x < 256; x += 22 + Math.random() * 20) {
            // From the root a vessel runs toward the bowel and forks into arches that join their neighbours.
            let px = x, py = 256;
            mg.strokeStyle = 'rgba(120,16,22,0.85)';
            for (let y = 256; y > 30; y -= 8) {
                const nx = px + (Math.random() - 0.5) * 5;
                mg.lineWidth = 1 + (y / 256) * 2.2;
                mg.beginPath(); mg.moveTo(px, py); mg.lineTo(nx, y - 8); mg.stroke();
                px = nx; py = y - 8;
            }
            mg.lineWidth = 1.2;
            mg.beginPath(); mg.moveTo(px, py); mg.quadraticCurveTo(px + 15, py - 30, px + 30, py); mg.moveTo(px, py); mg.quadraticCurveTo(px - 15, py - 30, px - 30, py); mg.stroke();
            mg.lineWidth = 0.7;
            for (let s = -30; s <= 30; s += 6) { mg.beginPath(); mg.moveTo(px + s, py - 12); mg.lineTo(px + s + (Math.random() - 0.5) * 3, 0); mg.stroke(); }
        }
        mt.update(true);
        const f = new BABYLON.PBRMaterial('mesentery', scene);
        f.albedoTexture = mt;
        f.useAlphaFromAlbedoTexture = true;
        f.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        f.metallic = 0;
        f.roughness = 0.2;
        f.backFaceCulling = false;
        f.twoSidedLighting = true;
        f.maxSimultaneousLights = 8;
        this.fan = f;
    }

    // --- every frame ------------------------------------------------------------------------

    update(dt: number) {
        if (!this.loops.length) return;
        const npc = this.npc, rd = npc.ragdoll;
        // The body as capsules, for the bowel to lie on.
        const bodies = [];
        for (const seg of rd.segments) {
            if (seg.severed) continue;
            const [a, b] = rd.segmentEnds(seg);
            bodies.push({ a, b, r: seg.radius / 0.82 + CLOTHES + R * 0.8, seg });
        }
        let low = null;
        for (const loop of this.loops) loop.step(dt, bodies);
        this._apart();
        for (const loop of this.loops) {
            loop.draw();
            const l = loop.lowest();
            if (!low || l.y < low.y) low = l;
        }
        // Blood off the lowest of it, a drop at a time.
        if (low && npc.vitals.beating && (this._drip -= dt) < 0) {
            this._drip = 0.4 + Math.random() * 0.8;
            npc.world.blood.drip(low.add(new V3(0, -R, 0)), 0.05);
        }
    }

    // Loops lie on each other, not through each other: any two points closer than the bowel's width are pushed apart.
    _apart() {
        const all = this.loops, w = R * 1.9;
        for (let a = 0; a < all.length; a++) for (let b = a; b < all.length; b++) {
            const P = all[a].p, Q = all[b].p, n = all[a].count, m = all[b].count;
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

// --- a loop of bowel ----------------------------------------------------------------------------

class Loop {
    declare v: Viscera;
    declare o: Opening;
    declare ends: BABYLON.Vector3[];
    declare count: number;
    declare p: Float32Array;
    declare q: Float32Array;
    declare out: number;
    declare most: number;
    declare wait: number;
    declare hold: { index: number; to: BABYLON.Vector3 } | null;
    declare reach: Float32Array;
    declare mesh: BABYLON.Mesh;
    declare sheet: BABYLON.Mesh;
    declare _pos: Float32Array;
    declare _nor: Float32Array;
    declare _fan: Float32Array;

    // A loop from rest point `a` to rest point `b` (both just inside the opening), `most` metres of it able to come out,
    // starting after `wait` seconds.
    constructor(v: Viscera, o: Opening, a: BABYLON.Vector3, b: BABYLON.Vector3, most: number, wait: number) {
        this.v = v;
        this.o = o;
        this.ends = [a, b];
        this.count = POINTS;
        this.p = new Float32Array(POINTS * 3);
        this.q = new Float32Array(POINTS * 3);
        this.out = V3.Distance(a, b) * 1.1 + 0.01;
        this.most = most;
        this.wait = wait;
        this.hold = null;
        // (How far each point's mesentery lets it go, a little more or less here and there.)
        this.reach = Float32Array.from({ length: POINTS }, (_, i) => 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(i * 0.9 + Math.random() * 6)) * Math.random());
        // All of it starts bunched in the opening.
        const [wa, wb] = this._ends();
        for (let i = 0; i < POINTS; i++) {
            const t = i / (POINTS - 1), p = V3.Lerp(wa, wb, t);
            this.p.set([p.x, p.y, p.z], i * 3);
            this.q.set([p.x, p.y, p.z], i * 3);
        }
        this._build();
    }

    at(i: number) { return new V3(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]); }

    // The two ends where they are now, held in the wound.
    _ends() {
        const npc = this.v.npc;
        return this.ends.map((e) => npc.worldOf(e, this.o.owner).at);
    }

    lowest() {
        let best = 1;
        for (let i = 1; i < this.count; i++) if (this.p[i * 3 + 1] < this.p[best * 3 + 1]) best = i;
        return this.at(best);
    }

    step(dt: number, bodies) {
        const npc = this.v.npc, p = this.p, q = this.q, n = this.count;
        // The belly's front where the opening is, as a wall the bowel lies against and cannot go back through.
        const face = npc.worldOf(this.o.at, this.o.owner, this.o.normal);
        // Only the parts of the body the loop can reach.
        const reach = MESENTERY + 0.12;
        bodies = bodies.filter((c) => segmentNear(c, face.at, reach + c.r));
        if ((this.wait -= dt) < 0) {
            // It slides out under its own weight, faster where the opening faces down, and is pulled out by a hand.
            const facing = npc.worldOf(this.o.at, this.o.owner, this.o.normal).normal;
            this.out = Math.min(this.most, this.out + dt * (0.04 + 0.1 * Math.max(0, 0.3 - facing.y)) + (this.hold ? dt * 0.4 : 0));
        }
        const rest = this.out / (n - 1);
        const [a, b] = this._ends();
        // Coming out, each loop is shoved about by the others behind it: a little push sideways now and then, so they fall
        // in a tangle and not side by side.
        if (this.out < this.most && Math.random() < dt * 3) {
            const i = 3 + Math.floor(Math.random() * (n - 6)), k = i * 3, s = 0.004;
            q[k] -= (Math.random() - 0.5) * s; q[k + 1] -= Math.random() * s * 0.5; q[k + 2] -= (Math.random() - 0.5) * s;
        }
        const h = Math.min(dt, 1 / 30), g = -9.81 * h * h;
        for (let i = 1; i < n - 1; i++) {
            const k = i * 3;
            for (let j = 0; j < 3; j++) {
                const now = p[k + j], v = (now - q[k + j]) * 0.985;
                q[k + j] = now;
                p[k + j] = now + v + (j === 1 ? g : 0);
            }
        }
        p.set([a.x, a.y, a.z], 0);
        p.set([b.x, b.y, b.z], (n - 1) * 3);
        for (let iter = 0; iter < 6; iter++) {
            for (let i = 0; i + 1 < n; i++) {
                const k = i * 3, l = k + 3;
                const dx = p[l] - p[k], dy = p[l + 1] - p[k + 1], dz = p[l + 2] - p[k + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                const diff = (d - rest) / d * 0.5, fa = i === 0 ? 0 : 1, fb = i + 1 === n - 1 ? 0 : 1, sum = fa + fb || 1;
                p[k] += dx * diff * 2 * fa / sum; p[k + 1] += dy * diff * 2 * fa / sum; p[k + 2] += dz * diff * 2 * fa / sum;
                p[l] -= dx * diff * 2 * fb / sum; p[l + 1] -= dy * diff * 2 * fb / sum; p[l + 2] -= dz * diff * 2 * fb / sum;
            }
            // A loop does not fold flat on itself: points two apart are kept a bowel's width apart.
            for (let i = 0; i + 2 < n; i++) {
                const k = i * 3, l = k + 6, dx = p[l] - p[k], dy = p[l + 1] - p[k + 1], dz = p[l + 2] - p[k + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                if (d >= R * 1.6) continue;
                const push = (R * 1.6 - d) / d * 0.25;
                if (i > 0) { p[k] -= dx * push; p[k + 1] -= dy * push; p[k + 2] -= dz * push; }
                if (i + 2 < n - 1) { p[l] += dx * push; p[l + 1] += dy * push; p[l + 2] += dz * push; }
            }
            if (this.hold) {
                const k = this.hold.index * 3, to = this.hold.to;
                p[k] += (to.x - p[k]) * 0.5; p[k + 1] += (to.y - p[k + 1]) * 0.5; p[k + 2] += (to.z - p[k + 2]) * 0.5;
            }
            // Held by its mesentery: no point gets further from the root than the mesentery reaches (most at the loop's
            // middle), so a long loop hangs in folds, not as a cord.
            const rx = (p[0] + p[(n - 1) * 3]) / 2, ry = (p[1] + p[(n - 1) * 3 + 1]) / 2, rz = (p[2] + p[(n - 1) * 3 + 2]) / 2;
            for (let i = 1; i < n - 1; i++) {
                const k = i * 3, most = (0.06 + MESENTERY * Math.sin((i / (n - 1)) * Math.PI)) * this.reach[i];
                const dx = p[k] - rx, dy = p[k + 1] - ry, dz = p[k + 2] - rz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > most) { const s = most / d; p[k] = rx + dx * s; p[k + 1] = ry + dy * s; p[k + 2] = rz + dz * s; }
            }
            // The floor, and the body, which it lies on and slides off (the few points nearest the wound are still in it).
            for (let i = 1; i < n - 1; i++) {
                const k = i * 3;
                if (i >= 3 && i <= n - 4) {
                    const fx = p[k] - face.at.x, fy = p[k + 1] - face.at.y, fz = p[k + 2] - face.at.z;
                    const out = fx * face.normal.x + fy * face.normal.y + fz * face.normal.z, want = CLOTHES + R;
                    if (out < want && fx * fx + fy * fy + fz * fz < 0.3 * 0.3) { const s = want - out; p[k] += face.normal.x * s; p[k + 1] += face.normal.y * s; p[k + 2] += face.normal.z * s; }
                }
                if (p[k + 1] < R) { p[k + 1] = R; q[k] = p[k] - (p[k] - q[k]) * 0.6; q[k + 2] = p[k + 2] - (p[k + 2] - q[k + 2]) * 0.6; }
                if (i < 3 || i > n - 4) continue;
                for (const c of bodies) {
                    const ax = c.a.x, ay = c.a.y, az = c.a.z, ux = c.b.x - ax, uy = c.b.y - ay, uz = c.b.z - az;
                    const uu = ux * ux + uy * uy + uz * uz || 1e-9;
                    const t = Math.max(0, Math.min(1, ((p[k] - ax) * ux + (p[k + 1] - ay) * uy + (p[k + 2] - az) * uz) / uu));
                    const dx = p[k] - (ax + ux * t), dy = p[k + 1] - (ay + uy * t), dz = p[k + 2] - (az + uz * t), d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 >= c.r * c.r) continue;
                    const d = Math.sqrt(d2);
                    if (d >= c.r || d < 1e-6) continue;
                    const s = (c.r - d) / d;
                    p[k] += dx * s; p[k + 1] += dy * s; p[k + 2] += dz * s;
                }
            }
        }
    }

    // --- drawing ----------------------------------------------------------------------------

    _build() {
        const scene = this.v.npc.world.scene, rings = (this.count - 1) * SPLIT + 1;
        const pos = new Float32Array(rings * SIDES * 3), uv = new Float32Array(rings * SIDES * 2), index: number[] = [];
        for (let i = 0; i < rings; i++) for (let s = 0; s < SIDES; s++) {
            uv[(i * SIDES + s) * 2] = (i / SPLIT) * 0.12;
            uv[(i * SIDES + s) * 2 + 1] = s / (SIDES - 1);
            if (i + 1 < rings && s + 1 < SIDES) {
                const a = i * SIDES + s, b = a + 1, c = a + SIDES, d = c + 1;
                index.push(a, c, b, b, c, d);
            }
        }
        const mesh = new BABYLON.Mesh('bowel_loop', scene);
        const vd = new BABYLON.VertexData();
        Object.assign(vd, { positions: pos, indices: index, uvs: uv, normals: new Float32Array(pos.length) });
        vd.applyToMesh(mesh, true);
        mesh.material = this.v.tube;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.receiveShadows = true;
        this.v.npc.world.shadows?.addShadowCaster(mesh);
        this.mesh = mesh;
        this._pos = pos;
        this._nor = new Float32Array(pos.length);
        this._line = new Float32Array(rings * 3);
        // The mesentery: from each point of the loop part of the way back toward where it goes in.
        const fan = new Float32Array(rings * 2 * 3), fi: number[] = [];
        for (let i = 0; i + 1 < rings; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; fi.push(a, c, b, b, c, d); }
        const sheet = new BABYLON.Mesh('mesentery', scene);
        const fd = new BABYLON.VertexData();
        const fu = new Float32Array(rings * 4);
        for (let i = 0; i < rings; i++) fu.set([(i / SPLIT) * 0.15, 0, (i / SPLIT) * 0.15, 1], i * 4);
        Object.assign(fd, { positions: fan, indices: fi, normals: new Float32Array(fan.length), uvs: fu });
        fd.applyToMesh(sheet, true);
        sheet.material = this.v.fan;
        sheet.isPickable = false;
        sheet.alwaysSelectAsActiveMesh = true;
        this.sheet = sheet;
        this._fan = fan;
        this._fanNormals = new Float32Array(fan.length);
    }
    declare _line: Float32Array;
    declare _fanNormals: Float32Array;

    draw() {
        const n = this.count, p = this.p, pos = this._pos, nor = this._nor, line = this._line, rings = (n - 1) * SPLIT + 1;
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
        // A frame carried along the loop (parallel transport), so the tube does not twist.
        let ux = 0, uy = 1, uz = 0;
        const rx = (p[0] + p[(n - 1) * 3]) / 2, ry = (p[1] + p[(n - 1) * 3 + 1]) / 2, rz = (p[2] + p[(n - 1) * 3 + 2]) / 2;
        const fan = this._fan, fn = this._fanNormals;
        for (let i = 0; i < rings; i++) {
            const a = Math.max(0, i - 1) * 3, b = Math.min(rings - 1, i + 1) * 3;
            let tx = line[b] - line[a], ty = line[b + 1] - line[a + 1], tz = line[b + 2] - line[a + 2];
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
            tx /= tl; ty /= tl; tz /= tl;
            let dot = ux * tx + uy * ty + uz * tz;
            ux -= tx * dot; uy -= ty * dot; uz -= tz * dot;
            let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
            if (ul < 1e-3) { ux = Math.abs(ty) < 0.9 ? 0 : 1; uy = Math.abs(ty) < 0.9 ? 1 : 0; uz = 0; dot = ux * tx + uy * ty; ux -= tx * dot; uy -= ty * dot; uz -= tz * dot; ul = Math.sqrt(ux * ux + uy * uy + uz * uz); }
            ux /= ul; uy /= ul; uz /= ul;
            const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
            const x = line[i * 3], y = line[i * 3 + 1], z = line[i * 3 + 2];
            // Wider and narrower along its length, as a bowel with its contents in it is.
            const f = i / SPLIT, r = R * (0.88 + 0.16 * Math.sin(f * 1.7 + 0.6) * Math.sin(f * 0.53 + 1.3));
            for (let s2 = 0; s2 < SIDES; s2++) {
                const c = COS[s2], sn = SIN[s2], o = (i * SIDES + s2) * 3;
                const nx = ux * c + wx * sn, ny = uy * c + wy * sn, nz = uz * c + wz * sn;
                pos[o] = x + nx * r; pos[o + 1] = y + ny * r; pos[o + 2] = z + nz * r;
                nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
            }
            // The mesentery, from the loop part of the way back to its root, deepest at the loop's middle; facing square
            // to the loop and to the way back.
            const fo = i * 6, toward = 0.45 * Math.sin((i / (rings - 1)) * Math.PI);
            const bx = rx - x, by = ry - y, bz = rz - z;
            let mx = ty * bz - tz * by, my = tz * bx - tx * bz, mz = tx * by - ty * bx;
            const ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
            mx /= ml; my /= ml; mz /= ml;
            fan[fo] = x; fan[fo + 1] = y; fan[fo + 2] = z;
            fan[fo + 3] = x + bx * toward; fan[fo + 4] = y + by * toward; fan[fo + 5] = z + bz * toward;
            fn[fo] = fn[fo + 3] = mx; fn[fo + 1] = fn[fo + 4] = my; fn[fo + 2] = fn[fo + 5] = mz;
        }
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nor);
        this.sheet.updateVerticesData(BABYLON.VertexBuffer.PositionKind, fan);
        this.sheet.updateVerticesData(BABYLON.VertexBuffer.NormalKind, fn);
    }

    dispose() {
        this.mesh.dispose();
        this.sheet.dispose();
    }
}

const COS = Float32Array.from({ length: SIDES }, (_, s) => Math.cos((s / (SIDES - 1)) * Math.PI * 2));
const SIN = Float32Array.from({ length: SIDES }, (_, s) => Math.sin((s / (SIDES - 1)) * Math.PI * 2));

// Whether the capsule `c` (ends a, b) comes within `r` of point `p`.
function segmentNear(c, p: BABYLON.Vector3, r: number) {
    const ux = c.b.x - c.a.x, uy = c.b.y - c.a.y, uz = c.b.z - c.a.z, uu = ux * ux + uy * uy + uz * uz || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - c.a.x) * ux + (p.y - c.a.y) * uy + (p.z - c.a.z) * uz) / uu));
    const dx = p.x - c.a.x - ux * t, dy = p.y - c.a.y - uy * t, dz = p.z - c.a.z - uz * t;
    return dx * dx + dy * dy + dz * dz < r * r;
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
    float broad = wetNoise(p * 40.0), mid = wetNoise(p * 160.0), fine = wetNoise(p * 700.0);
    // Vessels: thin lines where a stretched noise crosses its middle, branching where two scales meet.
    float r1 = 1.0 - abs(wetNoise(p * vec3(90.0, 140.0, 90.0)) * 2.0 - 1.0), r2 = 1.0 - abs(wetNoise(p * 260.0 + 3.1) * 2.0 - 1.0);
    float vessel = (smoothstep(0.93, 0.985, r1) + 0.6 * smoothstep(0.95, 0.99, r2)) * wetLook.x;
    float spots = smoothstep(0.55, 0.75, wetNoise(p * 150.0)) * wetLook.y;
    float fatty = smoothstep(0.58, 0.72, wetNoise(p * 28.0 + 7.7)) * wetLook.z;
    vec3 base = surfaceAlbedo * (0.82 + 0.3 * broad) * (0.92 + 0.12 * mid);
    base *= 1.0 - 0.35 * spots;
    base = mix(base, vec3(0.62, 0.36, 0.09), fatty);
    base = mix(base, vec3(0.2, 0.012, 0.01), clamp(vessel, 0.0, 0.85));
    surfaceAlbedo = base;
    // A fine unevenness (and the vessels standing a little proud) bending the light.
    float h = mid * 0.6 + fine * 0.25 + vessel * 0.4 + fatty * 0.6;
    vec3 dpx = dFdx(vPositionW), dpy = dFdy(vPositionW);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1v = cross(dpy, normalW), r2v = cross(normalW, dpx);
    float det = dot(dpx, r1v);
    vec3 grad = sign(det) * (dhx * r1v + dhy * r2v);
    normalW = normalize(abs(det) * normalW - grad * 0.35);
}
#endif
`,
        };
    }
}
