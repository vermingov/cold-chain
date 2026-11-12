// The handover at the service gate.
//
// The gate on the east wall is chained, and the service track runs past it
// outside. At the time on the order a van is on the track with its lights
// on the gate, and the buyer stands at the bars. What is in the cooler goes
// through them; money comes back. He says what he thinks of it.

import * as BABYLON from '@babylonjs/core';
import * as P from '../../poses.ts';
import { heightAt } from '../../map/plan.ts';
import { place } from '../../glb.ts';

const V3 = BABYLON.Vector3;
const BUYER: [number, number] = [57.2, 96.2];         // just outside the bars
const VAN = { at: [62.6, 96.2], size: [5.1, 2.05, 1.95] };     // nose to the gate: long (x), high, wide
const LIGHTS = 70;
const WHEELS = { front: -1.95, back: 1.6, track: 0.82 };    // the model's axles along its length from its middle, and half its track

export class Gate {
    declare buyer: any;
    declare van: BABYLON.TransformNode;
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
        this.van.setEnabled(on);
        this.lamps.setEnabled(on);
    }

    dispose() {
        this.buyer.dispose();
        this.van.dispose();
        this.lamps.dispose();
    }
}

// The forged van (tools/forge/models/yard.py), nose to the gate (-x), its lamps lit, sat on the track as it lies
// under its four wheels.
function van(scene) {
    const [x, z] = VAN.at, holder = new BABYLON.TransformNode('van', scene);
    const ground = (ax, side) => heightAt(x + ax, z + side * WHEELS.track);
    const front = (ground(WHEELS.front, -1) + ground(WHEELS.front, 1)) / 2, back = (ground(WHEELS.back, -1) + ground(WHEELS.back, 1)) / 2;
    const left = (ground(WHEELS.front, 1) + ground(WHEELS.back, 1)) / 2, right = (ground(WHEELS.front, -1) + ground(WHEELS.back, -1)) / 2;
    const length = WHEELS.back - WHEELS.front;
    holder.position.set(x, front + (back - front) * (-WHEELS.front / length), z);
    holder.rotation.set(-Math.atan2(left - right, 2 * WHEELS.track), 0, Math.atan2(back - front, length));
    const fit = new BABYLON.TransformNode('van model', scene);
    fit.parent = holder;
    fit.rotation.y = -Math.PI / 2;
    place(scene, 'props/van').then(({ root }) => { root.parent = fit; });
    return holder;
}
