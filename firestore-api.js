// firestore-api.js (ESM) - Mashwarak clean API
// Collections used:
// users/{uid}
// rides/{rideId}
// rides_private/{rideId}
// rideslive/{rideId}   (driver live location per ride)

import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, query, where, limit,
  serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** Read profile stored at users/{uid}. Returns object or null. */
export async function getMyProfile(uid){
  if(!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** Upsert profile at users/{uid} (merge). */
export async function upsertUserProfile(uid, data){
  if(!uid) throw new Error("Missing uid");
  const ref = doc(db, "users", uid);
  await setDoc(ref, {
    uid,
    ...data,
    updatedAt: serverTimestamp(),
    createdAt: data?.createdAt || serverTimestamp(),
  }, { merge: true });
  return true;
}

/** Optional helper: ensure legacy profile is migrated to {profiles:{passenger,driver}, activeRole}. */
export async function migrateLegacyProfile(uid){
  if(!uid) return true;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, { uid, activeRole:"passenger", profiles:{}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
    return true;
  }
  const d = snap.data() || {};
  if(d.profiles) return true;
  // try to infer
  const passenger = {
    name: d.name || "",
    phone: d.phone || "",
    governorate: d.governorate || "",
    center: d.center || "",
  };
  const driver = {
    name: d.driverName || "",
    phone: d.driverPhone || "",
    governorate: d.driverGovernorate || d.governorate || "",
    center: d.driverCenter || d.center || "",
    vehicleType: d.vehicleType || "",
    vehicleCode: d.vehicleCode || "",
  };
  await setDoc(ref, {
    profiles: { passenger, driver },
    activeRole: d.activeRole || "passenger",
    updatedAt: serverTimestamp(),
  }, { merge:true });
  return true;
}

/** Create ride request in rides collection. Returns rideId (string). */
export async function createRideRequest(payload){
  const ridesRef = collection(db, "rides");
  const docRef = await addDoc(ridesRef, {
    ...payload,
    status: payload?.status || "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/** Listen single ride doc. Returns unsubscribe fn. */
export function listenRide(rideId, cb){
  if(!rideId) return ()=>{};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap)=>{
    cb(snap.exists() ? ({ id:snap.id, ...snap.data() }) : null);
  });
}

/** Store private data for a ride (phone etc) in rides_private/{rideId} under role key. */
export async function setRidePrivate(rideId, role, data){
  if(!rideId) throw new Error("Missing rideId");
  if(!role) throw new Error("Missing role");
  const ref = doc(db, "rides_private", rideId);
  await setDoc(ref, {
    [role]: data || {},
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge:true });
  return true;
}

/** Listen private data for a ride. */
export function listenRidePrivate(rideId, cb){
  if(!rideId) return ()=>{};
  const ref = doc(db, "rides_private", rideId);
  return onSnapshot(ref, (snap)=>{
    cb(snap.exists() ? snap.data() : null);
  });
}

/** Listen passenger open ride (pending/offer_sent/accepted/in_trip). No orderBy => no composite index needed. */
export function listenMyOpenRideForPassenger(passengerId, cb){
  if(!passengerId) return ()=>{};
  const active = ["pending","offer_sent","accepted","in_trip"];
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", active),
    limit(1)
  );
  return onSnapshot(q, (snap)=>{
    if(snap.empty) return cb(null);
    const d = snap.docs[0];
    cb({ id: d.id, ...d.data() });
  });
}

/** Listen pending rides for a driver's area/vehicle. No orderBy => avoid composite index. */
export function listenPendingRidesForDriver(filters, cb){
  const governorate = filters?.governorate || "";
  const center = filters?.center || "";
  const vehicleType = filters?.vehicleType || "";
  if(!governorate || !center || !vehicleType) return ()=>{};
  const q = query(
    collection(db, "rides"),
    where("status", "==", "pending"),
    where("governorate", "==", governorate),
    where("center", "==", center),
    where("vehicleType", "==", vehicleType),
    limit(25)
  );
  return onSnapshot(q, (snap)=>{
    const items = [];
    snap.forEach((d)=>items.push({ id:d.id, ...d.data() }));
    cb(items);
  });
}

/** Driver sends offer price. */
export async function driverSendOffer(rideId, offer){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "offer_sent",
    offer: offer || {},
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Driver accepts directly. */
export async function acceptRide(rideId, driverId, driverSnap = {}){
  if(!rideId) throw new Error("Missing rideId");
  if(!driverId) throw new Error("Missing driverId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap,
    finalPrice: deleteField(),
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    offer: deleteField(),
  });
  return true;
}
export async function acceptRideDirect(rideId, driverId, driverSnap = {}){
  return acceptRide(rideId, driverId, driverSnap);
}

/** Passenger accepts offer that was sent by driver. */
export async function passengerAcceptOffer(rideId, opts = {}){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();
  if(opts?.passengerId && ride.passengerId && opts.passengerId !== ride.passengerId) throw new Error("Not your ride");
  const offer = ride.offer || {};
  if(!offer.driverId) throw new Error("No offer to accept");
  await updateDoc(ref, {
    status: "accepted",
    driverId: offer.driverId,
    driverSnap: offer.driverSnap || {},
    finalPrice: offer.price ?? ride.price,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    offer: deleteField(),
  });
  return true;
}

/** Passenger rejects offer and returns ride to pending. */
export async function passengerRejectOffer(rideId, opts = {}){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();
  if(opts?.passengerId && ride.passengerId && opts.passengerId !== ride.passengerId) throw new Error("Not your ride");
  await updateDoc(ref, {
    status: "pending",
    offer: deleteField(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Start trip (driver or passenger). */
export async function startTrip(rideId, meta = {}){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "in_trip",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    startedBy: meta || {},
  });
  return true;
}

/** Complete trip. */
export async function completeTrip(rideId, meta = {}){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedBy: meta || {},
  });
  return true;
}

/** Cancel ride. */
export async function cancelRide(rideId, meta = {}){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    cancelBy: meta || {},
    offer: deleteField(),
  });
  return true;
}

/** Driver live location per ride. */
export async function upsertDriverLive(rideId, pos){
  if(!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rideslive", rideId);
  await setDoc(ref, {
    pos: {
      latitude: pos?.lat ?? pos?.latitude ?? null,
      longitude: pos?.lng ?? pos?.longitude ?? null,
    },
    updatedAt: serverTimestamp(),
  }, { merge:true });
  return true;
}
export function listenDriverLive(rideId, cb){
  if(!rideId) return ()=>{};
  const ref = doc(db, "rideslive", rideId);
  return onSnapshot(ref, (snap)=>{
    cb(snap.exists() ? snap.data() : null);
  });
}

/** Clear driver's active ride flag (compat). */
export async function clearDriverActiveRide(driverId){
  if(!driverId) return true;
  const ref = doc(db, "users", driverId);
  await updateDoc(ref, { driverActiveRideId: null, updatedAt: serverTimestamp() });
  return true;
}

/** Compat aliases some files may import. */
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;
