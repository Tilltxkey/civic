// components/InstallPrompt.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useC } from "./tokens";

const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "civique_install_last_shown_epoch";

// Capture beforeinstallprompt at module level — fires before React hydrates
let _capturedPrompt: any = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _capturedPrompt = e;
  }, { once: true });
}

export default function InstallPrompt() {
  const C = useC();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(() => _capturedPrompt);
  const [showModal, setShowModal]   = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  
  // FIX: Initialized with null and included proper typing for NodeJS.Timeout
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Detect Environment and Installation Status
  useEffect(() => {
    // Detect iOS
    const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isApple);

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      ("standalone" in navigator && (navigator as any).standalone === true);

    if (standalone) {
      setIsInstalled(true);
      return;
    }

    // Check cooldown
    const lastShown = parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
    const cooldownPassed = lastShown === 0 || Date.now() - lastShown > PROMPT_COOLDOWN_MS;
    if (!cooldownPassed) return;

    // Show after short delay
    timerRef.current = setTimeout(() => setShowModal(true), 1200);
    
    return () => { 
      if (timerRef.current) clearTimeout(timerRef.current); 
    };
  }, []);

  // 2. Catch beforeinstallprompt if it fires after mount (Android/Chrome)
  useEffect(() => {
    if (_capturedPrompt) {
      setDeferredPrompt(_capturedPrompt);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      _capturedPrompt = e;
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // 3. Track app being installed
  useEffect(() => {
    const onInstalled = () => { setIsInstalled(true); setShowModal(false); };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  const handleInstall = useCallback(async () => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());

    if (!deferredPrompt) {
      setShowModal(false);
      return;
    }

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setIsInstalled(true);
    } catch (err) {
      console.error("Installation failed:", err);
    } finally {
      _capturedPrompt = null;
      setDeferredPrompt(null);
      setInstalling(false);
      setShowModal(false);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setShowModal(false);
  }, []);

  if (isInstalled || !showModal) return null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={handleDismiss}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          zIndex: 99998,
          animation: "ip-fade .2s ease-out both",
        }}
      />

      {/* Bottom sheet */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 99999,
          background: C.surface,
          borderRadius: "28px 28px 0 0",
          padding: "8px 24px 40px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.3)",
          animation: "ip-slide .35s cubic-bezier(0.2, 0.8, 0.3, 1) both",
          fontFamily: "var(--f-sans)",
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 99,
          background: C.border2, margin: "12px auto 24px",
        }} />

        {/* Icon + text row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <img
            src="/icon-512x512.png"
            alt="Civic"
            style={{ width: 60, height: 60, borderRadius: 16, flexShrink: 0, display: "block" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, letterSpacing: "-0.2px", marginBottom: 3 }}>
              Installer Civic
            </div>
            <div style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.45 }}>
              Accès rapide aux élections et notifications depuis votre écran d'accueil.
            </div>
          </div>
        </div>

        {/* Adaptive Content: iOS Instructions vs. Android Button */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {isIOS ? (
            <div style={{ 
              background: C.border, 
              padding: "16px", 
              borderRadius: "16px", 
              fontSize: "14px", 
              color: C.text,
              lineHeight: 1.55,
              border: `1px dashed ${C.border2}`
            }}>
              Pour installer : appuyez sur le bouton 
              <span style={{ display: 'inline-flex', padding: '0 4px', verticalAlign: 'middle' }}>
                <svg width="20" height="20" viewBox="0 0 50 50" fill={C.gold}><path d="M30.3,13.1L25,18.4l-5.3-5.3l-1.4,1.4l6.7,6.7l6.7-6.7L30.3,13.1z M24,30h2V15h-2V30z M40,24h-2v14H12V24h-2v16h30V24z"/></svg>
              </span>
              puis sur <strong>"Sur l'écran d'accueil"</strong>.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleDismiss}
                style={{
                  flex: "0 0 auto", padding: "13px 18px", borderRadius: 14,
                  border: `1.5px solid ${C.border2}`, background: "transparent",
                  color: C.sub, fontSize: 14, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--f-sans)", WebkitTapHighlightColor: "transparent",
                }}
              >
                Plus tard
              </button>
              <button
                onClick={handleInstall}
                disabled={installing}
                style={{
                  flex: 1, padding: "13px 8px", borderRadius: 14, border: "none",
                  background: installing ? C.border : C.gold,
                  color: "#fff",
                  fontSize: 15, fontWeight: 700,
                  cursor: installing ? "default" : "pointer",
                  fontFamily: "var(--f-sans)",
                  boxShadow: installing ? "none" : "0 4px 16px rgba(196,127,0,0.35)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {installing ? "Installation…" : "Installer l'application"}
              </button>
            </div>
          )}

          {isIOS && (
            <button
              onClick={handleDismiss}
              style={{
                width: "100%", padding: "13px", borderRadius: 14, border: "none",
                background: C.gold, color: "#fff", fontSize: 15, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              J'ai compris
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes ip-fade  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ip-slide { from { transform: translateY(100%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </>
  );
}