// Asset pipeline: turns the heavy source models in raw/ into web-ready files in public/assets/models.
//
//   npm run assets
//
// raw/ is not committed (the sources weigh ~130 MB). Copy them from the 2024 repo:
//   raw/BoxerAnimations.glb   <- src/characters/BoxerAnimations.glb
//   raw/stadium.glb           <- src/assets/models/scene.glb   (optional)

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, meshopt, textureCompress, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, statSync } from 'node:fs';

const RAW = 'raw';
const OUT = 'public/assets/models';

// Source animation name -> id used by the game code.
const ANIMATION_IDS = {
    'Boxing stance': 'stance',
    'Boxing stance 2': 'stance2',
    'Jab body': 'jab',
    'Cross': 'cross',
    'Left hook': 'hook',
    'Left uppercut': 'uppercut',
    'right upper(BODY)': 'body',
    'Head hit': 'hitHead',
    'Body hit': 'hitBody',
    'Dodging backwards': 'dodge',
    'Step forward': 'stepForward',
    'step backward': 'stepBack',
    'Left pivot': 'pivotLeft',
    'Right pivot': 'pivotRight',
    'warm up': 'warmup',
};
// Clips already named with a game id are kept as-is (see docs/ART_BRIEF.md).
const KNOWN_IDS = new Set([...Object.values(ANIMATION_IDS), 'block', 'knockedOut', 'getUp', 'victory', 'taunt', 'strafeLeft', 'strafeRight']);

// These clips walk the hips away from the origin. The game moves the fighter itself,
// so the horizontal part of that motion is flattened to the first key.
const IN_PLACE = new Set(['stepForward', 'stepBack', 'dodge', 'pivotLeft', 'pivotRight', 'strafeLeft', 'strafeRight']);

const mb = (path) => (statSync(path).size / 1e6).toFixed(2) + ' MB';

async function createIO() {
    await MeshoptEncoder.ready;
    return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}

function renameAndFilterAnimations(doc) {
    for (const anim of doc.getRoot().listAnimations()) {
        const id = ANIMATION_IDS[anim.getName()] ?? (KNOWN_IDS.has(anim.getName()) ? anim.getName() : null);
        if (!id) {
            anim.dispose();
            continue;
        }
        anim.setName(id);
    }
}

function flattenRootMotion(doc) {
    for (const anim of doc.getRoot().listAnimations()) {
        if (!IN_PLACE.has(anim.getName())) continue;
        for (const channel of anim.listChannels()) {
            const node = channel.getTargetNode();
            if (!node || !node.getName().endsWith('Hips') || channel.getTargetPath() !== 'translation') continue;
            const output = channel.getSampler().getOutput();
            const values = output.getArray().slice();
            // Hips local space is Blender Z-up: x = side, y = forward, z = height.
            const x0 = values[0];
            const y0 = values[1];
            for (let i = 0; i < values.length; i += 3) {
                values[i] = x0;
                values[i + 1] = y0;
            }
            output.setArray(values);
        }
    }
}

// The fighters are cel-shaded: only the color map is used. Normal/specular/gloss maps are dropped.
function keepOnlyColorTextures(doc) {
    for (const material of doc.getRoot().listMaterials()) {
        const diffuse = material.getExtension('KHR_materials_pbrSpecularGlossiness')?.getDiffuseTexture?.();
        if (diffuse && !material.getBaseColorTexture()) material.setBaseColorTexture(diffuse);
        material.setNormalTexture(null);
        material.setMetallicRoughnessTexture(null);
        material.setOcclusionTexture(null);
        material.setEmissiveTexture(null);
        material.setMetallicFactor(0);
        material.setRoughnessFactor(1);
        for (const ext of material.listExtensions()) ext.dispose?.();
    }
    for (const ext of doc.getRoot().listExtensionsUsed()) {
        if (ext.extensionName === 'KHR_materials_pbrSpecularGlossiness') ext.dispose();
    }
}

async function boxer(io) {
    const src = process.env.BOXER ?? `${RAW}/BoxerAnimations.glb`;
    const dst = `${OUT}/boxer.glb`;
    const doc = await io.read(src);
    renameAndFilterAnimations(doc);
    flattenRootMotion(doc);
    keepOnlyColorTextures(doc);
    await doc.transform(
        dedup(),
        prune(),
        resample({ tolerance: 1e-4 }),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 88 }),
        quantize(),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await io.write(dst, doc);
    console.log(`boxer   ${mb(src)} -> ${mb(dst)}  (${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')})`);
}

async function stadium(io) {
    const src = `${RAW}/stadium.glb`;
    if (!existsSync(src)) return;
    const dst = `${OUT}/stadium.glb`;
    const doc = await io.read(src);
    await MeshoptSimplifier.ready;
    await doc.transform(
        dedup(),
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0.04, error: 0.02 }),
        prune(),
        quantize(),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await io.write(dst, doc);
    console.log(`stadium ${mb(src)} -> ${mb(dst)}`);
}

const io = await createIO();
await boxer(io);
if (process.argv.includes('--stadium')) await stadium(io);
