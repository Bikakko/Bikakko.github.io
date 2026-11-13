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
  "lightReset", "lightBeadStep",
];

function setup({ autoOpen = true, focusCfg = PLANETS[2] } = {}) {
  const nodes = new Map(IDS.map(id => [id, el(id)]));
  globalThis.document = {
    getElementById: id => nodes.get(id) ?? null,
    createElement: () => el(""),
  };
  const globalHandlers = {};
  globalThis.addEventListener = (type, fn) => { (globalHandlers[type] ||= []).push(fn); };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 6000);
  camera.position.set(0, 120, 400);
  const lightView = createLightView(scene, camera);
  const updateLightView = lightView.update.bind(lightView);
  let lightViewUpdates = 0;
  lightView.update = (...args) => {
    lightViewUpdates++;
    return updateLightView(...args);
  };

  let simTime = 0, rate = "真实时间 1:1", setSimTimeCalls = 0;
  const hud = {
    getSimTime: () => simTime,
    setSimTime: (v) => { simTime = v; setSimTimeCalls++; },
    rateLabel: () => rate,
    setPaused() {}, togglePaused() {},
  };
  let focusTarget = focusCfg ? { cfg: focusCfg } : null;
  const lightHud = createLightHud({ hud, lightView, getFocusTarget: () => focusTarget });
  if (autoOpen) nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });

  return {
    lightHud, lightView, camera, nodes,
    group: scene.children.find(o => o.isGroup),
    beads: scene.children.find(o => o.isGroup).children.filter(o => o.isPoints),
    setFocus: (cfg) => { focusTarget = cfg ? { cfg } : null; },
    setRate: (s) => { rate = s; },
    getSimTime: () => simTime,
    advanceSimTime: (days) => { simTime += days; },
    getSetSimTimeCalls: () => setSimTimeCalls,
    getLightViewUpdates: () => lightViewUpdates,
    pressKey: (code) => {
      for (const fn of globalHandlers.keydown || []) fn({ code, target: null });
    },
    read: () => ({
      rate: nodes.get("lightRate").textContent,
      step: nodes.get("lightBeadStep").textContent,
    }),
  };
}

test("两行读数取自 hud 倍率与 lightView 步长，任何视距下都是正整数而非 NaN", () => {
  const { lightHud, lightView, camera, setRate, setFocus, read } = setup();
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
  setFocus(neptune);
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

test("首次打开前不运行也不累计光速进度，首次打开从零开始", () => {
  const {
    lightHud, nodes, advanceSimTime, getLightViewUpdates, pressKey,
  } = setup({ autoOpen: false });

  advanceSimTime(300 / 86400);
  lightHud.tick();
  lightHud.tick();
  pressKey("KeyR");
  assert.equal(getLightViewUpdates(), 0, "首次打开前不应更新光球、光线或亮点");
  assert.equal(lightHud.getLightSec(), 0, "首次打开前不应在后台累计光行时");

  nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });
  assert.equal(lightHud.getLightSec(), 0, "首次打开应从零发射，而非补算页面加载后的时间");
  lightHud.tick();
  assert.equal(getLightViewUpdates(), 1);
  advanceSimTime(1 / 86400);
  lightHud.tick();
  assert.ok(Math.abs(lightHud.getLightSec() - 1) < 1e-8);
});

test("光秒亮点只在面板打开且聚焦行星时显示当前目标", () => {
  const { lightHud, nodes, group, beads, setFocus } = setup({ focusCfg: null });
  lightHud.tick();
  assert.equal(group.visible, true);
  assert.ok(beads.every(b => !b.visible), "没有聚焦行星时不显示任何光秒亮点");

  const earth = PLANETS[2], mars = PLANETS[3];
  setFocus(earth);
  lightHud.tick();
  assert.equal(beads[2].visible, true);
  assert.equal(beads.filter(b => b.visible).length, 1, "只显示聚焦行星的亮点");

  setFocus(mars);
  lightHud.tick();
  assert.equal(beads[2].visible, false);
  assert.equal(beads[3].visible, true);

  nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });
  assert.equal(group.visible, false, "关闭光速面板后整个视觉层（含亮点）都隐藏");
  nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });
  lightHud.tick();
  assert.equal(group.visible, true);
  assert.equal(beads[3].visible, true, "重开面板后仍按当前聚焦目标显示");

  setFocus(null);
  lightHud.tick();
  assert.ok(beads.every(b => !b.visible), "取消聚焦后立即隐藏亮点");
});

test("拖动光速标尺只调整光行时，不改写太阳系 simTime，松开后继续播放", () => {
  const {
    lightHud, nodes, getSimTime, advanceSimTime, getSetSimTimeCalls,
  } = setup();
  lightHud.tick();
  const before = getSimTime();
  const bar = nodes.get("lightBar");
  const pointer = { pointerId: 1, clientX: 150, preventDefault() {} };

  bar.handlers.pointerdown[0](pointer);
  const draggedSec = lightHud.getLightSec();
  assert.ok(draggedSec > 600, "拖到标尺中部应产生有效光行时");
  assert.equal(getSimTime(), before, "pointerdown 不应移动太阳系历元");

  bar.handlers.pointermove[0]({ ...pointer, clientX: 225 });
  const movedSec = lightHud.getLightSec();
  assert.ok(movedSec > draggedSec, "继续拖动应推进光球进度");
  assert.equal(getSimTime(), before, "pointermove 不应移动太阳系历元");
  assert.equal(getSetSimTimeCalls(), 0, "整个拖动过程不应调用 setSimTime");

  advanceSimTime(1 / 86400);
  lightHud.tick();
  assert.ok(Math.abs(lightHud.getLightSec() - movedSec - 1) < 1e-8,
    "拖动后的光球应随原模拟时间继续推进，而不是跳回或冻结");
  bar.handlers.pointerup[0](pointer);
});

test("面板关闭再打开保留进度，只有重置按钮或 R 键将光球归零", () => {
  const {
    lightHud, nodes, getSimTime, advanceSimTime, getSetSimTimeCalls, pressKey,
  } = setup();
  const toggle = () => nodes.get("lightToggle").handlers.click[0]({ stopPropagation() {} });

  advanceSimTime(120 / 86400);
  lightHud.tick();
  assert.ok(Math.abs(lightHud.getLightSec() - 120) < 1e-8);
  toggle();
  advanceSimTime(30 / 86400);
  toggle();
  assert.ok(Math.abs(lightHud.getLightSec() - 150) < 1e-8,
    "重新打开应接着隐藏期间的进度，不应重新发射");

  const beforeReset = getSimTime();
  const timeWrites = getSetSimTimeCalls();
  nodes.get("lightReset").handlers.click[0]({});
  assert.equal(lightHud.getLightSec(), 0, "重置按钮应让光球归零");
  assert.equal(getSimTime(), beforeReset, "重置不应回退太阳系历元");
  assert.equal(getSetSimTimeCalls(), timeWrites);

  advanceSimTime(20 / 86400);
  lightHud.tick();
  const beforeKeyReset = getSimTime();
  pressKey("KeyR");
  assert.equal(lightHud.getLightSec(), 0, "R 键应绑定同一个重置操作");
  assert.equal(getSimTime(), beforeKeyReset);
  assert.equal(getSetSimTimeCalls(), timeWrites);
});

test("光球包裹观察点时不显示额外提示", () => {
  const { lightHud, lightView, camera, nodes } = setup();
  camera.position.set(0, 12, 40);
  const bar = nodes.get("lightBar");
  bar.handlers.pointerdown[0]({ pointerId: 1, clientX: 225, preventDefault() {} });
  lightHud.tick();
  assert.equal(lightView.isInside(), true, "测试场景应确实处于光球内部");
  assert.ok(!nodes.get("lightSub").textContent.includes("光球已包裹观察点"));
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