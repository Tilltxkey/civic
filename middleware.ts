// middleware.ts — place at the ROOT of your project (same level as app/)
// This intercepts WhatsApp/bot requests to /post/[id] and serves OG HTML
// directly, bypassing the client-side SPA entirely.
// Human users are passed through normally to the SPA.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://civicfdse.vercel.app";

// WhatsApp and common link-preview bot user agents
const BOT_UA = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot|bingbot|curl|python-requests/i;

export const config = {
  matcher: "/post/:id*",
};

export async function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";

  // Only intercept bots — let real users through to the SPA
  if (!BOT_UA.test(ua)) {
    // Redirect humans to the SPA root with post id in query string
    const id = req.nextUrl.pathname.split("/post/")[1];
    return NextResponse.redirect(new URL(`/?post=${id}`, req.url));
  }

  // ── Bot request: fetch post data and return OG HTML ──────────
  const id = req.nextUrl.pathname.split("/post/")[1];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: post } = await supabase
    .from("civique_posts")
    .select("id, author_nom, author_prenom, body, imgs")
    .eq("id", id)
    .single();

  const name   = post ? `${post.author_nom} ${post.author_prenom}`.trim() : "Civic";
  const handle = post
    ? `@${post.author_nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "")}`
    : "";
  const title  = post ? `${name} (${handle}) sur Civic` : "Civic";
  const desc   = post
    ? ((post.body ?? "").length > 200 ? post.body.slice(0, 200) + "…" : post.body ?? "")
    : "Le réseau étudiant";
  const image  = post && Array.isArray(post.imgs) && typeof post.imgs[0] === "string" && post.imgs[0].startsWith("https://")
    ? post.imgs[0]
    : `${BASE}/og-default.png`;
  const url    = `${BASE}/post/${id}`;

  // Return a minimal HTML page with only the OG tags — that's all bots need
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escHtml(title)}</title>
  <meta property="og:type"        content="article" />
  <meta property="og:url"         content="${escHtml(url)}" />
  <meta property="og:site_name"   content="Civic" />
  <meta property="og:title"       content="${escHtml(title)}" />
  <meta property="og:description" content="${escHtml(desc)}" />
  <meta property="og:image"       content="${escHtml(image)}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${escHtml(title)}" />
  <meta name="twitter:description" content="${escHtml(desc)}" />
  <meta name="twitter:image"       content="${escHtml(image)}" />
</head>
<body></body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Cache for 5 minutes — long enough for WhatsApp, short enough to stay fresh
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
