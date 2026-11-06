/* ============================================================
   太阳系 · Solar · 3D 光速视觉层（主分支的单光球外观）
   - 波前是一个真实 3D 半透明球面：经纬网格 + 轮廓光，DoubleSide 内表面
     也可见，随相机正确透视；球内球外都能看到球面覆盖区域。
   - 取消高亮大圆：主分支三个又亮又粗的正交大圆（黄道 + 两条子午）
     全部移除，画面里只剩一套统一普通亮度的经纬网。赤道/黄道线由
     lat=0 的网格线给出；普通子午线加密（16 → 32 条）。
   - 网格线有屏幕像素宽度下限，光球刚出发时也看得见。
   - 八条太阳→行星光线，按世界半径裁断，前端高亮；每条光线上每隔
     1 光秒一个明亮的圆点亮点，随波前以光速流动，拉近行星可逐颗分辨。
   自定义 ShaderMaterial 必须注入对数深度片段（见 shaders.js）。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { frontRadius } from "./light-math.js";
import { UNITS_PER_LIGHT_SEC } from "./config.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

// 每条光线最多枚举的亮点序号：覆盖 4 光时标尺全程（海王星光行时 ≈ 15005 光秒）
const MAX_BEADS = 20000;
const BEAD_PX   = 8.0;   // 亮点的最大屏幕直径（CSS 像素），近距时的圆点大小

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

  /* ---------- 八条光线（世界空间线段） ---------- */
  const rayMatFor = () => new THREE.ShaderMaterial({
    uniforms: { uFront: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFront;
      varying vec3 vWorld;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        float d = length(vWorld);
        if (d > uFront) discard;
        // 波前附近 6% 的区段做「光子头」高亮
        float head = smoothstep(uFront * 0.94, uFront, d);
        vec3 col = mix(vec3(0.42, 0.60, 1.0), vec3(1.0, 0.85, 0.55), head);
        gl_FragColor = vec4(col, 0.22 + 0.65 * head);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  /* ---------- 1 光秒亮点（真正的圆点精灵） ----------
     每条太阳→行星光线上每隔 1 光秒有一个亮点：第 k 个亮点在
     d = uFront − k·UNITS_PER_LIGHT_SEC，相当于「k 秒前发出的光子」，
     随波前一同以光速向外流动；按波前（d ≤ uFront，由公式自动满足）和
     光线终点行星（d ≤ uRayLen）裁断。
     序号 k 编码在 position.x，位置全由 vertex shader 算出，CPU 每帧只
     更新几个 uniform，不重排顶点。
     用 gl_PointCoord 画「亮核 + 光晕」的圆点，屏幕尺寸有恒定上限：放大后
     仍是圆点，不会像「在 1px 线段上用 fract 画亮段」那样被拉成长段。
     点径不超过相邻点屏幕间距的 3/4，任何缩放下都不重叠；间距过小时
     整体淡出，避免远景里成千上万个点叠成一条过曝亮线。拉近到行星附近，
     1 光秒的间距在屏幕上拉开，一颗颗光点清晰可数，直观体现光速。 */
  const beadIdx = new Float32Array(MAX_BEADS * 3);
  for (let i = 0; i < MAX_BEADS; i++) beadIdx[i * 3] = i;   // position.x = 序号 k
  const beadGeo = new THREE.BufferGeometry();
  beadGeo.setAttribute("position", new THREE.BufferAttribute(beadIdx, 3));

  const makeBeadMat = () => new THREE.ShaderMaterial({
    uniforms: {
      uFront:      { value: 0 },
      uDir:        { value: new THREE.Vector3(1, 0, 0) },
      uRayLen:     { value: 0 },
      uDotSpacing: { value: UNITS_PER_LIGHT_SEC },   // 1 光秒对应的世界单位
      uPointPx:    { value: BEAD_PX },
      uProjScale:  { value: 900 },                  // (视口高/2)/tan(fov/2)，每帧刷新
      uPixelRatio: { value: 1 },
    },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uFront;
      uniform vec3  uDir;
      uniform float uRayLen;
      uniform float uDotSpacing;
      uniform float uPointPx;
      uniform float uProjScale;
      uniform float uPixelRatio;
      varying float vAlpha;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        float k = position.x;
        float d = uFront - k * uDotSpacing;
        vec4 mv = modelViewMatrix * vec4(uDir * d, 1.0);
        gl_Position = projectionMatrix * mv;
        // gl_Position.w 就是该点的视空间深度
        float depth = max(gl_Position.w, 1e-6);
        float gapPx = uDotSpacing * uProjScale / depth;   // 相邻亮点的屏幕间距
        // 点径不超过间距的 3/4 → 任何缩放下都不会相邻重叠糊成亮线；
        // 间距太小时整体淡出，避免远景里成千上万个点叠加过曝。
        float sizePx = min(uPointPx, gapPx * 0.75);
        float fade = smoothstep(0.8, 3.0, gapPx);
        vAlpha = fade;
        gl_PointSize = max(sizePx, 0.0) * uPixelRatio;
        // 光未走到 / 超出行星 / 远景点密到看不见 → 移出裁剪空间
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
    const arr = new Float32Array(6);   // 太阳中心 → 行星当前位置
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
    return { cfg, arr, geo, mat, beadMat };
  });

  const _v = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  let cameraInside = false;

  function update(lightSec, simTime) {
    const R = frontRadius(lightSec);
    for (const m of scalable) m.scale.setScalar(R);

    // rig.updateCamera 只改了 position/quaternion，renderer.render 才会刷新
    // matrixWorld；本函数在 render 之前执行，需自行取本帧相机位置。
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    cameraInside = _camPos.lengthSq() < R * R;
    sphereUniforms.uInside.value = cameraInside ? 1 : 0;

    // 亮点淡出用的屏幕尺度：(视口高/2)/tan(fov/2)，与 renderer 的像素比一致
    const projScale = (window.innerHeight * 0.5) / Math.tan(camera.fov * Math.PI / 360);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    for (const r of rays) {
      orbitalPosition(r.cfg, simTime, _v);
      r.arr[0] = 0; r.arr[1] = 0; r.arr[2] = 0;
      r.arr[3] = _v.x; r.arr[4] = _v.y; r.arr[5] = _v.z;
      r.geo.attributes.position.needsUpdate = true;
      r.mat.uniforms.uFront.value = R;

      const bu = r.beadMat.uniforms;
      bu.uFront.value = R;
      bu.uDir.value.copy(_v).normalize();
      bu.uRayLen.value = _v.length();
      bu.uProjScale.value = projScale;
      bu.uPixelRatio.value = pixelRatio;
    }
  }

  function setVisible(on) {
    group.visible = on;
  }

  return { update, setVisible, isInside: () => cameraInside };
}
