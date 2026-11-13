# Stab and incised wounds: the blood, and the wound

What blood does when a knife goes in and comes out, what it leaves around the scene, and what the wound looks like. Written for the game: every row says what to draw or simulate. Wound shape and edge detail are in `wounds.md` sec. 1-2 (not repeated here beyond what the code needs); layer thicknesses and the gape formula in `tissue-mechanics.md` sec. 2. Gunshot blood is in `gunshot-blood.md`.

Tags as in the other files: **[S]** stated in a cited source; **[D]** derived from sourced numbers (method shown); **[E]** my estimate with no direct source.

Sources read for this file: forensicmed.co.uk's stab/slash pages (they summarise Knight's Forensic Pathology, Saukko & Knight, and the primary papers: Hunt 2003, Hunt & Cowling 1991, Levy & Rao 1988, Bleetman 2003); Stahl in Fisher & Petty 1977; Williams et al. 2019 (cast-off, read in full); DiMaio 1999 (read in full; for drip trails and clothing); NFSTC's bloodstain primer; JEMS on impaled objects; Wikipedia's BPA page for the classical velocity classes (James, Kish & Sutton 2005; Wonder 2007). Bevel & Gardner's *Bloodstain Pattern Analysis* and DiMaio & DiMaio's *Forensic Pathology* could not be read online; where a claim is the standard teaching those books carry, it is attributed to the source I actually read.

---

## 1. Blood during a stab, in order

| Moment | What happens | Tag |
|---|---|---|
| Entry | The blade fills the track it cuts. An object left in a wound "tamponade[s] that same wound from the inside, controlling bleeding"; that is why first aid leaves impaled objects in. So while the blade is in, almost nothing comes out, and nothing is thrown: there is no pressure behind soft-tissue blood and the blade moves into the body, not out of it. | S [JEMS] |
| No spray at entry | Impact spatter needs a force applied to blood that is already exposed (a blow into a bloody wound, a bullet). A first stab meets no exposed blood. Stab wounds are not listed as a source of mist (high-velocity, < 1 mm) spatter; that class is gunshots and explosions. | S [BPA-class], [NFSTC] |
| Withdrawal | The plug comes out; blood follows the blade and wells at the slit. The blade comes out smeared along the length that was inside (blood on the weapon is the rule: "it is common to recover blood on the weapon"). The skin's elastic edges wipe it as it passes, so it carries a film, not a load. | S [JEMS] (removal starts the bleeding), [Schnegg15]; wiping [E] |
| Seconds after | A slit stab bleeds outside far less than its depth suggests: "the margins lie close together and tissue elasticity presses the track shut" (Levy & Rao). Blood beads at the slit, fills it, overflows its lower end and runs down under gravity. | S [FM-stab]; run [E] |
| Minutes after | The serious bleeding is internal (chest, belly, heart). 71 % of fatal stab victims lived more than 5 minutes (Levy & Rao). Clotting of the oozing surface in ~5-15 min (whole-blood clotting time). | S [FM-stab], [FPN-clot] |
| Clothing | Over a clothed wound the first blood goes into the cloth: the only sign may be a stain over the hole, and inner layers can take it all so the outer layer stays clean (DiMaio for gunshot entries, same mechanism). A slit in the cloth matches the blade. | S [DiMaio] ch. 9, [FM-stab] |
| Dependent wounds | Wounds on the lowest parts of the body leak more; raised clothed wounds leak least. | S [DiMaio] |
| Artery cut | Arterial blood is bright red and spurts in pulses with each heartbeat; each pulse throws a new arc/cluster (projected pattern). Venous blood flows steadily, darker; capillaries ooze. | S [UMS], [NFSTC] |
| Artery cut, but no spurt | A deep artery under muscle often bleeds into the tissue instead: an "expanding or pulsatile hematoma" is listed beside "active or pulsatile bleeding" as separate hard signs of an arterial injury; a slit track through muscle does not have to let the jet out. | S [Stefanou22] |
| Heart / great vessels | Bleed into the pericardium and chest; outside, often little (the track closes; tamponade). | S [FM-stab] (internal bleeding); outside [E] |
| Lung | Air and blood: a chest wound that lets air in is a "sucking chest wound". Blood from the airway comes out of the mouth and nose, and blood coughed or breathed out ("expirated") forms a fine mist whose drops carry small air bubbles: frothy. | S [SP-pneumo], [NFSTC] |

### What to simulate

- [ ] Nothing thrown at entry. No mist, no burst.
- [ ] On withdrawal: blood follows the blade; the wound starts to bleed from then.
- [ ] Afterwards: a slit wells, fills, runs from its low end; little external blood for its depth (tamponade); under clothes it goes into the cloth first.
- [ ] Spurting only from an open artery near the surface, in time with the heart; otherwise a steady flow.
- [ ] Lung hit: frothy blood from the mouth with coughing; froth at a chest wound.

---

## 2. Bloodstain patterns a stabbing makes

| Pattern | Facts | Tag |
|---|---|---|
| Cast-off: when | Blood "ejected from a bloodied or bleeding object during its movement". Formed when the weapon is swung back before another blow, so the first blow leaves none: arcs counted = blows - 1 at least ("the first blow will not create cast-off"). | S [BPA-wiki] (Brodbeck 2012), [NFSTC], [CastOff-search] |
| Cast-off: how drops leave | High-speed video (kitchen knife and bat, porcine blood): blood at the object's end draws out into ligaments that break into drops. A drop leaves when surface tension can no longer supply the force to keep it moving on the object's arc; it then flies on tangent to the tip's path at the tip's speed ("at the time of drop release, drop velocities matched that of the knife tip"). Not radially ("centrifugal" is wrong). | S [Williams19] |
| Cast-off: speeds | Human-swung kitchen knife: tip 6.8-8.8 m/s on a backswing, 12.6-14.5 m/s on a fast forward swing; bat end 13-15 m/s back, 18-21 m/s forward. | S [Williams19] |
| Cast-off: knife vs bat | The knife retains less blood than the bat; on the knife's backswing "short or no ligaments"; fewer, larger drops on backswings than forward swings. A knife's small surface gives "a smaller, more linear pattern of stains"; tails point the way the blade moved. | S [Williams19], [NFSTC] |
| Cast-off: where | Ceilings and walls along the plane of the swing; near-round stains on a ceiling above the weapon when it is horizontal. | S [Williams19], [BPA-wiki] |
| Drop size from a swing | Detachment balance [D]: a drop of diameter d stays on while its inertia under the object's acceleration a is less than the surface tension holding it, rho (pi d^3 / 6) a < pi sigma d, so d_max = sqrt(6 sigma / (rho a)). With blood's rho = 1060 kg/m3 and sigma = 0.056 N/m (fluid.ts): a = g gives 5.7 mm (a hanging drip; Tate's law drop is ~4.6 mm, same order); a = 100 m/s2 gives 1.8 mm; 1000 m/s2 gives 0.56 mm. So a slow swing sheds big drops, a fast one small ones, as Williams saw. | D from [Williams19] mechanism, fluid.ts constants |
| Drip from the blade | Held still, blood collects at the point and falls as passive drops (gravity alone). | S [Williams19] (passive dripping mechanism) |
| Drip trail | A bleeding person or a dripping weapon moving about leaves a trail of passive drops: round stains when it stood still, elongated with tails in the direction of travel when it moved. DiMaio: a victim who walked or ran from the scene usually leaves a trail; its quantity "is very variable". | S [DiMaio], [BPA-wiki] (James, Kish & Sutton) |
| Drip into blood | A drip pattern forms when blood drips into liquid blood. The falling drop merges with the pool (no mark of its own on a liquid surface); the impact throws satellite droplets out round it, and the size of the parent stain and the number and spread of satellites grow with the Weber number (impact speed) and with the number of drops that have fallen there (500 patterns, ovine blood, five speeds, ten drop counts). A dried or skinned-over pool is a surface like any other: a drop on it leaves its own stain. | S [Boos19]; dried pool [E] |
| Transfer | "Two surfaces come into contact and at least one is wet with blood": the attacker's hand and the handle, the blade wiped on cloth, swipes and wipes. | S [BPA-wiki] (Brodbeck 2012) |
| How much a blade carries | No measurement found. Upper bound [D]: a plate pulled from a blood pool at 1 m/s keeps a Landau-Levich film h = 0.94 (mu U)^(2/3) / (sigma^(1/6) (rho g)^(1/2)) = 0.34 mm; over a 10 x 2 cm blade, both faces, that is ~1.4 ml. The skin wipes the blade on the way out, so the real film is far thinner: I take ~0.03 mm wiped film (~0.1 ml on that blade), of which ~0.01 mm stays as a smear that does not fly off. [E] | D (bound), E (film) |
| Drop size classes (classical) | Low-velocity (passive, < 1.5 m/s): >= 4 mm stains. Medium (1.5-7.6 m/s, beatings and cast-off): 1-4 mm. High (>= 30 m/s, gunshots): < 1 mm, mist. The labels describe the mechanism, not the drops' speed. | S [BPA-class] |
| What does NOT happen | No mist and no big burst from a stab into soft tissue or a vein: mist needs gunshot-class energy; a burst needs an artery (pressure) or a blow into blood already pooled. A slash does not throw blood off the wound as it cuts either: the blood that flies comes off the blade (cast-off), after it has picked some up. | S [BPA-class], [NFSTC]; slash [D] from [Williams19] |

### What to simulate

- [ ] A blade picks blood up in a wound (a film over the part that went in) and carries it.
- [ ] Each frame, the blood on the blade feels the blade's acceleration (and gravity): what surface tension cannot hold leaves as drops of d_max at the tip's velocity, tangent to its path. Slow moves shed few big drops; fast ones more, smaller. A thin smear stays.
- [ ] So the first stab's withdrawal and backswing make the first cast-off line; a second stab with a bloody blade adds another.
- [ ] Held still, a bloody blade drips from its point.
- [ ] Draw the blood on the blade.

---

## 3. The wound

Facts as in `wounds.md` sec. 2 (stab) and sec. 1 (incised); here only what the code draws.

| Feature | Fact | Tag |
|---|---|---|
| Shape | A slit, deeper than it is long. | S [Stahl77] |
| Edges | Clean, sharply divided, no abrasion collar (edge abrasion only with great force), no tissue bridges. | S [Stahl77], [FM-stab] |
| Ends | Single-edged blade: one sharp, acute end (the edge) and one blunt end, squared-off or slightly rounded, sometimes split into a "fish tail" (from rocking). Double-edged: both ends acute (a spindle). | S [FM-stab], [Stahl77], [LMB], [ACEP] |
| Length vs blade width | A straight thrust leaves a slit up to 2 mm shorter than the blade's width at the depth reached (skin shrinks back). Partial penetration: the width at the deepest point, not the full width. Oblique thrust or rocking: longer. | S [FM-stab], [ACEP] |
| Obliquity [D] | The slit is where the blade's plane meets the skin. With the thrust along unit d, the blade's width along unit e (perpendicular to d) and the skin's normal n, the blade's edges cross the skin at +-(w/2)(e - d (e.n)/(d.n)): the slit is w |e - d (e.n)/(d.n)| long, lying along that vector. Square on, it is w; slanting in the plane of the blade it lengthens as 1/cos. One lip is undercut and the other bevelled. | D (geometry) from [FM-stab] |
| Twist / withdrawal at another angle | V, L or dovetail shape; a nick running off the acute end. | S [FM-stab], [Stahl77] |
| Gape | Across Langer's lines a cut is pulled into an ellipse; along them it stays a slit. Gape needs the dermis cut through. Slit-in-membrane estimate: maximum opening = 4 sigma a / E (a = half-length). sigma ~ 50 kPa along the lines, ~22 kPa across (pre-strain ratio 23:10), E ~ 1.2 MPa: a 2 cm stab (a = 10 mm) opens ~1.7 mm across the lines and ~0.7 mm along them; attached fat keeps it toward the lower half. Langer's lines are a weak predictor (Hunt 2003): add noise. | S [FM-stab]; D [TM] sec. 2 |
| Line direction | Trunk front: transverse (horizontal), turning oblique on the flanks. Neck: transverse. Limbs: I take the lines as running round the limb [E: Langer's 1861 map as commonly reproduced; not checked region by region]. | S [TM] (abdomen); E (limbs) |
| Track depth | Can exceed the blade on compressible parts: a 12.7 cm blade has left a 20 cm track. | S [LMB], [Stahl77] |
| Hilt mark | A bruise or abrasion beside one end where the guard or fist hit; rare, 3 % (Hunt & Cowling 1991), likelier over the chest. | S [FM-stab], [ACEP] |
| Defence wounds | Incised wounds on the palms and palm side of the fingers (grabbing the blade) and the backs of the forearms (raised to block). | S [Stahl77] |
| Incised vs stab | Incised (slash): longer than deep, bleeds more freely (cleanly cut vessels spasm less), tails off to a scratch where the blade left. Stab: deeper than long, bleeds little outside. | S [FM-slash], [Stahl77] |

### What to draw

- [ ] Slit along the blade's plane where it meets the skin, length from the blade's width at the depth reached minus up to 2 mm, longer when oblique.
- [ ] Edge end acute; spine end squared (single edge) or acute (double edge).
- [ ] Gape by angle to the local tension line: an ellipse across, a near-closed slit along.
- [ ] No abrasion ring; clean edges.

---

## Sources

| Key | Source |
|---|---|
| Williams19 | Williams EMP, Graham ES, Jermy MC, Kieser DC, Taylor MC, "The Dynamics of Blood Drop Release from Swinging Objects in the Creation of Cast-off Bloodstain Patterns", J Forensic Sci 2019;64(2):413-421. Accepted manuscript read in full: https://cronfa.swansea.ac.uk/Record/cronfa40975 |
| FM-stab, FM-slash | forensicmed.co.uk stab and slash pages (Hunt 2003, Byard 2005, Hunt & Cowling 1991, Levy & Rao 1988, Bleetman 2003, Knight 1996). https://www.forensicmed.co.uk/wounds/sharp-force-trauma/stab-wounds/ ; https://www.forensicmed.co.uk/wounds/sharp-force-trauma/slash-wounds/ |
| Stahl77 | Stahl CJ, "Cutting and Stabbing Wounds", in Fisher RS, Petty CS (eds), *Forensic Pathology: A Handbook for Pathologists*, US DoJ 1977. https://www.ojp.gov/pdffiles1/Digitization/43951NCJRS.pdf |
| LMB, ACEP | As in `wounds.md`. |
| DiMaio | DiMaio VJM, *Gunshot Wounds*, 2nd ed., CRC 1999, ch. 9 "Bloody Bodies and Bloody Scenes" (bleeding at the scene, clothing as a pressure bandage, drip trails). https://archive.org/details/Gunshot_Wounds_Practical_Aspects_Of_Firearms_Ballistics_Forensic_Techniques |
| JEMS | "Use caution with impalement injuries", JEMS 2011 (an impaled object tamponades its wound from inside; removing it starts the bleeding). https://www.jems.com/patient-care/emergency-trauma-care/use-caution-impalement-injuries/ |
| Schnegg15 | Schnegg M et al., fibre transfer in simulated stabbings, J Forensic Sci Med 2015 (blood is commonly recovered on the weapon). https://doaj.org/article/b2fe39b9fdda419d9b3b8f9190bc7d6c |
| NFSTC | National Forensic Science Technology Center, "Principles of Bloodstain Pattern Analysis" (2013). https://www.forensicsciencesimplified.org/blood/principles.html |
| BPA-wiki, BPA-class | Wikipedia, Bloodstain pattern analysis (cast-off: Brodbeck 2012; transfer; velocity classes after Wonder 2007 and James, Kish & Sutton 2005; tagged there for weak referencing, so the class limits are the classical ones, not a standard). https://en.wikipedia.org/wiki/Bloodstain_pattern_analysis |
| CastOff-search | Cast-off summaries (Forensic Science Simplified; encyclopedia.com "Cast-off blood"). https://encyclopedia.com/science/encyclopedias-almanacs-transcripts-and-maps/cast-blood |
| Boos19 | Boos et al., drip patterns: effect of impact velocity and droplet number on size, shape and satellite spatter, Forensic Sci Int 2019 (abstract), doi 10.1016/j.forsciint.2019.05.002. https://agris.fao.org/search/es/records/65dfd04cb766d82b18032c05 |
| UMS | *Fundamental First Aid Competencies*, ch. 4, Universiti Malaysia Sabah. https://openbook.ums.edu.my/fundamentalfirstaidcompetencies/?p=69 |
| Stefanou22 | Stefanou N et al., "Update in combined musculoskeletal and vascular injuries of the extremities", World J Orthop 2022;13(5):411-426 (hard signs table). https://wjgnet.com/2218-5836/tables/v13/i5/411.htm |
| SP-pneumo | StatPearls, Open Pneumothorax (sucking chest wound). https://www.ncbi.nlm.nih.gov/books/NBK441885/ |
| FPN-clot | FPnotebook, whole blood clotting time. https://fpnotebook.com/HemeOnc/Lab/WhlBldCltngTm.htm |
| TM | `tissue-mechanics.md` sec. 2 (pre-stress, modulus, gape formula, abdominal line direction) |

Gaps: no measurement of how much blood a blade carries out of a wound or loses to the skin's wiping (the film thicknesses are estimates under a computed upper bound); no frequency for external spurting versus internal haematoma by artery; limb tension-line direction not checked against Langer's map region by region; Bevel & Gardner and DiMaio & DiMaio's *Forensic Pathology* not read.
