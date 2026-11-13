import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLightView } from "../assets/solar/light-view.js";
import { UNITS_PER_LIGHT_SEC } from "../assets/solar/config.js";
import { PLANETS } from "../assets/solar/bodies.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

// update() 只读这两个视口量；Node 下给固定值即可
globalThis.window = { innerHeight: 1080, devicePixelRatio: 1 };

const MAX_BEADS = 20000;
const MIN_GAP_PX = 12;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
  camera.position.set(0, 120, 400);
  const view = createLightView(scene, camera);
  const update = view.update.bind(view);
  // 旧测试默认观察地球；传 null 可显式验证无聚焦状态。
  view.update = (lightSec, simTime, focusCfg = PLANETS[2]) => update(lightSec, simTime, focusCfg);
  const group = scene.children.find(o => o.isGroup);
  const beads = group.children.filter(o => o.isPoints);
  const rays = group.children.filter(o => o.isLine);
  return { view, scene, camera, group, beads, rays, geo: beads[0].geometry };
}

// 相机到聚焦的「太阳→地球」线段的最近距离：纯几何量，独立于被测实现
function nearestRayDistance(camera, simTime) {
  const cam = camera.position;
  const p = orbitalPosition(PLANETS[2], simTime, new THREE.Vector3());
  const len = p.length();
  const t = Math.min(len, Math.max(0, cam.dot(p) / len));
  return p.clone().multiplyScalar(t / len).sub(cam).length();
}

const projScaleOf = (camera) =>
  (window.innerHeight * 0.5) / Math.tan(camera.fov * Math.PI / 360);

test("八条光线共享同一份亮点缓冲，drawRange 初始覆盖全缓冲", () => {
  const { beads, geo } = setup();
  assert.equal(beads.length, 8);
  for (const b of beads) assert.equal(b.geometry, geo);
  assert.equal(geo.drawRange.count, Infinity);   // 未 update 前保持 three 默认
});

test("drawRange 按聚焦光线长度 / 抽稀步长收敛，与光球半径无关", () => {
  const { view, geo } = setup();
  const earthLength = t => {
    const p = orbitalPosition(PLANETS[2], t, out());
    return Math.hypot(p.x, p.y, p.z);
  };
  const expected = (_lightSec, t) => {
    const step = view.getBeadStep();
    const spacing = UNITS_PER_LIGHT_SEC * step;
    const phase = ((t * 86400 * UNITS_PER_LIGHT_SEC) % spacing + spacing) % spacing;
    const need = Math.floor(Math.max(0, earthLength(t) - phase) / spacing) + 1;
    return Math.min(MAX_BEADS, need);
  };

  view.update(0, 0);
  assert.equal(geo.drawRange.count, expected(0, 0));
  assert.ok(geo.drawRange.count < 10);

  view.update(600, 600 / 86400);
  assert.equal(geo.drawRange.count, expected(600, 600 / 86400));

  const tFar = 20000 / 86400;
  view.update(20000, tFar);
  assert.equal(geo.drawRange.count, expected(20000, tFar));
  assert.ok(geo.drawRange.count < MAX_BEADS);
});

test("drawRange 只在点数变化时重写（脏检查）", () => {
  const { view, geo } = setup();
  const orig = geo.setDrawRange.bind(geo);
  let calls = 0;
  geo.setDrawRange = (...a) => { calls++; orig(...a); };
  view.update(600, 600 / 86400);
  assert.equal(calls, 1);
  view.update(600, 600 / 86400);
  view.update(600, 600 / 86400);
  assert.equal(calls, 1);
  // 连续相位越过光线长度余数时，有效点数必然变化一次
  const step = view.getBeadStep();
  for (let i = 1; i <= Math.ceil(step) * 4 && calls === 1; i++) {
    const t = 600 + i * 0.25;
    view.update(t, t / 86400);
  }
  assert.equal(calls, 2);
});

test("亮点与光球解耦：光球未到达也有完整光子流，并随 simTime 连续流动", () => {
  const { view, camera, beads, geo } = setup();
  const simTime = 0;
  const earth = PLANETS.find(p => p.name === "地球");
  const p = orbitalPosition(earth, simTime, new THREE.Vector3());
  camera.position.copy(p).add(new THREE.Vector3(earth.radius * 3, 0, 0));
  const u = beads[PLANETS.indexOf(earth)].material.uniforms;

  view.update(0, simTime);   // 光球仍在太阳处，聚焦行星亮点已应铺满全程
  assert.equal(view.getBeadStep(), 1);
  const activeDistances = () => {
    const spacing = UNITS_PER_LIGHT_SEC * u.uStride.value;
    const head = u.uAnchorDist.value + u.uHeadRel.value;
    const distances = [];
    for (let n = 0; n < geo.drawRange.count; n++) {
      const d = head - n * spacing;
      if (d >= -1e-8 && d <= u.uRayLen.value) distances.push(d);
    }
    return distances;
  };
  const before = activeDistances();
  assert.ok(before.length > 100, `光球未到达时也应有大量亮点，实得 ${before.length}`);

  const dt = 0.25;
  view.update(0, simTime + dt / 86400);
  const after = activeDistances();
  const delta = dt * UNITS_PER_LIGHT_SEC;
  assert.ok(after.length > 100, "后续帧亮点不应消失");
  for (const d of before) {
    if (d + delta > u.uRayLen.value + 1e-8) continue;
    assert.ok(after.some(next => Math.abs(next - d - delta) < 1e-8),
      "未到达行星的旧亮点应继续以光速向外运动");
  }

  view.update(0, simTime + 1e9 / 86400);
  assert.ok(activeDistances().length > 100, "长时间运行后光子流仍应正常");
  assert.ok(geo.drawRange.count < MAX_BEADS, "点数只取决于光线长度，不随时间累积");
});

test("全景视距下亮点按整数光秒抽稀，屏幕间距始终 ≥ 12px（回归：曾经恒为 0 像素）", () => {
  const { view, camera, beads } = setup();
  const simTime = 0;
  // 418 单位的全景视距：1 光秒只投影成 0.05px，旧实现把全部亮点淡出
  view.update(15010, simTime);
  const step = view.getBeadStep();
  assert.ok(Number.isInteger(step) && step > 1, `全景应抽稀，实得 step=${step}`);

  const near = nearestRayDistance(camera, simTime);
  const gapPx = UNITS_PER_LIGHT_SEC * step * projScaleOf(camera) / near;
  assert.ok(gapPx >= MIN_GAP_PX, `最近处间距 ${gapPx}px 应 ≥ ${MIN_GAP_PX}`);
  // 步长取最小整数：再减 1 就不满足间距下限
  if (step > 1) {
    const tighter = UNITS_PER_LIGHT_SEC * (step - 1) * projScaleOf(camera) / near;
    assert.ok(tighter < MIN_GAP_PX, `step=${step} 不是最小可行步长`);
  }
  assert.equal(beads[2].material.uniforms.uStride.value, step);
});

test("贴近行星时步长回到 1：仍是逐颗的 1 光秒亮点", () => {
  const simTime = 0;
  const earth = PLANETS.find(p => p.name === "地球");
  const p = orbitalPosition(earth, simTime, new THREE.Vector3());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 1e-6, 6000);
  camera.position.copy(p).add(new THREE.Vector3(earth.radius * 3, 0, 0));
  const view = createLightView(scene, camera);
  view.update(p.length() / UNITS_PER_LIGHT_SEC + 2, simTime, earth);
  assert.equal(view.getBeadStep(), 1);
});

test("八条光线始终完整连接行星，只有聚焦行星显示光秒亮点", () => {
  const { view, beads, rays } = setup();
  const simTime = 123.4;
  view.update(900, simTime);
  rays.forEach((ray, i) => {
    const p = orbitalPosition(PLANETS[i], simTime, out());
    assert.equal("uFront" in ray.material.uniforms, false, "光线不应再按波前裁断");
    assert.ok(!/discard|uFront/.test(ray.material.fragmentShader));
    // 光线顶点存「世界坐标 − 相机位置」，加回 line.position 应还原行星位置
    const arr = ray.geometry.attributes.position.array;
    const lp = ray.position;
    assert.ok(Math.abs(arr[3] + lp.x - p.x) < 1e-4
      && Math.abs(arr[4] + lp.y - p.y) < 1e-4
      && Math.abs(arr[5] + lp.z - p.z) < 1e-4);
    assert.ok(Math.abs(arr[0] + lp.x) < 1e-4
      && Math.abs(arr[1] + lp.y) < 1e-4
      && Math.abs(arr[2] + lp.z) < 1e-4, "起点应是太阳（世界原点）");
    assert.equal(beads[i].visible, i === 2);
  });
  const earth = orbitalPosition(PLANETS[2], simTime, out());
  const len = Math.hypot(earth.x, earth.y, earth.z);
  assert.ok(Math.abs(beads[2].material.uniforms.uRayLen.value - len) < 1e-9);
  assert.equal("uFront" in beads[2].material.uniforms, false, "亮点不应再受光球波前裁断");
});

test("光线顶点是相机相对小量：贴近行星时端精度不被 float32 量化掉", () => {
  const simTime = 0;
  const neptune = PLANETS[PLANETS.length - 1];
  const p = orbitalPosition(neptune, simTime, out());

  // 相机贴到海王星旁边（1.05 倍半径），光线终点应只剩 ~1e-3 的相机距离
  const R = neptune.radius * 1.05;
  const cam = new THREE.Vector3(p.x + R, p.y, p.z);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 1e-6, 6000);
  camera.position.copy(cam);
  const view = createLightView(scene, camera);
  view.update(20000, simTime, neptune);
  const group = scene.children.find(o => o.isGroup);
  const line = group.children.filter(o => o.isLine).pop();
  const arr = line.geometry.attributes.position.array;
  const end = new THREE.Vector3(arr[3], arr[4], arr[5]);
  assert.ok(end.length() < R * 1.01,
    `终点应是相机相对小量（~${R}），实得 ${end.length()}`);
  assert.ok(line.position.distanceTo(cam) < 1e-12, "line.position 应跟随相机");
  // 还原世界坐标仍落在行星上（float32 在 ~300 量级的 eps 约 3e-5）
  const world = end.clone().add(line.position);
  assert.ok(world.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-4);
});

test("亮点锚点是相机相对小量，且还原出的世界位置落在光线上", () => {
  const simTime = 0;
  const neptune = PLANETS[PLANETS.length - 1];
  const p = orbitalPosition(neptune, simTime, new THREE.Vector3());
  const camDist = neptune.radius * 1.05;
  const cam = p.clone().add(new THREE.Vector3(camDist, 0, 0));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 1e-6, 6000);
  camera.position.copy(cam);
  const view = createLightView(scene, camera);
  const lightSec = p.length() / UNITS_PER_LIGHT_SEC + 2;
  view.update(lightSec, simTime, neptune);

  const group = scene.children.find(o => o.isGroup);
  const beads = group.children.filter(o => o.isPoints).pop();
  const u = beads.material.uniforms;
  assert.ok(beads.position.distanceTo(cam) < 1e-12, "beads.position 应跟随相机");
  assert.ok(u.uAnchorRel.value.length() < camDist * 1.01,
    `锚点应是相机相对小量，实得 ${u.uAnchorRel.value.length()}`);
  assert.ok(Math.abs(u.uHeadRel.value) < 4 * UNITS_PER_LIGHT_SEC,
    `波前刚过行星，最外侧亮点应离锚点仅几光秒，实得 ${u.uHeadRel.value}`);

  // 锚点 + 相机 = 光线上的点；沿 uDir 走 uHeadRel 到最外侧有效亮点
  const anchorWorld = u.uAnchorRel.value.clone().add(cam);
  const dir = u.uDir.value;
  assert.ok(Math.abs(anchorWorld.length() - anchorWorld.dot(dir)) < 1e-9,
    "锚点应落在太阳→行星的射线上");
  assert.ok(Math.abs(anchorWorld.length() - u.uAnchorDist.value) < 1e-9,
    "uAnchorDist 应是锚点的日心距离");
  const headWorld = anchorWorld.clone().addScaledVector(dir, u.uHeadRel.value);
  assert.ok(Math.abs(headWorld.length() - u.uAnchorDist.value - u.uHeadRel.value) < 1e-9);

  // 近距亮点（k 很小）的世界坐标必须精确落在光线上，误差远小于相机距离
  for (const k of [0, 1, 2, 3]) {
    const world = anchorWorld.clone().addScaledVector(dir, u.uHeadRel.value - k * UNITS_PER_LIGHT_SEC);
    const cross = world.clone().cross(dir).length();
    assert.ok(cross < camDist * 1e-6, `第 ${k} 颗亮点偏离光线 ${cross}`);
  }
});

test("相机进入波前球内时 isInside 翻转", () => {
  const { view } = setup();
  view.update(30000, 0);   // R ≈ 605 单位 > 相机距离 ≈ 418
  assert.equal(view.isInside(), true);
  view.update(1, 0);       // R 极小，相机在球外
  assert.equal(view.isInside(), false);
});