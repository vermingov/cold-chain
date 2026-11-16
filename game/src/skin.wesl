// A person's skin, clothes, hair and brows as hurt has left them (skin.rs `Flesh`): Bevy's standard material with what
// the TS's material plugins drew over it, in their order: the ring a slow bullet scraped (marks.ts's skin sheet), the
// bruising and swelling (bruise.ts BruiseLayer), the wounds (marks.ts Gore), the blood lying on the skin (film.ts
// FilmLayer), and what is not drawn at all: holes in the clothes, openings torn through the skin, the skin under the
// clothes everywhere but where a hole shows it (hider.ts).
//
// The vertex shader is Bevy's skinned one with the swelling put in first: each corner moved out by it (and by the bone
// under it, broken) before the skeleton moves it, and its normal tipped by the swelling's slope.

import bevy_pbr::render::{
    mesh_bindings::mesh,
    mesh_functions,
    skinning,
    view_transformations::position_world_to_clip,
    forward_io::{VertexOutput, FragmentOutput},
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
};
import cold_chain::fluid::stained;

// info: how this part is drawn (skin.rs SKIN, UNDER, CLOTH, CARRIED) and its first corner in the body.
@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> info: vec4<u32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(101) var wounds: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(102) var sheet_sampler: sampler;
@group(constants::MATERIAL_BIND_GROUP) @binding(103) var film: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(104) var table: texture_2d<f32>;
// A dressing's picture (dressing.rs): metres across and up it and where its corner is; how far the blood in it has
// spread (m), how dry it is, and two phases for its uneven edge.
@group(constants::MATERIAL_BIND_GROUP) @binding(105) var<uniform> picture: vec4<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(106) var<uniform> stain: vec4<f32>;
// The blood in the clothes (soak.rs): its field over the person at rest, the field's corner and one over its size.
@group(constants::MATERIAL_BIND_GROUP) @binding(107) var soak_field: texture_3d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(108) var soak_sampler: sampler;
@group(constants::MATERIAL_BIND_GROUP) @binding(109) var<uniform> soak_origin: vec4<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(110) var<uniform> soak_scale: vec4<f32>;

const SKIN: u32 = 0u;
const UNDER: u32 = 1u;
const CLOTH: u32 = 2u;
const CARRIED: u32 = 3u;
const GAUZE: u32 = 4u;
const WIDE: u32 = 1024u;
const CORNERS: u32 = 8u;
const TEXEL: f32 = 1.0 / 2048.0;
const MOST_MM: f32 = 0.6;

fn texel(row: u32, k: u32) -> vec4<f32> {
    return textureLoad(table, vec2<u32>(k, row), 0);
}

fn corner(v: u32, k: u32) -> vec4<f32> {
    let i = v * 3u + k;
    return textureLoad(table, vec2<u32>(i % WIDE, CORNERS + i / WIDE), 0);
}

struct In {
    @builtin(instance_index) instance_index: u32,
    @builtin(vertex_index) vertex_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @if(SKINNED)
    @location(6) joint_indices: vec4<u32>,
    @if(SKINNED)
    @location(7) joint_weights: vec4<f32>,
}

struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) world_position: vec4<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @if(VERTEX_OUTPUT_INSTANCE_INDEX)
    @location(6) @interpolate(flat) instance_index: u32,
    // Where this point of the body is at rest (what the openings and blows are kept in), and its bruise's tint.
    @location(8) rest: vec3<f32>,
    @location(9) tint: vec4<f32>,
}

@vertex
fn vertex(in: In) -> Out {
    var out: Out;
    let v = info.y + (in.vertex_index - mesh[in.instance_index].first_vertex_index);
    let tint = corner(v, 0u);
    var position = in.position + corner(v, 1u).xyz;
    var normal = in.normal;
    if info.x == SKIN || info.x == UNDER {
        normal = normalize(normal + corner(v, 2u).xyz);
    }
@if(SKINNED) {
    let world_from_local = skinning::skin_model(in.joint_indices, in.joint_weights, in.instance_index);
    out.world_normal = skinning::skin_normals(world_from_local, normal);
    out.world_position = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(position, 1.0));
}
@else {
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    out.world_normal = mesh_functions::mesh_normal_local_to_world(normal, in.instance_index);
    out.world_position = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(position, 1.0));
}
    out.position = position_world_to_clip(out.world_position.xyz);
    out.uv = in.uv;
@if(VERTEX_OUTPUT_INSTANCE_INDEX)
    out.instance_index = in.instance_index;
    out.rest = in.position;
    out.tint = tint;
    return out;
}

// --- noise ----------------------------------------------------------------------------------------------------------

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// (marks.ts goreNoise: lips that are not ruled lines)
fn noise2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

fn hash3(p: vec3<f32>, k: vec3<f32>) -> f32 {
    return fract(sin(dot(p, k)) * 43758.5453);
}

// Smooth noise over rest space (hider.ts hiderNoise with `k` (12.9898, 78.233, 37.719); bruise.ts bruiseNoise with
// (41.3, 289.1, 113.7)).
fn noise3(p: vec3<f32>, k: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i, k), hash3(i + vec3(1.0, 0.0, 0.0), k), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0), k), hash3(i + vec3(1.0, 1.0, 0.0), k), f.x), f.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0), k), hash3(i + vec3(1.0, 0.0, 1.0), k), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0), k), hash3(i + vec3(1.0, 1.0, 1.0), k), f.x), f.y),
        f.z);
}

const HIDER: vec3<f32> = vec3(12.9898, 78.233, 37.719);
const BRUISE: vec3<f32> = vec3(41.3, 289.1, 113.7);

fn to_linear(c: vec3<f32>) -> vec3<f32> {
    return pow(c, vec3(2.2));
}

// The colour of blood over what is under it (fluid.ts GLSL_BLOOD): how much of red, green and blue a millimetre of it
// lets through, and the colour of so much of it that nothing shows through. Fresh, it passes red and stops green and
// blue almost at once: a smear is bright red over the skin, a thick streak dark red. Dried, it is methaemoglobin, brown.
fn blood_over(under: vec3<f32>, mm: f32, wet: f32) -> vec3<f32> {
    let mu = mix(vec3(3.6, 9.0, 10.5), vec3(3.0, 24.0, 28.0), wet);
    let deep = mix(vec3(0.03, 0.01, 0.0065), vec3(0.075, 0.004, 0.0035), wet);
    let through = exp(-mu * 2.0 * mm);
    return under * through + deep * (1.0 - through);
}

// --- what is not drawn (hider.ts) -------------------------------------------------------------------------------------

// Openings in `row` (the clothes' holes and slits, or the skin's torn openings): a slot a.w long either way and b.w wide
// (a lens: the skin either side pulled apart by its tension, round when as wide as long), or a round hole with a frayed
// edge (b.w below nothing).
fn holed(rest: vec3<f32>, row: u32, count: u32) -> bool {
    for (var i = 0u; i < count; i++) {
        let a = texel(row, i * 3u);
        let b = texel(row, i * 3u + 1u);
        let c = texel(row, i * 3u + 2u);
        let d = rest - a.xyz;
        if abs(dot(d, c.xyz)) >= c.w {
            continue;
        }
        let across = cross(b.xyz, c.xyz);
        let on = vec2(dot(d, b.xyz), dot(d, across));
        if b.w < 0.0 {
            // (frayed: the edge of a hole in cloth wanders with the weave, not in a pattern)
            if length(on) < a.w * (0.7 + 0.45 * noise3(rest * 900.0, HIDER) + 0.15 * noise3(rest * 3000.0, HIDER)) {
                return true;
            }
        } else {
            let along = clamp(abs(on.x) / a.w, 0.0, 1.0);
            let lens = 0.5 + 0.5 * clamp((a.w / b.w - 1.0) * 0.5, 0.0, 1.0);
            if abs(on.y) < b.w * pow(max(1.0 - along * along, 0.0), lens) * (0.92 + 0.16 * noise3(rest * 260.0, HIDER)) {
                return true;
            }
        }
    }
    return false;
}

// --- the bruise (bruise.ts GLSL_BRUISE) ---------------------------------------------------------------------------------

// Haemoglobin under the skin takes out green and blue far more than red, so a little blood near the surface is
// red-purple; deeper, and as it loses its oxygen, it takes more red and leaves blue, going purple to blue-black. Redness
// is opened vessels: more red, less green. Blotchy, with an uneven edge and pinpoint bleeds round a fresh one. A bat's
// two bands with the pale strip between, and a hard blow's blanched middle, are drawn from the last few blows' shapes.
fn bruised(albedo: vec3<f32>, bt: vec4<f32>, rest: vec3<f32>) -> vec4<f32> {
    let head = texel(0u, 0u);
    let now = head.x;
    let records = u32(head.y);
    var pat = 0.0;
    var pale = 0.0;
    for (var i = 0u; i < records; i++) {
        let at = texel(0u, 2u + i * 3u);
        let axis = texel(0u, 3u + i * 3u);
        let face = texel(0u, 4u + i * 3u);
        let d = rest - at.xyz;
        let rc = at.w;
        if dot(d, d) > 16.0 * rc * rc {
            continue;
        }
        let n = face.xyz;
        let off = dot(d, n);
        if abs(off) > 1.5 * rc + 0.01 {
            continue;
        }
        let fl = d - n * off;
        let age = now - face.w;
        var q = 0.0;
        var mid = 0.0;
        if axis.w > 1.5 {
            // Tramlines: the bat's line across the skin, bands either side of it.
            let ac = normalize(cross(axis.xyz, n));
            let u = abs(dot(fl, ac)) / rc + (noise3(rest * 700.0, BRUISE) - 0.5) * 0.25;
            let v = abs(dot(fl, axis.xyz)) / (rc * 3.5);
            let ends = 1.0 - smoothstep(0.55, 1.0, v);
            mid = exp(-u * u / 0.3) * ends;
            q = (exp(-(u - 1.15) * (u - 1.15) / 0.1) - mid) * ends;
        } else {
            let r = length(fl) / rc + (noise3(rest * 500.0, BRUISE) - 0.5) * 0.3;
            mid = 1.0 - smoothstep(0.3, 0.7, r);
            q = exp(-(r - 0.9) * (r - 0.9) / 0.06) - mid;
        }
        pat += q * exp(-age / 480.0);
        pale = max(pale, mid * exp(-age / 6.0));
    }
    let n1 = noise3(rest * 160.0, BRUISE);
    let n2 = noise3(rest * 1400.0, BRUISE);
    let n3 = noise3(rest * 48.0, BRUISE);
    var b = bt.y * clamp(1.0 + pat * 0.85, 0.3, 2.2) * (0.62 + 0.5 * n3 + 0.3 * (n1 - 0.5));
    // The dermis full of blood is as dark as a bruise gets: blood under that does not show through it.
    b = 0.8 * (1.0 - exp(-b / 0.8));
    // A thin edge shows only in places; pinpoint bleeds round a fresh one.
    b = max(0.0, b - 0.07 * (1.0 - n1));
    b += step(0.92, n2) * smoothstep(0.08, 0.2, bt.y) * (1.0 - smoothstep(0.3, 0.7, bt.y)) * 0.3 * (1.0 - smoothstep(0.2, 0.6, bt.z));
    let absorb = mix(vec3(1.2, 2.4, 2.0), vec3(2.0, 2.1, 1.25), bt.z);
    var c = albedo * exp(-absorb * b);
    let ery = clamp(bt.x * clamp(1.0 + pat * 0.5, 0.0, 1.6) * (1.0 - 0.9 * pale) * (0.8 + 0.4 * n3), 0.0, 1.0);
    c *= mix(vec3(1.0), vec3(1.1, 0.56, 0.6), ery);
    c = mix(c, c * 1.12 + 0.01, pale * 0.6);
    // Skin stretched over a swelling is tight and shines.
    return vec4(c, smoothstep(0.25, 1.2, bt.w) * 0.15);
}

// --- a dressing (dressing.ts _picture and _paint) ----------------------------------------------------------------------

fn line(d: f32, wide: f32) -> f32 {
    return 1.0 - smoothstep(wide * 0.5, wide * 0.5 + 0.0004, abs(d));
}

// What the gauze is at (x, y) metres on it: its colour (sRGB) and whether there is gauze there (alpha).
fn gauze_picture(x: f32, y: f32, pad: bool) -> vec4<f32> {
    let speck = hash2(floor(vec2(x, y) / 0.0008));
    var c = vec3(0.0);
    var a = 0.0;
    if pad {
        // The pad: folded gauze, its weave in a 1.5 mm grid, the fold lines a third of the way in, a seam round it.
        let side = -picture.z / 1.6;
        let k = side / 0.05;
        let q = abs(vec2(x, y)) - vec2(side - 0.004);
        let inside = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.004;
        if inside < 0.0 {
            a = 1.0;
            c = vec3(236.0, 234.0, 227.0) / 255.0;
            let weave = max(line(fract(x / 0.0015 + 0.5) - 0.5, 0.2), line(fract(y / 0.0015 + 0.5) - 0.5, 0.2));
            c = mix(c, vec3(150.0, 145.0, 135.0) / 255.0, 0.25 * weave);
            let fold = max(line(abs(x) - side / 3.0, 0.0012), line(max(abs(x), abs(y)) - (side - 0.003), 0.0012));
            c = mix(c, vec3(120.0, 115.0, 105.0) / 255.0, 0.35 * fold);
        }
        // Two strips of tape over its top and bottom edges, torn off the roll at their ends.
        for (var s = 0; s < 2; s++) {
            let y0 = select(-side - 0.012 * k, side - 0.012 * k, s == 1);
            let t = (y - y0) / (0.024 * k);
            let jag = 0.002 * (1.0 - 2.0 * abs(fract(t * 2.0) - 0.5));
            if t > 0.0 && t < 1.0 && abs(x) < 0.074 * k + jag {
                a = 1.0;
                c = vec3(226.0, 221.0, 206.0) / 255.0;
                c = mix(c, vec3(160.0, 150.0, 130.0) / 255.0, 0.25 * step(0.6, fract(x / 0.003)) * step(abs(t - 0.48), 0.04));
            }
        }
    } else {
        // The roll: wound round with each turn half over the last, so the edge of a turn crosses the band on a slant and
        // comes round to meet the next; its crinkle square to the way it was wound.
        let top = picture.w + picture.y - 0.015 + sin(x * 400.0) * 0.0008;
        let bottom = picture.w + 0.015 + sin(x * 330.0 + 1.0) * 0.0008;
        if y > bottom && y < top {
            a = 1.0;
            c = vec3(240.0, 239.0, 233.0) / 255.0;
            let crinkle = hash2(vec2(floor(x / 0.002), 3.0));
            c = mix(c, select(vec3(140.0, 135.0, 125.0) / 255.0, vec3(1.0), crinkle > 0.5), select(0.18, 0.3, crinkle > 0.5) * line(fract(x / 0.002 + 0.5) - 0.5, 0.2) );
            let pitch = 0.05;
            let s = y - (x - picture.z) / picture.x * pitch;
            let m = s - floor(s / pitch) * pitch;
            c = mix(c, vec3(95.0, 90.0, 80.0) / 255.0, 0.32 * line(m, 0.0016));
            c = mix(c, vec3(1.0), 0.4 * line(m - 0.0018, 0.0016));
        }
    }
    c = mix(c, select(vec3(120.0, 115.0, 105.0) / 255.0, vec3(1.0), speck > 0.5), select(0.12, 0.35, speck > 0.5) * step(0.85, hash2(floor(vec2(x, y) / 0.0008) + 7.0)));
    return vec4(c, a);
}

// The blood in it, as far as it has spread round the wound: darkest in the middle where the gauze is full, a paler fringe
// where only serum has wicked ahead, browner as it dries. Multiplied into the gauze.
fn gauze_blood(x: f32, y: f32) -> vec3<f32> {
    let r = stain.x;
    if r < 0.002 {
        return vec3(1.0);
    }
    let dry = stain.y;
    let core = mix(vec3(118.0, 10.0, 12.0), vec3(72.0, 24.0, 17.0), dry) / 255.0;
    let rim = mix(vec3(160.0, 26.0, 26.0), vec3(100.0, 38.0, 26.0), dry) / 255.0;
    let serum = mix(vec3(226.0, 170.0, 158.0), vec3(200.0, 165.0, 140.0), dry) / 255.0;
    var out = vec3(1.0);
    // (Round the wound, and again a turn either way round a limb, so a stain past the seam comes round.)
    for (var k = -1; k <= 1; k++) {
        let px = x + f32(k) * picture.x * select(1.0, 0.0, info.z == 1u);
        let t = atan2(y, px);
        let edge = 1.0 + 0.12 * sin(3.0 * t + stain.z) + 0.07 * sin(5.0 * t + stain.w) + 0.04 * sin(9.0 * t + stain.z * 1.7);
        let d = length(vec2(px, y));
        if d > r * 1.1 * edge {
            continue;
        }
        let g = d / (r * 1.25);
        var c = core;
        if g > 0.55 {
            c = mix(core, rim, smoothstep(0.55, 0.75, g));
        }
        if g > 0.75 {
            c = mix(rim, serum, smoothstep(0.75, 0.86, g));
        }
        if g > 0.86 {
            c = mix(serum, vec3(1.0), smoothstep(0.86, 1.0, g));
        }
        out = min(out, c);
    }
    return out;
}

@fragment
fn fragment(in: Out, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    let mode = info.x;
    let head = texel(0u, 0u);
    let counts = texel(0u, 1u);
    let rest = in.rest;
    // What is not there: holes in the clothes, the skin torn open, and the skin under the clothes but where a hole
    // shows it.
    if mode == CLOTH && holed(rest, 1u, u32(head.z)) {
        discard;
    }
    if (mode == SKIN || mode == UNDER) && holed(rest, 2u, u32(head.w)) {
        discard;
    }
    if mode == UNDER && is_front {
        var seen = false;
        for (var i = 0u; i < u32(counts.x); i++) {
            let a = texel(3u, i * 2u);
            let b = texel(3u, i * 2u + 1u);
            let d = rest - a.xyz;
            if abs(dot(d, b.xyz)) < b.w && length(d - b.xyz * dot(d, b.xyz)) < a.w {
                seen = true;
                break;
            }
        }
        if !seen {
            discard;
        }
    }
    // The body's inside is seen only through an opening right through its wall: near one, and nowhere else.
    let inside = (mode == SKIN || mode == UNDER) && !is_front;
    if inside {
        var near = false;
        for (var i = 0u; i < u32(head.w); i++) {
            let a = texel(2u, i * 3u);
            if texel(2u, i * 3u + 1u).w >= 0.0 && distance(rest, a.xyz) < a.w + 0.3 {
                near = true;
                break;
            }
        }
        if !near {
            discard;
        }
    }

    var vo: VertexOutput;
    vo.position = in.position;
    vo.world_position = in.world_position;
    vo.world_normal = in.world_normal;
    vo.uv = in.uv;
@if(VERTEX_OUTPUT_INSTANCE_INDEX)
    vo.instance_index = in.instance_index;
    var pbr = pbr_input_from_standard_material(vo, is_front);
    pbr.material.base_color = alpha_discard(pbr.material.flags, pbr.material.alpha_cutoff, pbr.material.base_color);
    var albedo = pbr.material.base_color.rgb;
    var rough = pbr.material.perceptual_roughness;
    var n = pbr.N;
    // A wet layer over it (blood on the skin, a wound's wet face): how much of one, how rough, its surface's normal.
    var gloss = 0.0;
    var gloss_rough = 0.1;
    var film_n = n;

    if mode == GAUZE {
        let x = picture.z + in.uv.x * picture.x;
        let y = picture.w + in.uv.y * picture.y;
        let g = gauze_picture(x, y, info.z == 1u);
        if g.a < 0.5 {
            discard;
        }
        albedo = to_linear(g.rgb * gauze_blood(x, y));
    }

    if mode == CLOTH {
        // Round a bullet's hole in cloth the fibres it dragged in are blackened (its wipe), raggedly, further round the
        // way out (marks.ts's cloth sheet and hider.ts's scorch).
        var scorched = 0.0;
        for (var i = 0u; i < u32(head.z); i++) {
            let a = texel(1u, i * 3u);
            let b = texel(1u, i * 3u + 1u);
            let c = texel(1u, i * 3u + 2u);
            if b.w >= 0.0 {
                continue;
            }
            let d = rest - a.xyz;
            // (Only the cloth the hole is in: its axis runs on through the body, and out through the other side.)
            if abs(dot(d, c.xyz)) >= c.w {
                continue;
            }
            let r = length(d - c.xyz * dot(d, c.xyz)) / a.w;
            scorched = max(scorched, 1.0 - smoothstep(1.0, 1.35, r));
            let jag = select(0.25, 0.45, b.w < -1.5);
            let wipe = select(1.1, 1.4, b.w < -1.5) * (1.0 - jag / 2.0 + jag * noise3(rest * 700.0, HIDER));
            scorched = max(scorched, (1.0 - smoothstep(wipe - 0.05, wipe, r)) * 1.14);
        }
        albedo = mix(albedo, vec3(0.02, 0.012, 0.01), min(1.0, scorched * 0.85));
        // The blood in it (soak.rs, fluid.wesl `stained`), shining where it stands on the cloth.
        let soaked = stained(albedo, rest, soak_field, soak_sampler, soak_origin.xyz, soak_scale.xyz);
        albedo = soaked.rgb;
        rough = 1.0 - mix(1.0 - rough, 0.6, soaked.a);
    }

    if mode == SKIN || mode == UNDER {
        let uv = in.uv;
        let dp1 = dpdx(in.world_position.xyz);
        let dp2 = dpdy(in.world_position.xyz);
        let du1 = dpdx(uv);
        let du2 = dpdy(uv);
        // The skin's own directions across its picture, from how both change across the screen.
        let q2 = cross(dp2, n);
        let q1 = cross(n, dp1);
        let gt = q2 * du1.x + q1 * du2.x;
        let gb = q2 * du1.y + q1 * du2.y;
        let gs = inverseSqrt(max(dot(gt, gt), dot(gb, gb)) + 1e-20);
        let gm = textureSampleLevel(wounds, sheet_sampler, uv, 0.0);

        // The ring of skin a slow bullet scraped going in: red-brown, a darker band inside it.
        if gm.b > 0.004 {
            albedo = mix(albedo, to_linear(vec3(120.0, 52.0, 38.0) / 255.0), 0.85 * clamp(gm.b / 0.6, 0.0, 1.0));
            albedo = mix(albedo, to_linear(vec3(95.0, 30.0, 24.0) / 255.0), 0.9 * clamp((gm.b - 0.6) / 0.4, 0.0, 1.0));
        }

        // Bruising and redness, and the shine of skin stretched over a swelling.
        let bt = in.tint;
        if bt.x + bt.y + bt.w > 0.0005 || u32(head.y) > 0u {
            let b = bruised(albedo, bt, rest);
            albedo = b.rgb;
            rough = mix(rough, 0.2, b.a);
        }

        // The wounds (marks.ts Gore). The skin is never cut away: where the sheet says the flesh is open, what is there
        // is drawn: the skin's cut edge, yellow fat, the white sheath, red muscle going dark with depth, and blood in the
        // bottom; and the surface's normal bends down the walls, so light falls into a wound, its far wall lit and its
        // near wall in shadow.
        var wet = 0.0;
        if gm.r > 0.004 || gm.g > 0.004 {
            let hx = textureSampleLevel(wounds, sheet_sampler, uv + vec2(TEXEL, 0.0), 0.0).r - textureSampleLevel(wounds, sheet_sampler, uv - vec2(TEXEL, 0.0), 0.0).r;
            let hy = textureSampleLevel(wounds, sheet_sampler, uv + vec2(0.0, TEXEL), 0.0).r - textureSampleLevel(wounds, sheet_sampler, uv - vec2(0.0, TEXEL), 0.0).r;
            n = normalize(n + (gt * gs * hx + gb * gs * hy) * 6.0);
            // Depth in millimetres, made uneven so that the layers wander along a lip as real ones do: by a few
            // millimetres over a centimetre or two, by a millimetre over a few. (Added, and smooth: a fine noise
            // multiplying it threw the deep side of a lip across the thresholds cell by cell, black specks.)
            let texel_step = max(max(abs(du1.x), abs(du2.x)), max(abs(du1.y), abs(du2.y)));
            let gmid = clamp(1.6 - texel_step * 900.0, 0.0, 1.0);
            let glob = clamp(1.6 - texel_step * 700.0, 0.0, 1.0);
            let d0 = gm.r * 40.0;
            let d = d0 + ((noise2(uv * 110.0) - 0.5) * 5.0 + (mix(0.5, noise2(uv * 900.0), gmid) - 0.5) * 1.2) * clamp(d0 / 4.0, 0.0, 1.0);
            // Fat bulging from a cut face in lobules of a few millimetres, the hollows between them deeper yellow.
            let lob = mix(0.5, noise2(uv * 350.0 + 5.0) * 0.65 + noise2(uv * 800.0 + 9.0) * 0.35, glob);
            let in_fat = smoothstep(1.6, 3.0, d) * (1.0 - smoothstep(8.5, 10.0, d));
            // Fat at a fresh cut is a pale cream to light yellow, never orange (dev/research/wounds.md sec. 0).
            let fat = mix(vec3(0.82, 0.70, 0.48), vec3(0.93, 0.86, 0.66), smoothstep(0.3, 0.7, lob));
            // Torn muscle: bundles of fibres running one way, ragged, darker between them.
            let muscle = vec3(0.44, 0.09, 0.07) * (0.7 + 0.5 * mix(0.5, noise2(uv * vec2(180.0, 1400.0) + 2.0), gmid));
            // The skin's cut edge, rolled a little outward, paler at its rim.
            var flesh = mix(vec3(0.66, 0.42, 0.36), vec3(0.5, 0.17, 0.15), smoothstep(0.4, 1.3, d));
            flesh = mix(flesh, fat, smoothstep(1.6, 3.0, d));
            flesh = mix(flesh, vec3(0.68, 0.62, 0.56), smoothstep(9.5, 11.0, d));
            flesh = mix(flesh, muscle, smoothstep(11.0, 12.5, d));
            flesh = mix(flesh, vec3(0.08, 0.005, 0.004), smoothstep(16.0, 30.0, d));
            albedo = mix(albedo, to_linear(flesh), smoothstep(0.1, 0.9, d));
            // The lobules stand out of the face: the light catches their tops.
            let lx = noise2((uv + vec2(TEXEL, 0.0)) * 350.0 + 5.0) - noise2((uv - vec2(TEXEL, 0.0)) * 350.0 + 5.0);
            let ly = noise2((uv + vec2(0.0, TEXEL)) * 350.0 + 5.0) - noise2((uv - vec2(0.0, TEXEL)) * 350.0 + 5.0);
            n = normalize(n + (gt * gs * lx + gb * gs * ly) * 1.5 * in_fat * glob);
            // Blood fills a fresh wound from the bottom and wells over its lips; on a cut face it lies in the hollows,
            // in patches a few millimetres across, thick here and thin there.
            let patches = mix(0.5, noise2(uv * 90.0 + 3.0), glob);
            var blood = gm.g * (0.5 + 0.5 * smoothstep(0.0, 3.0, d)) * (0.85 + 0.3 * mix(0.5, noise2(uv * 400.0), gmid)) * (0.55 + 0.9 * patches);
            blood += smoothstep(0.42, 0.22, lob) * 0.55 * smoothstep(1.5, 4.0, d) * smoothstep(0.0, 0.03, gm.g);
            albedo = mix(albedo, to_linear(vec3(0.36, 0.025, 0.02)), clamp(blood, 0.0, 0.93));
            albedo *= 1.0 - 0.6 * smoothstep(3.0, 30.0, d);
            // Cut flesh is wet: a soft sheen on it, and more where blood lies.
            wet = max(smoothstep(0.3, 1.5, d), clamp(blood, 0.0, 1.0));
            rough = mix(rough, 0.28, wet);
            gloss = wet * 0.7;
            gloss_rough = 0.12;
            film_n = n;
        }

        // Blood lying on the skin (film.ts): its edges stand off the skin, its surface bending with how its thickness
        // changes; it lets red through and stops green and blue, so a smear is bright red and a thick streak nearly
        // black-red; glossy while wet, brown and dull as it dries.
        let fm = textureSampleLevel(film, sheet_sampler, uv, 0.0);
        let fmm = fm.r * MOST_MM;
        if fmm > 0.003 {
            let fx = textureSampleLevel(film, sheet_sampler, uv + vec2(TEXEL, 0.0), 0.0).r - textureSampleLevel(film, sheet_sampler, uv - vec2(TEXEL, 0.0), 0.0).r;
            let fy = textureSampleLevel(film, sheet_sampler, uv + vec2(0.0, TEXEL), 0.0).r - textureSampleLevel(film, sheet_sampler, uv - vec2(0.0, TEXEL), 0.0).r;
            // Wet, it is a layer of liquid over the skin: the light off its own surface (Bevy's clearcoat, with the
            // film's own normal) over the skin seen through it; drying, a dull satin.
            let cover = smoothstep(0.003, 0.05, fmm);
            film_n = normalize(n - (gt * gs * fx + gb * gs * fy) * 5.0 * fm.g);
            albedo = blood_over(albedo, fmm, fm.g);
            rough = mix(rough, mix(0.45, 0.3, fm.g), cover);
            gloss = max(gloss, cover * mix(0.3, 1.0, fm.g));
            gloss_rough = mix(0.32, 0.05, fm.g);
        }
    }

    if inside {
        // The body's wall from inside: muscle under its glistening lining.
        let n1 = noise3(rest * 30.0, HIDER);
        let n2 = noise3(rest * 110.0, HIDER);
        albedo = mix(vec3(0.14, 0.016, 0.012), vec3(0.26, 0.04, 0.032), n1 * 0.75 + n2 * 0.25);
        rough = 0.3;
    }

    pbr.material.base_color = vec4(albedo, pbr.material.base_color.a);
    pbr.material.perceptual_roughness = rough;
    pbr.N = n;
    // (The skin's materials carry a trace of clearcoat so that Bevy lights the layer at all: skin.rs.)
    pbr.material.clearcoat = gloss;
    pbr.material.clearcoat_perceptual_roughness = gloss_rough;
    pbr.clearcoat_N = film_n;
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr);
    out.color = main_pass_post_lighting_processing(pbr, out.color);
    return out;
}
