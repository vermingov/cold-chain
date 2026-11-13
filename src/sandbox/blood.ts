// Blood out of a body: drops and streams in the air, and what they leave
// where they land.
//
// A drop is a point with a speed and a size, falling under gravity and
// slowed by the air as much as its size makes it (a tenth of a millimetre of
// mist stops within a hand's breadth; a dripped drop falls nearly freely),
// drawn as a bead stretched along the way it is going. An open artery throws
// a stream: a rope of blood leaving the wound as fast as the pressure behind
// it pushes it (Bernoulli), surging with each beat, arcing under gravity, and
// breaking into drops some way out as streams do (Plateau-Rayleigh).
//
// Where a drop lands it leaves a stain as wide as its speed and size spread
// it, round if it came straight down and long (width over length the sine
// of the angle it came in at) if it came slantwise, its rim thrown out into
// spines and droplets if it came hard. Big drops on a wall run down it. On
// the floor, blood gathers into pools (floor.ts); on a person, it soaks into
// their clothes (soak.ts) or lies on and runs down their skin (film.ts,
// runs.ts). Bodies lying in a pool take it up; a body dragged leaves a
// smear; a foot that stepped in it leaves prints, fewer and fainter as it
// goes.

import * as BABYLON from '@babylonjs/core';
import { Floor } from './floor.ts';
import { DRIP, across, drag, noise2, spreads, splashes, volume } from './fluid.ts';
const V3 = BABYLON.Vector3, M = BABYLON.Matrix;

const MOST = 3000;          // drops in the air at once
const SPLATS = 8000;        // marks on the room before the oldest go
const TILES = [4, 5];       // the splash sheet: columns, rows
const DRIES = 300;          // seconds for a stain on concrete to go from wet red to dried brown
const WET = [1, 1, 1], DRY = [0.42, 0.3, 0.26];
const FREE = 0.12;          // seconds a drop flies before it can land back on a body (it left from one)
const BREAKS = 0.25;        // seconds a stream holds together before it breaks into drops
const GATHERS = 0.12;       // ml of drops landing in one place before they count as a pool there

const TMP = [new V3()];

type Stream = { p: BABYLON.Vector3[]; v: BABYLON.Vector3[]; ml: number[]; d: number[]; age: number[]; life: number[]; fed: number };

export class Blood {
    declare scene: BABYLON.Scene;
    declare room: { x: number; z: number; height: number };
    declare floor: Floor;
    declare n: number;
    declare p: Float32Array;
    declare v: Float32Array;
    declare d: Float32Array;
    declare ml: Float32Array;
    declare age: Float32Array;
    declare drop: BABYLON.Mesh;
    declare dropMatrices: Float32Array;
    declare rope: BABYLON.Mesh;
    declare ropeMatrices: Float32Array;
    declare beads: BABYLON.Mesh;
    declare beadMatrices: Float32Array;
    declare beadCount: number;
    declare streams: Map<any, Stream>;
    declare marks: BABYLON.Mesh[];
    declare markCount: number[];
    declare markNext: number[];
    declare markColours: Float32Array[];
    declare markMatrices: Float32Array[];
    declare markChanged: Map<number, number[]>;
    declare dried: number;
    declare crowd: Map<any, any>;
    declare markBorn: Float32Array[];
    declare wallRuns: { kind: number; slot: number; at: BABYLON.Vector3; normal: BABYLON.Vector3; wide: number; length: number; reach: number }[];
    declare gathering: Map<number, number>;
    declare wetSince: Map<number, number>;
    declare onLand: ((at: BABYLON.Vector3, speed: number) => void) | null;
    declare bodies: (() => any[]) | null;
    declare clock: number;
    declare touched: number;
    declare foot: { x: number; z: number; carried: number; walked: number; left: boolean } | null;
    declare contact: WeakMap<any, BABYLON.Vector3>;
    declare looks: number;
    declare lain: WeakMap<any, { hit: any; at: BABYLON.Vector3 }>;
    declare map: { ground(x: number, z: number, below?: number): number; land(at: BABYLON.Vector3, vel: BABYLON.Vector3): BABYLON.Vector3 | null } | null;
    declare tops: Map<number, number>;

    // `room` is the half-width and half-depth of the floor and the height of its walls; `reflect` what wet blood shows.
    constructor(scene, room, reflect = null) {
        this.scene = scene;
        this.room = room;
        this.floor = new Floor(scene, Math.max(room.x, room.z), reflect);
        this.n = 0;
        this.p = new Float32Array(MOST * 3);
        this.v = new Float32Array(MOST * 3);
        this.d = new Float32Array(MOST);
        this.ml = new Float32Array(MOST);
        this.age = new Float32Array(MOST);
        this.onLand = null;
        this.bodies = null;
        this.clock = 0;
        this.touched = 0;
        this.foot = null;
        this.contact = new WeakMap();
        this.streams = new Map();
        this.gathering = new Map();
        this.wetSince = new Map();
        this.wallRuns = [];
        this.map = null;
        this.tops = new Map();

        const wet = (name, texture) => {
            const m = new BABYLON.PBRMaterial(name, scene);
            m.albedoColor = new BABYLON.Color3(0.2, 0.011, 0.009);
            m.metallic = 0;
            m.roughness = 0.1;
            m.reflectionTexture = reflect;
            m.environmentIntensity = 0.6;
            if (texture) {
                m.albedoTexture = texture;
                m.useAlphaFromAlbedoTexture = true;
                m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
                m.zOffset = -2;
                m.backFaceCulling = false;
                // Where the card is clear there is no blood, and nothing to catch the lamp.
                m.useSpecularOverAlpha = false;
                m.useRadianceOverAlpha = false;
            }
            return m;
        };
        // Blood in the air, and beads of it on skin: a deep red that shines.
        const air = wet('dropBlood', null);
        air.albedoColor = new BABYLON.Color3(0.16, 0.007, 0.006);
        air.roughness = 0.06;
        const instanced = (mesh: BABYLON.Mesh, most: number) => {
            mesh.material = air;
            mesh.isPickable = false;
            const matrices = new Float32Array(most * 16);
            mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
            mesh.thinInstanceCount = 0;
            mesh.alwaysSelectAsActiveMesh = true;
            // (A mesh with no instances is still drawn once, at the origin.)
            mesh.isVisible = false;
            return matrices;
        };
        this.drop = BABYLON.MeshBuilder.CreateSphere('drop', { segments: 4, diameter: 1 }, scene);
        this.dropMatrices = instanced(this.drop, MOST);
        this.rope = BABYLON.MeshBuilder.CreateCylinder('stream', { height: 1, diameter: 1, tessellation: 7 }, scene);
        this.ropeMatrices = instanced(this.rope, 600);
        this.beads = BABYLON.MeshBuilder.CreateSphere('bead', { segments: 6, diameter: 1 }, scene);
        this.beadMatrices = instanced(this.beads, 400);
        this.beadCount = 0;

        const sheet = splashSheet(scene);
        const material = wet('splatBlood', sheet);
        // (The sheet carries the blood's own colour, thin and deep.)
        material.albedoColor = BABYLON.Color3.White();
        this.marks = [];
        this.markCount = [];
        this.markNext = [];
        this.markColours = [];
        this.markMatrices = [];
        this.markChanged = new Map();
        this.dried = 0;
        this.crowd = new Map();
        this.lain = new WeakMap();
        this.markBorn = [];
        const [cols, rows] = TILES;
        for (let k = 0; k < cols * rows; k++) {
            // One face, seen from both sides (the material does not cull): a second face for the back got the whole sheet
            // as its picture, which lay under every mark as a grid of dark specks and dashes.
            const quad = BABYLON.MeshBuilder.CreatePlane('splat' + k, { size: 1 }, scene);
            const [u0, v0, u1, v1] = tile(k);
            quad.setVerticesData(BABYLON.VertexBuffer.UVKind, quad.getVerticesData(BABYLON.VertexBuffer.UVKind).map((t, i) => (i % 2 ? v0 + (v1 - v0) * t : u0 + (u1 - u0) * t)));
            quad.material = material;
            quad.isPickable = false;
            quad.alwaysSelectAsActiveMesh = true;
            quad.receiveShadows = true;
            const matrices = new Float32Array((SPLATS / (cols * rows)) * 16);
            quad.thinInstanceSetBuffer('matrix', matrices, 16, false);
            // (Drawn whatever the camera sees, so its bounds need not follow its marks.)
            quad.doNotSyncBoundingInfo = true;
            this.markMatrices.push(matrices);
            // Each mark's colour, which goes from wet to dry as it ages.
            const colours = new Float32Array((SPLATS / (cols * rows)) * 4).fill(1);
            quad.thinInstanceSetBuffer('color', colours, 4, false);
            this.markColours.push(colours);
            this.markBorn.push(new Float32Array(SPLATS / (cols * rows)));
            quad.thinInstanceCount = 0;
            quad.isVisible = false;
            this.marks.push(quad);
            this.markCount.push(0);
            this.markNext.push(0);
        }
    }

    // --- blood into the air ---------------------------------------------------------------

    // Drops thrown out from `at` along `dir` (unit) at about `speed` m/s, spread by `cone` (radians); `ml` the blood in
    // all; `big` the drops' size against a spatter drop's 1.6 mm (0.3 is a gunshot's mist). Drops come in all sizes
    // about that (log-normally); there are as many as the blood makes, each drawn drop standing for several if there are
    // too many to draw.
    spray(at: BABYLON.Vector3, dir: BABYLON.Vector3, speed: number, ml: number, cone = 0.25, big = 1) {
        const median = 0.0016 * big;
        const count = Math.max(1, Math.min(150, Math.round(ml / volume(median * 1.4))));
        const each = ml / count;
        const side = Math.abs(dir.y) < 0.9 ? V3.Cross(dir, V3.Up()).normalize() : V3.Cross(dir, V3.Right()).normalize();
        const up = V3.Cross(side, dir);
        for (let k = 0; k < count && this.n < MOST; k++) {
            // Smaller drops are thrown faster and wider; within the cone, most go near its middle.
            const d = median * Math.exp(gauss() * 0.45);
            const s = speed * (0.6 + Math.random() * 0.6) * Math.pow(median / d, 0.25);
            const a = cone * Math.sqrt(Math.random()) * Math.pow(median / d, 0.3), t = Math.random() * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            this._add(at.x, at.y, at.z,
                (dir.x * ca + (side.x * Math.cos(t) + up.x * Math.sin(t)) * sa) * s,
                (dir.y * ca + (side.y * Math.cos(t) + up.y * Math.sin(t)) * sa) * s,
                (dir.z * ca + (side.z * Math.cos(t) + up.z * Math.sin(t)) * sa) * s, d, each, 0);
        }
    }

    // One drop of `ml`, `d` across, let go at `at`: what falls from a chin, a cuff, a shirt-tail.
    drip(at: BABYLON.Vector3, ml: number, d = across(ml)) {
        this._add(at.x, at.y, at.z, (Math.random() - 0.5) * 0.02, -0.05, (Math.random() - 0.5) * 0.02, d, ml, FREE);
    }

    _add(x, y, z, vx, vy, vz, d, ml, age) {
        if (this.n >= MOST) return;
        const i = this.n++;
        this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
        this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
        this.d[i] = d;
        this.ml[i] = ml;
        this.age[i] = age;
    }

    // An open artery this frame: `ml` of blood leaving `at` along `dir` at `speed` m/s, as a stream `r` metres across.
    // `key` is the bleed, so that one stream is one rope from beat to beat.
    stream(key, at: BABYLON.Vector3, dir: BABYLON.Vector3, speed: number, ml: number, r: number, dt: number) {
        let s = this.streams.get(key);
        if (!s) { s = { p: [], v: [], ml: [], d: [], age: [], life: [], fed: 0 }; this.streams.set(key, s); }
        s.fed = this.clock;
        // Several points a frame, as if let go through it, so the rope is smooth however slow the frame.
        const pieces = Math.max(1, Math.min(6, Math.ceil((speed * dt) / 0.012)));
        for (let k = pieces - 1; k >= 0 && s.p.length < 90; k--) {
            const t = (k / pieces) * dt;
            const v = dir.scale(speed);
            s.p.push(at.add(v.scale(t)).addInPlaceFromFloats(0, -4.9 * t * t, 0));
            s.v.push(v.addInPlaceFromFloats(0, -9.81 * t, 0));
            s.ml.push(ml / pieces);
            s.d.push(r * 2);
            s.age.push(t);
            // Thicker streams hold together longer.
            s.life.push(BREAKS * (0.6 + Math.random() * 0.8) * Math.min(2, Math.max(0.5, (r / 0.0015) ** 1.5)));
        }
    }

    // --- blood onto the floor -------------------------------------------------------------

    // Blood leaving a wound at `at` at `rate` litres a second for `dt`, with nothing on the body to take it: it falls
    // from there, or goes into the floor if it is at the floor.
    run(at: BABYLON.Vector3, rate: number, dt: number, normal: BABYLON.Vector3 | null = null) {
        const ml = rate * dt * 1000;
        if (ml <= 0) return;
        if (at.y < 0.04) { this.floor.add(at.x, at.z, ml); return; }
        void normal;
        // What runs off something gathers into drops and falls one at a time.
        const key = Math.round(at.x * 50) * 7919 + Math.round(at.z * 50);
        const have = (this.gathering.get(-key) ?? 0) + ml;
        if (have >= DRIP) { this.drip(at, have); this.gathering.delete(-key); } else this.gathering.set(-key, have);
    }

    // A pool on the floor under `at` takes `litres` more.
    fill(at: BABYLON.Vector3, litres: number) { this.floor.add(at.x, at.z, litres * 1000); }

    // --- every frame ----------------------------------------------------------------------

    update(dt: number) {
        this.clock += dt;
        this._dry();
        const lying = (this.touched += dt) > 0.15;
        // (Nothing in the air and nobody to check for lying in blood: nobody's whereabouts are needed.)
        const people = this.n || this.streams.size || lying ? this._people() : [];
        if (this.n) this._fly(dt, people);
        if (this.streams.size) this._streams(dt, people);
        this._wallRuns(dt);
        this.floor.update(dt);
        if (lying) {
            this._lying(people, this.touched);
            this.touched = 0;
        }
        this._feet();
        // The marks made or changed this frame go to the card together, only the stretch of each buffer that changed.
        for (const [kind, [lo, hi]] of this.markChanged) {
            this.marks[kind].thinInstancePartialBufferUpdate('matrix', hi - lo + 1, lo);
            this.marks[kind].thinInstancePartialBufferUpdate('color', hi - lo + 1, lo);
        }
        this.markChanged.clear();
        this.beads.thinInstanceCount = this.beadCount;
        this.beads.isVisible = this.beadCount > 0;
        if (this.beadCount) this.beads.thinInstanceBufferUpdated('matrix');
        this.beadCount = 0;
    }

    // Where each person is this frame: a box round them, so that only drops near somebody are tested against their body,
    // and each of their segments as a capsule: its start, its length along, how thick (eight numbers each, kept from frame
    // to frame).
    _people() {
        // Finding the place on a body a drop has reached is the dear part: at most so many a frame, the rest next frame.
        this.looks = 16;
        const out = [];
        for (const npc of this.bodies?.() ?? []) {
            const segs = npc.ragdoll.segments;
            let c = this.crowd.get(npc);
            if (!c || c.segs !== segs) { c = { npc, segs, caps: new Float32Array(segs.length * 8), lo: new V3(), hi: new V3() }; this.crowd.set(npc, c); }
            c.lo.setAll(Infinity); c.hi.setAll(-Infinity);
            const end = TMP[0];
            segs.forEach((seg, i) => {
                const a = seg.node.position;
                if (seg.end) V3.TransformCoordinatesToRef(seg.end, seg.node.getWorldMatrix(), end); else end.copyFrom(a);
                const k = i * 8, abx = end.x - a.x, aby = end.y - a.y, abz = end.z - a.z;
                c.caps[k] = a.x; c.caps[k + 1] = a.y; c.caps[k + 2] = a.z;
                c.caps[k + 3] = abx; c.caps[k + 4] = aby; c.caps[k + 5] = abz;
                c.caps[k + 6] = seg.radius ?? 0.05; c.caps[k + 7] = abx * abx + aby * aby + abz * abz || 1;
                c.lo.minimizeInPlace(a); c.hi.maximizeInPlace(a);
            });
            c.lo.subtractFromFloatsToRef(0.3, 0.3, 0.3, c.lo); c.hi.addInPlaceFromFloats(0.3, 0.3, 0.3);
            out.push(c);
        }
        for (const npc of this.crowd.keys()) if (!out.some((c) => c.npc === npc)) this.crowd.delete(npc);
        return out;
    }

    _fly(dt: number, people) {
        const { p, v, d, ml, age } = this;
        const m = new M(), at = new V3(), vel = new V3(), q = new BABYLON.Quaternion(), size = new V3();
        let live = 0;
        for (let i = 0; i < this.n; i++) {
            const speed0 = Math.sqrt(v[i * 3] * v[i * 3] + v[i * 3 + 1] * v[i * 3 + 1] + v[i * 3 + 2] * v[i * 3 + 2]);
            const slow = Math.exp(-drag(d[i], speed0) * dt);
            v[i * 3] *= slow; v[i * 3 + 1] = v[i * 3 + 1] * slow - 9.81 * dt; v[i * 3 + 2] *= slow;
            const x = p[i * 3] + v[i * 3] * dt, y = p[i * 3 + 1] + v[i * 3 + 1] * dt, z = p[i * 3 + 2] + v[i * 3 + 2] * dt;
            at.set(x, y, z);
            vel.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
            age[i] += dt;
            if (age[i] > FREE && people.length && this._onto(people, at, vel, d[i], ml[i])) continue;
            if (this._lands(at, vel, d[i], ml[i])) continue;
            // Kept: moved down to the next free place.
            p[live * 3] = x; p[live * 3 + 1] = y; p[live * 3 + 2] = z;
            v[live * 3] = vel.x; v[live * 3 + 1] = vel.y; v[live * 3 + 2] = vel.z;
            d[live] = d[i]; ml[live] = ml[i]; age[live] = age[i];
            // A drop drawn long along its way: as far as it moves in a sixtieth of a second, as the eye sees it.
            const speed = vel.length();
            const r = Math.max(d[i], 0.0006);
            BABYLON.Quaternion.FromUnitVectorsToRef(V3.UpReadOnly, speed > 1e-4 ? vel.scaleToRef(1 / speed, size) : V3.UpReadOnly, q);
            size.set(r, r + Math.min(0.08, speed / 60) * 0.5, r);
            M.ComposeToRef(size, q, at, m);
            m.copyToArray(this.dropMatrices, live * 16);
            live++;
        }
        this.n = live;
        this.drop.thinInstanceCount = live;
        this.drop.isVisible = live > 0;
        if (live) this.drop.thinInstanceBufferUpdated('matrix');
    }

    // Whether a drop at `at` has met the floor, a wall, the ceiling or something standing in the room (`map`); if it has,
    // what it leaves there.
    _lands(at: BABYLON.Vector3, vel: BABYLON.Vector3, d: number, ml: number) {
        const { x: W, z: D, height: H } = this.room;
        let normal = this.map?.land(at, vel) ?? null;
        if (normal) { /* on it already */ }
        else if (at.y <= 0) { normal = V3.UpReadOnly; at.y = 0; }
        else if (Math.abs(at.x) >= W) { normal = new V3(-Math.sign(at.x), 0, 0); at.x = Math.sign(at.x) * (W - 0.002); }
        else if (Math.abs(at.z) >= D) { normal = new V3(0, 0, -Math.sign(at.z)); at.z = Math.sign(at.z) * (D - 0.002); }
        else if (at.y >= H) { normal = V3.DownReadOnly; at.y = H - 0.002; }
        if (!normal) return false;
        this._splash(at, vel, normal, d, ml);
        return true;
    }

    // The streams: each point flies as a drop does; consecutive points still joined are drawn as one rope between them.
    _streams(dt: number, people) {
        const m = new M(), q = new BABYLON.Quaternion(), size = new V3(), mid = new V3(), way = new V3();
        let ropes = 0;
        for (const [key, s] of this.streams) {
            for (let i = 0; i < s.p.length; i++) {
                const v = s.v[i];
                const slow = Math.exp(-drag(s.d[i], v.length()) * dt * 0.3);
                v.scaleInPlace(slow).addInPlaceFromFloats(0, -9.81 * dt, 0);
                s.p[i].addInPlace(v.scale(dt));
                s.age[i] += dt;
            }
            // Points that broke away, or met something, leave the stream.
            const keep = (i) => {
                const at = s.p[i];
                if (s.age[i] > FREE && people.length && this._onto(people, at, s.v[i], s.d[i], s.ml[i])) return false;
                if (this._lands(at, s.v[i], s.d[i], s.ml[i])) return false;
                if (s.age[i] > s.life[i]) {
                    // Broken: the rope pinches into drops a little wider than itself.
                    this._add(at.x, at.y, at.z, s.v[i].x, s.v[i].y, s.v[i].z, Math.min(0.006, s.d[i] * 1.6), s.ml[i], s.age[i]);
                    return false;
                }
                return true;
            };
            const kept = { p: [], v: [], ml: [], d: [], age: [], life: [] };
            for (let i = 0; i < s.p.length; i++) {
                if (!keep(i)) continue;
                for (const k of ['p', 'v', 'ml', 'd', 'age', 'life']) kept[k].push(s[k][i]);
            }
            Object.assign(s, kept);
            for (let i = 0; i + 1 < s.p.length && ropes < 600; i++) {
                const a = s.p[i], b = s.p[i + 1];
                b.subtractToRef(a, way);
                const long = way.length();
                if (long > 0.05 || long < 1e-5) continue;
                way.scaleInPlace(1 / long);
                BABYLON.Quaternion.FromUnitVectorsToRef(V3.UpReadOnly, way, q);
                const r = (s.d[i] + s.d[i + 1]) * 0.5;
                size.set(r, long + r * 0.5, r);
                a.addToRef(b, mid).scaleInPlace(0.5);
                M.ComposeToRef(size, q, mid, m);
                m.copyToArray(this.ropeMatrices, ropes * 16);
                ropes++;
            }
            if (!s.p.length && this.clock - s.fed > 1) this.streams.delete(key);
        }
        this.rope.thinInstanceCount = ropes;
        this.rope.isVisible = ropes > 0;
        if (ropes) this.rope.thinInstanceBufferUpdated('matrix');
    }

    // A bead of blood on skin this frame (runs.ts): at `at`, the skin facing `normal`, `r` across and `h` high,
    // running along `along` (stretched that way a little), hanging (`hang`, a drop about to fall: drawn pulled down).
    bead(at: BABYLON.Vector3, normal: BABYLON.Vector3, along: BABYLON.Vector3, r: number, h: number, hang = 0) {
        if (this.beadCount >= 400) return;
        const across = V3.Cross(normal, along).normalize();
        const way = V3.Cross(across, normal).normalize();
        const centre = at.add(normal.scale(h * 0.25));
        if (hang) centre.addInPlaceFromFloats(0, -hang * 0.5, 0);
        // The bead's own axes: across it, out of the skin, along its way (a sphere squashed onto the skin).
        const out = hang ? normal.add(new V3(0, -hang / Math.max(h, 1e-4), 0)) : normal;
        const m = M.FromValues(
            across.x * r, across.y * r, across.z * r, 0,
            out.x * h, out.y * h, out.z * h, 0,
            way.x * r * 1.3, way.y * r * 1.3, way.z * r * 1.3, 0,
            centre.x, centre.y, centre.z, 1);
        m.copyToArray(this.beadMatrices, this.beadCount * 16);
        this.beadCount++;
    }

    // --- where it lands -------------------------------------------------------------------

    // The mark a drop `d` across leaves on the room: round if it came straight down, long and tailed the more slantwise
    // it came (width over length the sine of its angle), its rim broken into spines if it came hard enough.
    _splash(at: BABYLON.Vector3, vel: BABYLON.Vector3, normal: BABYLON.Vector3, d: number, ml: number) {
        const speed = vel.length();
        this.onLand?.(at, speed);
        const floor = normal.y > 0.9 && at.y < 0.01;
        // Into blood still liquid: it merges with it and leaves no mark of its own, the pool only gaining what it brought.
        // Hard enough (We over 400) it throws a crown whose satellite droplets land round about, more the harder and the
        // more drops have fallen there (Boos et al. 2019, drip patterns; dev/research/stab-wounds.md sec. 2). What goes
        // into the satellites, their size and speed are estimates: a twentieth of it, half-millimetre droplets at a third
        // of the speed it came in at, thrown up and out. A dried pool is a floor like any other: the drop leaves a stain.
        // A drop's own stain on the floor stays liquid a while too, so the next drop into it merges with it the same way.
        // (shortcut: a stain is the 3 cm cell its drops gather in, wet for DRIES; finer if drops a centimetre apart should
        // each leave a mark.)
        const key = floor ? Math.floor(at.x / 0.03) * 7919 + Math.floor(at.z / 0.03) : 0;
        const stain = floor && this.gathering.has(key) && this.clock - (this.wetSince.get(key) ?? -Infinity) < DRIES;
        if (floor && (stain || this.floor.liquid(at.x, at.z))) {
            const thrown = splashes(d, speed) ? 0.05 : 0;
            if (stain) this._gather(key, at, ml * (1 - thrown));
            else this.floor.pour(at.x, at.z, ml * (1 - thrown));
            if (thrown) this.spray(at.add(new V3(0, 0.002, 0)), V3.UpReadOnly, speed * 0.33, ml * thrown, 1.0, 0.3);
            return;
        }
        if (normal.y > 0.9 && !floor && this._top(at, normal, ml)) return;
        const into = speed > 1e-4 ? Math.max(0.05, -V3.Dot(vel, normal) / speed) : 1;
        const kind = into < 0.72 ? 8 + Math.floor(Math.random() * 4) : (splashes(d, speed) ? 4 : 0) + Math.floor(Math.random() * 4);
        // The tiles' blots fill about 40% of the tile: the quad is as much bigger than the stain.
        const wide = d * spreads(d, speed * Math.sqrt(into)) * (kind < 8 ? 2.6 : 2.2) * (0.85 + Math.random() * 0.3);
        const long = kind >= 8 ? Math.min(5, 1 / into) : 1;
        const along = vel.subtract(normal.scale(V3.Dot(vel, normal)));
        const way = along.lengthSquared() > 1e-8 ? along.normalize() : V3.Cross(normal, Math.abs(normal.y) > 0.9 ? V3.Right() : V3.Up()).normalize();
        const side = V3.Cross(normal, way).normalize();
        this._mark(kind, way.scale(wide * long), side.scale(wide), normal, at);
        // A drawn drop that stands for several real ones leaves their marks too, close about it.
        const more = Math.min(3, Math.floor(ml / volume(d)) - 1);
        for (let k = 0; k < more; k++) {
            const off = way.scale((Math.random() - 0.3) * 0.08).addInPlace(side.scale((Math.random() - 0.5) * 0.05));
            const w2 = wide * (0.5 + Math.random() * 0.6);
            this._mark(kind, way.scale(w2 * long), side.scale(w2), normal, at.add(off));
        }
        if (floor) {
            this.wetSince.set(key, this.clock);
            this._gather(key, at, ml);
        } else if (Math.abs(normal.y) < 0.3 && ml > 0.015) {
            // On a wall a big enough drop runs down it, until what it leaves behind has used it up.
            this._wallRun(at, normal, Math.max(0.002, d * 0.8), Math.min(0.6, ml / 0.003 / 100));
        }
    }

    // Drops landing on the same place of the floor gather; enough of them is a pool.
    _gather(key: number, at: BABYLON.Vector3, ml: number) {
        const have = (this.gathering.get(key) ?? 0) + ml;
        if (have > GATHERS) { this.floor.add(at.x, at.z, have); this.gathering.delete(key); this.wetSince.delete(key); } else this.gathering.set(key, have);
    }

    // Blood landing on the top of something above the floor (a ledge, a crate), which has no pools of its own (shortcut:
    // only the floor flows, floor.ts; a second Floor per raised top if pools up there are wanted). Drops landing within
    // 3 cm of each other gather there as one stain: the first leaves its own mark, and the stain is drawn again, round
    // and as wide as a pool of what has gathered, each time that has doubled (so a body bleeding on a ledge does not use
    // up the room's marks a drop at a time). True if it was taken.
    _top(at: BABYLON.Vector3, normal: BABYLON.Vector3, ml: number) {
        const key = Math.floor(at.x / 0.03) * 7919 + Math.floor(at.z / 0.03) * 31 + Math.round(at.y * 20);
        const was = this.tops.get(key) ?? 0, have = was + ml;
        this.tops.set(key, have);
        if (!was) return false;
        if (Math.floor(Math.log2(have / GATHERS)) > Math.floor(Math.log2(was / GATHERS)) && have > GATHERS) {
            // Spread 2.5 mm deep, as on the floor (floor.ts STANDS), on a quad as much bigger than its blot as a splash's.
            const wide = 2 * Math.sqrt((have * 1e-6) / (Math.PI * 0.0025)) * 2.6;
            const way = V3.Cross(normal, V3.Right()).normalize(), side = V3.Cross(normal, way).normalize();
            this._mark(Math.floor(Math.random() * 4), way.scale(wide), side.scale(wide), normal, at);
        }
        return true;
    }

    // One mark: tile `kind`, its X axis `x` and Y axis `y` (scaled), facing out of a surface with `normal`, at `at`.
    _mark(kind: number, x: BABYLON.Vector3, y: BABYLON.Vector3, normal: BABYLON.Vector3, at: BABYLON.Vector3) {
        const m = M.FromValues(
            x.x, x.y, x.z, 0,
            y.x, y.y, y.z, 0,
            -normal.x, -normal.y, -normal.z, 0,
            at.x + normal.x * 0.001, at.y + normal.y * 0.001, at.z + normal.z * 0.001, 1);
        const mesh = this.marks[kind], cap = SPLATS / this.marks.length;
        const slot = this.markNext[kind];
        m.copyToArray(this.markMatrices[kind], slot * 16);
        this.markBorn[kind][slot] = this.clock;
        const colours = this.markColours[kind];
        colours[slot * 4] = WET[0]; colours[slot * 4 + 1] = WET[1]; colours[slot * 4 + 2] = WET[2]; colours[slot * 4 + 3] = 1;
        this._changed(kind, slot);
        this.markNext[kind] = (slot + 1) % cap;
        this.markCount[kind] = Math.min(cap, this.markCount[kind] + 1);
        mesh.thinInstanceCount = this.markCount[kind];
        mesh.isVisible = true;
        return slot;
    }

    _wallRun(at: BABYLON.Vector3, normal: BABYLON.Vector3, wide: number, reach: number) {
        if (reach < 0.01 || this.wallRuns.length > 80) return;
        const kind = 12 + Math.floor(Math.random() * 4);
        const run = { kind, slot: 0, at: at.clone(), normal: normal.clone(), wide, length: 0.002, reach };
        run.slot = this._place(run, -1);
        this.wallRuns.push(run);
    }

    _place(run, slot: number) {
        const across = V3.Cross(V3.UpReadOnly, run.normal).normalize();
        const up = new V3(0, 1, 0);
        // The streak's tile has its start at the top and its bead at the bottom: the quad is drawn from the drop down.
        const centre = run.at.add(new V3(0, -run.length / 2 + run.wide, 0));
        const x = across.scale(run.wide * 3), y = up.scale(run.length + run.wide * 2);
        if (slot < 0) return this._mark(run.kind, x, y, run.normal, centre);
        const m = M.FromValues(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, -run.normal.x, -run.normal.y, -run.normal.z, 0,
            centre.x + run.normal.x * 0.0012, centre.y, centre.z + run.normal.z * 0.0012, 1);
        m.copyToArray(this.markMatrices[run.kind], slot * 16);
        this._changed(run.kind, slot);
        return slot;
    }

    // Slot `slot` of the marks of `kind` is to go to the card this frame.
    _changed(kind: number, slot: number) {
        const r = this.markChanged.get(kind);
        if (!r) this.markChanged.set(kind, [slot, slot]);
        else { if (slot < r[0]) r[0] = slot; if (slot > r[1]) r[1] = slot; }
    }

    // Runs down walls lengthen at a couple of centimetres a second, slowing as they thin, until they stop.
    _wallRuns(dt: number) {
        if (!this.wallRuns.length) return;
        this.wallRuns = this.wallRuns.filter((run) => {
            const left = run.reach - run.length;
            run.length += Math.min(left, dt * 0.04 * Math.min(1, left / 0.04 + 0.2));
            this._place(run, run.slot);
            return run.reach - run.length > 0.001;
        });
    }

    // A drop at `at` that has reached one of `people`: taken by their skin or clothes, or not (false: it flies on).
    _onto(people, at: BABYLON.Vector3, vel: BABYLON.Vector3, d: number, ml: number) {
        for (const { npc, segs, caps, lo, hi } of people) {
            if (at.x < lo.x || at.y < lo.y || at.z < lo.z || at.x > hi.x || at.y > hi.y || at.z > hi.z) continue;
            let seg = null, near = 0.015, ox = 0, oy = 0, oz = 0;
            for (let k = 0; k < caps.length; k += 8) {
                const px = at.x - caps[k], py = at.y - caps[k + 1], pz = at.z - caps[k + 2];
                const t = Math.max(0, Math.min(1, (px * caps[k + 3] + py * caps[k + 4] + pz * caps[k + 5]) / caps[k + 7]));
                const qx = px - caps[k + 3] * t, qy = py - caps[k + 4] * t, qz = pz - caps[k + 5] * t;
                const d = Math.sqrt(qx * qx + qy * qy + qz * qz) - caps[k + 6];
                if (d < near) { near = d; seg = segs[k / 8]; ox = qx; oy = qy; oz = qz; }
            }
            // (Going away from the segment's axis, it is not coming at the skin either: not worth finding the skin.)
            if (!seg || ox * vel.x + oy * vel.y + oz * vel.z > 0 || --this.looks < 0) continue;
            const hit = npc.runs.onto(at, npc.person.byName[seg.bone]);
            if (!hit) continue;
            // Only a drop coming at the skin or cloth lands on it. One going past (falling beside a leg, or away from the
            // hem it dripped from) goes on: taken back into the cloth, a drip dripped from it again and again.
            const facing = V3.TransformNormalToRef(hit.restNormal, npc.restToWorld(hit.owner), TMP[0]).normalize();
            if (V3.Dot(facing, vel) > -0.25 * vel.length()) continue;
            if (hit.kind === 'cloth') npc.soak?.add(hit.rest, ml);
            else {
                // A spot as wide as it spread when it hit, as thick as what it holds over that.
                const r = (d * spreads(d, vel.length())) / 2;
                npc.film?.blot(hit, r, Math.min(0.5, (ml * 1000) / (Math.PI * (r * 1000) ** 2)));
                if (ml > 0.008) npc.runs.start(hit, ml);
            }
            return true;
        }
        return false;
    }

    // People lying on the floor: where they lie in blood they take it up (their clothes drink it, their skin is smeared
    // with it), and where they are dragged over the floor they smear it on, from a pool they are pulled through or from
    // their own bloody clothes.
    _lying(people, dt: number) {
        const floor = this.floor, point = new V3();
        for (const { npc } of people) {
            // (Standing, only the soles touch the floor, and shoes are not sponges.)
            if (!npc.down && !npc.ragdoll.limp) continue;
            for (const seg of npc.ragdoll.segments) {
                if (/foot/.test(seg.name)) continue;
                const low = npc.ragdoll.lowest?.(seg) ?? seg.node.position.y - (seg.radius ?? 0.05);
                if (low > 0.03) { this.contact.delete(seg); continue; }
                const c = seg.node.position;
                const last = this.contact.get(seg);
                this.contact.set(seg, c.clone());
                const deep = floor.depth(c.x, c.z);
                const owner = npc.person.byName[seg.bone];
                point.set(c.x, Math.max(0.005, low + 0.004), c.z);
                const moved = last ? Math.hypot(c.x - last.x, c.z - last.z) : 0;
                // Where on the body it touches the floor: looked for again only once it has moved a few centimetres.
                let hit = null;
                if (deep > 0.0002 || (moved > 0.01 && moved < 0.5)) {
                    const was = this.lain.get(seg);
                    if (was && V3.DistanceSquared(was.at, c) < 0.03 * 0.03) hit = was.hit;
                    else { hit = npc.runs.onto(point, owner); this.lain.set(seg, { hit, at: c.clone() }); }
                }
                if (deep > 0.0002) {
                    const took = floor.take(c.x, c.z, 0.05, 2.5 * dt / 0.15);
                    if (hit?.kind === 'cloth') npc.soak?.add(hit.rest, took);
                    else if (hit) npc.film?.blot(hit, 0.025, Math.min(0.3, took * 0.2));
                }
                if (!last || moved < 0.01 || moved > 0.5) continue;
                // Dragged: what is under it is pushed along, and its own blood is wiped onto the floor.
                const pushed = deep > 0.0003 ? floor.take(last.x, last.z, 0.04, moved * 30) : 0;
                const own = hit?.kind === 'cloth' && npc.soak ? npc.soak.take(hit.rest, moved * 8) : 0;
                if (pushed + own < 0.01) continue;
                // A smear as wide as what was dragged, in streaks along the way it went (the weave, the folds, the skin's
                // own lines drag the blood into lines), thinning off at its sides.
                const steps = Math.ceil(moved / 0.0125), wide = Math.min(0.06, (seg.radius ?? 0.05) * 0.8);
                const ax = (c.x - last.x) / moved, az = (c.z - last.z) / moved;
                const lanes = [];
                for (let u = -wide; u <= wide; u += 0.0125) lanes.push([u, (0.4 + 0.6 * Math.abs(Math.sin(u * 160 + seg.mass))) * (1 - (u / wide) ** 2 * 0.7)]);
                const total = lanes.reduce((a, l) => a + l[1], 0) * steps;
                for (let k = 1; k <= steps; k++) {
                    const x = last.x + ax * moved * (k / steps), z = last.z + az * moved * (k / steps);
                    for (const [u, w] of lanes) floor.add(x + az * u, z - ax * u, ((pushed + own) * w) / total);
                }
            }
        }
    }

    // The player's feet: stepping in blood wets the soles, and the next steps print them, less each time.
    _feet() {
        const eye = this.scene.activeCamera?.globalPosition;
        if (!eye) return;
        // Up on something, the soles print on it, but there is no pool up there to step in.
        const under = this.map?.ground(eye.x, eye.z, eye.y - 0.5) ?? 0;
        const f = this.foot ?? (this.foot = { x: eye.x, z: eye.z, carried: 0, walked: 0, left: false });
        const moved = Math.hypot(eye.x - f.x, eye.z - f.z);
        const yaw = Math.atan2(eye.x - f.x, eye.z - f.z);
        f.x = eye.x; f.z = eye.z;
        if (under < 0.01 && this.floor.depth(eye.x, eye.z) > 0.0004) f.carried = Math.min(5, f.carried + this.floor.take(eye.x, eye.z, 0.12, 1.5));
        if (moved > 0.5) return;
        if (f.carried < 0.05) { f.walked = 0; return; }
        f.walked += moved;
        if (f.walked < 0.72) return;
        f.walked = 0;
        f.left = !f.left;
        const side = f.left ? -0.09 : 0.09;
        const print = f.carried * 0.28;
        f.carried -= print;
        // A print as full as the blood the sole still carries: the first ones whole, then only the tread's ridges, then
        // a few flecks. A left foot is a right one mirrored.
        const kind = 16 + (print > 0.6 ? 0 : print > 0.3 ? 1 : print > 0.12 ? 2 : 3);
        const along = new V3(Math.sin(yaw), 0, Math.cos(yaw)), across = new V3(Math.cos(yaw), 0, -Math.sin(yaw));
        this._mark(kind, across.scale(f.left ? -0.13 : 0.13), along.scale(0.33), V3.UpReadOnly,
            new V3(eye.x + across.x * side, under, eye.z + across.z * side));
    }

    // Blood on the room drying: every ten seconds each mark still drying is coloured by how long it has lain there.
    _dry() {
        if (this.clock - this.dried < 10) return;
        this.dried = this.clock;
        this.marks.forEach((mesh, kind) => {
            const colours = this.markColours[kind], born = this.markBorn[kind];
            for (let i = 0; i < this.markCount[kind]; i++) {
                if (this.clock - born[i] > DRIES + 10) continue;
                const t = Math.min(1, (this.clock - born[i]) / DRIES);
                for (let k = 0; k < 3; k++) colours[i * 4 + k] = WET[k] + (DRY[k] - WET[k]) * t;
                this._changed(kind, i);
            }
        });
    }

    clear() {
        this.n = 0;
        this.drop.thinInstanceCount = 0;
        this.drop.isVisible = false;
        this.streams.clear();
        this.wallRuns = [];
        this.gathering.clear();
        this.wetSince.clear();
        this.tops.clear();
        this.marks.forEach((m, k) => { m.thinInstanceCount = 0; m.isVisible = false; this.markCount[k] = 0; this.markNext[k] = 0; });
        this.markChanged.clear();
        this.floor.clear();
        if (this.foot) this.foot.carried = 0;
    }
}

// A normally distributed number (Box-Muller).
function gauss() {
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(Math.PI * 2 * Math.random());
}

// The UVs of tile k of the splash sheet, as [u0, v0, u1, v1].
function tile(k) {
    const [cols, rows] = TILES;
    const c = k % cols, r = Math.floor(k / cols);
    return [c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows];
}

// Twenty stains painted once, each filling about 40% of its tile: four round and smooth (a drop that fell gently);
// four round with their rims broken into spines and a scatter of droplets beyond (one that came hard); four long, with
// a tail and droplets thrown on ahead (one that came slantwise, travelling along +X); four runs down a wall, a streak
// from the top with the bead that is running at its foot; and four prints of a bloody shoe, fainter and fainter.
function splashSheet(scene) {
    const S = 256, [cols, rows] = TILES, W = S * cols, H = S * rows;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const blob = (x, y, r) => {
        g.beginPath();
        g.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
        g.fill();
    };
    // A closed outline about (x, y), `r` across on average, its edge wandering by `jag` at `lobes` places round it.
    const outline = (x, y, r, lobes, jag, sx = 1, sy = 1) => {
        const offsets = Array.from({ length: lobes }, () => (Math.random() - 0.5) * jag);
        g.beginPath();
        const steps = lobes * 6;
        for (let a = 0; a <= steps; a++) {
            const t = (a / steps) * Math.PI * 2, f = (a / steps) * lobes, i = Math.floor(f) % lobes, j = (i + 1) % lobes, u = f - Math.floor(f);
            const rr = r * (1 + offsets[i] * (1 - u) + offsets[j] * u);
            g.lineTo(x + Math.cos(t) * rr * sx, y + Math.sin(t) * rr * sy);
        }
        g.fill();
    };
    for (let k = 0; k < cols * rows; k++) {
        const ox = (k % cols) * S, oy = Math.floor(k / cols) * S, cx = ox + S / 2, cy = oy + S / 2;
        g.save();
        g.beginPath();
        g.rect(ox, oy, S, S);
        g.clip();
        g.fillStyle = 'rgba(245,245,245,1)';
        // (How thick it lies, thin at the rim and deep in the middle, is worked out from the shape: sheetTexels.)
        const body = (x, y, r, sx = 1, sy = 1) => outline(x, y, r, 14, 0.12, sx, sy);
        const kind = Math.floor(k / 4);
        if (kind === 0) body(cx, cy, S * 0.19);
        else if (kind === 1) {
            body(cx, cy, S * 0.17);
            // Spines: fingers of blood thrown out of the rim, some ending in a droplet.
            const spines = 14 + Math.floor(Math.random() * 10);
            for (let a = 0; a < spines; a++) {
                const t = (a / spines) * Math.PI * 2 + Math.random() * 0.3, len = S * (0.03 + Math.random() * 0.07);
                g.strokeStyle = 'rgba(245,245,245,0.9)';
                g.lineWidth = S * (0.008 + Math.random() * 0.012);
                g.lineCap = 'round';
                g.beginPath();
                g.moveTo(cx + Math.cos(t) * S * 0.15, cy + Math.sin(t) * S * 0.15);
                g.lineTo(cx + Math.cos(t) * (S * 0.17 + len), cy + Math.sin(t) * (S * 0.17 + len));
                g.stroke();
                if (Math.random() < 0.5) blob(cx + Math.cos(t) * (S * 0.2 + len * 1.4), cy + Math.sin(t) * (S * 0.2 + len * 1.4), S * (0.006 + Math.random() * 0.01));
            }
            for (let a = 0; a < 10; a++) {
                const t = Math.random() * Math.PI * 2, r = S * (0.28 + Math.random() * 0.18);
                blob(cx + Math.cos(t) * r, cy + Math.sin(t) * r, S * (0.003 + Math.random() * 0.007));
            }
        } else if (kind === 2) {
            // Long along +X: the stain itself an ellipse a little to the back, its leading edge drawn out into a tail
            // and the droplets it threw going on ahead.
            body(cx - S * 0.1, cy, S * 0.18, 1, 0.42);
            g.beginPath();
            g.moveTo(cx + S * 0.05, cy - S * 0.05);
            g.quadraticCurveTo(cx + S * 0.2, cy - S * 0.01, cx + S * 0.27, cy);
            g.quadraticCurveTo(cx + S * 0.2, cy + S * 0.01, cx + S * 0.05, cy + S * 0.05);
            g.fill();
            for (let a = 0; a < 9; a++) {
                const t = (Math.random() - 0.5) * 0.35, r = S * (0.28 + Math.random() * 0.2);
                blob(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.5, S * (0.004 + Math.random() * 0.012));
            }
        } else if (kind === 3) {
            // A run down a wall: from the top of the tile, narrowing as it goes, the bead at its foot.
            const w = S * 0.05, top = oy + S * 0.08, foot = oy + S * 0.86;
            g.fillStyle = 'rgba(245,245,245,0.85)';
            outline(cx, top + w, w * 1.6, 9, 0.25);
            g.beginPath();
            g.moveTo(cx - w, top + w);
            let x = cx;
            for (let y = top + w; y <= foot; y += S * 0.04) { x += (Math.random() - 0.5) * S * 0.008; g.lineTo(x - w * (0.55 + 0.45 * (1 - (y - top) / S)), y); }
            for (let y = foot; y >= top + w; y -= S * 0.04) g.lineTo(x + w * (0.55 + 0.45 * (1 - (y - top) / S)), y);
            g.fill();
            g.fillStyle = 'rgba(245,245,245,1)';
            outline(x, foot, w * 0.95, 7, 0.15, 1, 1.25);
        } else {
            // A right shoe's print, toes up the tile (the quad is a shoe long and wide): the forefoot and the heel, which
            // bear on the floor, joined by a strip of the outside edge (the arch stands off it); the tread's lugs carry
            // blood and its grooves none. The fewer of the lugs the less the sole still carries (k % 4 = 0 whole, 3 a few
            // patches), worn away first where the sole presses least.
            const u = (f) => ox + f * S, v = (f) => oy + f * S;
            g.beginPath();
            g.ellipse(u(0.5), v(0.29), S * 0.4, S * 0.23, -0.06, 0, Math.PI * 2);
            g.ellipse(u(0.52), v(0.8), S * 0.29, S * 0.15, 0, 0, Math.PI * 2);
            g.fill();
            g.beginPath();
            g.moveTo(u(0.7), v(0.42)); g.lineTo(u(0.87), v(0.4)); g.lineTo(u(0.79), v(0.76)); g.lineTo(u(0.68), v(0.76));
            g.fill();
            // The tread: blocky lugs of a work boot's sole, set a little unevenly, the grooves between them clean.
            const keeps = [0.9, 0.55, 0.32, 0.14][k % 4];
            const img = g.getImageData(ox, oy, S, S), a = img.data;
            const jitter = (i: number, j: number, e: number) => { const h = Math.sin(i * 127.1 + j * 311.7 + e * 74.7) * 43758.5453; return h - Math.floor(h); };
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
                const i = (y * S + x) * 4 + 3;
                if (!a[i]) continue;
                // Distance to the edge of the nearest lug (the second nearest lug centre less the nearest, Worley's way), in
                // lugs about 10 mm across (the tile is 130 mm wide and 330 mm long).
                const gx = (x / S) * 13, gy = (y / S) * 33, cx = Math.floor(gx), cy = Math.floor(gy);
                let d1 = 9, d2 = 9;
                for (let j = -1; j <= 1; j++) for (let e = -1; e <= 1; e++) {
                    const px = cx + e + 0.2 + 0.6 * jitter(cx + e, cy + j, 1), py = cy + j + 0.2 + 0.6 * jitter(cx + e, cy + j, 2);
                    const d = Math.hypot(gx - px, gy - py);
                    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
                }
                const lug = Math.min(1, Math.max(0, ((d2 - d1) * 10 - 1.4) / 0.8));
                // How hard the sole presses here (heel and ball most) and how the blood on it happens to lie.
                const press = Math.max(Math.exp(-(((x / S - 0.52) / 0.2) ** 2 + ((y / S - 0.82) / 0.1) ** 2)), Math.exp(-(((x / S - 0.45) / 0.25) ** 2 + ((y / S - 0.3) / 0.12) ** 2)));
                const lie = 0.55 * noise2(x / 22 + k * 7, y / 22) + 0.3 * noise2(x / 7, y / 7 + k * 3) + 0.15 * noise2(x / 2.5, y / 2.5);
                const n = 0.65 * lie + 0.35 * press;
                const keep = Math.min(1, Math.max(0, (n - (1 - keeps) * 0.85) / 0.06));
                // A full sole fills the grooves too, here and there.
                const fill = keeps > 0.8 ? Math.max(lug, Math.min(1, Math.max(0, (lie - 0.55) / 0.1))) : lug;
                a[i] = Math.round(a[i] * keep * fill * (0.72 + 0.28 * lie));
            }
            g.putImageData(img, ox, oy);
        }
        g.restore();
    }
    const texture = new BABYLON.RawTexture(sheetTexels(g.getImageData(0, 0, W, H).data, W, H), W, H, BABYLON.Constants.TEXTUREFORMAT_RGBA, scene,
        true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
    texture.name = 'splashes';
    texture.hasAlpha = true;
    texture.anisotropicFilteringLevel = 8;
    return texture;
}

// The sheet as the card takes it, the canvas's top row last (the tiles' UVs read it the right way up). Alpha is how much
// of each texel the blood covers; colour is the blood's own, by how thick it lies there: a stain is thickest well inside
// its edge and thins to nothing at it, so its rim is bright red and its middle near black-red (fluid.ts's absorption,
// over concrete). Texels with no blood carry the rim's colour, so that where the card averages texels together (its
// mipmaps, its filtering) it never averages in black.
function sheetTexels(px: Uint8ClampedArray, W: number, H: number) {
    const cover = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) cover[i] = px[i * 4 + 3] / 255;
    const inside = blurred(blurred(cover, W, H, 4), W, H, 4);
    const out = new Uint8Array(W * H * 4);
    const srgb = (x: number) => Math.round(Math.pow(Math.min(1, x), 1 / 2.2) * 255);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = ((H - 1 - y) * W + x) * 4;
        // (A shoe's print is blood pressed off a sole: thin all over, not a drop's dome.)
        const print = Math.floor(y / (H / TILES[1])) * TILES[0] + Math.floor(x / (W / TILES[0])) >= 16;
        const mm = !cover[i] ? 0.03 : print ? 0.12 + 0.2 * cover[i] : 0.03 + 0.57 * Math.min(1, Math.max(0, (inside[i] - 0.3) / 0.65)) ** 1.5;
        const r = Math.exp(-6 * mm), gr = Math.exp(-48 * mm), b = Math.exp(-56 * mm);
        out[o] = srgb(0.2 * r + 0.075 * (1 - r));
        out[o + 1] = srgb(0.19 * gr + 0.004 * (1 - gr));
        out[o + 2] = srgb(0.17 * b + 0.0035 * (1 - b));
        out[o + 3] = px[i * 4 + 3];
    }
    return out;
}

// `a` (W by H) through a box `r` texels either way, along rows then columns.
function blurred(a: Float32Array, W: number, H: number, r: number) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), k = 1 / (2 * r + 1);
    for (let y = 0; y < H; y++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) sum += a[y * W + Math.min(W - 1, Math.max(0, x))];
        for (let x = 0; x < W; x++) {
            tmp[y * W + x] = sum * k;
            sum += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
        }
    }
    for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (let y = 0; y < H; y++) {
            out[y * W + x] = sum * k;
            sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
        }
    }
    return out;
}
