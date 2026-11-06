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

/* ---------- 脉冲波纹（已废弃，勿用于新功能） ----------
   @deprecated 多球壳脉冲模型已被 light-view.js 的「单波前球面 + 1 光秒
   亮点」取代，运行时不再引用本节任何函数；仅 tests/light-math.test.mjs
   仍在锁定这套旧模型的数学性质，作为历史回归保留。

   旧模型物理设定（存档说明）：每个光球有固定发射光行时 emit_k = k·step
   （step = 5 光秒），当前光行时 t 时半径 R_k = c·(t − emit_k)，因此
   dR_k/dt ≡ c、相邻球壳间距恒为 5 光秒。历史上三种故障都来自「用当前 t
   的归一化比例定位球壳」（超光速 / 波纹挤在中心 / 每秒重排球阵），固定
   发射时刻后不再可能。pulseStride 按相机像素尺度做 2 的幂抽样，把可见
   球壳数压到 MAX_PULSES 量级。若将来恢复多球壳渲染，从这里接手。 */

/** @deprecated 运行时未使用，仅测试锁定；见本节头部说明。 */
export function pulseStride(viewRadius, intervalSec = PULSE_FALLBACK_SEC,
                            maxCount = MAX_PULSES) {
  const step = Number.isFinite(intervalSec) && intervalSec > 0
    ? intervalSec : PULSE_FALLBACK_SEC;
  const limit = Math.max(2, Math.floor(maxCount) || MAX_PULSES);
  const shellGap = step * UNITS_PER_LIGHT_SEC;   // 一个网格间隔的世界距离
  const vr = Number.isFinite(viewRadius) ? Math.max(0, viewRadius) : 0;
  const need = vr / (shellGap * (limit - 1));
  let s = 1;
  while (s < need) s *= 2;                       // 2 的幂：相机小幅移动不变档
  return s;
}

// viewRadius：相机当前能看见的半径范围（世界单位），由 light-view 按
// camDist / fov 计算，不含 t，故 stride 在播放中恒定。
/** @deprecated 运行时未使用，仅测试锁定；见「脉冲波纹」节头部说明。 */
export function pulseRadii(lightSec, intervalSec = PULSE_FALLBACK_SEC,
                           viewRadius = Infinity, maxCount = MAX_PULSES) {
  const step = Number.isFinite(intervalSec) && intervalSec > 0
    ? intervalSec : PULSE_FALLBACK_SEC;
  const t = Number.isFinite(lightSec) ? Math.max(0, lightSec) : 0;
  const R = frontRadius(t);
  const rawView = Number.isFinite(viewRadius) && viewRadius > 0
    ? viewRadius : R;
  const stride = pulseStride(rawView, step, maxCount);
  const vR = Math.min(rawView, R);               // 窗口只用于裁剪，不影响 stride

  const kMax = Math.floor(t / step);             // 最新（年龄最小）的球壳
  const kMin = Math.max(0, Math.ceil((t - vR / UNITS_PER_LIGHT_SEC) / step));
  const radii = [];
  // k 取 stride 的绝对整数倍：t 增长时集合不变，每个球壳半径各自 +c·Δt。
  // 由大到小（k 小 → 年龄大 → 半径大）。
  for (let k = 0; k <= kMax; k += stride) {
    if (k < kMin) continue;                     // 太老、半径超出可见窗口
    radii.push(frontRadius(t - k * step));
  }
  if (radii.length === 0) radii.push(frontRadius(t));   // t 极小时的保底
  return radii;
}

/* ---------- 球内「光波扫过」权重（已废弃） ----------
   @deprecated 旧多球壳模型中「相机被包裹时一波波扫过」的亮度权重。
   现行 light-view.js 是单球面 + uInside 增强，不再引用本函数；仅测试
   保留。旧设定存档：只有掠过观察视野半径 camRadius 的波面发亮，权重
   不对称（迎面拖尾长、越过后快速淡出）以给出方向感。 */
export function sweepWeight(shellRadius, camRadius, width) {
  const w = Math.max(Number.isFinite(width) ? width : 0, 1e-9);
  const d = (shellRadius - camRadius) / w;
  return Number.isFinite(d) ? Math.exp(-d * d * (d <= 0 ? 0.45 : 1.8)) : 0;
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

// 给定历元八颗行星的瞬时距离与光行时（偏心率带来的浮动因此可见）。
// light-hud 每帧用当前 simTime 调用：标尺刻度与 light-view 光线终点
// （同样按当前 simTime 定位行星）因此始终一致，高倍率下行星光程内
// 位移也不会造成「已越过 n/8」与视觉脱节。
export function lightArrivals(days) {
  return PLANETS.map((cfg, index) => {
    orbitalPosition(cfg, days, _v);
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
