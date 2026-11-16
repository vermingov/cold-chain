// The TS game's side of the Bevy port's `guns` scenario (game/src/scenario.rs): a gun taken in the hand, aimed at a
// standing person's chest from 3 m, fired (weapons._fire, as a click does), and what they do for five seconds a quarter
// second at a time, their injuries and vitals after, and every sound asked for (world.sound replaced by a recorder: the
// rig cannot start audio). Stepped by hand at 1/60 s (the render loop stopped), the dice seeded.
//   CHROMIUM=... node tools/port-guns.mjs <out.json> [url]   (with the dev server on 8701: npx vite --port 8701)
import { open } from './rig.mjs';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'ts-guns.json';
const url = process.argv[3] || 'http://127.0.0.1:8701/play.html?nowarm';
const rig = await open('about:blank', { width: 640, height: 360 });
await rig.send('Page.addScriptToEvaluateOnNewDocument', { source: `{ let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }` });
await rig.send('Page.navigate', { url });
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4 && window.__sandbox.weapons.models.size > 10', 900000);
    const result = await rig.eval(`(() => {
        document.getElementById('start')?.remove();
        const S = window.__sandbox, scene = S.scene, world = S.world, W = S.weapons, V3 = BABYLON.Vector3;
        scene.getEngine().stopRenderLoop();
        let t = 0;
        const heard = [];
        world.sound = {
            shot: (name, o = {}) => { const p = { name, start: t, from: 0, length: 2, rate: 1, buffer: { getChannelData: () => new Float32Array(1), sampleRate: 48000 }, cut() { heard.push([+t.toFixed(3), 'cut ' + name]); } }; heard.push([+t.toFixed(3), name, +(o.gain ?? 1).toFixed(2)]); return p; },
            stream: () => null, now: () => t, raw: { has: () => false, stream: () => null, listen() {}, update() {} },
        };
        const step = (n) => { for (let k = 0; k < n; k++) { S.update(1 / 60); scene._advancePhysicsEngineStep(1000 / 60); t += 1 / 60; } };
        const who = (i) => world.npcs.find((n) => n.person.bodyName.split('+')[0] === ['oldman', 'sexton', 'buyer', 'hood'][i]);
        const r = (x, k) => Math.round(x * k) / k;
        step(90);
        const log = [];
        for (const [i, key] of [[0, 'pistol'], [1, 'rifle'], [2, 'shotgun']]) {
            const npc = who(i);
            W.slots = [null, null, null, null, null, null]; W.take(key); W.select(0);
            const c = npc.ragdoll.byName.get('chest').node.position;
            S.player.spawn(c.x, c.z - 3, { toward: [c.x, c.y, c.z], eye: 1.65 });
            step(41);
            heard.length = 0;
            const t0 = t;
            W.busy = 0; W._fire();
            const after = [];
            for (let q = 0; q <= 20; q++) {
                const b = npc.behaviour, v = npc.vitals;
                after.push([q / 4, b.state, b.mode, b._why ?? '', r(v.conscious, 100), r(v.pain, 100)]);
                step(15);
            }
            const v = npc.vitals;
            log.push({ gun: key, after, heard: heard.map((h) => [r(h[0] - t0, 1000), ...h.slice(1)]),
                vitals: { hr: r(v.hr, 10), map: r(v.map, 10), spo2: r(v.spo2, 10), rr: r(v.rr, 10), lost: r(v.full - v.volume, 1e4), conscious: r(v.conscious, 1e3), pain: r(v.pain, 1e3), dead: v.dead, state: v.state },
                injuries: v.injuries.map((x) => [x.text, r(x.severity, 1e3)]), bleeds: v.bleeds.map((b) => [b.name, r(b.rate * 1000, 1e5), !!b.arterial, !!b.internal]),
                breaks: npc.bones.breaks.map((b) => [b.text, b.type]) });
        }
        return log;
    })()`);
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log('errors', JSON.stringify(rig.errors().slice(0, 10)));
} finally {
    await rig.close();
}
