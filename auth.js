// auth.js (module) - Clean & stable for Mashwarak
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

function setMsg(text = "") {
  const el = $id("authMsg");
  if (el) el.textContent = text;
}

function toggleModeUI() {
  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");

  const mode = modeSel?.value || "login";      // login | signup
  const role = roleSel?.value || "passenger";  // passenger | driver

  const signupOnly = $id("signupOnly");
  const driverOnly = $id("driverOnly");

  const isSignup = mode === "signup";
  const isDriver = role === "driver";

  if (signupOnly) signupOnly.style.display = isSignup ? "" : "none";
  if (driverOnly) driverOnly.style.display = (isSignup && isDriver) ? "" : "none";

  const form = $id("authForm");
  const btn = form?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = isSignup ? "تسجيل" : "متابعة";

  setMsg("");
}

async function initGovCenter() {
  const gov = $id("gov");
  const center = $id("center");
  if (!gov || !center) return;

  try {
    const data = await loadEgyptLocations(); // { govList, centersByGov }
    const govList = data?.govList || [];
    const centersByGov = data?.centersByGov || {};

    fillSelect(gov, govList, "اختر المحافظة");
    fillSelect(center, [], "اختر المركز/المدينة");

    gov.addEventListener("change", () => {
      const g = gov.value || "";
      fillSelect(center, centersByGov[g] || [], "اختر المركز/المدينة");
    });
  } catch (e) {
    console.error(e);
    setMsg("تعذر تحميل المحافظات/المراكز. تأكد من الاتصال بالإنترنت.");
  }
}

async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function redirectByProfile(uid) {
  const p = await getProfile(uid);
  const role = p?.activeRole || "passenger";
  location.href = role === "driver" ? "./driver.html" : "./passenger.html";
}

async function onSubmit(e) {
  e.preventDefault();

  const modeSel = $id("authMode") || $id("mode");
  const roleSel = $id("role") || $id("accountType");

  const mode = modeSel?.value || "login";
  const role = roleSel?.value || "passenger";

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();
  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور.");

  try {
    if (mode === "login") {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await redirectByProfile(cred.user.uid);
      return;
    }

    // signup
    const name = ($id("name")?.value || "").trim();
    const phone = ($id("phone")?.value || "").trim();
    const governorate = ($id("gov")?.value || "").trim();
    const center = ($id("center")?.value || "").trim();

    if (!name) return setMsg("اكتب الاسم.");
    if (!/^01\d{9}$/.test(phone)) return setMsg("رقم الهاتف غير صحيح.");
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

    // Store profile in the structure passenger.js/driver.js expect:
    const passengerProfile = { name, phone, governorate, center };
    const driverProfile =
      role === "driver"
        ? { name, phone, governorate, center, vehicleType, vehicleCode }
        : null;

    await setDoc(
      doc(db, "users", cred.user.uid),
      {
        uid: cred.user.uid,
        activeRole: role, // "passenger" | "driver"
        profiles: {
          passenger: passengerProfile,
          driver: driverProfile,
        },
        passengerActiveRideId: null,
        driverActiveRideId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await redirectByProfile(cred.user.uid);
  } catch (err) {
    console.error(err);
    setMsg(err?.message ? String(err.message) : "حصل خطأ");
  }
}

// ---- Boot (مرة واحدة فقط) ----
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();
  initGovCenter();

  ($id("authMode") || $id("mode"))?.addEventListener("change", toggleModeUI);
  ($id("role") || $id("accountType"))?.addEventListener("change", toggleModeUI);

  $id("authForm")?.addEventListener("submit", onSubmit);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await redirectByProfile(user.uid);
  });
});
