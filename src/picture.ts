// The picture: what is done to every frame after it is drawn.
//
// No tape, no scanlines: this game is in colour and wants to look like a
// camera that works. A filmic curve, a little bloom round whatever is
// really bright (a lamp, a lit window), grain, and the corners drawn in.
//
// The exposure looks high and is not. The curve crushes everything dim to
// black, and a night lit by a moon behind cloud is nothing but dim: at an
// exposure of one it is a black screen with a torch in it. So the exposure
// is opened up and every lamp in the game is set against that.

import * as BABYLON from '@babylonjs/core';
export const EXPOSURE = 1.9;

export function gradePicture(scene, camera, { exposure = EXPOSURE } = {}) {
    const pipeline = new BABYLON.DefaultRenderingPipeline('picture', true, scene, [camera]);
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.75;
    pipeline.bloomWeight = 0.35;
    pipeline.bloomKernel = 48;
    pipeline.bloomScale = 0.5;
    pipeline.grainEnabled = true;
    pipeline.grain.intensity = 7;
    pipeline.grain.animated = true;
    const image = pipeline.imageProcessing;
    image.toneMappingEnabled = true;
    image.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    image.exposure = exposure;
    image.contrast = 1.12;
    image.vignetteEnabled = true;
    image.vignetteWeight = 2.4;
    return pipeline;
}
