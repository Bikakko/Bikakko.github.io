/* ============================================================
   光速面板的两行读数：「播放速度」与「每段 N 光秒」

   面板是纯 DOM，rAF 在隐藏面板里会停摆，浏览器冒烟无法逐帧驱动。
   这里用最小 DOM stub 手动调 tick()，让读数与真实 light-view 的
   抽稀步长、hud 的倍率标签直接对账。
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("位置是时间抽屉里默认收起的二级开关；把手沿用操作说明样式略放大，两个抽屉互不干涉", () => {
  const html = readFileSync(new URL("../solar.html", import.meta.url), "utf8");
  assert.ok(/<div class="right" id="right">\s*<div class="control-panel" id="controlPanel">\s*<button id="timeToggle"/.test(html),
    "时间把手应直接位于统一控制面板顶部");

  const tpAt = html.indexOf('id="tp"');
  const stateAt = html.indexOf('id="state"');
  assert.ok(tpAt > 0 && stateAt > tpAt, "位置区应嵌在时间抽屉内容里");
  assert.ok(stateAt < html.indexOf('id="infoWrap"'), "位置区仍在独立聚焦信息卡之前");
  assert.match(html, /<div class="state" id="state">/, "位置区默认不带 open（收起）");
  assert.match(html, /id="stateToggle"[^>]*aria-expanded="false"/, "二级开关默认收起");
  assert.match(html, /id="stateCaret">▸</, "收起态箭头朝右");
  assert.match(html, /id="stateTitle">位置</, "二级开关标题标明位置");

  // 时间 / 光速两个一级把手共用同一类，且沿用「操作说明」的按钮样式、略大一号
  assert.match(html, /<button id="timeToggle" class="drawer-toggle"/);
  assert.match(html, /<button id="lightToggle" class="drawer-toggle"/);
  const tipCss = html.match(/^[ \t]*\.tip-toggle\s*\{([^}]*)\}/m)?.[1] || "";
  const handleCss = html.match(/^[ \t]*\.drawer-toggle\s*\{([^}]*)\}/m)?.[1] || "";
  const px = (css, prop) => Number(css.match(new RegExp(prop + ":\\s*([\\d.]+)px"))?.[1] ?? NaN);
  assert.ok(px(handleCss, "font-size") > px(tipCss, "font-size"), "把手字号应比操作说明略大");
  assert.ok(px(handleCss, "padding") > px(tipCss, "padding"), "把手内边距应比操作说明略大");
  for (const [name, re] of [["细边框", /border:\s*1px solid/], ["圆角", /border-radius:\s*6px/],
                            ["字色", /color:\s*#8e9cbe/],
                            ["深色底", /background:\s*rgba\(10, 16, 28, 0\.72\)/]]) {
    assert.match(handleCss, re, `把手沿用操作说明${name}`);
  }
  assert.match(html, /\.control-panel,\s*\.light-panel\s*\{/, "两个抽屉共用同一套排布容器");
  assert.match(html, /<div class="light-panel" id="lightPanel">\s*<div class="light" id="light">/,
    "光速内容在上、把手在下");

  // 两个抽屉可同时开 / 关：源码里不能再有互相关闭对方的互斥回调
  for (const f of ["../assets/solar/main.js", "../assets/solar/time-panel.js",
                   "../assets/solar/light-hud.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/onOpen/.test(src), `${f} 不应再有关闭对方的互斥回调`);
  }
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