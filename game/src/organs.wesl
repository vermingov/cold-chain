// The insides' own surface (viscera.rs Wet; the TS's Wet, Bloodied and the hider's inside of the wall).
//
// Organs have no picture of their own (the anatomy is shapes): their surface is made where it is drawn, from their
// places at rest (each corner's colour is its place at rest, and its alpha the millimetres of blood lying on it), so it
// stays on them as they move. Small vessels running over it, the mottling of a liver's lobules or a lung's, fat in the
// heart's grooves and on the colon, and a fine unevenness that catches the light. Blood lying on it is laid over the
// organ's colour as a film of blood is (fluid.ts's Beer-Lambert colour): a thin film reddens, a thick one is dark.
//
// `look.w` says what is drawn: 1 an organ, 0 a rope of bowel out of the belly (its picture its own, its blood the
// corners' alpha), 2 the body's wall seen from inside through an opening (dark muscle under its glistening lining).

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};

@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> base: vec4<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(101) var<uniform> look: vec4<f32>;

fn wet_hash(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn wet_noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wet_hash(i), wet_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wet_hash(i + vec3(0.0, 1.0, 0.0)), wet_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(wet_hash(i + vec3(0.0, 0.0, 1.0)), wet_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wet_hash(i + vec3(0.0, 1.0, 1.0)), wet_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

// Blood `mm` millimetres deep over a surface of colour `under` (fluid.ts bloodOver): `wet` 1 fresh, 0 dried.
fn blood_over(under: vec3<f32>, mm: f32, wet: f32) -> vec3<f32> {
    let mu = mix(vec3(3.6, 9.0, 10.5), vec3(3.0, 24.0, 28.0), wet);
    let deep = mix(vec3(0.03, 0.01, 0.0065), vec3(0.075, 0.004, 0.0035), wet);
    let through = exp(-mu * 2.0 * mm);
    return under * through + deep * (1.0 - through);
}

// Each scale fades to its middle where a pixel covers more than half of one of its cells: finer than that it can only
// flicker and glint from pixel to pixel (the sparkle seen in an opened belly). f: cells a metre.
fn fade(f: f32, px: f32) -> f32 {
    return clamp(1.0 / (f * px) - 1.0, 0.0, 1.0);
}

// The surface's normal bent by a height `h` (metres) over it.
fn bent(n: vec3<f32>, world: vec3<f32>, h: f32) -> vec3<f32> {
    let dpx = dpdx(world);
    let dpy = dpdy(world);
    let dhx = dpdx(h);
    let dhy = dpdy(h);
    let r1 = cross(dpy, n);
    let r2 = cross(n, dpx);
    let det = dot(dpx, r1);
    let grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * n - grad);
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    pbr_input.material.base_color = alpha_discard(pbr_input.material.flags, pbr_input.material.alpha_cutoff, pbr_input.material.base_color);
    let mm = in.color.a;
    if look.w < 0.5 {
        // A rope of bowel: its own picture (the corners' colour is white), blood over it.
        pbr_input.material.base_color = vec4(blood_over(pbr_input.material.base_color.rgb, mm, 1.0), 1.0);
    } else {
        let p = in.color.rgb;
        let px = max(length(dpdx(p)), length(dpdy(p)));
        let broad = mix(0.5, wet_noise(p * 40.0), fade(40.0, px));
        let mid = mix(0.5, wet_noise(p * 160.0), fade(160.0, px));
        let fine = mix(0.5, wet_noise(p * 700.0), fade(700.0, px));
        var albedo: vec3<f32>;
        var h: f32;
        if look.w < 1.5 {
            // Vessels: thin lines where a stretched noise crosses its middle, branching where two scales meet. A line is a
            // twentieth of a cell wide: drawn only where that is a pixel or more.
            let r1 = 1.0 - abs(wet_noise(p * vec3(90.0, 140.0, 90.0)) * 2.0 - 1.0);
            let r2 = 1.0 - abs(wet_noise(p * 260.0 + 3.1) * 2.0 - 1.0);
            let vessel = (smoothstep(0.93, 0.985, r1) * fade(1400.0, px) + 0.6 * smoothstep(0.95, 0.99, r2) * fade(2600.0, px)) * look.x;
            let spots = smoothstep(0.55, 0.75, wet_noise(p * 150.0)) * look.y * fade(300.0, px);
            let fatty = smoothstep(0.58, 0.72, wet_noise(p * 28.0 + 7.7)) * look.z;
            albedo = base.rgb * (0.82 + 0.3 * broad) * (0.92 + 0.12 * mid);
            albedo *= 1.0 - 0.35 * spots;
            albedo = mix(albedo, vec3(0.62, 0.36, 0.09), fatty);
            albedo = mix(albedo, vec3(0.2, 0.012, 0.01), clamp(vessel, 0.0, 0.85));
            // A fine unevenness (and the vessels standing a little proud) bending the light: a few tenths of a millimetre.
            h = (mid * 0.6 + fine * 0.25 + vessel * 0.4 + fatty * 0.6) * 0.0003;
        } else {
            // The body's wall from inside: muscle under its glistening lining, blood lying on it.
            let n1 = wet_noise(p * 30.0);
            let n2 = wet_noise(p * 110.0);
            albedo = mix(vec3(0.14, 0.016, 0.012), vec3(0.26, 0.04, 0.032), n1 * 0.75 + n2 * 0.25);
            h = (mid * 0.6 + fine * 0.3) * 0.0004;
        }
        pbr_input.material.base_color = vec4(blood_over(albedo, mm, 1.0), 1.0);
        pbr_input.N = bent(pbr_input.N, in.world_position.xyz, h);
    }
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
