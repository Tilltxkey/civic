/**
 * DesktopGate.tsx
 * ─────────────────────────────────────────────────────────────
 * Shown when the screen is wider than BREAK (768px).
 * Displays a phone mockup preview, QR code placeholder,
 * and App Store / Google Play buttons.
 *
 * HOW TO CUSTOMIZE:
 *  - Change the tagline → edit "Conçu pour mobile" below.
 *  - Add a real QR code → replace the <svg> with an <img>.
 *  - Link the store buttons → add href / onClick handlers.
 *  - Change the breakpoint → edit BREAK in tokens.ts.
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { C } from "./tokens";
import { ELECTION } from "./data";

export default function DesktopGate() {
  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
      fontFamily: "var(--f-sans)",
    }}>

      {/* ── AP wordmark ───────────────────── */}
      <div style={{
        fontWeight: 700,
        fontSize: 18,
        letterSpacing: "4px",
        color: C.text,
        border: `1.5px solid ${C.border2}`,
        padding: "3px 12px",
        lineHeight: 1.2,
        marginBottom: 52,
        animation: "fadeup .4s ease both",
      }}>
        AP
      </div>

      {/* ── Phone mockup ──────────────────── */}
      <div style={{ animation: "rise .7s cubic-bezier(.2,.8,.3,1) both", animationDelay: ".1s" }}>
        <div style={{
          width: 174, height: 308,
          borderRadius: 36,
          border: `2px solid ${C.border2}`,
          background: C.surface,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          marginBottom: 48,
        }}>
          {/* Dynamic island */}
          <div style={{ width: 54, height: 10, background: C.bg, borderRadius: 99, margin: "10px auto 0", flexShrink: 0 }} />

          {/* Screen */}
          <div style={{ flex: 1, margin: "8px 6px 0", background: C.bg, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Mini header */}
            <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "5px 7px", display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 7, letterSpacing: "2px", border: `1px solid ${C.border2}`, padding: "1px 4px", color: C.text }}>AP</div>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: C.red, display: "inline-block", animation: "dot 1.1s ease-in-out infinite" }} />
              <span style={{ fontSize: 6.5, color: C.red, letterSpacing: "1px", fontWeight: 600 }}>EN DIRECT</span>
            </div>

            {/* Mini race */}
            <div style={{ padding: "6px 7px 5px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 6.5, color: C.sub, marginBottom: 5 }}>Président·e du Conseil Étudiant</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                <div style={{ flex: 1, background: C.redBg, borderRadius: 5, padding: "4px 6px" }}>
                  <div style={{ fontSize: 7, fontWeight: 600, color: C.red }}>Rivera</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 500, color: C.red, lineHeight: 1 }}>52%</div>
                </div>
                <div style={{ flex: 1, background: C.blueBg, borderRadius: 5, padding: "4px 6px", textAlign: "right" }}>
                  <div style={{ fontSize: 7, fontWeight: 600, color: C.blue }}>Nair</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 500, color: C.blue, lineHeight: 1 }}>48%</div>
                </div>
              </div>
              {/* Mini race bar */}
              <div style={{ height: 4, background: C.border, borderRadius: 99, overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "52%", background: C.red, borderRadius: 99 }} />
                <div style={{ position: "absolute", right: 0, top: 0, height: "100%", width: "48%", background: C.blue, borderRadius: 99 }} />
              </div>
            </div>

            {/* Mini treemap */}
            <div style={{ display: "flex", gap: 1.5, margin: "6px", height: 38, borderRadius: 5, overflow: "hidden" }}>
              {[{ w: 26, r: 86 }, { w: 22, r: 55 }, { w: 20, r: 47 }, { w: 16, r: 38 }, { w: 14, r: 50 }].map((d, i) => (
                <div key={i} style={{ flex: d.w, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: `${d.r}%`, background: d.r > 52 ? C.red : d.r < 48 ? C.blue : C.gold }} />
                  <div style={{ position: "absolute", left: 0, top: `${d.r}%`, width: "100%", height: 1.5, background: C.bg, zIndex: 2 }} />
                  <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: `${100 - d.r}%`, background: d.r > 52 ? C.blue + "99" : d.r < 48 ? C.red + "99" : C.gold + "66" }} />
                </div>
              ))}
            </div>

            {/* Mini ticker */}
            <div style={{ marginTop: "auto", background: "#111", height: 12, display: "flex", alignItems: "center", overflow: "hidden" }}>
              <div style={{ background: C.red, width: 18, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 5.5, fontWeight: 700 }}>FR</span>
              </div>
              <span style={{ fontSize: 5.5, color: C.sub, paddingLeft: 4, whiteSpace: "nowrap" }}>
                Urnes fermées · Rivera en tête · Participation +12%
              </span>
            </div>
          </div>

          {/* Home bar */}
          <div style={{ width: 44, height: 3, background: C.border2, borderRadius: 99, margin: "8px auto 10px", flexShrink: 0 }} />
        </div>
      </div>

      {/* ── Tagline + CTA ─────────────────── */}
      <div style={{ textAlign: "center", maxWidth: 300, animation: "fadeup .5s ease both", animationDelay: ".2s" }}>

        <div style={{ fontWeight: 700, fontSize: 22, color: C.text, letterSpacing: "-.5px", lineHeight: 1.2, marginBottom: 10 }}>
          Conçu pour mobile
        </div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, marginBottom: 32 }}>
          Suivez les résultats en temps réel.<br />
          Scannez ou téléchargez l&apos;application.
        </div>

        {/* QR code placeholder — replace <svg> with a real QR <img> */}
        <div style={{ width: 84, height: 84, background: "#fff", borderRadius: 10, margin: "0 auto 28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="62" height="62" viewBox="0 0 70 70" fill="none">
            <rect x="2"  y="2"  width="22" height="22" stroke="#0C0C0E" strokeWidth="4" />
            <rect x="7"  y="7"  width="12" height="12" fill="#0C0C0E" />
            <rect x="46" y="2"  width="22" height="22" stroke="#0C0C0E" strokeWidth="4" />
            <rect x="51" y="7"  width="12" height="12" fill="#0C0C0E" />
            <rect x="2"  y="46" width="22" height="22" stroke="#0C0C0E" strokeWidth="4" />
            <rect x="7"  y="51" width="12" height="12" fill="#0C0C0E" />
            {[28,33,38,43,28,38,48,33,43].map((x, i) => (
              <rect key={i} x={x} y={28 + Math.floor(i / 3) * 5} width="3" height="3" fill="#0C0C0E" />
            ))}
          </svg>
        </div>

        {/* Store buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {[
            { store: "App Store",   platform: "iPhone" },
            { store: "Google Play", platform: "Android" },
          ].map(({ store, platform }) => (
            <button
              key={store}
              style={{
                background: C.card,
                color: C.text,
                border: `1px solid ${C.border2}`,
                borderRadius: 10,
                padding: "10px 20px",
                cursor: "pointer",
                fontFamily: "var(--f-sans)",
                transition: "border-color .15s, background .15s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.blue;
                (e.currentTarget as HTMLButtonElement).style.background   = C.blueBg;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.border2;
                (e.currentTarget as HTMLButtonElement).style.background   = C.card;
              }}
            >
              <div style={{ fontSize: 8.5, color: C.sub, letterSpacing: ".5px" }}>Disponible sur</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{store}</div>
              <div style={{ fontSize: 8.5, color: C.sub }}>{platform}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Footer note ───────────────────── */}
      <div style={{ marginTop: 52, fontSize: 10, color: C.dim, animation: "fadeup .6s ease both", animationDelay: ".4s" }}>
        {ELECTION.title} · {ELECTION.institution} · {ELECTION.grade}
      </div>

    </div>
  );
}
