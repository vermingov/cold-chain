"""The terraced houses round the churchyard, as modules that stand side by side (src/yard/town.js: HOUSE wide, STOREY
a floor, DEEP deep, ROOF from eaves to ridge).

A module is one house of a terrace in its own frame: x across the front from -HOUSE/2 to HOUSE/2, the front wall's
face at y=0 looking -y (to the street), the back wall's at y=DEEP, the ground at z=0 (walls go on 0.5 below it for a
slope). Its party walls are closed in brick up to the roof, so a house standing higher than its neighbour or alone
has no hole in it. Its chimney stack stands astride its left party wall (x=-HOUSE/2), so a row of them has a stack
between every two houses. A row is modules HOUSE apart along x; a gable end piece goes at the same place as the
house at each end of a row and closes its outer side.

Each also comes as a far version, a box with a roof and a stack carrying a picture of the near one baked onto it,
for the rows at 95 to 175 m.
"""

from shape import Frame, Shape
import fronts
import joinery

HOUSE, STOREY, DEEP, ROOF = 5.4, 2.8, 8.0, 2.6
HALF = HOUSE / 2
PITCH = ROOF / (DEEP / 2)
OVER = 0.1          # slates past the wall at the eaves
THICK = 0.05        # of the roof
LIFT = THICK * (1 + PITCH ** 2) ** 0.5
GABLE = 0.45        # an end gable wall, outside the module
STACK = (3.45, 4.55)

FRONT = Frame((0, 0, 0), (1, 0, 0), (0, -1, 0))
BACK = Frame((0, DEEP, 0), (-1, 0, 0), (0, 1, 0))
DOORS = ('green', 'red', 'blue', 'black')


# --- the shell --------------------------------------------------------------------------------------------------

def side_walls(shape, eaves, xs):
    """The walls at each x in `xs`, up into the roof as a gable, looking away from the middle."""
    for x in xs:
        shape.face([(x, 0, -0.5), (x, 0, eaves), (x, DEEP / 2, eaves + ROOF), (x, DEEP, eaves), (x, DEEP, -0.5)],
                   'brick', (x, 0, 0))


def roof(shape, eaves, x0, x1):
    """Both slopes in slate from x0 to x1, each a slab THICK deep over the walls and OVER past them, and the ridge."""
    under, top = eaves - OVER * PITCH, eaves + ROOF
    profile = [(OVER, under), (-DEEP / 2, top), (-DEEP / 2, top + LIFT), (OVER, under + LIFT)]
    shape.extrude(FRONT, profile, x0, x1, 'slate')
    shape.extrude(BACK, profile, -x1, -x0, 'slate')
    crown = top + LIFT
    arc = [(-DEEP / 2 + 0.12 * c, crown - 0.03 + 0.12 * s)
           for c, s in ((1, 0), (0.87, 0.5), (0.5, 0.87), (0, 1), (-0.5, 0.87), (-0.87, 0.5), (-1, 0))]
    shape.extrude(FRONT, arc, x0, x1, 'ridge', smooth=True)


def eaves_line(shape, frame, eaves, x0, x1, over=OVER, pitch=PITCH, corbel='brick'):
    """Two corbelled courses under the eaves (of `corbel`, or none) and a cast-iron ogee gutter under the edge of
    slates that come `over` past the wall at `pitch`, on iron brackets where it stands off the wall."""
    if corbel:
        shape.block(frame, (x0, x1), (eaves - 0.26, eaves - 0.07 * pitch), (0, 0.05), corbel, skip=('back',))
    t, d = _gutter_top(eaves, over, pitch), over - 0.05
    gutter = [(d, t), (d, t - 0.06), (d + 0.025, t - 0.095), (d + 0.07, t - 0.105), (d + 0.11, t - 0.085),
              (d + 0.122, t - 0.04), (d + 0.135, t - 0.012), (d + 0.135, t)]
    shape.extrude(frame, gutter, x0, x1, 'iron')
    if d > 0.08:
        for k in range(int((x1 - x0) / 0.9)):
            x = x0 + 0.45 + k * 0.9
            shape.block(frame, (x - 0.015, x + 0.015), (t - 0.1, t - 0.075), (0, d + 0.06), 'iron', skip=('back',))


def _gutter_top(eaves, over, pitch):
    return eaves - over * pitch - 0.025


def downpipe(shape, frame, x, eaves, over=OVER, pitch=PITCH):
    """A downpipe from the gutter, back to the wall by a swan neck and down it, held by its ears."""
    t, d = _gutter_top(eaves, over, pitch), over + 0.015
    shape.pipe([frame.at(x, t - 0.08, d), frame.at(x, t - 0.25, d), frame.at(x, t - 0.25 - (d - 0.06) * 3, 0.06),
                frame.at(x, -0.1, 0.06)], 0.035, 'iron')
    for y in range(1, int(t - 0.5), 2):
        shape.block(frame, (x - 0.05, x + 0.05), (y, y + 0.04), (0, 0.03), 'iron', skip=('back',))


def chimney(shape, eaves, x0, x1, pots=(0.55, 0.42, 0.62)):
    """A brick stack on the ridge from x0 to x1, two oversailing courses, its cement flaunching and its pots."""
    y0, y1 = STACK
    z0, z1 = eaves + (y0 - 0.25) * PITCH, eaves + ROOF + 1.1
    shape.box((x0, y0, z0), (x1, y1, z1), 'brick', skip=('bottom',))
    shape.box((x0 - 0.04, y0 - 0.04, z1), (x1 + 0.04, y1 + 0.04, z1 + 0.075), 'brick')
    shape.box((x0 - 0.075, y0 - 0.075, z1 + 0.075), (x1 + 0.075, y1 + 0.075, z1 + 0.15), 'brick')
    shape.box((x0 + 0.03, y0 + 0.03, z1 + 0.15), (x1 - 0.03, y1 - 0.03, z1 + 0.2), 'stone', skip=('bottom',))
    for k, tall in enumerate(pots):
        y = y0 + (y1 - y0) * (k + 0.5) / len(pots)
        shape.lathe(((x0 + x1) / 2, y, z1 + 0.17), (0, 0, 1),
                    [(0, 0.12), (0.05, 0.115), (tall - 0.09, 0.098), (tall - 0.07, 0.125), (tall, 0.125)],
                    'terracotta', sides=10)


# --- the fronts and backs ----------------------------------------------------------------------------------------

def place(holes, x, y, hole):
    holes.append((hole[0] + x, hole[1] + x, hole[2] + y, hole[3] + y))


def front_of(kind, shape, panes, signs, door):
    """The front wall's openings for a 'plain' house, one with a 'bay', or a 'shop' with two floors of flats over.
    Returns the holes in the wall."""
    holes = []
    if kind == 'shop':
        holes.append(fronts.shopfront(shape, panes, signs, FRONT))
        for x in (-1.25, 1.25):
            place(holes, x, 3.95, joinery.sash_window(shape, FRONT.moved(x, 3.95), 1.15, 1.5, 'brick', panes))
            place(holes, x, 6.6, joinery.sash_window(shape, FRONT.moved(x, 6.6), 1.15, 1.3, 'brick', panes,
                                                     'parlour' if x > 0 else 'curtains'))
        return holes
    place(holes, -1.55, 0.18, joinery.front_door(shape, FRONT.moved(-1.55, 0.18), panes, door, height=2.42))
    if kind == 'bay':
        holes.append(fronts.bay(shape, panes, 0.15, 2.35))
    else:
        place(holes, 1.0, 0.85, joinery.sash_window(shape, FRONT.moved(1.0, 0.85), 1.15, 1.75, 'brick', panes,
                                                    'parlour'))
    place(holes, -1.55, 3.45, joinery.sash_window(shape, FRONT.moved(-1.55, 3.45), 0.85, 1.4, 'brick', panes))
    place(holes, 1.0, 3.45, joinery.sash_window(shape, FRONT.moved(1.0, 3.45), 1.15, 1.55, 'brick', panes,
                                                'parlour'))
    return holes


def back_of(storeys, shape, panes, door):
    """The back wall: a kitchen window and the back door, and a window or two on each floor over."""
    holes = []
    place(holes, -1.0, 0.95, joinery.sash_window(shape, BACK.moved(-1.0, 0.95), 1.0, 1.3, 'brick', panes))
    place(holes, 1.3, 0.1, joinery.front_door(shape, BACK.moved(1.3, 0.1), panes, door, width=0.9, height=2.05,
                                              reveal=0.12, fanlight=False, step=(0.1, 0.25), knocker=False))
    for floor in range(1, storeys):
        y = floor * STOREY + 0.75
        place(holes, -1.0, y, joinery.sash_window(shape, BACK.moved(-1.0, y), 1.0, 1.3, 'brick', panes))
        place(holes, 1.4, y + 0.2, joinery.sash_window(shape, BACK.moved(1.4, y + 0.2), 0.7, 1.0, 'brick', panes,
                                                       bars=0))
    return holes


# --- modules ------------------------------------------------------------------------------------------------------

def house(kind, door='paint_door_green'):
    """One house of a terrace: `kind` is 'plain', 'bay' or 'shop'. Returns its shape, its lit panes and its shop
    sign (if it is a shop)."""
    shape, panes, signs = Shape(), [], []
    storeys = 3 if kind == 'shop' else 2
    eaves = storeys * STOREY
    joinery.holed(shape, FRONT, (-HALF, HALF), (-0.5, eaves), front_of(kind, shape, panes, signs, door), 'brick')
    joinery.holed(shape, BACK, (-HALF, HALF), (-0.5, eaves), back_of(storeys, shape, panes, door), 'brick')
    side_walls(shape, eaves, (-HALF, HALF))
    roof(shape, eaves, -HALF, HALF)
    eaves_line(shape, FRONT, eaves, -HALF, HALF)
    eaves_line(shape, BACK, eaves, -HALF, HALF)
    chimney(shape, eaves, -HALF - 0.3, -HALF + 0.3)
    if kind != 'shop':
        downpipe(shape, FRONT, -2.52, eaves)
    downpipe(shape, BACK, 2.52, eaves)
    return shape, panes, signs


def gable_end(storeys, side):
    """The end wall of a row, outside the house at its `side` (-1 the row's left end, 1 its right): GABLE of brick up
    into the roof, the slates carried over it, the eaves round its corners, and at the right end a stack of its
    own (the left end already has the house's)."""
    shape = Shape()
    eaves = storeys * STOREY
    inner, outer = side * HALF, side * (HALF + GABLE)
    x0, x1 = sorted((inner, outer))
    side_walls(shape, eaves, (outer,))
    shape.box((x0, -0.0, -0.5), (x1, DEEP, eaves), 'brick', skip=('left', 'right', 'top', 'bottom'))
    roof(shape, eaves, x0 - 0.05 * (side < 0), x1 + 0.05 * (side > 0))
    eaves_line(shape, FRONT, eaves, x0, x1)
    eaves_line(shape, BACK, eaves, -x1, -x0)
    if side > 0:
        chimney(shape, eaves, HALF - 0.3, HALF + 0.3, pots=(0.5, 0.6))
    return shape


def far_house(storeys):
    """A house for the far rows: its walls as a box, its roof, its stack."""
    shape = Shape()
    eaves = storeys * STOREY
    shape.box((-HALF, 0, -0.5), (HALF, DEEP, eaves), 'facade_far', skip=('top', 'bottom', 'left', 'right'))
    for x in (-HALF, HALF):
        shape.face([(x, 0, -0.5), (x, 0, eaves), (x, DEEP / 2, eaves + ROOF), (x, DEEP, eaves), (x, DEEP, -0.5)],
                   'facade_far', (x, 0, 0))
    _far_roof(shape, eaves, -HALF, HALF)
    _far_stack(shape, eaves, -HALF - 0.3, -HALF + 0.3)
    return shape


def far_gable(storeys, side):
    shape = Shape()
    eaves = storeys * STOREY
    x0, x1 = sorted((side * HALF, side * (HALF + GABLE)))
    shape.box((x0, 0, -0.5), (x1, DEEP, eaves), 'facade_far', skip=('top', 'bottom', 'left' if side > 0 else 'right'))
    shape.face([(side * (HALF + GABLE), 0, eaves), (side * (HALF + GABLE), DEEP / 2, eaves + ROOF),
                (side * (HALF + GABLE), DEEP, eaves)], 'facade_far', (side, 0, 0))
    _far_roof(shape, eaves, x0, x1)
    if side > 0:
        _far_stack(shape, eaves, HALF - 0.3, HALF + 0.3)
    return shape


def _far_roof(shape, eaves, x0, x1):
    under, top = eaves - OVER * PITCH, eaves + ROOF + LIFT
    for y_eave, sign in ((-OVER, -1), (DEEP + OVER, 1)):
        shape.face([(x0, y_eave, under), (x1, y_eave, under), (x1, DEEP / 2, top), (x0, DEEP / 2, top)],
                   'facade_far', (0, sign, 1))


def _far_stack(shape, eaves, x0, x1):
    shape.box((x0, STACK[0], eaves + 2.0), (x1, STACK[1], eaves + ROOF + 1.45), 'facade_far', skip=('bottom',))


def far_panes(panes):
    """The near house's lit panes laid flat on the far one's walls, where its windows show in the baked picture."""
    flat = []
    for points, uvs in panes:
        y = -0.012 if sum(p.y for p in points) / len(points) < DEEP / 2 else DEEP + 0.012
        flat.append(([p.copy() for p in points], uvs))
        for p in flat[-1][0]:
            p.y = y
    return flat
