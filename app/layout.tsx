/**
 * layout.tsx - Final Optimized version for Civic PWA
 */

import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { LangProvider }    from "./components/LangContext";
import { ThemeProvider }   from "./components/ThemeContext";
import { ProfileProvider } from "./components/ProfileContext";
import ServiceWorkerLoader from "./components/ServiceWorkerLoader"; // Optional: Move SW logic here
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

export const viewport: Viewport = {
  themeColor: "#C47F00",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Essential for "app-like" feel
  viewportFit: "cover", // Fixes notched displays (iPhone/Pixel)
};

export const metadata: Metadata = {
  metadataBase: new URL("https://civicfdse.vercel.app"),
  title: {
    default: "Civic",
    template: "%s | Civic",
  },
  description: "Plateforme numérique de suivi électoral",

  // Link to your public/manifest.json
  manifest: "/manifest.json",

  appleWebApp: {
    capable: true,
    title: "Civic",
    statusBarStyle: "black-translucent",
    startupImage: [
      {
        url: "/og-default.png",
        media: "(device-width: 430px) and (device-height: 932px)",
      },
    ],
  },

  icons: {
    icon: [
      
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-512x512.png",
  },

  openGraph: {
    title: "Civic",
    description: "Suivez les élections en temps réel",
    url: "https://civicfdse.vercel.app",
    siteName: "Civic",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "Civic Logo",
      },
    ],
    locale: "fr_FR",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Civic",
    description: "Plateforme électorale numérique",
    images: ["/og-default.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${dmMono.variable}`}>
      <head>
        {/* PWA mobile behavior meta tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <ThemeProvider>
          <ProfileProvider>
            <LangProvider>
              {/* This component handles sw.js registration */}
              <ServiceWorkerLoader />
              {/* This component is the download app modal bottom sheet */}
              <InstallPrompt /> 
              {children}
            </LangProvider>
          </ProfileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}