// A person's eye (eyes.rs `EyeLook`): Bevy's standard material over the eye's picture, with the pupil drawn at any size
// (face.ts PupilLayer) and what the eye shows of its hurt over it (eyes.ts EyeLayer and its canvas, here worked out
// where it is drawn from the list of patches and marks in the uniform, as sharp as the TS's 256-pixel sheet was).

import bevy_pbr::render::{
    forward_io::{VertexOutput, FragmentOutput},
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
};

const MOST: u32 = 12u;
const SCLERA: f32 = 0.265;      // picture radius of each eye's painted disc (the white ends there)
const PX: f32 = 1.0 / 256.0;    // a pixel of the TS's damage sheet: the edges are that soft

struct Eye {
    centres: vec4<f32>,
    sizes: vec4<f32>,
    iris: vec4<f32>,
    world: array<vec4<f32>, 2>,
    state: array<vec4<f32>, 2>,
    counts: vec4<u32>,
    patches: array<vec4<f32>, 12>,
    marks: array<vec4<f32>, 12>,
    along: array<vec4<f32>, 12>,
}

@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> eye: Eye;

// Where the picture is sampled for a point of the eye: inside the iris, from where the painted pupil and iris would put
// it, so the pupil grows into the iris and the iris's pattern is squeezed toward its rim.
fn pupil_uv(uv: vec2<f32>) -> vec2<f32> {
    let first = distance(uv, eye.centres.xy) < distance(uv, eye.centres.zw);
    let c = select(eye.centres.zw, eye.centres.xy, first);
    let d = uv - c;
    let r = length(d);
    let big = eye.sizes.x;
    let painted = eye.sizes.y;
    let shown = select(eye.sizes.w, eye.sizes.z, first);
    if r >= big || r < 1e-6 {
        return uv;
    }
    var src = painted + (r - shown) * (big - painted) / (big - shown);
    if r < shown {
        src = r * painted / shown;
    }
    return c + d * (src / r);
}

// The canvas's colours (sRGB, 0-255) as linear light, and one painted over another (source-over).
fn rgba(r: f32, g: f32, b: f32, a: f32) -> vec4<f32> {
    return vec4(pow(vec3(r, g, b) / 255.0, vec3(2.2)), a);
}

fn over(dst: vec4<f32>, src: vec4<f32>) -> vec4<f32> {
    let a = src.a + dst.a * (1.0 - src.a);
    if a < 1e-5 {
        return vec4(0.0);
    }
    return vec4((src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / a, a);
}

// Inside a disc of radius r round the point d away, with a pixel's soft edge.
fn inside(d: f32, r: f32) -> f32 {
    return 1.0 - smoothstep(r - PX * 0.5, r + PX * 0.5, d);
}

// How far along a torn edge of 18 tongues reaches at angle `a` (the same tears each time: `seed`).
fn torn(a: f32, seed: f32) -> f32 {
    let x = fract(a / 6.2831853) * 18.0;
    let i = floor(x);
    let k0 = 0.7 + 0.45 * abs(sin(seed + i * 2.399) * sin(seed * 0.7 + i * 1.13));
    let j = select(i + 1.0, 0.0, i + 1.0 >= 18.0);
    let k1 = 0.7 + 0.45 * abs(sin(seed + j * 2.399) * sin(seed * 0.7 + j * 1.13));
    return mix(k0, k1, x - i);
}

fn segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    return distance(p, a + ab * t);
}

// Smooth value noise in the picture's plane, 0 to 1.
fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

fn noise2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Bloodshot (`red`, 0 to 1): conjunctival injection, the conjunctiva's vessels swollen and showing, running in from the
// edges of the white (the fornices, under the lids) toward the cornea, wavy, thinning as they go, a few thick trunks and
// many fine ones, the most at the corners of the eye, and a fine net between them; the white itself flushed pink. They
// fade short of the cornea's edge (unlike the ciliary flush of an inflamed eye, which rings it). Each size of vessel is
// a set of wandering lines round the eye's middle, each line reaching in its own way. (The TS's were where a warped
// noise crossed its middle, a pale even net at most half covering the white: the user found them too faint.)
fn bloodshot(uv: vec2<f32>, c: vec2<f32>, rc: f32, red: f32) -> vec4<f32> {
    let d = uv - c;
    let a = atan2(d.y, d.x);
    let r = clamp((rc - eye.sizes.x) / (SCLERA - eye.sizes.x), 0.0, 1.0);
    let corners = 0.55 + 0.45 * abs(cos(a));
    var lines = 0.0;
    for (var k = 0; k < 3; k++) {
        let f = f32(k);
        let many = 7.0 + f * 9.0;
        let wander = (noise2(vec2(cos(a) * 2.5 + f * 11.0, sin(a) * 2.5 + r * (4.0 + f * 3.0))) - 0.5) * (0.9 + f * 0.4);
        let u = a / 6.2831853 * round(many * 6.0) + wander;
        let which = hash2(vec2(floor(u), f * 7.0));
        // (Each vessel reaches in its own way: trunks to near the limbus, the finer ones less far.)
        let reach = 0.15 + 0.6 * which + f * 0.12;
        let width = (0.07 - f * 0.018) * mix(0.45, 1.0, r);
        let line = 1.0 - smoothstep(width * 0.5, width, abs(fract(u) - 0.5));
        lines = max(lines, line * smoothstep(reach - 0.1, reach + 0.15, r) * (0.55 + 0.45 * which) * (1.0 - f * 0.18));
    }
    // And the fine net between them.
    let warp = vec2(noise2(uv * 40.0), noise2(uv * 40.0 + 17.0)) * 2.5;
    let fine = 1.0 - smoothstep(0.0, 0.035, abs(noise2(uv * 160.0 + warp * 1.7) - 0.5));
    lines = max(lines, fine * 0.5 * smoothstep(0.2, 0.7, r) * smoothstep(0.3, 0.8, noise2(uv * 25.0)));
    let near = smoothstep(0.0, 0.35, r);
    let flush = rgba(222.0, 120.0, 112.0, min(1.0, 0.75 * red * near * corners));
    return over(flush, rgba(168.0, 16.0, 20.0, min(1.0, 1.15 * red * lines * corners)));
}

// The damage sheet at `uv`: what the TS painted on its canvas, in its order, over the eye's bloodshot white.
fn damage(uv: vec2<f32>, c: vec2<f32>, red: f32) -> vec4<f32> {
    var out = vec4(0.0);
    let rc = distance(uv, c);
    let white = inside(rc, SCLERA) * (1.0 - inside(rc, eye.sizes.x * 1.03));
    if red > 0.0 {
        let b = bloodshot(uv, c, rc, red);
        out = over(out, vec4(b.rgb, b.a * white));
    }
    // Blood under the conjunctiva: bright red, flat, sharp-edged, on the white only (the cornea's edge is its limit).
    if white > 0.0 {
        for (var i = 0u; i < eye.counts.x; i++) {
            let p = eye.patches[i];
            let r = max(PX, p.z);
            let t = distance(uv, p.xy) / r;
            if t >= 1.0 {
                continue;
            }
            var col = mix(rgba(150.0, 10.0, 12.0, 0.95 * p.w), rgba(160.0, 14.0, 14.0, 0.85 * p.w), t / 0.75);
            if t > 0.75 {
                col = mix(rgba(160.0, 14.0, 14.0, 0.85 * p.w), rgba(170.0, 20.0, 20.0, 0.0), (t - 0.75) / 0.25);
            }
            col.a *= white;
            out = over(out, col);
        }
    }
    for (var i = 0u; i < eye.counts.y; i++) {
        let m = eye.marks[i];
        let r = max(1.5 * PX, m.z);
        let d = uv - m.xy;
        if m.w > 1.5 {
            // The cut: gaping a little, its lips dark with the uvea behind; at its end nearest the pupil, a knuckle of iris
            // carried into it.
            let way = eye.along[i].xy * r;
            let a = m.xy - way;
            let b = m.xy + way;
            let s = segment(uv, a, b);
            out = over(out, rgba(120.0, 10.0, 10.0, 0.75 * inside(s, max(2.5 * PX, r * 0.35) * 0.5)));
            out = over(out, rgba(28.0, 10.0, 8.0, 0.95 * inside(s, max(1.2 * PX, r * 0.16) * 0.5)));
            let k = select(b, a, distance(a, c) < distance(b, c));
            let knuckle = k * 0.6 + m.xy * 0.4;
            out = over(out, rgba(52.0, 26.0, 16.0, 0.95 * inside(distance(uv, knuckle), max(1.5 * PX, r * 0.28))));
        } else {
            // A hole: the wall split round it in ragged tongues, dark brown-black uvea and retina pushed out, blood.
            let l = length(d);
            if l < r * 1.9 {
                out = over(out, mix(rgba(90.0, 6.0, 6.0, 0.9), rgba(110.0, 8.0, 8.0, 0.0), l / (r * 1.9)));
            }
            let a = atan2(d.y, d.x);
            out = over(out, rgba(48.0, 24.0, 16.0, 0.97 * inside(l, r * torn(a, eye.along[i].z))));
            out = over(out, rgba(14.0, 4.0, 3.0, inside(l, r * 0.62 * torn(a, eye.along[i].w))));
        }
    }
    return out;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var vo = in;
    vo.uv = pupil_uv(in.uv);
    var pbr = pbr_input_from_standard_material(vo, is_front);
    pbr.material.base_color = alpha_discard(pbr.material.flags, pbr.material.alpha_cutoff, pbr.material.base_color);
    var albedo = pbr.material.base_color.rgb;

    let uv = in.uv;
    let first = distance(uv, eye.centres.xy) < distance(uv, eye.centres.zw);
    let c = select(eye.centres.zw, eye.centres.xy, first);
    let w = select(eye.world[1], eye.world[0], first);
    let s = select(eye.state[1], eye.state[0], first);
    let er = distance(uv, c) / eye.iris.x;
    let y = in.world_position.y;
    // Blood in the front chamber, seen through the cornea: over the iris and pupil only, a haze while it is stirred up, a
    // layer with a flat top once it settles (its top level in the world), darkening as it clots.
    if er < 1.03 && (w.w > 0.001 || s.x > 0.001) {
        let top = w.y - eye.iris.y + 2.0 * eye.iris.y * w.w;
        var under = 0.0;
        if w.w > 0.001 {
            under = 1.0 - smoothstep(top - 0.00025, top + 0.00025, y);
        }
        let fresh = vec3(0.28, 0.012, 0.01);
        let clot = vec3(0.045, 0.006, 0.005);
        let bl = mix(fresh, clot, s.z) * (0.75 + 0.25 * smoothstep(top - 2.0 * eye.iris.y, top, y));
        albedo = mix(albedo, bl, max(under, s.x) * (1.0 - smoothstep(0.97, 1.03, er)));
    }
    if eye.counts.x + eye.counts.y > 0u || s.w > 0.0 {
        let ed = damage(uv, c, s.w);
        albedo = mix(albedo, ed.rgb, ed.a);
    }
    // A dead eye drying: the tear film gone, the shine of every lamp in it dulled, the cornea a little hazed over the
    // iris (clouding proper takes hours).
    if eye.iris.z > 0.0 {
        pbr.material.perceptual_roughness = mix(pbr.material.perceptual_roughness, 0.32, eye.iris.z);
        albedo = mix(albedo, vec3(0.32, 0.31, 0.3), 0.12 * eye.iris.z * (1.0 - smoothstep(0.95, 1.1, er)));
    }
    // An emptied globe: its wall in folds.
    if s.y > 0.01 {
        let wp = in.world_position.xyz * 900.0;
        let fold = vec3(sin(wp.y * 1.3 + sin(wp.z * 0.7) * 2.0), sin(wp.z * 1.1 + sin(wp.x * 0.9) * 2.0), sin(wp.x * 1.2 + sin(wp.y * 0.8) * 2.0));
        pbr.N = normalize(pbr.N + fold * 0.35 * s.y);
        albedo *= 1.0 - 0.25 * s.y;
    }
    pbr.material.base_color = vec4(albedo, pbr.material.base_color.a);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr);
    out.color = main_pass_post_lighting_processing(pbr, out.color);
    return out;
}
