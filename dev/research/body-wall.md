# The body wall: chest and belly, layer by layer, and how flesh and bone deform

What lies between the skin and the organs at each site of the trunk, how thick, what each layer looks like when a wound
lays it open, what blades, bullets and blunt blows do to it, and how a broken long bone changes the shape of a limb.
Written for the opened chest and belly (viscera.ts, wall.ts), the wound edge (marks.ts), bruising as geometry
(bruise.ts) and broken bones (bones.ts, shards.ts). The user (2026-11-14): "There is no flesh or bone deformation, and if
I cut somebody open it's just open, there isn't really any actual flesh by the ribs and stuff ... the entire body needs
to be anatomically correct."

Confidence tags as in tissue-mechanics.md: **[M]** measured in people (source given); **[T]** standard textbook anatomy
(the reference texts below agree; chapter given); **[D]** derived from measured numbers (method shown); **[E]** an
estimate with no direct source, a starting point for tuning.

## Sources

| Key | Source |
|---|---|
| Gray41 | Standring (ed.), *Gray's Anatomy*, 41st ed., Elsevier 2016: ch. 7 (skin, subcutaneous tissue), ch. 53 (chest wall and breast), ch. 54-55 (pleura, lungs), ch. 61 (anterior abdominal wall), ch. 62 (posterior abdominal wall), ch. 42 (back) |
| Moore7 | Moore, Dalley, Agur, *Clinically Oriented Anatomy*, 7th ed., 2014: ch. 1 Thorax (thoracic wall, intercostal spaces, pleurae), ch. 2 Abdomen (anterolateral abdominal wall, peritoneum), ch. 4 Back |
| Netter7 | Netter, *Atlas of Human Anatomy*, 7th ed., 2019: plates 185-196 (thoracic wall), 248-262 (anterolateral abdominal wall), 172-176 (back muscles) |
| Rankin06 | Rankin, Stokes, Newham, "Abdominal muscle size and symmetry in normal subjects", *Muscle & Nerve* 2006;34:320-326, doi:10.1002/mus.20589 (ultrasound, 55 men 21-72 y, 68 women): thickness order RA > IO > EO > TA; men larger. https://eprints.soton.ac.uk/42007 |
| Inaba12 | Inaba et al., "Radiologic evaluation of alternative sites for needle decompression of tension pneumothorax", *Arch Surg* 2012;147:813-818 (CT): chest wall at the 5th intercostal space, anterior axillary line, 1.3 cm thinner on average than at the 2nd space, mid-clavicular line; a 5 cm needle fails to reach the pleura in 42.5 % at the 2nd space, 16.7 % at the 5th; thickness rises with BMI quartile. https://read.qxmd.com/read/22987168 |
| Givens04 / CT110 | CT series of 110 trauma patients (Givens, Ayotte, Manifold, *Acad Emerg Med* 2004;11:211): mean chest wall at the 2nd space, mid-clavicular line, 4.5 cm right, 4.1 cm left. https://www.hmpgloballearningnetwork.com/site/emsworld/article/12041960/what-s-the-best-site-for-needle-decompression |
| Derraik14 | Derraik et al., *PLoS One* 2014;9:e86637 (abdominal subcutaneous fat by ultrasound; men ~18 mm), already in tissue-mechanics.md |
| BP3D | BodyParts3D 4.0 (DBCLS, CC BY-SA 2.1 JP), the meshes in ~/.cache/cold-chain/bp3d (what is and is not there: section 7) |
| Saukko | Saukko & Knight, *Knight's Forensic Pathology*, 4th ed., 2016: ch. 4 (wounds), ch. 7 (sharp force: stab wounds of chest, cut ribs and cartilage), ch. 8-9 (gunshot), ch. 10 (chest and abdominal injuries) |
| DiMaio | DiMaio, *Gunshot Wounds*, 3rd ed., 2016: ch. 3-5 (wound ballistics, temporary cavity), ch. 12 (bone) |
| Fackler88 | Fackler, "Wound ballistics: a review of common misconceptions", *JAMA* 1988;259:2730-2736; Fackler & Malinowski, "The wound profile", *J Trauma* 1985;25:522-529 |
| ATLS10 | American College of Surgeons, *ATLS Student Course Manual*, 10th ed., 2018: ch. 4 (open pneumothorax: a defect over about two thirds of the trachea's diameter takes air in preferentially; flail chest), ch. 8 (femoral fracture: 1-1.5 L of blood into the thigh) |
| Apley10 | Blom, Warwick, Whitehouse (eds.), *Apley & Solomon's System of Orthopaedics and Trauma*, 10th ed., 2017: ch. 23 (principles: displacement as translation, angulation, rotation, length), ch. 28-30 (humerus, femur, tibia) |
| RG9 | Tornetta et al. (eds.), *Rockwood and Green's Fractures in Adults*, 9th ed., 2019: femoral shaft, tibial shaft and humeral shaft chapters (deforming forces) |

Already in the repo and used here: tissue-mechanics.md (skin and fat mechanics, the abdominal wall's layers as cut on the
table), wounds.md (incised, stab, gunshot appearance), stab-wounds.md, gunshot-blood.md, blunt-trauma.md.

## 1. The layers, site by site

Thicknesses are a lean-to-average adult man; fat varies most (x2-x4 between lean and obese), muscle with build and
age. Totals are checked against the CT numbers for the chest (Inaba12, CT110) and the ultrasound numbers for the belly
(Rankin06, Derraik14).

### 1.1 Common to every site [T Gray41 ch. 7]
- **Epidermis** 0.05-0.1 mm, **dermis** 1-2 mm on the front of the trunk, 3-4 mm on the back. Cut, the dermis is a
  dense white-to-pink band (collagen), firm, barely bleeding itself; the epidermis a thin darker line on top.
- **Subcutaneous fat** (superficial fascia): lobules of yellow fat 2-10 mm across between thin white fibrous septa. In
  the lower belly it is two layers (Camper's fatty, Scarpa's membranous below it, a thin white sheet) [T Moore7 ch. 2].
- **Deep fascia**: a thin (<1 mm) white glistening membrane on each muscle (on the belly's flat muscles it is barely
  there; the rectus sheath and the aponeuroses take its place).

### 1.2 Front of the chest (2nd-5th intercostal space, mid-clavicular line) [T Gray41 ch. 53, Moore7 ch. 1, Netter7 185-190]
From outside in:
| Layer | mm | Notes |
|---|---|---|
| skin | 2 | |
| subcutaneous fat | 5-15 [E, D: total minus the rest] | over the breast region in men; thin over the sternum (2-5) |
| pectoral fascia | <1 | |
| **pectoralis major** | 10-20 [E] | fan: clavicular fibres down and out, sternocostal across, abdominal part up and out, all converging on the humerus's intertubercular groove |
| clavipectoral fascia, **pectoralis minor** (ribs 3-5 to coracoid) | 5-10 [E] | only in the upper lateral chest, fibres up and out |
| **ribs** with **external, internal, innermost intercostals** between | rib 6-10 deep x 12-20 high; space 15-20 high | see 1.3 |
| endothoracic fascia + **parietal pleura** | <1 | |
| pleural space | a film | the lung's visceral pleura lies against it |
Total skin to pleura: 4.1-4.5 cm mean at the 2nd space MCL [M CT110], about 1.3 cm less at the 5th space AAL [M Inaba12]:
so about 3 cm laterally, where serratus anterior (5-8 mm [E], slips from ribs 1-8 running back round the chest to the
scapula's medial border, interlocking with the external oblique below) replaces the pectorals [T Moore7 ch. 1].
Over the sternum: skin, 2-5 mm fat, the pectoralis origins thin to nothing at the midline, the sternum 10-15 mm of bone
(thin cortex, red marrow) [T].

### 1.3 The intercostal space [T Moore7 ch. 1 "Intercostal spaces"; Gray41 ch. 53; Netter7 190]
- **External intercostal**: fibres run down and forward (inferomedially at the front, the way of the external oblique:
  "hands in the pockets"). Ends at the costochondral junction; from there to the sternum only the thin **external
  intercostal membrane** (whitish, the internal intercostal seen through it).
- **Internal intercostal**: at right angles to the external, down and back; reaches the sternum; behind the angle of the
  rib it becomes the internal intercostal membrane.
- **Innermost intercostal**: the same direction as the internal, a thin deep layer, separated from it by the
  **neurovascular bundle** (vein, artery, nerve, top to bottom) in the costal groove under each rib. A blade or needle
  passing just above a rib misses the bundle; one passing under a rib cuts it and bleeds from the intercostal artery
  (a branch of the aorta: brisk) [T Moore7].
- Each muscle 2-4 mm [E]; the space altogether 5-10 mm deep, about as deep as the rib.
- **Transversus thoracis** lies inside the front of the lower ribs (sternum to costal cartilages 2-6), with the internal
  thoracic artery and veins running down 1-2 cm from the sternal edge between it and the cartilages [T Moore7].
- **Ribs**: flat-ish bars, outer surface smooth, a cortex 1-2 mm round red cancellous marrow (adult ribs and sternum are
  red-marrow bone) [T Gray41]. The front 2-8 cm of ribs 1-7 are **costal cartilage** (hyaline: bluish-white, pearly,
  glossy, firm, cut with a knife like hard cheese; often calcified in older men); ribs 8-10's cartilages join the one
  above to form the costal margin [T].

### 1.4 Back of the chest and lumbar back [T Gray41 ch. 42, Moore7 ch. 4, Netter7 172-176]
skin 3-4 mm (thickest on the trunk), fat 5-20 mm, **trapezius** (upper back, thin sheet 3-6 mm), **latissimus dorsi**
(lower back and flank, a thin broad sheet 3-8 mm, fibres converging up and out to the humerus), the **thoracolumbar
fascia** (white, thick in the lumbar region), then the **erector spinae** (iliocostalis, longissimus, spinalis): thick
columns either side of the spines, 3-6 cm deep in the lumbar region, fibres vertical; then the ribs' angles and the
transverse processes. Total to the pleura behind: 4-7 cm [E]. A stab from behind meets far more muscle than one from in
front.

### 1.5 The belly [T Moore7 ch. 2 "Anterolateral abdominal wall"; Gray41 ch. 61; Netter7 248-262; M Rankin06, Derraik14]
| Layer | mm | Colour and grain |
|---|---|---|
| skin | 2 | |
| Camper's fat | 10-25 (18 mean in men [M Derraik14]) | yellow lobules |
| Scarpa's fascia (below the navel) | <1 | thin white sheet in the fat |
| **midline: linea alba** | 1-2 cm wide above the navel, a few mm thick | white, fibrous, nearly bloodless |
| **anterior rectus sheath** | 1 | white glistening aponeurosis |
| **rectus abdominis** | 10-15 [E, RA the thickest per Rankin06] | fibres vertical, crossed by 3 white tendinous intersections |
| posterior rectus sheath (above the arcuate line, ~ a third of the way from navel to pubis) | 1 | white |
| **lateral: external oblique** | 5-8 [E] | fibres down and medial (like the external intercostals) |
| **internal oblique** | 7-12 [E] | at right angles: up and medial |
| **transversus abdominis** | 3-6 [E, the thinnest per Rankin06] | horizontal |
| transversalis fascia | <1 | |
| extraperitoneal fat | 1-5 | yellow, looser |
| **parietal peritoneum** | ~0.05 | thin, smooth, translucent: shows what is behind it pink-grey, mirror-wet |
Total skin to peritoneum, lean man: 2.5-4 cm (consistent with viscera.ts's WALL 2.5 cm for "through the wall").
The rectus is 6-8 cm wide each side of the linea alba; lateral to it, the three flat muscles; their fibre directions
cross like plywood, which is why a cut through the flank shows three bands of differently grained red [T].

### 1.6 What each layer looks like opened (all sites) [T, Saukko ch. 4/7, wounds.md sec. 0]
- Dermis: a pale, almost white-pink rim, 1-3 mm, the skin rolled slightly out at the edge.
- Fat: pale cream to light yellow (not orange), lobulated: lobules bulge from the cut face and shine; blood lies in the
  crevices between them. Fat barely bleeds itself. (marks.ts already: thin pale fat.)
- Fascia and aponeuroses: thin white or pearly lines with a silky, glistening, fibre-grained sheen.
- Muscle: dark red to red-brown (beef-coloured, darker in a living, bled person under blood), wet. Seen along its fibres
  it is striped (fascicles 1-3 mm in bundles, finer fibres within); cut across them it is stippled, a mosaic of fascicle
  ends with paler connective tissue (perimysium) between. It oozes from many small points.
- Bone: periosteum a thin pink-grey skin; cut bone white-ivory cortex round dark red marrow (ribs, sternum).
- Cartilage: bluish-white, translucent edge, smooth, glossy, bloodless.
- Pleura and peritoneum: a thin glistening membrane; with the lung or bowel against it the colour seen is theirs.
- Lung: pink-grey in a young adult, mottled with black anthracotic spots and lines along its lobule borders in a city
  dweller or smoker; spongy, crepitant, the visceral pleura glistening; moves with breathing [T Gray41 ch. 55].
- Everything in a living person's fresh wound is filmed with blood: muscle and the bottom of the wound most, fat in
  glimpses (wounds.md, gunshot-blood.md).

## 2. What injuries do to each layer

### 2.1 A cut (slash) [Saukko ch. 7; wounds.md sec. 1; tissue-mechanics.md]
- Skin gapes as its tension pulls the edges apart, most across Langer's lines (already: hider.ts / viscera.ts `gape`).
- Fat bulges into the wound (it is under slight pressure and soft).
- **Muscle cut across its fibres retracts strongly**: the cut fibres shorten (the muscle is under tone, more in a living,
  tense man), so the gap in the muscle is wider than the skin's, the two ends rounded and drawn back. Muscle cut along its
  fibres hardly gapes. So a slash across the belly's rectus gapes (vertical fibres), a vertical cut down the linea alba
  barely gapes; in the flank each of the three crossed layers gapes differently [T, Saukko ch. 7].
- Fascia and aponeuroses gape little and show as clean white lines at the edge.
- A slash across the chest rarely cuts through a rib; the blade rides over it and scores it, or cuts costal cartilage
  (which a knife cuts readily) [M Saukko ch. 7: cut and stabbed costal cartilage and incised marks on ribs are common
  findings]. Between the ribs it cuts the intercostals; deeper, the pleura, and air enters (2.4).

### 2.2 A stab [Saukko ch. 7; stab-wounds.md]
- The track goes straight through each layer; muscle closes over it again (the track is a slit, not a hole); a blade
  wedged between two ribs can be held by them. A stab through a rib leaves a notch or a clean cut slot (thin ribs);
  through costal cartilage a clean slot the shape of the blade.

### 2.3 A gunshot [DiMaio ch. 3-5, 12; Fackler88; wounds.md sec. 4]
- Permanent cavity: tissue crushed along the path, in muscle a ragged channel a little wider than the bullet; in fat a
  clean tunnel. A rib hit by a bullet breaks with a punched-out defect bevelled on the far side and secondary fragments
  thrown forward into the lung; a near miss can fracture it by the temporary cavity alone.
- **Temporary cavity**: tissue thrown radially away from the path for a few milliseconds, up to 10-30 bullet diameters for
  rifles (much less for handguns), oscillating a few times and collapsing. Elastic tissue (muscle, bowel, lung) stretches
  and recovers; at the skin it shows as a fast outward bulge round the entry and exit in high-speed film, then the skin
  falls back [M Fackler88, DiMaio ch. 3]. At the surface this is a millisecond event: in a game at 60 Hz it is one or two
  frames of swelling, not a visible slow ripple.
- An exit through the chest or belly wall: everted, torn edges; with a rifle or a shotgun at contact, a blown-out
  defect in which muscle and fat hang torn (wounds.md 4.5, 5.1).

### 2.4 The chest opened: the lung [ATLS10 ch. 4; Moore7 ch. 1; Gray41 ch. 54]
- The pleural space is at less than atmospheric pressure; once the parietal pleura is opened, air enters and the lung,
  held open only by that pressure, **collapses toward its root** by its own elastic recoil: away from the opening, a
  smaller, darker, wrinkled lung, the gap between it and the wall filling with air and blood.
- A defect larger than about two thirds of the trachea's diameter takes air in preferentially to the airway: a sucking
  chest wound (viscera.ts already sets the lung leaking).
- The cut intercostal arteries bleed into the chest (haemothorax): blood collects at the lowest point of the pleural cavity.

### 2.5 The belly opened [Moore7 ch. 2; viscera.ts header]
- Under the peritoneum: the greater omentum (an apron of yellow fat with vessels, hanging from the stomach over the
  bowel) is usually the first thing seen through a lower anterior opening, then small bowel loops; the liver's edge
  under the right costal margin. (The omentum is not in BodyParts3D: a gap; see the plan.)

## 3. How flesh deforms

### 3.1 Under a blunt blow [blunt-trauma.md; tissue-mechanics.md; Saukko ch. 4]
- At the blow: skin, fat and muscle are compressed and the surface dents under the striking face, as deep as the weapon
  pushes in (a bat or a sledgehammer: several cm into a belly, less over bone). Soft tissue is viscoelastic: the dent
  recovers in tens of milliseconds to a second after the weapon leaves, almost entirely.
- What stays is the result of damage: (a) **swelling** (oedema and bleeding into the tissue: a raised, firm area over
  minutes; already as geometry in bruise.ts); (b) a **haematoma** in muscle: a firm lump; (c) a **real dent only where
  something rigid underneath failed**: a depressed skull fracture, broken ribs (a step under the skin; several ribs broken
  in two places make a **flail segment** that moves in, not out, when the man breathes in: paradoxical movement
  [ATLS10 ch. 4]), a crushed area of soft tissue whose fat has been torn from the fascia (a degloving pocket: soft,
  fluctuant, later filling with blood and fluid).
- A sledgehammer's face is 4-5 cm across: over the chest it can break ribs under it and leave a visible depression
  [E, from the flail and depressed fracture descriptions above]; over the belly the dent fills out again.

### 3.2 Under a bullet: see 2.3. The visible part is a millisecond bulge and recoil round the hole, then nothing beyond the
hole and its bruised margin; the lasting deformity is only what was destroyed.

## 4. How a broken long bone deforms the limb [Apley10 ch. 23, 28-30; RG9; ATLS10 ch. 8]
Displacement is described as translation, **angulation**, **rotation** and **length** (shortening by overlap or
distraction). The muscles round the bone pull the fragments past each other once the bone no longer holds them apart:
- **Femoral shaft**: the thigh's strong muscles shorten it by overlap (2-4 cm typical) and the leg below lies
  **externally rotated** (the foot falls outward) and often angled; the proximal fragment is pulled into flexion and
  abduction (iliopsoas, gluteals), the distal fragment up and back (adductors, hamstrings, gastrocnemius at the
  supracondylar level). The thigh swells: 1-1.5 L of blood into it (ATLS10). A neck-of-femur fracture: the leg shorter
  and externally rotated, nothing visible at the thigh.
- **Tibial shaft**: the shin is subcutaneous along its front-inner border, so a fracture shows: a step or an angle in
  the line of the shin, the foot rotated, often open (bone through the skin). Angulation is often varus with the fibula
  intact, valgus with it broken.
- **Humeral shaft**: angulation and shortening of the upper arm, the arm floppy at the break; above the deltoid's
  insertion the proximal fragment is pulled in (pectoralis major), below it out (deltoid).
- Forearm: both bones broken, the forearm angled and shortened; one, less.
- Where it shows: the angle and the step at the break site under the skin, the limb's length, and the turn of the foot
  or hand; the swelling round the break.

## 5. What the game has today (2026-11-14, read from the code)
- anatomy.ts / assets/anatomy/*.bin: BodyParts3D bones (every rib, sternum, vertebrae, pelvis, long bones, hands, feet,
  skull) and organs (heart, lungs as hulls of the bronchial tree, liver, stomach, bowel, colon, kidneys, diaphragm...),
  vessels as paths. **No muscles of the wall, no costal cartilage, no fat or fascia, no pleura or peritoneum.**
- viscera.ts `open`: the skin and clothes are not drawn in a lens-shaped slot (hider.ts); the skin's back faces seen
  through it are shaded as "the body's wall from inside" (dark red noise); marks.ts paints the layers (skin edge, fat,
  sheath, muscle) as a band **on the outer skin round the hole**; the organs, ribs and diaphragm within 20 cm are drawn
  wet. The wall therefore has **no thickness**: seen at any angle the hole's side is the skin's paper edge, and the
  ribs, lung and bowel float behind it with nothing between them and the skin.
- wounds.ts: channels spend energy per cm of soft tissue and per bone; bones.ts breaks bones, a broken long bone
  unlocks its mid joint (ragdoll.ts) and shards.ts draws pieces in the x-ray; there is no lasting shape change of the
  limb's skin or of a dented trunk; bruise.ts swells skin as geometry (oedema).
- tools/anatomy.py imports tools/organs.py, which was removed with the story (commit 394b2e2): the anatomy cannot be
  rebuilt until it is restored.

## 6. Plan

Order by what the user sees most, given WebGL2 and a few ms a frame:

1. **The wall's cut face (done in this pass, wall.ts)**: every opening of the chest or belly gets a real wall of real
   thickness: a ring of geometry from the skin edge down to the pleura or peritoneum, built in the person's rest space,
   skinned to the opening's bone like the organs. Each column of it is measured into the anatomy (how deep the ribs, the
   sternum, the lung, the organs are under that point of skin) and filled with the layers of sections 1.2-1.5 at their
   thicknesses for that site (pectoralis or serratus over the ribs; linea alba, rectus or the three flat muscles in the
   belly), fat taking up the rest, each layer drawn as it looks cut (1.6), muscle with its real fibre direction (a 3D
   grain field, so a face across the fibres is stippled and one along them striped), retracted wider where the cut
   crossed its fibres (2.1), ribs in section (cortex, red marrow) or costal cartilage near the midline, the intercostals
   between them, the pleura or peritoneum as the last glistening layer, blood over it all, most in the depth. Cost: one
   small mesh (~1-2k triangles) and one material per opening; built once at the opening.
2. **Lung collapse (2.4)**: when the chest is opened the lung on that side shrinks toward its root over a few seconds,
   leaving a dark gap with blood at the bottom; the lung surface darkens and wrinkles. Done by moving the lung part's
   corners toward its hilum in the viscera mesh (it is already this module's own copy).
3. **The wall's muscles as volumes from BodyParts3D**: the source has pectoralis major (three parts), pectoralis minor,
   serratus anterior, subclavius, the external, internal and innermost intercostals (left side only: mirror for the
   right), external oblique, transversus thoracis, trapezius, the erector spinae (iliocostalis, longissimus, spinalis),
   psoas, and the costal cartilages 1-7; it has **no** rectus abdominis, internal oblique, transversus abdominis or
   latissimus dorsi (checked in index.json), which stay built in code from section 1.5. Add them to the anatomy file
   as parts flagged `wall` (not traced by wounds until wounds.ts wants them; not in the x-ray), appended after the
   existing parts so that every existing byte is unchanged (prove with a compare script), carried by the same trunk fit
   as the ribs, pressed under the skin by the dermis and the thinnest fat. Then wall.ts reads each column's muscles
   from them instead of the site rules, and the opening shows the real muscle surfaces beyond its edge (pectoralis's
   fibres fanning to the arm). Needs tools/organs.py restored from git (394b2e2^).
4. **Rib involvement**: a slash or stab whose path crosses a rib scores or notches it (a mark on the rib in the
   viscera mesh), a costal cartilage crossed is cut through; a bullet through a rib breaks it into the chest (bones.ts
   already breaks it: draw the broken rib's ends displaced in the opened chest, not only in the x-ray).
5. **Visible fracture deformity (section 4)**: a broken femur, tibia or humerus angles the limb at the break and turns
   the distal part (foot out for the femur), shortens it a few cm: the mid joint ragdoll.ts unlocks already lets the
   limb bend there; add a rest-angle and twist toward the deforming forces and a limit on how far it straightens, and
   swell the thigh by the blood lost into it (bruise.ts's oedema path, sized from the bleed).
6. **Blunt dents (section 3.1)**: the skin pushed in under a bat or sledgehammer for the blow's milliseconds and
   recovering, using bruise.ts's per-vertex rest-space field (a second displacement that decays in ~0.2 s); a lasting
   depression only where ribs broke under it (a flail segment that moves in on breathing in).
7. The omentum over the bowel (a code-built fatty apron hung from the stomach's greater curvature), the internal
   thoracic vessels and the intercostal bundles as small bleeding sources in the wall's face.
