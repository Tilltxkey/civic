// app/post/[id]/page.tsx
import type { Metadata } from "next";

const BASE = "https://civicfdse.vercel.app";

interface PostRow {
  id:             string;
  author_id:      string;
  author_nom:     string;
  author_prenom:  string;
  author_handle:  string;
  body:           string;
  imgs:           string[];
}

async function fetchPost(id: string): Promise<PostRow | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/civique_posts?id=eq.${encodeURIComponent(id)}&select=id,author_id,author_nom,author_prenom,author_handle,body,imgs&limit=1`,
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

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);

  const nom       = post?.author_nom    ?? "";
  const prenom    = post?.author_prenom ?? "";
  const name      = `${nom} ${prenom}`.trim();
  const rawHandle = (post?.author_handle ?? "").trim();
  const handle    = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  const body      = post?.body ?? "";

  const title = post ? `${name} (${handle}) sur Civic` : "Civic";
  const desc  = post
    ? (body.length > 200 ? body.slice(0, 200) + "…" : body)
    : "Le trammmmmpus étudiant";

  // Dynamic OG image — composed server-side with avatar, name, handle, body
  const ogImage = `${BASE}/post/${params.id}/opengraph-image`;

  return {
    metadataBase: new URL(BASE),
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url:         `${BASE}/post/${params.id}`,
      siteName:    "Civic",
      type:        "article",
      images: [{ url: ogImage, width: 600, height: 314, alt: title }],
    },
    twitter: {
      card:        "summary_large_image",
      title,
      description: desc,
      images:      [ogImage],
    },
  };
}

export default async function PostSharePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <html>
      <body style={{ margin: 0, background: "#111", color: "#fff", fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Civic</div>
          <a href={`${BASE}/?post=${params.id}`} style={{ background: "#C47F00", color: "#fff", padding: "12px 28px", borderRadius: 999, textDecoration: "none", fontWeight: 700 }}>
            Voir le post →
          </a>
        </div>
      </body>
    </html>
  );
}