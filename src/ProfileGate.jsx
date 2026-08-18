import { useState, useEffect } from "react";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  setActiveProfileId,
  installWindowStorage,
} from "./storage.js";
import App, { ProfileSetupWizard } from "./App.jsx";

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
  const [showWizard, setShowWizard] = useState(false);
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

  async function handleWizardComplete({ name, handicap, rangeTrackingMode, baselineHandicap }) {
    let profile;
    try {
      profile = await createProfile(name, handicap);
    } catch (e) {
      profile = { id: crypto.randomUUID(), name: name.trim(), handicap: handicap || null, createdAt: new Date().toISOString() };
    }
    setProfiles((prev) => [...prev, profile]);
    // Installed synchronously before settings are written, so the write below (and everything
    // App.jsx loads on mount) is correctly scoped to this brand-new profile.
    installWindowStorage(profile.id);
    try {
      await window.storage.set(
        "settings:preferences",
        JSON.stringify({ baselineHandicap, units: "imperial", rangeTrackingMode }),
        false
      );
    } catch (e) {
      // non-fatal — Settings screen will still show sensible defaults
    }
    setShowWizard(false);
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

  if (showWizard) {
    return <ProfileSetupWizard onComplete={handleWizardComplete} />;
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
                  {p.handicap !== null && p.handicap !== undefined ? ` · ${p.handicap} hcp` : ""}
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

        <button
          onClick={() => setShowWizard(true)}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "14px 0",
            borderRadius: 12,
            border: `1px dashed ${COLORS.creamDim}44`,
            background: "transparent",
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          + ADD PROFILE
        </button>
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

