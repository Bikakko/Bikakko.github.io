/* ============================================================
   太阳系 · Solar · 入口
   - 行星表面：着色器程序化噪声，不加载任何贴图
   - 轨道相机：自实现，远景限制在黄道面上方
   - 触屏：touch-action + 手写 touch 事件
   - 光速可视化：独立光行时时钟 + 波前球壳（?light=1 / L 键）
   ============================================================ */
import * as THREE from "three";
import { Q, qStatic, qFocus, RADIUS_SCALE } from "./config.js";
import { SUN_CFG, MOON_CFG } from "./bodies.js";
import { createSpace } from "./space.js";
import { updatePlanets, updateSun } from "./body-system.js";
import { updateMinDot } from "./dots.js";
import { createHud } from "./hud.js";
import { createCameraRig } from "./camera.js";
import { createLabels } from "./labels.js";
import { createLightView } from "./light-view.js";
import { createLightHud } from "./light-hud.js";

// 构建标记：刷新后可在控制台确认运行的是哪一版
const BUILD = "2026-11-06 · light-speed";
console.info("[solar] build " + BUILD);
window.__solarBuild = BUILD;
if (qStatic) document.documentElement.classList.add("static");

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance",
  // 近平面最小 1e-6、远平面 6000（比值 ~6e9）：常规深度会让远景天体
  // 全部量化到 1.0 而被裁掉。自定义 ShaderMaterial 已注入对数深度片段。
  logarithmicDepthBuffer: true,
});
// 注意：ACES tone mapping 与 sRGB 输出只作用于内建材质（月球、土星环）；
// 行星/太阳/星空/光晕是自定义 ShaderMaterial，直接输出原始颜色——这是
// 既有取色刻意绕过色彩管线的结果，改动需整体重新调色。
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.55;

// 上下文丢失时阻止默认行为，让 three 在 restored 时自动重建
canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());

const scene = new THREE.Scene();
// 场景跨度到 ~303 单位（海王星轨道），远平面放到 6000。
// 近平面每帧随相机距离动态计算（见 camera.js updateCamera）：真实比例下地球
// 半径只有 0.0004 单位，固定 0.5 的近平面会把聚焦后的行星整颗裁掉。
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 6000);

const space = createSpace(scene, renderer);
// 光速视觉层必须在 renderer.compile 之前加入场景，着色器才会预编译
const lightView = createLightView(scene);
const {
  stars, sunUniforms, sunRecord, coronas, sunDot,
  planets, moonMesh, moonDot,
} = space;

// 全景按钮回到远景：rig 在下面创建，回调在此刻之后才会被点击触发
let rig;
const hud = createHud({ onHome: () => rig.resetView() });
rig = createCameraRig({ canvas, camera, space, hud });
const labels = createLabels({ space, rig, camera });

// ?size= 生效时，「尺寸与轨道等比例」不再成立，如实标注。
// 必须在 createLightHud 之前：光速面板会缓存这行文案用于开关时还原。
if (RADIUS_SCALE !== 1) {
  const sub = document.querySelector("#hud .sub");
  if (sub) sub.textContent = `程序生成太阳系 · 轨道等比例 · 天体半径放大 ${RADIUS_SCALE}×`;
}
const lightHud = createLightHud({ hud, lightView });

// 调试探针按需加载，正常访问不下载解析
if (Q.get("debug") === "1") {
  import("./debug.js").then((m) => m.installDebug({ space, rig, hud, camera, lightHud }));
}

// ?focus=天体 直接聚焦（含太阳/月球），用于截图与分享。
// 先按当前 simTime 计算位置，避免首帧前聚焦到默认位置
if (qFocus) {
  const simT0 = hud.getSimTime();
  updatePlanets(planets, simT0);
  updateSun(sunRecord, simT0);
  const f = space.focusables.find((x) => x.cfg.name === qFocus);
  if (f) rig.focusSnap(f.cfg, f.group);
}

// 最小可见光点的三套样式：行星 / 太阳 / 月球，公式统一在 dots.js
const PLANET_DOT_STYLE = { maxOpacity: 0.55, sizeMax: 11, sizeMin: 5, sizeSlope: 0.6 };
const SUN_DOT_STYLE    = { maxOpacity: 0.62, sizeMax: 13, sizeMin: 7, sizeSlope: 0.5 };
const MOON_DOT_STYLE   = { maxOpacity: 0.50, sizeMax: 9,  sizeMin: 4, sizeSlope: 0.5 };
const ORIGIN = new THREE.Vector3(0, 0, 0);

const tmpV = new THREE.Vector3();
let prevMs = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const nowMs = performance.now();
  const rawDt = Math.max((nowMs - prevMs) / 1000, 1e-4);
  prevMs = nowMs;
  // 切标签页回来会有巨大间隔：模拟时间按 0.25s 上限推进；FPS 用原始间隔
  const dt = Math.min(rawDt, 0.25);
  // 静态截图模式冻结着色器时间，保证同一 ?t= 每次出图一致
  const t = qStatic ? 0 : nowMs / 1000;
  if (Q.get("debug") === "1") window.__lastDt = dt;

  hud.advance(dt);
  const simTime = hud.getSimTime();

  // 1) 先按 simTime 摆好天体位置/姿态。
  // 2) 再更新相机：下面所有「按相机距离/朝向」计算的效果都必须用本帧相机，
  //    否则快速推拉时光点淡入淡出与 uProx 会滞后整整一帧。
  updatePlanets(planets, simTime);
  updateSun(sunRecord, simTime);
  rig.updateCamera(dt);

  // 3) 距离驱动的视觉层
  sunUniforms.uTime.value = t;
  // 亮度随距离：0 = 远观，1 = 贴近（约 80 倍日面半径以内开始增强）
  sunUniforms.uProx.value = Math.min(1, Math.max(0, 1 - camera.position.length() / (SUN_CFG.radius * 80)));

  for (const p of planets) {
    // 最小可见光点：本体投影直径小于 6px 时才亮起，否则淡出
    if (p.dot) updateMinDot(p.dot, p.group.position, p.cfg.radius, camera, innerHeight, PLANET_DOT_STYLE);
    p.mesh.material.uniforms.uTime.value = t;
  }

  // 太阳指示点：按投影尺寸淡入淡出，与行星光点同一规则
  updateMinDot(sunDot, ORIGIN, SUN_CFG.radius, camera, innerHeight, SUN_DOT_STYLE);

  // 月球指示点：球体仍是亚像素大小时显示
  if (moonMesh && moonDot) {
    moonMesh.getWorldPosition(tmpV);
    updateMinDot(moonDot, tmpV, MOON_CFG.radius, camera, innerHeight, MOON_DOT_STYLE);
  }

  // 星空是贴相机的球壳：平移/拉远时不会「飞出」星壳
  stars.uniforms.uTime.value = t;

  // 4) 光晕/星壳跟着「本帧」相机走：必须在 updateCamera 之后，
  //    否则快速拖动时用的是上一帧姿态，日冕面片会歪斜、星壳横向游移
  for (const c of coronas) c.quaternion.copy(camera.quaternion);
  stars.points.position.copy(camera.position);

  // 5) 光速层：推进独立的光行时时钟、更新波前与光线、刷新 HUD
  lightHud.tick(dt);

  renderer.render(scene, camera);
  // 用本帧的相机矩阵投影标签，避免近距离聚焦时滞后一帧
  labels.updateLabels();

  hud.updateHud(rawDt);
}

/* ============================================================
   启动
   ============================================================ */
renderer.compile(scene, camera);
animate();

if (qStatic) {
  // 静态/截图模式：立刻移除遮罩，不等 rAF 与 1s 淡出
  const ld = document.getElementById("loader");
  ld.style.transition = "none";
  ld.style.display = "none";
  document.getElementById("hud").classList.add("on");
  document.getElementById("tip").classList.add("on");
}

requestAnimationFrame(() => {
  document.getElementById("loader").classList.add("done");
  document.getElementById("hud").classList.add("on");
  document.getElementById("tip").classList.add("on");
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  stars.uniforms.uPixel.value = renderer.getPixelRatio();

  // 视口变化交给相机处理（用户动过视角/正在聚焦时不强行回全景）
  rig.onResize();
});
