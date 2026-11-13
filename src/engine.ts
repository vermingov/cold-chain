// The engine the game draws with: WebGPU where the browser has it and `?gpu=webgpu` asks for it, otherwise WebGL 2.
//
// shortcut: WebGPU is opt-in until every place has been seen drawn right on it; make it the default then.

import * as BABYLON from '@babylonjs/core';

export async function makeEngine(canvas: HTMLCanvasElement): Promise<BABYLON.AbstractEngine> {
    const wanted = new URLSearchParams(location.search).get('gpu') === 'webgpu';
    if (wanted && await BABYLON.WebGPUEngine.IsSupportedAsync) {
        const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true });
        await engine.initAsync();
        return engine;
    }
    // No multisampling on the canvas: the scene is drawn into the picture's own targets (picture.ts) and smoothed there
    // (FXAA), and all the canvas gets is that, one full-screen quad, which multisampling only made a resolve longer.
    return new BABYLON.Engine(canvas, false);
}

// The rig's scripts reach Babylon from the page while the game runs under the dev server.
if (import.meta.env.DEV) Object.assign(window, { BABYLON });
