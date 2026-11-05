/* ============================================================
   自转/极轴数学（无 three 依赖，可在 Node 直接测试）
   - IAU 极轴：赤道 J2000 的 RA/Dec（含每世纪线性项）
   - 自转角 W：W0 + Ẇ·d + Ẅ·d²
   - 世界坐标约定：黄道 (x, y, z) → (x, z, -y)
   ============================================================ */
import { DEG } from "./config.js";

// J2000 黄赤交角（IAU 2006/1980 常用值）
const ECLIPTIC_OBLIQUITY_DEG = 23.4392911;

export function poleEquatorialToEcliptic(raDeg, decDeg) {
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
  return poleEquatorialToEcliptic(ra, dec);
}

// 自转角：先按周期取模，避免极大 simTime 乘速率后溢出
export function spinAngleRad(spin, days) {
  const rate = spin.wRateDegPerDay;
  if (!Number.isFinite(rate) || rate === 0) return (spin.w0Deg || 0) * DEG;
  const period = 360 / Math.abs(rate);
  let d = days % period;
  if (d < 0) d += period;
  const deg = (spin.w0Deg || 0) + rate * d + (spin.wRate2DegPerDay2 || 0) * d * d;
  return deg * DEG;
}

// 自转轴（角速度方向）与轨道法线的夹角。
// IAU 极轴的 W 速率为负时，角速度指向极轴反向；这样金星/天王星的逆行自动成立。
export function axisObliquityDeg(cfg, days = 0) {
  const T = days / 36525;
  const pole = poleEquatorialToEcliptic(
    cfg.pole.raDeg + (cfg.pole.raRatePerCentury || 0) * T,
    cfg.pole.decDeg + (cfg.pole.decRatePerCentury || 0) * T,
  );
  const sign = cfg.spin.wRateDegPerDay < 0 ? -1 : 1;
  const axis = { x: pole.x * sign, y: pole.y * sign, z: pole.z * sign };
  return angularSeparationDeg(axis, orbitNormalEcliptic(cfg.incDeg, cfg.nodeDeg));
}
