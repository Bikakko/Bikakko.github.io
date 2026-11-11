/* ============================================================
   近距离精度回归：行星/光线的顶点变换不得在 GPU 上做大数相消

   真实比例下天体世界坐标是 10（地球）～303（海王星）量级，而贴近观察时
   相机距离只有 ~1e-4。modelMatrix / viewMatrix 的平移分量各自以 float32
   上传（舍入误差 ~4e-7），若在 shader 里连乘 viewMatrix*modelMatrix，
   两个大数相减得到的小差值会把舍入误差放大成整像素抖动。

   three 的 modelViewMatrix 是在 CPU 用 double 算好再上传的，平移分量本身
   就是相机相对小量，没有相消——所有自定义 ShaderMaterial 都必须走它。
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PLANETS } from "../assets/solar/bodies.js";
import { UNITS_PER_LIGHT_SEC } from "../assets/solar/config.js";
import { orbitalPosition, barycenterCorrectedPosition } from "../assets/solar/orbit-math.js";
import { makePlanetMaterial } from "../assets/solar/shaders.js";
import { createLightView } from "../assets/solar/light-view.js";

globalThis.window = { innerHeight: 1080, devicePixelRatio: 1 };

/* ---------- float32 复刻 GPU 运算（GLSL 每步都 round 到 float32） ---------- */
const f = Math.fround;
const f32 = (m) => m.elements.map(f);

function mul44(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s = f(s + f(f(a[k * 4 + r]) * f(b[c * 4 + k])));
    o[c * 4 + r] = f(s);
  }
  return o;
}
function mul4v(a, v) {
  const o = new Array(4);
  for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s = f(s + f(f(a[k * 4 + r]) * f(v[k])));
    o[r] = f(s);
  }
  return o;
}
function mul4vD(m, v) {
  const e = m.elements ?? m, o = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[r] += e[k * 4 + r] * v[k];
  return o;
}
const W = 1920, H = 1080;
const toPx = (c) => [(c[0] / c[3] * 0.5 + 0.5) * W, (0.5 - c[1] / c[3] * 0.5) * H];
const pxDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- 着色器源码不变量 ---------- */
test("行星顶点着色器用 modelViewMatrix 投影，不在 shader 里连乘 viewMatrix", () => {
  const vs = makePlanetMaterial(PLANETS[2]).vertexShader;
  assert.ok(/gl_Position\s*=\s*projectionMatrix\s*\*\s*mv\b/.test(vs)
    || /gl_Position\s*=\s*projectionMatrix\s*\*\s*modelViewMatrix/.test(vs),
    "gl_Position 必须走 modelViewMatrix");
  assert.ok(!/projectionMatrix\s*\*\s*viewMatrix/.test(vs),
    "projectionMatrix*viewMatrix 会在 float32 下相消，贴近行星时整像素抖动");
  assert.ok(vs.includes("vViewPos"), "应传递视空间位置供边缘光使用");
});

test("行星边缘光视线在视空间求，不做 cameraPosition - vWorldPos 大数相减", () => {
  const fs = makePlanetMaterial(PLANETS[2]).fragmentShader;
  assert.ok(!/cameraPosition\s*-\s*vWorldPos/.test(fs),
    "cameraPosition 与 vWorldPos 同为 10 量级，相减会淹没 ~1e-4 的相机距离");
  assert.ok(/normalize\(-vViewPos\)/.test(fs), "视线应由视空间位置求得");
});

test("光线顶点着色器同样走 modelViewMatrix", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
  createLightView(scene, camera);
  const group = scene.children.find(o => o.isGroup);
  for (const line of group.children.filter(o => o.isLine)) {
    const vs = line.material.vertexShader;
    assert.ok(/gl_Position\s*=\s*projectionMatrix\s*\*\s*modelViewMatrix/.test(vs));
    assert.ok(!/projectionMatrix\s*\*\s*viewMatrix/.test(vs));
  }
});

test("亮点顶点着色器用锚点相对量，不在 shader 里还原世界坐标", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
  createLightView(scene, camera);
  const group = scene.children.find(o => o.isGroup);
  for (const pts of group.children.filter(o => o.isPoints)) {
    const vs = pts.material.vertexShader;
    assert.ok(/uAnchorRel\s*\+\s*uDir\s*\*\s*\(uFrontRel\s*-\s*step\)/.test(vs),
      "亮点位置必须由锚点相对量合成");
    assert.ok(/modelViewMatrix\s*\*\s*vec4\(rel,\s*1\.0\)/.test(vs),
      "投影的必须是相机相对小量 rel，而不是 uDir * d 的世界坐标");
    assert.ok(!/vec4\(uDir\s*\*\s*d,\s*1\.0\)/.test(vs),
      "uDir*d 是 300 量级的世界坐标，与 modelViewMatrix 平移相消");
  }
});

/* ---------- 数值不变量：贴近行星时投影必须亚 0.01px ---------- */
const camera = new THREE.PerspectiveCamera(48, W / H, 0.5, 6000);
const group = new THREE.Group();
const mv = new THREE.Matrix4();

// 返回 { naive, fixed }：两条路径相对 double 参考的最大屏幕偏差（px）
function deviation(cfg, dist, frames = 24) {
  const wp = new THREE.Vector3();
  if (cfg.satellites) barycenterCorrectedPosition(cfg, 0, wp);
  else orbitalPosition(cfg, 0, wp);
  group.position.copy(wp);
  group.updateMatrixWorld(true);

  let naive = 0, fixed = 0;
  for (let i = 0; i < frames; i++) {
    const theta = 0.9 + i * 0.0006, phi = 1.31;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    camera.position.set(wp.x + dist * sp * Math.sin(theta), wp.y + dist * cp, wp.z + dist * sp * Math.cos(theta));
    camera.lookAt(wp);
    camera.near = Math.min(0.5, Math.max(1e-6, dist * 0.01));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    mv.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);

    const P = f32(camera.projectionMatrix), V = f32(camera.matrixWorldInverse);
    const M = f32(group.matrixWorld), MV = f32(mv);
    const PV = mul44(P, V), PMV = mul44(P, MV);
    // 星球中心：相机始终 lookAt 它，参考投影恒为屏幕中心
    const s = [0, 0, 0, 1];
    const ref = toPx(mul4vD(mv, s));
    naive = Math.max(naive, pxDist(toPx(mul4v(PV, mul4v(M, s))), ref));
    fixed = Math.max(fixed, pxDist(toPx(mul4v(PMV, s)), ref));
  }
  return { naive, fixed };
}

test("修复路径在贴面距离下亚 0.01px；旧的连乘路径确实会抖（敏感性校验）", () => {
  let naiveWorst = 0;
  for (const cfg of PLANETS) {
    for (const mult of [1.05, 3, 11]) {
      const { naive, fixed } = deviation(cfg, cfg.radius * mult);
      assert.ok(fixed < 0.01,
        `${cfg.name} @${mult}R 修复路径偏差 ${fixed.toFixed(4)}px 应 < 0.01px`);
      naiveWorst = Math.max(naiveWorst, naive);
    }
  }
  // 若这条断言失败，说明上面的阈值失去了区分力（而不是 bug 消失了）
  assert.ok(naiveWorst > 0.5,
    `旧路径最坏偏差仅 ${naiveWorst.toFixed(3)}px，测试已无法区分两条路径`);
});

/* ---------- 亮点：锚点相对路径 vs 旧的世界坐标路径 ---------- */
const beadCam = new THREE.PerspectiveCamera(48, W / H, 0.5, 6000);

// 返回 { naive, fixed }：波前附近 8 颗亮点相对 double 参考的最大屏幕偏差（px）
function beadDeviation(cfg, dist, frames = 12) {
  const wp = orbitalPosition(cfg, 0, new THREE.Vector3());
  const rayLen = wp.length();
  const scene = new THREE.Scene();
  const view = createLightView(scene, beadCam);
  const beads = scene.children.find(o => o.isGroup).children.filter(o => o.isPoints);
  const target = beads[PLANETS.indexOf(cfg)];

  let naive = 0, fixed = 0;
  for (let i = 0; i < frames; i++) {
    const theta = 0.9 + i * 0.0007, phi = 1.31;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    beadCam.position.set(wp.x + dist * sp * Math.sin(theta), wp.y + dist * cp, wp.z + dist * sp * Math.cos(theta));
    beadCam.lookAt(wp);
    beadCam.near = Math.min(0.5, Math.max(1e-6, dist * 0.01));
    beadCam.updateProjectionMatrix();
    beadCam.updateMatrixWorld(true);
    view.update(rayLen / UNITS_PER_LIGHT_SEC + 2, 0);

    const u = target.material.uniforms;
    const dir = u.uDir.value, anchor = u.uAnchorRel.value;
    const stride = u.uStride.value, R = u.uFront.value;
    // Points 平移到相机位置 → MV 的平移分量趋近 0（CPU double）
    const model = new THREE.Matrix4().makeTranslation(target.position.x, target.position.y, target.position.z);
    const mvBeads = new THREE.Matrix4().multiplyMatrices(beadCam.matrixWorldInverse, model);
    const PMV = mul44(f32(beadCam.projectionMatrix), f32(mvBeads));
    const PMV0 = mul44(f32(beadCam.projectionMatrix), f32(beadCam.matrixWorldInverse));
    const dirF = [f(dir.x), f(dir.y), f(dir.z)];
    const ancF = [f(anchor.x), f(anchor.y), f(anchor.z)];
    const frontRelF = f(u.uFrontRel.value), frontF = f(R), spF = f(UNITS_PER_LIGHT_SEC);

    for (let n = 0; n < 8; n++) {
      const k = n * stride;
      const dD = R - k * UNITS_PER_LIGHT_SEC;
      if (dD < 0 || dD > rayLen) continue;
      const worldRef = new THREE.Vector3(dir.x * dD, dir.y * dD, dir.z * dD);
      const ref = toPx(mul4vD(beadCam.projectionMatrix, mul4vD(beadCam.matrixWorldInverse,
        [worldRef.x, worldRef.y, worldRef.z, 1])));
      if (!Number.isFinite(ref[0]) || Math.abs(ref[0]) > 1e5) continue;

      // 旧路径：shader 里 uDir*d 得到 ~300 量级世界坐标，再乘 viewMatrix
      const stepF = f(f(k) * spF);
      const dF = f(frontF - stepF);
      const naivePos = [f(dirF[0] * dF), f(dirF[1] * dF), f(dirF[2] * dF), 1];
      naive = Math.max(naive, pxDist(toPx(mul4v(PMV0, naivePos)), ref));

      // 新路径：锚点相对小量
      const deltaF = f(frontRelF - stepF);
      const rel = [f(ancF[0] + f(dirF[0] * deltaF)), f(ancF[1] + f(dirF[1] * deltaF)),
        f(ancF[2] + f(dirF[2] * deltaF)), 1];
      fixed = Math.max(fixed, pxDist(toPx(mul4v(PMV, rel)), ref));
    }
  }
  return { naive, fixed };
}

test("亮点锚点路径在贴面距离下亚 0.01px；旧的世界坐标路径会脱离光线", () => {
  let naiveWorst = 0;
  for (const cfg of PLANETS) {
    for (const mult of [1.05, 3, 11]) {
      const { naive, fixed } = beadDeviation(cfg, cfg.radius * mult);
      assert.ok(fixed < 0.01,
        `${cfg.name} @${mult}R 亮点偏差 ${fixed.toFixed(4)}px 应 < 0.01px`);
      naiveWorst = Math.max(naiveWorst, naive);
    }
  }
  assert.ok(naiveWorst > 0.5,
    `旧路径最坏偏差仅 ${naiveWorst.toFixed(3)}px，测试已无法区分两条路径`);
});