/* ============================================================
   太阳系 · Solar · 光速 HUD（统一时间）

   没有第二套时钟：光行时 = (hud.getSimTime() - emissionT) · 86400。
   播放/暂停/重播/标尺拖动全部作用于 hud 的同一个 simTime，因此光波前
   与天体运行永远同步，面板上只显示一个时间流速。
   ============================================================ */
import {
  qLight, qLightT, qLightStatic, qRate, TIME_RATE_LIGHT,
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
  const playBtn = document.getElementById("lightPlay");
  const replayBtn = document.getElementById("lightReplay");
  const closeBtn = document.getElementById("lightClose");
  const subHeader = document.querySelector("#hud .sub");
  const originalSub = subHeader ? subHeader.textContent : "";

  let on = false;
  let emissionT = hud.getSimTime();   // 光脉冲发射历元（天）
  let arrivals = [];
  let endSeconds = LOG_AXIS_MAX;
  let desc = "";
  let listRecs = [];
  let markerRecs = [];
  let scrubbing = false;

  const getLightSec = () => lightSecondsSince(hud.getSimTime(), emissionT);

  // 对数刻度：位置固定，不随时间变化
  for (const t of LIGHT_TICKS) {
    const el = document.createElement("div");
    el.className = "light-tick";
    el.style.left = (toLogAxis(t.sec) * 100).toFixed(2) + "%";
    el.textContent = t.label;
    ticksEl.appendChild(el);
  }

  function buildArrivals() {
    // 光在 emissionT 发出，到达时刻由发射时的行星位置决定
    arrivals = lightArrivals(emissionT);
    endSeconds = Math.max(...arrivals.map((a) => a.seconds)) * 1.02;
    const last = arrivals.reduce((m, a) => (a.seconds > m.seconds ? a : m), arrivals[0]);
    desc = `太阳 → ${last.name} ${formatLightTime(last.seconds)}`;

    listEl.replaceChildren();
    listRecs = arrivals.map((a) => {
      const el = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = a.name;
      const val = document.createElement("span");
      val.className = "v";
      val.textContent = ` ${formatShort(a.seconds)}`;
      el.append(name, val);
      listEl.appendChild(el);
      return { el, seconds: a.seconds };
    });

    planetsEl.replaceChildren();
    markerRecs = arrivals.map((a) => {
      const el = document.createElement("div");
      el.className = "light-pm";
      el.style.left = (toLogAxis(a.seconds) * 100).toFixed(2) + "%";
      el.title = `${a.name} · ${formatLightTime(a.seconds)}`;
      planetsEl.appendChild(el);
      return { el, seconds: a.seconds };
    });
  }

  function render() {
    if (!on) return;
    const sec = getLightSec();
    clockEl.textContent = formatClock(sec);
    const pct = (toLogAxis(sec) * 100).toFixed(2) + "%";
    cursorEl.style.left = pct;
    fillEl.style.width = pct;

    let passed = 0;
    for (const a of arrivals) if (a.seconds <= sec) passed++;
    const insideHint = lightView.isInside() ? " · 光球已包裹观察点" : "";
    subEl.textContent = `${desc} · 已越过 ${passed}/8${insideHint}`;
    for (const r of listRecs) r.el.classList.toggle("done", r.seconds <= sec);
    for (const r of markerRecs) r.el.classList.toggle("done", r.seconds <= sec);

    const paused = hud.isPaused();
    playBtn.textContent = paused ? "继续" : "暂停";
    playBtn.classList.toggle("on", !paused);
    if (rateEl) rateEl.textContent = hud.rateLabel();
    if (subHeader) subHeader.textContent = `${originalSub} · 统一时间 ${hud.rateLabel()}`;
  }

  function tick() {
    if (!on) return;
    lightView.update(getLightSec(), hud.getSimTime());
    render();
  }

  function setOn(next) {
    on = next;
    document.documentElement.classList.toggle("light-on", on);
    root.classList.toggle("on", on);
    toggleBtn.classList.toggle("on", on);
    toggleBtn.textContent = on ? "光速 ▾" : "光速 ▸";
    lightView.setVisible(on);
    if (on) {
      emissionT = hud.getSimTime();
      buildArrivals();
      render();
    } else if (subHeader) {
      subHeader.textContent = originalSub;
    }
  }

  function toggle() {
    const next = !on;
    if (next) {
      // 默认真实时间下打开光速模式，切到能看清光波前的统一倍率
      if (qRate === null && hud.getRate() === 1) hud.setRate(TIME_RATE_LIGHT);
      if (!qLightStatic) hud.setPaused(false);
    }
    setOn(next);
  }
  function togglePlay() {
    if (!on) return;
    hud.togglePaused();
    render();
  }
  function replay() {
    if (!on) return;
    // 回到发射时刻：光波前归零，行星也回到同一历元（时间统一）
    hud.setSimTime(emissionT);
    hud.setPaused(false);
    render();
  }
  function scrubTo(sec) {
    hud.setSimTime(emissionPlusSeconds(emissionT, Math.min(endSeconds, Math.max(0, sec))));
    hud.setPaused(true);   // 拖动时间轴即定格
    render();
  }
  function applyScrub(clientX) {
    const rect = barEl.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    scrubTo(fromLogAxis(t));
  }

  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  closeBtn.addEventListener("click", () => setOn(false));
  playBtn.addEventListener("click", togglePlay);
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

  return { tick, isOn: () => on, getLightSec };
}
