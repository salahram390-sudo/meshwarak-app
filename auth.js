// auth.js (ESM) - Clean + Stable
// - No dependency on egypt-locations.js exports (prevents "export not found")
// - Robust UI toggle for login/signup + passenger/driver
// - Loads governorate/center from egypt-data.json
// - Creates/updates user profile in Firestore
// - Redirects logged-in users to passenger/driver page

import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { getMyProfile, upsertUserProfile } from "./firestore-api.js";

const $id = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

function setMsg(text) {
  const el = $id("authMsg");
  if (el) el.textContent = text || "";
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

// Support both ids used across versions
function getState() {
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");
  const mode = (modeSel?.value || "login").toLowerCase(); // login | signup (or register)
  const role = (roleSel?.value || "passenger").toLowerCase(); // passenger | driver
  const isSignup = mode === "signup" || mode === "register";
  const isDriver = role === "driver";
  return { mode, role, isSignup, isDriver };
}

function toggleModeUI() {
  const { isSignup, isDriver } = getState();

  // New wrappers (login.html in your zip)
  const signupOnly = $id("signupOnly");
  const driverOnly = $id("driverOnly");
  show(signupOnly, isSignup);
  show(driverOnly, isSignup && isDriver);

  // Old wrappers (compat)
  show($id("regFields") || $id("registerFields"), isSignup);
  show($id("loginFields"), !isSignup);
  show($id("driverFields"), isSignup && isDriver);

  // Submit button label
  const form = $id("authForm");
  const btn = form?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = isSignup ? "تسجيل" : "متابعة";

  setMsg("");
}

/** ---- Egypt locations loader (NO module exports needed) ---- */
let __egyptCache = null;

async function loadEgyptLocations() {
  if (__egyptCache) return __egyptCache;

  // cache-bust to avoid stale json
  const url = `./egypt-data.json?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load egypt-data.json");
  const data = await res.json();

  // supports multiple shapes
  // expected: { govList: [...], centersByGov: { "Cairo": ["..."] } }
  // or raw list/object
  if (data.govList && data.centersByGov) {
    __egyptCache = data;
    return __egyptCache;
  }

  // try to normalize if file contains { governorates: [...] }
  if (Array.isArray(data.governorates)) {
    const govList = data.governorates.map((g) => g.name);
    const centersByGov = {};
    data.governorates.forEach((g) => {
      centersByGov[g.name] = (g.centers || g.cities || []).map((c) => c.name || c);
    });
    __egyptCache = { govList, centersByGov };
    return __egyptCache;
  }

  // fallback: if it's object map
  if (data && typeof data === "object") {
    const govList = Object.keys(data);
    const centersByGov = {};
    govList.forEach((g) => {
      centersByGov[g] = Array.isArray(data[g]) ? data[g] : [];
    });
    __egyptCache = { govList, centersByGov };
    return __egyptCache;
  }

  throw new Error("Unknown egypt-data.json shape");
}

function fillSelect(selectEl, items, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder || "اختر";
  selectEl.appendChild(opt0);

  (items || []).forEach((x) => {
    const opt = document.createElement("option");
    opt.value = x;
    opt.textContent = x;
    selectEl.appendChild(opt);
  });
}

async function initGovCenter() {
  const govSelect = $id("gov");
  const centerSelect = $id("center");
  if (!govSelect || !centerSelect) return;

  try {
    const { govList, centersByGov } = await loadEgyptLocations();
    fillSelect(govSelect, govList, "اختر المحافظة");
    fillSelect(centerSelect, [], "اختر المركز/المدينة");

    govSelect.addEventListener("change", () => {
      const gov = govSelect.value || "";
      const centers = centersByGov[gov] || [];
      fillSelect(centerSelect, centers, "اختر المركز/المدينة");
    });
  } catch (e) {
    console.error(e);
    setMsg("تعذر تحميل المحافظات/المراكز. تأكد من وجود egypt-data.json.");
  }
}

/** ---- Redirect logic ---- */
async function loadProfileAndRedirect(uid) {
  const profile = await getMyProfile(uid);
  const role = (profile?.role || "passenger").toLowerCase();
  location.href = role === "driver" ? "./driver.html" : "./passenger.html";
}

/** ---- Submit handler ---- */
async function onSubmit(e) {
  e.preventDefault();
  setMsg("");

  const { isSignup, role, isDriver } = getState();

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) {
    setMsg("اكتب البريد وكلمة المرور.");
    return;
  }

  try {
    if (!isSignup) {
      // LOGIN
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(cred.user.uid);
      return;
    }

    // SIGNUP
    const name = ($id("name")?.value || "").trim();
    const phone = ($id("phone")?.value || "").trim();
    const governorate = ($id("gov")?.value || "").trim();
    const center = ($id("center")?.value || "").trim();

    if (!name) return setMsg("اكتب الاسم بالكامل.");
    if (!phone) return setMsg("اكتب رقم الهاتف.");
    if (!governorate) return setMsg("اختر المحافظة.");
    if (!center) return setMsg("اختر المركز/المدينة.");

    // Driver-only fields (your login.html ids)
    let vehicleType = "";
    let vehicleCode = "";
    if (isDriver) {
      vehicleType = ($id("driverVehicleType")?.value || "").trim();
      vehicleCode = ($id("driverVehicleCode")?.value || "").trim();
      if (!vehicleType) return setMsg("اختر نوع المركبة.");
      if (!vehicleCode) return setMsg("اكتب كود المركبة.");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await upsertUserProfile(cred.user.uid, {
      role,
      name,
      phone,
      governorate,
      center,
      vehicleType,
      vehicleCode,
    });

    await loadProfileAndRedirect(cred.user.uid);
  } catch (err) {
    console.error(err);
    setMsg(err?.message || "حدث خطأ. حاول مرة أخرى.");
  }
}

/** ---- Boot ---- */
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();

  // Listen to mode/role changes (support old ids too)
  (qs("#authMode") || qs("#mode"))?.addEventListener("change", toggleModeUI);
  (qs("#role") || qs("#accountType"))?.addEventListener("change", toggleModeUI);

  initGovCenter();

  const form = $id("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    // If user already logged in -> go to correct page
    await loadProfileAndRedirect(user.uid);
  });
});

// Optional: if you have a logout button with id="logoutBtn"
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.id === "logoutBtn") {
    try {
      await signOut(auth);
      location.href = "./login.html";
    } catch (err) {
      console.error(err);
    }
  }
});
