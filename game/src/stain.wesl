// The marks blood leaves on the room (blood.rs Stain): the splash sheet's stain, coloured by how long it has lain (the
// mark's vertex colour, wet red to dried brown, as the TS's), and matte as it dries (its second UV: how dry), where the
// TS's stayed as glossy as when it fell.

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    pbr_input.material.base_color = alpha_discard(pbr_input.material.flags, pbr_input.material.alpha_cutoff, pbr_input.material.base_color);
@if(VERTEX_UVS_B)
    pbr_input.material.perceptual_roughness = mix(0.1, 0.6, in.uv_b.x);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
