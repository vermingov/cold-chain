// The colour of blood (fluid.ts GLSL_BLOOD), for every shader that draws it: the floor's pools (puddle.wesl), the
// clothes' stains (cloth.wesl), the marks it leaves (stain.wesl).
//
// Linear: how much of each of red, green and blue a millimetre of it lets through (as an absorption, per mm), and the
// colour of so much of it that nothing shows through. Fresh, it passes red and stops green and blue almost at once: a
// smear is bright red over what is under it, a pool dark red. Dried, it is methaemoglobin and brown.
fn blood_over(under: vec3<f32>, mm: f32, wet: f32) -> vec3<f32> {
    let mu = mix(vec3(3.6, 9.0, 10.5), vec3(3.0, 24.0, 28.0), wet);
    let deep = mix(vec3(0.03, 0.01, 0.0065), vec3(0.075, 0.004, 0.0035), wet);
    let through = exp(-mu * 2.0 * mm);
    return under * through + deep * (1.0 - through);
}

// Smooth value noise in a plane, 0 to 1 (the TS's shaders' own `puddleNoise`, `hiderNoise`).
fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

fn noise2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// The same in space (hider.ts's GLSL_NOISE, which its stains are read through).
fn hash3(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
    let b = mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
    return mix(a, b, f.z);
}
