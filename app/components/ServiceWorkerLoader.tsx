"use client";
import { useEffect } from "react";

export default function ServiceWorkerLoader() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.hostname !== "localhost") {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => console.log("SW Registered:", reg.scope))
        .catch((err) => console.error("SW Failed:", err));
    }
  }, []);

  return null;
}