/* ============================================================
   轨道数学（无 three 依赖，可在 Node 直接测试）
   J2000 轨道要素 + 开普勒方程；支持可选的每世纪要素速率（月球）
   输出为 three.js 的 Y-up 世界坐标：黄道 (x, y, z) → (x, z, -y)
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

// 轨道线采样用：给定偏近点角
export function orbitalPointAtE(cfg, E, out) {
  return orbitalPointFromAngles(
    cfg.aAU, cfg.e, cfg.incDeg * DEG, cfg.nodeDeg * DEG, cfg.varpiDeg * DEG, E, out,
  );
}

// 给定距 J2000 的天数，返回世界坐标
export function orbitalPosition(cfg, days, out) {
  if (!(cfg.orbitDays > 0) || !Number.isFinite(days)) return out.set(0, 0, 0);

  // 有长期速率的轨道（月球）：直接按 J2000 + 每世纪速率求当下要素
  if (cfg.rates) {
    const T = days / 36525;
    const meanLon = cfg.meanLonDeg + (cfg.rates.meanLonDegPerCentury || 0) * T;
    const varpi = cfg.varpiDeg + (cfg.rates.varpiDegPerCentury || 0) * T;
    const node = cfg.nodeDeg + (cfg.rates.nodeDegPerCentury || 0) * T;
    const inc = cfg.incDeg + (cfg.rates.incDegPerCentury || 0) * T;
    const M = (meanLon - varpi) * DEG + (cfg.mAnomalyBias || 0);
    return orbitalPointFromAngles(
      cfg.aAU, cfg.e, inc * DEG, node * DEG, varpi * DEG, solveKepler(M, cfg.e), out,
    );
  }

  // 行星：J2000 平根数 + 恒星公转周期
  const phaseDays = ((days % cfg.orbitDays) + cfg.orbitDays) % cfg.orbitDays;
  const M = (cfg.meanLonDeg - cfg.varpiDeg) * DEG
          + TAU * (phaseDays / cfg.orbitDays)
          + (cfg.mAnomalyBias || 0);
  return orbitalPointFromAngles(
    cfg.aAU, cfg.e, cfg.incDeg * DEG, cfg.nodeDeg * DEG, cfg.varpiDeg * DEG,
    solveKepler(M, cfg.e), out,
  );
}
