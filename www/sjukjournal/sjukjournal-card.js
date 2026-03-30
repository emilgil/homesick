/**
 * SjukJournal Lovelace Card
 *
 * Registrerar sig som custom element: <sjukjournal-card>
 *
 * Konfiguration i Lovelace (YAML):
 *   type: custom:sjukjournal-card
 *
 * Kommunikation med HA:
 *   - Läser personer och journaldata via REST API  (/api/sjukjournal/*)
 *   - Anropar tjänster via hass.callService()
 *   - Hämtar historik via HA History API
 *
 * Struktur:
 *   SjukJournalCard        — root custom element, hanterar routing
 *   ├─ renderHome()        — startsida med personkort
 *   ├─ renderJournal()     — journalsida per person
 *   │   ├─ tabOverview()   — översikt + temperaturkurva
 *   │   ├─ tabTemp()       — temperatur + inmatning
 *   │   ├─ tabBody()       — vikt, längd, BMI, midjemått, blodsocker
 *   │   ├─ tabVital()      — BT, puls, SpO2
 *   │   ├─ tabMed()        — medicinlogg + inmatning
 *   │   └─ tabWellbeing()  — smärta, humör, symtomtaggar
 *   └─ renderAdmin()       — lägg till / redigera personer
 *
 * ApexCharts laddas dynamiskt från cdnjs om det inte redan finns.
 */

// ── ApexCharts loader ────────────────────────────────────────────────────────

const APEX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/apexcharts/3.45.2/apexcharts.min.js";

async function ensureApex() {
  if (window.ApexCharts) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = APEX_CDN;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Constants ────────────────────────────────────────────────────────────────

const DOMAIN = "sjukjournal";

const MTYPE_LABELS = {
  temperature:    { label: "Temperatur",   unit: "°C",     icon: "🌡" },
  blood_pressure: { label: "Blodtryck",    unit: "mmHg",   icon: "💉" },
  pulse:          { label: "Puls",         unit: "slag/min",icon: "💓" },
  weight:         { label: "Vikt",         unit: "kg",      icon: "⚖️" },
  spo2:           { label: "SpO2",         unit: "%",       icon: "🫁" },
  pain:           { label: "Smärta",       unit: "/10",     icon: "😣" },
  mood:           { label: "Humör",        unit: "/5",      icon: "😊" },
  blood_glucose:  { label: "Blodsocker",   unit: "mmol/L",  icon: "🩸" },
  height:         { label: "Längd",        unit: "cm",      icon: "📏" },
  bmi:            { label: "BMI",          unit: "kg/m²",   icon: "🧍" },
  waist:          { label: "Midjemått",    unit: "cm",      icon: "📐" },
};

const GENDER_LABELS = { male: "Man", female: "Kvinna", other: "Annat" };

const SYMPTOM_TAGS = [
  "Hosta", "Ont i halsen", "Snuva", "Illamående", "Huvudvärk",
  "Yrsel", "Frossa", "Ont i magen", "Trötthet", "Andningssvårigheter",
];

const ROUTES = [
  { value: "oral",       label: "Oralt" },
  { value: "inhalation", label: "Inhalation" },
  { value: "injection",  label: "Injektion" },
  { value: "topical",    label: "Topikal" },
  { value: "other",      label: "Övrigt" },
];

// ── Theme ────────────────────────────────────────────────────────────────────

const CSS = `
  :host {
    display: block;
    font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
    height: 650px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Variables ── */
  .sj-root {
    --bg:       #0C1117;
    --s1:       #141B24;
    --s2:       #1C2733;
    --s3:       #243040;
    --border:   #2A3A4A;
    --teal:     #17B8A6;
    --teal-dim: #0D7A6E;
    --teal-glo: rgba(23,184,166,0.15);
    --red:      #F56565;
    --yellow:   #ECC94B;
    --green:    #48BB78;
    --blue:     #63B3ED;
    --text:     #E8F0F8;
    --muted:    #6B8599;
    background: var(--bg);
    color: var(--text);
    border-radius: 12px;
    overflow: hidden;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* ── Layout ── */
  .sj-topbar {
    background: var(--s1);
    border-bottom: 1px solid var(--border);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .sj-title {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .sj-subtitle { font-size: 11px; color: var(--muted); margin-top: 1px; }

  .sj-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sj-scroll::-webkit-scrollbar { width: 4px; }
  .sj-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  /* ── Buttons ── */
  .btn {
    border: none; cursor: pointer; font-family: inherit;
    transition: all 0.15s; border-radius: 10px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  }
  .btn-primary { background: var(--teal); color: #fff; padding: 11px 18px; font-size: 14px; width: 100%; }
  .btn-primary:hover { background: var(--teal-dim); }
  .btn-primary:active { transform: scale(0.98); }
  .btn-ghost {
    background: var(--teal-glo); border: 1px solid rgba(23,184,166,0.3);
    color: var(--teal); padding: 7px 13px; font-size: 13px;
  }
  .btn-ghost:hover { background: rgba(23,184,166,0.25); }
  .btn-back {
    background: none; border: none; color: var(--muted);
    font-size: 22px; cursor: pointer; padding: 2px 8px; border-radius: 8px; line-height: 1;
  }
  .btn-back:hover { color: var(--text); }
  .btn-icon { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 16px; padding: 4px; }
  .btn-danger { color: #E5534B; }

  /* ── Person card ── */
  .person-card {
    background: var(--s1); border: 1px solid var(--border);
    border-radius: 14px; padding: 16px; cursor: pointer;
    position: relative; overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s;
    animation: fadeUp 0.3s ease both;
  }
  .person-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(23,184,166,0.2);
  }
  .person-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0;
    height: 3px; background: var(--status-color, var(--teal));
  }
  .person-card-inner { display: flex; align-items: center; gap: 13px; }

  .avatar {
    width: 50px; height: 50px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 800; color: white; flex-shrink: 0;
    position: relative;
  }
  .avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

  .person-meta { flex: 1; min-width: 0; }
  .person-name { font-weight: 700; font-size: 16px; }
  .person-sub  { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .person-temp { text-align: right; }
  .temp-big { font-size: 26px; font-weight: 800; line-height: 1; }
  .temp-time { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .status-pill {
    display: inline-block; font-size: 10px; font-weight: 700;
    padding: 2px 8px; border-radius: 10px; margin-top: 4px;
  }

  /* ── Cards / panels ── */
  .card {
    background: var(--s2); border: 1px solid var(--border);
    border-radius: 14px; padding: 16px;
  }
  .card-title {
    font-weight: 700; font-size: 13px; margin-bottom: 14px;
    display: flex; align-items: center; gap: 6px;
  }
  .lbl-tog { display: flex; align-items: center; gap: 5px; margin-left: auto; cursor: pointer; user-select: none; }
  .lbl-tog-label { font-size: 10px; color: var(--muted); font-weight: 500; }
  .lbl-tog-track { width: 28px; height: 16px; border-radius: 8px; background: var(--border); transition: background 0.2s; position: relative; flex-shrink: 0; }
  .lbl-tog-track.on { background: var(--teal); }
  .lbl-tog-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: white; transition: transform 0.2s; }
  .lbl-tog-track.on .lbl-tog-knob { transform: translateX(12px); }
  .section-label {
    font-size: 11px; font-weight: 700; color: var(--muted);
    text-transform: uppercase; letter-spacing: 1.2px;
  }

  /* ── Stat grid ── */
  .stat-grid { display: grid; gap: 10px; }
  .stat-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .stat-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .stat-card {
    background: var(--s2); border: 1px solid var(--border);
    border-radius: 12px; padding: 13px 10px; text-align: center;
  }
  .stat-label { font-size: 10px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 22px; font-weight: 800; line-height: 1; }
  .stat-unit  { font-size: 10px; color: var(--muted); margin-top: 3px; }

  /* ── Tab bar ── */
  .tab-bar {
    display: flex; background: var(--s1);
    border-bottom: 1px solid var(--border);
    overflow-x: auto; flex-shrink: 0;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab-btn {
    padding: 10px 8px; border: none; background: none; cursor: pointer;
    font-family: inherit; font-size: 11px; color: var(--muted);
    white-space: nowrap; border-bottom: 2px solid transparent; transition: all 0.15s;
  }
  .tab-btn.active { color: var(--teal); font-weight: 700; border-bottom-color: var(--teal); }

  /* ── Journal header ── */
  .journal-header {
    background: var(--s1); border-bottom: 1px solid var(--border);
    padding: 13px 16px; display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  }

  /* ── Forms ── */
  .form-group { margin-bottom: 12px; }
  .form-label {
    display: block; font-size: 11px; color: var(--muted);
    margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .field {
    width: 100%; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--border); background: var(--s1);
    color: var(--text); font-size: 14px; font-family: inherit; outline: none;
    transition: border-color 0.2s;
  }
  .field:focus { border-color: var(--teal); }
  .field::placeholder { color: var(--muted); }
  select.field {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B8599' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center; padding-right: 30px;
  }
  .form-row { display: grid; gap: 10px; }
  .form-row-2 { grid-template-columns: 1fr 1fr; }
  .form-row-3 { grid-template-columns: 1fr 1fr 1fr; }

  /* ── Chip / tag toggles ── */
  .chip-row { display: flex; gap: 7px; flex-wrap: wrap; }
  .chip {
    padding: 5px 12px; border-radius: 18px; border: 1px solid var(--border);
    background: var(--s1); color: var(--muted); font-size: 12px;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .chip.active { background: var(--teal); border-color: var(--teal); color: #fff; font-weight: 600; }
  .chip:hover:not(.active) { border-color: var(--teal); color: var(--teal); }

  .tag { padding: 5px 12px; border-radius: 14px; border: 1px solid var(--border);
    background: var(--s1); color: var(--muted); font-size: 12px;
    cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .tag.active { border-color: var(--teal); background: var(--teal-glo); color: var(--teal); }

  /* ── Pain scale ── */
  .pain-scale { display: flex; gap: 5px; flex-wrap: wrap; }
  .pain-btn {
    width: 34px; height: 34px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--s1); color: var(--muted);
    font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .pain-btn.active { background: var(--yellow); border-color: var(--yellow); color: #1a1a1a; }

  /* ── Mood buttons ── */
  .mood-row { display: flex; gap: 8px; }
  .mood-btn {
    flex: 1; padding: 9px 4px; border-radius: 10px;
    border: 1px solid var(--border); background: var(--s1);
    cursor: pointer; display: flex; flex-direction: column;
    align-items: center; gap: 3px; font-family: inherit; transition: all 0.15s;
  }
  .mood-btn.active { border-color: var(--teal); background: var(--teal-glo); }
  .mood-emoji { font-size: 20px; }
  .mood-label { font-size: 9px; color: var(--muted); }
  .mood-btn.active .mood-label { color: var(--teal); }

  /* ── Med / entry list ── */
  .entry-item {
    display: flex; align-items: center; gap: 11px; padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .entry-item:last-child { border-bottom: none; padding-bottom: 0; }
  .entry-icon {
    width: 34px; height: 34px; border-radius: 50%; background: var(--teal-glo);
    display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0;
  }
  .entry-name { font-weight: 600; font-size: 13px; }
  .entry-sub  { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .entry-time { font-size: 12px; color: var(--muted); font-weight: 600; margin-left: auto; flex-shrink: 0; }

  /* ── Add person / dashed btn ── */
  .dashed-btn {
    width: 100%; padding: 14px; border-radius: 14px;
    border: 2px dashed var(--border); background: transparent;
    color: var(--muted); font-size: 14px; cursor: pointer;
    font-family: inherit; font-weight: 600; transition: all 0.2s;
  }
  .dashed-btn:hover { border-color: var(--teal); color: var(--teal); }

  /* ── Toast ── */
  .toast {
    position: absolute; bottom: 70px; left: 50%;
    transform: translateX(-50%) translateY(12px);
    background: var(--green); color: white;
    padding: 9px 20px; border-radius: 30px;
    font-weight: 700; font-size: 13px;
    opacity: 0; transition: all 0.3s; pointer-events: none;
    white-space: nowrap; z-index: 50;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  /* ── Loading spinner ── */
  .spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid var(--border); border-top-color: var(--teal);
    animation: spin 0.8s linear infinite; margin: 40px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Admin form ── */
  .admin-section { display: flex; flex-direction: column; gap: 14px; }
  .person-row {
    background: var(--s2); border: 1px solid var(--border);
    border-radius: 12px; padding: 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .person-row-info { flex: 1; }
  .person-row-name { font-weight: 700; font-size: 14px; }
  .person-row-sub  { font-size: 11px; color: var(--muted); margin-top: 2px; }

  /* ── Quick fab ── */
  .quick-fab {
    position: sticky; bottom: 0;
    background: var(--teal); color: #fff; border: none;
    border-radius: 12px; padding: 14px; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit; width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: background 0.2s;
  }
  .quick-fab:hover { background: var(--teal-dim); }

  /* ── Apex overrides ── */
  .apexcharts-tooltip {
    background: var(--s3) !important; border: 1px solid var(--border) !important;
    border-radius: 10px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
  }
  .apexcharts-tooltip-title {
    background: transparent !important; border-bottom: 1px solid var(--border) !important;
    color: var(--muted) !important; font-size: 11px !important;
  }

  /* ── Responsive ── */
  @media (max-width: 400px) {
    .form-row-3 { grid-template-columns: 1fr 1fr; }
    .stat-grid-3 { grid-template-columns: repeat(2, 1fr); }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "className") {
      e.className = v;
    } else if (k === "style" && typeof v === "object") {
      Object.assign(e.style, v);
    } else {
      e.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    e.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return e;
}

function fmtTs(ts, hass) {
  if (!ts) return "—";
  const d = new Date(ts);
  const tf = hass?.locale?.time_format;
  const lang = hass?.locale?.language || "sv";
  if (tf === "12") return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  if (tf === "24") return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts, hass) {
  if (!ts) return "—";
  const lang = hass?.locale?.language || "sv";
  return new Date(ts).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  if (
    today.getMonth() < born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())
  ) age--;
  return age;
}

function statusColor(temp) {
  if (!temp) return "var(--muted)";
  if (temp >= 38.0) return "var(--red)";
  if (temp >= 37.3) return "var(--yellow)";
  return "var(--green)";
}

function statusLabel(temp) {
  if (!temp) return "—";
  if (temp >= 38.0) return "Feber";
  if (temp >= 37.3) return "Subfebril";
  return "Normal";
}

function calcBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const hm = heightCm / 100;
  return +(weightKg / (hm * hm)).toFixed(1);
}

// ── Apex chart defaults ───────────────────────────────────────────────────────

function apexDefaults(height = 180) {
  return {
    chart: {
      background: "transparent", toolbar: { show: false },
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      height, animations: { enabled: true, easing: "easeinout", speed: 500 },
    },
    theme: { mode: "dark" },
    grid: { borderColor: "#2A3A4A", strokeDashArray: 4, xaxis: { lines: { show: false } } },
    tooltip: { theme: "dark", style: { fontSize: "12px" } },
    xaxis: { axisBorder: { show: false }, axisTicks: { show: false },
      labels: { style: { colors: "#6B8599", fontSize: "10px" } } },
    yaxis: { labels: { style: { colors: "#6B8599", fontSize: "10px" } } },
  };
}

// Convert a local-time timestamp to an epoch that ApexCharts (UTC mode) will
// display as the correct local time. ApexCharts always renders datetime x-axes
// in UTC, so we shift the epoch by the local timezone offset.
function toChartMs(ts) {
  const d = new Date(ts);
  return d.getTime() - d.getTimezoneOffset() * 60000;
}

// ── Main custom element ───────────────────────────────────────────────────────

class SjukJournalCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
    this._state = {
      view: "home",        // "home" | "journal" | "admin"
      personId: null,
      tab: "overview",
      tempRange: "24h",
      chartRange: "90d",
      showLabels: false,
      deleteConfirmPersonId: null,
      persons: [],
      loading: true,
      // per-tab form state
      pain: null,
      mood: null,
      tags: new Set(),
      charts: {},          // apex instances keyed by id
    };
    this._toast = null;
  }

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  setConfig(config) {
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    // Initial load
    if (this._state.loading) {
      this._loadPersons();
    }
  }

  static getConfigElement() {
    return document.createElement("sjukjournal-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  async _loadPersons() {
    try {
      const data = await this._hass.callWS({
        type: "sjukjournal/get_persons",
      });
      this._state.persons = data || [];
    } catch (e) {
      // Fallback: read from sensor state_attributes if WebSocket API not available
      this._state.persons = this._personsFromStates();
    }
    this._state.loading = false;
    this._render();
  }

  _personsFromStates() {
    // Build minimal person list from HA entity state attributes
    const persons = {};
    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith(`sensor.${DOMAIN}_`)) continue;
      const pid = state.attributes?.person_id;
      if (!pid) continue;
      if (!persons[pid]) {
        persons[pid] = {
          id: pid,
          name: state.attributes?.friendly_name?.split(" ")[0] || pid,
          birth_date: null,
          gender: null,
          active: true,
          photo: null,
          measurements: [],
          medications: [],
          wellbeing: [],
        };
      }
    }
    return Object.values(persons);
  }

  async _loadPersonData(personId) {
    // Load full measurement history for one person
    try {
      const data = await this._hass.callWS({
        type: "sjukjournal/get_person_data",
        person_id: personId,
      });
      // Merge into persons array
      const idx = this._state.persons.findIndex(p => p.id === personId);
      if (idx >= 0 && data) this._state.persons[idx] = { ...this._state.persons[idx], ...data };
    } catch (_) {
      // Data stays empty; sensor states still show last values
    }
    this._render();
  }

  _getPerson(personId) {
    return this._state.persons.find(p => p.id === personId) || null;
  }

  /** Get latest sensor value for a person + measurement type */
  _latestSensor(person, mtype) {
    if (!person) return null;
    const entityId = person.entity_ids?.[mtype]
      ?? `sensor.${DOMAIN}_${person.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${mtype}`;
    const state = this._hass?.states[entityId];
    if (!state || state.state === "unavailable" || state.state === "unknown") return null;
    return {
      value: parseFloat(state.state),
      timestamp: state.attributes?.timestamp || state.last_changed,
      ...state.attributes,
    };
  }

  /** Build chart series from storage measurements instead of HA history */
  _measurementSeries(person, mtype, hours = 24 * 365, useValue2 = false) {
    const cutoff = Date.now() - hours * 3600 * 1000;
    return (person.measurements || [])
      .filter(m => m.type === mtype && new Date(m.timestamp).getTime() >= cutoff)
      .map(m => ({ x: toChartMs(m.timestamp), y: useValue2 ? m.value2 : m.value }))
      .filter(p => p.y != null)
      .sort((a, b) => a.x - b.x);
  }

  async _fetchHistory(entityId, hours = 24) {
    const end = new Date();
    const start = new Date(end - hours * 3600 * 1000);
    const url = `/api/history/period/${start.toISOString()}?filter_entity_id=${entityId}&end_time=${end.toISOString()}&minimal_response`;
    try {
      const resp = await this._hass.fetchWithAuth(url);
      const json = await resp.json();
      return (json[0] || [])
        .filter(s => s.state !== "unavailable" && s.state !== "unknown")
        .map(s => ({ x: new Date(s.last_changed).getTime(), y: parseFloat(s.state) }));
    } catch (_) {
      return [];
    }
  }

  // ── Service calls ─────────────────────────────────────────────────────────

  async _callService(service, data) {
    await this._hass.callService(DOMAIN, service, data);
    // Reload after short delay so coordinator has time to refresh
    setTimeout(() => {
      if (this._state.view === "journal" && this._state.personId) {
        this._loadPersonData(this._state.personId);
      } else {
        this._loadPersons();
      }
    }, 800);
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  _goHome() {
    this._destroyCharts();
    this._state.view = "home";
    this._state.personId = null;
    this._state.tab = "overview";
    this._render();
  }

  _openJournal(personId) {
    this._state.view = "journal";
    this._state.personId = personId;
    this._state.tab = "overview";
    this._state.tempRange = "24h";
    this._render();
    this._loadPersonData(personId);
  }

  _openAdmin() {
    this._state.view = "admin";
    this._render();
  }

  _setTab(tab) {
    this._destroyCharts();
    this._state.tab = tab;
    this._render();
  }

  // ── Chart management ──────────────────────────────────────────────────────

  _destroyCharts() {
    for (const chart of Object.values(this._state.charts)) {
      try { chart.destroy(); } catch (_) {}
    }
    this._state.charts = {};
  }

  async _renderChart(containerId, options) {
    await ensureApex();
    const container = this.shadowRoot.getElementById(containerId);
    if (!container) return;
    if (this._state.charts[containerId]) {
      try { this._state.charts[containerId].destroy(); } catch (_) {}
    }
    const chart = new window.ApexCharts(container, options);
    chart.render();
    this._state.charts[containerId] = chart;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  _showToast(msg, isError = false) {
    const t = this.shadowRoot.querySelector(".toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = isError ? "var(--red)" : "var(--green)";
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // ── Render root ───────────────────────────────────────────────────────────

  _render() {
    const shadow = this.shadowRoot;
    shadow.innerHTML = "";

    // Inject fonts + styles
    const style = document.createElement("style");
    style.textContent = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap');${CSS}`;
    shadow.appendChild(style);

    const root = el("div", { className: "sj-root" });
    shadow.appendChild(root);

    if (this._state.loading) {
      root.appendChild(this._renderLoading());
    } else if (this._state.view === "journal" && this._state.personId) {
      root.appendChild(this._renderJournal());
    } else if (this._state.view === "admin") {
      root.appendChild(this._renderAdmin());
    } else {
      root.appendChild(this._renderHome());
    }

    const toast = el("div", { className: "toast" });
    root.appendChild(toast);

    // Schedule chart renders after DOM is painted
    requestAnimationFrame(() => this._postRender());
  }

  _renderLoading() {
    return el("div", { style: { padding: "40px", textAlign: "center" } },
      el("div", { className: "spinner" }),
      el("p", { style: { color: "var(--muted)", fontSize: "13px", marginTop: "12px" } }, "Laddar SjukJournal…")
    );
  }

  // ── HOME VIEW ─────────────────────────────────────────────────────────────

  _renderHome() {
    const today = new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

    const topbar = el("div", { className: "sj-topbar" },
      el("div", {},
        el("div", { className: "sj-title" }, "🩺 SjukJournal"),
        el("div", { className: "sj-subtitle" }, today),
      ),
      el("button", { className: "btn btn-ghost", onClick: () => this._openAdmin() }, "⚙ Hantera"),
    );

    const scroll = el("div", { className: "sj-scroll" });

    // Active persons
    const active = this._state.persons.filter(p => p.active !== false);

    if (active.length === 0) {
      scroll.appendChild(el("div", { style: { textAlign: "center", color: "var(--muted)", padding: "40px 0" } },
        el("div", { style: { fontSize: "40px", marginBottom: "12px" } }, "🩺"),
        el("div", {}, "Inga personer ännu."),
        el("div", { style: { fontSize: "12px", marginTop: "6px" } }, "Klicka på ⚙ Hantera för att lägga till en person."),
      ));
    } else {
      scroll.appendChild(el("div", { className: "section-label", style: { marginBottom: "4px" } }, "Familjemedlemmar"));
      for (const [i, person] of active.entries()) {
        scroll.appendChild(this._renderPersonCard(person, i));
      }
    }

    scroll.appendChild(el("button", { className: "dashed-btn", onClick: () => this._openAdmin() }, "+ Lägg till person"));
    scroll.appendChild(this._renderQuickInput());

    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%" } }, topbar, scroll);
  }

  _renderPersonCard(person, idx) {
    const tempData = this._latestSensor(person, "temperature");
    const temp = tempData?.value;
    const sc = statusColor(temp);
    const age = calcAge(person.birth_date);
    const subParts = [age ? `${age} år` : null, person.gender ? GENDER_LABELS[person.gender] : null].filter(Boolean);

    const card = el("div", {
      className: "person-card",
      style: { "--status-color": sc, animationDelay: `${idx * 0.07}s` },
      onClick: () => this._openJournal(person.id),
    },
      el("div", { className: "person-card-inner" },
        this._renderAvatar(person, 50),
        el("div", { className: "person-meta" },
          el("div", { className: "person-name" }, person.name),
          el("div", { className: "person-sub" }, subParts.join(" · ") || "—"),
        ),
        el("div", { className: "person-temp" },
          el("div", { className: "temp-big", style: { color: sc } }, temp ? `${temp}°` : "—"),
          el("div", { className: "temp-time" }, tempData ? `kl ${fmtTs(tempData.timestamp, this._hass)}` : ""),
          el("div", { className: "status-pill", style: { background: `${sc}20`, color: sc } }, statusLabel(temp)),
        ),
      )
    );
    return card;
  }

  _renderAvatar(person, size = 50) {
    if (person.photo) {
      return el("div", { className: "avatar", style: { width: `${size}px`, height: `${size}px` } },
        el("img", { className: "avatar-img", src: `/local/${person.photo}`, alt: person.name })
      );
    }
    const initials = person.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const colors = ["#2B6CB0", "#276749", "#744210", "#6B46C1", "#C05621", "#285E61"];
    const bg = colors[(person.name.charCodeAt(0) || 0) % colors.length];
    return el("div", { className: "avatar", style: { width: `${size}px`, height: `${size}px`, background: bg, fontSize: `${size * 0.38}px` } }, initials);
  }

  _renderQuickInput() {
    // Compact quick-register panel at the bottom of home
    let activeType = "temperature";
    let activePerson = this._state.persons.find(p => p.active !== false)?.id || null;

    const wrapper = el("div", { className: "card" });
    const rebuild = () => {
      wrapper.innerHTML = "";
      wrapper.appendChild(el("div", { className: "card-title" }, "⚡ Snabbregistrering"));

      // Type chips
      const typeChips = el("div", { className: "chip-row", style: { marginBottom: "10px" } });
      const skipInQuick = new Set(["height", "bmi"]);
      for (const [mtype, info] of Object.entries(MTYPE_LABELS)) {
        if (skipInQuick.has(mtype)) continue;
        const chip = el("button", { className: `chip${mtype === activeType ? " active" : ""}`,
          onClick: () => { activeType = mtype; rebuild(); }
        }, `${info.icon} ${info.label}`);
        typeChips.appendChild(chip);
      }
      wrapper.appendChild(typeChips);

      // Person chips
      const personChips = el("div", { className: "chip-row", style: { marginBottom: "10px" } });
      for (const p of this._state.persons.filter(x => x.active !== false)) {
        const chip = el("button", { className: `chip${p.id === activePerson ? " active" : ""}`,
          onClick: () => { activePerson = p.id; rebuild(); }
        }, p.name);
        personChips.appendChild(chip);
      }
      wrapper.appendChild(personChips);

      // Value input
      const info = MTYPE_LABELS[activeType];
      const input = el("input", { className: "field", placeholder: `Värde (${info.unit})`, type: "number", step: "0.1" });
      const row = el("div", { style: { display: "flex", gap: "8px" } }, input,
        el("button", { className: "btn btn-primary", style: { width: "auto", padding: "10px 18px" },
          onClick: async () => {
            const val = parseFloat(input.value);
            if (!val || !activePerson) return;
            await this._callService("log_measurement", {
              person_id: activePerson, type: activeType,
              value: val, unit: info.unit,
            });
            input.value = "";
            this._showToast(`${info.label} sparad ✓`);
          }
        }, "Spara")
      );
      wrapper.appendChild(row);
    };

    rebuild();
    return wrapper;
  }

  // ── JOURNAL VIEW ──────────────────────────────────────────────────────────

  _renderJournal() {
    const person = this._getPerson(this._state.personId);
    if (!person) return this._renderHome();

    const tempData = this._latestSensor(person, "temperature");
    const temp = tempData?.value;
    const sc = statusColor(temp);
    const age = calcAge(person.birth_date);

    const header = el("div", { className: "journal-header" },
      el("button", { className: "btn-back", onClick: () => this._goHome() }, "←"),
      this._renderAvatar(person, 42),
      el("div", {},
        el("div", { style: { fontWeight: 800, fontSize: "17px" } }, person.name),
        el("div", { style: { fontSize: "11px", color: "var(--muted)" } },
          [age ? `${age} år` : null, person.gender ? GENDER_LABELS[person.gender] : null].filter(Boolean).join(" · ") || "—"
        ),
      ),
      el("div", { style: { marginLeft: "auto", textAlign: "right" } },
        el("div", { style: { fontSize: "26px", fontWeight: 800, color: sc, lineHeight: 1 } },
          temp ? `${temp}°C` : "—"
        ),
        el("div", { className: "status-pill", style: { background: `${sc}20`, color: sc, marginTop: "4px" } },
          statusLabel(temp)
        ),
      ),
    );

    const tabs = [
      { id: "overview",   label: "📊 Översikt" },
      { id: "temp",       label: "🌡 Temp" },
      { id: "body",       label: "⚖️ Kropp" },
      { id: "vital",      label: "💉 Vitala" },
      { id: "medication", label: "💊 Medicin" },
      { id: "wellbeing",  label: "🌿 Mående" },
    ];

    const tabBar = el("div", { className: "tab-bar" },
      ...tabs.map(t => el("button", {
        className: `tab-btn${this._state.tab === t.id ? " active" : ""}`,
        onClick: () => this._setTab(t.id),
      }, t.label))
    );

    const scroll = el("div", { className: "sj-scroll" });
    const tabContent = this[`_tab_${this._state.tab}`]?.(person) || el("div", {}, "");
    scroll.appendChild(tabContent);

    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
      header, tabBar, scroll
    );
  }

  // ── TAB: Overview ─────────────────────────────────────────────────────────

  _tab_overview(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    // Quick stats
    const stats = [
      { mtype: "temperature", label: "Temp", fmt: v => `${v}°`, color: statusColor(this._latestSensor(person, "temperature")?.value) },
      { mtype: "pulse",       label: "Puls", fmt: v => `${v}`, color: "var(--teal)" },
      { mtype: "spo2",        label: "SpO2", fmt: v => `${v}%`, color: "var(--green)" },
    ];

    const statGrid = el("div", { className: "stat-grid stat-grid-3" });
    for (const s of stats) {
      const d = this._latestSensor(person, s.mtype);
      statGrid.appendChild(el("div", { className: "stat-card" },
        el("div", { className: "stat-label" }, s.label),
        el("div", { className: "stat-value", style: { color: d ? s.color : "var(--muted)" } }, d ? s.fmt(d.value) : "—"),
        el("div", { className: "stat-unit" }, d ? `kl ${fmtTs(d.timestamp, this._hass)}` : "ingen data"),
      ));
    }
    frag.appendChild(statGrid);

    // Temperature chart
    const chartCard = el("div", { className: "card" },
      el("div", { className: "card-title" }, "🌡 Temperaturkurva — 24 h", this._labelToggle()),
      el("div", { id: "chart-overview", style: { minHeight: "180px" } }),
    );
    frag.appendChild(chartCard);

    // Recent medications
    const meds = (person.medications || [])
      .slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 4);

    const medCard = el("div", { className: "card" },
      el("div", { className: "card-title" }, "💊 Senaste medicin"),
      meds.length === 0
        ? el("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "Ingen medicinering loggad ännu.")
        : el("div", {}, ...meds.map(m => el("div", { className: "entry-item" },
            el("div", { className: "entry-icon" }, "💊"),
            el("div", {},
              el("div", { className: "entry-name" }, m.name),
              el("div", { className: "entry-sub" }, `${m.dose || ""} ${m.unit || ""}`.trim()),
            ),
            el("div", { className: "entry-time" }, fmtTs(m.timestamp, this._hass)),
          )))
    );
    frag.appendChild(medCard);

    return frag;
  }

  // ── TAB: Temperature ──────────────────────────────────────────────────────

  _tab_temp(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    const chartCard = el("div", { className: "card" },
      el("div", { className: "card-title" }, "🌡 Temperaturkurva med medicinering", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["24h", "7d", "30d"].map(r =>
          el("button", { className: `chip${this._state.tempRange === r ? " active" : ""}`,
            onClick: () => { this._state.tempRange = r; this._render(); }
          }, r === "24h" ? "24 timmar" : r === "7d" ? "7 dagar" : "30 dagar")
        )
      ),
      el("div", { id: "chart-temp", style: { minHeight: "200px" } }),
    );
    frag.appendChild(chartCard);

    // Input form
    frag.appendChild(this._measurementForm(person, "temperature", "Temperatur (°C)", "37.8", "0.1"));

    return frag;
  }

  // ── TAB: Body metrics ─────────────────────────────────────────────────────

  _tab_body(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    // Stats
    const bodyMetrics = [
      { mtype: "weight",        label: "Vikt",       color: "var(--teal)",   fmt: v => `${v} kg` },
      { mtype: "height",        label: "Längd",      color: "var(--blue)",   fmt: v => `${v} cm` },
      { mtype: "bmi",           label: "BMI",        color: "var(--yellow)", fmt: v => `${v}` },
      { mtype: "waist",         label: "Midjemått",  color: "var(--teal)",   fmt: v => `${v} cm` },
      { mtype: "blood_glucose", label: "Blodsocker", color: "var(--red)",    fmt: v => `${v} mmol/L` },
    ];

    const grid = el("div", { className: "stat-grid", style: { gridTemplateColumns: "repeat(2, 1fr)" } });
    for (const m of bodyMetrics) {
      const d = this._latestSensor(person, m.mtype);
      grid.appendChild(el("div", { className: "stat-card" },
        el("div", { className: "stat-label" }, m.label),
        el("div", { className: "stat-value", style: { color: d ? m.color : "var(--muted)", fontSize: "18px" } },
          d ? m.fmt(d.value) : "—"
        ),
        el("div", { className: "stat-unit" }, d ? fmtDate(d.timestamp, this._hass) : "ingen data"),
      ));
    }
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "⚖️ Kroppsmått"),
      grid,
    ));

    // BMI chart
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "📈 Vikt — trend", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["30d", "90d", "365d"].map(r =>
          el("button", { className: `chip${this._state.chartRange === r ? " active" : ""}`,
            onClick: () => { this._state.chartRange = r; this._render(); }
          }, r === "30d" ? "30 dagar" : r === "90d" ? "90 dagar" : "1 år")
        )
      ),
      el("div", { id: "chart-weight", style: { minHeight: "160px" } }),
    ));

    // Input forms
    const lastW  = this._latestSensor(person, "weight")?.value ?? "";
    const lastH  = this._latestSensor(person, "height")?.value ?? "";
    const lastWa = this._latestSensor(person, "waist")?.value ?? "";
    const lastBg = this._latestSensor(person, "blood_glucose")?.value ?? "";
    const wIn   = el("input", { className: "field", placeholder: "70.5", type: "number", step: "0.1", value: lastW });
    const hIn   = el("input", { className: "field", placeholder: "175",  type: "number", step: "0.5", value: lastH });
    const waIn  = el("input", { className: "field", placeholder: "80",   type: "number", step: "0.5", value: lastWa });
    const bgIn  = el("input", { className: "field", placeholder: "5.5",  type: "number", step: "0.1", value: lastBg });
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Registrera kroppsmått"),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, "Vikt (kg)"), wIn),
        el("div", {}, el("label", { className: "form-label" }, "Längd (cm)"), hIn),
      ),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, "Midjemått (cm)"), waIn),
        el("div", {}, el("label", { className: "form-label" }, "Blodsocker (mmol/L)"), bgIn),
      ),
      this._autoBMINote(person),
      el("button", { className: "btn btn-primary", style: { marginTop: "10px" },
        onClick: async () => {
          const weight      = parseFloat(wIn.value);
          const height      = parseFloat(hIn.value);
          const waist       = parseFloat(waIn.value);
          const bloodGlucose = parseFloat(bgIn.value);
          let saved = false;
          if (weight)      { await this._callService("log_measurement", { person_id: person.id, type: "weight",       value: weight,       unit: "kg" });      saved = true; }
          if (height)      { await this._callService("log_measurement", { person_id: person.id, type: "height",       value: height,       unit: "cm" });      saved = true; }
          if (waist)       { await this._callService("log_measurement", { person_id: person.id, type: "waist",        value: waist,        unit: "cm" });      saved = true; }
          if (bloodGlucose){ await this._callService("log_measurement", { person_id: person.id, type: "blood_glucose",value: bloodGlucose, unit: "mmol/L" }); saved = true; }
          if (weight || height) await this._tryAutoCalcBMI(person, weight ? "weight" : "height", weight || height);
          if (saved) {
            wIn.value = ""; hIn.value = ""; waIn.value = ""; bgIn.value = "";
            this._showToast("Kroppsmått sparade ✓");
          }
        }
      }, "Spara mätningar"),
    ));

    return frag;
  }

  _inlineInput(label, mtype, unit, placeholder, step, person) {
    const input = el("input", { className: "field", placeholder, type: "number", step });
    const wrap = el("div", {},
      el("label", { className: "form-label" }, label),
      input,
      el("button", { className: "btn btn-primary", style: { marginTop: "6px", fontSize: "12px", padding: "8px" },
        onClick: async () => {
          const val = parseFloat(input.value);
          if (!val) return;
          await this._callService("log_measurement", {
            person_id: person.id, type: mtype, value: val, unit,
          });
          // Auto-calculate BMI if both weight and height are available
          if (mtype === "weight" || mtype === "height") {
            await this._tryAutoCalcBMI(person, mtype, val);
          }
          input.value = "";
          this._showToast(`${label} sparad ✓`);
        }
      }, "Spara"),
    );
    return wrap;
  }

  async _tryAutoCalcBMI(person, justEnteredType, justEnteredValue) {
    const weightData = justEnteredType === "weight" ? { value: justEnteredValue } : this._latestSensor(person, "weight");
    const heightData = justEnteredType === "height" ? { value: justEnteredValue } : this._latestSensor(person, "height");
    const bmi = calcBMI(weightData?.value, heightData?.value);
    if (bmi) {
      await this._callService("log_measurement", {
        person_id: person.id, type: "bmi", value: bmi, unit: "kg/m²",
      });
    }
  }

  _autoBMINote(person) {
    const w = this._latestSensor(person, "weight");
    const h = this._latestSensor(person, "height");
    const bmi = calcBMI(w?.value, h?.value);
    if (!bmi) return el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "4px" } },
      "BMI beräknas automatiskt när vikt och längd är angivna.");
    return el("div", { style: { fontSize: "12px", color: "var(--teal)", marginTop: "4px" } },
      `📊 Beräknat BMI: ${bmi} kg/m²`);
  }

  // ── TAB: Vital signs ─────────────────────────────────────────────────────

  _tab_vital(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    const vitalMetrics = [
      { mtype: "blood_pressure", label: "Blodtryck sys", color: "var(--red)" },
      { mtype: "pulse",          label: "Puls",          color: "var(--teal)" },
      { mtype: "spo2",           label: "SpO2",          color: "var(--green)" },
    ];

    const grid = el("div", { className: "stat-grid stat-grid-3" });
    for (const m of vitalMetrics) {
      const d = this._latestSensor(person, m.mtype);
      let val = "—";
      if (d) {
        if (m.mtype === "blood_pressure" && d.diastolic) val = `${d.value}/${d.diastolic}`;
        else val = `${d.value}${m.mtype === "spo2" ? "%" : ""}`;
      }
      grid.appendChild(el("div", { className: "stat-card" },
        el("div", { className: "stat-label" }, m.label),
        el("div", { className: "stat-value", style: { color: d ? m.color : "var(--muted)", fontSize: "17px" } }, val),
        el("div", { className: "stat-unit" }, d ? fmtTs(d.timestamp, this._hass) : "ingen data"),
      ));
    }
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "💉 Vitala parametrar"),
      grid,
    ));

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "📈 Blodtryck & Puls — trend", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["30d", "90d", "365d"].map(r =>
          el("button", { className: `chip${this._state.chartRange === r ? " active" : ""}`,
            onClick: () => { this._state.chartRange = r; this._render(); }
          }, r === "30d" ? "30 dagar" : r === "90d" ? "90 dagar" : "1 år")
        )
      ),
      el("div", { id: "chart-vital", style: { minHeight: "180px" } }),
    ));

    // Input
    const lastBP  = this._latestSensor(person, "blood_pressure");
    const lastPuls = this._latestSensor(person, "pulse");
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Registrera vitala"),
      el("div", { className: "form-row form-row-3", style: { marginBottom: "12px" } },
        this._numericGroup("Systoliskt", "bp-sys", "120", lastBP?.value ?? ""),
        this._numericGroup("Diastoliskt", "bp-dia", "80",  lastBP?.diastolic ?? ""),
        this._numericGroup("Puls",        "bp-puls", "72", lastPuls?.value ?? ""),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const sys = parseFloat(this.shadowRoot.getElementById("bp-sys")?.value);
          const dia = parseFloat(this.shadowRoot.getElementById("bp-dia")?.value);
          const puls = parseFloat(this.shadowRoot.getElementById("bp-puls")?.value);
          if (sys && dia) {
            await this._callService("log_measurement", {
              person_id: person.id, type: "blood_pressure",
              value: sys, value2: dia, unit: "mmHg",
            });
          }
          if (puls) {
            await this._callService("log_measurement", {
              person_id: person.id, type: "pulse", value: puls, unit: "slag/min",
            });
          }
          this._showToast("Blodtryck & puls sparade ✓");
        }
      }, "Spara BT & puls"),
      el("div", { style: { height: "12px" } }),
      this._inlineInput("SpO2 (%)", "spo2", "%", "98", "1", person),
    ));

    return frag;
  }

  _numericGroup(label, id, placeholder, value = "") {
    return el("div", {},
      el("label", { className: "form-label" }, label),
      el("input", { className: "field", id, placeholder, type: "number", style: { textAlign: "center" }, value }),
    );
  }

  // ── TAB: Medication ───────────────────────────────────────────────────────

  _tab_medication(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    // Input form
    const medNames = this._getMedList();
    let selectedMed = medNames[0] || "";
    let selectedRoute = "oral";
    let isSkipped = false;

    const medSelect = el("select", { className: "field",
      onChange: e => { selectedMed = e.target.value; }
    },
      ...medNames.map(m => el("option", { value: m }, m)),
      el("option", { value: "__new__" }, "+ Ange nytt läkemedel…"),
    );
    const medCustom = el("input", { className: "field", placeholder: "Läkemedelsnamn", style: { display: "none" } });
    medSelect.addEventListener("change", () => {
      medCustom.style.display = medSelect.value === "__new__" ? "block" : "none";
    });

    const doseInput = el("input", { className: "field", placeholder: "500", type: "number" });
    const doseUnit = el("select", { className: "field" },
      ...["mg", "ml", "tablet", "puff", "droppe", "g"].map(u => el("option", { value: u }, u))
    );
    const routeSelect = el("select", { className: "field",
      onChange: e => { selectedRoute = e.target.value; }
    },
      ...ROUTES.map(r => el("option", { value: r.value }, r.label))
    );
    const noteInput = el("input", { className: "field", placeholder: "Anteckning (valfri)" });
    const timeInput = this._makeTimeInput();

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Registrera medicin"),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Läkemedel"), medSelect, medCustom),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, "Dos"), doseInput),
        el("div", {}, el("label", { className: "form-label" }, "Enhet"), doseUnit),
      ),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Administreringssätt"), routeSelect),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "12px" } },
        el("div", {}, el("label", { className: "form-label" }, "Klockslag"), timeInput),
        el("div", {}, el("label", { className: "form-label" }, "Anteckning"), noteInput),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const name = medSelect.value === "__new__" ? medCustom.value.trim() : medSelect.value;
          if (!name) return;
          const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
          const ts = `${today}T${timeInput.getValue()}:00`;
          await this._callService("log_medication", {
            person_id: person.id,
            medication: name,
            dose: parseFloat(doseInput.value) || null,
            dose_unit: doseUnit.value,
            route: routeSelect.value,
            timestamp: ts,
            note: noteInput.value,
          });
          this._showToast("Medicin registrerad ✓");
        }
      }, "💊 Registrera dos"),
    ));

    // History
    const meds = (person.medications || [])
      .slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, `Historik (${meds.length} poster)`),
      meds.length === 0
        ? el("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "Ingen medicinering loggad.")
        : el("div", {}, ...meds.slice(0, 20).map(m =>
            el("div", { className: "entry-item" },
              el("div", { className: "entry-icon" }, m.skipped ? "🚫" : "💊"),
              el("div", { style: { flex: 1 } },
                el("div", { className: "entry-name", style: { textDecoration: m.skipped ? "line-through" : "none" } }, m.name),
                el("div", { className: "entry-sub" }, `${m.dose || ""} ${m.unit || ""} · ${ROUTES.find(r => r.value === m.route)?.label || m.route}`.trim()),
              ),
              el("div", { className: "entry-time" }, fmtTs(m.timestamp, this._hass)),
              el("button", { className: "btn-icon btn-danger",
                onClick: async () => {
                  await this._callService("delete_entry", { person_id: person.id, entry_id: m.id });
                  this._showToast("Post borttagen");
                }
              }, "🗑"),
            )
          ))
    ));

    return frag;
  }

  _getMedList() {
    // Gather from all person medication histories
    const names = new Set();
    for (const p of this._state.persons) {
      for (const m of p.medications || []) names.add(m.name);
    }
    if (names.size === 0) {
      ["Alvedon 500mg", "Alvedon 1g", "Ipren 400mg", "Näsdroppar"].forEach(n => names.add(n));
    }
    return [...names];
  }

  // ── TAB: Wellbeing ────────────────────────────────────────────────────────

  _tab_wellbeing(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    let selectedPain = this._state.pain;
    let selectedMood = this._state.mood;
    let selectedTags = new Set(this._state.tags);

    const card = el("div", { className: "card" },
      el("div", { className: "card-title" }, "🌿 Välbefinnande — registrera"),
    );

    // Pain scale
    const painLabel = el("label", { className: "form-label" }, "Smärtnivå (NRS 0–10)");
    const painScale = el("div", { className: "pain-scale" });
    const renderPain = () => {
      painScale.innerHTML = "";
      for (let i = 0; i <= 10; i++) {
        const btn = el("button", { className: `pain-btn${selectedPain === i ? " active" : ""}`,
          onClick: () => { selectedPain = i; this._state.pain = i; renderPain(); }
        }, String(i));
        painScale.appendChild(btn);
      }
    };
    renderPain();
    card.appendChild(painLabel);
    card.appendChild(painScale);
    card.appendChild(el("div", { style: { marginTop: "14px" } }));

    // Mood
    const moods = [["😴","Utmattad"],["😔","Trött"],["😐","Ok"],["🙂","Bättre"],["😊","Bra"]];
    const moodLabel = el("label", { className: "form-label" }, "Humör / energi");
    const moodRow = el("div", { className: "mood-row" });
    const renderMoods = () => {
      moodRow.innerHTML = "";
      moods.forEach(([emoji, label], i) => {
        const val = i + 1;
        const btn = el("button", { className: `mood-btn${selectedMood === val ? " active" : ""}`,
          onClick: () => { selectedMood = val; this._state.mood = val; renderMoods(); }
        },
          el("span", { className: "mood-emoji" }, emoji),
          el("span", { className: "mood-label" }, label),
        );
        moodRow.appendChild(btn);
      });
    };
    renderMoods();
    card.appendChild(moodLabel);
    card.appendChild(moodRow);
    card.appendChild(el("div", { style: { marginTop: "14px" } }));

    // Symptom tags
    const tagLabel = el("label", { className: "form-label" }, "Symtom");
    const tagCloud = el("div", { className: "chip-row", style: { marginBottom: "10px" } });
    const renderTags = () => {
      tagCloud.innerHTML = "";
      for (const tag of SYMPTOM_TAGS) {
        const btn = el("button", { className: `tag${selectedTags.has(tag) ? " active" : ""}`,
          onClick: () => {
            selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);
            this._state.tags = selectedTags;
            renderTags();
          }
        }, tag);
        tagCloud.appendChild(btn);
      }
    };
    renderTags();

    const noteInput = el("input", { className: "field", placeholder: "Övriga symtom (fritext)…", style: { marginTop: "4px" } });

    card.appendChild(tagLabel);
    card.appendChild(tagCloud);
    card.appendChild(noteInput);
    card.appendChild(el("div", { style: { marginTop: "14px" } }));

    card.appendChild(el("button", { className: "btn btn-primary",
      onClick: async () => {
        await this._callService("add_symptom", {
          person_id: person.id,
          pain: selectedPain,
          mood: selectedMood,
          tags: [...selectedTags],
          note: noteInput.value,
        });
        // Reset state
        this._state.pain = null; this._state.mood = null; this._state.tags = new Set();
        noteInput.value = "";
        this._showToast("Välbefinnande sparat ✓");
        selectedPain = null; selectedMood = null; selectedTags = new Set();
        renderPain(); renderMoods(); renderTags();
      }
    }, "Spara välbefinnande"));

    frag.appendChild(card);

    // Wellbeing chart
    const recent = (person.wellbeing || []).slice(-14).reverse();
    if (recent.length > 0) {
      frag.appendChild(el("div", { className: "card" },
        el("div", { className: "card-title" }, "📊 Smärta & humör", this._labelToggle()),
        el("div", { className: "chip-row", style: { marginBottom: "12px" } },
          ...["30d", "90d", "365d"].map(r =>
            el("button", { className: `chip${this._state.chartRange === r ? " active" : ""}`,
              onClick: () => { this._state.chartRange = r; this._render(); }
            }, r === "30d" ? "30 dagar" : r === "90d" ? "90 dagar" : "1 år")
          )
        ),
        el("div", { id: "chart-wellbeing", style: { minHeight: "160px" } }),
      ));
    }

    return frag;
  }

  // ── ADMIN VIEW ────────────────────────────────────────────────────────────

  _renderAdmin() {
    const topbar = el("div", { className: "sj-topbar" },
      el("button", { className: "btn-back", onClick: () => this._goHome() }, "←"),
      el("div", {},
        el("div", { className: "sj-title" }, "⚙ Hantera personer"),
        el("div", { className: "sj-subtitle" }, `${this._state.persons.length} personer`),
      ),
    );

    const scroll = el("div", { className: "sj-scroll" });

    // Existing persons
    for (const person of this._state.persons) {
      const age = calcAge(person.birth_date);
      const isInactive = person.active === false;
      scroll.appendChild(el("div", { className: "person-row",
        style: isInactive ? { opacity: "0.5" } : {}
      },
        this._renderAvatar(person, 40),
        el("div", { className: "person-row-info" },
          el("div", { className: "person-row-name" },
            person.name + (isInactive ? " (avaktiverad)" : "")
          ),
          el("div", { className: "person-row-sub" },
            [age ? `${age} år` : null, person.gender ? GENDER_LABELS[person.gender] : null,
             person.birth_date || null].filter(Boolean).join(" · ") || "—"
          ),
        ),
        isInactive
          ? el("button", { className: "btn-icon", style: { color: "var(--green)", fontSize: "14px", marginRight: "4px" },
              title: "Återaktivera person",
              onClick: async () => {
                await this._hass.callService(DOMAIN, "activate_person", { person_id: person.id });
                this._showToast(`${person.name} återaktiverad`);
                setTimeout(() => this._loadPersons(), 1500);
              }
            }, "↩")
          : el("button", { className: "btn-icon", style: { color: "var(--red)", fontSize: "16px", marginRight: "4px" },
              title: "Radera person",
              onClick: () => { this._state.deleteConfirmPersonId = person.id; this._render(); }
            }, "🗑"),
        el("button", { className: "btn-icon", style: { color: "var(--muted)", fontSize: "18px" },
          onClick: () => this._openJournal(person.id)
        }, "→"),
      ));
    }

    // Delete confirmation dialog
    if (this._state.deleteConfirmPersonId) {
      const p = this._state.persons.find(x => x.id === this._state.deleteConfirmPersonId);
      const cancel = () => { this._state.deleteConfirmPersonId = null; this._render(); };
      scroll.appendChild(el("div", { className: "card", style: { borderColor: "var(--red)", marginTop: "8px" } },
        el("div", { className: "card-title", style: { color: "var(--red)" } },
          `🗑 Radera ${p?.name || "person"}?`
        ),
        el("p", { style: { color: "var(--muted)", fontSize: "13px", marginBottom: "14px" } },
          "Välj om du vill radera personen och all historik, eller bara avaktivera personen och behålla historiken."
        ),
        el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          el("button", {
            className: "btn",
            style: { background: "var(--red)", color: "white", flex: "1 1 120px" },
            onClick: async () => {
              const pid = this._state.deleteConfirmPersonId;
              this._state.deleteConfirmPersonId = null;
              await this._hass.callService(DOMAIN, "delete_person", { person_id: pid, keep_history: false });
              this._showToast("Person och historik raderad");
              setTimeout(() => this._loadPersons(), 1500);
            }
          }, "Radera allt"),
          el("button", {
            className: "btn",
            style: { background: "var(--yellow)", color: "#1a1a1a", flex: "1 1 120px" },
            onClick: async () => {
              const pid = this._state.deleteConfirmPersonId;
              this._state.deleteConfirmPersonId = null;
              await this._hass.callService(DOMAIN, "delete_person", { person_id: pid, keep_history: true });
              this._showToast("Person avaktiverad — historik bevarad");
              setTimeout(() => this._loadPersons(), 1500);
            }
          }, "Behåll historik"),
          el("button", { className: "btn btn-ghost", style: { flex: "1 1 80px" }, onClick: cancel }, "Avbryt"),
        ),
      ));
    }

    // Add new person form
    const nameIn = el("input", { className: "field", placeholder: "Namn" });
    const bdIn   = el("input", { className: "field", type: "text", placeholder: "yyyy-mm-dd", pattern: "\\d{4}-\\d{2}-\\d{2}", maxLength: "10" });
    const genderSel = el("select", { className: "field" },
      el("option", { value: "" }, "Kön (valfritt)"),
      el("option", { value: "male" }, "Man"),
      el("option", { value: "female" }, "Kvinna"),
      el("option", { value: "other" }, "Annat"),
    );

    scroll.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "➕ Lägg till person"),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Namn *"), nameIn),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "12px" } },
        el("div", {}, el("label", { className: "form-label" }, "Födelsedatum"), bdIn),
        el("div", {}, el("label", { className: "form-label" }, "Kön"), genderSel),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const name = nameIn.value.trim();
          if (!name) { this._showToast("Ange ett namn", true); return; }
          await this._callService("add_person", {
            name,
            birth_date: bdIn.value || undefined,
            gender: genderSel.value || undefined,
          });
          nameIn.value = ""; bdIn.value = ""; genderSel.value = "";
          this._showToast(`${name} tillagd ✓`);
        }
      }, "Spara person"),
    ));

    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%" } }, topbar, scroll);
  }

  // ── Label toggle helper ───────────────────────────────────────────────────

  _labelToggle() {
    return el("div", { className: "lbl-tog",
      onClick: () => { this._state.showLabels = !this._state.showLabels; this._render(); }
    },
      el("span", { className: "lbl-tog-label" }, "Etiketter"),
      el("div", { className: `lbl-tog-track${this._state.showLabels ? " on" : ""}` },
        el("div", { className: "lbl-tog-knob" })
      )
    );
  }

  // ── Time input helper (always 24h) ───────────────────────────────────────

  _makeTimeInput() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const hEl = el("input", { type: "number", min: "0", max: "23", value: hh,
      className: "field", style: { width: "58px", textAlign: "center", padding: "10px 6px" } });
    const mEl = el("input", { type: "number", min: "0", max: "59", value: mm,
      className: "field", style: { width: "58px", textAlign: "center", padding: "10px 6px" } });
    const wrapper = el("div", { style: { display: "flex", alignItems: "center", gap: "4px" } },
      hEl, el("span", { style: { color: "var(--text)", fontWeight: "700", fontSize: "16px" } }, ":"), mEl);
    wrapper.getValue = () => {
      const h = Math.min(23, Math.max(0, parseInt(hEl.value) || 0));
      const m = Math.min(59, Math.max(0, parseInt(mEl.value) || 0));
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    return wrapper;
  }

  // ── measurementForm helper ────────────────────────────────────────────────

  _measurementForm(person, mtype, label, placeholder, step) {
    const input = el("input", { className: "field", placeholder, type: "number", step });
    const timeInput = this._makeTimeInput();
    const info = MTYPE_LABELS[mtype];

    return el("div", { className: "card" },
      el("div", { className: "card-title" }, `Registrera ${info.label.toLowerCase()}`),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "12px" } },
        el("div", {}, el("label", { className: "form-label" }, label), input),
        el("div", {}, el("label", { className: "form-label" }, "Klockslag"), timeInput),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const val = parseFloat(input.value);
          if (!val) return;
          const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
          const ts = `${today}T${timeInput.getValue()}:00`;
          await this._callService("log_measurement", {
            person_id: person.id, type: mtype, value: val, unit: info.unit, timestamp: ts,
          });
          input.value = "";
          this._showToast(`${info.label} sparad ✓`);
        }
      }, `Spara ${info.label.toLowerCase()}`),
    );
  }

  // ── Post-render: charts ───────────────────────────────────────────────────

  _apexTimeFormat() {
    const tf = this._hass?.locale?.time_format;
    if (tf === "12") return "hh:mm tt";
    if (tf === "24") return "HH:mm";
    // "language" — detect from locale
    const lang = this._hass?.locale?.language || "sv";
    const sample = new Date(2000, 0, 1, 13, 0).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    return /[AaPp][Mm]/.test(sample) ? "hh:mm tt" : "HH:mm";
  }

  async _postRender() {
    if (this._state.view !== "journal" || !this._state.personId) return;
    const person = this._getPerson(this._state.personId);
    if (!person) return;
    const tab = this._state.tab;
    const slug = person.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const eid = (mtype) => person.entity_ids?.[mtype]
      ?? `sensor.${DOMAIN}_${slug}_${mtype}`;

    if (tab === "overview" || tab === "temp") {
      const tempHours = tab === "overview" ? 24 : ({ "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[this._state.tempRange] ?? 24 * 7);
      const series = this._measurementSeries(person, "temperature", tempHours);
      // Medication annotations
      const meds = (person.medications || [])
        .filter(m => {
          const ts = new Date(m.timestamp);
          return (Date.now() - ts) < 86400000;
        });

      const annotations = {
        yaxis: [{ y: 38.0, borderColor: "#F56565", strokeDashArray: 5, borderWidth: 1.5,
          label: { text: "38° Feber", style: { background: "transparent", color: "#F56565", fontSize: "10px" } } }],
        xaxis: meds.map(m => ({
          x: toChartMs(m.timestamp),
          borderColor: "#17B8A6", strokeDashArray: 4, borderWidth: 1.5,
          label: { text: this._state.showLabels ? `💊 ${m.name}` : "💊", position: "bottom",
            style: { background: "#1C2733", color: "#17B8A6", fontSize: "9px" } },
        })),
      };

      const chartId = tab === "overview" ? "chart-overview" : "chart-temp";
      await this._renderChart(chartId, {
        ...apexDefaults(tab === "temp" ? 200 : 170),
        chart: { ...apexDefaults().chart, type: "area", height: tab === "temp" ? 200 : 170 },
        series: [{ name: "Temperatur °C", data: series.length > 0 ? series : [] }],
        colors: ["#17B8A6"],
        fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.02 } },
        stroke: { curve: "smooth", width: 2.5 },
        markers: { size: 4, strokeColors: "#141B24", strokeWidth: 2,
          fillColors: series.map(p => p.y >= 38 ? "#F56565" : p.y >= 37.3 ? "#ECC94B" : "#17B8A6"),
          hover: { size: 6 } },
        dataLabels: { enabled: this._state.showLabels,
          formatter: v => v != null ? (+v).toFixed(1) : "",
          style: { fontSize: "10px", colors: ["#1a1a1a"] },
          background: { enabled: true, fillColor: "#d4d4d4", borderRadius: 3, borderWidth: 0, opacity: 0.9 },
          offsetY: -6 },
        annotations,
        xaxis: { ...apexDefaults().xaxis, type: "datetime",
          labels: { ...apexDefaults().xaxis.labels, datetimeFormatter: { hour: this._apexTimeFormat() } } },
        yaxis: { ...apexDefaults().yaxis, min: 35.5, max: 40.5, tickAmount: 5,
          labels: { ...apexDefaults().yaxis.labels, formatter: v => v.toFixed(1) + "°" } },
        tooltip: { x: { format: this._apexTimeFormat() }, y: { formatter: v => v.toFixed(1) + " °C" } },
        noData: { text: "Ingen historik ännu", style: { color: "#6B8599" } },
      });
    }

    if (tab === "body") {
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRange] ?? 24 * 90;
      const series = this._measurementSeries(person, "weight", chartHours);
      await this._renderChart("chart-weight", {
        ...apexDefaults(160),
        chart: { ...apexDefaults().chart, type: "line", height: 160 },
        series: [{ name: "Vikt kg", data: series }],
        colors: ["#17B8A6"],
        stroke: { curve: "smooth", width: 2.5 },
        markers: { size: 3, strokeColors: "#141B24", strokeWidth: 2 },
        dataLabels: { enabled: this._state.showLabels,
          formatter: v => v != null ? (+v).toFixed(1) : "",
          style: { fontSize: "10px", colors: ["#1a1a1a"] },
          background: { enabled: true, fillColor: "#d4d4d4", borderRadius: 3, borderWidth: 0, opacity: 0.9 },
          offsetY: -6 },
        xaxis: { ...apexDefaults().xaxis, type: "datetime",
          labels: { ...apexDefaults().xaxis.labels, datetimeFormatter: { day: "d MMM" } } },
        yaxis: { ...apexDefaults().yaxis,
          labels: { ...apexDefaults().yaxis.labels, formatter: v => v.toFixed(1) + " kg" } },
        noData: { text: "Ingen historik ännu", style: { color: "#6B8599" } },
      });
    }

    if (tab === "vital") {
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRange] ?? 24 * 90;
      const sysSeries  = this._measurementSeries(person, "blood_pressure", chartHours);
      const diaSeries  = this._measurementSeries(person, "blood_pressure", chartHours, true);
      const pulsSeries = this._measurementSeries(person, "pulse", chartHours);
      await this._renderChart("chart-vital", {
        ...apexDefaults(180),
        chart: { ...apexDefaults().chart, type: "line", height: 180 },
        series: [
          { name: "Systoliskt", data: sysSeries },
          { name: "Diastoliskt", data: diaSeries },
          { name: "Puls", data: pulsSeries },
        ],
        colors: ["#F56565", "#FC8181", "#ECC94B"],
        stroke: { curve: "smooth", width: [2.5, 2, 2], dashArray: [0, 4, 6] },
        markers: { size: 3, strokeColors: "#141B24", strokeWidth: 2 },
        dataLabels: { enabled: this._state.showLabels,
          formatter: v => v != null ? Math.round(v).toString() : "",
          style: { fontSize: "10px", colors: ["#1a1a1a"] },
          background: { enabled: true, fillColor: "#d4d4d4", borderRadius: 3, borderWidth: 0, opacity: 0.9 },
          offsetY: -6 },
        xaxis: { ...apexDefaults().xaxis, type: "datetime" },
        legend: { show: true, position: "top", labels: { colors: "#6B8599" } },
        tooltip: { x: { format: this._apexTimeFormat() } },
        noData: { text: "Ingen historik ännu", style: { color: "#6B8599" } },
      });
    }

    if (tab === "wellbeing") {
      const person2 = this._getPerson(this._state.personId);
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRange] ?? 24 * 90;
      const cutoff = Date.now() - chartHours * 3600 * 1000;
      const wb = (person2?.wellbeing || [])
        .filter(w => new Date(w.timestamp).getTime() >= cutoff)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (wb.length > 0) {
        await this._renderChart("chart-wellbeing", {
          ...apexDefaults(160),
          chart: { ...apexDefaults().chart, type: "bar", height: 160 },
          series: [
            { name: "Smärta", data: wb.map(w => w.pain ?? 0) },
            { name: "Humör", data: wb.map(w => w.mood ?? 0) },
          ],
          colors: ["#ECC94B", "#17B8A6"],
          plotOptions: { bar: { borderRadius: 4, columnWidth: "60%" } },
          dataLabels: { enabled: this._state.showLabels,
            formatter: v => v != null ? Math.round(v).toString() : "",
            style: { fontSize: "10px", colors: ["#1a1a1a"] },
            background: { enabled: true, fillColor: "#d4d4d4", borderRadius: 3, borderWidth: 0, opacity: 0.9 } },
          xaxis: { ...apexDefaults().xaxis,
            categories: wb.map(w => fmtDate(w.timestamp, this._hass)) },
          yaxis: { ...apexDefaults().yaxis, min: 0, max: 10 },
          legend: { show: true, position: "top", labels: { colors: "#6B8599" } },
        });
      }
    }
  }
}

// ── Register ─────────────────────────────────────────────────────────────────

customElements.define("sjukjournal-card", SjukJournalCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sjukjournal-card",
  name: "SjukJournal",
  description: "Hälsojournal för hela familjen",
  preview: true,
});
