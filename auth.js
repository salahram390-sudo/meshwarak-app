// auth.js
import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { upsertUserProfile, getMyProfile, migrateLegacyProfile } from "./firestore-api.js";
import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";
import { registerPWA } from "./pwa.js";
import { toast } from "./notify.js";

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
  $("#authMsg").textContent = "تحميل المحافظات...";
  const data = await loadEgyptLocations();

  fillSelect($("#gov"), data.govList, "اختر المحافظة");
  fillSelect($("#center"), [], "اختر المركز/المدينة");

  $("#gov").addEventListener("change", () => {
    const gov = $("#gov").value;
    const centers = data.centersByGov[gov] || [];
    fillSelect($("#center"), centers, "اختر المركز/المدينة");
  });

  $("#authMsg").textContent = "";
}

function toggleModeUI() {
  const mode = $("#authMode").value;
  const role = $("#role").value;

  $("#signupOnly").style.display = mode === "signup" ? "" : "none";
  $("#driverOnly").style.display = mode === "signup" && role === "driver" ? "" : "none";
}

$("#authMode").addEventListener("change", toggleModeUI);
$("#role").addEventListener("change", toggleModeUI);
toggleModeUI();

initLocations().catch((e) => ($("#authMsg").textContent = e.message));

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
