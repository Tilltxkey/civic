"use client";

/**
 * AuthFlow.tsx
 * ─────────────────────────────────────────────────────────────
 * Self-contained authentication gate.
 *
 * SCREENS:
 *   "landing"   → Accéder / Créer un compte choice
 *   "signin"    → Quick sign-in by matricule + nom
 *   "step1"     → Registration: identity + academic info
 *   "step2"     → Badge/ID photo capture with flexible crop
 *   "processing"→ Animated "en cours de vérification" screen
 *   (then onAuth() is called → app loads)
 *
 * PERSISTENCE:
 *   localStorage key "civique_user" — stores the full UserProfile.
 *   On mount, if the key exists we call onAuth() immediately.
 *
 * DB SCHEMA (comment — backend ready):
 *   Table: users
 *     id             uuid PRIMARY KEY DEFAULT gen_random_uuid()
 *     created_at     timestamptz DEFAULT now()
 *     matricule      text UNIQUE NOT NULL          -- student ID
 *     nom            text NOT NULL
 *     prenom         text NOT NULL
 *     sexe           text NOT NULL                 -- 'M' | 'F' | 'Autre'
 *     faculty        text NOT NULL                 -- from FACULTIES list
 *     field          text NOT NULL                 -- from FIELDS[faculty]
 *     year           int  NOT NULL CHECK (year BETWEEN 1 AND 7)
 *     vacation       text NOT NULL                 -- 'Jour' | 'Soir'
 *     role           text NOT NULL DEFAULT 'Étudiant·e'
 *     role_detail    text                          -- for 'Rectorat' free text
 *     badge_photo    text                          -- base64 or storage URL
 *     status         text DEFAULT 'pending'        -- 'pending'|'verified'|'rejected'
 *     verified_at    timestamptz
 *     verified_by    uuid REFERENCES users(id)
 *     avatar_color   text                          -- assigned on creation
 *     badge          text                          -- 'gold'|'blue'|'gray'|null
 * ─────────────────────────────────────────────────────────────
 */

import React, {
  useState, useRef, useCallback, useEffect,
} from "react";
import { useC } from "./tokens";
import { useLang } from "./LangContext";
import { saveUser, checkDuplicate, signInUser, pollUserStatus, getUserById } from "./db";

// ─── CONSTANTS ───────────────────────────────────────────────

export interface UserProfile {
  id:           string;
  matricule:    string;
  nom:          string;
  prenom:       string;
  sexe:         string;
  faculty:      string;
  field:        string;
  year:         number;
  vacation:     string;
  role:         string;
  roleDetail:   string;
  badgePhoto:   string;
  profilePhoto?: string;   // user-set avatar photo (separate from ID badge)
  status:       "pending" | "verified" | "rejected" | "banned";
  avatarColor:  string;
  badge:        "gold" | "blue" | "gray" | null;
  createdAt:    string;
}

// ── Academic data ─────────────────────────────────────────────

const FACULTIES: string[] = [
  "FDSE – Droit & Sciences Économiques",
  "FLA – Lettres & Arts",
  "FST – Sciences & Technologies",
  "FMP – Médecine & Pharmacie",
  "FASCH – Sciences Humaines",
  "FGC – Génie Civil",
  "FA – Architecture",
  "FAMV – Agronomie & Médecine Vétérinaire",
];

const FIELDS: Record<string, string[]> = {
  "FDSE – Droit & Sciences Économiques": [
    "Sciences Économiques", "Droit Privé", "Droit Public",
    "Gestion des Entreprises", "Finance & Comptabilité",
    "Commerce International",
  ],
  "FLA – Lettres & Arts": [
    "Lettres Modernes", "Langues Étrangères Appliquées",
    "Arts Plastiques", "Communication & Journalisme",
  ],
  "FST – Sciences & Technologies": [
    "Mathématiques", "Physique", "Chimie",
    "Informatique", "Biologie",
  ],
  "FMP – Médecine & Pharmacie": [
    "Médecine Générale", "Pharmacie", "Stomatologie",
  ],
  "FASCH – Sciences Humaines": [
    "Sociologie", "Psychologie", "Histoire & Géographie",
    "Philosophie", "Sciences Politiques",
  ],
  "FGC – Génie Civil": [
    "Génie Civil", "Génie Électrique", "Génie Mécanique",
    "Génie Informatique",
  ],
  "FA – Architecture": [
    "Architecture", "Urbanisme & Aménagement",
  ],
  "FAMV – Agronomie & Médecine Vétérinaire": [
    "Agronomie", "Médecine Vétérinaire", "Agroéconomie",
  ],
};

const VACATIONS = ["Jour", "Soir"] as const;

const ROLES = [
  "Étudiant·e",
  "Décanat",
  "Rectorat",
  "N/A",
] as const;

// Roles that don't need academic fields (year, vacation, faculty, field, matricule)
const NON_STUDENT_ROLES: string[] = ["Décanat", "Rectorat", "N/A"];

const AVATAR_COLORS = [
  "#4A6FA5","#5A8A6F","#8B5E3C","#7B4F8E",
  "#C4603A","#4E7A8A","#6B6B3A","#8A4A6B",
];

// ─── HELPERS ─────────────────────────────────────────────────

function randomId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// ─── SHARED UI PRIMITIVES ────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  const C = useC();
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "1px",
      textTransform: "uppercase", color: C.sub, marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function FieldWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ marginBottom: 18, ...style }}>{children}</div>;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
function StyledInput({ error, style, ...rest }: InputProps) {
  const C = useC();
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...rest}
      onFocus={e => { setFocused(true); rest.onFocus?.(e); }}
      onBlur={e => { setFocused(false); rest.onBlur?.(e); }}
      style={{
        width: "100%",
        padding: "13px 14px",
        borderRadius: 12,
        border: `1.5px solid ${error ? "#E8412A" : focused ? C.gold : C.border}`,
        background: C.card,
        color: C.text,
        fontSize: 15,
        fontFamily: "var(--f-sans)",
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color .15s",
        ...style,
      }}
    />
  );
}

function StyledSelect({
  value, onChange, children, error,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  error?: boolean;
}) {
  const C = useC();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          padding: "13px 36px 13px 14px",
          borderRadius: 12,
          border: `1.5px solid ${error ? "#E8412A" : focused ? C.gold : C.border}`,
          background: C.card,
          color: value ? C.text : C.dim,
          fontSize: 15,
          fontFamily: "var(--f-sans)",
          outline: "none",
          appearance: "none",
          WebkitAppearance: "none",
          boxSizing: "border-box",
          transition: "border-color .15s",
          cursor: "pointer",
        }}
      >
        {children}
      </select>
      {/* Chevron */}
      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none"
        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      >
        <path d="M6 9l6 6 6-6" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function PrimaryBtn({
  children, onClick, disabled, color,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const C = useC();
  const bg = color ?? C.gold;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", padding: "15px",
        borderRadius: 14, border: "none",
        background: disabled ? C.border : bg,
        color: disabled ? C.sub : "#fff",
        fontFamily: "var(--f-sans)",
        fontSize: 15, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .2s, color .2s",
        letterSpacing: ".2px",
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const C = useC();
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", padding: "15px",
        borderRadius: 14,
        border: `1.5px solid ${C.border2}`,
        background: "transparent",
        color: C.text,
        fontFamily: "var(--f-sans)",
        fontSize: 15, fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Progress dots for 2-step flow
function StepDots({ step }: { step: 1 | 2 }) {
  const C = useC();
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 28 }}>
      {[1, 2].map(n => (
        <div key={n} style={{
          width: n === step ? 20 : 7,
          height: 7,
          borderRadius: 99,
          background: n === step ? C.gold : C.border2,
          transition: "width .3s cubic-bezier(.2,.8,.3,1), background .3s",
        }} />
      ))}
    </div>
  );
}

// ─── FLEXIBLE CROP SCREEN ────────────────────────────────────
// Supports both square and free-rectangle aspect ratios.
// "square"    → circular mask preview, outputs square JPEG
// "rectangle" → 4:3 mask preview, outputs 4:3 JPEG (badge/ID friendly)

type CropMode = "square" | "rectangle";

function FlexCropScreen({
  src, mode, onConfirm, onCancel,
}: {
  src:       string;
  mode:      CropMode;
  onConfirm: (dataUrl: string) => void;
  onCancel:  () => void;
}) {
  const C = useC();
  const { t } = useLang();

  const DISPLAY_W = typeof window !== "undefined" ? Math.min(window.innerWidth - 48, 300) : 280;
  const DISPLAY_H = mode === "square" ? DISPLAY_W : Math.round(DISPLAY_W * 3 / 4);

  const [offset, setOffset]     = useState({ x: 0, y: 0 });
  const [scale, setScale]       = useState(1);
  const [natSize, setNatSize]   = useState({ w: 1, h: 1 });
  const [ready, setReady]       = useState(false);
  const [pinchStart, setPinchStart] = useState<{ dist: number; scale: number } | null>(null);
  const dragging  = useRef(false);
  const lastPtr   = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const clamp = useCallback((ox: number, oy: number, s: number, nw: number, nh: number) => {
    const imgW = nw * s;
    const imgH = nh * s;
    const maxX = Math.max(0, (imgW - DISPLAY_W) / 2);
    const maxY = Math.max(0, (imgH - DISPLAY_H) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) };
  }, [DISPLAY_W, DISPLAY_H]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const s = Math.max(DISPLAY_W / img.naturalWidth, DISPLAY_H / img.naturalHeight);
    setScale(s);
    setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
    setOffset({ x: 0, y: 0 });
    setReady(true);
  }, [DISPLAY_W, DISPLAY_H]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    setOffset(prev => clamp(prev.x + dx, prev.y + dy, scale, natSize.w, natSize.h));
  };
  const onPointerUp = () => { dragging.current = false; };

  // Pinch-to-zoom
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      setPinchStart({ dist: Math.hypot(dx, dy), scale });
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.hypot(dx, dy);
      const newScale = Math.max(
        Math.max(DISPLAY_W / natSize.w, DISPLAY_H / natSize.h),
        Math.min(4, pinchStart.scale * (newDist / pinchStart.dist))
      );
      setScale(newScale);
      setOffset(prev => clamp(prev.x, prev.y, newScale, natSize.w, natSize.h));
    }
  };

  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const OUT_W = mode === "square" ? 400 : 600;
    const OUT_H = mode === "square" ? 400 : 450;
    canvas.width  = OUT_W;
    canvas.height = OUT_H;

    const img = new window.Image();
    img.onload = () => {
      // Map display crop window → natural image coordinates
      const cx = natSize.w / 2 - offset.x / scale;
      const cy = natSize.h / 2 - offset.y / scale;
      const halfW = (DISPLAY_W / 2) / scale;
      const halfH = (DISPLAY_H / 2) / scale;

      if (mode === "square") {
        // Circular clip for profile photos
        ctx.beginPath();
        ctx.arc(OUT_W / 2, OUT_H / 2, OUT_W / 2, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(
        img,
        cx - halfW, cy - halfH, halfW * 2, halfH * 2,
        0, 0, OUT_W, OUT_H,
      );
      onConfirm(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = src;
  }, [ready, natSize, offset, scale, DISPLAY_W, DISPLAY_H, mode, src, onConfirm]);

  const imgW    = natSize.w * scale;
  const imgH    = natSize.h * scale;
  const imgLeft = DISPLAY_W / 2 - imgW / 2 + offset.x;
  const imgTop  = DISPLAY_H / 2 - imgH / 2 + offset.y;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 500, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        background: "rgba(0,0,0,.8)", backdropFilter: "blur(8px)",
        padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <button onClick={onCancel} style={{
          background: "none", border: "none", color: C.sub, fontSize: 15,
          cursor: "pointer", fontFamily: "var(--f-sans)", padding: "4px 0",
        }}>
          Annuler
        </button>
        <span style={{ color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "var(--f-sans)" }}>
          {mode === "square" ? "Recadrer en carré" : "Recadrer le document"}
        </span>
        <button onClick={handleConfirm} style={{
          background: "none", border: "none", color: C.gold,
          fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--f-sans)",
        }}>
          OK
        </button>
      </div>

      {/* Canvas area */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden",
      }}>
        {/* SVG mask overlay */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 3 }}>
          <defs>
            <mask id={`crop-mask-${mode}`}>
              <rect width="100%" height="100%" fill="white"/>
              {mode === "square"
                ? <circle cx="50%" cy="50%" r={DISPLAY_W / 2} fill="black"/>
                : <rect x="50%" y="50%" width={DISPLAY_W} height={DISPLAY_H}
                    transform={`translate(-${DISPLAY_W/2},-${DISPLAY_H/2})`} fill="black"/>
              }
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask={`url(#crop-mask-${mode})`}/>
          {/* Crop border */}
          {mode === "square"
            ? <circle cx="50%" cy="50%" r={DISPLAY_W / 2} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5"/>
            : <rect x="50%" y="50%" width={DISPLAY_W} height={DISPLAY_H}
                transform={`translate(-${DISPLAY_W/2},-${DISPLAY_H/2})`}
                fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" rx="6"/>
          }
          {/* Rule-of-thirds grid for rectangle mode */}
          {mode === "rectangle" && [1, 2].map(n => (
            <React.Fragment key={n}>
              <line
                x1={`calc(50% - ${DISPLAY_W/2}px + ${(DISPLAY_W/3)*n}px)`}
                y1={`calc(50% - ${DISPLAY_H/2}px)`}
                x2={`calc(50% - ${DISPLAY_W/2}px + ${(DISPLAY_W/3)*n}px)`}
                y2={`calc(50% + ${DISPLAY_H/2}px)`}
                stroke="rgba(255,255,255,.2)" strokeWidth="1"
              />
              <line
                x1={`calc(50% - ${DISPLAY_W/2}px)`}
                y1={`calc(50% - ${DISPLAY_H/2}px + ${(DISPLAY_H/3)*n}px)`}
                x2={`calc(50% + ${DISPLAY_W/2}px)`}
                y2={`calc(50% - ${DISPLAY_H/2}px + ${(DISPLAY_H/3)*n}px)`}
                stroke="rgba(255,255,255,.2)" strokeWidth="1"
              />
            </React.Fragment>
          ))}
        </svg>

        {/* Drag + pinch capture layer */}
        <div
          style={{ position: "absolute", inset: 0, zIndex: 4, cursor: "grab", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={() => setPinchStart(null)}
        />

        {/* The image */}
        {ready && (
          <img
            src={src} draggable={false} alt="crop"
            style={{
              position: "absolute",
              left: `calc(50% - ${DISPLAY_W/2}px + ${imgLeft}px)`,
              top:  `calc(50% - ${DISPLAY_H/2}px + ${imgTop}px)`,
              width: imgW, height: imgH,
              userSelect: "none", pointerEvents: "none", zIndex: 1,
            }}
          />
        )}
        <img src={src} onLoad={handleLoad} style={{ display: ready ? "none" : "block", opacity: 0, position: "absolute" }} alt="" />
      </div>

      {/* Hint */}
      <div style={{
        background: "rgba(0,0,0,.8)", backdropFilter: "blur(8px)",
        textAlign: "center", padding: "14px 20px 36px",
        fontSize: 12, color: "rgba(255,255,255,.5)",
        fontFamily: "var(--f-sans)", flexShrink: 0,
      }}>
        {mode === "square"
          ? "Glissez pour centrer · Pincez pour zoomer"
          : "Ajustez le document dans le cadre · Pincez pour zoomer"
        }
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

// ─── SCREEN: LANDING ─────────────────────────────────────────

function LandingScreen({
  onSignIn, onRegister,
}: {
  onSignIn:  () => void;
  onRegister: () => void;
}) {
  const C = useC();
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: "100%", padding: "40px 28px 52px",
    }}>
      {/* Logo mark */}
      <div style={{ marginBottom: 32, animation: "fadeup .5s ease both" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22,
          background: C.surface,
          border: `1.5px solid ${C.border2}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 24px rgba(0,0,0,.08)",
        }}>
          {/* Ballot icon */}
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="3" width="16" height="18" rx="2.5" fill={C.gold} opacity=".15"/>
            <rect x="4" y="3" width="16" height="18" rx="2.5" stroke={C.gold} strokeWidth="1.5"/>
            <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      {/* Wordmark */}
      <div style={{ animation: "fadeup .5s ease .07s both", marginBottom: 8 }}>
        <div style={{
          fontWeight: 700, fontSize: 28, color: C.text,
          letterSpacing: "-1px", lineHeight: 1,
        }}>
          Civique
        </div>
        <div style={{
          fontSize: 11, letterSpacing: "3px", color: C.sub,
          textTransform: "uppercase", marginTop: 4, textAlign: "center",
        }}>
          FDSE · 2026
        </div>
      </div>

      <div style={{
        fontSize: 14, color: C.sub, textAlign: "center",
        lineHeight: 1.6, maxWidth: 260,
        animation: "fadeup .5s ease .12s both", marginBottom: 52,
      }}>
        La plateforme électorale et académique de votre faculté.
      </div>

      {/* CTAs */}
      <div style={{
        width: "100%", maxWidth: 340,
        display: "flex", flexDirection: "column", gap: 12,
        animation: "fadeup .5s ease .18s both",
      }}>
        <PrimaryBtn onClick={onRegister}>
          Créer mon compte
        </PrimaryBtn>
        <GhostBtn onClick={onSignIn}>
          J'ai déjà un compte
        </GhostBtn>
      </div>

      <div style={{
        marginTop: 36, fontSize: 10, color: C.dim,
        animation: "fadeup .5s ease .24s both", textAlign: "center",
      }}>
        Vos données sont sécurisées · Accès réservé aux membres FDSE
      </div>
    </div>
  );
}

// ─── SCREEN: SIGN IN ─────────────────────────────────────────

// ─── FINGERPRINT ICON ────────────────────────────────────────
function FingerprintIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <path d="M28 6C17.5 6 9 14.5 9 25c0 9.8 5.2 18.3 12.9 23" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M28 6c10.5 0 19 8.5 19 19 0 9.8-5.2 18.3-12.9 23" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M28 14c-6.1 0-11 4.9-11 11 0 7.2 2.3 13.9 6.2 19.3" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M28 14c6.1 0 11 4.9 11 11 0 7.2-2.3 13.9-6.2 19.3" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M28 22c-1.7 0-3 1.3-3 3 0 5.2 1.4 10.1 3.8 14.4" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M28 22c1.7 0 3 1.3 3 3 0 5.2-1.4 10.1-3.8 14.4" stroke={color} strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M19 10.5C14.2 13.5 11 18.9 11 25" stroke={color} strokeWidth="2.4" strokeLinecap="round" opacity=".55"/>
      <path d="M37 10.5C41.8 13.5 45 18.9 45 25" stroke={color} strokeWidth="2.4" strokeLinecap="round" opacity=".55"/>
      <circle cx="28" cy="25" r="2" fill={color}/>
    </svg>
  );
}

// ─── BIOMETRIC HELPERS ───────────────────────────────────────
// We store { userId, credentialId } in localStorage after a successful
// manual login + WebAuthn registration. On subsequent visits, we use
// navigator.credentials.get() to verify presence/liveness, then fetch
// the user from DB by stored userId — no password transmitted.

const BIO_KEY = "civique_bio_v1";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function registerBiometric(userId: string, userName: string): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const hostname = window.location.hostname;
    // On localhost/IP, omit rpId so the browser uses its default
    const rpId = (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname))
      ? undefined
      : hostname;
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Civique", ...(rpId ? { id: rpId } : {}) },
        user: {
          id: new TextEncoder().encode(userId),
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "preferred", // "preferred" is more compatible than "required"
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(BIO_KEY, JSON.stringify({
      userId,
      credentialId: base64url(cred.rawId),
      rpId: rpId ?? window.location.hostname,
    }));
    return true;
  } catch (e) {
    console.warn("[Civique] registerBiometric failed:", e);
    return false;
  }
}

async function authenticateWithBiometric(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(BIO_KEY);
    if (!raw) return null;
    const { userId, credentialId, rpId } = JSON.parse(raw) as { userId: string; credentialId: string; rpId?: string };
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credIdBytes = Uint8Array.from(
      atob(credentialId.replace(/-/g, "+").replace(/_/g, "/")),
      c => c.charCodeAt(0)
    );
    const hostname = window.location.hostname;
    const useRpId = (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname))
      ? undefined
      : (rpId ?? hostname);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        ...(useRpId ? { rpId: useRpId } : {}),
        allowCredentials: [{ type: "public-key", id: credIdBytes }],
        userVerification: "preferred",
        timeout: 60000,
      },
    });
    if (!assertion) return null;
    return userId;
  } catch (e) {
    console.warn("[Civique] authenticateWithBiometric failed:", e);
    return null;
  }
}

function SignInScreen({
  onBack, onSuccess,
}: {
  onBack:    () => void;
  onSuccess: (user: UserProfile) => void;
}) {
  const C = useC();
  const [matricule, setMatricule]   = useState("");
  const [nom, setNom]               = useState("");
  const [err, setErr]               = useState("");
  const [loading, setLoading]       = useState(false);
  const [bioAvail, setBioAvail]     = useState(false);
  const [bioSaved, setBioSaved]     = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioState, setBioState]     = useState<"idle"|"scanning"|"success"|"fail">("idle");

  useEffect(() => {
    isBiometricAvailable().then(ok => setBioAvail(ok));
    setBioSaved(!!localStorage.getItem(BIO_KEY));
  }, []);

  const handleSubmit = () => {
    if (!matricule.trim() || !nom.trim()) {
      setErr("Veuillez remplir tous les champs.");
      return;
    }
    setErr("");
    setLoading(true);
    signInUser(matricule, nom).then(async ({ user, error }) => {
      setLoading(false);
      if (user) {
        // If biometric is available and not yet registered, offer to save
        if (!localStorage.getItem(BIO_KEY)) {
          await registerBiometric(user.id, `${user.prenom} ${user.nom}`).catch(() => {});
          setBioSaved(!!localStorage.getItem(BIO_KEY));
        }
        onSuccess(user);
        return;
      }
      if (error === "no_db") {
        console.warn("[Civique] DB not ready.", {
          url:  !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          key:  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        });
        setErr("Connexion à la base de données impossible. Vérifiez le fichier .env.local et redémarrez le serveur.");
        return;
      }
      if (error === "not_found" || error === "wrong_nom") {
        setErr("Matricule ou nom de famille incorrect.");
      } else {
        setErr("Erreur de connexion. Réessayez.");
      }
    });
  };

  const handleBiometric = async () => {
    setBioState("scanning");
    setBioLoading(true);
    setErr("");
    const userId = await authenticateWithBiometric();
    if (!userId) {
      setBioState("fail");
      setBioLoading(false);
      setTimeout(() => setBioState("idle"), 2000);
      setErr("Authentification biométrique échouée. Connectez-vous manuellement.");
      return;
    }
    const { user } = await getUserById(userId);
    setBioLoading(false);
    if (!user) {
      setBioState("fail");
      setTimeout(() => setBioState("idle"), 2000);
      setErr("Compte introuvable. Reconnectez-vous manuellement.");
      localStorage.removeItem(BIO_KEY);
      setBioSaved(false);
      return;
    }
    setBioState("success");
    setTimeout(() => onSuccess(user), 600);
  };

  // ── Enrolled: show fingerprint as the main UI ────────────
  if (bioSaved) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", padding: "0 0 40px" }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px 0", flexShrink: 0,
        }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 22, color: C.gold, padding: "0 4px",
            WebkitTapHighlightColor: "transparent",
          }}>‹</button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>Bon retour</div>
            <div style={{ fontSize: 12, color: C.sub }}>Connexion biométrique</div>
          </div>
        </div>

        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "0 32px 40px", gap: 0,
        }}>
          {/* Fingerprint hero button */}
          <button
            onClick={handleBiometric}
            disabled={bioLoading}
            style={{
              background: "none", border: "none", cursor: bioLoading ? "default" : "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
              padding: 0, WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Animated glow ring */}
            <div style={{
              position: "relative",
              width: 140, height: 140,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 28,
            }}>
              {/* Outer glow rings */}
              {bioState === "scanning" && <>
                <div style={{
                  position: "absolute", inset: -14, borderRadius: "50%",
                  border: `2px solid ${C.gold}`,
                  opacity: 0.25,
                  animation: "pendingPulse 1s ease-in-out infinite",
                }}/>
                <div style={{
                  position: "absolute", inset: -26, borderRadius: "50%",
                  border: `1.5px solid ${C.gold}`,
                  opacity: 0.12,
                  animation: "pendingPulse 1s ease-in-out .25s infinite",
                }}/>
              </>}
              {/* Circle bg */}
              <div style={{
                width: 140, height: 140, borderRadius: "50%",
                background: bioState === "success"
                  ? "rgba(34,197,94,.1)"
                  : bioState === "fail"
                  ? "rgba(232,65,42,.08)"
                  : C.goldBg,
                border: `2px solid ${
                  bioState === "success" ? "rgba(34,197,94,.4)"
                  : bioState === "fail" ? "rgba(232,65,42,.3)"
                  : C.gold + "33"
                }`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background .3s, border-color .3s",
                boxShadow: bioState === "idle" || bioState === "scanning"
                  ? `0 0 0 16px ${C.goldBg}55, 0 0 0 32px ${C.goldBg}22`
                  : "none",
              }}>
                {bioState === "success"
                  ? <svg width="52" height="52" viewBox="0 0 24 24" fill="none" style={{ animation: "checkPop .4s cubic-bezier(.2,.8,.3,1) both" }}>
                      <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  : bioState === "fail"
                  ? <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="#E8412A" strokeWidth="2.2" strokeLinecap="round"/>
                    </svg>
                  : <FingerprintIcon size={72} color={C.gold} />
                }
              </div>
            </div>

            {/* Label */}
            <div style={{
              fontWeight: 700, fontSize: 20, letterSpacing: "-.3px",
              color: bioState === "success" ? "#22C55E"
                : bioState === "fail" ? "#E8412A"
                : C.text,
              marginBottom: 8, transition: "color .25s",
            }}>
              {bioState === "scanning" ? "Scan en cours…"
                : bioState === "success" ? "Bienvenue !"
                : bioState === "fail"    ? "Non reconnu"
                : "Poser le doigt"}
            </div>
            <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, textAlign: "center", maxWidth: 240 }}>
              {bioState === "scanning" ? "Posez votre doigt ou regardez l'écran"
                : bioState === "success" ? "Connexion en cours…"
                : bioState === "fail"    ? "Essayez de nouveau ou connectez-vous manuellement"
                : "Touch ID · Face ID · Empreinte"}
            </div>
          </button>

          {err && (
            <div style={{
              fontSize: 13, color: "#E8412A",
              background: "#FDF1EF", borderRadius: 10,
              padding: "10px 14px", marginTop: 28, width: "100%",
            }}>
              {err}
            </div>
          )}

          {/* Manual login fallback link */}
          <button
            onClick={() => setBioSaved(false)}
            style={{
              marginTop: 36, background: "none", border: "none",
              fontSize: 13, color: C.sub, cursor: "pointer",
              fontFamily: "var(--f-sans)",
              textDecoration: "underline", textDecorationColor: C.border2,
            }}
          >
            Se connecter manuellement
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", padding: "0 0 40px" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px 0", flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 22, color: C.gold, padding: "0 4px",
          WebkitTapHighlightColor: "transparent",
        }}>‹</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
            Bon retour
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>Connectez-vous à votre compte</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "32px 24px 0", overflowY: "auto" }}>
        <FieldWrap>
          <Label>Matricule étudiant</Label>
          <StyledInput
            value={matricule}
            onChange={e => setMatricule(e.target.value)}
            placeholder="ex : 2021-0042"
            autoCapitalize="none"
            error={!!err}
          />
        </FieldWrap>

        <FieldWrap>
          <Label>Nom de famille</Label>
          <StyledInput
            value={nom}
            onChange={e => setNom(e.target.value)}
            placeholder="Votre nom de famille"
            error={!!err}
          />
        </FieldWrap>

        {err && (
          <div style={{
            fontSize: 13, color: "#E8412A",
            background: "#FDF1EF", borderRadius: 10,
            padding: "10px 14px", marginBottom: 20,
          }}>
            {err}
          </div>
        )}

        {/* ── Biometric button ── */}
        {(
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            {/* Divider */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              marginBottom: 20,
            }}>
              <div style={{ flex: 1, height: 1, background: C.border }}/>
              <span style={{ fontSize: 11, color: C.dim, letterSpacing: ".5px", textTransform: "uppercase" }}>
                ou
              </span>
              <div style={{ flex: 1, height: 1, background: C.border }}/>
            </div>

            <button
              onClick={handleBiometric}
              disabled={bioLoading}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                padding: "15px",
                borderRadius: 14,
                border: `1.5px solid ${
                  bioState === "success" ? "#22C55E"
                  : bioState === "fail"  ? "#E8412A"
                  : C.border2
                }`,
                background: bioState === "success"
                  ? "rgba(34,197,94,.08)"
                  : bioState === "fail"
                  ? "rgba(232,65,42,.06)"
                  : C.card,
                cursor: bioLoading ? "not-allowed" : "pointer",
                transition: "border-color .2s, background .2s",
                WebkitTapHighlightColor: "transparent",
                fontFamily: "var(--f-sans)",
              }}
            >
              {/* Icon */}
              <div style={{
                width: 36, height: 36,
                borderRadius: 10,
                background: bioState === "success"
                  ? "rgba(34,197,94,.14)"
                  : bioState === "fail"
                  ? "rgba(232,65,42,.1)"
                  : C.goldBg,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                transition: "background .2s",
              }}>
                {bioState === "scanning" ? (
                  /* Pulse ring while scanning */
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    border: `2.5px solid ${C.gold}`,
                    animation: "pendingPulse 1s ease-in-out infinite",
                  }}/>
                ) : bioState === "success" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : bioState === "fail" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="#E8412A" strokeWidth="2.2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <FingerprintIcon size={22} color={C.gold} />
                )}
              </div>

              {/* Label */}
              <div style={{ textAlign: "left" }}>
                <div style={{
                  fontSize: 14, fontWeight: 700,
                  color: bioState === "success" ? "#22C55E"
                    : bioState === "fail" ? "#E8412A"
                    : C.text,
                  transition: "color .2s",
                }}>
                  {bioState === "scanning" ? "Scan en cours…"
                    : bioState === "success" ? "Identité confirmée"
                    : bioState === "fail"    ? "Échec de reconnaissance"
                    : bioSaved              ? "Connexion biométrique"
                    : "Activer la biométrie"}
                </div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 1 }}>
                  {bioState === "scanning" ? "Posez votre doigt ou regardez l'écran"
                    : bioState === "success" ? "Connexion en cours…"
                    : bioState === "fail"    ? "Réessayez ou utilisez le formulaire"
                    : bioSaved              ? "Empreinte · Face ID · PIN"
                    : "Se connectera sans matricule à l'avenir"}
                </div>
              </div>
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
        <PrimaryBtn onClick={handleSubmit} disabled={loading || !matricule.trim() || !nom.trim()}>
          {loading ? "Vérification…" : "Se connecter"}
        </PrimaryBtn>
      </div>
    </div>
  );
}

function normalize(s: string) {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ─── SCREEN: STEP 1 — IDENTITY + ACADEMIC INFO ───────────────

interface Step1Data {
  matricule:  string;
  nom:        string;
  prenom:     string;
  sexe:       string;
  faculty:    string;
  field:      string;
  year:       string;
  vacation:   string;
  role:       string;
  roleDetail: string;
}

function Step1Screen({
  onBack, onNext,
}: {
  onBack: () => void;
  onNext: (data: Step1Data) => void;
}) {
  const C = useC();
  const [d, setD] = useState<Step1Data>({
    matricule: "", nom: "", prenom: "",
    sexe: "M",
    faculty: "FDSE – Droit & Sciences Économiques",
    field:   "Sciences Économiques",
    year: "", vacation: "Jour", role: "Étudiant·e", roleDetail: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Step1Data, boolean>>>({});
  const [dupError, setDupError] = useState("");

  const set = (k: keyof Step1Data, v: string) => {
    setD(prev => {
      const next = { ...prev, [k]: v };
      // When faculty changes, reset field
      if (k === "faculty") next.field = "";
      return next;
    });
    setErrors(prev => ({ ...prev, [k]: false }));
  };

  const availableFields = d.faculty ? (FIELDS[d.faculty] ?? []) : [];

  const validate = (): boolean => {
    const e: Partial<Record<keyof Step1Data, boolean>> = {};
    const isNonStudent = NON_STUDENT_ROLES.includes(d.role);
    if (!d.matricule.trim() && !isNonStudent) e.matricule = true;
    if (!d.nom.trim())       e.nom       = true;
    if (!d.prenom.trim())    e.prenom    = true;
    if (!isNonStudent) {
      if (!d.faculty)        e.faculty   = true;
      if (!d.field)          e.field     = true;
      if (!d.year || +d.year < 1 || +d.year > 7) e.year = true;
      if (!d.vacation)       e.vacation  = true;
    }
    if (!d.role)             e.role      = true;
    if (d.role === "Rectorat" && !d.roleDetail.trim()) e.roleDetail = true;
    if (d.role === "Décanat" && !d.roleDetail.trim())  e.roleDetail = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const [dupChecking, setDupChecking] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px 0", flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 22, color: C.gold, padding: "0 4px",
          WebkitTapHighlightColor: "transparent",
        }}>‹</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
            Créer mon compte
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>Étape 1 sur 2 — Vos informations</div>
        </div>
      </div>

      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <StepDots step={1} />
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>

        {/* ── Identity ── */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: C.dim, textTransform: "uppercase", marginBottom: 14 }}>
          Identité
        </div>

        {/* Row 1: Nom + Prénom */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
          <div>
            <Label>Nom *</Label>
            <StyledInput
              value={d.nom}
              onChange={e => set("nom", e.target.value)}
              placeholder="Nom"
              error={errors.nom}
            />
          </div>
          <div>
            <Label>Prénom *</Label>
            <StyledInput
              value={d.prenom}
              onChange={e => set("prenom", e.target.value)}
              placeholder="Prénom"
              error={errors.prenom}
            />
          </div>
        </div>

        {/* Row 2: Sexe (full width, before role) */}
        <FieldWrap>
          <Label>Sexe *</Label>
          <StyledSelect value={d.sexe} onChange={v => set("sexe", v)} error={errors.sexe}>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
            <option value="N/A">N/A</option>
          </StyledSelect>
        </FieldWrap>

        {/* ── Role (controls which fields appear below) ── */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: C.dim, textTransform: "uppercase", marginBottom: 14, marginTop: 6 }}>
          Rôle dans l'institution
        </div>

        <FieldWrap>
          <Label>Statut *</Label>
          <StyledSelect value={d.role} onChange={v => set("role", v)} error={errors.role}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </StyledSelect>
        </FieldWrap>

        {/* Rectorat / Décanat free-text */}
        {(d.role === "Rectorat" || d.role === "Décanat") && (
          <FieldWrap style={{ animation: "fadeup .2s ease both" }}>
            <Label>Précisez votre fonction *</Label>
            <StyledInput
              value={d.roleDetail}
              onChange={e => set("roleDetail", e.target.value)}
              placeholder="ex : Vice-doyen, Resp. communication…"
              error={errors.roleDetail}
            />
          </FieldWrap>
        )}

        {/* Matricule — shown only for students */}
        {!NON_STUDENT_ROLES.includes(d.role) && (
          <FieldWrap style={{ animation: "fadeup .2s ease both" }}>
            <Label>Matricule étudiant *</Label>
            <StyledInput
              value={d.matricule}
              onChange={e => set("matricule", e.target.value)}
              placeholder="ex : 2021-0042"
              autoCapitalize="none"
              error={errors.matricule}
            />
          </FieldWrap>
        )}

        {/* ── Academic fields — hidden for non-student roles ── */}
        {!NON_STUDENT_ROLES.includes(d.role) && (
          <>
            {/* Faculté + Filière */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div>
                <Label>Faculté *</Label>
                <StyledSelect value={d.faculty} onChange={v => set("faculty", v)} error={errors.faculty}>
                  {FACULTIES.map(f => <option key={f} value={f}>{f}</option>)}
                </StyledSelect>
              </div>
              <div>
                <Label>Filière *</Label>
                <StyledSelect value={d.field} onChange={v => set("field", v)} error={errors.field}>
                  <option value="" disabled>
                    {d.faculty ? "Filière…" : "— d'abord la faculté"}
                  </option>
                  {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                </StyledSelect>
              </div>
            </div>

            {/* ── Academic info ── */}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: C.dim, textTransform: "uppercase", marginBottom: 14, marginTop: 6 }}>
              Parcours académique
            </div>

            {/* Year + Vacation side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div>
                <Label>Année (1–7) *</Label>
                <StyledInput
                  value={d.year}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "");
                    if (v === "" || (+v >= 1 && +v <= 7)) set("year", v);
                  }}
                  placeholder="ex : 3"
                  inputMode="numeric"
                  maxLength={1}
                  error={errors.year}
                />
              </div>
              <div>
                <Label>Vacation *</Label>
                <StyledSelect value={d.vacation} onChange={v => set("vacation", v)} error={errors.vacation}>
                  <option value="" disabled>Choisir…</option>
                  {VACATIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="N/A">N/A</option>
                </StyledSelect>
              </div>
            </div>
          </>
        )}

        {/* Any field error reminder */}
        {Object.keys(errors).length > 0 && !dupError && (
          <div style={{
            fontSize: 13, color: "#E8412A",
            background: "#FDF1EF", borderRadius: 10,
            padding: "10px 14px", marginBottom: 8,
          }}>
            Veuillez corriger les champs en rouge.
          </div>
        )}
        {dupError && (
          <div style={{
            fontSize: 13, color: "#E8412A",
            background: "#FDF1EF", borderRadius: 10,
            padding: "10px 14px", marginBottom: 8,
            lineHeight: 1.5,
          }}>
            {dupError}
          </div>
        )}
      </div>

      {/* CTA pinned */}
      <div style={{ padding: "12px 24px 28px", flexShrink: 0 }}>
        <PrimaryBtn onClick={async () => {
          setDupError("");
          if (!validate()) return;
          if (!NON_STUDENT_ROLES.includes(d.role) && d.matricule.trim()) {
            setDupChecking(true);
            const isDup = await checkDuplicate(d.matricule);
            setDupChecking(false);
            if (isDup) {
              setErrors(prev => ({ ...prev, matricule: true }));
              setDupError("Ce matricule est déjà associé à un compte. Utilisez « J'ai déjà un compte » pour vous connecter.");
              return;
            }
          }
          onNext(d);
        }} disabled={dupChecking}>
          {dupChecking ? "Vérification…" : "Continuer →"}
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ─── SCREEN: STEP 2 — BADGE / ID PHOTO ───────────────────────

function Step2Screen({
  onBack, onSubmit,
}: {
  onBack:    () => void;
  onSubmit:  (photo: string) => void;
}) {
  const C = useC();
  const [photo, setPhoto]     = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [sheet, setSheet]     = useState<"why" | "tips" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    e.target.value = "";
  };

  if (cropSrc) {
    return (
      <FlexCropScreen
        src={cropSrc}
        mode="rectangle"
        onCancel={() => setCropSrc(null)}
        onConfirm={dataUrl => { setPhoto(dataUrl); setCropSrc(null); }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px 0", flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 22, color: C.gold, padding: "0 4px",
          WebkitTapHighlightColor: "transparent",
        }}>‹</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
            Vérification d'identité
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>Étape 2 sur 2 — Votre pièce justificative</div>
        </div>
      </div>

      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <StepDots step={2} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 24px 24px" }}>

        {/* ── Documents acceptés (always visible) ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", color: C.dim, textTransform: "uppercase", marginBottom: 10 }}>
            Documents acceptés
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {([
              [<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="12" height="16" rx="1.5" stroke={C.gold} strokeWidth="1.6"/><path d="M7 8h4M7 11h4M7 14h2" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><rect x="13" y="9" width="8" height="5" rx="1" fill={C.gold} opacity=".18" stroke={C.gold} strokeWidth="1.4"/><path d="M15 11.5h4" stroke={C.gold} strokeWidth="1.3" strokeLinecap="round"/></svg>, "Badge étudiant officiel"],
              [<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={C.gold} strokeWidth="1.6"/><path d="M14 2v6h6" stroke={C.gold} strokeWidth="1.6"/><path d="M8 13h8M8 17h5" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/></svg>, "Fiche d'immatriculation"],
              [<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke={C.gold} strokeWidth="1.6"/><path d="M7 9h10M7 13h6" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><circle cx="18" cy="13" r="2" stroke={C.gold} strokeWidth="1.4"/></svg>, "Carte universitaire"],
              [<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 12h6M9 16h4" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke={C.gold} strokeWidth="1.6"/><path d="M16 3v4h4" stroke={C.gold} strokeWidth="1.4"/></svg>, "Tout document officiel FDSE"],
            ] as [React.ReactNode, string][]).map(([icon, label]) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 13, color: C.text,
              }}>
                <span style={{ display:"flex", alignItems:"center" }}>{icon}</span>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* ── Info icon buttons ── */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <button
            onClick={() => setSheet("why")}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              padding: "11px 14px", borderRadius: 12,
              border: `1.5px solid ${C.border2}`,
              background: C.card, cursor: "pointer",
              fontFamily: "var(--f-sans)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke={C.gold} strokeWidth="1.6"/>
              <path d="M12 11v5" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="12" cy="7.5" r="1" fill={C.gold}/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              Pourquoi cette étape ?
            </span>
          </button>

          <button
            onClick={() => setSheet("tips")}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              padding: "11px 14px", borderRadius: 12,
              border: `1.5px solid ${C.border2}`,
              background: C.card, cursor: "pointer",
              fontFamily: "var(--f-sans)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke={C.gold} strokeWidth="1.6"/>
              <circle cx="12" cy="13" r="4" stroke={C.gold} strokeWidth="1.6"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              Conseils photo
            </span>
          </button>
        </div>

        {/* ── Bottom sheet modal ── */}
        {sheet && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setSheet(null)}
              style={{
                position: "fixed", inset: 0, zIndex: 400,
                background: "rgba(0,0,0,.45)",
                animation: "fadeup .15s ease both",
              }}
            />
            {/* Sheet — outer container: no scroll, fixed height */}
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              zIndex: 401,
              background: C.surface,
              borderRadius: "20px 20px 0 0",
              boxShadow: "0 -4px 32px rgba(0,0,0,.18)",
              animation: "sheetUp .28s cubic-bezier(.2,.8,.3,1) both",
              maxHeight: "80vh",
              display: "flex", flexDirection: "column",
            }}>
              {/* ── Sticky header: handle + title + X — never scrolls ── */}
              <div style={{
                flexShrink: 0,
                padding: "0 20px 0",
                borderBottom: `1px solid ${C.border}`,
              }}>
                {/* Drag handle */}
                <div style={{
                  width: 36, height: 4, borderRadius: 99,
                  background: C.border2, margin: "12px auto 0",
                }}/>
                {/* Title row */}
                <div style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 0 14px",
                }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>
                    {sheet === "why" ? "Pourquoi cette étape ?" : "Conseils pour une bonne photo"}
                  </div>
                  <button
                    onClick={() => setSheet(null)}
                    style={{
                      width: 30, height: 30, borderRadius: "50%",
                      border: "none", background: C.card,
                      color: C.sub, fontSize: 16,
                      cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginLeft: 12,
                      WebkitTapHighlightColor: "transparent",
                      fontFamily: "var(--f-sans)",
                    }}
                  >✕</button>
                </div>
              </div>

              {/* ── Scrollable body ── */}
              <div style={{ overflowY: "auto", padding: "20px 20px 32px", flex: 1 }}>
                {sheet === "why" ? (
                  <>
                    <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.65, marginBottom: 22 }}>
                      Votre compte est vérifié par l'administration avant activation.
                      Cette pièce confirme que vous êtes bien membre de l'institution.
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", color: C.dim, textTransform: "uppercase", marginBottom: 12 }}>
                      Documents acceptés
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {([
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="12" height="16" rx="1.5" stroke={C.gold} strokeWidth="1.6"/><path d="M7 8h4M7 11h4M7 14h2" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><rect x="13" y="9" width="8" height="5" rx="1" fill={C.gold} opacity=".18" stroke={C.gold} strokeWidth="1.4"/><path d="M15 11.5h4" stroke={C.gold} strokeWidth="1.3" strokeLinecap="round"/></svg>, "Badge étudiant officiel"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={C.gold} strokeWidth="1.6"/><path d="M14 2v6h6" stroke={C.gold} strokeWidth="1.6"/><path d="M8 13h8M8 17h5" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/></svg>, "Fiche d'immatriculation"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke={C.gold} strokeWidth="1.6"/><path d="M7 9h10M7 13h6" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><circle cx="18" cy="13" r="2" stroke={C.gold} strokeWidth="1.4"/></svg>, "Carte universitaire"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 12h6M9 16h4" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/><path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke={C.gold} strokeWidth="1.6"/><path d="M16 3v4h4" stroke={C.gold} strokeWidth="1.4"/></svg>, "Tout document officiel FDSE"],
                      ] as [React.ReactNode, string][]).map(([icon, label]) => (
                        <div key={label} style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "13px 14px", borderRadius: 12,
                          background: C.card, border: `1px solid ${C.border}`,
                        }}>
                          <span style={{ display:"flex", alignItems:"center" }}>{icon}</span>
                          <span style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.65, marginBottom: 22 }}>
                      Une photo nette et lisible accélère la vérification de votre compte.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {([
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3a6 6 0 0 1 6 6c0 2.5-1.5 4.6-3 5.7V17a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2.3C7.5 13.6 6 11.5 6 9a6 6 0 0 1 6-6z" stroke={C.gold} strokeWidth="1.6"/><path d="M9 21h6" stroke={C.gold} strokeWidth="1.6" strokeLinecap="round"/></svg>, "Bonne luminosité", "Évitez les reflets et les zones d'ombre"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={C.gold} strokeWidth="1.6"/><path d="M20 20l-3-3" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round"/><path d="M8 11h6M11 8v6" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round"/></svg>, "Document entier visible", "Le cadre doit contenir tout le document"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke={C.gold} strokeWidth="1.6"/><path d="M3 9h18M9 3v18" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round"/></svg>, "Tenez le document bien à plat", "Pas de pliures ni d'angle prononcé"],
                        [<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={C.gold} strokeWidth="1.6"/><path d="M15 9l-6 6M9 9l6 6" stroke={C.gold} strokeWidth="1.6" strokeLinecap="round"/></svg>, "Aucun texte masqué", "Toutes les informations doivent être lisibles"],
                      ] as [React.ReactNode, string, string][]).map(([icon, title, desc]) => (
                        <div key={title} style={{
                          display: "flex", alignItems: "flex-start", gap: 14,
                          padding: "13px 14px", borderRadius: 12,
                          background: C.card, border: `1px solid ${C.border}`,
                        }}>
                          <span style={{ display:"flex", alignItems:"center", flexShrink: 0, marginTop: 1 }}>{icon}</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{title}</div>
                            <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <button
                  onClick={() => setSheet(null)}
                  style={{
                    marginTop: 24, width: "100%",
                    padding: "14px", borderRadius: 14,
                    border: "none", background: C.gold,
                    color: "#fff", fontSize: 15, fontWeight: 700,
                    fontFamily: "var(--f-sans)", cursor: "pointer",
                  }}
                >
                  Compris
                </button>
              </div>
            </div>
          </>
        )}

        {/* Photo preview / upload zone */}
        {photo ? (
          <div style={{ marginBottom: 24 }}>
            <Label>Document ajouté</Label>
            <div style={{
              position: "relative",
              borderRadius: 12, overflow: "hidden",
              border: `1.5px solid ${C.gold}`,
              boxShadow: `0 0 0 4px ${C.goldBg}`,
            }}>
              <img src={photo} alt="badge" style={{ width: "100%", display: "block", borderRadius: 12 }} />
              <button
                onClick={() => setPhoto(null)}
                style={{
                  position: "absolute", top: 10, right: 10,
                  background: "rgba(0,0,0,.6)", border: "none",
                  borderRadius: "50%", width: 30, height: 30,
                  color: "#fff", fontSize: 14, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  WebkitTapHighlightColor: "transparent",
                }}
              >✕</button>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                marginTop: 10, background: "none", border: "none",
                color: C.gold, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--f-sans)",
                padding: 0, WebkitTapHighlightColor: "transparent",
              }}
            >
              Reprendre la photo
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              width: "100%", padding: "32px 20px",
              borderRadius: 14,
              border: `2px dashed ${C.border2}`,
              background: C.card,
              cursor: "pointer",
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: 10,
              marginBottom: 24,
              WebkitTapHighlightColor: "transparent",
              transition: "border-color .15s",
            }}
            onTouchStart={e => (e.currentTarget.style.borderColor = C.gold)}
            onTouchEnd={e => (e.currentTarget.style.borderColor = C.border2)}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: C.goldBg,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke={C.gold} strokeWidth="1.6"/>
                <circle cx="12" cy="13" r="4" stroke={C.gold} strokeWidth="1.6"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              Prendre / choisir une photo
            </div>
            <div style={{ fontSize: 12, color: C.sub }}>
              Appareil photo ou galerie
            </div>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFile}
        />
      </div>

      {/* CTA */}
      <div style={{ padding: "12px 24px 28px", flexShrink: 0 }}>
        <PrimaryBtn onClick={() => photo && onSubmit(photo)} disabled={!photo}>
          Envoyer ma demande
        </PrimaryBtn>
        {!photo && (
          <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: C.dim }}>
            Une photo est requise pour continuer
          </div>
        )}
        {/* Temporary skip — low memory fallback */}
        <button
          onClick={() => onSubmit("__skipped__")}
          style={{
            display: "block", margin: "14px auto 0",
            background: "none", border: "none",
            fontSize: 11, color: C.border2,
            cursor: "pointer", fontFamily: "var(--f-sans)",
          }}
        >
          passer
        </button>
      </div>
    </div>
  );
}

// ─── SCREEN: PROCESSING ──────────────────────────────────────
// Receives user directly — no ref tricks, no localStorage.
// Timers are properly cleaned up so Strict Mode double-invoke is safe.

// ─── SCREEN: PROCESSING (polls DB for admin approval) ────────
// Drop-in replacement for the ProcessingScreen function in AuthFlow.tsx.
// Also add this import at the top of AuthFlow.tsx alongside the other db imports:
//   import { saveUser, checkDuplicate, signInUser, pollUserStatus } from "./db";

const PENDING_KEY = "civique_pending_v1";

function ProcessingScreen({
  user,
  onDoneRef,
  rehydrated = false,
}: {
  user:        UserProfile;
  onDoneRef:   React.MutableRefObject<(u: UserProfile) => void>;
  rehydrated?: boolean;
}) {
  const C = useC();
  const [phase, setPhase]           = useState<number>(rehydrated ? 1 : 0);
  const [rejected, setRejected]     = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const approvedUserRef             = useRef<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    const beginPolling = () => {
      const stop = pollUserStatus(user.id, 4000, (status, freshUser) => {
        if (cancelled) return;
        if (status === "rejected") {
          try { localStorage.removeItem(PENDING_KEY); } catch {}
          setRejected(true);
          setPhase(-1);
          return;
        }
        try { localStorage.removeItem(PENDING_KEY); } catch {}
        approvedUserRef.current = freshUser;
        setPhase(2); // triggers biometric enrollment sheet before landing
      });
      return stop;
    };

    let stopPolling: (() => void) | null = null;

    if (rehydrated) {
      stopPolling = beginPolling();
    } else {
      saveUser(user).then(({ error }) => {
        if (cancelled) return;
        if (error && error !== "duplicate") {
          console.error("[Civique] saveUser error:", error);
        }
        try { localStorage.setItem(PENDING_KEY, JSON.stringify({ id: user.id })); } catch {}
        setPhase(1);
        stopPolling = beginPolling();
      });
    }

    const ticker = setInterval(() => {
      if (cancelled) return;
      setElapsed(s => s + 1);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(ticker);
      stopPolling?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable

  // When approved, show bio enrollment sheet (or land directly if bio unavailable)
  useEffect(() => {
    if (phase !== 2) return;
    // Transition to done — root component will intercept and show bio setup if needed
    setPhase(3);
    setTimeout(() => onDoneRef.current(approvedUserRef.current!), 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const allDone = phase >= 3;

  // ── Step labels ───────────────────────────────────────────
  const steps = [
    {
      label: "Enregistrement de vos informations",
      done:  phase >= 1 || phase === -1,
      active: phase === 0,
    },
    {
      label: "En attente de confirmation admin",
      done:  phase >= 2,
      active: phase === 1,
      pending: phase === 1,
    },
    {
      label: "Accès accordé",
      done:  phase >= 3,
      active: phase === 2 || phase === 3,
    },
  ];

  // ── REJECTED screen ───────────────────────────────────────
  if (rejected) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minHeight: "100%", padding: "40px 32px",
        textAlign: "center",
      }}>
        <style>{`
          @keyframes shakeX {
            0%,100% { transform: translateX(0); }
            20%,60% { transform: translateX(-6px); }
            40%,80% { transform: translateX(6px); }
          }
        `}</style>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "rgba(232,65,42,0.1)",
          border: "2px solid rgba(232,65,42,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 28,
          animation: "shakeX .5s ease both",
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <line x1="18" y1="6" x2="6" y2="18" stroke="#E8412A" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke="#E8412A" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, color: C.text, marginBottom: 10, letterSpacing: "-.4px" }}>
          Demande refusée
        </div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, maxWidth: 280, marginBottom: 32 }}>
          Votre inscription n'a pas été approuvée par l'administration. Si vous pensez qu'il s'agit d'une erreur, contactez un responsable.
        </div>
        <button
          onClick={() => { window.location.reload(); }}
          style={{
            padding: "13px 28px", borderRadius: 12,
            background: "none", border: `1.5px solid ${C.border2}`,
            color: C.text, fontSize: 14, fontWeight: 600,
            cursor: "pointer", fontFamily: "var(--f-sans)",
          }}
        >
          Retour à l'accueil
        </button>
      </div>
    );
  }

  // ── NORMAL processing / pending / approved screen ─────────
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: "100%", padding: "40px 32px",
      textAlign: "center",
    }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes checkPop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pendingPulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: .55; transform: scale(.88); }
        }
        @keyframes pendingRingPulse {
          0%,100% { stroke-dasharray: 60 180; opacity: 1; }
          50%     { stroke-dasharray: 30 210; opacity: .5; }
        }
      `}</style>

      {/* ── Animated ring ── */}
      <div style={{ position: "relative", width: 88, height: 88, marginBottom: 36 }}>
        <svg width="88" height="88" viewBox="0 0 88 88"
          style={{
            animation: allDone
              ? "none"
              : phase === 1
                ? "none"           // pending: ring pulses via CSS on the arc
                : "spin 1.6s linear infinite",
          }}
        >
          <circle cx="44" cy="44" r="38" fill="none" stroke={C.border} strokeWidth="3"/>
          <circle cx="44" cy="44" r="38" fill="none"
            stroke={allDone ? C.gold : phase === 1 ? C.gold : C.gold}
            strokeWidth="3"
            strokeDasharray={allDone ? "239 0" : phase === 1 ? "60 180" : "60 180"}
            strokeLinecap="round"
            style={{
              transition: allDone ? "stroke-dasharray 1.5s cubic-bezier(.4,0,.2,1)" : "none",
              animation: phase === 1 ? "pendingRingPulse 2s ease-in-out infinite" : "none",
            }}
          />
        </svg>

        {/* Icon inside ring */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {allDone
            ? <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                style={{ animation: "checkPop .4s cubic-bezier(.2,.8,.3,1) both" }}>
                <path d="M5 13l4 4L19 7" stroke={C.gold} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            : phase === 1
              /* hourglass / clock pulsing when pending */
              ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                  style={{ animation: "pendingPulse 2s ease-in-out infinite" }}>
                  <circle cx="12" cy="12" r="9" stroke={C.gold} strokeWidth="1.6"/>
                  <path d="M12 7v5l3 3" stroke={C.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              : <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="3" width="16" height="18" rx="2.5" fill={C.gold} opacity=".15"/>
                  <rect x="4" y="3" width="16" height="18" rx="2.5" stroke={C.gold} strokeWidth="1.5"/>
                  <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
          }
        </div>
      </div>

      {/* ── Title ── */}
      <div style={{
        fontWeight: 700, fontSize: 20, color: C.text,
        letterSpacing: "-.4px", marginBottom: 10, lineHeight: 1.3,
      }}>
        {allDone
          ? "Bienvenue dans Civique !"
          : phase === 1
            ? "Vérification en cours…"
            : "Traitement en cours…"
        }
      </div>

      {/* ── Subtitle ── */}
      <div style={{
        fontSize: 13, color: C.sub, lineHeight: 1.6,
        maxWidth: 280, marginBottom: 40,
      }}>
        {allDone
          ? "Votre compte est actif. Vous pouvez maintenant participer à la vie de votre faculté."
          : phase === 1
            ? `Votre dossier a été soumis. Un administrateur doit confirmer votre inscription.${elapsed > 10 ? `\n(${elapsed}s d'attente)` : ""}`
            : "Vos informations sont en cours d'enregistrement."
        }
      </div>

      {/* ── Step circles ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 300 }}>
        {steps.map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 12,
            animation: `fadeup .3s ease ${i * .1}s both`,
          }}>
            {/* Circle indicator */}
            <div style={{
              width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
              background: s.done ? C.gold : s.pending ? "transparent" : C.border,
              border: s.pending ? `2px solid ${C.gold}` : "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background .35s ease",
              boxShadow: s.done ? `0 0 0 4px ${C.goldBg}` : "none",
              animation: s.pending ? "pendingPulse 2s ease-in-out infinite" : "none",
            }}>
              {s.done
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    style={{ animation: "checkPop .35s cubic-bezier(.2,.8,.3,1) both" }}>
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                : s.pending
                  ? <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, animation: "pendingPulse 2s ease-in-out infinite" }}/>
                  : <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.dim }}/>
              }
            </div>

            {/* Label */}
            <span style={{
              fontSize: 13,
              fontWeight: s.done || s.pending ? 600 : 400,
              color: s.done ? C.text : s.pending ? C.gold : C.sub,
              transition: "color .35s ease",
            }}>
              {s.label}
            </span>

            {/* Pulsing "en attente" badge on the pending step */}
            {s.pending && (
              <span style={{
                marginLeft: "auto", fontSize: 10, fontFamily: "var(--f-mono, monospace)",
                color: C.gold, background: C.goldBg,
                border: `1px solid ${C.gold}44`,
                padding: "2px 7px", borderRadius: 4, letterSpacing: ".5px",
                flexShrink: 0,
                animation: "pendingPulse 2s ease-in-out infinite",
              }}>
                EN ATTENTE
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── Waiting tip (shows after 15s) ── */}
      {phase === 1 && elapsed >= 15 && (
        <div style={{
          marginTop: 32, fontSize: 11, color: C.dim,
          maxWidth: 260, lineHeight: 1.6,
          animation: "fadeup .4s ease both",
        }}>
          Vous pouvez fermer cette page. Votre compte sera activé dès qu'un administrateur confirmera votre inscription.
        </div>
      )}


    </div>
  );
}

// ─── BIOMETRIC SETUP SCREEN (standalone, shown after approval) ───
function BiometricSetupScreen({
  user,
  onDone,
}: {
  user:   UserProfile;
  onDone: (u: UserProfile) => void;
}) {
  const C = useC();
  const [step, setStep] = useState<"prompt" | "scanning" | "success">("prompt");

  const handleActivate = async () => {
    setStep("scanning");
    await registerBiometric(user.id, `${user.prenom} ${user.nom}`).catch(() => {});
    setStep("success");
    setTimeout(() => onDone(user), 1000);
  };

  const handleSkip = () => onDone(user);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: "100%", padding: "40px 32px",
      textAlign: "center",
      animation: "fadeup .3s ease both",
    }}>
      <style>{`
        @keyframes bioGlow {
          0%,100% { box-shadow: 0 0 0 10px var(--gold-bg-55), 0 0 0 24px var(--gold-bg-22); }
          50%      { box-shadow: 0 0 0 18px var(--gold-bg-55), 0 0 0 36px var(--gold-bg-22); }
        }
      `}</style>

      {step === "success" ? (
        <>
          <div style={{
            width: 100, height: 100, borderRadius: "50%",
            background: "rgba(34,197,94,.1)",
            border: "2px solid rgba(34,197,94,.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 24, animation: "checkPop .4s cubic-bezier(.2,.8,.3,1) both",
          }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontWeight: 700, fontSize: 22, color: C.text, marginBottom: 8 }}>Touch ID activé</div>
          <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.6 }}>
            À votre prochaine visite, une simple empreinte suffit.
          </div>
        </>
      ) : step === "scanning" ? (
        <>
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: C.goldBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 24, position: "relative",
          }}>
            <div style={{
              position: "absolute", inset: -10, borderRadius: "50%",
              border: `2px solid ${C.gold}`, opacity: 0.3,
              animation: "pendingPulse 1s ease-in-out infinite",
            }}/>
            <div style={{
              position: "absolute", inset: -22, borderRadius: "50%",
              border: `1.5px solid ${C.gold}`, opacity: 0.12,
              animation: "pendingPulse 1s ease-in-out .25s infinite",
            }}/>
            <FingerprintIcon size={64} color={C.gold} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 20, color: C.text, marginBottom: 8 }}>Scan en cours…</div>
          <div style={{ fontSize: 14, color: C.sub }}>Posez votre doigt ou regardez l'écran</div>
        </>
      ) : (
        <>
          {/* Wordmark */}
          <div style={{ fontSize: 12, letterSpacing: "3px", color: C.dim, fontWeight: 700, textTransform: "uppercase", marginBottom: 40 }}>
            Civique
          </div>

          {/* Fingerprint hero */}
          <div style={{
            width: 130, height: 130, borderRadius: "50%",
            background: C.goldBg,
            border: `1.5px solid ${C.gold}22`,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 28,
            boxShadow: `0 0 0 14px ${C.goldBg}88, 0 0 0 28px ${C.goldBg}33`,
          }}>
            <FingerprintIcon size={72} color={C.gold} />
          </div>

          <div style={{ fontWeight: 700, fontSize: 22, color: C.text, marginBottom: 10, letterSpacing: "-.4px" }}>
            Activer Touch ID
          </div>
          <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.65, maxWidth: 280, marginBottom: 40 }}>
            Connectez-vous en un toucher à vos prochaines visites — sans matricule ni mot de passe.
          </div>

          <div style={{ width: "100%", maxWidth: 320 }}>
            <button
              onClick={handleActivate}
              style={{
                width: "100%", padding: "16px",
                borderRadius: 16, border: "none",
                background: C.gold, color: "#fff",
                fontSize: 16, fontWeight: 700,
                fontFamily: "var(--f-sans)", cursor: "pointer",
                marginBottom: 12,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              }}
            >
              <FingerprintIcon size={20} color="#fff" />
              Activer Touch ID
            </button>

            <button
              onClick={handleSkip}
              style={{
                width: "100%", padding: "14px",
                borderRadius: 16,
                border: `1.5px solid ${C.border2}`,
                background: "none", color: C.sub,
                fontSize: 14, fontWeight: 600,
                fontFamily: "var(--f-sans)", cursor: "pointer",
              }}
            >
              Pas maintenant
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ROOT AUTH GATE ───────────────────────────────────────────

type AuthScreen = "landing" | "signin" | "step1" | "step2" | "processing" | "biometric_setup";

export default function AuthFlow({ onAuth }: { onAuth: (user: UserProfile) => void }) {
  const C = useC();
  const [screen, setScreen]         = useState<AuthScreen>("landing");
  const [step1,  setStep1]          = useState<Step1Data | null>(null);
  const [rehydratedUser, setRehydratedUser] = useState<UserProfile | null>(null);
  const [booting, setBooting]       = useState(true); // true while checking localStorage
  const pendingAuthUser             = useRef<UserProfile | null>(null); // user waiting for bio setup

  // Keep onAuth stable via ref — declared here so the mount effect can use it
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

    // On mount: check if there is a pending registration to resume, or an
  // approved session to restore.
  useEffect(() => {
    const resume = async () => {
      try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (raw) {
          const { id } = JSON.parse(raw) as { id: string };
          if (id) {
            const { user } = await getUserById(id);
            if (user) {
              if (user.status === "verified") {
                localStorage.removeItem(PENDING_KEY);
                if (!localStorage.getItem(BIO_KEY)) {
                  // Not yet enrolled — show bio setup before landing
                  pendingAuthUser.current = user;
                  setScreen("biometric_setup");
                  setBooting(false);
                } else {
                  // Already enrolled — land directly
                  setBooting(false);
                  onAuthRef.current(user);
                }
                return;
              }
              // Still pending — resume the waiting screen
              setRehydratedUser(user);
              setScreen("processing");
              setBooting(false);
              return;
            }
          }
        }
      } catch {}
      setBooting(false);
    };
    resume();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStep1 = (data: Step1Data) => {
    setStep1(data);
    setScreen("step2");
  };

  // pendingUser holds the built profile so processing screen can hand it off
  // without relying on localStorage round-trip timing.
  const pendingUserRef = useRef<UserProfile | null>(null);

  const handleStep2 = (photo: string) => {
    if (!step1) return;
    // Build + persist synchronously BEFORE switching screen so the ref is
    // always populated when ProcessingScreen calls onDone.
    const user: UserProfile = {
      id:          randomId(),
      matricule:   step1.matricule,
      nom:         step1.nom,
      prenom:      step1.prenom,
      sexe:        step1.sexe,
      faculty:     step1.faculty,
      field:       step1.field,
      year:        +step1.year,
      vacation:    step1.vacation,
      role:        step1.role,
      roleDetail:  step1.roleDetail,
      badgePhoto:  photo,   // base64 stored in DB for admin review
      status:      "pending", // admin must verify before full access
      avatarColor: randomColor(),
      badge:       (step1.role === "Rectorat" || step1.role === "Décanat")
                     ? "gray"
                     : null,
      createdAt:   new Date().toISOString(),
    };
    pendingUserRef.current = user;
    setScreen("processing");
  };

  const handleBioSetupDone = (user: UserProfile) => {
    onAuthRef.current(user);
  };

  // After sign-in: if not yet enrolled, show bio setup first
  const handleSignInSuccess = (user: UserProfile) => {
    if (!localStorage.getItem(BIO_KEY)) {
      pendingAuthUser.current = user;
      setScreen("biometric_setup");
    } else {
      onAuthRef.current(user);
    }
  };

  // After ProcessingScreen approval: route through bio setup
  const handleProcessingDone = (user: UserProfile) => {
    if (!localStorage.getItem(BIO_KEY)) {
      pendingAuthUser.current = user;
      setScreen("biometric_setup");
    } else {
      onAuthRef.current(user);
    }
  };
  // Keep as ref so ProcessingScreen's closure sees latest version
  const processingDoneRef = useRef(handleProcessingDone);
  processingDoneRef.current = handleProcessingDone;

  // While checking localStorage, show nothing (avoids flash of landing)
  if (booting) return null;

  // Determine which user to pass to ProcessingScreen
  const processingUser = rehydratedUser ?? pendingUserRef.current;

  return (
    <>
      <style>{`
        @keyframes fadeup {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sheetUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes checkPop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pendingPulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: .55; transform: scale(.88); }
        }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{
        position: "fixed", inset: 0,
        background: C.bg,
        display: "flex", flexDirection: "column",
        fontFamily: "var(--f-sans)",
        overflowY: screen === "processing" ? "hidden" : "auto",
      }}>

        {screen === "landing" && (
          <LandingScreen
            onSignIn={()   => setScreen("signin")}
            onRegister={()  => setScreen("step1")}
          />
        )}

        {screen === "signin" && (
          <SignInScreen
            onBack={()           => setScreen("landing")}
            onSuccess={handleSignInSuccess}
          />
        )}

        {screen === "step1" && (
          <Step1Screen
            onBack={()   => setScreen("landing")}
            onNext={handleStep1}
          />
        )}

        {screen === "step2" && (
          <Step2Screen
            onBack={()  => setScreen("step1")}
            onSubmit={handleStep2}
          />
        )}

        {screen === "processing" && processingUser && (
          <ProcessingScreen
            user={processingUser}
            onDoneRef={processingDoneRef}
            rehydrated={!!rehydratedUser}
          />
        )}

        {screen === "biometric_setup" && pendingAuthUser.current && (
          <BiometricSetupScreen
            user={pendingAuthUser.current}
            onDone={handleBioSetupDone}
          />
        )}
      </div>
    </>
  );
}