# The people

Built by tools/people.py from MakeHuman (makehumancommunity/makehuman, CC0): the base mesh, its targets, skeleton and
weights, its face rig and face pose units (`data/poseunits/face-poseunits.bvh`, CC0), and the base assets (skins, eyes,
brows, lashes, teeth, tongue, hair, the suits and shoes). The irises are
MakeHuman's with their saturation lowered (people.py, natural_iris).

The man in white (`white.bin`) wears MakeHuman's own T-shirt and jeans (`male_casualsuit02`, CC0), recoloured white
and its printed logo painted over with the shirt's own cloth (people.py, `tint` and `erase`).

The naked man (`naked.bin`):

- his skin is `jartur69_middleage_slavic_male_with_genitals_and_beard` by jartur69, CC0 (pack skins02,
  https://static.makehumancommunity.org/assets/assetpacks/skins02.html): a photographed skin with its body hair, beard
  stubble and genitals painted;
- the shape of his genitals is MakeHuman's own genital helper on its base mesh (`helper-genital` in `3dobjs/base.obj`,
  CC0), smoothed (people.py, `genitals`) and laid on that skin's genital islands.

Their insides (assets/anatomy, tools/anatomy.py) are BodyParts3D, (c) The Database Center for Life Science, licensed
under CC Attribution-Share Alike 2.1 Japan, the naked man's genitals among them (corpora cavernosa, corpus spongiosum
and glans, testes and epididymes; everyone's prostate and seminal vesicles).
