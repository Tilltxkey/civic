/**
 * helpers.ts
 * ─────────────────────────────────────────────────────────────
 * Shared utility functions and React hooks used across
 * multiple components.
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { useEffect, useState } from "react";

// ─── NUMBER FORMATTING ───────────────────────────────────────

/**
 * Format a number in French locale (space as thousands separator).
 * e.g. 8421 → "8 421"
 */
export const n2fr = (n: number) => n.toLocaleString("fr-FR");

/**
 * Format a percentage in French locale with 1 decimal.
 * e.g. 52.3 → "52,3 %"
 */
export const p2fr = (n: number) => n.toFixed(1).replace(".", ",") + "%";

// ─── HOOKS ───────────────────────────────────────────────────

/**
 * useWindowWidth
 * Returns the current window inner width, updates on resize.
 * Returns 0 during SSR (before the browser is available).
 * Used to switch between mobile app and desktop gate.
 */
export function useWindowWidth(): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    fn();
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return w;
}

/**
 * useClock
 * Returns a live { time, date } string pair updated every second.
 * Formatted in French locale.
 */
export function useClock(): { time: string; date: string } {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  useEffect(() => {
    const fn = () => {
      const n = new Date();
      setTime(n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDate(n.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
    };
    fn();
    const id = setInterval(fn, 1000);
    return () => clearInterval(id);
  }, []);
  return { time, date };
}
