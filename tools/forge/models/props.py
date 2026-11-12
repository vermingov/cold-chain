"""Forge the hand-built props of Cold Chain as GLB models, and look at them.

    ~/.local/bin/blender -b --factory-startup --python-exit-code 1 -P tools/forge/models/props.py -- [name ...] [--no-look] [--look-only] [--dry] [--repack]

With no names it makes all of them: the flat's door, phone, answering machine and radio (flat.py), the bier, the
coffin and the van (yard.py). Each is built fine and plain, the fine one baked onto the plain one (kit.py), and
written to assets/models/props/<name>.glb; then loaded back, described (parts, pivots, size, triangles, maps) and
rendered, a three-quarter view, a close one and one with its moving parts moved, into
~/.cache/cold-chain/forge-previews/props/. --dry only builds them and draws the shapes, quickly; --repack only
makes the shipped maps again from the kept masters (kit.ship) and puts them in the GLBs. Poly Haven maps (CC0) are fetched once into ~/.cache/cold-chain/dl/polyhaven/.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import flat  # noqa: E402
import kit  # noqa: E402
import yard  # noqa: E402

MODELS = {**flat.MODELS, **yard.MODELS}

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = [a for a in args if not a.startswith('--')] or list(MODELS)
for name in names:
    spec = MODELS[name]
    path = kit.OUT / f'{name}.glb'
    if '--dry' in args:
        kit.dry(name, spec['build'], spec['close'])
        continue
    if '--repack' in args:
        kit.ship(name, spec['shipped'])
        kit._embed(path)
        print(f'{path.name}: {path.stat().st_size / 1024:.0f} KiB')
        continue
    if '--look-only' not in args:
        path = kit.forge(name, spec['build'], spec['size'], spec.get('pivots'), spec.get('parents'),
                         spec.get('extrusion', 0.004), spec.get('dirt', 0.5), spec.get('reach_ao', 0.1), spec.get('apart', ()), spec['shipped'])
    if '--no-look' not in args:
        kit.look(path, spec['look'], spec['close'], spec.get('poses'))
