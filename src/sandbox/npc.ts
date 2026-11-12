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
import { Insides, loadAnatomy, triangle } from './anatomy.ts';
import { Vitals } from './vitals.ts';
import { Marks } from './marks.ts';
const V3 = BABYLON.Vector3;

const TOPPLE = 16;          // N s: a push a standing person cannot take on their feet
const RECOVER = 5;          // per second: how fast a flinch settles

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
    declare insides: Insides;
    declare vitals: Vitals;
    declare marks: Marks;
    declare world: any;
    declare name: string;
    declare clock: number;
    declare flinch: Record<string, number>;
    declare legGone: boolean;
    declare coughsBlood: boolean;
    declare _skinned: Float32Array | null;
    declare _skinnedAt: number;
    declare _cough: number;
    declare _restPos: Float32Array;
    declare _uv: Float32Array;
    declare down: boolean;
    declare grabbed: boolean;
    declare label: string;

    // `world` is the sandbox: { scene, blood, sound, frame, camera, shadows }.
    static async make(world, people, body, { at, yaw = 0, bit = 4, mass = 75, name = body } = {} as any) {
        const key = prepare(people, body);
        const data = await loadAnatomy(`assets/anatomy/${body}.bin`);
        return new Npc(world, people, key, data, { at, yaw, bit, mass, name });
    }

    constructor(world, people, key, anatomy, { at, yaw, bit, mass, name }) {
        this.world = world;
        this.name = name;
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
            if (p.under) return;
            new BABYLON.SubMesh(i, p.vertexStart, p.vertexCount, p.indexStart, p.indexCount, p.worn ? this.clothes : person.mesh);
        });
        const { arrays } = people.bodies.get(key);
        this._restPos = arrays.position;
        this._uv = arrays.uv;

        this.clock = Math.random() * 10;
        this.flinch = {};
        this.legGone = false;
        this.coughsBlood = false;
        this.down = false;
        this.grabbed = false;
        this._skinned = null;
        this._skinnedAt = -1;
        this._cough = 2;
        person.apply(P.stand(this.clock));
        this.ragdoll = new Ragdoll(person, { mass, bit });
        this.insides = new Insides(person, anatomy);
        this.insides.build(world.scene);
        this.vitals = new Vitals(mass);
        this.vitals.onBeat = () => this._beat();
        this.marks = new Marks(world.scene, this);
        for (const m of [person.mesh, this.clothes]) world.shadows?.addShadowCaster(m);
    }

    get dead() { return this.vitals.dead; }

    // --- what a line through them meets ------------------------------------------------

    // The skin and clothes crossed by the line from `origin` along unit `dir`, nearer than `far`, in order:
    // [{ t, kind: 'skin' | 'cloth', point, normal, uv, rest, restNormal, owner, scale }].
    surface(origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number) {
        const skinned = this._skin();
        const inv = this.person.mesh.getWorldMatrix().clone().invert();
        const o = V3.TransformCoordinates(origin, inv), d = V3.TransformNormal(dir, inv).normalize();
        const scale = V3.TransformNormal(dir, inv).length();
        const hits = [];
        const index = this.person.header.indexArray ?? this._indices();
        for (const p of this.person.header.parts) {
            // (The skin under the clothes is not drawn but is still where the body begins.)
            const kind = p.kind === 'skin' ? 'skin' : p.kind === 'cloth' ? 'cloth' : null;
            if (!kind) continue;
            if (!slabFor(p, skinned, o, d, far * scale)) continue;
            for (let i = p.indexStart; i < p.indexStart + p.indexCount; i += 3) {
                const t = triangle(o, d, skinned, index, i);
                if (t > 0 && t < far * scale) hits.push({ t: t / scale, i, kind });
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
        const restNormal = V3.Cross(rb.subtract(ra), rc.subtract(ra)).normalize();
        return { t: h.t, kind: h.kind, point, normal, uv, rest, restNormal, owner: this._owner(a), scale: Math.sqrt(areaUv / Math.max(1e-10, area3)) };
    }

    // The bone that carries most of corner `v`.
    _owner(v) {
        const { arrays } = this.person.lib.bodies.get(this.person.bodyName);
        let best = 0, bone = 0;
        for (let k = 0; k < 4; k++) if (arrays.weights[v * 4 + k] > best) { best = arrays.weights[v * 4 + k]; bone = arrays.joints[v * 4 + k]; }
        return this.person.byName[this.person.header.bones[bone].name];
    }

    // Where a point of the body at rest (on bone `owner`) is in the world now, and a direction there.
    worldOf(rest: BABYLON.Vector3, owner, normal: BABYLON.Vector3 | null = null) {
        const m = BABYLON.Matrix.Translation(-owner.head.x, -owner.head.y, -owner.head.z).multiply(owner.bone.getAbsoluteMatrix()).multiply(this.person.mesh.getWorldMatrix());
        return { at: V3.TransformCoordinates(rest, m), normal: normal ? V3.TransformNormal(normal, m).normalize() : null };
    }

    // --- being hurt -----------------------------------------------------------------------

    // A push of `impulse` (N s) at `point`; `jolt` how much a standing person flinches from it (0 to 1).
    hit(point: BABYLON.Vector3, impulse: BABYLON.Vector3, jolt = 1) {
        const { seg } = this.ragdoll.nearest(point);
        if (!this.ragdoll.limp && impulse.length() > TOPPLE) this.knockDown();
        if (this.ragdoll.limp) { this.ragdoll.push(seg.name, impulse, point); return; }
        // Standing: the body gives the way it was pushed, and comes back.
        const local = V3.TransformNormal(impulse, this.person.root.getWorldMatrix().clone().invert());
        const k = Math.min(1, impulse.length() / TOPPLE) * (0.4 + jolt);
        this.flinch.spineFlex = (this.flinch.spineFlex ?? 0) + Math.sign(local.z || 1) * 22 * k;
        this.flinch.spineSide = (this.flinch.spineSide ?? 0) + -Math.sign(local.x || 1) * 14 * k;
        this.flinch.spineTwist = (this.flinch.spineTwist ?? 0) + (Math.random() - 0.5) * 20 * k;
        if (seg?.name === 'head') this.flinch.headFlex = (this.flinch.headFlex ?? 0) - 25 * k;
        this.world.sound?.shot('bullet-flesh', { at: point.asArray(), gain: 0.7 });
    }

    // Blood thrown out where a shot went in and, more of it, where it came out.
    spatter(enter, dir, exitAt, m, exited) {
        const blood = this.world.blood;
        const power = Math.min(1, m.energy / 2000);
        blood.spray(enter.point.add(enter.normal.scale(0.01)), enter.normal.add(dir.scale(-0.4)).normalize(), 1.5 + power * 3, 2 + power * 10, 0.35);
        if (exited && exitAt) blood.spray(exitAt, dir, 3 + power * 9, 8 + power * 60, 0.3 + power * 0.2, 1 + power);
    }

    crack() { this.world.sound?.shot('crack', { at: this.ragdoll.centre.asArray() }); }

    broke(segment) { this.world.onBroke?.(this, segment); }

    knockDown() {
        if (this.ragdoll.limp) return;
        this.ragdoll.fall(this.world.dt || 1 / 60);
        this.down = true;
        setTimeout(() => this.world.sound?.shot('body-fall', { at: this.ragdoll.centre.asArray() }), 550);
    }

    // On every heartbeat: arteries open to the air spurt.
    _beat() {
        const v = this.vitals;
        for (const b of v.bleeds) {
            if (!b.spurts || b.internal || b.rate < 0.002 || !b.source?.mark) continue;
            const { at, normal } = this.worldOf(b.source.mark.rest, b.source.mark.owner, b.source.mark.restNormal);
            const perBeat = b.rate * (v.map / 93) * (60 / Math.max(30, v.hr)) * 1000;
            this.world.blood.spray(at.add(normal.scale(0.004)), normal, 1 + 3.5 * Math.sqrt(Math.max(0, v.map) / 93), perBeat, 0.12, 1.3);
        }
    }

    // --- every frame ----------------------------------------------------------------------

    update(dt: number) {
        const v = this.vitals;
        v.update(dt);
        const conscious = v.conscious;
        if (!this.ragdoll.limp && (conscious < 0.35 || v.dead || this.legGone || v.paralysed.legs || !v.beating || this.grabbed)) this.knockDown();
        const person = this.person;
        if (this.ragdoll.limp) {
            this.ragdoll.setTone(v.dead || !v.beating ? 'dead' : conscious < 0.35 ? 'out' : 'alive');
            this.ragdoll.drive();
        } else {
            this.clock += dt;
            for (const k of Object.keys(this.flinch)) this.flinch[k] *= Math.exp(-RECOVER * dt);
            const pose = P.stand(this.clock, { breathe: 1 + v.lost * 3 });
            for (const [k, a] of Object.entries(this.flinch)) pose[k] = (pose[k] || 0) + a;
            // Somebody hurt holds themselves bent over it.
            pose.spineFlex = (pose.spineFlex || 0) + v.pain * 14;
            person.look = this.world.camera.position;
            person.lookWeight = conscious * 0.8;
            person.apply(pose);
            this.ragdoll.pose();
        }
        // Eyes: open and blinking while awake, half shut out cold, still once dead.
        person.blinks = conscious > 0.35;
        if (!person.blinks) person.blink = v.dead ? 0.35 : 0.75;
        person.tick(dt);
        if (!this.ragdoll.limp) person._face();
        this._bleed(dt);
    }

    _bleed(dt) {
        const v = this.vitals, blood = this.world.blood;
        for (const b of v.bleeds) {
            if (!b.source?.mark) continue;
            const flow = b.rate * Math.max(0, v.map / 93) * (b.internal ? 0.08 : b.spurts ? 0.25 : 1);
            if (flow < 1e-6) continue;
            const { at, normal } = this.worldOf(b.source.mark.rest, b.source.mark.owner, b.source.mark.restNormal);
            blood.run(at.add(normal.scale(0.003)), flow, dt, normal.add(new V3(0, -1, 0)).normalize());
            this.marks.soak(b, flow * dt);
        }
        if (this.coughsBlood && v.breathing && v.beating && (this._cough -= dt) < 0) {
            this._cough = 2 + Math.random() * 4;
            const head = this.person.joint('head', 'head');
            const fwd = this.ragdoll.byName.get('head').node.getDirection(new V3(0, 0, 1));
            blood.spray(head.add(fwd.scale(0.1)).add(new V3(0, 0.02, 0)), fwd.add(new V3(0, -0.2, 0)).normalize(), 1.6, 4, 0.3);
        }
    }

    dispose() {
        this.ragdoll.dispose();
        this.insides.dispose();
        this.marks.dispose();
        this.clothes.dispose();
        this.person.dispose();
    }
}

// Whether the line meets part `p`'s corners' box at all (skinned corners, so the box is made fresh: cheap next to the
// triangles it saves).
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
