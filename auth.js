// auth.js (module) - clean + robust UI toggling + gov/center + Firebase auth

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
  // ids used in login.html: authMode + role
  // (support old ids too just in case)
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");

  const mode = (modeSel?.value || "login").toLowerCase(); // login | signup
  const role = (roleSel?.value || "passenger").toLowerCase(); // passenger | driver

  // normalize possible old values
  const normMode = mode === "register" ? "signup" : mode;
  const normRole = role === "راكب" ? "passenger" : role === "سائق" ? "driver" : role;

  return { mode: normMode, role: normRole };
}

function toggleModeUI() {
  const { mode, role } = getState();

  const signupOnly = $id("signupOnly");
  const driverOnly = $id("driverOnly");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  if (signupOnly) signupOnly.style.display = isSignup ? "" : "none";
  if (driverOnly) driverOnly.style.display = isSignup && isDriver ? "" : "none";

  // Submit button text
  const form = $id("authForm");
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
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    const profile = snap.exists() ? snap.data() : null;

    // default passenger if no profile
    const role = (profile?.role || "passenger").toLowerCase();
    const target = role === "driver" ? "./driver.html" : "./passenger.html";
    location.href = target;
  } catch (e) {
    console.error(e);
    // لو فشلنا لأي سبب: ما نكسرش الصفحة
  }
}

async function onSubmit(e) {
  e.preventDefault();
  setMsg("");

  const { mode, role } = getState();

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) {
    setMsg("اكتب الإيميل وكلمة المرور.");
    return;
  }

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  try {
    if (isSignup) {
      // signup fields
      const name = ($id("name")?.value || "").trim();
      const phone = ($id("phone")?.value || "").trim();
      const governorate = ($id("gov")?.value || "").trim();
      const center = ($id("center")?.value || "").trim();

      const vehicleType = ($id("vehicleType")?.value || "").trim();
      const vehicleCode = ($id("vehicleCode")?.value || "").trim();

      if (!name) return setMsg("اكتب الاسم.");
      if (!phone) return setMsg("اكتب رقم الهاتف.");
      if (!governorate) return setMsg("اختر المحافظة.");
      if (!center) return setMsg("اختر المركز/المدينة.");

      if (isDriver) {
        if (!vehicleType) return setMsg("اختر نوع المركبة.");
        if (!vehicleCode) return setMsg("اكتب كود المركبة.");
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      await setDoc(
        doc(db, "users", uid),
        {
          uid,
          role: isDriver ? "driver" : "passenger",
          name,
          phone,
          governorate,
          center,
          vehicleType: isDriver ? vehicleType : "",
          vehicleCode: isDriver ? vehicleCode : "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await loadProfileAndRedirect(uid);
    } else {
      // login
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(cred.user.uid);
    }
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? err.message : "حدث خطأ.";
    setMsg(msg.replace("Firebase:", "").trim());
  }
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();

  // Listen to mode/role changes (support old ids too)
  ($id("authMode") || $id("mode"))?.addEventListener("change", toggleModeUI);
  ($id("role") || $id("accountType"))?.addEventListener("change", toggleModeUI);

  initGovCenter();

  const form = $id("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  // Redirect if already logged in
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
