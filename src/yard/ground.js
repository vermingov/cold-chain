// The ground of the cemetery.
//
// One sheet of land over the whole plan, raised to the plan's own heights,
// and one material on it that is six scans at once: mown winter grass, the
// rough grass of the ground nobody mows, fallen leaves under the trees, and
// gravel, mud and tarmac wherever the plan has a path, a worn place or the
// road. Which is where is painted once onto a small mask from the plan
// itself, so the ground never disagrees with the map, and the shader frays
// every edge of the mask with noise, because a path does not meet a lawn
// along a ruler.

import { BOUNDS, PATHS, SECTIONS, heightAt, plots, trees } from '../map/plan.js';
import { noiseTexture } from '../noise.js';

// The land the sheet covers: the cemetery, the road, and enough beyond the
// wall that the fog has something to close over.
export const LAND = { x0: -100, z0: -36, size: 200 };
const STEP = 1.6;               // metres between the sheet's vertices
const MASK = 1024;              // pixels across the mask
// Metres to a repeat: each scan's own size.
const TILE = { grass: 2.5, gravel: 2.0, mud: 1.3, tarmac: 3.0, rough: 2.0 };
// A grave opened in the ground: the rectangle (x0, z0, x1, z1) where there is
// none, for the ground and the grass to leave out. One at a time; the
// default is nowhere.
export const HOLE = [1e6, 1e6, 1e6, 1e6];
// Sections whose grass is left to grow.
const UNMOWN = ['A', 'B', 'F'];

const GLSL_DEFINITIONS = `
#ifdef GROUNDBLEND
uniform sampler2D groundMask;
uniform sampler2D groundNoise;
uniform sampler2D gravelAlbedo;
uniform sampler2D gravelBump;
uniform sampler2D mudAlbedo;
uniform sampler2D tarmacAlbedo;
uniform sampler2D roughAlbedo;
uniform sampler2D leavesAlbedo;
vec3 groundShare = vec3(0.0);   // how much of this pixel is gravel, mud, tarmac
#endif
`;

const GLSL_SURFACE = `
#ifdef GROUNDBLEND
vec2 groundAt = vPositionW.xz;
// Where a grave has been opened there is no ground: the hole has its own sides.
if (all(greaterThan(groundAt, groundHole.xy)) && all(lessThan(groundAt, groundHole.zw))) discard;
// Gravel, mud, grass left to grow, under a tree.
vec4 groundPaint = texture2D(groundMask, (groundAt - groundLand.xy) / groundLand.z);
float groundBroad = texture2D(groundNoise, groundAt / 41.0).r;
vec3 groundFine = texture2D(groundNoise, groundAt / 6.7).rgb;
float groundFray = texture2D(groundNoise, groundAt / 1.3).b - 0.5;

// The grass: mown, or rough where nobody mows and in patches where they do.
vec3 roughColour = toLinearSpace(texture2D(roughAlbedo, groundAt / groundTiles.w).rgb);
surfaceAlbedo = mix(surfaceAlbedo, roughColour, smoothstep(0.38, 0.62, groundPaint.b * 0.7 + groundBroad * 0.45 + groundFray * 0.3 - 0.08));
// No lawn is one green, and none is as yellow as a scan made in August.
surfaceAlbedo *= vec3(0.6, 0.76, 0.5) * (0.7 + 0.55 * (groundBroad * 0.55 + groundFine.r * 0.45));
// Last autumn's leaves, where they fell and where the wind left them.
vec3 leafColour = toLinearSpace(texture2D(leavesAlbedo, groundAt / groundTiles.w).rgb);
surfaceAlbedo = mix(surfaceAlbedo, leafColour, 0.9 * smoothstep(0.3, 0.75, groundPaint.a * (0.55 + groundFine.g) + groundFray * 0.5));

// What has been laid or worn over the grass, every edge of it frayed.
float groundRoadway = clamp((groundRoad.y - abs(groundAt.y - groundRoad.x)) * 2.0 + 0.5, 0.0, 1.0);
groundShare = smoothstep(0.32, 0.68, vec3(groundPaint.rg, groundRoadway) + groundFray * 0.5);
// Mud is at a path's edges and in its hollows, not all over it.
groundShare.g *= 1.0 - 0.95 * groundShare.r * smoothstep(-0.3, -0.12, groundFine.b - 0.5 + groundFray);
// Wet gravel is darker than the scan of it dry.
vec3 gravelColour = toLinearSpace(texture2D(gravelAlbedo, groundAt / groundTiles.x).rgb) * 0.55;
vec3 mudColour = toLinearSpace(texture2D(mudAlbedo, groundAt / groundTiles.y).rgb);
vec3 tarmacColour = toLinearSpace(texture2D(tarmacAlbedo, groundAt / groundTiles.z).rgb);
surfaceAlbedo = mix(surfaceAlbedo, gravelColour, groundShare.r);
surfaceAlbedo = mix(surfaceAlbedo, mudColour, groundShare.g);
surfaceAlbedo = mix(surfaceAlbedo, tarmacColour, groundShare.b);
#ifdef BUMP
vec3 gravelNormal = perturbNormal(TBN, texture2D(gravelBump, groundAt / groundTiles.x).xyz, vBumpInfos.y);
normalW = normalize(mix(normalW, gravelNormal, groundShare.r));
// Mud and tarmac lie flatter than grass does.
normalW = normalize(mix(normalW, normalize(vNormalW), max(groundShare.g, groundShare.b) * 0.6));
#endif
#endif
`;

// Grass is dull, gravel duller, tarmac has a sheen, and mud is wet.
const GLSL_ROUGHNESS = `
#ifdef GROUNDBLEND
metallicRoughness.g = mix(mix(mix(metallicRoughness.g, 0.9, groundShare.r), 0.34, groundShare.g), 0.62, groundShare.b);
#endif
`;

class GroundBlend extends BABYLON.MaterialPluginBase {
    constructor(material, mask, layers) {
        super(material, 'GroundBlend', 200, { GROUNDBLEND: false });
        this.mask = mask;
        this.noise = noiseTexture(material.getScene());
        this.layers = layers;       // { gravel, mud, tarmac, rough, leaves }: each { albedo, normal }
        this.road = PATHS.find((p) => p.id === 'road');
        this._enable(true);
    }

    getClassName() { return 'GroundBlend'; }

    prepareDefines(defines) { defines.GROUNDBLEND = true; }

    // Sampler name -> texture. Sixteen is all a fragment shader is promised,
    // and the material's own three, two shadow maps, the torch's lens and
    // the engine's lookup are seven of them: so no normal map for anything
    // but the gravel.
    _textures() {
        const { gravel, mud, tarmac, rough, leaves } = this.layers;
        return {
            groundMask: this.mask, groundNoise: this.noise, gravelAlbedo: gravel.albedo, gravelBump: gravel.normal,
            mudAlbedo: mud.albedo, tarmacAlbedo: tarmac.albedo, roughAlbedo: rough.albedo, leavesAlbedo: leaves.albedo,
        };
    }

    isReadyForSubMesh() { return Object.values(this._textures()).every((t) => t.isReady()); }

    getSamplers(samplers) { samplers.push(...Object.keys(this._textures())); }

    getUniforms() {
        return {
            ubo: [{ name: 'groundLand', size: 3, type: 'vec3' }, { name: 'groundTiles', size: 4, type: 'vec4' }, { name: 'groundRoad', size: 2, type: 'vec2' },
                { name: 'groundHole', size: 4, type: 'vec4' }],
            fragment: '#ifdef GROUNDBLEND\nuniform vec3 groundLand;\nuniform vec4 groundTiles;\nuniform vec2 groundRoad;\nuniform vec4 groundHole;\n#endif',
        };
    }

    bindForSubMesh(ubo) {
        ubo.updateFloat3('groundLand', LAND.x0, LAND.z0, LAND.size);
        ubo.updateFloat4('groundTiles', TILE.gravel, TILE.mud, TILE.tarmac, TILE.rough);
        // The road is straight and runs east: where its middle is, and half its width.
        ubo.updateFloat2('groundRoad', this.road.points[0][1], this.road.width / 2);
        ubo.updateFloat4('groundHole', ...HOLE);
        for (const [name, texture] of Object.entries(this._textures())) ubo.setTexture(name, texture);
    }

    getActiveTextures(textures) { textures.push(...Object.values(this._textures())); }

    hasTexture(texture) { return Object.values(this._textures()).includes(texture); }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFINITIONS,
            CUSTOM_FRAGMENT_BEFORE_LIGHTS: GLSL_SURFACE,
            CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: GLSL_ROUGHNESS,
        };
    }
}

// A canvas the size of the mask, black, that adds what is drawn on it, and
// the two ways of drawing: a line of a width and a round blot, in metres.
function sheet() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MASK;
    const ctx = canvas.getContext('2d');
    const metres = MASK / LAND.size;
    // Row 0 of the canvas is the south edge: the texture is read as it lies.
    const px = (x) => (x - LAND.x0) * metres, pz = (z) => (z - LAND.z0) * metres;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MASK, MASK);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    return {
        ctx,
        blur(pixels) { ctx.filter = pixels ? `blur(${pixels}px)` : 'none'; },
        stroke(points, width, colour) {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width * metres;
            ctx.beginPath();
            points.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), pz(z)) : ctx.moveTo(px(x), pz(z))));
            ctx.stroke();
        },
        blot(x, z, radius, colour) {
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(px(x), pz(z), radius * metres, 0, Math.PI * 2);
            ctx.fill();
        },
        rect(x0, z0, x1, z1, colour) {
            ctx.fillStyle = colour;
            ctx.fillRect(px(x0), pz(z0), (x1 - x0) * metres, (z1 - z0) * metres);
        },
        pixels: () => ctx.getImageData(0, 0, MASK, MASK).data,
    };
}

// The mask, painted from the plan. Four things in its four channels: gravel,
// mud, grass left to grow, and the ground under a tree. Painted as two
// pictures of two channels each and put together by hand, because a canvas
// does not keep an alpha channel apart from its colours.
function paintMask(scene) {
    // Laid and worn: red where there is gravel, green where there is mud.
    const worn = sheet();
    worn.blur(1.6);
    for (const p of PATHS) {
        if (p.id === 'road') continue;          // the shader knows where the road is
        // The edges of a gravel path are trodden to mud a little wider than
        // the gravel itself.
        worn.stroke(p.points, p.width + 0.9, 'rgba(0,255,0,0.45)');
        worn.stroke(p.points, p.width, '#f00');
    }
    // Mud: under the big trees, at the gates, and all over the public
    // ground, where nothing is ever given time to grow back.
    worn.blur(5);
    for (const t of trees()) worn.blot(t.x, t.z, 1.1 * t.size, 'rgba(0,255,0,0.45)');
    const pauper = SECTIONS.find((s) => s.id === 'E');
    for (const p of plots()) {
        if (p.section === 'E' && p.taken) worn.blot(p.x, p.z, 1.2, 'rgba(0,255,0,0.7)');
    }
    worn.blot(BOUNDS.x1 - 2, 96, 4, 'rgba(0,255,0,0.6)');
    worn.blot((pauper.x[0] + pauper.x[1]) / 2, pauper.z[0] - 2, 5, 'rgba(0,255,0,0.4)');

    // Grown and fallen: red where the grass is left alone, green under a tree.
    const grown = sheet();
    grown.blur(6);
    // Everything outside the wall, and the sections nobody mows.
    grown.rect(LAND.x0, LAND.z0, LAND.x0 + LAND.size, LAND.z0 + LAND.size, '#f00');
    grown.ctx.globalCompositeOperation = 'source-over';
    grown.rect(BOUNDS.x0, BOUNDS.z0, BOUNDS.x1, BOUNDS.z1, '#000');
    grown.ctx.globalCompositeOperation = 'lighter';
    for (const s of SECTIONS.filter((q) => UNMOWN.includes(q.id))) grown.rect(s.x[0] - 2, s.z[0] - 2, s.x[1] + 2, s.z[1] + 2, '#f00');
    grown.blur(9);
    for (const t of trees()) if (t.kind !== 'sapling') grown.blot(t.x, t.z, 3.4 * t.size, 'rgba(0,255,0,0.8)');

    const a = worn.pixels(), b = grown.pixels();
    const data = new Uint8Array(MASK * MASK * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = a[i]; data[i + 1] = a[i + 1];
        data[i + 2] = b[i]; data[i + 3] = b[i + 1];
    }
    const tex = BABYLON.RawTexture.CreateRGBATexture(data, MASK, MASK, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.name = 'groundMask';
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return tex;
}

// The sheet of land, with the plan's heights. Laid so its texture
// coordinates are the world's own, in metres over the grass's tile.
function landMesh(scene) {
    const n = Math.round(LAND.size / STEP);
    const positions = [], normals = [], uvs = [], indices = [];
    for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
            const x = LAND.x0 + i * STEP, z = LAND.z0 + j * STEP;
            positions.push(x, heightAt(x, z), z);
            // The slope, from the plan's own heights either side.
            const dx = heightAt(x + 0.5, z) - heightAt(x - 0.5, z), dz = heightAt(x, z + 0.5) - heightAt(x, z - 0.5);
            const len = Math.hypot(dx, 1, dz);
            normals.push(-dx / len, 1 / len, -dz / len);
            uvs.push(x / TILE.grass, z / TILE.grass);
        }
    }
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
            indices.push(a, b, c, b, d, c);
        }
    }
    const mesh = new BABYLON.Mesh('land', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    return mesh;
}

// `surfaces` must have grass, rough, leaves, gravel, mud and tarmac loaded.
// Returns the land and the mask it was painted from, for whatever else has
// to know where the paths are.
export function buildGround(scene, surfaces) {
    // The blend does its own mottling, with the same noise.
    const material = surfaces.material('grass', { rough: 1, mottle: 0 });
    const layers = Object.fromEntries(['gravel', 'mud', 'tarmac', 'rough', 'leaves'].map((name) => [name, surfaces.maps(name)]));
    const mask = paintMask(scene);
    new GroundBlend(material, mask, layers);
    const mesh = landMesh(scene);
    mesh.material = material;
    return { mesh, mask };
}
