// The TS game's side of the Bevy port's `wounds` check (game/src/scenario.rs): the same shots and blows at the same
// places of each standing person (tools/port-wounds-shots.json, TS coordinates), on a room just reset (K) with Math.random
// replaced by jitter.mjs's LCG, seeded as the port's Dice is: 1000 + k for the line-up, 2000 + k for the shot. What would
// be drawn (marks, blood, the cut-away clothes) is stubbed, so that only medicine throws the dice; no physics is stepped,
// so the people stand as they were made, as the port's do. Then a minute of S.update, read at the port's times.
//   npx vite --port 8681 --host 127.0.0.1 &
//   CHROMIUM=... node tools/port-wounds.mjs [url] [out.json]
//   python3 tools/port-wounds-compare.py out.json <the port's wounds scenario>/log.json
import { open } from './rig.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8681/play.html?nowarm';
const out = process.argv[3] || 'ts-wounds.json';
const SHOTS = JSON.parse(readFileSync(new URL('./port-wounds-shots.json', import.meta.url)));
const TIMES = [0, 1, 2, 5, 10, 20, 30, 60];

const rig = await open('about:blank', { width: 640, height: 360 });
const errors = [];
rig.on?.('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
await rig.send('Page.navigate', { url });
await rig.until('!!window.__sandbox', 600000);
await rig.eval(`(async () => {
  const S = window.__sandbox; S.scene.getEngine().stopRenderLoop();
  document.getElementById('start')?.remove(); const o = document.getElementById('over'); if (o) o.style.display = 'none';
  const W = await import('/src/sandbox/wounds.ts'), WE = await import('/src/sandbox/weapons.ts'), D = await import('/src/sandbox/dressing.ts');
  let sim = 0; performance.now = () => sim * 1000;
  window.__M = { S, W, WE, D, tick: (dt) => { sim += dt; S.update(dt); } };
  window.__lcg = (seed) => { let s = seed; Math.random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); };
  return true; })()`);
const results = [];
for (const [k, shot] of SHOTS.entries()) {
    await rig.eval(`(() => { __lcg(${1000 + k}); __M.S.world.npcs.forEach((n) => (n.__old = true)); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' })); return true; })()`);
    await rig.until('__M.S.world.npcs.length === 4 && !__M.S.world.npcs.some((n) => n.__old)', 120000);
    const r = await rig.eval(`(() => {
      const { S, W, WE, D } = __M, V = BABYLON.Vector3, shot = ${JSON.stringify(shot)};
      const npc = S.world.npcs[shot.person], log = (window.__log = []);
      const no = (name) => () => { log.push(name); };
      for (const m of ['hole', 'entry', 'exit', 'stab', 'lip', 'cut']) npc.marks[m] = no('marks.' + m);
      npc.film.blot = no('film.blot'); npc.runs.start = no('runs.start'); npc.soak.add = no('soak.add');
      npc.spatter = no('spatter'); npc.welling = no('welling'); npc.viscera.bled = no('bled');
      npc.hit = () => log.push('hit'); npc.bones._draw = (br) => { br.tris = []; br.lines = []; log.push('draw'); };
      S.world.blood.spray = no('spray'); S.world.blood.stream = no('stream');
      for (const h of [npc.skinHider, ...npc.underHiders, ...npc.clothHiders]) { h.add = () => true; h.opens = () => {}; h.window = () => {}; }
      const say = npc.say.bind(npc); npc.say = (kind, gain, over) => { log.push('say ' + kind); say(kind, gain, over); };
      const arm = (key) => WE.ARMS.find((a) => a.key === key);
      const bone = npc.person.byName[shot.bone];
      const target = npc.worldOf(bone.head, bone).at.add(V.FromArray(shot.offset)), dir = V.FromArray(shot.dir).normalize();
      __lcg(${2000 + k});
      const res = [];
      if (shot.weapon === 'bat') {
        const skin = npc.surface(target.subtract(dir.scale(0.5)), dir, 1.0).find((h) => h.kind === 'skin');
        if (skin) W.blow(npc, skin.point, dir, arm('bat').mass, arm('bat').speed); else res.push('missed');
      } else if (shot.weapon === 'knife') {
        const p = W.pierce(npc, target.subtract(dir.scale(0.5)), dir, { ...arm('knife').stab, across: V.FromArray(shot.across) }, 0.5 + arm('knife').stab.reach);
        res.push({ stopped: p.stopped, energy: p.energy });
      } else {
        const gun = arm(shot.weapon).gun;
        for (const off of shot.pellets ?? [[0, 0, 0]]) {
          const p = W.pierce(npc, target.add(V.FromArray(off)).subtract(dir.scale(1.5)), dir, { ...gun }, 3);
          res.push({ stopped: p.stopped, energy: +p.energy.toFixed(1), hit: p.hit });
        }
      }
      // The medkit: the worst open wound dressed, then the next, until none is left open.
      if (shot.dress) for (let n = 0, w; (w = D.wounds(npc)[0]) && n < 12; n++) { const d = D.dress(w); res.push(d ? d.kind + ' ' + +d.capacity.toFixed(2) : 'none'); if (!d) break; }
      return { clocks: S.world.npcs.map((n) => n.clock), target: target.asArray(), res };
    })()`);
    const series = [];
    let t = 0;
    for (const at of TIMES) {
        const n = Math.round((at - t) * 60);
        const snap = await rig.eval(`(() => {
          for (let i = 0; i < ${n}; i++) __M.tick(1 / 60);
          const npc = __M.S.world.npcs[${shot.person}], v = npc.vitals, th = npc.throat, log = window.__log.splice(0);
          return { t: ${at}, state: v.state, hr: +v.hr.toFixed(1), map: +v.map.toFixed(1), spo2: +v.spo2.toFixed(1), rr: +v.rr.toFixed(1), lost: +(v.full - v.volume).toFixed(4),
            conscious: +v.conscious.toFixed(3), pain: +v.pain.toFixed(3), breathing: v.breathing, rhythm: v.rhythm, dead: v.dead, pump: +v.pump.toFixed(3),
            lungs: [+v.lungs.L.toFixed(3), +v.lungs.R.toFixed(3)], airway: +v.airway.toFixed(3), flooded: [+v.flooded.L.toFixed(3), +v.flooded.R.toFixed(3)], choked: +v.choked.toFixed(3),
            throat: { mouth: +th.mouth.toFixed(2), lungs: [+th.lungs.L.toFixed(2), +th.lungs.R.toFixed(2)], stomach: +th.stomach.toFixed(2) },
            legGone: npc.legGone, paralysed: v.paralysed, out: +v.out.toFixed(2),
            injuries: v.injuries.map((i) => [i.text, +i.severity.toFixed(3)]),
            bleeds: v.bleeds.map((b) => [b.name, +(b.rate * 1000).toFixed(5), b.arterial, b.internal, b.into ?? null, b.side ?? null, +(b.lost * 1000).toFixed(2), b.dressed ?? null]),
            breaks: npc.bones.breaks.map((b) => [b.text, b.type, +b.ratio.toFixed(3)]),
            log };
        })()`);
        series.push(snap);
        t = at;
    }
    results.push({ shot, ...r, series });
    console.log(shot.name, JSON.stringify(series[0].injuries));
}
writeFileSync(out, JSON.stringify({ results, errors }, null, 1));
console.log('errors', errors.slice(0, 5));
await rig.close();
