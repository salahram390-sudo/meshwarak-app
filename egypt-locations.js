// egypt-locations.js
// Loads Egypt governorates + centers/cities for signup form.
// Uses local ./egypt-data.json (recommended for GitHub Pages reliability).
// Fallbacks to remote repo if local file missing.

const LOCAL_URL = "./egypt-data.json";
const GOV_URL = "https://raw.githubusercontent.com/Tech-Labs/egypt-governorates-and-cities-db/master/governorates.json";
const CITIES_URL = "https://raw.githubusercontent.com/Tech-Labs/egypt-governorates-and-cities-db/master/cities.json";

const CACHE_KEY = "eg_locations_v2";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
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

function tryReadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.ts || !cached?.data) return null;
    if (Date.now() - cached.ts > CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

export async function loadEgyptLocations() {
  const cached = tryReadCache();
  if (cached) return cached;

  // 1) Local packaged data (best)
  try {
    const local = await fetchJson(LOCAL_URL);
    if (local?.govList && local?.centersByGov) {
      writeCache({ govList: local.govList, centersByGov: local.centersByGov });
      return { govList: local.govList, centersByGov: local.centersByGov };
    }
  } catch {}

  // 2) Remote fallback (if local missing)
  const govsRaw = await fetchJson(GOV_URL);
  const citiesRaw = await fetchJson(CITIES_URL);

  // The Tech-Labs JSON is exported from phpMyAdmin, so we unwrap it.
  const govTable = (govsRaw || []).find((x) => x?.type === "table" && x?.name === "governorates");
  const citiesTable = (citiesRaw || []).find((x) => x?.type === "table" && x?.name === "cities");

  const govs = govTable?.data || [];
  const cities = citiesTable?.data || [];

  const data = buildMapping(govs, cities);
  writeCache(data);
  return data;
}

export function fillSelect(selectEl, items, placeholder = "اختر...") {
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
