import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { updatePlanets, updateSun } from "../assets/solar/body-system.js";
import { makePose } from "../assets/solar/pose.js";
import { orbitalPosition, barycenterCorrectedPosition } from "../assets/solar/orbit-math.js";
import { spinAngleRad } from "../assets/solar/orientation-math.js";
import { SUN_CFG, MOON_CFG, PLANETS } from "../assets/solar/bodies.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const out = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

// 用 Object3D 搭出与 space.js 同构的记录结构
function buildPlanets() {
  return PLANETS.map(cfg => ({
    cfg,
    group: new THREE.Object3D(),
    mesh: new THREE.Object3D(),
    pose: makePose(),
    satellites: (cfg.satellites || []).map(s => ({
      cfg: s, mesh: new THREE.Object3D(), pose: makePose(),
    })),
  }));
}

test("updatePlanets：本体位置 = 质心修正轨道位置（含地球摆动）", () => {
  const planets = buildPlanets();
  for (const t of [0, 123.4, 36525]) {
    updatePlanets(planets, t);
    for (const p of planets) {
      const expected = barycenterCorrectedPosition(p.cfg, t, out());
      assert.ok(close(p.group.position.x, expected.x, 1e-12), `${p.cfg.name} t=${t} x`);
      assert.ok(close(p.group.position.y, expected.y, 1e-12), `${p.cfg.name} t=${t} y`);
      assert.ok(close(p.group.position.z, expected.z, 1e-12), `${p.cfg.name} t=${t} z`);
      assert.equal(p.spinRad, spinAngleRad(p.cfg.spin, t));
    }
  }
});

test("updatePlanets：地球卫星按相对轨道定位并同步自转", () => {
  const planets = buildPlanets();
  const earth = planets.find(p => p.cfg.name === "地球");
  assert.equal(earth.satellites.length, 1);
  assert.equal(earth.satellites[0].cfg, MOON_CFG);

  for (const t of [0, 45.6, 900]) {
    updatePlanets(planets, t);
    const sat = earth.satellites[0];
    const expected = orbitalPosition(MOON_CFG, t, out());
    assert.ok(close(sat.mesh.position.x, expected.x, 1e-12));
    assert.ok(close(sat.mesh.position.y, expected.y, 1e-12));
    assert.ok(close(sat.mesh.position.z, expected.z, 1e-12));
    assert.equal(sat.spinRad, spinAngleRad(MOON_CFG.spin, t));
  }
});

test("updatePlanets：同一历元重复更新结果确定", () => {
  const planets = buildPlanets();
  updatePlanets(planets, 777.7);
  const snap = planets.map(p => p.group.position.clone());
  updatePlanets(planets, 777.7);
  planets.forEach((p, i) => assert.ok(p.group.position.equals(snap[i])));
});

test("updateSun：null 安全；有记录时驱动自转", () => {
  assert.doesNotThrow(() => updateSun(null, 100));
  const rec = { cfg: SUN_CFG, mesh: new THREE.Object3D(), pose: makePose() };
  updateSun(rec, 100);
  assert.equal(rec.spinRad, spinAngleRad(SUN_CFG.spin, 100));
});