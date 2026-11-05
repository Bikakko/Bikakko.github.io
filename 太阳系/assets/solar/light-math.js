/* ============================================================
   光速 / 统一时间数学（纯函数，无 three / DOM 依赖，可在 Node 直接测试）

   只有一个时间轴：simTime（距 J2000 的天数），由单一倍率推进。
   行星位置与光波前都由它派生，不存在第二套时钟：
     lightSec = (simTime - emissionT) · 86400
     波前半径 = c · lightSec / KM_PER_UNIT
   ============================================================ */
import {
  UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU, SECONDS_PER_DAY,
} from "./config.js";
import { SUN_CFG, PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";

/* ---------- 统一时间 ---------- */
// rateSec：每真实秒推进多少模拟秒；simDays 单位为「天」。
export function advancedSimDays(simDays, dt, rateSec) {
  if (!Number.isFinite(dt) || dt <= 0) return simDays;
  return simDays + dt * rateSec / SECONDS_PER_DAY;
}

// 发射历元 → 当前历元经过的光行时（秒）
export function lightSecondsSince(simDays, emissionDays) {
  return Math.max(0, (simDays - emissionDays) * SECONDS_PER_DAY);
}

// 光行时 → 统一时间轴上的历元（天），供标尺拖动 / ?lt 定格使用
export function emissionPlusSeconds(emissionDays, lightSec) {
  return emissionDays + Math.max(0, lightSec) / SECONDS_PER_DAY;
}

// 波前半径（世界单位）：光从太阳中心出发走了 lightSec 秒。
// 下限取日面半径，避免 t=0 时 3D 球面几何退化。
export function frontRadius(lightSec) {
  return Math.max(SUN_CFG.radius, Math.max(0, lightSec) * UNITS_PER_LIGHT_SEC);
}

export function lightTimeSeconds(distanceWorld) {
  return distanceWorld / UNITS_PER_LIGHT_SEC;
}

/* ---------- 对数标尺 ----------
   线性轴上内行星全挤在最左端，故刻度按光时对数值铺开。
   60 s（1 光分）→ 18000 s（5 光时）覆盖水星到海王星。 */
export const LOG_AXIS_MIN = 60;
export const LOG_AXIS_MAX = 18000;
export const LIGHT_TICKS = [
  { sec: 60,    label: "1 光分" },
  { sec: 600,   label: "10 光分" },
  { sec: 3600,  label: "1 光时" },
  { sec: 14400, label: "4 光时" },
];
const LOG_MIN_L = Math.log10(LOG_AXIS_MIN);
const LOG_SPAN_L = Math.log10(LOG_AXIS_MAX) - LOG_MIN_L;

export function toLogAxis(sec) {
  const raw = Number.isFinite(sec) ? Math.max(sec, 0)
    : (sec === Infinity ? LOG_AXIS_MAX : 0);
  const s = Math.min(LOG_AXIS_MAX, Math.max(LOG_AXIS_MIN, raw));
  return (Math.log10(s) - LOG_MIN_L) / LOG_SPAN_L;
}

export function fromLogAxis(t) {
  return LOG_AXIS_MIN * Math.pow(LOG_AXIS_MAX / LOG_AXIS_MIN,
    Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)));
}

const _v = {
  x: 0, y: 0, z: 0,
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
};

// 发射历元八颗行星的瞬时距离与光行时（偏心率带来的浮动因此可见）。
// 光是 emissionDays 时发出的，到达时刻由发射时的行星位置决定；
// 光走 4 小时期间行星位移可忽略，故标尺在播放中保持稳定。
export function lightArrivals(emissionDays) {
  return PLANETS.map((cfg, index) => {
    orbitalPosition(cfg, emissionDays, _v);
    const distance = Math.hypot(_v.x, _v.y, _v.z);
    return { index, name: cfg.name, distance, seconds: lightTimeSeconds(distance) };
  });
}

/* ---------- 格式化 ---------- */
export function formatClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatShort(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(ss).padStart(2, "0")}s`;
  return `${ss}s`;
}

export function formatLightTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return `${h} 小时 ${m} 分 ${ss} 秒`;
  if (m) return `${m} 分 ${ss} 秒`;
  return `${ss} 秒`;
}

export function lightSecondsPerAU() {
  return LIGHT_SEC_PER_AU;
}
