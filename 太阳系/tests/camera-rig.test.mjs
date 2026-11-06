import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCameraRig } from "../assets/solar/camera.js";
import { maxPhiForDistance, MAX_PHI } from "../assets/solar/camera-math.js";
import { PLANETS } from "../assets/solar/bodies.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

/* 相机手势/缓动/聚焦过渡的无浏览器回归：
   只 stub 事件注册与视口尺寸，数学与状态机跑真实代码。
   浏览器冒烟曾受 in-app 面板隐藏（rAF 停摆）限制，这里逐帧驱动补全验证。 */

let nowMs = 1000;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => nowMs }, configurable: true,
});
globalThis.innerWidth = 1000;
globalThis.innerHeight = 1000;

function makeRig() {
  const win = {}, cvs = {}, doc = {};
  const on = bag => (t, fn) => { (bag[t] ||= []).push(fn); };
  globalThis.addEventListener = on(win);
  globalThis.document = {
    addEventListener: on(doc),
    documentElement: { classList: { add() {}, remove() {} } },
  };
  const canvas = {
    addEventListener: on(cvs),
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  };
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);
  const planets = PLANETS.map(cfg => {
    const group = new THREE.Object3D();
    orbitalPosition(cfg, 0, group.position);
    return { cfg, group };
  });
  const space = {
    planets,
    focusables: planets.map(p => ({ cfg: p.cfg, group: p.group })),
    clickable: [],
    moonMesh: null,
    sunGroup: new THREE.Object3D(),
  };
  const hud = { hideInfo() {}, showInfo() {} };
  const rig = createCameraRig({ canvas, camera, space, hud });
  const fire = (bag, t, e) => (bag[t] || []).forEach(fn => fn(e));
  const step = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) { nowMs += dt * 1000; rig.updateCamera(dt); }
  };
  const wheel = (dy, x = 500, y = 500) => rig.handleWheel({
    preventDefault() {}, deltaY: dy, deltaMode: 0, clientX: x, clientY: y,
  });
  const key = (code, type, guarded) => {
    const e = {
      code, ctrlKey: false, metaKey: false, altKey: false,
      target: { closest: () => (guarded ? {} : null) },
      preventDefault() { this.pd = true; },
    };
    fire(win, type, e);
    return e;
  };
  return { rig, orbit: rig.orbit, camera, planets, win, cvs, step, wheel, key };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol;

test("滚轮推拉：tDist 立即生效，dist 对数缓动单调收敛", () => {
  const { rig, orbit, step, wheel } = makeRig();
  const d0 = orbit.dist;
  wheel(-100);
  assert.ok(orbit.tDist < d0, "滚轮应设定更近的目标距离");
  let prev = orbit.dist;
  for (let i = 0; i < 240; i++) {
    step(1);
    assert.ok(orbit.dist <= prev + 1e-12, "拉近过程不应回跳");
    prev = orbit.dist;
  }
  assert.ok(close(orbit.dist, orbit.tDist, orbit.tDist * 0.02));
  assert.ok(rig.getZoomAnchorName() !== undefined);
});

test("聚焦过渡：0.5s 到站取景距离，到站后目标严格跟随天体", () => {
  const { rig, orbit, planets, step } = makeRig();
  const earth = planets.find(p => p.cfg.name === "地球");
  rig.focusOn(earth.cfg, earth.group);
  assert.equal(rig.getFocusTarget().cfg.name, "地球");
  step(31);   // 0.5s + 1 帧
  const halfFov = 48 * Math.PI / 360;
  const framed = Math.max(earth.cfg.radius / (0.2 * Math.tan(halfFov)), earth.cfg.radius * 2.2);
  assert.ok(close(orbit.dist, framed, framed * 1e-6), `dist=${orbit.dist} framed=${framed}`);
  step(2);
  assert.ok(orbit.target.distanceTo(earth.group.position) < 1e-12);
});

test("聚焦后滚轮拉远超过 60 倍半径自动取消选中", () => {
  const { rig, orbit, planets, step, wheel } = makeRig();
  const earth = planets.find(p => p.cfg.name === "地球");
  rig.focusOn(earth.cfg, earth.group);
  step(31);
  for (let i = 0; i < 4; i++) wheel(300);
  assert.equal(rig.getFocusTarget(), null);
  step(60);
  assert.ok(orbit.dist > earth.cfg.radius * 60);
});

test("全景复位：清空聚焦/平移，距离回到视口自适应", () => {
  const { rig, orbit, planets, step, wheel } = makeRig();
  const earth = planets.find(p => p.cfg.name === "地球");
  rig.focusOn(earth.cfg, earth.group);
  step(31);
  wheel(300); wheel(300);
  rig.resetView();
  assert.equal(rig.getFocusTarget(), null);
  assert.deepEqual(orbit.panOffset.toArray(), [0, 0, 0]);
  step(300);
  assert.ok(close(orbit.dist, rig.fitDistance(), rig.fitDistance() * 0.02));
});

test("WASD：表单焦点不劫持；自由视角平移；聚焦态环绕；过渡中忽略", () => {
  const { rig, orbit, planets, step, key } = makeRig();
  const earth = planets.find(p => p.cfg.name === "地球");

  // 焦点在按钮上：按键被守卫吞掉（不 preventDefault），视角不动
  const guarded = key("KeyW", "keydown", true);
  assert.ok(!guarded.pd);
  step(10);
  assert.deepEqual(orbit.panOffset.toArray(), [0, 0, 0]);

  // 自由视角：平移偏移累积；keyup 后停止
  key("KeyW", "keydown", false);
  step(10);
  assert.ok(orbit.panOffset.length() > 0);
  key("KeyW", "keyup", false);
  const stopped = orbit.panOffset.clone();
  step(10);
  assert.ok(orbit.panOffset.equals(stopped));

  // 聚焦态：只环绕（改 tPhi），不平移
  rig.resetView(); step(300);
  rig.focusOn(earth.cfg, earth.group);
  step(31);
  const phi0 = orbit.tPhi;
  key("KeyW", "keydown", false);
  step(10);
  key("KeyW", "keyup", false);
  assert.deepEqual(orbit.panOffset.toArray(), [0, 0, 0]);
  assert.ok(orbit.tPhi !== phi0);

  // 聚焦过渡中：按键完全忽略
  rig.focusOn(earth.cfg, earth.group);
  const phi1 = orbit.tPhi;
  key("KeyW", "keydown", false);
  step(5);   // 仍在 0.5s 过渡内
  key("KeyW", "keyup", false);
  assert.equal(orbit.tPhi, phi1);
  assert.deepEqual(orbit.panOffset.toArray(), [0, 0, 0]);
});

test("仰角上限逐帧按本帧距离重夹：近景下方视角拉远后收回黄道面上方", () => {
  const { orbit, step } = makeRig();
  orbit.dist = orbit.tDist = 1;
  orbit.tPhi = 1.75;   // 近景允许的黄道面下方
  step(1);
  assert.ok(orbit.tPhi <= maxPhiForDistance(1) + 1e-12);
  assert.ok(orbit.tPhi > Math.PI / 2);

  orbit.tDist = 400;
  step(300);
  assert.ok(orbit.dist > 10);
  assert.ok(close(orbit.tPhi, MAX_PHI, 1e-9));
  assert.ok(orbit.tPhi < Math.PI / 2);
});