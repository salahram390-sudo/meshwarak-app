// egypt-locations.js
// Load Governorates + Cities for Egypt.
// Strategy:
// 1) Try local ./egypt-data.json (recommended to avoid CORS and be faster).
//    Format: { govList: [...], centersByGov: { "القاهرة": ["مدينة نصر", ...], ... } }
// 2) If local file is missing, fallback to public dataset (jsDelivr) and build mapping.

const LOCAL_URL = "./egypt-data.json";
const GOV_URL =
  "https://cdn.jsdelivr.net/gh/Tech-Labs/egypt-governorates-and-cities-db@master/governorates.json";
const CITIES_URL =
  "https://cdn.jsdelivr.net/gh/Tech-Labs/egypt-governorates-and-cities-db@master/cities.json";

const CACHE_KEY = "eg_locations_v2";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("فشل تحميل بيانات المحافظات/المدن");
  return await res.json();
}

function buildMapping(governorates, cities) {
  const govById = new Map();
  (governorates || []).forEach((g) => {
    govById.set(String(g.id), {
      id: String(g.id),
      ar: (g.governorate_name_ar || g.ar || g.name_ar || "").trim(),
      en: (g.governorate_name_en || g.en || g.name_en || "").trim(),
    });
  });

  const map = new Map(); // gov_ar -> [city_ar...]
  (cities || []).forEach((c) => {
    const gov = govById.get(String(c.governorate_id));
    if (!gov?.ar) return;

    const cityAr = (c.city_name_ar || c.ar || c.name_ar || "").trim();
    if (!cityAr) return;

    if (!map.has(gov.ar)) map.set(gov.ar, []);
    map.get(gov.ar).push(cityAr);
  });

  const centersByGov = {};
  [...map.entries()].forEach(([govAr, list]) => {
    const uniq = Array.from(new Set(list)).sort((a, b) => a.localeCompare(b, "ar"));
    centersByGov[govAr] = uniq;
  });

  const govList = Object.keys(centersByGov).sort((a, b) => a.localeCompare(b, "ar"));
  return { govList, centersByGov };
}

async function loadEgyptLocations() {
  // cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.ts && Date.now() - cached.ts < CACHE_TTL_MS && cached?.data?.govList?.length) {
        return cached.data;
      }
    }
  } catch {}

  // Try local file first
  try {
    const local = await fetchJson(LOCAL_URL);
    if (local?.govList?.length && local?.centersByGov) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: local })); } catch {}
      return local;
    }
  } catch {}

  // Fallback to public dataset
  const [govs, cities] = await Promise.all([fetchJson(GOV_URL), fetchJson(CITIES_URL)]);
  const data = buildMapping(govs, cities);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}

  return data;
}

function fillSelect(selectEl, items, placeholder = "اختر...") {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  (items || []).forEach((x) => {
    const opt = document.createElement("option");
    opt.value = x;
    opt.textContent = x;
    selectEl.appendChild(opt);
  });
}
window.loadEgyptLocations = loadEgyptLocations;
window.fillSelect = fillSelect;
