// Polished metal on the fists (worn.rs Polished: the brass knuckles). The hall's own environment light has no specular
// part (map.rs `fill_light`), so a metal, which shows nothing but what it reflects, drew nearly black but for the lamps'
// small highlights. Here it shows the hall as wet blood does (wet.rs, fluid.wesl `hall_seen`), coloured as the metal
// colours what it reflects (Schlick's fresnel from its own colour), a little less the rougher it is.

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};
import cold_chain::fluid::hall_seen;

// The hall (wet.rs): +X, -X, +Y, -Y, +Z, -Z.
@group(3) @binding(100) var hall0: texture_2d<f32>;
@group(3) @binding(101) var hall1: texture_2d<f32>;
@group(3) @binding(102) var hall2: texture_2d<f32>;
@group(3) @binding(103) var hall3: texture_2d<f32>;
@group(3) @binding(104) var hall4: texture_2d<f32>;
@group(3) @binding(105) var hall5: texture_2d<f32>;
@group(3) @binding(106) var hall_sampler: sampler;

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    let pbr_input = pbr_input_from_standard_material(in, is_front);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    let nv = clamp(dot(pbr_input.N, pbr_input.V), 0.0, 1.0);
    let f0 = pbr_input.material.base_color.rgb;
    let f = f0 + (vec3(1.0) - f0) * pow(1.0 - nv, 5.0);
    let seen = hall_seen(reflect(-pbr_input.V, pbr_input.N), hall0, hall1, hall2, hall3, hall4, hall5, hall_sampler);
    out.color = vec4(out.color.rgb + seen * f * (1.0 - 0.6 * pbr_input.material.perceptual_roughness), out.color.a);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
