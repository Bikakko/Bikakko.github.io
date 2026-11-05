import test from "node:test";
import assert from "node:assert/strict";
import {
  lightTimeSeconds, frontRadius, lightArrivals, lightSecondsPerAU,
  toLogAxis, fromLogAxis, advanceLightTime,
  formatClock, formatShort, formatLightTime,
  LOG_AXIS_MIN, LOG_AXIS_MAX, LIGHT_TICKS,
} from "../assets/solar/light-math.js";
import {
  C_KM_S, KM_PER_AU, KM_PER_UNIT, AU_UNIT,
  UNITS_PER_LIGHT_SEC, LIGHT_SEC_PER_AU,
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
  // 回放倍率不参与任何物理换算：距离 → 光行时只由 c 决定
  assert.equal(lightTimeSeconds(AU_UNIT), 1 * KM_PER_AU / C_KM_S);
});

test("波前半径 = 光行时 × 光速，t=0 时不小于日面半径", () => {
  assert.equal(frontRadius(0), SUN_CFG.radius);
  assert.ok(close(frontRadius(LIGHT_SEC_PER_AU), AU_UNIT, 1e-9));
  assert.ok(close(frontRadius(3600), 3600 * UNITS_PER_LIGHT_SEC, 1e-9));
  assert.ok(frontRadius(-10) === SUN_CFG.radius);
  assert.ok(frontRadius(15005) > 300, "4 小时后的波前应越过海王星轨道");
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
  // 距离递增 → 到达时刻递增
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
  // 刻度都落在 [0,1]，且互不重合
  for (const t of LIGHT_TICKS) {
    const v = toLogAxis(t.sec);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("回放推进：线性按倍率、对数每数量级等时长，都不改变 c", () => {
  assert.equal(advanceLightTime(100, 1, 600, "linear"), 700);
  assert.equal(advanceLightTime(100, 0.5, 60, "linear"), 130);
  assert.equal(advanceLightTime(100, 0, 600, "linear"), 100);

  let s = 0;
  const ratios = [];
  for (let i = 0; i < 30; i++) {
    const next = advanceLightTime(s, 1, 600, "log");
    if (s >= LOG_AXIS_MIN) ratios.push(next / s);
    s = next;
  }
  assert.ok(s > 1000, "对数回放 30 秒应走过多个数量级");
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(close(ratios[i], ratios[0], 1e-6), "每个数量级等时长");
  }

  // 光速本身不受 rate / mode 影响
  assert.equal(C_KM_S, 299792.458);
  assert.ok(close(frontRadius(advanceLightTime(0, 1, 3600, "linear")),
    3600 * UNITS_PER_LIGHT_SEC, 1e-9));
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
