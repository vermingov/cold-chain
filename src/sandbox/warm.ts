// Every shader the game will need, compiled while the loading screen is up rather than the first time something is
// seen or happens (a compile holds a frame up for tens to hundreds of milliseconds on Windows' ANGLE).
//
// scene.whenReadyAsync() compiles every mesh's material for what the mesh is now, seen from anywhere (it does not
// look at the camera), shadow-map variants with it, enabled or not. What it cannot know are the variants that only
// come after an event: a wound turns on the skin's wound and hider defines, a hole through clothes the soak, a severed
// limb brings cut faces, an opened belly the organs, a dressing its gauze, X-ray the see-through hair. So the people are
// put through those events once, off the clock, waiting for the shaders after each (each step's mix of defines is
// its own shader; the engine keeps them by their defines, so the next people find them made), and then the room is
// reset as K resets it.

import * as BABYLON from '@babylonjs/core';
import { ARMS } from './weapons.ts';
import { sever } from './dismember.ts';
import { dress, wounds } from './dressing.ts';
const V3 = BABYLON.Vector3;

type Hooks = { scene: BABYLON.Scene; world: any; weapons: any; player: any; step: (dt: number) => void; reset: () => Promise<void>;
    xray: () => void; say: (text: string) => void };

export async function warm({ scene, world, weapons, player, step, reset, xray, say }: Hooks) {
    const ready = async (frames = 2) => {
        // (Drawn once: the frames between only need to happen, and drawing them is most of a frame's cost.)
        for (let i = 0; i < frames; i++) step(1 / 60);
        scene.render();
        await scene.whenReadyAsync();
        // (Particle systems are not in the scene's check.)
        for (const ps of scene.particleSystems) while (!ps.isReady()) await new Promise((r) => setTimeout(r, 16));
    };
    const aim = (npc, part: string, from = 2.6) => {
        const seg = npc.ragdoll.segments.find((s) => s.name === part) ?? npc.ragdoll.segments[0], at = seg.node.position;
        player.spawn(at.x, at.z - from, { toward: [at.x, at.y, at.z] });
        player.update(0);
    };
    const press = (button = 0) => { weapons.busy = 0; weapons.reloading = 0; weapons._press(button); };
    // What is carried, as it was: the rehearsal takes every weapon off the wall.
    const carried = { slots: weapons.slots.slice(), bag: weapons.bag.slice(), slot: weapons.slot, ammo: new Map(weapons.ammo) };
    say('Preparing shaders: the hall.');
    await ready();
    // (A rehearsal that fails costs only the shaders it did not reach: the game still starts.)
    try { await rehearse(); } catch (e) { console.error('shader warm-up stopped:', e); } finally {
        // Whatever happened in the rehearsal, the room is put back as it was.
        say('Preparing shaders: the people.');
        await reset();
        Object.assign(weapons, { slots: carried.slots, bag: carried.bag, ammo: carried.ammo });
        weapons.select(carried.slot);
        await ready();
    }
    async function rehearse() {
        const [a, b, c, d] = world.npcs;
        // Each gun at someone (entry, exit, lips, the hider's windows, blood on skin and clothes, soak), the shotgun from close
        // into a belly (the opened belly and its organs) and from range.
        const shots: [string, any, string, number?][] = [['pistol', a, 'chest'], ['m4', a, 'thighL'], ['ak', b, 'belly'], ['rifle', b, 'head'],
            ['shotgun', c, 'belly', 0.9], ['shotgun', d, 'chest', 5], ['pistol', c, 'upperarmR'], ['rifle', d, 'thighR'], ['deagle', a, 'belly'], ['r22', c, 'thighL']];
        for (const [key, npc, part, from] of shots) {
            say(`Preparing shaders: ${ARMS.find((x) => x.key === key)?.name ?? key}.`);
            weapons.take(key);
            await ready(1);
            aim(npc, part, from);
            press();
            await ready(4);
    }
    // A stab and a cut, a blow with the bat, a punch.
    say('Preparing shaders: blades and blows.');
    for (const [key, button, part] of [['knife', 0, 'belly'], ['sword', 2, 'forearmL'], ['bat', 0, 'head'], [null, 2, 'head']] as const) {
        weapons.take(key);
        await ready(1);
        aim(d, part, 0.7);
        press(button);
        await new Promise((r) => setTimeout(r, 120));      // a stab lands after 90 ms
        await ready(24);      // a swing is over in half a second
    }
    // Limbs off: a cut and a shot, an arm and a leg.
    say('Preparing shaders: wounds.');
    sever(a, 'forearm', 'L', null, null, 'blade');
    await ready(3);
    sever(b, 'shin', 'R', null, null, 'shot');
    await ready(3);
    // A dressing on someone's wound.
    const w = wounds(a)[0];
    if (w) { dress(w); await ready(3); }
    // X-ray on and off.
    xray(); await ready(); xray(); await ready();
    }
}
