/* ============================================================
   太阳系 · Solar · 行星标签
   3D 位置投影到屏幕，固定贴在星球正下方，不做任何布局避让
   ============================================================ */
import * as THREE from "three";
import { MOON_CFG, SUN_CFG } from "./bodies.js";

export function createLabels({ space, rig, camera }) {
  const { planets, moonMesh, sunGroup } = space;
  const orbit = rig.orbit;

  const labelsEl = document.getElementById("labels");
  // 标签点击聚焦；滚轮不做特殊处理，经冒泡走普通拉近推远
  labelsEl.addEventListener("wheel", rig.handleWheel, { passive: false });

  function makeLabel(cfg, group, html, title) {
    const el = document.createElement("div");
    el.className = "lbl";
    el.innerHTML = html;   // 内容全为常量；若改为动态内容请改用 textContent
    el.title = title;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      rig.focusOn(cfg, group);
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        rig.focusOn(cfg, group);
      }
    });
    labelsEl.appendChild(el);
    return el;
  }

  // 预分配记录，逐帧只写字段，避免每帧创建对象与数组
  const records = [];
  const addRecord = (cfg, group, html, title) => {
    records.push({
      el: makeLabel(cfg, group, html, title),
      p: { cfg, group },
      inFront: false, z: 1, ndcX: 0, ndcY: 0, sx: 0, sy: 0, worldDist: 0, rPx: 0,
      lastX: NaN, lastY: NaN, shown: false,
    });
  };
  for (const p of planets) {
    addRecord(p.cfg, p.group, `${p.cfg.name}<em>${p.cfg.aAU.toFixed(2)} AU</em>`, `聚焦到${p.cfg.name}`);
  }
  if (moonMesh) addRecord(MOON_CFG, moonMesh, `月球<em>384,400 km</em>`, "聚焦到月球");
  addRecord(SUN_CFG, sunGroup, `太阳<em>恒星</em>`, "聚焦到太阳");

  const earthRec = records.find(r => r.p.cfg.name === "地球") || null;
  const projV = new THREE.Vector3();
  const _viewV = new THREE.Vector3();

  function updateLabels() {
    const halfW = innerWidth / 2, halfH = innerHeight / 2;
    const tanHalf = Math.tan(camera.fov * Math.PI / 360);

    /* 第一遍：所有天体的屏幕数据（同时用于可见性、遮挡与月球避让） */
    for (const r of records) {
      r.p.group.getWorldPosition(projV);
      // 先取世界距离再投影；卫星的 group 有父级变换，不能用 group.position
      r.worldDist = camera.position.distanceTo(projV);
      // 视图空间 z < 0 才是相机前方：投影后的 z 对背后点不可靠
      _viewV.copy(projV).applyMatrix4(camera.matrixWorldInverse);
      r.inFront = _viewV.z < 0;
      projV.project(camera);
      r.ndcX = projV.x; r.ndcY = projV.y; r.z = projV.z;
      r.sx = (projV.x * halfW) + halfW;
      r.sy = (-projV.y * halfH) + halfH;
      r.rPx = (r.p.cfg.radius / (Math.max(r.worldDist, 1e-9) * tanHalf)) * halfH;
    }

    /* 第二遍：可见性 + 固定位置 */
    for (const r of records) {
      const onScreen = r.inFront && r.z < 1
        && Math.abs(r.ndcX) < 1.2 && Math.abs(r.ndcY) < 1.2;
      // 可见性只由相机距离决定，与是否选中无关（点选/滚轮拉近一致）：
      // 距离下限 200 保证近距离推拉时远处仍在画面里的标签不消失
      const hideDist = Math.max(orbit.dist * 1.8, 200);
      let visible = onScreen && r.worldDist <= hideDist;

      // 遮挡剔除：被更近的大圆盘（且在屏内）挡住的天体不显示标签
      if (visible) {
        for (const o of records) {
          if (o === r || !o.inFront || o.rPx < 30 || r.worldDist <= o.worldDist) continue;
          const oOn = o.z < 1 && Math.abs(o.ndcX) < 1.2 && Math.abs(o.ndcY) < 1.2;
          if (oOn && Math.hypot(r.sx - o.sx, r.sy - o.sy) < o.rPx) { visible = false; break; }
        }
      }

      // 月球标签只在和地球屏幕位置分开时显示，否则会与地球标签叠在一起
      if (visible && r.p.cfg === MOON_CFG && earthRec) {
        const eOn = earthRec.inFront && earthRec.z < 1
          && Math.abs(earthRec.ndcX) < 1.2 && Math.abs(earthRec.ndcY) < 1.2;
        if (eOn && Math.hypot(r.sx - earthRec.sx, r.sy - earthRec.sy) < 24) visible = false;
      }

      if (!visible) {
        r.el.classList.remove("on");
        r.el.tabIndex = -1;   // 不可见的标签不留在 Tab 序里
        r.shown = false;
        continue;
      }

      // 固定在星球正下方的固定偏移（球面下缘 +10px），不避让、不缓动；
      // 用 transform 定位避免每帧触发布局，位置没变则不重写（省重绘）
      const syOut = Math.min(r.sy + r.rPx + 10, innerHeight - 26);
      if (!r.shown || Math.abs(r.sx - r.lastX) > 0.5 || Math.abs(syOut - r.lastY) > 0.5) {
        r.el.style.transform = `translate(${r.sx.toFixed(1)}px, ${syOut.toFixed(1)}px) translate(-50%, 0)`;
        r.lastX = r.sx;
        r.lastY = syOut;
      }
      r.el.tabIndex = 0;
      r.el.classList.add("on");
      r.shown = true;
    }
  }

  return { updateLabels };
}
