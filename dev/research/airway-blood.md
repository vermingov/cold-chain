# Blood in the mouth, the airways and the stomach

What src/sandbox/throat.ts models, and from what. Numbers marked *estimate* have no source behind them and were
chosen to sit inside what the sources describe.

## 1. Where blood from a wound goes

- **Haemothorax vs blood in the airway.** A torn lung bleeds mostly into the pleural space round it (haemothorax: the
  most common thoracic injury in civilian penetrating trauma, ahead of haemopneumothorax; lung injury is found in
  65-86% of chest gunshot wounds and 30-59% of stab wounds). Some of it goes into the lung's own bronchi and is
  coughed up (haemoptysis). How often that is seen varies: an older series of penetrating chest wounds had
  haemoptysis in 43%, later reviews call true haemoptysis uncommon. The game sends 15% of a lung wound's bleeding into
  its airways (*estimate*), the rest into the chest (vitals.ts as before). A holed trachea or main bronchus bleeds into
  its own lumen, straight down into the lungs.
- **Haemoptysis vs haematemesis.** Blood from the lungs is coughed up, bright red and frothy (mixed with air, often
  with sputum); blood from the gut is vomited, with retching, dark red with clots, or "coffee grounds" once it has sat
  in the stomach acid for a while: haemoglobin oxidised to haematin, which takes hours (WebMD; NHS: "blood has been in
  your stomach for a while"), and does not happen with a massive bleed or without acid (Altmeyer). The sandbox runs in
  minutes, so vomited blood is shown as dark red blood, not coffee grounds (see "Not modelled").
- **Swallowed blood** from the mouth or the back of the nose ends in the stomach and is vomited later; it can look
  like true haematemesis (Altmeyer).
- **Into the mouth**: the tongue, palate and cheek are supplied by the lingual and facial arteries and bleed freely; a
  broken lower jaw along the teeth, a Le Fort I/II break and a knocked-out tooth bleed into the mouth (bones.ts,
  teeth.ts already named these). A nosebleed runs out of the nostrils and back through the nasopharynx into the
  throat; face up, most of it goes back (game: 25% upright, up to 85% face up, *estimate*).
- **Into the stomach**: a holed stomach bleeds from its lining into its lumen as well as round it; the game sends a
  share (0.6 of the organ's rate, *estimate*) into the stomach.

## 2. Blood in the airways and oxygenation

- People with massive haemoptysis die of asphyxiation, not blood loss: the anatomic dead space of the conducting
  airways is only about 150 ml (100-200 ml; J Thorac Dis 2021 review, LITFL), and about 400 ml of blood in the
  alveolar space is enough for severe hypoxaemia (Hospital Physician 2005, from a single older source). Clots cast the
  bronchi and shut off whole segments.
- The right main bronchus is wider and more vertical than the left, so aspirated material goes right more often; the
  segment it lands in follows gravity (lying on the left, the left lung takes it; supine, the dependent posterior
  segments) (Wikipedia, Pulmonary aspiration; Loyola lung segment notes).
- Game: each lung's blood volume takes away `1 - exp(-ml / 120)` of what that lung does (two thirds at 120 ml in one
  lung, 90% at 280 ml), which puts ~150 ml spread over both at about half the gas exchange and ~400 ml near nothing,
  matching the two figures above. Aspirated blood goes 58% right, more to the lower lung on a side.

## 3. Coughing

Coughing is the airway's clearance: blood in the trachea and bronchi is irritant and is coughed up into the mouth and
out; the airflow at the mouth froths and atomises it, so coughed blood is bright, frothy and thrown as a fine spray
with some clots. Blood that has reached the alveoli is not cleared by coughing. Game: a cough every 1.2-5 s while
there is blood in the airways (more often the more there is), each bringing up 30% of each lung's blood (at most 15 ml
a lung, *estimate*), most of the mouth thrown out as a spray, needs the person awake enough for the reflex.

## 4. The mouth by posture; the unconscious airway

- An unconscious person (GCS 8 or below) cannot protect the airway: cough, gag and swallow are depressed, and lying
  supine the tongue and anything in the pharynx fall back onto it (Resuscitation Council UK via Nursing Times,
  e-Learning for Healthcare airway sessions).
- Blood or vomit in the upper airway makes a gurgling noise (partial obstruction by liquid); snoring is the tongue or
  soft palate; silence can mean complete obstruction (University of Leeds RRAPID, AMBOSS).
- The recovery position works by gravity: as near true lateral as possible with the head dependent "to allow free
  drainage of fluid", mouth facing down (Resuscitation Council UK guidance).
- Game: the mouth's blood is moved by gravity from the head's real orientation: out over the lower lip when the
  face turns down, out of a corner of the mouth when the head lies on its side, toward the larynx when face up or
  upright. Upright the lower lip holds it (it stands above the floor of the mouth). Awake, what reaches the back is
  swallowed (a 20 ml swallow, after Adnerhill 1989's natural sip of 21 ml for men) or a mouthful is spat out; out cold,
  each breath draws a share of the pooled blood into the lungs, and the pool narrows the airway (`choked`) and gurgles.
  Rolling the person onto their side or front drains it out of the mouth.

## 5. Retching and vomiting

Blood is a gastric irritant and a large amount swallowed or bled into the stomach brings on vomiting; no source gives a
volume (the game: nausea builds past 60 ml, *estimate*). Vomiting comes after a few retches (the belly's muscles and
the diaphragm squeeze against a shut glottis), then the stomach empties up the oesophagus and out of the mouth with
force. Unconscious people still vomit or regurgitate, and what does not leave the mouth is aspirated: the classic
death of the drunk lying on his back.

## Not modelled

- Coffee-ground vomit (needs hours in acid) and the colour difference between frothy lung blood and gut blood on the
  floor and skin: blood.ts, floor.ts and film.ts draw one blood colour. Coughed blood differs only in being a finer
  spray.
- Clots casting the bronchi, absorption of alveolar blood over days, aspiration pneumonia.
- The oesophagus filling as a visible thing: the vomit passes through it in the model (`gullet`) but is not drawn.

## Sources

- Massive haemoptysis, dead space and asphyxiation: emDocs, https://www.emdocs.net/emdocs-podcast-episode-116-massive-hemoptysis/;
  J Thorac Dis 2021 review, https://pmc.ncbi.nlm.nih.gov/articles/PMC8411133; LITFL, https://litfl.com/massive-haemoptysis-ddx/.
- Penetrating chest trauma, haemothorax vs haemoptysis: https://pmc.ncbi.nlm.nih.gov/articles/PMC2650680 ;
  https://aj.tubitak.gov.tr/medical/issues/sag-12-42-6/sag-42-6-21-1203-56.pdf ;
  https://westerntrauma.org//docs/15-karmy-jones-penetrating-chest-trauma-journal-article.pdf
- Haematemesis and coffee grounds: https://www.webmd.com/digestive-disorders/what-is-hematemesis ;
  https://nidirect.gov.uk/node/10362 ; https://www.altmeyers.org/en/internal-medicine/hematemesis-138511
- Aspiration distribution: https://en.wikipedia.org/wiki/Pulmonary_aspiration ;
  https://www.meddean.luc.edu/lumen/meded/medicine/pulmonar/cxr/lasegs.htm
- The unconscious airway, gurgling, recovery position: https://resources.time.leeds.ac.uk/rrapid/ebook/03-airway-03.html ;
  https://www.amboss.com/us/knowledge/airway-obstruction ; https://en.wikipedia.org/wiki/Recovery_position ;
  https://e-safe-anaesthesia.org/sessions/12_02/d/ELFH_Session/1354/tab_1587.html
- Swallow volume: Adnerhill I, Ekberg O, Groher ME, "Determining normal bolus size for thin liquids", Dysphagia 1989.
