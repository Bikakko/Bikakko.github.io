/* ============================================================
   太阳系 · Solar · HUD（统一时间）
   信息卡、时间流速/暂停、民用时间与帧率

   全站只有这一个时间源 simTime（距 J2000 的 TT 天数）和这一套倍率
   （模拟秒 / 真实秒）。天体运行与光波前都由它派生，不再有第二套时钟。
   缺省「实时跟随」：simTime 每帧直接由 Date.now() 换算，不累加 dt，
   因此挂着页面几小时也不会与手表错开。
   ============================================================ */
import {
  qT, qLive, qStatic, qRate, qZone,
  TIME_RATES, TIME_RATE_DEFAULT,
} from "./config.js";
import { advancedSimDays } from "./light-math.js";
import {
  utcMsToTTDays, ttDaysToUtcMs, civilParts, formatOffset, weekdayName,
} from "./ephemeris-time.js";

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

export function createHud({ onHome, onEpoch }) {
  let simTime = qT;
  let rateSec = qRate ?? TIME_RATE_DEFAULT;   // 打开光速模式时也默认真实时间 1:1
  let userPaused = false;
  let live = qLive && rateSec === 1;
  let zone = qZone;
  const pausedNow = () => userPaused;
  let fpsAcc = 0, frames = 0;

  const fpsEl = document.getElementById("fps");
  const speedEl = document.getElementById("speed");
  const infoEl = document.getElementById("info");
  const infoWrap = document.getElementById("infoWrap");
  const infoName = document.getElementById("infoName");
  const infoType = document.getElementById("infoType");
  const infoDist = document.getElementById("infoDist");
  const infoEcc = document.getElementById("infoEcc");
  const infoPeriod = document.getElementById("infoPeriod");
  const infoMoons = document.getElementById("infoMoons");
  const infoInc = document.getElementById("infoInc");
  const nowBtn = document.getElementById("tpNow");
  const nowStateEl = document.getElementById("tpNowState");

  const rateLabel = () => RATE_LABELS[rateSec] || `${rateSec} 秒/秒`;
  const utcMs = () => ttDaysToUtcMs(simTime);

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
    infoWrap.classList.add("on");
  }
  function hideInfo() {
    infoEl.classList.remove("on");
    infoWrap.classList.remove("on");
  }

  /* ---------- 时间流速 / 暂停 ---------- */
  function renderSpeed() {
    const paused = pausedNow();
    speedEl.textContent = live ? "实时跟随" : rateLabel() + (paused ? " ⏸" : "");
    for (const b of document.querySelectorAll(".ctrl button")) {
      if (b.dataset.rate === undefined) continue;
      const bv = parseFloat(b.dataset.rate);
      b.classList.toggle("on", bv === 0 ? paused : (!paused && bv === rateSec));
    }
    nowBtn.classList.toggle("on", live);
    nowStateEl.textContent = live ? "实时跟随" : "未跟随";
  }
  function applySpeed(v) {
    if (v === 0) {
      userPaused = !userPaused;   // 暂停键兼作恢复键
      if (userPaused) live = false;
    } else {
      rateSec = v;
      userPaused = false;
      live = false;               // 选了倍率就按倍率走，不再跟手表
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
      if (b.dataset.rate === undefined) return;
      applySpeed(parseFloat(b.dataset.rate));
    });
  });

  // 「现在」在时间抽屉里：点一下回到本机时钟并恢复实时跟随
  nowBtn.addEventListener("click", (e) => { e.stopPropagation(); setNow(); });

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
    if (qStatic) return;
    // 实时跟随直接读系统时钟，不累加 dt：切后台、掉帧都不会累积误差
    if (live) { simTime = utcMsToTTDays(Date.now()); return; }
    if (!pausedNow()) simTime = advancedSimDays(simTime, dt, rateSec);
  }

  const p2 = (n) => String(n).padStart(2, "0");
  const fullEl = document.getElementById("simFull");
  const shortEl = document.getElementById("simShort");
  let lastClock = "";

  function renderTime() {
    const ms = utcMs();
    const c = civilParts(ms, zone);
    const date = `${String(c.year).padStart(4, "0")}-${p2(c.month)}-${p2(c.day)}`;
    const clock = `${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`;
    const key = `${date}|${c.weekday}|${clock}|${c.offsetMinutes}`;
    if (key === lastClock) return;
    lastClock = key;
    const week = `周${weekdayName(ms, zone)}`;
    // 小屏由 CSS 换成短串，避免与右侧状态卡挤在一起
    fullEl.textContent = `${date} ${week} ${clock} ${formatOffset(c.offsetMinutes)}`;
    shortEl.textContent = `${p2(c.month)}-${p2(c.day)} ${week} ${p2(c.hour)}:${p2(c.minute)}`;
  }

  // 定位到指定历元：退出实时跟随。连续拖动（光速标尺）走这条，不重采轨道
  function setSimTime(days) {
    simTime = days;
    live = false;
    renderTime();
    renderSpeed();
  }

  // 离散跳转：额外重采轨道线，让椭圆要素与行星位置同历元
  function jumpTo(days) {
    setSimTime(days);
    if (onEpoch) onEpoch(days);
  }

  function setNow() {
    simTime = utcMsToTTDays(Date.now());
    live = !qStatic;
    rateSec = 1;
    userPaused = false;
    renderTime();
    renderSpeed();
    if (onEpoch) onEpoch(simTime);
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
    getUtcMs: utcMs,
    isPaused: pausedNow,
    isLive: () => live,
    getRate: () => rateSec,
    rateLabel,
    setRate: (v) => { rateSec = v; live = false; renderSpeed(); },
    setSimTime, jumpTo, setNow,
    getZone: () => zone,
    setZone: (z) => { zone = z; lastClock = ""; renderTime(); },
    setPaused: (v) => { userPaused = v; if (v) live = false; renderSpeed(); },
    togglePaused: () => { userPaused = !userPaused; if (userPaused) live = false; renderSpeed(); },
  };
}
