// auth.js (clean) - robust UI toggling + locations + Firebase auth
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
  // support multiple ids
  const modeEl = $id("authMode") || $id("mode"); // login|signup or login|register
  const roleEl = $id("role") || $id("accountType"); // passenger|driver
  const rawMode = (modeEl?.value || "login").toLowerCase();
  const mode = rawMode === "register" ? "signup" : rawMode; // normalize
  const role = (roleEl?.value || "passenger").toLowerCase();
  return { mode, role };
}

function toggleModeUI() {
  const { mode, role } = getState();

  // support old wrappers if exist
  const signupOnly = $id("signupOnly"); // optional wrapper
  const driverOnly = $id("driverOnly"); // optional wrapper

  // legacy wrappers (some old files)
  const nameWrap = $id("nameWrap");
  const phoneWrap = $id("phoneWrap");
  const govWrap = $id("govWrap");
  const centerWrap = $id("centerWrap");

  const regBox = document.querySelector("#regFields") || document.querySelector("#registerFields");
  const loginBox = document.querySelector("#loginFields");
  const driverFields = document.querySelector("#driverFields");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  // If page uses grouped boxes
  if (regBox || loginBox || driverFields) {
    show(loginBox, !isSignup);
    show(regBox, isSignup);
    show(driverFields, isSignup && isDriver);
  }

  // If page uses wrappers per-field
  show(nameWrap, isSignup);
  show(phoneWrap, isSignup);
  show(govWrap, isSignup);
  show(centerWrap, isSignup);
  show(signupOnly, isSignup);
  show(driverOnly, isSignup && isDriver);

  // submit button label
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
    setMsg("تعذر تحميل المحافظات/المراكز. تأكد من الاتصال بالإنترنت.");
  }
}

async function loadProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function saveProfile(uid, data) {
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      ...data,
      uid,
      updatedAt: serverTimestamp(),
      createdAt: data?.createdAt || serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

async function onSubmit(e) {
  e.preventDefault();
  const { mode, role } = getState();

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();
  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور.");

  setMsg("");

  try {
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
      return; // redirect happens in onAuthStateChanged
    }

    // signup
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

    if (role === "driver") {
      if (!vehicleType) return setMsg("اختر نوع المركبة.");
      if (!vehicleCode) return setMsg("اكتب كود المركبة.");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await saveProfile(cred.user.uid, {
      role,
      name,
      phone,
      governorate,
      center,
      vehicleType: role === "driver" ? vehicleType : "",
      vehicleCode: role === "driver" ? vehicleCode : "",
    });
  } catch (e) {
    console.error(e);
    setMsg(e?.message || "حصل خطأ.");
  }
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();

  (document.querySelector("#authMode") || document.querySelector("#mode"))?.addEventListener(
    "change",
    toggleModeUI
  );
  (document.querySelector("#role") || document.querySelector("#accountType"))?.addEventListener(
    "change",
    toggleModeUI
  );

  initGovCenter();

  const form = $id("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  // redirect if already logged in AND profile exists
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const profile = await loadProfile(user.uid);
      if (!profile) return; // stay on login if no profile yet
      const role = (profile.role || "passenger").toLowerCase();
      location.href = role === "driver" ? "./driver.html" : "./passenger.html";
    } catch (e) {
      console.error(e);
    }
  });
});
