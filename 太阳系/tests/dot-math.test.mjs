import test from "node:test";
import assert from "node:assert/strict";
import { dotPixels, dotAppearance } from "../assets/solar/dot-math.js";

const STYLE = { maxOpacity: 0.55, sizeMax: 11, sizeMin: 5, sizeSlope: 0.6 };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test("投影像素直径 = 直径 / (距离·tan(fov/2)) · 半屏高", () => {
  // fov=90° → tan(45°)=1；直径 2、距离 10、半屏高 500 → 100px
  assert.ok(close(dotPixels(2, 10, 90, 1000), 100));
  // 距离加倍 → 像素减半
  assert.ok(close(dotPixels(2, 20, 90, 1000), 50));
  // 48° 视场与真实数值一致
  const half = Math.tan(48 * Math.PI / 360);
  assert.ok(close(dotPixels(1, 10, 48, 800), (1 / (10 * half)) * 400));
});

test("相机距离为 0 或负数时不产生 NaN", () => {
  assert.equal(dotPixels(2, 0, 90, 1000), Infinity);
  assert.equal(dotPixels(2, -1, 90, 1000), Infinity);
  const a = dotAppearance(Infinity, STYLE);
  assert.equal(a.visible, false);
  assert.ok(Number.isFinite(a.size));
});

test("6px 以下全亮、12px 以上全灭、中间线性淡出", () => {
  const full = dotAppearance(6, STYLE);
  assert.equal(full.opacity, STYLE.maxOpacity);
  assert.equal(full.visible, true);

  const off = dotAppearance(12, STYLE);
  assert.equal(off.opacity, 0);
  assert.equal(off.visible, false);

  const mid = dotAppearance(9, STYLE);
  assert.ok(close(mid.opacity, STYLE.maxOpacity * 0.5));
  assert.equal(mid.visible, true);
});

test("光点尺寸随投影直径缩小并夹在 [sizeMin, sizeMax]", () => {
  assert.equal(dotAppearance(0, STYLE).size, 11);
  assert.ok(close(dotAppearance(6, STYLE).size, 11 - 6 * 0.6));
  assert.equal(dotAppearance(100, STYLE).size, 5);
});
