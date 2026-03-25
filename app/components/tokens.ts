/**
 * tokens.ts
 * Design tokens — light and dark palettes.
 * Use useC() in components to get the current theme colors.
 * Use C directly only in non-component contexts (e.g. outside React).
 */

"use client";

import { useTheme } from "./ThemeContext";

// ─── LIGHT PALETTE ───────────────────────────────────────────
export const LIGHT = {
  bg:      "#F4F3F0",
  surface: "#FFFFFF",
  card:    "#F9F8F6",
  none:    "#E8E6E1",
  border:  "#E2E0DA",
  border2: "#CBC9C2",
  text:    "#111110",
  sub:     "#6B6A64",
  dim:     "#B8B6AF",
  red:     "#C8250E",
  redBg:   "#FDF1EF",
  blue:    "#1358D0",
  blueBg:  "#EEF3FD",
  gold:    "#C47F00",
  goldBg:  "#FDF6E3",
  green:   "#0b971e",
} as const;

// ─── DARK PALETTE ────────────────────────────────────────────
export const DARK = {
  bg:      "#0F0F10",
  surface: "#1A1A1C",
  card:    "#222226",
  none:    "#2A2A2E",
  border:  "#2E2E32",
  border2: "#3E3E44",
  text:    "#F0EFEC",
  sub:     "#8E8D87",
  dim:     "#4A4A50",
  red:     "#E8412A",
  redBg:   "#2A1210",
  blue:    "#4A80F0",
  blueBg:  "#0E1E3A",
  gold:    "#D4920A",
  goldBg:  "#2A1E00",
  green:   "#1DB33A",
} as const;

export type ColorMap = typeof LIGHT;

// C = light palette as the static default (for non-hook usage like shared styles)
export const C = LIGHT;

// ─── HOOK — use inside components ────────────────────────────
export function useC(): ColorMap {
  const { isDark } = useTheme();
  return isDark ? DARK : LIGHT;
}

export const BREAK = 768;