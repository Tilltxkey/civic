/**
 * Race.tsx
 * ─────────────────────────────────────────────────────────────
 * The main featured race section showing:
 *  - Role title ("Président·e du Conseil Étudiant")
 *  - Two candidate cards side by side (photo placeholder, name,
 *    party, live percentage, vote count)
 *  - AP-style split race bar with 50% center pin
 *  - Reporting progress strip
 *
 * HOW TO CUSTOMIZE:
 *  - Change candidate names/parties → edit CANDIDATE_A / B in data.ts.
 *  - Add a real photo → replace the <svg> in CandidateCard with
 *    an <img src="..." /> using Next.js <Image> component.
 *  - Change the role label → edit ELECTION.role in data.ts.
 *  - Change "to win" threshold → edit ELECTION.toWin in data.ts.
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { useState, useEffect } from "react";
import { useC } from "./tokens";
import { ELECTION, CANDIDATE_A, CANDIDATE_B, ALL_RACES } from "./data";
import { useLang } from "./LangContext";
import { n2fr, p2fr } from "./helpers";

interface RaceProps {
  votesA:         number;
  votesB:         number;
  reporting:      number;
  selectedRaceId: string;
}

// ─── CANDIDATE CARD ──────────────────────────────────────────

interface CardProps {
  name:  string;
  party: string;
  color: string;
  bg:    string;
  pct:   number;
  votes: number;
}

function CandidateCard({ name, party, color, bg, pct, votes }: CardProps) {
  const C = useC();
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      borderRadius: 1,
      padding: "7px 6px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 5,
      textAlign: "center",
    }}>

      {/* Photo placeholder — replace with <img> when you have photos */}
      <div style={{
        width: 110,
        height: 100,
        borderRadius: 14,
        border: `1px solid ${color}33`,
        background: `${color}18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8.5" r="3.5" fill={color} opacity=".4" />
          <path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5" fill={color} opacity=".3" />
        </svg>
      </div>

      {/* Name + party stacked under photo */}
      <div style={{ minWidth: 0, width: "100%" }}>
        <div style={{ fontWeight: 600, fontSize: 16, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </div>
        {/*<div style={{ fontSize: 9, color: C.sub, marginTop: 2 }}>{party}</div>*/}
      </div>


    </div>
  );
}

// ─── MAIN RACE COMPONENT ─────────────────────────────────────

export default function Race({ votesA, votesB, reporting, selectedRaceId }: RaceProps) {
  const C = useC();
  const { t } = useLang();
  const race = ALL_RACES.find(r => r.id === selectedRaceId) ?? ALL_RACES[0];
  const [cA, cB] = race.candidates;
  const isPresident = selectedRaceId === "president";
  const liveVotesA  = isPresident ? votesA : cA.votes;
  const liveVotesB  = isPresident ? votesB : cB.votes;
  const liveRep     = isPresident ? reporting : race.reporting;
  const total = liveVotesA + liveVotesB;
  const pA = total > 0 ? (liveVotesA / total) * 100 : cA.pct;
  const pB = 100 - pA;

  return (
    <div style={{
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      padding: "16px 16px 14px",
    }}>

      {/* ── Role title + countdown on same line ── */}
      <div style={{ marginBottom: 14 }}>

        {/* Title row — role label left, countdown pill right */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0px 0px 0px",
        }}>
          <div style={{
            fontWeight: 600,
            fontSize: "clamp(15px, 3vw, 19px)",
            color: C.text,
            letterSpacing: "-.3px",
            lineHeight: 1.15,
            flex: 1,
            marginBottom: -15,
            minWidth: 0,
          }}>
            {race.role}
          </div>

          {/* Countdown as a modern pill */}
          
          <div style={{ marginTop: 10, filter: "drop-shadow(0px 4px 12px rgba(0,0,0,0.15))" }}>
            <Countdown totalMinutes={300} />
          </div>

        </div>

        {/* Status label */}
        <div style={{ fontSize: 10, color: C.sub, marginBottom: 20, marginTop: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {t("race.noWinner")}
        </div>
      </div>

      {/* ── Candidate cards ───────────────── */}
      <div style={{ display: "flex", gap: 6 }}>

        <CandidateCard
          name={cA.name}
          party={""}
          color={cA.color === "red" ? C.red : C.blue}
          bg={cA.color === "red" ? C.redBg : C.blueBg}
          pct={pA}
          votes={liveVotesA}
        />

        {/* VS divider */}
        <div style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          fontSize: 10,
          color: C.dim,
          fontWeight: 500,
          letterSpacing: "1px",
        }}>
          VS
        </div>

        <CandidateCard
          name={cB.name}
          party={""}
          color={cB.color === "blue" ? C.blue : C.red}
          bg={cB.color === "blue" ? C.blueBg : C.redBg}
          pct={pB}
          votes={liveVotesB}
        />

      </div>

      {/* ── AP-style race bar ─────────────── */}
      <div style={{ marginTop: 5 }}>

        {/* The bar itself */}
        <div style={{
          height: 7,
          background: C.dim,
          borderRadius: 99,
          overflow: "hidden",
          position: "relative",
        }}>
          {/* Red fills from the left — rounded left, flat right */}
          <div style={{
            position: "absolute", left: 0, top: 0,
            height: "100%",
            width: `${pA}%`,
            background: cA.color === "red" ? C.red : C.blue,
            borderRadius: "99px 0 0 99px",
            transition: "width 1.4s cubic-bezier(.4,0,.2,1)",
          }} />
          {/* Blue fills from the right — flat left, rounded right */}
          <div style={{
            position: "absolute", right: 0, top: 0,
            height: "100%",
            width: `${pB}%`,
            background: cB.color === "blue" ? C.blue : C.red,
            borderRadius: "0 99px 99px 0",
            transition: "width 1.4s cubic-bezier(.4,0,.2,1)",
          }} />
          {/* Center pin — marks the 50% majority line */}
          <div style={{
            position: "absolute",
            left: "calc(50% - 1px)",
            top: "50%",
            transform: "translateY(-50%)",
            width: 4,
            height: 14,
            background: C.bg,
            borderRadius: 2,
            zIndex: 4,
          }} />
        </div>

        {/* Labels under bar */}
<div style={{
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "start",
  gap: 6,
  marginTop: 6,
}}>
  {/* Red votes — always left */}
  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: cA.color === "red" ? C.red : C.blue, fontWeight: 500 }}>
    {n2fr(liveVotesA)} votes ({p2fr(pA)})
  </span>

  {/* Center label — always center */}
  <span style={{ color: C.dim, fontSize: 10, textAlign: "center", whiteSpace: "nowrap" }}>
    50 % pour gagner
  </span>

  {/* Blue votes — always right */}
  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: cB.color === "blue" ? C.blue : C.red, fontWeight: 500, textAlign: "right" }}>
    {n2fr(liveVotesB)} votes ({p2fr(pB)})
  </span>
</div>
      </div>

      
    </div>
  );
}

// ─── COUNTDOWN TIMER ─────────────────────────────────────────
// Displayed as a rounded pill next to the race title.
// Counts down from totalMinutes to zero, then shows "Terminé".

function Countdown({ totalMinutes }: { totalMinutes: number }) {
  const C = useC();
  const { t } = useLang();
  const [secondsLeft, setSecondsLeft] = useState(() => totalMinutes * 60);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const done = secondsLeft === 0;
  const h   = Math.floor(secondsLeft / 3600);
  const m   = Math.floor((secondsLeft % 3600) / 60);
  const s   = secondsLeft % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      background: done ? C.goldBg : C.surface,
      border: `1px solid ${done ? C.gold : C.border2}`,
      borderRadius: 99,
      padding: "5px 14px",
      flexShrink: 0,
      transition: "border-color .4s, background .4s",
    }}>
      <div style={{
        fontFamily: "var(--f-mono)",
        fontSize: 13,
        fontWeight: 500,
        color: done ? C.gold : C.text,
        letterSpacing: "1.5px",
        lineHeight: 1,
        transition: "color .4s",
      }}>
        {done ? "Terminé" : `${pad(h)}:${pad(m)}:${pad(s)}`}
      </div>
      <div style={{
        fontSize: 8,
        color: done ? C.gold : C.sub,
        letterSpacing: ".5px",
        lineHeight: 1,
        textTransform: "uppercase",
      }}>
        {done ? t("race.done") : t("race.timeLeft")}
      </div>
    </div>
  );
}