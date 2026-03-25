/**
 * layout.tsx
 * ─────────────────────────────────────────────────────────────
 * Root layout — wraps every page.
 *
 * IMPORTANT: next/font MUST be called here (a Server Component),
 * NOT inside page.tsx (a Client Component). This is a Next.js rule.
 *
 * Fonts are injected as CSS variables:
 *   --f-sans  →  DM Sans   (used for all UI text)
 *   --f-mono  →  DM Mono   (used for numbers / percentages)
 *
 * HOW TO CHANGE FONTS:
 *  1. Import a different font from "next/font/google".
 *  2. Update the variable names if needed.
 *  3. Update references in components (they use var(--f-sans) etc.)
 * ─────────────────────────────────────────────────────────────
 */

import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { LangProvider } from "./components/LangContext";
import { ThemeProvider } from "./components/ThemeContext";
import { ProfileProvider } from "./components/ProfileContext";

// ── Load DM Sans — used for all body text ────────────────────
const sans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--f-sans",
  display: "swap",
});

// ── Load DM Mono — used for vote counts + percentages ────────
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--f-mono",
  display: "swap",
});

// ── Page metadata (shown in browser tab + SEO) ───────────────
export const metadata: Metadata = {
  title: "Civique · Élection 2026",
  description: "Résultats en direct — Université · Printemps 2026",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Font CSS variables are added to <html> so they're available everywhere
    <html lang="fr" className={`${sans.variable} ${dmMono.variable}`}>
      <body><ThemeProvider><ProfileProvider><LangProvider>{children}</LangProvider></ProfileProvider></ThemeProvider></body>
    </html>
  );
}