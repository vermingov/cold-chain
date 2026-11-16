// The TS game's side of the Bevy port's `face` check (game/src/face.rs `scenario`): the same faces in the same order,
// close up, as the game plays them (its own clock: each wait is the face's own seconds, not frames).
//   npx vite --port 8686 --host 127.0.0.1 &
//   CHROMIUM=/opt/pw-browsers/chromium... node tools/port-face.mjs <out dir> [url]
import { open } from './rig.mjs';

const OUT = process.argv[2];
const url = process.argv[3] || 'http://127.0.0.1:8686/play.html?nowarm';
const rig = await open(url, { width: 1280, height: 720 });
try {
    await rig.until('window.__sandbox && window.__sandbox.world.npcs.length === 4', 900000);
    await rig.eval('document.getElementById("start")?.remove(); const o = document.getElementById("over"); if (o) o.style.display = "none"; true');
    await rig.eval(`(() => {
      const S = window.__sandbox, V = BABYLON.Vector3;
      window.__F = {
        npc: (body) => S.world.npcs.find((n) => n.voice === body),
        // The middle of the eyes and the way the face looks, now.
        at: (n) => { const b = n.person.byName, a = n.worldOf(b['eye.L'].head, b['eye.L']).at, c = n.worldOf(b['eye.R'].head, b['eye.R']).at;
          return { eyes: a.add(c).scale(0.5), fwd: n.ragdoll.byName.get('head').node.getDirection(V.Forward()) }; },
        close: (body, turn, far) => { const n = __F.npc(body), { eyes, fwd } = __F.at(n);
          const d = fwd.applyRotationQuaternion(BABYLON.Quaternion.RotationAxis(V.Up(), turn * Math.PI / 180)), cam = eyes.add(d.scale(far));
          S.player.spawn(cam.x, cam.z, { toward: eyes.asArray(), eye: Math.max(0.15, cam.y) }); S.player.update(0); return true; },
      };
      return true; })()`);
    const clock = (body) => rig.eval(`__F.npc('${body}').face.clock`);
    const wait = async (body, s) => { const c = await clock(body); await rig.until(`__F.npc('${body}').face.clock > ${c + s}`, 900000); };
    const close = async (name, body, turn, far) => {
        await rig.eval(`__F.close('${body}', ${turn}, ${far})`);
        const f = await rig.eval('__sandbox.world.frame');
        await rig.until(`__sandbox.world.frame > ${f + 2}`, 600000);
        await rig.shot(`${OUT}/${name}.png`);
        console.log('shot', name, JSON.stringify(await rig.eval(`(() => { const f = __F.npc('${body}').face; return { jaw: +f.jaw.toFixed(1), blink: +f.blink.toFixed(2), pupil: +f.state.pupil.toFixed(2) }; })()`)));
    };
    const g = 'sexton';
    await wait(g, 1.5);
    await close('face_rest', g, 0, 0.55);
    for (const kind of ['scream', 'yell', 'groan', 'cry', 'gasp', 'cough']) {
        await rig.eval(`__F.npc('${g}').say('${kind}', 1, true)`);
        // (caught where the take is loud, after the face has had a moment to come, as the port's check does)
        await wait(g, 8 / 60);
        const c = await clock(g);
        await rig.until(`__F.npc('${g}').face._loudness() > 0.45 || __F.npc('${g}').face.clock > ${c + 2}`, 900000);
        await close(`face_${kind}`, g, 0, 0.55);
        await wait(g, 200 / 60);
    }
    await rig.eval(`__F.npc('${g}').vitals.pain = 0.8`);
    await wait(g, 20 / 60);
    await close('face_pain', g, 0, 0.55);
    await rig.eval(`__F.npc('${g}').vitals.pain = 0`);
    await wait(g, 5);
    await rig.eval(`(() => { const s = __F.npc('${g}').face.state; s.blinkT = 0; s.blinkLong = 1; return true; })()`);
    await wait(g, 2 / 60);
    await close('face_blink', g, 0, 0.55);
    await rig.eval(`(() => { const f = __F.npc('${g}').face; f.gaze.target = 'player'; f.gaze.next = 5; return true; })()`);
    await close('face_look_side', g, 35, 0.7);
    await wait(g, 0.5);
    await close('face_look_side', g, 35, 0.7);
    // A pellet in the young man's right eye.
    await rig.eval(`(async () => {
      const W = await import('/src/sandbox/wounds.ts'), WE = await import('/src/sandbox/weapons.ts');
      const n = __F.npc('buyer'), b = n.person.byName['eye.R'], at = n.worldOf(b.head, b).at, { fwd } = __F.at(n);
      const gun = WE.ARMS.find((a) => a.key === 'shotgun').gun;
      W.pierce(n, at.add(fwd.scale(0.5)).add(new BABYLON.Vector3(0, 0.004, 0)), fwd.scale(-1), { ...gun, name: 'pellet' }, 1);
      return true; })()`);
    await wait('buyer', 1.5);
    await close('face_eye_pellet', 'buyer', 0, 0.4);
    await wait('buyer', 20);
    await close('face_eye_pellet_later', 'buyer', 0, 0.4);
    await rig.eval(`(() => { const v = __F.npc('oldman').vitals; v.dead = true; v.brainDamage = 1; return true; })()`);
    await wait('oldman', 0.5);
    await close('face_dying', 'oldman', 0, 0.5);
    await wait('oldman', 30);
    await close('face_dead', 'oldman', 0, 0.5);
    await rig.eval(`(async () => {
      const W = await import('/src/sandbox/wounds.ts');
      const n = __F.npc('hood'), { fwd } = __F.at(n), jaw = n.person.byName.jaw, chin = n.worldOf(jaw.tail, jaw).at;
      const skin = n.surface(chin.add(fwd.scale(0.3)), fwd.scale(-1), 0.6).find((h) => h.kind === 'skin');
      for (const speed of [25, 30, 35, 40]) { if (n.bones.jawHangs > 0) break; if (skin) W.blow(n, skin.point, fwd.scale(-1), 0.79, speed, 'bat'); }
      const front = n.teeth.teeth.filter((t) => t.front && t.name.includes('incisor')).map((t) => n.teeth._where(t));
      if (front.length) { const c = front.reduce((a, b) => a.add(b)).scale(1 / front.length); n.teeth.blow(c.add(fwd.scale(0.01)), fwd.scale(-1), 6000, 0.02, true); }
      return true; })()`);
    await wait('hood', 1);
    await close('face_jaw_teeth', 'hood', 0, 0.45);
    await close('face_jaw_teeth_side', 'hood', 30, 0.45);
    console.log('errors', JSON.stringify(rig.errors().slice(0, 5)));
} finally {
    await rig.close();
}
