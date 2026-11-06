import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLightView } from "../assets/solar/light-view.js";
import { frontRadius } from "../assets/solar/light-math.js";
import { UNITS_PER_LIGHT_SEC } from "../assets/solar/config.js";
import { PLANETS } from "../assets/solar/bodies.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

// update() 只读这两个视口量；Node 下给固定值即可
globalThis.window = { innerHeight: 1080, devicePixelRatio: 1 };

const MAX_BEADS = 20000;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
  camera.position.set(0, 120, 400);
  const view = createLightView(scene, camera);
  const group = scene.children.find(o => o.isGroup);
  const beads = group.children.filter(o => o.isPoints);
  const rays = group.children.filter(o => o.isLine);
  return { view, group, beads, rays, geo: beads[0].geometry };
}

test("八条光线共享同一份亮点缓冲，drawRange 初始覆盖全缓冲", () => {
  const { beads, geo } = setup();
  assert.equal(beads.length, 8);
  for (const b of beads) assert.equal(b.geometry, geo);
  assert.equal(geo.drawRange.count, Infinity);   // 未 update 前保持 three 默认
});

test("drawRange 按 min(波前, 最长光线) 收敛，不再全量跑 20000 顶点", () => {
  const { view, geo } = setup();
  const maxRayAt = t => Math.max(...PLANETS.map(cfg => {
    const p = orbitalPosition(cfg, t, out());
    return Math.hypot(p.x, p.y, p.z);
  }));

  // 波前刚出发：只需日面半径内的几个点
  view.update(0, 0);
  const r0 = frontRadius(0);
  assert.equal(geo.drawRange.count, Math.floor(Math.min(r0, maxRayAt(0)) / UNITS_PER_LIGHT_SEC) + 1);
  assert.ok(geo.drawRange.count < 10);

  // 600 光秒：波前短于所有外行星光线，点数 ≈ 600 + 1（浮点边界允许 ±1）
  view.update(600, 600 / 86400);
  assert.ok(Math.abs(geo.drawRange.count - 601) <= 1, `count=${geo.drawRange.count}`);

  // 波前越过海王星：点数被最长光线夹住，仍远小于 MAX_BEADS
  const tFar = 20000 / 86400;
  view.update(20000, tFar);
  const expected = Math.min(MAX_BEADS, Math.floor(maxRayAt(tFar) / UNITS_PER_LIGHT_SEC) + 1);
  assert.equal(geo.drawRange.count, expected);
  assert.ok(expected < MAX_BEADS);
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
  view.update(601, 601 / 86400);
  assert.equal(calls, 2);
});

test("每条光线的 uRayLen/uFront 与当前历元行星距离一致", () => {
  const { view, beads, rays } = setup();
  const simTime = 123.4;
  view.update(900, simTime);
  const R = frontRadius(900);
  beads.forEach((b, i) => {
    const p = orbitalPosition(PLANETS[i], simTime, out());
    const len = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(b.material.uniforms.uRayLen.value - len) < 1e-9);
    assert.ok(Math.abs(b.material.uniforms.uFront.value - R) < 1e-9);
    assert.ok(Math.abs(rays[i].material.uniforms.uFront.value - R) < 1e-9);
    // 光线终点 = 行星当前位置（float32 缓冲，容差按 ~300 单位的 eps 取）
    const arr = rays[i].geometry.attributes.position.array;
    assert.ok(Math.abs(arr[3] - p.x) < 1e-4 && Math.abs(arr[4] - p.y) < 1e-4 && Math.abs(arr[5] - p.z) < 1e-4);
  });
});

test("相机进入波前球内时 isInside 翻转", () => {
  const { view } = setup();
  view.update(30000, 0);   // R ≈ 605 单位 > 相机距离 ≈ 418
  assert.equal(view.isInside(), true);
  view.update(1, 0);       // R 极小，相机在球外
  assert.equal(view.isInside(), false);
});