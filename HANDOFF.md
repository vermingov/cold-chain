# Cold Chain: handoff (2026-11-19)

Read this first, then `dev/NOTES.md` from "## The sandbox, 2026-11-13 (0.8.0)" to the end. The game is only the sandbox.

## Next session: start here (2026-11-19, end of the fifth cloud session)

The user played the AppImage built from bevy-port a913169 (items 1-6 below) and asked for fixes and new things;
dev/BACKLOG.md "The user's reports and asks, 2026-11-19" has their words. Three jobs started the fixes and were
stopped at the user's word ("take a break, stop agents, and document for next session"). Their branches are pushed,
NOT merged into bevy-port; each branch's dev/PORT.md has an "..., unfinished" section with numbers and next steps.
Merge each with plumbing (assets/ is a symlink in worktrees; check `git diff --stat bevy-port...<b> -- assets` is
empty), build with no warnings, `cargo test`, look at the scenario's screenshots, then rebuild the AppImage.

- **port/b-six (adb1143): punches.** Damage fixed and measured, look built but never seen.
  - Cause of one-punch fractures: the player threw an Olympic boxer's punch (10.5 m/s, 3.2 kg, 176 J); the brow
    counted as the eye socket (1.2 kN, not the frontal 6.3); ribs from old cadavers with age applied again; knockout
    from energy anywhere on the head.
  - Now: an ordinary man's punch (jab 6 m/s 0.6 kg, full 7.5 m/s 1.6 kg); nose 600 N; ribs per Kent & Patrie 2005;
    knockout from the head's turn (Walilko); `Harm::struck` the same. Full bare punch to the face: fractures 49 -> 11
    of 100, knockouts 100 -> 0 (`punch-damage` scenario; table in PORT.md).
  - fist.rs motion (palm-down landing, snap back in 0.16-0.2 s, cocked wind-up in view, shoulder turn) only built:
    run `punch-look`, compare with the before frames. 38 tests passed before that last edit; run them again.
  - To check: the old man weakened for age twice (jaw, ribs); glove padding counted twice; bare jabs rarely bruise.
- **port/b-ragdoll (cc4b82b): opponent footwork, crawl elbows, jab speed.** None done.
  - Footwork (off by default, PROBE_WALK=1): cause found and fixed in part (steps landed 30-60% short; the swing's
    pull shoved the planted foot back 0.4-1 m). He still falls ~1.5 s after leaning in: his weight moves away from
    the player and the planted foot slides 0.2-0.4 m. Next: log the horizontal pushes in single support. Getup and
    the 60 s / 3-seed spar not run on the new stepping (80 N s shoves: 2 of 10 fall, was 4).
  - Crawl: a new pull pose (shoulder flexion 135, abduction 40, elbow 35) took seed 1's worst elbow 50.5 -> 24 deg;
    not the default yet. Next: seeds 2-3, a straighter stroke.
  - Jab cap 5.5 m/s, straight 7 m/s (sources in PORT.md); one spar peaked 2.8-7.3 m/s, the arm's muscles overshoot.
- **port/b-body (27d8189): contact shots that miss.** Cause likely found, not fixed.
  - press_scenario.rs (`press-pistol`, -ak, -m4, -shotgun, -rifle, -lying, -shove, -walk) logs hit/clear/MISS.
    Held still against someone: 0 misses (pistol 89/90 hit, AK 49/49, rifle 9/10). Walking in: 1 MISS of 11; the
    gun gives back only ~6 cm and pushes with at most 80 N, so the barrel passes through the person and the shot
    starts beyond them.
  - Next: stop the player's walk once the gun is pressed and fully pulled back; start the ray from the gun's back
    along the barrel (contact range from the muzzle); run M4, shotgun, lying, shove; look at contact wounds.
- **New (not started):** syringes (heal vitals and stop bleeding without healing the look; rot the flesh; dissolve
  all bones; poison), a boiling water gun (real scalds), an acid gun. They need new ElevenLabs takes; the
  ElevenLabs connector needed signing in again at the end of this session.

How the jobs ran (it worked; reuse it): one worktree per job (`git worktree add --no-checkout -B <branch> <dir>
bevy-port`, sparse-checkout without assets, `ln -s` the main assets, `git ls-files -z assets | git update-index -z
--assume-unchanged --stdin`), a cfg per job (`cargo rustc --bin cold-chain -- --cfg <job>`) on the shared target,
rules in one file. The machine (4 cores, 15 GB) fits two games at once; a third ran out of memory. The container
restarted four times in two days: jobs must commit after every step. Commits: author vermingov, committer
`Claude <noreply@anthropic.com>` (a hook flags others as unverified). Never commit the assets deleted on disk.

## The Bevy port: done (2026-11-17, fourth cloud session; read before the rest)

The game is now the Bevy one in `game/` (Rust: Bevy 0.20.1, bevy_rapier3d 0.37, kira 0.12), branch `bevy-port`. The
Babylon game was deleted from this branch once the port matched it (PORT.md, top: how to bring a file back); `main`,
`wip/0.8.19` and `gh-pages` still have it. Everything below "What it was" describes the TS game: the history the Rust
code's comments refer to. `dev/PORT.md` is every port job's notes; `dev/BACKLOG.md` the user's list and its order.

Merged this session: the play-testers' reports (sound.rs opens the device with a 256-frame buffer and logs the latency
at start; people cry less, npc.rs `speak`; menu.rs, the Escape menu with volume, graphics and mouse settings saved in
~/.config/cold-chain/settings.json), the dead-body buzz and the drag (ragdoll.rs `ranges` in Rapier's limit measure,
hinges zeroed mid-bend; behaviour.rs `hold` a joint), the grenade's frame 38 -> 24 ms of `explode` (debug profile).
Not verified on real hardware: the sound latency (ask for the `sound:` line the game prints at start), fullscreen and
vsync switches. Open: a 140-280 ms PostUpdate frame after some blasts (PORT.md "What is left").

Item 7 (what the TS left unfinished), merged 2026-11-18 (PORT.md has each job's numbers):
- Head (head_scenario.rs): the mouth's lining and pool, neck wounds bleed as the neck, the skull opens to the brain,
  bloodshot and drying eyes.
- Arms (fist.rs, npc.rs `Npc::struck`): punches land where the eye is; a blow hurts the part whose skin it hit. Knife
  and bat over a head miss by design (the models never come down that far).
- Joints (ragdoll.rs, bones.rs, behaviour.rs): K reset 982 -> 27 ms, Rapier's NaN rollback (a zero wound direction),
  clavicle/patella strengths, costal cartilage in the anatomy bins (BodyParts3D, tools/anatomy.py).
Still open from item 7: elbows past their range under load (drag 63-85, crawl 94 deg; bias cap, motors and solver
passes measured, none fixes it), sword blows spin a forearm at 800-1000 rad/s, the brain looks like shards, faint
bloodshot, zigzag vomit, drops drawn as dark balls, costal cartilage breaks at the rib's 2500 N (no own figure).

Items 1-6 of BACKLOG and the user's play-test reports, merged 2026-11-19 (PORT.md has each job's numbers):
- Body (player.rs, body_scenario.rs, thuds.rs): an 80 kg capsule that pushes people, jumping, the held weapon a solid
  in the world, shots from the muzzle, melee stops at walls.
- People (sandbox.rs `BODIES`): the hooded man gone; a man in white and a naked man added. Stumps, and x-ray and
  bandages after a cut, no longer stretch to the severed piece (`CutOff::carrier`, `anatomy::cut`).
- Gloves and brass (worn.rs, polished.wesl), the ring (ring.rs, C ducks through the ropes), an opponent (bout.rs, B;
  respawns 10 s after going down or dying) who guards, faces you and punches (behaviour.rs `fight`).
- Ragdoll (ragdoll.rs, behaviour.rs): joint correction speed 30 (drag elbow 64 -> 3 deg past range), no gyroscopic
  term; shoves stagger and topple (120 N s fells all 10, 40 N s nobody); getup 14 of 15.
- Wounds (wall.rs/wall.wesl, skin.wesl, fluid.wesl, organs.wesl, viscera.rs, gore_scenario.rs): torn edges and
  uneven layers instead of drilled rings, the cavity closed behind, matte mottled pulp; bowel drawn only where seen;
  the shirt stain's edge soft; a sword cut pushes once a swing.
Still open: crawl elbows 40-70 deg past range (the pull pose folds the forearm under the chest); the opponent has no
footwork (it backs off and falls when it walks, PROBE_WALK=1), is pushed over by its own punches into the player at
about 6.5 s, and jabs carry ~50 J; bowel blood smears strong red; a jab broke a 78-year-old's frontal bone; the
player's hands are never hurt by punching; no take of steel or wood on concrete; the sword's 800-1000 rad/s spin not
reproduced since the push change.

## Run it

```
cd game && cargo run                                   # the game
cargo run -- --scenario <name> --out <dir>             # a scripted check (scenario.rs lists them)
cargo test
```
Headless here: `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json WGPU_BACKEND=vulkan xvfb-run -a -s "-screen 0
1280x720x24" <bin> --scenario <name> --out <dir>`; the binary finds `assets/` beside itself or in the tree. Every
change is judged from a scenario's screenshots and log.json. `--profile` records a session (profiler.rs);
`node tools/profile-report.mjs <file>` summarises it. The AppImage: PORT.md "Release builds".

## What it was (the TS game, for the history)

A realistic ragdoll / vitals / blood sandbox in first person, Babylon.js 9.27.1 + Havok, TypeScript 7 built with Vite 8.
You walk a hall with four people (MakeHuman bodies with real anatomy: organs, bones, layers of skin/fat/muscle), take
weapons off an arsenal board (pistol, knife, sword, bat, AK, M4, shotgun, rifle, grenade, things to throw, fists) and
hurt them: wounds, bleeding, blood on floor/clothes, fractures, dismemberment, evisceration, bruising, vitals.
Keys: N spawns a person where you look, X shows insides, K clears the room and lines up new people (reset).

Not in this zip: `node_modules`, `dist`, the git history (the last two commits' text diff is in
`dev/last-commits.patch`), and `~/.cache/cold-chain` (fetched MakeHuman/BodyParts3D sources for tools/*.py, and old
one-off rig scripts). The game runs without them; only rebuilding people/anatomy (tools/people.py, anatomy.py) needs them.

The user's preview (tailnet 100.112.58.71:8670, `node server.js` as a user unit on their PC) is not reachable from the
cloud. Hand back a build or a commit; they redeploy.

## The user's rules (standing, all sessions)

- Extremely realistic: skin, flesh, organs, blood must behave as real ones do; no stand-ins left unsaid. Looks like a
  AAA game. Runs well (60 fps target; it lags under heavy carnage today).
- Sounds: only the ElevenLabs takes in assets/sounds (tools/sfx.py builds them). Never synthesise a sound (no
  oscillators, noise, procedural audio). Fix a bad sound by regenerating that one take.
- Models: CC0/CC-BY from online sources (credited, see assets/people/CREDITS.md) or built in code. Never Blender.
- The engine is Bevy (the user's word, 2026-11-15; it replaced Babylon.js).
- Regressions: "it worked before" means find what changed and fix that; no workaround layers.
- Don't guess API/function names; check the Bevy/Rapier/kira docs or source.
- Code style: match the surrounding code (prose comments that explain why, no slop, no needless abstraction).
- Commits are authored `vermingov <vermingov@users.noreply.github.com>`.
- Don't wait for replies; work autonomously and report what was verified and what was not.

## Where the work stands (2026-11-15, end of the second cloud session)

Live: https://vermingov.github.io/cold-chain/ is 0.8.25, the whole of `wip/0.8.19` at the end of the session, pushed at
the user's word with only a smoke check: it boots; pistol, shotgun, sword and bat hit people with no page errors; a
punch is thrown but did not land in the headless check (could be the test: 75 cm away at 1-5 fps). Everything listed
under "stopped mid-way" below is in it unfinished. `main` is still 0.8.22 + hotfixes.

### Done and measured this session
- **F2 profiler records the session** (profiler.ts): F4 saves `coldchain-profile-<version>-<time>.json`;
  `node tools/profile-report.mjs <file>` prints worst systems, spikes with what the player did before each, fps spread.
  A friend's log (Radeon R9 200, Firefox, 81 fps mean) is what found the next two.
- **Film/marks uploads** (film.ts, marks.ts, fluid.ts `sendCanvasParts`): mipmaps remade once a send, not after every
  run of tiles; the film dries a few tiles a frame on each tile's own clock instead of every sheet every 8 s (170-220 ms
  spikes with nothing happening). Not re-measured on a real GPU.
- **Adaptive resolution judged by the median frame** (graphics.ts), not the mean: CPU spikes no longer drop it to 40%.
- **Jitter** (ragdoll.ts, behaviour.ts, weapons.ts `step`): the shoulder's bend zero moved 30 deg off Havok's +-180 wrap
  (the crawl's reach crossed it and the limit flung the arm the long way round); the crawl blends in over 0.5 s; the
  grab's pull is applied every physics step. Crawl 5.0 -> 2.6, drag by the hand 5.3 -> 1.6 rad/s high-frequency spin.
  Open: standing people's shins buzz (cause not found); elbows give up to 18 deg sideways in the crawl.
- **Cries cut off** (sound.ts `cut`, npc.ts `_saying`): knocked out or killed mid-cry, the cry stops. A 2-minute log
  after kills showed nothing else from a dead body but the fall (one settling thump at 12 s).
- **Throat** (throat.ts, wounds.ts, bones.ts `levelAt`): blood in the mouth/airways/stomach now works. Causes fixed: a
  NaN from `getDirectionToRef` (returns the node), the cord level backwards (C4 and above stops breathing), a holed
  windpipe getting only 0.3 ml/s (now 30% of the track's bleeding), cough/spit thresholds, `SICK` 30 ml, negative bleed
  rates for organs inside organs. Estimates are in dev/research/airway-blood.md.

### Stopped mid-way (in the live build, unfinished)
1. **Mouth interior**: the user wants the mouth to visibly fill with blood (a liquid surface at the fill level, level with
   gravity, spilling over the lips, sprayed by coughs), a wet red interior instead of the grey blob (tongue/oral cavity
   material), wounds inside the mouth (tongue, palate, back of the throat) visible, the vomit a gush not a thread, and
   neck wounds not bleeding as scalp. Not started in code beyond the throat fixes above.
2. **Shotgun cost** (a blast is 110-360 ms of JS on the friend's PC): profile in the session showed bones `_draw`
   rebuilding a break's meshes per break (new vertex buffers), `trace`/`surface` recomputed per pellet, a sound chain per
   pellet hit (sound.ts now merges the same take near the same place in one moment), shards `region`. The agent was
   making `rayToSegment` and the vessel loop allocation-free when stopped; nothing measured after.
3. **First-person arms and weapons** (arm.ts, fist.ts, weapons.ts, hud.ts, arsenal.ts, warm.ts): the user finds the arms
   "extremely annoying" (sleeves as huge flat flaps looking down, odd grips, the .22 low; the arms cost 29 ms a frame on
   the laptop). Asked for: a true first-person viewmodel; shots from the muzzle along the barrel and melee hits only
   where the weapon model actually sweeps (not the crosshair; hud.ts now draws the aim where `weapons.sight()` puts it);
   Hands (grab/drag/bandage) and Fists separate, left/right punches, hold to charge (real 1-5 kN). Partly written:
   fists slot and board item, charge/punch code, sight. Check all of it: punches may not land.
4. **Head**: no brain shows in an opened skull (viscera.ts SHOWN has no brain; the anatomy has one), and a sword cut to the
   face stretched part of the face into a long spike (user's screenshot; likely face-bone weights on a cut piece). Not
   started in code.
5. From the first session, still open: joint limits give 10-40 deg under load and the shoulder has no cone; bones'
   fracture thresholds table; the chest wall fit (front ribs 0-9 mm under the skin, `chest_depth` in tools/anatomy.py,
   bins rebuilt but unchecked); eyes after an injury never rendered; K hang after heavy damage; shovel/sledge rest pose.

### Shipping
From a checkout of `main`: `npx vite build -c vite.one.config.ts`, check `one/play.html` exists and boots in
tools/rig.mjs, then in a checkout of `gh-pages` replace play.html and build/ with one/'s, sync assets/ from the tree
(index.html stays), commit, push. (Once a build silently skipped when node_modules was
missing and a broken site went out: check every step.) The Blender MCP is set up in .mcp.json at the user's request.

## When done

Update dev/NOTES.md (a section per version), bump the version, commit, and tell the user plainly what was verified
from screenshots or numbers and what was not.
