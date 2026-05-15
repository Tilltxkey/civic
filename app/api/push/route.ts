// app/api/push/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  "mailto:admin@civicfdse.vercel.app",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role — server only
);

export interface PushPayload {
  title:     string;
  body:      string;
  icon?:     string;
  badge?:    string;
  tag?:      string;
  data?:     Record<string, unknown>;
  // Target: send to specific users or broadcast to all
  userIds?:  string[];  // if omitted → send to ALL subscribed users
}

export async function POST(req: NextRequest) {
  // Simple auth — only allow calls with the internal secret
  const auth = req.headers.get("x-civic-secret");
  if (auth !== process.env.CIVIC_PUSH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload: PushPayload = await req.json();

  // Fetch subscriptions from DB
  let q = supabase.from("civique_push_subscriptions").select("subscription");
  if (payload.userIds && payload.userIds.length > 0) {
    q = q.in("user_id", payload.userIds);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notifPayload = JSON.stringify({
    title:    payload.title,
    body:     payload.body,
    icon:     payload.icon  ?? "/icon-192x192.png",
    badge:    payload.badge ?? "/icon-192x192.png",
    tag:      payload.tag   ?? "civic",
    data:     payload.data  ?? {},
  });

  // Send to all matched subscriptions in parallel
  const results = await Promise.allSettled(
    (data ?? []).map(async row => {
      const sub = JSON.parse(row.subscription);
      try {
        await webpush.sendNotification(sub, notifPayload);
      } catch (err: any) {
        // 410 Gone = subscription expired, remove it
        if (err.statusCode === 410) {
          await supabase
            .from("civique_push_subscriptions")
            .delete()
            .eq("subscription", row.subscription);
        }
      }
    })
  );

  const sent   = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;
  return NextResponse.json({ sent, failed });
}
