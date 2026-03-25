/**
 * Ticker.tsx
 * ─────────────────────────────────────────────────────────────
 * Scrolling news ribbon — fixed to the bottom of the viewport.
 * A 30px spacer must be rendered in the page flow to prevent
 * content from being hidden behind it (handled in page.tsx).
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { C } from "./tokens";
import { NEWS } from "./data";

interface TickerProps {
  tag: string;
}

export default function Ticker({ tag }: TickerProps) {
  return (
    <div style={{
      height: 30,
      background: "transparent",
      borderTop: `1px solid ${C.border}`,
      display: "flex",
      alignItems: "center",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {/* Red label badge */}
      <div style={{
        background: C.red,
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "2px",
        padding: "0 12px",
        height: "100%",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        textTransform: "uppercase",
      }}>
        {tag}
      </div>

      {/* Scrolling text — items duplicated so the loop is seamless */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{
          display: "inline-flex",
          whiteSpace: "nowrap",
          animation: "scroll 52s linear infinite",
        }}>
          {[...NEWS, ...NEWS].map((item, i) => (
            <span key={i} style={{ fontSize: 11, color: C.sub, padding: "0 36px" }}>
              {item.tag && (
                <span style={{ color: C.text, fontWeight: 600, marginRight: 7 }}>
                  {item.tag}
                </span>
              )}
              {item.msg}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}