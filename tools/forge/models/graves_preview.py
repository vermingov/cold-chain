"""Look at the grave models as the game will: imported back from their GLBs and rendered at night, in Cycles.

    blender -b --factory-startup --python-exit-code 1 -P tools/forge/models/graves_preview.py -- <kind ...> [--samples N]

Each assets/models/graves/<kind>.glb is imported and checked (its shapes' extent against their `size`, how far they
go below the ground, which way their `_face` material looks, their triangles), then stood in a row on grass and
rendered under a cool moon with a warm torch from beside the eye: a three-quarter view of the row and a close one of
the first shape, to ~/.cache/cold-chain/forge-previews/graves/<kind>.png and <kind>_close.png.
"""

import math
import sys
from pathlib import Path

import bpy
import mathutils

HERE = Path(__file__).resolve().parents[3]
MODELS = HERE / 'assets' / 'models' / 'graves'
GRASS = HERE / 'assets' / 'surfaces' / 'grass'
OUT = Path.home() / '.cache' / 'cold-chain' / 'forge-previews' / 'graves'

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAMPLES = int(args[args.index('--samples') + 1]) if '--samples' in args else 64
KINDS = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--samples')]


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 6
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 1.6
    world = bpy.data.worlds.new('night')
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.003, 0.0045, 0.009, 1)
    scene.world = world
    return scene


def check(objects):
    """Print what came back: per shape its extent, face direction and triangles."""
    for obj in objects:
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        lo = [min(c[i] for c in corners) for i in range(3)]
        hi = [max(c[i] for c in corners) for i in range(3)]
        mesh = obj.data
        mesh.calc_loop_triangles()
        face = mathutils.Vector()
        mats = [m.name for m in mesh.materials]
        for poly in mesh.polygons:
            if mats[poly.material_index].endswith('_face'):
                face += poly.normal * poly.area
        size = obj.get('size')
        print(f'  {obj.name}: x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:+.3f}..{hi[1]:+.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}'
              f'  (size {list(size) if size else None})  tris {len(mesh.loop_triangles)}  materials {mats}'
              f'  face looks {tuple(round(v, 2) for v in face.normalized()) if face.length else None}'
              f'  panel {list(obj["panel"]) if "panel" in obj else None}')


def ground():
    bpy.ops.mesh.primitive_plane_add(size=40)
    plane = bpy.context.active_object
    mat = bpy.data.materials.new('grass')
    tree = mat.node_tree
    bsdf = tree.nodes['Principled BSDF']
    coord = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / 2.5, 1 / 2.5, 1)
    tree.links.new(coord.outputs['Object'], mapping.inputs[0])
    for file, socket, space in (('albedo.jpg', 'Base Color', 'sRGB'), ('rough.jpg', 'Roughness', 'Non-Color'),
                                ('normal.jpg', None, 'Non-Color')):
        tex = tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(GRASS / file))
        tex.image.colorspace_settings.name = space
        tree.links.new(mapping.outputs[0], tex.inputs[0])
        if socket:
            tree.links.new(tex.outputs[0], bsdf.inputs[socket])
        else:
            nmap = tree.nodes.new('ShaderNodeNormalMap')
            tree.links.new(tex.outputs[0], nmap.inputs['Color'])
            tree.links.new(nmap.outputs[0], bsdf.inputs['Normal'])
    plane.data.materials.append(mat)


def aim(obj, target):
    obj.rotation_euler = (mathutils.Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def moon():
    sun = bpy.data.objects.new('moon', bpy.data.lights.new('moon', 'SUN'))
    sun.data.energy = 0.35
    sun.data.color = (0.62, 0.72, 1.0)
    sun.data.angle = math.radians(1.0)
    sun.rotation_euler = (math.radians(58), 0, math.radians(-150))
    bpy.context.scene.collection.objects.link(sun)


def torch(at, target, energy):
    lamp = bpy.data.objects.new('torch', bpy.data.lights.new('torch', 'SPOT'))
    lamp.data.energy = energy
    lamp.data.color = (1.0, 0.72, 0.42)
    lamp.data.spot_size = math.radians(55)
    lamp.data.spot_blend = 0.6
    lamp.data.shadow_soft_size = 0.03
    lamp.location = at
    aim(lamp, target)
    bpy.context.scene.collection.objects.link(lamp)
    return lamp


def render(scene, eye, target, lens, energy, path, size):
    cam = bpy.data.objects.new('eye', bpy.data.cameras.new('eye'))
    cam.data.lens = lens
    cam.location = eye
    aim(cam, target)
    scene.collection.objects.link(cam)
    scene.camera = cam
    lamp = torch(mathutils.Vector(eye) + mathutils.Vector((0.25, 0.05, -0.25)), target, energy)
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(lamp)
    print('rendered', path)


def preview(kind):
    scene = fresh_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f'{kind}.glb'))
    shapes = sorted((o for o in scene.objects if o.type == 'MESH'), key=lambda o: o.name)
    print(kind)
    check(shapes)
    for obj in shapes:
        # A game mesh is coarse: let Cycles soften the shadow its facets cast on themselves, as a shadow map would.
        obj.shadow_terminator_geometry_offset = 0.6
    ground()
    moon()
    x, tallest = 0.0, 0.0
    for obj in shapes:
        xs = [(obj.matrix_world @ mathutils.Vector(c)).x for c in obj.bound_box]
        obj.location.x = x - min(xs)
        x += max(xs) - min(xs) + 0.45
        tallest = max(tallest, obj.dimensions.z)
    middle = (x - 0.45) / 2
    OUT.mkdir(parents=True, exist_ok=True)
    deepest = max(o.dimensions.y for o in shapes)
    distance = max(2.2, x * 0.9 + max(tallest, deepest * 0.7))
    render(scene, (middle - distance * 0.55, -distance * 0.85, 1.55), (middle, 0, tallest * 0.42), 40, 120,
           OUT / f'{kind}.png', (1280, 720))
    first = shapes[0]
    top = first.dimensions.z - 0.15
    front = min((first.matrix_world @ mathutils.Vector(c)).y for c in first.bound_box)
    render(scene, (first.location.x - 0.4, front - 1.2, min(1.5, top * 0.75 + 0.45)), (first.location.x, front + 0.3, top * 0.55), 35, 12,
           OUT / f'{kind}_close.png', (1024, 768))


for kind in KINDS:
    preview(kind)
