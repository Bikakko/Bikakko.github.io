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
