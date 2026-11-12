// The night over the yard.
//
// A winter night under broken cloud lit from below: the town's sodium glow
// along the southern sky, a moon that is a brighter patch rather than a
// disc, and mist that takes everything by sixty metres. The mist is paler
// than anything standing in it, so a stone or a tree is a dark shape on a
// grey one long before the torch finds it. The moon is the only light that
// reaches the whole place and it is nearly nothing. Everything a player can
// actually see by, they are carrying or walking toward.

import * as BABYLON from '@babylonjs/core';
import { makeRng } from '../rng.ts';
import { layered } from '../noise.ts';

const V3 = BABYLON.Vector3;
// The engine takes a fog colour as it would be seen, not as light.
const FOG = new BABYLON.Color3(0.12, 0.145, 0.19);
const MOON_FROM = new V3(0.42, 0.62, 0.66).normalize();     // where it stands: north-east, a third of the way up
const SHADOWED = 64;            // metres of yard round the player the moon's shadows cover

// Where things are on the sky's picture, as fractions of its width and
// height, counted from the zenith down: the first half is the sky and the
// second is under the horizon.
// The town is due south, behind anyone walking in from the gate.
const SKY = { width: 1024, height: 512, moon: [0.09, 0.3], town: 0.5 };
// Colours, 0 to 255, before the cloud is painted into them. The horizon is
// the mist's own colour, so the wall goes into the sky without a line.
const ZENITH = [12, 16, 28], HORIZON = [40, 50, 68], MOONLIGHT = [200, 220, 255], SODIUM = [190, 104, 36], CLOUDLIT = [80, 92, 118];

// Cloud, the moon behind it and the town under it, painted pixel by pixel.
function skyTexture(scene) {
    const { width: W, height: H } = SKY;
    const tex = new BABYLON.DynamicTexture('sky', { width: W, height: H }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const image = ctx.createImageData(W, H);
    // The cloud tiles round the sky, so there is no seam where it meets itself.
    const cloud = layered(makeRng(613), [4, 9, 19, 41]);
    const horizon = H / 2;
    for (let y = 0; y < H; y++) {
        const up = Math.max(0, 1 - y / horizon);            // 1 overhead, 0 at the horizon and below
        for (let x = 0; x < W; x++) {
            const u = x / W;
            // Stretched sideways: cloud seen from under is long and low.
            const thick = Math.min(1, Math.max(0, (cloud(u, y / horizon * 0.35) - 0.3) * 2.2));
            const round = Math.min(Math.abs(u - SKY.moon[0]), 1 - Math.abs(u - SKY.moon[0]));
            const fromMoon = Math.hypot(round * 2, (y / H - SKY.moon[1]) * 2.4);
            const moon = Math.exp(-((fromMoon / 0.1) ** 2)) * (1 - 0.7 * thick) + Math.exp(-((fromMoon / 0.34) ** 2)) * 0.16 * thick;
            const fromTown = Math.min(Math.abs(u - SKY.town), 1 - Math.abs(u - SKY.town));
            // The town is all round the walls, brightest to the south where the main road is: its glow is on the
            // underside of the cloud low down everywhere.
            const town = (Math.exp(-((fromTown / 0.085) ** 2)) + 0.3) * (1 - up) ** 5 * (0.25 + 0.75 * thick);
            // Cloud near the moon has its edges lit; elsewhere it is only a little paler than the gaps.
            const lit = thick * (1 - thick * 0.5) * (0.25 + 0.75 * Math.exp(-((fromMoon / 0.5) ** 2)));
            // The dome reads the picture from the bottom up.
            const o = ((H - 1 - y) * W + x) * 4;
            for (let c = 0; c < 3; c++) {
                const base = HORIZON[c] + (ZENITH[c] - HORIZON[c]) * up ** 0.55;
                const sky = base * (0.5 + 0.4 * thick) + CLOUDLIT[c] * lit + MOONLIGHT[c] * moon + SODIUM[c] * town;
                image.data[o + c] = Math.min(255, sky);
            }
            image.data[o + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    tex.update(true);
    return tex;
}

// Whether any of a mesh (by its bounds, thin instances and all) is within `far` metres of (x, z) across the ground.
function near(mesh, x, z, far) {
    const box = mesh.getBoundingInfo().boundingBox, lo = box.minimumWorld, hi = box.maximumWorld;
    const dx = Math.max(lo.x - x, 0, x - hi.x), dz = Math.max(lo.z - z, 0, z - hi.z);
    return dx * dx + dz * dz < far * far;
}

export class Night {
    declare scene: any;
    declare camera: any;
    declare moon: BABYLON.DirectionalLight;
    declare shadows: BABYLON.ShadowGenerator;
    declare fill: BABYLON.HemisphericLight;
    declare drawnAt: any;
    declare casters: BABYLON.AbstractMesh[];

    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        scene.clearColor = new BABYLON.Color4(FOG.r, FOG.g, FOG.b, 1);
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        scene.fogColor = FOG;
        scene.fogDensity = 0.017;

        const dome = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 700, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
        const sky = new BABYLON.StandardMaterial('sky', scene);
        sky.emissiveTexture = skyTexture(scene);
        sky.diffuseColor = BABYLON.Color3.Black();
        sky.specularColor = BABYLON.Color3.Black();
        sky.disableLighting = true;
        sky.fogEnabled = false;
        dome.material = sky;
        dome.infiniteDistance = true;
        dome.isPickable = false;
        // Turn the dome so its moon is where the moonlight comes from.
        dome.rotation.y = Math.atan2(MOON_FROM.x, MOON_FROM.z) - (SKY.moon[0] * 2 - 1) * Math.PI + Math.PI / 2;

        const moon = new BABYLON.DirectionalLight('moon', MOON_FROM.scale(-1), scene);
        moon.intensity = 0.8;
        moon.diffuse = new BABYLON.Color3(0.55, 0.68, 1.0);
        moon.specular = new BABYLON.Color3(0.4, 0.5, 0.75);
        moon.shadowMinZ = 1;
        moon.shadowMaxZ = 220;
        moon.autoUpdateExtends = false;
        moon.orthoLeft = -SHADOWED / 2; moon.orthoRight = SHADOWED / 2;
        moon.orthoBottom = -SHADOWED / 2; moon.orthoTop = SHADOWED / 2;
        this.moon = moon;

        const shadows = new BABYLON.ShadowGenerator(2048, moon);
        shadows.usePercentageCloserFiltering = true;
        shadows.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
        shadows.bias = 0.0015;
        shadows.normalBias = 0.03;
        shadows.darkness = 0;
        this.shadows = shadows;

        // What comes back off the cloud: no direction, almost no strength.
        const fill = new BABYLON.HemisphericLight('cloud', new V3(0, 1, 0), scene);
        fill.intensity = 0.13;
        fill.diffuse = new BABYLON.Color3(0.5, 0.6, 0.85);
        fill.groundColor = new BABYLON.Color3(0.05, 0.05, 0.06);
        fill.specular = BABYLON.Color3.Black();
        this.fill = fill;
    }

    cast(meshes) { for (const m of meshes) this.shadows.addShadowCaster(m, true); }

    // The moon's shadows are drawn for the stretch of yard round the player,
    // and that stretch moves in whole steps: moved smoothly, every shadow
    // edge in the place crawls. Nothing under the moon moves, so they are
    // drawn again only when the stretch does, of what stands in it.
    update() {
        const step = SHADOWED / 2048 * 64;
        const at = this.camera.position;
        const x = Math.round(at.x / step) * step, z = Math.round(at.z / step) * step;
        if (x === this.drawnAt?.x && z === this.drawnAt?.z) return;
        this.drawnAt = { x, z };
        this.moon.position = new V3(x, 0, z).add(MOON_FROM.scale(120));
        const map = this.shadows.getShadowMap();
        if (!this.casters) this.casters = map.renderList.slice();
        map.renderList = this.casters.filter((mesh) => near(mesh, x, z, SHADOWED * 0.75));
        map.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        map.resetRefreshCounter();
    }
}
