// The TS game's side of the Bevy port's `blood` check (game/src/blood.rs `scenario`): the same four wounds at the same
// places of the line-up (TS coordinates: the femoral nick, a pistol through the neck of a man knocked down and out, a
// shotgun into a chest, a knife into a belly), then the same views at 0, 2, 10, 30 and 120 seconds. Time is the game's
// own, stepped a sixtieth at a time (physics, then S.update) with the render loop stopped, and drawn only for a picture:
// SwiftShader draws a frame in a second or two.
//   npx vite --port 8684 --host 127.0.0.1 &
//   CHROMIUM=/opt/pw-browsers/chromium... node tools/port-blood.mjs <dir> [url]
import { open } from './rig.mjs';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const url = process.argv[3] || 'http://127.0.0.1:8684/play.html?nowarm';
const rig = await open('about:blank', { width: 1280, height: 720 });
const log = [];
try {
    await rig.send('Page.navigate', { url });
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4', 900000);
    await rig.eval(`(() => {
      const S = window.__sandbox; S.scene.getEngine().stopRenderLoop();
      document.getElementById('start')?.remove(); const o = document.getElementById('over'); if (o) o.style.display = 'none';
      let sim = performance.now() / 1000; const real = performance.now.bind(performance); performance.now = () => sim * 1000;
      // (The physics stepped here only, in milliseconds as Babylon takes them: not again by a picture's render.)
      S.scene.physicsEnabled = false;
      // (The held weapon and the arms out of the picture: the port's views have none yet.)
      for (const m of S.scene.meshes) if (m.renderingGroupId === 1) m.isVisible = false;
      window.__tick = (n) => { for (let i = 0; i < n; i++) { sim += 1 / 60; S.scene._advancePhysicsEngineStep(1000 / 60); S.update(1 / 60); } };
      return true; })()`);
    // Settle on their feet, as the port's scenario starts after its line-up stands.
    await rig.eval('__tick(60)');
    const frames = async (n) => { for (let k = 0; k < n; k += 600) await rig.eval(`__tick(${Math.min(600, n - k)})`); };
    // The second person out cold and pushed over backwards (north): five seconds to settle.
    await rig.eval(`(() => { const n = __sandbox.world.npcs[1]; n.vitals.out = 1e9; const c = n.ragdoll.byName.get('chest');
      n.ragdoll.push('chest', new BABYLON.Vector3(0, 0, 60), c.node.position.clone()); n.knockDown(); return true; })()`);
    await frames(300);
    const res = await rig.eval(`(async () => {
      const S = __sandbox, V = BABYLON.Vector3, W = await import('/src/sandbox/wounds.ts'), WE = await import('/src/sandbox/weapons.ts');
      const arm = (k) => WE.ARMS.find((a) => a.key === k);
      const out = [];
      const wound = (name, i, bone, offset, dir, back, m, pellets = [[0, 0, 0]]) => {
        const npc = S.world.npcs[i], b = npc.person.byName[bone];
        const target = npc.worldOf(b.head, b).at.add(V.FromArray(offset));
        for (const o of pellets) W.pierce(npc, target.add(V.FromArray(o)).subtract(dir.scale(back)), dir, { ...m }, back + (m.reach ?? 2));
        out.push({ name, target: target.asArray(), bleeds: npc.vitals.bleeds.map((b) => ({ name: b.name, rate: b.rate, arterial: b.arterial, spurts: b.spurts })) });
      };
      const knife = { ...arm('knife').stab, across: new V(0, -1, 0) }, ahead = new V(0, 0, 1);
      wound('femoral nick', 0, 'upperleg01.R', [0.035, -0.07, 0], ahead, 0.5, knife);
      wound('neck shot, lying', 1, 'neck01', [0, 0, 0], new V(0, -1, 0), 0.6, arm('pistol').gun);
      const P = [[-0.03, -0.03, 0], [0, -0.03, 0], [0.03, -0.03, 0], [-0.03, 0, 0], [0, 0, 0], [0.03, 0, 0], [-0.03, 0.03, 0], [0, 0.03, 0], [0.03, 0.03, 0]];
      wound('shotgun chest', 2, 'spine01', [0.04, 0.05, 0], ahead, 1.5, arm('shotgun').gun, P);
      wound('knife belly', 3, 'spine03', [0.05, 0.02, 0], ahead, 0.5, knife);
      return out; })()`);
    log.push({ event: 'wounds', res });
    const view = async (name, x, z, toward, eye) => {
        await rig.eval(`(() => { __sandbox.player.spawn(${x}, ${z}, { toward: ${JSON.stringify(toward)}, eye: ${eye} }); __tick(6); for (const m of __sandbox.scene.meshes) if (m.renderingGroupId === 1) m.isVisible = false; __sandbox.scene.render(); return true; })()`);
        await rig.shot(`${OUT}/${name}.png`);
    };
    let at = 0;
    for (const t of [0, 2, 10, 30, 120]) {
        await frames(Math.round((t - at) * 60));
        at = t + 0.5;
        log.push({ event: 'blood', t, drops: await rig.eval('__sandbox.world.blood.n'), streams: await rig.eval('__sandbox.world.blood.streams.size'),
            soaked: await rig.eval('__sandbox.world.npcs.map((n) => +Array.from(n.soak.ml).reduce((a, b) => a + b, 0).toFixed(1))'),
            lost: await rig.eval('__sandbox.world.npcs.map((n) => +(n.vitals.full - n.vitals.volume).toFixed(3))') });
        const x = (i) => (i - 1.5) * 1.5;
        const T = String(t).padStart(3, '0');
        await view(`blood_${T}_femoral`, x(0) - 1.0, 0.6, [x(0), 0.6, 2.2], 1.5);
        await view(`blood_${T}_neck`, x(1) + 0.9, 1.0, [x(1), 0.05, 2.6], 1.6);
        await view(`blood_${T}_chest`, x(2), 0.7, [x(2), 0.9, 2.2], 1.5);
        await view(`blood_${T}_belly`, x(3) + 0.8, 0.8, [x(3), 0.7, 2.2], 1.4);
        await view(`blood_${T}_floor`, 0, -0.5, [0, 0, 2.4], 2.4);
        console.log('t', t);
    }
    log.push({ errors: rig.errors().slice(0, 5) });
} finally {
    writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
    await rig.close();
}
