/* ============================================================
   太阳系 · Solar · 配置
   查询参数、比例基准、行星数据（J2000 历元）
   ============================================================ */

/* ---------- 查询参数：让每个状态可截图 ---------- */
export const Q = new URLSearchParams(location.search);
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
export const SUN_RADIUS   = kmToUnit(695700);
export const TAU          = Math.PI * 2;
export const DEG          = Math.PI / 180;

/* ============================================================
   行星数据
   数据来源：JPL SSD Approximate Positions of the Planets（Table 1，
   历元 J2000，标称适用 1800–2050；不含长期项，±50 年方向误差 ≤0.33°）
   与 NASA NSSDCA Planetary Fact Sheet。
     radiusKm  平均半径（km）
     aAU       半长轴（AU）
     e         偏心率
     incDeg    轨道倾角（黄道面为基准）
     nodeDeg   升交点黄经 Ω
     varpiDeg  近日点黄经 ϖ
     meanLonDeg 平黄经 L（J2000）
     tiltDeg   自转轴倾角（>90° 即逆行，无需再取负）
     spinHours 恒星自转周期（小时，正数；逆行由倾角表达）
     moons     卫星数（截至 2026-03，来源 IAU MPC，属快变字段）
   已知简化：所有行星极轴方位角统一指向同一世界方向（非真实指向，
   自作方位会改变季节相位）；行星按球体渲染，未建模扁率。
   半径与轨道距离共用同一个 KM_PER_UNIT，不再做视觉压缩。
   ============================================================ */
export const PLANETS = [
  {
    name: "水星", type: "类地行星",
    radiusKm: 2439.7, aAU: 0.38709927, e: 0.20563593,
    incDeg: 7.00497902, nodeDeg: 48.33076593, varpiDeg: 77.45779628, meanLonDeg: 252.25032350,
    tiltDeg: 0.034, moons: 0, spinHours: 1407.6, orbitDays: 87.969,
    colorA: 0x9a8f85, colorB: 0x5c524a, colorC: 0xc9bdb0,
    noiseFreq: 9.0, bandAmp: 0.0,
  },
  {
    name: "金星", type: "类地行星",
    radiusKm: 6051.8, aAU: 0.72333566, e: 0.00677672,
    incDeg: 3.39467605, nodeDeg: 76.67984255, varpiDeg: 131.60246718, meanLonDeg: 181.97909950,
    tiltDeg: 177.36, moons: 0, spinHours: 5832.5, orbitDays: 224.701,
    colorA: 0xe8c98a, colorB: 0xb08a4c, colorC: 0xfff0c4,
    noiseFreq: 4.4, bandAmp: 0.55,
  },
  {
    name: "地球", type: "类地行星",
    radiusKm: 6371.0, aAU: 1.00000261, e: 0.01671123,
    incDeg: 0.0, nodeDeg: 0.0, varpiDeg: 102.93768193, meanLonDeg: 100.46457166,
    tiltDeg: 23.44, moons: 1, spinHours: 23.934, orbitDays: 365.256,
    colorA: 0x2f6fa8, colorB: 0x2e7a3e, colorC: 0xf2f6ff,
    noiseFreq: 3.6, bandAmp: 0.0,
    earthLike: true,
  },
  {
    name: "火星", type: "类地行星",
    radiusKm: 3389.5, aAU: 1.52371034, e: 0.09339410,
    incDeg: 1.84969142, nodeDeg: 49.55953891, varpiDeg: 336.05637041, meanLonDeg: 355.44656795,
    tiltDeg: 25.19, moons: 2, spinHours: 24.623, orbitDays: 686.98,
    colorA: 0xb5573a, colorB: 0x7d3a26, colorC: 0xe8b08c,
    noiseFreq: 6.0, bandAmp: 0.0,
  },
  {
    name: "木星", type: "气态巨行星",
    radiusKm: 69911, aAU: 5.20288700, e: 0.04838624,
    incDeg: 1.30439695, nodeDeg: 100.47390909, varpiDeg: 14.72847983, meanLonDeg: 34.39644051,
    tiltDeg: 3.13, moons: 101, spinHours: 9.925, orbitDays: 4332.59,
    colorA: 0xd8b98c, colorB: 0x8a6844, colorC: 0xf0e2c8,
    noiseFreq: 2.6, bandAmp: 1.0,
  },
  {
    name: "土星", type: "气态巨行星",
    radiusKm: 58232, aAU: 9.53667594, e: 0.05386179,
    incDeg: 2.48599187, nodeDeg: 113.66242448, varpiDeg: 92.59887831, meanLonDeg: 49.95424423,
    tiltDeg: 26.73, moons: 285, spinHours: 10.656, orbitDays: 10759.2,
    colorA: 0xe3cf9e, colorB: 0xb59a68, colorC: 0xfaf0d2,
    noiseFreq: 2.8, bandAmp: 0.85,
    ring: true,
  },
  {
    name: "天王星", type: "冰巨星",
    radiusKm: 25362, aAU: 19.18916464, e: 0.04725744,
    incDeg: 0.77263783, nodeDeg: 74.01692503, varpiDeg: 170.95427630, meanLonDeg: 313.23810451,
    tiltDeg: 97.77, moons: 29, spinHours: 17.24, orbitDays: 30685.4,
    colorA: 0x8fd8e0, colorB: 0x5aa6b4, colorC: 0xc8f0f4,
    noiseFreq: 3.2, bandAmp: 0.25,
  },
  {
    name: "海王星", type: "冰巨星",
    radiusKm: 24622, aAU: 30.06992276, e: 0.00859048,
    incDeg: 1.77004347, nodeDeg: 131.78422574, varpiDeg: 44.96476227, meanLonDeg: 304.87997031,
    tiltDeg: 28.32, moons: 16, spinHours: 16.11, orbitDays: 60189.0,
    colorA: 0x3d5fc4, colorB: 0x24397e, colorC: 0x8fa8f0,
    noiseFreq: 3.4, bandAmp: 0.2,
  },
];

// 派生量：世界单位下的半径、半长轴、轴倾角和调试相位
for (const cfg of PLANETS) {
  cfg.radius = kmToUnit(cfg.radiusKm);
  cfg.orbit = AU_TO_UNIT(cfg.aAU);
  cfg.tilt = cfg.tiltDeg * DEG;
  cfg.mAnomalyBias = 0;
}

// 太阳也按「天体」参与点选、推拉与信息卡，字段与行星同构；
// 距离/偏心率等不适用项用 *Label 覆盖显示
export const SUN_CFG = {
  name: "太阳", type: "恒星",
  radiusKm: 695700,
  aAU: 0, e: 0, incDeg: 0,
  moons: 0, spinHours: 609.12, orbitDays: 0,
  colorA: 0xffd9a0,
  desc: "—",
  periodLabel: "—", eccLabel: "—", incLabel: "—",
};
SUN_CFG.radius = SUN_RADIUS;

// 地月卫星：位置由 Earth 门下的 moonPivot 按开普勒方程驱动（含 e=0.0549 的椭圆），
// 这份数据用于聚焦、信息卡与光点。node/varpi/meanLon 为占位值（历元相位任意），
// 近地点/交点进动与 6.68° 轴倾角按视觉简化处理。
export const MOON_CFG = {
  name: "月球", type: "卫星",
  radiusKm: 1737.4,
  aAU: 384400 / 149597870.7,
  e: 0.0549, incDeg: 5.145,
  nodeDeg: 0, varpiDeg: 0, meanLonDeg: 0,
  tiltDeg: 6.68, moons: 0, spinHours: 655.7, orbitDays: 27.321661,
  colorA: 0xb8b4ac, colorB: 0x8a8782, colorC: 0xe0ddd6,
  noiseFreq: 6.0, bandAmp: 0.0,
  desc: "384,400 km",
};
MOON_CFG.radius = kmToUnit(MOON_CFG.radiusKm);
MOON_CFG.tilt = MOON_CFG.tiltDeg * DEG;
