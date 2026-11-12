"""Make what stands over the graves as game models, in Blender, with Cycles and Poly Haven's scans.

    blender -b --factory-startup --python-exit-code 1 -P tools/forge/models/graves.py -- [kind ...] [--quick]

Every kind of stone src/yard/stones.js places, and a kerbed grave, a ledger and the mound, is made here in two or
three shapes and written as one GLB per kind, assets/models/graves/<kind>.glb, its shapes the root objects
<kind>_a, <kind>_b, ... With no kinds named, all of them are made.

A shape is made twice. The detailed one is its clean solid (edges rounded, chips knocked out of the old ones)
remeshed at a few millimetres and weathered in numpy: the waviness a century of rain leaves on a soft stone, the
scan's own relief, sandstone's skin come away in flakes, the mason's incised border. The weather is written onto it
as colour too (lichen, grime run down from the top, soil splashed up from the ground), so its material puts
the lichen where the stone is rough. The game's one is the detailed one before its fine weathering, remeshed coarse
and decimated to a few hundred triangles. Cycles bakes the detailed one onto it: colour, tangent-space normals,
roughness, and ambient occlusion with the ground there, so a foot is dark. The shapes of a kind share one set of
pictures: base colour (sRGB), normal, and ORM (occlusion, roughness, metal in R, G, B).

Conventions: metres; Z up here, +Y up in the GLB; the inscribed face looks along -Y here (+Z in the GLB); the origin
is where the middle of the foot meets the ground, and BURY of it is below. A grave lies on the -Y side of its stone,
so a kind that lies over the grave (chest, ledger, mound) is centred on it with its head end at +Y, and the kerbed
grave's origin is its headstone's foot, the kerbs running 2 m along -Y. The flat face that carries the lettering is a
material of its own, `<kind>_face` (the same pictures as `<kind>`), so the game can lay the inscription on that
primitive alone; each shape carries `panel` ([height of the panel's middle above the ground, width], metres) and
`size` ([x, y, z] of what is above the ground) in its glTF extras.

--quick remeshes coarse and bakes small: for looking at shapes, not for shipping.
"""

import math
import os
import sys
import urllib.request
from pathlib import Path

import zlib

import bmesh
import bpy
import mathutils
import numpy as np

HERE = Path(__file__).resolve().parents[3]
OUT = HERE / 'assets' / 'models' / 'graves'
SURFACES = HERE / 'assets' / 'surfaces'
CACHE = Path.home() / '.cache' / 'cold-chain'
SCANS = CACHE / 'dl' / 'polyhaven'
WORK = CACHE / 'forge-work' / 'graves'

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in args
WANTED = [a for a in args if not a.startswith('--')]

BURY = 0.15             # how far below the ground a stone goes (stones.js sinks 0.3; its tilts lift a foot ~2 cm)
FINE = 0.004 if QUICK else 0.0025       # voxel of the detailed stone
COARSE = 0.008          # voxel the game's stone is decimated from
THREADS = 6             # other forges share the machine

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.render.threads_mode = 'FIXED'
scene.render.threads = THREADS


# --- noise ------------------------------------------------------------------------------------------------------------

def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761 & 0xFFFFFFFF)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def noise(p, seed=0):
    """Value noise in [0, 1] at points p (n, 3), its lattice a unit apart."""
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * (3 - 2 * f)
    out = np.zeros(len(p))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out += w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, octaves=4, seed=0):
    """Fractal noise, given back as how many standard deviations each point is from the mean."""
    total, amp = np.zeros(len(p)), 1.0
    for o in range(octaves):
        total += amp * noise(p * scale * 2 ** o + o * 31.7, seed * 7 + o)
        amp *= 0.5
    return (total - total.mean()) / (total.std() + 1e-9)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# --- the scans ----------------------------------------------------------------------------------------------------------
#
# Poly Haven (CC0), fetched at 2k into the cache once. The maps are read into numpy for the relief and loaded as
# pictures for the detailed stone's material, both laid on it the same way (triplanar, from object coordinates, so
# the colour of a flake and its hollow are in the same place).

MAPS = {'diff': 'Diffuse', 'disp': 'Displacement', 'rough': 'Rough'}


def fetch(url, to):
    """Poly Haven turns away urllib's own user agent."""
    request = urllib.request.Request(url, headers={'User-Agent': 'cold-chain-forge/1.0'})
    with urllib.request.urlopen(request) as response:
        to.write_bytes(response.read())


def scan(asset):
    """The diffuse, displacement and roughness pictures of a Poly Haven texture, as loaded images."""
    import json
    folder = SCANS / asset
    folder.mkdir(parents=True, exist_ok=True)
    listing = folder / 'files.json'
    if not listing.exists():
        fetch(f'https://api.polyhaven.com/files/{asset}', listing)
    files = json.load(open(listing))
    images = {}
    for key, name in MAPS.items():
        url = files[name]['2k']['png' if key == 'disp' else 'jpg']['url']
        local = folder / url.rsplit('/', 1)[1]
        if not local.exists():
            print('fetching', url)
            fetch(url, local)
        image = bpy.data.images.load(str(local), check_existing=True)
        image.colorspace_settings.name = 'sRGB' if key == 'diff' else 'Non-Color'
        images[key] = image
    return images


def surface(name):
    """One of the game's own 1k surfaces (assets/surfaces, also Poly Haven): albedo and roughness; its albedo's
    lightness stands in for the relief it has no map of."""
    images = {}
    for key, file in (('diff', 'albedo.jpg'), ('rough', 'rough.jpg')):
        image = bpy.data.images.load(str(SURFACES / name / file), check_existing=True)
        image.colorspace_settings.name = 'sRGB' if key == 'diff' else 'Non-Color'
        images[key] = image
    images['disp'] = images['diff']
    return images


_arrays = {}


def grey(image):
    """A picture's first channel as a numpy array, rows from the bottom."""
    if image.name not in _arrays:
        w, h = image.size
        px = np.empty(w * h * 4, np.float32)
        image.pixels.foreach_get(px)
        _arrays[image.name] = px.reshape(h, w, 4)[:, :, 0].astype(np.float64)
    return _arrays[image.name]


def sample(img, u, v):
    h, w = img.shape
    x, y = (u % 1.0) * w - 0.5, (v % 1.0) * h - 0.5
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    x0, y0, x1, y1 = x0 % w, y0 % h, (x0 + 1) % w, (y0 + 1) % h
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy)
            + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def triplanar(img, p, n, size):
    """A tiling picture laid on from all three sides, `size` metres to a repeat; the material's `tri` does the same."""
    w = np.abs(n) ** 4
    w /= w.sum(1, keepdims=True) + 1e-9
    return (sample(img, p[:, 1] / size, p[:, 2] / size) * w[:, 0] + sample(img, p[:, 0] / size, p[:, 2] / size) * w[:, 1]
            + sample(img, p[:, 0] / size, p[:, 1] / size) * w[:, 2])


# --- what the stones are cut from -----------------------------------------------------------------------------------
#
# `scan` the Poly Haven texture laid over it and `size` its metres to a repeat; `tint` multiplies its colour
# (the scans are lit photographs of rock, a churchyard's stone is greyer); `relief` how deep the scan's own relief
# goes, `wave` the long waviness of rain wear, `flakes` how deep sandstone's skin comes away; `rough` its roughness
# from the scan scaled into [a, b]. `granite` and `marble` are drawn in the material instead of from a scan.

STONES = {
    'sandstone': dict(scan='worn_rock_natural_01', size=1.6, tint=(0.62, 0.6, 0.56), sat=0.35, relief=0.0025,
                      wave=0.003, flakes=0.0035, fresh=(1.18, 1.06, 0.9), rough=(0.82, 0.96)),
    'gritstone': dict(scan='worn_rock_natural_01', size=1.4, tint=(0.5, 0.49, 0.46), sat=0.35, relief=0.003,
                      wave=0.005, flakes=0.002, fresh=(1.25, 1.12, 0.95), rough=(0.85, 0.97)),
    'limestone': dict(scan='concrete_floor_02', size=2.0, tint=(0.98, 0.95, 0.88), sat=0.5, relief=0.0012,
                      wave=0.003, flakes=0.0, fresh=(1.05, 1.03, 1.0), rough=(0.78, 0.93)),
    'granite': dict(granite=True, relief=0.0, wave=0.0, flakes=0.0, rough=(0.16, 0.2), rustic='tiger_rock'),
    'marble': dict(marble=True, relief=0.0004, wave=0.0008, flakes=0.0, rough=(0.35, 0.55)),
    'iron': dict(surface='iron', size=0.6, tint=(0.5, 0.4, 0.34), sat=1.0, relief=0.0008, wave=0.0006, flakes=0.0,
                 rough=(0.7, 0.95)),
    'oak': dict(surface='post', size=1.0, tint=(0.8, 0.78, 0.74), sat=0.7, relief=0.0015, wave=0.001, flakes=0.0,
                rough=(0.75, 0.95), checks=0.004),
    # What is not stone: a fresh heap of soil, turf gone over a settled one, and the chippings inside a kerb.
    'soil': dict(surface='soil', size=1.3, tint=(0.62, 0.55, 0.48), sat=0.6, relief=0.008, wave=0.0, flakes=0.0,
                 rough=(0.8, 0.97), lumps=(14, 0.007), clean=True),
    'turf': dict(surface='grass', size=1.6, tint=(0.62, 0.7, 0.5), sat=0.9, relief=0.005, wave=0.0, flakes=0.0,
                 rough=(0.75, 0.95), lumps=(6, 0.005), clean=True),
    'chippings': dict(surface='gravel', size=0.9, tint=(1.15, 1.15, 1.12), sat=0.4, relief=0.009, wave=0.0, flakes=0.0,
                      rough=(0.55, 0.85), lumps=(70, 0.003), clean=True),
}

# Ground: what a mound is made of and what is splashed onto a stone's foot.
SOIL = (0.075, 0.058, 0.043)
LICHEN_SCAN = 'lichen_rock'
MOSS_SCAN = 'mossy_rock'


# --- outlines -------------------------------------------------------------------------------------------------------
#
# The heads of the stones, as in src/yard/outlines.js: [x, z] counter-clockwise from the bottom right corner over the
# head to the bottom left, `w` wide and `h` from `foot` to the top.

def arc(cx, cz, r, a, b, steps):
    return [(cx + math.cos(a + (b - a) * i / steps) * r, cz + math.sin(a + (b - a) * i / steps) * r) for i in range(steps + 1)]


def segment(w, h, f, rise):
    r = (w * w / 4 + rise * rise) / (2 * rise)
    half = math.asin(w / 2 / r)
    return [(w / 2, f), *arc(0, h - r, r, math.pi / 2 - half, math.pi / 2 + half, 16), (-w / 2, f)]


OUTLINES = {
    'round': lambda w, h, f: [(w / 2, f), *arc(0, h - w / 2, w / 2, 0, math.pi, 24), (-w / 2, f)],
    'gothic': lambda w, h, f: [(w / 2, f), *arc(-w / 2, h - w * 0.87, w, 0, math.pi / 3, 12),
                               *arc(w / 2, h - w * 0.87, w, math.pi * 2 / 3, math.pi, 12)[1:], (-w / 2, f)],
    'shoulder': lambda w, h, f: [(w / 2, f), (w / 2, h - 0.16), *arc(0, h - 0.16 - w * 0.6, w * 0.72, 0.985, math.pi - 0.985, 16),
                                 (-w / 2, h - 0.16), (-w / 2, f)],
    # A flat arch over straight sides, rising 10 cm: the commonest Victorian head after the round one.
    'segment': lambda w, h, f: segment(w, h, f, 0.1),
    # A low gable between square shoulders.
    'peaked': lambda w, h, f: [(w / 2, f), (w / 2, h - 0.12), (w / 2 - 0.04, h - 0.12), (0, h), (-w / 2 + 0.04, h - 0.12),
                               (-w / 2, h - 0.12), (-w / 2, f)],
    'square': lambda w, h, f: [(w / 2, f), (w / 2, h - 0.02), (w / 2 - 0.02, h), (-w / 2 + 0.02, h), (-w / 2, h - 0.02), (-w / 2, f)],
    # Lawn stones: square with a whisper of an arch.
    'lawn': lambda w, h, f: [(w / 2, f), (w / 2, h - 0.03), *arc(0, h - 0.03 - 1.2, math.hypot(w / 2, 1.2), math.atan2(1.2, w / 2),
                                                               math.pi - math.atan2(1.2, w / 2), 10), (-w / 2, h - 0.03), (-w / 2, f)],
}


def outline(shape, w, h, foot=-BURY):
    points = []
    for p in OUTLINES[shape](w, h, foot):
        if not points or math.dist(p, points[-1]) > 1e-4:
            points.append(p)
    if math.dist(points[0], points[-1]) < 1e-4:
        points.pop()
    return points


# --- solids -----------------------------------------------------------------------------------------------------------

def prism(bm, points, y0, y1, offset=(0, 0, 0)):
    """A solid from an outline in the x-z plane, from y0 to y1, added to bm."""
    ox, oy, oz = offset
    front = [bm.verts.new((x + ox, y0 + oy, z + oz)) for x, z in points]
    back = [bm.verts.new((x + ox, y1 + oy, z + oz)) for x, z in points]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    n = len(points)
    faces += [bm.faces.new((front[i], back[i], back[(i + 1) % n], front[(i + 1) % n])) for i in range(n)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def box(bm, lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    prism(bm, [(x1, z0), (x1, z1), (x0, z1), (x0, z0)], y0, y1)


def ring(bm, centre, r_in, r_out, y0, y1, steps=28):
    """An annulus standing in the x-z plane, as wedges that overlap (the remesh makes one solid of them)."""
    cx, cz = centre
    for i in range(steps):
        a, b = 2 * math.pi * i / steps, 2 * math.pi * (i + 1.15) / steps
        prism(bm, [(cx + r_out * math.cos(a), cz + r_out * math.sin(a)), (cx + r_out * math.cos(b), cz + r_out * math.sin(b)),
                   (cx + r_in * math.cos(b), cz + r_in * math.sin(b)), (cx + r_in * math.cos(a), cz + r_in * math.sin(a))], y0, y1)


def new_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def apply(obj):
    """Bake an object's modifiers into its mesh."""
    graph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph))
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    bpy.data.meshes.remove(old)


def bevel(obj, width, segments=3, angle=35):
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width, m.segments, m.limit_method, m.angle_limit = width, segments, 'ANGLE', math.radians(angle)
    apply(obj)


def remesh(obj, voxel):
    m = obj.modifiers.new('remesh', 'REMESH')
    m.mode, m.voxel_size, m.adaptivity, m.use_smooth_shade = 'VOXEL', voxel, 0.0, True
    apply(obj)


def knock(obj, chips, rng):
    """Knock chips out of a solid: each (centre, radius) a lumpy stone of that size taken away."""
    if not chips:
        return
    bm = bmesh.new()
    for centre, r in chips:
        part = bmesh.new()
        bmesh.ops.create_icosphere(part, subdivisions=2, radius=1.0)
        squash = rng.uniform(0.55, 1.0, 3)
        for v in part.verts:
            k = r * (1 + 0.35 * (rng.random() - 0.5))
            v.co = (centre[0] + v.co.x * k * squash[0], centre[1] + v.co.y * k * squash[1], centre[2] + v.co.z * k * squash[2])
        mesh = bpy.data.meshes.new('chip')
        part.to_mesh(mesh)
        part.free()
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    cutter = new_object(obj.name + '_chips', bm)
    m = obj.modifiers.new('chips', 'BOOLEAN')
    m.operation, m.solver, m.object = 'DIFFERENCE', 'MANIFOLD', cutter
    apply(obj)
    bpy.data.objects.remove(cutter)


def edge_chips(bm, rng, count, size, top):
    """Where arrises and corners get knocked: points along the clean solid's sharp edges above the ground, the
    higher the likelier (the foot is in the grass, the head is what gets hit)."""
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 1.0]
    if not edges or not count:
        return []
    mids = np.array([((e.verts[0].co + e.verts[1].co) / 2).z for e in edges])
    weight = np.array([e.calc_length() for e in edges]) * np.clip(0.3 + mids / top, 0, None) * (mids > 0.04)
    chips = []
    for i in rng.choice(len(edges), size=count, p=weight / weight.sum()):
        a, b = edges[i].verts[0].co, edges[i].verts[1].co
        at = a.lerp(b, rng.random())
        if at.z > 0.04:
            chips.append((tuple(at), size * rng.uniform(0.45, 1.0)))
    return chips


# --- weathering -------------------------------------------------------------------------------------------------------

def points_of(obj):
    mesh = obj.data
    p = np.empty(len(mesh.vertices) * 3)
    n = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', p)
    mesh.vertex_normals.foreach_get('vector', n)
    return p.reshape(-1, 3), n.reshape(-1, 3)


def move(obj, p):
    obj.data.vertices.foreach_set('co', p.ravel())
    obj.data.update()


def distance_to_outline(x, z, points):
    """How far each (x, z) is from the outline's nearest edge, metres."""
    pts = np.array(points + [points[0]])
    best = np.full(len(x), np.inf)
    for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
        dx, dz = bx - ax, bz - az
        t = np.clip(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz + 1e-12), 0, 1)
        best = np.minimum(best, np.hypot(x - ax - t * dx, z - az - t * dz))
    return best


def wear(obj, stone, shape, seed):
    """The long waviness of rain wear, and for a rustic granite its split sides; before the game's stone is taken."""
    p, n = points_of(obj)
    d = np.zeros(len(p))
    if stone.get('wave'):
        d += np.clip(fbm(p, 2.5, 3, seed), -2, 2) * stone['wave'] * shape.get('age', 1.0)
    if stone.get('lumps'):
        scale, amp = stone['lumps']
        d += np.clip(fbm(p, scale, 3, seed + 5), -2.5, 2.5) * amp * (0.3 + 0.7 * np.clip(n[:, 2], 0, 1))
    if shape.get('rustic'):
        # Polished face, the rest split off with a pitching tool: big shallow conchoidal facets.
        side = 1 - smooth(0.6, 0.9, -n[:, 1])
        facets = fbm(p, 9, 2, seed + 3) * 0.6 + fbm(p, 28, 2, seed + 4) * 0.25
        d += side * (facets * 0.0045 - 0.004) * (p[:, 2] > -0.02)
    move(obj, p + n * d[:, None])


def weather(obj, stone, shape, seed, images):
    """The fine relief and the weather as colour: attribute `weather` (R yellow lichen, G grey lichen and moss,
    B grime, A fresh stone where a flake came away)."""
    p, n = points_of(obj)
    age = shape.get('age', 1.0)
    top = shape['h']
    z = p[:, 2]
    up = np.clip(n[:, 2], 0, 1)
    d = np.zeros(len(p))
    if stone.get('relief') and 'disp' in images:
        d += (triplanar(grey(images['disp']), p, n, stone['size'] if 'size' in stone else 1.0) - 0.5) * 2 * stone['relief']
    if shape.get('rustic'):
        side = 1 - smooth(0.6, 0.9, -n[:, 1])
        d += side * (triplanar(grey(images['rustic']), p, n, 1.2) - 0.5) * 0.004
    # Sandstone's skin comes away in sheets: sharp-edged shallow hollows, most at the top and the foot.
    fresh = np.zeros(len(p))
    if stone.get('flakes') and age > 0.5:
        exposure = 0.8 * smooth(top * 0.6, top, z) + 0.7 * smooth(0.35, 0.0, z) + 0.5 * up
        f = fbm(p, 5, 4, seed + 11) + exposure * age
        fresh = smooth(1.55, 1.7, f)
        d -= fresh * stone['flakes'] * (1 + 0.4 * fbm(p, 40, 2, seed + 12).clip(-1, 1))
    # Oak splits along its grain as it dries and wets: long thin checks.
    if stone.get('checks'):
        grain = np.abs(fbm(p * np.array([1, 1, 0.06]), 40, 2, seed + 14))
        d -= smooth(0.12, 0.0, grain) * stone['checks'] * (1 - np.abs(n[:, 2]))
    # The mason's incised line, a few centimetres in from the edge of the face.
    if shape.get('border'):
        inset, half, deep = shape['border'], 0.0045, 0.0035
        front = (n[:, 1] < -0.75) & (p[:, 1] < -shape['d'] / 2 + 0.015)
        dist = distance_to_outline(p[:, 0], z, shape['outline'])
        cut = np.clip(1 - np.abs(dist - inset) / half, 0, 1) * front * (z > 0.05)
        d -= cut * deep * (1 - 0.6 * age * smooth(1.0, 2.0, fbm(p, 8, 2, seed + 13)))
    move(obj, p + n * d[:, None])

    if stone.get('clean'):
        colour = np.zeros((len(p), 4), np.float32)
        obj.data.color_attributes.new('weather', 'FLOAT_COLOR', 'POINT').data.foreach_set('color', colour.ravel())
        return
    # The weather, as colour. Yellow lichen (Xanthoria) in small rosettes, most on the head and its top edge;
    # grey crust lichen in wider patches, more on what faces up and on the oldest stones; grime in runs from the top
    # and splashed up from the ground; below the ground, soil.
    rosettes = fbm(p, 24, 3, seed + 21) + 0.9 * up + 0.7 * z / top - 1.4 * (1 - age)
    lichen_y = smooth(2.2, 2.8, rosettes) * smooth(0.08, 0.3, z) * min(1.0, age)
    crust = fbm(p, 7, 4, seed + 22) + 1.1 * up + 0.5 * smooth(top * 0.75, top, z) + 0.5 * smooth(0.2, 0.0, z)
    lichen_g = smooth(0.45, 1.45, crust - 1.6 * (1 - age)) * smooth(-0.02, 0.06, z) * min(1.0, age)
    streak_field = fbm(p * np.array([1, 1, 0.12]), 20, 3, seed + 23)
    runs = smooth(0.3, 1.5, streak_field) * (0.25 + 0.75 * smooth(top * 0.3, top, z)) * (1 - up)
    splash = smooth(0.22, 0.0, z) * (0.55 + 0.45 * smooth(-1, 1, fbm(p, 14, 3, seed + 24)))
    grime = np.clip(runs * 0.85 * (0.25 + 0.75 * age) + splash + (z < 0) * 1.0, 0, 1)
    colour = np.stack([lichen_y, lichen_g * (1 - lichen_y), grime, fresh], 1).astype(np.float32)
    attr = obj.data.color_attributes.new('weather', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colour.ravel())


# --- the detailed stone's material ----------------------------------------------------------------------------------

class Nodes:
    """A small hand for building a node tree."""

    def __init__(self, tree):
        self.tree = tree
        self.coord = self.node('ShaderNodeTexCoord')

    def node(self, kind, **props):
        n = self.tree.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, out, socket):
        self.tree.links.new(out, socket)

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                self.link(x, n.inputs[i])
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=True)
        for socket, x in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(x, (int, float)):
                socket.default_value = x if socket.type == 'VALUE' else (x, x, x, 1.0)
            elif isinstance(x, tuple):
                socket.default_value = (*x, 1.0) if len(x) == 3 else x
            else:
                self.link(x, socket)
        return n.outputs[2]

    def tri(self, image, size):
        """`triplanar` above, in nodes: the picture seen along x (as y, z), y (x, z) and z (x, y), weighted by |n|^4."""
        xyz = self.node('ShaderNodeSeparateXYZ')
        self.link(self.coord.outputs['Object'], xyz.inputs[0])
        nrm = self.node('ShaderNodeSeparateXYZ')
        self.link(self.coord.outputs['Normal'], nrm.inputs[0])
        weights = [self.math('POWER', self.math('ABSOLUTE', nrm.outputs[i]), 4) for i in range(3)]
        total = self.math('ADD', self.math('ADD', weights[0], weights[1]), weights[2])
        colour = None
        for axis, (u, v) in enumerate(((1, 2), (0, 2), (0, 1))):
            uv = self.node('ShaderNodeCombineXYZ')
            self.link(self.math('DIVIDE', xyz.outputs[u], size), uv.inputs[0])
            self.link(self.math('DIVIDE', xyz.outputs[v], size), uv.inputs[1])
            tex = self.node('ShaderNodeTexImage', image=image, interpolation='Linear', extension='REPEAT')
            self.link(uv.outputs[0], tex.inputs[0])
            share = self.math('DIVIDE', weights[axis], total)
            scaled = self.node('ShaderNodeVectorMath', operation='SCALE')
            self.link(tex.outputs[0], scaled.inputs[0])
            self.link(share, scaled.inputs['Scale'])
            colour = scaled.outputs[0] if colour is None else self._add(colour, scaled.outputs[0])
        return colour

    def _add(self, a, b):
        n = self.node('ShaderNodeVectorMath', operation='ADD')
        self.link(a, n.inputs[0])
        self.link(b, n.inputs[1])
        return n.outputs[0]

    def grey(self, colour):
        n = self.node('ShaderNodeRGBToBW')
        self.link(colour, n.inputs[0])
        return n.outputs[0]

    def ramp(self, fac, stops, interpolation='LINEAR'):
        n = self.node('ShaderNodeValToRGB')
        n.color_ramp.interpolation = interpolation
        elements = n.color_ramp.elements
        while len(elements) > len(stops):
            elements.remove(elements[-1])
        while len(elements) < len(stops):
            elements.new(0.5)
        for e, (at, colour) in zip(elements, stops):
            e.position = at
            e.color = (*colour, 1.0) if len(colour) == 3 else colour
        self.link(fac, n.inputs[0])
        return n.outputs[0]

    def noise(self, scale, detail=4.0, roughness=0.55, vector=None, distortion=0.0):
        n = self.node('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = roughness
        n.inputs['Distortion'].default_value = distortion
        self.link(vector or self.coord.outputs['Object'], n.inputs['Vector'])
        return n


def stone_material(name, stone, images, lichens):
    """The detailed stone's look: its stone, then fresh stone where it flaked, grime, grey lichen and moss, yellow
    lichen, and dirt in its hollows. Roughness follows the same layers."""
    mat = bpy.data.materials.new(name)
    tree = mat.node_tree
    tree.nodes.clear()
    nd = Nodes(tree)
    out = nd.node('ShaderNodeOutputMaterial')
    bsdf = nd.node('ShaderNodeBsdfPrincipled')
    nd.link(bsdf.outputs[0], out.inputs[0])
    weather = nd.node('ShaderNodeAttribute', attribute_name='weather')
    w = nd.node('ShaderNodeSeparateColor')
    nd.link(weather.outputs['Color'], w.inputs[0])
    lichen_y, lichen_g, grime = w.outputs[0], w.outputs[1], w.outputs[2]
    fresh = weather.outputs['Alpha']
    lo, hi = stone['rough']

    if stone.get('granite'):
        # Grey granite: black mica and hornblende, grey quartz, white and pinkish feldspar, a few millimetres each.
        grains = nd.node('ShaderNodeTexVoronoi')
        grains.inputs['Scale'].default_value = 520
        grains.inputs['Randomness'].default_value = 1.0
        nd.link(nd.coord.outputs['Object'], grains.inputs['Vector'])
        hue = nd.node('ShaderNodeSeparateColor')
        nd.link(grains.outputs['Color'], hue.inputs[0])
        speckle = nd.ramp(hue.outputs[0], [(0.0, stone['dark']), (0.58, stone['mid']), (0.9, stone['light'])], 'CONSTANT')
        mottle = nd.noise(14, 3).outputs[0]
        base = nd.mix(nd.math('MULTIPLY', mottle, 0.5), speckle, stone['dark'])
        rough_base = nd.math('ADD', nd.math('MULTIPLY', nd.noise(40, 2).outputs[0], hi - lo), lo)
        if images.get('rustic'):
            # The split sides are matt and lighter, their crystals broken open.
            nrm = nd.node('ShaderNodeSeparateXYZ')
            nd.link(nd.coord.outputs['Normal'], nrm.inputs[0])
            side = nd.math('LESS_THAN', nd.math('MULTIPLY', nrm.outputs[1], -1.0), 0.75)
            base = nd.mix(nd.math('MULTIPLY', side, 0.55), base, (0.42, 0.42, 0.42), 'SCREEN')
            rough_base = nd.mix(side, rough_base, 0.72)
            rough_base = nd.grey(rough_base)
    elif stone.get('marble'):
        # White marble: soft grey veins in a warm white, gone sugary and grey where the rain sits.
        wave = nd.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', wave_profile='SIN')
        wave.inputs['Scale'].default_value = 2.2
        wave.inputs['Distortion'].default_value = 9.0
        wave.inputs['Detail'].default_value = 6.0
        wave.inputs['Detail Scale'].default_value = 1.6
        nd.link(nd.coord.outputs['Object'], wave.inputs['Vector'])
        veins = nd.ramp(wave.outputs[1], [(0.0, (0.66, 0.66, 0.66)), (0.05, (0.76, 0.76, 0.75)), (0.25, (0.84, 0.83, 0.8)),
                                         (1.0, (0.86, 0.85, 0.82))])
        cloud = nd.noise(6, 5, 0.6).outputs[0]
        base = nd.mix(nd.math('MULTIPLY', cloud, 0.25), veins, (0.7, 0.69, 0.66))
        rough_base = nd.math('ADD', nd.math('MULTIPLY', nd.noise(25, 3).outputs[0], hi - lo), lo)
    else:
        diff = nd.tri(images['diff'], stone['size'])
        sat = nd.node('ShaderNodeHueSaturation')
        sat.inputs['Saturation'].default_value = stone['sat']
        nd.link(diff, sat.inputs['Color'])
        base = nd.mix(1.0, sat.outputs[0], stone['tint'], 'MULTIPLY')
        # Beds in the stone and the years: broad patches a little lighter or darker.
        base = nd.mix(1.0, base, nd.ramp(nd.noise(1.8, 3).outputs[0], [(0.3, (0.8, 0.8, 0.8)), (0.7, (1.08, 1.07, 1.05))]), 'MULTIPLY')
        rough_scan = nd.grey(nd.tri(images['rough'], stone['size']))
        rough_base = nd.math('ADD', nd.math('MULTIPLY', rough_scan, hi - lo), lo)
        # Where a flake came away the stone under it is clean and warmer.
        base = nd.mix(fresh, base, nd.mix(1.0, base, stone.get('fresh', (1, 1, 1)), 'MULTIPLY'))

    # Grime: soot and algae run down from the top, the soil splashed up at the foot.
    grime_tone = nd.mix(nd.noise(9, 3).outputs[0], (0.04, 0.04, 0.037), SOIL)
    # Green algae where it stays wet, at the foot.
    wet = nd.node('ShaderNodeSeparateXYZ')
    nd.link(nd.coord.outputs['Object'], wet.inputs[0])
    low_down = nd.math('MULTIPLY', nd.math('LESS_THAN', wet.outputs[2], 0.3), nd.noise(5, 3).outputs[0])
    grime_tone = nd.mix(low_down, grime_tone, (0.06, 0.075, 0.03))
    base = nd.mix(nd.math('MULTIPLY', grime, 0.7), base, grime_tone)
    # Grey crust lichen, pale and a little green, its grain from the lichen scan, soft at its edges; a little moss in it.
    grain = nd.grey(nd.tri(lichens['crust'], 0.9))
    crust_tone = nd.ramp(grain, [(0.0, (0.34, 0.36, 0.31)), (0.4, (0.52, 0.55, 0.48)), (1.0, (0.66, 0.68, 0.62))])
    moss = nd.mix(1.0, nd.tri(lichens['moss'], 1.2), (0.6, 0.65, 0.5), 'MULTIPLY')
    green = nd.mix(nd.math('GREATER_THAN', nd.noise(4, 2).outputs[0], 0.62), crust_tone, moss)
    cover = nd.math('MULTIPLY', lichen_g, nd.math('ADD', 0.3, nd.math('MULTIPLY', grain, 0.6)), clamp=True)
    base = nd.mix(cover, base, green)
    # Yellow-orange crust lichen in small rosettes.
    tone = nd.ramp(nd.noise(40, 3).outputs[0], [(0.3, (0.32, 0.26, 0.11)), (0.7, (0.42, 0.34, 0.13))])
    lumpy = nd.math('MULTIPLY', lichen_y, nd.math('ADD', 0.3, nd.noise(120, 2).outputs[0]), clamp=True)
    base = nd.mix(lumpy, base, tone)
    # Dirt settles in every hollow.
    ao = nd.node('ShaderNodeAmbientOcclusion', samples=12, only_local=True)
    ao.inputs['Distance'].default_value = 0.012
    cavity = nd.math('POWER', ao.outputs['AO'], 1.6)
    base = nd.mix(nd.math('SUBTRACT', 1.0, cavity), base, nd.mix(1.0, base, (0.35, 0.33, 0.3), 'MULTIPLY'))
    nd.link(base, bsdf.inputs['Base Color'])

    rough = nd.math('MAXIMUM', rough_base, nd.math('MULTIPLY', nd.math('ADD', lichen_g, lichen_y), 0.95))
    rough = nd.math('MAXIMUM', rough, nd.math('MULTIPLY', grime, 0.85))
    nd.link(rough, bsdf.inputs['Roughness'])
    # The scan's grain finer than the remesh holds, as bump.
    if images.get('disp') and not stone.get('granite') and not stone.get('marble'):
        bump = nd.node('ShaderNodeBump')
        bump.inputs['Distance'].default_value = 0.0012
        bump.inputs['Strength'].default_value = 0.6
        nd.link(nd.grey(nd.tri(images['disp'], stone['size'])), bump.inputs['Height'])
        nd.link(bump.outputs[0], bsdf.inputs['Normal'])
    return mat


# --- the shapes -----------------------------------------------------------------------------------------------------
#
# Each kind: `stone`, what it is cut from (STONES), `size` of its pictures, `tris` the game mesh's budget per shape,
# and its shapes. A shape is built by `build(bm, shape, rng)` and has `age` (1 a Victorian stone, 0.3 one from the
# fifties), `chips` how many and how big, `border` an incised line so far in, `panel` where the lettering goes.

def upright(shape_name, w, h, d):
    def build(bm, shape, rng):
        shape['outline'] = outline(shape_name, w, h)
        prism(bm, shape['outline'], -d / 2, d / 2)
    return dict(build=build, w=w, h=h, d=d)


def on_base(inner, base_w, base_d, base_h):
    """An upright set into a plinth that sits on the ground."""
    def build(bm, shape, rng):
        inner['build'](bm, shape, rng)
        box(bm, (-base_w / 2, -base_d / 2, -BURY), (base_w / 2, base_d / 2, base_h))
    return dict(inner, build=build, w=base_w, face=('front', -inner['d'] / 2, base_h + 0.02), size_d=base_d)


def cross_latin(bm, shape, rng):
    box(bm, (-0.36, -0.24, -BURY), (0.36, 0.24, 0.2))
    box(bm, (-0.26, -0.17, 0.2), (0.26, 0.17, 0.42))
    box(bm, (-0.085, -0.07, 0.4), (0.085, 0.07, 1.75))
    box(bm, (-0.36, -0.07, 1.22), (0.36, 0.07, 1.39))


def cross_wheel(bm, shape, rng):
    box(bm, (-0.34, -0.23, -BURY), (0.34, 0.23, 0.18))
    box(bm, (-0.24, -0.16, 0.18), (0.24, 0.16, 0.4))
    prism(bm, [(0.1, 0.38), (0.08, 1.7), (-0.08, 1.7), (-0.1, 0.38)], -0.065, 0.065)
    box(bm, (-0.33, -0.065, 1.24), (0.33, 0.065, 1.4))
    ring(bm, (0, 1.32), 0.17, 0.235, -0.05, 0.05)


def chest(slipped):
    def build(bm, shape, rng):
        # Plinth, the chest with a sunk panel in each side, and the lid over it. Long axis along y.
        box(bm, (-0.46, -1.0, -0.12), (0.46, 1.0, 0.07))
        box(bm, (-0.4, -0.92, 0.0), (0.4, 0.92, 0.6))
        box(bm, (-0.43, -0.95, 0.56), (0.43, 0.95, 0.62))
        lid_turn = math.radians(2.2 if slipped else 0)
        lid = bmesh.new()
        box(lid, (-0.47, -1.01, 0.62), (0.47, 1.01, 0.73))
        box(lid, (-0.44, -0.98, 0.72), (0.44, 0.98, 0.76))
        bmesh.ops.rotate(lid, verts=lid.verts, cent=(0, 0, 0.7), matrix=mathutils.Matrix.Rotation(lid_turn, 3, 'Z'))
        if slipped:
            bmesh.ops.translate(lid, verts=lid.verts, vec=(0.03, 0.05, 0))
        mesh = bpy.data.meshes.new('lid')
        lid.to_mesh(mesh)
        lid.free()
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    return build


def chest_panels(obj, shape):
    """Sink a panel into each side and end of the chest."""
    bm = bmesh.new()
    for x in (-0.4, 0.4):
        for y0, y1 in ((-0.8, -0.06), (0.06, 0.8)):
            box(bm, (x - 0.015, y0, 0.12), (x + 0.015, y1, 0.48))
    for y in (-0.92, 0.92):
        box(bm, (-0.28, y - 0.015, 0.12), (0.28, y + 0.015, 0.48))
    cutter = new_object('panels', bm)
    m = obj.modifiers.new('panels', 'BOOLEAN')
    m.operation, m.solver, m.object = 'DIFFERENCE', 'MANIFOLD', cutter
    apply(obj)
    bpy.data.objects.remove(cutter)


def heap(length, width, height, power):
    """A grave's mound: an ellipse of earth in plan, a flattened dome in section, its skirt going into the ground;
    closed underneath. Long axis along y."""
    def build(bm, shape, rng):
        nx, ny = 26, 52
        grid = {}
        for i in range(nx + 1):
            for j in range(ny + 1):
                u, v = i / nx * 2 - 1, j / ny * 2 - 1
                r = math.hypot(u, v)
                z = height * max(0.0, 1 - r ** 2) ** power - 0.04 * min(1.0, max(0.0, r - 0.95) / 0.3)
                grid[i, j] = bm.verts.new((u * width / 2 * 1.25, v * length / 2 * 1.25, z))
        for i in range(nx):
            for j in range(ny):
                bm.faces.new((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
        edge = [e for e in bm.edges if e.is_boundary]
        new = bmesh.ops.extrude_edge_only(bm, edges=edge)['geom']
        for v in (g for g in new if isinstance(g, bmesh.types.BMVert)):
            v.co.z = -BURY
        bmesh.ops.contextual_create(bm, geom=[g for g in new if isinstance(g, bmesh.types.BMEdge)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return dict(build=build, w=width, h=height, d=length)


def marker(bm, shape, rng):
    # A cast-iron stake with a plate on its front for the row and the number.
    box(bm, (-0.012, -0.012, -BURY), (0.012, 0.012, 0.42))
    box(bm, (-0.075, -0.021, 0.29), (0.075, -0.011, 0.42))
    box(bm, (-0.06, 0.008, 0.36), (0.06, 0.016, 0.385))        # the lug it is cast with, behind


def post(top):
    def build(bm, shape, rng):
        prism(bm, [(0.05, -BURY), *top, (-0.05, -BURY)], -0.05, 0.05)
    return build


def ledger(bm, shape, rng):
    # A slab lying on the grave, on a low course of stone. Long axis along y, its head at +y.
    box(bm, (-0.45, -1.0, -0.1), (0.45, 1.0, 0.04))
    box(bm, (-0.42, -0.97, 0.0), (0.42, 0.97, 0.13))


def kerbed(bm, shape, rng):
    # A headstone on its base, and kerbs round the grave in front of it (-y), all granite.
    prism(bm, outline('lawn', 0.6, 0.8), -0.04, 0.04)
    box(bm, (-0.42, -0.13, -BURY), (0.42, 0.11, 0.1))
    box(bm, (0.34, -2.05, -0.1), (0.42, -0.12, 0.13))
    box(bm, (-0.42, -2.05, -0.1), (-0.34, -0.12, 0.13))
    box(bm, (-0.42, -2.05, -0.1), (0.42, -1.97, 0.13))


def chippings(bm, shape, rng):
    box(bm, (-0.345, -1.975, -0.1), (0.345, -0.125, 0.065))


KINDS = {
    'tallRound': dict(stone='sandstone', size=1024, tris=1400, shapes=[
        dict(upright('round', 0.62, 1.35, 0.11), age=1.0, chips=(7, 0.035), border=0.035, panel=(0.74, 0.5)),
        dict(upright('segment', 0.66, 1.28, 0.12), age=1.1, chips=(10, 0.045), panel=(0.7, 0.52)),
        dict(upright('round', 0.58, 1.45, 0.1), age=0.9, chips=(5, 0.03), border=0.03, panel=(0.8, 0.46)),
    ]),
    'tallGothic': dict(stone='limestone', size=1024, tris=1400, shapes=[
        dict(upright('gothic', 0.66, 1.55, 0.12), age=1.0, chips=(6, 0.035), border=0.04, panel=(0.8, 0.52)),
        dict(upright('gothic', 0.6, 1.42, 0.11), age=1.0, chips=(9, 0.04), panel=(0.74, 0.48)),
    ]),
    'tallShoulder': dict(stone='gritstone', size=1024, tris=1400, shapes=[
        dict(upright('shoulder', 0.7, 1.25, 0.12), age=1.25, chips=(9, 0.04), border=0.035, panel=(0.66, 0.56)),
        dict(upright('peaked', 0.72, 1.2, 0.12), age=1.2, chips=(8, 0.04), panel=(0.62, 0.56)),
    ]),
    'greyRound': dict(stone='limestone', size=1024, tris=1100, shapes=[
        dict(upright('round', 0.58, 1.05, 0.1), age=0.85, chips=(4, 0.03), border=0.03, panel=(0.52, 0.46)),
        dict(upright('segment', 0.6, 1.0, 0.1), age=0.9, chips=(6, 0.03), panel=(0.5, 0.48)),
    ]),
    'cross': dict(stone='limestone', size=1024, tris=1800, shapes=[
        dict(build=cross_latin, w=0.72, h=1.75, d=0.48, age=1.0, chips=(8, 0.03)),
        dict(build=cross_wheel, w=0.68, h=1.7, d=0.46, age=1.0, chips=(8, 0.03)),
    ]),
    'chest': dict(stone='sandstone', size=1024, tris=2400, fine=0.0035, shapes=[
        dict(build=chest(False), w=0.94, h=0.76, d=2.02, age=1.0, chips=(10, 0.05), panels=True),
        dict(build=chest(True), w=0.94, h=0.76, d=2.02, age=1.2, chips=(16, 0.06), panels=True),
    ]),
    'midRound': dict(stone='granite', size=1024, tris=1000, shapes=[
        dict(upright('round', 0.56, 0.86, 0.09), age=0.3, chips=(0, 0), panel=(0.4, 0.46)),
        dict(upright('round', 0.6, 0.82, 0.1), age=0.35, chips=(0, 0), rustic=True, panel=(0.38, 0.44)),
    ]),
    'midShoulder': dict(stone='marble', size=1024, tris=1000, shapes=[
        dict(upright('shoulder', 0.6, 0.8, 0.09), age=0.4, chips=(2, 0.02), panel=(0.38, 0.5)),
        dict(upright('peaked', 0.58, 0.84, 0.09), age=0.45, chips=(3, 0.02), panel=(0.38, 0.48)),
    ]),
    'midSquare': dict(stone='sandstone', size=1024, tris=900, shapes=[
        dict(upright('square', 0.6, 0.72, 0.1), age=0.45, chips=(3, 0.025), panel=(0.38, 0.5)),
        dict(on_base(upright('square', 0.56, 0.74, 0.09), 0.72, 0.24, 0.1), age=0.5, chips=(3, 0.025), panel=(0.42, 0.46)),
    ]),
    'lawnSquare': dict(stone='granite', size=512, tris=700, shapes=[
        dict(upright('square', 0.46, 0.46, 0.09), age=0.15, chips=(0, 0), panel=(0.25, 0.4)),
        dict(upright('lawn', 0.5, 0.5, 0.09), age=0.15, chips=(0, 0), rustic=True, panel=(0.26, 0.4)),
    ]),
    'ledger': dict(stone='sandstone', size=1024, tris=1200, shapes=[
        dict(build=ledger, w=0.9, h=0.13, d=2.0, age=1.0, chips=(12, 0.04), face=('top', 0.1), panel=(0.3, 0.6)),
        dict(build=ledger, w=0.9, h=0.13, d=2.0, age=1.2, chips=(22, 0.05), face=('top', 0.1), panel=(0.3, 0.6), stone='limestone'),
    ]),
    'kerb': dict(stone='granite', size=1024, tris=1600, shapes=[
        dict(build=kerbed, w=0.84, h=0.8, d=2.16, age=0.4, chips=(3, 0.02), face=('front', -0.04, 0.12),
             panel=(0.5, 0.44), parts=[dict(stone='chippings', build=chippings, tris=160)]),
    ]),
    'mound': dict(stone='soil', size=1024, tris=1600, coarse=0.015, cage=(0.04, 0.1), from_above=True, shapes=[
        dict(heap(2.1, 1.0, 0.24, 0.55), age=0.0),
        dict(heap(2.0, 0.95, 0.11, 0.8), age=0.0, stone='turf'),
    ]),
    'marker': dict(stone='iron', size=256, tris=220, fine=0.0012, coarse=0.003, shapes=[
        dict(build=marker, w=0.15, h=0.42, d=0.04, age=0.5, chips=(0, 0), face=('front', -0.021, 0.28), panel=(0.36, 0.13)),
    ]),
    'post': dict(stone='oak', size=512, tris=300, fine=0.002, coarse=0.005, shapes=[
        dict(build=post([(0.05, 0.52), (0, 0.56), (-0.05, 0.52)]), w=0.1, h=0.56, d=0.1, age=0.6, chips=(4, 0.02)),
        dict(build=post([(0.05, 0.5), (-0.05, 0.55)]), w=0.1, h=0.55, d=0.1, age=0.8, chips=(5, 0.025)),
    ]),
    'lawnMarble': dict(stone='marble', size=512, tris=700, shapes=[
        dict(upright('lawn', 0.42, 0.4, 0.08), age=0.2, chips=(0, 0), panel=(0.21, 0.37)),
        dict(upright('segment', 0.44, 0.42, 0.08), age=0.25, chips=(1, 0.015), panel=(0.22, 0.38)),
    ]),
}

ORDER = list(KINDS)


# --- one kind -------------------------------------------------------------------------------------------------------

def make_shape(name, kind, shape, stone, images, seed):
    """The detailed and the game's version of one shape (or of one part of it), weathered."""
    rng = np.random.default_rng(seed)
    fine = FINE if QUICK else kind.get('fine', FINE)
    bm = bmesh.new()
    shape['build'](bm, shape, rng)
    count, size = shape.get('chips', (0, 0))
    chips = edge_chips(bm, rng, count, size, shape.get('h', 1.0))
    solid = new_object(name + '_high', bm)
    remesh(solid, fine)            # one solid of overlapping parts
    if shape.get('panels'):
        chest_panels(solid, shape)
    knock(solid, chips, rng)
    remesh(solid, fine)
    smooth_edges(solid, shape)
    wear(solid, stone, shape, seed)

    low = solid.copy()
    low.data = solid.data.copy()
    low.name = name
    scene.collection.objects.link(low)
    remesh(low, kind.get('coarse', COARSE))
    m = low.modifiers.new('decimate', 'DECIMATE')
    m.decimate_type, m.use_collapse_triangulate = 'COLLAPSE', True
    m.ratio = min(1.0, shape.get('tris', kind['tris']) / max(1, len(low.data.polygons) * 2))
    apply(low)
    cut_below(low, -BURY + 0.004)
    weather(solid, stone, shape, seed, images)
    return solid, low


def stone_of(name):
    """A stone's recipe and its pictures."""
    stone = dict(STONES[name])
    images = scan(stone['scan']) if 'scan' in stone else surface(stone['surface']) if 'surface' in stone else {}
    if stone.get('rustic'):
        images['rustic'] = scan(stone['rustic'])['disp']
    if stone.get('granite'):
        stone.update(dark=(0.02, 0.02, 0.022), mid=(0.045, 0.045, 0.048), light=(0.11, 0.107, 0.104))
    return stone, images


def merge(low, part):
    """Fold a part's game mesh into the shape's."""
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bm.from_mesh(part.data)
    bm.to_mesh(low.data)
    bm.free()
    discard(part)


def discard(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


def smooth_edges(obj, shape):
    """Round every arris, by a corrective smooth that only rounds where the surface bends."""
    m = obj.modifiers.new('round', 'CORRECTIVE_SMOOTH')
    m.factor, m.iterations, m.smooth_type, m.use_only_smooth = 0.5, int(6 + 10 * shape.get('age', 1.0)), 'SIMPLE', True
    m.rest_source = 'ORCO'
    apply(obj)


def cut_below(obj, z):
    """Drop the underside: nothing ever sees it."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    gone = [f for f in bm.faces if f.calc_center_median().z < z and f.normal.z < -0.5]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


def unwrap(lows, from_above=False):
    """One UV layout for all the shapes of a kind. A heap is laid out as seen from above, each its strip of the
    picture; anything else is cut into islands by Smart UV Project and packed."""
    bpy.ops.object.select_all(action='DESELECT')
    for low in lows:
        low.select_set(True)
        low.data.uv_layers.new(name='UVMap')
    if from_above:
        for i, low in enumerate(lows):
            co = np.array([v.co[:2] for v in low.data.vertices])
            lo, span = co.min(0), np.ptp(co, 0)
            uv = (co - lo) / span * 0.97 + 0.015
            uv[:, 0] = (uv[:, 0] + i) / len(lows)
            loops = np.array([loop.vertex_index for loop in low.data.loops])
            low.data.uv_layers['UVMap'].data.foreach_set('uv', uv[loops].ravel())
    else:
        bpy.context.view_layer.objects.active = lows[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.004, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
        bpy.ops.object.mode_set(mode='OBJECT')
    for low in lows:
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(60))


def ground_plane():
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    plane = new_object('ground', bm)
    mat = bpy.data.materials.new('ground')
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*SOIL, 1)
    plane.data.materials.append(mat)
    return plane


def bake_kind(name, kind, pairs, size):
    """Bake the detailed shapes onto the game's, all into one set of pictures. The shapes are set apart in x for it
    so none shades another, and baked as one joined copy, so the margins are Blender's own."""
    for i, (highs, low) in enumerate(pairs):
        for obj in highs + [low]:
            obj.location.x = i * 4.0
    bpy.ops.object.select_all(action='DESELECT')
    copies = []
    for _, low in pairs:
        c = low.copy()
        c.data = low.data.copy()
        scene.collection.objects.link(c)
        copies.append(c)
    bpy.context.view_layer.objects.active = copies[0]
    for c in copies:
        c.select_set(True)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    target = bpy.data.materials.new(name + '_bake')
    node = target.node_tree.nodes.new('ShaderNodeTexImage')
    target.node_tree.nodes.active = node
    joined.data.materials.clear()
    joined.data.materials.append(target)
    for poly in joined.data.polygons:
        poly.material_index = 0

    world = bpy.data.worlds.new('bake')
    world.color = (1, 1, 1)
    scene.world = world
    world.light_settings.distance = 0.5

    pictures = {}
    passes = [('base', 'DIFFUSE', {'COLOR'}, 'sRGB', 1), ('rough', 'ROUGHNESS', set(), 'Non-Color', 1),
              ('normal', 'NORMAL', set(), 'Non-Color', 4), ('ao', 'AO', set(), 'Non-Color', 16 if QUICK else 64)]
    for key, kind_of, filt, space, samples in passes:
        image = bpy.data.images.new(f'{name}_{key}_bake', size, size, alpha=False, float_buffer=key == 'normal')
        image.colorspace_settings.name = space
        node.image = image
        scene.cycles.samples = samples
        bpy.ops.object.select_all(action='DESELECT')
        for highs, _ in pairs:
            for high in highs:
                high.select_set(True)
        joined.select_set(True)
        bpy.context.view_layer.objects.active = joined
        extrusion, reach = kind.get('cage', (0.02, 0.05))
        bpy.ops.object.bake(type=kind_of, pass_filter=filt, use_selected_to_active=True, cage_extrusion=extrusion,
                            max_ray_distance=reach, margin=8, use_clear=True, normal_space='TANGENT')
        pictures[key] = image
        print('baked', name, key)
    bpy.data.objects.remove(joined)
    for highs, low in pairs:
        for obj in highs + [low]:
            obj.location.x = 0.0
    return pictures


def save_pictures(name, pictures, size, metal=0.0):
    """Base colour and normal as they are; occlusion, roughness and metal packed into one."""
    WORK.mkdir(parents=True, exist_ok=True)
    px = lambda image: np.array(image.pixels[:], np.float32).reshape(size, size, 4)
    orm = np.ones((size, size, 4), np.float32)
    orm[:, :, 0] = px(pictures['ao'])[:, :, 0]
    orm[:, :, 1] = px(pictures['rough'])[:, :, 0]
    orm[:, :, 2] = metal
    packed = bpy.data.images.new(f'{name}_orm', size, size, alpha=False)
    packed.colorspace_settings.name = 'Non-Color'
    packed.pixels.foreach_set(orm.ravel())
    out = {}
    for key, image in (('base', pictures['base']), ('normal', pictures['normal']), ('orm', packed)):
        if key == 'normal':
            # Eight bits, as it ships.
            eight = bpy.data.images.new(f'{name}_normal8', size, size, alpha=False)
            eight.colorspace_settings.name = 'Non-Color'
            eight.pixels.foreach_set(px(image).ravel())
            image = eight
        image.filepath_raw = str(WORK / f'{name}_{key}.png')
        image.file_format = 'PNG'
        image.save()
        image.name = f'{name}_{key}'
        if key == 'normal':
            bpy.data.images.remove(pictures['normal'])
        out[key] = image
    return out


def game_material(name, pictures):
    """The material the GLB carries: base colour, normal, ORM (occlusion through the glTF output group)."""
    mat = bpy.data.materials.new(name)
    tree = mat.node_tree
    tree.nodes.clear()
    nd = Nodes(tree)
    out = nd.node('ShaderNodeOutputMaterial')
    bsdf = nd.node('ShaderNodeBsdfPrincipled')
    nd.link(bsdf.outputs[0], out.inputs[0])
    uv = nd.node('ShaderNodeUVMap', uv_map='UVMap')
    texs = {}
    for key, image in pictures.items():
        t = nd.node('ShaderNodeTexImage', image=image)
        nd.link(uv.outputs[0], t.inputs[0])
        texs[key] = t
    nd.link(texs['base'].outputs[0], bsdf.inputs['Base Color'])
    nmap = nd.node('ShaderNodeNormalMap', uv_map='UVMap')
    nd.link(texs['normal'].outputs[0], nmap.inputs['Color'])
    nd.link(nmap.outputs[0], bsdf.inputs['Normal'])
    sep = nd.node('ShaderNodeSeparateColor')
    nd.link(texs['orm'].outputs[0], sep.inputs[0])
    nd.link(sep.outputs[1], bsdf.inputs['Roughness'])
    nd.link(sep.outputs[2], bsdf.inputs['Metallic'])
    group = gltf_output_group()
    g = nd.node('ShaderNodeGroup')
    g.node_tree = group
    nd.link(sep.outputs[0], g.inputs['Occlusion'])
    return mat


def gltf_output_group():
    """The node group the glTF exporter reads occlusion from (it goes by the group's name)."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group:
        return group
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    group.nodes.new('NodeGroupInput')
    return group


def mark_face(low, shape):
    """The flat face the lettering goes on: material slot 1, `<kind>_face`. `face` is ('front', its y, lowest z) for
    a face looking along -y, ('top', lowest z) for one looking up; an upright's is its front above the ground."""
    face = shape.get('face') or ('front', -shape['d'] / 2, 0.03)
    for poly in low.data.polygons:
        n, c = poly.normal, poly.center
        if face[0] == 'top':
            on = n.z > 0.93 and c.z > face[1]
        else:
            on = n.y < -0.93 and c.z > face[2] and abs(c.y - face[1]) < 0.03
        poly.material_index = 1 if shape.get('panel') and on else 0


def make_kind(name):
    kind = KINDS[name]
    lichens = {'crust': scan(LICHEN_SCAN)['diff'], 'moss': scan(MOSS_SCAN)['diff']}
    pairs = []
    for i, shape in enumerate(kind['shapes']):
        letter = 'abcdefgh'[i]
        highs, low = [], None
        for j, part in enumerate([shape] + shape.get('parts', [])):
            stone, images = stone_of(part.get('stone', kind['stone']))
            if not shape.get('rustic'):
                images.pop('rustic', None)
            if part is not shape:
                part = dict(shape, **part, chips=(0, 0), border=None, panels=False, rustic=False)
            high, part_low = make_shape(f'{name}_{letter}' + (f'_{j}' if j else ''), kind, part, stone, images,
                                        seed=zlib.crc32(f'{name}{i}{j}'.encode()) % 10007)
            high.data.materials.clear()     # (a boolean leaves its cutter's empty slot behind)
            high.data.materials.append(stone_material(f'{name}_{letter}_{j}_stone', stone, images, lichens))
            highs.append(high)
            if low is None:
                low = part_low
            else:
                merge(low, part_low)
        pairs.append((highs, low))
        print(name, letter, 'high', sum(len(h.data.polygons) for h in highs), 'low', len(low.data.polygons))
    lows = [low for _, low in pairs]
    unwrap(lows, kind.get('from_above', False))
    ground = ground_plane()
    size = 512 if QUICK else kind['size']
    pictures = save_pictures(name, bake_kind(name, kind, pairs, size), size)
    bpy.data.objects.remove(ground)
    body, face = game_material(name, pictures), game_material(name + '_face', pictures)
    for (highs, low), shape in zip(pairs, kind['shapes']):
        low.data.materials.clear()
        low.data.materials.append(body)
        low.data.materials.append(face)
        mark_face(low, shape)
        low.data.name = low.name
        low['size'] = [round(v, 3) for v in (shape['w'], shape.get('size_d', shape['d']), shape['h'])]
        if shape.get('panel'):
            low['panel'] = list(shape['panel'])
        for high in highs:
            discard(high)
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for low in lows:
        low.select_set(True)
    path = OUT / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_tangents=True, export_extras=True, export_image_format='WEBP',
                              export_image_quality=90, export_materials='EXPORT', export_yup=True)
    for low in lows:
        discard(low)
    print('wrote', path, os.path.getsize(path) // 1024, 'KiB')


for kind_name in WANTED or ORDER:
    make_kind(kind_name)
