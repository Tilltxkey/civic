"use client";

import { useC } from "./tokens";
import { ELECTION } from "./data";
import { AppMenu } from "./AppMenu";
import { useElection } from "./ElectionContext";

const STATUS_TITLE: Record<string, string> = {
  future:      "ÉLECTIONS À VENIR",
  inscription: "INSCRIPTIONS OUVERTES",
  ongoing:     ELECTION.title,
  past:        "ÉLECTIONS PASSÉES",
};

const STATUS_DOT: Record<string, string> = {
  future:      "#B8B6AF",
  inscription: "#C47F00",
  ongoing:     "#0b971e",
  past:        "#B8B6AF",
};

export default function Header({ user }: { user?: import("./AuthFlow").UserProfile | null }) {
  const C = useC();
  const { election } = useElection();
  const status   = election?.status ?? "future";
  const dotColor = STATUS_DOT[status];
  const isLive   = status === "ongoing";

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

      {/* Live dot — same element as before, only color changes per status */}
      <div style={{
        display: "flex", alignItems: "center",
        background: C.redBg,
        border: `1px solid ${dotColor}33`,
        borderRadius: 20, padding: "0px 0px", flexShrink: 0,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: dotColor, display: "inline-block",
          animation: isLive ? "dot 1.1s ease-in-out infinite" : "none",
        }} />
      </div>

      {/* Center title — text changes per status */}
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: "clamp(16px, 3vw, 19px)", color: C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {STATUS_TITLE[status]}
        </div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
          {ELECTION.grade} · {ELECTION.field}
        </div>
      </div>

      <AppMenu user={user} />

    </header>
  );
}