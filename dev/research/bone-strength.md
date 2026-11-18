# Bone strength: bones.rs's table against the literature (2026-11-17, port/item7-joints)

Each figure of `bones.rs` `spec` checked per bone and per kind of load: bending (a shaft's moment, a flat bone's force
across), axial, torsion, the spongy ends, and the energy the force model implies. Tags as in `blunt-trauma.md`: [M]
measured in humans, [D] derived here, [E] estimate. "Table" is the young adult man's figure; the game scales it by age
(`cortical` 1 - 0.6 % a year after 30, `spongy` 1.2 %), build and a tenth either way (`grain`), so a cadaver figure from
specimens of mean age A is compared against the table times the age factor at A.

## Verdicts

| Bone, load | Table | Literature | Verdict |
|---|---|---|---|
| Femur, shaft moment | 447 N m | 50 % risk 447 N m mid-shaft, 372 distal third [M, Kerrigan04] | right |
| Femur, torsion | 180 N m | 154.7 N m men (118.3 women), dynamic, mean age 58, energy to failure 17.4 J [M, Roberts and Pathak 1977, IRCOBI]; 137 N m [Yamada 1970, as Roberts cites it]. 180 x 0.83 (age 58) = 150 | right |
| Femur, neck (ends) | 7000 N | 7.2 kN young, 3.4 kN old, fall on the hip [M, Courtney 1995] | right |
| Tibia, shaft moment | 312 N m | 312 N m 50 % [M, Kerrigan04]; ~320 men [Nyquist 1985, via AI-Leg] | right |
| Tibia, axial | 16.6 kN | 16.6 kN dynamic, 10.3 quasi-static [M, Crandall via AI-Leg] | right |
| Tibia, torsion | 95 N m | 130.6 +/- 53.2 N m, spiral at 8.3 deg [M, cadaver, PMC3464952]; 40-216 N m proximal tibiae [M, ScienceDirect S0021929013001954]; ~100 N m [Yamada, via Kane and Sternheim's table] | low end of the range; left (see torsion below) |
| Fibula, moment / torsion | 60 N m / 25 N m | not found measured alone | [E], left |
| Humerus, moment | 230 N m | 230 N m 50th male, 130 5th female [M, Kirkish96] | right |
| Humerus, torsion | 70 N m | ~60 N m [Yamada, via Kane and Sternheim] | close; left |
| Radius / ulna, moment | 100 / 94 N m | forearm (both bones together) 94 +/- 41 N m, ulna before radius [M, Pintar98] | right as the struck bone's share: the blow loads only the first bone in its way with the whole moment |
| Radius, distal end | 3800 N | fall on the hand: 2.5 +/- 1.3 kN, elderly specimens [M, impact study via search]; 1.0-4.2 kN [Frykman 1967] | right for a young man (x 0.4 to 0.6 spongy at 75-80 = 1.5-2.3 kN) |
| Clavicle, across | **1480 N** | dynamic three-point bending 732 +/- 175 N, 28.3 N m [M, PMID 16817613]; 1159 N dynamic [M, second study via search]; 1.48 kN is its strength end on (axial) [AI-Upper] | **wrong: the axial figure was used across. Now 1100 N** (the upper of the two, the specimens being old); axial stays 1480 |
| Kneecap, across | **6000 N** | patella or femur broke at ~8.5 kN, flexed knee [M, Haut 1989, PMID 2918426]; 10 kN regulatory knee limit [FMVSS 208] | **low: now 8500 N** |
| Calcaneus, axial | 7000 N | 50 % at 5.5 kN, range 3.6-11.4 kN, cadaver lower limbs [M, Seipel 2001, PMID 11451123] | right for young (5.5 / 0.64 at 60 = 8.6 kN) |
| Skull, by place | temple 3.9, forehead 6.3, side 6.1, back 8.0 kN | temporo-parietal 3.94 +/- 1.29 men; frontal 2.67-9.88; lateral 4.2-9.6 mean 6.1; occiput flat 15.9 [M, Yoganandan04, AI-Skull] | right |
| Face | maxilla 1.3, zygoma 1.6, nasal 0.45, jaw 1.8 (chin 2.8) kN | 0.63-1.98; 0.61-3.47; lowest, unmeasured; 0.82-3.4 lateral, 1.9-4.1 chin [M, Nahum 1975 via AI-Skull] | right |
| Cervical / thoracic / lumbar, axial | 2.24 / 4.5 / 6.0 kN | neck 2.24 +/- 0.57 men [M, AI-Neck]; lumbar bodies 2-10 kN, elderly [Brinckmann 1989] | right |
| Ribs | by chest deflection, 20 % of 23 cm | > 20 % in 5-7 m/s sternal impacts, 40 % flail [M, Kroell via AI-Thorax] | right |
| Small bones of hand and foot, hyoid, larynx, scaphoid | estimates | not found measured | [E], left |

## Torsion

`twist` is in the table but nothing in the port loads a bone in twist: `Load::twist` is never set (bones.rs `load`
callers: blows, falls, wrenches), so a spiral fracture comes only of a blow's bending. A leg twisted on a planted foot
(the commonest spiral tibia) needs the ragdoll's joint torques fed to `load`; not done here.

## Energy

The model is force-based (F = v sqrt(k m), Robinovitch 1991), so energy is not a threshold of its own; checked instead
that the forces match the energies that broke bones [D]:
- A man's bat to the head, 0.8 kg at 15 m/s (90 J; Guo26 measured 69-112 J): k = 1 / (1/500 kN/m + 1/2000 kN/m) =
  400 kN/m, effective mass 0.68 kg, F = 15 sqrt(400e3 x 0.68) = 7.8 kN, over the 6.1 kN side of the skull: it breaks.
  Skulls broke at 14-68 J in Yoganandan 1995.
- A woman's swing, 11 m/s (40-56 J): 5.7 kN, just under: "near the threshold", as Guo26 found.
- The femur in torsion took 17.4 J to break (Roberts and Pathak): unused, as torsion is.

## Sources (new here; the rest are blunt-trauma.md's)
- Roberts SB, Pathak SK. Torsional behavior of the human femur. IRCOBI 1977.
  https://www.ircobi.org/wordpress/downloads/irc1977/pdf_files/1977_30.pdf (read: 154.7 / 118.3 N m, 17.4 J)
- A linear-actuated torsional device to replicate clinically relevant spiral fractures in long bones.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3464952/ (cadaver tibiae 130.6 +/- 53.2 N m)
- Torsional stiffness and strength of the proximal tibia. https://www.sciencedirect.com/science/article/abs/pii/S0021929013001954
- Kane and Sternheim, Physics (1988), breaking torques after Yamada, as reproduced by
  https://sciencedemonstrations.fas.harvard.edu/presentations/spiral-fracture (femur 140, tibia 100, humerus 60 N m;
  not opened here: from the search's summary)
- Biomechanical response of the human clavicle subjected to dynamic bending. https://pubmed.ncbi.nlm.nih.gov/16817613/
  (abstract via search: 732 +/- 175 N, 28.3 +/- 7.8 N m, 10 specimens)
- Haut RC. Contact pressures in the patellofemoral joint during impact loading on the human flexed knee.
  https://pubmed.ncbi.nlm.nih.gov/2918426/ (~8.5 kN, via search)
- Seipel R et al. Biomechanics of calcaneal fractures: a model for the motor vehicle. https://pubmed.ncbi.nlm.nih.gov/11451123/
  (50 % at 5.5 kN, via search)
Not obtained: Yamada 1970 itself, Martens 1980 (J Biomech 13:667, the lower limb in torsion), Nyquist 1985.
