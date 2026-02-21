// firestore-api.js (ESM) - Clean + Superset exports
// هدفه: إنهاء مشاكل "export not found" + تقليل حاجة Composite Index قدر الإمكان

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
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** ---------------- Profiles ---------------- */

export async function getMyProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

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

// Compatibility (some old code may call this)
export async function migrateLegacyProfile(uid, patch = {}) {
  // No-op safe migration: just merges patch into profile
  if (!uid) return true;
  await upsertUserProfile(uid, patch);
  return true;
}

/** ---------------- Rides (Passenger) ---------------- */

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

export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// Compatibility name
export const listenRidePrivate = listenRide;

// Avoid composite indexes: DO NOT combine many where+orderBy here.
// We'll fetch passenger's rides by passengerId only, then choose latest client-side if needed.
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(collection(db, "rides"), where("passengerId", "==", passengerId), limit(25));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    // prefer open ride (pending/accepted/in_trip) and most recently updated (client-side)
    const open = items.filter((x) =>
      ["pending", "accepted", "in_trip"].includes((x.status || "").toLowerCase())
    );
    open.sort((a, b) => {
      const ta = a.updatedAt?.seconds || 0;
      const tb = b.updatedAt?.seconds || 0;
      return tb - ta;
    });
    cb(open[0] || null);
  });
}

/** ---------------- Driver live location ---------------- */

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
  return true;
}

export function listenDriverLive(driverId, cb) {
  if (!driverId) return () => {};
  const ref = doc(db, "driversLive", driverId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? snap.data() : null));
}

/** ---------------- Driver rides list ---------------- */

// IMPORTANT: to reduce "requires an index", we only query status == pending.
// Filtering by governorate/center/vehicleType happens client-side.
export function listenPendingRides(filters, cb) {
  const f = filters || {};
  const qBase = query(collection(db, "rides"), where("status", "==", "pending"), limit(50));

  return onSnapshot(qBase, (snap) => {
    let items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    const gov = (f.governorate || "").trim();
    const center = (f.center || "").trim();
    const vehicleType = (f.vehicleType || "").trim();

    if (gov) items = items.filter((x) => (x.governorate || "") === gov);
    if (center) items = items.filter((x) => (x.center || "") === center);
    if (vehicleType) items = items.filter((x) => (x.vehicleType || "") === vehicleType);

    cb(items);
  });
}

export async function acceptRide(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap: driverSnap || {},
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Compatibility name
export const acceptRideDirect = acceptRide;

/** ---------------- Trip lifecycle (compat exports) ---------------- */

export async function startTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "in_trip",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function completeTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Some code asked for "completeRide"
export const completeRide = completeTrip;

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

// Some code asked for "cancelTrip"
export const cancelTrip = cancelRide;

// Optional: keep driver's active ride cleanup (safe no-op if profile missing)
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  try {
    const ref = doc(db, "users", driverId);
    await updateDoc(ref, { activeRideId: null, updatedAt: serverTimestamp() });
  } catch (e) {
    // ignore
  }
  return true;
}
