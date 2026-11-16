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
`cd game && cargo run` is the game; `cargo run -- --scenario <name> --out <dir> [--seed <n>]` a scenario. Run it
through cargo (or with CARGO_MANIFEST_DIR set to game/): the assets are found as `../assets` from the crate
(main.rs ASSETS, `asset_file`), which a bare binary in target/ does not see. The weapons' glTF needed one change to load
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
  is the TS's `world.note`. F4 saves `coldchain-profile-<version>-<time>.json` in ~/Downloads (or the working directory)
  in the TS's format; `node tools/profile-report.mjs` reads it.
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
`_hold` (drawn to in front of the eye, as far as it was taken from, at most 2.2 m), and the pull is weapons.ts `step`,
given every physics step (behaviour.rs `pull`). Let go: remove the component.

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
