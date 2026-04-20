/**
 * tokens.ts
 * Design tokens — light and dark palettes.
 * Use useC() in components to get the current theme colors.
 * Use C directly only in non-component contexts (e.g. outside React).
 */

"use client";

import { useTheme } from "./ThemeContext";

// ─── SHARED INTERFACE ─────────────────────────────────────────
// Declaring ColorMap as an explicit interface (not derived from
// one palette via typeof) lets both LIGHT and DARK satisfy it
// without TypeScript complaining about literal type mismatches.
export interface ColorMap {
  bg:      string;
  surface: string;
  card:    string;
  none:    string;
  border:  string;
  border2: string;
  text:    string;
  sub:     string;
  dim:     string;
  red:     string;
  redBg:   string;
  blue:    string;
  blueBg:  string;
  gold:    string;
  goldBg:  string;
  green:   string;
}

// ─── LIGHT PALETTE ───────────────────────────────────────────
export const LIGHT: ColorMap = {
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
};

// ─── DARK PALETTE ─────────────────────────────────────────────
export const DARK: ColorMap = {
  bg:      "#0c0c0c",
  surface: "#141414",
  card:    "#2b2b2e",
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
};

// C = light palette as the static default (for non-hook usage like shared styles)
export const C: ColorMap = LIGHT;

// ─── HOOK — use inside components ────────────────────────────
export function useC(): ColorMap {
  const { isDark } = useTheme();
  return isDark ? DARK : LIGHT;
}

export const BREAK = 768;