/* ============================================================
   天体系统每帧更新
   - 行星按轨道要素定位
   - 有卫星的天体（地球）按卫星质量比扣除相对质心的偏移
   - 自转/极轴统一由 IAU 要素驱动
   ============================================================ */
import * as THREE from "three";
import { orbitalPosition } from "./orbit-math.js";
import { applyPose } from "./pose.js";

const _bary = new THREE.Vector3();

export function updatePlanets(planets, simTime) {
  for (const p of planets) {
    const bary = orbitalPosition(p.cfg, simTime, _bary);

    // 卫星相对母体的位置；地球的 JPL 轨道是地月质心，需扣回地球本体偏移
    let offsetX = 0, offsetY = 0, offsetZ = 0;
    for (const sat of p.satellites) {
      orbitalPosition(sat.cfg, simTime, sat.mesh.position);
      const m = sat.cfg.massRatio || 0;
      offsetX += sat.mesh.position.x * m;
      offsetY += sat.mesh.position.y * m;
      offsetZ += sat.mesh.position.z * m;
      applyPose(sat, simTime);
    }

    p.group.position.set(
      bary.x - offsetX,
      bary.y - offsetY,
      bary.z - offsetZ,
    );

    // 轨道线画在质心轨道上；有卫星的天体（地球）需要把线平移到本体，
    // 否则近距离看线会从星球旁边擦过去。
    if (p.orbitLine) {
      p.orbitLine.position.set(-offsetX, -offsetY, -offsetZ);
    }

    applyPose(p, simTime);
  }
}

export function updateSun(sunRecord, simTime) {
  if (sunRecord) applyPose(sunRecord, simTime);
}
