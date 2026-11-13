# Cold Chain: working notes

Read `../DESIGN.md` first: what the game is, the story, the bar, the build
order. This file is where the work stands.

## Where things are

- Tree: `~/cold-chain`, under git (local only). TypeScript 7.0.2 built with
  Vite 8.3.5; Babylon.js 9.27.1 and Havok from npm (`npm install`). Develop
  with `npx vite` (127.0.0.1:8669); `npm run build` type-checks and writes
  `dist/`; `node server.js` (PORT, HOST) serves `dist/` first and the assets
  from the tree. `npx tsc --noEmit` must stay clean. The version in
  `package.json` is shown top left: bump it with every update.
- Sources fetched to `~/.cache/cold-chain/` and not in the tree:
  `makehuman/` (sparse clone of makehumancommunity/makehuman: base mesh,
  rig, targets, the eyeballs), `base/` (mirror of
  download.tuxfamily.org/makehuman/assets/1.2/base: skins, clothes, hair,
  eyes, brows, lashes, teeth; the GitHub assets repository no longer
  exists), `bp3d/` (BodyParts3D anatomical models, CC BY 4.0, credit line in
  DESIGN's sources when used).
- Preview on the tailnet: `http://100.112.58.71:8670/`, user unit
  `cold-chain` (started by hand 2026-11-11 at the user's word, not enabled
  at boot). It serves the tree as it is: no restart needed after edits.
- Six Six S1x is untouched: v2 on tailnet :666, v3 preview on
  100.112.58.71:8668.

## Done

- `tools/people.py`: builds a person from MakeHuman: macro targets, skin
  texture, real eyes, brows, lashes, teeth, tongue, hair and clothes fitted
  as proxies (.mhclo), skin under clothes kept as its own part.
  `uv run --with numpy --with pillow tools/people.py
  ~/.cache/cold-chain/makehuman/makehuman/data ~/.cache/cold-chain/base`
- `src/person.js`: loads them, the procedural pose engine from Six Six S1x,
  `dress(on)`, `dead` (a body's colours), `bald`, and `ground: 'skin'` which
  lays a body down on its own lowest skin (the joints are no guide for a
  body on its back: the first try floated 14 cm over the table).
- `dev/people.html?view=table|face|side|top|line`: a body on a table under
  a lamp, two people standing.

## The yard (the map), 2026-11-10

Asked for as "start working on the map". St Dymphna's municipal cemetery,
112 x 132 m, built from one plan.

- `src/map/plan.js`: the facts. Wall and gates, paths, buildings, six
  sections (A/B old ground, C/D lawns, E public graves, F meadow), 1668
  plots with addresses (section-row-number), trees, `heightAt`. No engine in
  it; `node tools/plan.mjs` draws it flat to `dev/plan.svg`.
- `src/yard/`: `ground.js` (one sheet, six scans blended by a mask painted
  from the plan plus noise), `stones.js` (thin-instanced headstones by era,
  mounds, markers), `trees.js` (bare trees grown from a seed), `built.js`
  (wall, chapel of rest, lodge, store, lych gate: `opening()` for doors and
  windows, `pitched()`/`verges()`/`gutters()` for roofs), `outlines.js`
  (shapes shared by stones and openings), `night.js` (sky, mist, moon and
  its shadows), `torch.js` (the player's light), `yard.js` (puts it
  together, furniture, the three fixed lamps).
- `src/map/register.js`: the burial register, who lies in every taken plot
  (name, born, died), made from a seed to suit each ground. The stones are
  lettered from it; the order sheet and the body checks should read it too.
- `src/yard/inscriptions.js`: every stone's name and every public marker's
  row and number painted into one 4096 sheet (one byte a pixel), and the
  `Inscribed` plugin that lays a stone's square on its face. Fonts: IM Fell
  for the old ground, Cinzel (OFL, `vendor/fonts/cinzel-medium.woff2`) for
  the rest.
- `src/yard/grass.js`: 13,000 tufts of real blades in a 36 m square that
  the vertex shader tiles over the world and draws round the eye; height
  from the ground's mask (none on paths, short where mown). `HEIGHT_GLSL`
  in plan.js is `heightAt` again for shaders: change both.
- `torch.js` closes the eye on close things: `torch.update(yard.reach(...))`
  turns the beam down as what is in it comes near, so a stone a metre away
  can be read instead of being a white blank.
- `src/player.js` + `src/solids.js`: walking (W A S D, Shift runs on a
  breath that runs out, Ctrl or C gets down), head bob, and collision
  against rounds and rectangles kept in a grid. A place hands the player
  its `footing`: `{ ground, solids, limits, underfoot }`; the yard's is
  `yard.footing`. `player.onStep(surface, weight)` fires on each footfall
  with 'tarmac' | 'gravel' | 'mud' | 'grass' from `plan.underfoot`, ready
  for the foley. `~/.cache/cold-chain/walk.mjs <view> <shot> KeyW,8 ...`
  holds keys down and prints where the player ends up.
- `src/picture.js`: the grade (ACES, bloom, grain, vignette) and the note
  on why exposure is 1.9.
- `src/noise.js` + the `Mottle` plugin in `surfaces.js`: every surface's
  colour drifts in the world, which is what stops scans reading as tiles.
- `dev/yard.html?view=gate|avenue|old|lawn|public|meadow|chapel|front|side|
  cold|lodge|back|high` and `&day=1` (flat daylight for judging materials,
  `&torch=0`). W A S D and the mouse walk it.
- Shots: `~/.cache/cold-chain/yardshot.mjs <view>[+day=1] ...` with the dev
  server on 8669 and `RIG_GPU=1 TMPDIR=~/.cache/cold-chain/tmp`; prints fps
  and GPU milliseconds a frame. `probe.mjs <view> <shot> <expr>...` runs
  expressions in the page first. Both live in the cache, not the tree.
- Measured on the 680M: 7 to 10 ms of GPU a frame at 1600x900 with 1.1 M
  triangles in view; 68 to 94 frames a second at 1920x1080 with the cap off
  (`RIG_UNCAP=1 SHOT_W=1920 SHOT_H=1080`), taken while the machine was busy
  with other builds (load 12), so the floor is likely higher. The gate view
  is the slowest. `~/.cache/cold-chain/perf.mjs` switches parts off in turn
  but under that load told nothing.

Learned the hard way:

- The engine's ACES curve crushes everything dim to black. A night that is
  only moonlight reads as a black screen until exposure is about 1.9 and
  the lamps are scaled down to suit. `scene.fogColor` is taken as a seen
  colour, not as light: 0.04 is black.
- A light's projection texture shapes its diffuse light only. Highlights
  ignore it, so a torch whose shape is all in the texture throws a
  hard-edged disc of shine on near ground. The cone's own inner/outer fade
  has to do the shaping and the texture only adds the hot spot.
- A sky painted on a DynamicTexture is read by the dome from the bottom up,
  and round the other way from what the first guess says: check where the
  moon is with a shot before trusting the arithmetic.
- `Buf.extrude` caps were wound for a right-handed world; every headstone's
  face was black until that was turned.
- Poly Haven scans with courses or joints in them (mossy_sandstone,
  granite_tile, marble_01) cannot be headstones: a slab is one piece.
  withered_grass reads as sand. `~/.cache/cold-chain/browse/` has the
  catalogue and thumbnails for choosing by eye.
- Sixteen samplers is the promise; the ground uses fifteen.

Not done in the yard: numbers on the meadow's posts and row markers to count by, ivy and litter,
flowers on the new graves, digging, the sexton, sound. Every light is in
every material (eight of them): the three fixed lamps want keeping to the
meshes near them.

## The table (the cutting), 2026-11-11

Asked for as "realistic cutting, like the user should have to actually
remove the organs with a scalpel". First working version, in `src/table/`.

- `field.js`: the trunk seen from above, collarbones to pubis. Height,
  facing, place on the skin's picture and the body's broad lie (`lean`),
  taken once from the skinned mesh at 2 mm; the scalpel's point is where the
  mouse's ray meets it. Owns the tissue and the blade and tells them about
  the body: its edge (`EDGE`), the ribs (`RIBS`), how tight it is (`TIGHT`).
- The cutting is a simulation since 2026-11-11 (fourth version in two
  days; the three before drew a wound and each broke as soon as somebody
  scribbled). No Babylon in the first three files: they run in node.
  - `lattice.js`: the net, places 4 mm apart with six neighbours each.
  - `tissue.js`: two sheets of it under tension, skin (with its fat) and
    deep (white sheet, muscle, lining). Threads shorter than the gaps they
    span, skin tied to deep by loose tissue, deep held only by its edges
    and by bone over the ribs. A cut parts a thread between two triangles,
    partly (a bridge is left) or wholly, and the sheets come to rest by
    themselves: a lens for one cut, corners drawn back where two cross, an
    island for a ring. Flesh stiffens past 30% stretch. Only what is astir
    is worked on. `grab`/`drag` are a hand, pulling as hard as a hand can.
  - `blade.js`: a stroke. The net is brought to the blade (places moved
    onto its line, the thread back cut), so the lip is the line drawn. A
    stroke in an old cut deepens it; depth is of the whole wall, the skin
    taking the first 37.5%.
  - `flesh.js`: the sheets as meshes laid on the body (moved on the CPU
    when the tissue moves) and the cut faces hanging from every lip: skin,
    fat, white sheet, muscle off the midline, lining; a V where the cut is
    not through.
  - `hidden.js`: the body's own skin and lining are not drawn where the
    tissue is. `lining.js`: the inside of the rest of the trunk.
  - `~/.cache/cold-chain/tissuetest.mjs <name> '<script>'` cuts a flat
    belly in node and draws it from above (stroke, hand, settle, gape).
- `scalpel.js`: the mouse is the hand. Depth by pace: `PRESS` (0.1 m/s
  parts the skin, 0.05 goes through fat, 0.025 nearly through; a second
  pass adds to the first), a standing blade sinks slowly, slowing at the
  end of a stroke is not punished (`PACE`).
- `organs.js` + `tools/organs.py`: 24 organs of the belly from BodyParts3D,
  thinned and fitted into the body (`assets/organs/oldman.bin`, 84k
  triangles): `uv run --with numpy tools/organs.py ~/.cache/cold-chain/bp3d
  assets/people/oldman.bin assets/organs/oldman.bin`. Each organ is its own
  mesh, coloured by kind. The files' own header says CC BY-SA 2.1 Japan
  (not CC BY 4.0 as first noted): credit line is in the tool and the file.
- `inside.js`: what a ray meets once the wall is held open (`field.wide`),
  what holds each organ (`HELD`: the bowel gives 26 cm, a kidney 2 until
  its artery, vein and ureter are cut, then it is free; dragged 6 cm past
  that while held, it tears), and `under()`, which marks whatever lies
  below a skin cut that went too deep.
- `hand.js` + `hands.js`: key 1 scalpel, key 2 bare hand. The hand pulls a
  wound open by its lip (`field.grab` and `drag`: the whole wall where it
  is through, only skin where it is not) and takes hold of organs.
- `arm.js`: the right arm of whoever is cutting, a person's arm on a
  person's bones in a sleeve and a nitrile glove, solved from the scalpel's
  grip back to a shoulder beside the eye. The arm says which way the handle
  lies (`slack`: where a slack wrist would have it), not the stroke: when
  the scalpel turned to follow every stroke the wrist was asked for 150
  degrees and the hand flipped about. The fingers' pose (`HOLDS.pen`) is a
  first guess. No left arm yet. `?view=work` is an eye an arm's length off.
- `finder.js`: a tree of boxes over an organ's triangles, so a ray into the
  belly costs microseconds (the engine's pick was a millisecond, twice a
  frame).
- Sound (2026-11-11, asked for as "high quality ... dynamic and actually
  match whats happening", no synthesis). `src/sound.js` plays recordings by
  their bursts: a `stream` runs through the sounding parts of its takes for
  as long and as loud as it is driven, each length faded into the next
  exactly where the last left off, and a `shot` plays one burst.
  `src/table/foley.js` drives them from what the scalpel, the hand and the
  tissue are doing this frame (blade: what its point is in and how fast it
  is drawn; wet: how fast tissue or an organ is moving; once: vessel cut,
  hand takes hold, organ laid down). `tools/sounds.py` makes
  `assets/sounds/*.flac` + `manifest.json` + `CREDITS.md` from Freesound
  originals in `~/.cache/cold-chain/sounds/<id>/` (43 fetched, 20 used;
  `SOURCES.md` there has them all with licences). Nobody had heard any of it
  when this was written: `~/.cache/cold-chain/listen.mjs` records a played
  session to `shots/table/listen.wav` and draws it, which shows that sound
  follows action and nothing about whether it sounds right. Missing for
  want of a recording: the wall giving, a blade on real bone, steel put
  down. The cutting takes were made on kitchen boards and are cut off below
  180 Hz to lose the knock.
  The user's verdict on that first set: "sounds like a cutting board and
  paper, some of them are alright". So: only the wet takes are in the game
  now (a sound with no recording is silent, `sound.has`), a second round
  of candidates was fetched for sound and not for what they literally are
  (`SOURCES2.md`), and all of them are on `dev/listen.html`
  (`tools/audition.py` makes `assets/audition/`), where each is marked No /
  Maybe / Yes into `dev/verdicts.json`. `tools/sounds.py` is to be written
  from that and nothing else.
- 2026-11-11 later, from a screenshot of hard play: one hand holds at a
  time and what it lets go of goes back (many old pulls made lobed holes);
  skin slides 12 mm on what is under it and then holds (`GIVE`), a cut
  that is not through opens no wider than it is deep; a triangle that
  would be turned over is put back; nothing inside comes up through wall
  that is not open over it (`Inside._keepUnder`). `~/.cache/cold-chain/
  abuse.mjs` plays carelessly and counts turned-over triangles.
- Organs: vessels and ureters are paths drawn as tubes (`Tube.sever`), a
  blade leaves a ribbon on what it touches (`Organ.nick`).
- `index.html`: a front page with the two rooms on it, for showing.
- `dev/table.html?view=work|close|near|low|top` (`&skin=0` shows the
  inside). `~/.cache/cold-chain/realmouse.mjs` plays it with real mouse and
  key events (`rig.drag`), `open.sh <view> <shot> [expr...]` opens the belly
  first. `__table.draw([[u, v], ...], seconds)` draws the blade for the
  rig; `~/.cache/cold-chain/tableshot.mjs <view> <shot> <expr>...`.

Learned:

- Every way of drawing a wound (a picture of it, loose points, lines with
  walls built along them) came apart the moment a person cut freely:
  crossings, rings, scribbles. Tissue under tension that is actually cut
  has no special cases, and the eye shape, the gape by depth and the
  corners all fall out of it.
- A lip made of a grid's corners is a saw unless the corners are put on the
  blade's line first.
- `Math.hypot` and closures in the solver's inner loop cost three times
  what the arithmetic does. A plugin's `getCustomCode` runs inside
  `super()`: nothing set after it is there yet.
- One number that is not a number, eased toward every frame, is there for
  good: the scalpel and the arm vanished for the rest of the session the
  first time the pointer crossed the trunk's edge, where the old
  `field.normal` took a slope off the end of the heights. The cutting went
  on working, which is how it was noticed. `~/.cache/cold-chain/sweep.mjs`
  drags the mouse over the whole picture and says whether they survived.
- What made the hand "buggy": the orientation it was asked for, not the
  solver. And what made everything stutter was allocation in things done
  every frame (arrays per cut face, a new mesh per nick, the index buffer
  made again per cut) and the engine's ray pick. `~/.cache/cold-chain/
  frames.mjs` says where a frame's time goes while cutting, `steady.mjs`
  how far the hand jumps between frames, `armstrip.mjs` shows the arm at
  six spots.
- Explicit normals on a two-sided material are turned over for triangles
  wound the other way: wind cut faces all alike or they are black.
- The engine's shader preprocessor cuts lines at semicolons, in comments
  too: none in a GLSL comment.
- The lamp's shadows black out the inside of a cut a millimetre wide (the
  normal bias is a centimetre): the walls take no shadows.
- Displace along the body's broad lie (`lean`), never the skin's own
  normal: over the navel that points everywhere.
- The lamp's shadow pass does not run the wound's discard, so everything
  under the skin was in the skin's shadow: flesh and organs take no
  shadows for now. A `ShadowDepthWrapper` on the skin's material might fix
  it properly.
- Sheets that are only drawn where they show leave gaps a slanted eye sees
  the table through; they have to be drawn under the whole wound.
- MakeHuman's hip joints are 23 cm apart, a real pelvis's 16: fit organs by
  the flanks and the belly's depth, not by the rig.
- In a mirrored (left-handed) frame take normals before turning the
  triangles over, or everything is lit from inside.
- Speed-as-pressure turns every pause into a stab unless a standing blade
  is handled apart from a moving one. And speed has to be taken over a
  tenth of a second, not a frame: a real mouse moves in whole pixels.
- The scripted hand (`draw`) and a real mouse do not give the same depth
  for the same nominal seconds; `PRESS` wants tuning by a person.
- Several edits in one script: check them all before writing any
  (`~/.cache/cold-chain/bin/ed.py`). Half-applied edits cost an hour here.
- The tissue has to come to rest, or the wet sound never stops and every
  frame is spent on it. Three things kept it from resting, all found by
  `~/.cache/cold-chain/driven.mjs` (what each stream of sound is driven at
  during and after each thing done) and `pulls.sh` (every pull on a flat
  belly, and whether it rests): threads that push back when shortened
  buckle in the plane, so flesh pushes back by the room its triangles take
  instead (`SQUASH`); anything that stiffens at a stroke is thrown back and
  forth across the stroke, so stiffening comes on over a band (`eases`);
  and a point carried on into flesh that has stopped giving bounces off
  harder than it came, so there it stops when the pull turns against it.
  More hold on a point is not more stable: it made things worse.
- `tissue.went` is how far the furthest point got in the frame, not how far
  it travelled: a few points still shiver now and then (seen on a piece
  carried off), and that must not be heard.
- A sound for something that goes on happening (the wall giving stretch by
  stretch under the blade) is made once, when it starts: made per stretch
  it was 27 in one stroke.
- Flesh tears only from the end of a cut, only while a hand is pulling, by
  how far the two sides of the next stretch are drawn apart (`TEAR`,
  `tissue.apart`). Measured by the most stretched thread it tore beside
  the hand instead, and a wound tore itself longer while being cut.
  `~/.cache/cold-chain/tears.mjs` says what tore and of which kind;
  `square.mjs` cuts a piece out with the mouse and carries it off.
- Where the blade cuts and where it is drawn must be the same spot. The
  cut goes at the field's [u, v] where the mouse's ray meets the skin, and
  flesh.js draws everything under that spot straight down from it (along
  `lean`); the point was drawn on down the mouse's ray instead, about a
  centimetre off on the slanted work view once it was in. Now it goes
  straight down too. Picking through the wound to whatever is seen at the
  bottom was tried: it lands on the far wall of a narrow wound, and the
  second stroke cut the muscle beside the first (jagged teeth). Measure
  with `~/.cache/cold-chain/aim2.mjs` and `midstroke.mjs`.
- A blade within a few millimetres of a cut that is through counted as in
  that wound, so it cut the layer under skin that was still there, and a
  strand of skin between two wounds could not be cut at all. Now only a
  cut that is not through takes a blade from that far (it drops into the
  groove); one that is through takes it only from just past its lips
  (`LINE.falls`). A stroke begun on a lip starts from the wound, and one
  that crosses whole skin into a cut joins it.
- The flesh is tuned to dev/research/tissue-mechanics.md (sources for
  every number; most gape and cutting figures are derived or estimated,
  and it says which). Gape of a 10 cm cut, measured with
  `~/.cache/cold-chain/gape.mjs`: skin down the belly 8 mm (target 6-10),
  across 4.4 (2-4); deep layer 4 lateral (1-3), 2 across. The wall is half
  skin-and-fat now, and a blade goes through it layer by layer at each
  layer's own toughness (`LAYERS`, `BITES` in blade.js): a crawling stroke
  goes into the muscle, a firm one through skin and a quarter of the fat,
  a quick one scores the skin. Opening the belly takes two slow strokes.
  `tissuetest.mjs`/`pulls.sh` still press as if one stroke went through the
  whole wall, so their numbers are not comparable any more.
- The blade is an edge: all of it that is in the flesh cuts (`_edge`), and
  only along itself. Drawn sideways it swings round like a caster
  (`_swing`), and deeper in it stands up so the fingers stay off the skin.
  The arms swing their elbow round to keep out of the body, the table and
  the eye (`Arm._swing`, `clear` in table.html). The handle rests on the
  web of the thumb, `WEB` off the bones.
- A stroke's pace has to come from the stroke alone: the trail of where
  the blade had been included the mouse's dash to where it went in, so the
  first half second of a stroke started after a quick move only scratched
  (`strokes.mjs`: 7 of 8 cut, 1-7 mm; after, 8 of 8, ~13 mm).
- Skin's tension is all in the dermis (`bears` in tissue.js): cut through
  that and the lips spring apart over the fat. Before, a cut had to go
  through the fat too before it would open, and cut skin looked uncut.
- The hand used to keep hold after the mouse was let go (a stand-in for a
  retractor). Skin cut inside that held patch was pinned on both sides and
  could not open, so only the layer under it seemed to be cut. Letting go
  of the mouse now lets go of the skin.
- A piece that nothing holds any more (`Tissue.freed`: cut right round in
  every sheet it is tied to, or peeled free) comes away in the hand as a
  rigid slab (piece.js), falls where it is let go and lands on the body,
  the table or the floor. `lift.mjs` cuts one out and drops it.
- The mouse is held by the page after the first click (pointer lock in
  hands.js); the rig still drives it by position, unheld.
- The net is triangles 5 mm across, so the edge of a cut or tear runs
  corner to corner: drawn raw it is a row of teeth, and a triangle left
  jutting into a wound is a spike. Edges are drawn smoothed
  (`Sheet._drawnAt`, `LIP` in flesh.js); the physics is not. Skin moved
  over other skin is drawn lying on it (`Tissue.overlaps`), not through it;
  nothing pushes the two apart. `flap.mjs` lays a flap back to look.
- The handle stays on the hand's side of the blade (`SIDE` in scalpel.js),
  and the elbow goes wherever leaves the wrist straightest among places
  clear of the body, table and eye, easing there (`Arm._swing`). Only the
  gloved hands are drawn now, cuffed a little way up the wrist: the owner
  asked for no arms (the arms were still placed, and in the way).
- The wheel raises and lowers what the hand carries (a piece, an organ).
- A cut made with the mouse ends where the blade was when it lifted, short
  of the pointer: four strokes that meet at their corners leave a tag at
  each. The rig has to draw every side past its corners; a person sees it.

Not done on the table: taking a kidney right out has not been played
through (cut its three tubes, lift it, put it down: the parts exist, the
opening and the colon still hide the kidneys, and cut stubs do not follow
the kidney); no clamps; no fat round the kidney; the tissue is flat on the
body, so a flap cannot be lifted or laid back, and a piece cut right out
and carried off slides over the belly and is not drawn where it ends up;
what a hand has pulled stays where it had come to when the hand let go (a
stand-in for a retractor); a rip has the same clean walls as a cut; a few
points of a carried piece can go on shivering (silent, but turns are
spent on it); the blade's point rides the skin's old
surface even over an open wound; the bowel moves as one stiff piece and
goes through the wall; no chest (shears, plate); no left arm, and the right
hand's fingers are a first guess; the room is a stand-in; corneas; grading,
bagging, the order sheet. Lungs, heart and diaphragm are not in the organ
set. A whole-belly turn of the tissue is about 3 ms on this machine, two a
frame: if that shows as stutter it wants a worker.

## The game: night one, 2026-11-12

Asked for as "start working on the actual gameplay of the game, as well as
the story". `play.html` at the root is the game; the dev pages stay as they
were (dev/table.html now builds its table with `src/table/room.js`, which
the game shares).

- `src/game/story.js`: everything said, written or found, all five nights:
  the answering machine, the Registrar's calls, the orders (plot, who, what
  is wanted, what to check, with the verb and what is seen), the buyers'
  lines by grade, the morning messages, the endings, `PRICES`, `OWED`.
  Story burials are put in the ground by `burials(night)`: their plots
  (E-7-10, F-6-5, E-4-14, F-8-9, all empty in the plan) get a fresh mound
  and a marker and the register says who is in them. Nobody is voiced: lines
  are shown timed to speech, Space hurries them. Nights two to five are
  written and not playable.
- `src/game/game.js`: the night as places in turn on one engine (flat,
  yard, the table visited from the yard and the yard kept meanwhile, flat
  in the morning), each change in the dark with a card. `run.js` is what
  carries over (money, owed, saved to localStorage); `job.js` is the
  night's steps and the clipboard's page.
- `screen.js` (words, cards, fades, the dot and verb in the middle),
  `things.js` (whatever is looked at and in reach has a verb; E does it),
  `clipboard.js` (Tab: a pad in pencil, drawn after everything so it never
  goes into a wall, lit by itself).
- `flat.js`: one room, the machine blinking, the phone, the door. Furniture
  is Poly Haven (sofa_02, Television_01, dining_chair_02, drawer_cabinet,
  kettle, light socket, box: added to tools/props.mjs; medical_box and
  metal_toolbox fetched for the cold room and not used yet).
- `src/game/yard/`: `place.js` sets out the night in the cemetery: kit at the
  store (spade and bar against its east wall, the bier on the path), the
  grave, the sexton, the van. `grave.js`: hold the button over the grave to
  dig (46 spadefuls to the lid, a metre down), the ground and grass leave a
  hole there (`HOLE` in yard/ground.js, both shaders), the mound goes
  (`flatten`, the mounds' instance buffer is no longer static), clay sides,
  spoil heaped north, coffin, lid broken with the bar in three heaves, the
  man in it. The hole is solid once cut, so you stand at its edge and can
  see in; from 1.5 m back you see the far wall and not the bottom, as in
  life. `held.js`: the spade or bar is put in the world between the hands
  and the hole each stroke (hung off the eye it was out of view and the
  torch blew it white). `bier.js`: pushed ahead, turns with you, stops at
  what it runs into and holds you back, carries the body. `sexton.js`: on
  night one he hears the twelfth spadeful, walks up from the lodge with a
  torch, stands at the chapel corner shining it on you for 16 s, goes back.
  `gate.js`: van nose to the service gate, lamps on, the buyer at the bars.
  The service gate now has two shut leaves (yard.js).
- `src/game/table.js`: the cold room is the table room; a trolley across the
  table with a cooler on it. An organ let go of over it goes in, graded:
  torn = reject, no blade marks = sound, one or two = marginal, more =
  reject. E steps back from the table.
- The torch closes down on people in its beam too (the buyer was a white
  glow at 2.5 m).
- `src/table/retractor.js` (key 3): hook a lip, draw it back, let go and it
  stays (`Tissue.pins`, held as a hand holds); hook it again to take it out.
  A midline cut takes three slow strokes (22 s each over 33 cm) to go
  through the wall; with three pairs of retractors pulled 11 cm the belly is
  held 7 to 9 cm open and the bowel shows. Two at 14 s only went through
  skin and fat.

Tested in the rig (`~/.cache/cold-chain/play.mjs`, `yardplay.mjs` jumps to
the yard, `kidney3.mjs`/`kidney4.mjs` open the belly): the whole night runs
from the title to the last card with no errors, money carries over.

Learned:

- `rig.until` on an expression that is a promise waits for the promise.
- /tmp is RAM and was full of other sessions' files: heredocs fail silently
  there (an edit made through one did not land). Edits by the editor tool,
  output to a file in the cache.
- A tool that is pressed every frame (the rig's `draw`) must act on the
  press, not on the button being down: the retractor grabbed afresh every
  frame and pinned skin at the end of the drag, away from the lip.

2026-11-12, later, from the owner: "the room looks like shit, the window is
painfully obviously fake, there is no door, and there is no sound in the game
at all".

- The flat is rebuilt (`flat.js`, `street.js`): Poly Haven wallpaper,
  carpet, plaster ceiling and table wood (tools/surfaces.sh), walls a wall's
  thickness with the window in a reveal, a sash window with glazing bars,
  glass and curtains, a radiator, picture rail and skirting, a panelled door
  with a knob that swings open when you go out, a bare bulb on a flex. Out of
  the window is a real street a floor down: pavements, kerbs, the road, a
  brick terrace with a slate roof and a lit window or two, and a sodium lamp
  at the kerb. The lamp casts shadows (drawn once), so it comes in at the
  window only and throws the glazing bars on the wall; without them it lit
  the woodwork through the walls.
- Sound outside the table (`src/game/noises.js`): room tone in the flat, the
  night air in the yard, steps by what is underfoot (carpet, gravel, grass,
  mud, tarmac), the phone ringing until answered, the machine's beep, the
  handset, the door, a spadeful, the lid under the bar, the bier's wheels by
  its speed, the van's engine by distance. Every name is silent until a
  recording for it is passed on dev/listen.html: 42 candidates are there
  (round four, `~/.cache/cold-chain/sounds/SOURCES4.md`), HQ previews because
  Freesound's download cap was hit again (429); originals can replace them.
- Voices (`tools/voices.py`, `assets/voices/`): night one's 28 lines by Fish
  Audio, 1,993 credits (94,923 left). Registrar "Sleepless historian", Elin
  "Sarah", the clinic "Selene", the machine "Abby", the buyer "Phat phap"
  (ids in the tool). `Screen.say` plays a line's recording when there is one
  and holds the words up for as long as it lasts; Space cuts it short. The
  manifest is keyed by the line's exact text: change a line in story.js and
  it falls back to silent words until it is generated again.

The right kidney comes out start to finish (`~/.cache/cold-chain/kidney6.mjs`,
log in k6.txt): three 22 s strokes down the middle, three pairs of
retractors, the transverse colon, small bowel, duodenum, ascending colon and
pancreas drawn off it (the colons, duodenum and pancreas now give: peeled off
the back wall, Kocher), its artery, vein and ureter cut 3 to 5 cm from it
(the blade now parts every vessel within 15 mm of what its edge is on: the
renal vessels run behind the vena cava and nothing ever showed them), slid to
the middle, lifted on the wheel, carried over the trolley: free, not torn,
one blade mark. V goes round to the other side of the table (`look` in
room.js), for the left kidney, which has not been run yet. The table says
the procedure aloud when it opens.

Sounds: the owner wanted them before listening, so each new purpose plays a
default pick (`PICKS` in tools/sounds.py) until something on the listening
page is marked yes or the pick is marked no.

Not done in the game: the game's own sounds wait on the owner's ears
(listening page); voices only for night one; the night has no clock; the
sexton cannot catch anybody; putting the body back or filling the grave;
corneas; a kidney taken out start to finish on the table is not yet seen
(the right one is behind the pancreas from the work view; a cross cut is
being tried); the van is a box; nights two to five.

## Baked light, the town, the mist, 2026-11-12 late

From the owner: the graveyard "feels empty and bland" (visually), the map must
feel big and not boxed in, the game must run well and look AAA, and a friend's
pipeline to match: Blender run headless from scripts, Cycles to bake the light,
MPFB for people, Poly Haven, glTF/WebP/OGG.

- Blender 5.2.4 is in `~/.local/opt` (`~/.local/bin/blender`, no sudo). MPFB
  is not installed yet (tools/people.py does MakeHuman already).
- The forge (`tools/forge/`): `bake.sh <place-time> [size] [samples]` runs
  `describe.mjs` (the game builds the place headless and `src/bake.js
  describe` writes its meshes in the world, their rough colours, its lamps)
  and then `bake.py` in Blender: the meshes rebuilt vertex for vertex, faces
  turned to the game's normals, one Smart UV atlas over all of them, lamps of
  4πI watts, Cycles bakes diffuse direct + indirect, written ×π/RANGE,
  sRGB-encoded, to `assets/baked/<place-time>.png` with the second UVs in
  `.json`. In the game `lay` puts them back (UV2, `lightmapTexture`, level
  RANGE) and the lamps go to `LIGHTMAP_SPECULAR` for those materials. The flat
  is baked night and morning (1024, 384 samples, about 80 s each on 16 CPU
  threads). The bake is physically right, which showed the old bulb (26) was
  three times too bright once light bounces: it is 8 now, the street lamp 200.
  A place's baked meshes must be all the meshes on their materials.
- `src/yard/town.js`: terraces round the walls (backs to the north, the
  road's shops-with-flats to the south, east and west past the track and the
  footpath), gable ends, chimneys with pots, painted window frames, stone
  sills, front doors, gutters, a church tower; and a far ring of rows at 95
  to 175 m going on into the fog, so the yard is a place in a town. Every
  window of a kind is one merged mesh.
- `src/yard/mist.js`: knee-deep drifts round the player (150 soft particles).
- `src/yard/tokens.js`: grave candles (red glass, a flame that blooms, four
  groups flickering apart), flowers, wreaths on fresh mounds.
- The sky's cloud is lit near the moon; the town's glow is on the cloud low
  down all round.
- Speed: stones and trees are thin-instanced per 20/30 m block (each block its
  own geometry: thin-instance buffers live on the geometry, so a clone shares
  them and every block drew the last block's stones), so blocks out of view
  are culled; the torch's shadow draws only casters in front of it within
  26 m; the moon's is redrawn only when its 2 m step moves, of what is within
  48 m. GPU time could not be measured cleanly: the GPU is shared with the
  desktop and other programs, and switching layers off gave times ±10 ms
  either way. `~/.cache/cold-chain/yardtime.mjs` and `yardperf.mjs` measure.

## Organs out, crashes, the grave, 2026-11-12 night

- Taking an organ: cut its vessels (the hint says when it is still held),
  lift it with the wheel, carry it over the cooler and let go. The cooler is
  on a trolley across the table from the eye and goes round with V; its rim
  lights when what is carried is over it. Both kidneys checked end to end
  (`~/.cache/cold-chain/kidney8.mjs`, `kidney9.mjs`): both counted, the
  order's "taken" ticks. Pulled out still tied, it tears and is a reject.
- The rig and the hand: the table takes the mouse (pointer lock), so after
  the first click a test's `rig.drag` positions mean nothing; the hand goes
  by mouse movement from where it was. Drive tools in the page instead
  (`MOVE` in kidney9.mjs aims the tool through world points each frame).
- Memory: every table visit decoded every sound again in an AudioContext of
  its own (~70 MB each, kept). The table now plays through the game's own
  Sound (`buildTable(..., { sound })`), its streams dropped when it is left.
  Flat, yard, table and back in a loop now holds level at ~300 MB
  (`churn.mjs`, `rig.send('HeapProfiler.collectGarbage')` first).
- The yard's ground mask blurred on the CPU (`willReadFrequently`) and froze
  the page 2.7 s on loading; on the GPU it is 0.3 s.
- A frame that throws is drawn past and the fault is written once in the
  bottom-left corner (`screen.fault`): for a friend to screenshot.
- `Buf.bar` running straight up made nothing (its default up was along it):
  the bier's legs and the town's window jambs were missing. Fixed in the
  helper.
- The grave: 18 spadefuls (was 46). Wreaths sit on the mound's top and go
  when the grave is dug (`tokens.clear`); before, one was inside the mound
  and hung in the air once it was dug away. Spoil is a lumpy heap; the pit's
  sides are pushed in and out a little.
- The man on the table has the coffin's face (eyes shut, jaw 4). He is
  undressed there and a line says the suit was cut off.

## TypeScript, physics, the screen, sound, 2026-11-12 late night

- The move to TypeScript: every class field is declared with the type
  TypeScript inferred from the old JavaScript (a TS 5 API script did it,
  ~/.cache/cold-chain/ts5). The type check found `Field` had two `lift()`
  methods; the scalpel's "stroke ended" called the piece-taking one. Now
  `lift()` and `liftBlade()`.
- Rig scripts run against Vite (8669) and reach `BABYLON` on the page
  (play.html exposes it in dev, the dev pages always).
- The screen: version top left, the next step of the night under it (a
  place can say better: `todo()`, `how`), a breath bar while breath is
  spent, a word over a point (`screen.mark`, the cooler).
- Breath: about 15 s of running; out of breath, no running until 30% is
  back (it flickered on and off at the limit and shook the camera).
  Working with the spade or bar no longer freezes looking.
- Physics (Havok, table only): an organ out of the body and let go off it
  falls, lands, knocks into the others (convex hull, unparented while
  loose, `Inside.fall` / `Inside.hold`). Table, floor, trolley and cooler
  are solid. Organs inside the body are still moved by shifts, not physics.
- The hand stays on what it took hold of when that cannot follow (it drew
  its pinch at the mouse before: "grabbed nothing"); what cannot move at all
  is not taken hold of.
- tools/organs.py presses organs in from the flanks too (the pelvis crest
  came through his side).
- Flesh after many cuts: lip smoothing on arrays, partial GPU uploads, cut
  faces only where a lip moved, skin-over-skin asked every 4th frame.
  `~/.cache/cold-chain/cutperf.mjs` measures. The tissue solve is most of
  what is left.
- Sound: HRTF for sounds with a place, a convolver ring per room (flat,
  yard, cold), a limiter; sounds are OGG.
- WebGPU: `?gpu=webgpu`. It starts, but not every time in the headless rig;
  WebGL 2 stays the default until it has been seen right everywhere.

## The forge's models, 2026-11-12 evening

- `src/glb.ts` loads `assets/models/<path>.glb` once per scene (`glb`) and
  places copies (`place`). Made in Blender by `tools/forge/models/`
  (`props.py`, `buildings.py`, `graves.py`; `--repack` re-ships textures
  from the kept masters without baking). Budget: the game downloads over a
  ~1.5 MB/s uplink: props 4.6 MB, buildings 4.1 MB (one kit GLB).
- In the game: door leaf, phone, answering machine, radio (where the TV
  was), bier, coffin, van; the town's terraces and tower, the chapel and the
  lodge. A mirror (glTF root) baked into vertices must have its winding
  turned back (town.ts `unpack`): it rendered the kit black.
- Not in the game yet: the grave models in `assets/models/graves` (16 GLBs)
  were made but never wired into `stones.ts`; the stones are procedural.
- Vessels: the blade cuts tubes 35 mm on down its line past what it is on
  (`BEHIND`, scalpel.ts); the hint names what still holds an organ.

## Known and not fixed

- Hands at rest are claws; the old man's hair proxy looked like a wig so he
  is bald; teeth are a little bright; the buyer is in a T-shirt with
  MakeHuman's logo on it (the wardrobe is thirteen outfits, pick better).
- Dead skin is only a tint so far. No lividity, no sheet.

## Next

Organs from BodyParts3D fitted into the torso; the chapel of rest as a real
room; night one's procedure on the table.

## The sandbox, 2026-11-13 (0.8.0)

Asked for: "turn the game into a realistic ragdoll+vital+blood sandbox"
with knives, swords, objects and guns, NPCs with real internals, and real
bones and injuries with realistic physics. `play.html` is now the sandbox;
the story's first night moved to `story.html` untouched.

- `tools/anatomy.py` fits the whole BodyParts3D man into each person
  (`assets/anatomy/<body>.bin`, ~4 MB): skeleton (skull, spine by region,
  ribs, sternum, pelvis, scapulae, clavicles, every long bone, hands, feet),
  brain, cerebellum, brainstem, heart, lungs (hull of the bronchial tree,
  swollen to the pleura: there are no lung solids in BP3D 4.0), airway,
  oesophagus, diaphragm and the belly organs from organs.py; arteries,
  veins and the spinal cord as paths. Trunk by organs.py's stretches,
  each limb segment joint to joint, the head notch to crown then seated
  inside the scalp. Every part hangs from one bone. Run it for all three
  bodies after changing it (~50 s each, `nice`).
  organs.py's `flank()` skipped gaps near the midline from then on (the
  buyer measured 0 wide).
- `src/sandbox/ragdoll.ts`: 24 Havok bodies per person (long bones are two
  bodies locked at a new mid bone, `withMidBones`), 6DoF joints with real
  ranges, ANIMATED while standing (the pose leads), DYNAMIC once down (the
  bodies lead). A fracture unlocks the mid joint. Joint friction is the
  muscle tone: alive, out, dead.
- `anatomy.ts`: rays turned into each bone's rest space against the parts
  (clustered triangles), tubes by nearest approach. `npc.surface()` skins
  the mesh on the CPU once a frame for the skin and clothes crossings
  (~20 ms the first shot of a frame). Skin under clothes is hit-tested.
- `wounds.ts`: `pierce` spends a missile's energy along the path (J per cm
  of soft tissue, much more for bone), tears vessels within the channel,
  breaks bones past a joule threshold, and carries on out the far side.
  `blow` for bats and thrown things. `vitals.ts`: blood volume, bleeding
  by vessel size and pressure, heart rate and pressure compensation and
  collapse, lungs collapsing, SpO2, brain reserve and brain death.
- `marks.ts`: wounds painted into per-person decal maps (Babylon's
  DecalMapConfiguration, fed a DynamicTexture as `mesh.decalMap`), clothes
  split onto their own mesh so the two sheets do not collide.
- `blood.ts`: drops (thin instances), splashes shaped by impact angle, pools
  by volume at 2.5 mm deep. A mesh with zero thin instances is still drawn
  once at the origin: they are hidden until their first instance.
- Weapons: Poly Haven CC0 models (knife, estoc, bat, pistol, bolt rifle)
  and a CC BY shotgun, `assets/models/weapons/` with `weapons.json`
  (grip, tip, up in glTF space). Turning them by that basis pointed them
  back at the eye; half a turn about up fixes it (measured, see weapons.ts).
- Sounds: round five, real recordings only (user, 2026-11-13: no
  synthesized audio). `SOURCES5.md`, picks in tools/sounds.py's PICKS until
  the user marks them on dev/listen.html.
- Rig scripts: `~/.cache/cold-chain/sb*.mjs` (sb3 every weapon, sb6
  shotgun/rifle/x-ray/frame time, sb8 the built preview). Wait on
  `!!window.__sandbox`: returning the object itself never resolves.

Not done: dismemberment, NPCs getting back up or moving about, blood running
down skin, wall/clothing blood beyond soak, voices. Frame time measured
headless uncapped: 9 ms idle, 17 ms with two ragdolls bleeding.

### Blood, 2026-11-13

Rebuilt as physics (numbers in `src/sandbox/fluid.ts`: 1060 kg/m3, 3.5 mPa s,
0.056 N/m; a drip is Tate's 0.05 ml).

- `blood.ts`: drops slowed by real drag for their size (Schiller-Naumann:
  mist stops within a metre, drips fall nearly free), log-normal sizes;
  stains sized by Reynolds number, elongated by 1/sin of the impact angle,
  spined past We 400; big drops on walls run down them. Arteries throw a
  pulsatile rope (`stream`, Bernoulli speed from the pressure wave in
  `vitals.beat`, breaking into drops after ~0.25 s). Bodies lying in a pool
  take it up; dragged ones leave striated smears; the player's soles print
  (fading tiles). Thin-instance marks: write into our own buffer, then
  `thinInstanceBufferUpdated` (`thinInstanceSetMatrixAt` refuses an index
  >= the count, so marks were never written before).
- `floor.ts`: 12.5 mm grid of depth, lubrication flow (h^3/3mu), dry floor
  wetted only past ~2.5 mm (contact-angle pinning), a floor ±2 mm uneven,
  clotting and drying; drawn by one plane (Puddle plugin), tiles sent with
  texSubImage2D (`fluid.sendPart`).
- `soak.ts`: cloth as an 8 mm voxel grid in rest space (3D texture read in
  hider.ts), wicking with a sharp front, gravity drainage past field
  capacity, overflow downhill, drips at hems. Empty cubes beside cloth copy
  their neighbour, or stains fade along the grid.
- `film.ts`: skin film sheet (thickness, wetness) drawn by FilmLayer with
  Beer-Lambert colour, gloss and a bent normal. `runs.ts`: beads held until
  ~0.012 ml/sin(slope), then running; wet tracks followed; a wound's stream
  is one run fed from its bleed; hangs and drips only at low points.
- Measured (RIG_GPU, RIG_UNCAP, three people bleeding): blood + bleeding +
  runs about 1.5 ms of a 12 ms frame. Scripts in ~/.cache/cold-chain/blood/.

## 0.8.17 (2026-11-13): the paused work finished

- Sound effects: all ElevenLabs (tools/sfx.py builds assets/sounds from ~/.cache/cold-chain/sfx-raw; generation ids in it).
  tools/sounds.py puts the old Freesound set back. Ambience loops are 5 s generations with loop on.
- Carrying: six slots at hand (1-6, wheel), twelve in the bag (Tab, drag to move); the arsenal board on the west wall
  (arsenal.ts), E takes, G puts back. AK-47 (2 kJ, 600/min) and M4A1 (1.6 kJ, 800/min) fire full auto; M67 grenade
  (weapons.ts _lob/_explode): 4-5.5 s fuse, blast impulse, ~1000 fragments followed only where they meet a body, and
  dismember.blast for limbs and belly. Flash fades by the clock (frames stall for ~0.2 s when a limb comes off).
- Dismemberment (dismember.ts) and opened bodies / prolapsed bowel (viscera.ts), hooked in wounds.pierce and npc.slash;
  the hands grab bowel (viscera.pick/pull/letGo). Thresholds are exported constants there.
- Blunt trauma (bruise.ts): a per-vertex field in rest space; redness, oedema as geometry, bruising that develops and
  spreads, splits over bone, nosebleeds; face.ts closes swollen lids.
- Ragdoll: balance holds 40-120 N s shoves, falls at 180+; every limb collides with the same body (not jointed
  neighbours or overlapping trunk/roots), other people and things; shapes now fit 95% of skin plus close clothes, neck and
  spine pivot mid-bone, the skeleton follows straight after each physics step (the "sinking" was the drawn body outside
  its shapes). Collision bits: 1 world, 2 trunk, 4 upper arm/thigh roots, 8 limbs, own = bit << 1.
- Blood: black fringes and dashes gone (single-sided quads, a sheet without black clear pixels), boot prints, smooth
  pool and stain edges, drips from nowhere fixed (cloth used the first person's bones), cloth simulation sleeps.
- hider.ts always sends its windows and reveal: under-clothes skin was drawn whole and came through the clothes.
- A fourth person, "Man in a hood" (hood): community MakeHuman jacket and beanie (CC-BY, assets/people/CREDITS.md),
  people.py `tint` and `adjust` per garment; Fish voice a2ksi for his cries. Irises desaturated (natural_iris).
  anatomy.py now fits the skull to skin only (a hat set it before); the other three keep their old anatomy files.
- Player: mouse look on pointermove (the view froze while a button was held).

- Severed pieces no longer count in a person's balance (was listed as left; already in 0.8.17).

## 0.8.18
- Physics steps through at most 1/30 s a frame (4 x 1/120): the old 0.1 s cap spiralled to 9 steps a frame after a
  grenade. Frames slower than 33 ms now run the bodies in slow motion (sandbox.ts, the one `1 / 30`).
- Floor blood: flow step cheaper (same result, checked on a dumped 11k-cell pool) and split over two frames, worked out
  in one and applied in the next (floor.ts `_flow` / `_settle`); pools land a frame later.
- Arsenal weapons cast no shadows (outside every shadow lamp's cone): 100 to 53 casters a shadow map, draw calls
  312 to 202 after carnage. The ammo text is written only when it changes (it forced a layout every frame).
- Measured on a loaded machine (another game and a headless browser sharing it): carnage frames 18.8-19.5 ms at best,
  physics 13.5-21.6 to 3.1-7.4 ms. Render 8-10 ms is mostly per-draw material and light binding (8 lights) and three
  shadow passes on the main thread. 16.7 ms not shown on a quiet machine.

Left: a severed head that lands gets skull-fracture entries (bones.ts); splits look like incisions; the other hand
stops 30-40 cm short of a wounded arm (meets the belly or runs out of shoulder reach).

## Paused 2026-11-13 (checkpoint after 0.8.18, preview still 0.8.18)
The user's report on 0.8.18, split into five jobs; all paused when the session moved to the cloud. Only the punch job
had written code (src/sandbox/fist.ts, a `fist` hold in table/arm.ts, weapons.ts): typechecks, never seen working.
- Organs: spill only through an opening big enough (wound ballistics), by physics alone (wall + mesentery holding,
  gravity), never a scripted spill; every organ, not just the bowel; blood on hit or exposed organs; bowel stood up
  stiff out of a pistol hole; shotgun belly flaps and cavity glitter like tinsel (should be a wet sheen, torn layers).
- Standing people bob up and down; severed limbs still move as if alive (must be dead weight).
- K (reset) after heavy damage crashed the preview build: `_cacheMatrix` in uniformBuffer (something drawn still
  refers to a disposed node); also a soft dark grey-brown smudge over chin and front of the neck, cause unknown.
- Punch: a first-person animation (in progress, fist.ts). Bruises went near black after a few punches to the mouth;
  bruising and swelling must develop over time (redness in seconds, swelling over minutes, colour later).
- New: a bandage (dress one wound, timed, soaks through, slows arterial/organ bleeding, stops venous/capillary) and a
  medkit (dresses every wound in turn), hung on the arsenal.
- Then: performance under heavy carnage across many people (blood, dismemberment, gore), measured on a quiet machine.
