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
