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

// info: how this part is drawn (skin.rs SKIN, UNDER, CLOTH, CARRIED) and its first corner in the body.
@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> info: vec4<u32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(101) var wounds: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(102) var sheet_sampler: sampler;
@group(constants::MATERIAL_BIND_GROUP) @binding(103) var film: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(104) var table: texture_2d<f32>;

const SKIN: u32 = 0u;
const UNDER: u32 = 1u;
const CLOTH: u32 = 2u;
const CARRIED: u32 = 3u;
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
            let r = length(d - c.xyz * dot(d, c.xyz)) / a.w;
            scorched = max(scorched, 1.0 - smoothstep(1.0, 1.35, r));
            let jag = select(0.25, 0.45, b.w < -1.5);
            let wipe = select(1.1, 1.4, b.w < -1.5) * (1.0 - jag / 2.0 + jag * noise3(rest * 700.0, HIDER));
            scorched = max(scorched, (1.0 - smoothstep(wipe - 0.05, wipe, r)) * 1.14);
        }
        albedo = mix(albedo, vec3(0.02, 0.012, 0.01), min(1.0, scorched * 0.85));
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
            let step = max(max(abs(du1.x), abs(du2.x)), max(abs(du1.y), abs(du2.y)));
            let gmid = clamp(1.6 - step * 900.0, 0.0, 1.0);
            let glob = clamp(1.6 - step * 700.0, 0.0, 1.0);
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
            let patch = mix(0.5, noise2(uv * 90.0 + 3.0), glob);
            var blood = gm.g * (0.5 + 0.5 * smoothstep(0.0, 3.0, d)) * (0.85 + 0.3 * mix(0.5, noise2(uv * 400.0), gmid)) * (0.55 + 0.9 * patch);
            blood += smoothstep(0.42, 0.22, lob) * 0.55 * smoothstep(1.5, 4.0, d) * smoothstep(0.0, 0.03, gm.g);
            albedo = mix(albedo, to_linear(vec3(0.36, 0.025, 0.02)), clamp(blood, 0.0, 0.93));
            albedo *= 1.0 - 0.6 * smoothstep(3.0, 30.0, d);
            // Cut flesh is wet: a soft sheen on it, and more where blood lies.
            wet = max(smoothstep(0.3, 1.5, d), clamp(blood, 0.0, 1.0));
            rough = mix(rough, 0.28, wet);
        }

        // Blood lying on the skin (film.ts): its edges stand off the skin, its surface bending with how its thickness
        // changes; it lets red through and stops green and blue, so a smear is bright red and a thick streak nearly
        // black-red; glossy while wet, brown and dull as it dries.
        let fm = textureSampleLevel(film, sheet_sampler, uv, 0.0);
        let fmm = fm.r * MOST_MM;
        if fmm > 0.003 {
            let fx = textureSampleLevel(film, sheet_sampler, uv + vec2(TEXEL, 0.0), 0.0).r - textureSampleLevel(film, sheet_sampler, uv - vec2(TEXEL, 0.0), 0.0).r;
            let fy = textureSampleLevel(film, sheet_sampler, uv + vec2(0.0, TEXEL), 0.0).r - textureSampleLevel(film, sheet_sampler, uv - vec2(0.0, TEXEL), 0.0).r;
            n = normalize(n - (gt * gs * fx + gb * gs * fy) * 5.0 * fm.g);
            albedo = blood_over(albedo, fmm, fm.g);
            rough = mix(rough, 0.06, smoothstep(0.003, 0.05, fmm) * mix(0.3, 1.0, fm.g));
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
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr);
    out.color = main_pass_post_lighting_processing(pbr, out.color);
    return out;
}
