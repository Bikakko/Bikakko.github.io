/* ============================================================
   太阳系 · Solar · HUD
   信息卡、速度/暂停、时间与帧率、贴近自动暂停
   ============================================================ */
import { qT, qStatic } from "./config.js";

export function createHud({ onHome }) {
  let simTime = qT;
  let speedLevel = 1;
  // 暂停拆成「用户暂停」与「贴近自动暂停」两个状态：
  // 用户在被自动暂停时手动恢复，本次贴近不再自动压回（否则空格像失灵）
  let userPaused = false;
  let autoPaused = false;
  let autoSuppressed = false;
  let nearBody = false;   // 最近一次 autoPauseCheck 报告的距离状态
  const pausedNow = () => userPaused || autoPaused;
  // 档位 → 每真实秒推进多少「天」：1× 为现实速度，2×–8× 按小时换算
  const DAYS_PER_SEC = [0, 1 / 86400, 0.5 / 24, 3 / 24, 12 / 24, 36 / 24, 72 / 24, 168 / 24, 720 / 24];
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

  /* ---------- 速度 / 暂停 ---------- */
  function renderSpeed() {
    const paused = pausedNow();
    speedEl.textContent = speedLevel + "×" + (paused ? (autoPaused && !userPaused ? " ⏸自动" : " ⏸") : "");
    for (const b of document.querySelectorAll(".ctrl button")) {
      if (b.dataset.sp === undefined) continue;
      const bv = parseFloat(b.dataset.sp);
      b.classList.toggle("on", bv === 0 ? paused : (!paused && bv === speedLevel));
    }
  }
  function applySpeed(v) {
    if (v === 0) {
      // 暂停键兼作恢复键
      if (pausedNow()) {
        userPaused = false;
        // 处于贴近区时恢复：本次贴近不再自动暂停（否则下一帧立刻被压回）
        if (autoPaused || nearBody) autoSuppressed = true;
        autoPaused = false;
      } else {
        userPaused = true;
      }
    } else {
      speedLevel = v;
      userPaused = false;
      if (autoPaused || nearBody) {
        autoPaused = false;
        autoSuppressed = true;
      }
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
      applySpeed(parseFloat(b.dataset.sp));
    });
  });

  addEventListener("keydown", (e) => {
    // 不劫持聚焦在按钮/标签/表单上的空格与方向键，保证键盘可达性
    if (e.target && e.target.closest
        && e.target.closest("button, a, input, textarea, select, .lbl")) return;
    if (e.code === "ArrowUp")   applySpeed(Math.min(8, speedLevel + 1));
    if (e.code === "ArrowDown") applySpeed(Math.max(1, speedLevel - 1));
    if (e.code === "Space")     { e.preventDefault(); applySpeed(0); }
  });

  /* ---------- 贴近观察自动暂停 ---------- */
  function autoPauseCheck(close, far) {
    if (qStatic) return;
    nearBody = close;
    if (autoSuppressed) {
      if (far) autoSuppressed = false;   // 离开贴近区后才重新武装
      return;
    }
    if (!userPaused && !autoPaused && close) {
      autoPaused = true;
      renderSpeed();
    } else if (autoPaused && far) {
      autoPaused = false;
      renderSpeed();
    }
  }

  /* ---------- 时间推进与状态显示 ---------- */
  function advance(dt) {
    if (!qStatic && !pausedNow()) simTime += dt * DAYS_PER_SEC[speedLevel];
  }

  function renderTime() {
    const absDays = Math.abs(simTime);
    const days = Math.floor(absDays);
    const hours = Math.floor((absDays - days) * 24);
    timeEl.textContent = `J2000 ${simTime < 0 ? "−" : "+"} ${days} 天 ${String(hours).padStart(2, "0")}h`;
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
    showInfo, hideInfo, autoPauseCheck,
    advance, updateHud, applySpeed,
    getSimTime: () => simTime,
    isPaused: pausedNow,
  };
}
