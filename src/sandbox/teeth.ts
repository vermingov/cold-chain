// A person's teeth, one by one: knocked loose, chipped, broken off or out by
// blows and bullets to the mouth.
//
// The teeth are one part of the person's mesh, but each tooth in it is a run
// of triangles of its own, not joined to the rest: each is given a submesh of
// its own, so one can be taken out without touching the others. A tooth that
// breaks leaves a stump (its own corners, the crown cut off flat at the break,
// drawn in its place) and its lost piece falls from the mouth as a small
// physical thing; one knocked out falls whole, and the socket bleeds.
//
// A tooth gives at a few hundred newtons, the front ones first (estimates:
// laboratory crown fractures of extracted incisors run 0.4 to 1 kN, molars
// more). With the mouth shut the lips and the bite take the blow and send it
// through the jaw, and only the front teeth can be reached; open, the front
// teeth meet it bare and twice as easily, and are the ones knocked out.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

type Tooth = { name: string; upper: boolean; at: number; count: number; v0: number; v1: number; owner: any; strength: number; front: boolean;
    state: 'whole' | 'loose' | 'chipped' | 'broken' | 'out'; stump: BABYLON.Mesh | null };

const KINDS = ['central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar'];
const STRENGTH = [450, 500, 700, 800, 800, 1000, 1000, 1000];     // N, by place in the row from the middle
const MOST_DEBRIS = 24;

export class Teeth {
    declare npc: any;
    declare teeth: Tooth[];
    declare part: number;
    declare debris: { mesh: BABYLON.Mesh; agg: BABYLON.PhysicsAggregate }[];
    declare gums: { at: number; count: number }[];
    declare subs: BABYLON.SubMesh[];
    declare range: [number, number];

    constructor(npc) {
        this.npc = npc;
        this.debris = [];
        const { person } = npc, parts = person.header.parts;
        this.part = parts.findIndex((p) => p.kind === 'teeth');
        this.teeth = [];
        if (this.part < 0) return;
        const p = parts[this.part], { arrays } = person.lib.bodies.get(person.bodyName), index = arrays.index;
        // Each run of triangles its own submesh: the gums and palate (big runs, one or several) drawn as they were, and
        // the teeth (runs under a centimetre and a half across) each to be taken out alone.
        const pos = arrays.position;
        const runs = this._runs(index, p.indexStart, p.indexCount).map((r) => {
            let v0 = Infinity, v1 = -1;
            for (let i = r.at; i < r.at + r.count; i++) { v0 = Math.min(v0, index[i]); v1 = Math.max(v1, index[i]); }
            const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity), centre = new V3();
            for (let v = v0; v <= v1; v++) {
                const q = new V3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
                lo.minimizeInPlace(q); hi.maximizeInPlace(q); centre.addInPlace(q);
            }
            const size = hi.subtract(lo);
            return { ...r, v0, v1, centre: centre.scaleInPlace(1 / (v1 - v0 + 1)), tooth: Math.max(size.x, size.y, size.z) < 0.015 };
        });
        this.subs = person.mesh.subMeshes.filter((s) => s.indexStart === p.indexStart);
        this.gums = runs.filter((r) => !r.tooth);
        this.range = [p.vertexStart, p.vertexCount];
        const found = runs.filter((r) => r.tooth).map((r) => {
            const owner = npc._owner(r.v0);
            return { ...r, owner, upper: owner.bone.name !== 'jaw' };
        });
        // Named by their place in the row: in each quarter of the mouth, from the middle at the front backward.
        for (const upper of [true, false]) for (const side of [-1, 1]) {
            const row = found.filter((t) => t.upper === upper && Math.sign(t.centre.x || 1e-9) === side).sort((a, b) => b.centre.z - a.centre.z);
            row.forEach((t, k) => {
                const name = `${upper ? 'upper' : 'lower'} ${side < 0 ? 'left' : 'right'} ${KINDS[Math.min(k, KINDS.length - 1)]}`;
                this.teeth.push({ name, upper, at: t.at, count: t.count, v0: t.v0, v1: t.v1, owner: t.owner, strength: STRENGTH[Math.min(k, STRENGTH.length - 1)],
                    front: k < 3, state: 'whole', stump: null });
            });
        }
    }

    // The teeth part drawn again as the gums and the teeth still standing whole: runs next to each other in the index
    // one submesh, so a full mouth is still one draw.
    _draw() {
        const mesh = this.npc.person.mesh;
        for (const s of this.subs) s.dispose();
        const runs = [...this.gums, ...this.teeth.filter((t) => t.state === 'whole' || t.state === 'loose')].sort((a, b) => a.at - b.at);
        const spans: [number, number][] = [];
        for (const r of runs) {
            const last = spans[spans.length - 1];
            if (last && last[0] + last[1] === r.at) last[1] += r.count;
            else spans.push([r.at, r.count]);
        }
        this.subs = spans.map(([at, count]) => new BABYLON.SubMesh(this.part, this.range[0], this.range[1], at, count, mesh));
    }

    // The runs of triangles (offsets into `index`) in [start, start + count) that share no corner with each other.
    _runs(index, start: number, count: number) {
        const parent = new Map<number, number>();
        const find = (a: number) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
        for (let i = start; i < start + count; i++) if (!parent.has(index[i])) parent.set(index[i], index[i]);
        for (let i = start; i < start + count; i += 3) {
            const a = find(index[i]);
            parent.set(find(index[i + 1]), a);
            parent.set(find(index[i + 2]), a);
        }
        const runs = new Map<number, { at: number; count: number }>();
        for (let i = start; i < start + count; i += 3) {
            const root = find(index[i]);
            const run = runs.get(root);
            if (run) run.count += 3;
            else runs.set(root, { at: i, count: 3 });
        }
        return [...runs.values()];
    }

    // Where a tooth is now, in the world: the middle of its corners as the skin is posed this frame.
    _where(t: Tooth) {
        const skinned = this.npc._skin(), world = this.npc.person.mesh.getWorldMatrix(), c = new V3();
        for (let v = t.v0; v <= t.v1; v += 4) c.addInPlace(new V3(skinned[v * 3], skinned[v * 3 + 1], skinned[v * 3 + 2]));
        return V3.TransformCoordinates(c.scaleInPlace(1 / Math.ceil((t.v1 - t.v0 + 1) / 4)), world);
    }

    // A blow of `force` N along `dir` over `radius` m round the line through `point`: the teeth in its way share it.
    // `open` whether the mouth was open. Returns whether it reached any.
    blow(point: BABYLON.Vector3, dir: BABYLON.Vector3, force: number, radius: number, open: boolean) {
        const hit = this.teeth.filter((t) => {
            if (t.state === 'out' || (!open && !t.front)) return false;
            const c = this._where(t), q = c.subtract(point), along = V3.Dot(q, dir);
            return along > -0.04 && along < 0.05 && q.subtract(dir.scale(along)).length() < radius;
        });
        // The teeth nearest the line through the blow take most of it.
        const near = (t) => { const q = this._where(t).subtract(point); return Math.max(0.05, 1 - q.subtract(dir.scale(V3.Dot(q, dir))).length() / radius); };
        const total = hit.reduce((s, t) => s + near(t), 0);
        for (const t of hit) {
            const ratio = (force * near(t)) / total / (t.strength * (open ? 1 : 1.5) * (0.85 + Math.random() * 0.3));
            if (ratio < 0.5) continue;
            this._give(t, ratio > 1.6 || (open && ratio > 1.2 && t.front) ? 'out' : ratio > 1.25 ? 'broken' : ratio > 1 ? 'chipped' : 'loose', dir);
        }
        return hit.length > 0;
    }

    // A bullet along the line from `origin` along `dir`, as far as `far`: the teeth within its width of the line burst.
    shot(origin: BABYLON.Vector3, dir: BABYLON.Vector3, far: number) {
        for (const t of this.teeth) {
            if (t.state === 'out') continue;
            const q = this._where(t).subtract(origin), along = V3.Dot(q, dir);
            if (along > 0 && along < far && q.subtract(dir.scale(along)).length() < 0.005) this._give(t, 'out', dir, 3);
        }
    }

    // Every tooth of the upper (or lower) row loosened in its socket: the jaw they stand in is broken.
    loosen(upper: boolean) {
        let any = false;
        for (const t of this.teeth) if (t.upper === upper && t.state === 'whole') { t.state = 'loose'; any = true; }
        if (any) this.npc.vitals.injure(`${upper ? 'Upper' : 'Lower'} teeth loose in the broken jaw`, 3);
    }

    get lost() { return this.teeth.filter((t) => t.state === 'out' || t.state === 'broken').length; }

    // Tooth `t` given way as `how`: loosened, chipped (the edge off), broken (the crown off at the gum) or out (all of
    // it, root and all); `pieces` how many bits it goes in when a bullet bursts it.
    _give(t: Tooth, how: Tooth['state'], dir: BABYLON.Vector3, pieces = 1) {
        const order = ['whole', 'loose', 'chipped', 'broken', 'out'];
        if (order.indexOf(how) <= order.indexOf(t.state)) return;
        const v = this.npc.vitals, where = this._where(t);
        t.state = how;
        if (how === 'loose') {
            v.injure(`${cap(t.name)} knocked loose`, 1);
            return;
        }
        // What is lost: the crown's edge, the crown down to the gum, or the whole tooth.
        const keep = how === 'chipped' ? 0.8 : how === 'broken' ? 0.45 : 0;
        this._draw();
        t.stump?.dispose();
        t.stump = keep ? this._stump(t, keep) : null;
        for (let k = 0; k < pieces; k++) this._fall(t, keep, dir, where, pieces > 1 ? 0.45 : 1);
        v.pain = Math.min(1, v.pain + (how === 'chipped' ? 0.08 : 0.18));
        v.injure(`${cap(t.name)} ${how === 'chipped' ? 'chipped' : how === 'broken' ? 'broken off at the gum' : 'knocked out'}`, how === 'chipped' ? 1 : 2);
        // The pulp or the socket bleeds into the mouth, and out over the lips.
        const lips = this._lips(where);
        this.npc.world.blood?.spray(where.add(this._outward().scale(0.02)), this._outward().add(dir.scale(0.5)).normalize(), 1.2, how === 'out' ? 1.5 : 0.6, 0.5);
        v.bleed({ name: `${t.name} socket`, rate: how === 'out' ? 0.0002 : 0.00006, clots: 0.01, source: lips ? { mark: lips } : undefined });
    }

    // Which way the mouth faces, in the world.
    _outward() { return this.npc.ragdoll.byName.get('head').node.getDirection(V3.Forward()); }

    // The skin of the lips in front of a point in the mouth: where blood from it comes out.
    _lips(at: BABYLON.Vector3) {
        const out = this._outward();
        return this.npc.surface(at.add(out.scale(0.06)), out.scale(-1), 0.08).find((h) => h.kind === 'skin') ?? null;
    }

    // Along a tooth from its root (0) to its biting edge (1), at rest: upper teeth point down, lower ones up.
    _along(t: Tooth) {
        const pos = this.npc._restPos;
        let lo = Infinity, hi = -Infinity;
        for (let v = t.v0; v <= t.v1; v++) { lo = Math.min(lo, pos[v * 3 + 1]); hi = Math.max(hi, pos[v * 3 + 1]); }
        return (v: number) => (t.upper ? (hi - pos[v * 3 + 1]) / (hi - lo) : (pos[v * 3 + 1] - lo) / (hi - lo));
    }

    // What is left of tooth `t` with only `keep` of its height from the root: its corners past that pressed flat onto
    // it, drawn with the teeth's look, carried wholly by the bone the tooth stands in.
    _stump(t: Tooth, keep: number) {
        const { person } = this.npc, { arrays } = person.lib.bodies.get(person.bodyName);
        const pos = this.npc._restPos, along = this._along(t), index = arrays.index;
        const n = t.v1 - t.v0 + 1, out = new Float32Array(n * 3);
        let lo = Infinity, hi = -Infinity;
        for (let v = t.v0; v <= t.v1; v++) { lo = Math.min(lo, pos[v * 3 + 1]); hi = Math.max(hi, pos[v * 3 + 1]); }
        const cutY = t.upper ? hi - keep * (hi - lo) : lo + keep * (hi - lo);
        for (let v = t.v0, k = 0; v <= t.v1; v++, k++) {
            out[k * 3] = pos[v * 3];
            out[k * 3 + 1] = along(v) > keep ? cutY : pos[v * 3 + 1];
            out[k * 3 + 2] = pos[v * 3 + 2];
        }
        const tris = Uint32Array.from({ length: t.count }, (_, i) => index[t.at + i] - t.v0);
        const vd = new BABYLON.VertexData();
        vd.positions = out;
        vd.indices = tris;
        vd.uvs = arrays.uv.slice(t.v0 * 2, (t.v1 + 1) * 2);
        const normals = [];
        BABYLON.VertexData.ComputeNormals(out, tris, normals);
        vd.normals = normals;
        vd.matricesIndices = new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? t.owner.index : 0));
        vd.matricesWeights = new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0));
        const mesh = new BABYLON.Mesh(`${person.mesh.name}_${t.name}`, this.npc.world.scene);
        vd.applyToMesh(mesh);
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
        mesh.skeleton = person.skeleton;
        mesh.numBoneInfluencers = 1;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.material = (person.mesh.material as BABYLON.MultiMaterial).subMaterials[this.part];
        return mesh;
    }

    // The lost piece of tooth `t` (past `keep` of its height, or all of it), or a bit of it `scale` its size, thrown out
    // of the mouth from `where` along `dir` and left to fall where it falls.
    _fall(t: Tooth, keep: number, dir: BABYLON.Vector3, where: BABYLON.Vector3, scale: number) {
        const { person } = this.npc, scene = this.npc.world.scene, { arrays } = person.lib.bodies.get(person.bodyName);
        const skinned = this.npc._skin(), world = person.mesh.getWorldMatrix(), along = this._along(t), index = arrays.index;
        const corners: number[] = [], uvs: number[] = [], tris: number[] = [], map = new Map<number, number>();
        for (let i = t.at; i < t.at + t.count; i += 3) {
            if ([0, 1, 2].every((j) => along(index[i + j]) < keep)) continue;
            for (let j = 0; j < 3; j++) {
                const v = index[i + j];
                if (!map.has(v)) {
                    map.set(v, corners.length / 3);
                    const p = V3.TransformCoordinates(new V3(skinned[v * 3], skinned[v * 3 + 1], skinned[v * 3 + 2]), world).subtractInPlace(where).scaleInPlace(scale);
                    corners.push(p.x, p.y, p.z);
                    uvs.push(arrays.uv[v * 2], arrays.uv[v * 2 + 1]);     // (the teeth's look takes its see-through from its picture)
                }
                tris.push(map.get(v));
            }
        }
        if (!tris.length) return;
        const mesh = new BABYLON.Mesh(`${t.name} piece`, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = corners;
        vd.uvs = uvs;
        vd.indices = tris;
        const normals = [];
        BABYLON.VertexData.ComputeNormals(corners, tris, normals);
        vd.normals = normals;
        vd.applyToMesh(mesh);
        mesh.material = (person.mesh.material as BABYLON.MultiMaterial).subMaterials[this.part];
        mesh.position.copyFrom(where.add(this._outward().scale(0.03)));
        const agg = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.SPHERE, { mass: 0.002 * scale, radius: 0.004 * scale, friction: 0.6, restitution: 0.35 }, scene);
        // Only the room stops it: thrown out of the mouth, it is past the person's own body.
        agg.shape.filterMembershipMask = 1;
        agg.shape.filterCollideMask = 1;
        agg.body.setLinearVelocity(this._outward().scale(0.3 + 0.5 * Math.random()).add(dir.scale(0.5 * Math.random())).add(new V3((Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4)));
        agg.body.setAngularVelocity(new V3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10));
        // (Its collider is a ball; a tooth is anything but, and tumbles to a stop instead of rolling away.)
        agg.body.setAngularDamping(6);
        agg.body.setLinearDamping(1.5);
        this.npc.world.shadows?.addShadowCaster(mesh);
        this.debris.push({ mesh, agg });
        if (this.debris.length > MOST_DEBRIS) { const old = this.debris.shift(); old.agg.dispose(); old.mesh.dispose(); }
    }

    dispose() {
        for (const t of this.teeth) t.stump?.dispose();
        for (const d of this.debris) { d.agg.dispose(); d.mesh.dispose(); }
    }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
