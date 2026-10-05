import { ShaderMaterial, ShaderStore, Color3, Constants } from '@babylonjs/core/pure';

// Minimal unlit textured material: color * texture, alpha from the texture. Used for blob shadows and sparks.

ShaderStore.ShadersStore.unlitVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) {
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

ShaderStore.ShadersStore.unlitFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D diffuseSampler;
uniform vec3 color;
uniform float alpha;
void main(void) {
    vec4 tex = texture2D(diffuseSampler, vUV);
    gl_FragColor = vec4(color * tex.rgb, tex.a * alpha);
}
`;

/**
 * @param {string} name
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ texture: any, color?: Color3, alpha?: number, additive?: boolean }} opts
 */
export function createUnlitMaterial(name, scene, { texture, color = Color3.White(), alpha = 1, additive = false }) {
    const mat = new ShaderMaterial(name, scene, { vertex: 'unlit', fragment: 'unlit' }, {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'color', 'alpha'],
        samplers: ['diffuseSampler'],
        needAlphaBlending: true,
    });
    mat.setTexture('diffuseSampler', texture);
    mat.setColor3('color', color);
    mat.setFloat('alpha', alpha);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
    return mat;
}
