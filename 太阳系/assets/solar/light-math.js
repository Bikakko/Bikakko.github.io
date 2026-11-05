/* ============================================================
   光速数学（纯函数，无 three / DOM 依赖，可在 Node 直接测试）
   约定：c 恒为 C_KM_S，光行时按「太阳中心 → 天体」的瞬时距离计算，
   与 1 AU = 8 分 19 秒这类标准数值一致。只缩放回放倍率，从不改变 c。
   ============================================================ */
import { UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU } from "./config.js";
import { SUN_CFG, PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";

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

/* ---------- 光行时 ---------- */
export function lightTimeSeconds(distanceWorld) {
  return distanceWorld / UNITS_PER_LIGHT_SEC;
}

// 波前半径：从太阳中心起算；下限取日面半径，避免 t=0 时几何退化。
export function frontRadius(lightSec) {
  return Math.max(SUN_CFG.radius, Math.max(0, lightSec) * UNITS_PER_LIGHT_SEC);
}

// 视线与「以世界原点为球心、半径 R」的波前球求交。
// 这是 light-view.js 片元着色器的 JS 参考实现，供单测校验：
// 旧实现用球面法线 fresnel，相机进入球壳后 |dot(N,V)|≈1 会让整球消失，
// 且亮度随 |camPos|/R 剧烈变化。改用切向判据后与相机位置完全解耦。
// grazing：0 = 擦过球壳轮廓（环最亮），1 = 正对球心（环不亮）。
export function wavefrontGrazing(camPos, dir, R) {
  const b = camPos.x * dir.x + camPos.y * dir.y + camPos.z * dir.z;
  const c2 = camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z - R * R;
  const disc = b * b - c2;
  const sq = Math.sqrt(Math.max(disc, 0));
  const tNear = -b - sq;
  const inside = c2 <= 0;
  // 与片元着色器一致：视线未与球相交时 grazing 置 1（环外）；
  // 波前已包裹相机时不画环，只留余辉。切向时 disc≈0，给一点浮点容差。
  const intersects = disc > -1e-9 * Math.max(R * R, 1);
  const grazing = intersects ? Math.min(1, Math.max(0, sq / Math.max(R, 1e-6))) : 1;
  return {
    grazing,
    hit: intersects && tNear >= 0 && !inside,
    inside,
  };
}

const _v = {
  x: 0, y: 0, z: 0,
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
};

// 当前历元八颗行星的瞬时距离与光行时（偏心率带来的浮动因此可见）
export function lightArrivals(simTime) {
  return PLANETS.map((cfg, index) => {
    orbitalPosition(cfg, simTime, _v);
    const distance = Math.hypot(_v.x, _v.y, _v.z);
    return { index, name: cfg.name, distance, seconds: lightTimeSeconds(distance) };
  });
}

/* ---------- 回放推进 ----------
   linear：每真实秒推进 rate 光秒（物理节奏）。
   log：每个数量级等时长（观察节奏），刻度读数仍是物理时间。 */
export function advanceLightTime(lightSec, dt, rate, mode = "linear") {
  if (!Number.isFinite(dt) || dt <= 0) return lightSec;
  if (mode === "log") {
    const span = 30 * (600 / Math.max(rate, 1e-6));   // 600× 下约 30s 走完整条轴
    const t = toLogAxis(lightSec) + dt / span;
    return t >= 1 ? LOG_AXIS_MAX : fromLogAxis(t);
  }
  return lightSec + dt * rate;
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
