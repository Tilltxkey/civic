"use client";

import { useC } from "./tokens";
import { ELECTION } from "./data";
import { AppMenu } from "./AppMenu";

export default function Header({ user }: { user?: import("./AuthFlow").UserProfile | null }) {
  const C = useC();

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

      {/* Live dot */}
      <div style={{
        display: "flex", alignItems: "center",
        background: C.redBg,
        border: `1px solid ${C.green}33`,
        borderRadius: 20, padding: "0px 0px", flexShrink: 0,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: C.green, display: "inline-block",
          animation: "dot 1.1s ease-in-out infinite",
        }} />
      </div>

      {/* Center title */}
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: "clamp(16px, 3vw, 19px)", color: C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {ELECTION.title}
        </div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
          {ELECTION.grade} · {ELECTION.field}
        </div>
      </div>

      <AppMenu user={user} />

    </header>
  );
}