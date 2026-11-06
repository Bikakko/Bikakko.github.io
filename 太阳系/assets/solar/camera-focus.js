/* ============================================================
   太阳系 · Solar · 聚焦控制（自 camera.js 拆出）
   聚焦锁定、0.5s 聚焦过渡、?focus= 瞬移与取景规则集中在这里；
   手势入口不再各自手工同步聚焦状态。
   缩放动画状态（zoomRefDist / zoomAnchorObj）属于 camera.js，
   通过 cancelZoom 回调注入，避免两个模块互相持有对方内部状态。
   ============================================================ */
import * as THREE from "three";

// 缩放下限：推拉与聚焦共用同一个贴面比例
export const SURFACE_RATIO = 1.05;

export function createFocusControl({ orbit, camera, hud, cancelZoom, markViewTouched }) {
  let focusTarget = null;
  // 聚焦的 0.5 秒过渡：{ t0, dur, fromDist, toDist, fromTarget }
  // 期间距离与 target 按同一条时间线推进，方位（theta/phi）保持不变
  let focusFlight = null;

  const getTarget = () => focusTarget;
  const isFlying = () => focusFlight !== null;
  function cancelFlight() { focusFlight = null; }

  function minDistance(panoramaMinDist) {
    return focusTarget
      ? Math.max(focusTarget.cfg.radius * SURFACE_RATIO, 1e-5)
      : panoramaMinDist;
  }

  // 聚焦状态下滚轮拉到这么远就自动取消选中（约 60 倍星球半径，星球又变回一个点）
  function releaseDistance() {
    return focusTarget ? Math.max(focusTarget.cfg.radius * 60, 1e-4) : 0;
  }

  // 取消选中：只释放锁定，保持当前视角位置。
  // 把当前 target 转成平移偏移，自由视角的基准点不会跳回原点。
  function release() {
    if (!focusTarget) return;
    orbit.panOffset.copy(orbit.target);
    focusTarget = null;
    focusFlight = null;          // 中断聚焦过渡（若有）
    orbit.tDist = orbit.dist;    // 停在当前距离，不继续向星球推进
    cancelZoom();                // 停掉可能还在滑行的推拉补偿，避免与新的平移基准冲突
    hud.hideInfo();
  }

  // 回到全景等场景的彻底清空（信息卡/平移偏移由调用方负责）
  function clear() {
    focusTarget = null;
    focusFlight = null;
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
    cancelZoom();                // 聚焦接管，停掉缩放动画
    orbit.tTheta = orbit.theta;
    orbit.tPhi = orbit.phi;
    markViewTouched();

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
    cancelZoom();
    markViewTouched();
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

  // 聚焦过渡的每帧推进（在 updateCamera 内调用）。
  // base：本帧「焦点天体世界位置 + 平移偏移」，由调用方算好传入。
  // 返回 true 表示本帧由过渡接管（常规 target 缓动不应再跑）。
  function updateFlight(base) {
    if (!focusFlight || !focusTarget) return false;
    // 聚焦过渡：距离与 target 用同一条 0.5s 时间线，方位不动。
    // 距离分两段插值——感知上均匀的是「视大小」（∝ 1/距离），不是距离：
    // 若在距离上对数匀速，星球会在最后一小段时间里指数放大（突然切到）。
    //   第一段（30% 时间）：对数空间快速穿过空程，缓入缓出；
    //   第二段（70% 时间）：按 1/d 线性推进，视大小匀速增长、落点平顺。
    const p = Math.min(1, (performance.now() - focusFlight.t0) / focusFlight.dur);
    const e = p * p * (3 - 2 * p);
    orbit.target.lerpVectors(focusFlight.fromTarget, base, e);

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
    return true;
  }

  return {
    getTarget, isFlying, cancelFlight,
    minDistance, releaseDistance,
    release, clear, focusOn, focusSnap, updateFlight,
  };
}