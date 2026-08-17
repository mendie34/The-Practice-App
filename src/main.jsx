import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ProfileGate from "./ProfileGate.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ProfileGate />
  </StrictMode>
);
