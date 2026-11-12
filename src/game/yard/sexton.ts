// The sexton: the man in the lodge by the gate.
//
// On the first night he hears the digging. His door opens, and he comes up
// the avenue with a torch, round the chapel, and stands at the corner of it
// with the beam on whoever is in the public ground. He looks for a long
// time. Then he goes back the way he came and shuts his door, and he never
// tells anybody.
//
// He walks a fixed way, at an old man's pace, with a person's walk.

import * as BABYLON from '@babylonjs/core';
import * as P from '../../poses.ts';
import { heightAt } from '../../map/plan.ts';

const V3 = BABYLON.Vector3;
// From his door to where he stands and looks, by the avenue and the chapel's east side.
const WAY = [[-6.1, 9], [-1.6, 9.6], [-1.6, 40], [-1.2, 58], [6.8, 63], [7.6, 78], [9.6, 84]];
const PACE = 1.05;              // metres a second
const STRIDE = 1.35;            // metres a full stride (both feet) takes him
const LOOKS = 16;               // seconds he stands there
const TORCH = { power: 260, cone: 0.5, at: [0.25, 1.15, 0.25] };

export class Sexton {
    declare person: any;
    declare torch: BABYLON.SpotLight;
    declare state: string;
    declare along: number;
    declare waited: number;
    declare phase: number;
    declare length: number;

    constructor(scene, people) {
        this.person = people.make('sexton', { name: 'sexton' });
        this.person.setEnabled(false);
        this.torch = new BABYLON.SpotLight('his torch', V3.Zero(), new V3(0, -0.2, 1), TORCH.cone, 2, scene);
        this.torch.falloffType = BABYLON.Light.FALLOFF_GLTF;
        this.torch.diffuse = new BABYLON.Color3(1, 0.9, 0.72);
        this.torch.intensity = TORCH.power;
        this.torch.range = 50;
        this.torch.setEnabled(false);
        this.state = 'in';
        this.along = 0;             // metres walked along the way
        this.waited = 0;
        this.phase = 0;
        this.length = WAY.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - WAY[i][0], p[1] - WAY[i][1]), 0);
    }

    // He has heard something.
    come() {
        if (this.state !== 'in') return;
        this.state = 'out';
        this.person.setEnabled(true);
        this.torch.setEnabled(true);
    }

    get out() { return this.state !== 'in' && this.state !== 'gone'; }

    // Where he stands, while he is out.
    get standing() { return this.out ? this.person.root.position : null; }

    // `player` is where whoever he is looking for is: he turns to them and shines the torch.
    update(dt, player) {
        if (!this.out) return;
        const walking = this.state === 'out' || this.state === 'back';
        if (walking) {
            this.along += (this.state === 'out' ? 1 : -1) * PACE * dt;
            this.phase += (PACE * dt / STRIDE) * Math.PI * 2;
        }
        if (this.state === 'out' && this.along >= this.length) {
            this.along = this.length;
            this.state = 'looking';
        }
        if (this.state === 'looking' && (this.waited += dt) > LOOKS) this.state = 'back';
        if (this.state === 'back' && this.along <= 0) {
            this.state = 'gone';
            this.person.setEnabled(false);
            this.torch.setEnabled(false);
            return;
        }
        const [x, z, heading] = this._where();
        const facing = this.state === 'looking' ? Math.atan2(player.x - x, player.z - z) : heading;
        const p = this.person;
        p.root.position.set(x, heightAt(x, z), z);
        p.root.rotation.y = facing;
        p.look = this.state === 'looking' ? player : null;
        p.lookWeight = this.state === 'looking' ? 0.8 : 0;
        p.tick(dt);
        p.apply(walking ? { ...P.walk(this.phase, { stride: 0.8, shuffle: 0.2 }), ...this._arm() } : { ...P.stand(this.waited), ...this._arm() });
        // The torch is in his right hand, at his chest, and goes where he is looking.
        const hand = new V3(TORCH.at[0], TORCH.at[1], TORCH.at[2]);
        this.torch.position = V3.TransformCoordinates(hand, p.root.computeWorldMatrix(true));
        const target = this.state === 'looking' ? player.add(new V3(0, -0.6, 0)) : this.torch.position.add(new V3(Math.sin(heading) * 6, -1.4, Math.cos(heading) * 6));
        this.torch.direction = target.subtract(this.torch.position).normalize();
    }

    // His right arm held up and forward, holding the torch out.
    _arm() { return { shoulderFlexR: 40, elbowR: 70, curlR: 60, shoulderAbductR: -20 }; }

    // Where along the way he is: x, z, and which way he is going.
    _where() {
        let left = this.along;
        for (let i = 1; i < WAY.length; i++) {
            const [ax, az] = WAY[i - 1], [bx, bz] = WAY[i], length = Math.hypot(bx - ax, bz - az);
            if (left <= length || i === WAY.length - 1) {
                const t = Math.max(0, Math.min(1, left / length)), back = this.state === 'back' ? Math.PI : 0;
                return [ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(bx - ax, bz - az) + back];
            }
            left -= length;
        }
        return [...WAY[0], 0];
    }

    dispose() {
        this.person.dispose();
        this.torch.dispose();
    }
}
