import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAG_THRESHOLD_PX, hasDragged, pinchZoomDistance,
  MIN_PHI, MAX_PHI, MAX_PHI_UNDER, maxPhiForDistance, keyboardMoveMode,
} from "../assets/solar/camera-math.js";

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

test("仰角上限：远景卡在水平面之上、近景放开到底面、中间平滑过渡", () => {
  assert.equal(maxPhiForDistance(400), MAX_PHI);
  assert.equal(maxPhiForDistance(10), MAX_PHI);
  assert.equal(maxPhiForDistance(2), MAX_PHI_UNDER);
  assert.equal(maxPhiForDistance(0.001), MAX_PHI_UNDER);
  assert.ok(MAX_PHI < Math.PI / 2, "远景不得钻到黄道面下方");
  assert.ok(MAX_PHI_UNDER > Math.PI / 2, "近景允许看底面");

  let prev = Infinity;
  for (const d of [2, 3, 5, 8, 10, 100]) {
    const v = maxPhiForDistance(d);
    assert.ok(v <= prev, `距离变大时上限不应变大 (d=${d})`);
    assert.ok(v >= MAX_PHI && v <= MAX_PHI_UNDER);
    prev = v;
  }
  assert.ok(MIN_PHI > 0);
});

test("拉远后重夹仰角：近距离允许的下方视角不再被远景沿用", () => {
  const under = maxPhiForDistance(1);   // 近距离，允许 > π/2
  const far = maxPhiForDistance(400);   // 拉远后的新上限
  assert.ok(under > far);
  // camera.updateCamera 每帧用本帧距离重夹 tPhi
  assert.equal(Math.min(far, Math.max(MIN_PHI, under)), far);
});

test("非有限距离退回远最保守上限，不污染相机状态", () => {
  assert.equal(maxPhiForDistance(NaN), MAX_PHI);
  assert.equal(maxPhiForDistance(Infinity), MAX_PHI);
  assert.equal(maxPhiForDistance(-Infinity), MAX_PHI);
});

test("WASD 模式：聚焦过渡忽略、聚焦态环绕、自由视角平移", () => {
  assert.equal(keyboardMoveMode({ isFocused: true, isFlying: true }), "ignore");
  assert.equal(keyboardMoveMode({ isFocused: false, isFlying: true }), "ignore");
  assert.equal(keyboardMoveMode({ isFocused: true, isFlying: false }), "orbit");
  assert.equal(keyboardMoveMode({ isFocused: false, isFlying: false }), "pan");
  assert.equal(keyboardMoveMode(), "pan");
});
