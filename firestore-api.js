// firestore-api.js - Clean compatibility layer for Mashwarak
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

/* -------------------- Profiles -------------------- */

export async function getMyProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Sometimes you had legacy fields; keep as safe no-op upgrade
export async function migrateLegacyProfile(uid) {
  if (!uid) return null;
  const p = await getMyProfile(uid);
  if (!p) return null;
  // ensure minimal fields exist
  await setDoc(
    doc(db, "users", uid),
    { uid, role: p.role || "passenger", updatedAt: serverTimestamp() },
    { merge: true }
  );
  return await getMyProfile(uid);
}

export async function upsertUserProfile(uid, data = {}) {
  if (!uid) throw new Error("Missing uid");
  await setDoc(
    doc(db, "users", uid),
    { ...data, uid, updatedAt: serverTimestamp(), createdAt: data.createdAt || serverTimestamp() },
    { merge: true }
  );
  return true;
}

/* -------------------- Rides Core -------------------- */

export async function createRideRequest(payload = {}) {
  const ridesRef = collection(db, "rides");
  const docRef = await addDoc(ridesRef, {
    ...payload,
    status: payload.status || "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: docRef.id };
}

export async function setRidePrivate(rideId, data = {}) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    private: data,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// Some old code expects listenRidePrivate => we alias to same document
export const listenRidePrivate = listenRide;

/**
 * Listen passenger open ride without forcing composite index:
 * We query by passengerId only, then filter statuses in code.
 */
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    limit(25)
  );

  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    const open = items
      .filter((x) => ["pending", "accepted", "in_trip"].includes(x.status))
      .sort((a, b) => {
        const ta = a.updatedAt?.seconds || 0;
        const tb = b.updatedAt?.seconds || 0;
        return tb - ta;
      })[0] || null;

    cb(open);
  });
}

/* -------------------- Driver Live -------------------- */

export async function upsertDriverLive(driverId, pos) {
  if (!driverId) throw new Error("Missing driverId");
  await setDoc(
    doc(db, "driversLive", driverId),
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
  return onSnapshot(doc(db, "driversLive", driverId), (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

/* -------------------- Driver pending rides list -------------------- */
/**
 * To avoid "query requires an index" for (status+gov+center+vehicleType),
 * we only query by status, then filter client-side.
 */
export function listenPendingRides(filters = {}, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};

  const q = query(collection(db, "rides"), where("status", "==", "pending"), limit(200));

  return onSnapshot(q, (snap) => {
    let items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    items = items.filter((x) => {
      if (governorate && x.governorate !== governorate) return false;
      if (center && x.center !== center) return false;
      if (vehicleType && x.vehicleType !== vehicleType) return false;
      return true;
    });

    items.sort((a, b) => {
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return tb - ta;
    });

    cb(items.slice(0, 25));
  });
}

/* -------------------- Ride actions -------------------- */

export async function acceptRide(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");

  await updateDoc(doc(db, "rides", rideId), {
    status: "accepted",
    driverId,
    driverSnap: driverSnap || {},
    acceptedAt: serverTimestamp(),
    offer: deleteField(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

// compat name
export const acceptRideDirect = acceptRide;

export async function passengerAcceptOffer(rideId, opts = {}) {
  // If your flow uses offer object already on ride:
  // we just mark accepted using offered driver
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");

  const ride = snap.data();
  const offer = ride.offer;
  if (!offer?.driverId) throw new Error("No offer to accept");

  // Optional security check
  if (opts?.passengerId && ride.passengerId && opts.passengerId !== ride.passengerId) {
    throw new Error("Not your ride");
  }

  await updateDoc(ref, {
    status: "accepted",
    driverId: offer.driverId,
    driverSnap: offer.driverSnap || {},
    price: offer.price ?? ride.price ?? null,
    acceptedAt: serverTimestamp(),
    offer: deleteField(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

export async function passengerRejectOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");

  const ride = snap.data();
  if (opts?.passengerId && ride.passengerId && opts.passengerId !== ride.passengerId) {
    throw new Error("Not your ride");
  }

  await updateDoc(ref, {
    status: "pending",
    offer: deleteField(),
    updatedAt: serverTimestamp(),
  });

  return true;
}

export async function startTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    status: "in_trip",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function completeTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    status: "completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function cancelRide(rideId, reason = "") {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    status: "cancelled",
    cancelReason: reason || "",
    updatedAt: serverTimestamp(),
  });
  return true;
}

/* -------------------- Extra compat aliases -------------------- */

// some files import these names:
export const cancelTrip = cancelRide;
export const completeRide = completeTrip;

/**
 * Some older code might call completeTrip but expects completeTrip exists already (ok).
 * Some other might call listenMyOpenRideForPassenger (exists).
 * Some might call setRidePrivate / listenRidePrivate (exists).
 */
