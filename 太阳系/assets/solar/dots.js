/* ============================================================
   太阳系 · Solar · 最小可见光点
   天体本体严格按真实比例，全景下不足一像素，物理上不可见。
   这里用屏幕尺寸恒定的点精灵补一个指示光点，属于 UI 层，
   不参与比例计算，所以不破坏「真实比例」的前提。
   ============================================================ */
import * as THREE from "three";
import { dotPixels, dotAppearance } from "./dot-math.js";

// 所有天体共用一张白色径向渐变贴图，颜色由 material.color 染色，
// 避免每个天体各建一张 canvas 贴图与材质
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.00, "rgba(255,255,255,0.70)");
  grad.addColorStop(0.28, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.62, "rgba(255,255,255,0.25)");
  grad.addColorStop(1.00, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _dotTex = new THREE.CanvasTexture(cv);
  _dotTex.colorSpace = THREE.SRGBColorSpace;
  return _dotTex;
}

export function makeMinDot(cfg) {
  const mat = new THREE.PointsMaterial({
    size: 9, sizeAttenuation: false,
    map: dotTexture(), color: cfg.colorA,
    transparent: true, depthWrite: false,
    depthTest: true, blending: THREE.AdditiveBlending,
    opacity: 0.0,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 2;
  pts.userData = cfg;
  return pts;
}

// 每帧按「本帧相机」刷新光点：行星/太阳/月球共用同一套公式。
// worldPos 必须已是世界坐标；viewH 用 CSS 像素（与 material.size 单位一致）。
export function updateMinDot(dot, worldPos, radius, camera, viewH, style) {
  const dPx = dotPixels(radius * 2, camera.position.distanceTo(worldPos), camera.fov, viewH);
  const a = dotAppearance(dPx, style);
  dot.material.opacity = a.opacity;
  dot.material.size = a.size;
  dot.visible = a.visible;
}
