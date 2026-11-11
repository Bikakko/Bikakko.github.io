/* ============================================================
   光速面板的两行读数：「播放速度」与「每段 N 光秒」

   面板是纯 DOM，rAF 在隐藏面板里会停摆，浏览器冒烟无法逐帧驱动。
   这里用最小 DOM stub 手动调 tick()，让读数与真实 light-view 的
   抽稀步长、hud 的倍率标签直接对账。
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLightHud } from "../assets/solar/light-hud.js";
import { createLightView } from "../assets/solar/light-view.js";
import { PLANETS } from "../assets/solar/bodies.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

globalThis.window = { innerHeight: 1080, devicePixelRatio: 1 };

function el(id) {
  const kids = [], handlers = {};
  return {
    id, textContent: "", className: "", title: "", style: {}, handlers, kids,
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(c) { kids.push(c); return c; },
    append(...c) { kids.push(...c); },
    replaceChildren() { kids.length = 0; },
    addEventListener(t, fn) { (handlers[t] ||= []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, width: 300 }),
  };
}

const IDS = [
  "light", "lightToggle", "lightClock", "lightSub", "lightRate", "lightBar",
  "lightFill", "lightCursor", "lightTicks", "lightPlanets", "lightList",
  "lightReplay", "lightBeadStep",
];

function setup() {
  const nodes = new Map(IDS.map(id => [id, el(id)]));
  globalThis.document = {
    getElementById: id => nodes.get(id) ?? null,
    createElement: () => el(""),
  };
  globalThis.addEventListener = () => {};

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 6000);
  camera.position.set(0, 120, 400);
  const lightView = createLightView(scene, camera);

  let simTime = 0, rate = "真实时间 1:1";
  const hud = {
    getSimTime: () => simTime,
    setSimTime: (v) => { simTime = v; },
    rateLabel: () => rate,
    setPaused() {}, togglePaused() {},
  };
  const lightHud = createLightHud({ hud, lightView });
  nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });

  return {
    lightHud, lightView, camera, nodes,
    setRate: (s) => { rate = s; },
    read: () => ({
      rate: nodes.get("lightRate").textContent,
      step: nodes.get("lightBeadStep").textContent,
    }),
  };
}

test("两行读数取自 hud 倍率与 lightView 步长，任何视距下都是正整数而非 NaN", () => {
  const { lightHud, lightView, camera, setRate, read } = setup();
  lightHud.tick();
  assert.equal(read().rate, "真实时间 1:1");
  assert.ok(/^[1-9]\d*$/.test(read().step), `步长应是正整数，实得 ${read().step}`);
  assert.ok(Number(read().step) > 1, "全景视距下应已抽稀");
  assert.equal(Number(read().step), lightView.getBeadStep());

  setRate("1 天/秒");
  lightHud.tick();
  assert.equal(read().rate, "1 天/秒");

  // 从海王星外侧一路贴到表面：步长有限、单调不增，最终回到逐颗 1 光秒
  const neptune = PLANETS[PLANETS.length - 1];
  const p = orbitalPosition(neptune, 0, new THREE.Vector3());
  let prev = Infinity;
  for (const mult of [10000, 3000, 1000, 300, 100]) {
    const R = neptune.radius * mult;
    camera.position.set(p.x + R, p.y, p.z);
    lightHud.tick();
    const step = Number(read().step);
    assert.ok(Number.isInteger(step) && step >= 1, `mult=${mult} 步长 ${read().step}`);
    assert.equal(step, lightView.getBeadStep());
    assert.ok(step <= prev, `视距变近步长反而变大：${prev} → ${step}`);
    prev = step;
  }
  assert.equal(read().step, "1", "贴到行星附近时应回到逐颗 1 光秒");
});

test("读数只在值变化时重写 DOM（脏检查）", () => {
  const { lightHud, nodes } = setup();
  lightHud.tick();
  let stepWrites = 0, rateWrites = 0;
  for (const [id, bump] of [["lightBeadStep", () => stepWrites++], ["lightRate", () => rateWrites++]]) {
    const node = nodes.get(id);
    let cur = node.textContent;
    Object.defineProperty(node, "textContent", {
      get: () => cur,
      set: (v) => { cur = v; bump(); },
      configurable: true,
    });
  }
  lightHud.tick();
  lightHud.tick();
  assert.equal(stepWrites, 0);
  assert.equal(rateWrites, 0);
});