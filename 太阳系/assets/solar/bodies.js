/* ============================================================
   太阳系 · 天体数据
   一个文件内按天体分段，每段只描述自己的半径、轨道、IAU 极轴/
   自转、表面参数与专属特征；段与段之间不互相依赖。

   数据来源：
   - 轨道：JPL SSD Approximate Positions of the Planets, Table 1（J2000）
   - 半径/卫星数：NSSDCA Planetary Fact Sheets（卫星数为 2026-11 JPL 快照）
   - 自转：IAU WGCCRE 2015 / NAIF pck00011.tpc
     （太阳 BODY10，行星 BODY199..BODY899，月球 BODY301 为 2009 IAU 值）
   ============================================================ */
import { kmToUnit, AU_TO_UNIT, KM_PER_AU } from "./config.js";

const defineBody = (data) => ({
  ...data,
  radius: kmToUnit(data.radiusKm),
  orbit: AU_TO_UNIT(data.aAU),
  mAnomalyBias: 0,
});

/* ============================================================
   太阳
   半径 695,700 km；IAU 极轴 286.13°/63.87°，W0 84.176°，
   Ẇ 14.18440°/天（25.38 天，Carrington 平均，未建模纬度差异）
   相对黄道法线 7.252°
   ============================================================ */
const SUN = defineBody({
  name: "太阳", type: "恒星",
  radiusKm: 695700,
  aAU: 0, e: 0, incDeg: 0, nodeDeg: 0, varpiDeg: 0, meanLonDeg: 0, orbitDays: 0,

  pole: {
    raDeg: 286.13, decDeg: 63.87,
    raRatePerCentury: 0, decRatePerCentury: 0,
  },
  spin: { w0Deg: 84.176, wRateDegPerDay: 14.18440 },
  obliquityDeg: 7.252,

  moons: 0,
  colorA: 0xffd9a0,
  desc: "—", periodLabel: "—", eccLabel: "—", incLabel: "—",

  // 光晕属于视觉层，不属于真实比例；参数留在太阳段内
  corona: {
    radii: [1.75, 2.90, 4.20],
    opacities: [0.58, 0.30, 0.14],
    colors: [0xff9a3c, 0xffcf80, 0xffe0a8],
  },
});

/* ============================================================
   水星
   2,439.7 km；J2000 六根数见下；恒星自转 1407.5 h；
   相对轨道面 0.034°，顺行
   ============================================================ */
const MERCURY = defineBody({
  name: "水星", type: "类地行星",
  radiusKm: 2439.7,

  aAU: 0.38709927, e: 0.20563593,
  incDeg: 7.00497902, nodeDeg: 48.33076593,
  varpiDeg: 77.45779628, meanLonDeg: 252.25032350,
  orbitDays: 87.969,

  pole: {
    raDeg: 281.0103, decDeg: 61.4155,
    raRatePerCentury: -0.0328, decRatePerCentury: -0.0049,
  },
  spin: { w0Deg: 329.5988, wRateDegPerDay: 6.1385108 },
  obliquityDeg: 0.034,

  moons: 0, moonsAsOf: "2026-11",
  colorA: 0x9a8f85, colorB: 0x5c524a, colorC: 0xc9bdb0,
  noiseFreq: 9.0, bandAmp: 0.0,
});

/* ============================================================
   金星
   6,051.8 km；恒星自转 5832.44 h（逆行，Ẇ 为负）；
   相对轨道面 177.362°
   ============================================================ */
const VENUS = defineBody({
  name: "金星", type: "类地行星",
  radiusKm: 6051.8,

  aAU: 0.72333566, e: 0.00677672,
  incDeg: 3.39467605, nodeDeg: 76.67984255,
  varpiDeg: 131.60246718, meanLonDeg: 181.97909950,
  orbitDays: 224.701,

  pole: {
    raDeg: 272.76, decDeg: 67.16,
    raRatePerCentury: 0, decRatePerCentury: 0,
  },
  spin: { w0Deg: 160.20, wRateDegPerDay: -1.4813688 },
  obliquityDeg: 177.362,

  moons: 0, moonsAsOf: "2026-11",
  colorA: 0xe8c98a, colorB: 0xb08a4c, colorC: 0xfff0c4,
  noiseFreq: 4.4, bandAmp: 0.55,
});

/* ============================================================
   月球
   1,737.4 km；a 384,400 km，e 0.0549，i 5.145°
   平均要素（J2000 + 每世纪速率）：
     L = 218.3164477° + 481267.88123421°/cy  → 恒星月 27.321582 d
     ϖ =  83.3532465° +   4069.0137287°/cy   → 近点月 27.554550 d
     Ω = 125.0445479° -   1934.1362891°/cy   → 交点退行 18.61 年
   自转 W0 38.3213°，Ẇ 13.17635815°/天（655.72 h，潮汐锁定）；
   平均极轴相对 J2000 轨道面 5.159°，含天平动的最大倾角 6.68°。
   未建模太阳摄动引起的高频摄动/物理天平动。
   ============================================================ */
const MOON = defineBody({
  name: "月球", type: "卫星",
  radiusKm: 1737.4,

  aAU: 384400 / KM_PER_AU, e: 0.0549,
  incDeg: 5.145, nodeDeg: 125.0445479,
  varpiDeg: 83.3532465, meanLonDeg: 218.3164477,
  orbitDays: 27.321661,
  rates: {
    meanLonDegPerCentury: 481267.88123421,
    varpiDegPerCentury: 4069.0137287,
    nodeDegPerCentury: -1934.1362891,
  },

  // m_moon/(m_earth+m_moon)，用于地月质心
  massRatio: 1 / 82.30056,

  pole: {
    raDeg: 269.9949, decDeg: 66.5392,
    raRatePerCentury: 0.0031, decRatePerCentury: 0.0130,
  },
  spin: {
    w0Deg: 38.3213, wRateDegPerDay: 13.17635815,
    wRate2DegPerDay2: -1.4e-12,
  },
  obliquityDeg: 5.159,
  obliquityMaxDeg: 6.68,

  moons: 0, moonsAsOf: "2026-11",
  desc: "384,400 km",
  colorA: 0xb8b4ac,
  material: "standard",
});

/* ============================================================
   地球（含月球系统）
   6,371.0 km；JPL 行是地月质心（EM Bary），地球本体按质量比
   从质心扣回，偏移 4,670.7 km。
   W0 190.147°，Ẇ 360.9856235°/天（23.9345 h）；极轴 RA 0°/Dec 90°，
   岁差 -0.641°/-0.557° 每世纪；相对轨道面 23.439°，顺行。
   ============================================================ */
const EARTH = defineBody({
  name: "地球", type: "类地行星",
  radiusKm: 6371.0,

  aAU: 1.00000261, e: 0.01671123,
  incDeg: -0.00001531, nodeDeg: 0.0,
  varpiDeg: 102.93768193, meanLonDeg: 100.46457166,
  orbitDays: 365.256,

  pole: {
    raDeg: 0.0, decDeg: 90.0,
    raRatePerCentury: -0.641, decRatePerCentury: -0.557,
  },
  spin: { w0Deg: 190.147, wRateDegPerDay: 360.9856235 },
  obliquityDeg: 23.439,

  moons: 1, moonsAsOf: "2026-11",
  colorA: 0x2f6fa8, colorB: 0x2e7a3e, colorC: 0xf2f6ff,
  noiseFreq: 3.6, bandAmp: 0.0,
  earthLike: true,

  satellites: [MOON],
});

/* ============================================================
   火星
   3,389.5 km；恒星自转 24.623 h；
   IAU 2015 极轴 317.269202°/54.432516°，相对 J2000 轨道面 23.916°。
   注意：NSSDCA 旧事实表的 25.19° 对应 2009 旧极轴。
   ============================================================ */
const MARS = defineBody({
  name: "火星", type: "类地行星",
  radiusKm: 3389.5,

  aAU: 1.52371034, e: 0.09339410,
  incDeg: 1.84969142, nodeDeg: 49.55953891,
  varpiDeg: 336.05637041, meanLonDeg: 355.44656795,
  orbitDays: 686.98,

  pole: {
    raDeg: 317.269202, decDeg: 54.432516,
    raRatePerCentury: -0.10927547, decRatePerCentury: -0.05827105,
  },
  spin: { w0Deg: 176.049863, wRateDegPerDay: 350.891982443297 },
  obliquityDeg: 23.916,

  moons: 2, moonsAsOf: "2026-11",
  colorA: 0xb5573a, colorB: 0x7d3a26, colorC: 0xe8b08c,
  noiseFreq: 6.0, bandAmp: 0.0,
});

/* ============================================================
   木星
   69,911 km；恒星自转 9.925 h（System III）；
   相对轨道面 3.120°，顺行；115 颗卫星（2026-11）
   ============================================================ */
const JUPITER = defineBody({
  name: "木星", type: "气态巨行星",
  radiusKm: 69911,

  aAU: 5.20288700, e: 0.04838624,
  incDeg: 1.30439695, nodeDeg: 100.47390909,
  varpiDeg: 14.72847983, meanLonDeg: 34.39644051,
  orbitDays: 4332.59,

  pole: {
    raDeg: 268.056595, decDeg: 64.495303,
    raRatePerCentury: -0.006499, decRatePerCentury: 0.002413,
  },
  spin: { w0Deg: 284.95, wRateDegPerDay: 870.5360000 },
  obliquityDeg: 3.120,

  moons: 115, moonsAsOf: "2026-11",
  colorA: 0xd8b98c, colorB: 0x8a6844, colorC: 0xf0e2c8,
  noiseFreq: 2.6, bandAmp: 1.0,
});

/* ============================================================
   土星
   58,232 km；恒星自转 10.656 h（System III）；
   相对轨道面 26.730°，顺行；293 颗卫星（2026-11）
   环：C 内缘 74,658 km 至 A 外缘 136,780 km；
       卡西尼缝 117,580–122,170 km；恩克缝约 133,590 km。
       环内明暗为程序化纹理，主要缝隙按真实半径放置。
   ============================================================ */
const SATURN = defineBody({
  name: "土星", type: "气态巨行星",
  radiusKm: 58232,

  aAU: 9.53667594, e: 0.05386179,
  incDeg: 2.48599187, nodeDeg: 113.66242448,
  varpiDeg: 92.59887831, meanLonDeg: 49.95424423,
  orbitDays: 10759.2,

  pole: {
    raDeg: 40.589, decDeg: 83.537,
    raRatePerCentury: -0.036, decRatePerCentury: -0.004,
  },
  spin: { w0Deg: 38.90, wRateDegPerDay: 810.7939024 },
  obliquityDeg: 26.730,

  moons: 293, moonsAsOf: "2026-11",
  colorA: 0xe3cf9e, colorB: 0xb59a68, colorC: 0xfaf0d2,
  noiseFreq: 2.8, bandAmp: 0.85,

  ring: {
    innerKm: 74658,
    outerKm: 136780,
    cassiniInnerKm: 117580,
    cassiniOuterKm: 122170,
    enckeKm: 133590,
    enckeHalfWidth: 0.0025,
    gap(t) { return ringGap(t, this); },
  },
});

// 环带剖面：t 为归一化半径（0 = 内缘，1 = 外缘）。
// 返回 0 表示缝隙中心，1 表示完全覆盖；缝隙位置由真实半径换算。
export function ringGap(t, ring) {
  const span = ring.outerKm - ring.innerKm;
  const c0 = (ring.cassiniInnerKm - ring.innerKm) / span;
  const c1 = (ring.cassiniOuterKm - ring.innerKm) / span;
  const encke = (ring.enckeKm - ring.innerKm) / span;
  const mid = (c0 + c1) / 2;
  const half = (c1 - c0) / 2;
  return Math.min(
    1,
    Math.abs(t - mid) / half,
    Math.abs(t - encke) / ring.enckeHalfWidth,
  );
}

/* ============================================================
   天王星
   25,362 km；恒星自转 17.24 h（逆行，Ẇ 为负）；
   相对轨道面 97.770°；29 颗卫星（2026-11）
   ============================================================ */
const URANUS = defineBody({
  name: "天王星", type: "冰巨星",
  radiusKm: 25362,

  aAU: 19.18916464, e: 0.04725744,
  incDeg: 0.77263783, nodeDeg: 74.01692503,
  varpiDeg: 170.95427630, meanLonDeg: 313.23810451,
  orbitDays: 30685.4,

  pole: {
    raDeg: 257.311, decDeg: -15.175,
    raRatePerCentury: 0, decRatePerCentury: 0,
  },
  spin: { w0Deg: 203.81, wRateDegPerDay: -501.1600928 },
  obliquityDeg: 97.770,

  moons: 29, moonsAsOf: "2026-11",
  colorA: 0x8fd8e0, colorB: 0x5aa6b4, colorC: 0xc8f0f4,
  noiseFreq: 3.2, bandAmp: 0.25,
});

/* ============================================================
   海王星
   24,622 km；IAU 2015 自转 15.966 h（旧事实表 16.11 h）；
   极轴 299.36°/43.46°，相对 J2000 轨道面 27.848°
   （旧事实表 28.32°）；16 颗卫星（2026-11）
   ============================================================ */
const NEPTUNE = defineBody({
  name: "海王星", type: "冰巨星",
  radiusKm: 24622,

  aAU: 30.06992276, e: 0.00859048,
  incDeg: 1.77004347, nodeDeg: 131.78422574,
  varpiDeg: 44.96476227, meanLonDeg: 304.87997031,
  orbitDays: 60189.0,

  pole: {
    raDeg: 299.36, decDeg: 43.46,
    raRatePerCentury: 0, decRatePerCentury: 0,
  },
  spin: { w0Deg: 249.978, wRateDegPerDay: 541.1397757 },
  obliquityDeg: 27.848,

  moons: 16, moonsAsOf: "2026-11",
  colorA: 0x3d5fc4, colorB: 0x24397e, colorC: 0x8fa8f0,
  noiseFreq: 3.4, bandAmp: 0.2,
});

export const SUN_CFG = SUN;
export const MOON_CFG = MOON;
export const SATURN_CFG = SATURN;
export const PLANETS = [MERCURY, VENUS, EARTH, MARS, JUPITER, SATURN, URANUS, NEPTUNE];
