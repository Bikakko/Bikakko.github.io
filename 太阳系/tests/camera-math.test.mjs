import test from "node:test";
import assert from "node:assert/strict";
import { DRAG_THRESHOLD_PX, hasDragged, pinchZoomDistance } from "../assets/solar/camera-math.js";

test("普通点击和阈值内微动不进入拖动", () => {
  assert.equal(hasDragged(100, 100, 100, 100), false);
  assert.equal(hasDragged(100, 100, 103, 104), false);
  assert.equal(hasDragged(100, 100, 106, 100), false);
});

test("多次微小位移累计后进入拖动", () => {
  let x = 100;
  let y = 100;
  let dragged = false;
  for (let i = 0; i < 20; i++) {
    x += 1;
    y += 0.5;
    dragged ||= hasDragged(100, 100, x, y);
  }
  assert.equal(dragged, true);
  assert.equal(hasDragged(100, 100, 100 + DRAG_THRESHOLD_PX + 1, 100), true);
});

test("双指展开拉近、收拢拉远", () => {
  assert.ok(pinchZoomDistance(100, 100, 200) < 100);
  assert.ok(pinchZoomDistance(100, 100, 50) > 100);
  assert.equal(pinchZoomDistance(100, 100, 100), 100);
});

test("双指中点重合及异常输入不会产生 NaN", () => {
  assert.ok(Number.isFinite(pinchZoomDistance(100, 100, 0)));
  assert.equal(pinchZoomDistance(100, 0, 100), 100);
  assert.equal(pinchZoomDistance(100, 100, NaN), 100);
});
