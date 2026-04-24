// app/post/[id]/page.tsx
// Server component — only bots reach this (middleware redirects humans to SPA).
// Renders a minimal HTML page with correct OG tags so WhatsApp shows a rich card.

import type { Metadata } from "next";

const BASE = "https://civicfdse.vercel.app";

async function fetchPost(id: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/civique_posts?id=eq.${encodeURIComponent(id)}&select=id,author_nom,author_prenom,body,imgs&limit=1`,
      {
        headers: {
          apikey:        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        },
        next: { revalidate: 60 },
      }
    );
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

function buildMeta(post: Record<string, unknown> | null, id: string) {
  if (!post) {
    return {
      title:  "Civic",
      desc:   "Le réseau étudiant",
      image:  `${BASE}/og-default.png`,
      url:    `${BASE}/post/${id}`,
    };
  }
  const nom    = String(post.author_nom    ?? "");
  const prenom = String(post.author_prenom ?? "");
  const name   = `${nom} ${prenom}`.trim();
  const handle = `@${nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"")}`;
  const body   = String(post.body ?? "");
  return {
    title:  `${name} (${handle}) sur Civic`,
    desc:   body.length > 200 ? body.slice(0, 200) + "…" : body,
    image:  Array.isArray(post.imgs) && typeof post.imgs[0] === "string" && (post.imgs[0] as string).startsWith("https://")
              ? (post.imgs[0] as string)
              : `${BASE}/og-default.png`,
    url:    `${BASE}/post/${id}`,
  };
}

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);
  const m    = buildMeta(post, params.id);

  return {
    metadataBase: new URL(BASE),
    title:        m.title,
    description:  m.desc,
    openGraph: {
      title:       m.title,
      description: m.desc,
      url:         m.url,
      siteName:    "Civic",
      type:        "article",
      images: [{ url: m.image, width: 1200, height: 630, alt: m.title }],
    },
    twitter: {
      card:        "summary_large_image",
      title:       m.title,
      description: m.desc,
      images:      [m.image],
    },
  };
}

// Minimal page body — bots only read <head>, this is never shown to users
export default async function PostSharePage({
  params,
}: {
  params: { id: string };
}) {
  const post = await fetchPost(params.id);
  const m    = buildMeta(post, params.id);

  // Return a plain HTML shell — bots read the <head> injected by generateMetadata
  // This also works as a fallback if JS is disabled
  return (
    <html>
      <body style={{ margin: 0, background: "#111", color: "#fff", fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Civic</div>
          <div style={{ fontSize: 16, color: "#888", marginBottom: 24 }}>{m.title}</div>
          <a href={`${BASE}/?post=${params.id}`} style={{ background: "#C47F00", color: "#fff", padding: "12px 28px", borderRadius: 999, textDecoration: "none", fontWeight: 700 }}>
            Voir le post →
          </a>
        </div>
      </body>
    </html>
  );
}