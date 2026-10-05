import { DynamicTexture, Texture } from '@babylonjs/core';

// Every texture in the arena is painted at runtime on a 2D canvas: no image files to ship.

export const FONT_LATIN = '"Bangers", "Impact", sans-serif';
export const FONT_JP = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

function makeTexture(name, scene, width, height, paint, { mipmaps = true, wrap = false } = {}) {
    const tex = new DynamicTexture(name, { width, height }, scene, mipmaps, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = tex.getContext();
    paint(ctx, width, height);
    tex.update(false);
    tex.hasAlpha = true;
    if (wrap) {
        tex.wrapU = Texture.WRAP_ADDRESSMODE;
        tex.wrapV = Texture.WRAP_ADDRESSMODE;
    }
    return tex;
}

/** Ring canvas: cream mat, apron border, big center logo. */
export function createCanvasTexture(scene, { size = 1024, insideRatio = 0.806 } = {}) {
    const tex = makeTexture('canvasTex', scene, size, size, (ctx, w, h) => {
        ctx.fillStyle = '#1d2a6b';
        ctx.fillRect(0, 0, w, h);
        const inset = (w * (1 - insideRatio)) / 2;
        ctx.fillStyle = '#efe6d2';
        ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
        // Worn canvas: soft blotches.
        for (let i = 0; i < 160; i++) {
            ctx.fillStyle = `rgba(120, 100, 70, ${Math.random() * 0.018})`;
            const r = 6 + Math.random() * 30;
            ctx.beginPath();
            ctx.arc(inset + Math.random() * (w - inset * 2), inset + Math.random() * (h - inset * 2), r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Center logo.
        const cx = w / 2;
        const cy = h / 2;
        ctx.strokeStyle = 'rgba(190, 30, 45, 0.85)';
        ctx.lineWidth = w * 0.012;
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = w * 0.004;
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.185, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(190, 30, 45, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(w * 0.075)}px ${FONT_JP}`;
        ctx.fillText('はじめの一歩', cx, cy - w * 0.02);
        ctx.font = `${Math.round(w * 0.04)}px ${FONT_LATIN}`;
        ctx.fillStyle = 'rgba(30, 40, 100, 0.85)';
        ctx.fillText('HAJIME NO IPPO', cx, cy + w * 0.065);
        // Apron lettering on each side.
        ctx.font = `${Math.round(w * 0.035)}px ${FONT_LATIN}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        for (let side = 0; side < 4; side++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((side * Math.PI) / 2);
            ctx.fillText('KAMOGAWA BOXING GYM', 0, h / 2 - inset / 2);
            ctx.restore();
        }
    }, { wrap: true });
    // Ground UVs run toward -z for the canvas' top row; flip so the logo reads upright from the TV side.
    tex.vScale = -1;
    return tex;
}

/** Ring skirt banner, tiled around the platform. */
export function createSkirtTexture(scene) {
    return makeTexture('skirtTex', scene, 1024, 160, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#0d1240');
        g.addColorStop(1, '#05071c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#c8102e';
        ctx.fillRect(0, 0, w, h * 0.08);
        ctx.fillRect(0, h * 0.92, w, h * 0.08);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${Math.round(h * 0.42)}px ${FONT_JP}`;
        ctx.fillText('はじめの一歩', w * 0.27, h * 0.52);
        ctx.font = `${Math.round(h * 0.42)}px ${FONT_LATIN}`;
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('HAJIME NO IPPO', w * 0.74, h * 0.54);
    }, { wrap: true });
}

const SHIRTS = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#8338ec', '#fb5607', '#3a86ff', '#ffffff', '#222222', '#ff006e', '#70e000'];
const SKINS = ['#f2c9a0', '#e0ac82', '#c68d5f', '#8d5a3b', '#f7d7b5'];
const HAIRS = ['#1b1b1b', '#2b1d14', '#4a3222', '#6b6b6b', '#c9a15b'];

export const CROWD_CELLS = 16; // 8 calm + 8 cheering variants
export const CROWD_CELL_W = 64;
export const CROWD_CELL_H = 96;

/** Spectator silhouettes: cell i (0..7) is calm, cell i + 8 is the same person cheering. */
export function createCrowdTexture(scene) {
    const cols = 8;
    return makeTexture('crowdTex', scene, CROWD_CELL_W * cols, CROWD_CELL_H * 2, (ctx) => {
        for (let i = 0; i < 8; i++) {
            const shirt = SHIRTS[(i * 5) % SHIRTS.length];
            const skin = SKINS[i % SKINS.length];
            const hair = HAIRS[(i * 3) % HAIRS.length];
            for (let cheer = 0; cheer < 2; cheer++) {
                const x0 = i * CROWD_CELL_W;
                const y0 = cheer * CROWD_CELL_H;
                drawSpectator(ctx, x0, y0, CROWD_CELL_W, CROWD_CELL_H, { shirt, skin, hair, cheer: cheer === 1, variant: i });
            }
        }
    }, { mipmaps: true });
}

function drawSpectator(ctx, x0, y0, w, h, { shirt, skin, hair, cheer, variant }) {
    ctx.save();
    ctx.translate(x0, y0);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#05050a';
    const cx = w / 2;
    const headY = cheer ? h * 0.3 : h * 0.36;
    const headR = w * 0.17;
    // Arms
    ctx.fillStyle = shirt;
    if (cheer) {
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx + s * w * 0.2, h * 0.58);
            ctx.lineTo(cx + s * w * 0.42, h * 0.12);
            ctx.lineTo(cx + s * w * 0.3, h * 0.08);
            ctx.lineTo(cx + s * w * 0.08, h * 0.55);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = skin;
            ctx.beginPath();
            ctx.arc(cx + s * w * 0.37, h * 0.08, w * 0.07, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = shirt;
        }
    }
    // Torso
    ctx.beginPath();
    const top = headY + headR * 0.8;
    ctx.moveTo(cx - w * 0.36, h);
    ctx.quadraticCurveTo(cx - w * 0.38, top + h * 0.05, cx - w * 0.1, top);
    ctx.lineTo(cx + w * 0.1, top);
    ctx.quadraticCurveTo(cx + w * 0.38, top + h * 0.05, cx + w * 0.36, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Hair
    ctx.fillStyle = hair;
    ctx.beginPath();
    if (variant % 3 === 0) ctx.arc(cx, headY - headR * 0.2, headR * 1.02, Math.PI, Math.PI * 2);
    else if (variant % 3 === 1) ctx.ellipse(cx, headY - headR * 0.45, headR * 1.05, headR * 0.6, 0, Math.PI, Math.PI * 2);
    else {
        ctx.arc(cx, headY - headR * 0.1, headR * 1.1, Math.PI * 0.9, Math.PI * 2.1);
        ctx.lineTo(cx + headR * 1.1, headY + headR * 0.6);
        ctx.lineTo(cx - headR * 1.1, headY + headR * 0.6);
    }
    ctx.closePath();
    ctx.fill();
    if (cheer) {
        // Open mouth
        ctx.fillStyle = '#2a0a0a';
        ctx.beginPath();
        ctx.ellipse(cx, headY + headR * 0.45, headR * 0.28, headR * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Anime impact burst: jagged white star with a hot core. */
export function createImpactTexture(scene) {
    return makeTexture('impactTex', scene, 256, 256, (ctx, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        const spikes = 14;
        ctx.beginPath();
        for (let i = 0; i <= spikes * 2; i++) {
            const a = (i / (spikes * 2)) * Math.PI * 2;
            const r = i % 2 === 0 ? w * (0.42 + Math.random() * 0.08) : w * (0.16 + Math.random() * 0.06);
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ffd23f';
        ctx.stroke();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.2, 0, Math.PI * 2);
        ctx.fill();
    }, { mipmaps: false });
}

/** Soft round dot, for sweat drops, dust and camera flashes. */
export function createDotTexture(scene) {
    return makeTexture('dotTex', scene, 64, 64, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }, { mipmaps: false });
}

/** Blob shadow under the fighters. */
export function createShadowTexture(scene) {
    return makeTexture('shadowTex', scene, 128, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(0,0,0,0.55)');
        g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }, { mipmaps: false });
}
