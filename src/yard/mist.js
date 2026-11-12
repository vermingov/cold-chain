// Ground mist.
//
// The fog of the night (night.js) takes the distance; this is the other kind
// of December mist, the kind that lies in a cemetery: knee-deep, in drifts,
// pooling between the stones and moving with what little air there is.
// Soft clouds of it are kept round whoever is walking, low over the ground,
// each drifting slowly and fading in and out over its own long life, so the
// place never looks the same twice.

import { heightAt } from '../map/plan.js';

const COUNT = 150;
const AROUND = 34;          // metres round the eye the drifts are kept in
const SIZE = [3.5, 8];      // metres across a drift
const HIGH = [0.05, 0.9];   // metres its middle is off the ground
const LIFE = [18, 34];      // seconds a drift lasts
const DRIFT = [0.12, 0.05]; // metres a second it moves with the air (east, north)
const COLOUR = [0.42, 0.47, 0.56];
const THICK = 0.11;         // how much of what is behind it a drift hides, at its thickest

// A soft round blot, white in the middle and nothing at its edge, a little uneven.
function puff(scene) {
    const size = 128, tex = new BABYLON.DynamicTexture('mist puff', { width: size, height: size }, scene, true);
    const ctx = tex.getContext();
    for (let i = 0; i < 7; i++) {
        const x = size / 2 + (Math.random() - 0.5) * size * 0.3, y = size / 2 + (Math.random() - 0.5) * size * 0.2;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * (0.25 + Math.random() * 0.2));
        glow.addColorStop(0, 'rgba(255,255,255,0.35)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, size, size);
    }
    tex.hasAlpha = true;
    tex.update(true);
    return tex;
}

export class Mist {
    constructor(scene, camera) {
        this.camera = camera;
        const mist = new BABYLON.ParticleSystem('mist', COUNT, scene);
        mist.particleTexture = puff(scene);
        mist.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        mist.isBillboardBased = true;
        mist.minSize = SIZE[0];
        mist.maxSize = SIZE[1];
        mist.minLifeTime = LIFE[0];
        mist.maxLifeTime = LIFE[1];
        mist.emitRate = COUNT / ((LIFE[0] + LIFE[1]) / 2);
        mist.minEmitPower = 0;
        mist.maxEmitPower = 0;
        mist.gravity = new BABYLON.Vector3(DRIFT[0], 0, DRIFT[1]);
        mist.minAngularSpeed = -0.02;
        mist.maxAngularSpeed = 0.02;
        mist.minInitialRotation = 0;
        mist.maxInitialRotation = Math.PI * 2;
        const [r, g, b] = COLOUR;
        // In from nothing, thickest in the middle of its life, out to nothing.
        mist.addColorGradient(0, new BABYLON.Color4(r, g, b, 0));
        mist.addColorGradient(0.4, new BABYLON.Color4(r, g, b, THICK));
        mist.addColorGradient(0.7, new BABYLON.Color4(r, g, b, THICK));
        mist.addColorGradient(1, new BABYLON.Color4(r, g, b, 0));
        // Each drift starts anywhere round the eye, on the ground there.
        mist.startPositionFunction = (world, position) => {
            const at = this.camera.globalPosition, a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * AROUND;
            const x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
            position.set(x, heightAt(x, z) + HIGH[0] + Math.random() * (HIGH[1] - HIGH[0]), z);
        };
        mist.preWarmCycles = 400;
        mist.preWarmStepOffset = 10;
        mist.start();
        this.system = mist;
    }

    dispose() { this.system.dispose(); }
}
