// Send a place out to be baked: build it in the game's own page, headless, and write what src/bake.js `describe`
// makes of it.
//   node tools/forge/describe.mjs <flat-night | flat-morning> <out.json>
// Needs the dev server (node server.js, PORT 8669).
import { writeFileSync } from 'node:fs';
import { open } from '../rig.mjs';

const [what, out] = process.argv.slice(2);
const [place, time] = what.split('-');
const rig = await open('http://127.0.0.1:' + (process.env.PORT || 8669) + '/play.html', { width: 800, height: 450 });
try {
    await rig.until('window.__game', 20000);
    const described = await rig.eval(`(async () => {
        const { describe } = await import('/src/bake.js');
        const { openFlat } = await import('/src/game/flat.js');
        if ('${place}' !== 'flat') throw new Error('no such place: ${place}');
        const flat = await openFlat(__game.engine, __game.canvas, { screen: __game.screen, morning: '${time}' === 'morning' });
        return JSON.stringify(await describe(flat.bake.meshes, flat.bake.lights));
    })()`);
    writeFileSync(out, described);
    const parsed = JSON.parse(described);
    console.log(what, parsed.meshes.length, 'meshes,', parsed.meshes.reduce((n, m) => n + m.indices.length / 3, 0), 'triangles,', parsed.lights.length, 'lights');
} finally { await rig.close().catch(() => {}); }
