// The TS game's first-person views with each thing in the hand, for the Bevy port's `arsenal-use` scenario
// (game/src/weapons.rs `scenario`): the same places, and the same moments of a reload, a swing, a wound-up punch and a
// grenade leaving the hand, by the game's own clocks.
// With the dev server on 8682 (npx vite --port 8682): CHROMIUM=... node tools/port-hands-views.mjs <dir> [key ...]
import { open } from './rig.mjs';
const OUT = process.argv[2];
const only = process.argv.slice(3);
const rig = await open('http://127.0.0.1:8682/play.html?nowarm', { width: 1280, height: 720 });
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4 && window.__sandbox.weapons.models.size > 10', 900000);
    await rig.eval('document.getElementById("start")?.remove()');
    await rig.until('window.__sandbox.world.frame > 90', 900000);
    const W = 'window.__sandbox.weapons';
    const frames = async (n) => {
        const f0 = await rig.eval('window.__sandbox.world.frame');
        await rig.until(`window.__sandbox.world.frame > ${f0 + n}`, 600000);
    };
    const stand = (x, z, toward, eye = 1.65) => rig.eval(`window.__sandbox.player.spawn(${x}, ${z}, { toward: ${JSON.stringify(toward)}, eye: ${eye} })`);
    const shot = async (name) => { await rig.shot(`${OUT}/${name}.png`); console.log('shot', name); };
    const keys = await rig.eval('JSON.stringify(window.__sandbox.weapons.constructor && [...new Set([...window.__sandbox.weapons.models.keys(), "hands", "fists", "throw"])])');
    const all = ['knife', 'sword', 'bat', 'pistol', 'rifle', 'shotgun', 'ak', 'm4', 'deagle', 'r22', 'shovel', 'sledge', 'hammer', 'grenade', 'hands', 'fists', 'throw', 'bandage', 'medkit'];
    console.log('models', keys);
    for (const key of all) {
        if (only.length && !only.includes(key)) continue;
        await rig.eval(`${W}.slots = [null, null, null, null, null, null]; ${W}.take(${JSON.stringify(key)}); ${W}.select(0)`);
        await stand(0, -4, [0, 1.4, 2]);
        await frames(40);
        await shot(`fp_${key}`);
        const kind = await rig.eval(`${W}.arm.kind`);
        const near = kind === 'gun' ? 3.2 : kind === 'grenade' ? 5 : ['knife', 'hammer', 'fists', 'hands'].includes(key) ? 0.5 : 0.75;
        if (kind === 'gun') {
            // 0.67 s into a reload, as the Bevy run has it.
            await rig.eval(`${W}.ammo.set(${JSON.stringify(key)}, 0); ${W}._reload()`);
            await rig.until(`${W}.reloading <= ${W}.arm.gun.reload - 0.667`, 600000);
            await shot(`fp_${key}_reloading`);
            await rig.until(`${W}.reloading <= 0`, 600000);
        } else if (kind === 'blade' || kind === 'blunt') {
            await stand(0.75, 2.2 - near, [0.75, 1.3, 2.2]);
            await frames(8);
            await rig.eval(`${W}._press(0)`);
            await rig.until(`(${W}.action?.t ?? 9) >= 0.28`, 600000);
            await shot(`fp_${key}_swing`);
            await rig.until(`!${W}.action && ${W}.busy <= 0`, 600000);
        } else if (kind === 'fists') {
            await stand(0.75, 2.2 - near, [0.75, 1.3, 2.2]);
            await frames(30);
            await rig.eval(`${W}._press(2)`);
            await rig.until(`${W}.fists.R.wind >= 0.83`, 600000);
            await shot('fp_fists_wound');
            await rig.eval(`${W}._punch('R')`);
            await frames(30);
        } else if (kind === 'grenade') {
            await stand(0.75, 2.2 - near, [0.75, 1.3, 2.2]);
            await frames(4);
            await rig.eval(`${W}._press(2)`);
            await rig.until(`${W}.busy <= 0.9 - 0.27`, 600000);
            await shot('fp_grenade_lob');
            await rig.until(`${W}.busy <= 0`, 600000);
        }
    }
    console.log('errors', JSON.stringify(rig.errors().slice(0, 5)));
} finally {
    await rig.close();
}
