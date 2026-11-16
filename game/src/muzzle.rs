// The flash at a gun's muzzle, and the puff of gas and smoke after it (src/sandbox/muzzle.ts, dev/research/muzzle-flash.md).
//
// A real flash lasts one to three milliseconds, so it is drawn for one frame: a hot core at the muzzle face (the primary
// flash), a reddish knot a few centimetres out where the gas stands behind its Mach disc (the intermediate flash), and,
// for ammunition without flash suppressant, a faint larger haze of afterburn (secondary flash). Its shape is the
// muzzle's: an open crown throws a cone, an A2 birdcage splits it into tongues out of its five slots (none down), a 12
// bore a big orange ball. What it lights is the one lamp kept for it; after it, a few grey puffs that drift and thin, and
// on some guns sparks of unburnt powder. Everything is made once, at load: a shot only moves what exists.
//
// Also here, as weapons.ts kept them with the flash: the grenade's flash and smoke, the bullet holes' look, the brass.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::light::NotShadowCaster;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::map::CANDELA;
use crate::player::Player;

// Per gun, in metres: `long` how far forward the side view reaches, `high` its height, `face` the end-on view's width,
// `back` how far behind the muzzle face the side view starts (the birdcage vents through slots up to 4 cm back), `core`
// the primary flash's radius, `knot` the intermediate flash's distance out (0: none, the birdcage breaks up the shock
// bottle), `haze` the secondary flash's radius (0: suppressed), `light` the lamp's peak, `puffs` and `sparks`. Sizes are
// estimates from photographs and the phases' descriptions (no measured sizes were found, see the notes).
#[derive(Clone, Copy)]
struct Look {
    long: f32,
    high: f32,
    face: f32,
    back: f32,
    core: f32,
    knot: f32,
    haze: f32,
    light: f32,
    puffs: u32,
    sparks: u32,
    slots: bool,
    ball: bool,
}

const L: Look = Look { long: 0.0, high: 0.0, face: 0.0, back: 0.0, core: 0.0, knot: 0.0, haze: 0.0, light: 0.0, puffs: 0, sparks: 0, slots: false, ball: false };
const LOOKS: [(&str, Look); 7] = [
    ("pistol", Look { long: 0.1, high: 0.06, face: 0.06, back: 0.005, core: 0.012, knot: 0.035, haze: 0.0, light: 10.0, puffs: 2, sparks: 2, ..L }),
    ("m4", Look { long: 0.08, high: 0.09, face: 0.09, back: 0.04, core: 0.009, knot: 0.0, haze: 0.0, light: 12.0, puffs: 3, sparks: 0, slots: true, ..L }),
    ("ak", Look { long: 0.24, high: 0.12, face: 0.13, back: 0.005, core: 0.02, knot: 0.075, haze: 0.05, light: 35.0, puffs: 4, sparks: 5, ..L }),
    ("rifle", Look { long: 0.26, high: 0.11, face: 0.12, back: 0.005, core: 0.022, knot: 0.1, haze: 0.03, light: 45.0, puffs: 4, sparks: 3, ..L }),
    ("shotgun", Look { long: 0.34, high: 0.24, face: 0.26, back: 0.005, core: 0.05, knot: 0.0, haze: 0.11, light: 60.0, puffs: 6, sparks: 24, ball: true, ..L }),
    // .50 AE from a 6 inch barrel: a big charge of slow pistol powder still burning at the muzzle, a ball of flame and
    // afterburn bigger than a rifle's from the side, sparks of unburnt powder. A .22 LR from an 18.5 inch barrel has burnt
    // nearly all its few grains: a pinprick, hardly any light or smoke (estimates from photographs, as above).
    ("deagle", Look { long: 0.24, high: 0.17, face: 0.19, back: 0.005, core: 0.03, knot: 0.08, haze: 0.07, light: 55.0, puffs: 5, sparks: 10, ..L }),
    ("r22", Look { long: 0.03, high: 0.018, face: 0.018, back: 0.003, core: 0.0035, knot: 0.0, haze: 0.0, light: 1.5, puffs: 1, sparks: 0, ..L }),
];
const VARIANTS: u32 = 4; // four takes a gun, each a row of the atlas: the end-on view, then the side
const ROW: f32 = 128.0;
const ATLAS: usize = 512;

fn look(key: &str) -> Look {
    LOOKS.iter().find(|l| l.0 == key).map_or(LOOKS[0].1, |l| l.1)
}

// A smoke puff or a spark in flight.
struct Speck {
    e: Entity,
    at: Vec3,
    v: Vec3,
    age: f32,
    life: f32,
    size: f32,
    spin: f32,
    turn: f32,
    smoke: bool,
}

#[derive(Resource)]
pub struct Muzzle {
    flames: HashMap<&'static str, Entity>,
    meshes: HashMap<&'static str, Handle<Mesh>>,
    shown: Option<(Entity, u32)>,
    lamp: Entity,
    peak: f32,
    at: f32,
    card: Entity,
    card_shown: bool,
    specks: Vec<Speck>,
    free_smoke: Vec<(Entity, Handle<StandardMaterial>)>,
    free_sparks: Vec<Entity>,
    smoke_materials: HashMap<Entity, Handle<StandardMaterial>>,
    dice: u32,
    pub hole: (Handle<Mesh>, Handle<StandardMaterial>),
    pub brass: Handle<StandardMaterial>,
    // The puffs' look: the muzzle's lumpy one, the grenade's soft round one (white, see-through by its alpha).
    puff: Handle<Image>,
    cloud: Handle<Image>,
    // A shot asked for since the flame was last placed: (key, tip in the hand, muzzle, bore) and the shot's dice.
    asked: Option<(&'static str, Vec3, Vec3, Vec3, f32)>,
    burst_at: Option<(Vec3, f32)>,
}

impl Muzzle {
    // Its own dice, so how a flash looks never changes what the game's own random numbers do next.
    fn dice(&mut self) -> f32 {
        self.dice = self.dice.wrapping_mul(1664525).wrapping_add(1013904223);
        self.dice as f32 / 4294967296.0
    }

    // A shot from gun `key`, its muzzle at `tip` in the hand's frame, `at` the muzzle and `ahead` the bore in the world.
    pub fn fire(&mut self, key: &'static str, tip: Vec3, at: Vec3, ahead: Vec3, now: f32, dice: f32) {
        self.asked = Some((key, tip, at, ahead, dice));
        self.peak = look(key).light;
        self.at = now;
    }

    // The grenade's flash: a lamp over where it went off, and the card of light.
    pub fn burst(&mut self, at: Vec3, now: f32, turn: f32) {
        self.peak = -900.0; // (negative: a grenade's, placed by `flash` with its range)
        self.at = now;
        self.asked = None;
        self.card_shown = true;
        self.burst_at = Some((at, turn));
    }
}

fn rgba(s: &str) -> [f32; 4] {
    let v: Vec<f32> = s.trim_start_matches("rgba(").trim_end_matches(')').split(',').map(|x| x.trim().parse().unwrap()).collect();
    [v[0] / 255.0, v[1] / 255.0, v[2] / 255.0, v[3]]
}

// A canvas painted as a 2D canvas paints with 'lighter': each blob's light added (premultiplied), clamped.
struct Canvas {
    w: usize,
    px: Vec<[f32; 4]>,
}

impl Canvas {
    // A soft glowing patch: an ellipse `rx` by `ry` pixels at (x, y), turned `turn`, from `inner` at its middle through
    // `mid` (at 0.45) to nothing.
    #[allow(clippy::too_many_arguments)]
    fn blob(&mut self, x: f32, y: f32, rx: f32, ry: f32, inner: [f32; 4], mid: [f32; 4], turn: f32) {
        let (rx, ry) = (rx.abs().max(0.01), ry.abs().max(0.01));
        let r = rx.max(ry);
        let h = self.px.len() / self.w;
        let (c, s) = (turn.cos(), turn.sin());
        for py in ((y - r).floor().max(0.0) as usize)..((y + r).ceil().min(h as f32) as usize) {
            for px in ((x - r).floor().max(0.0) as usize)..((x + r).ceil().min(self.w as f32) as usize) {
                let (dx, dy) = (px as f32 + 0.5 - x, py as f32 + 0.5 - y);
                let (u, v) = ((dx * c + dy * s) / rx, (-dx * s + dy * c) / ry);
                let d = (u * u + v * v).sqrt();
                if d > 1.0 {
                    continue;
                }
                let col = if d < 0.45 {
                    let t = d / 0.45;
                    [0, 1, 2, 3].map(|i| inner[i] + (mid[i] - inner[i]) * t)
                } else {
                    let t = (d - 0.45) / 0.55;
                    [0, 1, 2, 3].map(|i| if i == 3 { mid[3] * (1.0 - t) } else { mid[i] })
                };
                let p = &mut self.px[py * self.w + px];
                for i in 0..3 {
                    p[i] = (p[i] + col[i] * col[3]).min(1.0);
                }
                p[3] = (p[3] + col[3]).min(1.0);
            }
        }
    }

    // As an image of white, as see-through as what was painted on it.
    fn alpha(&self) -> Image {
        let h = self.px.len() / self.w;
        let data: Vec<u8> = self.px.iter().flat_map(|p| [255, 255, 255, (p[3].clamp(0.0, 1.0) * 255.0).round() as u8]).collect();
        Image::new(Extent3d { width: self.w as u32, height: h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data,
                   TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD)
    }

    // As an image to add: each pixel's light, its alpha one (AlphaMode::Add adds colour times alpha).
    fn image(&self, linear: bool) -> Image {
        let h = self.px.len() / self.w;
        let data: Vec<u8> = self.px.iter().flat_map(|p| [p[0], p[1], p[2], if linear { p[3] } else { 1.0 }].map(|x| (x.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
        Image::new(Extent3d { width: self.w as u32, height: h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, data,
                   if linear { TextureFormat::Rgba8Unorm } else { TextureFormat::Rgba8UnormSrgb }, RenderAssetUsages::RENDER_WORLD)
    }
}

fn seeded(mut s: u32) -> impl FnMut() -> f32 {
    move || {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        s as f32 / 4294967296.0
    }
}

// The atlas: VARIANTS takes of the end-on view and the side view, drawn from the phases (research note), added up as
// light adds up. Colours: the core near white (hottest), the cone yellow-orange, the Mach knot reddish orange, the
// afterburn a dim orange.
fn draw(g: &mut Canvas, look: &Look, key: &str) {
    let mut rnd = seeded(key.len() as u32 * 977 + key.as_bytes()[0] as u32);
    let core = [rgba("rgba(255,250,232,1)"), rgba("rgba(255,214,140,0.75)")];
    let cone = [rgba("rgba(255,196,96,0.55)"), rgba("rgba(255,140,48,0.3)")];
    let knot = [rgba("rgba(255,150,70,0.7)"), rgba("rgba(230,80,30,0.35)")];
    let haze = [rgba("rgba(255,140,60,0.16)"), rgba("rgba(200,80,30,0.08)")];
    let atlas = ATLAS as f32;
    for row in 0..VARIANTS {
        let top = row as f32 * ROW;
        // End-on: what the shooter mostly sees, the bore pointing away.
        let (fx, fy, fk) = (ROW / 2.0, top + ROW / 2.0, ROW / look.face);
        if look.haze > 0.0 {
            for _ in 0..6 {
                let (a, b, c, d, t) = (rnd(), rnd(), rnd(), rnd(), rnd());
                g.blob(fx + (a - 0.5) * look.haze * fk * 0.6, fy + (b - 0.5) * look.haze * fk * 0.6, look.haze * fk * (0.5 + c * 0.3), look.haze * fk * (0.4 + d * 0.3), haze[0], haze[1], t * 6.0);
            }
        }
        if look.slots {
            // Five tongues through the birdcage's slots, sixty degrees apart from the top, none through its closed bottom.
            for a in [0.0f32, 60.0, -60.0, 120.0, -120.0] {
                let t = a.to_radians();
                let len = look.core * fk * (2.4 + rnd() * 1.4);
                g.blob(fx + t.sin() * len * 0.75, fy - t.cos() * len * 0.75, len * 0.7, look.core * fk * 0.35, cone[0], cone[1], t - std::f32::consts::FRAC_PI_2);
            }
        } else {
            let n = if look.ball { 14 } else { 9 };
            for _ in 0..n {
                let t = rnd() * std::f32::consts::TAU;
                let r = look.core * fk * if look.ball { 1.2 + rnd() * 1.6 } else { 0.9 + rnd() * 1.1 };
                let (a, b) = (rnd(), rnd());
                g.blob(fx + t.cos() * r * 0.6, fy + t.sin() * r * 0.6, r * (0.5 + a * 0.4), r * (0.3 + b * 0.3), cone[0], cone[1], t);
            }
            if look.knot > 0.0 {
                g.blob(fx, fy, look.core * fk * 1.6, look.core * fk * 1.6, knot[1], rgba("rgba(200,70,25,0.15)"), 0.0);
            }
        }
        let big = if look.ball { (1.4, 1.3) } else { (1.0, 1.0) };
        g.blob(fx, fy, look.core * fk * big.0, look.core * fk * big.1, core[0], core[1], 0.0);
        // From the side: the bore along the middle, the muzzle face `back` from the left edge.
        let sk = (atlas - ROW) / (look.long + look.back);
        let (sx, sy) = (ROW + look.back * sk, top + ROW / 2.0);
        if look.haze > 0.0 {
            for _ in 0..7 {
                let x = sx + (if look.knot > 0.0 { look.knot } else { look.core * 3.0 }) * sk + rnd() * look.haze * sk * 1.6;
                let (a, b, c, d) = (rnd(), rnd(), rnd(), rnd());
                g.blob(x, sy + (a - 0.5) * look.haze * sk * 0.6, look.haze * sk * (0.5 + b * 0.4), look.haze * sk * (0.35 + c * 0.3), haze[0], haze[1], (d - 0.5) * 0.8);
            }
        }
        if look.slots {
            // The tongues come out of the slots along the last few centimetres, up and out, and a small core ahead.
            for i in 0..4 {
                let x = sx - (0.008 + i as f32 * 0.009) * sk;
                let len = look.core * sk * (2.2 + rnd() * 1.6);
                let t = rnd();
                g.blob(x + len * 0.25, sy - len * 0.7, len * 0.75, look.core * sk * 0.3, cone[0], cone[1], -std::f32::consts::FRAC_PI_2 + 0.35 + (t - 0.5) * 0.3);
            }
        } else {
            // The cone of hot gas forward, broken up, then the Mach knot: a disc dished toward the gun.
            let reach = (if look.knot > 0.0 { look.knot } else { look.core * 4.0 }) * (0.9 + rnd() * 0.3);
            for _ in 0..(if look.ball { 16 } else { 10 }) {
                let along = rnd() * reach;
                let w = look.core * if look.ball { 1.2 } else { 0.7 } * (0.6 + along / reach);
                let (a, b, c, d) = (rnd(), rnd(), rnd(), rnd());
                g.blob(sx + along * sk, sy + (a - 0.5) * w * sk * 0.8, w * sk * (0.8 + b * 0.6), w * sk * (0.5 + c * 0.4), cone[0], cone[1], (d - 0.5) * 0.5);
            }
            if look.knot > 0.0 {
                g.blob(sx + look.knot * sk, sy, look.core * sk * 0.55, look.core * sk * 1.25, knot[0], knot[1], 0.0);
            }
        }
        let side = if look.ball { (1.5, 1.3) } else { (1.15, 0.9) };
        g.blob(sx + look.core * sk * 0.5, sy, look.core * sk * side.0, look.core * sk * side.1, core[0], core[1], 0.0);
    }
}

// The cards' places in the atlas for take `row`: the end-on view in its first ROW pixels, the side view in the rest, the
// bore along the side view's middle (Bevy's v runs down the image, as the canvas's y did).
fn uvs(row: u32) -> Vec<[f32; 2]> {
    let top = row as f32 * ROW;
    let u = |px: f32| px / ATLAS as f32;
    let v = |py: f32| py / ATLAS as f32;
    let (s0, s1, mid, up, down) = (u(ROW), u(ATLAS as f32), v(top + ROW / 2.0), v(top), v(top + ROW));
    vec![
        [s0, down], [s0, up], [s1, up], [s1, down],
        [s0, mid], [s0, up], [s1, up], [s1, mid],
        [s0, mid], [s0, up], [s1, up], [s1, mid],
        [u(0.0), down], [u(0.0), up], [u(ROW), up], [u(ROW), down],
    ]
}

// The flame's cards in the muzzle's frame (the TS's +z along the bore, here -Z): a vertical side view, a horizontal one
// made of two halves each running from the bore out (so the birdcage's tongues, drawn only upward, show on both sides and
// never below), and an end-on card just ahead of the muzzle face.
fn flame(look: &Look) -> Mesh {
    let (h, f, z0, z1, zf) = (look.high / 2.0, look.face / 2.0, look.back, -look.long, -0.004);
    let positions: Vec<[f32; 3]> = vec![
        [0.0, -h, z0], [0.0, h, z0], [0.0, h, z1], [0.0, -h, z1],
        [0.0, 0.0, z0], [-h, 0.0, z0], [-h, 0.0, z1], [0.0, 0.0, z1],
        [0.0, 0.0, z0], [h, 0.0, z0], [h, 0.0, z1], [0.0, 0.0, z1],
        [-f, -f, zf], [-f, f, zf], [f, f, zf], [f, -f, zf],
    ];
    let indices: Vec<u32> = (0..4).flat_map(|q| [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]).collect();
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0, 0.0, 1.0]; 16])
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uvs(0))
        .with_inserted_indices(Indices::U32(indices))
}

fn glow(images: &mut Assets<Image>, materials: &mut Assets<StandardMaterial>, canvas: &Canvas) -> Handle<StandardMaterial> {
    materials.add(StandardMaterial {
        base_color_texture: Some(images.add(canvas.image(false))),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        double_sided: true,
        cull_mode: None,
        ..default()
    })
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    hand: Res<crate::weapons::Hand>,
) {
    let Some(he) = hand.entity else { return };
    let mut flames = HashMap::new();
    let mut flame_meshes = HashMap::new();
    for (key, look) in LOOKS {
        let mut g = Canvas { w: ATLAS, px: vec![[0.0; 4]; ATLAS * ATLAS] };
        draw(&mut g, &look, key);
        let mesh = meshes.add(flame(&look));
        let material = glow(&mut images, &mut materials, &g);
        let e = commands.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(material), Transform::default(), Visibility::Hidden, NotShadowCaster, ChildOf(he), Name::new(format!("flame {key}")))).id();
        flames.insert(key, e);
        flame_meshes.insert(key, mesh);
    }
    let lamp = commands.spawn((PointLight { intensity: 0.0, range: 8.0, color: Color::linear_rgb(1.0, 0.75, 0.45), shadow_maps_enabled: false, ..default() }, Transform::default(), Name::new("muzzle lamp"))).id();
    // The grenade's flash card: a star of five rays and a disc (weapons.ts flashTexture).
    let mut star = Canvas { w: 128, px: vec![[0.0; 4]; 128 * 128] };
    for y in 0..128 {
        for x in 0..128 {
            let (dx, dy) = (x as f32 + 0.5 - 64.0, y as f32 + 0.5 - 64.0);
            let r = (dx * dx + dy * dy).sqrt();
            // In a ray (a thin triangle from the middle out to 62 px, 12 px wide at its base) or the disc.
            let ray = (0..5).any(|k| {
                let a = k as f32 / 5.0 * std::f32::consts::TAU + 0.3;
                let (along, across) = (dx * a.sin() - dy * a.cos(), dx * a.cos() + dy * a.sin());
                along > 0.0 && along < 62.0 && across.abs() < 6.0 * (1.0 - along / 62.0)
            });
            if ray || r < 26.0 {
                let c = star_colour((r / 64.0).min(1.0));
                star.px[y * 128 + x] = [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
            }
        }
    }
    let card = commands
        .spawn((Mesh3d(meshes.add(Rectangle::new(0.16, 0.16))), MeshMaterial3d(glow(&mut images, &mut materials, &star)), Transform::default(), Visibility::Hidden,
                NotShadowCaster, Name::new("grenade flash")))
        .id();
    // A bullet hole: dark in the middle to nothing at its edge (weapons.ts holeTexture).
    let mut hole = Canvas { w: 64, px: vec![[0.0; 4]; 64 * 64] };
    for y in 0..64 {
        for x in 0..64 {
            let d = (((x as f32 + 0.5 - 32.0).powi(2) + (y as f32 + 0.5 - 32.0).powi(2)).sqrt() / 32.0).min(1.0);
            let stops = [(0.0, [10.0, 9.0, 8.0, 1.0]), (0.3, [25.0, 22.0, 20.0, 0.95]), (0.55, [70.0, 65.0, 60.0, 0.5]), (1.0, [90.0, 85.0, 80.0, 0.0])];
            let k = stops.iter().rposition(|s| s.0 <= d).unwrap().min(2);
            let t = (d - stops[k].0) / (stops[k + 1].0 - stops[k].0);
            let c = [0, 1, 2, 3].map(|i| stops[k].1[i] + (stops[k + 1].1[i] - stops[k].1[i]) * t);
            hole.px[y * 64 + x] = [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0, c[3]];
        }
    }
    let hole_image = {
        let data: Vec<u8> = hole.px.iter().flat_map(|p| p.map(|x| (x.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
        images.add(Image::new(Extent3d { width: 64, height: 64, depth_or_array_layers: 1 }, TextureDimension::D2, data, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD))
    };
    let hole_material = materials.add(StandardMaterial {
        base_color_texture: Some(hole_image),
        alpha_mode: AlphaMode::Blend,
        metallic: 0.0,
        perceptual_roughness: 0.9,
        depth_bias: 2.0,
        ..default()
    });
    let brass = materials.add(StandardMaterial { base_color: Color::linear_rgb(0.78, 0.56, 0.24), metallic: 1.0, perceptual_roughness: 0.3, ..default() });
    // A muzzle's puff: lumpy, not a clean disc, a few overlapping soft blobs (muzzle.ts puffTexture). A grenade's: a soft
    // round cloud (weapons.ts smoke), 0.55 at its middle, 0.18 at six tenths out, nothing at its edge.
    let mut puff = Canvas { w: 64, px: vec![[0.0; 4]; 64 * 64] };
    let mut rnd = seeded(7);
    for _ in 0..7 {
        let (a, b, c, d, t) = (rnd(), rnd(), rnd(), rnd(), rnd());
        puff.blob(32.0 + (a - 0.5) * 18.0, 32.0 + (b - 0.5) * 18.0, 12.0 + c * 9.0, 11.0 + d * 8.0, [1.0, 1.0, 1.0, 0.5], [1.0, 1.0, 1.0, 0.22], t * 6.0);
    }
    let mut cloud = Canvas { w: 64, px: vec![[0.0; 4]; 64 * 64] };
    for y in 0..64 {
        for x in 0..64 {
            let d = (((x as f32 + 0.5 - 32.0).powi(2) + (y as f32 + 0.5 - 32.0).powi(2)).sqrt() / 32.0).min(1.0);
            let a = if d < 0.6 { 0.55 + (0.18 - 0.55) * d / 0.6 } else { 0.18 * (1.0 - (d - 0.6) / 0.4) };
            cloud.px[y * 64 + x] = [1.0, 1.0, 1.0, a];
        }
    }
    let (puff, cloud) = (images.add(puff.alpha()), images.add(cloud.alpha()));
    commands.insert_resource(Muzzle {
        flames,
        meshes: flame_meshes,
        shown: None,
        lamp,
        peak: 0.0,
        at: 0.0,
        card,
        card_shown: false,
        specks: Vec::new(),
        free_smoke: Vec::new(),
        free_sparks: Vec::new(),
        smoke_materials: HashMap::new(),
        dice: 20261113,
        hole: (meshes.add(Rectangle::new(1.0, 1.0)), hole_material),
        brass,
        puff,
        cloud,
        asked: None,
        burst_at: None,
    });
    let _ = &mut *images;
}

fn star_colour(d: f32) -> [f32; 4] {
    let stops = [(0.0, rgba("rgba(255,250,230,1)")), (0.25, rgba("rgba(255,190,90,0.9)")), (1.0, rgba("rgba(255,120,30,0)"))];
    let k = if d < 0.25 { 0 } else { 1 };
    let t = ((d - stops[k].0) / (stops[k + 1].0 - stops[k].0)).clamp(0.0, 1.0);
    [0, 1, 2, 3].map(|i| stops[k].1[i] + (stops[k + 1].1[i] - stops[k].1[i]) * t)
}

// Every frame: the flame shown for the one frame drawn after the shot, the lamp going as fast as it came (by the clock,
// not by frames: a frame held up by a limb coming off must not keep a flash on screen), the puffs and sparks.
#[allow(clippy::too_many_arguments)]
fn update(
    mut commands: Commands,
    mut muzzle: ResMut<Muzzle>,
    time: Res<Time>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut transforms: Query<&mut Transform, Without<Player>>,
    mut vis: Query<&mut Visibility>,
    mut lamps: Query<&mut PointLight>,
    eye: Query<&Transform, With<Player>>,
    mut quad: Local<Option<Handle<Mesh>>>,
    mut spark_material: Local<Option<Handle<StandardMaterial>>>,
) {
    let m = &mut *muzzle;
    let now = time.elapsed_secs();
    let dt = time.delta_secs();
    let eye = eye.single().copied().unwrap_or_default();
    // Last frame's flame drawn: gone.
    if let Some((e, _)) = m.shown.take() {
        if let Ok(mut v) = vis.get_mut(e) {
            *v = Visibility::Hidden;
        }
    }
    let quad = quad.get_or_insert_with(|| meshes.add(Rectangle::new(1.0, 1.0))).clone();
    let spark_material = spark_material
        .get_or_insert_with(|| materials.add(StandardMaterial { base_color: Color::linear_rgb(1.0, 0.7, 0.35), unlit: true, alpha_mode: AlphaMode::Add, ..default() }))
        .clone();
    if let Some((key, tip, at, ahead, _)) = m.asked.take() {
        let look = look(key);
        let k = if m.flames.contains_key(key) { key } else { "pistol" };
        let e = m.flames[k];
        // Each shot its own take, size and (but for the birdcage, whose slots are where they are) turn about the bore.
        let roll = if look.slots { 0.0 } else { m.dice() * std::f32::consts::TAU };
        let size = 0.8 + m.dice() * 0.4;
        let row = (m.dice() * VARIANTS as f32) as u32 % VARIANTS;
        if let Some(mut mesh) = meshes.get_mut(&m.meshes[k]) {
            mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, VertexAttributeValues::Float32x2(uvs(row)));
        }
        if let Ok(mut t) = transforms.get_mut(e) {
            *t = Transform::from_translation(tip).with_rotation(Quat::from_rotation_z(roll)).with_scale(Vec3::splat(size));
        }
        if let Ok(mut v) = vis.get_mut(e) {
            *v = Visibility::Inherited;
        }
        m.shown = Some((e, 0));
        if let Ok(mut t) = transforms.get_mut(m.lamp) {
            t.translation = at;
        }
        if let Ok(mut l) = lamps.get_mut(m.lamp) {
            l.range = 8.0;
        }
        // The gas and smoke: soft grey puffs out along the bore, rising a little, swelling and thinning over a second or so.
        let side = ahead.cross(Vec3::Y).normalize();
        let up = side.cross(ahead).normalize();
        for _ in 0..look.puffs {
            let (a, b, c) = (m.dice(), m.dice(), m.dice());
            let dir = (ahead + up * (0.2 + 0.1 * a) + (side + up) * (b - 0.5) * 0.7).normalize();
            let size = 0.03 + c * 0.03;
            let (life, turn, spin) = (0.7 + m.dice() * 0.7, m.dice() * std::f32::consts::TAU, (m.dice() - 0.5) * 1.2);
            let v = dir * (0.3 + m.dice() * 0.6);
            let (e, _) = match m.free_smoke.pop() {
                Some(x) => x,
                None => {
                    let mat = materials.add(StandardMaterial { base_color: Color::linear_rgba(0.62, 0.6, 0.58, 0.16), base_color_texture: Some(m.puff.clone()), unlit: true, alpha_mode: AlphaMode::Blend, ..default() });
                    let e = commands.spawn((Mesh3d(quad.clone()), MeshMaterial3d(mat.clone()), Transform::from_translation(at).with_scale(Vec3::ZERO), NotShadowCaster, Name::new("muzzle smoke"))).id();
                    m.smoke_materials.insert(e, mat.clone());
                    (e, mat)
                }
            };
            m.specks.push(Speck { e, at: at + ahead * 0.03, v, age: 0.0, life, size, spin, turn, smoke: true });
        }
        // Unburnt powder and fouling thrown out burning: short bright streaks that fall and go out within a fifth of a second.
        if look.sparks > 0 {
            let n = (look.sparks as f32 * (0.5 + m.dice())).round() as u32;
            for _ in 0..n {
                let (a, b) = (m.dice() - 0.5, m.dice() - 0.5);
                let dir = (ahead + side * a * 0.5 + up * b * 0.5).normalize();
                let v = dir * (6.0 + m.dice() * 12.0);
                let (life, size) = (0.04 + m.dice() * 0.16, 0.002 + m.dice() * 0.002);
                let e = m.free_sparks.pop().unwrap_or_else(|| {
                    commands.spawn((Mesh3d(quad.clone()), MeshMaterial3d(spark_material.clone()), Transform::from_translation(at).with_scale(Vec3::ZERO), NotShadowCaster, Name::new("spark"))).id()
                });
                m.specks.push(Speck { e, at, v, age: 0.0, life, size, spin: 0.0, turn: 0.0, smoke: false });
            }
        }
    }
    // The grenade's flash and its smoke: a grey cloud rising and spreading for a few seconds.
    if let Some((at, turn)) = m.burst_at.take() {
        if let Ok(mut t) = transforms.get_mut(m.lamp) {
            t.translation = at + Vec3::Y * 0.3;
        }
        if let Ok(mut l) = lamps.get_mut(m.lamp) {
            l.range = 16.0;
        }
        if let Ok(mut t) = transforms.get_mut(m.card) {
            *t = Transform::from_translation(at + Vec3::Y * 0.25).with_rotation(eye.rotation * Quat::from_rotation_z(turn)).with_scale(Vec3::splat(6.0));
        }
        if let Ok(mut v) = vis.get_mut(m.card) {
            *v = Visibility::Inherited;
        }
        for _ in 0..90 {
            let (a, b, c) = (m.dice() * 2.0 - 1.0, m.dice() * std::f32::consts::TAU, m.dice());
            let r = (1.0 - a * a).sqrt();
            let dir = Vec3::new(b.cos() * r, a, b.sin() * r);
            let v = dir * (1.5 + c * 2.5);
            let size = 0.9 + m.dice() * 0.9;
            let (life, turn, spin) = (2.5 + m.dice() * 2.0, m.dice() * std::f32::consts::TAU, (m.dice() - 0.5) * 0.8);
            let e = match m.free_smoke.pop() {
                Some((e, _)) => e,
                None => {
                    let mat = materials.add(StandardMaterial { base_color: Color::linear_rgba(0.55, 0.53, 0.5, 0.85), base_color_texture: Some(m.cloud.clone()), unlit: true, alpha_mode: AlphaMode::Blend, ..default() });
                    let e = commands.spawn((Mesh3d(quad.clone()), MeshMaterial3d(mat.clone()), Transform::from_translation(at).with_scale(Vec3::ZERO), NotShadowCaster, Name::new("grenade smoke"))).id();
                    m.smoke_materials.insert(e, mat);
                    e
                }
            };
            m.specks.push(Speck { e, at: at + Vec3::Y * 0.2 + dir * 0.3, v, age: 0.0, life, size: size * 0.6, spin, turn, smoke: true });
        }
    }
    // The lamp.
    let grenade = m.peak < 0.0;
    let peak = m.peak.abs();
    if peak > 0.0 {
        let age = now - m.at;
        let intensity = peak * (-age * 40.0 * if grenade { 0.25 } else { 1.0 }).exp();
        let off = intensity < 1.0 || age > 0.12;
        if let Ok(mut l) = lamps.get_mut(m.lamp) {
            l.intensity = if off { 0.0 } else { intensity * CANDELA };
        }
        if off {
            m.peak = 0.0;
            if let Ok(mut v) = vis.get_mut(m.card) {
                *v = Visibility::Hidden;
            }
        }
    }
    // The puffs and sparks.
    let mut done = Vec::new();
    for (i, s) in m.specks.iter_mut().enumerate() {
        s.age += dt;
        if s.age >= s.life {
            done.push(i);
            continue;
        }
        let u = s.age / s.life;
        if s.smoke {
            // Warm gas rising (an estimate), slowing in the air, swelling to five times its size and thinning to nothing.
            s.v += Vec3::new(0.0, if s.size > 0.5 { 0.25 } else { 0.08 }, 0.0) * dt;
            s.v *= (-dt * 1.5).exp();
            s.turn += s.spin * dt;
            if let Some(mut mat) = m.smoke_materials.get(&s.e).and_then(|h| materials.get_mut(h)) {
                let a = if s.size > 0.5 { 0.8 * (1.0 - u) } else { 0.16 * (1.0 - u) };
                mat.base_color.set_alpha(a);
            }
        } else {
            s.v.y -= 9.81 * dt;
        }
        s.at += s.v * dt;
        let size = if s.smoke { s.size * (1.0 + 4.0 * u) } else { s.size };
        // Each faces the eye; a spark is drawn stretched along its way (4 to 9 times as long as it is wide).
        let rot = if s.smoke {
            eye.rotation * Quat::from_rotation_z(s.turn)
        } else {
            let along = s.v.normalize_or_zero();
            let to_eye = (eye.translation - s.at).normalize_or_zero();
            let side = along.cross(to_eye).normalize_or_zero();
            Quat::from_mat3(&Mat3::from_cols(side, along, side.cross(along)))
        };
        let scale = if s.smoke { Vec3::splat(size) } else { Vec3::new(size, size * 6.0 * (1.0 - u * 0.5), size) };
        if let Ok(mut t) = transforms.get_mut(s.e) {
            *t = Transform { translation: s.at, rotation: rot, scale };
        }
        if let Ok(mut v) = vis.get_mut(s.e) {
            if *v != Visibility::Inherited {
                *v = Visibility::Inherited;
            }
        }
    }
    for i in done.into_iter().rev() {
        let s = m.specks.swap_remove(i);
        if let Ok(mut v) = vis.get_mut(s.e) {
            *v = Visibility::Hidden;
        }
        if s.smoke {
            let h = m.smoke_materials[&s.e].clone();
            m.free_smoke.push((s.e, h));
        } else {
            m.free_sparks.push(s.e);
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(OnEnter(crate::Loading::Done), setup.after(crate::weapons::spawn_models))
        .add_systems(Update, crate::profiler::timed("weapons: flash and smoke", update).run_if(resource_exists::<Muzzle>).after(crate::weapons::act));
}
