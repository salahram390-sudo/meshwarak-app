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

/** Listen single ride doc. Returns unsubscribe fn. */
export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
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

export function listenDriverLive(driverId, cb) {
  if (!driverId) return () => {};
  const ref = doc(db, "driversLive", driverId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

/**
 * Listen pending rides for driver's area.
 * NOTE: This query needs a composite index when combining multiple where() + orderBy().
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
/** Cancel ride (passenger or driver) */
export async function cancelRide(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
}
