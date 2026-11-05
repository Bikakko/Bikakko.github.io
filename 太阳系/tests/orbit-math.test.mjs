import test from "node:test";
import assert from "node:assert/strict";
import {
  solveKepler, orbitalPointAtE, orbitalPosition, elementsAt,
  barycenterCorrectedPosition,
} from "../assets/solar/orbit-math.js";
import { MOON_CFG, PLANETS } from "../assets/solar/bodies.js";

const TAU = Math.PI * 2;
const AU_UNIT = 10.06;
const KM_PER_AU = 149597870.7;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const circular = (extra = {}) => ({
  aAU: 1, e: 0, incDeg: 0, nodeDeg: 0,
  varpiDeg: 0, meanLonDeg: 0, orbitDays: 360, mAnomalyBias: 0,
  ...extra,
});

test("开普勒方程在圆轨道与椭圆轨道上都收敛", () => {
  assert.ok(close(solveKepler(0, 0), 0, 1e-12));
  assert.ok(close(solveKepler(Math.PI / 2, 0), Math.PI / 2, 1e-12));

  for (const M of [-3, -1, 0.3, 1.1, 5.9]) {
    for (const e of [0, 0.0549, 0.2056]) {
      const E = solveKepler(M, e);
      const m = ((M % TAU) + TAU) % TAU;
      assert.ok(close(E - e * Math.sin(E), m, 1e-10), `M=${M} e=${e}`);
    }
  }
});

test("黄道到 three.js Y-up 的映射与公转方向", () => {
  const a = orbitalPosition(circular(), 0, out());
  assert.ok(close(a.x, AU_UNIT, 1e-12));
  assert.ok(close(a.y, 0, 1e-12));
  assert.ok(close(a.z, 0, 1e-12));

  const b = orbitalPosition(circular(), 90, out());
  assert.ok(close(b.x, 0, 1e-9));
  assert.ok(close(b.y, 0, 1e-12));
  assert.ok(close(b.z, -AU_UNIT, 1e-9));

  const crossY = a.z * b.x - a.x * b.z;
  assert.ok(crossY > 0, "从黄北看应逆时针公转");
});

test("轨道倾角 90° 时轨道面抬到黄北", () => {
  const p = orbitalPosition(circular({ incDeg: 90 }), 90, out());
  assert.ok(close(p.x, 0, 1e-9));
  assert.ok(close(p.y, AU_UNIT, 1e-9));
  assert.ok(close(p.z, 0, 1e-9));
});

test("负时间按周期回绕，周期为 0 或非有限时间返回原点", () => {
  const cfg = circular();
  const neg = orbitalPosition(cfg, -90, out());
  const pos = orbitalPosition(cfg, 270, out());
  assert.ok(close(neg.x, pos.x, 1e-9));
  assert.ok(close(neg.z, pos.z, 1e-9));

  const zero = orbitalPosition(circular({ orbitDays: 0 }), 100, out());
  assert.deepEqual([zero.x, zero.y, zero.z], [0, 0, 0]);

  const bad = orbitalPosition(cfg, Infinity, out());
  assert.deepEqual([bad.x, bad.y, bad.z], [0, 0, 0]);
});

test("月球平均要素随时间进动，距离始终在近/远地点之间", () => {
  const aKm = MOON_CFG.aAU * KM_PER_AU;
  for (const days of [0, 365.25, 36525, 73050]) {
    const p = orbitalPosition(MOON_CFG, days, out());
    const rKm = Math.hypot(p.x, p.y, p.z) / (AU_UNIT / KM_PER_AU);
    assert.ok(Number.isFinite(rKm), `t=${days} 有限`);
    assert.ok(rKm >= aKm * (1 - MOON_CFG.e) - 1, `t=${days} 不小于近地点`);
    assert.ok(rKm <= aKm * (1 + MOON_CFG.e) + 1, `t=${days} 不大于远地点`);
  }

  // 交点/近地点进动会让同一偏近点角在不同世纪落在不同位置
  const p0 = orbitalPosition(MOON_CFG, 0, out());
  const p100 = orbitalPosition(MOON_CFG, 36525, out());
  assert.ok(Math.hypot(p0.x - p100.x, p0.y - p100.y, p0.z - p100.z) > 0);
});

test("偏近点角采样与椭圆半径一致", () => {
  const cfg = circular({ e: 0.2, incDeg: 3, nodeDeg: 40, varpiDeg: 70, meanLonDeg: 120 });
  const E = 1.234;
  const p = orbitalPointAtE(cfg, E, out());
  const expected = cfg.aAU * (1 - cfg.e * Math.cos(E)) * AU_UNIT;
  assert.ok(close(Math.hypot(p.x, p.y, p.z), expected, 1e-9));
});

test("elementsAt 在 T=0 返回 J2000 要素，按速率线性外推并夹住偏心率", () => {
  const cfg = circular({
    e: 0.2, incDeg: 3, nodeDeg: 40, varpiDeg: 70, meanLonDeg: 120,
    rates: {
      aPerCentury: 0.001, ePerCentury: 0.01, incDegPerCentury: 0.1,
      meanLonDegPerCentury: 36000, varpiDegPerCentury: 0.3, nodeDegPerCentury: -0.2,
    },
  });
  const e0 = elementsAt(cfg, 0);
  assert.ok(close(e0.aAU, cfg.aAU, 1e-12));
  assert.ok(close(e0.e, cfg.e, 1e-12));
  assert.equal(e0.incDeg, cfg.incDeg);
  assert.equal(e0.meanLonDeg, cfg.meanLonDeg);

  const e1 = elementsAt(cfg, 1);
  assert.ok(close(e1.aAU, cfg.aAU + 0.001, 1e-12));
  assert.ok(close(e1.e, 0.21, 1e-12));
  assert.ok(close(e1.incDeg, 3.1, 1e-12));
  assert.ok(close(e1.meanLonDeg, 120 + 36000, 1e-9));
  assert.ok(close(e1.varpiDeg, 70.3, 1e-12));
  assert.ok(close(e1.nodeDeg, 39.8, 1e-12));

  // 极端 ?t= 下 e 仍保持在开普勒方程可解区间
  assert.equal(elementsAt({ ...cfg, e: 0.99 }, 100).e, 0.9);
  assert.equal(elementsAt({ ...cfg, e: 0.2 }, -100).e, 0);
});

test("长期项在 J2000 不改变位置，只作用于非 J2000 历元", () => {
  for (const cfg of PLANETS) {
    const withRates = orbitalPosition(cfg, 0, out());
    const stripped = { ...cfg, rates: undefined };
    const without = orbitalPosition(stripped, 0, out());
    assert.ok(close(withRates.x, without.x, 1e-9)
      && close(withRates.y, without.y, 1e-9)
      && close(withRates.z, without.z, 1e-9), `${cfg.name} J2000 位置不应改变`);

    const a = orbitalPosition(cfg, 36525, out());
    const b = orbitalPosition(stripped, 36525, out());
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6,
      `${cfg.name} 长期项未生效`);
  }
});

test("含卫星的本体位置 = 质心轨道 − 质量比·卫星相对位置", () => {
  const moon = { ...circular({ aAU: 0.01, e: 0.05, orbitDays: 27 }), massRatio: 0.012 };
  const earth = circular({ aAU: 1, orbitDays: 365, satellites: [moon] });
  for (const t of [0, 13, 100]) {
    const bary = orbitalPosition(earth, t, out());
    const sat = orbitalPosition(moon, t, out());
    const body = barycenterCorrectedPosition(earth, t, out());
    assert.ok(close(body.x, bary.x - sat.x * moon.massRatio, 1e-12));
    assert.ok(close(body.y, bary.y - sat.y * moon.massRatio, 1e-12));
    assert.ok(close(body.z, bary.z - sat.z * moon.massRatio, 1e-12));
  }
});

test("地月质心偏移始终约 4670 km（在近/远地点之间）", () => {
  const earth = PLANETS.find(p => p.name === "地球");
  for (const t of [0, 123.4, 900, 36525]) {
    const bary = orbitalPosition(earth, t, out());
    const body = barycenterCorrectedPosition(earth, t, out());
    const offsetKm = Math.hypot(bary.x - body.x, bary.y - body.y, bary.z - body.z)
      * (KM_PER_AU / AU_UNIT);
    assert.ok(offsetKm > 4300 && offsetKm < 5000, `t=${t} 偏移 ${offsetKm} km`);
  }
});
