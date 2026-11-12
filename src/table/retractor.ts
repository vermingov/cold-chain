// Retractors: what holds a wound open while both hands are busy in it.
//
// A belly cut down the middle gapes a few millimetres and no more: the wall
// is under tension and its edges are held. To work inside it, its lips are
// drawn back and held there. A retractor is hooked over a lip, drawn out as
// far as the hand pulls it, and left: it keeps what it has where it was
// left (tissue.js holds it as a hand would), and the hand is free for the
// knife. Hooked again where one already holds, it is taken out, and the lip
// goes back.
//
// Each is a flat steel blade lying out over the skin from the lip, the way
// it pulls, its end turned down into the wound.

import * as BABYLON from '@babylonjs/core';
import { Buf } from '../geometry.ts';

const V3 = BABYLON.Vector3;
const BLADE = { wide: 0.016, long: 0.075, thick: 0.0015, hook: 0.018, lift: 0.004 };
// (Brushed steel under one lamp and nothing round it to reflect: lit as a grey thing, or it is a white bar.)
const STEEL = { colour: [0.36, 0.37, 0.38], rough: 0.45 };

// One retractor, its hooked end at the origin, lying out along +z, its back up.
function bladeMesh(scene) {
    const buf = new Buf(), { wide, long, thick, hook } = BLADE;
    buf.box([-wide / 2, 0, 0], [wide / 2, thick, long], 0.05);
    buf.box([-wide / 2, -hook, -thick], [wide / 2, 0, 0], 0.05);
    // The handle it is held by, at the far end, bent up.
    buf.box([-0.004, thick, long - 0.004], [0.004, 0.03, long], 0.05);
    const material = new BABYLON.PBRMaterial('retractor', scene);
    material.albedoColor = BABYLON.Color3.FromArray(STEEL.colour);
    material.metallic = 0;
    material.roughness = STEEL.rough;
    material.environmentIntensity = 0;
    const mesh = buf.toMesh('retractor', scene, material);
    mesh.useVertexColors = false;
    mesh.isVisible = false;
    return mesh;
}

export class Retractor {
    declare scene: any;
    declare camera: any;
    declare field: any;
    declare source: BABYLON.Mesh;
    declare blades: any[];
    declare pointer: any[];
    declare down: boolean;
    declare from: any[];
    declare shown: boolean;
    declare placed: number;

    constructor(scene, camera, field) {
        this.scene = scene;
        this.camera = camera;
        this.field = field;
        this.source = bladeMesh(scene);
        this.blades = [];               // one shown for each retractor in, and the one in the hand last
        this.pointer = null;
        this.down = false;
        this.from = null;               // [u, v] where the lip being drawn back was hooked
        this.shown = true;
        this.placed = 0;                // goes up whenever one is left in
    }

    get meshes() { return this.blades; }

    show(shown) { this.shown = shown; }

    aim(x, y) { this.pointer = [x, y]; }

    press(down) {
        const pressed = down && !this.down;
        this.down = down;
        if (pressed && this.pointer) {
            const skin = this.field.hit(this._ray());
            if (!skin || this.field.unpin(skin.u, skin.v)) return;
            if (this.field.grab(skin.u, skin.v)) this.from = [skin.u, skin.v];
        } else if (!down && this.from) {
            this.from = null;
            if (this.field.pin()) this.placed++;
        }
    }

    _ray() { return this.scene.createPickingRay(this.pointer[0], this.pointer[1], null, this.camera); }

    // While it is the tool in use: the lip being drawn back follows the hand.
    update() {
        const skin = this.from && this.pointer && this.field.hit(this._ray());
        if (skin) this.field.drag(skin.u - this.from[0], skin.v - this.from[1]);
    }

    // Every frame, whatever is in use: every retractor that is in, where its lip has got to, and, while this is the
    // tool in use, the one in the hand (on the lip being drawn, or over the skin where it would go in).
    draw() {
        const skin = this.shown && this.pointer && this.field.hit(this._ray());
        const lying = this.field.pinned;
        if (skin) lying.push({ at: [skin.u, skin.v], pulls: this.from ? [skin.u - this.from[0], skin.v - this.from[1]] : [0, 0] });
        while (this.blades.length < lying.length) {
            const blade = this.source.createInstance('retractor');
            blade.rotationQuaternion = BABYLON.Quaternion.Identity();
            this.blades.push(blade);
        }
        this.blades.forEach((blade, i) => {
            blade.setEnabled(i < lying.length);
            if (i < lying.length) this._lay(blade, lying[i]);
        });
    }

    // Lay one blade at a lip, out the way it pulls (or toward the eye, when it pulls nowhere yet).
    _lay(blade, { at: [u, v], pulls: [du, dv] }) {
        const lip = this.field.point(u, v), up = this.field.normal(u, v), far = Math.hypot(du, dv);
        let out = far > 1e-4 ? this.field.point(u + du / far * 0.02, v + dv / far * 0.02).subtract(lip) : this.camera.position.subtract(lip);
        out = out.subtract(up.scale(V3.Dot(out, up)));
        if (out.lengthSquared() < 1e-10) out = V3.Forward();
        out.normalize();
        const side = V3.Cross(up, out).normalize();
        BABYLON.Quaternion.RotationQuaternionFromAxisToRef(side, up, out, blade.rotationQuaternion);
        blade.position.copyFrom(lip.add(up.scale(BLADE.lift)));
    }
}
