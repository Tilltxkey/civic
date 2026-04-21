"use client";

/**
 * ElectionSheets.tsx
 * ─────────────────────────────────────────────────────────────
 * All bottom-sheet modals for the election flow.
 *
 * CEP sheets:
 *   <InscriptionSheet>  — lancer les inscriptions (posts + durée)
 *   <LaunchElectionSheet> — lancer les élections (3 steps)
 *
 * Voter sheets:
 *   <CandidacySheet>    — être candidat·e
 *   <VoteSheet> (already in Treemap.tsx — extended here for real votes)
 *
 * Re-uses the same bottom-sheet chrome (handle, backdrop, sheetUp anim)
 * as the existing VoteSheet in Treemap.tsx.
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from "react";
import { useC } from "./tokens";
import { useLang } from "./LangContext";
import { POSTS, PostId, PostTimer, ElectionMode, useElection } from "./ElectionContext";
import { candidateColor } from "./Race";
import type { UserProfile } from "./AuthFlow";

// ─── SHARED SHEET CHROME ────────────────────────────────────

function Sheet({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const C = useC();

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          zIndex: 200,
          cursor: onClose ? "pointer" : "default",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: C.surface,
        borderRadius: "22px 22px 0 0",
        zIndex: 201,
        animation: "sheetUp .3s cubic-bezier(.2,.8,.3,1) both",
        boxShadow: "0 -8px 40px rgba(0,0,0,.18)",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 99, margin: "12px auto 8px", flexShrink: 0 }} />
        {children}
      </div>
    </>
  );
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  const C = useC();
  return (
    <div style={{ fontWeight: 700, fontSize: 18, color: C.text, padding: "4px 20px 6px" }}>
      {children}
    </div>
  );
}

function SheetSub({ children }: { children: React.ReactNode }) {
  const C = useC();
  return (
    <div style={{ fontSize: 12, color: C.sub, padding: "0 20px 16px", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function ConfirmBtn({
  label, onClick, color, disabled,
}: {
  label: string; onClick: () => void; color?: string; disabled?: boolean;
}) {
  const C = useC();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", padding: "15px",
        borderRadius: 14, border: "none",
        background: disabled ? C.border : (color ?? C.text),
        color: disabled ? C.sub : "#fff",
        fontFamily: "var(--f-sans)",
        fontSize: 15, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .2s",
      }}
    >
      {label}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  const C = useC();
  return (
    <button
      onClick={onClick}
      style={{
        background: "none", border: "none", color: C.sub,
        fontFamily: "var(--f-sans)", fontSize: 13, cursor: "pointer",
        padding: "0 20px 8px", display: "flex", alignItems: "center", gap: 4,
      }}
    >
      ← Retour
    </button>
  );
}

// Toggle: Tous les postes / Un poste
function PostToggle({
  allPosts,
  setAllPosts,
  selectedPost,
  setSelectedPost,
}: {
  allPosts: boolean;
  setAllPosts: (v: boolean) => void;
  selectedPost: PostId;
  setSelectedPost: (v: PostId) => void;
}) {
  const C = useC();
  return (
    <div style={{ padding: "0 20px 16px" }}>
      {/* Toggle pill */}
      <div style={{
        display: "flex",
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 12,
      }}>
        {[
          { label: "Tous les postes", value: true },
          { label: "Un poste",        value: false },
        ].map(opt => (
          <button
            key={String(opt.value)}
            onClick={() => setAllPosts(opt.value)}
            style={{
              flex: 1, padding: "11px 8px",
              border: "none", cursor: "pointer",
              fontFamily: "var(--f-sans)", fontSize: 13, fontWeight: 600,
              background: allPosts === opt.value ? C.gold : "transparent",
              color:      allPosts === opt.value ? "#fff" : C.sub,
              transition: "background .15s, color .15s",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Post selector — only when "Un poste" selected */}
      {!allPosts && (
        <div style={{ position: "relative" }}>
          <select
            value={selectedPost}
            onChange={e => setSelectedPost(e.target.value as PostId)}
            style={{
              width: "100%", padding: "12px 36px 12px 14px",
              borderRadius: 12,
              border: `1.5px solid ${C.border}`,
              background: C.card, color: C.text,
              fontSize: 14, fontFamily: "var(--f-sans)",
              outline: "none", appearance: "none", WebkitAppearance: "none",
              cursor: "pointer",
            }}
          >
            {POSTS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <path d="M6 9l6 6 6-6" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── DURATION SLIDER ────────────────────────────────────────
// Value in seconds. Snaps to 1min…12h.

const SLIDER_STEPS = [
  60, 120, 300, 600, 900, 1800,       // 1m 2m 5m 10m 15m 30m
  3600, 5400, 7200, 10800, 14400,     // 1h 1h30 2h 3h 4h
  18000, 21600, 43200,                 // 5h 6h 12h
];

function fmtDuration(secs: number): string {
  if (secs < 3600) return `${secs / 60} min`;
  const h = secs / 3600;
  return h === Math.floor(h) ? `${h}h` : `${Math.floor(h)}h${(secs % 3600) / 60}`;
}

function DurationSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const C = useC();
  const idx = SLIDER_STEPS.indexOf(value);
  const sliderIdx = idx >= 0 ? idx : 6; // default 1h

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</div>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 700,
          color: C.gold, background: C.goldBg,
          padding: "3px 10px", borderRadius: 8,
        }}>
          {fmtDuration(value)}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS.length - 1}
        value={sliderIdx}
        onChange={e => onChange(SLIDER_STEPS[+e.target.value])}
        style={{
          width: "100%",
          accentColor: C.gold,
          cursor: "pointer",
          height: 4,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 10, color: C.dim }}>1 min</span>
        <span style={{ fontSize: 10, color: C.dim }}>12h</span>
      </div>
    </div>
  );
}

// ─── INSCRIPTION DURATION SLIDER (1min → 72h) ───────────────

const INSCRIPTION_SLIDER_STEPS = [
  60, 120, 300, 600, 900, 1800,                          // 1m 2m 5m 10m 15m 30m
  3600, 7200, 10800, 14400, 18000, 21600,                // 1h 2h 3h 4h 5h 6h
  43200, 64800, 86400,                                   // 12h 18h 24h
  129600, 172800, 216000, 259200,                        // 36h 48h 60h 72h
];

function fmtInscriptionDuration(secs: number): string {
  if (secs < 3600) return `${secs / 60} min`;
  if (secs < 86400) {
    const h = secs / 3600;
    return h === Math.floor(h) ? `${h}h` : `${Math.floor(h)}h${(secs % 3600) / 60}`;
  }
  const d = secs / 86400;
  return d === Math.floor(d) ? `${d}j` : `${Math.floor(d)}j ${Math.round((secs % 86400) / 3600)}h`;
}

function InscriptionDurationSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const C = useC();
  const idx = INSCRIPTION_SLIDER_STEPS.indexOf(value);
  const sliderIdx = idx >= 0 ? idx : 6; // default 1h

  return (
    <div style={{ padding: "0 20px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Durée des inscriptions</div>
        <div style={{
          fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 700,
          color: C.gold, background: C.goldBg,
          padding: "3px 10px", borderRadius: 8,
        }}>
          {fmtInscriptionDuration(value)}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={INSCRIPTION_SLIDER_STEPS.length - 1}
        value={sliderIdx}
        onChange={e => onChange(INSCRIPTION_SLIDER_STEPS[+e.target.value])}
        style={{
          width: "100%",
          accentColor: C.gold,
          cursor: "pointer",
          height: 4,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 10, color: C.dim }}>1 min</span>
        <span style={{ fontSize: 10, color: C.dim }}>72h</span>
      </div>

      {/* Preview pill — shows what the countdown will look like */}
      <div style={{
        marginTop: 16,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      }}>
        <div style={{ fontSize: 12, color: C.sub }}>Aperçu du compteur :</div>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          background: C.surface,
          border: `1px solid ${C.gold}`,
          borderRadius: 99, padding: "5px 14px", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 500, color: C.gold, letterSpacing: "1.5px", lineHeight: 1 }}>
            {(() => {
              const h = Math.floor(value / 3600);
              const m = Math.floor((value % 3600) / 60);
              const s = value % 60;
              const pad = (n: number) => String(n).padStart(2, "0");
              return `${pad(h)}:${pad(m)}:${pad(s)}`;
            })()}
          </div>
          <div style={{ fontSize: 8, color: C.gold, letterSpacing: ".5px", lineHeight: 1, textTransform: "uppercase" }}>
            inscriptions
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SUCCESS SCREEN (auto-dismiss) ──────────────────────────

function SuccessScreen({
  title,
  sub,
  onDismiss,
  delayMs = 5000,
}: {
  title: string;
  sub:   string;
  onDismiss: () => void;
  delayMs?:  number;
}) {
  const C = useC();
  const [countdown, setCountdown] = useState(Math.round(delayMs / 1000));

  useEffect(() => {
    const iv = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) {
          clearInterval(iv);
          // Defer onDismiss so it never fires during React's render phase
          setTimeout(onDismiss, 0);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [onDismiss]);

  return (
    <Sheet>
      <div style={{
        padding: "20px 24px 32px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        textAlign: "center",
      }}>
        {/* Gold check */}
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: C.goldBg, border: `2px solid ${C.gold}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "checkPop .4s cubic-bezier(.2,.8,.3,1) both",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke={C.gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{title}</div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, maxWidth: 280 }}>{sub}</div>

        <button
          onClick={onDismiss}
          style={{
            marginTop: 8, width: "100%", padding: "14px",
            borderRadius: 14, border: `1.5px solid ${C.border2}`,
            background: C.card, color: C.text,
            fontFamily: "var(--f-sans)", fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          OK ({countdown}s)
        </button>
      </div>
    </Sheet>
  );
}

// ─── CEP: INSCRIPTION SHEET ──────────────────────────────────
// Step 1: choose posts
// Step 2: set inscription duration (new — 1min → 72h slider)
// Step 3: success screen

type InscriptionStep = "posts" | "duration";

export function InscriptionSheet({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { launchInscription } = useElection();
  const [step,         setStep]         = useState<InscriptionStep>("posts");
  const [allPosts,     setAllPosts]     = useState(true);
  const [selectedPost, setSelectedPost] = useState<PostId>("president");
  const [durationSecs, setDurationSecs] = useState(3600); // 1h default
  const [success,      setSuccess]      = useState(false);

  const handleConfirm = async () => {
    const posts: PostId[] = allPosts
      ? POSTS.map(p => p.id)
      : [selectedPost];
    await launchInscription(posts, durationSecs);
    setSuccess(true);
  };

  if (success) {
    return (
      <SuccessScreen
        title="Phase d'inscription lancée !"
        sub="Les étudiants de votre catégorie peuvent maintenant soumettre leur candidature."
        onDismiss={onClose}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      {/* ── Step 1: Posts ── */}
      {step === "posts" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <SheetTitle>Lancer la phase d'inscription</SheetTitle>
            <SheetSub>Choisissez les postes ouverts aux candidatures.</SheetSub>
            <PostToggle
              allPosts={allPosts}
              setAllPosts={setAllPosts}
              selectedPost={selectedPost}
              setSelectedPost={setSelectedPost}
            />
          </div>
          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label="Continuer"
              color={C.gold}
              onClick={() => setStep("duration")}
            />
          </div>
        </>
      )}

      {/* ── Step 2: Duration ── */}
      {step === "duration" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <BackBtn onClick={() => setStep("posts")} />
            <SheetTitle>Durée des inscriptions</SheetTitle>
            <SheetSub>
              Combien de temps les candidatures resteront-elles ouvertes ? Le compteur démarrera dès la confirmation.
            </SheetSub>
            <InscriptionDurationSlider
              value={durationSecs}
              onChange={setDurationSecs}
            />
          </div>
          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label="Lancer les inscriptions"
              color={C.gold}
              onClick={handleConfirm}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}

// ─── CEP: LAUNCH ELECTION SHEET (3 steps) ───────────────────

type LaunchStep = "posts" | "mode" | "timers" | "success";

export function LaunchElectionSheet({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { election, launchElection } = useElection();
  const [step,         setStep]         = useState<LaunchStep>("posts");
  const [allPosts,     setAllPosts]     = useState(true);
  const [selectedPost, setSelectedPost] = useState<PostId>("president");
  const [mode,         setMode]         = useState<ElectionMode>("sequentiel");
  const [presidentSecs,   setPresidentSecs]   = useState(300);  // 5min default
  const [othersSecs,      setOthersSecs]      = useState(300);

  const chosenPosts: PostId[] = allPosts
    ? POSTS.map(p => p.id)
    : [selectedPost];

  const handleContinueFromPosts = () => setStep("mode");
  const handleContinueFromMode  = () => setStep("timers");

  const handleLaunch = async () => {
    // Build timers array
    const timers: PostTimer[] = chosenPosts.map(postId => ({
      postId,
      durationSecs: postId === "president" ? presidentSecs : othersSecs,
      endsAt: null,
    }));
    await launchElection(chosenPosts, mode, timers);
    setStep("success");
  };

  if (step === "success") {
    return (
      <SuccessScreen
        title="Élections lancées !"
        sub="Le vote est maintenant ouvert pour votre catégorie. Le décompte est en cours."
        onDismiss={onClose}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      {/* ── Step 1: Posts ── */}
      {step === "posts" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <SheetTitle>Lancer les élections</SheetTitle>
            <SheetSub>Sélectionnez les postes soumis au vote.</SheetSub>
            <PostToggle
              allPosts={allPosts}
              setAllPosts={setAllPosts}
              selectedPost={selectedPost}
              setSelectedPost={setSelectedPost}
            />
          </div>
          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn label="Continuer" color={C.gold} onClick={handleContinueFromPosts} />
          </div>
        </>
      )}

      {/* ── Step 2: Mode ── */}
      {step === "mode" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <BackBtn onClick={() => setStep("posts")} />
            <SheetTitle>Mode de scrutin</SheetTitle>
            <SheetSub>Comment souhaitez-vous organiser le vote ?</SheetSub>

            <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {([
                {
                  value: "ensemble" as ElectionMode,
                  label: "Tous les postes ensemble",
                  sub: "Tous les votes s'ouvrent simultanément.",
                  disabled: true,
                },
                {
                  value: "sequentiel" as ElectionMode,
                  label: "L'un après l'autre",
                  sub: "Du Responsable Affaires Académiques au Président·e, dans l'ordre d'importance.",
                  disabled: false,
                },
              ] as { value: ElectionMode; label: string; sub: string; disabled: boolean }[]).map(opt => {
                const active = mode === opt.value;
                return (
                  <div
                    key={opt.value}
                    onClick={() => { if (!opt.disabled) setMode(opt.value); }}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 14,
                      border: `1.5px solid ${opt.disabled ? C.border : active ? C.gold : C.border}`,
                      background: opt.disabled ? C.bg : active ? C.goldBg : C.card,
                      cursor: opt.disabled ? "not-allowed" : "pointer",
                      opacity: opt.disabled ? 0.4 : 1,
                      transition: "border-color .15s, background .15s",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, color: opt.disabled ? C.dim : active ? C.gold : C.text }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{opt.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn label="Continuer" color={C.gold} onClick={handleContinueFromMode} />
          </div>
        </>
      )}

      {/* ── Step 3: Timers ── */}
      {step === "timers" && (
        <>
          <div style={{ overflowY: "auto", flex: 1, padding: "0 20px" }}>
            <BackBtn onClick={() => setStep("mode")} />
            <SheetTitle>Durée du vote</SheetTitle>
            <SheetSub>
              {mode === "sequentiel"
                ? "Le poste de Président·e a sa propre durée. Tous les autres partagent la durée commune."
                : "Durée commune pour tous les postes."}
            </SheetSub>

            {/* President always gets its own slider */}
            {chosenPosts.includes("president") && (
              <DurationSlider
                label="Président·e du Comité Exécutif"
                value={presidentSecs}
                onChange={setPresidentSecs}
              />
            )}

            {/* Others slider */}
            {chosenPosts.some(p => p !== "president") && (
              <DurationSlider
                label={mode === "sequentiel" ? "Tous les autres postes" : "Durée commune"}
                value={othersSecs}
                onChange={setOthersSecs}
              />
            )}
          </div>
          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn label="Lancer les élections" color={C.gold} onClick={handleLaunch} />
          </div>
        </>
      )}
    </Sheet>
  );
}

// ─── VOTER: CANDIDACY SHEET ──────────────────────────────────

interface CandidacySheetProps {
  user:           UserProfile;
  onClose:        () => void;
  onGoToComm:     (prefill: string) => void; // redirect to community tab with pre-filled text
  onBadgeGranted: () => void;                // update local user state badge → gold
}

export function CandidacySheet({ user, onClose, onGoToComm, onBadgeGranted }: CandidacySheetProps) {
  const C = useC();
  const { election, submitCandidacy, candidatesForPost, inscriptionSecsLeft } = useElection();

  const [selectedPost,      setSelectedPost]      = useState<PostId | null>(null);
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [success,           setSuccess]           = useState(false);
  const [inscriptionClosed, setInscriptionClosed] = useState(false);

  // Live check: close registrations when timer hits zero
  useEffect(() => {
    if (!election?.inscriptionEndsAt) return;
    const update = () => setInscriptionClosed(inscriptionSecsLeft() === 0);
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [election?.inscriptionEndsAt, inscriptionSecsLeft]);

  if (!election || election.status !== "inscription") return null;

  const openPosts = POSTS.filter(p => election.openPosts.includes(p.id));

  const handleSubmit = async () => {
    if (!selectedPost) return;
    setLoading(true);
    setError(null);
    const { error: err } = await submitCandidacy(selectedPost, user);
    setLoading(false);
    if (err) {
      setError(
        err === "already_candidate" ? "Vous êtes déjà candidat·e pour ce poste." :
        err === "cep_cannot_candidate" ? "Les membres du CEP ne peuvent pas se présenter." :
        "Une erreur est survenue. Réessayez."
      );
      return;
    }
    onBadgeGranted();
    setSuccess(true);
  };

  if (success) {
    const post = POSTS.find(p => p.id === selectedPost);
    const commText = `Je me présente pour le poste de ${post?.label ?? selectedPost} ! Voici ma vision pour notre faculté…`;
    return (
      <SuccessScreen
        title="Candidature enregistrée !"
        sub="Votre candidature a été enregistrée. Partagez votre vision avec la communauté."
        onDismiss={() => {
          // Save the prefill + intent to localStorage so page.tsx can restore
          // after the reload (which re-fetches user with the fresh gold badge).
          localStorage.setItem("civique_post_prefill", commText);
          window.location.reload();
        }}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div style={{ overflowY: "auto", flex: 1 }}>
        <SheetTitle>Se porter candidat·e</SheetTitle>
        <SheetSub>
          {inscriptionClosed
            ? "La période de candidature est terminée. Les inscriptions sont closes."
            : "Choisissez le poste pour lequel vous souhaitez vous présenter."}
        </SheetSub>

        {/* Closed banner */}
        {inscriptionClosed && (
          <div style={{
            margin: "0 20px 16px",
            padding: "12px 16px",
            borderRadius: 12,
            background: C.none,
            border: `1px solid ${C.border2}`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" stroke={C.dim} strokeWidth="1.7"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={C.dim} strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 13, color: C.sub, lineHeight: 1.4 }}>
              Les candidatures sont closes.
            </span>
          </div>
        )}

        <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {openPosts.map((post, i) => {
            const cands = candidatesForPost(post.id);
            const alreadyIn = cands.some(c => c.userId === user.id);
            const isSelected = selectedPost === post.id;
            const color = candidateColor(cands.length);
            const isDisabled = alreadyIn || inscriptionClosed;

            return (
              <div
                key={post.id}
                onClick={() => { if (!isDisabled) setSelectedPost(post.id); }}
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: `1.5px solid ${isDisabled ? C.border : isSelected ? color : C.border}`,
                  background: isDisabled ? C.bg : isSelected ? `${color}11` : C.card,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.45 : 1,
                  transition: "border-color .15s, background .15s",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: isDisabled ? C.dim : isSelected ? color : C.text }}>
                    {post.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                    {cands.length} candidat{cands.length !== 1 ? "s" : ""}
                  </div>
                </div>
                {alreadyIn && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: ".5px", textTransform: "uppercase" }}>
                    Inscrit·e
                  </div>
                )}
                {isSelected && !isDisabled && (
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div style={{ margin: "0 20px 16px", padding: "10px 14px", borderRadius: 10, background: "#FDF1EF", color: "#C8250E", fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
        <ConfirmBtn
          label={
            inscriptionClosed ? "Candidatures closes" :
            loading ? "Enregistrement…" :
            "Confirmer ma candidature"
          }
          color={selectedPost && !inscriptionClosed ? candidateColor(candidatesForPost(selectedPost).length) : undefined}
          onClick={handleSubmit}
          disabled={!selectedPost || loading || inscriptionClosed}
        />
      </div>
    </Sheet>
  );
}

// ─── CEP: REAL VOTE SHEET ────────────────────────────────────

interface RealVoteSheetProps {
  user:    UserProfile;
  postId:  PostId;
  onClose: () => void;
  initialCandidateId?: string; // when set, opens directly on the confirm step
}

export function RealVoteSheet({ user, postId, onClose, initialCandidateId }: RealVoteSheetProps) {
  const C = useC();
  const { candidatesForPost, castVote, votesForPost, profilePhotos } = useElection();

  const cands     = candidatesForPost(postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const myVotes   = votesForPost(postId);
  const alreadyVoted = myVotes.length > 0;

  const [selected, setSelected] = useState<string | null>(initialCandidateId ?? null);
  const [step,     setStep]     = useState<"pick" | "confirm" | "done">(
    initialCandidateId ? "confirm" : "pick"
  );
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (step !== "done") return;
    const iv = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) { clearInterval(iv); setTimeout(onClose, 0); return 0; }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [step, onClose]);

  // ── Already voted: show the candidate they picked + +1 animation ──
  if (alreadyVoted) {
    const votedCandId = myVotes[0]?.candidateId;
    const votedCand   = cands.find(c => c.id === votedCandId);
    const ci          = votedCand ? cands.findIndex(c => c.id === votedCand.id) : 0;
    const clr         = candidateColor(ci >= 0 ? ci : 0);
    const photo       = votedCand ? profilePhotos[votedCand.userId] : undefined;
    const postLabel   = POSTS.find(p => p.id === postId)?.label ?? "";
    return (
      <Sheet onClose={onClose}>
        <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flex: 1 }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: `${clr}18`, border: `2px solid ${clr}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", flexShrink: 0,
          }}>
            {photo ? (
              <img src={photo} alt={votedCand?.userName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8.5" r="3.5" fill={clr} opacity=".5"/>
                <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={clr} opacity=".4"/>
              </svg>
            )}
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{votedCand?.userName ?? "—"}</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{postLabel}</div>
          </div>
          <div style={{
            fontFamily: "var(--f-mono)", fontSize: 36, fontWeight: 700,
            color: clr, letterSpacing: "-1px",
            animation: "plusOne .5s cubic-bezier(.2,.8,.3,1) both",
          }}>+1</div>
        </div>
        <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "14px", borderRadius: 14,
            border: `1.5px solid ${C.border2}`, background: C.card,
            color: C.text, fontFamily: "var(--f-sans)", fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>Fermer</button>
        </div>
      </Sheet>
    );
  }

  const selectedCand = cands.find(c => c.id === selected);
  const selectedColor = selectedCand ? candidateColor(cands.indexOf(selectedCand)) : C.gold;

  const handleConfirm = async () => {
    if (!selected) return;
    setLoading(true);
    const { error: err } = await castVote(selected, postId, user);
    setLoading(false);
    if (err) {
      setError(
        err === "already_voted" ? "Vous avez déjà voté pour ce poste." :
        err === "cep_cannot_vote" ? "Les membres du CEP ne votent pas." :
        "Erreur lors du vote. Réessayez."
      );
      return;
    }
    setStep("done");
  };

  return (
    <Sheet onClose={step !== "done" ? onClose : undefined}>
      {step === "pick" && (
        <>
          <div style={{ padding: "8px 20px 0", overflowY: "auto", flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 17, color: C.text, marginBottom: 4 }}>
              Choisissez votre candidat·e
            </div>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 16 }}>
              Sélectionnez un candidat pour continuer
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {cands.map((cand, i) => {
                const color = candidateColor(i);
                const isSelected = selected === cand.id;
                const photo = profilePhotos[cand.userId];
                return (
                  <div
                    key={cand.id}
                    onClick={() => setSelected(cand.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "14px 16px", borderRadius: 14,
                      border: `1.5px solid ${isSelected ? color : C.border}`,
                      background: isSelected ? `${color}11` : C.card,
                      cursor: "pointer", transition: "border-color .15s, background .15s",
                    }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      border: `2px solid ${isSelected ? color : C.border2}`,
                      background: isSelected ? color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all .15s",
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    {photo ? (
                      <img src={photo} alt={cand.userName} style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 46, height: 46, borderRadius: "50%",
                        background: `${color}18`, border: `2px solid ${color}44`,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="8.5" r="3.5" fill={color} opacity=".5"/>
                          <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={color} opacity=".4"/>
                        </svg>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>{cand.userName}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "#FDF1EF", color: "#C8250E", fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
            <button
              onClick={() => selected && setStep("confirm")}
              disabled={!selected}
              style={{
                width: "100%", padding: "15px", borderRadius: 14, border: "none",
                background: selected ? C.text : C.border,
                color: selected ? C.bg : C.sub,
                fontFamily: "var(--f-sans)", fontSize: 15, fontWeight: 600,
                cursor: selected ? "pointer" : "not-allowed", transition: "background .2s, color .2s",
              }}
            >
              Continuer
            </button>
          </div>
        </>
      )}

      {step === "confirm" && (
        <>
          <div style={{ padding: "8px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, overflowY: "auto", flex: 1 }}>
            <div style={{ width: "100%" }}>
              <button onClick={() => setStep("pick")} style={{ background: "none", border: "none", color: C.sub, fontFamily: "var(--f-sans)", fontSize: 13, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                ← Retour
              </button>
            </div>
            <div style={{ fontWeight: 600, fontSize: 17, color: C.text, textAlign: "center" }}>
              Vous voulez voter pour
            </div>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: `${selectedColor}18`, border: `2px solid ${selectedColor}44`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              {selectedCand && profilePhotos[selectedCand.userId] ? (
                <img src={profilePhotos[selectedCand.userId]} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8.5" r="3.5" fill={selectedColor} opacity=".5"/>
                  <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={selectedColor} opacity=".4"/>
                </svg>
              )}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selectedCand?.userName}</div>
            </div>
            {error && (
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "#FDF1EF", color: "#C8250E", fontSize: 13, width: "100%" }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
            <button
              onClick={handleConfirm}
              disabled={loading}
              style={{
                width: "100%", padding: "15px", borderRadius: 14, border: "none",
                background: loading ? C.border : selectedColor,
                color: loading ? C.sub : "#fff",
                fontFamily: "var(--f-sans)", fontSize: 15, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Vote en cours…" : "Votez"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflowY: "auto", flex: 1 }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: `${selectedColor}18`, border: `2px solid ${selectedColor}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", flexShrink: 0,
            }}>
              {selectedCand && profilePhotos[selectedCand.userId] ? (
                <img src={profilePhotos[selectedCand.userId]} alt={selectedCand.userName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8.5" r="3.5" fill={selectedColor} opacity=".5"/>
                  <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={selectedColor} opacity=".4"/>
                </svg>
              )}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selectedCand?.userName}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{POSTS.find(p => p.id === postId)?.label ?? ""}</div>
            </div>
            <div style={{
              fontFamily: "var(--f-mono)", fontSize: 36, fontWeight: 700,
              color: selectedColor, animation: "plusOne .5s cubic-bezier(.2,.8,.3,1) both", letterSpacing: "-1px",
            }}>
              +1
            </div>
          </div>
          <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{
                width: "100%", padding: "15px", borderRadius: 14,
                border: `1.5px solid ${C.border2}`, background: C.card, color: C.text,
                fontFamily: "var(--f-sans)", fontSize: 15, fontWeight: 600, cursor: "pointer",
              }}
            >
              Terminé ({countdown}s)
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ─── CEP: RESET ELECTION SHEET ───────────────────────────────

export function ResetElectionSheet({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { resetElection } = useElection();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    setLoading(true);
    await resetElection();
    setLoading(false);
    setSuccess(true);
  };

  if (success) {
    return (
      <SuccessScreen
        title="Élection réinitialisée"
        sub="Toutes les données ont été effacées. Vous pouvez lancer un nouveau cycle."
        onDismiss={onClose}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: "8px 20px 0", flex: 1 }}>
        <SheetTitle>Réinitialiser l'élection</SheetTitle>
        <SheetSub>
          Cette action efface tous les votes, candidatures et résultats. Elle est irréversible.
        </SheetSub>

        {/* Warning card */}
        <div style={{
          margin: "0 0 20px",
          padding: "14px 16px",
          borderRadius: 14,
          border: `1.5px solid #C8250E44`,
          background: "#FDF1EF",
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#C8250E", marginBottom: 4 }}>
            ⚠️ Action irréversible
          </div>
          <div style={{ fontSize: 12, color: "#C8250E", opacity: 0.8, lineHeight: 1.5 }}>
            Tous les votes et candidatures seront définitivement supprimés. Les badges et rôles seront réinitialisés.
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
        <ConfirmBtn
          label={loading ? "Réinitialisation…" : "Confirmer la réinitialisation"}
          color="#C8250E"
          onClick={handleReset}
          disabled={loading}
        />
      </div>
    </Sheet>
  );
}