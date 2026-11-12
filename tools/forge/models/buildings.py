"""The buildings round St Dymphna's and in it, as glTF models for the game.

    ~/.local/bin/blender -b --factory-startup --python-exit-code 1 -P tools/forge/models/buildings.py -- \\
        [--preview] [terrace] [door] [tower] [chapel] [lodge] [--samples N]

Every building is built (terrace.py, joinery.py, tower.py, churchyard.py) into one file, assets/models/buildings/
kit.glb, so they share one set of materials and pictures: the terrace pieces and their far versions, the church
tower, the chapel of rest, the sexton's lodge and a front door. Their ambient occlusion is baked by Cycles into one
picture on their second UVs. Binary glTF, +Y up, modifiers applied, pictures as WebP, no Draco. Then it is read back
and each piece's size, triangles and the way it faces are printed; with --preview (or the pieces named) they are
rendered at night into ~/.cache/cold-chain/forge-previews/buildings.

Blender's axes: z up, the street front looks -y, metres. The terrace pieces have their origin at the middle of the
front wall's foot at ground level; the tower, the chapel and the lodge stand with their footprint's middle at the
origin and their sides to the game's compass (Blender +y is the game's north, +z).

Materials, textures and lit windows: surfaces.py. Textures come from Poly Haven (CC0), fetched into
~/.cache/cold-chain/dl/polyhaven.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import baking  # noqa: E402
import churchyard  # noqa: E402
import joinery  # noqa: E402
import preview  # noqa: E402
import surfaces  # noqa: E402
import terrace  # noqa: E402
import tower  # noqa: E402
from shape import Shape  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'buildings')
PREVIEWS = os.path.expanduser('~/.cache/cold-chain/forge-previews/buildings')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make(name, shape, panes, materials, signs=()):
    """A shape as an object, with its lit panes and any shop sign as children."""
    body = shape.build(name, materials, surfaces.TILES)
    joinery.build_panes(name, panes, materials, body)
    joinery.build_panes(name, list(signs), materials, body, surfaces.SIGN, 'sign')
    print(f'  {name}: {shape.triangles()} triangles, {len(panes)} lit panes')
    return body


def export(objects, name):
    """`objects` and their children into OUT/<name>.glb."""
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
        for child in obj.children:
            child.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=80,
                              export_draco_mesh_compression_enable=False, export_texcoords=True,
                              export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False)
    print(f'  wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB)')
    return path


def read_back(path):
    """The GLB read into an empty scene; prints each mesh's size, triangles and materials. Returns the objects."""
    reset()
    bpy.ops.import_scene.gltf(filepath=path)
    objects = list(bpy.context.scene.objects)
    for obj in sorted(objects, key=lambda o: o.name):
        if obj.type != 'MESH' or '.pane.' in obj.name:
            continue
        lo = [min(c[k] for c in (obj.matrix_world @ v.co for v in obj.data.vertices)) for k in range(3)]
        hi = [max(c[k] for c in (obj.matrix_world @ v.co for v in obj.data.vertices)) for k in range(3)]
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        panes = sum('.pane.' in c.name for c in obj.children)
        print(f'  {obj.name}: x {lo[0]:.2f}..{hi[0]:.2f}  y {lo[1]:.2f}..{hi[1]:.2f}  z {lo[2]:.2f}..{hi[2]:.2f}  '
              f'{tris} tris  {panes} panes  [{", ".join(m.name for m in obj.data.materials)}]')
    return {obj.name: obj for obj in objects}


def far_material(image):
    material = bpy.data.materials.new('facade_far')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    picture = nodes.new('ShaderNodeTexImage')
    picture.name = 'far'
    picture.image = image
    bsdf = nodes['Principled BSDF']
    links.new(picture.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    return material


# --- the kit -------------------------------------------------------------------------------------------------------

# One of each kind: the game paints the doors and the shop fronts their colours and moves each shop's sign to its own
# row of the signs' picture, so the file carries no copies.
HOUSES = {'house_plain': ('plain', 'paint_door_green'), 'house_bay': ('bay', 'paint_door_red'),
          'house_shop': ('shop', 'paint_door_black')}


def kit():
    """Every building in one file, sharing one set of materials and pictures and one occlusion picture."""
    occlusion = surfaces.occlusion_picture('kit_ao', 2048)
    materials = surfaces.Materials(occlusion)
    bodies, panes_of = {}, {}
    for name, (kind, door) in HOUSES.items():
        shape, panes, signs = terrace.house(kind, door)
        bodies[name], panes_of[name] = make(name, shape, panes, materials, signs), panes
    for storeys in (2, 3):
        for side, end in ((-1, 'left'), (1, 'right')):
            name = f'gable_{storeys}_{end}'
            bodies[name] = make(name, terrace.gable_end(storeys, side), [], materials)
    shape, dials = tower.tower()
    bodies['church_tower'] = make('church_tower', shape, [], materials)
    joinery.build_panes('church_tower', dials, materials, bodies['church_tower'], surfaces.CLOCK, 'clock')
    for name, build in (('chapel_of_rest', churchyard.chapel), ('sextons_lodge', churchyard.lodge)):
        shape, panes = build()
        bodies[name] = make(name, shape, panes, materials)
    shape, panes = Shape(), []
    joinery.front_door(shape, terrace.FRONT.moved(0, 0.18), panes, 'paint_door_green', reveal=0, head=False)
    bodies['front_door'] = make('front_door', shape, panes, materials)
    baking.occlusion(list(bodies.values()), occlusion)

    far_picture = bpy.data.images.new('kit_far', 1024, 1024, alpha=False)
    far = {'facade_far': far_material(far_picture), surfaces.LIT: materials[surfaces.LIT]}
    pairs = [(bodies['house_plain'], make('house_2_far', terrace.far_house(2), terrace.far_panes(panes_of['house_plain']),
                                          far)),
             (bodies['house_shop'], make('house_3_far', terrace.far_house(3), terrace.far_panes(panes_of['house_shop']),
                                         far))]
    for storeys in (2, 3):
        for side, end in ((-1, 'left'), (1, 'right')):
            pairs.append((bodies[f'gable_{storeys}_{end}'],
                          make(f'gable_{storeys}_{end}_far', terrace.far_gable(storeys, side), [], far)))
    baking.far_facades(pairs, far_picture)
    pieces = [o for o in bpy.context.scene.objects if o.parent is None and o.type == 'MESH']
    return export(pieces, 'kit')


# --- previews -------------------------------------------------------------------------------------------------------

def preview_terrace(path, samples):
    pieces = read_back(path)
    _row(pieces, ['house_plain', 'house_plain', 'house_bay', 'house_plain', 'house_bay'],
         ('gable_2_left', 'gable_2_right'), 0.0)
    _row(pieces, ['house_shop'] * 4, ('gable_3_left', 'gable_3_right'), 40.0)
    _row(pieces, ['house_2_far'] * 3 + ['house_3_far'] * 2, ('gable_2_left_far', 'gable_3_right_far'), 0.0, 75.0)
    for obj in pieces.values():
        if obj.parent is None and obj.type == 'MESH' and not obj.get('placed'):
            obj.hide_render = True
            for child in obj.children:
                child.hide_render = True
    preview.street(0.0, 70)
    preview.street(40.0, 70)
    preview.street(0.0, 40, x=75.0)
    preview.night(lamps=((-8.0, -2.6), (9.0, -2.6), (3.0, 37.4)))
    preview.light_some([o for o in bpy.context.scene.objects if '.pane.' in o.name and not o.hide_render], 0.3)
    shot = lambda name: os.path.join(PREVIEWS, name + '.png')
    preview.render(shot('terrace_34'), (-18, -15, 7), (-2, 2, 4), lens=30, samples=samples)
    preview.render(shot('terrace_street'), (-8, -6, 3.0), (4, 0, 3.6), lens=26, samples=samples)
    preview.render(shot('terrace_gable'), (24, -10, 4), (13, 4, 4.5), lens=30, samples=samples)
    preview.render(shot('shops_34'), (-14, 26, 5), (0, 40, 5), lens=30, samples=samples)
    preview.render(shot('terrace_far'), (45, -55, 8), (75, 4, 5), lens=45, samples=samples)


def only(pieces, name):
    """Hide every piece but `name` (and its children)."""
    for obj in pieces.values():
        top = obj
        while top.parent:
            top = top.parent
        obj.hide_render = top.name != name


def preview_door(path, samples):
    only(read_back(path), 'front_door')
    preview.street(0.0, 12)
    preview.night(lamps=((-2.5, -2.6),))
    shot = lambda name: os.path.join(PREVIEWS, name + '.png')
    preview.render(shot('door_34'), (-1.9, -3.9, 1.5), (0, 0, 1.3), lens=32, samples=samples)


def preview_tower(path, samples):
    only(read_back(path), 'church_tower')
    preview.street(-6.0, 60)
    preview.night(lamps=((-6.0, -8.6), (8.0, -8.6)))
    shot = lambda name: os.path.join(PREVIEWS, name + '.png')
    preview.render(shot('tower_34'), (-32, -48, 10), (0, 0, 20), lens=28, samples=samples)
    preview.render(shot('tower_street'), (4, -17, 1.7), (0, 0, 7), lens=20, samples=samples)


def preview_chapel(path, samples):
    only(read_back(path), 'chapel_of_rest')
    preview.street(-9.0, 50)
    preview.night(lamps=((7.5, 2.0), (-6.0, -12.0)))
    _light_all()
    shot = lambda name: os.path.join(PREVIEWS, name + '.png')
    preview.render(shot('chapel_34'), (-13, -19, 4.5), (0, 0, 4), lens=30, samples=samples)
    preview.render(shot('chapel_east'), (13, 9, 2.0), (4.5, 2, 3), lens=28, samples=samples)


def preview_lodge(path, samples):
    only(read_back(path), 'sextons_lodge')
    preview.street(-5.0, 40)
    preview.night(lamps=((7.0, -4.0),))
    _light_all()
    shot = lambda name: os.path.join(PREVIEWS, name + '.png')
    preview.render(shot('lodge_34'), (13, -12, 3.2), (0, 0, 2.5), lens=30, samples=samples)


def _light_all():
    preview.light_some([o for o in bpy.context.scene.objects if '.pane.' in o.name], 0.5, seed=2)


def _row(pieces, houses, gables, y, x=0.0):
    """Copies of the named houses side by side round x, fronts at y, with the gable pieces at its two ends."""
    placed = list(enumerate(houses)) + [(0, gables[0]), (len(houses) - 1, gables[1])]
    for slot, name in placed:
        obj = _instance(pieces[name])
        obj.location = (x + (slot - (len(houses) - 1) / 2) * terrace.HOUSE, y, 0)


def _instance(source):
    """The piece itself the first time it is placed, a copy (with its panes) after that."""
    if not source.get('placed'):
        source['placed'] = True
        return source
    obj = source.copy()
    bpy.context.scene.collection.objects.link(obj)
    for child in source.children:
        pane = child.copy()
        pane.parent = obj
        bpy.context.scene.collection.objects.link(pane)
    return obj


PREVIEWS_OF = {'terrace': preview_terrace, 'door': preview_door, 'tower': preview_tower, 'chapel': preview_chapel,
               'lodge': preview_lodge}


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(args[args.index('--samples') + 1]) if '--samples' in args else 64
    os.makedirs(PREVIEWS, exist_ok=True)
    reset()
    path = kit()
    looks = [a for a in args if a in PREVIEWS_OF] or (list(PREVIEWS_OF) if '--preview' in args else [])
    if not looks:
        read_back(path)
    for name in looks:
        PREVIEWS_OF[name](path, samples)


main()
