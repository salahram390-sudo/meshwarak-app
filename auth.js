// auth.js (module) - robust UI toggling + locations + Firebase auth
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";

const $id = (id) => document.getElementById(id);

function setMsg(text) {
  const el = $id("authMsg");
  if (el) el.textContent = text || "";
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function getState() {
  const mode = ($id("authMode")?.value || "login");   // login | signup
  const role = ($id("role")?.value || "passenger");  // passenger | driver
  return { mode, role };
}

function toggleModeUI() {
  const modeSel = document.querySelector('#mode') || document.querySelector('#authMode');
  const roleSel = document.querySelector('#role') || document.querySelector('#accountType');

  const mode = modeSel?.value || 'login';     // login | register
  const role = roleSel?.value || 'passenger'; // passenger | driver

  const regBox   = document.querySelector('#regFields') || document.querySelector('#registerFields');
  const loginBox = document.querySelector('#loginFields');
  const driverBox= document.querySelector('#driverFields');

  // امنع كسر الصفحة لو عنصر ناقص
  if (loginBox) loginBox.style.display = (mode === 'login') ? '' : 'none';
  if (regBox)   regBox.style.display   = (mode === 'register') ? '' : 'none';
  if (driverBox)driverBox.style.display= (mode === 'register' && role === 'driver') ? '' : 'none';
}
async function initGovCenter() {
  const govSelect = $id("gov");
  const centerSelect = $id("center");
  if (!govSelect || !centerSelect) return;

  try {
    const data = await loadEgyptLocations(); // {govList, centersByGov}
    const govList = data?.govList || [];
    const centersByGov = data?.centersByGov || {};

    fillSelect(govSelect, govList, "اختر المحافظة");
    fillSelect(centerSelect, [], "اختر المركز/المدينة");

    govSelect.addEventListener("change", () => {
      const gov = govSelect.value || "";
      const centers = centersByGov[gov] || [];
      fillSelect(centerSelect, centers, "اختر المركز/المدينة");
    });
  } catch (e) {
    console.error(e);
    setMsg("تعذر تحميل المحافظات/المراكز. تأكد من الاتصال بالإنترنت.");
  }
} // ✅ اقفل initGovCenter هنا
// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  // Initial UI
  toggleModeUI();
  initGovCenter();

  // Listen to mode/role changes (support ids الموجوده عندك)
  (document.querySelector("#mode") || document.querySelector("#authMode"))?.addEventListener(
    "change",
    toggleModeUI
  );
  (document.querySelector("#role") || document.querySelector("#accountType"))?.addEventListener(
    "change",
    toggleModeUI
  );

  // Submit
  const form = document.getElementById("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  // Redirect if already logged in
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
async function loadProfileAndRedirect(uid) {
  // Read profile
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const profile = snap.exists() ? snap.data() : null;

  // Determine route
  const role = profile?.role || "passenger";
  const target = role === "driver" ? "./driver.html" : "./passenger.html";
  location.href = target;
}

async function onSubmit(e) {
  e.preventDefault();
  const { mode, role } = getState();

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور.");

  try {
    if (mode === "login") {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(cred.user.uid);
      return;
    }

    // signup
    const name = ($id("name")?.value || "").trim();
    const phone = ($id("phone")?.value || "").trim();
    const governorate = ($id("gov")?.value || "").trim();
    const center = ($id("center")?.value || "").trim();

    if (!name) return setMsg("اكتب الاسم.");
    if (!phone) return setMsg("اكتب رقم الهاتف.");
    if (!governorate) return setMsg("اختار المحافظة.");
    if (!center) return setMsg("اختار المركز/المدينة.");

    let vehicleType = "";
    let vehicleCode = "";
    if (role === "driver") {
      vehicleType = ($id("vehicleType")?.value || "").trim();
      vehicleCode = ($id("vehicleCode")?.value || "").trim();
      if (!vehicleType) return setMsg("اختار نوع المركبة.");
      if (!vehicleCode) return setMsg("اكتب كود المركبة.");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    const profile = {
      uid: cred.user.uid,
      role,
      name,
      phone,
      governorate,
      center,
      vehicleType: role === "driver" ? vehicleType : "",
      vehicleCode: role === "driver" ? vehicleCode : "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "users", cred.user.uid), profile, { merge: true });

    await loadProfileAndRedirect(cred.user.uid);
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? String(err.message) : "حصل خطأ";
    setMsg(msg);
  }
}

function init() {
  // Wire events safely
  $id("authMode")?.addEventListener("change", toggleModeUI);
  $id("role")?.addEventListener("change", toggleModeUI);
  $id("authForm")?.addEventListener("submit", onSubmit);

  toggleModeUI();
  initGovCenter();
}

document.addEventListener("DOMContentLoaded", init);
// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  // Initial UI
  toggleModeUI();

  // Listen to mode/role changes (support old ids too)
  (document.querySelector("#authMode") || document.querySelector("#mode"))?.addEventListener(
    "change",
    toggleModeUI
  );
  (document.querySelector("#role") || document.querySelector("#accountType"))?.addEventListener(
    "change",
    toggleModeUI
  );

  // Locations
  initGovCenter();

  // Submit
  const form = document.getElementById("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  // Redirect if already logged in
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
