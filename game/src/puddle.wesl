// The floor's blood drawn (floor.rs Puddle, the TS's Puddle material plugin): depth into colour, gloss and the bend of
// its surface, from what the floor's GPU step leaves in its map (floor.wesl: red the square root of the depth over 4 mm,
// green how wet).

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};
import cold_chain::fluid::{blood_over, noise2, hall_seen, fresnel};

@group(3) @binding(100) var puddle_map: texture_2d<f32>;
@group(3) @binding(101) var puddle_sampler: sampler;
// The floor's corner (x, z), one over its size, cells a side.
@group(3) @binding(102) var<uniform> area: vec4<f32>;
// The hall as wet blood shows it (wet.rs): +X, -X, +Y, -Y, +Z, -Z.
@group(3) @binding(103) var hall0: texture_2d<f32>;
@group(3) @binding(104) var hall1: texture_2d<f32>;
@group(3) @binding(105) var hall2: texture_2d<f32>;
@group(3) @binding(106) var hall3: texture_2d<f32>;
@group(3) @binding(107) var hall4: texture_2d<f32>;
@group(3) @binding(108) var hall5: texture_2d<f32>;
@group(3) @binding(109) var hall_sampler: sampler;
// How much of the hall a pool shows (the TS's environmentIntensity on its floor's blood).
const SHOWS: f32 = 0.9;

const MOST_MM: f32 = 4.0;
const CELL_MM: f32 = 12.5;

// A cubic B-spline's four weights at fraction t, and their slopes.
fn weights(t: f32) -> vec4<f32> {
    let t2 = t * t;
    let t3 = t2 * t;
    return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}

fn slopes(t: f32) -> vec4<f32> {
    let t2 = t * t;
    return vec4(-1.0 + 2.0 * t - t2, -4.0 * t + 3.0 * t2, 1.0 + 2.0 * t - 3.0 * t2, t2) * 0.5;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    let p = in.world_position.xz;
    // The cells read as a smooth surface (a cubic B-spline over the 4 by 4 cells about this point), not the grid's
    // squares: where blood is at all (wet cells, 1, against dry, 0), how deep it is, how wet, and how each changes across
    // the floor. Read a little off where this point is, by a smooth noise: blood's edge wanders with the floor's grain.
    let pw = p + (vec2(noise2(p * 17.0), noise2(p * 17.0 + 9.0)) - 0.5) * 0.009 + (vec2(noise2(p * 61.0 + 3.0), noise2(p * 61.0 + 5.0)) - 0.5) * 0.003;
    let tc = (pw - area.xy) * area.z * area.w - 0.5;
    let base = floor(tc);
    let f = tc - base;
    let wx = weights(f.x);
    let wz = weights(f.y);
    let sx = slopes(f.x);
    let sz = slopes(f.y);
    let at = vec2<i32>(base) - 1;
    let last = vec2(i32(area.w) - 1);
    // (Four filtered reads, each the mean of four cells, find a floor with no blood near it. The derivative below is
    // taken before anything is thrown away.)
    let q = (vec2<f32>(at) + 1.0) / area.w;
    let h = vec2(2.0 / area.w, 0.0);
    let near = textureSampleLevel(puddle_map, puddle_sampler, q, 0.0).r + textureSampleLevel(puddle_map, puddle_sampler, q + h, 0.0).r
        + textureSampleLevel(puddle_map, puddle_sampler, q + h.yx, 0.0).r + textureSampleLevel(puddle_map, puddle_sampler, q + h.xx, 0.0).r;
    var on = 0.0;
    var on_x = 0.0;
    var on_z = 0.0;
    var mm = 0.0;
    var mm_x = 0.0;
    var mm_z = 0.0;
    var wet = 0.0;
    for (var j = 0; j < 4; j++) {
        for (var i = 0; i < 4; i++) {
            let s = textureLoad(puddle_map, clamp(at + vec2(i, j), vec2(0), last), 0).rg;
            let there = step(0.03, s.r);
            let deep = s.r * s.r * MOST_MM;
            let w = wx[i] * wz[j];
            let ax = sx[i] * wz[j];
            let az = wx[i] * sz[j];
            on += there * w;
            on_x += there * ax;
            on_z += there * az;
            mm += deep * w;
            mm_x += deep * ax;
            mm_z += deep * az;
            wet += s.g * there * w;
        }
    }
    // The edge is where the wet cells give way to dry ones, as smooth a curve as they allow.
    let EDGE = 0.3;
    let fw = max(fwidth(on), 1e-4);
    if near == 0.0 {
        discard;
    }
    let cover = smoothstep(EDGE - fw, EDGE + fw, on + (noise2(p * 260.0) - 0.5) * 0.04);
    if cover < 0.003 {
        discard;
    }
    // How deep the blood about here stands (the wet cells' own depth, not thinned by the dry ones beside them), and at
    // its very edge thinning to nothing over a few millimetres: a thin bright rim round a dark pool, its meniscus.
    let inv = 1.0 / max(on, 0.05);
    let pool = mm * inv;
    let rim = smoothstep(EDGE, EDGE + 0.2, on);
    let shown = pool * mix(0.08, 1.0, rim);
    wet *= inv;
    // The surface of the blood: its depth's slope across the floor (per mm of floor).
    let t = clamp((on - EDGE) / 0.2, 0.0, 1.0);
    let grad = ((vec2(mm_x, mm_z) - pool * vec2(on_x, on_z)) * inv * mix(0.08, 1.0, rim) + pool * 0.92 * 30.0 * t * (1.0 - t) * vec2(on_x, on_z)) / CELL_MM;
    // Drying, it skins over and wrinkles.
    let crinkle = (1.0 - wet) * (noise2(p * 700.0) - 0.5) * 0.25;
    pbr_input.N = normalize(vec3(-grad.x + crinkle, 1.0, -grad.y - crinkle));
    let gloss = cover * mix(0.55, 0.97, smoothstep(0.05, 0.6, wet)) * smoothstep(0.0, 0.04, shown);
    pbr_input.material.base_color = vec4(blood_over(vec3(0.21, 0.2, 0.185), shown, wet), cover * clamp(0.5 + shown * 2.5, 0.0, 1.0));
    pbr_input.material.perceptual_roughness = 1.0 - gloss;
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    // The hall reflected in it, as much as its surface is smooth: wet, a mirror; skinned over, a dull sheen; dry, none.
    let n = pbr_input.N;
    let v = pbr_input.V;
    let seen = hall_seen(reflect(-v, n), hall0, hall1, hall2, hall3, hall4, hall5, hall_sampler);
    out.color = vec4(out.color.rgb + seen * fresnel(dot(n, v)) * SHOWS * gloss * gloss, out.color.a);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
