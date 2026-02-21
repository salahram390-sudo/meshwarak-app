// Firestore API for Mashwarak (stable exports used by auth/passenger/driver)
import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** Read profile stored at users/{uid}. Returns object or null. */
export async function getMyProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** Upsert profile at users/{uid}. */
export async function upsertUserProfile(uid, data) {
  if (!uid) throw new Error("Missing uid");
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      ...data,
      uid,
      updatedAt: serverTimestamp(),
      createdAt: data?.createdAt || serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

/** Create ride request in rides collection. Returns {id}. */
export async function createRideRequest(payload) {
  const ridesRef = collection(db, "rides");
  const docRef = await addDoc(ridesRef, {
    ...payload,
    status: payload?.status || "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: docRef.id };
}

/** Passenger toggles ride privacy (used if you have private/public separation). */
export async function setRidePrivate(rideId, isPrivate = true) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    isPrivate: !!isPrivate,
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Listen single ride doc. Returns unsubscribe fn. */
export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** Listen private ride doc (compat). */
export function listenRidePrivate(rideId, cb) {
  return listenRide(rideId, cb);
}

/** Passenger: listen for my open ride (pending/accepted) ordered by updatedAt desc. */
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", ["pending", "accepted"]),
    orderBy("updatedAt", "desc"),
    limit(1)
  );
  return onSnapshot(q, (snap) => {
    let item = null;
    snap.forEach((d) => {
      if (!item) item = { id: d.id, ...d.data() };
    });
    cb(item);
  });
}

/** Driver live location store: driversLive/{driverId}. */
export async function upsertDriverLive(driverId, pos) {
  if (!driverId) throw new Error("Missing driverId");
  const ref = doc(db, "driversLive", driverId);
  await setDoc(
    ref,
    {
      driverId,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Listen driver live location. */
export function listenDriverLive(driverId, cb) {
  if (!driverId) return () => {};
  const ref = doc(db, "driversLive", driverId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? snap.data() : null));
}

/**
 * Listen pending rides for driver's area.
 * NOTE: This query needs a composite index when combining multiple where + orderBy.
 */
export function listenPendingRides(filters, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};

  const q = query(
    collection(db, "rides"),
    where("status", "==", "pending"),
    where("governorate", "==", governorate),
    where("center", "==", center),
    where("vehicleType", "==", vehicleType),
    orderBy("createdAt", "desc"),
    limit(25)
  );

  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    cb(items);
  });
}

/** Accept a ride (driver side). */
export async function acceptRide(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");

  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap,
    updatedAt: serverTimestamp(),
  });
}

/** Passenger accept offer (compat if you have offer flow). */
export async function passengerAcceptOffer(rideId, driverId, driverSnap = {}) {
  return acceptRide(rideId, driverId, driverSnap);
}

/** Passenger reject offer (optional - keeps pending). */
export async function passengerRejectOffer(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, { updatedAt: serverTimestamp() });
  return true;
}

/** Cancel ride (passenger or driver). */
export async function cancelRide(rideId, reason = "") {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    cancelReason: reason || "",
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Complete trip (driver). */
export async function completeTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    updatedAt: serverTimestamp(),
  });
  return true;
}

// -------- Compatibility aliases (some files import different names) --------
export const cancelTrip = cancelRide;
export const completeRide = completeTrip;
// -------- Legacy profile migration (compat export) --------
export async function migrateLegacyProfile(uid) {
  // وظيفة توافقية: لو عندك بيانات قديمة بأسماء حقول مختلفة، انقلها هنا.
  // دلوقتي هنخليها Safe No-Op علشان ميكسرش الاستيراد.
  // تقدر تطورها بعدين لو عندك "legacyUsers" أو حقول قديمة.
  if (!uid) return false;

  // مثال (اختياري) لو كنت مخزن قديمًا في users/{uid} لكن بحقول مختلفة:
  // const p = await getMyProfile(uid);
  // if (p && (p.phoneNumber && !p.phone)) {
  //   await upsertUserProfile(uid, { phone: p.phoneNumber });
  //   return true;
  // }

  return true;
}
