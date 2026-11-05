/* ============================================================
   天体系统每帧更新
   - 行星按轨道要素定位（含 JPL 每世纪长期项）
   - 有卫星的天体（地球）按卫星质量比扣除相对质心的偏移
   - 自转/极轴统一由 IAU 要素驱动
   ============================================================ */
import { orbitalPosition, barycenterCorrectedPosition } from "./orbit-math.js";
import { applyPose } from "./pose.js";

export function updatePlanets(planets, simTime) {
  for (const p of planets) {
    // 轨道线已按含质心摆动的真实轨迹采样，这里不再平移整条椭圆：
    // 平移只保证「当下」穿过地球，椭圆其余部分并不等于地球路径。
    barycenterCorrectedPosition(p.cfg, simTime, p.group.position);

    for (const sat of p.satellites) {
      orbitalPosition(sat.cfg, simTime, sat.mesh.position);
      applyPose(sat, simTime);
    }

    applyPose(p, simTime);
  }
}

export function updateSun(sunRecord, simTime) {
  if (sunRecord) applyPose(sunRecord, simTime);
}
