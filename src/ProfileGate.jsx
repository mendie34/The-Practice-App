import { useState, useEffect } from "react";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  setActiveProfileId,
  installWindowStorage,
} from "./storage.js";
import App from "./App.jsx";

const COLORS = {
  turfDark: "#14291F",
  turf: "#1D3A2B",
  fairway: "#2F6B4F",
  fairwayLight: "#4C8A68",
  cream: "#F1EAD6",
  creamDim: "#E4DBC2",
  flag: "#C1440E",
};

export default function ProfileGate() {
  const [profiles, setProfiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState(() => getActiveProfileId());
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    (async () => {
      const list = await listProfiles();
      setProfiles(list);
      setLoaded(true);
      // Active profile ID was saved from a previous visit but the profile itself may have
      // been deleted since — fall back to the picker if it no longer exists.
      const saved = getActiveProfileId();
      if (saved && !list.some((p) => p.id === saved)) {
        setActiveProfileId(null);
        setActiveId(null);
      }
    })();
  }, []);

  function selectProfile(id) {
    setActiveProfileId(id);
    setActiveId(id);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const profile = await createProfile(newName);
    setProfiles((prev) => [...prev, profile]);
    setNewName("");
    selectProfile(profile.id);
  }

  async function handleDelete(id) {
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    setConfirmDeleteId(null);
  }

  function handleSwitchProfile() {
    setActiveProfileId(null);
    setActiveId(null);
  }

  if (activeId) {
    // Installed synchronously before App renders, so every window.storage call the app
    // makes on mount is already scoped to this profile.
    installWindowStorage(activeId);
    const profile = profiles.find((p) => p.id === activeId);
    return <App key={activeId} onSwitchProfile={handleSwitchProfile} profileName={profile?.name || ""} profileId={activeId} />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.turfDark,
        color: COLORS.cream,
        display: "flex",
        justifyContent: "center",
        padding: "40px 16px",
        boxSizing: "border-box",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1, marginBottom: 4 }}>
          THE PRACTICE APP
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginBottom: 20 }}>
          Who's playing? Data stays on this device, separate per profile.
        </div>

        {!loaded && <div style={{ color: COLORS.creamDim }}>Loading profiles…</div>}

        {loaded &&
          profiles.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: COLORS.turf,
                border: `1px solid ${COLORS.creamDim}22`,
                borderRadius: 12,
                padding: "14px 16px",
                marginBottom: 10,
              }}
            >
              <div onClick={() => selectProfile(p.id)} style={{ cursor: "pointer", flex: 1 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}>{p.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  Created {new Date(p.createdAt).toLocaleDateString()}
                </div>
              </div>
              {confirmDeleteId === p.id ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleDelete(p.id)} style={dangerBtnStyle}>
                    DELETE
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} style={ghostBtnStyle}>
                    CANCEL
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => setConfirmDeleteId(p.id)}
                  style={{ color: COLORS.creamDim, fontSize: 18, cursor: "pointer", padding: "0 6px" }}
                  title="Delete profile"
                >
                  ×
                </div>
              )}
            </div>
          ))}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            background: COLORS.turf,
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 12,
            padding: 10,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New profile name"
            style={{
              flex: 1,
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              padding: "10px 12px",
              boxSizing: "border-box",
            }}
          />
          <button onClick={handleCreate} disabled={!newName.trim()} style={primaryBtnStyle(!newName.trim())}>
            ADD
          </button>
        </div>
      </div>
    </div>
  );
}

const ghostBtnStyle = {
  padding: "6px 10px",
  borderRadius: 6,
  border: `1px solid ${COLORS.creamDim}33`,
  background: "transparent",
  color: COLORS.creamDim,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  cursor: "pointer",
};

const dangerBtnStyle = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "none",
  background: COLORS.flag,
  color: COLORS.cream,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  cursor: "pointer",
};

function primaryBtnStyle(disabled) {
  return {
    padding: "0 18px",
    borderRadius: 8,
    border: "none",
    background: disabled ? `${COLORS.fairway}66` : COLORS.fairway,
    color: COLORS.cream,
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 16,
    letterSpacing: 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
