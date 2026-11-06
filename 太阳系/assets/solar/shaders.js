/* ============================================================
   太阳系 · Solar · 着色器片段
   通用噪声（GLSL）、行星表面材质、对数深度片段
   ============================================================ */
import * as THREE from "three";
import { WHITE_TEX } from "./textures.js";

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
      // 位图渐进增强：未加载时采样 1×1 白图、uHasMap=0 走程序化底色
      uMap:       { value: WHITE_TEX },
      uHasMap:    { value: 0 },
      // 扁球缩放补偿：mesh.scale.y=s 时预乘 (1,1/s²,1)，见顶点着色器注释
      uNScale:    { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uNScale;
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vUv = uv;
        vPos = position;
        // 扁球缩放 mesh.scale.y=s 时，世界法线 = R·S⁻¹·n。
        // mat3(modelMatrix)=R·S，给 n 预乘 (1,1/s²,1) 即 R·S·S⁻²·n = R·S⁻¹·n；
        // 直接 mat3(modelMatrix)*normal 会把缩放当旋转，扁行星的光照明暗界会错位
        vNormalW = normalize(mat3(modelMatrix) * (normal * uNScale));
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
      uniform sampler2D uMap;
      uniform float uHasMap;

      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      ${LOGDEPTH_PARS_FRAG}
      ${NOISE_GLSL}

      void main() {
        vec3 p = normalize(vPos);

        vec3 col;
        float n = 0.0;
        if (uHasMap > 0.5) {
          // 真实位图覆盖程序化底色。自定义 shader 绕过 three 色彩管线：
          // 位图按 sRGB 存储、原样采样（NoColorSpace）输出即显示正确，见 textures.js
          col = texture2D(uMap, vUv).rgb;
        } else {
          // 基础噪声（无位图时才计算，省下每像素 fbm 开销）
          n = fbm3(p * uFreq + 13.0, 5);

          float bands = n;
          if (uBandAmp > 0.0) {
            float lat = p.y;
            float bandN = fbm3(vec3(p.x * uFreq * 0.7, lat * uFreq * 2.6, p.z * uFreq * 0.7) + 3.0, 5);
            float bandWave = sin(lat * 22.0 + bandN * 5.5) * 0.5 + 0.5;
            bands = mix(n, bandWave, uBandAmp * 0.75);
          }

          col = mix(uColorB, uColorA, smoothstep(0.32, 0.68, bands));
          col = mix(col, uColorC, smoothstep(0.70, 0.92, bands) * 0.65);
        }

        // 地球：有位图时只保留动态云层（Blue Marble 本身无云）；
        // 无位图时回退到噪声海陆 + 极冠
        if (uEarth > 0.5) {
          if (uHasMap < 0.5) {
            float land = smoothstep(0.52, 0.56, n);
            vec3 ocean = mix(vec3(0.06, 0.22, 0.42), vec3(0.12, 0.36, 0.60), smoothstep(0.3, 0.55, n));
            vec3 ground = mix(vec3(0.24, 0.42, 0.20), vec3(0.52, 0.46, 0.28), smoothstep(0.55, 0.75, n));
            col = mix(ocean, ground, land);

            // 极地冰盖
            float ice = smoothstep(0.80, 0.94, abs(p.y));
            col = mix(col, vec3(0.94, 0.97, 1.0), ice);
          }

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

        // 位图已是 display-referred sRGB（采样值即最终显示值），源图本身含接近
        // 255 的亮区，盘心总增益须 ≈1.0 才能原样复现、避免亮区裁剪；故取
        // lightGain+ambientAmt=1.0。程序化底色经 THREE.Color 转入线性工作空间，
        // 需要更高增益补偿。按 uHasMap 分支取增益与环境光。
        float lightGain = uHasMap > 0.5 ? 0.92 : 1.75;
        float ambientAmt = uHasMap > 0.5 ? 0.08 : 0.30;

        // 背光面留一点自发光，避免死黑
        vec3 ambient = col * ambientAmt;

        // 边缘光（大气散射感）
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(normalize(vNormalW), V), 0.0), 3.0);
        vec3 rim = vec3(0.45, 0.62, 1.0) * fres * 0.32 * lightAmt;

        vec3 finalCol = col * lightAmt * lightGain + ambient + rim;

        gl_FragColor = vec4(finalCol, 1.0);
        ${LOGDEPTH_FRAG}
      }
    `,
  });
}
