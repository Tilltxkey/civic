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

function AllRaces({ selectedRaceId, onSelectRace }: { selectedRaceId: string; onSelectRace: (id: string) => void }) {
  const C = useC();
  const { t } = useLang();
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 6px" }}>

      {/* Section header */}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginBottom: 2 }}>
        {t("treemap.allRaces")}
      </div>

      {[...ALL_RACES].sort((a, b) => a.importance - b.importance).filter(r => r.id !== selectedRaceId).map((race, i) => {
        const [a, b] = race.candidates;
        const leader = a.pct > b.pct ? a : b;
        const isClose  = race.status === "close";
        const isCall   = race.status === "call";
        const isWatch  = race.status === "watch";

        return (
          <div key={i} onClick={() => onSelectRace(race.id)} style={{
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            padding: "12px 0 10px",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}>

            {/* Role + status badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{race.role}</div>
              {isCall && (
                <div style={{
                  fontSize: 8.5, fontWeight: 700, letterSpacing: "1px",
                  border: `1px solid ${C.text}`, color: C.text,
                  padding: "2px 6px", borderRadius: 3, flexShrink: 0,
                  textTransform: "uppercase",
                }}>
                  Résultat
                </div>
              )}
              {isClose && (
                <div style={{
                  fontSize: 8.5, fontWeight: 700, letterSpacing: "1px",
                  background: C.gold, color: "#fff",
                  padding: "2px 6px", borderRadius: 3, flexShrink: 0,
                  textTransform: "uppercase",
                }}>
                  {t("treemap.tooClose")}
                </div>
              )}
            </div>

            {/* Candidates */}
            {[a, b].map((c, ci) => {
              const isWinner = race.winner === c.name;
              const clr = c.color === "red" ? C.red : C.blue;
              return (
                <div key={ci} style={{
                  display: "flex", alignItems: "center",
                  gap: 8, marginBottom: ci === 0 ? 5 : 0,
                }}>
                  {/* Dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: clr, flexShrink: 0,
                    opacity: isWinner || !race.winner ? 1 : 0.35,
                  }} />

                  {/* Name */}
                  <span style={{
                    flex: 1, fontSize: 13,
                    fontWeight: isWinner ? 600 : 400,
                    color: isWinner ? C.text : C.sub,
                    opacity: isWinner || !race.winner ? 1 : 0.5,
                  }}>
                    {c.name}
                  </span>

                  {/* Pct */}
                  <span style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 13,
                    fontWeight: isWinner ? 600 : 400,
                    color: isWinner ? clr : C.sub,
                    opacity: isWinner || !race.winner ? 1 : 0.5,
                  }}>
                    {c.pct.toFixed(1).replace(".", ",")} %
                  </span>
                </div>
              );
            })}

            {/* Progress bar */}
            <div style={{ height: 3, background: C.border, borderRadius: 99, overflow: "hidden", marginTop: 8, position: "relative" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, height: "100%",
                width: `${a.pct}%`,
                background: a.color === "red" ? C.red : C.blue,
                borderRadius: "99px 0 0 99px",
                transition: "width 1s ease",
              }} />
              <div style={{
                position: "absolute", right: 0, top: 0, height: "100%",
                width: `${b.pct}%`,
                background: isClose ? C.gold : (b.color === "blue" ? C.blue : C.red),
                borderRadius: "0 99px 99px 0",
                transition: "width 1s ease",
              }} />
            </div>

            {/* Footer: reporting + winner/watch */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: 10, color: C.dim }}>{race.reporting} {t("treemap.reporting")}</span>
              {isCall && race.winner && (
                <span style={{ fontSize: 10, fontWeight: 700, color: C.text, letterSpacing: ".5px", textTransform: "uppercase" }}>
                  {race.winner} {t("treemap.elected")}
                </span>
              )}
              {isWatch && (
                <span style={{ fontSize: 10, fontWeight: 600, color: C.gold, display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 9 }}>⚡</span> {t("treemap.watch")}
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

function ThesesTab({ onTabChange, onOpenThesis }: { onTabChange: (t: "results"|"vote"|"community") => void; onOpenThesis: (thesis: Thesis) => void }) {
  const C = useC();
  const { t } = useLang();
  const [query, setQuery]           = useState("");
  const [theses, setTheses]         = useState(SAMPLE_THESES);
  const [focused, setFocused]       = useState(false);

  const filtered = theses.filter(th =>
    th.title.toLowerCase().includes(query.toLowerCase()) ||
    th.author.toLowerCase().includes(query.toLowerCase())
  );

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
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>
            Aucun résultat pour « {query} »
          </div>
        )}
        {filtered.map((th, i) => (
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
              <div style={{ fontWeight: 600, fontSize: 15, color: C.text, lineHeight: 1.3, marginBottom: 4 }}>
                {th.title}
              </div>
              <div style={{ fontSize: 12, color: C.sub }}>{th.author}</div>
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
  depts:          Dept[];
  selectedRaceId: string;
  onSelectRace:   (id: string) => void;
  activeTab:      "results" | "vote" | "community";
  onTabChange:    (tab: "results" | "vote" | "community") => void;
  onOpenThesis:   (thesis: Thesis) => void;
}

type FlowState = "idle" | "pick" | "confirm" | "done";

const NAV_H = 62; // navbar height in px — keep in sync with navbar padding

export default function Treemap({ depts, selectedRaceId, onSelectRace, activeTab, onTabChange, onOpenThesis }: TreemapProps) {
  const C = useC();
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize]             = useState({ w: 0, h: 0 });
  const [flow, setFlow]             = useState<FlowState>("idle");
  const [votedRaces, setVotedRaces] = useState<Set<string>>(new Set());
  const [selected, setSelected]     = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(C.red);
  const [doneCountdown, setDoneCountdown] = useState(5);
  const { t } = useLang();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // User cancelled mid-flow (tapped backdrop) — close sheet, keep blur + button
  const cancelDismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setFlow("idle");
    setSelected(null);
    // hasVoted stays false → blur stays, button comes back
  }, []);

  // User completed voting and hit Terminé — clear everything
  const completeDismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setFlow("idle");
    setSelected(null);
    setVotedRaces(prev => new Set(prev).add(selectedRaceId)); // persist per race
  }, [selectedRaceId]);

  // Reset flow (not vote) when race changes — voted state persists per race
  useEffect(() => {
    setFlow("idle");
    setSelected(null);
    // Double rAF: first frame lets React flush the DOM, second guarantees layout is complete
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (outerRef.current) {
        setSize({ w: Math.floor(outerRef.current.offsetWidth), h: Math.floor(outerRef.current.offsetHeight) });
      }
    }));
  }, [selectedRaceId]);

  // ResizeObserver — re-runs when activeTab changes so the ref is re-attached after tab switch
  useEffect(() => {
    if (activeTab !== "vote" && activeTab !== "community") return;
    // rAF ensures the DOM node is mounted before we try to observe it
    const id = requestAnimationFrame(() => {
      if (!outerRef.current) return;
      const ro = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      });
      ro.observe(outerRef.current);
      setSize({ w: Math.floor(outerRef.current.offsetWidth), h: Math.floor(outerRef.current.offsetHeight) });
      // store disconnect fn on ref for cleanup
      (outerRef as any)._ro_disconnect = () => ro.disconnect();
    });
    return () => {
      cancelAnimationFrame(id);
      (outerRef as any)._ro_disconnect?.();
    };
  }, [activeTab]);

  // Auto-dismiss countdown when on "done" step
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

  // Derived race data — must come first, used by LEGEND and render
  const activeRace  = ALL_RACES.find(r => r.id === selectedRaceId) ?? ALL_RACES[0];

  // Layout
  const GAP       = 4;
  const INNER_GAP = 2;
  const total     = depts.reduce((s, d) => s + d.students, 0);
  const items     = depts.map((d, index) => ({ value: d.students, index })).sort((a, b) => b.value - a.value);
  const rects: Rect[] = size.w > 0 && size.h > 0 ? squarify(items, 0, 0, size.w, size.h) : [];

  const LEGEND = [
    { color: C.red,  label: activeRace.candidates[0].name.split(" ")[1] },
    { color: C.blue, label: activeRace.candidates[1].name.split(" ")[1] },
    { color: C.gold, label: t("treemap.tooClose") },
    { color: C.dim,  label: t("treemap.noResult") },
  ];

  // Blur only during the sheet flow
  const hasVoted    = votedRaces.has(selectedRaceId);
  const showOverlay = flow !== "idle";
  const blurred     = showOverlay;

  return (
    <>
      {/* Keyframes for sheet + +1 animation */}
      <style>{`
        @keyframes sheetUp  { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes plusOne  { from { opacity: 0; transform: translateY(12px) scale(.8) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>

      {/* ── TAB: Thèses ── */}
      {activeTab === "results" && <ThesesTab onTabChange={onTabChange} onOpenThesis={onOpenThesis} />}

      {/* ── TAB: Voter (treemap + races) ── */}
      {activeTab === "vote" && (
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 12px" }}>

        {/* Section label */}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginTop: 5, marginBottom: 10 }}>
          {t("treemap.title")}
        </div>

        {/* Treemap canvas */}
        <div style={{ position: "relative", width: "100%", paddingBottom: "85%" }}>

          {/* White-wash overlay */}
          {!hasVoted && (
            <div style={{
              position: "absolute", inset: 0,
              borderRadius: 10,
              background: `${C.bg}9E`,  // ~62% opacity, adapts to theme
              zIndex: 4,
              pointerEvents: "none",
              transition: "opacity .3s ease",
            }} />
          )}

          <div
            ref={outerRef}
            style={{
              position: "absolute", inset: 0,
              background: C.bg,
              borderRadius: 10,
              overflow: "hidden",
              filter: hasVoted ? "none" : "blur(3px)",
              transition: "filter .3s ease",
            }}
          >
            {rects.map(rect => {
              const dept   = depts[rect.index];
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

          {/* VOTER button */}
          {flow === "idle" && !hasVoted && <VoterButton onPress={() => setFlow("pick")} />}

          {/* Vote sheet */}
          {showOverlay && (
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

      </div>

      )}

      {/* ── All races (vote tab only) ── */}
      {activeTab === "vote" && <AllRaces selectedRaceId={selectedRaceId} onSelectRace={onSelectRace} />}



    </>
  );
}