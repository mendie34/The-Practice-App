import { openDB } from "idb";

const DB_NAME = "practice-app-db";
const DB_VERSION = 1;
const STORE = "kv";

// Reserved keys that live outside any profile's namespace.
const PROFILES_KEY = "__profiles__";
const ACTIVE_PROFILE_STORAGE_KEY = "practice-app:active-profile-id";

let dbPromise = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // keyPath is the namespaced key string itself
        }
      },
    });
  }
  return dbPromise;
}

function namespacedKey(profileId, key) {
  return `${profileId}::${key}`;
}

// ===== Profile management (not namespaced — this list has to exist before any profile is picked) =====

export async function listProfiles() {
  const db = await getDB();
  const raw = await db.get(STORE, PROFILES_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function createProfile(name, handicap) {
  const db = await getDB();
  const profiles = await listProfiles();
  const profile = {
    id: crypto.randomUUID(),
    name: name.trim(),
    handicap: handicap !== null && handicap !== undefined && handicap !== "" ? parseFloat(handicap) : null,
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  await db.put(STORE, JSON.stringify(profiles), PROFILES_KEY);
  return profile;
}

export async function renameProfile(id, name) {
  const db = await getDB();
  const profiles = await listProfiles();
  const next = profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
  await db.put(STORE, JSON.stringify(next), PROFILES_KEY);
}

export async function deleteProfile(id) {
  const db = await getDB();
  const profiles = await listProfiles();
  const next = profiles.filter((p) => p.id !== id);
  await db.put(STORE, JSON.stringify(next), PROFILES_KEY);

  // Also wipe every key that belonged to this profile.
  const prefix = `${id}::`;
  const allKeys = await db.getAllKeys(STORE);
  const toDelete = allKeys.filter((k) => typeof k === "string" && k.startsWith(prefix));
  await Promise.all(toDelete.map((k) => db.delete(STORE, k)));
}

export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
}

export function setActiveProfileId(id) {
  if (id) localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  else localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
}

// ===== window.storage polyfill, scoped to whichever profile is currently active =====
// Matches the shape the app already calls: get/set/delete return {key, value} or null,
// list returns {keys}. The "shared" second argument from the original API is accepted but
// ignored — this app has no multi-user shared data, everything is personal-per-profile.

export function installWindowStorage(profileId) {
  window.storage = {
    async get(key) {
      const db = await getDB();
      const value = await db.get(STORE, namespacedKey(profileId, key));
      if (value === undefined) return null;
      return { key, value, shared: false };
    },
    async set(key, value) {
      const db = await getDB();
      await db.put(STORE, value, namespacedKey(profileId, key));
      return { key, value, shared: false };
    },
    async delete(key) {
      const db = await getDB();
      await db.delete(STORE, namespacedKey(profileId, key));
      return { key, deleted: true, shared: false };
    },
    async list(prefix = "") {
      const db = await getDB();
      const allKeys = await db.getAllKeys(STORE);
      const ns = `${profileId}::`;
      const keys = allKeys
        .filter((k) => typeof k === "string" && k.startsWith(ns + prefix))
        .map((k) => k.slice(ns.length));
      return { keys, prefix, shared: false };
    },
  };
}

// ===== Export / import a profile's full data as a JSON file =====
// The one real safety net for local-only storage: browsers can evict site data, and clearing
// browser data wipes everything with no server-side backup to fall back on.

export async function exportProfileData(profileId, profileName) {
  const db = await getDB();
  const allKeys = await db.getAllKeys(STORE);
  const ns = `${profileId}::`;
  const entries = {};
  for (const k of allKeys) {
    if (typeof k === "string" && k.startsWith(ns)) {
      const shortKey = k.slice(ns.length);
      entries[shortKey] = await db.get(STORE, k);
    }
  }
  const payload = {
    app: "the-practice-app",
    exportedAt: new Date().toISOString(),
    profileName,
    data: entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `practice-app-${profileName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importProfileData(profileId, file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !payload.data) throw new Error("That doesn't look like a Practice App export file.");
  const db = await getDB();
  const entries = Object.entries(payload.data);
  await Promise.all(entries.map(([key, value]) => db.put(STORE, value, namespacedKey(profileId, key))));
  return entries.length;
}
  
export async function loadAllAppData() {
  const profileId = getActiveProfileId();
  if (!profileId) return {};
  const db = await getDB();
  const allKeys = await db.getAllKeys(STORE);
  const ns = `${profileId}::`;
  const entries = {};
  for (const k of allKeys) {
    if (typeof k === "string" && k.startsWith(ns)) {
      const shortKey = k.slice(ns.length);
      entries[shortKey] = await db.get(STORE, k);
    }
  }
  return entries;
}

