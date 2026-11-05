import test from "node:test";
import assert from "node:assert/strict";
import { PLANETS, SUN_CFG, MOON_CFG, SATURN_CFG, ringGap } from "../assets/solar/bodies.js";
import { axisObliquityDeg } from "../assets/solar/orientation-math.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

const KM_PER_AU = 149597870.7;
const AU_UNIT = 10.06;

// 权威数据快照（JPL SSD Table 1 J2000 / NSSDCA Fact Sheet / IAU 2015 PCK）
const EXPECTED = {
  "水星": {
    radiusKm: 2439.7, aAU: 0.38709927, e: 0.20563593,
    incDeg: 7.00497902, nodeDeg: 48.33076593,
    varpiDeg: 77.45779628, meanLonDeg: 252.25032350, orbitDays: 87.969,
    obliquity: 0.034, rotationHours: 1407.6, retrograde: false,
  },
  "金星": {
    radiusKm: 6051.8, aAU: 0.72333566, e: 0.00677672,
    incDeg: 3.39467605, nodeDeg: 76.67984255,
    varpiDeg: 131.60246718, meanLonDeg: 181.97909950, orbitDays: 224.701,
    obliquity: 177.362, rotationHours: 5832.5, retrograde: true,
  },
  "地球": {
    radiusKm: 6371.0, aAU: 1.00000261, e: 0.01671123,
    incDeg: -0.00001531, nodeDeg: 0.0,
    varpiDeg: 102.93768193, meanLonDeg: 100.46457166, orbitDays: 365.256,
    obliquity: 23.439, rotationHours: 23.9345, retrograde: false,
  },
  "火星": {
    radiusKm: 3389.5, aAU: 1.52371034, e: 0.09339410,
    incDeg: 1.84969142, nodeDeg: 49.55953891,
    varpiDeg: 336.05637041, meanLonDeg: 355.44656795, orbitDays: 686.98,
    // IAU 2015 极轴；旧 2009 极轴/事实表给的 25.19° 对应旧模型
    obliquity: 23.916, rotationHours: 24.6230, retrograde: false,
  },
  "木星": {
    radiusKm: 69911, aAU: 5.20288700, e: 0.04838624,
    incDeg: 1.30439695, nodeDeg: 100.47390909,
    varpiDeg: 14.72847983, meanLonDeg: 34.39644051, orbitDays: 4332.59,
    obliquity: 3.120, rotationHours: 9.9249, retrograde: false,
  },
  "土星": {
    radiusKm: 58232, aAU: 9.53667594, e: 0.05386179,
    incDeg: 2.48599187, nodeDeg: 113.66242448,
    varpiDeg: 92.59887831, meanLonDeg: 49.95424423, orbitDays: 10759.2,
    obliquity: 26.730, rotationHours: 10.6562, retrograde: false,
  },
  "天王星": {
    radiusKm: 25362, aAU: 19.18916464, e: 0.04725744,
    incDeg: 0.77263783, nodeDeg: 74.01692503,
    varpiDeg: 170.95427630, meanLonDeg: 313.23810451, orbitDays: 30685.4,
    obliquity: 97.770, rotationHours: 17.2400, retrograde: true,
  },
  "海王星": {
    radiusKm: 24622, aAU: 30.06992276, e: 0.00859048,
    incDeg: 1.77004347, nodeDeg: 131.78422574,
    varpiDeg: 44.96476227, meanLonDeg: 304.87997031, orbitDays: 60189.0,
    // IAU 2015 PCK 更新了 W 速率（旧值 536.3128492 对应 16.11 h）
    obliquity: 27.848, rotationHours: 15.9663, retrograde: false,
  },
};

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

test("八大行星的半径与 J2000 轨道要素与权威表一致", () => {
  for (const cfg of PLANETS) {
    const e = EXPECTED[cfg.name];
    assert.ok(e, `缺少 ${cfg.name} 的预期数据`);
    assert.equal(cfg.radiusKm, e.radiusKm, `${cfg.name} 半径`);
    assert.ok(close(cfg.aAU, e.aAU, 1e-8), `${cfg.name} 半长轴`);
    assert.ok(close(cfg.e, e.e, 1e-9), `${cfg.name} 偏心率`);
    assert.ok(close(cfg.incDeg, e.incDeg, 1e-6), `${cfg.name} 轨道倾角`);
    assert.ok(close(cfg.nodeDeg, e.nodeDeg, 1e-6), `${cfg.name} 升交点`);
    assert.ok(close(cfg.varpiDeg, e.varpiDeg, 1e-6), `${cfg.name} 近日点经度`);
    assert.ok(close(cfg.meanLonDeg, e.meanLonDeg, 1e-6), `${cfg.name} 平黄经`);
    assert.ok(close(cfg.orbitDays, e.orbitDays, 1e-3), `${cfg.name} 公转周期`);
    assert.ok(close(cfg.radius, cfg.radiusKm / (KM_PER_AU / AU_UNIT), 1e-12), `${cfg.name} 半径比例`);
    assert.ok(close(cfg.orbit, cfg.aAU * AU_UNIT, 1e-12), `${cfg.name} 轨道比例`);
  }
});

test("IAU 自转速率与方向：恒星周期、逆行标志", () => {
  const all = [...PLANETS, SUN_CFG, MOON_CFG];
  for (const cfg of all) {
    const hours = 360 / Math.abs(cfg.spin.wRateDegPerDay) * 24;
    if (cfg === SUN_CFG) {
      assert.ok(close(hours, 609.12, 0.01), "太阳自转周期");
      assert.ok(cfg.spin.wRateDegPerDay > 0, "太阳顺行");
    } else if (cfg === MOON_CFG) {
      assert.ok(close(hours, 655.72, 0.01), "月球自转周期");
      assert.ok(cfg.spin.wRateDegPerDay > 0, "月球顺行");
    } else {
      const e = EXPECTED[cfg.name];
      assert.ok(Math.abs(hours - e.rotationHours) / e.rotationHours < 0.002, `${cfg.name} 自转周期`);
      assert.equal(cfg.spin.wRateDegPerDay < 0, e.retrograde, `${cfg.name} 自转方向`);
    }
  }
});

test("IAU 极轴相对轨道面的倾角与资料一致", () => {
  for (const cfg of PLANETS) {
    const got = axisObliquityDeg(cfg);
    assert.ok(close(got, EXPECTED[cfg.name].obliquity, 0.01), `${cfg.name} 转轴倾角 ${got}`);
  }
  assert.ok(close(axisObliquityDeg(SUN_CFG), 7.252, 0.01), "太阳相对黄道倾角");
  assert.ok(close(axisObliquityDeg(MOON_CFG), 5.159, 0.01), "月球平均转轴倾角");
  assert.equal(MOON_CFG.obliquityMaxDeg, 6.68);
});

test("所有行星与月球的公转方向均为顺行", () => {
  for (const cfg of [...PLANETS, MOON_CFG]) {
    const a = orbitalPosition(cfg, 0, out());
    const b = orbitalPosition(cfg, 5, out());
    const crossY = a.z * b.x - a.x * b.z;
    assert.ok(crossY > 0, `${cfg.name} 公转方向`);
  }
});

test("地球在 J2000 接近近日点", () => {
  const p = orbitalPosition(PLANETS.find(x => x.name === "地球"), 0, out());
  const rAU = Math.hypot(p.x, p.y, p.z) / AU_UNIT;
  assert.ok(close(rAU, 0.9833, 0.0002), `地球 J2000 日心距 ${rAU} AU`);
});

test("月球平均轨道要素：恒星月、近点月、近远地点、地月质心", () => {
  const rates = MOON_CFG.rates;
  const sidereal = 360 / (rates.meanLonDegPerCentury / 36525);
  const anomalistic = 360 / ((rates.meanLonDegPerCentury - rates.varpiDegPerCentury) / 36525);
  assert.ok(close(sidereal, 27.321582, 1e-6), `恒星月 ${sidereal}`);
  assert.ok(close(anomalistic, 27.554550, 1e-6), `近点月 ${anomalistic}`);

  const aKm = MOON_CFG.aAU * KM_PER_AU;
  assert.ok(close(aKm, 384400, 1), `月球平均距离 ${aKm}`);
  assert.ok(close(aKm * (1 - MOON_CFG.e), 363300, 100), "近地点");
  assert.ok(close(aKm * (1 + MOON_CFG.e), 405500, 100), "远地点");
  assert.ok(close(aKm * MOON_CFG.massRatio, 4670.7, 2), "地月质心偏移");

  // 月球自转周期应与恒星月同步（潮汐锁定）
  const rotationDays = 360 / MOON_CFG.spin.wRateDegPerDay;
  assert.ok(close(rotationDays, sidereal, 0.001), "月球自转与恒星月同步");
});

test("土星环内外缘与卡西尼缝/恩克缝按真实半径放置", () => {
  const ring = SATURN_CFG.ring;
  assert.equal(ring.innerKm, 74658);
  assert.equal(ring.outerKm, 136780);
  assert.equal(ring.cassiniInnerKm, 117580);
  assert.equal(ring.cassiniOuterKm, 122170);
  assert.equal(ring.enckeKm, 133590);

  const t = (km) => (km - ring.innerKm) / (ring.outerKm - ring.innerKm);
  const cassiniMid = (ring.cassiniInnerKm + ring.cassiniOuterKm) / 2;
  assert.ok(ringGap(t(cassiniMid), ring) < 1e-9, "卡西尼缝中心应为空隙");
  assert.ok(ringGap(t(ring.enckeKm), ring) < 1e-9, "恩克缝中心应为空隙");
  assert.equal(ringGap(0.5, ring), 1, "环带中部应完整覆盖");
  assert.ok(ring.gap(t(cassiniMid)) < 1e-9, "ring.gap 与模块数据自洽");
});

test("卫星数是 2026-11 的权威快照", () => {
  const counts = Object.fromEntries(PLANETS.map(p => [p.name, p.moons]));
  assert.deepEqual(
    { 木星: counts["木星"], 土星: counts["土星"], 天王星: counts["天王星"], 海王星: counts["海王星"] },
    { 木星: 115, 土星: 293, 天王星: 29, 海王星: 16 },
  );
  for (const p of PLANETS) {
    if (p.moons > 0) assert.equal(p.moonsAsOf, "2026-11");
  }
});
