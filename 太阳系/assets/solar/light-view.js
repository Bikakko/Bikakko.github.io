/* ============================================================
   太阳系 · Solar · 3D 光速视觉层（半透明光球 + 真实时间脉冲）
   - 每层光球是真实 3D 半透明球面：轮廓略亮、内部极淡，普通混合。
     多层叠加只会收敛到球面颜色，不会累积成白团（不做加性混合）。
   - 经纬线只画在最外层主球上，统一普通亮度、1px 线宽；多层各画一套
     会叠成密密麻麻的平行线，所以整套场景只有一套经纬网。
     每层另有黄道面大圆（光弧），主球额外带两条子午圆给出纵深。
   - 脉冲按「现实时间」每 1 秒一层，与模拟倍率无关：换算成模拟时间轴
     间隔 = rateSec × qPulseEvery，仍是 lightSec 的纯函数，可复现。
     最多 8 层；相机被外层光球包裹后仍能看到后续脉冲从太阳向外扩散。
   - 八条太阳→行星光线，按主波前半径裁断，前端高亮。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { pulseRadii, frontRadius } from "./light-math.js";
import { qPulseEvery, MAX_PULSES } from "./config.js";
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

  /* ---------- 半透明光球 ----------
     NormalBlending：N 层相同颜色叠加后趋向球面色，不会像加性混合那样
     越叠越亮直至白屏。内部 alpha 极低，只有轮廓（fres）可见为细环，
     因此多层球壳叠在一起也不会糊住内部行星。 */
  const sphereMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor:   { value: new THREE.Color(0xffc078) },
      uOpacity: { value: 0.11 },
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
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
        float a = uOpacity * (0.18 + 0.82 * fres);
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

  const slots = [];
  for (let i = 0; i < MAX_PULSES; i++) {
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.renderOrder = 2;
    const equator = new THREE.LineLoop(circleGeo, lineMat);
    equator.rotation.x = -Math.PI / 2;              // XZ：黄道面
    equator.renderOrder = 3;
    const parts = [sphere, equator];
    if (i === 0) {
      // 整套场景只有这一套经纬网，避免多层叠加成平行线团
      const grid = new THREE.LineSegments(gridGeo, lineMat);
      const merA = new THREE.LineLoop(circleGeo, lineMat);   // XY
      const merB = new THREE.LineLoop(circleGeo, lineMat);   // YZ
      merB.rotation.y = Math.PI / 2;
      for (const o of [grid, merA, merB]) o.renderOrder = 3;
      parts.push(grid, merA, merB);
    }
    for (const o of parts) {
      o.frustumCulled = false;
      o.visible = false;
      group.add(o);
    }
    slots.push({ parts });
  }

  /* ---------- 八条光线（世界空间线段） ---------- */
  const rayMatFor = () => new THREE.ShaderMaterial({
    uniforms: { uFront: { value: 0 } },
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
      varying vec3 vWorld;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float d = length(vWorld);
        if (d > uFront) discard;
        float head = smoothstep(uFront * 0.94, uFront, d);
        vec3 col = mix(vec3(0.42, 0.60, 1.0), vec3(1.0, 0.85, 0.55), head);
        gl_FragColor = vec4(col, 0.22 + 0.65 * head);
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

  // rateSec：当前统一倍率（模拟秒/真实秒），用于把「每真实 1 秒」换算成
  // 模拟时间轴上的脉冲间隔。脉冲序列仍是 lightSec 的纯函数。
  function update(lightSec, simTime, rateSec = 1) {
    const interval = Math.max(1, rateSec * qPulseEvery);
    const radii = pulseRadii(lightSec, interval);   // [主波前, 最近若干脉冲]
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const active = i < radii.length;
      for (const o of s.parts) {
        o.visible = active;
        if (active) o.scale.setScalar(radii[i]);
      }
    }

    const mainR = frontRadius(lightSec);
    // rig.updateCamera 只改了 position/quaternion，renderer.render 才会刷新
    // matrixWorld；本函数在 render 之前执行，需自行取本帧相机位置。
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    cameraInside = _camPos.lengthSq() < mainR * mainR;

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
