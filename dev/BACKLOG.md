# Backlog: after the Bevy port, and only once the user says go

The user's word (2026-11-15): port the whole game to Bevy (https://bevy.org/) first; none of the below until the port
is done and the user has been asked. In their words, then what each means here.

The user said go (2026-11-16): "continue with the port, and then get started on finishing the things that didn't get
finished on the Babylon version, and then do the rest of what I asked". So, in this order: finish phase 4 of the port;
then item 7 (what was stopped mid-way in the TS). Items 1-6 wait: the user said (2026-11-16) not to start them right
away, only to finish the port and item 7.

The user said go on 1-6 (2026-11-18), with item 7's loose ends (HANDOFF.md top): "Start working on that, and also
fix the loose ends". Order proposed to them: 4 first (the active ragdoll touches the rest), then 1, 3, 5, 6, 2.

1. **The viewmodel and the player's body in the 3D world.** "The viewmodel should actually be in the 3D world, same
   with my character, like I should be able to push the NPCs with my body, and I should be able to put my gun up
   against the NPCs so it isn't just my view but actually where it is and where it will function."
   A physical player body that pushes people; the held weapon a solid in the world where it is drawn (pressed against
   a person or a wall it stops there); shots from the muzzle along the barrel, melee hits only where the weapon's
   model sweeps (not the crosshair).
2. **Jumping.**
3. **Dismemberment stubs** are "very buggy" (the stump left on the body after a limb is cut off).
4. **The active ragdoll ("euphoria") is not good enough**: "it often conflicts with our collisions and other stuff and
   overall just isn't the best." A better active-ragdoll controller that works with full self-collision.
5. **People**: remove the man in the hood; add one in a white T-shirt and white jeans, and one naked.
6. **Knuckle dusters and boxing gloves** (weapons), and **a boxing ring** where you fight people who fight back,
   respawnable.
7. **Finish what was stopped mid-way** (HANDOFF.md "Stopped mid-way" and "Smaller open items"):
   - the mouth visibly filling with blood, a wet red interior, wounds inside the mouth, a proper vomit gush, neck
     wounds not bleeding as scalp;
   - the shotgun blast's cost (110-360 ms of JS);
   - the first-person arms (sleeves, grips, the .22 low, their cost), hits from the weapon model, Hands and Fists
     separate with left/right punches and hold-to-charge (1-5 kN);
   - the brain inside the skull, and the face stretched into a spike by a sword cut;
   - joint limits giving under load, the shoulder cone; bone fracture thresholds; the chest wall fit; eyes after an
     injury; the K hang; shovel/sledgehammer rest pose; shins buzzing when standing.

## The user's play-test reports, 2026-11-18 (fix after or with 1-6)
- X-ray after a dismemberment: the cut limb's bones stretch from the stump to the severed piece (normal view fine).
  Bandaging a stump does the same (the dressing stretches to the piece). Given to the people/stumps job.
- Gunshot holes (the shotgun's most of all) are too perfectly round: a clean cylinder through skin, fat and muscle
  with neat ring layers, a hole straight through the head. Real ones: ragged, everted/inverted edges, abrasion ring,
  torn tissue, not a drilled tunnel.
- Intestines poke out of the belly in a weird way: they appear only where there is a hole and clip through the body
  (a red cone sticking out of a shirt). Not a real evisceration.
- Same body, side view: the intestines come out as flat red shards/flaps sticking out of the flank, clipping
  through the shirt; the blood soaked into the shirt is one dark blob with a hard jagged edge (real soak: wet,
  darker in the middle, a soft wicking edge that follows the weave and gravity).

## The user's reports and asks, 2026-11-19 (after playing the AppImage from bevy-port a913169)
Fixes (jobs started, stopped unfinished at the session's end; each branch's PORT.md section says where it got to):
- "fix the opponent's footwork and the crawl elbows" (port/b-ragdoll). Footwork: he must close, keep range, circle,
  step in and out with punches and not fall off his own punches; last round every walk left the feet behind and he
  backed off and fell, cause not found. Crawl: elbows 40-70 deg past range because the pull pose folds the forearm
  under the chest; a real army crawl keeps the forearm flat in front. His jabs ~50 J against the player's 18 J.
- "the punching with and without gloves looks weird, and also does way too much damage, like why do I break a bone
  within 1 punch, it's like I'm god" (port/b-six). Trace a punch fist.rs -> wounds.rs `blow` / `Harm::struck` ->
  bones.rs and calibrate to real figures (punch force, contact time, effective mass, facial fracture loads, what
  gloves and brass do). Bare: bruises, cuts, a nose or a knockout, rarely more; gloves almost never break bones;
  brass break facial bones readily. The look: the fist turning over, shoulder and hip in, the other hand guarding,
  snap out and back.
- "if I stand very close with my gun's barrel against somebody, sometimes it doesn't even hit them" (port/b-body).
  Contact shots miss: a scenario pressing each gun to each body part at 0-10 cm, logging hit or miss.

New things (not started):
8. **Syringes** (injected into a person):
   - one that heals their vitals without healing the visible damage, and stops the bleeding;
   - one that makes their flesh rot;
   - one that dissolves all their bones;
   - one that poisons them.
9. **A boiling water gun**: it should scald the skin and damage tissue realistically (real scalds: redness,
   blisters, skin slipping off, full thickness with long contact).
10. **An acid gun** (chemical burns that keep eating while the acid is on the skin).
New sounds for these (the needle, the spray, the hiss) need ElevenLabs takes; the ElevenLabs connector needed
signing in again at the end of 2026-11-19.
