// app/post/[id]/page.tsx

import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

const BASE = "https://civicfdse.vercel.app";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function fetchPost(id: string) {
  const { data } = await supabase
    .from("civique_posts")
    .select("id, author_nom, author_prenom, body, imgs")
    .eq("id", id)
    .single();
  return data;
}

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);

  if (!post) {
    return {
      metadataBase: new URL(BASE),
      title: "Civic",
      description: "Le réseau étudiant",
      openGraph: {
        title: "Civic", description: "Le réseau étudiant",
        url: BASE, siteName: "Civic",
        images: [{ url: `${BASE}/og-default.png`, width: 1200, height: 630 }],
        type: "website",
      },
    };
  }

  const name   = `${post.author_nom} ${post.author_prenom}`.trim();
  const handle = `@${post.author_nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"")}`;
  const title  = `${name} (${handle}) sur Civic`;
  const desc   = (post.body ?? "").length > 200 ? post.body.slice(0, 200) + "…" : (post.body ?? "");
  // og:image MUST be an absolute https:// URL — relative paths are ignored by WhatsApp
  const image  = Array.isArray(post.imgs) && typeof post.imgs[0] === "string" && post.imgs[0].startsWith("https://")
    ? post.imgs[0]
    : `${BASE}/og-default.png`;
  const url    = `${BASE}/post/${post.id}`;

  return {
    // metadataBase here ensures any remaining relative URLs are resolved correctly
    metadataBase: new URL(BASE),
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url,
      siteName: "Civic",
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: desc,
      images: [image],
    },
  };
}

export default async function PostSharePage({ params }: { params: { id: string } }) {
  redirect(`/?post=${params.id}`);
}