// pwa.js
export async function registerPWA(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  }catch(e){}
}

export async function ensureNotifyPermission(){
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try{
    const p = await Notification.requestPermission();
    return p;
  }catch{
    return "denied";
  }
}
