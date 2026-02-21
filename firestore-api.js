// firestore-api.js - Clean stable API for Mashwarak (single source of truth)

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

// Compatibility: some files may import this
export async function migrateLegacyProfile(uid, data = {}) {
  // currently same behavior
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
   Ride private (phones, etc.)
   rides/{rideId}/private/{scope}   scope: "passenger" | "driver"
========================= */

export async function setRidePrivate(rideId, scope = "passenger", data = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId, "private", scope);
  await setDoc(
    ref,
    {
      ...data,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

export function listenRidePrivate(rideId, scope = "passenger", cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId, "private", scope);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

/* =========================
   Passenger "open ride"
========================= */

export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};

  // Open statuses for passenger
  const openStatuses = ["pending", "offer_sent", "accepted", "in_trip"];

  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", openStatuses),
    orderBy("updatedAt", "desc"),
    limit(1)
  );

  return onSnapshot(q, (snap) => {
    if (snap.empty) return cb(null);
    const d = snap.docs[0];
    cb({ id: d.id, ...d.data() });
  });
}

/* =========================
   Driver live location
   driversLive/{driverId}
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
========================= */

export function listenPendingRides(filters = {}, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};

  const parts = [
    collection(db, "rides"),
    where("status", "==", "pending"),
  ];

  // only add filters if provided (helps reduce index needs when empty)
  if (governorate) parts.push(where("governorate", "==", governorate));
  if (center) parts.push(where("center", "==", center));
  if (vehicleType) parts.push(where("vehicleType", "==", vehicleType));

  // ordering
  parts.push(orderBy("createdAt", "desc"), limit(25));

  const q = query(...parts);

  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    cb(items);
  });
}

// Compatibility export name required by driver.js
export const listenPendingRidesForDriver = listenPendingRides;

/* =========================
   Offer flow (driver -> passenger)
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
========================= */

export async function acceptRideDirect(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");
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

  // if you store active ride on profile, clear it
  const ref = doc(db, "users", driverId);
  try {
    await updateDoc(ref, {
      activeRideId: null,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    // ignore if user doc doesn't exist
  }
  return true;
}

// Compatibility aliases some files may import:
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;
