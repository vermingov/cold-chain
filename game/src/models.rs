// The things standing in the rooms (src/models.ts).
//
// Chairs, crates, lamps: Poly Haven's models, cut down offline by tools/props.mjs to one small binary of geometry each
// ("SIXP") and up to three maps. The manifest lists every model's size and bounds, so a place can decide what fits
// where before a single vertex has been read; geometry and textures come later, for the models a place uses.
//
// How a model sits is fixed when it is built (the manifest's `anchor`): `floor` stands on y = 0, centred in x and z,
// its front facing ahead; `wall` hangs on a wall whose surface is the plane through the origin square to ahead and
// sticks out ahead; `ceiling` hangs down from y = 0. So placing one is a position and a yaw.
//
// A model is a mesh and a material for each of its parts (Bevy draws one material a mesh); every placement shares
// them.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use bevy::render::render_resource::Face;
use serde::Deserialize;

use crate::person::{array, f32s, read_file, vec3s, RawArray};
use crate::surfaces::image;

// How much of a map's metalness is honoured. There is no environment here to reflect, so a full metal is black except
// where a lamp glints off it; held back, steel keeps some body under the highlight.
const METALNESS: f32 = 0.6;

// Glass is drawn as a thin film: mostly what is behind it, plus the lamp's highlight.
const GLASS_ALPHA: f32 = 0.22;

#[derive(Deserialize, Clone)]
pub struct Entry {
    pub anchor: String,
    pub bounds: Bounds,
    pub size: [f32; 3],
    pub file: String,
}

#[derive(Deserialize, Clone)]
pub struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

#[derive(Deserialize)]
struct Manifest {
    models: HashMap<String, Entry>,
}

#[derive(Deserialize)]
struct PartInfo {
    name: String,
    #[serde(rename = "indexStart")]
    index_start: usize,
    #[serde(rename = "indexCount")]
    index_count: usize,
    #[serde(default, rename = "doubleSided")]
    double_sided: bool,
    #[serde(default)]
    glass: bool,
    #[serde(default)]
    grey: Option<f32>,
    #[serde(default)]
    metallic: Option<f32>,
    #[serde(default)]
    roughness: Option<f32>,
    textures: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Header {
    name: String,
    parts: Vec<PartInfo>,
    #[serde(rename = "invertY")]
    invert_y: bool,
    arrays: Vec<RawArray>,
}

// One model's parts, each a mesh with its material.
#[derive(Clone)]
pub struct Model {
    pub parts: Vec<(Handle<Mesh>, Handle<StandardMaterial>)>,
}

#[derive(Resource)]
pub struct Models {
    pub manifest: HashMap<String, Entry>,
    pub sources: HashMap<String, Model>,
}

impl Models {
    pub fn info(&self, name: &str) -> Option<&Entry> {
        self.manifest.get(name)
    }

    // Geometry and textures for these models, once each.
    pub fn prepare(&mut self, names: &[&str], assets: &AssetServer, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) {
        for &name in names {
            if self.sources.contains_key(name) {
                continue;
            }
            let entry = self.info(name).unwrap_or_else(|| panic!("no such model: {name}")).clone();
            let model = read(&format!("props/{}", entry.file), assets, meshes, materials);
            self.sources.insert(name.to_string(), model);
        }
    }

    // One of `name` under `parent`: its parts as children of a new entity at `at`. Null if not prepared.
    pub fn place(&self, commands: &mut Commands, name: &str, at: Transform) -> Option<Entity> {
        let model = self.sources.get(name)?;
        let root = commands.spawn((at, Visibility::default(), Name::new(name.to_string()))).id();
        for (mesh, material) in &model.parts {
            commands.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(material.clone()), ChildOf(root)));
        }
        Some(root)
    }
}

fn read(path: &str, assets: &AssetServer, meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) -> Model {
    let (buf, header, base) = read_file(path, b"SIXP");
    let h: Header = serde_json::from_value(header).expect(path);
    let get = |name: &str| array(&buf, base, &h.arrays, name);
    let position = vec3s(get("position"));
    let normal = vec3s(get("normal"));
    // (A model built with its images upside down for Babylon is turned back over: Bevy's v runs down the image.)
    let uv: Vec<Vec2> = f32s(get("uv")).chunks_exact(2).map(|t| Vec2::new(t[0], if h.invert_y { 1.0 - t[1] } else { t[1] })).collect();
    let raw = get("index");
    let wide = h.arrays.iter().any(|a| a.name == "index" && a.kind == "uint32");
    let index: Vec<u32> = if wide {
        raw.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect()
    } else {
        raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]]) as u32).collect()
    };
    let parts = h
        .parts
        .iter()
        .map(|part| {
            let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
                .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, position.clone())
                .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, normal.clone())
                .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv.clone())
                .with_inserted_indices(Indices::U32(index[part.index_start..part.index_start + part.index_count].to_vec()));
            if part.textures.contains_key("normal") {
                mesh.generate_tangents().unwrap_or_else(|e| warn!("{path} {}: no tangents: {e}", part.name));
            }
            (meshes.add(mesh), materials.add(material(part, assets)))
        })
        .collect();
    info!("model {} read", h.name);
    Model { parts }
}

// PBR with nothing but the lamps' light, as the walls are. A part without a map falls back on the single value the
// header carries.
fn material(part: &PartInfo, assets: &AssetServer) -> StandardMaterial {
    let tex = |k: &str, srgb| part.textures.get(k).map(|f| image(assets, format!("props/{f}"), srgb));
    let grey = part.grey.unwrap_or(0.5);
    let mut m = StandardMaterial {
        base_color: if part.textures.contains_key("albedo") { Color::WHITE } else { Color::linear_rgb(grey, grey, grey) },
        base_color_texture: tex("albedo", true),
        normal_map_texture: tex("normal", false),
        // Babylon's specularIntensity 0.7 as Bevy's reflectance (F0 goes as its square).
        reflectance: 0.5 * 0.7f32.sqrt(),
        // Cloth, cages and the insides of open boxes are single sheets.
        double_sided: part.double_sided,
        cull_mode: if part.double_sided { None } else { Some(Face::Back) },
        ..default()
    };
    match tex("orm", false) {
        // Roughness from green, metalness from blue (and the occlusion in red left out, as the TS left it).
        Some(orm) => {
            m.metallic_roughness_texture = Some(orm);
            m.metallic = METALNESS;
            m.perceptual_roughness = 1.0;
        }
        None => {
            m.metallic = part.metallic.unwrap_or(0.0) * METALNESS;
            m.perceptual_roughness = part.roughness.unwrap_or(1.0);
        }
    }
    if part.glass {
        m.base_color.set_alpha(GLASS_ALPHA);
        m.alpha_mode = AlphaMode::Blend;
    }
    m
}

fn load(mut commands: Commands) {
    let path = crate::asset_file("props/manifest.json");
    let manifest: Manifest = serde_json::from_slice(&std::fs::read(&path).expect("props/manifest.json")).expect("props/manifest.json");
    commands.insert_resource(Models { manifest: manifest.models, sources: HashMap::new() });
}

pub fn plugin(app: &mut App) {
    app.add_systems(PreStartup, load);
}
