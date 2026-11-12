"""The yard's things (src/game/yard): the bier, the coffin, the van. Built by props.py.

Sizes are the game's: the bier is SIZE (2.0 long, 0.62 wide, its bed 0.72 up) on wheels of WHEEL (0.11) radius
(bier.js); the coffin is COFFIN (1.84 by 0.56, 0.34 deep, a lid of 0.025) (grave.js); the van is VAN (5.1 long,
2.05 high, 1.95 wide) (gate.js).
"""

import math

import bmesh
from mathutils import Vector

from kit import (R, Shader, T, apply, bevel, block, box_uv, fillet, from_bmesh, join, lamp_material, lathe, move, prism, smooth, text, tube)
from flat import _rounder, metal, plastic

# --- surfaces -------------------------------------------------------------------------------------------------------


def painted_iron(name='bier iron'):
    """Black-painted iron, the paint gone to rust in patches and on every edge, mud on the low parts."""
    s = Shader(name)
    rust, rust_normal, _, rust_rough, _ = s.scan('rust_coarse_01', s.uv(0.4))
    position = s.node('ShaderNodeNewGeometry').outputs['Position']
    height = s.node('ShaderNodeSeparateXYZ', Vector=position).outputs['Z']
    bare = s.math('MAXIMUM', s.math('MULTIPLY', s.edges(0.004), s.ramp(s.noise(14.0, 6.0), 0.4, 0.55)), s.ramp(s.noise(5.0, 8.0), 0.62, 0.7))
    mud = s.math('MULTIPLY', s.ramp(height, 0.35, 0.05), s.ramp(s.noise(9.0, 6.0), 0.35, 0.6))
    colour = s.mix((0.022, 0.021, 0.02), rust, bare)
    colour = s.mix(colour, (0.06, 0.045, 0.03), mud)
    rough = s.mix(s.mix(0.45, rust_rough, bare, 'FLOAT'), 0.9, mud, 'FLOAT')
    return s.out(colour, rough, 0.0, s.mix(s.node('ShaderNodeNormalMap').outputs['Normal'], rust_normal, bare))


def boards(name='bier boards'):
    s = Shader(name)
    colour, normal, ao, rough, _ = s.scan('weathered_planks', s.uv(1.0))
    return s.out(s.mix(colour, (0.05, 0.045, 0.04), 0.35), rough, 0.0, normal)


def rubber(name='tyre'):
    s = Shader(name)
    position = s.node('ShaderNodeNewGeometry').outputs['Position']
    height = s.node('ShaderNodeSeparateXYZ', Vector=position).outputs['Z']
    dust = s.math('MULTIPLY', s.ramp(height, 0.12, 0.0), s.ramp(s.noise(30.0, 6.0), 0.3, 0.7))
    colour = s.mix((0.018, 0.018, 0.018), (0.07, 0.055, 0.04), dust)
    return s.out(colour, s.mix(0.9, 0.97, dust, 'FLOAT'), 0.0, s.bump(s.noise(800.0, 3.0), 0.1, 0.0003))


# --- the bier -------------------------------------------------------------------------------------------------------

BIER = dict(long=2.0, wide=0.62, high=0.72, wheel=0.11)
AXLES = (-0.86, 0.86)           # along its length; the handle is at +y, the far end at -y
TRACK = 0.335                   # the wheels' middles either side


def bier(fine):
    """The cemetery's wheeled bier: an iron frame with a bed of boards on legs to two axles, a handle to push it
    by at +y; and its four wheels, each its own part turning on its axle (x)."""
    seg = 3 if fine else 1
    sides = 12 if fine else 6
    iron, wood = painted_iron(), boards()
    l, w, h, r = BIER['long'] / 2, BIER['wide'] / 2, BIER['high'], BIER['wheel']
    board = 0.03
    rail = h - board                # the top of the frame, under the boards
    frame = []
    # The bed: six boards on the frame.
    for k in range(6):
        x0 = -w + k * (BIER['wide'] / 6) + 0.003
        frame.append(block('board', (x0, -l, rail), (x0 + BIER['wide'] / 6 - 0.006, l, h), wood, 0.003, seg, grain='Y'))
    # Angle iron along the sides and across the ends and under the middle of the bed.
    for sx in (-1, 1):
        frame.append(block('side web', (sx * w - (0.005 if sx > 0 else 0), -l, rail - 0.045), (sx * w + (0.005 if sx < 0 else 0), l, rail), iron, 0.001))
        x_in = sx * (w - 0.04)
        frame.append(block('side flange', (min(sx * w, x_in), -l, rail - 0.005), (max(sx * w, x_in), l, rail), iron, 0.001))
    for y in (-l + 0.02, -0.33, 0.33, l - 0.02):
        frame.append(block('cross', (-w, y - 0.02, rail - 0.005), (w, y + 0.02, rail), iron, 0.001, grain='X'))
        frame.append(block('cross web', (-w, y - 0.0025, rail - 0.04), (w, y + 0.0025, rail), iron, 0.001, grain='X'))
    # The legs, down from the side angles to a bearing block round each end of the axle.
    leg_x = w - 0.03
    for y in AXLES:
        for sx in (-1, 1):
            x = sx * leg_x
            frame.append(block('leg', (x - 0.015, y - 0.015, r + 0.02), (x + 0.015, y + 0.015, rail - 0.005), iron, 0.002, seg))
            frame.append(block('bearing', (x - 0.022, y - 0.028, r - 0.025), (x + 0.022, y + 0.028, r + 0.03), iron, 0.004, seg))
        frame.append(tube('axle', [(-TRACK - 0.03, y, r), (TRACK + 0.03, y, r)], 0.011, sides, iron))
        frame.append(tube('cross bar', [(-leg_x, y, 0.42), (leg_x, y, 0.42)], 0.011, sides, iron))
    # Struts along each side, and a pair of braces from the legs up under the bed.
    for sx in (-1, 1):
        x = sx * leg_x
        frame.append(tube('strut', [(x, AXLES[0], 0.3), (x, AXLES[1], 0.3)], 0.012, sides, iron))
        for y0, y1 in ((AXLES[0], -0.33), (AXLES[1], 0.33)):
            frame.append(tube('brace', [(x, y0, 0.3), (x, y1, rail - 0.04)], 0.009, sides, iron))
    # The handle: up and back from the side angles to a bar with a rubber grip.
    handle = fillet([(-w + 0.04, l - 0.06, rail - 0.03), (-w + 0.04, l + 0.08, rail - 0.01), (-w + 0.04, l + 0.25, h + 0.17), (-w + 0.04, l + 0.28, h + 0.18),
                     (w - 0.04, l + 0.28, h + 0.18), (w - 0.04, l + 0.25, h + 0.17), (w - 0.04, l + 0.08, rail - 0.01), (w - 0.04, l - 0.06, rail - 0.03)],
                    0.06, 6 if fine else 3)
    frame.append(tube('handle', handle, 0.0135, sides, iron))
    frame.append(tube('grip', [(-0.19, l + 0.28, h + 0.18), (0.19, l + 0.28, h + 0.18)], 0.018, sides, rubber('grip')))
    parts = {'bier': join('bier', frame, 40)}

    # The wheels: a pressed steel disc in a solid rubber tyre, turned on the x axis.
    tyre_profile = [(0.075, -0.021), (0.092, -0.022), (0.104, -0.018), (r, -0.008), (r, 0.008), (0.104, 0.018), (0.092, 0.022), (0.075, 0.021)]
    disc_profile = [(0.0, -0.032), (0.018, -0.032), (0.021, -0.026), (0.026, -0.012), (0.066, -0.01), (0.074, -0.02), (0.078, -0.021),
                    (0.078, 0.021), (0.074, 0.02), (0.066, 0.01), (0.026, 0.012), (0.021, 0.026), (0.018, 0.032), (0.0, 0.032)]
    if fine:
        tyre_profile = _rounder(tyre_profile)
    steel = painted_iron('wheel iron')
    for y, end in zip(AXLES, ('f', 'r')):
        for sx, hand in ((1, 'l'), (-1, 'r')):
            wheel = join(f'wheel_{end}{hand}', [lathe('tyre', tyre_profile, 32 if fine else 18, rubber(), axis='X'),
                                               lathe('disc', disc_profile, 32 if fine else 18, steel, axis='X')], 40)
            parts[wheel.name] = move(wheel, T(sx * TRACK, y, r))
    return parts


# --- the coffin -----------------------------------------------------------------------------------------------------

COFFIN = dict(long=1.84, wide=0.56, deep=0.34, lid=0.025)
# Its outline from above, head end at -y: narrow at the head, widest at the shoulders, narrowest at the feet.
OUTLINE = [(-0.19, -0.92), (0.19, -0.92), (0.28, -0.5), (0.165, 0.92), (-0.165, 0.92), (-0.28, -0.5)]
PLATE = dict(wide=0.17, high=0.07, at=-0.45)        # the name plate on the lid, its middle that far along from the middle


def inset(outline, d):
    """A convex outline (counter-clockwise) moved in by `d` (out, if negative) all round."""
    points = [Vector(p) for p in outline]
    out = []
    for i, p in enumerate(points):
        a, b = points[i - 1], points[(i + 1) % len(points)]
        n1 = Vector((-(p - a).y, (p - a).x)).normalized()
        n2 = Vector((-(b - p).y, (b - p).x)).normalized()
        m = (n1 + n2) / (1 + n1.dot(n2))
        out.append((p.x + m.x * d, p.y + m.y * d))
    return out


def tray(name, outline, wall, floor, high, outside, inside):
    """An open box on `outline`: walls `wall` thick, a floor `floor` thick, `high` tall; the outside and the top
    edge in one material, the inside in another."""
    inner = inset(outline, wall)
    bm = bmesh.new()
    rings = {key: [bm.verts.new((x, y, z)) for x, y in shape] for key, shape, z in
             (('ob', outline, 0.0), ('ot', outline, high), ('it', inner, high), ('ib', inner, floor))}
    n = len(outline)
    faces = [bm.faces.new(list(reversed(rings['ob'])))]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((rings['ob'][i], rings['ob'][j], rings['ot'][j], rings['ot'][i])))
        faces.append(bm.faces.new((rings['ot'][i], rings['ot'][j], rings['it'][j], rings['it'][i])))
    lined = [bm.faces.new((rings['it'][i], rings['it'][(i + 1) % n], rings['ib'][(i + 1) % n], rings['ib'][i])) for i in range(n)]
    lined.append(bm.faces.new(rings['ib']))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in lined:
        face.material_index = 1
    obj = from_bmesh(name, bm, outside)
    obj.data.materials.append(inside)
    return obj


def veneer(name='coffin veneer'):
    """Oak veneer under a satin lacquer, as it comes up after two days in wet clay: smeared with it low down and
    on the lid, the lacquer dull and bloomed with damp."""
    s = Shader(name)
    colour, normal, _, _, _ = s.scan('oak_veneer_01', s.uv(0.8))
    position = s.node('ShaderNodeNewGeometry').outputs['Position']
    height = s.node('ShaderNodeSeparateXYZ', Vector=position).outputs['Z']
    clay = s.math('MAXIMUM', s.math('MULTIPLY', s.ramp(height, 0.2, 0.02), s.ramp(s.noise(6.0, 8.0), 0.3, 0.5)),
                  s.math('MULTIPLY', s.ramp(height, 0.3, 0.345), s.ramp(s.noise(3.5, 8.0, distortion=0.6), 0.55, 0.62)))
    bloom = s.ramp(s.noise(4.0, 6.0), 0.45, 0.75)
    colour = s.mix(colour, (0.42, 0.26, 0.15), 1.0, blend='MULTIPLY')                # a mid oak stain
    colour = s.mix(colour, (0.2, 0.17, 0.14), s.math('MULTIPLY', bloom, 0.2))
    colour = s.mix(colour, (0.075, 0.055, 0.035), clay)
    rough = s.mix(s.mix(0.22, 0.45, bloom, 'FLOAT'), 0.85, clay, 'FLOAT')
    return s.out(colour, rough, 0.0, s.mix(normal, s.bump(s.noise(200.0, 6.0), 0.4, 0.001), clay))


def satin(name='lining'):
    """The lining: white rayon satin, ruched, gone grey and stained."""
    s = Shader(name)
    folds = s.node('ShaderNodeTexWave', Vector=s.uv(0.12), Scale=1.0, Distortion=2.0, _wave_type='BANDS', _bands_direction='X').outputs['Fac']
    stain = s.ramp(s.noise(5.0, 8.0), 0.55, 0.75)
    colour = s.mix((0.42, 0.4, 0.35), (0.16, 0.13, 0.09), s.math('MULTIPLY', stain, 0.8))
    colour = s.mix(colour, (0.3, 0.29, 0.26), s.math('MULTIPLY', folds, 0.5))
    return s.out(colour, s.mix(0.3, 0.55, stain, 'FLOAT'), 0.0, s.bump(folds, 0.8, 0.006))


def coffin(fine):
    """An English coffin, head at -y: the body (veneered walls on a plinth, six handles, the lining) and its lid
    (moulded, with a raised top) with the name plate on it, the plate its own part for the game to write on."""
    from flat import brass
    seg = 3 if fine else 1
    wood, lining, fittings = veneer(), satin(), brass('coffin fittings', 0.15)
    lid_bottom = COFFIN['deep'] - COFFIN['lid']
    body = [prism('plinth', OUTLINE, 0.0, 0.04, wood, 0.006, seg),
            tray('shell', inset(OUTLINE, 0.012), 0.016, 0.03, lid_bottom, wood, lining)]
    # The frill round the inside of the top edge, and the pad on the floor.
    frill = inset(OUTLINE, 0.03)
    points = []
    for i, p in enumerate(frill):
        q = frill[(i + 1) % len(frill)]
        steps = max(2, int(math.dist(p, q) / 0.012))
        for k in range(steps):
            t = k / steps
            points.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    if fine:
        pleats = []
        for k, (x, y) in enumerate(points):
            middle = Vector((x, y)).normalized()
            out = 0.004 * (1 if k % 2 else -1)
            pleats.append((x + middle.x * out, y + middle.y * out, lid_bottom - 0.006))
        body.append(tube('frill', pleats, 0.007, 6, lining, closed=True))
    else:
        body.append(tube('frill', [(x, y, lid_bottom - 0.006) for x, y in points[::3]], 0.007, 4, lining, closed=True))
    body.append(prism('pad', inset(OUTLINE, 0.04), 0.03, 0.036, lining, 0.003, 1))
    # Three handles down each side: a bar on two lugs, hanging.
    wall = inset(OUTLINE, 0.012)
    for i, j, spots in ((2, 3, (0.08, 0.45, 0.82)), (4, 5, (0.18, 0.55, 0.92))):
        a, b = Vector(OUTLINE[i]), Vector(OUTLINE[j])
        along = (b - a).normalized()
        out = Vector((along.y, -along.x))
        wa, wb = Vector(wall[i]), Vector(wall[j])
        for t in spots:
            middle = wa.lerp(wb, t)
            for side in (-1, 1):
                lug = middle + along * side * 0.07
                boss = lathe('lug', [(0.0, 0.0), (0.014, 0.0), (0.012, 0.012), (0.007, 0.018), (0.0, 0.02)], 16 if fine else 8, fittings, axis='Y')
                angle = math.degrees(math.atan2(out.y, out.x)) - 90
                body.append(move(boss, T(lug.x, lug.y, 0.2) @ R(angle, 'Z')))
            bar = [middle + along * -0.07 + out * 0.016, middle + along * -0.06 + out * 0.03, middle + along * 0.06 + out * 0.03, middle + along * 0.07 + out * 0.016]
            body.append(tube('handle', [(p.x, p.y, 0.188 - 0.02 * (k in (1, 2))) for k, p in enumerate(bar)], 0.0065, 10 if fine else 6, fittings))
    # A handle at each end too.
    for y, sign in ((-0.92 + 0.012, -1), (0.92 - 0.012, 1)):
        for side in (-1, 1):
            boss = lathe('lug', [(0.0, 0.0), (0.014, 0.0), (0.012, 0.012), (0.007, 0.018), (0.0, 0.02)], 16 if fine else 8, fittings, axis='Y')
            body.append(move(boss, T(side * 0.07, y, 0.2) @ (R(0, 'Z') if sign > 0 else R(180, 'Z'))))
        body.append(tube('handle', [(-0.07, y + sign * 0.016, 0.188), (-0.06, y + sign * 0.03, 0.168), (0.06, y + sign * 0.03, 0.168),
                                    (0.07, y + sign * 0.016, 0.188)], 0.0065, 10 if fine else 6, fittings))

    # The lid: a slab with a moulded edge and a raised top.
    lid = join('coffin_lid', [prism('lid', OUTLINE, lid_bottom, lid_bottom + 0.017, wood, 0.006, 4 if fine else 1),
                              prism('lid top', inset(OUTLINE, 0.035), lid_bottom + 0.016, COFFIN['deep'], wood, 0.005, seg)], 40)
    plate = [block('plate', (-PLATE['high'] / 2, PLATE['at'] - PLATE['wide'] / 2, COFFIN['deep']), (PLATE['high'] / 2, PLATE['at'] + PLATE['wide'] / 2,
                                                                                                      COFFIN['deep'] + 0.002), fittings, 0.001)]
    plate = join('plate', plate, 40)
    return {'coffin': join('coffin', body, 40), 'coffin_lid': lid, 'plate': plate}


# --- the van --------------------------------------------------------------------------------------------------------

VAN = dict(long=5.1, high=2.05, wide=1.95)
WHEELS = dict(front=-1.95, rear=1.6, track=0.82, radius=0.33, width=0.2)
CAB_DOOR = (-1.5, -0.76)        # along its length, from its front edge to its back
ARCH = 0.4                      # the wheel arches' radius, about the axle a little up


def _lerp(table, y):
    for (y0, v0), (y1, v1) in zip(table, table[1:]):
        if y <= y1:
            t = 0.0 if y1 == y0 else max(0.0, min(1.0, (y - y0) / (y1 - y0)))
            return v0 + (v1 - v0) * t
    return table[-1][1]


# Its side view and plan along its length (nose at -y): the top line (bonnet, windscreen, roof), the half width,
# and the radius of the roof's edge.
TOP = [(-2.55, 0.97), (-2.5, 1.02), (-1.72, 1.14), (-1.22, 1.92), (-1.08, 2.03), (-0.95, 2.05), (2.48, 2.05), (2.55, 1.99)]
HALF = [(-2.55, 0.9), (-2.45, 0.95), (-1.7, 0.96), (2.55, 0.96)]
EDGE = [(-2.55, 0.07), (-1.72, 0.07), (-1.22, 0.16), (2.55, 0.16)]
BOTTOM = 0.33
BELT = 1.1


def _arch(y):
    """How high the side's lower edge is at y: over the wheels it follows the arch."""
    low = BOTTOM + 0.06
    for axle in (WHEELS['front'], WHEELS['rear']):
        d = abs(y - axle)
        if d < ARCH:
            low = max(low, WHEELS['radius'] + 0.04 + math.sqrt(ARCH ** 2 - d ** 2))
    return low


def _ring(y, fine):
    """The van's cross-section at y, all round: [(x, z)], starting at the middle of the bottom and going up the +x
    side, over the roof and down the -x side. Each ring has the same number of points; what kind of surface each
    point's face is (underneath, wheel well, side, roof) is decided by where it is."""
    top, hw, rt = _lerp(TOP, y), _lerp(HALF, y), _lerp(EDGE, y)
    tumble = 0.07 * max(0.0, min(1.0, (top - 1.2) / 0.6))
    belt = min(BELT, top - rt - 0.05)
    low = _arch(y)
    well = hw - 0.26
    half = [(0.0, BOTTOM), (well, BOTTOM), (well, low - 0.005), (hw - 0.03, low), (hw, low + 0.03), (hw, belt)]
    corner = 8 if fine else 3
    cx, cz = hw - tumble - rt, top - rt
    for k in range(corner + 1):
        a = math.pi / 2 * k / corner
        half.append((cx + rt * math.cos(a), cz + rt * math.sin(a)))
    half.append((0.0, top))
    return half[:-1] + [half[-1]] + [(-x, z) for x, z in reversed(half[1:-1])]


def _stations(fine):
    keys = [-2.55, -2.5, -2.4, -1.72, CAB_DOOR[0], -1.22, -1.08, -0.95, CAB_DOOR[1], 2.4, 2.48, 2.55]
    for axle in (WHEELS['front'], WHEELS['rear']):
        keys += [axle + ARCH * math.sin(a) for a in [math.pi / 2 * k / 5 for k in range(-5, 6)]]
    keys = sorted(set(round(y, 4) for y in keys))
    if fine:
        dense = []
        for a, b in zip(keys, keys[1:]):
            n = max(1, int((b - a) / 0.15))
            dense += [a + (b - a) * k / n for k in range(n)]
        keys = dense + [keys[-1]]
    return keys


def van_paint(name='van paint'):
    """Navy coachwork paint, oxidised flat on the top surfaces, rusting at the sills, arches and seams, road dirt
    thrown up the sides."""
    s = Shader(name)
    rust, rust_normal, _, rust_rough, _ = s.scan('rust_coarse_01', s.uv(0.6))
    position = s.node('ShaderNodeNewGeometry').outputs['Position']
    normal = s.node('ShaderNodeNewGeometry').outputs['Normal']
    xyz = s.node('ShaderNodeSeparateXYZ', Vector=position)
    up = s.node('ShaderNodeSeparateXYZ', Vector=normal).outputs['Z']
    height = xyz.outputs['Z']
    faded = s.math('MULTIPLY', s.ramp(up, 0.3, 0.9), s.ramp(s.noise(1.5, 6.0), 0.3, 0.7, (0.5, 1.0)))
    grime = s.math('MULTIPLY', s.ramp(height, 0.95, 0.35), s.ramp(s.noise(4.0, 8.0), 0.3, 0.6, (0.4, 1.0)))
    seams = s.math('SUBTRACT', 1.0, s.occlusion(0.05))
    rusted = s.math('MAXIMUM', s.math('MULTIPLY', s.ramp(height, 0.75, 0.4), s.ramp(s.noise(6.0, 10.0, distortion=0.4), 0.55, 0.6)),
                    s.math('MULTIPLY', s.math('MULTIPLY', seams, 2.0, clamp=True), s.ramp(s.noise(30.0, 6.0), 0.5, 0.6)))
    # A few long scrapes along the sides, where it has been driven too close to things.
    scrape = s.noise(1.0, 3.0, s.node('ShaderNodeMapping', Vector=position, Scale=(2, 1.2, 60)).outputs['Vector'])
    scratches = s.math('MULTIPLY', s.math('MULTIPLY', s.ramp(scrape, 0.71, 0.73), s.ramp(s.noise(0.8, 2.0), 0.55, 0.65)), 0.5)
    colour = s.mix((0.011, 0.016, 0.03), (0.05, 0.06, 0.075), faded)
    colour = s.mix(colour, (0.09, 0.09, 0.09), scratches)
    colour = s.mix(colour, (0.05, 0.04, 0.03), grime)
    colour = s.mix(colour, rust, rusted)
    rough = s.mix(s.mix(0.3, 0.65, faded, 'FLOAT'), 0.85, s.math('MAXIMUM', grime, rusted), 'FLOAT')
    return s.out(colour, rough, 0.0, s.mix(s.bump(s.noise(80.0, 4.0), 0.05, 0.0005), rust_normal, rusted))


def van(fine):
    """A tired panel van of the mid-1980s, nose at -y: the body (with its bumpers, grille, wipers, plates and the
    lamps' bezels; the cargo bay inside it), the two cab doors and the two rear doors on their hinges, four wheels
    on their axles, and its lamps (head, tail) as emissive parts of their own."""
    seg = 3 if fine else 1
    paint = van_paint()
    dark = plastic('van black', (0.012, 0.012, 0.012), 0.6)
    inside = Shader('van inside').out((0.01, 0.01, 0.01), 0.9, 0.0)
    under = Shader('underneath').out((0.02, 0.018, 0.016), 0.9, 0.0)
    chrome = metal('van chrome', (0.6, 0.6, 0.58), 0.18, brushed=False)
    glass = Shader('van glass').out((0.004, 0.005, 0.006), 0.04, 0.0)
    plate_white = plastic('plate white', (0.6, 0.6, 0.57), 0.35, 0.5)
    plate_yellow = plastic('plate yellow', (0.6, 0.42, 0.02), 0.35, 0.5)
    amber = Shader('amber').out((0.5, 0.15, 0.0), 0.1, 0.0)
    print_ = plastic('plate print', (0.01, 0.01, 0.01), 0.5, 0.2)
    stations = _stations(fine)
    rings = [_ring(y, fine) for y in stations]
    n = len(rings[0])

    bm = bmesh.new()
    verts = [[bm.verts.new((x, y, z)) for x, z in ring] for y, ring in zip(stations, rings)]
    side_faces = []
    for i in range(len(stations) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            face = bm.faces.new((verts[i][k], verts[i][k1], verts[i + 1][k1], verts[i + 1][k]))
            side_faces.append(face)
    front = bm.faces.new(verts[0])
    # The back: a frame round the opening the rear doors fill, and the cargo bay as a dark tunnel in to the bulkhead.
    back = verts[-1]
    opening = []
    hw = _lerp(HALF, stations[-1])
    for x, z in rings[-1]:
        ox = max(-hw + 0.07, min(hw - 0.07, x))
        oz = max(0.8, min(1.93, z))
        opening.append((ox, oz))
    inner = [bm.verts.new((x, stations[-1], z)) for x, z in opening]
    for k in range(n):
        k1 = (k + 1) % n
        bm.faces.new((back[k], inner[k], inner[k1], back[k1]))
    deep = [bm.verts.new((x, -0.9, z)) for x, z in opening]
    bay = []
    for k in range(n):
        k1 = (k + 1) % n
        bay.append(bm.faces.new((inner[k], deep[k], deep[k1], inner[k1])))
    bay.append(bm.faces.new(deep))
    bmesh.ops.remove_doubles(bm, verts=inner + deep, dist=0.0005)
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.is_valid and f not in bay])
    for face in bay:
        if face.is_valid:
            face.normal_update()
    # Materials by where a face is: underneath and in the wheel wells, the bay, the rest painted.
    for face in bm.faces:
        c = face.calc_center_median()
        if face in bay:
            face.material_index = 1
        elif face.normal.z < -0.7 or (abs(c.x) < _lerp(HALF, c.y) - 0.02 and c.z < 0.8 and face.normal.z < 0.7 and abs(face.normal.y) < 0.7):
            face.material_index = 2
    # The cab doors come out of the sides.
    doors = {}
    for sx, hand in ((1, 'l'), (-1, 'r')):
        picked = []
        for face in bm.faces:
            c = face.calc_center_median()
            top = _lerp(TOP, c.y) - _lerp(EDGE, c.y) + 0.005
            if CAB_DOOR[0] < c.y < CAB_DOOR[1] and c.x * sx > 0.7 and 0.4 < c.z < top and face.normal.x * sx > 0.5:
                picked.append(face)
        door = bmesh.new()
        lookup = {}
        for face in picked:
            made = door.faces.new([lookup.setdefault(v, door.verts.new(v.co)) for v in face.verts])
            made.normal_update()
            if made.normal.x * sx < 0:
                made.normal_flip()
        hole = bmesh.ops.delete(bm, geom=picked, context='FACES_ONLY')
        # The aperture: jambs in to a dark panel where the cab is.
        edges = [e for e in bm.edges if e.is_boundary and e.verts[0].co.x * sx > 0.7 and CAB_DOOR[0] - 0.01 < e.verts[0].co.y < CAB_DOOR[1] + 0.01]
        made = bmesh.ops.extrude_edge_only(bm, edges=edges)
        moved = [v for v in made['geom'] if isinstance(v, bmesh.types.BMVert)]
        for v in moved:
            v.co.x -= sx * 0.14
        for face in [f for f in made['geom'] if isinstance(f, bmesh.types.BMFace)]:
            face.material_index = 1
        fill = bmesh.ops.edgeloop_fill(bm, edges=[e for e in bm.edges if e.is_boundary and all(v in moved for v in e.verts)])
        for face in fill['faces']:
            face.material_index = 1
        doors[hand] = door
        del hole
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index != 1])
    body = from_bmesh('van', bm, paint)
    body.data.materials.append(inside)
    body.data.materials.append(under)
    smooth(body, 30)
    box_uv(body, 'Y', 1.0)
    parts = {'van': body}

    for hand, door in doors.items():
        sx = 1 if hand == 'l' else -1
        obj = from_bmesh(f'cab_door_{hand}', door, paint)
        mod = obj.modifiers.new('thick', 'SOLIDIFY')
        mod.thickness = 0.045
        mod.offset = -1.0           # in from its outside, which stays where the body's side was
        mod.use_even_offset = True
        obj = bevel(apply(obj), 0.006 if fine else 0.004, seg, 50)
        smooth(obj, 30)
        box_uv(obj, 'Y', 1.0)
        pieces = [obj]
        # The handle, the mirror on its arm.
        pieces.append(block('handle', (sx * 0.955 - 0.012, CAB_DOOR[1] - 0.2, 1.0), (sx * 0.955 + 0.012, CAB_DOOR[1] - 0.08, 1.03), chrome, 0.006, seg))
        arm = [(sx * 0.93, CAB_DOOR[0] + 0.1, 1.25), (sx * 1.03, CAB_DOOR[0] + 0.08, 1.3), (sx * 1.1, CAB_DOOR[0] + 0.06, 1.33)]
        pieces.append(tube('mirror arm', arm, 0.011, 8 if fine else 6, chrome))
        mirror_back = block('mirror', (-0.07, -0.025, -0.1), (0.07, 0.025, 0.1), dark, 0.012, seg)
        pieces.append(move(mirror_back, T(sx * 1.16, CAB_DOOR[0] + 0.06, 1.38) @ R(sx * -8, 'Z')))
        if fine:
            # The window: glass in its rubber, on the slope above the waist.
            y0, y1 = CAB_DOOR[0] + 0.1, CAB_DOOR[1] - 0.06
            window = []
            for y in [y0 + (y1 - y0) * k / 6 for k in range(7)]:
                window.append((y, _lerp(TOP, y) - _lerp(EDGE, y) - 0.05))
            outline = [(y0, BELT + 0.05), (y1, BELT + 0.05)] + list(reversed(window))
            for name, grow, out, material in (('rubber', 0.015, 0.001, dark), ('glass', 0.0, 0.0018, glass)):
                pieces.append(_side_decal(name, outline, sx, grow, out, material, obj))
            pieces.append(block('lock', (sx * 0.958 - 0.003, CAB_DOOR[1] - 0.13, 1.05), (sx * 0.958 + 0.003, CAB_DOOR[1] - 0.115, 1.065), chrome))
        pieces.append(block('strip', (sx * 0.958 - 0.012, CAB_DOOR[0] + 0.01, 0.9), (sx * 0.958 + 0.012, CAB_DOOR[1] - 0.01, 0.95), dark, 0.008, seg, grain='Y'))
        doors[hand] = join(f'cab_door_{hand}', pieces, 30)
        parts[doors[hand].name] = doors[hand]

    # The rear doors fill the opening, split down the middle, each hinged on its outer edge.
    for sx, hand in ((1, 'l'), (-1, 'r')):
        half = [(x, z) for x, z in opening if x * sx >= -1e-6]
        half = [(x + sx * 0.002 if abs(x) < 1e-6 else x, z) for x, z in half]
        half = sorted(set(half), key=lambda p: math.atan2(p[1] - 1.36, p[0] - sx * 0.45))
        slab = prism(f'rear_door_{hand}', [(x, z) for x, z in half], -(stations[-1] + 0.006), -(stations[-1] - 0.04), paint, 0.006 if fine else 0.004, seg)
        move(slab, R(90, 'X'))
        smooth(slab, 30)
        box_uv(slab, 'Z', 1.0)
        pieces = [slab]
        if fine:
            ws = [(sx * 0.12, 1.4), (sx * (hw - 0.17), 1.4), (sx * (hw - 0.17), 1.82), (sx * 0.12, 1.82)]
            for name, grow, out, material in (('rubber', 0.015, 0.001, dark), ('glass', 0.0, 0.0018, glass)):
                pts = [(x + (grow if x * sx > abs(sx * 0.3) else -grow) * sx, z + (grow if z > 1.6 else -grow)) for x, z in ws]
                pieces.append(_back_decal(name, pts, stations[-1] + 0.006 + out, material))
            if hand == 'r':
                pieces.append(_back_decal('plate', [(-0.0, 0.85), (-0.52, 0.85), (-0.52, 0.96), (-0.0, 0.96)], stations[-1] + 0.007, plate_yellow))
                pieces.append(text('C417 KRW', 0.075, print_, T(-0.26, stations[-1] + 0.0075, 0.905) @ R(90, 'X') @ R(180, 'Y')))
        if hand == 'r':
            pieces.append(block('handle', (-0.06, stations[-1] + 0.006, 1.18), (-0.02, stations[-1] + 0.03, 1.21), chrome, 0.006, seg))
        door = join(f'rear_door_{hand}', pieces, 30)
        parts[door.name] = door

    # Bumpers, the grille, the lamps' bezels, the plates, the wipers, the exhaust.
    nose, tail = stations[0], stations[-1]
    body_bits = [
        block('bumper', (-0.98, nose - 0.11, 0.28), (0.98, nose + 0.05, 0.45), dark, 0.03, seg, grain='X'),
        block('bumper', (-0.98, tail - 0.05, 0.3), (0.98, tail + 0.1, 0.44), dark, 0.03, seg, grain='X'),
        block('step', (-0.4, tail + 0.05, 0.36), (0.4, tail + 0.2, 0.39), dark, 0.005, seg, grain='X'),
        block('grille', (-0.44, nose - 0.02, 0.58), (0.44, nose + 0.01, 0.9), dark, 0.008, seg, grain='X'),
        block('plate', (-0.26, nose - 0.118, 0.31), (0.26, nose - 0.108, 0.42), plate_white, 0.004, seg, grain='X'),
        tube('exhaust', [(0.5, tail - 0.8, 0.29), (0.55, tail + 0.03, 0.29)], 0.025, 10 if fine else 6, under),
        _wiper(-0.35, fine, chrome), _wiper(0.3, fine, chrome),
    ]
    for sx in (-1, 1):
        body_bits.append(block('strip', (sx * 0.958 - 0.012, CAB_DOOR[1] + 0.01, 0.9), (sx * 0.958 + 0.012, 2.4, 0.95), dark, 0.008, seg, grain='Y'))
        body_bits.append(block('strip', (sx * 0.958 - 0.012, -2.35, 0.9), (sx * 0.958 + 0.012, CAB_DOOR[0] - 0.01, 0.95), dark, 0.008, seg, grain='Y'))
        body_bits.append(block('bezel', (sx * 0.65 - 0.15, nose - 0.025, 0.62), (sx * 0.65 + 0.15, nose + 0.01, 0.82), chrome, 0.01, seg, grain='X'))
        body_bits.append(block('indicator', (sx * 0.65 - 0.1, nose - 0.02, 0.5), (sx * 0.65 + 0.1, nose + 0.01, 0.56), amber, 0.008, seg))
        body_bits.append(block('lamp housing', (sx * (hw - 0.035) - 0.03, tail - 0.01, 0.75), (sx * (hw - 0.035) + 0.03, tail + 0.025, 1.12), dark, 0.006, seg))
    if fine:
        for k in range(6):
            z = 0.61 + k * 0.05
            body_bits.append(block('slat', (-0.42, nose - 0.025, z), (0.42, nose - 0.02, z + 0.02), chrome, 0.003, 2, grain='X'))
        body_bits.append(text('C417 KRW', 0.075, print_, T(0, nose - 0.119, 0.365) @ R(90, 'X')))
        # The windscreen in its rubber.
        for grow, out, material in ((0.02, 0.0012, dark), (0.0, 0.0022, glass)):
            body_bits.append(_screen_decal(grow, out, material))
        # The sliding door's shut lines on the near side, the filler cap on the off side.
        for y in (-0.62, 0.45):
            body_bits.append(block('shut line', (0.9605, y - 0.002, 0.42), (0.9625, y + 0.002, 1.85), print_))
        body_bits.append(block('rail', (0.958, -0.62, 1.12), (0.968, 0.6, 1.14), dark, 0.004, 2))
        body_bits.append(_cap(fine, chrome))
        for a, b in (((-0.8, -2.49), (0.8, -2.49)), ((-0.8, -1.78), (0.8, -1.78)), ((-0.8, -2.49), (-0.8, -1.78)), ((0.8, -2.49), (0.8, -1.78))):
            body_bits.append(_line(a, b, 0.004, body, print_))
    for bit in body_bits:
        bit.name = 'van bit'
    parts['van'] = join('van', [parts['van']] + body_bits, 30)

    # Lamps: the headlamps' glass and the tail lamps, emissive.
    head = lamp_material('headlamp', (1.0, 0.93, 0.8), 20.0)
    tailglow = lamp_material('tail lamp', (1.0, 0.04, 0.02), 4.0)
    for sx, hand in ((1, 'l'), (-1, 'r')):
        parts[f'headlamp_{hand}'] = block(f'headlamp_{hand}', (sx * 0.65 - 0.13, nose - 0.03, 0.64), (sx * 0.65 + 0.13, nose - 0.018, 0.8), head, 0.008, seg)
        parts[f'tail_lamp_{hand}'] = block(f'tail_lamp_{hand}', (sx * (hw - 0.035) - 0.022, tail + 0.025, 0.95), (sx * (hw - 0.035) + 0.022, tail + 0.033, 1.1),
                                           tailglow, 0.004, seg)

    # The wheels: steel wheels in fat tyres, each turning on its axle (x).
    r, wd = WHEELS['radius'], WHEELS['width'] / 2
    tyre = [(0.2, -wd + 0.01), (0.235, -wd), (0.29, -wd + 0.004), (0.318, -wd + 0.02), (r, -wd + 0.05), (r, wd - 0.05), (0.318, wd - 0.02), (0.29, wd - 0.004),
            (0.235, wd), (0.2, wd - 0.01)]
    rim = [(0.0, -0.035), (0.06, -0.035), (0.07, -0.02), (0.13, -0.02), (0.16, -0.06), (0.2, -0.07), (0.205, -0.085), (0.205, 0.085), (0.2, 0.07),
           (0.12, 0.05), (0.06, 0.05), (0.0, 0.05)]
    if fine:
        tyre = _rounder(tyre)
    tyre_rubber, steel = rubber('van tyre'), painted_iron('van wheel')
    for y, end in ((WHEELS['front'], 'f'), (WHEELS['rear'], 'r')):
        for sx, hand in ((1, 'l'), (-1, 'r')):
            wheel = join(f'wheel_{end}{hand}', [lathe('tyre', tyre, 48 if fine else 20, tyre_rubber, axis='X'),
                                               move(lathe('rim', rim, 48 if fine else 20, steel, axis='X'), R(180, 'Z') if sx < 0 else R(0, 'Z'))], 40)
            parts[wheel.name] = move(wheel, T(sx * WHEELS['track'], y, r))
    return parts


def _side_decal(name, outline, sx, grow, out, material, target):
    """A shape on the van's side above the waist, from points (y, z), laid onto `target` `out` off its surface."""
    middle_y = sum(y for y, _ in outline) / len(outline)
    middle_z = sum(z for _, z in outline) / len(outline)
    bm = bmesh.new()
    points = []
    for y, z in outline:
        dy, dz = y - middle_y, z - middle_z
        size = math.hypot(dy, dz) or 1.0
        y, z = y + dy / size * grow, z + dz / size * grow
        top, hw, rt = _lerp(TOP, y), _lerp(HALF, y), _lerp(EDGE, y)
        tumble = 0.07 * max(0.0, min(1.0, (top - 1.2) / 0.6))
        t = max(0.0, min(1.0, (z - BELT) / max(0.01, top - rt - BELT)))
        points.append(bm.verts.new((sx * (hw - tumble * t + out), y, z)))
    face = bm.faces.new(points)
    face.normal_update()
    if face.normal.x * sx < 0:
        face.normal_flip()
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=8, use_grid_fill=True)
    decal = from_bmesh(name, bm, material)
    wrap = decal.modifiers.new('wrap', 'SHRINKWRAP')
    wrap.target = target
    wrap.wrap_method = 'NEAREST_SURFACEPOINT'
    wrap.wrap_mode = 'ABOVE_SURFACE'
    wrap.offset = out
    return box_uv(apply(decal), 'Y', 1.0)


def _line(a, b, width, target, material):
    """A shut line on the bonnet from a to b (x, y), laid onto `target`."""
    a3, b3 = Vector((*a, _lerp(TOP, a[1]))), Vector((*b, _lerp(TOP, b[1])))
    side = (b3 - a3).cross(Vector((0, 0, 1))).normalized() * (width / 2)
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(p) for p in (a3 - side, b3 - side, b3 + side, a3 + side)])
    face.normal_update()
    if face.normal.z < 0:
        face.normal_flip()
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.1], cuts=12)
    line = from_bmesh('shut line', bm, material)
    line.location.z += 0.05
    wrap = line.modifiers.new('wrap', 'SHRINKWRAP')
    wrap.target = target
    wrap.wrap_method = 'PROJECT'
    wrap.use_negative_direction = True
    wrap.use_positive_direction = False
    wrap.use_project_z = True
    wrap.offset = 0.0015
    return box_uv(apply(line), 'Y', 1.0)


def _back_decal(name, outline, y, material):
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, y, z)) for x, z in outline])
    face.normal_update()
    if face.normal.y < 0:
        face.normal_flip()
    return box_uv(from_bmesh(name, bm, material), 'Z', 1.0)


def _screen_decal(grow, out, material):
    """The windscreen: the flat of the slope between the bonnet and the roof, inside its pillars."""
    y0, y1 = -1.7, -1.25
    z0, z1 = _lerp(TOP, y0), _lerp(TOP, y1)
    slope = Vector((0, y1 - y0, z1 - z0)).normalized()
    normal = Vector((0, -slope.z, slope.y))
    bm = bmesh.new()
    corners = []
    for y, z, side in ((y0, z0, -1), (y0, z0, 1), (y1, z1, 1), (y1, z1, -1)):
        hw = _lerp(HALF, y) - 0.07 * max(0.0, min(1.0, (z - 1.2) / 0.6)) - _lerp(EDGE, y) - 0.03 + grow
        p = Vector((side * hw, y, z)) + slope * (grow if y == y1 else -grow) * 0.7 + normal * out
        corners.append(bm.verts.new(p))
    face = bm.faces.new(corners)
    face.normal_update()
    if face.normal.dot(normal) < 0:
        face.normal_flip()
    return box_uv(from_bmesh('screen', bm, material), 'Y', 1.0)


def _wiper(x, fine, material):
    y0 = -1.68
    z0 = _lerp(TOP, y0) + 0.025
    slope = Vector((0, 0.45, _lerp(TOP, -1.25) - _lerp(TOP, -1.7))).normalized()
    a = Vector((x, y0, z0))
    b = a + Vector((0.35, 0, 0)) + slope * 0.12
    return tube('wiper', [a, b], 0.006, 6 if fine else 4, material)


def _cap(fine, material):
    return lathe('filler', [(0.0, 0.0), (0.045, 0.0), (0.045, 0.004), (0.0, 0.004)], 24 if fine else 10, material, axis='X', at=(-0.96, 1.3, 0.75))


MODELS = {
    'bier': dict(
        shipped=(1024, 512, 512),     # colour, normal, ORM sizes in the GLB
        build=bier, size=2048, extrusion=0.005, reach_ao=0.25,
        apart=[[f'wheel_{e}{h}'] for e in 'fr' for h in 'lr'],
        pivots={f'wheel_{e}{h}': (s * TRACK, y, BIER['wheel']) for y, e in zip(AXLES, 'fr') for s, h in ((1, 'l'), (-1, 'r'))},
        look='yard', close=(0.3, -0.86, 0.3, 0.9), poses={'wheel_fl': [('X', 45)]},
    ),
    'coffin': dict(
        shipped=(1024, 512, 512),
        build=coffin, size=2048, extrusion=0.005, reach_ao=0.2,
        apart=[['coffin_lid', 'plate']],
        pivots={'coffin_lid': (0.0, 0.0, COFFIN['deep'] - COFFIN['lid']), 'plate': (0.0, PLATE['at'], COFFIN['deep'] + 0.002)},
        parents={'plate': 'coffin_lid'},
        look='yard', close=(0.0, -0.45, 0.34, 0.6), poses={'coffin_lid': [('z', 0.3), ('X', 8)]},
    ),
    'van': dict(
        shipped=(1024, 512, 512),
        build=van, size=2048, extrusion=0.01, reach_ao=0.4, dirt=0.4,
        apart=[[f'wheel_{e}{h}'] for e in 'fr' for h in 'lr'] + [[d] for d in ('cab_door_l', 'cab_door_r', 'rear_door_l', 'rear_door_r')],
        pivots={**{f'wheel_{e}{h}': (s * WHEELS['track'], y, WHEELS['radius']) for y, e in ((WHEELS['front'], 'f'), (WHEELS['rear'], 'r'))
                   for s, h in ((1, 'l'), (-1, 'r'))},
                'cab_door_l': (0.96, CAB_DOOR[0], 0.0), 'cab_door_r': (-0.96, CAB_DOOR[0], 0.0),
                'rear_door_l': (0.89, 2.55, 0.0), 'rear_door_r': (-0.89, 2.55, 0.0)},
        look='yard', close=(0.0, -2.6, 0.8, 2.0), poses={'cab_door_r': [('Z', 60)], 'rear_door_l': [('Z', -100)]},
    ),
}
