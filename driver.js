// driver.js
import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getMyProfile,
  upsertUserProfile,
  listenPendingRidesForDriver,
  listenRide,
  acceptRideDirect,
  sendDriverOffer,
  setRidePrivate,
  listenRidePrivate,
  cancelRide,
  startTrip,
  completeTrip,
  upsertDriverLive,
  clearDriverActiveRide
} from "./firestore-api.js";

import { createMap, addMarker } from "./map-kit.js";
import { loadEgyptLocations, fillSelect } from "./egypt-locations.js";
import { registerPWA, ensureNotifyPermission } from "./pwa.js";
import { notify, toast } from "./notify.js";

const $ = (s)=>document.querySelector(s);

await registerPWA();

let profile = null;
let myDriver = null;

let myPos = null;
let myMarker = null;

const map = createMap("map");

// Pending rides listener
let pendingUnsub = null;

// Active ride
let activeRideId = null;
let activeRideUnsub = null;
let watchId = null;
let privateUnsub = null;
let lastSendAt = 0;

// Ride selection for offering / accept
let selectedRideId = null;

function setMsg(t){ const el=$("#driverMsg"); if(el) el.textContent=t||""; }
function setDriverState(t){ const el=$("#driverState"); if(el) el.textContent=t||"—"; }

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

function renderList(rides){
  const list = $("#ridesList");
  if(!list) return;
  list.innerHTML = "";

  if(activeRideId){
    list.innerHTML = '<div class="pill">لا يمكن استقبال طلبات جديدة أثناء وجود رحلة نشطة.</div>';
    return;
  }

  if(!rides?.length){
    list.innerHTML = '<div class="pill">لا توجد طلبات مطابقة الآن.</div>';
    return;
  }

  rides.forEach((r)=>{
    const card = document.createElement("div");
    card.className = "rideCard";
    card.innerHTML = `
      <div class="rideTop">
        <div class="rideTitle">طلب جديد</div>
        <div class="pill">${r.vehicleType || "—"}</div>
      </div>
      <div class="rideMeta">
        <div>القيام: <span class="muted">${escapeHtml(r.fromText || "—")}</span></div>
        <div>الوصول: <span class="muted">${escapeHtml(r.toText || "—")}</span></div>
        <div>سعر الراكب: <b>${r.price ?? "—"}</b> جنيه</div>
      </div>
      <div class="rideActions">
        <button class="btn ghost smallBtn selBtn">تحديد</button>
        <button class="btn ok smallBtn acceptBtn">قبول</button>
      </div>
    `;
    card.querySelector(".selBtn").addEventListener("click", ()=>{
      selectedRideId = r.id;
      toast("تم تحديد الطلب لإرسال عرض سعر");
    });
    card.querySelector(".acceptBtn").addEventListener("click", async ()=>{
      try{
        await acceptSelectedRideDirect(r.id, r);
      }catch(e){
        setMsg(e.message);
      }
    });

    list.appendChild(card);
  });
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

async function acceptSelectedRideDirect(rideId, rideData){
  if(activeRideId) return setMsg("لديك رحلة نشطة بالفعل");
  if(!myDriver) return;

  const driverSnap = {
    name: myDriver.name || "سائق",
    vehicleType: myDriver.vehicleType || "",
    vehicleCode: myDriver.vehicleCode || ""
  };

  await acceptRideDirect(rideId, { driverId: auth.currentUser.uid, driverSnap });
  // store driver contact privately
  await setRidePrivate(rideId, "driver", { phone: myDriver.phone || "" });
  toast("تم قبول الطلب ✅");
  // activeRideId will be discovered via user doc flag (driverActiveRideId) after update
}

async function sendOffer(){
  if(activeRideId) return setMsg("لا يمكن إرسال عروض أثناء رحلة نشطة");
  if(!selectedRideId) return setMsg("حدد طلب أولاً");
  const price = Number($("#offerPrice").value || 0);
  const offer = Math.max(15, Math.min(3000, Math.round(price || 0)));
  if(!offer) return setMsg("اكتب سعر العرض");

  const driverSnap = {
    name: myDriver.name || "سائق",
    vehicleType: myDriver.vehicleType || "",
    vehicleCode: myDriver.vehicleCode || ""
  };

  await sendDriverOffer(selectedRideId, { driverId: auth.currentUser.uid, price: offer, driverSnap });
  // pre-store contact privately (will be readable after acceptance by rules)
  await setRidePrivate(selectedRideId, "driver", { phone: myDriver.phone || "" });
  toast("تم إرسال العرض ✅");
  selectedRideId = null;
  $("#offerPrice").value = "";
}

function showActiveRideBox(show){
  $("#activeRideBox").style.display = show ? "" : "none";
}
function setActiveText(t){
  $("#activeRideText").textContent = t || "—";
}

function stopWatch(){
  try{ if(watchId != null) navigator.geolocation.clearWatch(watchId); }catch{}
  watchId = null;
}
function startWatch(){
  if(!activeRideId) return;
  stopWatch();
  lastSendAt = 0;
  watchId = navigator.geolocation.watchPosition(async (pos)=>{
    const now = Date.now();
    if(now - lastSendAt < 1200) return; // throttle
    lastSendAt = now;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    myPos = { lat, lng };
    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);

    try{
      await upsertDriverLive(activeRideId, {
        lat, lng,
        heading: pos.coords.heading ?? null,
        speed: pos.coords.speed ?? null
      });
    }catch{}
  }, (err)=>{}, { enableHighAccuracy:true, maximumAge:1000, timeout:12000 });
}

async function handleActiveRide(ride){
  if(!ride){
    activeRideId = null;
    showActiveRideBox(false);
    setDriverState("متاح");
    stopWatch();
    if(privateUnsub){ privateUnsub(); privateUnsub=null; }
    if(activeRideUnsub){ activeRideUnsub(); activeRideUnsub=null; }
    // restart pending
    startPendingListener();
    return;
  }

  setDriverState(ride.status);
  showActiveRideBox(true);

  // passenger details
  const p = ride.passengerSnap || {};
  // passenger phone is stored privately
  if(privateUnsub){ privateUnsub(); privateUnsub=null; }
  privateUnsub = listenRidePrivate(ride.id, "passenger", (priv)=>{
    const phone = priv?.phone || "—";
    const finalPrice = (ride.finalPrice ?? ride.price);
    setActiveText(`الراكب: ${p.name || "—"} | هاتف: ${phone} | السعر: ${finalPrice ?? "—"} جنيه`);
  });
  const finalPrice = (ride.finalPrice ?? ride.price);
  

  // markers
  if(ride.from?.lat && ride.from?.lng){
    if(!window.__fromMarker) window.__fromMarker = addMarker(map, ride.from.lat, ride.from.lng);
    else window.__fromMarker.setLatLng([ride.from.lat, ride.from.lng]);
  }
  if(ride.to?.lat && ride.to?.lng){
    if(!window.__toMarker) window.__toMarker = addMarker(map, ride.to.lat, ride.to.lng);
    else window.__toMarker.setLatLng([ride.to.lat, ride.to.lng]);
  }

  // Buttons availability
  $("#startTrip").disabled = !(ride.status === "accepted");
  $("#completeRide").disabled = !(ride.status === "accepted" || ride.status === "in_trip");
  $("#cancelRide").disabled = (ride.status === "completed" || ride.status === "cancelled");

  if(ride.status === "accepted" || ride.status === "in_trip"){
    startWatch();
  }else{
    stopWatch();
  }

  // cleanup on end
  if(ride.status === "completed" || ride.status === "cancelled"){
    stopWatch();
    if(privateUnsub){ privateUnsub(); privateUnsub=null; }
    await clearDriverActiveRide(auth.currentUser.uid);
    toast(ride.status === "completed" ? "تمت الرحلة ✅" : "تم إلغاء الطلب");
    activeRideId = null;
    showActiveRideBox(false);
    setDriverState("متاح");
    // restart pending
    startPendingListener();
  }
}

function startPendingListener(){
  if(pendingUnsub){ pendingUnsub(); pendingUnsub=null; }
  if(activeRideId) return;
  if(!myDriver?.governorate || !myDriver?.center || !myDriver?.vehicleType) return;

  $("#driverFilter").textContent = `${myDriver.governorate} • ${myDriver.center} • ${myDriver.vehicleType}`;

  pendingUnsub = listenPendingRidesForDriver({
    governorate: myDriver.governorate,
    center: myDriver.center,
    vehicleType: myDriver.vehicleType
  }, (rides)=>{
    renderList(rides);
    if(rides?.length) notify("مشوارك", "فيه طلب جديد مناسب ليك");
  });
}

// ===== Switch role modal (to passenger) =====
const switchModal = $("#switchModal");
const closeSwitch = $("#closeSwitch");
const saveSwitch = $("#saveSwitch");
const swMsg = $("#sw_msg");
let locationsData = null;

async function openSwitchToPassenger(){
  if(!auth.currentUser) return;
  if(!locationsData) locationsData = await loadEgyptLocations();

  $("#switchTitle").textContent = "تحويل إلى راكب";
  $("#sw_driverFields").style.display = "none";
  fillSelect($("#sw_gov"), locationsData.govList, "اختر المحافظة");

  const passenger = profile?.profiles?.passenger || {};
  const base = {
    name: passenger.name || myDriver?.name || "",
    phone: passenger.phone || myDriver?.phone || "",
    governorate: passenger.governorate || myDriver?.governorate || "",
    center: passenger.center || myDriver?.center || ""
  };

  $("#sw_name").value = base.name;
  $("#sw_phone").value = base.phone;
  $("#sw_gov").value = base.governorate;
  fillSelect($("#sw_center"), locationsData.centersByGov[base.governorate] || [], "اختر المركز/المدينة");
  $("#sw_center").value = base.center;

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

  if(!name) return swMsg.textContent="اكتب الاسم";
  if(!/^01\d{9}$/.test(phone)) return swMsg.textContent="رقم الهاتف غير صحيح";
  if(!governorate) return swMsg.textContent="اختار المحافظة";
  if(!center) return swMsg.textContent="اختار المركز/المدينة";

  const passengerProfile = { name, phone, governorate, center };
  await upsertUserProfile(auth.currentUser.uid, {
    activeRole: "passenger",
    profiles: {
      passenger: passengerProfile,
      driver: profile?.profiles?.driver || myDriver
    }
  });
  toast("تم التحويل للراكب ✅");
  window.location.href = "passenger.html";
});

// ===== Buttons =====
$("#myLoc")?.addEventListener("click", ()=>setMyLocation());
$("#sendOfferBtn")?.addEventListener("click", ()=>sendOffer().catch(e=>setMsg(e.message)));

$("#startTrip")?.addEventListener("click", async ()=>{
  if(!activeRideId) return;
  await startTrip(activeRideId, { byUid: auth.currentUser.uid });
  toast("بدأت الرحلة");
});
$("#completeRide")?.addEventListener("click", async ()=>{
  if(!activeRideId) return;
  await completeTrip(activeRideId, { byUid: auth.currentUser.uid, byRole:"driver" });
});
$("#cancelRide")?.addEventListener("click", async ()=>{
  if(!activeRideId) return;
  await cancelRide(activeRideId, { byRole:"driver", byUid: auth.currentUser.uid });
});

$("#logoutBtn")?.addEventListener("click", async ()=>{
  await signOut(auth);
  window.location.href = "login.html";
});
$("#homeBtn")?.addEventListener("click", ()=>{
  if(myPos) map.setView([myPos.lat,myPos.lng], 15);
  // shrink sheet
  setSheetState("is-min");
});
$("#switchRoleBtn")?.addEventListener("click", ()=>openSwitchToPassenger().catch(e=>setMsg(e.message)));
$("#notifyBtn")?.addEventListener("click", async ()=>{
  const p = await ensureNotifyPermission();
  toast(p === "granted" ? "تم تفعيل الإشعارات ✅" : "لم يتم تفعيل الإشعارات");
});

// ===== Bottom sheet drag =====
const sheet = $("#sheet");
const grab = $("#sheetGrab");
const miniFocusBtn = $("#miniFocusBtn");

function setSheetState(state){
  if(!sheet) return;
  sheet.classList.remove("is-min","is-mid","is-max");
  sheet.classList.add(state);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch{} }, 200);
}
setSheetState("is-mid");
miniFocusBtn?.addEventListener("click", ()=>setSheetState("is-max"));

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

// ===== Auth guard + listeners =====
onAuthStateChanged(auth, async (user)=>{
  if(!user){ window.location.href="login.html"; return; }
  
  if((profile?.activeRole || "passenger") !== "driver"){
    window.location.href = "passenger.html";
    return;
  }

  myDriver = profile?.profiles?.driver || null;

  // If driver profile missing, force switch modal to fill
  if(!myDriver?.vehicleType || !myDriver?.vehicleCode){
    setMsg("أكمل بيانات السائق للتحويل");
    openSwitchToPassenger().catch(()=>{}); // still allow switch
  }

  $("#who").textContent = `سائق — ${myDriver?.name || "—"}`;
  $("#driverFilter").textContent = `${myDriver?.governorate || "—"} • ${myDriver?.center || "—"} • ${myDriver?.vehicleType || "—"}`;

  await setMyLocation().catch(()=>{});

  // Watch active ride via user doc flag
  // We'll listen to user doc through getMyProfile polling via onSnapshot is in firestore-api, but simple:
  // We'll subscribe to ride once we find driverActiveRideId in profile and refresh on changes via interval.
  // To keep robust, re-read profile every 2 seconds while page open (lightweight).
  setInterval(async ()=>{
    try{
      const p = await getMyProfile(user.uid);
      const id = p?.driverActiveRideId || null;
      if(id !== activeRideId){
        activeRideId = id;
        if(activeRideUnsub){ activeRideUnsub(); activeRideUnsub=null; }
        if(activeRideId){
          if(pendingUnsub){ pendingUnsub(); pendingUnsub=null; }
          activeRideUnsub = listenRide(activeRideId, (ride)=>handleActiveRide(ride).catch(()=>{}));
        }else{
          handleActiveRide(null).catch(()=>{});
        }
      }
    }catch{}
  }, 2000);

  // pending list
  startPendingListener();
});
