"""Cycles bakes for the building models.

`occlusion` unwraps a model's meshes together into second UVs (`ao`) packed in one picture and bakes ambient
occlusion into it, each mesh standing on a ground of its own, away from the others, so the foot of a wall darkens
where it meets the pavement and nothing else's shadow falls on it. `far_facades` bakes what each near model looks
like (its surface colour, times its occlusion) onto its far box, all the boxes sharing one picture.
"""

import math
import os

import bpy
import numpy as np

THREADS = 6         # other forges share the machine
SPACING = 40.0


def cycles(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = THREADS
    if scene.world is None:
        scene.world = bpy.data.worlds.new('world')


def unwrap(objects, layer, margin=0.004):
    """One unwrap over all `objects` into their UV layer `layer` (made if missing), islands packed at one scale."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        uvs = obj.data.uv_layers
        uvs.active = uvs.get(layer) or uvs.new(name=layer)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in objects:
        obj.data.uv_layers.active = obj.data.uv_layers[0]


class Apart:
    """Each object moved SPACING from the next on a ground of its own while baking, and put back afterwards."""

    def __init__(self, groups):
        self.groups = groups        # lists of objects that stay together

    def __enter__(self):
        self.grounds = []
        ground = bpy.data.materials.new('bake ground')
        for i, group in enumerate(self.groups):
            for obj in group:
                obj.location.x += i * SPACING
            bpy.ops.mesh.primitive_plane_add(size=SPACING * 0.9, location=(i * SPACING, 4, 0))
            plane = bpy.context.object
            plane.data.materials.append(ground)
            self.grounds.append(plane)
        return self

    def __exit__(self, *_):
        for i, group in enumerate(self.groups):
            for obj in group:
                obj.location.x -= i * SPACING
        for plane in self.grounds:
            bpy.data.objects.remove(plane)


def _target(objects, node_name):
    for obj in objects:
        for material in obj.data.materials:
            material.node_tree.nodes.active = material.node_tree.nodes[node_name]


def _select(objects, active):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def occlusion(objects, image, samples=96, distance=1.5):
    """Ambient occlusion over `objects` (whose materials hold `image` in a node named 'ao') into `image`."""
    unwrap(objects, 'ao')
    cycles(samples)
    bpy.context.scene.world.light_settings.distance = distance
    _target(objects, 'ao')
    with Apart([[obj] for obj in objects]):
        _select(objects, objects[0])
        bpy.ops.object.bake(type='AO', uv_layer='ao', margin=6, use_clear=True)
    save(image)


def far_facades(pairs, colour, samples=16):
    """For each (near, far) pair, the near one's surface colour times its occlusion baked onto the far one, all into
    `colour`, which every far object's one material ('facade_far', its picture node named 'far') shows."""
    fars = [far for _, far in pairs]
    unwrap(fars, 'uv', margin=0.01)
    occluded = bpy.data.images.new('far occlusion', *colour.size, alpha=False)
    occluded.colorspace_settings.name = 'Non-Color'
    cycles(samples)
    scene = bpy.context.scene
    scene.world.light_settings.distance = 1.5
    nodes = fars[0].data.materials[0].node_tree.nodes
    with Apart([[near, far] for near, far in pairs]):
        for image, kind, passes in ((colour, 'DIFFUSE', {'COLOR'}), (occluded, 'AO', set())):
            nodes['far'].image = image
            _target(fars, 'far')
            for near, far in pairs:
                _select([near, far], far)
                bpy.ops.object.bake(type=kind, pass_filter=passes, use_selected_to_active=True, cage_extrusion=0.8,
                                    max_ray_distance=1.6, margin=6, use_clear=False)
    nodes['far'].image = colour
    pixels = np.array(colour.pixels[:], np.float32).reshape(-1, 4)
    shade = np.array(occluded.pixels[:], np.float32).reshape(-1, 4)[:, :1]
    pixels[:, :3] *= 0.35 + 0.65 * shade
    colour.pixels[:] = pixels.ravel()
    bpy.data.images.remove(occluded)
    save(colour)


def save(image):
    folder = os.path.expanduser('~/.cache/cold-chain/forge/buildings/baked')
    os.makedirs(folder, exist_ok=True)
    image.filepath_raw = os.path.join(folder, image.name + '.png')
    image.file_format = 'PNG'
    image.save()
