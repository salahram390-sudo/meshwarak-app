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

/** Alias used by older files */
export const listenRidePrivate = listenRide;

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
  return true;
}

/** Driver accept directly (compat). */
export async function acceptRideDirect(rideId, driverId, driverSnap = {}) {
  return acceptRide(rideId, driverId, driverSnap);
}

/** Start trip */
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

/** Complete trip */
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

/** Cancel ride (supports reason string OR meta object) */
export async function cancelRide(rideId, reason = "") {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);

  // allow passing meta object: { reason, byRole, byUid }
  let cancelReason = "";
  let cancelledByRole = "";
  let cancelledByUid = "";
  if (reason && typeof reason === "object") {
    cancelReason = reason.reason || "";
    cancelledByRole = reason.byRole || "";
    cancelledByUid = reason.byUid || "";
  } else {
    cancelReason = reason || "";
  }

  await updateDoc(ref, {
    status: "cancelled",
    cancelReason,
    cancelledByRole: cancelledByRole || null,
    cancelledByUid: cancelledByUid || null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Driver active ride cleanup (compat) */
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  // if you store active ride on profile, clear it
  try {
    const ref = doc(db, "users", driverId);
    await updateDoc(ref, {
      activeRideId: null,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    // ignore if user doc doesn't exist
  }
  return true;
}

/** Compatibility aliases some files may import */
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;

/* ================================
 * Compatibility layer (v1 API)
 * ================================ */

// Passenger: listen my open ride (pending/accepted/in_trip) for a passenger
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", ["pending", "accepted", "in_trip"]),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  return onSnapshot(q, (snap) => {
    let ride = null;
    snap.forEach((d) => {
      if (!ride) ride = { id: d.id, ...d.data() };
    });
    cb(ride);
  });
}

// Passenger: submit ride request (alias)
export async function submitRideRequest(payload) {
  return createRideRequest(payload);
}

// Passenger/Driver: cancel ride compat (accepts (rideId, reason?))
export async function cancelRideCompat(rideId, reason = "") {
  return cancelRide(rideId, reason);
}

// Driver: list pending rides for driver's area (alias)
export function listenPendingRidesForDriver(filters, cb) {
  return listenPendingRides(filters, cb);
}

/** Driver offer flow (optional compat)
 * Store driver's price offer inside ride.offer = { driverId, price, driverSnap, ... }.
 */
export async function sendDriverOffer(rideId, offerPayload = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const payload = {
    ...offerPayload,
    createdAt: offerPayload.createdAt || serverTimestamp(),
  };
  await updateDoc(ref, {
    offer: payload,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function acceptDriverOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const snap = await getDoc(doc(db, "rides", rideId));
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();
  const offer = ride.offer || {};
  const driverId = opts.driverId || offer.driverId;
  if (!driverId) throw new Error("No offer to accept");

  await acceptRide(rideId, driverId, offer.driverSnap || opts.driverSnap || {});
  const price = opts.price ?? offer.price;
  if (price != null) {
    await updateDoc(doc(db, "rides", rideId), {
      price: Number(price),
      updatedAt: serverTimestamp(),
    });
  }
  return true;
}

export async function rejectDriverOffer(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    offer: null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Passenger: listen for offer on a ride (alias)
export function listenMyDriverOffer(rideId, cb) {
  return listenRide(rideId, (ride) => cb(ride?.offer || null));
}

// Write private fields for a ride (used by passenger.js)
export async function setRidePrivate(rideId, data = {}, scope = "passenger") {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId, "private", scope);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

// Passenger accept current driver offer on ride
export async function passengerAcceptOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const snap = await getDoc(doc(db, "rides", rideId));
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();
  const offer = ride.offer || {};
  const passengerId = opts.passengerId || ride.passengerId;

  if (opts.passengerId && ride.passengerId && ride.passengerId !== opts.passengerId) {
    throw new Error("Not your ride");
  }

  return acceptDriverOffer(rideId, {
    driverId: offer.driverId,
    price: offer.price,
    passengerId,
  });
}

// Passenger reject current driver offer on ride
export async function passengerRejectOffer(rideId, opts = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const snap = await getDoc(doc(db, "rides", rideId));
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();

  if (opts.passengerId && ride.passengerId && ride.passengerId !== opts.passengerId) {
    throw new Error("Not your ride");
  }

  return rejectDriverOffer(rideId);
}
