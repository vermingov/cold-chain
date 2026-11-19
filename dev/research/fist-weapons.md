# Knuckle dusters and boxing gloves: what they do to a punch

For worn.rs and the tools in bones.rs (`dusters`, `glove`). The tags follow blunt-trauma.md: [M] measured, [E] an
estimate or a manufacturer's figure, [D] my deduction from the rest.

## 1. The bare fist: how hard an ordinary man punches, and what one punch breaks

The player is a man who can throw a punch, not a boxer. Until November 2026 fist.rs threw an Olympic boxer's punch (a
full straight at 10.5 m/s with 3.2 kg behind it, 176 J): every full punch to the head knocked out and every one to the
chest broke the sternum and ribs. The figures it throws now, and what they rest on:

| What | Figure | Source |
|---|---|---|
| Fist speed, untrained men (StrikeTec wrist sensor, 10-12 oz gloves) | lead straight 6.3 m/s (14.1 mph), rear straight 5.9 m/s (13.2 mph) | [M] Tao B et al., Metabolites 2025;15(4):262, doi:10.3390/metabo15040262 (Tao25), placebo group's baseline |
| Fist speed, trained boxers (same) | lead 8.8 m/s, rear 8.3 m/s | [M] Tao25 |
| Fist speed and effective mass, Olympic boxers' straights to a dummy's jaw | 9.14 +- 2.06 m/s, 2.9 +- 2.0 kg; peak force 3427 +- 811 N; head 58 +- 13 g and 6343 +- 1789 rad/s2 | [M] Walilko05 (blunt-trauma.md) |
| Rear straight on a padded dynamometer | elite 4800 N, intermediate 3722, novice 2381; lead hand 2847, 2283, 1604 | [M] Smith MS et al., Br J Sports Med 2000;34:174-7 (Smith00) |
| Jab, boxers of two levels | 1508 +- 411 and 1035 +- 220 N | [M] Liu22 (blunt-trauma.md) |
| Punches landed in six professional bouts (gloved, 1675 punches) | means 867 to 1149 N per fighter; 59.2% under 1 kN, 5.3% over 2 kN, 1.1% over 3 kN; most forceful 5358 N | [M] Pierce JD et al., J Quant Anal Sports 2006;2(2):3 (Pierce06) |
| Peak force of a heavyweight's straight | 4096 N, 14 ms after contact | [M] Atha85 (blunt-trauma.md) |
| Untrained punch | men 500-850 N, women 350-550 N | [M] HennLignitz04 (secondary summary, blunt-trauma.md) |
| "Effective mass" | 2.9 kg (Walilko05, from momentum); 18-31 kg in later studies that count the body's whole push through the contact | [M] Walilko05; the 2025 Polish and AUT studies found by search, not read | 

Deductions [D] for the game (fist.rs JAB and FULL):
- A tap (a jab) lands at 6 m/s with 0.6 kg behind it (the hand and a little of the forearm); a full wind-up at 7.5
  m/s with 1.6 kg (the shoulder and hips turned in behind it). Through the fist's give (9.5e4 N/m, FIST_GIVES, which
  puts Walilko's Olympic straight at their 3.4 kN on a jaw) and the bone's pad, the peak forces come out at about 1.2 kN
  for a jab and 2.3 kN for a full punch on the face and jaw (a novice boxer's hardest), 0.8 and 1.5 kN on the chest.
  Contact lasts some 9 ms for a jab and 13 ms for a full punch (pi sqrt(m/k)). Energies 11 and 45 J.
- The force measurements are of gloved fists (Walilko05, Smith00, Pierce06 all wore gloves): the bare fist is
  calibrated on them, and a glove in the game is set against that (sec. 2). No study has measured bare against gloved
  peak force on a head.

What one punch breaks (all [M] unless marked):

| Bone | Breaks at | Source |
|---|---|---|
| Nasal bones | 50% risk at 450-850 N (540-600 N by two estimates); fractures from 106 N to 1767 N; 6.45 cm2 flat face, 24 men aged 41-94 (mean about 70) | Cormier J et al., Ann Adv Automot Med 2010;54:3-14 (PMC3242551) |
| Maxilla | 0.63-1.98 kN (6.5 cm2) | Nahum 1975 via AI-Skull |
| Zygoma | 0.61-3.47 kN; arch 0.93-1.94 kN | same |
| Mandible | lateral 0.82-3.4 kN; at the chin (front to back) 1.9-4.1 kN | same |
| Frontal bone | 2.67-9.88 kN (6.5 cm2); the brow is the frontal bone's thick rim, which takes the blow; the orbit's floor behind it is 0.4-1.3 mm and blows out when the eye is pushed in | AI-Skull (Nahum); eye-trauma.md sec. 1 |
| Ribs | 50% risk of any rib fracture at 35% of the chest's depth pushed in at 30 years, 13% at 70; of more than six ribs at 43% and 33% (93 cadavers, hub, belt and both: loading made no difference, age did; mean age 60, so the young figures are the model's) | Kent R, Patrie J, Forensic Sci Int 2005;149:121-128 |
| Contact patch | halving it about doubles the chance of a fracture | Yoganandan, blunt-trauma.md sec. 4 |
| Bruising | 50% in living volunteers at 5.9 N s of impulse, 3.2 J of work | Desmoulin07, blunt-trauma.md sec. 1 |

What fists really do (the outcome to match):

| What | Figure | Source |
|---|---|---|
| Bare-knuckle professional bouts (BKFC), June 2018 to March 2022 | 301 bouts: 211 injuries to the face in 177 fighters, 184 lacerations and 27 fractures (nasal fractures the largest share, by a secondary summary) | [M] Sifuentes-Cervantes JS et al., J Oral Maxillofac Surg 2022;80:1663-1669 |
| Bare-knuckle bouts, June 2018 to November 2020 | 141 bouts, 282 fighters: 123 injuries; lacerations 34.8% and hand fractures the commonest; 17 fractures in all; concussions fewer than in gloved boxing and MMA | [M] PubMed 34380362 (2021), as summarised by combatsportslaw.com; not read in full |
| A blow to the head knocks out by turning it | concussion follows the head's rotational acceleration; a boxer's punch is near the threshold | [M] blunt-trauma.md sec. 5, Rowson12, Walilko05 |

Deductions [D]: a bare punch rarely breaks anything but the nose (and an old man's jaw, cheek or ribs); it bruises,
and the face splits under repeated punches to the brow more than under any one; a knockout comes from a good punch on
the point of the chin, which turns the head hardest, not from one on the nose or forehead.

How the game now works it out (wounds.rs `blow`, bones.rs `impact`, `chest`, `place`, wounds.rs `head_turn`):
- Peak force F = v sqrt(k m), with k the fist's give in series with the bone's pad and m the reduced mass of the fist's
  and the struck part's (8% of the body for the head).
- The bone first in the way breaks when F exceeds its figure (above) times the person's age and build factors and the
  patch's spread ((area/6.5)^0.3, capped at 1.8). The brow above the eye is the frontal bone's (6.3 kN), not the eye
  socket's 1.2 kN, which was what broke frontal bones with jabs. A punch on the face reaches the throat's hyoid and
  voice box only when it lands on the throat.
- The chest breaks ribs by how far it is pushed in (F / 40 kN/m over its 23 cm depth) against Kent and Patrie's 50%
  points.
- A knockout from the head's turn: the momentum given to the head (twice the reduced mass's, as from a spring) times
  its lever about the head's middle (7.5 cm behind the eyes' level), against Walilko's Olympic straights to the jaw
  (lever 9 cm), whose 6343 rad/s2 is even odds of a concussion (Rowson12) and is taken as even odds of a knockout. By
  momentum rather than peak force because their fists were gloved, and gloves do not lessen knockouts (sec. 2). The
  player's own head (bout.rs `Harm::struck`) the same way, at the jaw's lever.

Measured with `punch-damage` (punch_scenario.rs: 20 punches each way at each of the line-up, each on someone unhurt):
PORT.md has the table before and after.

## 2. Boxing gloves

| What | Figure | Source |
|---|---|---|
| Glove mass | 8 to 16 oz (230 to 450 g); 10 oz amateur and professional competition up to welterweight, 12-16 oz for sparring | [E] governing bodies' and makers' sizes |
| Padding over the knuckles | 2 to 4 cm of layered foam (or horsehair) | [E] makers' figures |
| Thin (4 oz MMA) glove against a boxing glove, molded fist on an instrumented anvil | MMA glove 4 to 5 times the boxing glove's peak force and 5 times its load rate; both rise as the foam wears (MMA's peak +35% over 10,000 strikes) | [M] Lee B, McGill SM, Revista de Artes Marciales Asiáticas 2014;9(2):106-15, doi:10.18002/rama.v9i2.1175 |
| Glove type and momentum given to a heavy bag | Fist speed the same bare or gloved; a boxing glove gave the bag more momentum than the bare fist | [M] Smith PK, Hamill J (Konstanz ISBS proceedings, karate and boxing glove impact characteristics; skill x glove design) |
| Padding on a Hybrid III head, pendulum hook punches at 27-29 and 54-58 J | Every padding condition lowered the linear impact dose; the glove with headgear lowered it most | [M] Bartsch AJ et al., J Neurosurg 2012 (PubMed 22313361) |
| Knockouts in gloved boxing | Common: the knockout comes from the head's turn and the momentum given, which the glove does not lessen | [M] Walilko05 (6343 rad/s2 from gloved Olympic punches) |

Deductions [D] for the game:
- The same arm, speed and momentum; the foam is a soft spring in series with the arm. Against an anvil it cut peak
  force to a fifth (Lee & McGill, against a 4 oz glove that already has some foam); on a head, whose own give is in
  series too, much less. Taken as a glove of 2.2e4 N/m in all (the arm's 9.5e4 and foam about 3e4): peak force about
  half the bare fist's, contact about twice as long (pi sqrt(m/k)), the same impulse. An ordinary man's full straight
  to a jaw: some 1.3 kN over 25-30 ms (sec. 1).
- The patch is the glove's face, some 70 cm2: fractures need the force over a patch twice the bare fist's, and the
  skin is not split over bone except by a hard punch to a thin place (a brow).
- Energy and momentum are the punch's plus the glove's own 0.4 kg: concussion and knockout (wounds.rs `head_turn`, from
  the momentum given to the head) come as with a bare fist, a little more (`punch-damage`: 26 of 100 full punches to the
  jaw knocked out gloved, 12 bare; bare-knuckle fighters have fewer concussions than boxers, sec. 1).
- The wearer's hand: the glove (and the wraps under it) spread the load over the hand and hold the wrist; a boxer's
  fracture (the fifth metacarpal's neck) is the injury of the bare fist on a skull. The player's hands are not hurt in
  the game either way (there is no player's-hand injury yet).

## 3. Knuckle dusters

| What | Figure | Source |
|---|---|---|
| Mass and form | 150 to 250 g of brass or steel: four finger rings fused into a plate, a striking bar 5-10 mm deep across the knuckles, a grip in the palm | [E] makers' figures |
| Blunt laceration | Skin over bone splits when a narrow hard face crushes it against the bone beneath: the narrower and harder, the less force it takes | [M] blunt-trauma.md sec. 3 |
| Fracture against patch | Halving the loaded patch about doubles the chance of a fracture (thresholds measured on 6.5 cm2 scale with the patch) | [M] Yoganandan, in blunt-trauma.md sec. 4 / bones.rs |
| Injuries in assaults with knuckle dusters | Patterned lacerations and abrasions of the bar's shape, depressed and facial fractures, eye injuries; the attacker's hand spared | [E] forensic texts in general (no case series found with figures; patterned injury: forensicmed.co.uk, blunt force trauma patterns) |

Deductions [D]:
- The arm behind it is the same; what changes is what lies between the hand and the skin. Bare, the knuckles' own skin
  and flesh give; the bar does not. Taken as 1.6e5 N/m in all (the arm's 9.5e4 and nearly nothing more): peak force
  about 1.3 times the bare fist's, over 6 cm2 (the bar across four knuckles on a curved face), so a fifth of the patch:
  fractures of the face's small bones, the orbit, the nose, the jaw from a punch a bare fist would not break them with;
  the skin split over bone; an eye hit straight on burst (wounds.rs: narrower than the socket's rim).
- Energy and momentum barely change (0.2 kg more): concussion as a bare fist's.
- The wearer's hand is protected: the grip in the palm takes the load into the whole hand, so the knuckles that would
  fracture on a skull do not (not modelled: the player's hands are not hurt).

## 4. What is not known

No study measures bare against gloved peak force on a human head with the same punch, nor knuckle-duster impacts at all;
the stiffnesses above are set from the series-spring model and the anvil ratios, and should be replaced by measurements
if any turn up.
