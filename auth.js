// auth.js (module) - robust UI toggling + locations + Firebase auth
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";

const $id = (id) => document.getElementById(id);

function setMsg(text) {
  const el = $id("authMsg");
  if (el) el.textContent = text || "";
}

function toggleModeUI() {
  const modeSel = document.getElementById("authMode") || document.getElementById("mode");
  const roleSel = document.getElementById("role") || document.getElementById("accountType");

  const mode = modeSel?.value || "login";      // login | signup
  const role = roleSel?.value || "passenger";  // passenger | driver

  // wrappers (IDs الموجودة في login.html عندك)
  const loginBox = document.querySelector("#loginFields");
  const regBox = document.querySelector("#regFields") || document.querySelector("#registerFields");
  const driverBox = document.querySelector("#driverFields");

  const isSignup = (mode === "signup" || mode === "register");
  const isDriver = (role === "driver");

  if (loginBox) loginBox.style.display = isSignup ? "none" : "";
  if (regBox) regBox.style.display = isSignup ? "" : "none";
  if (driverBox) driverBox.style.display = (isSignup && isDriver) ? "" : "none";

  // زر submit
  const form = document.getElementById("authForm");
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
  // Read profile
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const profile = snap.exists() ? snap.data() : null;

  const role = profile?.role || "passenger";
  const target = role === "driver" ? "./driver.html" : "./passenger.html";
  location.href = target;
}

async function onSubmit(e) {
  e.preventDefault();

  const modeSel = document.getElementById("authMode") || document.getElementById("mode");
  const roleSel = document.getElementById("role") || document.getElementById("accountType");
  const mode = modeSel?.value || "login";
  const role = roleSel?.value || "passenger";
  const isSignup = (mode === "signup" || mode === "register");

  const email = ($id("email")?.value || "").trim();
  const password = ($id("password")?.value || "").trim();

  if (!email || !password) return setMsg("اكتب الإيميل وكلمة المرور");

  try {
    setMsg("");

    let userCred;
    if (isSignup) {
      userCred = await createUserWithEmailAndPassword(auth, email, password);
    } else {
      userCred = await signInWithEmailAndPassword(auth, email, password);
    }

    const uid = userCred.user.uid;

    if (isSignup) {
      // Collect signup fields if exist
      const name = ($id("name")?.value || "").trim();
      const phone = ($id("phone")?.value || "").trim();
      const governorate = ($id("gov")?.value || "").trim();
      const center = ($id("center")?.value || "").trim();
      const vehicleType = ($id("vehicleType")?.value || "").trim();
      const vehicleCode = ($id("vehicleCode")?.value || "").trim();

      // Basic validation for signup
      if (!name) return setMsg("اكتب الاسم");
      if (!phone) return setMsg("اكتب رقم الهاتف");
      if (!governorate) return setMsg("اختر المحافظة");
      if (!center) return setMsg("اختر المركز/المدينة");

      if (role === "driver") {
        if (!vehicleType) return setMsg("اختر نوع المركبة");
        if (!vehicleCode) return setMsg("اكتب كود المركبة");
      }

      const ref = doc(db, "users", uid);
      await setDoc(
        ref,
        {
          uid,
          role,
          name,
          phone,
          governorate,
          center,
          vehicleType: role === "driver" ? vehicleType : null,
          vehicleCode: role === "driver" ? vehicleCode : null,
          email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await loadProfileAndRedirect(uid);
  } catch (err) {
    console.error(err);
    setMsg(err?.message || "حدث خطأ");
  }
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  toggleModeUI();
  initGovCenter();

  (document.querySelector("#authMode") || document.querySelector("#mode"))?.addEventListener("change", toggleModeUI);
  (document.querySelector("#role") || document.querySelector("#accountType"))?.addEventListener("change", toggleModeUI);

  const form = document.getElementById("authForm");
  if (form) form.addEventListener("submit", onSubmit);

  // Redirect if already logged in
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await loadProfileAndRedirect(user.uid);
  });
});
