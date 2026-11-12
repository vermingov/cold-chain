"""Night renders of the models as the game will have them: read back from their GLB files, on a wet road and a
flagged pavement, under a low cool moon, with a sodium street lamp, and some of the windows lit.
"""

import math
import os
import random

import bpy
from mathutils import Vector

import baking
import surfaces

SURFACES = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'assets', 'surfaces')


def _textured(name, folder, tile, tint=(1, 1, 1)):
    material = bpy.data.materials.new(name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    coords = nodes.new('ShaderNodeTexCoord')
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'SCALE'
    scale.inputs['Scale'].default_value = 1 / tile
    links.new(coords.outputs['Object'], scale.inputs[0])
    for kind, socket in (('albedo', 'Base Color'), ('rough', 'Roughness'), ('normal', None)):
        node = nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(os.path.join(SURFACES, folder, kind + '.jpg'), check_existing=True)
        links.new(scale.outputs['Vector'], node.inputs['Vector'])
        if kind == 'albedo':
            mix = nodes.new('ShaderNodeMix')
            mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
            surfaces.socket(mix, 'Factor_Float').default_value = 1
            surfaces.socket(mix, 'B_Color').default_value = (*tint, 1)
            links.new(node.outputs['Color'], surfaces.socket(mix, 'A_Color'))
            links.new(surfaces.socket(mix, 'Result_Color'), bsdf.inputs['Base Color'])
        elif kind == 'rough':
            node.image.colorspace_settings.name = 'Non-Color'
            wet = nodes.new('ShaderNodeMath')
            wet.operation = 'MULTIPLY'
            wet.inputs[1].default_value = 0.55
            links.new(node.outputs['Color'], wet.inputs[0])
            links.new(wet.outputs['Value'], bsdf.inputs['Roughness'])
        else:
            node.image.colorspace_settings.name = 'Non-Color'
            bump = nodes.new('ShaderNodeNormalMap')
            links.new(node.outputs['Color'], bump.inputs['Color'])
            links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return material


def _slab(name, lo, hi, material):
    bpy.ops.mesh.primitive_cube_add(location=[(a + b) / 2 for a, b in zip(lo, hi)])
    obj = bpy.context.object
    obj.name = name
    obj.scale = [(b - a) / 2 for a, b in zip(lo, hi)]
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    return obj


def street(front_y=0.0, length=60.0, kerb=-2.2, x=0.0):
    """A flagged pavement in front of a row whose fronts are at `front_y`, a kerb, and a wet tarmac road, `length`
    long round `x`."""
    flags = _textured('pavement', 'pavement', 2.0, (0.55, 0.55, 0.55))
    road = _textured('road', 'tarmac', 3.0, (0.35, 0.35, 0.37))
    _slab('pavement', (x - length / 2, front_y + kerb, -0.3), (x + length / 2, front_y + 12, 0.0), flags)
    _slab('road', (x - length / 2, front_y - 12, -0.42), (x + length / 2, front_y + kerb, -0.12), road)


def night(lamps=((-6.0, -2.6),), moon=(0.95, 0.0, 0.75)):
    """The sky, a moon low in it, and sodium lamps at (x, y) on 5.5 m posts."""
    scene = bpy.context.scene
    scene.world = scene.world or bpy.data.worlds.new('night')
    background = scene.world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (0.006, 0.009, 0.018, 1)
    background.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('moon', 'SUN')
    sun.energy = 0.3
    sun.color = (0.62, 0.72, 1.0)
    sun.angle = math.radians(1.2)
    obj = bpy.data.objects.new('moon', sun)
    obj.rotation_euler = moon
    scene.collection.objects.link(obj)
    post = bpy.data.materials.new('lamp post')
    post.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.025, 0.02, 1)
    for x, y in lamps:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=5.6, location=(x, y, 2.8))
        bpy.context.object.data.materials.append(post)
        light = bpy.data.lights.new('sodium', 'POINT')
        light.energy = 900
        light.color = (1.0, 0.5, 0.16)
        light.shadow_soft_size = 0.12
        lamp = bpy.data.objects.new('sodium', light)
        lamp.location = (x, y + 0.6, 5.4)
        scene.collection.objects.link(lamp)


def light_some(panes, share=0.3, seed=3):
    """Hide all but `share` of the lit panes, as the game does."""
    rng = random.Random(seed)
    for obj in panes:
        lit = rng.random() < share
        obj.hide_render = not lit


def render(path, eye, look, lens=32, samples=64, size=(1280, 720)):
    scene = bpy.context.scene
    baking.cycles(samples)
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 1.2
    camera = bpy.data.cameras.new('eye')
    camera.lens = lens
    camera.clip_end = 1000
    obj = bpy.data.objects.new('eye', camera)
    scene.collection.objects.link(obj)
    obj.location = eye
    obj.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = obj
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(obj)
    print('preview', path)
