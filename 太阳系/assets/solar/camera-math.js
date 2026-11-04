export const DRAG_THRESHOLD_PX = 6;

export function hasDragged(startX, startY, x, y, threshold = DRAG_THRESHOLD_PX) {
  return Math.hypot(x - startX, y - startY) > threshold;
}

export function pinchZoomDistance(startDistance, startSpan, currentSpan) {
  if (!Number.isFinite(startDistance) || !Number.isFinite(startSpan) || !Number.isFinite(currentSpan)
      || startDistance <= 0 || startSpan <= 0) return startDistance;
  return startDistance * Math.pow(startSpan / Math.max(currentSpan, 1), 1.6);
}
