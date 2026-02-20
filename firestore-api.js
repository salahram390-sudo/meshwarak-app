import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDoc, serverTimestamp, collection,
  addDoc, updateDoc, query, where, onSnapshot, GeoPoint
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export async function upsertUserProfile(uid, data){
  await setDoc(doc(db,"users",uid), { ...data, updatedAt: serverTimestamp() }, { merge:true });
}
export async function getMyProfile(uid){
  const snap = await getDoc(doc(db,"users",uid));
  return snap.exists() ? snap.data() : null;
}

export async function createRideRequest(payload){
  const ref = await addDoc(collection(db,"rides"), {
    ...payload,
    status:"pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function acceptRide(rideId, driverId){
  await updateDoc(doc(db,"rides",rideId), {
    status:"accepted",
    driverId,
    updatedAt: serverTimestamp(),
  });
}

export function listenPendingRides(governorate, center, cb){
  const q = query(
    collection(db,"rides"),
    where("status","==","pending"),
    where("governorate","==",governorate),
    where("center","==",center),
  );
  return onSnapshot(q, (snap)=>{
    cb(snap.docs.map(d=>({ id:d.id, ...d.data() })));
  });
}

export function listenRide(rideId, cb){
  return onSnapshot(doc(db,"rides",rideId),(snap)=>{
    cb(snap.exists()? { id:snap.id, ...snap.data() } : null);
  });
}

// Live Tracking
export async function upsertDriverLive(rideId, {lat,lng,heading=null,speed=null}){
  await setDoc(doc(db,"rides",rideId,"live","driver"), {
    pos: new GeoPoint(lat,lng),
    heading, speed,
    updatedAt: serverTimestamp(),
  }, { merge:true });
}
export function listenDriverLive(rideId, cb){
  return onSnapshot(doc(db,"rides",rideId,"live","driver"), (snap)=>{
    cb(snap.exists()? snap.data() : null);
  });
}
