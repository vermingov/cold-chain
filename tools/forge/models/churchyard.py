"""The churchyard's own buildings (src/yard/built.js, src/map/plan.js BUILDINGS): the chapel of rest and the sexton's
lodge, each as one model with real openings, doors and windows.

Each stands with the middle of its footprint at the origin, at the ground under that middle, its sides to the game's
compass: Blender +x is the game's east, +y its north. So the chapel's door looks -y (south, down the avenue) and
the lodge's +x (east, onto the avenue).
"""

from mathutils import Vector

from shape import Frame, Shape
import joinery
import terrace


def walls(half_x, half_y):
    """The four faces of a rectangle, south, east, north, west, as frames at the middle of their feet."""
    return [Frame((0, -half_y, 0), (1, 0, 0), (0, -1, 0)), Frame((half_x, 0, 0), (0, 1, 0), (1, 0, 0)),
            Frame((0, half_y, 0), (-1, 0, 0), (0, 1, 0)), Frame((-half_x, 0, 0), (0, -1, 0), (-1, 0, 0))]


def slopes(shape, half, x0, x1, eaves, rise, ridge_x, eave, lift=0.06):
    """A pitched slate roof `half` from its ridge to each eaves, from x0 to x1 along its ridge (along x if `ridge_x`,
    else along y), the slates `eave` past the walls. Returns the frames of its two eaves and its pitch."""
    pitch = rise / half
    profile = [(eave, eaves - eave * pitch), (-half, eaves + rise), (-half, eaves + rise + lift),
               (eave, eaves - eave * pitch + lift)]
    if ridge_x:
        sides = [Frame((0, -half, 0), (1, 0, 0), (0, -1, 0)), Frame((0, half, 0), (-1, 0, 0), (0, 1, 0))]
    else:
        sides = [Frame((half, 0, 0), (0, 1, 0), (1, 0, 0)), Frame((-half, 0, 0), (0, -1, 0), (-1, 0, 0))]
    shape.extrude(sides[0], profile, x0, x1, 'slate')
    shape.extrude(sides[1], profile, -x1, -x0, 'slate')
    return sides, pitch


def quoins(shape, corner, inward, foot, top):
    """Dressed corner stones, long and short by turns, up a brick corner at `corner`; `inward` is the way in."""
    (x, y), (ix, iy) = corner, inward
    course, proud = 0.3, 0.025
    z, i = foot, 0
    while z + course <= top:
        along_x, along_y = (0.24, 0.46) if i % 2 else (0.46, 0.24)
        xs, ys = sorted((x - ix * proud, x + ix * along_x)), sorted((y - iy * proud, y + iy * along_y))
        shape.box((xs[0], ys[0], z), (xs[1], ys[1], z + course), 'stone', skip=('bottom',))
        z, i = z + course + 0.015, i + 1


def gable_copings(shape, half, ys, eaves, top, eave, pitch):
    """Stone copings up both slopes of the gable walls at each y in `ys`, which stand over the slates."""
    foot = eaves - 0.12 * pitch
    for y in ys:
        inward = (-0.36, 0.06) if y < 0 else (-0.06, 0.36)
        for a, b in (((-half - 0.12, foot), (0, top)), ((0, top), (half + 0.12, foot))):
            start, end = Vector((a[0], y, a[1])), Vector((b[0], y, b[1]))
            frame = Frame(start, end - start, (0, -1, 0))
            shape.block(frame, (0, (end - start).length), (0, 0.17), inward, 'stone')


# --- the chapel of rest -------------------------------------------------------------------------------------------

CHAPEL = {'size': (9.0, 14.0), 'eaves': 4.2, 'rise': 4.6, 'eave': 0.25, 'gable': 0.25}


def bellcote(shape, apex, y):
    """Two piers on the south gable's apex, a head over them, a little slated roof, the bell between."""
    shape.box((-0.62, y, apex - 0.9), (0.62, y + 0.5, apex + 0.35), 'ashlar')
    for side in (-1, 1):
        xs = sorted((side * 0.36, side * 0.62))
        shape.box((xs[0], y, apex + 0.35), (xs[1], y + 0.5, apex + 1.35), 'ashlar', skip=('bottom', 'top'))
    shape.box((-0.68, y - 0.05, apex + 1.35), (0.68, y + 0.55, apex + 1.55), 'stone')
    for frame in (Frame((0, y + 0.25, 0), (0, 1, 0), (1, 0, 0)), Frame((0, y + 0.25, 0), (0, -1, 0), (-1, 0, 0))):
        shape.extrude(frame, [(0.76, apex + 1.52), (0.0, apex + 2.1), (0.0, apex + 2.15), (0.76, apex + 1.57)],
                      -0.36, 0.36, 'slate')
    shape.lathe((0, y + 0.25, apex + 1.34), (0, 0, -1), [(0, 0.025), (0.12, 0.09), (0.24, 0.14), (0.4, 0.17),
                                                        (0.54, 0.24)], 'iron', sides=12)


def lancet(shape, panes, frame):
    """A lancet's glass and lit pane at the back of its reveal, two saddle bars across it, a sill under it."""
    shape.block(frame, (-0.5, 0.5), (-0.12, 0), (-0.05, 0.16), 'stone', skip=('back',))
    joinery.fill(shape, frame, 'gothic', 0.62, 2.0, -0.25, 'glass')
    joinery.fill_pane(panes, frame, 'gothic', 0.62, 2.0, -0.247, 'hall')
    for y in (0.65, 1.3):
        shape.block(frame, (-0.31, 0.31), (y, y + 0.02), (-0.24, -0.225), 'iron', skip=('back',))


def chapel():
    """The chapel of rest: ashlar under a steep slate roof between coped gables, buttressed, lancets down both
    sides, the door to the avenue under a round window and a bellcote, the cold room's own door on the east."""
    c = CHAPEL
    shape, panes = Shape(), []
    hx, hy = c['size'][0] / 2, c['size'][1] / 2
    eaves, rise = c['eaves'], c['rise']
    faces = walls(hx, hy)
    south, north = faces[0], faces[2]
    holes = [[] for _ in faces]

    def arched(i, x, y, kind, width, height, margin, proud, reveal):
        frame = faces[i].moved(x, y)
        box = joinery.arched(shape, frame, kind, width, height, 'ashlar', 'stone', margin, proud, reveal)
        holes[i].append((box[0] + x, box[1] + x, box[2] + y, box[3] + y))
        return frame

    for i in (1, 3):
        for x in (-hy + c['size'][1] / 6 + 0.4, 0, hy - c['size'][1] / 6 - 0.4):
            if not (i == 1 and x > 0):          # the cold room, at the north end, has no window
                lancet(shape, panes, arched(i, x, 1.45, 'gothic', 0.62, 2.0, 0.14, 0.1, 0.25))
        for x in (-hy + 0.3, -hy + c['size'][1] / 3, hy - c['size'][1] / 3, hy - 0.3):
            shape.extrude(faces[i], [(0, -0.6), (0.7, -0.6), (0.7, 2.9), (0.45, 3.05), (0.45, 3.6), (0, 3.8)],
                          x - 0.3, x + 0.3, 'ashlar')

    door = arched(0, 0, 0.3, 'gothic', 1.8, 3.2, 0.32, 0.28, 0.5)
    joinery.fill(shape, door, 'gothic', 1.8, 3.2, -0.5, 'oak')
    shape.block(door, (-0.012, 0.012), (0, 3.1), (-0.5, -0.482), 'iron', skip=('back',))
    for y in (0.45, 1.25, 2.2):
        for side in (-1, 1):
            xs = sorted((side * 0.05, side * 0.86))
            shape.block(door, xs, (y, y + 0.07), (-0.5, -0.478), 'iron', skip=('back',))
    shape.box((-1.9, -hy - 1.4, -0.3), (1.9, -hy, 0.15), 'stone', skip=('back',))
    shape.box((-1.6, -hy - 0.9, 0.15), (1.6, -hy, 0.3), 'stone', skip=('back',))
    oculus = faces[0].moved(0, eaves + 1.0)
    window = joinery.arched(shape, oculus, 'circle', 1.1, 1.1, 'ashlar', 'stone', 0.17, 0.1, 0.25)
    joinery.fill(shape, oculus, 'circle', 1.1, 1.1, -0.25, 'glass')
    joinery.fill_pane(panes, oculus, 'circle', 1.1, 1.1, -0.247, 'hall')

    cold = arched(1, 4.5, 0.12, 'square', 1.0, 2.05, 0.12, 0.08, 0.2)
    joinery.fill(shape, cold, 'square', 1.0, 2.05, -0.2, 'oak')
    for y in (0.3, 1.0, 1.7):
        shape.block(cold, (-0.5, 0.5), (y, y + 0.12), (-0.2, -0.17), 'oak', skip=('back',))
    shape.box((hx, 4.5 - 0.8, -0.3), (hx + 0.9, 4.5 + 0.8, 0.12), 'stone', skip=('left',))
    lamp = Vector((hx + 0.3, 4.5, 2.5))
    shape.box((hx, 4.5 - 0.015, 2.68), (lamp.x + 0.02, 4.5 + 0.015, 2.72), 'iron', skip=('left',))
    shape.lathe(lamp + Vector((0, 0, 0.2)), (0, 0, -1), [(0, 0.02), (0.08, 0.05), (0.18, 0.15), (0.2, 0.15)],
                'iron', sides=10)

    gable = eaves + rise + 0.1
    for i, frame in enumerate(faces):
        half = hx if i in (0, 2) else hy
        joinery.holed(shape, frame, (-half, half), (-0.6, eaves), holes[i], 'ashlar')
    joinery.gable_wall(shape, south, hx, eaves, gable, 'ashlar', (window[0], window[1], window[2] + eaves + 1.0,
                                                                    window[3] + eaves + 1.0))
    joinery.gable_wall(shape, north, hx, eaves, gable, 'ashlar')

    plinth = [(frame, hx if i in (0, 2) else hy, i in (0, 2)) for i, frame in enumerate(faces)]
    gaps = {0: [(-1.22, 1.22)], 1: [(4.5 - 0.62, 4.5 + 0.62)]}
    joinery.course(shape, plinth, -0.6, 0.55, 0.12, 'ashlar', gaps)
    joinery.course(shape, plinth, 0.55, 0.63, 0.14, 'stone', gaps)

    inner = hy - c['gable']
    sides, pitch = slopes(shape, hx, -inner, inner, eaves, rise, False, c['eave'])
    for frame in sides:
        terrace.eaves_line(shape, frame, eaves, -inner, inner, c['eave'], pitch, corbel='stone')
        for x in (-hy + 1.3, hy - 1.3):
            terrace.downpipe(shape, frame, x, eaves, c['eave'], pitch)
    gable_copings(shape, hx, (-hy, hy), eaves, eaves + rise + 0.06, c['eave'], pitch)
    for side in (-1, 1):
        for y in (-hy, hy - 0.5):
            x = side * (hx + 0.1)
            shape.box((x - 0.24, y - 0.05, eaves - 0.42), (x + 0.24, y + 0.55, eaves + 0.12), 'stone')
    shape.box((-0.11, -inner, eaves + rise + 0.02), (0.11, inner, eaves + rise + 0.14), 'stone')
    bellcote(shape, eaves + rise, -hy - 0.02)      # proud of the gable, not in its plane
    cross = eaves + rise + 0.15
    shape.box((-0.06, hy - 0.26, cross), (0.06, hy - 0.14, cross + 0.95), 'stone', skip=('bottom',))
    shape.box((-0.28, hy - 0.26, cross + 0.6), (0.28, hy - 0.14, cross + 0.72), 'stone')
    return shape, panes


# --- the sexton's lodge -------------------------------------------------------------------------------------------

LODGE = {'size': (9.0, 6.5), 'eaves': 2.7, 'rise': 2.5, 'eave': 0.35}


def lodge():
    """The sexton's lodge: brick with stone quoins under a slate roof with bargeboards, its chimney at the west end,
    its door and two windows on the avenue (the one south of the door is the one with the light in it), and one
    window looking at the gate."""
    c = LODGE
    shape, panes = Shape(), []
    hx, hy = c['size'][0] / 2, c['size'][1] / 2
    eaves, rise = c['eaves'], c['rise']
    faces = walls(hx, hy)
    south, east, west = faces[0], faces[1], faces[3]
    holes = [[] for _ in faces]

    def put(i, x, y, hole):
        holes[i].append((hole[0] + x, hole[1] + x, hole[2] + y, hole[3] + y))

    put(1, 0, 0.1, joinery.front_door(shape, east.moved(0, 0.1), panes, 'paint_door_green', width=0.9, height=2.0,
                                      reveal=0.15, fanlight=False, step=(0.1, 0.55)))
    for x, cell in ((-1.9, 'parlour'), (1.9, 'curtains')):
        put(1, x, 0.9, joinery.sash_window(shape, east.moved(x, 0.9), 1.15, 1.2, 'brick', panes, cell))
    put(0, -1.75, 0.95, joinery.sash_window(shape, south.moved(-1.75, 0.95), 1.1, 1.15, 'brick', panes))

    for i, frame in enumerate(faces):
        half = hx if i in (0, 2) else hy
        joinery.holed(shape, frame, (-half, half), (-0.5, eaves), holes[i], 'brick')
    for frame in (east, west):
        joinery.gable_wall(shape, frame, hy, eaves, eaves + rise, 'brick')
    plinth = [(frame, hx if i in (0, 2) else hy, i in (0, 2)) for i, frame in enumerate(faces)]
    joinery.course(shape, plinth, -0.5, 0.4, 0.05, 'brick', {1: [(-0.6, 0.6)]})
    for corner, inward in (((-hx, -hy), (1, 1)), ((hx, -hy), (-1, 1)), ((-hx, hy), (1, -1)), ((hx, hy), (-1, -1))):
        quoins(shape, corner, inward, 0.4, eaves - 0.05)

    verge = 0.35
    sides, pitch = slopes(shape, hy, -hx - verge, hx + verge, eaves, rise, True, c['eave'])
    for frame in sides:
        terrace.eaves_line(shape, frame, eaves, -hx - verge, hx + verge, c['eave'], pitch, corbel=None)
        for x in (-hx + 0.4, hx - 0.4):
            terrace.downpipe(shape, frame, x, eaves, c['eave'], pitch)
    for x in (-hx - 0.33, hx + 0.33):
        under = eaves - c['eave'] * pitch
        for y0 in (-hy - c['eave'], hy + c['eave']):
            start, end = Vector((x, y0, under)), Vector((x, 0, eaves + rise))
            frame = Frame(start, end - start, (1 if y0 < 0 else -1, 0, 0))
            shape.block(frame, (0, (end - start).length), (-0.2, 0), (-0.0225, 0.0225), 'oak')
    stack = (-hx + 1.0, -hx + 1.7)
    top = eaves + rise + 1.1
    shape.box((stack[0], -0.35, eaves + 1.2), (stack[1], 0.35, top), 'brick', skip=('bottom',))
    shape.box((stack[0] - 0.06, -0.41, top), (stack[1] + 0.06, 0.41, top + 0.12), 'stone')
    for y in (-0.16, 0.16):
        x = sum(stack) / 2
        shape.lathe((x, y, top + 0.1), (0, 0, 1), [(0, 0.11), (0.3, 0.095), (0.32, 0.115), (0.4, 0.115)],
                    'terracotta', sides=10)
    crown = eaves + rise + 0.06
    shape.extrude(Frame((0, 0, 0), (1, 0, 0), (0, -1, 0)),
                  [(0.1 * c_, crown - 0.02 + 0.1 * s) for c_, s in ((1, 0), (0.7, 0.7), (0, 1), (-0.7, 0.7), (-1, 0))],
                  -hx - verge, hx + verge, 'ridge', smooth=True)
    return shape, panes
