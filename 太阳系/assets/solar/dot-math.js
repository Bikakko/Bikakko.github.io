/* ============================================================
   最小可见光点的屏幕计算（纯函数，无 three 依赖，可在 Node 测试）
   - dPx：天体直径投影到屏幕的像素数
   - 6px 以下完全显示，12px 以上完全关闭，中间线性淡出
   ============================================================ */

// diameterWorld：天体直径（世界单位）；viewH：视口高度（CSS 像素）
export function dotPixels(diameterWorld, camDist, fovDeg, viewH) {
  if (!(camDist > 0)) return Infinity;
  return (diameterWorld / (camDist * Math.tan(fovDeg * Math.PI / 360))) * (viewH / 2);
}

// style：{ maxOpacity, sizeMax, sizeMin, sizeSlope }
export function dotAppearance(dPx, style) {
  const fade = Math.min(1, Math.max(0, (12 - dPx) / 6));
  return {
    opacity: fade * style.maxOpacity,
    size: Math.max(style.sizeMin, Math.min(style.sizeMax, style.sizeMax - dPx * style.sizeSlope)),
    visible: fade > 0.02,
  };
}
