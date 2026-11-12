"""The workshop the forged models share: parts, materials, the bake and the export.

Not run on its own: props.py imports it. A model is built twice by the same function, once fine (rounded edges,
dense circles, the print on keys and dials, scanned surfaces) and once plain, to the game's budget. Cycles bakes the
fine one onto the plain one, selected to active, part by part, into one picture per map that all of a model's parts
share: base colour, roughness, metalness, normals, and occlusion with every part in place. The plain parts go out as
one GLB with those maps as WebP, the moving parts keeping their pivots, the lamps as emissive meshes of their own.

Conventions: metres, Z up, the front faces -Y, the origin at the middle of the base on the floor; a part that moves
has its origin on its pivot.
"""

import json
import math
import struct
import urllib.request
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets' / 'models' / 'props'
PREVIEWS = Path.home() / '.cache' / 'cold-chain' / 'forge-previews' / 'props'
DOWNLOADS = Path.home() / '.cache' / 'cold-chain' / 'dl' / 'polyhaven'
TEXTURES = Path.home() / '.cache' / 'cold-chain' / 'forge-textures' / 'props'
THREADS = 4             # other forges share the machine


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = THREADS
    return scene


# --- Poly Haven -----------------------------------------------------------------------------------------------------

def polyhaven(asset, res='1k'):
    """The colour, normal (OpenGL) and AO/rough/metal maps of a Poly Haven texture, fetched once into the cache."""
    folder = DOWNLOADS / asset
    folder.mkdir(parents=True, exist_ok=True)
    files, maps = None, {}
    for key, name in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
        target = folder / f'{name}_{res}.jpg'
        if not target.exists():
            if files is None:
                request = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': 'cold-chain-forge'})
                files = json.load(urllib.request.urlopen(request))
            if key not in files:
                continue
            request = urllib.request.Request(files[key][res]['jpg']['url'], headers={'User-Agent': 'cold-chain-forge'})
            target.write_bytes(urllib.request.urlopen(request).read())
        maps[name] = str(target)
    return maps


# --- parts ------------------------------------------------------------------------------------------------------------

def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def from_bmesh(name, bm, material=None):
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    obj = _link(bpy.data.objects.new(name, data))
    if material:
        data.materials.append(material)
    return obj


def apply(obj):
    """Bake the object's modifiers (or a curve's shape) into a plain mesh object, which is returned."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    if obj.type == 'MESH':
        old = obj.data
        obj.modifiers.clear()
        obj.data = data
        bpy.data.meshes.remove(old)
        return obj
    mesh = _link(bpy.data.objects.new(obj.name, data))
    mesh.matrix_world = obj.matrix_world
    bpy.data.objects.remove(obj)
    return mesh


def bevel(obj, width, segments=1, angle=40, harden=False):
    """Round (or with one segment, chamfer) the object's edges sharper than `angle` degrees, at once."""
    if width <= 0:
        return obj
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.use_clamp_overlap = True
    mod.harden_normals = harden
    return apply(obj)


def block(name, lo, hi, material=None, round=0.0, segments=1, grain='Z', tile=1.0):
    """A box from corner `lo` to corner `hi`, its edges rounded by `round`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    size = [h - l for l, h in zip(lo, hi)]
    middle = [(h + l) / 2 for l, h in zip(lo, hi)]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(middle) @ Matrix.Diagonal((*size, 1)), verts=bm.verts)
    obj = bevel(from_bmesh(name, bm, material), min(round, min(size) * 0.49), segments)
    return box_uv(obj, grain, tile)


def prism(name, outline, z0, z1, material=None, round=0.0, segments=1, grain='Z', tile=1.0):
    """An outline in the XY plane (counter-clockwise, seen from above) stood up from z0 to z1."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = bevel(from_bmesh(name, bm, material), round, segments)
    return box_uv(obj, grain, tile)


def lathe(name, profile, segments, material=None, axis='Z', at=(0, 0, 0), tile=0.2, turn=0.0):
    """Turned on a lathe: `profile` is [(radius, height)] from one end to the other, spun round `axis`, standing
    on `at`. A radius of 0 closes that end to a point."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(turn + 2 * math.pi * k / segments), r * math.sin(turn + 2 * math.pi * k / segments), z))
                          for k in range(segments)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            k1 = (k + 1) % segments
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[k1], b[k]))
            elif len(b) == 1:
                bm.faces.new((a[k], a[k1], b[0]))
            else:
                bm.faces.new((a[k], a[k1], b[k1], b[k]))
    # Open ends of more than one vertex are capped.
    if len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    turnto = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ turnto, verts=bm.verts)
    obj = from_bmesh(name, bm, material)
    smooth(obj, 50)
    return box_uv(obj, axis, tile)


def fillet(points, radius, steps=4):
    """A polyline with each inner corner rounded to about `radius`."""
    points = [Vector(p) for p in points]
    out = [points[0]]
    for a, b, c in zip(points, points[1:], points[2:]):
        u, w = (a - b), (c - b)
        angle = u.angle(w, math.pi)
        if angle > math.pi - 1e-3:
            out.append(b)
            continue
        reach = min(radius / math.tan(angle / 2), u.length * 0.49, w.length * 0.49)
        p, q = b + u.normalized() * reach, b + w.normalized() * reach
        for k in range(steps + 1):
            t = k / steps
            out.append((1 - t) ** 2 * p + 2 * (1 - t) * t * b + t ** 2 * q)
    out.append(points[-1])
    return out


def tube(name, points, radius, sides=8, material=None, closed=False, caps=True, tile=0.3):
    """A round bar along a polyline."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = max(0, (sides - 4) // 2)
    curve.use_fill_caps = caps
    curve.twist_mode = 'MINIMUM'
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    spline.use_cyclic_u = closed
    obj = apply(_link(bpy.data.objects.new(name, curve)))
    if material:
        obj.data.materials.append(material)
    smooth(obj, 60)
    return box_uv(obj, 'Z', tile)


def coil(path, coil_radius, pitch, wire_radius, sides=6, steps=8, material=None):
    """A coiled cord (a telephone's) following `path`: a helix of `coil_radius` with `pitch` metres between turns,
    `steps` points to a turn, of wire `wire_radius` thick."""
    path = [Vector(p) for p in path]
    # The path evenly resampled, and a frame carried along it without twisting.
    length = sum((b - a).length for a, b in zip(path, path[1:]))
    count = max(2, int(length / pitch * steps))
    spots, walked, seg = [], 0.0, 0
    lengths = [(b - a).length for a, b in zip(path, path[1:])]
    for i in range(count + 1):
        want = length * i / count
        while seg < len(lengths) - 1 and walked + lengths[seg] < want:
            walked += lengths[seg]
            seg += 1
        t = (want - walked) / max(lengths[seg], 1e-9)
        spots.append(path[seg].lerp(path[seg + 1], min(1.0, t)))
    tangents = [(spots[min(i + 1, count)] - spots[max(i - 1, 0)]).normalized() for i in range(count + 1)]
    side = tangents[0].orthogonal().normalized()
    helix = []
    for i, (p, t) in enumerate(zip(spots, tangents)):
        side = (side - t * side.dot(t)).normalized()
        up = t.cross(side)
        a = 2 * math.pi * i / steps
        helix.append(p + (side * math.cos(a) + up * math.sin(a)) * coil_radius)
    return tube('coil', helix, wire_radius, sides, material, tile=0.05)


def text(body, size, material, matrix, font_weight=0.0):
    """Flat lettering (a decal for the fine model): `matrix` places its middle; it lies in its local XY plane."""
    curve = bpy.data.curves.new('text', 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.offset = font_weight
    obj = _link(bpy.data.objects.new('text', curve))
    obj.matrix_world = Matrix(matrix)
    obj = apply(obj)
    obj.data.materials.append(material)
    return box_uv(obj, 'Z', 1.0)


def box_uv(obj, grain='Z', tile=1.0, layer='detail'):
    """Texture coordinates in metres over `tile`, each face projected along the axis it faces most; the axis
    `grain` (wood's grain, brush strokes) runs up the picture wherever it lies in a face."""
    data = obj.data
    if not data.polygons:
        return obj
    uv = data.uv_layers.get(layer) or data.uv_layers.new(name=layer)
    g = 'XYZ'.index(grain)
    shift = (hash(obj.name) % 997) / 997 * 3.1
    for poly in data.polygons:
        n = poly.normal
        facing = max(range(3), key=lambda i: abs(n[i]))
        plane = [i for i in range(3) if i != facing]
        if g in plane:
            v = g
            u = plane[0] if plane[1] == g else plane[1]
        else:
            u, v = plane
        for index in poly.loop_indices:
            co = data.vertices[data.loops[index].vertex_index].co
            uv.data[index].uv = (co[u] / tile + shift, co[v] / tile + shift * 0.7)
    return obj


def smooth(obj, angle=35):
    with bpy.context.temp_override(selected_editable_objects=[obj], object=obj, active_object=obj):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    return obj


def join(name, pieces, angle=35):
    """The pieces as one object called `name` (the first piece's)."""
    pieces = [p for p in pieces if p is not None]
    with bpy.context.temp_override(selected_editable_objects=pieces, active_object=pieces[0], object=pieces[0]):
        bpy.ops.object.join()
    obj = pieces[0]
    obj.name = obj.data.name = name
    return obj


def move(obj, matrix):
    """Move the object's mesh by `matrix` (its origin stays where it is)."""
    obj.data.transform(Matrix(matrix))
    obj.data.update()
    return obj


def pivot(obj, point):
    """Put the object's origin at `point` without moving its mesh in the world."""
    point = Vector(point)
    obj.data.transform(Matrix.Translation(-point))
    obj.location = point
    return obj


def T(x=0, y=0, z=0):
    return Matrix.Translation((x, y, z))


def R(degrees, axis):
    return Matrix.Rotation(math.radians(degrees), 4, axis)


# --- materials --------------------------------------------------------------------------------------------------------

class Shader:
    """A material for the fine model, wired with a few words. `out(...)` connects whatever is given to the BSDF."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.tree = self.material.node_tree
        self.bsdf = self.tree.nodes['Principled BSDF']
        self._uv = None

    def node(self, kind, **inputs):
        node = self.tree.nodes.new(kind)
        for key, value in inputs.items():
            if key.startswith('_'):
                setattr(node, key[1:], value)
            elif hasattr(value, 'is_output'):
                self.tree.links.new(value, node.inputs[key])
            else:
                node.inputs[key].default_value = value
        return node

    def link(self, socket, target):
        if hasattr(socket, 'is_output'):
            self.tree.links.new(socket, target)
        elif isinstance(socket, (tuple, list)):
            target.default_value = socket if len(socket) == len(target.default_value) else (*socket, 1)
        else:
            target.default_value = socket

    def uv(self, tile=1.0, rotate=0.0):
        """The fine model's own texture coordinates, scaled to repeat every `tile` (metres over the box_uv tile)."""
        source = self.node('ShaderNodeUVMap', _uv_map='detail').outputs['UV']
        if tile == 1.0 and not rotate:
            return source
        return self.node('ShaderNodeMapping', Vector=source, Scale=(1 / tile, 1 / tile, 1), Rotation=(0, 0, rotate)).outputs['Vector']

    def image(self, path, vector, data=False):
        node = self.node('ShaderNodeTexImage', Vector=vector)
        node.image = bpy.data.images.load(path, check_existing=True)
        node.image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        return node

    def scan(self, asset, vector, res='1k'):
        """Poly Haven maps: (colour, normal, ao, roughness, metal) sockets."""
        maps = polyhaven(asset, res)
        colour = self.image(maps['diff'], vector).outputs['Color']
        normal = self.node('ShaderNodeNormalMap', Color=self.image(maps['nor'], vector, True).outputs['Color']).outputs['Normal']
        arm = self.node('ShaderNodeSeparateColor', Color=self.image(maps['arm'], vector, True).outputs['Color']) if 'arm' in maps else None
        if arm is None:
            return colour, normal, 1.0, 0.6, 0.0
        return colour, normal, arm.outputs['Red'], arm.outputs['Green'], arm.outputs['Blue']

    def noise(self, scale, detail=6.0, vector=None, roughness=0.55, distortion=0.0, dims='3D'):
        node = self.node('ShaderNodeTexNoise', Scale=scale, Detail=detail, Roughness=roughness, Distortion=distortion, _noise_dimensions=dims)
        if vector is not None:
            self.link(vector, node.inputs['Vector'])
        return node.outputs['Fac']

    def math(self, op, a, b=0.0, clamp=False):
        node = self.node('ShaderNodeMath', _operation=op, _use_clamp=clamp)
        self.link(a, node.inputs[0])
        self.link(b, node.inputs[1])
        return node.outputs[0]

    def ramp(self, value, lo, hi, to=(0.0, 1.0)):
        """`value` from lo..hi mapped smoothly to to[0]..to[1], clamped."""
        node = self.node('ShaderNodeMapRange', _interpolation_type='SMOOTHSTEP', **{'From Min': lo, 'From Max': hi, 'To Min': to[0], 'To Max': to[1]})
        self.link(value, node.inputs['Value'])
        return node.outputs['Result']

    def mix(self, a, b, factor, kind='RGBA', blend='MIX'):
        node = self.node('ShaderNodeMix', _data_type=kind, _blend_type=blend)
        suffix = {'RGBA': 'Color', 'FLOAT': 'Float'}[kind]
        sockets = {s.identifier: s for s in node.inputs}
        self.link(factor, sockets['Factor_Float'])
        self.link(a, sockets['A_' + suffix])
        self.link(b, sockets['B_' + suffix])
        return {s.identifier: s for s in node.outputs}['Result_' + suffix]

    def occlusion(self, distance=0.03):
        """How shut in a point is by what is near (dirt gathers there)."""
        return self.node('ShaderNodeAmbientOcclusion', Distance=distance, _samples=16).outputs['AO']

    def edges(self, radius=0.002):
        """1 on the outer edges and corners (where paint wears), 0 on the flat."""
        rounded = self.node('ShaderNodeBevel', Radius=radius, _samples=8).outputs['Normal']
        flat = self.node('ShaderNodeNewGeometry').outputs['Normal']
        dot = self.node('ShaderNodeVectorMath', _operation='DOT_PRODUCT', Vector=rounded, Vector_001=flat).outputs['Value']
        return self.ramp(dot, 0.93, 0.995, (1.0, 0.0))

    def bump(self, height, strength=0.3, distance=0.001, normal=None):
        node = self.node('ShaderNodeBump', Strength=strength, Distance=distance)
        self.link(height, node.inputs['Height'])
        if normal is not None:
            self.link(normal, node.inputs['Normal'])
        return node.outputs['Normal']

    def out(self, colour=None, roughness=None, metallic=None, normal=None):
        for socket, value in (('Base Color', colour), ('Roughness', roughness), ('Metallic', metallic), ('Normal', normal)):
            if value is not None:
                self.link(value, self.bsdf.inputs[socket])
        return self.material


def lamp_material(name, colour, strength):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Emission Color'].default_value = (*colour, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    bsdf.inputs['Roughness'].default_value = 0.2
    material['lamp'] = True
    return material


# --- the bake ---------------------------------------------------------------------------------------------------------

def _grow(rgba, steps):
    """Fill the empty pixels (alpha 0) from their filled neighbours, `steps` pixels out, so seams don't show."""
    filled = rgba[..., 3] > 0.5
    colour = np.where(filled[..., None], rgba[..., :3], 0.0)
    for _ in range(steps):
        total = np.zeros_like(colour)
        count = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            total += np.roll(np.roll(colour * filled[..., None], dy, 0), dx, 1)
            count += np.roll(np.roll(filled, dy, 0), dx, 1)
        grow = (~filled) & (count > 0)
        colour[grow] = total[grow] / count[grow, None]
        filled = filled | grow
    return colour, filled


def _emit(highs, channel):
    """Show `channel` of each fine material as light, for an EMIT bake; 'plain' gives them a bare diffuse (an
    occlusion bake runs the surface's shader wherever its rays land), None puts the BSDF back."""
    for obj in highs:
        for material in obj.data.materials:
            if material is None or material.get('lamp'):
                continue
            tree = material.node_tree
            output = next(n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
            bsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if channel is None:
                tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
                continue
            if channel == 'plain':
                plain = tree.nodes.get('bake plain') or tree.nodes.new('ShaderNodeBsdfDiffuse')
                plain.name = 'bake plain'
                tree.links.new(plain.outputs['BSDF'], output.inputs['Surface'])
                continue
            emission = tree.nodes.get('bake emission') or tree.nodes.new('ShaderNodeEmission')
            emission.name = 'bake emission'
            for link in list(emission.inputs['Color'].links):
                tree.links.remove(link)
            if channel == 'Roughness Metallic':
                # Both in one picture: roughness in red, metalness in green.
                target = tree.nodes.get('bake pack') or tree.nodes.new('ShaderNodeCombineColor')
                target.name = 'bake pack'
                tree.links.new(target.outputs['Color'], emission.inputs['Color'])
                for socket, into in (('Roughness', 'Red'), ('Metallic', 'Green')):
                    _carry(tree, bsdf.inputs[socket], target.inputs[into])
            else:
                _carry(tree, bsdf.inputs[channel], emission.inputs['Color'])
            tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])


def _carry(tree, source, target):
    """Whatever feeds `source` (a link, or its value) feeds `target` too."""
    if source.links:
        tree.links.new(source.links[0].from_socket, target)
        return
    value = source.default_value
    if hasattr(value, '__len__') and not hasattr(target.default_value, '__len__'):
        value = value[0]
    elif not hasattr(value, '__len__') and hasattr(target.default_value, '__len__'):
        value = (value, value, value, 1)
    target.default_value = value


def _bake_pass(pairs, highs, kind, size, samples, extrusion, reach, apart=None):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    total = np.zeros((size, size, 4), np.float32)
    for low, high in pairs:
        if kind == 'AO' and apart:
            # Occlusion only from the parts that stay with this one.
            for other in highs:
                other.hide_render = apart.get(other, 0) != apart.get(high, 0)
        image = bpy.data.images.new('pass', size, size, alpha=True, float_buffer=True)
        image.colorspace_settings.name = 'Non-Color'
        image.pixels.foreach_set(np.zeros(size * size * 4, np.float32))
        low.data.materials[0].node_tree.nodes['bake target'].image = image
        bpy.ops.object.select_all(action='DESELECT')
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=reach,
                            margin=0, normal_space='TANGENT', use_clear=False, target='IMAGE_TEXTURES')
        pixels = np.empty(size * size * 4, np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(size, size, 4)
        hit = pixels[..., 3] > 0.5
        total[hit] = pixels[hit]
        bpy.data.images.remove(image)
    for other in highs:
        other.hide_render = False
    return total


def _srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


def _picture(name, rgb, colour):
    """The map, also kept as a lossless WebP master in the textures folder, from which `ship` makes what the GLB
    carries."""
    size = rgb.shape[0]
    pixels = np.concatenate([np.clip(rgb, 0, 1), np.ones((size, size, 1), np.float32)], axis=2).astype(np.float32).ravel()
    TEXTURES.mkdir(parents=True, exist_ok=True)
    file = bpy.data.images.new(name + ' file', size, size, alpha=False)
    file.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    file.pixels.foreach_set(pixels)
    file.file_format = 'WEBP'
    file.save(filepath=str(TEXTURES / f'{name}.webp'), quality=100)
    bpy.data.images.remove(file)
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def _gltf_output_group():
    """The node group the glTF exporter reads ambient occlusion from."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        group.nodes.new('NodeGroupInput')
    return group


def bake(name, parts, highs, size, extrusion=0.004, dirt=0.5, reach_ao=0.1, apart=(), samples_ao=64):
    """Bake the fine `highs` (name -> object) onto the plain `parts` (name -> object; those without a fine twin
    keep their own material) and give the plain ones the result as one material. `dirt` is how much of the
    occlusion goes into the colour as well: the game's lights are lamps, which an occlusion map alone would not dim.
    `apart` is groups of part names that move away from the rest (a lid, a handset, a wheel): their occlusion is
    baked from their own group only, and the rest's without them."""
    pairs = [(parts[k], highs[k]) for k in parts if k in highs]
    lows = [low for low, _ in pairs]
    # Triangles from the start, so the tangents the normals are baked against are the ones that get exported.
    for low in lows:
        bm = bmesh.new()
        bm.from_mesh(low.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(low.data)
        bm.free()
    # One atlas over every plain part, at one texel size.
    for low in lows:
        while low.data.uv_layers:
            low.data.uv_layers.remove(low.data.uv_layers[0])
        low.data.uv_layers.new(name='atlas')
    bpy.ops.object.select_all(action='DESELECT')
    for low in lows:
        low.select_set(True)
    bpy.context.view_layer.objects.active = lows[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=4 / size * 2, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    target = bpy.data.materials.new('bake target')
    target.use_nodes = True
    node = target.node_tree.nodes.new('ShaderNodeTexImage')
    node.name = 'bake target'
    target.node_tree.nodes.active = node
    for low in lows:
        low.data.materials.clear()
        low.data.materials.append(target)
        low.data.polygons.foreach_set('material_index', [0] * len(low.data.polygons))
        # The plain parts stand where the fine ones do; light and shadow are the fine ones' business.
        for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow'):
            setattr(low, flag, False)
    others = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in lows and o not in highs.values()]
    for obj in others:
        obj.hide_render = True

    scene = bpy.context.scene
    scene.cycles.use_denoising = False
    scene.world = scene.world or bpy.data.worlds.new('bake')
    scene.world.light_settings.distance = reach_ao
    found = {}
    # Occlusion changes slowly across a surface: it is baked at half the size, which is a quarter of the rays.
    for channel, kind, samples, scale in (('Base Color', 'EMIT', 4, 1), ('Roughness Metallic', 'EMIT', 4, 1),
                                          ('normal', 'NORMAL', 4, 1), ('ao', 'AO', samples_ao, 2)):
        _emit(highs.values(), channel if kind == 'EMIT' else 'plain' if kind == 'AO' else None)
        print(f'  baking {channel} ({size // scale}px)', flush=True)
        groups = {highs[k]: n + 1 for n, group in enumerate(apart) for k in group if k in highs}
        found[channel] = _bake_pass(pairs, list(highs.values()), kind, size // scale, samples, extrusion, extrusion * 3, groups)
        if scale > 1:
            found[channel] = np.repeat(np.repeat(found[channel], scale, 0), scale, 1)
    _emit(highs.values(), None)
    for obj in others:
        obj.hide_render = False

    grow = max(8, size // 64)
    colour, _ = _grow(found['Base Color'], grow)
    surface, _ = _grow(found['Roughness Metallic'], grow)
    rough, metal = surface[..., 0:1], surface[..., 1:2]
    normal, _ = _grow(found['normal'], grow)
    ao, _ = _grow(found['ao'], grow)
    ao = ao[..., 0]
    colour = colour * (1 - dirt + dirt * ao)[..., None]
    # Blender's pixels run bottom row first, as glTF's texture coordinates expect once exported.
    base = _picture(f'{name}_color', _srgb(colour), True)
    normals = _picture(f'{name}_normal', normal, False)
    orm = _picture(f'{name}_orm', np.stack([ao, rough[..., 0], metal[..., 0]], axis=2), False)

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    bsdf = tree.nodes['Principled BSDF']
    uv = tree.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'atlas'

    def texture(image):
        tex = tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tree.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        return tex

    tree.links.new(texture(base).outputs['Color'], bsdf.inputs['Base Color'])
    normal_map = tree.nodes.new('ShaderNodeNormalMap')
    normal_map.uv_map = 'atlas'
    tree.links.new(texture(normals).outputs['Color'], normal_map.inputs['Color'])
    tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
    split = tree.nodes.new('ShaderNodeSeparateColor')
    tree.links.new(texture(orm).outputs['Color'], split.inputs['Color'])
    tree.links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    tree.links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    settings = tree.nodes.new('ShaderNodeGroup')
    settings.node_tree = _gltf_output_group()
    tree.links.new(split.outputs['Red'], settings.inputs['Occlusion'])
    for low in lows:
        low.data.materials.clear()
        low.data.materials.append(material)
        for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow'):
            setattr(low, flag, True)
    return material


# --- the whole of it --------------------------------------------------------------------------------------------------

def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def forge(name, build, size, pivots=None, parents=None, extrusion=0.004, dirt=0.5, reach_ao=0.1, apart=(), shipped=None):
    """Build `name` fine and plain with `build(fine)` (which returns {part: object}), bake, set the pivots and
    parents, and export assets/models/props/<name>.glb. Returns the GLB's path."""
    reset()
    highs = build(True)
    for obj in highs.values():
        obj.name = obj.data.name = 'fine ' + obj.name
    parts = build(False)
    for key, obj in parts.items():
        obj.name = obj.data.name = key
    lamps = [obj for obj in parts.values() if any(m and m.get('lamp') for m in obj.data.materials)]
    for key in [k for k in highs if parts.get(k) in lamps]:
        bpy.data.objects.remove(highs.pop(key))
    bake(name, {k: v for k, v in parts.items() if v not in lamps}, highs, size, extrusion, dirt, reach_ao, apart)
    for obj in highs.values():
        bpy.data.objects.remove(obj)
    for key, point in (pivots or {}).items():
        pivot(parts[key], point)
    bpy.context.view_layer.update()
    for child, parent in (parents or {}).items():
        parts[child].parent = parts[parent]
        parts[child].matrix_parent_inverse = parts[parent].matrix_world.inverted()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        # The plain parts carry no custom normals the exporter would split on, beyond their sharp edges.
        obj.select_set(True)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_image_format='WEBP', export_image_quality=90, export_tangents=True,
                              export_draco_mesh_compression_enable=False, export_cameras=False, export_lights=False,
                              export_extras=False, export_animations=False)
    ship(name, shipped or (size, size, size))
    _embed(path)
    print(f'exported {path} ({path.stat().st_size / 1024:.0f} KiB): ' +
          ', '.join(f'{o.name} {triangles(o)}' for o in parts.values()) + f'; {sum(triangles(o) for o in parts.values())} triangles')
    return path


def ship(name, sizes):
    """The maps that go out with `name`, made from its masters at `sizes` (colour, normal, ORM: each as large as it
    has to be at the distance the thing is seen from in the game). Colour and ORM are lossy WebP at 80. The normal map
    is lossless, rounded to six bits a channel first: lossy WebP halves and blurs the colour channels, which in a
    normal map are its slopes, and every highlight then shows the blocks."""
    (TEXTURES / 'ship').mkdir(parents=True, exist_ok=True)
    for kind, size in zip(('color', 'normal', 'orm'), sizes):
        image = bpy.data.images.load(str(TEXTURES / f'{name}_{kind}.webp'))
        image.colorspace_settings.name = 'Non-Color'
        if image.size[0] != size:
            image.scale(size, size)
        if kind == 'normal':
            pixels = np.empty(size * size * 4, np.float32)
            image.pixels.foreach_get(pixels)
            image.pixels.foreach_set(np.floor(pixels * 255 / 4) * 4 / 255)
        image.file_format = 'WEBP'
        image.save(filepath=str(TEXTURES / 'ship' / f'{name}_{kind}.webp'), quality=100 if kind == 'normal' else 80)
        bpy.data.images.remove(image)


def _embed(path):
    """Put the shipped maps (`ship`) into the GLB in place of the exporter's own encoding of them, the binary chunk
    laid out again around them."""
    data = path.read_bytes()
    size = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + size])
    binary = data[20 + size + 8:]
    swap = {image['bufferView']: (TEXTURES / 'ship' / f"{image['name']}.webp").read_bytes() for image in gltf.get('images', [])}
    out = bytearray()
    for n, view in enumerate(gltf['bufferViews']):
        chunk = swap.get(n, binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
        view['byteOffset'], view['byteLength'] = len(out), len(chunk)
        out += chunk + b'\0' * (-len(chunk) % 4)
    gltf['buffers'][0]['byteLength'] = len(out)
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    body = struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)


# --- looking at it ----------------------------------------------------------------------------------------------------

def look(path, setting, close, poses=None, samples=32):
    """Load the GLB back, say what is in it, and render a three-quarter view and a close one (and, with `poses`
    {object: [(axis, amount)]}, the moving parts moved: X/Y/Z turn by degrees, x/y/z move by metres, in Blender's
    axes) into the previews folder. `setting` is 'room' (a bare warm
    bulb) or 'yard' (moonlight and a torch); `close` is (x, y, z, distance) to look at closely."""
    reset()
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, world))
            hi = Vector(map(max, hi, world))
    print(f'{path.name}: {sum(triangles(o) for o in objects)} triangles, bounds {tuple(round(v, 3) for v in lo)} .. {tuple(round(v, 3) for v in hi)}, size {tuple(round(v, 3) for v in hi - lo)}')
    for obj in objects:
        images = {n.image.name: tuple(n.image.size) for m in obj.data.materials if m for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
        print(f'  {obj.name}: parent {obj.parent.name if obj.parent else "-"}, origin {tuple(round(v, 4) for v in obj.matrix_world.translation)}, '
              f'{triangles(obj)} triangles, maps {images}')

    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 720
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('dark')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    floor = bpy.data.meshes.new('floor')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20)
    bm.to_mesh(floor)
    ground = _link(bpy.data.objects.new('floor', floor))
    ground_material = bpy.data.materials.new('floor')
    ground_material.use_nodes = True
    ground_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.075, 0.06, 1) if setting == 'room' else (0.05, 0.06, 0.045, 1)
    ground_material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
    floor.materials.append(ground_material)

    middle = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)
    camera = _link(bpy.data.objects.new('camera', bpy.data.cameras.new('camera')))
    camera.data.lens = 40
    camera.data.clip_start = 0.005
    scene.camera = camera

    def aim(target, offset):
        camera.location = Vector(target) + Vector(offset)
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()

    def light(kind, at, energy, colour, size=0.05, target=None):
        lamp = bpy.data.lights.new(kind, kind)
        lamp.energy = energy
        lamp.color = colour
        if kind == 'SPOT':
            lamp.spot_size = math.radians(40)
            lamp.spot_blend = 0.6
        if kind != 'SUN':
            lamp.shadow_soft_size = size
        obj = _link(bpy.data.objects.new(kind, lamp))
        obj.location = at
        if target is not None:
            obj.rotation_euler = (Vector(target) - Vector(at)).to_track_quat('-Z', 'Y').to_euler()
        return obj

    view = Vector((-0.75, -1.0, 0.55)).normalized()
    if setting == 'room':
        light('POINT', middle + Vector((-1.2, -1.0, 1.8)) * max(1, radius), 100 * max(1, radius) ** 2, (1, 0.76, 0.46), 0.04)
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.04, 0.03, 1)
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    else:
        moon = light('SUN', (0, 0, 10), 0.25, (0.55, 0.65, 1.0))
        moon.rotation_euler = (math.radians(50), 0, math.radians(30))
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.025, 0.04, 1)
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
    torch = None
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    def shoot(file, target, distance):
        nonlocal torch
        aim(target, view * distance)
        if setting == 'yard':
            if torch:
                bpy.data.objects.remove(torch)
            torch = light('SPOT', camera.location + Vector((0.25, 0, -0.2)), 60 * distance ** 2, (1, 0.9, 0.75), 0.02, target)
        scene.render.filepath = str(PREVIEWS / file)
        bpy.ops.render.render(write_still=True)
        print('  preview', scene.render.filepath)

    stem = path.stem
    shoot(f'{stem}-34.png', middle, radius * 2.6)
    shoot(f'{stem}-close.png', close[:3], close[3])
    if poses:
        for name, moves in poses.items():
            obj = bpy.data.objects[name]
            obj.rotation_mode = 'XYZ'
            for axis, amount in moves:
                if axis in 'XYZ':
                    obj.rotation_euler['XYZ'.index(axis)] += math.radians(amount)
                else:
                    obj.location['xyz'.index(axis)] += amount
        shoot(f'{stem}-moved.png', middle, radius * 2.6)


def dry(name, build, close):
    """Build `name` fine and plain without baking: count the plain one's triangles and draw both, flat-shaded in
    their materials' rough colours, fast (Workbench), to <name>-dry-*.png: for the shapes, before a bake."""
    scene = reset()
    for fine in (True, False):
        for obj in list(scene.objects):
            bpy.data.objects.remove(obj)
        parts = build(fine)
        bpy.context.view_layer.update()
        print(f'{name} {"fine" if fine else "plain"}: ' + ', '.join(f'{k} {triangles(o)}' for k, o in parts.items()) +
              f'; {sum(triangles(o) for o in parts.values())} triangles')
        lo = Vector((1e9,) * 3)
        hi = Vector((-1e9,) * 3)
        for obj in parts.values():
            for corner in obj.bound_box:
                world = obj.matrix_world @ Vector(corner)
                lo, hi = Vector(map(min, lo, world)), Vector(map(max, hi, world))
        print(f'  bounds {tuple(round(v, 3) for v in lo)} .. {tuple(round(v, 3) for v in hi)}')
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_cavity = True
        scene.render.resolution_x, scene.render.resolution_y = 1100, 820
        for material in bpy.data.materials:
            if material.node_tree and 'Principled BSDF' in material.node_tree.nodes:
                socket = material.node_tree.nodes['Principled BSDF'].inputs['Base Color']
                material.diffuse_color = socket.default_value if not socket.links else (0.5, 0.45, 0.4, 1)
        camera = _link(bpy.data.objects.new('camera', bpy.data.cameras.new('camera')))
        camera.data.lens = 40
        camera.data.clip_start = 0.005
        scene.camera = camera
        middle, radius = (lo + hi) / 2, max((hi - lo).length / 2, 0.05)
        view = Vector((-0.75, -1.0, 0.55)).normalized()
        for tag, target, distance in (('34', middle, radius * 2.6), ('close', Vector(close[:3]), close[3])):
            camera.location = target + view * distance
            camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(PREVIEWS / f'{name}-dry-{"fine" if fine else "plain"}-{tag}.png')
            bpy.ops.render.render(write_still=True)
