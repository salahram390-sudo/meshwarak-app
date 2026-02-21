// auth.js
import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { upsertUserProfile, getMyProfile, migrateLegacyProfile } from "./firestore-api.js";
import { registerPWA } from "./pwa.js";
import { toast } from "./notify.js";

async function getLocationsApi(){
  // Try ES module first
  try{
    const mod = await import("./egypt-locations.js");
    return {
      loadEgyptLocations: mod.loadEgyptLocations,
      fillSelect: mod.fillSelect
    };
  }catch(e){
    // Fallback: non-module globals if someone included egypt-locations.js as a classic script
    return {
      loadEgyptLocations: window.loadEgyptLocations,
      fillSelect: window.fillSelect
    };
  }
}

const $ = (s) => document.querySelector(s);

await registerPWA();

function go(role) {
  window.location.href = role === "driver" ? "driver.html" : "passenger.html";
}

function isValidEgyptPhone(p) {
  const phone = (p || "").trim();
  return /^01\d{9}$/.test(phone);
}

async function initLocations() {
  const msg = $("#authMsg");
  if (msg) msg.textContent = "تحميل المحافظات...";

  const api = await getLocationsApi();
  if (!api.loadEgyptLocations || !api.fillSelect) {
    if (msg) msg.textContent = "تعذر تحميل المحافظات (تأكد من وجود egypt-locations.js).";
    return;
  }

  const data = await api.loadEgyptLocations();

  api.fillSelect($("#gov"), data.govList, "اختر المحافظة");
  api.fillSelect($("#center"), [], "اختر المركز/المدينة");

  const govEl = $("#gov");
  if (govEl) {
    govEl.addEventListener("change", () => {
      const gov = govEl.value;
      const centers = data.centersByGov[gov] || [];
      api.fillSelect($("#center"), centers, "اختر المركز/المدينة");
    });
  }

  if (msg) msg.textContent = "";
}

function toggleModeUI() {
  // Safe guards in case some elements are missing or the script runs before DOM is ready
  const signupOnly = $("#signupOnly");
  const driverOnly = $("#driverOnly");
  const btnSignup = $("#btnSignup");
  const btnLogin  = $("#btnLogin");

  const isSignup = mode === "signup";
  if (signupOnly) signupOnly.style.display = isSignup ? "block" : "none";
  if (btnSignup)  btnSignup.classList.toggle("active", isSignup);
  if (btnLogin)   btnLogin.classList.toggle("active", !isSignup);

  const isDriver = role === "driver";
  if (driverOnly) driverOnly.style.display = isDriver ? "block" : "none";

  const title = $("#title");
  const subtitle = $("#subtitle");
  if (title) title.textContent = isSignup ? "تسجيل جديد" : "تسجيل دخول";
  if (subtitle) subtitle.textContent = isSignup ? "إنشاء حساب جديد" : "الدخول بحسابك";
}

$("#authMode").addEventListener("change", toggleModeUI);
$("#role").addEventListener("change", toggleModeUI);
// Run after DOM is ready (important on mobile browsers)
window.addEventListener("DOMContentLoaded", () => {
  try { toggleModeUI(); } catch {}
  initLocations().catch((e) => {
    const m = $("#authMsg");
    if (m) m.textContent = e?.message || "حدث خطأ";
  });
});
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#authMsg").textContent = "جاري التنفيذ...";

  const mode = $("#authMode").value;
  const role = $("#role").value;

  const email = $("#email").value.trim();
  const password = $("#password").value;

  try {
    let cred;

    if (mode === "signup") {
      const name = ($("#name").value || "").trim();
      const phone = ($("#phone").value || "").trim();
      const governorate = $("#gov").value;
      const center = $("#center").value;

      if (!name) throw new Error("اكتب الاسم");
      if (!isValidEgyptPhone(phone)) throw new Error("رقم الهاتف لازم يكون 11 رقم ويبدأ بـ 01");
      if (!governorate) throw new Error("اختار المحافظة");
      if (!center) throw new Error("اختار المركز/المدينة");

      let driverVehicleType = null;
      let vehicleCode = null;

      if (role === "driver") {
        driverVehicleType = $("#driverVehicleType").value;
        vehicleCode = ($("#vehicleCode").value || "").trim();
        if (!vehicleCode) throw new Error("اكتب كود المركبة للسائق");
      }

      cred = await createUserWithEmailAndPassword(auth, email, password);

      const passengerProfile = { name, phone, governorate, center };
      const driverProfile = { name, phone, governorate, center, vehicleType: driverVehicleType, vehicleCode };

      await upsertUserProfile(cred.user.uid, {
        activeRole: role,
        profiles: {
          passenger: passengerProfile,
          driver: role === "driver" ? driverProfile : null,
        },
        createdAt: Date.now(),
      });

      toast("تم إنشاء الحساب ✅");
      go(role);
      return;
    }

    // login
    cred = await signInWithEmailAndPassword(auth, email, password);

    // migrate any older schema if needed
    await migrateLegacyProfile(cred.user.uid);

    const profile = await getMyProfile(cred.user.uid);
    const roleToGo = profile?.activeRole || profile?.role || "passenger";
    toast("تم تسجيل الدخول ✅");
    go(roleToGo);
  } catch (err) {
    $("#authMsg").textContent = "خطأ: " + (err?.message || err);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try{
    await migrateLegacyProfile(user.uid);
    const profile = await getMyProfile(user.uid);
    if (profile?.activeRole) go(profile.activeRole);
  }catch{}
});