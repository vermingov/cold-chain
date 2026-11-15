// Reads a session log the F2 profiler saved (F4, profiler.ts) and prints what to look at first: the machine, the fps
// spread and what bounds the frame, the systems that cost most, the worst spikes with what came just before each, and
// how the frame went over the session, minute by minute.
//
//     node tools/profile-report.mjs coldchain-profile-0.8.23-2026-11-15-143200.json

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: node tools/profile-report.mjs <coldchain-profile-*.json>'); process.exit(1); }
const log = JSON.parse(readFileSync(path, 'utf8'));
const { summary: s, machine: m } = log;
const out = [];
const say = (line = '') => out.push(line);

say(`Cold Chain ${log.version}, recorded ${log.started}: ${Math.floor(s.recorded.seconds / 60)} min ${s.recorded.seconds % 60} s, ${s.recorded.frames} frames`);
if (m) {
    say(`GPU ${m.gpu} (${m.vendor}), ${m.api}`);
    say(`screen ${m.screen}, canvas ${m.canvas}, pixel ratio ${m.pixelRatio}, ${m.cores} cores`);
    say(m.browser);
}
say();
say(`fps ${s.fps.mean} on average; frame ms p50 p95 p99: ${s.fps['frame ms p50 p95 p99']}`);
say(`share of time: ${Object.entries(s.fps['share of time']).map(([band, share]) => `${band} ${share}`).join(', ')}`);
say(`bound: ${s.bound}`);
say(`render scale: ${Object.entries(s['seconds at render scale %']).map(([k, v]) => `${k}% ${v} s`).join(', ')};`
    + ` preset: ${Object.entries(s['seconds at preset']).map(([k, v]) => `${k} ${v} s`).join(', ')}`);
say();
say(`${'worst systems (own time)'.padEnd(46)} ${'ms/frame'.padStart(8)} ${'worst'.padStart(7)} ${'share'.padStart(6)}`);
for (const r of s['worst systems']) say(`${r.name.padEnd(46).slice(0, 46)} ${r['ms a frame'].toFixed(2).padStart(8)} ${r.worst.toFixed(1).padStart(7)} ${r.share.padStart(6)}`);
say();
say(`worst spikes (of ${log.spikes.length} kept)`);
for (const k of s['worst spikes']) {
    const clock = `${Math.floor(k.t / 60)}:${(k.t % 60).toFixed(1).padStart(4, '0')}`;
    say(`  at ${clock}: ${k.ms} ms (game code ${k.cpu}, waiting ${k.waiting}), ${k.draws} draw calls${k.compiles ? `, ${k.compiles} shaders compiled` : ''}`);
    say(`    heaviest: ${k.top.join('; ') || 'none of the timed rows'}`);
    say(`    the second before: ${k.before.join('; ') || 'nothing the player did'}`);
}
say();
// The frame over the session, a line a minute: where it slowed and with how many people and draw calls.
say('minute  fps  ms mean  p95  worst  people  draws  scale  preset  heaviest system');
const minutes = new Map();
for (const x of log.samples) {
    const k = Math.floor(x.t / 60);
    if (!minutes.has(k)) minutes.set(k, []);
    minutes.get(k).push(x);
}
for (const [k, list] of minutes) {
    const frames = list.reduce((a, x) => a + x.frames, 0), mean = list.reduce((a, x) => a + x.ms[0] * x.frames, 0) / frames;
    const own = new Map();
    for (const x of list) for (const [name, [ms]] of Object.entries(x.systems)) own.set(name, (own.get(name) ?? 0) + ms * x.frames);
    const [heavy, heavyMs] = [...own].filter(([name]) => !name.startsWith('waiting')).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const last = list[list.length - 1];
    say(`${String(k).padStart(6)} ${String(Math.round(1000 / mean)).padStart(4)} ${mean.toFixed(1).padStart(8)} ${Math.max(...list.map((x) => x.ms[1])).toFixed(0).padStart(4)}`
        + ` ${Math.max(...list.map((x) => x.ms[2])).toFixed(0).padStart(6)} ${String(last.people).padStart(7)} ${String(Math.max(...list.map((x) => x.draws))).padStart(6)}`
        + ` ${String(last.scale).padStart(5)}% ${String(last.preset).padStart(7)}  ${heavy} ${(heavyMs / frames).toFixed(2)} ms`);
}
console.log(out.join('\n'));
