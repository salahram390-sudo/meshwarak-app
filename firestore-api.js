// firestore-api.js - CLEAN stable API (single source of truth)
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
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   Profiles
========================= */
export async function getMyProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function upsertUserProfile(uid, data = {}) {
  if (!uid) throw new Error("Missing uid");
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      uid,
      ...data,
      updatedAt: serverTimestamp(),
      createdAt: data?.createdAt || serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

// Compatibility (some files import this)
export async function migrateLegacyProfile(uid, data = {}) {
  return upsertUserProfile(uid, data);
}

/* =========================
   Ride core
========================= */
export async function createRideRequest(payload = {}) {
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

/* =========================
   Ride private: rides/{rideId}/private/{scope}
   scope: "passenger" | "driver"
========================= */
export async function setRidePrivate(rideId, scope = "passenger", data = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId, "private", scope);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export function listenRidePrivate(rideId, scope = "passenger", cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId, "private", scope);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? snap.data() : null));
}

/* =========================
   Passenger "open ride"
   (NO orderBy to avoid composite index)
========================= */
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const openStatuses = ["pending", "offer_sent", "accepted", "in_trip"];

  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", openStatuses),
    limit(10)
  );

  return onSnapshot(q, (snap) => {
    if (snap.empty) return cb(null);

    // pick "most recent" client-side using updatedAt if exists
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => {
      const ta = a?.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
      const tb = b?.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
      return tb - ta;
    });
    cb(items[0] || null);
  });
}

/* =========================
   Driver live location: driversLive/{driverId}
========================= */
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

/* =========================
   Driver pending rides list
   (Avoid composite indexes: query by status only, filter client-side)
========================= */
export function listenPendingRides(filters = {}, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};

  const q = query(collection(db, "rides"), where("status", "==", "pending"), limit(100));

  return onSnapshot(q, (snap) => {
    let items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    // client-side filters
    if (governorate) items = items.filter((x) => (x.governorate || "") === governorate);
    if (center) items = items.filter((x) => (x.center || "") === center);
    if (vehicleType) items = items.filter((x) => (x.vehicleType || "") === vehicleType);

    // client-side sort by createdAt if present
    items.sort((a, b) => {
      const ta = a?.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b?.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    cb(items);
  });
}

// Compatibility export name (some driver.js uses it)
export const listenPendingRidesForDriver = listenPendingRides;

/* =========================
   Offer flow
========================= */
export async function sendDriverOffer(rideId, offer = {}) {
  if (!rideId) throw new Error("Missing rideId");

  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "offer_sent",
    offer: {
      driverId: offer?.driverId || "",
      price: Number(offer?.price || 0),
      driverSnap: offer?.driverSnap || {},
      createdAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });

  return true;
}

export async function passengerAcceptOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");

  const rideRef = doc(db, "rides", rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error("Ride not found");

  const ride = snap.data();
  if (opts?.passengerId && ride?.passengerId && opts.passengerId !== ride.passengerId) {
    throw new Error("Not your ride");
  }

  const offer = ride?.offer;
  if (!offer?.driverId) throw new Error("No offer to accept");

  await updateDoc(rideRef, {
    status: "accepted",
    driverId: offer.driverId,
    driverSnap: offer.driverSnap || {},
    price: Number(offer.price || ride?.price || 0),
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

export async function passengerRejectOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");

  const rideRef = doc(db, "rides", rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error("Ride not found");

  const ride = snap.data();
  if (opts?.passengerId && ride?.passengerId && opts.passengerId !== ride.passengerId) {
    throw new Error("Not your ride");
  }

  await updateDoc(rideRef, {
    status: "pending",
    offer: deleteField(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

/* =========================
   Driver accept directly (compat)
   supports BOTH:
   acceptRideDirect(rideId, driverId, driverSnap)
   acceptRideDirect(rideId, {driverId, driverSnap})
========================= */
export async function acceptRideDirect(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");

  // support object signature
  if (typeof driverId === "object" && driverId) {
    const obj = driverId;
    driverId = obj.driverId;
    driverSnap = obj.driverSnap || {};
  }

  if (!driverId) throw new Error("Missing driverId");

  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap: driverSnap || {},
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

/* =========================
   Trip lifecycle
========================= */
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

/* =========================
   Driver active ride cleanup (compat)
========================= */
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  const ref = doc(db, "users", driverId);
  try {
    await updateDoc(ref, { activeRideId: null, updatedAt: serverTimestamp() });
  } catch (e) {
    // ignore
  }
  return true;
}

/* =========================
   Compatibility aliases
========================= */
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;
