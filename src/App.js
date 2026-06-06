import { useState, useEffect, useMemo, useRef } from "react";

// ─── Storage ──────────────────────────────────────────────────────────────────
// ─── Supabase Config ──────────────────────────────────────────────────────────
const SUPA_URL = "https://rgxcgpdpdkiztywgjdaz.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJneGNncGRwZGtpenR5d2dqZGF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzUxMzMsImV4cCI6MjA5NjMxMTEzM30.lYSMK9LDCeEsEEn68tdMdO1wOL0xbmi5KoPDodjnxm8";
const HEADERS = { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Prefer": "return=representation" };

// Table name map — localStorage key → Supabase table
const TABLE_MAP = {
  companies:   "companies",
  products:    "products",
  salespeople: "salespeople",
  pms:         "product_managers",
  users:       "users",
  session:     null, // session stays in localStorage
};

// Field name map — camelCase → snake_case for Supabase
function toRow(table, obj) {
  if (table === "product_managers") {
    return { id: obj.id, name: obj.name, email: obj.email, phone: obj.phone || "",
      company_id: obj.companyId || null, product_ids: obj.productIds || [],
      salesperson_ids: obj.salespersonIds || [], notes: obj.notes || "", multi_pm: obj.multiPM || false };
  }
  if (table === "companies") return { id: obj.id, name: obj.name, regions: obj.regions || [] };
  if (table === "products")  return { id: obj.id, make: obj.make, category: obj.category };
  if (table === "salespeople") return { id: obj.id, name: obj.name, email: obj.email, phone: obj.phone || "" };
  if (table === "users") return { id: obj.id, username: obj.username, password_hash: obj.passwordHash, role: obj.role, name: obj.name };
  return obj;
}

function fromRow(table, row) {
  if (table === "product_managers") {
    return { id: row.id, name: row.name, email: row.email, phone: row.phone || "",
      companyId: row.company_id, productIds: row.product_ids || [],
      salespersonIds: row.salesperson_ids || [], notes: row.notes || "", multiPM: row.multi_pm || false };
  }
  if (table === "users") return { id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, name: row.name };
  return row;
}

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: HEADERS, ...options });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// GET all rows for a key
async function dbGet(key) {
  if (key === "session") { try { const v = localStorage.getItem("session"); return v ? JSON.parse(v) : null; } catch { return null; } }
  const table = TABLE_MAP[key]; if (!table) return null;
  try {
    const rows = await supaFetch(`${table}?select=*`);
    return rows.map(r => fromRow(table, r));
  } catch { return null; }
}

// UPSERT full array for a key (replaces all)
async function dbSet(key, val) {
  if (key === "session") { try { localStorage.setItem("session", JSON.stringify(val)); } catch {} return; }
  const table = TABLE_MAP[key]; if (!table || !Array.isArray(val)) return;
  try {
    // Delete all then insert (simple full-replace strategy)
    await supaFetch(`${table}?id=neq.NONE`, { method: "DELETE" });
    if (val.length > 0) {
      const rows = val.map(obj => toRow(table, obj));
      await supaFetch(table, { method: "POST", body: JSON.stringify(rows),
        headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" } });
    }
  } catch(e) { console.error("dbSet error:", key, e); }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const REGIONS = ["NA", "EU", "MENA", "APAC", "AUS"];
const REGION_COLORS = { NA: "#1565C0", EU: "#0288D1", MENA: "#00796B", APAC: "#6A1B9A", AUS: "#AD1457" };
const REGION_LABELS = { NA: "North America", EU: "Europe", MENA: "Middle East & Africa", APAC: "Asia-Pacific", AUS: "Australia" };
const REGION_MAP = {
  "north america": "NA", "na": "NA", "usa": "NA", "us": "NA", "canada": "NA",
  "eu": "EU", "europe": "EU", "emea": "EU",
  "mena": "MENA", "middle east": "MENA", "africa": "MENA", "middle east & africa": "MENA",
  "apac": "APAC", "asia": "APAC", "asia-pacific": "APAC", "asia pacific": "APAC",
  "aus": "AUS", "australia": "AUS", "oceania": "AUS",
};
const ROLES = ["admin", "contributor", "viewer"];
const ROLE_COLORS = { admin: "#003087", contributor: "#0288D1", viewer: "#6B7A99" };
const ROLE_LABELS = { admin: "Admin", contributor: "Contributor", viewer: "Viewer" };

// Role permissions
const CAN = {
  viewDirectory:    ["admin", "contributor", "viewer"],
  viewCompanies:    ["admin", "contributor", "viewer"],
  viewProducts:     ["admin", "contributor"],
  viewManagers:     ["admin", "contributor", "viewer"],
  viewSalespeople:  ["admin"],
  viewSettings:     ["admin"],
  editProducts:     ["admin", "contributor"],
  editManagers:     ["admin", "contributor"],
  editCompanies:    ["admin", "contributor"],
  editSalespeople:  ["admin"],
  importExport:     ["admin"],
  manageUsers:      ["admin"],
};
const can = (role, action) => CAN[action]?.includes(role) ?? false;

function parseRegions(raw) {
  if (!raw) return [];
  const found = new Set();
  raw.split(/[;,]/).forEach(part => {
    const key = part.trim().toLowerCase();
    if (REGION_MAP[key]) found.add(REGION_MAP[key]);
    else REGIONS.forEach(r => { if (key.includes(r.toLowerCase())) found.add(r); });
  });
  return [...found];
}

function parseCSV(text) {
  const lines = [];
  let cur = "", inQ = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ""; }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (cur || row.length) { row.push(cur.trim()); lines.push(row); row = []; cur = ""; }
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else { cur += ch; }
  }
  if (cur || row.length) { row.push(cur.trim()); lines.push(row); }
  return lines;
}

const PRODUCT_CATEGORIES = [
  { keywords: ["ai", "hpc"],                        label: "AI & HPC" },
  { keywords: ["data center", "compute", "server"],  label: "Data Center & Servers" },
  { keywords: ["network"],                           label: "Networking" },
  { keywords: ["storage", "san", "tape"],            label: "Storage & SAN" },
  { keywords: ["component", "part", "optic"],        label: "Components & Optics" },
];

function csvRowsToEntries(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, " ").trim());
  const col = (keywords) => {
    for (const k of keywords) { const i = header.findIndex(h => h === k); if (i >= 0) return i; }
    for (const k of keywords) { const i = header.findIndex(h => h.includes(k)); if (i >= 0) return i; }
    return -1;
  };
  const iCompany   = col(["company name", "company"]);
  const iContact   = col(["contact person  full name ", "contact person", "full name"]);
  const iEmail     = col(["email address", "email"]);
  const iSourcing  = col(["sourcing location", "sourcing"]);
  const iWarehouse = col(["warehouse location", "warehouse"]);
  const iMultiPM   = col(["multiple product manager", "multiple pm"]);
  const iProductCols = PRODUCT_CATEGORIES.map((cat, catIdx) => {
    for (const k of cat.keywords) {
      const i = header.findIndex((h, hi) => hi >= 7 && h.includes(k));
      if (i >= 0) return i;
    }
    const fixedPos = 7 + catIdx;
    return fixedPos < header.length ? fixedPos : -1;
  });
  return rows.slice(1).map((row, idx) => {
    const get = (i) => (i >= 0 && i < row.length ? row[i] || "" : "");
    const name = get(iContact), email = get(iEmail), company = get(iCompany);
    const regions = parseRegions(get(iSourcing) || get(iWarehouse));
    const multiPM = get(iMultiPM).toLowerCase().includes("yes");
    const productLines = [];
    iProductCols.forEach((colIdx, catIdx) => {
      const raw = get(colIdx); if (!raw) return;
      const catLabel = PRODUCT_CATEGORIES[catIdx].label;
      raw.split(";").forEach(item => {
        const make = item.trim().replace(/[;,\.]+$/, "").trim();
        if (make.length > 1) productLines.push({ make, category: catLabel });
      });
    });
    const productNotes = productLines.map(p => p.make).join("; ");
    return { _rowIdx: idx + 2, name, email, company, regions, multiPM, productLines, productNotes };
  }).filter(e => e.name || e.email || e.company);
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function hashPw(pw) { let h = 0; for (let i = 0; i < pw.length; i++) { h = Math.imul(31, h) + pw.charCodeAt(i) | 0; } return h.toString(36); }

// ─── Seed Data ────────────────────────────────────────────────────────────────
const SEED_USERS = [
  { id: "u1", username: "admin",       passwordHash: hashPw("admin123"),  role: "admin",       name: "Administrator" },
  { id: "u2", username: "sarah",       passwordHash: hashPw("sarah123"),  role: "contributor", name: "Sarah Mitchell" },
  { id: "u3", username: "viewer1",     passwordHash: hashPw("view123"),   role: "viewer",      name: "John Viewer" },
];

const SEED_SALESPEOPLE = [
  { id: "sp1", name: "Alex Turner",    email: "alex.turner@erm.com",    phone: "+1 212-555-0101" },
  { id: "sp2", name: "Maria Santos",   email: "maria.santos@erm.com",   phone: "+44 20-7946-0102" },
  { id: "sp3", name: "James Okafor",   email: "james.okafor@erm.com",   phone: "+33 1-5555-0103" },
  { id: "sp4", name: "Priya Kapoor",   email: "priya.kapoor@erm.com",   phone: "+65 6555-0104" },
];

const SEED_COMPANIES = [
  { id: "co1", name: "DataTek Ltd",               regions: ["EU", "MENA"] },
  { id: "co2", name: "Trio Supply Chain",          regions: ["NA"] },
  { id: "co3", name: "Foxway Group",               regions: ["NA", "EU", "APAC", "MENA", "AUS"] },
  { id: "co4", name: "System Supply Industries",   regions: ["EU"] },
  { id: "co5", name: "Compuwyze LTD",              regions: ["NA", "EU", "APAC"] },
  { id: "co6", name: "Pacific IT Distributors",    regions: ["APAC", "AUS"] },
];

const SEED_PRODUCTS = [
  { id: "pr1",  make: "NVIDIA DGX / HGX Systems",           category: "AI & HPC" },
  { id: "pr2",  make: "Mellanox InfiniBand Fabrics",         category: "AI & HPC" },
  { id: "pr3",  make: "Supermicro GPU Servers",              category: "AI & HPC" },
  { id: "pr4",  make: "Dell EMC PowerEdge",                  category: "Data Center & Servers" },
  { id: "pr5",  make: "HPE ProLiant / Synergy",              category: "Data Center & Servers" },
  { id: "pr6",  make: "Lenovo ThinkSystem",                  category: "Data Center & Servers" },
  { id: "pr7",  make: "Cisco UCS",                           category: "Data Center & Servers" },
  { id: "pr8",  make: "Cisco Nexus / Catalyst",              category: "Networking" },
  { id: "pr9",  make: "Arista Networks",                     category: "Networking" },
  { id: "pr10", make: "Juniper Networks",                    category: "Networking" },
  { id: "pr11", make: "NetApp FAS / AFF",                    category: "Storage & SAN" },
  { id: "pr12", make: "Pure Storage FlashArray",             category: "Storage & SAN" },
  { id: "pr13", make: "Dell EMC PowerStore / Unity",         category: "Storage & SAN" },
  { id: "pr14", make: "Server CPUs (Intel Xeon / AMD EPYC)", category: "Components & Optics" },
  { id: "pr15", make: "Server RAM DDR4 / DDR5 ECC",          category: "Components & Optics" },
  { id: "pr16", make: "SFPs, Transceivers & Optics",         category: "Components & Optics" },
];

const SEED_PMS = [
  { id: "pm1",  name: "Dan Redfern",      email: "dan@datatek.co.uk",       phone: "+44 7700-900101", companyId: "co1", productIds: ["pr4","pr5","pr11","pr14","pr15"], salespersonIds: ["sp2"],         notes: "", multiPM: false },
  { id: "pm2",  name: "Jay Sheridan",     email: "jsheridan@trioscs.com",   phone: "+1 555-900102",   companyId: "co2", productIds: ["pr1","pr2","pr4","pr8","pr14"],   salespersonIds: ["sp1"],         notes: "", multiPM: false },
  { id: "pm3",  name: "Luke Ross",        email: "luke.ross@foxway.com",    phone: "+44 7700-900103", companyId: "co3", productIds: ["pr1","pr3","pr4","pr5","pr8"],    salespersonIds: ["sp2","sp3"],   notes: "", multiPM: true  },
  { id: "pm4",  name: "Estefania Mills",  email: "stef.mills@foxway.com",   phone: "+44 7700-900104", companyId: "co3", productIds: ["pr9","pr10","pr11","pr16"],       salespersonIds: ["sp2"],         notes: "", multiPM: true  },
  { id: "pm5",  name: "Joel Thompson",    email: "jt@systems2u.com",        phone: "+44 7700-900105", companyId: "co4", productIds: ["pr3","pr4","pr5","pr6","pr11"],   salespersonIds: ["sp3"],         notes: "", multiPM: false },
  { id: "pm6",  name: "Karen Yates",      email: "karen@systems2u.com",     phone: "+44 7700-900106", companyId: "co4", productIds: ["pr8","pr9","pr12","pr13"],        salespersonIds: ["sp3"],         notes: "", multiPM: true  },
  { id: "pm7",  name: "Jordan Nugent",    email: "sales@compuwyze.co.uk",   phone: "+44 7700-900107", companyId: "co5", productIds: ["pr1","pr4","pr9","pr14","pr15"],  salespersonIds: ["sp1","sp2"],   notes: "", multiPM: false },
  { id: "pm8",  name: "Yuki Tanaka",      email: "yuki@pacificit.com.au",   phone: "+61 2-5550-0108", companyId: "co6", productIds: ["pr4","pr5","pr7","pr11","pr16"],  salespersonIds: ["sp4"],         notes: "", multiPM: false },
  { id: "pm9",  name: "Chen Wei",         email: "chen.wei@pacificit.com",  phone: "+65 9555-0109",   companyId: "co6", productIds: ["pr1","pr3","pr12","pr14"],        salespersonIds: ["sp4"],         notes: "", multiPM: true  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#F0F4FB", fontFamily: "'Segoe UI','Helvetica Neue',Arial,sans-serif", color: "#1A2B4A" },
  sidebar: { width: 230, minHeight: "100vh", background: "linear-gradient(180deg,#001A5E 0%,#003087 100%)", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, zIndex: 10, boxShadow: "4px 0 16px rgba(0,48,135,0.18)" },
  sideHead: { padding: "24px 20px 18px", borderBottom: "1px solid rgba(255,255,255,0.1)" },
  sideTitle: { fontSize: 22, letterSpacing: 1, color: "#FFF", fontWeight: "800", margin: 0, lineHeight: 1 },
  sideSub: { fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 4, letterSpacing: 2, textTransform: "uppercase" },
  navBtn: (active) => ({ display: "flex", alignItems: "center", gap: 10, padding: "11px 20px", cursor: "pointer", background: active ? "rgba(255,255,255,0.12)" : "none", border: "none", color: active ? "#FFF" : "rgba(255,255,255,0.5)", fontSize: 13, width: "100%", textAlign: "left", borderLeft: active ? "3px solid #FFF" : "3px solid transparent", transition: "all 0.15s", fontFamily: "inherit", fontWeight: active ? "600" : "400" }),
  navSection: { padding: "10px 20px 4px", fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: 2 },
  main: { marginLeft: 230, padding: "36px 40px", minHeight: "100vh", background: "#F0F4FB" },
  pageHead: { marginBottom: 28, borderBottom: "2px solid #D0DAF0", paddingBottom: 20 },
  pageTitle: { fontSize: 22, color: "#003087", letterSpacing: 0.3, margin: 0, fontWeight: "700" },
  pageSub: { fontSize: 12, color: "#6B7A99", marginTop: 5 },
  btn: (variant = "primary") => ({ borderRadius: 5, padding: "9px 18px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: "600", letterSpacing: 0.3, background: variant === "primary" ? "#003087" : variant === "danger" ? "#C62828" : variant === "success" ? "#0D7A3E" : "#FFF", color: variant === "ghost" ? "#003087" : "#FFF", border: variant === "ghost" ? "1.5px solid #B0C0E0" : "none", boxShadow: variant === "primary" ? "0 2px 8px rgba(0,48,135,0.18)" : "none", transition: "all 0.15s" }),
  input: { background: "#FFF", border: "1.5px solid #C8D6EE", borderRadius: 5, padding: "9px 12px", color: "#1A2B4A", fontFamily: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box", outline: "none" },
  label: { display: "block", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "#6B7A99", marginBottom: 6, fontWeight: "600" },
  tag: (color = "#003087") => ({ background: color + "14", color, border: `1px solid ${color}40`, borderRadius: 3, padding: "2px 9px", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", display: "inline-block", marginRight: 4, marginBottom: 4, fontWeight: "600" }),
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#FFF" },
  th: { textAlign: "left", padding: "11px 14px", borderBottom: "2px solid #D0DAF0", color: "#003087", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: "700", background: "#F0F4FB" },
  td: { padding: "10px 14px", borderBottom: "1px solid #EBF0FB", color: "#3A4A6B", verticalAlign: "middle" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,24,72,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBox: { background: "#FFF", borderRadius: 10, padding: 32, width: 640, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,48,135,0.22)" },
  row: { display: "flex", gap: 12, marginBottom: 16 },
  formGroup: { flex: 1 },
  select: { background: "#FFF", border: "1.5px solid #C8D6EE", borderRadius: 5, padding: "9px 12px", color: "#1A2B4A", fontFamily: "inherit", fontSize: 13, cursor: "pointer", outline: "none" },
  toast: { position: "fixed", bottom: 24, right: 24, background: "#003087", color: "#FFF", borderRadius: 6, padding: "11px 20px", fontSize: 13, fontWeight: "600", boxShadow: "0 4px 18px rgba(0,48,135,0.3)", zIndex: 200 },
  card: { background: "#FFF", border: "1px solid #D0DAF0", borderRadius: 8, padding: "18px 20px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,48,135,0.06)" },
};

// ─── Shared components ────────────────────────────────────────────────────────
function CheckList({ items, selected, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map(item => {
        const active = selected.includes(item.id);
        return <button key={item.id} onClick={() => onChange(active ? selected.filter(x => x !== item.id) : [...selected, item.id])} style={{ padding: "6px 14px", borderRadius: 20, fontFamily: "inherit", border: `1.5px solid ${active ? "#003087" : "#C8D6EE"}`, background: active ? "#003087" : "#FFF", color: active ? "#FFF" : "#6B7A99", cursor: "pointer", fontSize: 12, fontWeight: "600", transition: "all 0.15s" }}>{item.label}</button>;
      })}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={S.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...S.modalBox, width: wide ? 740 : 520 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, borderBottom: "2px solid #E8F0FB", paddingBottom: 14 }}>
          <span style={{ fontSize: 15, color: "#003087", fontWeight: "700" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6B7A99", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  const submit = () => {
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.passwordHash === hashPw(password));
    if (user) { setError(""); onLogin(user); }
    else setError("Incorrect username or password.");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#001A5E 0%,#003087 60%,#0057B8 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI','Helvetica Neue',Arial,sans-serif" }}>
      <div style={{ width: 400, maxWidth: "90vw" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, background: "rgba(255,255,255,0.12)", borderRadius: 16, marginBottom: 16, border: "1px solid rgba(255,255,255,0.2)" }}>
            <span style={{ fontSize: 28, fontWeight: "900", color: "#FFF", letterSpacing: -1 }}>ERM</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: "800", color: "#FFF", letterSpacing: 1 }}>ERM</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 3, textTransform: "uppercase", marginTop: 4 }}>Enterprise Relationship Manager</div>
        </div>

        {/* Card */}
        <div style={{ background: "#FFF", borderRadius: 12, padding: "36px 32px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 16, fontWeight: "700", color: "#003087", marginBottom: 6 }}>Sign in to your account</div>
          <div style={{ fontSize: 12, color: "#6B7A99", marginBottom: 24 }}>Enter your credentials to continue</div>

          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Username</label>
            <input style={S.input} value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} placeholder="Enter username" autoFocus />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={S.label}>Password</label>
            <div style={{ position: "relative" }}>
              <input style={{ ...S.input, paddingRight: 44 }} type={showPw ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} placeholder="Enter password" />
              <button onClick={() => setShowPw(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6B7A99", fontSize: 13 }}>
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 6, padding: "9px 12px", fontSize: 12, color: "#C62828", marginBottom: 16 }}>⚠ {error}</div>}

          <button onClick={submit} style={{ ...S.btn(), width: "100%", padding: "12px", fontSize: 14, marginTop: 8 }}>
            Sign In
          </button>

          <div style={{ marginTop: 20, padding: "12px 14px", background: "#F0F4FB", borderRadius: 6, fontSize: 11, color: "#6B7A99" }}>
            <strong style={{ color: "#003087" }}>Default admin:</strong> username <code>admin</code> · password <code>admin123</code>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CSV IMPORT MODAL ─────────────────────────────────────────────────────────
function ImportModal({ onClose, onImport }) {
  const [entries, setEntries] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const fileRef = useRef();

  const processFile = (file) => {
    if (!file || !file.name.endsWith(".csv")) { setError("Please upload a .csv file."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        const parsed = csvRowsToEntries(rows);
        if (!parsed.length) { setError("No valid rows found."); return; }
        setEntries(parsed); setSelected(parsed.map((_, i) => i)); setError("");
      } catch (err) { setError("Could not parse: " + err.message); }
    };
    reader.readAsText(file);
  };

  const onDrop = (e) => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files[0]); };
  const toggleRow = (i) => setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  const toggleAll = () => setSelected(selected.length === entries.length ? [] : entries.map((_, i) => i));
  const doImport = () => { try { onImport(entries.filter((_, i) => selected.includes(i))); onClose(); } catch(err) { setError("Import failed: " + err.message); } };

  return (
    <Modal title="Import from Google Sheet CSV" onClose={onClose} wide>
      {!entries ? (
        <>
          <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileRef.current.click()}
            style={{ border: `2px dashed ${dragging ? "#003087" : "#C8D6EE"}`, borderRadius: 10, padding: "48px 24px", textAlign: "center", background: dragging ? "#E8F0FB" : "#F7FAFF", cursor: "pointer", marginBottom: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 15, color: "#003087", fontWeight: "700", marginBottom: 6 }}>Drop your CSV file here</div>
            <div style={{ fontSize: 12, color: "#6B7A99" }}>or click to browse · Export from Google Sheet as CSV</div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => processFile(e.target.files[0])} />
          </div>
          {error && <div style={{ color: "#C62828", fontSize: 13, padding: "10px 14px", background: "#FFF5F5", borderRadius: 6, border: "1px solid #FECACA" }}>⚠ {error}</div>}
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#003087", fontWeight: "600" }}>{entries.length} rows · {selected.length} selected</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 12px" }} onClick={toggleAll}>{selected.length === entries.length ? "Deselect All" : "Select All"}</button>
              <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 12px" }} onClick={() => { setEntries(null); setSelected([]); }}>← Change File</button>
            </div>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", borderRadius: 8, border: "1px solid #D0DAF0", marginBottom: 20 }}>
            <table style={{ ...S.table, fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0 }}>
                <tr>{["", "Company", "Contact Person", "Email", "Regions", "Multi-PM?", "Products Found"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const on = selected.includes(i);
                  return (
                    <tr key={i} style={{ background: on ? "#F0F7FF" : (i % 2 === 0 ? "#FFF" : "#F7FAFF"), cursor: "pointer" }} onClick={() => toggleRow(i)}>
                      <td style={{ ...S.td, textAlign: "center", padding: "10px 12px" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${on ? "#003087" : "#C8D6EE"}`, background: on ? "#003087" : "#FFF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {on && <span style={{ color: "#FFF", fontSize: 10 }}>✓</span>}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontWeight: "700", color: "#003087" }}>{e.company || "—"}</td>
                      <td style={S.td}>{e.name || "—"}</td>
                      <td style={{ ...S.td, fontSize: 11, color: "#0057B8" }}>{e.email}</td>
                      <td style={S.td}>{e.regions.length > 0 ? e.regions.map(r => <span key={r} style={S.tag(REGION_COLORS[r])}>{r}</span>) : <span style={{ color: "#C8D6EE" }}>—</span>}</td>
                      <td style={S.td}>{e.multiPM ? <span style={S.tag("#B45309")}>Multi-PM</span> : <span style={{ color: "#C8D6EE" }}>—</span>}</td>
                      <td style={{ ...S.td, fontSize: 11 }}>
                        {e.productLines && e.productLines.length > 0
                          ? <div><span style={{ fontWeight: "700", color: "#003087" }}>{e.productLines.length} lines</span>
                              {(() => { const cats = {}; e.productLines.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; }); return Object.entries(cats).map(([cat, n]) => <div key={cat} style={{ color: "#6B7A99", fontSize: 10 }}>{cat} ({n})</div>); })()}
                            </div>
                          : <span style={{ color: "#C8D6EE" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ background: "#FFF8E1", border: "1px solid #FDE68A", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#92400E", marginBottom: 20 }}>
            <strong>Merge mode:</strong> existing managers matched by email will be skipped.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.btn()} onClick={doImport} disabled={selected.length === 0}>↓ Import {selected.length} rows</button>
            <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState("directory");
  const [products, setProducts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [pms, setPms] = useState([]);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [editingPmFromDir, setEditingPmFromDir] = useState(null);
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await dbGet("products"); const c = await dbGet("companies");
      const m = await dbGet("pms"); const sp = await dbGet("salespeople");
      const u = await dbGet("users"); const sess = await dbGet("session");
      setProducts(p || SEED_PRODUCTS); setCompanies(c || SEED_COMPANIES);
      setPms(m || SEED_PMS); setSalespeople(sp || SEED_SALESPEOPLE);
      const loadedUsers = u || SEED_USERS;
      setUsers(loadedUsers);
      if (sess) {
        const sessionUser = loadedUsers.find(u => u.id === sess.userId);
        if (sessionUser) setCurrentUser(sessionUser);
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) dbSet("products", products); }, [products, loaded]);
  useEffect(() => { if (loaded) dbSet("companies", companies); }, [companies, loaded]);
  useEffect(() => { if (loaded) dbSet("pms", pms); }, [pms, loaded]);
  useEffect(() => { if (loaded) dbSet("salespeople", salespeople); }, [salespeople, loaded]);
  useEffect(() => { if (loaded) dbSet("users", users); }, [users, loaded]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const handleLogin = (user) => {
    setCurrentUser(user);
    dbSet("session", { userId: user.id });
    showToast(`Welcome, ${user.name || user.username}!`);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    dbSet("session", null);
    setTab("directory");
  };

  const handleImport = (entries) => {
    try {
    let newCo = 0, newPm = 0, newProd = 0, skipped = 0;
    const nextCompanies = [...companies], nextPms = [...pms], nextProducts = [...products];
    entries.forEach(e => {
      if (e.email && nextPms.find(pm => pm.email.toLowerCase() === e.email.toLowerCase())) { skipped++; return; }
      let company = nextCompanies.find(c => c.name.toLowerCase() === e.company.toLowerCase());
      if (!company && e.company) { company = { id: uid(), name: e.company, regions: e.regions }; nextCompanies.push(company); newCo++; }
      else if (company && e.regions.length > 0) {
        const merged = [...new Set([...(company.regions || []), ...e.regions])];
        const idx = nextCompanies.findIndex(c => c.id === company.id);
        nextCompanies[idx] = { ...company, regions: merged }; company = nextCompanies[idx];
      }
      const productIds = [];
      (e.productLines || []).forEach(({ make, category }) => {
        const key = make.toLowerCase().trim();
        let existing = nextProducts.find(p => p.make.toLowerCase().trim() === key);
        if (!existing) { existing = { id: uid(), make: make.trim(), category }; nextProducts.push(existing); newProd++; }
        if (!productIds.includes(existing.id)) productIds.push(existing.id);
      });
      nextPms.push({ id: uid(), name: e.name, email: e.email, phone: "", companyId: company?.id || "", productIds, salespersonIds: [], notes: e.productNotes || "", multiPM: e.multiPM });
      newPm++;
    });
    setProducts(nextProducts); setCompanies(nextCompanies); setPms(nextPms);
    showToast(`Imported · ${newPm} managers · ${newCo} companies · ${newProd} products · ${skipped} skipped`);
    } catch(err) { console.error("Import error:", err); alert("Import failed: " + err.message); }
  };

  if (!loaded) return <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#003087" }}>Loading…</div>;
  if (!currentUser) return <LoginPage users={users} onLogin={handleLogin} />;

  const role = currentUser.role;

  const allNavItems = [
    { key: "directory",   icon: "⊞", label: "Buyer Directory",  section: "view",    permission: "viewDirectory" },
    { key: "companies",   icon: "⊙", label: "Companies",         section: "manage",  permission: "viewCompanies" },
    { key: "products",    icon: "◈", label: "Products",           section: "manage",  permission: "viewProducts" },
    { key: "managers",    icon: "◎", label: "Prod. Managers",     section: "manage",  permission: "viewManagers" },
    { key: "salespeople", icon: "◉", label: "Salespeople",        section: "manage",  permission: "viewSalespeople" },
    { key: "settings",   icon: "⚙", label: "Settings",           section: "admin",   permission: "viewSettings" },
  ];
  const navItems = allNavItems.filter(n => can(role, n.permission));
  const sections = [...new Set(navItems.map(n => n.section))];

  const sectionLabels = { view: "Overview", manage: "Management", admin: "Administration" };

  return (
    <div style={S.app}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sideHead}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, background: "rgba(255,255,255,0.15)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: "900", color: "#FFF", letterSpacing: 0 }}>ERM</span>
            </div>
            <div>
              <p style={S.sideTitle}>ERM</p>
              <p style={S.sideSub}>Enterprise Relationship Manager</p>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, paddingTop: 8, overflowY: "auto" }}>
          {sections.map(sec => (
            <div key={sec}>
              <div style={S.navSection}>{sectionLabels[sec]}</div>
              {navItems.filter(n => n.section === sec).map(n => (
                <button key={n.key} style={S.navBtn(tab === n.key)} onClick={() => setTab(n.key)}>
                  <span style={{ fontSize: 15 }}>{n.icon}</span><span>{n.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* User + import area */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          {can(role, "importExport") && (
            <button onClick={() => setShowImport(true)} style={{ width: "100%", padding: "9px 0", borderRadius: 6, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#FFF", fontFamily: "inherit", fontSize: 12, fontWeight: "600", cursor: "pointer", marginBottom: 10 }}>
              ↑ Import CSV
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: "700", color: "#FFF", flexShrink: 0 }}>
              {(currentUser.name || currentUser.username)[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#FFF", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name || currentUser.username}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1 }}>{ROLE_LABELS[role]}</div>
            </div>
            <button onClick={() => setShowChangePw(true)} title="Change password" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 15, padding: 2 }}>🔑</button>
            <button onClick={handleLogout} title="Sign out" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, padding: 2 }}>⏏</button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={S.main}>
        {tab === "directory"   && <DirectoryTab products={products} companies={companies} pms={pms} salespeople={salespeople} showToast={showToast} onImport={() => setShowImport(true)} role={role}
            onEditPm={(pm) => { setEditingPmFromDir(pm); setTab("managers"); }}
            onDeletePm={(id) => { setPms(prev => prev.filter(p => p.id !== id)); showToast("Manager removed"); }} />}
        {tab === "companies"   && <CompaniesTab companies={companies} setCompanies={setCompanies} showToast={showToast} role={role} />}
        {tab === "products"    && <ProductsTab products={products} setProducts={setProducts} showToast={showToast} role={role} />}
        {tab === "managers"    && <ManagersTab pms={pms} setPms={setPms} companies={companies} products={products} salespeople={salespeople} showToast={showToast} role={role} editingPmFromDir={editingPmFromDir} clearEditingPmFromDir={() => setEditingPmFromDir(null)} />}
        {tab === "salespeople" && <SalespeopleTab salespeople={salespeople} setSalespeople={setSalespeople} pms={pms} setPms={setPms} companies={companies} showToast={showToast} role={role} />}
        {tab === "settings"    && <SettingsTab users={users} setUsers={setUsers} currentUser={currentUser} showToast={showToast} companies={companies} setCompanies={setCompanies} pms={pms} setPms={setPms} products={products} setProducts={setProducts} salespeople={salespeople} setSalespeople={setSalespeople} />}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
      {showChangePw && <ChangePasswordModal currentUser={currentUser} setUsers={setUsers} onClose={() => setShowChangePw(false)} showToast={showToast} />}
      {toast && <div style={S.toast}>✓ {toast}</div>}
    </div>
  );
}

// ─── CHANGE PASSWORD MODAL ───────────────────────────────────────────────────
function ChangePasswordModal({ currentUser, setUsers, onClose, showToast }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const save = () => {
    if (hashPw(current) !== currentUser.passwordHash) { setError("Current password is incorrect."); return; }
    if (next.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, passwordHash: hashPw(next) } : u));
    showToast("Password updated successfully");
    onClose();
  };

  return (
    <Modal title="Change Password" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>Current Password</label>
        <div style={{ position: "relative" }}>
          <input type={showCur ? "text" : "password"} style={{ ...S.input, paddingRight: 52 }} value={current} onChange={e => setCurrent(e.target.value)} placeholder="Your current password" />
          <button onClick={() => setShowCur(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6B7A99", fontSize: 12, fontFamily: "inherit" }}>{showCur ? "Hide" : "Show"}</button>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>New Password</label>
        <div style={{ position: "relative" }}>
          <input type={showNew ? "text" : "password"} style={{ ...S.input, paddingRight: 52 }} value={next} onChange={e => setNext(e.target.value)} placeholder="At least 6 characters" />
          <button onClick={() => setShowNew(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6B7A99", fontSize: 12, fontFamily: "inherit" }}>{showNew ? "Hide" : "Show"}</button>
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={S.label}>Confirm New Password</label>
        <input type="password" style={S.input} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" onKeyDown={e => e.key === "Enter" && save()} />
      </div>
      {error && <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 6, padding: "9px 12px", fontSize: 12, color: "#C62828", marginBottom: 16 }}>⚠ {error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button style={S.btn()} onClick={save}>Update Password</button>
        <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ─── DIRECTORY ────────────────────────────────────────────────────────────────
function DirectoryTab({ products, companies, pms, salespeople, showToast, onImport, onEditPm, onDeletePm, role }) {
  const [filterRegions, setFilterRegions] = useState([]);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");
  const [search, setSearch] = useState("");
  const [copyFlash, setCopyFlash] = useState(false);

  const categories = [...new Set(products.map(p => p.category))];

  const results = useMemo(() => {
    return pms.filter(pm => {
      const company = companies.find(c => c.id === pm.companyId);
      if (!company) return false;
      const coRegions = company.regions || [];
      const pmProducts = products.filter(p => pm.productIds && pm.productIds.includes(p.id));
      if (filterRegions.length > 0 && !filterRegions.some(r => coRegions.includes(r))) return false;
      if (filterCategory !== "all" && !pmProducts.some(p => p.category === filterCategory)) return false;
      if (filterProduct !== "all" && !(pm.productIds || []).includes(filterProduct)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!pm.name.toLowerCase().includes(q) && !company.name.toLowerCase().includes(q) && !pm.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [pms, companies, products, filterRegions, filterCategory, filterProduct, search]);

  const copyEmails = () => {
    const emails = results.map(pm => pm.email).filter(Boolean).join(", ");
    navigator.clipboard.writeText(emails).then(() => {
      setCopyFlash(true); showToast(`${results.length} emails copied`);
      setTimeout(() => setCopyFlash(false), 2000);
    });
  };

  const exportCSV = () => {
    const rows = [["Company","Regions","Manager","Email","Phone","Salesperson","Salesperson Email"]];
    results.forEach(pm => {
      const co = companies.find(c => c.id === pm.companyId);
      const spList = salespeople.filter(s => (pm.salespersonIds || (pm.salespersonId ? [pm.salespersonId] : [])).includes(s.id));
      rows.push([co?.name||"", (co?.regions||[]).join("; "), pm.name, pm.email, pm.phone||"", spList.map(s=>s.name).join("; "), spList.map(s=>s.email).join("; ")]);
    });
    const csv = rows.map(r => r.map(x => `"${x}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "erm_directory.csv"; a.click();
  };

  const hasFilters = filterRegions.length > 0 || filterCategory !== "all" || filterProduct !== "all" || search.length > 0;

  return (
    <>
      <div style={S.pageHead}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={S.pageTitle}>Buyer Directory</h2>
            <p style={S.pageSub}>Filter and browse all registered buyers · {pms.length} total contacts</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.btn(copyFlash ? "success" : "ghost"), minWidth: 130 }} onClick={copyEmails}>{copyFlash ? "✓ Copied!" : "⎘ Copy Emails"}</button>
            {can(role, "importExport") && <button style={S.btn("ghost")} onClick={exportCSV}>↓ Export CSV</button>}
            {can(role, "importExport") && <button style={S.btn()} onClick={onImport}>↑ Import CSV</button>}
          </div>
        </div>
      </div>

      {/* Unified filter bar */}
      <div style={{ ...S.card, marginBottom: 20, padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 180px", minWidth: 160 }}>
            <div style={S.label}>Search</div>
            <input placeholder="Name, company or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, margin: 0 }} />
          </div>
          <div style={{ flex: "1 1 130px", minWidth: 120 }}>
            <div style={S.label}>Region</div>
            <select value={filterRegions[0] || "all"} onChange={e => setFilterRegions(e.target.value === "all" ? [] : [e.target.value])} style={{ ...S.select, width: "100%" }}>
              <option value="all">All Regions</option>
              {REGIONS.map(r => <option key={r} value={r}>{r} — {REGION_LABELS[r]}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 160px", minWidth: 140 }}>
            <div style={S.label}>Category</div>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterProduct("all"); }} style={{ ...S.select, width: "100%" }}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 180px", minWidth: 160 }}>
            <div style={S.label}>Product</div>
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={{ ...S.select, width: "100%" }}>
              <option value="all">All Products</option>
              {(filterCategory === "all" ? products : products.filter(p => p.category === filterCategory)).map(p => <option key={p.id} value={p.id}>{p.make}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, paddingBottom: 1 }}>
            {hasFilters && <button style={S.btn("ghost")} onClick={() => { setFilterRegions([]); setFilterCategory("all"); setFilterProduct("all"); setSearch(""); }}>✕ Clear</button>}
            <span style={{ fontSize: 12, color: "#6B7A99", fontWeight: "600", whiteSpace: "nowrap" }}>{results.length} result{results.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      {pms.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, color: "#003087", fontWeight: "700", marginBottom: 8 }}>No data yet</div>
          {can(role, "importExport") && <button style={S.btn()} onClick={onImport}>↑ Import CSV from Google Sheet</button>}
        </div>
      ) : results.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#B0BDD4" }}>No results match your filters.</div>
      ) : (
        <div style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.09)" }}>
          <table style={S.table}>
            <thead>
              <tr>{["Company","Regions","Manager","Email","Phone","Salesperson","Lines", ...(can(role,"editManagers") ? ["Actions"] : [])].map(h => <th key={h} style={{ ...S.th, whiteSpace: "nowrap" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {results.map((pm, i) => {
                const co = companies.find(c => c.id === pm.companyId);
                const coRegions = co?.regions || [];
                const pmProds = products.filter(p => pm.productIds && pm.productIds.includes(p.id));
                const spList = salespeople.filter(s => (pm.salespersonIds || (pm.salespersonId ? [pm.salespersonId] : [])).includes(s.id));
                return (
                  <tr key={pm.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                    <td style={{ ...S.td, color: "#003087", fontWeight: "700", whiteSpace: "nowrap" }}>
                      {co?.name}{pm.multiPM && <span style={{ ...S.tag("#B45309"), marginLeft: 6, fontSize: 9 }}>Multi-PM</span>}
                    </td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{coRegions.map(r => <span key={r} title={REGION_LABELS[r]} style={{ ...S.tag(REGION_COLORS[r]), marginBottom: 0 }}>{r}</span>)}</td>
                    <td style={{ ...S.td, fontWeight: "600", color: "#1A2B4A", whiteSpace: "nowrap" }}>{pm.name}</td>
                    <td style={S.td}><a href={`mailto:${pm.email}`} style={{ color: "#0057B8", textDecoration: "none", fontSize: 12 }}>{pm.email}</a></td>
                    <td style={{ ...S.td, fontSize: 12, whiteSpace: "nowrap" }}>{pm.phone || "—"}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{spList.length === 0 ? <span style={{ color: "#C8D6EE" }}>—</span> : spList.map(sp => <div key={sp.id} style={{ marginBottom: 2 }}><div style={{ fontWeight: "600", fontSize: 12, color: "#1A2B4A" }}>{sp.name}</div><div style={{ fontSize: 11, color: "#6B7A99", marginTop: 1 }}>{sp.email}</div></div>)}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      {pmProds.length === 0 ? <span style={{ color: "#C8D6EE" }}>—</span> : <span style={{ background: "#E8F0FB", color: "#003087", borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: "700" }}>{pmProds.length}</span>}
                    </td>
                    {can(role, "editManagers") && (
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => onEditPm(pm)}>Edit</button>
                          <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={() => onDeletePm(pm.id)}>Remove</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── COMPANIES ────────────────────────────────────────────────────────────────
function CompaniesTab({ companies, setCompanies, showToast, role }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", regions: [] });
  const canEdit = can(role, "editCompanies");

  const openAdd = () => { setEditing(null); setForm({ name: "", regions: [] }); setShowModal(true); };
  const openEdit = (c) => { setEditing(c.id); setForm({ name: c.name, regions: c.regions || [] }); setShowModal(true); };
  const save = () => {
    if (!form.name.trim() || form.regions.length === 0) return;
    if (editing) { setCompanies(prev => prev.map(c => c.id === editing ? { ...c, ...form } : c)); showToast("Company updated"); }
    else { setCompanies(prev => [...prev, { id: uid(), ...form }]); showToast("Company added"); }
    setShowModal(false);
  };
  const del = (id) => { setCompanies(prev => prev.filter(c => c.id !== id)); showToast("Removed"); };

  const RegionToggle = ({ selected, onChange }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {REGIONS.map(r => {
        const active = selected.includes(r), col = REGION_COLORS[r];
        return <button key={r} onClick={() => onChange(active ? selected.filter(x => x !== r) : [...selected, r])} title={REGION_LABELS[r]}
          style={{ padding: "6px 18px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: "700", border: `1.5px solid ${active ? col : "#C8D6EE"}`, background: active ? col : "#FFF", color: active ? "#FFF" : "#6B7A99" }}>{r}</button>;
      })}
    </div>
  );

  return (
    <>
      <div style={S.pageHead}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><h2 style={S.pageTitle}>Companies</h2><p style={S.pageSub}>Manage buying companies and sourcing regions</p></div>
        {canEdit && <button style={S.btn()} onClick={openAdd}>+ Add Company</button>}
      </div></div>
      <div style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.07)" }}>
        <table style={S.table}>
          <thead><tr>{["Company Name","Sourcing Regions", ...(canEdit ? ["Actions"] : [])].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {companies.length === 0
              ? <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", color: "#B0BDD4", padding: "40px 0" }}>No companies yet.</td></tr>
              : companies.map((c, i) => (
                <tr key={c.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                  <td style={{ ...S.td, color: "#003087", fontWeight: "700" }}>{c.name}</td>
                  <td style={S.td}>{(c.regions||[]).map(r => <span key={r} title={REGION_LABELS[r]} style={S.tag(REGION_COLORS[r])}>{r}</span>)}</td>
                  {canEdit && <td style={S.td}><div style={{ display: "flex", gap: 6 }}><button style={S.btn("ghost")} onClick={() => openEdit(c)}>Edit</button><button style={S.btn("danger")} onClick={() => del(c.id)}>Delete</button></div></td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title={editing ? "Edit Company" : "Add Company"} onClose={() => setShowModal(false)}>
          <div style={{ marginBottom: 20 }}><label style={S.label}>Company Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Acme Corp" /></div>
          <div style={{ marginBottom: 24 }}>
            <label style={S.label}>Sourcing Regions</label>
            <div style={{ marginTop: 10 }}><RegionToggle selected={form.regions} onChange={regions => setForm(p => ({ ...p, regions }))} /></div>
            {form.regions.length > 0 ? <div style={{ marginTop: 10, fontSize: 12, color: "#003087", fontWeight: "600" }}>{form.regions.map(r => REGION_LABELS[r]).join(" · ")}</div>
              : <div style={{ fontSize: 11, color: "#C62828", marginTop: 8 }}>Select at least one region</div>}
          </div>
          <div style={{ display: "flex", gap: 10 }}><button style={S.btn()} onClick={save}>{editing ? "Save" : "Add Company"}</button><button style={S.btn("ghost")} onClick={() => setShowModal(false)}>Cancel</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────
function ProductsTab({ products, setProducts, showToast, role }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ make: "", category: "" });
  const [customCat, setCustomCat] = useState("");
  const canEdit = can(role, "editProducts");
  const categories = [...new Set(products.map(p => p.category))];

  const openAdd = () => { setEditing(null); setForm({ make: "", category: "" }); setCustomCat(""); setShowModal(true); };
  const openEdit = (p) => { setEditing(p.id); setForm({ make: p.make, category: p.category }); setCustomCat(""); setShowModal(true); };
  const save = () => {
    const cat = customCat.trim() || form.category;
    if (!form.make.trim() || !cat) return;
    if (editing) { setProducts(prev => prev.map(p => p.id === editing ? { ...p, make: form.make, category: cat } : p)); showToast("Product updated"); }
    else { setProducts(prev => [...prev, { id: uid(), make: form.make, category: cat }]); showToast("Product added"); }
    setShowModal(false);
  };
  const del = (id) => { setProducts(prev => prev.filter(p => p.id !== id)); showToast("Removed"); };
  const catPalette = ["#003087","#0057B8","#0288D1","#00796B","#6A1B9A","#AD1457"];
  const catColor = cat => catPalette[categories.indexOf(cat) % catPalette.length];

  return (
    <>
      <div style={S.pageHead}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><h2 style={S.pageTitle}>Products</h2><p style={S.pageSub}>Product catalogue — make and category</p></div>
        {canEdit && <button style={S.btn()} onClick={openAdd}>+ Add Product</button>}
      </div></div>
      <div style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.07)" }}>
        <table style={S.table}>
          <thead><tr>{["Make / Brand","Category", ...(canEdit ? ["Actions"] : [])].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {products.length === 0
              ? <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", color: "#B0BDD4", padding: "40px 0" }}>No products yet.</td></tr>
              : products.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                  <td style={{ ...S.td, color: "#003087", fontWeight: "700" }}>{p.make}</td>
                  <td style={S.td}><span style={S.tag(catColor(p.category))}>{p.category}</span></td>
                  {canEdit && <td style={S.td}><div style={{ display: "flex", gap: 6 }}><button style={S.btn("ghost")} onClick={() => openEdit(p)}>Edit</button><button style={S.btn("danger")} onClick={() => del(p.id)}>Delete</button></div></td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title={editing ? "Edit Product" : "Add Product"} onClose={() => setShowModal(false)}>
          <div style={{ marginBottom: 16 }}><label style={S.label}>Make / Brand</label><input style={S.input} value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} placeholder="e.g. Samsung" /></div>
          <div style={{ marginBottom: 10 }}><label style={S.label}>Category (existing)</label>
            <select style={{ ...S.input }} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}><option value="">— choose —</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <div style={{ marginBottom: 20 }}><label style={S.label}>Or create new category</label><input style={S.input} value={customCat} onChange={e => setCustomCat(e.target.value)} placeholder="e.g. Textiles" /></div>
          <div style={{ display: "flex", gap: 10 }}><button style={S.btn()} onClick={save}>{editing ? "Save" : "Add Product"}</button><button style={S.btn("ghost")} onClick={() => setShowModal(false)}>Cancel</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── PRODUCT MANAGERS ─────────────────────────────────────────────────────────
function ManagersTab({ pms, setPms, companies, products, salespeople, showToast, role, editingPmFromDir, clearEditingPmFromDir }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", companyId: "", productIds: [], salespersonIds: [] });
  const canEdit = can(role, "editManagers");

  const openAdd = () => { setEditing(null); setForm({ name: "", email: "", phone: "", companyId: companies[0]?.id || "", productIds: [], salespersonIds: [] }); setShowModal(true); };
  const openEdit = pm => { setEditing(pm.id); setForm({ name: pm.name, email: pm.email, phone: pm.phone, companyId: pm.companyId, productIds: pm.productIds || [], salespersonIds: pm.salespersonIds || [] }); setShowModal(true); };

  useEffect(() => { if (editingPmFromDir) { openEdit(editingPmFromDir); clearEditingPmFromDir(); } }, [editingPmFromDir]);

  const save = () => {
    if (!form.name.trim() || !form.email.trim() || !form.companyId) return;
    if (editing) { setPms(prev => prev.map(pm => pm.id === editing ? { ...pm, ...form } : pm)); showToast("Manager updated"); }
    else { setPms(prev => [...prev, { id: uid(), ...form }]); showToast("Manager added"); }
    setShowModal(false);
  };
  const del = id => { setPms(prev => prev.filter(pm => pm.id !== id)); showToast("Removed"); };
  const grouped = companies.map(co => ({ company: co, managers: pms.filter(pm => pm.companyId === co.id) })).filter(g => g.managers.length > 0);
  const ungrouped = pms.filter(pm => !companies.find(c => c.id === pm.companyId));

  return (
    <>
      <div style={S.pageHead}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><h2 style={S.pageTitle}>Product Managers</h2><p style={S.pageSub}>Grouped by company · assign salesperson per manager</p></div>
        {canEdit && <button style={S.btn()} onClick={openAdd} disabled={companies.length === 0}>+ Add Manager</button>}
      </div></div>

      {grouped.map(({ company, managers }) => (
        <div key={company.id} style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#E8F0FB", borderRadius: "8px 8px 0 0", borderLeft: "4px solid #003087" }}>
            <span style={{ fontSize: 13, color: "#003087", fontWeight: "700" }}>{company.name}</span>
            {(company.regions||[]).map(r => <span key={r} title={REGION_LABELS[r]} style={S.tag(REGION_COLORS[r])}>{r}</span>)}
            <span style={{ color: "#6B7A99", fontSize: 11 }}>{managers.length} manager{managers.length !== 1 ? "s" : ""}</span>
            {managers.length > 1 && <span style={S.tag("#B45309")}>Multi-PM</span>}
          </div>
          <div style={{ borderRadius: "0 0 8px 8px", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.07)" }}>
            <table style={S.table}>
              <thead><tr>{["Name","Email","Phone","Products","Salesperson", ...(canEdit ? ["Actions"] : [])].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {managers.map((pm, i) => {
                  const pmProds = products.filter(p => pm.productIds && pm.productIds.includes(p.id));
                  const spList = salespeople.filter(s => (pm.salespersonIds || (pm.salespersonId ? [pm.salespersonId] : [])).includes(s.id));
                  return (
                    <tr key={pm.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                      <td style={{ ...S.td, color: "#003087", fontWeight: "600", whiteSpace: "nowrap" }}>{pm.name}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{pm.email||"—"}</td>
                      <td style={{ ...S.td, fontSize: 12, whiteSpace: "nowrap" }}>{pm.phone||"—"}</td>
                      <td style={{ ...S.td, fontSize: 12 }}>{pmProds.length === 0 ? <span style={{ color: "#C8D6EE" }}>None</span> : <span style={{ background: "#E8F0FB", color: "#003087", borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: "700" }}>{pmProds.length} lines</span>}</td>
                      <td style={S.td}>{spList.length === 0 ? <span style={{ color: "#C8D6EE", fontSize: 12 }}>Unassigned</span> : spList.map(sp => <div key={sp.id} style={{ marginBottom: 2 }}><div style={{ fontWeight: "600", fontSize: 12, color: "#0D7A3E" }}>{sp.name}</div><div style={{ fontSize: 11, color: "#6B7A99" }}>{sp.email}</div></div>)}</td>
                      {canEdit && <td style={{ ...S.td, whiteSpace: "nowrap" }}><div style={{ display: "flex", gap: 6 }}><button style={S.btn("ghost")} onClick={() => openEdit(pm)}>Edit</button><button style={S.btn("danger")} onClick={() => del(pm.id)}>Delete</button></div></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {ungrouped.length > 0 && <div style={{ marginBottom: 20 }}><div style={{ fontSize: 12, color: "#6B7A99", marginBottom: 8, fontWeight: "600", textTransform: "uppercase" }}>Unlinked</div>{ungrouped.map(pm => <div key={pm.id} style={{ ...S.card, color: "#6B7A99", fontSize: 13 }}>{pm.name} — {pm.email}</div>)}</div>}
      {companies.length === 0 && <div style={{ color: "#6B7A99", fontSize: 13 }}>Add a company first.</div>}

      {showModal && (
        <Modal title={editing ? "Edit Product Manager" : "Add Product Manager"} onClose={() => setShowModal(false)}>
          <div style={S.row}>
            <div style={S.formGroup}><label style={S.label}>Full Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Laura Chen" /></div>
          </div>
          <div style={S.row}>
            <div style={S.formGroup}><label style={S.label}>Email</label><input style={S.input} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="laura@company.com" /></div>
            <div style={S.formGroup}><label style={S.label}>Phone</label><input style={S.input} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="555-0100" /></div>
          </div>
          <div style={{ marginBottom: 16 }}><label style={S.label}>Company</label>
            <select style={{ ...S.input }} value={form.companyId} onChange={e => setForm(p => ({ ...p, companyId: e.target.value }))}>
              <option value="">— select —</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name} ({(c.regions||[]).join(", ")})</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Linked Salespeople (select all that apply)</label>
            <div style={{ marginTop: 8 }}>
              <CheckList items={salespeople.map(s => ({ id: s.id, label: `${s.name} · ${s.email}` }))} selected={form.salespersonIds} onChange={v => setForm(p => ({ ...p, salespersonIds: v }))} />
            </div>
            {salespeople.length === 0 && <div style={{ fontSize: 11, color: "#B0BDD4", marginTop: 6 }}>No salespeople added yet.</div>}
          </div>
          <div style={{ marginBottom: 20 }}><label style={S.label}>Products Managed</label>
            <div style={{ marginTop: 8 }}><CheckList items={products.map(p => ({ id: p.id, label: `${p.make} · ${p.category}` }))} selected={form.productIds} onChange={v => setForm(p => ({ ...p, productIds: v }))} /></div>
          </div>
          <div style={{ display: "flex", gap: 10 }}><button style={S.btn()} onClick={save}>{editing ? "Save Changes" : "Add Manager"}</button><button style={S.btn("ghost")} onClick={() => setShowModal(false)}>Cancel</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── SALESPEOPLE ──────────────────────────────────────────────────────────────
function SalespeopleTab({ salespeople, setSalespeople, pms, setPms, companies, showToast, role }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const canEdit = can(role, "editSalespeople");

  const [assignSp, setAssignSp] = useState(null); // salesperson being assigned
  const [assignedPmIds, setAssignedPmIds] = useState([]);

  const openAssign = (s) => {
    setAssignSp(s);
    // Pre-select all PMs already assigned to this salesperson
    setAssignedPmIds(pms.filter(pm => (pm.salespersonIds || []).includes(s.id)).map(pm => pm.id));
  };

  const saveAssign = () => {
    setPms(prev => prev.map(pm => {
      const alreadyHas = (pm.salespersonIds || []).includes(assignSp.id);
      const shouldHave = assignedPmIds.includes(pm.id);
      if (alreadyHas === shouldHave) return pm;
      const ids = shouldHave
        ? [...new Set([...(pm.salespersonIds || []), assignSp.id])]
        : (pm.salespersonIds || []).filter(id => id !== assignSp.id);
      return { ...pm, salespersonIds: ids };
    }));
    showToast(`${assignSp.name} assigned to ${assignedPmIds.length} manager${assignedPmIds.length !== 1 ? "s" : ""}`);
    setAssignSp(null);
  };

  const openAdd = () => { setEditing(null); setForm({ name: "", email: "", phone: "" }); setShowModal(true); };
  const openEdit = s => { setEditing(s.id); setForm({ name: s.name, email: s.email, phone: s.phone }); setShowModal(true); };
  const save = () => {
    if (!form.name.trim() || !form.email.trim()) return;
    if (editing) { setSalespeople(prev => prev.map(s => s.id === editing ? { ...s, ...form } : s)); showToast("Updated"); }
    else { setSalespeople(prev => [...prev, { id: uid(), ...form }]); showToast("Added"); }
    setShowModal(false);
  };
  const del = id => { setSalespeople(prev => prev.filter(s => s.id !== id)); showToast("Removed"); };

  return (
    <>
      <div style={S.pageHead}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><h2 style={S.pageTitle}>Salespeople</h2><p style={S.pageSub}>Your sales team · link them to product managers</p></div>
        {canEdit && <button style={S.btn()} onClick={openAdd}>+ Add Salesperson</button>}
      </div></div>
      <div style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.07)" }}>
        <table style={S.table}>
          <thead><tr>{["Name","Email","Phone","Actions"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {salespeople.length === 0
              ? <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: "#B0BDD4", padding: "40px 0" }}>No salespeople yet.</td></tr>
              : salespeople.map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                  <td style={{ ...S.td, color: "#003087", fontWeight: "700" }}>{s.name}</td>
                  <td style={S.td}><a href={`mailto:${s.email}`} style={{ color: "#0057B8", textDecoration: "none" }}>{s.email}</a></td>
                  <td style={S.td}>{s.phone||"—"}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={{ ...S.btn("ghost"), background: "#E8F0FB", color: "#003087", border: "none" }} onClick={() => openAssign(s)}>
                        ⊞ Assign PMs ({pms.filter(pm => (pm.salespersonIds||[]).includes(s.id)).length})
                      </button>
                      {canEdit && <><button style={S.btn("ghost")} onClick={() => openEdit(s)}>Edit</button><button style={S.btn("danger")} onClick={() => del(s.id)}>Delete</button></>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title={editing ? "Edit Salesperson" : "Add Salesperson"} onClose={() => setShowModal(false)}>
          <div style={{ marginBottom: 16 }}><label style={S.label}>Full Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Rachel Torres" /></div>
          <div style={S.row}>
            <div style={S.formGroup}><label style={S.label}>Email</label><input style={S.input} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="rachel@sales.com" /></div>
            <div style={S.formGroup}><label style={S.label}>Phone</label><input style={S.input} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="555-0300" /></div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}><button style={S.btn()} onClick={save}>{editing ? "Save" : "Add Salesperson"}</button><button style={S.btn("ghost")} onClick={() => setShowModal(false)}>Cancel</button></div>
        </Modal>
      )}

      {assignSp && (
        <Modal title={`Assign PMs to ${assignSp.name}`} onClose={() => setAssignSp(null)} wide>
          <div style={{ fontSize: 12, color: "#6B7A99", marginBottom: 16 }}>
            Tick all product managers that <strong style={{ color: "#003087" }}>{assignSp.name}</strong> should be assigned to. Unticking removes the assignment.
          </div>

          {/* Select all / none */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 12px" }} onClick={() => setAssignedPmIds(pms.map(p => p.id))}>Select All</button>
            <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 12px" }} onClick={() => setAssignedPmIds([])}>Clear All</button>
            <span style={{ fontSize: 12, color: "#6B7A99", alignSelf: "center", marginLeft: 4 }}>{assignedPmIds.length} selected</span>
          </div>

          {/* PMs grouped by company */}
          <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #D0DAF0", borderRadius: 8, marginBottom: 20 }}>
            {companies.map(co => {
              const coManagers = pms.filter(pm => pm.companyId === co.id);
              if (coManagers.length === 0) return null;
              return (
                <div key={co.id}>
                  <div style={{ padding: "8px 14px", background: "#F0F4FB", borderBottom: "1px solid #D0DAF0", fontSize: 11, fontWeight: "700", color: "#003087", display: "flex", alignItems: "center", gap: 8 }}>
                    {co.name}
                    {(co.regions||[]).map(r => <span key={r} style={S.tag(REGION_COLORS[r])}>{r}</span>)}
                  </div>
                  {coManagers.map((pm, i) => {
                    const checked = assignedPmIds.includes(pm.id);
                    return (
                      <div key={pm.id} onClick={() => setAssignedPmIds(prev => checked ? prev.filter(x => x !== pm.id) : [...prev, pm.id])}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: checked ? "#F0F7FF" : (i % 2 === 0 ? "#FFF" : "#F7FAFF"), cursor: "pointer", borderBottom: "1px solid #EBF0FB" }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? "#003087" : "#C8D6EE"}`, background: checked ? "#003087" : "#FFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {checked && <span style={{ color: "#FFF", fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: "600", color: "#1A2B4A" }}>{pm.name}</div>
                          <div style={{ fontSize: 11, color: "#6B7A99" }}>{pm.email}</div>
                        </div>
                        {/* Show other salespeople already assigned */}
                        {(pm.salespersonIds||[]).filter(id => id !== assignSp.id).map(sid => {
                          const sp = salespeople.find(s => s.id === sid);
                          return sp ? <span key={sid} style={{ ...S.tag("#0288D1"), fontSize: 9, marginBottom: 0 }}>{sp.name}</span> : null;
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {pms.filter(pm => !companies.find(c => c.id === pm.companyId)).map((pm, i) => {
              const checked = assignedPmIds.includes(pm.id);
              return (
                <div key={pm.id} onClick={() => setAssignedPmIds(prev => checked ? prev.filter(x => x !== pm.id) : [...prev, pm.id])}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: checked ? "#F0F7FF" : "#FFF", cursor: "pointer", borderBottom: "1px solid #EBF0FB" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? "#003087" : "#C8D6EE"}`, background: checked ? "#003087" : "#FFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {checked && <span style={{ color: "#FFF", fontSize: 11 }}>✓</span>}
                  </div>
                  <div><div style={{ fontSize: 13, fontWeight: "600", color: "#1A2B4A" }}>{pm.name}</div><div style={{ fontSize: 11, color: "#6B7A99" }}>{pm.email}</div></div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.btn()} onClick={saveAssign}>Save Assignments</button>
            <button style={S.btn("ghost")} onClick={() => setAssignSp(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function SettingsTab({ users, setUsers, currentUser, showToast, companies, setCompanies, pms, setPms, products, setProducts, salespeople, setSalespeople }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "viewer" });
  const [error, setError] = useState("");

  const openAdd = () => { setEditing(null); setForm({ name: "", username: "", password: "", role: "viewer" }); setError(""); setShowModal(true); };
  const openEdit = u => { setEditing(u.id); setForm({ name: u.name, username: u.username, password: "", role: u.role }); setError(""); setShowModal(true); };

  const save = () => {
    if (!form.name.trim() || !form.username.trim()) { setError("Name and username are required."); return; }
    if (!editing && !form.password.trim()) { setError("Password is required for new users."); return; }
    const duplicate = users.find(u => u.username.toLowerCase() === form.username.toLowerCase() && u.id !== editing);
    if (duplicate) { setError("Username already taken."); return; }

    if (editing) {
      setUsers(prev => prev.map(u => u.id === editing ? { ...u, name: form.name, username: form.username, role: form.role, ...(form.password ? { passwordHash: hashPw(form.password) } : {}) } : u));
      showToast("User updated");
    } else {
      setUsers(prev => [...prev, { id: uid(), name: form.name, username: form.username, passwordHash: hashPw(form.password), role: form.role }]);
      showToast("User created");
    }
    setShowModal(false);
  };

  const del = (id) => {
    if (id === currentUser.id) { showToast("Cannot delete your own account"); return; }
    setUsers(prev => prev.filter(u => u.id !== id)); showToast("User removed");
  };

  // ── Backup export ──────────────────────────────────────────────────────────
  const exportBackup = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      companies,
      products,
      salespeople,
      pms,
      users: users.map(u => ({ ...u })), // include users (passwords are hashed)
    };
    const json = JSON.stringify(backup, null, 2);
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(json);
    a.download = `erm_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Backup downloaded ✓");
  };

  // ── Restore from backup ─────────────────────────────────────────────────────
  const restoreBackup = (file) => {
    if (!file || !file.name.endsWith(".json")) { alert("Please select a valid .json backup file."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!backup.version || !backup.companies || !backup.pms) { alert("Invalid backup file — missing required fields."); return; }
        if (!window.confirm(`Restore backup from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : "unknown date"}?

This will REPLACE all current data. This cannot be undone.`)) return;
        if (backup.companies)   setCompanies(backup.companies);
        if (backup.products)    setProducts(backup.products);
        if (backup.salespeople) setSalespeople(backup.salespeople);
        if (backup.pms)         setPms(backup.pms);
        if (backup.users)       setUsers(backup.users);
        showToast("Backup restored successfully");
      } catch (err) { alert("Could not read backup: " + err.message); }
    };
    reader.readAsText(file);
  };

  const restoreRef = useRef();

  const roleBadge = (role) => (
    <span style={{ ...S.tag(ROLE_COLORS[role]), textTransform: "capitalize" }}>{ROLE_LABELS[role]}</span>
  );

  return (
    <>
      <div style={S.pageHead}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h2 style={S.pageTitle}>Settings</h2><p style={S.pageSub}>Manage user accounts and role permissions</p></div>
          <button style={S.btn()} onClick={openAdd}>+ New User</button>
        </div>
      </div>

      {/* ── Backup & Restore ── */}
      <div style={{ ...S.card, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: "700", color: "#003087", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Data Backup & Restore</div>
        <div style={{ fontSize: 12, color: "#6B7A99", marginBottom: 16 }}>
          Export a full backup of all companies, products, product managers, salespeople and user accounts. Use this before any major update or migration.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={{ ...S.btn(), display: "flex", alignItems: "center", gap: 8 }} onClick={exportBackup}>
            ↓ Export Backup
          </button>
          <button style={{ ...S.btn("ghost"), display: "flex", alignItems: "center", gap: 8 }} onClick={() => restoreRef.current.click()}>
            ↑ Restore from Backup
          </button>
          <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => { restoreBackup(e.target.files[0]); e.target.value = ""; }} />
          <span style={{ fontSize: 11, color: "#B0BDD4" }}>Backup file includes all data · passwords are stored as hashed values</span>
        </div>
      </div>

      {/* Role reference card */}
      <div style={{ ...S.card, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: "700", color: "#003087", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.5 }}>Role Permissions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { role: "admin", perms: ["Full access to all sections", "Manage users & accounts", "Import & export data", "Edit all records", "View all sections"] },
            { role: "contributor", perms: ["View Buyer Directory", "Add & edit companies", "Add & edit products", "Add & edit product managers", "Cannot manage users, salespeople or import/export"] },
            { role: "viewer", perms: ["View Buyer Directory only", "No editing capabilities", "No access to management tabs"] },
          ].map(({ role, perms }) => (
            <div key={role} style={{ background: "#F7FAFF", border: `1px solid ${ROLE_COLORS[role]}30`, borderRadius: 8, padding: "14px 16px", borderTop: `3px solid ${ROLE_COLORS[role]}` }}>
              <div style={{ fontWeight: "700", color: ROLE_COLORS[role], marginBottom: 10, fontSize: 13, textTransform: "capitalize" }}>{ROLE_LABELS[role]}</div>
              {perms.map(p => <div key={p} style={{ fontSize: 11, color: "#6B7A99", marginBottom: 4, display: "flex", gap: 6, alignItems: "flex-start" }}><span style={{ color: ROLE_COLORS[role], flexShrink: 0 }}>✓</span>{p}</div>)}
            </div>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,48,135,0.07)" }}>
        <table style={S.table}>
          <thead><tr>{["Name","Username","Role","Actions"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7FAFF" }}>
                <td style={{ ...S.td, fontWeight: "700", color: "#003087" }}>
                  {u.name}{u.id === currentUser.id && <span style={{ ...S.tag("#0D7A3E"), marginLeft: 6, fontSize: 9 }}>You</span>}
                </td>
                <td style={S.td}><code style={{ background: "#F0F4FB", padding: "2px 7px", borderRadius: 4, fontSize: 12 }}>{u.username}</code></td>
                <td style={S.td}>{roleBadge(u.role)}</td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={S.btn("ghost")} onClick={() => openEdit(u)}>Edit</button>
                    {u.id !== currentUser.id && <button style={S.btn("danger")} onClick={() => del(u.id)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={editing ? "Edit User" : "New User"} onClose={() => setShowModal(false)}>
          <div style={S.row}>
            <div style={S.formGroup}><label style={S.label}>Full Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Jane Smith" /></div>
            <div style={S.formGroup}><label style={S.label}>Username</label><input style={S.input} value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder="e.g. jsmith" /></div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>{editing ? "New Password (leave blank to keep current)" : "Password"}</label>
            <input type="password" style={S.input} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder={editing ? "Leave blank to keep unchanged" : "Set a password"} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Role</label>
            <select style={{ ...S.input }} value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]} — {r === "admin" ? "Full access" : r === "contributor" ? "Add & edit data" : "View only"}</option>)}
            </select>
          </div>
          {error && <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 6, padding: "9px 12px", fontSize: 12, color: "#C62828", marginBottom: 16 }}>⚠ {error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.btn()} onClick={save}>{editing ? "Save Changes" : "Create User"}</button>
            <button style={S.btn("ghost")} onClick={() => setShowModal(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}
