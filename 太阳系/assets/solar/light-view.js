/* ============================================================
   太阳系 · Solar · 3D 光速视觉层
   - 波前是一个真实 3D 球：半透明球面（经纬网格 + 轮廓光，DoubleSide
     内表面也可见）+ 三个正交大圆（波前球与黄道面 / 两条子午面的交圆）。
     全部随相机正确透视；相机在球内球外都能看到「光弧」与球面覆盖区域。
   - 网格线与大圆都有屏幕像素宽度下限，光球刚出发时也看得见。
   - 八条太阳→行星光线，按世界半径裁断，前端高亮。
   自定义 ShaderMaterial 必须注入对数深度片段（见 shaders.js）。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { frontRadius } from "./light-math.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

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
        float lonC = lon * 8.0;
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

  /* ---------- 三个正交大圆（波前球的交圆 / 「光弧」） ----------
     真实 3D 几何，半径 = 波前半径，透视成椭圆。赤道圆就在黄道面上，
     可直接和各行星轨道对比「光走到哪了」；两条子午圆给出球体的纵深。
     相机在球内时这些圆仍在视野中。粗环（RingGeometry）负责大光球的
     观感，1px 保底细环（LineLoop）保证光球刚出发时也看得见。 */
  const ringGeo = new THREE.RingGeometry(0.980, 1.0, 256);
  const circlePts = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    circlePts.push(Math.cos(a), Math.sin(a), 0);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(circlePts, 3));

  const makeRing = (color, opacity, rotX, rotY) => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    }));
    m.rotation.set(rotX, rotY, 0);
    m.renderOrder = 3;
    group.add(m);
    scalable.push(m);

    const edge = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: Math.min(1, opacity * 1.1),
      depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    }));
    edge.rotation.set(rotX, rotY, 0);
    edge.renderOrder = 4;
    group.add(edge);
    scalable.push(edge);
  };
  // RingGeometry / LineLoop 默认都在 XY 平面
  makeRing(0xffc878, 0.85, -Math.PI / 2, 0);        // XZ：黄道面
  makeRing(0xff9a5a, 0.40, 0, 0);                    // XY
  makeRing(0xff9a5a, 0.40, 0, Math.PI / 2);          // YZ

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

  const rays = PLANETS.map((cfg) => {
    const arr = new Float32Array(6);   // 太阳中心 → 行星当前位置
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = rayMatFor();
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 3;
    group.add(line);
    return { cfg, arr, geo, mat };
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

    for (const r of rays) {
      orbitalPosition(r.cfg, simTime, _v);
      r.arr[0] = 0; r.arr[1] = 0; r.arr[2] = 0;
      r.arr[3] = _v.x; r.arr[4] = _v.y; r.arr[5] = _v.z;
      r.geo.attributes.position.needsUpdate = true;
      r.mat.uniforms.uFront.value = R;
    }
  }

  function setVisible(on) {
    group.visible = on;
  }

  return { update, setVisible, isInside: () => cameraInside };
}
