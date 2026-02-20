import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDoc, serverTimestamp, collection,
  addDoc, updateDoc, query, where, onSnapshot, GeoPoint,
  runTransaction, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/**
 * User Profile Schema:
 * users/{uid} = {
 *   activeRole: "passenger" | "driver",
 *   profiles: {
 *     passenger: { name, phone, governorate, center },
 *     driver: { name, phone, governorate, center, vehicleType, vehicleCode }
 *   }
 * }
 */

export async function upsertUserProfile(uid, data){
  await setDoc(doc(db,"users",uid), { ...data, updatedAt: serverTimestamp() }, { merge:true });
}

export async function getMyProfile(uid){
  const snap = await getDoc(doc(db,"users",uid));
  return snap.exists() ? snap.data() : null;
}

/** Migrate older schema into new profiles.* format (safe to call anytime) */
export async function migrateLegacyProfile(uid){
  const ref = doc(db,"users",uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const d = snap.data() || {};
  if (d.profiles && d.activeRole) return;

  // Legacy fields (role/name/phone/governorate/center/driverVehicleType/vehicleCode)
  const name = d.name || d.displayName || "";
  const phone = d.phone || "";
  const governorate = d.governorate || "";
  const center = d.center || "";
  const legacyRole = d.role || "passenger";

  const passenger = d.profiles?.passenger || { name, phone, governorate, center };
  const driver = d.profiles?.driver || {
    name, phone, governorate, center,
    vehicleType: d.driverVehicleType || d.vehicleType || null,
    vehicleCode: d.vehicleCode || null
  };

  await setDoc(ref, {
    activeRole: d.activeRole || legacyRole,
    profiles: {
      passenger,
      driver: (driver.vehicleType || driver.vehicleCode) ? driver : null
    },
    updatedAt: serverTimestamp()
  }, { merge:true });
}

// ===== Rides =====

export async function createRideRequest(payload){
  // payload should already include passengerId + filter fields + passenger snapshot
  const ref = await addDoc(collection(db,"rides"), {
    ...payload,
    status:"pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function cancelRide(rideId, {byRole, byUid, reason=""}){
  const rideRef = doc(db,"rides",rideId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(rideRef);
    if(!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.status === "completed" || r.status === "cancelled") return;

    tx.update(rideRef, {
      status:"cancelled",
      cancel: { byRole, byUid, reason, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });

    if (r.driverId){
      const driverRef = doc(db,"users",r.driverId);
      const dSnap = await tx.get(driverRef);
      const du = dSnap.exists()? dSnap.data(): {};
      if (du?.driverActiveRideId === rideId){
        tx.update(driverRef, { driverActiveRideId: null, updatedAt: serverTimestamp() });
      }
    }
  });
}

export async function startTrip(rideId, {byUid}){
  await updateDoc(doc(db,"rides",rideId), {
    status:"in_trip",
    trip: { startedBy: byUid, startedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}

export async function completeTrip(rideId, {byUid, byRole}){
  const rideRef = doc(db,"rides",rideId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(rideRef);
    if(!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.status === "completed") return;

    tx.update(rideRef, {
      status:"completed",
      completed: { byUid, byRole, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });

    if (r.driverId){
      const driverRef = doc(db,"users",r.driverId);
      const dSnap = await tx.get(driverRef);
      const du = dSnap.exists()? dSnap.data(): {};
      if (du?.driverActiveRideId === rideId){
        tx.update(driverRef, { driverActiveRideId: null, updatedAt: serverTimestamp() });
      }
    }
  });
}

/**
 * Driver sends offer:
 * - only if ride.status == "pending" and no driverId
 * - ride.status becomes "offer_sent"
 * - offer = { driverId, price, at }
 */
export async function sendDriverOffer(rideId, {driverId, price, driverSnap}){
  const rideRef = doc(db,"rides",rideId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.status !== "pending") throw new Error("الطلب لم يعد متاحًا");
    if (r.driverId) throw new Error("تم قبول الطلب بالفعل");
    tx.update(rideRef, {
      status: "offer_sent",
      offer: { driverId, price, at: serverTimestamp() },
      driverSnap: driverSnap || null,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Passenger accepts offer:
 * - status must be offer_sent
 * - sets driverId + finalPrice + status accepted
 */
export async function passengerAcceptOffer(rideId, {passengerId}){
  const rideRef = doc(db,"rides",rideId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.passengerId !== passengerId) throw new Error("غير مصرح");
    if (r.status !== "offer_sent") throw new Error("لا يوجد عرض سعر صالح");
    const offer = r.offer;
    if (!offer?.driverId) throw new Error("العرض غير مكتمل");

    const driverRef = doc(db,"users",offer.driverId);
    const driverSnap = await tx.get(driverRef);
    const du = driverSnap.exists()? driverSnap.data() : {};
    if (du?.driverActiveRideId) throw new Error("السائق لديه رحلة نشطة بالفعل");

    tx.update(rideRef, {
      status: "accepted",
      driverId: offer.driverId,
      finalPrice: offer.price,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(driverRef, {
      driverActiveRideId: rideId,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function passengerRejectOffer(rideId, {passengerId}){
  const rideRef = doc(db,"rides",rideId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.passengerId !== passengerId) throw new Error("غير مصرح");
    if (r.status !== "offer_sent") throw new Error("لا يوجد عرض سعر");
    tx.update(rideRef, {
      status: "pending",
      offer: null,
      driverSnap: null,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Driver accepts ride directly (without offer) if still pending and driver has no active ride.
 * Also stores driver snapshot and sets final price to passenger price.
 */
export async function acceptRideDirect(rideId, {driverId, driverSnap}){
  const rideRef = doc(db,"rides",rideId);

  await runTransaction(db, async (tx)=>{
    // ensure driver has no active ride
    const activeQ = query(
      collection(db,"rides"),
      where("driverId","==",driverId),
      where("status","in",["accepted","in_trip"])
    );
    // Firestore doesn't allow query in transaction via tx; so we do best effort by checking user doc flag.
    // We'll maintain driverActiveRideId on user doc for strong enforcement.
    const userRef = doc(db,"users",driverId);
    const userSnap = await tx.get(userRef);
    const user = userSnap.exists()? userSnap.data(): {};
    if (user?.driverActiveRideId) throw new Error("لديك رحلة نشطة بالفعل");

    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("الطلب غير موجود");
    const r = snap.data();
    if (r.status !== "pending") throw new Error("الطلب لم يعد متاحًا");
    if (r.driverId) throw new Error("تم قبول الطلب بالفعل");

    tx.update(rideRef, {
      status:"accepted",
      driverId,
      acceptedAt: serverTimestamp(),
      finalPrice: r.price || null,
      driverSnap: driverSnap || null,
      updatedAt: serverTimestamp(),
    });
    tx.update(userRef, {
      driverActiveRideId: rideId,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function clearDriverActiveRide(driverId){
  await updateDoc(doc(db,"users",driverId), { driverActiveRideId: null, updatedAt: serverTimestamp() });
}

export function listenPendingRidesForDriver({governorate, center, vehicleType}, cb){
  const q = query(
    collection(db,"rides"),
    where("status","==","pending"),
    where("governorate","==",governorate),
    where("center","==",center),
    where("vehicleType","==",vehicleType),
    orderBy("createdAt","desc"),
    limit(30)
  );
  return onSnapshot(q, (snap)=>{
    cb(snap.docs.map(d=>({ id:d.id, ...d.data() })));
  });
}

export function listenRide(rideId, cb){
  return onSnapshot(doc(db,"rides",rideId),(snap)=>{
    cb(snap.exists()? { id:snap.id, ...snap.data() } : null);
  });
}

export function listenMyOpenRideForPassenger(passengerId, cb){
  const q = query(
    collection(db,"rides"),
    where("passengerId","==",passengerId),
    where("status","in",["pending","offer_sent","accepted","in_trip"]),
    orderBy("updatedAt","desc"),
    limit(1)
  );
  return onSnapshot(q, (snap)=>{
    const doc0 = snap.docs[0];
    cb(doc0? { id: doc0.id, ...doc0.data() } : null);
  });
}

export function listenMyActiveRideForDriver(driverId, cb){
  // Preferred: use driverActiveRideId field
  return onSnapshot(doc(db,"users",driverId), async (snap)=>{
    const u = snap.exists()? snap.data(): null;
    const id = u?.driverActiveRideId;
    if (!id) return cb(null);
    // Note: caller may also listenRide(id) directly; here we do a one-shot read via listener:
    return cb({ id });
  });
}

// ===== Live Tracking =====
export async function upsertDriverLive(rideId, {lat,lng,heading=null,speed=null}){
  await setDoc(doc(db,"rides",rideId,"live","driver"), {
    pos: new GeoPoint(lat,lng),
    heading, speed,
    updatedAt: serverTimestamp(),
  }, { merge:true });
}
export function listenDriverLive(rideId, cb){
  return onSnapshot(doc(db,"rides",rideId,"live","driver"), (snap)=>{
    cb(snap.exists()? snap.data() : null);
  });
}


// ===== Private ride data (contacts, etc.) =====
export async function setRidePrivate(rideId, key, data){
  await setDoc(doc(db,"rides",rideId,"private",key), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge:true });
}
export function listenRidePrivate(rideId, key, cb){
  return onSnapshot(doc(db,"rides",rideId,"private",key), (snap)=>{
    cb(snap.exists()? snap.data() : null);
  });
}
