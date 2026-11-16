// The TS game's side of the Bevy port's `skin` check (game/src/skin.rs `scenario`): the same shots, stab, cut, blows and
// bandage at the same places of the standing people, then each wound photographed close up at 0, 5, 30 and 120 seconds.
// The render loop is stopped and the game stepped by hand (S.update, sixty times a game second, no physics: the people
// stand as they were made, as the port's are held), and drawn only for the pictures.
//   cd /home/user/cold-chain && npx vite --port 8683 --host 127.0.0.1 &
//   CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux/chrome node tools/port-skin.mjs <out dir> [url]
import { open } from './rig.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'ts-skin';
const url = process.argv[3] || 'http://127.0.0.1:8683/play.html?nowarm';
mkdirSync(OUT, { recursive: true });

const rig = await open('about:blank', { width: 1280, height: 720 });
try {
    await rig.send('Page.navigate', { url });
    await rig.until('!!window.__sandbox && window.__sandbox.world.npcs.length === 4', 900000);
    await rig.eval(`(async () => {
      const S = window.__sandbox; S.scene.getEngine().stopRenderLoop();
      document.getElementById('start')?.remove();
      for (const el of document.body.querySelectorAll('*')) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
      const W = await import('/src/sandbox/wounds.ts'), D = await import('/src/sandbox/dressing.ts');
      let sim = 0; performance.now = () => sim * 1000;
      window.__M = { S, W, D, tick: (dt) => { sim += dt; S.update(dt); } };
      return true; })()`);
    // A few frames for everything to be made and drawn once.
    await rig.eval(`(() => { for (let i = 0; i < 30; i++) __M.tick(1 / 60); __M.S.scene.render(); return true; })()`);
    const views = await rig.eval(`(() => {
      const { S, W, D } = __M, V = BABYLON.Vector3, npcs = S.world.npcs, views = [];
      const near = (npc, bone, off) => { const b = npc.person.byName[bone]; return npc.worldOf(b.head, b).at.add(V.FromArray(off)); };
      const view = (name, k, c, d) => views.push({ name, k, rest: c.rest.clone(), owner: c.owner, n: c.restNormal.clone(), d });
      const skins = (npc, at, dir, far) => npc.surface(at, dir, far).filter((h) => h.kind === 'skin');
      const ahead = new V(0, 0, 1);
      const pistol = { energy: 480, mass: 0.008, speed: 360, calibre: 0.009, channel: 0.006, soft: 12, hard: 110, pellets: 1 };
      const rifle = { energy: 2700, mass: 0.0097, speed: 820, calibre: 0.0078, channel: 0.012, soft: 28, hard: 160, pellets: 1 };
      const knife = { energy: 70, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40, reach: 0.17, blade: true, edges: 1, taper: 0.04 };
      // A pistol in the side of the young man's neck, and a knife drawn across his left cheek.
      let npc = npcs[2], at = near(npc, 'neck01', [0.025, -0.03, 0]);
      let s = skins(npc, at.subtract(ahead.scale(1.5)), ahead, 3); if (s[0]) view('pistol_neck', 2, s[0], 0.3);
      W.pierce(npc, at.subtract(ahead.scale(1.5)), ahead, { ...pistol }, 3);
      const hits = [];
      for (let k = 0; k < 7; k++) { const p = near(npc, 'head', [-0.045 + k * 0.008, 0.02 - k * 0.003, 0]); const c = npc.surface(p.subtract(ahead.scale(0.5)), ahead, 1).find((h) => h.kind === 'skin'); if (c) hits.push(c); }
      if (hits.length) view('knife_cut', 2, hits[Math.floor(hits.length / 2)], 0.28);
      npc.slash(hits, 0.022, null);
      // A rifle through the old man's face, from his right.
      npc = npcs[0]; const side = new V(-1, 0, 0); at = near(npc, 'jaw', [0, -0.025, -0.04]);
      s = skins(npc, at.subtract(side.scale(1.5)), side, 3);
      if (s[0]) view('rifle_in', 0, s[0], 0.3);
      const out = s.filter((h) => h.t < s[0].t + 0.25).pop(); if (out && out !== s[0]) view('rifle_out', 0, out, 0.3);
      W.pierce(npc, at.subtract(side.scale(1.5)), side, { ...rifle }, 3);
      // The groundskeeper stabbed in the belly through his shirt, and punched in the left eye.
      npc = npcs[1]; at = near(npc, 'spine03', [0.05, 0.02, 0]);
      const cl = npc.surface(at.subtract(ahead.scale(0.5)), ahead, 0.67)[0]; if (cl) view('knife_stab', 1, cl, 0.3);
      W.pierce(npc, at.subtract(ahead.scale(0.5)), ahead, { ...knife, across: new V(0, -1, 0) }, 0.67);
      let e = npc.surface(near(npc, 'head', [-0.033, 0.035, 0]).subtract(ahead.scale(0.5)), ahead, 1).find((h) => h.kind === 'skin');
      if (e) { view('punch_eye', 1, e, 0.3); W.blow(npc, e.point, ahead, 2.9, 10, 5e4); }
      // The man in the hood shot in the right forearm and bandaged at once; then a bat to his left cheekbone.
      npc = npcs[3]; at = near(npc, 'lowerarm01.R', [0, -0.06, 0]);
      W.pierce(npc, at.subtract(ahead.scale(1.5)), ahead, { ...pistol }, 3);
      const w = D.wounds(npc)[0]; if (w) { view('bandaged', 3, w.mark, 0.35); D.dress(w); }
      e = npc.surface(near(npc, 'head', [-0.035, 0.03, 0]).subtract(ahead.scale(0.5)), ahead, 1).find((h) => h.kind === 'skin');
      if (e) { view('bat_cheek', 3, e, 0.3); W.blow(npc, e.point, ahead, 0.79, 15.5); }
      window.__views = views;
      return views.map((v) => v.name); })()`);
    console.log('views', views.join(' '));
    const photograph = async (t) => {
        for (const [i, name] of views.entries()) {
            await rig.eval(`(() => {
              const { S } = __M, V = BABYLON.Vector3, v = window.__views[${i}], npc = S.world.npcs[v.k];
              const w = npc.worldOf(v.rest, v.owner, v.n);
              const eye = w.at.add(w.normal.scale(v.d)).add(new V(0, 0.02, 0));
              S.player.spawn(eye.x, eye.z, { toward: w.at.asArray(), eye: eye.y });
              for (let i = 0; i < 3; i++) { __M.tick(1 / 60); S.scene.render(); }
              return true; })()`);
            await rig.shot(`${OUT}/${name}_${t}.png`);
        }
    };
    let now = 0;
    for (const t of [0, 5, 30, 120]) {
        const n = Math.max(0, Math.round((t - now) * 60) - (t ? 30 : 0));
        for (let done = 0; done < n; done += 600) await rig.eval(`(() => { for (let i = 0; i < ${Math.min(600, n - done)}; i++) __M.tick(1 / 60); return true; })()`, 600000);
        now = t;
        await photograph(t);
        console.log('photographed', t);
    }
    console.log('errors', JSON.stringify(rig.errors?.().slice(0, 5)));
} finally {
    await rig.close();
}
