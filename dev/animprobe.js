// Samples every clip of boxer.glb and records hand/head/hips positions in the fighter's local space.
import { Engine, Scene, ArcRotateCamera, Vector3, LoadAssetContainerAsync, Matrix } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';

MeshoptCompression.Configuration = { decoder: { url: new URL('/vendor/meshopt_decoder.js', location.href).href } };
const engine = new Engine(document.getElementById('c'), false);
const scene = new Scene(engine);
new ArcRotateCamera('cam', 0, 1, 4, Vector3.Zero(), scene);
const container = await LoadAssetContainerAsync('/assets/models/boxer.glb', scene);
const inst = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
const root = inst.rootNodes[0];
const nodes = {};
for (const n of root.getChildTransformNodes(false)) {
    const m = /:(\w+)$/.exec(n.name);
    if (m) nodes[m[1]] = n;
}
function chain(node) {
    const list = [];
    for (let n = node; n; n = n.parent) list.unshift(n);
    for (const n of list) n.computeWorldMatrix(true);
    return node.getAbsolutePosition().clone();
}
const out = {};
for (const g of inst.animationGroups) g.stop();
for (const g of inst.animationGroups) {
    g.start(false, 1, g.from, g.to);
    g.pause();
    const rows = [];
    for (let f = g.from; f <= g.to; f += 2) {
        g.goToFrame(f);
        const p = (k) => chain(nodes[k]).asArray().map((v) => +v.toFixed(3));
        rows.push({ f, lh: p('LeftHand'), rh: p('RightHand'), head: p('Head'), hips: p('Hips'), spine2: p('Spine2'), lf: p('LeftFoot'), rf: p('RightFoot') });
    }
    g.stop();
    out[g.name] = { from: g.from, to: g.to, rows };
}
window.__probe = out;
window.__ready = true;
