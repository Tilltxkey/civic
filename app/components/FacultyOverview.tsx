"use client";
import { useState, useEffect } from "react";
import { useC } from "./tokens";
import { useLang } from "./LangContext";
import { supabase } from "./supabase";
import { POSTS, type CandidateRecord, type VoteRecord } from "./ElectionContext";
import { candidateColor, ConvergingBar } from "./Race";
import type { UserProfile } from "./AuthFlow";

const FIELD_YEARS: Record<string, Record<string, { min: number; max: number }>> = {
  "FDSE":                              { "Sciences Économiques": { min:1,max:4 }, "Sciences Juridiques": { min:1,max:4 } },
  "FDSE – Droit & Sciences Économiques": { "Sciences Économiques": { min:1,max:4 }, "Sciences Juridiques": { min:1,max:4 } },
  "INAGHEI":     { "Gestion des Affaires": { min:1,max:4 }, "Comptabilité": { min:1,max:4 }, "Administration Publique": { min:1,max:4 }, "Relations Internationales": { min:1,max:4 } },
  "FDS":         { "Génie Civil": { min:1,max:5 }, "Électromécanique": { min:1,max:5 }, "Électronique": { min:1,max:5 }, "Architecture": { min:1,max:5 }, "Chimie": { min:1,max:4 }, "Topographie": { min:1,max:2 } },
  "FASCH":       { "Sociologie": { min:1,max:4 }, "Psychologie": { min:1,max:4 }, "Travail Social": { min:1,max:4 }, "Communication Sociale": { min:1,max:4 } },
  "FE":          { "Psychologie": { min:1,max:4 }, "Anthropologie-Sociologie": { min:1,max:4 } },
  "FLA":         { "Linguistique Appliquée": { min:1,max:4 } },
  "FAMV":        { "Agronomie": { min:1,max:5 } },
  "ENS":         { "Mathématiques": { min:1,max:3 }, "Physique": { min:1,max:3 }, "Philosophie": { min:1,max:3 }, "Lettres Modernes": { min:1,max:3 }, "Sciences Sociales": { min:1,max:3 }, "Langues Vivantes": { min:1,max:3 } },
  "CTPEA":       { "Économie Appliquée": { min:1,max:4 }, "Statistique": { min:1,max:4 } },
  "FMPM":        { "Médecine": { min:1,max:7 }, "Pharmacie": { min:1,max:4 }, "Biologie Médicale": { min:1,max:3 } },
  "FO":          { "Odontologie": { min:1,max:5 } },
  "IERAH-ISERSS":{ "Histoire": { min:1,max:4 }, "Géographie": { min:1,max:4 }, "Patrimoine et Tourisme": { min:1,max:4 } },
  "CHCL":        { "Informatique": { min:1,max:4 }, "Sciences Infirmières": { min:1,max:4 }, "Génie Civil": { min:1,max:5 }, "Génie Électrique": { min:1,max:5 }, "Génie Mécanique": { min:1,max:5 }, "Agronomie": { min:1,max:5 } },
  "EDEG":        { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
  "EDEC":        { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
  "EDEJ":        { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
  "EDEHP":       { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
  "EDEH":        { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
  "EDEFL":       { "Sciences Juridiques": { min:1,max:4 }, "Sciences Économiques": { min:1,max:4 } },
};

const VACATIONS = ["Jour", "Soir"] as const;
type Vacation = typeof VACATIONS[number];

const STATUS_DOT: Record<string, string> = {
  future:             "#B8B6AF",
  inscription:        "#C47F00",
  inscription_closed: "#B8B6AF",
  ongoing:            "#0b971e",
  past:               "#B8B6AF",
};
const STATUS_TITLE: Record<string, string> = {
  future:             "ÉLECTIONS À VENIR",
  inscription:        "CANDIDATURES OUVERTES",
  inscription_closed: "CANDIDATURES CLOSES",
  ongoing:            "ÉLECTIONS EN COURS",
  past:               "ÉLECTIONS PASSÉES",
};

// ── winnerOfPost — mirrors ElectionContext exactly ────────────
function resolveWinner(
  postId: string, status: string,
  candidates: CandidateRecord[], allVotes: VoteRecord[], totalEligible: number,
): CandidateRecord | null {
  if (status !== "past") return null;
  const postCands = candidates.filter(c => c.postId === postId);
  if (postCands.length === 0) return null;
  const postVotes = allVotes.filter(v => v.postId === postId);
  const voteCounts: Record<string, number> = {};
  for (const v of postVotes) voteCounts[v.candidateId] = (voteCounts[v.candidateId] ?? 0) + 1;
  const maxVotes = Math.max(...postCands.map(c => voteCounts[c.id] ?? 0));
  if (postCands.length === 1) return (voteCounts[postCands[0].id] ?? 0) > totalEligible / 2 ? postCands[0] : null;
  const topCands = postCands.filter(c => (voteCounts[c.id] ?? 0) === maxVotes);
  return maxVotes > 0 && topCands.length === 1 ? topCands[0] : null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transition: "transform .2s", transform: open ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── YearBlock ─────────────────────────────────────────────────
function YearBlock({ year, faculty, field }: { year: number; faculty: string; field: string }) {
  const C     = useC();
  const { t } = useLang();

  const [open,          setOpen]          = useState(false); // ← Keep closed by default
  const [vacation,      setVacation]      = useState<Vacation>("Jour");
  const [elStatus,      setElStatus]      = useState("future");
  const [displayStatus, setDisplayStatus] = useState("future");
  const [candidates,    setCandidates]    = useState<CandidateRecord[]>([]);
  const [allVotes,      setAllVotes]      = useState<VoteRecord[]>([]);
  const [totalEligible, setTotalEligible] = useState(1);
  const [loading,       setLoading]       = useState(false); // Start false, fetch on mount

  // Fetch on mount (when year/faculty/field change) AND when vacation changes
  // We fetch even when closed so the status pill shows correctly
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        // ── Elections: server-side filter by year + vacation, minimal columns ──
        // Use like on category to avoid fetching the whole table.
        // Category format: "faculty|field|year|vacation"
        // We filter by year and vacation server-side, then match faculty/field client-side
        // (needed because faculty name may vary e.g. "FDSE" vs "FDSE – Droit & Sciences Économiques")
        const { data: allElections } = await supabase!
          .from("civique_elections")
          .select("id, category, status, inscription_ends_at")
          .like("category", `%|${year}|${vacation}`);

        const matching = (allElections ?? []).filter(e => {
          const parts  = e.category.split("|");
          const eFac   = parts[0];
          const eField = parts[1];
          const eYear  = parseInt(parts[2], 10);
          const facMatch   = eFac === faculty || eFac.includes(faculty) || faculty.includes(eFac);
          const fieldMatch = eField === field;
          const yearMatch  = eYear === year;
          return facMatch && fieldMatch && yearMatch;
        });

        // Strict vacation match only — no fallback to other vacation
        const elData = matching.find(e => e.category.split("|")[3] === vacation) ?? null;

        if (!elData) {
          if (!cancelled) { 
            setElStatus("future"); 
            setDisplayStatus("future"); 
            setCandidates([]); 
            setAllVotes([]); 
            setTotalEligible(1); 
          }
          setLoading(false);
          return;
        }

        const inscClosed = elData.status === "inscription" && elData.inscription_ends_at
          ? new Date(elData.inscription_ends_at) <= new Date()
          : false;

        if (!cancelled) {
          setElStatus(elData.status);
          setDisplayStatus(inscClosed ? "inscription_closed" : elData.status);
        }

        // Only fetch candidates/votes if open OR if status is not future (so we have data ready)
        // But for status display, we already have elData.status

        // ── Candidates by election_id ──
        const { data: cData } = await supabase!
          .from("civique_candidates")
          .select("id, user_id, post_id, user_name, created_at")
          .eq("election_id", elData.id);

        if (!cancelled) setCandidates((cData ?? []).map(r => ({
          id:         r.id,
          userId:     r.user_id,
          postId:     r.post_id,
          userName:   r.user_name,
          userSexe:   "",
          electionId: elData.id,
          badge:      null,
          createdAt:  r.created_at,
        })));

        // ── All votes by election_id ──
        const { data: vData } = await supabase!
          .from("civique_votes")
          .select("candidate_id, post_id")
          .eq("election_id", elData.id);

        if (!cancelled) setAllVotes((vData ?? []).map(r => ({
          id:          "",
          voterId:     "",
          candidateId: r.candidate_id,
          postId:      r.post_id,
          electionId:  elData.id,
          createdAt:   "",
        })));

        // ── Eligible voters — use actual category parts from DB ──
        const [eFac, eField, , eVac] = elData.category.split("|");
        const { data: usersData } = await supabase!
          .from("civique_users")
          .select("id")
          .eq("faculty",  eFac)
          .eq("field",    eField)
          .eq("year",     year)
          .eq("vacation", vacation);

        if (!cancelled) setTotalEligible((usersData?.length ?? 0) || 1);

      } catch (err) {
        console.error("Error loading election data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, vacation, faculty, field, year]); // Fetch on mount and when vacation changes

  const isPast    = elStatus === "past";
  const isOngoing = elStatus === "ongoing";
  const dotColor  = STATUS_DOT[displayStatus] ?? "#B8B6AF";

  // ── Race rows — AllRaces logic copied verbatim from Race.tsx ──
  const raceRows = [...POSTS].sort((a, b) => b.importance - a.importance).map(post => {
    const postCands = candidates
      .filter(c => c.postId === post.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const postVotes  = allVotes.filter(v => v.postId === post.id);
    const totalVotes = postVotes.length;
    const slots = postCands.map((cand, i) => ({
      id:    cand.id,
      name:  cand.userName,
      votes: postVotes.filter(v => v.candidateId === cand.id).length,
      pct:   (postVotes.filter(v => v.candidateId === cand.id).length / totalEligible) * 100,
      color: candidateColor(i),
    }));
    const winner    = isPast ? resolveWinner(post.id, elStatus, candidates, allVotes, totalEligible) : null;
    const pcts      = slots.map(s => s.pct);
    const maxPct    = pcts.length > 1 ? Math.max(...pcts) : 0;
    const secondPct = pcts.length > 1 ? [...pcts].sort((a, b) => b - a)[1] : 0;
    const gap       = maxPct - secondPct;
    const isClose   = isOngoing && totalVotes > 0 && gap < 2;
    const isElected = isPast && !!winner;
    return { post, slots, totalVotes, winner, isClose, isElected };
  });

  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>

      {/* ── Header row ── */}
      <div style={{ display: "flex", alignItems: "center", padding: "11px 16px", gap: 10 }}>
        <div
          onClick={() => setOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0, display: "inline-block",
            background: dotColor,
            animation: isOngoing ? "dot 1.1s ease-in-out infinite" : "none",
          }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
            {year === 1 ? "1ère année" : `${year}ème année`}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", color: dotColor, textTransform: "uppercase" }}>
            {STATUS_TITLE[displayStatus]}
          </span>
        </div>

        {/* AM / PM pills + chevron */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {VACATIONS.map(v => {
            const isActive = v === vacation;
            return (
              <button key={v} onClick={e => { e.stopPropagation(); setVacation(v); }} style={{
                padding: "2px 9px", borderRadius: 99, fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                border: `1px solid ${isActive ? C.text : C.border}`,
                background: isActive ? C.text : "transparent",
                color: isActive ? C.surface : C.dim,
                cursor: "pointer", transition: "all .15s",
              }}>
                {v === "Jour" ? "AM" : "PM"}
              </button>
            );
          })}
          <span onClick={() => setOpen(o => !o)} style={{ color: C.dim, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
            <Chevron open={open} />
          </span>
        </div>
      </div>

      {/* ── Expanded content (only shown when chevron is clicked) ── */}
      {open && (
        <div style={{ padding: "0 16px 10px" }}>
          {loading ? (
            <div style={{ padding: "12px 0", textAlign: "center", color: C.dim, fontSize: 12 }}>Chargement…</div>
          ) : raceRows.length === 0 ? (
            <div style={{ padding: "12px 0", textAlign: "center", color: C.dim, fontSize: 12 }}>Aucune donnée disponible</div>
          ) : raceRows.map(({ post, slots, totalVotes, winner, isClose, isElected }, i) => {
            const hasVotes = totalVotes > 0;
            const displaySlots = slots.length === 0
              ? [{ id: "a", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(0) },
                 { id: "b", name: "Aucun candidat", votes: 0, pct: 0, color: candidateColor(1) }]
              : slots;
            return (
              <div key={post.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}`, padding: "12px 0 10px" }}>
                {/* Post label + badge */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{post.label}</div>
                  {isElected && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1px", border: `1px solid ${C.text}`, color: C.text, padding: "2px 6px", borderRadius: 3, flexShrink: 0, textTransform: "uppercase" }}>Résultat</div>}
                  {isClose   && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1px", background: C.gold, color: "#fff", padding: "2px 6px", borderRadius: 3, flexShrink: 0, textTransform: "uppercase" }}>{t("treemap.tooClose")}</div>}
                </div>
                {/* Candidates */}
                {displaySlots.map((s, ci) => {
                  const isWinner = !!(winner && s.id === winner.id);
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ci < displaySlots.length - 1 ? 5 : 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0, opacity: isWinner || !winner ? 1 : 0.35 }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? C.text : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>{s.name}</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: isWinner ? 600 : 400, color: isWinner ? s.color : C.sub, opacity: isWinner || !winner ? 1 : 0.5 }}>
                        {hasVotes ? `${s.pct.toFixed(1).replace(".", ",")} %` : "0,0 %"}
                      </span>
                    </div>
                  );
                })}
                {/* Bar */}
                <div style={{ marginTop: 8 }}>
                  <ConvergingBar slots={hasVotes
                    ? displaySlots.map(s => ({ pct: s.pct, color: isClose ? C.gold : s.color }))
                    : displaySlots.map(s => ({ pct: 0, color: s.color }))}
                  />
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
                  {isClose && <span style={{ fontSize: 10, color: C.gold, fontWeight: 600 }}>&lt; 2 % d&apos;écart</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export function FacultyOverview({ user }: { user: UserProfile }) {
  const C          = useC();
  const isRectorat = user.role === "Rectorat";

  // Tabs: for Décanat show fields of their faculty, for Rectorat show all faculties
  const tabs: string[] = isRectorat
    ? Object.keys(FIELD_YEARS).filter(k => !k.includes("–")) // dedupe long/short names
    : Object.keys(FIELD_YEARS[user.faculty] ?? FIELD_YEARS[Object.keys(FIELD_YEARS).find(k => k.includes(user.faculty.split(" ")[0])) ?? ""] ?? {});

  const [activeTab, setActiveTab] = useState(tabs[0] ?? "");

  if (tabs.length === 0) return null;

  const faculty  = isRectorat ? activeTab : user.faculty;
  const fieldMap = FIELD_YEARS[faculty] ?? FIELD_YEARS[Object.keys(FIELD_YEARS).find(k => k.includes(faculty.split(" ")[0])) ?? ""] ?? {};

  // Build year list: for Décanat, one field = activeTab; for Rectorat, all fields of that faculty
  const years: { year: number; field: string }[] = [];
  if (!isRectorat && fieldMap[activeTab]) {
    const meta = fieldMap[activeTab];
    for (let y = meta.min; y <= meta.max; y++) years.push({ year: y, field: activeTab });
  } else {
    for (const [f, meta] of Object.entries(fieldMap)) {
      for (let y = meta.min; y <= meta.max; y++) years.push({ year: y, field: f });
    }
  }

  return (
    <div style={{ background: C.surface }}>

      {/* Pill tab bar */}
      <div style={{
        display: "flex", gap: 6, overflowX: "auto", padding: "12px 16px 10px",
        borderBottom: `1px solid ${C.border}`,
        scrollbarWidth: "none", msOverflowStyle: "none",
        WebkitOverflowScrolling: "touch",
      }}>
        {tabs.map(tab => {
          const isActive = tab === activeTab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flexShrink: 0, padding: "5px 13px", borderRadius: 99,
              border: `1px solid ${isActive ? C.text : C.border}`,
              background: isActive ? C.text : "transparent",
              color: isActive ? C.surface : C.sub,
              fontSize: 12, fontWeight: isActive ? 600 : 400,
              cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap",
            }}>
              {tab}
            </button>
          );
        })}
      </div>

      {/* Year blocks */}
      <div style={{ paddingBottom: 64 }}>
        {years.map(({ year, field }) => (
          <YearBlock
            key={`${faculty}-${field}-${year}`}
            year={year}
            faculty={faculty}
            field={field}
          />
        ))}
      </div>
    </div>
  );
}