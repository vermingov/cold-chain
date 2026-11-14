// The flash at a gun's muzzle, and the puff of gas and smoke after it (dev/research/muzzle-flash.md).
//
// A real flash lasts one to three milliseconds, so it is drawn for one frame: a hot core at the muzzle face (the
// primary flash), a reddish knot a few centimetres out where the gas stands behind its Mach disc (the intermediate
// flash), and, for ammunition without flash suppressant, a faint larger haze of afterburn (secondary flash). Its shape
// is the muzzle's: an open crown throws a cone, an A2 birdcage splits it into tongues out of its five slots (none down),
// a 12 bore a big orange ball. What it lights is the point light weapons.ts already has; after it, a few grey puffs
// that drift and thin, and on some guns sparks of unburnt powder. Everything is made once, at load: a shot only moves
// what exists, so it costs no new meshes, materials or shaders.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3, C4 = BABYLON.Color4;

// Per gun, in metres: `long` how far forward the side view reaches, `high` its height, `face` the end-on view's width,
// `back` how far behind the muzzle face the side view starts (the birdcage vents through slots up to 4 cm back),
// `core` the primary flash's radius, `knot` the intermediate flash's distance out (0: none, the birdcage breaks up the
// shock bottle), `haze` the secondary flash's radius (0: suppressed), `light` the lamp's peak, `puffs` and `sparks`.
// Sizes are estimates from photographs and the phases' descriptions (no measured sizes were found, see the notes).
type Look = { long: number; high: number; face: number; back: number; core: number; knot: number; haze: number; light: number; puffs: number;
    sparks: number; slots?: boolean; ball?: boolean };
const LOOKS: Record<string, Look> = {
    pistol: { long: 0.1, high: 0.06, face: 0.06, back: 0.005, core: 0.012, knot: 0.035, haze: 0, light: 10, puffs: 2, sparks: 2 },
    m4: { long: 0.08, high: 0.09, face: 0.09, back: 0.04, core: 0.009, knot: 0, haze: 0, light: 12, puffs: 3, sparks: 0, slots: true },
    ak: { long: 0.24, high: 0.12, face: 0.13, back: 0.005, core: 0.02, knot: 0.075, haze: 0.05, light: 35, puffs: 4, sparks: 5 },
    rifle: { long: 0.26, high: 0.11, face: 0.12, back: 0.005, core: 0.022, knot: 0.1, haze: 0.03, light: 45, puffs: 4, sparks: 3 },
    shotgun: { long: 0.34, high: 0.24, face: 0.26, back: 0.005, core: 0.05, knot: 0, haze: 0.11, light: 60, puffs: 6, sparks: 24, ball: true },
    // .50 AE from a 6 inch barrel: a big charge of slow pistol powder still burning at the muzzle, a ball of flame and
    // afterburn bigger than a rifle's from the side, sparks of unburnt powder. A .22 LR from an 18.5 inch barrel has burnt
    // nearly all its few grains: a pinprick, hardly any light or smoke (estimates from photographs, as above).
    deagle: { long: 0.24, high: 0.17, face: 0.19, back: 0.005, core: 0.03, knot: 0.08, haze: 0.07, light: 55, puffs: 5, sparks: 10 },
    r22: { long: 0.03, high: 0.018, face: 0.018, back: 0.003, core: 0.0035, knot: 0, haze: 0, light: 1.5, puffs: 1, sparks: 0 },
};
const VARIANTS = 4, ROW = 128, ATLAS = 512;   // four takes a gun, each a row of the atlas: the end-on view, then the side
const shotDice = seeded(20261113);

export class Muzzle {
    declare flames: Map<string, BABYLON.Mesh>;
    declare smoke: BABYLON.ParticleSystem;
    declare sparks: BABYLON.ParticleSystem;
    declare scene: BABYLON.Scene;
    declare shown: BABYLON.Mesh | null;

    constructor(scene: BABYLON.Scene, hand: BABYLON.TransformNode) {
        this.scene = scene;
        this.flames = new Map();
        this.shown = null;
        for (const [key, look] of Object.entries(LOOKS)) {
            const t = new BABYLON.DynamicTexture('muzzle_' + key, { width: ATLAS, height: ATLAS }, scene, false);
            draw(t.getContext() as CanvasRenderingContext2D, look, key);
            t.hasAlpha = true;
            t.update();
            const m = new BABYLON.StandardMaterial('muzzle_' + key, scene);
            m.emissiveTexture = t;
            m.opacityTexture = t;
            m.disableLighting = true;
            m.backFaceCulling = false;
            m.alphaMode = BABYLON.Engine.ALPHA_ADD;
            m.disableDepthWrite = true;
            const mesh = flame(scene, look, key);
            mesh.material = m;
            mesh.parent = hand;
            mesh.isPickable = false;
            mesh.alwaysSelectAsActiveMesh = true;
            mesh.setEnabled(false);
            this.flames.set(key, mesh);
        }
        // The gas and smoke: soft grey puffs out along the bore, rising a little, swelling and thinning over a second or
        // so. Lit by nothing: a little grey at low opacity reads as smoke under the hall's lamps.
        this.smoke = new BABYLON.ParticleSystem('muzzleSmoke', 64, scene);
        this.smoke.particleTexture = puffTexture(scene);
        this.smoke.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        this.smoke.emitter = V3.Zero();
        this.smoke.createPointEmitter(V3.Forward(), V3.Forward());
        this.smoke.emitRate = 0;
        this.smoke.minLifeTime = 0.7; this.smoke.maxLifeTime = 1.4;
        this.smoke.minSize = 0.03; this.smoke.maxSize = 0.06;
        this.smoke.addSizeGradient(0, 1); this.smoke.addSizeGradient(1, 5);
        this.smoke.addColorGradient(0, new C4(0.62, 0.6, 0.58, 0.16));
        this.smoke.addColorGradient(1, new C4(0.55, 0.55, 0.55, 0));
        this.smoke.minEmitPower = 0.3; this.smoke.maxEmitPower = 0.9;
        this.smoke.minAngularSpeed = -0.6; this.smoke.maxAngularSpeed = 0.6;
        this.smoke.minInitialRotation = 0; this.smoke.maxInitialRotation = Math.PI * 2;
        this.smoke.gravity = new V3(0, 0.08, 0);       // warm gas rising (an estimate)
        this.smoke.updateSpeed = 1 / 60;
        this.smoke.start();
        // Unburnt powder and fouling thrown out burning: short bright streaks that fall and go out within a fifth of a second.
        this.sparks = new BABYLON.ParticleSystem('muzzleSparks', 128, scene);
        this.sparks.particleTexture = sparkTexture(scene);
        this.sparks.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        this.sparks.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_STRETCHED;
        this.sparks.emitter = V3.Zero();
        this.sparks.createPointEmitter(V3.Forward(), V3.Forward());
        this.sparks.emitRate = 0;
        this.sparks.minLifeTime = 0.04; this.sparks.maxLifeTime = 0.2;
        this.sparks.minSize = 0.002; this.sparks.maxSize = 0.004;
        this.sparks.minScaleY = 4; this.sparks.maxScaleY = 9;
        this.sparks.color1 = new C4(1, 0.8, 0.45, 1); this.sparks.color2 = new C4(1, 0.6, 0.25, 1);
        this.sparks.colorDead = new C4(0.6, 0.2, 0.05, 0);
        this.sparks.minEmitPower = 6; this.sparks.maxEmitPower = 18;
        this.sparks.gravity = new V3(0, -9.81, 0);
        this.sparks.updateSpeed = 1 / 120;
        this.sparks.start();
    }

    // A shot from gun `key`, its muzzle at `tip` in the hand's frame (the bore along the hand's +z), `at` the muzzle and
    // `ahead` the bore in the world. Returns the lamp's peak for this gun.
    fire(key: string, tip: BABYLON.Vector3, at: BABYLON.Vector3, ahead: BABYLON.Vector3) {
        const look = LOOKS[key] ?? LOOKS.pistol, mesh = this.flames.get(key) ?? this.flames.get('pistol');
        this.shown?.setEnabled(false);
        mesh.position.copyFrom(tip);
        // Each shot its own take, size and (but for the birdcage, whose slots are where they are) turn about the bore.
        // (Its own dice, so how a flash looks never changes what the game's own random numbers do next.)
        mesh.rotation.z = look.slots ? 0 : shotDice() * Math.PI * 2;
        mesh.scaling.setAll(0.8 + shotDice() * 0.4);
        mesh.updateVerticesData(BABYLON.VertexBuffer.UVKind, uvs(look, Math.floor(shotDice() * VARIANTS)));
        mesh.setEnabled(true);
        this.shown = mesh;
        // Shown in the next frame drawn, then gone.
        this.scene.onAfterRenderObservable.addOnce(() => { if (this.shown === mesh) { mesh.setEnabled(false); this.shown = null; } });
        const side = V3.Cross(ahead, V3.Up()).normalize(), up = V3.Cross(side, ahead).normalize();
        const spread = (v: BABYLON.Vector3, k: number) => v.add(side.scale(k)).add(up.scale(k)).normalize();
        (this.smoke.emitter as BABYLON.Vector3).copyFrom(at.add(ahead.scale(0.03)));
        const smokeFrom = this.smoke.particleEmitterType as BABYLON.PointParticleEmitter;
        smokeFrom.direction1 = spread(ahead.add(up.scale(0.2)), -0.35);
        smokeFrom.direction2 = spread(ahead.add(up.scale(0.3)), 0.35);
        this.smoke.manualEmitCount = look.puffs;
        if (look.sparks) {
            (this.sparks.emitter as BABYLON.Vector3).copyFrom(at);
            const sparkFrom = this.sparks.particleEmitterType as BABYLON.PointParticleEmitter;
            sparkFrom.direction1 = spread(ahead, -0.25);
            sparkFrom.direction2 = spread(ahead, 0.25);
            this.sparks.manualEmitCount = Math.round(look.sparks * (0.5 + shotDice()));
        }
        return look.light;
    }
}

// The flame's cards in the muzzle's frame (+z along the bore): a vertical side view, a horizontal one made of two halves
// each running from the bore out (so the birdcage's tongues, drawn only upward, show on both sides and never below), and
// an end-on card just ahead of the muzzle face.
function flame(scene: BABYLON.Scene, look: Look, key: string) {
    const { long, high, face, back } = look, h = high / 2, f = face / 2, z0 = -back, z1 = long, zf = 0.004;
    const positions = [
        0, -h, z0, 0, h, z0, 0, h, z1, 0, -h, z1,          // vertical
        0, 0, z0, -h, 0, z0, -h, 0, z1, 0, 0, z1,          // horizontal, left half
        0, 0, z0, h, 0, z0, h, 0, z1, 0, 0, z1,            // and right
        -f, -f, zf, -f, f, zf, f, f, zf, f, -f, zf,        // end-on
    ];
    const indices = [];
    for (let q = 0; q < 4; q++) indices.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    const mesh = new BABYLON.Mesh('muzzleFlash_' + key, scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = uvs(look, 0);
    data.applyToMesh(mesh, true);
    return mesh;
}

// The cards' places in the atlas for take `row`: the end-on view in its first ROW pixels, the side view in the rest,
// the bore along the side view's middle (canvas y down, texture v up).
function uvs(look: Look, row: number) {
    const top = row * ROW, u = (px: number) => px / ATLAS, v = (py: number) => 1 - py / ATLAS;
    const s0 = u(ROW), s1 = u(ATLAS), mid = v(top + ROW / 2), up = v(top), down = v(top + ROW);
    return [
        s0, down, s0, up, s1, up, s1, down,
        s0, mid, s0, up, s1, up, s1, mid,
        s0, mid, s0, up, s1, up, s1, mid,
        u(0), down, u(0), up, u(ROW), up, u(ROW), down,
    ];
}

// A soft glowing patch: an ellipse `rx` by `ry` pixels at (x, y), turned `turn`, from `inner` at its middle to nothing.
function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, inner: string, mid: string, turn = 0) {
    g.save();
    g.translate(x, y);
    g.rotate(turn);
    g.scale(rx, ry);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.45, mid);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
}

// The atlas: VARIANTS takes of the end-on view and the side view, drawn from the phases (research note), added up as
// light adds up. Colours: the core near white (hottest), the cone yellow-orange, the Mach knot reddish orange, the
// afterburn a dim orange.
function draw(g: CanvasRenderingContext2D, look: Look, key: string) {
    g.clearRect(0, 0, ATLAS, ATLAS);
    g.globalCompositeOperation = 'lighter';
    const rnd = seeded(key.length * 977 + key.charCodeAt(0));
    const CORE = ['rgba(255,250,232,1)', 'rgba(255,214,140,0.75)'], CONE = ['rgba(255,196,96,0.55)', 'rgba(255,140,48,0.3)'];
    const KNOT = ['rgba(255,150,70,0.7)', 'rgba(230,80,30,0.35)'], HAZE = ['rgba(255,140,60,0.16)', 'rgba(200,80,30,0.08)'];
    for (let row = 0; row < VARIANTS; row++) {
        const top = row * ROW;
        // End-on: what the shooter mostly sees, the bore pointing away.
        const fx = ROW / 2, fy = top + ROW / 2, fk = ROW / look.face;     // pixels a metre
        if (look.haze) for (let i = 0; i < 6; i++) blob(g, fx + (rnd() - 0.5) * look.haze * fk * 0.6, fy + (rnd() - 0.5) * look.haze * fk * 0.6, look.haze * fk * (0.5 + rnd() * 0.3), look.haze * fk * (0.4 + rnd() * 0.3), HAZE[0], HAZE[1], rnd() * 6);
        if (look.slots) {
            // Five tongues through the birdcage's slots, sixty degrees apart from the top, none through its closed bottom.
            for (const a of [0, 60, -60, 120, -120]) {
                const t = (a * Math.PI) / 180, len = look.core * fk * (2.4 + rnd() * 1.4);
                blob(g, fx + Math.sin(t) * len * 0.75, fy - Math.cos(t) * len * 0.75, len * 0.7, look.core * fk * 0.35, CONE[0], CONE[1], t - Math.PI / 2);
            }
        } else {
            const n = look.ball ? 14 : 9;
            for (let i = 0; i < n; i++) {
                const t = rnd() * Math.PI * 2, r = look.core * fk * (look.ball ? 1.2 + rnd() * 1.6 : 0.9 + rnd() * 1.1);
                blob(g, fx + Math.cos(t) * r * 0.6, fy + Math.sin(t) * r * 0.6, r * (0.5 + rnd() * 0.4), r * (0.3 + rnd() * 0.3), CONE[0], CONE[1], t);
            }
            if (look.knot) blob(g, fx, fy, look.core * fk * 1.6, look.core * fk * 1.6, KNOT[1], 'rgba(200,70,25,0.15)');
        }
        blob(g, fx, fy, look.core * fk * (look.ball ? 1.4 : 1), look.core * fk * (look.ball ? 1.3 : 1), CORE[0], CORE[1]);
        // From the side: the bore along the middle, the muzzle face `back` from the left edge.
        const sk = (ATLAS - ROW) / (look.long + look.back), sx = ROW + look.back * sk, sy = top + ROW / 2;
        if (look.haze) for (let i = 0; i < 7; i++) {
            const x = sx + (look.knot || look.core * 3) * sk + rnd() * look.haze * sk * 1.6;
            blob(g, x, sy + (rnd() - 0.5) * look.haze * sk * 0.6, look.haze * sk * (0.5 + rnd() * 0.4), look.haze * sk * (0.35 + rnd() * 0.3), HAZE[0], HAZE[1], (rnd() - 0.5) * 0.8);
        }
        if (look.slots) {
            // The tongues come out of the slots along the last few centimetres, up and out, and a small core ahead.
            for (let i = 0; i < 4; i++) {
                const x = sx - (0.008 + i * 0.009) * sk, len = look.core * sk * (2.2 + rnd() * 1.6);
                blob(g, x + len * 0.25, sy - len * 0.7, len * 0.75, look.core * sk * 0.3, CONE[0], CONE[1], -Math.PI / 2 + 0.35 + (rnd() - 0.5) * 0.3);
            }
        } else {
            // The cone of hot gas forward, broken up, then the Mach knot: a disc dished toward the gun.
            const reach = (look.knot || look.core * 4) * (0.9 + rnd() * 0.3);
            for (let i = 0; i < (look.ball ? 16 : 10); i++) {
                const along = rnd() * reach, w = look.core * (look.ball ? 1.2 : 0.7) * (0.6 + along / reach);
                blob(g, sx + along * sk, sy + (rnd() - 0.5) * w * sk * 0.8, w * sk * (0.8 + rnd() * 0.6), w * sk * (0.5 + rnd() * 0.4), CONE[0], CONE[1], (rnd() - 0.5) * 0.5);
            }
            if (look.knot) blob(g, sx + look.knot * sk, sy, look.core * sk * 0.55, look.core * sk * 1.25, KNOT[0], KNOT[1]);
        }
        blob(g, sx + look.core * sk * 0.5, sy, look.core * sk * (look.ball ? 1.5 : 1.15), look.core * sk * (look.ball ? 1.3 : 0.9), CORE[0], CORE[1]);
    }
    g.globalCompositeOperation = 'source-over';
}

function puffTexture(scene: BABYLON.Scene) {
    const t = new BABYLON.DynamicTexture('muzzlePuff', { width: 64, height: 64 }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D, rnd = seeded(7);
    g.clearRect(0, 0, 64, 64);
    // Lumpy, not a clean disc: a few overlapping soft blobs.
    for (let i = 0; i < 7; i++) blob(g, 32 + (rnd() - 0.5) * 18, 32 + (rnd() - 0.5) * 18, 12 + rnd() * 9, 11 + rnd() * 8, 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.22)', rnd() * 6);
    t.hasAlpha = true;
    t.update();
    return t;
}

function sparkTexture(scene: BABYLON.Scene) {
    const t = new BABYLON.DynamicTexture('muzzleSpark', { width: 16, height: 16 }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D;
    g.clearRect(0, 0, 16, 16);
    blob(g, 8, 8, 8, 8, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.5)');
    t.hasAlpha = true;
    t.update();
    return t;
}

function seeded(s: number) {
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
