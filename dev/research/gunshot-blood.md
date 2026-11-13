# Gunshot wounds: the blood, and the exit

What blood does when a bullet goes through a person: what is thrown back out of the entrance, what is thrown forward out of the exit, and how the wounds bleed over the following seconds and minutes. Also what an exit wound is, for drawing it as a real opening. The look of entrances (abrasion collar, range signs: soot, tattooing, muzzle imprint), exits, shotgun patterns by range and the rifle/pistol differences are in `wounds.md` sec. 4-5, from DiMaio read in full; this file adds the blood and repeats only what the code needs. Stab blood is in `stab-wounds.md`.

Tags: **[S]** stated in a cited source; **[D]** derived from sourced numbers; **[E]** my estimate.

---

## 1. In the first tenth of a second

| What | Facts | Tag |
|---|---|---|
| Backspatter: what | "The ejection of blood and tissue from a gunshot wound of entrance." Blood and tissue are often ejected from exits; "this is not the case for entrance wounds". | S [DiMaio] ch. 4 |
| Backspatter: when it happens at all | Depends on site, range and calibre: "a contact wound of the head from a large-caliber weapon is more likely to produce backspatter than a distant wound of the torso from a small-caliber weapon". In 103 suicidal contact wounds blood spatter was on the shooting hand in 32 % (head and neck); in the 6 contact wounds of the chest (rifle, shotgun) none. Larger calibre, more often (35 % of pistols, 50 % of 9 mm). | S [DiMaio] ch. 4, ch. 14 (Betz et al.) |
| Backspatter: causes (head) | Gas expanding under the skin (close range only), pressure from the temporary cavity inside the skull, and tail splashing (blood and tissue streaming back along the bullet's sides). | S [DiMaio] ch. 4 |
| Backspatter: how much, how far | Calves shot in the head with a 9 mm at contact to 10 cm: 31-324 stains > 0.5 mm per shot, at most 72-119 cm away, most within 0-50 cm; finer stains (<= 0.5 mm) at most 69 cm, most within 40 cm, more numerous, round; spread over a 180 degree half-circle, unevenly. | S [Karger96] via [DiMaio] |
| Backspatter: speed and timing | Gelatin "heads", 102 shots filmed at 40 000 fps: from 5 cm and further a jet of 6-45 m/s starting late in the collapse of the temporary cavity, lasting 60-100 ms, within about +-13 degrees of level; one fell from 20 m/s to 1 m/s within half a metre. Closer and contact shots: earlier (0.6-1.3 ms) and up to 330 m/s, as a fine aerosol. The bullet's own entry only splashes the surface for ~0.2 ms with no fluid back. | S [Schyma21] |
| Forward spatter | From the exit, with the bullet: more blood and tissue than backspatter, a finer and more numerous pattern, carried forward; modelled as the break-up of a blood layer ahead of and around the bullet as it leaves, then drag and gravity on each drop. | S [DiMaio] ch. 4, [NFSTC], [Comiskey18] |
| Drop size class | Gunshot spatter is the classical "high-velocity" class: stains under ~1 mm, a mist, from drops leaving at >= 30 m/s; the air stops such drops within about a metre (drag on a drop that small). | S [BPA-class]; drag D (blood.ts already) |
| Tissue | Exits carry out fragments of tissue and fat; high-velocity rifle exits leave tissue on the inside of clothing over them. Rifle entries can throw a little tissue back ("tail splash"). | S [DiMaio], `wounds.md` 4.1/7 |

### What to simulate

- [ ] Entrance in the trunk or a limb at a distance: almost nothing back: at most a few fine drops within tens of centimetres. Head, contact or close range, bigger calibre: a fan of fine drops up to ~1 m, a 180 degree half-circle, most within 0.5 m.
- [ ] Exit: a brief cone of fine drops and bits of tissue thrown forward with the bullet, more for more energy left in the body; all of it inside the first fraction of a second. Not a stream.

---

## 2. The seconds and minutes after

| What | Facts | Tag |
|---|---|---|
| Overall | Some scenes are very bloody, some show essentially none: the bleeding is internal (chest, belly), or clothing takes it. "The only observable blood may be a dime-shaped area of bleeding on the clothing overlying the entrance site." | S [DiMaio] ch. 9 |
| Little at the entrance | Minimal bleeding around an entrance usually goes with small calibres and clothed and/or raised parts of the body, not dependent ones where gravity lets blood leak. "Clothing may act as a pressure bandage." Multiple layers: inner layers absorb it and the outer stays clean. | S [DiMaio] ch. 9 |
| Head | Gunshot wounds of the head usually bleed freely (scalp vessels held open by the galea). | S [DiMaio] ch. 9, [SP-scalp] |
| Exit | Larger, ragged and everted, so it bleeds more freely than the small entrance; no measured comparison found. | E (from size, `wounds.md` 4.7) |
| Running | Blood leaves the wound by gravity: wells, fills the hole, runs from the low side, drips from low points, pools under the body. Dependent wounds leak more. | S [DiMaio]; flow E |
| A trail | A victim who walked or ran usually leaves a trail; quantity very variable; none if the bleeding is internal or a hand presses the wound. | S [DiMaio] ch. 9 |
| Artery | Spurts in pulses with each heartbeat, bright red; each beat a new arc. A deep artery can instead bleed into the tissue (an expanding or pulsatile haematoma is a separate hard sign of arterial injury from active pulsatile bleeding). | S [UMS], [NFSTC], [Stefanou22] |
| Internal | Chest and belly bleeding is not seen outside; a chest or belly can fill while the skin wounds look small. | S [DiMaio] (rifle contact wounds of the trunk), `wounds.md` 4.7 |
| Lung | Blood from the mouth with coughing, frothy (air bubbles in it), and a chest wound can draw air in (sucking chest wound). | S [NFSTC], [SP-pneumo] |
| Clotting, drying | Whole blood clots in about 5-15 min; small drops dry in about an hour at 20 C. | S `wounds.md` sec. 6 |

### What to simulate

- [ ] No fountain at the moment of the hit. Nothing pours out at once: blood wells up in the hole and comes out at the bleed's own rate.
- [ ] Entrance: a small bead over seconds; under clothes, a stain spreading in the cloth over the hole; most blood stays inside.
- [ ] Exit: more, welling over the everted lips, running down from the low edge.
- [ ] Head: free bleeding.
- [ ] Spurts only from an open artery near the surface, timed to the heart.

---

## 3. Exit wounds: what to build

From DiMaio (ch. 4, 7), read in full:

| Feature | Fact | Tag |
|---|---|---|
| Size and shape | "Typically larger and more irregular than entrance wounds"; "stellate, slit-like, crescent, circular, or completely irregular". | S [DiMaio] |
| Why | The bullet yaws, tumbles and deforms in tissue, so it presents more of itself at the exit. Steel balls (cannot deform or tumble) left exits smaller than their entrances. | S [DiMaio] |
| No abrasion ring | "With rare exception, do not possess an abrasion ring"; the exception is the shored exit (skin pressed against a wall, floor, chair, belt or tight clothing): a broad, irregular, moist abraded band. | S [DiMaio] |
| By site | Lax skin: small and slit-shaped. Skin tight over bone (scalp): larger, irregular, often stellate. | S [DiMaio] |
| Can be smaller | An exit can be smaller than the entrance and even than the bullet (skin elasticity). Shape does not tell the bullet type. | S [DiMaio] |
| Incomplete | Bullet under intact skin; then one or two small slit tears over it; then a hole the bullet bounced back through. | S [DiMaio] |
| Rifle (centrefire) trunk exits | Larger and more irregular than the entrances, the majority 25 mm or less; the largest DiMaio saw 75 x 40 mm. Full-metal-jacket rifle exits can be indistinguishable from handgun exits. | S [DiMaio] ch. 7 |
| Edges | Everted (turned outward), with subcutaneous fat protruding. | S [Cleveland77], `wounds.md` 4.3 |
| What the edge shows | The layers in proportion to their thickness there: about 2 mm of skin (Derraik 2014), then the fat (a few mm on a forearm, 14-18 mm on a man's belly: `tissue-mechanics.md` sec. 1), then torn dark-red muscle. Fat at a fresh cut is pale cream to light yellow, lobulated and glistening, and blood soon lies over everything, pooled in the crevices: the edge reads wet and red-brown with the fat as glimpses. | S [TM] sec. 1, `wounds.md` sec. 0; blood cover E |
| Through clothing | Tissue fragments on the inside of the cloth around the hole; the cloth hole torn, not punched. | S [DiMaio] |

### What to build

- [ ] A real opening through skin and clothes (not a picture on the skin): a slit, a star of 3-4 splits, or a crescent; handgun ~ the bullet's size to ~2x, small slits on lax skin; rifle mostly up to 25 mm; deforming or fragmenting bullets larger.
- [ ] Everted lips, bloody: thin pale fat in glimpses, torn muscle and blood dominant; no abrasion ring.
- [ ] The track seen going in, dark and bloody.
- [ ] Forward spatter with tissue from it, once, at the hit.

---

## Sources

| Key | Source |
|---|---|
| DiMaio | DiMaio VJM, *Gunshot Wounds*, 2nd ed., CRC Press 1999, read in full: ch. 4 (exit wounds; backspatter), ch. 7 (centrefire rifle exits), ch. 9 "Bloody Bodies and Bloody Scenes", ch. 14 (backspatter on shooters' hands, Betz et al.). https://archive.org/details/Gunshot_Wounds_Practical_Aspects_Of_Firearms_Ballistics_Forensic_Techniques |
| Karger96 | Karger B, Nüsse R, Schroeder G, Wüstenbecker S, Brinkmann B, "Backspatter from experimental close-range shots to the head. I. Macrobackspatter", Int J Legal Med 1996;109:66-74; and II. Microbackspatter, 1997. Figures as given by DiMaio and the Springer abstract https://link.springer.com/doi/10.1007/BF01355519 |
| Schyma21 | Schyma C, Baumann F, Madea B, Gotsmy W, "Study of backspatter using high-speed video of experimental gunshots", Forensic Sci Med Pathol 2021;17(1):36-46. https://pmc.ncbi.nlm.nih.gov/articles/PMC7889577 |
| Comiskey18 | Comiskey PM, Yarin AL, Attinger D, "Theoretical and experimental investigation of forward spatter of blood from a gunshot", Phys Rev Fluids 2018;3:063901 (abstract). https://link.aps.org/doi/10.1103/PhysRevFluids.3.063901 |
| NFSTC | National Forensic Science Technology Center, "Principles of Bloodstain Pattern Analysis" (2013). https://www.forensicsciencesimplified.org/blood/principles.html |
| BPA-class | Wikipedia, Bloodstain pattern analysis (velocity classes after Wonder 2007; James, Kish & Sutton 2005). https://en.wikipedia.org/wiki/Bloodstain_pattern_analysis |
| Cleveland77, SP-scalp, UMS | As in `wounds.md`. |
| Stefanou22, SP-pneumo | As in `stab-wounds.md`. |

Gaps: no measured volume of forward spatter or of backspatter per shot, and no trunk-shot backspatter series (the experiments are heads; DiMaio and Betz say trunk shots give little or none); no measured exit-versus-entry bleeding rate; Bevel & Gardner and Knight's own text not read.
