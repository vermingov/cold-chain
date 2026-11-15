# Porting Cold Chain to Bevy

The user's decision (2026-11-15): the whole game moves from Babylon.js + Havok (TypeScript, in the browser) to Bevy
(Rust, native). Nothing new is added during the port (dev/BACKLOG.md waits until it is done and the user says go):
the Bevy game must do what the TypeScript one does, as well or better, and look at least as good.

The TypeScript game stays in the tree (src/, play.html) as the reference until the port has caught up; the Rust game
is game/. Branch: bevy-port.

## Stack
- Bevy 0.20 (Rust 1.97.1+), its PBR renderer (wgpu: Vulkan, DX12, Metal; WebGPU later if the user wants the web build).
- Physics: bevy_rapier3d 0.37 (Rapier). Ragdolls are Rapier multibody or impulse joints with per-axis limits and motors
  (stiffness, damping, max force), the same model as the Havok 6DoF springs in ragdoll.ts/motor.ts. Fixed 120 Hz steps.
- Audio: spatial sound with distance, reverb send and wall muffling as in src/sound.ts. HRTF if a maintained crate does
  it; otherwise say so and keep the panning.
- No new art: the same assets/ (people and anatomy .bin, weapon/prop models, surfaces, sounds), read by Rust loaders.
  The .bin formats are the TS loaders' (src/person.ts, src/models.ts, src/sandbox/anatomy.ts): port the readers.

## Setting up a machine (Linux, as the cloud container)
    rustup update stable                      # Bevy 0.20 needs Rust 1.97.1 or newer
    apt-get install -y mesa-vulkan-drivers xvfb pkg-config libasound2-dev libudev-dev libwayland-dev \
        libxkbcommon-dev libxkbcommon-x11-0 libxcursor1 libxrandr2 libxi6 libx11-xcb1
    export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json WGPU_BACKEND=vulkan   # software Vulkan, no GPU here
The first build takes about 9 minutes on 4 cores and 2.2 GB of target/; after that a run is seconds. Checked
2026-11-15: a lit, shadowed scene with a Rapier body renders under xvfb on lavapipe and screenshots to PNG.

## How it is checked
There is no browser rig any more. The game runs with a virtual display (Xvfb) and Mesa's software Vulkan (lavapipe):
  `xvfb-run -a -s "-screen 0 1280x720x24" cargo run -- --scenario <name> --out <dir>`
A scenario is Rust code in game/src/scenario.rs: it sets things up, steps the game a fixed number of frames with a fixed
dt (deterministic: seeded random), does what a player would (shoot X at Y, cut, drag), takes screenshots and writes a
JSON log of what happened (injuries, vitals, sounds played, timings). Every port job adds scenarios that match what the
TS game did and compares: same injuries for the same shot, same look in screenshots, same sounds.

## Layout (game/src)
One module per TS file where it makes sense, the same names, so the reference is easy to find: ragdoll.rs, motor.rs,
behaviour.rs, vitals.rs, wounds.rs, anatomy.rs, bones.rs, shards.rs, dismember.rs, viscera.rs, wall.rs, marks.rs,
film.rs, runs.rs, soak.rs, floor.rs, blood.rs, bruise.rs, face.rs, eyes.rs, teeth.rs, throat.rs, dressing.rs, hider.rs,
muzzle.rs, weapons.rs, fist.rs, arm.rs, arsenal.rs, hud.rs, map.rs, player.rs, sound.rs, thuds.rs, profiler.rs,
graphics.rs, warm.rs (pipeline precompilation), person.rs/people.rs (loaders), scenario.rs.
A person is one entity with a `Person` component that owns the per-person parts (vitals, ragdoll handles, marks, ...),
and each module's systems run over all people, in the order sandbox.ts/npc.ts update them. Keep the logic a faithful
port of the TS (same numbers, same comments explaining why) unless Bevy gives a better way to do the same thing; the
browser workarounds (canvas painting and texture uploads by tiles, getImageData, willReadFrequently, Firefox notes)
are not ported: wounds, blood film and bruises are painted on the GPU (render-to-texture or compute) instead.

## Order of work
1. **Foundation** (one job, everything depends on it): the app, the scenario runner and its screenshots and log, the
   loaders (people with their skeletons and skins, anatomy, weapons, props, surfaces, sounds), the map, the player
   controller and camera, the lighting, shadows and picture (grade, bloom, grain, FXAA, F3 presets, adaptive scale),
   the HUD, four people standing in the hall, the arsenal board. Defines `Person` and the segment table every other
   job uses.
2. In parallel, each in its own git worktree sharing one CARGO_TARGET_DIR (game/target: the disk has a few GB free):
   - **Body**: ragdoll.rs, motor.rs, behaviour.rs (active ragdoll, poses), thuds.rs, skinning driven by the ragdoll.
   - **Medicine**: vitals.rs, wounds.rs (pierce, blow), anatomy.rs tracing, bones.rs (the logic), throat.rs,
     dressing.rs's logic, the person's surface/hit tests.
   - **Hands and ears**: weapons.rs, arsenal.rs, muzzle.rs, fist.rs, arm.rs (first person), sound.rs, profiler.rs.
3. In parallel, the look of hurt: marks/film/runs/bruise (GPU painting), blood/floor/soak, dismember/shards/viscera/wall
   (mesh cutting), face/eyes/teeth/hider/dressing's look.
4. Parity pass against the TS game scenario by scenario, performance (the F2 profiler's numbers), a release build for
   the user's machines (Linux and Windows), then ask the user about dev/BACKLOG.md.
