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
