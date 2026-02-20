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

/**
 * geocodeNominatim(q, near?)
 * near: {lat,lng} to bias results around user location (Egypt cities often have duplicates)
 */
export async function geocodeNominatim(q, near=null){
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format","json");
  url.searchParams.set("limit","1");
  url.searchParams.set("accept-language","ar");
  url.searchParams.set("q", q);

  // Bias around user location (~50km box)
  if (near?.lat && near?.lng){
    const d = 0.45; // ~50km
    const left = near.lng - d;
    const right = near.lng + d;
    const top = near.lat + d;
    const bottom = near.lat - d;
    url.searchParams.set("viewbox", `${left},${top},${right},${bottom}`);
    url.searchParams.set("bounded","1");
  }

  const res = await fetch(url.toString(), { headers:{ "Accept":"application/json" }});
  if(!res.ok) throw new Error("فشل البحث");
  const data = await res.json();
  if(!data?.length) return null;
  return { lat:+data[0].lat, lng:+data[0].lon, display:data[0].display_name };
}

export async function routeOSRM(from, to){
  const url = `https://router.project-osrm.org/route/v1/driving/${toNum(from.lng)},${toNum(from.lat)};${toNum(to.lng)},${toNum(to.lat)}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("فشل رسم المسار");
  const json = await res.json();
  const r = json?.routes?.[0];
  if(!r) return null;
  return { distance_m:r.distance, duration_s:r.duration, geojson:r.geometry };
}
function toNum(v){ return Number(v); }

export function drawRoute(map, geojson, prev){
  if(prev) map.removeLayer(prev);
  const poly = L.geoJSON(geojson, { weight:5, opacity:.9 }).addTo(map);
  try{ map.fitBounds(poly.getBounds(), { padding:[40,40] }); }catch{}
  return poly;
}
