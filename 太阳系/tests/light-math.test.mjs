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
  PULSE_INTERVAL_LIGHT_SEC, MAX_PULSES, PULSE_FALLBACK_SEC,
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

test("波纹严格以光速扩散：Δt=1 光秒，每层半径增加 c·1", () => {
  assert.equal(PULSE_INTERVAL_LIGHT_SEC, 5);
  assert.equal(MAX_PULSES, 32);
  const step = 5;
  const a = pulseRadii(1000, step);
  const b = pulseRadii(1001, step);
  assert.equal(a.length, MAX_PULSES, "层数恒定");
  for (let i = 0; i < MAX_PULSES - 2; i++) {
    // 跳过最内层（半径受日面半径下限 clamp）
    assert.ok(close(b[i] - a[i], UNITS_PER_LIGHT_SEC, 1e-9),
      `第 ${i} 层应以光速推进，实际 ${b[i] - a[i]}`);
  }
  // 球层由大到小
  for (let i = 1; i < a.length; i++) assert.ok(a[i] <= a[i - 1] + 1e-9);
});

test("波纹按固定光秒间隔，与观看倍率无关", () => {
  // 不同的物理间隔下，每层仍严格以 c 推进（不再乘 rateSec 或归一化到主波前）
  for (const step of [5, 60, 600]) {
    const a = pulseRadii(1000, step);
    const b = pulseRadii(1001, step);
    assert.equal(a.length, MAX_PULSES, `step=${step} 层数`);
    for (let i = 0; i < MAX_PULSES - 2; i++) {
      assert.ok(close(b[i] - a[i], UNITS_PER_LIGHT_SEC, 1e-9),
        `step=${step} 第 ${i} 层应以光速推进`);
    }
  }
  assert.deepEqual(pulseRadii(4321, 5), pulseRadii(4321, 5));
});

test("非法间隔与负光行时不产生 NaN", () => {
  const a = pulseRadii(1200, 0);
  assert.equal(a.length, MAX_PULSES);
  assert.ok(a.every(Number.isFinite));
  assert.equal(a.length, pulseRadii(1200, PULSE_FALLBACK_SEC).length);

  const b = pulseRadii(-100, 5);
  assert.equal(b.length, MAX_PULSES);
  assert.ok(b.every(Number.isFinite));
  // t=0 时所有球层都退到日面半径
  assert.ok(close(b[0], SUN_CFG.radius, 1e-9));
});
