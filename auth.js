// auth.js (module) - robust UI toggling + locations + Firebase auth

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

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function getState() {
  // دعم IDs القديمة والجديدة
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");

  const mode = (modeSel?.value || "login").toLowerCase();     // login | signup
  const role = (roleSel?.value || "passenger").toLowerCase(); // passenger | driver

  // بعض نسخك كانت بتستخدم register بدل signup
  const fixedMode = (mode === "register") ? "signup" : mode;

  return { mode: fixedMode, role };
}

function toggleModeUI() {
  const { mode, role } = getState();

  // مجموعات الحقول (قد تكون مختلفة بين النسخ)
  const signupOnly = $id("signupOnly") || $id("regFields") || $id("registerFields");
  const driverOnly = $id("driverOnly") || $id("driverFields");
  const loginBox = $id("loginFields");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  // لو عندك تقسيم loginFields/regFields
  if (loginBox) show(loginBox, !isSignup);

  show(signupOnly, isSignup);
  show(driverOnly, isSignup && isDriver);

  // زر submit
  const form = $id("authForm");
  const btn = form?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = isSignup ? "تسجيل" : "متابعة";

  setMsg("");
}

async function initGovCenter() {
  // IDs المتوقعة في login.html
  const govSelect = $id("gov");
  const centerSelect = $id("center");
  if (!govSelect || !centerSelect) return;

  try {
    const data = await loadEgyptLocations(); // { govList, centersByGov }
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
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const profile = snap.exists() ? snap.data() : null;

  const role = (profile?.role || "passenger").toLowerCase();
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
      await signInWithEmailAndPassword(auth, email, password);
      return; // onAuthStateChanged هيحولك
    }

    // signup
    const name = ($id("name")?.value || "").trim();
    const phone = ($id("phone")?.value || "").trim();
    const governorate = ($id("gov")?.value || "").trim();
    const center = ($id("center")?.value || "").trim();

    const vehicleType = ($id("vehicleType")?.value || "").trim();
    const vehicleCode = ($id("vehicleCode")?.value || "").trim();

    if (!name) return setMsg("اكتب اسمك.");
    if (!phone) return setMsg("اكتب رقم الهاتف.");
    if (!governorate) return setMsg("اختار المحافظة.");
    if (!center) return setMsg("اختار المركز/المدينة.");

    if (role === "driver") {
      if (!vehicleType) return setMsg("اختار نوع المركبة.");
      if (!vehicleCode) return setMsg("اكتب كود المركبة.");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

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

    // هيتم التحويل من onAuthStateChanged
  } catch (err) {
    console.error(err);
    setMsg(err?.message || "حصل خطأ.");
  }
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();
  initGovCenter();

  // events (دعم ids القديمة والجديدة)
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");

  modeSel?.addEventListener("change", toggleModeUI);
  roleSel?.addEventListener("change", toggleModeUI);

  const form = $id("authForm");
  form?.addEventListener("submit", onSubmit);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
