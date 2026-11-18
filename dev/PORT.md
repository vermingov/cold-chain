# Porting Cold Chain to Bevy

The user's decision (2026-11-15): the whole game moves from Babylon.js + Havok (TypeScript, in the browser) to Bevy
(Rust, native). Nothing new is added during the port (dev/BACKLOG.md waits until it is done and the user says go):
the Bevy game must do what the TypeScript one does, as well or better, and look at least as good.

The Rust game is game/. Branch: bevy-port. The TypeScript game was the reference until the port caught up; it was
deleted from this branch on 2026-11-17 (src/, play.html, the Vite configs, package.json, server.js, vendor/, and the
browser checks tools/rig.mjs and tools/port-*.mjs that the notes below name). `git checkout 33de55b -- <path>` brings
any of it back; main, wip/0.8.19 and gh-pages still have the TS game.

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

## Performance (the user's word, 2026-11-15: optimise along the way where feasible)
The Babylon game lagged; every job fixes its own part of that as it ports, without changing how anything looks or
behaves, and measures it (scenario timings, the F2 profiler's rows). What the F2 logs and profiles found:
- A shotgun blast was 110-360 ms of JS: each bone break rebuilt its meshes and made new vertex buffers (bones `_draw`),
  `trace`/`surface` were recomputed for each of nine pellets though the body had not moved, every pellet hit built its
  own audio chain. One redraw per person per frame, buffers updated in place, per-blast caches, merged sounds.
- Painting wounds, film and bruises on the CPU and uploading them (170-220 ms stalls): on the GPU now.
- The X-ray insides were ~224 submeshes a person (1055 draw calls): merge by material.
- The first-person arms cost 29 ms a frame on a laptop (spikes to 394 ms).
- Shader compiles on first use froze frames (the first head shot): precompile every pipeline variant at load (warm.rs).
- Laptops were GPU-bound: keep the F3 presets and the adaptive scale honest; count draw calls by source in F2.
Allocate nothing per frame in hot paths; per-person work in parallel where Bevy's systems allow it.

## Order of work
1. **Foundation**: done (2026-11-15, commits on bevy-port up to "Bevy port, phase 1"). What it left and what the
   next jobs need to know is under "The foundation" below.
2. In parallel, each in its own git worktree sharing one CARGO_TARGET_DIR (game/target: the disk has a few GB free):
   - **Body**: ragdoll.rs, motor.rs, behaviour.rs (active ragdoll, poses), thuds.rs, skinning driven by the ragdoll.
   - **Medicine**: vitals.rs, wounds.rs (pierce, blow), anatomy.rs tracing, bones.rs (the logic), throat.rs,
     dressing.rs's logic, the person's surface/hit tests.
   - **Hands and ears**: weapons.rs, arsenal.rs, muzzle.rs, fist.rs, arm.rs (first person), sound.rs, profiler.rs.
3. In parallel, the look of hurt: marks/film/runs/bruise (GPU painting), blood/floor/soak, dismember/shards/viscera/wall
   (mesh cutting), face/eyes/teeth/hider/dressing's look.
4. Parity pass against the TS game scenario by scenario, performance (the F2 profiler's numbers), a release build for
   the user's machines (Linux and Windows), then ask the user about dev/BACKLOG.md.
   Last, once every scenario matches (the user's word, 2026-11-15): delete the Babylon game from this branch (src/,
   play.html, the Vite configs, package.json, node_modules, the browser-only tools such as tools/rig.mjs and the
   port-*.mjs checks). It stays on GitHub: main, wip/0.8.19 and gh-pages keep it, and the history has every file. Not
   before: until then it is the reference every port job reads and the game every check is compared against.

## The foundation (phase 1), for the jobs after it

### Running it
`cd game && cargo run` is the game; `cargo run -- --scenario <name> --out <dir> [--seed <n>]` a scenario. The assets
are found beside the executable (`assets/` next to it: a release package, an AppImage's usr/bin) or else as `../assets`
from the crate through CARGO_MANIFEST_DIR (main.rs ASSETS, `asset_file`), so a bare binary in target/ needs
CARGO_MANIFEST_DIR set to game/. The weapons' glTF needed one change to load
in Bevy (tools/gltf-fallback.py: a core `source` beside EXT_texture_webp, which Bevy does not read; Babylon is
unaffected); run it again if the forge rebuilds them. Bevy is built with its `jpeg` and `webp` features: changing
Bevy's features rebuilds most of it and leaves the old build in target/ (a few hundred MB each time).

### Space
Everything is in Bevy's space, right-handed, -Z ahead: main.rs `babylon(x, y, z)` brings a TS position over (z turned
round; north is -Z, a person's left is still -X), `babylon_quat` a TS quaternion. The readers convert as they read
(people, anatomy, props, face poses), so data from them is already Bevy's. map.rs and arsenal.rs keep the TS's numbers
and questions in its space and convert at their edges (every public function of map.rs takes and gives Bevy's
coordinates). A turn about an axis computed from geometry (cross products, `toward` checks) carries over by itself; a
turn about a fixed axis with nothing to check it against goes the other way (person.rs `calibrate`, the twists). The
player's `yaw` turns about +Y from looking along -Z, its `pitch` is up positive (the TS's were the other way round).
glTF loads unconverted: a glTF model as Babylon showed it is the file turned half round Y (weapons.rs `held`).

### A person (person.rs, ragdoll.rs, anatomy.rs, vitals.rs)
`sandbox.rs` lines up the four (`person::spawn`); each is one entity with `Person` (and `Vitals`), its Transform the
root (where they stand, which way they face). Under it: `frame` (what a pose moves as a whole, at the pelvis), the
mesh's own space, the bones as entities (`joints`, in the body file's order, which is parents first; with the mid bones
of with_mid_bones in), each drawn part a skinned mesh on them (`parts`: part index in `body.parts`, entity; the skin
under the clothes is not drawn yet, hider.rs's job), and the x-ray (`insides`, hidden; X shows it).
- `Person::body` is the body as read (`Arc<Body>`: bones with rest heads and tails, parts, corners, weights, face pose
  units), shared by everyone of that body.
- Posing: `person.apply(&pose, Some(person::FEET))` gives a `Posed` (each bone's turn in its parent's frame, and the
  frame); put it in `person.posed` (and the pose in `person.pose`) and `pose_people` writes it to the bones' Transforms
  that frame. poses.rs has RELAXED and stand(); a pose is a list of (control, degrees) in order, as the TS's object was.
  Not ported yet: the head and eyes looking at something (`_lookAt`, behaviour's), blinks and the smile (`_face`),
  lying down on the skin (`ground: 'skin'`).
- `person.joint(&root_transform, "head", false)` is a joint's world position as posed (worked out from the pose, not
  read back from Bevy's transforms, which lag a frame).
- The segment table: `ragdoll::table()` (the TS's SEGMENTS: name, lead bone, share of the weight, shape kind, the joint
  to its parent with its ranges, controls and muscle), and `person.segments`, each fitted to this person's flesh and
  clothes as ragdoll.ts fits them: `bone` (index), `mass` (kg), `group` (Trunk/Root/Limb collision kinds), `parent`,
  `joint`, `head`/`end`/`centre`/`radius`, `shape` (Capsule a, b, r / Cuboid centre, half, rotation / Ball centre, r, in
  the segment's frame: origin at its bone's head, axes the body's at rest) and `rest`, the segment's world Transform
  as the person stands at spawn (where its rigid body goes). The people scenario writes every person's table to its
  log. No rigid bodies, joints or colliders yet: the people stand still and nothing collides with them.
- Culling: each part's bounds are Bevy's own, of the rest pose where the person stands. Once the ragdoll moves them,
  give the parts bounds that follow (or NoFrustumCulling), as sandbox.ts did with its per-person box.
- anatomy.rs reads the insides and owns the x-ray (one skinned mesh per look under `insides`); the tracing of a line
  through the parts (`trace`, the clusters) is not ported. `Insides::owner` is the bone a point of a part goes with.
- vitals.rs is the monitor's readings at their starting values only.

### What else is there
- map.rs: the hall (blocks, grid shader grid.wesl, stripes, numbers, lamps, one fixed Rapier body, collision group
  `map::WORLD`), and `Map` (resource): `ground`, `push`, `screened`, `covered`, `land`.
- Physics: Rapier in FixedUpdate at 120 Hz, one step a tick (`TimestepMode::Fixed`); the virtual clock is capped at a
  thirtieth of a second a frame. Things that push on bodies before each step (behaviour, the grab) go in FixedUpdate
  before `PhysicsSet::SyncBackend`.
- models.rs: the props (`Models`: manifest, `prepare`, `place`); surfaces.rs: the surfaces' maps, and every image's
  mipmaps (Bevy loads one level; a one-channel image is widened to four so roughness reads from green).
- weapons.rs: ARMS (key, name, kind, rounds only: the numbers each is used with are still in weapons.ts), `Weapons`
  (slots, bag, ammo), `WeaponModels` (the glTF handles, `held(key)`: the Transform that puts the grip at the hand's
  origin pointing along -Z, and `bounds`). dressing.rs: the bandage and medkit as built for the board and the hand.
- arsenal.rs: the board; `Arsenal::look(eye, ahead)` is the key of what is looked at within reach (by box, not mesh).
- sound.rs: `Sounds::takes`, each name's takes as AudioSource handles, from assets/sounds and assets/cries.
- picture.rs: Babylon's image processing as a pass of its own (picture.wesl: exposure 1.6, vignette, ACES fitted,
  gamma, contrast 1.12, grain), Bevy's bloom before it and FXAA after; Bevy's tonemapping off, its exposure at one and
  the lamps in Babylon's candela (`map::CANDELA` converts), the hemispheric fill as an environment map
  (`map::fill_light`), no default ambient. graphics.rs: F3 presets (kept in ~/.config/cold-chain/quality) and the
  adaptive scale; the 3D camera draws into an image (`Graphics::target`) shown under the HUD, so its size is the
  render scale. hud.rs: bevy_ui, IM Fell (assets/fonts).
- Not in the foundation: N (spawn) and K (clear) need the ragdoll; footstep sounds; the first-person arms and held
  weapon; the TS's ReflectionProbe (for wet things: blood's job); surfaces' mottled materials (nothing used them).
- Known differences from the TS picture: the lamps' glass discs show from below (in Babylon they faced up and were
  culled); the arsenal lamp lights the board as arsenal.ts meant (in Babylon the board's material took only four
  lights and barely showed it); the board's low lamp is left out (Bevy lights cannot pick what they light); the wall
  numbers are in IM Fell, not a bold sans; Bevy's bloom prefilter and blur are its own, tuned by eye.

### Scenarios (scenario.rs)
A scenario is a function returning `Vec<Step>`, named in `steps()`: `Step::Wait(frames)`, `Step::Do(Box<dyn
FnMut(&mut World)>)` (anything, with the whole world), `Step::Shot(name)` (the window as drawn that frame,
`<out>/<name>.png`); `view(name, x, z, toward, eye)` (TS coordinates) puts the player there, waits six frames and
takes a shot; `scenario::log(world, json!(...))` adds to `<out>/log.json`. Frames are a sixtieth of a second
(TimeUpdateStrategy), everything random comes from the seeded `Rng`, pipelines compile before the frame that needs them
(RenderPlugin synchronous_pipeline_compilation), and the steps begin once every material's textures are in and the
board is hung. Existing: `hall` (four views, the Medium and Low presets, the 40% render scale), `people` (each person
front, side and face, the segment table into the log, everyone in X-ray), `arsenal` (the board wide and close). The
TS game's matching shots: tools/port-views.mjs (the same views through tools/rig.mjs).

## Sound (sound.rs), for every job that makes a noise
The mixer is kira 0.12, used directly (Bevy's rodio audio has no filters, sends or effects; bevy_kira_audio's spatial
sound is a gain and a pan per instance). No maintained Rust crate does HRTF: a sound with a place is panned at equal
power between the ears (Web Audio's 'equalpower'), with the TS's distance (inverse, 1.5 m, rolloff 1.1), its wall
muffling (`map.screened`: lowpass to 1 kHz and 0.35 of the gain) and its room (kira's reverb, calibrated to the TS's
2.8 m critical distance by the `sound` scenario). Without a sound device nothing sounds and everything is still decided
and recorded; a scenario mixes into memory (`Tap`, `Meter`) so what would be heard can be measured.

    use crate::sound::{Sound, Play};
    fn my_system(mut sound: ResMut<Sound>, ...) {
        sound.play("bullet-flesh", Play::at(point));                       // a burst, from a place (Bevy's space)
        sound.play("thud", Play { gain: 0.6, rate: 1.1, at: Some(p), ..default() });
        let cry = sound.play("scream-hood", Play { follow: Some(head_bone_entity), ..default() });   // follows it
        cry.as_ref().map(|c| c.cut());                                     // cut off in 50 ms (knocked out, killed)
        sound.play("step-tarmac", Play { gain: 0.8, most: 0.4, ..default() });   // one strike (`hits`), no place
        let drag: Option<Stream> = sound.stream("drag", Some(at));         // keep it (a component, a Local)
        drag.drive(level, rate); drag.at(new_place);                      // every frame; dropped, it stops
    }
- `play` returns `Option<Playing>` (None: no such recording; nothing is made up). `Playing::voice()` gives what is
  playing (`data`: the take's samples, `from`, `length`, `rate`, `start` on `Sound::now()`'s clock): a face mouthing
  its voice. `sound.has(name)`.
- The same take asked for again in the same frame within a metre of any already asked is merged into it (as loud as
  both by power): a shotgun's pellets into one body are one sound. (The TS merged only with the first; a grenade's
  fragments into four people then made 123 sounds at once, now 8.) A `follow` or `most` sound never merges.
- What was played and how (distance gain, wall, cutoff, pan, merged count) is pushed to `sound.heard` (Heard), which a
  scenario may drain into its log.
- Takes are the manifests' (assets/sounds, assets/cries); the room is 'cold' and the room tone 'room-sandbox' is driven
  at 0.35 from the start, as sandbox.ts did. Footsteps (player.ts onStep) are sound.rs's `steps`.
- The device (port/sound-menu, after a play-tester heard the sound "extremely laggy" with the frame rate fine): sound.rs
  opens it itself (`Device`, a kira Backend on cpal 0.18) instead of kira's DefaultBackend. kira's asked cpal for its
  default buffer; on Linux that is what ALSA's "default" device picks unasked, the longest buffer with the shortest
  periods that fill it (alsa-lib's snd_pcm_hw_params_choose), which cpal 0.18.2 then cuts to two of those periods: 512
  frames a period through PipeWire's ALSA plugin (two periods, 21 ms), three through PulseAudio's (its least, 32 ms), a
  dmix's own (often 1024), a card's own; plus what the sound server keeps. kira also opened the "default" device again
  every half second to look for a new one. Now 256 frames a period are asked for (two periods: about 11 ms at 48 kHz),
  1024 if refused, the device's default if that is refused too; `--audio-buffer <frames>` asks for another. Once it has
  run 1.5 s the log says what it got: `sound: <device>, 48000 Hz, 2 channels: 256 frames a period (5.3 ms; 256 asked
  for); the device plays N ms ahead of each period, so a sound is heard about M ms after it is started` (N is cpal's
  playback time less the callback's: what the device and server hold). Three underruns in ten seconds of play reopen it
  with twice the buffer (to 2048, not if the size was the player's); once a minute the log has how long sounds waited
  to reach the mixer (asked for during the frame, handed over at its end in `listen`: under a frame). Not measured on a
  sound device: the cloud machine has none. Bevy's own audio (rodio) is off: it held a second, silent stream open on
  the same device.
- Volumes: everything is under one track (`all`: the master volume, paused with the Escape menu); people's voices
  (`Play::voice`: the cries, coughs and retches from the head) hang under `voice` and go into the room through
  `ring_voice`, everything else under `direct`, `dry`, `ring_far` and `ring_dry`: `Sound::volume` (master, effects,
  voices; the menu's sliders, squared as gains). A place's track is made with its gain, cutoff and pan as they are.
- At most two people's groans, sobs or gasps are voiced at once (`hurts`, AT_ONCE); a cry at a new hurt always is.

## The hands (weapons.rs, muzzle.rs, arm.rs, hands.rs, fist.rs, profiler.rs), for the jobs that plug into them
- Everything a weapon does to a person goes through two functions in weapons.rs, `pierce(cx, who, origin, dir, &Missile,
  far)` and `blow(cx, who, point, dir, mass, speed, Option<Tool>)`, which call wounds.rs's (through `Cx::npc`, the
  borrow npc::with makes, inside the weapons' own systems) and write what was hit into `Weapons::log` (the `arsenal-use`
  scenario's log). The fists' blow is the same call in fist.rs `punch`. What it meets is `weapons::surface` (npc.surface,
  the first skin or clothes). A cut's crossings are logged as "slash" when the swing ends (npc.slash's drawing is phase 3).
- The bandage and medkit: weapons.rs `medic` (the TS's Medic: aim, hold, its sounds and the hands' motion) on
  dressing.rs `wounds` and `dress`.
- What medicine wants heard (`Happened::Say`, `Cut`, `Sound`) is played by sound.rs `hurts`: a cry follows the head bone.
- Where people are, for the cheap tests before npc.surface: `Cx::ends(who, person, k)` (the ragdoll's segment ends) and
  `Cx::centre`. Taking hold of a person inserts behaviour.rs `Grabbed` (aimed every frame, removed to let go); a thing
  is held by weapons.rs's own spring (`pull`). The grenade's blast pushes every segment (`Ragdoll::push`) and knocks
  down whoever is within 3.5 m; a thrown thing or the grenade touching a segment (Rapier's contacts) lands a blow
  (`landings`); a `thuds::Slam` is a blow ('wall'). The body's `thuds::Heard` and `thuds::Dragging` are played by
  sound.rs `bodies`.
- `// port: needs blood`: what a bloody blade sheds (weapons.ts `_shed`, blood.spray). The blade's blood (`Weapons::blades`) and its stain are here.
- Input goes through `Weapons::queue` (`Act::Press(0|2)`, `Release`, `Select(i)`, `Reload`, `Take`, `PutBack`), which a
  scenario can push to as the mouse and keys do.
- The arms are the sexton's arm (People's body with its mid bones), posed by `Arm::reach` (arm.ts), put on the grips
  each frame by hands.rs from `weapons::Holds`; the fists pose them themselves.
- Not ported: the TS drew the held thing and the arms in a rendering group of their own over the room (depth cleared),
  so a gun held out at a wall did not go into it; here they are drawn in the room. A shot still never starts beyond a
  wall (`before_wall`). The AK's magazine and the shotgun's barrels are not cut out of their meshes (weapons.ts
  `split`), so they stay put through a reload.
- Known difference, on purpose: fist.ts mirrors the left fist's place twice (`at` is kept mirrored, and `knuckles()`
  and `_pose` mirror it again), so in the TS both fists sit right of the middle and the left one punches from there.
  fist.rs mirrors it once: each fist on its own side. Say if the TS's way is wanted.
- Measured (the `sound` scenario, mixed into memory): a shot 2.8 m off is as loud in the room as itself (-28.0 dB each);
  the room rings about 1.2 s to -60 dB (Freeverb at the 'cold' room's 1.1 s, the shot's own tail in the figure); behind
  the cover wall a shot is cut to 0.35 and 1 kHz on its way to the ears, and the total falls only 0.6 dB, as in the TS,
  the room's ring being unmuffled; nine 'bullet-flesh' asked for in one frame within a metre are one sound at gain 3.
- Measured (`arsenal-use`, dev build, software Vulkan, a shared 4-core machine): a nine-pellet blast into a person 1.7
  to 4.6 ms (the TS: 110 to 360 ms; medicine's npc.surface is cached for the frame, so the nine reuse it); the arms
  (hands.rs `put`) 0.02 to 0.09 ms a frame, the fists 0.06, the hand's pose under 0.05 (worst single frames 3 to 6 ms
  with other jobs building beside it; the TS's arms were 29 ms on a laptop). Casings are 40 rigid bodies a cartridge,
  reused; bullet holes 600 entities on one mesh and material (Bevy batches them), reused. `ARSENAL_USE=grenade,shotgun`
  runs the scenario with only those.
- Profiler (F2): `profiler::timed("row name", system)` in place of a system gives it a row of its own; every main
  schedule has a row for the rest of its systems, and the render world one for its own thread; under them the draw calls by pass (the render world's phases: opaque, alpha
  masked, blended, shadow maps) and the meshes in view by what they belong to. `Notes::note(now, what)`
  is the TS's `world.note`. F4 saves `coldchain-profile-<version>-<time>.json` in the TS's format, and so does quitting;
  `node tools/profile-report.mjs` reads it. Where it goes, `--profile`, and what else it keeps: "Performance and
  release builds" below.
## Medicine (phase 2, branch port/medicine)

vitals.rs, wounds.rs, anatomy.rs (tracing), npc.rs, bones.rs, teeth.rs, throat.rs, eyes.rs, bruise.rs and dressing.rs's
second half are the TS's logic, number for number: the same shot gives the same injuries, bleeds and vital signs (checked
below). What they draw, play or move is not done here: it is handed over (`Happened`, below).

### A person's medicine
Each person gets `npc::Hurt` (bones, teeth, throat, eyes, bruising, dressings, the voice, which vessels are cut) beside
their `vitals::Vitals`, the frame after they are made (npc.rs `fit`; sandbox.rs is untouched). Everything medical works
through `npc::Npc`, a borrow of the person (`&Person`, the root's Transform, `&mut Vitals`, `&mut Hurt`, the body's
traced insides, the `Dice`) for one shot, blow or frame:

    npc::with(world, entity, |npc| wounds::pierce(npc, origin, dir, &missile, far))   // from anything with the World

`npc::update` runs every person's insides once a frame (Update): the vitals, the throat, the eyes, the bruising, the
dressings, the blood out of each wound, the voice, the bones (the TS's npc.update order, less what is phase 2's).

### For the hands (weapons.rs): shots, stabs, cuts, blows, dressings
- `wounds::pierce(npc, origin, dir, &Missile, far) -> Pierced { stopped, at, energy, hit, enter }`: the TS's pierce.
  `Missile` has the TS's fields (`energy`, `mass`, `calibre`, `channel`, `soft`, `hard`, and the optional `reach`, `blade`,
  `slash`, `name`, `speed`, `across`, `edges`, `taper`, `pellets`), `..default()` for the rest. weapons.ts `_shot` carries
  on with `res.energy` from `res.at` as before. A slash's cut along the crossings is npc.slash's (phase 3: marks).
- `wounds::blow(npc, point, dir, mass, speed, tool: Option<Tool>)`: `Tool::Named("fist" | "bat" | "flat" | "edge" |
  "hammer" | "wall")` or `Tool::Stiff(N/m)`; None as the TS's undefined.
- `npc.surface(origin, dir, far, eyes) -> Vec<Crossing>`: the skin and clothes a line crosses, in order (the weapons' `_meets`
  and `_person` tests can use it; it is cached a frame).
- `dressing::wounds(npc) -> Vec<OpenWound>` (worst first) and `dressing::dress(npc, &wound) -> Option<usize>`: what the
  TS's Medic did when the button had been held for `dressing::SECONDS` (the bandage on the wound looked at, within
  `dressing::REACH`; the medkit on `wounds(npc)[0]` again and again). The Medic itself (prompt, timing, sounds) is yours.
- Randomness: `vitals::Dice` (a resource), the generator the check puts in Math.random's place.

### For the body (ragdoll.rs, behaviour.rs): "port: needs body" in the code
- `Npc::bone_worlds` and `Npc::segment_world` work the bones and segments out from `person.posed`; when the ragdoll moves
  them, write each segment's Transform into `Hurt::segments` each step (and keep `posed` the skeleton as drawn), and
  medicine follows. The TS's ragdoll drives the neck from the head's segment, spread over neck01..head: the check does this
  by hand (scenario.rs `wounds`).
- Take from `Hurt::happened`: `Hit { point, impulse, jolt }` (behaviour.hit), `Joint { segment, change }` (`Range`, `Widen`,
  `Hold` where it is, `Out` dislocated, `Shorten` a broken shaft's halves sliding, `Limp`), `Broke { segment }` (breakAt:
  the mid joint let go). Read `Hurt::leg_gone`, `Vitals::paralysed_*`, `Throat::retch`, `Bones::jaw_hangs`.
- Call `npc.bones().fell(seg, was_vy, now_vy, low, under, held, pelvis_vy, chest_vy, pelvis_y)` after each step for each
  segment (the TS's `_falls`: breaks from landing) and `npc.bones().opens(|segment| bend_degrees)` (open fractures).
  Joint angles for `at_joint` are taken as the pose's (straight): give it the ragdoll's.

### For phase 3 (the look of hurt)
Everything to draw is in `Hurt::happened`, each variant named after the TS call it replaces: `Wound`, `Hole`, `Stab`,
`Tear` (a bullet's way out, its splits already worked out with the TS's dice), `Welling`, `Spatter`, `Runs`, `Soak`,
`Spray`, `Stream`, `Blot`, `Drawn` / `Through` (a break to draw: bones.rs `Break` has where and how), `Tooth`, `Tongue`,
`Edge` / `Charge` / `Bled` (dismember and viscera). `Say`, `Cut` and `Sound` are the voice and the sounds. The bruise field
(`Bruise`: per welded skin place, `ery`, `blood`, `age`, `h` the swelling out) and the eyes' state (`Eye`: marks,
patches, blood, collapse) are kept as the TS kept them for its shaders. Each list is there for the frame it was made in (cleared in First): read it any time after Update.

### The check
`cargo run -- --scenario wounds --out <dir>` fires fifteen shots and blows (rifle, pistol, shotgun pellets, a knife stab,
bat blows; chest, belly, neck, head, mouth, eye, thigh, shin, ribs; two then dressed) at bone-relative points of the
standing people, on a person made whole again each time, with the TS people's breathing clocks, and logs a minute of
vitals. tools/port-wounds.mjs fires the same in the TS game (dev server, rig; Math.random seeded as `Dice`, drawing
stubbed, no physics stepped); tools/port-wounds-compare.py compares the two logs.

## The body (phase 2, branch port/body)

ragdoll.rs (the bodies), motor.rs, behaviour.rs, thuds.rs and poses.rs's helpers are the TS's, number for number, with
the reasons in the comments; where Rapier needed something else, the comment says what and why.

### A person's body
Every person made (`person::spawn`) is given, before the next physics step (behaviour.rs `make`, PreUpdate):
- `ragdoll::Ragdoll`: `segs[k]` in `person.segments`' order, each with `def` (the fitted `Segment`), `entity` (its
  Rapier body: a top-level entity, `RigidBody::Dynamic`, the segment's collider, its mass and inertia as ragdoll.ts gave
  them), and after every step `now` (its world Transform: its bone's head and turn), `vel`, `spin`, `was` (its velocity
  before the step). Joints: an `ImpulseJoint` on each segment's entity (the TS's per-axis ranges, the shoulder's 30-degree
  bend zero, ForceBased motors for the muscles), a second free joint beside it whose velocity motors are the tone (Havok's
  axis friction), and contact-less free joints between the halves of the long bones either side of an elbow or knee
  (`_apart`). Self-collision is everyone's segments against everyone's but jointed neighbours (collision groups TRUNK,
  ROOTS, LIMBS; the per-person bit for pieces cut off is dismember.rs's to add).
  Asking it: `by_name`, `world_point`, `middle`, `com`, `com_velocity`, `lowest`, `nearest(point)`, `outside`,
  `segment_ends`, `angles(k)` (the joint's angles from its neutral), `cut_off`, `loose`, `push(k, impulse, at)`,
  `set_tone`, `break_at`, `set_range`, `change` (medicine's `npc::Joint`), `entities()` (to despawn).
- `behaviour::Behaviour`: `state` (Stand, Fall, Down), `mode`, `will`, `strength`, `wound`, `felt` (the vitals as it read
  them this frame), `why` (why they last went over). `hit(rd, root, rng, seg, impulse, point, jolt)` is behaviour.hit;
  `knock_down(rng)` puts them off their feet.
- The skeleton follows the bodies: each frame `Ragdoll::drive` writes `person.posed` (the pelvis as the frame, every
  segment's turn on its lead bone, the spine's and the neck's spread over their bones, the bones between left straight,
  the fingers posed from the pose), so `person.joint`, medicine's `bone_worlds` and the drawn skeleton are the bodies'.
  Each drawn part has Bevy's `DynamicSkinnedMeshBounds` (its bounds kept from its bones; the x-ray's are not yet).

### Holding and dragging (for the hands)
`behaviour::Grabbed` on the person is weapons.ts's grab of a body: `Grabbed::at(&ragdoll, point, eye)` takes hold of the
segment nearest the point (insert it; they go down and writhe, `why` "grabbed"), `grabbed.aim(eye, ahead)` each frame is
`_hold` (drawn to in front of the eye, as far as it was taken from, at most 2.2 m), and the pull is weapons.ts `step`'s
spring as a joint (behaviour.rs `hold`: a fixed body, linear ForceBased motors, its anchor moved every physics step; a
part under 2 kg pulled as if it weighed 2 kg). Let go: remove the component; the joint goes the next step.

### Sounds and slams (thuds.rs)
`thuds::Heard { name, at, gain }` (a message): the takes a body makes (thuds, `body-fall` from behaviour) for sound.rs to
play; until it does, the scenarios log them. `thuds::Slam` is a segment slammed into something standing (wounds.rs's
`blow(.., 'wall')` to take), `thuds::Dragging` (a resource) the 'drag' stream's place and gain.

### Medicine
behaviour.rs writes `Hurt::segments` and calls `bones().fell` after every step (`landings`), and once a frame
(PostUpdate, `hurts`) takes `Hit`, `Joint` and `Broke` from `Hurt::happened` and calls `bones().opens` with the ragdoll's
bends. It reads the vitals, `Hurt::leg_gone`, the throat's `retch` and the breaks.

### Physics
120 Hz, one step a tick, as phase 1 set it. Rapier's solver is given sixteen passes and warm-started joints (ragdoll.rs
`solver`): at its defaults a standing body's knees sagged and its feet crept along the floor.
Rapier's joint motors read a turn about each axis as twice the arcsine of the quaternion's part along it, its limits as
twice the arctangent of that part over the real part: the same for a turn about one axis, far apart for a turn about two.
The ranges are in the motors' measure, and `Ragdoll::ranges` puts them into the limits' every physics step for the joint
as it is turned (only a change is sent, so a body at rest sleeps). A limit row pushes along its own axis in the parent's
frame, and on a joint bent far from its zero a twist and a side limit move each other tan(bend / 2) as much as
themselves: hinges (elbows, knees, wrists) are zeroed at the middle of their bend (`join`).

### Scenarios
`stand`, `fall`, `getup`, `crawl`, `drag`, `dead` (each logs a `timeline` of state and mode second by second, the
`jitter` of its situation as the TS's jitter.mjs measured it, and Rapier's time a step), `keys` (K and N), `joints` (every
joint's angles and aims, standing).

## Cut (phase 3, branch port/cut)

shards.rs (with bones.ts `_look` and `_drawAll`), dismember.rs, cutface.rs (its `paint`, `capMesh`, `capMaterial`),
viscera.rs, tubes.rs (viscera.ts `_tubeLook`), wall.rs, and anatomy.rs's per-person x-ray are the TS's, number for number,
with the reasons in the comments. flesh.rs is new: it does on the geometry what hider.ts did per pixel for a limb cut off.

### What drives it
- Medicine hands over `Happened::Drawn` and `Through` (shards.rs draws them), `Edge` (kept per limb until the swing is
  through), `Charge` (now with the skin crossing it went in at and its calibre: a limb torn off, or the belly blown open),
  `Bled` (blood on an organ). These are taken in PostUpdate; a scenario step runs in Last, after that, so it runs
  `dismember::taken_system` and `shards::redraw` itself (cut_scenario.rs `taken`).
- For the hands (wired in weapons.rs): `dismember::swung(world, who)` at the end of a swing (with `viscera::slashed(world,
  who, &skin_crossings, depth)`), `dismember::blast(world, who, at, tnt)` for the grenade, `viscera::pick(people, eye,
  ahead, far)` / `viscera::pull(&mut viscera, held, Some(to) | None)` for bowel taken hold of (Weapons::bowel). They run
  from `commands.queue` with the whole World. Also: `dismember::chop`, `charge`, `sever`, `limb_at`, `place`,
  `end_world`; `viscera::open`, `blown`, `burst`, `openings`, `opening_world`.
- What others draw: the stump's skin edge (`Skin::rim`) and an opening's lips (`Skin::lip`) are called on skin.rs's
  `Skin`; an opening is skin.rs's hider's (`skin_hole`, `cloth_hole`, `window`: the skin and clothes not drawn there, the
  body's inside wall seen through it), and a cut's window onto the skin under the clothes too. Blood: `Happened::Spray`
  from a fresh stump, and blood.rs's `Blood::run` (what was in a piece, out of its end) and `Blood::drip` (off bowel that
  came out) called directly; `Sound`.

### The person's flesh (flesh.rs)
The TS kept the triangles a cut runs through in both the body's mesh and the piece's and hid each side's other half per
pixel (hider.ts, eight cuts a person tested in every fragment). Here a person gets `Flesh` (their own weights, triangles,
cut planes) the first time a limb comes off, and each touched part (skin.rs's list: with the skin under the clothes) is
made again once into a mesh of their own: triangles cut along the plane, their new corners with the edge's picture,
normal and mixed weights. A part's own corners keep their order and the new ones come after them, because skin.wesl
reads each corner's bruising from the table by its place in the part. The same planes and radii as hider.ts, so what is
drawn is what it drew. So skin.rs's table row 4 (kept for the hider's cuts) is not used: nothing about a cut is asked per
pixel. The piece's meshes wear the part's own material (skin.rs's `Flesh`, or person.rs's StandardMaterial before skin.rs
has made it).

### A piece cut off
`Ragdoll::sever` (ragdoll.rs, new): the joint and its friction let go, `attached` and the mass without the piece, a dead
tone in it; its first segment meets nothing of any person until clear of its stump (`clear_pieces`; the TS's own bit of
each person's has no room in Rapier's 32 groups: `ragdoll::PIECE`). `Person::placed` (person.rs, new): bones put where
their own body is; `Person::absolute`, medicine's `bone_worlds` and `pose_people` honour it, so the piece is drawn, hit
and bled from where it lies. `Hurt::weights` (npc.rs, new): the body's corners' bones after a cut, for `skinned` and
`owner_of` (the TS's dismember owners).

### The x-ray (anatomy.rs)
One mesh a look for everyone of a body (23 draws a person), each person's own copy of a look only once something in it
changes: a part hurt goes into a twin in the hurt look (`Hurt::hurt`), triangles taken round a break (`Xray::hide`) are
left out, regrouped once a frame while seen (`regroup`). Every look's mesh has `DynamicSkinnedMeshBounds`.

### Breaks drawn (shards.rs)
Each `Drawn` break's region cut small and labelled (`region`, `split`), its pieces moved; all of a person's breaks drawn
into three meshes made once and filled in place (bone in the x-ray, bone out through the skin with its colour going red
at the break, the dark lines), once a frame at most however many breaks a blast made.

### Bevy notes
- Bevy 0.20's `compute_smooth_normals` weighs a corner only when its two sides' squared lengths multiplied pass f32's
  epsilon: on a cut face or a loop of bowel every normal came out zero and drew black. flesh.rs `normals` (Babylon's).
- Cut faces are painted off the frame (AsyncComputeTaskPool): the ends go in at once flat and plain, painted a frame or
  two later (`Painting`).
- Organs and ropes are one extended material (organs.wesl, viscera.rs `Wet`): a corner's colour is its place at rest and
  its alpha the blood on it. The wall's layers (wall.wesl) are a uniform of five vec4 a column.
- Rope meshes are in the world (their points are), so `gone` despawns them when the person goes.

### The check
`cargo run -- --scenario cut --out <dir>` (or `cut-limbs`, `cut-belly`, `cut-bones`): a sword's chop through a forearm
(one blow), a thigh (three), the neck (two); a shotgun charge at contact range into a belly; a knife drawn across a belly;
a shin broken by a bat and bent out through the skin; a skull broken; X on; a grenade at a headless man's feet. Close shots
lit by a lamp by the eye. tools/port-cut.mjs does the same in the TS game (same calls, same views).
## Blood (phase 3, branch port/blood)

blood.rs (drops, streams, marks on the room), floor.rs (the floor's pools), soak.rs (the clothes' stains) and fluid.rs
(blood's numbers; fluid.wesl its colour, `blood_over`, and the noises the TS's shaders used) are the TS's blood.ts,
floor.ts, soak.ts and fluid.ts, number for number. The floor's flow and the clothes' wicking run on the GPU as compute
shaders (floor.wesl, soak.wesl) on buffers the materials' textures are written from; the CPU keeps only what it must ask
(a copy of the floor's depths and each person's cloth, brought back a few times a second by Bevy's readback).

### What it takes from medicine
`blood::take` (First, before `npc::forget`, so blood from anything pushed during the last frame, a scenario's `Do` step
included, is taken): `Spray`, `Stream` (keyed by person and bleed, each bleed keeping its own aim off the skin's normal,
npc.ts `_aims`; throat.rs's vomit is `bleed: None`), `Soak` (into soak.rs), `Spatter` (npc.ts `spatter`, ported here).
Not taken here: `Welling`, `Runs`, `Blot` (skin's: film.rs, runs.rs), `Bled`, `Edge`, `Charge` (cut's).

### With the skin (skin.rs, film.rs, runs.rs)
- Drops that land on bare skin are pushed onto the person's `Hurt::happened` as medicine's own `Blot { hit, r, wet }` and
  (over 0.008 ml) `Runs { hit, ml, from: None }`, in Update (`blood::Bleeding`); skin.rs draws them in PostUpdate as it
  draws medicine's. Bodies lying in blood push `Blot` the same way. Drops on clothes go into soak.rs.
- runs.rs's messages are taken in Update: `runs::Drip` (a drop let go from the skin: blood.rs flies it), `runs::Pooled`
  (into the floor) and `runs::Soaked` (into the person's `soak::Soak`). runs.rs draws its own beads.
- The clothes' soak is drawn by skin.rs's material: `Wounded` has `soak` (binding 107, the person's 3D field; sampler 108),
  `soak_at` (109, the field's corner at rest) and `soak_scale` (110, one over its size), a dry 1-texel field
  (`soak::DRY`) until soak.rs `wire` gives a person's clothes their own; skin.wesl's CLOTH branch calls fluid.wesl
  `stained` after the scorch (three lines).
- The `Blood` resource for anyone else: `blood.drip(at, ml, fluid::across(ml))`, `blood.run(at, litres_per_s, dt)` (a flow
  with nowhere to go: gathers into drips, or into the floor below 4 cm), `blood.fill(at, litres)`, `blood.spray(..)`;
  `soak.add(rest, ml) -> bool`, `soak.fullness(rest)` on the person's `Soak`.

### For cut (dismember.rs, viscera.rs)
dismember.ts sprayed from a fresh stump (`blood.spray`) and ran from a stump's end (`blood.run`); viscera.ts dripped
(`blood.drip`): the same calls on the `Blood` resource. Rapier bodies are not used: the drops are blood.rs's own.

### On the GPU
(The shaders: floor.wesl, puddle.wesl, soak.wesl, stain.wesl, fluid.wesl; the clothes' look is in skin.wesl.)
- The floor (floor.rs, floor.wesl): the TS's 12.5 mm grid over the whole hall, kept only for the 32-by-32-cell tiles
  blood has reached (woken where it lands, round it, and where the flow asks: the `want` flags), at most 1024 of them, in
  buffers by tile: depth, age, the floor's own lie (made on the CPU when a tile wakes, the TS's noise in f64), and what each
  cell gives its four neighbours. A frame's blood onto and off the floor is one pass (`apply`, one invocation, the ops in
  order); a step (every 1/30 s, at most one a frame, as the TS) is `flow` (what each cell gives), `gather` (what each takes,
  so the order of the cells does not show, as the TS's change-then-settle) and `settle` (ages taken, the display written).
  The material reads only the display (rgba8: the depth's square root, the wetness), exactly as the TS's puddleMap.
- The clothes (soak.rs, soak.wesl): each body's grid of 8 mm cubes of cloth as the TS made it (cubes with cloth only, six
  neighbours each, the empty cubes round the cloth copying their neighbour), once a body; per person the blood in each
  cube, its age, what has gathered to drip. `apply` (the frame's blood in and out), then each step (1/8 s) `flow`, `gather`
  and `encode` (the 3D field the cloth material reads) over every cube of cloth. The TS's 1200-cubes-a-step budget and its
  sleeping cubes were a CPU budget: every cube is worked out every step here, so a great soaking spreads as fast as the
  TS's small ones did. Drops gathered at hems come back by readback each step and fall from where that cube is now.
- The CPU's copies: the floor's depths and ages every 0.2 s (only the awake tiles), each wet person's cloth every 0.5 s.
  Between copies the CPU keeps what it added and took itself.

### The check
`cargo run -- --scenario blood --out <dir>`: the second person knocked out and down on his back, then at once a knife
nicking the old man's right femoral artery as he stands, a pistol shot down through the groundskeeper's neck, nine shotgun
pellets into the young man's chest, a knife into the hooded man's belly and 40 ml put in his left airways to cough up; each
seen at 0, 2, 10, 30 and 120 s (views half a second apart; drawn small between pictures, which on lavapipe is most of a
run). The log has, at each time, the drops and streams in the air, the floor's awake tiles, each person's blood lost and
in their clothes, and what blood cost: CPU per system (`take`, `update`, `soak`, `draw`, `floor`) and the GPU's floor and
clothes passes (Bevy's render diagnostics, timestamp queries; on lavapipe these are CPU time). tools/port-blood.mjs does
the same in the TS game (people picked by body; its world.npcs order is not the line-up's) and writes the same views.

### Not done, and why
- Drops are drawn without the hall reflected (plain StandardMaterial): beads a few millimetres across; the pools and marks
  carry it.
- The reflection is rendered once, when the hall is loaded, with whatever stands in it then left out (people are not on
  its layer), as the TS's REFRESHRATE_RENDER_ONCE.

### Runs of the check
The full run (0 to 120 s, every number below) was before the hands and the skin were merged: the femoral nick then
nicked the artery as the TS's did. After both merged, the check aims the knife at the artery itself (the body settles a
few millimetres differently from run to run, and the bone-relative point missed it once), which severs it: 1.16 L lost
by 30 s against the nick's 0.57. That run reached 30 s (the machine's memory limit stopped it, shared with three other
games): the soak drawn through skin.rs's material, the cough's blood on the chin by runs.rs, the stream's arc and the pool.

### Measured (2026-11-16, the check on lavapipe, a debug build with the game's crate at opt-level 1, four people bleeding)
- Against the TS (tools/port-blood.mjs, same wounds): blood in the clothes at 2/10/30/120 s, old man 20/102/288/616 ml
  (TS 21/102/252/1022), young man 10/30/41/75 (TS 10/27/41/86), hooded man 0.5/2.3/5.9/14 (TS 0.5/2.3/6/14); blood lost
  the same to the millilitre (medicine's). The old man's trousers hold less at 2 minutes and drip more onto the floor: the
  TS worked out at most 1200 cubes a step and its great soakings spread and drained slower than its own numbers say.
- CPU a frame: taking medicine's blood 0.02-0.03 ms, drops/streams/landing/lying 0.1-0.7 ms (most of it finding the
  skin a drop met: npc.rs `nearest_rest`, at most 16 a frame), the clothes' bookkeeping under 0.01 ms, drawing 0.02-0.05 ms,
  the floor's under 0.01 ms.
- GPU (timestamp queries; lavapipe runs them on the CPU, so these are upper bounds, not a graphics card's): the floor's
  passes 0.7-2.3 ms with 15-29 tiles awake; the clothes' 0.1-0.3 ms a frame with ops only, 28 ms in a frame whose step
  wrote all four people's fields (700,000 invocations; since then only cloth blood has reached is written).

## Skin (phase 3, branch port/skin)

What hurt looks like on the skin and clothes: marks.rs, film.rs, runs.rs, hider.rs, bruise.rs's drawing half,
dressing.rs's look, and skin.rs, which owns the person's materials and the passes that paint them (skin.wesl,
paint.wesl). Driven only by medicine's `Hurt::happened`.

### A person's look
skin.rs `clothe` gives everyone with a `Hurt` a `skin::Skin` (and a `runs::Runs`): their skin, the skin under their
clothes (person.rs leaves it out; it is put in here, drawn only through holes), clothes, hair and brows get materials of
their own, `skin::Flesh` (StandardMaterial with skin.wesl over it; `Wounded::info` says which kind of part it is: SKIN,
UNDER, CLOTH, CARRIED, GAUZE), which read three textures of that person's:
- `wounds` (2048², RGBA8): red how deep the flesh is open (to 4 cm), green the blood in it (blades' wounds and cut
  edges: marks.rs paints it; skin.wesl draws it as marks.ts's Gore did: cut edge, fat lobules, sheath, muscle, blood in
  the bottom, the normal bent down the walls); alpha the number of the gunshot wound whose patch it is (below).
- `film` (2048², RG16F): red the blood lying on the skin (to 0.6 mm), green how wet. film.rs and runs.rs paint it;
  skin.wesl draws fluid.ts's bloodOver (absorption per mm, fresh and dried) and, while wet, a clear wet layer over the
  skin (Bevy's clearcoat with the film's own normal, so its edges catch the light).
- `state` (1024 wide, RGBA32F, nearest): a table. Row 0 the clock, the recent blows' shapes (bruise.ts records) and the
  counts; row 1 the holes and slits in the clothes, row 2 the openings torn in the skin, row 3 the windows through the
  clothes (hider.rs, rest space); row 4 port/cut's; row 5 the gunshot wounds (marks.rs `SHOTS`); rows 8 on three texels per corner of the body (bruise tint, shift, tilt) and past the
  body's corners the dressings' rider slots. bruise.rs's changes are copied in each frame (`Bruise::changed`); only the
  rows that changed are written to the card.

### The passes (GPU, render world)
Nothing is painted on the CPU and nothing is uploaded by tiles (the TS's 170-220 ms stalls). A frame's marks are stamps
(skin.rs `Stamp`: a capsule, a blade's lens, an uneven blot; paint.wesl
draws each shape in its fragment shader). In the RenderGraph's Begin set, before the cameras: for each person with
anything this frame, one instanced draw into `wounds` and one into `film`, all of that frame's stamps, blended by Max
(the canvas's 'lighten'); the film dried by a full-sheet pass that scales its wetness (blend constant), every 8 s while
anything on it is drying (20 minutes after the last blood); the table's changed rows written with `write_texture`. The
stamp buffer and all the lists are reused; nothing is allocated per frame once they have grown. `SKIN_TIMES=1` adds
Bevy's render diagnostics and times the painting (`render/skin_paint/elapsed_gpu`).

### What draws what (from `Happened`)
`Wound` (skin: a gunshot record, below; cloth: a frayed hole and a window onto the skin under it), `Hole` (whether the
way in has a scraped ring; none before a `Wound` in: a way in again), `Spatter` (which way the bullet went in and from how
far: the oval, the ring's wide side, soot and powder), `Stab` (the blade's slit; the clothes slit, a window), `Tear`
(the way out's splits, into its record), `Welling`
(a blot and a run), `Runs` (runs.rs, or into the clothes), `Blot`, `Slit` (new: a stretch of a blade's cut, from
`Npc::slash` in marks.rs, which weapons.rs calls with the crossings, as npc.ts slash; and skin split by a blow).
Not drawn here: `Spatter`'s blood, `Spray`, `Stream`, `Soak` (blood.rs, soak.rs: port/blood), `Edge`, `Charge`, `Bled`,
`Drawn`, `Through`, `Tooth`, `Tongue` (port/cut and the face).

### Gunshot wounds (port/wound, 2026-11-16)
The TS painted a bullet's way out as a red star of capsules on the depth sheet, and its way in as a radial gradient: flat
paint, and at the sheet's two texels to a millimetre (one on a thigh) a 5 mm hole and its 1 mm ring were a smudge. The
user: "Why the fuck are they stars". Now each way in and out is a record in the table's row 5 (marks.rs `entry`, `aimed`,
`exit`: six texels each, 170 a person; where it is at rest, its axes, its kind (in, out, in again, a shotgun's charge),
its seed, the record it overlaps, its sizes from wounds.rs (`exit_size`, `tear`'s splits, the calibre), which way the
bullet came and from how far, when it was made), and its number is stamped into the wound sheet's alpha over the patch
it reaches. skin.wesl `gunshot`, where that alpha is set, reads the number exactly (textureLoad), and draws the wound
from its record in millimetres at any distance: a height field (the hole and its walls, the edge turned in at a way in,
the lips turned out at a way out, fat bulging between them, the track) that the eye's ray is followed into (48 steps and
7 halvings, in the skin's rest space through the skinning's matrix, passed from the vertex shader), so the near wall hides
the far one and the light falls down them; what it meets coloured as what is there (scraped ring, cut dermis, fat,
muscle, blood standing level in it and welling up over the first half minute, glossy, dulling over a quarter of an
hour; soot and powder tattooing round a close shot), the normal from the field, Bevy's clearcoat for the wet. The
film's blood is kept off the hole's inside. A way out is no longer cut through the skin (hider's row 2): the tear is
looked into, not through. What each look is from: dev/research/wounds.md, end. The check: `--scenario gunshot`
(skin.rs `gunshot`; `GUNSHOT=pistol_face,...`, `GUNSHOT_AT=macro,close,far`, `GUNSHOT_BLANK=1`).

### For the others
- port/blood: runs.rs sends `runs::Drip { at, ml }` (a drop let go from the skin), `runs::Pooled { at, ml }` (reached the
  floor) and `runs::Soaked { person, rest, ml }` (into the clothes); blood landing on a person goes onto their skin with
  `Skin::blot` and `Runs::start` (the TS's blood.ts did film.blot and runs.start). Cloth soak shading belongs in
  skin.wesl's CLOTH branch: ask for a binding (a 3D texture) on `Wounded` rather than adding a material.
- port/cut: `Skin::rim` (marks.rim) is there for dismember's cut edges; the hider's cuts (a limb cut off: the plane, which
  side each mesh keeps) go in the table's row 4 with a branch in skin.wesl. Call npc.ts's swung/slashed at the top of
  `Npc::slash`.
- port/hands: weapons.rs calls `npc.slash_through(&points, depth, sweep)` once a swing is through (the points where the
  blade went into the skin, laid back on the skin at rest by marks.rs); `npc.slash(&crossings, ..)` is the TS's own.

### The check
`cargo run -- --scenario skin --out <dir>` (skin.rs `scenario`): the people held still (their ragdolls fixed, as the TS
check steps no physics), then a pistol in the young man's neck and a knife across his cheek, a rifle through the old
man's face from the side, a knife in the groundskeeper's belly through his shirt and a punch to his eye, a pistol in the
hooded man's forearm bandaged at once and a bat to his cheekbone. Each wound photographed close up at 0, 5, 30 and 120
s (the cameras off in between: two minutes go by in about as long). tools/port-skin.mjs takes the same pictures in the
TS game (render loop stopped, S.update stepped by hand, its ragdolls made static). Its pictures still show the
first-person arms in a few views (they do not hang off the camera there); the soaked clothes in them are soak.ts's
(port/blood).

### What it costs
Measured on lavapipe (software Vulkan, so only the proportions mean anything), four people hurt, `SKIN_TIMES=1`:
the painting pass 0.2 to 0.7 ms a frame that has marks (a drying frame, the whole 2048² film scaled, about 5 ms on
lavapipe: a few hundredths of a millisecond on a desktop card, once every 8 s a person while their film dries); the
main pass with the person's materials against plain StandardMaterial (`SKIN_PLAIN=1`) was within the noise of the
shared machine (150 to 540 ms a frame either way). The skin's fragment shader adds two texture reads where nothing is
painted, five more for each of the wound and film sheets where something is, and loops over the person's holes (up to
64), windows (64) and blow records (16) while they have any; the vertex shader three table reads a corner. CPU: the
runs step 30 times a second (a few triangle tests a run), the bruise rows copied where they changed.

Gunshot wounds (port/wound, `SKIN_TIMES=1`, each 7 cm close-up held 120 frames, against `GUNSHOT_BLANK=1`, the same
views unhurt; lavapipe, a loaded 4-core machine): the main pass 150-290 ms a frame unhurt, 5 to 90 ms (3-40%) more with
the wound filling much of the picture, the most for a close shot's powder pattern and the big exits (much of that is the
film's blood runs, which only the wounded run has). Where a wound is not, a skin fragment pays one comparison (the
wound sheet's alpha, already read). In a wound's patch: one exact texel read, six table reads a record (up to three
overlapping), then where anything is opened the march (48 steps and 7 halvings, each a few value-noise lookups a
record), five more for the slope and one for the colour; skin it never opened (the bruise, the powder) three probes and
no march. So the cost goes with the wound's area on screen: nothing at a few metres (a few pixels), the most in a
close-up. CPU: a record is six texels written once (twice for a way in, when its aim comes), and the row's clock four
times a second; the stamp that numbers its patch is one capsule.

## The face (phase 3, branch port/face)

face.rs (face.ts), the look halves of eyes.rs (eye.wesl: eyes.ts EyeLayer, face.ts PupilLayer), teeth.rs (teeth.ts
`_draw`, `_stump`, `_fall`) and throat.rs (throat.ts `_coat`, `_tears`, `_pool`), and warm.rs (warm.ts). The numbers and
the reasons are the TS's (dev/research/faces.md, eye-trauma.md), in the same words.

### A face (face.rs)
Everyone with a `Hurt` is given a `face::Face` (the rig, MakeHuman's face pose units out of the body's file, made once a
body: 55 face bones, each unit as the bones it turns, about which axis, how far). Every frame, after the body has put the
head where it is (Update, after `ragdoll::send`), the face is worked out in FACS action units (pain by the PSPI's units,
fear, the startle at a shot or blast, each cry's face, air hunger, shock, out cold, dead), the units mixed into pose
units (`AUS`), the lids and the gaze added, and the mix blended as MakeHuman blends (each unit's turn scaled by its
weight, later units on the left) into those bones' turns in `person.posed.local`, which person.rs puts on the skeleton.
What it reads: the vitals; `Hurt` (the eyes' clamp, blindness and collapse, `bruise.swollen`, `crying`,
`bones.jaw_hangs`, `throat.gape`); the voice; the player's eye and what they hold (the threat); `Muzzle::at` (when the
last flash was: a startle); the head's ragdoll segment (how a slack jaw sags, where to glance); `Behaviour::wound` (a
fresh wound is looked at).
- The voice: sound.rs's `Voices` (a resource: person to the `Playing` and its kind) holds what each person is saying, put
  there where sound.rs plays a cry (`Happened::Say`) or a retch or vomit at the head; taken out when it is cut
  (`Happened::Cut`). The face opens the jaw by the loudness of the last 30 ms of the take's own samples at the moment it
  is playing (`Voice::data`, `from`, `rate`, `start` on `Sound::now`), as face.ts read its AudioBuffer.
- What others can read: `Face::jaw` (degrees open), `blink`, `pupil` (mm), `pale` (0 to 1), `fear`. throat.rs reads the
  jaw off the jaw bone (`bones().mouth_open()`), which the face now turns.
- The eyes' bones as their hurt leaves them (a collapsed globe shorter front to back and drawn into the socket, a
  blown-out floor letting it sink): their joints' Transform scale and translation (person.rs writes only rotations).
- Pallor: the skin's colour as the blood leaves it, on port/skin's `Flesh` (its `base.base_color`, alpha kept for the
  x-ray), written when it changes by an eightieth.
- Its own randomness (blinks, glances, microsaccades): an `Rng` per face seeded by the entity, so the face throws none of
  the scenario's or medicine's dice and the other checks' numbers are as they were.
- The head turned to the player is behaviour.rs's `look` (the TS's behaviour `_look`); person.ts's own `_lookAt` and
  `_face` (blinks, the smile) were not used by the sandbox (face.ts overwrote those bones) and are not ported.

### The eyes (eyes.rs's look, eye.wesl)
Each person's eyes get a material of their own, `eyes::EyeMaterial` (StandardMaterial with `EyeLook`, eye.wesl's fragment
shader), the frame after the face: the picture wet (roughness 0.04: a sharp catchlight of every lamp), the pupil drawn at
any size (inside the iris the picture is sampled from where the painted pupil and iris would put each point: PupilLayer),
and over it what the eye shows of its hurt (EyeLayer): blood under the conjunctiva spreading over the white, the hole or
cut in the wall with the uvea pushed out through it, blood in the front chamber settling into a layer level in the world,
a collapsed globe's wall in folds. The TS painted the holes, cuts and patches on a 256-pixel canvas a person and uploaded
it; here they are a list in the material's uniform (`EyeUniform`: up to 12 patches and 12 marks for both eyes) worked out
where they are drawn, edges a pixel of that sheet soft, and the uniform is written only when something in it moved (a
pupil by under half a percent is not worth a new bind group). Which painted eye is which, the iris's size and metres of
eye a unit of the picture are read off each body's mesh once (`Irises`). A blade's cut runs across the picture along its
edge: eyes.rs `pierced` now finds which way with the TS's second line beside the first (`m.across`).

### The teeth and the mouth (teeth.rs's and throat.rs's looks)
- `Happened::Tooth`: the person's teeth mesh made their own the first time one goes (the body's teeth part copied), its
  index written again without the teeth chipped, broken or out; a stump (the tooth's corners pressed flat at the break)
  as a plain mesh under the bone it stands in (no skinning); the piece, or a bullet's three bits, a Rapier ball
  (`GROUP_31`, meeting only the hall) thrown with the TS's seven throws a piece. At most 24 pieces lie about.
- `Happened::Tongue`: a card lying on the tongue under the bone that carries it (the torn hole painted once, at start).
- The coat (blood on the tongue and teeth), and the pool: the blood lying in the mouth as a level disc where the
  horizontal plane at its height cuts the cavity's ellipsoid (the cut ellipse's own axes found from its conjugate
  diameters, so the disc is a Transform), under the person.
- Both run in First before `npc::forget`, so a tooth or a tear made anywhere in the last frame, a scenario's step
  included, is drawn.

### A head cut off
dismember.rs places a cut-off piece's bones by hand (`Person::placed`); face.rs works a bone out from its own chain up to
the first placed bone (`face::bone_world`, also what the eyes', teeth's and mouth's looks use), so a head off keeps its
face, its gaze and its mouth's blood where the piece is, until the death that follows. The face check compares every
bone's chain with medicine's whole skeleton (`Npc::bone_worlds`) on a head cut off.

### The check
`cargo run -- --scenario face --out <dir>` (face.rs `scenario`): the groundskeeper close up at rest, in the middle of
each cry (scream, yell, groan, weeping, gasp, cough: said from the step and played and mouthed as sound.rs would), in
pain, mid-blink, looking at the player from the side; a pellet in the young man's right eye (1.5 s and 20 s on); the old
man dead (his last breath, and half a minute on: lids part open, jaw dropped, pupils wide); a bat into the hooded man's
chin (the jaw hung as one broken on both sides if the blows did not break it: the log says which) and his front teeth
knocked out; the groundskeeper's head cut off (half a second and eight seconds on). Each
picture's face (action units, jaw, blink, pupil, gaze) goes into the log. Each cry is caught where its take is loud with
scenario.rs's `Step::Until(f, most)` (a frame at a time until `f` says so, at most `most` frames: for a moment that
cannot be counted in advance).
tools/port-face.mjs takes the same pictures in the TS game (the waits in each face's own seconds).

## The head, the mouth and the throat (BACKLOG item 7, branch port/item7-head)

What the TS left mid-way (HANDOFF "Stopped mid-way" 1, 4 and 5's eyes), done in throat.rs, eyes.rs and eye.wesl,
viscera.rs and wall.rs, with small changes in wounds.rs and skin.wesl. The numbers and their sources are in
dev/research/airway-blood.md ("Drawn") and eye-trauma.md (sec. 6).

### The mouth (throat.rs's look)
- **A lining** (`Lining`, `lining_mesh`, `line_mouths`): the bodies had no inside to the mouth, so an open mouth showed
  through the head. Every person with a mouth found gets an ellipsoid over the cavity (from the inside of the lips to
  the back of the throat, cheek to cheek, palate to floor), its faces turned in so only its far side shows through the
  lips, skinned to the skull and the jaw (`lining_holds`) beside the skin, wet oral mucosa darker deeper in, NotShadowCaster,
  hidden in the x-ray. Blood in the mouth wets it as it wets the tongue and teeth (`COATED`, the film's colour from
  fluid.wesl's `blood_over`).
- **The pool** (`level`): the blood lying in the mouth is a level surface inside the lining as the skull and jaw hold it
  this frame (the lining's corners posed on the CPU, two bones each): the height under which the lining's room is the
  mouth's share of a mouthful, found by halving (the room below a height by the divergence theorem over the triangles
  cut at it), capped at the lowest way out (the lower lip or a corner: past it, it pours), the outline where that height
  cuts the lining made into a fan each frame it shows (its own mesh, NoFrustumCulling). Its colour is blood's as deep as a
  pool (it was five times too bright and drawn as an ellipse that stood out past the lips when the jaw dropped). Test:
  `level_in_a_box`.
- **Holes in the lining** (`throat_wall`, called from wounds.rs where a missile goes through the mouth): where its line
  goes into the cavity and out again, a torn card on the lining (the tongue's tears' look), carried by the skull or the
  jaw.
- **The vomit** (`gush`): 1.6 to 2.4 m/s out the way the mouth faces, the rope as thick as the flow at that speed (to
  4 cm); it was 0.8 to 1.5 m/s and turned down onto the chest, a string.
- **Neck wounds** (`in_neck`, used by wounds.rs `region_of`, the scalp's bleeding in `pierce`, and `blow`): the head's
  ragdoll segment carries the upper neck and the chest's the lower, so a wound on the neck was "through the head" with
  the scalp's 1.2 to 2 ml/s added, or "to the chest", and a bat to the throat concussed. Now: "Gunshot through the
  neck", no scalp bleeding, a blow to the throat no concussion; the vessels and the windpipe met are routed as before
  (trachea and the track into the airway, the oesophagus into the stomach). A blade drawn across the face no longer adds
  the scalp's bleeding for every place it crossed the skin (one per 3 cm of cut).

### The head (viscera.rs, wall.rs, skin.wesl)
- **What the port did**: nothing opened a skull. viscera.rs opened the belly and chest only, dismember.rs cuts the head
  off only at the neck (`limb_at`), a rifle's exit was a hole, a contact shotgun's a hole; the brain showed only in the
  x-ray. So there was no "opened skull" to show a brain in.
- **Now**: the vault of the skull (`cranium`: above the brows, the temples and the back above the skull's base) is a
  region an opening can go through. A missile that spends 300 J or more in the head bursts it open where it leaves
  (`burst_skull`): a contact shotgun's charge (as weapons.rs fires it within a metre) and any bullet over 600 m/s
  (wounds.rs hands rifles' head shots over as a `Charge` too); a sword's cut deep enough through the scalp and bone
  (4 cm) cleaves it, barely gaping. Through the gap: the wall's layers (wall.rs `column`, `place` "head": scalp, its
  fat, the galea, 6.5 mm of vault drawn as the ribs' bone, the dura) and the brain (viscera.rs `shown`, `look("brain")`:
  grey matter's pinkish beige under the pia's vessels). The hair over the scalp goes with it (skin.wesl: CARRIED parts
  discarded in skin holes). Injury "Skull opened: the brain showing", the scalp and brain bleeding out of it.
- **The spike**: not reproduced. The `face` part cuts four faces with a sword (across the eyes, the mouth, the jaw, a
  slant across cheek and nose) and chops a head off as steep as dismember.rs lets a blade's cut tilt (53 degrees off
  square, from under the ear): no corner of the face is stretched in any picture. The port's cut reweighs the body's
  corners off the piece's bones and the piece's off the body's (dismember.rs `split`), cuts the triangles at the plane
  (flesh.rs) and works the piece's face bones out from where it lies (face.rs `bone_world`); and dismember.rs cuts a head
  only between neck01 and the head bone, never through the face, so the TS's likely cause (face-bone weights on a
  piece) has nowhere to act.

### The eyes (eyes.rs, eye.wesl)
What the port already drew (port/face): blood under the conjunctiva, holes and cuts, hyphaema settling level, a
collapsed globe, the pupil at any size. Added:
- **Bloodshot** (`Eye::red`, the uniform's `state.w`, eye.wesl `bloodshot`): a net of red vessels over a pink flush on
  the white, thicker toward the lids; from a blow near the eye (by its energy), an eye wounded (fully), crying (a
  little), opening over some 15 s.
- **A bullet past the eye** (`near`, from wounds.rs `pierce`): a track 1.1 to 3 cm from the eye's middle breaks the
  orbit: blood under the conjunctiva coming forward from that side, bloodshot, now and then blood in the front chamber.
- **A blade across an open eye** cuts it (wounds.rs ran the eye only for thrusts: a sword across the eyes left them whole).
- **Death** (`Eye::dry`, the uniform's `iris.z`): nothing blinks; the shine dulls over about ten minutes (roughness
  0.04 to 0.32) with a faint haze over the iris. The pupils of the dead were face.rs's already (mid-dilated, fixed).

### The check
`cargo run -- --scenario head --out <dir>` (head_scenario.rs), or a part: `head-mouth`, `head-face`, `head-skull`,
`head-eyes` (each about 5 to 15 minutes on lavapipe). Every picture's throat or eyes into the log, every wound's bleeds
and injuries, the bones' rest places (`rest`).
- mouth: the groundskeeper's mouth hung open empty, wide open (front and side), with 20 ml, full, spilling; a pistol
  shot in through the young man's open mouth, then him out cold on his back with 35 ml, and ten seconds on; the old man
  coughing blood up; the hooded man vomiting; then four neck wounds on fresh people (a bullet through the side of the
  neck, one through the windpipe, a knife across the throat, a bat into it) and the knife's cut close.
- face: the four sword cuts and the steep chop, each face front and side, the stump and the head, all two seconds on.
- skull: a rifle bullet through the old man's head, a shotgun's charge into the groundskeeper's temple, a bat on the
  young man's crown, a sword across the hooded man's forehead; each opening from 25 and 14 cm; the x-ray.
- eyes: a punch to the old man's eye, a knife's edge across the groundskeeper's, a bullet across the young man's face
  under both eyes, a bat into the hooded man's; at two seconds and a minute (the lids held open for the pictures: a hurt
  eye clamps shut); the old man dead, half a minute and ten minutes on.

## The warm-up (warm.rs): a list for every job
Every render pipeline the game will need is made behind a loading screen before play, in the game and in the `warm`
scenario (other scenarios start as they did: compiling synchronously, they hold a frame up instead, and the rehearsal
would change what they log). A pipeline is made for each mix of material, mesh layout and view that is drawn, the first
time it is drawn in view: so the warm-up puts the people through what happens to people, in front of the camera, waiting
after each step until the render world's `PipelineCache` has nothing left waiting for three frames running (and, at the
start and again after the events, every mesh drawn once unculled and unhidden: a prop first seen from the far side of
the hall, sparks or a flash's card kept hidden till wanted, would otherwise make theirs when first seen), then resets
the room as K does (new people, what was carried given back, the player where the game starts them). Sound is muted
meanwhile.

Anything a job draws only after an event goes on the list, in its plugin:

    crate::warm::add(app, "the floor's blood", 4, |w: &mut World| {   // what the screen says, frames at least, the event
        crate::npc::with(w, who, |npc| ...);                           // a wound, a cut, a stream: whatever brings it on
    });

Steps run in the order added (each plugin's in the order main.rs adds the plugins); `warm::aim(w, n, part, far)` puts the
player in front of the `n`th person of the line-up's segment `part`, `warm::take(w, key)` puts a weapon in the hand. What
is on the list now (warm.rs `rehearse`): everything on the board in the hand (the held models and arms, held.wesl), each
gun at someone and the same shot put through them (flash, case, the hole behind, the wound), a dressing, a stab, a cut, a
bat, a punch, a thing thrown, the grenade, an eye shot with teeth knocked out, the tongue torn and blood in the mouth,
port/cut's (a forearm cut off by a blade, a shin by a shot, a belly torn open by a blast, a head off), the x-ray on and
off. Blood (drops, streams, the floor's pools, the clothes' stains) comes of the shots and cuts and is drawn while the
steps wait. Anything new that is drawn only after an event belongs on the list with it.

`warm::Pipelines` (a resource) counts what the render world's cache has made (`made`) and is still making (`waiting`);
with `note` on it keeps what each new one was made for (its label and vertex shader switches).
`cargo run -- --scenario warm --out <dir>` waits for the warm-up, then plays a fight (`warm::FIGHT`: each kind of
weapon at the line-up as a player uses it, a grenade; then an eye shot, blood left to run, the x-ray) and logs
`made_after_warm_up`, which should be 0, after each weapon and at the end, with the new pipelines' descriptions if not.
The warm-up rehearses the same fight on fresh people (as the TS's rehearsed its shots): what found the gaps was the fight
before it was rehearsed. Each gap was a different kind of thing, not a different place: the muzzle's sparks (a gun fired
before it was up in view), a flash's card, the bowel a shotgun lets out over seconds (viscera.rs's ropes), an arm taken
off by a sword's own cut (flesh.rs: its caps are drawn plain while their faces are painted on another thread, then
painted, so the pieces are drawn once more before the room is reset under them). Something new that only a rare event
draws still needs its step here. Measured (2026-11-16, bevy-port at 7b746a3 with port/face, the scenario's synchronous
compilation, lavapipe): 153 pipelines after the warm-up, 0 made during the fight, after each weapon and at the end.

### Building beside other worktrees (found by port/face)
Worktrees sharing one CARGO_TARGET_DIR share the crate's fingerprint (the package is the same, only its path differs), so
`cargo build` in one can say Finished at once while target/debug/cold-chain is another worktree's latest. Check the copy
you run is yours (`strings` for a name only your branch has), and force your own link with
`cargo rustc --bin cold-chain -- --cfg <your branch>` (a flag of its own: only this crate is built again).

## The Escape menu (menu.rs, branch port/sound-menu)
Escape in play opens it (not over the warm-up's loading screen): the game paused (Time<Virtual>; Rapier's fixed steps
come out of it, so the bodies stand still, and Update runs with dt 0, which every system that divides by it already
guards), the sound held (`Sound::paused`: the `all` track paused), the pointer given back. Resume or Escape goes on and
takes the pointer; on the settings page Escape goes back; a click on the room takes the pointer as before (player.rs
`grab`, not while the menu is open). N and K wait while it is open. Quit is AppExit (the profiler's log is saved).
Settings (`menu::Settings`, serde JSON): master, effects and voices volume; the F3 preset (F3 writes it too); the
resolution (following the frame rate, or fixed at 100, 85, 70, 55 or 40% a side: graphics.rs `scale`); vertical sync
(Fifo, or AutoNoVsync); windowed or borderless fullscreen; the field of view across (60 to 110 degrees, 86 the TS's);
the mouse's speed (`Player::look_speed`). Kept in ~/.config/cold-chain/settings.json (%APPDATA%\cold-chain on Windows;
`graphics::kept`), read at start for the game only (a scenario has the defaults and writes nothing); a file from before
reads the preset from the old `quality` file; anything out of range is put right. Drawn as the HUD is (IM Fell, plain
nodes and text), so it makes no new pipeline: the `menu` scenario counts none made by opening it, photographs both pages,
clicks two choices and drags a slider with the mouse (the pointer put on them, the button's presses sent as the window
sends them), writes the settings to its folder and reads them back, then clicks Back and Resume.

## The look against the TS (phase 4, branch port/parity-look)

### Comparing under the same light
Babylon gives a material only its first `maxSimultaneousLights` (8 for people, cut faces and the hall; 4, the default,
for blood's drops), sorted with the shadow casters first, then by `renderPriority`, then in the order the lights were
made. A person meets ten (the fill, six hall lamps, the arsenal lamp, the muzzle flash and anything added after), so
a lamp a TS check adds last lights nothing: the cut check's lamp by the eye was dark in every TS picture and lit every
Bevy one, which is why the cut job saw Bevy's stumps a brighter red. tools/port-cut.mjs now gives its lamp
`renderPriority` 10 and remakes each mesh's light list, and logs the stump's lights to show it. A check lamp in
either game is 0.3 cd: stronger, it doubled the hall's light on a close subject, pale skin came out nearly white
(sRGB 235) and every red on it glowed. At 0.3 cd a close-up's skin is exposed as the hall leaves a face (sRGB 150-165).
The hall, people and arsenal views themselves agree with the TS's within 5% in mean sRGB; Bevy draws the lamps' glass
and lights the arsenal board, as "The foundation" says.

### Blood and tissue colours
- fluid.wesl `blood_over` is the one copy (organs.wesl and wall.wesl import it). Green and blue go as whole blood's
  diffusion rate (36 and 40 per mm) and a depth of it gives back its own diffuse reflectance (0.075, 0.012, 0.011): the
  TS's 24, 28 and 0.004 left a smear's edge orange and a pool glowing pure red. The sources are in the comment.
- Drops and beads are a pool's colour (fluid.rs `DROP`). A drop in flight is drawn at most four times as long as it is
  wide, as long as its motion smear would be at least a quarter covered; the TS's centimetre-long solid needles are gone.
- Muscle in a cut face, a blade wound's wall, a gunshot's and the body wall is beef's red-brown (L* 34-40, a* 22-32);
  fat is a pale cream (b* 20-25), as body-wall.md 1.6 says. The TS's were scarlet (a* 50) and orange (b* 45).
- Exit wounds: dusky lips with a bloody edge, only a trace of blood over the fat between them and less gloss, a long
  tear that wanders, and splits that each bend their own way.

## Performance and release builds (phase 4, branch port/perf)

### Measuring
Measure a release build (`cargo build --release`: target/release, Cargo's own release profile; why no LTO is in
Cargo.toml). The debug builds' game crate is at opt-level 1, and on this machine the main thread also shares four cores
with lavapipe's four raster threads and the other jobs' games, so a number taken here is wall time with all of that in
it: read the proportions, and run the same thing before and after back to back. `perf record -e cpu-clock` (the 6.8
linux-tools work here) on the unstripped binary shows where the CPU goes: on lavapipe the main thread is mostly Mesa
and waiting, and the game's own systems, on the compute pool's threads, a small part.
- `cold-chain --profile` (any scenario too) records the F2 profiler's log from the moment play begins, without the
  table; quitting saves it (a scenario's into its --out folder). `node tools/profile-report.mjs <log>` prints the
  worst systems, the spikes, the frames the game's own code took longest over (whatever the GPU did) with what came
  the second before, and what is drawn by source.
- The rows: each schedule's "other systems", Rapier's fixed steps, the render world, and `profiler::timed` rows
  (weapons, arms, fists, face, sound, flash and smoke, limbs cut off, cut meshes and faces put in, broken bones drawn,
  x-ray regrouped). A heavy frame with only "Update: other systems" or "PostUpdate: other systems" in it wants rows of
  its own: wrap the suspects in `timed` for a run.
- A scenario's screenshot frames are slow in Update and Last (the PNG is encoded on the main thread): not the game's.

### The profiler's log for a play-tester
`cold-chain --profile`, play, quit. The log (coldchain-profile-<version>-<time>.json) is written beside the game, or,
where that cannot be written (an AppImage, an install for every user), in ~/.local/share/cold-chain or
%APPDATA%\cold-chain; F4 saves one at any time, F2 shows the table. It keeps a sample a second (each row's mean and
worst, the frame's spread, draw calls by pass, meshes in view by source), the 300 worst spikes (over 34 ms, or 2.5
frames at the rate it runs) and the 40 frames the game's code took longest over, each with its heaviest rows, the
render thread's time, pipelines made in it and what the player did in the second before (shots, swings, a limb cut off
with what it cost), on one real-time clock. Nothing is sent anywhere.

### What moved off the frame (AsyncComputeTaskPool, put in a frame or two later, the pictures as before)
- A limb cut off (dismember.rs `Shape`, `shaped`): the piece's and the body's skin and clothes cut along the plane and
  the two ends' flat caps. The frame keeps which triangles go, the weights medicine reads, the cut face's outlines and
  the vessels; the body, the piece and its ends change over together; a person's cuts go in in order.
- The x-ray's regrouping when X is pressed (anatomy.rs `regroup`, from each look's `source` copy).
- Broken bones drawn (shards.rs `redraw`/`start`: one drawing a person at a time, what comes meanwhile waits for the
  next; the x-ray's triangles are taken out when it is put in).
- `Npc::trace` through some parts only (a bone, the belly wall's columns) no longer holds every vessel against the line.

Measured (release, lavapipe, the shared machine; ms of the frame, wall time):

| what | before | after |
| --- | --- | --- |
| sword through a forearm (the first cut of the run) | 142 | 9.2 |
| sword through a thigh | 18.7 | 4.8 |
| sword through the neck | 19.5 | 5.4 |
| grenade at a headless man's feet: three limbs and the belly (cut-limbs) | 32 | 8.9 |
| breaks drawn: a shin, a skull (cut-bones `taken`) | 2.9, 4.1 | 0.1, 0.07 (up to 4.7 when put in) |
| X on with two people hurt (regroup) | 2.2 to 7.4 | 0.01 to 0.08 |
| the grenade's frame in arsenal-use (all the game's code) | about 100 to 115, 34 of it breaks drawn | about 84 |
| a shotgun's nine pellets into a person | 1.35 | 1.5 |
| a pistol or rifle shot into a person | 0.9 | 0.8 to 0.9 |

Off the frame: a cut's meshes 8 to 19 ms, its face's painting 17 to 60, a drawing of breaks a few ms, a regroup 0.4 to
3. The arms, the fists, the face and the sound are each under 0.1 ms a frame on average (their rows).

### The grenade's frame (branch port/grenade)
weapons.rs `explode` was 30 to 50 ms of the blast's frame: four blows that each skinned a body's corners on one
thread, then about two hundred fragment lines, each working every bone's place out again for each question medicine
asked of it (`bone_worlds`, through trace, the bones, the throat), inverting 259 parts' matrices and moving 636 vessel
points per trace, before the triangle tests of surface and trace themselves.
- `Npc::hold` / `let_go` (npc.rs): the bones in the world, their inverses and the vessels' points worked out once
  (`Held`) while nothing can move the body; explode holds everyone for its whole run.
- Skinning (`Npc::skinned`) on the compute threads with npc.rs `spread`: the waiting thread does only that work. Bevy's
  `scope` has it take other systems' tasks meanwhile (seen: a material's specialisation run inside the grenade).
- The fragments' first legs (weapons.rs `legs`): every way drawn first (the dice in their old order: a shot throws none),
  each one's wall, person and what it meets in them (npc.rs `Look::surface`, anatomy.rs `trace`, wounds.rs `lines`)
  worked out at once with `spread`, then each followed in turn by `pierce_with` as before.
- The same outcome: a digest of every person's `Happened`, injuries, bleeds, breaks, pain and daze at the end of the
  blast, and of their injuries, bleeds, breaks and vitals 5.7 s on, identical over three runs before and six after,
  and every pierce, blow and wall hit in the log the same. (One thud 1.1 s after the blast, `limb-slap` or `lay`,
  differs between runs of the same build, before as after: when an off-frame cut lands.)

Measured with the debug build's profile (the game crate at opt-level 3, Bevy and Rapier at 3 with debug assertions,
which make wgpu capture backtraces; a release build would have left under 1 GB of disk), lavapipe, the grenade part of
arsenal-use, three runs each, median (range), ms of wall time:

| what | before | after |
| --- | --- | --- |
| explode (its log's `grenade_ms`) | 38 (29 to 40) | 24 (20 to 30) |
| the "weapons" row | 44 (34 to 48) | 29 (25 to 37) |
| Update in all | 50 (41 to 55) | 35 (32 to 46) |
| Rapier's two steps | 9 (7 to 10) | 11 (11 to 12) |
| PostUpdate | 16 (13 to 20) | 11 (9 to 13) |
| the frame's main loop | 78 (64 to 89) | 62 (62 to 71) |

On this machine the compute pool has two threads and shares four cores with lavapipe's, so the fragments' lines go
little more than twice as fast; with more cores they go faster. Rapier and PostUpdate on the blast's frame are what they
are on any frame here (10 to 30 and 5 to 15).

### What is left
- The grenade: explode's own 20 to 30 ms here (the blows' bones and bruising, each fragment's medicine in turn); 3000
  blood drops from the fragments' spatter drawn the next frame (blood.rs's pool: Bevy's transforms and visibility over
  them, PostUpdate 17 to 24 ms for a few frames); and, in four of some twenty runs (before and after this work), one frame 1 to 4 after the blast with
  140 to 280 ms of PostUpdate that no row accounts for. Once it came with every PostUpdate system of ours timed but
  person.rs `pose_people` (each in a row of its own for the run) and none of them was over 3 ms: so Bevy's own work,
  pose_people or Rapier's PostUpdate systems, likely over what the two shins' cuts put in from their thread. Found since
  (port/b-body, "The PostUpdate stall" below): the main thread waiting, not working, while both compute threads compile
  render pipelines, which a scenario does on first use and on those threads.
- Rapier is the biggest steady cost of the game's own: 10 to 15 ms a frame on average here, 30 to 60 in a bad frame
  (two to four 120 Hz steps a frame, four ragdolls with sixteen solver passes).
- Opening a belly or a chest (viscera.rs `open`: the lips' 40 surface tests and the wall's 40 traces): about 2 ms.
- A cut's own bookkeeping, 1.5 to 3 ms (7 for the first in a run); a drawing of breaks put in, up to 5 ms.
- Not measured here: the warm-up (over 30 minutes on lavapipe; its rehearsal is GPU work), and the blood, skin,
  gunshot, face, drag, crawl and per-gun scenarios with the profile on. GPU costs only as lavapipe's proportions.

### Release builds
- `cargo build --release`, then strip the binary (216 MB to 128 MB). The game finds assets/ beside its executable
  (main.rs ASSETS), so a package is the binary and assets/ (without assets/audition, the raw takes tools/sounds.py
  works from: 120 of the 207 MB).
- Linux AppImage (what the user asked for): an AppDir of usr/bin/cold-chain, usr/bin/assets, AppRun, a .desktop file
  and an icon (assets/people/tex/brown_eye.png at 256 px), packed with appimagetool (its GitHub release; here with
  `--appimage-extract-and-run`, no fusermount). Nothing bundled: the binary links only libc, libm, libgcc_s, libudev,
  libasound, libwayland-client (with libffi, libcap), and opens Vulkan, the driver and X11/xkbcommon from the host.
  It needs glibc 2.35 or newer (the 2.39 symbols are std's weak ones). Tested here as the .AppImage with no cargo
  environment: the hall scenario under xvfb draws the hall and the people.
- Windows (x86_64-pc-windows-gnu with mingw-w64) was not built: the user wants the AppImage only for now. A release
  build opens no console there (main.rs), and the F3 preset is kept in %APPDATA% (graphics.rs).

## The body, medicine and hands against the TS (phase 4, branch port/parity-body)

### The body wired into medicine
No `port: needs body` is left. behaviour.rs leaves on the person after every physics step each segment's place
(`Hurt::segments`) and each joint as it is (`Hurt::bends`: the hinge turned with the parent, the angles from the neutral,
the range), and once a frame whether the body is limp (`Hurt::down`): bones.rs `at_joint` judges a blow at a joint on the
joint's real bend and range, and a shot into someone already down plays no flesh hit, as the TS did. behaviour's `think`
runs after medicine's update, as the TS's behaviour ran after the vitals. A limb paralysed by the cord is flaccid
(`Ragdoll::set_flaccid`: the dead tone in its joints), so paralysed legs trail in the crawl instead of staying folded under
the hips. dressing.rs `severed` (dressing.ts `_severed`): a dressing cut through with its limb comes away (its bleeds
undressed, its mesh hidden; it stays in the list marked `off`, so skin.rs's list keeps its places), one wholly on the piece
goes with it, one on the body stays, each corner carried only by its own side's bones.

### The voice
One mouth: a new cry, retch or wet cough cuts the one before (the TS left it playing, and it was not the one cut when they
went out); going out cuts whatever is playing; out cold or dead nothing new is voiced (the throat's cough, retch and vomit
still clear and empty them, silently), and the TS's last breath ('dying') is no longer said, at the user's word that people
"can still make noises when they die".

The user then found the people "a bit too excessive with the screaming" (port/sound-menu). Counted with the `screams`
scenario and tools/port-screams.mjs (four people each shot once with the pistol where it hurts but does not kill, the old
man again at 30 s, four shots into the groundskeeper a quarter second apart at 45 s, a minute with the physics running):
the port voiced what the TS did (without the burst 3, 1, 10, 10 a person a minute against the TS's 2, 1, 12, 11; with it
the TS's 2, 4, 10, 11): no bug, the TS's own rule, a cry at every new hurt and a groan or a sob every 3.5 to 8.5 s for as
long as it hurts. npc.rs `speak` now: a new hurt within 1.4 s of the cry the last one started is part of it unless twice
as bad; between, a sound at each of the TS's moments only by chance, falling with the time since the last new hurt (half
at 20 s) and with consciousness, and quieter the same way; just after a cry, a gasp. Medicine's dice are thrown as the
TS's were (the voice has its own for the rest), so the `wounds` comparison is not moved by it. After: 2, 4, 4, 4 a
person a minute (14 against the TS's 27), on average 0.28 voices sounding at once against 0.52.

### The checks (scenario.rs; on lavapipe the body scenarios draw only the frames they photograph)
- `voices`: shot, knocked out mid-cry, killed, coughing and retching then knocked out; every voice started and anything
  still sounding while out or dead. Nothing is heard after the frame they go out.
- `dressing`: wraps on two forearms, a wrist and an upper arm, then both forearms chopped. The wrap cut through comes away,
  the wrist wraps go with the pieces, the upper arm's stays.
- `guns` (`pistol`, `rifle`, `shotgun`): a gun taken, aimed at a standing person's chest from 3 m and fired as a click
  fires it; tools/port-guns.mjs does the same in the TS game. Pistol: the same injuries (left lung, ninth rib, abdomen,
  diaphragm), vitals within a few per cent, both stand through it, the same sounds (the port also hears the casing). Rifle
  and shotgun: both stand, pain and lung the same; which ribs and organs the round or the pellets meet differs with the
  gun's sway and the pellets' spread (dice): the TS's rifle broke two ribs that the port's missed, the TS's pellets went
  into the liver and spleen, the port's into three ribs and a lung.
- `wounds` against tools/port-wounds.mjs: 2879 of 2880 readings match (the other a hundredth of a millilitre a minute);
  the cries the same but the TS's 'dying'.
- `crawl`: the timeline now has each chest second by second. Speed over the crawl 0.046, 0.040, 0.046, 0.021 m/s against
  the TS's 0.055, 0.061, 0.028, 0.050 (the TS's jitter rig, all four paralysed). It was never ten times the TS's: the old
  logs' end positions were read against the wrong people (the scenario's person 0 stands at +x, the TS's npc 0 at -x).

### What still differs
- Jitter (rad/s, the TS's measure; port/body-fix, after the bevy-port merge at c8fdfab): dead 0.001 (seeds 2 and 3:
  0.16, 0.03) against the TS's 0.10; fall 0.021; crawl 0.97 against 2.40; drag 0.76 against 1.60 (0.96 by
  tools/port-drag.mjs on the same body); stand 0.024. The dead buzz (0.31 before; 0.56 at 20a6c1a) was no phase-3
  change: the body merge's own tree measures 0.39 here (0.06 was measured elsewhere), and which joint buzzes depends on
  how the bodies land. Its causes were the limits' measure and the hinges' zero ("Physics" above).
- The drag: the TS's hand was as far from where it was drawn to as the port's (0.7 to 1.4 m, the same 150 N pull); Havok
  let that slide the groundskeeper about at 0.1 to 0.5 m a second, Rapier's floor friction did not. With the hold a joint
  as stiff as 2 kg at the least, the port's chest goes 0.06 to 0.7 m a second over the sweep, the hand 0.55 to 0.65 m
  off. The arm left free still shakes most (forearm2L 1.67 rad/s), as the TS's does (forearmL 2.65).

## Joints, bones and the smaller open items (BACKLOG item 7, branch port/item7-joints)

### How far a joint goes past its range
Every body scenario's `jitter` entries now log `past_range` (the six joints that went furthest past their range, degrees,
in the joints' own measure, `Ragdoll::past`), `past_cone_deg` (the shoulders past their cone, `Ragdoll::cone`) and
`segments` (every segment's high-frequency spin, for the shins). `limits` loads them on purpose: a bat's blow (12 N s)
across a standing man's forearm and to the side of another's head, a kick (25 N s) across the knee of a man knocked out,
a dead man thrown up and back at 5 m/s (each part pushed at its bone's head, as the grenade pushes).

The limits leak on a joint turned about two axes at once: an elbow (3 degrees of side limit) went 50-107 degrees
sideways dragged by the hand (three seeds), 72 in the crawl, the wrists 50-68, a standing knee 3.5-4.6 past its side
limit at rest. In a two-body test (a pinned arm, motors, a 100 N m pull) the limits held; in the game neither more solver
passes (48) nor PGS iterations helped. Tried and dropped: pre-step stops along the true gradient (no better: the solver
undoes them within the step), turning the hinge's child frame with its bend so the twist and side rows lie along the
turn (no better), a soft lock (15 and 60 Hz: as bad as the limit).

Tried and not kept: the elbow's side held by a lock instead of a 3-degree limit (an axis with no range locked; commit
7b60ed6 on this branch). Dragged, the elbow then stayed within 1.8 degrees, and in the crawl its side leak went from 72
to none; but the leak moved to the next limit along the arm (the elbow's twist, 42-67 in the crawl; with the twist
locked too, the wrist, 111, and the shoulder, 32 and once 88 at rest), and getting up broke: one man of four failed his
push-up and lay down for good in two seeds of three, with the side locked or both, against none of three as now. The
knee locked as well crept 11-13 cm standing ten seconds, against 4-9.

### The limit leak: not the limit row's direction
Rapier's angular limit row (joint_constraint_helper.rs `limit_angular`) limits 2 atan2(x, w) of the relative rotation
(x its part along the axis, recentred on the range's middle) and pushes along the plain joint axis, `basis.column(i)`.
That looked like the leak's cause, but it is not. With dq/dt = (0, W) q / 2 the measure's true gradient is
(w^2 e_i + w (v x e_i) + x v) / (w^2 + x^2), and its dot with e_i is exactly 1: the plain axis moves the limited angle
at unit rate in any pose, so the row is only not the shortest push, never a push on nothing. Tried all the same, the
true gradient in a vendored rapier3d 0.36.1 ([patch.crates-io], checked against finite differences to 1.5e-5), against
the build without it:

| | true-gradient row | as now |
|---|---|---|
| drag, elbow sideways (seeds 1, 3) | 40, 81 | 50, 70 |
| drag, wrist (seeds 1, 3) | 0.1, 6.3 | 5.3, 18 |
| crawl, elbows | 91, 88 | 72, 56 |
| crawl, wrists | 43, 14 | 68, 51 |
| getup, all four standing (seeds 1-3) | yes, yes, one down | yes, yes, yes |
| limits, thrown: worst | shoulder 100 | hand 24.5 |
| dead lying still, spin | 0.037 rad/s | 0.019 |
| fall, stand, creep (10 s standing) | alike; 7-8 cm | alike; 4-9 cm |

Backed out. What lets the elbow go remains open: neither the row's direction, the solver's passes, nor a lock that moves
the leak along the arm. Next to look at: the row's bias, capped at `max_corrective_velocity` (a deep violation is let
back only so fast), and the muscle motors on the same axes (finalised in a block of their own, so nothing keeps them off
the limit row's direction).

### The limit leak: not the bias cap, the motors or the passes
Each tried alone against the build as it is (1082a5b, measured again: the bevy-port merge moved some numbers), drag
seeds 1 and 3 and the crawl first, the rest only where those were better. The elbow is `forearm`'s joint; s side, t
twist, degrees past the range at worst; hf the mean high-frequency spin, rad/s.

| | as now | bias cap 30 (from 3) | elbow's side and twist motors off | 48 passes (from 16) |
|---|---|---|---|---|
| drag s1: elbow; worst else; hf | s 62.7; shin 21.2; 0.985 | s 40.6; 0.4; 1.153 | t 136; shin 12.2; 1.313 | s 35.7; hand 28.2; 1.019 |
| drag s3 | s 70.3; hand 18.2; 0.859 | s 76.8; 0.9; 0.890 | t 132; elbowL t 18.7; 1.236 | s 85.1; hand 34.8; 0.932 |
| crawl: elbows; worst else; hf | 94.4 (and t 42); hand 61.7; 0.763 | 41.5, 31.3; 1.1; 1.119 | 171, 123; hand 77.8; 1.205 | 42.0, 36.2; 12.3; 0.796 |
| getup s1-3: all four up | yes, yes, yes | yes, yes, yes | | |
| dead lying still, hf | 0.014 | 0.027 | | |
| stand: hf; creep (cm) | 0.024; 4.4-9.3 | 0.024; 6.9-7.9 | | |
| physics ms/step | 2.3 | 2.3 | 2.4 | 6.8 |

None kept. The cap (`normalized_max_corrective_velocity`, which Rapier's angular limit rows share with the contacts;
the joints' own softness is its default, effectively rigid, so 60 per second of error up to the cap) settles the
other joints (the shins and hands to a degree or less) and halves the crawl's elbows, but not the drag's (one seed
better, one worse), and it doubles the dead man's spin and raises every moving case's jitter. With the elbow's side and
twist motors off its side stays in, but its twist, held by nothing but its limit, goes 130-170 past: the motors hold
the elbow, they do not push it out. 48 passes helps the crawl but not the drag, puts the hand out further and costs
three times the physics. Softening the joint (a soft lock, 15 and 60 Hz) was as bad as the limit (above).

### Rapier's NaN rollback
Rapier (0.36's quarantine) rolled back and disabled two bodies over a NaN in one khang run of four, and in every
arsenal-use run: Young man (7)'s chest and right hand at the knife's cut (frame 241), the man limp from then on.
Probed (non-finite state handed to Rapier before each step, every `ExternalImpulse`, `Ragdoll::push` and `turn` with a
backtrace), the NaN came in through the impulses, from `Behaviour::hold`'s hand pressed on the wound: the wound's way out
(`Wound::out`) was the push's direction, `normalize_or_zero`, and the cut gave no push (its blade spent no energy, so
wounds.rs's share and the impulse are 0); `tend` normalised the zero vector every frame, the hand's target went NaN, and
its pull (`motor::push`, the hand and back on the chest) put NaN into both. Neither a motor target, a joint frame, a
mass after a cut nor a blast: nothing else non-finite reached Rapier in any heavy scenario. A wound with no push now
faces out from its segment's middle through the point.

| rollbacks (runs) | before | after |
|---|---|---|
| arsenal-use, the knife (every arm to the sword; knife alone) | 4 of 4 | 0 of 3 |
| arsenal-use, the grenade alone | 0 | 0 |
| khang | 1 of 4 | 0 of 1 |
| cut, wounds, limits | 0 | 0 |

(The whole of arsenal-use runs past the 25 minutes the measuring script allows on this machine, two at once: the knife
and the grenade were run alone besides.) Seen on the way, not a NaN: the sword's blows set the forearm they meet
spinning at 800-1000 rad/s (khang, frame 811, before the cut), its turning inertia 0.0007 kg m2.

### The shoulder's cone
The port has the TS's capsule (ragdoll.rs `shoulders`: the posterior bound of the arm's direction as a function of its
elevation, 60 degrees behind hanging, 45 level, 20 overhead, Norkin and White; a stiff damped spring past it). Mostly it
holds: over every scenario above and three seeds of drag and getup, nothing past it at rest, getting up 0.9 degrees at
most; only a dead man thrown up and back at 5 m/s takes an arm past it, 3.4 to 12.5 degrees, for a moment.

### Bones (bones.rs)
Checked per bone and load in dev/research/bone-strength.md. Wrong and fixed: the clavicle's force across was its axial
figure (1480 N; bent across at speed 732-1159 N: now 1100), the kneecap's 6000 N (8.5 kN in flexed-knee impacts: now
8500). Not used anywhere: `twist` (nothing loads a bone in torsion).

### The K reset
`khang` (scenario.rs) hurts four people, then presses K. The reset took one frame of 982 ms. Almost all of it was
`sandbox::clear` despawning each ragdoll's joints after their segments: every joint entity (a friction joint, a piece
held apart) is a child of a segment and had already gone with it, so each of some 90 despawns failed, and Bevy's warning
for a failed command takes a backtrace, about 10 ms apiece in a dev build (and a screenful in the log, in every scenario
that resets). `Ragdoll::entities` now gives the segments only. The reset is 26.8 ms: `ragdoll::segments` 22 of it (4-7
ms a person), the queued commands about 4, the clear nothing; the K frame's CPU about 140 ms against 115 either side
(dev build, loaded machine), and the frames after it no dearer than before. Under the 50 ms the brief set, so the work
is not spread over frames.

### The chest wall
Measured offline from the bodies' own meshes (assets/people skin, assets/anatomy bones; rest pose), rays straight back
every 1 cm across and 5 mm down from the top of the breastbone, skin to the first bone. Front of each rib, mm, median at
8-10 cm from the midline (about the mid-clavicular line), the four bodies' range:

| | mm under the skin |
|---|---|
| sternum (anywhere on it) | 7-9 (3-24) |
| clavicle | 14-16 |
| 1st rib (5-7 cm out) | 31-35 |
| 2nd rib | 40-46 |
| 3rd rib | 37-41 |
| 4th rib | 32-38 |
| 5th rib | 24-30 |
| 6th rib | 17-22 |
| 7th rib (12 cm out) | 16-24 |

The real wall is 41-45 mm to the pleura at the 2nd space (dev/research/body-wall.md 1.2: skin 2, fat 5-15, pectoralis
10-20, then the rib), so the rib's front about 30-40: the 2nd to 4th ribs are right or a few mm deep, the 5th and 6th
thin but within reason for the lower chest, the sternum right (skin and 2-5 mm of fat). Nothing comes through the skin.
What is wrong: there is no costal cartilage. The ribs are bone to the costochondral junction and stop; the only cartilage
parts are the thyroid and cricoid. 3-7 cm either side of the midline, over the top 14 cm, 230-236 rays of 290 meet
nothing within 90 mm (in a real chest the cartilages of ribs 1-7 fill that band but for the spaces between them), so a
blade or bullet there goes into the chest without touching anything, and the x-ray shows the ribs ending short of the
breastbone. The fix is in the asset pipeline (tools/anatomy.py's part list, beside the thyroid and cricoid rows, from
BodyParts3D's costal cartilages), and the BP3D cache was not on the machine this was measured on.

Since: the source fetched into ~/.cache/cold-chain/bodyparts3d (dbarchive.biosciencedbc.jp, `isa_BP3D_4.0_obj_99.zip`
of 2013; anatomy.py rebuilds the committed bins byte for byte from it), and tools/anatomy.py has the cartilages of the
first seven ribs a side (all the source has), kind `cartilage`, kept a bone's cover under the skin (not an organ's 20
mm), and part of the cage the lungs fill (only the left lung moves, its front 14 mm forward to them). Measured as above,
the band 3-7 cm out over the top 14 cm: nothing within 90 mm on 123-128 rays of 290 (was 230-236), the rest the spaces
between the cartilages; a cartilage 6-34 mm under the skin, median 18-20. In the game (`chest`, 4.5 cm out, 2-14 cm
down): nothing on 4-6 of 14 lines a person (was 14), the cartilage 10-28 mm deep. In the game a costal cartilage breaks
as a rib (`bones::key_of`; it was the voice box's key, every part named `...cartilage`), and a blow to the chest reaches
it (`struck` took any cartilage for the head's).

### Shins standing
`stand`'s per-segment spin (the TS's jitter.mjs measure): shins 0.012-0.018 rad/s, the feet 0.024-0.031, the thighs
0.011-0.012, in three builds; the notes' "feet still buzz about 1 rad/s" is gone. The head is the most, 0.196, ten times
anything else.

## The player's body, what they hold, jumping (BACKLOG items 1 and 2, branch port/b-body)

### The body (player.rs)
The player is a body in the physics (`PlayerBody`): 80 kg, a capsule round the eye's line from 40 cm over the feet (what
is lower, a body lying on the floor, is stepped over) to the crown, 25 cm across the shoulders, rotations locked, no
gravity of its own. Every physics step (`drive`) its velocity is brought toward the pace the keys ask for (`Player::vel`,
eased as before) by no more than the feet can give: 0.9 of the weight along the floor (rubber on concrete), so at most
706 N, and in the air 8% of that. Its height follows the feet's (`Player::height`, still map.rs's ground, stairs and
falls). The eye is the body's place each frame, carried on by the physics' overstep (so it moves as smoothly as the
frames come). The hall is still map.rs's (`push`, `ground`): the body meets only people's segments, pieces cut off and
things thrown or dropped (collision group 6), and a wall push moves the body with the player. Put somewhere (`spawn`,
every scenario), it goes there still and passes through anyone it lands in until it is clear of them all (`drive`).
thuds.rs takes it as a person, not a wall (no slam); weapons.rs `take_hold` looks past it.

### Jumping (player.rs)
Space, on the floor: 2.97 m/s up, a 0.45 m rise (Markovic 2004: 0.4-0.5 m for active young men). Off the floor only
the air's 8% of the grip steers and nothing slows; Space in the air does nothing; landing sinks the eye with the knees
(2.5 cm per m/s, at most 12) and is heard as a footfall (`steps`; there is no landing take).

### What is held (weapons.rs `animate`, `clear_of`, `measure`)
Drawn in the room (held.wesl, the TS's draw-over-the-room, is gone; blades get their own material in `own_blades`).
Each thing's convex hull in the hand's frame (`measure`, from its meshes) is swept every frame from as far back as the
arms can take it (12 cm in front of the eye for what is held out, 6 cm for a long gun's stock) to where it is wanted,
against the room (WORLD) and people's segment colliders: it stops where it first touches, pulled back toward the chest;
when that is not enough it is turned about the back of its box (a long gun's butt, a pommel), a gun's muzzle down and
anything else's point up, 0.15 rad at a time to 1.35. It goes in at once and back out over about 0.1 s. Pressed against
someone it pushes the segment touched with 400 N/m of how far it is pulled back, at most 80 N. During a stab, cut or
blow it is not bent out of the way: what it meets in a person is `sweep`'s as before (the striking points' paths), and
if it meets the room's wall the swing stops there (`Action::stopped`, heard: there is no take of steel or wood on
concrete, so 'bounce-metal', the grenade's, or 'blunt' for the bat) and comes back the way it went.
Shots are followed from 4 cm inside the barrel (`IN_BARREL`): a muzzle pressed into the give of clothes and skin still
finds the way in. wounds.rs takes the powder's range from the muzzle (`Missile::muzzle`, the distance the shot has come
from it): with shots from the muzzle since the hands' port it was counted from a point 45 cm behind it, so a shot from
1.6 m drew powder and a contact shot's range was -0.44 m. Pellets and a shotgun's charge now leave powder too (only a
grenade's fragments have none).

### The checks (body_scenario.rs: `body-push`, `body-press`, `body-melee`, `body-jump`; MELEE=sword,bat for some)
Debug build, lavapipe, one run each unless said.
- Walking (1.55 m/s) into the groundskeeper standing: the player's pace fell to 0.78 m/s at contact and he went back at
  0.9 m/s, standing; leaning on into him for 2 s at the full 706 N drove him back 2.1 m at about 1.1 m/s, still standing,
  until his balance gave and he went over (Fall at 2 s, Down on the floor). Let go, both stop. Running (3.4 m/s) into the
  young man: 3.4 -> 2.0 m/s for the player, 1.85 m/s for him; he went back 0.6 m and stayed on his feet. The player's
  line never came nearer his chest's than 0.46 m (the capsule's 0.25 and his chest's): nothing passed through.
- The pistol walked up to a chest and the look brought down onto the breastbone: the gun pulled back 0.19-0.33 m, its
  muzzle 3 mm off the chest's collider (8 mm into the skin as medicine draws it), the man pushed back 12 cm by it; fired,
  the bullet went in 8 mm from the muzzle (range 8 mm for the powder; was -0.44 m, see above) and out of his back.
  Pressed to the south wall: pulled back 0.26 m, the muzzle 0.7 mm off the wall, the hole where the muzzle was. The
  rifle walked into the wall: 6 cm back, then the muzzle down 1.2 rad about the butt; backed off, back to rest (0.003).
- Swung and stabbed at the wall from 45 cm: the deepest any corner of each hull went past the wall's face, knife 0.0,
  sword 0.0, bat 5.3 cm (the one frame it met it), shovel 1.6, sledge 2.0, hammer 0.0 (14-91 cm before the swings were
  stopped by it). At the young man's belly from arsenal-use's distances: knife a stab (pelvis), bat, shovel and sledge
  blows (upper arm, upper arm, pelvis: what the swing came across first), hammer a blow (pelvis) in two runs of three;
  the sword from 0.9 m, its point past him, now cuts with its edge (head, chest) where it went through him unfelt. 0.6 m
  beside his head, looking past it: knife, sword, hammer nothing; bat, shovel, sledge his forearm or upper arm, which
  the swing comes across.
- Jump on the spot: up 0.425 m in 0.28 s, down 0.58 s after leaving; Space again in the
  air: nothing (the rise is integrated by the half-step since: 0.45 m, not re-run). Walking at the half-metre crate and jumping: on it (0.5), and off the far side. A body lying on the floor:
  walked over (the capsule's bottom at the knees), and jumped over.

### Not done
- The fists are not kept out of anything (a guard held up against someone chest to chest goes into them); a punch
  stops at the skin as before.
- The arms are not tested against the room: pulled back with the gun they stay near the body, but an elbow can go into
  a wall beside the player.
- The push back from the held thing on the player (at most 80 N against the feet's 706) is not given to the body.
- A long blade thrust at someone nearer than its length goes through them and cuts with its edge (above); it is not
  stopped by the body.
- The player's capsule is one shape: no legs below the knees (things lower are stepped over, not kicked), no arms.

### The PostUpdate stall after some blasts (PORT "What is left")
Looked at with `perf record -e cpu-clock -k CLOCK_MONOTONIC --call-graph dwarf` (/usr/lib/linux-tools/6.8.0-149-generic/
perf; the `perf` on the path is a wrapper that does nothing here) on the running game, started by a temporary hook in
profiler.rs `run_main` at a frame or at "grenade went off", and each PostUpdate's monotonic start and end printed beside
it, so the samples of the very frames could be cut out (`perf script --time`). Not committed.
- Four grenade runs of arsenal-use (ARSENAL_USE=grenade): none had the 140-280 ms frame (the worst PostUpdate in the
  frames after the blast 39 to 65 ms). The same stall is there in every run at the start, though: PostUpdate 650, 190-360,
  1140-1580 and 100-125 ms in frames 0 to 3 of any scenario.
- In those frames the main thread is hardly sampled at all (5 samples in 2.3 s of PostUpdate at 100 Hz: it is asleep),
  and both compute pool threads (this machine's four cores give Bevy's compute pool two) are in wgpu's
  `create_render_pipeline` (lavapipe compiling: naga to SPIR-V, LLVM), under the render world's PipelineCache in its
  Render schedule. The main world's PostUpdate systems are tasks on the same pool, and Bevy's executor does not run them
  on the waiting main thread (`scope_with_executor(false, ..)`): PostUpdate waits until a compute thread is free.
- A scenario compiles pipelines synchronously, on first use (main.rs: `synchronous_pipeline_compilation` for every
  run, so that a mesh is not left out of the picture it is wanted in), and skips warm.rs. The blast is the first time a
  scenario draws thousands of drops, the smoke, the cut faces: its spike in the profile lists 3 pipelines compiled. Only
  when such a compile lands on the frame's PostUpdate does it show there (four runs in twenty).
- In the game the pipelines are compiled at load behind the loading screen (warm.rs) and otherwise asynchronously (on
  the async compute pool, bevy_render `create_pipeline_task`, not these threads), so this stall should not happen there. Not measured on a real machine.
  Nothing was changed: what the scenario numbers after a blast show as PostUpdate is partly the render world's first-use
  compiles; read the profile's `compiles` beside it.
