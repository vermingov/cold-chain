// What hurt looks like on a person's skin and clothes: the person's own materials, the sheets painted into them, and
// the passes that paint (src/sandbox/npc.ts _ownMaterials, and the drawing halves of marks.ts, film.ts, bruise.ts and
// hider.ts).
//
// Each person's skin, the skin under their clothes, their clothes, hair and brows are drawn with materials of their own
// (`Flesh`, Bevy's StandardMaterial with skin.wesl over it), which read three textures of that person's:
//
// - `wounds`, 2048 square: how deep the flesh is open at each place of the skin (red, to 4 cm), how much blood lies in
//   it (green), and the ring a slow bullet scraped round its way in (blue): marks.rs paints it, skin.wesl draws it as
//   what is there (marks.ts's depth sheet and Gore, and its skin sheet's ring);
// - `film`, 2048 square: how thick the blood lying on the skin is (red, to 0.6 mm) and how wet it still is (green):
//   film.rs and runs.rs paint it, skin.wesl draws it as a layer of blood over the skin (film.ts);
// - `state`, a table of numbers: each corner's bruising and swelling (bruise.rs), the holes in the clothes and the
//   openings in the skin and the windows through the clothes onto the skin under them (hider.rs), the recent blows'
//   shapes, and the clock.
//
// The TS painted its sheets on 2D canvases on the CPU and sent them up by tiles, which stalled frames for 170 to 220 ms.
// Here nothing is painted on the CPU: a frame's marks are a list of stamps (quads, each a shape worked out in its
// fragment shader, paint.wesl), drawn in one pass into each sheet that has any that frame, blended by keeping the
// lighter of the stamp and the sheet as the canvas's 'lighten' did; the film dries by a pass that scales its wetness,
// once every few seconds while it is still drying; and the table's changed rows are written straight into its texture.

use bevy::asset::RenderAssetUsages;
use bevy::core_pipeline::FullscreenShader;
use bevy::image::{ImageSampler, ImageSamplerDescriptor};
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{MeshVertexBufferLayoutRef, VertexBufferLayout};
use bevy::pbr::{ExtendedMaterial, MaterialExtension, MaterialExtensionKey, MaterialExtensionPipeline};
use bevy::prelude::*;
use bevy::render::render_asset::RenderAssets;
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderGraphSystems, RenderQueue};
use bevy::render::diagnostic::RecordDiagnostics;
use bevy::render::texture::GpuImage;
use bevy::render::{Extract, ExtractSchedule, RenderApp, RenderStartup};
use bevy::shader::ShaderRef;
use bytemuck::{Pod, Zeroable};

use crate::person::Person;

// The sheets' size, as the TS's canvases.
pub const SIZE: u32 = 2048;
// The table's width, and its first row of corners (the rows before are hider.rs's and bruise.rs's own).
pub const WIDE: usize = 1024;
pub const CORNERS: usize = 8;
// What the table keeps of each corner: its tint (redness, blood showing, how blue it has gone, swelling in cm), how far
// it is moved (swollen out, and the bone under it moved), how its normal tips with the swelling's slope.
pub const PER_CORNER: usize = 3;

// One mark to paint: see paint.wesl.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct Stamp {
    pub ab: [f32; 4],
    pub s: [f32; 4],
    pub v: [f32; 4],
    pub x: [f32; 4],
}

pub const CAPSULE: f32 = 0.0;
pub const LENS: f32 = 3.0;
pub const BLOT: f32 = 4.0;

impl Stamp {
    pub fn new(kind: f32, a: Vec2, b: Vec2, w: f32, feather: f32, reach: f32, v: Vec4, x: Vec4) -> Stamp {
        Stamp { ab: [a.x, a.y, b.x, b.y], s: [w, feather, reach, kind], v: v.to_array(), x: x.to_array() }
    }
}

// How a part of the person is drawn: skin, skin under the clothes (only where a hole in them shows it), clothes, or a
// layer only carried out by the swelling under it (hair, brows).
pub const SKIN: u32 = 0;
pub const UNDER: u32 = 1;
pub const CLOTH: u32 = 2;
pub const CARRIED: u32 = 3;
pub const GAUZE: u32 = 4;

#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct Wounded {
    // How the part is drawn, and its first corner in the body (where its corners' rows in the table start).
    #[uniform(100)]
    pub info: UVec4,
    #[texture(101)]
    #[sampler(102)]
    pub wounds: Handle<Image>,
    #[texture(103)]
    pub film: Handle<Image>,
    #[texture(104, sample_type = "float", filterable = false, visibility(vertex, fragment))]
    pub state: Handle<Image>,
    // A dressing's picture (skin.wesl GAUZE): its layout, and the blood in it.
    #[uniform(105)]
    pub layout: Vec4,
    #[uniform(106)]
    pub stain: Vec4,
    // The blood in the clothes (soak.rs `wire` sets a person's own; until then a dry field).
    #[texture(107, dimension = "3d")]
    #[sampler(108)]
    pub soak: Handle<Image>,
    #[uniform(109)]
    pub soak_at: Vec4,
    #[uniform(110)]
    pub soak_scale: Vec4,
}

impl MaterialExtension for Wounded {
    fn vertex_shader() -> ShaderRef {
        "embedded://cold_chain/skin.wesl".into()
    }

    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/skin.wesl".into()
    }

    fn specialize(
        _: &MaterialExtensionPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        _: &MeshVertexBufferLayoutRef,
        _: MaterialExtensionKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        // (The prepass and shadows use Bevy's own vertex shader, which knows nothing of the swelling: a few millimetres.)
        descriptor.label = Some("person".into());
        Ok(())
    }
}

pub type Flesh = ExtendedMaterial<StandardMaterial, Wounded>;

// A person's own look of hurt, beside their Person.
#[derive(Component)]
pub struct Skin {
    pub wounds: Handle<Image>,
    pub film: Handle<Image>,
    pub state: Handle<Image>,
    // Each drawn part's material of this person's own: (part, entity, material, how it is drawn).
    pub materials: Vec<(usize, Entity, Handle<Flesh>, u32)>,
    // This frame's marks into the wound sheet and the film, and whether the film dries this frame (by how much).
    pub marks: Vec<Stamp>,
    pub strokes: Vec<Stamp>,
    pub dry: Option<f32>,
    // The table as it is on the card, and which of its rows changed this frame.
    pub table: Vec<[f32; 4]>,
    pub changed: Vec<bool>,
    pub rows: Vec<u32>,
    // How many of Hurt::happened have been drawn.
    pub seen: usize,
    // The film's clock: now, when blood was last laid on it, when it last dried (film.rs).
    pub clock: f32,
    pub painted: f32,
    pub dried: f32,
    // The holes and openings drawn (hider.rs).
    pub cloth_holes: usize,
    pub skin_holes: usize,
    pub windows: usize,
    pub opened: bool,
    // Each dressing drawn: its entity and material, and the blood shown in it (how far spread, how dry).
    pub dressings: Vec<(Entity, Handle<Flesh>, f32, f32)>,
    // A part's skinned mesh and its parent, for things skinned to this person's bones (dressings).
    pub skinned: Option<(SkinnedMesh, Entity)>,
    // The gunshot wounds recorded (marks.rs): each one's place at rest and how far it reaches; when the clock in their
    // row was last sent.
    pub shots: Vec<(Vec3, f32)>,
    pub shot_clock: f32,
}

impl Skin {
    // Row `row`, texel `k` of the table set, and the row sent this frame.
    pub fn put(&mut self, row: usize, k: usize, v: [f32; 4]) {
        self.table[row * WIDE + k] = v;
        if !self.changed[row] {
            self.changed[row] = true;
            self.rows.push(row as u32);
        }
    }

    // Corner `v`'s `k`th texel.
    pub fn corner(&mut self, v: usize, k: usize, value: [f32; 4]) {
        let i = v * PER_CORNER + k;
        self.put(CORNERS + i / WIDE, i % WIDE, value);
    }
}

// A sheet the stamps are drawn into and the skin's material reads: no mipmaps (the TS's had none), clamped, filtered.
fn sheet(format: TextureFormat) -> Image {
    let mut image = Image::new_target_texture(SIZE, SIZE, format, None);
    image.data = None;
    image.copy_on_resize = false;
    image.asset_usage = RenderAssetUsages::RENDER_WORLD;
    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor::linear());
    image
}

// Each person with medicine and no Skin yet: their materials made their own, the skin under the clothes put in (drawn
// only through holes), the sheets and the table made.
#[allow(clippy::too_many_arguments)]
fn clothe(
    mut commands: Commands,
    people: Query<(Entity, &Person), (With<crate::npc::Hurt>, Without<Skin>)>,
    parts: Query<(&MeshMaterial3d<StandardMaterial>, &SkinnedMesh, &ChildOf)>,
    standard: Res<Assets<StandardMaterial>>,
    mut flesh: ResMut<Assets<Flesh>>,
    mut images: ResMut<Assets<Image>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut under_meshes: Local<std::collections::HashMap<(String, usize), Handle<Mesh>>>,
) {
    // (SKIN_PLAIN=1: the people as phase 1 drew them, for measuring what this costs.)
    if std::env::var_os("SKIN_PLAIN").is_some() {
        return;
    }
    for (e, person) in &people {
        let body = &person.body;
        let wounds = images.add(sheet(TextureFormat::Rgba8Unorm));
        let film = images.add(sheet(TextureFormat::Rg16Float));
        let rows = CORNERS + (body.position.len() * PER_CORNER).div_ceil(WIDE) + crate::bruise::RIDER_ROWS;
        let mut table = Image::new_fill(
            Extent3d { width: WIDE as u32, height: rows as u32, depth_or_array_layers: 1 },
            TextureDimension::D2,
            &[0; 16],
            TextureFormat::Rgba32Float,
            RenderAssetUsages::RENDER_WORLD,
        );
        table.sampler = ImageSampler::nearest();
        let state = images.add(table);
        let make = |base: &StandardMaterial, mode: u32, start: usize, flesh: &mut Assets<Flesh>| {
            let mut base = base.clone();
            if mode == SKIN || mode == UNDER {
                // A trace of clearcoat, so that Bevy draws a second, wet layer over the skin wherever skin.wesl says
                // blood lies on it (and none where it does not).
                base.clearcoat = 1e-4;
                base.clearcoat_perceptual_roughness = 0.1;
            }
            flesh.add(Flesh {
                base,
                extension: Wounded {
                    info: UVec4::new(mode, start as u32, 0, 0),
                    wounds: wounds.clone(),
                    film: film.clone(),
                    state: state.clone(),
                    layout: Vec4::ZERO,
                    stain: Vec4::ZERO,
                    soak: crate::soak::DRY,
                    soak_at: Vec4::ZERO,
                    soak_scale: Vec4::ZERO,
                },
            })
        };
        let mut materials = Vec::new();
        let mut skin_base = None;
        for &(i, part_entity) in &person.parts {
            let p = &body.parts[i];
            let mode = match p.kind.as_str() {
                "skin" => SKIN,
                "cloth" => CLOTH,
                "hair" | "brows" => CARRIED,
                _ => continue,
            };
            let Ok((m, skinned, parent)) = parts.get(part_entity) else { continue };
            let Some(base) = standard.get(&m.0) else { continue };
            if mode == SKIN {
                skin_base = Some((base.clone(), skinned.clone(), i, parent.parent()));
            }
            let h = make(base, mode, p.vertex_start, &mut flesh);
            commands.entity(part_entity).remove::<MeshMaterial3d<StandardMaterial>>().insert(MeshMaterial3d(h.clone()));
            materials.push((i, part_entity, h, mode));
        }
        // The skin under the clothes, which person.rs leaves out: drawn with the skin's own material made to show only
        // through holes in the clothes (hider.rs), as the TS's skin-under submesh was.
        let mut skinned_at = None;
        if let Some((base, skinned, _, space)) = skin_base {
            skinned_at = Some((skinned.clone(), space));
            for (i, p) in body.parts.iter().enumerate().filter(|(_, p)| p.kind == "skin" && p.under) {
                let mesh = under_meshes.entry((body.name.clone(), i)).or_insert_with(|| meshes.add(crate::person::part_mesh(body, p))).clone();
                let h = make(&base, UNDER, p.vertex_start, &mut flesh);
                // (Beside the skin, under the same parent: the mesh's own space.)
                let part_entity = commands
                    .spawn((Mesh3d(mesh), MeshMaterial3d(h.clone()), skinned.clone(), bevy::camera::visibility::DynamicSkinnedMeshBounds, ChildOf(space)))
                    .id();
                materials.push((i, part_entity, h, UNDER));
            }
        }
        let mut table = vec![[0.0f32; 4]; rows * WIDE];
        table[0] = [0.0; 4];
        commands.entity(e).insert((
            Skin {
                wounds,
                film,
                state,
                materials,
                marks: Vec::new(),
                strokes: Vec::new(),
                dry: None,
                table,
                changed: vec![false; rows],
                rows: Vec::new(),
                seen: 0,
                clock: 0.0,
                painted: f32::NEG_INFINITY,
                dried: 0.0,
                cloth_holes: 0,
                skin_holes: 0,
                windows: 0,
                opened: false,
                dressings: Vec::new(),
                skinned: skinned_at,
                shots: Vec::new(),
                shot_clock: 0.0,
            },
            crate::runs::Runs::default(),
        ));
    }
}

// What was painted last frame has gone to the card: a new frame's marks.
fn begin(mut people: Query<&mut Skin>) {
    for mut s in &mut people {
        s.marks.clear();
        s.strokes.clear();
        s.dry = None;
        let rows = std::mem::take(&mut s.rows);
        for &r in &rows {
            s.changed[r as usize] = false;
        }
        s.rows = rows;
        s.rows.clear();
    }
}

// The X-ray (anatomy.rs `see`) for these materials: the skin at 18% and the clothes at 6%, blended, while seen through.
fn see(seeing: Res<crate::anatomy::Seeing>, people: Query<&Skin>, mut flesh: ResMut<Assets<Flesh>>, mut was: Local<std::collections::HashMap<AssetId<Flesh>, AlphaMode>>) {
    if !seeing.is_changed() {
        return;
    }
    for skin in &people {
        for (_, _, h, mode) in &skin.materials {
            let Some(mut m) = flesh.get_mut(h) else { continue };
            if seeing.0 {
                was.entry(h.id()).or_insert(m.base.alpha_mode);
                m.base.alpha_mode = AlphaMode::Blend;
                m.base.base_color.set_alpha(if *mode == CLOTH { 0.06 } else { 0.18 });
            } else {
                m.base.alpha_mode = was.remove(&h.id()).unwrap_or(AlphaMode::Opaque);
                m.base.base_color.set_alpha(1.0);
            }
        }
    }
}

// --- what medicine says happened, drawn ----------------------------------------------------------------------------

// Each person's Hurt::happened since last looked: wounds painted, holes cut, blood laid on the skin and set running.
// Once in PostUpdate, after everything that hurts people in Update; and again in First, before the list is cleared, for
// what was done later in the frame (a scenario's steps, in Last). Then the clocks: the runs, the film drying, the
// bruising's changes into the table.
#[allow(clippy::too_many_arguments)]
fn look(
    late: bool,
    time: &Time,
    people: &mut Query<(Entity, &Person, &Transform, &mut crate::vitals::Vitals, &mut crate::npc::Hurt, &mut Skin, &mut crate::runs::Runs)>,
    dice: &mut crate::vitals::Dice,
    rng: &mut crate::rng::Rng,
    flesh: &mut Assets<Flesh>,
    cache: &mut std::collections::HashMap<String, std::sync::Arc<crate::runs::Filed>>,
    out: &mut (Vec<crate::runs::Drip>, Vec<crate::runs::Pooled>, Vec<(Vec3, f32)>),
    soaked: &mut Vec<crate::runs::Soaked>,
) {
    use crate::hider::{tangent, Opening};
    use crate::npc::{Happened, Kind, Npc, Way};
    for (entity, person, root, mut vitals, mut hurt, mut skin, mut runs) in people.iter_mut() {
        let skin = &mut *skin;
        let runs = &mut *runs;
        let traced = hurt.traced.clone();
        let npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut *dice, frame: 0 };
        let from = skin.seen.min(npc.hurt.happened.len());
        // A bullet's way in comes as its scraped ring (Hole) and then its hole (Wound); a way in with no Hole before it is
        // the bullet going in again after coming out.
        let mut ringed: Option<(Vec3, bool)> = None;
        for k in from..npc.hurt.happened.len() {
            // (cloned: drawing it asks the body where things are)
            let h = npc.hurt.happened[k].clone();
            match h {
                Happened::Wound { hit, way, size } => match hit.kind {
                    // A hole in the clothes, and the skin under them shown through it.
                    Kind::Cloth => {
                        let r = size * if way == Way::Out { 0.9 } else { 0.55 };
                        let n = hit.rest_normal;
                        skin.cloth_hole(&Opening { at: hit.rest, ex: tangent(n), ey: n, half: [r, if way == Way::Out { -2.0 } else { -1.0 }] });
                        skin.window(hit.rest, n, r * 1.6, 0.06);
                    }
                    Kind::Skin if way == Way::In => {
                        let ring = ringed.take().filter(|(at, _)| *at == hit.rest);
                        skin.entry(&hit, size, ring.is_some_and(|r| r.1), ring.is_none(), rng);
                    }
                    Kind::Skin => skin.exit(&hit, size, None, 0.006, rng),
                    _ => {}
                },
                Happened::Hole { hit, open, ring, .. } => {
                    if hit.kind == Kind::Skin && !open {
                        ringed = Some((hit.rest, ring));
                    }
                }
                Happened::Spatter { enter, dir, range, .. } if enter.kind == Kind::Skin => {
                    let dir = npc.rest_to_world(enter.owner).inverse().transform_vector3(dir);
                    skin.aimed(&enter, dir, range);
                }
                Happened::Stab { ends, gape, double, cloths } => {
                    skin.stab(&ends[0], &ends[1], gape, double);
                    // The clothes are slit the same way, cleanly, and the skin under them shows through it.
                    let along = ends[1].rest - ends[0].rest;
                    let half = along.length() / 2.0 + 0.001;
                    for c in &cloths {
                        let n = c.rest_normal;
                        let ex = (along - n * along.dot(n)).normalize_or(tangent(n));
                        skin.cloth_hole(&Opening { at: c.rest, ex, ey: n, half: [half, 0.0008] });
                        skin.window(c.rest, n, half * 1.3, 0.06);
                    }
                }
                Happened::Tear { hit, arms, fat, .. } => {
                    let size = arms.iter().map(|(_, h)| h[0] * 2.0).fold(0.0, f32::max);
                    skin.exit(&hit, size, Some(&arms), fat, rng);
                }
                Happened::Welling { hit, ml } => {
                    skin.blot(&hit, 0.003 + ml.sqrt() * 0.0015, 0.25, rng);
                    runs.start(&hit, ml * 0.3, None);
                }
                Happened::Runs { hit, ml, from } => {
                    if hit.kind == Kind::Cloth {
                        soaked.push(crate::runs::Soaked { person: entity, rest: hit.rest, ml });
                    } else {
                        runs.start(&hit, ml, from);
                    }
                }
                Happened::Blot { hit, r, wet } => skin.blot(&hit, r, wet, rng),
                Happened::Slit { a, b, deep, gapes } => skin.cut(&a, &b, deep, gapes),
                _ => {}
            }
        }
        skin.seen = if late { 0 } else { npc.hurt.happened.len() };
        // The inside of the body seen through a hole right through its wall (hider.rs `skin_hole`, viscera.rs): the skin
        // drawn both ways from now on.
        let single = |h: &Handle<Flesh>, flesh: &Assets<Flesh>| flesh.get(h).is_some_and(|m| m.base.cull_mode.is_some());
        if skin.opened && skin.materials.iter().any(|(_, _, h, mode)| (*mode == SKIN || *mode == UNDER) && single(h, flesh)) {
            for (_, _, h, mode) in &skin.materials {
                if (*mode == SKIN || *mode == UNDER)
                    && let Some(mut m) = flesh.get_mut(h)
                {
                    m.base.cull_mode = None;
                    m.base.double_sided = true;
                }
            }
        }
        if late {
            continue;
        }
        let dt = time.delta_secs();
        skin.dry(dt);
        // The gunshot wounds' clock, which they well, dry and darken by: four times a second is plenty.
        if !skin.shots.is_empty() && skin.clock - skin.shot_clock >= 0.25 {
            skin.shot_clock = skin.clock;
            let n = skin.shots.len() as f32;
            skin.put(crate::marks::SHOTS, 0, [skin.clock, n, 0.0, 0.0]);
        }
        runs.update(&npc, skin, rng, cache, dt, &mut crate::runs::Out { drips: &mut out.0, pooled: &mut out.1, soaked: &mut out.2 });
        for (rest, ml) in out.2.drain(..) {
            soaked.push(crate::runs::Soaked { person: entity, rest, ml });
        }
        // The bruising's changes into the table, and the recent blows' shapes with the clock they fade by (ten times a
        // second, while there are any).
        let b = &mut npc.hurt.bruise;
        let changed = std::mem::take(&mut b.changed);
        for &v in &changed {
            let o = b.out[v as usize];
            for (k, t) in o.iter().enumerate() {
                skin.corner(v as usize, k, t.to_array());
            }
            b.taken(v);
        }
        b.changed = changed;
        b.changed.clear();
        let records = b.records.len();
        let clock = b.clock;
        if records > 0 && (clock - skin.table[0][0] > 0.1 || skin.table[0][1] as usize != records) {
            for (i, r) in b.records.iter().enumerate() {
                for (k, t) in r.iter().enumerate() {
                    skin.put(0, 2 + i * 3 + k, t.to_array());
                }
            }
            let row = skin.table[0];
            skin.put(0, 0, [clock, records as f32, row[2], row[3]]);
        }
    }
}

// Each dressing put on (dressing.rs) drawn: its gauze laid on the skin and skinned to it, carried by the swelling under
// it, the clothes over it cut away; and the blood in it shown as it spreads and dries, a few times a second at most.
fn bandage(
    mut commands: Commands,
    mut people: Query<(&Person, &mut crate::npc::Hurt, &mut Skin)>,
    mut flesh: ResMut<Assets<Flesh>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut rng: ResMut<crate::rng::Rng>,
    mut every: Local<f32>,
    time: Res<Time>,
) {
    *every -= time.delta_secs();
    let repaint = *every <= 0.0;
    if repaint {
        *every = 0.25;
    }
    for (person, mut hurt, mut skin) in &mut people {
        let skin = &mut *skin;
        while skin.dressings.len() < hurt.dressings.len() {
            let k = skin.dressings.len();
            let d = &hurt.dressings[k];
            let layer = hurt.dressings[..k].iter().filter(|o| o.covers.covers(d.mark.rest)).count();
            let built = crate::dressing::gauze(&person.body, d, layer);
            let (Some(g), Some((skinned, space))) = (built, skin.skinned.clone()) else {
                skin.dressings.push((Entity::PLACEHOLDER, Handle::default(), 0.0, 0.0));
                continue;
            };
            let Some((_, slot)) = hurt.bruise.ride(&g.rest, 0.0, 1.0, None) else {
                skin.dressings.push((Entity::PLACEHOLDER, Handle::default(), 0.0, 0.0));
                continue;
            };
            let h = flesh.add(Flesh {
                base: StandardMaterial {
                    perceptual_roughness: 0.93,
                    reflectance: 0.3,
                    double_sided: true,
                    cull_mode: None,
                    alpha_mode: AlphaMode::Mask(0.5),
                    ..default()
                },
                extension: Wounded {
                    info: UVec4::new(GAUZE, slot, g.pad as u32, 0),
                    wounds: skin.wounds.clone(),
                    film: skin.film.clone(),
                    state: skin.state.clone(),
                    layout: g.layout,
                    stain: Vec4::new(0.0, 0.0, rng.next() * std::f32::consts::TAU, rng.next() * std::f32::consts::TAU),
                    soak: crate::soak::DRY,
                    soak_at: Vec4::ZERO,
                    soak_scale: Vec4::ZERO,
                },
            });
            let e = commands.spawn((Mesh3d(meshes.add(g.mesh)), MeshMaterial3d(h.clone()), skinned, bevy::camera::visibility::DynamicSkinnedMeshBounds, ChildOf(space))).id();
            // The clothes over it cut away, and the skin under them shown there.
            let (at, ey, r, depth) = g.opening;
            if person.body.parts.iter().any(|p| p.worn) {
                skin.cloth_hole(&crate::hider::Opening { at, ex: crate::hider::tangent(ey), ey, half: [r, r] });
                skin.window(at, ey, r, depth);
            }
            skin.dressings.push((e, h, 0.0, 0.0));
        }
        if !repaint {
            continue;
        }
        for (k, d) in hurt.dressings.iter().enumerate() {
            let (r, dry) = crate::dressing::stain(d);
            let (_, h, was_r, was_dry) = &mut skin.dressings[k];
            if r - *was_r > 0.0007 || (dry - *was_dry).abs() > 0.04 {
                *was_r = r;
                *was_dry = dry;
                if let Some(mut m) = flesh.get_mut(&*h) {
                    m.extension.stain.x = r;
                    m.extension.stain.y = dry;
                }
            }
        }
    }
}

#[allow(clippy::type_complexity)]
fn looking(
    time: Res<Time>,
    mut people: Query<(Entity, &Person, &Transform, &mut crate::vitals::Vitals, &mut crate::npc::Hurt, &mut Skin, &mut crate::runs::Runs)>,
    mut dice: ResMut<crate::vitals::Dice>,
    mut rng: ResMut<crate::rng::Rng>,
    mut flesh: ResMut<Assets<Flesh>>,
    mut cache: Local<std::collections::HashMap<String, std::sync::Arc<crate::runs::Filed>>>,
    mut out: Local<(Vec<crate::runs::Drip>, Vec<crate::runs::Pooled>, Vec<(Vec3, f32)>)>,
    mut soaked: Local<Vec<crate::runs::Soaked>>,
    mut drips: MessageWriter<crate::runs::Drip>,
    mut pooled: MessageWriter<crate::runs::Pooled>,
    mut soaks: MessageWriter<crate::runs::Soaked>,
) {
    look(false, &time, &mut people, &mut dice, &mut rng, &mut flesh, &mut cache, &mut out, &mut soaked);
    drips.write_batch(out.0.drain(..));
    pooled.write_batch(out.1.drain(..));
    soaks.write_batch(soaked.drain(..));
}

#[allow(clippy::type_complexity)]
fn looking_late(
    time: Res<Time>,
    mut people: Query<(Entity, &Person, &Transform, &mut crate::vitals::Vitals, &mut crate::npc::Hurt, &mut Skin, &mut crate::runs::Runs)>,
    mut dice: ResMut<crate::vitals::Dice>,
    mut rng: ResMut<crate::rng::Rng>,
    mut flesh: ResMut<Assets<Flesh>>,
    mut cache: Local<std::collections::HashMap<String, std::sync::Arc<crate::runs::Filed>>>,
    mut out: Local<(Vec<crate::runs::Drip>, Vec<crate::runs::Pooled>, Vec<(Vec3, f32)>)>,
    mut soaked: Local<Vec<crate::runs::Soaked>>,
    mut soaks: MessageWriter<crate::runs::Soaked>,
) {
    look(true, &time, &mut people, &mut dice, &mut rng, &mut flesh, &mut cache, &mut out, &mut soaked);
    soaks.write_batch(soaked.drain(..));
}

// --- the passes, in the render world -------------------------------------------------------------------------------

// What each person's sheets get this frame, copied out of the main world.
struct Job {
    wounds: AssetId<Image>,
    film: AssetId<Image>,
    state: AssetId<Image>,
    marks: std::ops::Range<u32>,
    strokes: std::ops::Range<u32>,
    dry: Option<f32>,
    rows: std::ops::Range<usize>,
}

#[derive(Resource, Default)]
struct Painting {
    jobs: Vec<Job>,
    stamps: Vec<Stamp>,
    // The rows of each table sent: (row, its texels' start in `texels`).
    rows: Vec<(u32, usize)>,
    texels: Vec<[f32; 4]>,
}

fn extract(people: Extract<Query<&Skin>>, mut painting: ResMut<Painting>) {
    let p = &mut *painting;
    p.jobs.clear();
    p.stamps.clear();
    p.rows.clear();
    p.texels.clear();
    for s in &people {
        if s.marks.is_empty() && s.strokes.is_empty() && s.dry.is_none() && s.rows.is_empty() {
            continue;
        }
        let m0 = p.stamps.len() as u32;
        p.stamps.extend_from_slice(&s.marks);
        let s0 = p.stamps.len() as u32;
        p.stamps.extend_from_slice(&s.strokes);
        let r0 = p.rows.len();
        for &r in &s.rows {
            p.rows.push((r, p.texels.len()));
            p.texels.extend_from_slice(&s.table[r as usize * WIDE..(r as usize + 1) * WIDE]);
        }
        p.jobs.push(Job {
            wounds: s.wounds.id(),
            film: s.film.id(),
            state: s.state.id(),
            marks: m0..s0,
            strokes: s0..p.stamps.len() as u32,
            dry: s.dry,
            rows: r0..p.rows.len(),
        });
    }
}

#[derive(Resource)]
struct Painter {
    // The stamps' pipelines, for the wound sheet's format and the film's; the drying.
    marks: CachedRenderPipelineId,
    strokes: CachedRenderPipelineId,
    dry: CachedRenderPipelineId,
    buffer: RawBufferVec<Stamp>,
}

fn init_painter(mut commands: Commands, cache: Res<PipelineCache>, assets: Res<AssetServer>, fullscreen: Res<FullscreenShader>) {
    let shader: Handle<Shader> = assets.load("embedded://cold_chain/paint.wesl");
    let layout = VertexBufferLayout::from_vertex_formats(VertexStepMode::Instance, [VertexFormat::Float32x4; 4]);
    // The lighter of the two, every channel.
    let max = BlendComponent { src_factor: BlendFactor::One, dst_factor: BlendFactor::One, operation: BlendOperation::Max };
    let stamps = |format: TextureFormat, label: &'static str| RenderPipelineDescriptor {
        label: Some(label.into()),
        vertex: VertexState { shader: shader.clone(), entry_point: Some("vertex".into()), buffers: vec![layout.clone()], ..default() },
        fragment: Some(FragmentState {
            shader: shader.clone(),
            entry_point: Some("fragment".into()),
            targets: vec![Some(ColorTargetState { format, blend: Some(BlendState { color: max, alpha: max }), write_mask: ColorWrites::ALL })],
            ..default()
        }),
        ..default()
    };
    let marks = cache.queue_render_pipeline(stamps(TextureFormat::Rgba8Unorm, "wound marks"));
    let strokes = cache.queue_render_pipeline(stamps(TextureFormat::Rg16Float, "blood film"));
    // The film's wetness times the blend constant.
    let scale = BlendComponent { src_factor: BlendFactor::Zero, dst_factor: BlendFactor::Constant, operation: BlendOperation::Add };
    let dry = cache.queue_render_pipeline(RenderPipelineDescriptor {
        label: Some("blood film drying".into()),
        vertex: fullscreen.to_vertex_state(),
        fragment: Some(FragmentState {
            shader: shader.clone(),
            entry_point: Some("dry".into()),
            targets: vec![Some(ColorTargetState {
                format: TextureFormat::Rg16Float,
                blend: Some(BlendState { color: scale, alpha: scale }),
                write_mask: ColorWrites::GREEN,
            })],
            ..default()
        }),
        ..default()
    });
    commands.insert_resource(Painter { marks, strokes, dry, buffer: RawBufferVec::new(BufferUsages::VERTEX) });
}

// The table's changed rows, straight into its texture.
fn write_tables(painting: Res<Painting>, images: Res<RenderAssets<GpuImage>>, queue: Res<RenderQueue>) {
    for job in &painting.jobs {
        let Some(image) = images.get(job.state) else { continue };
        for &(row, at) in &painting.rows[job.rows.clone()] {
            queue.write_texture(
                TexelCopyTextureInfo { texture: &image.texture, mip_level: 0, origin: Origin3d { x: 0, y: row, z: 0 }, aspect: TextureAspect::All },
                bytemuck::cast_slice(&painting.texels[at..at + WIDE]),
                TexelCopyBufferLayout { offset: 0, bytes_per_row: Some((WIDE * 16) as u32), rows_per_image: None },
                Extent3d { width: WIDE as u32, height: 1, depth_or_array_layers: 1 },
            );
        }
    }
}

// Every person's marks of this frame: one pass into each sheet that has any, all its stamps in one draw; the film dried
// where it is due. Before the cameras draw, so the skin shows them this frame.
fn paint(
    painting: Res<Painting>,
    mut painter: ResMut<Painter>,
    cache: Res<PipelineCache>,
    images: Res<RenderAssets<GpuImage>>,
    queue: Res<RenderQueue>,
    mut ctx: RenderContext,
) {
    if painting.jobs.is_empty() {
        return;
    }
    let painter = &mut *painter;
    let (Some(marks), Some(strokes), Some(dry)) = (cache.get_render_pipeline(painter.marks), cache.get_render_pipeline(painter.strokes), cache.get_render_pipeline(painter.dry)) else {
        return;
    };
    let (marks, strokes, dry) = (marks.clone(), strokes.clone(), dry.clone());
    let (marks, strokes, dry) = (&marks, &strokes, &dry);
    // (Timed when render diagnostics are on: SKIN_TIMES=1, for the check.)
    let diagnostics = ctx.diagnostic_recorder();
    let span = diagnostics.as_ref().map(|d| d.time_span(ctx.command_encoder(), "skin_paint"));
    paint_all(&painting, painter, marks, strokes, dry, &images, &queue, &mut ctx);
    if let Some(span) = span {
        span.end(ctx.command_encoder());
    }
}

#[allow(clippy::too_many_arguments)]
fn paint_all(painting: &Painting, painter: &mut Painter, marks: &RenderPipeline, strokes: &RenderPipeline, dry: &RenderPipeline, images: &RenderAssets<GpuImage>,
             queue: &RenderQueue, ctx: &mut RenderContext) {
    if !painting.stamps.is_empty() {
        painter.buffer.clear();
        painter.buffer.values_mut().extend_from_slice(&painting.stamps);
        painter.buffer.write_buffer(ctx.render_device(), queue);
    }
    let Some(buffer) = painter.buffer.buffer().cloned() else {
        // (Nothing stamped yet anywhere: only drying.)
        for job in &painting.jobs {
            if let (Some(k), Some(film)) = (job.dry, images.get(job.film)) {
                pass(ctx, &film.texture_view, dry, None, 0..0, Some(k));
            }
        }
        return;
    };
    for job in &painting.jobs {
        if !job.marks.is_empty()
            && let Some(sheet) = images.get(job.wounds)
        {
            pass(ctx, &sheet.texture_view, marks, Some(&buffer), job.marks.clone(), None);
        }
        if let Some(film) = images.get(job.film) {
            if let Some(k) = job.dry {
                pass(ctx, &film.texture_view, dry, None, 0..0, Some(k));
            }
            if !job.strokes.is_empty() {
                pass(ctx, &film.texture_view, strokes, Some(&buffer), job.strokes.clone(), None);
            }
        }
    }
}

fn pass(ctx: &mut RenderContext, target: &TextureView, pipeline: &RenderPipeline, buffer: Option<&Buffer>, stamps: std::ops::Range<u32>, scale: Option<f32>) {
    let mut pass = ctx.begin_tracked_render_pass(RenderPassDescriptor {
        label: Some("skin paint"),
        color_attachments: &[Some(RenderPassColorAttachment {
            view: target,
            depth_slice: None,
            resolve_target: None,
            ops: Operations { load: LoadOp::Load, store: StoreOp::Store },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_render_pipeline(pipeline);
    match (buffer, scale) {
        (_, Some(k)) => {
            pass.set_blend_constant(LinearRgba::new(k, k, k, k));
            pass.draw(0..3, 0..1);
        }
        (Some(buffer), None) => {
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..6, stamps);
        }
        _ => {}
    }
}

pub fn plugin(app: &mut App) {
    if std::env::var_os("SKIN_TIMES").is_some() {
        app.add_plugins(bevy::render::diagnostic::RenderDiagnosticsPlugin);
    }
    bevy::asset::embedded_asset!(app, "skin.wesl");
    bevy::asset::embedded_asset!(app, "paint.wesl");
    app.add_plugins(MaterialPlugin::<Flesh>::default())
        .add_systems(First, (begin, looking_late).chain().before(crate::npc::forget))
        .add_systems(Update, (clothe.after(crate::npc::fit), see))
        .add_systems(PostUpdate, (bandage, looking, crate::runs::draw_beads).chain().before(TransformSystems::Propagate));
    let Some(render) = app.get_sub_app_mut(RenderApp) else { return };
    render
        .init_resource::<Painting>()
        .add_systems(RenderStartup, init_painter)
        .add_systems(ExtractSchedule, extract)
        .add_systems(bevy::render::Render, write_tables.in_set(bevy::render::RenderSystems::Prepare))
        // (Begin comes before the cameras' Render: the skin shows this frame's marks.)
        .add_systems(bevy::render::renderer::RenderGraph, paint.in_set(RenderGraphSystems::Begin));
}

// --- the check ------------------------------------------------------------------------------------------------------
//
// `cargo run -- --scenario skin --out <dir>`: the people standing are shot (a pistol in the neck, a rifle through the
// face from the side), stabbed in the belly through the shirt, cut across the cheek, hit on the cheekbone with a bat and
// punched in the eye, and one shot in the forearm has it bandaged at once. Each wound is photographed close up at 0, 5,
// 30 and 120 seconds: the blood welling and running and drying, the bruise coming up. The cameras are off in between,
// so the two minutes go by at the speed the bodies and the medicine step. tools/port-skin.mjs does the same in the TS
// game.

use crate::npc::{Crossing, Kind as Surface};
use crate::scenario::{log, Step};

// Where each wound is to be looked at from: whose, its place on the body at rest and the bone that carries it, the
// skin's normal there, and how far back.
#[derive(Resource, Default)]
struct Views(Vec<(String, Entity, Crossing, f32)>);

fn person_at(w: &mut World, body: &str) -> Entity {
    let mut q = w.query::<(Entity, &Person)>();
    q.iter(w).find(|(_, p)| p.body.name == body).unwrap().0
}

fn missile(weapon: &str) -> crate::wounds::Missile {
    use crate::wounds::Missile;
    let gun = |energy, mass, speed, calibre, channel, soft, hard| Missile { energy, mass, speed: Some(speed), calibre, channel, soft, hard, pellets: Some(1), ..default() };
    match weapon {
        "pistol" => gun(480.0, 0.008, 360.0, 0.009, 0.006, 12.0, 110.0),
        "rifle" => gun(2700.0, 0.0097, 820.0, 0.0078, 0.012, 28.0, 160.0),
        _ => Missile { energy: 70.0, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40.0, reach: Some(0.17), blade: true, edges: Some(1), taper: Some(0.04), ..default() },
    }
}

// A point `offset` (the TS's space) from a bone's head as the person stands now.
fn near(npc: &crate::npc::Npc, bone: &str, offset: [f32; 3]) -> Vec3 {
    let b = npc.bone_index(bone);
    npc.world_of(npc.body().bones[b].head, b, None).0 + crate::babylon(offset[0], offset[1], offset[2])
}

// The people held as they stand: every segment of their ragdolls fixed, as the TS's check (which steps no physics) has
// them, so that each wound is seen as it was made and the two games are compared on the same pose.
fn hold(w: &mut World) {
    let segs: Vec<Entity> = w.query::<&crate::ragdoll::Ragdoll>().iter(w).flat_map(|r| r.segs.iter().map(|s| s.entity).collect::<Vec<_>>()).collect();
    for e in segs {
        w.entity_mut(e).insert(bevy_rapier3d::prelude::RigidBody::Fixed);
    }
    // (and nothing over the pictures but the picture)
    let mut q = w.query_filtered::<&mut Visibility, With<Text>>();
    for mut v in q.iter_mut(w) {
        *v = Visibility::Hidden;
    }
}

fn hurt_them(w: &mut World) {
    use crate::npc::with;
    let ahead = crate::babylon(0.0, 0.0, 1.0);
    let mut views = Vec::new();
    // A pistol in the side of the young man's neck.
    let who = person_at(w, "buyer");
    let r = with(w, who, |npc| {
        let at = near(npc, "neck01", [0.025, -0.03, 0.0]);
        if let Some(c) = npc.surface(at - ahead * 1.5, ahead, 3.0, false).into_iter().find(|c| c.kind == Surface::Skin) {
            views.push(("pistol_neck".to_string(), who, c, 0.3));
        }
        let p = crate::wounds::pierce(npc, at - ahead * 1.5, ahead, &missile("pistol"), 3.0);
        // And a knife drawn across his left cheek, as the hands' slash gives the crossings.
        let mut hits = Vec::new();
        for k in 0..7 {
            let at = near(npc, "head", [-0.045 + k as f32 * 0.008, 0.02 - k as f32 * 0.003, 0.0]);
            if let Some(c) = npc.surface(at - ahead * 0.5, ahead, 1.0, false).into_iter().find(|c| c.kind == Surface::Skin) {
                hits.push(c);
            }
        }
        if let Some(mid) = hits.get(hits.len() / 2) {
            views.push(("knife_cut".to_string(), who, mid.clone(), 0.28));
        }
        // (as weapons.rs gives them: where the blade went into the skin, in the world)
        let points: Vec<Vec3> = hits.iter().map(|h| h.point).collect();
        npc.slash_through(&points, 0.022, crate::babylon(1.0, 0.0, 0.0));
        format!("{:?} cut {}", p.stopped, hits.len())
    });
    log(w, serde_json::json!({ "event": "neck and cut", "result": r }));
    // A rifle through the old man's face, from his right.
    let who = person_at(w, "oldman");
    let r = with(w, who, |npc| {
        let side = crate::babylon(-1.0, 0.0, 0.0);
        let at = near(npc, "jaw", [0.0, -0.025, -0.04]);
        // (Where it goes in and comes out: the first skin it crosses, and the last within a quarter of a metre of it.)
        let skins: Vec<Crossing> = npc.surface(at - side * 1.5, side, 3.0, false).into_iter().filter(|c| c.kind == Surface::Skin).collect();
        if let Some(first) = skins.first().cloned() {
            if let Some(last) = skins.iter().rfind(|c| c.t < first.t + 0.25).filter(|c| c.t > first.t) {
                views.push(("rifle_out".to_string(), who, last.clone(), 0.3));
            }
            views.push(("rifle_in".to_string(), who, first, 0.3));
        }
        let p = crate::wounds::pierce(npc, at - side * 1.5, side, &missile("rifle"), 3.0);
        format!("stopped {} energy {}", p.stopped, p.energy)
    });
    log(w, serde_json::json!({ "event": "rifle", "result": r }));
    // The groundskeeper stabbed in the belly through his shirt, and punched in the left eye.
    let who = person_at(w, "sexton");
    let r = with(w, who, |npc| {
        let at = near(npc, "spine03", [0.05, 0.02, 0.0]);
        let m = crate::wounds::Missile { across: Some(crate::babylon(0.0, -1.0, 0.0)), ..missile("knife") };
        if let Some(c) = npc.surface(at - ahead * 0.5, ahead, 0.67, false).into_iter().next() {
            views.push(("knife_stab".to_string(), who, c, 0.3));
        }
        let p = crate::wounds::pierce(npc, at - ahead * 0.5, ahead, &m, 0.67);
        let eye = near(npc, "head", [-0.033, 0.035, 0.0]);
        if let Some(skin) = npc.surface(eye - ahead * 0.5, ahead, 1.0, false).into_iter().find(|c| c.kind == Surface::Skin) {
            views.push(("punch_eye".to_string(), who, skin.clone(), 0.3));
            crate::wounds::blow(npc, skin.point, ahead, 2.9, 10.0, Some(crate::wounds::Tool::Stiff(5e4)));
        }
        format!("stab stopped {}", p.stopped)
    });
    log(w, serde_json::json!({ "event": "stab and punch", "result": r }));
    // The man in the hood shot in the right forearm and bandaged at once; then a bat to his left cheekbone.
    let who = person_at(w, "hood");
    let r = with(w, who, |npc| {
        let at = near(npc, "lowerarm01.R", [0.0, -0.06, 0.0]);
        let p = crate::wounds::pierce(npc, at - ahead * 1.5, ahead, &missile("pistol"), 3.0);
        let mut dressed = "none".to_string();
        if let Some(wound) = crate::dressing::wounds(npc).into_iter().next() {
            views.push(("bandaged".to_string(), who, wound.mark.clone(), 0.35));
            if let Some(d) = crate::dressing::dress(npc, &wound) {
                dressed = npc.hurt.dressings[d].kind.to_string();
            }
        }
        let cheek = near(npc, "head", [-0.035, 0.03, 0.0]);
        if let Some(skin) = npc.surface(cheek - ahead * 0.5, ahead, 1.0, false).into_iter().find(|c| c.kind == Surface::Skin) {
            views.push(("bat_cheek".to_string(), who, skin.clone(), 0.3));
            crate::wounds::blow(npc, skin.point, ahead, 0.79, 15.5, None);
        }
        format!("stopped {} dressed {dressed}", p.stopped)
    });
    log(w, serde_json::json!({ "event": "bandage and bat", "result": r }));
    log(w, serde_json::json!({ "event": "views", "views": views.iter().map(|v| (v.0.clone(), v.2.point.to_array(), v.2.rest.to_array())).collect::<Vec<_>>() }));
    w.insert_resource(Views(views));
}

// The cameras on or off: off, a frame costs only what the bodies and the medicine do.
fn cameras(on: bool) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        let mut q = w.query::<&mut Camera>();
        for mut c in q.iter_mut(w) {
            c.is_active = on;
        }
    }))
}

// Every wound photographed: the player put `d` back from it along its normal (level), looking at it.
fn photograph(at: &'static str) -> Step {
    looks(at, 3, None)
}

// Each view held `hold` frames before its picture; with `timed`, only the views of that distance, and what the render
// passes took over the hold logged with each (SKIN_TIMES=1).
fn looks(at: &'static str, hold: u32, timed: Option<&'static str>) -> Step {
    Step::Do(Box::new(move |w: &mut World| {
        // What the passes cost, as the render diagnostics last measured them (SKIN_TIMES=1).
        if let Some(store) = w.get_resource::<bevy::diagnostic::DiagnosticsStore>() {
            let times: Vec<(String, f64)> = store
                .iter()
                .filter(|d| d.path().as_str().starts_with("render/"))
                .filter_map(|d| Some((d.path().as_str().to_string(), d.smoothed()?)))
                .collect();
            log(w, serde_json::json!({ "event": "gpu", "at": at, "times": times }));
        }
        // (the HUD's vitals panel comes and goes with whoever is looked at: nothing over the pictures)
        let mut q = w.query_filtered::<&mut Visibility, Or<(With<Text>, (With<Node>, Without<ImageNode>, Without<ChildOf>))>>();
        for mut v in q.iter_mut(w) {
            *v = Visibility::Hidden;
        }
        let views = w.resource::<Views>().0.clone();
        let mut steps = std::collections::VecDeque::new();
        for (name, who, c, d) in views {
            if timed.is_some_and(|t| !name.ends_with(t)) {
                continue;
            }
            // Where the wound is now, and which way its skin faces.
            let Some((point, normal)) = crate::npc::with(w, who, |npc| {
                let (p, n) = npc.world_of(c.rest, c.owner, Some(c.rest_normal));
                (p, n.unwrap())
            }) else { continue };
            let eye = point + normal * d + Vec3::new(0.0, 0.02, 0.0);
            let name = format!("{name}_{at}");
            steps.push_back(Step::Do(Box::new(move |w: &mut World| {
                w.resource_scope(|w, map: Mut<crate::map::Map>| {
                    let mut q = w.query::<&mut crate::player::Player>();
                    for mut p in q.iter_mut(w) {
                        p.spawn(&map, eye.x, eye.z, Some(point), eye.y);
                    }
                });
                // (the gunshot check's lamp, above the camera and a little out from it)
                let mut q = w.query_filtered::<&mut Transform, With<Lamp>>();
                for mut t in q.iter_mut(w) {
                    t.translation = eye + Vec3::new(0.0, 0.3, 0.0) + normal * 0.15;
                }
            })));
            steps.push_back(Step::Wait(hold));
            if timed.is_some() {
                let view = name.clone();
                steps.push_back(Step::Do(Box::new(move |w: &mut World| {
                    let Some(store) = w.get_resource::<bevy::diagnostic::DiagnosticsStore>() else { return };
                    let times: Vec<(String, f64)> = store
                        .iter()
                        .filter(|d| d.path().as_str().starts_with("render/"))
                        .filter_map(|d| Some((d.path().as_str().to_string(), d.average()?)))
                        .collect();
                    log(w, serde_json::json!({ "event": "held", "view": view, "times": times }));
                })));
            }
            // (the vitals of whoever is looked at come up again with each new face: put away again)
            steps.push_back(Step::Do(Box::new(|w: &mut World| {
                let mut q = w.query_filtered::<&mut Visibility, Or<(With<Text>, (With<Node>, Without<ImageNode>, Without<ChildOf>))>>();
                for mut v in q.iter_mut(w) {
                    *v = Visibility::Hidden;
                }
            })));
            steps.push_back(Step::Shot(name));
        }
        crate::scenario::push_front(w, steps);
    }))
}

pub fn scenario() -> Vec<Step> {
    let mut s = vec![Step::Wait(30), Step::Do(Box::new(hold)), Step::Wait(2), Step::Do(Box::new(hurt_them)), photograph("0")];
    let mut at = 0.0;
    for (t, name) in [(5.0, "5"), (30.0, "30"), (120.0, "120")] {
        // (Each round of pictures takes a few frames of its own.)
        s.push(cameras(false));
        s.push(Step::Wait(((t - at) * 60.0) as u32 - 30));
        s.push(cameras(true));
        s.push(photograph(name));
        at = t;
    }
    // What the wounds cost to draw: each close-up held two seconds, the render passes' times logged (SKIN_TIMES=1; run
    // again with GUNSHOT_BLANK=1, the same views with no shots fired, for the difference).
    if std::env::var_os("SKIN_TIMES").is_some() {
        s.push(looks("60", 120, Some("macro")));
    }
    s
}

// --- the gunshot check ----------------------------------------------------------------------------------------------
//
// `cargo run -- --scenario gunshot --out <dir>`: a pistol, a rifle and a shotgun into the face, neck, chest, arm and
// thigh of the people standing, some from 20 cm (soot and powder round the way in) and some from 2 m (the pellets
// apart), every way in and way out photographed at 7 cm (a close-up lens's view), 20 cm and 2 m, at 0, 10 and 60 s,
// under a lamp beside the camera. Their clothes are taken off for it (hidden, and the skin under them shown
// everywhere), so that a wound on the chest or thigh is seen as a pathologist sees it; blood that would have soaked
// into them still does.

// One shot: whose, at which bone and how far from its head (the TS's space), along which way (the TS's space), with
// what, from how far off the muzzle is.
const SHOTS: [(&str, &str, &str, [f32; 3], [f32; 3], &str, f32); 9] = [
    ("pistol_face", "buyer", "jaw", [0.0, -0.025, -0.04], [-1.0, 0.0, 0.0], "pistol", 0.2),
    ("rifle_face", "hood", "jaw", [0.0, -0.025, -0.04], [-1.0, 0.0, 0.0], "rifle", 2.0),
    ("pistol_neck", "hood", "neck01", [0.025, -0.03, 0.0], [0.0, 0.0, 1.0], "pistol", 2.0),
    ("rifle_chest", "sexton", "spine01", [0.06, -0.02, 0.0], [0.0, 0.0, 1.0], "rifle", 2.0),
    ("shotgun_chest", "hood", "spine02", [-0.06, 0.0, 0.0], [0.0, 0.0, 1.0], "shotgun", 2.0),
    ("pistol_arm", "oldman", "upperarm01.L", [0.0, 0.0, 0.0], [0.0, 0.0, 1.0], "pistol", 0.2),
    ("rifle_thigh", "buyer", "upperleg01.L", [0.0, 0.0, 0.0], [0.0, 0.0, 1.0], "rifle", 2.0),
    ("shotgun_thigh", "oldman", "upperleg01.R", [0.0, 0.0, 0.0], [0.0, 0.0, 1.0], "shotgun", 0.2),
    ("shotgun_face", "sexton", "head", [0.0, 0.02, 0.0], [0.0, 0.0, 1.0], "shotgun", 2.5),
];

// A gun's missile as weapons.rs ARMS has it; the shotgun's charge as weapons.rs `fire` makes it when the muzzle is
// within about a metre of the body.
fn gun(weapon: &str, range: f32) -> crate::wounds::Missile {
    use crate::wounds::Missile;
    match weapon {
        "shotgun" if range < 0.8 => Missile { name: Some("charge".into()), energy: 170.0 * 9.0 * (1.0 - (range + 0.5) * 0.1), mass: 0.0035 * 9.0,
                                              speed: Some(400.0), calibre: if range + 0.5 < 0.6 { 0.022 } else { 0.026 }, channel: 0.024, soft: 42.0, hard: 120.0, pellets: Some(9), ..default() },
        "shotgun" => Missile { name: Some("pellet".into()), energy: 170.0, mass: 0.0035, speed: Some(400.0), calibre: 0.0084, channel: 0.005, soft: 9.0, hard: 90.0, pellets: Some(9), ..default() },
        _ => missile(weapon),
    }
}

#[derive(Component)]
struct Lamp;

fn undress(w: &mut World) {
    hold(w);
    // Nothing in the hands.
    let mut weapons = w.resource_mut::<crate::weapons::Weapons>();
    if let Some(k) = weapons.slots.iter().position(|s| s.is_none()) {
        weapons.slot = k;
    }
    let people: Vec<(Entity, Vec<Entity>)> = w
        .query::<(Entity, &Person)>()
        .iter(w)
        .map(|(e, p)| (e, p.parts.iter().filter(|(i, _)| p.body.parts[*i].kind == "cloth").map(|(_, e)| *e).collect()))
        .collect();
    for (e, cloths) in people {
        for c in cloths {
            w.entity_mut(c).insert(Visibility::Hidden);
        }
        // (one window onto the skin under the clothes as big as the person)
        if let Some(mut skin) = w.get_mut::<Skin>(e) {
            skin.window(Vec3::ZERO, Vec3::Y, 5.0, 5.0);
        }
    }
    w.spawn((Lamp, PointLight { intensity: crate::map::CANDELA, range: 6.0, shadow_maps_enabled: false, ..default() }, Transform::default()));
}

fn shoot_them(w: &mut World) {
    use crate::npc::with;
    let mut views = Vec::new();
    // (GUNSHOT=pistol_face,rifle_chest fires only those; GUNSHOT_AT=macro,close only those views.)
    let only = std::env::var("GUNSHOT").ok();
    let at_only = std::env::var("GUNSHOT_AT").ok();
    for (name, body, bone, offset, way, weapon, range) in SHOTS {
        if only.as_ref().is_some_and(|o| !o.split(',').any(|x| x == name)) {
            continue;
        }
        let who = person_at(w, body);
        let dir = crate::babylon(way[0], way[1], way[2]).normalize();
        let mut rng = crate::rng::Rng::new(name.len() as u32 * 7919);
        let r = with(w, who, |npc| {
            // (A limb's wound halfway down it, whichever way the limb hangs.)
            let at = match bone.strip_prefix("upper") {
                Some(rest) => {
                    let lower = format!("lower{rest}");
                    near(npc, bone, offset).lerp(near(npc, &lower, offset), 0.45)
                }
                None => near(npc, bone, offset),
            };
            // (The muzzle is `range` off the skin: wounds.rs counts the range from a point MUZZLE behind it.)
            let skins: Vec<Crossing> = npc.surface(at - dir * 3.0, dir, 6.0, false).into_iter().filter(|c| c.kind == Surface::Skin).collect();
            let Some(first) = skins.first().cloned() else { return "missed".to_string() };
            let origin = first.point - dir * (range + 0.45);
            let m = gun(weapon, range);
            let mut said = Vec::new();
            // (GUNSHOT_BLANK=1: nothing fired, the same views: what the skin costs unhurt.)
            let n = if std::env::var_os("GUNSHOT_BLANK").is_some() { 0 } else if m.name.as_deref() == Some("pellet") { 9 } else { 1 };
            for k in 0..n {
                let d = if k == 0 { dir } else { crate::weapons::jitter(&mut rng, dir, 0.028) };
                let p = crate::wounds::pierce(npc, origin, d, &m, 3.0 + range);
                said.push(format!("stopped {} energy {:.0}", p.stopped, p.energy));
            }
            views.push((format!("{name}_in"), who, first.clone()));
            // (the way out: the last skin it crosses within 30 cm, not the inside of the mouth on its way)
            if let Some(out) = skins.iter().rfind(|c| c.t < first.t + 0.3).filter(|c| c.t > first.t) {
                views.push((format!("{name}_out"), who, out.clone()));
            }
            format!("{} scale {:.2} {}", weapon, first.scale, said.join(", "))
        });
        log(w, serde_json::json!({ "event": name, "result": r }));
    }
    let mut all = Vec::new();
    for (name, who, c) in views {
        for (d, at) in [(0.07, "macro"), (0.2, "close"), (2.0, "far")] {
            if at_only.as_ref().is_some_and(|o| !o.split(',').any(|x| x == at)) {
                continue;
            }
            all.push((format!("{name}_{at}"), who, c.clone(), d));
        }
    }
    w.insert_resource(Views(all));
}

pub fn gunshot() -> Vec<Step> {
    let mut s = vec![Step::Wait(30), Step::Do(Box::new(undress)), Step::Wait(2), Step::Do(Box::new(shoot_them)), photograph("0")];
    let mut at = 0.0;
    for (t, name) in [(10.0, "10"), (60.0, "60")] {
        s.push(cameras(false));
        s.push(Step::Wait(((t - at) * 60.0) as u32 - 30));
        s.push(cameras(true));
        s.push(photograph(name));
        at = t;
    }
    // What the wounds cost to draw: each close-up held two seconds, the render passes' times logged (SKIN_TIMES=1; run
    // again with GUNSHOT_BLANK=1, the same views with no shots fired, for the difference).
    if std::env::var_os("SKIN_TIMES").is_some() {
        s.push(looks("60", 120, Some("macro")));
    }
    s
}
