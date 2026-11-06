/* ============================================================
   太阳表面物理：临边昏暗 / 米粒组织尺度 / 较差自转
   全部取自权威文献，作为 shader 与测试的单一数据源。
   ============================================================ */

// 太阳半径（km），与 bodies.js SUN_CFG.radiusKm 一致；用于把噪声频率
// 标定到真实 km 尺度（角尺度 = 物理尺度 / 半径）。
export const SOLAR_RADIUS_KM = 695700;

// 临边昏暗：Neckel & Labs (1994, Solar Physics 153, 91) 可见光 550 nm
// 多项式 I(μ)/I(1) = a0 + a1·μ + a2·μ²，Σa = 1。
// μ = cos(视线与表面法线夹角)：日面中心 μ=1，边缘 μ=0。
// 边缘强度比 I(0)/I(1) = a0 = 0.30（边缘约为中心亮度的 30%）。
export const LIMB_DARKENING = { a0: 0.30, a1: 0.93, a2: -0.23 };

export function limbDarkening(mu) {
  const m = Math.max(0, Math.min(1, mu));
  const { a0, a1, a2 } = LIMB_DARKENING;
  return a0 + a1 * m + a2 * m * m;
}

// 米粒组织尺度（km）：米粒 ~1000 km（寿命 8–20 min），
// 超米粒 ~30000 km（寿命 ~24 h）。来源：OpenStax Astronomy 15.1 /
// Las Cumbres Observatory / 维基「米粒组织」。
export const GRANULE_KM = 1000;
export const SUPERGRANULE_KM = 30000;

// 把物理尺度换算成单位球面上的噪声频率（每弧度的特征数 ≈ 半径/尺度）。
// shader 对 normalize(vPos) 采样，频率 = SOLAR_RADIUS_KM / 尺度km。
export function granuleFreq() { return SOLAR_RADIUS_KM / GRANULE_KM; }
export function supergranuleFreq() { return SOLAR_RADIUS_KM / SUPERGRANULE_KM; }

// 较差自转：Snodgrass & Ulrich (1990, ApJ 351, 309) 光球恒星自转
// ω(φ) = A + B·sin²φ + C·sin⁴φ（度/天，φ 为日面纬度）。
// 赤道 φ=0：14.713°/天 → 24.47 天；极区 φ=90°：10.530°/天 → 34.2 天。
export const DIFF_ROTATION = { A: 14.713, B: -2.396, C: -1.787 };

// 刚体平均自转（Carrington 恒星平均，与 bodies.js SUN_CFG.spin 一致）。
// shader 在此刚体 frame 上叠加 (ω_mean − ω(φ))·t 的差速漂移，使表面
// 特征合成出真实的纬度依赖自转：赤道 14.713、极区 10.530°/天。
export const CARRINGTON_DEG_PER_DAY = 14.18440;

export function diffRotationDegPerDay(latDeg) {
  const s = Math.sin(latDeg * Math.PI / 180);
  const s2 = s * s;
  const { A, B, C } = DIFF_ROTATION;
  return A + B * s2 + C * s2 * s2;
}

// 相对刚体 frame 的差速漂移角速度（度/天）：正值表示该纬度比平均转得慢。
export function diffDriftDegPerDay(latDeg) {
  return CARRINGTON_DEG_PER_DAY - diffRotationDegPerDay(latDeg);
}