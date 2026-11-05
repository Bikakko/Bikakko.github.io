import test from "node:test";
import assert from "node:assert/strict";
import {
  lightTimeSeconds, frontRadius, lightArrivals, lightSecondsPerAU,
  lightSecondsSince, emissionPlusSeconds, advancedSimDays,
  toLogAxis, fromLogAxis,
  formatClock, formatShort, formatLightTime,
  LOG_AXIS_MIN, LOG_AXIS_MAX, LIGHT_TICKS,
} from "../assets/solar/light-math.js";
import {
  C_KM_S, KM_PER_AU, KM_PER_UNIT, AU_UNIT,
  UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU,
  SECONDS_PER_DAY, TIME_RATES, TIME_RATE_DEFAULT, TIME_RATE_LIGHT,
} from "../assets/solar/config.js";
import { SUN_CFG, PLANETS } from "../assets/solar/bodies.js";
import { orbitalPosition } from "../assets/solar/orbit-math.js";

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

test("光速基准：c 恒定，1 AU 光行时 499.005 秒（8 分 19 秒）", () => {
  assert.equal(C_KM_S, 299792.458);
  assert.ok(close(UNITS_PER_LIGHT_SEC, C_KM_S / KM_PER_UNIT, 1e-12));
  assert.ok(close(LIGHT_SEC_PER_AU, KM_PER_AU / C_KM_S, 1e-9));
  assert.ok(close(lightSecondsPerAU(), 499.005, 0.01));
  assert.ok(close(lightTimeSeconds(AU_UNIT), LIGHT_SEC_PER_AU, 1e-9));
  // 倍率不参与物理换算：距离 → 光行时只由 c 决定
  assert.equal(lightTimeSeconds(AU_UNIT), 1 * KM_PER_AU / C_KM_S);
});

test("3D 光球半径 = 光行时 × 光速，t=0 时不小于日面半径", () => {
  assert.equal(frontRadius(0), SUN_CFG.radius);
  assert.ok(close(frontRadius(LIGHT_SEC_PER_AU), AU_UNIT, 1e-9));
  assert.ok(close(frontRadius(3600), 3600 * UNITS_PER_LIGHT_SEC, 1e-9));
  assert.equal(frontRadius(-10), SUN_CFG.radius);
  assert.ok(frontRadius(15005) > 300, "4 小时后的光球应越过海王星轨道");
});

test("八颗行星在 J2000 的光行时（用瞬时距离，非平均半长轴）", () => {
  const EXPECTED = [232.8, 359.4, 490.7, 694.2, 2478.7, 4577.0, 9941.0, 15028.7];
  const got = lightArrivals(0);
  assert.equal(got.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(got[i].index, i);
    assert.equal(got[i].name, PLANETS[i].name);
    assert.ok(close(got[i].seconds, EXPECTED[i], 1), `${got[i].name} 光行时`);
    const p = orbitalPosition(PLANETS[i], 0, out());
    assert.ok(close(got[i].distance, Math.hypot(p.x, p.y, p.z), 1e-9));
    assert.ok(close(got[i].seconds, got[i].distance / UNITS_PER_LIGHT_SEC, 1e-9));
  }
  for (let i = 1; i < 8; i++) assert.ok(got[i].seconds > got[i - 1].seconds);

  // 偏心率带来的浮动：一世纪后水星更靠近近日点，光行时明显变短
  const next = lightArrivals(36525);
  assert.ok(next[0].seconds < got[0].seconds - 10);
  assert.ok(next[3].seconds > got[3].seconds + 10, "火星更靠近远地点");
});

test("对数标尺：端点、往返与夹取", () => {
  assert.equal(toLogAxis(LOG_AXIS_MIN), 0);
  assert.equal(toLogAxis(LOG_AXIS_MAX), 1);
  assert.equal(toLogAxis(0), 0);
  assert.equal(toLogAxis(-5), 0);
  assert.equal(toLogAxis(NaN), 0);
  assert.equal(toLogAxis(Infinity), 1);
  for (const sec of [60, 193, 499, 3600, 15005, 18000]) {
    assert.ok(close(fromLogAxis(toLogAxis(sec)), sec, 1e-6), `往返 ${sec}`);
  }
  assert.equal(fromLogAxis(-1), LOG_AXIS_MIN);
  assert.equal(fromLogAxis(2), LOG_AXIS_MAX);
  for (const t of LIGHT_TICKS) {
    const v = toLogAxis(t.sec);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("统一时间：单一倍率推进 simTime，光波前与天体由它共同派生", () => {
  const emission = 123.0;
  const t1 = advancedSimDays(emission, 1, 600);
  assert.ok(close(t1 - emission, 600 / SECONDS_PER_DAY, 1e-12));
  assert.equal(advancedSimDays(emission, 0, 600), emission);
  assert.equal(advancedSimDays(emission, -1, 600), emission);

  const sec = lightSecondsSince(t1, emission);
  assert.ok(close(sec, 600, 1e-9));
  assert.ok(close(frontRadius(sec), 600 * UNITS_PER_LIGHT_SEC, 1e-9));

  // 同一个 simTime 也让行星移动（不再冻结）：光走 600 秒，水星也走 600 秒
  const pEmit = orbitalPosition(PLANETS[0], emission, out());
  const pNow = orbitalPosition(PLANETS[0], t1, out());
  assert.ok(Math.hypot(pNow.x - pEmit.x, pNow.y - pEmit.y, pNow.z - pEmit.z) > 0);
});

test("光行时 ↔ 统一时间轴换算：重播与标尺拖动", () => {
  const emission = 10.5;
  for (const sec of [0, 193, 499, 4990, 15005]) {
    const t = emissionPlusSeconds(emission, sec);
    assert.ok(close(lightSecondsSince(t, emission), sec, 1e-6), `往返 ${sec}`);
  }
  assert.equal(lightSecondsSince(emission - 1, emission), 0, "发射前没有波前");
  assert.equal(emissionPlusSeconds(emission, -5), emission);
  // 重播：simTime 回到 emission → 光行时归零，光球回到日面
  assert.equal(lightSecondsSince(emission, emission), 0);
  assert.equal(frontRadius(lightSecondsSince(emission, emission)), SUN_CFG.radius);
});

test("统一倍率表：只有一套，1:1 是真实时间", () => {
  assert.equal(TIME_RATE_DEFAULT, 1);
  assert.equal(TIME_RATES[0], 1);
  assert.equal(TIME_RATE_LIGHT, 600);
  assert.ok(TIME_RATES.includes(600));
  for (let i = 1; i < TIME_RATES.length; i++) {
    assert.ok(TIME_RATES[i] > TIME_RATES[i - 1], "档位严格递增");
  }
  // 1:1 下 1 真实秒推进 1 模拟秒 → 光走 1 光秒（仍小于日面半径，取下限）
  const t = advancedSimDays(0, 1, TIME_RATE_DEFAULT);
  assert.ok(close(lightSecondsSince(t, 0), 1, 1e-9));
  assert.equal(frontRadius(lightSecondsSince(t, 0)), SUN_CFG.radius);
  // 600 秒后光球半径严格等于 c·t
  const t600 = advancedSimDays(0, 600, TIME_RATE_DEFAULT);
  assert.ok(close(frontRadius(lightSecondsSince(t600, 0)), 600 * UNITS_PER_LIGHT_SEC, 1e-9));
  // 1:1 下走过 1 AU 需要 499 秒真实时间
  assert.ok(close(
    lightSecondsSince(advancedSimDays(0, LIGHT_SEC_PER_AU, 1), 0),
    LIGHT_SEC_PER_AU, 1e-6));
  assert.equal(C_KM_S, 299792.458, "倍率不改变 c");
});

test("时间格式化", () => {
  assert.equal(formatClock(0), "00:00:00");
  assert.equal(formatClock(499), "00:08:19");
  assert.equal(formatClock(15005), "04:10:05");
  assert.equal(formatShort(193), "3m13s");
  assert.equal(formatShort(4577), "1h16m");
  assert.equal(formatLightTime(499), "8 分 19 秒");
  assert.equal(formatLightTime(15005), "4 小时 10 分 5 秒");
});
