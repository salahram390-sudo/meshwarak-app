// egypt-locations.js
// مصدر المدن والمحافظات: Tech-Labs egypt-governorates-and-cities-db (raw github)
// هنستخدم cities.json + governorates.json علشان نطلع Governorate -> Cities mapping

const GOV_URL =
  "https://cdn.jsdelivr.net/gh/Tech-Labs/egypt-governorates-and-cities-db@master/governorates.json";
const CITIES_URL =
  "https://cdn.jsdelivr.net/gh/Tech-Labs/egypt-governorates-and-cities-db@master/cities.json";

const CACHE_KEY = "eg_locations_v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days


const FALLBACK_GOVS = [
  "القاهرة","الجيزة","الإسكندرية","الدقهلية","البحر الأحمر","البحيرة","الفيوم","الغربية","الإسماعيلية",
  "المنوفية","المنيا","القليوبية","الوادي الجديد","السويس","اسوان","اسيوط","بني سويف","بورسعيد","دمياط",
  "الشرقية","جنوب سيناء","كفر الشيخ","مطروح","الأقصر","قنا","شمال سيناء","سوهاج"
];


async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("فشل تحميل بيانات المحافظات/المدن");
  return await res.json();
}

function normalizeGovName(name) {
  return (name || "").trim();
}

function normalizeCityName(name) {
  return (name || "").trim();
}

function buildMapping(governorates, cities) {
  // governorates.json عادة فيها id + governorate_name_ar / governorate_name_en
  // cities.json عادة فيها governorate_id + city_name_ar / city_name_en
  const govById = new Map();
  (governorates || []).forEach((g) => {
    govById.set(String(g.id), {
      id: String(g.id),
      ar: normalizeGovName(g.governorate_name_ar || g.ar || g.name_ar || ""),
      en: (g.governorate_name_en || g.en || g.name_en || "").trim(),
    });
  });

  const map = new Map(); // gov_ar -> [city_ar...]
  (cities || []).forEach((c) => {
    const gov = govById.get(String(c.governorate_id));
    if (!gov?.ar) return;

    const cityAr = normalizeCityName(c.city_name_ar || c.ar || c.name_ar || "");
    if (!cityAr) return;

    if (!map.has(gov.ar)) map.set(gov.ar, []);
    map.get(gov.ar).push(cityAr);
  });

  // sort & unique
  const result = {};
  [...map.entries()].forEach(([govAr, list]) => {
    const uniq = Array.from(new Set(list)).sort((a, b) => a.localeCompare(b, "ar"));
    result[govAr] = uniq;
  });

  const govList = Object.keys(result).sort((a, b) => a.localeCompare(b, "ar"));
  return { govList, centersByGov: result };
}

export async function loadEgyptLocations() {
  // cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.ts && Date.now() - cached.ts < CACHE_TTL_MS && cached?.data) {
        return cached.data;
      }
    }
  } catch {}

  let data;
  try {
    const [govs, cities] = await Promise.all([fetchJson(GOV_URL), fetchJson(CITIES_URL)]);
    data = buildMapping(govs, cities);
  } catch (e) {
    data = { govList: FALLBACK_GOVS.slice(), centersByGov: Object.fromEntries(FALLBACK_GOVS.map(g=>[g,[]])) };
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}

  return data;
}

export function fillSelect(selectEl, items, placeholder = "اختر...") {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  items.forEach((x) => {
    const opt = document.createElement("option");
    opt.value = x;
    opt.textContent = x;
    selectEl.appendChild(opt);
  });
}
