# Anterior abdominal wall: tissue mechanics for the cutting sim

Scope: fresh adult male cadaver, 1-2 days post mortem, refrigerated (~4 °C). #22 blade on #4 handle, gloved hand.
Sheet 1 = skin + subcutaneous fat. Sheet 2 = sheath/fascia + muscle + transversalis + peritoneum.
Confidence tags: **[M]** measured in human tissue; **[A]** animal tissue; **[D]** derived by me from measured numbers (method shown); **[E]** estimate with no direct source. Treat [D] and [E] as tuning starting points, not facts.

## Sources (cited by key below)

| Key | Source |
|---|---|
| Tahan16 | Tahan et al., J Physiol Anthropol 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4995748/ |
| Derraik14 | Derraik et al., PLoS One 2014;9:e86637 (17 MHz US, diabetic cohort, mean BMI 28). https://pmc.ncbi.nlm.nih.gov/articles/PMC3897752/ |
| JCDR | Abdominal fat thickness by BMI class, J Clin Diagn Res. https://www.jcdr.net/ReadXMLFile.aspx?id=11254 |
| Kriener23 | Kriener et al., "Mechanical Characterization of the Human Abdominal Wall Using Uniaxial Tensile Testing", Bioengineering 2023;10:1213 (fresh / fresh-frozen cadavers, 5 mm/min). https://pmc.ncbi.nlm.nih.gov/articles/PMC10604332/ |
| WhiteheadClarke23 | Whitehead-Clarke et al., Clin Biomech 2023;106:105989 (posterior rectus sheath). https://research-information.bris.ac.uk/en/publications/characterisation-of-human-posterior-rectus-sheath-reveals-mechani/ |
| Hollinsky07 | Hollinsky & Sandberg, Clin Biomech 2007;22:88-92 (66 post-mortem linea alba specimens). https://data.zhenzhi.com/details/1/906295202 |
| DeekenLake | Deeken & Lake, review of abdominal wall mechanics, J Mech Behav Biomed Mater 2017. https://profiles.wustl.edu/en/publications/mechanical-properties-of-the-abdominal-wall-and-biomaterials-util/ |
| Cooney16 | Cooney et al., human linea alba uni/biaxial, J Mech Behav Biomed Mater 2016;63. https://profiles.wustl.edu/en/publications/uniaxial-and-biaxial-tensile-stress-stretch-response-of-human-lin/ |
| RateRS13 | Rectus sheath loading-rate study, 17 samples / 3 subjects, J Mech Behav Biomed Mater 2013 (authors not confirmed; likely Martins et al.). |
| NiAnnaidh12 | Ní Annaidh et al., J Mech Behav Biomed Mater 2012;5:139 (back skin, 0.012/s, donors 81-97 y, tested 2-9 d post mortem at 4 °C). https://arxiv.org/abs/1302.3022 |
| Gallagher12 | Gallagher, Ní Annaidh et al., dynamic (1-2 m/s) human skin tension. https://researchrepository.ucd.ie/handle/10197/4772 |
| Flynn11 | Flynn, Taberner, Nielsen, Ann Biomed Eng 2011, in vivo skin pre-stress. https://doi.org/10.1007/s10439-011-0292-7 |
| Deroy17 | Deroy, Destrade, Mc Alinden, Ní Annaidh, skin tension lines, canine cadavers. https://arxiv.org/abs/1609.07267 |
| Dauendorffer08 | Dauendorffer et al., Br J Dermatol 2008, "Shrinkage of skin excision specimens" (in vivo to excised). https://data.zhenzhi.com/details/1/903813181 |
| Alkhouli13 | Alkhouli et al., Am J Physiol Endocrinol Metab 2013;305:E1427 (human SAT tension). https://www.pubmed.gov/24105412/ |
| Geerligs08 | Geerligs et al., Biorheology 2008 (porcine SAT rheometry). https://content.iospress.com/articles/biorheology/bir517 |
| ComleyFleck10 | Comley & Fleck, toughness of adipose tissue (trouser tear). https://pubmed.ncbi.nlm.nih.gov/20211469 |
| Yang15 | Yang et al., "On the tear resistance of skin", Nat Commun 2015;6:6649 (rabbit). https://www.nature.com/articles/ncomms7649 |
| Meyers477 | Meyers group, porcine skin Mode I/III toughness. https://meyersgroup.ucsd.edu/papers/journals/Meyers%20477.pdf |
| CutG | Skin cutting (scissors) energy ~2 kJ/m2: https://arxiv.org/pdf/2108.03014 ; Doran et al. 2004 abstract 2.79 ± 0.55 kJ/m2: https://asm.confex.com/asm/md2004/techprogram/paper_2014.htm |
| Morrow10 | Morrow et al., J Mech Behav Biomed Mater 2010;3:124 (rabbit muscle). https://digitalcommons.memphis.edu/facpubs/12910 |
| VanLoocke08 | Van Loocke, Lyons, Simms, J Biomech 2008, muscle relaxation (porcine). https://doi.org/10.1016/j.jbiomech.2008.02.007 |
| White18 | White et al. 2018, porcine peritoneum/mesentery. https://pure.ul.ie/en/publications/mechanical-characterisation-of-porcine-non-intestinal-colorectal-/ |
| Schaefer16 | Parietal peritoneum histomorphometry, Sci Rep 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4763997 |
| PeriTEM | Peritoneal fine structure TEM study (mesothelium thickness). https://digitum.um.es/digitum/bitstream/10201/18297/1/Peritoneal%20fine%20structure%20of%20inguinal%20hernia%20a%20transmission%20electron%20microscope%20study.pdf |
| Lancerotto11 | Lancerotto et al., abdominal subcutaneous layers, Surg Radiol Anat 2011. https://link.springer.com/article/10.1007/s00276-010-0772-8 ; trilaminar histology: https://pubmed.ncbi.nlm.nih.gov/25255112/ |
| Stab | UCD knife-stab study, skin puncture 10-20 N. https://www.engineersireland.ie/Engineers-Journal/Mechanical/the-mechanics-of-stabbing-assessing-stab-penetration-forces |
| Needle | Cadaver needle-puncture of skin 2.75-2.80 N. https://pure.psu.edu/en/publications/integrating-cadaver-needle-forces-into-a-haptic-robotic-simulator/ |
| Atkins | Atkins & Xu, slicing of soft solids (slice/push ratio). https://centaur.reading.ac.uk/11761/ ; worked example: https://scienceofsharp.com/2021/04/27/the-slice-cut/ |
| LimbsThings | Limbs & Things, "Incision of skin and subcutaneous tissue" manual. https://limbsandthings.com/media/0v3d1tvi/incision-of-skin-and-subcutaneous-tissue-manual.pdf |
| UWskills | UW General Surgery, scalpel handling. https://sites.uw.edu/uwgensurgtechskills/instrument-handling-scalpels |
| VUMC | Davis, "Midline Abdominal Incision", Global Surgical Atlas 2022. https://www.vumc.org/global-surgical-atlas/sites/default/files/public_files/PDF/Midline%20Abdominal%20Incision.pdf |
| Usask | Ventral celiotomy lab (veterinary). https://wcvm.usask.ca/vsac205/Lab6/ventral-celiotomy.php |
| Epomed | Handle #4 takes blades 20-23, 26. https://epomedicine.com/surgical-skills/surgical-blades |
| Pinch | Mathiowetz 1985 grip/pinch norms https://pubmed.ncbi.nlm.nih.gov/3970660/ ; 2024 cohort https://thieme-connect.com/products/ejournals/pdf/10.1055/s-0044-1788999.pdf |
| SPrigor | StatPearls, rigor/livor/postmortem changes. https://www.ncbi.nlm.nih.gov/books/NBK554464/ ; https://www.statpearls.com/sp/md/102/90662/ |
| Necro | "Necromechanics": rigidity rises with post-mortem interval. https://www.pubmed.gov/25991713/ |
| SATtemp | Human SAT indentation at 25 vs 37 °C, no change (2022). https://katalog.lib.cas.cz/KNAV/EdsRecord/cmedm,34590691 |
| Fibrinolysis | Post-mortem blood fluidity via fibrinolysis / D-dimer, Biology 2025. https://mdpi.com/2079-7737/14/7/784 |
| Bloom | Myoglobin blooming, Britannica. https://www.britannica.com/science/deoxymyoglobin |
| Langer | Langer's lines (cadaver punctures); abdomen transverse. https://en.wikipedia.org/wiki/Langer%27s_lines ; https://www.cun.es/diccionario-medico/terminos/lineas-langers |

## 1. Layer thickness (adult male, anterior wall)

| Layer | Thickness | Tag | Source / note |
|---|---|---|---|
| Epidermis + dermis (abdomen, US "dermis" includes epidermis) | 2.1 mm (95% CI 1.99-2.21) | M | Derraik14 |
| Excised back skin, fat removed (for comparison) | 2.56 ± 0.39 mm | M | NiAnnaidh12 (elderly) |
| Subcutaneous fat, abdomen, men | 17.9 mm (15.9-19.8) at mean BMI 28 | M | Derraik14 |
| Subcutaneous fat by BMI class (mixed sex) | under 8.8 / normal 13.8 / over 20.8 / obese 23.3 mm | M | JCDR |
| Deep fat (below Scarpa) as share of total subcutis, lower abdomen | ~23-25 % | M | Lancerotto11 / PubMed 25255112 |
| Anterior rectus sheath | 0.59 mm (IQR 0.38) | M | Kriener23 |
| Linea alba | 0.88 mm thick (IQR 0.76); width up to 4.4 ± 1.9 cm at umbilicus in 3D study (mixed, likely incl. diastasis) | M | Kriener23; width figure weak |
| Rectus abdominis (US, living men, ~24 y) | 10.3-10.4 mm | M | Tahan16 |
| External / internal oblique / transversus (living men) | 5.4-5.7 / 8.5-8.9 / 3.8-4.5 mm | M | Tahan16 |
| Posterior rectus sheath (above arcuate line) | 0.51 ± 0.13 mm; 0.32 mm (Kriener) | M | WhiteheadClarke23; Kriener23 |
| Parietal peritoneum (tested strip, probably incl. transversalis/preperitoneal tissue) | 0.39 mm (IQR 0.29) | M | Kriener23 |
| Peritoneum histology: mesothelium / submesothelial connective tissue | 2.5-3 µm / median 173 µm (adult, dialysis-related cohort) | M | PeriTEM; Schaefer16 |

Notes. Lateral (oblique zone) the deep sheet is three muscle layers ~18 mm total plus aponeuroses; at midline it is only linea alba (~1 mm) + preperitoneal fat + peritoneum, so a midline cut drops through the deep sheet very fast (VUMC: "If the incision is on the midline, the preperitoneal fat is seen"). Below the arcuate line (~3 cm below the umbilicus, VUMC) the posterior sheath is absent: transversalis + peritoneum only. Fat scales with BMI roughly +1.5-2 mm per BMI point between normal and overweight [D from JCDR]; dermis barely changes with sex (Derraik14). Living-muscle US thicknesses are young adults; an older cadaver will be thinner [E].

## 2. Skin pre-tension, tension lines, gape

| Quantity | Value | Tag | Source |
|---|---|---|---|
| In vivo skin pre-stress (forearm/upper arm) | 28-92 kPa across volunteers | M | Flynn11 |
| Excised skin shrinkage, in vivo to bench (length / width) | ~16 % / ~18 % mean, mostly in the first minutes | M | Dauendorffer08 |
| Other shrinkage series | ~17 % length, 9.5 % width; ~20 % overall | M | Dauendorffer08 search set (J Cutan Pathol 2015; melanoma n=407) |
| Circular excision: wound change vs tension line | wound +16 % along STL, -10 % across; excised disc shrinks 23 % along, 10 % across | A (canine cadaver) | Deroy17 |
| Pigskin: retraction and closing tension higher for wounds at right angles to tension lines | qualitative | A | Deroy17 search set (Mt Sinai pigskin study) |
| Abdominal tension-line direction | transverse (horizontal) on the front, turning oblique on the flanks | M (anatomy) | Langer; cun.es |

Notes. Langer mapped his lines on cadavers (round punctures opened into slits), so a refrigerated cadaver keeps its skin pre-stress: it lives in the collagen/elastin, not in muscle tone. A cut ACROSS the lines (vertical/midline cut on the abdomen) is pulled open by the higher along-line tension and gapes most; a cut ALONG the lines (transverse, Pfannenstiel-like) gapes least. The pre-strain is ~2x higher along lines than across (Deroy17 shrink ratio 23:10).
Gape estimate [D]: treat the cut as a slit of half-length a in a pre-stressed membrane, max opening = 4·σ·a/E. With σ = 50 kPa (Flynn11 mid), E = 1.2 MPa (initial slope, NiAnnaidh12), a = 50 mm: about 8 mm for a 10 cm cut. Range with the measured spreads: 3-15 mm. The gape appears only once the dermis is fully divided; an epidermis-only scratch hardly opens. Attached fat resists, so the realistic in-situ gape is the lower half of that range [E].

## 3. Mechanical behaviour

### Skin (dermis governs)
| Quantity | Value | Tag | Source |
|---|---|---|---|
| Initial (toe) slope | 1.18 ± 0.88 MPa (0.54-1.95 by site/direction) | M | NiAnnaidh12 |
| Linear-region modulus | 83 ± 35 MPa; parallel to Langer 74-112, perpendicular 38-64 MPa | M | NiAnnaidh12 |
| UTS | 21.6 ± 8.4 MPa; parallel 17.6-28.6, perpendicular 10.6-16.5 MPa | M | NiAnnaidh12 |
| Failure stretch (from excised, slack state) | 1.54 ± 0.17 overall; 1.46-1.74 | M | NiAnnaidh12 |
| At 1-2 m/s (fast yank) | UTS 27.2 MPa, failure strain 25 %, E ~99 MPa | M | Gallagher12 |
| Stiffening (end of toe) stretch | ~1.2-1.45 from excised state, i.e. ~1.05-1.25 from in-situ (pre-stretched) state | D | linear span ≈ UTS/E ≈ 0.25 subtracted from failure stretch; minus ~0.2 pre-strain (Dauendorffer08) |
| Tear toughness (mode III trouser / mode I) | 17 ± 4 kJ/m2 (porcine); 20.4 mode III, 30.4 mode I | A | ComleyFleck10; Meyers477 |
| Cutting energy (sharp edge) | ~2-2.8 kJ/m2 | M/A | CutG |
| Relaxation | fast τ ≈ 0.19 ± 0.10 s reported in compression; no reliable tensile τ for human skin found | M (weak) | strath.ac.uk QLV study (search result) |

### Subcutaneous fat
| Quantity | Value | Tag | Source |
|---|---|---|---|
| Tensile initial / ultimate modulus | 1.6 ± 0.8 kPa / ~11.7 kPa | M | Alkhouli13 |
| Shear modulus (37 °C, 10 rad/s) | 7.5 kPa; power-law relaxation | A | Geerligs08 |
| Stress relaxation | two-exponential (time constants not retrieved) | M | Alkhouli13 |
| Tear toughness | ~4.1 kJ/m2 | A | ComleyFleck10 |
| Temperature 25 vs 37 °C | no change in shear modulus or failure (one study); Geerligs08 found temp-dependent moduli | M, conflicting | SATtemp; Geerligs08 |
| Tension behaviour | strain-softening in shear; anisotropic in abdominal SAT | M | Sommer 2013 (via Alkhouli review) |
Fat is ~1000x softer than dermis: in tension it carries almost nothing; its fibrous septa and Scarpa's membranous layer carry the load.

### Fascia / aponeurosis
| Quantity | Value | Tag | Source |
|---|---|---|---|
| Anterior rectus sheath E / UTS / failure strain | 6.0-8.3 MPa / 1.5-3.5 MPa / 125-133 % | M | Kriener23 (medians, fresh and fresh-frozen) |
| Anterior sheath UTS, transverse | 8.75 MPa average (cadaveric review) | M | DeekenLake |
| Rectus sheath E vs loading rate | 5.6 (quasi-static) -> 14 MPa (fast) | M | RateRS13 |
| Posterior sheath transverse / longitudinal | UTS 7.7 / 1.2 MPa; E 11.1 / 1.7 MPa | M | WhiteheadClarke23 |
| Linea alba rupture stress, transverse / vertical | 10.0 ± 3.4 / 4.5 N/mm2 | M | Hollinsky07 |
| Linea alba E transverse / longitudinal | 9.5 / 3.8 MPa | M | Kriener23 |
| Anisotropy ratio (linea alba) | up to 8-9; compliant longitudinally, stiff transversely | M | DeekenLake; Cooney16 |
Kriener's failure strains (>100 %) are grip-to-grip and likely include fibre straightening and slippage; collagen sheets usually stiffen within ~5-15 % stretch and fail well below 100 % [E: flag]. Use the strong axis = transverse (fibres run across the midline).

### Skeletal muscle
| Quantity | Value | Tag | Source |
|---|---|---|---|
| E along / across fibres | 447 / 22.4 kPa (rabbit, 0.05 %/s) | A | Morrow10 |
| Human rectus abdominis (whole strip) E / UTS / failure strain | 0.19-0.30 MPa / 0.06-0.14 MPa / 92-136 % | M | Kriener23 |
| Obliques / transversus E | 0.24-0.58 / 0.81-2.75 MPa | M | Kriener23 |
| Viscoelastic share of stress at 0.5 %/s compression | about half | A | VanLoocke08 |
| Post-mortem | modulus departs from live after ~8 h; post-rigor muscle less stiff than live passive muscle | A | Necro search set (SAE 983155) |

### Peritoneum
| Quantity | Value | Tag | Source |
|---|---|---|---|
| E / UTS / failure strain | 4.4-6.8 MPa / 1.8-2.2 MPa / 136-146 % | M | Kriener23 |
| Porcine peritoneum failure stretch / stress | 1.77-3.18 / 0.34-6.5 MPa (range across tissues) | A | White18 |
Thin, slippery and loosely attached: it tents when pinched and is nicked between forceps (VUMC).

## 4. Tearing and separation by hand

| Quantity | Value | Tag | Source / derivation |
|---|---|---|---|
| Man's key pinch / tip pinch | 84-119 N / ~48-80 N | M | Pinch |
| Force to tear intact 10 mm skin strip | ~400-500 N (UTS 21.6 MPa × 2.1 mm × 10 mm) | D | NiAnnaidh12, Derraik14: impossible by pinch |
| Force to propagate a tear from a cut end in skin (trouser mode, F ≈ G·t/2) | ~18-30 N | D | G 17-30 kJ/m2 × t 2.1 mm |
| Same for 18 mm of fat | ~35 N if torn through lobules; far less along septa/planes | D/E | ComleyFleck10 × Derraik14 |
| Knife puncture of skin | 10-20 N (9-15 N by speed) | M | Stab |
| Needle puncture of cadaver skin | 2.75-2.80 N | M | Needle |

Notes. Skin is notch-insensitive: a notch opens and blunts as collagen fibrils rotate and straighten before a crack runs (Yang15); fibres are recruited ahead of the crack tip and delay growth (Meyers477). So pulling a cut flap first stretches and rounds the cut end; only at large stretch (near the failure stretch above) does the tear start, from the END of the cut, and it runs roughly along the tension lines (strong collagen direction steers it) [E for steering]. A gloved grip on wet skin slips well before 30 N [E]: a person can tear from a cut end with a firm pinch, not tear intact skin.
Fat to fascia: the subcutis is trilaminar (superficial fat, Scarpa's membranous layer, thin deep fat; Lancerotto11). The deep fat and the areolar tissue on the sheath are the loose plane: finger (blunt) dissection opens it (VUMC uses a finger for the preperitoneal plane in the same way). Fat splits along its septa rather than through lobules.
Skin sliding: no measured abdominal value found. Estimate [E]: skin + superficial fat slide 10-30 mm over the sheath before the septa and Scarpa's attachments go taut; less at the linea alba and umbilicus where fat is tethered (Usask: subcutis "tightly attached to the skin above and the abdominal wall below", veterinary).
Fascia: practically untearable across its fibres by hand (UTS ~8-10 MPa transverse); it splits easily between fibre bundles along the fibre direction (anisotropy 8-9). Peritoneum tears easily by finger once opened.

## 5. Scalpel cutting

| Quantity | Value | Tag | Source |
|---|---|---|---|
| Handle #4 blades | 20, 21, 22, 23, 26 | M | Epomed |
| Grip for laparotomy | like a table knife, index finger on the spine, good downward pressure | M | LimbsThings |
| #10 (the #22's small twin) | held like a violin bow, belly cuts, arm moves as one unit | M | UWskills |
| Handle tilt | ~45 ° to the skin (leaning back along the direction of travel) to use the belly | M | LimbsThings |
| Blade plane | perpendicular to the skin surface (no bevel), skin stretched by the other hand | M | LimbsThings; UWskills; Usask |
| One stroke | single smooth stroke; pressure set to cut the skin through in one pass; too much goes deeper | M | UWskills; Usask |
| Sharpness benchmark (silicone) | #10 0.647 N, #15 0.664 N to cut the test medium | M | Healio 2016: https://www.healio.com/news/dermatology/20160209/double-edged-razor-blade-found-to-be-sharpest-for-dermatologic-surgery |
| Drawn cut, tangential force | ~4-6 N per stroke through 2.1 mm skin | D | F ≈ G_cut × depth = 2-2.8 kJ/m2 × 2.1 mm, plus friction |
| Slice/push effect | slice:push 3:1 cuts the needed downward force to ~1/10 of a push cut | A/theory | Atkins |

Notes. The edge runs from the belly to the point; the spine and the flat faces do not cut. A drawn belly stroke has a high slice/push ratio, so modest downward force (a few N [E]) cuts the dermis; a push or a stab with the point needs the 10-20 N puncture load. Moving the blade sideways (normal to its plane) presents the flat face: tissue is pushed and deformed, skin drags along, and nothing is cut unless the point snags and scratches. Dragging sideways in an open wound pushes one edge away and widens the gap. A shallow or hesitant stroke scratches the epidermis only; sawing gives a feathered edge (LimbsThings). Depth per firm stroke: through the dermis and a few mm into fat [E]; VUMC's first stroke goes "down to the level of the dermis or subcutaneous tissue". Fat then parts under further strokes while both edges are pulled apart ("causing it to separate in an even manner", VUMC). Fascia needs a deliberate cut; peritoneum is lifted with two forceps and nicked between them (VUMC).

## 6. Post-mortem look and feel (1-2 days, refrigerated)

| Item | Value | Tag | Source |
|---|---|---|---|
| Rigor onset / full / resolved | 1-2 h (visible ~6 h) / ~12 h / 24-48 h; secondary relaxation ~36 h | M | SPrigor |
| Cold | prolongs rigor; cold stiffening from chilled fluids and fat is a separate effect | M | SPrigor |
| Livor | appears 1-3 h, spreads 4-6 h, fully developed 6-8 h, then fixes (no longer shifts) | M | SPrigor |
| Stiffness vs post-mortem time | rigidity rises with post-mortem interval (skinfold caliper) | M | Necro |
| Refrigerated skin samples | up to 48 h with no measurable change in mechanics | M (secondhand, Daly 1982) | NiAnnaidh12 |
| Green discoloration (right iliac fossa) | ~18 h to 2-3 days at room temp; refrigeration delays it | M (weak sources) | SPrigor search set |
| Blood | stays liquid after death via fibrinolysis (strongest in sudden death) | M | Fibrinolysis |
| Muscle colour on cut | purple-red (deoxymyoglobin), blooms bright red in air within ~30 min | M (meat science) | Bloom |

Notes. Supine body: livor is on the back and flanks; the anterior abdomen is pale, waxy, grey-yellow [E]. No arterial pressure, so a cut does not bleed; dark liquid blood seeps slowly from cut veins, more on the flanks (dependent, engorged) than at the midline [E from livor + fibrinolysis]. At 24-48 h refrigerated the abdominal muscles may still be in or leaving rigor (cold prolongs): firm, doughy, not elastic [E]. Chilled fat is firmer and waxier than living fat [E; SATtemp found no change between 25 and 37 °C, so the effect below 10 °C is unproven]. Fat: yellow, lobulated, glistening; superficial lobules compact between vertical septa, deep fat looser (Lancerotto11). Fascia and linea alba: white, glistening, fibres visible (VUMC calls peritoneum "a glistening white structure"). Muscle: dark red to purple-brown, fibres visible, rectus fibres vertical.

## 7. What a cut looks like, by depth

| Depth | Visible | Edge behaviour |
|---|---|---|
| Epidermis only | thin pale line, no gape, no fluid | flat, no opening (gape needs full dermis cut) |
| Through dermis (~2 mm) | white-cream dermal walls, yellow fat at the floor | opens to the full skin gape (sec. 2); edges vertical if the blade was upright, slanted if beveled (LimbsThings) |
| Into fat | yellow lobules bulge into the gap as skin edges retract | fat surface lumpy, glistening, tears into lobules if pulled |
| Fat cleared | white/grey glistening sheath, oblique fibres laterally, linea alba midline | sheet 1 slides on sheath (sec. 4) |
| Sheath cut | red-brown muscle bulges (lateral) or preperitoneal fat (midline) | transverse fibres pull the cut edges apart sideways in a vertical midline cut [D from anisotropy] |
| Muscle | fibres, cut ends, little retraction post-mortem (no tone) [E] | soft, fibres separate along their length |
| Preperitoneal fat, peritoneum | thin translucent glistening membrane, bowel/omentum shadow behind | tents when lifted; once nicked opens easily |

Edge curl: cut skin edges sit near vertical at first; with the fat attached they do not curl much. Freed thin flaps of skin tend to roll inward (dermal side in) and dry, darken and stiffen in air over hours [E, not sourced]. Treat any eversion as small.

## Suggested targets for the sim

All stretches are from the in-situ (already pre-stretched) state the player sees. [D] = derived above, [E] = estimate.

| Target | Sheet 1: skin + fat | Sheet 2: deep layer |
|---|---|---|
| Gape, 10 cm cut ACROSS lines (vertical cut) | 6-10 mm at mid-length, ellipse, full once dermis is through [D] | midline linea: 2-5 mm (sideways pull of transverse fibres) [E]; lateral muscle: 1-3 mm [E] |
| Gape, 10 cm cut ALONG lines (transverse cut) | 2-4 mm [D: ~1/2.3 of across, Deroy17 ratio] | sheath cut along its fibres: ~0-1 mm [E] |
| Stiffening stretch | 1.10-1.25 (J-curve knee); toe slope ~1 MPa, then ~40-110 MPa [D] | fascia knee 1.05-1.15 [E]; muscle soft to ~1.3 [E] |
| Tear stretch | 1.30-1.50 from the cut end (1.46-1.74 from slack, NiAnnaidh12); faster pull tears earlier (~1.25, Gallagher12) | fascia across fibres 1.2-1.4 [E; Kriener's >2 likely inflated]; splits along fibres at low force; muscle 1.5-2.0 [E]; peritoneum ~1.5+ [E] |
| Tear force from a cut end | ~20-30 N, within a man's pinch (48-119 N) [D] | fascia across fibres: beyond a pinch [D]; peritoneum: a few N [E] |
| Skin slide before held | 10-30 mm over the sheath, ~5 mm near midline/umbilicus [E, no measurement found] | deep layer is fixed to its neighbours; peritoneum slides ~5-15 mm on preperitoneal fat [E] |
| Cut resistance relative to skin (=1.0, per mm of blade travel at full layer thickness) | skin 1.0 (~4-6 N tangential [D]); fat 0.15-0.3, needs 2-4 strokes for 15-20 mm [E] | anterior sheath 0.4-0.6 (thin but tough, gritty) [E]; linea alba 0.6-0.9 [E]; muscle 0.2-0.3 [E]; peritoneum 0.1 but slips away unless lifted [E] |
| Viscoelastic relax | τ ~0.2 s fast + ~10-60 s slow, 20-40 % of stress relaxes [E] | muscle: ~half the stress is viscous at slow rates (VanLoocke08) |

Flags: no human abdominal measurement was found for skin gape, skin sliding distance, scalpel cutting force, per-layer cut resistance, or tensile relaxation times; all those rows are derived or estimated. The skin mechanics come from elderly back skin (NiAnnaidh12) and the thickness data from a diabetic cohort (Derraik14) and young Iranian adults (Tahan16). Fat toughness and muscle anisotropy are animal data. Kriener23 failure strains look too high for collagen sheets and should not be used as tear stretches unchanged.
