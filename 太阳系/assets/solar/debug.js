/* ============================================================
   太阳系 · Solar · 调试探针（?debug=1）
   用于验证自转轴、季节、比例与相机状态，生产访问不受影响
   ============================================================ */
import * as THREE from "three";
import { SUN_CFG, MOON_CFG } from "./bodies.js";
import {
  AU_UNIT, KM_PER_UNIT, RADIUS_SCALE, TAU, DEG,
} from "./config.js";

export function installDebug({ space, rig, hud, camera, lightHud }) {
  const { planets } = space;
  const orbit = rig.orbit;

  window.__dbg = {
    get planets() { return planets.map(p => p.cfg.name); },
    // 某颗行星的自转轴在世界空间的方向
    axis(name) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return null;
      p.mesh.updateWorldMatrix(true, false);
      const m = p.mesh.matrixWorld;
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
      return { x: +up.x.toFixed(4), y: +up.y.toFixed(4), z: +up.z.toFixed(4) };
    },
    // 太阳直射点纬度：行星→太阳 方向与自转轴的夹角余角
    subsolarLat(name) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return null;
      p.mesh.updateWorldMatrix(true, false);
      const q = new THREE.Quaternion().setFromRotationMatrix(p.mesh.matrixWorld);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
      const wp = new THREE.Vector3();
      p.group.getWorldPosition(wp);
      const toSun = wp.clone().negate().normalize();
      const s = axis.dot(toSun);                    // sin(直射纬度)
      return +(Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI).toFixed(2);
    },
    // 把某行星推到指定平近点角（度），用于扫一圈看季节
    setAngle(name, deg) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return false;
      // 与 orbit-math 一致：M = L(T) − ϖ(T)，不再用固定恒星周期叠加相位
      const T = hud.getSimTime() / 36525;
      const r = p.cfg.rates || {};
      const L = p.cfg.meanLonDeg + (r.meanLonDegPerCentury || 0) * T;
      const varpi = p.cfg.varpiDeg + (r.varpiDegPerCentury || 0) * T;
      const M = (L - varpi) * DEG;
      p.cfg.mAnomalyBias = deg * DEG - M;
      return true;
    },
    get sunRadius() { return SUN_CFG.radius; },
    get simTime() { return hud.getSimTime(); },
    // 光速时钟探针：用于验证 ?light=1&lt= 截图复现与回放状态
    get light() {
      return lightHud
        ? { on: lightHud.isOn(), seconds: +lightHud.getLightSec().toFixed(2) }
        : null;
    },
    // 光标缩放探针：返回光标下目标平面点的世界坐标
    probe(x, y) {
      camera.updateMatrixWorld();
      const d = orbit.dist;
      const ndcX = (x / innerWidth) * 2 - 1;
      const ndcY = -(y / innerHeight) * 2 + 1;
      const halfH = d * Math.tan(camera.fov * Math.PI / 360);
      const halfW = halfH * camera.aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const p = right.multiplyScalar(ndcX * halfW).addScaledVector(up, ndcY * halfH);
      return {
        world: orbit.target.clone().add(p).toArray(),
        target: orbit.target.toArray(),
        dist: orbit.dist,
        near: camera.near,
      };
    },
    project(world) {
      const v = new THREE.Vector3(world[0], world[1], world[2]).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
    },
    screenOf(name) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return null;
      const v = new THREE.Vector3();
      p.group.getWorldPosition(v);
      v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
    worldOf(name) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return null;
      const v = new THREE.Vector3();
      p.group.getWorldPosition(v);
      return v.toArray();
    },
    labelProbe(name) {
      const p = planets.find(x => x.cfg.name === name);
      if (!p) return null;
      const v = new THREE.Vector3();
      p.group.getWorldPosition(v);
      v.project(camera);
      const halfW = innerWidth / 2, halfH = innerHeight / 2;
      const sx = (v.x * halfW) + halfW;
      const sy = (-v.y * halfH) + halfH;
      const wp = new THREE.Vector3();
      p.group.getWorldPosition(wp);
      const dist = camera.position.distanceTo(wp);
      const rPx = (p.cfg.radius / (dist * Math.tan(camera.fov * Math.PI / 360))) * halfH;
      const sun = new THREE.Vector3(0, 0, 0).project(camera);
      return {
        sx: +sx.toFixed(3), sy: +sy.toFixed(3), dist: +dist.toFixed(9), rPx: +rPx.toFixed(3),
        syOut: +Math.min(sy + rPx + 10, innerHeight - 26).toFixed(3),
        sun: {
          x: +((sun.x * halfW) + halfW).toFixed(3),
          y: +((-sun.y * halfH) + halfH).toFixed(3),
          z: +sun.z.toFixed(6),
        },
      };
    },
    get focusName() {
      const f = rig.getFocusTarget();
      return f ? f.cfg.name : null;
    },
    // 轨道线相对质心轨道的平移（地球会随月球质心偏移）
    orbitLines() {
      return planets.map(p => ({
        name: p.cfg.name,
        offset: p.orbitLine ? p.orbitLine.position.toArray().map(v => +v.toFixed(9)) : null,
      }));
    },
    get zoomAnchor() { return rig.getZoomAnchorName(); },
    view() {
      const f = rig.getFocusTarget();
      return {
        theta: +orbit.theta.toFixed(9), phi: +orbit.phi.toFixed(9),
        dist: +orbit.dist.toFixed(9), tDist: +orbit.tDist.toFixed(9),
        target: orbit.target.toArray().map(v => +v.toFixed(9)),
        panOffset: orbit.panOffset.toArray().map(v => +v.toFixed(12)),
        focus: f ? f.cfg.name : null,
      };
    },
    get scale() {
      return { auUnit: AU_UNIT, kmPerUnit: KM_PER_UNIT, radiusScale: RADIUS_SCALE };
    },
    radiiKm() {
      const out = { "太阳": 695700 };
      for (const p of planets) out[p.cfg.name] = p.cfg.radiusKm;
      return out;
    },
    // 实际几何半径：太阳 + 八行星（世界单位）
    radii() {
      const out = { "太阳": SUN_CFG.radius };
      for (const p of planets) out[p.cfg.name] = +p.mesh.geometry.parameters.radius.toFixed(10);
      return out;
    },
    orbitsAU() {
      const out = {};
      for (const p of planets) out[p.cfg.name] = p.cfg.aAU;
      return out;
    },
    moon() {
      return {
        radiusKm: MOON_CFG.radiusKm, radius: MOON_CFG.radius,
        distanceKm: +(MOON_CFG.orbit * KM_PER_UNIT).toFixed(1),
        distance: MOON_CFG.orbit,
        periodDays: MOON_CFG.orbitDays,
      };
    },
    // 当前自转角（弧度）与当前周期内圈数，用于核对真实自转周期
    spins() {
      return planets.map(p => ({
        name: p.cfg.name,
        rotation: +p.spinRad.toFixed(6),
        turns: +(p.spinRad / TAU).toFixed(3),
      }));
    },
    // 比例审计：半径比例应恒为 RADIUS_SCALE，轨道比例应恒为 AU_UNIT
    audit() {
      return planets.map(p => ({
        name: p.cfg.name,
        radiusScale: +(p.cfg.radius / (p.cfg.radiusKm / KM_PER_UNIT)).toFixed(9),
        orbitScale: +(p.cfg.orbit / p.cfg.aAU).toFixed(9),
      }));
    },
  };
}
