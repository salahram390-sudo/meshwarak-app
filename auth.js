// auth.js (module) - CLEAN + robust UI + gov/center + Firebase Auth
import { auth, db } from "./firebase-init.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";

const $id = (id) => document.getElementById(id);

function setMsg(text) {
  const el = $id("authMsg");
  if (el) el.textContent = text || "";
}

function getState() {
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");
  const mode = (modeSel?.value || "login").trim(); // login | signup | register
  const role = (roleSel?.value || "passenger").trim(); // passenger | driver
  return { mode, role };
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function toggleModeUI() {
  const { mode, role } = getState();

  const isSignup = mode === "signup" || mode === "register";
  const isDriver = role === "driver";

  // دعم أكتر من naming للـ wrappers
  const nameWrap = $id("nameWrap") || $id("signupOnly") || $id("regFields");
  const phoneWrap = $id("phoneWrap");
  const govWrap = $id("govWrap");
  const centerWrap = $id("centerWrap");
  const driverOnly = $id("driverOnly") || $id("driverFields");

  // لو عندك تقسيم login/register boxes قديم
  const loginBox = $id("loginFields");
  const regBox = $id("regFields") || $id("registerFields");

  // Signup fields
  show(nameWrap, isSignup);
  show(phoneWrap, isSignup);
  show(govWrap, isSignup);
  show(centerWrap, isSignup);

  // Driver-only fields (only on signup)
  show(driverOnly, isSignup && isDriver);

  // لو الصفحة عندك بتستخدم تقسيم login/register القديم
  if (loginBox) show(loginBox, !isSignup);
  if (regBox) show(regBox, isSignup);

  // زر submit
  const form = $id("authForm");
  const btn = form?.querySelector('button[type="submit"]') || $id("submitBtn");
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
    // مهم: ممنوع نكسر الملف بنص متعدد الأسطر داخل ""
    setMsg("تعذر تحميل المحافظات/المراكز. تأكد من الاتصال بالإنترنت.");
  }
}

async function loadProfileAndRedirect(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const profile = snap.exists() ? snap.data() : null;

  const role = profile?.role || "passenger";
  const target = role === "driver" ? "./driver.html" : "./passenger.html";
  location.href = target;
}

async function onSubmit(e) {
  e.preventDefault();

  const { mode, role } = getState();
  const isSignup = mode === "signup" || mode === "register";

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور.");

  try {
    let userCred;

    if (isSignup) {
      // signup fields
      const name = ($id("name")?.value || "").trim();
      const phone = ($id("phone")?.value || "").trim();
      const governorate = ($id("gov")?.value || "").trim();
      const center = ($id("center")?.value || "").trim();

      // driver-only
      const vehicleType = ($id("vehicleType")?.value || "").trim();
      const vehicleCode = ($id("vehicleCode")?.value || "").trim();

      if (!name) return setMsg("اكتب اسمك.");
      if (!phone) return setMsg("اكتب رقم الهاتف.");
      if (!governorate) return setMsg("اختر المحافظة.");
      if (!center) return setMsg("اختر المركز/المدينة.");
      if (role === "driver" && !vehicleType) return setMsg("اختر نوع المركبة.");
      if (role === "driver" && !vehicleCode) return setMsg("اكتب كود المركبة.");

      userCred = await createUserWithEmailAndPassword(auth, email, password);

      // Save profile
      const uid = userCred.user.uid;
      await setDoc(
        doc(db, "users", uid),
        {
          uid,
          role,
          name,
          phone,
          governorate,
          center,
          vehicleType: role === "driver" ? vehicleType : "",
          vehicleCode: role === "driver" ? vehicleCode : "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await loadProfileAndRedirect(uid);
    } else {
      userCred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(userCred.user.uid);
    }
  } catch (err) {
    console.error(err);
    setMsg(err?.message || "حصل خطأ.");
  }
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();

  // change listeners (support old ids too)
  (document.querySelector("#authMode") || document.querySelector("#mode"))?.addEventListener("change", toggleModeUI);
  (document.querySelector("#role") || document.querySelector("#accountType"))?.addEventListener("change", toggleModeUI);

  initGovCenter();

  const form = $id("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
