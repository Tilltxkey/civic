"use client";

/**
 * ElectionSheets.tsx
 * ─────────────────────────────────────────────────────────────
 * All bottom-sheet modals for the election flow.
 *
 * CEP sheets:
 *   <InscriptionSheet>  — lancer les inscriptions
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

export function InscriptionSheet({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { launchInscription } = useElection();
  const [allPosts,     setAllPosts]     = useState(true);
  const [selectedPost, setSelectedPost] = useState<PostId>("president");
  const [success,      setSuccess]      = useState(false);

  const handleConfirm = async () => {
    const posts: PostId[] = allPosts
      ? POSTS.map(p => p.id)
      : [selectedPost];
    await launchInscription(posts);
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
          label="Lancer la phase d'inscription"
          color={C.gold}
          onClick={handleConfirm}
        />
      </div>
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
  const [presidentSecs,   setPresidentSecs]   = useState(3600);  // 1h default
  const [othersSecs,      setOthersSecs]      = useState(3600);

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
  const { election, submitCandidacy, candidatesForPost } = useElection();
  const [selectedPost, setSelectedPost] = useState<PostId>("president");
  const [step,         setStep]         = useState<"pick" | "confirm" | "success">("pick");
  const [errMsg,       setErrMsg]       = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);

  // Show all posts when openPosts is unset OR empty (freshly created election defaults to all)
  const openPosts = (election?.openPosts && election.openPosts.length > 0)
    ? election.openPosts
    : POSTS.map(p => p.id);
  const availablePosts = POSTS.filter(p => openPosts.includes(p.id)).slice().reverse();
  const postLabel = POSTS.find(p => p.id === selectedPost)?.label ?? "";

  // Check if user is already a candidate for any post
  const alreadyCandidate = POSTS.some(p =>
    candidatesForPost(p.id).some(c => c.userId === user.id)
  );

  const handleConfirm = async () => {
    setLoading(true);
    setErrMsg(null);
    const { error } = await submitCandidacy(selectedPost, user);
    setLoading(false);
    if (error === "already_candidate") {
      setErrMsg("Vous êtes déjà candidat·e pour ce poste.");
      return;
    }
    if (error) {
      setErrMsg("Une erreur est survenue. Veuillez réessayer.");
      return;
    }
    onBadgeGranted(); // update local user state so badge shows immediately
    setStep("success");
  };

  if (alreadyCandidate && step === "pick") {
    return (
      <Sheet onClose={onClose}>
        <div style={{ padding: "20px 24px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏅</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
            Vous êtes déjà candidat·e
          </div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, marginBottom: 24 }}>
            Votre candidature a déjà été soumise. Bonne campagne !
          </div>
          <button onClick={onClose} style={{
            width: "100%", padding: "14px", borderRadius: 14,
            border: `1.5px solid ${C.border2}`, background: C.card,
            color: C.text, fontFamily: "var(--f-sans)", fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>
            Fermer
          </button>
        </div>
      </Sheet>
    );
  }

  if (step === "success") {
    return (
      <Sheet>
        <div style={{ padding: "20px 24px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
          {/* Gold badge icon */}
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: C.goldBg, border: `2px solid ${C.gold}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "checkPop .4s cubic-bezier(.2,.8,.3,1) both",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="5" fill={C.gold} opacity=".25"/>
              <path d="M12 3l1.5 4.5h4.5l-3.5 2.5 1.5 4.5L12 12l-4 2.5 1.5-4.5L6 7.5h4.5z" fill={C.gold}/>
            </svg>
          </div>

          <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>
            Candidature réussie !
          </div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, maxWidth: 280 }}>
            Un badge en or vous a été attribué pour la durée de votre campagne.
            Présentez-vous à la communauté de votre faculté !
          </div>
          <div style={{
            padding: "10px 16px",
            background: C.goldBg, border: `1px solid ${C.gold}44`,
            borderRadius: 10, fontSize: 13, color: C.gold, fontWeight: 600,
            width: "100%",
          }}>
            Poste : {postLabel}
          </div>
        </div>

        <div style={{ padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => {
              const template =
                `🗳️ Je suis candidat·e au poste de ${postLabel} !\n\n` +
                `Bonjour à tous, je me présente : ${user.prenom} ${user.nom}, ` +
                `étudiant·e en ${user.field} — ${user.faculty}.\n\n` +
                `Voici pourquoi je souhaite occuper ce poste et ce que j'apporterai à notre promotion :\n\n` +
                `[Rédigez votre message de campagne ici]\n\n` +
                `Comptez sur moi ! 🙌`;
              onClose();
              onGoToComm(template);
            }}
            style={{
              width: "100%", padding: "14px", borderRadius: 14,
              border: "none", background: C.gold,
              color: "#fff", fontFamily: "var(--f-sans)",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Commencer maintenant →
          </button>
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "14px", borderRadius: 14,
              border: `1.5px solid ${C.border2}`, background: C.card,
              color: C.text, fontFamily: "var(--f-sans)",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Plus tard
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={step === "pick" ? onClose : undefined}>
      {step === "pick" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <SheetTitle>Vous voulez être candidat·e</SheetTitle>
            <SheetSub>Choisissez le poste pour lequel vous souhaitez vous présenter.</SheetSub>

            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {availablePosts.map(p => {
                const active = selectedPost === p.id;
                const candCount = candidatesForPost(p.id).length;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPost(p.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "13px 16px", borderRadius: 14,
                      border: `1.5px solid ${active ? C.gold : C.border}`,
                      background: active ? C.goldBg : C.card,
                      cursor: "pointer",
                      transition: "border-color .15s, background .15s",
                    }}
                  >
                    {/* Radio circle */}
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      border: `2px solid ${active ? C.gold : C.border2}`,
                      background: active ? C.gold : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all .15s",
                    }}>
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: active ? C.gold : C.text }}>
                        {p.label}
                      </div>
                      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                        {candCount} candidat{candCount !== 1 ? "s" : ""} inscrit{candCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {errMsg && (
              <div style={{ margin: "12px 20px 0", padding: "10px 14px", borderRadius: 10, background: "#FDF1EF", color: "#C8250E", fontSize: 13 }}>
                {errMsg}
              </div>
            )}
          </div>

          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label="Continuer"
              color={C.gold}
              onClick={() => setStep("confirm")}
            />
          </div>
        </>
      )}

      {step === "confirm" && (
        <>
          <div style={{ flex: 1, padding: "8px 20px 0", overflowY: "auto" }}>
            <BackBtn onClick={() => setStep("pick")} />
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 16, color: C.text, marginBottom: 6 }}>
                Vous voulez être candidat·e pour le poste de
              </div>
              <div style={{
                fontWeight: 700, fontSize: 18, color: C.gold,
                padding: "12px 20px",
                background: C.goldBg, borderRadius: 12,
                margin: "0 auto", maxWidth: 300,
              }}>
                {postLabel}
              </div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 12, lineHeight: 1.6 }}>
                Votre candidature sera visible par tous les membres de votre promotion.
                Un badge en or vous sera attribué dès confirmation.
              </div>
            </div>
          </div>

          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label={loading ? "En cours…" : "Confirmer ma candidature"}
              color={C.gold}
              disabled={loading}
              onClick={handleConfirm}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}

// ─── VOTER: REAL VOTE SHEET ──────────────────────────────────
// Extends the existing VoteSheet logic but uses real DB candidates
// and calls castVote() instead of local state.

interface RealVoteSheetProps {
  user:               UserProfile;
  postId:             PostId;
  onClose:            () => void;
  initialCandidateId?: string; // when set, opens directly on the confirm step
}

export function RealVoteSheet({ user, postId, onClose, initialCandidateId }: RealVoteSheetProps) {
  const C = useC();
  const { candidatesForPost, castVote, myVotes, profilePhotos } = useElection();
  const candidates = candidatesForPost(postId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const postLabel  = POSTS.find(p => p.id === postId)?.label ?? "";
  const [selected, setSelected] = useState<string | null>(initialCandidateId ?? null);
  const [step,     setStep]     = useState<"pick" | "confirm" | "done">(
    initialCandidateId ? "confirm" : "pick"
  );
  const [loading,  setLoading]  = useState(false);
  const [errMsg,   setErrMsg]   = useState<string | null>(null);
  const [countdown,setCountdown]= useState(5);

  const alreadyVoted = myVotes.some(v => v.postId === postId);
  const selectedCand = candidates.find(c => c.id === selected);

  // Auto-dismiss "done" after 5s
  useEffect(() => {
    if (step !== "done") return;
    const iv = setInterval(() => setCountdown(p => {
      if (p <= 1) { clearInterval(iv); onClose(); return 0; }
      return p - 1;
    }), 1000);
    return () => clearInterval(iv);
  }, [step, onClose]);

  if (alreadyVoted) {
    const votedCandId = myVotes.find(v => v.postId === postId)?.candidateId;
    const votedCand   = candidates.find(c => c.id === votedCandId);
    const ci          = votedCand ? candidates.findIndex(c => c.id === votedCand.id) : 0;
    const clr         = candidateColor(ci >= 0 ? ci : 0);
    const photo       = votedCand ? profilePhotos[votedCand.userId] : undefined;
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

  const handleVote = async () => {
    if (!selected) return;
    setLoading(true);
    const { error } = await castVote(selected, postId, user);
    setLoading(false);
    if (error) { setErrMsg("Erreur lors du vote. Veuillez réessayer."); return; }
    setStep("done");
  };

  return (
    <Sheet onClose={step === "pick" ? onClose : undefined}>
      {/* Step 1: Pick */}
      {step === "pick" && (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <SheetTitle>Voter — {postLabel}</SheetTitle>
            <SheetSub>Sélectionnez votre candidat·e.</SheetSub>

            {candidates.length === 0 ? (
              <div style={{ padding: "24px 20px", textAlign: "center", color: C.sub, fontSize: 14 }}>
                Aucun candidat inscrit pour ce poste.
              </div>
            ) : (
              <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                {candidates.map((c, ci) => {
                  const active    = selected === c.id;
                  const colorFor  = candidateColor(ci);
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelected(c.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "14px 16px", borderRadius: 14,
                        border: `1.5px solid ${active ? colorFor : C.border}`,
                        background: active ? `${colorFor}11` : C.card,
                        cursor: "pointer",
                        transition: "border-color .15s, background .15s",
                      }}
                    >
                      {/* Radio */}
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%",
                        border: `2px solid ${active ? colorFor : C.border2}`,
                        background: active ? colorFor : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, transition: "all .15s",
                      }}>
                        {active && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      {/* Avatar — profile photo if available, fallback to initials ring */}
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: `${colorFor}18`, border: `2px solid ${colorFor}44`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, overflow: "hidden",
                      }}>
                        {profilePhotos[c.userId] ? (
                          <img
                            src={profilePhotos[c.userId]}
                            alt={c.userName}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="8.5" r="3.5" fill={colorFor} opacity=".5"/>
                            <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={colorFor} opacity=".4"/>
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{c.userName}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {errMsg && (
              <div style={{ margin: "12px 20px 0", padding: "10px 14px", borderRadius: 10, background: "#FDF1EF", color: "#C8250E", fontSize: 13 }}>
                {errMsg}
              </div>
            )}
          </div>

          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label="Continuer"
              disabled={!selected || candidates.length === 0}
              onClick={() => setStep("confirm")}
            />
          </div>
        </>
      )}

      {/* Step 2: Confirm */}
      {step === "confirm" && selectedCand && (
        <>
          <div style={{ flex: 1, padding: "8px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, overflowY: "auto" }}>
            <BackBtn onClick={() => setStep("pick")} />
            <div style={{ fontWeight: 600, fontSize: 17, color: C.text, textAlign: "center" }}>
              Vous voulez voter pour
            </div>
            {(() => {
              const ci = candidates.findIndex(c => c.id === selectedCand.id);
              const clr = candidateColor(ci >= 0 ? ci : 0);
              const photo = profilePhotos[selectedCand.userId];
              return (
                <div style={{
                  width: 80, height: 80, borderRadius: "50%",
                  background: `${clr}18`, border: `2px solid ${clr}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}>
                  {photo ? (
                    <img
                      src={photo}
                      alt={selectedCand.userName}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8.5" r="3.5" fill={clr} opacity=".5"/>
                      <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={clr} opacity=".4"/>
                    </svg>
                  )}
                </div>
              );
            })()}
            <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selectedCand.userName}</div>
            <div style={{ fontSize: 12, color: C.sub }}>{postLabel}</div>
          </div>

          <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
            <ConfirmBtn
              label={loading ? "En cours…" : "Voter"}
              disabled={loading}
              color={candidateColor(candidates.findIndex(c => c.id === selectedCand.id))}
              onClick={handleVote}
            />
          </div>
        </>
      )}

      {/* Step 3: Done */}
      {step === "done" && selectedCand && (() => {
        const ci    = candidates.findIndex(c => c.id === selectedCand.id);
        const clr   = candidateColor(ci >= 0 ? ci : 0);
        const photo = profilePhotos[selectedCand.userId];
        return (
          <>
            <div style={{ flex: 1, padding: "16px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflowY: "auto" }}>
              {/* Candidate avatar — photo or SVG fallback */}
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: `${clr}18`, border: `2px solid ${clr}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", flexShrink: 0,
              }}>
                {photo ? (
                  <img src={photo} alt={selectedCand.userName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8.5" r="3.5" fill={clr} opacity=".5"/>
                    <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={clr} opacity=".4"/>
                  </svg>
                )}
              </div>
              {/* Name + post */}
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selectedCand.userName}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{postLabel}</div>
              </div>
              {/* Animated +1 */}
              <div style={{
                fontFamily: "var(--f-mono)",
                fontSize: 36, fontWeight: 700,
                color: clr,
                animation: "plusOne .5s cubic-bezier(.2,.8,.3,1) both",
                letterSpacing: "-1px",
              }}>
                +1
              </div>
            </div>
            <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
              <button onClick={onClose} style={{
                width: "100%", padding: "14px", borderRadius: 14,
                border: `1.5px solid ${C.border2}`, background: C.card,
                color: C.text, fontFamily: "var(--f-sans)",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                Terminé ({countdown}s)
              </button>
            </div>
          </>
        );
      })()}
    </Sheet>
  );
}


// ─── CEP: RESET / NEW ELECTION SHEET ────────────────────────
// Shown when status is "past". Lets CEP start a fresh election cycle.

export function ResetElectionSheet({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { resetElection } = useElection();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await resetElection();
    setLoading(false);
    setSuccess(true);
  };

  if (success) {
    return (
      <SuccessScreen
        title="Nouvelle élection prête !"
        sub="Les résultats précédents ont été archivés. Vous pouvez lancer les inscriptions pour le prochain scrutin."
        onDismiss={onClose}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div style={{ overflowY: "auto", flex: 1 }}>
        <SheetTitle>Démarrer une nouvelle élection</SheetTitle>
        <SheetSub>
          Les résultats actuels seront conservés dans l'historique.
          Les candidatures et les votes seront réinitialisés pour permettre un nouveau cycle électoral.
        </SheetSub>

        {/* Warning card */}
        <div style={{ margin: "0 20px 16px" }}>
          <div style={{
            padding: "14px 16px", borderRadius: 12,
            background: "#FDF6E3", border: "1px solid #C47F0044",
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#C47F00", marginBottom: 6 }}>
              ⚠️ Cette action va :
            </div>
            <div style={{ fontSize: 12, color: "#6B6A64", lineHeight: 1.7 }}>
              • Supprimer tous les votes du scrutin précédent<br/>
              • Révoquer les badges des candidats<br/>
              • Remettre le statut à « Élections à venir »
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px 32px", flexShrink: 0 }}>
        <ConfirmBtn
          label={loading ? "Réinitialisation…" : "Lancer un nouveau cycle"}
          color="#C47F00"
          disabled={loading}
          onClick={handleConfirm}
        />
      </div>
    </Sheet>
  );
}