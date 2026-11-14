// How much the game asks of the graphics card, fitted to the machine. The picture is made for a desktop card; on a
// laptop the card was 146 ms of a 229 ms frame (the F2 profiler), drawing every pixel of the screen through the full
// lighting, shadows, bloom and grain.
//
// The resolution follows the frame rate on its own: slower than about 36 fps for a second, the frame is drawn at fewer
// pixels (down to 40% a side, sharpened back by the FXAA already in the picture); faster than about 55 fps for three
// seconds, it climbs back to full. F3 picks a preset as well, kept between visits:
//   High    as made: bloom, grain, two 2048 soft shadow maps.
//   Medium  bloom at half its blur, no grain, 1024 shadow maps, cheaper filtering.
//   Low     no bloom, no grain, the lamps' shadows off.

import * as BABYLON from '@babylonjs/core';

const PRESETS = ['High', 'Medium', 'Low'];
const SLOW = 1000 / 36, FAST = 1000 / 55;      // ms a frame
const COARSEST = 2.5;                          // hardware scaling: 2.5 is 40% of the pixels a side

export function graphics(engine: BABYLON.AbstractEngine, pipeline: BABYLON.DefaultRenderingPipeline, shadows: BABYLON.ShadowGenerator[], layer: HTMLElement) {
    let preset = 0, level = 1, sum = 0, frames = 0, quick = 0, shown = 0;
    try { preset = Math.max(0, PRESETS.indexOf(localStorage.getItem('coldchain.quality') ?? 'High')); } catch { /* no storage: High */ }
    const note = document.createElement('div');
    note.className = 'help gone';
    note.style.cssText = 'left:auto;right:1rem;bottom:3.2rem';
    layer.appendChild(note);
    const say = (text: string) => { note.textContent = text; note.classList.remove('gone'); shown = performance.now(); };

    const apply = () => {
        const high = preset === 0, low = preset === 2;
        pipeline.bloomEnabled = !low;
        pipeline.bloomKernel = high ? 48 : 24;
        pipeline.grainEnabled = high;
        for (const s of shadows) {
            s.getShadowMap().resize(high ? 2048 : 1024);
            s.filteringQuality = high ? BABYLON.ShadowGenerator.QUALITY_MEDIUM : BABYLON.ShadowGenerator.QUALITY_LOW;
            s.getLight().shadowEnabled = !low;
        }
    };
    apply();

    window.addEventListener('keydown', (e) => {
        if (e.code !== 'F3') return;
        e.preventDefault();
        preset = (preset + 1) % PRESETS.length;
        try { localStorage.setItem('coldchain.quality', PRESETS[preset]); } catch { /* not kept */ }
        apply();
        say(`Quality: ${PRESETS[preset]} (F3)`);
    });

    return {
        // Once a frame, with the frame's real length (the game's own dt is capped).
        update() {
            sum += engine.getDeltaTime();
            // (Judged every 30 frames or every second, whichever comes first: at 4 fps 30 frames is too long to wait.)
            if (++frames < 30 && sum < 1000) { if (shown && performance.now() - shown > 2500) { note.classList.add('gone'); shown = 0; } return; }
            const ms = sum / frames;
            sum = frames = 0;
            const was = level;
            if (ms > SLOW) { level = Math.min(COARSEST, level * (ms > 2 * SLOW ? 1.6 : 1.25)); quick = 0; }
            else if (ms < FAST && level > 1 && ++quick >= 6) { level = Math.max(1, level / 1.25); quick = 0; }
            if (level !== was) engine.setHardwareScalingLevel(level);
        },
        get level() { return level; },
    };
}
