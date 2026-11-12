#!/usr/bin/env bash
# The ground, the walls and the stones.
#
# Every surface in the game is a photoscanned material from Poly Haven
# (polyhaven.com, CC0): the colour map, the normal map and the roughness map,
# fetched at 1k. The ambient-occlusion map is multiplied into the colour at
# two-thirds strength rather than shipped: the lights here are a lantern, a
# lamp and a moon, and occlusion that only dims ambient light would never
# be seen.
#
#     tools/surfaces.sh            fetch everything missing
#     tools/surfaces.sh --force    fetch everything again
#
# Output: assets/surfaces/<name>/{albedo,normal,rough}.jpg
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/surfaces"
RES=${RES:-1k}
FORCE=${1:-}
TMP=$(mktemp -d -p "${SURFACES_TMP:-${TMPDIR:-/tmp}}"); trap 'rm -rf "$TMP"' EXIT

# name          polyhaven id
SETS=(
  # the ground
  "grass        grass_ground"
  "rough        forrest_ground_01"
  "mud          brown_mud_03"
  "soil         farm_soil"
  "gravel       gravel_floor_02"
  "tarmac       asphalt_02"
  "leaves       forest_leaves_03"
  # what is built
  "wall         old_stone_wall"
  "ashlar       medieval_blocks_03"
  "brick        red_brick_03"
  "slates       grey_roof_tiles_02"
  "flags        large_grey_tiles"
  # the stones over the graves: slabs, so nothing with courses or joints in it
  "sandstone    rock_surface"
  "limestone    plaster_grey_04"
  "granite      seaside_rock"
  "lichen       mossy_rock"
  "iron         rusty_metal_02"
  # wood and bark
  "bark         bark_willow"
  "oakbark      jolcham_oak_bark_01"
  "post         weathered_planks"
  "coffin       dark_wood"
  # the flat
  "wallpaper    decrepit_wallpaper"
  "carpet       dirty_carpet"
  "ceiling      white_plaster_02"
  "tabletop     wood_table_worn"
  "pavement     concrete_pavement"
  "terrace      red_bricks_04"
)

fetch() { # id map file
  curl -fsSL --retry 3 -o "$3" "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${RES}/$1/$1_$2_${RES}.jpg"
}

for entry in "${SETS[@]}"; do
  read -r name id <<<"$entry"
  dir="$OUT/$name"
  if [ -f "$dir/albedo.jpg" ] && [ "$FORCE" != "--force" ]; then continue; fi
  mkdir -p "$dir"

  fetch "$id" diff "$TMP/diff.jpg"
  fetch "$id" nor_gl "$TMP/nor.jpg"
  fetch "$id" rough "$TMP/rough.jpg"
  ao=""; if fetch "$id" ao "$TMP/ao.jpg" 2>/dev/null; then ao="$TMP/ao.jpg"; fi

  if [ -n "$ao" ]; then
    magick "$TMP/diff.jpg" \( "$ao" -colorspace Gray -level -50%,100% \) -compose multiply -composite \
      -type TrueColor -quality 86 "$dir/albedo.jpg"
  else
    magick "$TMP/diff.jpg" -type TrueColor -quality 86 "$dir/albedo.jpg"
  fi
  magick "$TMP/nor.jpg" -quality 90 "$dir/normal.jpg"
  magick "$TMP/rough.jpg" -colorspace Gray -quality 84 "$dir/rough.jpg"

  printf '%-10s %-24s %s\n' "$name" "$id" "$(du -ch "$dir"/*.jpg | tail -1 | cut -f1)"
done
