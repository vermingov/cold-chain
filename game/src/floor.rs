// Blood on the floor: how deep it stands at each place, how it spreads, and how it dries (src/sandbox/floor.ts).
//
// The floor is a grid of 12.5 mm squares, each holding a depth of blood. Blood runs from deeper to shallower (and from
// higher to lower: no concrete floor is flat, it rises and falls a millimetre or two over half a metre), as readily as a
// film of its depth can flow (the cube of the depth, over its viscosity: a thin smear hardly moves, a pool levels at
// once). It does not wet dry floor until it stands deep enough to push its edge over it: two to three millimetres on
// concrete, which is how deep a pool of blood is, and that edge is caught on every grain and pore, so it is ragged. A
// thin film stays behind wherever it has been. It thickens as it clots (a few minutes), skins over and darkens as it
// dries (tens of minutes), and goes brown-black.
//
// The TS kept the grid on the CPU and sent the tiles that changed to the card; here it lives on the GPU and is worked out
// there (floor.wesl), tile by tile of 32 by 32 cells, only the tiles blood has reached: woken where blood comes onto the
// floor and where it runs to. The numbers are the TS's. What the CPU still needs to know (whether a drop lands in liquid,
// how deep the blood is under a body or a shoe) it reads from a copy brought back a few times a second (`mirror`).
//
// Drawn by one plane over the part of the floor with blood on it, its shader (puddle.wesl) reading the depths: dark red
// where it is deep, red-brown where it is a smear, a surface as smooth as water while it is wet whose edge rounds up
// and catches the lamps.

use std::borrow::Cow;
use std::num::NonZero;

use bevy::asset::RenderAssetUsages;
use bevy::core_pipeline::schedule::camera_driver;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::light::NotShadowCaster;
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::gpu_readback::{Readback, ReadbackComplete, ReadbackOnce};
use bevy::render::render_asset::RenderAssets;
use bevy::render::render_resource::binding_types::{storage_buffer_read_only_sized, storage_buffer_sized, texture_storage_2d, uniform_buffer_sized};
use bevy::render::diagnostic::RecordDiagnostics;
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, RenderGraph, RenderQueue};
use bevy::render::storage::{GpuShaderBuffer, ShaderBuffer};
use bevy::render::texture::GpuImage;
use bevy::render::{MainWorld, Render, RenderApp, RenderStartup, RenderSystems};
use bevy::shader::ShaderRef;
use bevy::render::ExtractSchedule;

use crate::fluid::{noise2, MU, RHO};
use crate::map::{Map, HALL};

pub const CELL: f32 = 0.0125; // metres
const TILE: usize = 32; // cells a side of the tiles the floor is woken by
const STEP: f32 = 1.0 / 30.0; // seconds between moves
pub const STANDS: f32 = 0.0025; // metres: how deep blood must stand to push its edge on over dry floor, on average
pub const STAYS: f32 = 0.00006; // metres: the film left behind where it has been
const DRIES: f32 = 1400.0; // seconds for a pool to lose two thirds of its wetness (a smear is quicker); floor.wesl's too
// How much of a depth difference a film moves a step, per cubic metre of depth.
const MOVES: f32 = RHO * 9.81 * STEP / (3.0 * MU * CELL * CELL);
// The most tiles awake at once (164 m2 of floor, a third of the hall); what the buffers are made for.
const MOST: usize = 1024;
const NONE: u32 = u32::MAX;
// Seconds between copies of the depths brought back to the CPU.
const READS: f32 = 0.2;

// Waiting to go to the GPU this frame (taken by the render world each frame: its vectors swap with this one's, so
// nothing is allocated once they have grown).
#[derive(Default)]
pub struct Send {
    ops: Vec<[f32; 4]>,
    // The awake tiles by slot and the slot table, when they changed (else empty).
    index: Vec<u32>,
    // Each newly woken tile's ground (its slot, then its 1024 cells).
    fresh: Vec<u32>,
    ground: Vec<[f32; 2]>,
    count: u32,
    clock: f32,
    step: bool,
    clear: bool,
}

#[derive(Resource)]
pub struct Floor {
    pub n: usize,
    tiles: usize,
    // The floor's corner (Bevy's x and z): cell (i, j) is the square from x0 + i CELL, x0 + j CELL.
    x0: f32,
    slot: Vec<u32>,
    list: Vec<u32>,
    clock: f32,
    wait: f32,
    // The depths and ages as last brought back (by slot), and what was done to them since.
    h: Vec<f32>,
    born: Vec<f32>,
    asked: f32,
    reading: u8,
    // Tiles the GPU found blood would run into.
    pub wanted: Vec<u32>,
    send: Send,
    pub display: Handle<Image>,
    depth: Handle<ShaderBuffer>,
    ages: Handle<ShaderBuffer>,
    want: Handle<ShaderBuffer>,
    plane: Option<Entity>,
    area: Option<[f32; 4]>,
    index_changed: bool,
    // What the frame's update cost the CPU (seconds).
    pub cost: f32,
}

impl Floor {
    fn new(images: &mut Assets<Image>, buffers: &mut Assets<ShaderBuffer>) -> Floor {
        let n = ((HALL.x.max(HALL.z) * 2.0 / CELL / TILE as f32).ceil() as usize) * TILE;
        let tiles = n / TILE;
        let mut image = Image::new_uninit(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 }, TextureDimension::D2, TextureFormat::Rgba8Unorm,
                                          RenderAssetUsages::RENDER_WORLD);
        image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING | TextureUsages::STORAGE_BINDING | TextureUsages::COPY_DST;
        image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
            address_mode_u: ImageAddressMode::ClampToEdge,
            address_mode_v: ImageAddressMode::ClampToEdge,
            mag_filter: ImageFilterMode::Linear,
            min_filter: ImageFilterMode::Linear,
            ..default()
        });
        let buffer = |size: usize| {
            let mut b = ShaderBuffer::with_size(size as u64, RenderAssetUsages::RENDER_WORLD);
            b.buffer_usage = BufferUsages::STORAGE | BufferUsages::COPY_SRC | BufferUsages::COPY_DST;
            b
        };
        Floor {
            n,
            tiles,
            x0: -(n as f32 * CELL) / 2.0,
            slot: vec![NONE; tiles * tiles],
            list: Vec::new(),
            clock: 0.0,
            wait: 0.0,
            h: Vec::new(),
            born: Vec::new(),
            asked: 0.0,
            reading: 0,
            wanted: Vec::new(),
            send: Send::default(),
            display: images.add(image),
            depth: buffers.add(buffer(MOST * TILE * TILE * 4)),
            ages: buffers.add(buffer(MOST * TILE * TILE * 8)),
            want: buffers.add(buffer(tiles * tiles * 4)),
            plane: None,
            area: None,
            index_changed: false,
            cost: 0.0,
        }
    }

    // The grid place of a point, and its cell's place in the buffers (by slot), if its tile is awake.
    fn place(&self, x: f32, z: f32) -> (i64, i64) {
        (((x - self.x0) / CELL).floor() as i64, ((z - self.x0) / CELL).floor() as i64)
    }

    fn cell(&self, i: i64, j: i64) -> Option<usize> {
        let n = self.n as i64;
        if i < 1 || j < 1 || i >= n - 1 || j >= n - 1 {
            return None;
        }
        let s = self.slot[(j as usize / TILE) * self.tiles + i as usize / TILE];
        (s != NONE).then(|| s as usize * TILE * TILE + (j as usize % TILE) * TILE + i as usize % TILE)
    }

    // The tile `t` awake: its ground made (the floor's own lie: how high each cell is, a couple of millimetres of
    // unevenness over half a metre, less over a few centimetres, and how deep blood must stand to wet it) and sent.
    fn wake(&mut self, t: usize, map: &Map) {
        if self.slot[t] != NONE || self.list.len() >= MOST {
            return;
        }
        let s = self.list.len() as u32;
        self.slot[t] = s;
        self.list.push(t as u32);
        self.index_changed = true;
        self.send.fresh.push(s);
        let (tx, tz) = (t % self.tiles, t / self.tiles);
        for j in 0..TILE {
            for i in 0..TILE {
                let (gx, gz) = (tx * TILE + i, tz * TILE + j);
                let (x, z) = (gx as f64 * CELL as f64, gz as f64 * CELL as f64);
                let mut rise = 0.0016 * noise2(x / 0.45, z / 0.45) + 0.0006 * noise2(x / 0.11 + 7.0, z / 0.11) + 0.00015 * noise2(x / 0.03, z / 0.03 + 3.0);
                let edge = STANDS as f64 * (0.6 + 0.55 * noise2(x / 0.05 + 11.0, z / 0.05) + 0.35 * noise2(x / 0.017, z / 0.017 + 5.0));
                // Under a wall or a ledge, the floor is a metre higher: nothing flows uphill into it.
                if map.covered(self.x0 + x as f32 + CELL / 2.0, self.x0 + z as f32 + CELL / 2.0) {
                    rise = 1.0;
                }
                self.send.ground.push([rise as f32, edge as f32]);
            }
        }
        let cells = self.list.len() * TILE * TILE;
        self.h.resize(cells, 0.0);
        self.born.resize(cells, 0.0);
    }

    // The tiles within `r` of (x, z) awake.
    fn wake_round(&mut self, x: f32, z: f32, r: f32, map: &Map) {
        let (i0, j0) = self.place(x - r, z - r);
        let (i1, j1) = self.place(x + r, z + r);
        let t = TILE as i64;
        for tj in (j0.max(0) / t)..=(j1.min(self.n as i64 - 1) / t) {
            for ti in (i0.max(0) / t)..=(i1.min(self.n as i64 - 1) / t) {
                self.wake(tj as usize * self.tiles + ti as usize, map);
            }
        }
    }

    // `ml` of blood onto the floor at (x, z) (Bevy's): one cell.
    pub fn add(&mut self, x: f32, z: f32, ml: f32, map: &Map) {
        if ml <= 0.0 {
            return;
        }
        // (The tiles round it too: what lands on a tile's edge runs into the next at once.)
        self.wake_round(x, z, CELL * TILE as f32 * 0.5, map);
        self.send.ops.push([x - self.x0, z - self.x0, ml, 0.0]);
        let (i, j) = self.place(x, z);
        if let Some(c) = self.cell(i, j) {
            let more = ml * 1e-6 / (CELL * CELL);
            if self.h[c] < more * 2.0 {
                self.born[c] = self.clock;
            }
            self.h[c] += more;
        }
    }

    // `ml` into the pool round (x, z): spread evenly over the liquid within `r` (floor.wesl `apply`), or the one cell.
    pub fn pour(&mut self, x: f32, z: f32, ml: f32, map: &Map) {
        let r = 0.04;
        self.wake_round(x, z, CELL * TILE as f32 * 0.5, map);
        self.send.ops.push([x - self.x0, z - self.x0, ml, r]);
        let (i, j) = self.place(x, z);
        if let Some(c) = self.cell(i, j) {
            self.h[c] += ml * 1e-6 / (CELL * CELL) / 9.0;
        }
    }

    // How deep blood stands at (x, z), metres (as last brought back).
    pub fn depth(&self, x: f32, z: f32) -> f32 {
        let (i, j) = self.place(x, z);
        self.cell(i, j).map_or(0.0, |c| self.h[c])
    }

    // Whether blood at (x, z) is still a liquid a drop would fall into: standing at least `deep` metres and not yet dried
    // to a skin (its wetness above a third).
    pub fn liquid(&self, x: f32, z: f32, deep: f32) -> bool {
        let (i, j) = self.place(x, z);
        let Some(c) = self.cell(i, j) else { return false };
        let h = self.h[c];
        h >= deep && (-(self.clock - self.born[c]) / (200.0 + DRIES * (h / STANDS).min(1.0))).exp() > 0.33
    }

    // Up to `ml` taken off the floor within `r` of (x, z) (something lying in it, a shoe), evenly from every cell with
    // more than its film; what it got (as the copy has it: the GPU takes the same from its own).
    pub fn take(&mut self, x: f32, z: f32, r: f32, ml: f32) -> f32 {
        let (ci, cj) = self.place(x, z);
        if self.cell(ci, cj).is_none() {
            return 0.0;
        }
        let k = (r / CELL).ceil() as i64;
        let mut got = 0;
        for pass in 0..2 {
            let each = ml * 1e-6 / (CELL * CELL) / got.max(1) as f32;
            let mut taken = 0.0;
            for j in -k..=k {
                for i in -k..=k {
                    if i * i + j * j > k * k {
                        continue;
                    }
                    let Some(c) = self.cell(ci + i, cj + j) else { continue };
                    if self.h[c] <= STAYS {
                        continue;
                    }
                    if pass == 0 {
                        got += 1;
                    } else {
                        let t = each.min(self.h[c] - STAYS * 0.5);
                        self.h[c] -= t;
                        taken += t * CELL * CELL * 1e6;
                    }
                }
            }
            if pass == 1 {
                if taken > 0.0 {
                    self.send.ops.push([x - self.x0, z - self.x0, ml, -r]);
                }
                return taken;
            }
        }
        0.0
    }

    pub fn clear(&mut self) {
        self.slot.fill(NONE);
        self.list.clear();
        self.h.clear();
        self.born.clear();
        self.send.ops.clear();
        self.send.fresh.clear();
        self.send.ground.clear();
        self.send.clear = true;
        self.index_changed = true;
        self.area = None;
        self.wanted.clear();
    }

    pub fn awake(&self) -> usize {
        self.list.len()
    }
}

// The floor's blood drawn: depth into colour, gloss and the bend of its surface (puddle.wesl, the TS's Puddle plugin).
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct Puddle {
    #[texture(100)]
    #[sampler(101)]
    map: Handle<Image>,
    // The floor's corner (x, z), one over its size, cells a side.
    #[uniform(102)]
    area: Vec4,
    // The hall, as wet blood shows it (wet.rs).
    #[texture(103)]
    #[sampler(109)]
    hall0: Handle<Image>,
    #[texture(104)]
    hall1: Handle<Image>,
    #[texture(105)]
    hall2: Handle<Image>,
    #[texture(106)]
    hall3: Handle<Image>,
    #[texture(107)]
    hall4: Handle<Image>,
    #[texture(108)]
    hall5: Handle<Image>,
}

impl MaterialExtension for Puddle {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/puddle.wesl".into()
    }
}

fn make(mut commands: Commands, mut images: ResMut<Assets<Image>>, mut buffers: ResMut<Assets<ShaderBuffer>>, mut meshes: ResMut<Assets<Mesh>>,
        mut materials: ResMut<Assets<ExtendedMaterial<StandardMaterial, Puddle>>>, hall: Res<crate::wet::Hall>) {
    let [hall0, hall1, hall2, hall3, hall4, hall5] = hall.faces.clone();
    let mut floor = Floor::new(&mut images, &mut buffers);
    let material = materials.add(ExtendedMaterial {
        base: StandardMaterial {
            base_color: Color::linear_rgb(0.1, 0.004, 0.003),
            perceptual_roughness: 0.05,
            // (Blood's index is about water's: four parts in a hundred of the light come back off it at most.)
            reflectance: 0.35,
            alpha_mode: AlphaMode::Blend,
            // Over the floor it lies on.
            depth_bias: 1.0,
            ..default()
        },
        extension: Puddle {
            map: floor.display.clone(),
            area: Vec4::new(floor.x0, floor.x0, 1.0 / (floor.n as f32 * CELL), floor.n as f32),
            hall0, hall1, hall2, hall3, hall4, hall5,
        },
    });
    let plane = commands
        .spawn((Mesh3d(meshes.add(Plane3d::default().mesh().size(1.0, 1.0))), MeshMaterial3d(material), Transform::from_xyz(0.0, 0.0007, 0.0),
                Visibility::Hidden, NotShadowCaster, Name::new("blood on the floor")))
        .id();
    floor.plane = Some(plane);
    // The tiles blood would have run into, every frame (a few kilobytes).
    commands.spawn(Readback::buffer(floor.want.clone())).observe(|e: On<ReadbackComplete>, mut floor: ResMut<Floor>| {
        let mut wanted = std::mem::take(&mut floor.wanted);
        wanted.clear();
        wanted.extend(e.data.chunks_exact(4).enumerate().filter(|(_, b)| b != &[0, 0, 0, 0]).map(|(t, _)| t as u32));
        floor.wanted = wanted;
    });
    commands.insert_resource(floor);
}

// Once a frame: the clock, a step when one is due (at most one a frame, as the TS's: a slow frame runs it slower), the
// tiles blood ran up to woken, the depths asked for again, and the plane over what has blood on it.
fn update(mut commands: Commands, time: Res<Time>, map: Res<Map>, mut floor: ResMut<Floor>, mut planes: Query<(&mut Transform, &mut Visibility)>) {
    let start = std::time::Instant::now();
    let dt = time.delta_secs();
    let f = &mut *floor;
    f.clock += dt;
    f.wait += dt;
    if f.wait >= STEP {
        f.wait = 0.0;
        f.send.step = true;
    }
    for k in 0..f.wanted.len() {
        let t = f.wanted[k] as usize;
        f.wake(t, &map);
    }
    if f.index_changed {
        f.index_changed = false;
        f.send.index.clear();
        f.send.index.extend_from_slice(&f.list);
        f.send.index.resize(MOST, NONE);
        f.send.index.extend_from_slice(&f.slot);
        // The plane covers the awake tiles.
        if let Some(plane) = f.plane
            && let Ok((mut t, mut v)) = planes.get_mut(plane)
        {
            let span = (TILE as f32) * CELL;
            let mut a = [f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
            for &tile in &f.list {
                let (x, z) = (f.x0 + (tile as usize % f.tiles) as f32 * span, f.x0 + (tile as usize / f.tiles) as f32 * span);
                a = [a[0].min(x), a[1].min(z), a[2].max(x + span), a[3].max(z + span)];
            }
            f.area = (!f.list.is_empty()).then_some(a);
            *v = if f.list.is_empty() { Visibility::Hidden } else { Visibility::Inherited };
            if !f.list.is_empty() {
                t.translation = Vec3::new((a[0] + a[2]) / 2.0, 0.0007, (a[1] + a[3]) / 2.0);
                t.scale = Vec3::new(a[2] - a[0], 1.0, a[3] - a[1]);
            }
        }
    }
    f.send.count = f.list.len() as u32;
    f.send.clock = f.clock;
    f.asked += dt;
    if f.reading == 0 && f.asked >= READS && !f.list.is_empty() {
        f.asked = 0.0;
        f.reading = 2;
        let cells = (f.list.len() * TILE * TILE) as u64;
        commands.spawn(ReadbackOnce::buffer_range(f.depth.clone(), 0, cells * 4)).observe(|e: On<ReadbackComplete>, mut floor: ResMut<Floor>| {
            let f = &mut *floor;
            for (k, b) in e.data.chunks_exact(4).enumerate().take(f.h.len()) {
                f.h[k] = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            }
            f.reading -= 1;
        });
        commands.spawn(ReadbackOnce::buffer_range(f.ages.clone(), 0, cells * 8)).observe(|e: On<ReadbackComplete>, mut floor: ResMut<Floor>| {
            let f = &mut *floor;
            for (k, b) in e.data.chunks_exact(8).enumerate().take(f.born.len()) {
                f.born[k] = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            }
            f.reading -= 1;
        });
    }
    f.cost = start.elapsed().as_secs_f32();
}

// --- the render world --------------------------------------------------------------------------------------------

#[derive(Resource, Default)]
struct Sent(Send);

#[derive(Resource)]
struct Gpu {
    layout: BindGroupLayoutDescriptor,
    pipelines: [CachedComputePipelineId; 4],
    handles: Option<(Handle<Image>, Handle<ShaderBuffer>, Handle<ShaderBuffer>, Handle<ShaderBuffer>)>,
    uniform: Buffer,
    index: Buffer,
    ground: Buffer,
    give: Buffer,
    ops: Buffer,
    ops_room: usize,
    bind: Option<BindGroup>,
    tiles: u32,
    n: u32,
}

fn extract(mut main: ResMut<MainWorld>, mut sent: ResMut<Sent>, mut gpu: Option<ResMut<Gpu>>) {
    let Some(mut floor) = main.get_resource_mut::<Floor>() else { return };
    let s = &mut sent.0;
    s.ops.clear();
    s.index.clear();
    s.fresh.clear();
    s.ground.clear();
    std::mem::swap(s, &mut floor.send);
    floor.send.step = false;
    floor.send.clear = false;
    if let Some(gpu) = gpu.as_mut()
        && gpu.handles.is_none()
    {
        gpu.handles = Some((floor.display.clone(), floor.depth.clone(), floor.ages.clone(), floor.want.clone()));
        gpu.tiles = (floor.n / TILE) as u32;
        gpu.n = floor.n as u32;
    }
}

fn init(mut commands: Commands, assets: Res<AssetServer>, cache: Res<PipelineCache>, device: Res<RenderDevice>) {
    let size = |n: u64| NonZero::new(n);
    let layout = BindGroupLayoutDescriptor::new(
        "floor blood",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::COMPUTE,
            (
                uniform_buffer_sized(false, size(32)),
                storage_buffer_read_only_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_read_only_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_sized(false, None),
                storage_buffer_read_only_sized(false, None),
                texture_storage_2d(TextureFormat::Rgba8Unorm, StorageTextureAccess::WriteOnly),
            ),
        ),
    );
    let shader = assets.load("embedded://cold_chain/floor.wesl");
    let pipelines = ["apply", "flow", "gather", "settle"].map(|entry| {
        cache.queue_compute_pipeline(ComputePipelineDescriptor {
            label: Some(format!("floor blood {entry}").into()),
            layout: vec![layout.clone()],
            shader: shader.clone(),
            entry_point: Some(Cow::from(entry)),
            ..default()
        })
    });
    let buffer = |label: &'static str, size: usize, usage: BufferUsages| {
        device.create_buffer(&BufferDescriptor { label: Some(label), size: size as u64, usage: usage | BufferUsages::COPY_DST, mapped_at_creation: false })
    };
    let tiles = (HALL.x.max(HALL.z) * 2.0 / CELL / TILE as f32).ceil() as usize;
    commands.insert_resource(Gpu {
        layout,
        pipelines,
        handles: None,
        uniform: buffer("floor blood uniform", 32, BufferUsages::UNIFORM),
        index: buffer("floor blood index", (MOST + tiles * tiles) * 4, BufferUsages::STORAGE),
        ground: buffer("floor blood ground", MOST * TILE * TILE * 8, BufferUsages::STORAGE),
        give: buffer("floor blood give", MOST * TILE * TILE * 16, BufferUsages::STORAGE),
        ops: buffer("floor blood ops", 256 * 16, BufferUsages::STORAGE),
        ops_room: 256,
        bind: None,
        tiles: 0,
        n: 0,
    });
}

fn prepare(mut gpu: ResMut<Gpu>, sent: Res<Sent>, device: Res<RenderDevice>, queue: Res<RenderQueue>, cache: Res<PipelineCache>,
           images: Res<RenderAssets<GpuImage>>, buffers: Res<RenderAssets<GpuShaderBuffer>>) {
    let s = &sent.0;
    let g = &mut *gpu;
    if s.ops.len() > g.ops_room {
        g.ops_room = s.ops.len().next_power_of_two();
        g.ops = device.create_buffer(&BufferDescriptor { label: Some("floor blood ops"), size: g.ops_room as u64 * 16, usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
                                                         mapped_at_creation: false });
        g.bind = None;
    }
    if g.bind.is_none() {
        let Some((display, depth, ages, want)) = &g.handles else { return };
        let (Some(display), Some(depth), Some(ages), Some(want)) = (images.get(display), buffers.get(depth), buffers.get(ages), buffers.get(want)) else { return };
        g.bind = Some(device.create_bind_group(
            "floor blood",
            &cache.get_bind_group_layout(&g.layout),
            &BindGroupEntries::sequential((
                g.uniform.as_entire_binding(),
                g.index.as_entire_binding(),
                depth.buffer.as_entire_binding(),
                ages.buffer.as_entire_binding(),
                g.ground.as_entire_binding(),
                g.give.as_entire_binding(),
                want.buffer.as_entire_binding(),
                g.ops.as_entire_binding(),
                &display.texture_view,
            )),
        ));
    }
    let slots_at = MOST as u32;
    let uniform: [u32; 8] = [g.n, g.tiles, s.count, s.ops.len() as u32, slots_at, s.clock.to_bits(), MOVES.to_bits(), 0];
    queue.write_buffer(&g.uniform, 0, bytemuck::cast_slice(&uniform));
    if !s.index.is_empty() {
        queue.write_buffer(&g.index, 0, bytemuck::cast_slice(&s.index));
    }
    for (k, &slot) in s.fresh.iter().enumerate() {
        let cells = TILE * TILE;
        queue.write_buffer(&g.ground, (slot as usize * cells * 8) as u64, bytemuck::cast_slice(&s.ground[k * cells..(k + 1) * cells]));
    }
    if !s.ops.is_empty() {
        queue.write_buffer(&g.ops, 0, bytemuck::cast_slice(&s.ops));
    }
}

// Before the cameras draw: the frame's blood onto the floor, then a step if one is due. (A cleared floor starts again
// from nothing: its depths, ages, display and the tiles it wanted.)
fn run(mut context: RenderContext, gpu: Res<Gpu>, sent: Res<Sent>, cache: Res<PipelineCache>, images: Res<RenderAssets<GpuImage>>,
       buffers: Res<RenderAssets<GpuShaderBuffer>>) {
    let s = &sent.0;
    let Some(bind) = &gpu.bind else { return };
    let [a, b, c, d] = gpu.pipelines;
    let (Some(apply), Some(flow), Some(gather), Some(settle)) =
        (cache.get_compute_pipeline(a), cache.get_compute_pipeline(b), cache.get_compute_pipeline(c), cache.get_compute_pipeline(d))
    else {
        return;
    };
    let diagnostics = context.diagnostic_recorder();
    let diagnostics = diagnostics.as_deref();
    let encoder = context.command_encoder();
    if s.clear
        && let Some((display, depth, ages, want)) = &gpu.handles
    {
        for b in [depth, ages, want] {
            if let Some(b) = buffers.get(b) {
                encoder.clear_buffer(&b.buffer, 0, None);
            }
        }
        if let Some(d) = images.get(display) {
            encoder.clear_texture(&d.texture, &ImageSubresourceRange::default());
        }
    }
    if s.ops.is_empty() && (!s.step || s.count == 0) {
        return;
    }
    let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor { label: Some("floor blood"), ..default() });
    let span = diagnostics.pass_span(&mut pass, "blood_floor");
    pass.set_bind_group(0, bind, &[]);
    if !s.ops.is_empty() {
        pass.set_pipeline(apply);
        pass.dispatch_workgroups(1, 1, 1);
    }
    if s.step && s.count > 0 {
        let groups = s.count * (TILE * TILE) as u32 / 256;
        for p in [flow, gather, settle] {
            pass.set_pipeline(p);
            pass.dispatch_workgroups(groups, 1, 1);
        }
    }
    span.end(&mut pass);
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "floor.wesl");
    bevy::asset::embedded_asset!(app, "puddle.wesl");
    app.add_plugins(MaterialPlugin::<ExtendedMaterial<StandardMaterial, Puddle>>::default())
        .add_systems(Startup, make.after(crate::wet::make))
        .add_systems(PostUpdate, update);
    let Some(render) = app.get_sub_app_mut(RenderApp) else { return };
    render
        .init_resource::<Sent>()
        .add_systems(RenderStartup, init)
        .add_systems(ExtractSchedule, extract)
        .add_systems(Render, prepare.in_set(RenderSystems::PrepareBindGroups))
        .add_systems(RenderGraph, run.before(camera_driver));
}
