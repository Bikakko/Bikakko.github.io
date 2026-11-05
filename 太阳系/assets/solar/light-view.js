/* ============================================================
   太阳系 · Solar · 光速视觉层（3D）
   - 波前球壳：fresnel 薄壳，从壳外/壳内看都是一道膨胀的亮环
   - 八条光线：着色器按「世界半径 > uFront」裁断，前端高亮
   两者都是加性叠加层，不参与真实比例计算；自定义 ShaderMaterial
   必须注入对数深度片段（见 shaders.js）。
   ============================================================ */
import * as THREE from "three";
import { PLANETS } from "./bodies.js";
import { orbitalPosition } from "./orbit-math.js";
import { frontRadius } from "./light-math.js";
import {
  LOGDEPTH_PARS_VERT, LOGDEPTH_VERT, LOGDEPTH_PARS_FRAG, LOGDEPTH_FRAG,
} from "./shaders.js";

export function createLightView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffcf80) },
      uOpacity: { value: 0.9 },
    },
    transparent: true, depthWrite: false, depthTest: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_VERT}
      void main() {
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
      varying vec3 vN;
      varying vec3 vView;
      ${LOGDEPTH_PARS_FRAG}
      void main() {
        // 只留轮廓：相机在壳内时看到的是从内侧掠过的环
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vView)));
        float a = pow(rim, 8.0) * uOpacity;
        gl_FragColor = vec4(uColor, a);
        ${LOGDEPTH_FRAG}
      }
    `,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), shellMat);
  shell.frustumCulled = false;
  shell.renderOrder = 3;
  group.add(shell);

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

  function update(lightSec, simTime) {
    const front = frontRadius(lightSec);
    shell.scale.setScalar(front);
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

  return { update, setVisible };
}
