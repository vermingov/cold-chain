// What is inside.
//
// The organs of the belly, built offline by tools/organs.py from
// BodyParts3D's scan of a real man and fitted into this body. Each is a
// mesh of its own, because each is something that will be moved aside, cut
// free and lifted out. They hang on the body's own frame, so wherever the
// body has been laid they are inside it.
//
// The vessels and the ureters come as paths, not meshes, and are drawn here
// as tubes: a tube can be cut anywhere along it, and when it is, it becomes
// two.
//
// Nothing here has a photograph for a surface. What an organ looks like is
// its colour, how wet it is, and how its colour wanders, and those are set
// by what kind of thing it is.

import { Buf } from '../geometry.js';
import { Mottle } from '../surfaces.js';
import { noiseTexture } from '../noise.js';
import { Finder } from './finder.js';

// Each kind: its colour as seen, how rough (wet things are smooth), how far
// its colour wanders and over what size of blotch in metres. These are two
// days dead and cold: duller than a textbook, the bowel going grey.
const KINDS = {
    liver: { colour: [0.36, 0.13, 0.1], rough: 0.24, wander: [0.3, 0.05] },
    gallbladder: { colour: [0.2, 0.3, 0.14], rough: 0.2, wander: [0.25, 0.03] },
    stomach: { colour: [0.66, 0.47, 0.42], rough: 0.3, wander: [0.25, 0.06] },
    spleen: { colour: [0.3, 0.13, 0.2], rough: 0.26, wander: [0.3, 0.04] },
    pancreas: { colour: [0.72, 0.58, 0.36], rough: 0.4, wander: [0.3, 0.02] },
    bowel: { colour: [0.67, 0.5, 0.45], rough: 0.27, wander: [0.3, 0.05] },
    colon: { colour: [0.6, 0.48, 0.42], rough: 0.32, wander: [0.3, 0.07] },
    bladder: { colour: [0.72, 0.62, 0.5], rough: 0.3, wander: [0.2, 0.05] },
    kidney: { colour: [0.38, 0.14, 0.11], rough: 0.22, wander: [0.22, 0.03] },
    adrenal: { colour: [0.74, 0.56, 0.22], rough: 0.4, wander: [0.25, 0.02] },
    ureter: { colour: [0.74, 0.64, 0.56], rough: 0.35, wander: [0.15, 0.03] },
    artery: { colour: [0.7, 0.5, 0.42], rough: 0.35, wander: [0.2, 0.04] },
    vein: { colour: [0.33, 0.27, 0.44], rough: 0.3, wander: [0.25, 0.04] },
    muscle: { colour: [0.4, 0.1, 0.08], rough: 0.36, wander: [0.3, 0.05] },
    bone: { colour: [0.72, 0.66, 0.54], rough: 0.55, wander: [0.2, 0.05] },
};

// How thick a tube is, in metres from its middle: the scan's own figures run
// fat, so these are an anatomist's.
const CALIBRE = { ureter: 0.0024, artery: 0.0032, vein: 0.0046 };
// What a blade leaves on what it touches: a line, this wide, this colour,
// laid this far off the surface so it is not lost in it. Touches further
// apart than `joins` are two cuts, not one, and nearer than `apart` are one
// touch. `length` is how many touches there are to a length of cut.
const NICK = { colour: [0.16, 0.012, 0.012], wide: 0.0011, proud: 0.0004, joins: 0.012, apart: 0.0012, length: 40 };
const GAP = 0.005;          // metres each end of a cut tube draws back
const STRETCHES = 0.7;      // of a tube's length, from the organ it hangs from, that is drawn along when the organ is moved

async function read(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ': ' + res.status);
    const buf = await res.arrayBuffer();
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'CCOF') throw new Error(url + ': not organs');
    const length = new DataView(buf).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, length)));
    const types = { float32: Float32Array, uint32: Uint32Array };
    const arrays = {};
    for (const a of header.arrays) arrays[a.name] = new types[a.type](buf, 12 + length + a.offset, a.length / types[a.type].BYTES_PER_ELEMENT);
    return { header, arrays };
}

// One thing inside the body: its mesh, and what has been done to it.
class Organ {
    constructor(name, kind, mesh) {
        this.name = name;
        this.kind = kind;
        this.mesh = mesh;
        this.home = mesh.position.clone();
        this.shift = BABYLON.Vector3.Zero();    // how far it has been moved, in the world
        this.nicks = [];                        // the cuts a blade has left on it: each { points, normals, mesh }, in its own frame
        mesh.metadata = { organ: this };
    }

    // Leave the mark of a blade at a point of the world, where the surface
    // faces `normal`. Touch after touch along a stroke is one cut. The cut
    // is fixed to the organ, so it is still there when the thing is lifted
    // out and turned over under a lamp.
    nick(point, normal) {
        const into = this.mesh.getWorldMatrix().clone().invert();
        const at = BABYLON.Vector3.TransformCoordinates(point, into), facing = BABYLON.Vector3.TransformNormal(normal, into).normalize();
        let cut = this.nicks[this.nicks.length - 1];
        if (!cut || BABYLON.Vector3.Distance(cut.points[cut.points.length - 1], at) > NICK.joins) {
            cut = { points: [], normals: [], mesh: null };
            this.nicks.push(cut);
        }
        if (cut.points.length && BABYLON.Vector3.Distance(cut.points[cut.points.length - 1], at) < NICK.apart) return;
        // A long cut is drawn in lengths, each going on from where the last stopped: one length is made again at every touch.
        if (cut.points.length >= NICK.length) {
            cut = { points: cut.points.slice(-1), normals: cut.normals.slice(-1), mesh: null };
            this.nicks.push(cut);
        }
        cut.points.push(at);
        cut.normals.push(facing);
        this._line(cut);
    }

    // Draw one cut: a ribbon along its points, lying on the surface. A cut
    // that grows keeps the mesh it has (a stroke adds a point a frame, and
    // a new mesh a frame is a stutter).
    _line(cut) {
        const scene = this.mesh.getScene(), positions = [], normals = [], indices = [];
        // A single touch is a short cut the way the blade's edge lay.
        const points = cut.points.length > 1 ? cut.points : [cut.points[0], cut.points[0].add(BABYLON.Vector3.Cross(cut.normals[0], BABYLON.Vector3.Up()).scale(0.003))];
        points.forEach((p, i) => {
            const n = cut.normals[Math.min(i, cut.normals.length - 1)];
            const along = points[Math.min(i + 1, points.length - 1)].subtract(points[Math.max(i - 1, 0)]).normalize();
            const across = BABYLON.Vector3.Cross(n, along).normalize().scale(NICK.wide / 2);
            // It tapers at both ends, as a cut does.
            const taper = points.length > 2 && (i === 0 || i === points.length - 1) ? 0.15 : 1;
            for (const side of [-1, 1]) {
                positions.push(...p.add(across.scale(side * taper)).add(n.scale(NICK.proud)).asArray());
                normals.push(...n.asArray());
            }
            if (i) indices.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
        });
        if (!cut.mesh) {
            cut.mesh = new BABYLON.Mesh(this.name + ' cut', scene);
            cut.mesh.parent = this.mesh;
            cut.mesh.isPickable = false;
            cut.mesh.material = cutMaterial(scene);
        }
        const data = new BABYLON.VertexData();
        data.positions = positions;
        data.normals = normals;
        data.indices = indices;
        data.applyToMesh(cut.mesh);
    }
}

// What a cut in an organ is drawn in: dark, wet, seen from either side.
function cutMaterial(scene) {
    const found = scene.getMaterialByName('organ cut');
    if (found) return found;
    const m = new BABYLON.PBRMaterial('organ cut', scene);
    m.albedoColor = BABYLON.Color3.FromArray(NICK.colour);
    m.metallic = 0;
    m.roughness = 0.18;
    m.environmentIntensity = 0;
    m.backFaceCulling = false;
    return m;
}

// A vessel or a ureter: a path, drawn as a tube, that can be cut.
class Tube {
    constructor(organs, name, kind, path) {
        this.organs = organs;
        this.name = name;
        this.kind = kind;
        this.path = path;           // points in the body's frame
        this.cut = false;
        this.pieces = [organs._tube(this, path)];
    }

    // How far the point of the world `point` is from it, in metres (Infinity once it is cut).
    distance(point) { return this.cut ? Infinity : this._nearest(point).d; }

    // Along the path, the place nearest a point of the world.
    _nearest(point) {
        const local = BABYLON.Vector3.TransformCoordinates(point, this.pieces[0].getWorldMatrix().clone().invert());
        let best = { d: Infinity };
        for (let i = 0; i + 1 < this.path.length; i++) {
            const a = this.path[i], ab = this.path[i + 1].subtract(a);
            const t = Math.max(0, Math.min(1, BABYLON.Vector3.Dot(local.subtract(a), ab) / ab.lengthSquared()));
            const d = BABYLON.Vector3.Distance(local, a.add(ab.scale(t)));
            if (d < best.d) best = { d, i, t, at: a.add(ab.scale(t)), along: ab.normalize() };
        }
        return best;
    }

    // Cut it at the point of the world nearest `point`. Its two ends draw
    // back from the cut. Returns false if it was cut already.
    sever(point) {
        if (this.cut) return false;
        const best = this._nearest(point);
        this.parts = [[...this.path.slice(0, best.i + 1), best.at.subtract(best.along.scale(GAP))],
            [best.at.add(best.along.scale(GAP)), ...this.path.slice(best.i + 1)]].filter((p) => p.length > 1);
        this.cut = true;
        this._draw(this.drawnWith || BABYLON.Vector3.Zero());
        return true;
    }

    // It is fixed at one end to `organ`, which has moved `offset` (in the body's frame) from where it lay: whole, it
    // stretches after it, most at that end and nothing at the other, which is fixed to whatever it comes from; cut,
    // the length still on the organ goes with it and the rest stays.
    follow(organ, offset) {
        if (!this.end) {
            organ.mesh.computeWorldMatrix(true);
            const centre = organ.mesh.getBoundingInfo().boundingBox.center;
            const first = BABYLON.Vector3.Distance(this.path[0], centre), last = BABYLON.Vector3.Distance(this.path[this.path.length - 1], centre);
            this.end = first < last ? 0 : this.path.length - 1;
            // How much of the organ's movement each point of it takes: all at the organ, none past STRETCHES of its length.
            const along = [0];
            for (let i = 1; i < this.path.length; i++) along.push(along[i - 1] + BABYLON.Vector3.Distance(this.path[i], this.path[i - 1]));
            const length = along[along.length - 1];
            this.takes = along.map((s) => Math.max(0, 1 - (this.end === 0 ? s : length - s) / (length * STRETCHES)));
        }
        if (this.drawnWith && this.drawnWith.equalsWithEpsilon(offset, 1e-5)) return;
        this._draw(offset);
    }

    _draw(offset) {
        this.drawnWith = offset.clone();
        for (const piece of this.pieces) piece.dispose();
        if (!this.cut) {
            this.pieces = [this.organs._tube(this, this.path.map((p, i) => p.add(offset.scale(this.takes ? this.takes[i] : 0))))];
            return;
        }
        // The piece with the organ's end on it is the first if the organ is at the path's start.
        const onOrgan = this.end === 0 ? 0 : this.parts.length - 1;
        this.pieces = this.parts.map((part, k) => this.organs._tube(this, k === onOrgan && this.end !== undefined ? part.map((p) => p.add(offset)) : part));
    }
}

export class Organs {
    constructor(scene) {
        this.scene = scene;
        this.materials = new Map();
        this.all = new Map();       // name -> Organ
        this.tubes = new Map();     // name -> Tube
        this.finders = new WeakMap();       // mesh -> what finds a ray's way into it
    }

    _material(kind) {
        if (!this.materials.has(kind)) {
            const { colour, rough, wander } = KINDS[kind];
            const m = new BABYLON.PBRMaterial('organ:' + kind, this.scene);
            m.albedoColor = BABYLON.Color3.FromArray(colour).toLinearSpace();
            m.metallic = 0;
            m.roughness = rough;
            m.specularIntensity = 0.7;
            m.environmentIntensity = 0;
            m.maxSimultaneousLights = 8;
            // A cut tube is looked into.
            m.backFaceCulling = !CALIBRE[kind];
            new Mottle(m, noiseTexture(this.scene), ...wander);
            this.materials.set(kind, m);
        }
        return this.materials.get(kind);
    }

    // What a ray of the world first meets of what is inside, no further
    // off than `within` metres: { organ } or, if `tubes` are wanted too,
    // { tube }, with `point` and `normal`. Or null.
    meet(ray, within = Infinity, tubes = true) {
        let met = null;
        const tried = (mesh, what) => {
            if (!mesh.isEnabled()) return;
            if (!this.finders.has(mesh)) this.finders.set(mesh, new Finder(mesh));
            const found = this.finders.get(mesh).meet(ray, met ? met.far : within);
            if (found) met = { ...what, ...found };
        };
        for (const organ of this.all.values()) if (!organ.taken) tried(organ.mesh, { organ });
        if (tubes) for (const tube of this.tubes.values()) for (const piece of tube.pieces) tried(piece, { tube });
        return met;
    }

    // Hang a mesh in the body: the same place in the body's frame that the
    // body's own mesh has.
    _hang(mesh) {
        mesh.parent = this.person.body;
        mesh.position.copyFrom(this.person.mesh.position);
        mesh.isPickable = true;
        return mesh;
    }

    // The mesh of one length of a tube.
    _tube(tube, path) {
        const buf = new Buf();
        buf.tube(path.map((p) => p.asArray()), CALIBRE[tube.kind], 0.05, { sides: 8 });
        const mesh = this._hang(buf.toMesh(tube.name, this.scene, this._material(tube.kind)));
        mesh.useVertexColors = false;
        mesh.metadata = { tube };
        return mesh;
    }

    // Fetch `person`'s organs from `url` and put them in the body.
    async into(person, url) {
        this.person = person;
        const { header, arrays } = await read(url);
        for (const organ of header.organs) {
            if (organ.path) {
                this.tubes.set(organ.name, new Tube(this, organ.name, organ.kind, organ.path.map(([x, y, z]) => new BABYLON.Vector3(x, y, z))));
                continue;
            }
            const mesh = new BABYLON.Mesh(organ.name, this.scene);
            const data = new BABYLON.VertexData();
            const from = organ.vertexStart * 3, to = from + organ.vertexCount * 3;
            data.positions = arrays.position.subarray(from, to);
            data.normals = arrays.normal.subarray(from, to);
            data.indices = Uint32Array.from(arrays.index.subarray(organ.indexStart, organ.indexStart + organ.indexCount), (i) => i - organ.vertexStart);
            data.applyToMesh(mesh);
            mesh.material = this._material(organ.kind);
            mesh.receiveShadows = true;
            this.all.set(organ.name, new Organ(organ.name, organ.kind, this._hang(mesh)));
            // Sorted now, while nobody is waiting on a blade.
            this.finders.set(mesh, new Finder(mesh));
        }
        return this;
    }
}
