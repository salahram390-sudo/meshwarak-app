// passenger.js
import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMyProfile, createRideRequest, listenRide, listenDriverLive, cancelRideByPassenger } from "./firestore-api.js";
import { createMap, addMarker, geocodeNominatim, routeOSRM, drawRoute, getCurrentLocation } from "./map-kit.js";

const $ = (s)=>document.querySelector(s);

// ===== Notifier (toast + sound + vibrate + system notif when hidden) =====
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); ctx.close(); }, 140);
  }catch{}
}
function toast(msg){
  const el = $("#passengerMsg");
  if(el) el.textContent = msg;
}
async function ensureNotifPermission(){
  try{
    if(!("Notification" in window)) return "unsupported";
    if(Notification.permission === "granted") return "granted";
    if(Notification.permission === "denied") return "denied";
    return await Notification.requestPermission();
  }catch{ return "error"; }
}
async function notify(title, body){
  // always: toast + sound + vibrate
  toast(body || title);
  beep();
  try{ navigator.vibrate?.([80,60,80]); }catch{}
  // system notification only when tab hidden
  try{
    if(document.visibilityState === "hidden"){
      const p = await ensureNotifPermission();
      if(p === "granted"){
        new Notification(title, { body, silent:true });
      }
    }
  }catch{}
}

// ===== Map =====
const map = createMap("map");
let myMarker=null;

let from=null, to=null;
let fromMarker=null, toMarker=null;
let routePoly=null;

let rideId=null;
let rideStatus=null;
let unRide=null, unLive=null;
let driverMarker=null;

let meProfile=null;
let lastNear=null;

// ===== UI State =====
let selectedVehicle = "tuktuk";
let selectedPrice = 15;
let priceTouched = false;

// ===== Price Slider =====
const priceRange = document.getElementById("priceRange");
const priceValue = document.getElementById("priceValue");
if(priceRange){
  selectedPrice = Number(priceRange.value || 15);
  if(priceValue) priceValue.textContent = String(selectedPrice);
  priceRange.addEventListener("input", ()=>{
    priceTouched = true;
    selectedPrice = Number(priceRange.value);
    if(priceValue) priceValue.textContent = String(selectedPrice);
  });
}

// ===== Vehicle Slider =====
function bindVehicleSlider(){
  const row = document.getElementById("vehicleRow");
  if(!row) return;
  row.addEventListener("click",(e)=>{
    const btn = e.target.closest(".vehCard");
    if(!btn) return;
    selectedVehicle = btn.getAttribute("data-veh") || "tuktuk";
    row.querySelectorAll(".vehCard").forEach(x=>x.classList.remove("is-active"));
    btn.classList.add("is-active");
    try{ maybeRoute(); }catch{}
  });
}
bindVehicleSlider();

function km(m){ return (m/1000).toFixed(2); }
function mins(s){ return Math.round(s/60); }
function estimatePrice(distance_m, vehicle){
  const base = { tuktuk:10, motor_delivery:12, car:18, microbus:25, tamanya:22, caboot:30 }[vehicle] ?? 15;
  const perKm = { tuktuk:4, motor_delivery:4, car:6, microbus:8, tamanya:7, caboot:10 }[vehicle] ?? 5;
  return Math.round(base + perKm*(distance_m/1000));
}

async function setMyLocation(auto = false){
  try{
    const pos = await getCurrentLocation();
    const { latitude:lat, longitude:lng } = pos.coords;
    lastNear = { lat, lng };
    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);
    if(auto) map.setView([lat,lng], 15);
  }catch(err){
    if(!auto) toast("تعذر تحديد الموقع: " + (err?.message||err));
  }
}

async function searchFrom(){
  const q = $("#fromInput").value.trim();
  if(!q) return;
  toast("بحث القيام...");
  const r = await geocodeNominatim(q, { near: lastNear });
  if(!r) return toast("مش لاقي المكان");
  from = { lat:r.lat, lng:r.lng, label:r.display };
  if(!fromMarker) fromMarker = addMarker(map, from.lat, from.lng);
  else fromMarker.setLatLng([from.lat,from.lng]);
  map.setView([from.lat,from.lng], 15);
  toast("");
  await maybeRoute();
}
async function searchTo(){
  const q = $("#toInput").value.trim();
  if(!q) return;
  toast("بحث الوصول...");
  const r = await geocodeNominatim(q, { near: lastNear });
  if(!r) return toast("مش لاقي المكان");
  to = { lat:r.lat, lng:r.lng, label:r.display };
  if(!toMarker) toMarker = addMarker(map, to.lat, to.lng);
  else toMarker.setLatLng([to.lat,to.lng]);
  map.setView([to.lat,to.lng], 15);
  toast("");
  await maybeRoute();
}

async function maybeRoute(){
  if(!from || !to) return;
  toast("جاري رسم المسار...");
  const r = await routeOSRM(from,to);
  if(!r) return toast("فشل رسم المسار");
  routePoly = drawRoute(map, r.geojson, routePoly);
  $("#routeInfo").textContent = `المسافة: ${km(r.distance_m)} كم | الوقت: ${mins(r.duration_s)} دقيقة`;

  const suggested = estimatePrice(r.distance_m, selectedVehicle);
  const clamped = Math.max(15, Math.min(3000, suggested));
  if(!priceTouched && priceRange && priceValue){
    selectedPrice = clamped;
    priceRange.value = String(clamped);
    priceValue.textContent = String(clamped);
  }
  toast("");
}

function renderDriverInfo(ride){
  const box = $("#driverInfo");
  if(!box) return;
  if(ride?.status === "accepted" && ride?.driverSnapshot){
    const d = ride.driverSnapshot;
    box.innerHTML = `
      <div class="t">${d.name || "سائق"} • ${d.vehicleType || ""} • ${d.vehicleCode || ""}</div>
      <div class="s">هاتف: ${d.phone || "—"}</div>
    `;
  }else{
    box.innerHTML = `<div class="t">—</div><div class="s">—</div>`;
  }
}

async function requestRide(){
  const user = auth.currentUser;
  if(!user) return toast("ارجع سجل دخول");
  if(!meProfile) return toast("جاري تحميل بيانات الحساب...");
  if(!meProfile.governorate || !meProfile.center) return toast("بيانات المحافظة/المركز ناقصة في حسابك");
  if(!from || !to) return toast("حدد القيام والوصول");

  toast("جاري إنشاء الطلب...");
  rideId = await createRideRequest({
    passengerId: user.uid,
    governorate: meProfile.governorate,
    center: meProfile.center,
    vehicleType: selectedVehicle,

    fromText: $("#fromInput").value.trim(),
    toText: $("#toInput").value.trim(),
    from: { lat:from.lat, lng:from.lng },
    to: { lat:to.lat, lng:to.lng },

    price: selectedPrice,
    priceText: selectedPrice + " جنيه",

    // snapshot للبيانات (بدون إيميل)
    passengerSnapshot: {
      name: meProfile.name || "",
      phone: meProfile.phone || "",
      governorate: meProfile.governorate || "",
      center: meProfile.center || "",
    },
  });

  await notify("تم إنشاء الطلب", `رقم الطلب: ${rideId}`);
  bindRideListeners();
}

function bindRideListeners(){
  if(!rideId) return;
  if(unRide) unRide();
  unRide = listenRide(rideId, (ride)=>{
    if(!ride) return;
    rideStatus = ride.status;
    toast(`حالة الطلب: ${ride.status}`);
    renderDriverInfo(ride);

    // زر الإلغاء
    const canCancel = ["pending","accepted"].includes(ride.status);
    $("#cancelRideBtn").style.display = canCancel ? "" : "none";

    if(ride.status === "accepted"){
      // enable tracking
      $("#trackRide").disabled = false;
      notify("تم قبول الطلب", "تم قبول طلبك — يمكنك تتبع السائق");
    }
    if(ride.status.startsWith("cancelled")){
      $("#trackRide").disabled = true;
      notify("تم إلغاء الرحلة", "تم إلغاء الرحلة");
      if(unLive){ unLive(); unLive=null; }
    }
    if(ride.status === "completed"){
      $("#trackRide").disabled = true;
      notify("تم إنهاء الرحلة", "تم إنهاء الرحلة");
      if(unLive){ unLive(); unLive=null; }
    }
  });
}

function trackDriver(){
  if(!rideId) return toast("اعمل طلب الأول");
  if(unLive) unLive();
  toast("التتبع شغال ✅");
  unLive = listenDriverLive(rideId, (live)=>{
    if(!live?.pos) return;
    const lat = live.pos.latitude;
    const lng = live.pos.longitude;
    if(!driverMarker) driverMarker = addMarker(map, lat, lng);
    else driverMarker.setLatLng([lat,lng]);
  });
}

async function cancelRide(){
  if(!rideId) return;
  await cancelRideByPassenger(rideId);
  await notify("تم الإلغاء", "تم إلغاء الطلب");
}

$("#myLoc").addEventListener("click", ()=>setMyLocation(false));
$("#fromSearch").addEventListener("click", ()=>searchFrom().catch(e=>toast(e.message)));
$("#toSearch").addEventListener("click", ()=>searchTo().catch(e=>toast(e.message)));
$("#requestRide").addEventListener("click", ()=>requestRide().catch(e=>toast(e.message)));
$("#trackRide").addEventListener("click", trackDriver);
$("#cancelRideBtn").addEventListener("click", ()=>cancelRide().catch(e=>toast(e.message)));

$("#logoutBtn").addEventListener("click", async ()=>{
  await signOut(auth);
  location.href = "login.html";
});

// ===== Auth guard + auto location =====
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href="login.html"; return; }
  meProfile = await getMyProfile(user.uid);
  $("#who").textContent = `راكب — ${meProfile?.name || user.email}`;
  // auto locate on load
  setMyLocation(true);
  // default disable
  $("#trackRide").disabled = true;
  $("#cancelRideBtn").style.display = "none";
});

// ===== Bottom Sheet Drag + Snap =====
const sheet = document.getElementById("sheet");
const grab = document.getElementById("sheetGrab");
const miniOrderBtn = document.getElementById("miniOrderBtn");

function setSheetState(state){
  sheet.classList.remove("is-min","is-mid","is-max");
  sheet.classList.add(state);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch{} }, 220);
}
setSheetState("is-mid");

miniOrderBtn?.addEventListener("click", ()=>$("#requestRide")?.click());

let startY=0, startHeight=0, dragging=false;
function getSheetHeight(){ return sheet.getBoundingClientRect().height; }
function snapByHeight(h){
  const vh = window.innerHeight;
  const minH = 70, midH = Math.round(vh*0.45), maxH = Math.round(vh*0.85);
  const arr = [
    {state:"is-min", diff:Math.abs(h-minH)},
    {state:"is-mid", diff:Math.abs(h-midH)},
    {state:"is-max", diff:Math.abs(h-maxH)},
  ].sort((a,b)=>a.diff-b.diff);
  return arr[0].state;
}
function onDown(e){
  dragging=true;
  const t = e.touches? e.touches[0]: e;
  startY = t.clientY;
  startHeight = getSheetHeight();
  sheet.style.transition="none";
}
function onMove(e){
  if(!dragging) return;
  const t = e.touches? e.touches[0]: e;
  const dy = startY - t.clientY;
  let newH = startHeight + dy;
  const vh = window.innerHeight;
  const minH = 70, maxH = Math.round(vh*0.85);
  newH = Math.max(minH, Math.min(maxH, newH));
  sheet.style.height = newH + "px";
}
function onUp(){
  if(!dragging) return;
  dragging=false;
  sheet.style.transition="";
  const h = getSheetHeight();
  const state = snapByHeight(h);
  sheet.style.height="";
  setSheetState(state);
}
grab.addEventListener("touchstart", onDown, {passive:true});
window.addEventListener("touchmove", onMove, {passive:true});
window.addEventListener("touchend", onUp);
grab.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);
