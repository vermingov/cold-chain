"""Openings and what fills them: walls with holes in them, box sash windows, panelled doors in their cases, arched
openings in dressed stone, and the lit panes the game turns on and off.

Everything is placed by a `Frame` whose origin is the foot of the opening, in its middle, on the wall's face: x runs
along the wall, y up it, d out of it (so what is set back into the opening has d < 0). Nothing is laid over a wall:
the wall has a real hole, its reveals go back into the opening, and the window or the door stands at the back of
them.

A lit pane is not part of the building's mesh: each is a quad of its own (material `window_lit`) a few millimetres in
front of the window's dark glass and behind its sashes, so showing it lights the window and hiding it leaves the
glass dark.
"""

import math

import bpy

from shape import Frame, Shape
import surfaces

FRAME = 0.065       # the face of a sash box frame
GLASS = 0.085       # how far behind the back of the reveal the glass is
PANE = 0.082        # and the lit pane, just in front of it


def holed(shape, frame, xs, ys, holes, material, d=0.0):
    """A flat face from xs[0] to xs[1] along the frame and ys[0] to ys[1] up it, less the rectangles `holes`
    [(x0, x1, y0, y1)], cut into cells that meet edge to edge."""
    clip = lambda v, lo, hi: min(max(v, lo), hi)
    bx = sorted({clip(v, *xs) for h in holes for v in h[:2]} | set(xs))
    by = sorted({clip(v, *ys) for h in holes for v in h[2:]} | set(ys))
    for x0, x1 in zip(bx, bx[1:]):
        for y0, y1 in zip(by, by[1:]):
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if any(h[0] < cx < h[1] and h[2] < cy < h[3] for h in holes):
                continue
            shape.face([frame.at(x0, y0, d), frame.at(x1, y0, d), frame.at(x1, y1, d), frame.at(x0, y1, d)],
                       material, frame.out)


def ring(shape, frame, outer, d_outer, inner, d_inner, material):
    """Four faces from the rectangle `outer` (x0, x1, y0, y1) at d_outer in to `inner` at d_inner: a chamfer, a
    bevel, the sloping side of a panel."""
    def corners(r, d):
        return [frame.at(r[0], r[2], d), frame.at(r[1], r[2], d), frame.at(r[1], r[3], d), frame.at(r[0], r[3], d)]
    o, i = corners(outer, d_outer), corners(inner, d_inner)
    for k in range(4):
        n = (k + 1) % 4
        shape.face([o[k], o[n], i[n], i[k]], material, frame.out)


# --- lit panes ------------------------------------------------------------------------------------------------------

def pane(panes, points, frame, cell):
    """A lit pane over the polygon `points` (x, y in the frame), at its d. Its picture is the quarter `cell`."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    uvs = [surfaces.cell_uv(cell, (p[0] - min(xs)) / (max(xs) - min(xs)), (p[1] - min(ys)) / (max(ys) - min(ys)))
           for p in points]
    panes.append(([frame.at(*p) for p in points], uvs))


def build_panes(name, panes, materials, parent):
    """Each lit pane as an object of its own, a child of the building, named `<building>.pane.<n>`."""
    objects = []
    for n, (points, uvs) in enumerate(panes):
        mesh = bpy.data.meshes.new(f'{name}.pane.{n}')
        mesh.from_pydata([tuple(p) for p in points], [], [tuple(range(len(points)))])
        mesh.materials.append(materials[surfaces.LIT])
        layer = mesh.uv_layers.new(name='uv')
        for loop, uv in zip(mesh.polygons[0].loop_indices, uvs):
            layer.data[loop].uv = uv
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        objects.append(obj)
    return objects


# --- the parts round an opening in a brick wall -------------------------------------------------------------------

def reveals(shape, frame, width, y0, height, depth, wall, soffit=None, soffit_from=0.0):
    """The sides of an opening going back into the wall, and its head (`soffit` material, from `soffit_from`)."""
    w2 = width / 2
    shape.face([frame.at(-w2, y0, 0), frame.at(-w2, y0, -depth), frame.at(-w2, height, -depth),
                frame.at(-w2, height, 0)], wall, frame.right)
    shape.face([frame.at(w2, y0, 0), frame.at(w2, height, 0), frame.at(w2, height, -depth),
                frame.at(w2, y0, -depth)], wall, -frame.right)
    shape.face([frame.at(-w2, height, -soffit_from), frame.at(w2, height, -soffit_from), frame.at(w2, height, -depth),
                frame.at(-w2, height, -depth)], soffit or wall, -frame.up)


LINTEL = {'over': 0.1, 'tall': 0.22, 'back': 0.06, 'proud': 0.015}


def lintel(shape, frame, width, height):
    """A stone lintel over an opening, a little proud of the brick."""
    reach = width / 2 + LINTEL['over']
    shape.block(frame, (-reach, reach), (height, height + LINTEL['tall']), (-LINTEL['back'], LINTEL['proud']),
                'stone', skip=('back',))


def stone_sill(shape, frame, width, depth):
    """A stone sill under a window: its top falls to the front, its ends are built into the brick."""
    reach = width / 2 + 0.09
    shape.extrude(frame, [(-depth, -0.13), (0.055, -0.13), (0.055, -0.035), (-depth, 0.0)], -reach, reach, 'stone')


SILL_DROP = 0.035       # an opening with a stone sill has its hole in the wall this far below its foot


# --- sash windows -------------------------------------------------------------------------------------------------

def sash(shape, frame, x, y, d, bars, horns):
    """One sash: its stiles, rails and glazing bars in front of the glass. x, y, d are its extents."""
    stile, top, meeting, bottom = 0.05, 0.05, 0.035, 0.075
    rails = (bottom, meeting) if horns else (meeting, top)       # the upper sash meets the lower at its bottom rail
    drop = 0.06 if horns else 0.0
    for sx in ((x[0], x[0] + stile), (x[1] - stile, x[1])):
        shape.block(frame, sx, (y[0] - drop, y[1]), d, 'paint_frame', skip=('back',))
    shape.block(frame, (x[0] + stile, x[1] - stile), (y[0], y[0] + rails[1]), d, 'paint_frame', skip=('back',))
    shape.block(frame, (x[0] + stile, x[1] - stile), (y[1] - rails[0], y[1]), d, 'paint_frame', skip=('back',))
    thin = (d[0] + 0.006, d[1] - 0.008)
    for k in range(1, bars + 1):
        bx = x[0] + (x[1] - x[0]) * k / (bars + 1)
        shape.block(frame, (bx - 0.011, bx + 0.011), (y[0] + rails[1], y[1] - rails[0]), thin, 'paint_frame',
                    skip=('back', 'top', 'bottom'))


def sash_window(shape, frame, width, height, wall, panes, cell='curtains', reveal=0.11, sill=True, head=True,
                bars=1):
    """A box sash window, two sashes of `bars` + 1 lights each, filling an opening `width` by `height`. With a
    `reveal` it is set back in the wall under a stone lintel (`head`) and over a stone sill; with none it stands in a
    timber bay. Returns the hole to leave in the wall."""
    w2, back = width / 2, -reveal
    y0 = -SILL_DROP if sill else 0.0
    if reveal > 0:
        reveals(shape, frame, width, y0, height, reveal, wall, 'stone' if head else wall,
                LINTEL['back'] if head else 0.0)
    if head:
        lintel(shape, frame, width, height)
    if sill:
        stone_sill(shape, frame, width, reveal)

    box = (back - 0.1, back)
    shape.block(frame, (-w2, -w2 + FRAME), (0, height), box, 'paint_frame', skip=('back', 'left'))
    shape.block(frame, (w2 - FRAME, w2), (0, height), box, 'paint_frame', skip=('back', 'right'))
    shape.block(frame, (-w2 + FRAME, w2 - FRAME), (height - FRAME, height), box, 'paint_frame', skip=('back', 'top'))
    shape.block(frame, (-w2 + FRAME, w2 - FRAME), (0, 0.07), (back - 0.1, back + 0.02), 'paint_frame',
                skip=('back', 'bottom'))

    x = (-w2 + FRAME, w2 - FRAME)
    y = (0.07, height - FRAME)
    meet = (y[0] + y[1]) / 2
    sash(shape, frame, x, (meet - 0.0175, y[1]), (back - 0.035, back - 0.002), bars, horns=True)
    sash(shape, frame, x, (y[0], meet + 0.0175), (back - 0.075, back - 0.04), bars, horns=False)

    clear = [(x[0], y[0]), (x[1], y[0]), (x[1], y[1]), (x[0], y[1])]
    shape.face([frame.at(px, py, back - GLASS) for px, py in clear], 'glass', frame.out)
    pane(panes, clear, frame.moved(d=back - PANE), cell)
    return (-w2, w2, y0, height)


# --- doors --------------------------------------------------------------------------------------------------------

def fielded(shape, frame, rect, material):
    """A raised and fielded panel sunk in the rectangle `rect` (x0, x1, y0, y1) of a door's face."""
    def inset(r, by):
        return (r[0] + by, r[1] - by, r[2] + by, r[3] - by)
    sunk, field = -0.014, -0.006
    ring(shape, frame, rect, 0.0, inset(rect, 0.012), sunk, material)
    ring(shape, frame, inset(rect, 0.012), sunk, inset(rect, 0.03), sunk, material)
    ring(shape, frame, inset(rect, 0.03), sunk, inset(rect, 0.065), field, material)
    r = inset(rect, 0.065)
    shape.face([frame.at(r[0], r[2], field), frame.at(r[1], r[2], field), frame.at(r[1], r[3], field),
                frame.at(r[0], r[3], field)], material, frame.out)


def leaf(shape, frame, width, height, material, panes=None, glazed=False, thick=0.045):
    """A four-panelled door leaf, its face on the frame's origin plane, its foot at the origin. `glazed` puts glass
    (and a lit pane behind it) in place of the top two panels, as a shop door has."""
    w2 = width / 2
    stile, top, muntin = 0.115, 0.115, 0.1
    lock = (0.86, 1.06)
    bottom = 0.22
    lower = [(-w2 + stile, -muntin / 2, bottom, lock[0]), (muntin / 2, w2 - stile, bottom, lock[0])]
    upper = ([(-w2 + stile, w2 - stile, lock[1], height - top)] if glazed else
             [(-w2 + stile, -muntin / 2, lock[1], height - top), (muntin / 2, w2 - stile, lock[1], height - top)])
    holed(shape, frame, (-w2, w2), (0, height), lower + upper, material)
    shape.block(frame, (-w2, w2), (0, height), (-thick, 0), material, skip=('front', 'back', 'bottom'))
    for rect in lower + ([] if glazed else upper):
        fielded(shape, frame, rect, material)
    if glazed:
        x0, x1, y0, y1 = upper[0]
        ring(shape, frame, upper[0], 0.0, (x0 + 0.015, x1 - 0.015, y0 + 0.015, y1 - 0.015), -0.02, material)
        glass = [(x0 + 0.015, y0 + 0.015), (x1 - 0.015, y0 + 0.015), (x1 - 0.015, y1 - 0.015), (x0 + 0.015, y1 - 0.015)]
        shape.face([frame.at(px, py, -0.025) for px, py in glass], 'glass', frame.out)
        pane(panes, glass, frame.moved(d=-0.022), 'shop')
    return lock


def ironmongery(shape, frame, width, lock):
    """What a front door has on it: a letterbox in the lock rail, a knob and a knocker on the muntin, a keyhole."""
    w2 = width / 2
    shape.block(frame, (-0.13, 0.13), (lock[0] + 0.06, lock[0] + 0.135), (0, 0.006), 'brass', skip=('back',))
    shape.block(frame, (-0.11, 0.11), (lock[0] + 0.075, lock[0] + 0.12), (0.006, 0.01), 'brass', skip=('back',))
    knob = frame.at(0, lock[1] + 0.22, 0)
    shape.lathe(knob, frame.out, [(0, 0.032), (0.008, 0.032), (0.012, 0.011), (0.035, 0.011), (0.042, 0.026),
                                  (0.058, 0.03), (0.07, 0.024), (0.076, 0.012)], 'brass', sides=10)
    shape.block(frame, (-0.035, 0.035), (1.47, 1.6), (0, 0.012), 'brass', skip=('back',))
    hinge = (1.585, 0.024)
    hoop = [frame.at(0.05 * math.cos(t), hinge[0] - 0.05 * math.sin(t) - 0.04 * math.sin(t) ** 2, hinge[1])
            for t in (math.pi * k / 8 for k in range(9))]
    shape.pipe(hoop, 0.008, 'brass', sides=6)
    shape.block(frame, (w2 - 0.08, w2 - 0.05), (lock[0] + 0.02, lock[0] + 0.1), (0, 0.004), 'brass', skip=('back',))


def front_door(shape, frame, panes, door, wall='brick', width=1.0, height=2.45, reveal=0.22, fanlight=True,
               step=(0.18, 0.34), head=True, knocker=True):
    """A panelled front door in its frame, set back in the wall under a fanlight, on a stone step. The frame's origin
    is the threshold, in the middle of the opening, on the wall's face; `step` is how high the step stands over the
    ground and how far it comes out. Returns the hole to leave in the wall."""
    w2, back = width / 2, -reveal
    jamb, case = 0.07, (back - 0.12, back)
    reveals(shape, frame, width, 0.0, height, reveal, wall, 'stone' if head else wall,
            LINTEL['back'] if head else 0.0)
    if head:
        lintel(shape, frame, width, height)
    shape.block(frame, (-w2, -w2 + jamb), (0, height), case, 'paint_frame', skip=('back', 'left'))
    shape.block(frame, (w2 - jamb, w2), (0, height), case, 'paint_frame', skip=('back', 'right'))
    shape.block(frame, (-w2 + jamb, w2 - jamb), (height - jamb, height), case, 'paint_frame', skip=('back', 'top'))

    door_height = 2.0 if fanlight else height - jamb
    if fanlight:
        transom = (door_height, door_height + 0.065)
        shape.block(frame, (-w2 + jamb, w2 - jamb), transom, (back - 0.12, back + 0.015), 'paint_frame',
                    skip=('back',))
        light = [(-w2 + jamb, transom[1]), (w2 - jamb, transom[1]), (w2 - jamb, height - jamb),
                 (-w2 + jamb, height - jamb)]
        for k in (-1, 1):
            bx = k * (w2 - jamb) / 3
            shape.block(frame, (bx - 0.012, bx + 0.012), (transom[1], height - jamb), (back - 0.06, back - 0.03),
                        'paint_frame', skip=('back', 'top', 'bottom'))
        shape.face([frame.at(px, py, back - GLASS) for px, py in light], 'glass', frame.out)
        pane(panes, light, frame.moved(d=back - PANE), 'hall')

    leaf_width = width - 2 * jamb - 0.006
    face = frame.moved(d=back - 0.03)
    lock = leaf(shape, face, leaf_width, door_height - 0.004, door)
    if knocker:
        ironmongery(shape, face, leaf_width, lock)

    high, out = step
    shape.block(frame, (-w2 - 0.15, w2 + 0.15), (-high - 0.3, 0), (back - 0.03, out), 'stone', skip=('back',))
    return (-w2, w2, 0.0, height)


# --- arched openings in dressed stone -------------------------------------------------------------------------------

def outline(kind, width, height, steps=8):
    """An opening's outline from the foot of its left side, up and round its head, to the foot of its right side:
    'square', 'round' (a semicircular head), 'gothic' (an equilateral pointed arch) or 'circle' (round, closed)."""
    w2 = width / 2
    if kind == 'square':
        return [(-w2, 0), (-w2, height), (w2, height), (w2, 0)]
    if kind == 'circle':
        return [(w2 * math.cos(t), height / 2 + w2 * math.sin(t))
                for t in (math.pi - 2 * math.pi * k / (4 * steps) for k in range(4 * steps))]
    if kind == 'round':
        spring = height - w2
        head = [(w2 * math.cos(t), spring + w2 * math.sin(t)) for t in (math.pi * (1 - k / (2 * steps))
                                                                        for k in range(2 * steps + 1))]
    else:
        spring = height - width * math.sin(math.pi / 3)
        left = [(w2 + width * math.cos(t), spring + width * math.sin(t))
                for t in (math.pi - (math.pi / 3) * k / steps for k in range(steps + 1))]
        head = left + [(-x, y) for x, y in reversed(left[:-1])]
    return [(-w2, 0)] + head + [(w2, 0)]


def arched(shape, frame, kind, width, height, wall, dressing='stone', margin=0.14, proud=0.08, reveal=0.25):
    """An opening in a stone wall with dressed stone round it standing `proud` of the wall and `margin` wide, its
    reveals going `reveal` back. Fills the corners between its outline and the rectangle round it with `wall`, so
    the hole to leave in the wall (returned) is that rectangle. What fills the opening is the caller's, at d=-reveal."""
    closed = kind == 'circle'
    inner = outline(kind, width, height)
    outer = outline(kind, width + 2 * margin, height + (2 if closed else 1) * margin)
    if closed:
        outer = [(x, y - margin) for x, y in outer]
    xs, ys = [p[0] for p in outer], [p[1] for p in outer]
    box = (min(xs), max(xs), min(ys), max(ys))

    # The wall in the corners round the dressed stone: each length of the head fanned to the box's nearest corner.
    if kind != 'square':
        head = outer if closed else [p for p in outer if p[1] > 1e-6]
        middle_y = (box[2] + box[3]) / 2
        for a, b in zip(head, head[1:] + (head[:1] if closed else [])):
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            corner = (box[1] if mx > 0 else box[0], box[2] if closed and my < middle_y else box[3])
            shape.face([frame.at(*corner), frame.at(*a), frame.at(*b)], wall, frame.out)

    pairs = list(zip(range(len(inner)), list(range(1, len(inner))) + ([0] if closed else [])))
    middle = frame.at(0, (min(p[1] for p in inner) + max(p[1] for p in inner)) / 2)
    for i, j in pairs:
        shape.face([frame.at(*outer[i], proud), frame.at(*outer[j], proud), frame.at(*inner[j], proud),
                    frame.at(*inner[i], proud)], dressing, frame.out)
        a, b = frame.at(*inner[i]), frame.at(*inner[j])
        shape.face([frame.at(*inner[i], proud), frame.at(*inner[j], proud), frame.at(*inner[j], -reveal),
                    frame.at(*inner[i], -reveal)], dressing, middle - (a + b) / 2)
        a, b = frame.at(*outer[i]), frame.at(*outer[j])
        shape.face([frame.at(*outer[i], 0), frame.at(*outer[j], 0), frame.at(*outer[j], proud),
                    frame.at(*outer[i], proud)], dressing, (a + b) / 2 - middle)
    if not closed:
        for o, n in ((outer[0], inner[0]), (outer[-1], inner[-1])):
            shape.face([frame.at(o[0], 0, 0), frame.at(n[0], 0, 0), frame.at(n[0], 0, proud),
                        frame.at(o[0], 0, proud)], dressing, -frame.up)
    return box


def fill(shape, frame, kind, width, height, d, material):
    """The opening's outline as one face at d: glass, a door, the dark behind louvres."""
    shape.face([frame.at(x, y, d) for x, y in outline(kind, width, height)], material, frame.out)


def fill_pane(panes, frame, kind, width, height, d, cell='hall'):
    pane(panes, outline(kind, width, height), frame.moved(d=d), cell)
