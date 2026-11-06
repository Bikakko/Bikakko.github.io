/* ============================================================
   土星环 τ(r) 实测剖面回归
   - 烘制数据与 bodies.js 环几何同范围、同口径
   - 物理特征：B 环高不透明、C 环稀薄、卡西尼缝/恩克缝清晰分辨
   - 与 bodies.js 参考缝隙模型（ringGap）交叉校验：
     模型判定为缝隙中心处，实测 τ 必须确实低
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import { RING_PROFILE } from "../assets/solar/ring-profile.js";
import { SATURN_CFG, ringGap } from "../assets/solar/bodies.js";

const { innerKm, outerKm } = SATURN_CFG.ring;

// 在烘制网格上线性插值取 τ（与纹理采样同口径）
function tauAtKm(km) {
  const t = (km - innerKm) / (outerKm - innerKm);
  const x = Math.min(1, Math.max(0, t)) * (RING_PROFILE.samples - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RING_PROFILE.tau[i];
  const b = RING_PROFILE.tau[Math.min(i + 1, RING_PROFILE.samples - 1)];
  return a + (b - a) * f;
}

test("剖面与环几何同范围，2048 采样全为非负有限值", () => {
  assert.equal(RING_PROFILE.innerKm, innerKm);
  assert.equal(RING_PROFILE.outerKm, outerKm);
  assert.equal(RING_PROFILE.samples, 2048);
  assert.equal(RING_PROFILE.tau.length, 2048);
  for (const v of RING_PROFILE.tau) {
    assert.ok(Number.isFinite(v) && v >= 0, `τ 应为非负有限值，实得 ${v}`);
  }
});

test("物理特征：B 环高不透明、C 环稀薄、内缘渐弱", () => {
  assert.ok(tauAtKm(100000) > 1.0, `B 环 τ(100,000 km) = ${tauAtKm(100000)}`);
  assert.ok(tauAtKm(110000) > 0.8, "B 环外段仍高不透明");
  assert.ok(tauAtKm(80000) < 0.3, `C 环 τ(80,000 km) = ${tauAtKm(80000)}`);
  assert.ok(tauAtKm(innerKm) < 0.1, "C 环内缘应渐弱");
  assert.ok(Math.max(...RING_PROFILE.tau) > 1.5, "B 环峰值应超过 1.5");
  // Beer–Lambert：B 环覆盖率显著高于 C 环
  const cov = (km) => 1 - Math.exp(-tauAtKm(km));
  assert.ok(cov(100000) > cov(80000) * 3, "B 环覆盖率应远高于 C 环");
});

test("卡西尼缝与恩克缝在实测剖面中清晰分辨，且与参考缝隙模型一致", () => {
  const cassiniMid = (SATURN_CFG.ring.cassiniInnerKm + SATURN_CFG.ring.cassiniOuterKm) / 2;
  const encke = SATURN_CFG.ring.enckeKm;
  assert.ok(tauAtKm(cassiniMid) < 0.2, `卡西尼缝中心 τ = ${tauAtKm(cassiniMid)}`);
  assert.ok(tauAtKm(encke) < 0.05, `恩克缝中心 τ = ${tauAtKm(encke)}`);

  // 交叉校验：bodies.js 参考模型判定为缝隙中心（gap≈0）处，实测 τ 必须低
  for (const km of [cassiniMid, encke]) {
    const t = (km - innerKm) / (outerKm - innerKm);
    assert.ok(ringGap(t, SATURN_CFG.ring) < 1e-9, `参考模型应在 ${km} km 判定缝隙`);
    assert.ok(tauAtKm(km) < 0.2, `实测剖面应在 ${km} km 低不透明`);
  }

  // 缝外侧环物质回升（A 环），证明缝是局部空缺而非数据截断
  assert.ok(tauAtKm(125000) > 0.3, `卡西尼缝外 A 环 τ = ${tauAtKm(125000)}`);
  assert.ok(tauAtKm(130000) > 0.3, "A 环中部应回升");
});