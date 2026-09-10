// Firebase-backed storage + auth layer.
//
// This file is a drop-in replacement for the old IndexedDB-backed storage.js: it implements the
// exact same window.storage.{get,set,delete} shape and the same loadAllAppData / exportProfileData
// / importProfileData functions that App.jsx already imports and calls throughout its hundreds of
// feature handlers — none of that code needed to change. Only the *implementation* changed, from
// local IndexedDB to a per-user Firestore subtree, plus real auth on top.
//
// Data model in Firestore:
//   users/{uid}                       — profile doc: { name, handicap, createdAt }
//   users/{uid}/appData/{storageKey}  — one doc per app storage key: { value: <JSON string>, updatedAt }
//
// Offline: Firestore's persistent local cache is enabled below, so reads/writes work with no
// connection (queued locally) and sync automatically the moment the device is back online — the
// same "just works on the range with no signal" behavior the app already had with IndexedDB.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Every storage key the app reads/writes. Keep this in sync with every window.storage.set/delete
// call in App.jsx — nothing enforces this automatically (same manual-sync risk the original
// sandbox rebuild's storage.js had; see the project handoff, Section 4e/4f, for why the real
// deployed storage.js instead discovers keys dynamically — worth doing here too in a follow-up).
export const APP_DATA_KEYS = [
  "golf:sessions",
  "golf:activeSession",
  "putting:sessions",
  "putting:activeSession",
  "putting:activeRound",
  "putting:clockSessions",
  "tee:sessions",
  "wedgematrix:active",
  "wedgematrix:completed",
  "gapping:active",
  "gapping:completed",
  "gapping:customClubs",
  "shortgame:sessions",
  "shortgame:activeSession",
  "settings:preferences",
  "compete:sessions",
  "compete:shortgame:sessions",
  "compete:putting:sessions",
  ];

let activeUid = null;

export function setActiveProfileId(uid) {
  activeUid = uid;
}

export function getActiveProfileId() {
  return activeUid;
}

function appDataDocRef(uid, key) {
  return doc(db, "users", uid, "appData", key);
}

// Installs window.storage for the given uid. Call this once a user is signed in (and again if
// the signed-in user ever changes) — every existing window.storage.get/set/delete(...) call
// throughout App.jsx then transparently reads/writes that user's Firestore subtree.
export function installWindowStorage(uid) {
  setActiveProfileId(uid);
  window.storage = {
    async get(key) {
      if (!activeUid) return null;
      const snap = await getDoc(appDataDocRef(activeUid, key));
      return snap.exists() ? snap.data().value : null;
    },
    // The third argument (used throughout App.jsx, always passed as `false`) belonged to the
    // real deployed storage.js's own signature; it's accepted and ignored here for compatibility.
    async set(key, value, _flag) {
      if (!activeUid) return;
      await setDoc(appDataDocRef(activeUid, key), { value, updatedAt: Date.now() });
    },
    async delete(key, _flag) {
      if (!activeUid) return;
      await deleteDoc(appDataDocRef(activeUid, key));
    },
  };
}

// Single consolidated load, matching the shape App.jsx's own mount effect expects: a flat
// { [storageKey]: rawStringValue } object covering every key that currently has data.
export async function loadAllAppData() {
  const entries = {};
  if (!activeUid) return entries;
  await Promise.all(
    APP_DATA_KEYS.map(async (key) => {
      const snap = await getDoc(appDataDocRef(activeUid, key));
      if (snap.exists()) entries[key] = snap.data().value;
    })
    );
  return entries;
}

export async function exportProfileData(uid, profileName) {
  const data = {};
  await Promise.all(
    APP_DATA_KEYS.map(async (key) => {
      const snap = await getDoc(appDataDocRef(uid, key));
      if (snap.exists()) data[key] = snap.data().value;
    })
    );
  const payload = { profileName: profileName || "profile", exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(profileName || "profile").replace(/[^a-z0-9]+/gi, "_")}-export.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns the number of keys imported, matching what the Settings screen's import handler
// displays as a confirmation count.
export async function importProfileData(uid, file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed && parsed.data ? parsed.data : parsed;
  let count = 0;
  for (const k of Object.keys(data || {})) {
    if (APP_DATA_KEYS.includes(k) && data[k] !== null && data[k] !== undefined) {
      await setDoc(appDataDocRef(uid, k), { value: data[k], updatedAt: Date.now() });
      count++;
    }
  }
  return count;
}

// Bulk-writes a whole { [storageKey]: rawStringValue } object in one go — used by the
// local-data-migration flow (AuthGate.jsx) to copy a device's pre-login local data into a
// brand-new account right after sign-up, using the exact same per-key document shape as
// everything else in this file.
export async function importAppDataObject(uid, entries) {
  let count = 0;
  for (const k of Object.keys(entries || {})) {
    if (APP_DATA_KEYS.includes(k) && entries[k] !== null && entries[k] !== undefined) {
      await setDoc(appDataDocRef(uid, k), { value: entries[k], updatedAt: Date.now() });
      count++;
    }
  }
  return count;
}

// ===== Auth =====

// `remember` controls whether the session survives closing the browser/app:
// true (default) -> browserLocalPersistence, stays signed in indefinitely, same as before this
// was made configurable. false -> browserSessionPersistence, signed out once the tab/app closes.
// Firebase persistence is a global auth setting, not per-call, so it must be set immediately
// before the sign-up/sign-in call that follows it.
export function signUp(email, password, remember = true) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).then(() =>
    createUserWithEmailAndPassword(auth, email, password)
  );
}

export function signIn(email, password, remember = true) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).then(() =>
    signInWithEmailAndPassword(auth, email, password)
  );
}

export function signOutUser() {
  return firebaseSignOut(auth);
}

// cb receives the Firebase User object (or null when signed out). Returns the unsubscribe fn.
export function watchAuthState(cb) {
  return onAuthStateChanged(auth, cb);
}

// ===== Per-user profile doc (name / handicap) — separate from appData, read on every login =====

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveUserProfile(uid, profile) {
  await setDoc(doc(db, "users", uid), profile, { merge: true });
}

// ===== Add Coach — search coaches, send/withdraw a connection request =====
//
// Talks to the SAME Firebase project's "coaches" and "coachLinks" collections that the Coach
// app (a separate deployed app) reads and writes. A coachLinks doc id is always
// `${playerId}_${coachId}` (never auto-generated), so there's at most one link per pair, and
// re-searching/re-applying to the same coach just reads back the existing doc rather than
// creating a duplicate. See the Coach app repo's firestore.rules for the access rules this
// relies on — a player can only create/read/delete the links that name them, a coach can only
// approve/decline the links that name them.

function coachLinkDocId(playerId, coachId) {
  return `${playerId}_${coachId}`;
}
function coachLinkDocRef(playerId, coachId) {
  return doc(db, "coachLinks", coachLinkDocId(playerId, coachId));
}

// Coach profiles are a small, non-sensitive collection (name/bio/email) meant to be
// discoverable, so this just fetches all of them and filters client-side — simpler and more
// forgiving than a prefix-only Firestore query, and coach counts aren't expected to be large
// enough for that to matter. Empty/whitespace query returns every coach (browse mode).
export async function searchCoaches(queryText) {
  const snap = await getDocs(collection(db, "coaches"));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const q = (queryText || "").trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (c) => (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q)
  );
}

// Live-subscribes to every coachLinks doc naming this player (any status), so Settings/Add Coach
// can show "pending" / "connected" / "declined" against each coach without a manual refresh.
// Returns an unsubscribe function; call it on unmount.
export function watchMyCoachLinks(playerId, cb) {
  const q = query(collection(db, "coachLinks"), where("playerId", "==", playerId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Creates (or re-reads, if one already exists) a pending request from this player to a coach.
// playerName/playerEmail are the player's own profile values, passed in from App.jsx rather than
// read from auth here, so the request shows the same name the player set up in this app, not
// necessarily their auth email's display name (Firebase Auth email/password accounts don't have
// one).
export async function applyToCoach(playerId, playerName, playerEmail, coachId, coachName) {
  const ref = coachLinkDocRef(playerId, coachId);
  const existing = await getDoc(ref);
  if (existing.exists()) return existing.data();
  const payload = {
    playerId,
    playerName,
    playerEmail,
    coachId,
    coachName,
    status: "pending",
    requestedAt: Date.now(),
    respondedAt: null,
  };
  await setDoc(ref, payload);
  return payload;
}

// Withdraws a still-pending request. Firestore rules only allow this while status is "pending" —
// once a coach has approved or declined, the player can no longer delete the link themselves.
export async function withdrawCoachRequest(playerId, coachId) {
  await deleteDoc(coachLinkDocRef(playerId, coachId));
}
