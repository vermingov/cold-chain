"""Ground floors that are more than a door and a window: a canted bay, and a Victorian shop front.

Both are built on the module's front frame (x across the front, y up, d out toward the street) and return the hole
they need in the brick front wall.
"""

from mathutils import Vector

from shape import Frame, UP
import joinery
import surfaces

BAY = {'depth': 0.6, 'base': 0.75, 'sill': 0.83, 'head': 2.45, 'fascia': 2.7, 'cornice': 2.8, 'pitch': 0.6}
POST = 0.07


def _offset(plan, by):
    """The plan [(x, y)] pushed out from the wall line (y = 0) by `by`, its ends staying on the wall line."""
    out = []
    for i, p in enumerate(plan):
        normals = []
        if i > 0:
            normals.append(_outward(plan[i - 1], p))
        if i < len(plan) - 1:
            normals.append(_outward(p, plan[i + 1]))
        n = sum(normals, Vector((0, 0))).normalized()
        scale = 1 / max(0.5, n.dot(normals[0]))
        q = Vector(p) + n * by * scale
        out.append((q.x, 0.0) if i in (0, len(plan) - 1) else (q.x, q.y))
    return out


def _outward(a, b):
    edge = Vector(b) - Vector(a)
    return Vector((edge.y, -edge.x)).normalized()


def bay(shape, panes, x0, x1):
    """A canted bay window from x0 to x1 along the wall: a brick base, a stone sill band, three sash windows
    between painted posts, a fascia and cornice, and a slated roof up to the wall. Returns its hole in the wall."""
    b, depth = BAY, BAY['depth']
    plan = [(x0, 0.0), (x0 + depth, -depth), (x1 - depth, -depth), (x1, 0.0)]
    shape.prism(plan, -0.5, b['base'], 'brick', caps=(False, False))
    shape.prism(_offset(plan, 0.05), b['base'], b['sill'], 'stone', caps=(True, True))

    for (ax, ay), (bx, by) in zip(plan, plan[1:]):
        a, c = Vector((ax, ay, 0)), Vector((bx, by, 0))
        right = (c - a).normalized()
        face = Frame(((a + c) / 2) + UP * b['sill'], right, right.cross(UP))
        width = (c - a).length - 2 * POST
        joinery.sash_window(shape, face, width, b['head'] - b['sill'], 'paint_frame', panes, 'parlour', reveal=0,
                            sill=False, head=False, bars=0)
    for i, p in enumerate(plan):
        normals = [_outward(plan[k], plan[k + 1]) for k in (i - 1, i) if 0 <= k < len(plan) - 1]
        along = [(Vector(plan[k + 1]) - Vector(plan[k])).normalized() for k in (i - 1, i) if 0 <= k < len(plan) - 1]
        n = sum(normals, Vector((0, 0))).normalized()
        q = Vector(p)
        if len(along) == 1:
            post = [q, q + along[0] * POST, q + along[0] * POST + n * 0.03, q + n * 0.03]
            if i > 0:
                post = [q - along[0] * POST, q, q + n * 0.03, q - along[0] * POST + n * 0.03]
        else:
            post = [q - along[0] * POST, q - n * 0.02, q + along[1] * POST, q + n * 0.04]
        shape.prism([tuple(v) for v in post], b['sill'], b['head'], 'paint_frame', caps=(False, False))

    shape.prism(_offset(plan, 0.02), b['head'], b['fascia'], 'paint_frame', caps=(True, False))
    eave = _offset(plan, 0.1)
    shape.prism(eave, b['fascia'], b['cornice'], 'paint_frame', caps=(True, False))
    top = b['cornice'] + (depth + 0.1) * b['pitch']
    p0, p1, p2, p3 = [Vector((x, y, b['cornice'])) for x, y in eave]
    q1, q2 = Vector((p1.x, 0, top)), Vector((p2.x, 0, top))
    shape.face([p0, p1, q1], 'slate', UP)
    shape.face([p1, p2, q2, q1], 'slate', UP)
    shape.face([p2, p3, q2], 'slate', UP)
    shape.extrude(Frame((0, 0, 0), (1, 0, 0), (0, -1, 0)), [(0, top - 0.04), (0.05, top - 0.03), (0, top + 0.03)],
                  p0.x, p3.x, 'iron')
    return (x0, x1, -0.5, top)


SHOP = {'riser': 0.55, 'cill': 0.63, 'transom': 2.45, 'head': 2.95, 'fascia': (3.0, 3.5), 'recess': (0.88, 2.4, 1.0)}


def shopfront(shape, panes, signs, front, paint='paint_shop', row=0):
    """A shop front across the ground floor: pilasters with consoles, a fascia and cornice, a panelled stall riser
    under a display window of three lights with transom lights over, and a glazed door at the back of a recessed
    entrance; the sign painted on the fascia (row `row` of the signs' picture) goes in `signs`. Returns its hole in
    the wall."""
    s = SHOP
    for side in (-1, 1):
        x = sorted((side * 2.4, side * 2.7))
        shape.block(front, x, (-0.5, 2.75), (0, 0.12), paint, skip=('back',))
        shape.block(front, (x[0] - 0.02, x[1] + 0.02), (-0.5, 0.35), (0, 0.15), paint, skip=('back',))
        shape.block(front, (x[0] + 0.02, x[1] - 0.02), (2.75, s['fascia'][0]), (0, 0.22), paint, skip=('back',))
    shape.block(front, (-2.7, 2.7), s['fascia'], (0, 0.18), paint, skip=('back',))
    shape.extrude(front, [(0, 3.5), (0.24, 3.5), (0.3, 3.56), (0.3, 3.6), (0, 3.68)], -2.72, 2.72, paint)
    board = [(-2.62, 3.03), (2.62, 3.03), (2.62, 3.47), (-2.62, 3.47)]
    signs.append(([front.at(x, y, 0.182) for x, y in board],
                  [surfaces.sign_uv(row, (x + 2.62) / 5.24, (y - 3.03) / 0.44) for x, y in board]))

    rx0, rx1, deep = s['recess']
    riser = front.moved(d=0.06)
    shape.block(front, (-2.4, rx0), (-0.5, s['riser']), (0, 0.06), paint, skip=('back', 'front'))
    panels = [(-2.3, -0.81, 0.08, 0.47), (-0.71, rx0 - 0.1, 0.08, 0.47)]
    joinery.holed(shape, riser, (-2.4, rx0), (-0.5, s['riser']), panels, paint)
    for rect in panels:
        joinery.fielded(shape, riser, rect, paint)

    shape.block(front, (-2.4, rx0), (s['riser'], s['cill']), (0, 0.09), paint, skip=('back',))
    shape.block(front, (-2.4, -2.32), (s['cill'], s['transom']), (0, 0.06), paint, skip=('back',))
    shape.block(front, (rx0 - 0.08, rx0), (s['cill'], s['transom']), (0, 0.06), paint, skip=('back',))
    lights = (-2.32, rx0 - 0.08)
    mullions = [lights[0] + (lights[1] - lights[0]) * k / 3 for k in (1, 2)]
    for m in mullions:
        shape.block(front, (m - 0.025, m + 0.025), (s['cill'], s['transom']), (0, 0.05), paint,
                    skip=('back', 'top', 'bottom'))
    shape.block(front, (-2.4, 2.4), (s['transom'], s['transom'] + 0.1), (0, 0.08), paint, skip=('back',))
    shape.block(front, (-2.4, 2.4), (s['head'], s['fascia'][0]), (0, 0.05), paint, skip=('back',))
    for m in mullions + [rx0 - 0.04, (rx0 + rx1) / 2]:
        shape.block(front, (m - 0.018, m + 0.018), (s['transom'] + 0.1, s['head']), (0, 0.04), paint,
                    skip=('back', 'top', 'bottom'))
    display = [(lights[0], s['cill']), (lights[1], s['cill']), (lights[1], s['transom']), (lights[0], s['transom'])]
    shape.face([front.at(x, y, -0.02) for x, y in display], 'glass', front.out)
    joinery.pane(panes, display, front.moved(d=-0.017), 'shop')
    over = [(-2.4, s['transom'] + 0.1), (2.4, s['transom'] + 0.1), (2.4, s['head']), (-2.4, s['head'])]
    shape.face([front.at(x, y, -0.02) for x, y in over], 'glass', front.out)

    # The way in: panelled sides, a ceiling, a stone floor, and the door at the back.
    floor = 0.05
    shape.block(front, (rx0, rx1), (-0.5, floor), (-deep, 0.02), 'stone', skip=('back', 'left', 'right'))
    shape.face([front.at(rx0, floor, 0), front.at(rx0, floor, -deep), front.at(rx0, s['transom'], -deep),
                front.at(rx0, s['transom'], 0)], paint, front.right)
    shape.face([front.at(rx1, floor, 0), front.at(rx1, s['transom'], 0), front.at(rx1, s['transom'], -deep),
                front.at(rx1, floor, -deep)], paint, -front.right)
    shape.face([front.at(rx0, s['transom'], 0), front.at(rx1, s['transom'], 0), front.at(rx1, s['transom'], -deep),
                front.at(rx0, s['transom'], -deep)], paint, -front.up)
    back = front.moved(d=-deep)
    door_x, door_w, door_h = (rx0 + rx1) / 2, 0.86, 2.25
    joinery.holed(shape, back, (rx0, rx1), (floor, s['transom']),
                  [(door_x - door_w / 2, door_x + door_w / 2, floor, floor + door_h)], paint)
    joinery.reveals(shape, back.moved(door_x, floor), door_w, 0, door_h, 0.08, paint)
    door = back.moved(door_x, floor, -0.03)
    joinery.leaf(shape, door, door_w - 0.006, door_h - 0.004, paint, panes, glazed=True)
    shape.lathe(door.at(door_w / 2 - 0.09, 1.0, 0), door.out, [(0, 0.028), (0.01, 0.028), (0.015, 0.01),
                                                               (0.04, 0.01), (0.05, 0.025), (0.07, 0.02)], 'brass',
                sides=8)
    return (-2.4, 2.4, -0.5, s['fascia'][0])
