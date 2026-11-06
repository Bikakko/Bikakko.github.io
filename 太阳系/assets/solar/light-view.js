/* ============================================================
   太阳系 · Solar · 3D 光速视觉层（主波前 + 严格光速波纹）
   - 主波前球：半径 = c·lightSec，带唯一一套经纬网和三个正交大圆，
     表示光已经走到的最远处。
   - 波纹球：每个球壳在固定的 emit_k = k·5 光秒发出，半径 = c·(t−emit_k)，
     dR/dt 恒等于 c。按相机像素尺度做 2 的幂 LOD 抽样（stride 与 t 无关），
     球壳铺满 0..主波前全程、间距均匀、数量恒定；窗口两端淡入淡出隐藏
     增删。全部是真实 3D 半透明球面，普通混合 + fresnel 不累积亮度。
   - 视角切换：相机在光球外时，所有球壳正常显示（看到完整光球）；相机
     被光球包裹时，球面退成极淡底衬，改画每个波面与「面向相机的观察
     平面」的交圆（同心正圆），亮度按 sweepWeight 调制 → 随时间一圈圈
     从中心向外扩张、「一波一波的光波扫过去」。主波前球带经纬网始终
     保留作方位参考。
   - 每条太阳→行星光线按主波前裁断，并每隔 1 光秒显示一个亮点，
     亮点随波前以光速向外流动。
   ============================================================ */
import * as THREE from "three";
import { SUN_CFG, PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { pulseRadii, pulseStride, sweepWeight, frontRadius } from "./light-math.js";
import {
  qPulseLightSec, MAX_PULSES, UNITS_PER_LIGHT_SEC,
} from "./config.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

// 单位球经纬线（LineSegments）。只画一套，10 纬 / 16 经，普通亮度。
function makeGridGeometry(latLines, lonLines, seg) {
  const pts = [];
  for (let j = 1; j < latLines; j++) {
    if (j === latLines / 2) continue;   // 赤道交给黄道大圆
    const lat = -Math.PI / 2 + (j / latLines) * Math.PI;
    const r = Math.cos(lat), y = Math.sin(lat);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(r * Math.cos(a0), y, r * Math.sin(a0));
      pts.push(r * Math.cos(a1), y, r * Math.sin(a1));
    }
  }
  const half = Math.floor(seg / 2);
  for (let j = 0; j < lonLines; j++) {
    const lon = (j / lonLines) * Math.PI * 2;
    const cx = Math.cos(lon), cz = Math.sin(lon);
    for (let i = 0; i < half; i++) {
      const t0 = -Math.PI / 2 + (i / half) * Math.PI;
      const t1 = -Math.PI / 2 + ((i + 1) / half) * Math.PI;
      pts.push(Math.cos(t0) * cx, Math.sin(t0), Math.cos(t0) * cz);
      pts.push(Math.cos(t1) * cx, Math.sin(t1), Math.cos(t1) * cz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function makeCircleGeometry() {
  const pts = [];
  const SEG = 128;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(Math.cos(a), Math.sin(a), 0);   // XY 平面
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export function createLightView(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  /* ---------- 半透明球面模板 ----------
     NormalBlending：N 层叠加后趋向球面色，不会像加性混合那样越叠越亮。
     每层 clone 一份材质（共享同一 shader program），用 uLayerFade 淡入淡出。
     uInside 切换两种观感：球外画完整光球，球内只让掠过相机的波面发亮。 */
  const sphereMatTemplate = new THREE.ShaderMaterial({
    uniforms: {
      uColor:       { value: new THREE.Color(0xffc078) },
      uOpacity:     { value: 0.055 },
      uLayerFade:   { value: 1 },
      uShellRadius: { value: 0 },
      uCamRadius:   { value: 0 },
      uSweepWidth:  { value: 1 },
      uInside:      { value: 0 },
    },
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uLayerFade;
      uniform float uShellRadius;
      uniform float uCamRadius;
      uniform float uSweepWidth;
      uniform float uInside;
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vView)));
        float fres = pow(1.0 - ndv, 2.0);
        // 球外：完整光球，轮廓亮、球心方向基数压到 0.04 防止中心叠亮。
        float outside = uOpacity * (0.04 + 0.96 * fres);
        // 球内：球面内表面会铺满整个视野，必须收成「细环」才有波的形状。
        // 高次 fresnel 只留掠射的一圈，基数压到 0.02 → 不会糊成整屏橙雾。
        float ring = pow(1.0 - ndv, 8.0);
        // 与 light-math.sweepWeight() 同式：波面迎面涌来拖尾长、
        // 越过相机后快速淡出 → 一环环从中心向外扩张、扫过视野。
        float d = (uShellRadius - uCamRadius) / max(uSweepWidth, 1e-6);
        float sweep = exp(-d * d * (d <= 0.0 ? 0.45 : 1.8));
        // 球内球面只留极淡底衬，波的形状交给面向相机的同心波环（见 update）。
        float insideA = 0.07 * sweep * (0.02 + 0.98 * ring);
        float a = uLayerFade * mix(outside, insideA, uInside);
        gl_FragColor = vec4(uColor, a);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
  const gridGeo = makeGridGeometry(10, 16, 64);
  const circleGeo = makeCircleGeometry();
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffb066, transparent: true, opacity: 0.30,
    depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
  });

  /* ---------- 主波前球（带唯一一套经纬网） ---------- */
  const mainSphereMat = sphereMatTemplate.clone();
  // 主波前球始终按「球外」绘制，作方位参考，不参与球内扫掠淡出。
  mainSphereMat.uniforms.uInside.value = 0;
  const mainParts = [];
  const mainSphere = new THREE.Mesh(sphereGeo, mainSphereMat);
  mainSphere.renderOrder = 2;
  const mainEquator = new THREE.LineLoop(circleGeo, lineMat);
  mainEquator.rotation.x = -Math.PI / 2;              // XZ：黄道面
  const mainGrid = new THREE.LineSegments(gridGeo, lineMat);
  const mainMerA = new THREE.LineLoop(circleGeo, lineMat);   // XY
  const mainMerB = new THREE.LineLoop(circleGeo, lineMat);   // YZ
  mainMerB.rotation.y = Math.PI / 2;
  for (const o of [mainEquator, mainGrid, mainMerA, mainMerB]) o.renderOrder = 3;
  mainParts.push(mainSphere, mainEquator, mainGrid, mainMerA, mainMerB);
  for (const o of mainParts) {
    o.frustumCulled = false;
    group.add(o);
  }

  /* ---------- 波纹球槽位（LOD 抽样后的可见球壳，物理上每 5 光秒一个） ----------
     球外看球面（完整光球）；球内改为看每个波面与「面向相机的观察平面」
     的交圆 —— 一圈圈同心正圆，随时间从中心向外扩张、一道道掠过视野。
     用面向相机的圆而非黄道大圆：后者在透视下远半会压缩成密密麻麻的
     平行弧线。线用普通混合，不会像半透明球面那样叠成一片。 */
  const ripples = [];
  for (let i = 0; i < MAX_PULSES; i++) {
    const mat = sphereMatTemplate.clone();
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);

    const arcMat = lineMat.clone();
    arcMat.opacity = 0;
    const arc = new THREE.LineLoop(circleGeo, arcMat);
    // 朝向每帧跟随相机（见 update）：圆平面垂直于视线 → 同心正圆
    arc.renderOrder = 3;
    arc.frustumCulled = false;
    arc.visible = false;
    group.add(arc);

    ripples.push({ mesh, mat, arc, arcMat });
  }

  /* ---------- 八条光线（世界空间线段 + 每 1 光秒一个亮点） ---------- */
  const rayMatFor = () => new THREE.ShaderMaterial({
    uniforms: {
      uFront:       { value: 0 },
      uDotSpacing:  { value: UNITS_PER_LIGHT_SEC },   // 1 光秒对应的世界单位
    },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFront;
      uniform float uDotSpacing;
      varying vec3 vWorld;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float d = length(vWorld);
        if (d > uFront) discard;
        float head = smoothstep(uFront * 0.94, uFront, d);
        // 亮点：每 1 光秒一个，位置 = uFront − k·spacing，随波前以 c 向外流动
        float ph = fract((uFront - d) / uDotSpacing);
        float bead = 1.0 - smoothstep(0.0, 0.18, min(ph, 1.0 - ph));
        vec3 col = mix(vec3(0.42, 0.60, 1.0), vec3(1.0, 0.85, 0.55), head);
        col += vec3(1.0, 0.88, 0.55) * bead * 0.9;
        gl_FragColor = vec4(col, 0.22 + 0.65 * head + 0.55 * bead);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  const rays = PLANETS.map((cfg) => {
    const arr = new Float32Array(6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = rayMatFor();
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 3;
    group.add(line);
    return { cfg, arr, geo, mat };
  });

  const _v = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  let cameraInside = false;

  function update(lightSec, simTime) {
    // rig.updateCamera 只改了 position/quaternion，renderer.render 才会刷新
    // matrixWorld；本函数在 render 之前执行，需自行取本帧相机位置。
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);

    const mainR = frontRadius(lightSec);
    for (const o of mainParts) o.scale.setScalar(mainR);

    // 可见半径窗口只由相机决定（不含 t）→ stride 在播放中恒定，
    // 球壳索引集合不会重排，每层严格以 c 平滑推进。
    const camDist = Math.max(_camPos.length(), SUN_CFG.radius * 2);
    // 相机是否已被主波前包裹：球外显示完整光球，球内显示一波波掠过的光波。
    const inside = _camPos.lengthSq() < mainR * mainR ? 1 : 0;
    cameraInside = inside === 1;

    const halfView = camDist * Math.tan(camera.fov * Math.PI / 360);
    // 球外：窗口按屏幕横向可见尺度，全景覆盖整个光球、拉近能看逐 5 光秒
    // 细波纹。球内：窗口必须扩到相机所在半径之外，否则「正掠过相机的
    // 波面」会被裁掉，球内就只剩空白。只依赖相机，不含 t。
    const viewRadius = Math.max(
      halfView,
      inside ? camDist * 1.6 : 0,
      SUN_CFG.radius * 8,
    );
    const radii = pulseRadii(lightSec, qPulseLightSec, viewRadius);

    // 球内：波环是「波前球 ∩ 面向相机的观察平面」的交圆，只有半径
    // R < camDist·tan(fov/2) 的波环落在视野内。把扫掠焦点放在这个范围
    // 的中段，波环就会从中心一圈圈长大、掠过视野后淡出（一波波扫过）。
    const stride = pulseStride(viewRadius, qPulseLightSec);
    const gap = stride * qPulseLightSec * UNITS_PER_LIGHT_SEC;
    const focusRadius = inside ? camDist * 0.35 : camDist;
    const sweepWidth = inside
      ? Math.max(camDist * 0.15, gap * 2)
      : Math.max(gap * 2, SUN_CFG.radius * 4);

    const n = radii.length;
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      const active = i < n;
      r.mesh.visible = active;
      r.arc.visible = active && inside === 1;
      if (!active) continue;
      r.mesh.scale.setScalar(radii[i]);
      // 两端各淡出两层：窗口边界的球壳增删发生在不可见处，
      // 主波前处的 i=0 也淡出，避免与带经纬网的主球重合。
      const fade = n <= 3 ? 1
        : Math.min(1, Math.max(0, i / 2))
          * Math.min(1, Math.max(0, (n - 1 - i) / 2));
      const u = r.mat.uniforms;
      u.uLayerFade.value = fade;
      u.uShellRadius.value = radii[i];
      u.uCamRadius.value = focusRadius;
      u.uSweepWidth.value = sweepWidth;
      u.uInside.value = inside;
      if (inside === 1) {
        // 同心波环：圆平面每帧垂直于视线，亮度按 w² 拉开 →
        // 一两道亮波从中心向外扫过，其余淡出，不成平行线、不叠加。
        const w = sweepWeight(radii[i], focusRadius, sweepWidth);
        r.arc.visible = w > 0.08 && fade > 0;
        r.arc.quaternion.copy(camera.quaternion);
        r.arc.scale.setScalar(radii[i]);
        r.arcMat.opacity = (0.04 + 0.95 * w * w) * fade;
      }
    }

    for (const r of rays) {
      orbitalPosition(r.cfg, simTime, _v);
      r.arr[0] = 0; r.arr[1] = 0; r.arr[2] = 0;
      r.arr[3] = _v.x; r.arr[4] = _v.y; r.arr[5] = _v.z;
      r.geo.attributes.position.needsUpdate = true;
      r.mat.uniforms.uFront.value = mainR;
    }
  }

  function setVisible(on) {
    group.visible = on;
  }

  return { update, setVisible, isInside: () => cameraInside };
}
