/* ============================================================
   历元换算（无 three 依赖，可在 Node 直接测试）

   全站唯一的模拟时间 simTime 是「距 J2000.0 的 TT 天数」——JPL 轨道
   要素与 IAU 自转要素都以 TT（≈TDB）为自变量，直接喂 UTC 会让地球自转
   相位差掉一个 ΔT（2026 年约 69 秒 ≈ 0.29° 经度 ≈ 32 km 赤道距离），
   「某地此刻是白天还是黑夜」就会算错。

   J2000.0 = JD 2451545.0 TT = 2000-01-01 12:00:00 TT
   ΔT = TT − UTC = 32.184 s + (TAI − UTC)
   ============================================================ */

export const MS_PER_DAY = 86400000;
export const J2000_JD = 2451545.0;
// Unix 纪元（1970-01-01 00:00 UTC）的儒略日
const UNIX_JD = 2440587.5;
// J2000.0 若按 UTC 读数的 Unix 毫秒；真正的历元还要再加 ΔT
const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/* ---------- 闰秒：TAI − UTC ----------
   IERS 公告 C 的历次跳秒。最后一次是 2017-01-01，此后 IERS 未再插入，
   2026 年仍是 37 s。表外的历史/未来历元退回 Espenak–Meeus 多项式。 */
const LEAP_SECONDS = [
  [Date.UTC(1972, 0, 1), 10], [Date.UTC(1972, 6, 1), 11],
  [Date.UTC(1973, 0, 1), 12], [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14], [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16], [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18], [Date.UTC(1980, 0, 1), 19],
  [Date.UTC(1981, 6, 1), 20], [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22], [Date.UTC(1985, 6, 1), 23],
  [Date.UTC(1988, 0, 1), 24], [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26], [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28], [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30], [Date.UTC(1997, 6, 1), 31],
  [Date.UTC(1999, 0, 1), 32], [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36], [Date.UTC(2017, 0, 1), 37],
];
const TAI_UTC_FIRST = LEAP_SECONDS[0][0];

/* Espenak & Meeus (2006) 的 ΔT 分段多项式，覆盖 JPL 要素的适用区间。
   1972 年以后由闰秒表接管，这里只服务更早的历史与 2050 以后的预报。 */
function deltaTPolynomial(year) {
  let t;
  if (year < 1800) {
    t = (year - 1820) / 100;
    return -20 + 32 * t * t;
  }
  if (year < 1860) {
    t = year - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3
      - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5
      - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (year < 1900) {
    t = year - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3
      - 0.0004473624 * t ** 4 + t ** 5 / 233174;
  }
  if (year < 1920) {
    t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2
      + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (year < 1941) {
    t = year - 1920;
    return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (year < 1961) {
    t = year - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (year < 1986) {
    t = year - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (year < 2005) {
    t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year < 2050) {
    t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  t = (year - 1820) / 100;
  return -20 + 32 * t * t - 0.5628 * (2150 - year);
}

const yearOfMs = (ms) => new Date(ms).getUTCFullYear()
  + (new Date(ms).getUTCMonth() + new Date(ms).getUTCDate() / 32) / 12;

// ΔT（秒）。utcMs 为 Unix 毫秒。
export function deltaTSeconds(utcMs) {
  if (!Number.isFinite(utcMs)) return 69.184;
  if (utcMs >= TAI_UTC_FIRST) {
    let tai = LEAP_SECONDS[0][1];
    for (const [at, s] of LEAP_SECONDS) { if (utcMs >= at) tai = s; else break; }
    return 32.184 + tai;
  }
  return deltaTPolynomial(yearOfMs(utcMs));
}

/* ---------- UTC 毫秒 ↔ simTime（J2000 TT 天数） ---------- */
export function utcMsToTTDays(utcMs) {
  return (utcMs - J2000_UTC_MS) / MS_PER_DAY + deltaTSeconds(utcMs) / 86400;
}

// ΔT 随历元变化极慢，两次迭代即收敛到毫秒以下
export function ttDaysToUtcMs(days) {
  let ms = J2000_UTC_MS + days * MS_PER_DAY;
  for (let i = 0; i < 3; i++) {
    ms = J2000_UTC_MS + (days - deltaTSeconds(ms) / 86400) * MS_PER_DAY;
  }
  return ms;
}

export const ttDaysToJD = (days) => days + J2000_JD;
export const jdToTTDays = (jd) => jd - J2000_JD;
export const utcMsToJD = (ms) => ms / MS_PER_DAY + UNIX_JD;

/* ---------- 时区 ----------
   null = 跟随系统本地时区（含夏令时）；数字 = 固定分钟偏移；
   字符串 = IANA 时区名（如 "Asia/Shanghai"）。
   固定偏移让任意历史历元都可复现，不受运行机器的时区数据库影响；
   IANA 名则按该地点当年的夏令时规则给出当地钟点——悉尼 12 月是 UTC+11
   而不是 +10，写死偏移会把日出日落报早一小时。 */
const zoneFmtCache = new Map();

function zoneParts(utcMs, zone) {
  let fmt = zoneFmtCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, era: "short", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    zoneFmtCache.set(zone, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(utcMs)) p[type] = value;
  return p;
}

// 公元前的年份 Intl 给的是正数 + era=BC，儒略历换算要的是天文年号
const eraYear = (p) => (p.era === "BC" ? 1 - +p.year : +p.year);

function ianaOffsetMinutes(utcMs, zone) {
  const p = zoneParts(utcMs, zone);
  const asUTC = Date.UTC(eraYear(p), +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  // formatToParts 只到秒，先把毫秒抹掉再相减，否则偏移会带上小数秒
  return Math.round((asUTC - Math.floor(utcMs / 1000) * 1000) / 60000);
}

export function zoneOffsetMinutes(utcMs, zone) {
  if (typeof zone === "number") return zone;
  if (typeof zone === "string" && zone) return ianaOffsetMinutes(utcMs, zone);
  return -new Date(utcMs).getTimezoneOffset();
}

// IANA 名是否被运行环境认识（URL 传进来的名字必须先验，否则 Intl 直接抛）
export function isValidZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; }
  catch (_) { return false; }
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const p2 = (n) => String(n).padStart(2, "0");

// Date.UTC 把 0–99 当成 1900+year，公元 50 年会静默变成 1950 年
function utcFromParts(y, mo, d, h, mi, s) {
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  if (y >= 0 && y < 100) { const t = new Date(ms); t.setUTCFullYear(y); return t.getTime(); }
  return ms;
}

// 把 UTC 毫秒按给定时区拆成民用字段
export function civilParts(utcMs, zone) {
  const off = zoneOffsetMinutes(utcMs, zone);
  const d = new Date(utcMs + off * 60000);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(), weekday: d.getUTCDay(), offsetMinutes: off,
  };
}

// 民用字段 → UTC 毫秒。zone=null 时用系统时区解释（自动处理夏令时）
export function civilToUtcMs({ year, month = 1, day = 1, hour = 0, minute = 0, second = 0 }, zone) {
  const wall = utcFromParts(year, month, day, hour, minute, second);
  if (typeof zone === "number") return wall - zone * 60000;
  if (typeof zone === "string" && zone) {
    // 偏移本身依赖时刻，迭代两次即可跨过夏令时切换
    let ms = wall - ianaOffsetMinutes(wall, zone) * 60000;
    return wall - ianaOffsetMinutes(ms, zone) * 60000;
  }
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

export function formatOffset(minutes) {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const a = Math.abs(minutes);
  const m = a % 60;
  return `UTC${sign}${Math.floor(a / 60)}${m ? ":" + p2(m) : ""}`;
}

export function formatDate(utcMs, zone) {
  const c = civilParts(utcMs, zone);
  return `${c.year}-${p2(c.month)}-${p2(c.day)}`;
}

export function formatTime(utcMs, zone) {
  const c = civilParts(utcMs, zone);
  return `${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`;
}

// datetime-local 控件需要的 "YYYY-MM-DDTHH:MM:SS"
export function toLocalInput(utcMs, zone) {
  const c = civilParts(utcMs, zone);
  return `${String(c.year).padStart(4, "0")}-${p2(c.month)}-${p2(c.day)}`
    + `T${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`;
}

export function parseLocalInput(text) {
  const m = /^(-?\d{1,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const parts = {
    year: +m[1], month: +m[2], day: +m[3],
    hour: +m[4], minute: +m[5], second: m[6] ? +m[6] : 0,
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  return parts;
}

export const weekdayName = (utcMs, zone) => WEEKDAYS[civilParts(utcMs, zone).weekday];

/* ---------- 模型适用区间 ----------
   JPL SSD Table 1 的每世纪线性要素标注适用 1800–2050；之外仍会外推，
   但误差随历元迅速增长，UI 必须把这件事说出来而不是假装精确。 */
export const MODEL_MIN_YEAR = 1800;
export const MODEL_MAX_YEAR = 2050;

export function accuracyNote(utcMs) {
  const y = civilParts(utcMs, 0).year;
  if (y < MODEL_MIN_YEAR || y > MODEL_MAX_YEAR) {
    return { level: "out", text: `超出 JPL 要素适用区间 ${MODEL_MIN_YEAR}–${MODEL_MAX_YEAR}，位置仅供参考` };
  }
  if (utcMs >= TAI_UTC_FIRST) {
    return { level: "exact", text: "轨道 JPL 要素 · 自转 IAU 要素 · ΔT 由闰秒表精确给出" };
  }
  return { level: "approx", text: "轨道 JPL 要素 · 自转 IAU 要素 · ΔT 取历史拟合值" };
}