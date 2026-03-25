"use client";
/**
 * UserSync.tsx
 * Pushes user from page.tsx into ProfileContext.
 * Also restores profilePhoto on sign-in — but ONLY once on mount,
 * never overwriting a photo the user just picked in this session.
 */
import { useEffect, useRef } from "react";
import { useProfile } from "./ProfileContext";
import type { UserProfile } from "./AuthFlow";

export function UserSync({ user }: { user: UserProfile }) {
  const { setUser, setProfilePic } = useProfile();
  const restoredRef = useRef(false);

  useEffect(() => {
    setUser(user);
    // Restore saved profile photo from DB — but only once per session.
    // After that, AppMenu manages profilePic directly via setProfilePic.
    if (!restoredRef.current) {
      restoredRef.current = true;
      if (user.profilePhoto) {
        setProfilePic(user.profilePhoto);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]); // only re-run if a different user logs in

  return null;
}