window.addEventListener("error", (e) => {
  alert(`${e.filename}\nline:${e.lineno} col:${e.colno}\n${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  alert(e.reason?.stack || e.reason || "unhandledrejection");
});
// passenger.js
import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getMyProfile,
  upsertUserProfile,
  createRideRequest,
  setRidePrivate,
  listenMyOpenRideForPassenger,
  listenDriverLive,
  passengerAcceptOffer,
  passengerRejectOffer,
  cancelRide,
  completeTrip,
  migrateLegacyProfile,
} from "./firestore-api.js";

import { createMap, addMarker, geocodeNominatim, routeOSRM, drawRoute } from "./map-kit.js";
import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";
import { registerPWA, ensureNotifyPermission } from "./pwa.js";
import { notify, toast } from "./notify.js";

const $ = (s)=>document.querySelector(s);

await registerPWA();

let profile = null;
let myPassenger = null;

let myPos = null;
let myMarker = null;

let selectedVehicle = "tuktuk";
let selectedPrice = 15;
let priceTouched = false;

let from = null, to = null;
let fromMarker = null, toMarker = null;
let routePoly = null;

let openRideUnsub = null;
let rideUnsub = null;
let liveUnsub = null;
let privateUnsub = null;
let currentRide = null;
let currentRideId = null;

const map = createMap("map");

function setMsg(t){ const el=$("#passengerMsg"); if(el) el.textContent=t||""; }
function setRideState(t){ const el=$("#rideState"); if(el) el.textContent=t||"—"; }
function clampPrice(p){ return Math.max(15, Math.min(3000, Math.round(p))); }

function estimatePrice(distance_m, vehicle) {
  const base = { tuktuk:10, motor_delivery:12, car:18, microbus:25, tamanya:22, caboot:30 }[vehicle] ?? 15;
  const perKm = { tuktuk:4, motor_delivery:4, car:6, microbus:8, tamanya:7, caboot:10 }[vehicle] ?? 5;
  return base + perKm * (distance_m / 1000);
}


async function ensureLocations(){
  if(!locationsData) locationsData = await loadEgyptLocations();
  return locationsData;
}
async function initPassengerAreaUI(){
  const govSel = document.getElementById("p_gov");
  const centerSel = document.getElementById("p_center");
  const saveBtn = document.getElementById("p_saveArea");
  if(!govSel || !centerSel || !saveBtn) return;

  const data = await ensureLocations();
  fillSelect(govSel, data.govList, "اختر المحافظة");
  const currentGov = myPassenger?.governorate || "";
  govSel.value = currentGov;
  fillSelect(centerSel, data.centersByGov[currentGov] || [], "اختر المركز/المدينة");
  centerSel.value = myPassenger?.center || "";

  govSel.onchange = ()=>{
    const g = govSel.value;
    fillSelect(centerSel, data.centersByGov[g] || [], "اختر المركز/المدينة");
    centerSel.value = "";
  };

  saveBtn.onclick = async ()=>{
    const governorate = govSel.value;
    const center = centerSel.value;
    if(!governorate) return setMsg("اختار المحافظة");
    if(!center) return setMsg("اختار المركز/المدينة");
    // update profile passenger area + keep driver profile as-is
    const passengerProfile = { ...(profile?.profiles?.passenger || myPassenger || {}), governorate, center };
    await upsertUserProfile(auth.currentUser.uid, {
      activeRole: "passenger",
      profiles: {
        passenger: passengerProfile,
        driver: profile?.profiles?.driver || {},
      }
    });
    myPassenger = passengerProfile;
    toast("تم حفظ المنطقة ✅");
    setMsg("");
  };
}

// ===== Price slider =====
const priceRange = $("#priceRange");
const priceValue = $("#priceValue");
if (priceRange){
  selectedPrice = Number(priceRange.value || 15);
  if (priceValue) priceValue.textContent = String(selectedPrice);
  priceRange.addEventListener("input", ()=>{
    priceTouched = true;
    selectedPrice = Number(priceRange.value);
    if (priceValue) priceValue.textContent = String(selectedPrice);
  });
}

// ===== Vehicle slider =====
(function bindVehicleSlider(){
  const row = $("#vehicleRow");
  if(!row) return;
  row.addEventListener("click", (e)=>{
    const btn = e.target.closest(".vehCard");
    if(!btn) return;
    selectedVehicle = btn.getAttribute("data-veh") || "tuktuk";
    row.querySelectorAll(".vehCard").forEach(x=>x.classList.remove("is-active"));
    btn.classList.add("is-active");
    maybeRoute().catch(()=>{});
  });
})();

// ===== Location =====
async function setMyLocation(){
  setMsg("جاري تحديد موقعك...");
  return new Promise((resolve)=>{
    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if(!myMarker) myMarker = addMarker(map, myPos.lat, myPos.lng);
        else myMarker.setLatLng([myPos.lat, myPos.lng]);
        map.setView([myPos.lat, myPos.lng], 15);
        setMsg("");
        resolve(true);
      },
      (err)=>{ setMsg("تعذر تحديد الموقع: " + err.message); resolve(false); },
      { enableHighAccuracy:true, timeout:12000 }
    );
  });
}

// ===== Search =====
async function searchFrom(){
  const q = ($("#fromInput")?.value||"").trim();
  if(!q) return;
  setMsg("بحث القيام...");
  const r = await geocodeNominatim(q, myPos);
  if(!r) return setMsg("مش لاقي المكان");
  from = { lat:r.lat, lng:r.lng, label:r.display };
  if(!fromMarker) fromMarker = addMarker(map, from.lat, from.lng);
  else fromMarker.setLatLng([from.lat, from.lng]);
  map.setView([from.lat, from.lng], 15);
  setMsg("");
  await maybeRoute();
}

async function searchTo(){
  const q = ($("#toInput")?.value||"").trim();
  if(!q) return;
  setMsg("بحث الوصول...");
  const r = await geocodeNominatim(q, myPos);
  if(!r) return setMsg("مش لاقي المكان");
  to = { lat:r.lat, lng:r.lng, label:r.display };
  if(!toMarker) toMarker = addMarker(map, to.lat, to.lng);
  else toMarker.setLatLng([to.lat, to.lng]);
  map.setView([to.lat, to.lng], 15);
  setMsg("");
  await maybeRoute();
}

function km(m){ return (m/1000).toFixed(2); }
function mins(s){ return Math.round(s/60); }

async function maybeRoute(){
  if(!from || !to) return;
  setMsg("جاري رسم المسار...");
  const r = await routeOSRM(from, to);
  if(!r) return setMsg("فشل رسم المسار");
  routePoly = drawRoute(map, r.geojson, routePoly);
  const info = $("#routeInfo");
  if (info) info.textContent = `المسافة: ${km(r.distance_m)} كم | الوقت: ${mins(r.duration_s)} دقيقة`;

  const suggested = clampPrice(estimatePrice(r.distance_m, selectedVehicle));
  if(!priceTouched && priceRange && priceValue){
    selectedPrice = suggested;
    priceRange.value = String(suggested);
    priceValue.textContent = String(suggested);
  }
  setMsg("");
}

// ===== Ride actions =====
async function requestRide(){
  if(!auth.currentUser) return;
  if(currentRide && ["pending","offer_sent","accepted","in_trip"].includes(currentRide.status)){
    return setMsg("لديك طلب/رحلة نشطة بالفعل");
  }
  if(!myPassenger?.governorate || !myPassenger?.center) return setMsg("بيانات حسابك ناقصة (المحافظة/المركز)");
  if(!from || !to) return setMsg("حدد القيام والوصول");

  const payload = {
    passengerId: auth.currentUser.uid,
    governorate: myPassenger.governorate,
    center: myPassenger.center,
    vehicleType: selectedVehicle,

    fromText: ($("#fromInput")?.value||"").trim(),
    toText: ($("#toInput")?.value||"").trim(),
    from: { lat: from.lat, lng: from.lng },
    to: { lat: to.lat, lng: to.lng },

    price: selectedPrice,
    priceText: selectedPrice + " جنيه",
    passengerSnap: { name: myPassenger.name || "راكب" },
  };

  setMsg("جاري إنشاء الطلب...");
  currentRideId = await createRideRequest(payload);
  // store contact privately (not visible before acceptance)
  await setRidePrivate(currentRideId, "passenger", { phone: myPassenger.phone || "" });
  toast("تم إرسال الطلب ✅");
  setMsg("");
}

async function doCancelRide(){
  if(!currentRideId) return;
  if(!currentRide) return;
  if(["completed","cancelled"].includes(currentRide.status)) return;

  await cancelRide(currentRideId, { byRole:"passenger", byUid: auth.currentUser.uid });
  toast("تم الإلغاء");
}

async function doCompleteRide(){
  if(!currentRideId || !currentRide) return;
  if(!["accepted","in_trip"].includes(currentRide.status)) return setMsg("لا يمكن إنهاء قبل القبول");
  await completeTrip(currentRideId, { byUid: auth.currentUser.uid, byRole:"passenger" });
  toast("تم إنهاء الرحلة ✅");
  stopLive();
}

async function acceptOffer(){
  if(!currentRideId) return;
  await passengerAcceptOffer(currentRideId, { passengerId: auth.currentUser.uid });
  toast("تم قبول العرض ✅");
}
async function rejectOffer(){
  if(!currentRideId) return;
  await passengerRejectOffer(currentRideId, { passengerId: auth.currentUser.uid });
  toast("تم رفض العرض");
}

function startLive(){
  if(!currentRideId) return;
  if(liveUnsub) liveUnsub();
  liveUnsub = listenDriverLive(currentRideId, (live)=>{
    if(!live?.pos) return;
    const lat = live.pos.latitude;
    const lng = live.pos.longitude;
    // reuse driver marker
    if(!window.__driverMarker) window.__driverMarker = addMarker(map, lat, lng);
    else window.__driverMarker.setLatLng([lat,lng]);
  });
}
function stopLive(){
  if(liveUnsub){ liveUnsub(); liveUnsub=null; }
  if(privateUnsub){ privateUnsub(); privateUnsub=null; }
}

// ===== UI State update =====
function renderRideUI(ride){
  currentRide = ride;
  currentRideId = ride?.id || currentRideId;

  const state = ride ? ride.status : "—";
  setRideState(state || "—");

  const offerBox = $("#offerBox");
  const offerText = $("#offerText");
  const acceptBtn = $("#acceptOffer");
  const rejectBtn = $("#rejectOffer");

  const trackBtn = $("#trackRide");
  const cancelBtn = $("#cancelRide");
  const completeBtn = $("#completeRide");
  const reqBtn = $("#requestRide");

  if(!ride){
    if(offerBox) offerBox.style.display="none";
    if(trackBtn) trackBtn.disabled=true;
    if(cancelBtn) cancelBtn.disabled=true;
    if(completeBtn) completeBtn.disabled=true;
    if(reqBtn) reqBtn.disabled=false;
    return;
  }

  const isOpen = ["pending","offer_sent","accepted","in_trip"].includes(ride.status);
  if(reqBtn) reqBtn.disabled = isOpen; // prevent new
  if(cancelBtn) cancelBtn.disabled = !isOpen || ["completed","cancelled"].includes(ride.status);

  const canTrack = ["accepted","in_trip","completed"].includes(ride.status) && !!ride.driverId;
  if(trackBtn) trackBtn.disabled = !canTrack;

  const canComplete = ["accepted","in_trip"].includes(ride.status);
  if(completeBtn) completeBtn.disabled = !canComplete;

  // Offer
  if(ride.status === "offer_sent" && ride.offer?.price){
    if(offerText) offerText.textContent = `السعر المقترح: ${ride.offer.price} جنيه`;
    if(offerBox) offerBox.style.display="";
    if(acceptBtn) acceptBtn.disabled=false;
    if(rejectBtn) rejectBtn.disabled=false;
    notify("مشوارك", "وصلك عرض سعر من السائق");
  }else{
    if(offerBox) offerBox.style.display="none";
  }

 // show driver data if accepted
const d = ride.driverSnap;

  // Private driver contact (available after acceptance)
  if(privateUnsub){ privateUnsub(); privateUnsub=null; }
  if((ride.status === "accepted" || ride.status === "in_trip" || ride.status === "completed") && ride.driverId){
    
    if(d?.name){
      setMsg(`السائق: ${d.name || "—"} | السعر النهائي: ${(ride.finalPrice ?? ride.price) ?? "—"} جنيه`);
    }else{
      setMsg(`تم قبول الطلب ✅ | السعر النهائي: ${(ride.finalPrice ?? ride.price) ?? "—"} جنيه`);
    }
  }
  if(ride.status === "cancelled"){
    setMsg("تم إلغاء الطلب");
    stopLive();
  }
  if(ride.status === "completed"){
    setMsg("تمت الرحلة ✅");
    stopLive();
  }
}

// ===== Bottom sheet drag =====
const sheet = $("#sheet");
const grab = $("#sheetGrab");
const miniOrderBtn = $("#miniOrderBtn");

function setSheetState(state){
  if(!sheet) return;
  sheet.classList.remove("is-min","is-mid","is-max");
  sheet.classList.add(state);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch{} }, 200);
}
setSheetState("is-mid");
miniOrderBtn?.addEventListener("click", ()=> $("#requestRide")?.click());

let startY=0, startH=0, dragging=false;

function getH(){ return sheet.getBoundingClientRect().height; }
function snapState(h){
  const vh = window.innerHeight;
  const minH = 70, midH = Math.round(vh*0.45), maxH = Math.round(vh*0.85);
  const arr = [
    ["is-min", Math.abs(h-minH)],
    ["is-mid", Math.abs(h-midH)],
    ["is-max", Math.abs(h-maxH)],
  ].sort((a,b)=>a[1]-b[1]);
  return arr[0][0];
}
function down(e){
  dragging=true;
  const t = e.touches? e.touches[0]: e;
  startY=t.clientY;
  startH=getH();
  sheet.style.transition="none";
}
function move(e){
  if(!dragging) return;
  const t = e.touches? e.touches[0]: e;
  const dy = startY - t.clientY;
  let nh = startH + dy;
  const vh = window.innerHeight;
  nh = Math.max(70, Math.min(Math.round(vh*0.85), nh));
  sheet.style.height = nh + "px";
}
function up(){
  if(!dragging) return;
  dragging=false;
  sheet.style.transition="";
  const state = snapState(getH());
  sheet.style.height="";
  setSheetState(state);
}
if(grab){
  grab.addEventListener("touchstart", down, {passive:true});
  window.addEventListener("touchmove", move, {passive:true});
  window.addEventListener("touchend", up);
  grab.addEventListener("mousedown", down);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

// ===== Switch role modal =====
const switchModal = $("#switchModal");
const closeSwitch = $("#closeSwitch");
const saveSwitch = $("#saveSwitch");
const swMsg = $("#sw_msg");
let locationsData = null;

async function openSwitchToDriver(){
  if(!auth.currentUser) return;
  if(!locationsData) locationsData = await loadEgyptLocations();

  $("#switchTitle").textContent = "تحويل إلى سائق";
  $("#sw_driverFields").style.display = "";
  fillSelect($("#sw_gov"), locationsData.govList, "اختر المحافظة");

  // prefill from existing driver profile or passenger profile
  const driver = profile?.profiles?.driver || {};
  const base = {
    name: driver.name || myPassenger?.name || "",
    phone: driver.phone || myPassenger?.phone || "",
    governorate: driver.governorate || myPassenger?.governorate || "",
    center: driver.center || myPassenger?.center || "",
    vehicleType: driver.vehicleType || "tuktuk",
    vehicleCode: driver.vehicleCode || ""
  };

  $("#sw_name").value = base.name;
  $("#sw_phone").value = base.phone;
  $("#sw_gov").value = base.governorate;
  fillSelect($("#sw_center"), locationsData.centersByGov[base.governorate] || [], "اختر المركز/المدينة");
  $("#sw_center").value = base.center;
  $("#sw_vehicleType").value = base.vehicleType || "tuktuk";
  $("#sw_vehicleCode").value = base.vehicleCode || "";

  $("#sw_gov").onchange = ()=>{
    const gov = $("#sw_gov").value;
    fillSelect($("#sw_center"), locationsData.centersByGov[gov] || [], "اختر المركز/المدينة");
  };

  swMsg.textContent="";
  switchModal.classList.add("show");
}

closeSwitch?.addEventListener("click", ()=> switchModal.classList.remove("show"));
switchModal?.addEventListener("click", (e)=>{ if(e.target === switchModal) switchModal.classList.remove("show"); });

saveSwitch?.addEventListener("click", async ()=>{
  swMsg.textContent="جاري الحفظ...";
  const name = ($("#sw_name").value||"").trim();
  const phone = ($("#sw_phone").value||"").trim();
  const governorate = $("#sw_gov").value;
  const center = $("#sw_center").value;
  const vehicleType = $("#sw_vehicleType").value;
  const vehicleCode = ($("#sw_vehicleCode").value||"").trim();

  if(!name) return swMsg.textContent="اكتب الاسم";
  if(!/^01\d{9}$/.test(phone)) return swMsg.textContent="رقم الهاتف غير صحيح";
  if(!governorate) return swMsg.textContent="اختار المحافظة";
  if(!center) return swMsg.textContent="اختار المركز/المدينة";
  if(!vehicleCode) return swMsg.textContent="اكتب كود المركبة";

  const driverProfile = { name, phone, governorate, center, vehicleType, vehicleCode };
  await upsertUserProfile(auth.currentUser.uid, {
    activeRole: "driver",
    profiles: {
      passenger: profile?.profiles?.passenger || myPassenger,
      driver: driverProfile
    }
  });
  toast("تم التحويل للسائق ✅");
  window.location.href = "driver.html";
});

// ===== Buttons =====
$("#myLoc")?.addEventListener("click", ()=>setMyLocation());
$("#fromSearch")?.addEventListener("click", ()=>searchFrom().catch(e=>setMsg(e.message)));
$("#toSearch")?.addEventListener("click", ()=>searchTo().catch(e=>setMsg(e.message)));
$("#requestRide")?.addEventListener("click", ()=>requestRide().catch(e=>setMsg(e.message)));
$("#cancelRide")?.addEventListener("click", ()=>doCancelRide().catch(e=>setMsg(e.message)));
$("#completeRide")?.addEventListener("click", ()=>doCompleteRide().catch(e=>setMsg(e.message)));
$("#trackRide")?.addEventListener("click", ()=>startLive());
$("#acceptOffer")?.addEventListener("click", ()=>acceptOffer().catch(e=>setMsg(e.message)));
$("#rejectOffer")?.addEventListener("click", ()=>rejectOffer().catch(e=>setMsg(e.message)));

$("#logoutBtn")?.addEventListener("click", async ()=>{
  await signOut(auth);
  window.location.href = "login.html";
});
$("#homeBtn")?.addEventListener("click", ()=>{
  if(myPos) map.setView([myPos.lat,myPos.lng], 15);
  setSheetState("is-min");
});
$("#switchRoleBtn")?.addEventListener("click", ()=>openSwitchToDriver().catch(e=>setMsg(e.message)));
$("#notifyBtn")?.addEventListener("click", async ()=>{
  const p = await ensureNotifyPermission();
  toast(p === "granted" ? "تم تفعيل الإشعارات ✅" : "لم يتم تفعيل الإشعارات");
});

// ===== Auth guard + listeners =====
onAuthStateChanged(auth, async (user)=>{
  if(!user){ window.location.href="login.html"; return; }

  profile = await getMyProfile(user.uid);
  await migrateLegacyProfile(user.uid);
  if(!profile) profile = await getMyProfile(user.uid);

  // ensure role
  if((profile?.activeRole || "passenger") !== "passenger"){
    window.location.href = "driver.html";
    return;
  }

  myPassenger = profile?.profiles?.passenger || null;
  $("#who").textContent = `راكب — ${myPassenger?.name || "—"}`;
  initPassengerAreaUI().catch(()=>{});

  // load open ride listener
  if(openRideUnsub) openRideUnsub();
  openRideUnsub = listenMyOpenRideForPassenger(user.uid, (ride)=>{
    if(!ride){
      renderRideUI(null);
      currentRide = null;
      currentRideId = null;
      return;
    }
    // keep rideId for actions
    currentRideId = ride.id;
    renderRideUI(ride);

    // if accepted/in_trip and driver exists, offer tracking
    if(["accepted","in_trip"].includes(ride.status) && ride.driverId){
      // do not auto track; only when user clicks
    }
  });

  // initial location
  setMyLocation().catch(()=>{});
});
}
