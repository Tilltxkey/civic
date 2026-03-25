/**
 * page.tsx
 * ─────────────────────────────────────────────────────────────
 * Root page for the Civique election dashboard.
 *
 * WHAT THIS FILE DOES:
 *  1. Detects screen width → mobile app vs desktop gate.
 *  2. Holds live state: vote counts, reporting %, dept data.
 *  3. Runs a simulation tick every 4 seconds (replace with
 *     a real API fetch when your backend is ready).
 *  4. Passes data down to child components.
 *
 * HOW TO REPLACE THE SIMULATION WITH A REAL API:
 *  - Remove the setInterval in the useEffect below.
 *  - Add a fetch inside a separate useEffect:
 *
 *    useEffect(() => {
 *      const id = setInterval(async () => {
 *        const data = await fetch("/api/results").then(r => r.json());
 *        setVA(data.votesA);
 *        setVB(data.votesB);
 *        setRep(data.reporting);
 *        setDepts(data.depts);
 *      }, 10_000); // poll every 10 seconds
 *      return () => clearInterval(id);
 *    }, []);
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useC } from "./components/tokens";

// ── Components ───────────────────────────
import Ticker      from "./components/Ticker";
import Header      from "./components/Header";
import Race        from "./components/Race";
import Treemap, { PDFViewer, ThesesHeader } from "./components/Treemap";
import { CommunityHeader } from "./components/CommunityTab";
import { CommunityTab } from "./components/CommunityTab";
import type { Thesis } from "./components/Treemap";
import DesktopGate from "./components/DesktopGate";
import { UserSync } from "./components/UserSync";
import AuthFlow    from "./components/AuthFlow";
import type { UserProfile } from "./components/AuthFlow";

// ── Data & helpers ───────────────────────
import { useTheme } from "./components/ThemeContext";
import { useProfile } from "./components/ProfileContext";
import { useLang } from "./components/LangContext";
import {
  DEPTS,
  Dept,
  tickVotes,
  tickDepts,
  INITIAL_VOTES_A,
  INITIAL_VOTES_B,
  INITIAL_REPORTING,
  ALL_RACES,
} from "./components/data";
import { useWindowWidth } from "./components/helpers";
import { C, BREAK }        from "./components/tokens";

// ─── GLOBAL CSS ──────────────────────────────────────────────
// Keyframes and global rules injected once into the document.
// Animations referenced by component inline styles live here.

const CSS = `
  /* Scrolling ticker */
  @keyframes scroll {
    from { transform: translateX(0);    }
    to   { transform: translateX(-50%); }
  }

  /* Blinking live dot */
  @keyframes dot {
    0%, 100% { opacity: 1;   }
    50%       { opacity: .15; }
  }

  /* Page fade-in on load */
  @keyframes fadeup {
    from { opacity: 0; transform: translateY(8px);  }
    to   { opacity: 1; transform: translateY(0);    }
  }

  /* Phone mockup float-in on desktop gate */
  @keyframes rise {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0);    }
  }

  /* Department cell hover dim */
  .dept:hover { filter: brightness(.75); }

  /* Hide scrollbars globally */
  ::-webkit-scrollbar { display: none; }
`;


// ─── PAGE ROOT ───────────────────────────────────────────────

export default function Page() {
  // ── Auth state — local state, synced into ProfileContext via UserSync ──
  const [user, setUser] = useState<UserProfile | null>(null);

  // ── Live state ─────────────────────────
  const [vA,    setVA]    = useState(INITIAL_VOTES_A);
  const [vB,    setVB]    = useState(INITIAL_VOTES_B);
  const [rep,   setRep]   = useState(INITIAL_REPORTING);
  const [depts, setDepts] = useState<Dept[]>(DEPTS);
  const [selectedRaceId, setSelectedRaceId] = useState<string>("president");
  const [activeTab, setActiveTab]   = useState<"results"|"vote"|"community">("vote");
  const [communityFeed, setCommunityFeed] = useState<"all"|"mine">("all");
  const [openThesis, setOpenThesis] = useState<Thesis | null>(null);
  const C = useC();
  const { t } = useLang();

  // ── Responsive ─────────────────────────
  // 0 during SSR — return null to avoid hydration mismatch
  const vw = useWindowWidth();

  // ── Simulation tick ────────────────────
  // Replace with a real API call when ready (see file header).
  const tick = useCallback(() => {
    setVA(prev => {
      const next = tickVotes(prev, vB);
      setVB(next.vB);
      return next.vA;
    });
    setRep(prev => Math.min(99, +(prev + Math.random() * 1.2).toFixed(1)));
    setDepts(prev => tickDepts(prev));
  }, [vB]);

  useEffect(() => {
    const id = setInterval(tick, 4000); // tick every 4 seconds
    return () => clearInterval(id);
  }, [tick]);

  // ── Render guard ───────────────────────
  // vw = 0 means the browser hasn't measured yet (SSR).
  // Returning null prevents a flash of wrong layout.
  if (vw === 0) return null;

  // ── Auth gate — show AuthFlow until user is set ────────────
  if (!user) {
    return (
      <>
        <style>{CSS}</style>
        <AuthFlow onAuth={setUser} />
      </>
    );
  }

  return (
    <>
      {/* Inject global keyframes once */}
      <style>{CSS}</style>

      {/* ── Desktop: show download gate ── */}
      {vw >= BREAK ? (
        <div style={{ animation: "fadeup .4s ease both" }}>
          <DesktopGate />
        </div>

      ) : (
        /* ── Mobile: show the full app ── */
        <>
          {/* Outer shell — fixed to viewport, never scrolls itself */}
          {/* NOTE: no animation here — CSS animation creates stacking context that traps AppMenu */}
          <div style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
          }}>

            {/* ── Tab headers — outside overflow div so AppMenu is never trapped ── */}
            {activeTab === "vote"      && <Header user={user} />}
            {activeTab === "results"   && <ThesesHeader user={user} />}
            {activeTab === "community" && <CommunityHeader tab={communityFeed} setTab={setCommunityFeed} user={user} />}

            {/* Scrollable content — overflow:auto here would trap fixed children */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", background: C.bg }}>
              {activeTab === "vote" && (
                <Race votesA={vA} votesB={vB} reporting={rep} selectedRaceId={selectedRaceId} />
              )}
              {activeTab !== "community" && (
                <Treemap depts={depts} selectedRaceId={selectedRaceId} onSelectRace={setSelectedRaceId} activeTab={activeTab} onTabChange={setActiveTab} onOpenThesis={setOpenThesis} />
              )}
              {activeTab === "community" && user && <CommunityTab feedTab={communityFeed} currentUser={user} />}
            </div>

            {/* Ticker — always at the bottom of the shell */}
            {/* <Ticker tag="FLASH" /> */}

            {/* ── NavBar — inside shell so AppMenu shares same stacking context ── */}
            <div style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              zIndex: 10,
              background: C.surface,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "stretch",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}>
              {([
                { id: "results",   label: t("nav.theses"), icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" stroke="currentColor" strokeWidth="1.7"/>
                    <path d="M9 7h7M9 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )},
                { id: "vote",      label: t("nav.vote"), icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="10" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.7"/>
                    <path d="M4 7h3.5M12.5 7H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                    <circle cx="10" cy="12" r="2.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8.7 12l.9.9 1.7-1.8" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12.5 12H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                    <circle cx="10" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.7"/>
                    <path d="M12.5 17H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                )},
                { id: "community", label: t("nav.community"), icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="9.5" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" fill="none"/>
                    <path d="M3 19c0-3 2.9-5 6.5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                    <circle cx="16.5" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                    <path d="M20.5 18.5c0-2.2-1.8-3.8-4-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )},
              ] as { id: "results"|"vote"|"community"; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    style={{
                      flex: 1,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      gap: 4,
                      padding: "10px 4px 12px",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "var(--f-sans)",
                      background: "transparent",
                      color: isActive ? C.gold : C.sub,
                      WebkitTapHighlightColor: "transparent",
                      position: "relative",
                    }}
                  >
                    {isActive && (
                      <div style={{
                        position: "absolute", top: 8,
                        left: "50%", transform: "translateX(-50%)",
                        width: 64, height: 32, borderRadius: 999,
                        background: C.goldBg,
                      }} />
                    )}
                    <div style={{ lineHeight: 1, position: "relative", zIndex: 1 }}>{icon}</div>
                    <div style={{
                      fontSize: 11, fontWeight: isActive ? 700 : 400,
                      letterSpacing: ".1px", lineHeight: 1, whiteSpace: "nowrap",
                      position: "relative", zIndex: 1,
                    }}>
                      {label}
                    </div>
                  </button>
                );
              })}
            </div>

          </div>

          {/* Sync user into ProfileContext for AppMenu and other components */}
          {user && <UserSync user={user} />}

          {/* ── PDF Viewer — page level, covers navbar ── */}
          {openThesis && <PDFViewer thesis={openThesis} onClose={() => setOpenThesis(null)} />}


        </>
      )}
    </>
  );
}