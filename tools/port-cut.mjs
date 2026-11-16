// The TS game's side of the Bevy port's `cut` scenario (game/src/cut_scenario.rs): the same cuts, charges, blows and
// views, by the same calls (dismember.ts chop and blast, wounds.ts pierce and blow, viscera.ts slashed, bones.ts
// _through), each picture lit by the same lamp by the eye.
//   npx vite --port 8685 --host 127.0.0.1 &
//   CHROMIUM=/opt/pw-browsers/chromium... node tools/port-cut.mjs <dir> [limbs,belly,bones] [url]
import { open } from './rig.mjs';

const OUT = process.argv[2];
const part = process.argv[3] || 'all';
const url = process.argv[4] || 'http://127.0.0.1:8685/play.html?nowarm';
const rig = await open(url, { width: 1280, height: 720 });
const frame = () => rig.eval('window.__sandbox.world.frame');
const frames = async (n) => { const f0 = await frame(); await rig.until(`window.__sandbox.world.frame >= ${f0 + n}`, 900000); };
const shot = async (name) => { await frames(4); await rig.shot(`${OUT}/${name}.png`); console.log('shot', name); };
const all = part === 'all';
const want = (p) => all || part.split(',').includes(p);
try {
    // (Booting on a busy machine takes minutes: said every 30 s, so a stall shows.)
    for (let k = 0; !(await rig.eval('!!(window.__sandbox && window.__sandbox.world.npcs.length === 4)')); k++) {
        if (k % 30 === 0) console.log('booting', await rig.eval('JSON.stringify({ s: !!window.__sandbox, n: window.__sandbox?.world?.npcs?.length, f: window.__sandbox?.world?.frame, ready: document.readyState })'));
        if (k > 1200) throw new Error('never booted');
        await rig.wait(1000);
    }
    await rig.eval('document.getElementById("start")?.remove()');
    console.log('booted', await frame());
    await rig.until('window.__sandbox.world.frame > 90', 900000);
    await rig.eval(`(async () => {
      const S = window.__sandbox, V = BABYLON.Vector3;
      const D = await import('/src/sandbox/dismember.ts'), W = await import('/src/sandbox/wounds.ts'), VI = await import('/src/sandbox/viscera.ts');
      const lamp = new BABYLON.PointLight('cut_lamp', new V(0, -50, 0), S.scene);
      lamp.intensity = 2.5; lamp.range = 3; lamp.diffuse = new BABYLON.Color3(1, 1, 1);
      const between = (npc, a, b, t) => { const A = npc.person.byName[a], B = npc.person.byName[b]; return npc.worldOf(V.Lerp(A.head, B.head, t), A).at; };
      // The eye at 'from' looking at 'at', the lamp by it.
      const look = (at, from) => { const g = S.world.ground?.(from.x, from.z, Infinity) ?? 0; S.player.spawn(from.x, from.z, { toward: [at.x, at.y, at.z], eye: from.y - g });
        lamp.position.copyFrom(from.add(new V(0, 0.1, 0))); };
      // A cut's end, the stump's or the piece's, and its facing.
      const end = (npc, k, piece) => { const c = npc.dismember.cuts[k]; if (!c) return null;
        return piece ? npc.worldOf(c.c, c.tip, c.n.scale(-1)) : npc.worldOf(c.c, c.prox, c.n); };
      const facing = (npc, k, piece, d) => { const e = end(npc, k, piece); if (!e) return; const off = e.normal.add(new V(0, 0.25, 0)).normalize().scale(d);
        const g = S.world.ground?.(e.at.x + off.x, e.at.z + off.z, Infinity) ?? 0; if (e.at.y + off.y < g + 0.12) off.y = g + 0.12 - e.at.y;
        look(e.at, e.at.add(off)); };
      window.__C = { S, V, D, W, VI, between, look, end, facing, lamp };
      return true; })()`);
    // (By body, in the line-up's order: world.npcs is not in it.)
    const BODIES = ['oldman', 'sexton', 'buyer', 'hood'];
    const npc = (i) => `__C.S.world.npcs.find((n) => n.person.bodyName === '${BODIES[i]}')`;
    if (want('limbs')) {
        console.log('forearm', await rig.eval(`(() => { const { D, V, between } = __C, n = ${npc(0)};
          const t = performance.now(); const off = D.chop(n, between(n, 'lowerarm01.R', 'wrist.R', 0.55), new V(-1, -0.3, 0).normalize(), 90); return [off, performance.now() - t]; })()`));
        await frames(2);
        await rig.eval(`__C.facing(${npc(0)}, 0, false, 0.32)`); await shot('forearm_stump');
        await rig.eval(`__C.facing(${npc(0)}, 0, true, 0.32)`); await shot('forearm_piece_fresh');
        await frames(150);
        await rig.eval(`__C.facing(${npc(0)}, 0, true, 0.35)`); await shot('forearm_piece');
        await rig.eval(`(() => { const e = __C.end(${npc(0)}, 0, false); __C.look(e.at, e.at.add(new __C.V(0.4, 0.3, -1.2))); })()`); await shot('forearm_wide');
        console.log('thigh', await rig.eval(`(() => { const { D, V, between } = __C, n = ${npc(1)}, p = between(n, 'upperleg01.L', 'lowerleg01.L', 0.5);
          const t = performance.now(); let off = false; for (let k = 0; k < 3; k++) off = D.chop(n, p, new V(1, -0.2, 0).normalize(), 120) || off; return [off, performance.now() - t]; })()`));
        await frames(2);
        await rig.eval(`__C.facing(${npc(1)}, 0, false, 0.4)`); await shot('thigh_stump_fresh');
        await frames(180);
        await rig.eval(`__C.facing(${npc(1)}, 0, false, 0.45)`); await shot('thigh_stump');
        await rig.eval(`__C.facing(${npc(1)}, 0, true, 0.45)`); await shot('thigh_piece');
        console.log('neck', await rig.eval(`(() => { const { D, V, between } = __C, n = ${npc(2)}, p = between(n, 'neck01', 'head', 0.3);
          const t = performance.now(); let off = false; for (let k = 0; k < 2; k++) off = D.chop(n, p, new V(-1, 0, 0.2).normalize(), 90) || off; return [off, performance.now() - t]; })()`));
        await frames(2);
        await rig.eval(`__C.facing(${npc(2)}, 0, false, 0.35)`); await shot('neck_stump_fresh');
        await rig.eval(`__C.facing(${npc(2)}, 0, true, 0.35)`); await shot('head_fresh');
        await frames(180);
        await rig.eval(`__C.facing(${npc(2)}, 0, false, 0.4)`); await shot('neck_stump');
        await rig.eval(`__C.facing(${npc(2)}, 0, true, 0.4)`); await shot('head');
    }
    if (want('belly')) {
        console.log('charge', await rig.eval(`(() => { const { W, V, between } = __C, n = ${npc(3)}, p = between(n, 'spine03', 'spine03', 0).add(new V(0.03, -0.02, 0)), dir = new V(0, 0, 1);
          const t = performance.now(); const r = W.pierce(n, p.subtract(dir.scale(0.6)), dir, { name: 'charge', energy: 170 * 9 * 0.95, mass: 0.0035 * 9, speed: 400, calibre: 0.022, channel: 0.024, soft: 42, hard: 120 }, 1.2);
          return [r.energy, performance.now() - t, n.viscera.openings.length]; })()`));
        await frames(3);
        const opening = (i, k, off) => rig.eval(`(() => { const n = ${npc(i)}, o = n.viscera.openings[${k} < 0 ? n.viscera.openings.length - 1 : ${k}]; if (!o) return false;
          const w = n.worldOf(o.at, o.owner, o.normal), V = __C.V; const off = ${off}; __C.look(w.at, w.at.add(off)); return true; })()`);
        await opening(3, 0, 'new V(0.05, 0.12, -0.38)'); await shot('belly_blown_fresh');
        await frames(240);
        await opening(3, 0, 'w.normal.scale(0.4).add(new V(0, 0.15, 0)).normalize().scale(0.42)'); await shot('belly_blown');
        console.log('slash', await rig.eval(`(() => { const { VI, V, between } = __C, n = ${npc(0)}, c = between(n, 'spine03', 'spine03', 0), dir = new V(0, 0, 1);
          const hits = []; for (let k = 0; k < 9; k++) { const from = c.add(new V((k - 4) * 0.022, -0.01 + 0.002 * k, 0)).subtract(dir.scale(0.5));
            const h = n.surface(from, dir, 1).find((x) => x.kind === 'skin'); if (h) hits.push(h); }
          const t = performance.now(); const o = VI.slashed(n, hits, 0.04); return [hits.length, !!o, performance.now() - t]; })()`));
        await frames(3);
        await opening(0, -1, 'w.normal.add(new V(0, 0.3, 0)).normalize().scale(0.4)'); await shot('belly_slit_fresh');
        await frames(300);
        await opening(0, -1, 'w.normal.scale(0.5).add(new V(0, 0.6, 0)).normalize().scale(0.5)'); await shot('belly_slit');
    }
    if (want('bones')) {
        console.log('shin', await rig.eval(`(() => { const { W, V, between } = __C, n = ${npc(3)}, p = between(n, 'lowerleg01.L', 'foot.L', 0.5), dir = new V(0, 0, 1);
          const skin = n.surface(p.subtract(dir.scale(0.4)), dir, 0.6).find((h) => h.kind === 'skin');
          if (skin) { W.blow(n, skin.point, dir, 0.79, 15.5); W.blow(n, skin.point, dir, 0.79, 18); }
          for (const br of n.bones.breaks) if (br.seg && !br.through && br.key !== 'fibula') n.bones._through(br);
          return n.bones.breaks.map((b) => b.part + ' ' + b.type + (b.through ? ' through' : '')); })()`));
        await frames(3);
        await rig.eval(`(() => { const n = ${npc(3)}, at = __C.between(n, 'lowerleg01.L', 'foot.L', 0.5); __C.look(at, at.add(new __C.V(0.25, 0.15, -0.3))); })()`); await shot('shin_open');
        console.log('skull', await rig.eval(`(() => { const { W, V, between } = __C, n = ${npc(1)}, p = between(n, 'head', 'head', 0).add(new V(0, 0.08, 0)), dir = new V(0, -0.3, 1).normalize();
          const skin = n.surface(p.subtract(dir.scale(0.4)), dir, 0.6).find((h) => h.kind === 'skin'); if (skin) W.blow(n, skin.point, dir, 1.2, 20, 'hammer');
          return n.bones.breaks.map((b) => b.part + ' ' + b.type); })()`));
        await frames(30);
        await rig.key('KeyX'); await rig.key('KeyX', false);
        await frames(2);
        await rig.eval(`(() => { const n = ${npc(3)}, at = __C.between(n, 'lowerleg01.L', 'foot.L', 0.5); __C.look(at, at.add(new __C.V(0.3, 0.1, -0.35))); })()`); await shot('xray_shin');
        await rig.eval(`(() => { const n = ${npc(1)}, at = n.ragdoll.byName.get('head').node.position.add(new __C.V(0, 0.08, 0)); __C.look(at, at.add(new __C.V(0, 0.35, -0.25))); })()`); await shot('xray_skull');
        await rig.eval(`(() => { __C.lamp.position.y = -50; __C.S.player.spawn(0, -1.5, { toward: [0, 0.6, 2.2], eye: 1.65 }); })()`); await shot('xray_all');
        await rig.key('KeyX'); await rig.key('KeyX', false);
    }
    if (want('limbs')) {
        console.log('blast', await rig.eval(`(() => { const n = ${npc(2)}, at = n.ragdoll.byName.get('footL').node.position.add(new __C.V(0.2, 0, 0));
          const t = performance.now(); const gone = __C.D.blast(n, at, 0.25); return [gone, performance.now() - t]; })()`));
        await frames(60);
        await rig.eval(`(() => { __C.lamp.position.y = -50; __C.S.player.spawn(0, -1, { toward: [0, 0.3, 2.2], eye: 1.65 }); })()`); await shot('after');
    }
    console.log('errors', JSON.stringify(rig.errors().slice(0, 5)));
} finally {
    await rig.close();
}
