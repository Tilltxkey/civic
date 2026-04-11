
/**
 * Treemap.tsx
 * ─────────────────────────────────────────────────────────────
 * Bloomberg/market-style squarified treemap + full voting flow.
 *
 * VOTING FLOW (4 states):
 *  "idle"     → treemap blurred, "VOTER" button floating over
 *  "pick"     → bottom sheet: choose a candidate
 *  "confirm"  → bottom sheet: confirm your choice
 *  "done"     → bottom sheet: success + auto-dismiss after 5s
 *
 * HOW TO CUSTOMIZE:
 *  - Candidate names/colors → data.ts → CANDIDATE_A / B
 *  - Sheet copy             → strings inside VoteSheet below
 *  - Auto-dismiss delay     → DONE_DELAY constant below
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useLang } from "./LangContext";
import { useTheme } from "./ThemeContext";
import { AppMenu } from "./AppMenu";
import PdfViewer from "./PdfViewer";
import { useC } from "./tokens";
import { Dept, deptStatus, CANDIDATE_A, CANDIDATE_B, ALL_RACES, AnyRace } from "./data";
import { useElection, POSTS, isCEPRole, type PostId } from "./ElectionContext";
import { candidateColor, ConvergingBar } from "./Race";
import type { UserProfile } from "./AuthFlow";
import { InscriptionSheet, LaunchElectionSheet, CandidacySheet, RealVoteSheet, ResetElectionSheet } from "./ElectionSheets";

// How long (ms) the "success" sheet stays before auto-dismiss
const DONE_DELAY = 5000;

// ─── SQUARIFY ALGORITHM ──────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number; index: number; }

function squarify(items: { value: number; index: number }[], x: number, y: number, w: number, h: number): Rect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ x, y, w, h, index: items[0].index }];
  const total = items.reduce((s, i) => s + i.value, 0);
  let row: { value: number; index: number }[] = [];
  let best = Infinity;
  let i = 0;
  for (; i < items.length; i++) {
    const candidate = [...row, items[i]];
    const worst = worstRatio(candidate, Math.min(w, h), total, w * h);
    if (worst > best && row.length > 0) break;
    row = candidate;
    best = worst;
  }
  const rowTotal = row.reduce((s, r) => s + r.value, 0);
  const rects: Rect[] = layoutRow(row, x, y, w, h, rowTotal, total);
  const remaining = items.slice(i);
  if (remaining.length === 0) return rects;
  const rowRatio = rowTotal / total;
  let nx: number, ny: number, nw: number, nh: number;
  if (w >= h) { const rw = w * rowRatio; nx = x + rw; ny = y; nw = w - rw; nh = h; }
  else        { const rh = h * rowRatio; nx = x; ny = y + rh; nw = w; nh = h - rh; }
  return [...rects, ...squarify(remaining, nx, ny, nw, nh)];
}

function worstRatio(row: { value: number }[], side: number, totalArea: number, containerArea: number): number {
  const rowSum = row.reduce((s, r) => s + r.value, 0);
  const stripW = (rowSum / totalArea) * (containerArea / side);
  let worst = 0;
  for (const item of row) {
    const itemH = (item.value / rowSum) * side;
    const ratio = Math.max(stripW / itemH, itemH / stripW);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function layoutRow(row: { value: number; index: number }[], x: number, y: number, w: number, h: number, rowTotal: number, total: number): Rect[] {
  const rects: Rect[] = [];
  const rowRatio = rowTotal / total;
  if (w >= h) {
    const rw = w * rowRatio; let cy = y;
    for (const item of row) { const rh = h * (item.value / rowTotal); rects.push({ x, y: cy, w: rw, h: rh, index: item.index }); cy += rh; }
  } else {
    const rh = h * rowRatio; let cx = x;
    for (const item of row) { const rw = w * (item.value / rowTotal); rects.push({ x: cx, y, w: rw, h: rh, index: item.index }); cx += rw; }
  }
  return rects;
}

// ─── CANDIDATE AVATAR (shared across sheet steps) ────────────

function CandidateAvatar({ color, size = 64 }: { color: string; size?: number }) {
  const C = useC();
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      background: `${color}18`,
      border: `2px solid ${color}44`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8.5" r="3.5" fill={color} opacity=".5" />
        <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={color} opacity=".4" />
      </svg>
    </div>
  );
}

// ─── VOTE BOTTOM SHEET ───────────────────────────────────────

type VoteStep = "pick" | "confirm" | "done";

interface VoteSheetProps {
  step:          VoteStep;
  selected:      string | null;
  selectedColor: string;
  raceId:        string;
  onSelect:      (name: string, color: string) => void;
  onContinue:    () => void;
  onConfirm:     () => void;
  onDismiss:     () => void;
  onCancel:      () => void;
  onBack:        () => void;
  countdown:     number;
}

function VoteSheet({ step, selected, selectedColor, raceId, onSelect, onContinue, onConfirm, onDismiss, onCancel, onBack, countdown }: VoteSheetProps) {
  const C = useC();
  const { t } = useLang();
  const race = ALL_RACES.find(r => r.id === raceId) ?? ALL_RACES[0];
  const candidates = race.candidates.map(c => ({
    name:  c.name,
    party: "",
    color: c.color === "red" ? C.red : C.blue,
  }));

  // Lock body scroll while sheet is open so page can't scroll behind it
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <>
      {/* Backdrop — stops above the ticker */}
      <div
        onClick={step !== "done" ? onCancel : undefined}
        style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          zIndex: 100,
          cursor: step !== "done" ? "pointer" : "default",
        }}
      />

      {/* Sheet — same positioning as the ticker: fixed, bottom 0, just higher z-index */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0, right: 0,
        background: C.surface,
        borderRadius: "22px 22px 0 0",
        zIndex: 101,
        animation: "sheetUp .3s cubic-bezier(.2,.8,.3,1) both",
        boxShadow: "0 -8px 40px rgba(0,0,0,.18)",
        maxHeight: `calc(100vh - ${NAV_H}px)`,
        display: "flex",
        flexDirection: "column",
      }}>

        {/* Handle — always at top, never scrolls */}
        <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 99, margin: "12px auto 8px", flexShrink: 0 }} />

        {/* ── STEP 1: Pick candidate ── */}
        {step === "pick" && (
          <>
            {/* Scrollable content area */}
            <div style={{ padding: "12px 20px 0", overflowY: "auto", flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 17, color: C.text, marginBottom: 4 }}>
                {t("vote.pickTitle")}
              </div>
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 16 }}>
                {t("vote.pickSub")}
              </div>

              {/* Candidate options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {candidates.map(c => {
                  const isSelected = selected === c.name;
                  return (
                    <div
                      key={c.name}
                      onClick={() => onSelect(c.name, c.color)}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "14px 16px",
                        borderRadius: 14,
                        border: `1.5px solid ${isSelected ? c.color : C.border}`,
                        background: isSelected ? `${c.color}11` : C.card,
                        cursor: "pointer",
                        transition: "border-color .15s, background .15s",
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 22, height: 22,
                        border: `2px solid ${isSelected ? c.color : C.border2}`,
                        background: isSelected ? c.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, transition: "all .15s",
                        borderRadius: "50%",
                      }}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>

                      {/* Avatar */}
                      <CandidateAvatar color={c.color} size={46} />

                      {/* Name + party */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{c.party}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action button — pinned at bottom, never scrolls away */}
            <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
              <button
                onClick={onContinue}
                disabled={!selected}
                style={{
                  width: "100%", padding: "15px",
                  borderRadius: 14, border: "none",
                  background: selected ? C.text : C.border,
                  color: selected ? C.bg : C.sub,
                  fontFamily: "var(--f-sans)",
                  fontSize: 15, fontWeight: 600,
                  cursor: selected ? "pointer" : "not-allowed",
                  transition: "background .2s, color .2s",
                }}
              >
                {t("vote.continue")}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: Confirm ── */}
        {step === "confirm" && (
          <>
            {/* Scrollable content */}
            <div style={{ padding: "8px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, overflowY: "auto", flex: 1 }}>
              <div style={{ width: "100%", display: "flex", alignItems: "center" }}>
                <button
                  onClick={onBack}
                  style={{ background: "none", border: "none", color: C.sub, fontFamily: "var(--f-sans)", fontSize: 13, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
                >
                  {t("vote.back")}
                </button>
              </div>
              <div style={{ fontWeight: 600, fontSize: 17, color: C.text, textAlign: "center" }}>
                {t("vote.confirmTitle")}
              </div>
              <CandidateAvatar color={selectedColor} size={72} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selected}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>
                  {candidates.find(c => c.name === selected)?.party}
                </div>
              </div>
            </div>

            {/* Pinned confirm button */}
            <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
              <button
                onClick={onConfirm}
                style={{
                  width: "100%", padding: "15px",
                  borderRadius: 14, border: "none",
                  background: selectedColor,
                  color: "#fff",
                  fontFamily: "var(--f-sans)",
                  fontSize: 15, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("vote.confirm")}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: Success ── */}
        {step === "done" && (
          <>
            {/* Scrollable content */}
            <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflowY: "auto", flex: 1 }}>
              <CandidateAvatar color={selectedColor} size={72} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>{selected}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>
                  {candidates.find(c => c.name === selected)?.party}
                </div>
              </div>
              <div style={{
                fontFamily: "var(--f-mono)",
                fontSize: 36, fontWeight: 700,
                color: selectedColor,
                animation: "plusOne .5s cubic-bezier(.2,.8,.3,1) both",
                letterSpacing: "-1px",
              }}>
                +1
              </div>
            </div>

            {/* Pinned dismiss button */}
            <div style={{ padding: "16px 20px 28px", flexShrink: 0 }}>
              <button
                onClick={onDismiss}
                style={{
                  width: "100%", padding: "15px",
                  borderRadius: 14, border: `1.5px solid ${C.border2}`,
                  background: C.card, color: C.text,
                  fontFamily: "var(--f-sans)",
                  fontSize: 15, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("vote.doneLabel")} ({countdown}s)
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── VOTER BUTTON ────────────────────────────────────────────

function VoterButton({ onPress }: { onPress: () => void }) {
  const C = useC();
  const [pressed, setPressed] = useState(false);

  const handlePress = () => {
    setPressed(true);
    setTimeout(() => setPressed(false), 300);
    onPress();
  };

  return (
    <>
      <style>{`
        @keyframes voterPulse {
          0%   { transform: scale(1);   opacity: .55; }
          70%  { transform: scale(2.6); opacity: 0;   }
          100% { transform: scale(2.6); opacity: 0;   }
        }
        @keyframes voterPulse2 {
          0%   { transform: scale(1);   opacity: .3; }
          70%  { transform: scale(2.0); opacity: 0;  }
          100% { transform: scale(2.0); opacity: 0;  }
        }
        @keyframes voterIn {
          from { opacity: 0; transform: scale(.82); }
          to   { opacity: 1; transform: scale(1);   }
        }
        @keyframes voterIconFloat {
          0%, 100% { transform: translateY(0px);  }
          50%       { transform: translateY(-3px); }
        }
        @keyframes voterPress {
          0%   { transform: scale(1);    }
          40%  { transform: scale(.93);  }
          100% { transform: scale(1);    }
        }
      `}</style>

      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 5,
        animation: "voterIn .5s cubic-bezier(.2,.8,.3,1) both",
      }}>
        {/* Outer pulse rings */}
        <div style={{
          position: "absolute",
          width: 56, height: 56,
          borderRadius: "50%",
          background: C.text,
          opacity: 0,
          animation: "voterPulse 2.2s ease-out infinite",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          width: 56, height: 56,
          borderRadius: "50%",
          background: C.text,
          opacity: 0,
          animation: "voterPulse2 2.2s ease-out .7s infinite",
          pointerEvents: "none",
        }} />

        {/* The button itself */}
        <button
          onClick={handlePress}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: `1.5px solid ${C.border}`,  // theme-aware
            background: C.surface,
            cursor: "pointer",
            fontFamily: "var(--f-sans)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: `0 0 0 1px ${C.border2}, 0 8px 32px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.14)`,  // theme-aware
            animation: pressed ? "voterPress .3s ease both" : "none",
            transition: "box-shadow .2s ease, border-color .2s ease",
            outline: "none",
            WebkitTapHighlightColor: "transparent",
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.boxShadow = `0 0 0 1px ${C.border2}, 0 12px 40px rgba(0,0,0,.28), 0 4px 12px rgba(0,0,0,.18)`;
            b.style.borderColor = "rgba(0,0,0,.12)";
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.boxShadow = `0 0 0 1px ${C.border}, 0 8px 32px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.12)`;
            b.style.borderColor = "rgba(0,0,0,.08)";
          }}
        >
          {/* Ballot icon */}
          <div style={{ animation: "voterIconFloat 3s ease-in-out infinite", lineHeight: 1 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="3" width="16" height="18" rx="2.5" fill={C.text} opacity=".9" />
              <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={C.bg} strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="17.5" cy="15.5" r="3.5" fill={C.bg} />
              <path d="M15.8 15.5l1.1 1.1 1.8-2" stroke={C.text} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Label */}
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            opacity: .85,
            lineHeight: 1,
          }}>
            Voter
          </div>
        </button>
      </div>
    </>
  );
}

// ─── ALL RACES COMPONENT ─────────────────────────────────────
// Driven entirely by real DB data from ElectionContext.
// For each post in POSTS (importance order), shows real candidates
// and real vote counts/percentages from allVotes + candidates.

function AllRaces({ selectedRaceId, onSelectRace }: { selectedRaceId: string; onSelectRace: (id: string) => void }) {
  const C = useC();
  const { t } = useLang();
  const { election, candidates, allVotes, winnerOfPost, categorySexCounts } = useElection();
  const elStatus = election?.status ?? "future";
  const isPast   = elStatus === "past";
  const totalEligible = (categorySexCounts.M + categorySexCounts.F) || 1;

  // Build per-post real data from DB — supports unlimited candidates
  const raceRows = POSTS
    .filter(p => p.id !== selectedRaceId)
    .map(post => {
      const postCands = candidates
        .filter(c => c.postId === post.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const postVotes  = allVotes.filter(v => v.postId === post.id);
      const totalVotes = postVotes.length;

      const slots = postCands.map((cand, i) => ({
        id:    cand.id,
        name:  cand.userName,
        votes: postVotes.filter(v => v.candidateId === cand.id).length,
        // pct = share of full electorate, not of votes cast
        pct:   (postVotes.filter(v => v.candidateId === cand.id).length / totalEligible) * 100,
        color: candidateColor(i),
      }));

      const castPct      = slots.reduce((s, r) => s + r.pct, 0);
      const remainderPct = Math.max(0, 100 - castPct);

      const winner    = isPast ? winnerOfPost(post.id) : null;
      const pcts      = slots.map(s => s.pct);
      const maxPct    = pcts.length > 1 ? Math.max(...pcts) : 0;
      const secondPct = pcts.length > 1 ? [...pcts].sort((a,b) => b-a)[1] : 0;
      const gap       = maxPct - secondPct;
      const isClose   = elStatus === "ongoing" && totalVotes > 0 && gap < 2;
      const isElected = isPast && !!winner;

      return { post, slots, remainderPct, totalVotes, winner, isClose, isElected };
    });

  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 6px" }}>

      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginBottom: 2 }}>
        {t("treemap.allRaces")}
      </div>

      {raceRows.map(({ post, slots, remainderPct, totalVotes, winner, isClose, isElected }, i) => {
        const hasVotes = totalVotes > 0;
        const showPlaceholder = slots.length === 0;
        const displaySlots = showPlaceholder
          ? [
              { id: "a", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(0) },
              { id: "b", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(1) },
            ]
          : slots;

        return (
          <div key={post.id} onClick={() => onSelectRace(post.id)} style={{
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            padding: "12px 0 10px",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}>

            {/* Role + status badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{post.label}</div>
              {isElected && (
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1px", border: `1px solid ${C.text}`, color: C.text, padding: "2px 6px", borderRadius: 3, flexShrink: 0, textTransform: "uppercase" }}>
                  Résultat
                </div>
              )}
              {isClose && (
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1px", background: C.gold, color: "#fff", padding: "2px 6px", borderRadius: 3, flexShrink: 0, textTransform: "uppercase" }}>
                  {t("treemap.tooClose")}
                </div>
              )}
            </div>

            {/* Candidates — one row per candidate */}
            {displaySlots.map((s, ci) => {
              const isWinner = !!(winner && s.id === winner.id);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ci < displaySlots.length - 1 ? 5 : 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0, opacity: isWinner || !winner ? 1 : 0.35 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? C.text : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>
                    {s.name}
                  </span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? s.color : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>
                    {hasVotes ? `${s.pct.toFixed(1).replace(".", ",")} %` : "0,0 %"}
                  </span>
                </div>
              );
            })}

            {/* Converging bar — fills by electorate share, gray remainder = uncast */}
            <div style={{ marginTop: 8 }}>
              <ConvergingBar slots={hasVotes
                ? displaySlots.map(s => ({ pct: s.pct, color: isClose ? C.gold : s.color }))
                : displaySlots.map(s => ({ pct: 0, color: s.color }))
              } />
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: 10, color: C.dim }}>
                {totalVotes > 0 ? `${totalVotes} / ${totalEligible} votants` : "Aucun vote"}
              </span>
              {isElected && winner && (
                <span style={{ fontSize: 10, fontWeight: 700, color: C.text, letterSpacing: ".5px", textTransform: "uppercase" }}>
                  {winner.userName} {t("treemap.elected")}
                </span>
              )}
              {isClose && (
                <span style={{ fontSize: 10, color: C.gold, fontWeight: 600 }}>
                  &lt; 2 % d&apos;écart
                </span>
              )}
            </div>

          </div>
        );
      })}

      {/* Spacer so navbar never hides the last race row */}
      <div style={{ height: 64 }} />
    </div>
  );
}

// ─── PDF VIEWER ──────────────────────────────────────────────

export function PDFViewer({ thesis, onClose }: { thesis: Thesis; onClose: () => void }) {
  const C = useC();
  const [zoom, setZoom] = useState(100);
  const STEP = 25;
  const MIN  = 50;
  const MAX  = 400;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Detect platform once — iOS uses native iframe, Android uses pdf.js viewer
  const isIOS = typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
     (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // iOS: native PDF in iframe, zoom via CSS scale on a wrapper div
  // Android: pdf.js viewer, zoom baked into URL (triggers re-render)
  // Desktop: native iframe too
  const androidUrl = `${origin}/pdf-viewer.html?file=${encodeURIComponent(origin + thesis.pdf)}&zoom=${zoom}`;

  const handleZoomIn  = () => setZoom(z => Math.min(MAX, z + STEP));
  const handleZoomOut = () => setZoom(z => Math.max(MIN, z - STEP));

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: C.bg,
      zIndex: 200,
      display: "flex", flexDirection: "column",
    }}>

      {/* ── Top bar ── */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 22, color: C.gold, lineHeight: 1,
            fontFamily: "var(--f-sans)", padding: "0 4px",
            WebkitTapHighlightColor: "transparent", flexShrink: 0,
          }}
        >
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {thesis.title}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{thesis.author}</div>
        </div>
      </div>

      {/* ── PDF content — pdf.js on all platforms for consistent sharp rendering ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <iframe
          ref={iframeRef}
          key={androidUrl}
          src={androidUrl}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          title={thesis.title}
        />
      </div>

      {/* ── Bottom zoom bar ── */}
      <div style={{
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        padding: "12px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
      }}>
        {/* − */}
        <button
          onClick={handleZoomOut}
          disabled={zoom <= MIN}
          style={{
            width: 48, height: 48, borderRadius: "50%",
            background: zoom <= MIN ? C.border : C.goldBg,
            border: `1px solid ${zoom <= MIN ? C.border : C.gold}`,
            color: zoom <= MIN ? C.dim : C.gold,
            fontSize: 26, fontWeight: 300, lineHeight: 1,
            cursor: zoom <= MIN ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            transition: "background .15s, border-color .15s, color .15s",
          }}
        >−</button>

        <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: C.sub }}>
          {zoom} %
        </div>

        {/* + */}
        <button
          onClick={handleZoomIn}
          disabled={zoom >= MAX}
          style={{
            width: 48, height: 48, borderRadius: "50%",
            background: zoom >= MAX ? C.border : C.goldBg,
            border: `1px solid ${zoom >= MAX ? C.border : C.gold}`,
            color: zoom >= MAX ? C.dim : C.gold,
            fontSize: 26, fontWeight: 300, lineHeight: 1,
            cursor: zoom >= MAX ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            transition: "background .15s, border-color .15s, color .15s",
          }}
        >+</button>
      </div>
    </div>
  );
}


// ─── THESES MENU ─────────────────────────────────────────────
// Mirrors the 3-dot menu in Header.tsx, sits in the Thèses header

function ThesesMenu() {
  const C = useC();
  const { lang, setLang, t } = useLang();
  const { theme, setTheme } = useTheme();
  const [open, setOpen]         = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const darkMode   = theme === "dark";
  const LANG_LABELS: Record<string, string> = { fr: "Français", ht: "Kreyòl" };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={() => { setOpen(false); setLangOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 81, background: "rgba(0,0,0,.25)" }} />
      )}

      {/* 3-dot trigger */}
      <button
        onClick={() => { setOpen(o => !o); setLangOpen(false); }}
        style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "4px 2px", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4, WebkitTapHighlightColor: "transparent",
        }}
      >
        {[0,1,2].map(i => (
          <span key={i} style={{
            width: 4, height: 4, borderRadius: "50%",
            background: open ? C.gold : C.sub,
            display: "block", transition: "background .15s",
          }} />
        ))}
      </button>

      {/* Dropdown */}
      <div style={{
        position: "fixed",
        top: 0, right: 0,
        width: "60%", height: "100vh",
        background: C.surface,
        zIndex: 82,
        borderLeft: `1px solid ${C.border}`,
        boxShadow: "-4px 4px 24px rgba(0,0,0,.12)",
        opacity: open ? 1 : 0,
        transform: open ? "translateX(0)" : "translateX(20px)",
        pointerEvents: open ? "auto" : "none",
        transition: "transform .22s cubic-bezier(.2,.8,.3,1), opacity .18s ease",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "52px 20px 20px", gap: 10, flexShrink: 0 }}>
          <img src="/civique.png" alt="Civique" style={{ width: 120, height: "auto", borderRadius: 14 }} />
          <div style={{ fontSize: 13, color: C.sub, letterSpacing: "1px", fontWeight: 500 }}>CIVIC.FDSE</div>
        </div>
        <div style={{ height: 1, background: C.border, margin: "0 16px 8px", flexShrink: 0 }} />

        {/* Language */}
        <button style={mkRowStyle()} onClick={() => setLangOpen(o => !o)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke={C.sub} strokeWidth="1.6"/>
            <path d="M12 3c-2.5 3-4 5.5-4 9s1.5 6 4 9M12 3c2.5 3 4 5.5 4 9s-1.5 6-4 9M3 12h18" stroke={C.sub} strokeWidth="1.4"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.language")}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.sub }}>{LANG_LABELS[lang]}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 6, transition: "transform .2s", transform: langOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
            <path d="M6 9l6 6 6-6" stroke={C.sub} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {langOpen && (["fr","ht"] as const).map(l => (
          <button key={l} onClick={() => { setLang(l); setLangOpen(false); }}
            style={{ ...mkRowStyle(), paddingLeft: 44, background: lang === l ? C.goldBg : "transparent" }}>
            <span style={{ fontSize: 14, color: lang === l ? C.gold : C.text, fontWeight: lang === l ? 600 : 400 }}>
              {LANG_LABELS[l]}
            </span>
          </button>
        ))}

        <div style={{ height: 1, background: C.border, margin: "0 16px", flexShrink: 0 }} />

        {/* Dark mode */}
        <div style={mkRowStyle()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" stroke={C.sub} strokeWidth="1.6"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.darkMode")}</span>
          <div style={{ marginLeft: "auto" }} onClick={() => setTheme(darkMode ? "light" : "dark")}>
            <div style={{ width: 42, height: 24, borderRadius: 99, background: darkMode ? C.gold : C.border2, position: "relative", transition: "background .2s", cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 3, left: darkMode ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .2s" }} />
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", padding: "16px 20px 32px", fontSize: 10, color: C.dim }}>
          {t("menu.credit")}
        </div>
      </div>
    </>
  );
}

const mkRowStyle = (): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 12,
  padding: "14px 20px", background: "transparent",
  border: "none", width: "100%", textAlign: "left",
  cursor: "pointer", fontFamily: "var(--f-sans)",
  WebkitTapHighlightColor: "transparent",
});

// ─── THESES TAB ──────────────────────────────────────────────

export interface Thesis {
  id:       number;
  title:    string;
  author:   string;
  date:     string;
  favorite: boolean;
  cover:    string;
  pdf:      string; // path in /public folder
}

const SAMPLE_THESES: Thesis[] = [
  { id: 1, pdf: "/these_1.pdf", pdf: "/these_economie_informelle.pdf", title: "Économie informelle et croissance en Haïti",        author: "Jean-Baptiste Moreau",    date: "Mar 2024", favorite: true,  cover: "#4A6FA5" },
  { id: 2, pdf: "/these_2.pdf", pdf: "/these_dollarisation.pdf", title: "Dollarisation et politique monétaire haïtienne",    author: "Claudette Saint-Fleur",  date: "Jan 2024", favorite: false, cover: "#8B5E3C" },
  { id: 3, pdf: "/these_3.pdf", pdf: "/these_transferts_diaspora.pdf", title: "Impact des transferts diaspora sur le PIB",         author: "Pierre-Louis Augustin",  date: "Nov 2023", favorite: true,  cover: "#5A8A6F" },
  { id: 4, pdf: "/these_4.pdf", pdf: "/these_microcredit.pdf", title: "Microcrédit et réduction de la pauvreté rurale",    author: "Marie-Ange Désir",       date: "Sep 2023", favorite: false, cover: "#7B4F8E" },
  { id: 5, pdf: "/these_5.pdf", pdf: "/these_chocs_petroliers.pdf", title: "Chocs pétroliers et inflation en zone caribéenne",  author: "Robenson Étienne",       date: "Jul 2023", favorite: false, cover: "#C4603A" },
  { id: 6, pdf: "/these_6.pdf", pdf: "/these_foncier.pdf", title: "Foncier et blocage du développement agricole",      author: "Nadège Compas",          date: "May 2023", favorite: true,  cover: "#4E7A8A" },
  { id: 7, pdf: "/these_7.pdf", pdf: "/these_gouvernance.pdf", title: "Gouvernance budgétaire et dette publique",          author: "Frantz Lerebours",       date: "Mar 2023", favorite: false, cover: "#6B6B3A" },
  { id: 8, pdf: "/these_8.pdf", pdf: "/these_education.pdf", title: "Éducation et capital humain : rendements privés",   author: "Sophia Blanc-Dominique", date: "Jan 2023", favorite: false, cover: "#8A4A6B" },
];


// ─── THESES HEADER (rendered outside overflow in page.tsx) ───
export function ThesesHeader({ user }: { user?: import("./AuthFlow").UserProfile | null } = {}) {
  const C = useC();
  return (
    <div style={{
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      padding: "10px 16px 12px",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 22, color: C.text, letterSpacing: "-.4px" }}>
          Thèses
        </div>
        <AppMenu user={user} />
      </div>
      <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
        La recherche économique haïtienne, réunie en un seul endroit.
      </div>
    </div>
  );
}

// ─── SEARCH ENGINE ───────────────────────────────────────────
//
// Pipeline:
//  1. normalize()    – NFD accent-strip + lowercase  ("Éducation"→"education")
//  2. tokenize()     – split on punctuation/spaces, drop French stop-words
//  3. matchKind()    – per query-token × corpus-token precision ladder:
//       EXACT   query token === corpus token           (highest)
//       PREFIX  corpus token starts with query token   (e.g. "edu" → "education")
//       INFIX   corpus token contains query token mid-word ("edu" → "réduction")
//       NONE
//     → EXACT and PREFIX are "word-boundary" hits; INFIX is a weak fallback.
//  4. scoreThesis()  – accumulates per-field per-token scores:
//       Title EXACT        +120  Title PREFIX        +60
//       Author EXACT       +70   Author PREFIX       +35
//       Title INFIX        +6    Author INFIX        +3
//       Exact full-phrase  +150 (title) / +90 (author)
//       All-tokens AND bonus +50 (title) / +25 (author)  — only for EXACT/PREFIX hits
//       Favorite tie-break  +3
//  5. Results sorted desc by score; score=0 hidden.
//  6. buildSegments() produces highlight spans for rendering.

// French stop-words — stripped from query tokens only
const FR_STOP = new Set([
  "le","la","les","de","du","des","un","une","et","en","au","aux",
  "a","l","d","par","pour","sur","dans","avec","est","son","sa","ses",
  "ce","cet","cette","ces","qui","que","qu","ou","si","ne","pas","plus",
  "se","il","ils","elle","elles","y","on","nous","vous",
]);

/** NFD accent-strip + lowercase. "Éducation" → "education", "ô" → "o" */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining diacritics
    .toLowerCase()
    .replace(/['']/g, " ");
}

/** Raw tokens from a normalized string — NO stop-word removal (used on corpus). */
function rawTokens(s: string): string[] {
  return normalize(s)
    .split(/[\s\-–—:,;.!?()[\]/]+/)
    .filter(w => w.length > 0);
}

/** Tokens from the user query — stop-words removed. */
function queryTokens(s: string): string[] {
  return rawTokens(s).filter(w => w.length > 1 && !FR_STOP.has(w));
}

type MatchKind = "exact" | "prefix" | "infix" | "none";

/**
 * Best match of a single query token against a list of corpus tokens.
 * "exact"  — query === corpus token (full word match)
 * "prefix" — corpus token starts with query  (e.g. "edu" → "education")
 * "infix"  — corpus token contains query mid-word (e.g. "edu" → "reduction")
 * "none"   — no match
 */
function bestMatch(qt: string, corpusTokens: string[]): MatchKind {
  let best: MatchKind = "none";
  for (const ct of corpusTokens) {
    if (qt === ct)               { return "exact"; }
    if (ct.startsWith(qt))       { best = "prefix"; continue; }
    if (best !== "prefix" && ct.includes(qt)) { best = "infix"; }
  }
  return best;
}

interface SearchResult {
  thesis:     Thesis;
  score:      number;
  titleSegs:  { text: string; hit: boolean }[];
  authorSegs: { text: string; hit: boolean }[];
}

/**
 * Split `text` into highlight segments using pre-normalized hit patterns.
 */
function buildSegments(
  text: string,
  hitTokens: string[],
): { text: string; hit: boolean }[] {
  if (!hitTokens.length) return [{ text, hit: false }];

  const normText = normalize(text);
  const ranges: [number, number][] = [];

  for (const pat of hitTokens) {
    let idx = 0;
    while (true) {
      const pos = normText.indexOf(pat, idx);
      if (pos === -1) break;
      ranges.push([pos, pos + pat.length]);
      idx = pos + 1;
    }
  }
  if (!ranges.length) return [{ text, hit: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    } else {
      merged.push([...r]);
    }
  }

  const segs: { text: string; hit: boolean }[] = [];
  let cur = 0;
  for (const [s, e] of merged) {
    if (s > cur) segs.push({ text: text.slice(cur, s), hit: false });
    segs.push({ text: text.slice(s, e), hit: true });
    cur = e;
  }
  if (cur < text.length) segs.push({ text: text.slice(cur), hit: false });
  return segs;
}

function scoreThesis(th: Thesis, rawQuery: string): SearchResult {
  const normTitle  = normalize(th.title);
  const normAuthor = normalize(th.author);
  const normQuery  = normalize(rawQuery.trim());
  const qTokens    = queryTokens(rawQuery);
  const tTokens    = rawTokens(th.title);
  const aTokens    = rawTokens(th.author);

  let score = 0;
  const hitPatterns: string[] = [];

  // ── 1. Full-phrase exact match (highest signal) ─────────────
  if (normQuery.length > 1) {
    if (normTitle.includes(normQuery))  { score += 150; hitPatterns.push(normQuery); }
    if (normAuthor.includes(normQuery)) { score += 90;  hitPatterns.push(normQuery); }
  }

  // ── 2. Per query-token scoring via precision ladder ─────────
  let allTitleBoundary  = qTokens.length > 0;
  let allAuthorBoundary = qTokens.length > 0;

  for (const qt of qTokens) {
    const titleKind  = bestMatch(qt, tTokens);
    const authorKind = bestMatch(qt, aTokens);

    if      (titleKind === "exact")  { score += 120; hitPatterns.push(qt); }
    else if (titleKind === "prefix") { score += 60;  hitPatterns.push(qt); }
    else if (titleKind === "infix")  { score += 6;   hitPatterns.push(qt); }
    else                             { allTitleBoundary = false; }

    if (titleKind === "infix" || titleKind === "none") allTitleBoundary = false;

    if      (authorKind === "exact")  { score += 70; hitPatterns.push(qt); }
    else if (authorKind === "prefix") { score += 35; hitPatterns.push(qt); }
    else if (authorKind === "infix")  { score += 3;  hitPatterns.push(qt); }
    else                              { allAuthorBoundary = false; }

    if (authorKind === "infix" || authorKind === "none") allAuthorBoundary = false;
  }

  // ── 3. AND bonus — every token matched at word boundary ─────
  if (allTitleBoundary  && qTokens.length > 1) score += 50;
  if (allAuthorBoundary && qTokens.length > 1) score += 25;

  // ── 4. Favorite tie-break ────────────────────────────────────
  if (th.favorite) score += 3;

  const uniquePatterns = [...new Set(hitPatterns)].filter(p => p.length > 0);

  return {
    thesis:     th,
    score,
    titleSegs:  buildSegments(th.title,  uniquePatterns),
    authorSegs: buildSegments(th.author, uniquePatterns),
  };
}

/** Render a pre-segmented string with gold highlights on matched runs. */
function HighlightText({
  segs,
  style,
  hitStyle,
}: {
  segs:     { text: string; hit: boolean }[];
  style:    React.CSSProperties;
  hitStyle: React.CSSProperties;
}) {
  return (
    <span style={style}>
      {segs.map((s, i) =>
        s.hit
          ? <mark key={i} style={{ background: "transparent", ...hitStyle }}>{s.text}</mark>
          : <span key={i}>{s.text}</span>
      )}
    </span>
  );
}

// ─── THESES TAB ───────────────────────────────────────────────

function ThesesTab({ onTabChange, onOpenThesis }: { onTabChange: (t: "results"|"vote"|"community") => void; onOpenThesis: (thesis: Thesis) => void }) {
  const C = useC();
  const { t } = useLang();
  const [query, setQuery]           = useState("");
  const [theses, setTheses]         = useState(SAMPLE_THESES);
  const [focused, setFocused]       = useState(false);

  // ── Ranked search ──────────────────────────────────────────
  // Empty query → show all theses (favorites first), no highlights.
  const results: SearchResult[] = React.useMemo(() => {
    const q = query.trim();
    if (!q) {
      return theses
        .slice()
        .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
        .map(th => ({
          thesis: th,
          score:  0,
          titleSegs:  [{ text: th.title,  hit: false }],
          authorSegs: [{ text: th.author, hit: false }],
        }));
    }
    return theses
      .map(th => scoreThesis(th, q))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [query, theses]);

  const toggleFav = (id: number) =>
    setTheses(prev => prev.map(th => th.id === id ? { ...th, favorite: !th.favorite } : th));

  return (
    <div style={{ background: C.bg, minHeight: "100%" }}>

      {/* ── Search bar (header rendered outside in page.tsx) ── */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 16px 12px",
      }}>

        {/* Search bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: C.card,
          border: `1px solid ${focused ? C.gold : C.border}`,
          borderRadius: 12,
          padding: "10px 14px",
          transition: "border-color .15s",
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke={focused ? C.gold : C.dim} strokeWidth="2"/>
            <path d="M20 20l-4-4" stroke={focused ? C.gold : C.dim} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Titre, auteur…"
            style={{
              flex: 1, border: "none", background: "transparent",
              fontSize: 14, color: C.text, outline: "none",
              fontFamily: "var(--f-sans)",
            }}
          />
          {query.length > 0 && (
            <button onClick={() => setQuery("")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: C.dim, fontSize: 16, lineHeight: 1, padding: 0,
            }}>✕</button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div style={{ padding: "8px 0" }}>
        {results.length === 0 && query.trim().length > 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>
            Aucun résultat pour « {query} »
          </div>
        )}
        {results.map(({ thesis: th, titleSegs, authorSegs }, i) => (
          <div key={th.id} onClick={() => onOpenThesis(th)} style={{
            display: "flex", gap: 14, alignItems: "flex-start",
            padding: "14px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
            marginBottom: 1,
            cursor: "pointer",
            animation: `fadeup .25s ease ${i * 0.04}s both`,
            WebkitTapHighlightColor: "transparent",
          }}>
            {/* Cover placeholder */}
            <div style={{
              width: 52, height: 68, borderRadius: 6, flexShrink: 0,
              background: th.cover,
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              paddingBottom: 6,
              boxShadow: "2px 2px 8px rgba(0,0,0,.18)",
            }}>
              <div style={{ width: 32, height: 2, background: "rgba(255,255,255,.3)", borderRadius: 99 }} />
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <HighlightText
                segs={titleSegs}
                style={{ fontWeight: 600, fontSize: 15, color: C.text, lineHeight: 1.3, marginBottom: 4, display: "block" }}
                hitStyle={{ color: C.gold, fontWeight: 700 }}
              />
              <HighlightText
                segs={authorSegs}
                style={{ fontSize: 12, color: C.sub, display: "block" }}
                hitStyle={{ color: C.gold, fontWeight: 600 }}
              />
            </div>

            {/* Right: date + star */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>{th.date}</div>
              <button
                onClick={e => { e.stopPropagation(); toggleFav(th.id); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 0, lineHeight: 1,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={th.favorite ? C.gold : "none"}>
                  <path
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    stroke={th.favorite ? C.gold : C.dim} strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {/* Bottom spacer — clears the fixed navbar */}
        <div style={{ height: NAV_H + 16 }} />
      </div>
    </div>
  );
}


// ─── MAIN TREEMAP COMPONENT ──────────────────────────────────

interface TreemapProps {
  depts:              Dept[];
  selectedRaceId:     string;
  onSelectRace:       (id: string) => void;
  activeTab:          "results" | "vote" | "community";
  onTabChange:        (tab: "results" | "vote" | "community") => void;
  onOpenThesis:       (thesis: Thesis) => void;
  currentUser?:       UserProfile | null;
  onBadgeGranted?:    () => void;
  onGoToComm?:        (prefill: string) => void;
  // Card-click vote: set by page.tsx when user taps a candidate card in Race
  pendingVote?:       { candidateId: string; postId: string } | null;
  onPendingVoteDone?: () => void;
}

type FlowState = "idle" | "pick" | "confirm" | "done";
type CepSheet  = "none" | "inscription" | "launch";
type VoterSheet= "none" | "candidacy"  | "vote";

const NAV_H = 62;

// ─── SEX-BASED TREEMAP DATA ──────────────────────────────────
// During ongoing elections, treemap groups by sex (Garçons/Filles).
//
// Cell SIZE  = number of people of that sex in the category (real population).
// Cell SPLIT = proportion of that sex who voted red vs blue (real votes).
//
// So a cell visually answers:
//   "Of all the boys/girls in this promo, how many voted? And who did they vote for?"

interface SexGroup {
  label:      string;
  abbr:       string;
  population: number;   // total qualified voters of this sex → drives cell size
  votedPct:   number;   // % of this sex that has voted so far (participation)
  totalVotes: number;   // total votes cast by this sex
  // Per-candidate vote breakdown (parallel arrays, index = palette slot)
  candVotes:  number[]; // raw votes per candidate within this sex
  candPcts:   number[]; // % of this sex's votes per candidate
  // Legacy 2-cand fields kept for backward compat
  redPct:     number;
  bluePct:    number;
  redVotes:   number;
  blueVotes:  number;
}

function buildSexGroups(
  allVotes:   import("./ElectionContext").VoteRecord[],
  candidates: import("./ElectionContext").CandidateRecord[],
  postId:     PostId,
  sexCounts:  { M: number; F: number },
): SexGroup[] {
  const postCands = candidates
    .filter(c => c.postId === postId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const postVotes  = allVotes.filter(v => v.postId === postId);
  const totalVotes = postVotes.length;

  // Votes per candidate globally
  const votesPerCand = postCands.map(c => postVotes.filter(v => v.candidateId === c.id).length);

  const mPop   = sexCounts.M || 1;
  const fPop   = sexCounts.F || 1;
  const mShare = mPop / (mPop + fPop);

  // Distribute each candidate's votes proportionally by sex population share
  // (best approximation until voter_sexe is stored in civique_votes)
  const mVotesPerCand = votesPerCand.map(v => Math.round(v * mShare));
  const fVotesPerCand = votesPerCand.map((v, i) => v - mVotesPerCand[i]);

  const mTotalVotes = mVotesPerCand.reduce((s, n) => s + n, 0);
  const fTotalVotes = fVotesPerCand.reduce((s, n) => s + n, 0);

  // candPcts = each candidate's share of that sex's ELIGIBLE voters (not of votes cast)
  // This matches the race bar formula: votes / population * 100
  const mCandPcts = mVotesPerCand.map(v => (v / mPop) * 100);
  const fCandPcts = fVotesPerCand.map(v => (v / fPop) * 100);

  const makeGroup = (
    label: string, abbr: string, pop: number,
    cVotes: number[], cPcts: number[], tv: number,
  ): SexGroup => ({
    label, abbr, population: pop,
    votedPct:   (tv / pop) * 100,
    totalVotes: tv,
    candVotes:  cVotes,
    candPcts:   cPcts,
    // Legacy 2-cand compat
    redPct:    cPcts[0] ?? 0,
    bluePct:   cPcts[1] ?? 0,
    redVotes:  cVotes[0] ?? 0,
    blueVotes: cVotes[1] ?? 0,
  });

  return [
    makeGroup("Garçons", "♂", mPop, mVotesPerCand, mCandPcts, mTotalVotes),
    makeGroup("Filles",  "♀", fPop, fVotesPerCand, fCandPcts, fTotalVotes),
  ];
}

export default function Treemap({
  depts, selectedRaceId, onSelectRace, activeTab, onTabChange, onOpenThesis,
  currentUser, onBadgeGranted, onGoToComm, pendingVote, onPendingVoteDone,
}: TreemapProps) {
  const C = useC();
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Legacy local vote flow (used only when election status is NOT ongoing)
  const [flow, setFlow]             = useState<FlowState>("idle");
  const [votedRaces, setVotedRaces] = useState<Set<string>>(new Set());
  const [selected, setSelected]     = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(C.red);
  const [doneCountdown, setDoneCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Election-aware sheet state
  const [cepSheet,   setCepSheet]   = useState<CepSheet>("none");
  const [voterSheet, setVoterSheet] = useState<VoterSheet>("none");
  const [votePostId, setVotePostId] = useState<PostId>("president");
  const [voteInitCand, setVoteInitCand] = useState<string | undefined>(undefined);

  const { t } = useLang();
  const {
    election, isCEP, candidates, myVotes, allVotes, categorySexCounts,
    candidatesForPost,
  } = useElection();

  const elStatus  = election?.status ?? "future";
  const isCepUser = currentUser ? isCEPRole(currentUser.role) : false;

  // ── Card-click: open vote sheet pre-selected on the confirm step ──
  useEffect(() => {
    if (!pendingVote || !currentUser) return;
    setVotePostId(pendingVote.postId as PostId);
    setVoteInitCand(pendingVote.candidateId);
    setVoterSheet("vote");
    onPendingVoteDone?.();
  }, [pendingVote]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legacy dismiss handlers (used when status is not "ongoing") ──
  const cancelDismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setFlow("idle");
    setSelected(null);
  }, []);

  const completeDismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setFlow("idle");
    setSelected(null);
    setVotedRaces(prev => new Set(prev).add(selectedRaceId));
  }, [selectedRaceId]);

  useEffect(() => {
    setFlow("idle");
    setSelected(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (outerRef.current) {
        setSize({ w: Math.floor(outerRef.current.offsetWidth), h: Math.floor(outerRef.current.offsetHeight) });
      }
    }));
  }, [selectedRaceId]);

  useEffect(() => {
    if (activeTab !== "vote" && activeTab !== "community") return;
    const id = requestAnimationFrame(() => {
      if (!outerRef.current) return;
      const ro = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      });
      ro.observe(outerRef.current);
      setSize({ w: Math.floor(outerRef.current.offsetWidth), h: Math.floor(outerRef.current.offsetHeight) });
      (outerRef as any)._ro_disconnect = () => ro.disconnect();
    });
    return () => {
      cancelAnimationFrame(id);
      (outerRef as any)._ro_disconnect?.();
    };
  }, [activeTab]);

  useEffect(() => {
    if (flow !== "done") return;
    setDoneCountdown(5);
    timerRef.current = setInterval(() => {
      setDoneCountdown(prev => {
        if (prev <= 1) { completeDismiss(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [flow, completeDismiss]);

  const activeRace = ALL_RACES.find(r => r.id === selectedRaceId) ?? ALL_RACES[0];

  // ── Treemap layout ──────────────────────────────────────────
  // For ongoing elections: group by sex (2 cells).
  // Otherwise: use departments as usual.
  const GAP       = 4;
  const INNER_GAP = 2;

  const isOngoing  = elStatus === "ongoing";
  const isPastView = elStatus === "past";   // past also shows M/F cells with final results
  const activePostId = election?.activePostId ?? "president";
  // Viewed post = what user selected; falls back to active post when ongoing
  const viewedPostId = (isOngoing
    ? (election?.openPosts?.includes(selectedRaceId as PostId) ? selectedRaceId : activePostId)
    : selectedRaceId) as PostId;

  // Build sex-based items for ongoing AND past elections — for the VIEWED post
  const useSexCells = isOngoing || isPastView;
  const sexGroups: SexGroup[] = useSexCells
    ? buildSexGroups(allVotes, candidatesForPost(viewedPostId), viewedPostId, categorySexCounts)
    : [];

  const deptItems = depts.map((d, index) => ({ value: d.students, index })).sort((a, b) => b.value - a.value);
  // Cell size = real population (M/F count), not vote count
  const sexItems  = sexGroups.map((g, index) => ({ value: g.population, index }));

  const total = useSexCells
    ? sexGroups.reduce((s, g) => s + g.population, 0) || 1
    : depts.reduce((s, d) => s + d.students, 0);

  const items = useSexCells ? sexItems : deptItems;
  const rects: Rect[] = size.w > 0 && size.h > 0 ? squarify(items, 0, 0, size.w, size.h) : [];

  // ── Legend ──────────────────────────────────────────────────
  // For ongoing: show what red/blue mean + sex groups
  const postCands = useSexCells
    ? candidatesForPost(activePostId as PostId).sort((a,b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  // Build legend from real candidates with palette colors
  const legendCands = candidatesForPost(viewedPostId as PostId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // For the default (non-ongoing) view, build legend from real candidates of the viewed post.
  // Falls back to generic "Candidat A / B" when no one has registered yet.
  const defaultLegendCands = candidatesForPost(viewedPostId as PostId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const LEGEND = useSexCells
    ? [
        ...legendCands.slice(0, 6).map((cand, i) => ({ color: candidateColor(i), label: cand.userName })),
        ...(legendCands.length === 0 ? [{ color: candidateColor(0), label: "Aucun candidat" }] : []),
        { color: C.dim + "44", label: isPastView ? "Abstention" : "Non-votants" },
      ]
    : defaultLegendCands.length > 0
    ? [
        ...defaultLegendCands.slice(0, 6).map((cand, i) => ({ color: candidateColor(i), label: cand.userName })),
        { color: C.gold, label: t("treemap.tooClose") },
        { color: C.dim,  label: t("treemap.noResult") },
      ]
    : [
        { color: candidateColor(0), label: "Candidat A" },
        { color: candidateColor(1), label: "Candidat B" },
        { color: C.gold, label: t("treemap.tooClose") },
        { color: C.dim,  label: t("treemap.noResult") },
      ];

  // ── Voter button logic per election status ───────────────────
  // future:      CEP → "Lancer les inscriptions"  | voter → nothing (blurred)
  // inscription: CEP → "Commencer les élections"   | voter → "Être candidat·e"
  // ongoing:     CEP → nothing (blurred/unblurred) | voter → "Voter"
  // past:        everyone → unblurred, no button

  const hasVotedLocal  = votedRaces.has(selectedRaceId);
  const hasVotedReal   = isOngoing && myVotes.some(v => v.postId === (activePostId as PostId));
  const showBlur       = elStatus === "future" || elStatus === "inscription"
    ? (!isCepUser && !hasVotedLocal)
    : elStatus === "ongoing"
    ? !hasVotedReal
    : false; // past → never blurred

  const showOverlay    = flow !== "idle"; // legacy overlay

  // Which CTA label and action to show inside the button overlay
  const getCTAConfig = (): { label: string; icon: "ballot" | "candidate" | "launch" | "vote"; action: () => void } | null => {
    if (elStatus === "past") {
      if (isCepUser) return { label: "Nouveau scrutin", icon: "launch" as const, action: () => setCepSheet("reset") };
      return null;
    }
    if (isCepUser) {
      if (elStatus === "future")      return { label: "Inscrip.", icon: "launch",    action: () => setCepSheet("inscription") };
      if (elStatus === "inscription") return { label: "Élections", icon: "launch",   action: () => setCepSheet("launch") };
      return null; // CEP sees no button during ongoing
    }
    // Regular voter
    if (elStatus === "future")      return null; // blurred, no button
    if (elStatus === "inscription") return { label: "Candidat·e", icon: "candidate", action: () => setVoterSheet("candidacy") };
    if (elStatus === "ongoing") {
      if (hasVotedReal) return null;
      return {
        label: "Voter",
        icon: "vote",
        action: () => {
          setVotePostId(activePostId as PostId);
          setVoterSheet("vote");
        },
      };
    }
    return null;
  };

  const cta = getCTAConfig();

  return (
    <>
      <style>{`
        @keyframes sheetUp  { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes plusOne  { from { opacity: 0; transform: translateY(12px) scale(.8) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes checkPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* ── TAB: Thèses ── */}
      {activeTab === "results" && <ThesesTab onTabChange={onTabChange} onOpenThesis={onOpenThesis} />}

      {/* ── TAB: Voter ── */}
      {activeTab === "vote" && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 12px" }}>

          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginTop: 5, marginBottom: 10 }}>
            {t("treemap.title")}
            {isOngoing && election?.activePostId && (
              <span style={{ marginLeft: 8, color: C.gold, fontWeight: 700 }}>
                — {POSTS.find(p => p.id === election.activePostId)?.label}
              </span>
            )}
          </div>

          {/* Treemap canvas */}
          <div style={{ position: "relative", width: "100%", paddingBottom: "85%" }}>

            {/* White-wash overlay */}
            {showBlur && (
              <div style={{
                position: "absolute", inset: 0, borderRadius: 10,
                background: `${C.bg}9E`, zIndex: 4,
                pointerEvents: "none", transition: "opacity .3s ease",
              }} />
            )}

            <div
              ref={outerRef}
              style={{
                position: "absolute", inset: 0,
                background: C.bg, borderRadius: 10, overflow: "hidden",
                filter: showBlur ? "blur(3px)" : "none",
                transition: "filter .3s ease",
              }}
            >
              {/* ── ONGOING: sex-based cells ── */}
              {/* Cell SIZE = population of that sex in the category                    */}
              {/* Cell SPLIT = red (top) = % voted for red candidate                   */}
              {/*              blue (bottom) = % voted for blue candidate               */}
              {/* Unvoted portion shown as dimmed background (participation insight)    */}
              {useSexCells && rects.map(rect => {
                const group  = sexGroups[rect.index];
                if (!group) return null;
                const cx = rect.x + GAP / 2;
                const cy = rect.y + GAP / 2;
                const cw = rect.w - GAP;
                const ch = rect.h - GAP;
                if (cw <= 0 || ch <= 0) return null;

                const minDim = Math.min(cw, ch);
                const fs     = minDim < 60 ? 10 : minDim < 100 ? 13 : 18;
                const sh     = "0 1px 4px rgba(0,0,0,.85)";
                const showLabel = cw > 40 && ch > 30;
                const showPcts  = cw > 60 && ch > 50;
                const showVotes = cw > 80 && ch > 70;

                // Build N candidate strips.
                // Strip height = (candPct / 100) * ch — pct is already share of full
                // electorate, so each strip is proportional to the full cell height.
                // This ensures equal percentages always render equal heights regardless
                // of how many votes have been cast so far.
                const hasCands = group.candVotes.length > 0 && group.totalVotes > 0;

                let cumH = 0;
                const strips = group.candPcts.map((pct, ci) => {
                  const h   = Math.round((pct / 100) * ch);
                  const top = cumH;
                  cumH     += h;
                  return { h, top, color: candidateColor(ci), pct, votes: group.candVotes[ci] };
                });
                // Snap last strip so rounding doesn't leave a pixel gap
                if (strips.length > 0 && hasCands) {
                  const last = strips[strips.length - 1];
                  last.h = Math.round((group.candPcts.reduce((s, p) => s + p, 0) / 100) * ch) - (cumH - last.h);
                  last.h = Math.max(0, last.h);
                }

                const PAD = 3; // px padding inside cell for text

                return (
                  <div key={group.label} style={{
                    position: "absolute", left: cx, top: cy, width: cw, height: ch,
                    overflow: "hidden", borderRadius: 4,
                    background: C.dim + "22",
                  }}>

                    {/* ── N candidate colour strips (stacked bar) ── */}
                    {strips.map((strip, si) => (
                      <div key={si} style={{
                        position: "absolute", left: 0, top: strip.top,
                        width: "100%", height: Math.max(0, strip.h),
                        background: strip.color,
                        transition: "height .9s cubic-bezier(.4,0,.2,1), top .9s cubic-bezier(.4,0,.2,1)",
                      }}>
                        {/* Per-strip % label — only if strip is tall enough */}
                        {strip.h >= 14 && (
                          <div style={{
                            position: "absolute", inset: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: Math.max(8, Math.min(strip.h * 0.28, fs)),
                            fontWeight: 700, color: "#fff",
                            textShadow: sh, pointerEvents: "none",
                            letterSpacing: ".3px",
                          }}>
                            {strip.pct >= 1 ? `${strip.pct.toFixed(0)}%` : ""}
                          </div>
                        )}
                        {/* Thin separator between strips */}
                        {si < strips.length - 1 && strip.h > 0 && (
                          <div style={{
                            position: "absolute", bottom: 0, left: 0,
                            width: "100%", height: 1.5,
                            background: C.bg, opacity: 0.6, zIndex: 2,
                          }} />
                        )}
                      </div>
                    ))}

                    {/* Unvoted dim strip — fills everything below the candidate strips */}
                    <div style={{
                      position: "absolute", left: 0, top: cumH,
                      width: "100%", height: Math.max(0, ch - cumH),
                      background: C.dim + "44",
                    }} />

                    {/* ── Top row: M/F label left, population right ── */}
                    {showLabel && (
                      <div style={{
                        position: "absolute", top: PAD, left: PAD, right: PAD,
                        display: "flex", alignItems: "baseline",
                        zIndex: 5, pointerEvents: "none",
                      }}>
                        <span style={{
                          fontSize: Math.max(8, fs - 1), fontWeight: 700,
                          color: "#fff", textShadow: sh, letterSpacing: ".5px",
                        }}>
                          {group.label === "Garçons" ? "M" : "F"} · {group.population}
                        </span>

                      </div>
                    )}

                    {/* ── Bottom row: votes dépouillés only ── */}
                    {showVotes && group.totalVotes > 0 && (
                      <div style={{
                        position: "absolute", bottom: PAD, left: PAD, right: PAD,
                        display: "flex", justifyContent: "flex-end",
                        zIndex: 5, pointerEvents: "none",
                      }}>
                        <span style={{
                          fontSize: Math.max(7, fs - 4), fontWeight: 400,
                          color: "rgba(255,255,255,.5)", textShadow: sh,
                          fontVariantNumeric: "tabular-nums",
                        }}>
                          {group.totalVotes}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── DEFAULT: department-based cells ── */}
              {!useSexCells && rects.map(rect => {
                const dept   = depts[rect.index];
                if (!dept) return null;
                const status = deptStatus(dept);
                const cx = rect.x + GAP / 2;
                const cy = rect.y + GAP / 2;
                const cw = rect.w - GAP;
                const ch = rect.h - GAP;
                if (cw <= 0 || ch <= 0) return null;
                const redH  = status === "none" ? 0 : Math.round((dept.redPct / 100) * ch);
                const blueH = ch - redH;
                const rc    = status === "close" ? C.gold        : C.red;
                const bc    = status === "close" ? C.gold + "55" : C.blue;
                const minDim = Math.min(cw, ch);
                const fs    = minDim < 40 ? 7 : minDim < 60 ? 8 : minDim < 90 ? 10 : 13;
                const sh    = "0 1px 4px rgba(0,0,0,.85)";
                const showAbbr  = cw > 20 && ch > 18;
                const showSplit = cw > 36 && ch > 40 && dept.rep > 0;
                const showRep   = cw > 52 && ch > 56 && dept.rep > 0;
                const showName  = cw > 70 && ch > 70;
                return (
                  <div key={dept.abbr} className="dept"
                    title={`${dept.name} · ${dept.students.toLocaleString("fr-FR")} étudiants`}
                    style={{ position: "absolute", left: cx, top: cy, width: cw, height: ch, overflow: "hidden", borderRadius: 4, cursor: "default", transition: "filter .2s" }}
                  >
                    {status === "none" ? (
                      <div style={{ width: "100%", height: "100%", background: C.none, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
                        {showAbbr && <div style={{ fontSize: fs, fontWeight: 600, color: C.dim }}>{dept.abbr}</div>}
                        {showName && <div style={{ fontSize: Math.max(7, fs - 2), color: C.dim, opacity: .6 }}>{dept.name}</div>}
                        <div style={{ fontSize: 9, color: C.dim }}>—</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: redH, background: rc, transition: "height .9s cubic-bezier(.4,0,.2,1)" }} />
                        <div style={{ position: "absolute", left: 0, top: redH, width: "100%", height: blueH, background: bc, transition: "height .9s cubic-bezier(.4,0,.2,1)" }} />
                        <div style={{ position: "absolute", left: 0, top: redH - INNER_GAP / 2, width: "100%", height: INNER_GAP, background: C.bg, zIndex: 2 }} />
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, zIndex: 3, pointerEvents: "none" }}>
                          {showAbbr  && <div style={{ fontSize: fs, fontWeight: 700, color: "#fff", textShadow: sh, letterSpacing: ".3px" }}>{dept.abbr}</div>}
                          {showName  && <div style={{ fontSize: Math.max(7, fs - 3), color: "rgba(255,255,255,.65)", textShadow: sh }}>{dept.name}</div>}
                          {showSplit && <div style={{ fontSize: Math.max(7, fs - 2), color: "rgba(255,255,255,.8)", textShadow: sh }}>{dept.redPct.toFixed(0)}·{(100 - dept.redPct).toFixed(0)}</div>}
                          {showRep   && <div style={{ fontSize: Math.max(6, fs - 3), color: "rgba(255,255,255,.45)", textShadow: sh }}>{dept.rep.toFixed(0)}% dép.</div>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── CTA Button overlay ── */}
            {cta && flow === "idle" && (
              <ElectionCTAButton
                label={cta.label}
                icon={cta.icon}
                onPress={cta.action}
                color={isCepUser ? C.gold : elStatus === "inscription" ? C.gold : undefined}
              />
            )}

            {/* ── Legacy vote sheet (future/inscription demo mode) ── */}
            {showOverlay && !isOngoing && (
              <VoteSheet
                step={flow as VoteStep}
                selected={selected}
                selectedColor={selectedColor}
                raceId={selectedRaceId}
                onSelect={(name, color) => { setSelected(name); setSelectedColor(color); }}
                onContinue={() => { if (selected) setFlow("confirm"); }}
                onConfirm={() => setFlow("done")}
                onDismiss={completeDismiss}
                onCancel={cancelDismiss}
                onBack={() => setFlow("pick")}
                countdown={doneCountdown}
              />
            )}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            {LEGEND.map(({ color, label }, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: C.sub }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block", flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>

          {/* ── CEP: Nouveau scrutin button — only after election is closed ── */}
          {isCepUser && elStatus === "past" && (
            <button
              onClick={() => setCepSheet("reset")}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "13px",
                borderRadius: 12,
                border: `1.5px solid ${C.gold}`,
                background: C.goldBg,
                color: C.gold,
                fontFamily: "var(--f-sans)",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: ".3px",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Nouveau scrutin
            </button>
          )}
        </div>
      )}

      {/* ── All races (vote tab only) ── */}
      {activeTab === "vote" && <AllRaces selectedRaceId={selectedRaceId} onSelectRace={onSelectRace} />}

      {/* ── CEP Sheets ── */}
      {cepSheet === "inscription" && (
        <InscriptionSheet onClose={() => setCepSheet("none")} />
      )}
      {cepSheet === "launch" && (
        <LaunchElectionSheet onClose={() => setCepSheet("none")} />
      )}
      {cepSheet === "reset" && (
        <ResetElectionSheet onClose={() => setCepSheet("none")} />
      )}

      {/* ── Voter Sheets ── */}
      {voterSheet === "candidacy" && currentUser && (
        <CandidacySheet
          user={currentUser}
          onClose={() => setVoterSheet("none")}
          onBadgeGranted={() => { onBadgeGranted?.(); }}
          onGoToComm={(prefill: string) => {
            onGoToComm?.(prefill);
            onTabChange("community");
          }}
        />
      )}
      {voterSheet === "vote" && currentUser && (
        <RealVoteSheet
          user={currentUser}
          postId={votePostId}
          initialCandidateId={voteInitCand}
          onClose={() => { setVoterSheet("none"); setVoteInitCand(undefined); }}
        />
      )}
    </>
  );
}

// ─── ELECTION CTA BUTTON ─────────────────────────────────────
// Replaces the old VoterButton with a context-aware version.

function ElectionCTAButton({
  label, icon, onPress, color,
}: {
  label:   string;
  icon:    "ballot" | "candidate" | "launch" | "vote";
  onPress: () => void;
  color?:  string;
}) {
  const C     = useC();
  const [pressed, setPressed] = useState(false);
  const btnColor = color ?? C.text;

  const handlePress = () => {
    setPressed(true);
    setTimeout(() => setPressed(false), 300);
    onPress();
  };

  const IconMap = {
    ballot: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="3" width="16" height="18" rx="2.5" fill={btnColor} opacity=".9"/>
        <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={C.bg} strokeWidth="1.6" strokeLinecap="round"/>
        <circle cx="17.5" cy="15.5" r="3.5" fill={C.bg}/>
        <path d="M15.8 15.5l1.1 1.1 1.8-2" stroke={btnColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    candidate: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" fill={btnColor} opacity=".8"/>
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" fill={btnColor} opacity=".6"/>
        <circle cx="19" cy="5" r="3" fill={C.gold}/>
        <path d="M17.5 5l1 1 2-2" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    launch: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L8 8H3l4 4-2 7 7-4 7 4-2-7 4-4h-5z" fill={btnColor} opacity=".85"/>
      </svg>
    ),
    vote: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="3" width="16" height="18" rx="2.5" fill={btnColor} opacity=".9"/>
        <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={C.bg} strokeWidth="1.6" strokeLinecap="round"/>
        <circle cx="17.5" cy="15.5" r="3.5" fill={C.bg}/>
        <path d="M15.8 15.5l1.1 1.1 1.8-2" stroke={btnColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  };

  return (
    <>
      <style>{`
        @keyframes voterPulse  { 0% { transform:scale(1); opacity:.55; } 70% { transform:scale(2.6); opacity:0; } 100% { transform:scale(2.6); opacity:0; } }
        @keyframes voterPulse2 { 0% { transform:scale(1); opacity:.3;  } 70% { transform:scale(2.0); opacity:0; } 100% { transform:scale(2.0); opacity:0; } }
        @keyframes voterIn     { from { opacity:0; transform:scale(.82); } to { opacity:1; transform:scale(1); } }
        @keyframes voterIconFloat { 0%,100% { transform:translateY(0px); } 50% { transform:translateY(-3px); } }
        @keyframes voterPress  { 0% { transform:scale(1); } 40% { transform:scale(.93); } 100% { transform:scale(1); } }
      `}</style>

      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 5,
        animation: "voterIn .5s cubic-bezier(.2,.8,.3,1) both",
      }}>
        {/* Pulse rings */}
        <div style={{ position:"absolute", width:56, height:56, borderRadius:"50%", background:btnColor, opacity:0, animation:"voterPulse 2.2s ease-out infinite", pointerEvents:"none" }} />
        <div style={{ position:"absolute", width:56, height:56, borderRadius:"50%", background:btnColor, opacity:0, animation:"voterPulse2 2.2s ease-out .7s infinite", pointerEvents:"none" }} />

        <button
          onClick={handlePress}
          style={{
            position:"relative",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            gap:2, width:100, height:100, borderRadius:"50%",
            border:`1.5px solid ${C.border}`,
            background: C.surface,
            cursor:"pointer", fontFamily:"var(--f-sans)",
            backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
            boxShadow:`0 0 0 1px ${C.border2}, 0 8px 32px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.14)`,
            animation: pressed ? "voterPress .3s ease both" : "none",
            transition:"box-shadow .2s ease, border-color .2s ease",
            outline:"none", WebkitTapHighlightColor:"transparent",
          }}
        >
          <div style={{ animation:"voterIconFloat 3s ease-in-out infinite", lineHeight:1 }}>
            {IconMap[icon]}
          </div>
          <div style={{
            fontSize:8, fontWeight:700, color:btnColor,
            letterSpacing:"1px", textTransform:"uppercase", opacity:.9, lineHeight:1,
            textAlign:"center", maxWidth:68,
          }}>
            {label}
          </div>
        </button>
      </div>
    </>
  );
}
