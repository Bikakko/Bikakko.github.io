/* ============================================================
   形状（pck00011 扁球）与贴图管线回归
   - shape 数据快照：赤道/极半径与 NAIF pck00011.tpc RADII 一致
   - 平均半径口径不变：radiusKm/radius 仍是事实表平均半径
   - 一光秒 = 7.48 个地球赤道周长（用户验收口径，km 与世界单位双校验）
   - 缩放下限（SURFACE_RATIO）在改用赤道半径几何后仍在球面之外
   - 扁球法线补偿 uNScale=(1,1/s²,1) 与 three 法线矩阵逐方向一致
   - applyBodyMap 的色彩空间约定：自定义 shader NoColorSpace / 标准材质 sRGB
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PLANETS, SUN_CFG, MOON_CFG } from "../assets/solar/bodies.js";
import { kmToUnit } from "../assets/solar/config.js";
import { SURFACE_RATIO } from "../assets/solar/camera-focus.js";
import { makePlanetMaterial } from "../assets/solar/shaders.js";
import { applyBodyMap, WHITE_TEX } from "../assets/solar/textures.js";

// NAIF pck00011.tpc 三轴 RADII 快照（赤道, 极），单位 km
const PCK_RADII = {
  "水星": [2440.53, 2438.26],
  "地球": [6378.1366, 6356.7519],
  "火星": [3396.19, 3376.20],
  "木星": [71492, 66854],
  "土星": [60268, 54364],
  "天王星": [25559, 24973],
  "海王星": [24764, 24341],
};

const byName = (n) => PLANETS.find((p) => p.name === n);

test("shape 与 pck00011 RADII 快照一致；太阳/金星/月球为球体不带 shape", () => {
  for (const [name, [eq, pol]] of Object.entries(PCK_RADII)) {
    const cfg = byName(name);
    assert.ok(cfg.shape, `${name} 缺少 shape`);
    assert.equal(cfg.shape.equatorialKm, eq, `${name} 赤道半径`);
    assert.equal(cfg.shape.polarKm, pol, `${name} 极半径`);
    assert.ok(pol <= eq, `${name} 极半径应不大于赤道半径`);
    // 事实表平均半径（体积平均）落在极半径与赤道半径之间
    assert.ok(pol <= cfg.radiusKm && cfg.radiusKm <= eq,
      `${name} 平均半径 ${cfg.radiusKm} 应在 [${pol}, ${eq}] 内`);
  }
  assert.ok(!byName("金星").shape, "金星 pck 为球体");
  assert.ok(!SUN_CFG.shape, "太阳 pck 为球体");
  assert.ok(!MOON_CFG.shape, "月球 pck 为球体");
});

test("扁率 sanity：地球 ≈ WGS84 1/298.257，木星 >6%，土星 >9%", () => {
  const f = (cfg) => (cfg.shape.equatorialKm - cfg.shape.polarKm) / cfg.shape.equatorialKm;
  assert.ok(Math.abs(f(byName("地球")) - 1 / 298.257223563) < 1e-7, "地球扁率");
  assert.ok(f(byName("木星")) > 0.06, "木星扁率");
  assert.ok(f(byName("土星")) > 0.09, "土星扁率");
});

test("一光秒正好等于 7.48 个地球赤道周长（km 与世界单位同比例）", () => {
  const C_KM_PER_S = 299792.458;
  const earth = byName("地球");
  assert.equal(earth.shape.equatorialKm, 6378.1366);

  const ratioKm = C_KM_PER_S / (2 * Math.PI * earth.shape.equatorialKm);
  assert.equal(ratioKm.toFixed(2), "7.48", `km 口径比值 ${ratioKm}`);

  // 世界单位是 km 的线性缩放，比值必须不变（比例自洽的独立交叉校验）
  const ratioU = kmToUnit(C_KM_PER_S) / (2 * Math.PI * kmToUnit(earth.shape.equatorialKm));
  assert.equal(ratioU.toFixed(2), "7.48", `世界单位口径比值 ${ratioU}`);
  assert.ok(Math.abs(ratioKm - ratioU) < 1e-12, "两种口径应严格同比例");
});

test("几何改用赤道半径后，聚焦缩放下限仍在球面之外", () => {
  for (const cfg of PLANETS) {
    const eqKm = cfg.shape ? cfg.shape.equatorialKm : cfg.radiusKm;
    // 下限 = 平均半径 × SURFACE_RATIO；最大表面 extent = 赤道半径
    assert.ok(cfg.radiusKm * SURFACE_RATIO > eqKm,
      `${cfg.name} 下限 ${cfg.radiusKm * SURFACE_RATIO} 应大于赤道半径 ${eqKm}`);
    assert.ok(cfg.radius * SURFACE_RATIO > kmToUnit(eqKm), `${cfg.name} 世界单位口径`);
  }
});

test("uNScale=(1,1/s²,1) 补偿与 three 法线矩阵逐方向一致", () => {
  // 着色器算法：normalize(mat3(modelMatrix) * (normal * uNScale))
  // 权威参照：three 的 getNormalMatrix（逆转置），含旋转以覆盖一般模型矩阵
  const ratios = [
    6356.7519 / 6378.1366,   // 地球
    66854 / 71492,           // 木星
    54364 / 60268,           // 土星
    1,                       // 球体回退
  ];
  const dirs = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0.6, 0.8, 0),
    new THREE.Vector3(1, 1, 1).normalize(),
  ];
  for (const s of ratios) {
    const m = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(0.3, 0.7, 0.1))
      .multiply(new THREE.Matrix4().makeScale(1, s, 1));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const uNScale = new THREE.Vector3(1, 1 / (s * s), 1);
    for (const n of dirs) {
      const expected = n.clone().applyMatrix3(nm).normalize();
      const actual = n.clone().multiply(uNScale).transformDirection(m);
      assert.ok(expected.distanceTo(actual) < 1e-9,
        `s=${s} n=${n.toArray()} 期望 ${expected.toArray()} 实得 ${actual.toArray()}`);
    }
  }
});

test("makePlanetMaterial 默认携带安全的贴图/法线缩放 uniform", () => {
  const mat = makePlanetMaterial(byName("地球"));
  assert.equal(mat.uniforms.uHasMap.value, 0);
  assert.equal(mat.uniforms.uMap.value, WHITE_TEX);
  assert.deepEqual(mat.uniforms.uNScale.value.toArray(), [1, 1, 1]);
  assert.ok(mat.vertexShader.includes("uNScale"), "顶点着色器应使用法线补偿");
  assert.ok(mat.vertexShader.includes("vUv"), "顶点着色器应传递 uv");
  assert.ok(mat.fragmentShader.includes("uHasMap"), "片元着色器应有贴图开关");
});

test("applyBodyMap：自定义 shader 保持 NoColorSpace 原样采样并点亮 uHasMap", () => {
  const mat = makePlanetMaterial(byName("火星"));
  const tex = new THREE.DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1);
  applyBodyMap(mat, tex, { anisotropy: 4 });
  assert.equal(mat.uniforms.uMap.value, tex);
  assert.equal(mat.uniforms.uHasMap.value, 1);
  assert.equal(tex.colorSpace, THREE.NoColorSpace, "自定义 shader 绕过色彩管线，必须原样采样");
  assert.equal(tex.anisotropy, 4);
});

test("applyBodyMap：标准材质走 sRGB 解码并把底色重置为白", () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 1 });
  const tex = new THREE.DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1);
  applyBodyMap(mat, tex);
  assert.equal(mat.map, tex);
  assert.equal(tex.colorSpace, THREE.SRGBColorSpace, "内建管线需要 sRGB 解码");
  assert.equal(mat.color.getHex(), 0xffffff, "底色不重置会乘暗位图");
});