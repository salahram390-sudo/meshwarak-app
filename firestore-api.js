// firestore-api.js (CLEAN, single source of truth)
// Provides ALL exports used by auth/passenger/driver without duplicates.

import { db } from "./firebase-init.js";

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   Helpers
========================= */
function safeUnsub(unsub) {
  try { if (typeof unsub === "function") unsub(); } catch {}
}

function normalizeProfile(p = {}) {
  // shape: { activeRole, profiles: { passenger, driver }, governorate, center ... legacy fields }
  const profiles = p.profiles || {};
  const legacyPassenger = {
    name: p.name || profiles.passenger?.name || "",
    phone: p.phone || profiles.passenger?.phone || "",
    governorate: p.governorate || profiles.passenger?.governorate || "",
    center: p.center || profiles.passenger?.center || "",
  };

  const legacyDriver = {
    name: p.name || profiles.driver?.name || "",
    phone: p.phone || profiles.driver?.phone || "",
    governorate: p.governorate || profiles.driver?.governorate || "",
    center: p.center || profiles.driver?.center || "",
    vehicleType: p.vehicleType || profiles.driver?.vehicleType || "",
    vehicleCode: p.vehicleCode || profiles.driver?.vehicleCode || "",
  };

  return {
    activeRole: p.activeRole || "passenger",
    profiles: {
      passenger: { ...legacyPassenger, ...(profiles.passenger || {}) },
      driver: { ...legacyDriver, ...(profiles.driver || {}) },
    },
    // status flags
    driverActiveRideId: p.driverActiveRideId ?? null,
    passengerActiveRideId: p.passengerActiveRideId ?? null,
  };
}

/* =========================
   Profiles
========================= */
export async function getMyProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

export async function upsertUserProfile(uid, data = {}) {
  if (!uid) throw new Error("Missing uid");
  const ref = doc(db, "users", uid);
  // Merge, keep timestamps
  await setDoc(
    ref,
    { ...data, uid, updatedAt: serverTimestamp(), createdAt: data.createdAt || serverTimestamp() },
    { merge: true }
  );
  return true;
}

// Migrates legacy flat profile into {activeRole, profiles:{passenger,driver}}
export async function migrateLegacyProfile(uid) {
  if (!uid) throw new Error("Missing uid");
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // create empty normalized profile
    const base = normalizeProfile({});
    await setDoc(ref, { ...base, uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    return base;
  }
  const cur = snap.data() || {};
  const norm = normalizeProfile(cur);
  await setDoc(ref, { ...norm, uid, migratedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  return norm;
}

/* =========================
   Rides core
========================= */
export async function createRideRequest(payload = {}) {
  // payload should include: passengerId, passengerSnap, from,to, fromText,toText, governorate, center, vehicleType, price
  const ridesRef = collection(db, "rides");
  const docRef = await addDoc(ridesRef, {
    ...payload,
    status: payload.status || "pending",
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

/* =========================
   Private ride data (phones, etc)
   Doc: ridesPrivate/{rideId} contains { passenger:{...}, driver:{...} }
========================= */
export async function setRidePrivate(rideId, side, data = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!side) throw new Error("Missing side");
  const ref = doc(db, "ridesPrivate", rideId);
  await setDoc(ref, { [side]: { ...(data || {}), updatedAt: serverTimestamp() } }, { merge: true });
  return true;
}

export function listenRidePrivate(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "ridesPrivate", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

/* =========================
   Driver live tracking
   Doc: driversLive/{rideId} { lat,lng,heading,speed,updatedAt }
========================= */
export async function upsertDriverLive(rideId, pos = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "driversLive", rideId);
  await setDoc(
    ref,
    {
      rideId,
      lat: pos.lat ?? null,
      lng: pos.lng ?? null,
      heading: pos.heading ?? null,
      speed: pos.speed ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

export function listenDriverLive(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "driversLive", rideId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? snap.data() : null));
}

/* =========================
   Pending rides (driver filter)
   IMPORTANT: to avoid composite-index errors, we only query status==pending
   then filter client-side (governorate/center/vehicleType).
========================= */
export function listenPendingRidesForDriver(filters = {}, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};
  const q = query(collection(db, "rides"), where("status", "==", "pending"), limit(50));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    const filtered = items.filter((r) => {
      if (governorate && r.governorate !== governorate) return false;
      if (center && r.center !== center) return false;
      if (vehicleType && r.vehicleType !== vehicleType) return false;
      return true;
    });
    cb(filtered);
  });
}

/* =========================
   Offers + accept
========================= */
export async function sendDriverOffer(rideId, offer = {}) {
  // offer: { driverId, price, driverSnap }
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    offer: {
      driverId: offer.driverId || null,
      price: Number(offer.price || 0),
      driverSnap: offer.driverSnap || {},
      createdAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function acceptRideDirect(rideId, opts = {}) {
  // opts: { driverId, driverSnap }
  if (!rideId) throw new Error("Missing rideId");
  if (!opts.driverId) throw new Error("Missing driverId");

  const rideRef = doc(db, "rides", rideId);
  await updateDoc(rideRef, {
    status: "accepted",
    driverId: opts.driverId,
    driverSnap: opts.driverSnap || {},
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // set driver active ride flag (optional but used by driver.js)
  const userRef = doc(db, "users", opts.driverId);
  await setDoc(userRef, { driverActiveRideId: rideId, updatedAt: serverTimestamp() }, { merge: true });

  return true;
}

// Passenger accept/reject offer (optional compat)
export async function passengerAcceptOffer(rideId, opts = {}) {
  // opts: { passengerId, offerDriverId }
  if (!rideId) throw new Error("Missing rideId");
  const rideRef = doc(db, "rides", rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();
  const driverId = opts.offerDriverId || ride?.offer?.driverId;
  if (!driverId) throw new Error("No offer to accept");

  await updateDoc(rideRef, {
    status: "accepted",
    driverId,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // mark active rides
  if (opts.passengerId) {
    await setDoc(doc(db, "users", opts.passengerId), { passengerActiveRideId: rideId, updatedAt: serverTimestamp() }, { merge: true });
  }
  await setDoc(doc(db, "users", driverId), { driverActiveRideId: rideId, updatedAt: serverTimestamp() }, { merge: true });

  return true;
}

export async function passengerRejectOffer(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const rideRef = doc(db, "rides", rideId);
  await updateDoc(rideRef, {
    // keep status pending but remove offer
    offer: null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

/* =========================
   Trip lifecycle
========================= */
export async function startTrip(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "in_trip",
    startedAt: serverTimestamp(),
    startedBy: meta.byUid || null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function completeTrip(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    completedAt: serverTimestamp(),
    completedBy: meta.byUid || null,
    completedRole: meta.byRole || null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function cancelRide(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    cancelReason: meta.reason || "",
    cancelledBy: meta.byUid || null,
    cancelledRole: meta.byRole || null,
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/* =========================
   Active ride cleanup flag on user doc
========================= */
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  const ref = doc(db, "users", driverId);
  await setDoc(ref, { driverActiveRideId: null, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

/* =========================
   Passenger open ride watcher (no composite index)
========================= */
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(collection(db, "rides"), where("passengerId", "==", passengerId), limit(50));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    const open = items.find((r) => ["pending", "accepted", "in_trip"].includes(r.status));
    cb(open || null);
  });
}

/* =========================
   Backward compatibility aliases
========================= */
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;
export const acceptRideDirectCompat = acceptRideDirect;
