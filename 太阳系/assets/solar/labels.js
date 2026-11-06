/* ============================================================
   太阳系 · Solar · 行星标签
   3D 位置投影到屏幕，固定在星球正下方，不做任何布局避让。
   除月球与地球标签重叠时的避让外，标签一律不隐藏：屏幕外或相机背后的
   天体，标签按其方位钉到视口边缘，拉近后依然常驻可见。
   ============================================================ */
import * as THREE from "three";
import { MOON_CFG, SUN_CFG } from "./bodies.js";

export function createLabels({ space, rig, camera }) {
  const { planets, moonMesh, sunGroup } = space;

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

    /* 第一遍：所有天体的屏幕数据（用于可见性判断、定位与月球避让） */
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
      // 除月球外标签一律不隐藏。屏内贴在星球正下方；屏幕外或相机背后的
      // 天体把标签按方位钉到视口边缘，仍常驻可见。
      let visible = true;

      // 唯一的例外：月球只在该天体本身在屏内、且与地球标签分开时显示；
      // 否则隐藏（月球可以隐藏，也不该被钉到远离地球的屏幕边缘）
      if (r.p.cfg === MOON_CFG && earthRec) {
        const mOn = r.inFront && r.z < 1
          && Math.abs(r.ndcX) < 1 && Math.abs(r.ndcY) < 1;
        const eOn = earthRec.inFront && earthRec.z < 1
          && Math.abs(earthRec.ndcX) < 1 && Math.abs(earthRec.ndcY) < 1;
        if (!mOn || (eOn && Math.hypot(r.sx - earthRec.sx, r.sy - earthRec.sy) < 24)) {
          visible = false;
        }
      }

      if (!visible) {
        r.el.classList.remove("on");
        r.el.tabIndex = -1;   // 不可见的标签不留在 Tab 序里
        r.shown = false;
        continue;
      }

      const inView = r.inFront && r.z < 1
        && Math.abs(r.ndcX) < 1 && Math.abs(r.ndcY) < 1;
      let outX, outY;
      if (inView) {
        // 固定在星球正下方的固定偏移（球面下缘 +10px），不避让、不缓动
        outX = r.sx;
        outY = Math.min(r.sy + r.rPx + 10, innerHeight - 26);
      } else {
        // 屏幕坐标 y 向下；相机背后的天体投影方向是翻转的，取反才是真实方位
        let dx = r.ndcX, dy = -r.ndcY;
        if (!r.inFront) { dx = -dx; dy = -dy; }
        const m = Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
        const edge = 64;   // 距视口边缘的内缩，避免标签被裁掉
        outX = halfW + (dx / m) * (halfW - edge);
        outY = halfH + (dy / m) * (halfH - edge);
      }
      // 夹进视口，避免屏幕外定位撑出滚动条
      outX = Math.min(Math.max(outX, 34), innerWidth - 34);
      outY = Math.min(Math.max(outY, 20), innerHeight - 26);

      // 用 transform 定位避免每帧触发布局，位置没变则不重写（省重绘）
      if (!r.shown || Math.abs(outX - r.lastX) > 0.5 || Math.abs(outY - r.lastY) > 0.5) {
        r.el.style.transform = `translate(${outX.toFixed(1)}px, ${outY.toFixed(1)}px) translate(-50%, 0)`;
        r.lastX = outX;
        r.lastY = outY;
      }
      r.el.tabIndex = 0;
      r.el.classList.add("on");
      r.shown = true;
    }
  }

  return { updateLabels };
}
