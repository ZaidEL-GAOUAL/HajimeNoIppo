import { Engine, Scene, ArcRotateCamera, HemisphericLight, Vector3, LoadAssetContainerAsync, MeshBuilder, Color4 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';

MeshoptCompression.Configuration = { decoder: { url: new URL('/vendor/meshopt_decoder.js', location.href).href } };
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.15, 0.15, 0.2, 1);
const cam = new ArcRotateCamera('cam', +(params.get('a') ?? -Math.PI / 2), +(params.get('b') ?? 1.3), +(params.get('r') ?? 4), new Vector3(0, +(params.get('ty') ?? 1), 0), scene);
cam.attachControl(canvas, true);
new HemisphericLight('h', new Vector3(0.3, 1, -0.5), scene);
MeshBuilder.CreateGround('g', { width: 6, height: 6 }, scene);
const axisZ = MeshBuilder.CreateBox('z+', { width: 0.05, height: 0.05, depth: 1 }, scene); axisZ.position.set(0, 0.02, 0.5);

const file = params.get('file') ?? 'boxer.glb';
const container = await LoadAssetContainerAsync(`/assets/models/${file}`, scene);
const info = { groups: container.animationGroups.map((g) => [g.name, g.from, g.to]), meshes: container.meshes.map((m) => m.name), skeletons: container.skeletons.length };
const count = +(params.get('n') ?? 1);
const anim = params.get('anim');
const frame = params.get('frame');
for (let i = 0; i < count; i++) {
    const inst = container.instantiateModelsToScene((n) => `${n}_${i}`, true);
    inst.rootNodes[0].position.x = (i - (count - 1) / 2) * 1.2;
    inst.animationGroups.forEach((g) => g.stop());
    const g = inst.animationGroups.find((g) => g.name.startsWith((anim ?? 'stance') + '_')) ?? inst.animationGroups[0];
    if (g) {
        g.start(true);
        if (frame !== null) { g.goToFrame(+frame); g.pause(); }
    }
}
let bb = null;
for (const m of scene.meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0 || m.name === 'g' || m.name === 'z+') continue;
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    bb = bb ? { min: Vector3.Minimize(bb.min, b.minimumWorld), max: Vector3.Maximize(bb.max, b.maximumWorld) } : { min: b.minimumWorld.clone(), max: b.maximumWorld.clone() };
}
info.bbox = bb && [bb.min.asArray().map((v) => v.toFixed(2)), bb.max.asArray().map((v) => v.toFixed(2))];
window.__info = info;
console.log(JSON.stringify(info));
engine.runRenderLoop(() => scene.render());
let frames = 0;
scene.onAfterRenderObservable.add(() => { if (++frames === 30) window.__ready = true; });
