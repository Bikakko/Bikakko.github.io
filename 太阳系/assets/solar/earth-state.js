/* ============================================================
   日照状态（无 three 依赖，可在 Node 直接测试）

   全部读数都从同一套几何推出：JPL 轨道要素给位置、IAU 要素给姿态，
   太阳在世界原点。不另立「近似公式」，因此面板上的昼夜与屏幕上看到的
   明暗交界必然一致。

   经度约定与 pose.js + SphereGeometry 的贴图一致：东经为正，
   本初子午线在局部 +X，东经 90° 在局部 −Z。
   ============================================================ */
import { DEG, AU_UNIT } from "./config.js";
import { barycenterCorrectedPosition, orbitalPosition } from "./orbit-math.js";
import { poleAt, nodeAt, eclipticToWorld, spinAngleRad } from "./orientation-math.js";
import { PLANETS, MOON_CFG } from "./bodies.js";

const EARTH = PLANETS[2];

/* ---------- 小向量工具（每帧只调用几次，不必复用缓冲） ---------- */
const v3 = (x = 0, y = 0, z = 0) => ({
  x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const norm = (a) => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

export const wrap180 = (deg) => { const d = ((deg + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };
export const wrap360 = (deg) => ((deg % 360) + 360) % 360;
const wrap24 = (h) => ((h % 24) + 24) % 24;

/* ---------- 本体系 ---------- */
export function bodyFrame(cfg, days) {
  const pw = eclipticToWorld(poleAt(cfg, days));
  const nw = eclipticToWorld(nodeAt(cfg, days));
  const pole = norm(v3(pw.x, pw.y, pw.z));
  const node = norm(sub(v3(nw.x, nw.y, nw.z), scale(pole, dot(v3(nw.x, nw.y, nw.z), pole))));
  return { pole, node, third: cross(node, pole), W: spinAngleRad(cfg.spin, days) };
}

// 表面 (纬度, 东经) 处的世界法线
export function surfaceNormal(frame, latDeg, lonDeg) {
  const phi = latDeg * DEG, a = frame.W + lonDeg * DEG;
  const c = Math.cos(phi);
  return add(scale(frame.pole, Math.sin(phi)),
    add(scale(frame.node, c * Math.cos(a)), scale(frame.third, -c * Math.sin(a))));
}

/* ---------- 太阳直射点 ---------- */
export function subsolarPoint(cfg, days) {
  const pos = barycenterCorrectedPosition(cfg, days, v3());
  const toSun = norm(scale(pos, -1));
  const frame = bodyFrame(cfg, days);
  const latDeg = Math.asin(clamp1(dot(toSun, frame.pole))) / DEG;
  const lonDeg = wrap180((Math.atan2(-dot(toSun, frame.third), dot(toSun, frame.node)) - frame.W) / DEG);
  return { latDeg, lonDeg, toSun, frame, pos, distanceAU: Math.hypot(pos.x, pos.y, pos.z) / AU_UNIT };
}

/* ---------- 观测地日照 ---------- */
export function observerSun(cfg, days, latDeg, lonDeg, ss) {
  const s0 = ss || subsolarPoint(cfg, days);
  const f = s0.frame;
  const phi = latDeg * DEG, a = f.W + lonDeg * DEG;
  const up = surfaceNormal(f, latDeg, lonDeg);
  const north = add(scale(f.pole, Math.cos(phi)),
    add(scale(f.node, -Math.sin(phi) * Math.cos(a)), scale(f.third, Math.sin(phi) * Math.sin(a))));
  const east = add(scale(f.node, -Math.sin(a)), scale(f.third, -Math.cos(a)));
  const U = dot(s0.toSun, up), N = dot(s0.toSun, north), E = dot(s0.toSun, east);
  const hourAngleDeg = wrap180(lonDeg - s0.lonDeg);
  // 极点处东西方向退化，方位角没有定义
  const azDeg = Math.hypot(E, N) < 1e-12 ? null : wrap360(Math.atan2(E, N) / DEG);
  return {
    elevationDeg: Math.asin(clamp1(U)) / DEG,
    azimuthDeg: azDeg,
    hourAngleDeg,
    apparentSolarHours: wrap24(12 + hourAngleDeg / 15),
    isDay: U > 0,
  };
}

/* ---------- 太阳视黄经与季节 ----------
   几何黄经（J2000 黄道）→ 加岁差换到当日分点 → 加章动 → 减光行差。
   少了岁差项，2026 年的春分时刻会偏掉约 9 小时。 */
export function sunApparentLongitude(days, earthPos) {
  const pos = earthPos || barycenterCorrectedPosition(EARTH, days, v3());
  const T = days / 36525;
  // world(x,y,z) → 黄道(x,−z,y)；太阳方向 = −地球位置
  const geo = wrap360(Math.atan2(pos.z, -pos.x) / DEG);
  const precession = (5028.796195 * T + 1.1054348 * T * T) / 3600;
  const om = (125.04452 - 1934.136261 * T) * DEG;
  const ls = (280.4665 + 36000.7698 * T) * DEG;
  const lm = (218.3165 + 481267.8813 * T) * DEG;
  const nutation = (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * ls)
    - 0.23 * Math.sin(2 * lm) + 0.21 * Math.sin(2 * om)) / 3600;
  const rAU = Math.hypot(pos.x, pos.y, pos.z) / AU_UNIT;
  const aberration = -20.49552 / 3600 / rAU;
  return wrap360(geo + precession + nutation + aberration);
}

const SEASONS_N = ["春", "夏", "秋", "冬"];
const TERMS = [
  [0, "春分"], [90, "夏至"], [180, "秋分"], [270, "冬至"],
];

export function seasonOf(sunLonDeg) {
  const i = Math.floor(wrap360(sunLonDeg) / 90);
  const toNext = wrap360(TERMS[(i + 1) % 4][0] - wrap360(sunLonDeg));
  return {
    north: SEASONS_N[i],
    south: SEASONS_N[(i + 2) % 4],
    sunLonDeg: wrap360(sunLonDeg),
    // 同一个黄经在南北半球是相反的季节，节气名也要跟着换：
    // 北半球的夏至就是南半球的冬至
    nextTermN: TERMS[(i + 1) % 4][1],
    nextTermS: TERMS[(i + 3) % 4][1],
    // 太阳沿黄经约 0.9856°/天
    daysToNextTerm: toNext / 0.9856,
  };
}

/* ---------- 日出 / 日落 ----------
   地平线取 −0.833°：大气折射 34′ + 太阳视半径 16′。
   λ_s 以约 −15°/小时 变化，解 λ_s(t)=目标经度 的定点迭代收缩率约 3e-3。 */
export const HORIZON_DEG = -0.833;

function solveLongitude(days, targetLonDeg, iterations = 5) {
  let t = days;
  for (let i = 0; i < iterations; i++) {
    t += wrap180(subsolarPoint(EARTH, t).lonDeg - targetLonDeg) / 15 / 24;
  }
  return t;
}

function hourAngleLimit(latDeg, decDeg) {
  const phi = latDeg * DEG, dec = decDeg * DEG;
  const denom = Math.cos(phi) * Math.cos(dec);
  if (Math.abs(denom) < 1e-12) return null;
  return (Math.sin(HORIZON_DEG * DEG) - Math.sin(phi) * Math.sin(dec)) / denom;
}

export function sunEvents(days, latDeg, lonDeg) {
  const noonDays = solveLongitude(days, lonDeg);
  let dec = subsolarPoint(EARTH, noonDays).latDeg;
  let cosH = hourAngleLimit(latDeg, dec);
  if (cosH === null || cosH <= -1) return { polar: "day", noonDays, sunriseDays: null, sunsetDays: null, dayLengthHours: 24 };
  if (cosH >= 1) return { polar: "night", noonDays, sunriseDays: null, sunsetDays: null, dayLengthHours: 0 };

  let H0 = Math.acos(clamp1(cosH)) / DEG;
  let rise = noonDays - H0 / 15 / 24, set = noonDays + H0 / 15 / 24;
  // δ 在半天里会变，用各自时刻的 δ 再解一轮
  for (let i = 0; i < 2; i++) {
    const decR = subsolarPoint(EARTH, rise).latDeg;
    const decS = subsolarPoint(EARTH, set).latDeg;
    const cR = hourAngleLimit(latDeg, decR), cS = hourAngleLimit(latDeg, decS);
    if (cR === null || cS === null || cR <= -1 || cS <= -1) {
      return { polar: "day", noonDays, sunriseDays: null, sunsetDays: null, dayLengthHours: 24 };
    }
    if (cR >= 1 || cS >= 1) {
      return { polar: "night", noonDays, sunriseDays: null, sunsetDays: null, dayLengthHours: 0 };
    }
    rise = solveLongitude(rise, wrap180(lonDeg + Math.acos(clamp1(cR)) / DEG));
    set = solveLongitude(set, wrap180(lonDeg - Math.acos(clamp1(cS)) / DEG));
  }
  return {
    polar: null, noonDays, sunriseDays: rise, sunsetDays: set,
    dayLengthHours: (set - rise) * 24,
  };
}

/* ---------- 时差与真太阳时 ----------
   真太阳时 = 12h + 时角/15；平太阳时 = UTC 小时 + 经度/15。
   两者之差即时差，直接由直射经度得出，不再另套经验公式。 */
export function equationOfTimeMinutes(days, utcHours, subsolarLonDeg) {
  const raw = 12 - utcHours - subsolarLonDeg / 15;
  return (((raw + 12) % 24 + 24) % 24 - 12) * 60;
}

/* ---------- 月相 ---------- */
const PHASE_NAMES = ["新月", "娥眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"];

export function moonPhase(days) {
  const earth = barycenterCorrectedPosition(EARTH, days, v3());
  const moon = orbitalPosition(MOON_CFG, days, v3());
  const toSun = norm(scale(earth, -1));
  const toMoon = norm(moon);
  const elong = Math.acos(clamp1(dot(toSun, toMoon))) / DEG;
  const sunLon = wrap360(Math.atan2(earth.z, -earth.x) / DEG);
  const moonLon = wrap360(Math.atan2(-moon.z, moon.x) / DEG);
  const age = wrap360(moonLon - sunLon);
  return {
    illuminated: (1 - Math.cos(elong * DEG)) / 2,
    elongationDeg: elong,
    waxing: age < 180,
    name: PHASE_NAMES[Math.floor(wrap360(age + 22.5) / 45) % 8],
    ageDeg: age,
  };
}

/* ---------- 行星概览 ---------- */
export function planetOverview(days) {
  return PLANETS.map((cfg) => {
    const ss = subsolarPoint(cfg, days);
    // 日心黄经：world(x,y,z) → 黄道(x,−z,y)
    const lon = wrap360(Math.atan2(-ss.pos.z, ss.pos.x) / DEG);
    return {
      name: cfg.name,
      helioLonDeg: lon,
      distanceAU: ss.distanceAU,
      subsolarLatDeg: ss.latDeg,
      season: seasonOf(wrap360(lon + 180)),
    };
  });
}

export function earthState(days, latDeg, lonDeg, utcHours) {
  const ss = subsolarPoint(EARTH, days);
  const sun = observerSun(EARTH, days, latDeg, lonDeg, ss);
  const sunLon = sunApparentLongitude(days, ss.pos);
  return {
    subsolar: ss,
    sun,
    season: seasonOf(sunLon),
    events: sunEvents(days, latDeg, lonDeg),
    equationOfTimeMinutes: equationOfTimeMinutes(days, utcHours, ss.lonDeg),
    moon: moonPhase(days),
  };
}

export { EARTH as EARTH_CFG };