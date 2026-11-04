/* ============================================================
   太阳系 · Solar · 场景
   星空、太阳、行星、轨道、土星环、月球
   - 行星表面：着色器程序化噪声，不加载任何贴图
   ============================================================ */
import * as THREE from "three";
import {
  PLANETS, MOON_CFG, SUN_CFG, SUN_RADIUS, AU_UNIT, TAU, DEG, kmToUnit,
} from "./config.js";
import { NOISE_GLSL, makePlanetMaterial } from "./shaders.js";
import { makeMinDot } from "./dots.js";

/* ============================================================
   1. 星空背景
   ============================================================ */
function buildStars(renderer) {
  const N = 4200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const seed = new Float32Array(N);

  let s = 90210;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

  const c1 = new THREE.Color(0xffffff);
  const c2 = new THREE.Color(0xa8c4ff);
  const c3 = new THREE.Color(0xffd9b0);

  for (let i = 0; i < N; i++) {
    const r = 900 + rnd() * 900;
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(2 * rnd() - 1);
    pos[i*3]   = Math.sin(ph) * Math.cos(th) * r;
    pos[i*3+1] = Math.cos(ph) * r;
    pos[i*3+2] = Math.sin(ph) * Math.sin(th) * r;

    const pick = rnd();
    const c = pick < 0.7 ? c1 : (pick < 0.9 ? c2 : c3);
    const b = 0.45 + rnd() * 0.55;
    col[i*3] = c.r * b; col[i*3+1] = c.g * b; col[i*3+2] = c.b * b;

    size[i] = 0.7 + Math.pow(rnd(), 3) * 3.2;
    seed[i] = rnd();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixel;
      varying vec3 vCol;
      varying float vA;
      void main() {
        vCol = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 轻微闪烁
        vA = 0.55 + 0.45 * sin(uTime * 1.4 + aSeed * 62.0);
        gl_PointSize = aSize * uPixel;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = pow(smoothstep(0.5, 0.0, d), 1.6);
        gl_FragColor = vec4(vCol, a * vA);
      }
    `,
  });

  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return { points: p, uniforms: mat.uniforms };
}

/* ============================================================
   2. 太阳
   ============================================================ */
function buildSun(sunUniforms, sunGroup) {
  const geo = new THREE.SphereGeometry(SUN_RADIUS, 96, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vPos;
      void main() {
        vN = normalize(normalMatrix * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProx;   // 0 = 远观, 1 = 贴近（由主循环按相机距离写入）
      varying vec3 vN;
      varying vec3 vPos;
      ${NOISE_GLSL}
      void main() {
        // 表面颗粒 + 缓慢流动
        float n = fbm3(vPos * 2.6 + vec3(0.0, uTime * 0.12, 0.0), 5);
        float n2 = fbm3(vPos * 6.5 - vec3(uTime * 0.2, 0.0, 0.0), 4);

        float heat = n * 0.62 + n2 * 0.38;

        // 高频纹理只在贴近时计算
        if (uProx > 0.0) {
          float fine = fbm3(vPos * 26.0 + vec3(uTime * 0.05, 0.0, 0.0), 4);
          float ultra = fbm3(vPos * 96.0 + vec3(0.0, uTime * 0.08, 0.0), 3);
          heat += (fine - 0.5) * 0.55 * uProx;
          heat += (ultra - 0.5) * 0.30 * uProx;
        }

        // 贴近时提高表面纹理对比：近看要有细节，不能是一块均匀的亮黄
        float contrast = 1.0 + 1.1 * uProx;
        heat = clamp((heat - 0.5) * contrast + 0.5, 0.0, 1.0);

        vec3 cool = vec3(1.0, 0.38, 0.06);
        vec3 warm = vec3(1.0, 0.72, 0.28);
        vec3 hot  = vec3(1.0, 0.97, 0.86);

        vec3 col = mix(cool, warm, smoothstep(0.25, 0.62, heat));
        col = mix(col, hot, smoothstep(0.62, 0.92, heat));

        // 边缘略暗，做出球体感；贴近时减弱，让整面都炽热
        float rim = pow(1.0 - abs(dot(vN, vec3(0.0, 0.0, 1.0))), 2.0);
        col *= 1.0 - rim * (0.35 - 0.22 * uProx);

        // 基础亮度整体提亮；越近越亮，1-exp 软过曝保住层次而不是死白
        vec3 outc = col * (2.4 + 0.9 * uProx) * 1.4;
        outc = vec3(1.0) - exp(-outc);
        gl_FragColor = vec4(outc, 1.0);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  sunGroup.add(m);
  return m;
}

// 光晕：面向相机的面片，加性混合
function buildCorona(radius, opacity, color, sunUniforms) {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: sunUniforms.uTime,
      uProx: sunUniforms.uProx,
    },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uProx;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        // 内实外虚
        float a = pow(max(0.0, 1.0 - d), 2.6);
        a *= 0.82 + 0.18 * sin(uTime * 0.7);
        // 贴近时收弱光晕，避免近距离观测被加性光雾糊满屏（保留少许热雾）
        a *= mix(1.0, 0.25, uProx);
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

/* ============================================================
   3. 轨道数学（J2000 轨道要素 + 开普勒方程）
   ============================================================ */
// 轨道平面：真实倾角，不再做视觉放大。
// 轨道要素取 J2000 历元，位置由开普勒方程解出，
// 所以轨道是椭圆、公转速度随日心距变化，和真实太阳系一致。
function orbitMatrix(incDeg, nodeDeg) {
  // three.js 的 Y-up 右手系对应黄道系的 (x, z, -y) 映射。
  // 升交点落到黄经 Ω、轨道面向北倾斜倾角 i（与 JPL 标准公式逐位一致）。
  const m = new THREE.Matrix4().makeRotationY(nodeDeg * DEG);
  m.multiply(new THREE.Matrix4().makeRotationX(incDeg * DEG));
  return m;
}

function solveKepler(M, e) {
  const m = ((M % TAU) + TAU) % TAU;
  let E = m + e * Math.sin(m);
  for (let i = 0; i < 8; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}
export { solveKepler };

// E 为偏近点角；输出该行星在黄道坐标系里的位置（世界单位）
function orbitalPoint(cfg, E, matrix, out) {
  const cosE = Math.cos(E), sinE = Math.sin(E);
  // 轨道平面内坐标：x 指向近日点，y 与之垂直
  const x = cfg.aAU * (cosE - cfg.e);
  const y = cfg.aAU * Math.sqrt(1 - cfg.e * cfg.e) * sinE;
  // 从升交点量起的轨道面角度 = 近日点幅角 + 真近点角
  const u = (cfg.varpiDeg - cfg.nodeDeg) * DEG + Math.atan2(y, x);
  const r = Math.hypot(x, y) * AU_UNIT;
  // three.js 的 Y-up 右手系：黄道坐标 (x, y, z) 映射为 (x, z, -y)。
  // 用 -sin 而不是 +sin，否则整个太阳系相对真实方向变成镜像
  //（从黄北极看会顺时针公转，且与自转方向相反）。
  out.set(Math.cos(u) * r, 0, -Math.sin(u) * r);
  return matrix ? out.applyMatrix4(matrix) : out;
}

export function orbitalPosition(cfg, days, matrix, out) {
  if (!(cfg.orbitDays > 0)) return out.set(0, 0, 0);
  // 先约化时间，避免极大但有限的天数乘平均角速度后溢出
  const phaseDays = ((days % cfg.orbitDays) + cfg.orbitDays) % cfg.orbitDays;
  const M = (cfg.meanLonDeg - cfg.varpiDeg) * DEG
          + TAU * (phaseDays / cfg.orbitDays)
          + cfg.mAnomalyBias;
  return orbitalPoint(cfg, solveKepler(M, cfg.e), matrix, out);
}

function makeOrbitLine(cfg) {
  // 折线弦高 ≈ r·θ²/8：256 段时海王星偏差约 0.023 单位（半径的 14 倍），
  // 贴近观察会明显脱离行星实际位置；8192 段降到半径的 ~1%，肉眼不可见
  const SEG = 8192;
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    orbitalPoint(cfg, (i / SEG) * TAU, cfg._plane, v);
    pts.push(v.clone());
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x4a5a80, transparent: true, opacity: 0.34,
    depthWrite: false,
  });
  return new THREE.Line(geo, mat);
}

/* ============================================================
   组装整个场景
   ============================================================ */
export function createSpace(scene, renderer) {
  const stars = buildStars(renderer);
  scene.add(stars.points);

  const sunUniforms = { uTime: { value: 0 }, uProx: { value: 0 } };
  const sunGroup = new THREE.Group();
  const sunMesh = buildSun(sunUniforms, sunGroup);
  // 太阳与行星同构：参与点选、聚焦与信息卡
  sunMesh.userData = SUN_CFG;

  // 光晕：真实日面按比例半径 0.047 单位，全景下是个点。
  // 但太阳的眩光范围远大于日面本体，放大光晕不违反「天体比例真实」。
  // 光晕外缘 0.197 单位 ≈ 水星轨道的 5%，否则整个内圈被光雾糊住
  const corona1 = buildCorona(SUN_RADIUS * 1.75, 0.58, 0xff9a3c, sunUniforms);
  const corona2 = buildCorona(SUN_RADIUS * 2.90, 0.30, 0xffcf80, sunUniforms);
  const corona3 = buildCorona(SUN_RADIUS * 4.20, 0.14, 0xffe0a8, sunUniforms);
  sunGroup.add(corona1, corona2, corona3);
  scene.add(sunGroup);

  // 太阳旁边的体光源（只给标准材质的月球打光；行星使用自定义 shader）
  const sunLight = new THREE.PointLight(0xfff0d0, 120, 0, 2);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  // 极弱环境光，避免行星背光面全黑
  scene.add(new THREE.AmbientLight(0x38456a, 1.15));

  // 太阳的屏幕空间指示点：真实半径在全景下不足 0.1px，属于 UI 层，
  // 与行星光点同一套逻辑，不参与比例计算。
  const sunDot = makeMinDot(SUN_CFG);
  sunDot.material.size = 12;
  sunGroup.add(sunDot);

  const planets = [];
  const clickable = [];
  clickable.push(sunMesh, sunDot);
  let moonMesh = null, moonDot = null;

  for (const cfg of PLANETS) {
    const group = new THREE.Group();
    // 初始方位固定，保证同一 ?t 的截图完全可复现
    cfg._plane = orbitMatrix(cfg.incDeg, cfg.nodeDeg);

    const geo = new THREE.SphereGeometry(cfg.radius, 56, 40);
    const mat = makePlanetMaterial(cfg);
    const mesh = new THREE.Mesh(geo, mat);

    // 直接挂在 group 上：之前多套一层 tiltPivot，shader 里用 mat3(modelMatrix)
    // 取法线时拿到了异常的矩阵，整棵子树的 matrixWorld 全变 NaN。
    // 倾角改用 mesh 自己的旋转，只为视觉，不参与运算。
    group.add(mesh);
    // 默认 XYZ 序的合成是 R = Rx·Ry·Rz，自转套在倾角之外，
    // 极轴会绕世界 Y 进动且一圈正好等于一个自转周期（地球 1× 下每 2 秒晃一圈）。
    // ZYX 让自转发生在倾角之内，极轴在世界空间保持固定。
    mesh.rotation.order = "ZYX";
    mesh.rotation.z = cfg.tilt;   // 轴倾角
    mesh.userData = cfg;

    // 土星环：用 1D DataTexture 存环带剖面，材质走最普通的 MeshBasicMaterial.map
    // 这条路不依赖 shader、不依赖顶点色，是最稳的
    if (cfg.ring) {
      // 土星主环：C 环内缘 74,658 km 至 A 环外缘 136,775 km（真实值）
      const inner = kmToUnit(74658);
      const outer = kmToUnit(136775);
      const TEXW = 512;

      // 生成环带剖面：颜色 + alpha 都烘进贴图
      const data = new Uint8Array(TEXW * 4);
      for (let i = 0; i < TEXW; i++) {
        const t = i / (TEXW - 1);

        const bands = (Math.sin(t * 46.0) * 0.5 + 0.5) * 0.42
                    + (Math.sin(t * 118.0 + 1.7) * 0.5 + 0.5) * 0.26
                    + (Math.sin(t * 21.0 + 0.4) * 0.5 + 0.5) * 0.32;

        const g1 = Math.abs(t - 0.62) / 0.035;
        const g2 = Math.abs(t - 0.34) / 0.03;
        const gap = Math.min(1, g1, g2);
        const edge = Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.08);
        const coverage = gap * edge;

        const mixv = Math.min(1, bands);
        data[i*4+0] = Math.min(255, (0x9c + (0xd8 - 0x9c) * mixv) * 0.92);
        data[i*4+1] = Math.min(255, (0x82 + (0xc0 - 0x82) * mixv) * 0.92);
        data[i*4+2] = Math.min(255, (0x62 + (0x98 - 0x62) * mixv) * 0.92);
        data[i*4+3] = Math.round(255 * coverage);
      }

      const tex = new THREE.DataTexture(data, TEXW, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;

      const rg = new THREE.RingGeometry(inner, outer, 256, 8);

      // RingGeometry 的 uv.x 是横向 0..1，正好当环带剖面用；
      // 但要让它沿径向走，所以把 uv 换成按半径归一化的值
      const pos = rg.attributes.position;
      const uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        const t = (r - inner) / (outer - inner);
        uv.setXY(i, Math.min(1, Math.max(0, t)), 0.5);
      }
      uv.needsUpdate = true;
      rg.rotateX(-Math.PI / 2);

      const rm = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });

      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.z = cfg.tilt;
      group.add(ring);
    }

    // 地球的月亮：椭圆轨道（e=0.0549）由主循环按开普勒方程驱动
    let moonPivot = null;
    if (cfg.name === "地球") {
      const moonPlane = new THREE.Group();
      moonPlane.rotation.x = MOON_CFG.incDeg * DEG;   // 月球轨道相对黄道
      group.add(moonPlane);

      moonPivot = new THREE.Group();
      const moonGeo = new THREE.SphereGeometry(MOON_CFG.radius, 24, 18);
      const moonMat = new THREE.MeshStandardMaterial({
        color: MOON_CFG.colorA, roughness: 1.0, metalness: 0,
      });
      const moon = new THREE.Mesh(moonGeo, moonMat);
      moon.position.x = MOON_CFG.aAU * AU_UNIT;   // 初始在半长轴处，逐帧按真近点角更新
      moon.userData = MOON_CFG;
      // 6.68° 轴倾角（相对轨道面），与潮汐锁定共存
      moon.rotation.z = MOON_CFG.tilt;
      moonMesh = moon;

      moonDot = makeMinDot(MOON_CFG);
      moonDot.material.size = 9;
      moon.add(moonDot);
      clickable.push(moon, moonDot);

      moonPivot.add(moon);
      moonPlane.add(moonPivot);
    }

    scene.add(group);
    scene.add(makeOrbitLine(cfg));

    // 「最小可见光点」：天体本体严格按真实比例，全景下地球不足 0.001px，
    // 物理上不可见。这里叠一个屏幕尺寸恒定的指示光点，属于 UI 层，
    // 不参与比例计算，所以不破坏「真实比例」的前提。
    const dot = makeMinDot(cfg);
    group.add(dot);

    planets.push({ cfg, group, mesh, moonPivot, dot });
    clickable.push(mesh, dot);
  }

  // 可聚焦对象：八颗行星 + 太阳 + 地球的月球
  const focusables = planets.map(p => ({ cfg: p.cfg, group: p.group }));
  focusables.push({ cfg: SUN_CFG, group: sunGroup });
  if (moonMesh) focusables.push({ cfg: MOON_CFG, group: moonMesh });

  return {
    stars, sunUniforms, sunGroup,
    corona1, corona2, corona3, sunDot,
    planets, focusables, clickable, moonMesh, moonDot,
  };
}
