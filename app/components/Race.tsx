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
function CandidateCard({ name, color, stretch }: { name: string; color: string; stretch?: boolean }) {
  const C = useC();
  return (
    <div style={{
      ...(stretch ? { flex: 1, minWidth: 0 } : { flexShrink: 0, width: 110, scrollSnapAlign: "start" }),
      padding: "7px 6px",
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: 5, textAlign: "center",
    }}>
      <div style={{
        width: 110, height: 100, borderRadius: 14,
        border: `1px solid ${color}33`,
        background: `${color}18`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8.5" r="3.5" fill={color} opacity=".4"/>
          <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={color} opacity=".3"/>
        </svg>
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
// ─── SEGMENTED RACE BAR ──────────────────────────────────────
function SegmentedBar({ slots }: { slots: { pct: number; color: string }[] }) {
  const C = useC();
  const hasVotes = slots.some(s => s.pct > 0);
  if (!hasVotes) {
    return (
      <div style={{ height: 7, background: C.dim, borderRadius: 99, overflow: "hidden", position: "relative", display: "flex" }}>
        {slots.map((s, i) => (
          <div key={i} style={{
            flex: 1,
            background: s.color + "44",
            borderLeft: i > 0 ? `1.5px solid ${C.bg}` : "none",
          }} />
        ))}
      </div>
    );
  }
  let cumPct = 0;
  return (
    <div style={{ height: 7, background: C.dim, borderRadius: 99, overflow: "hidden", position: "relative" }}>
      {slots.map((s, i) => {
        const left    = cumPct;
        cumPct       += s.pct;
        const isFirst = i === 0;
        const isLast  = i === slots.length - 1;
        return (
          <div key={i} style={{
            position: "absolute",
            left: `${left}%`, top: 0,
            height: "100%", width: `${s.pct}%`,
            background: s.color,
            borderRadius: isFirst && isLast ? 99 : isFirst ? "99px 0 0 99px" : isLast ? "0 99px 99px 0" : "0",
            borderLeft: i > 0 ? `1.5px solid ${C.bg}` : "none",
            transition: "width 1.4s cubic-bezier(.4,0,.2,1), left 1.4s cubic-bezier(.4,0,.2,1)",
          }} />
        );
      })}
    </div>
  );
}
// ─── STACKED BAR LEGEND ──────────────────────────────────────
// Sleek: color square · name · votes (pct) — wraps naturally on narrow screens.
function BarLegend({ slots }: { slots: { id?: string; name: string; votes: number; pct: number; color: string }[] }) {
  const C = useC();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 7 }}>
      {slots.map((s, i) => {
        const isPhantom = s.id === "abstention";
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.sub, opacity: isPhantom ? 0.55 : 1 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2,
              background: s.color, flexShrink: 0, display: "inline-block",
            }} />
            <span style={{ color: isPhantom ? C.dim : s.color, fontWeight: 600 }}>{s.name}</span>
            {!isPhantom && (
              <span style={{ fontFamily: "var(--f-mono)", color: C.dim }}>
                {n2fr(s.votes)} ({p2fr(s.pct)})
              </span>
            )}
            {isPhantom && (
              <span style={{ fontFamily: "var(--f-mono)", color: C.dim }}>
                seuil 50%+1
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
// ─── MAIN RACE COMPONENT ─────────────────────────────────────
export default function Race({ selectedRaceId }: RaceProps) {
  const C  = useC();
  const { t } = useLang();
  const { election, candidatesForPost, allVotes, winnerOfPost } = useElection();
  const isPast = election?.status === "past";
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
  // Build slots from real candidates
  const rawSlots = viewedCands.map((cand, i) => ({
    id:       cand.id,
    name:     cand.userName,
    votes:    candVotes[i],
    pct:      totalVotes > 0 ? (candVotes[i] / totalVotes) * 100 : 0,
    color:    candidateColor(i),
    isWinner: !!(winner && winner.id === cand.id),
  }));
  // Single-candidate rule: inject "Sans candidature" phantom.
  // Represents abstention / non-votes. The real candidate must beat it (>50%) to win.
  // totalVotes here = votes cast; phantom votes = qualified voters who abstained.
  // Since we don't store eligible voter count per-post, we model the phantom as
  // the complement: phantom pct = 100 - candVotes[0]/totalVotes*100.
  // Visually the bar split shows exactly how far the candidate is from majority.
  if (rawSlots.length === 1) {
    const realPct = rawSlots[0].pct; // already computed above
    rawSlots.push({
      id:       "abstention",
      name:     "Sans candidature",
      votes:    0,
      pct:      100 - realPct,
      color:    C.dim + "99",
      isWinner: false,
    });
  }
  // Pad to minimum 2 placeholders when no candidates at all
  while (rawSlots.length < 2) {
    rawSlots.push({ id: `placeholder-${rawSlots.length}`, name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(rawSlots.length), isWinner: false });
  }
  const slots = rawSlots;
  const isMulti = slots.length > 2;
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 16px 14px" }}>
      {/* Header: post title + countdown */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{
            fontWeight: 600, fontSize: "clamp(14px,3vw,18px)", color: C.text,
            letterSpacing: "-.3px", lineHeight: 1.15,
            flex: 1, minWidth: 0, marginBottom: -15,
          }}>
            {postLabel}
          </div>
          <div style={{ marginTop: 10, filter: "drop-shadow(0px 4px 12px rgba(0,0,0,0.15))" }}>
            <Countdown selectedRaceId={selectedRaceId} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: C.sub, marginBottom: 20, marginTop: 0 }}>
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
              <CandidateCard name={s.name} color={s.color} />
              {i < slots.length - 1 && (
                <div style={{
                  display: "flex", alignItems: "center", flexShrink: 0,
                  fontSize: 10, color: C.dim, fontWeight: 500, letterSpacing: "1px",
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
          <CandidateCard name={slots[0].name} color={slots[0].color} stretch />
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0, fontSize: 10, color: C.dim, fontWeight: 500, letterSpacing: "1px" }}>
            VS
          </div>
          <CandidateCard name={slots[1].name} color={slots[1].color} stretch />
        </div>
      )}
      {/* ── Race bar + stacked legend ── */}
      <div style={{ marginTop: 5 }}>
        <SegmentedBar slots={slots} />
        <BarLegend slots={slots} />
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
  const { election, candidates, allVotes, winnerOfPost } = useElection();
  const elStatus = election?.status ?? "future";
  const isPast   = elStatus === "past";
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
        pct:   totalVotes > 0 ? (postVotes.filter(v => v.candidateId === cand.id).length / totalVotes) * 100 : 0,
        color: candidateColor(i),
      }));
      // Single-candidate: inject abstention phantom
      if (slots.length === 1) {
        slots.push({ id: "abstention", name: "Sans candidature", votes: 0, pct: 100 - slots[0].pct, color: C.dim + "99" });
      }
      const winner    = isPast ? winnerOfPost(post.id) : null;
      const pcts      = slots.map(s => s.pct);
      const maxPct    = pcts.length > 1 ? Math.max(...pcts) : 0;
      const secondPct = pcts.length > 1 ? [...pcts].sort((a, b) => b - a)[1] : 0;
      const gap       = maxPct - secondPct;
      const isClose   = elStatus === "ongoing" && totalVotes > 0 && gap < 2;
      const isElected = isPast && !!winner;
      const displaySlots = slots.length === 0
        ? [
            { id: "a", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(0) },
            { id: "b", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(1) },
          ]
        : slots;
      return { post, displaySlots, totalVotes, winner, isClose, isElected };
    });
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 6px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: C.sub, marginBottom: 2 }}>
        {t("treemap.allRaces")}
      </div>
      {raceRows.map(({ post, displaySlots, totalVotes, winner, isClose, isElected }, i) => {
        const hasVotes = totalVotes > 0;
        let cumPct = 0;
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
            {/* Candidates — one row per candidate with individual color */}
            {displaySlots.map((s, ci) => {
              const isWinner  = !!(winner && s.id === winner.id);
              const isPhantom = s.id === "abstention";
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ci < displaySlots.length - 1 ? 5 : 0, opacity: isPhantom ? 0.5 : 1 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0, opacity: isWinner || !winner ? 1 : 0.35 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? C.text : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>
                    {s.name}
                  </span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? s.color : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>
                    {isPhantom ? "seuil 50%+1" : hasVotes ? `${s.pct.toFixed(1).replace(".", ",")} %` : "0,0 %"}
                  </span>
                </div>
              );
            })}
            {/* Segmented bar */}
            <div style={{ height: 3, background: C.border, borderRadius: 99, overflow: "hidden", marginTop: 8, position: "relative" }}>
              {hasVotes
                ? displaySlots.map((s, si) => {
                    const left = cumPct;
                    cumPct += s.pct;
                    return (
                      <div key={s.id} style={{
                        position: "absolute", left: `${left}%`, top: 0,
                        height: "100%", width: `${s.pct}%`,
                        background: isClose ? C.gold : s.color,
                        borderRadius: si === 0 ? "99px 0 0 99px" : si === displaySlots.length - 1 ? "0 99px 99px 0" : "0",
                        borderLeft: si > 0 ? `1px solid ${C.bg}` : "none",
                        transition: "width 1s ease",
                      }} />
                    );
                  })
                : displaySlots.map((s, si) => (
                    <div key={s.id} style={{
                      position: "absolute",
                      left: `${(si / displaySlots.length) * 100}%`,
                      top: 0, height: "100%",
                      width: `${100 / displaySlots.length}%`,
                      background: s.color + "33",
                      borderLeft: si > 0 ? `1px solid ${C.bg}` : "none",
                    }} />
                  ))
              }
            </div>
            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: 10, color: C.dim }}>
                {totalVotes > 0 ? `${totalVotes} vote${totalVotes !== 1 ? "s" : ""}` : "Aucun vote"}
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
