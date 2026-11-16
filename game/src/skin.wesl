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
import cold_chain::fluid::{blood_over, stained};

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
    // How the body at rest is turned into the world here (the skinning's matrix, its three columns): a gunshot wound is
    // kept at rest and looked into from the eye.
    @location(10) m0: vec3<f32>,
    @location(11) m1: vec3<f32>,
    @location(12) m2: vec3<f32>,
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
    out.m0 = world_from_local[0].xyz;
    out.m1 = world_from_local[1].xyz;
    out.m2 = world_from_local[2].xyz;
}
@else {
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    out.world_normal = mesh_functions::mesh_normal_local_to_world(normal, in.instance_index);
    out.world_position = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(position, 1.0));
    out.m0 = world_from_local[0].xyz;
    out.m1 = world_from_local[1].xyz;
    out.m2 = world_from_local[2].xyz;
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

// --- gunshot wounds (marks.rs `entry`, `aimed`, `exit`) -----------------------------------------------------------------
//
// Each is a record in the table's row SHOTS, drawn here as what it is, in millimetres across the skin round it: a height
// field (how far below the skin each place of it lies; an exit's turned-out lips above it) that the eye's ray is followed
// into, so that a hole has walls the light falls down and the near one hides the far, a pool of blood lies level in it,
// and what the ray meets is coloured as what is there (dev/research/wounds.md sec. 4-5, gunshot-blood.md sec. 3).

const SHOTS: u32 = 5u;
const PER_SHOT: u32 = 6u;
const EXIT: f32 = 1.0;
const AGAIN: f32 = 2.0;
const CHARGE: f32 = 3.0;
// How far the eye's ray is followed into a wound (mm), and from how far above the skin (an exit's lips stand out).
const DEEPEST: f32 = 24.0;
const LIPS: f32 = 1.8;
// (Steps down the ray: fewer and a lip's thin crest is stepped over, its slope drawn in terraces.)
const STEPS: i32 = 48;
const SHALLOW: f32 = 0.8;

struct Shot {
    at: vec3<f32>,
    reach: f32,
    ex: vec3<f32>,
    ey: vec3<f32>,
    n: vec3<f32>,
    kind: f32,
    seed: f32,
    prev: u32,
    // What its kind needs (marks.rs); c.w the clock it was made at.
    a: vec4<f32>,
    b: vec4<f32>,
    c: vec4<f32>,
}

fn shot(k: u32) -> Shot {
    let i = 1u + (k - 1u) * PER_SHOT;
    let t0 = texel(SHOTS, i);
    let t1 = texel(SHOTS, i + 1u);
    let t2 = texel(SHOTS, i + 2u);
    var s: Shot;
    s.at = t0.xyz;
    s.reach = t0.w;
    s.ex = t1.xyz;
    s.n = t2.xyz;
    s.ey = cross(t2.xyz, t1.xyz);
    s.kind = floor(t1.w);
    s.seed = fract(t1.w) * 100.0;
    s.prev = u32(t2.w + 0.5);
    s.a = texel(SHOTS, i + 3u);
    s.b = texel(SHOTS, i + 4u);
    s.c = texel(SHOTS, i + 5u);
    return s;
}

// A way in at q (mm across the skin from its middle along ex, ey): how far below the skin what is there lies (mm), how
// far outside the hole's edge (mm; negative in it), how far across the scraped ring (0 at the hole, 1 at its outer
// edge), and whether one of a rifle bullet's tiny splits of the edge is there. `fine`: 1 where the pixel is small
// enough to see a fraction of a millimetre, 0 where it is not.
fn entry_at(s: Shot, q: vec2<f32>, fine: f32) -> vec4<f32> {
    let r0 = s.a.x * 1000.0;
    let collar = s.a.y * 1000.0;
    // Which way across the skin the bullet came from, and how slanted (the sine of its angle off square).
    let o = min(length(s.a.zw), 0.95);
    let e = select(vec2(1.0, 0.0), s.a.zw / max(length(s.a.zw), 1e-5), o > 0.01);
    // Slanted, the hole is drawn out along the way it came: an oval, at most about twice as long as wide.
    let stretch = min(inverseSqrt(1.0 - o * o), 2.0);
    let qe = vec2(dot(q, e) / stretch, e.x * q.y - e.y * q.x);
    let r = length(qe);
    let dir = qe / max(r, 1e-4);
    // Not a compass circle: its edge a little in and out round it, and finely ragged; a way in again much more so.
    let uneven = select(0.13, 0.38, s.kind == AGAIN);
    let rag = select(0.05, 0.14, s.kind == AGAIN);
    var edge = r0 * (1.0 + uneven * (noise2(dir * 1.4 + s.seed) - 0.5) * 2.0 + rag * (noise2(dir * 5.0 + s.seed * 1.7) - 0.5) * 2.0 * fine);
    if s.kind == CHARGE {
        // One hole made by many pellets together: its edge a run of their arcs, scalloped (DiMaio).
        let th = atan2(dir.y, dir.x);
        edge = r0 * (0.9 + 0.1 * sqrt(abs(sin(th * 3.5 + s.seed))) + 0.16 * (noise2(dir * 1.4 + s.seed) - 0.5));
    }
    // The ring the bullet's flank rubbed raw: about a millimetre, three on the side it came from (DiMaio), uneven.
    let w = collar * (1.0 + 2.5 * o * max(dir.x, 0.0)) * (0.7 + 0.6 * noise2(dir * 2.2 + s.seed * 3.1));
    let d = r - edge;
    // The edge turned in: the skin round it dips into the hole over a little more than the ring's width.
    let fall = max(w, 0.45) * 1.25;
    var h = 0.0;
    if d < 0.0 {
        h = 0.45 + min(-d * 14.0, DEEPEST);
        if s.kind == CHARGE {
            // A crater, its floor torn tissue a few millimetres down.
            h = min(h, 4.0 + 2.5 * noise2(q * 0.3 + s.seed) + 1.5 * noise2(mat2x2(0.8, 0.6, -0.6, 0.8) * q * 0.7 + s.seed));
        }
    } else if d < fall {
        let t = 1.0 - d / fall;
        h = 0.45 * t * t;
    }
    let ring = d / max(w, 1e-3);
    if w > 0.0 && d >= 0.0 {
        // (the skin's top layer rubbed away: a step down of a tenth of a millimetre)
        h += 0.08 * (1.0 - smoothstep(0.85, 1.0, ring));
    }
    // A rifle's fast jacketed bullet leaves no scraped ring but tiny splits all round the edge, under a millimetre.
    var split = 0.0;
    if s.b.y > 0.5 && d >= 0.0 && d < 1.0 {
        let th = atan2(dir.y, dir.x) / 6.2831853 * 18.0 + s.seed;
        let cell = floor(th);
        let reach = 0.2 + 0.4 * hash2(vec2(cell, s.seed));
        let off = fract(th) - 0.3 - 0.4 * hash2(vec2(cell, 3.0));
        if hash2(vec2(cell, 7.0)) > 0.3 && d < reach && abs(off) < 0.07 * (1.0 - d / reach) {
            split = 1.0;
            h = max(h, 0.3);
        }
    }
    return vec4(h, d, select(9.0, ring, w > 0.0), split);
}

// A way out at q: how far below the skin (mm; its turned-out lips above it, negative), how far inside the tear (mm;
// negative outside it), how far it is torn through the fat to the muscle (0 to 1), and the fat's lobules (0 to 1).
fn exit_at(s: Shot, q: vec2<f32>, fine: f32) -> vec4<f32> {
    let fat = max(s.a.x * 1000.0, 1.5);
    let burst = s.a.y * 1000.0;
    let along = s.a.z * 1000.0;
    let bend = s.c.z;
    var inside = -1e3;
    for (var i = 0u; i < 3u; i++) {
        // Each split: its angle from ex, half length and half width.
        var arm = vec3(0.0, s.a.z, s.a.w);
        if i == 1u {
            arm = s.b.xyz;
        }
        if i == 2u {
            arm = vec3(s.b.w, s.c.x, s.c.y);
        }
        if arm.y <= 0.0 {
            continue;
        }
        let a = arm.y * 1000.0;
        let b = arm.z * 1000.0;
        let u = vec2(cos(arm.x), sin(arm.x));
        let x = dot(q, u);
        let y = u.x * q.y - u.y * q.x;
        let k = f32(i);
        // Each side of a split torn as far as it went, not as far as the other; the split bent, now and then into a
        // crescent.
        let span = a * (0.4 + 0.6 * hash2(vec2(s.seed + k, select(0.0, 1.0, x > 0.0))));
        let xa = clamp(x / span, -1.0, 1.0);
        // Skin tears along the weakest way through its collagen, not a ruled line: a long split wanders a little from side
        // to side over a centimetre or so, and each split off the first bends its own way (a star of straight equal
        // splits read as drawn, and a big tear's long side as cut with a knife).
        let own = bend + select(0.0, (hash2(vec2(s.seed + 0.5, k)) - 0.5) * 0.5, i > 0u);
        let wander = (noise2(vec2(x * 0.08, s.seed * 0.7 + k * 5.0)) - 0.5) * a * 0.3;
        let yb = y - own * a * 0.45 * (xa * xa - 0.4) - wander;
        // Both lips torn along the one jagged line, so that they would fit back together; the gap between them uneven.
        // (The fine jags only at the edge itself: carried out across the lips they would comb them into ridges.)
        let jag = (noise2(vec2(x * 0.55, s.seed + k * 7.0)) - 0.5) * (0.35 + 0.2 * b);
        // (Open most in its middle; out along it the lips lie nearly together, a torn line more than a gap.)
        let w = b * pow(max(1.0 - xa * xa, 0.0), 1.4) * (0.7 + 0.6 * noise2(vec2(x * 0.3, s.seed + 11.0 + k)));
        let coarse = w - abs(yb - jag);
        let tags = (noise2(vec2(x * 2.6, s.seed * 1.3 + k)) - 0.5) * 0.45 * fine * clamp(1.0 + coarse / 0.4, 0.0, 1.0);
        var e = w - abs(yb - jag - tags);
        if abs(x) > span {
            e = -(abs(x) - span) - abs(yb - jag - tags);
        }
        inside = max(inside, e);
    }
    // The ragged hole where the bullet burst through, where the splits meet.
    let r = length(q);
    let hole = burst * (0.7 + 0.6 * noise2(q / max(r, 1e-4) * 1.6 + s.seed * 2.3)) - r;
    inside = max(inside, hole);
    // The lips turned out in a band (wounds.rs `tear`'s lip, 1.5 mm and more for a bigger tear), raised half a
    // millimetre to a millimetre.
    let lip = 1.5 + 0.08 * along;
    let lift = min(0.2 + 0.025 * along, 0.5);
    if inside < -lip {
        return vec4(0.0, inside, 0.0, 0.0);
    }
    if inside < 0.0 {
        let t = 1.0 + inside / lip;
        return vec4(-lift * t * t * (3.0 - 2.0 * t), inside, 0.0, 0.0);
    }
    // In the tear: the fat under the skin bulging up between the lips in lobules a few millimetres across, their tops
    // near the skin's level (a big exit's dragged out past it); torn through to the muscle round the bullet's hole, and
    // the track going on down in the middle of that.
    let lob = mix(0.5, noise2(q * 0.42 + s.seed) * 0.65 + noise2(q * 1.05 + s.seed * 2.0) * 0.35, fine);
    let out = clamp((along - 5.0) * 0.15, 0.0, 1.3);
    let top = 0.5 + 1.5 * (1.0 - lob) - out * smoothstep(0.0, 2.5, inside);
    var h = mix(-lift, top, smoothstep(0.0, 0.45, inside));
    let torn = smoothstep(-0.3, 1.2, hole);
    h = mix(h, fat + 1.0 + 4.0 * noise2(q * 0.35 + s.seed * 3.0), torn);
    h += DEEPEST * smoothstep(burst * 0.55, burst * 1.0, hole);
    return vec4(h, inside, torn, lob);
}

fn shot_at(s: Shot, q: vec2<f32>, fine: f32) -> vec4<f32> {
    if s.kind == EXIT {
        return exit_at(s, q, fine);
    }
    return entry_at(s, q, fine);
}

// How high the blood stands in a wound (mm below the skin) `age` seconds after it was made: little at first, then welling
// up the hole (wounds.md 4.7: a small way in bleeds little outside); a way out, torn and bigger, fills sooner and higher.
// What comes over the top runs off down the skin (runs.rs).
fn blood_level(s: Shot, age: f32) -> f32 {
    if s.kind == EXIT {
        return 5.0 - 4.2 * (1.0 - exp(-age / 20.0));
    }
    if s.kind == CHARGE {
        return 6.0 - 5.0 * (1.0 - exp(-age / 25.0));
    }
    return 6.0 - 5.5 * (1.0 - exp(-age / 30.0));
}

struct Wound {
    albedo: vec3<f32>,
    rough: f32,
    gloss: f32,
    gloss_rough: f32,
    n: vec3<f32>,
    coat_n: vec3<f32>,
    // How much of the blood lying on the skin (the film) still shows here: none down in the hole.
    film: f32,
    hit: bool,
}

// The gunshot wounds round this point of the skin (`id` the newest whose patch it is in): followed in from the eye, and
// what is met coloured. `m` the skinning's columns, `v` toward the eye (world), `n` the skin's normal (world).
fn gunshot(id: u32, rest: vec3<f32>, m0: vec3<f32>, m1: vec3<f32>, m2: vec3<f32>, v: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>, rough: f32, fine: f32, px: f32) -> Wound {
    var out: Wound;
    out.albedo = albedo;
    out.rough = rough;
    out.n = n;
    out.coat_n = n;
    out.film = 1.0;
    out.hit = false;
    // This one and those it overlaps (marks.rs `shot`), as far as they reach.
    var shots: array<Shot, 3>;
    var count = 0u;
    var k = id;
    var exits = false;
    for (var j = 0u; j < 4u && k > 0u && count < 3u; j++) {
        let s = shot(k);
        // (Not one on skin facing another way close by: the inside of the cheek behind the cheek, the far side of a
        // finger.)
        let faces = dot(normalize(m0 * s.n.x + m1 * s.n.y + m2 * s.n.z), n);
        if distance(rest, s.at) < s.reach * 1.2 + 0.004 && faces > 0.25 {
            shots[count] = s;
            count++;
            exits = exits || s.kind == EXIT;
        }
        k = s.prev;
    }
    if count == 0u {
        return out;
    }
    let now = texel(SHOTS, 0u).x;
    // The eye's ray at rest: each millimetre down into the skin it goes so far across it (not further across than at
    // about sixty degrees off square: a grazing look stays at the lips).
    let vr = normalize(vec3(dot(m0, v), dot(m1, v), dot(m2, v)));
    let n0 = shots[0].n;
    let vn = max(dot(vr, n0), 0.45);
    let slide = -(vr - n0 * dot(vr, n0)) / vn;
    var base: array<vec2<f32>, 3>;
    var stride: array<vec2<f32>, 3>;
    var level: array<f32, 3>;
    for (var j = 0u; j < count; j++) {
        let s = shots[j];
        let d = (rest - s.at) * 1000.0;
        base[j] = vec2(dot(d, s.ex), dot(d, s.ey));
        stride[j] = vec2(dot(slide, s.ex), dot(slide, s.ey));
        level[j] = blood_level(s, now - s.c.w);
    }
    // Down the ray to the first place it is at or under what is there (the wounds' surfaces, the blood's level among
    // them): in even tenths of a millimetre through the lips and the skin's top, then in steps growing to the bottom;
    // then that place found closely between the last two steps.
    let top = select(0.0, -LIPS, exits);
    let near = SHALLOW - top;
    // Most of a wound's patch is skin it never opened (the bruise round the ring, the powder round a close shot): where
    // the ray meets nothing above the skin, at it or just under it, it stops at the skin without the march.
    var opened = false;
    for (var p = 0; p < 3; p++) {
        let d = select(select(SHALLOW, 0.0, p == 1), top, p == 0);
        for (var j = 0u; j < count; j++) {
            opened = opened || shot_at(shots[j], base[j] + stride[j] * d, fine).x != 0.0;
        }
    }
    var lo = top;
    var hi = select(0.0, DEEPEST, opened);
    for (var i = 1; i <= select(0, STEPS, opened); i++) {
        let t = f32(i) / f32(STEPS);
        var d = top + near * t * 2.0;
        if t > 0.5 {
            let u = t * 2.0 - 1.0;
            d = SHALLOW + (DEEPEST - SHALLOW) * u * u;
        }
        var surface = 0.0;
        for (var j = 0u; j < count; j++) {
            let h = min(shot_at(shots[j], base[j] + stride[j] * d, fine).x, level[j]);
            surface = select(surface, h, abs(h) > abs(surface));
        }
        if d >= surface {
            hi = d;
            break;
        }
        lo = d;
    }
    for (var i = 0; i < select(0, 7, opened); i++) {
        let d = (lo + hi) * 0.5;
        var surface = 0.0;
        for (var j = 0u; j < count; j++) {
            let h = min(shot_at(shots[j], base[j] + stride[j] * d, fine).x, level[j]);
            surface = select(surface, h, abs(h) > abs(surface));
        }
        if d >= surface {
            hi = d;
        } else {
            lo = d;
        }
    }
    let depth = hi;
    // Whose wound it is that the ray met.
    var w = 0u;
    var most = 0.0;
    for (var j = 0u; j < count; j++) {
        let h = min(shot_at(shots[j], base[j] + stride[j] * depth, fine).x, level[j]);
        if abs(h) > abs(most) {
            most = h;
            w = j;
        }
    }
    let s = shots[w];
    let q = base[w] + stride[w] * depth;
    let at = shot_at(s, q, fine);
    let lv = level[w];
    let age = max(now - s.c.w, 0.0);
    if at.x == 0.0 && s.kind != EXIT && (s.b.x > 1.2 || s.kind == CHARGE) && at.z > 3.0 {
        // (Beyond the ring's bruise, and no powder: nothing to do.)
        return out;
    }
    out.hit = true;
    // The surface's slope there, from the field either side: the walls lean, the light falls down them.
    let e = max(0.04, px * 0.5);
    let sx = min(shot_at(s, q + vec2(e, 0.0), fine).x, lv) - min(shot_at(s, q - vec2(e, 0.0), fine).x, lv);
    let sy = min(shot_at(s, q + vec2(0.0, e), fine).x, lv) - min(shot_at(s, q - vec2(0.0, e), fine).x, lv);
    var g = vec2(sx, sy) / (2.0 * e);
    g *= min(1.0, 4.0 / max(length(g), 1e-4));
    let wex = normalize(m0 * s.ex.x + m1 * s.ex.y + m2 * s.ex.z);
    let wey = normalize(m0 * s.ey.x + m1 * s.ey.y + m2 * s.ey.z);
    out.n = normalize(n + wex * g.x + wey * g.y);
    out.coat_n = out.n;

    // Fresh blood is glossy and red; over a quarter of an hour it dulls and darkens as it clots and dries (the film's
    // own drying, film.rs, is twenty minutes). The scraped ring dries from moist red-brown to brown, then darker
    // (DiMaio: brown, then black; over hours).
    let wet = exp(-age / 900.0);
    let dried = 1.0 - exp(-age / 1800.0);
    let h = at.x;
    let pooled = h > lv + 0.01;
    // Light reaches only so far down a hole as wide as this one.
    var open = s.a.x * 1000.0;
    if s.kind == EXIT {
        open = max(s.a.w, s.a.y) * 1000.0;
    }
    let ao = exp(-max(depth - 0.3, 0.0) / select(open * 0.55 + 0.25, open + 0.6, s.kind == EXIT));
    var c = albedo;
    var tissue_rough = 0.32;
    var coat = 0.0;
    // (sRGB. Fat pale cream to light yellow, L* 75-80, b* 20-25; muscle beef's red-brown, L* 30-38, a* 25-32: cutface.rs.)
    let fat = mix(vec3(0.80, 0.68, 0.54), vec3(0.88, 0.80, 0.64), smoothstep(0.3, 0.7, select(0.5, at.w, s.kind == EXIT)));
    let muscle = vec3(0.45, 0.17, 0.16) * (0.7 + 0.5 * mix(0.5, noise2(q * vec2(0.9, 6.0) + s.seed), fine));
    let dermis = vec3(0.76, 0.50, 0.46);
    if s.kind != EXIT {
        let ring = at.z;
        let d = at.y;
        // A bruise round the ring, faint (Thali 2002).
        let bruise = (1.0 - smoothstep(1.0, 3.0, ring)) * 0.4 * select(1.0, 0.0, ring > 8.0);
        c *= mix(vec3(1.0), vec3(0.86, 0.66, 0.68), bruise);
        // The scraped ring, mottled; fresh it is moist and shines a little.
        let scraped = (1.0 - smoothstep(0.85, 1.05, ring)) * step(0.0, d);
        let raw = mix(vec3(0.50, 0.20, 0.15), vec3(0.33, 0.14, 0.09), dried) * (0.85 + 0.3 * mix(0.5, noise2(q * 3.0 + s.seed), fine));
        c = mix(c, to_linear(raw), scraped * 0.92);
        coat = max(coat, scraped * 0.35 * (1.0 - dried));
        tissue_rough = mix(0.4, 0.75, dried);
        // Down its wall: the skin's cut edge, then the fat, then muscle, darkening to nothing; blood over all of it.
        var wall = mix(dermis, fat, smoothstep(1.8, 2.6, h));
        wall = mix(wall, to_linear(muscle) * 2.2, smoothstep(5.0, 7.0, h));
        wall = blood_over(to_linear(wall), 0.1 + 0.15 * smoothstep(0.5, 3.0, h), wet);
        if s.kind == CHARGE {
            // The crater's floor: fat and muscle torn together.
            wall = blood_over(to_linear(mix(fat, muscle, smoothstep(0.35, 0.6, noise2(q * 0.5 + s.seed)))), 0.2, wet);
            tissue_rough = 0.5;
        }
        let down = smoothstep(0.25, 0.7, h);
        c = mix(c, wall, down);
        coat = max(coat, down * 0.45);
        // (barely to be seen: DiMaio)
        c = mix(c, to_linear(vec3(0.42, 0.1, 0.08)), at.w * 0.6);
        // Close, the soot and burnt powder blown out of the muzzle with the bullet (wounds.md 4.2): soot dense and black
        // within a centimetre or two, wider, greyer and in petals further off, gone by 20 to 30 cm; powder grains driven
        // into the skin as reddish-brown pinpoint scrapes, in a wider and sparser pattern the further, to about 60 cm
        // from a handgun. A rifle's go about twice as far.
        let range = s.b.x;
        let far = select(1.0, 2.0, s.b.y > 0.5);
        if range < 0.6 * far && s.kind != CHARGE {
            let rr = length(q);
            let mm = range * 1000.0 / far;
            let th = atan2(q.y, q.x);
            let soot = (1.0 - smoothstep(20.0, 300.0, mm)) * exp(-max(rr - s.a.x * 1000.0, 0.0) / (1.2 + mm * 0.07))
                * (0.75 + 0.25 * cos(th * 6.0 + s.seed)) * (0.7 + 0.6 * noise2(q * 0.25 + s.seed));
            c = mix(c, vec3(0.022, 0.02, 0.018), clamp(soot, 0.0, 1.0) * 0.92 * (1.0 - down * 0.5));
            let spread = 6.0 + mm * 0.15;
            let dense = 0.9 * pow(1.0 - mm / 600.0, 1.5) * exp(-(rr * rr) / (spread * spread) * 2.5);
            let cell = floor(q / 0.7);
            let pick = hash2(cell + s.seed);
            let mid = (cell + 0.2 + 0.6 * vec2(hash2(cell + 1.3), hash2(cell + 2.7))) * 0.7;
            let size = 0.09 + 0.16 * hash2(cell + 4.1);
            let grain = select(0.0, 1.0 - smoothstep(size * 0.6, size, length(q - mid)), pick < dense * 0.49);
            // (Too small to see one at a time: their colour spread over the skin as much as they cover of it.)
            let tattoo = mix(dense * 0.05, grain, fine);
            c = mix(c, to_linear(mix(vec3(0.55, 0.22, 0.12), vec3(0.22, 0.07, 0.04), smoothstep(size, 0.0, length(q - mid)) * fine)), clamp(tattoo, 0.0, 1.0) * 0.9);
            // Pressed to the skin: its edge seared black.
            c = mix(c, vec3(0.02, 0.015, 0.012), (1.0 - smoothstep(0.005, 0.012, range)) * (1.0 - smoothstep(0.0, 1.5, d)) * 0.9);
        }
    } else {
        let inside = at.y;
        // The lips turned out: the skin bruised red along them, blood smeared at the edge.
        let lip = 1.5 + 0.08 * s.a.z * 1000.0;
        let t = clamp(1.0 + inside / lip, 0.0, 1.0);
        // (Dusky rather than red: an exit has no scraped ring, only the bruise of skin stretched out from inside; DiMaio.)
        c = mix(c, c * vec3(0.8, 0.6, 0.62), t * 0.7);
        c = blood_over(c, 0.06 * t * t * t * t, wet);
        // The skin's cut edge seen over the lip (the turned-out dermis, pale), then the fat bulging between, glistening and
        // filmed with blood, red muscle where it is torn deeper, and the track black-red.
        let edge = smoothstep(-0.1, 0.12, inside);
        // (Fresh, the edge is bloody: a bare dermis rim caught the light pale, like paper.)
        c = mix(c, blood_over(to_linear(dermis) * 0.7, 0.07, wet), edge);
        var deep = mix(fat, muscle, at.z);
        // (Fat barely bleeds: the blood lies in the crevices between its lobules, a trace over their tops; body-wall.md.)
        deep = blood_over(to_linear(deep), 0.012 + 0.1 * smoothstep(0.3, 0.8, 1.0 - at.w) + 0.12 * at.z, wet);
        let thick = max(s.a.x * 1000.0, 1.5);
        deep = mix(deep, vec3(0.03, 0.002, 0.002), smoothstep(thick + 4.0, thick + 9.0, h));
        c = mix(c, deep, smoothstep(0.25, 0.5, inside));
        // (wet, but fat glistens rather than shines: a thin film over lobules, not a lacquer)
        coat = max(coat, edge * 0.15);
        tissue_rough = 0.5;
    }
    // Blood standing in it: level, dark red where it is deep, glossy.
    if pooled {
        c = blood_over(c, min(h - lv, 6.0), wet);
        coat = 1.0;
        tissue_rough = 0.15;
        out.coat_n = n;
        out.n = n;
    }
    out.albedo = c * mix(1.0, ao, smoothstep(0.0, 0.4, depth));
    out.rough = mix(rough, tissue_rough, smoothstep(0.0, 0.3, max(depth, select(0.0, 1.0, s.kind != EXIT && at.z < 1.0))));
    out.gloss = coat * mix(0.25, 1.0, wet) * sqrt(ao);
    out.gloss_rough = mix(0.35, 0.04, wet);
    out.film = 1.0 - smoothstep(0.2, 0.5, depth);
    return out;
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

        // Gunshot wounds (marks.rs), where the sheet's alpha says one is near: its number, read exactly.
        var keep_film = 1.0;
        if gm.a > 0.0 {
            let id = u32(textureLoad(wounds, vec2<i32>(clamp(uv, vec2(0.0), vec2(0.9999)) * 2048.0), 0).a * 255.0 + 0.5);
            if id > 0u {
                let px = length(fwidth(rest)) * 1000.0;
                let fine = clamp(1.6 - px * 2.0, 0.0, 1.0);
                let g = gunshot(id, rest, in.m0, in.m1, in.m2, pbr.V, n, albedo, rough, fine, px);
                if g.hit {
                    albedo = g.albedo;
                    rough = g.rough;
                    n = g.n;
                    gloss = g.gloss;
                    gloss_rough = g.gloss_rough;
                    film_n = g.coat_n;
                    keep_film = g.film;
                }
            }
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
            let fat = mix(vec3(0.80, 0.68, 0.54), vec3(0.88, 0.80, 0.64), smoothstep(0.3, 0.7, lob));
            // Torn muscle: bundles of fibres running one way, ragged, darker between them.
            // (beef's red-brown, as the cut faces: cutface.rs)
            let muscle = vec3(0.45, 0.17, 0.16) * (0.7 + 0.5 * mix(0.5, noise2(uv * vec2(180.0, 1400.0) + 2.0), gmid));
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
            // (a pool's colour: fluid.wesl's deep)
            albedo = mix(albedo, vec3(0.075, 0.012, 0.011), clamp(blood, 0.0, 0.93));
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
        let fmm = fm.r * MOST_MM * keep_film;
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
