// The things standing in the rooms.
//
// Chairs, beds, crates, lamps: Poly Haven's models, cut down offline by
// tools/props.mjs to one small binary of geometry each and up to three maps.
// The manifest lists every model's size and bounds, so a level can decide
// what fits where before a single vertex has been fetched; geometry and
// textures come later, for the models a place actually uses.
//
// How a model sits is fixed when it is built (the manifest's `anchor`):
//
//     floor     stands on y = 0, centred in x and z, its front facing +Z
//     wall      hangs on a wall whose surface is the plane z = 0 and sticks
//               out toward +Z; centred in x, and in y on its own middle
//     ceiling   hangs down from y = 0, centred in x and z
//
// so placing one is a position and a yaw: for a wall model, a point on the
// wall and the yaw that turns +Z to the wall's outward normal.
//
// Each model is one hidden mesh and every placement an instance of it, so
// twelve chairs are one draw call.

// How much of a map's metalness is honoured. There is no environment down
// here to reflect, so a full metal is black except where the torch glints off
// it; held back, steel keeps some body under the highlight.
import * as BABYLON from '@babylonjs/core';
const METALNESS = 0.6;

// Glass is drawn as a thin film: mostly what is behind it, plus the torch's
// highlight, which Babylon keeps at full strength over a transparent surface.
const GLASS_ALPHA = 0.22;

async function readModel(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ': ' + res.status);
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== 'SIXP') throw new Error(url + ': not a model');
    const headLen = view.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, headLen)));
    const base = 12 + headLen;
    const types = { float32: Float32Array, uint16: Uint16Array, uint32: Uint32Array };
    const arrays = {};
    for (const a of header.arrays) {
        const T = types[a.type];
        arrays[a.name] = new T(buf, base + a.offset, a.length / T.BYTES_PER_ELEMENT);
    }
    return { header, arrays };
}

export class Models {
    declare scene: any;
    declare torch: any;
    declare base: string;
    declare manifest: any;
    declare loading: Map<any, any>;
    declare sources: Map<any, any>;
    declare placed: any[];
    declare manifestLoading: Promise<void>;

    // `base` is where the built models are served from; a page that is not
    // at the root of the game says so.
    constructor(scene, torch, base = 'assets/props/') {
        this.scene = scene;
        this.torch = torch;
        this.base = base;
        this.manifest = null;       // name -> { anchor, bounds, size, triangles, bytes, file }
        this.loading = new Map();   // name -> the fetch of it, done or not
        this.sources = new Map();   // name -> the hidden mesh its instances share
        this.placed = [];           // { mesh, shadows }
    }

    loadManifest() {
        if (!this.manifestLoading) {
            this.manifestLoading = fetch(this.base + 'manifest.json')
                .then((res) => {
                    if (!res.ok) throw new Error('model manifest: ' + res.status);
                    return res.json();
                })
                .then((manifest) => { this.manifest = manifest.models; });
            this.manifestLoading.catch(() => { this.manifestLoading = null; });
        }
        return this.manifestLoading;
    }

    info(name) {
        return (this.manifest && this.manifest[name]) || null;
    }

    // Geometry and textures for these models. One fetch per model, however
    // many ask for it while it is under way; a failed one may be tried again.
    async prepare(names) {
        await this.loadManifest();
        await Promise.all(names.map((name) => this._load(name)));
    }

    ready(name) {
        return this.sources.has(name);
    }

    // One more of `name`, standing at `position` and turned by `yaw`. Null if
    // the model has not been prepared.
    //
    // Instances cast shadows like any mesh: the shadow generator takes them
    // in its render list and draws them from the hidden source's geometry.
    // Nothing special is needed.
    place(name, { position, yaw = 0, scale = 1, shadows = true }) {
        const source = this.sources.get(name);
        if (!source) return null;
        const mesh = source.createInstance(name);
        mesh.position.copyFrom(position);
        mesh.rotation.y = yaw;
        mesh.scaling.setAll(scale);
        mesh.isPickable = false;
        // Nothing here ever moves again.
        mesh.freezeWorldMatrix();
        if (shadows) this.torch.cast(mesh);
        this.placed.push({ mesh, shadows });
        return mesh;
    }

    // One of `name` that is going to be moved about: picked up, carried, put
    // down. Its owner places it and disposes of it. Null if not prepared.
    make(name) {
        const source = this.sources.get(name);
        if (!source) return null;
        const mesh = source.createInstance(name);
        mesh.isPickable = false;
        return mesh;
    }

    // Take every placed instance away: the level is being rebuilt. The
    // sources and their textures stay, since the next level will want them.
    clear() {
        for (const { mesh, shadows } of this.placed) {
            if (shadows) this.torch.uncast(mesh);
            mesh.dispose();
        }
        this.placed.length = 0;
    }

    _load(name) {
        if (!this.loading.has(name)) {
            const entry = this.info(name);
            if (!entry) throw new Error('no such model: ' + name);
            const load = readModel(this.base + entry.file).then(async ({ header, arrays }) => {
                const files = [...new Set(header.parts.flatMap((part) => Object.values(part.textures)))];
                const loaded = await Promise.all(files.map((file) => this._texture(this.base + file, header.invertY)));
                const textures = new Map(files.map((file, i) => [file, loaded[i]]));
                this.sources.set(name, this._source(header, arrays, textures));
            });
            load.catch(() => this.loading.delete(name));
            this.loading.set(name, load);
        }
        return this.loading.get(name);
    }

    _texture(url, invertY) {
        return new Promise((resolve, reject) => {
            const t = new BABYLON.Texture(url, this.scene, false, invertY, BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => resolve(t), (msg) => reject(new Error(url + ': ' + msg)));
            t.anisotropicFilteringLevel = 4;
        });
    }

    _source(header, arrays, textures) {
        const mesh = new BABYLON.Mesh('model_' + header.name, this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = arrays.position;
        vd.normals = arrays.normal;
        vd.uvs = arrays.uv;
        vd.indices = arrays.index;
        vd.applyToMesh(mesh);
        mesh.isVisible = false;
        mesh.isPickable = false;
        mesh.receiveShadows = true;

        const materials = header.parts.map((part) => this._material(header, part, textures));
        if (materials.length === 1) {
            mesh.material = materials[0];
            return mesh;
        }
        const multi = new BABYLON.MultiMaterial(mesh.name + 'M', this.scene);
        multi.subMaterials = materials;
        mesh.material = multi;
        mesh.subMeshes = [];
        header.parts.forEach((part, i) => {
            new BABYLON.SubMesh(i, 0, header.vertexCount, part.indexStart, part.indexCount, mesh);
        });
        return mesh;
    }

    // PBR with nothing but direct light, as the walls are (surfaces.js). A
    // part without a map falls back on the single value the header carries.
    _material(header, part, textures) {
        const m = new BABYLON.PBRMaterial(`model_${header.name}_${part.name}`, this.scene);
        const { albedo, normal, orm } = part.textures;
        if (albedo) m.albedoTexture = textures.get(albedo);
        else m.albedoColor = new BABYLON.Color3(part.grey, part.grey, part.grey);
        if (normal) {
            m.bumpTexture = textures.get(normal);
            m.invertNormalMapX = header.invertNormalMapX;
        }
        if (orm) {
            m.metallicTexture = textures.get(orm);
            m.metallic = METALNESS;
            m.roughness = 1;
            m.useRoughnessFromMetallicTextureGreen = true;
            m.useMetallnessFromMetallicTextureBlue = true;
            m.useRoughnessFromMetallicTextureAlpha = false;
            m.useAmbientOcclusionFromMetallicTextureRed = false;
        } else {
            m.metallic = part.metallic * METALNESS;
            m.roughness = part.roughness;
        }
        // Cloth, cages and the insides of open boxes are single sheets.
        m.backFaceCulling = !part.doubleSided;
        m.twoSidedLighting = part.doubleSided;
        m.maxSimultaneousLights = 8;
        m.environmentIntensity = 0;
        m.specularIntensity = 0.7;
        if (part.glass) {
            m.alpha = GLASS_ALPHA;
            m.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
        }
        return m;
    }
}
