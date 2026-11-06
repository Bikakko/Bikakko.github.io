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
   这是本模块反复出故障的地方，所以把物理模型写死，不再「每帧按当前 t
   重新算一组位置」。

   每个光球都有固定的「发射光行时」 emit_k = k·step（step = 5 光秒，
   物理量，与观看倍率无关）。当前光行时 t 时年龄 age = t − emit_k，
   半径 R_k = c·age。于是三条不变量同时成立，且是数学上的必然：
     · dR_k/dt = c —— emit_k 是常数，不可能超光速；
     · k = 0..floor(t/step) 的半径从主波前一路排到日面 —— 不会只挤在
       中心一小块，也不会只贴在最外一圈；
     · 相邻球壳间距恒为 step·c = 5 光秒的距离 —— 即「每 5 光秒的距离
       出现一个新光球」。

   历史三种故障都来自「用当前 t 的归一化比例定位球壳」：
     · 归一化成 R(t)·f：f 里含 t，dR/dt 被放大成 c 的若干倍 → 超光速；
     · 固定层数 × 固定间隔从 0 排：空间跨度锁死在 层数×step·c
       （32×5 光秒 = 3.2 单位），波前跑到 302 单位时波纹仍挤在中心 → 太小；
     · floor(t/step) 离散抽样：1:1 下每秒重排整个球阵 → 心跳抖动。
   发射时刻固定后这三件事都不再可能。

   剩下的只是渲染问题：t 可达 15005 光秒，物理上有 3001 层球壳，屏幕
   不可能清晰显示。按相机的世界像素尺度选一个 2 的幂抽样步长 stride，
   只画 k 为 stride 整数倍的球壳 —— 它们仍落在真实的 5 光秒网格上，
   仍严格以 c 运动。stride 只依赖相机、不依赖 t，因此播放过程中球壳
   索引集合恒定、平滑推进；可见半径窗口两端的增删由 light-view 用
   淡入淡出隐藏。纯函数 → 暂停 / 重播 / 拖标尺 / ?lt 截图可复现。 */
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

/* ---------- 球内「光波扫过」权重 ----------
   相机被光球包裹时，只有波面正掠过「观察视野半径」（camRadius，球内取
   相机距离的一个比例）的那一两波应该发亮：更内侧与已越过视野的球都淡出。
   于是随时间推进，各球壳依次经过 camRadius，视觉上就是一波一波的光波
   扫过去，而不是一圈圈静止的同心球壳。权重不对称：波面迎面涌来
   （shell < cam）时拖尾长、越过视野后快速淡出，给出「扫过去」的方向感。
   纯函数，与 GLSL 中的公式保持一致，供单测锁定。 */
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
