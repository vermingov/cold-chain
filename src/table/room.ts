// The table, put together: a body on it under the lamp, the scalpel and the
// bare hand, and the sound of them. dev/table.html shows it on its own and
// the game (game/table.js) works on it.
//
// The room is still a stand-in for the chapel's cold room: a steel table on
// a tiled floor against a tiled wall.

import * as BABYLON from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { People } from '../person.ts';
import * as P from '../poses.ts';
import { gradePicture } from '../picture.ts';
import { Field } from './field.ts';
import { lay } from './wound.ts';
import { Scalpel } from './scalpel.ts';
import { Organs } from './organs.ts';
import { Inside } from './inside.ts';
import { Hand } from './hand.ts';
import { Retractor } from './retractor.ts';
import { Hands } from './hands.ts';
import { Arm } from './arm.ts';
import { Sound } from '../sound.ts';
import { Foley } from './foley.ts';
import { Pieces } from './piece.ts';

const V3 = BABYLON.Vector3;
export const TABLE_TOP = 0.9;
const TABLE = { wide: 0.8, long: 2.1 };

// Where the eye is, from the middle of the trunk. `work` is where the eyes
// of somebody standing at the table to cut are: an arm's length off, so
// that their arm comes in from the edge of the picture and reaches.
const VIEWS = {
    work: [new V3(0.3, 0.5, -0.06), new V3(0, 0, 0.02)],
    // The same, from the other side of the table: the far kidney is seen past the bowel, not over the pancreas.
    across: [new V3(-0.3, 0.5, -0.06), new V3(0, 0, 0.02)],
    far: [new V3(0.62, 0.72, -0.12), new V3(0, 0, 0)],
    close: [new V3(0.3, 0.36, -0.05), new V3(0, 0, 0.02)],
    low: [new V3(0.42, 0.16, -0.2), new V3(0, -0.02, 0.05)],
    top: [new V3(0.001, 0.9, 0), new V3(0, 0, 0)],
    near: [new V3(0.2, 0.3, 0.06), new V3(0, 0, 0.06)],
};

const plain = (scene, name, colour, rough) => {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = BABYLON.Color3.FromArray(colour);
    m.metallic = 0;
    m.roughness = rough;
    m.environmentIntensity = 0;
    return m;
};

// The lamp over the table, its shadows, and a little light from everywhere else.
function light(scene) {
    const fill = new BABYLON.HemisphericLight('fill', new V3(0, 1, 0), scene);
    fill.intensity = 0.06;
    fill.diffuse = new BABYLON.Color3(0.7, 0.8, 1.0);
    const lamp = new BABYLON.SpotLight('lamp', new V3(0, 2.4, 0.1), new V3(0, -1, 0.02), 1.9, 2, scene);
    lamp.falloffType = BABYLON.Light.FALLOFF_GLTF;
    lamp.intensity = 8;
    lamp.diffuse = new BABYLON.Color3(1.0, 0.95, 0.86);
    lamp.shadowMinZ = 0.2;
    lamp.shadowMaxZ = 6;
    const shadows = new BABYLON.ShadowGenerator(2048, lamp);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.01;
    return { lamp, shadows };
}

// A steel table on a tiled floor, the lamp's head, and what polished steel shows of them.
function room(scene, { lamp, shadows }) {
    const steel = plain(scene, 'table', [0.55, 0.57, 0.58], 0.35), tile = plain(scene, 'tile', [0.33, 0.35, 0.33], 0.6);
    const box = (name, w, h, d, at, material) => {
        const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
        m.position = at; m.material = material; m.receiveShadows = true; shadows.addShadowCaster(m);
        return m;
    };
    const meshes = [box('floor', 9, 0.1, 9, new V3(0, -0.05, 0), tile), box('wall', 9, 3, 0.1, new V3(0, 1.5, 2.2), tile),
        box('table', TABLE.wide, 0.06, TABLE.long, new V3(0, TABLE_TOP - 0.03, 0), steel), box('leg', 0.5, 0.84, 1.2, new V3(0, 0.42, 0), steel)];
    // The lamp itself, which is what anything polished shows most of.
    const shade = BABYLON.MeshBuilder.CreateDisc('lampHead', { radius: 0.19 }, scene);
    shade.position.set(0, 2.45, 0.1);
    shade.rotation.x = -Math.PI / 2;
    const head = new BABYLON.PBRMaterial('lampHead', scene);
    shade.material = head;
    head.emissiveColor = lamp.diffuse;
    head.emissiveIntensity = 5;
    head.backFaceCulling = false;
    const reflections = new BABYLON.ReflectionProbe('room', 128, scene);
    reflections.position.set(0, 1.1, 0);
    reflections.renderList.push(...meshes, shade);
    reflections.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    return { meshes, reflections };
}

// The physics engine, started once for every visit to the table.
let havok: ReturnType<typeof HavokPhysics> | undefined;

// Build it into `scene`. `base` is where the game's root is from the page; `view` names where the eye is. `sound` is
// one already loaded with every recording (the game's own, so they are not fetched and unpacked a second time); without
// it the table loads its own.
export async function buildTable(scene, canvas, { base = '', view = 'work', sound = null } = {}) {
    scene.clearColor = new BABYLON.Color4(0.01, 0.01, 0.012, 1);
    const lit = light(scene), { shadows } = lit;
    const { reflections, meshes: solid } = room(scene, lit);
    // What is taken out and let go falls, and lands on whatever is solid in the room.
    havok ??= HavokPhysics();
    scene.enablePhysics(new V3(0, -9.81, 0), new BABYLON.HavokPlugin(true, await havok));
    for (const mesh of solid) new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);

    const people = await new People(scene, base + 'assets/people/').load(['oldman', 'buyer']);
    // The dead one, on his back on the table, head toward the wall.
    // His face as it was in the coffin (game/yard/grave.js): eyes shut, mouth just open. Only his arms have been
    // moved, out from his sides to be out of the way.
    const dead = people.make('oldman', { dressed: false, dead: true, bald: true });
    dead.blinks = false;
    dead.blink = 1;
    dead.root.position.set(0, TABLE_TOP, 0.05);
    dead.root.rotation.y = Math.PI;
    dead.apply({ ...P.RELAXED, _pitch: -90, jaw: 4, headTilt: 4, shoulderAbductL: -30, shoulderAbductR: -32, elbowL: 6, elbowR: 4,
        curlL: 28, curlR: 24, thumbL: 14, thumbR: 12, ankleL: -30, ankleR: -34, hipTwistL: 12, hipTwistR: -14 }, { ground: 'skin' });
    shadows.addShadowCaster(dead.mesh);

    const field = new Field(scene, dead);
    const { flesh, lining, skin } = lay(scene, dead, field);
    const organs = await new Organs(scene).into(dead, base + 'assets/organs/oldman.bin');
    for (const mesh of [...flesh.meshes, ...[...organs.all.values()].map((organ) => organ.mesh)]) shadows.addShadowCaster(mesh);

    const middle = field.point(0.5, 0.5);
    const camera = new BABYLON.FreeCamera('eye', middle.clone(), scene);
    camera.minZ = 0.03;
    camera.fov = 0.8;
    // Stand where `name` says (VIEWS).
    const look = (name) => {
        const [from, to] = VIEWS[name] || VIEWS.work;
        camera.position.copyFrom(middle.add(from));
        camera.setTarget(middle.add(to));
    };
    look(view);
    gradePicture(scene, camera, { exposure: 1.1 });

    const inside = new Inside(field, organs, TABLE_TOP);
    // How high whatever is under a spot of the room is: the body, the table, or the floor.
    const onBody = (x, z) => {
        const [u, v] = field.place(x, z);
        return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? field.heightAt(u, v) : -Infinity;
    };
    const ground = (x, z) => Math.max(onBody(x, z), Math.abs(x) <= TABLE.wide / 2 && Math.abs(z) <= TABLE.long / 2 ? TABLE_TOP : 0);
    // Whoever is cutting has the buyer's build until they have one of their own. Their arms keep out of the body
    // and off the table.
    const clear = (p) => p.y - Math.max(onBody(p.x, p.z), TABLE_TOP);
    const rightArm = new Arm(people, 'buyer', 'R', camera, { clear });
    const leftArm = new Arm(people, 'buyer', 'L', camera, { clear, hold: 'open' });
    const scalpel = new Scalpel(scene, camera, field, inside, { arm: rightArm, room: reflections.cubeTexture });
    for (const mesh of [scalpel.mesh, ...rightArm.meshes, ...leftArm.meshes]) shadows.addShadowCaster(mesh);
    const pieces = new Pieces(scene, ground, skin);
    const hand = new Hand(scene, camera, field, inside, { arm: leftArm, pieces });
    const retractor = new Retractor(scene, camera, field);
    shadows.addShadowCaster(retractor.source, true);
    const hands = new Hands(canvas, { scalpel, hand, retractor });
    // Every sound is a recording (tools/sounds.py): the foley plays them to match what the tools and the tissue are doing.
    const own = !sound;
    if (own) sound = await new Sound().load(base + 'assets/sounds/', await (await fetch(base + 'assets/sounds/manifest.json')).json());
    const foley = new Foley(sound, { scalpel, hand, field, organs, pieces });

    return {
        scene, camera, dead, field, flesh, lining, organs, inside, scalpel, hand, retractor, hands, lamp: lit.lamp, shadows, rightArm, leftArm, pieces, sound, look,
        update(dt) {
            hands.update(dt);
            retractor.draw();
            pieces.update(dt);
            field.update();
            foley.update(dt);
        },
        // The table is left: its sounds stop, and a sound it loaded for itself is let go.
        dispose() {
            hands.dispose();
            foley.dispose();
            if (own) sound.context.close();
        },
    };
}
