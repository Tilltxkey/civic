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

function PostDetailScreen({ post, onClose, onComment, onLike, onRepost, me, profilePic = null, photoCache = {}, userId = "" }: {
  post:        Post;
  onClose:     () => void;
  onComment:   (text: string, imgs?: string[]) => void;
  onLike:      () => void;
  onRepost:    () => void;
  me: Author;
  profilePic?: string | null;
  photoCache?: Record<string, string>;
  userId?:     string;
}) {
  const C = useC();
  const { profilePic: ctxPic, user: ctxUser } = useProfile();
  const myId = ctxUser?.id ?? me.id;
  const isMinePost = post.author.id === myId || post.author.id === me.id;
  const postAuthorPhoto = photoCache[post.author.id] ?? (isMinePost ? (ctxPic ?? profilePic) : null);

  const [showReply, setShowReply] = useState(false);
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

function PostCard({ post, onLike, onRepost, onComment, onDelete, onView, me, profilePic = null, photoCache = {}, userId = "" }: {
  post:        Post;
  onLike:      () => void;
  onRepost:    () => void;
  onComment:   (text: string, imgs?: string[]) => void;
  onDelete:    () => void;
  onView:      () => void;
  profilePic?: string | null;
  photoCache?: Record<string, string>;
  userId?:     string;
}) {
  const C = useC();
  const { profilePic: ctxPic, user: ctxUser } = useProfile();
  const myId       = ctxUser?.id ?? me.id;
  const isMine     = post.author.id === myId || post.author.id === me.id;
  const authorPhoto = photoCache[post.author.id] ?? (isMine ? (ctxPic ?? profilePic) : null);
  const [expanded,   setExpanded]   = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const PREVIEW_LEN = 220;
  const isLong  = post.body.length > PREVIEW_LEN;
  const bodyText = isLong && !expanded ? post.body.slice(0, PREVIEW_LEN) + "…" : post.body;

  return (
    <>
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
            {isMine && (
              <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, padding: "0 2px", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>···</button>
            )}
          </div>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.55, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{bodyText}</div>
          {isLong && (
            <button onClick={e => { e.stopPropagation(); setExpanded(x => !x); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.blue, fontSize: 14, fontWeight: 600, padding: "2px 0", fontFamily: "var(--f-sans)", WebkitTapHighlightColor: "transparent" }}>
              {expanded ? "Voir moins" : "Voir plus"}
            </button>
          )}
          {post.imgs.length > 0 && <ImgGrid imgs={post.imgs} />}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingRight: 8 }}>
            <button onClick={e => { e.stopPropagation(); setShowDetail(true); onView(); }} style={actionBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              {post.commentCount > 0 && <span style={actionCount}>{fmtNum(post.commentCount)}</span>}
            </button>
            <button onClick={e => { e.stopPropagation(); onRepost(); }} style={{ ...actionBtn, color: post.reposted ? "#1DB33A" : "currentColor" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 1l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M7 23l-4-4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              {post.reposts > 0 && <span style={actionCount}>{fmtNum(post.reposts)}</span>}
            </button>
            <button onClick={e => { e.stopPropagation(); onLike(); }} style={{ ...actionBtn, color: post.liked ? "#E8412A" : "currentColor" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={post.liked ? "#E8412A" : "none"}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={post.liked ? "#E8412A" : "currentColor"} strokeWidth="1.6"/></svg>
              {post.likes > 0 && <span style={actionCount}>{fmtNum(post.likes)}</span>}
            </button>
            <button style={actionBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              <span style={actionCount}>{fmtNum(post.views)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    {showDetail && (
      <PostDetailScreen
        post={post}
        me={me}
        profilePic={profilePic}
        photoCache={photoCache}
        userId={userId}
        onClose={() => setShowDetail(false)}
        onComment={(text, imgs) => onComment(text, imgs)}
        onLike={onLike}
        onRepost={onRepost}
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

function ComposeModal({ onClose, onPost, me, profilePic = null }: { onClose: () => void; onPost: (text: string, imgs?: string[]) => void; me: Author; profilePic?: string | null }) {
  const C = useC();
  const { profilePic: ctxPic } = useProfile();
  const livePic = ctxPic ?? profilePic;
  const [text, setText]               = useState("");
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
  return {
    id: p.id,
    ...authorToDb(p.author),
    body:          p.body,
    imgs:          p.imgs,
    time_label:    p.createdAt,   // store ISO in time_label for legacy compat
    likes:         p.likes,
    reposts:       p.reposts,
    views:         p.views,
    comment_count: p.commentCount,
    created_at:    p.createdAt,
  };
}

function dbToPost(row: DBPost, likedSet?: Set<string>, repostedSet?: Set<string>): Post {
  const iso = row.created_at ?? row.time_label ?? new Date().toISOString();
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
    "Délégué·e de classe":         "del.",
    "Président·e d'association":   "prés.",
    "Membre CEP":                  "cep",
    "CEP — Responsable désigné·e": "cep.resp.",
    "Rectorat":                    "rect.",
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

export function CommunityTab({ feedTab, currentUser }: { feedTab: "all" | "mine"; currentUser?: UserProfile }) {
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
  const [showCompose, setShowCompose] = useState(false);
  // Per-session view guard: a post counts as viewed only once per session
  const viewedPosts = useRef<Set<string>>(new Set());

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

  const feed = feedTab === "all" ? posts : posts.filter(p => p.author.id === ME_LIVE.id);

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

  const toggleRepost = (id: string) => {
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
    {showCompose && <ComposeModal me={ME_LIVE} profilePic={profilePic} onClose={() => setShowCompose(false)} onPost={(text, imgs) => { addPost(text, imgs); setShowCompose(false); }} />}
    <div onScroll={handleScroll} style={{ background: C.bg, minHeight: "100%", overflowY: "auto", height: "100%" }}>

      {/* Inline compose box — only on "all" tab */}
      {feedTab === "all" && (
        <InlineCompose me={ME_LIVE} profilePic={profilePic} onPost={(text, imgs) => addPost(text, imgs)} />
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>Chargement…</div>
      ) : feed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.dim, fontSize: 14 }}>Aucune publication pour l'instant.</div>
      ) : feed.map(post => (
        <PostCard key={post.id} post={post}
          me={ME_LIVE}
          profilePic={photoCache[post.author.id] ?? (post.author.id === ME_LIVE.id ? profilePic : null)}
          onLike={() => toggleLike(post.id)}
          onRepost={() => toggleRepost(post.id)}
          onComment={(text, imgs) => addComment(post.id, text, imgs)}
          onDelete={() => deletePost(post.id)}
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