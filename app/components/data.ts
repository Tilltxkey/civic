/**
 * data.ts
 * ─────────────────────────────────────────────────────────────
 * Static structure / metadata for the election dashboard.
 * All vote counts, percentages and candidate names are now
 * driven by real DB data via ElectionContext.
 * ─────────────────────────────────────────────────────────────
 */

// ─── TYPES ───────────────────────────────────────────────────

/** One university department shown in the treemap (pre-election view) */
export interface Dept {
  name:     string;
  abbr:     string;
  students: number;  // population → controls cell size
  redPct:   number;  // always 0 until real data flows in
  rep:      number;  // always 0 until real data flows in
}

/** The two candidates for the featured race */
export interface Candidate {
  name:  string;
  party: string;
  color: "red" | "blue";
}

/** One item in the scrolling news ticker */
export interface TickerItem {
  tag:  string | null;
  msg:  string;
}

// ─── DEFAULT CANDIDATES ──────────────────────────────────────
// Shown before any candidacy is submitted.

export const CANDIDATE_A: Candidate = {
  name:  "Aucun candidat",
  party: "",
  color: "red",
};

export const CANDIDATE_B: Candidate = {
  name:  "Aucun candidat",
  party: "",
  color: "blue",
};

// ─── DEPARTMENTS ─────────────────────────────────────────────
// Population sizes only — redPct and rep start at 0.
// During live elections the treemap switches to sex-based groups
// driven by real DB data, so these values are only used pre-election.

export const DEPTS: Dept[] = [
  { name: "Génie",        abbr: "GÉN", students: 1800, redPct: 0, rep: 0 },
  { name: "Sciences",     abbr: "SCI", students: 1600, redPct: 0, rep: 0 },
  { name: "Commerce",     abbr: "COM", students: 1500, redPct: 0, rep: 0 },
  { name: "Médecine",     abbr: "MÉD", students: 1200, redPct: 0, rep: 0 },
  { name: "Sci. Soc.",    abbr: "SOC", students: 1100, redPct: 0, rep: 0 },
  { name: "Arts",         abbr: "ART", students:  900, redPct: 0, rep: 0 },
  { name: "Droit",        abbr: "DRT", students:  700, redPct: 0, rep: 0 },
  { name: "Architecture", abbr: "ARC", students:  500, redPct: 0, rep: 0 },
  { name: "Éducation",    abbr: "ÉDU", students:  400, redPct: 0, rep: 0 },
];

// ─── TICKER NEWS ─────────────────────────────────────────────

export const NEWS: TickerItem[] = [
  { tag: "CIVIQUE", msg: "Plateforme électorale de votre faculté" },
  { tag: null,      msg: "Les résultats s'affichent en temps réel dès l'ouverture du scrutin" },
  { tag: "INFO",    msg: "Connectez-vous pour voter ou déposer votre candidature" },
];

// ─── ELECTION METADATA ───────────────────────────────────────

export const ELECTION = {
  title:       "ÉLECTIONS EN COURS",
  institution: "FDSE",
  grade:       "3ème année",
  field:       "Économiques",
  role:        "Président·e du Comité Exécutif",
  toWin:       0,
  estimated:   0,
};

// ─── INITIAL VOTE STATE ──────────────────────────────────────
// All zeros — real counts come from civique_votes via ElectionContext.

export const INITIAL_VOTES_A  = 0;
export const INITIAL_VOTES_B  = 0;
export const INITIAL_REPORTING = 0;

// ─── DEPT STATUS HELPER ──────────────────────────────────────
// Used only in pre-election treemap (all cells will show "none").

export function deptStatus(d: Dept): "red" | "blue" | "close" | "none" {
  if (d.rep === 0) return "none";
  if (Math.abs(d.redPct - 50) < 1.5) return "close";
  return d.redPct > 50 ? "red" : "blue";
}

// ─── ALL RACES ───────────────────────────────────────────────
// These define the POST structure (role labels + importance order).
// Candidate names, vote counts and percentages are all 0/placeholder
// and get replaced by real DB data in ElectionContext.

export interface RaceCandidate {
  name:  string;
  color: "red" | "blue";
  pct:   number;
  votes: number;
}

export interface AnyRace {
  id:         string;
  role:       string;
  importance: number;
  candidates: [RaceCandidate, RaceCandidate];
  reporting:  number;
  status:     "call" | "close" | "watch" | null;
  winner:     string | null;
  hasDepts:   boolean;
}

export const ALL_RACES: AnyRace[] = [
  {
    id: "president",
    role: "Président·e du Comité Exécutif",
    importance: 1,
    candidates: [
      { name: "Aucun candidat", color: "red",  pct: 0, votes: 0 },
      { name: "Aucun candidat", color: "blue", pct: 0, votes: 0 },
    ],
    reporting: 0, status: null, winner: null, hasDepts: true,
  },
  {
    id: "secretaire",
    role: "Secrétaire",
    importance: 2,
    candidates: [
      { name: "Aucun candidat", color: "red",  pct: 0, votes: 0 },
      { name: "Aucun candidat", color: "blue", pct: 0, votes: 0 },
    ],
    reporting: 0, status: null, winner: null, hasDepts: true,
  },
  {
    id: "tresorier",
    role: "Trésorier·e",
    importance: 3,
    candidates: [
      { name: "Aucun candidat", color: "red",  pct: 0, votes: 0 },
      { name: "Aucun candidat", color: "blue", pct: 0, votes: 0 },
    ],
    reporting: 0, status: null, winner: null, hasDepts: true,
  },
  {
    id: "delegue",
    role: "Délégué·e",
    importance: 4,
    candidates: [
      { name: "Aucun candidat", color: "red",  pct: 0, votes: 0 },
      { name: "Aucun candidat", color: "blue", pct: 0, votes: 0 },
    ],
    reporting: 0, status: null, winner: null, hasDepts: true,
  },
  {
    id: "raa",
    role: "Responsable Affaires Académiques",
    importance: 5,
    candidates: [
      { name: "Aucun candidat", color: "red",  pct: 0, votes: 0 },
      { name: "Aucun candidat", color: "blue", pct: 0, votes: 0 },
    ],
    reporting: 0, status: null, winner: null, hasDepts: true,
  },
];