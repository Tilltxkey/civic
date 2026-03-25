/**
 * LangContext.tsx
 * ─────────────────────────────────────────────────────────────
 * Provides current language + t() translation function
 * to the entire app via React context.
 *
 * HOW TO USE:
 *  1. Wrap your app in <LangProvider> (done in layout.tsx or page.tsx)
 *  2. In any component: const { t, lang, setLang } = useLang();
 *  3. Use t("key") to get translated string.
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { T, Lang } from "./i18n";

interface LangCtx {
  lang:    Lang;
  setLang: (l: Lang) => void;
  t:       (key: string) => string;
}

const Ctx = createContext<LangCtx>({
  lang: "fr",
  setLang: () => {},
  t: (k) => k,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("fr");
  const t = (key: string) => T[lang][key] ?? T["fr"][key] ?? key;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
