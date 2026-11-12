"""Bake a place's light in Blender, with Cycles.

    blender -b --factory-startup -P tools/forge/bake.py -- <place.json> <out base> [size] [samples]

`place.json` is what src/bake.js `describe` sent: the meshes in the world, each with its rough colour, and the
lights. Each mesh is built again here vertex for vertex, so a second set of texture coordinates made here fits it
back in the game. All of them share one picture: they are unwrapped together and their islands packed into it at
one scale. Cycles then bakes into the picture all the light that falls on each surface, straight and bounced (the
diffuse direct and indirect passes, without the surface's own colour), which is written to `<out base>.png`, and the
coordinates to `<out base>.json`.

Units (src/bake.js): a lamp of intensity I in the game is 4πI watts here, a sky of intensity I is a world of
strength I/π, and the pass is multiplied by π on the way out, then divided by RANGE and sRGB-encoded into eight bits.
"""

import json
import math
import sys

import bmesh
import bpy
import numpy as np

RANGE = 4.0
args = sys.argv[sys.argv.index('--') + 1:]
place, out = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 2048
SAMPLES = int(args[3]) if len(args) > 3 else 512

described = json.load(open(place))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def here(p):
    """The game's world (left-handed, y up) in Blender's (right-handed, z up): x stays, the game's z is Blender's y."""
    return (p[0], p[2], p[1])


# --- the meshes ---------------------------------------------------------------------------------------------------

objects = []
for mesh in described['meshes']:
    points = mesh['positions']
    verts = [here(points[i:i + 3]) for i in range(0, len(points), 3)]
    tris = [tuple(mesh['indices'][i:i + 3]) for i in range(0, len(mesh['indices']), 3)]
    data = bpy.data.meshes.new(mesh['name'])
    data.from_pydata(verts, [], tris)
    data.update()
    obj = bpy.data.objects.new(mesh['name'], data)
    scene.collection.objects.link(obj)
    material = bpy.data.materials.new(mesh['name'])
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*[min(1.0, c) for c in mesh['colour']], 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    data.materials.append(material)
    objects.append(obj)

# Each face is turned to face the way the game's normals say it does (a bake lights the side a face faces): the
# game's winding and Blender's are not the same, and the axes were swapped coming here.
for obj, mesh in zip(objects, described['meshes']):
    normals = [here(mesh['normals'][i:i + 3]) for i in range(0, len(mesh['normals']), 3)]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    wrong = [face for face in bm.faces
             if sum(face.normal.dot(normals[v.index]) for v in face.verts) < 0]
    bmesh.ops.reverse_faces(bm, faces=wrong)
    bm.to_mesh(obj.data)
    bm.free()

# --- one picture for all of them ----------------------------------------------------------------------------------

bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)
    obj.data.uv_layers.new(name='light')
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')

image = bpy.data.images.new('light', SIZE, SIZE, float_buffer=True)
for obj in objects:
    for material in obj.data.materials:
        node = material.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        material.node_tree.nodes.active = node

# --- the lights -----------------------------------------------------------------------------------------------------

world = bpy.data.worlds.new('sky')
scene.world = world
world.use_nodes = True
background = world.node_tree.nodes['Background']
background.inputs['Color'].default_value = (0, 0, 0, 1)
background.inputs['Strength'].default_value = 0
for n, light in enumerate(described['lights']):
    if light['intensity'] <= 0:
        continue
    if light['kind'] == 'sky':
        background.inputs['Color'].default_value = (*light['colour'], 1)
        background.inputs['Strength'].default_value = light['intensity'] / math.pi
        continue
    lamp = bpy.data.lights.new(f'lamp {n}', 'POINT')
    lamp.energy = 4 * math.pi * light['intensity']
    lamp.color = light['colour']
    lamp.shadow_soft_size = 0.04 if light['intensity'] < 100 else 0.2
    obj = bpy.data.objects.new(f'lamp {n}', lamp)
    obj.location = here(light['position'])
    scene.collection.objects.link(obj)

# --- the bake -------------------------------------------------------------------------------------------------------

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = False
scene.render.bake.margin = 6
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer='light')

# --- what goes back -------------------------------------------------------------------------------------------------

light = np.array(image.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)[:, :, :3] * math.pi / RANGE
light = np.clip(light, 0, 1)
encoded = np.where(light <= 0.0031308, light * 12.92, 1.055 * np.power(light, 1 / 2.4) - 0.055)
picture = bpy.data.images.new('baked', SIZE, SIZE, alpha=False)
picture.colorspace_settings.name = 'Non-Color'
picture.pixels[:] = np.concatenate([encoded, np.ones((SIZE, SIZE, 1), np.float32)], axis=2).ravel()
picture.filepath_raw = out + '.png'
picture.file_format = 'PNG'
picture.save()

coordinates = {}
for obj in objects:
    layer = obj.data.uv_layers['light'].data
    uv = [0.0] * (len(obj.data.vertices) * 2)
    for poly in obj.data.polygons:
        for loop in poly.loop_indices:
            v = obj.data.loops[loop].vertex_index
            u, w = layer[loop].uv
            # (The game reads the picture top row first: its v runs down.)
            uv[v * 2], uv[v * 2 + 1] = u, 1 - w
    coordinates[obj.name] = uv
json.dump({'size': SIZE, 'samples': SAMPLES, 'range': RANGE, 'uv2': coordinates}, open(out + '.json', 'w'))
print('baked', len(objects), 'meshes into', out + '.png')
