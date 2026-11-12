// The bier: the cemetery's own wheeled stretcher, kept by the store.
//
// An iron frame on four small wheels with a bed of boards, long enough for
// a coffin, and a handle at one end to push it by. Pushed, it goes ahead of
// whoever has it, turns as they turn, and stops at whatever it runs into,
// and so do they. Whatever is laid on it goes with it.

import * as BABYLON from '@babylonjs/core';
import { place } from '../../glb.ts';

const V3 = BABYLON.Vector3;
const SIZE = { long: 2.0, wide: 0.62, high: 0.72 };
const WHEEL = 0.11;             // radius
const AHEAD = 1.35;             // metres from the pusher's feet to the middle of the bier
const PACE = 0.55;              // of a walk, pushing it
const TURNS = 5;                // how fast it comes round to where the pusher faces
const GIRTH = 0.42;             // how wide it is, for running into things

export class Bier {
    declare ground: any;
    declare root: BABYLON.TransformNode;
    declare pusher: any;
    declare load: any;
    declare wheels: any[];
    declare meshes: BABYLON.Mesh[];

    // `at` is [x, z] and `yaw` which way its handle end faces. `ground(x, z)` is the yard's height.
    constructor(scene, surfaces, at, yaw, ground) {
        this.ground = ground;
        this.root = new BABYLON.TransformNode('bier', scene);
        this.root.position.set(at[0], ground(...at), at[1]);
        this.root.rotation.y = yaw;
        this.pusher = null;
        this.load = null;               // what is on it

        // The forged bier (tools/forge/models/yard.py): its frame, and its wheels each turning on its axle. The meshes
        // are here at once, for the shadows; what they look like comes when the model has loaded.
        this.meshes = ['bier', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((name) => new BABYLON.Mesh(name, scene));
        this.wheels = this.meshes.slice(1);
        // The model's handle end is its back: turned so it is this frame's -x.
        const fit = new BABYLON.TransformNode('bier model', scene);
        fit.parent = this.root;
        fit.rotation.y = Math.PI / 2;
        place(scene, 'props/bier').then(({ root, parts }) => {
            root.parent = fit;
            for (const mesh of this.meshes) fill(mesh, parts.get(mesh.name) as BABYLON.Mesh);
            for (const wheel of this.wheels) wheel.rotationQuaternion = null;
        });
    }

    get position() { return this.root.position; }

    // Where its handle is, to be taken hold of.
    get handle() {
        const back = new V3(-Math.cos(this.root.rotation.y), 0, Math.sin(this.root.rotation.y));
        return this.root.position.add(back.scale(SIZE.long / 2 + 0.28)).add(new V3(0, SIZE.high + 0.18, 0));
    }

    // The top of its bed, where a body is laid.
    get bed() { return this.root.position.add(new V3(0, SIZE.high, 0)); }

    take(player) {
        this.pusher = player;
        player.slowed = PACE;
    }

    letGo() {
        if (this.pusher) this.pusher.slowed = 1;
        this.pusher = null;
    }

    // Lay something on it: a TransformNode (a person's root) that goes where it goes.
    carry(node, { lift = 0 } = {}) {
        node.parent = this.root;
        node.position.set(0, SIZE.high + lift, 0);
        // Head to the handle end.
        node.rotation.set(0, Math.PI / 2, 0);
        this.load = node;
    }

    // Ahead of the pusher, turned the way they face, unless something is in the way: then they are held back too.
    update(dt, solids) {
        const player = this.pusher;
        if (!player) return;
        const yaw = player.yaw, ahead = [Math.sin(yaw), Math.cos(yaw)];
        const want = { x: player.pos.x + ahead[0] * AHEAD, z: player.pos.z + ahead[1] * AHEAD };
        // Its far end runs into things first.
        const nose = { x: want.x + ahead[0] * (SIZE.long / 2 - GIRTH), z: want.z + ahead[1] * (SIZE.long / 2 - GIRTH) };
        const before = { ...nose };
        solids.push(nose, GIRTH);
        solids.push(want, GIRTH);
        const back = [nose.x - before.x, nose.z - before.z];
        player.pos.x += back[0];
        player.pos.z += back[1];
        const from = this.root.position.clone();
        this.root.position.set(want.x + back[0], this.ground(want.x, want.z), want.z + back[1]);
        // The wheels roll as far as it went along its length (its far end, +x of its frame, is ahead).
        const along = this.root.position.subtract(from), ry = this.root.rotation.y;
        const rolled = along.x * Math.cos(ry) - along.z * Math.sin(ry);
        for (const wheel of this.wheels) wheel.rotation.x += rolled / WHEEL;
        // The bier's own length runs along -x of its frame, handle first: turn it so the handle faces the pusher.
        let turn = yaw - Math.PI / 2 - this.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.root.rotation.y += turn * Math.min(1, dt * TURNS);
    }
}

// Give `stand`, a mesh handed out before its model had loaded (to the shadows, say), the looks and the place of the
// loaded `part`, which goes; whatever hung on `part` hangs on `stand`.
export function fill(stand: BABYLON.Mesh, part: BABYLON.Mesh) {
    part.geometry.applyToMesh(stand);
    stand.material = part.material;
    stand.sideOrientation = part.sideOrientation;
    stand.parent = part.parent;
    stand.position.copyFrom(part.position);
    stand.rotationQuaternion = part.rotationQuaternion?.clone() ?? null;
    stand.scaling.copyFrom(part.scaling);
    for (const child of part.getChildren()) child.parent = stand;
    part.dispose();
    stand.refreshBoundingInfo();
}
