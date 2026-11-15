// F2: where each frame's time goes. Opening it puts a timed wrapper over every method the game calls each frame (on
// the classes' prototypes, so people made while it is open are timed too, and on the few live objects that hold their
// own); closing it puts the originals back, so shut it costs nothing. Shift+F2 copies the table as text.
//
// Each row is a method's own time, without the timed methods it calls (a person's bleeding without their soak, the
// physics step without Havok's world step), so the rows add up to the frame and can be ranked against each other.
// Per frame: the average over about a second, the worst frame in the last five (marked when it stands well above the
// average: a spike), and the share of the whole frame, the wait for the GPU and the screen included. Babylon's own
// counters for the drawing (SceneInstrumentation, and the GPU's time from EngineInstrumentation where the browser
// gives a timer query) are under it: they overlap each other and the rows above, so they are not in the ranking.
// Last, the draw calls a frame by what made them (each mesh or particle system by name, in the main picture and in the
// shadow maps apart): a jump in draw calls names its cause.
//
// While it is open it also keeps a log of the session, for a player to send in (F4 saves it as a .json file; the site
// has no server to send it to): a sample a second (the frame's mean, 95th percentile and worst, each row's mean and
// worst, the GPU's time, draw calls, people, render scale and preset), every spike frame with the rows heaviest in that
// very frame, and what the player did (world.note: a shot, a hurt, a person spawned, K, X, a preset or render scale
// changed), so a spike can be put down to what came just before it. A summary is worked out on saving and written at
// the top. All of it is kept from the first opening to the page's end, through closing and opening again, but only
// recorded while open; the samples are the last half hour's, the spikes the 300 worst. Nothing is saved on its own when
// the page closes: a download started from pagehide or beforeunload is not reliably let through.

import * as BABYLON from '@babylonjs/core';
import { Player } from '../player.ts';
import { Sound } from '../sound.ts';
import { Npc } from './npc.ts';
import { Vitals } from './vitals.ts';
import { Behaviour } from './behaviour.ts';
import { Ragdoll } from './ragdoll.ts';
import { Dismember } from './dismember.ts';
import { Face } from './face.ts';
import { Bruise } from './bruise.ts';
import { Film } from './film.ts';
import { Soak } from './soak.ts';
import { Runs } from './runs.ts';
import { Viscera } from './viscera.ts';
import { Bones } from './bones.ts';
import { Marks } from './marks.ts';
import { Medic } from './dressing.ts';
import { Weapons } from './weapons.ts';
import { Blood } from './blood.ts';
import { Floor } from './floor.ts';
import { Thuds } from './thuds.ts';
import { Hud } from './hud.ts';

type Row = { name: string; self: number; all: number; calls: number; avg: number; allAvg: number; per: number; worst: number[]; sum: number; max: number };

export function profiler(layer: HTMLElement, sandbox) {
    const { scene, world } = sandbox;
    const engine = scene.getEngine();
    const physics = scene.getPhysicsEngine();
    const plugin = physics.getPhysicsPlugin();
    const el = document.createElement('div');
    el.className = 'profiler gone';
    layer.appendChild(el);

    const rows = new Map<string, Row>(), counters = new Map<string, Row>(), draws = new Map<string, Row>(), seen = new Set<string>();
    const rowOf = (map: Map<string, Row>, name: string) => {
        if (!map.has(name)) map.set(name, { name, self: 0, all: 0, calls: 0, avg: 0, allAvg: 0, per: 0, worst: [0, 0, 0, 0, 0], sum: 0, max: 0 });
        return map.get(name);
    };
    const undo: (() => void)[] = [];
    let inner = 0;      // the time spent so far in timed calls under the one running now
    let depth = 0, ran = 0;     // ran: the time in timed calls since the last frame ended, whatever called them

    const time = (o, k: string, name: string) => {
        const was = o?.[k];
        if (typeof was !== 'function' || was.timed) return;
        const own = Object.hasOwn(o, k), row = rowOf(rows, name);
        const timed = function (...args) {
            const t0 = performance.now(), outer = inner;
            inner = 0;
            depth++;
            try {
                return was.apply(this, args);
            } finally {
                const t = performance.now() - t0;
                row.self += t - inner;
                row.all += t;
                row.calls++;
                inner = outer + t;
                if (--depth === 0) ran += t;
            }
        };
        timed.timed = true;
        o[k] = timed;
        // (Left alone if something else has put its own over it since.)
        undo.push(() => { if (o[k] === timed) { if (own) o[k] = was; else delete o[k]; } });
    };

    // The organ loops and the dressings are of classes their modules keep to themselves: timed from the first one seen.
    const late = () => {
        for (const npc of world.npcs) {
            const loop = npc.viscera?.loops?.[0], dressing = npc.dressings?.[0];
            if (loop) { time(Object.getPrototypeOf(loop), 'step', 'person: organs out, step'); time(Object.getPrototypeOf(loop), 'draw', 'person: organs out, draw'); }
            if (dressing) time(Object.getPrototypeOf(dressing), 'update', 'person: dressings');
        }
    };

    const wrap = () => {
        // The game's update (sandbox.ts) and what it calls.
        time(sandbox, 'update', 'game update: rest (who is looked at)');
        time(Player.prototype, 'update', 'player');
        time(Weapons.prototype, 'update', 'weapons');
        time(Weapons.prototype, '_press', 'weapons: a click (first shot, swing)');      // from the pointer event, outside the frame
        time(Medic.prototype, 'update', 'bandage, medkit');
        time(Npc.prototype, 'update', 'person: rest of update');
        time(Vitals.prototype, 'update', 'person: vitals');
        time(Behaviour.prototype, 'update', 'person: behaviour');
        time(Ragdoll.prototype, 'drive', 'person: ragdoll drive (skeleton)');
        time(Dismember.prototype, 'update', 'person: dismember');
        time(Dismember.prototype, '_place', 'person: dismember, pieces placed');
        time(Face.prototype, 'update', 'person: face');
        time(Bruise.prototype, 'update', 'person: bruise');
        time(Npc.prototype, '_bleed', 'person: bleed');
        time(Film.prototype, 'update', 'person: film (blood on skin)');
        time(Film.prototype, '_draw', 'person: film, drawing streaks');
        time(Film.prototype, '_dry', 'person: film, drying');
        time(Film.prototype, '_send', 'person: film, to GPU');
        time(Soak.prototype, 'update', 'person: soak (blood in clothes)');
        time(Npc.prototype, '_speak', 'person: voice');
        time(Runs.prototype, 'update', 'person: runs (blood down skin)');
        time(Viscera.prototype, 'update', 'person: viscera');
        time(Bones.prototype, 'update', 'person: bones (after physics)');
        time(Marks.prototype, 'age', 'person: marks ageing');
        time(BABYLON.DynamicTexture.prototype, 'update', 'painted textures to GPU (marks, film...)');
        time(Blood.prototype, 'update', 'blood: rest (stains to GPU)');
        time(Blood.prototype, '_fly', 'blood: drops');
        time(Blood.prototype, '_streams', 'blood: streams');
        time(Blood.prototype, '_wallRuns', 'blood: runs down walls');
        time(Blood.prototype, '_lying', 'blood: pools under people');
        time(Blood.prototype, '_feet', 'blood: footprints');
        time(Blood.prototype, '_dry', 'blood: drying');
        time(Floor.prototype, 'update', 'floor blood: rest');
        time(Floor.prototype, '_flow', 'floor blood: flow');
        time(Floor.prototype, '_settle', 'floor blood: settle');
        time(Floor.prototype, '_send', 'floor blood: to GPU');
        time(Sound.prototype, 'update', 'sound');
        time(Sound.prototype, 'listen', 'sound');
        time(Thuds.prototype, '_drag', 'thuds');
        time(Thuds.prototype, '_met', 'thuds');
        time(Hud.prototype, 'update', 'HUD');
        // Physics: the sub-steps sandbox.ts runs, each the people's pushes, Babylon's bodies to and from Havok, Havok.
        time(physics, '_step', 'physics: sub-step loop');
        time(Behaviour.prototype, 'beforeStep', 'physics: people push (before each step)');
        time(plugin, 'executeStep', 'physics: Babylon pre-step + sync');
        time(plugin._hknp, 'HP_World_Step', 'physics: Havok world step');
        time(scene.onAfterPhysicsObservable, 'notifyObservers', 'physics: after-step observers');
        // Drawing: what is left of the scene's render once the above are out of it.
        time(scene, 'render', 'render: Babylon CPU (cull, shadows, draws)');
        time(scene.onBeforeRenderObservable, 'notifyObservers', 'render: before-render observers (culling)');
        late();
        // Draw calls by source: each one the engine reports is put to the mesh or particle system drawing just then, and
        // to the pass it is in (a shadow map, another render target, else the main picture). Names have their numbers
        // taken out, so four people's insides are one row.
        let source = 'other (post-processes, layers)', pass = 'main';
        const swap = (o, k: string, make: (was) => any) => {
            const was = o[k], own = Object.hasOwn(o, k), put = make(was);
            o[k] = put;
            undo.push(() => { if (o[k] === put) { if (own) o[k] = was; else delete o[k]; } });
        };
        const as = (o, k: string, set: (self) => void) => swap(o, k, (was) => function (...args) {
            const s = source, p = pass;
            set(this);
            try { return was.apply(this, args); } finally { source = s; pass = p; }
        });
        as(BABYLON.Mesh.prototype, '_processRendering', (m) => { source = m.name; });
        as(BABYLON.ParticleSystem.prototype, 'render', (p) => { source = 'particles ' + p.name; });
        as(BABYLON.RenderTargetTexture.prototype, 'render', (t) => { pass = t.name.endsWith('_shadowMap') ? 'shadow' : t.name; });
        swap(engine, '_reportDrawCall', (was) => function (n = 1) {
            was.call(this, n);
            const key = `${pass}: ${source}`, row = rowOf(draws, `${pass}: ${source.replace(/\d+/g, '#')}`);
            row.self += n;
            if (!seen.has(key)) { seen.add(key); row.calls++; }      // how many meshes of that name drew
        });
    };

    let sceneInst: BABYLON.SceneInstrumentation | null = null, engineInst: BABYLON.EngineInstrumentation | null = null;
    let frame = null, last = 0, gap = 16.7, slot = 0, drawn = 0, shown = '', text = '', said = '', compiles = 0, compiled = 0;
    let update: Row, render: Row;
    const IDLE = 'waiting (GPU, screen, browser)';

    // The session's log (F4). Its times are seconds from the first opening.
    const log = { version: __VERSION__, started: '', machine: null, samples: [], spikes: [], events: [] as [number, string][] };
    const totals = new Map<string, { ms: number; worst: number }>();     // each row's own time over the whole session
    const hist = new Uint32Array(501);          // every frame recorded, by its length to the millisecond (500: longer)
    const times = new Float64Array(1024);       // this second's frames, for its 95th percentile
    let t0 = 0, recording = false, secondAt = 0, n = 0, nt = 0, spent = 0, cpu = 0, wait = 0, waitMax = 0, calls = 0, made = 0;
    let allFrames = 0, allMs = 0, preset = '', level = 1;
    const since = (now: number) => Math.round(now - t0) / 1000;
    const r2 = (x: number) => Math.round(x * 100) / 100;

    // What the player did, from where it is done (sandbox.ts, weapons.ts). Nothing while shut.
    const note = (what: string) => {
        if (!recording) return;
        log.events.push([since(performance.now()), what]);
        if (log.events.length > 6000) log.events.splice(0, 1000);
    };
    world.note = note;

    const open = () => {
        wrap();
        update = rows.get('game update: rest (who is looked at)');
        render = rows.get('render: Babylon CPU (cull, shadows, draws)');
        if (!t0) {
            const info = engine.getInfo(), canvas = engine.getRenderingCanvas();
            t0 = performance.now();
            log.started = new Date().toISOString();
            log.machine = {
                gpu: info.renderer, vendor: info.vendor, api: engine.description, screen: `${screen.width}x${screen.height}`,
                canvas: `${canvas.clientWidth}x${canvas.clientHeight}`, pixelRatio: devicePixelRatio, cores: navigator.hardwareConcurrency,
                browser: navigator.userAgent,
            };
        }
        preset = world.quality?.preset;
        level = world.quality?.level;
        n = spent = cpu = wait = waitMax = calls = nt = ran = 0;
        recording = true;
        sceneInst = new BABYLON.SceneInstrumentation(scene);
        for (const k of ['captureActiveMeshesEvaluationTime', 'captureRenderTargetsRenderTime', 'captureFrameTime', 'captureRenderTime',
            'captureInterFrameTime', 'captureCameraRenderTime', 'capturePhysicsTime']) sceneInst[k] = true;
        engineInst = new BABYLON.EngineInstrumentation(engine);
        engineInst.captureShaderCompilationTime = true;
        if (engine.getCaps().timerQuery) engineInst.captureGPUFrameTime = true;
        last = secondAt = performance.now();
        made = engineInst.shaderCompilationTimeCounter.count;
        // At the end of the frame, once the scene's render (and its timed row) is done.
        frame = engine.onEndFrameObservable.add(tick);
        el.classList.remove('gone');
    };

    const close = () => {
        recording = false;
        engine.onEndFrameObservable.remove(frame);
        sceneInst.dispose();
        engineInst.dispose();
        for (const back of undo.reverse()) back();
        undo.length = 0;
        rows.clear();
        counters.clear();
        draws.clear();
        shown = '';
        el.innerHTML = '';
        el.classList.add('gone');
    };

    // Each frame: this frame's times into the averages and the worst of this second, and the counters zeroed.
    const tick = () => {
        const now = performance.now(), dt = now - last, k = Math.min(1, dt / 1000);
        last = now;
        // The game's own code this frame; the rest is the wait for the GPU, the screen and the browser (its GC too).
        const busy = ran, shaders = engineInst.shaderCompilationTimeCounter.count;
        // A spike against the frame rate it is running at: over 50 ms on a slow machine is every frame.
        if (dt > Math.max(50, 2.5 * gap)) spike(now, dt, busy, shaders - made);
        made = shaders;
        ran = 0;
        gap += (dt - gap) * k;
        hist[Math.min(500, Math.round(dt))]++;
        allFrames++;
        allMs += dt;
        if (nt < times.length) times[nt++] = dt;
        n++;
        spent += dt;
        cpu += busy;
        wait += Math.max(0, dt - busy);
        waitMax = Math.max(waitMax, dt - busy);
        calls += sceneInst.drawCallsCounter.current;
        const q = world.quality;
        if (q && q.preset !== preset) { preset = q.preset; note(`quality ${preset} (F3)`); }
        if (q && q.level !== level) { level = q.level; note(`render scale ${Math.round(100 / level)}%`); }
        const s = Math.floor(now / 1000) % 5;
        if (s !== slot) {
            slot = s;
            for (const r of [...rows.values(), ...counters.values(), ...draws.values()]) r.worst[s] = 0;
            const count = engineInst.shaderCompilationTimeCounter.count;
            compiles = count - compiled;
            compiled = count;
        }
        const count = (name: string, ms: number) => { rowOf(counters, name).self = ms; };
        count('frame (between frames)', dt);
        count('GPU frame', engine.getCaps().timerQuery ? engineInst.gpuFrameTimeCounter.current * 1e-6 : 0);
        count('Babylon frame (animate to drawn)', sceneInst.frameTimeCounter.current);
        count('between frames, outside render', sceneInst.interFrameTimeCounter.current);
        count('active meshes evaluation', sceneInst.activeMeshesEvaluationTimeCounter.current);
        count('render targets (shadow maps, probe)', sceneInst.renderTargetsRenderTimeCounter.current);
        count('main draw (renderTime)', sceneInst.renderTimeCounter.current);
        count('camera render', sceneInst.cameraRenderTimeCounter.current);
        count('physics (Babylon count)', sceneInst.physicsTimeCounter.current);
        seen.clear();
        for (const r of [...rows.values(), ...counters.values(), ...draws.values()]) {
            r.avg += (r.self - r.avg) * k;
            r.allAvg += (r.all - r.allAvg) * k;
            r.per += (r.calls - r.per) * k;
            r.worst[s] = Math.max(r.worst[s], r.self);
            r.sum += r.self;
            r.max = Math.max(r.max, r.self);
            r.self = r.all = r.calls = 0;
        }
        if (now - secondAt >= 1000) sample(now);
        if (now - drawn > 250) { drawn = now; late(); draw(); }
    };

    // A second of the log: the frame's spread, each row's mean and worst (the ones under 0.05 ms and 1 ms left out).
    const sample = (now: number) => {
        secondAt = now;
        const sorted = times.subarray(0, nt).sort(), systems = {};
        const keep = (name: string, sum: number, max: number) => {
            const t = totals.get(name) ?? { ms: 0, worst: 0 };
            totals.set(name, t);
            t.ms += sum;
            t.worst = Math.max(t.worst, max);
            if (sum / n >= 0.05 || max >= 1) systems[name] = [r2(sum / n), r2(max)];
        };
        for (const r of rows.values()) if (r.sum) keep(r.name, r.sum, r.max);
        keep(IDLE, wait, waitMax);
        const memory = (performance as any).memory;
        log.samples.push({
            t: since(now), frames: n, fps: Math.round((1000 * n) / spent),
            ms: [r2(spent / n), r2(sorted[Math.floor(0.95 * (nt - 1))]), r2(sorted[nt - 1])],
            cpu: r2(cpu / n), waiting: r2(wait / n), gpu: engine.getCaps().timerQuery ? r2(counters.get('GPU frame').sum / n) : null,
            draws: Math.round(calls / n), meshes: scene.getActiveMeshes().length, people: world.npcs.length,
            scale: world.quality ? Math.round(100 / world.quality.level) : 100, preset: world.quality?.preset,
            heap: memory ? Math.round(memory.usedJSHeapSize / 1e6) : undefined, systems,
        });
        if (log.samples.length > 1800) log.samples.shift();
        for (const r of [...rows.values(), ...counters.values(), ...draws.values()]) r.sum = r.max = 0;
        n = nt = spent = cpu = wait = waitMax = calls = 0;
    };

    // A spike frame: the rows heaviest in it, and what the player did in the second before.
    const spike = (now: number, dt: number, busy: number, compiles: number) => {
        // (From a second before the frame began: in a frame of seconds, what set it off came at its start.)
        const t = since(now), from = t - dt / 1000 - 1, heard = new Map<string, number>();
        for (let i = log.events.length - 1; i >= 0 && log.events[i][0] > from; i--) heard.set(log.events[i][1], (heard.get(log.events[i][1]) ?? 0) + 1);
        const before = [...heard].reverse().map(([what, times]) => (times > 1 ? `${what} (x${times})` : what));
        const top = [...rows.values()].filter((r) => r.self >= 0.5).sort((a, b) => b.self - a.self).slice(0, 6).map((r) => `${r.name} ${r2(r.self)}`);
        log.spikes.push({ t, ms: r2(dt), cpu: r2(busy), waiting: r2(Math.max(0, dt - busy)), compiles, draws: sceneInst.drawCallsCounter.current, top, before });
        if (log.spikes.length > 300) log.spikes.splice(log.spikes.indexOf(log.spikes.reduce((a, b) => (b.ms < a.ms ? b : a))), 1);
    };

    // Worked out on saving: where the time went over the whole session, and its worst moments.
    const summary = () => {
        const at = (p: number) => { let seen = 0; for (let ms = 0; ms < hist.length; ms++) if ((seen += hist[ms]) >= p * allFrames) return ms; return 500; };
        let histMs = 0;
        for (let ms = 0; ms < hist.length; ms++) histMs += hist[ms] * ms;
        const spread = {};
        let from = 0;
        for (const [band, to] of [['60+ fps', 17], ['45-60 fps', 22], ['30-45 fps', 33], ['15-30 fps', 67], ['under 15 fps', 500]] as const) {
            let ms = 0;
            for (; from <= to; from++) ms += hist[from] * from;
            spread[band] = `${Math.round((100 * ms) / histMs)}%`;
        }
        const mean = (k: string) => {
            let sum = 0, frames = 0;
            for (const s of log.samples) if (s[k] !== null) { sum += s[k] * s.frames; frames += s.frames; }
            return frames ? r2(sum / frames) : null;
        };
        const frameMs = r2(allMs / allFrames), cpuMs = mean('cpu'), waitMs = mean('waiting'), gpuMs = mean('gpu');
        const bound = frameMs < 1000 / 55 ? `neither: ${frameMs} ms a frame keeps up`
            : gpuMs !== null ? `${gpuMs > cpuMs ? 'GPU' : 'CPU'}: the GPU ${gpuMs} ms a frame, the game's code ${cpuMs}`
                : waitMs > cpuMs ? `GPU, most likely: ${waitMs} ms a frame waiting outside the game's code, ${cpuMs} in it (no GPU timer here)`
                    : `CPU: ${cpuMs} ms a frame in the game's code, ${waitMs} waiting`;
        const tally = (k: string) => {
            const seconds = {};
            for (const s of log.samples) seconds[s[k]] = (seconds[s[k]] ?? 0) + (s.frames * s.ms[0]) / 1000;
            for (const k in seconds) seconds[k] = Math.round(seconds[k]);
            return seconds;
        };
        const p = (ms: number) => (ms < 500 ? `${ms}` : '500+');
        return {
            recorded: { seconds: Math.round(allMs / 1000), frames: allFrames, 'samples kept': log.samples.length },
            fps: { mean: Math.round((1000 * allFrames) / allMs), 'frame ms p50 p95 p99': `${p(at(0.5))} ${p(at(0.95))} ${p(at(0.99))}`, 'share of time': spread },
            bound,
            'seconds at render scale %': tally('scale'),
            'seconds at preset': tally('preset'),
            'worst systems': [...totals].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)
                .map(([name, t]) => ({ name, 'ms a frame': r2(t.ms / allFrames), worst: r2(t.worst), share: `${Math.round((100 * t.ms) / allMs)}%` })),
            'worst spikes': [...log.spikes].sort((a, b) => b.ms - a.ms).slice(0, 10),
        };
    };

    // A normal download: the page is static, there is nowhere to send it.
    const save = () => {
        const d = new Date(), two = (x: number) => String(x).padStart(2, '0');
        const name = `coldchain-profile-${__VERSION__}-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.json`;
        // The summary and the machine laid out to be read; then a spike, an event or a sample a line.
        const lines = (list: unknown[]) => `[\n${list.map((x) => JSON.stringify(x)).join(',\n')}\n]`;
        const { samples, spikes, events, ...head } = log;
        const json = JSON.stringify({ summary: summary(), ...head }, null, 2).slice(0, -2)
            + `,\n  "spikes": ${lines(spikes)},\n  "events": ${lines(events)},\n  "samples": ${lines(samples)}\n}\n`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        said = `, saved ${name}`;
        setTimeout(() => { said = ''; }, 4000);
    };

    const draw = () => {
        const worst = (r: Row) => Math.max(...r.worst);
        const spike = (r: Row) => worst(r) > 2 * r.avg + 1;
        const pct = (ms: number) => Math.round((100 * ms) / gap);
        const idle = { name: IDLE, avg: Math.max(0, gap - update.allAvg - render.allAvg), per: 1, worst: [0] } as Row;
        const ranked = [...rows.values(), idle].sort((a, b) => b.avg - a.avg).filter((r) => r.avg > 0.005);
        const line = (r: Row, i: number, ranking: boolean) => {
            const times = r.per > 1.5 ? `x${Math.round(r.per)}` : '';
            const top = ranking && i < 3 ? ' class="top"' : '';
            const mark = spike(r) ? '<b>!</b>' : ' ';
            return `<div${top}>${r.name.padEnd(42).slice(0, 42)} ${r.avg.toFixed(2).padStart(6)} ${worst(r).toFixed(1).padStart(6)}${mark}`
                + `${String(pct(r.avg)).padStart(3)}% <span><i style="width:${Math.min(100, pct(r.avg))}%"></i></span> ${times}</div>`;
        };
        const plain = (r: Row) => `${r.name.padEnd(42)} ${r.avg.toFixed(2).padStart(6)} ${worst(r).toFixed(1).padStart(6)}${spike(r) ? '!' : ' '}`
            + `${String(pct(r.avg)).padStart(3)}% ${r.per > 1.5 ? `x${Math.round(r.per)}` : ''}`;
        const gpu = engine.getCaps().timerQuery ? `${counters.get('GPU frame').avg.toFixed(2)} ms` : 'not available (no timer query)';
        const memory = (performance as any).memory;
        const bodies = physics.getBodies().length, loops = world.npcs.reduce((n, npc) => n + (npc.viscera?.loops?.length ?? 0), 0);
        const counts = [
            `${(1000 / gap).toFixed(0)} fps   ${gap.toFixed(1)} ms a frame   GPU ${gpu}`,
            `${world.quality ? `render ${Math.round(100 / world.quality.level)}% of the screen a side   quality ${world.quality.preset} (F3)` : ''}`,
            `draw calls ${sceneInst.drawCallsCounter.current}   active meshes ${scene.getActiveMeshes().length}   triangles ${Math.round(scene.getActiveIndices() / 3)}`,
            `materials ${scene.materials.length}   textures ${scene.textures.length}   shader compiles last second ${compiles}`,
            `people ${world.npcs.length}   organ loops ${loops}   drops ${world.blood.n}   streams ${world.blood.streams.size}   bodies ${bodies}`
                + (memory ? `   heap ${(memory.usedJSHeapSize / 1e6).toFixed(0)} MB` : ''),
        ];
        const head = `${'own time, worst first'.padEnd(42)} ${'ms'.padStart(6)} ${'max 5s'.padStart(6)}  frame`;
        const babylon = [...counters.values()].filter((r) => r.name !== 'GPU frame' || engine.getCaps().timerQuery);
        const passes = new Map<string, number>();
        for (const r of draws.values()) { const p = r.name.slice(0, r.name.indexOf(':')); passes.set(p, (passes.get(p) ?? 0) + r.avg); }
        const drawHead = `draw calls by source (${[...passes].map(([p, n]) => `${p} ${Math.round(n)}`).join(', ')})`;
        const drawing = [...draws.values()].filter((r) => r.avg >= 0.5).sort((a, b) => b.avg - a.avg).slice(0, 16)
            .map((r) => `${r.name.padEnd(42).slice(0, 42)} ${r.avg.toFixed(0).padStart(6)} ${worst(r).toFixed(0).padStart(6)}  ${Math.round(r.per)} drew`);
        text = [`Cold Chain ${__VERSION__} profile`, ...counts, '', head, ...ranked.map(plain), '', 'Babylon counters (overlap)', ...babylon.map(plain),
            '', drawHead, ...drawing].join('\n');
        const html = `<h3>Profiler <em>F2 close, Shift+F2 copy, F4 save the log (${Math.floor(allMs / 60000)}:${String(Math.floor(allMs / 1000) % 60).padStart(2, '0')} recorded)${said}</em></h3>${counts.map((c) => `<div>${c}</div>`).join('')}`
            + `<h4>${head}</h4>${ranked.map((r, i) => line(r, i, true)).join('')}<h4>Babylon counters (overlap)</h4>${babylon.map((r, i) => line(r, i, false)).join('')}`
            + `<h4>${drawHead}</h4>${drawing.map((d) => `<div>${d}</div>`).join('')}`;
        // (Written only when it changes, as the HUD's are.)
        if (html !== shown) { el.innerHTML = html; shown = html; }
    };

    // The page may be served over plain http from another machine, where there is no navigator.clipboard.
    const copy = () => {
        console.log(text);
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        said = document.execCommand('copy') ? ', copied' : ', copy failed (in the console)';
        area.remove();
        setTimeout(() => { said = ''; }, 2000);
    };

    window.addEventListener('keydown', (e) => {
        if (e.code !== 'F2' && e.code !== 'F4') return;
        e.preventDefault();
        if (e.code === 'F4') { if (recording) save(); } else if (e.shiftKey) { if (recording) copy(); } else if (recording) close(); else open();
    });
    // A hidden tab draws nothing: the time away is not a frame.
    document.addEventListener('visibilitychange', () => { last = performance.now(); note(document.hidden ? 'tab hidden' : 'tab shown'); });
    return { open, close, save, log, rows, get text() { return text; } };
}
