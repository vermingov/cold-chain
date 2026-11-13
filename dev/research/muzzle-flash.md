# Muzzle flash: what a real one looks like

For weapons.ts's flash (0.8.20 work). What is drawn, and why.

## The phases (one shot, in order)

1. **Muzzle glow / precursor.** Gas that leaks past the bullet comes out ahead of it: a dull reddish tongue at the
   muzzle, before and just after the bullet leaves (DiGiulian, navweaps tech-090; Klingenberg 1988 via Wikipedia).
2. **Primary flash.** The hot propellant gas behind the bullet, at the muzzle face. Among the brightest parts, but it
   cools as it expands and is gone almost at once; it is small, right at the muzzle (navweaps; Wikipedia).
3. **Intermediate flash.** The gas leaves faster than sound and stands in a shock bottle closed by a Mach disc; behind
   the disc the gas is heated again and glows: "a reddish disc, slightly dished towards the gun ... about three inches
   (7.5 cm) from the muzzle of a small-calibre weapon" (navweaps). So a small arm's flash has a bright core at the
   muzzle and a separate reddish-orange knot a few centimetres out along the bore.
4. **Secondary flash (afterburn).** The fuel-rich gas (H2, CO) mixes with air beyond the shock bottle and can ignite:
   "a rather ragged vortex of yellowish white flame", the largest and longest part, where most of the light is
   radiated (navweaps). Alkali salts in the powder (potassium sulphate, nitrate, chloride) catalyse away the H/OH
   radicals that carry this burning and largely prevent it, at the cost of more smoke (Wikipedia, citing Meyer,
   *Explosives*; Klingenberg's laser-Doppler work on the 7.62 mm rifle: oxygen is entrained into the intermediate
   flow, and that combustion is what leads to secondary flash and what the salts inhibit). Flash hiders do the same
   mechanically: they break up the shock bottle so the gas never gets hot enough to ignite.
5. **Residue.** Afterwards: unburnt powder grains and bits of fouling thrown out as sparks (Wikipedia, "residual
   sparks"), and a little grey smoke and gas that drifts and thins. Smokeless powder makes little smoke; suppressant
   salts add some.

## How long

- Visible flash typically **1-2 ms** including the near infrared; some .30-06 loads up to 7 ms (Burke and Bratlie
  2011, as cited in Sexton, arXiv:1410.6025). IR from the hot gas lasts under 30 ms; visible light is shorter still.
- A 1960 SMPTE high-speed study: primary flash at the muzzle, secondary flash a few milliseconds after the shot leaves.
- A 9 mm pistol (Glock 34) filmed at 1200 Hz in thermal IR: the flash lasts milliseconds, which makes it hard to catch
  at all (Telops application note).
- So at 60 fps (16.7 ms a frame) a real flash is **one frame at most**, and with a camera of human-like integration it
  is a brief brightening, not a lingering fireball.

## How big and what colour, by gun

- **9 mm pistol** (short barrel, open muzzle): powder still burning at the muzzle, so a flash is there, but small: a
  yellow-orange ball a few centimetres across with a short cone forward. In a lit room often barely seen. Even a .22 LR
  pistol's "small yellowish flash from the end of the barrel" lit nothing identifiable of the shooter's face at night
  (Sexton, arXiv:1410.6025).
- **5.56 mm M4 with an A2 birdcage**: the device has five slots on top and sides and a closed bottom (no dust kicked
  up prone, gas vented up as a compensator); the flash comes out split, as short thin tongues through the slots and a
  small core ahead, rather than a ball (SilencerShop, PewPewTactical). Military 5.56 with flash suppressant rarely
  shows secondary flash: in daylight very little is seen.
- **7.62x39 AK-47**: the model is an original AK-47 (plain muzzle, no slant brake). A shorter case of slower
  powder through a 415 mm barrel: a larger, rounder orange flash than the M4's, with an intermediate knot, and on
  ball ammunition without suppressant often some secondary flash.
- **.308 / 7.62 bolt rifle** (long barrel, open crown): a lot of gas at high pressure: a bright, forward flame, the
  Mach disc clear a few centimetres out; flash "depends heavily on the gun and ammunition combination"
  (TheTruthAboutGuns / gun press, not controlled tests).
- **12 gauge shotgun** (open muzzle, a large charge of fast powder burning in a big bore): a big, rounder orange
  fireball with unburnt-powder sparks; high-speed film shows a large flame out of the muzzle with each shot
  (AccurateShooter's high-speed reels). No measured size was found: estimates below.

## What weapons.ts draws (estimates where no measurement exists, said so)

Per gun, one frame (the frame after the shot), additive, never lit:
- a hot near-white core at the muzzle face (primary), size by calibre;
- for open muzzles a forward cone and a reddish-orange knot at the Mach disc (intermediate), ~7.5 cm out for small
  arms (navweaps), further out for the rifle;
- for the birdcage, the core plus short tongues out of the five slots (up and to the sides, none down);
- for the shotgun a large orange ball with sparks;
- secondary flash only as a faint larger orange haze on the AK and shotgun (ammunition without suppressant), none on
  the M4 and pistol;
- the light it throws: the existing point light, decaying by the clock, its peak scaled by how much flame there is;
- after it: a faint grey puff of gas and smoke that drifts forward and up and thins over about a second, and for the
  shotgun and AK a few sparks that fly and fade within a few frames.

## Sources

- Wikipedia, "Muzzle flash": https://en.wikipedia.org/wiki/Muzzle_flash (phases, suppressant salts, residual sparks;
  cites Klingenberg 1988, "Gun muzzle blast and flash", Propellants, Explosives, Pyrotechnics 13).
- T. DiGiulian, "Gun muzzle flash", navweaps.com tech-090: https://navweaps.com/index_tech/tech-090.php
- Sexton, "Is it possible to accurately identify a shooter's face as illuminated by the muzzle flash of a 22 LR
  pistol?", arXiv:1410.6025: https://arxiv.org/pdf/1410.6025 (cites Burke and Bratlie 2011 for 1-2 ms durations).
- Telops, "Characterization of small arms muzzle flash using high speed thermal infrared imaging" (9 mm Glock 34 at
  1200 Hz): https://www.telops.com/wp-content/uploads/2022/08/characterization-of-small-arms-muzzle-flash-using-high-speed-thermal-infrared-imaging.pdf
- "Gun muzzle flash", Journal of the SMPTE 71 (1962): https://journal.smpte.org/periodicals/Journal%20of%20the%20SMPTE/71/1A/103/07308845.pdf
- Fraunhofer publica on muzzle flash suppression: https://publica.fraunhofer.de/handle/publica/314550
- SilencerShop, "How a flash hider works": https://silencershop.com/blog/flash-suppressor
- PewPewTactical, flash hiders vs. compensators vs. brakes: https://www.pewpewtactical.com/difference-between-flash-suppressors-compensators-muzzle-brakes.md
- The Truth About Guns, AR-15 flash hider shootout: https://thetruthaboutguns.com/ar-15-flash-hider-shootout
- AccurateShooter, high-speed firearms reels (12 ga muzzle flame): https://bulletin.accurateshooter.com/tag/slow-motion
