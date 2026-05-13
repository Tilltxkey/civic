/**
 * layout.tsx 
 * ─────────────────────────────────────────────────────────────
 * RESTORED TO ORIGINAL + NOTCH FIX
 * ─────────────────────────────────────────────────────────────
 */

import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { LangProvider } from "./components/LangContext";
import { ThemeProvider } from "./components/ThemeContext";
import { ProfileProvider } from "./components/ProfileContext";

// [PWA COMPONENTS]
import ServiceWorkerLoader from "./components/ServiceWorkerLoader";
import InstallPrompt from "./components/InstallPrompt";

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

// Inside layout.tsx

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // THIS IS THE KEY: It removes the bottom line by covering the whole screen
  viewportFit: "cover", 
};

export const metadata: Metadata = {
  metadataBase: new URL("https://civicfdse.vercel.app"),
  title: "Civic",
  description: "nah",
  manifest: "/manifest.json",
  
  appleWebApp: {
    capable: true,
    title: "Civic",
    // 'black-translucent' makes the app content go UNDER the clock/battery
    statusBarStyle: "black-translucent", 
  },

  openGraph: {
    title: "Civic",
    description: "fellow",
    url: "https://civicfdse.vercel.app",
    siteName: "Civic",
    images: [{ url: "/og-default.png", width: 1200, height: 630 }],
    locale: "fr_FR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${dmMono.variable}`}>
      <head>
        {/* Force high quality icon [IMAGE ICON: /icon-512x512.png] */}
        <link rel="icon" href="/icon-512x512.png" sizes="any" />
        <link rel="apple-touch-icon" href="/icon-512x512.png" />
      </head>
      <body>
        <ThemeProvider>
          <ProfileProvider>
            <LangProvider>
              <ServiceWorkerLoader />
              <InstallPrompt />
              {children}
            </LangProvider>
          </ProfileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}