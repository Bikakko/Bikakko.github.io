/* ============================================================
   太阳系 · Solar · 3D 光速视觉层（脉冲线框球）
   - 每层光球是真实 3D 线框球：统一亮度的经纬线 + 黄道面大圆（光弧），
     没有 fresnel 高亮、没有球面面片。线宽恒为 1px，与球半径无关。
     最外层主球用完整经纬网（12 纬 / 24 经），后续脉冲层用稀疏网
     （6 纬 / 8 经）避免多层叠加糊成一团；每层各自的大圆形成涟漪。
   - 太阳每隔 600 光秒发出一层新球（默认倍率 600× 下每真实 1 秒一层）。
     层数由 lightSec 纯函数推导，暂停/重播/截图都一致；相机被外层光球
     包裹后仍能看到后续脉冲不断从太阳向外扩散。
   - 八条太阳→行星光线，按最外层波前半径裁断，前端高亮。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { pulseRadii } from "./light-math.js";
import { qPulse, MAX_PULSES } from "./config.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

// 单位球经纬线（LineSegments）。旧的球面着色器约 8 纬 / 16 经，主球略提高到
// 12 纬 / 24 经；脉冲层用一半密度，保证多层同时可见时仍能分辨层次。
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

  const mainGridGeo = makeGridGeometry(12, 24, 72);
  const pulseGridGeo = makeGridGeometry(6, 8, 48);
  const circleGeo = makeCircleGeometry();
  // 所有经纬线与大圆共用同一材质：颜色、亮度完全一致。
  // 普通混合而非加性：多层同心球叠加时颜色收敛到线色，不会累积成白屏。
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffb066, transparent: true, opacity: 0.34,
    depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
  });

  const slots = [];
  for (let i = 0; i < MAX_PULSES; i++) {
    const grid = new THREE.LineSegments(i === 0 ? mainGridGeo : pulseGridGeo, lineMat);
    const equator = new THREE.LineLoop(circleGeo, lineMat);
    equator.rotation.x = -Math.PI / 2;              // XZ：黄道面
    const parts = [grid, equator];
    if (i === 0) {
      // 最外层主球额外带两条子午圆，给出球体的纵深骨架
      const merA = new THREE.LineLoop(circleGeo, lineMat);   // XY
      const merB = new THREE.LineLoop(circleGeo, lineMat);   // YZ
      merB.rotation.y = Math.PI / 2;
      parts.push(merA, merB);
    }
    for (const o of parts) {
      o.frustumCulled = false;
      o.visible = false;
      o.renderOrder = 3;
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

  function update(lightSec, simTime) {
    // radii[0] 是最老 / 最大的主波前，最后一个是刚发出的新脉冲
    const radii = pulseRadii(lightSec, qPulse);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const active = i < radii.length;
      for (const o of s.parts) {
        o.visible = active;
        if (active) o.scale.setScalar(radii[i]);
      }
    }

    const mainR = radii[0];
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
