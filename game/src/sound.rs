// What is heard (src/sound.ts). For now only the takes themselves: the ElevenLabs recordings listed in
// assets/sounds/manifest.json (tools/sfx.py) and the people's cries in assets/cries, each name with its takes, loaded
// as the game starts. Playing them (where they are, the room, walls between) is phase 2's (dev/PORT.md).

use std::collections::HashMap;

use bevy::prelude::*;

#[derive(Resource, Default)]
pub struct Sounds {
    // A sound's name ("shot-pistol") and its takes, one picked each time it is played.
    pub takes: HashMap<String, Vec<Handle<AudioSource>>>,
}

fn load(assets: Res<AssetServer>, mut sounds: ResMut<Sounds>) {
    for dir in ["sounds", "cries"] {
        let path = crate::asset_file(&format!("{dir}/manifest.json"));
        let manifest: HashMap<String, Vec<String>> =
            serde_json::from_slice(&std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("sound manifest");
        for (name, files) in manifest {
            sounds.takes.insert(name, files.iter().map(|f| assets.load(format!("{dir}/{f}"))).collect());
        }
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<Sounds>().add_systems(Startup, load);
}
