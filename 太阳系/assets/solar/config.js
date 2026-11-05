/* ============================================================
   太阳系 · Solar · 基础配置
   查询参数、比例基准与单位换算
   天体数据见 bodies.js，按天体分段
   ============================================================ */

/* ---------- 查询参数：让每个状态可截图 ---------- */
// 没有 location 时（Node 测试）用空查询串，保证数据模块可直接 import
export const Q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
// 数值参数统一校验：?foo= 或 ?foo=abc 一律按缺省处理，避免 NaN 传进相机/时间
const numParam = (k) => {
  const v = parseFloat(Q.get(k));
  return Number.isFinite(v) ? v : null;
};
export const qT     = numParam("t") ?? 0;
export const qAz    = numParam("az");
export const qEl    = numParam("el");
export const qDist  = numParam("dist");
export const qFocus = Q.get("focus");
export const qStatic = Q.get("static") === "1";

// ============================================================
//  比例基准（严格等比例）
//  AU_UNIT: 1 AU = 10.06 世界单位，轨道距离按真实 AU 线性换算。
//  天体半径与轨道距离共用 KM_PER_UNIT，默认不做任何尺寸放大。
//  ?size=25 可临时放大天体半径（轨道不变），仅用于对比观察。
// ============================================================
export const AU_UNIT     = 10.06;
export const KM_PER_AU   = 149597870.7;
export const KM_PER_UNIT = KM_PER_AU / AU_UNIT;
const SIZE_PARAM    = parseFloat(Q.get("size"));
export const RADIUS_SCALE = Number.isFinite(SIZE_PARAM) && SIZE_PARAM > 0 ? SIZE_PARAM : 1.0;
export const kmToUnit     = (km) => (km / KM_PER_UNIT) * RADIUS_SCALE;
export const AU_TO_UNIT   = (au) => au * AU_UNIT;
export const TAU          = Math.PI * 2;
export const DEG          = Math.PI / 180;

// ============================================================
//  光速基准（严格等比例，不引入新单位）
//  c 恒为真空光速；「回放倍率」只改变观看节奏，从不改变 c。
//  光行时按太阳中心 → 天体的距离计算，与 1 AU = 8 分 19 秒一致。
// ============================================================
export const C_KM_S              = 299792.458;
export const UNITS_PER_LIGHT_SEC = C_KM_S / KM_PER_UNIT;   // 世界单位 / 光秒
export const LIGHT_SEC_PER_AU    = KM_PER_AU / C_KM_S;     // ≈ 499.005 s
export const LIGHT_RATE_DEFAULT  = 600;                    // 600 光秒 / 真实秒
export const LIGHT_RATES         = [60, 600, 3600];

/* ---------- 光速查询参数（与其它 ?参数 同样用于复现截图） ---------- */
export const qLight       = Q.get("light") === "1";
export const qLightRate   = (() => {
  const v = numParam("lrate");
  return v !== null && v > 0 ? v : LIGHT_RATE_DEFAULT;
})();
export const qLightT      = (() => {
  const v = numParam("lt");
  return v !== null && v >= 0 ? v : null;
})();
export const qLightMode   = Q.get("lmode") === "log" ? "log" : "linear";
export const qLightStatic = qStatic || Q.get("lstatic") === "1";
