// app/post/[id]/page.tsx
// Server component — only bots reach this (proxy redirects humans to SPA).
// Renders OG tags so WhatsApp shows: [avatar] | Name (@handle) sur Civic | post body

import type { Metadata } from "next";

const BASE = "https://civicfdse.vercel.app";

interface PostRow {
  id:             string;
  author_id:      string;
  author_nom:     string;
  author_prenom:  string;
  author_handle:  string;   // ← added: stored directly in civique_posts
  body:           string;
  imgs:           string[];
}

interface UserRow {
  profile_photo: string | null;
  avatar_color:  string | null;
}

async function fetchPost(id: string): Promise<PostRow | null> {
  try {
    const res = await fetch(
      // ↓ added author_handle to the select list
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

async function fetchAuthorProfile(authorId: string): Promise<UserRow | null> {
  if (!authorId) return null;
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/civique_users?id=eq.${encodeURIComponent(authorId)}&select=profile_photo,avatar_color&limit=1`,
      {
        headers: {
          apikey:        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        },
        next: { revalidate: 300 },
      }
    );
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

function initialsAvatarUrl(nom: string, prenom: string, color: string): string {
  const initials = encodeURIComponent(`${nom[0] ?? ""}${prenom[0] ?? ""}`.toUpperCase());
  const bg       = encodeURIComponent((color ?? "#C47F00").replace("#", ""));
  return `https://ui-avatars.com/api/?name=${initials}&background=${bg}&color=fff&size=400&bold=true`;
}

async function buildMeta(post: PostRow | null, id: string) {
  if (!post) {
    return {
      title: "Civic",
      desc:  "Le shampus étudiant",
      image: `${BASE}/og-default.png`,
      url:   `${BASE}/post/${id}`,
    };
  }

  const nom    = post.author_nom    ?? "";
  const prenom = post.author_prenom ?? "";
  const name   = `${nom} ${prenom}`.trim();

  // Use the handle stored in the post row — this is the exact same value
  // that CommunityTab wrote when the post was created, so it always matches.
  // Normalise: ensure it starts with @ and has no leading/trailing spaces.
  const rawHandle = (post.author_handle ?? "").trim();
  const handle    = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const body = post.body ?? "";

  const authorProfile = await fetchAuthorProfile(post.author_id);
  const profilePhoto  = authorProfile?.profile_photo;

  // base64 data URLs (data:image/...) can't be used as og:image —
  // WhatsApp needs a real https:// URL it can fetch over the network.
  // Fall back to the initials avatar (ui-avatars.com) in that case.
  const isUsableUrl = (
    profilePhoto != null &&
    profilePhoto.startsWith("http") &&
    !profilePhoto.startsWith("data:")
  );
  const image = isUsableUrl
    ? profilePhoto!
    : initialsAvatarUrl(nom, prenom, authorProfile?.avatar_color ?? "#C47F00");

  return {
    title: `${name} (${handle}) sur Civic`,
    desc:  body.length > 200 ? body.slice(0, 200) + "…" : body,
    image,
    url:   `${BASE}/post/${id}`,
  };
}

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const post = await fetchPost(params.id);
  const m    = await buildMeta(post, params.id);

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
      images: [{ url: m.image, width: 400, height: 400, alt: m.title }],
    },
    twitter: {
      card:        "summary",
      title:       m.title,
      description: m.desc,
      images:      [m.image],
    },
  };
}

export default async function PostSharePage({
  params,
}: {
  params: { id: string };
}) {
  const post = await fetchPost(params.id);
  const m    = await buildMeta(post, params.id);

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