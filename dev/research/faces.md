# Faces: what a face does, and where the numbers in src/sandbox/face.ts come from

Scope: an adult's face awake, hurting, frightened, crying out, short of air, in shock, unconscious and dead, as
src/sandbox/face.ts draws it on MakeHuman's face rig. Tags as in `blunt-trauma.md`: **[M]** measured in people,
**[C]** clinical or textbook statement, **[D]** derived here from measured numbers, **[E]** a starting value set by
eye. The references were not re-read for this pass: they are the standard sources, cited from what they are known to
say; the values marked [E] are where the game had to choose.

## The rig

- MakeHuman 1.x face pose units: `makehuman/data/poseunits/face-poseunits.bvh` and `face-poseunits.json`
  (makehumancommunity/makehuman at a8bc2d5, "Standard face pose units", license CC0 in the file). Sixty frames, each
  one unit pose of the default rig's face bones: brows (oculi, temporalis), lids (orbicularis03 upper, orbicularis04
  lower), eyes, cheeks (risorius02/03, temporalis02), nose and upper lip (levator02-06, special01/03), lips (oris01-07),
  jaw and lower lip (jaw, special04), tongue (tongue00-07). MakeHuman's own expressions (`base/expressions/*.mhpose`)
  are weights of these units; they are not used (their headers say AGPL3), the faces here are built from FACS instead.
- Read as MakeHuman's `shared/bvh.py` reads them (Z-up file: X kept, Y rotation becomes minus that about Z, Z rotation
  about Y, channels in file order with the first applied last) and blended as `shared/animation.py`
  `PoseUnit.getBlendedPose` does: each unit's quaternion slerped from rest by its weight, the results multiplied, later
  units on the left. Its `Skeleton.setPose` turns a pose into bone space as invRest * R * Rest: the turns are about
  world-aligned axes at each bone's head, which is what the game's bones are at rest.
- Weights: MakeHuman's `default_weights.mhw`. The brows' vertices are 20-30% on oculi01 (MakeHuman painted the brow
  that way), so a raised brow moves the brow and the skin under it partly; the proxies (brows, lashes, hair, a beanie)
  carry the weights of the skin vertices they hang from (people.py `fit`), so they follow.

## Facial Action Coding System

- Ekman P, Friesen WV. *Facial Action Coding System.* Consulting Psychologists Press, 1978; Ekman P, Friesen WV,
  Hager JC. *FACS Manual*, 2002. [C] The action units used: AU1 inner brow raiser (frontalis, medial), AU2 outer brow
  raiser, AU4 brow lowerer (corrugator, depressor supercilii, procerus), AU5 upper lid raiser, AU6 cheek raiser
  (orbicularis oculi, orbital part), AU7 lid tightener (palpebral part), AU9 nose wrinkler, AU10 upper lip raiser,
  AU12 lip corner puller, AU15 lip corner depressor, AU16 lower lip depressor, AU17 chin raiser, AU20 lip stretcher,
  AU24 lip presser, AU25 lips part, AU26 jaw drop, AU27 mouth stretch, AU43 eyes closed, AU45 blink.
- Which MakeHuman units make each AU, and how much (face.ts `AUS`): [E], set by eye from close renders against the
  FACS descriptions.

## Pain

- Prkachin KM. "The consistency of facial expressions of pain: a comparison across modalities." Pain 1992;51:297-306.
  [M] Across four kinds of pain, four movements carry nearly all of it: brow lowering (AU4), orbit tightening
  (AU6/AU7), levator contraction (AU9/AU10) and eye closure (AU43). The expression is brief, at the onset.
- Prkachin KM, Solomon PE. "The structure, reliability and validity of pain expression: evidence from patients with
  shoulder pain." Pain 2008;139:267-274. [M] The Prkachin and Solomon Pain Intensity score:
  PSPI = AU4 + max(AU6, AU7) + max(AU9, AU10) + AU43, which face.ts `PAIN` follows: AU4 and AU6/7 from the first,
  AU9/10 joining as it gets worse, AU43 at its worst [E for the ramps].
- Craig KD, Patrick CJ. "Facial expression during induced pain." J Pers Soc Psychol 1985;48:1080-1091. [M] The same
  units; mouth opening (AU25-27) and lip stretch (AU20) with stronger pain; the face strongest at onset.
- In the game: a fresh hurt flares (2.5 x the rise in `vitals.pain`, fading over 2.5 s) over a lasting ache
  (`pain^0.8 x 0.65`) [E].

## Fear and startle

- Ekman P, Friesen WV. *Unmasking the Face.* Prentice-Hall, 1975; EMFACS prototypes. [C] Fear: AU1+2+4 (brows raised
  and drawn together), AU5 (upper lids raised), AU20 (lips stretched back), AU25/26 (mouth open).
- Landis C, Hunt WA. *The Startle Pattern.* Farrar & Rinehart, 1939. [M] The startle to a gunshot: a blink in 30-50 ms
  and a brief grimace, spreading down the body. face.ts: a shot or blast anywhere startles anyone awake (0.6 s).
- Anxiety from blood loss: ATLS haemorrhage classes (American College of Surgeons, ATLS 10th ed., 2018) [C]: class II
  (15-30%) anxious, class III (30-40%) anxious and confused, class IV (>40%) lethargic.

## Crying, screaming, other cries

- Crying face: AU1+4 (the oblique "grief" brow), AU6/7, AU15, AU17, the mouth opened by sobbing. Ekman & Friesen 1975
  (sadness: AU1+4+15) and Darwin C, *The Expression of the Emotions in Man and Animals*, 1872, ch. VI-VII (grief
  muscles, the square mouth of crying) [C].
- Screams and yells: the pain face at its height with the mouth stretched open (AU27) and the lower lip pulled down off
  the teeth (AU16, AU20) [C/E].
- The jaw opening for each cry follows the loudness of the recording as it plays (30 ms windows), up to an opening for
  each kind (`CRIES[kind].jaw`) [E]. Maximal voluntary jaw opening in adults is about 40-55 mm between the incisors,
  roughly 30-35 degrees at the joint [C].

## Breathing, shock, unconsciousness, death

- Air hunger: breathing through an open mouth, the jaw opening with each breath in, from a respiratory rate over ~22,
  SpO2 under ~92% or a narrowed airway [C/E].
- Shock and hypoperfusion: blunted face, heavy lids, slow eye movements, drowsy blinks that are slower and longer
  (Caffier PP, Erdmann U, Ullsperger P. "Experimental evaluation of eye-blink parameters as a drowsiness measure."
  Eur J Appl Physiol 2003;89:319-325 [M]: blink duration rises with drowsiness). Pallor: skin vasoconstriction as
  blood is lost (ATLS class II on: pale, cool skin) [C].
- Unconscious: lids mostly closed (a few millimetres open is common), roving eye movements in light coma, the eyes
  turned up under closed lids (Bell's phenomenon), the jaw falling open with gravity on a slack face [C]
  (Posner JB, Saper CB, Schiff ND, Plum F. *Plum and Posner's Diagnosis of Stupor and Coma*, 4th ed., 2007).
- Dead: no blinking; lids often stay part open (they close only if someone closes them); the eyes drift out to the
  divergent position of rest; primary muscular flaccidity drops the jaw until rigor (hours) [C] (Saukko P, Knight B,
  *Knight's Forensic Pathology*, 4th ed., 2016, ch. 2). Pupils: with the brainstem gone they are mid-position to
  dilated and fixed, 4-6 mm (Wijdicks EFM. "The diagnosis of brain death." N Engl J Med 2001;344:1215-1221 [C]);
  face.ts goes to 5.5 mm over ~25 s. Pallor mortis from the first minutes [C].

## Eyes

- Saccade duration, the main sequence: about 21 ms + 2.2 ms per degree (Carpenter RHS. *Movements of the Eyes*, 2nd
  ed., Pion 1988 [M]; Baloh RW et al. "Quantitative measurement of saccade amplitude, duration, and velocity."
  Neurology 1975;25:1065-1070 [M]). Between saccades the eyes hold a point however the head moves (vestibulo-ocular
  reflex and pursuit).
- Microsaccades: one or two a second, under a degree, while fixating (Martinez-Conde S, Macknik SL, Hubel DH. "The role
  of fixational eye movements in visual perception." Nat Rev Neurosci 2004;5:229-240 [M]). face.ts: every 0.4-1.3 s,
  up to 0.4 degrees.
- Vergence: both eyes on the same point; at 0.5 m that is ~7 degrees between them with a 6.4 cm interpupillary distance
  [D]. The upper lid follows the eye up and down (lid-globe synergy) [C]; MakeHuman's eye units move the lids with the
  eye (11.9 degrees of lid for 21.3 of eye down, 5.8 for 19.8 up).
- Range: about 40 degrees across, 30 up, 40 down before the head has to turn [C].
- Where they look: in conversation people look at the other's face much of the time, with glances away (Argyle M,
  Cook M. *Gaze and Mutual Gaze*, Cambridge 1976 [M]); after an injury, at the wound; frightened, vigilant short looks
  that keep returning to the threat [C/E].

## Blinks

- Bentivoglio AR et al. "Analysis of blink rate patterns in normal subjects." Mov Disord 1997;12:1028-1034. [M] At rest
  about 17 a minute, 26 in conversation, 4.5 reading. face.ts: intervals 1-10 s about a mean of ~3.5 s, one in eight a
  double blink [E for the shape of the distribution].
- Harrigan JA, O'Connell DM. "How do you look when feeling anxious? Facial displays of anxiety." Pers Individ Differ
  1996;21:205-212. [M] Blink rate rises with anxiety. face.ts: up to 2.3x frightened, 1.8x in pain [E].
- VanderWerf F et al. "Eyelid movements: behavioral studies of blinking in humans under different stimulus
  conditions." J Neurophysiol 2003;89:2784-2796. [M] The lid closes fast (~70-100 ms) and opens more slowly (~150-200
  ms). face.ts: 80 ms down, 30 ms shut, 170 ms up.

## Pupils

- In a lit room ~3-4 mm; dilated by sympathetic arousal (fear) and by pain, the pupillary dilation reflex (Larson MD,
  Sessler DI, Washington DE, Merrifield BR, Hynson JA, McGuire J. "Pupillary response to noxious stimulation during
  isoflurane and propofol anesthesia." Anesth Analg 1993;76:1072-1078 [M]); by hypoxia [C]. Iris ~11.7 mm across [M].
- Drawn by PupilLayer: inside the iris the texture is sampled from where the painted pupil and iris would put each
  point, so the pupil grows into the iris and the iris pattern is squeezed to its rim. The painted pupils measured
  from the textures: brown 4.2 mm, blue-green 3.3 mm (of an 11.7 mm iris).

## Left for later

- Tears: weeping has no wet film or tear tracks (film.ts draws only blood).
- Cyanosis (blue lips at low SpO2) and livor mortis (hours) are not drawn.
- No nostril flare (no MakeHuman unit for it).
