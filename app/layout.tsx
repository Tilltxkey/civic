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

const sans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--f-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--f-mono",
  display: "swap",
});

// ── Metadata Configuration ────────────────────────────────────
export const metadata: Metadata = {
  // REQUIRED: This turns "/og-default.png" into "https://civicfdse.vercel.app/og-default.png"
  metadataBase: new URL("https://civicfdse.vercel.app"),
  title: "Civic",
  description: "nah",
  
  openGraph: {
    title: "Civic",
    description: "fellow",
    url: "https://civicfdse.vercel.app",
    siteName: "Civic",
    images: [
      {
        url: "/og-default.png", // Located in your /public folder
        width: 1200,
        height: 630,
        alt: "Civique Logo",
      },
    ],
    locale: "fr_FR",
    type: "website",
  },
  
  twitter: {
    card: "summary_large_image",
    title: "Civics",
    description: "twiitwer",
    images: ["/og-default.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${dmMono.variable}`}>
      <body>
        <ThemeProvider>
          <ProfileProvider>
            <LangProvider>
              {children}
            </LangProvider>
          </ProfileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}