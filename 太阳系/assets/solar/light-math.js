/* ============================================================
   光速 / 统一时间数学（纯函数，无 three / DOM 依赖，可在 Node 直接测试）

   只有一个时间轴：simTime（距 J2000 的天数），由单一倍率推进。
   行星位置与光波前都由它派生，不存在第二套时钟：
     lightSec = (simTime - emissionT) · 86400
     波前半径 = c · lightSec / KM_PER_UNIT
   ============================================================ */
import {
  UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU, SECONDS_PER_DAY,
  PULSE_FALLBACK_SEC, MAX_PULSES,
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
// 下限取日面半径，避免 t=0 时球面几何退化。
export function frontRadius(lightSec) {
  return Math.max(SUN_CFG.radius, Math.max(0, lightSec) * UNITS_PER_LIGHT_SEC);
}

/* ---------- 脉冲波纹 ----------
   脉冲间隔 step 是固定的「光秒」物理量（默认 5 光秒），与观看倍率无关。
   球层 k 的半径 = c·((limit-1-k+phase)·step)，phase = (t/step) mod 1
   连续滑动。age 随 t 线性增长且系数恰为 1，所以 dR/dt = c —— 波纹严格
   以光速向外扩散。旧版按主波前归一化成 R·f，dR/dt 是 c 的若干倍，
   看起来明显超光速。相位循环处逐层接力，两端由 light-view 淡入淡出。
   纯函数 → 截图可复现。 */
export function pulseRadii(lightSec, intervalSec = PULSE_FALLBACK_SEC,
                           maxCount = MAX_PULSES) {
  const step = Number.isFinite(intervalSec) && intervalSec > 0
    ? intervalSec : PULSE_FALLBACK_SEC;
  const t = Number.isFinite(lightSec) ? Math.max(0, lightSec) : 0;
  const limit = Math.max(2, Math.floor(maxCount) || MAX_PULSES);
  const R = frontRadius(t);                        // 光实际走到的最远处
  const phase = (t / step) % 1;
  const radii = [];
  for (let k = 0; k < limit; k++) {
    const age = (limit - 1 - k + phase) * step;   // 已传播光秒，由大到小
    // 上限截断：光还没走到那么远时不该已有球壳。R 与 c·age 的 d/dt 都是 c，
    // 取 min 后仍严格以光速扩散。
    radii.push(Math.min(frontRadius(age), R));
  }
  return radii;
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
