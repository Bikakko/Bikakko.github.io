/* ============================================================
   天体姿态：把 IAU 极轴/自转要素转成 three.js 四元数

   局部 +Y = 自转极轴，局部 +X = W=0 时的本初子午线方向。
   X 必须取 IAU 交点向量（RA α₀+90°）而不是「把 Y 转到极轴的最短弧」：
   后者绕极轴的扭转是任意的，贴图上的本初子午线会落在错误的经度上，
   「某地此刻是白天还是黑夜」随之算错。
   ============================================================ */
import * as THREE from "three";
import { poleAt, nodeAt, eclipticToWorld, spinAngleRad } from "./orientation-math.js";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _pole = new THREE.Vector3();
const _node = new THREE.Vector3();
const _third = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export function makePose() {
  return { qPole: new THREE.Quaternion(), qSpin: new THREE.Quaternion() };
}

export function applyPose(record, days) {
  const { cfg, mesh, pose } = record;

  const pw = eclipticToWorld(poleAt(cfg, days));
  const nw = eclipticToWorld(nodeAt(cfg, days));
  _pole.set(pw.x, pw.y, pw.z).normalize();
  _node.set(nw.x, nw.y, nw.z);
  // 极轴与交点各自线性外推，理论上正交但会差出极小量；先正交化再建系
  _node.addScaledVector(_pole, -_node.dot(_pole)).normalize();
  _third.crossVectors(_node, _pole);
  _basis.makeBasis(_node, _pole, _third);
  pose.qPole.setFromRotationMatrix(_basis);

  const angle = spinAngleRad(cfg.spin, days);
  pose.qSpin.setFromAxisAngle(Y_AXIS, angle);
  mesh.quaternion.copy(pose.qPole).multiply(pose.qSpin);
  record.spinRad = angle;

  // 光环平面必须垂直于同一极轴
  if (record.ring) record.ring.quaternion.copy(pose.qPole);
}
