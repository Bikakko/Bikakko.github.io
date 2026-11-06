/* ============================================================
   太阳系 · Solar · 相机拾取（自 camera.js 拆出）
   - pickPlanet：点击聚焦。球体走射线（真实遮挡）；光点按屏幕空间
     10px 命中（世界单位阈值在远近混合场景下不可靠）。
   - pickZoomAnchor：滚轮锚点。严格窗 + 宽容窗 + 最近天体三级拾取。
   - pickNearestBody：屏幕空间最近天体（太阳不参与）。
   只读场景与相机，不改任何相机/聚焦状态。
   ============================================================ */
import * as THREE from "three";
import { MOON_CFG, SUN_CFG } from "./bodies.js";

export function createPicker({ camera, space }) {
  const { planets, clickable, moonMesh, sunGroup } = space;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _pickV = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _body = new THREE.Vector3();
  const _proj = new THREE.Vector3();
  const _gen = new THREE.Vector3();
  const _nearProj = new THREE.Vector3();
  const _nearOff = new THREE.Vector3();

  // 拾取分两路：球体走射线（真实遮挡）；光点按屏幕空间 10px 命中
  const pickMeshes = clickable.filter(o => o.isMesh);
  const pickDots = clickable.filter(o => o.isPoints);

  // 锚定天体的半径：推拉下限按它算（见 camera.js zoomTowardCursor）
  function bodyRadiusOf(obj) {
    if (obj === sunGroup) return SUN_CFG.radius;
    if (obj === moonMesh) return MOON_CFG.radius;
    const p = planets.find(x => x.group === obj);
    return p ? p.cfg.radius : 0;
  }

  function pickPlanet(clientX, clientY) {
    ndc.x = (clientX / innerWidth) * 2 - 1;
    ndc.y = -(clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    raycaster.params.Points.threshold = 0;   // 光点不走射线
    const hits = raycaster.intersectObjects(pickMeshes, false);
    let bestD = hits.length ? hits[0].distance : Infinity;
    let bestObj = hits.length ? hits[0].object : null;

    camera.getWorldDirection(_fwd);
    for (const dot of pickDots) {
      dot.getWorldPosition(_pickV);
      _body.copy(_pickV).sub(camera.position);
      const cd = _body.length();
      if (cd >= bestD || _fwd.dot(_body) <= 0) continue;   // 更远或背后
      _proj.copy(_pickV).project(camera);
      const sx = (_proj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_proj.y * 0.5 + 0.5) * innerHeight;
      if (Math.hypot(sx - clientX, sy - clientY) <= 10) {
        bestD = cd;
        bestObj = dot;
      }
    }
    return bestObj;
  }

  // 屏幕空间离光标最近的天体（考虑相机前方的），窗口约为短边的 22%。
  // 太阳不参与：它常在光标附近，锚到太阳等于锚到原点，会把近距离视角整个拉走
  function pickNearestBody(clientX, clientY, out) {
    const limit = Math.min(innerWidth, innerHeight) * 0.22;
    camera.getWorldDirection(_fwd);
    let best = null, bestD = limit;
    const consider = (obj) => {
      obj.getWorldPosition(_nearProj);
      _nearOff.copy(_nearProj).sub(camera.position);
      if (_fwd.dot(_nearOff) <= 0) return;   // 在相机背后
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
    camera.getWorldDirection(_fwd);
    const halfHtan = Math.tan(camera.fov * Math.PI / 360);
    let strictRpx = -1, strictDpx = Infinity;
    let strictObj = null;
    let genDpx = Infinity;
    let genObj = null;

    const consider = (obj, radius, generous) => {
      obj.getWorldPosition(_body);
      _proj.copy(_body);
      _body.sub(camera.position);
      if (_fwd.dot(_body) <= 0) return;   // 在相机背后
      const cd = _body.length();
      const rPx = (radius / (cd * halfHtan)) * (innerHeight / 2);
      _proj.project(camera);
      const sx = (_proj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_proj.y * 0.5 + 0.5) * innerHeight;
      const dpx = Math.hypot(sx - clientX, sy - clientY);
      if (dpx <= Math.max(rPx, 6) + 2) {
        // 半径差超过 0.5px 以盘面大小优先；相近时取离光标近的
        if (rPx > strictRpx + 0.5
            || (Math.abs(rPx - strictRpx) <= 0.5 && dpx < strictDpx)) {
          strictRpx = rPx;
          strictDpx = dpx;
          strictObj = obj;
          out.copy(_body).add(camera.position);
        }
      } else if (generous && dpx <= rPx + 40 && dpx < genDpx) {
        genDpx = dpx;
        genObj = obj;
        _gen.copy(_body).add(camera.position);
      }
    };

    consider(sunGroup, SUN_CFG.radius, false);
    for (const p of planets) consider(p.group, p.cfg.radius, true);
    if (moonMesh) consider(moonMesh, MOON_CFG.radius, true);

    if (!strictObj && genObj) {
      strictObj = genObj;
      out.copy(_gen);
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

  return { pickPlanet, pickZoomAnchor, pickNearestBody, bodyRadiusOf };
}