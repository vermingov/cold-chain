// The handover at the service gate.
//
// The gate on the east wall is chained, and the service track runs past it
// outside. At the time on the order a van is on the track with its lights
// on the gate, and the buyer stands at the bars. What is in the cooler goes
// through them; money comes back. He says what he thinks of it.

import * as BABYLON from '@babylonjs/core';
import * as P from '../../poses.ts';
import { heightAt } from '../../map/plan.ts';

const V3 = BABYLON.Vector3;
const BUYER: [number, number] = [57.2, 96.2];         // just outside the bars
const VAN = { at: [62.6, 96.2], size: [5.1, 2.05, 1.95] };     // nose to the gate: long (x), high, wide
const LIGHTS = 70;

export class Gate {
    declare buyer: any;
    declare van: BABYLON.Mesh[];
    declare lamps: BABYLON.SpotLight;
    declare clock: number;
    declare waiting: boolean;

    constructor(scene, people) {
        this.buyer = people.make('buyer', { name: 'buyer at the gate' });
        this.buyer.root.position.set(BUYER[0], heightAt(...BUYER), BUYER[1]);
        this.buyer.root.rotation.y = -Math.PI / 2;
        this.van = van(scene);
        // Both headlamps as one light: there is a limit to how many lights a surface can take.
        const [vx, vz] = VAN.at, front = vx - VAN.size[0] / 2;
        this.lamps = new BABYLON.SpotLight('van lamps', new V3(front - 0.1, heightAt(vx, vz) + 0.75, vz), new V3(-1, -0.08, 0).normalize(), 1.0, 2, scene);
        this.lamps.falloffType = BABYLON.Light.FALLOFF_GLTF;
        this.lamps.diffuse = new BABYLON.Color3(1, 0.93, 0.8);
        this.lamps.intensity = LIGHTS;
        this.lamps.range = 40;
        this.clock = 0;
        this.waiting = false;
        this._show(false);
    }

    // The van has come.
    arrive() {
        this.waiting = true;
        this._show(true);
    }

    leave() {
        this.waiting = false;
        this._show(false);
    }

    // Where the bars are that things go through, and where his face is.
    get bars() { return new V3(56, heightAt(56, 96.2) + 1.35, 96.2); }

    // Where he stands, for anybody shining a torch at him.
    get standing() { return this.waiting ? this.buyer.root.position : null; }

    update(dt, player) {
        if (!this.waiting) return;
        this.clock += dt;
        this.buyer.look = player;
        this.buyer.lookWeight = 0.9;
        this.buyer.tick(dt);
        this.buyer.apply(P.stand(this.clock));
    }

    _show(on) {
        this.buyer.setEnabled(on);
        for (const mesh of this.van) mesh.setEnabled(on);
        this.lamps.setEnabled(on);
    }

    dispose() {
        this.buyer.dispose();
        for (const mesh of this.van) mesh.dispose();
        this.lamps.dispose();
    }
}

// A dark panel van, seen at night: a body, a windscreen, two lamps burning. Nothing else of it shows.
function van(scene) {
    const [x, z] = VAN.at, [l, h, w] = VAN.size, ground = heightAt(x, z), front = x - l / 2;
    const paint = new BABYLON.PBRMaterial('van', scene);
    paint.albedoColor = new BABYLON.Color3(0.025, 0.028, 0.03);
    paint.metallic = 0;
    paint.roughness = 0.5;
    paint.environmentIntensity = 0;
    const glass = new BABYLON.PBRMaterial('van glass', scene);
    glass.albedoColor = new BABYLON.Color3(0.01, 0.01, 0.012);
    glass.roughness = 0.05;
    glass.metallic = 0;
    glass.environmentIntensity = 0;
    const lit = new BABYLON.StandardMaterial('van lamp', scene);
    lit.disableLighting = true;
    lit.emissiveColor = new BABYLON.Color3(1, 0.95, 0.85).scale(3);
    const body = BABYLON.MeshBuilder.CreateBox('van', { width: l, height: h - 0.35, depth: w }, scene);
    body.position.set(x, ground + 0.35 + (h - 0.35) / 2, z);
    body.material = paint;
    const screen = BABYLON.MeshBuilder.CreatePlane('windscreen', { width: w - 0.2, height: 0.62 }, scene);
    screen.position.set(front - 0.01, ground + h - 0.45, z);
    screen.rotation.y = Math.PI / 2;
    screen.material = glass;
    const lamps = [-1, 1].map((side) => {
        const lamp = BABYLON.MeshBuilder.CreateDisc('van lamp', { radius: 0.09 }, scene);
        lamp.position.set(front - 0.012, ground + 0.75, z + side * (w / 2 - 0.25));
        lamp.rotation.y = Math.PI / 2;
        lamp.material = lit;
        return lamp;
    });
    const wheels = [-1, 1].flatMap((side) => [-1, 1].map((end) => {
        const wheel = BABYLON.MeshBuilder.CreateCylinder('van wheel', { diameter: 0.66, height: 0.22, tessellation: 18 }, scene);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x + end * (l / 2 - 0.8), ground + 0.33, z + side * (w / 2 - 0.1));
        wheel.material = paint;
        return wheel;
    }));
    return [body, screen, ...lamps, ...wheels];
}
