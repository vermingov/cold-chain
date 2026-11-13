# Cold Chain: handoff to the cloud session (2026-11-13)

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
Bump `version` in package.json with every update (shown top left). Current: 0.8.20.

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

## Where the work stands

0.8.18 (committed, on the user's preview): physics sub-step cap 1/30 s a frame (4 x 1/120), floor blood flow cheaper
and split over two frames, arsenal weapons cast no shadows, ammo HUD no longer forces layout. Details in NOTES "## 0.8.18".

The user then played 0.8.18 and reported a list. Five agents were started on it and then **paused before finishing**
(the session moved here). Only the punch agent had written code; the commit "Sandbox checkpoint, agents paused" holds
it. Resume each job below. They were split so each owns its files; if you run them in parallel keep that split.

### Job 1: organs and belly wounds (no code written yet)
Owns: viscera.ts, wounds.ts, anatomy.ts, dismember.ts, marks.ts (and whatever draws the opened belly).

The user's words: "The exposed organs dont act realistically, they shouldnt just fall out when you shoot, it should be
realistic, and only fall out if the hole is big enough, and also why is it only the intestine, like it should be every
organ inside of the body, that acts realistically." "I saw no blood on the organs after blowing a hole in his stomach
which makes no sense." Later: "the organs falling out shouldnt be scripted, it should be natural."
Their screenshots: (a) after one shot, the small bowel stood up out of a small round hole in the belly as a stiff bundle
of loops pointing into the air; (b) a shotgun hole in the belly: the edges are big flat flaps with a rough glittering,
tinsel-like texture, and the cavity sparkles with white specks ("wtf is this").

To do:
- Evisceration only when the opening is big enough for what is behind it, per real wound ballistics (pistol/rifle
  holes do not let bowel out; a large laceration, a close shotgun blast or a grenade can). Cite the source in a comment
  or dev/research/.
- No scripted spill event. Organs are held by the abdominal wall and their attachments (mesentery, ligaments); they
  come out only because the opening is wide enough and gravity, motion and pressure carry them through. They sag and
  hang, rest on the body or floor, never stand up stiff.
- Every organ, not only the bowel (stomach, liver, colon, the rest as the opening and its place allow): hit, bleed,
  be exposed, come out when the wound really allows.
- Hit or exposed organs get blood on them and bleed.
- Wound edges look like torn skin, fat and muscle, wet with a soft sheen, not flat glittering sheets; no sparkle in
  the cavity (likely specular/normal noise on the wet materials).
- weapons.ts grabs and pulls bowel (`viscera.pick/pull/letGo`): keep that working for whatever comes out.

### Job 2: standing bounce and live severed limbs (no code written yet)
Owns: behaviour.ts, motor.ts, ragdoll.ts (small edits in dismember.ts allowed).

- "The NPC's when standing keep kinda bouncing up and down weirdly." Standing people are active ragdolls: balance and
  posture push on Havok bodies before each sub-step (behaviour.ts beforeStep, motor.ts, ragdoll.ts; sub-stepping in
  sandbox.ts). 0.8.18 capped a frame at 1/30 s (step stays 1/120; slower frames run slow-motion). NOTES record that at
  1/60 steps a standing body once "sagged and sprang on its legs by four centimetres". Find the cause and fix it, not
  by damping into mush and not by a hiding layer; if it is a regression (check whether 0.8.18's cap caused it), fix what
  changed. Measure pelvis and head height over a few seconds standing, at 60 fps and at forced 40 ms frames, before and
  after. They must still stagger, react and fall as before.
- "When dismembering somebody, their dismembered limb still moves for some weird reason, like it doesn't actually
  become a dismembered limb." A severed piece must be dead weight: no motor, balance, posture, behaviour, reaching or
  guarding acts on it; its inner joints go limp with only passive tissue stiffness; it is not counted in balance (done
  in 0.8.17, verify). Find what still drives it and fix it at the cause. Show it: sever an arm and a leg on a standing
  person, log the piece's joint motion and the forces on it, screenshots.

### Job 3: reset crash and the dark smudge (no code written yet)
Owns: sandbox.ts's K handler and every dispose() path (npc.ts dispose() and all the parts).

- Crash after K (reset) on the preview build after heavy damage. Black screen with:
  `_cacheMatrix@.../uniformBuffer-*.js` `_updateMatrixForUniform@.../uniformBuffer-*.js` `ee@.../materialHelper.functions-*.js`
  Something still drawn refers to a disposed node/matrix: a severed limb, bowel, a knife stuck in a body, shards, teeth,
  blood runs, soak/film/bruise meshes, a decal on a bone, a skeleton, a shadow-caster list entry. Reproduce (damage of
  every kind, K, play, K again; the preview is a minified production build, so also try `npx vite build --outDir
  /tmp/x` + `npx vite preview`). Fix the root cause so a reset leaves nothing pointing at the old people (world lists,
  sound, physics). Count scene meshes, materials, textures and physics bodies over several K presses: no leak.
- "This weird dark spot appears sometimes": a standing man seen from above/front has a soft blurry dark grey-brown
  patch over the chin, lower face and front of the neck; the rest lit normally; not blood-coloured. Candidates: bruise
  drawn in the wrong place, shadow-map artefact, film.ts, soak.ts, hider.ts windows, face AO, a wound mark. Fix the
  cause; if it is a true chin shadow from an overhead lamp, show it rather than hide it.
- Also give the new bandage/medkit parts (job 5) disposal reached by npc.dispose() and K.

### Job 4: punch animation and bruising (STARTED: code in the checkpoint commit, never seen working)
Owns: the punch in weapons.ts (`_punch`), the player's first-person arm, bruise.ts.

- "Punching should have a first person animation." Started: `src/sandbox/fist.ts` (the player's right arm from
  table/arm.ts, a `fist` hold added to `HOLDS` in src/table/arm.ts; the knuckles move along DOWN -> COCKED -> target or
  MISS in the eye's frame at up to 7 m/s, sinking 2 cm into what it lands on, then recoil) and weapons.ts wiring
  (+42/-13 lines). It typechecks; nobody has seen it run. Finish it: the hit and the animation must agree in time and
  place; telegraphed untrained-man mechanics (dev/research/blunt-trauma.md); judge from a frame-by-frame screenshot
  series. Motion is ultimately the user's call.
- "Bruising turns almost black quite fast when repeatedly punching the same spot": after a few punches to the mouth
  the whole lower face was a near-black smear. Real fresh bruising is red, then purple-red and swollen; dark
  blue-purple over hours; never near black from a few punches. Make colour build with dose and time and saturate at a
  realistic darkest colour. Check after 1, 5, 15, 40 punches to one spot.
- "The bruising needs to happen naturally, not right when you punch, same with the swelling." Nothing shows at the
  instant of the blow: redness within seconds (erythema), swelling over minutes (fluid leaking into tissue), the
  contusion colour as blood seeps out of damaged vessels over minutes to hours. Keep the real time course (sped up
  only if the code already has a game time scale; say what you chose). Timed screenshots after one hit: 0 s, 5 s,
  30 s, 2 min.

### Job 5: bandage and medkit (no code written yet)
New files; small, additive edits in weapons.ts (items, slots), arsenal.ts, hud.ts, wounds.ts/marks.ts/vitals.ts hooks.

"Add a medkit and a bandage item where you can bandage their wounds naturally, same with the medkit that just
bandages all wounds."
- Bandage: hung on the arsenal board, taken into a slot like a weapon. Look at a wound, hold the button: a few seconds
  shown in first person, then a visible dressing (gauze/wrap) sits on the skin at the wound, follows the ragdoll, is
  stained by blood soaking through, and lowers that wound's bleeding as pressure and a dressing really do: venous and
  capillary mostly stop, arterial and organ bleeding slow but don't stop.
- Medkit: used on a person, dresses all their open wounds in turn (timed, not instant), same per-wound result.
- Coherent with soak, runs, the hider, a dressed wound hit again, a dressed limb severed; disposed on npc dispose/K.
- Model from a CC0/CC-BY source (credit it) or built in code. If a sound is needed, list it; don't make one.
- Show bleed rate before/after in numbers, screenshots close and at play distance.

### Job 6, after 1-5: performance under heavy carnage
"The game is still quite laggy when you start stabbing shooting etc a lot of people in many places, the blood,
dismemberment, and gore/flesh system etc needs to be more optimized." Measure on a quiet machine (the 0.8.18
measurements were spoiled by other load) with many people hurt in many places. Known costs from the 0.8.18 pass:
render 8-10 ms (per-draw material and light binding for 8 lights, three shadow passes, main-thread JS), physics
2.2-3 ms for 2 steps (85% inside Havok), floor blood ~1.8 ms, soak ~1.7 ms (fixed work per second, up to 1200 cubes a
person every 1/8 s), runs ~0.7 ms. Things kept on purpose: the sync after each sub-step (balance reads positions),
solver settings and self-collision, the look of lights/materials/shadows. Optimise without changing how it looks or
behaves.

### Smaller open items from NOTES
A severed head that lands gets skull-fracture entries (bones.ts); splits look like incisions; when one arm is shot
the other hand stops 30-40 cm short of the wound (meets the belly or runs out of shoulder reach).

## When done

Update dev/NOTES.md (a section per version), bump the version, commit, and tell the user plainly what was verified
from screenshots or numbers and what was not.
