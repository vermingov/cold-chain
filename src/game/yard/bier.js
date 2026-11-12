// The bier: the cemetery's own wheeled stretcher, kept by the store.
//
// An iron frame on four small wheels with a bed of boards, long enough for
// a coffin, and a handle at one end to push it by. Pushed, it goes ahead of
// whoever has it, turns as they turn, and stops at whatever it runs into,
// and so do they. Whatever is laid on it goes with it.

import { Buf } from '../../geometry.js';

const V3 = BABYLON.Vector3;
const SIZE = { long: 2.0, wide: 0.62, high: 0.72 };
const WHEEL = 0.11;             // radius
const AHEAD = 1.35;             // metres from the pusher's feet to the middle of the bier
const PACE = 0.55;              // of a walk, pushing it
const TURNS = 5;                // how fast it comes round to where the pusher faces
const GIRTH = 0.42;             // how wide it is, for running into things

export class Bier {
    // `at` is [x, z] and `yaw` which way its handle end faces. `ground(x, z)` is the yard's height.
    constructor(scene, surfaces, at, yaw, ground) {
        this.ground = ground;
        this.root = new BABYLON.TransformNode('bier', scene);
        this.root.position.set(at[0], ground(...at), at[1]);
        this.root.rotation.y = yaw;
        this.pusher = null;
        this.load = null;               // what is on it

        const iron = new Buf(), wood = new Buf();
        const l = SIZE.long / 2, w = SIZE.wide / 2, h = SIZE.high;
        // The bed, and the rails it lies in.
        for (let i = 0; i < 6; i++) {
            const z0 = -w + i * (SIZE.wide / 6) + 0.006;
            wood.box([-l, h - 0.04, z0], [l, h, z0 + SIZE.wide / 6 - 0.012], 1.2);
        }
        for (const side of [-1, 1]) iron.bar([-l, h - 0.05, side * w], [l, h - 0.05, side * w], 0.03, 0.04, 1);
        // Legs to the wheels, and the handle at the -x end.
        for (const ex of [-1, 1]) {
            for (const side of [-1, 1]) iron.bar([ex * (l - 0.12), WHEEL, side * (w - 0.04)], [ex * (l - 0.12), h - 0.05, side * (w - 0.04)], 0.025, 0.025, 1);
            iron.bar([ex * (l - 0.12), WHEEL + 0.05, -w + 0.04], [ex * (l - 0.12), WHEEL + 0.05, w - 0.04], 0.025, 0.025, 1);
        }
        iron.tube([[-l, h - 0.05, -w + 0.05], [-l - 0.28, h + 0.18, -w + 0.05], [-l - 0.28, h + 0.18, w - 0.05], [-l, h - 0.05, w - 0.05]], 0.014, 1, { sides: 8 });
        this.wheels = [];
        for (const ex of [-1, 1]) {
            for (const side of [-1, 1]) {
                iron.tube([[ex * (l - 0.12), WHEEL, side * (w - 0.04) - 0.025], [ex * (l - 0.12), WHEEL, side * (w - 0.04) + 0.025]], WHEEL, 1, { sides: 14 });
            }
        }
        this.meshes = [
            iron.toMesh('bier iron', scene, surfaces.material('iron', { tint: [0.3, 0.27, 0.26] })),
            wood.toMesh('bier boards', scene, surfaces.material('post', { tint: [0.6, 0.58, 0.55] })),
        ];
        for (const mesh of this.meshes) mesh.parent = this.root;
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
        this.root.position.set(want.x + back[0], this.ground(want.x, want.z), want.z + back[1]);
        // The bier's own length runs along -x of its frame, handle first: turn it so the handle faces the pusher.
        let turn = yaw - Math.PI / 2 - this.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.root.rotation.y += turn * Math.min(1, dt * TURNS);
    }
}
