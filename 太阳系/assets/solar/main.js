/* ============================================================
   太阳系 · Solar · 入口
   - 行星表面：着色器程序化噪声，不加载任何贴图
   - 轨道相机：自实现，远景限制在黄道面上方
   - 触屏：touch-action + 手写 touch 事件
   ============================================================ */
import * as THREE from "three";
import { Q, qStatic, qFocus, RADIUS_SCALE } from "./config.js";
import { SUN_CFG, MOON_CFG } from "./bodies.js";
import { createSpace } from "./space.js";
import { updatePlanets, updateSun } from "./body-system.js";
import { createHud } from "./hud.js";
import { createCameraRig } from "./camera.js";
import { createLabels } from "./labels.js";

// 构建标记：刷新后可在控制台确认运行的是哪一版
const BUILD = "2026-11-05 · per-body-iau";
console.info("[solar] build " + BUILD);
window.__solarBuild = BUILD;
if (qStatic) document.documentElement.classList.add("static");

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance",
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
const {
  stars, sunUniforms, sunRecord, coronas, sunDot,
  planets, moonMesh, moonDot,
} = space;

// 全景按钮回到远景：rig 在下面创建，回调在此刻之后才会被点击触发
let rig;
const hud = createHud({ onHome: () => rig.resetView() });
rig = createCameraRig({ canvas, camera, space, hud });
const labels = createLabels({ space, rig, camera });

// ?size= 生效时，「尺寸与轨道等比例」不再成立，如实标注
if (RADIUS_SCALE !== 1) {
  const sub = document.querySelector("#hud .sub");
  if (sub) sub.textContent = `程序生成太阳系 · 轨道等比例 · 天体半径放大 ${RADIUS_SCALE}×`;
}

// 调试探针按需加载，正常访问不下载解析
if (Q.get("debug") === "1") {
  import("./debug.js").then((m) => m.installDebug({ space, rig, hud, camera }));
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

  // 太阳
  sunUniforms.uTime.value = t;
  // 亮度随距离：0 = 远观，1 = 贴近（约 80 倍日面半径以内开始增强）
  sunUniforms.uProx.value = Math.min(1, Math.max(0, 1 - camera.position.length() / (SUN_CFG.radius * 80)));

  // 公转、自转、地月质心都由 simTime（距 J2000 的天数）直接决定；
  // 自转姿态来自 IAU 极轴 + W 速率，?t= 截图也能对齐。
  updatePlanets(planets, simTime);
  updateSun(sunRecord, simTime);

  for (const p of planets) {
    const { cfg, dot } = p;

    // 最小可见光点：本体投影直径小于 6px 时才亮起，否则淡出
    if (dot) {
      const camDist = camera.position.distanceTo(p.group.position);
      const dPx = (cfg.radius * 2) / (camDist * Math.tan(camera.fov * Math.PI / 360)) * (innerHeight / 2);
      // 6px 以下 → 完全显示；12px 以上 → 完全关闭
      const fade = Math.min(1, Math.max(0, (12 - dPx) / 6));
      dot.material.opacity = fade * 0.55;
      // 随真实球体变大逐渐缩小，给拉近过程一个连续的视觉反馈
      dot.material.size = Math.max(5, Math.min(11, 11 - dPx * 0.6));
      dot.visible = fade > 0.02;
    }

    p.mesh.material.uniforms.uTime.value = t;
  }

  // 太阳指示点：按投影尺寸淡入淡出，与行星光点同一规则
  {
    const sunPx = (SUN_CFG.radius * 2) / (camera.position.length()
      * Math.tan(camera.fov * Math.PI / 360)) * (innerHeight / 2);
    const fade = Math.min(1, Math.max(0, (12 - sunPx) / 6));
    sunDot.material.opacity = fade * 0.62;
    sunDot.material.size = Math.max(7, Math.min(13, 13 - sunPx * 0.5));
    sunDot.visible = fade > 0.02;
  }

  // 月球指示点：球体仍是亚像素大小时显示
  if (moonMesh && moonDot) {
    moonMesh.getWorldPosition(tmpV);
    const camDist = camera.position.distanceTo(tmpV);
    const dPx = (MOON_CFG.radius * 2) / (camDist * Math.tan(camera.fov * Math.PI / 360)) * (innerHeight / 2);
    const fade = Math.min(1, Math.max(0, (12 - dPx) / 6));
    moonDot.material.opacity = fade * 0.5;
    moonDot.material.size = Math.max(4, Math.min(9, 9 - dPx * 0.5));
    moonDot.visible = fade > 0.02;
  }

  // 星空是贴相机的球壳：平移/拉远时不会「飞出」星壳
  stars.uniforms.uTime.value = t;

  rig.updateCamera(dt);

  // 光晕/星壳跟着「本帧」相机走：必须在 updateCamera 之后，
  // 否则快速拖动时用的是上一帧姿态，日冕面片会歪斜、星壳横向游移
  for (const c of coronas) c.quaternion.copy(camera.quaternion);
  stars.points.position.copy(camera.position);

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
