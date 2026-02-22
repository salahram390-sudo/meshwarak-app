// egypt-locations.js
// تحميل بيانات المحافظات/المراكز من ملف محلي egypt-data.json داخل نفس المشروع (GitHub Pages-friendly)

const DATA_URL = new URL("./egypt-data.json", import.meta.url);

export async function loadEgyptLocations() {
  const res = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("فشل تحميل بيانات المحافظات/المراكز (egypt-data.json)");
  return await res.json(); // expected: { govList:[], centersByGov:{}, generatedAt?:... }
}

export function fillSelect(selectEl, items, placeholder) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder || "اختر";
  selectEl.appendChild(opt0);

  (items || []).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });

  // حاول نسترجع القيمة القديمة لو لسه موجودة
  if (prev && Array.from(selectEl.options).some(o => o.value === prev)) {
    selectEl.value = prev;
  } else {
    selectEl.value = "";
  }
}
