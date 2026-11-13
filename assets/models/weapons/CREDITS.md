# Weapon model credits

| File | Source model | Author | Licence | URL |
|------|--------------|--------|---------|-----|
| knife.glb | Fish Knife | Mateusz Sadek (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/fish_knife |
| sword.glb | Antique Estoc | Ulan Cabanilla (model), James Ray Cock (textures) (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/antique_estoc |
| bat.glb | Baseball Bat | Enrique Martín (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/baseball_bat |
| pistol.glb | Service Pistol | Mateusz Sadek (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/service_pistol |
| rifle.glb | Bolt Action Rifle 7.62 | Mateusz Sadek (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/bolt_action_rifle_7_62 |
| shotgun.glb | Double Barrel Shotgun | ExodeCode | CC BY 4.0 | https://exode.itch.io/double-barrel-shotgun |
| ak.glb | High-poly AK-47 | lamoot (OpenGameArt) | CC0 1.0 | https://opengameart.org/content/high-poly-ak-47 |
| m4.glb | M4A1 Assault Rifle | nisu (OpenGameArt) | CC0 1.0 | https://opengameart.org/content/m4a1-assault-rifle |
| grenade.glb | built in code (tools/arms/m67.mjs) | Cold Chain | — | textures: https://ambientcg.com/view?id=PaintedMetal002 and https://ambientcg.com/view?id=Metal038 (ambientCG, CC0 1.0) |
| (bandage, medkit) | built in code (src/sandbox/dressing.ts buildKit) | Cold Chain | — | no outside assets; textures drawn in code |

CC BY 4.0 requires attribution: "Double Barrel Shotgun" by ExodeCode (https://exode.itch.io/double-barrel-shotgun), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changed: converted from FBX to glTF, AO/roughness/metalness packed into one texture, textures downscaled to 1024 px WebP.

Changes to the Poly Haven models: 1k glTF downloads repacked as GLB with WebP textures. pistol.glb keeps only the wood-grip pistol (variant a) with its magazine seated in the grip; the second pistol, the loose loaded magazine and the cartridge were removed. rifle.glb drops the loose cartridge.

ak.glb (tools/arms/ak.mjs): the model comes as one untextured mesh. Its loose parts were sorted into wood (butt, pistol grip, both handguards) and steel, given box-projected texture coordinates and smooth normals, and scaled to 0.88 m. Textures: "Lacquered Cherry Wood" by Poly Haven (CC0, https://polyhaven.com/a/lacquered_cherry_wood), recoloured to the AK's red-brown lacquer, and ambientCG's Metal038 (CC0, https://ambientcg.com/view?id=Metal038), darkened to blued steel.

m4.glb (tools/arms/m4.mjs): FBX converted to glTF with FBX2glTF; the model's own 2K maps downscaled to 1024 px WebP, roughness and metalness packed into one texture.

grenade.glb (tools/arms/m67.mjs): no free M67 under CC0 or CC-BY was found, so it is built from real measures: body, fuze, spoon and pin with ring as separate nodes (spoon and pin can be animated). Paint: ambientCG's PaintedMetal002 (CC0), its blue repainted olive drab with bare steel in the chips.
