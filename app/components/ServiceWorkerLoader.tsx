"use client";
import { useEffect } from "react";
import { useProfile } from "./ProfileContext";
import { savePushSubscription } from "./db";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding  = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData  = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export default function ServiceWorkerLoader() {
  const { user } = useProfile();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.hostname === "localhost") return;

    const run = async () => {
      try {
        // Register SW
        const reg = await navigator.serviceWorker.register("/sw.js");
        console.log("SW registered:", reg.scope);

        // Only subscribe if user is logged in and notifications are supported
        if (!user?.id || !("PushManager" in window)) return;

        // Check / request permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        // Subscribe to push — reuses existing subscription if already subscribed
        const existing = await reg.pushManager.getSubscription();
        const subscription = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        // Save to DB (upsert — safe to call on every load)
        await savePushSubscription(user.id, JSON.stringify(subscription));
      } catch (err) {
        console.error("SW / Push setup failed:", err);
      }
    };

    run();
  }, [user?.id]); // re-run when user logs in

  return null;
}