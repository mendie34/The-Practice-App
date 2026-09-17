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
  "putting:paceSessions",
  "putting:startLineSessions",
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
  // Keep a minimal, publicly-searchable mirror in sync — see playerDirectory further down
  // (Add Friend section) for why this exists as a separate collection instead of just opening
  // up reads on `users` itself. Only writes fields actually passed in, so a merge-only update
  // elsewhere (e.g. saving just handicap) doesn't blow away an existing entry with undefined.
  if (profile.name !== undefined || profile.email !== undefined) {
    const dirUpdate = {};
    if (profile.name !== undefined) dirUpdate.name = profile.name;
    if (profile.email !== undefined) dirUpdate.email = profile.email;
    await setDoc(doc(db, "playerDirectory", uid), dirUpdate, { merge: true });
  }
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

// Ends an APPROVED coach connection. Either the player (disconnecting from their coach in
// Settings) or the coach (removing the player from their roster, in the Coach app) can call the
// equivalent of this — this copy lives in the player app since that's the only place it's wired
// up so far. Firestore rules only allow this while status is "approved"; the doc is simply
// deleted, same as withdrawing a pending request, since there's nothing else to leave behind.
export async function disconnectCoachLink(playerId, coachId) {
  await deleteDoc(coachLinkDocRef(playerId, coachId));
}

// ===== Add Friend — search players, send/accept/decline/withdraw a friend request =====
//
// Same pattern as Add Coach above, with one structural difference: coach links are asymmetric
// (player always applies, coach always approves), friend links are symmetric — either side can
// send, either side can approve. A friendLinks doc id therefore can't be `${playerId}_${coachId}`
// the way coachLinks is (that only works because "coach" and "player" are fixed roles) — instead
// it's the two uids SORTED then joined, so a link gets exactly one doc no matter who initiates.
//
// This will need its own entry in firestore.rules alongside coachLinks': a player can create a
// friendLinks doc naming themselves as playerA or playerB, can read any doc naming them, can
// update status only on a doc naming them where they are NOT requestedBy (i.e. you can't approve
// your own outgoing request), and can delete a doc naming them (covers both withdrawing your own
// pending request and removing an approved friend).

function friendLinkId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}
function friendLinkDocRef(uidA, uidB) {
  return doc(db, "friendLinks", friendLinkId(uidA, uidB));
}

// Other players are found via playerDirectory — a deliberately minimal mirror of users/{uid}
// (just name + email, kept in sync by saveUserProfile above), NOT the users collection itself.
// users/{uid}'s Firestore rule only permits reading your OWN doc (request.auth.uid == uid), so
// an unfiltered scan of the whole users collection is rejected outright — Firestore doesn't
// partially satisfy a list query, it denies the entire thing if the rule can't guarantee every
// possible result passes. playerDirectory exists specifically so this can stay a real
// collection-wide search without needing to loosen users' privacy. Unlike searchCoaches, this
// deliberately does NOT support a blank query returning everyone — coaches are a small,
// discoverable directory; players are not, so this behaves like a lookup (name or email match)
// rather than a browsable list of every user.
export async function searchPlayers(queryText, excludeUid) {
  const q = (queryText || "").trim().toLowerCase();
  if (!q) return [];
  const snap = await getDocs(collection(db, "playerDirectory"));
  const results = [];
  snap.forEach((d) => {
    if (d.id === excludeUid) return;
    const data = d.data();
    const name = (data.name || "").toLowerCase();
    const email = (data.email || "").toLowerCase();
    if (name.includes(q) || email.includes(q)) {
      results.push({ id: d.id, name: data.name || "Player", email: data.email || "" });
    }
  });
  return results.slice(0, 20);
}

// Creates (or re-reads, if one already exists) a pending friend request. playerName is this
// player's own profile value, passed in from App.jsx, same reasoning as applyToCoach's
// playerName/playerEmail args above.
export async function sendFriendRequest(profileId, profileName, targetId, targetName) {
  const ref = friendLinkDocRef(profileId, targetId);
  const existing = await getDoc(ref);
  if (existing.exists()) return existing.data();
  const payload = {
    playerA: profileId,
    playerB: targetId,
    playerAName: profileName || "Player",
    playerBName: targetName || "Player",
    status: "pending",
    requestedBy: profileId,
    requestedAt: Date.now(),
    respondedAt: null,
  };
  await setDoc(ref, payload);
  return payload;
}

// Live-subscribes to every friendLinks doc naming this player (any status), normalized so the UI
// doesn't need to know which side of playerA/playerB it's looking at, and doesn't need two
// separate lists for "sent" vs "received" — direction is derived from requestedBy instead.
// Needs two queries (one per side) since Firestore can't OR across two different fields in one
// query; combined and re-emitted together whenever either side updates.
export function watchMyFriendLinks(profileId, cb) {
  const qA = query(collection(db, "friendLinks"), where("playerA", "==", profileId));
  const qB = query(collection(db, "friendLinks"), where("playerB", "==", profileId));

  let latestA = [];
  let latestB = [];
  function emit() {
    const combined = [...latestA, ...latestB].map((d) => {
      const isA = d.playerA === profileId;
      return {
        id: d.id,
        friendId: isA ? d.playerB : d.playerA,
        friendName: isA ? d.playerBName : d.playerAName,
        status: d.status,
        direction: d.requestedBy === profileId ? "sent" : "received",
        requestedAt: d.requestedAt,
      };
    });
    cb(combined);
  }

  const unsubA = onSnapshot(qA, (snap) => {
    latestA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  });
  const unsubB = onSnapshot(qB, (snap) => {
    latestB = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  });

  return () => {
    unsubA();
    unsubB();
  };
}

// linkId is the friendLinks doc id (App.jsx has this from the link object watchMyFriendLinks
// handed it) — accept/decline/withdraw/remove all just need the id, not both uids again.
export async function acceptFriendRequest(linkId) {
  await setDoc(doc(db, "friendLinks", linkId), { status: "approved", respondedAt: Date.now() }, { merge: true });
}

export async function declineFriendRequest(linkId) {
  await setDoc(doc(db, "friendLinks", linkId), { status: "declined", respondedAt: Date.now() }, { merge: true });
}

// Cancel a request YOU sent, while it's still pending.
export async function withdrawFriendRequest(linkId) {
  await deleteDoc(doc(db, "friendLinks", linkId));
}

// Ends an approved friendship. Either side can call this, same as disconnectCoachLink can be
// called by either player or coach — deletes the doc, nothing else to leave behind.
export async function removeFriend(linkId) {
  await deleteDoc(doc(db, "friendLinks", linkId));
}

// ===== Real per-section stats for Compare =====
//
// Reads another player's raw session arrays for the four keys Compare/Coach Summary actually
// use (golf:sessions, tee:sessions, shortgame:sessions, putting:sessions — Clock/Start Line/
// Pace Control live under separate keys and were never part of the 5-section model either
// screen uses). Works for self, an approved coach, or an approved friend — whichever the caller
// has, since all three read through the same appData/{key} rule.
//
// ACCESS LEVEL, WORTH KNOWING: this reads full raw session detail (every shot, every session) —
// the exact same access an approved coach already has, not a separate, smaller "aggregates
// only" grant. If friend access is ever meant to be more limited than coach access, that needs
// a different architecture (a separate small summary doc + its own narrower rules), not this
// function.
const COMPARE_ANALYSIS_KEYS = ["golf:sessions", "tee:sessions", "shortgame:sessions", "putting:sessions"];

export async function getPlayerSectionHistories(uid) {
  const raw = {};
  await Promise.all(
    COMPARE_ANALYSIS_KEYS.map(async (key) => {
      try {
        const snap = await getDoc(doc(db, "users", uid, "appData", key));
        raw[key] = snap.exists() ? JSON.parse(snap.data().value || "[]") : [];
      } catch (e) {
        // Permission denied (not actually an approved friend/coach after all) or malformed
        // JSON — treat as no data for this one key rather than failing the whole fetch.
        raw[key] = [];
      }
    })
  );
  return {
    range: raw["golf:sessions"] || [],
    tee: raw["tee:sessions"] || [],
    shortGame: raw["shortgame:sessions"] || [],
    putting: raw["putting:sessions"] || [],
  };
}
