// The yard, for a night's work.
//
// The cemetery as it is built for walking (yard/yard.js), and in it what the
// night needs: the spade and the bar at the store, the bier beside it, the
// grave on the order, the sexton in his lodge, and later the van at the
// service gate. What is done here, and in what order, is the job's
// (job.js); this puts the things where they are and does what is asked of
// each.

import * as BABYLON from '@babylonjs/core';
import { Surfaces } from '../../surfaces.ts';
import { Models } from '../../models.ts';
import { Player } from '../../player.ts';
import { People } from '../../person.ts';
import { gradePicture } from '../../picture.ts';
import { Night } from '../../yard/night.ts';
import { Torch } from '../../yard/torch.ts';
import { buildYard } from '../../yard/yard.ts';
import { heightAt, plots } from '../../map/plan.ts';
import { burials, PRICES, VOICES } from '../story.ts';
import { Clipboard } from '../clipboard.ts';
import { Things } from '../things.ts';
import { openTable } from '../table.ts';
import { Grave } from './grave.ts';
import { Bier } from './bier.ts';
import { Held } from './held.ts';
import { Sexton } from './sexton.ts';
import { Gate } from './gate.ts';

const V3 = BABYLON.Vector3;
// Where the night starts: on the road outside the main gate, looking in.
const ARRIVE: { at: [number, number]; toward: [number, number] } = { at: [1.5, -7.5], toward: [0, 14] };
const MAIN_GATE = new V3(0, 1.2, 0.4);
// The kit, by the store behind the chapel: the spade and the bar against its east wall, the bier on the path.
const KIT = { spade: [-4.72, 88.9], bar: [-4.75, 88.3], bier: [-2.8, 86.4] };
// A spadeful takes this long, start to finish, and the bar this long a heave; the lid goes at the third.
const STROKE = { spade: 1.25, bar: 1.5 };
const HEAVES = 3;
const NEAR = { grave: 2.6, bier: 3.4, door: 4.5 };     // metres: close enough to dig, to lift onto the bier, to wheel in
const HEARD = 5;            // spadefuls before the sexton's door opens

export async function openYard(engine, canvas, game) {
    const { job, screen, noises } = game, night = job.night, burial = night.burial;
    const scene = new BABYLON.Scene(engine);
    const surfaces = new Surfaces(scene, 'assets/surfaces/');
    const player = new Player(scene, canvas, null);
    const camera = player.camera;
    const sky = new Night(scene, camera);
    const torch = new Torch(scene, camera);
    const casts = { cast: (m) => { sky.cast([m]); torch.cast([m]); }, uncast() {} };
    const models = new Models(scene, casts, 'assets/props/');
    const yard = await buildYard(scene, { surfaces, models, night: sky, fonts: 'vendor/fonts/', buried: burials(night.id) });
    torch.cast([...yard.stones, ...yard.trees, ...yard.built]);
    player.place = yard.footing;
    player.spawn(...ARRIVE.at, { toward: [ARRIVE.toward[0], heightAt(...ARRIVE.toward) + 1.3, ARRIVE.toward[1]] });
    player.onStep = (surface, weight) => noises.step(surface, weight);
    gradePicture(scene, camera);

    await models.prepare(['rusted_spade_01', 'crowbar_01']);
    const people = await new People(scene, 'assets/people/').load([...new Set([burial.body, 'sexton', 'buyer'])]);
    const plot = plots().find((p) => p.id === burial.plot);
    const grave = new Grave(scene, plot, burial, { surfaces, people, flatten: yard.flatten });
    const bier = new Bier(scene, surfaces, KIT.bier, Math.PI, heightAt);
    const kit = ['spade', 'bar'].map((name) => {
        const mesh = models.make(name === 'spade' ? 'rusted_spade_01' : 'crowbar_01');
        const [x, z] = KIT[name];
        mesh.position.set(x, heightAt(x, z), z);
        // Leant against the wall.
        mesh.rotation.set(0, Math.PI / 2, name === 'spade' ? -0.22 : -0.3);
        return mesh;
    });
    const held = new Held(models);
    const sexton = new Sexton(scene, people);
    const gate = new Gate(scene, people);
    for (const mesh of [grave.coffin, grave.lid, grave.heap, grave.body.mesh, ...bier.meshes, ...kit, ...Object.values(held.tools), sexton.person.mesh, gate.buyer.mesh]) casts.cast(mesh);
    const clipboard = new Clipboard(scene, camera, { bright: 0.55 });
    const things = new Things(camera, screen);

    let finished;
    const ended = new Promise((out) => { finished = out; });
    const work = { tool: null, t: 0, wanted: false, heaves: 0 };

    // --- the kit ---------------------------------------------------------------
    things.add({
        at: () => kit[0].position.add(new V3(0, 0.6, 0)),
        verb: () => (job.has('tools') ? null : 'Take the spade and the bar'),
        use: () => {
            for (const mesh of kit) mesh.setEnabled(false);
            job.tick('tools');
        },
    });
    things.add({
        at: () => bier.handle, reach: 2.2,
        verb: () => (bier.pusher ? null : 'Push the bier'),
        use: () => {
            bier.take(player);
            job.tick('bier');
        },
    });
    things.otherwise = { verb: () => (bier.pusher ? 'Let go of the bier' : null), use: () => bier.letGo() };

    // --- the grave ---------------------------------------------------------------
    things.add({
        at: () => grave.middle, reach: NEAR.grave + 0.8, wide: 2.5,
        verb: () => {
            if (!job.has('tools') || grave.down) return null;
            return grave.dug ? 'Dig (hold the button)' : 'Cut the turf and dig (hold the button)';
        },
        use: () => {},
        work: 'spade',
    });
    things.add({
        at: () => grave.at('lid'), reach: 4.2, wide: 2.5,
        verb: () => (grave.down && !grave.open ? 'Break the lid (hold the button)' : null),
        use: () => {},
        work: 'bar',
    });
    for (const check of night.order.check) {
        things.add({
            at: () => grave.at(check.look), reach: 4.4, wide: 0.8,
            verb: () => {
                if (!grave.down || job.checked.has(check) || job.has('lifted')) return null;
                // The plate can be read on the lid; the rest wants the lid off.
                return check.look === 'plate' || grave.open ? check.verb : null;
            },
            use: async () => {
                job.see(check);
                await screen.note(check.seen);
            },
        });
    }
    things.add({
        at: () => grave.middle.add(new V3(0, -0.5, 0)), reach: 3.8, wide: 2.5,
        verb: () => {
            if (!grave.open || job.has('lifted')) return null;
            if (!job.has('checked')) return 'Check him against the order first (Tab)';
            return V3.Distance(bier.position, grave.middle) > NEAR.bier ? 'Bring the bier up to the grave first' : 'Lift him out onto the bier';
        },
        use: async () => {
            if (!job.has('checked') || V3.Distance(bier.position, grave.middle) > NEAR.bier) return;
            bier.letGo();
            await screen.through(async () => {
                grave.emptied();
                bier.carry(grave.body.root);
                grave.body.setEnabled(true);
                job.tick('lifted');
            }, { card: ['Twenty minutes.', 'A rope under his arms, and everything you have.'], hold: 2.6 });
        },
    });

    // --- the cold room ---------------------------------------------------------------
    const door = V3.FromArray(yard.places.chapel.coldDoor).add(new V3(0, 1.1, 0));
    things.add({
        at: door, reach: NEAR.door, wide: 2,
        verb: () => {
            if (!job.has('lifted') || job.has('inside')) return null;
            return bier.load && V3.Distance(bier.position, door) < NEAR.door ? 'Wheel him in' : null;
        },
        use: async () => {
            bier.letGo();
            job.tick('inside');
            await game.visit(() => openTable(engine, canvas, game), ['The cold room']);
            bier.load.setEnabled(false);
            bier.load = null;
            gate.arrive();
            await screen.note(`${night.order.handover.place}, ${night.order.handover.time}. There are headlights on the track already.`);
        },
    });

    // --- the gate, and home ---------------------------------------------------------------
    things.add({
        at: () => gate.bars, reach: 2.8, wide: 2,
        verb: () => (gate.waiting && !job.has('handed') ? 'Hand the cooler through' : null),
        use: async () => {
            const { handover } = night;
            await screen.say(handover.meet, VOICES);
            const worst = job.taken.length ? ['reject', 'marginal', 'sound'].find((g) => job.taken.some((t) => t.grade === g)) : 'nothing';
            await screen.say([handover.judge[worst]], VOICES);
            job.paid = job.taken.reduce((sum, t) => sum + price(t), 0);
            if (job.paid) await screen.note(`He counts it out through the bars. £${job.paid.toLocaleString('en-GB')}.`);
            await screen.say(handover.leave, VOICES);
            job.tick('handed');
            await screen.through(async () => gate.leave(), { card: ['The van goes.'], hold: 1.2 });
        },
    });
    things.add({
        at: MAIN_GATE, reach: 4.5, wide: 3,
        verb: () => (job.has('handed') ? 'Go home' : null),
        use: () => {
            job.tick('home');
            finished();
        },
    });

    // --- the hands, working ---------------------------------------------------------------
    const press = (e) => {
        if (e.button !== 0 || things.paused) return;
        work.wanted = e.type === 'pointerdown';
    };
    canvas.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', press);

    // Where the hands are and what they are working at, for the tool in them.
    const workAt = (tool) => {
        const eye = camera.globalPosition, ahead = camera.getDirection(V3.Forward());
        ahead.y = 0;
        ahead.normalize();
        const hands = eye.add(new V3(0, -0.55, 0)).add(ahead.scale(0.3));
        const work = grave.reach(player.pos, tool === 'bar');
        const aside = grave.heap.position.subtract(work);
        aside.y = 0;
        return { hands, work, aside: aside.normalize() };
    };

    // A stroke of whatever is being worked with: started while the button is down over the grave, always finished.
    const strike = (dt) => {
        const tool = work.tool || (work.wanted && things.looked && things.looked.work) || null;
        if (!tool) return;
        if (!work.tool) {
            work.tool = tool;
            held.show(tool);
            player.held = true;
        }
        const before = work.t;
        work.t += dt / STROKE[tool];
        // The spadeful comes out as it is thrown; the lid gives as the bar comes down.
        const at = tool === 'spade' ? 0.8 : 0.6;
        // Heard as the spade goes into the clay; as each heave of the bar comes down.
        const heard = tool === 'spade' ? 0.22 : 0.6;
        if (before < heard && work.t >= heard) noises.shot(tool === 'spade' ? 'dig' : 'lid', tool === 'bar' && work.heaves < HEAVES - 1 ? 0.55 : 1);
        if (before < at && work.t >= at) {
            if (tool === 'spade') {
                grave.spadeful();
                if (grave.dug === 1) yard.footing.solids.box(grave.hole[0], grave.hole[1], grave.hole[2], grave.hole[3]);
                if (grave.dug === HEARD && night.sexton === 'watches') sexton.come();
                if (grave.down) job.tick('dug');
            } else if (++work.heaves >= HEAVES) {
                grave.breakLid();
                job.tick('opened');
            }
        }
        held.stroke(Math.min(1, work.t), workAt(tool));
        if (work.t < 1) return;
        work.t = 0;
        const more = work.wanted && things.looked && things.looked.work === tool;
        if (!more) {
            work.tool = null;
            held.show(null);
            player.held = false;
        }
    };

    return {
        scene, clipboard, night: ended, player, things, grave, bier, sexton, gate, held, torch, yard,
        update(dt) {
            player.update(dt);
            const wheels = bier.position.clone();
            bier.update(dt, yard.footing.solids);
            // The air of the place; the bier's wheels as fast as it goes; the van's engine, louder the nearer.
            noises.drive('night', 1);
            noises.drive('bier', bier.pusher ? Math.min(1, V3.Distance(wheels, bier.position) / dt / 0.9) : 0);
            noises.drive('van', gate.waiting ? Math.min(1, 6 / Math.max(1, V3.Distance(camera.globalPosition, gate.bars))) : 0);
            if (!job.has('found') && Math.hypot(player.pos.x - plot.x, player.pos.z - plot.z) < NEAR.grave + 0.6) job.tick('found');
            things.update();
            strike(dt);
            sexton.update(dt, camera.globalPosition);
            gate.update(dt, camera.globalPosition);
            clipboard.update(dt);
            // The eye closes down on whatever is nearest in the beam, people too.
            const from = torch.beam.position, along = torch.beam.direction;
            torch.update(Math.min(yard.reach(from, along), ...[gate.standing, sexton.standing].map((at) => inBeam(from, along, at))));
            sky.update();
            yard.tokens.update(performance.now() / 1000);
        },
        // While the table is being worked at: nothing here hears the keys or the mouse.
        pause() {
            things.paused = true;
            work.wanted = false;
            noises.hush();
        },
        resume() {
            things.paused = false;
            player.keys.clear();
        },
        dispose() {
            canvas.removeEventListener('pointerdown', press);
            window.removeEventListener('pointerup', press);
            things.dispose();
            player.dispose();
            grave.dispose();
            scene.dispose();
        },
    };
}

// How far along the beam somebody standing at `at` (their feet) is, if they are in it.
function inBeam(from, along, at) {
    if (!at) return Infinity;
    const middle = at.add(new V3(0, 1.1, 0)).subtract(from), t = V3.Dot(middle, along);
    return t > 0.2 && middle.lengthSquared() - t * t < 0.5 ? t : Infinity;
}

// What a thing in the cooler fetches at the gate.
function price({ name, grade }) {
    const kind = name.replace(/^(left|right) /, '');
    return (PRICES[kind] || {})[grade] || 0;
}
