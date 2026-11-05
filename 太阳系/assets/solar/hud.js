/* ============================================================
   太阳系 · Solar · HUD（统一时间）
   信息卡、时间流速/暂停、时间与帧率

   全站只有这一个时间源 simTime（距 J2000 的天数）和这一套倍率
   （模拟秒 / 真实秒）。天体运行与光波前都由它派生，不再有第二套时钟。
   ============================================================ */
import {
  qT, qStatic, qRate,
  TIME_RATES, TIME_RATE_DEFAULT,
} from "./config.js";
import { advancedSimDays } from "./light-math.js";

// 倍率 → HUD 文案。数值即「每真实秒推进多少模拟秒」。
const RATE_LABELS = {
  1: "真实时间 1:1",
  60: "1 分钟/秒",
  600: "10 分钟/秒",
  3600: "1 小时/秒",
  21600: "6 小时/秒",
  86400: "1 天/秒",
  604800: "7 天/秒",
  2592000: "30 天/秒",
};

export function createHud({ onHome }) {
  let simTime = qT;
  let rateSec = qRate ?? TIME_RATE_DEFAULT;   // 打开光速模式时也默认真实时间 1:1
  let userPaused = false;
  const pausedNow = () => userPaused;
  let fpsAcc = 0, frames = 0;

  const fpsEl = document.getElementById("fps");
  const timeEl = document.getElementById("simtime");
  const speedEl = document.getElementById("speed");
  const infoEl = document.getElementById("info");
  const infoName = document.getElementById("infoName");
  const infoType = document.getElementById("infoType");
  const infoDist = document.getElementById("infoDist");
  const infoEcc = document.getElementById("infoEcc");
  const infoPeriod = document.getElementById("infoPeriod");
  const infoMoons = document.getElementById("infoMoons");
  const infoInc = document.getElementById("infoInc");

  const rateLabel = () => RATE_LABELS[rateSec] || `${rateSec} 秒/秒`;

  /* ---------- 信息卡 ---------- */
  function showInfo(cfg) {
    infoName.textContent = cfg.name;
    infoType.textContent = cfg.type;
    infoDist.textContent = cfg.desc || `${cfg.aAU.toFixed(3)} AU`;
    infoEcc.textContent = cfg.eccLabel || cfg.e.toFixed(4);
    infoPeriod.textContent = cfg.periodLabel || (cfg.orbitDays >= 365.25
      ? `${(cfg.orbitDays / 365.25).toFixed(2)} 年`
      : `${cfg.orbitDays.toFixed(2)} 天`);
    infoMoons.textContent = cfg.moons > 0
      ? `${cfg.moons} 颗${cfg.moonsAsOf ? `（${cfg.moonsAsOf}）` : ""}`
      : "无";
    infoInc.textContent = cfg.incLabel || `${Math.abs(cfg.incDeg).toFixed(3)}°`;
    infoEl.classList.add("on");
  }
  function hideInfo() {
    infoEl.classList.remove("on");
  }

  /* ---------- 时间流速 / 暂停 ---------- */
  function renderSpeed() {
    const paused = pausedNow();
    speedEl.textContent = rateLabel() + (paused ? " ⏸" : "");
    for (const b of document.querySelectorAll(".ctrl button")) {
      if (b.dataset.rate === undefined) continue;
      const bv = parseFloat(b.dataset.rate);
      b.classList.toggle("on", bv === 0 ? paused : (!paused && bv === rateSec));
    }
  }
  function applySpeed(v) {
    if (v === 0) {
      userPaused = !userPaused;   // 暂停键兼作恢复键
    } else {
      rateSec = v;
      userPaused = false;
    }
    renderSpeed();
  }

  document.querySelectorAll(".ctrl button").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.dataset.home !== undefined) {
        onHome();
        return;
      }
      applySpeed(parseFloat(b.dataset.rate));
    });
  });

  addEventListener("keydown", (e) => {
    // 不劫持聚焦在按钮/标签/表单上的空格与方向键，保证键盘可达性
    if (e.target && e.target.closest
        && e.target.closest("button, a, input, textarea, select, .lbl")) return;
    if (e.code === "ArrowUp" || e.code === "ArrowDown") {
      const i = TIME_RATES.indexOf(rateSec);
      const next = i < 0
        ? TIME_RATE_DEFAULT
        : TIME_RATES[Math.min(TIME_RATES.length - 1, Math.max(0,
            i + (e.code === "ArrowUp" ? 1 : -1)))];
      applySpeed(next);
    }
    if (e.code === "Space") { e.preventDefault(); applySpeed(0); }
  });

  /* ---------- 时间推进与状态显示 ---------- */
  function advance(dt) {
    if (!qStatic && !pausedNow()) {
      simTime = advancedSimDays(simTime, dt, rateSec);
    }
  }

  function renderTime() {
    const absDays = Math.abs(simTime);
    const days = Math.floor(absDays);
    const hours = Math.floor((absDays - days) * 24);
    const minutes = Math.floor(((absDays - days) * 24 - hours) * 60);
    timeEl.textContent = `J2000 ${simTime < 0 ? "−" : "+"} ${days} 天 ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }

  // rawDt：未被 0.25s 上限钳制的真实帧间隔，FPS 才有诊断意义
  function updateHud(rawDt) {
    if (qStatic) return;
    frames++; fpsAcc += rawDt;
    if (fpsAcc >= 0.5) {
      fpsEl.textContent = Math.round(frames / fpsAcc);
      renderTime();
      frames = 0; fpsAcc = 0;
    }
  }

  renderSpeed();
  renderTime();

  return {
    showInfo, hideInfo,
    advance, updateHud, applySpeed,
    getSimTime: () => simTime,
    isPaused: pausedNow,
    getRate: () => rateSec,
    rateLabel,
    setRate: (v) => { rateSec = v; renderSpeed(); },
    setSimTime: (days) => { simTime = days; renderTime(); },
    setPaused: (v) => { userPaused = v; renderSpeed(); },
    togglePaused: () => { userPaused = !userPaused; renderSpeed(); },
  };
}
