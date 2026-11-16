// Blood in clothes: how much of it the cloth holds at each place, and how it gets about in there (src/sandbox/soak.ts).
//
// Cloth drinks blood into the spaces between its fibres and pulls it along them (wicking: Lucas-Washburn, the wetted
// patch growing as the square root of time), so a stain grows from where the blood came in, its edge sharp because a
// fibre is wet or it is not, and ragged because the weave is not the same everywhere. Past what the cloth can hold by
// wicking (its field capacity), the rest is free liquid and runs down through it under gravity, as the body lies now;
// where it can go no lower (a hem, a shirt-tail, a cuff) it gathers and drips. A thin cotton shirt holds about 0.3
// litres to the square metre, denim and work twill half again as much, wool suiting about as much as cotton, leather
// next to nothing.
//
// Kept on a grid of 8 mm cubes over the person at rest (their clothes' own picture can give both legs one place). The
// TS worked it out on the CPU, at most 1200 cubes a step, and sent the bricks that changed to a 3D texture; here every
// cube of a person's clothes is worked out on the GPU each step (soak.wesl) and the texture written there, and the
// clothes' material (cloth.wesl) reads it by the rest position of each point it draws: red how full the cloth is, green
// how wet it still is. What the CPU needs back (drops to let fall from hems; how full the cloth is, for wiping it on the
// floor) comes back by readback.

use std::borrow::Cow;
use std::collections::HashMap;
use std::num::NonZero;
use std::sync::Arc;

use bevy::asset::RenderAssetUsages;
use bevy::core_pipeline::schedule::camera_driver;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::math::Affine3A;
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::gpu_readback::{Readback, ReadbackComplete, ReadbackOnce};
use bevy::render::render_asset::RenderAssets;
use bevy::render::render_resource::binding_types::{storage_buffer_read_only_sized, storage_buffer_sized, texture_storage_3d, uniform_buffer_sized};
use bevy::render::diagnostic::RecordDiagnostics;
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, RenderGraph, RenderQueue};
use bevy::render::storage::{GpuShaderBuffer, ShaderBuffer};
use bevy::render::texture::GpuImage;
use bevy::render::{ExtractSchedule, MainWorld, Render, RenderApp, RenderStartup, RenderSystems};
use bevy::shader::ShaderRef;

use crate::fluid::across;
use crate::person::{Body, Person};

pub const VOX: f32 = 0.008; // metres: a cube of the grid
const STEP: f32 = 1.0 / 8.0; // seconds between moves of the blood in the cloth
pub const OVER: f32 = 1.3; // how much past full a cloth can be before it drips (soak.wesl's too)
const READS: f32 = 0.5; // seconds between copies of how full each cube is, brought back
const MOST_DRIPS: usize = 256;

// Litres a square metre holds, by what the garment is.
fn hold(name: &str) -> f32 {
    let has = |words: &[&str]| words.iter().any(|w| name.contains(w));
    if has(&["shoe", "boot"]) {
        0.04
    } else if has(&["worksuit", "overall", "jean", "denim"]) {
        0.5
    } else if has(&["casual"]) {
        0.42
    } else if has(&["suit"]) {
        0.36
    } else {
        0.32
    }
}

// The grid of one body, kept for its cubes with cloth in them only, numbered 0 to N (most of the box round a person is
// air): which cube of the box each is (`cell`; `id` the other way, -1 for air), how much it holds (the area of cloth in
// it times what that cloth holds), which bone it moves with, how readily the weave in it wicks, and its six neighbours
// (-1 where there is no cloth). Made once per body, and shared by everyone with that body; on the GPU as `cubes` (and
// `pairs`, every texel of the field and the cube it shows).
pub struct Grid {
    pub o: Vec3,
    pub n: [usize; 3],
    id: Vec<i32>,
    cell: Vec<u32>,
    cap: Vec<f32>,
    owner: Vec<u16>,
    cubes: Handle<ShaderBuffer>,
    pairs: Handle<ShaderBuffer>,
    pair_count: u32,
}

impl Grid {
    fn new(body: &Body, buffers: &mut Assets<ShaderBuffer>) -> Grid {
        let (mut lo, mut hi) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for p in body.parts.iter().filter(|p| p.kind == "cloth") {
            for v in &body.position[p.vertex_start..p.vertex_start + p.vertex_count] {
                lo = lo.min(*v);
                hi = hi.max(*v);
            }
        }
        let o = lo - Vec3::splat(VOX * 2.0);
        let n = [0, 1, 2].map(|k| ((hi[k] - o[k]) / VOX).ceil() as usize + 2);
        let cells = n[0] * n[1] * n[2];
        let (mut all, mut bones, mut weight) = (vec![0.0f32; cells], vec![0u16; cells], vec![0.0f32; cells]);
        for part in body.parts.iter().filter(|p| p.kind == "cloth") {
            let file = part.texture.as_ref().map_or("", |t| t.file.as_str());
            let hold = hold(&format!("{}:{file}", part.name)) * 1000.0; // ml a square metre
            for t in (part.index_start..part.index_start + part.index_count).step_by(3) {
                let [ia, ib, ic] = [0, 1, 2].map(|k| body.index[t + k] as usize);
                let (a, b, c) = (body.position[ia], body.position[ib], body.position[ic]);
                let area = (b - a).cross(c - a).length() / 2.0;
                // Points over the triangle a few millimetres apart, each carrying its share of the area to its cube.
                let k = ((area.sqrt() / (VOX * 0.4)).ceil() as usize).max(1);
                let (mut bone, mut most) = (0u16, -1.0f32);
                for j in 0..4 {
                    let w = body.weights[ia][j] as f32 / 255.0;
                    if w > most {
                        most = w;
                        bone = body.joints[ia][j];
                    }
                }
                let share = area / (k * (k + 1) / 2) as f32;
                for i in 0..k {
                    for j in 0..k - i {
                        let (u, v) = ((i as f32 + 1.0 / 3.0) / k as f32, (j as f32 + 1.0 / 3.0) / k as f32);
                        let p = a * (1.0 - u - v) + b * u + c * v;
                        let g = ((p - o) / VOX).floor();
                        let cell = g.x as usize + n[0] * (g.y as usize + n[1] * g.z as usize);
                        all[cell] += share * hold;
                        if share > weight[cell] {
                            weight[cell] = share;
                            bones[cell] = bone;
                        }
                    }
                }
            }
        }
        let mut id = vec![-1i32; cells];
        let mut count = 0;
        for c in 0..cells {
            if all[c] > 0.0 {
                id[c] = count;
                count += 1;
            }
        }
        let (nx, nxy) = (n[0] as i64, (n[0] * n[1]) as i64);
        let ways = [1, -1, nx, -nx, nxy, -nxy];
        let (mut cell, mut cap, mut owner) = (Vec::with_capacity(count as usize), Vec::with_capacity(count as usize), Vec::with_capacity(count as usize));
        // Each cube as soak.wesl's Cube: cell, cap, owner, weave, six neighbours (ten words).
        let mut cubes: Vec<u32> = Vec::with_capacity(count as usize * 10);
        for c in 0..cells {
            if id[c] < 0 {
                continue;
            }
            cell.push(c as u32);
            cap.push(all[c]);
            owner.push(bones[c]);
            // Thread to thread the weave pulls blood unevenly: some cubes take it twice as readily as others.
            let h = ((c as f64) * 12.9898 + 78.233).sin() * 43758.5453;
            let weave = (0.75 + 0.5 * (h - h.floor())) as f32;
            cubes.extend_from_slice(&[c as u32, all[c].to_bits(), bones[c] as u32, weave.to_bits()]);
            for w in ways {
                let d = c as i64 + w;
                cubes.push(if d >= 0 && (d as usize) < cells { id[d as usize] as u32 } else { u32::MAX });
            }
        }
        // The empty cubes round the cloth show what the fullest-holding cloth next to them holds.
        let mut pairs: Vec<[u32; 2]> = cell.iter().enumerate().map(|(i, &c)| [c, i as u32]).collect();
        for z in 1..n[2] - 1 {
            for y in 1..n[1] - 1 {
                for x in 1..n[0] - 1 {
                    let c = x + n[0] * (y + n[1] * z);
                    if all[c] > 0.0 {
                        continue;
                    }
                    let mut best: Option<usize> = None;
                    for k in [-1i64, 0, 1] {
                        for j in [-1i64, 0, 1] {
                            for i in [-1i64, 0, 1] {
                                let d = (c as i64 + i + nx * j + nxy * k) as usize;
                                if all[d] > 0.0 && best.is_none_or(|b| all[d] > all[b]) {
                                    best = Some(d);
                                }
                            }
                        }
                    }
                    if let Some(b) = best {
                        pairs.push([c as u32, id[b] as u32]);
                    }
                }
            }
        }
        let mut buffer = |data: Vec<u32>| {
            let mut b = ShaderBuffer::new(data, RenderAssetUsages::RENDER_WORLD);
            b.buffer_usage = BufferUsages::STORAGE;
            buffers.add(b)
        };
        let pair_count = pairs.len() as u32;
        Grid {
            o,
            n,
            id,
            cell,
            cap,
            owner,
            cubes: buffer(cubes),
            pairs: buffer(pairs.into_iter().flatten().collect()),
            pair_count,
        }
    }

    fn count(&self) -> usize {
        self.cell.len()
    }

    // The cube of cloth at a rest-space point, or the fullest-holding one next to it.
    pub fn cube_at(&self, rest: Vec3) -> Option<usize> {
        let g = ((rest - self.o) / VOX).floor();
        let (mut best, mut most) = (None, 0.0);
        for k in -1..=1 {
            for j in -1..=1 {
                for i in -1..=1 {
                    let (x, y, z) = (g.x as i64 + i, g.y as i64 + j, g.z as i64 + k);
                    if x < 0 || y < 0 || z < 0 || x >= self.n[0] as i64 || y >= self.n[1] as i64 || z >= self.n[2] as i64 {
                        continue;
                    }
                    let c = self.id[x as usize + self.n[0] * (y as usize + self.n[1] * z as usize)];
                    if c < 0 {
                        continue;
                    }
                    let w = self.cap[c as usize] / (1.0 + 2.0 * (i.abs() + j.abs() + k.abs()) as f32);
                    if w > most {
                        most = w;
                        best = Some(c as usize);
                    }
                }
            }
        }
        best
    }

    // Where a cube is at rest (its middle).
    fn rest_of(&self, i: usize) -> Vec3 {
        let c = self.cell[i] as usize;
        let (x, y, z) = (c % self.n[0], (c / self.n[0]) % self.n[1], c / (self.n[0] * self.n[1]));
        self.o + (Vec3::new(x as f32, y as f32, z as f32) + 0.5) * VOX
    }
}

// Waiting to go to the GPU for one person (swapped into the render world each frame, as floor.rs's Send).
#[derive(Default)]
struct Send {
    // (cube, ml, 0 in or 1 out, 0); and down as each bone lies, two to a bone, when a step is due.
    input: Vec<[f32; 4]>,
    downs: Vec<[f32; 4]>,
    step: f32,
    serial: u32,
    clock: f32,
}

// One person's blood in their clothes.
#[derive(Component)]
pub struct Soak {
    pub grid: Arc<Grid>,
    pub field: Handle<Image>,
    state: Handle<ShaderBuffer>,
    drips: Handle<ShaderBuffer>,
    // How much each cube holds, as last brought back.
    ml: Vec<f32>,
    send: Send,
    clock: f32,
    wait: f32,
    serial: u32,
    // Drops already let fall, by step.
    dripped: u32,
    // Any blood in the clothes yet (until then there is nothing to work out).
    pub wet: bool,
    asked: f32,
    reading: bool,
    // Drops to let fall, (cube, ml), brought back.
    falls: Vec<(u32, f32)>,
}

impl Soak {
    // `ml` of blood into the cloth at `rest`. False if there is no cloth there to take it.
    pub fn add(&mut self, rest: Vec3, ml: f32) -> bool {
        let Some(c) = self.grid.cube_at(rest) else { return false };
        if ml <= 0.0 {
            return false;
        }
        self.wet = true;
        self.ml[c] += ml;
        self.send.input.push([c as f32, ml, 0.0, 0.0]);
        true
    }

    // Up to `ml` wiped off the cloth at `rest`; what it gave (as last brought back: the GPU takes the same of its own).
    pub fn take(&mut self, rest: Vec3, ml: f32) -> f32 {
        let Some(c) = self.grid.cube_at(rest) else { return 0.0 };
        let got = ml.min(self.ml[c] * 0.5);
        if got > 0.0 {
            self.ml[c] -= got;
            self.send.input.push([c as f32, ml, 1.0, 0.0]);
        }
        got
    }

    // How full the cloth at `rest` is: 0 dry, 1 holding all it can, more with blood standing on it.
    pub fn fullness(&self, rest: Vec3) -> f32 {
        self.grid.cube_at(rest).map_or(0.0, |c| self.ml[c] / self.grid.cap[c])
    }

    // All the blood in these clothes, ml (as last brought back).
    pub fn total(&self) -> f32 {
        self.ml.iter().sum()
    }
}

// The clothes' material with the blood in them (cloth.wesl).
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct Cloth {
    #[texture(100, dimension = "3d")]
    #[sampler(101)]
    field: Handle<Image>,
    #[uniform(102)]
    origin: Vec4,
    #[uniform(103)]
    scale: Vec4,
}

impl MaterialExtension for Cloth {
    fn vertex_shader() -> ShaderRef {
        "embedded://cold_chain/cloth.wesl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/cloth.wesl".into()
    }
}

pub type ClothMaterial = ExtendedMaterial<StandardMaterial, Cloth>;

// Everyone made is given their clothes' blood: the grid of their body (made once a body), their own field, and their
// clothes drawn with it (each part's own material, from the one it was made with).
#[allow(clippy::too_many_arguments)]
fn make(mut commands: Commands, people: Query<(Entity, &Person), Without<Soak>>, mut grids: Local<HashMap<String, Arc<Grid>>>,
        mut buffers: ResMut<Assets<ShaderBuffer>>, mut images: ResMut<Assets<Image>>, standard: Res<Assets<StandardMaterial>>,
        mut cloths: ResMut<Assets<ClothMaterial>>, parts: Query<&MeshMaterial3d<StandardMaterial>>) {
    for (who, person) in &people {
        let body = &person.body;
        let grid = grids.entry(body.name.clone()).or_insert_with(|| Arc::new(Grid::new(body, &mut buffers))).clone();
        let [nx, ny, nz] = grid.n.map(|v| v as u32);
        let mut image = Image::new_uninit(Extent3d { width: nx, height: ny, depth_or_array_layers: nz }, TextureDimension::D3, TextureFormat::Rgba8Unorm,
                                          RenderAssetUsages::RENDER_WORLD);
        image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING | TextureUsages::STORAGE_BINDING | TextureUsages::COPY_DST;
        image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
            address_mode_u: ImageAddressMode::ClampToEdge,
            address_mode_v: ImageAddressMode::ClampToEdge,
            address_mode_w: ImageAddressMode::ClampToEdge,
            mag_filter: ImageFilterMode::Linear,
            min_filter: ImageFilterMode::Linear,
            ..default()
        });
        let field = images.add(image);
        let count = grid.count();
        let mut buffer = |size: usize| {
            let mut b = ShaderBuffer::with_size(size as u64, RenderAssetUsages::RENDER_WORLD);
            b.buffer_usage = BufferUsages::STORAGE | BufferUsages::COPY_SRC | BufferUsages::COPY_DST;
            buffers.add(b)
        };
        let state = buffer(count * 16);
        let drips = buffer(16 + MOST_DRIPS * 8);
        for (i, e) in &person.parts {
            if body.parts[*i].kind != "cloth" {
                continue;
            }
            let Ok(m) = parts.get(*e) else { continue };
            let Some(base) = standard.get(&m.0) else { continue };
            let material = cloths.add(ExtendedMaterial {
                base: base.clone(),
                extension: Cloth {
                    field: field.clone(),
                    origin: grid.o.extend(0.0),
                    scale: (Vec3::ONE / (Vec3::new(nx as f32, ny as f32, nz as f32) * VOX)).extend(0.0),
                },
            });
            commands.entity(*e).remove::<MeshMaterial3d<StandardMaterial>>().insert(MeshMaterial3d(material));
        }
        // The drops gathered at hems, every frame: each step's once (a few kilobytes).
        commands.spawn((Readback::buffer(drips.clone()), ChildOf(who))).observe(move |e: On<ReadbackComplete>, mut soaks: Query<&mut Soak>| {
            let Ok(mut soak) = soaks.get_mut(who) else { return };
            let word = |k: usize| u32::from_le_bytes([e.data[k * 4], e.data[k * 4 + 1], e.data[k * 4 + 2], e.data[k * 4 + 3]]);
            let (serial, count) = (word(0), (word(1) as usize).min(MOST_DRIPS));
            if serial <= soak.dripped {
                return;
            }
            soak.dripped = serial;
            for k in 0..count {
                let (c, ml) = (word(4 + k * 2), f32::from_bits(word(5 + k * 2)));
                soak.falls.push((c, ml));
            }
        });
        commands.entity(who).insert(Soak {
            ml: vec![0.0; count],
            grid,
            field,
            state,
            drips,
            send: Send::default(),
            clock: 0.0,
            wait: 0.0,
            serial: 0,
            dripped: 0,
            wet: false,
            asked: 0.0,
            reading: false,
            falls: Vec::new(),
        });
    }
}

// Each bone's matrix from the body at rest to the world now (npc.rs `bone_worlds`), into `out`.
pub fn bone_worlds(person: &Person, root: &Transform, out: &mut Vec<Affine3A>) {
    let p = person;
    let pelvis = p.body.bone("root").head;
    let base = root.compute_affine() * Affine3A::from_rotation_translation(p.posed.frame.rotation, p.posed.frame.translation) * Affine3A::from_translation(-pelvis);
    out.clear();
    for (&(r, at), b) in p.absolute(&p.posed.local).iter().zip(&p.body.bones) {
        out.push(base * Affine3A::from_rotation_translation(r, at) * Affine3A::from_translation(-b.head));
    }
}

// Once a frame for each person with blood in their clothes: the clock, a step when one is due (with down as each bone
// lies now), what has gathered at a hem let fall, and how full the cloth is asked for again.
fn update(mut commands: Commands, time: Res<Time>, mut people: Query<(Entity, &Person, &Transform, &mut Soak)>, mut blood: ResMut<crate::blood::Blood>,
          mut worlds: Local<Vec<Affine3A>>) {
    let start = std::time::Instant::now();
    let dt = time.delta_secs();
    for (who, person, root, mut soak) in &mut people {
        let soak = &mut *soak;
        if !soak.wet {
            continue;
        }
        soak.clock += dt;
        soak.wait += dt;
        let falls = !soak.falls.is_empty();
        if falls || soak.wait >= STEP {
            bone_worlds(person, root, &mut worlds);
        }
        for (c, ml) in soak.falls.drain(..) {
            let i = c as usize;
            if i >= soak.grid.count() {
                continue;
            }
            let bone = soak.grid.owner[i] as usize;
            let at = worlds[bone].transform_point3(soak.grid.rest_of(i));
            blood.drip(at - Vec3::Y * 0.006, ml, across(ml));
        }
        soak.send.step = 0.0;
        soak.send.clock = soak.clock;
        if soak.wait >= STEP {
            soak.send.step = soak.wait.min(0.25);
            soak.wait = 0.0;
            soak.serial += 1;
            soak.send.serial = soak.serial;
            // Down, as each bone lies now, in its rest frame, as the share of it along each of the six ways.
            soak.send.downs.clear();
            for m in worlds.iter() {
                let v = m.matrix3.inverse().mul_vec3a(bevy::math::Vec3A::NEG_Y).normalize();
                soak.send.downs.push([v.x, -v.x, v.y, -v.y]);
                soak.send.downs.push([v.z, -v.z, 0.0, 0.0]);
            }
        }
        soak.asked += dt;
        if !soak.reading && soak.asked >= READS {
            soak.asked = 0.0;
            soak.reading = true;
            commands.spawn(ReadbackOnce::buffer(soak.state.clone())).observe(move |e: On<ReadbackComplete>, mut soaks: Query<&mut Soak>| {
                let Ok(mut soak) = soaks.get_mut(who) else { return };
                for (k, b) in e.data.chunks_exact(16).enumerate().take(soak.ml.len()) {
                    soak.ml[k] = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                }
                soak.reading = false;
            });
        }
    }
    blood.cost[2] = start.elapsed().as_secs_f32();
}

// --- the render world --------------------------------------------------------------------------------------------

struct Gpu {
    sent: Send,
    cubes: Handle<ShaderBuffer>,
    pairs: Handle<ShaderBuffer>,
    state: Handle<ShaderBuffer>,
    drips: Handle<ShaderBuffer>,
    field: Handle<Image>,
    count: u32,
    pair_count: u32,
    n: [u32; 3],
    uniform: Option<Buffer>,
    given: Option<Buffer>,
    input: Option<Buffer>,
    room: usize,
    bind: Option<BindGroup>,
    // The frame it was last sent in (a person gone is forgotten).
    seen: u32,
}

#[derive(Resource, Default)]
struct Soaks {
    people: HashMap<Entity, Gpu>,
    frame: u32,
}

#[derive(Resource)]
struct Pipelines {
    layout: BindGroupLayoutDescriptor,
    ids: [CachedComputePipelineId; 4],
}

fn extract(mut main: ResMut<MainWorld>, mut soaks: ResMut<Soaks>) {
    soaks.frame += 1;
    let frame = soaks.frame;
    let mut q = main.query::<(Entity, &mut Soak)>();
    for (who, mut soak) in q.iter_mut(&mut main) {
        if !soak.wet {
            continue;
        }
        let soak = &mut *soak;
        let g = soaks.people.entry(who).or_insert_with(|| Gpu {
            sent: Send::default(),
            cubes: soak.grid.cubes.clone(),
            pairs: soak.grid.pairs.clone(),
            state: soak.state.clone(),
            drips: soak.drips.clone(),
            field: soak.field.clone(),
            count: soak.grid.count() as u32,
            pair_count: soak.grid.pair_count,
            n: soak.grid.n.map(|v| v as u32),
            uniform: None,
            given: None,
            input: None,
            room: 0,
            bind: None,
            seen: frame,
        });
        g.seen = frame;
        g.sent.input.clear();
        g.sent.downs.clear();
        std::mem::swap(&mut g.sent, &mut soak.send);
        soak.send.step = 0.0;
    }
    soaks.people.retain(|_, g| frame - g.seen < 600);
}

fn init(mut commands: Commands, assets: Res<AssetServer>, cache: Res<PipelineCache>) {
    let layout = BindGroupLayoutDescriptor::new(
        "soak",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::COMPUTE,
            (
                uniform_buffer_sized(false, NonZero::new(48)),
                storage_buffer_read_only_sized(false, None),
                storage_buffer_read_only_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_read_only_sized(false, None),
                texture_storage_3d(TextureFormat::Rgba8Unorm, StorageTextureAccess::WriteOnly),
            ),
        ),
    );
    let shader = assets.load("embedded://cold_chain/soak.wesl");
    let ids = ["apply", "flow", "gather", "encode"].map(|entry| {
        cache.queue_compute_pipeline(ComputePipelineDescriptor {
            label: Some(format!("soak {entry}").into()),
            layout: vec![layout.clone()],
            shader: shader.clone(),
            entry_point: Some(Cow::from(entry)),
            ..default()
        })
    });
    commands.insert_resource(Pipelines { layout, ids });
}

fn prepare(mut soaks: ResMut<Soaks>, pipelines: Res<Pipelines>, device: Res<RenderDevice>, queue: Res<RenderQueue>, cache: Res<PipelineCache>,
           images: Res<RenderAssets<GpuImage>>, buffers: Res<RenderAssets<GpuShaderBuffer>>) {
    let frame = soaks.frame;
    for g in soaks.people.values_mut() {
        if g.seen != frame {
            continue;
        }
        let want = (g.sent.input.len() + g.sent.downs.len()).max(64);
        let made = |label: &'static str, size: usize, usage: BufferUsages| {
            device.create_buffer(&BufferDescriptor { label: Some(label), size: size as u64, usage: usage | BufferUsages::COPY_DST, mapped_at_creation: false })
        };
        if g.uniform.is_none() {
            g.uniform = Some(made("soak uniform", 48, BufferUsages::UNIFORM));
            g.given = Some(made("soak given", g.count as usize * 32, BufferUsages::STORAGE));
        }
        if want > g.room {
            g.room = want.next_power_of_two();
            g.input = Some(made("soak input", g.room * 16, BufferUsages::STORAGE));
            g.bind = None;
        }
        if g.bind.is_none() {
            let (Some(cubes), Some(pairs), Some(state), Some(drips), Some(field)) =
                (buffers.get(&g.cubes), buffers.get(&g.pairs), buffers.get(&g.state), buffers.get(&g.drips), images.get(&g.field))
            else {
                continue;
            };
            g.bind = Some(device.create_bind_group(
                "soak",
                &cache.get_bind_group_layout(&pipelines.layout),
                &BindGroupEntries::sequential((
                    g.uniform.as_ref().unwrap().as_entire_binding(),
                    cubes.buffer.as_entire_binding(),
                    pairs.buffer.as_entire_binding(),
                    state.buffer.as_entire_binding(),
                    g.given.as_ref().unwrap().as_entire_binding(),
                    drips.buffer.as_entire_binding(),
                    g.input.as_ref().unwrap().as_entire_binding(),
                    &field.texture_view,
                )),
            ));
        }
        let s = &g.sent;
        let ops = s.input.len() as u32;
        let uniform: [u32; 12] = [g.count, g.pair_count, ops, ops, g.n[0], g.n[1], g.n[2], s.serial, s.clock.to_bits(), s.step.to_bits(), 0, 0];
        queue.write_buffer(g.uniform.as_ref().unwrap(), 0, bytemuck::cast_slice(&uniform));
        let input = g.input.as_ref().unwrap();
        if !s.input.is_empty() {
            queue.write_buffer(input, 0, bytemuck::cast_slice(&s.input));
        }
        if !s.downs.is_empty() {
            queue.write_buffer(input, s.input.len() as u64 * 16, bytemuck::cast_slice(&s.downs));
        }
    }
}

// Before the cameras draw: each person's blood into and out of their clothes this frame, then a step if one is due.
fn run(mut context: RenderContext, soaks: Res<Soaks>, pipelines: Res<Pipelines>, cache: Res<PipelineCache>) {
    let [a, b, c, d] = pipelines.ids;
    let (Some(apply), Some(flow), Some(gather), Some(encode)) =
        (cache.get_compute_pipeline(a), cache.get_compute_pipeline(b), cache.get_compute_pipeline(c), cache.get_compute_pipeline(d))
    else {
        return;
    };
    let busy = |g: &&Gpu| g.bind.is_some() && g.seen == soaks.frame && (!g.sent.input.is_empty() || g.sent.step > 0.0);
    if !soaks.people.values().any(|g| busy(&g)) {
        return;
    }
    let diagnostics = context.diagnostic_recorder();
    let diagnostics = diagnostics.as_deref();
    let mut pass = context.command_encoder().begin_compute_pass(&ComputePassDescriptor { label: Some("soak"), ..default() });
    let span = diagnostics.pass_span(&mut pass, "blood_soak");
    for g in soaks.people.values().filter(busy) {
        let s = &g.sent;
        pass.set_bind_group(0, g.bind.as_ref().unwrap(), &[]);
        pass.set_pipeline(apply);
        pass.dispatch_workgroups(1, 1, 1);
        if s.step > 0.0 {
            pass.set_pipeline(flow);
            pass.dispatch_workgroups(g.count.div_ceil(256), 1, 1);
            pass.set_pipeline(gather);
            pass.dispatch_workgroups(g.count.div_ceil(256), 1, 1);
            pass.set_pipeline(encode);
            pass.dispatch_workgroups(g.pair_count.div_ceil(256), 1, 1);
        }
    }
    span.end(&mut pass);
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "soak.wesl");
    bevy::asset::embedded_asset!(app, "cloth.wesl");
    app.add_plugins(MaterialPlugin::<ClothMaterial>::default()).add_systems(Update, make).add_systems(PostUpdate, update);
    let Some(render) = app.get_sub_app_mut(RenderApp) else { return };
    render
        .init_resource::<Soaks>()
        .add_systems(RenderStartup, init)
        .add_systems(ExtractSchedule, extract)
        .add_systems(Render, prepare.in_set(RenderSystems::PrepareBindGroups))
        .add_systems(RenderGraph, run.before(camera_driver));
}
