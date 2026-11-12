// The wound: a body that can be cut.
//
// Skin is not cut out of a body here, because skin is not cut out of a
// body. The front of the trunk stops being the person's own mesh and
// becomes tissue (tissue.js): sheets under tension that a blade parts and
// that then do what cut tissue does. This puts the two together: the
// person's skin is no longer drawn where the tissue is, the flesh (flesh.js)
// is drawn there instead, and behind it is the lining of the rest of the
// body (lining.js).

import { Flesh } from './flesh.js';
import { Hidden } from './hidden.js';
import { lining } from './lining.js';

// Make `person` a body that can be cut over `field`. The skin's material
// becomes the body's own, since everybody else with that skin is still
// whole. Returns what a wound is drawn with: { flesh, lining, skin }, the
// Flesh, the lining's mesh, and the skin's own material as it was.
export function lay(scene, person, field) {
    const skins = person.header.parts.map((part, i) => (part.kind === 'skin' ? i : -1)).filter((i) => i >= 0);
    const whole = person.multi.subMaterials[skins[0]];
    const own = whole.clone(whole.name + ':' + person.bodyName);
    new Hidden(own, field);
    // Where it is not drawn it throws no shadow either, or everything under an open wound is in the dark.
    own.shadowDepthWrapper = new BABYLON.ShadowDepthWrapper(own, scene, { standalone: true });
    for (const i of skins) person.multi.subMaterials[i] = own;
    return { flesh: new Flesh(scene, field, whole), lining: lining(scene, person, field), skin: whole };
}
