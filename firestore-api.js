// firestore-api.js - Unified Firestore API for Meshwarak
// هدف النسخة دي: 
// 1) توحيد الـ exports اللي صفحاتك بتطلبها (Passenger/Driver/Auth)
// 2) تقليل مشاكل "query requires an index" عن طريق تقليل where المركّبة
// 3) منع "Identifier already declared" (مفيش تكرار لنفس الدوال)

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

/* =========================
   Profiles
========================= */

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

// بعض النسخ القديمة كانت بتنادي migrateLegacyProfile
// نخليه موجود كـ no-op (أو تحط منطق migration لاحقاً)
export async function migrateLegacyProfile(uid) {
  // حالياً: مفيش legacy source عندنا — نرجّع false يعني مفيش حاجة اتعملت
  if (!uid) return false;
  return false;
}

/* =========================
   Ride lifecycle
========================= */

export async function createRideRequest(payload) {
  const ridesRef = collection(db, "rides");
  const docRef = await addDoc(ridesRef, {
    ...payload,
    status: payload?.status || "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id; // passenger.js متوقع rideId string
}

export function listenRide(rideId, cb) {
  if (!rideId) return () => {};
  const ref = doc(db, "rides", rideId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// Passenger: يراقب آخر رحلة مفتوحة بدون شروط مركبة لتقليل الـ indexes
export function listenMyOpenRideForPassenger(passengerId, cb) {
  if (!passengerId) return () => {};
  const q = query(
    collection(db, "rides"),
    where("passengerId", "==", passengerId),
    orderBy("updatedAt", "desc"),
    limit(10)
  );

  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));

    // فلترة محلياً لتجنب composite index
    const open = list.find((r) =>
      ["pending", "accepted", "arrived", "ongoing"].includes((r.status || "").toLowerCase())
    ) || null;

    cb(open);
  });
}

/* =========================
   Driver location live
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
}

export function listenDriverLive(driverId, cb) {
  if (!driverId) return () => {};
  const ref = doc(db, "driversLive", driverId);
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

/* =========================
   Driver: pending rides
========================= */

// لتجنب "The query requires an index":
// هنجيب pending فقط + ترتيب + limit
// وبعدين نفلتر بالمحافظة/المركز/نوع المركبة محلياً.
export function listenPendingRides(filters, cb) {
  const { governorate = "", center = "", vehicleType = "" } = filters || {};

  const q = query(
    collection(db, "rides"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

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

// بعض النسخ القديمة كانت بتنادي acceptRideDirect
export const acceptRideDirect = acceptRide;

/* =========================
   Cancel / Complete
========================= */

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

export async function completeTrip(rideId) {
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "completed",
    updatedAt: serverTimestamp(),
  });
  return true;
}

// Aliases (لأي صفحات بتستخدم أسماء مختلفة)
export const cancelTrip = cancelRide;
export const completeRide = completeTrip;

/* =========================
   Passenger offer actions (إذا صفحاتك بتطلبها)
========================= */

export async function passengerAcceptOffer(rideId) {
  // لو عندك منطق offers لاحقاً، حطه هنا
  // حالياً: هنعتبر accept = تثبيت الحالة accepted لو كانت pending
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, { updatedAt: serverTimestamp() });
  return true;
}

export async function passengerRejectOffer(rideId) {
  // حالياً: reject = cancel (اختياري)
  if (!rideId) throw new Error("Missing rideId");
  const ref = doc(db, "rides", rideId);
  await updateDoc(ref, {
    status: "cancelled",
    cancelReason: "rejected",
    updatedAt: serverTimestamp(),
  });
  return true;
}
