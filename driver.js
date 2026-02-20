// driver.js
import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getMyProfile,
  listenPendingRides,
  acceptRide,
  upsertDriverLive,
  listenDriverActiveRide,
  cancelRideByDriver,
  completeRide,
  listenRide,
} from "./firestore-api.js";
import { createMap, addMarker, getCurrentLocation } from "./map-kit.js";

const $ = (s)=>document.querySelector(s);

// ===== Notifier =====
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 740;
    g.gain.value = 0.06;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); ctx.close(); }, 140);
  }catch{}
}
function toast(msg){
  const el = $("#driverMsg");
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
  toast(body || title);
  beep();
  try{ navigator.vibrate?.([90,70,90]); }catch{}
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

let profile=null;
let unPending=null;
let selectedRideId=null;
let selectedRide=null;

let activeRideId=null;
let unActive=null;
let gpsWatchId=null;
let unRide=null;

function renderArea(){
  $("#areaPill").textContent = `المنطقة: ${profile?.governorate || "—"} - ${profile?.center || "—"}`;
  $("#vehPill").textContent = `المركبة: ${profile?.driverVehicleType || "—"}`;
}

function renderPassengerInfo(ride){
  const box = $("#passengerInfo");
  if(!box) return;
  if(ride?.status === "accepted" && ride?.passengerSnapshot){
    const p = ride.passengerSnapshot;
    box.innerHTML = `
      <div class="t">${p.name || "راكب"}</div>
      <div class="s">هاتف: ${p.phone || "—"}</div>
      <div class="s">${ride.fromText || ""} → ${ride.toText || ""}</div>
      <div class="s">السعر: ${ride.priceText || (ride.price ? ride.price + " جنيه" : "—")}</div>
    `;
  }else{
    box.innerHTML = `<div class="t">—</div><div class="s">—</div>`;
  }
}

function renderList(items){
  const list = $("#ridesList");
  if(!items.length){
    list.innerHTML = `<div class="msg">لا توجد طلبات حاليًا.</div>`;
    selectedRideId=null; selectedRide=null;
    return;
  }

  list.innerHTML = items.map(r=>{
    const active = r.id===selectedRideId ? "card active" : "card";
    return `
      <div class="${active}" data-id="${r.id}">
        <div class="t">#${r.id.slice(0,6)} • ${r.vehicleType} • ${r.priceText || ""}</div>
        <div class="s">${r.fromText || ""} → ${r.toText || ""}</div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-id]").forEach(el=>{
    el.addEventListener("click", ()=>{
      selectedRideId = el.getAttribute("data-id");
      selectedRide = items.find(x=>x.id===selectedRideId);

      const p = selectedRide?.from;
      if(p?.lat && p?.lng){
        map.setView([p.lat,p.lng], 15);
        toast("تم تحديد الطلب ✅ وفتح الخريطة على موقع الراكب");
      }else{
        toast("تم تحديد الطلب ✅");
      }
      renderList(items);
    });
  });
}

function startListen(){
  if(!profile?.governorate || !profile?.center || !profile?.driverVehicleType){
    toast("بيانات الحساب ناقصة (محافظة/مركز/نوع مركبة)");
    return;
  }
  if(unPending) unPending();
  unPending = listenPendingRides(profile.governorate, profile.center, profile.driverVehicleType, (items)=>{
    // إشعار عند وصول طلب جديد (فرق عدد)
    renderList(items);
  });
  toast("تشغيل الطلبات ✅");
}

async function acceptSelected(){
  if(activeRideId) return toast("عندك رحلة نشطة بالفعل. انهيها أو الغيها.");
  const user = auth.currentUser;
  if(!user) return toast("ارجع سجل دخول");
  if(!selectedRideId) return toast("اختار طلب الأول");

  // driver snapshot (بدون ايميل)
  const driverSnapshot = {
    name: profile?.name || "",
    phone: profile?.phone || "",
    vehicleType: profile?.driverVehicleType || "",
    vehicleCode: profile?.vehicleCode || "",
    governorate: profile?.governorate || "",
    center: profile?.center || "",
  };

  await acceptRide(selectedRideId, user.uid, driverSnapshot);
  activeRideId = selectedRideId;
  await notify("تم قبول الطلب", "ابدأ تتبع GPS لإرسال موقعك للراكب");
  bindRide(activeRideId);
}

function bindRide(rideId){
  if(unRide) unRide();
  unRide = listenRide(rideId, (ride)=>{
    if(!ride) return;
    renderPassengerInfo(ride);

    const showActions = ride.status === "accepted";
    $("#cancelRideBtn").style.display = showActions ? "" : "none";
    $("#completeRideBtn").style.display = showActions ? "" : "none";

    if(ride.status.startsWith("cancelled")){
      notify("تم إلغاء الرحلة", "تم إلغاء الرحلة");
      stopGPS();
      activeRideId = null;
    }
    if(ride.status === "completed"){
      notify("تم إنهاء الرحلة", "تم إنهاء الرحلة");
      stopGPS();
      activeRideId = null;
    }
  });
}

async function startGPS(){
  const user = auth.currentUser;
  if(!user) return toast("ارجع سجل دخول");
  if(!activeRideId) return toast("اقبل طلب الأول");

  if(!navigator.geolocation) return toast("الجهاز لا يدعم GPS");
  if(gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

  toast("تشغيل GPS...");
  gpsWatchId = navigator.geolocation.watchPosition(async (pos)=>{
    const { latitude:lat, longitude:lng, heading, speed } = pos.coords;

    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);

    await upsertDriverLive(activeRideId, {
      lat, lng,
      heading: heading ?? null,
      speed: speed ?? null
    });
  }, (err)=>{
    toast("خطأ GPS: " + err.message);
  }, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });

  toast("التتبع شغال ✅");
}

function stopGPS(){
  try{
    if(gpsWatchId){
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }catch{}
}

async function cancelRide(){
  if(!activeRideId) return toast("لا توجد رحلة نشطة");
  await cancelRideByDriver(activeRideId);
  await notify("تم الإلغاء", "تم إلغاء الرحلة");
}

async function completeCurrentRide(){
  if(!activeRideId) return toast("لا توجد رحلة نشطة");
  await completeRide(activeRideId);
  await notify("تم الإنهاء", "تم إنهاء الرحلة");
}

$("#acceptBtn").addEventListener("click", ()=>acceptSelected().catch(e=>toast(e.message)));
$("#startLive").addEventListener("click", startGPS);
$("#cancelRideBtn").addEventListener("click", ()=>cancelRide().catch(e=>toast(e.message)));
$("#completeRideBtn").addEventListener("click", ()=>completeCurrentRide().catch(e=>toast(e.message)));

$("#miniRefreshBtn").addEventListener("click", startListen);

$("#logoutBtn").addEventListener("click", async ()=>{
  await signOut(auth);
  location.href = "login.html";
});

// ===== Auth guard =====
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href="login.html"; return; }
  profile = await getMyProfile(user.uid);
  $("#who").textContent = `سائق — ${profile?.name || user.email}`;

  // لازم يكون سائق
  if(profile?.role && profile.role !== "driver"){
    location.href = profile.role === "passenger" ? "passenger.html" : "driver.html";
    return;
  }

  renderArea();

  // auto locate once
  try{
    const pos = await getCurrentLocation();
    const { latitude:lat, longitude:lng } = pos.coords;
    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);
    map.setView([lat,lng], 15);
  }catch{}

  // listen active ride
  if(unActive) unActive();
  unActive = listenDriverActiveRide(user.uid, (ride)=>{
    if(ride){
      activeRideId = ride.id;
      bindRide(activeRideId);
      toast("عندك رحلة نشطة ✅");
    }else{
      activeRideId = null;
      $("#cancelRideBtn").style.display = "none";
      $("#completeRideBtn").style.display = "none";
      renderPassengerInfo(null);
    }
  });

  // start listening for pending rides automatically
  startListen();

  // hide action buttons initially
  $("#cancelRideBtn").style.display = "none";
  $("#completeRideBtn").style.display = "none";
});

// ===== Bottom Sheet Drag + Snap =====
const sheet = document.getElementById("sheet");
const grab = document.getElementById("sheetGrab");

function setSheetState(state){
  sheet.classList.remove("is-min","is-mid","is-max");
  sheet.classList.add(state);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch{} }, 220);
}
setSheetState("is-mid");

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
