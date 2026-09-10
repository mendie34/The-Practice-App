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
export const APP_DATA_KEYS =
