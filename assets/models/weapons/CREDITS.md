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
| deagle.glb | Desert Eagle | SirDraco65 (OpenGameArt) | CC0 1.0 | https://opengameart.org/content/desert-eagle-0 |
| r22.glb | built in code (tools/arms/r22.mjs) | Cold Chain | — | textures: https://polyhaven.com/a/fine_grained_wood (Rob Tuytel, Poly Haven, CC0 1.0) and https://ambientcg.com/view?id=Metal038 (ambientCG, CC0 1.0) |
| shovel.glb | Rusted Spade 01 | Blemonade (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/rusted_spade_01 |
| sledge.glb | Sledgehammer 01 | Dylan Guzman (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/sledgehammer_01 |
| hammer.glb | Wooden Hammer 01 (a claw hammer) | James Ray Cock (Poly Haven) | CC0 1.0 | https://polyhaven.com/a/wooden_hammer_01 |
| (bandage, medkit) | built in code (src/sandbox/dressing.ts buildKit) | Cold Chain | — | no outside assets; textures drawn in code |

CC BY 4.0 requires attribution: "Double Barrel Shotgun" by ExodeCode (https://exode.itch.io/double-barrel-shotgun), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changed: converted from FBX to glTF, AO/roughness/metalness packed into one texture, textures downscaled to 1024 px WebP.

Changes to the Poly Haven models: 1k glTF downloads repacked as GLB with WebP textures. pistol.glb keeps only the wood-grip pistol (variant a) with its magazine seated in the grip; the second pistol, the loose loaded magazine and the cartridge were removed. rifle.glb drops the loose cartridge.

ak.glb (tools/arms/ak.mjs): the model comes as one untextured mesh. Its loose parts were sorted into wood (butt, pistol grip, both handguards) and steel, given box-projected texture coordinates and smooth normals, and scaled to 0.88 m. Textures: "Lacquered Cherry Wood" by Poly Haven (CC0, https://polyhaven.com/a/lacquered_cherry_wood), recoloured to the AK's red-brown lacquer, and ambientCG's Metal038 (CC0, https://ambientcg.com/view?id=Metal038), darkened to blued steel.

m4.glb (tools/arms/m4.mjs): FBX converted to glTF with FBX2glTF; the model's own 2K maps downscaled to 1024 px WebP, roughness and metalness packed into one texture.

grenade.glb (tools/arms/m67.mjs): no free M67 under CC0 or CC-BY was found, so it is built from real measures: body, fuze, spoon and pin with ring as separate nodes (spoon and pin can be animated). Paint: ambientCG's PaintedMetal002 (CC0), its blue repainted olive drab with bare steel in the chips.

deagle.glb (tools/arms/deagle.mjs): FBX converted to glTF with FBX2glTF, its animation armature dropped, scaled to the real Mark XIX 6 inch's 273 mm length; its 2K maps downscaled to 1024 px WebP (512 px for grips, magazine, cartridges and small parts), roughness and metalness packed into one texture, the author's baked bevel maps used as normal maps.

shovel.glb, sledge.glb, hammer.glb (tools/arms/tools.mjs): Poly Haven 1k glTF downloads repacked as GLB with WebP textures, unchanged otherwise.

r22.glb (tools/arms/r22.mjs): no CC0 or CC-BY 10/22 could be downloaded without an account (the CC-BY ones on Sketchfab need a login), so it is built from the 10/22 Carbine's published measures: stock, barrel, receiver, band, sights, trigger guard, rotary magazine and bolt handle (the last two separate nodes, for the reload). The wood texture is restained walnut brown.
