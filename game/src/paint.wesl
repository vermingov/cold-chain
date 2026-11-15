// Painting into a person's sheets (marks.rs): every mark of a frame drawn at once, each a quad over the box it paints
// in, in the sheet's own picture space (uv). What it paints is kept as the lighter of it and what is there (marks.ts
// painted with the canvas's 'lighten'): the pipeline blends with Max, so marks never take anything away and their order
// does not matter.
//
// A stamp is four vec4s: `ab` its two points (a disc has a = b), `s` (width, feather, reach, kind), `v` its value, `x`
// what its kind needs besides. Widths are half widths, all in uv.

const CAPSULE: u32 = 0u;  // a stroke from a to b, round ends, `w` half its width: v everywhere in it
const ENTRY: u32 = 1u;    // a bullet's way in (marks.ts entry): the hole's depth and the blood in it, by radius
const SOFT: u32 = 2u;     // a disc solid to 0.7 of its radius and fading to nothing at it (marks.ts soft)
const LENS: u32 = 3u;     // a blade's slit (marks.ts stab), its three bands at once
const BLOT: u32 = 4u;     // a patch of blood with an uneven edge (film.ts blot), its three layers at once
const RADIAL: u32 = 5u;   // a disc fading evenly from v at its middle to nothing at its edge (a canvas radial gradient)

struct Stamp {
    @location(0) ab: vec4<f32>,
    @location(1) s: vec4<f32>,
    @location(2) v: vec4<f32>,
    @location(3) x: vec4<f32>,
}

struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) ab: vec4<f32>,
    @location(2) @interpolate(flat) s: vec4<f32>,
    @location(3) @interpolate(flat) v: vec4<f32>,
    @location(4) @interpolate(flat) x: vec4<f32>,
}

@vertex
fn vertex(@builtin(vertex_index) k: u32, stamp: Stamp) -> Out {
    let lo = min(stamp.ab.xy, stamp.ab.zw) - stamp.s.z;
    let hi = max(stamp.ab.xy, stamp.ab.zw) + stamp.s.z;
    // Two triangles: corners 0 1 2, 2 1 3.
    let c = array<vec2<f32>, 6>(vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0))[k];
    let uv = mix(lo, hi, c);
    var out: Out;
    // uv (0, 0) is the picture's first row, which is the top of the target.
    out.position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    out.ab = stamp.ab;
    out.s = stamp.s;
    out.v = stamp.v;
    out.x = stamp.x;
    return out;
}

fn hash(n: f32) -> f32 {
    return fract(sin(n * 127.1) * 43758.5453);
}

// How far p is from the segment a b.
fn segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    return length(p - a - ab * t);
}

// Inside an edge `w` from the middle, softened over `f` either side of it.
fn inside(d: f32, w: f32, f: f32) -> f32 {
    return 1.0 - smoothstep(w - f, w + f, d);
}

@fragment
fn fragment(in: Out) -> @location(0) vec4<f32> {
    let p = in.uv;
    let a = in.ab.xy;
    let b = in.ab.zw;
    let w = in.s.x;
    let f = in.s.y;
    let kind = u32(in.s.w);
    if kind == CAPSULE {
        return in.v * inside(segment(p, a, b), w, f);
    }
    if kind == ENTRY {
        // The canvas's radial gradient: (240, 240) at the middle, (225, 230) at 0.55, (60, 200) at 0.8, nothing at 1.
        let t = length(p - a) / w;
        var c = vec2(0.0);
        if t < 0.55 {
            c = mix(vec2(240.0, 240.0), vec2(225.0, 230.0), t / 0.55);
        } else if t < 0.8 {
            c = mix(vec2(225.0, 230.0), vec2(60.0, 200.0), (t - 0.55) / 0.25);
        } else if t < 1.0 {
            c = mix(vec2(60.0, 200.0), vec2(0.0, 0.0), (t - 0.8) / 0.2);
        }
        return vec4(c / 255.0, 0.0, 0.0);
    }
    if kind == RADIAL {
        return in.v * (1.0 - clamp(length(p - a) / w, 0.0, 1.0));
    }
    if kind == SOFT {
        return in.v * (1.0 - smoothstep(0.7, 1.0, length(p - a) / w));
    }
    if kind == LENS {
        // From the blade's back (a) to its edge (b): how far along, and how far off the line.
        let along = b - a;
        let len = max(length(along), 1e-6);
        let u = along / len;
        let t = dot(p - a, u) / len;
        let off = abs(u.x * (p - a).y - u.y * (p - a).x);
        if t < 0.0 || t > 1.0 {
            return vec4(0.0);
        }
        let open = in.x.x;
        let double = in.x.w > 0.5;
        let end = select(max(open, in.x.y), 0.0, double);
        let pi = 3.14159265;
        var width = max(end * (1.0 - t), open * pow(max(0.0, 1.0 - t * t), 0.6));
        if double {
            width = open * pow(sin(pi * t), 0.6);
        }
        // The band of cut lip round it narrows to nothing at a sharp end and keeps its width round a squared one.
        var rim = sqrt(sin(pi * t));
        if !double && t < 0.5 {
            rim = 1.0;
        }
        let half_px = in.x.z;
        // Outermost first: the lip's edge, the lip, the slit itself (half as wide as the blade opened it).
        let grows = array<f32, 3>(in.v.x, in.v.y, 0.0);
        let values = array<vec2<f32>, 3>(vec2(70.0, 60.0), vec2(170.0, 140.0), vec2(250.0, 200.0));
        var out = vec2(0.0);
        for (var k = 0; k < 3; k++) {
            let scale = select(0.5, 1.0, grows[k] > 0.0);
            let edge = max(half_px, width * scale + grows[k] * rim);
            out = max(out, values[k] / 255.0 * inside(off, edge, f));
        }
        return vec4(out, 0.0, 0.0);
    }
    if kind == BLOT {
        // An uneven edge: 2n corners round it, each at its own reach (0.78 to 1.1 of the radius), straight between.
        let seed = in.x.x;
        let corners = in.x.y;
        let turn = in.x.z;
        let d = p - a;
        let r = length(d);
        var th = atan2(d.y, d.x) - turn;
        th = th - floor(th / 6.2831853) * 6.2831853;
        let at = th / 6.2831853 * corners;
        let k0 = floor(at);
        let k1 = k0 + 1.0 - select(0.0, corners, k0 + 1.0 >= corners);
        let reach = mix(0.78 + 0.32 * hash(seed + k0), 0.78 + 0.32 * hash(seed + k1), at - k0);
        // Three layers, each thicker in the middle (marks.ts's shares of the thickness at 1, 0.7, 0.4 of the size).
        let layers = array<vec2<f32>, 3>(vec2(1.0, 0.45), vec2(0.7, 0.75), vec2(0.4, 1.0));
        var red = 0.0;
        for (var k = 0; k < 3; k++) {
            red = max(red, in.v.x * layers[k].y * inside(r, w * layers[k].x * reach, f));
        }
        let any = inside(r, w * reach, f);
        return vec4(red, in.v.y * any, 0.0, 0.0);
    }
    return vec4(0.0);
}

// The film drying (film.rs): every so often its wetness (green) times a factor, which is the blend constant. Nothing
// else is written.
@fragment
fn dry() -> @location(0) vec4<f32> {
    return vec4(0.0);
}
