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

type Row = { name: string; self: number; all: number; calls: number; avg: number; allAvg: number; per: number; worst: number[] };

export function profiler(layer: HTMLElement, sandbox) {
    const { scene, world } = sandbox;
    const engine = scene.getEngine();
    const physics = scene.getPhysicsEngine();
    const plugin = physics.getPhysicsPlugin();
    const el = document.createElement('div');
    el.className = 'profiler gone';
    layer.appendChild(el);

    const rows = new Map<string, Row>(), counters = new Map<string, Row>();
    const rowOf = (map: Map<string, Row>, name: string) => {
        if (!map.has(name)) map.set(name, { name, self: 0, all: 0, calls: 0, avg: 0, allAvg: 0, per: 0, worst: [0, 0, 0, 0, 0] });
        return map.get(name);
    };
    const undo: (() => void)[] = [];
    let inner = 0;      // the time spent so far in timed calls under the one running now

    const time = (o, k: string, name: string) => {
        const was = o?.[k];
        if (typeof was !== 'function' || was.timed) return;
        const own = Object.hasOwn(o, k), row = rowOf(rows, name);
        const timed = function (...args) {
            const t0 = performance.now(), outer = inner;
            inner = 0;
            try {
                return was.apply(this, args);
            } finally {
                const t = performance.now() - t0;
                row.self += t - inner;
                row.all += t;
                row.calls++;
                inner = outer + t;
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
    };

    let sceneInst: BABYLON.SceneInstrumentation | null = null, engineInst: BABYLON.EngineInstrumentation | null = null;
    let frame = null, last = 0, gap = 16.7, slot = 0, drawn = 0, shown = '', text = '', said = '', compiles = 0, compiled = 0;

    const open = () => {
        wrap();
        sceneInst = new BABYLON.SceneInstrumentation(scene);
        for (const k of ['captureActiveMeshesEvaluationTime', 'captureRenderTargetsRenderTime', 'captureFrameTime', 'captureRenderTime',
            'captureInterFrameTime', 'captureCameraRenderTime', 'capturePhysicsTime']) sceneInst[k] = true;
        engineInst = new BABYLON.EngineInstrumentation(engine);
        engineInst.captureShaderCompilationTime = true;
        if (engine.getCaps().timerQuery) engineInst.captureGPUFrameTime = true;
        last = performance.now();
        frame = scene.onAfterRenderObservable.add(tick);
        el.classList.remove('gone');
    };

    const close = () => {
        scene.onAfterRenderObservable.remove(frame);
        sceneInst.dispose();
        engineInst.dispose();
        for (const back of undo.reverse()) back();
        undo.length = 0;
        rows.clear();
        counters.clear();
        shown = '';
        el.innerHTML = '';
        el.classList.add('gone');
    };

    // Each frame: this frame's times into the averages and the worst of this second, and the counters zeroed.
    const tick = () => {
        const now = performance.now(), dt = now - last, k = Math.min(1, dt / 1000);
        last = now;
        gap += (dt - gap) * k;
        const s = Math.floor(now / 1000) % 5;
        if (s !== slot) {
            slot = s;
            for (const r of [...rows.values(), ...counters.values()]) r.worst[s] = 0;
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
        for (const r of [...rows.values(), ...counters.values()]) {
            r.avg += (r.self - r.avg) * k;
            r.allAvg += (r.all - r.allAvg) * k;
            r.per += (r.calls - r.per) * k;
            r.worst[s] = Math.max(r.worst[s], r.self);
            r.self = r.all = r.calls = 0;
        }
        if (now - drawn > 250) { drawn = now; late(); draw(); }
    };

    const draw = () => {
        const worst = (r: Row) => Math.max(...r.worst);
        const spike = (r: Row) => worst(r) > 2 * r.avg + 1;
        const pct = (ms: number) => Math.round((100 * ms) / gap);
        const update = rows.get('game update: rest (who is looked at)'), render = rows.get('render: Babylon CPU (cull, shadows, draws)');
        const idle = { name: 'waiting (GPU, screen, browser)', avg: Math.max(0, gap - update.allAvg - render.allAvg), per: 1, worst: [0] } as Row;
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
        text = [`Cold Chain ${__VERSION__} profile`, ...counts, '', head, ...ranked.map(plain), '', 'Babylon counters (overlap)', ...babylon.map(plain)].join('\n');
        const html = `<h3>Profiler <em>F2 close, Shift+F2 copy${said}</em></h3>${counts.map((c) => `<div>${c}</div>`).join('')}`
            + `<h4>${head}</h4>${ranked.map((r, i) => line(r, i, true)).join('')}<h4>Babylon counters (overlap)</h4>${babylon.map((r, i) => line(r, i, false)).join('')}`;
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
        if (e.code !== 'F2') return;
        e.preventDefault();
        const on = !el.classList.contains('gone');
        if (e.shiftKey) { if (on) copy(); } else if (on) close(); else open();
    });
    return { open, close, rows, get text() { return text; } };
}
