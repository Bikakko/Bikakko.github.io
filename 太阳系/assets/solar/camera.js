/* ============================================================
   太阳系 · Solar · 轨道相机
   - 自实现，远景限制在黄道面上方（无 OrbitControls）
   - 触屏：touch-action + 手写 touch 事件
   - 滚轮：以光标为锚点平滑推拉（不聚焦、不猜目标）
   职责拆分：拾取在 camera-pick.js，聚焦/过渡在 camera-focus.js；
   本文件只管轨道状态、缩放手势与每帧相机推进。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { qAz, qEl, qDist } from "./config.js";
import {
  hasDragged, pinchZoomDistance, MIN_PHI, maxPhiForDistance, keyboardMoveMode,
} from "./camera-math.js";
import { createPicker } from "./camera-pick.js";
import { createFocusControl, SURFACE_RATIO } from "./camera-focus.js";

export function createCameraRig({ canvas, camera, space, hud }) {
  const { focusables, moonMesh, sunGroup } = space;

  // 「全景」默认视角；?az / ?el 可覆盖，方便截图（el 夹进合法极角范围）
  const HOME_THETA = qAz !== null ? qAz * Math.PI / 180 : Math.PI * 0.22;
  const HOME_PHI   = qEl !== null
    ? Math.min(Math.PI * 0.495, Math.max(0.10, qEl * Math.PI / 180))
    : Math.PI * 0.30;

  const orbit = {
    // phi 从「竖直向上」量起：0 = 正上方俯视，PI/2 = 水平
    theta: HOME_THETA,
    phi: HOME_PHI,
    dist: 400,   // 下面按 ?dist / 视口自适应覆盖
    tTheta: 0, tPhi: 0, tDist: 0,
    target: new THREE.Vector3(0, 0, 0),
    panOffset: new THREE.Vector3(0, 0, 0),   // 右键平移到偏移量
  };
  orbit.tTheta = orbit.theta;
  orbit.tPhi = orbit.phi;
  orbit.tDist = orbit.dist;

  /* 按视口自动算出「刚好装下全部轨道」的距离：
     竖屏时水平视角窄，必须拉得更远，否则外圈行星被裁。
     这个函数在 init 和 resize 时都会跑，手机就不会漏掉海王星。 */
  const OUTER_ORBIT = Math.max(...PLANETS.map(p => p.orbit)) * 1.02 + 12;

  function fitDistance() {
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);

    // 竖屏时水平视角很窄，必须按「水平方向能否装下」来算。
    // 再给标签留出固定像素宽度：屏幕宽度的 22%（两侧各 11%）不让行星进去。
    const usable = 0.78;
    const needV = OUTER_ORBIT / Math.tan(vFov / 2) / usable;
    const needH = OUTER_ORBIT / Math.tan(hFov / 2) / usable;
    return Math.max(needV, needH);
  }

  // 关键：远景时上限卡在水平面之前，不钻到轨道面下方；
  // 近距离观测时放开到可以看星球底面（随距离平滑过渡）。
  // 曲线与夹取判据抽到 camera-math.js，便于单测与逐帧重夹。
  function maxPhi() {
    return maxPhiForDistance(orbit.dist);
  }
  // 自由视角下限：贴到太阳半径附近即可，不再用与尺度无关的 0.6
  const PANORAMA_MIN_DIST = 0.05;
  let MAX_DIST = 1200;
  // 显式 ?dist= 是截图参数：resize（含截图时的视口初始化）不应把它弹回全景
  const distExplicit = qDist !== null;

  // 没显式指定 dist 时，用视口自适应距离；显式指定也要夹进合法区间
  if (qDist === null) {
    orbit.dist = orbit.tDist = fitDistance();
  }
  MAX_DIST = Math.max(MAX_DIST, fitDistance() * 2.2);
  if (qDist !== null) {
    const dq = Math.min(MAX_DIST, Math.max(PANORAMA_MIN_DIST, qDist));
    orbit.dist = orbit.tDist = dq;
  }

  let dragging = false;
  let lastX = 0, lastY = 0;
  let pointerMoved = false;
  // 用户是否主动改变过视角（推拉/平移/旋转/聚焦）。resize 只在从未动过时重算全景距离
  let viewTouched = false;

  // 右键在本应用中是「平移视角」手势。行星标签等 DOM 覆盖层浮在 canvas
  // 之上，contextmenu 的 target 不是 canvas，因此要在整个文档范围屏蔽菜单。
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // 0=左键 2=右键。两者都用于拖动；只有左键点击会触发聚焦
  // 右键平移：按屏幕像素换算成世界坐标位移，方向跟随当前相机朝向。
  // 系数要跟「一个屏幕高度覆盖多少世界单位」对齐，否则手感要么拖不动要么飞出去。
  const _panRight = new THREE.Vector3();
  const _panUp = new THREE.Vector3();
  const _panMove = new THREE.Vector3();

  function panTarget(dx, dy) {
    _panRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _panUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    // 相机距离处，一个像素对应多少世界单位
    const worldPerPx = (2 * orbit.dist * Math.tan(camera.fov * Math.PI / 360)) / innerHeight;

    _panMove.set(0, 0, 0);
    _panMove.addScaledVector(_panRight, -dx * worldPerPx);
    _panMove.addScaledVector(_panUp, dy * worldPerPx);

    // 只改偏移量，updateCamera 每帧会把它叠加进 target
    cancelZoom();   // 平移接管，停掉缩放动画
    viewTouched = true;
    orbit.panOffset.add(_panMove);
  }

  /* ---------- 缩放对准光标 ---------- */
  const _zoomRight = new THREE.Vector3();
  const _zoomUp = new THREE.Vector3();
  const _zoomAnchor = new THREE.Vector3();
  const _zoomTRef = new THREE.Vector3();
  const _zoomTDesired = new THREE.Vector3();
  const _zoomDelta = new THREE.Vector3();
  // 进行中的推拉动画：滚轮只设定目标距离和锚点，不直接拍 dist/target。
  // updateCamera 每帧按已缓动的 dist 反推 target，动画全程锚点都钉在光标下，
  // 消除「上一格星球还是小点、下一格直接贴到表面」的跳变。
  let zoomRefDist = 0;
  // 粘性锚点天体：连续滚动期间沿用同一颗（跟其公转位置），直到光标明显移走
  // 或其他手势接管，避免行星漂出拾取窗后锚点跳到别的天体
  let zoomAnchorObj = null;
  let zoomAnchorRadius = 0;
  let zoomAnchorX = 0, zoomAnchorY = 0;

  // 停掉缩放动画的统一入口：平移/聚焦/复位接管时都走这里，
  // 不再在各手势入口手工同步这两个变量
  function cancelZoom() {
    zoomRefDist = 0;
    zoomAnchorObj = null;
  }

  const picker = createPicker({ camera, space });
  const focus = createFocusControl({
    orbit, camera, hud, cancelZoom,
    markViewTouched: () => { viewTouched = true; },
  });

  // 保持「锚点」在推拉前后落在同一屏幕位置：距离从 d0 变到 d1 时
  // target 平移 (1 - d1/d0)·(锚点 - target)。锚点是光标下的天体中心；
  // 空白处退回过 target、垂直视线的平面上的光标点（原行为）。
  // target 的平移不在这里一次做完，交给 updateCamera 随 dist 缓动逐帧推进。
  function zoomTowardCursor(newDist, clientX, clientY) {
    const d0 = orbit.dist;
    if (!(d0 > 0)) return;

    // 聚焦时忽略光标偏移；但向外滚过 60 倍半径后自动取消选中，
    // 本格起改按自由视角继续拉远——滚轮拉远就是「放手」的统一下拉手势
    if (focus.getTarget()) {
      const df = Math.min(MAX_DIST, Math.max(focus.minDistance(PANORAMA_MIN_DIST), newDist));
      if (!Number.isFinite(df)) return;
      if (df <= focus.releaseDistance()) {
        orbit.tDist = df;
        return;
      }
      focus.release();
    }

    camera.updateMatrixWorld();
    _zoomTRef.copy(orbit.target);

    // 粘性锚点：光标基本没动就无条件沿用上一次锚到的天体（每格跟随它的
    // 公转实时位置），不再逐格重新拾取。行星漂出拾取窗后若重新拾取，
    // 窗口可能套到旁边的天体（月球/太阳），近距离下 target 会朝它跳一大步，
    // 把正在逼近的星球甩出画面——这就是「镜头失去目标」的来源。
    let anchorObj = null;
    if (zoomAnchorObj
        && Math.hypot(clientX - zoomAnchorX, clientY - zoomAnchorY) < 30) {
      zoomAnchorObj.getWorldPosition(_zoomAnchor);
      anchorObj = zoomAnchorObj;
    }
    if (!anchorObj) {
      anchorObj = picker.pickZoomAnchor(clientX, clientY, _zoomAnchor);
      if (anchorObj) {
        zoomAnchorObj = anchorObj;
        zoomAnchorX = clientX;
        zoomAnchorY = clientY;
      } else if (zoomAnchorObj) {
        // 光标移开且附近没有别的天体：沿用原锚点继续推拉。
        // 不能退回空白平面——下限会从 1.05R 抬回 0.05，视角会瞬间「弹出」
        zoomAnchorObj.getWorldPosition(_zoomAnchor);
        anchorObj = zoomAnchorObj;
      } else {
        zoomAnchorObj = null;
      }
    }
    zoomAnchorRadius = anchorObj ? picker.bodyRadiusOf(anchorObj) : 0;

    if (!anchorObj) {
      const ndcX = (clientX / innerWidth) * 2 - 1;
      const ndcY = -(clientY / innerHeight) * 2 + 1;
      const halfH = d0 * Math.tan(camera.fov * Math.PI / 360);
      const halfW = halfH * camera.aspect;
      _zoomRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      _zoomUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      _zoomAnchor.copy(_zoomTRef)
        .addScaledVector(_zoomRight, ndcX * halfW)
        .addScaledVector(_zoomUp, ndcY * halfH);
    }

    // 锚定天体时允许贴到它表面附近（与聚焦同一量级），
    // 否则统一卡在 0.05，内行星拉到底也只有几个像素。
    // 没锚到天体时保持全景下限。
    const floor = anchorObj ? Math.max(zoomAnchorRadius * SURFACE_RATIO, 1e-5) : PANORAMA_MIN_DIST;
    const d1 = Math.min(MAX_DIST, Math.max(floor, newDist));
    if (!Number.isFinite(d1)) return;

    zoomRefDist = d0;
    orbit.tDist = d1;
  }

  let dragButton = 0;
  let dragStartX = 0, dragStartY = 0;

  function takeOverCamera() {
    focus.cancelFlight();
    zoomRefDist = 0;
    orbit.tDist = orbit.dist;
    orbit.tTheta = orbit.theta;
    orbit.tPhi = orbit.phi;
  }

  function beginCameraDrag() {
    viewTouched = true;
    takeOverCamera();
  }

  canvas.addEventListener("pointerdown", (e) => {
    // 触摸由下面的 touch 事件独占处理，避免 pointer/touch 双份触发
    if (e.pointerType === "touch") return;
    if (e.button !== 0 && e.button !== 2) return;

    dragButton = e.button;
    dragging = true;
    pointerMoved = false;
    dragStartX = lastX = e.clientX;
    dragStartY = lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (!pointerMoved && hasDragged(dragStartX, dragStartY, e.clientX, e.clientY)) {
      pointerMoved = true;
      beginCameraDrag();
      document.documentElement.classList.add("dragging");
    }
    if (!pointerMoved) return;

    if (dragButton === 2) {
      panTarget(dx, dy);
    } else {
      orbit.tTheta -= dx * 0.0048;
      orbit.tPhi = Math.min(maxPhi(), Math.max(MIN_PHI, orbit.tPhi - dy * 0.0040));
    }
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove("dragging");
    if (e && e.pointerId !== undefined) {
      try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);
  addEventListener("blur", endDrag);

  function handleWheel(e) {
    e.preventDefault();
    if (focus.isFlying()) {
      focus.cancelFlight();
      zoomRefDist = 0;
      orbit.tDist = orbit.dist;
    }
    // 指数式缩放：每格固定「乘一个倍率」，远近手感一致。
    // 倍率要配得上天文尺度的动态范围：全景 923 → 星球表面 0.0005 有 6 个数量级，
    // 每格 1.25 倍要滚 65 格才看得见星球，所以取每格 ≈ 1.8 倍（约 24 格到底）。
    // deltaMode 归一化：Firefox 行模式按行计（每行约 33px），否则手感差 30 倍
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1;
    const raw = e.deltaY * unit;
    const step = Math.min(Math.abs(raw) / 100, 3);      // 归一化到「格」
    // 灵敏度细化：近距离（dist<5）且视线贴近黄道面时降低每格倍率。
    // 视线越扁，屏幕上的位移对推拉越敏感，放慢才能把镜头精确对准目标。
    const prox = Math.min(1, Math.max(0, (5 - orbit.dist) / 4.95));
    const planeF = Math.sin(orbit.phi) ** 2;   // 越贴黄道面越接近 1
    const refine = 1 - 0.65 * prox * planeF;
    // 向前滚（deltaY < 0）＝ 拉近（距离变小），向后滚 ＝ 拉远
    const zoom = Math.exp(Math.sign(raw) * step * 0.6 * refine);

    // 滚轮不做聚焦、不猜目标：只以光标下的天体中心（空白处用等深平面点）
    // 为锚点平滑推拉。想绕着某颗星球观察请点击它聚焦。

    // 幅度保护：仅当这一格与正在进行的滑行方向相反时，先吸收未完成的滑行，
    // 避免反向的一格被连乘的 tDist 放大成一次大回拉；同向滚动保持惯性
    const gliding = orbit.tDist - orbit.dist;
    if (Math.abs(gliding) > orbit.dist * 0.3
        && Math.sign(gliding) !== Math.sign(zoom - 1)) {
      orbit.tDist = orbit.dist;
    }

    // 冻结当前朝向，避免残余缓动在缩放过程中改变视角
    viewTouched = true;
    orbit.tTheta = orbit.theta;
    orbit.tPhi = orbit.phi;
    // 以鼠标箭头为不动点推拉，而不是始终对准屏幕中心
    zoomTowardCursor(orbit.tDist * zoom, e.clientX, e.clientY);
  }
  canvas.addEventListener("wheel", handleWheel, { passive: false });

  /* ---------- 触摸：手写 touch，防 pointer 被吞 ---------- */
  let pinchStart = 0, pinchDist = 0;
  let touchLastX = 0, touchLastY = 0, touchDragging = false, touchDragStarted = false;
  // touchend 自己完成 tap，避免 preventDefault 吞掉合成 click
  let touchTapX = 0, touchTapY = 0, touchTapMoved = false, touchLastTapAt = 0;

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      touchDragging = false;
      touchDragStarted = false;
      touchTapMoved = true;
      takeOverCamera();
      viewTouched = true;
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchDist = orbit.dist;
    } else if (e.touches.length === 1) {
      touchDragging = true;
      touchDragStarted = false;
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
      touchTapX = touchLastX;
      touchTapY = touchLastY;
      touchTapMoved = false;
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchStart > 0) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      zoomTowardCursor(pinchZoomDistance(pinchDist, pinchStart, d), midX, midY);
    } else if (touchDragging && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - touchLastX;
      const dy = t.clientY - touchLastY;
      touchLastX = t.clientX;
      touchLastY = t.clientY;
      if (!touchDragStarted && hasDragged(touchTapX, touchTapY, t.clientX, t.clientY)) {
        touchDragStarted = true;
        touchTapMoved = true;
        beginCameraDrag();
      }
      if (touchDragStarted) {
        orbit.tTheta -= dx * 0.0048 * 1.7;
        orbit.tPhi = Math.min(maxPhi(), Math.max(MIN_PHI, orbit.tPhi - dy * 0.0040 * 1.7));
      }
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      const wasTap = !touchTapMoved;
      touchDragging = false;
      touchDragStarted = false;
      pinchStart = 0;
      if (wasTap) {
        const t = e.changedTouches[0];
        const hit = picker.pickPlanet(t.clientX, t.clientY);
        if (hit) {
          const holder = focusables.find(f => f.cfg === hit.userData);
          if (holder) focus.focusOn(holder.cfg, holder.group);
          touchLastTapAt = 0;
        } else {
          if (focus.getTarget()) focus.release();
          const now = performance.now();
          if (now - touchLastTapAt < 350) resetView();
          touchLastTapAt = now;
        }
      }
    } else if (e.touches.length === 1) {
      pinchStart = 0;
      touchDragging = true;
      touchDragStarted = true;
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchcancel", () => {
    touchDragging = false;
    touchDragStarted = false;
    touchTapMoved = true;
    pinchStart = 0;
  });

  /* ---------- 点击聚焦：状态与过渡在 camera-focus.js ---------- */
  function resetView() {
    focus.clear();
    orbit.panOffset.set(0, 0, 0);
    cancelZoom();            // 复位接管，停掉缩放动画，旧锚点不再沿用
    viewTouched = false;     // 回到全景后，resize 重新允许自适应距离
    orbit.tDist = fitDistance();
    orbit.tTheta = HOME_THETA;
    orbit.tPhi = HOME_PHI;
    hud.hideInfo();
  }

  canvas.addEventListener("click", (e) => {
    if (pointerMoved) return;   // 拖动结束不触发聚焦
    if (e.button !== 0) return; // 右键不聚焦
    const hit = picker.pickPlanet(e.clientX, e.clientY);
    if (hit) {
      // 行星/卫星本体和最小光点的 userData 都是同一个 cfg，回查聚焦对象
      const holder = focusables.find(f => f.cfg === hit.userData);
      if (holder) focus.focusOn(holder.cfg, holder.group);
      return;
    }
    // 单击空白取消选中：只释放锁定，保持当前视角
    if (focus.getTarget()) focus.release();
  });

  // Esc 取消选中（保持当前视角，不回到远景）
  addEventListener("keydown", (e) => {
    if (e.code === "Escape" && focus.getTarget()) focus.release();
  });

  canvas.addEventListener("dblclick", (e) => {
    // 双击天体只聚焦，不回到远景
    if (picker.pickPlanet(e.clientX, e.clientY)) return;
    resetView();
  });

  /* ---------- WASD 平移视角 ---------- */
  const moveKeys = new Set();
  const _moveFwd = new THREE.Vector3();
  const _moveRight = new THREE.Vector3();
  const _moveStep = new THREE.Vector3();

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 与 hud.js / light-hud.js 一致：焦点在按钮/标签/表单上时不劫持按键
    if (e.target && e.target.closest
        && e.target.closest("button, a, input, textarea, select, .lbl")) return;
    if (e.code === "KeyW" || e.code === "KeyA" || e.code === "KeyS" || e.code === "KeyD") {
      moveKeys.add(e.code);
      e.preventDefault();
    }
  });
  addEventListener("keyup", (e) => moveKeys.delete(e.code));
  addEventListener("blur", () => moveKeys.clear());

  function updateKeyboardMove(dt) {
    const f = (moveKeys.has("KeyW") ? 1 : 0) - (moveKeys.has("KeyS") ? 1 : 0);
    const r = (moveKeys.has("KeyD") ? 1 : 0) - (moveKeys.has("KeyA") ? 1 : 0);
    if (!f && !r) return;

    // 聚焦过渡中忽略按键（中途取消会让镜头停在半途且仍显示「已聚焦」）；
    // 聚焦态一律环绕，绝不走平移分支（panOffset 累积会把镜头带离行星）。
    const mode = keyboardMoveMode({ isFocused: !!focus.getTarget(), isFlying: focus.isFlying() });
    if (mode === "ignore") return;
    if (zoomRefDist > 0 || orbit.tDist !== orbit.dist) takeOverCamera();
    zoomAnchorObj = null;
    viewTouched = true;

    // 环绕天体：既不会把相机推进球体，也始终对准星球
    if (mode === "orbit") {
      orbit.tTheta -= r * 1.0 * dt;
      orbit.tPhi = Math.min(maxPhi(), Math.max(MIN_PHI, orbit.tPhi - f * 0.6 * dt));
      return;
    }

    // 自由视角：沿当前视角水平前向/右向平移目标点
    _moveFwd.set(-Math.sin(orbit.theta), 0, -Math.cos(orbit.theta));
    _moveRight.set(Math.cos(orbit.theta), 0, -Math.sin(orbit.theta));
    _moveStep.set(0, 0, 0).addScaledVector(_moveFwd, f).addScaledVector(_moveRight, r);
    if (_moveStep.lengthSq() === 0) return;
    // 速度与当前距离成比例：拉得越近走得越慢，任何尺度都是同样的屏幕速度
    const speed = orbit.dist * 0.5;
    _moveStep.normalize().multiplyScalar(speed * dt);

    orbit.panOffset.add(_moveStep);
    orbit.target.add(_moveStep);
  }

  const _base = new THREE.Vector3();

  function updateCamera(dt) {
    updateKeyboardMove(dt);

    // 先把 theta/phi/dist 缓动到本帧值。推拉补偿必须用和相机同一个 dist，
    // 差一帧就会让锚点每帧漂一点；连续滚动时每格都在滑行中途重新锚定，
    // 误差被逐格继承、累积成几十像素的可见偏移。
    // 距离在对数空间缓动：跨 6 个数量级时，线性缓动前段瞬移、末段几乎不动
    // 仰角每帧按「本帧距离」重夹目标值：近距离钻到黄道面下方是允许的，
    // 但拉远后必须平滑回到上方，否则「远景不低于黄道面」的不变量会失效。
    // 只夹 tPhi、靠已有缓动把 phi 带回来，避免视角瞬间跳变。
    orbit.tPhi = Math.min(maxPhi(), Math.max(MIN_PHI, orbit.tPhi));
    const k = 1 - Math.pow(0.0009, dt);
    orbit.theta += (orbit.tTheta - orbit.theta) * k;
    orbit.phi   += (orbit.tPhi   - orbit.phi)   * k;
    if (!focus.isFlying()) {
      const curLog = Math.log(Math.max(orbit.dist, 1e-9));
      const tgtLog = Math.log(Math.max(orbit.tDist, 1e-9));
      orbit.dist = Math.exp(curLog + (tgtLog - curLog) * k);
    }

    // 推拉动画：按 r = dist/refDist 反推 target，让锚点全程钉在光标下。
    // 收尾判据必须相对「目标距离」：深潜时 tDist 比 refDist 小几个数量级，
    // 用 refDist 的比例会在半路就判定完成，残留的偏移在终点放大成整屏。
    // 锚点每帧刷新为天体的实时位置：滑行要两三秒，行星自己会走出几十个
    // 「当前距离」，冻结的世界坐标到终点必然脱靶。
    // 收尾帧用终点 r 做最后一次补偿再结束，保证每格零残差。
    if (zoomRefDist > 0 && !focus.getTarget()) {
      if (zoomAnchorObj) zoomAnchorObj.getWorldPosition(_zoomAnchor);
      const done = Math.abs(orbit.dist - orbit.tDist) < Math.max(orbit.tDist * 0.01, 1e-9);
      const r = (done ? orbit.tDist : orbit.dist) / zoomRefDist;
      _zoomTDesired.copy(_zoomAnchor).sub(_zoomTRef).multiplyScalar(1 - r).add(_zoomTRef);
      _zoomDelta.copy(_zoomTDesired).sub(orbit.target);
      orbit.target.add(_zoomDelta);
      orbit.panOffset.add(_zoomDelta);
      if (done) zoomRefDist = 0;
    }

    // 目标点 = 基准位置（焦点行星或原点） + 右键平移偏移
    _base.set(0, 0, 0);
    const ft = focus.getTarget();
    if (ft) {
      ft.group.getWorldPosition(_base);
    }
    _base.add(orbit.panOffset);

    // 聚焦过渡由 camera-focus.js 推进；返回 true 表示本帧已被过渡接管
    if (!focus.updateFlight(_base)) {
      const k2 = 1 - Math.pow(0.002, dt);
      // 聚焦且已拉近时目标必须严格跟随行星：近距离下插值滞后会让行星跑出画面
      if (ft && orbit.dist < 20) {
        orbit.target.copy(_base);
      } else {
        orbit.target.lerp(_base, k2);
      }
    }

    const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
    camera.position.set(
      orbit.target.x + orbit.dist * sp * Math.sin(orbit.theta),
      orbit.target.y + orbit.dist * cp,
      orbit.target.z + orbit.dist * sp * Math.cos(orbit.theta)
    );
    camera.lookAt(orbit.target);

    // 近平面随相机距离同步缩放：全景保持 0.5，聚焦到真实尺寸行星时
    // 必须降到远小于天体半径，否则整颗行星都会被近平面裁掉。
    const near = Math.min(0.5, Math.max(1e-6, orbit.dist * 0.01));
    if (Math.abs(camera.near - near) > near * 0.01) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  // 视口变化：更新远距上限；用户从未动过视角时才重算全景距离，
  // 否则 resize（旋转屏幕/移动端 UI 收放/分屏）会把自由推拉中的视角强行弹回
  function onResize() {
    MAX_DIST = Math.max(1200, fitDistance() * 2.2);
    if (orbit.tDist > MAX_DIST) orbit.tDist = MAX_DIST;
    if (!viewTouched && !focus.getTarget() && !distExplicit) orbit.tDist = fitDistance();
  }

  return {
    orbit,
    updateCamera,
    resetView,
    focusOn: focus.focusOn,
    focusSnap: focus.focusSnap,
    handleWheel,
    fitDistance,
    onResize,
    getFocusTarget: focus.getTarget,
    // 调试用：当前推拉锚点是谁
    getZoomAnchorName: () => {
      if (!zoomAnchorObj) return null;
      if (zoomAnchorObj === moonMesh) return "月球";
      if (zoomAnchorObj === sunGroup) return "太阳";
      const p = space.planets.find(x => x.group === zoomAnchorObj);
      return p ? p.cfg.name : "?";
    },
  };
}
