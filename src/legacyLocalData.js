// Read-only scan of the OLD (pre-login) local-profile storage, used once at sign-up time to
// offer migrating a device's existing practice data into a brand-new cloud account.
//
// Per the project handoff (Section 4f), the real deployed app's pre-login storage.js used the
// `idb` package against an IndexedDB database named "practice-app-db", a single object store
// "kv", with keys shaped `${profileId}::${key}`. Rather than depend on that package or guess at
// its exact wrapper behavior, this talks to the same underlying IndexedDB database directly with
// the browser's native indexedDB API, read-only, so it works regardless of exactly how the old
// storage.js was structured internally.
//
// Safety: this NEVER writes to or deletes anything in the legacy database. Opening it with
// indexedDB.open(name) (no explicit version) never triggers an upgrade/versionchange, so it
// cannot corrupt existing data even if our assumptions about its shape are wrong — worst case it
// simply finds nothing, which the caller treats as "no local data to offer."
import { APP_DATA_KEYS } from "./storage.js";

const LEGACY_DB_NAME = "practice-app-db";
const LEGACY_STORE_NAME = "kv";

function openLegacyDb() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const req = indexedDB.open(LEGACY_DB_NAME);
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      // Belt-and-braces timeout in case the request never settles for some reason — this is a
    // best-effort convenience scan, never something the sign-up flow should hang on.
    setTimeout(() => finish(null), 3000);
    } catch (e) {
      finish(null);
    }
  });
}

// Returns an array of { profileId, summary: { key: itemCount }, data: { key: rawValue } } — one
// entry per distinct profileId prefix found in the legacy store, containing only the keys that
// are still recognized app data keys (anything else in there is ignored).
export async function findLegacyLocalProfiles() {
  const db = await openLegacyDb();
  if (!db) return [];
  if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    db.close();
    return [];
  }

      const grouped = {};
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LEGACY_STORE_NAME, "readonly");
      const store = tx.objectStore(LEGACY_STORE_NAME);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return; // done — resolved by tx.oncomplete below
        const rawKey = cursor.key;
        if (typeof rawKey === "string" && rawKey.includes("::")) {
          const sep = rawKey.indexOf("::");
          const profileId = rawKey.slice(0, sep);
          const shortKey = rawKey.slice(sep + 2);
          if (APP_DATA_KEYS.includes(shortKey)) {
            if (!grouped[profileId]) grouped[profileId] = {};
            grouped[profileId][shortKey] = cursor.value;
          }
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    db.close();
    return [];
  }
  db.close();

return Object.keys(grouped).map((profileId) => {
  const data = grouped[profileId];
  const summary = {};
  Object.keys(data).forEach((key) => {
    try {
      const parsed = JSON.parse(data[key]);
      summary[key] = Array.isArray(parsed) ? parsed.length : 1;
    } catch (e) {
      summary[key] = 1;
    }
  });
  return { profileId, summary, data };
});
}

// Turns a candidate's { key: itemCount } summary into a short human-readable line, e.g.
// "12 range sessions, 5 putting sessions" — used by the migration prompt. Only mentions keys
// that actually have data, and only the handful that read naturally as "count of X".
const SUMMARY_LABELS = {
  "golf:sessions": (n) => `${n} range session${n === 1 ? "" : "s"}`,
  "putting:sessions": (n) => `${n} putting session${n === 1 ? "" : "s"}`,
  "putting:clockSessions": (n) => `${n} Around the Clock round${n === 1 ? "" : "s"}`,
  "tee:sessions": (n) => `${n} tee accuracy session${n === 1 ? "" : "s"}`,
  "shortgame:sessions": (n) => `${n} short game session${n === 1 ? "" : "s"}`,
  "wedgematrix:completed": (n) => `${n} wedge matri${n === 1 ? "x" : "ces"}`,
  "gapping:completed": (n) => `${n} gapping chart${n === 1 ? "" : "s"}`,
  "compete:sessions": (n) => `${n} compete round${n === 1 ? "" : "s"}`,
};

export function describeLegacyProfile(candidate) {
  const parts = [];
  Object.keys(SUMMARY_LABELS).forEach((key) => {
    const n = candidate.summary[key];
    if (n) parts.push(SUMMARY_LABELS[key](n));
  });
  return parts.length ? parts.join(", ") : "some saved practice data";
}
