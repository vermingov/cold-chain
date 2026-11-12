// The sandbox: a bare concrete hall, a few people standing in it, and
// whatever the player picks up to use on them.

import * as BABYLON from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { People } from '../person.ts';
import { Player } from '../player.ts';
import { Solids } from '../solids.ts';
import { Surfaces } from '../surfaces.ts';
import { Models } from '../models.ts';
import { Sound } from '../sound.ts';
import { gradePicture } from '../picture.ts';
import { Npc } from './npc.ts';
import { Blood } from './blood.ts';
import { Weapons } from './weapons.ts';
import { WORLD } from './ragdoll.ts';
const V3 = BABYLON.Vector3;

const HALL = { x: 9, z: 9, height: 5.5 };
const BODIES = ['oldman', 'sexton', 'buyer'];
const CALLED = { oldman: 'Old man', sexton: 'Groundskeeper', buyer: 'Young man' };
const MASS = { oldman: 72, sexton: 80, buyer: 86 };

export async function openSandbox(engine, canvas, hud) {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.022, 1);
    const havok = await HavokPhysics();
    scene.enablePhysics(new V3(0, -9.81, 0), new BABYLON.HavokPlugin(true, havok));

    const lights = light(scene);
    const surfaces = new Surfaces(scene);
    await surfaces.load(['ceiling', 'pavement']);
    const room = hall(scene, surfaces, lights);

    const solids = new Solids();
    const player = new Player(scene, canvas, {
        ground: () => 0, solids, limits: { x0: -HALL.x + 0.4, z0: -HALL.z + 0.4, x1: HALL.x - 0.4, z1: HALL.z - 0.4 }, underfoot: () => 'tarmac',
    });
    player.spawn(0, -4, { toward: [0, 1.4, 2] });
    const camera = player.camera;
    camera.minZ = 0.02;
    gradePicture(scene, camera, { exposure: 1.6 });

    const blood = new Blood(scene, { x: HALL.x, z: HALL.z, height: HALL.height }, room.reflections.cubeTexture);
    const people = await new People(scene).load(BODIES);
    const models = new Models(scene, { cast: (m) => lights.shadows.forEach((s) => s.addShadowCaster(m)) });

    const world: any = {
        scene, camera, canvas, player, blood, models, npcs: [] as Npc[], frame: 0, dt: 1 / 60, bodyOf: new WeakMap(),
        shadows: { addShadowCaster: (m) => lights.shadows.forEach((s) => s.addShadowCaster(m)) },
        sound: null,
    };
    const weapons = new Weapons(world);
    world.weapons = weapons;
    await weapons.load();

    let made = 0, lastHurt: Npc | null = null;
    const spawn = async (body, at: BABYLON.Vector3, yaw) => {
        const number = ++made, bit = 4 + ((number - 1) % 27);
        const npc = await Npc.make(world, people, body, { at, yaw, bit, mass: MASS[body], name: CALLED[body] });
        for (const seg of npc.ragdoll.segments) world.bodyOf.set(seg.body, { npc, seg });
        npc.label = `${CALLED[body]} (${number})`;
        const injure = npc.vitals.injure.bind(npc.vitals);
        npc.vitals.injure = (text, severity) => { lastHurt = npc; injure(text, severity); };
        npc.insides.mesh.setEnabled(seeing);
        world.npcs.push(npc);
        return npc;
    };
    const lineUp = () => Promise.all(BODIES.map((b, i) => spawn(b, new V3((i - 1) * 1.6, 0, 2.2), Math.PI)));
    let seeing = false;
    await lineUp();

    // N: another person on the floor where the eye is looking. X: their insides shown through them. K: the room cleared.
    window.addEventListener('keydown', async (e) => {
        if (e.code === 'KeyN') {
            const pick = scene.pickWithRay(new BABYLON.Ray(camera.globalPosition, camera.getDirection(V3.Forward()), 30), (m) => m.name === 'floor');
            const at = pick?.hit ? pick.pickedPoint : camera.globalPosition.add(camera.getDirection(V3.Forward()).scale(2));
            at.y = 0;
            const yaw = Math.atan2(camera.globalPosition.x - at.x, camera.globalPosition.z - at.z);
            await spawn(BODIES[made % BODIES.length], at, yaw);
        }
        if (e.code === 'KeyX') {
            seeing = !seeing;
            for (const npc of world.npcs) see(npc, seeing);
        }
        if (e.code === 'KeyK') {
            for (const npc of world.npcs) npc.dispose();
            world.npcs.length = 0;
            lastHurt = null;
            blood.clear();
            await lineUp();
        }
    });

    // Sound starts on the click that starts the sandbox (a page may not sound before one).
    world.start = async () => {
        const sound = await new Sound().load('assets/sounds/', await (await fetch('assets/sounds/manifest.json')).json());
        sound.room('cold');
        world.sound = { shot: (name, o = {}) => { if (sound.has(name)) sound.shot(name, o); }, raw: sound };
        player.onStep = (_, weight) => world.sound.shot('step-tarmac', { gain: weight * 0.8, most: 0.4 });
        if (sound.has('room-sandbox')) world.tone = sound.stream('room-sandbox');
    };

    const look = () => {
        const eye = camera.globalPosition, ahead = camera.getDirection(V3.Forward());
        let best = null, near = 25;
        for (const npc of world.npcs) {
            const d = V3.Distance(eye, npc.ragdoll.centre);
            if (d > near) continue;
            const to = npc.ragdoll.centre.subtract(eye).normalize();
            if (V3.Dot(to, ahead) > 0.97 - 0.15 / Math.max(1, d)) { best = npc; near = d; }
        }
        return best;
    };

    return {
        scene, world, weapons, player,
        update(dt) {
            world.frame++;
            world.dt = dt;
            player.update(dt);
            weapons.update(dt);
            for (const npc of world.npcs) npc.update(dt);
            blood.update(dt);
            if (world.sound) {
                world.sound.raw.listen(camera);
                world.sound.raw.update();
                world.tone?.drive(0.35);
            }
            const shown = look() ?? lastHurt;
            hud.update(weapons, shown, shown?.label);
        },
    };
}

function see(npc, on) {
    npc.insides.mesh.setEnabled(on);
    npc.person.mesh.visibility = on ? 0.18 : 1;
    npc.clothes.visibility = on ? 0.06 : 1;
}

// The hall's lights: two big lamps hung over the middle, each casting shadows, and a little from everywhere.
function light(scene) {
    const fill = new BABYLON.HemisphericLight('fill', new V3(0, 1, 0), scene);
    fill.intensity = 0.45;
    fill.diffuse = new BABYLON.Color3(0.85, 0.88, 0.95);
    fill.groundColor = new BABYLON.Color3(0.25, 0.24, 0.23);
    const shadows = [];
    const lamps = [];
    for (const [x, z] of [[-2.5, 1], [2.5, 1], [0, -5], [-6, -2], [6, -2], [0, 6.5]]) {
        const lamp = new BABYLON.SpotLight('lamp', new V3(x, HALL.height - 0.3, z), new V3(0, -1, 0), 1.75, 1.5, scene);
        lamp.falloffType = BABYLON.Light.FALLOFF_GLTF;
        const lit = Math.abs(x) < 3 && z > 0;
        lamp.intensity = lit ? 70 : 30;
        lamp.diffuse = new BABYLON.Color3(1, 0.96, 0.9);
        lamp.shadowMinZ = 0.3;
        lamp.shadowMaxZ = 12;
        lamps.push(lamp);
        if (!lit) continue;
        const s = new BABYLON.ShadowGenerator(2048, lamp);
        s.usePercentageCloserFiltering = true;
        s.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
        s.bias = 0.0006;
        s.normalBias = 0.012;
        shadows.push(s);
    }
    return { fill, lamps, shadows };
}

// A concrete hall: floor, four walls, a ceiling with the lamps' housings in it. Solid to the physics and to bullets.
function hall(scene, surfaces, { shadows, lamps }) {
    const floorMat = surfaces.material('ceiling', { own: 'floor', rough: 0.9, tint: [0.78, 0.76, 0.73] });
    const wallMat = surfaces.material('ceiling', { own: 'wall', rough: 1, tint: [0.85, 0.84, 0.8] });
    const tiled = (mesh, u, v) => {
        const uvs = mesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
        for (let i = 0; i < uvs.length; i += 2) { uvs[i] *= u; uvs[i + 1] *= v; }
        mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs);
    };
    const meshes = [];
    const floor = BABYLON.MeshBuilder.CreateGround('floor', { width: HALL.x * 2, height: HALL.z * 2 }, scene);
    tiled(floor, HALL.x / 1.5, HALL.z / 1.5);
    floor.material = floorMat;
    meshes.push(floor);
    const wall = (name, w, at: BABYLON.Vector3, yaw) => {
        const m = BABYLON.MeshBuilder.CreatePlane(name, { width: w, height: HALL.height }, scene);
        tiled(m, w / 2.5, HALL.height / 2.5);
        m.position = at;
        m.rotation.y = yaw;
        m.material = wallMat;
        meshes.push(m);
        return m;
    };
    wall('wallN', HALL.x * 2, new V3(0, HALL.height / 2, HALL.z), 0);
    wall('wallS', HALL.x * 2, new V3(0, HALL.height / 2, -HALL.z), Math.PI);
    wall('wallE', HALL.z * 2, new V3(HALL.x, HALL.height / 2, 0), Math.PI / 2);
    wall('wallW', HALL.z * 2, new V3(-HALL.x, HALL.height / 2, 0), -Math.PI / 2);
    const roof = BABYLON.MeshBuilder.CreatePlane('roof', { width: HALL.x * 2, height: HALL.z * 2 }, scene);
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = HALL.height;
    roof.material = wallMat;
    meshes.push(roof);
    for (const m of meshes) {
        m.receiveShadows = true;
        m.metadata = { solid: true };
        m.freezeWorldMatrix();
    }
    // The physics: a slab under the floor and a slab behind each wall.
    const slab = (w, h, d, at) => {
        const box = BABYLON.MeshBuilder.CreateBox('slab', { width: w, height: h, depth: d }, scene);
        box.position = at;
        box.isVisible = false;
        box.isPickable = false;
        const agg = new BABYLON.PhysicsAggregate(box, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.05 }, scene);
        agg.shape.filterMembershipMask = WORLD;
    };
    slab(HALL.x * 2, 1, HALL.z * 2, new V3(0, -0.5, 0));
    slab(HALL.x * 2, HALL.height, 1, new V3(0, HALL.height / 2, HALL.z + 0.5));
    slab(HALL.x * 2, HALL.height, 1, new V3(0, HALL.height / 2, -HALL.z - 0.5));
    slab(1, HALL.height, HALL.z * 2, new V3(HALL.x + 0.5, HALL.height / 2, 0));
    slab(1, HALL.height, HALL.z * 2, new V3(-HALL.x - 0.5, HALL.height / 2, 0));
    // The lamps' housings: lit panels, which is what anything wet or polished shows most of.
    const glow = new BABYLON.PBRMaterial('lampGlass', scene);
    glow.emissiveColor = new BABYLON.Color3(1, 0.96, 0.9);
    glow.emissiveIntensity = 6;
    for (const lamp of lamps) {
        const panel = BABYLON.MeshBuilder.CreateDisc('lampGlass', { radius: 0.35, tessellation: 32 }, scene);
        panel.rotation.x = Math.PI / 2;
        panel.position.copyFrom(lamp.position.add(new V3(0, 0.02, 0)));
        panel.material = glow;
        panel.isPickable = false;
        meshes.push(panel);
    }
    const reflections = new BABYLON.ReflectionProbe('hall', 256, scene);
    reflections.position.set(0, 1.4, 0);
    reflections.renderList.push(...meshes);
    reflections.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    void shadows;
    return { meshes, reflections };
}
