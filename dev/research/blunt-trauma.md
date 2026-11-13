# Blunt force trauma: reference for drawing and simulating it

Scope: adult human, living at the time of injury unless stated. Weapons in scope: baseball bat, thrown heavy objects, falls, punches and kicks.
Companion to `tissue-mechanics.md` (sharp force, abdominal wall).

Confidence tags (same as `tissue-mechanics.md`): **[M]** measured in humans (volunteers, patients or post-mortem human subjects, "PMHS"); **[A]** animal; **[C]** clinical reference text (Merck Manual, trauma grading); **[D]** derived by me from measured numbers, method shown; **[E]** estimate or textbook statement I could not tie to a measurement. Treat [D] and [E] as tuning starting points.

Read this first:
- Cadaver tolerance numbers come mostly from elderly, often embalmed specimens, rigid impactors and controlled contact areas. Spread is huge: the range for 50% skull fracture risk spans 1.9 to 12.5 kN in one review (Vicini/Goswami, via search summary). Young living adults are usually stronger; old ones weaker.
- Peak force alone is a poor predictor. Contact area, rate, region, age and padding (scalp, hair, fat, clothing) all move the threshold (Yoganandan04; deBoer21).
- Forensic pathologists refuse to state a "degree of force" from an injury (deBoer21). The game can use thresholds, but injuries should vary between bodies.

---

## 0. Source key

| Key | Source |
|---|---|
| Yoganandan04 | Yoganandan N, Pintar FA. "Biomechanics of temporo-parietal skull fracture." Clin Biomech 2004;19:225-239. doi:10.1016/j.clinbiomech.2003.12.014 (read in full) |
| AI-Skull | "Skull and Facial Bone Injury Biomechanics", ch. 8 of *Accidental Injury: Biomechanics and Prevention*, 3rd ed. (Yoganandan, Nahum, Melvin eds., Springer 2015). Excerpt: https://musculoskeletalkey.com/skull-and-facial-bone-injury-biomechanics/ |
| AI-Thorax | "Thorax Injury Biomechanics", ch. 13, same book. https://musculoskeletalkey.com/thorax-injury-biomechanics/ |
| AI-Upper | "Upper Extremity Injury Biomechanics", ch. 12, same book. https://musculoskeletalkey.com/upper-extremity-injury-biomechanics/ |
| AI-KTH | "Knee, Thigh, and Hip Injury Biomechanics", ch. 17, same book. https://musculoskeletalkey.com/knee-thigh-and-hip-injury-biomechanics/ |
| AI-Leg | "Leg, Foot, and Ankle Injury Biomechanics", ch. 18, same book. https://musculoskeletalkey.com/leg-foot-and-ankle-injury-biomechanics/ |
| AI-Neck | "Neck Injury Biomechanics", same book. https://musculoskeletalkey.com/neck-injury-biomechanics/ |
| Kerrigan04 | Kerrigan JR et al. "Tolerance of the human leg and thigh in dynamic latero-medial bending." Int J Crashworthiness 2004. doi:10.1533/ijcr.2004.0315 (abstract) https://data.zhenzhi.com/details/1/911413090 |
| Pintar98 | Pintar FA, Yoganandan N, Eppinger RH. "Response and tolerance of the human forearm to impact loading." Stapp 1998, SAE 983149. https://saemobilus.sae.org/content/983149 |
| Kirkish96 | Kirkish SL, Begeman PC, Paravasthu NS. Humerus reference values, 1996. https://swov.nl/en/publicatie/proposed-provisional-reference-values-humerus-evaluation-injury-potential |
| Viano89 | Viano DC et al., lateral pelvic impacts, 27% compression tolerance (abstract via search). https://trid.trb.org/view/302819 |
| Walilko05 | Walilko TJ, Viano DC, Bir CA. "Biomechanics of the head for Olympic boxer punches to the face." Br J Sports Med 2005;39:710-719. https://pmc.ncbi.nlm.nih.gov/articles/PMC1725037 |
| HennLignitz04 | Henn V, Lignitz E. "Kicking and trampling to death." Forensic Pathology Reviews vol. 1, 2004, as summarised at https://www.forensicmed.co.uk/wounds/blunt-force-trauma/patterns/ |
| Guo26 | Guo L et al. "Biomechanical effects of sex and bat size on head-directed blunt strikes." Front Bioeng Biotechnol 2026. doi:10.3389/fbioe.2026.1797941 (read in full, PMC13201234) |
| Zhang25 | "Biomechanical Investigation of Head Injuries Caused by Baseball Bat Strikes with Different Bat Sizes and Velocities: A Finite Element Simulation Study." Life (Basel) 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12843303/ |
| Goots18 | Goots AC, Isa MI, Fenton TW et al. "Estimating points of impact in multiple blunt force cranial trauma." AAFS 2018 abstract A35 (12 unembalmed heads; hammer, bat, brick impactors). https://www.aafs.org/sites/default/files/media/documents/AAFS-2018-A35.pdf |
| Desmoulin07 | Desmoulin GT, Anderson GS. Pilot study of contusion thresholds in living humans (abstract). https://ibrc.osu.edu/wp-content/uploads/2014/01/Desmoulin_Abstract_2007.pdf |
| FM-Bruise | forensicmed.co.uk, Bruises (cites Saukko & Knight 2004, Thali, Dolinak & Matshes). https://www.forensicmed.co.uk/wounds/blunt-force-trauma/bruises/ |
| FM-Age | forensicmed.co.uk, Ageing bruising (summarises Langlois & Gresham 1991, Stephenson & Bialas 1996, Bariciak 2003, Maguire 2005, Munang 2002, Hughes 2004/2006). https://forensicmed.co.uk/wounds/blunt-force-trauma/bruises/ageing-bruising |
| FM-Abr / FM-Lac | forensicmed.co.uk, Abrasions / Lacerations. https://www.forensicmed.co.uk/wounds/blunt-force-trauma/abrasions/ , https://www.forensicmed.co.uk/wounds/blunt-force-trauma/lacerations/ |
| RCH | Victorian Forensic Paediatric Medical Service (Royal Children's Hospital Melbourne), "Interpretation of skin injuries" teaching notes. https://www.rch.org.au/uploadedFiles/Main/Content/vfpms/Interpretation%20of%20skin%20injuries%20notes.pdf |
| LanglGresh91 | Langlois NEI, Gresham GA. "The ageing of bruises." Forensic Sci Int 1991;50:227-238. https://pubmed.ncbi.nlm.nih.gov/1748358/ |
| Maguire05 | Maguire S et al. Arch Dis Child 2005;90:187-189 (bruise ageing, systematic review). https://pmc.ncbi.nlm.nih.gov/articles/PMC1720275 |
| Abrasion-age | Abrasion ageing by colour, autopsy studies (msjonline / IJRMS; Choyal et al.). https://www.msjonline.org/index.php/ijrms/article/view/17431 |
| deBoer21 | de Boer HH, Berger CEH, Blau S. "Providing a forensic expert opinion on the 'degree of force'." Biology 2021;10:1336 (PMC8698358) |
| Merck-TBI | Merck Manual Professional, Traumatic Brain Injury. https://www.merckmanuals.com/professional/injuries-poisoning/traumatic-brain-injury-tbi/traumatic-brain-injury-tbi |
| Merck-Rib / -Flail / -Hemo / -TPx / -PC / -BCI | Merck: rib fracture, flail chest, hemothorax, tension pneumothorax, pulmonary contusion, blunt cardiac injury. Base: https://www.merckmanuals.com/professional/injuries-poisoning/thoracic-trauma/ (+ `rib-fracture`, `flail-chest`, `hemothorax`, `tension-pneumothorax`, `pulmonary-contusion`, `blunt-cardiac-injury`) |
| Merck-Abd / -Spleen / -Liver | Merck: overview of abdominal trauma, splenic injury, hepatic injury. Base: https://www.merckmanuals.com/professional/injuries-poisoning/abdominal-trauma/ (+ `overview-of-abdominal-trauma`, `splenic-injury`, `hepatic-injury`) |
| Merck-Fx / -CS | Merck: overview of fractures; compartment syndrome. https://www.merckmanuals.com/professional/injuries-poisoning/fractures/overview-of-fractures , .../fractures/compartment-syndrome |
| WP-EDH / -SDH / -DAI / -Coup | Wikipedia, citing StatPearls (Khairat & Waseem) and others: https://en.wikipedia.org/wiki/Epidural_hematoma , https://en.wikipedia.org/wiki/Subdural_hematoma , https://en.wikipedia.org/wiki/Diffuse_axonal_injury , https://en.wikipedia.org/wiki/Coup_contrecoup_injury |
| BSF | Battle sign / raccoon eyes timing: https://en.wikipedia.org/wiki/Battle%27s_sign ; emDocs https://www.emdocs.net/basilar-skull-fracture-basics-beyond/ |
| Lifshitz09 | Hosseini AH, Lifshitz J. "Brain injury forces of moderate magnitude elicit the fencing response." Med Sci Sports Exerc 2009;41:1687-1697. https://pubmed.ncbi.nlm.nih.gov/19657303 ; summary https://sciencedaily.com/releases/2009/09/090902133643.htm |
| Funk11 / Rowson12 | Concussion risk from head acceleration: Funk JR et al., Ann Biomed Eng 2011; Rowson S et al., Ann Biomed Eng 2012 doi:10.1007/s10439-011-0392-4. https://pmc.ncbi.nlm.nih.gov/articles/PMC3217524 , https://link.springer.com/content/pdf/10.1007/s10439-011-0392-4.pdf ; review https://practicalneurology.com/articles/2015-apr/helmets-sensors-and-more-a-review |
| Link98 | Link MS et al. "An experimental model of sudden death due to low-energy chest-wall impact (commotio cordis)." NEJM 1998;338:1805. https://pubmed.ncbi.nlm.nih.gov/9632447/ |
| FMVSS208 | 49 CFR 571.208 (HIC15 limit, chest deflection). https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-571/subpart-B/section-571.208 |
| Falls25 | "Fatal Free Falls: A Clinical and Forensic Analysis of Skeletal Injury Patterns Using PMCT and Autopsy." J Clin Med 2025 (PMC12653207, 79 cases) |
| CRT | Concussion Recognition Tool 6 (Concussion in Sport Group), as reproduced: https://assets.fis-ski.com/f/252177/x/b3ffcf0345/crt6_fis.pdf ; https://www.coach.ca/sites/default/files/documents/2024-09/poster-2-recognizing-a-potential-concussion.pdf |
| FemurBlood | Femur / pelvis blood loss, secondary teaching sources: https://www.crisis-medicine.com/femur-fracture-blood-loss/ ; UCT open book https://openbooks.uct.ac.za/uct/catalog/download/36/53/1794?inline=1 |

Not obtained in full (paywalled or bot-blocked) and therefore not quoted directly: Saukko & Knight *Knight's Forensic Pathology*, DiMaio & DiMaio, Spitz & Fisher, Vanezis 2001 (J Clin Pathol 54:348), StatPearls pages, Nyquist 1985 tibia paper. Where their content reaches this file, it does so through the summaries listed above.

---

## 1. Contusions (bruises)

### Facts

- A bruise is bleeding from ruptured small vessels (mostly veins, venules, small arterioles) into tissue under intact skin (FM-Bruise; RCH). Haematoma = blood collected in a space, usually with swelling. Petechiae = pinpoint bleeds 0.1-2 mm (RCH). [C]
- **Appearance timing.** Superficial (subepidermal/intradermal) bruises show quickly and can fade quickly. Deep bruises may not be visible for a time, sometimes never at the surface; blood percolates up from deeper tissue, keeps leaking from vessels, and haemolysed haemoglobin stains more than intact cells, so a bruise "comes out" over hours to days (RCH; FM-Bruise). No source gave a measured hour figure. [C]
- **Location vs impact.** Blood tracks along fascial planes and under gravity, so a bruise is not necessarily at the impact site. Examples: scalp/forehead impact → periorbital bruise ("black eye" by tracking); basal skull fracture → mastoid (Battle sign) and periorbital (raccoon eyes) bruising (FM-Bruise; RCH). Subgaleal haematoma can track behind the ears and mimic Battle sign (RCH). [C]
- **Where bruising is easy or hard.** Lax tissue bruises easily (periorbital, scrotum); palms and soles rarely show bruises (FM-Bruise; RCH). Tissue over bone (head, chin, shin) bruises more than resilient padded areas (buttocks, abdominal wall) (RCH). Elderly: fragile vessels, larger and longer-lasting bruises. Anticoagulants, aspirin, steroids and bleeding disorders increase bruising. Dark skin hides bruises (RCH). [C]
- **Size is a poor guide to force.** "The size of the bruise or its presence are not always a reflection of the degree of force"; 72% of childhood fractures have no overlying bruise (RCH). [C]
- **Bruising threshold (living volunteers).** Pilot study, dropped mass on an impactor resting on skin: 50% bruising threshold at transmitted impulse 5.9 N·s and work (F×d) 3.2 J (Desmoulin07). Preliminary abstract. [M]
- **Abdominal wall bruising** after trauma (e.g. "seat belt sign", a transverse linear ecchymosis) has poor sensitivity and specificity for internal injury (Merck-Abd). Abdominal organs can be torn under unbruised skin. [C]

### Patterned bruises

| Pattern | Cause | Look | Source |
|---|---|---|---|
| Tramline (railway) | Rod, stick, bat, pipe, cane | Two parallel linear bruises with a pale central strip. Tissue under the rod is compressed and its vessels survive; blood is pushed sideways and vessels at the edges tear. A rigid rod marks only the convex part of the body it contacts (a soft buttock flattens and takes a longer mark); a flexible cord wraps around and leaves a longer, curved tramline, sometimes with looped ends | RCH; FM-Bruise; search summary [C] |
| Tramline, caveat | Fall onto a flat surface over ribs | Linear parallel bruising can come from ribs pressing skin against the ground; not pathognomonic of a rod in adults | Tattoli & Tsokos 2014, case report (via search) [C] |
| Intradermal patterned | Hard patterned surface (shoe sole, tyre, clothing seams) | Skin over ridges stays pale; skin forced into grooves bleeds just under the epidermis, so the bruise prints the groove pattern | RCH; Saukko & Knight via FM-Bruise [C] |
| Fingertip | Grip | Small round/oval discs in clusters, a little larger than fingertips, blurred if the victim struggled | RCH [C] |
| Slap | Open hand | Parallel linear bruises (often petechial) with spared strips between, usually on the cheek | RCH [C] |
| Doughnut | Ball or round hard object | Ring with spared centre | RCH [C] |
| Kick/stamp | Shoe | Abrasions, lacerations and intradermal bruises mirroring the sole and heel outline; pattern lost if the blow lacerates | HennLignitz04 [C] |
| Defensive | Raised arm warding off blows | Bruises clustered on outer forearm and arm, same-side shoulder and upper back | RCH [C] |

Tramline geometry: no source quantified band width or gap versus rod diameter. Use pale gap ≈ the rod's flattened contact width and bands of a few mm each, widening and blurring over hours. [E]

### Colour over time

Mechanism: haemoglobin (red/purple/blue) is broken down by macrophages to biliverdin (green) and bilirubin (yellow), later haemosiderin (brown). Haemoglobin absorbs most at 415 nm, bilirubin at 460 nm (Hughes 2006, via FM-Age). Change starts at the margins, so large bruises take longer and show rings (FM-Age). [C]

| Observation | Timing | Source |
|---|---|---|
| Red, blue, purple | Early, but can persist or reappear for days; any colour can appear at any age | Stephenson & Bialas 1996; Bariciak 2003 (via FM-Age; RCH) |
| Yellow | Not seen before 18 h; seen after 24 h (Stephenson & Bialas), after 48 h (Carpenter); not every bruise turns yellow | LanglGresh91 (369 photos, 89 subjects); FM-Age |
| Green / yellow / brown | More common after ~7 days, heavy overlap with fresh colours | Bariciak 2003 via FM-Age |
| Old textbook timetable | Green 4-7 days, yellow ≥7 days | FM-Age (described as traditional, not supported) |
| Resolution | Days to weeks; slower in elderly | FM-Bruise |

Caveats: ageing from colour has "no scientific basis" in children (Maguire05). Observers agree on colour in only ~1 in 10 bruises; dating within 24 h was right 40% of the time (FM-Age). Separate bruises from one assault can change at different rates (FM-Age).

### What to draw
- [ ] Bruises as a blurred stain in dermis/subcutis, not a sharp decal. Shallow ones sharp-edged early; deep ones diffuse and late.
- [ ] Bruise placement offset by gravity and fascial planes for deep bleeds (forehead → eyelids over a day; mastoid/eye bruising 1-3 days after a basal skull fracture).
- [ ] Tramlines for bat/pipe/rod strikes on curved surfaces (forearm, thigh, back, buttock); flat-faced or tumbling objects give blotches.
- [ ] Intradermal pattern prints for shoes and textured objects.
- [ ] Colour shader driven by age and size: red-purple core, margins turning green-yellow first; yellow never before 18 game-hours.
- [ ] Much more bruising over bone (shin, skull, chin, ribs) than over buttock/belly for the same hit.

### What to simulate
- [ ] Per-hit: energy and contact patch → bleed volume. Threshold around 3 J delivered to skin for a visible bruise (Desmoulin07); scale volume with energy and anvil (bone underneath).
- [ ] Visibility(t) per depth layer: superficial immediate; deep rises over hours to a day+ [E].
- [ ] Age, anticoagulant, frailty multipliers on volume.
- [ ] Keep bruise and internal damage decoupled: big internal injury with little or no skin sign must be possible.

---

## 2. Abrasions

### Facts
- Loss of the epidermis by tangential friction, or by pressure with movement; usually not full thickness; bleeds/oozes if papillary dermis is reached (FM-Abr). Clinically minor, heals by scab without scarring (RCH). [C]
- Types (RCH): **scrape/graze (brush, scuff)**, broad, from sliding over a rough surface (pavement, floor after a fall); **scratch/linear**; **impact/imprint**, from a direct perpendicular hit, which reproduces the striking surface (shoe tread, tyre, weapon face). An abrasion always marks the site of contact (RCH). [C]
- **Direction cue:** scraped epidermis is heaped at the end away from where contact began, so the direction of travel can be read (FM-Abr). Fine parallel scratch lines run along the direction of slide. [C]
- Trace material (grit, fibres, paint) is often embedded (RCH). [C]
- **Healing / ageing (autopsy and clinical studies, approximate):** bright red 0-4 h (earliest 10 min, up to ~6 h); reddish scab routinely 12-24 h; reddish-brown scab 24-72 h (2-3 days); dark brown 4-6 days; black, then scab separation 7-14 days; fibroblasts ~71 h, collagen ~96 h (Abrasion-age). Variable between people. [M]
- Post-mortem abrasions do not scab; they dry to a yellow-brown parchment look. I could not obtain a citable source for this standard textbook statement. [E]

### What to draw
- [ ] Brush abrasion on falls: broad, parallel striations, epidermal flakes heaped at the far end, grit in the wound.
- [ ] Imprint abrasion on direct hits: the bat's curved face gives a band; a brick or rock face gives its outline; knuckles give 2-4 small round abrasions.
- [ ] Wet glistening red at first, then scab colour by age (table above).

### What to simulate
- [ ] Tangential velocity component at contact → abrasion; normal component → bruise/laceration/fracture.
- [ ] Record slide direction per abrasion so the heaped end is at the exit side.

---

## 3. Blunt lacerations

### Facts
- Skin and subcutis **crushed and split**, typically where skin is pinned against bone: scalp, eyebrow, cheekbone, chin, knee, shin (FM-Lac; RCH). Also from shear or stretching by an oblique protruding object, or from rolling/grinding (wheel) and entanglement (scalp "flap" laceration) (FM-Lac; RCH). [C]
- Features vs incised wounds (FM-Lac; RCH): [C]

| Feature | Blunt laceration | Incised (blade) |
|---|---|---|
| Edges | Ragged, irregular, often abraded and bruised margins | Clean, straight, no bruising |
| Depth | Variable | Fairly uniform; length > depth |
| Tissue bridges | Present: nerves, vessels, connective tissue strands stretch across the floor of the wound unbroken | Absent, everything divided |
| Hairs | Intact hairs cross the wound; hair bulbs crushed | Hairs cut cleanly |
| Contamination | Often (dirt, grit, fibres) | Usually clean |
| Bone | Fracture may lie underneath | Bone may be scored or chipped |
| Healing | Secondary intention, broader scar | Primary intention, fine scar |

- **Undermining:** with an oblique blow the skin is torn from the underlying tissue on the side toward which the force travelled, leaving a pocket under that edge (study-aid summaries only; Saukko & Knight content not obtained). [E]
- Shape follows weapon and anatomy: a rod or bat edge over the skull gives a linear or stellate split; a hammer face gives a curved or circular laceration over a depressed fracture of matching curve (FM patterns page). [C]
- Scalp lacerations bleed heavily because the scalp is very vascular and held open by the galea. [E, standard clinical teaching, not sourced here]

### What to draw
- [ ] Split-type wound over bone with abraded, bruised rim 1-5 mm wide [E for the width], irregular zig-zag edges, tissue bridges visible in the depth, intact hairs crossing.
- [ ] Linear split for bat edge; Y or stellate split where a rounded mass hits the convex skull; curved for hammer face.
- [ ] Grit/fibre specks in the wound.
- [ ] Never a clean straight edge; that is the knife's look.

### What to simulate
- [ ] Laceration when local compressive strain over a bony anvil exceeds skin capacity; prefer bony prominence sites. Use `tissue-mechanics.md` skin failure numbers as the material side.
- [ ] Scalp/face lacerations bleed far more than limb ones of the same size.
- [ ] Underlying fracture check at the same contact point.

---

## 4. Skull and facial fracture

### Thresholds: cranial vault

| Region / setup | Value | Tag / source |
|---|---|---|
| Whole skull, quasi-static vs dynamic, 12 heads, 5 regions | Failure 4.5-14.1 kN; mean 6.4 kN quasi-static, 11.9 kN dynamic; energy to fracture 14.1-68.5 J; deflection 3.4-16.6 mm | M, Yoganandan 1995 (J Neurotrauma 12:659) via search and Guo26 |
| Gurdjian drop tests (whole heads onto steel), velocity to fracture | Anterior parietal 5.8 ± 0.5 m/s; posterior parietal 5.6 ± 0.5; mid frontal 4.6 ± 0.3; occipital 4.9 ± 0.4 m/s | M, Yoganandan04 Table 1 |
| Gurdjian, ranking | Occipital weakest, then mid-frontal, posterior parietal, anterior parietal | M, Yoganandan04 |
| Hodgson drops onto rigid plate, mean fracture force | Occiput (flat) 15.9 kN; side (flat) 10.2 kN; front (flat) 7.6 kN; front (1 in radius cylinder) 8.7 kN; front (3 in hemisphere) 4.6 kN; frontal boss (1 in cylinder) 5.8 kN. Pulse 3-8 ms, 190-375 g | M, Yoganandan04 Table 3 |
| Hodgson, whole cadavers dropped 12.7-114.3 cm (1.6-4.7 m/s) onto rigid plate | 6 of 7 had linear fractures; 5.6-17.8 kN | M, Yoganandan04 |
| Frontal, 6.5 cm² impactor | 2.67-9.88 kN at 3.1-7.1 m/s, 25-134 J | M, AI-Skull (Nahum) |
| Temporo-parietal, 6.5 cm² | Mean 3.12 ± 0.62 kN (F), 3.94 ± 1.29 kN (M); suggested minimum tolerance 2.0 kN (F), 2.45 kN (M) | M, Yoganandan04 (Nahum 1968) |
| Temporo-parietal, Schneider & Nahum | Fracture 3.6 ± 1.0 kN at 5.6 m/s; non-fracture 3.2 ± 1.4 kN at 5.4 m/s (overlap) | M, Yoganandan04 Table 2 |
| Lateral, Stalnaker pneumatic | 4.2-9.6 kN (mean 6.1), tolerance about 5 kN | M, AI-Skull |
| Temporal bone | Thinner than frontal, parietal, occipital; more compliant | M, Yoganandan04 |
| Skull fracture, HIC | HIC 800 ≈ 50% risk (occipital/lateral, McIntosh) | M, AI-Skull |
| Contact area | Halving impactor size about doubles probability of failure | M, Yoganandan via Zhang25 |

### Thresholds: facial bones (AI-Skull, all [M])

| Bone | Force range | Notes |
|---|---|---|
| Nasal | Not determined; lowest of the face | Nahum 1975 cylinder tests all broke the nose at least |
| Maxilla | 0.63-1.98 kN (6.5 cm²); 1.0-1.8 kN (2 cm bar) | ~25% of frontal bone strength |
| Zygoma | 0.61-3.47 kN; 0.9-2.4 kN (bar) | |
| Zygomatic arch | 0.93-1.94 kN | |
| Mandible, lateral | 0.82-3.4 kN | |
| Mandible, symphysis (chin, AP) | 1.9-4.1 kN | |
| Forces > 3 kN | Associated with maxilla, zygoma and frontal fractures | Nyquist |

### Fracture morphology (what forms where)
- **Linear fractures** start away from the contact point where the skull bends outward in tension, then run toward and along the base (Gurdjian, via Yoganandan04). [M]
- **Bat** (2.5 in cylinder, ~112 J, unembalmed heads): semicircular fractures only partly circling the point of impact (5/12 impacts), internally bevelled bone plugs (3/12), linear fractures distant from the impact; at least one impact site per head was hard to locate. **Hammer** (1 in flat face): circular fractures around the impact (9/12) and bone plugs (8/12). **Brick** (3 in flat): semicircular (5/12), linear fractures starting at sutures, crossing earlier fractures (Goots18). [M]
- **Hammer face** → curved laceration over a depressed curved-edged fracture (FM patterns). [C]
- **Basilar fracture** signs: Battle sign (mastoid bruise), raccoon eyes (periorbital), CSF from nose/ear, blood behind the eardrum; loss of smell/hearing immediate (Merck-TBI). Bruise signs usually appear 1-3 days later, some sources from 6-12 h (BSF). [C]
- Repeated blows: later fractures stop at earlier fracture lines (Goots18, brick).

### What to draw
- [ ] Bat to vault: scalp split (linear) over a partly ringed depressed area with long linear cracks running away; brain injury under it.
- [ ] Hammer/rock edge: round or curved depression matching the face, punched-in plug.
- [ ] Face: nasal deformity and nosebleed on any solid punch to the nose; cheek flattening (zygoma); jaw malocclusion/step.
- [ ] Delayed Battle sign / raccoon eyes on basal fractures.

### What to simulate
- [ ] Per region tolerance with random per-body scaling (e.g. log-normal, σ ≈ 30-40%) [E]; temporal lowest, occipital/parietal highest under flat contact.
- [ ] Inputs: impact energy, contact area, region. Energy gate ~14-68 J for vault fracture (Yoganandan 1995); force gate per tables.
- [ ] Facial fracture order of ease: nasal < maxilla ≈ zygomatic arch < zygoma < mandible < frontal.

---

## 5. Brain injury

### Types and time course

| Injury | Mechanism | Onset and course | Source |
|---|---|---|---|
| Concussion | Acceleration of the head, no structural lesion | Altered mental state seconds to minutes, sometimes hours; LOC usually seconds-minutes; amnesia for seconds to hours before injury; symptoms clear over weeks | Merck-TBI [C] |
| Cerebral contusion, coup | Under the impact; typical when a moving object hits a still head | Can enlarge over hours to days | WP-Coup; Merck-TBI [C] |
| Contusion, contrecoup | Opposite pole; typical when a moving head hits a still surface (fall). Most common on the underside of the frontal lobes and tips of the temporal lobes | Same | WP-Coup [C] |
| Epidural (extradural) haematoma | Skull fracture tears an artery, mostly middle meningeal; ~10% venous; adults 75% temporal | Symptoms minutes to hours; arterial bleed can peak 6-8 h; lucid interval in 14-21%; then headache, vomiting, seizures, same-side blown pupil, opposite-side weakness, posturing; mortality up to 12.5% adults | WP-EDH (StatPearls), Merck-TBI [C] |
| Acute subdural haematoma | Tearing of bridging veins by acceleration/deceleration (rotation) | Minutes, up to ~2 weeks; slower than EDH; 50-90% mortality depending on brain injury underneath | WP-SDH [C] |
| Chronic subdural | Minor trauma, elderly, alcohol, anticoagulants | Symptoms usually > 3 weeks after, over weeks | WP-SDH; Merck-TBI [C] |
| Diffuse axonal injury | Shear from rapid rotational acceleration/deceleration; corpus callosum, brainstem, grey/white junction | LOC > 6 h (clinical diagnosis), often GCS < 9; > 90% of severe DAI never regain consciousness; can deteriorate after seeming well | Merck-TBI; WP-DAI [C] |
| Traumatic subarachnoid haemorrhage | Common with TBI, over the convexities | | Merck-TBI [C] |

Raised pressure and herniation (Merck-TBI) [C]:
- Dilated, non-reacting pupil → usually herniation; transtentorial herniation → coma, dilated pupil(s), opposite-side paralysis.
- Cushing triad at ICP ≥ 25 mmHg: hypertension with wide pulse pressure, bradycardia, slow irregular breathing.
- Decorticate posturing (arms flexed onto chest, legs extended) and decerebrate (arms and legs extended, wrists pronated) are poor prognostic signs.
- Vomiting can occur with raised ICP (nonspecific). Seizures often within the first hour or day.
- GCS: eyes 1-4, verbal 1-5, motor 1-6; mild 13-15, moderate 9-12, severe 3-8; ≤ 8 is coma. Treated severe TBI mortality 25-33%.

### Head acceleration and HIC

- HIC = max over [t1,t2] of (t2−t1)·[mean resultant acceleration in g over the window]^2.5 (Yoganandan04). Limit 1000 in the original criterion (Yoganandan04); current US crash standard HIC15 ≤ 700 for the mid-size male dummy (FMVSS208). [M]
- Concussion: Pellman's "50%" nominal values of 80 g and HIC 250 were later estimated to be ~1% risk (Funk11). NFL concussion reconstructions: 98 ± 28 g, 6432 ± 1813 rad/s² (via Rowson12 search summary). Concussion "possible" at 45 g / 3500 rad/s², ~50% risk at 5500 rad/s² (Practical Neurology review). High-school CART: > 96 g and > 5582 rad/s². No accepted threshold exists. [M, sports data]
- Fencing response (forearm(s) held stiffly flexed or extended in the air immediately after impact): seen in two thirds of knock-out videos; marks moderate TBI; often begins before the body reaches the ground (Lifshitz09). [M, video + rat]
- Lateral impacts are more injurious to the brain than front-back ones (Yoganandan04). [M]

### What to draw
- [ ] Nothing visible for concussion, DAI, early SDH. The look is entirely behavioural (section 10).
- [ ] At autopsy/open skull: contusions as clustered haemorrhages in the cortex surface (frontal/temporal tips for falls); EDH as a lens-shaped clot between skull and dura under a temporal fracture; SDH as a crescent film over the hemisphere.
- [ ] Blood/CSF from nose or ear with basal fracture.

### What to simulate
- [ ] Head state from peak linear g, peak rotational acceleration and HIC per hit (rigid-body head on a neck). Thresholds: ~60-100 g or ~4500-6500 rad/s² → concussion chance; repeated hits stack. [D from figures above]
- [ ] Coup bias when a weapon hits a free head; contrecoup bias when the moving head hits ground.
- [ ] EDH: only with temporal/parietal fracture; timer for lucid interval (minutes-hours), deterioration, pupil, posturing, death without surgery.
- [ ] SDH: rotational loading, age/alcohol multiplier, slower timer.
- [ ] DAI: high rotational acceleration → immediate LOC lasting hours or permanent.

---

## 6. Chest

### Thresholds

| Quantity | Value | Tag / source |
|---|---|---|
| Rib fracture onset, chest compression | > 20% regularly fractured ribs in 5-7 m/s sternal impacts; 40% → flail chest | M, AI-Thorax (Kroell) |
| Deflection | No rib fractures below 2.3 in (58 mm); more frequent above 3 in (76 mm) | M, AI-Thorax (Stalnaker & Mohan; Melvin) |
| Kroell AIS from compression | C = 30% → AIS 2; 40% → AIS 4 (230 mm chest depth: 69 mm and 92 mm) | M, AI-Thorax |
| Viscous criterion (V·C) | VCmax 1.0 m/s ≈ 25% and 1.3 m/s ≈ 50% probability of thoracic AIS > 3 (39 PMHS sternal impacts) | M, AI-Thorax |
| Lateral impact, 23.4 kg impactor at 4.3 m/s | 1.6-1.9 kN chest force, 4-13 rib fractures | M, AI-Thorax (Leport) |
| Age | AIS 3 tolerance falls to 0.47 (36-65 y) and 0.28 (66-85 y) of young adult, belt loading | M, AI-Thorax (Zhou) |
| Lung contusion | Rate dependent (velocity), unlike rib fracture (deflection dependent) | M/A, AI-Thorax |
| Commotio cordis | VF in 9 of 10 impacts landing 15-30 ms before the T-wave peak; 30 mph (13 m/s) baseball-sized projectile; regulation balls worse than soft balls | A (swine), Link98 |
| Ventricular fibrillation in sternal impacts | 11 of 23 swine at 15-30 m/s | A, AI-Thorax (Kroell) |
| Ribs cracked by a bat | Merck lists "a baseball bat" among typical causes | C, Merck-Rib |

AIS scoring for chest (AI-Thorax Table 13.1, AAAM 2008): 1 rib fracture AIS 1; 2 ribs AIS 2; ≥ 3 ribs AIS 3; sternum fracture AIS 2; lung contusion AIS 3; unilateral flail 3-5 ribs AIS 3, > 5 ribs AIS 4; bilateral flail AIS 5; tension pneumothorax AIS 5; major heart contusion AIS 4.

### Injuries, signs, timing (all [C])
- **Rib fractures:** pain on moving, coughing and deep breathing lasting weeks to months; point tenderness, crepitus; patient breathes shallowly to avoid pain ("splinting") → atelectasis, pneumonia. Ribs 1-2 → think aorta/subclavian/heart; ribs 7-12 → spleen and other abdominal injury. Elderly with multiple fractures: mortality up to 20% (Merck-Rib).
- **Flail chest:** ≥ 3 adjacent ribs each broken in ≥ 2 places; the segment moves in on breathing in and out on breathing out; severe pain, dyspnoea, fast breathing; nearly always with lung contusion beneath (Merck-Flail).
- **Pneumothorax:** from a rib end puncturing pleura (AI-Thorax). Tension: early dyspnoea, chest pain, reduced breath sounds; then hypotension, trachea shifts away, neck veins distend; affected side hyper-resonant, may look over-expanded; can develop rapidly (Merck-TPx).
- **Haemothorax:** from lung, intercostal or internal mammary vessels; visible on X-ray from ~500 mL; massive ≥ 1500 mL; dyspnoea, dull to percussion, shock (Merck-Hemo).
- **Pulmonary contusion:** bleeding and oedema of lung; X-ray changes may lag 24-48 h; dyspnoea and hypoxia can worsen gradually (Merck-PC).
- **Blunt cardiac injury:** arrhythmias (atrial fibrillation most common), unexplained tachycardia or hypotension; commotio cordis = sudden VF arrest from a blow over the heart in a normal heart (Merck-BCI).
- **Aortic rupture** (falls, high deceleration): 90% at the isthmus; 80-85% die at the scene (AI-Thorax). Unlikely from bat or fist.

### What to draw
- [ ] Bat to chest: tramline or band bruise over ribs, visible step or crepitus if displaced; flail segment sucking in on inhalation.
- [ ] Tension pneumothorax: one side of chest stays expanded, neck veins bulge, lips grey-blue [E for colour].
- [ ] Coughing blood only with lung laceration/contusion (hemoptysis listed for flail chest, Merck-Flail).

### What to simulate
- [ ] Chest compression ratio C and V·C from the impact (impactor mass, speed, contact area against a chest stiffness ~ tens of N/mm for distributed loading, AI-Thorax). Rib count from C.
- [ ] Each fractured rib: chance of pneumothorax and haemothorax; ribs 7-12 add spleen/liver risk.
- [ ] Commotio cordis: small chance on any precordial hit in the 15-30 ms window per heartbeat (15 ms of a 600-1000 ms cycle, ~1.5-2.5%) [D]; instant collapse.
- [ ] Breathing model: rate up, depth down with rib pain; paradoxical segment with flail; progressive SpO2 fall with contusion over hours.

---

## 7. Abdomen and pelvis

### Facts
- Most injured organ in blunt trauma: spleen, then liver, then hollow viscus (small bowel) (Merck-Abd). [C]
- Soft-tissue injury is compression and rate dependent: with compression held at 16%, liver injury rose as velocity went from 5 to 20 m/s (rabbits) (AI-Thorax, Lau & Viano). Viscous criterion applies to abdomen too. [A]
- **Spleen:** LUQ pain referring to left shoulder; obvious shock with major bleeding. Subcapsular haematoma can rupture "from hours to even months" after injury, usually in the first few days. Grades 1-5 by haematoma surface area and laceration depth (Merck-Spleen). [C]
- **Liver:** RUQ pain, sometimes referred to right shoulder; subcapsular haematoma to deep lacerations; small ones stop by themselves (Merck-Liver). [C]
- **Bowel:** pain of small-bowel perforation is minimal at first and worsens steadily over the first hours; intramural haematoma can stricture 2 weeks-3 months later (Merck-Abd). [C]
- **Kidney:** haematuria (Merck-Abd). [C]
- **Haemorrhage signs:** abdominal distension after trauma suggests 2-3 L lost, but may be absent despite several units lost; guarding and rebound suggest intraperitoneal blood; shock: tachycardia, narrow pulse pressure, dusky skin, sweating, confusion, low urine, hypotension (Merck-Abd). [C]
- **Pelvis:** lateral pubic ramus fracture correlates with compression, tolerance 27% (Viano89). Female pelvis: 25% fracture risk at 3.16 kN; pedestrian-type loading 8.9 kN (20%) and 9.6 kN (50%); one PMHS series 3.8 kN (10%) and 7.1 kN (50%) (search summaries). [M]
- Pelvic fracture blood loss can be 2-4 L or more (retroperitoneal); teaching figure, not confirmed against ATLS (FemurBlood). [E]

### What to draw
- [ ] Usually little on the skin. Possible patterned bruise; distension late.
- [ ] At necropsy: subcapsular haematoma as a blood blister under the organ capsule; ragged parenchymal tears; free blood.

### What to simulate
- [ ] Abdominal hits: organ under contact point (LUQ spleen, RUQ liver/lower right ribs, flank kidney) gets damage from compression × velocity.
- [ ] Spleen/liver subcapsular haematoma with a delayed-rupture timer (hours-days); bleed rate per grade.
- [ ] Blood volume model with shock stages; distension visible only after ~2-3 L intraperitoneal.

---

## 8. Limbs and spine

### Thresholds (all [M] unless stated)

| Bone | Value | Source |
|---|---|---|
| Femur, mid-shaft lateral bending | 50% risk 447 N·m; distal third 372 N·m | Kerrigan04 |
| Femur, 3-point bending force | ~4.3 kN average (Funk 2004) | via search |
| Femur, axial knee load | 10 kN regulatory limit; shaft/proximal fractures at 6-10 kN in knee impacts | AI-KTH |
| Tibia, mid-shaft bending | ~320 N·m men, ~280 N·m women (Nyquist); 50% risk 312 N·m (Kerrigan); dynamic tolerance ~450 N·m, quasi-static 240 N·m (Crandall) | AI-Leg; Kerrigan04 |
| Tibia, axial | ~10.3 kN quasi-static; ~16.6 kN dynamic | AI-Leg (Crandall) |
| Humerus, 3-point bending | 230 N·m (50th male) / 130 N·m (5th female); dynamic female 154 ± 27 N·m; quasi-static ~1.33 kN | Kirkish96; AI-Upper |
| Forearm, 3-point bending | mean 94 N·m (±41); ~45-47 N·m for small low-density adults; drop tests 1.5-2.1 kN, 80-115 N·m; **ulna breaks before radius**; quasi-static ulna 630 N, radius 520 N | Pintar98; AI-Upper |
| Clavicle, axial | 1.48 ± 0.46 kN; most common fractured bone, direct blow to shoulder or fall | AI-Upper |
| Ankle | Inversion injury 21 ± 5 N·m unloaded, 77 N·m with 2 kN body load | AI-Leg (Funk) |
| Cervical spine, compression | 1.06 ± 0.27 kN (women), 2.24 ± 0.57 kN (men) at the neck; head-vertex impact mean 7.6 kN for injury; head-first drops 0.8-1.8 m gave extensive cervical/thoracic fractures | AI-Neck |
| Cervical spine, tension | Ligamentous 1.8 kN; with muscles 3.1-3.7 kN | AI-Neck |
| Cervical, axial torsion | 17.2 ± 5.1 N·m upper cervical injury | AI-Neck |
| Dynamic factor | Bone strength ×1.66-1.7 at impact rates vs slow loading | AI-Upper |

Fracture signs and course (Merck-Fx, Merck-CS) [C]:
- Pain immediate; swelling develops over several hours; deformity, point tenderness, crepitus. Hip fracture: may be unable to bear weight even with normal X-rays.
- Blood loss: femoral shaft commonly quoted 1-2 L hidden in the thigh; measured pre-surgery loss ~0.5-1.2 L (FemurBlood). [E/M]
- Fat embolism from long bones (mostly femur): breathing difficulty, confusion, petechial rash. Vascular injury can be hidden for hours.
- Compartment syndrome (lower leg, forearm most often; after fractures, crush, severe contusion): pain out of proportion, worse on passive stretch, tense compartment; diagnosed at > ~30 mmHg or within 30 mmHg of diastolic; paraesthesia and paralysis, then pallor and pulselessness late = necrosis. Merck gives no hour figure.

Falls (Falls25) [M]: fatal falls most often fracture skull, vertebrae and thorax; suicides tend to land feet-first (calcaneus, legs, pelvis, spine), accidental fallers more skull and arm fractures; skull fractures peak in falls < 6 m and > 20 m; more skull fractures → fewer pelvic fractures. Free-fall speed v = √(2gh): 1.6 m (head height when standing) → 5.6 m/s, which is inside Gurdjian's 4.6-6.4 m/s fracture range for an unprotected head hitting a hard floor [D].

### What to draw
- [ ] Long-bone fracture: angulation/shortening, limb rotated, swelling building over hours; open fracture shows bone end through a ragged wound.
- [ ] Forearm parry: bruise and possible ulna fracture on the outer forearm after a bat swing at a raised arm.
- [ ] Compartment syndrome: tight, shiny swollen calf or forearm.

### What to simulate
- [ ] Bending moment at the contact point from strike force × effective lever (3-point bending approximation) vs table values; ulna before radius.
- [ ] Weight-bearing loss on femur, tibia, pelvis, ankle, calcaneus fractures.
- [ ] Hidden blood loss per fracture into the shock model.
- [ ] Compartment pressure rise after crush/fracture over hours.

---

## 9. Weapons: what they deliver

| Source of load | Delivered | Compare with | Tag / source |
|---|---|---|---|
| Baseball bat, men, two hands, max effort at head height | Bat centre-of-mass speed 15.5 m/s (0.79 kg, 71 cm bat) and 16.4 m/s (0.45 kg, 53 cm); energy **112 ± 33 J** and **69 ± 17 J** | Skull fracture energy 14-68 J | M, Guo26 |
| Baseball bat, women | 11.0 / 12.6 m/s; **56 ± 17 J** / **40 ± 11 J** | Same | M, Guo26 |
| Other bat studies | 7-12 m/s, 67-311 J depending on bat mass and inertia | | M, Sprenger 2016 via Guo26 |
| Bat to head (FE model, 0.73 kg bat) | Intracranial pressure passes the 235 kPa "severe" level above 12 m/s (long bat) / 14 m/s (short), about 55 J; head 3 ms acceleration 150-360 g across 10-30 m/s; peak contact force tens of kN | Concussion ~60-100 g | D/model, Zhang25 |
| Bat-shaped cylinder on cadaver heads | ~112 J per hit produced fractures, often hard to localise | | M, Goots18 |
| Punch, Olympic boxers (straight) | 3427 ± 811 N; hand 9.1 m/s; effective mass 2.9 kg; head 58 ± 13 g and 6343 ± 1789 rad/s² | Rotational value ≈ 50% concussion risk; mandible lateral 0.82-3.4 kN | M, Walilko05 |
| Punch, untrained adults | Men 500-850 N; women 350-550 N | Nasal bone lowest; maxilla from 0.63 kN | M, HennLignitz04 |
| Kick | Men 750-1200 N; women 500-750 N; kicked dummy head 103 g | | M, HennLignitz04 |
| Kick/stamp assaults (series) | Head the main target; 64% skull/base/facial fractures; 42% died of blood loss | | M, HennLignitz04 |
| Thrown object | E = ½mv². Examples: 2 kg rock at 10 m/s = 100 J; 5 kg at 6 m/s = 90 J; brick ~2.5 kg at 8 m/s = 80 J. Throw speeds are my assumptions | Compare with skull/rib/limb tables; small contact faces focus force | D/E |
| Fall from standing onto hard floor | Head ~5-6 m/s; whole-head 650-1230 J drop energies in Gurdjian were with the head's full weight | Fracture velocities 4.6-6.4 m/s | D, Yoganandan04 |
| Single punch deaths | Usually two stages: the punch knocks the victim down, the head striking the ground causes the fatal injury (often contrecoup) | | E, Monash Lens 2025 https://lens.monash.edu/2025/05/29/1387622/behind-the-blow-why-coward-punch-laws-are-failing-to-deliver-justice |

Deductions [D]:
- A full adult bat swing to the head carries 1-3× the energy that fractured skulls in the lab. Expect fracture, contusion and concussion on most clean head hits from a man; women's swings sit near the threshold.
- An untrained punch rarely breaks the vault but can break the nose, cheek or jaw and can knock out by rotation. The fall afterwards is often worse than the punch.
- A bat to the forearm easily exceeds the 45-94 N·m forearm tolerance: ulna fracture is the expected defence injury.

---

## 10. NPC behaviour after injury (animation and AI)

| Injury | Immediate (0-10 s) | Minutes | Hours-days | Source |
|---|---|---|---|---|
| Concussion | Drop or stagger; LOC for seconds to minutes if any; lying motionless, disoriented, not responding; balance problems | Confusion, repeated questions (amnesia), headache, nausea | Symptoms clear over weeks | Merck-TBI; CRT [C] |
| Moderate TBI knockout | Fencing response: one or both arms stiffly raised/extended, often before hitting the ground; falls without protective reaction | Seizure possible within the first hour | | Lifshitz09; Merck-TBI [M/C] |
| DAI | Instant unconsciousness, stays out > 6 h | Posturing possible | Coma; may never wake | Merck-TBI; WP-DAI [C] |
| Epidural haematoma | Brief knock-out, then up and talking (14-21%) | Headache, vomiting, drowsiness | Minutes to hours: deteriorates, one pupil blown, opposite arm/leg weak, posturing, Cushing breathing (slow, irregular), death | WP-EDH; Merck-TBI [C] |
| Acute subdural | Often unconscious from the start (with contusion) or confused | Fluctuating consciousness, headache, vomiting | Can be delayed up to ~2 weeks | WP-SDH [C] |
| Basal skull fracture | Blood or clear fluid from nose/ear; deaf/no smell | | Black eyes and mastoid bruising after 1-3 days | Merck-TBI; BSF [C] |
| Rib fractures | Sharp gasp, clutches side, bends toward injury | Shallow fast breathing, avoids coughing, holds palm or pillow on the spot, stiff trunk movement | Weeks-months of pain | Merck-Rib [C] |
| Flail chest | Severe pain, cannot breathe in fully | Fast breathing, segment moves the wrong way | Worsening with contusion | Merck-Flail [C] |
| Tension pneumothorax | Short of breath, chest pain | Escalating distress, neck veins bulge, collapse | Death without decompression | Merck-TPx [C] |
| Commotio cordis | Collapses within seconds of a chest blow, unresponsive, no pulse (VF) | | | Merck-BCI; Link98 [C/A] |
| Spleen / liver | Winded, pain under the left/right ribs | Shoulder-tip pain on the same side, pallor, sweating, fast pulse, guarding the belly | Delayed rupture over hours-days: sudden collapse | Merck-Spleen; Merck-Liver; Merck-Abd [C] |
| Bowel perforation | Little pain at first | Pain worsening steadily, rigid belly | | Merck-Abd [C] |
| Long-bone fracture | Immediate pain, cannot use limb; leg: falls, cannot stand; arm: cradles it | Swelling builds over hours; shock from hidden blood loss (femur) | Fat embolism: breathlessness, confusion | Merck-Fx [C] |
| Compartment syndrome | | | Rising pain out of proportion, screams on passive stretch of toes/fingers, later numb and weak | Merck-CS [C] |
| Haemorrhagic shock (any) | | Fast pulse, pale/dusky skin, sweating, anxiety then confusion, low BP | Unconscious, death | Merck-Abd [C] |

Notes for the AI:
- "Guarding": keep a hand or arm over the injured region, curl toward it, avoid twisting [C, Merck-Rib/Abd].
- Vomiting after head injury: nonspecific, but persistent vomiting is a warning sign (Merck-TBI) → use as escalation cue.
- Posturing: decorticate = arms flexed onto the chest, fists clenched, legs extended; decerebrate = arms extended and internally rotated, legs extended; both mean deep brain/brainstem damage (Merck-TBI) [C].

---

## 11. Checklists

### What to draw (summary)
- [ ] Bruises with depth, age colour, gravity drift, patterns (tramline, fingertip, shoe, defence cluster).
- [ ] Abrasions with direction (heaped end), grit, scab age.
- [ ] Blunt lacerations over bone: ragged, rimmed, tissue bridges, intact hairs; heavy scalp bleeding.
- [ ] Skull: depressed/partly ringed fractures for bat and hammer, long linear cracks, bone plugs on the inner table; Battle sign and raccoon eyes delayed.
- [ ] Face: nasal deformity, cheek flattening, jaw step.
- [ ] Chest: band bruise, flail motion, asymmetric chest, bulging neck veins.
- [ ] Limbs: deformity, swelling over hours, open ends; outer-forearm defence injuries.
- [ ] Organs (open body): subcapsular blood blisters, parenchymal tears, contusion clusters on frontal/temporal tips, EDH lens, SDH crescent.

### What to simulate (summary)
- [ ] Contact model: energy, contact area, normal vs tangential velocity, bone "anvil" under the point.
- [ ] Per-tissue thresholds from the tables, scaled per body (age, sex, frailty) with random spread.
- [ ] Head: linear g, rotational acceleration, HIC → concussion/DAI/SDH; fracture → EDH timer.
- [ ] Chest: compression ratio and V·C → rib count, flail, pneumo/haemothorax, contusion; commotio cordis window.
- [ ] Abdomen: compression × velocity → organ grades; delayed rupture timers.
- [ ] Limbs: bending moment → fracture; weight-bearing loss; hidden bleeding; compartment pressure.
- [ ] Physiology timeline: blood volume, breathing, consciousness, pupils, posture, all driven by injury state over seconds to days.
- [ ] Decouple skin marks from internal damage.
