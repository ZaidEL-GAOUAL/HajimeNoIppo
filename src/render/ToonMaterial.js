import { ShaderMaterial, ShaderStore, Color3, Color4, Vector3 } from '@babylonjs/core';

// Cel shader used by everything in the arena: hard light/shadow terminator, a thin highlight
// band and a view-dependent rim light. Works on skinned meshes (fighters) and static ones.

ShaderStore.ShadersStore.toonVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
#ifdef UV1
attribute vec2 uv;
#endif
#include<bonesDeclaration>
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec2 vUV;
void main(void) {
#include<instancesVertex>
#include<bonesVertex>
    vec4 worldPos = finalWorld * vec4(position, 1.0);
    vPositionW = worldPos.xyz;
    vNormalW = normalize(mat3(finalWorld) * normal);
#ifdef UV1
    vUV = uv;
#else
    vUV = vec2(0.0);
#endif
    gl_Position = viewProjection * worldPos;
}
`;

ShaderStore.ShadersStore.toonFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec2 vUV;
uniform sampler2D diffuseSampler;
uniform float hasTexture;
uniform vec3 baseColor;
uniform vec3 lightDir;
uniform vec3 litColor;
uniform vec3 shadeColor;
uniform vec3 cameraPosition;
uniform vec3 rimColor;
uniform float rimStrength;
uniform float specStrength;
uniform vec4 tint;
uniform vec4 flash;
uniform float alphaCutoff;
uniform float emissive;
uniform vec3 fogColor;
uniform float fogDensity;
void main(void) {
    vec4 tex = hasTexture > 0.5 ? texture2D(diffuseSampler, vUV) : vec4(1.0);
    if (tex.a < alphaCutoff) discard;
    vec3 albedo = tex.rgb * baseColor;
    if (tint.a > 0.0) {
        // Recolor dark cloth: keep the texture's shading, swap its hue for the tint.
        float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
        albedo = mix(albedo, tint.rgb * (0.62 + 2.2 * lum), tint.a);
    }
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vPositionW);
    float ndl = dot(N, lightDir);
    float lit = smoothstep(-0.02, 0.06, ndl);
    vec3 col = albedo * mix(shadeColor, litColor, lit);
    vec3 H = normalize(lightDir + V);
    float spec = smoothstep(0.90, 0.93, dot(N, H)) * lit;
    col += litColor * spec * specStrength;
    float rim = 1.0 - max(dot(N, V), 0.0);
    rim = smoothstep(0.62, 0.68, rim) * (0.35 + 0.65 * lit);
    col += rimColor * rim * rimStrength;
    col = mix(col, albedo, emissive);
    col = mix(col, flash.rgb, flash.a);
    float fogDist = length(cameraPosition - vPositionW) * fogDensity;
    col = mix(fogColor, col, clamp(exp(-fogDist * fogDist), 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
}
`;

// Shared lighting, updated once per frame by the arena.
export const ToonLighting = {
    lightDir: new Vector3(0.25, 1, -0.35).normalize(),
    litColor: new Color3(1.0, 0.97, 0.92),
    shadeColor: new Color3(0.42, 0.42, 0.58),
    rimColor: new Color3(1.0, 0.9, 0.75),
    fogColor: new Color3(0.03, 0.03, 0.06),
    fogDensity: 0.024,
};

const UNIFORMS = [
    'world', 'viewProjection', 'hasTexture', 'baseColor', 'lightDir', 'litColor', 'shadeColor', 'cameraPosition',
    'rimColor', 'rimStrength', 'specStrength', 'tint', 'flash', 'alphaCutoff', 'emissive',
    'fogColor', 'fogDensity',
];

/**
 * @param {string} name
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ texture?: any, color?: Color3, rim?: number, spec?: number, alphaCutoff?: number, emissive?: number, shade?: Color3, backFaceCulling?: boolean }} [opts]
 */
export function createToonMaterial(name, scene, opts = {}) {
    const mat = new ShaderMaterial(name, scene, { vertex: 'toon', fragment: 'toon' }, {
        attributes: ['position', 'normal', 'uv'],
        uniforms: UNIFORMS,
        samplers: ['diffuseSampler'],
        defines: opts.texture ? ['#define UV1'] : [],
    });
    mat.backFaceCulling = opts.backFaceCulling ?? true;
    if (opts.texture) mat.setTexture('diffuseSampler', opts.texture);
    mat.setFloat('hasTexture', opts.texture ? 1 : 0);
    mat.setColor3('baseColor', opts.color ?? Color3.White());
    mat.setFloat('rimStrength', opts.rim ?? 0.5);
    mat.setFloat('specStrength', opts.spec ?? 0.12);
    mat.setFloat('alphaCutoff', opts.alphaCutoff ?? -1);
    mat.setFloat('emissive', opts.emissive ?? 0);
    mat.setColor4('tint', new Color4(0, 0, 0, 0));
    mat.setColor4('flash', new Color4(1, 1, 1, 0));
    const shade = opts.shade;
    mat.onBindObservable.add(() => {
        const effect = mat.getEffect();
        if (!effect) return;
        effect.setVector3('lightDir', ToonLighting.lightDir);
        effect.setColor3('litColor', ToonLighting.litColor);
        effect.setColor3('shadeColor', shade ?? ToonLighting.shadeColor);
        effect.setColor3('rimColor', ToonLighting.rimColor);
        effect.setVector3('cameraPosition', scene.activeCamera.globalPosition);
        effect.setColor3('fogColor', ToonLighting.fogColor);
        effect.setFloat('fogDensity', ToonLighting.fogDensity);
    });
    return mat;
}
