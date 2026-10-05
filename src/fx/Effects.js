import {
    DefaultRenderingPipeline, PostProcess, Effect, MeshBuilder, Color3, Color4, Vector3, Vector2,
    ParticleSystem, Mesh, Matrix, Scene,
} from '@babylonjs/core/pure';
import { createImpactTexture, createDotTexture } from '../render/ProceduralTextures.js';
import { createUnlitMaterial } from '../render/UnlitMaterial.js';

Effect.ShadersStore.animeFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float impact;
uniform float lines;
uniform vec2 focus;
uniform float time;
uniform float aspect;
uniform float danger;
uniform float flash;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main(void) {
    vec4 c = texture2D(textureSampler, vUV);
    vec2 d = vUV - focus;
    d.x *= aspect;
    float r = length(d);
    if (lines > 0.0) {
        float ang = atan(d.y, d.x);
        float slice = floor((ang + 3.14159) / 6.28318 * 160.0);
        float rnd = hash(slice + floor(time * 14.0) * 17.0);
        float inner = 0.16 + rnd * 0.3;
        float streak = step(0.52, rnd) * smoothstep(inner, inner + 0.3, r);
        c.rgb = mix(c.rgb, vec3(1.0), streak * lines * 0.85);
    }
    if (impact > 0.0) {
        float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 mono = vec3(step(l, 0.38));
        c.rgb = mix(c.rgb, mono, impact);
    }
    float v = smoothstep(0.42, 1.0, r);
    c.rgb = mix(c.rgb, vec3(0.55, 0.0, 0.04), v * danger);
    c.rgb = mix(c.rgb, vec3(1.0), flash);
    gl_FragColor = c;
}
`;

/** Visual effects for the fight: post-processing, impact bursts, particles. */
export class Effects {
    /** @param {Scene} scene  @param {import('@babylonjs/core').Camera} camera */
    constructor(scene, camera, quality = 'high') {
        this.scene = scene;
        this.camera = camera;
        this.time = 0;
        this.impact = 0;
        this.lines = 0;
        this.linesDecay = 1;
        this.danger = 0;
        this.flash = 0;
        this.focus = new Vector2(0.5, 0.5);
        this.chroma = 0;
        this.sparks = [];
        this.buildPipeline(quality);
        this.buildSparks();
        this.buildParticles();
    }

    buildPipeline(quality) {
        const scene = this.scene;
        this.quality = quality;
        if (quality !== 'low') {
            const p = new DefaultRenderingPipeline('pipeline', true, scene, [this.camera]);
            p.samples = 1;
            p.fxaaEnabled = true;
            p.bloomEnabled = true;
            p.bloomThreshold = 0.9;
            p.bloomWeight = 0.45;
            p.bloomKernel = 48;
            p.bloomScale = 0.5;
            p.imageProcessingEnabled = true;
            p.imageProcessing.contrast = 1.18;
            p.imageProcessing.exposure = 1.04;
            p.imageProcessing.vignetteEnabled = true;
            p.imageProcessing.vignetteWeight = 2.2;
            p.imageProcessing.vignetteColor = new Color4(0, 0, 0.05, 0);
            p.chromaticAberrationEnabled = true;
            p.chromaticAberration.aberrationAmount = 0;
            this.pipeline = p;
        }
        this.post = new PostProcess('anime', 'anime', ['impact', 'lines', 'focus', 'time', 'aspect', 'danger', 'flash'], null, 1, this.camera);
        this.post.onApply = (effect) => {
            effect.setFloat('impact', this.impact > 0 ? 1 : 0);
            effect.setFloat('lines', this.lines);
            effect.setVector2('focus', this.focus);
            effect.setFloat('time', this.time);
            effect.setFloat('aspect', this.scene.getEngine().getAspectRatio(this.camera));
            effect.setFloat('danger', this.danger);
            effect.setFloat('flash', this.flash);
        };
    }

    buildSparks() {
        const scene = this.scene;
        const tex = createImpactTexture(scene);
        for (let i = 0; i < 8; i++) {
            const mat = createUnlitMaterial(`sparkMat${i}`, scene, { texture: tex });
            const plane = MeshBuilder.CreatePlane(`spark${i}`, { size: 1 }, scene);
            plane.material = mat;
            plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
            plane.isPickable = false;
            plane.renderingGroupId = 1;
            plane.setEnabled(false);
            this.sparks.push({ mesh: plane, mat, life: 0, max: 0, size: 0 });
        }
        scene.setRenderingAutoClearDepthStencil(1, false);
    }

    buildParticles() {
        const scene = this.scene;
        const dot = createDotTexture(scene);
        const sweat = new ParticleSystem('sweat', 300, scene);
        sweat.particleTexture = dot;
        sweat.emitter = Vector3.Zero();
        sweat.minSize = 0.015;
        sweat.maxSize = 0.045;
        sweat.minLifeTime = 0.25;
        sweat.maxLifeTime = 0.7;
        sweat.color1 = new Color4(0.85, 0.95, 1, 1);
        sweat.color2 = new Color4(1, 1, 1, 1);
        sweat.colorDead = new Color4(1, 1, 1, 0);
        sweat.gravity = new Vector3(0, -7, 0);
        sweat.minEmitPower = 1.2;
        sweat.maxEmitPower = 3.2;
        sweat.emitRate = 0;
        sweat.manualEmitCount = 0;
        sweat.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        sweat.renderingGroupId = 1;
        sweat.start();
        this.sweat = sweat;

        const dust = new ParticleSystem('dust', 200, scene);
        dust.particleTexture = dot;
        dust.emitter = Vector3.Zero();
        dust.minSize = 0.12;
        dust.maxSize = 0.4;
        dust.minLifeTime = 0.5;
        dust.maxLifeTime = 1.2;
        dust.color1 = new Color4(0.9, 0.86, 0.78, 0.5);
        dust.color2 = new Color4(0.8, 0.78, 0.72, 0.35);
        dust.colorDead = new Color4(0.8, 0.78, 0.72, 0);
        dust.gravity = new Vector3(0, 0.4, 0);
        dust.minEmitPower = 0.4;
        dust.maxEmitPower = 1.6;
        dust.direction1 = new Vector3(-1, 0.2, -1);
        dust.direction2 = new Vector3(1, 0.6, 1);
        dust.emitRate = 0;
        dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        dust.start();
        this.dust = dust;
    }

    spark(point, { size = 0.5, color = Color3.White(), life = 0.14 } = {}) {
        const s = this.sparks.find((x) => x.life <= 0) ?? this.sparks[0];
        s.mesh.position.copyFrom(point);
        s.mesh.rotation.z = Math.random() * Math.PI * 2;
        s.mat.setColor3('color', color);
        s.life = life;
        s.max = life;
        s.size = size;
        s.mesh.setEnabled(true);
    }

    sweatBurst(point, dir, count = 30) {
        this.sweat.emitter = point.clone();
        this.sweat.direction1 = dir.add(new Vector3(-0.6, 0.4, -0.6));
        this.sweat.direction2 = dir.add(new Vector3(0.6, 1.2, 0.6));
        this.sweat.manualEmitCount = count;
    }

    dustBurst(point, count = 40) {
        this.dust.emitter = point.clone();
        this.dust.manualEmitCount = count;
    }

    impactFrame(seconds = 0.07) {
        this.impact = Math.max(this.impact, seconds);
    }

    speedLines(amount = 1, seconds = 0.6, worldPoint = null) {
        this.lines = Math.max(this.lines, amount);
        this.linesDecay = amount / Math.max(0.05, seconds);
        if (worldPoint) this.setFocus(worldPoint);
    }

    whiteFlash(amount = 0.6) {
        this.flash = Math.max(this.flash, amount);
    }

    aberration(amount = 30) {
        this.chroma = Math.max(this.chroma, amount);
    }

    setFocus(worldPoint) {
        const engine = this.scene.getEngine();
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        const p = Vector3.Project(worldPoint, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
        this.focus.set(Math.min(1, Math.max(0, p.x / w)), Math.min(1, Math.max(0, 1 - p.y / h)));
    }

    setDanger(x) {
        this.danger = x;
    }

    /** @param {number} dt real seconds (effects keep moving during hitstop) */
    update(dt) {
        this.time += dt;
        this.impact = Math.max(0, this.impact - dt);
        this.lines = Math.max(0, this.lines - dt * this.linesDecay);
        this.flash = Math.max(0, this.flash - dt * 4);
        this.chroma = Math.max(0, this.chroma - dt * 120);
        if (this.pipeline) this.pipeline.chromaticAberration.aberrationAmount = this.chroma;
        for (const s of this.sparks) {
            if (s.life <= 0) continue;
            s.life -= dt;
            if (s.life <= 0) {
                s.mesh.setEnabled(false);
                continue;
            }
            const t = 1 - s.life / s.max;
            const scale = s.size * (0.35 + 0.9 * Math.sqrt(t));
            s.mesh.scaling.setAll(scale);
            s.mat.setFloat('alpha', 1 - t * t);
        }
    }

    dispose() {
        this.pipeline?.dispose();
        this.post.dispose(this.camera);
        this.sweat.dispose();
        this.dust.dispose();
        for (const s of this.sparks) s.mesh.dispose();
    }
}
