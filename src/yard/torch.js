// The torch in the hand.
//
// The one light the player owns. It is a bulb behind a lens, so what it
// throws is not an even disc: a hot spot, and round it a beam that thins
// all the way out to nothing, with the reflector's rings faintly in it. It
// has no edge: on ground a metre from the hand an edge is all there is to
// look at.
//
// Two things shape it. The cone itself fades from its middle to its rim,
// and that is all the shine off wet mud and polished granite ever sees,
// because the engine does not put a picture through a light's highlights.
// The picture the light is shone through (LENS) then draws the hot spot and
// the rings into what is left.
//
// It follows the eye a little late, as a hand does, and a faint second
// light stands in for what comes back off the ground to whoever holds it:
// without that, everything outside the beam is a black card.
//
// Held a metre from a pale headstone a torch is a white blank: light falls
// off with the square of the distance and comes back the same way. An eye
// closes down on that, and so does this one: told how far off the thing in
// the beam is, the torch is turned down as it comes close, a little late,
// and what is being read stays readable while the dark round it deepens.

const V3 = BABYLON.Vector3;
const LENS = 512;
const CONE = 1.35;          // radians, edge of the spill to edge of the spill
const SHADOWS_REACH = 26;   // metres out to which what is in the beam throws a shadow
const HAND = { right: 0.2, down: 0.28, ahead: 0.15 };
const LAG = 0.2;            // how much of the way to the eye the hand gets each frame
const POWER = { beam: 400, spill: 0.7 };
// The eye: wide open on anything this far off or further, never closed past
// `least`, and `slow` is how much of the way it gets each frame.
const EYE = { open: 4.5, least: 0.07, slow: 0.07 };

// What the lens throws, as light against distance from the middle of the
// beam (0) to the edge of the cone (1).
const BEAM = [[0, 1], [0.08, 0.97], [0.17, 0.78], [0.3, 0.6], [0.5, 0.5], [0.8, 0.42], [1, 0.4]];
const RINGS = [[0.24, 0.06], [0.34, -0.05], [0.45, 0.04]];
const CORE = 0.25;          // radians of the cone that are at full strength

function lensTexture(scene) {
    const tex = new BABYLON.DynamicTexture('torchLens', { width: LENS, height: LENS }, scene, true);
    const ctx = tex.getContext();
    const mid = LENS / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LENS, LENS);
    // The bulb never sits dead centre in its reflector.
    const beam = ctx.createRadialGradient(mid * 1.02, mid * 0.99, 0, mid, mid, mid);
    for (const [r, light] of BEAM) {
        // The edge of the beam is yellower than its middle.
        const c = Math.round(255 * light), b = Math.round(255 * light * (1 - 0.35 * r));
        beam.addColorStop(r, `rgb(${c},${Math.round(c * (1 - 0.1 * r))},${b})`);
    }
    ctx.fillStyle = beam;
    ctx.fillRect(0, 0, LENS, LENS);
    ctx.filter = 'blur(3px)';
    ctx.lineWidth = LENS * 0.012;
    for (const [r, light] of RINGS) {
        ctx.strokeStyle = light > 0 ? `rgba(255,240,210,${light})` : `rgba(0,0,0,${-light})`;
        ctx.beginPath();
        ctx.arc(mid, mid, mid * r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.filter = 'none';
    tex.update(true);
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return tex;
}

export class Torch {
    constructor(scene, camera) {
        this.camera = camera;
        this.aim = new V3(0, 0, 1);

        const beam = new BABYLON.SpotLight('torch', camera.position.clone(), this.aim.clone(), CONE, 1, scene);
        beam.falloffType = BABYLON.Light.FALLOFF_GLTF;
        beam.innerAngle = CORE;
        beam.projectionTexture = lensTexture(scene);
        beam.diffuse = new BABYLON.Color3(1.0, 0.93, 0.8);
        beam.specular = beam.diffuse;
        beam.range = 38;
        beam.shadowMinZ = 0.2;
        beam.shadowMaxZ = 40;
        this.beam = beam;

        const shadows = new BABYLON.ShadowGenerator(1024, beam);
        shadows.usePercentageCloserFiltering = true;
        shadows.bias = 0.0006;
        shadows.normalBias = 0.015;
        this.shadows = shadows;

        const spill = new BABYLON.PointLight('torchSpill', camera.position.clone(), scene);
        spill.falloffType = BABYLON.Light.FALLOFF_GLTF;
        spill.diffuse = new BABYLON.Color3(1.0, 0.86, 0.68);
        spill.specular = BABYLON.Color3.Black();
        spill.range = 7;
        this.spill = spill;

        this.eye = 1;
        this.on = true;
    }

    get on() { return this.lit; }

    set on(lit) {
        this.lit = lit;
        this._shine();
    }

    _shine() {
        const share = this.lit ? this.eye : 0;
        this.beam.intensity = POWER.beam * share;
        this.spill.intensity = POWER.spill * share;
    }

    // What may throw a shadow in the beam. Only what is in front of it and within its reach is drawn into the shadow
    // each frame (update): the rest of the yard is behind the player or lost in the mist.
    cast(meshes) {
        this.casters = this.casters || [];
        for (const mesh of meshes) this.casters.push(mesh, ...mesh.getChildMeshes(false));
    }

    _inBeam() {
        const from = this.beam.position, along = this.beam.direction;
        this.shadows.getShadowMap().renderList = (this.casters || []).filter((mesh) => {
            if (!mesh.isEnabled() || mesh.isDisposed()) return false;
            const sphere = mesh.getBoundingInfo().boundingSphere, to = sphere.centerWorld.subtract(from);
            const far = to.length() - sphere.radiusWorld;
            return far < SHADOWS_REACH && (far < 0 || V3.Dot(to, along) > -sphere.radiusWorld);
        });
    }

    // Once a frame: bring the hand round after the eye. `reach` is how far
    // off the thing in the beam is, in metres, if anybody knows.
    update(reach = Infinity) {
        const wanted = Math.max(EYE.least, Math.min(1, (reach / EYE.open) ** 2));
        this.eye += (wanted - this.eye) * EYE.slow;
        this._shine();
        const look = this.camera.getForwardRay(1).direction;
        this.aim.addInPlace(look.subtract(this.aim).scale(LAG)).normalize();
        const right = V3.Cross(V3.Up(), look).normalize();
        this.beam.position = this.camera.position.add(right.scale(HAND.right)).add(new V3(0, -HAND.down, 0)).add(look.scale(HAND.ahead));
        this.beam.direction = this.aim.add(new V3(0, -0.04, 0)).normalize();
        this.spill.position.copyFrom(this.beam.position);
        this._inBeam();
    }
}
