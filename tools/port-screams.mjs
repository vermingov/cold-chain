// The TS game's side of the Bevy port's `screams` scenario (game/src/scenario.rs): the four standing, each shot once with
// the pistol (the old man's right upper arm, the groundskeeper's left thigh, the young man's belly, the hooded man's left
// shin), the old man again in the left thigh half a minute on, four shots into the groundskeeper a quarter second apart
// at 45 s, and a minute of what follows with the physics running.
// Every voice started (npc.say's cries and coughs, throat.ts's retch, vomit and wet cough at the head), by person and
// kind. world.sound is replaced by a recorder (the rig cannot start audio); stepped by hand at 1/60 s with the render
// loop stopped, the dice seeded, and performance.now on the game's clock (npc.say keeps its `until` on it).
//   npx vite --port 8704 --host 127.0.0.1 &   (from the repository)
//   CHROMIUM=... node tools/port-screams.mjs <out.json> [url]
import { open } from './rig.mjs';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'ts-screams.json';
const url = process.argv[3] || 'http://127.0.0.1:8704/play.html?nowarm';
const rig = await open('about:blank', { width: 640, height: 360 });
await rig.send('Page.addScriptToEvaluateOnNewDocument', { source: `{ let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }` });
await rig.send('Page.navigate', { url });
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4 && window.__sandbox.weapons.models.size > 10', 900000);
    await rig.eval(`(async () => {
        document.getElementById('start')?.remove();
        const S = window.__sandbox, scene = S.scene, world = S.world, V3 = BABYLON.Vector3;
        const W = await import('/src/sandbox/wounds.ts'), WE = await import('/src/sandbox/weapons.ts');
        scene.getEngine().stopRenderLoop();
        let t = 0;
        performance.now = () => t * 1000;
        const heard = [];
        world.sound = {
            shot: (name, o = {}) => { heard.push([t, name]); return { name, start: t, from: 0, length: 2, rate: 1, buffer: { getChannelData: () => new Float32Array(1), sampleRate: 48000 }, cut() {} }; },
            stream: () => null, now: () => t, raw: { has: () => false, stream: () => null, listen() {}, update() {} },
        };
        const step = (n) => { for (let k = 0; k < n; k++) { S.update(1 / 60); scene._advancePhysicsEngineStep(1000 / 60); t += 1 / 60; } };
        const who = (i) => world.npcs.find((n) => n.person.bodyName.split('+')[0] === ['oldman', 'sexton', 'buyer', 'hood'][i]);
        const gun = WE.ARMS.find((a) => a.key === 'pistol').gun;
        const shoot = (i, a, b, f) => {
            const npc = who(i), A = npc.person.byName[a], B = npc.person.byName[b];
            const at = npc.worldOf(V3.Lerp(A.head, B.head, f), A).at, dir = new V3(0, 0, 1);
            W.pierce(npc, at.subtract(dir.scale(1.5)), dir, { ...gun }, 3);
        };
        window.__R = { S, step, who, shoot, heard, t: () => t };
        step(90);
        return true;
    })()`);
    const t0 = await rig.eval(`(() => {
        __R.shoot(0, 'upperarm01.R', 'lowerarm01.R', 0.5);
        __R.shoot(1, 'upperleg01.L', 'lowerleg01.L', 0.5);
        __R.shoot(2, 'spine03', 'spine02', 0.5);
        __R.shoot(3, 'lowerleg01.L', 'foot.L', 0.5);
        return __R.t();
    })()`);
    // (A few seconds a call: the rig's eval would time out on a whole minute of physics.)
    for (let s = 0; s < 60; s++) {
        if (s === 30) await rig.eval(`__R.shoot(0, 'upperleg01.L', 'lowerleg01.L', 0.5)`);
        if (s === 45) {
            // Four shots a quarter second apart into the groundskeeper, as a magazine is emptied.
            for (const [a, b] of [['upperarm01.L', 'lowerarm01.L'], ['lowerarm01.L', 'wrist.L'], ['upperarm01.R', 'lowerarm01.R'], ['upperleg01.R', 'lowerleg01.R']])
                await rig.eval(`(__R.shoot(1, '${a}', '${b}', 0.5), __R.step(15), true)`);
            continue;
        }
        await rig.eval(`(__R.step(60), true)`);
    }
    const result = await rig.eval(`(() => {
        const voices = ['oldman', 'sexton', 'buyer', 'hood'].map((b, i) => __R.who(i).voice);
        const kinds = /^(scream|yell|groan|cry|gasp|cough|dying)-(.*)$/;
        const started = [];
        for (const [t, name] of __R.heard) {
            const m = kinds.exec(name);
            if (m && voices.includes(m[2])) started.push([+(t - ${t0}).toFixed(1), voices.indexOf(m[2]), m[1]]);
            else if (name === 'retch' || name === 'vomit' || name === 'cough-wet') started.push([+(t - ${t0}).toFixed(1), -1, 'retch, vomit or wet cough']);
        }
        const by = [0, 1, 2, 3].map((i) => { const k = {}; for (const s of started) if (s[1] === i) k[s[2]] = (k[s[2]] ?? 0) + 1; return k; });
        const minutes = (__R.t() - ${t0}) / 60;
        return { seconds: +(__R.t() - ${t0}).toFixed(1), by_person: by, per_person_per_minute: by.map((k) => +(Object.values(k).reduce((a, b) => a + b, 0) / minutes).toFixed(1)),
                 started, states: [0, 1, 2, 3].map((i) => { const v = __R.who(i).vitals; return [v.state, +v.conscious.toFixed(2), +v.pain.toFixed(2), v.dead]; }) };
    })()`);
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(JSON.stringify({ by_person: result.by_person, per_person_per_minute: result.per_person_per_minute, states: result.states }));
    console.log('errors', JSON.stringify(rig.errors().slice(0, 10)));
} finally {
    await rig.close();
}
