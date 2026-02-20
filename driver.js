import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMyProfile, upsertUserProfile, listenPendingRides, acceptRide, upsertDriverLive } from "./firestore-api.js";
import { createMap, addMarker } from "./map-kit.js";

const $ = (s)=>document.querySelector(s);

const map = createMap("map");
let myMarker=null;

let unPending=null;
let selectedRideId=null;
let selectedRide=null;

let liveRideId=null;
let gpsWatchId=null;

function msg(t){ $("#driverMsg").textContent=t||""; }

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
        <div class="s">${r.governorate} - ${r.center}</div>
        <div class="s">${r.fromText} → ${r.toText}</div>
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
        msg("تم تحديد الطلب ✅ وفتح الخريطة على موقع الراكب");
      }else{
        msg("تم تحديد الطلب ✅");
      }
      renderList(items);
    });
  });
}

async function saveArea(){
  const user = auth.currentUser;
  if(!user) return msg("ارجع سجل دخول");
  const governorate = $("#gov").value.trim();
  const center = $("#center").value.trim();
  if(!governorate || !center) return msg("اكتب المحافظة والمركز");
  await upsertUserProfile(user.uid, { role:"driver", governorate, center });
  msg("تم حفظ المنطقة ✅");
}

function startListen(){
  const governorate = $("#gov").value.trim();
  const center = $("#center").value.trim();
  if(!governorate || !center) return msg("اكتب المحافظة والمركز");

  if(unPending) unPending();
  unPending = listenPendingRides(governorate, center, (items)=>renderList(items));
  msg("تشغيل الطلبات ✅");
}

async function acceptSelected(){
  const user = auth.currentUser;
  if(!user) return msg("ارجع سجل دخول");
  if(!selectedRideId) return msg("اختار طلب الأول");
  await acceptRide(selectedRideId, user.uid);
  liveRideId = selectedRideId;
  msg("تم قبول الطلب ✅ (شغل تتبع GPS)");
}

function startGPS(){
  const user = auth.currentUser;
  if(!user) return msg("ارجع سجل دخول");
  if(!liveRideId) return msg("لازم تقبل طلب الأول");

  if(!navigator.geolocation) return msg("الجهاز لا يدعم GPS");
  if(gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

  msg("تشغيل GPS...");
  gpsWatchId = navigator.geolocation.watchPosition(async (pos)=>{
    const { latitude:lat, longitude:lng, heading, speed } = pos.coords;

    if(!myMarker) myMarker = addMarker(map, lat, lng);
    else myMarker.setLatLng([lat,lng]);

    await upsertDriverLive(liveRideId, {
      lat, lng,
      heading: heading ?? null,
      speed: speed ?? null
    });
  }, (err)=>{
    msg("خطأ GPS: " + err.message);
  }, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });

  msg("التتبع شغال ✅");
}

$("#saveArea").addEventListener("click", ()=>saveArea().catch(e=>msg(e.message)));
$("#startListen").addEventListener("click", startListen);
$("#acceptBtn").addEventListener("click", ()=>acceptSelected().catch(e=>msg(e.message)));
$("#startLive").addEventListener("click", startGPS);

$("#logoutBtn").addEventListener("click", async ()=>{
  await signOut(auth);
  location.href = "login.html";
});

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href="login.html"; return; }
  const profile = await getMyProfile(user.uid);
  $("#who").textContent = `سائق — ${user.email}`;
  if(profile?.role && profile.role !== "driver"){
    location.href = profile.role === "passenger" ? "passenger.html" : "driver.html";
    return;
  }
  // لو عنده منطقة محفوظة اعرضها
  if(profile?.governorate) $("#gov").value = profile.governorate;
  if(profile?.center) $("#center").value = profile.center;
});
