/**
 * layout.tsx - Fixed for White Background & Icon Scaling
 */

import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { LangProvider }    from "./components/LangContext";
import { ThemeProvider }   from "./components/ThemeContext";
import { ProfileProvider } from "./components/ProfileContext";
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

export const viewport: Viewport = {
  /* FIX 1: Changing this to #ffffff removes the black/gold bar 
     at the very top of the screen on the splash page.
  */
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://civicfdse.vercel.app"),
  title: "Civic",
  description: "Plateforme numérique",

  manifest: "/manifest.json",

  appleWebApp: {
    capable: true,
    title: "Civic",
    /* FIX 2: 'default' uses the white background 
       instead of forcing the black translucent look.
    */
    statusBarStyle: "default", 
  },

  icons: {
    /* [APP ICON: This is the one you see on your home screen] */
    icon: "/icon-512x512.png", 
    /* [APPLE ICON: This is the one seen on iPhones/iPads] */
    apple: "/icon-512x512.png",
  },

  openGraph: {
    title: "Civic",
    description: "Election Tracking",
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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
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