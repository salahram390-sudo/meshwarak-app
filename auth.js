// auth.js (module) - robust UI toggling + locations + Firebase auth
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
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
  const { mode, role } = getState();

  const nameWrap = $id("nameWrap");
  const phoneWrap = $id("phoneWrap");
  const govWrap = $id("govWrap");
  const centerWrap = $id("centerWrap");
  const driverOnly = $id("driverOnly");
  const submitBtn = $id("submitBtn");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  // Signup fields
  show(nameWrap, isSignup);
  show(phoneWrap, isSignup);
  show(govWrap, isSignup);
  show(centerWrap, isSignup);

  // Driver-only fields (only on signup)
  show(driverOnly, isSignup && isDriver);

  if (submitBtn) submitBtn.textContent = isSignup ? "متابعة" : "دخول";

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
