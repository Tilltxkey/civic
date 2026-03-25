"use client";

/**
 * ElectionManagerButton.tsx
 * ─────────────────────────────────────────────────────────────
 * Rendered in Header.tsx only when isCepRD(user) is true.
 * 
 * STATUS 'future'      → button "Lancer les candidatures"
 *                        → ActionBottomSheet: scope (all / single post)
 *                        → confirm → createElection + status → 'inscription'
 *                        → toast 5s then auto-close
 *
 * STATUS 'inscription' → button "Lancer les élections"  (Task 07)
 *
 * STATUS 'ongoing'     → nothing (elections live — Race.tsx shows results)
 * STATUS 'past'        → nothing
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from "react";
import { useC } from "./tokens";
import { ActionBottomSheet } from "./ActionBottomSheet";
import {
  POSTS_ORDERED,
  getCategoryKey,
  getElectionPosts,
} from "./electionUtils";
import {
  createElection,
  updateElectionStatus,
} from "./db";
import type { DBElection } from "./db";
import type { UserProfile } from "./AuthFlow";

// ── Shared UI helpers ─────────────────────────────────────────

function SelectOption({
  label, selected, onSelect,
}: { label: string; selected: boolean; onSelect: () => void }) {
  const C = useC();
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "13px 14px",
        borderRadius: 12,
        border: `1.5px solid ${selected ? C.gold : C.border}`,
        background: selected ? C.goldBg : C.card,
        cursor: "pointer",
        fontFamily: "var(--f-sans)",
        WebkitTapHighlightColor: "transparent",
        transition: "border-color .15s, background .15s",
        marginBottom: 8,
      }}
    >
      {/* Radio circle */}
      <div style={{
        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
        border: `2px solid ${selected ? C.gold : C.border2}`,
        background: selected ? C.gold : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
      }}>
        {selected && (
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />
        )}
      </div>
      <span style={{
        fontSize: 14, fontWeight: selected ? 600 : 400,
        color: selected ? C.gold : C.text,
        textAlign: "left",
        transition: "color .15s",
      }}>
        {label}
      </span>
    </button>
  );
}

// Styled select dropdown
function PostSelect({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const C = useC();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", marginTop: 4 }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", padding: "13px 36px 13px 14px",
          borderRadius: 12,
          border: `1.5px solid ${focused ? C.gold : C.border}`,
          background: C.card, color: C.text,
          fontSize: 14, fontFamily: "var(--f-sans)",
          outline: "none", appearance: "none",
          WebkitAppearance: "none", cursor: "pointer",
          transition: "border-color .15s",
        }}
      >
        <option value="" disabled>Choisir un poste…</option>
        {POSTS_ORDERED.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
        <path d="M6 9l6 6 6-6" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ── Toast component ───────────────────────────────────────────

function SuccessToast({ message, onDone }: { message: string; onDone: () => void }) {
  const C = useC();
  useEffect(() => {
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%",
      transform: "translateX(-50%)",
      background: "#1a7a2e", color: "#fff",
      padding: "12px 24px", borderRadius: 999,
      fontSize: 14, fontWeight: 600,
      boxShadow: "0 4px 20px rgba(0,0,0,.2)",
      zIndex: 400, pointerEvents: "none",
      animation: "fadeup .2s ease both",
      whiteSpace: "nowrap",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {message}
    </div>
  );
}

// ── ElectionManagerButton ─────────────────────────────────────

interface Props {
  user:       UserProfile;
  election:   DBElection | null;
  onElectionChange: (e: DBElection) => void;
}

export function ElectionManagerButton({ user, election, onElectionChange }: Props) {
  const C = useC();
  const status = election?.status ?? "future";

  // Sheet state
  const [sheetOpen,    setSheetOpen]    = useState(false);
  const [postsScope,   setPostsScope]   = useState<"all" | "single">("all");
  const [selectedPost, setSelectedPost] = useState("");
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState<string | null>(null);

  // Only show for future or inscription
  if (status !== "future" && status !== "inscription") return null;

  // ── Lancer les candidatures (future → inscription) ────────
  const handleLancerCandidatures = async () => {
    if (postsScope === "single" && !selectedPost) return;
    setLoading(true);
    try {
      const categoryKey = getCategoryKey(user);
      // If election already exists (re-opening), just update status
      // Otherwise create fresh
      let electionId = election?.id;
      if (!electionId) {
        const result = await createElection({
          id:                 `elec_${Date.now()}`,
          category_key:       categoryKey,
          faculty:            user.faculty,
          field:              user.field,
          year:               user.year,
          vacation:           user.vacation,
          status:             "inscription",
          posts_scope:        postsScope,
          selected_post:      postsScope === "single" ? selectedPost : null,
          vote_order:         "together",
          current_post_index: 0,
          durations:          {},
          inscription_start:  new Date().toISOString(),
          election_start:     null,
          election_end:       null,
          created_by:         user.id,
        });
        if (result.error) throw new Error(result.error);
        electionId = result.id;
      } else {
        await updateElectionStatus(electionId, "inscription", {
          posts_scope:       postsScope,
          selected_post:     postsScope === "single" ? selectedPost : null,
          inscription_start: new Date().toISOString(),
        });
      }
      // Notify parent
      onElectionChange({
        ...(election ?? {
          id:                 electionId!,
          category_key:       categoryKey,
          faculty:            user.faculty,
          field:              user.field,
          year:               user.year,
          vacation:           user.vacation,
          vote_order:         "together",
          current_post_index: 0,
          durations:          {},
          inscription_start:  new Date().toISOString(),
          election_start:     null,
          election_end:       null,
          created_by:         user.id,
        }),
        status:        "inscription",
        posts_scope:   postsScope,
        selected_post: postsScope === "single" ? selectedPost : null,
      } as DBElection);
      setSheetOpen(false);
      setToast("Phase de candidatures lancée ✓");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const canConfirmCandidatures =
    postsScope === "all" || (postsScope === "single" && selectedPost !== "");

  // ── Render ────────────────────────────────────────────────
  return (
    <>
      {/* The button itself */}
      <button
        onClick={() => setSheetOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: status === "future" ? C.gold : C.goldBg,
          border: `1.5px solid ${C.gold}`,
          borderRadius: 999,
          padding: "6px 14px",
          cursor: "pointer",
          fontFamily: "var(--f-sans)",
          WebkitTapHighlightColor: "transparent",
          transition: "opacity .15s",
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          {status === "future" ? (
            /* Play/launch icon */
            <path d="M5 3l14 9-14 9V3z" fill={status === "future" ? "#fff" : C.gold}/>
          ) : (
            /* Ballot/vote icon */
            <>
              <rect x="4" y="3" width="16" height="18" rx="2.5" stroke={C.gold} strokeWidth="1.6"/>
              <path d="M9 7h6M9 11h4" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round"/>
            </>
          )}
        </svg>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: status === "future" ? "#fff" : C.gold,
          whiteSpace: "nowrap",
        }}>
          {status === "future" ? "Lancer les candidatures" : "Lancer les élections"}
        </span>
      </button>

      {/* Sheet — Lancer les candidatures */}
      {status === "future" && (
        <ActionBottomSheet
          isOpen={sheetOpen}
          onClose={() => { setSheetOpen(false); }}
          title="Lancer la phase de candidatures"
          subtitle="Les étudiants de votre catégorie pourront se présenter aux élections."
          confirmLabel={loading ? "Lancement…" : "Lancer les candidatures →"}
          onConfirm={handleLancerCandidatures}
          confirmDisabled={!canConfirmCandidatures || loading}
          secondaryLabel="Annuler"
          onSecondary={() => setSheetOpen(false)}
        >
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginBottom: 12 }}>
              Postes concernés
            </div>
            <SelectOption
              label="Tous les postes"
              selected={postsScope === "all"}
              onSelect={() => { setPostsScope("all"); setSelectedPost(""); }}
            />
            <SelectOption
              label="Un seul poste"
              selected={postsScope === "single"}
              onSelect={() => setPostsScope("single")}
            />
            {postsScope === "single" && (
              <div style={{ animation: "fadeup .18s ease both" }}>
                <PostSelect value={selectedPost} onChange={setSelectedPost} />
              </div>
            )}
          </div>

          {/* Info card */}
          <div style={{
            background: C.goldBg, border: `1px solid ${C.gold}33`,
            borderRadius: 12, padding: "12px 14px", marginTop: 4,
          }}>
            <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, marginBottom: 4 }}>
              ℹ️ À propos de cette phase
            </div>
            <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6 }}>
              Une fois lancée, les étudiants de votre catégorie verront apparaître le bouton « Être candidat ». Vous pourrez lancer les élections quand vous le souhaitez.
            </div>
          </div>
        </ActionBottomSheet>
      )}

      {/* Toast */}
      {toast && (
        <SuccessToast message={toast} onDone={() => setToast(null)} />
      )}
    </>
  );
}
