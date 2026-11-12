"""The materials the buildings are made of, all of them shared by every model under the same names.

Five Poly Haven scans (CC0) carry everything with a texture: the colour map (its own occlusion multiplied in at
two-thirds strength, as tools/surfaces.sh does for the game's surfaces), the GL normal map and the ARM map, which is
already glTF's ORM (occlusion R, roughness G, metallic B). A material is a set with a colour multiplied over it
(glTF's baseColorFactor), so a green door and a red one share the same pictures. Each model's own occlusion, baked
by Cycles onto its second UVs (`ao`), goes in through the "glTF Material Output" group as its occlusionTexture.

Lit windows are their own material, `window_lit`: a picture of four windows at night (two curtained, a shop, a
hall light through a fanlight), one in each quarter, shown by emission.
"""

import os
import subprocess

import bpy
import numpy as np

DOWNLOADS = os.path.expanduser('~/.cache/cold-chain/dl/polyhaven')
PREPARED = os.path.expanduser('~/.cache/cold-chain/forge/buildings/textures')

# name: (Poly Haven id, resolution fetched, size shipped, metres to a repeat)
SETS = {
    'brick': ('red_brick_03', '2k', 1024, 1.0),
    'slate': ('roof_slates_03', '2k', 1024, 3.0),
    'stone': ('plaster_grey_04', '1k', 1024, 1.5),
    'ashlar': ('medieval_blocks_03', '2k', 1024, 2.0),
    'paint': ('painted_plaster_wall', '1k', 1024, 1.0),
}

ORM = 512

# name: (set or None, linear colour, roughness multiplier, metallic)
LOOKS = {
    'brick': ('brick', (0.78, 0.72, 0.7), 1.0, 0.0),
    'slate': ('slate', (0.42, 0.44, 0.5), 0.85, 0.0),
    'ridge': ('stone', (0.16, 0.13, 0.13), 0.9, 0.0),
    'stone': ('stone', (0.74, 0.66, 0.54), 1.0, 0.0),
    'ashlar': ('ashlar', (0.62, 0.6, 0.56), 1.0, 0.0),
    'terracotta': ('stone', (0.62, 0.3, 0.17), 1.0, 0.0),
    'paint_frame': ('paint', (0.72, 0.7, 0.64), 0.7, 0.0),
    'paint_door_green': ('paint', (0.03, 0.11, 0.065), 0.55, 0.0),
    'paint_door_red': ('paint', (0.26, 0.025, 0.025), 0.55, 0.0),
    'paint_door_blue': ('paint', (0.025, 0.05, 0.14), 0.55, 0.0),
    'paint_door_black': ('paint', (0.018, 0.018, 0.02), 0.5, 0.0),
    'paint_shop': ('paint', (0.03, 0.075, 0.06), 0.55, 0.0),
    'paint_shop_maroon': ('paint', (0.16, 0.02, 0.025), 0.55, 0.0),
    'paint_shop_black': ('paint', (0.015, 0.015, 0.017), 0.5, 0.0),
    'paint_shop_blue': ('paint', (0.02, 0.04, 0.11), 0.55, 0.0),
    'oak': ('paint', (0.075, 0.045, 0.028), 0.85, 0.0),
    'iron': ('paint', (0.022, 0.022, 0.024), 0.6, 0.0),
    'brass': (None, (0.55, 0.4, 0.17), 0.35, 1.0),
    'glass': (None, (0.012, 0.014, 0.016), 0.04, 0.0),
}
LIT = 'window_lit'
CLOCK = 'clock_face'
SIGN = 'shop_sign'
SHOPS = ('paint_shop', 'paint_shop_maroon', 'paint_shop_black', 'paint_shop_blue')    # in the signs' row order
CELLS = {'curtains': 0, 'parlour': 1, 'shop': 2, 'hall': 3}      # quarters of the lit picture


def tile(name):
    return SETS[LOOKS[name][0]][3] if name in LOOKS and LOOKS[name][0] else 1.0


TILES = {name: tile(name) for name in LOOKS}


# --- pictures -------------------------------------------------------------------------------------------------------

def _pixels(image):
    w, h = image.size
    return np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)


def _save(name, rgb, colour):
    h, w = rgb.shape[:2]
    image = bpy.data.images.new(name, w, h, alpha=False)
    image.colorspace_settings.name = colour
    image.pixels[:] = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], axis=2).ravel()
    image.filepath_raw = os.path.join(PREPARED, name + '.png')
    image.file_format = 'PNG'
    image.save()
    return image


def _prepare(set_name):
    """The set's three pictures at the size shipped, made once and kept."""
    ident, res, size, _ = SETS[set_name]
    paths = {kind: os.path.join(PREPARED, f'{set_name}_{kind}.png') for kind in ('colour', 'normal', 'orm')}
    if all(os.path.exists(p) for p in paths.values()):
        return paths
    os.makedirs(PREPARED, exist_ok=True)
    source = lambda kind: bpy.data.images.load(os.path.join(DOWNLOADS, ident, f'{ident}_{kind}_{res}.jpg'))
    diffuse, arm, normal = source('diff'), source('arm'), source('nor_gl')
    for image in (diffuse, arm, normal):
        image.scale(size, size)
    occlusion = _pixels(arm)[:, :, :1]
    _save(f'{set_name}_colour', _pixels(diffuse)[:, :, :3] * (1 - (1 - occlusion) * 2 / 3), 'sRGB')
    _save(f'{set_name}_normal', _pixels(normal)[:, :, :3], 'Non-Color')
    # Never the size of a model's occlusion picture (2048), or the exporter packs the two into
    # one image read through two sets of UVs.
    arm.scale(ORM, ORM)
    _save(f'{set_name}_orm', _pixels(arm)[:, :, :3], 'Non-Color')
    for image in (diffuse, arm, normal):
        bpy.data.images.remove(image)
    return paths


def _lit_picture():
    """Four windows at night, 256 px each: curtains drawn over a lamp, a parlour with the curtains open, a shut
    shop with its night light, a hall light through a fanlight."""
    path = os.path.join(PREPARED, 'window_lit.png')
    if os.path.exists(path):
        return path
    os.makedirs(PREPARED, exist_ok=True)
    n = 256
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)          # y is up the picture (Blender rows run up)
    rng = np.random.default_rng(7)
    lamp = np.array([1.0, 0.58, 0.26], np.float32)

    def glow(cx, cy, sx, sy):
        return np.exp(-((x - cx) ** 2 / sx + (y - cy) ** 2 / sy))

    folds = 0.72 + 0.28 * np.sin(2 * np.pi * (x * 11 + 0.25 * np.sin(y * 5 + x * 3)))
    curtains = (0.18 + 0.85 * glow(0.5, 0.55, 0.18, 0.3))[..., None] * lamp * np.array([1.0, 0.72, 0.55]) \
        * folds[..., None]
    gap = np.exp(-((x - 0.5) ** 2) / 0.0004)[..., None] * 0.35 * lamp
    curtains = curtains + gap

    room = (0.12 + 0.9 * glow(0.62, 0.62, 0.05, 0.08) + 0.3 * glow(0.5, 1.0, 0.4, 0.1))[..., None] * lamp
    shade = (np.abs(x - 0.62) < 0.05 + (0.68 - y) * 0.25) & (y > 0.6) & (y < 0.68)
    room[shade] = lamp * 1.15
    room[(y < 0.32) & (np.abs(x - 0.35) < 0.3)] *= 0.25                 # the back of a settee
    drape = (x < 0.2) | (x > 0.8)
    room[drape] = (0.25 * lamp * np.array([0.9, 0.55, 0.45]) * folds[..., None])[drape]

    shop = (0.05 + 0.22 * glow(0.5, 0.95, 0.3, 0.08))[..., None] * np.array([0.9, 0.8, 0.62], np.float32)
    for shelf in (0.28, 0.5, 0.72):
        band = np.abs(y - shelf) < 0.012
        shop[band] *= 0.2
        goods = (y > shelf + 0.012) & (y < shelf + 0.09) & (rng.random((n, n)) < 0.05)
        shop[goods] *= 1.6

    hall = (0.25 + 0.75 * glow(0.5, 0.9, 0.25, 0.25))[..., None] * lamp
    hall[(np.abs(y - (0.15 + x * 0.6)) < 0.015) & (x > 0.2)] *= 0.4       # the banister going up

    vignette = (0.55 + 0.45 * np.minimum(1, np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y)) * 12))[..., None]
    cells = [np.clip(c * vignette, 0, 1) for c in (curtains, room, shop, hall)]
    picture = np.concatenate([np.concatenate(cells[:2], axis=1), np.concatenate(cells[2:], axis=1)], axis=0)
    _save('window_lit', picture, 'sRGB')
    return path


def _clock_picture():
    """A church clock's dial, lit from behind: opal glass, a black chapter ring, hour bars and minute ticks."""
    path = os.path.join(PREPARED, 'clock_face.png')
    if os.path.exists(path):
        return path
    os.makedirs(PREPARED, exist_ok=True)
    n = 512
    y, x = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / n - 0.5
    r, angle = np.hypot(x, y), np.arctan2(y, x)
    dial = np.ones((n, n, 3), np.float32) * np.array([0.82, 0.8, 0.7], np.float32)
    dial *= (1 - 0.25 * (r / 0.5) ** 2)[..., None]
    black = (r > 0.47) | (np.abs(r - 0.445) < 0.004) | (np.abs(r - 0.36) < 0.003)
    minute = np.abs(((angle / (2 * np.pi) * 60) + 0.5) % 1 - 0.5) * 2 * np.pi * r / 60 < 0.0035
    hour = np.abs(((angle / (2 * np.pi) * 12) + 0.5) % 1 - 0.5) * 2 * np.pi * r / 12 < 0.012
    black |= minute & (r > 0.41) & (r < 0.445)
    black |= hour & (r > 0.33) & (r < 0.445)
    dial[black] = 0.02
    _save('clock_face', dial, 'sRGB')
    return path


def cell_uv(cell, u, v):
    """Where (u, v) in 0..1 over a lit pane falls in the picture's quarter `cell`."""
    c = CELLS[cell]
    inset = 0.02
    return (c % 2 * 0.5 + inset + u * (0.5 - 2 * inset), c // 2 * 0.5 + inset + v * (0.5 - 2 * inset))


# --- materials ------------------------------------------------------------------------------------------------------

def _gltf_output():
    """The node group the glTF exporter reads a material's occlusion from."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return group


def socket(node, identifier):
    """A socket by its identifier: a Mix node's inputs share their names ('A', 'B', 'Factor') between types."""
    return next(s for s in list(node.inputs) + list(node.outputs) if s.identifier == identifier)


def _image(path, colour):
    image = bpy.data.images.load(path, check_existing=True)
    image.colorspace_settings.name = colour
    return image


class Materials(dict):
    """The materials of one model, made as they are first asked for; `occlusion` is that model's baked picture."""

    def __init__(self, occlusion=None):
        super().__init__()
        self.occlusion = occlusion

    def __missing__(self, name):
        special = {LIT: _lit_material, CLOCK: _clock_material, SIGN: _sign_material}
        material = special.get(name, lambda: self._make(name))()
        self[name] = material
        return material

    def _make(self, name):
        set_name, colour, rough, metal = LOOKS[name]
        material = bpy.data.materials.new(name)
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bsdf = nodes['Principled BSDF']
        if set_name is None:
            bsdf.inputs['Base Color'].default_value = (*colour, 1)
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
        else:
            paths = _prepare(set_name)
            base = nodes.new('ShaderNodeTexImage')
            base.image = _image(paths['colour'], 'sRGB')
            tint = nodes.new('ShaderNodeMix')
            tint.data_type, tint.blend_type = 'RGBA', 'MULTIPLY'
            socket(tint, 'Factor_Float').default_value = 1.0
            socket(tint, 'B_Color').default_value = (*colour, 1)
            links.new(base.outputs['Color'], socket(tint, 'A_Color'))
            links.new(socket(tint, 'Result_Color'), bsdf.inputs['Base Color'])
            orm = nodes.new('ShaderNodeTexImage')
            orm.image = _image(paths['orm'], 'Non-Color')
            split = nodes.new('ShaderNodeSeparateColor')
            links.new(orm.outputs['Color'], split.inputs['Color'])
            scale = nodes.new('ShaderNodeMath')
            scale.operation = 'MULTIPLY'
            scale.inputs[1].default_value = rough
            links.new(split.outputs['Green'], scale.inputs[0])
            links.new(scale.outputs['Value'], bsdf.inputs['Roughness'])
            links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
            normal = nodes.new('ShaderNodeTexImage')
            normal.image = _image(paths['normal'], 'Non-Color')
            bump = nodes.new('ShaderNodeNormalMap')
            links.new(normal.outputs['Color'], bump.inputs['Color'])
            links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        if self.occlusion is not None:
            self._occlusion(material)
        return material

    def _occlusion(self, material):
        nodes, links = material.node_tree.nodes, material.node_tree.links
        coords = nodes.new('ShaderNodeUVMap')
        coords.uv_map = 'ao'
        picture = nodes.new('ShaderNodeTexImage')
        picture.name = 'ao'
        picture.image = self.occlusion
        links.new(coords.outputs['UV'], picture.inputs['Vector'])
        split = nodes.new('ShaderNodeSeparateColor')
        links.new(picture.outputs['Color'], split.inputs['Color'])
        output = nodes.new('ShaderNodeGroup')
        output.node_tree = _gltf_output()
        links.new(split.outputs['Red'], output.inputs['Occlusion'])


def _lit_material():
    material = bpy.data.materials.new(LIT)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Roughness'].default_value = 0.08
    picture = nodes.new('ShaderNodeTexImage')
    picture.image = _image(_lit_picture(), 'sRGB')
    links.new(picture.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return material


def _clock_material():
    material = bpy.data.materials.new(CLOCK)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    picture = nodes.new('ShaderNodeTexImage')
    picture.image = _image(_clock_picture(), 'sRGB')
    links.new(picture.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(picture.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 0.35
    bsdf.inputs['Roughness'].default_value = 0.2
    return material


def _sign_picture():
    """The four shops' fascias (signs.py, with the system's Python), each on its board's paint."""
    path = os.path.join(PREPARED, 'shop_signs.png')
    if not os.path.exists(path):
        os.makedirs(PREPARED, exist_ok=True)
        boards = [','.join(f'{(c * 0.8) ** (1 / 2.2):.3f}' for c in LOOKS[paint][1]) for paint in SHOPS]
        subprocess.run(['python3', os.path.join(os.path.dirname(__file__), 'signs.py'), path, *boards], check=True)
    return path


def sign_uv(row, u, v):
    """Where (u, v) over a fascia falls in the signs' picture, row 0 at the top."""
    return (u, 1 - (row + 1) / 4 + v / 4)


def _sign_material():
    material = bpy.data.materials.new(SIGN)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    picture = nodes.new('ShaderNodeTexImage')
    picture.image = _image(_sign_picture(), 'sRGB')
    links.new(picture.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.4
    return material


def occlusion_picture(name, size):
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.generated_color = (1, 1, 1, 1)
    return image

