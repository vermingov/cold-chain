// What things are made of (src/surfaces.ts).
//
// Each surface is a photoscanned material from Poly Haven, fetched by tools/surfaces.sh: colour, normal and roughness
// maps. This loads them by name. (The TS also handed out materials made of them, mottled across the world by a noise
// texture; nothing in the sandbox asks for one, so that waits for something that does.)
//
// And every texture in the game is given its mipmaps here, as Babylon gave each one it loaded: Bevy loads an image as
// its one full-size level, and a floor of concrete seen far off then shimmers.

use std::collections::HashMap;

use bevy::image::ImageLoaderSettings;
use bevy::prelude::*;
use bevy::render::render_resource::{TextureFormat, TextureUsages};

pub struct Maps {
    pub albedo: Handle<Image>,
    pub normal: Handle<Image>,
    pub rough: Handle<Image>,
}

#[derive(Resource, Default)]
pub struct Surfaces {
    loaded: HashMap<String, Maps>,
}

impl Surfaces {
    pub fn load(&mut self, assets: &AssetServer, names: &[&str]) {
        for &name in names {
            self.loaded.entry(name.to_string()).or_insert_with(|| Maps {
                albedo: image(assets, format!("surfaces/{name}/albedo.jpg"), true),
                normal: image(assets, format!("surfaces/{name}/normal.jpg"), false),
                rough: image(assets, format!("surfaces/{name}/rough.jpg"), false),
            });
        }
    }

    pub fn maps(&self, name: &str) -> &Maps {
        self.loaded.get(name).unwrap_or_else(|| panic!("surface not loaded: {name}"))
    }
}

// A texture: colour in sRGB, anything else (normals, roughness) as the numbers it holds.
pub fn image(assets: &AssetServer, path: String, srgb: bool) -> Handle<Image> {
    assets.load_builder().with_settings(move |s: &mut ImageLoaderSettings| s.is_srgb = srgb).load(path)
}

// Every image as it arrives: a grey one (a roughness map) widened to four channels, since a material reads its
// roughness from green and metalness from blue, which a one-channel texture reads as nothing; then halved and halved
// again down to a pixel, each level the average of the four under it.
fn mipmaps(mut events: MessageReader<AssetEvent<Image>>, mut images: ResMut<Assets<Image>>) {
    for e in events.read() {
        let (AssetEvent::LoadedWithDependencies { id } | AssetEvent::Added { id }) = e else { continue };
        let Some(image) = images.get(*id) else { continue };
        let d = &image.texture_descriptor;
        let wanted = matches!(d.format, TextureFormat::R8Unorm | TextureFormat::Rgba8Unorm | TextureFormat::Rgba8UnormSrgb);
        // (Not what a camera draws into.)
        if image.data.is_none() || d.usage.contains(TextureUsages::RENDER_ATTACHMENT) || d.mip_level_count > 1 || d.size.depth_or_array_layers > 1 || !wanted || d.size.width < 2 {
            continue;
        }
        let mut image = images.get_mut(*id).unwrap();
        if image.texture_descriptor.format == TextureFormat::R8Unorm {
            let grey = image.data.take().unwrap();
            image.data = Some(grey.iter().flat_map(|&g| [g, g, g, 255]).collect());
            image.texture_descriptor.format = TextureFormat::Rgba8Unorm;
        }
        let (w, h) = (image.texture_descriptor.size.width as usize, image.texture_descriptor.size.height as usize);
        let (data, levels) = chain(image.data.take().unwrap(), w, h);
        image.data = Some(data);
        image.texture_descriptor.mip_level_count = levels;
    }
}

// Four bytes a pixel, `w` by `h`: every level after it appended.
pub fn chain(mut data: Vec<u8>, mut w: usize, mut h: usize) -> (Vec<u8>, u32) {
    let mut levels = 1;
    let mut at = 0;
    while w > 1 || h > 1 {
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        let mut next = vec![0u8; nw * nh * 4];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let px = |xx: usize, yy: usize| data[at + ((yy.min(h - 1)) * w + xx.min(w - 1)) * 4 + c] as u32;
                    let sum = px(2 * x, 2 * y) + px(2 * x + 1, 2 * y) + px(2 * x, 2 * y + 1) + px(2 * x + 1, 2 * y + 1);
                    next[(y * nw + x) * 4 + c] = ((sum + 2) / 4) as u8;
                }
            }
        }
        at = data.len();
        data.extend_from_slice(&next);
        w = nw;
        h = nh;
        levels += 1;
    }
    (data, levels)
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Surfaces>().add_systems(PostUpdate, mipmaps);
}

#[test]
fn mip_chain() {
    let (data, levels) = chain(vec![0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255], 2, 2);
    assert_eq!(levels, 2);
    assert_eq!(&data[16..], &[128, 128, 128, 255]);
}
