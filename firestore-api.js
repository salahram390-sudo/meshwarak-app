// firestore-api.js - Clean & stable exports for passenger.js + driver.js
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

// -------------------- Profiles --------------------
export async function getMyProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function upsertUserProfile(uid, data) {
  if (!uid) throw new Error("Missing uid");
  await setDoc(
    doc(db, "users", uid),
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

// Compatibility: some older code may call this
export async function migrateLegacyProfile(/* uid */) {
  return true;
}

// -------------------- Ride Private (no email exposure) --------------------
// Stored at: rides/{rideId}/private/{role}  where role: "passenger" | "driver"
export async function setRidePrivate(rideId, role, data) {
  if (!rideId) throw new Error("Missing rideId");
  if (!role) throw new Error("Missing role");
  await setDoc(
    doc(db, "rides", rideId, "private", role),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return true;
}

export function listenRidePrivate(rideId, role, cb) {
  if (!rideId || !role) return () => {};
  return onSnapshot(doc(db, "rides", rideId, "private", role), (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

// -------------------- Rides --------------------
export async function createRideRequest(payload) {
  const ref = await addDoc(collection(db, "rides"), {
    ...payload,
    status: payload?.status || "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  return onSnapshot(doc(db, "rides", rideId), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// Passenger: listen for my open ride
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    where("status", "in", ["pending", "offer_sent", "accepted", "in_trip"]),
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

// Driver: list pending rides for driver filters
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

// -------------------- Offers / Accept --------------------
async function _setDriverActiveRide(driverId, rideIdOrNull) {
  if (!driverId) return;
  await updateDoc(doc(db, "users", driverId), {
    driverActiveRideId: rideIdOrNull,
    updatedAt: serverTimestamp(),
  });
}

async function _setPassengerActiveRide(passengerId, rideIdOrNull) {
  if (!passengerId) return;
  await updateDoc(doc(db, "users", passengerId), {
    passengerActiveRideId: rideIdOrNull,
    updatedAt: serverTimestamp(),
  });
}

export async function sendDriverOffer(rideId, { driverId, price, driverSnap } = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");
  const ref = doc(db, "rides", rideId);

  await updateDoc(ref, {
    status: "offer_sent",
    offer: { driverId, price: Number(price) || 0, driverSnap: driverSnap || {} },
    updatedAt: serverTimestamp(),
  });

  return true;
}

// Accept directly (driver accepts passenger price)
export async function acceptRide(rideId, { driverId, driverSnap } = {}) {
  if (!rideId) throw new Error("Missing rideId");
  if (!driverId) throw new Error("Missing driverId");

  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();

  await updateDoc(ref, {
    status: "accepted",
    driverId,
    driverSnap: driverSnap || {},
    finalPrice: ride.price ?? null,
    updatedAt: serverTimestamp(),
  });

  await _setDriverActiveRide(driverId, rideId);
  await _setPassengerActiveRide(ride.passengerId, rideId);

  return true;
}

// Passenger accepts offer (final price = offer.price)
export async function passengerAcceptOffer(rideId, { passengerId } = {}) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();

  if (!ride.offer?.driverId) throw new Error("No offer found");

  await updateDoc(ref, {
    status: "accepted",
    driverId: ride.offer.driverId,
    driverSnap: ride.offer.driverSnap || {},
    finalPrice: ride.offer.price ?? ride.price ?? null,
    updatedAt: serverTimestamp(),
  });

  await _setDriverActiveRide(ride.offer.driverId, rideId);
  await _setPassengerActiveRide(passengerId || ride.passengerId, rideId);

  return true;
}

export async function passengerRejectOffer(rideId /*, { passengerId } */) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  // رجّعها pending وامسح offer
  await updateDoc(ref, {
    status: "pending",
    offer: null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

// -------------------- Trip lifecycle --------------------
export async function startTrip(rideId /*, meta */) {
  if (!rideId) throw new Error("Missing rideId");
  await updateDoc(doc(db, "rides", rideId), {
    status: "in_trip",
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function completeTrip(rideId /*, meta */) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();

  await updateDoc(ref, {
    status: "completed",
    updatedAt: serverTimestamp(),
  });

  await _setDriverActiveRide(ride.driverId, null);
  await _setPassengerActiveRide(ride.passengerId, null);

  return true;
}

export async function cancelRide(rideId /*, meta */) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ride not found");
  const ride = snap.data();

  await updateDoc(ref, {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });

  await _setDriverActiveRide(ride.driverId, null);
  await _setPassengerActiveRide(ride.passengerId, null);

  return true;
}

// -------------------- Driver live tracking --------------------
// Stored at: driverLive/{rideId}
export async function upsertDriverLive(rideId, { lat, lng, heading = null, speed = null } = {}) {
  if (!rideId) throw new Error("Missing rideId");
  await setDoc(
    doc(db, "driverLive", rideId),
    {
      pos: {
        latitude: Number(lat),
        longitude: Number(lng),
        heading,
        speed,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

export function listenDriverLive(rideId, cb) {
  if (!rideId) return () => {};
  return onSnapshot(doc(db, "driverLive", rideId), (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

// driver.js expects this (it calls after ride end)
export async function clearDriverActiveRide(driverId) {
  if (!driverId) return true;
  await updateDoc(doc(db, "users", driverId), {
    driverActiveRideId: null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

// -------------------- Compatibility exports (names used in driver.js) --------------------
export const acceptRideDirect = acceptRide;
export const listenPendingRidesForDriver = listenPendingRides;
export const listenRidePrivateCompat = listenRidePrivate; // optional (not used)
export const completeRide = completeTrip;
export const cancelTrip = cancelRide;
