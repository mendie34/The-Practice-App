import { useState, useEffect } from "react";
import GolfPracticeApp, { COLORS, FONT_IMPORT, ProfileSetupWizard, LOGO_SRC, LOGO_PLAYER_SRC } from "./App.jsx";
import {
  watchAuthState,
  signUp,
  signIn,
  signOutUser,
  installWindowStorage,
  getUserProfile,
  saveUserProfile,
  importAppDataObject,
} from "./storage.js";
import { findLegacyLocalProfiles, describeLegacyProfile } from "./legacyLocalData.js";

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "An account with that email already exists — try signing in instead.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/too-many-requests": "Too many attempts — please wait a bit and try again.",
  "auth/network-request-failed": "Couldn't reach the server — check your connection and try again.",
};
function friendlyAuthError(err) {
  return AUTH_ERROR_MESSAGES[err && err.code] || (err && err.message) || "Something went wrong. Please try again.";
}

const shellStyle = {
  minHeight: "100vh",
  background: COLORS.turfDark,
  color: COLORS.cream,
  fontFamily: "'Inter', sans-serif",
  padding: "48px 16px",
  boxSizing: "border-box",
};
const cardStyle = {
  maxWidth: 420,
  margin: "0 auto",
  background: `${COLORS.turf}cc`,
  border: `1px solid ${COLORS.creamDim}22`,
  borderRadius: 14,
  padding: "20px 20px 24px",
};
const titleStyle = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, textAlign: "center", marginBottom: 24 };
const labelStyle = { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 6, marginTop: 14 };
const inputStyle = {
  width: "100%",
  background: COLORS.turfDark,
  border: `1px solid ${COLORS.creamDim}33`,
  borderRadius: 8,
  color: COLORS.cream,
  fontFamily: "'Inter', sans-serif",
  fontSize: 16,
  padding: "10px 12px",
  boxSizing: "border-box",
};
function primaryButtonStyle(disabled) {
  return {
    width: "100%",
    marginTop: 18,
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    background: disabled ? `${COLORS.fairway}66` : COLORS.fairway,
    color: COLORS.cream,
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 18,
    letterSpacing: 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
const linkButtonStyle = {
  display: "block",
  width: "100%",
  marginTop: 14,
  background: "transparent",
  border: "none",
  color: COLORS.creamDim,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  textDecoration: "underline",
  cursor: "pointer",
  textAlign: "center",
};
const errorStyle = {
  marginTop: 14,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: COLORS.flag,
};

function LoadingScreen() {
  return (
    <div style={{ ...shellStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <style>{FONT_IMPORT}</style>
      <img src={LOGO_SRC} alt="" style={{ width: 48, height: 48, opacity: 0.8 }} />
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
        Loading…
      </div>
    </div>
  );
}

function AuthScreen({ mode, setMode, onSubmit, submitting, error }) {
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const isSignUp = mode === "signup";
  const canSubmit =
    email.trim() !== "" &&
    password.length >= 6 &&
    !submitting &&
    (!isSignUp || (firstName.trim() !== "" && surname.trim() !== ""));

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(email.trim(), password, remember, isSignUp ? { firstName: firstName.trim(), surname: surname.trim() } : null);
  }

  return (
    <div style={shellStyle}>
      <style>{FONT_IMPORT}</style>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <img src={LOGO_PLAYER_SRC} alt="The Practice App — Player" style={{ width: 150, height: 195, marginBottom: 10 }} />
        <div style={{ ...titleStyle, marginBottom: 0 }}>THE PRACTICE APP</div>
      </div>
      <form style={cardStyle} onSubmit={handleSubmit}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5 }}>
          {isSignUp ? "CREATE ACCOUNT" : "LOG IN"}
        </div>

        {isSignUp && (
          <>
            <div style={labelStyle}>FIRST NAME</div>
            <input
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              style={inputStyle}
              autoFocus
            />
            <div style={labelStyle}>SURNAME</div>
            <input
              type="text"
              autoComplete="family-name"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              placeholder="Surname"
              style={inputStyle}
            />
          </>
        )}

        <div style={labelStyle}>EMAIL</div>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={inputStyle}
          autoFocus={!isSignUp}
        />

        <div style={labelStyle}>PASSWORD</div>
        <input
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isSignUp ? "At least 6 characters" : "Your password"}
          style={inputStyle}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            color: COLORS.creamDim,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: COLORS.fairway, cursor: "pointer" }}
          />
          Remember me
        </label>

        {error && <div style={errorStyle}>{error}</div>}

        <button type="submit" disabled={!canSubmit} style={primaryButtonStyle(!canSubmit)}>
          {submitting ? "PLEASE WAIT…" : isSignUp ? "CREATE ACCOUNT" : "LOG IN"}
        </button>

        <button
          type="button"
          onClick={() => setMode(isSignUp ? "signin" : "signup")}
          style={linkButtonStyle}
        >
          {isSignUp ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function MigrationPrompt({ candidates, onMigrate, onSkip, busy }) {
  const [selectedId, setSelectedId] = useState(candidates[0].profileId);
  return (
    <div style={shellStyle}>
      <style>{FONT_IMPORT}</style>
      <div style={cardStyle}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5 }}>
          BRING YOUR DATA IN?
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 8, lineHeight: 1.5 }}>
          We found existing practice data saved on this device, from before you had an account.
          Want to copy it into your new account?
        </div>

        {candidates.length > 1 && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 14 }}>
            More than one local dataset was found — choose which one:
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {candidates.map((c) => (
            <div
              key={c.profileId}
              onClick={() => setSelectedId(c.profileId)}
              style={{
                border: `1px solid ${selectedId === c.profileId ? COLORS.fairwayLight : COLORS.creamDim + "33"}`,
                borderRadius: 10,
                padding: "10px 12px",
                cursor: "pointer",
                background: selectedId === c.profileId ? `${COLORS.fairway}33` : "transparent",
              }}
            >
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                {describeLegacyProfile(c)}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => onMigrate(candidates.find((c) => c.profileId === selectedId))}
          disabled={busy}
          style={primaryButtonStyle(busy)}
        >
          {busy ? "COPYING DATA…" : "BRING IT IN"}
        </button>
        <button type="button" onClick={onSkip} disabled={busy} style={linkButtonStyle}>
          Skip — start fresh instead
        </button>
      </div>
    </div>
  );
}

export default function AuthGate() {
  // loading | signedOut | needsProfile | ready
  const [authState, setAuthState] = useState("loading");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState("signin");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState(null);
  // Local data found on THIS device at the moment sign-up was submitted, offered once right
  // after account creation, before the profile-setup wizard. null = nothing to offer / already
  // resolved (migrated or skipped).
  const [migrationCandidates, setMigrationCandidates] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  // {firstName, surname} captured at sign-up, purely to pre-fill ProfileSetupWizard — cleared
  // once the wizard finishes and the real profile doc is saved.
  const [pendingName, setPendingName] = useState(null);

  useEffect(() => {
    const unsub = watchAuthState(async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setProfile(null);
        setAuthState("signedOut");
        return;
      }
      setUser(fbUser);
      installWindowStorage(fbUser.uid);
      try {
        const existingProfile = await getUserProfile(fbUser.uid);
        if (existingProfile) {
          setProfile(existingProfile);
          setAuthState("ready");
        } else {
          setAuthState("needsProfile");
        }
      } catch (e) {
        // Firestore unreachable (offline on first-ever login, before anything is cached) — fall
        // back to the setup wizard rather than getting stuck; saving will retry once online.
        setAuthState("needsProfile");
      }
    });
    return unsub;
  }, []);

  async function handleAuthSubmit(email, password, remember, nameInfo) {
    setSubmitting(true);
    setAuthError(null);
    try {
      if (mode === "signup") {
        // Scan THIS device for pre-login local data before creating the account, so we can offer
        // to migrate it right after — see legacyLocalData.js. Read-only, never touches the data.
        const localProfiles = await findLegacyLocalProfiles();
        await signUp(email, password, remember);
        // Held in state (not yet saved to Firestore) purely to pre-fill the wizard below — it's
        // written for real in handleWizardComplete once the wizard is actually finished.
        if (nameInfo) setPendingName(nameInfo);
        if (localProfiles.length) setMigrationCandidates(localProfiles);
      } else {
        await signIn(email, password, remember);
      }
      // onAuthStateChanged (above) picks up from here and drives the rest of the flow.
    } catch (e) {
      setAuthError(friendlyAuthError(e));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSwitchProfile() {
    // Ordinary sign-out — someone logging back in either to this same account or a different
    // existing one. Reset to "signin" explicitly in case mode was left on "signup" from an
    // abandoned attempt earlier in the session (AuthGate itself never unmounts on sign-out).
    setMode("signin");
    signOutUser();
  }

  function handleCreateProfile() {
    // "Create New Profile" from Settings — each profile is its own login (see AuthGate.jsx
    // note above GolfPracticeApp), so this just signs the current one out and lands straight
    // on the Create Account form instead of Log In, skipping the extra tap. A genuinely new
    // account has no profile doc yet, so onAuthStateChanged naturally routes it through
    // ProfileSetupWizard once they sign up — no separate wiring needed for that part.
    setMode("signup");
    signOutUser();
  }

  async function handleMigrate(candidate) {
    setMigrationBusy(true);
    try {
      await importAppDataObject(user.uid, candidate.data);
    } finally {
      setMigrationBusy(false);
      setMigrationCandidates(null);
    }
  }

  async function handleWizardComplete(payload) {
    const uid = user.uid;
    const profileDoc = {
      name: payload.name,
      handicap: payload.handicap,
      email: payload.email,
      trackingMode: payload.trackingMode,
      hasCoach: payload.hasCoach,
      pendingCoachQuery: payload.pendingCoachQuery,
      monthlyEmailOptIn: payload.monthlyEmailOptIn,
      onboardingComplete: payload.onboardingComplete,
      createdAt: Date.now(),
    };
    await saveUserProfile(uid, profileDoc);
    await window.storage.set(
      "settings:preferences",
      JSON.stringify({
        baselineHandicap: payload.baselineHandicap || "tour",
        units: payload.units || "imperial",
        rangeTrackingMode: payload.rangeTrackingMode || "distance",
      }),
      false
    );
    setProfile(profileDoc);
    setPendingName(null);
    setAuthState("ready");
  }

  if (authState === "loading") {
    return <LoadingScreen />;
  }

  if (authState === "signedOut") {
    return (
      <AuthScreen mode={mode} setMode={setMode} onSubmit={handleAuthSubmit} submitting={submitting} error={authError} />
    );
  }

  if (authState === "needsProfile") {
    if (migrationCandidates && migrationCandidates.length) {
      return (
        <MigrationPrompt
          candidates={migrationCandidates}
          busy={migrationBusy}
          onMigrate={handleMigrate}
          onSkip={() => setMigrationCandidates(null)}
        />
      );
    }
    return (
      <ProfileSetupWizard
        onComplete={handleWizardComplete}
        initialFirstName={pendingName ? pendingName.firstName : ""}
        initialSurname={pendingName ? pendingName.surname : ""}
        initialEmail={user.email || ""}
      />
    );
  }

  return (
    <GolfPracticeApp
      onSwitchProfile={handleSwitchProfile}
      onCreateProfile={handleCreateProfile}
      profileName={profile ? profile.name : ""}
      profileId={user.uid}
      profileHandicap={profile ? profile.handicap : null}
    />
  );
}
