import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makePose, applyPose } from "../assets/solar/pose.js";
import { poleAt, eclipticToWorld, spinAngleRad } from "../assets/solar/orientation-math.js";
import { SUN_CFG, MOON_CFG, PLANETS } from "../assets/solar/bodies.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const makeRecord = cfg => ({ cfg, mesh: new THREE.Object3D(), pose: makePose() });
const Y = new THREE.Vector3(0, 1, 0);

// applyPose 后局部 +Y 必须与世界坐标下的 IAU 极轴重合
function assertPoleAligned(record, days, label) {
  const pe = poleAt(record.cfg, days);
  const pw = eclipticToWorld(pe);
  const expected = new THREE.Vector3(pw.x, pw.y, pw.z).normalize();
  const got = Y.clone().applyQuaternion(record.mesh.quaternion);
  assert.ok(got.distanceTo(expected) < 1e-9, `${label} t=${days} 极轴未对齐`);
}

test("applyPose：所有天体局部 +Y 对齐当前历元极轴", () => {
  for (const cfg of [SUN_CFG, MOON_CFG, ...PLANETS]) {
    const rec = makeRecord(cfg);
    for (const days of [0, 123.4, 36525]) {
      applyPose(rec, days);
      assertPoleAligned(rec, days, cfg.name);
    }
  }
});

test("applyPose：spinRad 与 spinAngleRad 一致，四元数为单位四元数", () => {
  for (const cfg of [SUN_CFG, MOON_CFG, ...PLANETS]) {
    const rec = makeRecord(cfg);
    for (const days of [0, 365.25, -90]) {
      applyPose(rec, days);
      assert.equal(rec.spinRad, spinAngleRad(cfg.spin, days), `${cfg.name} t=${days}`);
      assert.ok(close(rec.mesh.quaternion.length(), 1, 1e-12));
    }
  }
});

test("applyPose：同一历元重复应用结果确定", () => {
  const rec = makeRecord(MOON_CFG);
  applyPose(rec, 456.7);
  const q = rec.mesh.quaternion.clone();
  applyPose(rec, 456.7);
  assert.equal(rec.mesh.quaternion.x, q.x);
  assert.equal(rec.mesh.quaternion.y, q.y);
  assert.equal(rec.mesh.quaternion.z, q.z);
  assert.equal(rec.mesh.quaternion.w, q.w);
});

test("applyPose：光环只跟随极轴（不含自转），环面垂直于极轴", () => {
  const saturn = PLANETS.find(p => p.name === "土星");
  const rec = makeRecord(saturn);
  rec.ring = new THREE.Object3D();
  applyPose(rec, 789);
  assert.equal(rec.ring.quaternion.x, rec.pose.qPole.x);
  assert.equal(rec.ring.quaternion.y, rec.pose.qPole.y);
  assert.equal(rec.ring.quaternion.z, rec.pose.qPole.z);
  assert.equal(rec.ring.quaternion.w, rec.pose.qPole.w);

  const pe = poleAt(saturn, 789);
  const pw = eclipticToWorld(pe);
  const pole = new THREE.Vector3(pw.x, pw.y, pw.z).normalize();
  const ringX = new THREE.Vector3(1, 0, 0).applyQuaternion(rec.ring.quaternion);
  assert.ok(close(ringX.dot(pole), 0, 1e-9), "环面应垂直于极轴");
});

test("applyPose：无 ring 的记录不报错", () => {
  const rec = makeRecord(PLANETS[0]);
  assert.doesNotThrow(() => applyPose(rec, 0));
});