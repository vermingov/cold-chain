// The hall's grid (map.rs Grid, the TS's Grid material plugin), drawn from where each point is in the world and which
// way its face looks, so it is the same measured metre on every surface: lines every 10 cm, 25 cm and a metre, and
// alternate square metres a shade apart. Lines thinner than a pixel fade out rather than shimmer.

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};

fn grid_line(p: vec2<f32>, every: f32, wide: f32) -> f32 {
    let off = abs(fract(p / every + 0.5) - 0.5) * every;
    let px = fwidth(p);
    let on = 1.0 - smoothstep(vec2(wide * 0.5), vec2(wide * 0.5) + px, off);
    return max(on.x, on.y) * (1.0 - smoothstep(every * 0.04, every * 0.12, max(px.x, px.y)));
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    pbr_input.material.base_color = alpha_discard(pbr_input.material.flags, pbr_input.material.alpha_cutoff, pbr_input.material.base_color);
    // (In the TS's world, whose z runs the other way: the squares alternate where they did there.)
    let w = vec3(in.world_position.x, in.world_position.y, -in.world_position.z);
    let facing = abs(in.world_normal);
    var gp = w.xy;
    if facing.y > 0.5 {
        gp = w.xz;
    } else if facing.x > facing.z {
        gp = w.zy;
    }
    let line = max(max(grid_line(gp, 0.1, 0.003) * 0.22, grid_line(gp, 0.25, 0.005) * 0.4), grid_line(gp, 1.0, 0.012) * 0.75);
    let square = floor(gp + 0.0001);
    let parity = (square.x + square.y) - 2.0 * floor((square.x + square.y) / 2.0);
    let shade = (1.0 + 0.05 * (parity * 2.0 - 1.0)) * (1.0 - line);
    pbr_input.material.base_color = vec4(pbr_input.material.base_color.rgb * shade, pbr_input.material.base_color.a);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
