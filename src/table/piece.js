// Pieces taken from the body.
//
// A piece of skin cut or peeled free, or of the whole wall where that came
// too, is not tissue any more (tissue.js): it is a thing. It keeps the shape
// it had on the body, the skin on top of it and the cut fat or the inside of
// the wall under it, and a hand carries it about. Let go, it falls, and lies
// where it lands: on the body, on the table, on the floor. Thrown, it goes
// the way the hand was going.

const V3 = BABYLON.Vector3;
const FALLS = 9.81;             // metres a second, each second
const LAND = { sticks: 0.15 };  // what wet flesh keeps of how fast it was going along what it lands on
const THROWN = 0.25;            // of how fast the hand was going at the moment it let go, how much is kept as a throw (a hand slows as it opens)
// What is under the skin of a piece: yellow fat, and where the wall came
// too, the pale inside of it.
const FAT = { colour: [0.86, 0.68, 0.32], rough: 0.55 };
const LINING = { colour: [0.72, 0.48, 0.44], rough: 0.4 };

function plain(scene, name, { colour, rough }) {
    const material = new BABYLON.PBRMaterial(name, scene);
    material.albedoColor = BABYLON.Color3.FromArray(colour);
    material.metallic = 0;
    material.roughness = rough;
    material.backFaceCulling = false;
    return material;
}

export class Pieces {
    // `ground(x, z)` is how high whatever is under a spot of the room is.
    // `skin` is the skin's own material, for the tops of pieces.
    constructor(scene, ground, skin) {
        this.scene = scene;
        this.ground = ground;
        this.all = [];
        this.landed = 0;                // goes up whenever a piece comes down on something
        this.materials = {
            skin: Object.assign(skin.clone('skin, taken'), { backFaceCulling: false }),
            fat: plain(scene, 'fat, taken', FAT),
            lining: plain(scene, 'lining, taken', LINING),
        };
    }

    // A thing made of a shape the field gave up (field.lift).
    add(shape) {
        const piece = new Piece(this.scene, shape, this.materials);
        this.all.push(piece);
        return piece;
    }

    // The piece the mouse's ray meets first, and where: { piece, point }, or null.
    pick(ray) {
        const met = this.scene.pickWithRay(ray, (mesh) => !!(mesh.metadata && mesh.metadata.piece));
        return met && met.hit ? { piece: met.pickedMesh.metadata.piece, point: met.pickedPoint } : null;
    }

    update(dt) {
        for (const piece of this.all) if (piece.fall(dt, this.ground)) this.landed++;
    }
}

class Piece {
    constructor(scene, shape, materials) {
        // Everything is kept about the middle of it, which is what moves.
        const middle = shape.top.reduce((sum, p) => sum.add(p), V3.Zero()).scale(1 / shape.top.length);
        this.node = new BABYLON.TransformNode('piece', scene);
        this.node.position.copyFrom(middle);
        const local = (p) => p.subtract(middle);
        const top = new BABYLON.VertexData(), under = new BABYLON.VertexData();
        top.positions = shape.top.flatMap((p) => local(p).asArray());
        top.normals = shape.normal.flatMap((n) => n.asArray());
        top.uvs = shape.picture.flat();
        top.indices = shape.tris.flat();
        // Under it and round its edge, one mesh: the bottom, and a strip of side for every edge.
        const positions = [], normals = [], indices = [];
        const corner = (p, n) => { positions.push(...local(p).asArray()); normals.push(...n.asArray()); return positions.length / 3 - 1; };
        for (const [a, b, c] of shape.tris) indices.push(...[a, b, c].map((i) => corner(shape.bottom[i], shape.normal[i].negate())));
        for (const [a, b] of shape.rim) {
            const out = V3.Cross(shape.top[b].subtract(shape.top[a]), shape.normal[a]).normalize();
            const at = [shape.top[a], shape.top[b], shape.bottom[b], shape.bottom[a]].map((p) => corner(p, out));
            indices.push(at[0], at[1], at[2], at[0], at[2], at[3]);
        }
        Object.assign(under, { positions, normals, indices });
        this.meshes = [['skin', top, shape.skin ? materials.skin : materials.fat], ['under', under, shape.deep ? materials.lining : materials.fat]].map(([name, data, material]) => {
            const mesh = new BABYLON.Mesh('piece ' + name, scene);
            data.applyToMesh(mesh);
            mesh.material = material;
            mesh.parent = this.node;
            mesh.metadata = { piece: this };
            mesh.receiveShadows = true;
            return mesh;
        });
        // How far its lowest point is under its middle: it lands on that.
        this.low = Math.min(...shape.bottom.map((p) => p.y - middle.y), ...shape.top.map((p) => p.y - middle.y));
        this.going = V3.Zero();
        this.held = true;
        this.lying = false;
    }

    get position() { return this.node.position; }

    // The hand has it at `to`: it goes there, and how fast it went is kept, for a throw.
    carry(to, dt) {
        const went = to.subtract(this.node.position).scale(1 / Math.max(dt, 1e-3));
        this.going = V3.Lerp(this.going, went, 0.5);
        this.node.position.copyFrom(to);
        this.held = true;
        this.lying = false;
    }

    // The hand opens.
    drop() {
        this.held = false;
        this.going.scaleInPlace(THROWN);
    }

    // A moment of falling, if it is falling. Returns whether it came down on something just now.
    fall(dt, ground) {
        if (this.held || this.lying) return false;
        this.going.y -= FALLS * dt;
        const at = this.node.position.addInPlace(this.going.scale(dt)), floor = ground(at.x, at.z);
        if (at.y + this.low > floor) return false;
        at.y = floor - this.low;
        this.going.set(this.going.x * LAND.sticks, 0, this.going.z * LAND.sticks);
        this.lying = true;
        return true;
    }
}
