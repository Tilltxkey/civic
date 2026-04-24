// app/post/[id]/page.tsx
// Place at: your-project/app/post/[id]/page.tsx

import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function fetchPost(id: string) {
  const { data } = await supabase
    .from("civique_posts")
    .select("id, author_nom, author_prenom, author_tag, body, imgs, created_at")
    .eq("id", id)
    .single();
  return data;
}

// ── THIS is what WhatsApp reads to build the preview card ──────────────────
// Must export from the page file directly — layout.tsx metadata does NOT
// override page-level generateMetadata, but only if this export is present.
export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);

  const BASE_URL = "https://civicfdse.vercel.app";

  if (!post) {
    return {
      title: "Civic",
      description: "Le réseau étudiant",
      openGraph: {
        title:       "Civic",
        description: "Le réseau étudiant",
        url:         BASE_URL,
        siteName:    "Civic",
        images: [{ url: `${BASE_URL}/og-default.png`, width: 1200, height: 630 }],
        type: "website",
      },
    };
  }

  // ── Build the card content ─────────────────────────────────────────────
  // og:title  → shown as the bold header  e.g. "nueve n (@nueve) sur Civic"
  // og:description → the post body snippet
  // og:image  → author avatar if stored as https://, else app banner
  // These three map directly to what WhatsApp renders inside the dark card.

  const authorName = `${post.author_nom} ${post.author_prenom}`.trim();

  // Build @handle from author_tag (e.g. "eco.3 · del." → strip, use nom)
  const handle = `@${post.author_nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "")}`;

  const ogTitle = `${authorName} (${handle}) sur Civic`;
  const ogDesc  = post.body?.length > 200
    ? post.body.slice(0, 200) + "…"
    : (post.body ?? "");

  // Use post image if it's a real hosted URL, else fall back to app banner
  const ogImage = Array.isArray(post.imgs) && typeof post.imgs[0] === "string" && post.imgs[0].startsWith("https://")
    ? post.imgs[0]
    : `${BASE_URL}/og-default.png`;

  const postUrl = `${BASE_URL}/post/${post.id}`;

  return {
    // page <title> — also shown in some share contexts
    title:       ogTitle,
    description: ogDesc,
    // Prevent layout.tsx from merging its own og tags on top of ours
    openGraph: {
      title:       ogTitle,
      description: ogDesc,
      url:         postUrl,
      siteName:    "Civic",
      type:        "article",
      images: [{
        url:    ogImage,
        width:  1200,
        height: 630,
        alt:    ogTitle,
      }],
    },
    twitter: {
      card:        "summary_large_image",
      title:       ogTitle,
      description: ogDesc,
      images:      [ogImage],
    },
  };
}

// ── Page component: redirect users to the app ─────────────────────────────
// WhatsApp only ever fetches the <head> — real users who tap the link are
// sent back to the main app with the post ID so it can open that post.
export default async function PostSharePage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/?post=${params.id}`);
}