"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { UserProfile } from "./AuthFlow";
import { loadPosts, insertPost, deletePost as dbDeletePost, insertComment, loadComments, incrementCommentCount, incrementViews, deltaPostLikes, deltaPostReposts, deltaCommentLikes, subscribePostChanges, subscribeCommentChanges, fetchUserPhotos, loadConversations, subscribeConversations, pushLocalNotif, type DBPost, type DBComment } from "./db";
import { MessagesScreen } from "./MessagesTab";
import { useC } from "./tokens";
import { useLang } from "./LangContext";
import { useTheme } from "./ThemeContext";
import { AppMenu } from "./AppMenu";
import { useProfile } from "./ProfileContext";

// ── Types ─────────────────────────────────────────────────────

interface Author {
  id:     string;
  name:   string;
  handle: string;
  avatar: string;
  color:  string;
  tag:    string;
  badge:  "gold" | "blue" | "gray" | null;
}

interface Comment {
  id:        string;
  author:    Author;
  body:      string;
  createdAt: string;
  imgs:      string[];
  likes:     number;
  liked:     boolean;
  dislikes:  number;
  disliked:  boolean;
}

// Embedded quoted-post snapshot (used by "Citer" repost flow)
interface QuotedPost {
  id:     string;
  author: Author;
  body:   string;
  imgs:   string[];
}

interface Post {
  id:           string;
  author:       Author;
  body:         string;
  createdAt:    string;   // ISO — source of truth for display time
  likes:        number;
  liked:        boolean;
  reposts:      number;
  reposted:     boolean;
  views:        number;
  commentCount: number;
  imgs:         string[];
  comments:     Comment[];
  showComments: boolean;
  quotedPost?:  QuotedPost;  // set when this post is a "Citer" quote-repost
}

function maxChars(badge: Author["badge"]): number {
  return badge === "gold" || badge === "gray" ? 560 : 280;
}
function maxImgs(badge: Author["badge"]): number {
  return badge === "gold" || badge === "gray" ? 4 : 1;
}

// ── Stickers ──────────────────────────────────────────────────

const STICKERS = [
  "🎓","📚","💡","🔬","🧪","📊","📈","🏛️","✍️","🤝",
  "🚀","💰","🌍","🏆","⚡","🎯","🔑","💎","🌟","🔥",
  "👏","🙌","💪","🤔","😎","🥇","📝","🗳️","⚖️","🌱",
];

// ── Shared helpers ────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}

// Relative time from ISO string — updates are driven by parent re-render
function fmtTime(iso?: string): string {
  if (!iso) return "...";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return "À l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// localStorage-backed interaction sets per user
function interactionKey(userId: string, kind: string) { return `civique_${kind}_${userId}`; }
function loadSet(userId: string, kind: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(interactionKey(userId, kind)) ?? "[]")); }
  catch { return new Set(); }
}
function saveSet(userId: string, kind: string, set: Set<string>) {
  try { localStorage.setItem(interactionKey(userId, kind), JSON.stringify([...set])); } catch {}
}

// ═══════════════════════════════════════════════════════════════
// ── FEED RANKING ALGORITHM ────────────────────────────────────
// Implements the weighted scoring system:
//
//   FinalScore = ( Wu × Mc + Engagement ) / hoursSincePosted^GRAVITY
//
// where:
//   Wu  = badge weight  (gray=10, gold=5, blue=2.5, none=1)
//   Mc  = category multiplier derived from viewer↔author match
//         (exact class+field=3×, field only=2×, college=1.5×, none=1×)
//   Engagement = likes×1 + comments×3 + reposts×5
//   GRAVITY    = 1.8  (pulls older posts down quickly)
//
// The feed is then sliced into three buckets — 70/20/10 — to
// ensure variety even when scores are tightly clustered:
//   70 %  "Relevance"  — posts from same class/field (high Mc)
//   20 %  "Authority"  — gray/gold posts regardless of field
//   10 %  "Wildcard"   — anything that has gone viral (high E)
// ═══════════════════════════════════════════════════════════════

const GRAVITY = 1.8;

// Badge base weights
const BADGE_WEIGHT: Record<string, number> = {
  gray: 10,
  gold:  5,
  blue:  2.5,
  none:  1,
};

// Parse the faculty short-code and year from an author_tag string.
// Tags look like: "eco.3", "eco.3 · del.", "fst.1", "rect." etc.
function parseTag(tag: string): { facultyCode: string; year: number | null } {
  // The tag always starts with "<facultyCode>.<year>" or just "<code>"
  const match = tag.trim().match(/^([a-z]+)\.(\d+)/i);
  if (match) return { facultyCode: match[1].toLowerCase(), year: parseInt(match[2], 10) };
  // Officials (gray) may just have "rect." or similar — no year
  const codeOnly = tag.trim().match(/^([a-z]+)\./i);
  return { facultyCode: codeOnly ? codeOnly[1].toLowerCase() : "", year: null };
}

// Map full faculty names (UserProfile.faculty) → short codes used in tags
const FACULTY_CODE: Record<string, string> = {
  "FDSE – Droit & Sciences Économiques": "eco",   // shared code for the faculty
  "FLA – Lettres & Arts":                "fla",
  "FST – Sciences & Technologies":       "fst",
  "FMP – Médecine & Pharmacie":          "fmp",
  "FASCH – Sciences Humaines":           "fasch",
  "FGC – Génie Civil":                   "fgc",
  "FA – Architecture":                   "fa",
  "FAMV – Agronomie & Médecine Vétérinaire": "famv",
};

// Category multiplier: how relevant is this post to the viewing user?
function categoryMultiplier(
  postTag:     string,
  viewerFaculty: string,
  viewerYear:    number,
): number {
  const { facultyCode: pCode, year: pYear } = parseTag(postTag);
  const vCode = FACULTY_CODE[viewerFaculty] ?? viewerFaculty.toLowerCase().slice(0, 4);

  const sameField   = pCode === vCode;
  const sameYear    = pYear !== null && pYear === viewerYear;

  if (sameField && sameYear) return 3.0;   // Exact match: same class + same field
  if (sameField)             return 2.0;   // Same field, different year
  return 1.0;                              // Different field — no boost
  // Note: "college match" (1.5×) is implicit since all users are in the same
  // college (FDSE). If multi-college support is added, check faculty prefix here.
}

// Engagement score: weighted sum of interactions
// likes=1pt  comments=3pt  reposts=5pt  views=0.1pt (passive, low weight)
function engagementScore(post: Post): number {
  return (post.likes * 1) + (post.commentCount * 3) + (post.reposts * 5) + (post.views * 0.1);
}

// Time in hours since the post was created (minimum 0.1 to avoid /0)
function hoursSince(iso: string): number {
  return Math.max(0.1, (Date.now() - new Date(iso).getTime()) / 3_600_000);
}

// ── Viral threshold — a regular/blue post that hits this engagement
//    within its first 2 hours temporarily jumps over gold posts
const VIRAL_ENGAGEMENT_THRESHOLD = 20;
const VIRAL_WINDOW_HOURS         = 2;

function isViral(post: Post): boolean {
  return (
    (post.author.badge === null || post.author.badge === "blue") &&
    engagementScore(post) >= VIRAL_ENGAGEMENT_THRESHOLD &&
    hoursSince(post.createdAt) <= VIRAL_WINDOW_HOURS
  );
}

// Raw priority score for a single post viewed by a specific user.
// seenGrayIds: set of gray post ids the viewer has already scrolled past —
// those posts lose their Wu boost and are ranked like regular posts (Wu=1)
// so they don't stack at the top of the feed once they've been seen.
function priorityScore(
  post:          Post,
  viewerFaculty: string,
  viewerYear:    number,
  seenGrayIds:   Set<string>,
): number {
  const rawBadge = post.author.badge ?? "none";
  // Once a gray post is seen it is demoted to the baseline weight (1)
  const effectiveBadge =
    rawBadge === "gray" && seenGrayIds.has(post.id) ? "none" : rawBadge;
  const Wu  = BADGE_WEIGHT[effectiveBadge] ?? 1;
  const Mc  = categoryMultiplier(post.author.tag, viewerFaculty, viewerYear);
  const E   = engagementScore(post);
  const T   = hoursSince(post.createdAt);
  return (Wu * Mc + E) / Math.pow(T, GRAVITY);
}

// ── Main feed sort: 70/20/10 bucket mix ──────────────────────
//
//  RELEVANCE  (70 %) — high Mc posts (same class/field)
//  AUTHORITY  (20 %) — gray + gold posts (institutional/leaders)
//  WILDCARD   (10 %) — viral posts that crossed the engagement bar
//
// Gray posts also get a "must-read" guarantee: the first unseen
// gray post is always injected at position 0 in the final feed
// (capped at one per 12-hour window via sessionStorage).
function rankFeed(
  posts:         Post[],
  viewerFaculty: string,
  viewerYear:    number,
  seenGrayIds:   Set<string>,
): Post[] {
  if (posts.length === 0) return [];

  // Score every post once
  const scored = posts.map(p => ({
    post:  p,
    score: priorityScore(p, viewerFaculty, viewerYear, seenGrayIds),
    Mc:    categoryMultiplier(p.author.tag, viewerFaculty, viewerYear),
    viral: isViral(p),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;

  // Bucket split sizes (at least 1 each when pool is small enough)
  const nRelevance = Math.max(1, Math.round(total * 0.70));
  const nAuthority = Math.max(1, Math.round(total * 0.20));
  // wildcard fills the rest

  // ── Relevance bucket: high Mc (same class or field)
  const relevance = scored
    .filter(s => s.Mc >= 2.0)
    .slice(0, nRelevance)
    .map(s => s.post);

  // ── Authority bucket: gray or gold, not already in relevance
  const relevanceIds = new Set(relevance.map(p => p.id));
  const authority = scored
    .filter(s => (s.post.author.badge === "gray" || s.post.author.badge === "gold") && !relevanceIds.has(s.post.id))
    .slice(0, nAuthority)
    .map(s => s.post);

  // ── Wildcard bucket: viral posts not in either bucket yet
  const authorityIds = new Set(authority.map(p => p.id));
  const wildcard = scored
    .filter(s => s.viral && !relevanceIds.has(s.post.id) && !authorityIds.has(s.post.id))
    .slice(0, Math.max(1, total - nRelevance - nAuthority))
    .map(s => s.post);

  // ── Fill gaps: anything not yet picked (ensures all posts appear)
  const pickedIds  = new Set([...relevance, ...authority, ...wildcard].map(p => p.id));
  const remainder  = scored.filter(s => !pickedIds.has(s.post.id)).map(s => s.post);

  // Interleave buckets so the feed doesn't feel like separate sections:
  // R R R A W R R R A W ...
  const merged: Post[] = [];
  let ri = 0, ai = 0, wi = 0, remi = 0;

  // Simple round-robin over the pattern [R, R, R, A, W]
  let slot = 0;
  const pattern = [
    { arr: relevance,  idx: () => ri,  adv: () => { ri++; } },
    { arr: relevance,  idx: () => ri,  adv: () => { ri++; } },
    { arr: relevance,  idx: () => ri,  adv: () => { ri++; } },
    { arr: authority,  idx: () => ai,  adv: () => { ai++; } },
    { arr: wildcard,   idx: () => wi,  adv: () => { wi++; } },
  ];

  while (merged.length < total) {
    const { arr, idx, adv } = pattern[slot % pattern.length];
    if (idx() < arr.length) {
      merged.push(arr[idx()]);
      adv();
    }
    slot++;
    // Safety: once all buckets exhausted, flush remainder in score order
    if (ri >= relevance.length && ai >= authority.length && wi >= wildcard.length) {
      merged.push(...remainder.slice(remi));
      break;
    }
  }

  // ── Gray "must-read" guarantee ────────────────────────────────
  // The first unseen gray post is pinned to position 0.
  // "Unseen" is determined by seenGrayIds (passed from the component).
  // Once the component marks it seen, on the next rankFeed call the post
  // will be scored with Wu=1 (demoted) and fall to its natural position.
  const firstUnseen = merged.find(
    p => p.author.badge === "gray" && !seenGrayIds.has(p.id),
  );

  if (firstUnseen) {
    const without = merged.filter(p => p.id !== firstUnseen.id);
    return [firstUnseen, ...without];
  }

  return merged;
}

// ── Viewer context helper — safe defaults when UserProfile is missing
interface ViewerCtx { faculty: string; year: number }
function viewerCtx(user: UserProfile | undefined | null): ViewerCtx {
  return {
    faculty: user?.faculty ?? "",
    year:    user?.year    ?? 1,
  };
}

// ═══════════════════════════════════════════════════════════════

const actionBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  background: "none", border: "none", cursor: "pointer",
  color: "#6B6A64", fontSize: 13, padding: "4px 8px 4px 0",
  WebkitTapHighlightColor: "transparent", transition: "color .15s",
};
const actionCount: React.CSSProperties = { fontSize: 13, lineHeight: 1 };

function toolbarBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    background: "none", border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    color, opacity: disabled ? 0.35 : 1,
    padding: "6px 8px", WebkitTapHighlightColor: "transparent", transition: "opacity .2s",
  };
}

// ── Avatar ────────────────────────────────────────────────────

function Avatar({ author, size = 40, photoUrl }: { author: Author; size?: number; photoUrl?: string | null }) {
  if (photoUrl) return (
    <img src={photoUrl} alt="" style={{
      width: size, height: size, borderRadius: "50%", objectFit: "cover",
      flexShrink: 0, border: "none",
    }} />
  );
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: author.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.35, color: "#fff",
      flexShrink: 0, fontFamily: "var(--f-sans)",
    }}>{author.avatar}</div>
  );
}

// ── VerifiedBadge ─────────────────────────────────────────────

function VerifiedBadge({ type, size = 15 }: { type: "gold" | "blue" | "gray"; size?: number }) {
  if (type === "blue") return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1D9BF0"/>
    </svg>
  );
  if (type === "gold") return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="ga" gradientUnits="userSpaceOnUse" x1="4.411" x2="18.083" y1="2.495" y2="21.508">
          <stop offset="0" stopColor="#f4e72a"/><stop offset=".539" stopColor="#cd8105"/>
          <stop offset=".68" stopColor="#cb7b00"/><stop offset="1" stopColor="#f4e72a"/>
        </linearGradient>
        <linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="5.355" x2="16.361" y1="3.395" y2="19.133">
          <stop offset="0" stopColor="#f9e87f"/><stop offset=".406" stopColor="#e2b719"/><stop offset=".989" stopColor="#e2b719"/>
        </linearGradient>
      </defs>
      <g clipRule="evenodd" fillRule="evenodd">
        <path d="M13.324 3.848L11 1.6 8.676 3.848l-3.201-.453-.559 3.184L2.06 8.095 3.48 11l-1.42 2.904 2.856 1.516.559 3.184 3.201-.452L11 20.4l2.324-2.248 3.201.452.559-3.184 2.856-1.516L18.52 11l1.42-2.905-2.856-1.516-.559-3.184zm-7.09 7.575l3.428 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="url(#ga)"/>
        <path d="M13.101 4.533L11 2.5 8.899 4.533l-2.895-.41-.505 2.88-2.583 1.37L4.2 11l-1.284 2.627 2.583 1.37.505 2.88 2.895-.41L11 19.5l2.101-2.033 2.895.41.505-2.88 2.583-1.37L17.8 11l1.284-2.627-2.583-1.37-.505-2.88zm-6.868 6.89l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="url(#gb)"/>
        <path d="M6.233 11.423l3.429 3.428 5.65-6.17.038-.033-.005 1.398-5.683 6.206-3.429-3.429-.003-1.405.005.003z" fill="#d18800"/>
      </g>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="gg" gradientUnits="userSpaceOnUse" x1="4" x2="18" y1="2" y2="22">
          <stop offset="0" stopColor="#a0bccf"/>
          <stop offset="1" stopColor="#5f8599"/>
        </linearGradient>
      </defs>
      <path clipRule="evenodd" fillRule="evenodd" d="M12.05 2.056c-.568-.608-1.532-.608-2.1 0l-1.393 1.49c-.284.303-.685.47-1.1.455L5.42 3.932c-.832-.028-1.514.654-1.486 1.486l.069 2.039c.014.415-.152.816-.456 1.1l-1.49 1.392c-.608.568-.608 1.533 0 2.101l1.49 1.393c.304.284.47.684.456 1.1l-.07 2.038c-.027.832.655 1.514 1.487 1.486l2.038-.069c.415-.014.816.152 1.1.455l1.392 1.49c.569.609 1.533.609 2.102 0l1.393-1.49c.283-.303.684-.47 1.099-.455l2.038.069c.832.028 1.515-.654 1.486-1.486L18 14.542c-.015-.415.152-.815.455-1.099l1.49-1.393c.608-.568.608-1.533 0-2.101l-1.49-1.393c-.303-.283-.47-.684-.455-1.1l.068-2.038c.029-.832-.654-1.514-1.486-1.486l-2.038.07c-.415.013-.816-.153-1.1-.456zm-5.817 9.367l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="url(#gg)"/>
    </svg>
  );
}

// ── StickerPicker ─────────────────────────────────────────────

function StickerPicker({ onPick, onClose }: { onPick: (s: string) => void; onClose: () => void }) {
  const C = useC();
  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0,
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: 12, zIndex: 20,
      boxShadow: "0 -4px 20px rgba(0,0,0,.14)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.sub }}>Stickers</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
        {STICKERS.map(stk => (
          <button key={stk} onClick={() => { onPick(stk); onClose(); }} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 26, padding: "6px 2px", lineHeight: 1,
            borderRadius: 8, WebkitTapHighlightColor: "transparent",
          }}>{stk}</button>
        ))}
      </div>
    </div>
  );
}

// ── QuoteEmbed — compact inline preview of the quoted post ──────

function QuoteEmbed({ q, onTap }: { q: QuotedPost; onTap?: () => void }) {
  const C = useC();
  return (
    <div
      onClick={onTap ? (e) => { e.stopPropagation(); onTap(); } : undefined}
      style={{
        border: `1.5px solid ${C.border}`,
        borderRadius: 12,
        padding: "10px 12px",
        marginTop: 8,
        background: C.card,
        cursor: onTap ? "pointer" : "default",
        transition: onTap ? "background .12s" : undefined,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{
          width: 18, height: 18, borderRadius: "50%",
          background: q.author.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0,
        }}>{q.author.avatar[0] ?? "?"}</div>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{q.author.name}</span>
        {q.author.badge && <VerifiedBadge type={q.author.badge} size={12} />}
        <span style={{ fontSize: 11, color: C.sub }}>{q.author.tag}</span>
      </div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {q.body.length > 160 ? q.body.slice(0, 160) + "…" : q.body}
      </div>
      {q.imgs.length > 0 && (
        <div style={{ marginTop: 6, borderRadius: 8, overflow: "hidden" }}>
          <img src={q.imgs[0]} alt="" style={{ width: "100%", maxHeight: 120, objectFit: "cover", display: "block" }} />
        </div>
      )}
    </div>
  );
}

// ── RepostSheet — X-style bottom sheet: Reposter | Citer ──────

function RepostSheet({ post, me, profilePic, isReposted, onClose, onSimpleRepost, onQuotePost }: {
  post:          Post;
  me:            Author;
  profilePic:    string | null;
  isReposted:    boolean;
  onClose:       () => void;
  onSimpleRepost: () => void;        // instant repost / undo
  onQuotePost:   (text: string, imgs?: string[]) => void; // quote-repost
}) {
  const C = useC();
  const { profilePic: ctxPic } = useProfile();
  const livePic = ctxPic ?? profilePic;

  // Quote compose state
  const [quoting, setQuoting]     = useState(false);
  const [text, setText]           = useState("");
  const [imgs, setImgs]           = useState<string[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);
  const gifRef  = useRef<HTMLInputElement>(null);
  const MAX     = maxChars(me.badge);

  useEffect(() => {
    if (quoting) setTimeout(() => textRef.current?.focus(), 80);
  }, [quoting]);

  const canPost = (text.trim().length > 0 || imgs.length > 0) && text.length <= MAX;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImgs(prev => [...prev, ev.target?.result as string].slice(0, 1));
    reader.readAsDataURL(file); e.target.value = "";
  };

  const submitQuote = () => {
    if (!canPost) return;
    onQuotePost(text.trim(), imgs.length > 0 ? imgs : undefined);
    onClose();
  };

  // ── Quote compose screen (shown after tapping "Citer")
  if (quoting) {
    return (
      <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 230, display: "flex", flexDirection: "column", animation: "fadeup .18s ease both" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
          <button onClick={() => setQuoting(false)} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 20, padding: 4, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>←</button>
          <button onClick={submitQuote} disabled={!canPost} style={{ background: canPost ? C.gold : C.border2, border: "none", borderRadius: 999, padding: "8px 22px", fontSize: 15, fontWeight: 700, color: canPost ? "#fff" : C.dim, cursor: canPost ? "pointer" : "not-allowed", fontFamily: "var(--f-sans)", transition: "background .15s" }}>
            Publier
          </button>
        </div>
        {/* Compose area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 0" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {livePic
              ? <img src={livePic} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 40, height: 40, borderRadius: "50%", background: me.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: "#fff", flexShrink: 0 }}>{me.avatar}</div>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>{me.tag}</div>
              <textarea
                ref={textRef} value={text}
                onChange={e => { if (e.target.value.length <= MAX) setText(e.target.value); }}
                placeholder="Ajoutez un commentaire…"
                style={{ width: "100%", border: "none", padding: 0, fontSize: 16, lineHeight: 1.55, color: C.text, background: "transparent", outline: "none", resize: "none", fontFamily: "var(--f-sans)", minHeight: 80 }}
              />
              {imgs.length > 0 && <ImgGrid imgs={imgs} onRemove={i => setImgs(prev => prev.filter((_,idx) => idx !== i))} />}
              {/* Quoted post embed preview */}
              <QuoteEmbed q={{ id: post.id, author: post.author, body: post.body, imgs: post.imgs }} />
            </div>
          </div>
        </div>
        {/* Toolbar */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 2, background: C.surface, flexShrink: 0, paddingBottom: "calc(8px + env(safe-area-inset-bottom))", position: "relative" }}>
          {showStickers && <StickerPicker onPick={stk => { setImgs([stk]); setShowStickers(false); }} onClose={() => setShowStickers(false)} />}
          <button onClick={() => imgRef.current?.click()} style={toolbarBtn(C.gold, false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => setShowStickers(v => !v)} style={toolbarBtn(showStickers ? C.gold : C.gold, false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8.5 15c1 1.5 5.5 1.5 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
          <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          <input ref={gifRef} type="file" accept="image/gif" style={{ display: "none" }} onChange={handleFile} />
        </div>
      </div>
    );
  }

  // ── Option sheet (Reposter / Citer)
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 220 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: C.surface, borderRadius: "20px 20px 0 0",
        zIndex: 221, padding: "0 0 40px",
        boxShadow: "0 -4px 24px rgba(0,0,0,.12)",
        animation: "sheetUp .28s cubic-bezier(.2,.8,.3,1) both",
      }}>
        <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 99, margin: "12px auto 20px" }} />
        {/* Reposter row */}
        <button onClick={() => { onSimpleRepost(); onClose(); }} style={{
          display: "flex", alignItems: "center", gap: 14,
          width: "100%", padding: "14px 24px",
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "var(--f-sans)", WebkitTapHighlightColor: "transparent",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M17 1l4 4-4 4" stroke={isReposted ? "#1DB33A" : C.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke={isReposted ? "#1DB33A" : C.text} strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M7 23l-4-4 4-4" stroke={isReposted ? "#1DB33A" : C.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke={isReposted ? "#1DB33A" : C.text} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: isReposted ? "#1DB33A" : C.text }}>
              {isReposted ? "Annuler le repost" : "Reposter"}
            </div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>
              {isReposted ? "Retirer votre repost du fil" : "Partager instantanément dans le fil"}
            </div>
          </div>
        </button>
        {/* Divider */}
        <div style={{ height: 1, background: C.border, margin: "0 24px" }} />
        {/* Citer row */}
        <button onClick={() => setQuoting(true)} style={{
          display: "flex", alignItems: "center", gap: 14,
          width: "100%", padding: "14px 24px",
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "var(--f-sans)", WebkitTapHighlightColor: "transparent",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 21l1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" stroke={C.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 10h.01M12 10h.01M16 10h.01" stroke={C.text} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Citer</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>Ajouter un commentaire avant de partager</div>
          </div>
        </button>
      </div>
    </>
  );
}

// ── ImgGrid — responsive 1/2/3/4 images ──────────────────────

function ImgGrid({ imgs, onRemove }: { imgs: string[]; onRemove?: (i: number) => void }) {
  if (!imgs.length) return null;
  const n = imgs.length;
  const isEmoji = (src: string) => !src.startsWith("data:") && !src.startsWith("http");
  const grid: React.CSSProperties =
    n === 1 ? { display: "block" } :
    n === 2 ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 } :
    n === 3 ? { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 3 } :
              { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 };
  return (
    <div style={{ ...grid, borderRadius: 12, overflow: "hidden", marginTop: 8 }}>
      {imgs.map((src, i) => {
        const emoji = isEmoji(src);
        return (
          <div key={i} style={{
            position: "relative", overflow: "hidden",
            gridRow: n === 3 && i === 0 ? "1 / 3" : undefined,
            aspectRatio: n === 1 ? undefined : "1",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {emoji ? (
              <div style={{ fontSize: 56, lineHeight: 1, padding: 8 }}>{src}</div>
            ) : (
              <img src={src} alt="" style={{
                width: "100%", height: "100%", objectFit: "cover", display: "block",
                maxHeight: n === 1 ? 260 : undefined,
              }} />
            )}
            {onRemove && (
              <button onClick={() => onRemove(i)} style={{
                position: "absolute", top: 6, right: 6,
                background: "rgba(0,0,0,.65)", border: "none", borderRadius: "50%",
                width: 26, height: 26, color: "#fff", fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", WebkitTapHighlightColor: "transparent",
              }}>✕</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── DM Icon ───────────────────────────────────────────────────

function DMIcon({ count }: { count: number }) {
  const C = useC();
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.sub, WebkitTapHighlightColor: "transparent" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.7"/>
          <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="1.7"/>
        </svg>
      </button>
      {count > 0 && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, borderRadius: "50%", background: "#C47F00", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-mono)" }}>{count}</div>
      )}
    </div>
  );
}

// ── ReplyScreen ───────────────────────────────────────────────

function ReplyScreen({ post, onClose, onSubmit, me = { id: "", name: "Moi", handle: "@moi", avatar: "M", color: "#C47F00", tag: "", badge: null }, profilePic = null }: {
  post: Post; onClose: () => void; onSubmit: (text: string, imgs?: string[]) => void; me?: Author; profilePic?: string | null;
}) {
  const C = useC();
  const { profilePic: ctxPic } = useProfile();
  const livePic = ctxPic ?? profilePic;
  const [text, setText]               = useState("");
  const [imgs, setImgs]               = useState<string[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);
  const gifRef  = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => textRef.current?.focus(), 80); }, []);

  const canPost = (text.trim().length > 0 || imgs.length > 0) && text.length <= 280;
  const remaining = 280 - text.length;

  const submit = () => {
    if (!canPost) return;
    onSubmit(text.trim(), imgs.length > 0 ? imgs : undefined);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImgs(prev => [...prev, ev.target?.result as string].slice(0, 1));
    reader.readAsDataURL(file); e.target.value = "";
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: useC().bg, zIndex: 130, display: "flex", flexDirection: "column", animation: "fadeup .18s ease both" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 20, padding: 4, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>←</button>
        <button onClick={submit} disabled={!canPost} style={{ background: canPost ? C.gold : C.border2, border: "none", borderRadius: 999, padding: "8px 22px", fontSize: 15, fontWeight: 700, color: canPost ? "#fff" : C.dim, cursor: canPost ? "pointer" : "not-allowed", fontFamily: "var(--f-sans)", transition: "background .15s" }}>Répondre</button>
      </div>
      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ padding: "14px 16px 0", display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <Avatar author={post.author} size={44} />
            <div style={{ width: 2, flex: 1, minHeight: 32, background: C.border2, borderRadius: 99, marginTop: 6 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{post.author.name}</span>
              {post.author.badge && <VerifiedBadge type={post.author.badge} size={14} />}
              <span style={{ fontSize: 12, color: C.dim }}>· {fmtTime(post.createdAt)}</span>
            </div>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>{post.author.tag}</div>
            <div style={{ fontSize: 15, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.body}</div>
            {post.imgs.length > 0 && <ImgGrid imgs={post.imgs} />}
            <div style={{ fontSize: 13, color: C.sub, marginTop: 10 }}>Répondre à <span style={{ color: C.blue }}>{post.author.name}</span></div>
          </div>
        </div>
        <div style={{ padding: "0 16px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Avatar author={me} size={44} photoUrl={livePic} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>{me.tag}</div>
            <textarea ref={textRef} value={text} onChange={e => setText(e.target.value)} placeholder="Postez votre réponse"
              style={{ width: "100%", border: "none", padding: 0, fontSize: 17, lineHeight: 1.55, color: C.text, background: "transparent", outline: "none", resize: "none", fontFamily: "var(--f-sans)", minHeight: 80 }} />
            {imgs.length > 0 && <ImgGrid imgs={imgs} onRemove={i => setImgs(prev => prev.filter((_,idx) => idx !== i))} />}
          </div>
        </div>
      </div>
      {/* Toolbar */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.surface, flexShrink: 0, paddingBottom: "calc(10px + env(safe-area-inset-bottom))", position: "relative" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {showStickers && <StickerPicker onPick={stk => { if (imgs.length < 1) setImgs([stk]); setShowStickers(false); }} onClose={() => setShowStickers(false)} />}
          <button onClick={() => imgRef.current?.click()} disabled={imgs.length >= 1} style={toolbarBtn(imgs.length >= 1 ? C.dim : C.blue, imgs.length >= 1)}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => gifRef.current?.click()} disabled={imgs.length >= 1} style={toolbarBtn(imgs.length >= 1 ? C.dim : C.blue, imgs.length >= 1)}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M8 12H5.5a2.5 2.5 0 0 1 0-5H8M13 7v5M16 7h3M16 9.5h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => setShowStickers(v => !v)} disabled={imgs.length >= 1} style={toolbarBtn(showStickers ? C.gold : imgs.length >= 1 ? C.dim : C.blue, imgs.length >= 1 && !showStickers)}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8.5 15c1 1.5 5.5 1.5 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
          <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          <input ref={gifRef} type="file" accept="image/gif" style={{ display: "none" }} onChange={handleFile} />
        </div>
        {text.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: remaining < 20 ? "#E8412A" : C.sub, fontFamily: "var(--f-mono)" }}>{remaining}</span>
            <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="12" cy="12" r="10" fill="none" stroke={C.border} strokeWidth="2.5"/>
              <circle cx="12" cy="12" r="10" fill="none" stroke={remaining < 20 ? "#E8412A" : C.gold} strokeWidth="2.5"
                strokeDasharray={`${Math.min(text.length / 280, 1) * 62.8} 62.8`} strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PostDetailScreen ──────────────────────────────────────────

function PostDetailScreen({ post, onClose, onComment, onLike, onRepost, me, profilePic = null, photoCache = {}, userId = "", autoOpenReply = false }: {
  post:           Post;
  onClose:        () => void;
  onComment:      (text: string, imgs?: string[]) => void;
  onLike:         () => void;
  onRepost:       () => void;
  me:             Author;
  profilePic?:    string | null;
  photoCache?:    Record<string, string>;
  userId?:        string;
  autoOpenReply?: boolean;  // ← NEW: open ReplyScreen immediately on mount
}) {
  const C = useC();
  const { profilePic: ctxPic, user: ctxUser } = useProfile();
  const myId = ctxUser?.id ?? me.id;
  const isMinePost = post.author.id === myId || post.author.id === me.id;
  const postAuthorPhoto = photoCache[post.author.id] ?? (isMinePost ? (ctxPic ?? profilePic) : null);

  // ← CHANGED: initialise with autoOpenReply so the reply screen opens on mount when triggered from the comment icon
  const [showReply, setShowReply] = useState(autoOpenReply);
  const [toast, setToast]         = useState(false);
  const [comments, setComments]   = useState<Comment[]>([]);
  const [commentPhotoCache, setCommentPhotoCache] = useState<Record<string, string>>(photoCache);

  useEffect(() => {
    const likedC    = loadSet(userId, "likedComments");
    const dislikedC = loadSet(userId, "dislikedComments");
    loadComments(post.id).then(async rows => {
      setComments(rows.map(r => dbToComment(r, likedC, dislikedC)));
      const ids = [...new Set(rows.map(r => r.author_id))];
      fetchUserPhotos(ids).then(p => setCommentPhotoCache(prev => ({ ...prev, ...p })));
    });
    const unsub = subscribeCommentChanges(post.id, ({ type, row }) => {
      const likedC2    = loadSet(userId, "likedComments");
      const dislikedC2 = loadSet(userId, "dislikedComments");
      if (type === "INSERT") {
        const nc = dbToComment(row, likedC2, dislikedC2);
        setComments(prev => prev.find(c => c.id === nc.id) ? prev : [...prev, nc]);
        fetchUserPhotos([row.author_id]).then(p => setCommentPhotoCache(prev => ({ ...prev, ...p })));
      } else if (type === "UPDATE") {
        setComments(prev => prev.map(c => c.id !== row.id ? c : {
          ...c,
          likes:    row.likes    ?? c.likes,
          dislikes: row.dislikes ?? c.dislikes,
        }));
      } else if (type === "DELETE") {
        setComments(prev => prev.filter(c => c.id !== row.id));
      }
    });
    return unsub;
  }, [post.id, userId]);

  // Merge locally-added comments with DB-loaded (dedup by id), sorted oldest→newest
  const allComments = [
    ...comments,
    ...post.comments.filter(c => !comments.find(d => d.id === c.id)),
  ].sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);

  const toggleCommentLike = (cid: string) => {
    setComments(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const liked = !c.liked;
      const lc = loadSet(userId, "likedComments");
      liked ? lc.add(cid) : lc.delete(cid);
      saveSet(userId, "likedComments", lc);
      deltaCommentLikes(cid, liked ? 1 : -1);
      return { ...c, liked, likes: liked ? c.likes + 1 : c.likes - 1, disliked: false };
    }));
  };

  const toggleCommentDislike = (cid: string) => {
    setComments(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const disliked = !c.disliked;
      const dc = loadSet(userId, "dislikedComments");
      disliked ? dc.add(cid) : dc.delete(cid);
      saveSet(userId, "dislikedComments", dc);
      return { ...c, disliked, dislikes: disliked ? c.dislikes + 1 : c.dislikes - 1, liked: false };
    }));
  };

  const handleSubmit = (text: string, imgs?: string[]) => {
    onComment(text, imgs);
    setShowReply(false);
    setToast(true);
    setTimeout(() => setToast(false), 2200);
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 125, display: "flex", flexDirection: "column", animation: "fadeup .18s ease both" }}>
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.text, padding: 4, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 18, color: C.text }}>Post</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Avatar author={post.author} size={46} photoUrl={postAuthorPhoto} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{post.author.name}</span>
                  {post.author.badge && <VerifiedBadge type={post.author.badge} size={15} />}
                </div>
                <div style={{ fontSize: 12, color: C.sub }}>{post.author.tag}</div>
              </div>
            </div>
            <div style={{ fontSize: 17, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.body}</div>
            {post.imgs.length > 0 && <ImgGrid imgs={post.imgs} />}
            <div style={{ fontSize: 13, color: C.dim, marginTop: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              {fmtTime(post.createdAt)} · <span style={{ color: C.text, fontWeight: 600 }}>{fmtNum(post.views)}</span> vues
            </div>
            <div style={{ display: "flex", gap: 20, padding: "10px 0", borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
              {[
                { n: post.commentCount, label: "réponse" + (post.commentCount !== 1 ? "s" : "") },
                { n: post.reposts,      label: "reposts" },
                { n: post.likes,        label: "j'aime"  },
              ].map(({ n, label }) => (
                <span key={label}><span style={{ fontWeight: 700, color: C.text }}>{fmtNum(n)}</span><span style={{ color: C.sub }}> {label}</span></span>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 4 }}>
              <button onClick={() => setShowReply(true)} style={actionBtn}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              </button>
              <button onClick={onRepost} style={{ ...actionBtn, color: post.reposted ? "#1DB33A" : "currentColor" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M7 23l-4-4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </button>
              <button onClick={onLike} style={{ ...actionBtn, color: post.liked ? "#E8412A" : "currentColor" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill={post.liked ? "#E8412A" : "none"}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={post.liked ? "#E8412A" : "currentColor"} strokeWidth="1.6"/></svg>
              </button>
            </div>
          </div>
          {/* Comments */}
          {allComments.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 16px", color: C.dim, fontSize: 14 }}>Aucune réponse pour l'instant.</div>
          ) : allComments.map(c => (
            <div key={c.id} style={{ display: "flex", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
              <Avatar author={c.author} size={40} photoUrl={commentPhotoCache[c.author.id] ?? (c.author.id === myId ? (ctxPic ?? null) : null)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{c.author.name}</span>
                  {c.author.badge && <VerifiedBadge type={c.author.badge} size={13} />}
                  <span style={{ fontSize: 12, color: C.dim }}>· {fmtTime(c.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>{c.author.tag}</div>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{c.body}</div>
                {c.imgs.length > 0 && <ImgGrid imgs={c.imgs} />}
                <div style={{ display: "flex", gap: 20, marginTop: 10, alignItems: "center" }}>
                  <button onClick={() => setShowReply(true)} style={actionBtn}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
                  </button>
                  <button onClick={() => toggleCommentLike(c.id)} style={{ ...actionBtn, color: c.liked ? "#E8412A" : "inherit" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={c.liked ? "#E8412A" : "none"}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={c.liked ? "#E8412A" : "currentColor"} strokeWidth="1.6"/></svg>
                    {c.likes > 0 && <span style={{ fontSize: 12, marginLeft: 2 }}>{fmtNum(c.likes)}</span>}
                  </button>
                  <button onClick={() => toggleCommentDislike(c.id)} style={{ ...actionBtn, color: c.disliked ? C.blue : "inherit" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={c.disliked ? C.blue : "none"} style={{ transform: "scaleY(-1)" }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={c.disliked ? C.blue : "currentColor"} strokeWidth="1.6"/></svg>
                    {c.dislikes > 0 && <span style={{ fontSize: 12, marginLeft: 2 }}>{fmtNum(c.dislikes)}</span>}
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div style={{ height: 80 }} />
        </div>
        <button onClick={() => setShowReply(true)} style={{ position: "fixed", bottom: 80, right: 20, width: 52, height: 52, borderRadius: "50%", background: C.blue, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(29,155,240,.4)", zIndex: 126, WebkitTapHighlightColor: "transparent" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
        </button>
      </div>
      {showReply && <ReplyScreen post={post} me={me} profilePic={profilePic} onClose={() => setShowReply(false)} onSubmit={handleSubmit} />}
      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: C.gold, color: "#fff", padding: "10px 22px", borderRadius: 999, fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(196,127,0,.4)", zIndex: 400, pointerEvents: "none", animation: "fadeup .2s ease both", whiteSpace: "nowrap" }}>
          ✓ Réponse publiée
        </div>
      )}
    </>
  );
}

// ── PostCard ──────────────────────────────────────────────────

function PostCard({ post, onLike, onRepost, onComment, onDelete, onHide, onView, me, profilePic = null, photoCache = {}, userId = "" }: {
  post:        Post;
  onLike:      () => void;
  onRepost:    (kind?: "simple" | "quote", quoteText?: string, quoteImgs?: string[]) => void;
  onComment:   (text: string, imgs?: string[]) => void;
  onDelete:    () => void;
  onHide:      () => void;
  onView:      () => void;
  me:          Author;
  profilePic?: string | null;
  photoCache?: Record<string, string>;
  userId?:     string;
}) {
  const C = useC();
  const { profilePic: ctxPic, user: ctxUser } = useProfile();
  const myId       = ctxUser?.id ?? me.id;
  const isMine     = post.author.id === myId || post.author.id === me.id;
  const authorPhoto = photoCache[post.author.id] ?? (isMine ? (ctxPic ?? profilePic) : null);
  const [expanded,            setExpanded]            = useState(false);
  const [showDetail,          setShowDetail]          = useState(false);
  const [showDetailWithReply, setShowDetailWithReply] = useState(false);
  const [showRepostSheet,     setShowRepostSheet]     = useState(false);
  const [showMenu,            setShowMenu]            = useState(false);
  const [showQuotedDetail,    setShowQuotedDetail]    = useState(false);
  const [likeAnimKey,         setLikeAnimKey]         = useState(0);
  const [likeAnimActive,      setLikeAnimActive]      = useState(false);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setLikeAnimKey(k => k + 1);
    setLikeAnimActive(true);
    setTimeout(() => setLikeAnimActive(false), 420);
    onLike();
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    // X (Twitter)-style WhatsApp share card:
    // Line 1: "Name (@handle) sur Civic"  ← bold header
    // Line 2: blank
    // Line 3: post body (truncated)
    // Line 4: blank
    // Line 5: "🔗 civic.app"  ← link triggers WhatsApp URL preview card
    const handle = post.author.handle
      || "@" + post.author.name.toLowerCase().replace(/\s+/g, "");
    const snippet = post.body.length > 280 ? post.body.slice(0, 280) + "\u2026" : post.body;
    // Send ONLY the URL — no surrounding text.
    // WhatsApp generates the full rich card (avatar, name, body, link) entirely
    // from the OG tags on the page. Any extra text appears as ugly flat text
    // OUTSIDE the card, exactly like image 1. URL-only = clean card like image 2.
    const postUrl = `https://civicfdse.vercel.app/post/${post.id}`;
    const url = `https://wa.me/?text=${encodeURIComponent(postUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const PREVIEW_LEN = 220;
  const isLong  = post.body.length > PREVIEW_LEN;
  const bodyText = isLong && !expanded ? post.body.slice(0, PREVIEW_LEN) + "…" : post.body;

  const quotedAsPost: Post | null = post.quotedPost ? {
    id: post.quotedPost.id, author: post.quotedPost.author,
    body: post.quotedPost.body, imgs: post.quotedPost.imgs,
    createdAt: new Date(0).toISOString(),
    likes: 0, liked: false, reposts: 0, reposted: false,
    views: 0, commentCount: 0, comments: [], showComments: false,
  } : null;

  return (
    <>
    {/* Keyframes for isolated like-button pop — scoped to this card */}
    <style>{`
      @keyframes likeHeartPop {
        0%   { transform: scale(1); }
        25%  { transform: scale(1.5); }
        55%  { transform: scale(0.88); }
        80%  { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      @keyframes menuFadeIn {
        from { opacity: 0; transform: scale(0.92) translateY(-4px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
    `}</style>
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 10px", cursor: "pointer" }} onClick={() => { setShowDetail(true); onView(); }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Avatar author={post.author} size={44} photoUrl={authorPhoto} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{post.author.name}</span>
                {post.author.badge && <VerifiedBadge type={post.author.badge} size={15} />}
                <span style={{ fontSize: 12, color: C.dim }}>· {fmtTime(post.createdAt)}</span>
              </div>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 1 }}>{post.author.tag}</div>
            </div>
            {/* ··· menu — always visible, owner: delete | non-owner: hide */}
            <div style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <button onClick={e => { e.stopPropagation(); setShowMenu(v => !v); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, padding: "0 4px 0 8px", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>···</button>
              {showMenu && (
                <>
                  <div onClick={() => setShowMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 300 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, zIndex: 301, minWidth: 190, boxShadow: "0 8px 32px rgba(0,0,0,.18)", overflow: "hidden", animation: "menuFadeIn .15s ease both" }}>
                    {/* Share to WhatsApp */}
                    <button onClick={handleShare} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--f-sans)", fontSize: 15, color: C.text, WebkitTapHighlightColor: "transparent", borderBottom: `1px solid ${C.border}` }}>
                      <svg width="19" height="19" viewBox="0 0 32 32" fill="none">
                        <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.613 1.832 6.511L4 29l7.697-1.813A11.94 11.94 0 0 0 16 28c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
                        <path d="M21.5 18.5c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.41-1.49-.89-.79-1.49-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.68-1.64-.93-2.24-.24-.59-.49-.51-.68-.52-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.19-.57-.34z" fill="#fff"/>
                      </svg>
                      Partager sur WhatsApp
                    </button>
                    {isMine ? (
                      <button onClick={e => { e.stopPropagation(); setShowMenu(false); onDelete(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--f-sans)", fontSize: 15, color: "#E8412A", WebkitTapHighlightColor: "transparent" }}>
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Supprimer
                      </button>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setShowMenu(false); onHide(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--f-sans)", fontSize: 15, color: C.text, WebkitTapHighlightColor: "transparent" }}>
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                        Ne plus voir ce post
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.55, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{bodyText}</div>
          {isLong && (
            <button onClick={e => { e.stopPropagation(); setExpanded(x => !x); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.blue, fontSize: 14, fontWeight: 600, padding: "2px 0", fontFamily: "var(--f-sans)", WebkitTapHighlightColor: "transparent" }}>
              {expanded ? "Voir moins" : "Voir plus"}
            </button>
          )}
          {post.imgs.length > 0 && <ImgGrid imgs={post.imgs} />}
          {/* Quote embed — shown when this post is a quote-repost */}
          {post.quotedPost && (
            <QuoteEmbed q={post.quotedPost} onTap={() => setShowQuotedDetail(true)} />
          )}
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingRight: 8 }}>
            {/* Comment button */}
            <button onClick={e => { e.stopPropagation(); setShowDetailWithReply(true); onView(); }} style={actionBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              {post.commentCount > 0 && <span style={actionCount}>{fmtNum(post.commentCount)}</span>}
            </button>
            {/* Repost button — opens RepostSheet */}
            <button onClick={e => { e.stopPropagation(); setShowRepostSheet(true); }} style={{ ...actionBtn, color: post.reposted ? "#1DB33A" : "currentColor" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M17 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                <path d="M7 23l-4-4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              {post.reposts > 0 && <span style={actionCount}>{fmtNum(post.reposts)}</span>}
            </button>
            {/* Like button — isolated pop animation, never touches the card */}
            <button onClick={handleLike} style={{ ...actionBtn, color: post.liked ? "#E8412A" : "currentColor" }}>
              <span key={likeAnimKey} style={{ display: "inline-flex", willChange: "transform", animation: likeAnimActive ? "likeHeartPop .42s cubic-bezier(.2,.8,.3,1) both" : "none", transformOrigin: "center", pointerEvents: "none" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={post.liked ? "#E8412A" : "none"}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={post.liked ? "#E8412A" : "currentColor"} strokeWidth="1.6"/>
                </svg>
              </span>
              {post.likes > 0 && <span style={actionCount}>{fmtNum(post.likes)}</span>}
            </button>
            {/* Views — display only */}
            <button style={actionBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              <span style={actionCount}>{fmtNum(post.views)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    {/* PostDetailScreen */}
    {(showDetail || showDetailWithReply) && (
      <PostDetailScreen
        post={post}
        me={me}
        profilePic={profilePic}
        photoCache={photoCache}
        userId={userId}
        autoOpenReply={showDetailWithReply}
        onClose={() => { setShowDetail(false); setShowDetailWithReply(false); }}
        onComment={(text, imgs) => onComment(text, imgs)}
        onLike={onLike}
        onRepost={onRepost}
      />
    )}
    {/* PostDetailScreen for quoted original (tap QuoteEmbed) */}
    {showQuotedDetail && quotedAsPost && (
      <PostDetailScreen
        post={quotedAsPost} me={me} profilePic={profilePic}
        photoCache={photoCache} userId={userId} autoOpenReply={false}
        onClose={() => setShowQuotedDetail(false)}
        onComment={() => {}} onLike={() => {}} onRepost={() => {}}
      />
    )}
    {/* RepostSheet — X-style Reposter / Citer sheet */}
    {showRepostSheet && (
      <RepostSheet
        post={post}
        me={me}
        profilePic={profilePic}
        isReposted={post.reposted}
        onClose={() => setShowRepostSheet(false)}
        onSimpleRepost={onRepost}
        onQuotePost={(text, imgs) => onRepost("quote", text, imgs)}
      />
    )}
    </>
  );
}

// ── InlineCompose — Twitter-style post box at top of feed ─────

function InlineCompose({ me, profilePic = null, onPost }: {
  me: Author; profilePic?: string | null; onPost: (text: string, imgs?: string[]) => void;
}) {
  const C = useC();
  const { profilePic: ctxPic } = useProfile();
  const livePic   = ctxPic ?? profilePic;
  const [text, setText]               = useState("");
  const [imgs, setImgs]               = useState<string[]>([]);
  const [focused, setFocused]         = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);
  const gifRef  = useRef<HTMLInputElement>(null);
  const MAX      = maxChars(me.badge);
  const MAX_IMGS = maxImgs(me.badge);

  useEffect(() => {
    const el = textRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  }, [text]);

  const canPost   = (text.trim().length > 0 || imgs.length > 0) && text.length <= MAX;
  const remaining = MAX - text.length;
  const filled    = Math.min(text.length / MAX, 1);
  const isWarning = remaining <= 40;
  const isDanger  = remaining <= 0;
  const CIRC      = 2 * Math.PI * 11;
  const imgsFull  = imgs.length >= MAX_IMGS;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImgs(prev => [...prev, ev.target?.result as string].slice(0, MAX_IMGS));
    reader.readAsDataURL(file); e.target.value = "";
  };

  const submit = () => {
    if (!canPost) return;
    onPost(text.trim(), imgs.length > 0 ? imgs : undefined);
    setText(""); setImgs([]); setFocused(false);
    if (textRef.current) textRef.current.style.height = "auto";
  };

  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 16px 0" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Avatar */}
        <Avatar author={me} size={40} photoUrl={livePic} />

        {/* Right side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + badge + tag */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{me.name}</span>
            {me.badge && <VerifiedBadge type={me.badge} size={13} />}
            <span style={{ fontSize: 12, color: C.sub }}>{me.tag}</span>
          </div>
          <textarea
            ref={textRef}
            value={text}
            onChange={e => { if (e.target.value.length <= MAX) setText(e.target.value); }}
            onFocus={() => setFocused(true)}
            placeholder="Quoi de neuf dans vos projets ?"
            rows={focused || text ? 3 : 1}
            style={{
              width: "100%", border: "none", padding: "8px 0 4px",
              fontSize: 16, lineHeight: 1.55, color: C.text,
              background: "transparent", outline: "none", resize: "none",
              fontFamily: "var(--f-sans)", overflowY: "hidden",
              transition: "height .15s",
            }}
          />

          {/* Image preview */}
          {imgs.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <ImgGrid imgs={imgs} onRemove={i => setImgs(prev => prev.filter((_,idx) => idx !== i))} />
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: C.border, margin: "4px 0" }} />

          {/* Toolbar + Post button */}
          <div style={{ display: "flex", alignItems: "center", padding: "4px 0 8px", position: "relative" }}>
            {showStickers && <StickerPicker onPick={stk => { if (!imgsFull) setImgs(prev => [...prev, stk].slice(0, MAX_IMGS)); setShowStickers(false); }} onClose={() => setShowStickers(false)} />}

            <button onClick={() => imgRef.current?.click()} disabled={imgsFull} style={toolbarBtn(imgsFull ? C.dim : C.gold, imgsFull)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
            <button onClick={() => gifRef.current?.click()} disabled={imgsFull} style={toolbarBtn(imgsFull ? C.dim : C.gold, imgsFull)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.8"/><text x="5.5" y="15.5" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="var(--f-sans)" letterSpacing="0.5">GIF</text></svg>
            </button>
            <button onClick={() => setShowStickers(v => !v)} disabled={imgsFull && !showStickers} style={toolbarBtn(showStickers ? C.gold : imgsFull ? C.dim : C.gold, imgsFull && !showStickers)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8.5 15c1 1.5 5.5 1.5 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>

            <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
            <input ref={gifRef} type="file" accept="image/gif" style={{ display: "none" }} onChange={handleFile} />

            <div style={{ flex: 1 }} />

            {/* Character ring */}
            {text.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 10 }}>
                {remaining <= 100 && (
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: isWarning ? 700 : 400, color: isDanger ? "#E8412A" : isWarning ? C.gold : C.sub }}>{remaining}</span>
                )}
                <svg width="22" height="22" viewBox="0 0 28 28" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="14" cy="14" r="11" fill="none" stroke={C.border} strokeWidth="2.5"/>
                  <circle cx="14" cy="14" r="11" fill="none" stroke={isDanger ? "#E8412A" : C.gold} strokeWidth="2.5"
                    strokeDasharray={`${filled * CIRC} ${CIRC}`} strokeLinecap="round"/>
                </svg>
              </div>
            )}

            {/* Post button */}
            <button onClick={submit} disabled={!canPost} style={{
              background: canPost ? C.gold : C.border2,
              border: "none", borderRadius: 999,
              padding: "7px 20px", fontSize: 14, fontWeight: 700,
              color: canPost ? "#fff" : C.dim,
              cursor: canPost ? "pointer" : "not-allowed",
              fontFamily: "var(--f-sans)", transition: "background .15s",
              WebkitTapHighlightColor: "transparent",
            }}>Publier</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposeModal({ onClose, onPost, me, profilePic = null, initialText = "" }: { onClose: () => void; onPost: (text: string, imgs?: string[]) => void; me: Author; profilePic?: string | null; initialText?: string }) {
  const C = useC();
  const { profilePic: ctxPic } = useProfile();
  const livePic = ctxPic ?? profilePic;
  const [text, setText]               = useState(initialText);
  const [imgs, setImgs]               = useState<string[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef  = useRef<HTMLInputElement>(null);
  const gifRef  = useRef<HTMLInputElement>(null);
  const MAX      = maxChars(me.badge);
  const MAX_IMGS = maxImgs(me.badge);

  useEffect(() => { setTimeout(() => textRef.current?.focus(), 80); }, []);
  useEffect(() => {
    const el = textRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  }, [text]);

  const canPost   = (text.trim().length > 0 || imgs.length > 0) && text.length <= MAX;
  const remaining = MAX - text.length;
  const filled    = Math.min(text.length / MAX, 1);
  const isWarning = remaining <= 40;
  const isDanger  = remaining <= 0;
  const CIRC      = 2 * Math.PI * 11;
  const imgsFull  = imgs.length >= MAX_IMGS;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImgs(prev => [...prev, ev.target?.result as string].slice(0, MAX_IMGS));
    reader.readAsDataURL(file); e.target.value = "";
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 200, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.surface }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 22, padding: 0, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>←</button>
        <button onClick={() => { if (canPost) { onPost(text.trim(), imgs.length > 0 ? imgs : undefined); } }} disabled={!canPost} style={{ background: canPost ? C.gold : C.border2, border: "none", borderRadius: 999, padding: "8px 24px", fontSize: 15, fontWeight: 700, color: canPost ? "#fff" : C.dim, cursor: canPost ? "pointer" : "not-allowed", fontFamily: "var(--f-sans)", transition: "background .15s" }}>Publier</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 24px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Avatar author={me} size={44} photoUrl={livePic} />
            <div style={{ width: 2, flex: 1, minHeight: 20, background: C.border, borderRadius: 1, marginTop: 6 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 20, overflow: "visible", position: "relative" }}>
            <div style={{ padding: "12px 14px 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{me.name}</span>
              {me.badge && <VerifiedBadge type={me.badge} size={14} />}
              <span style={{ fontSize: 12, color: C.sub }}>{me.tag}</span>
              {(me.badge === "gold" || me.badge === "gray") && (
                <span style={{ fontSize: 10, color: C.gold, fontWeight: 600 }}>· {MAX} car. · {MAX_IMGS} img</span>
              )}
            </div>
            <textarea ref={textRef} value={text} onChange={e => { if (e.target.value.length <= MAX) setText(e.target.value); }} placeholder="Quoi de neuf dans vos projets ?"
              style={{ width: "100%", border: "none", padding: "8px 14px 10px", fontSize: 16, lineHeight: 1.65, color: C.text, background: "transparent", outline: "none", resize: "none", fontFamily: "var(--f-sans)", minHeight: 230, overflowY: "hidden" }} />
            {imgs.length > 0 && (
              <div style={{ margin: "0 10px 10px" }}>
                <ImgGrid imgs={imgs} onRemove={i => setImgs(prev => prev.filter((_,idx) => idx !== i))} />
              </div>
            )}
            <div style={{ borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "6px 6px 6px 4px", position: "relative" }}>
              {showStickers && <StickerPicker onPick={stk => { if (!imgsFull) setImgs(prev => [...prev, stk].slice(0, MAX_IMGS)); setShowStickers(false); }} onClose={() => setShowStickers(false)} />}
              <button onClick={() => imgRef.current?.click()} disabled={imgsFull} style={toolbarBtn(imgsFull ? C.dim : C.gold, imgsFull)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </button>
              <button onClick={() => gifRef.current?.click()} disabled={imgsFull} style={toolbarBtn(imgsFull ? C.dim : C.gold, imgsFull)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.8"/><text x="5.5" y="15.5" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="var(--f-sans)" letterSpacing="0.5">GIF</text></svg>
              </button>
              <button onClick={() => setShowStickers(v => !v)} disabled={imgsFull && !showStickers} style={toolbarBtn(showStickers ? C.gold : imgsFull ? C.dim : C.gold, imgsFull && !showStickers)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8.5 15c1 1.5 5.5 1.5 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </button>
              <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
              <input ref={gifRef} type="file" accept="image/gif" style={{ display: "none" }} onChange={handleFile} />
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 6 }}>
                {remaining <= 100 && (
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: isWarning ? 700 : 400, color: isDanger ? "#E8412A" : isWarning ? C.gold : C.sub, minWidth: 26, textAlign: "right" }}>{remaining}</span>
                )}
                <svg width="24" height="24" viewBox="0 0 28 28" style={{ transform: "rotate(-90deg)", display: "block", flexShrink: 0 }}>
                  <circle cx="14" cy="14" r="11" fill="none" stroke={C.border} strokeWidth="2.5"/>
                  <circle cx="14" cy="14" r="11" fill="none" stroke={isDanger ? "#E8412A" : C.gold} strokeWidth="2.5"
                    strokeDasharray={`${filled * CIRC} ${CIRC}`} strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CommunityHeader ───────────────────────────────────────────

// ── DB ↔ local converters ─────────────────────────────────────

function authorToDb(a: Author) {
  return {
    author_id:     a.id,
    author_nom:    a.name.split(" ")[0] ?? a.name,
    author_prenom: a.name.split(" ").slice(1).join(" ") ?? "",
    author_tag:    a.tag,
    author_color:  a.color,
    author_badge:  a.badge ?? null,
  };
}

function dbToAuthor(row: DBPost | DBComment): Author {
  return {
    id:     row.author_id,
    name:   `${row.author_nom} ${row.author_prenom}`.trim(),
    handle: `@${row.author_nom.toLowerCase()}`,
    avatar: (row.author_nom[0] ?? "") + (row.author_prenom[0] ?? ""),
    color:  row.author_color,
    tag:    row.author_tag,
    badge:  row.author_badge as Author["badge"],
  };
}

function postToDb(p: Post): DBPost {
  const row: DBPost & { quoted_post?: string } = {
    id: p.id,
    ...authorToDb(p.author),
    body:          p.body,
    imgs:          p.imgs,
    time_label:    p.createdAt,
    likes:         p.likes,
    reposts:       p.reposts,
    views:         p.views,
    comment_count: p.commentCount,
    created_at:    p.createdAt,
  };
  if (p.quotedPost) {
    row.quoted_post = JSON.stringify(p.quotedPost);
  }
  return row as DBPost;
}

function dbToPost(row: DBPost & { quoted_post?: string }, likedSet?: Set<string>, repostedSet?: Set<string>): Post {
  const iso = row.created_at ?? row.time_label ?? new Date().toISOString();
  let quotedPost: QuotedPost | undefined;
  if (row.quoted_post) {
    try { quotedPost = JSON.parse(row.quoted_post) as QuotedPost; } catch {}
  }
  return {
    id:           row.id,
    author:       dbToAuthor(row),
    body:         row.body,
    imgs:         row.imgs ?? [],
    createdAt:    iso,
    likes:        row.likes ?? 0,
    liked:        likedSet?.has(row.id) ?? false,
    reposts:      row.reposts ?? 0,
    reposted:     repostedSet?.has(row.id) ?? false,
    views:        row.views ?? 0,
    commentCount: row.comment_count ?? 0,
    comments:     [],
    showComments: false,
    quotedPost,
  };
}

function commentToDb(c: Comment, postId: string): DBComment {
  return {
    id:      c.id,
    post_id: postId,
    ...authorToDb(c.author),
    body:       c.body,
    imgs:       c.imgs,
    time_label: c.createdAt,
    likes:      c.likes,
    dislikes:   c.dislikes,
    created_at: c.createdAt,
  };
}

function dbToComment(row: DBComment, likedSet?: Set<string>, dislikedSet?: Set<string>): Comment {
  const iso = row.created_at ?? row.time_label ?? new Date().toISOString();
  return {
    id:       row.id,
    author:   dbToAuthor(row),
    body:     row.body,
    imgs:     row.imgs ?? [],
    createdAt: iso,
    likes:    row.likes ?? 0,
    liked:    likedSet?.has(row.id) ?? false,
    dislikes: row.dislikes ?? 0,
    disliked: dislikedSet?.has(row.id) ?? false,
  };
}

// ── Build tag from UserProfile ────────────────────────────────
function buildAuthorTag(u: UserProfile): string {
  const fmap: Record<string,string> = {
    "FDSE – Droit & Sciences Économiques": "eco",
    "FLA – Lettres & Arts": "fla",
    "FST – Sciences & Technologies": "fst",
    "FMP – Médecine & Pharmacie": "fmp",
    "FASCH – Sciences Humaines": "fasch",
    "FGC – Génie Civil": "fgc",
    "FA – Architecture": "fa",
    "FAMV – Agronomie & Médecine Vétérinaire": "famv",
  };
  const rmap: Record<string,string> = {
    "Délégué·e de classe":                "del.",
    "Président·e d'association":          "prés.",
    "Membre CEP":                         "cep",
    "CEP — Responsable désigné·e":        "cep.resp.",
    "Rectorat":                           "rect.",
    // Elected post roles written by endElection for confirmed winners
    "Responsable Affaires Académiques":   "RAA",
    "Délégué·e":                          "dél.",
    "Trésorier·e":                        "trés.",
    "Secrétaire":                         "sec.",
    "Président·e du Comité Exécutif":     "prés. CE",
  };
  const code = fmap[u.faculty] ?? "fdse";
  const base = `${code}.${u.year}`;
  const role = rmap[u.role];
  return role ? `${base} · ${role}` : base;
}

export function CommunityHeader({ tab, setTab, user }: { tab: "all"|"mine"; setTab: (t: "all"|"mine") => void; user?: import("./AuthFlow").UserProfile | null }) {
  const C = useC();
  const { user: ctxUser } = useProfile();
  // Use both sources — ctxUser updates after UserSync, user prop may arrive first
  const myId = ctxUser?.id ?? user?.id ?? "";
  const [showMessages, setShowMessages] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!myId) return;
    const refresh = () =>
      loadConversations(myId).then(rows => {
        setUnread(rows.reduce((s, r) => s + (r.user_a === myId ? r.unread_a : r.unread_b), 0));
      });
    refresh();
    const unsub = subscribeConversations(myId, refresh);
    return unsub;
  }, [myId]); // re-runs whenever myId resolves from "" to the real id

  return (
    <>
      {showMessages && <MessagesScreen onClose={() => setShowMessages(false)} />}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 0" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, color: C.text, letterSpacing: "-.3px" }}>Réseau étudiant</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 1, marginBottom: 8 }}>Trouvez vos partenaires, co-fondateurs, collaborateurs</div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <div onClick={() => setShowMessages(true)}><DMIcon count={unread} /></div>
            <AppMenu user={user} />
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {([["all", "Tous les posts"], ["mine", "Mes posts"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === id ? 700 : 400, color: tab === id ? C.text : C.sub, borderBottom: `2px solid ${tab === id ? C.gold : "transparent"}`, fontFamily: "var(--f-sans)", transition: "color .15s, border-color .15s", WebkitTapHighlightColor: "transparent" }}>{label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── CommunityTab ──────────────────────────────────────────────

export function CommunityTab({ feedTab, currentUser, autoOpenCompose = false, composePrefill = "", onComposeClosed }: { feedTab: "all" | "mine"; currentUser?: UserProfile; autoOpenCompose?: boolean; composePrefill?: string; onComposeClosed?: () => void }) {
  const C = useC();
  const { profilePic } = useProfile();

  // Build ME from the authenticated user
  const ME_LIVE: Author = currentUser ? {
    id:     currentUser.id,
    name:   `${currentUser.nom} ${currentUser.prenom}`.trim() || "Moi",
    handle: `@${(currentUser.nom + "." + currentUser.prenom).toLowerCase().replace(/\s+/g,".")}`,
    avatar: currentUser.nom
              ? (currentUser.nom[0] + (currentUser.prenom[0] ?? "")).toUpperCase()
              : "M",
    color:  currentUser.avatarColor,
    tag:    buildAuthorTag(currentUser),
    badge:  currentUser.badge,
  } : { id: "", name: "Moi", handle: "@moi", avatar: "M", color: "#C47F00", tag: "", badge: null };

  const uid = currentUser?.id ?? "";

  const [posts, setPosts]             = useState<Post[]>([]);
  const [loading, setLoading]         = useState(true);
  const [photoCache, setPhotoCache]   = useState<Record<string, string>>({});
  const [showCompose, setShowCompose] = useState(autoOpenCompose);
  const [composeDraft, setComposeDraft] = useState(composePrefill);

  // ── Hidden posts — declared BEFORE `feed` so it can filter them ──
  const HIDDEN_KEY = `civique_hidden_${uid}`;
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(`civique_hidden_${currentUser?.id ?? ""}`) ?? "[]")); }
    catch { return new Set<string>(); }
  });

  const hidePost = useCallback((id: string) => {
    setHiddenPostIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [HIDDEN_KEY]);

  // Per-session view guard: a post counts as viewed only once per session
  const viewedPosts = useRef<Set<string>>(new Set());

  // ── Seen gray posts tracking ──────────────────────────────────
  // Loaded once from sessionStorage; updated as gray posts are scrolled.
  const GRAY_SEEN_KEY = "civique_gray_seen";
  const seenGrayIds = useRef<Set<string>>((() => {
    try { return new Set<string>(JSON.parse(sessionStorage.getItem(GRAY_SEEN_KEY) ?? "[]")); }
    catch { return new Set<string>(); }
  })());

  // Called when a gray post is rendered visible for the first time
  const markGraySeen = useCallback((postId: string) => {
    if (seenGrayIds.current.has(postId)) return;
    seenGrayIds.current.add(postId);
    try { sessionStorage.setItem(GRAY_SEEN_KEY, JSON.stringify([...seenGrayIds.current])); } catch {}
  }, []);

  // ── Score-freeze: after any local engagement action, hold the feed
  //    ORDER stable for SCORE_FREEZE_MS so posts don't jump position
  //    the instant a user taps like/repost/comment.
  //
  //    Key insight: we freeze only the SORT ORDER (a Map<postId → rank>),
  //    NOT the post data. This means:
  //      • Like/repost counters update instantly (live post objects used)
  //      • Card positions don't jump until the freeze expires
  // ─────────────────────────────────────────────────────────────────
  const SCORE_FREEZE_MS  = 4000;
  const scoreFreezeUntil = useRef<number>(0);
  // frozenOrder maps postId → its rank index from the last rankFeed call
  const frozenOrder      = useRef<Map<string, number>>(new Map());
  // Trigger a re-render after the freeze expires so the new order shows
  const [, forceUpdate]  = useState(0);

  // Stamp a freeze — only extends if already active, never restarts the timer
  const stampFreeze = useCallback(() => {
    const now = Date.now();
    // If no freeze is currently active, capture the current order first
    if (now >= scoreFreezeUntil.current) {
      // frozenOrder will be set by the feed derivation block below on next render
      // We just mark the future expiry; the order capture happens in the feed IIFE
      scoreFreezeUntil.current = now + SCORE_FREEZE_MS;
      setTimeout(() => forceUpdate(n => n + 1), SCORE_FREEZE_MS + 50);
    }
    // If already frozen, just extend the window slightly (user is still interacting)
    else {
      scoreFreezeUntil.current = now + SCORE_FREEZE_MS;
    }
  }, []);

  // Load posts + user photos on mount, then subscribe to realtime changes
  useEffect(() => {
    const likedPosts    = loadSet(uid, "likedPosts");
    const repostedPosts = loadSet(uid, "repostedPosts");

    loadPosts().then(async rows => {
      setPosts(rows.map(r => dbToPost(r, likedPosts, repostedPosts)));
      setLoading(false);
      const ids = [...new Set(rows.map(r => r.author_id))];
      fetchUserPhotos(ids).then(p => setPhotoCache(p));
    });

    const unsub = subscribePostChanges(({ type, row }) => {
      if (type === "INSERT") {
        setPosts(prev => {
          if (prev.find(p => p.id === row.id)) return prev;
          const lp = loadSet(uid, "likedPosts");
          const rp = loadSet(uid, "repostedPosts");
          return [dbToPost(row, lp, rp), ...prev];
        });
        setPhotoCache(prev => {
          if (!prev[row.author_id])
            fetchUserPhotos([row.author_id]).then(p => setPhotoCache(c => ({ ...c, ...p })));
          return prev;
        });
      } else if (type === "UPDATE") {
        setPosts(prev => prev.map(p => p.id !== row.id ? p : {
          ...p,
          likes:        row.likes ?? p.likes,
          reposts:      row.reposts ?? p.reposts,
          views:        row.views ?? p.views,
          commentCount: row.comment_count ?? p.commentCount,
        }));
      } else if (type === "DELETE") {
        setPosts(prev => prev.filter(p => p.id !== row.id));
      }
    });

    return unsub;
  }, [uid]);
  const [fabVisible, setFabVisible]  = useState(true);
  const lastScrollY = useRef(0);
  const nextId = useRef(100);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = (e.target as HTMLDivElement).scrollTop;
    if (y < 60) { setFabVisible(true); }
    else if (y > lastScrollY.current + 8) { setFabVisible(false); }
    else if (y < lastScrollY.current - 8) { setFabVisible(true); }
    lastScrollY.current = y;
  }, []);

  // ── Apply ranking algorithm on "all" tab; "mine" stays chronological
  const { faculty: vFaculty, year: vYear } = viewerCtx(currentUser);
  const feed = (() => {
    const visible = posts.filter(p => !hiddenPostIds.has(p.id));
    if (feedTab !== "all") return visible.filter(p => p.author.id === ME_LIVE.id);
    const posts_for_rank = visible;

    const isFrozen = Date.now() < scoreFreezeUntil.current;

    if (isFrozen && frozenOrder.current.size > 0) {
      const knownRank = (id: string) => frozenOrder.current.get(id) ?? Infinity;
      return [...posts_for_rank].sort((a, b) => knownRank(a.id) - knownRank(b.id));
    }

    const ranked = rankFeed(posts_for_rank, vFaculty, vYear, seenGrayIds.current);

    // Capture this order into frozenOrder so stampFreeze can use it
    frozenOrder.current = new Map(ranked.map((p, i) => [p.id, i]));

    // Mark the first unseen gray post as seen (it was just pinned to top)
    const topGray = ranked.find(p => p.author.badge === "gray" && !seenGrayIds.current.has(p.id));
    if (topGray) markGraySeen(topGray.id);

    return ranked;
  })();

  const addPost = (text: string, imgs?: string[]) => {
    const now = new Date().toISOString();
    const newPost: Post = {
      id: `p${Date.now()}_${nextId.current++}`,
      author: ME_LIVE, body: text, imgs: imgs ?? [],
      createdAt: now, likes: 0, liked: false,
      reposts: 0, reposted: false, views: 1,
      commentCount: 0, comments: [], showComments: false,
    };
    setPosts(prev => [newPost, ...prev]);
    insertPost(postToDb(newPost));
  };

  const addComment = (postId: string, text: string, imgs?: string[]) => {
    stampFreeze(); // hold feed order stable for SCORE_FREEZE_MS
    const now = new Date().toISOString();
    const nc: Comment = {
      id: `c${Date.now()}_${nextId.current++}`,
      author: ME_LIVE, body: text, imgs: imgs ?? [],
      createdAt: now, likes: 0, liked: false, dislikes: 0, disliked: false,
    };
    setPosts(prev => prev.map(p => p.id !== postId ? p : {
      ...p, comments: [...p.comments, nc], commentCount: p.commentCount + 1,
    }));
    insertComment(commentToDb(nc, postId));
    incrementCommentCount(postId);

    // Nametag drop detection: find @handle mentions in the comment
    const mentions = text.match(/@[\w\u00C0-\u024F]+/g) ?? [];
    if (mentions.length > 0) {
      // Find the post author to notify them if the mention matches their handle
      const post = posts.find(p => p.id === postId);
      if (post) {
        for (const mention of mentions) {
          // Notify the post author if someone @mentions them in a comment on their post
          const normalised = mention.toLowerCase();
          // Build expected handle for post author: @nom+prenom
          const postAuthorHandle = `@${post.author.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"")}`;
          if (normalised === postAuthorHandle && post.author.id !== ME_LIVE.id) {
            pushLocalNotif(post.author.id, {
              id:        `notif_${Date.now()}`,
              body:      `${ME_LIVE.name} a mentionné votre profil ${mention} dans un commentaire`,
              from:      ME_LIVE.id,
              createdAt: now,
            });
          }
        }
      }
    }
  };

  // View = first open of the detail screen per session per user
  const incrementPostViews = (postId: string) => {
    if (viewedPosts.current.has(postId)) return;
    viewedPosts.current.add(postId);
    setPosts(prev => prev.map(p => p.id !== postId ? p : { ...p, views: p.views + 1 }));
    incrementViews(postId);
  };

  const toggleLike = (id: string) => {
    stampFreeze(); // hold feed order stable for SCORE_FREEZE_MS
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const liked = !p.liked;
      const lp = loadSet(uid, "likedPosts");
      liked ? lp.add(id) : lp.delete(id);
      saveSet(uid, "likedPosts", lp);
      deltaPostLikes(id, liked ? 1 : -1);
      return { ...p, liked, likes: liked ? p.likes + 1 : p.likes - 1 };
    }));
  };

  const toggleRepost = (id: string, kind: "simple" | "quote" = "simple", quoteText?: string, quoteImgs?: string[]) => {
    stampFreeze();

    if (kind === "quote") {
      // ── Quote-repost: create a brand-new post authored by ME_LIVE
      //    with the original post embedded as quotedPost.
      const original = posts.find(p => p.id === id);
      if (!original) return;
      const now = new Date().toISOString();
      const qp: Post = {
        id:           `p${Date.now()}_${nextId.current++}`,
        author:       ME_LIVE,
        body:         quoteText ?? "",
        imgs:         quoteImgs ?? [],
        createdAt:    now,
        likes:        0, liked:   false,
        reposts:      0, reposted: false,
        views:        1,
        commentCount: 0,
        comments:     [],
        showComments: false,
        quotedPost: {
          id:     original.id,
          author: original.author,
          body:   original.body,
          imgs:   original.imgs,
        },
      };
      setPosts(prev => [qp, ...prev]);
      insertPost(postToDb(qp));
      // Also bump the original's repost count
      setPosts(prev => prev.map(p => {
        if (p.id !== id) return p;
        const rp = loadSet(uid, "repostedPosts");
        rp.add(id);
        saveSet(uid, "repostedPosts", rp);
        deltaPostReposts(id, 1);
        return { ...p, reposted: true, reposts: p.reposts + 1 };
      }));
      return;
    }

    // ── Simple repost: toggle the reposted flag
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const reposted = !p.reposted;
      const rp = loadSet(uid, "repostedPosts");
      reposted ? rp.add(id) : rp.delete(id);
      saveSet(uid, "repostedPosts", rp);
      deltaPostReposts(id, reposted ? 1 : -1);
      return { ...p, reposted, reposts: reposted ? p.reposts + 1 : p.reposts - 1 };
    }));
  };

  const deletePost = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    dbDeletePost(id);
  };

  return (
    <>
    {showCompose && <ComposeModal me={ME_LIVE} profilePic={profilePic} initialText={composeDraft} onClose={() => { setShowCompose(false); setComposeDraft(""); onComposeClosed?.(); }} onPost={(text, imgs) => { addPost(text, imgs); setShowCompose(false); setComposeDraft(""); }} />}
    <div onScroll={handleScroll} style={{ background: C.bg, minHeight: "100%", overflowY: "auto", height: "100%" }}>

      {/* InlineCompose intentionally removed — use the FAB (+ button) to compose */}

      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>Chargement…</div>
      ) : feed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>Aucune publication pour l'instant.</div>
      ) : feed.map(post => (
        <PostCard key={post.id} post={post}
          me={ME_LIVE}
          profilePic={photoCache[post.author.id] ?? (post.author.id === ME_LIVE.id ? profilePic : null)}
          onLike={() => toggleLike(post.id)}
          onRepost={(kind, text, imgs) => toggleRepost(post.id, kind, text, imgs)}
          onComment={(text, imgs) => addComment(post.id, text, imgs)}
          onDelete={() => deletePost(post.id)}
          onHide={() => hidePost(post.id)}
          onView={() => incrementPostViews(post.id)}
          photoCache={photoCache}
          userId={uid}
        />
      ))}
      <div style={{ height: 80 }} />

      {/* FAB — always visible */}
      <button onClick={() => setShowCompose(true)} style={{
        position: "fixed", bottom: 78, right: 20,
        width: 56, height: 56, borderRadius: "50%",
        background: C.gold, border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 4px 16px rgba(196,127,0,.45)", zIndex: 20,
        WebkitTapHighlightColor: "transparent",
        opacity: fabVisible ? 1 : 0,
        transform: fabVisible ? "translateY(0) scale(1)" : "translateY(16px) scale(0.85)",
        pointerEvents: fabVisible ? "auto" : "none",
        transition: "opacity .22s ease, transform .22s ease",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>
      </button>
    </div>
    </>
  );
}