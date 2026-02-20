import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMyProfile, createRideRequest, listenRide, listenDriverLive } from "./firestore-api.js";
import { createMap, addMarker, geocodeNominatim, routeOSRM, drawRoute } from "./map-kit.js";
let selectedPrice = 15;
let priceTouched = false;
let selectedVehicle = "tuktuk";

const $ = (s)=>document.querySelector(s);
const map = createMap("map");

// ===== Price Slider =====
const priceRange = document.getElementById("priceRange");
const priceValue = document.getElementById("priceValue");

if (priceRange) {
  selectedPrice = Number(priceRange.value || 15);
  if (priceValue) priceValue.textContent = selectedPrice;

  priceRange.addEventListener("input", () => {
    priceTouched = true;
    selectedPrice = Number(priceRange.value);
    if (priceValue) priceValue.textContent = selectedPrice;
  });
}

// ===== Vehicle Slider =====
function bindVehicleSlider(){
  const row = document.getElementById("vehicleRow");
  if(!row) return;

  row.addEventListener("click", (e)=>{
    const btn = e.target.closest(".vehCard");
    if(!btn) return;

    selectedVehicle = btn.getAttribute("data-veh") || "tuktuk";

    row.querySelectorAll(".vehCard").forEach(x=>x.classList.remove("is-active"));
    btn.classList.add("is-active");

    try { maybeRoute(); } catch {}
  });
}
bindVehicleSlider();
const $ = (s)=>document.querySelector(s);

const map = createMap("map");
let myMarker=null;

let from=null,to=null;
let fromMarker=null,toMarker=null;
let routePoly=null;

let rideId=null;
let unRide=null, unLive=null;
let driverMarker=null;

function km(m){return (m/1000).toFixed(2)}
function mins(s){return Math.round(s/60)}

function estimatePrice(distance_m, vehicle){
  const suggested = estimatePrice(r.distance_m, selectedVehicle);
const clamped = Math.max(15, Math.min(3000, suggested));

if (!priceTouched && priceRange && priceValue) {
  selectedPrice = clamped;
  priceRange.value = String(clamped);
  priceValue.textContent = String(clamped);
}
  const base = { tuktuk:10, motor_delivery:12, car:18, microbus:25, tamanya:22, caboot:30 }[vehicle] ?? 15;
  const perKm = { tuktuk:4, motor_delivery:4, car:6, microbus:8, tamanya:7, caboot:10 }[vehicle] ?? 5;
  return Math.round(base + perKm*(distance_m/1000));
}

async function setMyLocation(){
  $("#passengerMsg").textContent="جاري تحديد موقعك...";
  navigator.geolocation.getCurrentPosition((pos)=>{
    const {latitude:lat, longitude:lng} = pos.coords;
    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);
    map.setView([lat,lng], 15);
    $("#passengerMsg").textContent="";
  }, (err)=>{
    $("#passengerMsg").textContent="تعذر تحديد الموقع: " + err.message;
  }, { enableHighAccuracy:true, timeout:12000 });
}

async function searchFrom(){
  const q = $("#fromInput").value.trim();
  if(!q) return;
  $("#passengerMsg").textContent="بحث القيام...";
  const r = await geocodeNominatim(q);
  if(!r){ $("#passengerMsg").textContent="مش لاقي المكان"; return; }
  from = {lat:r.lat,lng:r.lng,label:r.display};
  if(!fromMarker) fromMarker = addMarker(map, from.lat, from.lng);
  else fromMarker.setLatLng([from.lat,from.lng]);
  map.setView([from.lat,from.lng], 15);
  $("#passengerMsg").textContent="";
  await maybeRoute();
}

async function searchTo(){
  const q = $("#toInput").value.trim();
  if(!q) return;
  $("#passengerMsg").textContent="بحث الوصول...";
  const r = await geocodeNominatim(q);
  if(!r){ $("#passengerMsg").textContent="مش لاقي المكان"; return; }
  to = {lat:r.lat,lng:r.lng,label:r.display};
  if(!toMarker) toMarker = addMarker(map, to.lat, to.lng);
  else toMarker.setLatLng([to.lat,to.lng]);
  map.setView([to.lat,to.lng], 15);
  $("#passengerMsg").textContent="";
  await maybeRoute();
}

async function maybeRoute(){
  if(!from || !to) return;
  $("#passengerMsg").textContent="جاري رسم المسار...";
  const r = await routeOSRM(from,to);
  if(!r){ $("#passengerMsg").textContent="فشل رسم المسار"; return; }
  routePoly = drawRoute(map, r.geojson, routePoly);
  $("#routeInfo").textContent = `المسافة: ${km(r.distance_m)} كم | الوقت: ${mins(r.duration_s)} دقيقة`;
  const v = selectedVehicle;
  $("#passengerMsg").textContent="";
}

async function requestRide(){
  const user = auth.currentUser;
  if(!user){ $("#passengerMsg").textContent="ارجع سجل دخول"; return; }
  if(!from || !to){ $("#passengerMsg").textContent="حدد القيام والوصول"; return; }
  const governorate = $("#gov").value.trim();
  const center = $("#center").value.trim();
  if(!governorate || !center){ $("#passengerMsg").textContent="اكتب المحافظة والمركز"; return; }

  $("#passengerMsg").textContent="جاري إنشاء الطلب...";
  rideId = await createRideRequest({
    passengerId: user.uid,
    governorate, center,
    vehicleType: selectedVehicle,
    fromText: $("#fromInput").value.trim(),
    toText: $("#toInput").value.trim(),
    from: {lat:from.lat,lng:from.lng},
    to: {lat:to.lat,lng:to.lng},
    price: selectedPrice,
priceText: selectedPrice + " جنيه", || "",
  });

  $("#passengerMsg").textContent = `تم إنشاء الطلب ✅ رقم: ${rideId}`;

  if(unRide) unRide();
  unRide = listenRide(rideId, (ride)=>{
    if(!ride) return;
    $("#passengerMsg").textContent = `حالة الطلب: ${ride.status}` + (ride.driverId ? ` | تم قبوله` : "");
  });
}

function trackDriver(){
  if(!rideId){ $("#passengerMsg").textContent="اعمل طلب الأول"; return; }
  if(unLive) unLive();

  $("#passengerMsg").textContent="التتبع شغال ✅";
  unLive = listenDriverLive(rideId, (live)=>{
    if(!live?.pos) return;
    const lat = live.pos.latitude;
    const lng = live.pos.longitude;
    if(!driverMarker) driverMarker = addMarker(map, lat, lng);
    else driverMarker.setLatLng([lat,lng]);
  });
}

$("#myLoc").addEventListener("click", setMyLocation);
$("#fromSearch").addEventListener("click", ()=>searchFrom().catch(e=>$("#passengerMsg").textContent=e.message));
$("#toSearch").addEventListener("click", ()=>searchTo().catch(e=>$("#passengerMsg").textContent=e.message));
$("#requestRide").addEventListener("click", ()=>requestRide().catch(e=>$("#passengerMsg").textContent=e.message));
$("#trackRide").addEventListener("click", trackDriver);

$("#logoutBtn").addEventListener("click", async ()=>{
  await signOut(auth);
  location.href = "login.html";
});

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href="login.html"; return; }
  const profile = await getMyProfile(user.uid);
  $("#who").textContent = `راكب — ${user.email}`;
  if(profile?.role && profile.role !== "passenger"){
    // لو داخل غلط
    location.href = profile.role === "driver" ? "driver.html" : "passenger.html";
  }
});
// ===== Bottom Sheet Drag + Snap =====
const sheet = document.getElementById("sheet");
const grab = document.getElementById("sheetGrab");
const miniOrderBtn = document.getElementById("miniOrderBtn");

function setSheetState(state){
  sheet.classList.remove("is-min","is-mid","is-max");
  sheet.classList.add(state);

  // مهم عشان الخريطة تعيد حساب الحجم بعد تغيير ارتفاع الشيت
  setTimeout(()=> {
    try { map.invalidateSize(); } catch(e){}
  }, 220);
}

// البداية: mid
setSheetState("is-mid");

// زر "اطلب" الصغير في وضع MIN يضغط نفس زر اطلب مشوار
miniOrderBtn?.addEventListener("click", ()=>{
  document.getElementById("requestRide")?.click();
});

let startY = 0;
let startHeight = 0;
let dragging = false;

function getSheetHeight(){
  return sheet.getBoundingClientRect().height;
}

function snapByHeight(h){
  const vh = window.innerHeight;
  const minH = 70;
  const midH = Math.round(vh * 0.45);
  const maxH = Math.round(vh * 0.85);

  const distances = [
    { state: "is-min", diff: Math.abs(h - minH) },
    { state: "is-mid", diff: Math.abs(h - midH) },
    { state: "is-max", diff: Math.abs(h - maxH) }
  ];

  distances.sort((a,b)=>a.diff-b.diff);
  return distances[0].state;
}

function onDown(e){
  dragging = true;
  const touch = e.touches ? e.touches[0] : e;
  startY = touch.clientY;
  startHeight = getSheetHeight();
  sheet.style.transition = "none";
}

function onMove(e){
  if(!dragging) return;
  const touch = e.touches ? e.touches[0] : e;
  const dy = startY - touch.clientY; // سحب لفوق = زيادة ارتفاع
  let newH = startHeight + dy;

  const vh = window.innerHeight;
  const minH = 78;
  const maxH = Math.round(vh * 0.78);

  newH = Math.max(minH, Math.min(maxH, newH));
  sheet.style.height = newH + "px";
}

function onUp(){
  if(!dragging) return;
  dragging = false;
  sheet.style.transition = "";
  const h = getSheetHeight();
  const state = snapByHeight(h);
  sheet.style.height = ""; // نرجع للي بيتحكم فيه الكلاس
  setSheetState(state);
}

// touch
grab.addEventListener("touchstart", onDown, { passive:true });
window.addEventListener("touchmove", onMove, { passive:true });
window.addEventListener("touchend", onUp);

// mouse (لو فتحت من كمبيوتر)
grab.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);
