import { auth } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMyProfile, createRideRequest, listenRide, listenDriverLive } from "./firestore-api.js";
import { createMap, addMarker, geocodeNominatim, routeOSRM, drawRoute } from "./map-kit.js";

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
  const v = $("#vehicle").value;
  $("#price").value = estimatePrice(r.distance_m, v) + " جنيه";
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
    vehicleType: $("#vehicle").value,
    fromText: $("#fromInput").value.trim(),
    toText: $("#toInput").value.trim(),
    from: {lat:from.lat,lng:from.lng},
    to: {lat:to.lat,lng:to.lng},
    priceText: $("#price").value || "",
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
$("#vehicle").addEventListener("change", ()=>maybeRoute().catch(()=>{}));
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
