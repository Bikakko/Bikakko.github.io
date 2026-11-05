/* ============================================================
   天体姿态：把 IAU 极轴/自转要素转成 three.js 四元数
   局部 +Y = 自转极轴；自转绕局部 +Y
   ============================================================ */
import * as THREE from "three";
import { poleAt, eclipticToWorld, spinAngleRad } from "./orientation-math.js";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _pole = new THREE.Vector3();

export function makePose() {
  return { qPole: new THREE.Quaternion(), qSpin: new THREE.Quaternion() };
}

export function applyPose(record, days) {
  const { cfg, mesh, pose } = record;

  const pe = poleAt(cfg, days);
  const pw = eclipticToWorld(pe);
  _pole.set(pw.x, pw.y, pw.z).normalize();
  pose.qPole.setFromUnitVectors(Y_AXIS, _pole);

  const angle = spinAngleRad(cfg.spin, days);
  pose.qSpin.setFromAxisAngle(Y_AXIS, angle);
  mesh.quaternion.copy(pose.qPole).multiply(pose.qSpin);
  record.spinRad = angle;

  // 光环平面必须垂直于同一极轴
  if (record.ring) record.ring.quaternion.copy(pose.qPole);
}
