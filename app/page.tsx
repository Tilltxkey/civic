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

import { useEffect, useState, useCallback, useRef } from "react";
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
import { signInUser } from "./components/db";
import {
  DEPTS,
  Dept,
  INITIAL_VOTES_A,
  INITIAL_VOTES_B,
  INITIAL_REPORTING,
  ALL_RACES,
} from "./components/data";
import { useWindowWidth } from "./components/helpers";
import { ElectionProvider, useElection, POSTS, OVERLAY_SECS } from "./components/ElectionContext";
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

// ─── ELECTION COUNTDOWN OVERLAY ─────────────────────────────
// Full-screen overlay shown on launch and between sequential posts.
// The overlay lasts exactly OVERLAY_SECS seconds (imported from
// ElectionContext). During this window the election timers are NOT
// ticking — launchElection already pushed every endsAt forward by
// OVERLAY_SECS so the overlay duration never eats into voting time.
// All clients derive timing from the same DB timestamp, so they
// stay in sync regardless of when they joined the session.

function ElectionCountdownOverlay({
  label,
  overlayEndsAt, // ISO timestamp = launch time + OVERLAY_SECS
  onDone,
}: {
  label:          string;
  overlayEndsAt:  string;
  onDone:         () => void;
}) {
  const C = useC();
  const { isDark } = useTheme();

  const calc = () => Math.max(0, Math.floor((new Date(overlayEndsAt).getTime() - Date.now()) / 1000));
  const [secs, setSecs] = useState(calc);

  useEffect(() => {
    const s = calc();
    setSecs(s);
    if (s === 0) { setTimeout(onDone, 0); return; }
    const iv = setInterval(() => {
      const r = calc();
      setSecs(r);
      if (r === 0) { clearInterval(iv); setTimeout(onDone, 0); }
    }, 500);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayEndsAt]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const elapsed = Math.max(0, OVERLAY_SECS - secs);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: isDark ? "rgba(0,0,0,.82)" : "rgba(255,255,255,.88)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 20, padding: "32px 24px",
      animation: "fadeup .35s ease both",
    }}>

      {/* Big countdown number */}
      <div style={{
        fontFamily: "var(--f-mono)",
        fontSize: "clamp(80px, 26vw, 140px)",
        fontWeight: 700,
        color: C.sub,
        lineHeight: 1,
        letterSpacing: "-6px",
        opacity: secs === 0 ? 0 : 1,
        transition: "opacity .3s",
      }}>
        {pad(Math.floor(secs / 60))}:{pad(secs % 60)}
      </div>

      {/* Label */}
      <div style={{
        fontSize: 15, fontWeight: 500,
        color: C.dim,
        textAlign: "center", lineHeight: 1.6,
        maxWidth: 260,
      }}>
        {label}
      </div>

      {/* Progress bar — sweeps left to right over OVERLAY_SECS */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: 3, background: C.border,
      }}>
        <div style={{
          height: "100%",
          width: `${(elapsed / OVERLAY_SECS) * 100}%`,
          background: C.sub,
          transition: "width .5s linear",
          borderRadius: "0 2px 2px 0",
        }} />
      </div>
    </div>
  );
}

// ─── APP SHELL ───────────────────────────────────────────────
// Lives inside ElectionProvider so it can call useElection()
// and keep selectedRaceId in sync with the active post.

interface AppShellProps {
  user:             UserProfile;
  vA: number; vB: number; rep: number; depts: Dept[];
  activeTab:        "results" | "vote" | "community";
  setActiveTab:     (t: "results" | "vote" | "community") => void;
  communityFeed:    "all" | "mine";
  setCommunityFeed: (f: "all" | "mine") => void;
  openThesis:       Thesis | null;
  setOpenThesis:    (t: Thesis | null) => void;
  composePrefill:   string;
  setComposePrefill:(s: string) => void;
  onBadgeGranted:   () => void;
}

function AppShell({
  user, vA, vB, rep, depts,
  activeTab, setActiveTab,
  communityFeed, setCommunityFeed,
  openThesis, setOpenThesis,
  composePrefill, setComposePrefill,
  onBadgeGranted,
}: AppShellProps) {
  const C = useC();
  const { t } = useLang();
  const { election } = useElection();

  const [selectedRaceId, setSelectedRaceId] = useState<string>("president");
  const [userPicked, setUserPicked]         = useState(false);

  // Overlay state — shown on election launch and between sequential posts.
  // overlayEndsAt = DB launch time + OVERLAY_SECS (same for all clients).
  const [overlay, setOverlay] = useState<{ label: string; overlayEndsAt: string } | null>(null);
  const prevStatus    = useRef<string>("future");
  const prevPost      = useRef<string | null>(null);
  const lateJoinCheck = useRef(false); // runs once when election first loads

  const elStatus   = election?.status ?? "future";
  const isOngoing  = elStatus === "ongoing";
  const activePost = election?.activePostId ?? null;
  const elMode     = election?.mode ?? null;

  // ── Late-join guard ───────────────────────────────────────────
  // Fires once when election data arrives. If the election is already
  // ongoing AND the overlay window hasn't elapsed yet, show the overlay
  // immediately so late-joining users see the same countdown as everyone else.
  useEffect(() => {
    if (lateJoinCheck.current || !election) return; // only run once, only when data is ready
    lateJoinCheck.current = true;
    if (election.status !== "ongoing") return;

    // Derive overlayEndsAt the same way the transition effect does:
    // timer.endsAt − timer.durationSecs = the moment launch happened + OVERLAY_SECS.
    const refTimer = election.timers.find(t => !!t.endsAt);
    if (!refTimer?.endsAt) return;
    const overlayEndsAt = new Date(
      new Date(refTimer.endsAt).getTime() - refTimer.durationSecs * 1000
    ).toISOString();

    // Only show if the overlay window is still active (i.e. we're inside the 30s gap)
    if (new Date(overlayEndsAt).getTime() > Date.now()) {
      const label = election.mode === "sequentiel" && election.activePostId
        ? `Prochain poste : ${POSTS.find(p => p.id === election.activePostId)?.label ?? ""}. Le vote commence dans quelques instants…`
        : "Les élections vont commencer. Préparez-vous à voter !";
      setOverlay({ label, overlayEndsAt });
    }
    // Sync prevStatus so the transition effect doesn't double-fire
    prevStatus.current = "ongoing";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [election]);

  // Detect election launch → show launch overlay.
  // overlayEndsAt is derived from the first active timer's endsAt minus its
  // durationSecs — that gives exactly the launch instant + OVERLAY_SECS,
  // which is the same wall-clock moment for every client.
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = elStatus;
    if ((prev === "future" || prev === "inscription") && elStatus === "ongoing") {
      // Derive overlayEndsAt from DB: earliest timer endsAt minus its durationSecs
      // = the moment the CEP hit launch + OVERLAY_SECS. Consistent across clients.
      const firstTimer = election?.timers.find(t => !!t.endsAt);
      const overlayEndsAt = firstTimer?.endsAt
        ? new Date(new Date(firstTimer.endsAt).getTime() - firstTimer.durationSecs * 1000).toISOString()
        : new Date(Date.now() + OVERLAY_SECS * 1000).toISOString(); // fallback
      setOverlay({ label: "Les élections vont commencer. Préparez-vous à voter !", overlayEndsAt });
    }
    if (elStatus === "future" || elStatus === "past") {
      setOverlay(null);
      setSelectedRaceId("president");
      setUserPicked(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elStatus]);

  // Detect sequential post change → show transition overlay.
  // Same derivation: next post's endsAt minus its durationSecs = advance time + OVERLAY_SECS.
  useEffect(() => {
    const prev = prevPost.current;
    prevPost.current = activePost;
    if (!isOngoing || !activePost) return;
    if (prev !== null && prev !== activePost && elMode === "sequentiel") {
      const nextTimer = election?.timers.find(t => t.postId === activePost && !!t.endsAt);
      const overlayEndsAt = nextTimer?.endsAt
        ? new Date(new Date(nextTimer.endsAt).getTime() - nextTimer.durationSecs * 1000).toISOString()
        : new Date(Date.now() + OVERLAY_SECS * 1000).toISOString(); // fallback
      const postLabel = POSTS.find(p => p.id === activePost)?.label ?? "";
      setOverlay({ label: `Prochain poste : ${postLabel}. Le vote commence dans quelques instants…`, overlayEndsAt });
    }
    setSelectedRaceId(activePost);
    setUserPicked(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOngoing, activePost, elMode]);

  const handleSelectRace = (id: string) => {
    setSelectedRaceId(id);
    setUserPicked(true);
    const s = document.getElementById("main-scroll");
    if (s) s.scrollTop = 0;
  };

  // Card click: user taps a candidate card in Race → open vote sheet pre-selected
  const [pendingVote, setPendingVote] = useState<{ candidateId: string; postId: string } | null>(null);
  const handleCardClick = useCallback((candidateId: string, postId: string) => {
    setPendingVote({ candidateId, postId });
  }, []);
  const handlePendingVoteDone = useCallback(() => setPendingVote(null), []);

  const handleOverlayDone = useCallback(() => setOverlay(null), []);

  return (
    <>
      {/* ── Full-screen pre-election countdown overlay ── */}
      {overlay && (
        <ElectionCountdownOverlay
          label={overlay.label}
          overlayEndsAt={overlay.overlayEndsAt}
          onDone={handleOverlayDone}
        />
      )}

      {/* Outer shell — fixed to viewport */}
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>

        {/* ── Tab headers ── */}
        {activeTab === "vote"      && <Header user={user} />}
        {activeTab === "results"   && <ThesesHeader user={user} />}
        {activeTab === "community" && <CommunityHeader tab={communityFeed} setTab={setCommunityFeed} user={user} />}

        {/* Scrollable content */}
        <div id="main-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", background: C.bg }}>
          {activeTab === "vote" && (
            <Race votesA={vA} votesB={vB} reporting={rep} selectedRaceId={selectedRaceId} onCardClick={handleCardClick} />
          )}
          {activeTab !== "community" && (
            <Treemap
              depts={depts}
              selectedRaceId={selectedRaceId}
              onSelectRace={handleSelectRace}
              pendingVote={pendingVote}
              onPendingVoteDone={handlePendingVoteDone}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onOpenThesis={setOpenThesis}
              currentUser={user}
              onBadgeGranted={onBadgeGranted}
              onGoToComm={(prefill) => { setComposePrefill(prefill); setActiveTab("community"); }}
            />
          )}
          {activeTab === "community" && (
            <CommunityTab
              key={composePrefill || "community"}
              feedTab={communityFeed}
              currentUser={user}
              autoOpenCompose={!!composePrefill}
              composePrefill={composePrefill}
              onComposeClosed={() => setComposePrefill("")}
            />
          )}
        </div>

        {/* ── NavBar ── */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 10, background: C.surface, borderTop: `1px solid ${C.border}`,
          display: "flex", alignItems: "stretch",
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
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  gap: 4, padding: "10px 4px 12px",
                  border: "none", cursor: "pointer",
                  fontFamily: "var(--f-sans)", background: "transparent",
                  color: isActive ? C.gold : C.sub,
                  WebkitTapHighlightColor: "transparent", position: "relative",
                }}
              >
                {isActive && (
                  <div style={{
                    position: "absolute", top: 8,
                    left: "50%", transform: "translateX(-50%)",
                    width: 64, height: 32, borderRadius: 999, background: C.goldBg,
                  }} />
                )}
                <div style={{ lineHeight: 1, position: "relative", zIndex: 1 }}>{icon}</div>
                <div style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 400,
                  letterSpacing: ".1px", lineHeight: 1, whiteSpace: "nowrap",
                  position: "relative", zIndex: 1,
                }}>{label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sync user into ProfileContext */}
      {user && <UserSync user={user} />}

      {/* PDF Viewer — page level, covers navbar */}
      {openThesis && <PDFViewer thesis={openThesis} onClose={() => setOpenThesis(null)} />}
    </>
  );
}

export default function Page() {
  // ── Auth state — local state, synced into ProfileContext via UserSync ──
  const [user, setUser] = useState<UserProfile | null>(null);
  const { setUser: setProfileUser } = useProfile();

  // Re-fetch current user from DB and push fresh badge/role into all contexts.
  // Called by ElectionContext after endElection and resetElection.
  const handleUserRefresh = useCallback(async () => {
    if (!user) return;
    const { user: fresh } = await signInUser(user.matricule, user.nom);
    if (fresh) {
      setUser(fresh);
      setProfileUser(fresh);
    }
  }, [user, setProfileUser]);

  // ── Live state ─────────────────────────
  const [vA,    setVA]    = useState(INITIAL_VOTES_A);
  const [vB,    setVB]    = useState(INITIAL_VOTES_B);
  const [rep,   setRep]   = useState(INITIAL_REPORTING);
  const [depts, setDepts] = useState<Dept[]>(DEPTS);
  const [activeTab, setActiveTab]   = useState<"results"|"vote"|"community">("vote");
  const [communityFeed, setCommunityFeed] = useState<"all"|"mine">("all");
  const [openThesis, setOpenThesis] = useState<Thesis | null>(null);
  const [composePrefill, setComposePrefill] = useState("");
  const C = useC();
  const { t } = useLang();

  // ── Responsive ─────────────────────────
  // 0 during SSR — return null to avoid hydration mismatch
  const vw = useWindowWidth();

  // Vote counts are driven by real DB data via ElectionContext (allVotes).

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
        <ElectionProvider user={user} onUserRefresh={handleUserRefresh}>
          <AppShell
            user={user}
            vA={vA} vB={vB} rep={rep} depts={depts}
            activeTab={activeTab} setActiveTab={setActiveTab}
            communityFeed={communityFeed} setCommunityFeed={setCommunityFeed}
            openThesis={openThesis} setOpenThesis={setOpenThesis}
            composePrefill={composePrefill} setComposePrefill={setComposePrefill}
            onBadgeGranted={() => { /* badge only awarded to winners by endElection */ }}
          />
        </ElectionProvider>
      )}
    </>
  );
}