// The look of the cut wall (wall.rs Layers; the TS's Layers material plugin).
//
// Colours from body-wall.md 1.6 and marks.ts's lips (the same fat, sheath and muscle, so the face continues the band
// painted on the skin round it): the dermis a pale pinkish rim; fat pale cream to light yellow in bulging lobules; fascia
// and sheaths thin silky white; muscle dark red with its grain; rib in section an ivory cortex round dark red marrow;
// costal cartilage bluish white and glossy; the pleura a glistening film, the belly's lining yellow extraperitoneal fat
// and then the peritoneum. Blood over all of it, most in the muscle and toward the bottom.
//
// Each corner's colour is its place at rest; its picture's u how deep it is (mm below the skin), v its column, whose
// layers are five of `columns`: where each layer ends (two), and the three muscles' fibres (the first's w the ribs'
// zone, and 4 more in the belly).

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    forward_io::{VertexOutput, FragmentOutput},
};
// Blood over a surface (fluid.wesl, fluid.ts bloodOver): `mm` deep, `wet` 1 fresh, 0 dried.
import cold_chain::fluid::blood_over;

@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> columns: array<vec4<f32>, 200>;

fn wall_hash(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn wall_noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wall_hash(i), wall_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wall_hash(i + vec3(0.0, 1.0, 0.0)), wall_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(wall_hash(i + vec3(0.0, 0.0, 1.0)), wall_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wall_hash(i + vec3(0.0, 1.0, 1.0)), wall_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

fn fade(f: f32, px: f32) -> f32 {
    return clamp(1.0 / (f * px) - 1.0, 0.0, 1.0);
}

// Muscle's grain at p for fibres along f: fascicles a millimetre or two across and centimetres long, paler connective
// tissue between them. Seen across the fibres it is a stipple of ends; along them, stripes.
fn wall_grain(p: vec3<f32>, f0: vec3<f32>, px: f32) -> f32 {
    let f = normalize(f0 + vec3(1e-4));
    var up = vec3(0.0, 1.0, 0.0);
    if abs(f.y) >= 0.9 {
        up = vec3(1.0, 0.0, 0.0);
    }
    let a = normalize(cross(f, up));
    let b = cross(f, a);
    let q = vec3(dot(p, f) * 45.0, dot(p, a) * 650.0, dot(p, b) * 650.0);
    let fine = clamp(1.0 / (650.0 * px) - 1.0, 0.0, 1.0);
    let n = wall_noise(q);
    let m = wall_noise(q * vec3(0.5, 0.33, 0.33) + 7.0);
    let seam = 1.0 - smoothstep(0.0, 0.18, abs(n - 0.5));
    return mix(0.5, n * 0.6 + m * 0.4, fine) - 0.35 * seam * fine;
}

fn linear(c: vec3<f32>) -> vec3<f32> {
    return pow(c, vec3(2.2));
}

// The cavity's bottom under the wall (wall.rs `CAVITY`): in the head the brain, its folds pulped where the shot went,
// grey-pink under blood; in the trunk the dark of the cavity with blood standing in it, darker toward its middle.
fn cavity(in: VertexOutput, is_front: bool, p: vec3<f32>, px: f32, head: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    let t = clamp(in.uv.x - 1000.0, 0.0, 1.0);
    let n1 = mix(0.5, wall_noise(p * 160.0 + 13.0), fade(160.0, px));
    let n2 = mix(0.5, wall_noise(p * 520.0 + 5.0), fade(520.0, px));
    var c: vec3<f32>;
    var mm: f32;
    if head {
        c = mix(vec3(0.70, 0.56, 0.52), vec3(0.82, 0.70, 0.66), n2);
        mm = 0.03 + 0.4 * smoothstep(0.4, 0.75, n1);
    } else {
        c = vec3(0.30, 0.10, 0.09);
        mm = 0.3 + 0.6 * t;
    }
    pbr_input.material.base_color = vec4(blood_over(linear(c) * (1.0 - 0.6 * t), mm, 1.0), 1.0);
    pbr_input.material.perceptual_roughness = mix(0.45, 0.2, clamp(mm, 0.0, 1.0));
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    pbr_input.material.base_color = alpha_discard(pbr_input.material.flags, pbr_input.material.alpha_cutoff, pbr_input.material.base_color);
    let p = in.color.rgb;
    let k = u32(round(in.uv.y)) * 5u;
    let wa = columns[k];
    let wb = columns[k + 1u];
    let f1 = columns[k + 2u].xyz;
    let f2 = columns[k + 3u].xyz;
    let f3 = columns[k + 4u].xyz;
    let wz = columns[k + 2u].w;
    let px = max(length(dpdx(p)), length(dpdy(p)));
    // Burst open rather than cut (wall.rs: the columns' fourth's w), and the head (the fifth's).
    let torn = columns[k + 3u].w > 0.5;
    let head = columns[k + 4u].w > 0.5;
    if in.uv.x >= 999.0 {
        return cavity(in, is_front, p, px, head);
    }
    // Each boundary wanders by a millimetre or two along the face, as real layers do; torn, by several, and the
    // layers' faces are shredded, not sliced.
    var wander = (wall_noise(p * 160.0) - 0.5) * 2.4 + (mix(0.5, wall_noise(p * 650.0), fade(650.0, px)) - 0.5) * 0.6;
    if torn {
        wander += (wall_noise(p * 55.0 + 11.0) - 0.5) * 7.0 + (mix(0.5, wall_noise(p * 300.0 + 3.0), fade(300.0, px)) - 0.5) * 2.5;
    }
    let d = in.uv.x + wander * clamp(in.uv.x / 3.0, 0.0, 1.0);
    let deep = wb.w;
    let belly = wz > 3.5;
    var zone = wz;
    if belly {
        zone = wz - 4.0;
    }
    // Layers, outside in: dermis, fat, fascia/sheath, muscle 1-3, the ribs' zone, the lining.
    var c: vec3<f32>;
    var gloss = 0.35;
    var lift = 0.0;
    var oozes = 0.0;
    // (Fat L* 75-80, b* 20-25 and muscle beef's red-brown, as the cut faces: cutface.rs.)
    let fat_c = mix(vec3(0.80, 0.68, 0.54), vec3(0.88, 0.80, 0.64),
                    smoothstep(0.3, 0.7, mix(0.5, wall_noise(p * 300.0 + 5.0) * 0.65 + wall_noise(p * 800.0 + 9.0) * 0.35, fade(800.0, px))));
    let lob = mix(0.5, wall_noise(p * 300.0 + 5.0), fade(300.0, px));
    if d < wa.x {
        // The skin's cut edge: the thin darker epidermis on top, then the dense pale dermis.
        c = mix(vec3(0.55, 0.36, 0.30), vec3(0.84, 0.66, 0.60), smoothstep(0.1, 0.6, d));
        gloss = 0.3;
    } else if d < wa.y {
        // The septa between lobules, thin and white; the lobules stand out and catch the light.
        c = mix(fat_c, vec3(0.9, 0.86, 0.8), (1.0 - smoothstep(0.0, 0.06, abs(lob - 0.5))) * 0.5 * fade(300.0, px));
        lift = lob * 0.0012;
        gloss = 0.55;
    } else if d < wa.z {
        c = vec3(0.80, 0.77, 0.72) * (0.92 + 0.12 * mix(0.5, wall_noise(p * vec3(900.0, 120.0, 900.0)), fade(900.0, px)));
        gloss = 0.7;
    } else if d < wb.z {
        var f = vec3(0.0);
        if d < wa.w {
            f = f1;
        } else if d < wb.x {
            f = f2;
        } else if d < wb.y {
            f = f3;
        }
        let ribs = d >= wb.y;
        if ribs && zone > 0.5 {
            // A rib or the breastbone in section: a thin ivory cortex round dark red marrow; the front of a rib cartilage.
            let edge = min(d - wb.y, wb.z - d);
            let marrow = mix(vec3(0.40, 0.08, 0.06), vec3(0.58, 0.20, 0.13), mix(0.5, wall_noise(p * 900.0), fade(900.0, px)));
            if zone > 1.5 {
                c = vec3(0.80, 0.83, 0.86) * (0.95 + 0.08 * wall_noise(p * 200.0));
                gloss = 0.8;
            } else {
                c = mix(vec3(0.86, 0.82, 0.70), marrow, smoothstep(1.2, 2.0, edge));
                gloss = 0.45;
            }
        } else {
            // The intercostals run down and forward (the external) and down and back (the internal) between the ribs.
            if ribs {
                var s = 0.5;
                if p.x > 0.0 {
                    s = -0.5;
                }
                f = normalize(vec3(s, -0.85, -0.15));
            }
            let g = wall_grain(p, f, px);
            c = mix(vec3(0.32, 0.11, 0.10), vec3(0.52, 0.21, 0.19), g);
            if ribs {
                c *= 0.85;
            }
            gloss = 0.5;
            oozes = 1.0;
        }
        // The thin white fascia between one muscle and the next.
        let seam = min(min(abs(d - wa.w), abs(d - wb.x)), abs(d - wb.y));
        c = mix(c, vec3(0.78, 0.74, 0.68), (1.0 - smoothstep(0.15, 0.45, seam)) * 0.7);
    } else {
        // The lining: in the chest the endothoracic fascia and the parietal pleura, a glistening film; in the belly
        // yellow extraperitoneal fat, then the peritoneum.
        let t = (d - wb.z) / max(0.3, deep - wb.z);
        if belly {
            c = mix(fat_c * vec3(1.0, 0.95, 0.8), vec3(0.80, 0.70, 0.68), smoothstep(0.6, 0.9, t));
        } else {
            c = vec3(0.78, 0.64, 0.62);
        }
        gloss = 0.85;
    }
    let wall = linear(c);
    // Blood: a film over all of it, thick in the muscle and pooling toward the bottom, thin on the fat in patches.
    // (Millimetres of blood: a tenth of one is already nearly opaque red, so the film is thin where the layers must still
    // read, and thick only where it collects at the bottom.)
    let blotch = mix(0.5, wall_noise(p * 110.0 + 3.0), fade(110.0, px));
    let in_fat = step(wa.x, d) * step(d, wa.y);
    var mm = 0.006 + 0.035 * oozes * (0.3 + blotch) + 0.3 * smoothstep(0.75, 1.0, in.uv.x / max(deep, 1.0)) * blotch + (1.0 - smoothstep(0.25, 0.42, lob)) * 0.05 * in_fat;
    if torn {
        // Torn tissue bleeds from every face and the blast drives blood into it: most of it under a film of blood and
        // clot, the pale fat and the white of fascia showing through in tags and patches.
        let clot = mix(0.5, wall_noise(p * 70.0 + 21.0) * 0.6 + wall_noise(p * 240.0 + 2.0) * 0.4, fade(240.0, px));
        mm += 0.05 + 0.3 * smoothstep(0.25, 0.6, clot) + 0.04 * oozes;
    }
    pbr_input.material.base_color = vec4(blood_over(wall, mm, 1.0), 1.0);
    let wall_gloss = mix(gloss, 0.75, clamp(mm * 10.0, 0.0, 1.0));
    pbr_input.material.perceptual_roughness = 1.0 - wall_gloss;
    // The lobules and fascicles stand out of the face a little (in metres): the light catches them.
    var h = lift;
    if oozes > 0.5 {
        h += 0.0004 * mix(0.5, wall_noise(p * 650.0), fade(650.0, px));
    }
    if torn {
        // Shreds and tags of tissue standing off the torn faces.
        h += 0.0015 * mix(0.5, wall_noise(p * 180.0 + 4.0), fade(180.0, px)) + 0.0006 * mix(0.5, wall_noise(p * 520.0 + 8.0), fade(520.0, px));
    }
    let world = in.world_position.xyz;
    let dpx = dpdx(world);
    let dpy = dpdy(world);
    let dhx = dpdx(h);
    let dhy = dpdy(h);
    let n = pbr_input.N;
    let r1 = cross(dpy, n);
    let r2 = cross(n, dpx);
    let det = dot(dpx, r1);
    pbr_input.N = normalize(abs(det) * n - sign(det) * (dhx * r1 + dhy * r2));
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
