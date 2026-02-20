export function createMap(mapId){
  const map = L.map(mapId, { zoomControl:false }).setView([30.0444,31.2357], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:19, attribution:"&copy; OpenStreetMap"
  }).addTo(map);
  L.control.zoom({ position:"bottomright" }).addTo(map);
  return map;
}

export function addMarker(map, lat, lng){
  return L.marker([lat,lng]).addTo(map);
}

export function addCircleMarker(map, lat, lng){
  return L.circleMarker([lat,lng], { radius:8, weight:2 }).addTo(map);
}

export async function geocodeNominatim(q, opts = {}){
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format","json");
  url.searchParams.set("limit","1");
  url.searchParams.set("q", q);

  // Bias results near user location
  // Nominatim supports viewbox=left,top,right,bottom with bounded=1
  if (opts?.near && typeof opts.near.lat === "number" && typeof opts.near.lng === "number"){
    const lat = opts.near.lat, lng = opts.near.lng;
    // ~20km box (rough)
    const dLat = 0.18, dLng = 0.18;
    const left = lng - dLng, right = lng + dLng;
    const top = lat + dLat, bottom = lat - dLat;
    url.searchParams.set("viewbox", `${left},${top},${right},${bottom}`);
    url.searchParams.set("bounded", "1");
  }

  const res = await fetch(url.toString(), { headers:{ "Accept":"application/json" }});
  if(!res.ok) throw new Error("فشل البحث");
  const data = await res.json();
  if(!data?.length) return null;
  return { lat:+data[0].lat, lng:+data[0].lon, display:data[0].display_name };
}

export async function routeOSRM(from, to){
  const url = `https://router.project-osrm.org/route/v1/driving/${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("فشل رسم المسار");
  const json = await res.json();
  const r = json?.routes?.[0];
  if(!r) return null;
  return { distance_m:r.distance, duration_s:r.duration, geojson:r.geometry };
}

export function drawRoute(map, geojson, prev){
  if(prev) map.removeLayer(prev);
  const poly = L.geoJSON(geojson, { weight:5, opacity:.9 }).addTo(map);
  try{ map.fitBounds(poly.getBounds(), { padding:[40,40] }); }catch{}
  return poly;
}

// Promise-based current location
export function getCurrentLocation(options = {}){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation) return reject(new Error("الجهاز لا يدعم GPS"));
    navigator.geolocation.getCurrentPosition(
      (pos)=>resolve(pos),
      (err)=>reject(err),
      { enableHighAccuracy:true, timeout:12000, maximumAge:1000, ...options }
    );
  });
}
