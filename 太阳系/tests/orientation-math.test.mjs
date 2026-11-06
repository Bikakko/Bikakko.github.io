import test from "node:test";
import assert from "node:assert/strict";
import {
  spinAngleRad, poleAt, poleEquatorialToEcliptic, eclipticToWorld,
  orbitNormalEcliptic, angularSeparationDeg, axisObliquityDeg,
} from "../assets/solar/orientation-math.js";
import { SUN_CFG, MOON_CFG, PLANETS } from "../assets/solar/bodies.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const norm = v => Math.hypot(v.x, v.y, v.z);

test("自转角：速率为 0 / 非有限速率 / 非有限时间都退回 W0", () => {
  assert.ok(close(spinAngleRad({ w0Deg: 45, wRateDegPerDay: 0 }, 100), 45 * DEG, 1e-12));
  assert.ok(close(spinAngleRad({ w0Deg: 45, wRateDegPerDay: NaN }, 100), 45 * DEG, 1e-12));
  assert.ok(close(spinAngleRad({ w0Deg: 45, wRateDegPerDay: 10 }, Infinity), 45 * DEG, 1e-12));
  assert.ok(close(spinAngleRad({ wRateDegPerDay: 10 }, 0), 0, 1e-12));   // 缺省 W0 = 0
});

test("自转角：线性项按周期取模，负时间回绕到 [0, 2π)", () => {
  const spin = { w0Deg: 0, wRateDegPerDay: 360 };   // 周期 = 1 天
  assert.ok(close(spinAngleRad(spin, 1.5), Math.PI, 1e-12));
  assert.ok(close(spinAngleRad(spin, -0.25), 1.5 * Math.PI, 1e-12));
  assert.ok(close(spinAngleRad(spin, 0), 0, 1e-12));
});

test("自转角：二次项用完整 days，不被线性周期取模重置（回归）", () => {
  // 周期 = 1 天：days=100 时线性部分恰好整圈归零，
  // Ẅ·d² = 1e-4 × 100² = 1° 必须保留。旧实现若对整体取模会返回 0。
  const spin = { w0Deg: 0, wRateDegPerDay: 360, wRate2DegPerDay2: 1e-4 };
  assert.ok(close(spinAngleRad(spin, 100), 1 * DEG, 1e-12));
  assert.ok(close(spinAngleRad(spin, 200), 4 * DEG, 1e-12));
});

test("自转角：与完整公式 mod 360 等价，结果恒在 [0, 2π)", () => {
  for (const cfg of [SUN_CFG, MOON_CFG, ...PLANETS]) {
    for (const days of [0, 100, 365.25, 3652.5, -365.25]) {
      const s = cfg.spin;
      const full = (s.w0Deg || 0) + s.wRateDegPerDay * days
        + (s.wRate2DegPerDay2 || 0) * days * days;
      const expected = (((full % 360) + 360) % 360) * DEG;
      const got = spinAngleRad(s, days);
      assert.ok(close(got, expected, 1e-6), `${cfg.name} t=${days}: ${got} vs ${expected}`);
      assert.ok(got >= 0 && got < TAU, `${cfg.name} t=${days} 越界`);
    }
  }
});

test("极轴：所有天体在 J2000 与百年后都是单位向量", () => {
  for (const cfg of [SUN_CFG, MOON_CFG, ...PLANETS]) {
    for (const days of [0, 36525]) {
      const p = poleAt(cfg, days);
      assert.ok(close(norm(p), 1, 1e-12), `${cfg.name} t=${days}`);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    }
  }
});

test("极轴：地球 J2000 北极 = 赤道 (0,0,1) 转过黄赤交角", () => {
  const earth = PLANETS.find(p => p.name === "地球");
  const p = poleAt(earth, 0);
  const eps = 23.4392911 * DEG;
  // 赤道北天极 (0,0,1) → 黄道 (0, sin ε, cos ε)
  assert.ok(close(p.x, 0, 1e-9));
  assert.ok(close(p.y, Math.sin(eps), 1e-9));
  assert.ok(close(p.z, Math.cos(eps), 1e-9));
});

test("极轴：每世纪线性项外推；无速率时恒定", () => {
  const cfg = { pole: { raDeg: 100, decDeg: 60, raRatePerCentury: 0.5, decRatePerCentury: -0.2 } };
  const p1 = poleAt(cfg, 36525);
  const direct = poleEquatorialToEcliptic(100.5, 59.8);
  assert.ok(close(p1.x, direct.x, 1e-12));
  assert.ok(close(p1.y, direct.y, 1e-12));
  assert.ok(close(p1.z, direct.z, 1e-12));

  const fixed = { pole: { raDeg: 100, decDeg: 60 } };
  const a = poleAt(fixed, 0), b = poleAt(fixed, 73050);
  assert.ok(close(a.x, b.x, 1e-12) && close(a.y, b.y, 1e-12) && close(a.z, b.z, 1e-12));
});

test("黄道到世界坐标映射 (x,y,z) → (x,z,-y)", () => {
  assert.deepEqual(eclipticToWorld({ x: 1, y: 2, z: 3 }), { x: 1, y: 3, z: -2 });
});

test("轨道法线：零倾角指黄北，90° 倾角按交点取向", () => {
  const n0 = orbitNormalEcliptic(0, 123);
  assert.ok(close(n0.x, 0, 1e-12) && close(n0.y, 0, 1e-12) && close(n0.z, 1, 1e-12));
  const n90 = orbitNormalEcliptic(90, 0);
  assert.ok(close(n90.x, 0, 1e-12));
  assert.ok(close(n90.y, -1, 1e-12));
  assert.ok(close(n90.z, 0, 1e-9));
});

test("角距：平行/正交/反平行与缩放不变性", () => {
  const a = { x: 1, y: 0, z: 0 };
  assert.ok(close(angularSeparationDeg(a, { x: 2, y: 0, z: 0 }), 0, 1e-9));
  assert.ok(close(angularSeparationDeg(a, { x: 0, y: 3, z: 0 }), 90, 1e-9));
  assert.ok(close(angularSeparationDeg(a, { x: -1, y: 0, z: 0 }), 180, 1e-9));
});

test("转轴倾角：地球 ≈23.44°，金星逆行接近 180°，天王星侧躺 >90°", () => {
  const earth = PLANETS.find(p => p.name === "地球");
  const venus = PLANETS.find(p => p.name === "金星");
  const uranus = PLANETS.find(p => p.name === "天王星");
  assert.ok(close(axisObliquityDeg(earth), 23.4392911, 0.01));
  assert.ok(close(axisObliquityDeg(venus), venus.obliquityDeg, 0.5));
  assert.ok(close(axisObliquityDeg(uranus), uranus.obliquityDeg, 0.5));
});