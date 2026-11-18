# Knuckle dusters and boxing gloves: what they do to a punch

For worn.rs and the tools in bones.rs (`dusters`, `glove`). The tags follow blunt-trauma.md: [M] measured, [E] an
estimate or a manufacturer's figure, [D] my deduction from the rest.

## 1. The bare fist the game already has

fist.rs throws a jab at 6 m/s with 1 kg behind it and a full straight at 10.5 m/s with 3.2 kg, and lands it through a
series spring of 9.5e4 N/m (arm and fist, FIST_GIVES) and the struck bone's pad (bones.rs), on a 30 to 40 cm2 patch; a
full straight to a jaw peaks at 4 to 5 kN over some 13 ms (blunt-trauma.md sec. 9, Walilko05, Atha85, Smith00, Liu22).
Those measurements were of punches in gloves: the game's bare fist is calibrated on them, and the two below are set
against it.

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
  half the bare fist's, contact about twice as long (pi sqrt(m/k)), the same impulse. A full straight to a jaw: some 2
  kN over 25-30 ms.
- The patch is the glove's face, some 70 cm2: fractures need the force over a patch twice the bare fist's, and the
  skin is not split over bone except by a hard punch to a thin place (a brow).
- Energy and momentum are the punch's plus the glove's own 0.4 kg: concussion and knockout (wounds.rs, from the energy
  to the head) come as with a bare fist, a little more.
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
