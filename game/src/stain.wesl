// The marks blood leaves on the room (blood.rs Stain): the splash sheet's stain, coloured by how long it has lain (the
// mark's vertex colour, wet red to dried brown, as the TS's), and matte as it dries (its second UV: how dry), where the
// TS's stayed as glossy as when it fell.

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};
import cold_chain::fluid::{hall_seen, fresnel};

// The hall as wet blood shows it (wet.rs): +X, -X, +Y, -Y, +Z, -Z.
@group(3) @binding(100) var hall0: texture_2d<f32>;
@group(3) @binding(101) var hall1: texture_2d<f32>;
@group(3) @binding(102) var hall2: texture_2d<f32>;
@group(3) @binding(103) var hall3: texture_2d<f32>;
@group(3) @binding(104) var hall4: texture_2d<f32>;
@group(3) @binding(105) var hall5: texture_2d<f32>;
@group(3) @binding(106) var hall_sampler: sampler;
// How much of the hall a mark shows (the TS's environmentIntensity on its marks).
const SHOWS: f32 = 0.6;

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    pbr_input.material.base_color = alpha_discard(pbr_input.material.flags, pbr_input.material.alpha_cutoff, pbr_input.material.base_color);
    var dry = 0.0;
@if(VERTEX_UVS_B)
    dry = in.uv_b.x;
    pbr_input.material.perceptual_roughness = mix(0.1, 0.6, dry);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    let seen = hall_seen(reflect(-pbr_input.V, pbr_input.N), hall0, hall1, hall2, hall3, hall4, hall5, hall_sampler);
    out.color = vec4(out.color.rgb + seen * fresnel(dot(pbr_input.N, pbr_input.V)) * SHOWS * (1.0 - dry) * (1.0 - dry), out.color.a);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
