/**
 * ElectionContext.tsx
 * ─────────────────────────────────────────────────────────────
 * Central state machine for the CEP-managed election flow.
 *
 * Election lifecycle per category (faculty+field+year+vacation):
 *   future → inscription → ongoing → past
 *
 * Consumed by:
 *   - Header.tsx        (status badge)
 *   - Treemap.tsx       (voter button logic)
 *   - Race.tsx          (live countdown driven by DB timer)
 *   - page.tsx          (provider wrapper)
 * ─────────────────────────────────────────────────────────────
 */
import {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, ReactNode,
} from "react";
import { supabase, DB_READY } from "./supabase";
import type { UserProfile } from "./AuthFlow";
// ─── TYPES ───────────────────────────────────────────────────
export type ElectionStatus = "future" | "inscription" | "ongoing" | "past";
export type ElectionMode   = "ensemble" | "sequentiel";
export const POSTS = [
  { id: "raa",         label: "Responsable Affaires Académiques",  importance: 1 },
  { id: "delegue",     label: "Délégué·e",                        importance: 2 },
  { id: "tresorier",   label: "Trésorier·e",                      importance: 3 },
  { id: "secretaire",  label: "Secrétaire",                       importance: 4 },
  { id: "president",   label: "Président·e du Comité Exécutif",  importance: 5 },
] as const;
export type PostId = typeof POSTS[number]["id"];
export interface PostTimer {
  postId:       PostId;
  durationSecs: number;   // total seconds for this post's vote
  endsAt:       string | null;  // ISO timestamp, set when election goes live
}
export interface CandidateRecord {
  id:          string;
  userId:      string;
  postId:      PostId;
  userName:    string;   // nom + prenom
  userSexe:    string;   // 'M' | 'F'
  electionId:  string;
  badge:       "gold" | null;
  createdAt:   string;
}
export interface VoteRecord {
  id:          string;
  voterId:     string;
  candidateId: string;
  postId:      PostId;
  electionId:  string;
  createdAt:   string;
}
export interface ElectionRecord {
  id:            string;
  category:      string;  // "faculty|field|year|vacation"
  status:        ElectionStatus;
  mode:          ElectionMode | null;
  activePostId:  PostId | null;   // which post is currently being voted on
  openPosts:     PostId[];        // posts open for candidature / voting
  timers:        PostTimer[];
  createdAt:     string;
  updatedAt:     string;
}
interface ElectionCtx {
  election:         ElectionRecord | null;
  candidates:       CandidateRecord[];
  myVotes:          VoteRecord[];       // votes cast by current user
  allVotes:         VoteRecord[];       // ALL votes for the election (for real counts)
  categorySexCounts: { M: number; F: number }; // how many M/F users in this category
  isCEP:            boolean;
  loading:          boolean;
  // Actions
  launchInscription:  (posts: PostId[]) => Promise<void>;
  launchElection:     (posts: PostId[], mode: ElectionMode, timers: PostTimer[]) => Promise<void>;
  submitCandidacy:    (postId: PostId, user: UserProfile) => Promise<{ error: string | null }>;
  castVote:           (candidateId: string, postId: PostId, user: UserProfile) => Promise<{ error: string | null }>;
  resetElection:      () => Promise<void>;
  refreshElection:    () => Promise<void>;
  // Derived helpers
  categoryOf:         (u: UserProfile) => string;
  candidatesForPost:  (postId: PostId) => CandidateRecord[];
  votesForPost:       (postId: PostId) => VoteRecord[];
  winnerOfPost:       (postId: PostId) => CandidateRecord | null;
  secondsLeft:        (postId: PostId) => number;
}
// ─── HELPERS ────────────────────────────────────────────────
export function categoryOf(u: UserProfile): string {
  return `${u.faculty}|${u.field}|${u.year}|${u.vacation}`;
}
export function isCEPRole(role: string): boolean {
  return role === "CEP — Responsable désigné·e";
}
function makeId(): string {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}
// ─── CONTEXT ────────────────────────────────────────────────
const Ctx = createContext<ElectionCtx>({
  election: null, candidates: [], myVotes: [], allVotes: [], categorySexCounts: { M: 0, F: 0 }, isCEP: false, loading: true,
  launchInscription: async () => {},
  launchElection:    async () => {},
  submitCandidacy:   async () => ({ error: null }),
  castVote:          async () => ({ error: null }),
  resetElection:     async () => {},
  refreshElection:   async () => {},
  categoryOf,
  candidatesForPost: () => [],
  votesForPost:      () => [],
  winnerOfPost:      () => null,
  secondsLeft:       () => 0,
});
// ─── PROVIDER ────────────────────────────────────────────────
export function ElectionProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: UserProfile | null;
}) {
  const [election,   setElection]   = useState<ElectionRecord | null>(null);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [myVotes,    setMyVotes]    = useState<VoteRecord[]>([]);
  const [allVotes,   setAllVotes]   = useState<VoteRecord[]>([]);
  const [categorySexCounts, setCategorySexCounts] = useState<{ M: number; F: number }>({ M: 0, F: 0 });
  const [loading,    setLoading]    = useState(true);
  const category = user ? categoryOf(user) : null;
  const isCEP    = user ? isCEPRole(user.role) : false;
  // ── Fetch election for user's category ─────────────────────
  const fetchElection = useCallback(async () => {
    if (!category || !DB_READY || !supabase) { setLoading(false); return; }
    const { data: elData } = await supabase
      .from("civique_elections")
      .select("*")
      .eq("category", category)
      .maybeSingle();
    if (elData) {
      const rec: ElectionRecord = {
        id:           elData.id,
        category:     elData.category,
        status:       elData.status,
        mode:         elData.mode,
        activePostId: elData.active_post_id,
        openPosts:    elData.open_posts ?? [],
        timers:       elData.timers ?? [],
        createdAt:    elData.created_at,
        updatedAt:    elData.updated_at,
      };
      setElection(rec);
      // Fetch candidates for this election
      const { data: cData } = await supabase
        .from("civique_candidates")
        .select("*")
        .eq("election_id", elData.id);
      setCandidates((cData ?? []).map(r => ({
        id:         r.id,
        userId:     r.user_id,
        postId:     r.post_id,
        userName:   r.user_name,
        userSexe:   r.user_sexe,
        electionId: r.election_id,
        badge:      r.badge,
        createdAt:  r.created_at,
      })));
      // Fetch current user's votes
      if (user) {
        const { data: vData } = await supabase
          .from("civique_votes")
          .select("*")
          .eq("election_id", elData.id)
          .eq("voter_id", user.id);
        setMyVotes((vData ?? []).map(r => ({
          id:          r.id,
          voterId:     r.voter_id,
          candidateId: r.candidate_id,
          postId:      r.post_id,
          electionId:  r.election_id,
          createdAt:   r.created_at,
        })));
      }
      // Fetch ALL votes for this election (for real vote counts in treemap + race bar)
      const { data: allVData } = await supabase
        .from("civique_votes")
        .select("*")
        .eq("election_id", elData.id);
      setAllVotes((allVData ?? []).map(r => ({
        id:          r.id,
        voterId:     r.voter_id,
        candidateId: r.candidate_id,
        postId:      r.post_id,
        electionId:  r.election_id,
        createdAt:   r.created_at,
      })));
      // Fetch sex counts for the category from civique_users
      // Split the category string: "faculty|field|year|vacation"
      const [fac, fld, yr, vac] = elData.category.split("|");
      const { data: usersData } = await supabase
        .from("civique_users")
        .select("sexe")
        .eq("faculty", fac)
        .eq("field",   fld)
        .eq("year",    parseInt(yr, 10))
        .eq("vacation", vac);
      const sexCounts = { M: 0, F: 0 };
      for (const u of usersData ?? []) {
        if (u.sexe === "F") sexCounts.F++;
        else sexCounts.M++;
      }
      setCategorySexCounts(sexCounts);
    } else {
      setElection(null);
      setCandidates([]);
      setMyVotes([]);
    }
    setLoading(false);
  }, [category, user]);
  useEffect(() => { fetchElection(); }, [fetchElection]);
  // ── Realtime subscription on election row ───────────────────
  // We do NOT use a row-level filter on civique_elections because the
  // category value contains "|" which breaks Supabase realtime filter syntax.
  // Instead subscribe to ALL changes and filter locally — guarantees instant
  // propagation to every client in the same category when CEP changes status.
  useEffect(() => {
    if (!category || !DB_READY || !supabase) return;
    const chName = "civique_election_rt_" + category.replace(/[^a-zA-Z0-9]/g, "_");
    const ch = supabase
      .channel(chName)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "civique_elections",
      }, (payload: any) => {
        const row = (payload.new ?? payload.old) as { category?: string } | null;
        if (!row?.category || row.category === category) {
          fetchElection();
        }
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "civique_candidates",
      }, () => { fetchElection(); })
      .subscribe();
    // Polling fallback every 10s — catches any missed realtime push
    const pollId = setInterval(() => { fetchElection(); }, 10_000);
    return () => {
      supabase!.removeChannel(ch);
      clearInterval(pollId);
    };
  }, [category, fetchElection]);
  // ── Auto-advance sequentiel mode ────────────────────────────
  // Refs always hold the latest value — safe to read inside long-lived intervals
  const electionRef       = useRef(election);
  const candidatesRef     = useRef(candidates);
  const isCEPRef          = useRef(isCEP);
  const fetchElectionRef  = useRef(fetchElection);
  useEffect(() => { electionRef.current      = election;       }, [election]);
  useEffect(() => { candidatesRef.current    = candidates;     }, [candidates]);
  useEffect(() => { isCEPRef.current         = isCEP;          }, [isCEP]);
  useEffect(() => { fetchElectionRef.current = fetchElection;  }, [fetchElection]);

  // ── Auto-advance: single interval, never recreated ────────────
  // Uses refs so the closure is always fresh. No stale state issues.
  const advancingRef = useRef(false); // prevent concurrent writes
  useEffect(() => {
    if (!DB_READY || !supabase) return;
    const iv = setInterval(async () => {
      const el = electionRef.current;
      if (!el || el.status !== "ongoing") return;
      if (advancingRef.current) return;

      const now = Date.now();

      if (el.mode === "sequentiel") {
        // ── Sequential: check the active post's timer ──────────
        const activeTimer = el.timers.find(t => t.postId === el.activePostId);
        // If there's no active post or its timer hasn't been set yet, skip
        if (!activeTimer?.endsAt) return;
        const secsLeft = Math.floor((new Date(activeTimer.endsAt).getTime() - now) / 1000);
        if (secsLeft > 0) return;

        advancingRef.current = true;
        try {
          const sortedPosts = POSTS
            .filter(p => el.openPosts.includes(p.id))
            .sort((a, b) => a.importance - b.importance);
          const currentIdx = sortedPosts.findIndex(p => p.id === el.activePostId);
          let nextPost = null;
          for (let i = currentIdx + 1; i < sortedPosts.length; i++) {
            if (candidatesRef.current.some(c => c.postId === sortedPosts[i].id)) {
              nextPost = sortedPosts[i]; break;
            }
          }
          if (nextPost) {
            const nextTimer = el.timers.find(t => t.postId === nextPost!.id);
            const newEndsAt = new Date(now + (nextTimer?.durationSecs ?? 3600) * 1000).toISOString();
            await supabase!.from("civique_elections").update({
              active_post_id: nextPost.id,
              timers: el.timers.map(t => t.postId === nextPost!.id ? { ...t, endsAt: newEndsAt } : t),
              updated_at: new Date().toISOString(),
            }).eq("id", el.id);
          } else {
            // No more posts — end the election
            await endElection(el);
          }
          await fetchElectionRef.current();
        } finally {
          setTimeout(() => { advancingRef.current = false; }, 4000);
        }
      } else {
        // ── Ensemble: check whether ALL open-post timers have expired ──
        // This path does NOT rely on activePostId (which is null in ensemble mode).
        const openTimers = el.timers.filter(t => el.openPosts.includes(t.postId));
        if (openTimers.length === 0) return; // timers not set yet

        // At least one timer must have an endsAt (safety-guard against partially saved state)
        const anyTimerSet = openTimers.some(t => !!t.endsAt);
        if (!anyTimerSet) return;

        const allExpired = openTimers.every(
          t => t.endsAt && new Date(t.endsAt).getTime() <= now
        );
        if (!allExpired) return;

        advancingRef.current = true;
        try {
          await endElection(el);
          await fetchElectionRef.current();
        } finally {
          setTimeout(() => { advancingRef.current = false; }, 4000);
        }
      }
    }, 3000);
    return () => clearInterval(iv);
  }, []); // stable — reads all live state via refs; no deps needed
  // ── End election + remove loser badges ──────────────────────
  const endElection = async (el: ElectionRecord) => {
    if (!DB_READY || !supabase) return;
    const fetch = fetchElectionRef.current;
    // Mark election as past
    const { error: updateErr } = await supabase
      .from("civique_elections")
      .update({ status: "past", updated_at: new Date().toISOString() })
      .eq("id", el.id);
    // Immediately re-fetch so local state reflects the new status
    if (!updateErr) await fetch();
    // Remove gold badge from losing candidates
    // Winners keep their badge; losers have it revoked
    const { data: voteData } = await supabase
      .from("civique_votes")
      .select("candidate_id, post_id")
      .eq("election_id", el.id);
    if (!voteData) return;
    // Count votes per candidate
    const voteCounts: Record<string, number> = {};
    for (const v of voteData) {
      voteCounts[v.candidate_id] = (voteCounts[v.candidate_id] ?? 0) + 1;
    }
    // For each post, find winner and revoke losers' badges
    const { data: candData } = await supabase
      .from("civique_candidates")
      .select("*")
      .eq("election_id", el.id);
    if (!candData) return;
    for (const post of POSTS) {
      const postCands = candData.filter(c => c.post_id === post.id);
      if (postCands.length === 0) continue;
      const totalPostVotes = postCands.reduce((s, c) => s + (voteCounts[c.id] ?? 0), 0);
      const topCand = postCands.reduce((best, c) =>
        (voteCounts[c.id] ?? 0) > (voteCounts[best.id] ?? 0) ? c : best
      );
      const topVotes = voteCounts[topCand.id] ?? 0;
      // Must win strictly more than 50% of total votes cast (majority rule).
      // If totalPostVotes = 0, no one wins. Single candidate needs >50% too.
      const hasWon = totalPostVotes > 0 && topVotes > totalPostVotes / 2;
      // Revoke badges for losers (and for the top candidate if they didn't reach majority)
      const losers = hasWon
        ? postCands.filter(c => c.id !== topCand.id)
        : postCands; // everyone loses if no majority
      for (const loser of losers) {
        await supabase
          .from("civique_users")
          .update({ badge: null })
          .eq("id", loser.user_id);
        await supabase
          .from("civique_candidates")
          .update({ badge: null })
          .eq("id", loser.id);
      }
    }
  };
  // ── CEP ACTION: Launch inscription phase ────────────────────
  const launchInscription = useCallback(async (posts: PostId[]) => {
    if (!category || !DB_READY || !supabase || !user) return;
    const existing = election;
    if (existing) {
      await supabase
        .from("civique_elections")
        .update({
          status:      "inscription",
          open_posts:  posts,
          updated_at:  new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      const id = makeId();
      await supabase.from("civique_elections").insert({
        id,
        category,
        status:          "inscription",
        mode:            null,
        active_post_id:  null,
        open_posts:      posts,
        timers:          [],
        created_at:      new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      });
    }
    await fetchElection();
  }, [category, election, user, fetchElection]);
  // ── CEP ACTION: Launch elections ────────────────────────────
  const launchElection = useCallback(async (
    posts: PostId[],
    mode: ElectionMode,
    timers: PostTimer[],
  ) => {
    if (!election || !DB_READY || !supabase) return;
    const now = Date.now();
    let timersFinal: PostTimer[];
    const sorted = POSTS.filter(p => posts.includes(p.id)).sort((a, b) => a.importance - b.importance);
    if (mode === "ensemble") {
      timersFinal = timers.map(t => ({
        ...t,
        endsAt: new Date(now + t.durationSecs * 1000).toISOString(),
      }));
    } else {
      // Sequential: only first post with candidates gets endsAt; others get null
      const firstWithCands = sorted.find(p => candidates.some(c => c.postId === p.id)) ?? sorted[0];
      timersFinal = timers.map(t => ({
        ...t,
        endsAt: t.postId === firstWithCands?.id
          ? new Date(now + t.durationSecs * 1000).toISOString()
          : null,
      }));
    }
    const firstPost = mode === "sequentiel"
      ? (sorted.find(p => candidates.some(c => c.postId === p.id))?.id ?? sorted[0]?.id ?? null)
      : null;
    await supabase
      .from("civique_elections")
      .update({
        status:         "ongoing",
        mode,
        open_posts:     posts,
        timers:         timersFinal,
        active_post_id: firstPost,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", election.id);
    await fetchElection();
  }, [election, candidates, fetchElection]);
  // ── VOTER ACTION: Submit candidacy ───────────────────────────
  const submitCandidacy = useCallback(async (
    postId: PostId,
    u: UserProfile,
  ): Promise<{ error: string | null }> => {
    if (!election || !DB_READY || !supabase) return { error: "no_election" };
    if (isCEPRole(u.role)) return { error: "cep_cannot_candidate" };
    // Check not already a candidate for this post
    const existing = candidates.find(c => c.userId === u.id && c.postId === postId);
    if (existing) return { error: "already_candidate" };
    const id = makeId();
    const { error } = await supabase.from("civique_candidates").insert({
      id,
      election_id: election.id,
      user_id:     u.id,
      post_id:     postId,
      user_name:   `${u.prenom} ${u.nom}`,
      user_sexe:   u.sexe,
      badge:       "gold",
      created_at:  new Date().toISOString(),
    });
    if (error) return { error: error.message };
    // Grant gold badge to the user
    await supabase
      .from("civique_users")
      .update({ badge: "gold" })
      .eq("id", u.id);
    // TODO: Send push notification to all category members
    // Once push notifications are implemented, call:
    // await notifyCategory(election.category, {
    //   title: "Nouveau candidat",
    //   body: `${u.prenom} ${u.nom} s'est candidaté·e pour le poste de ${POSTS.find(p => p.id === postId)?.label}`,
    // });
    await fetchElection();
    return { error: null };
  }, [election, candidates, fetchElection]);
  // ── CEP ACTION: Reset election for a new cycle ──────────────
  // Resets the election row to "future" and clears all candidates + votes
  // so the CEP can immediately start a new inscription phase.
  const resetElection = useCallback(async () => {
    if (!election || !DB_READY || !supabase) return;
    // Delete all votes for this election
    await supabase
      .from("civique_votes")
      .delete()
      .eq("election_id", election.id);
    // Delete all candidates (also revokes their badges via DB cascade)
    // First revoke gold badges from all candidates
    const { data: cands } = await supabase
      .from("civique_candidates")
      .select("user_id")
      .eq("election_id", election.id);
    for (const cand of cands ?? []) {
      await supabase
        .from("civique_users")
        .update({ badge: null })
        .eq("id", cand.user_id);
    }
    await supabase
      .from("civique_candidates")
      .delete()
      .eq("election_id", election.id);
    // Reset the election row to future
    await supabase
      .from("civique_elections")
      .update({
        status:         "future",
        mode:           null,
        active_post_id: null,
        open_posts:     [],
        timers:         [],
        updated_at:     new Date().toISOString(),
      })
      .eq("id", election.id);
    await fetchElection();
  }, [election, fetchElection]);
  // ── VOTER ACTION: Cast a vote ────────────────────────────────
  const castVote = useCallback(async (
    candidateId: string,
    postId: PostId,
    u: UserProfile,
  ): Promise<{ error: string | null }> => {
    if (!election || !DB_READY || !supabase) return { error: "no_election" };
    if (isCEPRole(u.role)) return { error: "cep_cannot_vote" };
    // Check not already voted for this post
    const alreadyVoted = myVotes.find(v => v.postId === postId);
    if (alreadyVoted) return { error: "already_voted" };
    const id = makeId();
    const { error } = await supabase.from("civique_votes").insert({
      id,
      election_id:  election.id,
      voter_id:     u.id,
      candidate_id: candidateId,
      post_id:      postId,
      created_at:   new Date().toISOString(),
    });
    if (error) return { error: error.message };
    await fetchElection();
    return { error: null };
  }, [election, myVotes, fetchElection]);
  // ── Derived helpers ──────────────────────────────────────────
  const candidatesForPost = useCallback((postId: PostId) =>
    candidates.filter(c => c.postId === postId),
  [candidates]);
  const votesForPost = useCallback((postId: PostId) =>
    myVotes.filter(v => v.postId === postId),
  [myVotes]);
  const winnerOfPost = useCallback((postId: PostId): CandidateRecord | null => {
    // Only meaningful when election is past.
    // Winner = candidate who kept their gold badge (losers & majority-failures have badge revoked).
    const postCands = candidates.filter(c => c.postId === postId);
    if (postCands.length === 0) return null;
    const withBadge = postCands.find(c => c.badge === "gold");
    // If no one has a badge (e.g. single candidate didn't get >50%), return null — no winner.
    return withBadge ?? null;
  }, [candidates]);
  const secondsLeft = useCallback((postId: PostId): number => {
    if (!election) return 0;
    const timer = election.timers.find(t => t.postId === postId);
    if (!timer?.endsAt) return 0;
    return Math.max(0, Math.floor((new Date(timer.endsAt).getTime() - Date.now()) / 1000));
  }, [election]);
  return (
    <Ctx.Provider value={{
      election, candidates, myVotes, allVotes, categorySexCounts, isCEP, loading,
      launchInscription, launchElection, submitCandidacy, castVote, resetElection,
      refreshElection: fetchElection,
      categoryOf,
      candidatesForPost,
      votesForPost,
      winnerOfPost,
      secondsLeft,
    }}>
      {children}
    </Ctx.Provider>
  );
}
export const useElection = () => useContext(Ctx);