/* ============================================================
   太阳系 · Solar · 3D 光速视觉层（主分支的单光球外观）
   - 波前是一个真实 3D 半透明球面：经纬网格 + 轮廓光，DoubleSide 内表面
     也可见，随相机正确透视；球内球外都能看到球面覆盖区域。
   - 取消高亮大圆：主分支三个又亮又粗的正交大圆（黄道 + 两条子午）
     全部移除，画面里只剩一套统一普通亮度的经纬网。赤道/黄道线由
     lat=0 的网格线给出；普通子午线加密（16 → 32 条）。
   - 网格线有屏幕像素宽度下限，光球刚出发时也看得见。
   - 八条太阳→行星光线始终完整连接两端，不按波前裁断，避免球缘抖动穿模；
     光秒亮点也与光球解耦：仅在聚焦某颗行星时显示该行星的完整光子流，
     按太阳系时间持续流动。间隔按视距自适应抽稀，HUD 同步显示。
   自定义 ShaderMaterial 必须注入对数深度片段（见 shaders.js）。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { frontRadius } from "./light-math.js";
import { UNITS_PER_LIGHT_SEC, SECONDS_PER_DAY } from "./config.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

// 每条光线最多枚举的亮点序号：覆盖 4 光时标尺全程（海王星光行时 ≈ 15005 光秒）
const MAX_BEADS = 20000;
const BEAD_PX   = 8.0;   // 亮点的最大屏幕直径（CSS 像素），近距时的圆点大小
// 相邻亮点的最小屏幕间距（CSS 像素）。真实比例下 1 光秒 = 0.0202 世界单位，
// 全景视距 ~400 时只投影成 0.035px——一万五千颗点叠在同几个像素里。
// 间距不足这个值就按「整数光秒」抽稀，保证任何视距下都是可数的分离圆点。
const BEAD_MIN_GAP_PX = 12.0;

export function createLightView(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const scalable = [];

  /* ---------- 半透明 3D 球面 ----------
     网格基于物体坐标而非视线，因此相机进入球壳后内表面依然可见；
     线宽按屏幕导数归一化，光球很小或很大时都保持约 2px。
     fresnel 只负责球外的轮廓光，不再是唯一的可见性来源。 */
  const sphereUniforms = {
    uColor:   { value: new THREE.Color(0xffcf80) },
    uOpacity: { value: 0.9 },
    uInside:  { value: 0 },
  };
  const sphereMat = new THREE.ShaderMaterial({
    uniforms: sphereUniforms,
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uInside;
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        vec3 n = normalize(vObj);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(n.z, n.x);
        float latC = lat * 8.0;
        float lonC = lon * 16.0;   // 普通子午线密度翻倍：16 → 32 条
        // 线宽以 fwidth 归一化：与光球半径、相机距离无关，约 2px
        float latW = clamp(fwidth(latC), 0.02, 0.6);
        float lonW = clamp(fwidth(lonC), 0.02, 0.6);
        float latLine = 1.0 - smoothstep(0.0, 2.0 * latW, abs(sin(latC)));
        float lonLine = 1.0 - smoothstep(0.0, 2.0 * lonW, abs(sin(lonC)));
        float g = max(latLine, lonLine);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
        vec3 col = mix(vec3(1.0, 0.55, 0.22), uColor, 0.45);
        // 基础项 + 球内增强：即使 fres≈0 也不会整球消失
        float a = (g * 0.09 + fres * 0.22 + 0.024 + uInside * 0.022) * uOpacity;
        gl_FragColor = vec4(col, a);
        ${LOGDEPTH_FRAG}
      }
    `,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), sphereMat);
  sphere.frustumCulled = false;
  sphere.renderOrder = 2;
  group.add(sphere);
  scalable.push(sphere);

  /* ---------- 不再画高亮粗大圆 ----------
     主分支原来的三个正交大圆（黄道面 + 两条子午面）又亮又粗，是画面里
     唯一的「高亮」元素，已全部取消。赤道/黄道线由球面着色器的 lat=0
     网格线给出，与所有子午线一样是统一普通亮度，不再有独立的高亮环。 */

  /* ---------- 八条完整光线（相机相对坐标） ----------
     顶点存「世界坐标 − 相机位置」，line.position 每帧跟随相机。这样
     modelViewMatrix 的平移分量趋近 0，投影不再让两个 10 量级的大数在
     float32 下相消。光线不按波前裁断，避免光球边缘的精度误差造成抖动。 */
  const rayMatFor = () => new THREE.ShaderMaterial({
    uniforms: {},
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${LOGDEPTH_PARS_VERT}
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        gl_FragColor = vec4(0.42, 0.60, 1.0, 0.32);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  /* ---------- 1 光秒亮点（真正的圆点精灵，与光球解耦） ----------
     只有当前聚焦行星的 Points 可见，沿太阳→行星全程每隔「uStride 光秒」
     有一个亮点。相位由 simTime 独立推导，与光球光行时、标尺和重置无关；
     d = phase + n·spacing，到达行星的点消失，太阳端持续补入新点。
     CPU 找出当前最外侧亮点 head，shader 再以 head − n·spacing 放置，
     保留近距离精度。
     uStride 是按视距自适应的整数抽稀步长（见 update）：拉近到 1 光秒的
     屏幕间距超过 BEAD_MIN_GAP_PX 时 uStride=1，就是逐颗的 1 光秒亮点；
     远景下自动跳到 2、3…N 光秒一颗，HUD 会同步显示当前间隔。
     序号 n 编码在 position.x，位置全由 vertex shader 算出，CPU 每帧只
     更新几个 uniform，不重排顶点。
     用 gl_PointCoord 画「亮核 + 光晕」的圆点，屏幕尺寸有恒定上限：放大后
     仍是圆点，不会像「在 1px 线段上用 fract 画亮段」那样被拉成长段。
     点径不超过相邻点屏幕间距的 3/4，任何缩放下都不重叠。

     精度：顶点存的是「相对锚点」的小量。锚点取光线上离相机最近的点，
     uAnchorRel = 锚点 − 相机、uHeadRel = 最外侧亮点 − 锚点都在 CPU 用
     double 算完；Points 自身再平移到相机位置，于是 modelViewMatrix 的
     平移 ≈ 0。贴近行星时这些相对量足够小；直接算
     modelViewMatrix * (uDir * d) 会让两个 300 量级的数在 shader 里相消，
     亮点会整像素抖动、脱离已经修好的光线。 */
  const beadIdx = new Float32Array(MAX_BEADS * 3);
  for (let i = 0; i < MAX_BEADS; i++) beadIdx[i * 3] = i;   // position.x = 序号 n
  const beadGeo = new THREE.BufferGeometry();
  beadGeo.setAttribute("position", new THREE.BufferAttribute(beadIdx, 3));

  const makeBeadMat = () => new THREE.ShaderMaterial({
    uniforms: {
      uDir:        { value: new THREE.Vector3(1, 0, 0) },
      uRayLen:     { value: 0 },
      uStride:     { value: 1 },                      // 相邻亮点相隔几个光秒
      uAnchorRel:  { value: new THREE.Vector3() },    // 锚点 − 相机（CPU double）
      uAnchorDist: { value: 0 },                      // 锚点的日心距离
      uHeadRel:    { value: 0 },                      // 最外侧亮点 − 锚点距离
      uDotSpacing: { value: UNITS_PER_LIGHT_SEC },   // 1 光秒对应的世界单位
      uPointPx:    { value: BEAD_PX },
      uProjScale:  { value: 900 },                  // (视口高/2)/tan(fov/2)，每帧刷新
      uPixelRatio: { value: 1 },
    },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3  uDir;
      uniform float uRayLen;
      uniform float uStride;
      uniform vec3  uAnchorRel;
      uniform float uAnchorDist;
      uniform float uHeadRel;
      uniform float uDotSpacing;
      uniform float uPointPx;
      uniform float uProjScale;
      uniform float uPixelRatio;
      varying float vAlpha;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        float step = position.x * uStride * uDotSpacing;
        // head 由 CPU 按独立连续相位定位；只按太阳与行星两端裁断
        float d = uAnchorDist + uHeadRel - step;
        // 相机相对小量：uHeadRel − step 在近距时两边都是小量，无相消
        vec3 rel = uAnchorRel + uDir * (uHeadRel - step);
        vec4 mv = modelViewMatrix * vec4(rel, 1.0);
        gl_Position = projectionMatrix * mv;
        // gl_Position.w 就是该点的视空间深度
        float depth = max(gl_Position.w, 1e-6);
        float gapPx = uDotSpacing * uStride * uProjScale / depth;   // 相邻亮点的屏幕间距
        // 点径不超过间距的 3/4 → 任何缩放下都不会相邻重叠糊成亮线。
        // 步长只保证「最近处」够疏，同一条光线的远端仍会密起来，那里继续淡出。
        float sizePx = min(uPointPx, gapPx * 0.75);
        float fade = smoothstep(0.8, 3.0, gapPx);
        vAlpha = fade;
        gl_PointSize = max(sizePx, 0.0) * uPixelRatio;
        // 超出太阳→行星线段 / 远景点密到看不见 → 移出裁剪空间
        if (d < 0.0 || d > uRayLen || fade < 0.01) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
        }
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float r = length(uv) * 2.0;
        if (r > 1.0) discard;
        float core = 1.0 - smoothstep(0.0, 0.5, r);    // 明亮的白核
        float halo = 1.0 - smoothstep(0.3, 1.0, r);    // 暖色光晕
        vec3 col = mix(vec3(1.0, 0.72, 0.34), vec3(1.0, 1.0, 0.95), core);
        gl_FragColor = vec4(col, (core * 1.15 + halo * 0.45) * vAlpha);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  const rays = PLANETS.map((cfg) => {
    const arr = new Float32Array(6);   // 太阳中心 → 行星当前位置（均减相机位置）
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = rayMatFor();
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 3;
    group.add(line);

    const beadMat = makeBeadMat();
    const beads = new THREE.Points(beadGeo, beadMat);
    beads.frustumCulled = false;   // 位置在 vertex shader 里算，包围球无意义
    beads.renderOrder = 4;
    group.add(beads);
    return {
      cfg, arr, geo, mat, line, beads, beadMat,
      pos: new THREE.Vector3(), dir: new THREE.Vector3(), anchorRel: new THREE.Vector3(),
      rayLen: 0, anchorDist: 0, headRel: 0,
    };
  });

  const _camPos = new THREE.Vector3();
  let cameraInside = false;
  let lastBeadCount = -1;
  let beadStep = 1;

  function update(lightSec, simTime, focusCfg = null) {
    const R = frontRadius(lightSec);
    for (const m of scalable) m.scale.setScalar(R);

    // rig.updateCamera 只改了 position/quaternion，renderer.render 才会刷新
    // matrixWorld；本函数在 render 之前执行，需自行取本帧相机位置。
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    cameraInside = _camPos.lengthSq() < R * R;
    sphereUniforms.uInside.value = cameraInside ? 1 : 0;

    const focusIndex = PLANETS.indexOf(focusCfg);
    let nearDist = Infinity;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      orbitalPosition(r.cfg, simTime, r.pos);
      r.rayLen = r.pos.length();
      r.dir.copy(r.pos).divideScalar(r.rayLen);

      // 光线始终完整连接太阳与行星；亮点只显示当前聚焦目标。
      r.line.position.copy(_camPos);
      r.arr[0] = -_camPos.x; r.arr[1] = -_camPos.y; r.arr[2] = -_camPos.z;
      r.arr[3] = r.pos.x - _camPos.x;
      r.arr[4] = r.pos.y - _camPos.y;
      r.arr[5] = r.pos.z - _camPos.z;
      r.geo.attributes.position.needsUpdate = true;
      r.beads.visible = i === focusIndex;
      if (i !== focusIndex) continue;

      // 锚点 = 光线上离相机最近的点。以它为原点，锚点附近的量全是小量。
      r.beads.position.copy(_camPos);
      const anchor = Math.min(r.rayLen, Math.max(0, _camPos.dot(r.dir)));
      r.anchorDist = anchor;
      r.anchorRel.copy(r.dir).multiplyScalar(anchor).sub(_camPos);
      nearDist = r.anchorRel.length();
    }

    if (focusIndex < 0) {
      beadStep = 1;
      if (lastBeadCount !== 0) {
        beadGeo.setDrawRange(0, 0);
        lastBeadCount = 0;
      }
      return;
    }

    // 抽稀步长只看聚焦光线：让最近处的相邻亮点至少隔 BEAD_MIN_GAP_PX。
    const projScale = (window.innerHeight * 0.5) / Math.tan(camera.fov * Math.PI / 360);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const gap1 = UNITS_PER_LIGHT_SEC * projScale / Math.max(nearDist, 1e-9);
    beadStep = Math.max(1, Math.ceil(BEAD_MIN_GAP_PX / Math.max(gap1, 1e-9)));
    const beadSpacing = UNITS_PER_LIGHT_SEC * beadStep;

    // 亮点使用 simTime 的独立相位，光球归零或尚未到达行星时也保持全程流动。
    const beadDistance = simTime * SECONDS_PER_DAY * UNITS_PER_LIGHT_SEC;
    const beadPhase = ((beadDistance % beadSpacing) + beadSpacing) % beadSpacing;
    const r = rays[focusIndex];
    const headIndex = Math.floor(Math.max(0, r.rayLen - beadPhase) / beadSpacing);
    const headDist = beadPhase + headIndex * beadSpacing;
    r.headRel = headDist - r.anchorDist;

    const bu = r.beadMat.uniforms;
    bu.uDir.value.copy(r.dir);
    bu.uRayLen.value = r.rayLen;
    bu.uStride.value = beadStep;
    bu.uAnchorRel.value.copy(r.anchorRel);
    bu.uAnchorDist.value = r.anchorDist;
    bu.uHeadRel.value = r.headRel;
    bu.uProjScale.value = projScale;
    bu.uPixelRatio.value = pixelRatio;

    // 共享序号缓冲只绘制当前聚焦光线需要的有限点列。
    const beadCount = Math.min(MAX_BEADS, headIndex + 1);
    if (beadCount !== lastBeadCount) {
      beadGeo.setDrawRange(0, beadCount);
      lastBeadCount = beadCount;
    }
  }

  function setVisible(on) {
    group.visible = on;
  }

  return { update, setVisible, isInside: () => cameraInside, getBeadStep: () => beadStep };
}
