import {
    LoadAssetContainerAsync, MeshBuilder, Color3, Vector3, SpriteManager, Sprite, ShaderMaterial, ShaderStore,
    Constants, Scene, Mesh, TransformNode, InstancedMesh,
} from '@babylonjs/core/pure';
import { createToonMaterial, ToonLighting } from '../render/ToonMaterial.js';
import {
    createCanvasTexture, createSkirtTexture, createCrowdTexture, createDotTexture, CROWD_CELL_W, CROWD_CELL_H,
} from '../render/ProceduralTextures.js';
import { RING } from '../core/constants.js';

// The 2024 stadium model is ~2.5x real scale; 0.4 brings its ring to 6 m between the ropes.
const STADIUM_SCALE = 0.4;
const STADIUM_CANVAS_Y = 5.6;
const STADIUM_RING_PARTS = /^(Cube(_\d|\.00[1-8]_0)|Cylinder)/;

// Recolors for the stadium's flat materials (toon-shaded, darker so the ring pops).
const STADIUM_COLORS = {
    'Material.038': new Color3(0.12, 0.12, 0.2), // seats
    'Material.071': new Color3(0.06, 0.06, 0.08), // structure, catwalks
    'Material.129': new Color3(0.05, 0.05, 0.07), // floor
    'Material.018': new Color3(0.1, 0.1, 0.12),
    'Material.004': new Color3(0.05, 0.05, 0.06),
    'Material.075': new Color3(0.75, 0.82, 1.0), // jumbotron screen
    'Material.076': new Color3(0.8, 0.8, 0.82),
    'Material.019': new Color3(0.3, 0.45, 0.6),
    'Material.130': new Color3(0.85, 0.05, 0.12),
    'Fence.013': new Color3(0.22, 0.22, 0.25),
    'Material.008': new Color3(0.2, 0.22, 0.32), // ring stairs
};

ShaderStore.ShadersStore.lightConeVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float height;
varying float vY;
varying vec3 vNormalW;
varying vec3 vPositionW;
void main(void) {
    vec4 wp = world * vec4(position, 1.0);
    vPositionW = wp.xyz;
    vNormalW = normalize(mat3(world) * normal);
    vY = position.y / height + 0.5;
    gl_Position = viewProjection * wp;
}
`;
ShaderStore.ShadersStore.lightConeFragmentShader = /* glsl */ `
precision highp float;
varying float vY;
varying vec3 vNormalW;
varying vec3 vPositionW;
uniform vec3 cameraPosition;
uniform vec3 color;
uniform float intensity;
void main(void) {
    vec3 V = normalize(cameraPosition - vPositionW);
    float facing = abs(dot(normalize(vNormalW), V));
    float a = pow(vY, 1.6) * pow(facing, 1.5) * intensity;
    gl_FragColor = vec4(color * a, a);
}
`;

export class Arena {
    /** @param {Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.root = new TransformNode('arena', scene);
        this.crowd = [];
        this.flashes = [];
        this.excitement = 0.2;
        this.time = 0;
    }

    async load() {
        const scene = this.scene;
        scene.clearColor.set(ToonLighting.fogColor.r, ToonLighting.fogColor.g, ToonLighting.fogColor.b, 1);
        scene.fogMode = Scene.FOGMODE_EXP2;
        scene.fogColor = ToonLighting.fogColor;
        scene.fogDensity = ToonLighting.fogDensity;
        const seats = await this.loadStadium();
        this.buildRing();
        this.buildLights();
        this.buildCrowd(seats);
    }

    async loadStadium() {
        const scene = this.scene;
        const container = await LoadAssetContainerAsync('assets/models/stadium.glb', scene);
        container.addAllToScene();
        const root = container.meshes.find((m) => m.name === '__root__');
        root.parent = this.root;
        root.scaling.scaleInPlace(STADIUM_SCALE);
        root.position.y = -STADIUM_CANVAS_Y * STADIUM_SCALE;

        const materials = new Map();
        const seatMeshes = [];
        // Copy: disposing a mesh removes it from the container's list.
        for (const mesh of [...container.meshes]) {
            if (mesh === root) continue;
            mesh.isPickable = false;
            // The stadium's own ring (instances included) is replaced by the procedural one.
            if (STADIUM_RING_PARTS.test(mesh.name) && !/^Cube\.0(09|10|11)/.test(mesh.name)) {
                mesh.dispose(false, false);
                continue;
            }
            if (mesh instanceof InstancedMesh) {
                if (mesh.sourceMesh.material?.name === 'Material.038') seatMeshes.push(mesh);
                continue;
            }
            const src = mesh.material;
            if (!src) continue;
            const key = src.name;
            if (!materials.has(key)) {
                const isLamp = key.startsWith('Focos');
                const color = isLamp ? new Color3(1, 0.97, 0.88) : (STADIUM_COLORS[key] ?? src.albedoColor ?? new Color3(0.5, 0.5, 0.5));
                materials.set(key, createToonMaterial(`stadium_${key}`, scene, {
                    color,
                    rim: 0.15,
                    spec: 0,
                    emissive: isLamp || key === 'Material.075' ? 1 : 0,
                    shade: new Color3(0.3, 0.3, 0.42),
                    backFaceCulling: false,
                }));
            }
            mesh.material = materials.get(key);
            if (key === 'Material.038') seatMeshes.push(mesh);
        }
        for (const mat of container.materials) mat.dispose();
        for (const tex of container.textures) tex.dispose();
        root.computeWorldMatrix(true);
        for (const mesh of [...container.meshes]) {
            if (mesh.isDisposed()) continue;
            mesh.computeWorldMatrix(true);
            mesh.freezeWorldMatrix();
        }
        return seatMeshes;
    }

    buildRing() {
        const scene = this.scene;
        const ring = new TransformNode('ring', scene);
        ring.parent = this.root;
        const H = RING.platformHalf;

        const canvas = MeshBuilder.CreateGround('canvas', { width: H * 2, height: H * 2 }, scene);
        canvas.material = createToonMaterial('canvasMat', scene, { texture: createCanvasTexture(scene, { insideRatio: RING.ropeHalf / H }), rim: 0, spec: 0.05 });
        canvas.parent = ring;
        canvas.position.y = 0.001;
        this.canvas = canvas;

        const skirtMat = createToonMaterial('skirtMat', scene, { texture: createSkirtTexture(scene), rim: 0, spec: 0, emissive: 0.35 });
        for (let side = 0; side < 4; side++) {
            const plane = MeshBuilder.CreatePlane(`skirt${side}`, { width: H * 2, height: RING.platformHeight }, scene);
            plane.material = skirtMat;
            plane.parent = ring;
            const angle = (side * Math.PI) / 2;
            plane.rotation.y = angle;
            plane.position.set(-Math.sin(angle) * H, -RING.platformHeight / 2, -Math.cos(angle) * H);
        }

        const metal = createToonMaterial('postMat', scene, { color: new Color3(0.75, 0.77, 0.82), spec: 0.6, rim: 0.4 });
        const padColors = {
            red: new Color3(0.82, 0.06, 0.14),
            blue: new Color3(0.1, 0.25, 0.85),
            white: new Color3(0.95, 0.95, 0.95),
        };
        const P = RING.postHalf;
        const corners = [
            { x: -P, z: -P, pad: 'red' },
            { x: P, z: -P, pad: 'white' },
            { x: P, z: P, pad: 'blue' },
            { x: -P, z: P, pad: 'white' },
        ];
        for (const c of corners) {
            const post = MeshBuilder.CreateCylinder('post', { diameter: 0.12, height: 1.6, tessellation: 12 }, scene);
            post.material = metal;
            post.position.set(c.x, 0.8, c.z);
            post.parent = ring;
            const pad = MeshBuilder.CreateBox(`pad_${c.pad}`, { width: 0.24, height: 1.12, depth: 0.24 }, scene);
            pad.material = createToonMaterial(`padMat_${c.pad}_${c.x}`, scene, { color: padColors[c.pad], rim: 0.6 });
            pad.position.set(c.x * 0.985, 0.86, c.z * 0.985);
            pad.rotation.y = Math.PI / 4;
            pad.parent = ring;
            pad.renderOutline = true;
            pad.outlineWidth = 0.012;
            pad.outlineColor = Color3.Black();
        }

        const ropeColors = [new Color3(0.12, 0.3, 0.9), new Color3(0.96, 0.96, 0.96), new Color3(0.96, 0.96, 0.96), new Color3(0.85, 0.06, 0.15)];
        const ropeMats = ropeColors.map((c, i) => createToonMaterial(`ropeMat${i}`, scene, { color: c, rim: 0.7, spec: 0.4 }));
        const R = RING.ropeHalf + 0.03;
        this.ropeSides = [[], [], [], []];
        RING.ropeHeights.forEach((h, level) => {
            for (let side = 0; side < 4; side++) {
                const rope = MeshBuilder.CreateCylinder(`rope_${level}_${side}`, { diameter: 0.05, height: P * 2, tessellation: 10 }, scene);
                rope.material = ropeMats[level];
                rope.parent = ring;
                rope.rotation.z = Math.PI / 2;
                rope.rotation.y = (side * Math.PI) / 2;
                const angle = (side * Math.PI) / 2;
                rope.position.set(Math.sin(angle) * R, h, Math.cos(angle) * R);
                rope.renderOutline = true;
                rope.outlineWidth = 0.008;
                rope.outlineColor = Color3.Black();
                this.ropeSides[side].push(rope);
            }
        });
        // Vertical rope spacers.
        const strapMat = createToonMaterial('strapMat', scene, { color: new Color3(0.92, 0.92, 0.92), rim: 0.3 });
        for (let side = 0; side < 4; side++) {
            for (const t of [-1 / 3, 1 / 3]) {
                const strap = MeshBuilder.CreateBox('strap', { width: 0.035, height: RING.ropeHeights[3] - RING.ropeHeights[0] + 0.06, depth: 0.035 }, scene);
                strap.material = strapMat;
                strap.parent = ring;
                const angle = (side * Math.PI) / 2;
                const along = t * P * 2;
                strap.position.set(Math.sin(angle) * R + Math.cos(angle) * along, (RING.ropeHeights[0] + RING.ropeHeights[3]) / 2, Math.cos(angle) * R - Math.sin(angle) * along);
                this.ropeSides[side].push(strap);
            }
        }
        for (const m of ring.getChildMeshes()) {
            m.isPickable = false;
            m.computeWorldMatrix(true);
            m.freezeWorldMatrix();
        }
    }

    buildLights() {
        const scene = this.scene;
        const coneMat = new ShaderMaterial('coneMat', scene, { vertex: 'lightCone', fragment: 'lightCone' }, {
            attributes: ['position', 'normal'],
            uniforms: ['world', 'viewProjection', 'height', 'cameraPosition', 'color', 'intensity'],
            needAlphaBlending: true,
        });
        const coneHeight = 5.6;
        coneMat.setFloat('height', coneHeight);
        coneMat.setColor3('color', new Color3(1, 0.95, 0.82));
        coneMat.setFloat('intensity', 0.11);
        coneMat.alphaMode = Constants.ALPHA_ADD;
        coneMat.backFaceCulling = false;
        coneMat.disableDepthWrite = true;
        coneMat.onBindObservable.add(() => coneMat.getEffect()?.setVector3('cameraPosition', scene.activeCamera.globalPosition));
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const cone = MeshBuilder.CreateCylinder('cone', { diameterTop: 1.0, diameterBottom: 3.6, height: coneHeight, tessellation: 24, cap: Mesh.NO_CAP }, scene);
                cone.material = coneMat;
                cone.position.set(sx * 1.75, coneHeight / 2, sz * 1.8);
                cone.isPickable = false;
                cone.parent = this.root;
                cone.alphaIndex = 10;
            }
        }
    }

    buildCrowd(seatMeshes) {
        const scene = this.scene;
        const points = sampleUpwardPoints(seatMeshes, 1800);
        const manager = new SpriteManager('crowd', '', points.length, { width: CROWD_CELL_W, height: CROWD_CELL_H }, scene);
        manager.texture = createCrowdTexture(scene);
        manager.isPickable = false;
        for (const p of points) {
            const s = new Sprite('fan', manager);
            s.position.set(p.x, p.y + 0.42, p.z);
            s.width = 0.6;
            s.height = 0.9;
            s.color.set(0.82, 0.82, 0.9, 1);
            const person = Math.floor(Math.random() * 8);
            s.cellIndex = person;
            this.crowd.push({ sprite: s, person, baseY: s.position.y, phase: Math.random() * Math.PI * 2, speed: 5 + Math.random() * 5, cheering: false });
        }
        const flashManager = new SpriteManager('flashes', '', 40, 64, scene);
        flashManager.texture = createDotTexture(scene);
        flashManager.blendMode = Constants.ALPHA_ADD;
        flashManager.fogEnabled = false;
        for (let i = 0; i < 40; i++) {
            const p = points[Math.floor(Math.random() * points.length)];
            const s = new Sprite('flash', flashManager);
            s.position.set(p.x, p.y + 0.9, p.z);
            s.size = 0;
            this.flashes.push({ sprite: s, life: 0 });
        }
    }

    /** Crowd reaction. 0 = murmur, 1 = on their feet. */
    setExcitement(x) {
        this.excitement = Math.max(0, Math.min(1, x));
    }

    /** Burst of camera flashes (knockdowns, KOs). */
    flashBurst(count = 12) {
        for (let i = 0; i < count; i++) {
            const f = this.flashes[Math.floor(Math.random() * this.flashes.length)];
            f.life = 0.12 + Math.random() * 0.1;
            f.delay = Math.random() * 0.6;
        }
    }

    /** Hide the rope side between the camera and the fighters so it never fills the screen. */
    updateRopes(cam) {
        const R = RING.ropeHalf + 0.12;
        const outside = [cam.z > R, cam.x > R, cam.z < -R, cam.x < -R];
        outside.forEach((hide, side) => {
            if (this.ropeSides[side].hidden === hide) return;
            this.ropeSides[side].hidden = hide;
            for (const m of this.ropeSides[side]) m.setEnabled(!hide);
        });
    }

    update(dt) {
        this.time += dt;
        if (this.scene.activeCamera) this.updateRopes(this.scene.activeCamera.position);
        const e = this.excitement;
        for (const fan of this.crowd) {
            if (Math.random() < dt * (0.15 + e * 1.5)) {
                fan.cheering = Math.random() < 0.08 + e * 0.85;
                fan.sprite.cellIndex = fan.person + (fan.cheering ? 8 : 0);
            }
            const bounce = fan.cheering ? 0.07 + e * 0.06 : 0.01;
            fan.sprite.position.y = fan.baseY + Math.abs(Math.sin(this.time * fan.speed + fan.phase)) * bounce;
        }
        for (const f of this.flashes) {
            if (f.life <= 0 && Math.random() < dt * e * e * 2) {
                f.life = 0.1 + Math.random() * 0.08;
                f.delay = 0;
            }
            if (f.delay > 0) {
                f.delay -= dt;
                continue;
            }
            if (f.life > 0) {
                f.life -= dt;
                f.sprite.size = f.life > 0 ? 0.9 + Math.random() * 0.6 : 0;
            }
        }
    }
}

/** Area-weighted random points on the upward-facing triangles of the given meshes (world space). */
function sampleUpwardPoints(meshes, count) {
    const tris = [];
    let total = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const e1 = new Vector3();
    const e2 = new Vector3();
    const n = new Vector3();
    for (const mesh of meshes) {
        const pos = mesh.getVerticesData('position');
        const idx = mesh.getIndices();
        if (!pos || !idx) continue;
        const world = mesh.getWorldMatrix();
        for (let i = 0; i < idx.length; i += 3) {
            Vector3.TransformCoordinatesFromFloatsToRef(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2], world, a);
            Vector3.TransformCoordinatesFromFloatsToRef(pos[idx[i + 1] * 3], pos[idx[i + 1] * 3 + 1], pos[idx[i + 1] * 3 + 2], world, b);
            Vector3.TransformCoordinatesFromFloatsToRef(pos[idx[i + 2] * 3], pos[idx[i + 2] * 3 + 1], pos[idx[i + 2] * 3 + 2], world, c);
            b.subtractToRef(a, e1);
            c.subtractToRef(a, e2);
            Vector3.CrossToRef(e1, e2, n);
            const area = n.length() / 2;
            if (area < 1e-4) continue;
            if (Math.abs(n.y) / (area * 2) < 0.8) continue;
            const mid = a.add(b).addInPlace(c).scaleInPlace(1 / 3);
            if (Math.hypot(mid.x, mid.z) < 6) continue;
            total += area;
            tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), cum: total });
        }
    }
    const points = [];
    for (let i = 0; i < count && tris.length; i++) {
        const r = Math.random() * total;
        let lo = 0;
        let hi = tris.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tris[mid].cum < r) lo = mid + 1;
            else hi = mid;
        }
        const t = tris[lo];
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
            u = 1 - u;
            v = 1 - v;
        }
        points.push(t.a.add(t.b.subtract(t.a).scale(u)).add(t.c.subtract(t.a).scale(v)));
    }
    return points;
}
