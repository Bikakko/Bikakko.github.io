/* ============================================================
   轨道数学（无 three 依赖，可在 Node 直接测试）
   - 行星与月球：JPL SSD Table 1 的 J2000 要素 + 每世纪线性速率
     （有效区间 1800–2050；不含 Table 2b 的 b/c/s/f 附加项）
   - 无速率的简化轨道：固定恒星周期
   - 输出为 three.js 的 Y-up 世界坐标：黄道 (x, y, z) → (x, z, -y)
   ============================================================ */
import { AU_UNIT, TAU, DEG } from "./config.js";

export function solveKepler(M, e) {
  const m = ((M % TAU) + TAU) % TAU;
  let E = m + e * Math.sin(m);
  for (let i = 0; i < 8; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// 当前历元的六个轨道要素；T 为距 J2000 的儒略世纪数。
// a/e 做保守夹取：?t= 是用户可控的边界值，极端历元下仍要让开普勒方程可解。
export function elementsAt(cfg, T) {
  const r = cfg.rates || {};
  return {
    aAU: Math.max(1e-9, cfg.aAU + (r.aPerCentury || 0) * T),
    e: Math.min(0.9, Math.max(0, cfg.e + (r.ePerCentury || 0) * T)),
    incDeg: cfg.incDeg + (r.incDegPerCentury || 0) * T,
    nodeDeg: cfg.nodeDeg + (r.nodeDegPerCentury || 0) * T,
    varpiDeg: cfg.varpiDeg + (r.varpiDegPerCentury || 0) * T,
    meanLonDeg: cfg.meanLonDeg + (r.meanLonDegPerCentury || 0) * T,
  };
}

// 由偏近点角和当前轨道要素算世界坐标
function orbitalPointFromAngles(aAU, e, incRad, nodeRad, varpiRad, E, out) {
  const cosE = Math.cos(E), sinE = Math.sin(E);
  // 轨道平面内：x 指向近日点，y 与之垂直
  const x = aAU * (cosE - e);
  const y = aAU * Math.sqrt(1 - e * e) * sinE;
  // 从升交点量起的轨道面角度 = 近日点幅角 + 真近点角
  const u = varpiRad - nodeRad + Math.atan2(y, x);
  const r = Math.hypot(x, y) * AU_UNIT;

  // 与 space.js 原矩阵路径逐项等价：先绕节点线倾 i，再绕黄极转 Ω
  const x0 = Math.cos(u) * r;
  const z0 = -Math.sin(u) * r;
  const sinI = Math.sin(incRad), cosI = Math.cos(incRad);
  const y1 = -z0 * sinI;
  const z1 = z0 * cosI;
  const sinO = Math.sin(nodeRad), cosO = Math.cos(nodeRad);

  return out.set(
    x0 * cosO + z1 * sinO,
    y1,
    -x0 * sinO + z1 * cosO,
  );
}

// 轨道线采样用：给定偏近点角与历元
export function orbitalPointAtE(cfg, E, out, T = 0) {
  const el = elementsAt(cfg, T);
  return orbitalPointFromAngles(
    el.aAU, el.e, el.incDeg * DEG, el.nodeDeg * DEG, el.varpiDeg * DEG, E, out,
  );
}

const _satV = {
  x: 0, y: 0, z: 0,
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
};

// 含卫星质心摆动的本体位置：bary(t) − Σ m_sat · r_sat(t)
// 供每帧定位与轨道线采样共用，两者因此始终一致。
export function barycenterCorrectedPosition(cfg, days, out) {
  orbitalPosition(cfg, days, out);
  for (const sat of cfg.satellites || []) {
    orbitalPosition(sat, days, _satV);
    const m = sat.massRatio || 0;
    out.set(out.x - _satV.x * m, out.y - _satV.y * m, out.z - _satV.z * m);
  }
  return out;
}

// 给定距 J2000 的天数，返回世界坐标
export function orbitalPosition(cfg, days, out) {
  if (!(cfg.orbitDays > 0) || !Number.isFinite(days)) return out.set(0, 0, 0);

  const T = days / 36525;
  const el = elementsAt(cfg, T);
  const bias = cfg.mAnomalyBias || 0;
  let M;
  if (cfg.rates && cfg.rates.meanLonDegPerCentury) {
    // JPL：M = L − ϖ。L̇ 已含平运动，故不再用固定恒星周期叠加相位
    M = (el.meanLonDeg - el.varpiDeg) * DEG + bias;
  } else {
    // 无长期项的简化轨道：J2000 平根数 + 恒星公转周期
    const phaseDays = ((days % cfg.orbitDays) + cfg.orbitDays) % cfg.orbitDays;
    M = (cfg.meanLonDeg - cfg.varpiDeg) * DEG
      + TAU * (phaseDays / cfg.orbitDays) + bias;
  }

  return orbitalPointFromAngles(
    el.aAU, el.e, el.incDeg * DEG, el.nodeDeg * DEG, el.varpiDeg * DEG,
    solveKepler(M, el.e), out,
  );
}
