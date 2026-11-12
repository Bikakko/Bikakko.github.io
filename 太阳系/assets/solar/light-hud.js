/* ============================================================
   太阳系 · Solar · 光速 HUD

   天体始终使用 hud 的 simTime。光行时默认由同一历元派生，拖动光速标尺时
   只记录光行时偏移，不改写 simTime，因此不会扰动行星位置或民用时间。
   标尺拖动也不改变播放状态；面板的开/关统一由左下角的开关按钮负责。
   ============================================================ */
import {
  qLight, qLightT, qLightStatic,
} from "./config.js";
import {
  lightArrivals, lightSecondsSince, emissionPlusSeconds,
  formatClock, formatShort, formatLightTime,
  toLogAxis, fromLogAxis, LOG_AXIS_MAX, LIGHT_TICKS,
} from "./light-math.js";

export function createLightHud({ hud, lightView }) {
  const root = document.getElementById("light");
  const toggleBtn = document.getElementById("lightToggle");
  const clockEl = document.getElementById("lightClock");
  const subEl = document.getElementById("lightSub");
  const rateEl = document.getElementById("lightRate");
  const barEl = document.getElementById("lightBar");
  const fillEl = document.getElementById("lightFill");
  const cursorEl = document.getElementById("lightCursor");
  const ticksEl = document.getElementById("lightTicks");
  const planetsEl = document.getElementById("lightPlanets");
  const listEl = document.getElementById("lightList");
  const replayBtn = document.getElementById("lightReplay");
  const beadStepEl = document.getElementById("lightBeadStep");

  let on = false;
  let emissionT = hud.getSimTime();   // 光脉冲发射历元（天）
  let arrivals = [];
  let endSeconds = LOG_AXIS_MAX;
  let listRecs = [];
  let markerRecs = [];
  let scrubbing = false;
  let scrubOffsetSec = 0;           // 仅供光球预览，绝不写回太阳系 simTime
  // 脏检查缓存：内容没变就不写 DOM（对照 labels.js 的模式）。
  // 1:1 真实时间下绝大多数帧这些值都不变，避免无谓的样式计算。
  let lastClock = "", lastPct = "", lastSub = "", lastRate = "", lastDesc = "", lastStep = "";

  const getLightSec = () => Math.max(0,
    lightSecondsSince(hud.getSimTime(), emissionT) + scrubOffsetSec);

  // 对数刻度：位置固定，不随时间变化
  for (const t of LIGHT_TICKS) {
    const el = document.createElement("div");
    el.className = "light-tick";
    el.style.left = (toLogAxis(t.sec) * 100).toFixed(2) + "%";
    el.textContent = t.label;
    ticksEl.appendChild(el);
  }

  // 只建 DOM 结构；数值由 refreshArrivals 每帧按当前 simTime 刷新
  function buildArrivals() {
    arrivals = lightArrivals(hud.getSimTime());
    listEl.replaceChildren();
    listRecs = arrivals.map((a) => {
      const el = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = a.name;
      const val = document.createElement("span");
      val.className = "v";
      el.append(name, val);
      listEl.appendChild(el);
      return { el, val, seconds: a.seconds, text: "", done: false };
    });

    planetsEl.replaceChildren();
    markerRecs = arrivals.map((a) => {
      const el = document.createElement("div");
      el.className = "light-pm";
      planetsEl.appendChild(el);
      return { el, seconds: a.seconds, left: "", title: "", done: false };
    });
    lastDesc = "";
  }

  // 标尺刻度与 light-view 光线终点都按「当前 simTime 的行星距离」计算，
  // 两者始终一致：高倍率下行星光程内的位移不会再让「已越过 n/8」与
  // 视觉脱节。每帧只算 8 次开普勒定位；DOM 仅在值变化时重写。
  function refreshArrivals(simTime) {
    arrivals = lightArrivals(simTime);
    endSeconds = Math.max(...arrivals.map((a) => a.seconds)) * 1.02;
    const last = arrivals.reduce((m, a) => (a.seconds > m.seconds ? a : m), arrivals[0]);
    const desc = `太阳 → ${last.name} ${formatLightTime(last.seconds)}`;
    if (desc !== lastDesc) lastDesc = desc;

    for (let i = 0; i < arrivals.length; i++) {
      const a = arrivals[i];
      const lr = listRecs[i];
      lr.seconds = a.seconds;
      const text = ` ${formatShort(a.seconds)}`;
      if (text !== lr.text) { lr.text = text; lr.val.textContent = text; }

      const mr = markerRecs[i];
      mr.seconds = a.seconds;
      const left = (toLogAxis(a.seconds) * 100).toFixed(2) + "%";
      if (left !== mr.left) { mr.left = left; mr.el.style.left = left; }
      const title = `${a.name} · ${formatLightTime(a.seconds)}`;
      if (title !== mr.title) { mr.title = title; mr.el.title = title; }
    }
    return desc;
  }

  function render() {
    if (!on) return;
    const simTime = hud.getSimTime();
    const sec = getLightSec();
    const desc = refreshArrivals(simTime);

    const clock = formatClock(sec);
    if (clock !== lastClock) { lastClock = clock; clockEl.textContent = clock; }
    const pct = (toLogAxis(sec) * 100).toFixed(2) + "%";
    if (pct !== lastPct) {
      lastPct = pct;
      cursorEl.style.left = pct;
      fillEl.style.width = pct;
    }

    let passed = 0;
    for (const a of arrivals) if (a.seconds <= sec) passed++;
    const sub = `${desc} · 已越过 ${passed}/8`;
    if (sub !== lastSub) { lastSub = sub; subEl.textContent = sub; }
    for (const r of listRecs) {
      const done = r.seconds <= sec;
      if (done !== r.done) { r.done = done; r.el.classList.toggle("done", done); }
    }
    for (const r of markerRecs) {
      const done = r.seconds <= sec;
      if (done !== r.done) { r.done = done; r.el.classList.toggle("done", done); }
    }

    const rate = hud.rateLabel();
    if (rateEl && rate !== lastRate) { lastRate = rate; rateEl.textContent = rate; }

    // 亮点的抽稀步长由本帧视距决定（lightView.update 先于 render 执行）
    const step = String(lightView.getBeadStep());
    if (beadStepEl && step !== lastStep) { lastStep = step; beadStepEl.textContent = step; }
  }

  function tick() {
    if (!on) return;
    // 脉冲间隔是固定光秒（物理量），与倍率无关
    lightView.update(getLightSec(), hud.getSimTime());
    render();
  }

  function setOn(next) {
    on = next;
    root.classList.toggle("on", on);
    toggleBtn.classList.toggle("on", on);
    toggleBtn.textContent = on ? "光速 ▾" : "光速 ▸";
    lightView.setVisible(on);
    if (on) {
      emissionT = hud.getSimTime();
      scrubOffsetSec = 0;
      buildArrivals();
      render();
    }
  }

  function toggle() {
    const next = !on;
    // 打开即开始；倍率保持用户当前选择（默认 1:1 真实时间），不再自动切换
    if (next && !qLightStatic) hud.setPaused(false);
    setOn(next);
  }
  function togglePlay() {
    if (!on) return;
    hud.togglePaused();
    render();
  }
  function replay() {
    if (!on) return;
    // 重播仍回到发射历元；清除此前仅用于光球预览的拖动偏移
    scrubOffsetSec = 0;
    hud.setSimTime(emissionT);
    hud.setPaused(false);
    render();
  }
  function scrubTo(sec) {
    // 只定位光球的光行时，不改写 simTime，也不改变太阳系的播放状态
    const target = Math.min(endSeconds, Math.max(0, sec));
    scrubOffsetSec = target - lightSecondsSince(hud.getSimTime(), emissionT);
    render();
  }
  function applyScrub(clientX) {
    const rect = barEl.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    scrubTo(fromLogAxis(t));
  }

  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  replayBtn.addEventListener("click", replay);

  barEl.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    try { barEl.setPointerCapture(e.pointerId); } catch (_) {}
    applyScrub(e.clientX);
    e.preventDefault();
  });
  barEl.addEventListener("pointermove", (e) => { if (scrubbing) applyScrub(e.clientX); });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    try {
      if (e.pointerId !== undefined && barEl.hasPointerCapture(e.pointerId)) {
        barEl.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  };
  barEl.addEventListener("pointerup", endScrub);
  barEl.addEventListener("pointercancel", endScrub);

  // L 开关、R 重播、P 播放/暂停。空格统一交给 hud（暂停同一个 simTime）。
  addEventListener("keydown", (e) => {
    if (e.target && e.target.closest
        && e.target.closest("button, a, input, textarea, select, .lbl")) return;
    if (e.code === "KeyL") { toggle(); return; }
    if (!on) return;
    if (e.code === "KeyR") replay();
    else if (e.code === "KeyP") togglePlay();
  });

  // 初始状态：?light=1 打开；?lt= / ?lstatic=1 时把统一时间定格在指定帧
  if (qLight) {
    setOn(true);
    if (qLightT !== null) {
      hud.setSimTime(emissionPlusSeconds(emissionT, qLightT));
      hud.setPaused(true);
    } else if (qLightStatic) {
      hud.setPaused(true);
    } else {
      hud.setPaused(false);
    }
    render();
  } else {
    lightView.setVisible(false);
  }

  return { tick, isOn: () => on, getLightSec, close: () => setOn(false) };
}
