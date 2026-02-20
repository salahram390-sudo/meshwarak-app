// passenger.js
import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMyProfile, createRideRequest, listenRide, listenDriverLive } from "./firestore-api.js";
import { createMap, addMarker, geocodeNominatim, routeOSRM, drawRoute } from "./map-kit.js";

const $ = (s) => document.querySelector(s);

// ===== State =====
let selectedVehicle = "tuktuk";
let selectedPrice = 15;
let priceTouched = false;

let myMarker = null;

let from = null,
  to = null;
let fromMarker = null,
  toMarker = null;
let routePoly = null;

let rideId = null;
let unRide = null,
  unLive = null;
let driverMarker = null;

// ===== Map =====
const map = createMap("map");

// ===== Helpers =====
function km(m) {
  return (m / 1000).toFixed(2);
}
function mins(s) {
  return Math.round(s / 60);
}
function estimatePrice(distance_m, vehicle) {
  const base =
    {
      tuktuk: 10,
      motor_delivery: 12,
      car: 18,
      microbus: 25,
      tamanya: 22,
      caboot: 30,
    }[vehicle] ?? 15;

  const perKm =
    {
      tuktuk: 4,
      motor_delivery: 4,
      car: 6,
      microbus: 8,
      tamanya: 7,
      caboot: 10,
    }[vehicle] ?? 5;

  return Math.round(base + perKm * (distance_m / 1000));
}
function setMsg(t) {
  const el = $("#passengerMsg");
  if (el) el.textContent = t || "";
}

// ===== Price Slider bind =====
const priceRange = document.getElementById("priceRange");
const priceValue = document.getElementById("priceValue");

if (priceRange) {
  selectedPrice = Number(priceRange.value || 15);
  if (priceValue) priceValue.textContent = String(selectedPrice);

  priceRange.addEventListener("input", () => {
    priceTouched = true;
    selectedPrice = Number(priceRange.value);
    if (priceValue) priceValue.textContent = String(selectedPrice);
  });
}

// ===== Vehicle Slider bind =====
function bindVehicleSlider() {
  const row = document.getElementById("vehicleRow");
  if (!row) return;

  row.addEventListener("click", (e) => {
    const btn = e.target.closest(".vehCard");
    if (!btn) return;

    selectedVehicle = btn.getAttribute("data-veh") || "tuktuk";

    row.querySelectorAll(".vehCard").forEach((x) => x.classList.remove("is-active"));
    btn.classList.add("is-active");

    // تحديث السعر المقترح لو فيه مسار مرسوم
    try {
      maybeRoute();
    } catch {}
  });
}
bindVehicleSlider();

// ===== Location =====
async function setMyLocation() {
  setMsg("جاري تحديد موقعك...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      if (!myMarker) myMarker = addMarker(map, lat, lng);
      else myMarker.setLatLng([lat, lng]);
      map.setView([lat, lng], 15);
      setMsg("");
    },
    (err) => setMsg("تعذر تحديد الموقع: " + err.message),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

// ===== Search =====
async function searchFrom() {
  const q = $("#fromInput")?.value?.trim() || "";
  if (!q) return;

  setMsg("بحث القيام...");
  const r = await geocodeNominatim(q);
  if (!r) return setMsg("مش لاقي المكان");

  from = { lat: r.lat, lng: r.lng, label: r.display };
  if (!fromMarker) fromMarker = addMarker(map, from.lat, from.lng);
  else fromMarker.setLatLng([from.lat, from.lng]);

  map.setView([from.lat, from.lng], 15);
  setMsg("");
  await maybeRoute();
}

async function searchTo() {
  const q = $("#toInput")?.value?.trim() || "";
  if (!q) return;

  setMsg("بحث الوصول...");
  const r = await geocodeNominatim(q);
  if (!r) return setMsg("مش لاقي المكان");

  to = { lat: r.lat, lng: r.lng, label: r.display };
  if (!toMarker) toMarker = addMarker(map, to.lat, to.lng);
  else toMarker.setLatLng([to.lat, to.lng]);

  map.setView([to.lat, to.lng], 15);
  setMsg("");
  await maybeRoute();
}

// ===== Route =====
async function maybeRoute() {
  if (!from || !to) return;

  setMsg("جاري رسم المسار...");
  const r = await routeOSRM(from, to);
  if (!r) return setMsg("فشل رسم المسار");

  routePoly = drawRoute(map, r.geojson, routePoly);

  const info = $("#routeInfo");
  if (info) info.textContent = `المسافة: ${km(r.distance_m)} كم | الوقت: ${mins(r.duration_s)} دقيقة`;

  // سعر مقترح حسب المسافة + نوع المركبة (يتكتب في السلايدر فقط لو المستخدم ما لمسهوش)
  const suggested = estimatePrice(r.distance_m, selectedVehicle);
  const clamped = Math.max(15, Math.min(3000, suggested));

  if (!priceTouched && priceRange && priceValue) {
    selectedPrice = clamped;
    priceRange.value = String(clamped);
    priceValue.textContent = String(clamped);
  }

  setMsg("");
}

// ===== Create Ride =====
async function requestRide() {
  const user = auth.currentUser;
  if (!user) return setMsg("ارجع سجل دخول");

  if (!from || !to) return setMsg("حدد القيام والوصول");

  // مؤقتًا لحد ما ننقلها لبيانات التسجيل (هنعمل ده في المرحلة القادمة)
  if (!myGovernorate || !myCenter) {
  return setMsg("بيانات المحافظة أو المركز ناقصة في الحساب");
}
  setMsg("جاري إنشاء الطلب...");
  rideId = await createRideRequest({
    passengerId: user.uid,
    governorate: myGovernorate,
center: myCenter,

    vehicleType: selectedVehicle,

    fromText: $("#fromInput")?.value?.trim() || "",
    toText: $("#toInput")?.value?.trim() || "",
    from: { lat: from.lat, lng: from.lng },
    to: { lat: to.lat, lng: to.lng },

    // ✅ السعر اللي بالسحب
    price: selectedPrice,
    priceText: selectedPrice + " جنيه",
  });

  setMsg(`تم إنشاء الطلب ✅ رقم: ${rideId}`);

  if (unRide) unRide();
  unRide = listenRide(rideId, (ride) => {
    if (!ride) return;
    setMsg(`حالة الطلب: ${ride.status}` + (ride.driverId ? " | تم قبوله" : ""));
  });
}

// ===== Track Driver =====
function trackDriver() {
  if (!rideId) return setMsg("اعمل طلب الأول");

  if (unLive) unLive();
  setMsg("التتبع شغال ✅");

  unLive = listenDriverLive(rideId, (live) => {
    if (!live?.pos) return;

    const lat = live.pos.latitude;
    const lng = live.pos.longitude;

    if (!driverMarker) driverMarker = addMarker(map, lat, lng);
    else driverMarker.setLatLng([lat, lng]);
  });
}

// ===== UI Events =====
$("#myLoc")?.addEventListener("click", setMyLocation);
$("#fromSearch")?.addEventListener("click", () => searchFrom().catch((e) => setMsg(e.message)));
$("#toSearch")?.addEventListener("click", () => searchTo().catch((e) => setMsg(e.message)));
$("#requestRide")?.addEventListener("click", () => requestRide().catch((e) => setMsg(e.message)));
$("#trackRide")?.addEventListener("click", trackDriver);

$("#logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "login.html";
});

// ===== Auth Guard =====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const profile = await getMyProfile(user.uid);
  let myGovernorate = profile?.governorate || "";
let myCenter = profile?.center || "";
  $("#who").textContent = `راكب — ${user.email}`;

  // لو داخل غلط
  if (profile?.role && profile.role !== "passenger") {
    location.href = profile.role === "driver" ? "driver.html" : "passenger.html";
  }
});

// ===== Bottom Sheet Drag + Snap =====
const sheet = document.getElementById("sheet");
const grab = document.getElementById("sheetGrab");
const miniOrderBtn = document.getElementById("miniOrderBtn");

function setSheetState(state) {
  if (!sheet) return;
  sheet.classList.remove("is-min", "is-mid", "is-max");
  sheet.classList.add(state);

  setTimeout(() => {
    try {
      map.invalidateSize();
    } catch {}
  }, 220);
}

// البداية
setSheetState("is-mid");

miniOrderBtn?.addEventListener("click", () => {
  document.getElementById("requestRide")?.click();
});

let startY = 0;
let startHeight = 0;
let dragging = false;

function getSheetHeight() {
  return sheet.getBoundingClientRect().height;
}

function snapByHeight(h) {
  const vh = window.innerHeight;
  const minH = 70;
  const midH = Math.round(vh * 0.45);
  const maxH = Math.round(vh * 0.85);

  const distances = [
    { state: "is-min", diff: Math.abs(h - minH) },
    { state: "is-mid", diff: Math.abs(h - midH) },
    { state: "is-max", diff: Math.abs(h - maxH) },
  ];

  distances.sort((a, b) => a.diff - b.diff);
  return distances[0].state;
}

function onDown(e) {
  if (!sheet) return;
  dragging = true;
  const touch = e.touches ? e.touches[0] : e;
  startY = touch.clientY;
  startHeight = getSheetHeight();
  sheet.style.transition = "none";
}

function onMove(e) {
  if (!dragging || !sheet) return;
  const touch = e.touches ? e.touches[0] : e;
  const dy = startY - touch.clientY;

  let newH = startHeight + dy;

  const vh = window.innerHeight;
  const minH = 70;
  const maxH = Math.round(vh * 0.85);

  newH = Math.max(minH, Math.min(maxH, newH));
  sheet.style.height = newH + "px";
}

function onUp() {
  if (!dragging || !sheet) return;
  dragging = false;
  sheet.style.transition = "";
  const h = getSheetHeight();
  const state = snapByHeight(h);
  sheet.style.height = "";
  setSheetState(state);
}

if (grab) {
  grab.addEventListener("touchstart", onDown, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onUp);

  grab.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
