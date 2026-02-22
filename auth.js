// auth.js (CLEAN) - login/signup + governorate/center + role (passenger/driver) + redirect

import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";
import { migrateLegacyProfile, upsertUserProfile, getMyProfile } from "./firestore-api.js";

const $id = (id) => document.getElementById(id);
const $q = (s) => document.querySelector(s);

function setMsg(text) {
  const el = $id("authMsg");
  if (el) el.textContent = text || "";
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function getState() {
  const modeSel = $id("authMode") || $id("mode"); // login/signup or login/register
  const roleSel = $id("role") || $id("accountType"); // passenger/driver

  const modeRaw = (modeSel?.value || "login").toLowerCase();
  const roleRaw = (roleSel?.value || "passenger").toLowerCase();

  // normalize:
  const mode = (modeRaw === "register") ? "signup" : modeRaw; // login | signup
  const role = (roleRaw === "rider") ? "passenger" : roleRaw; // passenger | driver
  return { mode, role };
}

function toggleModeUI() {
  const { mode, role } = getState();
  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  // wrappers (IDs expected in login.html)
  const nameWrap = $id("nameWrap");
  const phoneWrap = $id("phoneWrap");
  const govWrap = $id("govWrap");
  const centerWrap = $id("centerWrap");
  const driverOnly = $id("driverOnly");   // contains vehicleType + vehicleCode (driver only)
  const signupOnly = $id("signupOnly");   // container for all signup-only fields (if exists)

  // If you already have wrappers separated:
  // - If signupOnly exists, we show it in signup mode.
  // - Else we show individual wraps.
  if (signupOnly) show(signupOnly, isSignup);

  show(nameWrap, isSignup);
  show(phoneWrap, isSignup);
  show(govWrap, isSignup);
  show(centerWrap, isSignup);
  show(driverOnly, isSignup && isDriver);

  // submit button text
  const form = $id("authForm") || $id("authform") || $q("form");
  const btn = form?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = isSignup ? "تسجيل" : "متابعة";

  setMsg("");
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
}

async function loadProfileAndRedirect(uid) {
  // Ensure profile exists and normalized
  await migrateLegacyProfile(uid);

  const profile = await getMyProfile(uid);
  const norm = profile ? profile : null;
  const activeRole = (norm?.activeRole || "passenger").toLowerCase();

  // redirect based on role
  window.location.href = activeRole === "driver" ? "driver.html" : "passenger.html";
}

async function onSubmit(e) {
  e.preventDefault();
  setMsg("");

  const { mode, role } = getState();
  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور");

  try {
    let cred;
    if (isSignup) {
      // signup fields
      const name = ($id("name")?.value || "").trim();
      const phone = ($id("phone")?.value || "").trim();
      const governorate = ($id("gov")?.value || "").trim();
      const center = ($id("center")?.value || "").trim();

      if (!name) return setMsg("اكتب الاسم بالكامل");
      if (!/^01\d{9}$/.test(phone)) return setMsg("رقم الهاتف غير صحيح");
      if (!governorate) return setMsg("اختار المحافظة");
      if (!center) return setMsg("اختار المركز/المدينة");

      let driver = null;
      if (isDriver) {
        const vehicleType = ($id("vehicleType")?.value || "").trim();
        const vehicleCode = ($id("vehicleCode")?.value || "").trim();
        if (!vehicleType) return setMsg("اختار نوع المركبة");
        if (!vehicleCode) return setMsg("اكتب كود المركبة");
        driver = { name, phone, governorate, center, vehicleType, vehicleCode };
      }

      cred = await createUserWithEmailAndPassword(auth, email, password);

      // store profile normalized
      const passenger = { name, phone, governorate, center };
      const data = {
        activeRole: isDriver ? "driver" : "passenger",
        profiles: {
          passenger,
          driver: driver || {},
        },
      };

      await upsertUserProfile(cred.user.uid, data);
      await loadProfileAndRedirect(cred.user.uid);
    } else {
      // login
      cred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(cred.user.uid);
    }
  } catch (err) {
    console.error(err);
    setMsg(err?.message || "حدث خطأ");
  }
}

/* =========================
   Boot (ONE place only)
========================= */
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();
  initGovCenter();

  // listeners
  ($id("authMode") || $id("mode"))?.addEventListener("change", toggleModeUI);
  ($id("role") || $id("accountType"))?.addEventListener("change", toggleModeUI);

  const form = $id("authForm") || $q("form");
  form?.addEventListener("submit", onSubmit);

  // if already logged in -> redirect (but only after profile normalization)
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      await loadProfileAndRedirect(user.uid);
    } catch (e) {
      console.error(e);
      setMsg("تعذر قراءة بيانات الحساب. جرّب تسجيل الخروج ثم الدخول.");
    }
  });
});
