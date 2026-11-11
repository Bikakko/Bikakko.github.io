/* ============================================================
   太阳系 · Solar · 场景
   星空、太阳、行星、轨道、土星环、月球
   - 每个天体的数据与专属参数在 bodies.js 中按天体分段
   - 行星表面：程序化噪声兜底；带 mapUrl 的天体异步加载真实位图覆盖（textures.js）
   - 扁球体：几何取赤道半径，scale.y=极/赤道（pck00011 RADII）
   - 自定义 ShaderMaterial 都注入对数深度片段，与内建材质共用同一深度编码
   ============================================================ */
import * as THREE from "three";
import { PLANETS, SUN_CFG } from "./bodies.js";
import { TAU, kmToUnit, qT } from "./config.js";
import {
  NOISE_GLSL, makePlanetMaterial,
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";
import { makeMinDot } from "./dots.js";
import { orbitalPointAtE, barycenterCorrectedPosition } from "./orbit-math.js";
import { makePose } from "./pose.js";
import { attachBodyMap } from "./textures.js";
import { RING_PROFILE } from "./ring-profile.js";
import {
  LIMB_DARKENING, granuleFreq, supergranuleFreq,
  DIFF_ROTATION, CARRINGTON_DEG_PER_DAY,
} from "./solar-physics.js";

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
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vCol = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 轻微闪烁
        vA = 0.55 + 0.45 * sin(uTime * 1.4 + aSeed * 62.0);
        gl_PointSize = aSize * uPixel;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = pow(smoothstep(0.5, 0.0, d), 1.6);
        gl_FragColor = vec4(vCol, a * vA);
        ${LOGDEPTH_FRAG}
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
  const geo = new THREE.SphereGeometry(SUN_CFG.radius, 96, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vPos;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vN = normalize(normalMatrix * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProx;   // 0 = 远观, 1 = 贴近（由主循环按相机距离写入）
      uniform float uSimTime; // 模拟时间（天），驱动较差自转
      varying vec3 vN;
      varying vec3 vPos;
      ${LOGDEPTH_PARS_FRAG}
      ${NOISE_GLSL}

      // 绕局部 +Y（自转极轴）旋转单位向量
      vec3 rotY(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
      }

      void main() {
        vec3 sp = normalize(vPos);                  // 单位球面采样方向
        float lat = asin(clamp(sp.y, -1.0, 1.0));   // 日面纬度（弧度）
        float s2 = sin(lat); s2 = s2 * s2;          // sin²φ
        // Snodgrass & Ulrich 1990 恒星较差自转 ω(φ)=A+B·sin²φ+C·sin⁴φ（度/天）
        float omega = ${DIFF_ROTATION.A} + ${DIFF_ROTATION.B} * s2 + ${DIFF_ROTATION.C} * s2 * s2;
        // 刚体 frame 以 Carrington 平均率自转；叠加 (ω_mean−ω(φ))·t 漂移，
        // 使表面特征合成出真实纬度依赖自转（赤道 14.713、极区 10.530°/天）
        float drift = (${CARRINGTON_DEG_PER_DAY} - omega) * uSimTime * 0.0174532925;
        vec3 sp2 = rotY(sp, drift);

        // 超米粒组织 ~30000 km（频率 = R☉/尺度），缓慢对流流动
        float superg = fbm3(sp2 * ${supergranuleFreq().toFixed(3)} + vec3(0.0, uTime * 0.01, 0.0), 4);
        float heat = superg;

        // 米粒组织 ~1000 km：仅贴近时计算（远观太阳是个点，无需高频细节）
        if (uProx > 0.0) {
          float gran = fbm3(sp2 * ${granuleFreq().toFixed(3)} + vec3(uTime * 0.02, 0.0, 0.0), 4);
          float fine = fbm3(sp2 * ${(granuleFreq() * 2.5).toFixed(3)} - vec3(0.0, uTime * 0.03, 0.0), 3);
          heat = mix(heat, gran, 0.55 * uProx);
          heat += (fine - 0.5) * 0.25 * uProx;
        }

        // 贴近时提高表面纹理对比：近看要有米粒细节，不能是一块均匀的亮黄
        float contrast = 1.0 + 0.8 * uProx;
        heat = clamp((heat - 0.5) * contrast + 0.5, 0.0, 1.0);

        vec3 cool = vec3(1.0, 0.38, 0.06);
        vec3 warm = vec3(1.0, 0.72, 0.28);
        vec3 hot  = vec3(1.0, 0.97, 0.86);
        vec3 col = mix(cool, warm, smoothstep(0.25, 0.62, heat));
        col = mix(col, hot, smoothstep(0.62, 0.92, heat));

        // 软过曝 tone-map 保住层次而不是死白；越近越亮
        vec3 outc = vec3(1.0) - exp(-col * (2.4 + 0.9 * uProx) * 1.4);

        // 临边昏暗：Neckel & Labs 1994 可见光 I(μ)/I(1)=a0+a1·μ+a2·μ²，
        // 边缘 μ=0 处约为中心 30%。μ 为视线与法线夹角余弦，是内禀属性，
        // 不随相机距离改变。tone-map 后乘 limb 以忠实保留真实强度比。
        float mu = clamp(dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
        float limb = ${LIMB_DARKENING.a0} + ${LIMB_DARKENING.a1} * mu + ${LIMB_DARKENING.a2} * mu * mu;
        outc *= limb;

        gl_FragColor = vec4(outc, 1.0);
        ${LOGDEPTH_FRAG}
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
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uProx;
      varying vec2 vUv;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        // 内实外虚
        float a = pow(max(0.0, 1.0 - d), 2.6);
        a *= 0.82 + 0.18 * sin(uTime * 0.7);
        // 贴近时收弱光晕，避免近距离观测被加性光雾糊满屏（保留少许热雾）
        a *= mix(1.0, 0.25, uProx);
        gl_FragColor = vec4(uColor, a * uOpacity);
        ${LOGDEPTH_FRAG}
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

/* ============================================================
   3. 轨道线
   ============================================================ */
// 折线弦高 ≈ r·θ²/8：256 段时海王星偏差约 0.023 单位（半径的 14 倍），
// 贴近观察会明显脱离行星实际位置；8192 段降到半径的 ~1%，肉眼不可见
const ORBIT_SEG = 8192;

// 就地重写顶点，不新建几何/材质：跳到别的历元时只更新数据
function fillOrbitPoints(cfg, days, attr) {
  const arr = attr.array;
  const v = new THREE.Vector3();
  const T = days / 36525;
  const hasMoon = (cfg.satellites || []).length > 0;
  for (let i = 0; i <= ORBIT_SEG; i++) {
    if (hasMoon) {
      // 有卫星的天体（地球）：按时间采样「含地月质心摆动」的真实轨迹，
      // 而不是把整条质心椭圆按瞬时偏移平移——后者只保证当下穿过本体，
      // 椭圆其余部分并不等于地球路径。
      barycenterCorrectedPosition(cfg, days + (i / ORBIT_SEG) * cfg.orbitDays, v);
    } else {
      // 无卫星：按偏近点角均匀采样的参考椭圆，要素取 days 所在历元
      orbitalPointAtE(cfg, (i / ORBIT_SEG) * TAU, v, T);
    }
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  attr.needsUpdate = true;
}

function makeOrbitLine(cfg, days) {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array((ORBIT_SEG + 1) * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  fillOrbitPoints(cfg, days, attr);
  geo.computeBoundingSphere();
  const mat = new THREE.LineBasicMaterial({
    color: 0x4a5a80, transparent: true, opacity: 0.34,
    depthWrite: false,
  });
  return new THREE.Line(geo, mat);
}

/* ============================================================
   4. 土星环
   ============================================================ */
function buildRing(cfg) {
  const ring = cfg.ring;
  const inner = kmToUnit(ring.innerKm);
  const outer = kmToUnit(ring.outerKm);
  // 不透明度用 Voyager 1 RSS 实测 τ(r)（ring-profile.js，2048 texel ≈ 30 km/texel，
  // 恩克缝 325 km 宽可分辨）；alpha = 1 − e^(−τ)，Beer–Lambert 透射。
  // 卡西尼缝里的环let、恩克缝、C/B/A 环明暗比全部来自实测数据；
  // 不再乘程序化 gap/edge 衰减——真实内外边缘与缝隙结构已经在 τ 里。
  const TEXW = RING_PROFILE.samples;

  // 生成环带剖面：颜色 + alpha 都烘进贴图
  const data = new Uint8Array(TEXW * 4);
  for (let i = 0; i < TEXW; i++) {
    const t = i / (TEXW - 1);
    const coverage = 1 - Math.exp(-RING_PROFILE.tau[i]);

    // 颜色仍是温和程序化条带做反照率变化；缝隙处 coverage≈0，
    // 任何颜色都被透明度隐藏，可见结构完全由实测 τ 决定
    const bands = (Math.sin(t * 46.0) * 0.5 + 0.5) * 0.42
                + (Math.sin(t * 118.0 + 1.7) * 0.5 + 0.5) * 0.26
                + (Math.sin(t * 21.0 + 0.4) * 0.5 + 0.5) * 0.32;

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

  return new THREE.Mesh(rg, rm);
}

/* ============================================================
   5. 卫星
   ============================================================ */
function buildSatellite(cfg, anisotropy) {
  // 月球贴近聚焦时要看清真实陨石坑：24×18 的轮廓剪影明显是多边形，
  // 96×64 把弦高降到半径的 0.1% 以下
  const geoR = cfg.shape ? kmToUnit(cfg.shape.equatorialKm) : cfg.radius;
  const geo = new THREE.SphereGeometry(geoR, 96, 64);
  const mat = cfg.material === "standard"
    ? new THREE.MeshStandardMaterial({ color: cfg.colorA, roughness: 1.0, metalness: 0 })
    : makePlanetMaterial(cfg);
  const mesh = new THREE.Mesh(geo, mat);
  applyShape(mesh, cfg);
  if (cfg.mapUrl) attachBodyMap(mat, cfg.mapUrl, { anisotropy });
  mesh.userData = cfg;
  return mesh;
}

// 扁球压扁：scale.y = 极半径/赤道半径（数据来自 bodies.js shape / pck00011）。
// 自定义 shader 的世界法线 = R·S⁻¹·n，需要在 mat3(modelMatrix) 前预乘 S⁻²
// （见 shaders.js uNScale）；标准材质由 three 的 normalMatrix 自动处理。
// cfg.radius 仍是平均半径：聚焦取景、缩放下限、信息卡口径全部不变。
function applyShape(mesh, cfg) {
  if (!cfg.shape) return;
  const s = cfg.shape.polarKm / cfg.shape.equatorialKm;
  mesh.scale.y = s;
  const u = mesh.material.uniforms;
  if (u && u.uNScale) u.uNScale.value.set(1, 1 / (s * s), 1);
}

/* ============================================================
   组装整个场景
   ============================================================ */
export function createSpace(scene, renderer) {
  const stars = buildStars(renderer);
  scene.add(stars.points);

  const sunUniforms = { uTime: { value: 0 }, uProx: { value: 0 }, uSimTime: { value: 0 } };
  const sunGroup = new THREE.Group();
  const sunMesh = buildSun(sunUniforms, sunGroup);
  // 太阳与行星同构：参与点选、聚焦与信息卡
  sunMesh.userData = SUN_CFG;
  const sunRecord = {
    cfg: SUN_CFG, mesh: sunMesh,
    pose: makePose(), spinRad: 0,
  };

  // 光晕：真实日面按比例半径，全景下是个点。
  // 但太阳的眩光范围远大于日面本体，放大光晕不违反「天体比例真实」。
  // 参数在太阳模块里，构建器只负责生成面片。
  const coronas = SUN_CFG.corona.radii.map((mult, i) => {
    const c = buildCorona(
      SUN_CFG.radius * mult,
      SUN_CFG.corona.opacities[i],
      SUN_CFG.corona.colors[i],
      sunUniforms,
    );
    sunGroup.add(c);
    return c;
  });
  scene.add(sunGroup);

  // 太阳旁边的体光源（只给标准材质的月球打光；行星使用自定义 shader）
  const sunLight = new THREE.PointLight(0xfff0d0, 120, 0, 2);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  // 极弱环境光，避免行星背光面全黑
  scene.add(new THREE.AmbientLight(0x38456a, 1.15));

  // 太阳的屏幕空间指示点：真实半径在全景下不足 0.1px，属于 UI 层
  const sunDot = makeMinDot(SUN_CFG);
  sunDot.material.size = 12;
  sunGroup.add(sunDot);

  const planets = [];
  const clickable = [];
  clickable.push(sunMesh, sunDot);

  // 位图各向异性过滤上限（斜视行星表面时贴图保持清晰）
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  for (const cfg of PLANETS) {
    const group = new THREE.Group();

    // 扁球体几何用赤道半径，再由 scale.y 压到极半径；
    // 平均半径 cfg.radius 只服务于取景/缩放/信息卡，不参与几何
    const geoR = cfg.shape ? kmToUnit(cfg.shape.equatorialKm) : cfg.radius;
    const geo = new THREE.SphereGeometry(geoR, 56, 40);
    const mat = makePlanetMaterial(cfg);
    const mesh = new THREE.Mesh(geo, mat);
    applyShape(mesh, cfg);
    if (cfg.mapUrl) attachBodyMap(mat, cfg.mapUrl, { anisotropy: maxAniso });
    mesh.userData = cfg;
    group.add(mesh);

    // 土星环：数据/缝隙位置来自 saturn.js，构建器只做通用环面
    let ring = null;
    if (cfg.ring) {
      ring = buildRing(cfg);
      group.add(ring);
    }

    // 卫星：目前只有地球的月球；位置/姿态由 body-system 每帧更新
    const satellites = [];
    for (const satCfg of cfg.satellites || []) {
      const satMesh = buildSatellite(satCfg, maxAniso);
      group.add(satMesh);

      const satDot = makeMinDot(satCfg);
      satMesh.add(satDot);
      clickable.push(satMesh, satDot);

      satellites.push({
        cfg: satCfg, mesh: satMesh, dot: satDot,
        pose: makePose(), spinRad: 0,
      });
    }

    scene.add(group);
    const orbitLine = makeOrbitLine(cfg, qT);
    scene.add(orbitLine);

    // 「最小可见光点」：天体本体严格按真实比例，全景下地球不足 0.001px，
    // 物理上不可见。这里叠一个屏幕尺寸恒定的指示光点，属于 UI 层，
    // 不参与比例计算，所以不破坏「真实比例」的前提。
    const dot = makeMinDot(cfg);
    group.add(dot);

    planets.push({
      cfg, group, mesh, dot, ring, satellites, orbitLine,
      pose: makePose(), spinRad: 0,
    });
    clickable.push(mesh, dot);
  }

  // 可聚焦对象：八颗行星 + 太阳 + 地球的月球
  const focusables = planets.map(p => ({ cfg: p.cfg, group: p.group }));
  focusables.push({ cfg: SUN_CFG, group: sunGroup });
  for (const p of planets) {
    for (const sat of p.satellites) {
      focusables.push({ cfg: sat.cfg, group: sat.mesh });
    }
  }

  const allSatellites = planets.flatMap(p => p.satellites);
  const moonRecord = allSatellites.find(s => s.cfg.name === "月球") || null;

  // 跳到别的历元时重采轨道线：JPL 要素带每世纪长期项，1850 年的椭圆
  // 相对 2026 年已转了半度多，不重画的话行星会明显脱离自己的轨道。
  let orbitEpoch = qT;
  function rebuildOrbits(days) {
    if (Math.abs(days - orbitEpoch) < 30) return;
    orbitEpoch = days;
    for (const p of planets) {
      const attr = p.orbitLine.geometry.getAttribute("position");
      fillOrbitPoints(p.cfg, days, attr);
      p.orbitLine.geometry.computeBoundingSphere();
    }
  }

  return {
    stars, sunUniforms, sunGroup, sunMesh, sunRecord, coronas, sunDot,
    planets, focusables, clickable, rebuildOrbits,
    moonMesh: moonRecord ? moonRecord.mesh : null,
    moonDot: moonRecord ? moonRecord.dot : null,
  };
}
