/* ============================================================
   自转/极轴数学（无 three 依赖，可在 Node 直接测试）
   - IAU 极轴：赤道 J2000 的 RA/Dec（含每世纪线性项）
   - 自转角 W：W0 + Ẇ·d + Ẅ·d²
   - 世界坐标约定：黄道 (x, y, z) → (x, z, -y)
   ============================================================ */
import { DEG } from "./config.js";

// J2000 黄赤交角（IAU 2006/1980 常用值）
const ECLIPTIC_OBLIQUITY_DEG = 23.4392911;

export function equatorialToEcliptic(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const ce = Math.cos(ECLIPTIC_OBLIQUITY_DEG * DEG);
  const se = Math.sin(ECLIPTIC_OBLIQUITY_DEG * DEG);
  return {
    x,
    y: y * ce + z * se,
    z: -y * se + z * ce,
  };
}

export function eclipticToWorld(v) {
  return { x: v.x, y: v.z, z: -v.y };
}

// 轨道面法线（黄道坐标）：M = Rz(Ω)·Rx(i)，法线 = M·(0,0,1)
export function orbitNormalEcliptic(incDeg, nodeDeg) {
  const i = incDeg * DEG, O = nodeDeg * DEG;
  return {
    x: Math.sin(i) * Math.sin(O),
    y: -Math.sin(i) * Math.cos(O),
    z: Math.cos(i),
  };
}

export function angularSeparationDeg(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  const c = Math.max(-1, Math.min(1, dot / (la * lb)));
  return Math.acos(c) / DEG;
}

// 极轴在给定时刻的黄道坐标（线性岁差项；行星/月球的高阶章动未建模）
export function poleAt(cfg, days) {
  const T = days / 36525;
  const ra = cfg.pole.raDeg + (cfg.pole.raRatePerCentury || 0) * T;
  const dec = cfg.pole.decDeg + (cfg.pole.decRatePerCentury || 0) * T;
  return equatorialToEcliptic(ra, dec);
}

/* IAU 交点向量：本体赤道在 ICRF 赤道上的升交点，RA = α₀ + 90°、Dec = 0。
   W 角就是从这个向量沿本体赤道向东量到本初子午线的。地球的 δ₀ ≈ 90°，
   k × p 退化成一个数值噪声方向，必须由 α₀ 直接构造而不能取叉积。 */
export function nodeAt(cfg, days) {
  const T = days / 36525;
  const ra = cfg.pole.raDeg + (cfg.pole.raRatePerCentury || 0) * T;
  return equatorialToEcliptic(ra + 90, 0);
}

// 自转角 W = W0 + Ẇ·d + Ẅ·d²：线性项先按周期取模，避免极大 simTime
// 乘速率后溢出；二次项必须用完整 days——若也取模，Ẅ·d² 每圈被重置，
// 长历元下自转相位会持续漂移。最后整体 mod 360 保证精度。
export function spinAngleRad(spin, days) {
  const rate = spin.wRateDegPerDay;
  const w0 = spin.w0Deg || 0;
  if (!Number.isFinite(rate) || rate === 0) return w0 * DEG;
  if (!Number.isFinite(days)) return w0 * DEG;
  const period = 360 / Math.abs(rate);
  let d = days % period;
  if (d < 0) d += period;
  const deg = w0 + rate * d + (spin.wRate2DegPerDay2 || 0) * days * days;
  return (((deg % 360) + 360) % 360) * DEG;
}

// 自转轴（角速度方向）与轨道法线的夹角。
// IAU 极轴的 W 速率为负时，角速度指向极轴反向；这样金星/天王星的逆行自动成立。
export function axisObliquityDeg(cfg, days = 0) {
  const T = days / 36525;
  const pole = equatorialToEcliptic(
    cfg.pole.raDeg + (cfg.pole.raRatePerCentury || 0) * T,
    cfg.pole.decDeg + (cfg.pole.decRatePerCentury || 0) * T,
  );
  const sign = cfg.spin.wRateDegPerDay < 0 ? -1 : 1;
  const axis = { x: pole.x * sign, y: pole.y * sign, z: pole.z * sign };
  // 轨道法线同样按当前历元外推，与 orbit-math.elementsAt 保持一致
  const r = cfg.rates || {};
  const incDeg = cfg.incDeg + (r.incDegPerCentury || 0) * T;
  const nodeDeg = cfg.nodeDeg + (r.nodeDegPerCentury || 0) * T;
  return angularSeparationDeg(axis, orbitNormalEcliptic(incDeg, nodeDeg));
}
