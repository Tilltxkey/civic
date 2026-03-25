/**
 * data.ts
 * ─────────────────────────────────────────────────────────────
 * All mock data for the election dashboard.
 * Replace these with real API calls when you have a backend.
 *
 * HOW TO CUSTOMIZE:
 *  - Add / remove departments in DEPTS.
 *  - Edit candidate names in CANDIDATES.
 *  - Edit ticker news items in NEWS.
 *  - Change the vote simulation speed in tickDepts / tickVotes.
 * ─────────────────────────────────────────────────────────────
 */

// ─── TYPES ───────────────────────────────────────────────────

/** One university department shown in the treemap */
export interface Dept {
  name:     string;  // Full French name
  abbr:     string;  // Short label shown inside the treemap cell
  students: number;  // Total enrolled students → controls cell width
  redPct:   number;  // % voting Rivera (0–100). Blue = 100 - redPct
  rep:      number;  // % of ballots counted so far (0–99). 0 = no results yet
}

/** The two candidates for the featured race */
export interface Candidate {
  name:  string;
  party: string;
  color: "red" | "blue";
}

/** One item in the scrolling news ticker */
export interface TickerItem {
  tag:  string | null;  // bold prefix label e.g. "TROP SERRÉ" — null for plain text
  msg:  string;         // the news text
}

// ─── CANDIDATES ──────────────────────────────────────────────

export const CANDIDATE_A: Candidate = {
  name:  "Alex Rivera",
  party: "Coalition Progrès",
  color: "red",
};

export const CANDIDATE_B: Candidate = {
  name:  "Priya Nair",
  party: "Étudiants d'Abord",
  color: "blue",
};

// ─── DEPARTMENTS ─────────────────────────────────────────────
// Ordered by students descending so the treemap looks natural.
// students → proportional cell width
// redPct   → how the cell splits red (top) vs blue (bottom)

export const DEPTS: Dept[] = [
  { name: "Génie",        abbr: "GÉN", students: 1800, redPct: 86, rep: 68 },
  { name: "Sciences",     abbr: "SCI", students: 1600, redPct: 55, rep: 75 },
  { name: "Commerce",     abbr: "COM", students: 1500, redPct: 47, rep: 91 },
  { name: "Médecine",     abbr: "MÉD", students: 1200, redPct: 51, rep: 44 },
  { name: "Sci. Soc.",    abbr: "SOC", students: 1100, redPct: 43, rep: 88 },
  { name: "Arts",         abbr: "ART", students:  900, redPct: 38, rep: 82 },
  { name: "Droit",        abbr: "DRT", students:  700, redPct: 50, rep: 37 },
  { name: "Architecture", abbr: "ARC", students:  500, redPct: 50, rep: 29 },
  { name: "Éducation",    abbr: "ÉDU", students:  400, redPct:  0, rep:  0 },
  // ↑ rep: 0 means no results yet — cell shows grey with "—"
];

// ─── TICKER NEWS ─────────────────────────────────────────────
// Add / remove / edit these to change what scrolls at top & bottom.

export const NEWS: TickerItem[] = [
  { tag: "URNES FERMÉES", msg: "Dépouillement en cours dans tous les départements" },
  { tag: null,            msg: "Génie : 68 % dépouillé · Rivera en tête avec 86 %" },
  { tag: "TROP SERRÉ",   msg: "Droit et Architecture encore indécis — moins de 1 % d'écart" },
  { tag: null,            msg: "Participation en hausse de 12 % par rapport à l'an dernier" },
  { tag: "L'AP PROJETTE", msg: "Jordan Kim remporte le VP des Affaires Étudiantes" },
  { tag: null,            msg: "Commerce : Nair en tête avec 53 % · 91 % dépouillé" },
];

// ─── ELECTION METADATA ───────────────────────────────────────

export const ELECTION = {
  title:       "ONGOING ELECTIONS 2026",
  institution: "FDSE",
  grade:    "3ème année",
  field: "Economiques",
  role:        "Président·e du Comité Éxécutif",
  toWin:       11400,   // votes needed to win — shown in the VS divider
  estimated:   22700,   // estimated total votes
};

// ─── INITIAL VOTE STATE ──────────────────────────────────────
// Starting values before the live simulation begins.

export const INITIAL_VOTES_A = 8421;
export const INITIAL_VOTES_B = 7679;
export const INITIAL_REPORTING = 71; // percent of ballots counted

// ─── SIMULATION ──────────────────────────────────────────────
// These functions fake "live" updates. Replace with fetch() calls
// once you have a real API.

/**
 * Simulate a new batch of votes coming in.
 * Called every 4 seconds by the page component.
 */
export function tickVotes(vA: number, vB: number): { vA: number; vB: number } {
  return {
    vA: vA + Math.floor(Math.random() * 80 + 25),  // ~25–105 new votes per tick
    vB: vB + Math.floor(Math.random() * 65 + 20),  // ~20–85 new votes per tick
  };
}

/**
 * Simulate reporting % ticking up and close races drifting.
 */
export function tickDepts(depts: Dept[]): Dept[] {
  return depts.map(d => {
    if (!d.rep) return d; // no-result dept stays frozen

    // Reporting % climbs slowly toward 99
    const rep = Math.min(99, +(d.rep + Math.random() * 0.8).toFixed(1));

    // Close races drift slightly to simulate tension
    let rp = d.redPct;
    if (Math.abs(rp - 50) < 5) {
      rp = Math.max(45, Math.min(55, rp + (Math.random() - 0.5) * 0.3));
    }

    return { ...d, rep, redPct: +rp.toFixed(1) };
  });
}

/**
 * Derive the status of a department for coloring.
 *  "none"  → no results yet (grey)
 *  "close" → within 1.5% (gold)
 *  "red"   → Rivera leading (red)
 *  "blue"  → Nair leading (blue)
 */
export function deptStatus(d: Dept): "red" | "blue" | "close" | "none" {
  if (d.rep === 0) return "none";
  if (Math.abs(d.redPct - 50) < 1.5) return "close";
  return d.redPct > 50 ? "red" : "blue";
}

// ─── ALL RACES ───────────────────────────────────────────────

export interface RaceCandidate {
  name:  string;
  color: "red" | "blue";
  pct:   number;
  votes: number;
}

export interface AnyRace {
  id:         string;
  role:       string;
  importance: number;          // 1 = highest (Président), ascending
  candidates: [RaceCandidate, RaceCandidate];
  reporting:  number;
  status:     "call" | "close" | "watch" | null;
  winner:     string | null;
  hasDepts:   boolean;         // true = show treemap when this is main race
}

export const ALL_RACES: AnyRace[] = [
  {
    id: "president",
    role: "Président·e du Comité Éxécutif",
    importance: 1,
    candidates: [
      { name: "Alex Rivera", color: "red",  pct: 52.3, votes: 8421 },
      { name: "Priya Nair",  color: "blue", pct: 47.7, votes: 7679 },
    ],
    reporting: 71,
    status: null,
    winner: null,
    hasDepts: true,
  },
  {
    id: "vp",
    role: "VP Affaires Étudiantes",
    importance: 2,
    candidates: [
      { name: "Jordan Kim", color: "red",  pct: 61.2, votes: 5540 },
      { name: "Okafor",     color: "blue", pct: 38.8, votes: 3510 },
    ],
    reporting: 89,
    status: "call",
    winner: "Jordan Kim",
    hasDepts: true,
  },
  {
    id: "senat",
    role: "Sénat Académique",
    importance: 3,
    candidates: [
      { name: "Torres",  color: "red",  pct: 43.3, votes: 3820 },
      { name: "Bianchi", color: "blue", pct: 56.7, votes: 5010 },
    ],
    reporting: 95,
    status: "call",
    winner: "Bianchi",
    hasDepts: true,
  },
  {
    id: "logement",
    role: "Représentant·e Logement",
    importance: 4,
    candidates: [
      { name: "Sharma", color: "red",  pct: 49.1, votes: 2140 },
      { name: "Roy",    color: "blue", pct: 50.9, votes: 2220 },
    ],
    reporting: 54,
    status: "close",
    winner: null,
    hasDepts: true,
  },
  {
    id: "sport",
    role: "Délégué·e Sportif·ve",
    importance: 5,
    candidates: [
      { name: "Mbaye",   color: "red",  pct: 52.4, votes: 1860 },
      { name: "Leconte", color: "blue", pct: 47.6, votes: 1690 },
    ],
    reporting: 38,
    status: "watch",
    winner: null,
    hasDepts: true,
  },
];