// What is outside the flat's window: the main road, a floor down.
//
// The flat is over a shop. Under the window is the pavement and a sodium
// lamp at its edge, its head level with the sill; across the road is a
// terrace of brick houses, two storeys and a slate roof, a lit window here
// and there behind curtains. It is only ever seen through the glass, so it
// is built as far as the glass can see and no further: the fog closes over
// the rest.

import { Buf } from '../geometry.js';

const V3 = BABYLON.Vector3;
// Metres from the flat's floor (y = 0) and its window wall (z = `front`): how far down the street is, and how deep
// the near pavement, the road and the far pavement are.
const STREET = { down: 3.4, near: 2.6, road: 8.5, far: 2.4, long: 60 };
const TERRACE = { high: 6.2, rise: 2.4, house: 5.2, storey: 2.8, deep: 7 };
const LAMP = { model: 'street_lamp_01', at: [3.4, 2.25], power: 200, range: 30 };
const LIT = [[0, 1], [2, 0], [5, 1], [7, 0]];       // which windows of the terrace have somebody up: house, upstairs (1) or down (0)

function emissive(scene, name, colour) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = BABYLON.Color3.FromArray(colour);
    return m;
}

// A curtained window with a lamp behind it, as seen from across a road.
function litPane(scene) {
    const tex = new BABYLON.DynamicTexture('lit pane', { width: 64, height: 96 }, scene, true);
    const ctx = tex.getContext(), glow = ctx.createRadialGradient(36, 60, 2, 32, 48, 70);
    glow.addColorStop(0, '#ffcc88');
    glow.addColorStop(0.6, '#a8642c');
    glow.addColorStop(1, '#3a1d0a');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 96);
    for (let x = 0; x < 64; x += 6) {
        ctx.fillStyle = `rgba(30,12,4,${0.15 + 0.15 * Math.abs(Math.sin(x))})`;
        ctx.fillRect(x, 0, 3, 96);
    }
    tex.update(true);
    const m = new BABYLON.StandardMaterial('lit pane', scene);
    m.disableLighting = true;
    m.emissiveTexture = tex;
    m.diffuseColor = BABYLON.Color3.Black();
    return m;
}

// Build it. `front` is z of the outside face of the flat's window wall; `surfaces` has tarmac, pavement, terrace,
// slates loaded; `models` the street lamp; `morning` is a grey day with the lamps out.
export async function buildStreet(scene, { front, surfaces, models, morning }) {
    const y = -STREET.down, half = STREET.long / 2;
    const z1 = front + STREET.near, z2 = z1 + STREET.road, z3 = z2 + STREET.far;
    const ground = { pavement: new Buf(), road: new Buf(), brick: new Buf(), slates: new Buf(), sill: new Buf() };
    ground.pavement.box([-half, y - 0.2, front], [half, y + 0.12, z1], 1.6);
    ground.pavement.box([-half, y - 0.2, z2], [half, y + 0.12, z3], 1.6);
    ground.road.box([-half, y - 0.2, z1], [half, y, z2], 3);
    // The kerbs.
    ground.sill.box([-half, y, z1 - 0.15], [half, y + 0.12, z1], 1);
    ground.sill.box([-half, y, z2], [half, y + 0.12, z2 + 0.15], 1);

    // The terrace: house after house, each with a door and a window down, two windows up, a sill under each.
    const face = z3, top = y + TERRACE.high, panes = [], lit = [];
    ground.brick.box([-half, y, face], [half, top, face + TERRACE.deep], 1.2, { skip: ['nz'] });
    for (let h = 0, x0 = -half; x0 < half; h++, x0 += TERRACE.house) {
        const holes = [[x0 + 0.9, y + 0.15, 0.95, 2.05, 'door'], [x0 + 2.6, y + 0.9, 1.2, 1.4, 0], [x0 + 0.8, y + 3.6, 1.1, 1.4, 1], [x0 + 3.1, y + 3.6, 1.1, 1.4, 1]];
        // The brick front, around its openings: drawn as strips of wall between them.
        const cuts = holes.map(([hx, hy, w, ht]) => [hx, hy, hx + w, hy + ht]);
        brickFront(ground.brick, x0, x0 + TERRACE.house, y, top, face, cuts);
        for (const [hx, hy, w, ht, storey] of holes) {
            ground.sill.box([hx - 0.06, hy - 0.08, face - 0.06], [hx + w + 0.06, hy, face + 0.02], 1);
            const isLit = storey !== 'door' && !morning && LIT.some(([house, up]) => house === h && up === storey) && hx < x0 + 2;
            const pane = BABYLON.MeshBuilder.CreatePlane('terrace pane', { width: w, height: ht }, scene);
            pane.position.set(hx + w / 2, hy + ht / 2, face + 0.12);
            (isLit ? lit : panes).push(pane);
            reveals(ground.brick, hx, hy, hx + w, hy + ht, face, 0.12);
        }
        // Chimney on the party wall.
        ground.brick.box([x0 - 0.35, top + TERRACE.rise * 0.5, face + 2.2], [x0 + 0.35, top + TERRACE.rise + 0.9, face + 3.0], 1.2);
    }
    // The roof, one slope seen from the road.
    ground.slates.face([[-half, top, face - 0.25], [half, top, face - 0.25], [half, top + TERRACE.rise, face + 3.4], [-half, top + TERRACE.rise, face + 3.4]],
        [0, 1, -1], [[-half / 1.5, 0], [half / 1.5, 0], [half / 1.5, 2.6], [-half / 1.5, 2.6]]);

    const look = {
        pavement: surfaces.material('pavement', { tint: [0.7, 0.7, 0.7] }), road: surfaces.material('tarmac'), brick: surfaces.material('terrace'),
        slates: surfaces.material('slates'), sill: surfaces.material('limestone'),
    };
    const meshes = Object.entries(ground).filter(([, buf]) => !buf.empty).map(([name, buf]) => buf.toMesh('street ' + name, scene, look[name]));
    const black = emissive(scene, 'dark pane', morning ? [0.05, 0.05, 0.055] : [0.006, 0.006, 0.008]), warm = litPane(scene);
    for (const pane of panes) pane.material = black;
    for (const pane of lit) pane.material = warm;

    // The lamp at the kerb, its head about level with the flat's window, throwing sodium down the road and in at the glass.
    await models.prepare([LAMP.model]);
    const [lx, lz] = [LAMP.at[0], front + LAMP.at[1]];
    const post = models.place(LAMP.model, { position: new V3(lx, y, lz), yaw: Math.PI, shadows: false });
    const head = new V3(lx, y + 3.45, lz);
    const sodium = new BABYLON.PointLight('street lamp', head, scene);
    sodium.diffuse = new BABYLON.Color3(1, 0.52, 0.14);
    sodium.specular = sodium.diffuse;
    sodium.intensity = morning ? 0 : LAMP.power;
    sodium.range = LAMP.range;
    sodium.falloffType = BABYLON.Light.FALLOFF_GLTF;
    // (Its own post and lantern are lit by the moonless dark and the bulb, not by a light inside them.)
    sodium.excludedMeshes.push(post);
    if (!morning) {
        const bulb = BABYLON.MeshBuilder.CreateSphere('street lamp bulb', { diameter: 0.18, segments: 8 }, scene);
        bulb.position.copyFrom(head);
        bulb.material = emissive(scene, 'sodium', [3, 1.5, 0.4]);
    }
    return { meshes: [...meshes, ...panes, ...lit], light: sodium, lamp: head };
}

// The four sides of an opening in a wall at z, `deep` into it, facing into the opening.
function reveals(buf, x0, y0, x1, y1, z, deep) {
    const middle = [(x0 + x1) / 2, (y0 + y1) / 2];
    for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]) {
        const corners = [[a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], z + deep], [a[0], a[1], z + deep]];
        buf.face(corners, [middle[0] - (a[0] + b[0]) / 2, middle[1] - (a[1] + b[1]) / 2, 0], corners.map(([cx, cy, cz]) => [(cx + cz) / 1.2, cy / 1.2]), { shade: 0.6 });
    }
}

// A stretch of brick wall from x0 to x1, y0 to y1, in the plane z, with rectangular holes (x0, y0, x1, y1) left in
// it: laid as horizontal bands, each cut where a hole crosses it.
function brickFront(buf, x0, x1, y0, y1, z, holes) {
    const levels = [...new Set([y0, y1, ...holes.flatMap(([, a, , b]) => [a, b])])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < levels.length; i++) {
        const a = levels[i], b = levels[i + 1], mid = (a + b) / 2;
        const gaps = holes.filter(([, ha, , hb]) => ha <= mid && hb >= mid).map(([hx0, , hx1]) => [hx0, hx1]).sort((p, q) => p[0] - q[0]);
        let from = x0;
        for (const [g0, g1] of [...gaps, [x1, x1]]) {
            if (g0 > from) buf.face([[from, a, z], [g0, a, z], [g0, b, z], [from, b, z]], [0, 0, -1], [[from / 1.2, a / 1.2], [g0 / 1.2, a / 1.2], [g0 / 1.2, b / 1.2], [from / 1.2, b / 1.2]]);
            from = Math.max(from, g1);
        }
    }
}
