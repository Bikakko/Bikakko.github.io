import test from "node:test";
import assert from "node:assert/strict";
import {
  SOLAR_RADIUS_KM, LIMB_DARKENING, limbDarkening,
  GRANULE_KM, SUPERGRANULE_KM, granuleFreq, supergranuleFreq,
  DIFF_ROTATION, CARRINGTON_DEG_PER_DAY,
  diffRotationDegPerDay, diffDriftDegPerDay,
} from "../assets/solar/solar-physics.js";
import { SUN_CFG } from "../assets/solar/bodies.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;

test("临边昏暗：Neckel & Labs 1994 可见光多项式，中心 1 边缘 0.30", () => {
  const { a0, a1, a2 } = LIMB_DARKENING;
  assert.ok(close(a0 + a1 + a2, 1.0, 1e-12), "系数和应为 1（中心归一）");
  assert.ok(close(limbDarkening(1), 1.0, 1e-12), "日面中心 I/I(1)=1");
  assert.ok(close(limbDarkening(0), 0.30, 1e-12), "边缘 I/I(1)=0.30");
  // [0,1] 上单调递增（中心比边缘亮）
  let prev = limbDarkening(0);
  for (let i = 1; i <= 20; i++) {
    const cur = limbDarkening(i / 20);
    assert.ok(cur >= prev - 1e-12, `μ=${i / 20} 处应单调不减`);
    prev = cur;
  }
  // 越界 μ 钳制到 [0,1]
  assert.ok(close(limbDarkening(-1), limbDarkening(0), 1e-12));
  assert.ok(close(limbDarkening(2), limbDarkening(1), 1e-12));
});

test("米粒组织尺度标定到真实 km：米粒 1000 / 超米粒 30000", () => {
  assert.equal(GRANULE_KM, 1000);
  assert.equal(SUPERGRANULE_KM, 30000);
  assert.equal(SOLAR_RADIUS_KM, 695700);
  // 单位球面噪声频率 = R☉ / 尺度km
  assert.ok(close(granuleFreq(), 695.7, 1e-9));
  assert.ok(close(supergranuleFreq(), 23.19, 1e-9));
  assert.ok(granuleFreq() > supergranuleFreq() * 20, "米粒频率远高于超米粒");
});

test("较差自转：Snodgrass & Ulrich 1990 赤道 24.47d / 极区 34.2d", () => {
  assert.equal(DIFF_ROTATION.A, 14.713);
  assert.equal(DIFF_ROTATION.B, -2.396);
  assert.equal(DIFF_ROTATION.C, -1.787);
  const eq = diffRotationDegPerDay(0);
  const pole = diffRotationDegPerDay(90);
  assert.ok(close(eq, 14.713, 1e-9), "赤道恒星自转率");
  assert.ok(close(pole, 10.530, 1e-9), "极区恒星自转率");
  assert.ok(close(360 / eq, 24.47, 0.01), "赤道周期 ~24.47 天");
  assert.ok(close(360 / pole, 34.19, 0.05), "极区周期 ~34.2 天");
  // 纬度越高转得越慢（单调递减）
  assert.ok(diffRotationDegPerDay(30) < eq);
  assert.ok(diffRotationDegPerDay(60) < diffRotationDegPerDay(30));
  assert.ok(diffRotationDegPerDay(60) > pole);
  // 南北半球对称
  assert.ok(close(diffRotationDegPerDay(-45), diffRotationDegPerDay(45), 1e-12));
});

test("差速漂移与刚体平均合成出真实局部自转；与 bodies.js 单一数据源", () => {
  // 刚体平均率必须与 SUN_CFG.spin 一致（Carrington 恒星平均）
  assert.ok(close(CARRINGTON_DEG_PER_DAY, SUN_CFG.spin.wRateDegPerDay, 1e-9));
  assert.equal(SOLAR_RADIUS_KM, SUN_CFG.radiusKm);
  // shader 世界系自转 = 刚体平均 − 漂移 = 局部真实率
  for (const lat of [0, 26, 45, 60, 90]) {
    const drift = diffDriftDegPerDay(lat);
    assert.ok(close(CARRINGTON_DEG_PER_DAY - drift, diffRotationDegPerDay(lat), 1e-9),
      `纬度 ${lat} 合成自转率`);
  }
  // 赤道比平均快（漂移负），极区比平均慢（漂移正）
  assert.ok(diffDriftDegPerDay(0) < 0);
  assert.ok(diffDriftDegPerDay(90) > 0);
  assert.ok(close(diffDriftDegPerDay(0), -0.5286, 1e-3));
  assert.ok(close(diffDriftDegPerDay(90), 3.6544, 1e-3));
});