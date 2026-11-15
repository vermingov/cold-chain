// The picture (src/picture.ts): what is done to every frame after it is drawn.
//
// No tape, no scanlines: this game is in colour and wants to look like a camera that works. A filmic curve, a little
// bloom round whatever is really bright (a lamp, a lit window), grain, and the corners drawn in.
//
// The lights are given in Babylon's units (a lamp's candela, map.rs) and the camera's own exposure is set to one, so
// what Bevy draws is what Babylon drew before its image processing; then picture.wesl does that processing as Babylon
// did (Bevy's tonemapping is off for it): the exposure, the vignette, ACES, gamma, the contrast and the grain. Bevy's
// bloom comes before it, as Babylon's did, and its FXAA after.

use bevy::anti_alias::fxaa::Fxaa;
use bevy::camera::Exposure;
use bevy::core_pipeline::tonemapping::{tonemapping, Tonemapping};
use bevy::core_pipeline::{Core3d, FullscreenShader};
use bevy::ecs::query::QueryItem;
use bevy::ecs::system::lifetimeless::Read;
use bevy::light::ShadowFilteringMethod;
use bevy::post_process::bloom::{bloom, Bloom, BloomCompositeMode, BloomPrefilter};
use bevy::prelude::*;
use bevy::render::extract_component::{ComponentUniforms, DynamicUniformIndex, ExtractComponent, ExtractComponentPlugin, UniformComponentPlugin};
use bevy::render::render_resource::binding_types::{sampler, texture_2d, uniform_buffer};
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, ViewQuery};
use bevy::render::sync_component::SyncComponent;
use bevy::camera::Hdr;
use bevy::render::view::ViewTarget;
use bevy::render::{GpuResourceAppExt, Render, RenderApp, RenderStartup, RenderSystems};

use crate::rng::Rng;

// The exposure looks high and is not: the curve crushes everything dim to black. The sandbox set 1.6 (picture.ts's
// own default, 1.9, was for a night outdoors).
pub const EXPOSURE: f32 = 1.6;

// What the picture pass is told each frame, on the camera.
#[derive(Component, Clone, Copy, ShaderType)]
pub struct Picture {
    pub exposure: f32,
    pub contrast: f32,
    // Babylon's vignette weight.
    pub vignette: f32,
    // Babylon's grain intensity: up to this many 255ths either way. Nought for none.
    pub grain: f32,
    // A new one every frame: the grain moves.
    pub seed: f32,
    pub aspect: f32,
}

impl Default for Picture {
    fn default() -> Self {
        Picture { exposure: EXPOSURE, contrast: 1.12, vignette: 2.4, grain: 7.0, seed: 1.0, aspect: 16.0 / 9.0 }
    }
}

impl SyncComponent<RenderApp> for Picture {
    type Target = Self;
}

impl ExtractComponent<RenderApp> for Picture {
    type QueryData = Read<Picture>;
    type QueryFilter = With<Camera>;
    type Out = Self;

    fn extract_component(p: QueryItem<'_, '_, Self::QueryData>) -> Option<Self> {
        Some(*p)
    }
}

// Babylon's bloom: what is brighter than three quarters (its luminance after the exposure: here before it, so the
// threshold is that over the exposure) blurred and added back at 0.35. Bevy's prefilter takes the threshold off what
// it lets through where Babylon's let all of it through, and its blur is its own mip chain rather than a 48-pixel
// kernel at half size.
pub fn bloom_setting(kernel: f32) -> Bloom {
    Bloom {
        intensity: 0.35,
        low_frequency_boost: 0.0,
        low_frequency_boost_curvature: 0.0,
        high_pass_frequency: kernel / 48.0,
        prefilter: BloomPrefilter { threshold: 0.75 / EXPOSURE, threshold_softness: 0.0 },
        composite_mode: BloomCompositeMode::Additive,
        ..default()
    }
}

// Every 3D camera graded as the TS graded the player's: HDR, Bevy's tonemapping off for picture.wesl's, its exposure at
// one (the lamps are in Babylon's units), bloom, FXAA, the hall's fill light (map.rs), soft shadows.
fn grade(add: On<Add<Camera3d>>, mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    commands.entity(add.entity).insert((
        Hdr,
        Tonemapping::None,
        Exposure { ev100: -(1.2f32).log2() },
        bloom_setting(48.0),
        Fxaa::default(),
        Msaa::Off,
        ShadowFilteringMethod::Gaussian,
        crate::map::fill_light(&mut images),
        Picture::default(),
    ));
}

fn animate(mut pictures: Query<(&mut Picture, &Camera)>, mut rng: ResMut<Rng>) {
    for (mut p, camera) in &mut pictures {
        p.seed = rng.next() + 1.0;
        if let Some(size) = camera.logical_viewport_size() {
            p.aspect = size.x / size.y.max(1.0);
        }
    }
}

#[derive(Resource)]
struct PicturePipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    fullscreen: FullscreenShader,
    shader: Handle<Shader>,
}

impl SpecializedRenderPipeline for PicturePipeline {
    type Key = TextureFormat;

    fn specialize(&self, format: TextureFormat) -> RenderPipelineDescriptor {
        RenderPipelineDescriptor {
            label: Some("picture".into()),
            layout: vec![self.layout.clone()],
            vertex: self.fullscreen.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: self.shader.clone(),
                targets: vec![Some(ColorTargetState { format, blend: None, write_mask: ColorWrites::ALL })],
                ..default()
            }),
            ..default()
        }
    }
}

#[derive(Component)]
struct PicturePipelineId(CachedRenderPipelineId);

fn init_pipeline(mut commands: Commands, device: Res<RenderDevice>, fullscreen: Res<FullscreenShader>, assets: Res<AssetServer>) {
    let layout = BindGroupLayoutDescriptor::new(
        "picture",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (texture_2d(TextureSampleType::Float { filterable: true }), sampler(SamplerBindingType::Filtering), uniform_buffer::<Picture>(true)),
        ),
    );
    let sampler = device.create_sampler(&SamplerDescriptor { min_filter: FilterMode::Linear, mag_filter: FilterMode::Linear, ..default() });
    commands.insert_resource(PicturePipeline {
        layout,
        sampler,
        fullscreen: fullscreen.clone(),
        shader: assets.load("embedded://cold_chain/picture.wesl"),
    });
}

fn prepare_pipelines(
    mut commands: Commands,
    cache: Res<PipelineCache>,
    mut pipelines: ResMut<SpecializedRenderPipelines<PicturePipeline>>,
    pipeline: Res<PicturePipeline>,
    views: Query<(Entity, &ViewTarget), With<Picture>>,
) {
    for (entity, target) in &views {
        let id = pipelines.specialize(&cache, &pipeline, target.main_texture_format());
        commands.entity(entity).insert(PicturePipelineId(id));
    }
}

fn picture(
    view: ViewQuery<(&ViewTarget, &PicturePipelineId, &DynamicUniformIndex<Picture>)>,
    cache: Res<PipelineCache>,
    pipeline: Res<PicturePipeline>,
    uniforms: Res<ComponentUniforms<Picture>>,
    mut ctx: RenderContext,
) {
    let (target, id, index) = view.into_inner();
    let (Some(render), Some(binding)) = (cache.get_render_pipeline(id.0), uniforms.uniforms().binding()) else { return };
    let post = target.post_process_write();
    let bind_group = ctx.render_device().create_bind_group(
        Some("picture"),
        &cache.get_bind_group_layout(&pipeline.layout),
        &BindGroupEntries::sequential((post.source, &pipeline.sampler, binding)),
    );
    let mut pass = ctx.begin_tracked_render_pass(RenderPassDescriptor {
        label: Some("picture"),
        color_attachments: &[Some(RenderPassColorAttachment {
            view: post.destination,
            depth_slice: None,
            resolve_target: None,
            ops: Operations::default(),
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_render_pipeline(render);
    pass.set_bind_group(0, &bind_group, &[index.index()]);
    pass.draw(0..3, 0..1);
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "picture.wesl");
    app.add_plugins((ExtractComponentPlugin::<Picture>::default(), UniformComponentPlugin::<Picture>::default()))
        .add_observer(grade)
        .add_systems(Update, animate);
    let Some(render) = app.get_sub_app_mut(RenderApp) else { return };
    render
        .init_gpu_resource::<SpecializedRenderPipelines<PicturePipeline>>()
        .add_systems(RenderStartup, init_pipeline)
        .add_systems(Render, prepare_pipelines.in_set(RenderSystems::Prepare))
        .add_systems(Core3d, picture.after(bloom).before(tonemapping));
}
