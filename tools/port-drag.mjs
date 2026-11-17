// The TS game's side of the Bevy port's `drag` scenario (game/src/scenario.rs): the groundskeeper (jitter.mjs's npc 3)
// taken by the right hand from 1.4 m off and swept about for eight seconds as jitter.mjs did
// (the eye's yaw 0.6 rad either way at 0.4 Hz, its pitch at 0.27 Hz), then let go. Each second: where the hand held is
// against where it is drawn to (the scenario's `held`) and where the chest is; over the drag, each segment's
// high-frequency spin per physics step (the jitter measure). Stepped by hand at 1/60 s, the render loop stopped, the dice
// seeded.
//   CHROMIUM=... node tools/port-drag.mjs <out.json> [url] [body]   (the dev server on 8703: npx vite --port 8703; body sexton)
import { open } from './rig.mjs';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'ts-drag.json';
const url = process.argv[3] || 'http://127.0.0.1:8703/play.html?nowarm';
const body = process.argv[4] || 'sexton';
const rig = await open('about:blank', { width: 640, height: 360 });
await rig.send('Page.addScriptToEvaluateOnNewDocument', { source: `{ let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }` });
await rig.send('Page.navigate', { url });
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4', 900000);
    const result = await rig.eval(`(() => {
        document.getElementById('start')?.remove();
        const S = window.__sandbox, scene = S.scene, world = S.world, W = S.weapons, V3 = BABYLON.Vector3;
        scene.getEngine().stopRenderLoop();
        const npc = world.npcs.find((n) => n.person.bodyName.split('+')[0] === '${body}'), rd = npc.ragdoll;
        // Each segment's spin after every physics step: the sum of its squared second difference.
        const plugin = scene.getPhysicsEngine().getPhysicsPlugin(), orig = plugin.executeStep.bind(plugin);
        const hf = {}, last = {};
        let measuring = false;
        plugin.executeStep = (d, bodies) => {
            orig(d, bodies);
            for (const seg of rd.segments) {
                const w = seg.body.getAngularVelocity(), l = last[seg.name] ??= [];
                if (measuring && l.length === 2) { const h = hf[seg.name] ??= [0, 0]; h[0]++; h[1] += w.subtract(l[0].scale(2)).add(l[1]).lengthSquared(); }
                l.unshift(w); l.length = Math.min(l.length, 2);
            }
        };
        const step = () => { S.update(1 / 60); scene._advancePhysicsEngineStep(1000 / 60); };
        const r = (v) => v.asArray().map((x) => Math.round(x * 1000) / 1000);
        for (let k = 0; k < 60; k++) step();
        const seg = rd.byName.get('handR'), at = rd.worldPoint(seg, seg.centre, new V3());
        const back = rd.centre.subtract(at); back.y = 0; back.normalize();
        S.player.spawn(at.x - back.x * 1.4, at.z - back.z * 1.4, { toward: [at.x, at.y, at.z], eye: 1.65 });
        S.update(1 / 60);
        npc.grabbed = true; npc.knockDown();
        const local = V3.TransformCoordinates(at, seg.node.computeWorldMatrix(true).clone().invert());
        W.grab = { body: seg.body, node: seg.node, local, distance: V3.Distance(world.camera.globalPosition, at), mass: seg.mass, npc };
        const p = S.player, yaw0 = p.yaw, log = [];
        for (let k = 0; k < 480; k++) {
            const t = k / 60;
            p.yaw = yaw0 + 0.6 * Math.sin(t * 2 * Math.PI * 0.4); p.pitch = 0.35 + 0.15 * Math.sin(t * 2 * Math.PI * 0.27);
            if (k % 60 === 0) {
                const held = V3.TransformCoordinates(local, seg.node.computeWorldMatrix(true));
                log.push({ t, held: r(held), target: W.grab.target ? r(W.grab.target) : null, chest: r(rd.byName.get('chest').node.position), mode: npc.behaviour.mode });
            }
            measuring = t >= 2;
            step();
        }
        W._letGo();
        const jitter = Object.fromEntries(Object.entries(hf).map(([k, [n, s]]) => [k, Math.round(Math.sqrt(s / n) * 100) / 100]));
        const mean = Object.values(jitter).reduce((a, b) => a + b, 0) / Object.values(jitter).length;
        return { log, mean_hf: Math.round(mean * 1000) / 1000, jitter };
    })()`);
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log('errors', JSON.stringify(rig.errors().slice(0, 10)));
} finally {
    await rig.close();
}
