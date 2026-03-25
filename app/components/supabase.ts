/**
 * supabase.ts
 * ─────────────────────────────────────────────────────────────
 * Supabase client singleton.
 *
 * SETUP:
 *  1. Create a free project at https://supabase.com
 *  2. Go to Project Settings → API
 *  3. Copy your Project URL and anon key into .env.local:
 *
 *     NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
 *
 *  4. Run this SQL in Supabase SQL Editor to create the users table:
 *
 *     CREATE TABLE civique_users (
 *       id            text PRIMARY KEY,
 *       created_at    timestamptz DEFAULT now(),
 *       matricule     text UNIQUE,
 *       nom           text NOT NULL,
 *       prenom        text NOT NULL,
 *       sexe          text NOT NULL,
 *       faculty       text NOT NULL,
 *       field         text NOT NULL,
 *       year          int  NOT NULL,
 *       vacation      text NOT NULL,
 *       role          text NOT NULL DEFAULT 'Étudiant·e',
 *       role_detail   text,
 *       badge_photo   text,
 *       status        text DEFAULT 'verified',
 *       avatar_color  text,
 *       badge         text,
 *       created_at_iso text
 *     );
 *
 *     -- Allow public reads/writes (for demo — tighten with RLS in prod)
 *     ALTER TABLE civique_users ENABLE ROW LEVEL SECURITY;
 *     CREATE POLICY "public_all" ON civique_users FOR ALL USING (true) WITH CHECK (true);
 *
 *  5. Also run this SQL for posts + comments:
 *
 *     CREATE TABLE civique_posts (
 *       id            text PRIMARY KEY,
 *       created_at    timestamptz DEFAULT now(),
 *       author_id     text REFERENCES civique_users(id),
 *       author_nom    text, author_prenom text,
 *       author_tag    text, author_color text, author_badge text,
 *       body          text NOT NULL DEFAULT '',
 *       imgs          text[] DEFAULT '{}',
 *       time_label    text,
 *       likes         int DEFAULT 0,
 *       reposts       int DEFAULT 0,
 *       views         int DEFAULT 0
 *     );
 *
 *     CREATE TABLE civique_comments (
 *       id            text PRIMARY KEY,
 *       created_at    timestamptz DEFAULT now(),
 *       post_id       text REFERENCES civique_posts(id) ON DELETE CASCADE,
 *       author_id     text REFERENCES civique_users(id),
 *       author_nom    text, author_prenom text,
 *       author_tag    text, author_color text, author_badge text,
 *       body          text NOT NULL DEFAULT '',
 *       imgs          text[] DEFAULT '{}',
 *       time_label    text
 *     );
 *
 *     ALTER TABLE civique_posts    ENABLE ROW LEVEL SECURITY;
 *     ALTER TABLE civique_comments ENABLE ROW LEVEL SECURITY;
 *     CREATE POLICY "public_all" ON civique_posts    FOR ALL USING (true) WITH CHECK (true);
 *     CREATE POLICY "public_all" ON civique_comments FOR ALL USING (true) WITH CHECK (true);
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Only create client if credentials are present
export const supabase = url && key ? createClient(url, key) : null;

export const DB_READY = !!(url && key);

// Debug: log on module load so you can see in browser console
if (typeof window !== "undefined") {
  console.log(
    "%c[Civique DB]%c " + (DB_READY ? "✅ Connected" : "❌ Not configured"),
    "color:#C47F00;font-weight:700",
    "color:inherit",
    { url: url ? url.slice(0, 30) + "…" : "MISSING", key: key ? "present" : "MISSING" }
  );
}