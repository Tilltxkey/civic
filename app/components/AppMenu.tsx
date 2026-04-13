"use client";

/**
 * AppMenu.tsx
 * Shared 3-dot dropdown menu — same options on every tab.
 * Usage: <AppMenu />  — self-contained, no props needed.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useC } from "./tokens";
import { useLang } from "./LangContext";
import { useTheme } from "./ThemeContext";
import { useProfile } from "./ProfileContext";
// SQL: ALTER TABLE civique_users ADD COLUMN IF NOT EXISTS profile_photo text;
import { updateUserPhoto } from "./db";
import React from "react";

// ─── localStorage key — must match page.tsx ───────────────────
const SESSION_KEY = "civique_user_id";

// PhotoSheet and CropScreen are copied from Header.tsx
// (importing them cross-file would create circular deps)
// ─── PHOTO FLOW COMPONENTS ───────────────────────────────────

// ── Photo flow components ─────────────────────────────────────

function PhotoSheet({ onCamera, onGallery, onClose }: {
  onCamera: () => void; onGallery: () => void; onClose: () => void;
}) {
  const C = useC();
  const { t } = useLang();
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:220 }} />
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:C.surface, borderRadius:"20px 20px 0 0",
        zIndex:221, padding:"0 0 40px",
        boxShadow:"0 -4px 24px rgba(0,0,0,.12)",
        animation:"sheetUp .28s cubic-bezier(.2,.8,.3,1) both",
      }}>
        <div style={{ width:36, height:4, background:C.border2, borderRadius:99, margin:"12px auto 20px" }} />
        <div style={{ fontSize:16, fontWeight:700, color:C.text, padding:"0 20px 20px" }}>
          {t("photo.title")}
        </div>
        <div style={{ display:"flex", justifyContent:"center", gap:32, padding:"0 24px" }}>
          {([
            { label: t("photo.camera"), onClick: onCamera, icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="#fff" strokeWidth="1.6" fill="none"/>
                <circle cx="12" cy="13" r="4" stroke="#fff" strokeWidth="1.6"/>
              </svg>
            )},
            { label: t("photo.gallery"), onClick: onGallery, icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fff" strokeWidth="1.6"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="#fff"/>
                <path d="M21 15l-5-5L5 21" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            )},
          ] as {label:string;onClick:()=>void;icon:React.ReactNode}[]).map(({label,onClick,icon}) => (
            <button key={label} onClick={onClick} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:10,
              background:"none", border:"none", cursor:"pointer",
              fontFamily:"var(--f-sans)", WebkitTapHighlightColor:"transparent",
            }}>
              <div style={{ width:64, height:64, borderRadius:"50%", background:C.gold,
                display:"flex", alignItems:"center", justifyContent:"center" }}>{icon}</div>
              <span style={{ fontSize:12, color:C.text, fontWeight:500 }}>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CropScreen({ src, onConfirm, onCancel }: {
  src: string; onConfirm: (dataUrl: string) => void; onCancel: () => void;
}) {
  const C = useC();
  const { t } = useLang();
  const SIZE = typeof window !== "undefined" ? Math.min(window.innerWidth - 48, 300) : 280;
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });
  const [ready, setReady] = useState(false);
  const dragging = useRef(false);
  const lastPtr  = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const s = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    setDisplayScale(s);
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImgOffset({ x: 0, y: 0 });
    setReady(true);
  }, [SIZE]);

  const clamp = useCallback((ox: number, oy: number, s: number, nw: number, nh: number) => {
    const hw = (nw*s)/2, hh = (nh*s)/2, hr = SIZE/2;
    return { x: Math.max(-hw+hr, Math.min(hw-hr, ox)), y: Math.max(-hh+hr, Math.min(hh-hr, oy)) };
  }, [SIZE]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPtr.current.x, dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    setImgOffset(prev => clamp(prev.x+dx, prev.y+dy, displayScale, naturalSize.w, naturalSize.h));
  };
  const onPointerUp = () => { dragging.current = false; };

  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas || !ready) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const OUTPUT = 400; canvas.width = OUTPUT; canvas.height = OUTPUT;
    const img = new window.Image();
    img.onload = () => {
      const cx = naturalSize.w/2 - imgOffset.x/displayScale;
      const cy = naturalSize.h/2 - imgOffset.y/displayScale;
      const half = (SIZE/2)/displayScale;
      ctx.beginPath(); ctx.arc(OUTPUT/2, OUTPUT/2, OUTPUT/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(img, cx-half, cy-half, half*2, half*2, 0, 0, OUTPUT, OUTPUT);
      onConfirm(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = src;
  }, [ready, naturalSize, imgOffset, displayScale, SIZE, src, onConfirm]);

  const imgW = naturalSize.w * displayScale;
  const imgH = naturalSize.h * displayScale;
  const imgLeft = SIZE/2 - imgW/2 + imgOffset.x;
  const imgTop  = SIZE/2 - imgH/2 + imgOffset.y;

  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, zIndex:222, display:"flex", flexDirection:"column" }}>
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"10px 16px",
        display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <button onClick={onCancel} style={{ background:"none", border:"none", color:C.sub, fontSize:15, cursor:"pointer", fontFamily:"var(--f-sans)" }}>{t("crop.cancel")}</button>
        <span style={{ color:C.text, fontSize:16, fontWeight:700, fontFamily:"var(--f-sans)" }}>{t("crop.title")}</span>
        <button onClick={handleConfirm} style={{ background:"none", border:"none", color:C.gold, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"var(--f-sans)" }}>{t("crop.ok")}</button>
      </div>
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:C.bg, position:"relative" }}>
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:2 }}>
          <defs><mask id="cm"><rect width="100%" height="100%" fill="white"/><circle cx="50%" cy="50%" r={SIZE/2} fill="black"/></mask></defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#cm)"/>
          <circle cx="50%" cy="50%" r={SIZE/2} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5"/>
        </svg>
        <div style={{ position:"absolute", inset:0, zIndex:3, cursor:"grab", touchAction:"none" }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        {ready && <img src={src} draggable={false} style={{
          position:"absolute", left:`calc(50% - ${SIZE/2}px + ${imgLeft}px)`,
          top:`calc(50% - ${SIZE/2}px + ${imgTop}px)`,
          width:imgW, height:imgH, userSelect:"none", pointerEvents:"none", zIndex:1,
        }} alt="crop" />}
        <img src={src} onLoad={handleLoad} style={{ display:ready?"none":"block", opacity:0, position:"absolute" }} alt="" />
      </div>
      <div style={{ textAlign:"center", padding:"16px 20px 40px", fontSize:12, color:C.sub,
        fontFamily:"var(--f-sans)", background:C.surface, borderTop:`1px solid ${C.border}`, flexShrink:0 }}>
        {t("crop.hint")}
      </div>
      <canvas ref={canvasRef} style={{ display:"none" }} />
    </div>
  );
}


// ── UserCard — shown at top of menu ──────────────────────────

function VerifiedBadgeMini({ type }: { type: "gold"|"blue"|"gray" }) {
  if (type === "blue")  return <svg width="14" height="14" viewBox="0 0 22 22"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1D9BF0"/></svg>;
  if (type === "gold") return <svg width="14" height="14" viewBox="0 0 22 22"><defs><linearGradient id="ma" x1="4" x2="18" y1="2" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f4e72a"/><stop offset=".6" stopColor="#cd8105"/><stop offset="1" stopColor="#f4e72a"/></linearGradient></defs><path d="M13.324 3.848L11 1.6 8.676 3.848l-3.201-.453-.559 3.184L2.06 8.095 3.48 11l-1.42 2.904 2.856 1.516.559 3.184 3.201-.452L11 20.4l2.324-2.248 3.201.452.559-3.184 2.856-1.516L18.52 11l1.42-2.905-2.856-1.516-.559-3.184z" fill="url(#ma)"/><path d="M6.234 11.423l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="#fff"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 22 22"><path clipRule="evenodd" fillRule="evenodd" d="M12.05 2.056c-.568-.608-1.532-.608-2.1 0l-1.393 1.49c-.284.303-.685.47-1.1.455L5.42 3.932c-.832-.028-1.514.654-1.486 1.486l.069 2.039c.014.415-.152.816-.456 1.1l-1.49 1.392c-.608.568-.608 1.533 0 2.101l1.49 1.393c.304.284.47.684.456 1.1l-.07 2.038c-.027.832.655 1.514 1.487 1.486l2.038-.069c.415-.014.816.152 1.1.455l1.392 1.49c.569.609 1.533.609 2.102 0l1.393-1.49c.283-.303.684-.47 1.099-.455l2.038.069c.832.028 1.515-.654 1.486-1.486L18 14.542c-.015-.415.152-.815.455-1.099l1.49-1.393c.608-.568.608-1.533 0-2.101l-1.49-1.393c-.303-.283-.47-.684-.455-1.1l.068-2.038c.029-.832-.654-1.514-1.486-1.486l-2.038.07c-.415.013-.816-.153-1.1-.456zm-5.817 9.367l3.429 3.428 5.683-6.206-1.347-1.247-4.4 4.795-2.072-2.072z" fill="#829aab"/></svg>;
}

function buildTag(user: import("./AuthFlow").UserProfile): string {
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
    "Responsable Affaires Académiques":   "RAA",
    "Délégué·e":                          "dél.",
    "Trésorier·e":                        "trés.",
    "Secrétaire":                         "sec.",
    "Président·e du Comité Exécutif":     "prés. CE",
  };
  const fcode = fmap[user.faculty] ?? "fdse";
  const base  = `${fcode}.${user.year}`;
  const role  = rmap[user.role];
  return role ? `${base} · ${role}` : base;
}

/**
 * UserCard — FIXED: reads badge and role from ProfileContext.user (live)
 * instead of the user prop passed to AppMenu (can be stale).
 * The prop is only used as a fallback when context hasn't loaded yet.
 */
function UserCard({ profilePic, userProp }: {
  profilePic: string | null;
  userProp?: import("./AuthFlow").UserProfile | null;
}) {
  const C = useC();
  // ── KEY FIX: use the live user from ProfileContext ──────────
  // ProfileContext.user is updated by UserSync on every render where
  // page.tsx's user state changes (triggered by onUserRefresh).
  // This means badge and role changes appear here instantly.
  const { user: ctxUser } = useProfile();
  const user = ctxUser ?? userProp;

  const nomDisplay    = user ? user.nom.toUpperCase() : "";
  const prenomDisplay = user ? (user.prenom.charAt(0).toUpperCase() + user.prenom.slice(1).toLowerCase()) : "";
  const fullName      = user ? `${nomDisplay} ${prenomDisplay}`.trim() : "";
  const initials      = user
    ? (user.nom.charAt(0) + (user.prenom.charAt(0) ?? "")).toUpperCase()
    : "?";
  const color = user?.avatarColor ?? C.gold;
  const tag = user ? buildTag(user) : "";

  return (
    <div style={{ padding: "44px 20px 16px", flexShrink: 0 }}>
      {/* Avatar */}
      <div style={{ marginBottom: 12 }}>
        {profilePic ? (
          <img src={profilePic} alt="profil" style={{ width: 60, height: 60, borderRadius: "50%", objectFit: "cover", border: `2px solid ${C.gold}` }} />
        ) : (
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 22, color: "#fff", fontFamily: "var(--f-sans)" }}>
            {initials}
          </div>
        )}
      </div>
      {/* Name + badge — badge comes from live ctxUser */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{fullName || "—"}</span>
        {user?.badge && <VerifiedBadgeMini type={user.badge} />}
      </div>
      {/* Tag — role comes from live ctxUser, so elected role appears instantly */}
      <div style={{ fontSize: 12, color: C.sub }}>{tag}</div>
      {/* Matricule */}
      {user?.matricule && (
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2, fontFamily: "var(--f-mono)" }}>{user.matricule}</div>
      )}
    </div>
  );
}

export function AppMenu({ user: userProp }: { user?: import("./AuthFlow").UserProfile | null } = {}) {
  const C = useC();
  const { lang, setLang, t } = useLang();
  const { theme, setTheme } = useTheme();
  const [open,       setOpen]       = useState(false);
  const [langOpen,   setLangOpen]   = useState(false);
  const [notifs,     setNotifs]     = useState(true);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [cropSrc,    setCropSrc]    = useState<string | null>(null);
  const { profilePic, setProfilePic, user: ctxUser, setUser: ctxSetUser } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const darkMode = theme === "dark";
  const LANG_LABELS: Record<string, string> = { fr: "Français", ht: "Kreyòl" };

  // ── Sign out: clears session and reloads to show login screen ─
  const handleSignOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }, []);

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    padding: "14px 20px", background: "transparent",
    border: "none", width: "100%", textAlign: "left",
    cursor: "pointer", fontFamily: "var(--f-sans)",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={() => { setOpen(false); setLangOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.25)" }} />
      )}

      {/* Dots trigger */}
      <button
        onClick={() => { setOpen(o => !o); setLangOpen(false); }}
        style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "4px 2px", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {[0,1,2].map(i => (
          <span key={i} style={{
            width: 4, height: 4, borderRadius: "50%",
            background: open ? C.gold : C.sub,
            display: "block", transition: "background .15s",
          }} />
        ))}
      </button>

      {/* Dropdown panel */}
      <div style={{
        position: "fixed", top: 0, right: 0,
        width: "60%", height: "100vh",
        background: C.surface, zIndex: 301,
        borderLeft: `1px solid ${C.border}`,
        boxShadow: "-4px 4px 24px rgba(0,0,0,.12)",
        opacity: open ? 1 : 0,
        transform: open ? "translateX(0)" : "translateX(20px)",
        pointerEvents: open ? "auto" : "none",
        transition: "transform .22s cubic-bezier(.2,.8,.3,1), opacity .18s ease",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* ── User profile card — reads live user from ProfileContext ── */}
        <UserCard profilePic={profilePic} userProp={userProp} />
        <div style={{ height: 1, background: C.border, margin: "0 16px 8px", flexShrink: 0 }} />

        {/* Set photo */}
        <button style={row} onClick={e => { e.stopPropagation(); setOpen(false); setTimeout(() => setPhotoSheet(true), 50); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke={C.sub} strokeWidth="1.6"/>
            <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" stroke={C.sub} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.setPhoto")}</span>
        </button>
        <div style={{ height: 1, background: C.border, margin: "0 16px", flexShrink: 0 }} />

        {/* Language */}
        <button style={row} onClick={() => setLangOpen(o => !o)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke={C.sub} strokeWidth="1.6"/>
            <path d="M12 3c-2.5 3-4 5.5-4 9s1.5 6 4 9M12 3c2.5 3 4 5.5 4 9s-1.5 6-4 9M3 12h18" stroke={C.sub} strokeWidth="1.4"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.language")}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.sub }}>{LANG_LABELS[lang]}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            style={{ marginLeft: 6, transition: "transform .2s", transform: langOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
            <path d="M6 9l6 6 6-6" stroke={C.sub} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {langOpen && (["fr","ht"] as const).map(l => (
          <button key={l} onClick={() => { setLang(l); setLangOpen(false); }}
            style={{ ...row, paddingLeft: 44, background: lang === l ? C.goldBg : "transparent" }}>
            <span style={{ fontSize: 14, color: lang === l ? C.gold : C.text, fontWeight: lang === l ? 600 : 400 }}>
              {LANG_LABELS[l]}
            </span>
          </button>
        ))}
        <div style={{ height: 1, background: C.border, margin: "0 16px", flexShrink: 0 }} />

        {/* Dark mode */}
        <div style={{ ...row, cursor: "default" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" stroke={C.sub} strokeWidth="1.6"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.darkMode")}</span>
          <div style={{ marginLeft: "auto" }} onClick={() => setTheme(darkMode ? "light" : "dark")}>
            <div style={{ width: 42, height: 24, borderRadius: 99, background: darkMode ? C.gold : C.border2, position: "relative", transition: "background .2s", cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 3, left: darkMode ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .2s" }} />
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: C.border, margin: "0 16px", flexShrink: 0 }} />

        {/* Notifications */}
        <div style={{ ...row, cursor: "default" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={C.sub} strokeWidth="1.6"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={C.sub} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 14, color: C.text }}>{t("menu.notifications")}</span>
          <div style={{ marginLeft: "auto" }} onClick={() => setNotifs(n => !n)}>
            <div style={{ width: 42, height: 24, borderRadius: 99, background: notifs ? C.gold : C.border2, position: "relative", transition: "background .2s", cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 3, left: notifs ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .2s" }} />
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: C.border, margin: "0 16px", flexShrink: 0 }} />

        {/* Sign out */}
        <button style={row} onClick={handleSignOut}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="#E8412A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="16 17 21 12 16 7" stroke="#E8412A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke="#E8412A" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 14, color: "#E8412A", fontWeight: 500 }}>{t("menu.signOut")}</span>
        </button>

        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", padding: "16px 20px 32px", fontSize: 10, color: C.dim }}>
          {t("menu.credit")}
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0]; if (!file) return;
          setCropSrc(URL.createObjectURL(file));
          setPhotoSheet(false);
          e.target.value = "";
        }} />

      {/* Photo sheet */}
      {photoSheet && (
        <PhotoSheet
          onClose={() => setPhotoSheet(false)}
          onGallery={() => { setPhotoSheet(false); setTimeout(() => fileRef.current?.click(), 80); }}
          onCamera={() => { setPhotoSheet(false); setTimeout(() => { if (fileRef.current) { fileRef.current.setAttribute("capture","user"); fileRef.current.click(); } }, 80); }}
        />
      )}
      {cropSrc && (
        <CropScreen
          src={cropSrc}
          onCancel={() => { setCropSrc(null); setPhotoSheet(true); }}
          onConfirm={dataUrl => {
            setProfilePic(dataUrl);
            setCropSrc(null);
            setOpen(false);
            const uid = userProp?.id ?? ctxUser?.id;
            if (uid) updateUserPhoto(uid, dataUrl);
            if (ctxUser) ctxSetUser({ ...ctxUser, profilePhoto: dataUrl });
          }}
        />
      )}
    </>
  );
}