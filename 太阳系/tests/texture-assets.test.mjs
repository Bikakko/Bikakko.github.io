/* ============================================================
   贴图资产回归：mapUrl 必须指向真实存在的 JPEG 成品
   防止「代码挂了贴图、文件却没进仓库」的静默回退。
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLANETS, MOON_CFG, SUN_CFG } from "../assets/solar/bodies.js";

test("地球与月球已挂接位图", () => {
  assert.ok(PLANETS.find((p) => p.name === "地球").mapUrl, "地球应有 mapUrl");
  assert.ok(MOON_CFG.mapUrl, "月球应有 mapUrl");
});

test("每个 mapUrl 指向真实存在的 JPEG 成品（>10KB，FFD8FF 魔数）", () => {
  const withMap = [...PLANETS, MOON_CFG, SUN_CFG].filter((c) => c.mapUrl);
  assert.ok(withMap.length >= 2);
  for (const cfg of withMap) {
    // mapUrl 相对 solar.html（太阳系/），测试相对 tests/ 解析
    const path = fileURLToPath(new URL(`../${cfg.mapUrl}`, import.meta.url));
    const st = statSync(path);
    assert.ok(st.size > 10240, `${cfg.name} 贴图过小：${st.size} B`);
    const head = readFileSync(path).subarray(0, 3);
    assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${cfg.name} 应为 JPEG`);
  }
});