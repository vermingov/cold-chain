"""The church tower over the roofs to the north-west (src/yard/town.js TOWER: 6 m square, 26 m to its parapet), in
soot-dark sandstone, as a Victorian town church's: angle buttresses stepping back in three stages, string courses
between the stages, a pointed door on the south side, a lancet over it, a lit clock on every face, a belfry of
paired louvred openings, a battlemented parapet with corner pinnacles, and an octagonal spire inside it.

Its origin is the middle of its foot at ground level; the door looks -y (the game's south, toward the yard).
"""

import math

from mathutils import Vector

from shape import Frame, Shape
import joinery

WIDE, HIGH = 6.0, 26.0
HALF = WIDE / 2
PARAPET = (25.6, 26.42, 27.05)       # its foot, the top of its solid part, the top of the merlons
SPIRE = 15.5
FACES = {
    'south': Frame((0, -HALF, 0), (1, 0, 0), (0, -1, 0)),
    'east': Frame((HALF, 0, 0), (0, 1, 0), (1, 0, 0)),
    'north': Frame((0, HALF, 0), (-1, 0, 0), (0, 1, 0)),
    'west': Frame((-HALF, 0, 0), (0, -1, 0), (-1, 0, 0)),
}
DOOR = {'width': 1.5, 'height': 3.3, 'margin': 0.28, 'foot': 0.3}
CLOCK = {'centre': 15.2, 'size': 1.7, 'time': (2, 50)}


def band(shape, y0, y1, proud, material, gap=None):
    """A course round all four faces; `gap` (x0, x1) is left open on the south face, for the door."""
    faces = [(frame, HALF, name in ('south', 'north')) for name, frame in FACES.items()]
    joinery.course(shape, faces, y0, y1, proud, material, {0: [gap]} if gap else None)


def buttress(shape, frame, x0, x1):
    """An angle buttress on a face, from x0 to x1 along it, in three stages each weathered back to the next."""
    profile = [(0, -0.5), (0.8, -0.5), (0.8, 8.6), (0.55, 8.85), (0.55, 16.6), (0.3, 16.85), (0.3, 23.0), (0, 23.4)]
    shape.extrude(frame, profile, x0, x1, 'ashlar')


def louvres(shape, frame, width, height):
    """Sloping boards across a belfry opening below its springing, the dark of the belfry behind them."""
    joinery.fill(shape, frame, 'gothic', width, height, -0.4, 'iron')
    spring = height - width * math.sin(math.pi / 3)
    y = 0.18
    while y < spring - 0.05:
        shape.extrude(frame, [(-0.06, y - 0.08), (-0.06, y - 0.06), (-0.3, y + 0.08), (-0.3, y + 0.06)],
                      -width / 2, width / 2, 'oak', caps=False)
        y += 0.2


def door(shape, frame):
    """The tower door: boarded oak at the back of its arch, with iron strap hinges and a ring."""
    d = DOOR
    back = -0.55
    joinery.fill(shape, frame, 'gothic', d['width'], d['height'], back, 'oak')
    for y in (0.5, 1.6, 2.5):
        for side in (-1, 1):
            xs = sorted((side * 0.1, side * (d['width'] / 2 - 0.02)))
            shape.block(frame, xs, (y, y + 0.06), (back, back + 0.012), 'iron', skip=('back',))
    ring = frame.at(0.25, 1.05, back + 0.02)
    shape.lathe(ring, frame.out, [(0, 0.05), (0.02, 0.05)], 'iron', sides=8)
    shape.pipe([frame.at(0.25 + 0.07 * math.sin(t), 1.05 - 0.07 * (1 - math.cos(t)), back + 0.035)
                for t in (math.pi * k / 6 - math.pi / 2 for k in range(7))], 0.009, 'iron', sides=5)


def clock(shape, frame, dials):
    """A clock's hands on its dial (the dial itself is lit, its own object in `dials`)."""
    size = CLOCK['size']
    centre = frame.moved(0, size / 2, -0.04)
    points = joinery.outline('circle', size, size)
    dials.append(([frame.at(x, y, -0.04) for x, y in points],
                  [((x + size / 2) / size, y / size) for x, y in points]))
    hours, minutes = CLOCK['time']
    for angle, length, wide, lift in (((hours + minutes / 60) * 30, 0.45, 0.06, 0.012),
                                      (minutes * 6, 0.68, 0.04, 0.024)):
        a = math.radians(angle)
        along = centre.up * math.cos(a) + centre.right * math.sin(a)
        hand = Frame(centre.origin, along, centre.out)
        shape.block(hand, (-0.12, length), (-wide / 2, wide / 2), (lift, lift + 0.01), 'iron', skip=('back',))
    shape.lathe(centre.at(0, 0, 0), centre.out, [(0, 0.05), (0.045, 0.05), (0.05, 0.02)], 'iron', sides=10)


def face(shape, name, frame, dials):
    """One face's openings, buttresses and wall. Returns nothing; the wall is cut round what is in it."""
    holes = []

    def opening(x, y, kind, width, height, margin, proud, reveal):
        box = joinery.arched(shape, frame.moved(x, y), kind, width, height, 'ashlar', 'stone', margin, proud, reveal)
        holes.append((box[0] + x, box[1] + x, box[2] + y, box[3] + y))
        return frame.moved(x, y)

    if name == 'south':
        d = DOOR
        door(shape, opening(0, d['foot'], 'gothic', d['width'], d['height'], d['margin'], 0.14, 0.55))
        lancet = opening(0, 10.3, 'gothic', 0.9, 3.0, 0.16, 0.1, 0.3)
        joinery.fill(shape, lancet, 'gothic', 0.9, 3.0, -0.3, 'glass')
        for y in (0.9, 1.8):
            shape.block(lancet, (-0.45, 0.45), (y, y + 0.025), (-0.28, -0.255), 'iron', skip=('back',))
    else:
        lancet = opening(0, 11.0, 'gothic', 0.55, 1.8, 0.14, 0.08, 0.3)
        joinery.fill(shape, lancet, 'gothic', 0.55, 1.8, -0.3, 'glass')
    clock(shape, opening(0, CLOCK['centre'] - CLOCK['size'] / 2, 'circle', CLOCK['size'], CLOCK['size'], 0.18, 0.1,
                         0.06), dials)
    for x in (-0.62, 0.62):
        louvres(shape, opening(x, 18.3, 'gothic', 0.85, 3.2, 0.14, 0.1, 0.4), 0.85, 3.2)
    for x0, x1 in ((-HALF, -HALF + 0.8), (HALF - 0.8, HALF)):
        buttress(shape, frame, x0, x1)
    joinery.holed(shape, frame, (-HALF, HALF), (-0.5, PARAPET[0]), holes, 'ashlar')


def parapet(shape):
    """The battlements: a solid wall, merlons on it, all coped in stone."""
    inside = 0.35
    for name, frame in FACES.items():
        reach = HALF if name in ('south', 'north') else HALF - inside
        shape.block(frame, (-reach, reach), (PARAPET[0], PARAPET[1] - 0.07), (-inside, 0), 'ashlar', skip=('bottom',))
        cap = reach + 0.04 if name in ('south', 'north') else reach - 0.04
        shape.block(frame, (-cap, cap), (PARAPET[1] - 0.07, PARAPET[1]), (-inside - 0.04, 0.04), 'stone')
        for x in (-1.7, 0, 1.7):
            shape.block(frame, (x - 0.45, x + 0.45), (PARAPET[1], PARAPET[2] - 0.08), (-inside, 0), 'ashlar',
                        skip=('bottom',))
            shape.block(frame, (x - 0.49, x + 0.49), (PARAPET[2] - 0.08, PARAPET[2]), (-inside - 0.04, 0.04),
                        'stone')
    shape.face([(-HALF + inside, -HALF + inside, PARAPET[0]), (HALF - inside, -HALF + inside, PARAPET[0]),
                (HALF - inside, HALF - inside, PARAPET[0]), (-HALF + inside, HALF - inside, PARAPET[0])], 'stone',
               (0, 0, 1))


def pinnacles(shape):
    for cx in (-HALF, HALF):
        for cy in (-HALF, HALF):
            s = 0.42
            shape.box((cx - s, cy - s, 25.3), (cx + s, cy + s, 28.6), 'ashlar', skip=('bottom',))
            shape.box((cx - s - 0.05, cy - s - 0.05, 28.6), (cx + s + 0.05, cy + s + 0.05, 28.76), 'stone')
            apex = Vector((cx, cy, 30.7))
            corners = [Vector((cx + x, cy + y, 28.76)) for x, y in ((-s, -s), (s, -s), (s, s), (-s, s))]
            for a, b in zip(corners, corners[1:] + corners[:1]):
                shape.face([a, b, apex], 'ashlar', (a + b) / 2 - Vector((cx, cy, 28.76)))
            shape.lathe((cx, cy, 30.55), (0, 0, 1), [(0, 0.05), (0.1, 0.11), (0.22, 0.1), (0.32, 0.0)], 'stone',
                        sides=8, caps=(False, False))


def octagon(z, radius):
    return [Vector((radius * math.cos(a), radius * math.sin(a), z))
            for a in (math.radians(22.5 + 45 * k) for k in range(8))]


def spire(shape):
    """An octagonal stone spire from inside the parapet, two bands round it, an iron cross on top."""
    base, apex = PARAPET[0], PARAPET[0] + SPIRE
    radius = 2.3 / math.cos(math.radians(22.5))
    at = lambda z: radius * (apex - z) / (apex - base)
    ring = octagon(base, radius)
    tip = Vector((0, 0, apex))
    for a, b in zip(ring, ring[1:] + ring[:1]):
        shape.face([a, b, tip], 'ashlar', (a + b) / 2)
    for z in (base + SPIRE * 0.3, base + SPIRE * 0.62):
        low, high = octagon(z, at(z) + 0.08), octagon(z + 0.28, at(z + 0.28) + 0.08)
        inner_low, inner_high = octagon(z, at(z)), octagon(z + 0.28, at(z + 0.28))
        for k in range(8):
            n = (k + 1) % 8
            shape.face([low[k], low[n], high[n], high[k]], 'stone', (low[k] + low[n]) / 2)
            shape.face([inner_low[k], inner_low[n], low[n], low[k]], 'stone', (0, 0, -1))
            shape.face([high[k], high[n], inner_high[n], inner_high[k]], 'stone', (0, 0, 1))
    shape.box((-0.035, -0.035, apex - 0.4), (0.035, 0.035, apex + 1.7), 'iron')
    shape.box((-0.4, -0.03, apex + 1.12), (0.4, 0.03, apex + 1.18), 'iron')


def tower():
    """The tower's shape and its four lit clock dials."""
    shape, dials = Shape(), []
    for name, frame in FACES.items():
        face(shape, name, frame, dials)
    gap = (-DOOR['width'] / 2 - DOOR['margin'], DOOR['width'] / 2 + DOOR['margin'])
    band(shape, -0.5, 0.75, 0.15, 'ashlar', gap)
    band(shape, 0.75, 0.9, 0.18, 'stone', gap)
    for y in (8.8, 16.8):
        band(shape, y, y + 0.2, 0.1, 'stone')
    band(shape, 25.3, PARAPET[0], 0.18, 'stone')
    parapet(shape)
    pinnacles(shape)
    spire(shape)
    shape.box((-1.4, -HALF - 1.1, -0.5), (1.4, -HALF, DOOR['foot']), 'stone', skip=('back',))
    return shape, dials
