// auth.js
import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { upsertUserProfile, getMyProfile } from "./firestore-api.js";
import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";

const $ = (s) => document.querySelector(s);

function go(role) {
  window.location.href = role === "driver" ? "driver.html" : "passenger.html";
}

function isValidEgyptPhone(p) {
  const phone = (p || "").trim();
  return /^01\d{9}$/.test(phone); // بسيط: 11 رقم يبدأ 01
}

async function initLocations() {
  $("#authMsg").textContent = "تحميل المحافظات...";
  const data = await loadEgyptLocations();
  fillSelect($("#gov"), data.govList, "اختر المحافظة");

  $("#gov").addEventListener("change", () => {
    const gov = $("#gov").value;
    const centers = data.centersByGov[gov] || [];
    fillSelect($("#center"), centers, "اختر المركز/المدينة");
  });

  // اختيار أولي
  fillSelect($("#center"), [], "اختر المركز/المدينة");
  $("#authMsg").textContent = "";
}

function toggleModeUI() {
  const mode = $("#authMode").value;
  const role = $("#role").value;

  // حقول التسجيل تظهر فقط في signup
  $("#signupOnly").style.display = mode === "signup" ? "" : "none";

  // driverOnly تظهر فقط في signup + driver
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
      // تحقق بيانات التسجيل
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

      // نحفظ بروفايل المستخدم (الإيميل للتسجيل فقط)
      await upsertUserProfile(cred.user.uid, {
        role,
        name,
        phone,
        governorate,
        center,
        driverVehicleType,
        vehicleCode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      go(role);
      return;
    }

    // login
    cred = await signInWithEmailAndPassword(auth, email, password);

    const profile = await getMyProfile(cred.user.uid);
    if (!profile?.role) {
      // لو مفيش بروفايل (حالة قديمة)
      await upsertUserProfile(cred.user.uid, { role: "passenger", updatedAt: Date.now() });
      go("passenger");
      return;
    }

    go(profile.role);
  } catch (err) {
    $("#authMsg").textContent = "خطأ: " + (err?.message || err);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getMyProfile(user.uid);
  if (profile?.role) go(profile.role);
});
