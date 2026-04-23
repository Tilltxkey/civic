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
    status:       (row.status as "pending" | "verified" | "rejected" | "banned") ?? "verified",
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

// ── Get user by ID (used for session rehydration on reload) ───
export async function getUserById(
  id: string
): Promise<{ user: UserProfile | null }> {
  if (!DB_READY || !supabase) return { user: null };

  const { data, error } = await supabase
    .from("civique_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { user: null };
  return { user: fromRow(data) };
}

// ── Poll user status (used by ProcessingScreen after registration) ──
// Fetches just the status + badge + role fields every `intervalMs` ms.
// Calls onResult when status is no longer "pending".
// Returns a cleanup function to stop polling.
export function pollUserStatus(
  userId: string,
  intervalMs: number,
  onResult: (status: "verified" | "rejected" | "banned", user: UserProfile) => void
): () => void {
  if (!DB_READY || !supabase) return () => {};

  let stopped = false;

  const check = async () => {
    if (stopped) return;
    const { data, error } = await supabase!
      .from("civique_users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (stopped) return;
    if (error || !data) return; // silently retry

    const status = data.status as string;
    if (status === "verified" || status === "rejected" || status === "banned") {
      stopped = true;
      onResult(status as "verified" | "rejected" | "banned", fromRow(data));
    }
  };

  // Check once immediately, then on interval
  check();
  const timer = setInterval(check, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
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
  quoted_post?: string;  // JSON-encoded QuotedPost snapshot for cite-reposts
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
  await supabase.from("civique_posts").update({ likes, reposts, views }).eq("id", id);
}

export interface DBComment {
  id:            string;
  post_id:       string;
  author_id:     string;
  author_nom:    string;
  author_prenom: string;
  author_tag:    string;
  author_color:  string;
  author_badge:  string | null;
  body:          string;
  imgs:          string[];
  time_label:    string;
  created_at?:   string;
  likes?:        number;
  dislikes?:     number;
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
  await supabase.from("civique_comments").update({ likes, dislikes }).eq("id", id);
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

// ── Messages ──────────────────────────────────────────────────

export interface DBConversation {
  id:       string;
  user_a:   string;
  user_b:   string;
  last_msg: string;
  last_at:  string;
  unread_a: number;
  unread_b: number;
}

export interface DBMessage {
  id:              string;
  conversation_id: string;
  from_id:         string;
  body:            string;
  created_at?:     string;
}

export async function loadConversations(userId: string): Promise<DBConversation[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_conversations")
    .select("*")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("last_at", { ascending: false });
  if (error) { console.error("loadConversations:", error.message); return []; }
  return (data ?? []) as DBConversation[];
}

export async function findOrCreateConversation(userA: string, userB: string): Promise<string> {
  if (!DB_READY || !supabase) return `local_${Date.now()}`;
  const { data } = await supabase
    .from("civique_conversations")
    .select("id")
    .or(`and(user_a.eq.${userA},user_b.eq.${userB}),and(user_a.eq.${userB},user_b.eq.${userA})`)
    .maybeSingle();
  if (data?.id) return data.id;
  const id = `conv_${Date.now()}`;
  await supabase.from("civique_conversations").insert({
    id, user_a: userA, user_b: userB,
    last_msg: "", last_at: new Date().toISOString(), unread_a: 0, unread_b: 0,
  });
  return id;
}

export async function loadMessages(convId: string): Promise<DBMessage[]> {
  if (!DB_READY || !supabase) return [];
  const { data, error } = await supabase
    .from("civique_messages")
    .select("*")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  if (error) { console.error("loadMessages:", error.message); return []; }
  return (data ?? []) as DBMessage[];
}

export async function sendMessage(msg: DBMessage): Promise<void> {
  if (!DB_READY || !supabase) return;
  const { error } = await supabase.from("civique_messages").insert(msg);
  if (error) console.error("sendMessage:", error.message);
}

export async function updateConvLastMsg(convId: string, lastMsg: string, senderId: string, userA: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  const isA = senderId === userA;
  const { data } = await supabase.from("civique_conversations").select("unread_a,unread_b").eq("id", convId).maybeSingle();
  await supabase.from("civique_conversations").update({
    last_msg: lastMsg, last_at: new Date().toISOString(),
    unread_a: isA ? (data?.unread_a ?? 0) : (data?.unread_a ?? 0) + 1,
    unread_b: isA ? (data?.unread_b ?? 0) + 1 : (data?.unread_b ?? 0),
  }).eq("id", convId);
}

export async function markConvRead(convId: string, userId: string, userA: string): Promise<void> {
  if (!DB_READY || !supabase) return;
  await supabase.from("civique_conversations")
    .update(userId === userA ? { unread_a: 0 } : { unread_b: 0 })
    .eq("id", convId);
}

export async function loadAllUsers(): Promise<{ id: string; nom: string; prenom: string; faculty: string; year: number; role: string; avatar_color: string; badge: string | null; profile_photo: string | null }[]> {
  if (!DB_READY || !supabase) return [];
  const { data } = await supabase
    .from("civique_users")
    .select("id, nom, prenom, faculty, year, role, avatar_color, badge, profile_photo")
    .order("nom", { ascending: true });
  return (data ?? []) as any[];
}

export type RealtimeMessageEvent = { type: "INSERT" | "UPDATE" | "DELETE"; row: DBMessage };
export type RealtimeConvoEvent   = { type: "INSERT" | "UPDATE" | "DELETE"; row: DBConversation };

export function subscribeMessages(convId: string, cb: (e: RealtimeMessageEvent) => void): () => void {
  if (!DB_READY || !supabase) return () => {};
  const ch = supabase
    .channel(`civique_msg_rt_${convId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "civique_messages", filter: `conversation_id=eq.${convId}` },
      (p) => cb({ type: p.eventType as any, row: (p.new ?? p.old) as DBMessage }))
    .subscribe();
  return () => { supabase!.removeChannel(ch); };
}

export function subscribeConversations(userId: string, cb: (e: RealtimeConvoEvent) => void): () => void {
  if (!DB_READY || !supabase) return () => {};
  const ch = supabase
    .channel(`civique_convos_rt_${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "civique_conversations" },
      (p) => cb({ type: p.eventType as any, row: (p.new ?? p.old) as DBConversation }))
    .subscribe();
  return () => { supabase!.removeChannel(ch); };
}

// ── DM eligibility ────────────────────────────────────────────

export async function canDM(senderId: string, targetHandle: string, targetId: string): Promise<boolean> {
  if (!DB_READY || !supabase) return true;
  const { data: posts } = await supabase
    .from("civique_posts")
    .select("body")
    .eq("author_id", targetId);
  if (posts?.some(p => p.body?.toLowerCase().includes(targetHandle.toLowerCase()))) return true;
  const { data: comments } = await supabase
    .from("civique_comments")
    .select("body, post_id")
    .eq("author_id", targetId);
  if (comments) {
    for (const c of comments) {
      if (c.body?.toLowerCase().includes(targetHandle.toLowerCase())) {
        const { data: post } = await supabase
          .from("civique_posts").select("author_id").eq("id", c.post_id).maybeSingle();
        if (post?.author_id === senderId) return true;
      }
    }
  }
  return false;
}

// ── Notifications ─────────────────────────────────────────────
export function pushLocalNotif(userId: string, notif: { id: string; body: string; from: string; createdAt: string }): void {
  try {
    const key  = `civique_notifs_${userId}`;
    const prev = JSON.parse(localStorage.getItem(key) ?? "[]");
    localStorage.setItem(key, JSON.stringify([notif, ...prev].slice(0, 50)));
  } catch {}
}

// ── Update user badge ─────────────────────────────────────────
export async function updateUserBadge(userId: string, badge: "gold" | "blue" | "gray" | null): Promise<void> {
  if (!DB_READY || !supabase) return;
  await supabase.from("civique_users").update({ badge }).eq("id", userId);
}