/* ============================================================
   相机纯数学（无 three 依赖，可在 Node 直接测试）
   ============================================================ */

export const DRAG_THRESHOLD_PX = 6;

export function hasDragged(startX, startY, x, y, threshold = DRAG_THRESHOLD_PX) {
  return Math.hypot(x - startX, y - startY) > threshold;
}

export function pinchZoomDistance(startDistance, startSpan, currentSpan) {
  if (!Number.isFinite(startDistance) || !Number.isFinite(startSpan) || !Number.isFinite(currentSpan)
      || startDistance <= 0 || startSpan <= 0) return startDistance;
  return startDistance * Math.pow(startSpan / Math.max(currentSpan, 1), 1.6);
}

/* ---------- 仰角约束 ---------- */
export const MIN_PHI = 0.10;
// 远景：卡在水平面之前，不钻到黄道面下方
export const MAX_PHI = Math.PI * 0.495;
// 近距离：放开到可以看星球底面
export const MAX_PHI_UNDER = Math.PI * 0.95;

// dist ≥ 10 → 仅上方；dist ≤ 2 → 可到下方；中间平滑过渡
export function maxPhiForDistance(dist) {
  // 非有限距离（异常输入）退回最保守的远景上限，避免把 NaN 写进相机状态
  if (!Number.isFinite(dist)) return MAX_PHI;
  const t = Math.min(1, Math.max(0, (10 - dist) / 8));
  return MAX_PHI + (MAX_PHI_UNDER - MAX_PHI) * t;
}

/* ---------- WASD 在聚焦态下的行为 ----------
   聚焦过渡中忽略按键：中途 takeOverCamera 会把 tDist 拍回当前距离却保留
   focusTarget，镜头停在半途。聚焦态一律环绕天体：走平移分支会让 panOffset
   持续累积，把「已聚焦」的镜头慢慢带离行星。 */
export function keyboardMoveMode({ isFocused = false, isFlying = false } = {}) {
  if (isFlying) return "ignore";
  if (isFocused) return "orbit";
  return "pan";
}
