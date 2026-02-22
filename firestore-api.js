// firestore-api.js (clean) - stable exports for passenger.js / driver.js
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

/** ============== Profiles ============== **/

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

// Migration helper (compat)
export async function migrateLegacyProfile(uid) {
  // In your current app, legacy migration may not be needed.
  // Keep it to satisfy imports and allow future extension.
  if (!uid) return false;
  const profile = await getMyProfile(uid);
  if (!profile) return false;
  // Example: normalize role strings
  const role = (profile.role || "passenger").toLowerCase();
  if (role !== profile.role) {
    await upsertUserProfile(uid, { role });
  }
  return true;
}

/** ============== Rides ============== **/

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

// listen one ride (public-ish)
export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

// Private listen (compat name)
export const listenRidePrivate = listenRide;

export function listenMyOpenRideForPassenger(passengerId, cb) {
  // "open" ride = pending/accepted/in_trip (not completed/cancelled)
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", ["pending", "accepted", "in_trip"]),
    orderBy("updatedAt", "desc"),
    limit(1)
  );
  return onSnapshot(q, (snap) => {
    if (snap.empty) return cb(null);
    const d = snap.docs[0];
    cb({ id: d.id, ...d.data() });
  });
}

/** Driver live location store: driversLive/{driverId} */
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

/**
 * Listen pending rides for driver's area.
 * NOTE: Composite indexes can be annoying.
 * To reduce index requirements, we keep only status filter by default,
 * and you can pass governorate/center/vehicleType to filter client-side if needed.
 */
export function listenPendingRides(filters, cb) {
  // Keep server query minimal to avoid "requires an index"
  const q = query(
    collection(db, "rides"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc"),
    limit(25)
  );

  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    const governorate = filters?.governorate || "";
    const center = filters?.center || "";
    const vehicleType = filters?.vehicleType || "";

    // client-side filtering
    const filtered = items.filter((r) => {
      if (governorate && r.governorate !== governorate) return false;
      if (center && r.center !== center) return false;
      if (vehicleType && r.vehicleType !== vehicleType) return false;
      return true;
    });

    cb(filtered);
  });
}

/** Accept a ride (driver side) */
export async function acceptRide(rideId, driverId, driverSnap = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");
  const ref = doc(db, "rides", rideId);

  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // also store active ride on driver profile (optional)
  try {
    await updateDoc(doc(db, "users", driverId), {
      activeRideId: rideId,
      updatedAt: serverTimestamp(),
    });
  } catch (_) {}

  return true;
}

// compat alias (some files import acceptRideDirect)
export const acceptRideDirect = acceptRide;

/** Start trip */
export async function startTrip(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "in_trip",
    startedAt: serverTimestamp(),
    tripMeta: meta,
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Complete trip */
export async function completeTrip(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    completedAt: serverTimestamp(),
    completeMeta: meta,
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Some files import completeRide
export const completeRide = completeTrip;

/** Cancel ride (passenger or driver) */
export async function cancelRide(rideId, meta = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    cancelReason: meta?.reason || "",
    cancelMeta: meta,
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Some files import cancelTrip
export const cancelTrip = cancelRide;

/** Cleanup active ride on driver */
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  try {
    await updateDoc(doc(db, "users", driverId), {
      activeRideId: null,
      updatedAt: serverTimestamp(),
    });
  } catch (_) {}
  return true;
}

/** Passenger Offer flow (optional compat for older files) */
export async function driverMakeOffer(rideId, offer = {}) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    offer,
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

  const offer = ride?.offer || null;
  if (!offer?.driverId) throw new Error("No offer to accept");

  await updateDoc(rideRef, {
    status: "accepted",
    driverId: offer.driverId,
    driverSnap: offer.driverSnap || {},
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

/** ========= Global compat (fix ReferenceError when a file forgets to import) ========= **/
if (typeof window !== "undefined") {
  Object.assign(window, {
    // ride lifecycle
    createRideRequest,
    listenRide,
    listenRidePrivate,
    listenMyOpenRideForPassenger,
    acceptRide,
    acceptRideDirect,
    startTrip,
    completeTrip,
    completeRide,
    cancelRide,
    cancelTrip,

    // driver live
    upsertDriverLive,
    listenDriverLive,
    listenPendingRides,

    // profile
    getMyProfile,
    upsertUserProfile,
    migrateLegacyProfile,

    // offers
    driverMakeOffer,
    passengerAcceptOffer,
    passengerRejectOffer,
    clearDriverActiveRide,
  });
}
