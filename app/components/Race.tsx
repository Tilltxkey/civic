/**
 * Race.tsx
 * Supports unlimited candidates per post.
 *
 * ≤ 2 candidates → original design: fixed side-by-side cards, VS separator, same gap/layout.
 * ≥ 3 candidates → smooth horizontal scroll with scroll-snap, VS separators between every pair.
 *
 * Race bar: multi-segment, one colored strip per candidate proportional to vote %.
 * Below bar: sleek stacked legend — color square · name · votes (%) — one row per candidate.
 */
"use client";
import { useState, useEffect, useRef } from "react";
import { useC } from "./tokens";
import { ALL_RACES } from "./data";
import { useLang } from "./LangContext";
import { n2fr, p2fr } from "./helpers";
import { useElection, POSTS } from "./ElectionContext";
interface RaceProps {
  votesA: number; votesB: number; reporting: number; selectedRaceId: string;
  onCardClick?: (candidateId: string, postId: string) => void;
}
// ─── CANDIDATE COLOR PALETTE ─────────────────────────────────
const CAND_COLORS = [
  "#C8250E", // 0 — red
  "#1358D0", // 1 — blue
  "#7B4F8E", // 2 — purple
  "#C4603A", // 3 — orange
  "#5A8A6F", // 4 — green
  "#8B5E3C", // 5 — brown
];
export function candidateColor(i: number): string {
  return CAND_COLORS[i % CAND_COLORS.length];
}
// ─── CANDIDATE CARD ──────────────────────────────────────────
// Original design preserved exactly — no vote/pct inside the card.
function CandidateCard({
  name, color, stretch, photo, onClick,
}: {
  name: string; color: string; stretch?: boolean;
  photo?: string; onClick?: () => void;
}) {
  const C = useC();
  const isClickable = !!onClick;
  return (
    <div
      onClick={onClick}
      style={{
        ...(stretch ? { flex: 1, minWidth: 0 } : { flexShrink: 0, width: 110, scrollSnapAlign: "start" }),
        padding: "7px 6px",
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 5, textAlign: "center",
        cursor: isClickable ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{
        width: 130, height: 130, borderRadius: 70,
        border: `1px solid ${color}33`,
        background: `${color}18`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, overflow: "hidden",
        transition: isClickable ? "transform .15s, box-shadow .15s" : undefined,
        boxShadow: isClickable ? `0 0 0 0px ${color}55` : undefined,
      }}
        onPointerDown={isClickable ? e => {
          (e.currentTarget as HTMLElement).style.transform = "scale(.96)";
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${color}44`;
        } : undefined}
        onPointerUp={isClickable ? e => {
          (e.currentTarget as HTMLElement).style.transform = "";
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 0px ${color}55`;
        } : undefined}
        onPointerLeave={isClickable ? e => {
          (e.currentTarget as HTMLElement).style.transform = "";
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 0px ${color}55`;
        } : undefined}
      >
        {photo ? (
          <img
            src={photo}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 14 }}
          />
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8.5" r="3.5" fill={color} opacity=".4"/>
            <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={color} opacity=".3"/>
          </svg>
        )}
      </div>
      <div style={{ minWidth: 0, width: "100%" }}>
        <div style={{
          fontWeight: 600, fontSize: 15, color: C.text,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {name}
        </div>
      </div>
    </div>
  );
}
// ─── CONVERGING RACE BAR ─────────────────────────────────────
// Layout rules (pct = share of full electorate):
//   • 1 candidate  → fills from the left
//   • 2 candidates → [0] grows from left, [1] grows from right, gray center shrinks
//   • N candidates → [0] left-anchored, [N-1] right-anchored,
//                    middle ones stack inward from left edge (after [0])
// The gray track background is always 100% wide — colored segments sit on top.
export function ConvergingBar({ slots }: { slots: { pct: number; color: string }[] }) {
  const C = useC();
  if (slots.length === 0) return null;

  // Build positioned segments
  const segments: { left?: number; right?: number; width: number; color: string; key: number }[] = [];

  if (slots.length === 1) {
    segments.push({ left: 0, width: slots[0].pct, color: slots[0].color, key: 0 });
  } else if (slots.length === 2) {
    segments.push({ left:  0,              width: slots[0].pct, color: slots[0].color, key: 0 });
    segments.push({ right: 0,              width: slots[1].pct, color: slots[1].color, key: 1 });
  } else {
    // First → left-anchored
    segments.push({ left: 0, width: slots[0].pct, color: slots[0].color, key: 0 });
    // Last → right-anchored
    segments.push({ right: 0, width: slots[slots.length - 1].pct, color: slots[slots.length - 1].color, key: slots.length - 1 });
    // Middle → stack leftward after slot[0]
    let cursor = slots[0].pct;
    for (let i = 1; i < slots.length - 1; i++) {
      segments.push({ left: cursor, width: slots[i].pct, color: slots[i].color, key: i });
      cursor += slots[i].pct;
    }
  }

  return (
    <div style={{ height: 7, background: C.dim + "33", borderRadius: 99, overflow: "hidden", position: "relative" }}>
      {segments.map(seg => (
        <div key={seg.key} style={{
          position: "absolute",
          top: 0, height: "100%",
          width: `${seg.width}%`,
          ...(seg.left !== undefined ? { left: `${seg.left}%` } : {}),
          ...(seg.right !== undefined ? { right: `${seg.right}%` } : {}),
          background: seg.color,
          transition: "width .9s cubic-bezier(.4,0,.2,1)",
        }} />
      ))}
    </div>
  );
}
// ─── STACKED BAR LEGEND ──────────────────────────────────────
// Sleek: color square · name · votes (pct) — wraps naturally on narrow screens.
function BarLegend({ slots, totalEligible }: { slots: { id?: string; name: string; votes: number; pct: number; color: string }[]; totalEligible: number }) {
  const C = useC();
  const castVotes = slots.reduce((s, r) => s + r.votes, 0);
  const remaining = totalEligible - castVotes;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 7 }}>
      {slots.map((s, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.sub }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0, display: "inline-block" }} />
          <span style={{ color: s.color, fontWeight: 600 }}>{s.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", color: C.dim }}>
            {n2fr(s.votes)} ({p2fr(s.pct)})
          </span>
        </span>
      ))}
      {remaining > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.sub, opacity: 0.6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: C.dim + "44", flexShrink: 0, display: "inline-block" }} />
          <span style={{ color: C.dim }}>Non votés</span>
          <span style={{ fontFamily: "var(--f-mono)", color: C.dim }}>
            {n2fr(remaining)} ({p2fr((remaining / totalEligible) * 100)})
          </span>
        </span>
      )}
    </div>
  );
}
// ─── MAIN RACE COMPONENT ─────────────────────────────────────
export default function Race({ selectedRaceId, onCardClick }: RaceProps) {
  const C  = useC();
  const { t } = useLang();
  const { election, candidatesForPost, allVotes, winnerOfPost, profilePhotos, categorySexCounts } = useElection();
  const isPast    = election?.status === "past";
  const isOngoing = election?.status === "ongoing";
  const totalEligible = categorySexCounts.M + categorySexCounts.F || 1; // avoid /0
  const viewedPostId = selectedRaceId as any;
  const viewedPost   = POSTS.find(p => p.id === viewedPostId)
    ?? ALL_RACES.find(r => r.id === selectedRaceId);
  const postLabel    = viewedPost
    ? ("label" in viewedPost ? viewedPost.label : (viewedPost as any).role)
    : selectedRaceId;
  // Candidates sorted by registration order → slot index = color index
  const viewedCands = candidatesForPost(viewedPostId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const candVotes  = viewedCands.map(cand =>
    allVotes.filter(v => v.candidateId === cand.id && v.postId === viewedPostId).length
  );
  const totalVotes = candVotes.reduce((s, n) => s + n, 0);
  const winner     = isPast ? winnerOfPost(viewedPostId) : null;
  // Build slots — pct = candidate's share of the FULL electorate (not just votes cast)
  const rawSlots = viewedCands.map((cand, i) => ({
    id:       cand.id,
    userId:   cand.userId,
    name:     cand.userName,
    votes:    candVotes[i],
    pct:      (candVotes[i] / totalEligible) * 100,
    color:    candidateColor(i),
    isWinner: !!(winner && winner.id === cand.id),
  }));

  // Gray remainder = uncast votes as share of electorate
  const castPct     = rawSlots.reduce((s, r) => s + r.pct, 0);
  const remainderPct = Math.max(0, 100 - castPct);

  // Pad to minimum 2 placeholders when no candidates at all
  while (rawSlots.length < 2) {
    rawSlots.push({ id: `placeholder-${rawSlots.length}`, userId: "", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(rawSlots.length), isWinner: false });
  }
  const slots = rawSlots;
  const isMulti = slots.length > 2;
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 16px 14px" }}>
      {/* Header: post title + countdown */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{
            fontWeight: 600, fontSize: "clamp(17px,3vw,18px)", color: C.text,
            letterSpacing: "-.3px", lineHeight: 1.15,
            flex: 1, minWidth: 0, marginBottom: -15,
          }}>
            {postLabel}
          </div>
          <div style={{ marginTop: 10, filter: "drop-shadow(0px 4px 12px rgba(0,0,0,0.15))" }}>
            <Countdown selectedRaceId={selectedRaceId} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 20, marginTop: 0 }}>
          {isPast ? "Élection terminée — résultats définitifs" : t("race.noWinner")}
        </div>
      </div>
      {/* ── Candidate cards ── */}
      {isMulti ? (
        // ≥ 3 candidates: smooth horizontal scroll with VS separators between each pair
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          overflowX: "auto",
          scrollSnapType: "x proximity",
          WebkitOverflowScrolling: "touch",
          gap: 4,
          paddingBottom: 4,
          marginLeft: -4, marginRight: -4,
          paddingLeft: 4, paddingRight: 4,
          msOverflowStyle: "none",
          scrollbarWidth: "none",
        }}>
          {slots.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <CandidateCard
                name={s.name}
                color={s.color}
                photo={s.userId ? profilePhotos[s.userId] : undefined}
                onClick={isOngoing && s.userId && onCardClick
                  ? () => onCardClick(s.id, viewedPostId)
                  : undefined}
              />
              {i < slots.length - 1 && (
                <div style={{
                  display: "flex", alignItems: "center", flexShrink: 0,
                  fontSize: 10, color: C.dim, fontWeight: 500, letterSpacing: "1px", padding:12,
                }}>
                  VS
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // ≤ 2 candidates: original fixed layout — same gap, VS, everything
        <div style={{ display: "flex", gap: 6 }}>
          <CandidateCard
            name={slots[0].name}
            color={slots[0].color}
            stretch
            photo={slots[0].userId ? profilePhotos[slots[0].userId] : undefined}
            onClick={isOngoing && slots[0].userId && onCardClick
              ? () => onCardClick(slots[0].id, viewedPostId)
              : undefined}
          />
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0, fontSize: 10, color: C.dim, fontWeight: 500, letterSpacing: "1px" }}>
            VS
          </div>
          <CandidateCard
            name={slots[1].name}
            color={slots[1].color}
            stretch
            photo={slots[1].userId ? profilePhotos[slots[1].userId] : undefined}
            onClick={isOngoing && slots[1].userId && onCardClick
              ? () => onCardClick(slots[1].id, viewedPostId)
              : undefined}
          />
        </div>
      )}
      {/* ── Race bar + stacked legend ── */}
      <div style={{ marginTop: 5 }}>
        <ConvergingBar slots={slots.map(s => ({ pct: s.pct, color: s.color }))} />
        <BarLegend slots={slots} totalEligible={totalEligible} />
      </div>
    </div>
  );
}
// ─── COUNTDOWN ───────────────────────────────────────────────
function Countdown({ selectedRaceId }: { selectedRaceId: string }) {
  const C  = useC();
  const { t } = useLang();
  const { election, secondsLeft: getSecsLeft, refreshElection } = useElection();
  const [secs, setSecs] = useState(0);
  const firedRef = useRef(false); // fire refreshElection only once per zero-crossing

  const timers      = election?.timers ?? [];
  const viewedTimer = timers.find(t => t.postId === selectedRaceId);
  const relevantId  = viewedTimer?.endsAt
    ? selectedRaceId
    : (election?.activePostId ?? election?.openPosts?.[0] ?? "president");

  // Reset firedRef when a new timer starts (relevantId or endsAt changes)
  const endsAt = viewedTimer?.endsAt ?? null;
  useEffect(() => { firedRef.current = false; }, [relevantId, endsAt]);

  useEffect(() => {
    const refreshRef = { fn: refreshElection };
    const update = () => {
      const s = getSecsLeft(relevantId as any);
      setSecs(s);
      if (s === 0 && election?.status === "ongoing" && !firedRef.current) {
        firedRef.current = true;
        refreshRef.fn();
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [getSecsLeft, relevantId, election?.status, refreshElection]);
  const status = election?.status ?? "future";
  // Only show "Terminé" once the DB confirms status === "past".
  // While secs=0 but status is still "ongoing" (DB write in flight), show "clôture..."
  const done     = status === "past";
  const closing  = status === "ongoing" && secs === 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (status === "future" || status === "inscription") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        background: C.surface, border: `1px solid ${C.border2}`,
        borderRadius: 99, padding: "5px 14px", flexShrink: 0,
      }}>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 500, color: C.dim, letterSpacing: "1px", lineHeight: 1 }}>
          --:--:--
        </div>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: ".5px", lineHeight: 1, textTransform: "uppercase" }}>
          {status === "inscription" ? "inscriptions" : "en attente"}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      background: done ? C.goldBg : C.surface,
      border: `1px solid ${done ? C.gold : closing ? C.gold + "66" : C.border2}`,
      borderRadius: 99, padding: "5px 14px", flexShrink: 0,
      transition: "border-color .4s, background .4s",
    }}>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 500, color: done ? C.gold : C.text, letterSpacing: "1.5px", lineHeight: 1, transition: "color .4s" }}>
        {done ? "Terminé" : closing ? "00:00:00" : `${pad(h)}:${pad(m)}:${pad(s)}`}
      </div>
      <div style={{ fontSize: 8, color: done ? C.gold : C.sub, letterSpacing: ".5px", lineHeight: 1, textTransform: "uppercase" }}>
        {done ? t("race.done") : closing ? "clôture…" : t("race.timeLeft")}
      </div>
    </div>
  );
}
// ─── ALL RACES ────────────────────────────────────────────────
// Their method: unlimited candidates, segmented bar, stacked rows, per-candidate colors.
export function AllRaces({ selectedRaceId, onSelectRace }: { selectedRaceId: string; onSelectRace: (id: string) => void }) {
  const C = useC();
  const { t } = useLang();
  const { election, candidates, allVotes, winnerOfPost, categorySexCounts } = useElection();
  const totalEligible = (categorySexCounts.M + categorySexCounts.F) || 1;

  const handleSelectRace = (id: string) => {
    onSelectRace(id);
    const s = document.getElementById("main-scroll");
    if (s) s.scrollTop = 0;
  };

  const elStatus = election?.status ?? "future";
  const isPast   = elStatus === "past";

  const raceRows = [...POSTS].reverse()
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
        // pct = share of full electorate
        pct:   (postVotes.filter(v => v.candidateId === cand.id).length / totalEligible) * 100,
        color: candidateColor(i),
      }));

      const castPct      = slots.reduce((s, r) => s + r.pct, 0);
      const remainderPct = Math.max(0, 100 - castPct);

      const winner    = isPast ? winnerOfPost(post.id) : null;
      const pcts      = slots.map(s => s.pct);
      const maxPct    = pcts.length > 1 ? Math.max(...pcts) : 0;
      const secondPct = pcts.length > 1 ? [...pcts].sort((a, b) => b - a)[1] : 0;
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
        const displaySlots = slots.length === 0
          ? [
              { id: "a", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(0) },
              { id: "b", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(1) },
            ]
          : slots;
        return (
          <div key={post.id} onClick={() => handleSelectRace(post.id)} style={{
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
            {/* Candidates */}
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
      <div style={{ height: 64 }} />
    </div>
  );
}