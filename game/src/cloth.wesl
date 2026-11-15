// Clothes with blood in them (soak.rs Cloth, the TS's hider.ts HIDER_SOAK): a stain whose edge is the weave's, red where
// a little has wicked in and dark where the cloth is full, wet-dark and with a sheen where blood stands on it, drying
// brown with a darker tide line at its edge. The field (soak.wesl) is kept over the person at rest, so each point is
// looked up by where it is on the body at rest, which the vertex stage passes on beside Bevy's own outputs.

import bevy_pbr::render::{
    mesh_functions,
    skinning,
    forward_io::{Vertex, VertexOutput, FragmentOutput, decompress_vertex},
    view_transformations::position_world_to_clip,
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
};
import cold_chain::fluid::{blood_over, noise3};

@group(3) @binding(100) var soak_field: texture_3d<f32>;
@group(3) @binding(101) var soak_sampler: sampler;
// The field's corner in rest space, and one over its size.
@group(3) @binding(102) var<uniform> soak_origin: vec4<f32>;
@group(3) @binding(103) var<uniform> soak_scale: vec4<f32>;

const OVER: f32 = 1.3;

// Bevy's VertexOutput (forward_io.wesl), and the point at rest.
struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) world_position: vec4<f32>,
    @location(1) world_normal: vec3<f32>,
    @if(VERTEX_UVS_A)
    @location(2) uv: vec2<f32>,
    @if(VERTEX_UVS_B)
    @location(3) uv_b: vec2<f32>,
    @if(VERTEX_TANGENTS)
    @location(4) world_tangent: vec4<f32>,
    @if(VERTEX_COLORS)
    @location(5) color: vec4<f32>,
    @if(VERTEX_OUTPUT_INSTANCE_INDEX)
    @location(6) @interpolate(flat) instance_index: u32,
    @if(VISIBILITY_RANGE_DITHER)
    @location(7) @interpolate(flat) visibility_range_dither: i32,
    @location(8) rest: vec3<f32>,
}

// Bevy's mesh.wesl vertex stage (less morph targets, which no person has).
@vertex
fn vertex(vertex_in: Vertex) -> Out {
    var out: Out;
    let vertex = decompress_vertex(vertex_in, vertex_in.instance_index);
    let mesh_world_from_local = mesh_functions::get_world_from_local(vertex_in.instance_index);
@if(SKINNED)
    var world_from_local = skinning::skin_model(vertex.joint_indices, vertex.joint_weights, vertex_in.instance_index);
@else
    var world_from_local = mesh_world_from_local;
@if(SKINNED)
    out.world_normal = skinning::skin_normals(world_from_local, vertex.normal);
@else
    out.world_normal = mesh_functions::mesh_normal_local_to_world(vertex.normal, vertex_in.instance_index);
    out.world_position = mesh_functions::mesh_position_local_to_world(world_from_local, vec4<f32>(vertex.position, 1.0));
    out.position = position_world_to_clip(out.world_position.xyz);
@if(VERTEX_UVS_A)
    out.uv = vertex.uv;
@if(VERTEX_UVS_B)
    out.uv_b = vertex.uv_b;
@if(VERTEX_TANGENTS)
    out.world_tangent = mesh_functions::mesh_tangent_local_to_world(world_from_local, vertex.tangent, vertex_in.instance_index);
@if(VERTEX_COLORS)
    out.color = vertex.color;
@if(VERTEX_OUTPUT_INSTANCE_INDEX)
    out.instance_index = vertex_in.instance_index;
@if(VISIBILITY_RANGE_DITHER)
    out.visibility_range_dither = mesh_functions::get_visibility_range_dither_level(vertex_in.instance_index, mesh_world_from_local[3]);
    out.rest = vertex.position;
    return out;
}

// The field read as a cubic B-spline (eight trilinear reads, after Sigg and Hadwiger) rather than straight between
// cubes: a stain's edge comes out a smooth curve, not the grid's 8 mm steps.
fn soak_read(u: vec3<f32>) -> vec4<f32> {
    let size = vec3<f32>(textureDimensions(soak_field));
    let t = u * size - 0.5;
    let i = floor(t);
    let f = t - i;
    let f2 = f * f;
    let f3 = f2 * f;
    let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    let w3 = f3 / 6.0;
    let g1 = w2 + w3;
    let a = (i - 0.5 + w1 / (w0 + w1)) / size;
    let b = (i + 1.5 + w3 / g1) / size;
    let r = soak_field;
    let s = soak_sampler;
    return mix(
        mix(mix(textureSampleLevel(r, s, vec3(a.x, a.y, a.z), 0.0), textureSampleLevel(r, s, vec3(b.x, a.y, a.z), 0.0), g1.x),
            mix(textureSampleLevel(r, s, vec3(a.x, b.y, a.z), 0.0), textureSampleLevel(r, s, vec3(b.x, b.y, a.z), 0.0), g1.x), g1.y),
        mix(mix(textureSampleLevel(r, s, vec3(a.x, a.y, b.z), 0.0), textureSampleLevel(r, s, vec3(b.x, a.y, b.z), 0.0), g1.x),
            mix(textureSampleLevel(r, s, vec3(a.x, b.y, b.z), 0.0), textureSampleLevel(r, s, vec3(b.x, b.y, b.z), 0.0), g1.x), g1.y), g1.z);
}

@fragment
fn fragment(o: Out, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var in: VertexOutput;
    in.position = o.position;
    in.world_position = o.world_position;
    in.world_normal = o.world_normal;
@if(VERTEX_UVS_A)
    in.uv = o.uv;
@if(VERTEX_UVS_B)
    in.uv_b = o.uv_b;
@if(VERTEX_TANGENTS)
    in.world_tangent = o.world_tangent;
@if(VERTEX_COLORS)
    in.color = o.color;
@if(VERTEX_OUTPUT_INSTANCE_INDEX)
    in.instance_index = o.instance_index;
@if(VISIBILITY_RANGE_DITHER)
    in.visibility_range_dither = o.visibility_range_dither;
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    let rest = o.rest;
    // The grid is 8 mm: read it a little off where this point is, by a smooth noise, so that a stain's edge wanders as
    // the weave makes it and does not follow the grid.
    let sp = rest + (vec3(noise3(rest * 55.0), noise3(rest * 55.0 + 17.0), noise3(rest * 55.0 + 31.0)) - 0.5) * 0.014;
    let sk = soak_read((sp - soak_origin.xyz) * soak_scale.xyz);
    let full = sk.r * sk.r * OVER;
    if full > 0.002 {
        let albedo = pbr_input.material.base_color.rgb;
        let n1 = noise3(rest * 160.0);
        let n2 = noise3(rest * 420.0);
        // Where the cloth has drunk blood its fibres are full of it; past its edge they are dry. A little that reached a
        // dry patch (a mist, a fleck) shows as specks where fibres caught it.
        var cover = smoothstep(0.14, 0.26, full + (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.06);
        cover = max(cover, step(1.0 - full * 3.0, n2) * smoothstep(0.004, 0.03, full));
        let wet = sk.g;
        let mm = clamp(full, 0.15, 1.0) * 0.55 * (0.8 + 0.4 * n1);
        var stained = blood_over(albedo * mix(1.0, 0.8, wet), mm, wet);
        // Drying, blood is drawn to the edge of the stain and leaves it darker there (a tide line).
        let rim = smoothstep(0.14, 0.2, full) * (1.0 - smoothstep(0.22, 0.4, full)) * (1.0 - wet);
        stained = mix(stained, blood_over(albedo, mm + 0.3, 0.0), rim * 0.7);
        pbr_input.material.base_color = vec4(mix(albedo, stained, cover), pbr_input.material.base_color.a);
        // Where blood stands on it, it shines as blood does.
        let gloss = cover * smoothstep(1.0, 1.25, full) * wet;
        pbr_input.material.perceptual_roughness = 1.0 - mix(1.0 - pbr_input.material.perceptual_roughness, 0.6, gloss);
    }
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
