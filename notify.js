// notify.js
let audioCtx = null;

function beep(){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    setTimeout(()=>{ try{o.stop();}catch{} }, 160);
  }catch{}
}

export function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(()=> el.classList.add("show"));
  setTimeout(()=>{ el.classList.remove("show"); setTimeout(()=>el.remove(), 220); }, 2600);
}

export function notify(title, body){
  toast(body || title);
  beep();
  try{ navigator.vibrate?.([70,40,70]); }catch{}

  if (!("Notification" in window)) return;
  if (document.visibilityState !== "visible" && Notification.permission === "granted"){
    try{ new Notification(title, { body, silent: true }); }catch{}
  }
}
