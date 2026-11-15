// The TS game's views for the Bevy port's comparison: the same places as game/src/scenario.rs's (TS coordinates).
// With the dev server on 8680 (npx vite --port 8680): CHROMIUM=... node tools/port-views.mjs <dir> [hall|arsenal|people]
import { open } from './rig.mjs';
const OUT = process.argv[2];
const only = process.argv[3] || 'all';
const rig = await open('http://127.0.0.1:8680/play.html?nowarm', { width: 1280, height: 720 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4', 600000);
    await rig.eval('document.getElementById("start")?.remove()');
    console.log('booted', await rig.eval('window.__sandbox.world.frame'));
    const view = async (name, x, z, toward, eye = 1.65) => {
        await rig.eval(`window.__sandbox.player.spawn(${x}, ${z}, { toward: ${JSON.stringify(toward)}, eye: ${eye} })`);
        const f0 = await rig.eval('window.__sandbox.world.frame');
        await rig.until(`window.__sandbox.world.frame > ${f0 + 6}`, 600000);
        await rig.shot(`${OUT}/${name}.png`);
        console.log('shot', name);
    };
    // Let the people settle on their feet.
    await rig.until('window.__sandbox.world.frame > 90', 900000);
    if (only === 'all' || only === 'hall') {
        await view('hall_spawn', 0, -4, [0, 1.4, 2]);
        await view('hall_sw', -10, -10, [3, 1.5, 4]);
        await view('hall_east', 2, -2, [9, 1.5, 2]);
        await view('hall_north', 5, 7, [-4, 1.0, -6]);
    }
    if (only === 'all' || only === 'arsenal') {
        await view('arsenal_wide', -7.2, -1.2, [-11, 1.4, -1.2]);
        await view('arsenal_close', -9.3, -2.2, [-11, 1.4, -2.2]);
    }
    if (only === 'all' || only === 'people') {
        const names = ['oldman', 'sexton', 'buyer', 'hood'];
        for (let i = 0; i < 4; i++) {
            await rig.eval(`window.__sandbox.world.npcs.forEach((n, k) => n.person.setEnabled(k === ${i}))`);
            const x = (i - 1.5) * 1.5, z = 2.2;
            const h = await rig.eval(`window.__sandbox.world.npcs[${i}].person.height`);
            await view(`people_${names[i]}_front`, x, z - 2.1, [x, 0.95, z], 1.0);
            await view(`people_${names[i]}_side`, x + 2.1, z, [x, 0.95, z], 1.0);
            await view(`people_${names[i]}_face`, x, z - 0.6, [x, h - 0.1, z], h - 0.08);
        }
        await rig.eval('window.__sandbox.world.npcs.forEach((n) => n.person.setEnabled(true))');
    }
    console.log('errors', JSON.stringify(rig.errors().slice(0, 5)));
} finally {
    await rig.close();
}
