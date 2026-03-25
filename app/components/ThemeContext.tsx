"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeCtx {
  theme:    Theme;
  setTheme: (t: Theme) => void;
  isDark:   boolean;
}

const Ctx = createContext<ThemeCtx>({ theme: "light", setTheme: () => {}, isDark: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
  }, [theme]);

  return (
    <Ctx.Provider value={{ theme, setTheme, isDark: theme === "dark" }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
