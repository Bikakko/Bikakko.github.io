/* ============================================================
   时间面板与地球状态卡

   面板只负责「把用户意图翻译成 simTime」，状态卡只负责「把 simTime
   翻译成读数」。两者都不自己算天体位置：位置来自 hud 的统一时间轴，
   读数来自 earth-state 的同一套几何，所以屏幕上的明暗交界与面板上的
   昼夜/日出日落必然一致。
   ============================================================ */
import { Q, qLat, qLon, qZone } from "./config.js";
import {
  utcMsToTTDays, ttDaysToUtcMs, ttDaysToJD, jdToTTDays,
  civilParts, civilToUtcMs, toLocalInput, parseLocalInput,
  formatOffset, zoneOffsetMinutes, deltaTSeconds, accuracyNote,
  MODEL_MIN_YEAR, MODEL_MAX_YEAR,
} from "./ephemeris-time.js";
import { earthState, planetOverview } from "./earth-state.js";

/* 观测地预设。时区用 IANA 名而不是写死偏移：悉尼 12 月是 UTC+11，
   伦敦 7 月是 UTC+1，写死会把当地钟点报早一小时。 */
const PLACES = [
  { name: "北京", lat: 39.9042, lon: 116.4074, zone: "Asia/Shanghai" },
  { name: "上海", lat: 31.2304, lon: 121.4737, zone: "Asia/Shanghai" },
  { name: "东京", lat: 35.6762, lon: 139.6503, zone: "Asia/Tokyo" },
  { name: "新德里", lat: 28.6139, lon: 77.2090, zone: "Asia/Kolkata" },
  { name: "伦敦", lat: 51.5074, lon: -0.1278, zone: "Europe/London" },
  { name: "纽约", lat: 40.7128, lon: -74.0060, zone: "America/New_York" },
  { name: "悉尼", lat: -33.8688, lon: 151.2093, zone: "Australia/Sydney" },
  { name: "朗伊尔城", lat: 78.2232, lon: 15.6469, zone: "Arctic/Longyearbyen" },
];

const COMPASS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
const STEP_MS = { hour: 3600000, minute: 60000, second: 1000 };

const p2 = (n) => String(n).padStart(2, "0");
const setText = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
const fmtLat = (d) => `${Math.abs(d).toFixed(1)}°${d < 0 ? "S" : "N"}`;
const fmtLon = (d) => `${Math.abs(d).toFixed(1)}°${d < 0 ? "W" : "E"}`;
const fmtDur = (h) => `${Math.floor(h)}h${p2(Math.round((h % 1) * 60))}m`;

function systemZoneName() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch (_) { return null; }
}

export function createTimePanel({ hud, onOpen }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("tp");
  const toggleBtn = $("timeToggle");
  const inputEl = $("tpInput");
  const zoneSel = $("tpZone");
  const unitSel = $("tpUnit");
  const jdEl = $("tpJD");
  const noteEl = $("tpNote");
  const copyBtn = $("tpCopy");

  const stateEl = $("state");
  const stateToggle = $("stateToggle");
  const stateTitle = $("stateTitle");
  const stateCaret = $("stateCaret");
  const placeSel = $("stPlace");
  const customRow = $("stCustom");
  const latEl = $("stLat");
  const lonEl = $("stLon");
  const moreBtn = $("stMore");
  const planetsEl = $("stPlanets");

  /* ---------- 观测地 ---------- */
  let place = PLACES.find((p) => p.zone === systemZoneName()) || PLACES[0];
  let lat = place.lat, lon = place.lon;
  if (qLat !== null && qLon !== null) {
    place = null; lat = qLat; lon = qLon;
  }

  for (const p of PLACES) {
    const o = document.createElement("option");
    o.value = p.name; o.textContent = p.name;
    placeSel.appendChild(o);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "custom"; customOpt.textContent = "自定义…";
  placeSel.appendChild(customOpt);
  placeSel.value = place ? place.name : "custom";

  /* ---------- 时区 ---------- */
  // 缺省跟随系统时钟（页面一开就与手表一致）；选了地点才切到地点时区。
  // 固定偏移让任意历史历元都能复现，不受收件人时区数据库影响。
  let zoneMode = "system";
  let placeOpt = null;
  if (qZone !== null) {
    if (typeof qZone === "string") zoneMode = place && place.zone === qZone ? "place" : qZone;
    else zoneMode = String(qZone);
  }

  function buildZoneOptions() {
    zoneSel.replaceChildren();
    const values = [];
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      zoneSel.appendChild(o);
      values.push(value);
      return o;
    };
    add("system", "系统本地");
    placeOpt = add("place", "地点时区");
    for (let m = -720; m <= 840; m += 60) add(String(m), formatOffset(m));
    // ?zone= 传进来的 IANA 名补一项，否则链接复现不出原时区
    if (typeof qZone === "string" && zoneMode === qZone) add(qZone, qZone);
    if (!values.includes(zoneMode)) zoneMode = "system";
    zoneSel.value = zoneMode;
    syncPlaceLabel();
  }

  function syncPlaceLabel() {
    const off = place ? formatOffset(zoneOffsetMinutes(hud.getUtcMs(), place.zone)) : "UTC";
    setText(placeOpt, `地点时区 ${off}`);
  }

  function resolveZone() {
    if (zoneMode === "system") return null;
    if (zoneMode === "place") return place ? place.zone : 0;
    if (zoneMode === qZone && typeof qZone === "string") return qZone;
    return Number(zoneMode);
  }

  function applyZone() {
    hud.setZone(resolveZone());
    syncPlaceLabel();
    zoneSel.value = zoneMode;
    refresh();
  }

  buildZoneOptions();
  hud.setZone(resolveZone());

  /* ---------- 开合 ---------- */
  let panelOpen = false;
  function setPanelOpen(next) {
    // 与左下角光速面板共用左侧空间，矮屏上会叠在一起：同时只开一个
    if (next && onOpen) onOpen();
    panelOpen = next;
    panel.classList.toggle("on", next);
    toggleBtn.classList.toggle("on", next);
    toggleBtn.textContent = next ? "时间 ▾" : "时间 ▸";
    toggleBtn.setAttribute("aria-expanded", String(next));
    if (next) refresh();
  }
  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); setPanelOpen(!panelOpen); });

  let stateOpen = !matchMedia("(max-width: 560px)").matches;
  function setStateOpen(next) {
    stateOpen = next;
    stateEl.classList.toggle("open", next);
    stateToggle.setAttribute("aria-expanded", String(next));
    stateCaret.textContent = next ? "▾" : "▸";
  }
  stateToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setStateOpen(!stateOpen);
    if (stateOpen) refresh();
  });

  let planetsOpen = false;
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    planetsOpen = !planetsOpen;
    planetsEl.classList.toggle("on", planetsOpen);
    moreBtn.textContent = planetsOpen ? "行星位置 ▾" : "行星位置 ▸";
    moreBtn.setAttribute("aria-expanded", String(planetsOpen));
    if (planetsOpen) refresh();
  });

  /* ---------- 输入时间 ---------- */
  function jumpToMs(ms) {
    if (!Number.isFinite(ms)) return;
    hud.jumpTo(utcMsToTTDays(ms));
    refresh();
  }
  function applyInput() {
    const parts = parseLocalInput(inputEl.value);
    if (!parts) { refresh(); return; }   // 非法输入退回当前历元的显示
    jumpToMs(civilToUtcMs(parts, resolveZone()));
  }
  inputEl.addEventListener("change", applyInput);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyInput(); inputEl.blur(); }
  });

  jdEl.addEventListener("change", () => {
    const jd = parseFloat(jdEl.value);
    if (Number.isFinite(jd)) jumpToMs(ttDaysToUtcMs(jdToTTDays(jd)));
    else refresh();
  });

  zoneSel.addEventListener("change", () => { zoneMode = zoneSel.value; applyZone(); });

  /* ---------- 步进 ---------- */
  // 年/月/日按民用日历走：保持当地钟点不变，跨夏令时也不会错一小时；
  // 时/分/秒按绝对时长走，就是物理上的 3600/60/1 秒。
  function step(sign) {
    const ms = hud.getUtcMs();
    const zone = resolveZone();
    const unit = unitSel.value;
    if (STEP_MS[unit]) { jumpToMs(ms + sign * STEP_MS[unit]); return; }
    const c = civilParts(ms, zone);
    if (unit === "year") c.year += sign;
    else if (unit === "month") {
      c.month += sign;
      // 1 月 31 日 + 1 月应是 2 月 28/29 日，而不是溢出到 3 月
      c.day = Math.min(c.day, new Date(Date.UTC(c.year, c.month, 0)).getUTCDate());
    } else c.day += sign;
    jumpToMs(civilToUtcMs(c, zone));
  }
  $("tpMinus").addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
  $("tpPlus").addEventListener("click", (e) => { e.stopPropagation(); step(1); });

  /* ---------- 观测地输入 ---------- */
  placeSel.addEventListener("change", () => {
    const p = PLACES.find((x) => x.name === placeSel.value);
    place = p || null;
    if (p) { lat = p.lat; lon = p.lon; zoneMode = "place"; }
    customRow.classList.toggle("on", !p);
    latEl.value = lat.toFixed(4);
    lonEl.value = lon.toFixed(4);
    applyZone();
  });
  function applyCustom() {
    const a = parseFloat(latEl.value), b = parseFloat(lonEl.value);
    if (Number.isFinite(a) && Math.abs(a) <= 90) lat = a;
    if (Number.isFinite(b) && Math.abs(b) <= 180) lon = b;
    refresh();
  }
  latEl.addEventListener("change", applyCustom);
  lonEl.addEventListener("change", applyCustom);
  customRow.classList.toggle("on", !place);
  latEl.value = lat.toFixed(4);
  lonEl.value = lon.toFixed(4);

  /* ---------- 复制状态链接 ---------- */
  let copyTimer = 0;
  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ms = hud.getUtcMs();
    const zone = resolveZone();
    const url = new URL(location.href);
    url.searchParams.delete("t");
    url.searchParams.delete("jd");
    url.searchParams.set("date", toLocalInput(ms, zone));
    // 收件人的系统时区可能不同，链接里必须写死偏移才能复现同一瞬间
    url.searchParams.set("zone", String(zoneOffsetMinutes(ms, zone)));
    url.searchParams.set("lat", lat.toFixed(4));
    url.searchParams.set("lon", lon.toFixed(4));
    let ok = false;
    try { await navigator.clipboard.writeText(url.toString()); ok = true; } catch (_) {}
    setText(copyBtn, ok ? "已复制" : "复制失败");
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setText(copyBtn, "复制状态链接"), 1600);
  });

  /* ---------- 读数 ---------- */
  const hm = (days, zone) => {
    if (days === null) return "—";
    const c = civilParts(ttDaysToUtcMs(days), zone);
    return `${p2(c.hour)}:${p2(c.minute)}`;
  };

  let planetRows = [];
  function buildPlanetRows(names) {
    planetsEl.replaceChildren();
    planetRows = names.map((name) => {
      const row = document.createElement("div");
      const pn = document.createElement("span");
      pn.className = "pn"; pn.textContent = name;
      const lonSpan = document.createElement("span");
      lonSpan.className = "v";
      const distSpan = document.createElement("span");
      distSpan.className = "v";
      row.append(pn, lonSpan, distSpan);
      planetsEl.appendChild(row);
      return { lon: lonSpan, dist: distSpan };
    });
  }

  function refresh() {
    const days = hud.getSimTime();
    const ms = hud.getUtcMs();
    const zone = resolveZone();

    if (document.activeElement !== inputEl) {
      // 浏览器会把 :00 秒截掉，直接比字符串会导致每次刷新都重写控件
      const cur = parseLocalInput(inputEl.value);
      const curMs = cur ? civilToUtcMs(cur, zone) : NaN;
      if (!(Math.abs(curMs - ms) < 1000)) inputEl.value = toLocalInput(ms, zone);
    }
    if (document.activeElement !== jdEl) {
      const v = ttDaysToJD(days).toFixed(6);
      if (jdEl.value !== v) jdEl.value = v;
    }
    syncPlaceLabel();

    const note = accuracyNote(ms);
    setText(noteEl, note.level === "out"
      ? `超出 ${MODEL_MIN_YEAR}–${MODEL_MAX_YEAR} · 位置仅供参考`
      : `ΔT ${deltaTSeconds(ms).toFixed(3)} s · 适用 ${MODEL_MIN_YEAR}–${MODEL_MAX_YEAR}`);
    noteEl.classList.toggle("warn", note.level === "out");

    setText(stateTitle, place ? `地球 · ${place.name}` : `地球 · ${fmtLat(lat)} ${fmtLon(lon)}`);
    if (!stateOpen) return;

    const utcHours = (((ms % 86400000) + 86400000) % 86400000) / 3600000;
    const st = earthState(days, lat, lon, utcHours);
    const south = lat < 0;
    const season = south ? st.season.south : st.season.north;
    const term = south ? st.season.nextTermS : st.season.nextTermN;
    const gap = st.season.daysToNextTerm;
    const gapText = gap < 1 ? `${Math.round(gap * 24)} 小时` : `${Math.round(gap)} 天`;
    setText($("stSeason"), `${season} · ${term} ${gapText}`);
    setText($("stSubsolar"), `${fmtLat(st.subsolar.latDeg)} ${fmtLon(st.subsolar.lonDeg)}`);

    const az = st.sun.azimuthDeg;
    const dir = az === null ? "" : ` ${COMPASS[Math.round(az / 45) % 8]}`;
    setText($("stSun"), `${st.sun.isDay ? "昼" : "夜"} · 高度 ${st.sun.elevationDeg.toFixed(1)}°${dir}`);

    const ev = st.events;
    setText($("stRise"), ev.polar ? (ev.polar === "day" ? "极昼" : "极夜") : hm(ev.sunriseDays, zone));
    setText($("stSet"), ev.polar ? "—" : hm(ev.sunsetDays, zone));
    setText($("stLen"), fmtDur(ev.dayLengthHours));

    const sh = st.sun.apparentSolarHours;
    const eot = st.equationOfTimeMinutes;
    setText($("stSolar"), `${p2(Math.floor(sh))}:${p2(Math.floor((sh % 1) * 60))} (${eot < 0 ? "−" : "+"}${Math.abs(eot).toFixed(1)}m)`);
    setText($("stMoon"), `${st.moon.name} ${(st.moon.illuminated * 100).toFixed(0)}%`);

    if (planetsOpen) {
      const ov = planetOverview(days);
      if (planetRows.length === 0) buildPlanetRows(ov.map((p) => p.name));
      for (let i = 0; i < ov.length; i++) {
        setText(planetRows[i].lon, `${ov[i].helioLonDeg.toFixed(1)}°`);
        setText(planetRows[i].dist, `${ov[i].distanceAU.toFixed(3)} AU`);
      }
    }
  }

  // 每帧调用，内部限到 4Hz：日出日落要解几十次开普勒，不必逐帧重算
  let acc = 0;
  function tick(dt) {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    refresh();
  }

  setStateOpen(stateOpen);
  setPanelOpen(Q.get("time") === "1");
  refresh();

  return { tick, refresh, setPanelOpen, getObserver: () => ({ lat, lon }) };
}