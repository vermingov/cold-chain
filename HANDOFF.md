# Cold Chain: handoff (2026-11-14)

Read this first, then `dev/NOTES.md` from "## The sandbox, 2026-11-13 (0.8.0)" to the end. The game is only the sandbox.

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
Bump `version` in package.json with every update (shown top left). Current: 0.8.22.

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

## Where the work stands (2026-11-14, end of the cloud session)

Live: https://vermingov.github.io/cold-chain/ (the gh-pages branch, one bundle built with `vite.one.config.ts`) is
`main` at 0.8.22 plus hotfixes up to 3eae4df (marks.ts/film.ts send only the changed tiles of their sheets; resolution
follows the frame rate; F3 quality presets High/Medium/Low; F2 shows render scale and preset). Everything on `main`
was checked from screenshots or numbers before it went out, except what dev/NOTES.md "## 0.8.22" lists as not checked.

`wip/0.8.19` is `main` plus the work below, **none of it verified in the running game**, stopped mid-way at the user's
word. It typechecks. Five jobs were running as agents; each one's state and next step:

### 1. Draw calls and shooting cost (weapons.ts, anatomy.ts, profiler.ts)
The 1055 draw calls the user saw are X-ray (X): the insides are ~224 submeshes a person. Done in wip: spent casings are
one thin-instanced mesh and one Havok body per cartridge kind (40 kept, oldest reused); F2 has a "draw calls by source"
section (each mesh/particle system by name, main and shadow passes apart). Not done: merging the insides' submeshes by
material kind; the first-person arms' CPU cost (29 ms a frame on the user's laptop, spikes to 394 ms); the 1-2 s freeze
on a shotgun shot to the head. The laptop is GPU-bound (165-202 ms waiting on the GPU): ask the user for an F2 shot on
F3 Low with the new render-scale line before going further.

### 2. Bones breaking too easily (bones.ts, thuds.ts)
Done in wip: a wall slam hurts at the speed the part was moving toward the wall before the step (not the contact's
impulse over the part's own mass, which read a pinned forearm at 12-25 m/s and broke every arm on the wall) and as a
broad flat blow ('wall' tool, 2500 mm2). Not done: the before/after table against published fracture thresholds;
its test scripts were in the session scratchpad (gone).

### 3. Joint limits (ragdoll.ts)
Done in wip: ranges set to AAOS 1965 / Norkin & White (table in ragdoll.ts); elbow and knee twist cut to 5 degrees
(any twist there lets the limb bend sideways; the forearm turns at the wrist's joint instead). Measured: back, hip and
knee-past-straight now stop near their limits. Not fixed: limits give 10-40 degrees under muscle-sized torque inside
the lying body (the neck, the wrist's side bend to +-56-76 against 25, the knee sideways), though one joint alone holds
within 3; the shoulder sweeps almost all the way round (three per-axis limits, no cone). Next: find why (mass ratio
across the joint, limit stiffness/damping, solver), a cone-and-twist shoulder; keep the never-NONE motor rule and check
a dead body still settles without jitter.

### 4. Body wall and chest (tools/anatomy.py, assets/anatomy/*.bin, wall.ts, viscera.ts)
Done and live: anatomy rebuilt against the current rig (hand bones inside the fingers). Done in wip: wall.ts (the cut
face of an opening in layers: skin, fat, fascia, muscle), viscera.ts lung collapse and the wrong-lung-side fix
(`x > 0 ? 'R' : 'L'`); research in dev/research/body-wall.md. Found: the front ribs sit 0-9 mm under the skin in buyer,
groundskeeper and old man (hood 31) where a real chest has 25-45 mm; that is why an opened chest shows no flesh. The
fix was started in tools/anatomy.py (`chest_depth`) and the four bins in wip are rebuilt with it, **unchecked**: if the
insides look wrong, take the bins from `main`. Next: a compare that only ribs/sternum/cartilage moved, lit before/after
shots of chest and belly, then the BodyParts3D wall muscles, rib scoring, fracture deformity, blunt dents.

### 5. Blood in the mouth, airways and stomach (new: throat.ts)
The user: blood should fill the mouth, the lungs should fill with blood, and vomited blood should come up the throat and
out of the mouth. Research in dev/research/airway-blood.md. throat.ts (wired into npc.ts, vitals.ts, wounds.ts,
face.ts, behaviour.ts, teeth.ts, bruise.ts) keeps millilitres in the mouth, each lung's airways and the stomach: wounds
fill them; the mouth drains by the head's real orientation (out of the lips face down or on the side, back to the larynx
on the back); awake people swallow, spit and cough airway blood up; unconscious ones breathe it in (vitals `flooded`,
`choked`); past 60 ml in the stomach brings retching and a vomit up the gullet. Nine new ElevenLabs takes (cough-wet,
gurgle, retch, vomit, spit; tools/sfx.py, CREDITS, manifest). **Never run**: the agent was stopped while finishing it.
Next: load the game, shoot a lung, a face, a stomach; screenshots face down and supine; listen to the takes.

### Smaller open items
Eyes are live, but no frame after an eye injury has been rendered (a hang is possible); K after heavy damage can hang
(the warm-up resets the same way); the army crawl makes no progress; the free hand stops short of arm wounds; shovel
and sledgehammer rest pose and the sledgehammer's left hand unseen; the 10/22 sits low; a dark chin smudge; a material
leak on K; Deagle firing/reload frames.

### Shipping
From a checkout of `main`: `npx vite build -c vite.one.config.ts`, check `one/play.html` exists and boots in
tools/rig.mjs, then in a checkout of `gh-pages` replace play.html and build/ with one/'s, sync assets/ from the tree
(index.html stays), commit, push. (Once a build silently skipped when node_modules was
missing and a broken site went out: check every step.) The Blender MCP is set up in .mcp.json at the user's request.

## When done

Update dev/NOTES.md (a section per version), bump the version, commit, and tell the user plainly what was verified
from screenshots or numbers and what was not.
