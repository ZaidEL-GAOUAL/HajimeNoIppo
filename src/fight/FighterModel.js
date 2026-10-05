import {
    TransformNode, MeshBuilder, Mesh, Color3, Color4, Quaternion, Vector3, Space, StandardMaterial, Scene, VertexBuffer,
} from '@babylonjs/core';
import { createToonMaterial } from '../render/ToonMaterial.js';
import { createShadowTexture } from '../render/ProceduralTextures.js';
import { Animator } from './Animator.js';

const BONE_NAME = /mixamorig\d*:(\w+)$/;
const GUARD_BONES = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];
const FINGER_ROOTS = ['Thumb1', 'Index1', 'Middle1', 'Ring1', 'Pinky1'];
const OUTLINE_WIDTH = 0.009; // skinned mesh units are meters
const SKIN_REFERENCE = '#e8c4a0';

let shadowTexture = null;

/**
 * The visual side of a fighter: model instance, cel materials, gloves, animation blending and
 * the procedural layer on top of the clips (guard pose, flinches, lean, knockdown fall).
 */
export class FighterModel {
    /**
     * @param {Scene} scene
     * @param {import('@babylonjs/core').AssetContainer} container boxer.glb
     * @param {object} data fighter roster entry
     * @param {number} index 0 or 1
     * @param {{ guardPose: Record<string, Quaternion> }} shared
     */
    constructor(scene, container, data, index, shared, { alt = false } = {}) {
        this.scene = scene;
        this.data = data;
        this.alt = alt;
        this.index = index;
        this.root = new TransformNode(`fighter${index}`, scene);
        // Pitch/roll are applied on an inner node so the fall pivots at the feet while the root keeps its yaw.
        this.tilt = new TransformNode(`fighter${index}_tilt`, scene);
        this.tilt.parent = this.root;
        this.tilt.rotationQuaternion = Quaternion.Identity();

        const prefix = `f${index}_`;
        const inst = container.instantiateModelsToScene((n) => prefix + n, false, { doNotInstantiate: true });
        this.modelRoot = inst.rootNodes[0];
        this.modelRoot.parent = this.tilt;
        const { height, width } = data.build;
        this.tilt.scaling.set(width, height, width);

        this.groups = {};
        for (const g of inst.animationGroups) this.groups[g.name.slice(prefix.length)] = g;
        this.animator = new Animator(this.groups);

        this.bones = {};
        for (const node of this.modelRoot.getChildTransformNodes(false)) {
            const m = BONE_NAME.exec(node.name);
            if (m) this.bones[m[1]] = node;
        }
        for (const node of Object.values(this.bones)) {
            if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
        }

        this.meshes = this.modelRoot.getChildMeshes(false);
        this.materials = [];
        this.applyMaterials(container);
        // A model that ships its own gloves uses them; otherwise gloves are built on the hand bones.
        this.proceduralGloves = this.modelGloves.length === 0;
        this.gloves = this.proceduralGloves ? [this.createGlove('Left'), this.createGlove('Right')] : this.modelGloves;
        this.createShadow();

        this.guardPose = shared.guardPose;
        this.guardWeight = 0;
        this.guardTarget = 0;
        this.headSnap = { angle: 0, vel: 0 };
        this.bodyBend = { angle: 0, vel: 0 };
        this.lean = 0;
        this.leanTarget = 0;
        this.fall = 0; // 0 standing .. 1 flat on the canvas
        this.fallTarget = 0;
        this.fallVel = 0;
        this.flash = 0;
        this.flashColor = new Color3(1, 1, 1);
        this._tmpQ = new Quaternion();
        this._right = new Vector3();

        this._observer = scene.onAfterAnimationsObservable.add(() => this.applyProcedural());
    }

    applyMaterials(container) {
        // Mirror match: the blue-corner copy swaps its outfit colors and wears blue gloves.
        const base = this.data.colors;
        const c = this.alt ? { ...base, top: base.bottom, bottom: base.top, gloves: '#1d4ed8' } : base;
        this.colors = c;
        const texture = container.textures.find((t) => /Diffuse|baseColor/i.test(t.name)) ?? container.textures[0];
        const make = (name, opts) => {
            const mat = createToonMaterial(`${name}_${this.index}`, this.scene, { texture, ...opts });
            this.materials.push(mat);
            return mat;
        };
        // The texture already carries a skin tone; the roster color only nudges it.
        const ref = Color3.FromHexString(SKIN_REFERENCE);
        const want = Color3.FromHexString(c.skin);
        const nudge = (a, b) => Math.min(1.25, Math.max(0.7, a / b));
        const skin = make('skin', { color: new Color3(nudge(want.r, ref.r), nudge(want.g, ref.g), nudge(want.b, ref.b)).scale(1.12), rim: 0.55, spec: 0.08 });
        const top = make('top', { rim: 0.5 });
        top.setColor4('tint', Color4.FromHexString(c.top + 'ff'));
        const bottom = make('bottom', { rim: 0.45 });
        bottom.setColor4('tint', Color4.FromHexString(c.bottom + 'ff'));
        const shoes = make('shoes', { rim: 0.3 });
        shoes.setColor4('tint', Color4.FromHexString(c.shoes + 'ff'));
        const hair = make('hair', { alphaCutoff: 0.45, backFaceCulling: false, rim: 0.4, spec: 0.3 });
        hair.setColor4('tint', Color4.FromHexString(c.hair + 'ff'));
        const lashes = make('lashes', { alphaCutoff: 0.5, backFaceCulling: false, rim: 0 });

        const gloves = make('gloves', { rim: 0.7, spec: 0.55 });
        gloves.setColor4('tint', Color4.FromHexString(c.gloves + 'ff'));
        const wraps = make('wraps', { rim: 0.3 });
        wraps.setColor4('tint', Color4.FromHexString('#f2f2f2ff'));
        this.modelGloves = [];

        // Mesh roles come from their names, so a new model only has to follow the naming in docs/ART_BRIEF.md.
        const hairVariants = this.meshes.filter((m) => /hair_\w+/i.test(m.name));
        const wantedHair = hairVariants.find((m) => m.name.toLowerCase().endsWith(`hair_${this.data.id}`)) ?? hairVariants[0];
        for (const mesh of this.meshes) {
            const name = mesh.name.toLowerCase();
            let mat = skin;
            let outline = true;
            if (/glove/.test(name)) {
                mat = gloves;
                this.modelGloves.push(mesh);
            } else if (/wrap|tape/.test(name)) mat = wraps;
            else if (/hood|shirt|top|tank|robe|jacket/.test(name)) mat = top;
            else if (/pant|trunk|short/.test(name)) mat = bottom;
            else if (/shoe|sneaker|boot/.test(name)) mat = shoes;
            else if (/lash|brow/.test(name)) {
                mat = lashes;
                outline = false;
            } else if (/hair/.test(name)) {
                mat = hair;
                outline = false;
                if (hairVariants.includes(mesh) && mesh !== wantedHair) mesh.setEnabled(false);
            }
            mesh.material = mat;
            mesh.isPickable = false;
            mesh.alwaysSelectAsActiveMesh = true;
            if (outline) {
                mesh.renderOutline = true;
                mesh.outlineWidth = OUTLINE_WIDTH;
                mesh.outlineColor = new Color3(0.02, 0.02, 0.05);
            }
        }
        const isLeft = (m) => (/left|_l\b|\.l\b/i.test(m.name) ? 1 : 0);
        this.modelGloves.sort((a, b) => isLeft(b) - isLeft(a));
    }

    createGlove(side) {
        const scene = this.scene;
        // Built in hand-bone space (centimeters, +Y runs from the wrist to the fingers).
        const fist = MeshBuilder.CreateSphere('glove_fist', { diameter: 1, segments: 12 }, scene);
        fist.scaling.set(13, 17, 14);
        fist.position.set(0, 9, 1.5);
        const knuckle = MeshBuilder.CreateSphere('glove_knuckle', { diameter: 1, segments: 10 }, scene);
        knuckle.scaling.set(12, 9, 13);
        knuckle.position.set(0, 14, 2.5);
        const thumb = MeshBuilder.CreateSphere('glove_thumb', { diameter: 1, segments: 8 }, scene);
        thumb.scaling.set(5, 9, 5);
        thumb.position.set(side === 'Left' ? 6 : -6, 8, 4);
        const cuff = MeshBuilder.CreateCylinder('glove_cuff', { diameter: 10.5, height: 9, tessellation: 14 }, scene);
        cuff.position.set(0, -1.5, 0.5);
        const glove = Mesh.MergeMeshes([fist, knuckle, thumb, cuff], true, true);
        glove.name = `glove${side}_${this.index}`;
        // Merging bakes the non-uniform scales into the normals; the outline pass needs unit normals.
        const normals = glove.getVerticesData(VertexBuffer.NormalKind);
        for (let i = 0; i < normals.length; i += 3) {
            const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
            normals[i] /= len;
            normals[i + 1] /= len;
            normals[i + 2] /= len;
        }
        glove.setVerticesData(VertexBuffer.NormalKind, normals);
        const mat = createToonMaterial(`gloveMat${side}_${this.index}`, scene, {
            color: Color3.FromHexString(this.colors.gloves),
            rim: 0.7,
            spec: 0.55,
        });
        this.materials.push(mat);
        glove.material = mat;
        glove.parent = this.bones[`${side}Hand`];
        glove.renderOutline = true;
        glove.outlineWidth = 0.7;
        glove.outlineColor = new Color3(0.02, 0.02, 0.05);
        glove.isPickable = false;
        glove.alwaysSelectAsActiveMesh = true;
        return glove;
    }

    createShadow() {
        shadowTexture ??= createShadowTexture(this.scene);
        const mat = new StandardMaterial(`shadowMat${this.index}`, this.scene);
        mat.diffuseColor = Color3.Black();
        mat.specularColor = Color3.Black();
        mat.disableLighting = true;
        mat.opacityTexture = shadowTexture;
        mat.disableDepthWrite = true;
        this.shadow = MeshBuilder.CreateGround(`shadow${this.index}`, { width: 1.1, height: 1.1 }, this.scene);
        this.shadow.material = mat;
        this.shadow.isPickable = false;
        this.shadow.position.y = 0.004;
    }

    /** Capture arm rotations at a clip frame (used once to build the high-guard pose). */
    static captureGuardPose(model, clip, frame) {
        const g = model.groups[clip];
        g.start(false, 1, frame, frame);
        g.goToFrame(frame);
        const pose = {};
        for (const name of GUARD_BONES) pose[name] = model.bones[name].rotationQuaternion.clone();
        g.stop();
        return pose;
    }

    play(id, opts) {
        this.animator.play(id, opts);
    }

    hitFlash(color = Color3.White(), amount = 0.85) {
        this.flash = amount;
        this.flashColor.copyFrom(color);
    }

    /** Spring impulses for the procedural reaction layer. */
    snapHead(strength) {
        this.headSnap.vel -= strength;
    }

    bendBody(strength) {
        this.bodyBend.vel += strength;
    }

    /** Called every render frame with real (scaled) dt. */
    update(dt) {
        this.animator.update(dt);
        const k = 1 - Math.exp(-dt * 14);
        this.guardWeight += (this.guardTarget - this.guardWeight) * k;
        this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt * 8));
        stepSpring(this.headSnap, dt, 170, 13);
        stepSpring(this.bodyBend, dt, 140, 12);
        // Knockdown fall accelerates like gravity, then rebounds a little.
        if (this.fallTarget > this.fall) {
            this.fallVel += dt * 7.5;
            this.fall += this.fallVel * dt;
            if (this.fall >= 1) {
                this.fall = 1;
                this.fallVel = -this.fallVel * 0.18;
                if (Math.abs(this.fallVel) < 0.05) this.fallVel = 0;
            }
        } else if (this.fallTarget < this.fall) {
            this.fallVel = 0;
            this.fall = Math.max(this.fallTarget, this.fall - dt * 1.6);
        }
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 6);
        const flash = new Color4(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash);
        for (const mat of this.materials) mat.setColor4('flash', flash);

        const pitch = -this.fall * (Math.PI / 2 - 0.03);
        Quaternion.RotationYawPitchRollToRef(0, pitch, this.lean, this.tilt.rotationQuaternion);
        this.tilt.position.y = Math.sin(this.fall * Math.PI / 2) * 0.16 * this.data.build.width;

        const hips = this.bones.Hips;
        if (hips) {
            const p = hips.getAbsolutePosition();
            this.shadow.position.x = p.x;
            this.shadow.position.z = p.z;
            const s = 1 + this.fall * 0.9;
            this.shadow.scaling.set(this.data.build.width * (1 + this.fall * 0.3), 1, this.data.build.width * s);
            this.shadow.rotation.y = this.root.rotation.y;
        }
    }

    /** Runs right after the clips are evaluated, before rendering. */
    applyProcedural() {
        if (this.proceduralGloves) {
            for (const f of FINGER_ROOTS) {
                this.bones[`Left${f}`]?.scaling.setAll(0.35);
                this.bones[`Right${f}`]?.scaling.setAll(0.35);
            }
        }
        if (this.guardWeight > 0.001 && this.guardPose) {
            for (const name of GUARD_BONES) {
                const bone = this.bones[name];
                Quaternion.SlerpToRef(bone.rotationQuaternion, this.guardPose[name], this.guardWeight, bone.rotationQuaternion);
            }
        }
        const yaw = this.root.rotation.y;
        this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        if (Math.abs(this.headSnap.angle) > 0.001) this.bones.Neck?.rotate(this._right, this.headSnap.angle, Space.WORLD);
        if (Math.abs(this.bodyBend.angle) > 0.001) this.bones.Spine1?.rotate(this._right, this.bodyBend.angle, Space.WORLD);
    }

    getBonePosition(name) {
        return this.bones[name].getAbsolutePosition();
    }

    getGlovePosition(side) {
        if (!this.proceduralGloves) return this.getBonePosition(side === 'left' ? 'LeftHand' : 'RightHand');
        const glove = this.gloves[side === 'left' ? 0 : 1];
        return glove.getBoundingInfo().boundingSphere.centerWorld;
    }

    /** Whether the model ships a given clip (block, knockedOut, getUp, victory are optional). */
    has(clip) {
        return !!this.groups[clip];
    }

    setVisible(visible) {
        this.root.setEnabled(visible);
        this.shadow.setEnabled(visible);
    }

    dispose() {
        this.scene.onAfterAnimationsObservable.remove(this._observer);
        this.animator.stopAll();
        for (const g of Object.values(this.groups)) g.dispose();
        this.shadow.dispose();
        this.root.dispose(false, true);
    }
}

function stepSpring(s, dt, stiffness, damping) {
    s.vel += (-stiffness * s.angle - damping * s.vel) * dt;
    s.angle += s.vel * dt;
}
