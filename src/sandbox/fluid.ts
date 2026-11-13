// What blood is, in numbers, for everything in the sandbox that moves it:
// drops in the air (blood.ts), streams on skin (runs.ts), blood in cloth
// (soak.ts), on skin (film.ts) and on the floor (floor.ts).
//
// Whole blood at body heat: 1060 kg/m3, about 3.5 mPa s where it is moving
// fast (it is thicker when slow: it thins as it is sheared), surface tension
// about 0.056 N/m. Those three set how big a drop is before it falls off a
// chin (Tate: about 0.05 ml), how deep it stands on a floor (twice its
// capillary length times the sine of half its contact angle: 2 to 3 mm),
// and how fast a film of it runs down a slope.

import * as BABYLON from '@babylonjs/core';

export const RHO = 1060;            // kg/m3
export const MU = 0.0035;           // Pa s
export const GAMMA = 0.056;         // N/m
export const AIR = 1.2;             // kg/m3, the air drops fly through
export const MU_AIR = 1.8e-5;       // Pa s
export const DRIP = 0.05;           // ml: the drop that falls from a chin, a nose, a fingertip

// A drop of `ml` millilitres: how wide it is (m), and the other way.
export const across = (ml: number) => Math.cbrt((ml * 1e-6 * 6) / Math.PI);
export const volume = (d: number) => (Math.PI / 6) * d * d * d * 1e6;

// How fast air slows a drop `d` wide going `speed`: a rate (1/s), from its drag (Schiller-Naumann) over its mass.
// A tenth of a millimetre stops in centimetres; a dripped drop falls nearly freely.
export function drag(d: number, speed: number) {
    const re = Math.max(1e-3, (AIR * speed * d) / MU_AIR);
    const cd = (24 / re) * (1 + 0.15 * Math.pow(re, 0.687));
    return (3 * AIR * cd * speed) / (4 * RHO * d);
}

// How far a drop spreads where it lands, as times its own width: about half the fourth root of its Reynolds number
// (a 4 mm drip falling a metre leaves a mark about 17 mm across; a 0.3 mm mist drop barely more than itself).
export const spreads = (d: number, speed: number) => Math.max(1.2, 0.5 * Math.pow((RHO * speed * d) / MU, 0.25));

// Whether it throws spines and droplets off its rim as it lands: its Weber number past a few hundred.
export const splashes = (d: number, speed: number) => (RHO * speed * speed * d) / GAMMA > 400;

// The colour of blood, linear: how much of each of red, green and blue a millimetre of it lets through (as an
// absorption, per mm), and the colour of so much of it that nothing shows through. Fresh, it passes red and stops
// green and blue almost at once: a smear is bright red over what is under it, a pool dark red. Dried, it is
// methaemoglobin and brown.
export const GLSL_BLOOD = `
vec3 bloodOver(vec3 under, float mm, float wet) {
    vec3 mu = mix(vec3(3.6, 9.0, 10.5), vec3(3.0, 24.0, 28.0), wet);
    vec3 deep = mix(vec3(0.03, 0.01, 0.0065), vec3(0.075, 0.004, 0.0035), wet);
    vec3 through = exp(-mu * 2.0 * mm);
    return under * through + deep * (1.0 - through);
}
`;

// A part of a texture sent to the card again, from a buffer holding the whole of it (WebGL 2; elsewhere the whole
// texture). `box` is [x0, y0, z0, x1, y1, z1] in texels, ends not included; 2D textures take z 0 to 1.
export function sendPart(texture: BABYLON.BaseTexture, data: Uint8Array, size: number[], box: number[], channels = 2) {
    const engine = texture.getScene().getEngine() as any, gl = engine._gl as WebGL2RenderingContext | undefined;
    const internal = texture.getInternalTexture();
    if (!gl || !internal || engine.webGLVersion < 2) { (texture as any).update(data); return; }
    const three = size.length === 3, target = three ? gl.TEXTURE_3D : gl.TEXTURE_2D;
    const format = channels === 2 ? gl.RG : gl.RGBA;
    engine._bindTextureDirectly(target, internal, true);
    engine._unpackFlipY(false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, size[0]);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, box[0]);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, box[1]);
    if (three) {
        gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, size[1]);
        gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, box[2]);
        gl.texSubImage3D(target, 0, box[0], box[1], box[2], box[3] - box[0], box[4] - box[1], box[5] - box[2], format, gl.UNSIGNED_BYTE, data);
        gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    } else gl.texSubImage2D(target, 0, box[0], box[1], box[3] - box[0], box[4] - box[1], format, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    engine._bindTextureDirectly(target, null);
}

// A part of a canvas sent to the texture it backs, `box` [x0, y0, x1, y1] in pixels, not turned upside down (WebGL 2;
// elsewhere the whole canvas, also the right way up).
export function sendCanvasPart(texture: BABYLON.DynamicTexture, canvas: HTMLCanvasElement, box: number[]) {
    const engine = texture.getScene().getEngine() as any, gl = engine._gl as WebGL2RenderingContext | undefined;
    const internal = texture.getInternalTexture();
    if (!gl || !internal || engine.webGLVersion < 2) { texture.update(false); return; }
    engine._bindTextureDirectly(gl.TEXTURE_2D, internal, true);
    engine._unpackFlipY(false);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, box[0]);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, box[1]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, box[0], box[1], box[2] - box[0], box[3] - box[1], gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    engine._bindTextureDirectly(gl.TEXTURE_2D, null);
}

// Smooth noise in a plane, 0 to 1, for floors that are not quite flat.
export function noise2(x: number, y: number) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const h = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v;
}
