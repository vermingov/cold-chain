# Cold Chain: handoff (2026-11-15)

Read this first, then `dev/NOTES.md` from "## The sandbox, 2026-11-13 (0.8.0)" to the end. The game is only the sandbox.

## The Bevy port: where it stands (2026-11-16, end of the third cloud session; read before the rest)

The game is being ported to Bevy (the user's word, 2026-11-15); the Babylon game below is the reference until the port
is done. Branch `bevy-port` (f7ecdd1) has phases 1-4 merged: everything the TS game does, the phase-4 parity passes of
the body/medicine, the look and performance, and the AppImage build. `dev/PORT.md` is the plan and every job's notes;
`dev/BACKLOG.md` the user's post-port list and the order they gave.

The user and a friend play-test the Linux AppImage (build: PORT.md "Performance and release builds"; no Windows build
for now, the user's word). Their reports after the second AppImage, not yet done:
- **Audio is "extremely laggy"** though the frame rate is fine. Likely cpal's `BufferSize::Default` on ALSA through
  PipeWire/Pulse (sound.rs ~654-663 makes the manager with default backend settings): set a small fixed buffer with a
  fallback, log the buffer and latency at start, check nothing else delays a sound (loading per play, a frame's lag).
- **"The NPCs are a bit too excessive with the screaming"**: count voice starts per person per minute against the TS
  first (a bug in sound.rs `hurts`, where a new cry now cuts the old one, could restart cries), then make it realistic
  (screams for a big new injury, then moans and breathing, a cooldown, fewer voices at once). The unconscious and dead
  stay silent (the `voices` scenario).
- **An Escape menu**: pause, Resume / Settings / Quit; master, effects and voice volume, graphics (the F3 presets,
  scale, VSync, window mode, FOV), mouse sensitivity; saved where graphics.rs keeps the F3 preset.

Open from phase 4:
- **Dead bodies buzz** (0.31 against the TS's 0.10; it came in with the phase-3 merges) and **dragging hardly moves
  the person** (the held hand stays ~0.5 m off; the arm's muscles out-hold the pull in Rapier). Branch `port/body-fix`
  (962af3c) has an unbuilt, unmeasured fix for the buzz in ragdoll.rs `ranges` (Rapier's per-axis angle differs from
  the arcsine the limits used, for a turn about two axes) and tools/port-drag.mjs; the drag is not started.
- The grenade's frame is still ~84 ms (weapons.rs `explode`: a surface test and pierce per fragment; Rapier).
- Then: delete the Babylon game from `bevy-port` only (PORT.md "Order of work" 4), then BACKLOG item 7 (what the TS
  left unfinished). Items 1-6 wait for the user.

## What it is

A realistic ragdoll / vitals / blood sandbox in first person, Babylon.js 9.27.1 + Havok, TypeScript 7 built with Vite 8.
Played at `play.html`; code in `src/sandbox/`. The old grave-robbing story and the table were removed in 0.8.19 (git
history has them); only `src/table/arm.ts` stays, as the player's first-person arm.
You walk a hall with four people (MakeHuman bodies with real anatomy: organs, bones, layers of skin/fat/muscle), take
weapons off an arsenal board (pistol, knife, sword, bat, AK, M4, shotgun, rifle, grenade, things to throw, fists) and
hurt them: wounds, bleeding, blood on floor/clothes, fractures, dismemberment, evisceration, bruising, vitals.
Keys: N spawns a person where you look, X shows insides, K clears the room and lines up new people (reset).

## Run it

```
npm install
npx vite                 # dev on 127.0.0.1:8669; hmr is off on purpose: reload the page after edits
npm run check            # tsc --noEmit, must stay clean
npm run build            # dist/; node server.js serves dist/ + assets from the tree
```
`tools/rig.mjs` drives headless Chromium over DevTools (read its header; `RIG_GPU=1` for real frame times). Every change
is judged from screenshots taken with it. `window.__sandbox` (play.html) is the sandbox, reachable from the rig.
Bump `version` in package.json with every update (shown top left). Current: 0.8.25.

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
- Babylon.js stays (never three.js).
- Regressions: "it worked before" means find what changed and fix that; no workaround layers.
- Don't guess API/function names; check the Babylon/Havok docs or source.
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
