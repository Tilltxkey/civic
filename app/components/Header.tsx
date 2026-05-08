"use client";

import { useState, useEffect } from "react";
import { useC } from "./tokens";
import { ELECTION } from "./data";
import { AppMenu } from "./AppMenu";
import { useElection } from "./ElectionContext";

// ── Derive the header subtitle from the user's profile ────────
// • Student  (year ≥ 1, field set)  → "3ème année · Sciences Économiques"
// • Décanat  (role starts with Décanat, roleDetail set) → "FDSE · Doyen·ne"
// • Rectorat                         → "Rectorat · UEH"
// • Fallback                         → faculty only, or empty
function buildSubtitle(user?: import("./AuthFlow").UserProfile | null): string {
  if (!user) return "";

  const isStudent  = user.year >= 1 && !!user.field;
  const isDecanat  = user.role === "Décanat";
  const isRectorat = user.role === "Rectorat";

  if (isStudent) {
    const suffix =
      user.year === 1 ? "1ère année" :
      `${user.year}ème année`;
    return `${suffix} · ${user.field}`;
  }

  if (isDecanat) {
    const parts = [user.faculty, user.roleDetail].filter(Boolean);
    return parts.join(" · ");
  }

  if (isRectorat) {
    return `Rectorat · UEH`;
  }

  // CEP or other roles — show faculty if available
  return user.faculty || "";
}

export default function Header({ user }: { user?: import("./AuthFlow").UserProfile | null }) {
  const C = useC();
  const { election, inscriptionSecsLeft } = useElection();
  const status = election?.status ?? "future";

  // ── Track whether the inscription window has closed ────────────
  const [inscriptionClosed, setInscriptionClosed] = useState(false);

  useEffect(() => {
    if (status !== "inscription") {
      setInscriptionClosed(false);
      return;
    }
    if (!election?.inscriptionEndsAt) return;

    const update = () => {
      const secs = inscriptionSecsLeft();
      setInscriptionClosed(secs === 0);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, election?.inscriptionEndsAt, inscriptionSecsLeft]);

  // ── Derive display values ──────────────────────────────────────
  const displayStatus = status === "inscription" && inscriptionClosed
    ? "inscription_closed"
    : status;

  const STATUS_TITLE: Record<string, string> = {
    future:              "ÉLECTIONS À VENIR",
    inscription:         "CANDIDATURES OUVERTES",
    inscription_closed:  "CANDIDATURES CLOSES",
    ongoing:             ELECTION.title,
    past:                "ÉLECTIONS PASSÉES",
  };

  const STATUS_DOT: Record<string, string> = {
    future:              "#B8B6AF",
    inscription:         "#C47F00",
    inscription_closed:  "#B8B6AF",
    ongoing:             "#0b971e",
    past:                "#B8B6AF",
  };

  const dotColor = STATUS_DOT[displayStatus] ?? "#B8B6AF";
  const isLive   = status === "ongoing";
  const isPulse  = status === "inscription" && !inscriptionClosed;

  const subtitle = buildSubtitle(user);

  return (
    <header style={{
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      padding: "10px 16px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexShrink: 0,
      position: "relative",
      zIndex: 80,
    }}>

      {/* Status dot — pulses gold during open inscription, green when live */}
      <div style={{
        display: "flex", alignItems: "center",
        background: C.redBg,
        border: `1px solid ${dotColor}33`,
        borderRadius: 20, padding: "0px 0px", flexShrink: 0,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: dotColor, display: "inline-block",
          animation: (isLive || isPulse) ? "dot 1.1s ease-in-out infinite" : "none",
        }} />
      </div>

      {/* Center title — text changes per status */}
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: "clamp(16px, 3vw, 19px)", color: C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {STATUS_TITLE[displayStatus]}
        </div>
        {subtitle && (
          <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>

      <AppMenu user={user} />

    </header>
  );
}