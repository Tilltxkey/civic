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
import { fetchUserPhotos } from "./db";
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
// ── Overlay duration ─────────────────────────────────────────
export const OVERLAY_SECS = 30;
export interface PostTimer {
  postId:       PostId;
  durationSecs: number;
  endsAt:       string | null;
}
export interface CandidateRecord {
  id:          string;
  userId:      string;
  postId:      PostId;
  userName:    string;
  userSexe:    string;
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
  id:                  string;
  category:            string;
  status:              ElectionStatus;
  mode:                ElectionMode | null;
  activePostId:        PostId | null;
  openPosts:           PostId[];
  timers:              PostTimer[];
  inscriptionEndsAt:   string | null;   // ISO timestamp — null when no inscription timer set
  createdAt:           string;
  updatedAt:           string;
}
interface ElectionCtx {
  election:             ElectionRecord | null;
  candidates:           CandidateRecord[];
  myVotes:              VoteRecord[];
  allVotes:             VoteRecord[];
  categorySexCounts:    { M: number; F: number };
  profilePhotos:        Record<string, string>;
  isCEP:                boolean;
  loading:              boolean;
  launchInscription:    (posts: PostId[], durationSecs: number) => Promise<void>;
  launchElection:       (posts: PostId[], mode: ElectionMode, timers: PostTimer[]) => Promise<void>;
  submitCandidacy:      (postId: PostId, user: UserProfile) => Promise<{ error: string | null }>;
  castVote:             (candidateId: string, postId: PostId, user: UserProfile) => Promise<{ error: string | null }>;
  resetElection:        () => Promise<void>;
  refreshElection:      () => Promise<void>;
  onUserRefresh?:       () => Promise<void>;
  categoryOf:           (u: UserProfile) => string;
  candidatesForPost:    (postId: PostId) => CandidateRecord[];
  votesForPost:         (postId: PostId) => VoteRecord[];
  winnerOfPost:         (postId: PostId) => CandidateRecord | null;
  secondsLeft:          (postId: PostId) => number;
  inscriptionSecsLeft:  () => number;
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
  election: null, candidates: [], myVotes: [], allVotes: [], categorySexCounts: { M: 0, F: 0 }, profilePhotos: {}, isCEP: false, loading: true,
  launchInscription: async () => {},
  launchElection:    async () => {},
  submitCandidacy:   async () => ({ error: null }),
  castVote:          async () => ({ error: null }),
  resetElection:     async () => {},
  refreshElection:   async () => {},
  categoryOf,
  candidatesForPost:   () => [],
  votesForPost:        () => [],
  winnerOfPost:        () => null,
  secondsLeft:         () => 0,
  inscriptionSecsLeft: () => 0,
});
// ─── PROVIDER ────────────────────────────────────────────────
export function ElectionProvider({
  children,
  user,
  onUserRefresh,
}: {
  children:       ReactNode;
  user:           UserProfile | null;
  onUserRefresh?: () => Promise<void>;
}) {
  const [election,   setElection]   = useState<ElectionRecord | null>(null);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [myVotes,    setMyVotes]    = useState<VoteRecord[]>([]);
  const [allVotes,   setAllVotes]   = useState<VoteRecord[]>([]);
  const [categorySexCounts, setCategorySexCounts] = useState<{ M: number; F: number }>({ M: 0, F: 0 });
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>({});
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
        id:                 elData.id,
        category:           elData.category,
        status:             elData.status,
        mode:               elData.mode,
        activePostId:       elData.active_post_id,
        openPosts:          elData.open_posts ?? [],
        timers:             elData.timers ?? [],
        inscriptionEndsAt:  elData.inscription_ends_at ?? null,
        createdAt:          elData.created_at,
        updatedAt:          elData.updated_at,
      };
      setElection(rec);
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

  // ── Fetch profile photos for all candidates ─────────────────
  useEffect(() => {
    if (candidates.length === 0) { setProfilePhotos({}); return; }
    const ids = candidates.map(c => c.userId);
    fetchUserPhotos(ids).then(photos => setProfilePhotos(photos));
  }, [candidates]);

  // ── Realtime subscription on election row ───────────────────
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
    const pollId = setInterval(() => { fetchElection(); }, 10_000);
    return () => {
      supabase!.removeChannel(ch);
      clearInterval(pollId);
    };
  }, [category, fetchElection]);

  // ── NEW: Realtime subscription on current user's own row ────
  // This makes badge and role changes (gold granted/revoked, elected role set)
  // reflect instantly for the logged-in user without needing a page reload.
  // Fires onUserRefresh which re-fetches from DB and updates all contexts.
  useEffect(() => {
    if (!user?.id || !DB_READY || !supabase) return;
    const ch = supabase
      .channel(`civique_user_self_${user.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "civique_users",
        filter: `id=eq.${user.id}`,
      }, () => {
        if (onUserRefresh) onUserRefresh();
      })
      .subscribe();
    return () => { supabase!.removeChannel(ch); };
  }, [user?.id, onUserRefresh]);

  // ── Auto-advance sequentiel mode ────────────────────────────
  const electionRef       = useRef(election);
  const candidatesRef     = useRef(candidates);
  const isCEPRef          = useRef(isCEP);
  const fetchElectionRef  = useRef(fetchElection);
  useEffect(() => { electionRef.current      = election;       }, [election]);
  useEffect(() => { candidatesRef.current    = candidates;     }, [candidates]);
  useEffect(() => { isCEPRef.current         = isCEP;          }, [isCEP]);
  useEffect(() => { fetchElectionRef.current = fetchElection;  }, [fetchElection]);

  const advancingRef = useRef(false);
  useEffect(() => {
    if (!DB_READY || !supabase) return;
    const iv = setInterval(async () => {
      const el = electionRef.current;
      if (!el || el.status !== "ongoing") return;
      if (advancingRef.current) return;

      const now = Date.now();

      if (el.mode === "sequentiel") {
        const activeTimer = el.timers.find(t => t.postId === el.activePostId);
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
            const newEndsAt = new Date(now + (OVERLAY_SECS + (nextTimer?.durationSecs ?? 3600)) * 1000).toISOString();
            await supabase!.from("civique_elections").update({
              active_post_id: nextPost.id,
              timers: el.timers.map(t => t.postId === nextPost!.id ? { ...t, endsAt: newEndsAt } : t),
              updated_at: new Date().toISOString(),
            }).eq("id", el.id);
          } else {
            await endElection(el);
          }
          await fetchElectionRef.current();
        } finally {
          setTimeout(() => { advancingRef.current = false; }, 4000);
        }
      } else {
        const openTimers = el.timers.filter(t => el.openPosts.includes(t.postId));
        if (openTimers.length === 0) return;

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End election + settle winner/loser badges and roles ─────
  // STEP 1: Revoke gold from ALL users in category (including temporary campaign badges)
  // STEP 2: Tally votes
  // STEP 3: Award gold + elected role only to confirmed winners
  // STEP 4: Mark election as past
  const endElection = async (el: ElectionRecord) => {
    if (!DB_READY || !supabase) return;
    const fetch = fetchElectionRef.current;

    const POST_ROLE_MAP: Record<string, string> = {
      raa:        "Responsable Affaires Académiques",
      delegue:    "Délégué·e",
      tresorier:  "Trésorier·e",
      secretaire: "Secrétaire",
      president:  "Président·e du Comité Exécutif",
    };
    const ALL_ELECTED_ROLES = Object.values(POST_ROLE_MAP);
    const [fac, fld, yr, vac] = el.category.split("|");
    const yearInt = parseInt(yr, 10);

    // ── STEP 1: Sweep entire category before any awards ────────
    // Revoke gold badge from ALL users in the category
    // This includes candidates whose temporary campaign gold is now removed
    await supabase
      .from("civique_users")
      .update({ badge: null })
      .eq("faculty", fac).eq("field", fld).eq("year", yearInt).eq("vacation", vac)
      .eq("badge", "gold");

    // Reset anyone holding an elected role back to "Étudiant·e"
    for (const roleLabel of ALL_ELECTED_ROLES) {
      await supabase
        .from("civique_users")
        .update({ role: "Étudiant·e" })
        .eq("faculty", fac).eq("field", fld).eq("year", yearInt).eq("vacation", vac)
        .eq("role", roleLabel);
    }

    // Revoke badge on all candidate rows
    await supabase
      .from("civique_candidates")
      .update({ badge: null })
      .eq("election_id", el.id);

    // ── STEP 2: Tally votes ────────────────────────────────────
    const { data: voteData } = await supabase
      .from("civique_votes")
      .select("candidate_id, post_id")
      .eq("election_id", el.id);
    if (!voteData) return;

    const voteCounts: Record<string, number> = {};
    for (const v of voteData) {
      voteCounts[v.candidate_id] = (voteCounts[v.candidate_id] ?? 0) + 1;
    }

    const { data: candData } = await supabase
      .from("civique_candidates")
      .select("*")
      .eq("election_id", el.id);
    if (!candData) return;

    const { data: eligibleData } = await supabase
      .from("civique_users")
      .select("id")
      .eq("faculty", fac).eq("field", fld).eq("year", yearInt).eq("vacation", vac);
    const totalEligible = eligibleData?.length ?? 1;

    // ── STEP 3: Award winners ──────────────────────────────────
    for (const post of POSTS) {
      const postCands = candData.filter(c => c.post_id === post.id);
      if (postCands.length === 0) continue;

      const maxVotes = Math.max(...postCands.map(c => voteCounts[c.id] ?? 0));
      let winnerId: string | null = null;

      if (postCands.length === 1) {
        const votes = voteCounts[postCands[0].id] ?? 0;
        winnerId = votes > totalEligible / 2 ? postCands[0].id : null;
      } else {
        const topCands = postCands.filter(c => (voteCounts[c.id] ?? 0) === maxVotes);
        winnerId = maxVotes > 0 && topCands.length === 1 ? topCands[0].id : null;
      }

      if (!winnerId) continue;

      const winner = postCands.find(c => c.id === winnerId)!;
      const postRoleLabel = POST_ROLE_MAP[post.id];

      await supabase
        .from("civique_users")
        .update({ badge: "gold", role: postRoleLabel })
        .eq("id", winner.user_id);

      await supabase
        .from("civique_candidates")
        .update({ badge: "gold" })
        .eq("id", winner.id);
    }

    // ── STEP 4: Mark as past and refresh ─────────────────────
    await supabase
      .from("civique_elections")
      .update({ status: "past", updated_at: new Date().toISOString() })
      .eq("id", el.id);

    await fetch();
    if (onUserRefresh) await onUserRefresh();
  };

  // ── CEP ACTION: Launch inscription phase ────────────────────
  const launchInscription = useCallback(async (posts: PostId[], durationSecs: number) => {
    if (!category || !DB_READY || !supabase || !user) return;
    const inscriptionEndsAt = new Date(Date.now() + durationSecs * 1000).toISOString();
    const existing = election;
    if (existing) {
      await supabase
        .from("civique_elections")
        .update({
          status:               "inscription",
          open_posts:           posts,
          inscription_ends_at:  inscriptionEndsAt,
          updated_at:           new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      const id = makeId();
      await supabase.from("civique_elections").insert({
        id,
        category,
        status:               "inscription",
        mode:                 null,
        active_post_id:       null,
        open_posts:           posts,
        timers:               [],
        inscription_ends_at:  inscriptionEndsAt,
        created_at:           new Date().toISOString(),
        updated_at:           new Date().toISOString(),
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
        endsAt: new Date(now + (OVERLAY_SECS + t.durationSecs) * 1000).toISOString(),
      }));
    } else {
      const firstWithCands = sorted.find(p => candidates.some(c => c.postId === p.id)) ?? sorted[0];
      timersFinal = timers.map(t => ({
        ...t,
        endsAt: t.postId === firstWithCands?.id
          ? new Date(now + (OVERLAY_SECS + t.durationSecs) * 1000).toISOString()
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
  // CHANGED: Now also grants gold badge on civique_users immediately upon
  // successful candidacy registration. This temporary badge is swept away
  // by endElection (step 1) when the election closes — winners get it back
  // via step 3, losers do not.
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

    // ── NEW: Grant temporary gold badge on civique_users for campaign ──
    // This makes the gold badge appear immediately on the candidate's profile
    // and in community posts without requiring a reload.
    // The badge is revoked for all candidates in endElection step 1,
    // then re-awarded only to confirmed winners in step 3.
    await supabase
      .from("civique_users")
      .update({ badge: "gold" })
      .eq("id", u.id);
    // onUserRefresh will be triggered automatically via the realtime subscription
    // on civique_users (added above), so the current user sees their badge
    // update instantly if they are the one who just registered as a candidate.

    await fetchElection();
    return { error: null };
  }, [election, candidates, fetchElection]);

  // ── CEP ACTION: Reset election for a new cycle ──────────────
  const resetElection = useCallback(async () => {
    if (!election || !DB_READY || !supabase || !category) return;

    const ALL_ELECTED_ROLES = [
      "Responsable Affaires Académiques",
      "Délégué·e",
      "Trésorier·e",
      "Secrétaire",
      "Président·e du Comité Exécutif",
    ];
    const [fac, fld, yr, vac] = category.split("|");
    const yearInt = parseInt(yr, 10);

    await supabase.from("civique_votes").delete().eq("election_id", election.id);
    await supabase.from("civique_candidates").delete().eq("election_id", election.id);

    // Sweep the entire category — revoke gold badges and elected roles
    await supabase
      .from("civique_users")
      .update({ badge: null })
      .eq("faculty", fac).eq("field", fld).eq("year", yearInt).eq("vacation", vac)
      .eq("badge", "gold");

    for (const roleLabel of ALL_ELECTED_ROLES) {
      await supabase
        .from("civique_users")
        .update({ role: "Étudiant·e" })
        .eq("faculty", fac).eq("field", fld).eq("year", yearInt).eq("vacation", vac)
        .eq("role", roleLabel);
    }

    await supabase
      .from("civique_elections")
      .update({
        status: "future", mode: null, active_post_id: null,
        open_posts: [], timers: [], inscription_ends_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", election.id);

    await fetchElection();
    if (onUserRefresh) await onUserRefresh();
  }, [election, category, fetchElection, onUserRefresh]);

  // ── VOTER ACTION: Cast a vote ────────────────────────────────
  const castVote = useCallback(async (
    candidateId: string,
    postId: PostId,
    u: UserProfile,
  ): Promise<{ error: string | null }> => {
    if (!election || !DB_READY || !supabase) return { error: "no_election" };
    if (isCEPRole(u.role)) return { error: "cep_cannot_vote" };
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
    if (election?.status !== "past") return null;
    const postCands = candidates.filter(c => c.postId === postId);
    if (postCands.length === 0) return null;

    const postVotes = allVotes.filter(v => v.postId === postId);
    const voteCounts: Record<string, number> = {};
    for (const v of postVotes) {
      voteCounts[v.candidateId] = (voteCounts[v.candidateId] ?? 0) + 1;
    }
    const totalElig = categorySexCounts.M + categorySexCounts.F || 1;
    const maxVotes = Math.max(...postCands.map(c => voteCounts[c.id] ?? 0));

    if (postCands.length === 1) {
      const votes = voteCounts[postCands[0].id] ?? 0;
      return votes > totalElig / 2 ? postCands[0] : null;
    }
    const topCands = postCands.filter(c => (voteCounts[c.id] ?? 0) === maxVotes);
    return maxVotes > 0 && topCands.length === 1 ? topCands[0] : null;
  }, [election?.status, candidates, allVotes, categorySexCounts]);

  const secondsLeft = useCallback((postId: PostId): number => {
    if (!election) return 0;
    const timer = election.timers.find(t => t.postId === postId);
    if (!timer?.endsAt) return 0;
    return Math.max(0, Math.floor((new Date(timer.endsAt).getTime() - Date.now()) / 1000));
  }, [election]);

  // ── Inscription countdown helper ─────────────────────────────
  const inscriptionSecsLeft = useCallback((): number => {
    if (!election?.inscriptionEndsAt) return 0;
    return Math.max(0, Math.floor((new Date(election.inscriptionEndsAt).getTime() - Date.now()) / 1000));
  }, [election]);

  return (
    <Ctx.Provider value={{
      election, candidates, myVotes, allVotes, categorySexCounts, profilePhotos, isCEP, loading,
      launchInscription, launchElection, submitCandidacy, castVote, resetElection,
      refreshElection: fetchElection,
      categoryOf,
      candidatesForPost,
      votesForPost,
      winnerOfPost,
      secondsLeft,
      inscriptionSecsLeft,
    }}>
      {children}
    </Ctx.Provider>
  );
}
export const useElection = () => useContext(Ctx);