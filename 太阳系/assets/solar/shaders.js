/* ============================================================
   太阳系 · Solar · 着色器片段
   通用噪声（GLSL）、行星表面材质、对数深度片段
   ============================================================ */
import * as THREE from "three";

/* ------------------------------------------------------------
   对数深度：与 three.js 内建材质使用同一编码。
   renderer 开启 logarithmicDepthBuffer 后，近平面最小到 1e-6、
   远平面 6000（比值 ~6e9），常规深度下远景天体全部被量化到 1.0
   而被裁掉。自定义 ShaderMaterial 必须自己写 gl_FragDepth；
   logDepthBufFC 由 three.js 自动注入（= 2 / log2(far + 1)）。
   ------------------------------------------------------------ */
export const LOGDEPTH_PARS_VERT = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  varying float vLogDepth;
#endif
`;
export const LOGDEPTH_VERT = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  vLogDepth = 1.0 + gl_Position.w;
#endif
`;
export const LOGDEPTH_PARS_FRAG = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  uniform float logDepthBufFC;
  varying float vLogDepth;
#endif
`;
export const LOGDEPTH_FRAG = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = log2(vLogDepth) * logDepthBufFC * 0.5;
#endif
`;

export const NOISE_GLSL = /* glsl */ `
  // 3D 值噪声
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += noise3(p) * a;
      n += a;
      p *= 2.03;
      a *= 0.5;
    }
    return s / n;
  }
`;

export function makePlanetMaterial(cfg) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uColorA:    { value: new THREE.Color(cfg.colorA) },
      uColorB:    { value: new THREE.Color(cfg.colorB) },
      uColorC:    { value: new THREE.Color(cfg.colorC) },
      uFreq:      { value: cfg.noiseFreq },
      uBandAmp:   { value: cfg.bandAmp },
      uEarth:     { value: cfg.earthLike ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vPos = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform float uFreq;
      uniform float uBandAmp;
      uniform float uEarth;

      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      ${LOGDEPTH_PARS_FRAG}
      ${NOISE_GLSL}

      void main() {
        vec3 p = normalize(vPos);

        // 基础噪声
        float n = fbm3(p * uFreq + 13.0, 5);

        float bands = n;
        if (uBandAmp > 0.0) {
          float lat = p.y;
          float bandN = fbm3(vec3(p.x * uFreq * 0.7, lat * uFreq * 2.6, p.z * uFreq * 0.7) + 3.0, 5);
          float bandWave = sin(lat * 22.0 + bandN * 5.5) * 0.5 + 0.5;
          bands = mix(n, bandWave, uBandAmp * 0.75);
        }

        vec3 col = mix(uColorB, uColorA, smoothstep(0.32, 0.68, bands));
        col = mix(col, uColorC, smoothstep(0.70, 0.92, bands) * 0.65);

        // 地球：把噪声当海陆，加极冠
        if (uEarth > 0.5) {
          float land = smoothstep(0.52, 0.56, n);
          vec3 ocean = mix(vec3(0.06, 0.22, 0.42), vec3(0.12, 0.36, 0.60), smoothstep(0.3, 0.55, n));
          vec3 ground = mix(vec3(0.24, 0.42, 0.20), vec3(0.52, 0.46, 0.28), smoothstep(0.55, 0.75, n));
          col = mix(ocean, ground, land);

          // 极地冰盖
          float ice = smoothstep(0.80, 0.94, abs(p.y));
          col = mix(col, vec3(0.94, 0.97, 1.0), ice);

          // 云层
          float cloud = fbm3(p * 5.2 + vec3(uTime * 0.02, 0.0, 0.0), 5);
          float cmask = smoothstep(0.56, 0.72, cloud) * 0.55;
          col = mix(col, vec3(1.0), cmask);
        }

        // 光照：点光源在原点
        vec3 L = normalize(-vWorldPos);
        float ndl = max(dot(normalize(vNormalW), L), 0.0);

        // 柔化明暗交界
        float lightAmt = pow(ndl, 0.62);

        // 背光面留一点自发光，避免死黑
        vec3 ambient = col * 0.30;

        // 边缘光（大气散射感）
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(normalize(vNormalW), V), 0.0), 3.0);
        vec3 rim = vec3(0.45, 0.62, 1.0) * fres * 0.32 * lightAmt;

        vec3 finalCol = col * lightAmt * 1.75 + ambient + rim;

        gl_FragColor = vec4(finalCol, 1.0);
        ${LOGDEPTH_FRAG}
      }
    `,
  });
}
