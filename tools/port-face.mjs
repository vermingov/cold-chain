// The TS game's side of the Bevy port's `face` check (game/src/face.rs `scenario`): the same faces in the same order,
// close up. The render loop is stopped and the game stepped by hand (S.update, sixty times a game second, its physics
// with it), drawn only for the pictures, as tools/port-skin.mjs does: on the software renderer a drawn frame is seconds.
//   cd /home/user/cold-chain && npx vite --port 8686 --host 127.0.0.1 &
//   CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node tools/port-face.mjs <out dir> [url]
import { open } from './rig.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'ts-face';
const url = process.argv[3] || 'http://127.0.0.1:8686/play.html?nowarm';
mkdirSync(OUT, { recursive: true });

const rig = await open('about:blank', { width: 1280, height: 720 });
try {
    await rig.send('Page.navigate', { url });
    await rig.until('!!window.__sandbox && window.__sandbox.world.npcs.length === 4', 1800000);
    await rig.eval(`(async () => {
      const S = window.__sandbox; S.scene.getEngine().stopRenderLoop();
      document.getElementById('start')?.remove();
      // (the voices: the sounds are read in on the click that starts the sandbox)
      await S.world.start();
      for (const el of document.body.querySelectorAll('*')) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
      const W = await import('/src/sandbox/wounds.ts'), WE = await import('/src/sandbox/weapons.ts');
      let sim = 0; performance.now = () => sim * 1000;
      const V = BABYLON.Vector3;
      window.__M = { S, W, WE, tick: (dt) => { sim += dt; S.update(dt); }, sim: () => sim,
        npc: (body) => S.world.npcs.find((n) => n.person.bodyName.split('+')[0] === body),
        // The middle of the eyes and the way the face looks, now.
        at: (n) => { const b = n.person.byName, a = n.worldOf(b['eye.L'].head, b['eye.L']).at, c = n.worldOf(b['eye.R'].head, b['eye.R']).at;
          return { eyes: a.add(c).scale(0.5), fwd: n.ragdoll.byName.get('head').node.getDirection(V.Forward()) }; },
      };
      // (The page's audio clock stands still in the headless browser: whatever a face is to mouth is put on the game's
      // own clock, as the port's Sound::now is, so the face hears it play.)
      for (const n of S.world.npcs) { const f = n.face, speak = f.speak.bind(f); f.speak = (p, now, kind) => { if (p) p.start = sim; speak(p, () => sim, kind); }; }
      return true; })()`);
    const tick = async (frames) => {
        for (let done = 0; done < frames; done += 600) await rig.eval(`(() => { for (let i = 0; i < ${Math.min(600, frames - done)}; i++) __M.tick(1 / 60); return true; })()`, 600000);
    };
    const close = async (name, body, turn, far) => {
        await rig.eval(`(() => {
          const { S } = __M, V = BABYLON.Vector3, n = __M.npc('${body}'), { eyes, fwd } = __M.at(n);
          const d = fwd.applyRotationQuaternion(BABYLON.Quaternion.RotationAxis(V.Up(), ${turn} * Math.PI / 180)), cam = eyes.add(d.scale(${far}));
          S.player.spawn(cam.x, cam.z, { toward: eyes.asArray(), eye: Math.max(0.15, cam.y) });
          for (let i = 0; i < 3; i++) __M.tick(1 / 60);
          // (nothing in the player's hands over the picture: the first-person arms and what they hold hang off the camera)
          const c = S.scene.activeCamera;
          for (const m of S.scene.meshes) if ((c && m.isDescendantOf(c)) || m.renderingGroupId > 0) m.isVisible = false;
          S.scene.render();
          return true; })()`);
        await rig.shot(`${OUT}/${name}.png`);
        console.log('shot', name, JSON.stringify(await rig.eval(`(() => { const f = __M.npc('${body}').face; return { jaw: +f.jaw.toFixed(1), blink: +f.blink.toFixed(2), pupil: +f.state.pupil.toFixed(2), au: Object.fromEntries(Object.entries(f.au).filter(([, x]) => x > 0.01).map(([k, x]) => [k, +x.toFixed(2)])) }; })()`)));
    };
    const g = 'sexton';
    await tick(90);
    await close('face_rest', g, 0, 0.4);
    for (const kind of ['scream', 'yell', 'groan', 'cry', 'gasp', 'cough']) {
        await rig.eval(`__M.npc('${g}').say('${kind}', 1, true)`);
        // (caught where the take is loud, after the face has had a moment to come, as the port's check does)
        await tick(8);
        await rig.eval(`(() => { const f = __M.npc('${g}').face; for (let i = 0; i < 120 && f._loudness() <= 0.45; i++) __M.tick(1 / 60); return true; })()`);
        await close(`face_${kind}`, g, 0, 0.4);
        await tick(200);
    }
    await rig.eval(`__M.npc('${g}').vitals.pain = 0.8`);
    await tick(20);
    await close('face_pain', g, 0, 0.4);
    await rig.eval(`__M.npc('${g}').vitals.pain = 0`);
    await tick(300);
    await rig.eval(`(() => { const s = __M.npc('${g}').face.state; s.blinkT = 0; s.blinkLong = 1; return true; })()`);
    await tick(2);
    await close('face_blink', g, 0, 0.4);
    await rig.eval(`(() => { const f = __M.npc('${g}').face; f.gaze.target = 'player'; f.gaze.next = 5; return true; })()`);
    await close('face_look_side', g, 35, 0.7);
    await tick(30);
    await close('face_look_side', g, 35, 0.7);
    // A pellet in the young man's right eye.
    await rig.eval(`(() => {
      const { W, WE } = __M, n = __M.npc('buyer'), b = n.person.byName['eye.R'], at = n.worldOf(b.head, b).at, { fwd } = __M.at(n);
      const gun = WE.ARMS.find((a) => a.key === 'shotgun').gun;
      W.pierce(n, at.add(fwd.scale(0.5)).add(new BABYLON.Vector3(0, 0.004, 0)), fwd.scale(-1), { ...gun, name: 'pellet' }, 1);
      return true; })()`);
    await tick(90);
    await close('face_eye_pellet', 'buyer', 0, 0.4);
    await tick(60 * 20);
    await close('face_eye_pellet_later', 'buyer', 0, 0.4);
    await rig.eval(`(() => { const v = __M.npc('oldman').vitals; v.dead = true; v.brainDamage = 1; return true; })()`);
    await tick(30);
    await close('face_dying', 'oldman', 0, 0.5);
    await tick(60 * 30);
    await close('face_dead', 'oldman', 0, 0.5);
    await rig.eval(`(() => {
      const { W } = __M, n = __M.npc('hood'), { fwd } = __M.at(n), jaw = n.person.byName.jaw, chin = n.worldOf(jaw.tail, jaw).at;
      for (const speed of [25, 30, 35, 40]) {
        if (n.bones.jawHangs > 0) break;
        const skin = n.surface(chin.add(fwd.scale(0.3)), fwd.scale(-1), 0.6).find((h) => h.kind === 'skin');
        if (skin) W.blow(n, skin.point, fwd.scale(-1), 0.79, speed, 'bat');
      }
      const T = n.bones.teeth, front = T.teeth.filter((t) => t.front && t.name.includes("incisor")).map((t) => T._where(t));
      if (front.length) { const c = front.reduce((a, b) => a.add(b)).scale(1 / front.length); T.blow(c.add(fwd.scale(0.01)), fwd.scale(-1), 6000, 0.02, true); }
      console.log('hood: jaw hangs', n.bones.jawHangs, T.teeth.filter((t) => t.state !== "whole").map((t) => t.name + ' ' + t.state).join(', '));
      return true; })()`);
    await tick(60);
    await close('face_jaw_teeth', 'hood', 0, 0.45);
    await close('face_jaw_teeth_side', 'hood', 30, 0.45);
    console.log('errors', JSON.stringify(rig.errors?.().slice(0, 5)));
} finally {
    await rig.close();
}
