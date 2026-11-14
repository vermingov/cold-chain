// The sandbox: a hall laid out as a test map (map.ts), a few people standing in it, and
// whatever the player picks up to use on them.

import * as BABYLON from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { People } from '../person.ts';
import { Player } from '../player.ts';
import { Surfaces } from '../surfaces.ts';
import { Models } from '../models.ts';
import { Sound } from '../sound.ts';
import { gradePicture } from '../picture.ts';
import { Npc } from './npc.ts';
import { Blood } from './blood.ts';
import { Weapons } from './weapons.ts';
import { buildArsenal } from './arsenal.ts';
import { HALL, buildMap, ground, solids, land, covered, screened } from './map.ts';
import { Thuds } from './thuds.ts';
import { warm } from './warm.ts';
const V3 = BABYLON.Vector3;

const BODIES = ['oldman', 'sexton', 'buyer', 'hood'];
const CALLED = { oldman: 'Old man', sexton: 'Groundskeeper', buyer: 'Young man', hood: 'Man in a hood' };
const MASS = { oldman: 72, sexton: 80, buyer: 86, hood: 82 };

export async function openSandbox(engine, canvas, hud) {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.022, 1);
    const havok = await HavokPhysics();
    scene.enablePhysics(new V3(0, -9.81, 0), new BABYLON.HavokPlugin(true, havok));
    // Every step a hundred and twentieth of a second: as many a frame as its time holds, to the nearest, and what is
    // over or short carried to the next. One long step (up to a tenth of a second, on a hitch) tore the people's joints
    // apart and sank them into the floor, and at a sixtieth a standing body still sagged and sprang on its legs by four
    // centimetres. Nor may the length change from frame to frame: a frame cut into steps of its own length (16.6 ms in
    // two of 8.3, 17 ms in three of 5.7) moved where Havok's joints and the floor settle a standing body each time, and
    // the people bobbed on their legs at the frame rate's wander (the pelvis over 1.2 to 1.6 cm, a millimetre a frame,
    // at frames of 12 to 22 ms; 3 to 7 mm of breathing and sway with every step the same length).
    // Before each, the people push on what they push on (behaviour.ts).
    // A frame longer than a thirtieth runs the bodies slower than the clock: each step costs a millisecond or two, and
    // stepping through all of a slow frame made the next one slower still (9 steps a frame after a grenade).
    const physics = scene.getPhysicsEngine() as BABYLON.PhysicsEngine;
    const step = physics._step.bind(physics);
    let owed = 0;
    physics._step = (delta) => {
        owed = Math.min(owed + delta, 1 / 30);
        const steps = Math.round(owed * 120);
        owed -= steps / 120;
        for (let i = 0; i < steps; i++) {
            for (const npc of world.npcs) npc.behaviour.beforeStep(1 / 120);
            step(1 / 120);
        }
    };

    const surfaces = new Surfaces(scene);
    await surfaces.load(['ceiling', 'pavement']);
    const room = buildMap(scene, surfaces);
    const lights = room.lights;

    const player = new Player(scene, canvas, {
        ground, solids, limits: { x0: -HALL.x + 0.4, z0: -HALL.z + 0.4, x1: HALL.x - 0.4, z1: HALL.z - 0.4 }, underfoot: () => 'tarmac',
    });
    player.spawn(0, -4, { toward: [0, 1.4, 2] });
    const camera = player.camera;
    camera.minZ = 0.02;
    gradePicture(scene, camera, { exposure: 1.6 });

    const blood = new Blood(scene, { x: HALL.x, z: HALL.z, height: HALL.height }, room.reflections.cubeTexture);
    blood.map = { ground, land };
    blood.floor.covered = covered;
    const people = await new People(scene).load(BODIES);
    const models = new Models(scene, { cast: (m) => lights.shadows.forEach((s) => s.addShadowCaster(m)) });

    const world: any = {
        scene, camera, canvas, player, blood, models, people, npcs: [] as Npc[], frame: 0, dt: 1 / 60, bodyOf: new WeakMap(),
        ground,     // the height of what is under (x, z), no higher than `below` (map.ts)
        shadows: { addShadowCaster: (m) => lights.shadows.forEach((s) => s.addShadowCaster(m)) },
        sound: null,
    };
    blood.bodies = () => world.npcs;
    const thuds = new Thuds(world, physics.getPhysicsPlugin() as unknown as BABYLON.HavokPlugin);
    const weapons = new Weapons(world);
    world.weapons = weapons;
    await weapons.load();
    weapons.arsenal = await buildArsenal(world, weapons);

    let made = 0, lastHurt: Npc | null = null;
    const spawn = async (body, at: BABYLON.Vector3, yaw) => {
        // Each person's own collision bit, one bit (a sum like 4 + n once took the floor's bit with it and let them fall through).
        const number = ++made, bit = 8 << ((number - 1) % 27);
        const npc = await Npc.make(world, people, body, { at, yaw, bit, mass: MASS[body], name: CALLED[body] });
        for (const seg of npc.ragdoll.segments) world.bodyOf.set(seg.body, { npc, seg });
        thuds.listen(npc);
        npc.label = `${CALLED[body]} (${number})`;
        const injure = npc.vitals.injure.bind(npc.vitals);
        npc.vitals.injure = (text, severity) => { lastHurt = npc; injure(text, severity); };
        npc.insides.mesh.setEnabled(seeing);
        world.npcs.push(npc);
        return npc;
    };
    const lineUp = () => Promise.all(BODIES.map((b, i) => spawn(b, new V3((i - (BODIES.length - 1) / 2) * 1.5, 0, 2.2), Math.PI)));
    let seeing = false;
    await lineUp();

    // Each person's skinned meshes (body, clothes, insides, cut-off pieces, dressings, teeth) culled by a box round the
    // bodies their skeleton follows, in view and in each shadow lamp's: the bounds Babylon keeps are of the rest pose
    // where the person was made, so all of them were drawn always. The box takes in last frame's bodies too, where a
    // cut-off piece's bones still are (dismember.ts puts them before the step), and reaches past the segments' heads to
    // the crown and the fingertips. A box for every submesh (theirs are of the rest pose too).
    const FLESH = 0.35;
    const boxes = new Map<BABYLON.Skeleton, [BABYLON.Vector3, BABYLON.Vector3]>(), was = new WeakMap<Npc, [BABYLON.Vector3, BABYLON.Vector3]>();
    scene.dispatchAllSubMeshesOfActiveMeshes = true;
    scene.onBeforeRenderObservable.add(() => {
        boxes.clear();
        for (const npc of world.npcs) {
            const lo = new V3(Infinity, Infinity, Infinity), hi = lo.scale(-1);
            for (const seg of npc.ragdoll.segments) { lo.minimizeInPlace(seg.node.position); hi.maximizeInPlace(seg.node.position); }
            const before = was.get(npc) ?? [lo.clone(), hi.clone()];
            was.set(npc, [lo.clone(), hi.clone()]);
            boxes.set(npc.person.skeleton, [lo.minimizeInPlace(before[0]).addInPlaceFromFloats(-FLESH, -FLESH, -FLESH), hi.maximizeInPlace(before[1]).addInPlaceFromFloats(FLESH, FLESH, FLESH)]);
        }
        for (const mesh of scene.meshes) {
            const box = mesh.skeleton && boxes.get(mesh.skeleton);
            if (!box) continue;
            mesh.doNotSyncBoundingInfo = true;
            mesh.alwaysSelectAsActiveMesh = false;
            mesh.getBoundingInfo().reConstruct(box[0], box[1]);     // in the world
        }
    });

    // N: another person standing where the eye is looking (on the floor, a ledge, the ramp). X: their insides shown
    // through them. K: the room cleared.
    window.addEventListener('keydown', async (e) => {
        if (e.code === 'KeyN') {
            const pick = scene.pickWithRay(new BABYLON.Ray(camera.globalPosition, camera.getDirection(V3.Forward()), 30), (m) => m.metadata?.solid);
            const up = pick?.hit && pick.getNormal(true).y > 0.7;
            const at = up ? pick.pickedPoint : camera.globalPosition.add(camera.getDirection(V3.Forward()).scale(2));
            if (!up) at.y = ground(at.x, at.z, camera.globalPosition.y);
            const yaw = Math.atan2(camera.globalPosition.x - at.x, camera.globalPosition.z - at.z);
            await spawn(BODIES[made % BODIES.length], at, yaw);
        }
        if (e.code === 'KeyX') {
            seeing = !seeing;
            for (const npc of world.npcs) see(npc, seeing);
        }
        if (e.code === 'KeyK') {
            weapons._letGo();  // a hand on someone or their bowel would pull on a disposed body next frame
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
        await sound.load('assets/cries/', await (await fetch('assets/cries/manifest.json')).json());
        sound.room('cold');
        sound.screened = screened;
        world.sound = {
            shot: (name, o = {}) => (sound.has(name) ? sound.shot(name, o) : null),
            stream: (name, at = null) => (sound.has(name) ? sound.stream(name, at) : null),
            now: () => sound.context.currentTime, raw: sound,
        };
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

    const sandbox = {
        scene, world, weapons, player,
        // Before "Click to start": every shader compiled (warm.ts), then the room as it was.
        warm: (say: (text: string) => void) => warm({
            scene, world, weapons, player, say, step: (dt) => sandbox.update(dt),
            xray: () => { seeing = !seeing; for (const npc of world.npcs) see(npc, seeing); },
            reset: async () => {
                weapons._letGo();
                for (const npc of world.npcs) npc.dispose();
                world.npcs.length = 0;
                lastHurt = null;
                blood.clear();
                for (const c of weapons.casings) { c.body.dispose(); c.mesh.dispose(); }
                weapons.casings.length = 0;
                weapons.holeCount = weapons.holes.thinInstanceCount = 0;
                weapons.holes.isVisible = false;
                await lineUp();
                player.spawn(0, -4, { toward: [0, 1.4, 2] });
            },
        }),
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
    return sandbox;
}

function see(npc, on) {
    npc.insides.mesh.setEnabled(on);
    npc.person.mesh.visibility = on ? 0.18 : 1;
    npc.clothes.visibility = on ? 0.06 : 1;
    // Hair is cut out rather than blended, which ignores the mesh's visibility and hid a broken skull: blended while seen through.
    const hair = (npc.person.mesh.material as BABYLON.MultiMaterial).subMaterials.filter((m, i) => npc.person.header.parts[i].kind === 'hair');
    for (const m of hair) m.transparencyMode = on ? BABYLON.Material.MATERIAL_ALPHATESTANDBLEND : BABYLON.Material.MATERIAL_ALPHATEST;
}
