/* ============================================================
   历元换算与日照状态的精度门禁

   容差不是拍脑袋定的：先对着可核对的公开值实测，再取实测误差的
   若干倍。每条都附实测值，改动模型后若精度退化会立刻暴露。
   ============================================================ */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  utcMsToTTDays, ttDaysToUtcMs, deltaTSeconds, ttDaysToJD,
  civilToUtcMs, civilParts, parseLocalInput, toLocalInput, formatOffset,
  accuracyNote,
} from "../assets/solar/ephemeris-time.js";
import {
  subsolarPoint, observerSun, sunApparentLongitude, seasonOf, sunEvents,
  equationOfTimeMinutes, moonPhase, bodyFrame, surfaceNormal, earthState,
  EARTH_CFG,
} from "../assets/solar/earth-state.js";
import { makePose, applyPose } from "../assets/solar/pose.js";
import { DEG } from "../assets/solar/config.js";

const at = (y, mo, d, h = 0, mi = 0, s = 0) => utcMsToTTDays(Date.UTC(y, mo - 1, d, h, mi, s));
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const angErr = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- 历元换算 ---------- */
test("ΔT：闰秒表给出精确值，历史段落在已知值附近", () => {
  // 1972 年起由 IERS 闰秒表决定：ΔT = 32.184 + (TAI − UTC)
  assert.equal(deltaTSeconds(Date.UTC(2000, 0, 1)), 64.184);   // TAI−UTC = 32
  assert.equal(deltaTSeconds(Date.UTC(2017, 0, 1)), 69.184);   // 37，此后未再跳秒
  assert.equal(deltaTSeconds(Date.UTC(2026, 10, 11)), 69.184);
  assert.equal(deltaTSeconds(Date.UTC(2016, 11, 31)), 68.184); // 跳秒前一天仍是 36
  // Espenak–Meeus 历史拟合（实测 −2.786 / 29.071 / 7.62）
  assert.ok(close(deltaTSeconds(Date.UTC(1900, 0, 1)), -2.79, 0.05));
  assert.ok(close(deltaTSeconds(Date.UTC(1950, 0, 1)), 29.07, 0.05));
  assert.ok(close(deltaTSeconds(Date.UTC(1860, 0, 1)), 7.62, 0.05));
});

test("UTC ↔ TT 天数往返误差 < 1ms，J2000 与儒略日锚点正确", () => {
  for (const ms of [Date.UTC(2000, 0, 1, 12), Date.UTC(1900, 5, 15, 3, 20, 11),
    Date.UTC(2026, 10, 11, 6, 32, 7), Date.UTC(2049, 11, 31, 23, 59, 59)]) {
    assert.ok(Math.abs(ttDaysToUtcMs(utcMsToTTDays(ms)) - ms) < 1, `${new Date(ms).toISOString()}`);
  }
  // J2000.0 = JD 2451545.0 TT。同一瞬间的 UTC 钟表读数是 11:58:55.816，
  // 差的就是 ΔT = 64.184 s；把 UTC 正午当成 J2000 会整体偏 64 秒。
  assert.equal(ttDaysToJD(0), 2451545.0);
  assert.ok(close(ttDaysToUtcMs(0), Date.UTC(2000, 0, 1, 12) - 64184, 1));
  assert.ok(close(utcMsToTTDays(Date.UTC(2000, 0, 1, 12)), 64.184 / 86400, 1e-12));
});

test("时区：固定偏移与系统本地都能往返，datetime 控件字符串可解析", () => {
  const ms = Date.UTC(2026, 10, 11, 6, 32, 7);
  for (const zone of [0, 480, -300, 345, 660, null]) {
    const back = civilToUtcMs(civilParts(ms, zone), zone);
    assert.ok(Math.abs(back - ms) < 1000, `zone=${zone} 往返差 ${back - ms}ms`);
    const parsed = parseLocalInput(toLocalInput(ms, zone));
    assert.ok(parsed, `zone=${zone} 控件字符串应可解析`);
    assert.ok(Math.abs(civilToUtcMs(parsed, zone) - ms) < 60000);
  }
  assert.equal(formatOffset(0), "UTC");
  assert.equal(formatOffset(480), "UTC+8");
  assert.equal(formatOffset(-300), "UTC−5");
  assert.equal(formatOffset(345), "UTC+5:45");
  assert.equal(parseLocalInput("2026-13-01T00:00"), null);
  assert.equal(parseLocalInput("2026-11-11T25:00"), null);
  assert.equal(parseLocalInput("垃圾"), null);
});

test("适用区间提示：1800–2050 内区分精确/拟合，之外明确降级", () => {
  assert.equal(accuracyNote(Date.UTC(2026, 0, 1)).level, "exact");
  assert.equal(accuracyNote(Date.UTC(1900, 0, 1)).level, "approx");
  assert.equal(accuracyNote(Date.UTC(1799, 0, 1)).level, "out");
  assert.equal(accuracyNote(Date.UTC(2051, 0, 1)).level, "out");
});

/* ---------- 太阳视黄经：二分二至 ---------- */
test("二分二至时刻太阳视黄经为 0/90/180/270°，实测偏差 ≤ 0.31 角分", () => {
  // USNO 公开时刻（UTC）。实测偏差 0.07 / 0.03 / 0.15 / 0.06 / 0.31 / 0.18 角分
  const cases = [
    [2000, 3, 20, 7, 35, 0], [2000, 6, 21, 1, 48, 90],
    [2000, 9, 22, 17, 27, 180], [2000, 12, 21, 13, 37, 270],
    [2026, 3, 20, 14, 46, 0], [2026, 6, 21, 8, 24, 90],
  ];
  for (const [y, mo, d, h, mi, want] of cases) {
    const err = angErr(sunApparentLongitude(at(y, mo, d, h, mi)), want);
    assert.ok(Math.abs(err) < 0.01,
      `${y}-${mo}-${d} 期望 ${want}°，偏差 ${(err * 60).toFixed(2)} 角分应 < 0.6`);
  }
});

test("岁差项不可省：2026 年几何黄经与视黄经差约 0.37°（敏感性校验）", () => {
  const days = at(2026, 3, 20, 14, 46);
  const ss = subsolarPoint(EARTH_CFG, days);
  const geo = ((Math.atan2(ss.pos.z, -ss.pos.x) / DEG) % 360 + 360) % 360;
  const app = sunApparentLongitude(days, ss.pos);
  const gap = angErr(app, geo);
  // 若这条失败，说明上面的 0.01° 门禁失去了区分力（岁差被误删）
  assert.ok(gap > 0.3 && gap < 0.45, `岁差+章动+光行差合计 ${gap.toFixed(4)}°，应约 0.37°`);
});

/* ---------- 直射点 ---------- */
test("J2000 UTC 正午直射点：纬度 −23.03°、经度 +0.87°（时差约 −3.5 分）", () => {
  const ss = subsolarPoint(EARTH_CFG, at(2000, 1, 1, 12, 0));
  assert.ok(close(ss.latDeg, -23.03, 0.05), `直射纬度 ${ss.latDeg}`);
  assert.ok(close(ss.lonDeg, 0.87, 0.1), `直射经度 ${ss.lonDeg}`);
  // 1 月初时差约 −3.4 分钟（日晷慢于钟表）
  const eot = equationOfTimeMinutes(at(2000, 1, 1, 12, 0), 12, ss.lonDeg);
  assert.ok(close(eot, -3.4, 0.6), `时差 ${eot} 分`);
});

test("直射纬度在二至达到 ±23.44°，二分穿过 0°", () => {
  assert.ok(close(subsolarPoint(EARTH_CFG, at(2026, 6, 21, 8, 24)).latDeg, 23.44, 0.02));
  assert.ok(close(subsolarPoint(EARTH_CFG, at(2026, 12, 21, 20, 50)).latDeg, -23.44, 0.02));
  assert.ok(close(subsolarPoint(EARTH_CFG, at(2026, 3, 20, 14, 46)).latDeg, 0, 0.02));
});

/* ---------- 渲染姿态与读数必须同源 ---------- */
test("earth-state 的表面法线与 applyPose 后的 mesh 四元数逐点一致", () => {
  const rec = { cfg: EARTH_CFG, mesh: new THREE.Object3D(), pose: makePose() };
  for (const days of [0, at(2026, 10, 11, 6, 32), at(1985, 6, 1)]) {
    applyPose(rec, days);
    const frame = bodyFrame(EARTH_CFG, days);
    for (const [lat, lon] of [[0, 0], [0, 90], [39.9, 116.4], [-33.87, 151.21], [66.5, -179]]) {
      const phi = lat * DEG, lam = lon * DEG;
      // 贴图约定：u=0.5（本初子午线）在局部 +X，东经 90° 在局部 −Z
      const local = new THREE.Vector3(
        Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam));
      const viaMesh = local.applyQuaternion(rec.mesh.quaternion);
      const viaMath = surfaceNormal(frame, lat, lon);
      const d = Math.hypot(viaMesh.x - viaMath.x, viaMesh.y - viaMath.y, viaMesh.z - viaMath.z);
      assert.ok(d < 1e-12, `t=${days} (${lat},${lon}) 渲染与读数法线差 ${d}`);
    }
  }
});

test("本初子午线落在 IAU 交点系：W=0 时局部 +X 指向 RA α₀+90°", () => {
  const rec = { cfg: EARTH_CFG, mesh: new THREE.Object3D(), pose: makePose() };
  applyPose(rec, 0);
  // 去掉自转后 +X 就是交点向量；地球 α₀=0 → 赤道 (0,1,0)
  const node = new THREE.Vector3(1, 0, 0).applyQuaternion(rec.pose.qPole);
  // 黄道 (0, cosε, −sinε) → world (0, −sinε, −cosε)
  const eps = 23.4392911 * DEG;
  const expected = new THREE.Vector3(0, -Math.sin(eps), -Math.cos(eps));
  assert.ok(node.distanceTo(expected) < 1e-9, `交点方向 ${node.toArray()}`);
});

/* ---------- 观测地昼夜与日出日落 ---------- */
test("北京 2026-06-21：日出 04:46、日落 19:46、昼长 15h00m（公开值分钟级吻合）", () => {
  const ev = sunEvents(at(2026, 6, 21, 4, 0), 39.9042, 116.4074);
  const rise = ttDaysToUtcMs(ev.sunriseDays) + 8 * 3600000;
  const set = ttDaysToUtcMs(ev.sunsetDays) + 8 * 3600000;
  const hm = (ms) => { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };
  assert.ok(close(hm(rise), 4 * 60 + 46, 1.5), `日出 ${hm(rise)} 分`);
  assert.ok(close(hm(set), 19 * 60 + 46, 1.5), `日落 ${hm(set)} 分`);
  assert.ok(close(ev.dayLengthHours, 15.0, 0.03), `昼长 ${ev.dayLengthHours}h`);
  assert.equal(ev.polar, null);
});

test("悉尼 2026-12-21：日出 05:41、日落 20:06、昼长 14h25m（南半球盛夏）", () => {
  const ev = sunEvents(at(2026, 12, 21, 1, 0), -33.8688, 151.2093);
  const hm = (ms) => { const d = new Date(ms + 11 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };
  assert.ok(close(hm(ttDaysToUtcMs(ev.sunriseDays)), 5 * 60 + 41, 1.5));
  assert.ok(close(hm(ttDaysToUtcMs(ev.sunsetDays)), 20 * 60 + 6, 1.5));
  assert.ok(close(ev.dayLengthHours, 14.42, 0.03));
});

test("极圈内二至给出极昼/极夜，不返回虚假的日出日落", () => {
  const summer = sunEvents(at(2026, 6, 21), 89, 0);
  const winter = sunEvents(at(2026, 12, 21), 89, 0);
  assert.equal(summer.polar, "day");
  assert.equal(summer.sunriseDays, null);
  assert.equal(summer.dayLengthHours, 24);
  assert.equal(winter.polar, "night");
  assert.equal(winter.dayLengthHours, 0);
});

test("太阳高度角与方位：正午偏南、上午偏东，昼夜判据与高度角一致", () => {
  const days = at(2026, 11, 11, 6, 32);   // 北京 14:32
  const noon = observerSun(EARTH_CFG, days, 39.9042, 116.4074);
  assert.ok(noon.isDay && noon.elevationDeg > 20 && noon.elevationDeg < 25,
    `高度角 ${noon.elevationDeg}`);
  assert.ok(noon.azimuthDeg > 180 && noon.azimuthDeg < 270, `午后应偏西南，实得 ${noon.azimuthDeg}`);
  const morning = observerSun(EARTH_CFG, at(2026, 11, 11, 0, 0), 39.9042, 116.4074);
  assert.ok(morning.azimuthDeg > 90 && morning.azimuthDeg < 180, `上午应偏东南，实得 ${morning.azimuthDeg}`);
  const night = observerSun(EARTH_CFG, at(2026, 11, 11, 14, 32), 39.9042, 116.4074);
  assert.equal(night.isDay, false);
  assert.ok(night.elevationDeg < 0);
});

test("真太阳时 = 平太阳时 + 时差；11 月时差约 +15.6 分", () => {
  const days = at(2026, 11, 11, 6, 32);
  const st = earthState(days, 39.9042, 116.4074, 6 + 32 / 60);
  assert.ok(close(st.equationOfTimeMinutes, 15.6, 1.0), `时差 ${st.equationOfTimeMinutes}`);
  const meanSolar = 6 + 32 / 60 + 116.4074 / 15;
  const apparent = ((meanSolar + st.equationOfTimeMinutes / 60) % 24 + 24) % 24;
  assert.ok(close(apparent, st.sun.apparentSolarHours, 1e-6),
    `真太阳时 ${st.sun.apparentSolarHours} 应等于 ${apparent}`);
});

/* ---------- 季节与月相 ---------- */
test("季节按太阳视黄经分四象限，南北半球相反，并给出下一个节气", () => {
  assert.equal(seasonOf(10).north, "春");
  assert.equal(seasonOf(100).north, "夏");
  assert.equal(seasonOf(200).north, "秋");
  assert.equal(seasonOf(300).north, "冬");
  assert.equal(seasonOf(100).south, "冬");
  assert.equal(seasonOf(350).nextTermN, "春分");
  // 北半球的夏至就是南半球的冬至，节气名必须跟着半球换
  assert.equal(seasonOf(10).nextTermN, "夏至");
  assert.equal(seasonOf(10).nextTermS, "冬至");
  assert.equal(seasonOf(100).nextTermS, "春分");
  assert.ok(close(seasonOf(350).daysToNextTerm, 10.15, 0.2));
  // 2026-03-20 12:00 UTC 仍在春分（14:46）之前
  assert.equal(seasonOf(sunApparentLongitude(at(2026, 3, 20, 12, 0))).north, "冬");
  assert.equal(seasonOf(sunApparentLongitude(at(2026, 3, 20, 15, 0))).north, "春");
});

test("月相：已知新月 0.02%、满月 99.99%、上弦 51%（2000 年 1 月）", () => {
  const nm = moonPhase(at(2000, 1, 6, 18, 14));
  assert.equal(nm.name, "新月");
  assert.ok(nm.illuminated < 0.005, `新月照度 ${nm.illuminated}`);
  const fm = moonPhase(at(2000, 1, 21, 4, 40));
  assert.equal(fm.name, "满月");
  assert.ok(fm.illuminated > 0.995, `满月照度 ${fm.illuminated}`);
  const fq = moonPhase(at(2000, 1, 14, 13, 34));
  assert.equal(fq.name, "上弦月");
  assert.ok(close(fq.illuminated, 0.5, 0.03));
  assert.equal(fq.waxing, true);
  assert.equal(moonPhase(at(2000, 1, 28, 7, 57)).name, "下弦月");
});