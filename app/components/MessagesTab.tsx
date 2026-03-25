"use client";

import { useState, useRef, useEffect } from "react";
import { useC } from "./tokens";
import { useLang } from "./LangContext";

// ── Types ─────────────────────────────────────────────────────

interface Author {
  id:     string;
  name:   string;
  handle: string;
  avatar: string;
  color:  string;
}

interface Message {
  id:    string;
  from:  string; // author id
  body:  string;
  time:  string;
  read:  boolean;
}

interface Conversation {
  id:     string;
  with:   Author;
  messages: Message[];
  unread: number;
}

// ── Sample data ───────────────────────────────────────────────

const ME_ID = "me";

const USERS: Record<string, Author> = {
  u1: { id: "u1", name: "Naïka Présumé",    handle: "@naikap",   avatar: "NP", color: "#4A6FA5" },
  u2: { id: "u2", name: "Roody Estimé",     handle: "@roodyest", avatar: "RE", color: "#5A8A6F" },
  u3: { id: "u3", name: "Chloé Duvivier",   handle: "@chloed",   avatar: "CD", color: "#8B5E3C" },
  u4: { id: "u4", name: "Jephté Lafortune", handle: "@jephte",   avatar: "JL", color: "#7B4F8E" },
};

const SEED_CONVOS: Conversation[] = [
  {
    id: "c1", with: USERS.u1, unread: 2,
    messages: [
      { id: "m1", from: "u1", body: "Salut ! J'ai vu ton post sur la fintech. Très intéressant !", time: "10:42", read: true },
      { id: "m2", from: ME_ID, body: "Merci Naïka ! Tu travailles sur quoi en ce moment ?", time: "10:45", read: true },
      { id: "m3", from: "u1", body: "Mon mémoire porte sur les transferts diaspora → Haiti. On a beaucoup en commun non ?", time: "10:47", read: false },
      { id: "m4", from: "u1", body: "On pourrait se voir cette semaine pour en discuter ?", time: "10:48", read: false },
    ],
  },
  {
    id: "c2", with: USERS.u2, unread: 0,
    messages: [
      { id: "m5", from: ME_ID, body: "Roody, tu peux partager les slides de vendredi ?", time: "Hier", read: true },
      { id: "m6", from: "u2", body: "Bien sûr ! Je les envoie ce soir.", time: "Hier", read: true },
    ],
  },
  {
    id: "c3", with: USERS.u3, unread: 1,
    messages: [
      { id: "m7", from: "u3", body: "Tu utilises quoi pour la régression dans ta thèse ?", time: "Lun", read: false },
    ],
  },
  {
    id: "c4", with: USERS.u4, unread: 0,
    messages: [
      { id: "m8", from: "u4", body: "Félicitations pour ton article accepté ! 🎉", time: "Dim", read: true },
      { id: "m9", from: ME_ID, body: "Merci Jephté !! Ta soutenance c'était top aussi.", time: "Dim", read: true },
    ],
  },
];

// ── Avatar ────────────────────────────────────────────────────

function Avatar({ author, size = 44 }: { author: Author; size?: number }) {
  const C = useC();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: author.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.33, color: "#fff",
      flexShrink: 0, fontFamily: "var(--f-sans)",
    }}>{author.avatar}</div>
  );
}

// ── Conversation list ─────────────────────────────────────────

function ConvoList({ convos, onOpen }: { convos: Conversation[]; onOpen: (id: string) => void }) {
  const C = useC();
  return (
    <div>
      {convos.map(c => {
        const last = c.messages[c.messages.length - 1];
        return (
          <div key={c.id} onClick={() => onOpen(c.id)} style={{
            display: "flex", gap: 12, alignItems: "center",
            padding: "14px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface, cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}>
            <div style={{ position: "relative" }}>
              <Avatar author={c.with} size={48} />
              {c.unread > 0 && (
                <div style={{
                  position: "absolute", top: 0, right: 0,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#C47F00", border: `2px solid ${C.surface}`,
                }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: c.unread > 0 ? 700 : 500, fontSize: 14, color: C.text }}>
                  {c.with.name}
                </span>
                <span style={{ fontSize: 11, color: C.dim }}>{last?.time}</span>
              </div>
              <div style={{
                fontSize: 13, color: c.unread > 0 ? C.text : C.sub,
                fontWeight: c.unread > 0 ? 500 : 400,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginTop: 2,
              }}>
                {last?.from === ME_ID ? "Vous : " : ""}{last?.body}
              </div>
            </div>
            {c.unread > 0 && (
              <div style={{
                minWidth: 20, height: 20, borderRadius: 99,
                background: "#C47F00", color: "#fff",
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 5px",
              }}>{c.unread}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Chat screen ───────────────────────────────────────────────

function ChatScreen({ convo, onBack, onSend }: {
  convo:  Conversation;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const C = useC();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convo.messages.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: C.bg,
      zIndex: 150,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 12,
        flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 22, color: "#C47F00", padding: "0 4px",
          WebkitTapHighlightColor: "transparent",
        }}>‹</button>
        <Avatar author={convo.with} size={36} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{convo.with.name}</div>
          <div style={{ fontSize: 11, color: C.sub }}>{convo.with.handle}</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {convo.messages.map(msg => {
          const isMe = msg.from === ME_ID;
          return (
            <div key={msg.id} style={{
              display: "flex",
              justifyContent: isMe ? "flex-end" : "flex-start",
              alignItems: "flex-end", gap: 6,
            }}>
              {!isMe && <Avatar author={convo.with} size={26} />}
              <div style={{
                maxWidth: "72%",
                background: isMe ? "#C47F00" : C.surface,
                color: isMe ? "#fff" : C.text,
                borderRadius: isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                padding: "9px 14px",
                fontSize: 14, lineHeight: 1.45,
                boxShadow: "0 1px 4px rgba(0,0,0,.08)",
              }}>
                {msg.body}
                <div style={{
                  fontSize: 10, marginTop: 3, opacity: .65,
                  textAlign: isMe ? "right" : "left",
                }}>
                  {msg.time}{isMe && " ✓"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        padding: "10px 12px",
        display: "flex", gap: 8, alignItems: "flex-end",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
        flexShrink: 0,
      }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Message…"
          style={{
            flex: 1, border: `1px solid ${C.border}`,
            borderRadius: 22, padding: "10px 16px",
            fontSize: 14, color: C.text, background: C.card,
            outline: "none", fontFamily: "var(--f-sans)",
          }}
        />
        <button onClick={send} disabled={!text.trim()} style={{
          width: 40, height: 40, borderRadius: "50%",
          background: text.trim() ? "#C47F00" : "#E2E0DA",
          border: "none", cursor: text.trim() ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, transition: "background .15s",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
              stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────

export function MessagesScreen({ onClose }: { onClose: () => void }) {
  const C = useC();
  const [convos, setConvos] = useState(SEED_CONVOS);
  const [openId, setOpenId] = useState<string | null>(null);
  let nextId = useRef(200);

  const openConvo = (id: string) => {
    setConvos(prev => prev.map(c =>
      c.id === id ? { ...c, unread: 0, messages: c.messages.map(m => ({ ...m, read: true })) } : c
    ));
    setOpenId(id);
  };

  const sendMsg = (convoId: string, text: string) => {
    setConvos(prev => prev.map(c =>
      c.id === convoId ? {
        ...c,
        messages: [...c.messages, {
          id: `m${nextId.current++}`,
          from: ME_ID, body: text,
          time: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
          read: true,
        }],
      } : c
    ));
  };

  const activeConvo = convos.find(c => c.id === openId);

  return (
    <>
      <div style={{
        position: "fixed", inset: 0,
        background: C.bg,
        zIndex: 140,
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 22, color: "#C47F00", padding: "0 4px",
            WebkitTapHighlightColor: "transparent",
          }}>‹</button>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>Messages</div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <ConvoList convos={convos} onOpen={openConvo} />
        </div>
      </div>

      {/* Open chat */}
      {activeConvo && (
        <ChatScreen
          convo={activeConvo}
          onBack={() => setOpenId(null)}
          onSend={text => sendMsg(activeConvo.id, text)}
        />
      )}
    </>
  );
}
