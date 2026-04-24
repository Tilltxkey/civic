// app/post/[id]/page.tsx
// Drop this file at exactly this path in your Next.js project.
// The folder is literally named [id] with square brackets — Next.js requires this.
//
// FOLDER STRUCTURE IN YOUR PROJECT:
//   your-project/
//   └── app/
//       └── post/
//           └── [id]/          ← folder named with square brackets
//               └── page.tsx   ← this file

import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ── Load post from Supabase ───────────────────────────────────
async function fetchPost(id: string) {
  const { data } = await supabase
    .from("civique_posts")
    .select("id, author_nom, author_prenom, body, imgs, created_at")
    .eq("id", id)
    .single();
  return data;
}

// ── OG metadata — WhatsApp reads this to build the preview card ──
export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);

  if (!post) {
    return {
      title: "Civic",
      openGraph: {
        title:       "Civic",
        description: "Le réseau étudiant",
        url:         "https://https://civicfdse.vercel.app",
        images:      [{ url: "https://https://civicfdse.vercel.app/og-default.png", width: 1200, height: 630 }],
      },
    };
  }

  const name  = `${post.author_nom} ${post.author_prenom}`.trim();
  const title = `${name} sur Civic`;
  const desc  = post.body?.length > 200 ? post.body.slice(0, 200) + "…" : post.body;
  const image = Array.isArray(post.imgs) && post.imgs[0]?.startsWith("https://")
    ? post.imgs[0]
    : "https://https://civicfdse.vercel.app/og-default.png";
  const url   = `https://https://civicfdse.vercel.app/post/${post.id}`;

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url,
      siteName: "Civic",
      type:     "article",
      images:   [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card:        "summary_large_image",
      title,
      description: desc,
      images:      [image],
    },
  };
}

// ── Page: redirect users who tap the link back to the app ────
export default async function PostSharePage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/?post=${params.id}`);
}