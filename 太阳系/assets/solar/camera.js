/* ============================================================
   太阳系 · Solar · 轨道相机
   - 自实现，远景限制在黄道面上方（无 OrbitControls）
   - 触屏：touch-action + 手写 touch 事件
   - 滚轮：以光标为锚点平滑推拉（不聚焦、不猜目标）
   ============================================================ */
import * as THREE from "three";
import { PLANETS, MOON_CFG, SUN_RADIUS, qAz, qEl, qDist } from "./config.js";
import { hasDragged, pinchZoomDistance } from "./camera-math.js";

export function createCameraRig({ canvas, camera, space, hud }) {
  const { planets, focusables, clickable, moonMesh, sunGroup } = space;

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
  // 近距离观测时放开到可以看星球底面（随距离平滑过渡）
  const MIN_PHI = 0.10, MAX_PHI = Math.PI * 0.495;
  const MAX_PHI_UNDER = Math.PI * 0.95;
  function maxPhi() {
    const t = Math.min(1, Math.max(0, (10 - orbit.dist) / 8));   // 10→2 之间过渡
    return MAX_PHI + (MAX_PHI_UNDER - MAX_PHI) * t;
  }
  // 自由视角下限：贴到太阳半径附近即可，不再用与尺度无关的 0.6
  const PANORAMA_MIN_DIST = 0.05;
  let MAX_DIST = 1200;

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

  // 屏蔽右键菜单，右键改为拖动视角（canvas 的事件会冒泡到 document）
  document.addEventListener("contextmenu", (e) => {
    // 只在画布区域屏蔽，不影响其它 UI
    if (e.target === canvas) e.preventDefault();
  });

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
    zoomRefDist = 0;   // 平移接管，停掉缩放动画
    zoomAnchorObj = null;
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
  const _zoomBody = new THREE.Vector3();
  const _zoomProj = new THREE.Vector3();
  const _zoomFwd = new THREE.Vector3();
  const _zoomGen = new THREE.Vector3();
  // 进行中的推拉动画：滚轮只设定目标距离和锚点，不直接拍 dist/target。
  // updateCamera 每帧按已缓动的 dist 反推 target，动画全程锚点都钉在光标下，
  // 消除「上一格星球还是小点、下一格直接贴到表面」的跳变。
  let zoomRefDist = 0;
  // 粘性锚点天体：连续滚动期间沿用同一颗（跟其公转位置），直到光标明显移走
  // 或其他手势接管，避免行星漂出拾取窗后锚点跳到别的天体
  let zoomAnchorObj = null;
  let zoomAnchorRadius = 0;
  let zoomAnchorX = 0, zoomAnchorY = 0;

  // 锚定天体的半径：推拉下限按它算（见 zoomTowardCursor）
  function bodyRadiusOf(obj) {
    if (obj === sunGroup) return SUN_RADIUS;
    if (obj === moonMesh) return MOON_CFG.radius;
    const p = planets.find(x => x.group === obj);
    return p ? p.cfg.radius : 0;
  }

  // 光标指向的天体中心（只作推拉锚点，不改聚焦状态）；没有命中返回 null。
  // 两层拾取：
  //   严格窗 = max(投影盘面半径, 6px) + 2px，覆盖肉眼对准光点的正常偏差；
  //   宽容窗 = 投影盘面半径 + 40px，仅行星与月球参与。
  // 严格窗内「盘面大的优先，光标距离次之」：贴近某颗星球时它的圆盘盖满屏幕，
  // 绝不能因为月球/太阳的投影恰好更靠近固定光标就换锚——换锚会让镜头
  // 瞬间转向那颗更远的天体，把当前星球甩出画面。
  // 宽容窗是关键：严格窗落空时若退回 target 等深平面锚点，平面在星球身前，
  // 镜头收敛过去时会直接越过星球深度，把星球甩到相机身后（肉眼瞄准偏一点必现）。
  // 太阳不参与宽容窗：它的光晕横跨几十像素，会把内行星簇的宽容拾取全部抢走，
  // 锚到太阳等于锚到原点，照样从行星身旁掠过去。
  function pickZoomAnchor(clientX, clientY, out, allowNear = true) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(_zoomFwd);
    const halfHtan = Math.tan(camera.fov * Math.PI / 360);
    let strictRpx = -1, strictDpx = Infinity;
    let strictObj = null;
    let genDpx = Infinity;
    let genObj = null;

    const consider = (obj, radius, generous) => {
      obj.getWorldPosition(_zoomBody);
      _zoomProj.copy(_zoomBody);
      _zoomBody.sub(camera.position);
      if (_zoomFwd.dot(_zoomBody) <= 0) return;   // 在相机背后
      const cd = _zoomBody.length();
      const rPx = (radius / (cd * halfHtan)) * (innerHeight / 2);
      _zoomProj.project(camera);
      const sx = (_zoomProj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_zoomProj.y * 0.5 + 0.5) * innerHeight;
      const dpx = Math.hypot(sx - clientX, sy - clientY);
      if (dpx <= Math.max(rPx, 6) + 2) {
        // 半径差超过 0.5px 以盘面大小优先；相近时取离光标近的
        if (rPx > strictRpx + 0.5
            || (Math.abs(rPx - strictRpx) <= 0.5 && dpx < strictDpx)) {
          strictRpx = rPx;
          strictDpx = dpx;
          strictObj = obj;
          out.copy(_zoomBody).add(camera.position);
        }
      } else if (generous && dpx <= rPx + 40 && dpx < genDpx) {
        genDpx = dpx;
        genObj = obj;
        _zoomGen.copy(_zoomBody).add(camera.position);
      }
    };

    consider(sunGroup, SUN_RADIUS, false);
    for (const p of planets) consider(p.group, p.cfg.radius, true);
    if (moonMesh) consider(moonMesh, MOON_CFG.radius, true);

    if (!strictObj && genObj) {
      strictObj = genObj;
      out.copy(_zoomGen);
    }
    if (!strictObj && allowNear) {
      // 第三档：光标没精确落在天体上，但附近（约 22% 屏内）有天体时取最近的。
      // 否则瞄得稍偏就只能沿空白平面推进，拉近到 0.05 就停住。
      // 拖动对齐时用不到这一档（allowNear=false）：空白点击不应该移动中心。
      const nearObj = pickNearestBody(clientX, clientY, out);
      if (nearObj) strictObj = nearObj;
    }
    return strictObj;
  }

  // 屏幕空间离光标最近的天体（考虑相机前方的），窗口约为短边的 22%。
  // 太阳不参与：它常在光标附近，锚到太阳等于锚到原点，会把近距离视角整个拉走
  const _nearProj = new THREE.Vector3();
  const _nearOff = new THREE.Vector3();
  function pickNearestBody(clientX, clientY, out) {
    const limit = Math.min(innerWidth, innerHeight) * 0.22;
    camera.getWorldDirection(_zoomFwd);
    let best = null, bestD = limit;
    const consider = (obj) => {
      obj.getWorldPosition(_nearProj);
      _nearOff.copy(_nearProj).sub(camera.position);
      if (_zoomFwd.dot(_nearOff) <= 0) return;   // 在相机背后
      _nearProj.project(camera);
      const sx = (_nearProj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_nearProj.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = obj; out.copy(_nearOff).add(camera.position); }
    };
    for (const p of planets) consider(p.group);
    if (moonMesh) consider(moonMesh);
    return best;
  }

  // 保持「锚点」在推拉前后落在同一屏幕位置：距离从 d0 变到 d1 时
  // target 平移 (1 - d1/d0)·(锚点 - target)。锚点是光标下的天体中心；
  // 空白处退回过 target、垂直视线的平面上的光标点（原行为）。
  // target 的平移不在这里一次做完，交给 updateCamera 随 dist 缓动逐帧推进。
  function zoomTowardCursor(newDist, clientX, clientY) {
    const d0 = orbit.dist;
    if (!(d0 > 0)) return;

    // 聚焦时忽略光标偏移；但向外滚过 60 倍半径后自动取消选中，
    // 本格起改按自由视角继续拉远——滚轮拉远就是「放手」的统一下拉手势
    if (focusTarget) {
      const df = Math.min(MAX_DIST, Math.max(minDistance(), newDist));
      if (!Number.isFinite(df)) return;
      if (df <= focusReleaseDist()) {
        orbit.tDist = df;
        return;
      }
      releaseFocus();
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
      anchorObj = pickZoomAnchor(clientX, clientY, _zoomAnchor);
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
    zoomAnchorRadius = anchorObj ? bodyRadiusOf(anchorObj) : 0;

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

  const _pivotV = new THREE.Vector3();

  function takeOverCamera() {
    focusFlight = null;
    zoomRefDist = 0;
    orbit.tDist = orbit.dist;
    orbit.tTheta = orbit.theta;
    orbit.tPhi = orbit.phi;
  }

  function alignOrbitPivot(clientX, clientY) {
    if (focusTarget) return;
    let pivotObj = pickZoomAnchor(clientX, clientY, _pivotV, false);
    if (!pivotObj) {
      let bestD = Infinity;
      const consider = (obj) => {
        obj.getWorldPosition(_zoomBody);
        const d = _zoomBody.distanceTo(orbit.target);
        if (d < bestD) { bestD = d; _pivotV.copy(_zoomBody); pivotObj = obj; }
      };
      consider(sunGroup);
      for (const p of planets) consider(p.group);
      if (moonMesh) consider(moonMesh);
    }
    if (pivotObj) {
      _pivotV.y = 0;
      orbit.panOffset.copy(_pivotV);
    }
  }

  function beginCameraDrag(clientX, clientY, button) {
    viewTouched = true;
    if (button === 0) alignOrbitPivot(clientX, clientY);
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
      beginCameraDrag(dragStartX, dragStartY, dragButton);
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
    if (focusFlight) {
      focusFlight = null;
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
        beginCameraDrag(touchTapX, touchTapY, 0);
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
        const hit = pickPlanet(t.clientX, t.clientY);
        if (hit) {
          const holder = focusables.find(f => f.cfg === hit.userData);
          if (holder) focusOn(holder.cfg, holder.group);
          touchLastTapAt = 0;
        } else {
          if (focusTarget) releaseFocus();
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

  /* ---------- 点击聚焦 ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let focusTarget = null;
  // 聚焦的 0.5 秒过渡：{ t0, dur, fromDist, toDist, fromTarget }
  // 期间距离与 target 按同一条时间线推进，方位（theta/phi）保持不变
  let focusFlight = null;

  // 缩放下限：推拉与聚焦共用同一个贴面比例
  const SURFACE_RATIO = 1.05;

  function minDistance() {
    return focusTarget
      ? Math.max(focusTarget.cfg.radius * SURFACE_RATIO, 1e-5)
      : PANORAMA_MIN_DIST;
  }

  // 聚焦状态下滚轮拉到这么远就自动取消选中（约 60 倍星球半径，星球又变回一个点）
  function focusReleaseDist() {
    return focusTarget ? Math.max(focusTarget.cfg.radius * 60, 1e-4) : 0;
  }

  // 取消选中：只释放锁定，保持当前视角位置。
  // 把当前 target 转成平移偏移，自由视角的基准点不会跳回原点。
  function releaseFocus() {
    if (!focusTarget) return;
    orbit.panOffset.copy(orbit.target);
    focusTarget = null;
    focusFlight = null;          // 中断聚焦过渡（若有）
    orbit.tDist = orbit.dist;    // 停在当前距离，不继续向星球推进
    zoomRefDist = 0;   // 停掉可能还在滑行的推拉补偿，避免与新的平移基准冲突
    zoomAnchorObj = null;
    hud.hideInfo();
  }

  const _pickV = new THREE.Vector3();
  // 拾取分两路：球体走射线（真实遮挡）；光点按屏幕空间 10px 命中
  //（世界单位阈值在远近混合场景下不可靠：聚焦贴脸时其它光点会变得点不中）
  const pickMeshes = clickable.filter(o => o.isMesh);
  const pickDots = clickable.filter(o => o.isPoints);
  function pickPlanet(clientX, clientY) {
    ndc.x = (clientX / innerWidth) * 2 - 1;
    ndc.y = -(clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    raycaster.params.Points.threshold = 0;   // 光点不走射线
    const hits = raycaster.intersectObjects(pickMeshes, false);
    let bestD = hits.length ? hits[0].distance : Infinity;
    let bestObj = hits.length ? hits[0].object : null;

    camera.getWorldDirection(_zoomFwd);
    for (const dot of pickDots) {
      dot.getWorldPosition(_pickV);
      _zoomBody.copy(_pickV).sub(camera.position);
      const cd = _zoomBody.length();
      if (cd >= bestD || _zoomFwd.dot(_zoomBody) <= 0) continue;   // 更远或背后
      _zoomProj.copy(_pickV).project(camera);
      const sx = (_zoomProj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_zoomProj.y * 0.5 + 0.5) * innerHeight;
      if (Math.hypot(sx - clientX, sy - clientY) <= 10) {
        bestD = cd;
        bestObj = dot;
      }
    }
    return bestObj;
  }

  // 距离供点击聚焦使用；向阳方位仅供 ?focus= 瞬移使用。
  // 点击聚焦保留用户当前角度，避免把夜面取景规则误套到交互上。
  function focusFraming(cfg, wp) {
    // 相机放在「行星 → 太阳」连线的延长线上，且偏向一侧 40°，
    // 这样既看到亮面，又不至于正对着阳光全是白板。
    // 仰角约 14.9°（0.26 rad）。
    // 不能 normalize 后硬塞 camDir.y——水平分量会被压没，
    // 相机就跑到行星正上方垂直俯视，只能看到一个点。
    const sunDir = wp.clone().negate();
    let az;
    if (sunDir.lengthSq() < 1e-12) {
      // 太阳自身在原点，「行星→太阳」方向退化：用固定斜向取景
      az = new THREE.Vector3(0.55, 0, 0.83).normalize();
    } else {
      const flat = new THREE.Vector3(sunDir.x, 0, sunDir.z);
      if (flat.lengthSq() < 1e-12) flat.set(1, 0, 0);   // 天体正好在太阳正上/下方
      flat.normalize();
      const side = new THREE.Vector3(-flat.z, 0, flat.x);
      az = flat.clone().multiplyScalar(Math.cos(0.7))
        .addScaledVector(side, Math.sin(0.7)).normalize();
    }

    const elev = 0.26;
    const camDir = az.clone().multiplyScalar(Math.cos(elev));
    camDir.y = Math.sin(elev);
    camDir.normalize();

    // 让行星在屏幕上的视觉半径约占 1/10 屏高（直径 1/5）：
    //   r_px / (d·tan(fov/2)) ≈ 0.1  →  d ≈ r / (0.2·tan(fov/2))（半径口径 0.2 → 直径 1/5）
    // 再用 2.2 倍半径兜底，避免贴近表面穿模
    const halfFov = camera.fov * Math.PI / 360;
    const dist = Math.max(cfg.radius / (0.2 * Math.tan(halfFov)), cfg.radius * 2.2);

    return {
      dist,
      theta: Math.atan2(camDir.x, camDir.z),
      phi: Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, camDir.y))),
    };
  }

  function focusOn(cfg, group) {
    focusTarget = { cfg, group };
    orbit.panOffset.set(0, 0, 0);
    focusFlight = null;
    zoomRefDist = 0;   // 聚焦接管，停掉缩放动画
    zoomAnchorObj = null;
    orbit.tTheta = orbit.theta;
    orbit.tPhi = orbit.phi;
    viewTouched = true;

    const wp = new THREE.Vector3();
    group.getWorldPosition(wp);
    // 只采用距离取景；方位保持用户当前视角——点标签时是什么角度，
    // 切进去就是什么角度，不再自动转到向阳面
    const { dist } = focusFraming(cfg, wp);
    // 已经比标准取景更近（比如贴脸时星球铺满屏幕、点盘面等于点了它）：
    // 保持当前距离，选中不应把镜头拉回远处
    const distToBody = camera.position.distanceTo(wp);
    const toDist = distToBody < dist
      ? Math.max(distToBody, cfg.radius * SURFACE_RATIO)
      : dist;

    // 0.5 秒过渡：距离在起点与目标之间按 smoothstep（对数空间）推进，
    // target 同一条时间线从当前位置移到星球；期间不改变方位
    focusFlight = {
      t0: performance.now(),
      dur: 500,
      fromDist: orbit.dist,
      toDist,
      fromTarget: orbit.target.clone(),
    };
    orbit.tDist = toDist;

    hud.showInfo(cfg);
  }

  // ?focus=行星 的瞬移版：直接摆好相机，用于截图与分享
  function focusSnap(cfg, group) {
    focusTarget = { cfg, group };
    orbit.panOffset.set(0, 0, 0);
    focusFlight = null;
    zoomRefDist = 0;
    zoomAnchorObj = null;
    viewTouched = true;
    const wp = new THREE.Vector3();
    group.getWorldPosition(wp);
    const { dist, theta, phi } = focusFraming(cfg, wp);

    orbit.tDist = orbit.dist = dist;
    orbit.tTheta = orbit.theta = theta;
    orbit.tPhi = orbit.phi = phi;
    orbit.target.copy(wp);
    camera.position.copy(wp).add(
      new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta))
        .multiplyScalar(dist));
    camera.lookAt(wp);

    hud.showInfo(cfg);
  }

  function resetView() {
    focusTarget = null;
    orbit.panOffset.set(0, 0, 0);
    focusFlight = null;
    zoomRefDist = 0;   // 复位接管，停掉缩放动画
    zoomAnchorObj = null;   // 回到全景，旧锚点不再沿用
    viewTouched = false;   // 回到全景后，resize 重新允许自适应距离
    orbit.tDist = fitDistance();
    orbit.tTheta = HOME_THETA;
    orbit.tPhi = HOME_PHI;
    hud.hideInfo();
  }

  canvas.addEventListener("click", (e) => {
    if (pointerMoved) return;   // 拖动结束不触发聚焦
    if (e.button !== 0) return; // 右键不聚焦
    const hit = pickPlanet(e.clientX, e.clientY);
    if (hit) {
      // 行星/卫星本体和最小光点的 userData 都是同一个 cfg，回查聚焦对象
      const holder = focusables.find(f => f.cfg === hit.userData);
      if (holder) focusOn(holder.cfg, holder.group);
      return;
    }
    // 单击空白取消选中：只释放锁定，保持当前视角
    if (focusTarget) releaseFocus();
  });

  // Esc 取消选中（保持当前视角，不回到远景）
  addEventListener("keydown", (e) => {
    if (e.code === "Escape" && focusTarget) releaseFocus();
  });

  canvas.addEventListener("dblclick", (e) => {
    // 双击天体只聚焦，不回到远景
    if (pickPlanet(e.clientX, e.clientY)) return;
    resetView();
  });

  /* ---------- WASD 平移视角 ---------- */
  const moveKeys = new Set();
  const _moveFwd = new THREE.Vector3();
  const _moveRight = new THREE.Vector3();
  const _moveStep = new THREE.Vector3();

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
    if (focusFlight || zoomRefDist > 0 || orbit.tDist !== orbit.dist) takeOverCamera();
    zoomAnchorObj = null;
    viewTouched = true;

    // 近距离聚焦时改为环绕天体：既不会把相机推进球体，也始终对准星球
    if (focusTarget && orbit.dist < focusTarget.cfg.radius * 30) {
      orbit.tTheta -= r * 1.0 * dt;
      orbit.tPhi = Math.min(maxPhi(), Math.max(MIN_PHI, orbit.tPhi - f * 0.6 * dt));
      return;
    }

    // 远距离/自由视角：沿当前视角水平前向/右向平移目标点
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
    const k = 1 - Math.pow(0.0009, dt);
    orbit.theta += (orbit.tTheta - orbit.theta) * k;
    orbit.phi   += (orbit.tPhi   - orbit.phi)   * k;
    if (!focusFlight) {
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
    if (zoomRefDist > 0 && !focusTarget) {
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
    if (focusTarget) {
      focusTarget.group.getWorldPosition(_base);
    }
    _base.add(orbit.panOffset);

    if (focusFlight && focusTarget) {
      // 聚焦过渡：距离与 target 用同一条 0.5s 时间线，方位不动。
      // 距离分两段插值——感知上均匀的是「视大小」（∝ 1/距离），不是距离：
      // 若在距离上对数匀速，星球会在最后一小段时间里指数放大（突然切到）。
      //   第一段（30% 时间）：对数空间快速穿过空程，缓入缓出；
      //   第二段（70% 时间）：按 1/d 线性推进，视大小匀速增长、落点平顺。
      const p = Math.min(1, (performance.now() - focusFlight.t0) / focusFlight.dur);
      const e = p * p * (3 - 2 * p);
      orbit.target.lerpVectors(focusFlight.fromTarget, _base, e);

      const d0 = Math.max(focusFlight.fromDist, 1e-9);
      const d1 = Math.max(focusFlight.toDist, 1e-9);
      const dShow = d1 * 8;   // 视大小约为到站时的 1/8，从这里开始「看得见」
      let d;
      if (d0 > dShow) {
        const p1 = 0.3;
        if (p < p1) {
          const q = p / p1;
          const qe = q * q * (3 - 2 * q);
          d = Math.exp(Math.log(d0) + (Math.log(dShow) - Math.log(d0)) * qe);
        } else {
          const q = (p - p1) / (1 - p1);
          const qe = q * q * (3 - 2 * q);
          d = 1 / ((1 / dShow) + ((1 / d1) - (1 / dShow)) * qe);
        }
      } else {
        d = 1 / ((1 / d0) + ((1 / d1) - (1 / d0)) * e);
      }
      orbit.dist = d;
      if (p >= 1) focusFlight = null;   // 到站后交回常规跟随
    } else {
      const k2 = 1 - Math.pow(0.002, dt);
      // 聚焦且已拉近时目标必须严格跟随行星：近距离下插值滞后会让行星跑出画面
      if (focusTarget && orbit.dist < 20) {
        orbit.target.copy(_base);
      } else {
        orbit.target.lerp(_base, k2);
      }
    }

    // 贴近观察时自动暂停，避免相机/天体缓慢漂移；焦点和自由视角都适用
    hud.autoPauseCheck(
      orbit.dist < (focusTarget ? Math.max(focusTarget.cfg.radius * 3, 1.0) : 1.0),
      orbit.dist > (focusTarget ? Math.max(focusTarget.cfg.radius * 4, 1.5) : 1.5),
    );

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
    if (!viewTouched && !focusTarget) orbit.tDist = fitDistance();
  }

  return {
    orbit,
    updateCamera,
    resetView,
    focusOn,
    focusSnap,
    handleWheel,
    fitDistance,
    onResize,
    getFocusTarget: () => focusTarget,
    // 调试用：当前推拉锚点是谁
    getZoomAnchorName: () => {
      if (!zoomAnchorObj) return null;
      if (zoomAnchorObj === moonMesh) return "月球";
      if (zoomAnchorObj === sunGroup) return "太阳";
      const p = planets.find(x => x.group === zoomAnchorObj);
      return p ? p.cfg.name : "?";
    },
  };
}
