// auth.js (module) - clean + robust UI toggling + gov/center + Firebase auth

import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
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

  const modeRaw = (modeSel?.value || "login").toLowerCase(); // login | signup | register
  const roleRaw = (roleSel?.value || "passenger").toLowerCase(); // passenger | driver

  const mode = modeRaw === "register" ? "signup" : modeRaw;
  const role =
    roleRaw === "راكب" ? "passenger" : roleRaw === "سائق" ? "driver" : roleRaw;

  return { mode, role };
}

function toggleModeUI() {
  const { mode, role } = getState();

  const signupOnly = $id("signupOnly"); // wrapper for name/phone/gov/center
  const driverOnly = $id("driverOnly"); // wrapper for vehicleType/vehicleCode

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  if (signupOnly) signupOnly.style.display = isSignup ? "" : "none";
  if (driverOnly) driverOnly.style.display = isSignup && isDriver ? "" : "none";

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

    const role = (profile?.role || "passenger").toLowerCase();
    location.href = role === "driver" ? "./driver.html" : "./passenger.html";
  } catch (e) {
    console.error(e);
  }
}

async function onSubmit(e) {
  e.preventDefault();
  setMsg("");

  const { mode, role } = getState();

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();
  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور.");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  try {
    if (isSignup) {
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
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await loadProfileAndRedirect(cred.user.uid);
    }
  } catch (err) {
    console.error(err);
    const msg = err?.message ? err.message : "حدث خطأ.";
    setMsg(msg.replace("Firebase:", "").trim());
  }
}

// ---- Optional helper if you want a logout button on login page ----
async function tryBindLogout() {
  const btn = $id("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      setMsg("تم تسجيل الخروج.");
    } catch (e) {
      console.error(e);
    }
  });
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();

  ($id("authMode") || $id("mode"))?.addEventListener("change", toggleModeUI);
  ($id("role") || $id("accountType"))?.addEventListener("change", toggleModeUI);

  initGovCenter();

  const form = $id("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  tryBindLogout();

  // Redirect if already logged in
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
