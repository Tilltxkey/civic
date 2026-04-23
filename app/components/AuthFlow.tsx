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
import { saveUser, checkDuplicate, signInUser, pollUserStatus } from "./db";

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
  status:       "pending" | "verified";
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
  "Délégué·e de classe",
  "Président·e d'association",
  "Membre CEP",
  "CEP — Responsable désigné·e",
  "Rectorat",
] as const;

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

function SignInScreen({
  onBack, onSuccess,
}: {
  onBack:    () => void;
  onSuccess: (user: UserProfile) => void;
}) {
  const C = useC();
  const [matricule, setMatricule] = useState("");
  const [nom, setNom]             = useState("");
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);

  const handleSubmit = () => {
    if (!matricule.trim() || !nom.trim()) {
      setErr("Veuillez remplir tous les champs.");
      return;
    }
    setErr("");
    setLoading(true);
    signInUser(matricule, nom).then(({ user, error }) => {
      setLoading(false);
      if (user) { onSuccess(user); return; }
      if (error === "no_db") {
        // Debug: log what's actually set
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
    if (!d.matricule.trim() && d.role !== "Rectorat") e.matricule = true;
    if (!d.nom.trim())       e.nom       = true;
    if (!d.prenom.trim())    e.prenom    = true;
    if (!d.faculty)          e.faculty   = true;
    if (!d.field)            e.field     = true;
    if (!d.year || +d.year < 1 || +d.year > 7) e.year = true;
    if (!d.vacation)         e.vacation  = true;
    if (!d.role)             e.role      = true;
    if (d.role === "Rectorat" && !d.roleDetail.trim()) e.roleDetail = true;
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

        {/* Row 2: Sexe (full width, before faculty) */}
        <FieldWrap>
          <Label>Sexe *</Label>
          <StyledSelect value={d.sexe} onChange={v => set("sexe", v)} error={errors.sexe}>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </StyledSelect>
        </FieldWrap>

        {/* Row 3: Faculté + Filière */}
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
            </StyledSelect>
          </div>
        </div>

        {/* ── Role ── */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: C.dim, textTransform: "uppercase", marginBottom: 14, marginTop: 6 }}>
          Rôle dans l'institution
        </div>

        <FieldWrap>
          <Label>Statut *</Label>
          <StyledSelect value={d.role} onChange={v => set("role", v)} error={errors.role}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </StyledSelect>
        </FieldWrap>

        {/* Rectorat free-text */}
        {d.role === "Rectorat" && (
          <FieldWrap style={{ animation: "fadeup .2s ease both" }}>
            <Label>Précisez votre fonction *</Label>
            <StyledInput
              value={d.roleDetail}
              onChange={e => set("roleDetail", e.target.value)}
              placeholder="ex : Vice-doyen économique, Resp. communication…"
              error={errors.roleDetail}
            />
          </FieldWrap>
        )}

        {/* Matricule — shown for all non-Rectorat roles */}
        {d.role !== "Rectorat" && (
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
          if (d.role !== "Rectorat" && d.matricule.trim()) {
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

        {/* Explanation card */}
        <div style={{
          background: C.goldBg,
          border: `1px solid ${C.gold}33`,
          borderRadius: 14,
          padding: "16px 16px",
          marginBottom: 24,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.gold, marginBottom: 8 }}>
            📋  Pourquoi cette étape ?
          </div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            Votre compte est vérifié par l'administration avant activation.
            Cette pièce confirme que vous êtes bien membre de l'institution.
          </div>
        </div>

        {/* Document types accepted */}
        <div style={{ marginBottom: 20 }}>
          <Label>Documents acceptés</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["🪪", "Badge étudiant officiel"],
              ["📄", "Fiche d'immatriculation"],
              ["🎓", "Carte universitaire"],
              ["📑", "Tout document officiel FDSE"],
            ].map(([icon, label]) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 13, color: C.text,
              }}>
                <span style={{ fontSize: 18 }}>{icon}</span>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: "14px 14px", marginBottom: 24,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 10, letterSpacing: ".5px" }}>
            CONSEILS POUR UNE BONNE PHOTO
          </div>
          {[
            "📸  Bonne luminosité — évitez les reflets",
            "🔍  Document entier visible dans le cadre",
            "✋  Tenez le document bien à plat",
            "🚫  Pas de texte ou d'infos masqués",
          ].map(tip => (
            <div key={tip} style={{ fontSize: 13, color: C.sub, marginBottom: 6, lineHeight: 1.45 }}>
              {tip}
            </div>
          ))}
        </div>

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

function ProcessingScreen({ user, onDoneRef }: { user: UserProfile; onDoneRef: React.MutableRefObject<(u: UserProfile) => void> }) {
  const C = useC();
  // phase 0 → saving, 1 → saved (pulse pending), 2 → approved, 3 → done
  // phase -1 → rejected
  const [phase, setPhase]       = useState<number>(0);
  const [rejected, setRejected] = useState(false);
  const [elapsed, setElapsed]   = useState(0); // seconds waiting

  useEffect(() => {
    let cancelled = false;

    // ── Step 1: save to DB ───────────────────────────────────
    saveUser(user).then(({ error }) => {
      if (cancelled) return;
      if (error && error !== "duplicate") {
        console.error("[Civique] saveUser error:", error);
      }
      setPhase(1); // show "En attente de confirmation"
    });

    // ── Step 2: poll DB every 4s for status change ───────────
    let stopPolling: (() => void) | null = null;

    const startPolling = () => {
      stopPolling = pollUserStatus(user.id, 4000, (status, freshUser) => {
        if (cancelled) return;
        if (status === "rejected") {
          setRejected(true);
          setPhase(-1);
          return;
        }
        // verified or any other non-pending value → let user in
        setPhase(2);
        setTimeout(() => {
          if (!cancelled) {
            setPhase(3);
            setTimeout(() => { if (!cancelled) onDoneRef.current(freshUser); }, 1200);
          }
        }, 1600);
      });
    };

    // Start polling after we know the save has had time to complete
    const pollTimer = setTimeout(startPolling, 800);

    // ── Elapsed counter (shows how long they've been waiting) ─
    const ticker = setInterval(() => {
      if (cancelled) return;
      setElapsed(s => s + 1);
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearInterval(ticker);
      stopPolling?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable

  const allDone = phase >= 2;

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
      active: phase === 2,
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

// ─── ROOT AUTH GATE ───────────────────────────────────────────

type AuthScreen = "landing" | "signin" | "step1" | "step2" | "processing";

export default function AuthFlow({ onAuth }: { onAuth: (user: UserProfile) => void }) {
  const C = useC();
  const [screen, setScreen]   = useState<AuthScreen>("landing");
  const [step1,  setStep1]    = useState<Step1Data | null>(null);

  // No persistent session — fresh login required each visit.

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
      badge:       step1.role === "Membre CEP" || step1.role === "CEP — Responsable désigné·e"
                     ? "gold"
                     : step1.role === "Délégué·e de classe"
                     ? "blue"
                     : step1.role === "Rectorat"
                     ? "gray"
                     : null,
      createdAt:   new Date().toISOString(),
    };
    pendingUserRef.current = user;
    setScreen("processing");
  };

  // Keep onAuth stable via ref so ProcessingScreen callback never stales
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth; // sync every render, no useEffect needed

  const handleSignInSuccess = (user: UserProfile) => {
    onAuthRef.current(user);
  };

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

        {screen === "processing" && pendingUserRef.current && (
          <ProcessingScreen
            user={pendingUserRef.current}
            onDoneRef={onAuthRef}
          />
        )}
      </div>
    </>
  );
}