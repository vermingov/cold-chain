// One person in the sandbox: their body, what is inside it, how it is doing,
// and what it does about it.
//
// Standing, they breathe and watch whoever is near, and a hit makes them
// flinch. They go down when their body would: out of blood, out of oxygen,
// knocked out, a leg broken, the spinal cord cut, or simply knocked over by a
// blow heavy enough. Down, they are a ragdoll (ragdoll.ts), with what is left
// of their muscle tone in the joints, until they have none.

import * as BABYLON from '@babylonjs/core';
import * as P from '../poses.ts';
import { Ragdoll, withMidBones } from './ragdoll.ts';
import { Behaviour } from './behaviour.ts';
import { Insides, loadAnatomy, triangle } from './anatomy.ts';
import { Vitals } from './vitals.ts';
import { Bones } from './bones.ts';
import { Marks, Gore } from './marks.ts';
import { Hider } from './hider.ts';
import { Runs } from './runs.ts';
import { Face } from './face.ts';
import { Bruise, BruiseLayer } from './bruise.ts';
import { Film, FilmLayer } from './film.ts';
import { Soak } from './soak.ts';
import { RHO } from './fluid.ts';
import { Dismember, swung } from './dismember.ts';
import { Viscera, slashed } from './viscera.ts';
import { Throat } from './throat.ts';
const V3 = BABYLON.Vector3;
const BACK = 45;            // mmHg: what the tissue round an open artery holds back of the pressure behind it


// Each person's body data with the middle bones in, made once per body.
export function prepare(people, name) {
    const key = name + '+mid';
    if (!people.bodies.has(key)) people.bodies.set(key, withMidBones(people.bodies.get(name)));
    return key;
}

export class Npc {
    declare person: any;
    declare clothes: BABYLON.Mesh;
    declare ragdoll: Ragdoll;
    declare behaviour: Behaviour;
    declare insides: Insides;
    declare vitals: Vitals;
    declare bones: Bones;
    declare marks: Marks;
    declare world: any;
    declare name: string;
    declare clock: number;
    declare flinch: Record<string, number>;
    declare legGone: boolean;
    declare _skinned: Float32Array | null;
    declare _skinnedAt: number;
    declare _boxed: Float32Array | null;
    declare _boxedAt: number;
    declare _restPos: Float32Array;
    declare _uv: Float32Array;
    declare down: boolean;
    declare grabbed: boolean;
    declare label: string;
    declare voice: string;
    declare runs: Runs;
    declare face: Face;
    declare bruise: Bruise;
    declare _crying: boolean;
    declare film: Film;
    declare soak: Soak;
    declare _aims: WeakMap<object, BABYLON.Vector3>;
    declare skinWhole: BABYLON.Material;
    declare skinHider: Hider;
    declare clothHiders: Hider[];
    declare underHiders: Hider[];
    declare skinMaterials: BABYLON.Material[];
    declare _said: { until: number; pain: number; next: number; awake: boolean };
    declare dismember: Dismember;
    declare viscera: Viscera;
    declare dressings: { dispose(): void }[];
    declare throat: Throat;

    // `world` is the sandbox: { scene, blood, sound, frame, camera, shadows }.
    static async make(world, people, body, { at, yaw = 0, bit = 4, mass = 75, name = body } = {} as any) {
        const key = prepare(people, body);
        const data = await loadAnatomy(`assets/anatomy/${body}.bin`);
        return new Npc(world, people, key, data, { at, yaw, bit, mass, name });
    }

    constructor(world, people, key, anatomy, { at, yaw, bit, mass, name }) {
        this.world = world;
        this.name = name;
        this.voice = key.split('+')[0];
        this._said = { until: 0, pain: 0, next: 3 + Math.random() * 4, awake: true };
        const person = people.make(key, { name: name + bit });
        person.root.position.copyFrom(at);
        person.root.rotation.y = yaw;
        this.person = person;
        // The clothes on a mesh of their own (the same geometry), so that a hole in a shirt and a hole in the skin
        // under it are painted on different sheets.
        this.clothes = person.mesh.clone(person.mesh.name + '_clothes', person.mesh.parent) as BABYLON.Mesh;
        this.clothes.skeleton = person.skeleton;
        this.clothes.subMeshes = [];
        person.mesh.subMeshes = [];
        person.header.parts.forEach((p, i) => {
            // (The skin under the clothes is drawn too, but only where a hole in them shows it: see _ownMaterials.)
            new BABYLON.SubMesh(i, p.vertexStart, p.vertexCount, p.indexStart, p.indexCount, p.worn ? this.clothes : person.mesh);
        });
        const { arrays } = people.bodies.get(key);
        this._restPos = arrays.position;
        this._uv = arrays.uv;

        this.clock = Math.random() * 10;
        this.flinch = {};
        this.legGone = false;
        this.down = false;
        this.grabbed = false;
        this._skinned = null;
        this._skinnedAt = -1;
        this._boxed = null;
        this._boxedAt = -1;
        person.apply(P.stand(this.clock));
        this.ragdoll = new Ragdoll(person, { mass, bit });
        this.behaviour = new Behaviour(this);
        this.insides = new Insides(person, anatomy);
        this.insides.build(world.scene);
        this.vitals = new Vitals(mass);
        this.bones = new Bones(this);
        this._ownMaterials(name + bit);
        // Teeth as they are in a lit room, ivory: the game's own tint was for a mouth seen in a dark cold room.
        person.header.parts.forEach((p, i) => { if (p.kind === 'teeth') person.multi.subMaterials[i].albedoColor = new BABYLON.Color3(0.93, 0.9, 0.82); });
        this.marks = new Marks(world.scene, this);
        for (const m of this.skinMaterials) new Gore(m, this.marks.depth);
        this.runs = new Runs(this);
        this.face = new Face(this);
        // What blows do to the skin over minutes: redness, bruising, swelling (bruise.ts), drawn by the skin's own material.
        this.bruise = new Bruise(this);
        for (const m of this.skinMaterials) new BruiseLayer(m, this.bruise);
        // Blood on the skin (film.ts) and in the clothes (soak.ts), drawn by the skin's and the clothes' own materials.
        this.film = new Film(world.scene, person.mesh.name);
        for (const m of this.skinMaterials) new FilmLayer(m, this.film);
        this.soak = new Soak(world.scene, this);
        for (const h of this.clothHiders) h.soaks(this.soak);
        this._aims = new WeakMap();
        this.dismember = new Dismember(this);
        this.viscera = new Viscera(this);
        // Blood in the mouth, the airways and the stomach (throat.ts), after the teeth, which say where the mouth is.
        this.throat = new Throat(this);
        for (const m of [person.mesh, this.clothes]) world.shadows?.addShadowCaster(m);
    }

    get dead() { return this.vitals.dead; }

    // --- what a line through them meets ------------------------------------------------

    // The skin and clothes crossed by the line from `origin` along unit `dir`, nearer than `far`, in order:
    // [{ t, kind: 'skin' | 'cloth', point, normal, uv, rest, restNormal, owner, scale }]. With `eyes`, the eyeballs too
    // (kind 'eye'): a line through the open lids meets the eye before the socket's skin behind it (eyes.ts).
    surface(origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number, eyes = false) {
        const skinned = this._skin();
        const inv = this.person.mesh.getWorldMatrix().clone().invert();
        const o = V3.TransformCoordinates(origin, inv), d = V3.TransformNormal(dir, inv).normalize();
        const scale = V3.TransformNormal(dir, inv).length();
        const hits = [];
        const index = this.person.header.indexArray ?? this._indices();
        const boxes = this._boxes(skinned, index);
        for (const p of this.person.header.parts) {
            // (The skin under the clothes is not drawn but is still where the body begins.)
            const kind = p.kind === 'skin' ? 'skin' : p.kind === 'cloth' ? 'cloth' : eyes && p.kind === 'eyes' ? 'eye' : null;
            if (!kind) continue;
            if (!slabFor(p, skinned, o, d, far * scale)) continue;
            const end = p.indexStart + p.indexCount;
            for (let start = p.indexStart; start < end;) {
                // Only the runs of triangles whose box the line crosses: the same crossings as trying every triangle.
                const run = Math.floor(start / RUN), next = Math.min(end, (run + 1) * RUN);
                if (boxCrossed(boxes, run * 6, o, d, far * scale)) {
                    for (let i = start; i < next; i += 3) {
                        const t = triangle(o, d, skinned, index, i);
                        // (The clear cornea over each eye is a shell painted see-through, its corners all on the sheet's
                        // empty corner: the eye is the white and the iris under it.)
                        if (kind === 'eye' && this._uv[index[i] * 2] > 0.87 && this._uv[index[i] * 2 + 1] < 0.13) continue;
                        if (t > 0 && t < far * scale) hits.push({ t: t / scale, i, kind });
                    }
                }
                start = next;
            }
        }
        hits.sort((a, b) => a.t - b.t);
        // Two crossings closer than a millimetre are the same seam met twice.
        const out = [];
        for (const h of hits) {
            if (out.length && out[out.length - 1].kind === h.kind && h.t - out[out.length - 1].t < 0.001) continue;
            out.push(this._describe(h, origin, dir, index, skinned));
        }
        return out;
    }

    _indices() {
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName);
        this.person.header.indexArray = arrays.index;
        return arrays.index;
    }

    // Skinned corners in the mesh's own space, once a frame however many shots ask.
    _skin() {
        if (this._skinnedAt !== this.world.frame || !this._skinned) {
            this.person.skeleton.computeAbsoluteMatrices(true);
            this.person.skeleton.prepare(true);
            this._skinned = this.person.mesh.getPositionData(true, true) as Float32Array;
            this._skinnedAt = this.world.frame;
        }
        return this._skinned;
    }

    // The box round each run of RUN / 3 triangles in this frame's skinned corners, made once a frame however many lines
    // ask: a bullet's exit casts some sixty short lines round its lips (wounds.ts tear), and every one of them used to
    // try each of the body's triangles.
    _boxes(skinned: Float32Array, index) {
        if (this._boxedAt === this._skinnedAt && this._boxed) return this._boxed;
        const runs = Math.ceil(index.length / RUN);
        const b = this._boxed?.length === runs * 6 ? this._boxed : (this._boxed = new Float32Array(runs * 6));
        for (let r = 0; r < runs; r++) {
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            for (let i = r * RUN, end = Math.min(index.length, i + RUN); i < end; i++) {
                const v = index[i] * 3, x = skinned[v], y = skinned[v + 1], z = skinned[v + 2];
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
            }
            b[r * 6] = x0; b[r * 6 + 1] = y0; b[r * 6 + 2] = z0; b[r * 6 + 3] = x1; b[r * 6 + 4] = y1; b[r * 6 + 5] = z1;
        }
        this._boxedAt = this._skinnedAt;
        return b;
    }

    _describe(h, origin, dir, index, skinned) {
        const a = index[h.i], b = index[h.i + 1], c = index[h.i + 2];
        const point = origin.add(dir.scale(h.t));
        const world = this.person.mesh.getWorldMatrix();
        const at = (arr, v) => new V3(arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]);
        const pa = at(skinned, a), pb = at(skinned, b), pc = at(skinned, c);
        let normal = V3.TransformNormal(V3.Cross(pb.subtract(pa), pc.subtract(pa)), world).normalize();
        if (V3.Dot(normal, dir) > 0) normal = normal.scale(-1);
        // Where on the triangle, by area: the same place on the triangle at rest, and in the skin's picture.
        const local = V3.TransformCoordinates(point, world.clone().invert());
        const [wa, wb, wc] = barycentric(local, pa, pb, pc);
        const ra = at(this._restPos, a), rb = at(this._restPos, b), rc = at(this._restPos, c);
        const rest = ra.scale(wa).add(rb.scale(wb)).add(rc.scale(wc));
        const uv = [this._uv[a * 2] * wa + this._uv[b * 2] * wb + this._uv[c * 2] * wc, this._uv[a * 2 + 1] * wa + this._uv[b * 2 + 1] * wb + this._uv[c * 2 + 1] * wc];
        // UV units to a metre of skin here, for painting things their real size.
        const area3 = V3.Cross(rb.subtract(ra), rc.subtract(ra)).length();
        const u = this._uv;
        const areaUv = Math.abs((u[b * 2] - u[a * 2]) * (u[c * 2 + 1] - u[a * 2 + 1]) - (u[c * 2] - u[a * 2]) * (u[b * 2 + 1] - u[a * 2 + 1]));
        // Which way the skin faces there at rest: the mesh's own normals, which point out (the triangle's winding
        // need not).
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName), n = arrays.normal;
        const restNormal = this._outward(at(n, a).scale(wa).add(at(n, b).scale(wb)).add(at(n, c).scale(wc)).normalize(), rest, this._owner(a));
        return { t: h.t, kind: h.kind, point, normal, uv, rest, restNormal, owner: this._owner(a), scale: Math.sqrt(areaUv / Math.max(1e-10, area3)),
            corners: [a, b, c], shares: [wa, wb, wc] };
    }

    // A normal at a place on the body turned, if it has to be, to point out of the body: away from the bone it hangs
    // on. (The mesh's own normals are mostly right; the skin kept under the clothes has some that point in, and a
    // wound dug along one grows out through the shirt.)
    _outward(n: BABYLON.Vector3, rest: BABYLON.Vector3, owner) {
        const a = owner.head, b = owner.tail, ab = b.subtract(a);
        const t = Math.max(0, Math.min(1, V3.Dot(rest.subtract(a), ab) / Math.max(1e-9, ab.lengthSquared())));
        return V3.Dot(n, rest.subtract(a.add(ab.scale(t)))) < 0 ? n.scale(-1) : n;
    }

    // The bones a place on the skin moves with and how much with each, as the skin itself is skinned: corners
    // `corners` mixed by `shares`. [{ owner, w }].
    weightsAt(corners: number[], shares: number[]) {
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName), total = new Map();
        corners.forEach((v, k) => {
            for (let j = 0; j < 4; j++) {
                const w = arrays.weights[v * 4 + j] / 255 * shares[k];
                if (w > 0) total.set(arrays.joints[v * 4 + j], (total.get(arrays.joints[v * 4 + j]) ?? 0) + w);
            }
        });
        const sum = [...total.values()].reduce((a, b) => a + b, 0) || 1;
        return [...total].map(([bone, w]) => ({ owner: this.person.byName[this.person.header.bones[bone].name], w: w / sum }));
    }

    // The bone that carries most of corner `v`.
    _owner(v) {
        const moved = this.dismember?.owners.get(v);
        if (moved) return moved;
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName);
        let best = 0, bone = 0;
        for (let k = 0; k < 4; k++) if (arrays.weights[v * 4 + k] > best) { best = arrays.weights[v * 4 + k]; bone = arrays.joints[v * 4 + k]; }
        return this.person.byName[this.person.header.bones[bone].name];
    }

    // Where a point of the body at rest (on bone `owner`) is in the world now, and a direction there.
    worldOf(rest: BABYLON.Vector3, owner, normal: BABYLON.Vector3 | null = null) {
        const m = this.restToWorld(owner);
        return { at: V3.TransformCoordinates(rest, m), normal: normal ? V3.TransformNormal(normal, m).normalize() : null };
    }

    // The matrix from the body at rest to the world now, for what bone `owner` carries.
    restToWorld(owner) {
        // (Multiplied in place: one new matrix, not three. It is asked for for every run, loop and bruise every frame.)
        const m = BABYLON.Matrix.Translation(-owner.head.x, -owner.head.y, -owner.head.z);
        return m.multiplyToRef(owner.bone.getAbsoluteMatrix(), m).multiplyToRef(this.person.mesh.getWorldMatrix(), m);
    }

    // A place on the body at rest as a crossing like surface()'s: triangle `t` (an offset into the index), `w` how
    // much of each corner, `kind` 'skin' or 'cloth'.
    crossing(t, w, kind) {
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName), index = arrays.index, pos = this._restPos, nor = arrays.normal, u = this._uv;
        const corner = (arr, k) => new V3(arr[index[t + k] * 3], arr[index[t + k] * 3 + 1], arr[index[t + k] * 3 + 2]);
        const [ra, rb, rc] = [0, 1, 2].map((k) => corner(pos, k));
        const rest = ra.scale(w[0]).add(rb.scale(w[1])).add(rc.scale(w[2]));
        const most = w[0] >= w[1] && w[0] >= w[2] ? index[t] : w[1] >= w[2] ? index[t + 1] : index[t + 2];
        const restNormal = this._outward(corner(nor, 0).scale(w[0]).add(corner(nor, 1).scale(w[1])).add(corner(nor, 2).scale(w[2])).normalize(), rest, this._owner(most));
        const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
        const uv = [u[a * 2] * w[0] + u[b * 2] * w[1] + u[c * 2] * w[2], u[a * 2 + 1] * w[0] + u[b * 2 + 1] * w[1] + u[c * 2 + 1] * w[2]];
        const area3 = V3.Cross(rb.subtract(ra), rc.subtract(ra)).length();
        const areaUv = Math.abs((u[b * 2] - u[a * 2]) * (u[c * 2 + 1] - u[a * 2 + 1]) - (u[c * 2] - u[a * 2]) * (u[b * 2 + 1] - u[a * 2 + 1]));
        return { kind, rest, restNormal, uv, scale: Math.sqrt(areaUv / Math.max(1e-10, area3)), owner: this._owner(most), corners: [a, b, c], shares: w };
    }

    // --- being hurt -----------------------------------------------------------------------

    // A push of `impulse` (N s) at `point`; `jolt` how much a standing person flinches from it (0 to 1).
    // The body takes the push where it landed; whether it stays on its feet is its balance's business (behaviour.ts).
    hit(point: BABYLON.Vector3, impulse: BABYLON.Vector3, jolt = 1) {
        const { seg } = this.ragdoll.nearest(point);
        if (!this.ragdoll.limp) this.world.sound?.shot('bullet-flesh', { at: point.asArray(), gain: 0.7 });
        this.behaviour.hit(seg, impulse, point, jolt);
    }

    // Blood thrown out where a shot went in and where it came out (dev/research/gunshot-blood.md sec. 1). Back out of the
    // way in, in earnest only from the head and from close: calves shot in the head with a 9 mm from 10 cm or nearer threw
    // 31 to 324 stains over half a millimetre (and more finer ones) over a half-circle, most within half a metre, none past
    // 1.2 m (Karger 1996); the jets left at 6 to 45 m/s from 5 cm and further, up to 330 m/s at contact (Schyma 2021).
    // Three hundred drops of half a millimetre is about 0.02 ml. From the trunk at a distance next to none (DiMaio 1999,
    // Betz: none on the hand in six contact wounds of the chest), here a tenth of that. Out of the way out, forward with
    // the bullet: more, finer, and bits of tissue among it, all of it in the first instant, more the more energy the
    // bullet left in the body (nobody has measured those volumes: estimates). `range`: metres from the muzzle.
    spatter(enter, dir, exitAt, m, exited, range = Infinity) {
        const blood = this.world.blood;
        const power = Math.min(1, m.energy / 2000);
        const head = this.ragdoll.nearest(enter.point).seg?.name === 'head', close = range < 0.1;
        const back = (head ? 1 : 0.1) * (close ? 2 : 1) * (0.02 + power * 0.03);
        blood.spray(enter.point.add(enter.normal.scale(0.004)), enter.normal, close ? 40 : 15, back, Math.PI / 2, 0.3);
        if (exited && exitAt) {
            blood.spray(exitAt, dir, 9 + power * 16, 0.5 + power * 2.5, 0.4, 0.4);
            blood.spray(exitAt, dir, 4 + power * 7, 0.2 + power * 1.5, 0.3, 2);
        }
    }

    // A fresh wound in bare skin wells up: a little blood in and round it at once, more as it bleeds (_bleed). (Under
    // clothes nothing shows yet: the cloth takes up the blood as it comes.)
    welling(hit, ml) {
        if (!hit || hit.cloth) return;
        this.film.blot(hit, 0.003 + Math.sqrt(ml) * 0.0015, 0.25);
        this.runs.start(hit, ml * 0.3);
    }

    crack() { this.world.sound?.shot('crack', { at: this.ragdoll.centre.asArray() }); }

    broke(segment) { this.world.onBroke?.(this, segment); }

    // Off their feet whatever their balance: grabbed and pulled, say. The landing is heard when it happens.
    knockDown() {
        this.behaviour.knockDown();
        this.down = true;
    }

    // --- every frame ----------------------------------------------------------------------

    update(dt: number) {
        const v = this.vitals;
        v.update(dt);
        // The muscles do what the body can (behaviour.ts), the physics moves it, and the skeleton follows the bodies.
        this.behaviour.update(dt);
        this.ragdoll.drive();
        this.dismember.update(dt);
        this.throat.update(dt);
        this.face.update(dt, this.vitals, this._crying, Math.max((this as any).bones?.jawHangs ?? 0, this.throat.gape));
        this.bruise.update(dt);
        this._bleed(dt);
        this._speak(dt);
        this.runs.update(dt);
        this.viscera.update(dt);
    }

    // Blood out of each wound, as much as is coming out of it this frame, to where it goes: an artery open to the air
    // throws it as a stream; anything else comes out into the clothes over the wound, or onto the skin, and runs.
    _bleed(dt) {
        const v = this.vitals, blood = this.world.blood;
        // Bleeding inside the body gets out through a wound in its wall only once enough has gathered in there to reach
        // the hole, and then the more the wound faces down: a small hole is held shut by the tissue round it, and blood
        // leaks from wounds on the lowest side (dev/research/gunshot-blood.md sec. 2, stab-wounds.md sec. 1, DiMaio 1999
        // ch. 9). At most the twelfth it always let out. How much has to gather first is an estimate: half a litre.
        let inside = 0;
        for (const b of v.bleeds) if (b.internal && !b.into) inside += b.lost;
        const filled = Math.min(1, inside / 0.5), facing = new Map();
        for (const b of v.bleeds) {
            // Into the mouth, the airways or the stomach (throat.ts); only the front of a nosebleed comes out of the nose.
            let share = b.into ? this.throat.take(b, (b.flow ?? 0) * dt * 1000) : 1;
            if (!share) continue;
            const mark = b.source?.mark;
            if (!mark) continue;
            if (b.internal) {
                if (!facing.has(mark)) facing.set(mark, filled > 0 ? Math.max(0, -this.worldOf(mark.rest, mark.owner, mark.restNormal).normal.y) : 0);
                share *= 0.08 * filled * (0.15 + 0.85 * facing.get(mark));
            }
            const flow = (b.flow ?? 0) * share;
            if (flow < 1e-6) continue;
            const ml = flow * dt * 1000;
            // Under a dressing it goes into the gauze, and out from under it once that is full (dressing.ts).
            if (b.dressing) { b.dressing.take(b, ml); continue; }
            if (b.spurts && !b.internal && v.beating) {
                // The pressure in the artery now: up fast as the heart squeezes, falling away till the next beat. What
                // gets past the tissue round the hole throws the blood out as fast as Bernoulli says, and it surges with it.
                const sys = v.map * 1.32, dia = v.map * 0.84, ph = v.beat;
                const p = dia + (sys - dia) * (ph < 0.1 ? ph / 0.1 : Math.exp(-(ph - 0.1) / 0.17));
                const speed = 0.6 * Math.sqrt(Math.max(0, (2 * (p - BACK) * 133.3) / RHO));
                if (speed > 0.4) {
                    const { at, normal } = this.worldOf(mark.rest, mark.owner, mark.restNormal);
                    let aim = this._aims.get(b);
                    if (!aim) { aim = new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(0.5); this._aims.set(b, aim); }
                    const out = ml * (p / v.map);
                    // Through clothes most of it soaks in, and the rest comes through the hole slower.
                    const into = mark.cloth ? 0.6 : 0;
                    if (into) this.soak.add(mark.cloth.rest, out * into);
                    const fast = speed * (mark.cloth ? 0.6 : 1), q = (out * (1 - into) * 1e-6) / dt;
                    const r = Math.min(0.004, Math.max(0.0006, Math.sqrt(q / (Math.PI * fast))));
                    blood.stream(b, at.add(normal.scale(0.004)), normal.add(aim).normalize(), fast, out * (1 - into), r, dt);
                    continue;
                }
            }
            // Where it comes out decides where it goes: into the clothes over the wound (which drip once full), or onto
            // the skin, where it runs (runs.ts).
            if (mark.cloth) this.soak.add(mark.cloth.rest, ml);
            else this.runs.start(mark, ml, b);
        }
        this.film.update(dt);
        this.soak.update(dt);
    }

    // --- wounds as flesh -------------------------------------------------------------------

    // The skin and clothes in materials of this person's own, so that this person's wounds, holes and stains show on
    // them and on nobody else.
    _ownMaterials(tag) {
        const { person } = this, parts = person.header.parts, shared = person.multi.subMaterials;
        const own = (i, depth, list) => {
            const m = shared[i].clone(`${shared[i].name}:${tag}`);
            list.push(new Hider(m, depth));
            return m;
        };
        this.skinWhole = shared[parts.findIndex((p) => p.kind === 'skin')];
        const skins = [], cloths = [];
        const mine = (name) => new BABYLON.MultiMaterial(name + tag, this.world.scene);
        const skinMulti = mine('skin'), clothMulti = mine('cloth');
        const skinOwn = new Map(), clothOwn = new Map();
        // Skin under clothes has a material of its own that draws it only through holes in them.
        const unders = [], underOwn = new Map();
        skinMulti.subMaterials = shared.map((m, i) => (parts[i].kind !== 'skin' ? m : parts[i].under ? (underOwn.get(m) ?? underOwn.set(m, own(i, 0.03, unders)).get(m))
            : (skinOwn.get(m) ?? skinOwn.set(m, own(i, 0.03, skins)).get(m))));
        // (The switch is read when the shader is made: say it changed, or the skin under the clothes is drawn whole.)
        for (const h of unders) { h.reveal = true; h.markAllDefinesAsDirty(); }
        this.underHiders = unders;
        this.skinMaterials = [...skinOwn.values(), ...underOwn.values()];
        clothMulti.subMaterials = shared.map((m, i) => (parts[i].kind === 'cloth' ? (clothOwn.get(m) ?? clothOwn.set(m, own(i, 0.05, cloths)).get(m)) : m));
        person.mesh.material = skinMulti;
        this.clothes.material = clothMulti;
        this.skinHider = skins[0];
        this.clothHiders = cloths;
    }

    // A wound made at `hit` (a crossing from surface()): 'in' (a bullet's way in), 'out' (its way out). `size` is the
    // bullet across, in metres. On skin it opens the flesh there (marks.ts, drawn by Gore); on clothes it is a hole in
    // them. False if the clothes have as many holes as can be drawn. (A blade's slit is wounds.ts's.)
    wound(hit, kind: 'in' | 'out', size: number) {
        if (hit.kind === 'cloth') {
            const r = size * (kind === 'out' ? 0.9 : 0.55);
            const hole = { at: hit.rest, ex: tangent(hit.restNormal), ey: hit.restNormal, half: [r, -1] };
            for (const h of this.underHiders) h.window(hit.rest, hit.restNormal, r * 1.6);
            return this.clothHiders.map((h) => h.add(hole)).every(Boolean);
        }
        if (kind === 'in') this.marks.entry(hit, size);
        else this.marks.exit(hit, size);
        return true;
    }

    // A blade drawn across the skin through `hits` (in order), `deep` metres into it. The cut follows the skin from one
    // place it crossed to the next, through places laid back on the skin in between, so it runs round a face and does
    // not cut across it.
    slash(hits, deep: number, sweep: BABYLON.Vector3 | null = null) {
        swung(this);    // a heavy edge may have gone right through a limb (dismember.ts)
        slashed(this, hits, deep);    // or through the wall of the belly or chest (viscera.ts)
        const skin = hits.filter((h) => h.kind === 'skin');
        // A blade that crossed the skin only once still opened it for a few centimetres, along the way it was going.
        if (skin.length === 1 && sweep) {
            const along = V3.TransformNormal(sweep, this.restToWorld(skin[0].owner).clone().invert()).normalize();
            const n = skin[0].restNormal, flat = along.subtract(n.scale(V3.Dot(along, n))).normalize();
            const at = (k) => this.runs.nearest(skin[0].rest.add(flat.scale(k)), 0.03);
            const ends = [at(-0.018), skin[0], at(0.018)].filter((h) => h?.kind === 'skin');
            if (ends.length > 1) return this.slash(ends, deep);
        }
        // An incised wound is deepest where the blade went in and tails off to a scratch where it came out, and gapes
        // into an ellipse, widest in its middle (dev/research/wounds.md).
        const path = [skin[0]];
        for (let k = 0; k + 1 < skin.length; k++) {
            const a = skin[k], b = skin[k + 1], gap = V3.Distance(a.rest, b.rest);
            if (gap > 0.15) { path.push(null, b); continue; }
            const steps = Math.floor(gap / 0.012);
            for (let j = 1; j <= steps; j++) {
                const on = this.runs.nearest(V3.Lerp(a.rest, b.rest, j / (steps + 1)), 0.04);
                if (on?.kind === 'skin') path.push(on);
            }
            path.push(b);
        }
        for (let k = 0; k + 1 < path.length; k++) {
            if (!path[k] || !path[k + 1]) continue;
            const t = (k + 0.5) / (path.length - 1);
            this.marks.cut(path[k], path[k + 1], deep * (1 - 0.85 * t), 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
        }
    }

    // --- the voice ---------------------------------------------------------------------------

    // One of this person's cries (tools/cries.py), from their mouth, unless they are already making one. `over`
    // cuts in on whatever they were saying, as a new hurt does.
    say(kind, gain = 1, over = false) {
        const now = performance.now() / 1000;
        if (!over && now < this._said.until) return;
        this._said.until = now + (kind === 'yell' ? 0.8 : kind === 'scream' || kind === 'cry' ? 3 : 2.2);
        const playing = this.world.sound?.shot(`${kind}-${this.voice}`, { follow: () => this.ragdoll.byName.get('head').node.position.asArray(), gain });
        if (playing) this.face.speak(playing, this.world.sound.now, kind);
        this._crying = kind === 'cry' || (this._crying && kind !== 'scream' && kind !== 'yell');
    }

    // What they say about what is happening to them: a cry the moment it hurts, as bad as it hurts; then groans, or
    // weeping once a lot of blood has gone; gasping when they cannot get air; and a last breath.
    _speak(dt) {
        const v = this.vitals, said = this._said;
        const awake = v.conscious > 0.35 && v.beating && !v.dead;
        if (said.awake && !awake && (v.dead || !v.beating)) this.say('dying', 0.8, true);
        said.awake = awake;
        const hurt = v.pain - said.pain;
        said.pain = v.pain;
        if (!awake) return;
        if (hurt > 0.12 && v.breathing) { this.say(hurt > 0.35 ? 'scream' : 'yell', Math.min(1, 0.6 + hurt), true); said.next = 2 + Math.random() * 3; return; }
        if ((said.next -= dt) > 0) return;
        said.next = 3.5 + Math.random() * 5;
        const short = !v.breathing || v.spo2 < 88 || (v.lungs.L + v.lungs.R) / 2 < 0.6 || v.airway < 0.6 || v.flooded.L + v.flooded.R > 0.6 || v.choked > 0.3;
        if (short) this.say('gasp', 0.8);
        else if (v.lost > 0.18 && Math.random() < 0.6) this.say('cry', 0.75);
        else if (v.pain > 0.25) this.say('groan', 0.6 + v.pain * 0.3);
    }

    dispose() {
        this.dismember.dispose();
        this.viscera.dispose();
        this.bones.dispose();
        this.ragdoll.dispose();
        this.insides.dispose();
        this.marks.dispose();
        this.bruise.dispose();
        this.film.dispose();
        this.soak.dispose();
        this.face.dispose();
        for (const d of [...(this.dressings ?? [])]) d.dispose();
        this.clothes.dispose();
        this.person.dispose();
    }
}

// Whether the line meets part `p`'s corners' box at all (skinned corners, so the box is made fresh: cheap next to the
// triangles it saves).
const RUN = 96;     // indices: 32 triangles, which lie together in the mesh (MakeHuman's faces are in order over the body)

// Whether the line o + t d, 0 < t < far, meets the box at `k` in `b` (a hair larger, for rounding).
function boxCrossed(b: Float32Array, k: number, o, d, far: number) {
    let t0 = 0, t1 = far;
    for (let a = 0; a < 3; a++) {
        const ok = a === 0 ? o.x : a === 1 ? o.y : o.z, dk = a === 0 ? d.x : a === 1 ? d.y : d.z;
        const lo = b[k + a] - 1e-5, hi = b[k + 3 + a] + 1e-5;
        if (Math.abs(dk) < 1e-12) { if (ok < lo || ok > hi) return false; continue; }
        let p = (lo - ok) / dk, q = (hi - ok) / dk;
        if (p > q) { const s = p; p = q; q = s; }
        if (p > t0) t0 = p;
        if (q < t1) t1 = q;
        if (t0 > t1) return false;
    }
    return true;
}

function slabFor(p, skinned, o, d, far) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v += 7) {
        for (let k = 0; k < 3; k++) { const x = skinned[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    }
    let t0 = 0, t1 = far;
    for (let k = 0; k < 3; k++) {
        const dk = [d.x, d.y, d.z][k], ok = [o.x, o.y, o.z][k];
        const inv = 1 / dk;
        let a = (lo[k] - 0.05 - ok) * inv, b = (hi[k] + 0.05 - ok) * inv;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) return false;
    }
    return true;
}

function barycentric(p, a, b, c) {
    const v0 = b.subtract(a), v1 = c.subtract(a), v2 = p.subtract(a);
    const d00 = V3.Dot(v0, v0), d01 = V3.Dot(v0, v1), d11 = V3.Dot(v1, v1), d20 = V3.Dot(v2, v0), d21 = V3.Dot(v2, v1);
    const den = d00 * d11 - d01 * d01 || 1;
    const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
    return [1 - v - w, v, w];
}

// Some direction along a surface whose normal is `n`.
function tangent(n: BABYLON.Vector3) {
    const hint = Math.abs(n.y) < 0.9 ? V3.Up() : V3.Forward();
    return hint.subtract(n.scale(V3.Dot(hint, n))).normalize();
}
