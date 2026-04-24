// middleware.ts — at project root (same level as app/)
// ONLY job: detect bots on /post/* and let them through to the
// server-rendered app/post/[id]/page.tsx which has the OG tags.
// Humans get redirected to the SPA root.

import { NextRequest, NextResponse } from "next/server";

const BOT_UA = /facebookexternalhit|whatsapp|twitterbot|linkedinbot|telegrambot|discordbot|slackbot|googlebot|bingbot|Iframely|metainspector/i;

export const config = {
  matcher: "/post/:id*",
};

export function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";

  // Bot → let it reach app/post/[id]/page.tsx for OG tags
  if (BOT_UA.test(ua)) {
    return NextResponse.next();
  }

  // Human → redirect to SPA with post id so the app can open it
  const id = req.nextUrl.pathname.replace("/post/", "");
  return NextResponse.redirect(new URL(`/?post=${id}`, req.url));
}