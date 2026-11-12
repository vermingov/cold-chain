// The cold room: the table, worked on for what the order wants.
//
// The cooler is on a trolley across the table from whoever is working (it
// goes round with them when they go round, V), where they can see it. A
// thing cut free and lifted out of the body is put in it by carrying it
// over the cooler and letting go: the cooler's rim shows when it is over
// it. It goes into the ice, stays there to be seen, and is graded as it
// goes in: sound, marginal (the blade has been on it), or reject (torn out,
// or cut about). Under the middle of the picture a word says what the hand
// can do with what it has. E steps back from the table, whether or not
// everything is in the cooler.

import * as BABYLON from '@babylonjs/core';
import { buildTable } from '../table/room.ts';
import { Clipboard } from './clipboard.ts';

const V3 = BABYLON.Vector3;
// The trolley: how far out from the table's middle it stands (on the far side from the eye), how far along toward
// the feet, its top; the cooler on it: across, high, along.
const TROLLEY = { out: 0.64, along: -0.05, top: 0.9, size: [0.4, 0.58] };
const COOLER = { size: [0.34, 0.26, 0.46] };
const OVER = 0.3;           // metres from the cooler's middle, across the floor, that a thing carried counts as over it
// How many marks of a blade an organ can have and still be sound, or still be worth anything.
const NICKS = { sound: 0, marginal: 2 };
// How the tools work, under what is to be done.
const HOW = 'Keys 1, 2, 3: scalpel, hand, retractor. Hold the left mouse button to use one. Mouse wheel lifts what the hand holds. V walks round the table. E steps back.';
const SAYS = { sound: 'Whole and clean.', marginal: 'There\'s a knife mark on it.', reject: 'It\'s torn. Nobody will pay for that.' };

export async function openTable(engine, canvas, game) {
    const scene = new BABYLON.Scene(engine);
    const table = await buildTable(scene, canvas, { sound: game.noises?.sound });
    const cooler = trolley(scene, table.shadows);
    const clipboard = new Clipboard(scene, table.camera, { bright: 0.9 });
    const { job, screen } = game, inside = table.inside, kept = [];
    let finished;
    const done = new Promise((out) => { finished = out; });

    // Which side of the table the eye is on: the cooler stands across from it, where it can be seen.
    let side = 1;
    const stand = () => {
        cooler.root.position.set(-side * TROLLEY.out, 0, table.field.point(0.5, 0.5).z + TROLLEY.along);
        cooler.root.computeWorldMatrix(true);
        kept.forEach((organ, i) => {
            inside.putAt(organ, place(i));
            inside.fall(organ);
        });
    };
    // Where the i-th thing in the cooler is let fall onto the ice from.
    const place = (i) => cooler.root.position.add(new V3(0, TROLLEY.top + COOLER.size[1] * 0.7, (i % 3 - 1) * 0.13));
    stand();

    const keys = (e) => {
        if (e.code === 'KeyE') finished();
        if (e.code === 'KeyV') {
            side = -side;
            table.look(side > 0 ? 'work' : 'across');
            stand();
        }
    };
    window.addEventListener('keydown', keys);
    screen.say([
        { who: '', says: 'You cut his suit off and bag it for the furnace.' },
        { who: '', says: 'Press 1 for the scalpel, 2 for your free hand, 3 for a retractor. Press V to walk round to the other side of the table. Press E to step away from the table when you\'ve finished.' },
        { who: '', says: 'With the scalpel, hold the left mouse button and drag down the middle of the belly. Slower strokes cut deeper. Go over the same line until it opens.' },
        { who: '', says: 'With a retractor, hold the left mouse button on one edge of the cut, drag it back and let go. It stays there. Do the same on the other edge. Then, with your hand, drag the bowel and the colon off the kidney.' },
        { who: '', says: 'Cut through the artery, the vein and the ureter, close to the kidney. Grab it with your hand, roll the mouse wheel forward to lift it out, carry it over the cooler and let go.' },
    ], {});

    const over = (organ) => {
        organ.mesh.computeWorldMatrix(true);
        const c = organ.mesh.getBoundingInfo().boundingBox.centerWorld, at = cooler.root.position;
        return Math.hypot(c.x - at.x, c.z - at.z) < OVER;
    };
    // The hand opens on something: if it is out of the body and over the cooler, it goes in.
    table.hand.takes = (organ) => {
        if (!inside.out(organ) || !over(organ)) return false;
        organ.taken = true;
        kept.push(organ);
        inside.fall(organ);
        const grade = inside.torn.includes(organ.name) ? 'reject'
            : organ.nicks.length <= NICKS.sound ? 'sound' : organ.nicks.length <= NICKS.marginal ? 'marginal' : 'reject';
        job.keep(organ.name, grade);
        screen.note(`You put the ${organ.name} on the ice. ${SAYS[grade]}`);
        return true;
    };

    // What the hand can do with what it has, said under the middle of the picture.
    const advise = () => {
        const organ = table.hand.held && table.hand.held.organ;
        cooler.lit(!!organ && inside.out(organ) && over(organ));
        if (!organ) return null;
        if (inside.strained(organ)) return 'Still attached. Cut its vessels first or it will tear';
        if (!inside.free(organ)) return null;
        if (!inside.out(organ)) return 'Roll the mouse wheel forward to lift it out';
        return over(organ) ? 'Let go of the mouse button to drop it in the cooler' : 'Carry it over the cooler and let go';
    };

    // What is to be done here, and how, for the corner of the screen.
    const wanted = job.night.order.wanted;
    const todo = () => (job.has('taken') ? 'Done here. Press E to step back from the table.'
        : `Put the ${wanted.join(' and the ')} in the cooler: ${kept.length} of ${wanted.length} done`);
    // Where the cooler is, marked on the screen over it while anything is still to go in.
    const mark = () => {
        if (job.has('taken')) return screen.mark(null);
        const engine = scene.getEngine(), canvas = engine.getRenderingCanvas();
        const top = cooler.root.position.add(new V3(0, TROLLEY.top + COOLER.size[1] + 0.12, 0));
        const p = V3.Project(top, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), table.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
        const css = canvas.clientWidth / engine.getRenderWidth(), ahead = V3.Dot(top.subtract(table.camera.position), table.camera.getDirection(V3.Forward())) > 0;
        screen.mark(ahead ? [p.x * css, p.y * css] : null, 'Cooler');
    };

    return {
        scene, clipboard, done, cooler, table, todo, how: HOW, room: 'cold',
        update(dt) {
            table.update(dt);
            clipboard.update(dt);
            screen.hint(advise());
            mark();
            // shortcut: a thing knocked out of the ice by the physics is put back in it; a real knock-on would need CCD.
            kept.forEach((organ, i) => {
                if (organ.mesh.getAbsolutePosition().y > TROLLEY.top - 0.2) return;
                inside.putAt(organ, place(i));
                inside.fall(organ);
            });
        },
        dispose() {
            screen.hint(null);
            screen.mark(null);
            window.removeEventListener('keydown', keys);
            table.dispose();
            scene.dispose();
        },
    };
}

// A steel trolley, and on it a cooler: a white box with ice in it and its lid off. Its rim shows when something
// carried is over it (`lit`).
function trolley(scene, shadows) {
    const plain = (name, colour, rough) => {
        const m = new BABYLON.PBRMaterial(name, scene);
        m.albedoColor = BABYLON.Color3.FromArray(colour);
        m.metallic = 0;
        m.roughness = rough;
        m.environmentIntensity = 0;
        return m;
    };
    const steel = plain('trolley', [0.5, 0.52, 0.53], 0.3), white = plain('cooler', [0.78, 0.78, 0.74], 0.5), ice = plain('ice', [0.7, 0.78, 0.82], 0.15);
    const root = new BABYLON.TransformNode('trolley', scene);
    const [tw, td] = TROLLEY.size, [w, h, d] = COOLER.size, top = TROLLEY.top, t = 0.02;
    const box = (name, size, at: [number, number, number], material) => {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
        mesh.position.set(...at);
        mesh.material = material;
        mesh.receiveShadows = true;
        mesh.parent = root;
        shadows.addShadowCaster(mesh);
        return mesh;
    };
    // Solid to what falls. (They follow the trolley when it goes round to the other side, so they are kept in step with it.)
    const solid = (mesh) => {
        const aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.9 }, scene);
        aggregate.body.disablePreStep = false;
        return mesh;
    };
    solid(box('trolley top', [tw, 0.02, td], [0, top - 0.01, 0], steel));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('trolley leg', [0.03, top, 0.03], [sx * (tw / 2 - 0.03), top / 2, sz * (td / 2 - 0.03)], steel);
    solid(box('cooler floor', [w, t, d], [0, top + t / 2, 0], white));
    const rim = [
        box('cooler side', [w, h, t], [0, top + h / 2, -d / 2 + t / 2], white),
        box('cooler side', [w, h, t], [0, top + h / 2, d / 2 - t / 2], white),
        box('cooler end', [t, h, d], [-w / 2 + t / 2, top + h / 2, 0], white),
        box('cooler end', [t, h, d], [w / 2 - t / 2, top + h / 2, 0], white),
    ];
    solid(box('ice', [w - 2 * t, 0.012, d - 2 * t], [0, top + h * 0.35, 0], ice));
    for (const mesh of rim) solid(mesh);
    const glow = plain('cooler, ready', [0.78, 0.78, 0.74], 0.5);
    glow.emissiveColor = new BABYLON.Color3(0.25, 0.3, 0.28);
    return {
        root,
        lit(on) { for (const mesh of rim) mesh.material = on ? glow : white; },
    };
}
