import test from "node:test";
import assert from "node:assert/strict";
import {
  lightTimeSeconds, frontRadius, lightArrivals, lightSecondsPerAU,
  lightSecondsSince, emissionPlusSeconds, advancedSimDays, pulseRadii,
  toLogAxis, fromLogAxis,
  formatClock, formatShort, formatLightTime,
  LOG_AXIS_MIN, LOG_AXIS_MAX, LIGHT_TICKS,
} from "../assets/solar/light-math.js";
import {
  C_KM_S, KM_PER_AU, KM_PER_UNIT, AU_UNIT,
  UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU,
  SECONDS_PER_DAY, TIME_RATES, TIME_RATE_DEFAULT,
  PULSE_EVERY_REAL_SEC, MAX_PULSES, PULSE_FALLBACK_SEC,
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
  assert.equal(lightTimeSeconds(AU_UNIT), 1 * KM_PER_AU / C_KM_S);
});

test("3D 光球半径 = 光行时 × 光速，t=0 时不小于日面半径", () => {
  assert.equal(frontRadius(0), SUN_CFG.radius);
  assert.ok(close(frontRadius(LIGHT_SEC_PER_AU), AU_UNIT, 1e-9));
  assert.ok(close(frontRadius(3600), 3600 * UNITS_PER_LIGHT_SEC, 1e-9));
  assert.equal(frontRadius(-10), SUN_CFG.radius);
  assert.ok(frontRadius(15005) > 300);
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
  const next = lightArrivals(36525);
  assert.ok(next[0].seconds < got[0].seconds - 10);
  assert.ok(next[3].seconds > got[3].seconds + 10);
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
  assert.equal(lightSecondsSince(emission - 1, emission), 0);
  assert.equal(emissionPlusSeconds(emission, -5), emission);
  assert.equal(lightSecondsSince(emission, emission), 0);
  assert.equal(frontRadius(lightSecondsSince(emission, emission)), SUN_CFG.radius);
});

test("统一倍率表：只有一套，默认 1:1 真实时间", () => {
  assert.equal(TIME_RATE_DEFAULT, 1);
  assert.equal(TIME_RATES[0], 1);
  assert.ok(TIME_RATES.includes(600));
  for (let i = 1; i < TIME_RATES.length; i++) {
    assert.ok(TIME_RATES[i] > TIME_RATES[i - 1]);
  }
  const t = advancedSimDays(0, 1, TIME_RATE_DEFAULT);
  assert.ok(close(lightSecondsSince(t, 0), 1, 1e-9));
  assert.equal(frontRadius(lightSecondsSince(t, 0)), SUN_CFG.radius);
  const t600 = advancedSimDays(0, 600, TIME_RATE_DEFAULT);
  assert.ok(close(frontRadius(lightSecondsSince(t600, 0)), 600 * UNITS_PER_LIGHT_SEC, 1e-9));
  assert.ok(close(
    lightSecondsSince(advancedSimDays(0, LIGHT_SEC_PER_AU, 1), 0),
    LIGHT_SEC_PER_AU, 1e-6));
  assert.equal(C_KM_S, 299792.458);
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

test("脉冲序列：每个脉冲持续膨胀，半径铺满 0..主波前", () => {
  const step = 600;
  assert.equal(PULSE_EVERY_REAL_SEC, 1);
  assert.equal(MAX_PULSES, 32);

  // 还没发出第二个脉冲：只有主波前
  assert.deepEqual(pulseRadii(0, step), [frontRadius(0)]);
  assert.deepEqual(pulseRadii(300, step), [frontRadius(300)]);
  assert.deepEqual(pulseRadii(599, step), [frontRadius(599)]);

  // 第二次脉冲：主波前 + 刚发出的新球
  const two = pulseRadii(600, step);
  assert.equal(two.length, 2);
  assert.ok(close(two[0], frontRadius(600), 1e-9));
  assert.equal(two[1], frontRadius(0));

  // 到海王星：所有脉冲都保留，半径从主波前一路递减到接近 0。
  // 后续脉冲已长得接近初始光球，不再只有一小部分大。
  const all = pulseRadii(15005, step);
  assert.equal(all.length, Math.floor(15005 / step) + 1);
  assert.ok(close(all[0], frontRadius(15005), 1e-9));
  assert.ok(all[1] > frontRadius(15005) * 0.9, "第二个脉冲已接近主波前尺寸");
  assert.ok(all[all.length - 1] < 1, "最新脉冲刚出发");
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i] < all[i - 1], `第 ${i} 层应更靠内`);
    assert.ok(close(all[i - 1] - all[i], step * UNITS_PER_LIGHT_SEC, 1e-6));
  }
  assert.deepEqual(pulseRadii(4321, step), pulseRadii(4321, step));
});

test("脉冲按真实时间每 1 秒一次：间隔 = 倍率 × 真实间隔，与倍率无关", () => {
  const lightSec = 15005;
  for (const rate of [1, 60, 600, 3600]) {
    const radii = pulseRadii(lightSec, rate);
    assert.equal(radii.length, Math.min(MAX_PULSES, Math.floor(lightSec / rate) + 1),
      `rate=${rate} 层数`);
    assert.ok(close(radii[0], frontRadius(lightSec), 1e-9));
    assert.ok(radii[radii.length - 1] < radii[0], "半径覆盖整个传播过程");
  }
  // 极慢倍率（30 天/秒）下光行时还不够发第二次脉冲
  assert.equal(pulseRadii(lightSec, 2592000).length, 1);
});

test("脉冲超过层数上限时均匀抽样，仍保留最大与最小", () => {
  const total = frontRadius(600 * 100);
  const radii = pulseRadii(600 * 100, 600, 8);
  assert.equal(radii.length, 8);
  assert.ok(close(radii[0], total, 1e-9), "最老/最大仍在");
  assert.equal(radii[radii.length - 1], frontRadius(0), "最新/最小仍在");
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i] < radii[i - 1]);
  assert.ok(radii[1] > total * 0.5, "抽样球分布在整个区间而非挤在最小值附近");

  assert.equal(pulseRadii(1200, 0).length, pulseRadii(1200, PULSE_FALLBACK_SEC).length);
  assert.deepEqual(pulseRadii(-100, 600), [frontRadius(0)]);
});
