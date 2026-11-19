// The insides' own surface (viscera.rs Wet; the TS's Wet, Bloodied and the hider's inside of the wall).
//
// Organs have no picture of their own (the anatomy is shapes): their surface is made where it is drawn, from their
// places at rest (each corner's colour is its place at rest, and its alpha the millimetres of blood lying on it), so it
// stays on them as they move. Small vessels running over it, the mottling of a liver's lobules or a lung's, fat in the
// heart's grooves and on the colon, and a fine unevenness that catches the light. Blood lying on it is laid over the
// organ's colour as a film of blood is (fluid.ts's Beer-Lambert colour): a thin film reddens, a thick one is dark.
//
// `wet.look.w` says what is drawn: 1 an organ, 2 the brain (an organ with its folds), 0 a rope of bowel out of the belly
// (its picture its own, its blood the corners' alpha).

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};
// Blood over a surface (fluid.wesl, fluid.ts bloodOver): `mm` deep, `wet` 1 fresh, 0 dried.
import cold_chain::fluid::blood_over;

// (viscera.rs Wet: its two fields are one uniform.)
struct Wet {
    base: vec4<f32>,
    look: vec4<f32>,
}
@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> wet: Wet;

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
    if wet.look.w < 0.5 {
        // A rope of bowel: its own picture (the corners' colour is white), blood over it in smears, the pink serosa
        // between (a film over all of it read as red plastic).
        // (By its picture's place, which goes with it as it moves.)
        let q = vec3(in.uv.x * 9.0, in.uv.y * 3.0, 0.5);
        let smears = smoothstep(0.35, 0.8, wet_noise(q * 2.0 + 3.0) * 0.7 + wet_noise(q * 7.0) * 0.3);
        pbr_input.material.base_color = vec4(blood_over(pbr_input.material.base_color.rgb, mm * mix(0.1, 1.3, smears), 1.0), 1.0);
    } else {
        let p = in.color.rgb;
        let px = max(length(dpdx(p)), length(dpdy(p)));
        let broad = mix(0.5, wet_noise(p * 40.0), fade(40.0, px));
        let mid = mix(0.5, wet_noise(p * 160.0), fade(160.0, px));
        let fine = mix(0.5, wet_noise(p * 700.0), fade(700.0, px));
        // Vessels: thin lines where a stretched noise crosses its middle, branching where two scales meet. A line is a
        // twentieth of a cell wide: drawn only where that is a pixel or more.
        let r1 = 1.0 - abs(wet_noise(p * vec3(90.0, 140.0, 90.0)) * 2.0 - 1.0);
        let r2 = 1.0 - abs(wet_noise(p * 260.0 + 3.1) * 2.0 - 1.0);
        let vessel = (smoothstep(0.93, 0.985, r1) * fade(1400.0, px) + 0.6 * smoothstep(0.95, 0.99, r2) * fade(2600.0, px)) * wet.look.x;
        let spots = smoothstep(0.55, 0.75, wet_noise(p * 150.0)) * wet.look.y * fade(300.0, px);
        let fatty = smoothstep(0.58, 0.72, wet_noise(p * 28.0 + 7.7)) * wet.look.z;
        var albedo = wet.base.rgb * (0.82 + 0.3 * broad) * (0.92 + 0.12 * mid);
        albedo *= 1.0 - 0.35 * spots;
        albedo = mix(albedo, vec3(0.62, 0.36, 0.09), fatty);
        albedo = mix(albedo, vec3(0.2, 0.012, 0.01), clamp(vessel, 0.0, 0.85));
        // A fine unevenness (and the vessels standing a little proud) bending the light: a few tenths of a millimetre.
        var h = (mid * 0.6 + fine * 0.25 + vessel * 0.4 + fatty * 0.6) * 0.0003;
        // Where a missile went, the blood on it lies in patches, thin and red, clotted dark, the surface showing between
        // (one even film read as red lacquer).
        let patches = mix(0.5, wet_noise(p * 90.0 + 13.0) * 0.7 + wet_noise(p * 330.0 + 5.0) * 0.3, fade(330.0, px));
        var blood = mm * mix(0.15, 1.6, smoothstep(0.3, 0.75, patches));
        // (How much of it is torn up: the brain where the charge went is pulp, not folds.)
        let pulped = smoothstep(0.02, 0.12, mm) * step(1.5, wet.look.w);
        if wet.look.w > 1.5 {
            // The brain's surface folded into gyri, each a centimetre or so across, winding, with the sulci between them
            // narrow, dark and deep, the pia's larger vessels lying along them (the anatomy's cerebrum is only its lobes,
            // smooth: the folds are drawn here, a relief of two millimetres bending the light).
            let warp = vec3(wet_noise(p * 25.0), wet_noise(p * 25.0 + 4.3), wet_noise(p * 25.0 + 9.1)) * 0.9;
            let fold = abs(wet_noise(p * 55.0 + warp) * 2.0 - 1.0) * fade(110.0, px) + 0.5 * (1.0 - fade(110.0, px));
            let groove = (1.0 - smoothstep(0.03, 0.2, fold)) * (1.0 - pulped);
            albedo = mix(albedo, albedo * vec3(0.45, 0.3, 0.3), groove * 0.85);
            albedo = mix(albedo, vec3(0.3, 0.02, 0.02), smoothstep(0.0, 0.05, 0.05 - fold) * 0.6 * (1.0 - pulped));
            h += smoothstep(0.0, 0.35, fold) * 0.002 * (1.0 - pulped);
            // Pulp: grey-pink, mottled, lumpy, with dark clot through it.
            let pulp = mix(vec3(0.20, 0.14, 0.13), vec3(0.42, 0.30, 0.28), mid) * (0.75 + 0.5 * fine);
            albedo = mix(albedo, pulp, pulped);
            h += pulped * (broad * 0.0015 + fine * 0.0005);
        }
        pbr_input.material.base_color = vec4(blood_over(albedo, blood, 1.0), 1.0);
        // Wet, but not lacquered where it is torn up and clotted.
        pbr_input.material.perceptual_roughness = mix(pbr_input.material.perceptual_roughness, 0.5 + 0.15 * fine, max(pulped, smoothstep(0.1, 0.4, blood) * 0.6));
        pbr_input.N = bent(pbr_input.N, in.world_position.xyz, h);
    }
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
