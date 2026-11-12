#!/bin/sh
# Bake a place's light: describe it from the game, bake it in Blender, put the result where the game finds it.
#   tools/forge/bake.sh flat-night [size] [samples]
# Needs the dev server on PORT (8669) and blender on the PATH (5.2).
set -eu
what=$1; size=${2:-2048}; samples=${3:-512}
here=$(cd "$(dirname "$0")/../.." && pwd)
work=${FORGE_WORK:-$HOME/.cache/cold-chain/forge}
mkdir -p "$work" "$here/assets/baked"
node "$here/tools/forge/describe.mjs" "$what" "$work/$what.json"
blender -b --factory-startup -P "$here/tools/forge/bake.py" -- "$work/$what.json" "$here/assets/baked/$what" "$size" "$samples" 2>&1 | grep -E "baked|Error|error|Traceback" || true
