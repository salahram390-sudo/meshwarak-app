import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDoc, serverTimestamp, collection,
  addDoc, updateDoc, query, where, onSnapshot, GeoPoint
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ================== Users ==================
export async function upsertUserProfile(uid, data){
  await setDoc(doc(db,"users",uid), { ...data, updatedAt: serverTimestamp() }, { merge:true });
}
export async function getMyProfile(uid){
  const snap = await getDoc(doc(db,"users",uid));
  return snap.exists() ? snap.data() : null;
}

// ================== Rides ==================
export async function createRideRequest(payload){
  const ref = await addDoc(collection(db,"rides"), {
    ...payload,
    status:"pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateRide(rideId, data){
  await updateDoc(doc(db,"rides",rideId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function acceptRide(rideId, driverId, driverSnapshot){
  await updateDoc(doc(db,"rides",rideId), {
    status:"accepted",
    driverId,
    driverSnapshot: driverSnapshot || null,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function cancelRideByPassenger(rideId){
  await updateDoc(doc(db,"rides",rideId), {
    status:"cancelled_by_passenger",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function cancelRideByDriver(rideId){
  await updateDoc(doc(db,"rides",rideId), {
    status:"cancelled_by_driver",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function completeRide(rideId){
  await updateDoc(doc(db,"rides",rideId), {
    status:"completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function listenPendingRides(governorate, center, vehicleType, cb){
  const q = query(
    collection(db,"rides"),
    where("status","==","pending"),
    where("governorate","==",governorate),
    where("center","==",center),
    where("vehicleType","==",vehicleType),
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

// Listen accepted ride for this driver (1 active ride)
export function listenDriverActiveRide(driverId, cb){
  const q = query(
    collection(db,"rides"),
    where("driverId","==",driverId),
    where("status","==","accepted")
  );
  return onSnapshot(q, (snap)=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    cb(items[0] || null);
  });
}

// ================== Live Tracking ==================
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
