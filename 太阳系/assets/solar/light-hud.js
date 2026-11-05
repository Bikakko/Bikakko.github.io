/* ============================================================
   太阳系 · Solar · 光速 HUD 与双时钟
   - simTime 由 hud 管理，光速模式期间冻结：4 小时内行星最多走 0.05°，
     对到达判定的影响远小于视觉噪声（不假装做了相对论拦截）
   - lightSec 是独立的「光行时」时钟，只按回放倍率推进
   ============================================================ */
import {
  qLight, qLightRate, qLightT, qLightMode, qLightStatic,
  LIGHT_RATE_DEFAULT, LIGHT_RATE_REALTIME,
} from "./config.js";
import {
  lightArrivals, formatClock, formatShort, formatLightTime,
  toLogAxis, fromLogAxis, advanceLightTime, LOG_AXIS_MAX, LIGHT_TICKS,
} from "./light-math.js";

export function createLightHud({ hud, lightView }) {
  const root = document.getElementById("light");
  const toggleBtn = document.getElementById("lightToggle");
  const clockEl = document.getElementById("lightClock");
  const subEl = document.getElementById("lightSub");
  const barEl = document.getElementById("lightBar");
  const fillEl = document.getElementById("lightFill");
  const cursorEl = document.getElementById("lightCursor");
  const ticksEl = document.getElementById("lightTicks");
  const planetsEl = document.getElementById("lightPlanets");
  const listEl = document.getElementById("lightList");
  const playBtn = document.getElementById("lightPlay");
  const replayBtn = document.getElementById("lightReplay");
  const modeBtn = document.getElementById("lightMode");
  const closeBtn = document.getElementById("lightClose");
  const rateBtns = Array.from(root.querySelectorAll("[data-lrate]"));
  const subHeader = document.querySelector("#hud .sub");
  const originalSub = subHeader ? subHeader.textContent : "";

  let on = false;
  let lightSec = qLightT ?? 0;
  let playing = false;
  let rate = qLightRate || LIGHT_RATE_DEFAULT;
  let mode = qLightMode;
  let arrivals = [];
  let endSeconds = LOG_AXIS_MAX;
  let desc = "";
  let listRecs = [];
  let markerRecs = [];
  let scrubbing = false;

  // 对数刻度：位置固定，不随时间变化
  for (const t of LIGHT_TICKS) {
    const el = document.createElement("div");
    el.className = "light-tick";
    el.style.left = (toLogAxis(t.sec) * 100).toFixed(2) + "%";
    el.textContent = t.label;
    ticksEl.appendChild(el);
  }

  function buildArrivals() {
    arrivals = lightArrivals(hud.getSimTime());
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
    clockEl.textContent = formatClock(lightSec);
    const pct = (toLogAxis(lightSec) * 100).toFixed(2) + "%";
    cursorEl.style.left = pct;
    fillEl.style.width = pct;

    let passed = 0;
    for (const a of arrivals) if (a.seconds <= lightSec) passed++;
    const insideHint = lightView.isInside() ? " · 光波已越过观察点" : "";
    subEl.textContent = `${desc} · 已越过 ${passed}/8${insideHint}`;
    for (const r of listRecs) r.el.classList.toggle("done", r.seconds <= lightSec);
    for (const r of markerRecs) r.el.classList.toggle("done", r.seconds <= lightSec);

    playBtn.textContent = playing ? "暂停" : "播放";
    playBtn.classList.toggle("on", playing);
    modeBtn.textContent = mode === "log" ? "对数回放" : "线性回放";
    modeBtn.classList.toggle("on", mode === "log");
    for (const b of rateBtns) b.classList.toggle("on", parseFloat(b.dataset.lrate) === rate);

    const rateLabel = rate === LIGHT_RATE_REALTIME ? "真实时间 1:1" : `${rate}×`;
    if (subHeader) subHeader.textContent = `${originalSub} · 光速回放 ${rateLabel}（c 恒定）`;
  }

  function tick(dt) {
    if (!on) return;
    if (playing) {
      const next = Math.min(endSeconds, advanceLightTime(lightSec, dt, rate, mode));
      lightSec = next;
      if (lightSec >= endSeconds) playing = false;
    }
    lightView.update(lightSec, hud.getSimTime());
    render();
  }

  function setOn(next) {
    on = next;
    document.documentElement.classList.toggle("light-on", on);
    root.classList.toggle("on", on);
    toggleBtn.classList.toggle("on", on);
    toggleBtn.textContent = on ? "光速 ▾" : "光速 ▸";
    lightView.setVisible(on);
    hud.freeze(on);
    hud.setLightModeHook(() => on);
    if (on) {
      buildArrivals();
      render();
    } else if (subHeader) {
      subHeader.textContent = originalSub;
    }
  }

  function toggle() {
    const next = !on;
    // 运行时打开光速面板即开始回放；?static/ ?lstatic 截图模式保持定格
    if (next && !qLightStatic) {
      playing = true;
      if (lightSec >= endSeconds) lightSec = 0;
    }
    setOn(next);
  }
  function togglePlay() {
    if (!on) return;
    playing = !playing;
    if (playing && lightSec >= endSeconds) lightSec = 0;
    render();
  }
  function replay() {
    if (!on) return;
    lightSec = 0;
    playing = true;
    render();
  }
  function scrubTo(sec) {
    lightSec = Math.min(endSeconds, Math.max(0, sec));
    playing = false;   // 拖动时间轴即定格
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
  modeBtn.addEventListener("click", () => {
    mode = mode === "log" ? "linear" : "log";
    render();
  });
  for (const b of rateBtns) {
    b.addEventListener("click", () => { rate = parseFloat(b.dataset.lrate); render(); });
  }

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

  // L 开关（关态也生效）；光速模式下 Space / P 播放、R 重播。
  // hud 的空格处理器由 setLightModeHook 让位，避免同时暂停两个时钟。
  addEventListener("keydown", (e) => {
    if (e.target && e.target.closest
        && e.target.closest("button, a, input, textarea, select, .lbl")) return;
    if (e.code === "KeyL") { toggle(); return; }
    if (!on) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.code === "KeyR") replay();
    else if (e.code === "KeyP") togglePlay();
  });

  // 初始状态：?light=1 打开；lt= 或 static 时冻结在指定帧，便于截图复现
  hud.setLightModeHook(() => on);
  if (qLight) {
    playing = qLightT === null && !qLightStatic;
    setOn(true);
  } else {
    lightView.setVisible(false);
  }

  return { tick, isOn: () => on, getLightSec: () => lightSec };
}
