import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { upsertUserProfile, getMyProfile } from "./firestore-api.js";

const $ = (s)=>document.querySelector(s);

function go(role){
  window.location.href = role === "driver" ? "driver.html" : "passenger.html";
}

$("#authForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#authMsg").textContent = "جاري التنفيذ...";

  const mode = $("#authMode").value;
  const role = $("#role").value;
  const email = $("#email").value.trim();
  const password = $("#password").value;

  try{
    let cred;
    if(mode === "signup"){
      cred = await createUserWithEmailAndPassword(auth, email, password);
    }else{
      cred = await signInWithEmailAndPassword(auth, email, password);
    }

    await upsertUserProfile(cred.user.uid, {
      role,
      email,
    });

    go(role);
  }catch(err){
    $("#authMsg").textContent = "خطأ: " + (err?.message || err);
  }
});

onAuthStateChanged(auth, async (user)=>{
  if(!user) return;
  // لو مسجل بالفعل، ودّيه على صفحته
  const profile = await getMyProfile(user.uid);
  if(profile?.role) go(profile.role);
});
