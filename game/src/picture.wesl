// The picture (picture.rs): Babylon's image processing as the TS game had it, in its order. The exposure, the corners
// drawn in, ACES (Babylon's fit of it, the same as Bevy's "fitted"), into display values (a 2.2 gamma), the contrast,
// and the grain; then back to linear, for the sRGB target to put the same values on screen.

import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput;

struct Picture {
    exposure: f32,
    contrast: f32,
    vignette: f32,
    grain: f32,
    seed: f32,
    aspect: f32,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> picture: Picture;

fn rrt_and_odt_fit(v: vec3<f32>) -> vec3<f32> {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

fn aces_fitted(colour: vec3<f32>) -> vec3<f32> {
    // Babylon's matrices, written column by column as GLSL's mat3 takes them.
    let input = mat3x3<f32>(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777),
    );
    let output = mat3x3<f32>(
        vec3(1.60475, -0.10208, -0.00327),
        vec3(-0.53108, 1.10813, -0.07276),
        vec3(-0.07367, -0.00605, 1.07602),
    );
    return saturate(output * rrt_and_odt_fit(input * colour));
}

fn rand(seed: vec2<f32>) -> f32 {
    return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3(2.4));
    return select(high, low, c <= vec3(0.04045));
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    var c = textureSample(source, source_sampler, in.uv).rgb * picture.exposure;
    // The corners: Babylon's vignette at its default camera fov of half a radian, multiplied in.
    let xy = in.uv * 2.0 - 1.0;
    let scale = vec2(tan(0.25) * picture.aspect, tan(0.25));
    let term = dot(xy * scale, xy * scale) + 1.0;
    c *= pow(term, -2.0 * picture.vignette);
    c = aces_fitted(c);
    c = saturate(pow(c, vec3(1.0 / 2.2)));
    let high = c * c * (3.0 - 2.0 * c);
    if picture.contrast < 1.0 {
        c = mix(vec3(0.5), c, picture.contrast);
    } else {
        c = mix(c, high, picture.contrast - 1.0);
    }
    c = max(c, vec3(0.0));
    // Grain, strongest in the middle tones and none in black or white.
    if picture.grain > 0.0 {
        let v = picture.grain / 255.0;
        let grain = mix(-v, v, rand(in.uv * picture.seed));
        let lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(c + grain * (cos(-3.14159265 + lum * 6.2831853) + 1.0) / 2.0, vec3(0.0));
    }
    return vec4(srgb_to_linear(c), 1.0);
}
