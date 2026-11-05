/* ============================================================
   太阳系 · Solar · 光速视觉层
   - 波前：全屏「视线 × 波前球」解析求交，每帧按当前相机重建射线。
     不再是世界空间里一块固定朝向的球面，因此镜头平移/旋转时环始终
     钉在太阳的投影方向上，不会因相机进入球壳内部而消失或忽明忽暗。
   - 八条光线：着色器按「世界半径 > uFront」裁断，前端高亮（世界空间
     线段，本来就随相机正确透视）。
   两者都是加性叠加层，不参与真实比例计算；自定义 ShaderMaterial
   必须注入对数深度片段（见 shaders.js）。
   ============================================================ */
import * as THREE from "three";
import { PLANETS, SUN_CFG } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { frontRadius } from "./light-math.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

export function createLightView(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  /* ---------- 波前：屏幕空间视线求交 ----------
     球心固定在世界原点（太阳），半径 = uFront。对每个像素由相机基向量
     重建世界射线 D，解 |C + t·D| = R。切向程度 grazing = sqrt(disc)/R
     （0 = 擦过轮廓，1 = 正对球心），据此画环，与相机位置/朝向完全解耦。 */
  const waveUniforms = {
    uColor:      { value: new THREE.Color(0xffcf80) },
    uOpacity:    { value: 0.9 },
    uFront:      { value: 0 },
    uSunRadius:  { value: SUN_CFG.radius },
    uCamPos:     { value: new THREE.Vector3() },
    uCamRight:   { value: new THREE.Vector3() },
    uCamUp:      { value: new THREE.Vector3() },
    uCamFwd:     { value: new THREE.Vector3() },
    uTanHalfFov: { value: Math.tan(48 * Math.PI / 360) },
    uAspect:     { value: 1 },
  };

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, -1, 0,   1, -1, 0,   1, 1, 0,
    -1, -1, 0,   1,  1, 0,  -1, 1, 0,
  ], 3));
  quadGeo.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0,   1, 0,   1, 1,
    0, 0,   1, 1,   0, 1,
  ], 2));

  const waveMat = new THREE.ShaderMaterial({
    uniforms: waveUniforms,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      ${LOGDEPTH_PARS_VERT}
      void main() {
        vUv = uv;
        // 直接输出裁剪空间坐标：这一层不受任何相机变换影响
        gl_Position = vec4(position.xy, 0.0, 1.0);
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFront;
      uniform float uSunRadius;
      uniform vec3 uCamPos;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      uniform vec3 uCamFwd;
      uniform float uTanHalfFov;
      uniform float uAspect;
      varying vec2 vUv;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        vec2 ndc = vUv * 2.0 - 1.0;
        vec3 D = normalize(uCamFwd
          + ndc.x * uTanHalfFov * uAspect * uCamRight
          + ndc.y * uTanHalfFov * uCamUp);

        float R = max(uFront, uSunRadius);
        float b = dot(uCamPos, D);
        float c2 = dot(uCamPos, uCamPos) - R * R;
        float disc = b * b - c2;
        float sq = sqrt(max(disc, 0.0));
        float tNear = -b - sq;

        // 0 = 擦过球壳轮廓，1 = 正对球心；视线未与球相交时置 1（环外）
        float grazing = clamp(sq / max(R, 1e-6), 0.0, 1.0);
        grazing = mix(1.0, grazing, step(0.0, disc));
        float hit = step(0.0, disc) * step(0.0, tNear);
        float inside = step(c2, 0.0);   // 波前已越过相机

        // 环宽按像素下限给足：细环在像素采样下容易断成虚线
        float w = clamp(max(0.12, fwidth(grazing) * 2.0), 0.12, 0.35);
        float ring = 1.0 - smoothstep(0.0, w, grazing);
        float glow = (1.0 - smoothstep(0.0, 0.55, grazing)) * 0.06;

        vec3 col = mix(vec3(1.0, 0.62, 0.28), uColor, 0.55);
        // 波前已包裹相机时整个天空都在球壳之内，没有轮廓可画：
        // 显式关掉环，只留一层极淡余辉（面板同时标注「光波已越过观察点」）。
        float a = (ring * 0.9 + glow) * hit * (1.0 - inside);
        a += inside * 0.03;
        gl_FragColor = vec4(col, a * uOpacity);
        ${LOGDEPTH_FRAG}
      }
    `,
  });

  const wave = new THREE.Mesh(quadGeo, waveMat);
  wave.frustumCulled = false;
  wave.renderOrder = 10;   // 最后叠加，保证环不被其它透明层抢走
  group.add(wave);

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
    const front = frontRadius(lightSec);

    // 必须取「本帧」相机矩阵：rig.updateCamera 只改了 position/quaternion，
    // renderer.render 才会刷新 matrixWorld，而本函数在 render 之前执行。
    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    waveUniforms.uCamPos.value.copy(_camPos);
    waveUniforms.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    waveUniforms.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    waveUniforms.uCamFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    waveUniforms.uTanHalfFov.value = Math.tan(camera.fov * Math.PI / 360);
    waveUniforms.uAspect.value = camera.aspect;
    waveUniforms.uFront.value = front;

    cameraInside = _camPos.lengthSq() < front * front;

    for (const r of rays) {
      orbitalPosition(r.cfg, simTime, _v);
      r.arr[0] = 0; r.arr[1] = 0; r.arr[2] = 0;
      r.arr[3] = _v.x; r.arr[4] = _v.y; r.arr[5] = _v.z;
      r.geo.attributes.position.needsUpdate = true;
      r.mat.uniforms.uFront.value = front;
    }
  }

  function setVisible(on) {
    group.visible = on;
  }

  return { update, setVisible, isInside: () => cameraInside };
}
