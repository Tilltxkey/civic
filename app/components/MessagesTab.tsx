"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useC } from "./tokens";
import { useProfile } from "./ProfileContext";
import {
  loadConversations, findOrCreateConversation, loadMessages, sendMessage,
  updateConvLastMsg, markConvRead, loadAllUsers, fetchUserPhotos,
  subscribeMessages, subscribeConversations, canDM,
  type DBConversation, type DBMessage,
} from "./db";

// ─── Types ────────────────────────────────────────────────────

interface UserSummary {
  id:           string;
  nom:          string;
  prenom:       string;
  faculty:      string;
  year:         number;
  role:         string;
  avatarColor:  string;
  badge:        "gold" | "blue" | "gray" | null;
  profilePhoto: string | null;
  // derived
  displayName:  string;   // "DUPONT Chloé"
  handle:       string;   // "@dupontchloe"
  tag:          string;   // "eco.3 · cep"
  initials:     string;   // "DC"
}

interface Conversation {
  id:      string;
  with:    UserSummary;
  userA:   string;   // the user_a field in DB (to track unread side)
  unread:  number;   // unread count for ME
  lastMsg: string;
  lastAt:  string;
  messages: Message[];
  loaded:  boolean;
}

interface Message {
  id:        string;
  fromId:    string;
  body:      string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────

const FACULTY_MAP: Record<string, string> = {
  "FDSE – Droit & Sciences Économiques": "eco",
  "FLA – Lettres & Arts":                "fla",
  "FST – Sciences & Technologies":       "fst",
  "FMP – Médecine & Pharmacie":          "fmp",
  "FASCH – Sciences Humaines":           "fasch",
  "FGC – Génie Civil":                   "fgc",
  "FA – Architecture":                   "fa",
  "FAMV – Agronomie & Médecine Vétérinaire": "famv",
};

const ROLE_MAP: Record<string, string> = {
  "Délégué·e de classe":         "del.",
  "Président·e d'association":   "prés.",
  "Membre CEP":                  "cep",
  "CEP — Responsable désigné·e": "cep.resp.",
  "Rectorat":                    "rect.",
};

function buildUserSummary(u: { id: string; nom: string; prenom: string; faculty: string; year: number; role: string; avatar_color: string; badge: string | null; profile_photo: string | null }): UserSummary {
  const nom    = u.nom.toUpperCase();
  const prenom = u.prenom.charAt(0).toUpperCase() + u.prenom.slice(1).toLowerCase();
  const fcode  = FACULTY_MAP[u.faculty] ?? "fdse";
  const base   = `${fcode}.${u.year}`;
  const rcode  = ROLE_MAP[u.role];
  const tag    = rcode ? `${base} · ${rcode}` : base;
  const slug   = (u.nom + u.prenom).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
  return {
    id:           u.id,
    nom:          u.nom,
    prenom:       u.prenom,
    faculty:      u.faculty,
    year:         u.year,
    role:         u.role,
    avatarColor:  u.avatar_color,
    badge:        u.badge as UserSummary["badge"],
    profilePhoto: u.profile_photo,
    displayName:  `${nom} ${prenom}`,
    handle:       `@${slug}`,
    tag,
    initials:     (u.nom[0] ?? "") + (u.prenom[0] ?? ""),
  };
}

function fmtMsgTime(iso?: string): string {
  if (!iso) return "";
  const d    = new Date(iso);
  const now  = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400 && d.getDate() === now.getDate())
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (diff < 86400 * 2) return "Hier";
  if (diff < 86400 * 7) return ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"][d.getDay()];
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ─── Avatar ───────────────────────────────────────────────────

function Avatar({ user, size = 44, photoUrl }: { user: UserSummary; size?: number; photoUrl?: string | null }) {
  const C = useC();
  if (photoUrl) return (
    <img src={photoUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
  );
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: user.avatarColor,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.35, color: "#fff", flexShrink: 0, fontFamily: "var(--f-sans)",
    }}>{user.initials.toUpperCase()}</div>
  );
}

// ─── Badge icon ───────────────────────────────────────────────

function BadgeIcon({ type, size = 13 }: { type: "gold" | "blue" | "gray"; size?: number }) {
  if (type === "blue") return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1D9BF0"/>
    </svg>
  );
  if (type === "gold") return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="msgGold" x1="4" x2="18" y1="2" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4e72a"/><stop offset=".6" stopColor="#cd8105"/><stop offset="1" stopColor="#f4e72a"/>
        </linearGradient>
      </defs>
      <path d="M13.324 3.848L11 1.6 8.676 3.848l-3.201-.453-.559 3.184L2.06 8.095 3.48 11l-1.42 2.904 2.856 1.516.559 3.184 3.201-.452L11 20.4l2.324-2.248 3.201.452.559-3.184 2.856-1.516L18.52 11l1.42-2.905-2.856-1.516-.559-3.184z" fill="url(#msgGold)"/>
      <path d="M6.234 11.423l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="#fff"/>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <path clipRule="evenodd" fillRule="evenodd" d="M12.05 2.056c-.568-.608-1.532-.608-2.1 0l-1.393 1.49c-.284.303-.685.47-1.1.455L5.42 3.932c-.832-.028-1.514.654-1.486 1.486l.069 2.039c.014.415-.152.816-.456 1.1l-1.49 1.392c-.608.568-.608 1.533 0 2.101l1.49 1.393c.304.284.47.684.456 1.1l-.07 2.038c-.027.832.655 1.514 1.487 1.486l2.038-.069c.415-.014.816.152 1.1.455l1.392 1.49c.569.609 1.533.609 2.102 0l1.393-1.49c.283-.303.684-.47 1.099-.455l2.038.069c.832.028 1.515-.654 1.486-1.486L18 14.542c-.015-.415.152-.815.455-1.099l1.49-1.393c.608-.568.608-1.533 0-2.101l-1.49-1.393c-.303-.283-.47-.684-.455-1.1l.068-2.038c.029-.832-.654-1.514-1.486-1.486l-2.038.07c-.415.013-.816-.153-1.1-.456zm-5.817 9.367l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="#829aab"/>
    </svg>
  );
}

// ─── NewConvoModal — pick a user to message ───────────────────

function NewConvoModal({ users, myId, photoCache, onSelect, onClose }: {
  users:      UserSummary[];
  myId:       string;
  photoCache: Record<string, string>;
  onSelect:   (user: UserSummary) => void;
  onClose:    () => void;
}) {
  const C = useC();
  const [q, setQ]             = useState("");
  const [checking, setChecking] = useState<string | null>(null); // userId being checked
  const [blocked,  setBlocked]  = useState<string | null>(null); // userId that failed check

  const filtered = users
    .filter(u => u.id !== myId)
    .filter(u => !q || u.displayName.toLowerCase().includes(q.toLowerCase()) || u.handle.includes(q.toLowerCase()) || u.tag.includes(q.toLowerCase()));

  const handleSelect = async (u: UserSummary) => {
    setBlocked(null);
    setChecking(u.id);
    const ok = await canDM(myId, u.handle, u.id);
    setChecking(null);
    if (ok) {
      onSelect(u);
    } else {
      setBlocked(u.id);
      // Clear blocked message after 3s
      setTimeout(() => setBlocked(null), 3000);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: C.surface, borderRadius: "20px 20px 0 0",
        zIndex: 501, maxHeight: "80vh", display: "flex", flexDirection: "column",
        animation: "sheetUp .28s cubic-bezier(.2,.8,.3,1) both",
      }}>
        <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 99, margin: "12px auto 0" }} />
        <div style={{ padding: "12px 16px", fontWeight: 700, fontSize: 17, color: C.text }}>Nouveau message</div>
        <div style={{ padding: "0 16px 12px" }}>
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Rechercher un étudiant…"
            style={{ width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", fontSize: 14, color: C.text, background: C.card, outline: "none", fontFamily: "var(--f-sans)", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: C.dim, fontSize: 14 }}>Aucun résultat</div>
          )}
          {filtered.map(u => {
            const isChecking = checking === u.id;
            const isBlocked  = blocked  === u.id;
            return (
              <div key={u.id} onClick={() => !isChecking && handleSelect(u)} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
                cursor: isChecking ? "wait" : "pointer",
                WebkitTapHighlightColor: "transparent",
                background: isBlocked ? "#FDF1EF" : C.surface,
                transition: "background .2s",
              }}>
                <Avatar user={u} size={44} photoUrl={photoCache[u.id] ?? u.profilePhoto} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: isBlocked ? "#C8250E" : C.text }}>{u.displayName}</span>
                    {u.badge && <BadgeIcon type={u.badge} size={13} />}
                  </div>
                  <div style={{ fontSize: 12, color: C.sub }}>{u.handle} · {u.tag}</div>
                  {isBlocked && (
                    <div style={{ fontSize: 11, color: "#C8250E", marginTop: 2 }}>
                      Cet utilisateur doit d'abord publier ou mentionner votre compte
                    </div>
                  )}
                </div>
                {isChecking && (
                  <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: "#C47F00", animation: "spin .7s linear infinite", flexShrink: 0 }} />
                )}
                {isBlocked && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" stroke="#C8250E" strokeWidth="1.6"/>
                    <path d="M4.93 4.93l14.14 14.14" stroke="#C8250E" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
            );
          })}
          <div style={{ height: 32 }} />
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─── ChatScreen ───────────────────────────────────────────────

function ChatScreen({ convo, myId, photoCache, myPhoto, onBack, onSend }: {
  convo:      Conversation;
  myId:       string;
  photoCache: Record<string, string>;
  myPhoto:    string | null;
  onBack:     () => void;
  onSend:     (text: string) => void;
}) {
  const C = useC();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convo.messages.length]);

  const send = () => {
    const t = text.trim(); if (!t) return;
    onSend(t); setText("");
  };

  const otherPhoto = photoCache[convo.with.id] ?? convo.with.profilePhoto;

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 150, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#C47F00", padding: "0 4px", WebkitTapHighlightColor: "transparent" }}>‹</button>
        <Avatar user={convo.with} size={36} photoUrl={otherPhoto} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.with.displayName}</span>
            {convo.with.badge && <BadgeIcon type={convo.with.badge} size={13} />}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{convo.with.handle} · {convo.with.tag}</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {convo.messages.map(msg => {
          const isMe = msg.fromId === myId;
          return (
            <div key={msg.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6 }}>
              {!isMe && <Avatar user={convo.with} size={26} photoUrl={otherPhoto} />}
              <div style={{
                maxWidth: "72%",
                background: isMe ? "#C47F00" : C.surface,
                color: isMe ? "#fff" : C.text,
                borderRadius: isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                padding: "9px 14px", fontSize: 14, lineHeight: 1.45,
                boxShadow: "0 1px 4px rgba(0,0,0,.08)",
              }}>
                {msg.body}
                <div style={{ fontSize: 10, marginTop: 3, opacity: .65, textAlign: isMe ? "right" : "left" }}>
                  {fmtMsgTime(msg.createdAt)}{isMe && " ✓"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-end", paddingBottom: "calc(10px + env(safe-area-inset-bottom))", flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Message…"
          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 22, padding: "10px 16px", fontSize: 14, color: C.text, background: C.card, outline: "none", fontFamily: "var(--f-sans)" }}
        />
        <button onClick={send} disabled={!text.trim()} style={{
          width: 40, height: 40, borderRadius: "50%",
          background: text.trim() ? "#C47F00" : C.border2,
          border: "none", cursor: text.trim() ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, transition: "background .15s",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main MessagesScreen ──────────────────────────────────────

export function MessagesScreen({ onClose }: { onClose: () => void }) {
  const C = useC();
  const { user: me, profilePic } = useProfile();
  const myId = me?.id ?? "";

  const [convos,     setConvos]     = useState<Conversation[]>([]);
  const [allUsers,   setAllUsers]   = useState<UserSummary[]>([]);
  const [photoCache, setPhotoCache] = useState<Record<string, string>>({});
  const [loading,    setLoading]    = useState(true);
  const [openId,     setOpenId]     = useState<string | null>(null);
  const [showNew,    setShowNew]    = useState(false);
  const nextId = useRef(900);

  // ── Helpers to build Conversation from DBConversation + users ──
  const buildConvo = useCallback((row: DBConversation, userMap: Record<string, UserSummary>): Conversation | null => {
    const otherId = row.user_a === myId ? row.user_b : row.user_a;
    const other   = userMap[otherId];
    if (!other) return null;
    const unread = row.user_a === myId ? row.unread_a : row.unread_b;
    return {
      id: row.id, with: other, userA: row.user_a,
      unread, lastMsg: row.last_msg, lastAt: row.last_at,
      messages: [], loaded: false,
    };
  }, [myId]);

  // ── Load on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!myId) return;

    // Load all users + conversations in parallel
    Promise.all([loadAllUsers(), loadConversations(myId)]).then(async ([rawUsers, rawConvos]) => {
      const summaries = rawUsers.map(buildUserSummary);
      const userMap: Record<string, UserSummary> = {};
      summaries.forEach(u => { userMap[u.id] = u; });
      setAllUsers(summaries);

      const built = rawConvos.map(r => buildConvo(r, userMap)).filter(Boolean) as Conversation[];
      setConvos(built);
      setLoading(false);

      // Fetch photos for all conversation partners
      const ids = [...new Set(rawConvos.flatMap(r => [r.user_a, r.user_b]))];
      fetchUserPhotos(ids).then(p => setPhotoCache(prev => ({ ...prev, ...p })));
    });

    // Realtime: conversation list updates (new message, unread count)
    const unsub = subscribeConversations(myId, ({ type, row }) => {
      setConvos(prev => {
        if (type === "DELETE") return prev.filter(c => c.id !== row.id);
        const existing = prev.find(c => c.id === row.id);
        if (existing) {
          const unread = row.user_a === myId ? row.unread_a : row.unread_b;
          return prev
            .map(c => c.id !== row.id ? c : { ...c, unread, lastMsg: row.last_msg, lastAt: row.last_at })
            .sort((a, b) => b.lastAt > a.lastAt ? 1 : -1);
        }
        // New conversation — need user map
        loadAllUsers().then(rawUsers => {
          const userMap: Record<string, UserSummary> = {};
          rawUsers.map(buildUserSummary).forEach(u => { userMap[u.id] = u; });
          const built = buildConvo(row, userMap);
          if (built) setConvos(p => [built, ...p]);
        });
        return prev;
      });
    });
    return unsub;
  }, [myId, buildConvo]);

  // ── Open a conversation ────────────────────────────────────────
  const openConvo = useCallback(async (id: string) => {
    setOpenId(id);
    // Mark as read
    const c = convos.find(c => c.id === id);
    if (!c) return;
    setConvos(prev => prev.map(cv => cv.id !== id ? cv : { ...cv, unread: 0 }));
    await markConvRead(id, myId, c.userA);

    if (!c.loaded) {
      const rows = await loadMessages(id);
      const msgs: Message[] = rows.map(r => ({ id: r.id, fromId: r.from_id, body: r.body, createdAt: r.created_at ?? "" }));
      setConvos(prev => prev.map(cv => cv.id !== id ? cv : { ...cv, messages: msgs, loaded: true }));
    }
  }, [convos, myId]);

  // ── Send a message ─────────────────────────────────────────────
  const sendMsg = useCallback(async (convId: string, text: string) => {
    const c = convos.find(cv => cv.id === convId); if (!c) return;
    const now = new Date().toISOString();
    const msg: Message = { id: `m${Date.now()}_${nextId.current++}`, fromId: myId, body: text, createdAt: now };
    // Optimistic update
    setConvos(prev => prev.map(cv => cv.id !== convId ? cv : { ...cv, messages: [...cv.messages, msg], lastMsg: text, lastAt: now }));
    // Persist
    await sendMessage({ id: msg.id, conversation_id: convId, from_id: myId, body: text, created_at: now });
    await updateConvLastMsg(convId, text, myId, c.userA);
  }, [convos, myId]);

  // ── Start a new conversation ───────────────────────────────────
  const startConvo = useCallback(async (other: UserSummary) => {
    setShowNew(false);
    // Check if convo already exists
    const existing = convos.find(c => c.with.id === other.id);
    if (existing) { setOpenId(existing.id); return; }
    const convId = await findOrCreateConversation(myId, other.id);
    const newConvo: Conversation = {
      id: convId, with: other, userA: myId,
      unread: 0, lastMsg: "", lastAt: new Date().toISOString(),
      messages: [], loaded: true,
    };
    setConvos(prev => [newConvo, ...prev]);
    setOpenId(convId);
    fetchUserPhotos([other.id]).then(p => setPhotoCache(prev => ({ ...prev, ...p })));
  }, [convos, myId]);

  // ── Realtime messages for the open conversation ────────────────
  useEffect(() => {
    if (!openId) return;
    const unsub = subscribeMessages(openId, ({ type, row }) => {
      if (row.from_id === myId) return; // already optimistically added
      if (type === "INSERT") {
        const msg: Message = { id: row.id, fromId: row.from_id, body: row.body, createdAt: row.created_at ?? "" };
        setConvos(prev => prev.map(cv => cv.id !== openId ? cv : {
          ...cv, messages: cv.messages.find(m => m.id === msg.id) ? cv.messages : [...cv.messages, msg],
          lastMsg: row.body, lastAt: row.created_at ?? cv.lastAt,
        }));
      }
    });
    return unsub;
  }, [openId, myId]);

  const activeConvo = convos.find(c => c.id === openId);
  const totalUnread = convos.reduce((s, c) => s + c.unread, 0);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 140, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#C47F00", padding: "0 4px", WebkitTapHighlightColor: "transparent" }}>‹</button>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text, flex: 1 }}>
            Messages {totalUnread > 0 && <span style={{ fontSize: 12, background: "#C47F00", color: "#fff", borderRadius: 99, padding: "1px 7px", marginLeft: 6, fontWeight: 700 }}>{totalUnread}</span>}
          </div>
          {/* New message button */}
          <button onClick={() => setShowNew(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C47F00", padding: 4, WebkitTapHighlightColor: "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: C.dim, fontSize: 14 }}>Chargement…</div>
          ) : convos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px" }}>
              <div style={{ fontSize: 14, color: C.dim, marginBottom: 16 }}>Aucune conversation</div>
              <button onClick={() => setShowNew(true)} style={{ background: "#C47F00", color: "#fff", border: "none", borderRadius: 99, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--f-sans)" }}>
                Envoyer un message
              </button>
            </div>
          ) : convos
            .slice()
            .sort((a, b) => b.lastAt > a.lastAt ? 1 : -1)
            .map(c => (
            <div key={c.id} onClick={() => openConvo(c.id)} style={{
              display: "flex", gap: 12, alignItems: "center",
              padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
              background: C.surface, cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}>
              <div style={{ position: "relative" }}>
                <Avatar user={c.with} size={48} photoUrl={photoCache[c.with.id] ?? c.with.profilePhoto} />
                {c.unread > 0 && (
                  <div style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, borderRadius: "50%", background: "#C47F00", border: `2px solid ${C.surface}` }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontWeight: c.unread > 0 ? 700 : 500, fontSize: 14, color: C.text }}>{c.with.displayName}</span>
                    {c.with.badge && <BadgeIcon type={c.with.badge} size={12} />}
                  </div>
                  <span style={{ fontSize: 11, color: C.dim, flexShrink: 0, marginLeft: 8 }}>{fmtMsgTime(c.lastAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>{c.with.handle} · {c.with.tag}</div>
                <div style={{
                  fontSize: 13, color: c.unread > 0 ? C.text : C.sub,
                  fontWeight: c.unread > 0 ? 500 : 400,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2,
                }}>
                  {c.messages.length > 0 && c.messages[c.messages.length - 1]?.fromId === myId ? "Vous : " : ""}
                  {c.lastMsg || "…"}
                </div>
              </div>
              {c.unread > 0 && (
                <div style={{ minWidth: 20, height: 20, borderRadius: 99, background: "#C47F00", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active chat */}
      {activeConvo && (
        <ChatScreen
          convo={activeConvo}
          myId={myId}
          photoCache={photoCache}
          myPhoto={profilePic}
          onBack={() => setOpenId(null)}
          onSend={text => sendMsg(activeConvo.id, text)}
        />
      )}

      {/* New conversation picker */}
      {showNew && (
        <NewConvoModal
          users={allUsers}
          myId={myId}
          photoCache={photoCache}
          onSelect={startConvo}
          onClose={() => setShowNew(false)}
        />
      )}
    </>
  );
}