/**
 * HomeSick Lovelace Card
 *
 * Registrerar sig som custom element: <homesick-card>
 *
 * Konfiguration i Lovelace (YAML):
 *   type: custom:homesick-card
 *
 * Kommunikation med HA:
 * - Reads people and journal data via REST API  (/api/homesick/*)
 * - Calls services via hass.callService()
 * - Fetches history via HA History API
 *
 * Struktur:
 *   HomeSickCard        — root custom element, handles routing
 *   ├─ renderHome()        — startsida med personkort
 *   ├─ renderJournal()     — journalsida per person
 *   │   ├─ tabOverview()   — overview + temperature chart
 *   │   ├─ tabTemp()       — temperatur + inmatning
 *   │   ├─ tabBody()       — weight, height, BMI, waist, blood glucose
 *   │   ├─ tabVital()      — BP, pulse, SpO2
 *   │   ├─ tabMed()        — medicinlogg + inmatning
 *   │   └─ tabWellbeing()  — pain, mood, symptom tags
 *   └─ renderAdmin()       — add / edit people
 *
 * ApexCharts is loaded dynamically from cdnjs if not already present.
 */

// ── ApexCharts loader ────────────────────────────────────────────────────────

const APEX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/apexcharts/3.45.2/apexcharts.min.js";

async function ensureApex() {
  if (window.ApexCharts) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = APEX_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error(
      "ApexCharts could not be loaded from CDN. Charts require internet access, " +
      "or bundle apexcharts.min.js to /config/www/homesick/apexcharts.min.js."
    ));
    document.head.appendChild(s);
  });
}

// ── Constants ────────────────────────────────────────────────────────────────

const DOMAIN = "homesick";

const MTYPE_LABELS = {
  temperature:    { label: "Temperature",   unit: "°C",     icon: "🌡" },
  blood_pressure: { label: "Blood pressure",    unit: "mmHg",   icon: "💉" },
  pulse:          { label: "Pulse",         unit: "bpm",icon: "💓" },
  weight:         { label: "Weight",         unit: "kg",      icon: "⚖️" },
  spo2:           { label: "SpO2",         unit: "%",       icon: "🫁" },
  pain:           { label: "Pain",       unit: "/10",     icon: "😣" },
  mood:           { label: "Mood",        unit: "/5",      icon: "😊" },
  blood_glucose:  { label: "Blood glucose",   unit: "mmol/L",  icon: "🩸" },
  height:         { label: "Height",        unit: "cm",      icon: "📏" },
  bmi:            { label: "BMI",          unit: "kg/m²",   icon: "🧍" },
  waist:          { label: "Waist",    unit: "cm",      icon: "📐" },
};

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };

const SYMPTOM_TAGS = [
  "Cough", "Sore throat", "Runny nose", "Nausea", "Headache",
  "Dizziness", "Chills", "Stomach ache", "Fatigue", "Breathing difficulties",
];

const ROUTES = [
  { value: "oral",       label: "Oral" },
  { value: "inhalation", label: "Inhalation" },
  { value: "injection",  label: "Injection" },
  { value: "topical",    label: "Topical" },
  { value: "other",      label: "Other" },
];

// ── Theme ────────────────────────────────────────────────────────────────────

const CSS = `
  :host {
    display: block;
    font-family: 'Segoe UI', system-ui, sans-serif;
    height: var(--homesick-height, 800px);
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

  /* ── Reminder / schedule UI ── */
  .sj-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  }
  .sj-modal {
    background: var(--card, #1e1e2e);
    color: var(--text);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px; max-width: 480px; width: 90%;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,.4);
    display: flex; flex-direction: column; gap: 12px;
  }
  .sj-modal h3 { margin: 0; font-size: 1.1rem; color: var(--text); }
  .sj-modal p  { font-size: .9rem; color: var(--muted); margin: 0; }
  .sj-modal label {
    font-size: .85rem; color: var(--muted); margin-bottom: 2px; display: block;
  }
  .sj-modal select, .sj-modal input, .sj-modal textarea {
    width: 100%; padding: 8px; border-radius: 6px;
    border: 1px solid var(--border, #333);
    background: var(--mid, #2a2a3e);
    color: var(--text);
    font-size: .9rem;
    font-family: inherit;
  }
  .sj-modal-actions {
    display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;
  }
  .sj-btn {
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    border: none; font-size: .9rem; font-weight: 600;
  }
  .sj-btn-primary { background: var(--primary, #7c6af7); color: white; }
  .sj-btn-secondary { background: var(--mid, #2a2a3e); color: var(--text); }
  .sj-btn-ghost { background: transparent; color: var(--muted); }

  /* switch toggle (modal-only; admin view uses existing lbl-tog) */
  .sj-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
  .sj-switch input { opacity: 0; width: 0; height: 0; }
  .sj-switch-slider {
    position: absolute; inset: 0; cursor: pointer;
    background: var(--border, #555); border-radius: 22px;
    transition: .2s;
  }
  .sj-switch-slider:before {
    content: ''; position: absolute;
    width: 16px; height: 16px; left: 3px; bottom: 3px;
    background: white; border-radius: 50%; transition: .2s;
  }
  .sj-switch input:checked + .sj-switch-slider { background: var(--primary, #7c6af7); }
  .sj-switch input:checked + .sj-switch-slider:before { transform: translateX(18px); }
  .sj-switch-row {
    display: flex; align-items: center; justify-content: space-between;
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

/**
 * Slugify a name the same way HA's Python slugify() does.
 * NFD decomposition strips diacritics (å→a, ä→a, ö→o, é→e …)
 * then non-alphanumeric runs become underscores.
 */
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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
  if (temp >= 38.0) return "Fever";
  if (temp >= 37.3) return "Subfever";
  return "Normal";
}

function calcBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const hm = heightCm / 100;
  return +(weightKg / (hm * hm)).toFixed(1);
}

// ── Unit system ───────────────────────────────────────────────────────────────

function isImperial() {
  const stored = localStorage.getItem('homesick_units');
  if (stored !== null) return stored === 'imperial';
  const lang = navigator.language || '';
  return lang === 'en-US' || lang === 'en-LR' || lang === 'my';
}

function toDisplay(mtype, val) {
  if (!isImperial() || val == null) return val;
  switch (mtype) {
    case 'temperature':   return +(val * 9 / 5 + 32).toFixed(1);
    case 'weight':        return +(val * 2.20462).toFixed(1);
    case 'height':
    case 'waist':         return +(val * 0.393701).toFixed(1);
    case 'blood_glucose': return Math.round(val * 18.0182);
    default:              return val;
  }
}

function fromDisplay(mtype, val) {
  if (!isImperial() || val == null) return val;
  switch (mtype) {
    case 'temperature':   return +((val - 32) * 5 / 9).toFixed(2);
    case 'weight':        return +(val / 2.20462).toFixed(2);
    case 'height':
    case 'waist':         return +(val / 0.393701).toFixed(1);
    case 'blood_glucose': return +(val / 18.0182).toFixed(2);
    default:              return val;
  }
}

function displayUnit(mtype) {
  if (!isImperial()) return MTYPE_LABELS[mtype]?.unit ?? '';
  return { temperature: '°F', weight: 'lbs', height: 'in', waist: 'in', blood_glucose: 'mg/dL' }[mtype]
      ?? MTYPE_LABELS[mtype]?.unit ?? '';
}

function convertSeries(mtype, series) {
  if (!isImperial()) return series;
  return series.map(p => ({ ...p, y: p.y != null ? toDisplay(mtype, p.y) : p.y }));
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

function _shouldPromptSchedule(schedule, masterEnabled) {
  if (!masterEnabled) return false;
  if (!schedule) return true;
  if (schedule.never_ask) return false;
  if (schedule.enabled) return false;
  if (schedule.last_declined_at) {
    const declinedMs = new Date(schedule.last_declined_at).getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - declinedMs < weekMs) return false;
  }
  return true;
}

class HomeSickCard extends HTMLElement {
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
      chartRanges: { body: "90d", vital: "30d", wellbeing: "30d" },
      showLabels: false,
      deleteConfirmPersonId: null,
      deleteConfirmEntryId: null,
      persons: [],
      loading: true,
      // per-tab form state
      pain: null,
      mood: null,
      tags: new Set(),
      charts: {},          // apex instances keyed by id
      schedulesByPerson: {}, // personId → { medKey: schedule }
      remindersEnabled: true,
      pendingSchedulePrompt: null, // { personId, medicineName, schedule } — survives re-renders
    };
    this._toast = null;
  }

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  setConfig(config) {
    this._config = config;
  }

  _cardHeight() {
    const h = this._config?.height;
    return h ? `${h}px` : "800px";
  }

  set hass(hass) {
    const firstTime = this._hass === null;
    this._hass = hass;
    // Initial load
    if (this._state.loading) {
      this._loadPersons();
    }
    if (firstTime) {
      // Fetch reminder masterswitch state once
      this._fetchRemindersEnabled().then(enabled => {
        this._state.remindersEnabled = enabled;
      });
    }
  }

  static getConfigElement() {
    return document.createElement("homesick-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  async _loadPersons() {
    try {
      const data = await this._hass.callWS({
        type: "homesick/get_persons",
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
        type: "homesick/get_person_data",
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
      ?? `sensor.${DOMAIN}_${slugify(person.name)}_${mtype}`;
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

  // ── Reminder schedules ──────────────────────────────────────────────────

  async _fetchRemindersEnabled() {
    try {
      const resp = await this._hass.fetchWithAuth("/api/homesick/settings");
      const data = await resp.json();
      return data.reminders_enabled !== false;
    } catch (_) {
      return true; // fail open
    }
  }

  async _fetchSchedules(personId) {
    try {
      const resp = await this._hass.fetchWithAuth(`/api/homesick/schedules/${personId}`);
      const arr = await resp.json();
      return (arr || []).reduce((acc, s) => {
        acc[s.medicine_name.trim().toLowerCase().replace(/ /g, "_")] = s;
        return acc;
      }, {});
    } catch (_) {
      return {};
    }
  }

  async _refreshSchedules(personId) {
    const schedules = await this._fetchSchedules(personId);
    const masterEnabled = await this._fetchRemindersEnabled();
    this._state.schedulesByPerson[personId] = schedules;
    this._state.remindersEnabled = masterEnabled;
    this._render();
  }

  async _afterDoseLogged(personId, medicineName) {
    const [schedules, masterEnabled] = await Promise.all([
      this._fetchSchedules(personId),
      this._fetchRemindersEnabled(),
    ]);
    const key = medicineName.trim().toLowerCase().replace(/ /g, "_");
    const schedule = schedules[key] || null;
    if (_shouldPromptSchedule(schedule, masterEnabled)) {
      this._state.pendingSchedulePrompt = { personId, medicineName, schedule };
      this._render();
    }
  }

  _renderRemindersSection(person, schedules) {
    const activeSchedules = Object.values(schedules).filter(s => s && (s.enabled || s.frequency));
    const masterOff = !this._state.remindersEnabled;

    // Today's upcoming doses
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const doseRows = [];
    for (const sched of Object.values(schedules)) {
      if (!sched || !sched.enabled) continue;
      for (const dose of sched.upcoming_doses || []) {
        const dt = new Date(dose.scheduled_at);
        if (dt > todayEnd) continue;
        if (dt < new Date(now.getTime() - 12 * 3600 * 1000)) continue; // hide very old
        doseRows.push({ sched, dose, dt });
      }
    }
    doseRows.sort((a, b) => a.dt - b.dt);

    const doseList = doseRows.length
      ? el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" } },
          ...doseRows.map(({ sched, dose, dt }) => {
            const timeStr = dt.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
            const statusEl = dose.status === "taken"
              ? el("span", { style: { color: "var(--green, #22c55e)", fontWeight: "600", fontSize: "13px" } }, "✓ Tagen")
              : dose.status === "missed"
                ? el("span", { style: { color: "var(--red)", fontWeight: "600", fontSize: "13px" } }, "✗ Missad")
                : el("button", { className: "btn", style: { padding: "4px 10px", fontSize: "12px" },
                    onClick: async () => {
                      await this._callService("confirm_dose", {
                        person_id: person.id,
                        medicine_name: sched.medicine_name,
                        dose_id: dose.id,
                      });
                      this._showToast("Dos markerad ✓");
                      this._refreshSchedules(person.id);
                    }
                  }, "Markera tagen");
            return el("div", { style: { display: "flex", alignItems: "center", gap: "12px", padding: "6px 10px", background: "var(--mid)", borderRadius: "6px" } },
              el("span", { style: { fontWeight: "600", minWidth: "48px" } }, timeStr),
              el("span", { style: { flex: 1 } }, sched.medicine_name),
              statusEl,
            );
          }))
      : null;

    // Schedule management rows
    const schedRows = activeSchedules.length
      ? el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          ...activeSchedules.map(s => {
            const toggle = el("input", { type: "checkbox", style: { marginRight: "8px" } });
            toggle.checked = !!s.enabled;
            toggle.addEventListener("change", () => {
              this._callService("toggle_schedule", {
                person_id: person.id,
                medicine_name: s.medicine_name,
                enabled: toggle.checked,
              });
            });
            const neverAsk = el("input", { type: "checkbox", style: { marginRight: "4px" } });
            neverAsk.checked = !!s.never_ask;
            neverAsk.addEventListener("change", () => {
              this._callService("set_never_ask", {
                person_id: person.id,
                medicine_name: s.medicine_name,
                value: neverAsk.checked,
              });
            });
            const freqTxt = s.frequency?.type === "daily" ? "varje dag"
              : s.frequency?.type === "multiple_daily" ? "flera/dag"
              : s.frequency?.type === "every_n_days" ? `var ${s.frequency.every_n_days||"?"}:e dag`
              : "—";
            return el("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "8px", background: "var(--mid)", borderRadius: "6px", flexWrap: "wrap" } },
              toggle,
              el("div", { style: { flex: 1, minWidth: "140px" } },
                el("div", { style: { fontWeight: "600" } }, s.medicine_name),
                el("div", { style: { fontSize: "11px", color: "var(--muted)" } }, freqTxt),
              ),
              el("button", { className: "btn btn-ghost", style: { padding: "4px 10px", fontSize: "12px" },
                onClick: () => this._showScheduleEditor(person.id, s.medicine_name, s)
              }, "✏️ Redigera"),
              el("label", { style: { display: "flex", alignItems: "center", fontSize: "12px", color: "var(--muted)", gap: "2px" } },
                neverAsk, "Fråga aldrig"),
            );
          }))
      : el("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "Inga aktiva scheman. Logga en medicin för att lägga upp ett.");

    return el("div", { className: "card" },
      el("div", { className: "card-title" },
        "⏰ Påminnelser",
        masterOff ? el("span", { style: { marginLeft: "8px", fontSize: "12px", color: "var(--red)" } }, "(masterswitch AV)") : null,
      ),
      doseList,
      schedRows,
    );
  }

  _showScheduleEditor(personId, medicineName, existing) {
    const f = existing?.frequency || {};
    const end = existing?.end || { type: "none" };
    const modal = document.createElement("div");
    modal.className = "sj-modal-overlay";
    modal.innerHTML = `
      <div class="sj-modal sj-schedule-editor">
        <h3>Schema: ${medicineName}</h3>

        <label>Frekvens</label>
        <select id="sj-freq-type">
          <option value="daily" ${f.type==="daily"?"selected":""}>Varje dag</option>
          <option value="multiple_daily" ${f.type==="multiple_daily"?"selected":""}>Flera gånger om dagen</option>
          <option value="every_n_days" ${f.type==="every_n_days"?"selected":""}>Var n:te dag</option>
        </select>

        <div id="sj-times-section">
          <label>Klockslag (ett per rad, HH:MM)</label>
          <textarea id="sj-times" rows="3">${(f.times||["08:00"]).join("\n")}</textarea>
        </div>

        <div id="sj-interval-section" style="display:none">
          <label>Intervall (timmar)</label>
          <input type="number" id="sj-interval" min="1" max="24" value="${f.interval_hours||8}">
        </div>

        <div id="sj-ndays-section" style="display:none">
          <label>Var n:te dag</label>
          <input type="number" id="sj-ndays" min="2" max="90" value="${f.every_n_days||2}">
        </div>

        <label>Slutar</label>
        <select id="sj-end-type">
          <option value="none" ${end.type==="none"?"selected":""}>Inget slutdatum</option>
          <option value="date" ${end.type==="date"?"selected":""}>Datum</option>
          <option value="dose_count" ${end.type==="dose_count"?"selected":""}>Antal doser</option>
        </select>
        <div id="sj-end-date-section" style="display:none">
          <input type="date" id="sj-end-date" value="${end.date||""}">
        </div>
        <div id="sj-end-count-section" style="display:none">
          <input type="number" id="sj-end-count" min="1" value="${end.dose_count||7}">
        </div>

        <div class="sj-switch-row">
          <label>Notiser</label>
          <label class="sj-switch">
            <input type="checkbox" id="sj-notif" ${existing?.notifications_on!==false?"checked":""}>
            <span class="sj-switch-slider"></span>
          </label>
        </div>

        <label>Notifieringsmål (t.ex. mobile_app_anna_phone)</label>
        <input type="text" id="sj-notify-target"
          placeholder="lämna tomt för default (notify.notify)"
          value="${existing?.notify_target || ""}">

        <div class="sj-modal-actions">
          <button class="sj-btn sj-btn-primary" id="sj-sched-save">Spara</button>
          <button class="sj-btn sj-btn-ghost" id="sj-sched-cancel">Avbryt</button>
        </div>
      </div>
    `;
    this.shadowRoot.appendChild(modal);

    const freqSel = modal.querySelector("#sj-freq-type");
    const endSel = modal.querySelector("#sj-end-type");
    const updateFreqUI = () => {
      const v = freqSel.value;
      modal.querySelector("#sj-interval-section").style.display = v === "multiple_daily" ? "" : "none";
      modal.querySelector("#sj-ndays-section").style.display = v === "every_n_days" ? "" : "none";
    };
    const updateEndUI = () => {
      const v = endSel.value;
      modal.querySelector("#sj-end-date-section").style.display = v === "date" ? "" : "none";
      modal.querySelector("#sj-end-count-section").style.display = v === "dose_count" ? "" : "none";
    };
    freqSel.addEventListener("change", updateFreqUI);
    endSel.addEventListener("change", updateEndUI);
    updateFreqUI(); updateEndUI();

    modal.querySelector("#sj-sched-cancel").addEventListener("click", () => modal.remove());
    modal.querySelector("#sj-sched-save").addEventListener("click", () => {
      const freqType = freqSel.value;
      const times = modal.querySelector("#sj-times").value
        .split("\n").map(t => t.trim()).filter(Boolean);
      const intervalHours = parseInt(modal.querySelector("#sj-interval").value) || null;
      const nDays = parseInt(modal.querySelector("#sj-ndays").value) || null;
      const endType = endSel.value;
      const endDate = modal.querySelector("#sj-end-date").value || null;
      const endCount = parseInt(modal.querySelector("#sj-end-count").value) || null;
      const notifOn = modal.querySelector("#sj-notif").checked;
      const notifyTarget = modal.querySelector("#sj-notify-target").value.trim() || null;

      this._callService("create_schedule", {
        person_id: personId,
        medicine_name: medicineName,
        frequency: {
          type: freqType,
          times,
          interval_hours: freqType === "multiple_daily" ? intervalHours : null,
          every_n_days: freqType === "every_n_days" ? nDays : null,
        },
        end: { type: endType, date: endDate, dose_count: endCount },
        notifications_on: notifOn,
        notify_target: notifyTarget,
      });
      this._showToast("Schema sparat ✓");
      modal.remove();
    });
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
    try {
      await ensureApex();
    } catch (err) {
      const container = this.shadowRoot.getElementById(containerId);
      if (container) container.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:12px 0">${err.message}</div>`;
      return;
    }
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

    // Inject styles
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    const root = el("div", { className: "sj-root", style: { "--homesick-height": this._cardHeight() } });
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

    // Render pending schedule prompt modal — kept in state so it survives re-renders
    if (this._state.pendingSchedulePrompt) {
      const { personId, medicineName, schedule } = this._state.pendingSchedulePrompt;
      const modal = document.createElement("div");
      modal.className = "sj-modal-overlay";
      modal.innerHTML = `
        <div class="sj-modal">
          <h3>Påminnelse för ${medicineName}?</h3>
          <p>Vill du lägga upp ett påminnelseschema?</p>
          <div class="sj-modal-actions">
            <button class="sj-btn sj-btn-primary" id="sj-prompt-yes">Ja</button>
            <button class="sj-btn sj-btn-secondary" id="sj-prompt-no">Nej</button>
          </div>
        </div>
      `;
      shadow.appendChild(modal);
      modal.querySelector("#sj-prompt-yes").addEventListener("click", () => {
        this._state.pendingSchedulePrompt = null;
        this._render();
        this._showScheduleEditor(personId, medicineName, schedule);
      });
      modal.querySelector("#sj-prompt-no").addEventListener("click", () => {
        this._state.pendingSchedulePrompt = null;
        this._callService("decline_reminder", {
          person_id: personId,
          medicine_name: medicineName,
        });
        this._render();
      });
    }

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
        el("div", { className: "sj-title" }, "🌡 HomeSick"),
        el("div", { className: "sj-subtitle" }, today),
      ),
      el("button", { className: "btn btn-ghost", onClick: () => this._openAdmin() }, "⚙ Manage"),
    );

    const scroll = el("div", { className: "sj-scroll" });

    // Active persons
    const active = this._state.persons.filter(p => p.active !== false);

    if (active.length === 0) {
      scroll.appendChild(el("div", { style: { textAlign: "center", color: "var(--muted)", padding: "40px 0" } },
        el("div", { style: { fontSize: "40px", marginBottom: "12px" } }, "🩺"),
        el("div", {}, "No people added yet."),
        el("div", { style: { fontSize: "12px", marginTop: "6px" } }, "Click ⚙ Manage to add a person."),
      ));
    } else {
      scroll.appendChild(el("div", { className: "section-label", style: { marginBottom: "4px" } }, "Family members"));
      for (const [i, person] of active.entries()) {
        scroll.appendChild(this._renderPersonCard(person, i));
      }
    }

    scroll.appendChild(el("button", { className: "dashed-btn", onClick: () => this._openAdmin() }, "+ Add person"));
    scroll.appendChild(this._renderQuickInput());

    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%" } }, topbar, scroll);
  }

  _renderPersonCard(person, idx) {
    const tempData = this._latestSensor(person, "temperature");
    const temp = tempData?.value;
    const sc = statusColor(temp);
    const age = calcAge(person.birth_date);
    const subParts = [age ? `${age} yrs` : null, person.gender ? GENDER_LABELS[person.gender] : null].filter(Boolean);

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
          el("div", { className: "temp-time" }, tempData ? `${fmtTs(tempData.timestamp, this._hass)}` : ""),
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
      wrapper.appendChild(el("div", { className: "card-title" }, "⚡ Quick entry"));

      // Type chips
      const typeChips = el("div", { className: "chip-row", style: { marginBottom: "10px" } });
      const skipInQuick = new Set(["height", "bmi", "spo2"]);
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
      let row;
      if (activeType === "blood_pressure") {
        const sysInput = el("input", { className: "field", placeholder: "Sys (mmHg)", type: "number", step: "1" });
        const diaInput = el("input", { className: "field", placeholder: "Dia (mmHg)", type: "number", step: "1" });
        row = el("div", { style: { display: "flex", gap: "8px" } }, sysInput, diaInput,
          el("button", { className: "btn btn-primary", style: { width: "auto", padding: "10px 18px" },
            onClick: async () => {
              const sys = parseFloat(sysInput.value);
              const dia = parseFloat(diaInput.value);
              if (!sys || !dia || !activePerson) return;
              await this._callService("log_measurement", {
                person_id: activePerson, type: "blood_pressure",
                value: sys, value2: dia, unit: "mmHg",
              });
              sysInput.value = ""; diaInput.value = "";
              this._showToast("Blood pressure saved ✓");
            }
          }, "Save")
        );
      } else {
        const unit = displayUnit(activeType);
        const input = el("input", { className: "field", placeholder: `Value (${unit})`, type: "number", step: "0.1" });
        row = el("div", { style: { display: "flex", gap: "8px" } }, input,
          el("button", { className: "btn btn-primary", style: { width: "auto", padding: "10px 18px" },
            onClick: async () => {
              const displayVal = parseFloat(input.value);
              if (!displayVal || !activePerson) return;
              const metricVal = fromDisplay(activeType, displayVal);
              await this._callService("log_measurement", {
                person_id: activePerson, type: activeType,
                value: metricVal, unit: info.unit,
              });
              input.value = "";
              this._showToast(`${info.label} saved ✓`);
            }
          }, "Save")
        );
      }
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
          [age ? `${age} yrs` : null, person.gender ? GENDER_LABELS[person.gender] : null].filter(Boolean).join(" · ") || "—"
        ),
      ),
      el("div", { style: { marginLeft: "auto", textAlign: "right" } },
        el("div", { style: { fontSize: "26px", fontWeight: 800, color: sc, lineHeight: 1 } },
          temp ? `${toDisplay('temperature', temp)}${displayUnit('temperature')}` : "—"
        ),
        el("div", { className: "status-pill", style: { background: `${sc}20`, color: sc, marginTop: "4px" } },
          statusLabel(temp)
        ),
      ),
    );

    const tabs = [
      { id: "overview",   label: "📊 Overview" },
      { id: "temp",       label: "🌡 Temp" },
      { id: "body",       label: "⚖️ Body" },
      { id: "vital",      label: "💉 Vitals" },
      { id: "medication", label: "💊 Medication" },
      { id: "wellbeing",  label: "🌿 Wellbeing" },
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
      { mtype: "temperature", label: "Temp", fmt: v => `${toDisplay('temperature', v)}°`, color: statusColor(this._latestSensor(person, "temperature")?.value) },
      { mtype: "pulse",       label: "Pulse", fmt: v => `${v}`, color: "var(--teal)" },
      { mtype: "spo2",        label: "SpO2", fmt: v => `${v}%`, color: "var(--green)" },
    ];

    const statGrid = el("div", { className: "stat-grid stat-grid-3" });
    for (const s of stats) {
      const d = this._latestSensor(person, s.mtype);
      statGrid.appendChild(el("div", { className: "stat-card" },
        el("div", { className: "stat-label" }, s.label),
        el("div", { className: "stat-value", style: { color: d ? s.color : "var(--muted)" } }, d ? s.fmt(d.value) : "—"),
        el("div", { className: "stat-unit" }, d ? `${fmtTs(d.timestamp, this._hass)}` : "no data"),
      ));
    }
    frag.appendChild(statGrid);

    // Temperature chart
    const chartCard = el("div", { className: "card" },
      el("div", { className: "card-title" }, "🌡 Temperature — 24 h", this._labelToggle()),
      el("div", { id: "chart-overview", style: { minHeight: "180px" } }),
    );
    frag.appendChild(chartCard);

    // Recent medications
    const meds = (person.medications || [])
      .slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 4);

    const medCard = el("div", { className: "card" },
      el("div", { className: "card-title" }, "💊 Recent medication"),
      meds.length === 0
        ? el("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "No medication logged yet.")
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
      el("div", { className: "card-title" }, "🌡 Temperature and medication", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["24h", "7d", "30d"].map(r =>
          el("button", { className: `chip${this._state.tempRange === r ? " active" : ""}`,
            onClick: () => { this._state.tempRange = r; this._render(); }
          }, r === "24h" ? "24 h" : r === "7d" ? "7 days" : "30 days")
        )
      ),
      el("div", { id: "chart-temp", style: { minHeight: "200px" } }),
    );
    frag.appendChild(chartCard);

    // Input form
    frag.appendChild(this._measurementForm(person, "temperature", `Temperature (${displayUnit('temperature')})`, isImperial() ? "99.0" : "37.8", "0.1"));

    return frag;
  }

  // ── TAB: Body metrics ─────────────────────────────────────────────────────

  _tab_body(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    // Stats
    const bodyMetrics = [
      { mtype: "weight",        label: "Weight",        color: "var(--teal)",   fmt: v => `${toDisplay('weight', v)} ${displayUnit('weight')}` },
      { mtype: "height",        label: "Height",        color: "var(--blue)",   fmt: v => `${toDisplay('height', v)} ${displayUnit('height')}` },
      { mtype: "bmi",           label: "BMI",           color: "var(--yellow)", fmt: v => `${v}` },
      { mtype: "waist",         label: "Waist",         color: "var(--teal)",   fmt: v => `${toDisplay('waist', v)} ${displayUnit('waist')}` },
      { mtype: "blood_glucose", label: "Blood glucose", color: "var(--red)",    fmt: v => `${toDisplay('blood_glucose', v)} ${displayUnit('blood_glucose')}` },
    ];

    const grid = el("div", { className: "stat-grid", style: { gridTemplateColumns: "repeat(2, 1fr)" } });
    for (const m of bodyMetrics) {
      const d = this._latestSensor(person, m.mtype);
      grid.appendChild(el("div", { className: "stat-card" },
        el("div", { className: "stat-label" }, m.label),
        el("div", { className: "stat-value", style: { color: d ? m.color : "var(--muted)", fontSize: "18px" } },
          d ? m.fmt(d.value) : "—"
        ),
        el("div", { className: "stat-unit" }, d ? fmtDate(d.timestamp, this._hass) : "no data"),
      ));
    }
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "⚖️ Body metrics"),
      grid,
    ));

    // BMI chart
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "📈 Weight — trend", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["30d", "90d", "365d"].map(r =>
          el("button", { className: `chip${this._state.chartRanges.body === r ? " active" : ""}`,
            onClick: () => { this._state.chartRanges.body = r; this._render(); }
          }, r === "30d" ? "30 days" : r === "90d" ? "90 days" : "1 year")
        )
      ),
      el("div", { id: "chart-weight", style: { minHeight: "160px" } }),
    ));

    // Input forms
    const lastW  = this._latestSensor(person, "weight")?.value;
    const lastH  = this._latestSensor(person, "height")?.value;
    const lastWa = this._latestSensor(person, "waist")?.value;
    const lastBg = this._latestSensor(person, "blood_glucose")?.value;
    const wIn   = el("input", { className: "field", placeholder: isImperial() ? "155" : "70.5", type: "number", step: "0.1", value: lastW  != null ? toDisplay('weight', lastW) : "" });
    const hIn   = el("input", { className: "field", placeholder: isImperial() ? "69"  : "175",  type: "number", step: "0.5", value: lastH  != null ? toDisplay('height', lastH) : "" });
    const waIn  = el("input", { className: "field", placeholder: isImperial() ? "31"  : "80",   type: "number", step: "0.5", value: lastWa != null ? toDisplay('waist', lastWa) : "" });
    const bgIn  = el("input", { className: "field", placeholder: isImperial() ? "99"  : "5.5",  type: "number", step: "0.1", value: lastBg != null ? toDisplay('blood_glucose', lastBg) : "" });
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Log body metrics"),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, `Weight (${displayUnit('weight')})`), wIn),
        el("div", {}, el("label", { className: "form-label" }, `Height (${displayUnit('height')})`), hIn),
      ),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, `Waist (${displayUnit('waist')})`), waIn),
        el("div", {}, el("label", { className: "form-label" }, `Blood glucose (${displayUnit('blood_glucose')})`), bgIn),
      ),
      this._autoBMINote(person),
      el("button", { className: "btn btn-primary", style: { marginTop: "10px" },
        onClick: async () => {
          const wMetric  = fromDisplay('weight',        parseFloat(wIn.value)  || 0);
          const hMetric  = fromDisplay('height',        parseFloat(hIn.value)  || 0);
          const waMetric = fromDisplay('waist',         parseFloat(waIn.value) || 0);
          const bgMetric = fromDisplay('blood_glucose', parseFloat(bgIn.value) || 0);
          let saved = false;
          if (wMetric)  { await this._callService("log_measurement", { person_id: person.id, type: "weight",       value: wMetric,  unit: "kg" });      saved = true; }
          if (hMetric)  { await this._callService("log_measurement", { person_id: person.id, type: "height",       value: hMetric,  unit: "cm" });      saved = true; }
          if (waMetric) { await this._callService("log_measurement", { person_id: person.id, type: "waist",        value: waMetric, unit: "cm" });      saved = true; }
          if (bgMetric) { await this._callService("log_measurement", { person_id: person.id, type: "blood_glucose",value: bgMetric, unit: "mmol/L" }); saved = true; }
          // Use the freshly-entered values for BMI — don't rely on sensors which haven't updated yet
          const wForBMI = wMetric || this._latestSensor(person, "weight")?.value;
          const hForBMI = hMetric || this._latestSensor(person, "height")?.value;
          if (wForBMI && hForBMI) await this._tryAutoCalcBMI(person, wForBMI, hForBMI);
          if (saved) {
            wIn.value = ""; hIn.value = ""; waIn.value = ""; bgIn.value = "";
            this._showToast("Body metrics saved ✓");
          }
        }
      }, "Save measurements"),
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
          // Auto-calculate BMI — use the freshly-entered value, fall back to sensor for the other
          if (mtype === "weight" || mtype === "height") {
            const wVal = mtype === "weight" ? val : this._latestSensor(person, "weight")?.value;
            const hVal = mtype === "height" ? val : this._latestSensor(person, "height")?.value;
            await this._tryAutoCalcBMI(person, wVal, hVal);
          }
          input.value = "";
          this._showToast(`${label} saved ✓`);
        }
      }, "Save"),
    );
    return wrap;
  }

  async _tryAutoCalcBMI(person, weightKg, heightCm) {
    const bmi = calcBMI(weightKg, heightCm);
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
      "BMI is calculated automatically when weight and height are entered.");
    return el("div", { style: { fontSize: "12px", color: "var(--teal)", marginTop: "4px" } },
      `📊 Calculated BMI: ${bmi} kg/m²`);
  }

  // ── TAB: Vital signs ─────────────────────────────────────────────────────

  _tab_vital(person) {
    const frag = el("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });

    const vitalMetrics = [
      { mtype: "blood_pressure", label: "BP systolic", color: "var(--red)" },
      { mtype: "pulse",          label: "Pulse",          color: "var(--teal)" },
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
        el("div", { className: "stat-unit" }, d ? fmtTs(d.timestamp, this._hass) : "no data"),
      ));
    }
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "💉 Vital signs"),
      grid,
    ));

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "📈 Blood pressure & pulse — trend", this._labelToggle()),
      el("div", { className: "chip-row", style: { marginBottom: "12px" } },
        ...["30d", "90d", "365d"].map(r =>
          el("button", { className: `chip${this._state.chartRanges.vital === r ? " active" : ""}`,
            onClick: () => { this._state.chartRanges.vital = r; this._render(); }
          }, r === "30d" ? "30 days" : r === "90d" ? "90 days" : "1 year")
        )
      ),
      el("div", { id: "chart-vital", style: { minHeight: "180px" } }),
    ));

    // Input
    const lastBP  = this._latestSensor(person, "blood_pressure");
    const lastPuls = this._latestSensor(person, "pulse");
    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Log vitals"),
      el("div", { className: "form-row form-row-3", style: { marginBottom: "12px" } },
        this._numericGroup("Systolic", "bp-sys", "120", lastBP?.value ?? ""),
        this._numericGroup("Diastolic", "bp-dia", "80",  lastBP?.diastolic ?? ""),
        this._numericGroup("Pulse",        "bp-puls", "72", lastPuls?.value ?? ""),
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
              person_id: person.id, type: "pulse", value: puls, unit: "bpm",
            });
          }
          this._showToast("Blood pressure & pulse saved ✓");
        }
      }, "Save BP & pulse"),
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
      el("option", { value: "__new__" }, "+ Enter new medication…"),
    );
    const medCustom = el("input", { className: "field", placeholder: "Medication name", style: { display: "none" } });
    medSelect.addEventListener("change", () => {
      medCustom.style.display = medSelect.value === "__new__" ? "block" : "none";
    });

    const doseInput = el("input", { className: "field", placeholder: "500", type: "number" });
    const doseError = el("div", { style: { color: "var(--red)", fontSize: "12px", marginTop: "4px", display: "none" } }, "Ange en siffra eller lämna tomt (loggas utan dos)");
    const doseUnit = el("select", { className: "field" },
      ...["mg", "ml", "tablet", "puff", "drop", "g"].map(u => el("option", { value: u }, u))
    );
    const routeSelect = el("select", { className: "field",
      onChange: e => { selectedRoute = e.target.value; }
    },
      ...ROUTES.map(r => el("option", { value: r.value }, r.label))
    );
    const noteInput = el("input", { className: "field", placeholder: "Note (optional)" });
    const timeInput = this._makeTimeInput();

    // Skipped-dose toggle
    const skipTrack = el("div", { className: "lbl-tog-track", style: { cursor: "pointer" } },
      el("div", { className: "lbl-tog-knob" })
    );
    const skipToggle = el("label", { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" } },
      skipTrack,
      el("span", { style: { fontSize: "13px", color: "var(--muted)" } }, "Skipped dose"),
    );
    skipTrack.addEventListener("click", () => {
      isSkipped = !isSkipped;
      skipTrack.classList.toggle("on", isSkipped);
      skipTrack.nextElementSibling.style.color = isSkipped ? "var(--red)" : "var(--muted)";
    });

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "Log medication"),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Medication"), medSelect, medCustom),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, "Dose"), doseInput, doseError),
        el("div", {}, el("label", { className: "form-label" }, "Unit"), doseUnit),
      ),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Method"), routeSelect),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "10px" } },
        el("div", {}, el("label", { className: "form-label" }, "Time"), timeInput),
        el("div", {}, el("label", { className: "form-label" }, "Note"), noteInput),
      ),
      el("div", { style: { marginBottom: "12px" } }, skipToggle),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const name = medSelect.value === "__new__" ? medCustom.value.trim() : medSelect.value;
          if (!name) return;

          // Validate dose: empty = OK (sent as null); non-numeric = blocked with inline error
          const rawDose = doseInput.value.trim();
          const parsedDose = rawDose === "" ? null : parseFloat(rawDose);
          if (rawDose !== "" && isNaN(parsedDose)) {
            doseError.style.display = "block";
            doseInput.focus();
            return;
          }
          doseError.style.display = "none";

          const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
          const ts = `${today}T${timeInput.getValue()}:00`;
          await this._callService("log_medication", {
            person_id: person.id,
            medication: name,
            dose: parsedDose,
            dose_unit: doseUnit.value,
            route: routeSelect.value,
            timestamp: ts,
            skipped: isSkipped,
            note: noteInput.value,
          });
          this._showToast(isSkipped ? "Skipped dose logged ✓" : "Medication logged ✓");
          if (!isSkipped) {
            this._afterDoseLogged(person.id, name);
          }
        }
      }, "💊 Log dose"),
    ));

    // Reminders section (schedules + today's upcoming doses)
    const schedules = this._state.schedulesByPerson[person.id];
    if (schedules === undefined) {
      // Trigger async load on first render of this tab
      this._refreshSchedules(person.id);
    }
    frag.appendChild(this._renderRemindersSection(person, schedules || {}));

    // History
    const meds = (person.medications || [])
      .slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    frag.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, `History (${meds.length} entries)`),
      meds.length === 0
        ? el("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "No medication logged.")
        : el("div", {}, ...meds.slice(0, 20).map(m => {
            const isPending = this._state.deleteConfirmEntryId === m.id;
            return el("div", { className: "entry-item" },
              el("div", { className: "entry-icon" }, m.skipped ? "🚫" : "💊"),
              el("div", { style: { flex: 1 } },
                el("div", { className: "entry-name", style: { textDecoration: m.skipped ? "line-through" : "none" } }, m.name),
                el("div", { className: "entry-sub" }, `${m.dose || ""} ${m.unit || ""} · ${ROUTES.find(r => r.value === m.route)?.label || m.route}`.trim()),
              ),
              isPending
                ? el("div", { style: { display: "flex", gap: "6px", alignItems: "center", marginLeft: "auto" } },
                    el("span", { style: { fontSize: "11px", color: "var(--red)" } }, "Delete?"),
                    el("button", { className: "btn", style: { background: "var(--red)", color: "white", padding: "4px 10px", fontSize: "12px" },
                      onClick: async () => {
                        this._state.deleteConfirmEntryId = null;
                        await this._callService("delete_entry", { person_id: person.id, entry_id: m.id });
                        this._showToast("Entry deleted");
                      }
                    }, "Yes"),
                    el("button", { className: "btn btn-ghost", style: { padding: "4px 10px", fontSize: "12px" },
                      onClick: () => { this._state.deleteConfirmEntryId = null; this._render(); }
                    }, "No"),
                  )
                : el("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" } },
                    el("div", { className: "entry-time" }, fmtTs(m.timestamp, this._hass)),
                    el("button", { className: "btn-icon btn-danger",
                      onClick: () => { this._state.deleteConfirmEntryId = m.id; this._render(); }
                    }, "🗑"),
                  ),
            );
          }))
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
      ["Paracetamol 500mg", "Paracetamol 1g", "Ibuprofen 400mg", "Nasal spray"].forEach(n => names.add(n));
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
      el("div", { className: "card-title" }, "🌿 Wellbeing — log"),
    );

    // Pain scale
    const painLabel = el("label", { className: "form-label" }, "Pain level (NRS 0–10)");
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
    const moods = [["😴","Exhausted"],["😔","Tired"],["😐","Ok"],["🙂","Better"],["😊","Good"]];
    const moodLabel = el("label", { className: "form-label" }, "Mood / energy");
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
    const tagLabel = el("label", { className: "form-label" }, "Symptoms");
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

    const noteInput = el("input", { className: "field", placeholder: "Other symptoms (free text)…", style: { marginTop: "4px" } });

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
        this._showToast("Wellbeing saved ✓");
        selectedPain = null; selectedMood = null; selectedTags = new Set();
        renderPain(); renderMoods(); renderTags();
      }
    }, "Save wellbeing"));

    frag.appendChild(card);

    // Wellbeing chart
    const recent = (person.wellbeing || []).slice(-14).reverse();
    if (recent.length > 0) {
      frag.appendChild(el("div", { className: "card" },
        el("div", { className: "card-title" }, "📊 Pain & mood", this._labelToggle()),
        el("div", { className: "chip-row", style: { marginBottom: "12px" } },
          ...["30d", "90d", "365d"].map(r =>
            el("button", { className: `chip${this._state.chartRanges.wellbeing === r ? " active" : ""}`,
              onClick: () => { this._state.chartRanges.wellbeing = r; this._render(); }
            }, r === "30d" ? "30 days" : r === "90d" ? "90 days" : "1 year")
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
        el("div", { className: "sj-title" }, "⚙ Manage people"),
        el("div", { className: "sj-subtitle" }, `${this._state.persons.length} people`),
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
            person.name + (isInactive ? " (inactive)" : "")
          ),
          el("div", { className: "person-row-sub" },
            [age ? `${age} yrs` : null, person.gender ? GENDER_LABELS[person.gender] : null,
             person.birth_date || null].filter(Boolean).join(" · ") || "—"
          ),
        ),
        isInactive
          ? el("button", { className: "btn-icon", style: { color: "var(--green)", fontSize: "14px", marginRight: "4px" },
              title: "Reactivate person",
              onClick: async () => {
                await this._hass.callService(DOMAIN, "activate_person", { person_id: person.id });
                this._showToast(`${person.name} reactivated`);
                setTimeout(() => this._loadPersons(), 1500);
              }
            }, "↩")
          : el("button", { className: "btn-icon", style: { color: "var(--red)", fontSize: "16px", marginRight: "4px" },
              title: "Delete person",
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
          `🗑 Delete ${p?.name || "person"}?`
        ),
        el("p", { style: { color: "var(--muted)", fontSize: "13px", marginBottom: "14px" } },
          "Choose whether to delete the person and all history, or just deactivate them and keep their history."
        ),
        el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          el("button", {
            className: "btn",
            style: { background: "var(--red)", color: "white", flex: "1 1 120px" },
            onClick: async () => {
              const pid = this._state.deleteConfirmPersonId;
              this._state.deleteConfirmPersonId = null;
              await this._hass.callService(DOMAIN, "delete_person", { person_id: pid, keep_history: false });
              this._showToast("Person and history deleted");
              setTimeout(() => this._loadPersons(), 1500);
            }
          }, "Delete all"),
          el("button", {
            className: "btn",
            style: { background: "var(--yellow)", color: "#1a1a1a", flex: "1 1 120px" },
            onClick: async () => {
              const pid = this._state.deleteConfirmPersonId;
              this._state.deleteConfirmPersonId = null;
              await this._hass.callService(DOMAIN, "delete_person", { person_id: pid, keep_history: true });
              this._showToast("Person deactivated — history kept");
              setTimeout(() => this._loadPersons(), 1500);
            }
          }, "Keep history"),
          el("button", { className: "btn btn-ghost", style: { flex: "1 1 80px" }, onClick: cancel }, "Cancel"),
        ),
      ));
    }

    // Add new person form
    const nameIn = el("input", { className: "field", placeholder: "Name" });
    const bdIn   = el("input", { className: "field", type: "date" });
    const genderSel = el("select", { className: "field" },
      el("option", { value: "" }, "Gender (optional)"),
      el("option", { value: "male" }, "Male"),
      el("option", { value: "female" }, "Female"),
      el("option", { value: "other" }, "Other"),
    );

    scroll.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "➕ Add person"),
      el("div", { className: "form-group" }, el("label", { className: "form-label" }, "Name *"), nameIn),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "12px" } },
        el("div", {}, el("label", { className: "form-label" }, "Date of birth"), bdIn),
        el("div", {}, el("label", { className: "form-label" }, "Gender"), genderSel),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const name = nameIn.value.trim();
          if (!name) { this._showToast("Enter a name", true); return; }
          await this._callService("add_person", {
            name,
            birth_date: bdIn.value || undefined,
            gender: genderSel.value || undefined,
          });
          nameIn.value = ""; bdIn.value = ""; genderSel.value = "";
          this._showToast(`${name} added ✓`);
        }
      }, "Save person"),
    ));

    // Unit system toggle
    scroll.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "⚙️ Units"),
      el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } },
        el("span", { style: { fontSize: "13px", color: isImperial() ? "var(--muted)" : "var(--text)" } }, "Metric"),
        el("div", { className: `lbl-tog-track${isImperial() ? " on" : ""}`, style: { cursor: "pointer" },
          onClick: () => {
            localStorage.setItem('homesick_units', isImperial() ? 'metric' : 'imperial');
            this._render();
          }
        }, el("div", { className: "lbl-tog-knob" })),
        el("span", { style: { fontSize: "13px", color: isImperial() ? "var(--text)" : "var(--muted)" } }, "Imperial"),
      ),
    ));

    // Reminder masterswitch
    const masterEnabled = this._state.remindersEnabled;
    const remTrack = el("div", { className: `lbl-tog-track${masterEnabled ? " on" : ""}`, style: { cursor: "pointer" },
      onClick: () => {
        const newVal = !this._state.remindersEnabled;
        this._state.remindersEnabled = newVal;
        this._callService("set_reminders_enabled", { enabled: newVal });
        this._showToast(newVal ? "Påminnelser AKTIVERADE" : "Påminnelser AVAKTIVERADE");
        this._render();
      }
    }, el("div", { className: "lbl-tog-knob" }));
    scroll.appendChild(el("div", { className: "card" },
      el("div", { className: "card-title" }, "⏰ Medicinpåminnelser"),
      el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } },
        el("span", { style: { fontSize: "13px", color: masterEnabled ? "var(--muted)" : "var(--text)" } }, "Av"),
        remTrack,
        el("span", { style: { fontSize: "13px", color: masterEnabled ? "var(--text)" : "var(--muted)" } }, "På"),
      ),
      el("div", { style: { fontSize: "12px", color: "var(--muted)", marginTop: "8px" } },
        "Stänger av alla notifieringar utan att radera scheman."),
    ));

    return el("div", { style: { display: "flex", flexDirection: "column", height: "100%" } }, topbar, scroll);
  }

  // ── Label toggle helper ───────────────────────────────────────────────────

  _labelToggle() {
    return el("div", { className: "lbl-tog",
      onClick: () => { this._state.showLabels = !this._state.showLabels; this._render(); }
    },
      el("span", { className: "lbl-tog-label" }, "Labels"),
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
    const info = MTYPE_LABELS[mtype];
    const input = el("input", { className: "field", placeholder, type: "number", step });
    const timeInput = this._makeTimeInput();

    return el("div", { className: "card" },
      el("div", { className: "card-title" }, `Log ${info.label.toLowerCase()}`),
      el("div", { className: "form-row form-row-2", style: { marginBottom: "12px" } },
        el("div", {}, el("label", { className: "form-label" }, label), input),
        el("div", {}, el("label", { className: "form-label" }, "Time"), timeInput),
      ),
      el("button", { className: "btn btn-primary",
        onClick: async () => {
          const displayVal = parseFloat(input.value);
          if (!displayVal) return;
          const metricVal = fromDisplay(mtype, displayVal);
          const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
          const ts = `${today}T${timeInput.getValue()}:00`;
          await this._callService("log_measurement", {
            person_id: person.id, type: mtype, value: metricVal, unit: info.unit, timestamp: ts,
          });
          input.value = "";
          this._showToast(`${info.label} saved ✓`);
        }
      }, `Save ${info.label.toLowerCase()}`),
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
    const slug = slugify(person.name);
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
          label: { text: "38° Fever", style: { background: "transparent", color: "#F56565", fontSize: "10px" } } }],
        xaxis: meds.map(m => ({
          x: toChartMs(m.timestamp),
          borderColor: "#17B8A6", strokeDashArray: 4, borderWidth: 1.5,
          label: { text: this._state.showLabels ? `💊 ${m.name}` : "💊", position: "bottom",
            style: { background: "#1C2733", color: "#17B8A6", fontSize: "9px" } },
        })),
      };

      const imp = isImperial();
      const dispSeries = convertSeries('temperature', series);
      const chartId = tab === "overview" ? "chart-overview" : "chart-temp";
      await this._renderChart(chartId, {
        ...apexDefaults(tab === "temp" ? 200 : 170),
        chart: { ...apexDefaults().chart, type: "area", height: tab === "temp" ? 200 : 170 },
        series: [{ name: imp ? "Temperature °F" : "Temperature °C", data: dispSeries.length > 0 ? dispSeries : [] }],
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
        annotations: imp ? {
          ...annotations,
          yaxis: [
            { y: 100.4, borderColor: "#F56565", strokeDashArray: 5, borderWidth: 1.5 },
            { y: 99.1,  borderColor: "#ECC94B", strokeDashArray: 5, borderWidth: 1 },
          ],
        } : annotations,
        xaxis: { ...apexDefaults().xaxis, type: "datetime",
          labels: { ...apexDefaults().xaxis.labels, datetimeFormatter: { hour: this._apexTimeFormat() } } },
        yaxis: { ...apexDefaults().yaxis,
          min: imp ? 96 : 35.5, max: imp ? 105 : 40.5, tickAmount: 5,
          labels: { ...apexDefaults().yaxis.labels, formatter: v => v.toFixed(1) + "°" } },
        tooltip: { x: { format: this._apexTimeFormat() }, y: { formatter: v => v.toFixed(1) + (imp ? " °F" : " °C") } },
        noData: { text: "No history yet", style: { color: "#6B8599" } },
      });
    }

    if (tab === "body") {
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRanges.body] ?? 24 * 90;
      const wSeries = convertSeries('weight', this._measurementSeries(person, "weight", chartHours));
      const wUnit = displayUnit('weight');
      await this._renderChart("chart-weight", {
        ...apexDefaults(160),
        chart: { ...apexDefaults().chart, type: "line", height: 160 },
        series: [{ name: `Weight ${wUnit}`, data: wSeries }],
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
          labels: { ...apexDefaults().yaxis.labels, formatter: v => v.toFixed(1) + ` ${wUnit}` } },
        noData: { text: "No history yet", style: { color: "#6B8599" } },
      });
    }

    if (tab === "vital") {
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRanges.vital] ?? 24 * 30;
      const sysSeries  = this._measurementSeries(person, "blood_pressure", chartHours);
      const diaSeries  = this._measurementSeries(person, "blood_pressure", chartHours, true);
      const pulsSeries = this._measurementSeries(person, "pulse", chartHours);
      await this._renderChart("chart-vital", {
        ...apexDefaults(180),
        chart: { ...apexDefaults().chart, type: "line", height: 180 },
        series: [
          { name: "Systolic", data: sysSeries },
          { name: "Diastolic", data: diaSeries },
          { name: "Pulse", data: pulsSeries },
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
        noData: { text: "No history yet", style: { color: "#6B8599" } },
      });
    }

    if (tab === "wellbeing") {
      const person2 = this._getPerson(this._state.personId);
      const chartHours = { "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this._state.chartRanges.wellbeing] ?? 24 * 30;
      const cutoff = Date.now() - chartHours * 3600 * 1000;
      const wb = (person2?.wellbeing || [])
        .filter(w => new Date(w.timestamp).getTime() >= cutoff)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (wb.length > 0) {
        await this._renderChart("chart-wellbeing", {
          ...apexDefaults(160),
          chart: { ...apexDefaults().chart, type: "bar", height: 160 },
          series: [
            { name: "Pain", data: wb.map(w => w.pain ?? 0) },
            { name: "Mood", data: wb.map(w => w.mood ?? 0) },
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

customElements.define("homesick-card", HomeSickCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "homesick-card",
  name: "HomeSick",
  description: "Family health journal",
  preview: true,
});
