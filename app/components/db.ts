/**
 * db.ts
 * ─────────────────────────────────────────────────────────────
 * Database operations for Civique users.
 * Falls back gracefully if Supabase is not configured.
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { supabase, DB_READY } from "./supabase";
import type { UserProfile } from "./AuthFlow";

// Map UserProfile → DB row
function toRow(u: UserProfile) {
  // badge_photo is a base64 image — can exceed Supabase row limits.
  // Only store if under 500KB; otherwise save reference only.
  const photoSafe = u.badgePhoto && u.badgePhoto.length < 500_000
    ? u.badgePhoto
    : u.badgePhoto ? "[photo_too_large]" : null;
  return {
    id:            u.id,
    matricule:     u.matricule || null,
    nom:           u.nom,
    prenom:        u.prenom,
    sexe:          u.sexe,
    faculty:       u.faculty,
    field:         u.field,
    year:          u.year,
    vacation:      u.vacation,
    role:          u.role,
    role_detail:   u.roleDetail || null,
    badge_photo:   photoSafe,
    status:        u.status,
    avatar_color:  u.avatarColor,
    badge:         u.badge,
    created_at_iso: u.createdAt,
  };
}

// Map DB row → UserProfile
function fromRow(row: Record<string, unknown>): UserProfile {
  return {
    id:           row.id as string,
    matricule:    (row.matricule as string) ?? "",
    nom:          row.nom as string,
    prenom:       row.prenom as string,
    sexe:         row.sexe as string,
    faculty:      row.faculty as string,
    field:        row.field as string,
    year:         row.year as number,
    vacation:     row.vacation as string,
    role:         row.role as string,
    roleDetail:   (row.role_detail as string) ?? "",
    badgePhoto:   (row.badge_photo as string) ?? "",
    profilePhoto: (row.profile_photo as string) ?? "",
    status:       (row.status as "pending" | "verified") ?? "verified",
    avatarColor:  (row.avatar_color as string) ?? "#C47F00",
    badge:        (row.badge as "gold" | "blue" | "gray" | null) ?? null,
    createdAt:    (row.created_at_iso as string) ?? new Date().toISOString(),
  };
}

// ── Save new user (registration) ─────────────────────────────
export async function saveUser(user: UserProfile): Promise<{ error: string | null }> {
  if (!DB_READY || !supabase) return { error: null }; // no DB — silently succeed

  const { error } = await supabase
    .from("civique_users")
    .insert(toRow(user));

  if (error) {
    // Duplicate matricule
    if (error.code === "23505") return { error: "duplicate" };
    return { error: error.message };
  }
  return { error: null };
}

// ── Check if matricule already exists (duplicate prevention) ──
export async function checkDuplicate(matricule: string): Promise<boolean> {
  if (!DB_READY || !supabase || !matricule.trim()) return false;

  const { data } = await supabase
    .from("civique_users")
    .select("id")
    .eq("matricule", matricule.trim())
    .maybeSingle();

  return !!data;
}

// ── Sign in by matricule + nom ────────────────────────────────
export async function signInUser(
  matricule: string,
  nom: string
): Promise<{ user: UserProfile | null; error: string | null }> {
  if (!DB_READY || !supabase) {
    return { user: null, error: "no_db" };
  }

  const { data, error } = await supabase
    .from("civique_users")
    .select("*")
    .eq("matricule", matricule.trim())
    .maybeSingle();

  if (error) return { user: null, error: error.message };
  if (!data)  return { user: null, error: "not_found" };

  // Case-insensitive nom check
  const normalize = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (normalize(data.nom) !== normalize(nom)) {
    return { user: null, error: "wrong_nom" };
  }

  return { user: fromRow(data), error: null };
}

// ── Posts ─────────────────────────────────────────────────────

export interface DBPost {
  id:         string;
  author_id:  string;
  author_nom: string;
  author_prenom: string;
  author_tag: string;
  author_color: string;
  author_badge: string | null;
  body:       string;
  imgs:       string[];
  time_label: string;
  created_at?: string;
  likes:      number;
  reposts:    number;
  views:      number;
  comment_count?: number;
}

// ── Realtime subscriptions ────────────────────────────────────

export type RealtimePostEvent = { type: "INSERT" | "UPDATE" | "DELETE"; row: DBPost };
export type RealtimeCommentEvent = { type: "INSERT" | "UPDATE" | "DELETE"; row: DBComment };

export function subscribePostChanges(cb: (e: RealtimePostEvent) => void): () => void {
  if (!DB_READY || !supabase) return () => {};
  const channel = supabase
    .channel("civique_posts_rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "civique_posts" },
      (payload) => cb({ type: payload.eventType as any, row: (payload.new ?? payload.old) as DBPost }))
    .subscribe();
  return () => { supabase!.removeChannel(channel); };
}

export function subscribeCommentChanges(postId: string, cb: (e: RealtimeCommentEvent) => void): () => void {
  if (!DB_READY || !supabase) return () => {};
  const channel = supabase
    .channel(`civique_comments_rt_${postId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "civique_comments", filter: `post_id=eq.${postId}` },
      (payload) => cb({ type: payload.eventType as any, row: (payload.new ?? payload.old) as DBComment }))
    .subscribe();
  return () => { supabase!.removeChannel(channel); };
}

// ── User profile photos cache ─────────────────────────────────

export async function fetchUserPhotos(userIds: string[]): Promise<Record<string, string>> {
  if (!DB_READY || !supabase || userIds.length === 0) return {};
  const { data } = await supabase
    .from("civique_users")
    .select("id, profile_photo")
    .in("id", userIds);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.profile_photo) map[row.id] = row.profile_photo;
  }
  return map;
}

export async function loadPosts(): Promise<DBPost[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error("loadPosts:", error.message); return []; }
  return (data ?? []) as DBPost[];
}

export async function insertPost(post: DBPost): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase.from("civique_posts").insert(post);
  if (error) console.error("insertPost:", error.message);
}

export async function deletePost(id: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  await supabase.from("civique_posts").delete().eq("id", id);
}

export async function updatePostStats(id: string, likes: number, reposts: number, views: number): Promise<void> {
  if (!DB_READY || !supabase) return;
  await supabase
    .from("civique_posts")
    .update({ likes, reposts, views })
    .eq("id", id);
}

// ── Comments ──────────────────────────────────────────────────

export interface DBComment {
  id:           string;
  post_id:      string;
  author_id:    string;
  author_nom:   string;
  author_prenom:string;
  author_tag:   string;
  author_color: string;
  author_badge: string | null;
  body:         string;
  imgs:         string[];
  time_label:   string;
  created_at?:  string;
  likes?:       number;
  dislikes?:    number;
}

export async function loadComments(postId: string): Promise<DBComment[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) { console.error("loadComments:", error.message); return []; }
  return (data ?? []) as DBComment[];
}

export async function insertComment(comment: DBComment): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase.from("civique_comments").insert(comment);
  if (error) console.error("insertComment:", error.message);
}

export async function updateCommentStats(id: string, likes: number, dislikes: number): Promise<void> {
  if (!DB_READY || !supabase) return;
  await supabase
    .from("civique_comments")
    .update({ likes, dislikes })
    .eq("id", id);
}

export async function updateUserPhoto(userId: string, photoUrl: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase
    .from("civique_users")
    .update({ profile_photo: photoUrl })
    .eq("id", userId);
  if (error) console.error("[Civique] updateUserPhoto:", error.message);
}

export async function incrementViews(postId: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { data } = await supabase.from("civique_posts").select("views").eq("id", postId).maybeSingle();
  const v = (data?.views ?? 0) as number;
  await supabase.from("civique_posts").update({ views: v + 1 }).eq("id", postId);
}

export async function deltaPostLikes(postId: string, delta: 1 | -1): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { data } = await supabase.from("civique_posts").select("likes").eq("id", postId).maybeSingle();
  const v = (data?.likes ?? 0) as number;
  await supabase.from("civique_posts").update({ likes: Math.max(0, v + delta) }).eq("id", postId);
}

export async function deltaPostReposts(postId: string, delta: 1 | -1): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { data } = await supabase.from("civique_posts").select("reposts").eq("id", postId).maybeSingle();
  const v = (data?.reposts ?? 0) as number;
  await supabase.from("civique_posts").update({ reposts: Math.max(0, v + delta) }).eq("id", postId);
}

export async function deltaCommentLikes(commentId: string, delta: 1 | -1): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { data } = await supabase.from("civique_comments").select("likes").eq("id", commentId).maybeSingle();
  const v = (data?.likes ?? 0) as number;
  await supabase.from("civique_comments").update({ likes: Math.max(0, v + delta) }).eq("id", commentId);
}

export async function incrementCommentCount(postId: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  // Get current count then increment
  const { data } = await supabase
    .from("civique_posts")
    .select("comment_count")
    .eq("id", postId)
    .maybeSingle();
  const current = (data?.comment_count ?? 0) as number;
  await supabase
    .from("civique_posts")
    .update({ comment_count: current + 1 })
    .eq("id", postId);
}
// ── Elections ─────────────────────────────────────────────────

export interface DBElection {
  id:                  string;
  created_at?:         string;
  category_key:        string;
  faculty:             string;
  field:               string;
  year:                number;
  vacation:            string;
  status:              "future" | "inscription" | "ongoing" | "past";
  posts_scope:         "all" | "single";
  selected_post:       string | null;
  vote_order:          "together" | "sequential";
  current_post_index:  number;
  durations:           Record<string, number>; // { "Président·e du Comité Exécutif": 60, ... }
  inscription_start:   string | null;
  election_start:      string | null;
  election_end:        string | null;
  created_by:          string;
}

export interface DBCandidate {
  id:                 string;
  created_at?:        string;
  election_id:        string;
  user_id:            string;
  user_nom:           string;
  user_prenom:        string;
  user_tag:           string | null;
  user_color:         string | null;
  post:               string;
  campaign_sentence:  string | null;
  vote_count:         number;
  temp_badge_active:  boolean;
}

export interface DBVote {
  id:           string;
  created_at?:  string;
  election_id:  string;
  voter_id:     string;
  candidate_id: string;
  post:         string;
}

// ── Election CRUD ─────────────────────────────────────────────

export async function getElectionByCategory(
  categoryKey: string
): Promise<DBElection | null> {
  if (!DB_READY || !supabase) return null;
  const { data, error } = await supabase
    .from("civique_elections")
    .select("*")
    .eq("category_key", categoryKey)
    .neq("status", "past")           // most recent non-past election
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error("getElectionByCategory:", error.message); return null; }
  return data as DBElection | null;
}

export async function createElection(
  data: Omit<DBElection, "created_at">
): Promise<{ id: string; error: string | null }> {
  if (!DB_READY || !supabase) return { id: data.id, error: null };
  const { error } = await supabase.from("civique_elections").insert(data);
  if (error) return { id: data.id, error: error.message };
  return { id: data.id, error: null };
}

export async function updateElectionStatus(
  id: string,
  status: DBElection["status"],
  extra: Partial<DBElection> = {}
): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase
    .from("civique_elections")
    .update({ status, ...extra })
    .eq("id", id);
  if (error) console.error("updateElectionStatus:", error.message);
}

// ── Candidates ────────────────────────────────────────────────

export async function getCandidates(electionId: string): Promise<DBCandidate[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_candidates")
    .select("*")
    .eq("election_id", electionId)
    .order("created_at", { ascending: true });
  if (error) { console.error("getCandidates:", error.message); return []; }
  return (data ?? []) as DBCandidate[];
}

export async function createCandidate(
  data: Omit<DBCandidate, "created_at" | "vote_count" | "temp_badge_active"> & { vote_count?: number; temp_badge_active?: boolean }
): Promise<{ id: string; error: string | null }> {
  if (!DB_READY || !supabase) return { id: data.id, error: null };
  const row = { vote_count: 0, temp_badge_active: true, ...data };
  const { error } = await supabase.from("civique_candidates").insert(row);
  if (error) return { id: data.id, error: error.message };
  return { id: data.id, error: null };
}

export async function getActiveCandidate(
  userId: string,
  electionId: string
): Promise<DBCandidate | null> {
  if (!DB_READY || !supabase) return null;
  const { data, error } = await supabase
    .from("civique_candidates")
    .select("*")
    .eq("user_id", userId)
    .eq("election_id", electionId)
    .eq("temp_badge_active", true)
    .maybeSingle();
  if (error) { console.error("getActiveCandidate:", error.message); return null; }
  return data as DBCandidate | null;
}

export async function deactivateCandidateBadges(electionId: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase
    .from("civique_candidates")
    .update({ temp_badge_active: false })
    .eq("election_id", electionId);
  if (error) console.error("deactivateCandidateBadges:", error.message);
}

// ── Votes ─────────────────────────────────────────────────────

export async function castVote(
  electionId: string,
  voterId: string,
  candidateId: string,
  post: string
): Promise<{ error: string | null }> {
  if (!DB_READY || !supabase) return { error: null };
  const id = `v${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase
    .from("civique_votes")
    .insert({ id, election_id: electionId, voter_id: voterId, candidate_id: candidateId, post });
  if (error) {
    // UNIQUE violation = already voted
    if (error.code === "23505") return { error: "already_voted" };
    return { error: error.message };
  }
  // Increment candidate vote_count
  const { data: c } = await supabase
    .from("civique_candidates")
    .select("vote_count")
    .eq("id", candidateId)
    .maybeSingle();
  await supabase
    .from("civique_candidates")
    .update({ vote_count: ((c?.vote_count as number) ?? 0) + 1 })
    .eq("id", candidateId);
  return { error: null };
}

export async function getVotesByElection(electionId: string): Promise<DBVote[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_votes")
    .select("*")
    .eq("election_id", electionId);
  if (error) { console.error("getVotesByElection:", error.message); return []; }
  return (data ?? []) as DBVote[];
}

export async function hasVoted(
  electionId: string,
  voterId: string,
  post: string
): Promise<boolean> {
  if (!DB_READY || !supabase) return false;
  const { data } = await supabase
    .from("civique_votes")
    .select("id")
    .eq("election_id", electionId)
    .eq("voter_id", voterId)
    .eq("post", post)
    .maybeSingle();
  return !!data;
}

// ── Notifications ─────────────────────────────────────────────

export interface DBNotification {
  id:         string;
  type:       "new_candidate" | "election_open" | "election_results" | "badge_expired";
  message:    string;
  from_user:  string | null;
  created_at: string;
  read:       boolean;
}

export async function sendNotificationToCategory(
  categoryKey: string,
  notif: Omit<DBNotification, "id" | "created_at" | "read">
): Promise<void> {
  if (!DB_READY || !supabase) return;

  // Build the notification object
  const newNotif: DBNotification = {
    id:         `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    read:       false,
    ...notif,
  };

  // Fetch all users in this category
  const [faculty, field, yearStr, vacation] = categoryKey.split("::");
  const { data: users, error } = await supabase
    .from("civique_users")
    .select("id, notifications")
    .eq("faculty", faculty)
    .eq("field", field)
    .eq("year", parseInt(yearStr))
    .eq("vacation", vacation);

  if (error) { console.error("sendNotificationToCategory:", error.message); return; }

  // Append notification to each user's jsonb array
  for (const user of users ?? []) {
    const current: DBNotification[] = Array.isArray(user.notifications) ? user.notifications : [];
    await supabase
      .from("civique_users")
      .update({ notifications: [...current, newNotif] })
      .eq("id", user.id);
  }
}

export async function markNotificationsRead(
  userId: string,
  notifIds: string[] | "all"
): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { data: user } = await supabase
    .from("civique_users")
    .select("notifications")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return;
  const current: DBNotification[] = Array.isArray(user.notifications) ? user.notifications : [];
  const updated = current.map(n => ({
    ...n,
    read: notifIds === "all" ? true : notifIds.includes(n.id) ? true : n.read,
  }));
  await supabase.from("civique_users").update({ notifications: updated }).eq("id", userId);
}

export async function getNotifications(userId: string): Promise<DBNotification[]> {
  if (!DB_READY || !supabase) return [];
  const { data } = await supabase
    .from("civique_users")
    .select("notifications")
    .eq("id", userId)
    .maybeSingle();
  const notifs: DBNotification[] = Array.isArray(data?.notifications) ? data.notifications : [];
  return notifs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// ── Election realtime subscription ────────────────────────────

export function subscribeElectionChanges(
  categoryKey: string,
  cb: (election: DBElection) => void
): () => void {
  if (!DB_READY || !supabase) return () => {};
  const channel = supabase
    .channel(`civique_election_${categoryKey.replace(/::/g, "_")}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "civique_elections", filter: `category_key=eq.${categoryKey}` },
      (payload) => { if (payload.new) cb(payload.new as DBElection); }
    )
    .subscribe();
  return () => { supabase!.removeChannel(channel); };
}