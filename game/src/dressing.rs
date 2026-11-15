// Dressings (src/sandbox/dressing.ts). For now the kit as it is held or hung on the board (buildKit): a roll of gauze
// and a medkit pouch, built in code. Dressing a wound with them is phase 2's, and the dressing's look phase 3's.

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::rng::Rng;

const ROLL: f32 = 0.1; // the gauze roll is 10 cm wide

// One mesh of a thing built in code, with its material and where it sits in the thing.
#[derive(Clone)]
pub struct Piece {
    pub mesh: Handle<Mesh>,
    pub material: Handle<StandardMaterial>,
    pub at: Transform,
}

// A canvas of `w` by `h` (sRGB bytes), painted on with alpha as a 2D canvas paints.
struct Canvas {
    w: usize,
    h: usize,
    px: Vec<[f32; 3]>,
}

impl Canvas {
    fn new(w: usize, h: usize, c: [u8; 3]) -> Self {
        Canvas { w, h, px: vec![c.map(|x| x as f32); w * h] }
    }

    fn put(&mut self, x: i32, y: i32, c: [u8; 3], a: f32) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        for i in 0..3 {
            p[i] += (c[i] as f32 - p[i]) * a;
        }
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: [u8; 3], a: f32) {
        for yy in y.round() as i32..(y + h).round() as i32 {
            for xx in x.round() as i32..(x + w).round() as i32 {
                self.put(xx, yy, c, a);
            }
        }
    }

    // A circle's outline a pixel wide (an arc stroked), or filled.
    fn circle(&mut self, cx: f32, cy: f32, r: f32, c: [u8; 3], a: f32, fill: bool) {
        for y in (cy - r - 1.0) as i32..=(cy + r + 1.0) as i32 {
            for x in (cx - r - 1.0) as i32..=(cx + r + 1.0) as i32 {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let cover = if fill { (r - d + 0.5).clamp(0.0, 1.0) } else { (1.0 - (d - r).abs()).clamp(0.0, 1.0) };
                if cover > 0.0 {
                    self.put(x, y, c, a * cover);
                }
            }
        }
    }

    fn image(&self) -> Image {
        let data = self.px.iter().flat_map(|p| [p[0].round() as u8, p[1].round() as u8, p[2].round() as u8, 255]).collect();
        Image::new(Extent3d { width: self.w as u32, height: self.h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data,
                   TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::default())
    }
}

// Each corner's u put in the left half of the texture where `left` says, the right half elsewhere.
fn halves(mut mesh: Mesh, left: impl Fn(Vec3) -> bool) -> Mesh {
    let normals: Vec<Vec3> = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(n)) => n.iter().map(|&n| Vec3::from(n)).collect(),
        _ => unreachable!(),
    };
    if let Some(VertexAttributeValues::Float32x2(uv)) = mesh.attribute_mut(Mesh::ATTRIBUTE_UV_0) {
        for (t, n) in uv.iter_mut().zip(normals) {
            t[0] = if left(n) { t[0] * 0.5 } else { 0.5 + t[0] * 0.5 };
        }
    }
    mesh
}

// A tube of `radius` along `path`, `sides` round.
fn tube(path: &[Vec3], radius: f32, sides: usize) -> Mesh {
    let (mut p, mut n, mut uv, mut i) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (k, &at) in path.iter().enumerate() {
        let along = (path[(k + 1).min(path.len() - 1)] - path[k.saturating_sub(1)]).normalize();
        let a = along.any_orthonormal_vector();
        let b = along.cross(a);
        for s in 0..=sides {
            let t = s as f32 / sides as f32 * std::f32::consts::TAU;
            let out = a * t.cos() + b * t.sin();
            p.push(at + out * radius);
            n.push(out);
            uv.push(Vec2::new(s as f32 / sides as f32, k as f32 / (path.len() - 1) as f32));
        }
    }
    let ring = sides as u32 + 1;
    for k in 0..path.len() as u32 - 1 {
        for s in 0..sides as u32 {
            let (a, b) = (k * ring + s, (k + 1) * ring + s);
            i.extend([a, a + 1, b, b, a + 1, b + 1]);
        }
    }
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, p)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, n)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_indices(Indices::U32(i))
}

// The bandage roll and the medkit, as the TS built them (in its space, brought over by main.rs `babylon`: a turn about
// X or Z the other way).
pub fn kit(meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>, images: &mut Assets<Image>, rng: &mut Rng) -> [(&'static str, Vec<Piece>); 2] {
    // Left half: the outside of the roll, its crinkled weave. Right half: an end, the turns showing as rings.
    let mut gauze = Canvas::new(256, 256, [238, 237, 231]);
    for x in (0..128).step_by(2) {
        let (c, a) = if x % 4 != 0 { ([150, 145, 135], 0.2) } else { ([255, 255, 255], 0.4) };
        gauze.rect(x as f32, 0.0, 1.0, 256.0, c, a);
    }
    let mut r = 10.0;
    while r < 62.0 {
        gauze.circle(192.0, 128.0, r, [150, 145, 135], 0.15 + rng.next() * 0.2, false);
        r += 2.2;
    }
    gauze.circle(192.0, 128.0, 9.0, [205, 200, 188], 1.0, true);
    let white = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(gauze.image())),
        metallic: 0.0,
        perceptual_roughness: 0.95,
        double_sided: true,
        cull_mode: None,
        ..default()
    });
    let body = halves(Cylinder::new(0.025, ROLL).mesh().resolution(28).into(), |n| n.y.abs() < 0.5);
    let bandage = vec![
        Piece { mesh: meshes.add(body), material: white.clone(), at: Transform::from_rotation(Quat::from_rotation_z(-std::f32::consts::FRAC_PI_2)) },
        Piece {
            mesh: meshes.add(Rectangle::new(ROLL, 0.07)),
            material: white,
            at: Transform::from_translation(crate::babylon(0.0, -0.035, -0.025)).with_rotation(Quat::from_rotation_x(-0.15)),
        },
    ];

    // Left: the front, nylon with the cross on it. Right: the rest of the pouch, plain.
    let mut face = Canvas::new(512, 256, [18, 104, 58]);
    for x0 in [0.0, 256.0] {
        face.rect(x0, 0.0, 256.0, 256.0, [18, 104, 58], 1.0);
        for _ in 0..2500 {
            let (c, a) = if rng.next() < 0.5 { ([0, 0, 0], 0.12) } else { ([255, 255, 255], 0.05) };
            let (x, y) = (x0 + rng.next() * 256.0, rng.next() * 256.0);
            face.rect(x, y, 2.0, 1.0, c, a);
        }
        // The stitching round the edge, dashed.
        let mut t = 0.0;
        while t < 960.0 {
            for d in 0..6 {
                let s = t + d as f32;
                let (x, y) = if s < 240.0 { (8.0 + s, 8.0) } else if s < 480.0 { (248.0, 8.0 + s - 240.0) } else if s < 720.0 { (248.0 - (s - 480.0), 248.0) } else { (8.0, 248.0 - (s - 720.0)) };
                face.rect(x0 + x - 1.5, y - 1.5, 3.0, 3.0, [0, 0, 0], 0.45);
            }
            t += 10.0;
        }
    }
    face.rect(128.0 - 22.0, 128.0 - 70.0, 44.0, 140.0, [240, 240, 236], 1.0);
    face.rect(128.0 - 70.0, 128.0 - 22.0, 140.0, 44.0, [240, 240, 236], 1.0);
    let nylon = materials.add(StandardMaterial {
        base_color_texture: Some(images.add(face.image())),
        metallic: 0.0,
        perceptual_roughness: 0.75,
        ..default()
    });
    // (The cross on the faces ahead and behind, the rest plain.)
    let pouch = halves(Cuboid::new(0.22, 0.15, 0.08).into(), |n| n.z.abs() > 0.5);
    let strap: Vec<Vec3> = (0..9).map(|k| {
        let t = k as f32 / 8.0;
        crate::babylon(-0.06 + 0.12 * t, 0.075 + (std::f32::consts::PI * t).sin() * 0.035, 0.0)
    }).collect();
    let black = materials.add(StandardMaterial { base_color: Color::linear_rgb(0.03, 0.03, 0.03), metallic: 0.0, perceptual_roughness: 0.8, ..default() });
    let medkit = vec![
        Piece { mesh: meshes.add(pouch), material: nylon, at: Transform::IDENTITY },
        Piece { mesh: meshes.add(tube(&strap, 0.006, 8)), material: black, at: Transform::IDENTITY },
    ];
    [("bandage", bandage), ("medkit", medkit)]
}
